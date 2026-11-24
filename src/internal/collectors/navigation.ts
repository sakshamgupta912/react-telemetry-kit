import { getPageViewId, startPageView } from "../context.js";
import type { PageViewEvent } from "../events.js";
import type { CollectorContext, StopCollector } from "./types.js";

export interface PageViewOptions {
  /** Use the route inside the URL fragment (hash routing). The fragment is otherwise never captured. */
  includeHash?: boolean;
  /** Maps a path to a route template such as `/users/:id`. A throwing normalizer drops the event. */
  normalizePath?: (path: string) => string;
}

type PageViewPayload = Omit<PageViewEvent, "timestamp" | "sessionId" | "pageViewId" | "sequence" | "sdkVersion">;

let lastEmittedPageViewId: string | undefined;

export function resetPageViewState(): void {
  lastEmittedPageViewId = undefined;
}

function readPath(includeHash: boolean): string {
  const { pathname, hash } = window.location;
  if (!includeHash) return pathname;
  const route = hash.slice(1).split("?")[0] ?? "";
  return route ? `${pathname}#${route}` : pathname;
}

export function startPageViewCapture(
  options: PageViewOptions,
  context: CollectorContext,
): StopCollector {
  const includeHash = options.includeHash === true;
  let active = true;
  let currentPath: string | undefined;

  function resolvePath(): string | undefined {
    const path = readPath(includeHash);
    if (!options.normalizePath) return path;
    try {
      return options.normalizePath(path);
    } catch (error) {
      context.diagnostic({ code: "normalizer-failed", feature: "pageViews", error });
      return undefined;
    }
  }

  function record(trigger: PageViewEvent["trigger"]): void {
    if (!active) return;
    try {
      const path = resolvePath();
      if (path === undefined || path === currentPath) return;
      const previousPath = currentPath;
      currentPath = path;
      startPageView();
      const payload: PageViewPayload = { type: "pageview", trigger, path };
      if (previousPath !== undefined) payload.previousPath = previousPath;
      context.emit(payload);
    } catch (error) {
      context.diagnostic({ code: "collector-failed", feature: "pageViews", error });
    }
  }

  const initialPath = resolvePath();
  if (initialPath !== undefined) {
    currentPath = initialPath;
    const pageViewId = getPageViewId();
    if (lastEmittedPageViewId !== pageViewId) {
      lastEmittedPageViewId = pageViewId;
      context.emit({ type: "pageview", trigger: "load", path: initialPath }, pageViewId);
    }
  }

  const restorers = [
    patchHistoryMethod("pushState", () => record("pushState"), context),
    patchHistoryMethod("replaceState", () => record("replaceState"), context),
  ];
  const onPopState = (): void => record("popstate");
  const onHashChange = (): void => record("hashchange");
  window.addEventListener("popstate", onPopState);
  if (includeHash) window.addEventListener("hashchange", onHashChange);

  return () => {
    active = false;
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener("hashchange", onHashChange);
    for (const restore of restorers) restore();
  };
}

function patchHistoryMethod(
  name: "pushState" | "replaceState",
  onCall: () => void,
  context: CollectorContext,
): () => void {
  const original = window.history[name];
  let active = true;
  const wrapper = function (this: History, ...args: Parameters<History["pushState"]>): void {
    const result = Reflect.apply(original, this, args) as void;
    if (active) {
      try {
        onCall();
      } catch (error) {
        context.diagnostic({ code: "collector-failed", feature: "pageViews", error });
      }
    }
    return result;
  };
  window.history[name] = wrapper;
  return () => {
    active = false;
    if (window.history[name] === wrapper) window.history[name] = original;
  };
}
