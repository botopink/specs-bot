import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { anchorOf, compareVersions, docMeta, loadDocs, parseDoc, sectionText, serializeDoc } from "../src/index.ts";

describe("docMeta", () => {
  test("reads machine, front and group from the path", () => {
    expect(docMeta("1.0.12-beta/machine-1/150-rakun/04-rakun/track.md")).toEqual({
      ref: "1.0.12-beta/machine-1/150-rakun/04-rakun/track",
      version: "1.0.12-beta",
      machine: "machine-1",
      front: { num: 150, slug: "rakun", dir: "150-rakun" },
      group: { num: 4, slug: "rakun", dir: "04-rakun" },
      name: "track",
    });
  });

  test("an old milestone has a front and no machine", () => {
    const m = docMeta("1.0.5-beta/01-checker/README.md");
    expect([m.machine, m.front, m.name]).toEqual([undefined, { num: 1, slug: "checker", dir: "01-checker" }, "README"]);
  });

  test("a milestone's own file has neither", () => {
    const m = docMeta("1.0.12-beta/status.md");
    expect([m.front, m.group, m.name]).toEqual([undefined, undefined, "status"]);
  });

  test("refuses a path outside a milestone", () => {
    expect(() => docMeta("decisions-taken.md")).toThrow("not under a milestone");
  });
});

const SAMPLE = `# Front 150 — rakun

Intro.

## Steps

### s1 · The \`bpp\` router (B-12)

Text with a [link](../README.md) and \`xs[i](9)\` in code.

\`\`\`md
## not a heading
\`\`\`

### s1 · The \`bpp\` router (B-12)

## Acceptance

Done.
`;

describe("parseDoc", () => {
  const doc = parseDoc("1.0.12-beta/machine-1/150-rakun/README.md", SAMPLE);

  test("the title is the first h1", () => {
    expect(doc.title).toBe("Front 150 — rakun");
  });

  test("headings in a fence are not sections; repeated anchors are numbered", () => {
    expect(doc.sections.map((s) => [s.level, s.anchor])).toEqual([
      [1, "front-150--rakun"],
      [2, "steps"],
      [3, "s1--the-bpp-router-b-12"],
      [3, "s1--the-bpp-router-b-12-1"],
      [2, "acceptance"],
    ]);
  });

  test("a section runs to the next heading of its level or higher", () => {
    expect(sectionText(doc, "steps")).toContain("### s1");
    expect(sectionText(doc, "steps")).not.toContain("## Acceptance");
    expect(sectionText(doc, "acceptance")).toBe("## Acceptance\n\nDone.\n");
  });

  test("collects links", () => {
    expect(doc.links).toEqual(["../README.md"]);
  });

  test("round-trips byte for byte", () => {
    expect(serializeDoc(doc)).toBe(SAMPLE);
  });
});

describe("anchorOf", () => {
  test("keeps letters with accents and underscores", () => {
    expect(anchorOf("Decisões pendentes: o_que falta?")).toBe("decisões-pendentes-o_que-falta");
  });
});

describe("compareVersions", () => {
  test("orders numerically", () => {
    expect(["1.0.10-beta", "1.0.5-beta", "1.0.12-beta", "1.0.0-beta"].sort(compareVersions)).toEqual([
      "1.0.0-beta",
      "1.0.5-beta",
      "1.0.10-beta",
      "1.0.12-beta",
    ]);
  });
});

const root = process.env.SPECS_DATA_PATH ?? "";
const specs = join(root, "specs");

// Only declared when the real data is here: a skipped describe still runs its body to collect tests.
if (!(!root || !existsSync(specs))) describe("the real milestone tree", () => {
  const tree = loadDocs(specs);

  test("reads every milestone document, 1.0.12-beta current", () => {
    expect(tree.docs.length).toBeGreaterThanOrEqual(591);
    expect(tree.current).toBe("1.0.12-beta");
  });

  test("every document round-trips byte for byte", () => {
    const off = tree.docs.filter((d) => serializeDoc(d) !== readFileSync(join(specs, `${d.ref}.md`), "utf8"));
    expect(off.map((d) => d.ref)).toEqual([]);
  });

  test("refs are unique", () => {
    expect(new Set(tree.docs.map((d) => d.ref)).size).toBe(tree.docs.length);
  });

  test("every document of the current milestone under a machine has a front", () => {
    const loose = tree.docs.filter((d) => d.version === tree.current && d.machine && !d.front && d.name !== "README");
    expect(loose.map((d) => d.ref)).toEqual([]);
  });
});
