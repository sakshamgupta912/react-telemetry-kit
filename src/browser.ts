import { startApiCapture, normalizeApiOptions, type ApiCallOptions } from "./internal/collectors/api.js";
import { resolveClickAttribute, startClickCapture, type ClickCaptureOptions } from "./internal/collectors/clicks.js";
import { startErrorCapture, type ErrorCaptureOptions } from "./internal/collectors/errors.js";
import {
  resetPageViewState,
  startPageViewCapture,
  type PageViewOptions,
} from "./internal/collectors/navigation.js";
import {
  startPerformanceCapture,
  type PerformanceCaptureOptions,
} from "./internal/collectors/performance.js";
import type {
  BrowserDiagnostic,
  CollectorContext,
  StopCollector,
} from "./internal/collectors/types.js";
import { createEnvelope, getSessionId, setSessionId } from "./internal/context.js";
import { createDiagnosticReporter } from "./internal/diagnostics.js";
import { dispatch, isDispatching } from "./internal/dispatch.js";
import type { TelemetryEvent, TelemetrySink } from "./internal/events.js";
import { isSelected } from "./internal/sampling.js";

export type {
  ApiCallEvent,
  BrowserTelemetryEvent,
  ClickEvent,
  FunctionTrace,
  PageLoadEvent,
  PageViewEvent,
  TelemetryEnvelope,
  TelemetryEvent,
  TelemetrySink,
  UncaughtErrorEvent,
  WebVitalEvent,
} from "./internal/events.js";
export type {
  ApiCallOptions,
  BrowserDiagnostic,
  ClickCaptureOptions,
  ErrorCaptureOptions,
  PageViewOptions,
  PerformanceCaptureOptions,
};

export interface BrowserTelemetryConfiguration {
  /** Defaults to false, like function tracing. Nothing is captured until this is true. */
  enabled?: boolean;
  sink?: TelemetrySink | null;
  /** Replaces the in-memory session ID. It is also used by function traces. */
  sessionId?: string;
  /** Fraction of sessions that emit browser events, selected deterministically from the session ID. */
  sampleRate?: number;
  /** Uncaught errors and unhandled promise rejections. */
  errors?: boolean | ErrorCaptureOptions;
  /** Initial page view and SPA navigation (path only). */
  pageViews?: boolean | PageViewOptions;
  /** Navigation Timing and Core Web Vitals. */
  performance?: boolean | PerformanceCaptureOptions;
  /** Fetch and XMLHttpRequest calls (method, origin and path, status, duration). */
  apiCalls?: boolean | ApiCallOptions;
  /** Clicks on elements that opt in with a `data-telemetry-id` attribute. */
  clicks?: boolean | ClickCaptureOptions;
  onDiagnostic?: ((diagnostic: BrowserDiagnostic) => void) | null;
}

const diagnostics = createDiagnosticReporter<BrowserDiagnostic>();
let stops: StopCollector[] = [];

function featureOptions<T extends object>(
  value: boolean | T | undefined,
  field: string,
): T | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) return {} as T;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be a boolean or an object`);
  }
  return value;
}

function assertOptionalBoolean(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new TypeError(`${field} must be boolean`);
  }
}

function assertOptionalFunction(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== "function") {
    throw new TypeError(`${field} must be a function`);
  }
}

function stopCollectors(): void {
  const current = stops;
  stops = [];
  for (const stop of current.reverse()) {
    try {
      stop();
    } catch (error) {
      diagnostics.report(null, { code: "collector-failed", feature: "stop", error });
    }
  }
}

/**
 * Starts the selected browser collectors. Each call replaces the previous
 * browser configuration; it is not a partial update.
 */
export function configureBrowserTelemetry(configuration: BrowserTelemetryConfiguration): void {
  const {
    enabled = false,
    sink = null,
    sessionId,
    sampleRate = 1,
    onDiagnostic = null,
  } = configuration;

  if (typeof enabled !== "boolean") throw new TypeError("enabled must be boolean");
  if (sink !== null && typeof sink.track !== "function") {
    throw new TypeError("sink must have a track function");
  }
  if (sessionId !== undefined && (typeof sessionId !== "string" || !sessionId.trim())) {
    throw new TypeError("sessionId must be a non-empty string");
  }
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
    throw new RangeError("sampleRate must be between 0 and 1");
  }
  if (onDiagnostic !== null && typeof onDiagnostic !== "function") {
    throw new TypeError("onDiagnostic must be a function");
  }

  const errors = featureOptions(configuration.errors, "errors");
  if (errors) {
    assertOptionalBoolean(errors.captureStack, "errors.captureStack");
    if (
      errors.maxEvents !== undefined &&
      (!Number.isInteger(errors.maxEvents) || errors.maxEvents < 1)
    ) {
      throw new RangeError("errors.maxEvents must be a positive integer");
    }
  }
  const pageViews = featureOptions(configuration.pageViews, "pageViews");
  if (pageViews) {
    assertOptionalBoolean(pageViews.includeHash, "pageViews.includeHash");
    assertOptionalFunction(pageViews.normalizePath, "pageViews.normalizePath");
  }
  const performanceCapture = featureOptions(configuration.performance, "performance");
  if (performanceCapture) {
    assertOptionalBoolean(performanceCapture.pageLoad, "performance.pageLoad");
    assertOptionalBoolean(performanceCapture.webVitals, "performance.webVitals");
  }
  const apiCalls = featureOptions(configuration.apiCalls, "apiCalls");
  if (apiCalls) normalizeApiOptions(apiCalls);
  const clicks = featureOptions(configuration.clicks, "clicks");
  if (clicks) resolveClickAttribute(clicks);

  stopCollectors();
  diagnostics.reset();
  if (sessionId !== undefined) setSessionId(sessionId.trim());

  if (!enabled || !sink || typeof window === "undefined" || typeof document === "undefined") return;
  if (!isSelected(getSessionId(), sampleRate)) return;

  const context: CollectorContext = {
    emit(payload, pageViewId) {
      if (isDispatching()) return;
      const event = { ...payload, ...createEnvelope(pageViewId) } as TelemetryEvent;
      dispatch(() => {
        try {
          sink.track(event);
        } catch (error) {
          diagnostics.report(onDiagnostic, { code: "sink-failed", error });
        }
      });
    },
    diagnostic(diagnostic) {
      diagnostics.report(onDiagnostic, diagnostic);
    },
  };

  const start = (feature: string, run: () => StopCollector): void => {
    try {
      stops.push(run());
    } catch (error) {
      diagnostics.report(onDiagnostic, { code: "collector-failed", feature, error });
    }
  };

  if (pageViews) start("pageViews", () => startPageViewCapture(pageViews, context));
  if (errors) start("errors", () => startErrorCapture(errors, context));
  if (performanceCapture) {
    start("performance", () => startPerformanceCapture(performanceCapture, context));
  }
  if (apiCalls) start("apiCalls", () => startApiCapture(apiCalls, context));
  if (clicks) start("clicks", () => startClickCapture(clicks, context));
}

/** Stops every browser collector and restores any patched browser APIs. */
export function resetBrowserTelemetry(): void {
  stopCollectors();
  diagnostics.reset();
  resetPageViewState();
}
