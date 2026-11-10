import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";

const assets = join("dist", "assets");
const files = await readdir(assets);
const main = files.find((file) => /^main-.*\.js$/.test(file));
if (!main) throw new Error("Missing main JavaScript bundle");

const code = await readFile(join(assets, main), "utf8");
const map = JSON.parse(await readFile(join(assets, `${main}.map`), "utf8"));
const sourceIndex = map.sources.findIndex((source) => source.endsWith("src/main.tsx"));
if (sourceIndex < 0 || !map.sourcesContent[sourceIndex]) {
  throw new Error("Consumer source is missing from its production source map");
}

for (const mapName of files.filter((file) => file.endsWith(".js.map"))) {
  const chunkMap = JSON.parse(await readFile(join(assets, mapName), "utf8"));
  if (chunkMap.sources.some((source) => /node_modules\/(typescript|magic-string)\//.test(source))) {
    throw new Error("Build-only compiler dependencies entered a browser bundle");
  }
}

const id = code.indexOf("src/main.tsx:");
const method = code.indexOf(":trackTrace", id);
const position = code.indexOf(".push(", method);
if (id < 0 || method < 0 || position < 0) throw new Error("Missing traced method body");

const generatedLines = code.slice(0, position).split("\n");
const original = originalPositionFor(new TraceMap(map), {
  line: generatedLines.length,
  column: generatedLines.at(-1).length,
});
const sourceLines = map.sourcesContent[sourceIndex].split("\n");
const expectedLine = sourceLines.findIndex((line) => line.includes("received.push(")) + 1;
if (!original.source?.endsWith("src/main.tsx") || original.line !== expectedLine || expectedLine < 1) {
  throw new Error(`Incorrect original source mapping: ${JSON.stringify(original)}`);
}

console.log(`Production mapping verified: ${original.source}:${original.line}:${original.column}`);
console.log("No build-only compiler dependencies appear in browser bundles.");
