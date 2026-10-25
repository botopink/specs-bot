// Reads every milestone document under <data>/specs. Only the api process calls this (PLAN.md § 3).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { type Doc, parseDoc } from "./doc.ts";

const VERSION_DIR = /^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/;

export interface DocTree {
  docs: Doc[];
  versions: string[];
  /** The newest milestone; every other is frozen. */
  current: string;
}

export function loadDocs(specsDir: string): DocTree {
  const versions = readdirSync(specsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && VERSION_DIR.test(d.name))
    .map((d) => d.name)
    .sort(compareVersions);
  const docs: Doc[] = [];
  for (const v of versions) {
    for (const file of walk(join(specsDir, v))) {
      if (file.endsWith(".md")) docs.push(parseDoc(relative(specsDir, file), readFileSync(file, "utf8")));
    }
  }
  return { docs, versions, current: versions.at(-1) ?? "" };
}

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

/** "1.0.10-beta" after "1.0.5-beta": numeric parts compared as numbers. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    const d = /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : x.localeCompare(y);
    if (d !== 0) return d;
  }
  return 0;
}
