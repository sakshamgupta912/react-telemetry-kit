import type { CollectorContext, StopCollector } from "./types.js";

export interface ClickCaptureOptions {
  /** Opt-in attribute holding a stable identifier. Defaults to `data-telemetry-id`. */
  attribute?: string;
}

const DEFAULT_ATTRIBUTE = "data-telemetry-id";
const ATTRIBUTE_NAME = /^data-[a-z][a-z0-9-]*$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,99}$/;

export function resolveClickAttribute(options: ClickCaptureOptions): string {
  const attribute = options.attribute ?? DEFAULT_ATTRIBUTE;
  if (typeof attribute !== "string" || !ATTRIBUTE_NAME.test(attribute)) {
    throw new TypeError("clicks.attribute must be a lowercase data-* attribute name");
  }
  return attribute;
}

export function startClickCapture(
  options: ClickCaptureOptions,
  context: CollectorContext,
): StopCollector {
  const attribute = resolveClickAttribute(options);
  const selector = `[${attribute}]`;

  function onClick(event: MouseEvent): void {
    try {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const element = target.closest(selector);
      const id = element?.getAttribute(attribute);
      if (!element || !id || !IDENTIFIER.test(id)) return;
      context.emit({ type: "click", id, element: element.tagName.toLowerCase() });
    } catch (error) {
      context.diagnostic({ code: "collector-failed", feature: "clicks", error });
    }
  }

  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}
