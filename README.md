# React Telemetry Kit

A build-time function-tracing plugin and browser runtime for React/Vite apps.
The package emits backend-neutral trace records through a generic sink. It
includes an Application Insights adapter and can also send traces to a custom
backend, console logger, or another telemetry adapter. It does not depend on
Power Pages or Dataverse.

This package is private and not published. Power Pages and Power Apps code-app
hosted integration is locally validated; deployed-host connectivity and CSP
validation remain pending.

## Requirements

The initial supported environment is:

- Vite 7
- Node.js `^20.19.0 || >=22.12.0`
- A browser application using `.js`, `.jsx`, `.ts`, or `.tsx`
- React is expected for the primary use case, but the runtime is independent
  of React

The package's development checks use TypeScript 5.9, React 18, and
Application Insights Web 3.4. The Power Apps pilot also validated React 19.
Other versions require compatibility testing.

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
npm install C:\path\to\react-telemetry-kit-0.1.0.tgz
```

The package installs `magic-string` and `typescript` automatically. The
consumer must provide Vite. Install the optional Application Insights SDK only
when using the built-in Azure adapter or initializer:

```powershell
npm install vite @vitejs/plugin-react
npm install @microsoft/applicationinsights-web
```

`@microsoft/applicationinsights-web` is not required for custom sinks.

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

The same interface can be adapted to OpenTelemetry, Datadog, New Relic,
Splunk, an internal API, or another approved telemetry system. The package
does not provide those vendor adapters yet.

### 3. Use an existing Application Insights client

Initialize the application's existing SDK client as usual, then pass it to the
adapter:

```ts
import { createApplicationInsightsSink } from "react-telemetry-kit/appinsights";
import { configureFunctionTracing } from "react-telemetry-kit/runtime";

configureFunctionTracing({
  enabled: true,
  sink: createApplicationInsightsSink(existingAppInsightsClient),
  sampleRate: 1,
  targetFunctions: ["load*", "*src/features/*"],
  excludedFunctions: ["*Sensitive*"],
});
```

The adapter never initializes, flushes, reconfigures, or disposes the supplied
client. Reuse it instead of creating another SDK instance.

### 4. Or let the package initialize Application Insights

Use this only when the app does not already own an Application Insights client.
The connection string is browser-visible configuration, not a place for secrets.

```ts
import { initializeApplicationInsights } from "react-telemetry-kit/appinsights/initialize";
import { configureFunctionTracing } from "react-telemetry-kit/runtime";

const owned = initializeApplicationInsights({ connectionString });
configureFunctionTracing({ enabled: true, sink: owned.sink });
owned.ready.catch((error) => console.error("Telemetry initialization failed", error));

// During app shutdown, if lifecycle control is available:
await owned.flush();
await owned.dispose();
```

Store the connection string in an ignored environment file:

```env
VITE_APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=...;IngestionEndpoint=...
```

Initialize tracing before the React root is rendered:

```ts
// src/main.tsx
import "./telemetry";
```

Owned initialization disables automatic route, fetch/XHR, exception, and header
tracking. It retries initialization up to three times with exponential
backoff and buffers up to 100 traces while initializing. Buffer overflow,
replay, and initialization failures are surfaced through diagnostics.
`flush()` and `dispose()` return promises; delivery during page unload is
best-effort. The SDK and this package cannot guarantee network ingestion.

### 5. Validate the integration

```powershell
npm run lint
npm run build
npm test
npm run dev
```

Confirm start/end traces in the browser console or the configured backend.
For Application Insights, query:

```kusto
traces
| where timestamp > ago(30m)
| where tostring(customDimensions.eventCategory) == "function-trace"
| extend
    functionName = tostring(customDimensions.functionName),
    tracePhase = tostring(customDimensions.tracePhase),
    parameters = tostring(customDimensions.parameters)
| project timestamp, functionName, tracePhase, parameters
| order by timestamp desc
```

The authenticated Power Apps Local Play pilot has verified Azure ingestion.
Deployed-host connectivity, CSP behavior, and a separate Power Pages pilot
remain open validation gates.

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
- Traces before runtime configuration are not buffered. The optional initializer
  buffers only after its sink is passed to the runtime.

For progress and outstanding hosted validation, see `CHECKLIST.md`.

## Development checks

`npm run check` runs type-check, lint, tests, and build. `npm pack` rebuilds the
library before creating the local archive. `npm run benchmark` measures generated
wrappers with a no-op sink; it is not a browser or ingestion performance budget.

The independent consumer is in `fixtures\react-vite`. After packing the library,
run `npm install`, `npm run build`, and `npm run verify:build` in that folder.
Its main page reports eight runtime checks; `owned.html` exercises real SDK
initialization and disposal using a dummy local-only endpoint. Neither page
proves hosted Azure ingestion.
