// `specs-bot mcp` end to end: an in-process api over a fixture data repo, the CLI spawned as an MCP server in a
// project folder pointing at it, driven over stdio as a client would.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createApp } from "../../api/src/app.ts";
import { websocket } from "../../api/src/ws.ts";

const CLI = join(import.meta.dir, "..", "src", "index.ts");

const FILES: Record<string, string> = {
  "specs/decisions-taken-steps.md": "**The next free number is 2.**\n\n## L\n\n| # | Id | Rule in force | Binds | Cell |\n|---|---|---|---|---|\n| 1 | q-1 | A rule | x |  |\n",
  "specs/decisions-pending.md": "the next free\nnumber, which is **2**.\n\n## Machine 1\n\nNone open.\n",
  "specs/decisions-taken.md": "# T\n\n## lang — l\n\n**L.**\n\nText.\n\nSteps: 1\nBinds: x\n",
  "specs/retired.md": "# R\n",
  "specs/milestone/README.md": "---\nmilestone: 1.0.12-beta\n---\n# Specs\n",
  "specs/milestone/status.md": "---\nmilestone: 1.0.12-beta\n---\n# Status\n\n## Done\n\n- [x] a\n\n## Open\n\n- [ ] b\n",
};

async function git(cwd: string, ...args: string[]) {
  const p = Bun.spawn(["git", "-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  if ((await p.exited) !== 0) throw new Error(await new Response(p.stderr).text());
  return out.trim();
}

type Result = { isError?: boolean; content: { type: string; text: string }[] };

/** One `specs-bot mcp` process and a JSON-RPC client over its stdio. */
function spawnMcp(cwd: string, env: Record<string, string>) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("SPECS_")));
  const proc = Bun.spawn([process.execPath, CLI, "mcp"], { cwd, env: { ...clean, ...env }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const pending = new Map<number, (m: any) => void>();
  let id = 0;
  let stderr = "";
  void (async () => {
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of proc.stdout) {
      buf += decoder.decode(chunk, { stream: true });
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const m = JSON.parse(line);
        pending.get(m.id)?.(m);
        pending.delete(m.id);
      }
    }
  })();
  void (async () => {
    for await (const chunk of proc.stderr) stderr += new TextDecoder().decode(chunk);
  })();
  const send = (m: unknown) => {
    proc.stdin.write(`${JSON.stringify(m)}\n`);
    proc.stdin.flush();
  };
  const rpc = (method: string, params: unknown = {}): Promise<any> => {
    const n = ++id;
    const answer = new Promise<any>((resolve) => pending.set(n, resolve));
    send({ jsonrpc: "2.0", id: n, method, params });
    return answer;
  };
  const tool = async (name: string, args: Record<string, unknown> = {}): Promise<Result> => {
    const m = await rpc("tools/call", { name, arguments: args });
    if (m.error) throw new Error(JSON.stringify(m.error));
    return m.result;
  };
  const init = async () => {
    const r = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return r;
  };
  return { proc, rpc, tool, init, stderr: () => stderr };
}

const text = (r: Result) => r.content.map((c) => c.text).join("\n");

describe("specs-bot mcp", () => {
  let data: string;
  let project: string;
  let app: ReturnType<typeof createApp>;
  let server: ReturnType<typeof Bun.serve>;
  let env: Record<string, string>;
  let first: ReturnType<typeof spawnMcp>;
  let second: ReturnType<typeof spawnMcp> | undefined;

  /** machine-1, over HTTP: a session of its own (taken once), then a write. */
  let m1: string | undefined;
  const asMachine1 = async (op: string, body: Record<string, unknown>) => {
    m1 ??= ((await (await app.request("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ party: "machine-1", label: "test" }) })).json()) as { session: string }).session;
    const res = await app.request(`/api/write/${op}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-specs-bot-session": m1 },
      body: JSON.stringify({ ...body, apply: true }),
    });
    expect(res.status).toBe(200);
  };

  beforeAll(async () => {
    data = mkdtempSync(join(tmpdir(), "specs-bot-mcp-data-"));
    for (const [p, t] of Object.entries(FILES)) {
      mkdirSync(dirname(join(data, p)), { recursive: true });
      writeFileSync(join(data, p), t);
    }
    await git(data, "init", "-q", "-b", "main");
    await git(data, "add", ".");
    await git(data, "commit", "-qm", "init");
    app = createApp({ host: "127.0.0.1", port: 0, dataPath: data, tokens: new Map() });
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket });
    project = mkdtempSync(join(tmpdir(), "specs-bot-mcp-project-"));
    writeFileSync(join(project, ".env"), `SPECS_BOT_API_URL=http://127.0.0.1:${server.port}/api\n`);
    // A folder's SPECS_BOT_AS is not the session's party: the maintainer and machine-1 may share a folder.
    writeFileSync(join(project, ".env.local"), "SPECS_BOT_AS=maintainer\n");
    env = { XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "specs-bot-mcp-state-")) };
    first = spawnMcp(project, env);
  });

  afterAll(() => {
    first.proc.kill();
    second?.proc.kill();
    void server.stop(true);
  });

  test("initialize names the server; tools/list has the reads, the writes and wait", async () => {
    const init = await first.init();
    expect(init.result.serverInfo.name).toBe("specs-bot");
    expect(init.result.capabilities.tools).toBeDefined();
    const names = ((await first.rpc("tools/list")).result.tools as { name: string; inputSchema: { type: string } }[]).map((t) => t.name);
    for (const n of ["as", "logout", "whoami", "search", "doc", "chat", "sessions", "wait", "edit", "append", "add_section", "new_doc", "meta", "answer", "send", "mark_read", "claim", "release", "assign", "doing", "done"]) {
      expect(names).toContain(n);
    }
  });

  test("no party until the session names one with as; then it is held over the websocket", async () => {
    expect(text(await first.tool("whoami"))).toContain("party: null");
    expect(text(await first.tool("as", { party: "machine-2" }))).toContain("party: machine-2");
    const t = text(await first.tool("whoami"));
    expect(t).toContain("party: machine-2");
    expect(t).toMatch(/session: [0-9a-f]{32}/);
    expect(t).toContain("state: holding the party");
    const held = (await (await app.request("/api/sessions")).json()) as { sessions: { party: string; bound?: boolean }[] };
    expect(held.sessions).toContainEqual(expect.objectContaining({ party: "machine-2", bound: true }));
  }, 15000);

  test("a read tool answers in TOON", async () => {
    const r = await first.tool("doc", { ref: "milestone/status", section: "done" });
    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain("etag: ");
    expect(text(r)).toContain("---\n## Done\n\n- [x] a\n");
  });

  test("doc without a section is its outline (anchors and how many deeper), whole only when asked", async () => {
    const outline = text(await first.tool("doc", { ref: "milestone/status" }));
    expect(outline).toContain("outline[");
    expect(outline).toContain("{level,anchor,deeper}");
    expect(outline).not.toContain("etag");
    expect(outline).not.toContain("- [x] a");
    const whole = text(await first.tool("doc", { ref: "milestone/status", whole: true }));
    expect(whole).toContain("- [x] a");
  });

  test("a write is a dry run unless apply: true; applied, it lands as a commit by the party", async () => {
    const dry = text(await first.tool("append", { ref: "milestone/status", section: "done", text: "- [x] c" }));
    expect(dry).toContain("applied: false");
    expect(dry).toContain("apply: true");
    expect(dry).toContain("+- [x] c");
    expect(readFileSync(join(data, "specs/milestone/status.md"), "utf8")).toBe(FILES["specs/milestone/status.md"]!);

    const done = text(await first.tool("append", { ref: "milestone/status", section: "done", text: "- [x] c", apply: true }));
    expect(done).toContain("applied: true");
    const commit = done.match(/commit: (\w+)/)![1];
    expect(await git(data, "log", "-1", "--format=%an %h")).toBe(`machine-2 ${commit}`);
  }, 15000);

  test("doing says what the session's party is doing, done clears it; tiny answers, and no doing events after a result", async () => {
    const set = await first.tool("doing", { text: "appending to the status" });
    expect(set.isError).toBeUndefined();
    expect(text(set)).toBe("party: machine-2\ndoing: appending to the status");
    const now = (await (await app.request("/api/now")).json()) as { parties: { party: string; doing: { text: string } | null }[] };
    expect(now.parties.find((p) => p.party === "machine-2")!.doing!.text).toBe("appending to the status");

    // Another party's doing (and its session) is not appended to this session's results.
    const m1 = ((await (await app.request("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ party: "machine-3", label: "t" }) })).json()) as { session: string }).session;
    await app.request("/api/doing", { method: "POST", headers: { "content-type": "application/json", "x-specs-bot-session": m1 }, body: JSON.stringify({ text: "elsewhere" }) });
    await app.request("/api/session", { method: "DELETE", headers: { "x-specs-bot-session": m1 } });
    await Bun.sleep(150);
    expect(text(await first.tool("done"))).toBe("party: machine-2\ndoing: null");
    const after = (await (await app.request("/api/now")).json()) as { parties: { party: string; doing: unknown }[] };
    expect(after.parties.find((p) => p.party === "machine-2")!.doing).toBeNull();
  }, 15000);

  test("an api error is a tool error, in TOON with its hint", async () => {
    const r = await first.tool("step", { n: 999 });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("error: ");
    expect(text(r)).toContain("status: 404");
  });

  test("what others did since the previous call comes after the answer", async () => {
    await asMachine1("chat.send", { to: "machine-2", purpose: "question", subject: "Ping from m1", text: "Hello." });
    await Bun.sleep(200);
    const t = text(await first.tool("next"));
    const [answer, events] = t.split("\n\n---\n");
    expect(answer).toContain("next");
    // One short line an event; a message is its chat line alone, not also the write that filed it.
    expect(events).toBe("events:\n  chat m1-0001 machine-1→machine-2: Ping from m1");
    // Read once: the next call has none.
    expect(text(await first.tool("next"))).not.toContain("events:");
  }, 15000);

  test("wait returns the next event", async () => {
    const waiting = first.tool("wait", { types: ["write"], timeout: 10 });
    await Bun.sleep(300);
    await asMachine1("doc.append", { ref: "milestone/status", section: "open", text: "- [ ] d" });
    const t = text(await waiting);
    expect(t).toContain("type: write");
    expect(t).toContain("party: machine-1");
    expect(t).toContain("op: doc.append");
  }, 15000);

  test("wait gives up after its timeout", async () => {
    const t = text(await first.tool("wait", { types: ["presence"], timeout: 1 }));
    expect(t).toContain("timeout: true");
  }, 15000);

  test("a second server naming the same party reads, but its writes name the holder", async () => {
    second = spawnMcp(project, env);
    await second.init();
    const taken = await second.tool("as", { party: "machine-2" });
    expect(taken.isError).toBe(true);
    expect(text(taken)).toContain("machine-2 is in use by another session");
    expect(text(await second.tool("overview"))).not.toContain("error");
    const w = await second.tool("append", { ref: "milestone/status", section: "done", text: "- [x] e" });
    expect(w.isError).toBe(true);
    expect(text(w)).toContain("machine-2 is in use by another session");
    expect(text(w)).toContain("hint: ");
  }, 15000);

  test("when the first exits, the party is free and the second takes it on its next call", async () => {
    first.proc.kill();
    await first.proc.exited;
    await Bun.sleep(200);
    const w = await second!.tool("append", { ref: "milestone/status", section: "done", text: "- [x] e" });
    expect(w.isError).toBeUndefined();
    expect(text(w)).toContain("applied: false");
    expect(text(await second!.tool("whoami"))).toContain("state: holding the party");
  }, 15000);

  test("closing stdin ends the server and lets go of the party", async () => {
    second!.proc.stdin.end();
    expect(await second!.proc.exited).toBe(0);
    await Bun.sleep(200);
    const held = (await (await app.request("/api/sessions")).json()) as { sessions: { party: string }[] };
    expect(held.sessions.map((s) => s.party)).not.toContain("machine-2");
  }, 15000);
});

describe("specs-bot mcp without a party", () => {
  test("reads work; writes are refused with the hint", async () => {
    const app = createApp({ host: "127.0.0.1", port: 0, dataPath: "/nowhere", tokens: new Map() });
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket });
    const project = mkdtempSync(join(tmpdir(), "specs-bot-mcp-ro-"));
    writeFileSync(join(project, ".env"), `SPECS_BOT_API_URL=http://127.0.0.1:${server.port}/api\n`);
    const mcp = spawnMcp(project, { XDG_STATE_HOME: project });
    try {
      await mcp.init();
      expect(text(await mcp.tool("whoami"))).toContain("party: null");
      const w = await mcp.tool("send", { to: "all", purpose: "report", subject: "x", text: "y" });
      expect(w.isError).toBe(true);
      expect(text(w)).toContain("call the as tool");
      const d = await mcp.tool("doing", { text: "x" });
      expect(d.isError).toBe(true);
      expect(text(d)).toContain("call the as tool");
    } finally {
      mcp.proc.kill();
      void server.stop(true);
    }
  }, 15000);
});

describe("two sessions in one folder", () => {
  test("are two parties: each names its own with as, the folder's token and SPECS_BOT_AS are not used", async () => {
    const app = createApp({ host: "127.0.0.1", port: 0, dataPath: "/nowhere", tokens: new Map([["tm", "maintainer"]]) });
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket });
    const project = mkdtempSync(join(tmpdir(), "specs-bot-mcp-shared-"));
    writeFileSync(join(project, ".env"), `SPECS_BOT_API_URL=http://127.0.0.1:${server.port}/api\n`);
    writeFileSync(join(project, ".env.local"), "SPECS_BOT_TOKEN=tm\nSPECS_BOT_AS=maintainer\n");
    const maintainer = spawnMcp(project, { XDG_STATE_HOME: project });
    const m1 = spawnMcp(project, { XDG_STATE_HOME: project });
    try {
      await maintainer.init();
      await m1.init();
      expect(text(await m1.tool("whoami"))).toContain("party: null");
      expect(text(await maintainer.tool("as", { party: "maintainer" }))).toContain("party: maintainer");
      expect(text(await m1.tool("as", { party: "machine-1" }))).toContain("party: machine-1");
      const held = (await (await fetch(`http://127.0.0.1:${server.port}/api/sessions`)).json()) as { sessions: { party: string }[] };
      expect(held.sessions.map((x) => x.party).sort()).toEqual(["machine-1", "maintainer"]);
      // logout lets go; the other session could take it now.
      expect(text(await m1.tool("logout"))).toContain("party: null");
      await Bun.sleep(100);
      const after = (await (await fetch(`http://127.0.0.1:${server.port}/api/sessions`)).json()) as { sessions: { party: string }[] };
      expect(after.sessions.map((x) => x.party)).toEqual(["maintainer"]);
    } finally {
      maintainer.proc.kill();
      m1.proc.kill();
      void server.stop(true);
    }
  }, 15000);
});
