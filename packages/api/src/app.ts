import { Hono } from "hono";
import { createSite } from "@specs-bot/site";
import type { ServerConfig } from "./config.ts";
import { dataState } from "./data.ts";

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

  // The read-only site (phase 5): "/" and its pages; its overview shows the data status.
  app.route("/", createSite({ dataPath: config.dataPath, status: () => dataState(config.dataPath), version: VERSION }));

  app.notFound((c) => c.json({ error: "not found", path: c.req.path }, 404));
  return app;
}
