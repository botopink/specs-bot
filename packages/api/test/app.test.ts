import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";

const config = (dataPath: string) => ({ host: "127.0.0.1", port: 0, dataPath, tokens: new Map() });

test("health is 503 when the data path holds no specs", async () => {
  const res = await createApp(config(mkdtempSync(join(tmpdir(), "specs-bot-")))).request("/api/health");
  expect(res.status).toBe(503);
  const body = (await res.json()) as { data: { ok: boolean; error: string } };
  expect(body.data.ok).toBe(false);
  expect(JSON.stringify(body)).not.toContain(tmpdir());
});

test("unknown routes answer 404 in JSON", async () => {
  const res = await createApp(config("/nowhere")).request("/api/nope");
  expect(res.status).toBe(404);
});

test("the root serves the status page", async () => {
  const res = await createApp(config("/nowhere")).request("/");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(await res.text()).toContain("data unavailable");
});
