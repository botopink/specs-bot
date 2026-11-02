import { describe, expect, test } from "bun:test";
import {
  buildModel,
  findStatusItem,
  parseDoc,
  parsePending,
  parseRetired,
  parseSteps,
  parseTaken,
  placeDocs,
  type Plan,
  statusSet,
  WriteError,
} from "../src/index.ts";

const STATUS = `---
milestone: 1.0.12-beta
---
# Front 150 — status

## L1 — finish what is already on \`feat\`

### 150 rakun

- [ ] 150 s29 — rakun's wrappers, see the README
  — continued on a second line
- [x] 150 s30 — landed early

## L5 — blocked on a decision

- [ ] decision 321 (qualified beans) — 130 s5

## Landed

- [x] 150 s0 — already there
`;

// A companion that has no "## Landed" section yet, to see statusSet create one.
const NO_LANDED = `---
milestone: 1.0.12-beta
---
# Front 151 — status

## L1 — open

- [ ] 151 s1 — one task
`;

function model(docs: { ref: string; text: string }[]) {
  return buildModel({
    specsDir: "/nowhere",
    steps: parseSteps(""),
    pending: parsePending(""),
    taken: parseTaken(""),
    retired: parseRetired(""),
    tree: placeDocs(docs.map((d) => parseDoc(`${d.ref}.md`, d.text))),
    chat: [],
    record: { readme: { lines: [], order: [] }, groups: new Map() },
  });
}

const base = model([
  { ref: "milestone/README", text: "---\nmilestone: 1.0.12-beta\n---\n# Specs\n" },
  { ref: "fronts/150-rakun/README", text: "---\nmilestone: 1.0.12-beta\n---\n# Front 150\n" },
  { ref: "fronts/150-rakun/README---status", text: STATUS },
  { ref: "fronts/151-other/README", text: "---\nmilestone: 1.0.12-beta\n---\n# Front 151\n" },
  { ref: "fronts/151-other/README---status", text: NO_LANDED },
  { ref: "fronts/152-no-companion/README", text: "---\nmilestone: 1.0.12-beta\n---\n# Front 152\n" },
  { ref: "fronts/01-old/README", text: "---\nmilestone: 1.0.5-beta\n---\n# Old\n" },
]);

const after = (p: Plan) => p.changes[0]!.after;
function refused(fn: () => unknown): WriteError {
  try {
    fn();
  } catch (e) {
    if (e instanceof WriteError) return e;
    throw e;
  }
  throw new Error("not refused");
}

const etagOfItem = (ref: string, label: string) => findStatusItem(base.docByRef.get(ref)!, label)!.etag;

describe("statusSet", () => {
  test("finds the item by its exact label and refuses an unknown one", () => {
    const p = statusSet(base, { ref: "fronts/150-rakun/README", label: "150 s29", check: true }, "machine-1");
    expect(p.op).toBe("status.set");
    expect(p.refs).toEqual(["fronts/150-rakun/README---status#150 s29"]);
    expect(refused(() => statusSet(base, { ref: "fronts/150-rakun/README", label: "nope" }, "machine-1")).code).toBe("not-found");
  });

  test("check/uncheck flips only the box, nothing else on the line or document", () => {
    const checked = after(statusSet(base, { ref: "fronts/150-rakun/README", label: "150 s29", check: true }, "machine-1"));
    expect(checked).toContain("- [x] 150 s29 — rakun's wrappers, see the README\n  — continued on a second line\n");
    // Nothing else moved: every other line is exactly as in STATUS.
    expect(checked.replace("- [x] 150 s29", "- [ ] 150 s29")).toBe(STATUS);
    const unchecked = after(statusSet(base, { ref: "fronts/150-rakun/README", label: "150 s30", check: false }, "machine-1"));
    expect(unchecked).toContain("- [ ] 150 s30 — landed early\n");
    // Nothing else moved: every other line is exactly as in STATUS.
    expect(unchecked.replace("- [ ] 150 s30", "- [x] 150 s30")).toBe(STATUS);
  });

  test("a note is a new indented continuation line right below the item (and below an existing one)", () => {
    const p = after(statusSet(base, { ref: "fronts/150-rakun/README", label: "150 s30", note: "a second note" }, "machine-1"));
    expect(p).toContain("- [x] 150 s30 — landed early\n  a second note\n");
    const withExisting = after(statusSet(base, { ref: "fronts/150-rakun/README", label: "150 s29", note: "yet another" }, "machine-1"));
    expect(withExisting).toContain(
      "- [ ] 150 s29 — rakun's wrappers, see the README\n  — continued on a second line\n  yet another\n",
    );
  });

  test("landed moves the item (and its continuation) to the end of an existing ## Landed", () => {
    const p = after(statusSet(base, { ref: "fronts/150-rakun/README", label: "150 s30", landed: true }, "machine-1"));
    expect(p).not.toContain("- [x] 150 s30 — landed early\n\n## L5");
    expect(p.trimEnd().endsWith("- [x] 150 s0 — already there\n- [x] 150 s30 — landed early")).toBe(true);
    const withContinuation = after(statusSet(base, { ref: "fronts/150-rakun/README", label: "150 s29", landed: true }, "machine-1"));
    expect(withContinuation.trimEnd().endsWith("- [ ] 150 s29 — rakun's wrappers, see the README\n  — continued on a second line")).toBe(true);
    // The lane it left keeps one blank line where the item was, not two.
    expect(withContinuation).toContain("### 150 rakun\n\n- [x] 150 s30 — landed early\n\n## L5");
  });

  test("check and landed together: both apply (checked, then moved)", () => {
    const p = after(statusSet(base, { ref: "fronts/150-rakun/README", label: "150 s29", check: true, landed: true }, "machine-1"));
    expect(p.trimEnd().endsWith("- [x] 150 s29 — rakun's wrappers, see the README\n  — continued on a second line")).toBe(true);
  });

  test("landed creates ## Landed at the file's end when the document has none yet", () => {
    const p = after(statusSet(base, { ref: "fronts/151-other/README", label: "151 s1", landed: true }, "machine-1"));
    expect(p.endsWith("## L1 — open\n\n## Landed\n\n- [ ] 151 s1 — one task\n")).toBe(true);
  });

  test("a stale etag is a conflict that carries the current one", () => {
    const e = refused(() => statusSet(base, { ref: "fronts/150-rakun/README", label: "150 s29", check: true, etag: "stale" }, "machine-1"));
    expect([e.code, e.status, e.detail?.etag]).toEqual(["conflict", 409, etagOfItem("fronts/150-rakun/README---status", "150 s29")]);
    // The right etag is accepted.
    expect(() => statusSet(base, { ref: "fronts/150-rakun/README", label: "150 s29", check: true, etag: etagOfItem("fronts/150-rakun/README---status", "150 s29") }, "machine-1")).not.toThrow();
  });

  test("nothing to change is refused", () => {
    expect(refused(() => statusSet(base, { ref: "fronts/150-rakun/README", label: "150 s29" }, "machine-1")).code).toBe("invalid");
  });

  test("a front with no companion yet: not found, with a hint naming the ref that does exist", () => {
    const e = refused(() => statusSet(base, { ref: "fronts/152-no-companion/README", label: "x" }, "machine-1"));
    expect(e.code).toBe("not-found");
    expect(e.hint).toContain("fronts/152-no-companion/README has no ---status companion yet");
  });

  test("a closed milestone's front: not found, with a hint explaining why there is no companion", () => {
    const e = refused(() => statusSet(base, { ref: "fronts/01-old/README", label: "x" }, "machine-1"));
    expect(e.code).toBe("not-found");
    expect(e.hint).toContain("closed milestone");
  });

  test("a ref that names nothing at all: a plain not-found", () => {
    const e = refused(() => statusSet(base, { ref: "fronts/999-nowhere/README", label: "x" }, "machine-1"));
    expect(e.code).toBe("not-found");
  });
});
