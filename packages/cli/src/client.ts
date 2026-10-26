// A thin HTTP client: one GET per command, the api's errors passed through with their hint.
import type { ClientConfig } from "./config.ts";
import { forgetSession, savedSession, saveSession, sessionLabel } from "./session.ts";

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

function urlOf(config: ClientConfig, path: string, query: Query = {}): URL {
  const url = new URL(`${config.api}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === false) continue;
    url.searchParams.set(k, v === true ? "1" : String(v));
  }
  return url;
}

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

export async function get(config: ClientConfig, path: string, query: Query = {}): Promise<unknown> {
  return send(config, urlOf(config, path, query), { method: "GET" });
}

export async function post(config: ClientConfig, path: string, body: unknown): Promise<unknown> {
  return send(config, urlOf(config, path), json(body));
}

export async function del(config: ClientConfig, path: string): Promise<unknown> {
  return send(config, urlOf(config, path), { method: "DELETE" });
}

/**
 * One GET (no body) or POST (a body) with the session id the caller holds — the MCP server's, bound to its
 * websocket — instead of this folder's session file; none means a reader (or the old token, when set).
 */
export async function request(config: ClientConfig, session: string | undefined, path: string, opts: { query?: Query; body?: unknown; method?: "DELETE" } = {}): Promise<unknown> {
  const url = urlOf(config, path, opts.query);
  return raw(config, url, opts.method ? { method: opts.method } : opts.body === undefined ? { method: "GET" } : json(opts.body), session);
}

/** Takes `party` for this folder's session (letting go of the one it held) and keeps the id. */
export async function takeParty(config: ClientConfig, party: string): Promise<{ session: string; party: string; since: string }> {
  const held = savedSession(config);
  const url = new URL(`${config.api}/session`);
  const r = (await raw(config, url, json({ party, label: sessionLabel(config) }), held?.session)) as {
    session: string;
    party: string;
    since: string;
  };
  saveSession(config, { api: config.api, party: r.party, session: r.session, since: r.since });
  return r;
}

/**
 * The session id a request goes with: the folder's when it holds one. Only a write takes SPECS_BOT_AS's party
 * for a folder that holds none — a read never does, so `specs-bot logout` stays done until the next write.
 */
async function sessionFor(config: ClientConfig, take: boolean): Promise<string | undefined> {
  const held = savedSession(config);
  if (held && config.as && held.party !== config.as) {
    throw new ApiError(`this folder's session holds ${held.party}, and SPECS_BOT_AS / --as names ${config.as}`, 0, `one identity at a time: specs-bot logout, then specs-bot as ${config.as}`);
  }
  if (held) return held.session;
  if (!config.as || !take) return undefined;
  try {
    return (await takeParty(config, config.as)).session;
  } catch (e) {
    // Two commands of one folder taking its party at the same moment: the other one won and kept the id.
    const now = e instanceof ApiError && e.status === 409 ? savedSession(config) : undefined;
    if (now?.party === config.as) return now.session;
    throw e;
  }
}

/** The headers that say who is asking: the folder's session, else an old token (the websocket uses them too). */
export async function whoHeaders(config: ClientConfig): Promise<Record<string, string>> {
  const session = await sessionFor(config, false);
  return session ? { "x-specs-bot-session": session } : config.token ? { authorization: `Bearer ${config.token}` } : {};
}

/** Lets go of this folder's party. */
export async function releaseParty(config: ClientConfig): Promise<boolean> {
  const held = savedSession(config);
  if (!held) return false;
  const url = new URL(`${config.api}/session`);
  await raw(config, url, { method: "DELETE" }, held.session).catch(() => undefined);
  forgetSession(config);
  return true;
}

async function send(config: ClientConfig, url: URL, init: RequestInit): Promise<unknown> {
  const session = await sessionFor(config, init.method !== "GET");
  try {
    return await raw(config, url, init, session);
  } catch (e) {
    // The api forgot the session (a restart, 30 min of silence): take the party again, once.
    if (!(e instanceof ApiError && e.status === 401 && e.message === "unknown session")) throw e;
    const party = config.as ?? savedSession(config)?.party;
    forgetSession(config);
    // A read goes on without a party; a write takes it again.
    if (init.method === "GET") return raw(config, url, init, undefined);
    if (!party) throw e;
    return raw(config, url, init, (await takeParty(config, party)).session);
  }
}

async function raw(config: ClientConfig, url: URL, init: RequestInit, session: string | undefined): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), ...(session ? { "x-specs-bot-session": session } : config.token ? { authorization: `Bearer ${config.token}` } : {}) },
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
