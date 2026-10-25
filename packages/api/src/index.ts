// The HTTP API — the only process that opens specs-data (PLAN.md § 3).
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const app = createApp(config, { warm: true });

Bun.serve({ hostname: config.host, port: config.port, fetch: app.fetch });
console.log(`specs-bot api on http://${config.host}:${config.port}/api (${config.tokens.size} tokens)`);
