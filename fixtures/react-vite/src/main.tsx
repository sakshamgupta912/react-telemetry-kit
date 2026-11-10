import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createApplicationInsightsSink } from "react-telemetry-kit/appinsights";
import { configureFunctionTracing } from "react-telemetry-kit/runtime";
import { excludedFeature } from "./excluded";

interface ReceivedTrace {
  message: string;
  properties: Record<string, string>;
}

const received: ReceivedTrace[] = [];
const existingClient = {
  trackTrace(telemetry: { message: string }, properties: Record<string, string> = {}) {
    received.push({ message: telemetry.message, properties });
  },
};

configureFunctionTracing({
  enabled: true,
  sink: createApplicationInsightsSink(existingClient),
  includeParams: true,
  allowedParameters: ["value"],
});

function double(value: number): number {
  return value * 2;
}

const firstValue = double(7);
const firstCount = received.length;
const excludedValue = excludedFeature();
const excludedCount = received.length;
configureFunctionTracing({ enabled: false });
double(8);
const disabledCount = received.length;
configureFunctionTracing({ enabled: true, targetFunctions: ["double"] });
const secondValue = double(9);
const filteredCount = received.length;
configureFunctionTracing({ targetFunctions: [] });

function nested(value: number): number | undefined {
  return [value].map((item) => item * 2)[0];
}
const nestedValue = nested(5);

function App() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(1);
  }, []);
  return <output id="react-value">{count}</output>;
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing root element");
createRoot(rootElement).render(<App />);

setTimeout(() => {
  configureFunctionTracing({ enabled: false });
  let hasSourceId = false;
  let hasParameters = false;
  let hasNested = false;
  let hasApp = false;
  let hasExcluded = false;
  for (const trace of received) {
    if (trace.properties.functionId?.startsWith("src/main.tsx:")) hasSourceId = true;
    if (trace.properties.functionName === "double" && trace.properties.parameters === '{"value":7}') {
      hasParameters = true;
    }
    if (trace.properties.functionName === "nested") hasNested = true;
    if (trace.properties.functionName === "App") hasApp = true;
    if (trace.properties.functionName === "excludedFeature") hasExcluded = true;
  }
  const checks = {
    values: firstValue === 14 && secondValue === 18 && nestedValue === 10,
    pairedEvents: firstCount === 2 && filteredCount === firstCount + 2,
    disabled: disabledCount === firstCount,
    buildExclusion: excludedValue === "excluded" && excludedCount === firstCount && !hasExcluded,
    sourceId: hasSourceId,
    allowlistedParameter: hasParameters,
    nestedFunction: hasNested,
    reactHook: hasApp && document.getElementById("react-value")?.textContent === "1",
  };
  const result = document.getElementById("result");
  if (!result) throw new Error("Missing result element");
  result.dataset.status = Object.values(checks).every(Boolean) ? "pass" : "fail";
  result.textContent = JSON.stringify(checks);
}, 500);
