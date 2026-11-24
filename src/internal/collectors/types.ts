import type { BrowserEventPayload } from "../events.js";

export interface BrowserDiagnostic {
  code:
    | "sink-failed"
    | "collector-failed"
    | "unsupported"
    | "event-limit-reached"
    | "normalizer-failed";
  feature?: string;
  error?: unknown;
}

export interface CollectorContext {
  emit(payload: BrowserEventPayload, pageViewId?: string): void;
  diagnostic(diagnostic: BrowserDiagnostic): void;
}

export type StopCollector = () => void;

export function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
