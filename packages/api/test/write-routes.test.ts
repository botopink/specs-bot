import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createApp } from "../src/app.ts";
import type { SpecEvent } from "../src/events.ts";

const FILES: Record<string, string> = {
  "specs/decisions-taken-steps.md": "**The next free number is 2.**\n\n## L\n\n| # | Id | Rule in force | Binds | Cell |\n|---|---|---|---|---|\n| 1 | q-1 | A rule | x |  |\n",
  "specs/decisions-pending.md": "the next free\nnumber, which is **2**.\n\n## Machine 1\n\nNone open.\n",
  "specs/decisions-taken.md": "# T\n\n## lang — l\n\n**L.**\n\nText.\n\nSteps: 1\nBinds: x\n",
  "specs/retired.md": "# R\n",
  "specs/1.0.12-beta/status.md": "# Status\n\n## Done\n\n- [x] a\n\n## Open\n\n- [ ] b\n",
};

async function git(cwd: string, ...args: string[]) {
  const p = Bun.spawn(["git", "-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  if ((await p.exited) !== 0) throw new Error(await new Response(p.stderr).text());
  return out.trim();
}

let root: string;
let app: ReturnType<typeof createApp>;
let events: SpecEvent[];
const TOKEN = "tok-m2";

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "specs-bot-wr-"));
  for (const [p, t] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), t);
  }
  await git(root, "init", "-q", "-b", "main");
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "init");
  app = createApp({ host: "127.0.0.1", port: 0, dataPath: root, tokens: new Map([[TOKEN, "machine-2"]]) });
  events = [];
  app.bus.subscribe((e) => events.push(e));
});

async function call(method: string, path: string, body?: unknown, token: string | null = TOKEN) {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

describe("POST /api/write/<op>", () => {
  test("a write needs a token", async () => {
    expect((await call("POST", "/api/write/doc.append", { ref: "1.0.12-beta/status", section: "done", text: "- [x] c" }, null)).status).toBe(401);
  });

  test("without apply it is a dry run: the diff, nothing written", async () => {
    const r = await call("POST", "/api/write/doc.append", { ref: "1.0.12-beta/status", section: "done", text: "- [x] c" });
    expect([r.status, r.body.applied]).toEqual([200, false]);
    expect(r.body.diff).toContain("+- [x] c");
    expect(readFileSync(join(root, "specs/1.0.12-beta/status.md"), "utf8")).toBe(FILES["specs/1.0.12-beta/status.md"]!);
    expect(events).toEqual([]);
  });

  test("applied: one commit, the next read sees it, the machines hear it", async () => {
    const r = await call("POST", "/api/write/doc.append", { ref: "1.0.12-beta/status", section: "done", text: "- [x] c", apply: true, landed: ["rakun@abc1234"] });
    expect([r.status, r.body.applied]).toEqual([200, true]);
    expect(await git(root, "log", "-1", "--format=%an %h")).toBe(`machine-2 ${r.body.commit}`);
    const read = await call("GET", "/api/docs/1.0.12-beta/status?section=done");
    expect(read.body.text).toBe("## Done\n\n- [x] a\n- [x] c\n");
    expect(events).toMatchObject([{ type: "write", op: "doc.append", party: "machine-2", commit: r.body.commit, refs: ["1.0.12-beta/status#done"] }]);
    // The site is rebuilt over the new model too.
    const page = await app.request("/docs/1.0.12-beta/status");
    expect(await page.text()).toContain("c</li>");
  });

  test("an edit carries the etag it read; a stale one is a 409 with the current etag", async () => {
    const read = await call("GET", "/api/docs/1.0.12-beta/status?section=open");
    const ok = await call("POST", "/api/write/doc.replace", { ref: "1.0.12-beta/status", section: "open", text: "## Open\n\n- [x] b\n", etag: read.body.etag, apply: true });
    expect(ok.body.applied).toBe(true);
    const stale = await call("POST", "/api/write/doc.replace", { ref: "1.0.12-beta/status", section: "open", text: "## Open\n\n- [ ] z\n", etag: read.body.etag, apply: true });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: "conflict" });
    expect(stale.body.etag).not.toBe(read.body.etag);
  });

  test("the rules answer 422 with what broke", async () => {
    const r = await call("POST", "/api/write/doc.append", { ref: "1.0.12-beta/status", section: "done", text: "- [x] in 1a2b3c4d", apply: true });
    expect(r.status).toBe(422);
    expect(r.body.findings[0]).toMatchObject({ rule: "commit-hash", match: "1a2b3c4d" });
  });

  test("an unknown op lists the known ones; a missing field is named", async () => {
    expect((await call("POST", "/api/write/nope", {})).status).toBe(404);
    expect((await call("POST", "/api/write/doc.append", { ref: "1.0.12-beta/status" })).body.error).toBe("section is required (a string)");
  });
});

describe("decision and chat writes over HTTP", () => {
  const FIELDS = { Measured: "Built.", Options: "(a); (b).", Recommendation: "(a).", Blocks: "Nothing." };

  test("open a question, answer it: the row, the number, the review mark", async () => {
    const opened = await call("POST", "/api/write/pending.add", { id: "q-9", section: "Machine 1", title: "Narrow?", fields: FIELDS, apply: true });
    expect(opened.body.applied).toBe(true);
    const read = await call("GET", "/api/pending/q-9");
    expect(read.body.etag).toHaveLength(12);
    const answered = await call("POST", "/api/write/answer", { id: "q-9", rule: "**It narrows.**", binds: "x", apply: true });
    expect(answered.body.refs).toEqual(["step 2", "pending q-9"]);
    expect((await call("GET", "/api/next")).body).toMatchObject({ nextFree: 3, agree: true });
    expect((await call("GET", "/api/steps/2")).body).toMatchObject({ id: expect.stringContaining("q-9 · (the coordinator †"), rule: "**It narrows.**" });
    expect((await call("GET", "/api/pending/q-9")).body.hint).toBe("answered by step 2");
  });

  test("a message is filed and heard as a chat event", async () => {
    const sent = await call("POST", "/api/write/chat.send", { to: "maintainer", purpose: "report", subject: "Landed the thing", text: "Done.", apply: true });
    expect(sent.body.applied).toBe(true);
    expect(events.map((e) => e.type)).toEqual(["write", "chat"]);
    expect(events[1]).toMatchObject({ type: "chat", from: "machine-2", to: "maintainer", subject: "Landed the thing" });
    expect((await call("GET", "/api/chat?to=maintainer")).body.messages[0]).toMatchObject({ from: "machine-2", subject: "Landed the thing" });
  });

  test("the maintainer's review is refused to a machine", async () => {
    expect((await call("POST", "/api/write/review", { num: 1, apply: true })).status).toBe(403);
  });
});
