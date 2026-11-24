// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { configureBrowserTelemetry } from "../../src/browser.js";
import { eventsOf, sink, useBrowserTelemetryHooks } from "./helpers.js";

useBrowserTelemetryHooks();

function reject(reason: unknown): void {
  window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason }));
}

describe("uncaught error capture", () => {
  it("reports error category and sanitized location without the message", () => {
    configureBrowserTelemetry({ enabled: true, sink, errors: true });
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "card 4111111111111111 declined",
        filename: "https://cdn.example.com/app.js?token=secret#frag",
        lineno: 12,
        colno: 7,
        error: new TypeError("card 4111111111111111 declined"),
      }),
    );

    const [event] = eventsOf("error");
    expect(event).toMatchObject({
      type: "error",
      source: "window.onerror",
      errorType: "TypeError",
      filename: "https://cdn.example.com/app.js",
      line: 12,
      column: 7,
    });
    expect(event).not.toHaveProperty("stack");
    expect(JSON.stringify(event)).not.toMatch(/4111|secret|frag/);
  });

  it("reports opaque cross-origin errors and non-error rejections safely", () => {
    configureBrowserTelemetry({ enabled: true, sink, errors: true });
    window.dispatchEvent(new ErrorEvent("error", { message: "Script error.", error: null }));
    reject("private rejection reason");
    reject({ name: "Alice" });
    reject(new RangeError("private"));

    expect(eventsOf("error").map((event) => [event.source, event.errorType])).toEqual([
      ["window.onerror", "unknown"],
      ["unhandledrejection", "non-error"],
      ["unhandledrejection", "non-error"],
      ["unhandledrejection", "RangeError"],
    ]);
    expect(JSON.stringify(eventsOf("error"))).not.toMatch(/private|Alice/);
  });

  it("includes a sanitized stack only when requested", () => {
    const error = new Error("secret message");
    error.stack = "Error: secret message\n    at run (https://example.com/a.js?x=1:3:4)";
    configureBrowserTelemetry({ enabled: true, sink, errors: { captureStack: true } });
    window.dispatchEvent(new ErrorEvent("error", { error }));
    reject(error);

    for (const event of eventsOf("error")) {
      expect(event.stack).toBe("at run (https://example.com/a.js:3:4)");
    }
  });

  it("caps events per page load and reports the limit once", () => {
    const onDiagnostic = vi.fn();
    configureBrowserTelemetry({ enabled: true, sink, errors: { maxEvents: 2 }, onDiagnostic });
    for (let index = 0; index < 5; index++) reject(new Error("x"));

    expect(eventsOf("error")).toHaveLength(2);
    expect(onDiagnostic).toHaveBeenCalledTimes(1);
    expect(onDiagnostic).toHaveBeenCalledWith({ code: "event-limit-reached", feature: "errors" });
  });

  it("does not suppress the error for the page or other listeners", () => {
    configureBrowserTelemetry({ enabled: true, sink, errors: true });
    const other = vi.fn();
    window.addEventListener("error", other);
    const event = new ErrorEvent("error", { error: new Error("x"), cancelable: true });
    window.dispatchEvent(event);
    window.removeEventListener("error", other);

    expect(other).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("click capture", () => {
  function render(markup: string): void {
    document.body.innerHTML = markup;
  }

  it("captures only opted-in elements using stable identifiers", () => {
    configureBrowserTelemetry({ enabled: true, sink, clicks: true });
    render(`
      <button id="a" data-telemetry-id="checkout.submit">Pay $42 for Alice</button>
      <div data-telemetry-id="card/open"><span id="inner">Visible text</span></div>
      <button id="plain">Not tracked</button>
      <button id="bad" data-telemetry-id="Alice Smith, 555-0100">Bad id</button>
    `);
    for (const id of ["a", "inner", "plain", "bad"]) document.getElementById(id)?.click();

    expect(eventsOf("click").map(({ id, element }) => ({ id, element }))).toEqual([
      { id: "checkout.submit", element: "button" },
      { id: "card/open", element: "div" },
    ]);
    expect(JSON.stringify(eventsOf("click"))).not.toMatch(/Alice|\$42|Visible/);
  });

  it("supports a custom data attribute and sees clicks even if propagation is stopped", () => {
    configureBrowserTelemetry({ enabled: true, sink, clicks: { attribute: "data-track" } });
    render(`<button id="b" data-track="custom.id" data-telemetry-id="ignored">x</button>`);
    document.getElementById("b")?.addEventListener("click", (event) => event.stopPropagation());
    document.getElementById("b")?.click();

    expect(eventsOf("click").map((event) => event.id)).toEqual(["custom.id"]);
  });
});
