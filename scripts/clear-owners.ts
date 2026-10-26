#!/usr/bin/env bun
// Every front starts with no owner (the maintainer, 2026-10-26): `owner` comes back only when a machine claims a
// front (specs-bot claim) or the maintainer assigns it, and only on the front's README. Removes the key from every
// spec document's metadata block; the rest of each file is left as it was.
//
//   bun scripts/clear-owners.ts <specs-data checkout>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { splitMeta, withMeta } from "../packages/core/src/docs/meta.ts";

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && p.endsWith(".md")) yield p;
  }
}

const data = process.argv[2];
if (!data) {
  console.error("usage: clear-owners.ts <specs-data checkout>");
  process.exit(2);
}
const specs = join(data, "specs");
let cleared = 0;
for (const file of walk(specs)) {
  const rel = relative(specs, file);
  if (!rel.includes("/") || rel.includes("/examples/")) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  const { meta, end } = splitMeta(lines);
  if (!("owner" in meta)) continue;
  const { owner: _, ...rest } = meta;
  const next = withMeta(lines, rest);
  if (next.slice(splitMeta(next).end).join("\n") !== lines.slice(end).join("\n")) throw new Error(`${rel}: the body changed`);
  writeFileSync(file, next.join("\n"));
  cleared++;
}
console.log(`${cleared} documents lost their owner`);
