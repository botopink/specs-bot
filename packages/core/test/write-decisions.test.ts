import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  answer,
  buildModel,
  check,
  loadStore,
  markReviewed,
  type Model,
  type Plan,
  pendingAdd,
  pendingEdit,
  pendingEtag,
  pendingWithdraw,
  refile,
  retiredAdd,
  setCell,
  subjectNew,
  supersede,
  WriteError,
} from "../src/index.ts";

// decisions-taken/README.md + one file per group (group.ts), the layout answer/supersede/setCell/refile/
// subjectNew assume. "lang" carries prose (lead, a paragraph, Steps, Binds) and two rows; "unfiled" is a
// plain group — the shape a subject never has (store.ts's loadRecord skips it as a Subject).
const README = `# Decisions taken

The rules in force. **The next free number is 3.**

## Groups

- lang
- unfiled
`;

const LANG = `# lang — the language

**Lead.**

(1) Text (1).

Steps: 1, 2
Binds: x

## Record

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
| 1 | q-1 · (the maintainer, 2026-10-01) | **A rule.** | \`machine-1/150\` s3 |  |
| 2 | q-2 · (the maintainer, 2026-10-02) | **Another rule.** | x | another_rule |
`;

const UNFILED = `# unfiled — not yet grouped

## Record

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
`;

const PENDING = `# Pending

the next free
number, which is **3**.

## To review

| Reviewed | Row | Answered | What |
|---|---|---|---|
| [ ] | 2 | q-2 | Another rule. |

## Machine 1 — maximum priority (front 144)

#### q-9 · Does it narrow?
- **Measured.** Built.
- **Options.** (a) yes; (b) no.
- **Recommendation.** (a).
- **Blocks.** Nothing.

## Machine 2 — maximum priority (front 144)

None open.
`;

const RETIRED = `# Retired

## Language spellings

| Retired | Replaced by | Decisions | Since / note |
|---|---|---|---|
| \`old\` | \`new\` | 1 |  |

## Process and files

| Retired | Replaced by | Decisions | Since / note |
|---|---|---|---|
| a | b | 2 |  |
`;

const FILES: Record<string, string> = {
  "specs/decisions-taken/README.md": README,
  "specs/decisions-taken/lang.md": LANG,
  "specs/decisions-taken/unfiled.md": UNFILED,
  "specs/decisions-pending.md": PENDING,
  "specs/retired.md": RETIRED,
  "specs/milestone/README.md": "---\nmilestone: 1.0.12-beta\n---\n# Specs\n",
};

function write(root: string, files: Record<string, string>): void {
  for (const [p, t] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), t);
  }
}

// Each model is built over its own temp directory (the pattern store.test.ts uses for the new layout), so a
// write's Plan — whose Change.path is a real file under decisions-taken/ — can be re-applied and reloaded the
// same way the api would. filesOf remembers which files built a given Model, so `applied` can start from them.
const filesOf = new WeakMap<Model, Record<string, string>>();

function rebuild(files: Record<string, string>): Model {
  const root = mkdtempSync(join(tmpdir(), "specs-bot-wd-"));
  write(root, files);
  const m = buildModel(loadStore(root));
  filesOf.set(m, files);
  return m;
}

function model(over: Record<string, string> = {}): Model {
  return rebuild({ ...FILES, ...over });
}

/** The model over the data a plan leaves, as the writer would load it. */
function applied(m: Model, plan: Plan): Model {
  const files = { ...filesOf.get(m)! };
  for (const c of plan.changes) files[c.path] = c.after;
  return rebuild(files);
}

function refused(fn: () => unknown): WriteError {
  try {
    fn();
  } catch (e) {
    if (e instanceof WriteError) return e;
    throw e;
  }
  throw new Error("not refused");
}

const FIELDS = { Measured: "Built as (a).", Options: "(a) keep; (b) refuse.", Recommendation: "(b).", Blocks: "Nothing." };
const errors = (m: Model) => check(m).filter((f) => f.severity === "error");

describe("pendingAdd", () => {
  test("a block at the end of the section, its four fields in order", () => {
    const after = applied(model(), pendingAdd(model(), { id: "q-10", section: "Machine 2", title: "Keep it?", fields: FIELDS }));
    const e = after.entries.find((x) => x.id === "q-10")!;
    expect(e.section).toStartWith("Machine 2");
    expect(e.fields.map((f) => f.name)).toEqual(["Measured", "Options", "Recommendation", "Blocks"]);
    expect(errors(after)).toEqual([]);
  });

  test("multi-line field text continues indented", () => {
    const p = pendingAdd(model(), { id: "q-10", section: "Machine 2", title: "T", fields: { ...FIELDS, Measured: "one\ntwo" } });
    expect(p.changes[0]!.after).toContain("- **Measured.** one\n  two\n");
  });

  test("refuses a reused id, an open id, a missing field, an unknown section", () => {
    expect(refused(() => pendingAdd(model(), { id: "q-2", section: "Machine 2", title: "T", fields: FIELDS })).message).toContain("answered by step 2");
    expect(refused(() => pendingAdd(model(), { id: "q-9", section: "Machine 2", title: "T", fields: FIELDS })).message).toContain("already open");
    expect(refused(() => pendingAdd(model(), { id: "q-10", section: "Machine 2", title: "T", fields: { Measured: "x" } })).message).toContain("missing: Options");
    expect(refused(() => pendingAdd(model(), { id: "q-10", section: "Machine", title: "T", fields: FIELDS })).message).toContain("names 2 sections");
    expect(refused(() => pendingAdd(model(), { id: "q-10", section: "Machine 7", title: "T", fields: FIELDS })).message).toContain("no pending section");
  });
});

test("a section is found by its name before a heading that only mentions it", () => {
  const pending = PENDING.replace("## Machine 2", "## Blocking now — machine 1 and front 165\n\nNone open.\n\n## Machine 2");
  const p = pendingAdd(model({ "specs/decisions-pending.md": pending }), { id: "q-10", section: "machine 1", title: "T", fields: FIELDS });
  expect(p.summary).toBe("open question q-10 in § Machine 1");
});

describe("pendingEdit and pendingWithdraw", () => {
  test("one field replaced, the rest kept", () => {
    const m = model();
    const e = m.entries[0]!;
    const after = applied(m, pendingEdit(m, { id: "q-9", etag: pendingEtag(e), fields: { Recommendation: "(b), after all." } }));
    expect(after.entries[0]!.fields.map((f) => f.text)).toEqual(["Built.", "(a) yes; (b) no.", "(b), after all.", "Nothing."]);
  });

  test("a stale etag is a conflict", () => {
    expect(refused(() => pendingEdit(model(), { id: "q-9", etag: "x", title: "T" })).code).toBe("conflict");
  });

  test("withdrawn: the block leaves, the page stays well spaced", () => {
    const p = pendingWithdraw(model(), { id: "q-9", reason: "answered in chat" });
    expect(p.changes[0]!.after).toContain("## Machine 1 — maximum priority (front 144)\n\n## Machine 2");
    expect(p.message).toBe("spec: question q-9 withdrawn — answered in chat");
  });
});

describe("answer", () => {
  test("by the maintainer: the row, the next free number in both files, the question gone", () => {
    const m = model();
    const p = answer(m, { id: "q-9", rule: "**It narrows.** (1) Both | ways.", binds: "`machine-1/144` B-162", cell: "it_narrows", at: new Date(2026, 9, 25) }, "maintainer");
    const after = applied(m, p);
    const row = after.stepByNum.get(3)!;
    expect([row.id, row.rule, row.cell]).toEqual(["q-9 · (the maintainer, 2026-10-25)", "**It narrows.** (1) Both \\| ways.", "it_narrows"]);
    expect([after.nextFree, after.statedNextFree]).toEqual([4, { steps: 4, pending: 4 }]);
    expect(after.entries.map((e) => e.id)).toEqual([]);
    expect(after.pending.review.map((r) => r.step)).toEqual([2]);
    expect(errors(after)).toEqual([]);
    expect(p.message).toBe("spec: row 3 answers q-9");
    // With no --subject, the row lands in "unfiled" (already there in this fixture) — no other group touched.
    expect(p.changes.map((c) => c.path).sort()).toEqual(["specs/decisions-pending.md", "specs/decisions-taken/README.md", "specs/decisions-taken/unfiled.md"]);
    expect(after.stepByNum.get(3)!.section).toBe("unfiled");
  });

  test("by a machine: the coordinator †, and marked for the maintainer's review", () => {
    const m = model();
    const after = applied(m, answer(m, { id: "q-9", rule: "**It narrows.** More.", binds: "x" }, "machine-2"));
    expect(after.stepByNum.get(3)!.delegated).toBe(true);
    expect(after.pending.review.at(-1)).toMatchObject({ step: 3, answered: "q-9", summary: "It narrows.", reviewed: false });
  });

  test("joins a subject: its Steps and Binds, and a sentence — touching only that group, the README and pending", () => {
    const m = model();
    const p = answer(m, { id: "q-9", rule: "R.", binds: "y", subject: "lang", subjectText: "(2) It narrows (3)." }, "maintainer");
    expect(p.changes.map((c) => c.path).sort()).toEqual(["specs/decisions-pending.md", "specs/decisions-taken/README.md", "specs/decisions-taken/lang.md"]);
    const after = applied(m, p);
    const s = after.subjectBySlug.get("lang")!;
    expect([s.steps, s.binds, s.paragraphs.at(-1)]).toEqual([[1, 2, 3], "x · y", "(2) It narrows (3)."]);
    expect(after.stepByNum.get(3)!.section).toBe("lang");
    expect(errors(after)).toEqual([]);
  });

  test("a new ruling no question asked keeps the page as it is but its number", () => {
    const m = model();
    const after = applied(m, answer(m, { id: "b9-a", rule: "R.", binds: "x" }, "maintainer"));
    expect(after.entries.map((e) => e.id)).toEqual(["q-9"]);
    expect(after.answeredBy.get("b9-a")).toBe(3);
  });

  test("refuses an id already answered", () => {
    expect(refused(() => answer(model(), { id: "q-1", rule: "R.", binds: "x" }, "maintainer")).message).toContain("already answered by step 1");
  });

  test("refuses an unknown --subject (only unfiled is ever auto-created)", () => {
    expect(refused(() => answer(model(), { id: "q-9", rule: "R.", binds: "x", subject: "ghost" }, "maintainer")).code).toBe("not-found");
  });
});

describe("supersede, review, retired, setCell", () => {
  test("a row is overtaken by a later one, its text kept, only its own group touched", () => {
    const m = applied(model(), answer(model(), { id: "q-9", rule: "R.", binds: "x" }, "maintainer"));
    const p = supersede(m, { num: 1, by: 3, kind: "overtaken" });
    expect(p.changes.map((c) => c.path)).toEqual(["specs/decisions-taken/lang.md"]);
    const after = applied(m, p);
    expect(after.stepByNum.get(1)!).toMatchObject({ status: "overtaken", supersededBy: 3 });
    expect(after.stepByNum.get(1)!.rule).toBe("Overtaken by 3 (the later row in force, 730); the text as decided: **A rule.**");
  });

  test("refuses an earlier row, an unknown row, a row already superseded", () => {
    expect(refused(() => supersede(model(), { num: 2, by: 1, kind: "replaced" })).message).toContain("by a later one");
    expect(refused(() => supersede(model(), { num: 1, by: 9, kind: "replaced" })).code).toBe("not-found");
  });

  test("set-cell changes the Cell alone (1022), only its own group touched", () => {
    for (const value of ["tests/runtime_reuse.sh", "conformance/run.sh --self-test", "a_cell"]) {
      const p = setCell(model(), { num: 1, value });
      expect(p.op).toBe("step.cell");
      expect(p.changes.map((c) => c.path)).toEqual(["specs/decisions-taken/lang.md"]);
      const row = applied(model(), p).stepByNum.get(1)!;
      expect(row.cell).toBe(value);
      expect(p.changes[0]!.after).toContain(`| 1 | q-1 · (the maintainer, 2026-10-01) | **A rule.** | \`machine-1/150\` s3 | ${value} |`);
    }
    expect(applied(model(), setCell(model(), { num: 2, value: "tests/x.sh" })).stepByNum.get(2)!.rule).toBe("**Another rule.**");
  });

  test("set-cell refuses an unknown row, a bad value, the same value", () => {
    expect(refused(() => setCell(model(), { num: 9, value: "a" })).code).toBe("not-found");
    for (const value of ["", "Bad", "a-b", "tests/x", "tests/a/b.sh", "conformance/run.sh", "x | y"]) expect(refused(() => setCell(model(), { num: 1, value })).code).toBe("invalid");
    expect(refused(() => setCell(model(), { num: 2, value: "another_rule" })).message).toContain("already");
  });

  test("only the maintainer marks a review item", () => {
    expect(refused(() => markReviewed(model(), { num: 2 }, "machine-1")).code).toBe("forbidden");
    expect(applied(model(), markReviewed(model(), { num: 2 }, "maintainer")).pending.review[0]!.reviewed).toBe(true);
  });

  test("a retired form joins its area's table; its decisions must exist", () => {
    const after = applied(model(), retiredAdd(model(), { area: "process", retired: "x", replacedBy: "y", decisions: "2 (1)" }));
    expect(after.retired.rows.map((r) => `${r.area}:${r.retired}`)).toEqual(["Language spellings:`old`", "Process and files:a", "Process and files:x"]);
    expect(refused(() => retiredAdd(model(), { area: "process", retired: "x", replacedBy: "y", decisions: "77" })).message).toContain("77");
  });
});

describe("refile", () => {
  test("moves the row to another group, leaving the rest of that group and every other group untouched", () => {
    const m = model();
    const p = refile(m, { num: 1, to: "unfiled" });
    expect(p.changes.map((c) => c.path).sort()).toEqual(["specs/decisions-taken/lang.md", "specs/decisions-taken/unfiled.md"]);
    const after = applied(m, p);
    expect(after.stepByNum.get(1)!.section).toBe("unfiled");
    expect(after.stepByNum.get(2)!.section).toBe("lang");
    // Home moved; the citation in lang's own Steps: is untouched (home and citation are independent).
    expect(after.subjectBySlug.get("lang")!.steps).toEqual([1, 2]);
    expect(errors(after)).toEqual([]);
  });

  test("--cite adds the row to a group with no Steps: line yet", () => {
    const m = model();
    const after = applied(m, refile(m, { num: 1, to: "unfiled", cite: true }));
    const g = after.record!.groups.get("unfiled")!;
    expect(g.steps).toEqual([1]);
  });

  const WITH_STD: Record<string, string> = {
    ...FILES,
    "specs/decisions-taken/README.md": "# Decisions taken\n\nThe rules in force. **The next free number is 3.**\n\n## Groups\n\n- lang\n- std\n- unfiled\n",
    "specs/decisions-taken/std.md":
      "# std — the standard library's surface\n\n**What std holds.**\n\nSteps: 2\nBinds: std\n\n## Record\n\n| # | Id | Rule in force | Binds | Cell |\n|---|---|---|---|---|\n",
  };

  test("--cite extends an existing Steps: list", () => {
    const m = model(WITH_STD);
    const after = applied(m, refile(m, { num: 1, to: "std", cite: true }));
    expect(after.subjectBySlug.get("std")!.steps).toEqual([2, 1]);
    expect(after.stepByNum.get(1)!.section).toBe("std");
    // lang still cites 1 in its own Steps: (refile moved the row's home, not the citation elsewhere).
    expect(after.subjectBySlug.get("lang")!.steps).toEqual([1, 2]);
  });

  test("--cite is a no-op on Steps: when the destination already cites the row — no duplicate", () => {
    const m = model(WITH_STD);
    const after = applied(m, refile(m, { num: 2, to: "std", cite: true }));
    expect(after.subjectBySlug.get("std")!.steps).toEqual([2]);
    expect(after.stepByNum.get(2)!.section).toBe("std");
  });

  test("refuses moving a row to the group it already lives in, an unknown destination, or an unknown row", () => {
    expect(refused(() => refile(model(), { num: 1, to: "lang" })).message).toContain("already in lang");
    expect(refused(() => refile(model(), { num: 1, to: "ghost" })).code).toBe("not-found");
    expect(refused(() => refile(model(), { num: 99, to: "unfiled" })).code).toBe("not-found");
  });
});

describe("subjectNew", () => {
  test("creates the group file and lists it in the README right before unfiled", () => {
    const m = model();
    const p = subjectNew(m, { slug: "std", summary: "the standard library's surface", lead: "What std holds.", binds: "std" });
    expect(p.changes.map((c) => c.path)).toEqual(["specs/decisions-taken/std.md", "specs/decisions-taken/README.md"]);
    expect(p.changes[0]!.before).toBeNull();
    const after = applied(m, p);
    expect([...after.record!.groups.keys()]).toEqual(["lang", "std", "unfiled"]);
    expect(after.record!.readme.order).toEqual(["lang", "std", "unfiled"]);
    const g = after.record!.groups.get("std")!;
    expect([g.summary, g.lead, g.steps, g.binds]).toEqual(["the standard library's surface", "What std holds.", [], "std"]);
  });

  test("with no lead and no binds, Steps: is still written, empty, and parses as no steps", () => {
    const m = model();
    const after = applied(m, subjectNew(m, { slug: "runtime", summary: "the runtime" }));
    const g = after.record!.groups.get("runtime")!;
    expect([g.lead, g.paragraphs, g.steps, g.binds]).toEqual(["", [], [], ""]);
  });

  test("goes to the end of the list when unfiled is not listed", () => {
    const files = { ...FILES, "specs/decisions-taken/README.md": README.replace("- unfiled\n", "") };
    const m = model(files);
    const p = subjectNew(m, { slug: "std", summary: "s" });
    expect(p.changes[1]!.after.trim().endsWith("- std")).toBe(true);
  });

  test("refuses a duplicate slug, a reserved slug, a bad slug", () => {
    expect(refused(() => subjectNew(model(), { slug: "lang", summary: "s" })).message).toContain("already exists");
    expect(refused(() => subjectNew(model(), { slug: "unfiled", summary: "s" })).message).toContain("reserved");
    expect(refused(() => subjectNew(model(), { slug: "readme", summary: "s" })).message).toContain("reserved");
    expect(refused(() => subjectNew(model(), { slug: "Not-OK", summary: "s" })).code).toBe("invalid");
  });
});

// The compact layout: a group whose file opens with a metadata block (decisions/meta.ts). Every write that
// touches its rows keeps the block's derived keys current; a group without a block is left as it always was.
describe("a group with a metadata block", () => {
  const block = (over: Record<string, string> = {}) =>
    [
      "---",
      "scope: >-",
      "  What the language decides.",
      "terms:",
      "  - '`old`'",
      "related: []",
      "binds:",
      `  - ${over.binds ?? "'`machine-1/150` s3'"}`,
      "retired:",
      ...(over.retired ?? "  - '`old`'\n  - 'a'").split("\n"),
      `first-step: ${over.first ?? 1}`,
      `last-step: ${over.last ?? 2}`,
      `in-force: ${over.force ?? 2}`,
      `superseded: ${over.gone ?? 0}`,
      "---",
    ].join("\n");
  const compact = () => model({ "specs/decisions-taken/lang.md": `${block()}\n${LANG}` });
  const metaOf = (m: Model, slug: string) => m.record.groups.get(slug)!.meta!;
  const groupWarnings = (m: Model) => check(m).filter((f) => f.code.startsWith("group-"));

  test("the fixture's block is current: no group finding", () => {
    expect(groupWarnings(compact())).toEqual([]);
  });

  test("answer into it moves last-step and in-force; the hand keys stay as written", () => {
    const m = compact();
    const after = applied(m, answer(m, { id: "q-7", rule: "**New.**", binds: "`04-js`", subject: "lang" }, "maintainer"));
    expect(metaOf(after, "lang")).toMatchObject({ scope: "What the language decides.", terms: ["`old`"], "last-step": 3, "in-force": 3, binds: ["`04-js`", "`machine-1/150` s3"] });
    expect(groupWarnings(after)).toEqual([]);
  });

  test("supersede writes only the stub, and moves in-force and superseded", () => {
    const m = applied(compact(), answer(compact(), { id: "q-9", rule: "R.", binds: "x" }, "maintainer"));
    const after = applied(m, supersede(m, { num: 1, by: 3, kind: "overtaken" }));
    expect(after.stepByNum.get(1)!).toMatchObject({ status: "overtaken", supersededBy: 3, rule: "Overtaken by 3" });
    expect(metaOf(after, "lang")).toMatchObject({ "in-force": 1, superseded: 1, binds: [] });
    expect(groupWarnings(after)).toEqual([]);
  });

  test("refile recomputes the block it leaves; a group without a block is not given one", () => {
    const m = compact();
    const p = refile(m, { num: 1, to: "unfiled" });
    const after = applied(m, p);
    expect(metaOf(after, "lang")).toMatchObject({ "first-step": 2, "last-step": 2, "in-force": 1, retired: ["a"], binds: [] });
    expect(p.changes.find((c) => c.path.endsWith("unfiled.md"))!.after.startsWith("# unfiled")).toBe(true);
    expect(groupWarnings(after)).toEqual([]);
  });

  test("a new retired form lands in the block of every group whose rows it cites", () => {
    const m = compact();
    const p = retiredAdd(m, { area: "process", retired: "z", replacedBy: "w", decisions: "2" });
    expect(p.changes.map((c) => c.path)).toEqual(["specs/retired.md", "specs/decisions-taken/lang.md"]);
    const after = applied(m, p);
    expect(metaOf(after, "lang").retired).toEqual(["`old`", "a", "z"]);
    expect(groupWarnings(after)).toEqual([]);
  });

  test("a malformed block is left as written (check reports it), never rewritten by a write", () => {
    const bad = model({ "specs/decisions-taken/lang.md": `${block().replace("scope: >-\n  What the language decides.\n", "scope: ''\n")}\n${LANG}` });
    const p = answer(bad, { id: "q-7", rule: "**New.**", binds: "x", subject: "lang" }, "maintainer");
    expect(p.changes[0]!.after).toContain("last-step: 2");
  });
});
