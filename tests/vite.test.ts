import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";
import { describe, expect, it } from "vitest";
import { functionTracing, type FunctionTracingPluginOptions } from "../src/vite.js";

async function withVite(
  options: FunctionTracingPluginOptions,
  check: (server: ViteDevServer) => Promise<void>,
): Promise<void> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "react-telemetry-kit-test-")));
  const runtimeDirectory = fileURLToPath(new URL("../src", import.meta.url));
  let server: ViteDevServer | undefined;
  try {
    await mkdir(path.join(root, "src"));
    await mkdir(path.join(root, "other"));
    const source = "export function example(value: number) { return value * 2; }";
    await Promise.all([
      writeFile(path.join(root, "src", "allowed.ts"), source),
      writeFile(path.join(root, "src", "excluded.ts"), source),
      writeFile(path.join(root, "other", "ignored.ts"), source),
    ]);
    server = await createServer({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: [functionTracing(options)],
      resolve: {
        alias: {
          "react-telemetry-kit/runtime": fileURLToPath(new URL("../src/runtime.ts", import.meta.url)),
        },
      },
      optimizeDeps: { noDiscovery: true, include: [] },
      server: {
        middlewareMode: true,
        hmr: false,
        watch: null,
        fs: { allow: [root, runtimeDirectory] },
      },
    });
    await check(server);
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
}

describe("Vite plugin controls", () => {
  it("removes all instrumentation when disabled at build time", async () => {
    await withVite({ enabled: false }, async (server) => {
      const result = await server.transformRequest("/src/allowed.ts");
      expect(result?.code).toContain("value * 2");
      expect(result?.code).not.toContain("__rtk");
      expect(result?.code).not.toContain("react-telemetry-kit/runtime");
    });
  });

  it("applies source-relative inclusion and exclusion predicates", async () => {
    await withVite({
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
