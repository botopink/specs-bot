// The client's configuration (PLAN.md § 2.1): the projects repository's `.env` (SPECS_BOT_API_URL, versioned) and
// `.env.local` (the tokens, never committed), read from the working directory up to / — a nearer file overrides a
// farther one, so a task worktree inside the checkout (.tasks/meta-m1) reads the checkout's tokens and can add its
// own. The process environment overrides the files.
//
// The party a folder acts as is SPECS_BOT_AS (its .env.local, the environment) or --as: the api gives the folder a
// session holding that party, one session per party (session.ts). No token is needed; an old SPECS_BOT_TOKEN
// (or SPECS_BOT_TOKEN_<PARTY>) is still sent when set.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ClientConfig {
  api: string;
  token?: string;
  /** The party this folder acts as (SPECS_BOT_AS / --as), when one is named. */
  as?: string;
  /** The project folder: the nearest with a .env naming the api (a session is kept per folder). */
  root: string;
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
  return dotenvDirs(start).find((d) => existsSync(join(d, ".env")) && "SPECS_BOT_API_URL" in parseDotenv(readFileSync(join(d, ".env"), "utf8")));
}

/** Every directory from `start` up to / that holds a .env or a .env.local, nearest first. */
function dotenvDirs(start: string): string[] {
  const out: string[] = [];
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".env")) || existsSync(join(dir, ".env.local"))) out.push(dir);
    if (dirname(dir) === dir) return out;
  }
}

/** "machine-1" → SPECS_BOT_TOKEN_MACHINE_1. */
export function tokenVar(party: string): string {
  return `SPECS_BOT_TOKEN_${party.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

export function loadClientConfig(cwd: string, env: Record<string, string | undefined> = process.env, asFlag?: string): ClientConfig {
  const root = findProjectRoot(cwd);
  const file: Record<string, string> = {};
  for (const dir of dotenvDirs(cwd).reverse()) {
    for (const name of [".env", ".env.local"]) {
      const f = join(dir, name);
      if (existsSync(f)) Object.assign(file, parseDotenv(readFileSync(f, "utf8")));
    }
  }
  const pick = (k: string) => env[k] ?? file[k];
  const api = pick("SPECS_BOT_API_URL");
  if (!api) {
    throw new Error(
      "SPECS_BOT_API_URL is not set: no .env with it from here up to /. It lives in the projects repository's .env (SPECS_BOT_API_URL=http://192.168.1.15:7165/api).",
    );
  }
  const as = asFlag ?? pick("SPECS_BOT_AS");
  // The party is declared (SPECS_BOT_AS / --as) and the api takes it as said; a token is optional — the party's own
  // (SPECS_BOT_TOKEN_<PARTY>) when one is set, never another party's.
  const token = as ? pick(tokenVar(as)) : pick("SPECS_BOT_TOKEN");
  const timeout = Number(pick("SPECS_BOT_TIMEOUT_MS") ?? 10000);
  return {
    api: api.replace(/\/+$/, ""),
    ...(token ? { token } : {}),
    ...(as ? { as } : {}),
    root: root ?? cwd,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 10000,
    // Bun loads the working directory's .env into the environment by itself, so a value equal to the file's
    // came from the file.
    source: env.SPECS_BOT_API_URL && env.SPECS_BOT_API_URL !== file.SPECS_BOT_API_URL ? "environment" : join(root ?? cwd, ".env"),
  };
}
