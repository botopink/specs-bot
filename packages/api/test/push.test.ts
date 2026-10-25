import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pusher } from "../src/push.ts";

async function git(cwd: string, ...args: string[]) {
  const p = Bun.spawn(["git", "-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  if ((await p.exited) !== 0) throw new Error(await new Response(p.stderr).text());
  return out.trim();
}

test("pushes the branch to the remote; a failure is kept with the commits waiting", async () => {
  const remote = mkdtempSync(join(tmpdir(), "specs-bot-remote-"));
  const data = mkdtempSync(join(tmpdir(), "specs-bot-data-"));
  await git(remote, "init", "-q", "--bare", "-b", "main");
  await git(data, "init", "-q", "-b", "main");
  writeFileSync(join(data, "a.md"), "a\n");
  await git(data, "add", ".");
  await git(data, "commit", "-qm", "a");
  await git(data, "remote", "add", "origin", remote);

  const pusher = new Pusher(data, { enabled: true });
  await Promise.all([pusher.request(), pusher.request()]);
  expect(await git(remote, "rev-parse", "main")).toBe(await git(data, "rev-parse", "HEAD"));
  expect(pusher.state).toMatchObject({ enabled: true, ahead: 0 });

  await git(data, "remote", "set-url", "origin", join(remote, "nope"));
  writeFileSync(join(data, "b.md"), "b\n");
  await git(data, "add", ".");
  await git(data, "commit", "-qm", "b");
  await pusher.request();
  expect(pusher.state.lastError).toContain("git push");
});

test("disabled, nothing runs", async () => {
  const p = new Pusher("/nowhere", { enabled: false });
  await p.request();
  expect(p.state).toEqual({ enabled: false, ahead: -1 });
});
