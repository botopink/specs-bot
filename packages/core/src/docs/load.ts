// Reads every spec document under <data>/specs. Only the api process calls this (PLAN.md § 3).
// A document's milestone and machine are the nearest `**Milestone:**` / `**Machine:**` fields from its own
// README up to its front's; the current milestone is the one `milestone/README.md` names.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { type Doc, parseDoc } from "./doc.ts";

export interface DocTree {
  docs: Doc[];
  /** Every milestone a front names, oldest first. */
  versions: string[];
  /** The milestone being worked on; every other is frozen. */
  current: string;
  /** The milestone and owner of a path under specs/ (a folder or a file). */
  placeOf(path: string): { version: string; owner?: string };
  /** Old refs (`1.0.12-beta/machine-1/150-rakun/README`) → their ref now, or a permalink when the file is gone. */
  moved: Map<string, string>;
}

export const MILESTONE_DIR = "milestone";

export function loadDocs(specsDir: string): DocTree {
  const docs: Doc[] = [];
  for (const file of walk(specsDir)) {
    const path = relative(specsDir, file);
    if (file.endsWith(".md") && path.includes("/")) docs.push(parseDoc(path, readFileSync(file, "utf8")));
  }
  const movedFile = join(specsDir, "..", "moved.json");
  const moved = new Map<string, string>(
    existsSync(movedFile) ? Object.entries(JSON.parse(readFileSync(movedFile, "utf8")) as Record<string, string>) : [],
  );
  return placeDocs(docs, moved);
}

/** Fills each document's version and owner from the fields above it (also for trees built in memory). */
export function placeDocs(docs: Doc[], moved = new Map<string, string>()): DocTree {
  const readmes = new Map(docs.filter((d) => d.name === "README").map((d) => [d.ref.slice(0, -"/README".length), d]));
  const current = readmes.get(MILESTONE_DIR)?.fields.milestone ?? "";

  const placeOf = (path: string): { version: string; owner?: string } => {
    const parts = path.replace(/\.md$/, "").split("/");
    let version: string | undefined;
    let owner: string | undefined;
    for (let i = parts.length; i > 0 && (!version || !owner); i--) {
      const f = readmes.get(parts.slice(0, i).join("/"))?.fields;
      version ??= f?.milestone;
      owner ??= f?.owner;
    }
    // The milestone's own documents: machine-N.md is that machine's page.
    if (parts[0] === MILESTONE_DIR && /^machine-\d+$/.test(parts[1] ?? "")) owner ??= parts[1];
    return { version: version ?? current, ...(owner ? { owner } : {}) };
  };

  for (const d of docs) {
    const own = d.fields;
    const at = placeOf(d.ref.split("/").slice(0, -1).join("/"));
    d.version = own.milestone ?? at.version;
    const owner = own.owner ?? at.owner ?? (d.ref.startsWith(`${MILESTONE_DIR}/machine-`) ? d.name : undefined);
    if (owner) d.owner = owner;
    else delete d.owner;
  }
  const versions = [...new Set(docs.map((d) => d.version).filter(Boolean))].sort(compareVersions);
  return { docs, versions, current: current || (versions.at(-1) ?? ""), placeOf, moved };
}

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith(".")) continue;
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
