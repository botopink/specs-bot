// Server configuration, read from specs-bot/.env on the host (PLAN.md § 2.1). Never from the projects repository.

export interface ServerConfig {
  host: string;
  port: number;
  dataPath: string;
  /** token → machine name ("machine-1", "maintainer", …) */
  tokens: Map<string, string>;
  /** Push specs-data after every write (SPECS_DATA_PUSH=1), with this key (SPECS_DATA_PUSH_KEY). */
  push?: { enabled: boolean; sshKey?: string };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const missing = ["SPECS_BOT_HOST", "SPECS_BOT_PORT", "SPECS_DATA_PATH"].filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(`missing ${missing.join(", ")} in specs-bot/.env`);
  }
  const port = Number(env.SPECS_BOT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`SPECS_BOT_PORT is not a port: ${env.SPECS_BOT_PORT}`);
  }
  return {
    host: env.SPECS_BOT_HOST!,
    port,
    dataPath: env.SPECS_DATA_PATH!,
    tokens: parseTokens(env.SPECS_BOT_TOKENS ?? ""),
    push: { enabled: env.SPECS_DATA_PUSH === "1", ...(env.SPECS_DATA_PUSH_KEY ? { sshKey: env.SPECS_DATA_PUSH_KEY } : {}) },
  };
}

/** "machine-1=abc,machine-2=def" → Map { abc → machine-1, def → machine-2 } */
export function parseTokens(raw: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const pair of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const eq = pair.indexOf("=");
    const machine = pair.slice(0, eq).trim();
    const token = pair.slice(eq + 1).trim();
    if (eq <= 0 || !token) throw new Error(`SPECS_BOT_TOKENS entry is not machine=token: ${pair}`);
    if (tokens.has(token)) throw new Error(`SPECS_BOT_TOKENS repeats a token (${machine})`);
    tokens.set(token, machine);
  }
  return tokens;
}
