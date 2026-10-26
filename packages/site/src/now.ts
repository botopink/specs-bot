// What each party is doing now (PLAN.md § 5.8): the shape of the api's `GET /api/now`, which the site's /now page
// and the overview's strip render. The api builds it (now.ts in the api) and hands the site a function for it.

export interface NowSession {
  /** Who holds the party, as the session says ("host · ~/projects"). */
  label: string;
  since: string;
  /** Held by an open websocket (the MCP server), not by the CLI's 30-minute lease. */
  bound: boolean;
}

export interface NowDoing {
  text: string;
  /** The current front it is about (its folder, "150-rakun"), when it named one. */
  front: string | null;
  since: string;
}

export interface NowWrite {
  op: string;
  summary: string;
  refs: string[];
  commit: string;
  at: string;
}

export interface NowChat {
  id: string;
  from: string;
  to: string;
  subject: string;
  at: string;
}

export interface NowParty {
  party: string;
  /** A session holds the party. */
  online: boolean;
  session: NowSession | null;
  doing: NowDoing | null;
  /** The current milestone's fronts it owns. */
  fronts: string[];
  /** Its last writes, newest first. */
  recent: NowWrite[];
  /** The last messages from or to it (or to all), newest first. */
  chat: NowChat[];
}

export interface NowData {
  at: string;
  parties: NowParty[];
}

export type NowFn = () => NowData;

/** "just now", "5 min ago", "3 h ago", "2 d ago"; the page's script says the same in the browser as time passes. */
export function relTime(at: string, now = Date.now()): string {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return at;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
