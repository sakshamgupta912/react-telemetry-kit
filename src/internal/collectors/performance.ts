import { getPageViewId } from "../context.js";
import type { PageLoadEvent, WebVitalEvent } from "../events.js";
import type { CollectorContext, StopCollector } from "./types.js";

export interface PerformanceCaptureOptions {
  /** Emit one `page-load` event from Navigation Timing. Defaults to true. */
  pageLoad?: boolean;
  /** Emit FCP, LCP, CLS, INP, and TTFB. Defaults to true. Browser support varies. */
  webVitals?: boolean;
}

type PageLoadPayload = Omit<PageLoadEvent, "timestamp" | "sessionId" | "pageViewId" | "sequence" | "sdkVersion">;
type VitalName = WebVitalEvent["name"];

interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

interface EventTimingEntry extends PerformanceEntry {
  interactionId?: number;
}

interface NavigationEntry extends PerformanceNavigationTiming {
  activationStart?: number;
}

const THRESHOLDS: Record<VitalName, readonly [good: number, poor: number]> = {
  FCP: [1800, 3000],
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
  TTFB: [800, 1800],
};

const MAX_TRACKED_INTERACTIONS = 10;

function rating(name: VitalName, value: number): WebVitalEvent["rating"] {
  const [good, poor] = THRESHOLDS[name];
  return value <= good ? "good" : value <= poor ? "needs-improvement" : "poor";
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(Math.max(0, value) * factor) / factor;
}

export function startPerformanceCapture(
  options: PerformanceCaptureOptions,
  context: CollectorContext,
): StopCollector {
  const wantsPageLoad = options.pageLoad !== false;
  const wantsVitals = options.webVitals !== false;
  const pageViewId = getPageViewId();
  const cleanups: Array<() => void> = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const reported = new Map<VitalName, number>();
  let active = true;

  function guarded(feature: string, callback: () => void): void {
    if (!active) return;
    try {
      callback();
    } catch (error) {
      context.diagnostic({ code: "collector-failed", feature, error });
    }
  }

  function reportVital(name: VitalName, value: number): void {
    if (reported.get(name) === value) return;
    reported.set(name, value);
    context.emit({ type: "web-vital", name, value, rating: rating(name, value) }, pageViewId);
  }

  function observe(
    type: string,
    callback: (entries: PerformanceEntryList) => void,
    extra: Record<string, unknown> = {},
  ): boolean {
    if (typeof PerformanceObserver !== "function") return false;
    try {
      if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return false;
      const observer = new PerformanceObserver((list) => {
        guarded(`performance.${type}`, () => callback(list.getEntries()));
      });
      observer.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
      cleanups.push(() => observer.disconnect());
      return true;
    } catch (error) {
      context.diagnostic({ code: "collector-failed", feature: `performance.${type}`, error });
      return false;
    }
  }

  function reportNavigation(): void {
    const entry =
      typeof performance !== "undefined" && typeof performance.getEntriesByType === "function"
        ? (performance.getEntriesByType("navigation")[0] as NavigationEntry | undefined)
        : undefined;
    if (!entry) {
      context.diagnostic({ code: "unsupported", feature: "performance.navigation" });
      return;
    }
    if (wantsPageLoad) {
      const payload: PageLoadPayload = {
        type: "page-load",
        redirectMs: round(entry.redirectEnd - entry.redirectStart),
        dnsMs: round(entry.domainLookupEnd - entry.domainLookupStart),
        connectMs: round(entry.connectEnd - entry.connectStart),
        ttfbMs: round(entry.responseStart),
        responseMs: round(entry.responseEnd - entry.responseStart),
        domInteractiveMs: round(entry.domInteractive),
        domContentLoadedMs: round(entry.domContentLoadedEventEnd),
        loadMs: round(entry.loadEventEnd),
      };
      if (typeof entry.type === "string") payload.navigationType = entry.type;
      if (typeof entry.transferSize === "number") payload.transferSize = entry.transferSize;
      context.emit(payload, pageViewId);
    }
    if (wantsVitals) reportVital("TTFB", round(entry.responseStart - (entry.activationStart ?? 0)));
  }

  function scheduleNavigationReport(): void {
    const timer = setTimeout(() => {
      timers.delete(timer);
      guarded("performance.navigation", reportNavigation);
    }, 0);
    timers.add(timer);
  }

  if (wantsPageLoad || wantsVitals) {
    if (document.readyState === "complete") {
      scheduleNavigationReport();
    } else {
      window.addEventListener("load", scheduleNavigationReport, { once: true });
      cleanups.push(() => window.removeEventListener("load", scheduleNavigationReport));
    }
  }

  if (wantsVitals) {
    let lcp: number | undefined;
    let cls = 0;
    let sessionValue = 0;
    let sessionStart = 0;
    let sessionEnd = 0;
    let minInteractionId = Infinity;
    let maxInteractionId = 0;
    const interactions = new Map<number, number>();

    observe("paint", (entries) => {
      for (const entry of entries) {
        if (entry.name === "first-contentful-paint") reportVital("FCP", round(entry.startTime));
      }
    });

    observe("largest-contentful-paint", (entries) => {
      const last = entries[entries.length - 1];
      if (last) lcp = last.startTime;
    });

    const clsObserved = observe("layout-shift", (entries) => {
      for (const entry of entries as LayoutShiftEntry[]) {
        if (entry.hadRecentInput) continue;
        if (sessionValue > 0 && entry.startTime - sessionEnd < 1000 && entry.startTime - sessionStart < 5000) {
          sessionValue += entry.value;
          sessionEnd = entry.startTime;
        } else {
          sessionValue = entry.value;
          sessionStart = entry.startTime;
          sessionEnd = entry.startTime;
        }
        cls = Math.max(cls, sessionValue);
      }
    });

    observe(
      "event",
      (entries) => {
        for (const entry of entries as EventTimingEntry[]) {
          const id = entry.interactionId;
          if (!id) continue;
          minInteractionId = Math.min(minInteractionId, id);
          maxInteractionId = Math.max(maxInteractionId, id);
          const previous = interactions.get(id);
          if (previous !== undefined && entry.duration <= previous) continue;
          interactions.set(id, entry.duration);
          if (interactions.size > MAX_TRACKED_INTERACTIONS) {
            let shortestId = id;
            let shortest = Infinity;
            for (const [candidateId, duration] of interactions) {
              if (duration < shortest) {
                shortest = duration;
                shortestId = candidateId;
              }
            }
            interactions.delete(shortestId);
          }
        }
      },
      { durationThreshold: 40 },
    );

    const flush = (): void => {
      guarded("performance.vitals", () => {
        if (lcp !== undefined) reportVital("LCP", round(lcp));
        if (clsObserved) reportVital("CLS", round(cls, 4));
        if (interactions.size > 0) {
          const total =
            (performance as { interactionCount?: number }).interactionCount ??
            (maxInteractionId - minInteractionId) / 7 + 1;
          const longest = [...interactions.values()].sort((left, right) => right - left);
          const value = longest[Math.min(longest.length - 1, Math.floor(total / 50))];
          if (value !== undefined) reportVital("INP", round(value));
        }
      });
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") flush();
    };
    // Capture phase on window runs before listeners that an application's sink
    // registers on document, so a flush-on-hide sink sees these vitals no
    // matter which side registered first.
    window.addEventListener("visibilitychange", onVisibilityChange, true);
    window.addEventListener("pagehide", flush, true);
    cleanups.push(() => {
      window.removeEventListener("visibilitychange", onVisibilityChange, true);
      window.removeEventListener("pagehide", flush, true);
    });
  }

  return () => {
    active = false;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const cleanup of cleanups) cleanup();
  };
}
