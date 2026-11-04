// Everything the bot knows, read once from the specs-data repository. Only the api process calls this.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ChatMessage, loadChat } from "./chat/chat.ts";
import { type GroupDoc, parseGroup, parseRecordReadme, type RecordReadmeDoc } from "./decisions/group.ts";
import { type PendingDoc, parsePending } from "./decisions/pending.ts";
import { type RetiredDoc, parseRetired } from "./decisions/retired.ts";
import type { StepRow, StepsDoc } from "./decisions/steps.ts";
import type { Subject, TakenDoc } from "./decisions/taken.ts";
import { type DocTree, loadDocs } from "./docs/load.ts";

export interface Store {
  /** Absolute path of <data>/specs — kept inside the server, never sent out. */
  specsDir: string;
  steps: StepsDoc;
  pending: PendingDoc;
  pendingPt?: PendingDoc;
  taken: TakenDoc;
  retired: RetiredDoc;
  tree: DocTree;
  chat: ChatMessage[];
  /**
   * The `decisions-taken/` directory: a `README.md` index plus one file per group. `groups` holds every group
   * file `loadStore` could read, keyed by its slug; a slug the README lists with no matching file, or a file on
   * disk the README does not list, is left for `check.ts` to report (`group-missing` / `group-unlisted`) rather
   * than failing here.
   */
  record: { readme: RecordReadmeDoc; groups: Map<string, GroupDoc> };
}

export function loadStore(dataPath: string): Store {
  const specsDir = join(dataPath, "specs");
  const read = (name: string) => readFileSync(join(specsDir, name), "utf8");
  const pt = join(specsDir, "decisoes-pendentes.md");
  const chatDir = join(dataPath, "conversation-chat");
  const recordDir = join(specsDir, "decisions-taken");

  const { steps, taken, record } = loadRecord(recordDir);

  return {
    specsDir,
    steps,
    pending: parsePending(read("decisions-pending.md")),
    ...(existsSync(pt) ? { pendingPt: parsePending(read("decisoes-pendentes.md")) } : {}),
    taken,
    retired: parseRetired(read("retired.md")),
    tree: loadDocs(specsDir),
    chat: existsSync(chatDir) ? loadChat(chatDir) : [],
    record,
  };
}

/**
 * The `decisions-taken/` directory: a `README.md` index (`parseRecordReadme`) naming every group in order, and
 * one `<slug>.md` file per group (`parseGroup`). Reassembles the two old flat files' shapes from it — `steps.rows`
 * in the README's order, numbered as each group has them, and `taken.subjects` with one `Subject` per group that
 * carries prose (a "plain" group — no lead, no paragraphs, no Steps, no Binds, the shape `unfiled.md` takes — is
 * not a subject, the same way it was never a `##` block of `decisions-taken.md`).
 */
function loadRecord(recordDir: string): { steps: StepsDoc; taken: TakenDoc; record: Store["record"] } {
  const readme = parseRecordReadme(readFileSync(join(recordDir, "README.md"), "utf8"));
  const groups = new Map<string, GroupDoc>();
  for (const slug of readme.order) {
    const file = join(recordDir, `${slug}.md`);
    // A listed slug with no file is `check.ts`'s "group-missing" to report; loadStore does not fail over it.
    if (existsSync(file)) groups.set(slug, parseGroup(readFileSync(file, "utf8"), slug));
  }

  const rows: StepRow[] = [];
  const subjects: Subject[] = [];
  for (const slug of readme.order) {
    const g = groups.get(slug);
    if (!g) continue;
    // `group.ts` writes "Record" as every row's section (correct inside the group file's own `## Record`
    // table, where there is only ever the one); the rest of the system (search.ts, the routes) wants the
    // group's slug there instead, so it is rewritten on the way into the combined list.
    for (const row of g.rows) rows.push({ ...row, section: slug });
    if (g.lead || g.paragraphs.length || g.steps.length || g.binds) subjects.push(groupToSubject(g));
  }

  const steps: StepsDoc = {
    // No single file holds every row any more; a consumer wanting "the record's lines" now wants a group's own
    // file (write/decisions.ts, left to the piece that moves it onto `store.record`).
    lines: [],
    rows,
    ...(readme.statedNextFree !== undefined ? { statedNextFree: readme.statedNextFree } : {}),
  };
  const taken: TakenDoc = { lines: [], head: [], subjects };
  return { steps, taken, record: { readme, groups } };
}

/**
 * A group's prose as a `Subject`, mirroring how `taken.ts`'s `parseSubject` fills `lines`/`line` from a subject's
 * own block of `decisions-taken.md`. Here that block is the group file's own prose, `doc.lines.slice(0, proseEnd)`
 * (the `# <slug> — <summary>` heading through the paragraph before `## Record`) — the heading line is kept as
 * written (`#`, not `##`); nothing is rewritten, the fields are only reassigned.
 *
 * Limitation (left for write/decisions.ts's own rewrite, a separate piece): `Subject.line` was an offset into one
 * shared `decisions-taken.md`'s `lines`; a group's prose lives in its own file, so `line` here is only an offset
 * into that group's own `lines` (always 0, the heading is always first) — a caller needs the group's slug
 * alongside it to know which file the offset is into, something `Subject` alone no longer carries.
 */
function groupToSubject(g: GroupDoc): Subject {
  return {
    slug: g.slug,
    summary: g.summary,
    lead: g.lead,
    paragraphs: g.paragraphs,
    steps: g.steps,
    binds: g.binds,
    // The prose starts at the H1: the metadata block above it is no part of the subject's text.
    lines: g.lines.slice(g.metaEnd, g.proseEnd),
    line: 0,
  };
}

// Used by check.ts to compare the README's listing against the directory's actual files (group-unlisted /
// group-missing); kept here, beside loadRecord, since both read the same directory the same way.
export function groupFilesOnDisk(recordDir: string): Set<string> {
  return new Set(
    readdirSync(recordDir)
      .filter((f) => f.endsWith(".md") && f !== "README.md")
      .map((f) => f.slice(0, -".md".length)),
  );
}
