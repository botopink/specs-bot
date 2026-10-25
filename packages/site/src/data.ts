// The site's read model: every parser's output, loaded once at startup, with the cross-indexes the pages need.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Doc,
  type DocTree,
  type PendingDoc,
  type PendingEntry,
  type RetiredDoc,
  type RetiredRow,
  type StepRow,
  type StepsDoc,
  type Subject,
  type TakenDoc,
  loadDocs,
  nextFree,
  parsePending,
  parseRetired,
  parseSteps,
  parseTaken,
  pendingEntries,
  statedNextFree,
} from "@specs-bot/core";

export interface SiteData {
  steps: StepsDoc;
  pending: PendingDoc;
  taken: TakenDoc;
  retired: RetiredDoc;
  tree: DocTree;
  stepByNum: Map<number, StepRow>;
  entries: PendingEntry[];
  subjectBySlug: Map<string, Subject>;
  docByRef: Map<string, Doc>;
  /** step → the subjects whose `Steps:` cite it */
  subjectsByStep: Map<number, Subject[]>;
  /** step → the retired rows whose Decisions cell cites it */
  retiredByStep: Map<number, RetiredRow[]>;
  /** step → the rows it overtook, replaced or reversed */
  supersedes: Map<number, StepRow[]>;
  nextFree: number;
  statedNextFree: { steps?: number; pending?: number };
}

export type Loaded = { ok: true; data: SiteData } | { ok: false; error: string };

export function loadSiteData(dataPath: string): Loaded {
  try {
    return { ok: true, data: buildSiteData(join(dataPath, "specs")) };
  } catch (e) {
    // The message may name a file under the data path; the pages show only that loading failed.
    console.error(`specs-bot site: data not loaded: ${(e as Error).message}`);
    return { ok: false, error: "the specs could not be read" };
  }
}

export function buildSiteData(specsDir: string): SiteData {
  const read = (name: string) => readFileSync(join(specsDir, name), "utf8");
  const pendingText = read("decisions-pending.md");
  const steps = parseSteps(read("decisions-taken-steps.md"));
  const pending = parsePending(pendingText);
  const taken = parseTaken(read("decisions-taken.md"));
  const retired = parseRetired(read("retired.md"));
  const tree = loadDocs(specsDir);

  const subjectsByStep = new Map<number, Subject[]>();
  for (const s of taken.subjects) for (const n of s.steps) push(subjectsByStep, n, s);
  const retiredByStep = new Map<number, RetiredRow[]>();
  for (const r of retired.rows) for (const n of r.steps) push(retiredByStep, n, r);
  const supersedes = new Map<number, StepRow[]>();
  for (const r of steps.rows) if (r.supersededBy !== undefined) push(supersedes, r.supersededBy, r);

  const stated: SiteData["statedNextFree"] = {};
  if (steps.statedNextFree !== undefined) stated.steps = steps.statedNextFree;
  const pendingStated = statedNextFree(pendingText);
  if (pendingStated !== undefined) stated.pending = pendingStated;

  return {
    steps,
    pending,
    taken,
    retired,
    tree,
    stepByNum: new Map(steps.rows.map((r) => [r.num, r])),
    entries: pendingEntries(pending),
    subjectBySlug: new Map(taken.subjects.map((s) => [s.slug, s])),
    docByRef: new Map(tree.docs.map((d) => [d.ref, d])),
    subjectsByStep,
    retiredByStep,
    supersedes,
    nextFree: nextFree(steps),
    statedNextFree: stated,
  };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
