// A thin HTTP client: one GET per command, the api's errors passed through with their hint.
import type { ClientConfig } from "./config.ts";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly hint?: string,
    /** The api's whole answer (a conflict's current etag, a rule's findings). */
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export type Query = Record<string, string | number | boolean | undefined>;

export async function get(config: ClientConfig, path: string, query: Query = {}): Promise<unknown> {
  const url = new URL(`${config.api}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === false) continue;
    url.searchParams.set(k, v === true ? "1" : String(v));
  }
  return send(config, url, { method: "GET" });
}

export async function post(config: ClientConfig, path: string, body: unknown): Promise<unknown> {
  const url = new URL(`${config.api}/${path.replace(/^\//, "")}`);
  return send(config, url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

async function send(config: ClientConfig, url: URL, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), ...(config.token ? { authorization: `Bearer ${config.token}` } : {}) },
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (e) {
    const why = (e as Error).name === "TimeoutError" ? `no answer in ${config.timeoutMs} ms` : (e as Error).message;
    throw new ApiError(`the specs-bot api at ${config.api} is unreachable: ${why}`, 0, "is the host up? `specs-bot whoami` checks the connection");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; hint?: string };
  if (!res.ok) throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status, body.hint, body);
  return body;
}
