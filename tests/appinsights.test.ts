import type { ApplicationInsights } from "@microsoft/applicationinsights-web";
import { describe, expect, it, vi } from "vitest";
import { createApplicationInsightsSink } from "../src/appinsights.js";

describe("existing Application Insights client", () => {
  it("maps traces without initializing, flushing, or disposing the supplied client", () => {
    const client = {
      trackTrace: vi.fn(),
      loadAppInsights: vi.fn(),
      flush: vi.fn(),
      unload: vi.fn(),
    };
    const sink = createApplicationInsightsSink(client);
    sink.track({
      phase: "start",
      functionId: "src/example.ts:1:1:example",
      functionName: "example",
      invocationId: "operation-1",
      parameters: '{"value":1}',
    });
    sink.track({
      phase: "end",
      functionId: "src/example.ts:1:1:example",
      functionName: "example",
      invocationId: "operation-1",
      durationMs: 12.5,
    });

    expect(client.trackTrace).toHaveBeenNthCalledWith(
      1,
      { message: "Function start: example" },
      {
        eventCategory: "function-trace",
        tracePhase: "start",
        functionId: "src/example.ts:1:1:example",
        functionName: "example",
        invocationId: "operation-1",
        parameters: '{"value":1}',
      },
    );
    expect(client.trackTrace).toHaveBeenNthCalledWith(
      2,
      { message: "Function end: example" },
      expect.objectContaining({ durationMs: "12.5", tracePhase: "end" }),
    );
    expect(client.loadAppInsights).not.toHaveBeenCalled();
    expect(client.flush).not.toHaveBeenCalled();
    expect(client.unload).not.toHaveBeenCalled();
  });

  it("accepts the SDK's ApplicationInsights type without creating an instance", () => {
    function acceptsSdk(client: ApplicationInsights) {
      return createApplicationInsightsSink(client);
    }
    expect(acceptsSdk).toBeTypeOf("function");
    expect(() => createApplicationInsightsSink({ trackTrace: undefined } as never)).toThrow(TypeError);
  });
});
