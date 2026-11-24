// Installs the packed package into a fresh project for every Vite major in the declared peer range
// and checks that it installs without a peer conflict, builds and runs instrumented code, works in
// the dev server, and type-checks in a consumer's vite.config.ts.
//
//   node scripts/check-vite-compat.mjs [--node "<command that runs Node>"] [--majors 4,5,6]
//
// --node runs the build and dev-server checks under another Node, for example
// --node "npx -y -p node@18 node". Installing and type-checking use the current Node.
// --majors limits the check to some of the declared majors, because Vite 7 and 8 themselves
// need Node 20.19 or later.

import { exec } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(exec);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeFlag = process.argv.indexOf("--node");
const nodeCommand = nodeFlag === -1 ? "node" : process.argv[nodeFlag + 1] || "node";
const majorsFlag = process.argv.indexOf("--majors");
const onlyMajors = majorsFlag === -1 ? undefined : String(process.argv[majorsFlag + 1]).split(",");

const entry = `import { configureFunctionTracing } from "react-telemetry-kit/runtime";
export const events: Array<Record<string, unknown>> = [];
configureFunctionTracing({ enabled: true, sink: { track: (event) => { events.push({ ...event }); } } });
export function double(value: number): number { return value * 2; }
export function fail(): never { throw new TypeError("secret message"); }
`;

const viteConfig = `import { defineConfig } from "vite";
import { functionTracing } from "react-telemetry-kit/vite";

export default defineConfig({
  plugins: [functionTracing({ exclude: (file) => file.startsWith("src/telemetry") })],
});
`;

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "ES2022", lib: ["ES2022", "DOM"], module: "ESNext", moduleResolution: "Bundler",
    strict: true, noEmit: true, skipLibCheck: true, types: ["node"],
  },
  include: ["vite.config.ts", "src"],
}, null, 2);

// The build and the dev server run in separate processes: a Vite build sets NODE_ENV=production
// for the rest of its process, which changes how a dev server started afterwards behaves.
const runner = `import { build, createServer, version } from "vite";
import { functionTracing } from "react-telemetry-kit/vite";
import { realpathSync } from "node:fs";
import { runInNewContext } from "node:vm";

const root = realpathSync.native(process.cwd());
const phase = process.argv[2];
const result = { viteVersion: version, node: process.version };

if (phase === "build") {
  try {
    const built = await build({
      configFile: false, root, logLevel: "silent", plugins: [functionTracing()],
      build: { write: false, minify: false, sourcemap: false, lib: { entry: "src/entry.ts", formats: ["cjs"], fileName: "entry" } },
    });
    const outputs = Array.isArray(built) ? built : [built];
    const chunk = outputs[0].output.find((item) => item.type === "chunk");
    const module = { exports: {} };
    runInNewContext(chunk.code, { module, exports: module.exports, console });
    const exported = module.exports;
    exported.double(4);
    let threw = false;
    try { exported.fail(); } catch { threw = true; }
    const ends = exported.events
      .filter((event) => event.phase === "end")
      .map((event) => event.functionName + ":" + event.outcome + ":" + (event.errorType ?? ""));
    const leaked = JSON.stringify(exported.events).includes("secret");
    result.build = { ok: threw && !leaked && ends.includes("double:returned:") && ends.includes("fail:threw:TypeError"), detail: ends.join(", ") };
  } catch (error) {
    result.build = { ok: false, detail: String(error).slice(0, 300) };
  }
}

if (phase === "dev") {
  try {
    const server = await createServer({
      configFile: false, root, logLevel: "silent", plugins: [functionTracing()],
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { middlewareMode: true, hmr: false, watch: null, fs: { allow: [root] } },
    });
    const transformed = await server.transformRequest("/src/entry.ts");
    result.dev = { ok: /src\\/entry\\.ts:\\d+:\\d+:double/.test(transformed?.code ?? ""), detail: "no instrumentation in the transformed module" };
    await server.close();
  } catch (error) {
    result.dev = { ok: false, detail: String(error).slice(0, 300) };
  }
}

console.log("RESULT " + JSON.stringify(result));
process.exit(0);
`;

const packageJson = JSON.parse(await readFile(path.join(repository, "package.json"), "utf8"));
const declaredMajors = [...String(packageJson.peerDependencies.vite).matchAll(/\^(\d+)\./g)].map((match) => match[1]);
if (declaredMajors.length === 0) throw new Error("No Vite majors found in the peerDependencies range");
const majors = onlyMajors ? declaredMajors.filter((major) => onlyMajors.includes(major)) : declaredMajors;
if (majors.length === 0) throw new Error(`None of ${onlyMajors} is in the peer range ${packageJson.peerDependencies.vite}`);

const work = await realpath(await mkdtemp(path.join(tmpdir(), "rtk-vite-compat-")));
const packed = await run(`npm pack --silent --pack-destination "${work}"`, { cwd: repository, maxBuffer: 1 << 26 });
const tarball = path.join(work, packed.stdout.trim().split("\n").pop());

async function check(major) {
  const row = { vite: `^${major}`, installed: "", install: "ok", build: "ok", dev: "ok", types: "ok" };
  const dir = path.join(work, `vite${major}`);
  await mkdir(path.join(dir, "src"), { recursive: true });
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: `consumer-vite${major}`, private: true, type: "module" }));
  await writeFile(path.join(dir, "src", "entry.ts"), entry);
  await writeFile(path.join(dir, "vite.config.ts"), viteConfig);
  await writeFile(path.join(dir, "tsconfig.json"), tsconfig);
  await writeFile(path.join(dir, "runner.mjs"), runner);

  try {
    await run(`npm install --no-audit --no-fund "${tarball}" vite@${major} @types/node@20`, { cwd: dir, maxBuffer: 1 << 26 });
  } catch (error) {
    const text = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    row.install = /ERESOLVE/.test(text) ? "FAIL peer conflict (ERESOLVE)" : `FAIL ${text.split("\n").find((line) => /npm (error|ERR)/.test(line)) ?? error.message}`.slice(0, 200);
    row.build = row.dev = row.types = "skipped";
    return row;
  }
  row.installed = JSON.parse(await readFile(path.join(dir, "node_modules", "vite", "package.json"), "utf8")).version;

  for (const phase of ["build", "dev"]) {
    try {
      const { stdout } = await run(`${nodeCommand} runner.mjs ${phase}`, { cwd: dir, maxBuffer: 1 << 26 });
      const parsed = JSON.parse(stdout.split("\n").find((line) => line.startsWith("RESULT ")).slice(7));
      row.node = parsed.node;
      row[phase] = parsed[phase].ok ? "ok" : `FAIL ${parsed[phase].detail}`.slice(0, 200);
    } catch (error) {
      row[phase] = `FAIL ${String(error.stderr ?? error.message).split("\n").slice(0, 2).join(" ")}`.slice(0, 200);
    }
  }

  try {
    await run("node node_modules/typescript/bin/tsc -p tsconfig.json", { cwd: dir, maxBuffer: 1 << 26 });
  } catch (error) {
    row.types = `FAIL ${String(error.stdout ?? error.message).split("\n")[0]}`.slice(0, 200);
  }
  return row;
}

let rows;
try {
  rows = await Promise.all(majors.map(check));
} finally {
  await rm(work, { recursive: true, force: true });
}

console.log(`Node for the build and dev-server checks: ${nodeCommand}`);
console.table(rows);
const failures = rows.filter((row) => [row.install, row.build, row.dev, row.types].some((value) => value !== "ok"));
if (failures.length > 0) {
  console.error(`Compatibility check failed for Vite ${failures.map((row) => row.vite).join(", ")}.`);
  process.exit(1);
}
console.log(`Compatible with Vite ${majors.map((major) => `^${major}`).join(", ")} (declared range: ${packageJson.peerDependencies.vite}).`);
