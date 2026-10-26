import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { anchorOf, compareVersions, docMeta, loadDocs, parseDoc, placeDocs, sectionText, serializeDoc } from "../src/index.ts";

describe("docMeta", () => {
  test("reads front and group from the path; milestone and machine wait for the loader", () => {
    expect(docMeta("150-rakun/04-rakun/track.md")).toEqual({
      ref: "150-rakun/04-rakun/track",
      version: "",
      front: { num: 150, slug: "rakun", dir: "150-rakun" },
      group: { num: 4, slug: "rakun", dir: "04-rakun" },
      name: "track",
    });
  });

  test("a front's README has a front and no group", () => {
    const m = docMeta("01-checker/README.md");
    expect([m.owner, m.front, m.group, m.name]).toEqual([undefined, { num: 1, slug: "checker", dir: "01-checker" }, undefined, "README"]);
  });

  test("a milestone's own file has neither", () => {
    const m = docMeta("milestone/status.md");
    expect([m.front, m.group, m.name]).toEqual([undefined, undefined, "status"]);
  });

  test("refuses a path outside a folder", () => {
    expect(() => docMeta("decisions-taken.md")).toThrow("not in a folder under specs/");
  });
});

describe("placeDocs", () => {
  const tree = placeDocs([
    parseDoc("milestone/README.md", "---\nmilestone: 1.0.12-beta\n---\n# Specs\n"),
    parseDoc("milestone/status.md", "# Status\n"),
    parseDoc("milestone/machine-1.md", "# Machine 1\n"),
    parseDoc("150-rakun/README.md", "---\nmilestone: 1.0.12-beta\nowner: machine-1\n---\n# Front 150\n\n## Steps\n\n**Milestone:** 9.9.9\n"),
    parseDoc("150-rakun/04-rakun/track.md", "# Track\n"),
    parseDoc("150-rakun/07-old/README.md", "---\nmilestone: 1.0.11-beta\n---\n# Old\n"),
    parseDoc("150-rakun/07-old/notes.md", "# Notes\n"),
    parseDoc("01-checker/README.md", "---\nmilestone: 1.0.5-beta\n---\n# Checker\n"),
  ]);
  const at = (ref: string) => tree.docs.find((d) => d.ref === ref)!;

  test("the current milestone is the one milestone/README.md names", () => {
    expect(tree.current).toBe("1.0.12-beta");
    expect(tree.versions).toEqual(["1.0.5-beta", "1.0.11-beta", "1.0.12-beta"]);
  });

  test("a document inherits the nearest fields above it; a field inside a section is not one", () => {
    expect([at("150-rakun/04-rakun/track").version, at("150-rakun/04-rakun/track").owner]).toEqual(["1.0.12-beta", "machine-1"]);
    expect([at("150-rakun/07-old/notes").version, at("150-rakun/07-old/notes").owner]).toEqual(["1.0.11-beta", "machine-1"]);
    expect([at("01-checker/README").version, at("01-checker/README").owner]).toEqual(["1.0.5-beta", undefined]);
  });

  test("the milestone's documents are the current milestone's; machine-N.md is that machine's", () => {
    expect([at("milestone/status").version, at("milestone/status").owner]).toEqual(["1.0.12-beta", undefined]);
    expect(at("milestone/machine-1").owner).toBe("machine-1");
  });

  test("placeOf answers for a path that holds no document", () => {
    expect(tree.placeOf("150-rakun/04-rakun/examples/x.bp")).toEqual({ version: "1.0.12-beta", owner: "machine-1" });
    expect(tree.placeOf("01-checker/a.bp")).toEqual({ version: "1.0.5-beta" });
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
  const doc = parseDoc("150-rakun/README.md", SAMPLE);

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

  test("reads every spec document, 1.0.12-beta current", () => {
    expect(tree.docs.length).toBeGreaterThanOrEqual(350);
    expect(tree.current).toBe("1.0.12-beta");
  });

  test("every document round-trips byte for byte", () => {
    const off = tree.docs.filter((d) => serializeDoc(d) !== readFileSync(join(specs, `${d.ref}.md`), "utf8"));
    expect(off.map((d) => d.ref)).toEqual([]);
  });

  test("refs are unique", () => {
    expect(new Set(tree.docs.map((d) => d.ref)).size).toBe(tree.docs.length);
  });

  test("every document outside milestone/ has a front", () => {
    const loose = tree.docs.filter((d) => !d.front && !d.ref.startsWith("milestone/"));
    expect(loose.map((d) => d.ref)).toEqual([]);
  });
});
