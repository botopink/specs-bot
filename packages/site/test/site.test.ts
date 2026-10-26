import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { shortTitle } from "../src/hierarchy.ts";
import { createSite, loadSiteData } from "../src/index.ts";
import { resolveLink } from "../src/markdown.ts";

describe("shortTitle", () => {
  test("drops the front's own number and name, keeps what more it says", () => {
    expect(shortTitle("Front 150 — rakun: the 16 members", 150, "rakun")).toBe("the 16 members");
    expect(shortTitle("Track 04 — rakun", 4, "rakun")).toBe("");
    expect(shortTitle("Front 98 — packaging tail: the rule checked", 98, "packaging-tail")).toBe("the rule checked");
    expect(shortTitle("Front 105 — i18n: a shared `i18n`", 105, "i18n")).toBe("a shared `i18n`");
  });

  test("keeps a prefix naming another number, and a title that does not open with the name", () => {
    expect(shortTitle("Front 135 — snap: the second layer", 20, "snap")).toBe("Front 135 — snap: the second layer");
    expect(shortTitle("Front 144 — machine 1: the checker", 144, "checker")).toBe("machine 1: the checker");
  });
});

const FILES: Record<string, string> = {
  "decisions-taken-steps.md": `# Decisions taken — the steps

**The next free number is 5.**

## Language

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
| 1 | 9-a · (the maintainer, 2026-10-01) | Overtaken by 3 (the later row in force); **old rule** | \`m-1/144\` |  |
| 3 | 9-b · (the coordinator †, 2026-10-02) | **A file is a module.** It has \`a | b\` in code | meta | file_is_module |
| 4 | q-4 · (process) | Gate order is fixed | meta |  |
`,
  "decisions-pending.md": `# Decisions the maintainer owes

The next free
number, which is **5**.

## To review — the fable's decisions

| Reviewed | Row | Answered | What was decided |
|---|---|---|---|
| [x] | 1 | 9-a | Reviewed long ago |
| [ ] | 3 | 9-b | Answered by the maintainer: a file is a module |

## Machine 1 — maximum priority

#### 9-c · Do \`!(v is A)\` narrow \`v\`?

- **Measured.** Built as (a).
- **Recommendation.** (a).
`,
  "decisions-taken.md": `# Decisions taken

## module-system — files and modules

**A file is a module.**

(1) Every \`.bp\` is a module (3).

Steps: 1, 3
Binds: every repository
`,
  "retired.md": `# Retired

## Language spellings

| Retired | Replaced by | Decisions | Since / note |
|---|---|---|---|
| \`@Task<T>\` | \`Async<T>\` | 3 (2), 4 | 2026-10-18 |
| \`Option<T>\` | \`?T\` | 1 |  |
`,
  "milestone/README.md": `# Specs — 1.0.12-beta

**Milestone:** 1.0.12-beta
`,
  "milestone/status.md": `# Status — 1.0.12-beta

## Done

Front [150](../150-rakun/README.md) landed.
`,
  "150-rakun/README.md": `# Front 150 — rakun

**Milestone:** 1.0.12-beta
**Machine:** machine-1

<script>alert(1)</script>

## Steps

See [the status](../milestone/status.md#done), [pending](../decisions-pending.md), [the repo](../../repository/rakun/AGENTS.md) and [an example](examples/a.bp).

### s1 · The \`bpp\` router
`,
  "milestone/machine-1.md": "# Machine 1 — the work queue\n",
  "150-rakun/04-rakun/track.md": "# Track 04 — rakun\n",
  "150-rakun/121-bpp-content/context.md": "# Front 121 — bpp content: posts as `data`\n",
  "150-rakun/121-bpp-content/examples/post.md": "# A sample post\n",
  "163-meta-ci/README.md": "# Front 163 — meta-ci: the meta repository's CI\n\n**Milestone:** 1.0.12-beta\n**Machine:** machine-2\n",
  "04-rakun/README.md": "# Front 04 — rakun: the old track\n\n**Milestone:** 1.0.11-beta\n",
  "04-rakun/closure-audit/notes.md": "# Closure audit notes\n",
};

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "specs-bot-site-"));
  for (const [path, text] of Object.entries(FILES)) {
    const file = join(root, "specs", path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

const status = async () => ({ ok: true, branch: "main", head: "abc1234" });

/** The page without the translation marks protectHtml adds, so a test of structure reads the markup as written. */
export function unprotect(html: string): string {
  return html
    .replace(/<span class="notranslate" translate="no">([^<]*)<\/span>/g, "$1")
    .replace(/ class="notranslate" translate="no">/g, ">")
    .replace(/class="notranslate ([^"]*)"([^>]*) translate="no">/g, 'class="$1"$2>');
}

describe("the site over a fixture", () => {
  const root = fixture();
  const site = createSite({ dataPath: root, status, version: "0.0.1" });
  const get = async (path: string) => {
    const res = await site.request(path);
    const raw = await res.text();
    expect(raw).not.toContain(root); // never a filesystem path
    return { status: res.status, body: unprotect(raw), raw, res };
  };

  test("the overview shows the data status, the milestone and the counts", async () => {
    const { status, body } = await get("/");
    expect(status).toBe(200);
    expect(body).toContain("online");
    expect(body).toContain("abc1234");
    expect(body).toContain("Milestone 1.0.12-beta");
    expect(body).toContain("stated the same in the steps record and the pending page");
  });

  test("each stat card has its kind, a number, a short label and a detail line", async () => {
    const { body } = await get("/");
    const cards = [...body.matchAll(/<a class="card k-([a-z]+)" href="([^"]+)"><span class="n">(\d+)<\/span><span class="l">([^<]+)<\/span><span class="d">([^<]+)<\/span><\/a>/g)].map(
      (m) => [m[1], m[2], Number(m[3]), m[4]],
    );
    expect(cards).toEqual([
      ["steps", "/steps", 3, "Steps"],
      ["force", "/steps?status=in-force", 2, "In force"],
      ["gone", "/steps?status=superseded", 1, "Superseded"],
      ["pending", "/pending", 1, "Pending"],
      ["review", "/review", 1, "To review"],
      ["subjects", "/subjects", 1, "Subjects"],
      ["retired", "/retired", 2, "Retired"],
      ["docs", "/fronts", 8, "Documents"],
    ]);
    // The breakdown sits in the detail line, not in the label.
    expect(body).toContain('<span class="d">1 overtaken · 0 replaced · 0 reversed</span>');
    expect(body).toContain('<span class="d">of 2 delegated decisions</span>');
  });

  test("the overview lists the current fronts, each a card naming its owner and linking to its section", async () => {
    const { body } = await get("/");
    expect(body).not.toContain('href="/fronts#machine-1"');
    expect(body).toContain('<a class="mini-card" href="/fronts#150-rakun"><span class="fnum">150</span>');
    expect(body).toContain('<a class="mini-card" href="/fronts#163-meta-ci"><span class="fnum">163</span>');
    expect(body).toContain('<span translate="no">machine-2 · </span>');
    // The title says what the number and the name do not: no "Front 163 — meta-ci" again.
    expect(body).toContain("the meta repository&#39;s CI");
    expect(body).not.toContain("Front 163 — meta-ci");
  });

  test("the stylesheet is served", async () => {
    const { status, res } = await get("/static/site.css");
    expect(status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
  });

  test("steps list and filter by status and text", async () => {
    expect((await get("/steps")).body).toContain('href="/steps/4"');
    const superseded = (await get("/steps?status=superseded")).body;
    expect(superseded).toContain('href="/steps/1"');
    expect(superseded).not.toContain('href="/steps/3"');
    const q = (await get("/steps?q=gate")).body;
    expect(q).toContain('href="/steps/4"');
    expect(q).not.toContain('href="/steps/1"');
  });

  test("a step shows who supersedes it, the subjects and retired rows citing it", async () => {
    const one = (await get("/steps/1")).body;
    expect(one).toContain('href="/steps/3"');
    expect(one).toContain("overtaken by 3");
    const three = (await get("/steps/3")).body;
    expect(three).toContain('href="/subjects/module-system"');
    expect(three).toContain("Retired forms citing it");
    expect(three).toContain("bare “|”");
    expect(three).toContain("Supersedes");
  });

  test("a number never used and a number past the record are 404", async () => {
    const unused = await get("/steps/2");
    expect(unused.status).toBe(404);
    expect(unused.body).toContain("never used");
    expect((await get("/steps/99")).status).toBe(404);
  });

  test("pending questions, one question, and an answered id pointing at its step", async () => {
    const list = await get("/pending");
    expect(list.body).toContain("Machine 1 — maximum priority");
    expect(list.body).toContain("Measured.");
    expect((await get("/pending/9-c")).body).toContain("Recommendation.");
    const answered = await get("/pending/9-b");
    expect(answered.status).toBe(404);
    expect(answered.body).toContain("answered by step 3");
  });

  test("the review table lists open items first", async () => {
    const { body } = await get("/review");
    expect(body.indexOf("a file is a module")).toBeLessThan(body.indexOf("Reviewed long ago"));
    expect(body).toContain("1 open of 2");
  });

  test("subjects and one subject with its steps linked", async () => {
    expect((await get("/subjects")).body).toContain('href="/subjects/module-system"');
    const s = (await get("/subjects/module-system")).body;
    expect(s).toContain('href="/steps/3"');
    expect(s).toContain("every repository");
    expect(s).toContain("Cites 1 superseded step");
    expect((await get("/subjects/nope")).status).toBe(404);
  });

  test("retired forms filter, and link the decisions outside parentheses only", async () => {
    const all = (await get("/retired")).body;
    expect(all).toContain('<a href="/steps/3">3</a> (2), <a href="/steps/4">4</a>');
    const q = (await get("/retired?q=option")).body;
    expect(q).toContain("?T");
    expect(q).not.toContain("Async");
  });

  test("/fronts is the current milestone: its documents, then its fronts — a machine is a front's owner, not a section", async () => {
    const { status, body } = await get("/fronts");
    expect(status).toBe(200);
    expect(body).toMatch(/<h1>1\.0\.12-beta <span class="pill current">current<\/span><\/h1>/);
    const h2 = [...body.matchAll(/<h2 id="([^"]+)">/g)].map((m) => m[1]);
    expect(h2).toEqual(["milestone", "fronts"]);
    // A machine's page is one of the milestone's documents.
    expect(body).toContain('<a href="/docs/milestone/machine-1">machine-1</a>');
    // The owners filter the list.
    expect(body).toContain('<a href="/fronts?owner=machine-1">machine-1 · 1</a>');
    const one = (await get("/fronts?owner=machine-2")).body;
    expect(one).toContain('id="163-meta-ci"');
    expect(one).not.toContain('id="150-rakun"');
    expect(one).toContain('<span class="on">machine-2 · 1</span>');
  });

  test("a front is a card: number, name linking its README, title, its owner, counts", async () => {
    const { body } = await get("/fronts");
    const card = body.slice(body.indexOf('<section class="front-card" id="150-rakun">'));
    expect(card).toStartWith('<section class="front-card" id="150-rakun"><header><span class="fnum">150</span>');
    expect(card).toContain('<h3><a href="/docs/150-rakun/README">rakun</a>');
    expect(card).toContain('<p class="fmeta"><a class="owner" href="/fronts?owner=machine-1" title="the machine that works this front" translate="no">owner: machine-1</a> · 4 docs · 2 folders</p>');
    expect(body.indexOf('id="150-rakun"')).toBeLessThan(body.indexOf('id="163-meta-ci"'));
  });

  test("the folders inside a front are its sub-subsections, titled without repeating their name", async () => {
    const { body } = await get("/fronts");
    const h4 = [...body.matchAll(/<h4 id="([^"]+)">(.*?)<\/h4>/g)].map((m) => [m[1], m[2]!.replace(/<[^>]+>/g, "")]);
    expect(h4).toEqual([
      ["150-rakun-04-rakun", "04-rakun"],
      ["150-rakun-121-bpp-content", "121-bpp-content posts as data"],
    ]);
    // A folder's documents are chips named below the folder, deeper folders included.
    expect(body).toContain('href="/docs/150-rakun/121-bpp-content/examples/post" title="A sample post">examples/post</a>');
    expect(body).toContain("<code>data</code>");
  });

  test("an old milestone has no machines: its fronts sit in one Fronts section; the switcher links the others", async () => {
    const { body } = await get("/fronts?version=1.0.11-beta");
    expect(body).toMatch(/<h1>1\.0\.11-beta <span class="pill frozen-pill">frozen<\/span><\/h1>/);
    // Only the current milestone keeps documents of its own (milestone/): an old one is its fronts alone.
    expect([...body.matchAll(/<h2 id="([^"]+)">/g)].map((m) => m[1])).toEqual(["fronts"]);
    expect(body).toContain('<section class="front-card" id="04-rakun">');
    expect(body).toContain('<a href="/fronts">1.0.12-beta</a>');
    expect(body).toContain('<span class="on">1.0.11-beta</span>');
    // An unknown version shows the current one.
    expect((await get("/fronts?version=9.9.9")).body).toContain('<span class="on">1.0.12-beta</span>');
  });

  test("/docs leads to the Fronts page, keeping the milestone", async () => {
    const all = await get("/docs");
    expect([all.status, all.res.headers.get("location")]).toEqual([302, "/fronts"]);
    const old = await get("/docs?version=1.0.11-beta");
    expect(old.res.headers.get("location")).toBe("/fronts?version=1.0.11-beta");
  });

  test("a folder with no README leads to its section", async () => {
    const folder = await get("/docs/150-rakun/04-rakun");
    expect([folder.status, folder.res.headers.get("location")]).toEqual([302, "/fronts#150-rakun-04-rakun"]);
    const loose = await get("/docs/04-rakun/closure-audit");
    expect(loose.res.headers.get("location")).toBe("/fronts?version=1.0.11-beta");
  });

  test("a document's breadcrumbs lead back to each section it sits in", async () => {
    const { body } = await get("/docs/150-rakun/04-rakun/track");
    const crumbs = [...body.slice(body.indexOf('<nav class="crumbs"')).matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)]
      .slice(0, 4)
      .map((m) => [m[2], m[1]]);
    expect(crumbs).toEqual([
      ["Fronts", "/fronts"],
      ["1.0.12-beta", "/fronts"],
      ["150-rakun", "/fronts#150-rakun"],
      ["04-rakun", "/fronts#150-rakun-04-rakun"],
    ]);
    // A frozen milestone's crumbs name it.
    expect((await get("/docs/04-rakun/README")).body).toContain('<a href="/fronts?version=1.0.11-beta#04-rakun">04-rakun</a>');
  });

  test("a doc renders with anchors, mapped links and raw HTML escaped", async () => {
    const { status, body } = await get("/docs/150-rakun/README");
    expect(status).toBe(200);
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(body).not.toContain("<script>alert");
    expect(body).toContain('href="/docs/milestone/status#done"');
    expect(body).toContain('href="/pending"');
    expect(body).toContain('<span class="unresolved">the repo</span>');
    expect(body).toContain('id="s1--the-bpp-router"');
    expect(body).toContain('href="#steps"'); // the outline
  });

  test("a directory ref redirects to its README; an unknown ref is 404", async () => {
    const dir = await get("/docs/150-rakun");
    expect(dir.status).toBe(302);
    expect(dir.res.headers.get("location")).toBe("/docs/150-rakun/README");
    expect((await get("/docs/nope")).status).toBe(404);
  });
});

describe("a front's progress on the site", () => {
  const root = fixture();
  writeFileSync(
    join(root, "specs/milestone/status.md"),
    "# Status — 1.0.12-beta\n\n## L1 — now\n\n### 150 rakun\n\n- [ ] 150 s2 — the router's tail\n\n## Done — landed\n\n### 150 rakun\n\n- [x] 150 s1 — the `bpp` router\n",
  );
  const site = createSite({ dataPath: root, status, version: "0.0.1" });
  const get = async (path: string) => {
    const res = await site.request(path);
    return { status: res.status, body: unprotect(await res.text()) };
  };

  test("each front card on /fronts carries its progress, linking to the front's page", async () => {
    const { body } = await get("/fronts");
    const card = body.slice(body.indexOf('id="150-rakun"'), body.indexOf('id="163-meta-ci"'));
    expect(card).toContain('<div class="pbar" role="img" aria-label="0 done, 1 open, 0 waiting">');
    expect(card).toContain('<a href="/fronts/150">');
    expect(card).toContain("from the README&#39;s 1 step and their boxes");
  });

  test("/fronts/<num> lists the README's steps and status.md's items, each linking where it is written", async () => {
    const { status: code, body } = await get("/fronts/150");
    expect(code).toBe(200);
    expect(body).toContain("Steps — from the README");
    expect(body).toContain('href="/docs/150-rakun/README#s1--the-bpp-router"');
    expect(body).toContain("In status.md");
    expect(body).toContain('href="/docs/milestone/status#150-rakun"');
    expect(body).toContain('<span class="lane" translate="no">Done</span>');
    expect((await get("/fronts/999")).status).toBe(404);
    expect((await get("/fronts/04?version=1.0.11-beta")).status).toBe(200);
  });

  test("a document inside a front opens with the front's progress; one outside does not", async () => {
    const inside = (await get("/docs/150-rakun/04-rakun/track")).body;
    expect(inside).toContain('<aside class="doc-progress">');
    expect(inside).toContain("All of front 150&#39;s steps");
    expect((await get("/docs/milestone/status")).body).not.toContain('class="doc-progress"');
  });
});

describe("translation: what the browser may translate and what never", () => {
  const root = fixture();
  writeFileSync(
    join(root, "specs/150-rakun/notes.md"),
    [
      "# Notes on the router",
      "",
      "The return type is the annotation; a fn written bare stays, as does comptime. Step 150 s31 and B-162 landed in 04-rakun; question 810-d asks; machine-1 reads `main.bp`.",
      "",
      "```bp",
      "pub fn main() -> void { }",
      "```",
      "",
      "| Code | What |",
      "|---|---|",
      "| `for-await-one-source` | the refusal of an await over two sources |",
      "",
      "<!-- notrans -->",
      "A paragraph kept as written.",
      "",
      "A paragraph translated as usual.",
      "",
    ].join("\n"),
  );
  const site = createSite({ dataPath: root, status, version: "0.0.1" });
  const page = async (path: string) => (await site.request(path)).text();

  test("code blocks, inline code and a table cell that is code alone are never translated", async () => {
    const body = await page("/docs/150-rakun/notes");
    expect(body).toMatch(/<pre class="notranslate" translate="no"><code class="notranslate language-bp" translate="no">/);
    expect(body).toContain('<td class="notranslate" translate="no"><code class="notranslate" translate="no">for-await-one-source</code></td>');
    expect(body).toContain('<code class="notranslate" translate="no">main.bp</code>');
  });

  test("labels and the keywords that are no English word are kept; English words are not", async () => {
    const body = await page("/docs/150-rakun/notes");
    const kept = [...body.matchAll(/<span class="notranslate" translate="no">([^<]+)<\/span>/g)].map((m) => m[1]);
    for (const label of ["fn", "comptime", "150 s31", "B-162", "04-rakun", "810-d", "machine-1"]) expect(kept).toContain(label);
    // "return" and "type" are English here: the translator gets them.
    expect(body).toContain("<p>The return type is the annotation; a ");
    expect(kept).not.toContain("return");
    expect(kept).not.toContain("type");
  });

  test("prose is translatable; a block after <!-- notrans --> is not, and the marker is not shown", async () => {
    const body = await page("/docs/150-rakun/notes");
    expect(body).toContain('<div class="notranslate" translate="no"><p>A paragraph kept as written.</p>');
    expect(body).toContain("<p>A paragraph translated as usual.</p>");
    expect(body).not.toContain("notrans --");
  });

  test("ids and step numbers in the site's own markup are kept", async () => {
    const body = await page("/steps/3");
    expect(body).toContain('<span class="notranslate" translate="no">9-b</span> · (the coordinator †');
    expect(body).toContain('<code class="notranslate" translate="no">file_is_module</code>');
    expect(await page("/pending")).toContain('<code class="notranslate" translate="no">9-c</code>');
  });

  test("the header has the EN | PT toggle and the page says it is English", async () => {
    const body = await page("/");
    expect(body).toStartWith('<html lang="en">');
    expect(body).toContain('<div class="lang notranslate" translate="no" role="group" aria-label="Language">');
    expect(body).toContain('data-lang="pt"');
    expect(body).toContain("translate.google.com/translate_a/element.js?cb=specsBotTranslate");
    expect(body).toContain('includedLanguages: "pt"');
    // The script itself is untouched by the marks.
    expect(body).not.toMatch(/<script>[^]*<span class="notranslate"/);
  });
});

describe("protectHtml", () => {
  test("leaves text inside marked elements, script and style alone", async () => {
    const { protectHtml } = await import("../src/translate.ts");
    expect(protectHtml('<p translate="no">150 s31 <b>B-9</b></p><p>150 s31</p>')).toBe(
      '<p translate="no">150 s31 <b>B-9</b></p><p><span class="notranslate" translate="no">150 s31</span></p>',
    );
    expect(protectHtml("<script>var fn = 1;</script><style>.fn{}</style>")).toBe("<script>var fn = 1;</script><style>.fn{}</style>");
    expect(protectHtml('<code class="x">a</code>')).toBe('<code class="notranslate x" translate="no">a</code>');
  });
});

describe("the site without data", () => {
  const site = createSite({
    dataPath: "/nowhere",
    status: async () => ({ ok: false, error: "no specs/ under the data path" }),
    version: "0.0.1",
  });

  test("the overview still answers, saying the data is unavailable", async () => {
    const res = await site.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("data unavailable");
  });

  test("the pages answer 503", async () => {
    expect((await site.request("/steps")).status).toBe(503);
    expect((await site.request("/docs/x")).status).toBe(503);
  });
});

describe("resolveLink", () => {
  const refs = new Set(["milestone/status", "150-rakun/README"]);
  const from = "150-rakun/README";

  test("keeps absolute URLs and in-page anchors", () => {
    expect(resolveLink("https://example.com/x", { refs, from })).toBe("https://example.com/x");
    expect(resolveLink("#steps", { refs, from })).toBe("#steps");
  });

  test("maps a relative .md and a directory to doc routes", () => {
    expect(resolveLink("../milestone/status.md#done", { refs, from })).toBe("/docs/milestone/status#done");
    expect(resolveLink("../150-rakun/", { refs, from })).toBe("/docs/150-rakun/README");
  });

  test("maps the files above the milestones to their pages", () => {
    expect(resolveLink("../decisions-taken-steps.md", { refs, from })).toBe("/steps");
    expect(resolveLink("../retired.md#std", { refs, from })).toBe("/retired");
  });

  test("anything else resolves to nothing", () => {
    expect(resolveLink("../../AGENTS.md", { refs, from })).toBeUndefined();
    expect(resolveLink("examples/a.bp", { refs, from })).toBeUndefined();
  });
});

const realRoot = process.env.SPECS_DATA_PATH ?? "";

// Only declared when the real data is here: a skipped describe still runs its body to collect tests.
if (!(!realRoot || !existsSync(join(realRoot, "specs")))) describe("the site over the real specs", () => {
  const site = createSite({ dataPath: realRoot, status, version: "0.0.1" });

  test("every page answers 200 and shows no filesystem path", async () => {
    for (const path of ["/", "/steps", "/steps/814", "/pending", "/review", "/subjects", "/retired", "/fronts", "/fronts?version=1.0.5-beta", "/docs/milestone/README"]) {
      const res = await site.request(path);
      const body = await res.text();
      expect([path, res.status]).toEqual([path, 200]);
      expect(body).not.toContain(realRoot);
    }
  });

  test("every milestone's Fronts page has unique anchors, and every document is listed on it once", async () => {
    const loaded = loadSiteData(realRoot);
    if (!loaded.ok) throw new Error(loaded.error);
    for (const v of loaded.data.tree.versions) {
      const body = await (await site.request(`/fronts?version=${v}`)).text();
      const ids = [...body.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
      expect([v, ids.length - new Set(ids).size]).toEqual([v, 0]);
      // Every document is linked by its ref.
      const listed = [...body.matchAll(/href="\/docs\/([^"#]+)"/g)].map((m) => m[1]!);
      const docs = loaded.data.tree.docs.filter((d) => d.version === v).map((d) => d.ref);
      expect([v, docs.filter((r) => !listed.includes(r))]).toEqual([v, []]);
    }
  });
});
