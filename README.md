# React Telemetry Kit

A build-time function-tracing plugin and browser runtime for React/Vite apps.
The package emits backend-neutral trace records through a generic sink. It
does not include or depend on any telemetry vendor SDK; consumers can connect
Application Insights, OpenTelemetry, Datadog, New Relic, or any other backend.
An optional `react-telemetry-kit/browser` entry point adds privacy-first
page-view, uncaught-error, API-call, performance, and click events; see
[Browser telemetry](#browser-telemetry).

This package is private and not published. Power Pages and Power Apps code-app
hosted integration is locally validated; deployed-host connectivity and CSP
validation remain pending.

## Requirements

- Vite 4, 5, 6, 7, or 8 (the build-time function tracing plugin). Each major is
  tested: the plugin tests build and run instrumented code on all five, and
  `npm run check:vite-compat` installs the packed package into a fresh project
  for each one with no peer overrides, then builds, serves, and type-checks it.
- Node.js `^18.0.0 || ^20.0.0 || >=22.0.0`. Vite 7 and 8 themselves need Node
  20.19 or later, and that applies to your project, not to this package.
- A browser application using `.js`, `.jsx`, `.ts`, or `.tsx`
- React is expected for the primary use case, but the runtime is independent
  of React. The browser collectors (`react-telemetry-kit/browser`) do not need
  Vite and work with any bundler.

The package's development checks use TypeScript 5.9 and React 18. The Power
Apps pilot also validated React 19, and a fresh Vite 8, React 19, and
TypeScript 7 app was built and run in Chromium. Other versions require
compatibility testing.

## Quick start

Three small edits to a Vite React app. This sends everything to the browser
console; replace the sink with your own adapter for a real backend (see
[Bring your own adapter](#3-bring-your-own-adapter)).

1. Install:

   ```powershell
   npm install github:sakshamgupta912/react-telemetry-kit
   ```

2. Add the plugin before the React plugin in `vite.config.ts`:

   ```ts
   import { functionTracing } from "react-telemetry-kit/vite";

   export default defineConfig({
     plugins: [functionTracing(), react()],
   });
   ```

3. Create `src/telemetry.ts` and import it first in `src/main.tsx`
   (`import "./telemetry";`):

   ```ts
   import { configureBrowserTelemetry, type TelemetryEvent } from "react-telemetry-kit/browser";
   import { configureFunctionTracing } from "react-telemetry-kit/runtime";

   const sink = {
     track(event: TelemetryEvent) {
       console.log("[telemetry]", event);
     },
   };

   configureFunctionTracing({ enabled: true, sink });
   configureBrowserTelemetry({
     enabled: true,
     sink,
     errors: true,
     pageViews: true,
     performance: true,
     apiCalls: true,
     clicks: true,
   });
   ```

You then get function start/end traces for your own source files, page views
(including client-side navigation), uncaught errors, API call timing, page-load
timing, and Core Web Vitals. A few things are deliberate:

- Clicks are reported only for elements with a `data-telemetry-id` attribute.
- `LCP`, `CLS`, and `INP` are final only when the page is hidden, so they
  appear when the tab is hidden or closed, not during normal use. `INP` is
  reported only if an interaction took 40 ms or longer.
- Function tracing wraps every function in your source, which is noisy and has
  overhead. Narrow it with `targetFunctions`, `excludedFunctions`, or
  `sampleRate`, and enable it only where you need it.
- A real backend needs your adapter's endpoint excluded from `apiCalls`
  (`excludeUrls`) and normalized route paths (`normalizePath`) so IDs in URLs
  do not create a page per user.

## License

This project is released under the [MIT License](LICENSE).

## Continuous integration and releases

GitHub Actions runs `npm ci`, the full `npm run check` gate, and package-content
inspection for pushes and pull requests targeting `main` on Node.js 20 and 22.

Creating a version tag such as `v0.1.0` runs the same checks, packs the package,
and creates a GitHub Release containing the `.tgz` artifact. The package is
currently distributed from GitHub; npm registry publishing is not configured.

## Installation

```powershell
npm install github:sakshamgupta912/react-telemetry-kit
```

The repository's `prepare` script builds the package after Git installation.
The repository must be accessible to the consumer. Use the local archive
workflow below when developing the package from a local checkout.

Build and pack the local archive:

```powershell
npm install
npm run build
npm pack
```

Install the generated archive in a React/Vite consumer:

```powershell
npm install C:\path\to\react-telemetry-kit-0.2.0.tgz
```

The package installs `magic-string` and `typescript` automatically. The
consumer must provide Vite and any telemetry SDK used by its custom sink:

```powershell
npm install vite @vitejs/plugin-react
```

## Integration steps

### 1. Register the Vite plugin

Add the tracing plugin before the React plugin:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { functionTracing } from "react-telemetry-kit/vite";

export default defineConfig({
  plugins: [functionTracing(), react()],
});
```

Use `functionTracing({ enabled: false })` or an `include`/`exclude` predicate
to disable or narrow build-time instrumentation.

### 2. Configure a custom telemetry sink

The core runtime is not tied to Azure. A sink receives normalized
`FunctionTrace` records:

```ts
import { configureFunctionTracing } from "react-telemetry-kit/runtime";

configureFunctionTracing({
  enabled: import.meta.env.DEV,
  sink: {
    track(trace) {
      console.log(trace);
    },
  },
});
```

The same interface can be adapted to Application Insights, OpenTelemetry,
Datadog, New Relic, Splunk, an internal API, or another approved telemetry
system. The package deliberately does not provide vendor-specific adapters.
For example, an Application Insights adapter can be owned by the application:

```ts
import { configureFunctionTracing } from "react-telemetry-kit/runtime";

const appInsightsSink = {
  track(trace) {
    existingAppInsightsClient.trackTrace(
      { message: `Function ${trace.phase}: ${trace.functionName}` },
      {
        eventCategory: "function-trace",
        tracePhase: trace.phase,
        functionId: trace.functionId,
        functionName: trace.functionName,
        invocationId: trace.invocationId,
      },
    );
  },
};

configureFunctionTracing({
  enabled: true,
  sink: appInsightsSink,
  sampleRate: 1,
  targetFunctions: ["load*", "*src/features/*"],
  excludedFunctions: ["*Sensitive*"],
});
```

Initialize tracing before the React root is rendered:

```ts
// src/main.tsx
import "./telemetry";
```

### 3. Bring your own adapter

The package ships no vendor adapters and no vendor SDK. The sink is the only
integration surface, so your adapter owns:

- SDK setup, connection string or endpoint, and credentials. The package never
  sees them.
- Delivery: batching, retry, and flushing when the page is hidden
  (`navigator.sendBeacon`). Sinks run synchronously.
- Global context such as app name, version, environment, and user. Add it
  inside `track`.
- Avoiding feedback loops: exclude the backend's ingestion URL in
  `apiCalls.excludeUrls`, and exclude the adapter's own files from
  `functionTracing({ exclude })`.
- Avoiding duplicates: if the vendor SDK also collects page views, errors,
  fetch, or XHR automatically, enable each source on only one side.

Use `TelemetrySink` and `TelemetryEvent` from `react-telemetry-kit/browser`, or
`FunctionTraceSink` and `FunctionTrace` from `react-telemetry-kit/runtime`. One
`TelemetrySink` object can be passed to both `configureFunctionTracing` and
`configureBrowserTelemetry`.

### 4. Validate the integration

```powershell
npm run lint
npm run build
npm test
npm run dev
```

Confirm start/end traces in the browser console or the configured backend.

## Runtime controls

`configureFunctionTracing()` applies a partial configuration update:

- `enabled` defaults to `false`; `sink` defaults to `null`.
- `sampleRate` is between 0 and 1 and selects **functions deterministically**,
  not individual calls.
- `targetFunctions` and `excludedFunctions` match either function names or
  source-relative function IDs. Wildcards are supported at pattern edges.
- `targetUsers` and `currentUserIdentifiers` are matched case-insensitively.
  These identifiers are used for filtering, not automatically emitted.
- `includeParams` defaults to `false`. To enable it, supply a non-empty
  `allowedParameters` list. Built-in and `redactedKeys` filtering redacts
  sensitive property names; nested depth, property count, and output size are
  bounded. Accessors are not invoked during capture.
- `parameterPolicy` provides safer per-function transformations: `omit`,
  `boolean`, `length`, or `summary`. A matching policy takes precedence over
  the legacy `allowedParameters` capture path; unmatched functions may use the
  legacy allowlist. Prefer `parameterPolicy` for new integrations.
- `onDiagnostic` receives capture and sink failures. Without it, warnings are
  rate-limited in the console.

Custom sinks synchronously dispatch records. If a custom sink starts asynchronous
work, it must handle and report that work's rejected promises.

An allowlist and key-name redaction do not guarantee that data is non-sensitive:
only allow parameters approved for telemetry by your organization. Values in
allowlisted fields can contain personal or confidential information.

The safe policy path never emits raw parameter values. For example:

```ts
configureFunctionTracing({
  enabled: true,
  includeParams: true,
  parameterPolicy: {
    load: { context: "length" },
    findPeople: { query: "length", signal: "omit" },
    currentUser: "omit",
  },
});
```

`parameterPolicy` is deny-by-default for functions without a matching rule.
`summary` emits only structural metadata such as type, length, or property
count. It does not emit object field values. A global capture-all-except mode is
intentionally unsupported.

The application supplies settings and user context. For example, a Power Pages
app may poll Dataverse and call `configureFunctionTracing()` with the resulting
normalized values. This package does not fetch platform configuration.

## Trace semantics and limits

- Start/end traces are emitted for supported functions, including safe nested
  callbacks. The end trace means the function **returned or threw**; a returned
  promise may settle later. Returned promise identity is not changed.
- End traces carry `outcome` (`"returned"` or `"threw"`) and, for a throw,
  `errorType` (the error's name, never its message). The original thrown value
  is rethrown unchanged. For `async` functions the body runs inside the
  wrapper, so the end trace follows the awaited work and `threw` means the
  returned promise rejected. A non-`async` function that returns a promise
  still ends when it returns, and later rejection of that promise is not
  recorded: observing it would mark the promise as handled and hide real
  `unhandledrejection` signals.
- A successful start and its end use the same invocation ID and sink, even if
  runtime configuration changes during the call.
- IDs contain a source-relative path, line, column, and function name. Source
  edits can change positions. Avoid treating IDs as permanent across releases.
- Function declarations/expressions, arrow functions, methods, and accessors in
  `.js`, `.jsx`, `.ts`, and `.tsx` modules are eligible. Constructors,
  generators, functions containing direct `eval`, and `use asm` functions are
  skipped; safe nested functions inside them can still be instrumented.
- The Vite plugin skips dependencies, files outside the Vite root, declaration
  files, and virtual/query modules. `functionTracing({ enabled: false })`
  disables all injection; `include` and `exclude` predicates select files by
  their source-relative path.
- Runtime-disabled instrumentation still has wrapper/call overhead. Parameter
  values are not serialized on disabled or filtered paths.
- Source maps are generated; the consumer controls whether maps and source
  contents are published.
-   Traces before runtime configuration are not buffered.

For progress and outstanding hosted validation, see `CHECKLIST.md`.

## Browser telemetry

`react-telemetry-kit/browser` adds opt-in collectors that emit backend-neutral
events through a sink, like function tracing. Every collector is off until you
enable it. None reads request or response bodies, headers, input values,
visible text, URL query strings or fragments, or error messages.

```ts
import { configureBrowserTelemetry, type TelemetryEvent } from "react-telemetry-kit/browser";
import { configureFunctionTracing } from "react-telemetry-kit/runtime";

const sink = {
  track(event: TelemetryEvent) {
    // Switch on event.type and forward to your backend.
  },
};

configureFunctionTracing({ enabled: true, sink });
configureBrowserTelemetry({
  enabled: true,
  sink,
  errors: true,
  pageViews: { normalizePath: (path) => path.replace(/\/\d+/g, "/:id") },
  performance: true,
  apiCalls: { excludeUrls: ["https://ingest.example.com/*"] },
  clicks: true,
});
```

The same sink object can receive function traces and browser events. Call
`configureBrowserTelemetry()` before the React root renders. Each call
**replaces** the previous browser configuration (it is not a partial update),
and `resetBrowserTelemetry()` stops every collector and restores patched
browser APIs. Nothing runs outside a browser (`window` and `document` are
required), and `enabled` defaults to `false`.

### Event types

| Option | `type` | Contents | Limits |
| --- | --- | --- | --- |
| `pageViews` | `pageview` | `trigger` (`load`, `pushState`, `replaceState`, `popstate`, `hashchange`), `path`, `previousPath` | Path only. Emitted only when the path changes, so query or fragment changes are not page views. `normalizePath` maps IDs to route templates (`/users/:id`); a throwing normalizer drops the event. `includeHash: true` uses the route inside the fragment for hash routers. |
| `errors` | `error` | `source` (`window.onerror` or `unhandledrejection`), `errorType`, sanitized `filename`, `line`, `column` | Cannot see errors that code catches. Cross-origin script errors have no detail (`errorType: "unknown"`). `captureStack: true` adds frames only, without the message or URL query strings. At most `maxEvents` (default 100) per page load. Listeners never call `preventDefault`. |
| `performance` | `page-load`, `web-vital` | Navigation Timing phases; `FCP`, `LCP`, `CLS`, `INP`, `TTFB` with a `rating` | `pageLoad` and `webVitals` can be disabled separately. LCP, CLS, and INP are sent when the page is hidden, again only if the value changed. They describe the hard page load and carry its page-view ID. Support depends on the browser; unsupported entry types are skipped. Cross-origin timing detail needs `Timing-Allow-Origin`. |
| `apiCalls` | `api` | `transport` (`fetch` or `xhr`), `method`, `url` (origin plus path), `status`, `outcome` (`completed`, `network-error`, `aborted`, `timeout`), `errorType`, `durationMs` | Fetch duration ends when headers arrive, not when the body finishes. HTTP error statuses are `completed` with their `status`. Browser time does not include server internals. |
| `clicks` | `click` | `id`, `element` (tag name) | Only elements with `data-telemetry-id` (or a custom `data-*` attribute) and an ID matching `[A-Za-z0-9][A-Za-z0-9_.:/-]{0,99}`. A click does not mean the business action succeeded. |

Every event, including function traces, carries a shared envelope:
`timestamp`, `sessionId`, `pageViewId`, `sequence`, and `sdkVersion`.
`sequence` increases across all event types, `pageViewId` changes when
`pageViews` is enabled and the path changes, and API-call events keep the page
view that started the request. `sessionId` is generated in memory for each page
load and never stored; pass `sessionId` to reuse your own, which function
traces then also use. Correlation relies on these IDs and the sequence, not on
parent-child function relationships, because async call chains cannot be
reconstructed reliably in a browser.

### Volume and safety

- `sampleRate` (0 to 1) selects whole **sessions** deterministically from the
  session ID. Function tracing keeps its own per-function `sampleRate`.
- **Exclude your telemetry endpoint** from `apiCalls.excludeUrls`, for example
  `["https://ingest.example.com/*"]`. Otherwise the requests that deliver
  telemetry are themselves captured and sent, which creates a feedback loop (a
  test sink that flushes every 100 ms produced 20 to 23 self-referential API
  events in 1.5 seconds in every browser). Events created while a sink is
  running are dropped, but that cannot catch a sink that sends asynchronously.
  `navigator.sendBeacon` is not wrapped and needs no exclusion.
- **Exclude your telemetry setup and sink files from build-time
  instrumentation** (`functionTracing({ exclude })`). An instrumented flush
  timer generates function traces that feed back into the sink.
- Sinks run synchronously. A sink that throws is isolated and reported through
  `onDiagnostic`; an asynchronous sink must handle its own rejected promises.
- `fetch`, `XMLHttpRequest`, and `history.pushState`/`replaceState` are wrapped
  only while the matching collector is on. The wrappers forward arguments and
  results unchanged. For `fetch`, the returned promise is a new promise that
  settles exactly like the original and rethrows the original error.
- Events before `configureBrowserTelemetry()` is called are not buffered.
- If another library wraps the same browser API after this package, stopping
  leaves that library's wrapper in place and turns this package's wrapper into
  a pass-through.
- **Flush on page hide.** LCP, CLS, and INP are only final when the page is
  hidden, so they are emitted from `visibilitychange` and `pagehide` listeners
  that this package registers in the capture phase on `window`. They therefore
  run before a sink's ordinary `document` or `window` listeners, whichever side
  registered first. A sink that flushes on `visibilitychange` (with
  `navigator.sendBeacon`) receives them. On navigation away, browsers fire
  `pagehide` before `visibilitychange`. A sink that registers its own
  capture-phase listener on `window` first can still run ahead of this
  package.

### Browser support

Verified with the packed archive in a production Vite build, driven through
Playwright 1.64 against Chromium 156, Firefox 157, and WebKit 27.2. WebKit is
Safari's engine as built by Playwright on Windows; it is not Safari on macOS
or iOS, which has not been tested.

| Capability | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| Function outcomes, page views, errors, API calls (fetch and XHR), clicks | Yes | Yes | Yes |
| Navigation timing, `TTFB`, `FCP`, `LCP`, `INP` | Yes | Yes | Yes |
| `CLS` (needs the `layout-shift` entry type) | Yes | No | No |

A vital is emitted only when the browser supports its entry type, so an
unsupported vital is silently absent. Check
`PerformanceObserver.supportedEntryTypes` if you need to distinguish "good"
from "not measured".

### Measured cost

These are measurements, not approved budgets. Sizes are minified with esbuild.

| Bundle | Minified | Gzip | Brotli |
| --- | --- | --- | --- |
| `react-telemetry-kit/runtime` | 8.48 kB | 3.03 kB | 2.73 kB |
| `react-telemetry-kit/browser` | 13.28 kB | 5.05 kB | 4.54 kB |
| Both together | 20.17 kB | 7.02 kB | 6.32 kB |

All five collectors ship together: `configureBrowserTelemetry` imports each one
statically, so enabling only some does not reduce the bundle.

Per-operation cost with a no-op sink, collectors enabled minus disabled
(microseconds, median of 7 repetitions, Windows desktop):

| Operation | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| Click on an element with `data-telemetry-id` | +1.4 | +3.5 | +1.8 |
| Click on any other element | +0.8 | +2.2 | +1.2 |
| `fetch` call with an event emitted | +11 | +16 | +4 |
| `fetch` call to an excluded URL | +5 | +13 | +3 |
| `XMLHttpRequest` open, send, abort | +41 | +27 | +137 |
| History call that does not change the path | +0.9 | about +1 | +0.3 |
| `configureBrowserTelemetry` plus reset, all collectors | 37 per call | 50 per call | 40 per call |

The `XMLHttpRequest` row is noisy and measures the wrapper plus its event
listeners. All of these are small next to a real network request, but sinks
that serialize or send each event cost more than the package does.

Function tracing with a no-op sink, Node 26, median of 5 alternating rounds,
against the previous release:

| Scenario | Before (µs per call) | Now (µs per call) |
| --- | --- | --- |
| Tracing disabled | 0.046 | 0.035 |
| Enabled, no parameters | 0.319 | 0.479 |
| Enabled, with parameters | 0.879 | 1.325 |

The enabled path now builds the shared event envelope and adds a `catch` clause
that records failures. The disabled-path difference is run-to-run noise: an
earlier run measured +0.004. The parameters row varies by about 0.1 between runs.

## Development checks

`npm run check` runs type-check, lint, tests, and build. `npm pack` rebuilds the
library before creating the local archive. `npm run benchmark` measures generated
wrappers with a no-op sink; it is not a browser or ingestion performance budget.

`npm run check:vite-compat` packs the library and, for every Vite major in the
peer range, installs it into a fresh project with a plain `npm install` (so a
wrong peer range fails with `ERESOLVE`). It then runs a production build and the
bundle, the dev-server transform, and a type-check of `vite.config.ts`. Add
`--node "npx -y -p node@18 node" --majors 4,5,6` to run the build and dev server
under Node 18. CI runs both.

The independent consumer is in `fixtures\react-vite`. After packing the library,
run `npm install`, `npm run build`, and `npm run verify:build` in that folder.
Its main page reports the runtime and custom-sink integration checks. Its
`browser.html` page exercises every browser collector with a batching sink that
posts to a configurable endpoint (`?ingest=<url>`, `exclude=0` to disable the
endpoint exclusion, `flushFirst=1` for a visibility-only sink registered before
the collectors). `npm run verify:build` also checks that this page is built,
that the scenario is instrumented, and that the excluded sink file is not.
