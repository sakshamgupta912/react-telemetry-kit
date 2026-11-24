import type { TelemetryEnvelope } from "./events.js";
import { SDK_VERSION } from "./version.js";

export function randomId(): string {
  try {
    const randomUUID = globalThis.crypto?.randomUUID;
    if (typeof randomUUID === "function") return randomUUID.call(globalThis.crypto);
  } catch {
    // crypto.randomUUID is unavailable in insecure contexts.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

let sessionId = randomId();
let pageViewId = randomId();
let sequence = 0;

export function getSessionId(): string {
  return sessionId;
}

export function setSessionId(value: string): void {
  sessionId = value;
}

export function getPageViewId(): string {
  return pageViewId;
}

export function startPageView(): string {
  pageViewId = randomId();
  return pageViewId;
}

export function nextSequence(): number {
  return ++sequence;
}

export function createEnvelope(pageViewIdOverride?: string): TelemetryEnvelope {
  return {
    timestamp: Date.now(),
    sessionId,
    pageViewId: pageViewIdOverride ?? pageViewId,
    sequence: ++sequence,
    sdkVersion: SDK_VERSION,
  };
}

export function resetTelemetryContext(): void {
  sessionId = randomId();
  pageViewId = randomId();
  sequence = 0;
}
