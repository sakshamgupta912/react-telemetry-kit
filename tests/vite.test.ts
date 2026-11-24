import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build as build7, createServer as createServer7, version as vite7Version } from "vite";
import { build as build8, createServer as createServer8, version as vite8Version } from "vite8";
import { describe, expect, it } from "vitest";
import { functionTracing, type FunctionTracingPluginOptions } from "../src/vite.js";

type CreateServer = typeof createServer7 | typeof createServer8;
type ViteServer = Awaited<ReturnType<typeof createServer7>>;

const runtimeAlias = {
  "react-telemetry-kit/runtime": fileURLToPath(new URL("../src/runtime.ts", import.meta.url)),
};

async function inTempRoot<T>(files: Record<string, string>, run: (root: string) => Promise<T>): Promise<T> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "react-telemetry-kit-test-")));
  try {
    for (const [relative, contents] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
      await writeFile(path.join(root, relative), contents);
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function withVite(
  createServer: CreateServer,
  options: FunctionTracingPluginOptions,
  check: (server: ViteServer) => Promise<void>,
): Promise<void> {
  const source = "export function example(value: number) { return value * 2; }";
  const runtimeDirectory = fileURLToPath(new URL("../src", import.meta.url));
  await inTempRoot(
    { "src/allowed.ts": source, "src/excluded.ts": source, "other/ignored.ts": source },
    async (root) => {
      const server = await createServer({
        configFile: false,
        root,
        logLevel: "silent",
        plugins: [functionTracing(options)],
        resolve: { alias: runtimeAlias },
        optimizeDeps: { noDiscovery: true, include: [] },
        server: {
          middlewareMode: true,
          hmr: false,
          watch: null,
          fs: { allow: [root, runtimeDirectory] },
        },
      });
      try {
        await check(server as ViteServer);
      } finally {
        await server.close();
      }
    },
  );
}

const versions = [
  ["Vite 7", createServer7, build7],
  ["Vite 8", createServer8, build8],
] as const;

describe("Vite versions under test", () => {
  it("covers one Vite 7 and one Vite 8 release", () => {
    expect(vite7Version).toMatch(/^7\./);
    expect(vite8Version).toMatch(/^8\./);
  });
});

describe.each(versions)("%s plugin controls", (_name, createServer) => {
  it("removes all instrumentation when disabled at build time", async () => {
    await withVite(createServer, { enabled: false }, async (server) => {
      const result = await server.transformRequest("/src/allowed.ts");
      expect(result?.code).toContain("value * 2");
      expect(result?.code).not.toContain("__rtk");
      expect(result?.code).not.toContain("react-telemetry-kit/runtime");
    });
  });

  it("applies source-relative inclusion and exclusion predicates", async () => {
    await withVite(createServer, {
      include: (file) => file.startsWith("src/"),
      exclude: (file) => file.endsWith("excluded.ts"),
    }, async (server) => {
      const allowed = await server.transformRequest("/src/allowed.ts");
      const excluded = await server.transformRequest("/src/excluded.ts");
      const ignored = await server.transformRequest("/other/ignored.ts");
      const raw = await server.transformRequest("/src/allowed.ts?raw");

      expect(allowed?.code).toContain("src/allowed.ts:1:1:example");
      expect(excluded?.code).not.toContain("__rtk");
      expect(ignored?.code).not.toContain("__rtk");
      expect(raw?.code).not.toContain("__rtk");
    });
  });
});

const entry = `
import { configureFunctionTracing } from "react-telemetry-kit/runtime";

export const events: Array<Record<string, unknown>> = [];
configureFunctionTracing({ enabled: true, sink: { track: (event) => { events.push({ ...event }); } } });

export function double(value: number): number { return value * 2; }
export function fail(): never { throw new TypeError("secret message"); }
export const nested = (items: number[]) => items.map((item) => double(item));
`;

describe.each(versions)("%s production build", (_name, _createServer, build) => {
  it("bundles instrumented code that records returns and failures when executed", async () => {
    const output = await inTempRoot({ "src/entry.ts": entry }, async (root) => {
      const result = await build({
        configFile: false,
        root,
        logLevel: "silent",
        plugins: [functionTracing()],
        resolve: { alias: runtimeAlias },
        build: {
          write: false,
          minify: false,
          sourcemap: false,
          lib: { entry: "src/entry.ts", formats: ["cjs"], fileName: "entry" },
        },
      });
      const outputs = (Array.isArray(result) ? result : [result]) as Array<{
        output: Array<{ type: string; code?: string }>;
      }>;
      const chunk = outputs[0]?.output.find((item) => item.type === "chunk");
      if (!chunk?.code) throw new Error("Expected a bundled chunk");
      return chunk.code;
    });

    const module = { exports: {} as Record<string, unknown> };
    runInNewContext(output, { module, exports: module.exports, console });
    const exported = module.exports as {
      events: Array<Record<string, unknown>>;
      double(value: number): number;
      fail(): never;
      nested(items: number[]): number[];
    };

    expect(exported.double(4)).toBe(8);
    expect(exported.nested([1, 2])).toEqual([2, 4]);
    expect(() => exported.fail()).toThrow("secret message");

    const ends = exported.events.filter((event) => event.phase === "end");
    const outcomes = ends.map((event) => [event.functionName, event.outcome, event.errorType]);
    expect(outcomes).toContainEqual(["double", "returned", undefined]);
    expect(outcomes).toContainEqual(["nested", "returned", undefined]);
    expect(outcomes).toContainEqual(["fail", "threw", "TypeError"]);
    expect(String(exported.events[0]?.functionId)).toMatch(/^src\/entry\.ts:\d+:\d+:/);
    expect(JSON.stringify(exported.events)).not.toContain("secret message");
    expect(output).not.toMatch(/createSourceFile|MagicString/);
  });
});
