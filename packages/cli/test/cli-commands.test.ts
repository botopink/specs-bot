// The CLI's commands as a shell runs them, against a stand-in api that records what it is sent.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const seen: { method: string; path: string; body: unknown; session: string | null }[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const body = req.method === "GET" ? null : await req.json().catch(() => null);
    seen.push({ method: req.method, path: url.pathname, body, session: req.headers.get("x-specs-bot-session") });
    if (url.pathname === "/api/session" && req.method === "POST") return Response.json({ session: "s1", party: "machine-1", since: "t" });
    if (url.pathname === "/api/doing") {
      const b = body as { text: string; front?: string } | null;
      return Response.json(req.method === "DELETE" ? { party: "machine-1", cleared: true } : { party: "machine-1", doing: { text: b!.text, front: b!.front ? "150-rakun" : null, since: "t" } });
    }
    if (url.pathname.startsWith("/api/write/")) return Response.json({ applied: false, op: url.pathname.slice("/api/write/".length), refs: [], diff: "" });
    return Response.json({ sessions: [] });
  },
});
afterAll(() => server.stop(true));

const folder = mkdtempSync(join(tmpdir(), "specs-bot-cmd-"));
writeFileSync(join(folder, ".env"), `SPECS_BOT_API_URL=http://127.0.0.1:${server.port}/api\n`);
writeFileSync(join(folder, ".env.local"), "SPECS_BOT_AS=machine-1\n");
const state = mkdtempSync(join(tmpdir(), "specs-bot-state-"));
const cli = join(import.meta.dir, "../src/index.ts");

// The test's own settings must not leak in: the folder's .env files are the only ones read.
const env: Record<string, string | undefined> = { ...process.env, XDG_STATE_HOME: state };
for (const k of Object.keys(env)) if (k.startsWith("SPECS_BOT_")) delete env[k];

// Spawned, not spawned in sync: the stand-in api answers from this process.
async function run(...args: string[]) {
  const p = Bun.spawn(["bun", cli, ...args], { cwd: folder, env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
}

describe("the CLI's commands", () => {
  test("a read takes no party: sessions goes without one", async () => {
    seen.length = 0;
    expect((await run("sessions")).code).toBe(0);
    expect(seen.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /api/sessions"]);
  });

  test("claim, release and assign send their front (and the machine) to their ops; the first write takes the party", async () => {
    seen.length = 0;
    expect((await run("claim", "150-rakun")).code).toBe(0);
    expect((await run("release", "150")).code).toBe(0);
    expect((await run("assign", "163-meta-ci", "--to", "machine-2")).code).toBe(0);
    expect(seen.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /api/session", "POST /api/write/front.claim", "POST /api/write/front.release", "POST /api/write/front.assign"]);
    expect(seen.slice(1).map((r) => [r.body, r.session])).toEqual([
      [{ front: "150-rakun", apply: false, landed: [] }, "s1"],
      [{ front: "150", apply: false, landed: [] }, "s1"],
      [{ front: "163-meta-ci", to: "machine-2", apply: false, landed: [] }, "s1"],
    ]);
  });

  test("doing posts the line (and the front) with the session; done deletes it; both print the party and the line only", async () => {
    seen.length = 0;
    const set = await run("doing", "porting", "the", "gate", "--front", "150");
    expect(set.code).toBe(0);
    expect(set.out.trim()).toBe("party: machine-1\ndoing: porting the gate\nfront: 150-rakun");
    const done = await run("done");
    expect(done.code).toBe(0);
    expect(done.out.trim()).toBe("party: machine-1\ndoing: null");
    expect(seen.map((r) => [`${r.method} ${r.path}`, r.body, r.session])).toEqual([
      ["POST /api/doing", { text: "porting the gate", front: "150" }, "s1"],
      ["DELETE /api/doing", null, "s1"],
    ]);
  });
});
