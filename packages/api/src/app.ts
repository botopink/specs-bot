import { Hono } from "hono";
import type { ServerConfig } from "./config.ts";
import { dataState, type DataState } from "./data.ts";

export const VERSION = "0.0.1";

export function createApp(config: ServerConfig) {
  const app = new Hono();
  const api = new Hono();

  // Never reveals the data path: the abstraction hides where the specs live (PLAN.md § 3).
  api.get("/health", async (c) => {
    const data = await dataState(config.dataPath);
    return c.json({ service: "specs-bot", version: VERSION, data }, data.ok ? 200 : 503);
  });

  app.route("/api", api);

  // A status page until the site lands (phase 5).
  app.get("/", async (c) => c.html(statusPage(await dataState(config.dataPath))));

  app.notFound((c) => c.json({ error: "not found", path: c.req.path }, 404));
  return app;
}

function statusPage(data: DataState): string {
  const state = data.ok
    ? `<span class="ok">online</span> · data <code>${data.branch}</code> @ <code>${data.head}</code>`
    : `<span class="bad">data unavailable</span> · ${escapeHtml(data.error ?? "")}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>specs-bot</title>
<style>
  :root { color-scheme: light dark; --fg: #1d1d1f; --bg: #fafafa; --muted: #6e6e73; --ok: #1a7f37; --bad: #c62828; }
  @media (prefers-color-scheme: dark) { :root { --fg: #e8e8ea; --bg: #141416; --muted: #9a9aa0; --ok: #4ac26b; --bad: #ff6b6b; } }
  body { margin: 0; padding: 48px 16px; font: 16px/1.5 system-ui, sans-serif; color: var(--fg); background: var(--bg); }
  main { max-width: 640px; margin: 0 auto; }
  h1 { margin: 0 0 4px; font-size: 28px; }
  p { margin: 8px 0; } .muted { color: var(--muted); } .ok { color: var(--ok); font-weight: 600; } .bad { color: var(--bad); font-weight: 600; }
  a { color: inherit; }
</style></head>
<body><main>
  <h1>specs-bot</h1>
  <p class="muted">The single door to the botopink specs · v${VERSION}</p>
  <p>${state}</p>
  <p class="muted">API: <a href="/api/health">/api/health</a>. Agents use the <code>specs-bot</code> CLI.</p>
</main></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}
