import { loadSiteData, createSite } from "@specs-bot/site";
import { Hono } from "hono";
import { identify, type Vars } from "./auth.ts";
import type { ServerConfig } from "./config.ts";
import { dataState } from "./data.ts";
import { readRoutes } from "./routes.ts";

export const VERSION = "0.0.1";

export interface AppOptions {
  /** Build the search index right after startup instead of on the first search (about a second on real data). */
  warm?: boolean;
}

export function createApp(config: ServerConfig, opts: AppOptions = {}) {
  const app = new Hono();
  const api = new Hono<{ Variables: Vars }>();
  // One read model for the api and the site, loaded once (PLAN.md § 2).
  const loaded = loadSiteData(config.dataPath);

  api.use("*", identify(config.tokens));

  // Never reveals the data path: the abstraction hides where the specs live (PLAN.md § 3).
  api.get("/health", async (c) => {
    const data = await dataState(config.dataPath);
    return c.json({ service: "specs-bot", version: VERSION, data }, data.ok ? 200 : 503);
  });

  if (loaded.ok) {
    api.route("/", readRoutes(loaded.data));
    if (opts.warm) setTimeout(() => void loaded.data.index, 0);
  }
  else api.all("*", (c) => c.json({ error: "the specs could not be read", hint: "see the server's log" }, 503));

  app.route("/api", api);
  app.notFound((c) => c.json({ error: "not found", path: c.req.path }, 404));

  // The read-only site: "/" and its pages; its overview shows the data status.
  app.route("/", createSite({ dataPath: config.dataPath, status: () => dataState(config.dataPath), version: VERSION, loaded }));
  return app;
}
