import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FunctionTrace } from "../src/runtime.js";

const mocks = vi.hoisted(() => ({
  options: [] as unknown[],
  load: vi.fn(),
  track: vi.fn(),
  flush: vi.fn(),
  unload: vi.fn(),
}));

vi.mock("@microsoft/applicationinsights-web", () => ({
  ApplicationInsights: class {
    constructor(options: unknown) {
      mocks.options.push(options);
    }
    loadAppInsights() { return mocks.load(); }
    trackTrace(...args: unknown[]) { return mocks.track(...args); }
    flush(...args: unknown[]) { return mocks.flush(...args); }
    unload(...args: unknown[]) { return mocks.unload(...args); }
  },
}));

import { initializeApplicationInsights } from "../src/appinsights-initialize.js";

const trace: FunctionTrace = {
  phase: "start",
  functionId: "src/example.ts:1:1:example",
  functionName: "example",
  invocationId: "operation-1",
};
const connectionString = "InstrumentationKey=00000000-0000-0000-0000-000000000000";

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.options.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("owned Application Insights initialization", () => {
  it("initializes once with automatic unrelated tracking disabled and owns its lifecycle", async () => {
    const owner = initializeApplicationInsights({ connectionString });
    await owner.ready;
    owner.sink.track(trace);
    await owner.flush();
    await owner.dispose();
    await owner.dispose();

    expect(mocks.options).toHaveLength(1);
    expect(mocks.options[0]).toMatchObject({
      config: {
        connectionString,
        disableFetchTracking: true,
        disableAjaxTracking: true,
        disableExceptionTracking: true,
        enableRequestHeaderTracking: false,
        enableResponseHeaderTracking: false,
      },
    });
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledOnce();
    expect(mocks.flush).toHaveBeenCalledTimes(2);
    expect(mocks.unload).toHaveBeenCalledOnce();
    expect(() => owner.sink.track(trace)).toThrow("disposed");
  });

  it("retries initialization and replays bounded buffered traces", async () => {
    const diagnostics = vi.fn();
    mocks.load.mockImplementationOnce(() => { throw new Error("temporary"); });
    const owner = initializeApplicationInsights({
      connectionString,
      retryDelayMs: 2000,
      maxBufferedTraces: 1,
      onDiagnostic: diagnostics,
    });
    owner.sink.track(trace);
    expect(() => owner.sink.track(trace)).toThrow("buffer is full");
    const flush = owner.flush();

    await vi.advanceTimersByTimeAsync(2000);
    await owner.ready;
    await flush;

    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.track).toHaveBeenCalledOnce();
    expect(mocks.flush).toHaveBeenCalledOnce();
    expect(diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ code: "initialization-retry" }),
    );
    await owner.dispose();
  });

  it("reports final failure and discarded buffered data", async () => {
    const diagnostics = vi.fn();
    mocks.load.mockImplementation(() => { throw new Error("not configured"); });
    const owner = initializeApplicationInsights({
      connectionString,
      maxInitAttempts: 2,
      retryDelayMs: 0,
      onDiagnostic: diagnostics,
    });
    const outcome = owner.ready.catch((error: unknown) => error);
    owner.sink.track(trace);

    await vi.advanceTimersByTimeAsync(0);
    expect(await outcome).toBeInstanceOf(Error);
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({ code: "buffer-discarded" }));
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({ code: "initialization-failed" }));
    expect(() => owner.sink.track(trace)).toThrow("failed after 2 attempts");
    await owner.dispose();
  });

  it("cancels retries and reports buffered data when disposed during initialization", async () => {
    const diagnostics = vi.fn();
    mocks.load.mockImplementation(() => { throw new Error("temporary"); });
    const owner = initializeApplicationInsights({ connectionString, onDiagnostic: diagnostics });
    const outcome = owner.ready.catch((error: unknown) => error);
    owner.sink.track(trace);
    await Promise.resolve();
    await owner.dispose();

    expect(await outcome).toMatchObject({ message: expect.stringContaining("disposed") });
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({ code: "buffer-discarded" }));
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  it("reports replay and cleanup errors explicitly", async () => {
    const diagnostics = vi.fn();
    mocks.load.mockImplementationOnce(() => { throw new Error("temporary"); });
    mocks.track.mockImplementationOnce(() => { throw new Error("replay failed"); });
    const owner = initializeApplicationInsights({ connectionString, retryDelayMs: 0, onDiagnostic: diagnostics });
    owner.sink.track(trace);
    await vi.advanceTimersByTimeAsync(0);
    await owner.ready;
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({ code: "replay-failed" }));

    mocks.flush.mockImplementationOnce(() => { throw new Error("flush failed"); });
    await expect(owner.dispose()).rejects.toThrow("disposal failed");
    expect(mocks.unload).toHaveBeenCalledTimes(2);
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({ code: "cleanup-failed" }));
  });

  it("rejects invalid initialization options", () => {
    expect(() => initializeApplicationInsights({ connectionString: " " })).toThrow("connection string");
    expect(() => initializeApplicationInsights({ connectionString, maxInitAttempts: 0 })).toThrow(RangeError);
    expect(() => initializeApplicationInsights({ connectionString, maxBufferedTraces: 1001 })).toThrow(RangeError);
    expect(mocks.options).toHaveLength(0);
  });
});
