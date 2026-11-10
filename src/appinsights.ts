import type { FunctionTrace, FunctionTraceSink } from "./runtime.js";

export interface ApplicationInsightsTraceClient {
  trackTrace(
    telemetry: { message: string },
    customProperties?: Record<string, string>,
  ): void;
}

export function createApplicationInsightsSink(
  client: ApplicationInsightsTraceClient,
): FunctionTraceSink {
  if (!client || typeof client.trackTrace !== "function") {
    throw new TypeError("Application Insights client must have a trackTrace function");
  }

  return {
    track(trace: FunctionTrace): void {
      const properties: Record<string, string> = {
        eventCategory: "function-trace",
        tracePhase: trace.phase,
        functionId: trace.functionId,
        functionName: trace.functionName,
        invocationId: trace.invocationId,
      };
      if (trace.parameters !== undefined) properties.parameters = trace.parameters;
      if (trace.durationMs !== undefined) properties.durationMs = String(trace.durationMs);

      client.trackTrace(
        { message: `Function ${trace.phase}: ${trace.functionName}` },
        properties,
      );
    },
  };
}
