import { afterEach, beforeEach, vi } from "vitest";
import { resetBrowserTelemetry, type TelemetryEvent, type TelemetrySink } from "../../src/browser.js";
import { resetTelemetryContext } from "../../src/internal/context.js";

export const events: TelemetryEvent[] = [];

export const sink: TelemetrySink = {
  track(event) {
    events.push(event);
  },
};

export function eventsOf<T extends TelemetryEvent["type"]>(type: T): Extract<TelemetryEvent, { type: T }>[] {
  return events.filter((event): event is Extract<TelemetryEvent, { type: T }> => event.type === type);
}

export const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export function useBrowserTelemetryHooks(): void {
  beforeEach(() => {
    events.length = 0;
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    resetBrowserTelemetry();
    resetTelemetryContext();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });
}
