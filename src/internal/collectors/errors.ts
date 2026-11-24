import { errorTypeOf, sanitizeStack, sanitizeUrl } from "../sanitize.js";
import type { UncaughtErrorEvent } from "../events.js";
import type { CollectorContext, StopCollector } from "./types.js";

export interface ErrorCaptureOptions {
  /** Include a sanitized stack (frames only, no message, no URL query strings). Defaults to false. */
  captureStack?: boolean;
  /** Maximum error events per page load. Defaults to 100. */
  maxEvents?: number;
}

type ErrorPayload = Omit<UncaughtErrorEvent, "timestamp" | "sessionId" | "pageViewId" | "sequence" | "sdkVersion">;

const DEFAULT_MAX_EVENTS = 100;

function positive(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function startErrorCapture(
  options: ErrorCaptureOptions,
  context: CollectorContext,
): StopCollector {
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  let count = 0;

  function withinLimit(): boolean {
    count++;
    if (count <= maxEvents) return true;
    if (count === maxEvents + 1) {
      context.diagnostic({ code: "event-limit-reached", feature: "errors" });
    }
    return false;
  }

  function onError(event: ErrorEvent): void {
    try {
      if (!withinLimit()) return;
      const payload: ErrorPayload = {
        type: "error",
        source: "window.onerror",
        errorType: event.error == null ? "unknown" : errorTypeOf(event.error),
      };
      if (typeof event.filename === "string" && event.filename) {
        const filename = sanitizeUrl(event.filename, window.location.href);
        if (filename) payload.filename = filename;
      }
      const line = positive(event.lineno);
      const column = positive(event.colno);
      if (line !== undefined) payload.line = line;
      if (column !== undefined) payload.column = column;
      if (options.captureStack) {
        const stack = sanitizeStack((event.error as { stack?: unknown } | null)?.stack);
        if (stack) payload.stack = stack;
      }
      context.emit(payload);
    } catch (error) {
      context.diagnostic({ code: "collector-failed", feature: "errors", error });
    }
  }

  function onRejection(event: PromiseRejectionEvent): void {
    try {
      if (!withinLimit()) return;
      const payload: ErrorPayload = {
        type: "error",
        source: "unhandledrejection",
        errorType: errorTypeOf(event.reason),
      };
      if (options.captureStack) {
        const stack = sanitizeStack((event.reason as { stack?: unknown } | null)?.stack);
        if (stack) payload.stack = stack;
      }
      context.emit(payload);
    } catch (error) {
      context.diagnostic({ code: "collector-failed", feature: "errors", error });
    }
  }

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
