import { startTelemetry, type TelemetryHandle } from "./telemetry-setup";

declare global {
  interface Window {
    __rtk?: {
      done: boolean;
      results: Record<string, unknown>;
      handle: TelemetryHandle;
      supportedEntryTypes: string[];
    };
  }
}

const params = new URLSearchParams(location.search);
const handle = startTelemetry({
  ingestUrl: params.get("ingest") ?? "/v2/track",
  excludeIngest: params.get("exclude") !== "0",
  flushFirst: params.get("flushFirst") === "1",
});
const results: Record<string, unknown> = {};

function succeed(): number {
  return 1;
}

function failing(): never {
  throw new TypeError("secret function message");
}

async function rejecting(): Promise<never> {
  await Promise.resolve();
  throw new RangeError("secret async message");
}

function request(url: string): Promise<number> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.addEventListener("loadend", () => resolve(xhr.status));
    xhr.open("GET", url);
    xhr.send();
  });
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function run(): Promise<void> {
  results.fetchOk = (await fetch("/api/ok?secret=1#frag")).status;
  results.fetchMissing = (await fetch("/api/missing")).status;
  try {
    await fetch("http://127.0.0.1:1/unreachable?secret=1");
  } catch (error) {
    results.fetchNetworkErrorIsTypeError = error instanceof TypeError;
  }
  const controller = new AbortController();
  const slow = fetch("/api/slow", { signal: controller.signal });
  controller.abort();
  try {
    await slow;
  } catch (error) {
    results.fetchAbortName = (error as DOMException).name;
  }
  results.xhrOk = await request("/api/ok?x=1");
  results.xhrNetworkError = await request("http://127.0.0.1:1/unreachable");

  history.pushState({}, "", "/products/42?utm=1#r");

  try {
    failing();
  } catch (error) {
    results.failingRethrown = error instanceof TypeError;
  }
  try {
    await rejecting();
  } catch (error) {
    results.rejectingRethrown = error instanceof RangeError;
  }
  results.succeed = succeed();

  document.getElementById("action")?.addEventListener("click", () => {
    const end = performance.now() + 90;
    while (performance.now() < end) {
      // Block the main thread so the click produces a measurable interaction.
    }
  });

  setTimeout(() => {
    throw new TypeError("secret uncaught message");
  }, 0);
  void Promise.reject(new RangeError("secret rejection message"));

  await pause(300);
  const late = document.createElement("div");
  late.style.height = "120px";
  late.textContent = "late content that shifts the page";
  document.body.prepend(late);
  await pause(200);

  window.__rtk = {
    done: true,
    results,
    handle,
    supportedEntryTypes: [...(PerformanceObserver.supportedEntryTypes ?? [])],
  };
}

void run();
