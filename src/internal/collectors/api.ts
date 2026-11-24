import { getPageViewId } from "../context.js";
import { matchesPattern, normalizePatterns } from "../patterns.js";
import { errorTypeOf, sanitizeUrl } from "../sanitize.js";
import type { ApiCallEvent } from "../events.js";
import { now, type CollectorContext, type StopCollector } from "./types.js";

export interface ApiCallOptions {
  /**
   * URL patterns (origin plus path, wildcards only at the edges) that are never captured.
   * Always exclude the telemetry backend's own ingestion endpoint to avoid feedback loops.
   */
  excludeUrls?: readonly string[];
  /** Maps a sanitized URL to a route template such as `/api/users/:id`. A throwing normalizer drops the event. */
  normalizeUrl?: (url: string) => string;
}

type ApiPayload = Omit<ApiCallEvent, "timestamp" | "sessionId" | "pageViewId" | "sequence" | "sdkVersion">;

interface RequestInfo {
  method: string;
  url: string;
}

export function normalizeApiOptions(options: ApiCallOptions): string[] {
  if (options.normalizeUrl !== undefined && typeof options.normalizeUrl !== "function") {
    throw new TypeError("apiCalls.normalizeUrl must be a function");
  }
  return normalizePatterns(options.excludeUrls ?? [], "apiCalls.excludeUrls");
}

export function startApiCapture(
  options: ApiCallOptions,
  context: CollectorContext,
): StopCollector {
  const excluded = normalizeApiOptions(options);
  const stops: StopCollector[] = [];
  let active = true;

  function describeRequest(method: string, rawUrl: string): RequestInfo | undefined {
    try {
      const sanitized = sanitizeUrl(rawUrl, window.location.href);
      if (sanitized === undefined || excluded.some((pattern) => matchesPattern(sanitized, pattern))) {
        return undefined;
      }
      const url = options.normalizeUrl ? options.normalizeUrl(sanitized) : sanitized;
      return { method: method.toUpperCase(), url };
    } catch (error) {
      context.diagnostic({ code: "normalizer-failed", feature: "apiCalls", error });
      return undefined;
    }
  }

  function record(
    transport: ApiCallEvent["transport"],
    info: RequestInfo,
    startedAt: number,
    pageViewId: string,
    result: Pick<ApiPayload, "outcome"> & { status?: number; errorType?: string },
  ): void {
    if (!active) return;
    try {
      const payload: ApiPayload = {
        type: "api",
        transport,
        method: info.method,
        url: info.url,
        outcome: result.outcome,
        durationMs: Math.max(0, now() - startedAt),
      };
      if (result.status !== undefined) payload.status = result.status;
      if (result.errorType !== undefined) payload.errorType = result.errorType;
      context.emit(payload, pageViewId);
    } catch (error) {
      context.diagnostic({ code: "collector-failed", feature: "apiCalls", error });
    }
  }

  if (typeof globalThis.fetch === "function") stops.push(patchFetch());
  else context.diagnostic({ code: "unsupported", feature: "apiCalls.fetch" });
  if (typeof XMLHttpRequest === "function") stops.push(patchXhr());
  else context.diagnostic({ code: "unsupported", feature: "apiCalls.xhr" });

  function patchFetch(): StopCollector {
    const original = globalThis.fetch;
    const wrapper = function (this: unknown, ...args: Parameters<typeof fetch>) {
      const startedAt = now();
      const pageViewId = getPageViewId();
      const promise = Reflect.apply(original, this, args) as Promise<Response>;
      if (!active) return promise;
      const [input, init] = args;
      let info: RequestInfo | undefined;
      try {
        const rawUrl =
          typeof input === "string" ? input : input instanceof URL ? input.href : String(input.url);
        const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
        info = describeRequest(method, rawUrl);
      } catch (error) {
        context.diagnostic({ code: "collector-failed", feature: "apiCalls", error });
      }
      if (!info) return promise;

      const requestInfo = info;
      return promise.then(
        (response) => {
          record("fetch", requestInfo, startedAt, pageViewId, { outcome: "completed", status: response.status });
          return response;
        },
        (error: unknown) => {
          const errorType = errorTypeOf(error);
          const outcome =
            errorType === "AbortError" ? "aborted" : errorType === "TimeoutError" ? "timeout" : "network-error";
          record("fetch", requestInfo, startedAt, pageViewId, { outcome, errorType });
          throw error;
        },
      );
    };
    globalThis.fetch = wrapper as typeof fetch;
    return () => {
      if (globalThis.fetch === wrapper) globalThis.fetch = original;
    };
  }

  function patchXhr(): StopCollector {
    const prototype = XMLHttpRequest.prototype;
    const originalOpen = prototype.open;
    const originalSend = prototype.send;
    const requests = new WeakMap<XMLHttpRequest, { method: string; url: string }>();

    const open = function (this: XMLHttpRequest, ...args: unknown[]) {
      try {
        requests.set(this, { method: String(args[0]), url: String(args[1]) });
      } catch {
        // A hostile toString must not break the request.
      }
      return Reflect.apply(originalOpen, this, args) as void;
    };
    const send = function (this: XMLHttpRequest, ...args: unknown[]) {
      const request = requests.get(this);
      if (active && request) {
        try {
          observe(this, request);
        } catch (error) {
          context.diagnostic({ code: "collector-failed", feature: "apiCalls", error });
        }
      }
      return Reflect.apply(originalSend, this, args) as void;
    };

    function observe(xhr: XMLHttpRequest, request: { method: string; url: string }): void {
      const info = describeRequest(request.method, request.url);
      if (!info) return;
      const startedAt = now();
      const pageViewId = getPageViewId();
      let outcome: ApiCallEvent["outcome"] | undefined;
      const onAbort = (): void => {
        outcome = "aborted";
      };
      const onError = (): void => {
        outcome = "network-error";
      };
      const onTimeout = (): void => {
        outcome = "timeout";
      };
      const onLoadEnd = (): void => {
        xhr.removeEventListener("abort", onAbort);
        xhr.removeEventListener("error", onError);
        xhr.removeEventListener("timeout", onTimeout);
        xhr.removeEventListener("loadend", onLoadEnd);
        const status = xhr.status > 0 ? xhr.status : undefined;
        record("xhr", info, startedAt, pageViewId, {
          outcome: outcome ?? (status === undefined ? "network-error" : "completed"),
          ...(status === undefined ? {} : { status }),
        });
      };
      xhr.addEventListener("abort", onAbort);
      xhr.addEventListener("error", onError);
      xhr.addEventListener("timeout", onTimeout);
      xhr.addEventListener("loadend", onLoadEnd);
    }

    prototype.open = open as typeof prototype.open;
    prototype.send = send as typeof prototype.send;
    return () => {
      if (prototype.open === open) prototype.open = originalOpen;
      if (prototype.send === send) prototype.send = originalSend;
    };
  }

  return () => {
    active = false;
    for (const stop of stops) stop();
  };
}
