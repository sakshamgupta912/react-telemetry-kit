// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { configureBrowserTelemetry, resetBrowserTelemetry } from "../../src/browser.js";
import { configureFunctionTracing, resetFunctionTracing, traceFunctionEnd, traceFunctionStart } from "../../src/runtime.js";
import { events, eventsOf, sink, useBrowserTelemetryHooks } from "./helpers.js";

useBrowserTelemetryHooks();

function click(id: string): void {
  const button = document.createElement("button");
  button.setAttribute("data-telemetry-id", id);
  document.body.append(button);
  button.click();
}

describe("browser telemetry configuration", () => {
  it("captures nothing unless enabled and a sink is provided", () => {
    configureBrowserTelemetry({ sink, clicks: true });
    click("a");
    configureBrowserTelemetry({ enabled: true, clicks: true });
    click("b");
    expect(events).toHaveLength(0);

    configureBrowserTelemetry({ enabled: true, sink, clicks: true });
    click("c");
    expect(events).toHaveLength(1);
  });

  it("validates before applying and keeps the previous configuration on failure", () => {
    configureBrowserTelemetry({ enabled: true, sink, clicks: true });

    expect(() => configureBrowserTelemetry({ enabled: true, sink, sampleRate: 2 })).toThrow(RangeError);
    expect(() => configureBrowserTelemetry({ enabled: true, sink, errors: { maxEvents: 0 } })).toThrow(RangeError);
    expect(() => configureBrowserTelemetry({ enabled: true, sink, clicks: { attribute: "id" } })).toThrow("data-*");
    expect(() => configureBrowserTelemetry({ enabled: true, sink, apiCalls: { excludeUrls: ["a*b"] } })).toThrow("wildcards");
    expect(() => configureBrowserTelemetry({ enabled: true, sink, pageViews: { normalizePath: "x" as never } })).toThrow(TypeError);
    expect(() => configureBrowserTelemetry({ sink: {} as never })).toThrow("track function");
    expect(() => configureBrowserTelemetry({ sessionId: " " })).toThrow("sessionId");

    click("still-active");
    expect(eventsOf("click")).toHaveLength(1);
  });

  it("selects whole sessions deterministically with sampleRate", () => {
    configureBrowserTelemetry({ enabled: true, sink, clicks: true, sampleRate: 0 });
    click("a");
    expect(events).toHaveLength(0);

    const results = new Set<boolean>();
    for (let index = 0; index < 40; index++) {
      events.length = 0;
      configureBrowserTelemetry({ enabled: true, sink, clicks: true, sampleRate: 0.5, sessionId: `session-${index}` });
      click("a");
      const first = events.length === 1;
      events.length = 0;
      configureBrowserTelemetry({ enabled: true, sink, clicks: true, sampleRate: 0.5, sessionId: `session-${index}` });
      click("a");
      expect(events.length === 1).toBe(first);
      results.add(first);
    }
    expect(results.size).toBe(2);
  });

  it("shares one envelope across browser events and function traces", () => {
    configureBrowserTelemetry({ enabled: true, sink, sessionId: " custom-session ", clicks: true });
    configureFunctionTracing({ enabled: true, sink: { track: (trace) => events.push(trace) } });
    click("first");
    traceFunctionEnd(traceFunctionStart("src/a.ts:1:1:a", "a"));
    click("second");

    expect(events.map((event) => event.sessionId)).toEqual(Array(events.length).fill("custom-session"));
    expect(new Set(events.map((event) => event.pageViewId)).size).toBe(1);
    const sequences = events.map((event) => event.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(events.map((event) => event.type)).toEqual(["click", "function", "function", "click"]);
    resetFunctionTracing();
  });

  it("reports the installed package version on every event", () => {
    const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    configureBrowserTelemetry({ enabled: true, sink, clicks: true });
    click("a");
    expect(events[0]?.sdkVersion).toBe(version);
  });

  it("isolates sink failures and drops events created while a sink is running", () => {
    const onDiagnostic = vi.fn();
    const received: string[] = [];
    configureBrowserTelemetry({
      enabled: true,
      clicks: true,
      onDiagnostic,
      sink: {
        track(event) {
          received.push(event.type);
          if (received.length === 1) {
            click("created-inside-sink");
            throw new Error("sink failed");
          }
        },
      },
    });

    click("outer");
    click("after");
    expect(received).toEqual(["click", "click"]);
    expect(onDiagnostic).toHaveBeenCalledTimes(1);
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ code: "sink-failed" }));
  });

  it("restores every patched browser API when reset", () => {
    const history = { push: window.history.pushState, replace: window.history.replaceState };
    const fetchStub = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchStub);
    const xhr = { open: XMLHttpRequest.prototype.open, send: XMLHttpRequest.prototype.send };

    configureBrowserTelemetry({ enabled: true, sink, pageViews: true, apiCalls: true, errors: true, clicks: true });
    expect(window.history.pushState).not.toBe(history.push);
    expect(globalThis.fetch).not.toBe(fetchStub);
    expect(XMLHttpRequest.prototype.open).not.toBe(xhr.open);

    resetBrowserTelemetry();
    expect(window.history.pushState).toBe(history.push);
    expect(window.history.replaceState).toBe(history.replace);
    expect(globalThis.fetch).toBe(fetchStub);
    expect(XMLHttpRequest.prototype.open).toBe(xhr.open);
    expect(XMLHttpRequest.prototype.send).toBe(xhr.send);
  });
});
