import { describe, expect, it } from "vitest";
import { errorTypeOf, sanitizeStack, sanitizeUrl } from "../src/internal/sanitize.js";

describe("sanitizers", () => {
  it("reduces URLs to origin and path without credentials, queries, or fragments", () => {
    expect(sanitizeUrl("https://user:pw@example.com:8443/a/b?token=1#frag")).toBe("https://example.com:8443/a/b");
    expect(sanitizeUrl("/api/items?id=7", "https://example.com/app")).toBe("https://example.com/api/items");
    expect(sanitizeUrl("data:text/plain;base64,c2VjcmV0")).toBe("data:");
    expect(sanitizeUrl("not a url")).toBeUndefined();
  });

  it("reports only safe error categories", () => {
    class ValidationError extends Error {
      override name = "ValidationError";
    }
    class Leaky extends Error {
      override name = "John Smith, 555-0100";
    }
    expect(errorTypeOf(new TypeError("private"))).toBe("TypeError");
    expect(errorTypeOf(new ValidationError("private"))).toBe("ValidationError");
    expect(errorTypeOf(new Leaky("private"))).toBe("Error");
    expect(errorTypeOf(new DOMException("private", "AbortError"))).toBe("AbortError");
    expect(errorTypeOf({ name: "Alice", message: "private" })).toBe("non-error");
    expect(errorTypeOf("private string")).toBe("non-error");
    expect(errorTypeOf(null)).toBe("non-error");
    const hostile = new Proxy({}, { getPrototypeOf() { throw new Error("trap"); } });
    expect(errorTypeOf(hostile)).toBe("non-error");
  });

  it("keeps stack frames only and strips message text, credentials, and URL details", () => {
    const v8 = [
      "TypeError: card 4111111111111111 is invalid",
      "    at pay (https://user:pw@example.com/assets/app.js?v=3#x:10:5)",
      "    at https://example.com/assets/vendor.js:2:9",
    ].join("\n");
    const result = sanitizeStack(v8) ?? "";
    expect(result).toBe(
      ["at pay (https://example.com/assets/app.js:10:5)", "at https://example.com/assets/vendor.js:2:9"].join("\n"),
    );
    expect(result).not.toContain("4111");

    const firefox = "pay@https://example.com/assets/app.js?v=3:10:5\n@https://example.com/x.js:1:1";
    expect(sanitizeStack(firefox)).toBe("pay@https://example.com/assets/app.js:10:5\n@https://example.com/x.js:1:1");
    expect(sanitizeStack("at a (b.js:1:1)\n".repeat(500))?.length).toBeLessThanOrEqual(2048);
    expect(sanitizeStack(undefined)).toBeUndefined();
    expect(sanitizeStack("")).toBeUndefined();
  });
});
