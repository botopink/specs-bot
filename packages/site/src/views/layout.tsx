import type { Child } from "hono/jsx";
import type { StepStatus } from "@specs-bot/core";

const NAV: [string, string][] = [
  ["/", "Overview"],
  ["/fronts", "Fronts"],
  ["/steps", "Steps"],
  ["/pending", "Pending"],
  ["/review", "Review"],
  ["/subjects", "Subjects"],
  ["/retired", "Retired"],
];

/**
 * EN | PT. PT sets Google's `googtrans` cookie and loads its website translator (English → Portuguese only); the
 * choice is remembered in localStorage. EN clears the cookie and reloads the page as written. When the script
 * cannot load (offline, blocked) PT is shown unavailable and the page stays in English.
 */
export const LANG_SCRIPT = `(function () {
  var KEY = "specs-bot-lang";
  var group = document.querySelector(".lang");
  if (!group) return;
  var en = group.querySelector('[data-lang="en"]');
  var pt = group.querySelector('[data-lang="pt"]');
  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function store(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function cookie(on) {
    var value = on ? "/en/pt" : "";
    var tail = on ? "" : "; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    try {
      document.cookie = "googtrans=" + value + "; path=/" + tail;
      document.cookie = "googtrans=" + value + "; path=/; domain=" + location.hostname + tail;
    } catch (e) {}
  }
  function show(lang) {
    document.documentElement.setAttribute("data-lang", lang);
    en.setAttribute("aria-pressed", String(lang === "en"));
    pt.setAttribute("aria-pressed", String(lang === "pt"));
  }
  function unavailable() {
    pt.disabled = true;
    pt.title = "Google Translate could not load (offline or blocked): the page stays in English";
    show("en");
  }
  var loading = false;
  function load() {
    if (loading) return;
    loading = true;
    window.specsBotTranslate = function () {
      try {
        new google.translate.TranslateElement({ pageLanguage: "en", includedLanguages: "pt", autoDisplay: false }, "gt-el");
      } catch (e) { unavailable(); }
    };
    var s = document.createElement("script");
    s.src = "https://translate.google.com/translate_a/element.js?cb=specsBotTranslate";
    s.async = true;
    s.onerror = unavailable;
    document.head.appendChild(s);
    setTimeout(function () { if (!(window.google && google.translate)) unavailable(); }, 8000);
  }
  en.addEventListener("click", function () {
    store("en");
    cookie(false);
    if (document.documentElement.getAttribute("data-lang") === "pt") location.reload();
  });
  pt.addEventListener("click", function () {
    if (pt.disabled) return;
    store("pt");
    cookie(true);
    show("pt");
    load();
  });
  if (stored() === "pt") { cookie(true); show("pt"); load(); } else { show("en"); }
})();`;

export function Layout(props:{ title: string; path: string; prose?: boolean; children?: Child }) {
  // A document page belongs to the Fronts section, where it is listed.
  const first = props.path.split("/")[1] ?? "";
  const section = first === "docs" ? "/fronts" : `/${first}`;
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{props.title === "specs-bot" ? "specs-bot" : `${props.title} · specs-bot`}</title>
        <link rel="stylesheet" href="/static/site.css" />
      </head>
      <body>
        <header class="top">
          <div class="bar">
            <a class="brand" href="/">specs-bot</a>
            <nav>
              {NAV.map(([href, label]) => (
                <a href={href} class={href === section ? "on" : ""}>
                  {label}
                </a>
              ))}
            </nav>
            <div class="lang notranslate" translate="no" role="group" aria-label="Language">
              <button type="button" data-lang="en" aria-pressed="true" title="The specs as written (English)">
                EN
              </button>
              <button type="button" data-lang="pt" aria-pressed="false" title="Portuguese, translated in the browser by Google Translate; code and identifiers stay as written">
                PT
              </button>
            </div>
          </div>
        </header>
        <div id="gt-el" hidden />
        <main class={props.prose ? "prose" : ""}>{props.children}</main>
        <footer>Read-only view of the botopink specs. Agents write through the specs-bot CLI.</footer>
        <script dangerouslySetInnerHTML={{ __html: LANG_SCRIPT }} />
      </body>
    </html>
  );
}

/** Pre-rendered HTML (markdown output, already escaped where it came from the source). */
export function Html(props: { html: string; class?: string; inline?: boolean }) {
  return props.inline ? (
    <span class={props.class} dangerouslySetInnerHTML={{ __html: props.html }} />
  ) : (
    <div class={props.class} dangerouslySetInnerHTML={{ __html: props.html }} />
  );
}

export function StatusBadge(props: { status: StepStatus; by?: number | undefined }) {
  const label = props.status === "in-force" ? "in force" : props.by !== undefined ? `${props.status} by ${props.by}` : props.status;
  return <span class={`badge s-${props.status}`}>{label}</span>;
}

export function Unavailable(props: { path: string }) {
  return (
    <Layout title="Unavailable" path={props.path}>
      <h1>Specs unavailable</h1>
      <p class="bad">The specs could not be read. The overview shows the data repository's status.</p>
    </Layout>
  );
}

export function NotFound(props: { path: string; what: string; back: string; backLabel: string }) {
  return (
    <Layout title="Not found" path={props.path}>
      <h1>Not found</h1>
      <p class="muted">{props.what}</p>
      <p>
        <a href={props.back}>{props.backLabel}</a>
      </p>
    </Layout>
  );
}

/** A title as written, its `` `code` `` spans shown as code (JSX escapes the rest). */
export function Title(props: { text: string }) {
  return (
    <>
      {props.text.split(/(`[^`]+`)/).map((part) => (/^`[^`]+`$/.test(part) ? <code>{part.slice(1, -1)}</code> : part))}
    </>
  );
}

/** "1 doc", "3 docs". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * A short preview of a markdown text: cut at a word boundary, with a dangling `` ` `` or `**` closed so the
 * inline renderer does not swallow the rest.
 */
export function preview(text: string, max = 260): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  let cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  if (space > max * 0.6) cut = cut.slice(0, space);
  if ((cut.match(/`/g) ?? []).length % 2 === 1) cut += "`";
  if ((cut.match(/\*\*/g) ?? []).length % 2 === 1) cut += "**";
  return cut + " …";
}

/**
 * Plain text with the step numbers outside parentheses linked: "606 (1), 609" links 606 and 609, not 1.
 * Only numbers of steps that exist become links.
 */
export function StepLinks(props: { text: string; known: ReadonlySet<number> | ReadonlyMap<number, unknown> }) {
  const parts: Child[] = [];
  let depth = 0;
  let buf = "";
  const flush = () => {
    if (buf) parts.push(buf);
    buf = "";
  };
  const re = /\d+|[()]|[^\d()]+/g;
  for (const m of props.text.matchAll(re)) {
    const tok = m[0];
    if (tok === "(") depth++;
    else if (tok === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && /^\d+$/.test(tok) && props.known.has(Number(tok))) {
      flush();
      parts.push(<a href={`/steps/${tok}`}>{tok}</a>);
    } else buf += tok;
  }
  flush();
  return <>{parts}</>;
}
