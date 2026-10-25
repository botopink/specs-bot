// Markdown → HTML for the pages. Raw HTML in the source is shown as text, headings carry core's anchors, and
// relative links resolve to the site's routes; a relative link that resolves to nothing the site serves becomes
// plain text, so no page links to a file path.
import { Marked, type Tokens } from "marked";
import { anchorOf } from "@specs-bot/core";

export interface LinkContext {
  /** The ref of the document being rendered; relative links resolve against its directory. */
  from?: string;
  /** Known document refs. */
  refs: ReadonlySet<string>;
}

/** The files above every milestone, by name, and the page that shows each. */
const TOP_LEVEL: Record<string, string> = {
  "decisions-taken-steps": "/steps",
  "decisions-taken": "/subjects",
  "decisions-pending": "/pending",
  "decisoes-pendentes": "/pending",
  retired: "/retired",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

function markedFor(ctx: LinkContext): Marked {
  const used = new Map<string, number>();
  return new Marked({
    gfm: true,
    renderer: {
      html({ text }: Tokens.HTML | Tokens.Tag) {
        return escapeHtml(text);
      },
      heading({ tokens, depth, text }: Tokens.Heading) {
        const base = anchorOf(text);
        const n = used.get(base) ?? 0;
        used.set(base, n + 1);
        const id = n === 0 ? base : `${base}-${n}`;
        const inner = this.parser.parseInline(tokens);
        return `<h${depth} id="${escapeHtml(id)}"><a class="anchor" href="#${escapeHtml(id)}">${inner}</a></h${depth}>\n`;
      },
      link({ href, title, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens);
        const target = resolveLink(href, ctx);
        if (target === undefined) return `<span class="unresolved">${inner}</span>`;
        const t = title ? ` title="${escapeHtml(title)}"` : "";
        return `<a href="${escapeHtml(target)}"${t}>${inner}</a>`;
      },
      image({ href, text }: Tokens.Image) {
        return /^https?:\/\//.test(href) ? `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}">` : escapeHtml(text);
      },
    },
  });
}

const NOTRANS = /^\s*<!--\s*notrans\s*-->\s*$/;

/**
 * The document as HTML. A block right after a `<!-- notrans -->` line is wrapped untranslatable (translate.ts);
 * the marker itself is not shown.
 */
export function renderMarkdown(source: string, ctx: LinkContext): string {
  const marked = markedFor(ctx);
  const tokens = marked.lexer(source);
  if (!tokens.some((t) => t.type === "html" && NOTRANS.test(t.raw))) return marked.parser(tokens);
  let out = "";
  let hold = false;
  for (const t of tokens) {
    if (t.type === "html" && NOTRANS.test(t.raw)) {
      hold = true;
      continue;
    }
    // Each block alone, with the document's link definitions.
    const html = marked.parser(Object.assign([t], { links: tokens.links }));
    if (hold && t.type !== "space") {
      out += `<div class="notranslate" translate="no">${html}</div>`;
      hold = false;
    } else out += html;
  }
  return out;
}

export function renderInline(source: string, ctx: LinkContext): string {
  return markedFor(ctx).parseInline(source, { async: false }) as string;
}

/** The site URL a link in a document points to, or undefined when it points to nothing the site serves. */
export function resolveLink(href: string, ctx: LinkContext): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href; // http:, https:, mailto:
  if (href.startsWith("#")) return href;
  const hash = href.indexOf("#");
  const path = decodeURIComponentSafe(hash < 0 ? href : href.slice(0, hash));
  const anchor = hash < 0 ? "" : href.slice(hash);
  if (!path) return anchor || undefined;

  const baseDir = ctx.from ? ctx.from.split("/").slice(0, -1) : [];
  const parts = path.startsWith("/") ? [] : [...baseDir];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return undefined; // above specs/: another repository
      parts.pop();
    } else parts.push(seg);
  }
  const joined = parts.join("/");
  const ref = joined.endsWith(".md") ? joined.slice(0, -3) : joined;

  if (ctx.refs.has(ref)) return `/docs/${ref}${anchor}`;
  if (ctx.refs.has(`${ref}/README`)) return `/docs/${ref}/README${anchor}`;
  const top = TOP_LEVEL[ref];
  if (top) return top;
  return undefined;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
