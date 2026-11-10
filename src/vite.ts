import path from "node:path";
import type { Plugin } from "vite";
import { instrumentSource } from "./internal/instrument.js";

export interface FunctionTracingPluginOptions {
  enabled?: boolean;
  include?: (relativePath: string) => boolean;
  exclude?: (relativePath: string) => boolean;
}

export function functionTracing(options: FunctionTracingPluginOptions = {}): Plugin {
  let root = process.cwd();

  return {
    name: "react-telemetry-kit:function-tracing",
    enforce: "pre",
    configResolved(config) {
      root = path.resolve(config.root);
    },
    transform(code, id) {
      if (options.enabled === false || id.includes("?") || id.startsWith("\0")) return null;
      if (!/\.[jt]sx?$/.test(id) || id.endsWith(".d.ts")) return null;

      const relativePath = path.relative(root, id);
      if (
        !relativePath ||
        path.isAbsolute(relativePath) ||
        relativePath === ".." ||
        relativePath.startsWith(`..${path.sep}`)
      ) {
        return null;
      }

      const normalizedPath = relativePath.split(path.sep).join("/");
      if (normalizedPath.split("/").includes("node_modules")) return null;
      if (options.include && !options.include(normalizedPath)) return null;
      if (options.exclude?.(normalizedPath)) return null;

      return instrumentSource(code, normalizedPath);
    },
  };
}
