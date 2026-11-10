import { ApplicationInsights } from "@microsoft/applicationinsights-web";
import { createApplicationInsightsSink } from "./appinsights.js";
import type { FunctionTrace, FunctionTraceSink } from "./runtime.js";

export interface ApplicationInsightsDiagnostic {
  code:
    | "initialization-retry"
    | "initialization-failed"
    | "replay-failed"
    | "buffer-discarded"
    | "cleanup-failed";
  error: unknown;
}

export interface ApplicationInsightsInitializationOptions {
  connectionString: string;
  maxInitAttempts?: number;
  retryDelayMs?: number;
  maxBufferedTraces?: number;
  onDiagnostic?: (diagnostic: ApplicationInsightsDiagnostic) => void;
}

export interface OwnedApplicationInsights {
  sink: FunctionTraceSink;
  ready: Promise<void>;
  flush(): Promise<void>;
  dispose(): Promise<void>;
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function initializeApplicationInsights(
  options: ApplicationInsightsInitializationOptions,
): OwnedApplicationInsights {
  if (typeof options.connectionString !== "string" || !options.connectionString.trim()) {
    throw new TypeError("A non-empty Application Insights connection string is required");
  }
  const maxInitAttempts = boundedInteger(options.maxInitAttempts ?? 3, "maxInitAttempts", 1, 10);
  const retryDelayMs = boundedInteger(options.retryDelayMs ?? 2000, "retryDelayMs", 0, 60000);
  const maxBufferedTraces = boundedInteger(options.maxBufferedTraces ?? 100, "maxBufferedTraces", 0, 1000);
  if (options.onDiagnostic !== undefined && typeof options.onDiagnostic !== "function") {
    throw new TypeError("onDiagnostic must be a function");
  }

  let state: "initializing" | "ready" | "failed" | "disposed" = "initializing";
  let client: ApplicationInsights | null = null;
  let clientSink: FunctionTraceSink | null = null;
  let failure: Error | null = null;
  let diagnosticCount = 0;
  let cancelDelay: (() => void) | null = null;
  let disposal: Promise<void> | null = null;
  const buffered: FunctionTrace[] = [];

  function isDisposed(): boolean {
    return state === "disposed";
  }

  function report(diagnostic: ApplicationInsightsDiagnostic): void {
    if (options.onDiagnostic) {
      try {
        options.onDiagnostic(diagnostic);
        return;
      } catch (error) {
        console.warn("[react-telemetry-kit] Application Insights diagnostic callback failed", error);
      }
    }
    if (diagnosticCount < 5) {
      console.warn(`[react-telemetry-kit] ${diagnostic.code}`, diagnostic.error);
    } else if (diagnosticCount === 5) {
      console.warn("[react-telemetry-kit] Further Application Insights diagnostics suppressed");
    }
    diagnosticCount++;
  }

  function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        cancelDelay = null;
        resolve();
      };
      const timer = setTimeout(finish, milliseconds);
      cancelDelay = finish;
    });
  }

  async function initialize(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxInitAttempts; attempt++) {
      if (isDisposed()) throw new Error("Application Insights initialization was disposed");
      let candidate: ApplicationInsights | null = null;
      try {
        candidate = new ApplicationInsights({
          config: {
            connectionString: options.connectionString.trim(),
            enableAutoRouteTracking: false,
            enableCorsCorrelation: false,
            disableFetchTracking: true,
            disableAjaxTracking: true,
            disableExceptionTracking: true,
            enableRequestHeaderTracking: false,
            enableResponseHeaderTracking: false,
          },
        });
        candidate.loadAppInsights();
        client = candidate;
        state = "ready";
        const adapter = createApplicationInsightsSink(candidate);
        clientSink = adapter;
        for (const trace of buffered.splice(0)) {
          try {
            adapter.track(trace);
          } catch (error) {
            report({ code: "replay-failed", error });
          }
        }
        return;
      } catch (error) {
        lastError = error;
        if (candidate) {
          try {
            await candidate.unload(false);
          } catch (cleanupError) {
            report({ code: "cleanup-failed", error: cleanupError });
          }
        }
        if (isDisposed()) throw new Error("Application Insights initialization was disposed");
        if (attempt < maxInitAttempts) {
          report({ code: "initialization-retry", error });
          await delay(retryDelayMs * 2 ** (attempt - 1));
        }
      }
    }

    failure = new Error(`Application Insights failed after ${maxInitAttempts} attempts`, {
      cause: lastError,
    });
    state = "failed";
    if (buffered.length > 0) {
      report({
        code: "buffer-discarded",
        error: new Error(`${buffered.length} buffered traces could not be delivered`),
      });
      buffered.length = 0;
    }
    report({ code: "initialization-failed", error: failure });
    throw failure;
  }

  const sink: FunctionTraceSink = {
    track(trace) {
      if (state === "ready" && clientSink) {
        clientSink.track(trace);
        return;
      }
      if (state === "failed") throw failure ?? new Error("Application Insights initialization failed");
      if (state === "disposed") throw new Error("Application Insights is disposed");
      if (buffered.length >= maxBufferedTraces) {
        throw new Error("Application Insights trace buffer is full");
      }
      buffered.push({ ...trace });
    },
  };

  const ready = initialize();

  async function flush(): Promise<void> {
    await ready;
    if (state === "disposed" || !client) throw new Error("Application Insights is disposed");
    await client.flush(true);
  }

  function dispose(): Promise<void> {
    if (disposal) return disposal;
    state = "disposed";
    if (cancelDelay) cancelDelay();
    if (buffered.length > 0) {
      report({
        code: "buffer-discarded",
        error: new Error(`${buffered.length} buffered traces were discarded during disposal`),
      });
      buffered.length = 0;
    }
    const ownedClient = client;
    client = null;
    clientSink = null;

    disposal = (async () => {
      if (!ownedClient) return;
      const errors: unknown[] = [];
      try {
        await ownedClient.flush(true);
      } catch (error) {
        errors.push(error);
        report({ code: "cleanup-failed", error });
      }
      try {
        await ownedClient.unload(true);
      } catch (error) {
        errors.push(error);
        report({ code: "cleanup-failed", error });
      }
      if (errors.length > 0) throw new AggregateError(errors, "Application Insights disposal failed");
    })();
    return disposal;
  }

  return { sink, ready, flush, dispose };
}
