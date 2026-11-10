import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureFunctionTracing,
  resetFunctionTracing,
  traceFunctionEnd,
  traceFunctionStart,
  type FunctionTrace,
} from "../src/runtime.js";

afterEach(() => {
  resetFunctionTracing();
  vi.restoreAllMocks();
});

describe("function tracing runtime", () => {
  it("does not capture parameters or emit telemetry while disabled", () => {
    const track = vi.fn();
    const parameters = vi.fn(() => ({ value: "private" }));
    configureFunctionTracing({ sink: { track }, includeParams: true, allowedParameters: ["value"] });

    expect(traceFunctionStart("src/example.ts:1:1", "example", parameters)).toBeNull();
    expect(parameters).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it("emits paired start and end events even if configuration changes mid-call", () => {
    const traces: FunctionTrace[] = [];
    configureFunctionTracing({ enabled: true, sink: { track: (trace) => traces.push(trace) } });

    const handle = traceFunctionStart("src/example.ts:1:1", "example");
    configureFunctionTracing({ enabled: false, sink: null });
    traceFunctionEnd(handle);
    traceFunctionEnd(handle);

    expect(traces).toHaveLength(2);
    expect(traces[0]).toMatchObject({ phase: "start", functionName: "example" });
    expect(traces[1]).toMatchObject({ phase: "end", functionName: "example" });
    expect(traces[1]?.invocationId).toBe(traces[0]?.invocationId);
    expect(traces[1]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("filters by normalized target users and function patterns", () => {
    const track = vi.fn();
    configureFunctionTracing({
      enabled: true,
      sink: { track },
      targetUsers: [" USER-1 "],
      currentUserIdentifiers: [null, "user-1"],
      targetFunctions: ["load*", "*service.ts*"],
      excludedFunctions: ["*Secret*"],
    });

    expect(traceFunctionStart("src/page.ts:1:1", "loadData")).not.toBeNull();
    expect(traceFunctionStart("src/service.ts:2:1", "save")).not.toBeNull();
    expect(traceFunctionStart("src/page.ts:3:1", "save")).toBeNull();
    expect(traceFunctionStart("src/service.ts:4:1", "loadSecret")).toBeNull();
    configureFunctionTracing({ currentUserIdentifiers: ["other-user"] });
    expect(traceFunctionStart("src/page.ts:1:1", "loadData")).toBeNull();
    expect(track).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(track.mock.calls)).not.toContain("user-1");
  });

  it("samples functions deterministically and respects zero and full rates", () => {
    const track = vi.fn();
    configureFunctionTracing({ enabled: true, sink: { track }, sampleRate: 0 });
    expect(traceFunctionStart("src/example.ts:1:1", "example")).toBeNull();

    configureFunctionTracing({ sampleRate: 0.5 });
    const first = traceFunctionStart("src/example.ts:1:1", "example") !== null;
    for (let index = 0; index < 10; index++) {
      expect(traceFunctionStart("src/example.ts:1:1", "example") !== null).toBe(first);
    }
    configureFunctionTracing({ sampleRate: 1 });
    expect(traceFunctionStart("src/example.ts:1:1", "example")).not.toBeNull();
  });

  it("captures only allowlisted parameters, redacts sensitive keys, and avoids accessors", () => {
    const traces: FunctionTrace[] = [];
    const getter = vi.fn(() => "should not run");
    const payload: Record<string, unknown> = { token: "secret", visible: "safe", custom: "private" };
    Object.defineProperty(payload, "computed", { enumerable: true, get: getter });
    payload.self = payload;
    configureFunctionTracing({
      enabled: true,
      sink: { track: (trace) => traces.push(trace) },
      includeParams: true,
      allowedParameters: ["payload", "password"],
      redactedKeys: ["custom"],
    });

    traceFunctionStart("src/example.ts:1:1", "example", () => ({
      payload,
      password: "hidden",
      unlisted: "not captured",
    }));

    expect(getter).not.toHaveBeenCalled();
    expect(JSON.parse(traces[0]?.parameters ?? "")).toEqual({
      payload: {
        token: "[REDACTED]",
        visible: "safe",
        custom: "[REDACTED]",
        computed: "[accessor]",
        self: "[circular]",
      },
      password: "[REDACTED]",
    });
    expect(traces[0]?.parameters).not.toContain("not captured");
  });

  it("applies safe per-function parameter transformations and omits unapproved functions", () => {
    const traces: FunctionTrace[] = [];
    configureFunctionTracing({
      enabled: true,
      sink: { track: (trace) => traces.push(trace) },
      includeParams: true,
      parameterPolicy: {
        load: { context: "length", options: "summary" },
        currentUser: "omit",
      },
    });

    const user = { fullName: "Private User", systemUserId: "private-id" };
    const loadHandle = traceFunctionStart("src/data.ts:1:1:load", "load", () => ({
      context: "project:private",
      options: { user, visible: "not emitted" },
    }));
    traceFunctionEnd(loadHandle);
    const userParameters = vi.fn(() => ({ user }));
    const userHandle = traceFunctionStart("src/data.ts:2:1:currentUser", "currentUser", userParameters);
    traceFunctionEnd(userHandle);

    expect(JSON.parse(traces[0]?.parameters ?? "")).toEqual({
      context: 15,
      options: { type: "object", propertyCount: 2 },
    });
    expect(JSON.stringify(traces)).not.toContain("Private User");
    expect(JSON.stringify(traces)).not.toContain("private-id");
    expect(traces[2]?.parameters).toBeUndefined();
    expect(userParameters).not.toHaveBeenCalled();
  });

  it("bounds captured payloads and reports capture errors without breaking the function", () => {
    const traces: FunctionTrace[] = [];
    const diagnostics = vi.fn();
    configureFunctionTracing({
      enabled: true,
      sink: { track: (trace) => traces.push(trace) },
      onDiagnostic: diagnostics,
      includeParams: true,
      allowedParameters: ["payload"],
    });
    const payload = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`key${index}`, "x".repeat(1000)]),
    );
    traceFunctionStart("src/example.ts:1:1", "example", () => ({ payload }));
    traceFunctionStart("src/example.ts:1:1", "example", () => {
      throw new Error("capture failed");
    });

    expect(traces[0]?.parameters?.length).toBeLessThanOrEqual(4096);
    expect(traces[1]?.parameters).toBeUndefined();
    expect(diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ code: "parameter-capture-failed" }),
    );
  });

  it("isolates sink failures and suppresses reentrant sink instrumentation", () => {
    const diagnostics = vi.fn();
    const track = vi.fn(() => {
      expect(traceFunctionStart("src/sink.ts:1:1", "sink")).toBeNull();
      throw new Error("sink failed");
    });
    configureFunctionTracing({ enabled: true, sink: { track }, onDiagnostic: diagnostics });

    expect(traceFunctionStart("src/example.ts:1:1", "example")).toBeNull();
    expect(track).toHaveBeenCalledTimes(1);
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({ code: "sink-failed" }));
  });

  it("rejects unsafe capture and invalid settings without applying partial updates", () => {
    const track = vi.fn();
    configureFunctionTracing({ enabled: true, sink: { track } });
    expect(() => configureFunctionTracing({ enabled: false, sampleRate: 2 })).toThrow(RangeError);
    expect(() => configureFunctionTracing({ includeParams: true })).toThrow("allowedParameters or parameterPolicy");
    expect(() => configureFunctionTracing({
      includeParams: true,
      parameterPolicy: { load: { context: "raw" as never } },
    })).toThrow("Unsupported parameter capture rule");
    expect(() => configureFunctionTracing({ targetFunctions: ["a*b"] })).toThrow("wildcards");

    expect(traceFunctionStart("src/example.ts:1:1", "example")).not.toBeNull();
    expect(track).toHaveBeenCalledTimes(1);
  });
});
