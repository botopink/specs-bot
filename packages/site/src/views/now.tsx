// The /now page and the overview's strip (PLAN.md § 5.8): one card per party — online, where, what it is doing, its
// fronts, its last writes and messages — rendered here from the api's /api/now. The page's script listens on the
// api's websocket and, on any event, fetches the cards again (as HTML from /now/cards, rendered by these same
// components) without reloading; relative times tick in the browser.
import type { SiteData } from "../data.ts";
import { type NowData, type NowParty, type NowTask, relTime } from "../now.ts";
import { Layout } from "./layout.tsx";

/** Where a ref of a write goes on the site: a document (with its section), a step, a question, a front. */
export function refHref(ref: string, data: SiteData | undefined): string | undefined {
  const step = ref.match(/^step (\d+)$/);
  if (step) return `/steps/${step[1]}`;
  const pending = ref.match(/^pending (\S+)$/);
  if (pending) return `/pending/${encodeURIComponent(pending[1]!)}`;
  if (!data) return undefined;
  const [base = "", anchor] = ref.split("#");
  if (data.docByRef.has(base)) return `/docs/${base}${anchor ? `#${anchor}` : ""}`;
  const front = data.fronts.find((f) => f.ref === base && f.version === data.tree.current);
  if (front) return `/fronts#${front.ref.split("/").pop()}`;
  return undefined;
}

function Ago(props: { at: string; now: number }) {
  return (
    <time datetime={props.at} data-rel="" title={props.at}>
      {relTime(props.at, props.now)}
    </time>
  );
}

function Dot(props: { online: boolean }) {
  return <span class={`dot ${props.online ? "on" : "off"}`} role="img" aria-label={props.online ? "online" : "offline"} />;
}

function frontLink(front: string) {
  return `/fronts#${front.split("/").pop()}`;
}

function PartyCard(props: { p: NowParty; data: SiteData | undefined; now: number }) {
  const { p, data, now } = props;
  const readme = p.doing?.front && data?.docByRef.has(`${p.doing.front}/README`) ? `/docs/${p.doing.front}/README` : undefined;
  return (
    <article class={`now-card ${p.online ? "is-on" : "is-off"}`} id={`now-${p.party}`} data-party={p.party}>
      <header>
        <Dot online={p.online} />
        <h2 translate="no">{p.party}</h2>
        <span class="now-state">
          {p.online && p.session ? (
            <>
              online since <Ago at={p.session.since} now={now} />
            </>
          ) : (
            "offline"
          )}
        </span>
      </header>
      {p.session ? (
        <p class="now-where" translate="no" title={p.session.bound ? "an MCP session (held while connected)" : "a CLI session (held for 30 min of silence)"}>
          {p.session.label || "(no label)"} · {p.session.bound ? "mcp" : "cli"}
        </p>
      ) : null}
      {p.doing ? (
        <p class="now-doing">
          <span class="now-text">{p.doing.text}</span>
          <span class="now-doing-meta">
            {p.doing.front ? (
              <>
                <a class="chip" href={frontLink(p.doing.front)} translate="no">
                  {p.doing.front}
                </a>
                {readme ? (
                  <a class="now-doc" href={readme}>
                    doc
                  </a>
                ) : null}
              </>
            ) : null}
            <Ago at={p.doing.since} now={now} />
          </span>
        </p>
      ) : (
        <p class="now-doing idle">{p.online ? "Says nothing about what it is doing." : "—"}</p>
      )}
      {p.fronts.length ? (
        <ul class="chips now-fronts" aria-label="Fronts it owns">
          {p.fronts.map((f) => (
            <li>
              <a class="chip" href={frontLink(f)} translate="no">
                {f}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {p.recent.length ? (
        <section class="now-sub">
          <h3>Last writes</h3>
          <ul class="now-list">
            {p.recent.map((w) => (
              <li>
                <code>{w.op}</code> <span class="now-sum">{w.summary}</span>
                {w.refs.length ? (
                  <span class="now-refs" translate="no">
                    {w.refs.map((r) => {
                      const href = refHref(r, data);
                      return href ? <a href={href}>{r}</a> : <span>{r}</span>;
                    })}
                  </span>
                ) : null}
                <Ago at={w.at} now={now} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {p.chat.length ? (
        <section class="now-sub">
          <h3>Chat</h3>
          <ul class="now-list">
            {p.chat.map((m) => (
              <li>
                <span class="now-who" translate="no">
                  {m.from} → {m.to}
                </span>{" "}
                <span class="now-sum">{m.subject}</span> <Ago at={m.at} now={now} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

/** "45 min", "2 h 10 min": how long a task ran. */
export function took(since: string, until: string): string {
  const m = Math.max(0, Math.round((Date.parse(until) - Date.parse(since)) / 60_000));
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}

const COLUMNS: { state: NowTask["state"]; title: string; empty: string }[] = [
  { state: "running", title: "Running", empty: "Nobody says they are on something." },
  { state: "paused", title: "Paused", empty: "Nothing paused." },
  { state: "done", title: "Done — last 24 h", empty: "Nothing done in the last 24 h." },
];

function TaskItem(props: { t: NowTask; now: number }) {
  const { t, now } = props;
  return (
    <li class={`now-task is-${t.state}`}>
      <span class="now-task-text">{t.text}</span>
      <span class="now-doing-meta">
        <a class="now-task-party" href={`#now-${t.party}`} translate="no">
          {t.party}
        </a>
        {t.front ? (
          <a class="chip" href={frontLink(t.front)} translate="no">
            {t.front}
          </a>
        ) : null}
        {t.state === "running" ? (
          <span>
            since <Ago at={t.since} now={now} />
          </span>
        ) : (
          <span>
            {t.state === "done" ? "done" : "paused"} <Ago at={t.at} now={now} /> · took {took(t.since, t.at)}
          </span>
        )}
      </span>
    </li>
  );
}

/** The tasks by state: what is running, what is paused, what was done in the last 24 h. */
export function NowBoard(props: { now: NowData }) {
  const at = Date.parse(props.now.at) || Date.now();
  return (
    <section class="now-board" aria-label="Tasks">
      {COLUMNS.map((c) => {
        const tasks = props.now.tasks.filter((t) => t.state === c.state);
        return (
          <section class={`now-col is-${c.state}`} id={`now-${c.state}`}>
            <h2>
              {c.title} <span class="count">{tasks.length}</span>
            </h2>
            {tasks.length ? (
              <ul class="now-tasks">
                {tasks.map((t) => (
                  <TaskItem t={t} now={at} />
                ))}
              </ul>
            ) : (
              <p class="muted">{c.empty}</p>
            )}
          </section>
        );
      })}
    </section>
  );
}

/** The board and the cards: the page's body, and what /now/cards answers to the page's script. */
export function NowCards(props: { now: NowData; data: SiteData | undefined }) {
  const at = Date.parse(props.now.at) || Date.now();
  return (
    <>
      <NowBoard now={props.now} />
      <h2 class="now-parties-title">Who</h2>
      <div class="now-grid">
        {props.now.parties.map((p) => (
          <PartyCard p={p} data={props.data} now={at} />
        ))}
      </div>
    </>
  );
}

/** One line per party, for the overview: what /now/strip answers. */
export function NowStrip(props: { now: NowData }) {
  return (
    <>
      {props.now.parties.map((p) => (
        <li>
          <a href={`/now#now-${p.party}`}>
            <Dot online={p.online} />
            <span class="strip-party" translate="no">
              {p.party}
            </span>
            <span class="strip-doing">{p.doing ? p.doing.text : p.online ? "online" : "offline"}</span>
          </a>
        </li>
      ))}
    </>
  );
}

/** The overview's block: the strip, live like the page. */
export function NowSummary(props: { now: NowData }) {
  return (
    <section class="now-strip-wrap">
      <h2>
        <a href="/now">Now</a> <LiveBadge />
      </h2>
      <ul class="now-strip" data-now="/now/strip">
        <NowStrip now={props.now} />
      </ul>
      <script dangerouslySetInnerHTML={{ __html: NOW_SCRIPT }} />
    </section>
  );
}

function LiveBadge() {
  return (
    <span class="live" data-live="connecting" aria-live="polite">
      <span class="live-dot" />
      <span class="live-text">connecting</span>
    </span>
  );
}

export function NowPage(props: { now: NowData | undefined; data: SiteData | undefined; path: string }) {
  return (
    <Layout title="Now" path={props.path}>
      <div class="now-head">
        <h1>Now</h1>
        {props.now ? <LiveBadge /> : null}
      </div>
      <p class="muted">What each machine and the maintainer are on, as they say it (`doing` / `done` / `done --paused`): running, paused, and done in the last 24 h; then each one with its last writes and messages.</p>
      {props.now ? (
        <>
          <div id="now-cards" data-now="/now/cards">
            <NowCards now={props.now} data={props.data} />
          </div>
          <script dangerouslySetInnerHTML={{ __html: NOW_SCRIPT }} />
        </>
      ) : (
        <p class="bad">The live status is not available here.</p>
      )}
    </Layout>
  );
}

/**
 * The page's live part: a reader on the api's websocket (no party); on a write, chat, presence, doing or session
 * event it fetches every `[data-now]` block again from its URL (debounced), and on every reconnect too, since
 * events may have been missed. Relative times tick every 15 s. Reconnects with a growing wait, 1 s to 30 s.
 */
export const NOW_SCRIPT = `(function () {
  if (window.specsBotNow) return;
  window.specsBotNow = true;
  var blocks = document.querySelectorAll("[data-now]");
  if (!blocks.length) return;
  var TYPES = ["write", "chat", "presence", "doing", "session"];
  function rel(at) {
    var t = Date.parse(at);
    if (isNaN(t)) return at;
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 45) return "just now";
    var m = Math.round(s / 60);
    if (m < 60) return m + " min ago";
    var h = Math.round(m / 60);
    if (h < 48) return h + " h ago";
    return Math.round(h / 24) + " d ago";
  }
  function tick() {
    var ts = document.querySelectorAll("time[data-rel]");
    for (var i = 0; i < ts.length; i++) ts[i].textContent = rel(ts[i].getAttribute("datetime"));
  }
  function state(s) {
    var ls = document.querySelectorAll(".live");
    for (var i = 0; i < ls.length; i++) {
      ls[i].setAttribute("data-live", s);
      var t = ls[i].querySelector(".live-text");
      if (t) t.textContent = s;
    }
  }
  function load(el) {
    fetch(el.getAttribute("data-now"), { headers: { accept: "text/html" }, cache: "no-store" })
      .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
      .then(function (html) { el.innerHTML = html; tick(); })
      .catch(function () {});
  }
  var pending;
  function refresh() {
    clearTimeout(pending);
    pending = setTimeout(function () { for (var i = 0; i < blocks.length; i++) load(blocks[i]); }, 250);
  }
  var backoff = 1000, first = true;
  function connect() {
    var ws;
    try {
      ws = new WebSocket((location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "/api/ws?types=" + TYPES.join(","));
    } catch (e) { later(); return; }
    ws.onopen = function () {
      backoff = 1000;
      state("live");
      if (!first) refresh();
      first = false;
    };
    ws.onmessage = function (e) {
      var m;
      try { m = JSON.parse(e.data); } catch (x) { return; }
      if (TYPES.indexOf(m.type) >= 0) refresh();
    };
    ws.onclose = function () { state("reconnecting"); later(); };
  }
  function later() {
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30000);
  }
  setInterval(tick, 15000);
  tick();
  connect();
})();`;
