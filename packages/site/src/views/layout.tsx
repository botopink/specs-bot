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
  ["/docs", "Docs"],
];

export function Layout(props: { title: string; path: string; prose?: boolean; children?: Child }) {
  const section = "/" + (props.path.split("/")[1] ?? "");
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
          </div>
        </header>
        <main class={props.prose ? "prose" : ""}>{props.children}</main>
        <footer>Read-only view of the botopink specs. Agents write through the specs-bot CLI.</footer>
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
