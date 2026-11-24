# Changelog

## Unreleased

### Changed

- The `vite` peer dependency is now `^4.0.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 ||
  ^8.0.0`, so apps on Vite 4, 5, and 6 can install the package. The previous
  `^7.0.0 || ^8.0.0` range made `npm install` fail with `ERESOLVE` there. The
  plugin code did not change: it uses only the long-stable `enforce`,
  `configResolved`, and `transform` hooks.
- The Node engine range is now `^18.0.0 || ^20.0.0 || >=22.0.0` (it was
  `^20.19.0 || >=22.12.0`, which came from Vite 7). Vite 7 and 8 still need Node
  20.19 or later in your project.

### Added

- `npm run check:vite-compat`, run in CI. It installs the packed package into a
  fresh project for every Vite major in the peer range with no peer overrides,
  then checks a production build and the executed bundle, the dev-server
  transform, and a type-check of `vite.config.ts`. It can run the build and dev
  server under another Node (`--node`), which CI uses for Node 18.
- The plugin tests now run on Vite 4, 5, 6, 7, and 8, and a test fails if the
  peer range declares a Vite major that is not tested.

## 0.2.0 - 2026-11-24

This release adds opt-in browser telemetry and function failure outcomes, and
removes the bundled Application Insights adapter. It contains breaking changes
for 0.1.0 consumers; see **Migrating from 0.1.0**.

### Added

- **`react-telemetry-kit/browser`**: `configureBrowserTelemetry()` and
  `resetBrowserTelemetry()`. Every collector is off until enabled, and none
  reads bodies, headers, input values, visible text, URL query strings or
  fragments, or error messages.
  - `pageViews`: initial load and SPA navigation, path only, with an optional
    `normalizePath` and hash-route support.
  - `errors`: uncaught errors and unhandled rejections with a safe error
    category, sanitized file and position, an optional frames-only stack, and a
    per-page cap.
  - `performance`: navigation timing and `FCP`, `LCP`, `CLS`, `INP`, and `TTFB`
    with ratings. `CLS` is available in Chromium only.
  - `apiCalls`: `fetch` and `XMLHttpRequest` method, origin and path, status,
    outcome, and duration, with `excludeUrls` and `normalizeUrl`.
  - `clicks`: opt-in elements with a validated `data-telemetry-id` only.
  - Per-session `sampleRate`, an optional `sessionId`, and `onDiagnostic`.
- **Function failure outcomes**: end traces carry `outcome` (`returned` or
  `threw`) and, for a throw, `errorType`. The original error is rethrown
  unchanged. A rejected `async` function is recorded as `threw`.
- **Shared event envelope** on every event, including function traces:
  `timestamp`, `sessionId`, `pageViewId`, `sequence`, and `sdkVersion`.
- **Types**: `TelemetryEvent`, `TelemetrySink`, and one interface per event
  type, exported from `react-telemetry-kit/browser`.
- `traceFunctionFailure` is exported from `react-telemetry-kit/runtime` for the
  generated wrappers. Do not call it from application code.
- Page-hide vitals ordering: `LCP`, `CLS`, and `INP` are emitted from
  capture-phase `window` listeners, so a sink that flushes on `visibilitychange`
  receives them whichever side registered first.

### Changed

- The `vite` peer dependency is now `^7.0.0 || ^8.0.0`. A fresh `create-vite`
  app ships Vite 8, and `^7.0.0` made `npm install` fail with `ERESOLVE`
  there. The test suite now runs the plugin's dev-server transforms and a
  production build with both Vite 7.3 and Vite 8.3, executes the bundles, and
  type-checks the plugin against both versions' `Plugin` types.
- `FunctionTrace` now includes the envelope fields and `type: "function"`.
  Sinks that read the 0.1.0 fields keep working. Code that builds
  `FunctionTrace` objects, such as test doubles, must add the new fields.
- The generated wrapper now has a `catch` clause that records the failure and
  rethrows. Keep the Vite plugin and the runtime on the same package version,
  because 0.2.0 wrappers import `traceFunctionFailure`.
- Measured cost (Node 26, no-op sink): enabled tracing without parameters about
  0.31 to 0.48 microseconds per call; the disabled path is unchanged. The
  runtime bundle grew from 2.61 kB to 3.03 kB gzip. The browser entry is
  5.05 kB gzip. See the README for per-operation browser costs.

### Removed (breaking)

- The `react-telemetry-kit/appinsights` and
  `react-telemetry-kit/appinsights/initialize` entry points, and the optional
  peer dependency on `@microsoft/applicationinsights-web`. The package no
  longer ships any vendor adapter or SDK.

### Migrating from 0.1.0

If you imported the Application Insights entry points, move that code into your
application as a sink. A sink is an object with `track(event)`. The README
section "Bring your own adapter" lists what your adapter owns: SDK setup and the
connection string, batching and flush on page hide, global context, excluding
its own endpoint and files from capture, and avoiding duplicate collection when
the vendor SDK also auto-collects.

### Known limitations

- Verified in Chromium 156, Firefox 157, and WebKit 27.2 (Playwright's Windows
  build). Safari on macOS and iOS and real mobile browsers are untested.
- Delivery was tested only against a stand-in ingestion server, not a vendor
  backend. No `traceparent` propagation or parent/child spans are provided.
- Function tracing requires Vite 7 or 8. The browser collectors work with any
  bundler. Output is ESM only.
- No performance or size budgets have been agreed.
- The package remains `private: true` and is installed from GitHub or a local
  `.tgz`.

## 0.1.0 - 2026-11-10

Initial release: Vite function-tracing plugin, runtime with filtering,
sampling, and safe parameter capture, and an Application Insights adapter.
