export interface DiagnosticReporter<T extends { code: string; error?: unknown }> {
  report(callback: ((diagnostic: T) => void) | null, diagnostic: T): void;
  reset(): void;
}

export function createDiagnosticReporter<
  T extends { code: string; error?: unknown },
>(): DiagnosticReporter<T> {
  let count = 0;
  return {
    report(callback, diagnostic) {
      if (callback) {
        try {
          callback(diagnostic);
          return;
        } catch (error) {
          console.warn("[react-telemetry-kit] Diagnostic callback failed", error);
        }
      }
      if (count < 5) {
        console.warn(`[react-telemetry-kit] ${diagnostic.code}`, diagnostic.error);
      } else if (count === 5) {
        console.warn("[react-telemetry-kit] Further telemetry diagnostics suppressed");
      }
      count++;
    },
    reset() {
      count = 0;
    },
  };
}
