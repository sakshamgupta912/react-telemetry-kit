// @vitest-environment jsdom
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { configureBrowserTelemetry } from "../../src/browser.js";
import { eventsOf, sink, useBrowserTelemetryHooks } from "./helpers.js";

useBrowserTelemetryHooks();

describe("fetch capture", () => {
  it("records method, sanitized URL, status, and duration without bodies or headers", async () => {
    const stub = vi.fn(async () => new Response("secret body", { status: 201 }));
    vi.stubGlobal("fetch", stub);
    configureBrowserTelemetry({ enabled: true, sink, apiCalls: true });

    const response = await fetch("/api/users/42?token=secret#frag", {
      method: "post",
      body: "secret request",
      headers: { authorization: "Bearer secret" },
    });

    expect(await response.text()).toBe("secret body");
    expect(stub).toHaveBeenCalledTimes(1);
    const [event] = eventsOf("api");
    expect(event).toMatchObject({
      transport: "fetch",
      method: "POST",
      url: "http://localhost:3000/api/users/42",
      status: 201,
      outcome: "completed",
    });
    expect(event?.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(event)).not.toMatch(/secret|frag/);
  });

  it("accepts URL and Request inputs and counts HTTP error statuses as completed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    configureBrowserTelemetry({ enabled: true, sink, apiCalls: true });

    await fetch(new URL("https://api.example.com/v1/items?x=1"));
    await fetch(new Request("https://api.example.com/v1/items", { method: "PUT" }));

    expect(eventsOf("api").map(({ method, url, status, outcome }) => ({ method, url, status, outcome }))).toEqual([
      { method: "GET", url: "https://api.example.com/v1/items", status: 500, outcome: "completed" },
      { method: "PUT", url: "https://api.example.com/v1/items", status: 500, outcome: "completed" },
    ]);
  });

  it("classifies failures and rethrows the original error", async () => {
    const failure = new TypeError("Failed to fetch");
    const abort = new DOMException("private", "AbortError");
    const timeout = new DOMException("private", "TimeoutError");
    const stub = vi.fn().mockRejectedValueOnce(failure).mockRejectedValueOnce(abort).mockRejectedValueOnce(timeout);
    vi.stubGlobal("fetch", stub);
    configureBrowserTelemetry({ enabled: true, sink, apiCalls: true });

    await expect(fetch("/a")).rejects.toBe(failure);
    await expect(fetch("/b")).rejects.toBe(abort);
    await expect(fetch("/c")).rejects.toBe(timeout);

    expect(eventsOf("api").map(({ outcome, errorType }) => ({ outcome, errorType }))).toEqual([
      { outcome: "network-error", errorType: "TypeError" },
      { outcome: "aborted", errorType: "AbortError" },
      { outcome: "timeout", errorType: "TimeoutError" },
    ]);
    expect(eventsOf("api")[0]).not.toHaveProperty("status");
  });

  it("excludes configured endpoints, normalizes URLs, and never loses the response on normalizer failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
    const onDiagnostic = vi.fn();
    configureBrowserTelemetry({
      enabled: true,
      sink,
      onDiagnostic,
      apiCalls: {
        excludeUrls: ["https://telemetry.example.com/*", "*/ingest"],
        normalizeUrl: (url) => {
          if (url.endsWith("/boom")) throw new Error("bad");
          return url.replace(/\/\d+/g, "/:id");
        },
      },
    });

    await fetch("https://telemetry.example.com/v2/track");
    await fetch("/ingest?batch=1");
    expect((await fetch("/boom")).ok).toBe(true);
    await fetch("/orders/17");

    expect(eventsOf("api").map((event) => event.url)).toEqual(["http://localhost:3000/orders/:id"]);
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ code: "normalizer-failed" }));
  });

  it("attributes a call to the page view that started it, even if navigation happens first", async () => {
    let release = (): void => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      release = () => resolve(new Response("ok"));
    })));
    configureBrowserTelemetry({ enabled: true, sink, pageViews: true, apiCalls: true });

    const pending = fetch("/slow");
    window.history.pushState({}, "", "/next");
    release();
    await pending;

    const [load, navigation] = eventsOf("pageview");
    const [call] = eventsOf("api");
    expect(call?.pageViewId).toBe(load?.pageViewId);
    expect(call?.pageViewId).not.toBe(navigation?.pageViewId);
  });

  it("does not report requests made after stopping", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
    configureBrowserTelemetry({ enabled: true, sink, apiCalls: true });
    const inFlight = fetch("/slow");
    configureBrowserTelemetry({ enabled: true, sink });
    await inFlight;
    await fetch("/after");
    expect(eventsOf("api")).toHaveLength(0);
  });
});

describe("XMLHttpRequest capture", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      response.setHeader("access-control-allow-origin", "*");
      if (request.url?.startsWith("/slow")) return;
      response.statusCode = request.url?.startsWith("/missing") ? 404 : 200;
      response.end("secret response");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function send(method: string, url: string, mutate?: (xhr: XMLHttpRequest) => void): Promise<XMLHttpRequest> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.addEventListener("loadend", () => resolve(xhr));
      xhr.open(method, url);
      mutate?.(xhr);
      xhr.send();
      if (url.includes("/slow")) setTimeout(() => xhr.abort(), 20);
    });
  }

  it("records completed requests with sanitized URLs and the real status", async () => {
    configureBrowserTelemetry({ enabled: true, sink, apiCalls: true });
    await send("get", `${base}/data?secret=1#x`);
    await send("GET", `${base}/missing`);

    expect(eventsOf("api").map(({ transport, method, url, status, outcome }) => ({ transport, method, url, status, outcome }))).toEqual([
      { transport: "xhr", method: "GET", url: `${base}/data`, status: 200, outcome: "completed" },
      { transport: "xhr", method: "GET", url: `${base}/missing`, status: 404, outcome: "completed" },
    ]);
    expect(JSON.stringify(eventsOf("api"))).not.toMatch(/secret/);
  });

  it("records network errors and aborts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    configureBrowserTelemetry({ enabled: true, sink, apiCalls: true });
    await send("GET", "http://127.0.0.1:1/unreachable");
    await send("GET", `${base}/slow`);

    expect(eventsOf("api").map(({ outcome, status }) => ({ outcome, status }))).toEqual([
      { outcome: "network-error", status: undefined },
      { outcome: "aborted", status: undefined },
    ]);
  });

  it("attributes an XHR to the page view that started it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    configureBrowserTelemetry({ enabled: true, sink, pageViews: true, apiCalls: true });
    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.addEventListener("loadend", () => {
        window.history.pushState({}, "", "/after-xhr");
        resolve();
      });
      xhr.open("GET", `${base}/data`);
      xhr.send();
    });

    const [load] = eventsOf("pageview");
    const [call] = eventsOf("api");
    expect(call?.pageViewId).toBe(load?.pageViewId);
  });

  it("honors exclusions and does not alter requests that were never opened through the patch", async () => {
    configureBrowserTelemetry({ enabled: true, sink, apiCalls: { excludeUrls: [`${base}/ingest*`] } });
    await send("POST", `${base}/ingest/batch`);
    expect(eventsOf("api")).toHaveLength(0);
    expect(() => new XMLHttpRequest().send()).toThrow();
  });
});
