// A thin HTTP client: one GET per command, the api's errors passed through with their hint.
import type { ClientConfig } from "./config.ts";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly hint?: string,
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
  let res: Response;
  try {
    res = await fetch(url, {
      headers: config.token ? { authorization: `Bearer ${config.token}` } : {},
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (e) {
    const why = (e as Error).name === "TimeoutError" ? `no answer in ${config.timeoutMs} ms` : (e as Error).message;
    throw new ApiError(`the specs-bot api at ${config.api} is unreachable: ${why}`, 0, "is the host up? `specs-bot whoami` checks the connection");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; hint?: string };
  if (!res.ok) throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status, body.hint);
  return body;
}
