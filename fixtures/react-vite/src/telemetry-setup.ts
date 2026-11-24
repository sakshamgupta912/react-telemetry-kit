import {
  configureBrowserTelemetry,
  type BrowserDiagnostic,
  type TelemetryEvent,
} from "react-telemetry-kit/browser";
import { configureFunctionTracing } from "react-telemetry-kit/runtime";

export interface TelemetryHandle {
  events: TelemetryEvent[];
  diagnostics: BrowserDiagnostic[];
}

/**
 * Application-owned setup. This file is excluded from build-time
 * instrumentation (see vite.config.js); otherwise the flush timer below would
 * generate function traces that feed back into the sink.
 */
export function startTelemetry(options: {
  ingestUrl: string;
  excludeIngest: boolean;
  flushFirst?: boolean;
}): TelemetryHandle {
  const handle: TelemetryHandle = { events: [], diagnostics: [] };
  let buffer: TelemetryEvent[] = [];

  function flush(final: boolean): void {
    if (buffer.length === 0) return;
    const body = JSON.stringify(buffer);
    buffer = [];
    if (final && navigator.sendBeacon(options.ingestUrl, new Blob([body], { type: "text/plain" }))) {
      return;
    }
    fetch(options.ingestUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  }

  const sink = {
    track(event: TelemetryEvent) {
      handle.events.push(event);
      buffer.push(event);
    },
  };

  function registerFlushListeners(): void {
    // The stress case flushes only when the page is hidden (no timer and no
    // pagehide), so vitals emitted after that flush have no second chance.
    if (!options.flushFirst) setInterval(() => flush(false), 100);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush(true);
    });
    if (!options.flushFirst) window.addEventListener("pagehide", () => flush(true));
  }

  // Stress case: an application that registers its flush listeners first.
  if (options.flushFirst) registerFlushListeners();

  configureFunctionTracing({ enabled: true, sink });
  configureBrowserTelemetry({
    enabled: true,
    sink,
    onDiagnostic: (diagnostic) => handle.diagnostics.push(diagnostic),
    errors: { captureStack: true },
    pageViews: { normalizePath: (path) => path.replace(/\/\d+/g, "/:id") },
    performance: true,
    apiCalls: {
      excludeUrls: options.excludeIngest
        ? [`${new URL(options.ingestUrl, location.href).origin}/*`]
        : [],
    },
    clicks: true,
  });

  if (!options.flushFirst) registerFlushListeners();
  return handle;
}
