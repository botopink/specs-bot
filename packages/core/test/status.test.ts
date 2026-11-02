import { describe, expect, test } from "bun:test";
import { findStatusItem, parseDoc, statusBlockEnd, statusLabel, statusRef, parseStatusItems } from "../src/index.ts";

// A synthetic ---status companion: two lanes, a `###` grouping several items, one item with an indented
// continuation line, and a lane with no `###` at all (bare items directly under it — status.md's old L5 shape).
const STATUS = `---
milestone: 1.0.12-beta
---
# Front 150 — status

## L1 — finish what is already on \`feat\`

### 150 rakun

- [ ] 150 s29 — rakun's wrappers, see the README
  — continued on a second line
- [x] 150 s30 — landed early

### 144 checker

- [ ] 144 B-63 — \`botopink cell check --jobs <N>\` landed

## L5 — blocked on a decision

- [ ] decision 321 (qualified beans) — 130 s5 · rakun 04 s6

## Done

- [x] 150 s1 — done already
`;

const doc = parseDoc("fronts/150-rakun/README---status.md", STATUS);

describe("statusRef", () => {
  test("appends ---status once; a ref already carrying it is returned as is", () => {
    expect(statusRef("fronts/150-rakun/README")).toBe("fronts/150-rakun/README---status");
    expect(statusRef("fronts/150-rakun/README---status")).toBe("fronts/150-rakun/README---status");
  });
});

describe("statusLabel", () => {
  test("the label is the text up to the first ' — ', truncated past 60 characters", () => {
    expect(statusLabel("150 s29 — rakun's wrappers")).toEqual({ label: "150 s29", rest: "rakun's wrappers" });
    expect(statusLabel("no dash here")).toEqual({ label: "no dash here", rest: "" });
    const long = "x".repeat(70);
    const { label, rest } = statusLabel(`${long} — y`);
    expect(label.length).toBe(58);
    expect(label.endsWith("…")).toBe(true);
    expect(rest).toBe("y");
  });
});

describe("statusBlockEnd", () => {
  test("stops at the first line that is not indented", () => {
    expect(statusBlockEnd(doc.lines, doc.lines.indexOf("- [ ] 150 s29 — rakun's wrappers, see the README"))).toBe(
      doc.lines.indexOf("  — continued on a second line") + 1,
    );
    expect(statusBlockEnd(doc.lines, doc.lines.indexOf("- [x] 150 s30 — landed early"))).toBe(doc.lines.indexOf("- [x] 150 s30 — landed early") + 1);
  });
});

describe("parseStatusItems", () => {
  const items = parseStatusItems(doc);

  test("every item, in document order, with its lane and heading in force", () => {
    expect(items.map((i) => [i.lane, i.heading, i.label, i.checked])).toEqual([
      ["L1 — finish what is already on `feat`", "150 rakun", "150 s29", false],
      ["L1 — finish what is already on `feat`", "150 rakun", "150 s30", true],
      ["L1 — finish what is already on `feat`", "144 checker", "144 B-63", false],
      ["L5 — blocked on a decision", "", "decision 321 (qualified beans)", false],
      ["Done", "", "150 s1", true],
    ]);
  });

  test("the label/text split is statusLabel()'s", () => {
    const s29 = items.find((i) => i.label === "150 s29")!;
    expect(s29.text).toBe("rakun's wrappers, see the README");
  });

  test("a bare lane item (no ###) keeps an empty heading", () => {
    expect(items.find((i) => i.label === "150 s1")!.heading).toBe("");
  });

  test("the etag covers the continuation line: two items whose checkbox line alone would be equal differ once one carries a note", () => {
    const withNote = parseDoc(
      "fronts/150-rakun/README---status.md",
      STATUS.replace("- [x] 150 s30 — landed early\n", "- [x] 150 s30 — landed early\n  — a note\n"),
    );
    const before = findStatusItem(doc, "150 s30")!;
    const after = findStatusItem(withNote, "150 s30")!;
    expect(before.etag).not.toBe(after.etag);
  });
});

describe("findStatusItem", () => {
  test("the first item whose label matches exactly — a prefix never matches", () => {
    expect(findStatusItem(doc, "150 s29")?.text).toBe("rakun's wrappers, see the README");
    expect(findStatusItem(doc, "150 s")).toBeUndefined();
    expect(findStatusItem(doc, "nope")).toBeUndefined();
  });

  test("two items sharing a label: the first in document order wins", () => {
    const dup = parseDoc(
      "fronts/150-rakun/README---status.md",
      STATUS.replace("- [x] 150 s30 — landed early\n", "- [x] 150 s30 — landed early\n- [ ] 150 s30 — a duplicate\n"),
    );
    expect(findStatusItem(dup, "150 s30")?.text).toBe("landed early");
  });
});
