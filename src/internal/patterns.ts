export function normalizeStrings(
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

export function normalizePatterns(values: readonly string[], field: string): string[] {
  const patterns = normalizeStrings(values, field);
  for (const pattern of patterns) {
    const core = pattern.replace(/^\*+|\*+$/g, "");
    if (core.includes("*")) {
      throw new TypeError(`${field} supports wildcards only at pattern edges`);
    }
  }
  return patterns;
}

export function matchesPattern(value: string, pattern: string): boolean {
  const startsWithWildcard = pattern.startsWith("*");
  const endsWithWildcard = pattern.endsWith("*");
  const core = pattern.replace(/^\*+|\*+$/g, "");
  if (!core) return true;
  if (startsWithWildcard && endsWithWildcard) return value.includes(core);
  if (startsWithWildcard) return value.endsWith(core);
  if (endsWithWildcard) return value.startsWith(core);
  return value === core;
}
