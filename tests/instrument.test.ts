import { runInNewContext } from "node:vm";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { instrumentSource } from "../src/internal/instrument.js";
import * as runtime from "../src/runtime.js";
import type { FunctionTrace } from "../src/runtime.js";

function execute<T extends object>(source: string): T {
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const modules: Record<string, unknown> = {
    "react-telemetry-kit/runtime": runtime,
    react: React,
    "react/jsx-runtime": jsxRuntime,
  };
  runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected dependency: ${name}`);
      return modules[name];
    },
  });
  return exports as T;
}

function instrument(source: string, file = "src/example.ts"): string {
  const result = instrumentSource(source, file);
  if (!result) throw new Error("Expected source to be instrumented");
  return result.code;
}

afterEach(() => runtime.resetFunctionTracing());

describe("function instrumentation", () => {
  it("preserves nested callbacks, methods, lexical this, super, and directives", () => {
    const source = `
      export function outer(value: number) {
        "use strict";
        function nested(delta: number) { return value + delta; }
        return [1, 2].map((n) => nested(n)).join(",");
      }
      export class Base { value = 5; getValue() { return this.value; } }
      export class Child extends Base {
        getValue() { return super.getValue() + 1; }
      }
      export function lexical() {
        const obj = { base: 3, run() { return [1, 2].map((x) => this.base + x); } };
        return obj.run().join(",");
      }
    `;
    type Example = { outer(value: number): string; lexical(): string; Child: new () => { getValue(): number } };
    const baseline = execute<Example>(source);
    const traces: FunctionTrace[] = [];
    runtime.configureFunctionTracing({ enabled: true, sink: { track: (trace) => traces.push(trace) } });
    const transformed = instrument(source);
    const wrapped = execute<Example>(transformed);

    expect(wrapped.outer(4)).toBe(baseline.outer(4));
    expect(wrapped.lexical()).toBe(baseline.lexical());
    expect(new wrapped.Child().getValue()).toBe(new baseline.Child().getValue());
    expect(transformed.indexOf('"use strict"')).toBeLessThan(transformed.indexOf("const __rtkInvocation"));
    expect(traces.some((trace) => trace.phase === "start" && trace.functionName === "nested")).toBe(true);
    expect(traces.filter((trace) => trace.phase === "start" && trace.functionName === "anonymous")).toHaveLength(4);
    expect(traces.every((trace) => trace.functionId.startsWith("src/example.ts:"))).toBe(true);
  });

  it("preserves promise identity, end-on-return timing, and thrown values", async () => {
    const source = `
      export function returnPromise(value: Promise<string>) { return value; }
      export async function returnAsync(value: Promise<string>) { return value; }
      export function fail(value: unknown) { throw value; }
    `;
    type Example = {
      returnPromise(value: Promise<string>): Promise<string>;
      returnAsync(value: Promise<string>): Promise<string>;
      fail(value: unknown): never;
    };
    const traces: FunctionTrace[] = [];
    runtime.configureFunctionTracing({ enabled: true, sink: { track: (trace) => traces.push(trace) } });
    const wrapped = execute<Example>(instrument(source));
    let resolve: ((value: string) => void) | undefined;
    const pending = new Promise<string>((done) => { resolve = done; });

    expect(wrapped.returnPromise(pending)).toBe(pending);
    const asyncResult = wrapped.returnAsync(pending);
    expect(traces.filter((trace) => trace.phase === "end")).toHaveLength(2);
    const thrown = { reason: "same object" };
    try {
      wrapped.fail(thrown);
      throw new Error("Expected fail to throw");
    } catch (error) {
      expect(error).toBe(thrown);
    }
    resolve?.("done");
    await expect(asyncResult).resolves.toBe("done");
  });

  it("handles nested concise arrow expressions and generated-name collisions", () => {
    const source = `
      const __rtkStart = 2;
      export const outer = (__rtkInvocation: number) => (value: number) => value + __rtkInvocation + __rtkStart;
    `;
    const traces: FunctionTrace[] = [];
    runtime.configureFunctionTracing({ enabled: true, sink: { track: (trace) => traces.push(trace) } });
    const wrapped = execute<{ outer(value: number): (value: number) => number }>(instrument(source));

    expect(wrapped.outer(3)(4)).toBe(9);
    expect(traces.map((trace) => trace.phase)).toEqual(["start", "end", "start", "end"]);
    expect(new Set(traces.filter((trace) => trace.phase === "start").map((trace) => trace.functionId)).size).toBe(2);
  });

  it("skips constructors, generators, and direct eval while tracing safe nested functions", () => {
    const source = `
      export function* generator() { yield 7; }
      export function evaluated() { const secret = 9; return eval("secret"); }
      export class Holder {
        value: number;
        constructor() { const callback = () => 4; this.value = callback(); }
      }
    `;
    type Example = {
      generator(): Generator<number>;
      evaluated(): number;
      Holder: new () => { value: number };
    };
    const traces: FunctionTrace[] = [];
    runtime.configureFunctionTracing({ enabled: true, sink: { track: (trace) => traces.push(trace) } });
    const wrapped = execute<Example>(instrument(source));

    expect(wrapped.generator().next().value).toBe(7);
    expect(wrapped.evaluated()).toBe(9);
    expect(new wrapped.Holder().value).toBe(4);
    const starts = traces.filter((trace) => trace.phase === "start");
    expect(starts.map((trace) => trace.functionName)).toEqual(["callback"]);
    expect(instrumentSource("function* only() { yield 1; }", "src/only.js")).toBeNull();
  });

  it("preserves React hook rendering with nested JSX callbacks", () => {
    const source = `
      import { useState } from "react";
      export function Counter() {
        const [count] = useState(2);
        return <span>{[count].map((value) => <b key={value}>{value}</b>)}</span>;
      }
    `;
    type Example = { Counter: React.ComponentType };
    const baseline = execute<Example>(source);
    const traces: FunctionTrace[] = [];
    runtime.configureFunctionTracing({ enabled: true, sink: { track: (trace) => traces.push(trace) } });
    const wrapped = execute<Example>(instrument(source, "src/Counter.tsx"));

    expect(renderToStaticMarkup(React.createElement(wrapped.Counter))).toBe(
      renderToStaticMarkup(React.createElement(baseline.Counter)),
    );
    expect(traces.some((trace) => trace.functionName === "Counter")).toBe(true);
    expect(traces.some((trace) => trace.functionName === "anonymous")).toBe(true);
  });

  it("generates mappings to the original source", () => {
    const source = "export function add(a: number, b: number) {\n  return a + b;\n}\n";
    const result = instrumentSource(source, "src/math.ts");
    expect(result).not.toBeNull();
    if (!result) return;
    const index = result.code.indexOf("return a + b");
    const before = result.code.slice(0, index).split("\n");
    const original = originalPositionFor(new TraceMap(result.map.toString()), {
      line: before.length,
      column: before.at(-1)?.length ?? 0,
    });

    expect(original).toMatchObject({ source: "src/math.ts", line: 2, column: 2 });
  });
});
