// The client's configuration (PLAN.md § 2.1): the projects repository's `.env` (SPECS_BOT_API_URL, versioned) and
// `.env.local` (SPECS_BOT_TOKEN, one per machine), found by walking up from the working directory.
// The process environment overrides both; `.env.local` overrides `.env`.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ClientConfig {
  api: string;
  token?: string;
  timeoutMs: number;
  /** Where the settings came from, for `specs-bot config`. */
  source: string;
}

export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2]!;
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]!] = v;
  }
  return out;
}

/** The nearest directory, from `start` up, whose `.env` sets SPECS_BOT_API_URL. */
export function findProjectRoot(start: string): string | undefined {
  let dir = start;
  for (;;) {
    const env = join(dir, ".env");
    if (existsSync(env) && "SPECS_BOT_API_URL" in parseDotenv(readFileSync(env, "utf8"))) return dir;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

export function loadClientConfig(cwd: string, env: Record<string, string | undefined> = process.env): ClientConfig {
  const root = findProjectRoot(cwd);
  const file: Record<string, string> = {};
  if (root) {
    Object.assign(file, parseDotenv(readFileSync(join(root, ".env"), "utf8")));
    const local = join(root, ".env.local");
    if (existsSync(local)) Object.assign(file, parseDotenv(readFileSync(local, "utf8")));
  }
  const pick = (k: string) => env[k] ?? file[k];
  const api = pick("SPECS_BOT_API_URL");
  if (!api) {
    throw new Error(
      "SPECS_BOT_API_URL is not set: no .env with it from here up to /. It lives in the projects repository's .env (SPECS_BOT_API_URL=http://192.168.1.15:7165/api).",
    );
  }
  const token = pick("SPECS_BOT_TOKEN");
  const timeout = Number(pick("SPECS_BOT_TIMEOUT_MS") ?? 10000);
  return {
    api: api.replace(/\/+$/, ""),
    ...(token ? { token } : {}),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 10000,
    source: env.SPECS_BOT_API_URL ? "environment" : join(root!, ".env"),
  };
}
