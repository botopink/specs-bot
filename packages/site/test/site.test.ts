import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createSite } from "../src/index.ts";
import { resolveLink } from "../src/markdown.ts";

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
  "1.0.12-beta/status.md": `# Status — 1.0.12-beta

## Done

Front [150](machine-1/150-rakun/README.md) landed.
`,
  "1.0.12-beta/machine-1/150-rakun/README.md": `# Front 150 — rakun

<script>alert(1)</script>

## Steps

See [the status](../../status.md#done), [pending](../../../decisions-pending.md), [the repo](../../../../repository/rakun/AGENTS.md) and [an example](examples/a.bp).

### s1 · The \`bpp\` router
`,
  "1.0.11-beta/overview.md": `# 1.0.11-beta — closed

Frozen.
`,
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

describe("the site over a fixture", () => {
  const root = fixture();
  const site = createSite({ dataPath: root, status, version: "0.0.1" });
  const get = async (path: string) => {
    const res = await site.request(path);
    const body = await res.text();
    expect(body).not.toContain(root); // never a filesystem path
    return { status: res.status, body, res };
  };

  test("the overview shows the data status, the milestone and the counts", async () => {
    const { status, body } = await get("/");
    expect(status).toBe(200);
    expect(body).toContain("online");
    expect(body).toContain("abc1234");
    expect(body).toContain("Milestone 1.0.12-beta");
    expect(body).toContain("pending questions");
    expect(body).toContain("stated the same in the steps record and the pending page");
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

  test("the docs tree holds the current milestone open and the frozen one closed", async () => {
    const { body } = await get("/docs");
    expect(body).toContain('href="/docs/1.0.12-beta/machine-1/150-rakun/README"');
    expect(body).toMatch(/<details class="tree" open="">\s*<summary>1\.0\.12-beta/);
    expect(body).toMatch(/<details class="tree">\s*<summary>1\.0\.11-beta/);
  });

  test("a doc renders with anchors, mapped links and raw HTML escaped", async () => {
    const { status, body } = await get("/docs/1.0.12-beta/machine-1/150-rakun/README");
    expect(status).toBe(200);
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(body).not.toContain("<script>alert");
    expect(body).toContain('href="/docs/1.0.12-beta/status#done"');
    expect(body).toContain('href="/pending"');
    expect(body).toContain('<span class="unresolved">the repo</span>');
    expect(body).toContain('id="s1--the-bpp-router"');
    expect(body).toContain('href="#steps"'); // the outline
  });

  test("a directory ref redirects to its README; an unknown ref is 404", async () => {
    const dir = await get("/docs/1.0.12-beta/machine-1/150-rakun");
    expect(dir.status).toBe(302);
    expect(dir.res.headers.get("location")).toBe("/docs/1.0.12-beta/machine-1/150-rakun/README");
    expect((await get("/docs/nope")).status).toBe(404);
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
  const refs = new Set(["1.0.12-beta/status", "1.0.12-beta/machine-1/150-rakun/README"]);
  const from = "1.0.12-beta/machine-1/150-rakun/README";

  test("keeps absolute URLs and in-page anchors", () => {
    expect(resolveLink("https://example.com/x", { refs, from })).toBe("https://example.com/x");
    expect(resolveLink("#steps", { refs, from })).toBe("#steps");
  });

  test("maps a relative .md and a directory to doc routes", () => {
    expect(resolveLink("../../status.md#done", { refs, from })).toBe("/docs/1.0.12-beta/status#done");
    expect(resolveLink("../150-rakun/", { refs, from })).toBe("/docs/1.0.12-beta/machine-1/150-rakun/README");
  });

  test("maps the files above the milestones to their pages", () => {
    expect(resolveLink("../../../decisions-taken-steps.md", { refs, from })).toBe("/steps");
    expect(resolveLink("../../../retired.md#std", { refs, from })).toBe("/retired");
  });

  test("anything else resolves to nothing", () => {
    expect(resolveLink("../../../../AGENTS.md", { refs, from })).toBeUndefined();
    expect(resolveLink("examples/a.bp", { refs, from })).toBeUndefined();
  });
});

const realRoot = process.env.SPECS_DATA_PATH ?? "";

describe.skipIf(!realRoot || !existsSync(join(realRoot, "specs")))("the site over the real specs", () => {
  const site = createSite({ dataPath: realRoot, status, version: "0.0.1" });

  test("every page answers 200 and shows no filesystem path", async () => {
    for (const path of ["/", "/steps", "/steps/814", "/pending", "/review", "/subjects", "/retired", "/docs", "/docs/1.0.12-beta/README"]) {
      const res = await site.request(path);
      const body = await res.text();
      expect([path, res.status]).toEqual([path, 200]);
      expect(body).not.toContain(realRoot);
    }
  });
});
