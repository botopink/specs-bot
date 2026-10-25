// The read model: the store plus the cross-indexes every reader needs, built once per load.
// The api answers from it and the site renders it; neither re-reads the files.
import type { ChatMessage } from "./chat/chat.ts";
import type { PendingEntry } from "./decisions/pending.ts";
import { pendingEntries } from "./decisions/pending.ts";
import type { RetiredRow } from "./decisions/retired.ts";
import { nextFree, statedNextFree, type StepRow } from "./decisions/steps.ts";
import type { Subject } from "./decisions/taken.ts";
import type { Doc } from "./docs/doc.ts";
import { buildIndex, type SearchIndex } from "./search.ts";
import { loadStore, type Store } from "./store.ts";

export interface Front {
  version: string;
  machine?: string;
  num: number;
  slug: string;
  /** The front's directory ref: "1.0.12-beta/machine-1/150-rakun". */
  ref: string;
  title: string;
  readme?: string;
  docs: string[];
}

export interface Model extends Store {
  stepByNum: Map<number, StepRow>;
  entries: PendingEntry[];
  subjectBySlug: Map<string, Subject>;
  docByRef: Map<string, Doc>;
  messageById: Map<string, ChatMessage>;
  /** step → the subjects whose `Steps:` cite it */
  subjectsByStep: Map<number, Subject[]>;
  /** step → the retired rows whose Decisions cell cites it */
  retiredByStep: Map<number, RetiredRow[]>;
  /** step → the rows it overtook, replaced or reversed */
  supersedes: Map<number, StepRow[]>;
  /** a pending id → the step that answered it */
  answeredBy: Map<string, number>;
  /** The fronts of every milestone, by the directory that holds them. */
  fronts: Front[];
  nextFree: number;
  statedNextFree: { steps?: number; pending?: number };
  /** Built on first use (about a second over the real data). */
  readonly index: SearchIndex;
}

export function loadModel(dataPath: string): Model {
  return buildModel(loadStore(dataPath));
}

export function buildModel(store: Store): Model {
  const { steps, pending, taken, retired, tree, chat } = store;

  const subjectsByStep = new Map<number, Subject[]>();
  for (const s of taken.subjects) for (const n of s.steps) push(subjectsByStep, n, s);
  const retiredByStep = new Map<number, RetiredRow[]>();
  for (const r of retired.rows) for (const n of r.steps) push(retiredByStep, n, r);
  const supersedes = new Map<number, StepRow[]>();
  for (const r of steps.rows) if (r.supersededBy !== undefined) push(supersedes, r.supersededBy, r);
  const answeredBy = new Map<string, number>();
  for (const r of steps.rows) {
    for (const id of r.id.split(" · ")[0]!.split(",").map((s) => s.trim())) if (id) answeredBy.set(id, r.num);
  }

  const stated: Model["statedNextFree"] = {};
  if (steps.statedNextFree !== undefined) stated.steps = steps.statedNextFree;
  const pendingStated = statedNextFree(pending.head.join("\n"));
  if (pendingStated !== undefined) stated.pending = pendingStated;

  let index: SearchIndex | undefined;
  return {
    ...store,
    stepByNum: new Map(steps.rows.map((r) => [r.num, r])),
    entries: pendingEntries(pending),
    subjectBySlug: new Map(taken.subjects.map((s) => [s.slug, s])),
    docByRef: new Map(tree.docs.map((d) => [d.ref, d])),
    messageById: new Map(chat.map((m) => [m.id, m])),
    subjectsByStep,
    retiredByStep,
    supersedes,
    answeredBy,
    fronts: frontsOf(tree.docs),
    nextFree: nextFree(steps),
    statedNextFree: stated,
    get index() {
      return (index ??= buildIndex(store));
    },
  };
}

/** A front is the first numbered directory under a milestone (or its machine); its README titles it. */
function frontsOf(docs: Doc[]): Front[] {
  const byRef = new Map<string, Front>();
  for (const d of docs) {
    if (!d.front) continue;
    const parts = d.ref.split("/");
    const at = parts.indexOf(d.front.dir);
    const ref = parts.slice(0, at + 1).join("/");
    let f = byRef.get(ref);
    if (!f) {
      f = { version: d.version, num: d.front.num, slug: d.front.slug, ref, title: parts[at]!, docs: [], ...(d.machine ? { machine: d.machine } : {}) };
      byRef.set(ref, f);
    }
    f.docs.push(d.ref);
    if (d.ref === `${ref}/README`) {
      f.readme = d.ref;
      f.title = d.title;
    }
  }
  return [...byRef.values()].sort((a, b) => a.version.localeCompare(b.version) || a.num - b.num || a.ref.localeCompare(b.ref));
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
