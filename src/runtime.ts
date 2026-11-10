import {
  captureParameterPolicy,
  captureParameters,
  type ParameterCaptureRule,
} from "./internal/capture-parameters.js";

export interface FunctionTrace {
  phase: "start" | "end";
  functionId: string;
  functionName: string;
  invocationId: string;
  parameters?: string;
  durationMs?: number;
}

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
let dispatchDepth = 0;
let diagnosticCount = 0;
let invocationSequence = 0;
const invocationPrefix = Math.random().toString(36).slice(2);
const sampledFunctions = new Map<string, boolean>();

function normalizeStrings(
  values: readonly (string | null | undefined)[],
  field: string,
  lowercase = false,
): string[] {
  if (!Array.isArray(values)) throw new TypeError(`${field} must be an array`);
  const result = new Set<string>();
  for (const value of values) {
    if (value == null) continue;
    if (typeof value !== "string") {
      throw new TypeError(`${field} must contain strings`);
    }
    const trimmed = value.trim();
    if (trimmed) result.add(lowercase ? trimmed.toLowerCase() : trimmed);
  }
  return [...result];
}

function normalizePatterns(values: readonly string[], field: string): string[] {
  const patterns = normalizeStrings(values, field);
  for (const pattern of patterns) {
    const core = pattern.replace(/^\*+|\*+$/g, "");
    if (core.includes("*")) {
      throw new TypeError(`${field} supports wildcards only at pattern edges`);
    }
  }
  return patterns;
}

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
  diagnosticCount = 0;
}

function matchesPattern(value: string, pattern: string): boolean {
  const startsWithWildcard = pattern.startsWith("*");
  const endsWithWildcard = pattern.endsWith("*");
  const core = pattern.replace(/^\*+|\*+$/g, "");
  if (!core) return true;
  if (startsWithWildcard && endsWithWildcard) return value.includes(core);
  if (startsWithWildcard) return value.endsWith(core);
  if (endsWithWildcard) return value.startsWith(core);
  return value === core;
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

  let hash = 5381;
  for (let index = 0; index < functionId.length; index++) {
    hash = Math.imul(hash, 33) ^ functionId.charCodeAt(index);
  }
  const selected = sampleRate === 1 || (sampleRate > 0 && (hash >>> 0) / 0x100000000 < sampleRate);
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

function reportDiagnostic(
  callback: RuntimeConfiguration["onDiagnostic"],
  diagnostic: TraceDiagnostic,
): void {
  if (callback) {
    try {
      callback(diagnostic);
      return;
    } catch (error) {
      console.warn("[react-telemetry-kit] Diagnostic callback failed", error);
    }
  }
  if (diagnosticCount < 5) {
    console.warn(`[react-telemetry-kit] ${diagnostic.code}`, diagnostic.error);
  } else if (diagnosticCount === 5) {
    console.warn("[react-telemetry-kit] Further telemetry diagnostics suppressed");
  }
  diagnosticCount++;
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
  if (dispatchDepth > 0 || !isAllowed(functionId, functionName, config) || !config.sink) {
    return null;
  }

  dispatchDepth++;
  try {
    const handle: TraceHandle = {
      functionId,
      functionName,
      invocationId: `${invocationPrefix}-${++invocationSequence}`,
      startedAt: now(),
      sink: config.sink,
      onDiagnostic: config.onDiagnostic,
      ended: false,
    };
    const trace: FunctionTrace = {
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
        reportDiagnostic(config.onDiagnostic, { code: "parameter-capture-failed", error });
      }
    }

    try {
      config.sink.track(trace);
      return handle;
    } catch (error) {
      reportDiagnostic(config.onDiagnostic, { code: "sink-failed", error });
      return null;
    }
  } finally {
    dispatchDepth--;
  }
}

export function traceFunctionEnd(handle: TraceHandle | null): void {
  if (!handle || handle.ended || dispatchDepth > 0) return;
  handle.ended = true;
  dispatchDepth++;
  try {
    handle.sink.track({
      phase: "end",
      functionId: handle.functionId,
      functionName: handle.functionName,
      invocationId: handle.invocationId,
      durationMs: Math.max(0, now() - handle.startedAt),
    });
  } catch (error) {
    reportDiagnostic(handle.onDiagnostic, { code: "sink-failed", error });
  } finally {
    dispatchDepth--;
  }
}
