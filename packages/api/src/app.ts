import { type Model, Writer } from "@specs-bot/core";
import { createSite, loadSiteData } from "@specs-bot/site";
import { Hono } from "hono";
import { identify, mountSessions, Sessions, type Vars } from "./sessions.ts";
import type { ServerConfig } from "./config.ts";
import { dataState } from "./data.ts";
import { EventBus } from "./events.ts";
import { Pusher } from "./push.ts";
import { readRoutes } from "./routes.ts";
import { writeRoutes } from "./write-routes.ts";
import { mountRealtime } from "./ws.ts";

export const VERSION = "0.0.1";

export interface AppOptions {
  /** Build the search index right after startup instead of on the first search (about a second on real data). */
  warm?: boolean;
  /** Where writes publish their events; the websocket relays them. One is made when absent. */
  bus?: EventBus;
  /** Which session holds which party. One is made when absent. */
  sessions?: Sessions;
}

export function createApp(config: ServerConfig, opts: AppOptions = {}) {
  const bus = opts.bus ?? new EventBus();
  const sessions = opts.sessions ?? new Sessions();
  const app = new Hono();
  // Real-time events between the machines (/api/ws, /api/presence); before the api's routes (PLAN.md § 5.6).
  mountRealtime(app, sessions, config.tokens, bus);
  const api = new Hono<{ Variables: Vars }>();
  // One read model for the api and the site, loaded once (PLAN.md § 2).
  const loaded = loadSiteData(config.dataPath);

  api.use("*", identify(sessions, config.tokens));
  mountSessions(api, sessions);
  const pusher = new Pusher(config.dataPath, config.push ?? { enabled: false });

  // Never reveals the data path: the abstraction hides where the specs live (PLAN.md § 3).
  api.get("/health", async (c) => {
    const data = await dataState(config.dataPath);
    return c.json({ service: "specs-bot", version: VERSION, data, push: pusher.state }, data.ok ? 200 : 503);
  });

  // The model in force; a write swaps it for the one over the data it left, and the site is rebuilt over it.
  let model: Model | undefined = loaded.ok ? loaded.data : undefined;
  const site = () => createSite({ dataPath: config.dataPath, status: () => dataState(config.dataPath), version: VERSION, loaded: model ? { ok: true, data: model } : loaded });
  let currentSite = site();

  if (model) {
    api.route("/", readRoutes(() => model!));
    api.route(
      "/",
      writeRoutes({
        model: () => model!,
        swap: (next) => {
          model = next;
          currentSite = site();
          setTimeout(() => void next.index, 0);
          void pusher.request();
        },
        writer: new Writer(config.dataPath),
        bus,
      }),
    );
    if (opts.warm) setTimeout(() => void model!.index, 0);
  } else api.all("*", (c) => c.json({ error: "the specs could not be read", hint: "see the server's log" }, 503));

  app.route("/api", api);
  app.notFound((c) => c.json({ error: "not found", path: c.req.path }, 404));

  // The read-only site: "/" and its pages, always the one built over the model in force.
  app.all("*", (c) => currentSite.fetch(c.req.raw));
  return Object.assign(app, { bus, pusher });
}
