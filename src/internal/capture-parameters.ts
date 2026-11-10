const MAX_DEPTH = 4;
const MAX_PROPERTIES = 20;
const MAX_STRING_LENGTH = 256;
const MAX_SERIALIZED_LENGTH = 4096;
const TRUNCATED = "...[truncated]";
const SENSITIVE_KEY =
  /password|token|secret|credential|authorization|cookie|api[-_]?key|connection[-_]?string|email|phone|ssn/i;

export type ParameterCaptureRule = "omit" | "boolean" | "length" | "summary";

function isSensitiveKey(key: string, redactedKeys: ReadonlySet<string>): boolean {
  return SENSITIVE_KEY.test(key) || redactedKeys.has(key.toLowerCase());
}

function sanitizeValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  redactedKeys: ReadonlySet<string>,
): unknown {
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}${TRUNCATED}`
      : value;
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return "[undefined]";
  if (typeof value === "symbol") return "[symbol]";
  if (typeof value === "function") return "[function]";
  if (depth >= MAX_DEPTH) return "[max depth]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (let index = 0; index < Math.min(value.length, MAX_PROPERTIES); index++) {
      const descriptor = descriptors[String(index)];
      result.push(
        descriptor && "value" in descriptor
          ? sanitizeValue(descriptor.value, depth + 1, seen, redactedKeys)
          : "[accessor or empty]",
      );
    }
    if (value.length > MAX_PROPERTIES) result.push(TRUNCATED);
    return result;
  }

  const result: Record<string, unknown> = Object.create(null);
  const keys = Object.keys(descriptors).filter((key) => descriptors[key]?.enumerable);
  for (const key of keys.slice(0, MAX_PROPERTIES)) {
    const descriptor = descriptors[key];
    if (!descriptor) continue;
    result[key] = isSensitiveKey(key, redactedKeys)
      ? "[REDACTED]"
      : "value" in descriptor
        ? sanitizeValue(descriptor.value, depth + 1, seen, redactedKeys)
        : "[accessor]";
  }
  if (keys.length > MAX_PROPERTIES) result["[additional properties]"] = TRUNCATED;
  return result;
}

export function captureParameters(
  parameters: Record<string, unknown>,
  allowedParameters: readonly string[],
  redactedKeys: ReadonlySet<string>,
): string {
  const result: Record<string, unknown> = Object.create(null);
  const seen = new WeakSet<object>();

  for (const name of allowedParameters) {
    const descriptor = Object.getOwnPropertyDescriptor(parameters, name);
    if (!descriptor) continue;
    result[name] = isSensitiveKey(name, redactedKeys)
      ? "[REDACTED]"
      : "value" in descriptor
        ? sanitizeValue(descriptor.value, 0, seen, redactedKeys)
        : "[accessor]";
  }

  const serialized = JSON.stringify(result);
  return serialized.length > MAX_SERIALIZED_LENGTH
    ? `${serialized.slice(0, MAX_SERIALIZED_LENGTH - TRUNCATED.length)}${TRUNCATED}`
    : serialized;
}

function valueLength(value: unknown): number {
  if (typeof value === "string" || Array.isArray(value)) return value.length;
  if (value !== null && typeof value === "object") {
    return Object.keys(Object.getOwnPropertyDescriptors(value)).length;
  }
  return value == null ? 0 : 1;
}

function safeSummary(value: unknown): Record<string, unknown> {
  if (value === null) return { type: "null" };
  if (typeof value === "string") return { type: "string", length: value.length };
  if (typeof value === "boolean") return { type: "boolean" };
  if (typeof value === "number") return { type: "number" };
  if (typeof value === "bigint") return { type: "bigint" };
  if (typeof value === "undefined") return { type: "undefined" };
  if (typeof value === "function") return { type: "function" };
  if (typeof value === "symbol") return { type: "symbol" };
  if (Array.isArray(value)) return { type: "array", length: value.length };
  return { type: "object", propertyCount: valueLength(value) };
}

export function captureParameterPolicy(
  parameters: Record<string, unknown>,
  policy: Readonly<Record<string, ParameterCaptureRule>>,
): string | undefined {
  const result: Record<string, unknown> = Object.create(null);

  for (const [name, rule] of Object.entries(policy)) {
    if (rule === "omit") continue;
    const descriptor = Object.getOwnPropertyDescriptor(parameters, name);
    if (!descriptor) continue;
    if (!("value" in descriptor)) {
      result[name] = "[accessor]";
      continue;
    }
    if (rule === "boolean") {
      result[name] = descriptor.value !== null && descriptor.value !== undefined;
    } else if (rule === "length") {
      result[name] = valueLength(descriptor.value);
    } else {
      result[name] = safeSummary(descriptor.value);
    }
  }

  const serialized = JSON.stringify(result);
  return serialized === "{}"
    ? undefined
    : serialized.length > MAX_SERIALIZED_LENGTH
      ? `${serialized.slice(0, MAX_SERIALIZED_LENGTH - TRUNCATED.length)}${TRUNCATED}`
      : serialized;
}
