# React Telemetry Kit - Project Memory

Last updated: 2026-11-10

This is project-local memory, not a global preference or an automatically loaded
assistant memory. At the start of future work, read this file, `PLAN.md`, and
`CHECKLIST.md`. Explicitly point a new assistant session to this folder.

## Purpose and current state

Create a reusable installable function-tracing asset based on Mpower's existing
compile-time instrumentation.

Current state: standalone runtime, Vite transformer, and Application Insights
integration built and validated, including an independent consumer and a React
19 Power Apps code-app pilot installed from the archive. Authenticated Local
Play tracing and Azure ingestion are verified. Mpower remains unchanged. No
publication or deployment has occurred.

Local installable artifact: `react-telemetry-kit-0.1.0.tgz` in the project root.
The package remains `private: true`. No registry publication has occurred.

## Confirmed decisions

| Decision | Status/source |
| --- | --- |
| Folder/project name is `react-telemetry-kit`. | User selected, 2026-11-09. |
| Version 1 covers function tracing plus optional Application Insights initialization. | User confirmed, 2026-11-09. |
| Initial targets are Vite browser React apps, including Power Pages SPAs and Power Apps code apps. | User confirmed, 2026-11-09. |
| Distribution will be decided later. | User confirmed, 2026-11-09. |
| Reuse and generalize the existing project rather than redesign without reference to it. | User request, 2026-11-09. |
| End traces fire on function return/throw, preserving returned-promise identity. | User confirmed, 2026-11-09. |
| Parameter capture is off by default and requires an explicit allowlist. | User confirmed, 2026-11-09. |
| Privacy parameter redesign uses per-function transformations instead of global capture-all-except behavior. | Implemented and tested in the core runtime; code-app pilot remains parameter-off, 2026-11-10. |
| Include nested functions where behavior can be preserved; explicitly skip unsafe syntax. | User confirmed, 2026-11-09. |
| Build the standalone asset with tests after each piece. | User requested, 2026-11-09. |
| Mpower cannot be modified; use the comment-thread code app for the next local pilot. | User restriction and integration approval, 2026-11-09. |
| Azure pilot uses a locally ignored connection string; never store it in tracked files or project memory. | User supplied the connection string, 2026-11-10. |

## Package contract

- One package with `/vite`, `/runtime`, `/appinsights`, and an optional
  `/appinsights/initialize` entry point.
- A generic core with application-owned settings retrieval and optional host
  adapters, rather than a Power Pages dependency.
- Build and validate an isolated consumer before migrating Mpower.
- Do not migrate Mpower while it is off-limits; a different approved Power Pages
  app is required for that host pilot.
- Reuse an existing Application Insights instance where available.
- Parameter capture requires an allowlist, applies nested-key redaction, avoids
  invoking accessors, and is bounded.
- Runtime sampling selects function IDs deterministically. Each successful start
  is paired with an end even if configuration changes during the call.
- Runtime diagnostics report capture/sink failures without breaking app flow;
  sink reentrancy is suppressed.
- The core runtime is sink-agnostic. Application Insights is the packaged
  adapter; other backends require a consumer-provided `FunctionTraceSink`
  adapter.
- `parameterPolicy` supports safe per-function `omit`, `boolean`, `length`, and
  `summary` transformations. Matching policies avoid raw serialization and do
  not evaluate parameter providers for omitted functions. The legacy
  `allowedParameters` path remains for compatibility and is not the preferred
  new integration path.
- Function IDs use source-relative path, source position, and name; positions
  can change when source lines move.
- JS, JSX, TS, and TSX functions and nested callbacks are supported. Constructors,
  generators, direct-eval functions, and `use asm` functions are not wrapped;
  safe nested functions inside excluded bodies can still be wrapped.
- Build-time plugin exclusion is available for entire builds or selected files.
- The existing-client adapter does not initialize, flush, or unload the
  supplied SDK. Optional owned initialization disables unrelated automatic
  tracking, retries failures, buffers up to 100 traces by default, and exposes
  `ready`, `flush`, and `dispose`.
- Custom sinks dispatch synchronously; custom asynchronous work must handle its
  rejected promises. The Application Insights adapter uses synchronous
  `trackTrace` dispatch.

## Implemented structure and repeatable checks

- `src\vite.ts`: Vite plugin and build-time file controls.
- `src\internal\instrument.ts`: source-preserving AST-guided injection and maps.
- `src\runtime.ts`: runtime configuration, sampling, filtering, and lifecycle.
- `src\internal\capture-parameters.ts`: allowlisting and bounded redaction.
- `src\appinsights.ts`: existing-client adapter.
- `src\appinsights-initialize.ts`: optional package-owned SDK lifecycle.
- `tests`: 25 tests across runtime, transformation, Vite controls, and SDK adapters.
- `fixtures\react-vite`: independently installed React/Vite consumer with browser
  self-checks and real SDK lifecycle page.
- `scripts\benchmark.mjs`: preliminary generated-wrapper microbenchmark.

Run `npm run check` at the project root for type-check, lint, all tests, and build.
`npm pack` rebuilds automatically through `prepack`. Only `dist`, `src`, README,
and package metadata are included in the archive; planning memory and fixtures
are excluded.

After creating a new archive, install it in `fixtures\react-vite` and run
`npm run check` there. Reinstalling an updated same-version archive must also
refresh the fixture lockfile integrity.

## Verification evidence

On 2026-11-09:

- Root `npm run check` passed: type-check, lint, 25 tests in 5 files, and build.
- Final archive inspection: 32 files, 25,125 bytes.
- The final archive was installed in the independent consumer; compiled file
  hashes matched the current package build. Consumer `npm run check` passed.
- The production source map resolved a minified traced statement to original
  `src\main.tsx:15`. TypeScript compiler and MagicString were absent from
  browser bundles.
- The privacy policy implementation passed the full package gate and the packed
  React/Vite consumer check. Safe per-function `omit`, `boolean`, `length`, and
  `summary` rules avoid raw parameter values; the code-app pilot remains
  parameter-off.
- Headless Edge passed all 8 consumer checks: returned values, paired events,
  disabled tracing, build exclusions, source IDs, allowlisted parameters,
  nested functions, and React hook rendering/update.
- The separate `owned.html` page initialized, flushed, and disposed the real
  Application Insights SDK using a dummy local-only endpoint. This does not
  verify cloud ingestion.
- Read-only Mpower syntax scan: 259 files inspected, 212 transformed, no newly
  invalid files. This is not a full app integration or regression run.
- Local test preview stopped; temporary browser profiles and logs cleaned up.

Tested versions: Node 26.13.0, React/React DOM 18.3.1, Vite 7.3.7, TypeScript
5.9.3, Application Insights Web 3.4.6. Full declared-range coverage is pending.

Preliminary `npm run benchmark` results (Node, no-op sink, 200,000 calls/sample,
5 samples): median microseconds/call = 0.014 baseline, 0.023 disabled,
0.235 enabled without parameters, 0.630 with parameters. Fixture shared runtime
chunk = 6.61 kB / 2.60 kB gzip. These are measurements, not approved
browser/ingestion budgets; injected code and the optional SDK add further size.

Windows validation notes: Vite test temporary roots use `realpath` and explicit
filesystem allowlists to avoid short-path/canonical-path mismatches. Launch
headless Edge with `Start-Process -Wait` and redirected output; direct invocation
did not reliably capture DOM output. Use isolated temporary profiles and stop
the preview after testing.

The folder name does not guarantee npm name availability or determine registry
visibility. Do not publish under an assumed name or license.

## Power Apps code-app local pilot

Target relative to this project: `..\code app comment thread\my-app`.
The app's existing staged files were preserved; no files were staged or
committed by this integration.

- Added the archive dependency and lockfile entry, registered `functionTracing`
  alongside existing React/Power Apps plugins, and initialized the preview
  before React rendering.
- `src\telemetry.ts` enables named-function metadata and optional Azure export
  when Vite development mode and `VITE_FUNCTION_TRACE_ENABLED=true` apply. It
  explicitly turns off parameter capture, clears its allowlist, and rejects
  invalid flag values.
- Production builds disable the transformer. Development exclusions cover
  generated source, test/spec files, and telemetry setup; `.power` schemas are
  outside the selected source scope and remain untouched.
- Added five focused configuration/privacy cases and one actual instrumented
  React-render/update case to the existing integration tests.
- Installed runtime/Vite/transformer hashes match the current kit build.
- Baseline lint/build passed. The default 5-second timeout caused two existing
  UI tests to time out even when run alone; no assertions failed at a 20-second
  timeout. Keep `npm test -- --testTimeout=20000` for comparable validation
  rather than silently changing the app's test settings.
- Post-integration lint/build and all 45 tests passed at that timeout.
- Isolated Edge mounted the real app and recorded 2 paired automatic App calls,
  without parameters. The smoke harness blocked non-local/non-GET requests and
  did not interact with posting/deletion/sample-data controls.
- A production build with the preview flag set still contained no tracing
  markers. The pre-existing large-bundle warning remains (635.70 kB JS,
  182.03 kB gzip). The local server and temporary browser profile were removed.
- Actual versions: React/React DOM 19.3.1, Vite 7.3.7, TypeScript 5.9.3,
  Vitest 4.1.12, Power Apps Vite plugin 1.0.13, Node 26.13.0.
- The app README documents preview usage, validation, and Azure portal steps.
  The Azure pilot initializes the SDK only in development when explicitly
  enabled, targets named functions, and captures no parameters by default. A
  local-only `safe` policy switch now allows length/omit transformations for
  controlled testing; the connection string remains in an ignored local
  environment file.
- Final verification on 2026-11-10 passed lint, production build, and all 45
  tests. Authenticated Local Play initialized the SDK and showed named preview
  traces; toggling Dark theme on and back off was the only state change.
- The first Azure attempt showed `ERR_BLOCKED_BY_CLIENT` for the Application
  Insights ingestion endpoint and the OneCollector endpoint. After the browser
  ad blocker was removed, a read-only query returned 56 function-trace rows:
  28 starts, 28 ends, and 28 duration values. This verifies local-player
  ingestion; deployed-host connectivity/CSP remains unverified.
- A temporary parameter-capture experiment exported a user object to Azure,
  proving that raw values can be sensitive. The app configuration was restored
  to `includeParams: false`; no personal values are recorded in this memory.

Authenticated Local Play was verified in signed-in Edge on 2026-11-09:

- The real code app loaded its existing feed inside the Power Apps player.
- Dark theme changed from off to on and was restored to off.
- Nine matching start/end pairs were visible after the update, with matching
  invocation/function IDs and no parameters in the visible rows. An App render
  end was also observed. No comment/identity payload was copied into this memory.
- The initial `127.0.0.1` URL was rejected as `InvalidOrigin` / "appUrl is not a
  valid URL". Restarting with plain `npm run dev` and its generated `localhost`
  Local Play URL worked. Keep localhost for this player's preview.
- Sign-in was completed by the user. Do not store account details, session IDs,
  authentication URLs, or tokens in project documents.
- Player diagnostics also included a 403 and blocked collector requests. The
  app/feed/theme check succeeded, but this was not a clean-console certification
  or a diagnosis of those platform messages.
- No posting, deletion, sample-data creation, provisioning, or deployment was
  performed. The owned development server was stopped; port 3000 was confirmed
  no longer listening.

The rebuilt package archive was reinstalled into the code app on 2026-11-10.
Focused telemetry tests passed 14/14, lint passed, and the production build
passed. Authenticated Local Play rendered the React canvas after the Vite
server was restarted. A read-only Azure query returned 52 recent
function-trace rows, including four parameter-bearing rows whose only captured
value was `{"context":21}`; no identity or comment payloads appeared. The
local safe-policy switch was disabled again after verification.

Deployed-host connectivity/CSP remains pending. Actual Azure ingestion from the
approved local-player pilot is verified.
The user requested Azure as the final stage. Use a
non-production resource's full connection string from Application Insights
**Overview**, not just the instrumentation key. The current pilot does not read
Azure configuration from tracked files. Repeat delivery verification in an
approved browser/network that permits the ingestion endpoint; do not disable
security controls without approval. No provisioning, deployment, or live
Dataverse create/delete was performed.

## Source evidence and reuse context

Paths are relative to the original repository's
`Power-Platform\PowerPages\mpower-react` directory. Line references describe the
source inspected during planning and may move.

- `vite.config.ts:139`: custom Vite instrumentation plugin.
- `vite.config.ts:106`: constructs start-call plus try/finally end-call wrappers.
- `vite.config.ts:369`: plugin registered in the Vite pipeline.
- `src\telemetry\utils\functionLifecycleTrace.ts:231`: runtime configuration.
- `src\telemetry\utils\functionLifecycleTrace.ts:315`: start-trace emission.
- `src\telemetry\utils\functionLifecycleTrace.ts:333`: end-trace emission.
- `src\services\appinsights.ts:157`: existing SDK initialization implementation.
- `src\context\AppInsightsContext.tsx:119`: settings query/polling integration.
- `src\api\portal.ts:752`: app-specific function-trace setting definitions.
- `src\api\portal.ts:795`: settings refresh from Dataverse.

## Existing capabilities

- Source transformation before Vite's normal React processing.
- Start/end traces delivered through Application Insights.
- Runtime enablement, optional parameters, target-user filtering, function
  inclusion/exclusion, and deterministic function-level sampling.
- Authenticated settings refresh at five-minute intervals, without background
  tab polling, supplied by Mpower's application layer.

## Original-source differences and remaining limitations

Mpower's original transformer missed nested callbacks, emitted no source maps,
used ambiguous names, and serialized parameters without redaction. The new
package addresses these with nested traversal, mapped source edits,
source-position identifiers, and explicit allowlisting/redaction.

Intentional limitations remain: end means return/throw rather than promise
settlement; constructors/generators and other documented unsafe cases are
excluded; runtime-disabled wrappers still incur overhead; sampling selects
functions, not calls. Allowlisted values can still contain sensitive information
and require the consumer's approval.

Deployed Power Pages/code-app compatibility and Azure ingestion have not been
validated; authenticated Local Play console tracing is verified separately.
Cross-version compatibility, browser performance budgets,
redistribution rights, licensing, registry ownership, and release/publication
approval remain open.

## Scope guardrails

- Do not pull Mpower auth, business dimensions, role mappings, Dataverse schema,
  or React Query dependencies into the generic core.
- Do not include navigation/session/API/business telemetry in version 1.
- Do not silently change application results, thrown exceptions, or promise
  behavior to make tracing convenient.
- Do not emit user identifiers merely because they are used for targeting.
- Do not initialize a second SDK client when a consuming app supplies one.
- Respect consumer CSP and source-map publication policies.
- Do not modify Mpower; the user has said it is unavailable for integration.
- No publication or deployment without separate authorization.

## Next-session handoff

1. Read all three planning documents.
2. Keep Mpower unchanged; select a different approved Power Pages pilot project.
3. Authenticated code-app Local Play tracing is verified; retain the default
   localhost preview URL and preserve the existing staged work.
4. Leave Azure integration until the final stage; the app README explains how
   to get an approved non-production Application Insights connection string.
5. Agree on compatibility/performance gates and distribution/licensing before
   claiming production support or publishing.
6. Update the checklist and this memory with actual evidence and remaining work.
7. Keep the privacy parameter-policy API and tests aligned as the package
   evolves; do not enable raw parameter capture in the code-app pilot.

## Updating project memory

Record decisions as confirmed only after agreement. For completed work, record
changed components, commands and results, known limitations, and the next
concrete action. Keep failed attempts or blockers when useful to avoid
repeating them. Never store credentials, tokens, personal user identifiers, or
environment secrets in these documents.
