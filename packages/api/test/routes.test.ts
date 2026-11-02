import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildModel, loadStore, parseSteps } from "@specs-bot/core";
import { createApp } from "../src/app.ts";
import { renderLedger } from "../src/routes.ts";

// The decisions-taken/ directory layout (group.ts): a README.md index plus one file per group — "lang" holds
// the one row in force (3) and its prose, "overtaken" holds the row it overtook (1), unfiled stays empty.
const FILES: Record<string, string> = {
  "specs/decisions-taken/README.md": `# Decisions taken

The rules in force. **The next free number is 4.**

## Groups

- lang
- overtaken
`,
  "specs/decisions-taken/lang.md": `# lang — the language

**Types are nominal.**

(1) An opaque record hides its fields (3).

Steps: 3
Binds: x

## Record

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
| 3 | q-3 · (the maintainer) | **An opaque type's constructor is private.** | \`machine-1/150\` s4 | opaque_private |
`,
  "specs/decisions-taken/overtaken.md": `# overtaken — rows no longer in force

## Record

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
| 1 | q-1 · (the maintainer) | Overtaken by 3 (later) | \`machine-1/150\` s3 |  |
`,
  "specs/decisions-pending.md": `# Pending

the next free
number, which is **4**.

## To review

| Reviewed | Row | Answered | What |
|---|---|---|---|
| [ ] | 3 | q-3 | Answered by the maintainer |

## Machine 1

#### q-9 · Does \`for-await-one-source\` refuse?

- **Measured.** Built as (a).
- **Recommendation.** (c).
`,
  "specs/retired.md": `# Retired

## Language spellings

| Retired | Replaced by | Decisions | Since / note |
|---|---|---|---|
| \`@Task<T>\` | \`Async<T>\` | 3 |  |
`,
  "specs/milestone/README.md": "---\nmilestone: 1.0.12-beta\n---\n# Specs — 1.0.12-beta\n",
  "specs/milestone/status.md": "---\nmilestone: 1.0.12-beta\n---\n# Status\n\n## Done\n\n- a\n\n## Open\n\n- b\n",
  "specs/fronts/150-rakun/README.md": "---\nmilestone: 1.0.12-beta\nowner: machine-1\n---\n# Front 150 — rakun\n\n## Steps\n\nRouting.\n",
  // The target is the pre-migration, unprefixed shape on purpose: moved.json was written before fronts/ existed
  // and knows nothing of it; docAt (model.ts) resolves that shape onto the real, fronts/-prefixed document.
  "moved.json": JSON.stringify({
    "1.0.12-beta/machine-1/150-rakun/README": "150-rakun/README",
    "1.0.11-beta/overview": "https://github.com/botopink/specs-data/blob/abc/specs/1.0.11-beta/overview.md",
  }),
  "conversation-chat/machine-2/20261021-1144-rebased-m1-0024.md":
    "---\nfrom: machine-1\nto: machine-2\npurpose: report\nsubject: Rebased\nread: [ ]\nin-reply-to:\n---\n\nDone.\n",
};

let app: ReturnType<typeof createApp>;
const TOKEN = "t-machine-1";

beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), "specs-bot-api-"));
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  app = createApp({ host: "127.0.0.1", port: 0, dataPath: root, tokens: new Map([[TOKEN, "machine-1"]]) });
});

async function get(path: string, token?: string) {
  const res = await app.request(path, token ? { headers: { authorization: `Bearer ${token}` } } : {});
  return { status: res.status, body: (await res.json()) as any };
}

describe("the read api", () => {
  test("whoami names the token's party, or none", async () => {
    expect((await get("/api/whoami", TOKEN)).body).toEqual({ party: "machine-1" });
    expect((await get("/api/whoami")).body).toEqual({ party: null });
  });

  test("an unknown token is refused", async () => {
    expect((await get("/api/whoami", "nope")).status).toBe(401);
  });

  test("overview and next free number", async () => {
    const o = (await get("/api/overview")).body;
    expect(o.steps).toEqual({ total: 2, "in-force": 1, overtaken: 1, replaced: 0, reversed: 0 });
    expect([o.pending, o.review, o.nextFree]).toEqual([1, { open: 1, total: 1 }, 4]);
    expect((await get("/api/next")).body).toEqual({ nextFree: 4, stated: { steps: 4, pending: 4 }, agree: true });
  });

  test("a step with what it supersedes and who cites it", async () => {
    const s = (await get("/api/steps/3")).body;
    expect(s.supersedes).toEqual([{ num: 1, status: "overtaken" }]);
    expect(s.subjects).toEqual(["lang"]);
    expect(s.retired).toEqual([{ retired: "`@Task<T>`", replacedBy: "`Async<T>`" }]);
  });

  test("a missing step says whether the number was ever used", async () => {
    expect((await get("/api/steps/2")).body).toMatchObject({ error: "step 2 not found", hint: "2 is a number never used" });
    expect((await get("/api/steps/9")).body.hint).toBe("the next free number is 4");
  });

  test("steps filter by status", async () => {
    expect((await get("/api/steps?status=superseded")).body.steps.map((s: any) => s.num)).toEqual([1]);
  });

  test("a pending question, and an answered id points at its step", async () => {
    expect((await get("/api/pending/q-9")).body.fields.map((f: any) => f.name)).toEqual(["Measured", "Recommendation"]);
    expect((await get("/api/pending/q-3")).body).toMatchObject({ hint: "answered by step 3" });
  });

  test("search finds a refusal code", async () => {
    expect((await get("/api/search?q=for-await-one-source")).body.hits[0]).toMatchObject({ kind: "pending", key: "q-9" });
    expect((await get("/api/search")).status).toBe(400);
  });

  test("a front with the in-force rows that bind it", async () => {
    const f = (await get("/api/fronts/150")).body;
    expect(f.fronts[0]).toMatchObject({ ref: "fronts/150-rakun", owner: "machine-1", title: "Front 150 — rakun" });
    expect(f.binds).toEqual([3]);
  });

  test("a document whole, its outline, or one section", async () => {
    // A ref without the fronts/ prefix (the shape before the real migration) still answers — docAt's fallback.
    expect((await get("/api/docs/milestone/status?outline")).body.outline.map((s: any) => s.anchor)).toEqual(["status", "done", "open"]);
    expect((await get("/api/docs/milestone/status?section=open")).body.text).toBe("## Open\n\n- b\n");
    expect((await get("/api/docs/150-rakun")).body.ref).toBe("fronts/150-rakun/README");
  });

  test("a ref from before the flattening answers as its new one; a removed file names its permalink", async () => {
    expect((await get("/api/docs/1.0.12-beta/machine-1/150-rakun")).body.ref).toBe("fronts/150-rakun/README");
    const gone = await get("/api/docs/1.0.11-beta/overview");
    expect(gone.status).toBe(404);
    expect(gone.body.movedTo).toStartWith("https://github.com/botopink/specs-data/blob/abc/");
  });

  test("no answer carries a file path", async () => {
    const all = await Promise.all(["/api/overview", "/api/docs/milestone/status", "/api/check", "/api/chat"].map((p) => get(p)));
    for (const r of all) expect(JSON.stringify(r.body)).not.toContain(tmpdir());
  });

  test("chat lists what a party has not read", async () => {
    expect((await get("/api/chat?unread=machine-2")).body.messages.map((m: any) => m.id)).toEqual(["m1-0024"]);
    expect((await get("/api/chat/m1-0024")).body.body).toBe("Done.\n");
  });

  test("check reports the findings", async () => {
    expect((await get("/api/check")).body.summary).toEqual({});
  });
});

describe("renderLedger", () => {
  test("round-trips through parseSteps: the same rows, the same fields, in model.steps.rows's own number order", () => {
    const root = mkdtempSync(join(tmpdir(), "specs-bot-ledger-"));
    for (const [path, text] of Object.entries(FILES)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const model = buildModel(loadStore(root));
    const rendered = renderLedger(model);
    expect(rendered).toContain("**The next free number is 4.**");
    expect(rendered).toContain("## lang");
    expect(rendered).toContain("## overtaken");

    // `line` is a position in whichever document it was read from — the group file for model.steps.rows, the
    // rendered ledger for the reread rows — so it is never part of the round trip's own equality.
    const strip = <T extends { line: number }>(rows: readonly T[]) => rows.map(({ line: _, ...rest }: T) => rest);
    // Rows are grouped under their own `##` heading, same as the pre-split file (steps.test.ts's SAMPLE:
    // Language holds 1 and 3, Backends holds 2 — never one global run from 1 up), so the round trip is checked
    // sorted by num rather than by position.
    const byNum = (a: { num: number }, b: { num: number }) => a.num - b.num;
    const expected = strip([...model.steps.rows].sort(byNum));
    expect(strip(parseSteps(rendered).rows).sort(byNum)).toEqual(expected);
  });
});

describe("export", () => {
  test("ledger: the record and the current milestone's READMEs, by relative path", async () => {
    const r = (await get("/api/export/ledger")).body;
    // Both the milestone's own README and every front's README come back, each three segments deep
    // under fronts/ (milestone/README, fronts/<front>/README) — the same pair the pre-fronts/
    // filter caught by its two-segment shape.
    expect(Object.keys(r.files).sort()).toEqual([
      "decisions-taken-steps.md",
      "fronts/150-rakun/README.md",
      "milestone/README.md",
    ]);
    expect(r.files["decisions-taken-steps.md"]).toContain("| 3 | q-3");
    expect(r.files["fronts/150-rakun/README.md"]).toContain("Front 150 — rakun");
    expect(r.files["milestone/README.md"]).toContain("Specs — 1.0.12-beta");
  });

  test("an unknown set is refused; a missing file is a 404", async () => {
    expect((await get("/api/export/everything")).status).toBe(404);
    expect((await get("/api/export/language-gaps")).status).toBe(404);
  });
});
