// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { configureBrowserTelemetry, resetBrowserTelemetry } from "../../src/browser.js";
import { eventsOf, sink, useBrowserTelemetryHooks } from "./helpers.js";

useBrowserTelemetryHooks();

describe("page view capture", () => {
  it("emits the initial load and SPA navigations using path only", () => {
    window.history.replaceState(null, "", "/home?token=secret#section");
    configureBrowserTelemetry({ enabled: true, sink, pageViews: true });
    window.history.pushState({}, "", "/products/42?utm=ad&email=a@b.c#reviews");
    window.history.replaceState({}, "", "/products/43");

    expect(eventsOf("pageview").map(({ trigger, path, previousPath }) => ({ trigger, path, previousPath }))).toEqual([
      { trigger: "load", path: "/home", previousPath: undefined },
      { trigger: "pushState", path: "/products/42", previousPath: "/home" },
      { trigger: "replaceState", path: "/products/43", previousPath: "/products/42" },
    ]);
    expect(JSON.stringify(eventsOf("pageview"))).not.toMatch(/secret|utm|email|reviews|section/);
  });

  it("does not emit a page view when only the query string or fragment changes", () => {
    configureBrowserTelemetry({ enabled: true, sink, pageViews: true });
    window.history.replaceState({}, "", "/?tab=2");
    window.history.pushState({}, "", "/#details");
    expect(eventsOf("pageview")).toHaveLength(1);
  });

  it("assigns a new page view id on navigation and ties later events to it", () => {
    configureBrowserTelemetry({ enabled: true, sink, pageViews: true, clicks: true });
    const button = document.createElement("button");
    button.setAttribute("data-telemetry-id", "x");
    document.body.append(button);
    button.click();
    window.history.pushState({}, "", "/next");
    button.click();

    const [load, navigation] = eventsOf("pageview");
    const [before, after] = eventsOf("click");
    expect(load?.pageViewId).not.toBe(navigation?.pageViewId);
    expect(before?.pageViewId).toBe(load?.pageViewId);
    expect(after?.pageViewId).toBe(navigation?.pageViewId);
  });

  it("handles back navigation", async () => {
    configureBrowserTelemetry({ enabled: true, sink, pageViews: true });
    window.history.pushState({}, "", "/a");
    window.history.pushState({}, "", "/b");
    const popped = new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
    window.history.back();
    await popped;

    expect(eventsOf("pageview").at(-1)).toMatchObject({ trigger: "popstate", path: "/a", previousPath: "/b" });
  });

  it("captures hash routes only when includeHash is enabled", () => {
    configureBrowserTelemetry({ enabled: true, sink, pageViews: { includeHash: true } });
    window.location.hash = "#/users/7?tab=posts";
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(eventsOf("pageview").map((event) => event.path)).toEqual(["/", "/#/users/7"]);
    expect(eventsOf("pageview")[1]?.trigger).toBe("hashchange");
    expect(JSON.stringify(eventsOf("pageview"))).not.toContain("posts");
  });

  it("normalizes routes and drops events when the normalizer fails", () => {
    const onDiagnostic = vi.fn();
    const normalizePath = vi.fn((path: string) => {
      if (path === "/boom") throw new Error("bad");
      return path.replace(/\d+/g, ":id");
    });
    configureBrowserTelemetry({ enabled: true, sink, pageViews: { normalizePath }, onDiagnostic });
    window.history.pushState({}, "", "/users/42");
    window.history.pushState({}, "", "/boom");
    window.history.pushState({}, "", "/users/99");

    expect(eventsOf("pageview").map((event) => event.path)).toEqual(["/", "/users/:id"]);
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ code: "normalizer-failed" }));
  });

  it("does not repeat the load view when reconfigured, and keeps navigation working if the sink fails", () => {
    configureBrowserTelemetry({ enabled: true, sink, pageViews: true });
    configureBrowserTelemetry({ enabled: true, sink, pageViews: true });
    expect(eventsOf("pageview")).toHaveLength(1);

    resetBrowserTelemetry();
    const nativePush = window.history.pushState;
    configureBrowserTelemetry({
      enabled: true,
      sink: { track() { throw new Error("sink down"); } },
      pageViews: true,
      onDiagnostic: () => undefined,
    });
    expect(() => window.history.pushState({}, "", "/ok")).not.toThrow();
    expect(window.location.pathname).toBe("/ok");
    resetBrowserTelemetry();
    expect(window.history.pushState).toBe(nativePush);
  });

  it("leaves another library's later history patch in place when stopped", () => {
    configureBrowserTelemetry({ enabled: true, sink, pageViews: true });
    const other = vi.fn(window.history.pushState);
    window.history.pushState = other;
    resetBrowserTelemetry();

    expect(window.history.pushState).toBe(other);
    const before = eventsOf("pageview").length;
    window.history.pushState({}, "", "/after-stop");
    expect(eventsOf("pageview")).toHaveLength(before);
  });
});
