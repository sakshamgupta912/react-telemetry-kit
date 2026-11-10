# React Telemetry Kit - Progress Checklist

Last updated: 2026-11-10
Current phase: Standalone package and React 19 code-app local/authenticated
preview validated; Azure ingestion and privacy parameter-policy core
implementation verified; deployed-host pilots and release acceptance remain
pending.

Check an item only when its deliverable exists and its acceptance evidence is
recorded. For blocked work, leave it unchecked and record the blocker below.

## Planning baseline

- [x] Select project folder name: `react-telemetry-kit`.
- [x] Agree on version 1: function tracing plus optional Application Insights initialization.
- [x] Select initial targets: browser React/Vite, Power Pages SPAs, Power Apps code apps.
- [x] Identify the Mpower source components available for reuse.
- [x] Record architecture proposal, delivery phases, and verification gates.
- [x] Create project-local memory and progress tracking documents.

Evidence: decisions confirmed in the planning conversation on 2026-11-09;
existing source inspected; `PLAN.md` and `PROJECT_MEMORY.md` contain the baseline.

## Phase 1 - Contract

- [x] Confirm package entry points and generic sink/configuration interfaces.
- [x] Finalize stable function identifiers and lifecycle trace schema.
- [x] Decide async end semantics without silently changing program behavior.
- [x] Define supported syntax, nested coverage, and explicit exclusions.
- [x] Define sampling and start/end pairing across runtime configuration changes.
- [x] Define parameter allowlisting, redaction, limits, and diagnostic behavior.
- [x] Record the pre-implementation privacy parameter-policy specification.
- [x] Define Application Insights ownership, queueing, retry, flush, and disposal.
- [ ] Select and verify Node, React, Vite, TypeScript, and SDK compatibility ranges.
- [ ] Agree on measurable performance and bundle-size budgets.
- [x] Record approved contract decisions in project memory.

## Phase 2 - Package implementation

Depends on Phase 1's tracing contract. Cross-version compatibility and approved
performance budgets remain release gates.

- [x] Scaffold a standalone typed package with separate browser/build entry points.
- [x] Extract and harden the Vite transformer.
- [x] Preserve directives and source maps; prevent generated-name collisions.
- [x] Implement the platform-independent runtime and runtime settings updates.
- [x] Implement disabled-path behavior, filters, and deterministic function sampling.
- [x] Implement opt-in safe parameter capture.
- [x] Implement the approved per-function privacy parameter-policy specification.
- [x] Add the existing-client Application Insights adapter.
- [x] Add optional package-owned SDK initialization and lifecycle handling.
- [x] Add focused transformation, runtime, and SDK integration tests.
- [x] Run type-check, lint, tests, and package build; record results.

## Phase 3 - Independent consumer

Depends on Phase 2.

- [x] Create a separate React/Vite fixture without Mpower dependencies.
- [x] Produce a package archive and inspect included files.
- [x] Install the archive into the fixture; verify public exports and types.
- [x] Build and run the fixture with tracing enabled and disabled.
- [x] Verify runtime updates, filtering, parameter controls, and source maps.
- [x] Compare transformed/original behavior and test telemetry failures.
- [x] Verify existing SDK reuse does not create duplicate initialization.
- [x] Record preliminary bundle size and Node wrapper overhead measurements.
- [ ] Measure bundle size and tracing overhead against agreed budgets.
- [x] Record local end-to-end adapter evidence and remaining hosted limitations.

## Phase 4 - Power Pages pilot (Mpower unavailable)

Depends on Phase 3 and explicit approval to modify/integrate the source app.
Mpower is off-limits per the user; select a different approved Power Pages app.

- [ ] Select an approved alternative app and capture relevant baseline checks.
- [ ] Integrate only the function-tracing plugin/helper.
- [ ] Retain existing SDK instance and application-owned settings/polling behavior.
- [ ] Verify no duplicate instrumentation or package telemetry recursion.
- [ ] Verify actual Power Pages telemetry ingestion.
- [ ] Check existing navigation, session, API, and business telemetry for regressions.
- [ ] Record results and rollback instructions.

## Phase 5 - Power Apps code app

Depends on Phase 3 and access/approval for a target app/environment.
Can proceed independently of Phase 4.

- [x] Identify and verify the target template and build pipeline.
- [x] Integrate the package without Power Pages-specific dependencies.
- [x] Verify local build and runtime configuration.
- [x] Verify authenticated Local Play behavior.
- [x] Wire an approved Application Insights sink/connection string for final-stage testing.
- [ ] Verify hosted telemetry connectivity and applicable CSP/network restrictions.
- [ ] Observe function traces in Application Insights from the deployed code app.
- [x] Record local/authenticated-preview evidence and restrictions; deployed-host gates remain open.

Target: `..\code app comment thread\my-app`, approved for local integration.
Preview and Azure export are opt-in, development-only, named-function-only, and
capture no parameters by default.
The SDK initialized in authenticated Local Play. After the browser ad blocker
was removed, Application Insights returned 56 function-trace rows (28 start
and 28 end events), including duration fields. Deployed-host connectivity/CSP
remains open.
No provisioning, deployment, or live Dataverse create/delete was performed.

The rebuilt archive was reinstalled into the code app and the local `safe`
parameter-policy switch was validated by focused tests. Authenticated Local
Play rendered the React canvas after the Vite server was restarted. A
read-only Azure query returned 52 recent function-trace rows, including four
parameter-bearing rows whose only captured value was `{"context":21}`; no
identity or comment payloads appeared. The local switch was disabled again
after verification. This validates the safe-policy local-player path, not a
deployed-host/CSP gate.

## Phase 6 - Distribution

Release validation depends on Phases 3, 4, and 5. Registry/ownership decisions
may be made earlier.

- [x] Add the MIT license and GitHub repository metadata.
- [x] Add GitHub Actions CI and tag-triggered GitHub release automation.
- [ ] Decide private/internal versus public distribution.
- [ ] Confirm available package name/scope, owner, and registry.
- [ ] Confirm source reuse rights, licensing, and dependency obligations.
- [x] Add installation examples and generic host-configuration guidance.
- [ ] Add validated host-specific guidance after hosted pilots.
- [x] Document supported syntax, async semantics, privacy, and performance limits.
- [ ] Establish versioning, release checks, and package-content inspection.
- [ ] Obtain explicit publication approval.
- [ ] Publish the approved artifact and verify installation from the registry.

## Verification log

The standalone package, independent consumer, and authenticated code-app Local
Play preview have passed their recorded checks. Real Azure ingestion, deployed
Power Pages/code-app pilots, cross-version matrix testing, and performance
acceptance remain outstanding.

| Date | Milestone/check | Command or evidence | Result/limitations |
| --- | --- | --- | --- |
| 2026-11-09 | Scope and folder naming | Planning conversation | Confirmed; distribution undecided. |
| 2026-11-09 | Runtime | `npm test -- tests\runtime.test.ts` | 8 tests passed. |
| 2026-11-09 | Runtime static checks | `npm run typecheck`; `npm run lint` | Both passed. |
| 2026-11-09 | Transformer | `npm test -- tests\instrument.test.ts` | 6 tests passed, including behavior comparisons, React hooks, and source mapping. |
| 2026-11-09 | Transformer static checks | `npm run typecheck`; `npm run lint` | Both passed. |
| 2026-11-09 | Application Insights adapters | `npm test -- tests\appinsights.test.ts tests\appinsights-initialize.test.ts` | 8 tests passed; SDK initialization uses a mock, not hosted ingestion. |
| 2026-11-09 | Application Insights static checks | `npm run typecheck`; `npm run lint` | Both passed. |
| 2026-11-09 | Vite controls | `npm test -- tests\vite.test.ts` | 2 tests passed for build-time disabling and file/query filters. |
| 2026-11-09 | Full package gate | `npm run check` | Type-check, lint, all 24 tests across 5 files, and build passed. |
| 2026-11-10 | Privacy parameter policy | `npm run check`; packed consumer `npm run check` | Added per-function `omit`, `boolean`, `length`, and `summary` transformations. Core gate passed with 25 tests; packed React/Vite consumer build and source-map verification passed. |
| 2026-11-09 | Local archive | `npm pack`; package-content inspection | 32 files, 25,125 bytes; only package metadata, README, source, and compiled output included. Package remains private/unpublished. |
| 2026-11-09 | Independent installed consumer | Install final archive; compare compiled file hashes; `npm run check` in `fixtures\react-vite` | Installed code matches current build; type-check, production build, and production source-map verification passed. Build-only compiler dependencies are absent from browser bundles. |
| 2026-11-09 | Browser runtime | Headless Edge against local fixture preview | All 8 checks passed: values, paired events, disabled tracing, build exclusions, source IDs, allowlisted parameters, nested functions, and React hooks. |
| 2026-11-09 | Real SDK lifecycle | Headless Edge against `owned.html` | Application Insights Web initialized, flushed, and disposed. Dummy local-only endpoint; no Azure ingestion claim. |
| 2026-11-09 | Existing-source syntax compatibility | Read-only transform/parse check over Mpower source | 259 files inspected; 212 transformed; 0 newly invalid files. This is not a deployed app regression test. |
| 2026-11-09 | Preliminary overhead | `npm run benchmark` | Node 26, no-op sink, 200,000 calls/sample, 5 samples: median 0.014 us baseline, 0.023 us disabled, 0.235 us enabled without parameters, 0.630 us with parameters. Not a browser performance budget. |
| 2026-11-09 | Preliminary browser bundle | Independent fixture production build | Shared tracing runtime chunk: 6.61 kB / 2.60 kB gzip. Excludes per-function injected growth and optional SDK chunk. |
| 2026-11-09 | Code-app baseline | `npm test`; `npm run lint`; `npm run build` | Lint/build passed. Two existing UI tests exceeded the default 5-second timeout, reproduced without concurrent checks; 30/32 passed. All 32 passed with `npm test -- --testTimeout=20000`. Test-source timeouts were not changed. |
| 2026-11-09 | Code-app installation | Local archive install; installed runtime/Vite/transformer SHA256 comparison | Package 0.1.0 matches the current library build. React and Power Apps plugins preserved; generated code and schemas unchanged. |
| 2026-11-09 | Code-app focused checks | Preview configuration tests plus real instrumented React-render test | All 6 new cases passed: default/explicit disablement, paired metadata without evaluating parameters, production guard, invalid configuration, real renders/updates without comment/identity capture. |
| 2026-11-09 | Code-app full gate | `npm run lint`; `npm run build`; `npm test -- --testTimeout=20000` | Lint/build and all 38 tests passed (32 existing + 6 new). Existing large-chunk warning remains; production JS is 635.70 kB / 182.03 kB gzip. |
| 2026-11-09 | Code-app browser smoke | Live Vite transforms and isolated headless Edge against localhost | App mounted under React 19; 2 automatic App calls had paired start/end events with no parameters. Telemetry setup and generated-service exclusions verified. External/non-GET requests blocked; no authenticated Local Play or Azure ingestion claim. |
| 2026-11-09 | Code-app production exclusion | Build with `VITE_FUNCTION_TRACE_ENABLED=true`; inspect production JS | Build passed; no preview, source-function-ID, runtime diagnostic, or tracing-flag markers. Dev server stopped and temporary browser profile removed. |
| 2026-11-10 | Azure code-app pilot | Final lint/build/full tests; signed-in Local Play; read-only Application Insights query | Lint and build passed; all 45 tests passed. SDK initialized and named preview traces appeared. Dark theme was toggled on and restored off. Browser blocked requests to the Application Insights ingestion endpoint and OneCollector with `ERR_BLOCKED_BY_CLIENT`; the read-only query returned no traces. No post/delete/sample-data actions. Local server stopped afterward. |
| 2026-11-10 | Azure ingestion retry | Removed browser ad blocker; read-only Application Insights `traces` query | 56 `function-trace` rows observed: 28 start, 28 end, 28 duration values, and 6 parameter-bearing rows. Parameter capture was disabled again after confirming that raw identity data could be exported. |
| 2026-11-10 | Safe policy consumer refresh | Reinstalled packed archive; focused telemetry tests; production build; authenticated Local Play; read-only Application Insights query | App tests passed (14/14 focused), lint/build passed, the canvas rendered, and Azure returned 52 recent function-trace rows. Four parameter-bearing rows contained only `context: 21`; no identity/comment values appeared. Local switch was disabled after the test. |
| 2026-11-10 | Repository release setup | Public GitHub repository, MIT license, GitHub Actions CI, and tag-triggered release workflow | Repository published under `sakshamgupta912/react-telemetry-kit`; CI runs Node 20/22 checks and tagged releases attach the `.tgz` artifact. npm registry publishing remains disabled. |

Tested local versions: Node 26.13.0, React/React DOM 18.3.1, Vite 7.3.7,
TypeScript 5.9.3, Application Insights Web 3.4.6. Declared compatibility ranges
have not been exhaustively tested.

The code-app local pilot additionally verified React/React DOM 19.3.1, Vite
7.3.7, TypeScript 5.9.3, Vitest 4.1.12, and Power Apps Vite plugin 1.0.13.
Authenticated Local Play adds non-production player evidence, not deployed-host
support certification or Azure ingestion proof.

Temporary browser profiles/logs were removed and the local preview was stopped.

## Blockers and open decisions

- Package registry, final npm scope/name, and publication permissions are unknown.
- Target hosted environments and access for ingestion validation are not selected.
- Cross-version compatibility and browser/ingestion performance budgets are not
  yet verified or approved.
- The privacy parameter-policy redesign is implemented and tested in the core
  runtime; the code-app pilot keeps raw parameter capture disabled.
- Redistribution rights and licensing must be confirmed before publication.
- Mpower cannot be modified; Power Pages validation needs a different approved app.
- The user has no instrumentation key yet. Azure setup and ingestion are deferred
  until the final stage; the code-app README includes connection-string steps.

## Next action

At the final Azure stage, obtain an approved non-production Application Insights
connection string and wire the sink before checking ingestion. Authenticated
Local Play preview validation is complete; do not treat it as deployed-host or
Azure acceptance. Select an alternative Power Pages app and agree on
compatibility/performance release gates before production claims or publication.
