import {
  captureParameterPolicy,
  captureParameters,
  type ParameterCaptureRule,
} from "./internal/capture-parameters.js";
import { getPageViewId, getSessionId, nextSequence } from "./internal/context.js";
import { createDiagnosticReporter } from "./internal/diagnostics.js";
import { dispatch, isDispatching } from "./internal/dispatch.js";
import type { FunctionTrace } from "./internal/events.js";
import { matchesPattern, normalizePatterns, normalizeStrings } from "./internal/patterns.js";
import { isSelected } from "./internal/sampling.js";
import { errorTypeOf } from "./internal/sanitize.js";
import { SDK_VERSION } from "./internal/version.js";

export type { FunctionTrace } from "./internal/events.js";

export interface FunctionTraceSink {
  track(trace: FunctionTrace): void;
}

export type FunctionParameterPolicy =
  | "omit"
  | Readonly<Record<string, ParameterCaptureRule>>;

export interface TraceDiagnostic {
  code: "parameter-capture-failed" | "sink-failed";
  error: unknown;
}

export interface FunctionTraceConfiguration {
  enabled?: boolean;
  sink?: FunctionTraceSink | null;
  sampleRate?: number;
  targetUsers?: readonly string[];
  currentUserIdentifiers?: readonly (string | null | undefined)[];
  targetFunctions?: readonly string[];
  excludedFunctions?: readonly string[];
  includeParams?: boolean;
  allowedParameters?: readonly string[];
  parameterPolicy?: Readonly<Record<string, FunctionParameterPolicy>>;
  redactedKeys?: readonly string[];
  onDiagnostic?: ((diagnostic: TraceDiagnostic) => void) | null;
}

interface RuntimeConfiguration {
  enabled: boolean;
  sink: FunctionTraceSink | null;
  sampleRate: number;
  targetUsers: readonly string[];
  currentUserIdentifiers: readonly string[];
  targetFunctions: readonly string[];
  excludedFunctions: readonly string[];
  includeParams: boolean;
  allowedParameters: readonly string[];
  parameterPolicy: Readonly<Record<string, FunctionParameterPolicy>>;
  redactedKeys: ReadonlySet<string>;
  onDiagnostic: ((diagnostic: TraceDiagnostic) => void) | null;
}

interface TraceHandle {
  functionId: string;
  functionName: string;
  invocationId: string;
  startedAt: number;
  sink: FunctionTraceSink;
  onDiagnostic: RuntimeConfiguration["onDiagnostic"];
  ended: boolean;
  failed: boolean;
  errorType: string | undefined;
}

function defaultConfiguration(): RuntimeConfiguration {
  return {
    enabled: false,
    sink: null,
    sampleRate: 1,
    targetUsers: [],
    currentUserIdentifiers: [],
    targetFunctions: [],
    excludedFunctions: [],
    includeParams: false,
    allowedParameters: [],
    parameterPolicy: {},
    redactedKeys: new Set<string>(),
    onDiagnostic: null,
  };
}

let configuration = defaultConfiguration();
let invocationSequence = 0;
const invocationPrefix = Math.random().toString(36).slice(2);
const sampledFunctions = new Map<string, boolean>();
const diagnostics = createDiagnosticReporter<TraceDiagnostic>();

function normalizeParameterPolicy(
  value: Readonly<Record<string, FunctionParameterPolicy>>,
): Readonly<Record<string, FunctionParameterPolicy>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("parameterPolicy must be an object");
  }
  const result: Record<string, FunctionParameterPolicy> = Object.create(null);
  for (const [functionPattern, policy] of Object.entries(value)) {
    const normalizedPattern = functionPattern.trim();
    if (!normalizedPattern) throw new TypeError("parameterPolicy function keys must not be blank");
    if (policy === "omit") {
      result[normalizedPattern] = policy;
      continue;
    }
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
      throw new TypeError(`parameterPolicy for ${normalizedPattern} must be "omit" or an object`);
    }
    const normalizedParameters: Record<string, ParameterCaptureRule> = Object.create(null);
    for (const [parameter, rule] of Object.entries(policy)) {
      const normalizedParameter = parameter.trim();
      if (!normalizedParameter) throw new TypeError("parameterPolicy parameter keys must not be blank");
      if (rule !== "omit" && rule !== "boolean" && rule !== "length" && rule !== "summary") {
        throw new TypeError(`Unsupported parameter capture rule for ${normalizedPattern}.${normalizedParameter}`);
      }
      normalizedParameters[normalizedParameter] = rule;
    }
    result[normalizedPattern] = normalizedParameters;
  }
  return result;
}

export function configureFunctionTracing(update: FunctionTraceConfiguration): void {
  const next: RuntimeConfiguration = { ...configuration };

  if (update.enabled !== undefined) {
    if (typeof update.enabled !== "boolean") throw new TypeError("enabled must be boolean");
    next.enabled = update.enabled;
  }
  if (update.sink !== undefined) {
    if (update.sink !== null && typeof update.sink.track !== "function") {
      throw new TypeError("sink must have a track function");
    }
    next.sink = update.sink;
  }
  if (update.sampleRate !== undefined) {
    if (!Number.isFinite(update.sampleRate) || update.sampleRate < 0 || update.sampleRate > 1) {
      throw new RangeError("sampleRate must be between 0 and 1");
    }
    next.sampleRate = update.sampleRate;
  }
  if (update.targetUsers !== undefined) {
    next.targetUsers = normalizeStrings(update.targetUsers, "targetUsers", true);
  }
  if (update.currentUserIdentifiers !== undefined) {
    next.currentUserIdentifiers = normalizeStrings(
      update.currentUserIdentifiers,
      "currentUserIdentifiers",
      true,
    );
  }
  if (update.targetFunctions !== undefined) {
    next.targetFunctions = normalizePatterns(update.targetFunctions, "targetFunctions");
  }
  if (update.excludedFunctions !== undefined) {
    next.excludedFunctions = normalizePatterns(update.excludedFunctions, "excludedFunctions");
  }
  if (update.includeParams !== undefined) {
    if (typeof update.includeParams !== "boolean") {
      throw new TypeError("includeParams must be boolean");
    }
    next.includeParams = update.includeParams;
  }
  if (update.allowedParameters !== undefined) {
    next.allowedParameters = normalizeStrings(update.allowedParameters, "allowedParameters");
  }
  if (update.parameterPolicy !== undefined) {
    next.parameterPolicy = normalizeParameterPolicy(update.parameterPolicy);
  }
  if (update.redactedKeys !== undefined) {
    next.redactedKeys = new Set(normalizeStrings(update.redactedKeys, "redactedKeys", true));
  }
  if (update.onDiagnostic !== undefined) {
    if (update.onDiagnostic !== null && typeof update.onDiagnostic !== "function") {
      throw new TypeError("onDiagnostic must be a function");
    }
    next.onDiagnostic = update.onDiagnostic;
  }
  if (
    next.includeParams &&
    next.allowedParameters.length === 0 &&
    Object.keys(next.parameterPolicy).length === 0
  ) {
    throw new TypeError("allowedParameters or parameterPolicy is required when includeParams is enabled");
  }

  configuration = next;
  sampledFunctions.clear();
}

export function resetFunctionTracing(): void {
  configuration = defaultConfiguration();
  sampledFunctions.clear();
  diagnostics.reset();
}

function matchesFunction(
  functionId: string,
  functionName: string,
  pattern: string,
): boolean {
  return matchesPattern(functionId, pattern) || matchesPattern(functionName, pattern);
}

function isSampled(functionId: string, sampleRate: number): boolean {
  const cached = sampledFunctions.get(functionId);
  if (cached !== undefined) return cached;

  const selected = isSelected(functionId, sampleRate);
  sampledFunctions.set(functionId, selected);
  return selected;
}

function isAllowed(functionId: string, functionName: string, config: RuntimeConfiguration): boolean {
  if (!config.enabled || !config.sink) return false;
  if (
    config.targetUsers.length > 0 &&
    !config.currentUserIdentifiers.some((user) => config.targetUsers.includes(user))
  ) {
    return false;
  }

  if (
    config.targetFunctions.length > 0 &&
    !config.targetFunctions.some((pattern) => matchesFunction(functionId, functionName, pattern))
  ) {
    return false;
  }
  if (
    config.excludedFunctions.some((pattern) => matchesFunction(functionId, functionName, pattern))
  ) {
    return false;
  }
  return isSampled(functionId, config.sampleRate);
}

function findParameterPolicy(
  functionId: string,
  functionName: string,
  policies: Readonly<Record<string, FunctionParameterPolicy>>,
): FunctionParameterPolicy | undefined {
  const exact = policies[functionName] ?? policies[functionId];
  if (exact !== undefined) return exact;
  for (const [pattern, policy] of Object.entries(policies)) {
    if (matchesFunction(functionId, functionName, pattern)) return policy;
  }
  return undefined;
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export function traceFunctionStart(
  functionId: string,
  functionName: string,
  getParameters?: () => Record<string, unknown>,
): TraceHandle | null {
  const config = configuration;
  if (isDispatching() || !isAllowed(functionId, functionName, config) || !config.sink) {
    return null;
  }
  const sink = config.sink;

  return dispatch(() => {
    const handle: TraceHandle = {
      functionId,
      functionName,
      invocationId: `${invocationPrefix}-${++invocationSequence}`,
      startedAt: now(),
      sink,
      onDiagnostic: config.onDiagnostic,
      ended: false,
      failed: false,
      errorType: undefined,
    };
    const trace: FunctionTrace = {
      type: "function",
      timestamp: Date.now(),
      sessionId: getSessionId(),
      pageViewId: getPageViewId(),
      sequence: nextSequence(),
      sdkVersion: SDK_VERSION,
      phase: "start",
      functionId,
      functionName,
      invocationId: handle.invocationId,
    };

    if (config.includeParams && getParameters) {
      try {
        const policy = findParameterPolicy(functionId, functionName, config.parameterPolicy);
        if (policy && policy !== "omit") {
          const parameters = getParameters();
          const captured = captureParameterPolicy(parameters, policy);
          if (captured !== undefined) trace.parameters = captured;
        } else if (policy === undefined && config.allowedParameters.length > 0) {
          const parameters = getParameters();
          trace.parameters = captureParameters(parameters, config.allowedParameters, config.redactedKeys);
        }
      } catch (error) {
        diagnostics.report(config.onDiagnostic, { code: "parameter-capture-failed", error });
      }
    }

    try {
      sink.track(trace);
      return handle;
    } catch (error) {
      diagnostics.report(config.onDiagnostic, { code: "sink-failed", error });
      return null;
    }
  });
}

/** Marks an invocation as failed. The generated wrapper rethrows the original error afterwards. */
export function traceFunctionFailure(handle: TraceHandle | null, error: unknown): void {
  if (!handle || handle.ended) return;
  handle.failed = true;
  handle.errorType = errorTypeOf(error);
}

export function traceFunctionEnd(handle: TraceHandle | null): void {
  if (!handle || handle.ended || isDispatching()) return;
  handle.ended = true;
  dispatch(() => {
    try {
      const trace: FunctionTrace = {
        type: "function",
        timestamp: Date.now(),
        sessionId: getSessionId(),
        pageViewId: getPageViewId(),
        sequence: nextSequence(),
        sdkVersion: SDK_VERSION,
        phase: "end",
        functionId: handle.functionId,
        functionName: handle.functionName,
        invocationId: handle.invocationId,
        durationMs: Math.max(0, now() - handle.startedAt),
        outcome: handle.failed ? "threw" : "returned",
      };
      if (handle.errorType !== undefined) trace.errorType = handle.errorType;
      handle.sink.track(trace);
    } catch (error) {
      diagnostics.report(handle.onDiagnostic, { code: "sink-failed", error });
    }
  });
}
