// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureBrowserTelemetry } from "../../src/browser.js";
import { eventsOf, settle, sink, useBrowserTelemetryHooks } from "./helpers.js";

useBrowserTelemetryHooks();

type Entry = Partial<PerformanceEntry> & Record<string, unknown>;

class FakeObserver {
  static supportedEntryTypes: string[] = [];
  static instances: FakeObserver[] = [];
  type = "";
  disconnected = false;
  constructor(private readonly callback: (list: { getEntries(): Entry[] }) => void) {
    FakeObserver.instances.push(this);
  }
  observe(init: { type: string }): void {
    this.type = init.type;
  }
  disconnect(): void {
    this.disconnected = true;
  }
  emit(entries: Entry[]): void {
    this.callback({ getEntries: () => entries });
  }
  static of(type: string): FakeObserver {
    const observer = FakeObserver.instances.find((candidate) => candidate.type === type);
    if (!observer) throw new Error(`No observer for ${type}`);
    return observer;
  }
}

const navigationEntry = {
  type: "navigate",
  startTime: 0,
  redirectStart: 0,
  redirectEnd: 0,
  domainLookupStart: 5,
  domainLookupEnd: 15,
  connectStart: 15,
  connectEnd: 40,
  responseStart: 120.44,
  responseEnd: 180,
  domInteractive: 300,
  domContentLoadedEventEnd: 320,
  loadEventEnd: 500.26,
  transferSize: 4096,
  activationStart: 0,
};

function installPerformance(options: { navigation?: object | null; interactionCount?: number } = {}): void {
  FakeObserver.instances = [];
  FakeObserver.supportedEntryTypes = ["paint", "largest-contentful-paint", "layout-shift", "event"];
  vi.stubGlobal("PerformanceObserver", FakeObserver);
  vi.stubGlobal("performance", {
    now: () => Date.now(),
    getEntriesByType: () => (options.navigation === null ? [] : [options.navigation ?? navigationEntry]),
    ...(options.interactionCount === undefined ? {} : { interactionCount: options.interactionCount }),
  });
}

function setVisibility(state: "hidden" | "visible"): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  Reflect.deleteProperty(document, "visibilityState");
});

describe("page performance capture", () => {
  it("emits navigation timing and TTFB after the page has loaded", async () => {
    installPerformance();
    configureBrowserTelemetry({ enabled: true, sink, performance: true });
    await settle();

    expect(eventsOf("page-load")[0]).toMatchObject({
      navigationType: "navigate",
      redirectMs: 0,
      dnsMs: 10,
      connectMs: 25,
      ttfbMs: 120.4,
      responseMs: 59.6,
      domInteractiveMs: 300,
      domContentLoadedMs: 320,
      loadMs: 500.3,
      transferSize: 4096,
    });
    expect(eventsOf("web-vital").find((event) => event.name === "TTFB")).toMatchObject({ value: 120.4, rating: "good" });
  });

  it("supports disabling page load or web vitals independently", async () => {
    installPerformance();
    configureBrowserTelemetry({ enabled: true, sink, performance: { webVitals: false } });
    await settle();
    expect(eventsOf("page-load")).toHaveLength(1);
    expect(eventsOf("web-vital")).toHaveLength(0);
    expect(FakeObserver.instances).toHaveLength(0);

    configureBrowserTelemetry({ enabled: true, sink, performance: { pageLoad: false } });
    await settle();
    expect(eventsOf("page-load")).toHaveLength(1);
    expect(eventsOf("web-vital").map((event) => event.name)).toEqual(["TTFB"]);
  });

  it("reports unsupported navigation timing as a diagnostic", async () => {
    installPerformance({ navigation: null });
    const onDiagnostic = vi.fn();
    configureBrowserTelemetry({ enabled: true, sink, performance: true, onDiagnostic });
    await settle();
    expect(eventsOf("page-load")).toHaveLength(0);
    expect(onDiagnostic).toHaveBeenCalledWith({ code: "unsupported", feature: "performance.navigation" });
  });

  it("reports FCP immediately and LCP, CLS, and INP when the page is hidden", () => {
    installPerformance({ interactionCount: 3 });
    configureBrowserTelemetry({ enabled: true, sink, performance: { pageLoad: false } });

    FakeObserver.of("paint").emit([{ name: "first-paint", startTime: 100 }, { name: "first-contentful-paint", startTime: 2000.04 }]);
    FakeObserver.of("largest-contentful-paint").emit([{ startTime: 1000 }, { startTime: 4500.5 }]);
    FakeObserver.of("layout-shift").emit([
      { startTime: 100, value: 0.05, hadRecentInput: false },
      { startTime: 400, value: 0.04, hadRecentInput: false },
      { startTime: 450, value: 0.5, hadRecentInput: true },
      { startTime: 9000, value: 0.03, hadRecentInput: false },
    ]);
    FakeObserver.of("event").emit([
      { interactionId: 1, duration: 80, startTime: 10 },
      { interactionId: 1, duration: 120, startTime: 10 },
      { interactionId: 2, duration: 600, startTime: 20 },
      { interactionId: 0, duration: 900, startTime: 30 },
    ]);
    expect(eventsOf("web-vital").map((event) => event.name)).toEqual(["FCP"]);

    setVisibility("hidden");
    const vitals = Object.fromEntries(eventsOf("web-vital").map((event) => [event.name, event]));
    expect(vitals.FCP).toMatchObject({ value: 2000, rating: "needs-improvement" });
    expect(vitals.LCP).toMatchObject({ value: 4500.5, rating: "poor" });
    expect(vitals.CLS).toMatchObject({ value: 0.09, rating: "good" });
    expect(vitals.INP).toMatchObject({ value: 600, rating: "poor" });
  });

  it("re-reports only changed values on later hide events and uses the load page view", () => {
    installPerformance();
    configureBrowserTelemetry({ enabled: true, sink, performance: { pageLoad: false }, pageViews: true });
    FakeObserver.of("largest-contentful-paint").emit([{ startTime: 1000 }]);
    setVisibility("hidden");
    setVisibility("visible");
    setVisibility("hidden");
    window.history.pushState({}, "", "/later");
    FakeObserver.of("largest-contentful-paint").emit([{ startTime: 1200 }]);
    setVisibility("hidden");

    const lcp = eventsOf("web-vital").filter((event) => event.name === "LCP");
    expect(lcp.map((event) => event.value)).toEqual([1000, 1200]);
    const [load, navigation] = eventsOf("pageview");
    expect(lcp.every((event) => event.pageViewId === load?.pageViewId)).toBe(true);
    expect(navigation?.pageViewId).not.toBe(load?.pageViewId);
  });

  it("emits vitals before document listeners that were registered earlier", () => {
    installPerformance();
    const seenByEarlierListener: string[][] = [];
    const earlier = (): void => void seenByEarlierListener.push(eventsOf("web-vital").map((event) => event.name));
    document.addEventListener("visibilitychange", earlier);
    configureBrowserTelemetry({ enabled: true, sink, performance: { pageLoad: false } });
    FakeObserver.of("largest-contentful-paint").emit([{ startTime: 1000 }]);

    setVisibility("hidden");
    document.removeEventListener("visibilitychange", earlier);
    expect(seenByEarlierListener).toHaveLength(1);
    expect(seenByEarlierListener[0]).toContain("LCP");
  });

  it("skips unsupported entry types and disconnects observers when reset", () => {
    installPerformance();
    FakeObserver.supportedEntryTypes = ["paint"];
    configureBrowserTelemetry({ enabled: true, sink, performance: { pageLoad: false } });
    expect(FakeObserver.instances.map((observer) => observer.type)).toEqual(["paint"]);

    configureBrowserTelemetry({ enabled: true, sink });
    expect(FakeObserver.instances.every((observer) => observer.disconnected)).toBe(true);
    setVisibility("hidden");
    expect(eventsOf("web-vital")).toHaveLength(0);
  });
});
