import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Marked } from "marked";
import { createSite, loadSiteData } from "../src/index.ts";
import { buildProgress, type ProgressItem } from "../src/progress.ts";
import { docHref, refOfPath, shortenDocLinks } from "../src/short-links.ts";
import { groupOf, INDEX_ROWS, linkDecisions, renderStepTable, stepOf } from "../src/step-tables.ts";

const status = async () => ({ ok: true as const, branch: "main", head: "abc1234" });

describe("short links", () => {
  test("a path without a version is the current milestone's", () => {
    expect(refOfPath("machine-1/144-botopink-lang/README", "1.0.12-beta")).toBe("1.0.12-beta/machine-1/144-botopink-lang/README");
    expect(refOfPath("1.0.5-beta/01-checker/README", "1.0.12-beta")).toBe("1.0.5-beta/01-checker/README");
  });

  test("the current milestone is linked short, a frozen one keeps its version", () => {
    expect(docHref("1.0.12-beta/status", "1.0.12-beta")).toBe("/docs/status");
    expect(docHref("1.0.5-beta/status", "1.0.12-beta")).toBe("/docs/1.0.5-beta/status");
    expect(shortenDocLinks('<a href="/docs/1.0.12-beta/a">a</a><a href="/docs/1.0.5-beta/b">b</a>', "1.0.12-beta")).toBe(
      '<a href="/docs/a">a</a><a href="/docs/1.0.5-beta/b">b</a>',
    );
  });
});

// A small tree: a current milestone whose front README holds steps, a frozen one, and an index table of steps.
const STEP_ROWS = Array.from({ length: INDEX_ROWS + 2 }, (_, i) => i);
const FILES: Record<string, string> = {
  "specs/decisions-taken-steps.md": "**The next free number is 435.**\n\n## L\n\n| # | Id | Rule in force | Binds | Cell |\n|---|---|---|---|---|\n| 434 | q-1 · (the maintainer) | A rule. | x |  |\n",
  "specs/decisions-pending.md": "the next free\nnumber, which is **435**.\n\n## Machine 1\n\nNone open.\n",
  "specs/decisions-taken.md": "# T\n\n## lang — l\n\n**L.**\n\nText.\n\nSteps: 434\nBinds: x\n",
  "specs/retired.md": "# R\n",
  "specs/1.0.12-beta/status.md": "# Status\n\n## Done\n\n- [x] a\n",
  "specs/1.0.12-beta/machine-1/144-checker/README.md": [
    "# Front 144 — machine 1",
    "",
    "### B-00a — first",
    "",
    "- [x] one",
    "",
    "### B-00b — second",
    "",
    "- [ ] two",
    "",
    "### B-82 … B-85 — moved to front 164",
    "",
    "- [x] moved",
    "",
    ...STEP_ROWS.map((i) => `### B-${10 + i} — step ${i}\n\n- [${i % 2 ? "x" : " "}] box\n`),
  ].join("\n"),
  "specs/1.0.12-beta/machine-1/144-botopink-lang/README.md": [
    "# Front 144 — shared",
    "",
    "## Steps",
    "",
    "| Step | Machine | Title |",
    "|---|---|---|",
    "| B-00a | [1](../144-checker/README.md) | First (decision 434) |",
    "| B-00b | [1](../144-checker/README.md) | Second |",
    "| B-83 | [2](../144-checker/README.md) | 434 (1): moved |",
    ...STEP_ROWS.map((i) => `| B-${10 + i} | [${i % 2 ? 1 : 2}](../144-checker/README.md) | step ${i} |`),
    "| B-999 | [1](../144-checker/README.md) | nowhere |",
    "",
  ].join("\n"),
  "specs/1.0.5-beta/01-checker/README.md": "# Old checker\n\nSee [status](../status.md).\n",
  "specs/1.0.5-beta/status.md": "# Old status\n",
};

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "specs-bot-short-"));
  for (const [p, t] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), t);
  }
  return root;
}

describe("the site over a fixture", () => {
  const site = createSite({ dataPath: fixture(), status, version: "0.0.1" });
  const get = async (path: string) => {
    const res = await site.request(path);
    return { status: res.status, body: await res.text(), location: res.headers.get("location") };
  };

  test("a document of the current milestone opens without its version, and with it", async () => {
    expect((await get("/docs/machine-1/144-botopink-lang/README")).status).toBe(200);
    expect((await get("/docs/1.0.12-beta/machine-1/144-botopink-lang/README")).status).toBe(200);
    expect((await get("/docs/machine-1/144-botopink-lang")).location).toBe("/docs/machine-1/144-botopink-lang/README");
  });

  test("a frozen milestone's document keeps its version, and its links too", async () => {
    const old = await get("/docs/1.0.5-beta/01-checker/README");
    expect(old.status).toBe(200);
    expect(old.body).toContain('href="/docs/1.0.5-beta/status"');
  });

  test("the site links current documents short", async () => {
    const fronts = await get("/fronts");
    expect(fronts.body).toContain('href="/docs/machine-1/144-checker/README"');
    expect(fronts.body).not.toContain('href="/docs/1.0.12-beta/');
  });

  test("the index of steps: states, places, groups, filters, decisions linked", async () => {
    const { body } = await get("/docs/machine-1/144-botopink-lang/README");
    // B-00a and B-00b are one group, headed once.
    expect(body.match(/<tr class="group" data-group="B-00">/g)).toHaveLength(1);
    expect(body).toContain('<span translate="no">B-00</span> · 2 steps · 1 done');
    // A step is a link to where it is written, with its state; B-83 comes from the "B-82 … B-85" heading.
    // (The label sits in the translate guard's span: an id is never translated.)
    const label = (l: string) => `(<span class="notranslate" translate="no">)?${l}(</span>)?`;
    expect(body).toMatch(new RegExp(`<a class="step" href="/docs/machine-1/144-checker/README#b-00a--first">${label("B-00a")}</a> <span class="state done"`));
    expect(body).toMatch(new RegExp(`href="/docs/machine-1/144-checker/README#b-82--b-85--moved-to-front-164">${label("B-83")}</a>`));
    // The one label no README writes is counted as such.
    expect(body).toContain("1 not found in a README");
    expect(body).toContain('data-filter="state" data-value="open"');
    expect(body).toContain('class="col-machine"');
    expect(body).toContain('(decision <a class="dec" href="/steps/434">434</a>)');
  });
});

describe("step tables", () => {
  test("group, label and decision helpers", () => {
    expect([groupOf("B-00a"), groupOf("B-00"), groupOf("s3")]).toEqual(["B-00", undefined, undefined]);
    const steps = new Map<string, ProgressItem>([["150 s31", { state: "open", label: "150 s31", text: "", source: "readme", href: "/x" }]]);
    expect(stepOf("150 s31", { steps })?.href).toBe("/x");
    expect(stepOf("s31", { front: 150, steps })?.href).toBe("/x");
    expect(stepOf("s31", { steps })).toBeUndefined();
    expect(linkDecisions("431 / 432: the error contract")).toBe('<a class="dec" href="/steps/431">431</a> / <a class="dec" href="/steps/432">432</a>: the error contract');
  });

  test("a short table of steps gets states but no filters", () => {
    const t = new Marked().lexer("| Step | Box |\n|---|---|\n| s1 | a |\n")[0] as Parameters<typeof renderStepTable>[0];
    const steps = new Map<string, ProgressItem>([["7 s1", { state: "done", label: "7 s1", text: "", source: "readme", href: "/d#s1" }]]);
    const html = renderStepTable(t, (tokens) => tokens.map((x) => x.raw).join(""), { front: 7, steps });
    expect(html).toContain('<span class="state done"');
    expect(html).not.toContain("filters");
  });
});

const realRoot = process.env.SPECS_DATA_PATH ?? "";
if (realRoot && existsSync(join(realRoot, "specs")))
  describe("the real 144 index of steps", () => {
    const loaded = loadSiteData(realRoot);
    if (!loaded.ok) throw new Error(loaded.error);
    const data = loaded.data;
    const steps = new Map<string, ProgressItem>();
    for (const p of buildProgress(data, data.tree.current).values()) for (const s of p.steps) steps.set(s.label, s);

    test("resolves every step it lists to where a README writes it", () => {
      const doc = data.docByRef.get(`${data.tree.current}/machine-1/144-botopink-lang/README`)!;
      const sec = doc.sections.find((s) => s.anchor === "steps")!;
      const labels = doc.lines.slice(sec.start, sec.end).filter((l) => /^\| B-/.test(l)).map((l) => l.split("|")[1]!.trim());
      expect(labels.length).toBeGreaterThanOrEqual(150);
      expect(labels.filter((l) => !stepOf(l, { front: 144, steps }))).toEqual([]);
    });

    test("the short URL serves it", async () => {
      const site = createSite({ dataPath: realRoot, status, version: "0.0.1", loaded });
      const res = await site.request("/docs/machine-1/144-botopink-lang/README");
      expect(res.status).toBe(200);
      expect(await res.text()).toMatch(/<strong>\d+ steps<\/strong>/);
    });
  });
