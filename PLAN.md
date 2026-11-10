# React Telemetry Kit - Project Plan

Status: Standalone package and a React 19 Power Apps code-app pilot verified
locally and in authenticated Local Play. Local-player Azure ingestion is
verified; deployed-host pilots and release acceptance remain pending.
Last updated: 2026-11-10

## Objective

Extract the function-tracing capability demonstrated in Mpower into an
installable package for Vite-based browser React applications. Initial target
hosts are Power Pages SPAs and Power Apps code apps. Host support is a target,
not a verified claim.

The project name allows future telemetry features, but version 1 is limited to
function tracing plus optional Application Insights initialization.

## Agreed scope

- Build-time injection of function start/end tracking.
- Runtime enablement and configuration updates without rebuilding, provided
  instrumentation was included in the deployed build.
- Target-user filtering, function inclusion/exclusion, and deterministic
  function sampling.
- Optional, privacy-controlled parameter capture, disabled by default.
- Application Insights integration using an existing SDK client or optional
  package-owned initialization.
- TypeScript and supported JavaScript syntax in browser React/Vite projects.
- Package distribution and registry to be decided.

## Out of scope for version 1

- Navigation, session engagement, business events, API instrumentation, and
  Copilot-specific telemetry.
- Built-in authentication, Dataverse schemas, or mandatory React contexts.
- Webpack, Next.js/server rendering, React Native, and other build adapters.
- Automatic instrumentation of every possible function syntax.
- Provisioning Azure resources, publishing a package, or deploying a host app
  without explicit approval.

## Proposed architecture

One npm package with separate exported entry points:

```text
react-telemetry-kit (working package name; registry name availability unchecked)
  /vite          Build-time transformation
  /runtime       Configuration, filters, sampling, lifecycle emission
  /appinsights   Existing-client adapter and optional SDK initialization
```

The optional initializer is isolated at `/appinsights/initialize`, so the
existing-client adapter does not import the SDK at runtime.

The runtime is independent of React, Power Pages, and Power Apps APIs. Build
dependencies such as Vite and the compiler must not enter the browser runtime.
An app supplies configuration and optional normalized user context through a
generic API. An app-specific adapter may retrieve settings from Dataverse.

Consumers will install the package, register the Vite plugin, and initialize
the runtime. Installation alone cannot activate a build-time transform.

## Source reuse map

Source paths below are relative to the existing repository's
`Power-Platform\PowerPages\mpower-react` directory. That repository remains
unchanged until an explicitly authorized integration phase.

| Existing source | Reuse approach |
| --- | --- |
| `vite.config.ts` - `functionTraceInstrumentationPlugin()` | Extract the transformer into a configurable exported Vite plugin. |
| `src\telemetry\utils\functionLifecycleTrace.ts` | Reuse enablement, filtering, function sampling, and trace-emission concepts. |
| `src\services\appinsights.ts` | Adapt relevant initialization, queue/retry, and flush behavior; remove app-specific tags and policies. |
| `src\types\appinsights.ts` | Reuse relevant types without Mpower business dimensions. |
| `src\context\AppInsightsContext.tsx` | Integration reference only; do not copy auth, portal, or React Query dependencies into the core. |
| `src\api\portal.ts` - function-trace settings | Keep retrieval in the consuming app; pass normalized settings into the runtime. |

## Design contract

- Stable function identity: source-relative file plus function identity,
  disambiguating repeated names and excluding absolute machine paths.
- End traces fire when the function returns or throws, not when a returned
  promise settles. Preserve return values, promise identity, and rejection
  behavior rather than adding an unconditional await.
- Include nested functions where behavior can be preserved; document the tested
  syntax matrix and explicitly exclude unsafe constructs.
- Preserve directives, lexical this, arguments, super behavior, and valid hook
  usage. Prevent generated identifier/import collisions and self-instrumentation.
- Parameter capture is off by default. When enabled, only explicitly
  allowlisted parameters are captured, with redaction and bounded serialization.
  Do not serialize parameters while tracing is disabled or filtered out.
- Sampling means deterministic selection of functions, not a random percentage
  of invocations. Define paired start/end behavior when settings change mid-call.
- Define a generic telemetry sink and normalized configuration interface.
  Keep user identifiers used for filtering out of emitted telemetry by default.
- Reuse an existing SDK client without creating, reconfiguring, or disposing it.
  Define initialization, buffering, flushing, and disposal for package-owned
  clients separately.
- Bound buffering and diagnostics. Telemetry failures must not change app
  results or exceptions, and must not disappear without a diagnostic route.
- Generate correct source maps; consumers control production map publication.
- Make build-time exclusion possible so disabled instrumentation can be removed
  entirely. Measure residual overhead when runtime tracing is disabled.

## Privacy parameter policy specification

This specification replaces the idea of globally capturing every parameter
except a denylist. It is implemented in the core runtime; the app pilot still
keeps `includeParams: false`.

### Goal

Allow a consumer to obtain useful diagnostics from selected function
parameters without exporting raw application, identity, comment, or request
data by default.

### Policy layers

1. **Function selection** decides whether a function produces traces at all.
   `targetFunctions` is the primary allowlist; `excludedFunctions` is the
   explicit safety override.
2. **Parameter mode** decides whether argument values may be inspected.
   The default is off. When off, the generated lazy parameter callback must
   not be evaluated.
3. **Per-function parameter rules** decide how each approved parameter is
   represented. Rules are explicit rather than global capture-all behavior.
4. **Nested redaction and bounds** apply after the rule, before a sink receives
   the trace. Sensitive keys, accessors, depth, property count, and serialized
   size remain bounded.

### Supported representation rules

The implemented v1 rules are:

- `omit`: do not include the parameter.
- `boolean`: emit only whether a value is present.
- `length`: emit only a bounded string/array/object size.
- `summary`: emit a documented, consumer-approved structural summary; never
  include arbitrary text or identity fields.
- `hash`: deferred unless a consumer supplies an approved keyed/stable hashing
  strategy. An unsalted browser hash is not considered privacy protection.

### Proposed configuration shape

```ts
configureFunctionTracing({
  includeParams: true,
  parameterPolicy: {
    load: { context: "summary" },
    findPeople: { query: "length", signal: "omit" },
    currentUser: "omit",
    create: "omit",
  },
});
```

The public types and summary vocabulary are implemented and covered by focused
tests. Function exclusion remains available when even metadata about a function
is not appropriate. A global `captureAllExcept` mode is intentionally not part
of the API because newly added parameters could silently become telemetry
later.

### Privacy acceptance criteria

- Default configuration emits no parameter field.
- Disabled, filtered, sampled-out, or excluded functions never evaluate
  parameter providers.
- Raw comment text, user objects, credentials, tokens, and request payloads do
  not reach any sink under the approved rules.
- Rules are tested per function and per parameter, including nested objects.
- Redaction and size limits are applied before console or Azure export.
- Invalid policies fail explicitly; they do not silently fall back to raw
  capture.
- Documentation clearly distinguishes function selection from parameter policy.

## Delivery phases

### Phase 1 - Finalize the contract

Record the supported syntax, async semantics, trace schema, configuration,
dependency compatibility, SDK ownership, and privacy defaults. Resolve remaining
behavioral decisions before implementing the transformer.

Exit: a concrete, testable version 1 contract.

### Phase 2 - Standalone package

Create the package in this folder. Extract the transformer and runtime with
typed interfaces and focused tests. Do not import from Mpower or copy its
business configuration. Add the Application Insights adapter and optional
initializer.

Exit: package type-check, lint, focused tests, build, and package creation pass.

### Phase 3 - Isolated consumer

Install the locally packed package into a separate React/Vite fixture. Verify
exports, browser dependency boundaries, transformation, source maps,
configuration updates, and telemetry integration. A successful package build
alone is insufficient.

Exit: independent consumer builds and demonstrates the tracing contract.

### Phase 4 - Power Pages pilot (Mpower unavailable)

Mpower cannot be modified, per the user's instruction. Select another approved
Power Pages project before this phase can proceed. Integrate only function
tracing, reuse an existing Application Insights client where available, and
preserve application-owned settings and non-function telemetry.

Exit: tracing is verified in the Power Pages SPA, with regression evidence.

### Phase 5 - Power Apps code app validation

Use an approved code-app project/environment. Verify its actual build pipeline,
initialization, hosted network/CSP constraints, and telemetry delivery.

Exit: a hosted code-app trace is observed; compatibility restrictions are
documented. Do not infer this from local Vite success.

Local pilot target: `..\code app comment thread\my-app`. The installed archive
works with React 19.3.1, Vite 7.3.7, and Power Apps Vite plugin 1.0.13 in local
tests and headless Edge. The opt-in console preview captures no parameters and
is excluded from production instrumentation. No Azure resource or connection
string is needed until the final ingestion stage, as requested by the user.
Authenticated Local Play also loaded the existing feed and emitted paired
metadata-only traces while Dark theme was toggled and restored. After the
browser ad blocker was removed, the read-only Application Insights query
returned 56 function-trace rows. Keep the default `localhost` preview URL; the
numeric loopback URL was rejected by the player as `InvalidOrigin`.
Deployed-host connectivity/CSP remains unverified; no deployment or live
Dataverse mutation was performed.

### Phase 6 - Distribution readiness

Select the package scope/name, registry, ownership, license, and release process.
Provide installation examples, compatibility guidance, privacy guidance, and
versioning. Inspect package contents before any approved publication.

Exit: release checklist passes and publishing is separately authorized.

## Verification strategy

- Transformer fixtures test supported syntax and declared exclusions.
- Execute original and transformed fixtures to compare values, side effects,
  thrown errors, promises, and relevant React behavior.
- Test paired lifecycle events, configuration changes, filters, sampling,
  redaction, bounded serialization, and telemetry-sink failures.
- Test existing-client reuse and package-owned initialization separately.
- Run type-check, lint, tests, build, and package inspection.
- Install the packed artifact into a clean consumer and build it.
- Measure representative bundle size and enabled/disabled tracing overhead.
  Agree on budgets before declaring performance acceptance.
- Verify actual telemetry ingestion from both target hosted environments.

## Working rules

Use `CHECKLIST.md` to track progress and verification evidence. Use
`PROJECT_MEMORY.md` for durable project decisions, known limitations, and the
next-session handoff. Keep all three files consistent as scope changes.

Do not treat unchecked acceptance criteria as complete. Implementation of the
standalone package is authorized; publishing, deployment, and changes to the
source repository still require separate approval.
