const ERROR_NAME = /^[A-Za-z_$][\w$]{0,63}$/;
const MAX_STACK_LENGTH = 2048;

/**
 * Reduces a URL to origin plus path. Query strings, fragments, and credentials
 * are dropped; non-HTTP URLs (such as data: and blob:) keep only their scheme.
 */
export function sanitizeUrl(value: string, base?: string): string | undefined {
  try {
    const url = new URL(value, base);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return `${url.origin}${url.pathname}`;
    }
    return url.protocol;
  } catch {
    return undefined;
  }
}

/** Returns a safe error category. Messages and arbitrary object properties are never read. */
export function errorTypeOf(value: unknown): string {
  try {
    const tag = Object.prototype.toString.call(value);
    if (value instanceof Error || tag === "[object Error]" || tag === "[object DOMException]") {
      const name = (value as { name?: unknown }).name;
      if (typeof name === "string" && ERROR_NAME.test(name)) return name;
      return "Error";
    }
  } catch {
    // Hostile proxies or getters must not break telemetry.
  }
  return "non-error";
}

function stripUrlDetails(text: string): string {
  return text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s()]+/gi, (match) => {
    const position = /(:\d+){1,2}$/.exec(match)?.[0] ?? "";
    const url = position ? match.slice(0, -position.length) : match;
    const withoutCredentials = url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, "$1");
    const cut = withoutCredentials.search(/[?#]/);
    return (cut === -1 ? withoutCredentials : withoutCredentials.slice(0, cut)) + position;
  });
}

/**
 * Keeps stack frames only. V8 puts the error message in the first line, so
 * header lines are dropped whenever frames use the `at ` format.
 */
export function sanitizeStack(stack: unknown): string | undefined {
  if (typeof stack !== "string" || !stack) return undefined;
  const lines = stack.split("\n");
  const v8Frames = lines.filter((line) => /^\s*at\s/.test(line));
  const frames = (v8Frames.length > 0 ? v8Frames : lines).map((line) => line.trim());
  const result = stripUrlDetails(frames.join("\n")).trim();
  return result ? result.slice(0, MAX_STACK_LENGTH) : undefined;
}
