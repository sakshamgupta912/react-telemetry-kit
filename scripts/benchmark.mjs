import { performance } from "node:perf_hooks";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { instrumentSource } from "../dist/internal/instrument.js";
import * as runtime from "../dist/runtime.js";

const source = "export function workload(value: number) { return value * 3 + 1; }";
const transformed = instrumentSource(source, "src/benchmark.ts");
if (!transformed) throw new Error("Benchmark source was not instrumented");

function load(code) {
  const exports = {};
  const compiled = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(compiled, {
    exports,
    require(name) {
      if (name !== "react-telemetry-kit/runtime") throw new Error(`Unexpected dependency: ${name}`);
      return runtime;
    },
  });
  return exports.workload;
}

const baseline = load(source);
const instrumented = load(transformed.code);
const iterations = 200000;
let checksum = 0;

function measure(run) {
  for (let index = 0; index < 20000; index++) checksum += run(index);
  const samples = [];
  for (let sample = 0; sample < 5; sample++) {
    const started = performance.now();
    for (let index = 0; index < iterations; index++) checksum += run(index);
    samples.push((performance.now() - started) * 1000 / iterations);
  }
  return Number(samples.sort((left, right) => left - right)[2].toFixed(3));
}

try {
  const results = { baseline: measure(baseline) };
  results.disabled = measure(instrumented);
  runtime.configureFunctionTracing({ enabled: true, sink: { track() {} } });
  results.enabledWithoutParameters = measure(instrumented);
  runtime.configureFunctionTracing({ includeParams: true, allowedParameters: ["value"] });
  results.enabledWithParameters = measure(instrumented);
  console.log(JSON.stringify({
    node: process.version,
    iterationsPerSample: iterations,
    samples: 5,
    medianMicrosecondsPerCall: results,
    checksum,
    limitation: "Node microbenchmark with a no-op sink; not a browser or ingestion performance budget.",
  }, null, 2));
} finally {
  runtime.resetFunctionTracing();
}
