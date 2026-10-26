import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createSite, type NowData } from "../src/index.ts";
import { relTime } from "../src/now.ts";
import { NOW_SCRIPT } from "../src/views/now.tsx";

const FILES: Record<string, string> = {
  "decisions-taken-steps.md": "**The next free number is 2.**\n\n## L\n\n| # | Id | Rule in force | Binds | Cell |\n|---|---|---|---|---|\n| 1 | q-1 | A rule | x |  |\n",
  "decisions-pending.md": "the next free\nnumber, which is **2**.\n\n## Machine 1\n\nNone open.\n",
  "decisions-taken.md": "# T\n\n## lang — l\n\n**L.**\n\nText.\n\nSteps: 1\nBinds: x\n",
  "retired.md": "# R\n",
  "milestone/README.md": "---\nmilestone: 1.0.12-beta\n---\n# Specs\n",
  "milestone/status.md": "---\nmilestone: 1.0.12-beta\n---\n# Status\n\n## Done\n\n- [x] a\n",
  "150-rakun/README.md": "---\nmilestone: 1.0.12-beta\nowner: machine-1\n---\n# Front 150 — rakun\n",
};

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "specs-bot-site-now-"));
  for (const [p, t] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, "specs", p)), { recursive: true });
    writeFileSync(join(root, "specs", p), t);
  }
  return root;
}

const AT = "2026-10-26T12:00:00.000Z";
const minutesBefore = (m: number) => new Date(Date.parse(AT) - m * 60_000).toISOString();

const NOW: NowData = {
  at: AT,
  parties: [
    { party: "maintainer", online: false, session: null, doing: null, fronts: [], recent: [], chat: [] },
    {
      party: "machine-1",
      online: true,
      session: { label: "box · ~/projects", since: minutesBefore(90), bound: true },
      doing: { text: "Porting the <router> to rakun", front: "150-rakun", since: minutesBefore(5) },
      fronts: ["150-rakun"],
      recent: [{ op: "doc.append", summary: "milestone/status: done d", refs: ["milestone/status#done", "step 1", "pending 9-c", "150-rakun", "elsewhere"], commit: "abc1234", at: minutesBefore(3) }],
      chat: [{ id: "mt-0001", from: "maintainer", to: "machine-1", subject: "Hello there", at: "2026-10-21T11:44" }],
    },
    { party: "machine-2", online: true, session: { label: "host", since: minutesBefore(1), bound: false }, doing: null, fronts: [], recent: [], chat: [] },
    { party: "machine-3", online: false, session: null, doing: null, fronts: [], recent: [], chat: [] },
  ],
};

const status = async () => ({ ok: true, branch: "main", head: "abc1234" });

describe("/now", () => {
  const site = createSite({ dataPath: fixture(), status, version: "0.0.1", now: () => NOW });
  const get = async (path: string) => {
    const res = await site.request(path);
    return { status: res.status, body: await res.text(), res };
  };

  test("a card per party: online, where, the doing line with its front and doc, fronts, writes, chat", async () => {
    const { status, body, res } = await get("/now");
    expect(status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    for (const p of ["maintainer", "machine-1", "machine-2", "machine-3"]) expect(body).toContain(`id="now-${p}"`);
    const m1 = body.slice(body.indexOf('id="now-machine-1"'), body.indexOf('id="now-machine-2"'));
    expect(m1).toContain('class="dot on"');
    expect(m1).toContain("online since");
    expect(m1).toContain("box · ~/projects · mcp");
    // The doing line, escaped, with its front and the front's README.
    expect(m1).toContain("Porting the &lt;router&gt; to rakun");
    expect(m1).toContain('href="/fronts#150-rakun"');
    expect(m1).toContain('href="/docs/150-rakun/README"');
    // The refs of a write go where they name: a document's section, a step, a question, a front; an unknown ref stays text.
    expect(m1).toContain('href="/docs/milestone/status#done"');
    expect(m1).toContain('href="/steps/1"');
    expect(m1).toContain('href="/pending/9-c"');
    expect(m1).toContain("<span>elsewhere</span>");
    expect(m1).toContain("Hello there");
    expect(m1).toContain(`datetime="${minutesBefore(3)}" data-rel=""`);
    expect(m1).toContain("3 min ago");
    // Identifiers stay out of the translator.
    expect(m1).toContain('<h2 translate="no">machine-1</h2>');
    const m3 = body.slice(body.indexOf('id="now-machine-3"'));
    expect(m3).toContain('class="dot off"');
    expect(m3).toContain("offline");
  });

  test("the page carries the live script: a reader on the websocket asking for the /now events, fetching the cards again", async () => {
    const { body } = await get("/now");
    expect(body).toContain('data-now="/now/cards"');
    expect(body).toContain('class="live"');
    expect(body).toContain(NOW_SCRIPT);
    expect(NOW_SCRIPT).toContain('"/api/ws?types="');
    expect(NOW_SCRIPT).toContain('["write", "chat", "presence", "doing", "session"]');
    expect(NOW_SCRIPT).not.toContain("as=");
    expect(() => new Function(NOW_SCRIPT)).not.toThrow();
  });

  test("the cards alone, for the script; the nav names Now", async () => {
    const cards = await get("/now/cards");
    expect(cards.status).toBe(200);
    expect(cards.body).not.toContain("<html");
    expect(cards.body).toContain('id="now-machine-1"');
    expect((await get("/fronts")).body).toContain('href="/now" class="nav-now"');
    expect((await get("/now")).body).toContain('href="/now" class="on nav-now"');
  });

  test("the overview's strip: a line per party, linking to its card, live too", async () => {
    const { body } = await get("/");
    expect(body).toContain('data-now="/now/strip"');
    expect(body).toContain('href="/now#now-machine-1"');
    expect(body).toContain("Porting the &lt;router&gt; to rakun");
    expect(body).toContain(NOW_SCRIPT);
    const strip = await get("/now/strip");
    expect(strip.body).toContain('href="/now#now-machine-3"');
  });

  test("without the api's live status the page says so, and the overview has no strip", async () => {
    const plain = createSite({ dataPath: fixture(), status, version: "0.0.1" });
    const page = await (await plain.request("/now")).text();
    expect(page).toContain("The live status is not available here.");
    expect(page).not.toContain(NOW_SCRIPT);
    expect(await (await plain.request("/")).text()).not.toContain("now-strip");
    expect((await plain.request("/now/cards")).status).toBe(404);
  });
});

test("relTime", () => {
  const t = Date.parse(AT);
  expect(relTime(minutesBefore(0), t)).toBe("just now");
  expect(relTime(minutesBefore(7), t)).toBe("7 min ago");
  expect(relTime(minutesBefore(180), t)).toBe("3 h ago");
  expect(relTime(minutesBefore(60 * 72), t)).toBe("3 d ago");
  expect(relTime("not a date", t)).toBe("not a date");
});
