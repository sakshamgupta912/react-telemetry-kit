export interface TelemetryEnvelope {
  /** Epoch milliseconds when the event was created. */
  timestamp: number;
  /** In-memory identifier for this page load, unless the application supplies one. */
  sessionId: string;
  /** Identifier of the current page view; changes on SPA navigation when page-view capture is on. */
  pageViewId: string;
  /** Monotonic counter shared by every event emitted by this package. */
  sequence: number;
  sdkVersion: string;
}

export interface FunctionTrace extends TelemetryEnvelope {
  type: "function";
  phase: "start" | "end";
  functionId: string;
  functionName: string;
  invocationId: string;
  parameters?: string;
  durationMs?: number;
  /** End events only. `threw` means the function body threw (or an async body rejected). */
  outcome?: "returned" | "threw";
  /** End events only, when `outcome` is `threw`. Never contains the error message. */
  errorType?: string;
}

export interface PageViewEvent extends TelemetryEnvelope {
  type: "pageview";
  trigger: "load" | "pushState" | "replaceState" | "popstate" | "hashchange";
  path: string;
  previousPath?: string;
}

export interface UncaughtErrorEvent extends TelemetryEnvelope {
  type: "error";
  source: "window.onerror" | "unhandledrejection";
  errorType: string;
  filename?: string;
  line?: number;
  column?: number;
  stack?: string;
}

export interface ApiCallEvent extends TelemetryEnvelope {
  type: "api";
  transport: "fetch" | "xhr";
  method: string;
  /** Origin plus path. Query strings, fragments, and credentials are never included. */
  url: string;
  status?: number;
  outcome: "completed" | "network-error" | "aborted" | "timeout";
  errorType?: string;
  durationMs: number;
}

export interface PageLoadEvent extends TelemetryEnvelope {
  type: "page-load";
  navigationType?: string;
  redirectMs: number;
  dnsMs: number;
  connectMs: number;
  ttfbMs: number;
  responseMs: number;
  domInteractiveMs: number;
  domContentLoadedMs: number;
  loadMs: number;
  transferSize?: number;
}

export interface WebVitalEvent extends TelemetryEnvelope {
  type: "web-vital";
  name: "FCP" | "LCP" | "CLS" | "INP" | "TTFB";
  value: number;
  rating: "good" | "needs-improvement" | "poor";
}

export interface ClickEvent extends TelemetryEnvelope {
  type: "click";
  id: string;
  element: string;
}

export type BrowserTelemetryEvent =
  | PageViewEvent
  | UncaughtErrorEvent
  | ApiCallEvent
  | PageLoadEvent
  | WebVitalEvent
  | ClickEvent;

export type TelemetryEvent = FunctionTrace | BrowserTelemetryEvent;

export interface TelemetrySink {
  track(event: TelemetryEvent): void;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type BrowserEventPayload = DistributiveOmit<
  BrowserTelemetryEvent,
  keyof TelemetryEnvelope
>;
