import { describe, expect, test } from "bun:test";
import {
  answer,
  buildModel,
  check,
  markReviewed,
  type Model,
  parsePending,
  parseRetired,
  parseSteps,
  parseTaken,
  parseDoc,
  pendingAdd,
  pendingEdit,
  pendingEtag,
  pendingWithdraw,
  placeDocs,
  retiredAdd,
  supersede,
  type Plan,
  WriteError,
} from "../src/index.ts";

const STEPS = `# Steps

**The next free number is 3.**

## L

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
| 1 | q-1 · (the maintainer, 2026-10-01) | **A rule.** | \`machine-1/150\` s3 |  |
| 2 | q-2 · (the maintainer, 2026-10-02) | **Another rule.** | x | another_rule |
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

const TAKEN = `# Taken

## lang — the language

**Lead.**

(1) Text (1).

Steps: 1, 2
Binds: x
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

function model(over: { steps?: string; pending?: string } = {}): Model {
  return buildModel({
    specsDir: "/nowhere",
    steps: parseSteps(over.steps ?? STEPS),
    pending: parsePending(over.pending ?? PENDING),
    taken: parseTaken(TAKEN),
    retired: parseRetired(RETIRED),
    tree: placeDocs([parseDoc("milestone/README.md", "# Specs\n\n**Milestone:** 1.0.12-beta\n")]),
    chat: [],
  });
}

/** The model over the data a plan leaves, as the writer would load it. */
function applied(m: Model, plan: Plan): Model {
  const text = (path: string, now: string) => plan.changes.find((c) => c.path === path)?.after ?? now;
  return buildModel({
    specsDir: "/nowhere",
    steps: parseSteps(text("specs/decisions-taken-steps.md", m.steps.lines.join("\n"))),
    pending: parsePending(text("specs/decisions-pending.md", m.pending.lines.join("\n"))),
    taken: parseTaken(text("specs/decisions-taken.md", m.taken.lines.join("\n"))),
    retired: parseRetired(text("specs/retired.md", m.retired.lines.join("\n"))),
    tree: m.tree,
    chat: [],
  });
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
  const p = pendingAdd(model({ pending }), { id: "q-10", section: "machine 1", title: "T", fields: FIELDS });
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
  });

  test("by a machine: the coordinator †, and marked for the maintainer's review", () => {
    const m = model();
    const after = applied(m, answer(m, { id: "q-9", rule: "**It narrows.** More.", binds: "x" }, "machine-2"));
    expect(after.stepByNum.get(3)!.delegated).toBe(true);
    expect(after.pending.review.at(-1)).toMatchObject({ step: 3, answered: "q-9", summary: "It narrows.", reviewed: false });
  });

  test("joins a subject: its Steps and Binds, and a sentence", () => {
    const m = model();
    const after = applied(m, answer(m, { id: "q-9", rule: "R.", binds: "y", subject: "lang", subjectText: "(2) It narrows (3)." }, "maintainer"));
    const s = after.subjectBySlug.get("lang")!;
    expect([s.steps, s.binds, s.paragraphs.at(-1)]).toEqual([[1, 2, 3], "x · y", "(2) It narrows (3)."]);
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
});

describe("supersede, review, retired", () => {
  test("a row is overtaken by a later one, its text kept", () => {
    const m = applied(model(), answer(model(), { id: "q-9", rule: "R.", binds: "x" }, "maintainer"));
    const after = applied(m, supersede(m, { num: 1, by: 3, kind: "overtaken" }));
    expect(after.stepByNum.get(1)!).toMatchObject({ status: "overtaken", supersededBy: 3 });
    expect(after.stepByNum.get(1)!.rule).toBe("Overtaken by 3 (the later row in force, 730); the text as decided: **A rule.**");
  });

  test("refuses an earlier row, an unknown row, a row already superseded", () => {
    expect(refused(() => supersede(model(), { num: 2, by: 1, kind: "replaced" })).message).toContain("by a later one");
    expect(refused(() => supersede(model(), { num: 1, by: 9, kind: "replaced" })).code).toBe("not-found");
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
