import { type Doc, splitMeta } from "@specs-bot/core";
import type { SiteData } from "../data.ts";
import { crumbsOf } from "../hierarchy.ts";
import { type LinkContext, renderMarkdown } from "../markdown.ts";
import type { FrontProgress } from "../progress.ts";
import { Html, Layout } from "./layout.tsx";
import { DocProgressPanel } from "./progress.tsx";

/**
 * The document as HTML: its body, with the YAML block at its top shown as a table of its keys under the title
 * (each value a markdown fragment). Rendering a long document takes marked ~0.5 s, so the site caches it.
 */
export function renderDoc(doc: Doc, ctx: LinkContext): string {
  const { end } = doc.ref.includes("/examples/") ? { end: 0 } : splitMeta(doc.lines);
  const body = renderMarkdown(doc.lines.slice(end).join("\n"), ctx);
  const keys = Object.keys(doc.meta);
  if (!keys.length) return body;
  const rows = keys
    .map((k) => `<dt translate="no">${escapeHtml(k)}</dt><dd>${renderMarkdown(doc.meta[k]!, ctx)}</dd>`)
    .join("");
  const table = `<dl class="meta">${rows}</dl>`;
  const h1 = body.indexOf("</h1>");
  return h1 < 0 ? table + body : body.slice(0, h1 + 5) + table + body.slice(h1 + 5);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function DocPage(props: { data: SiteData; doc: Doc; html: string; path: string; progress?: FrontProgress | undefined; ctx: LinkContext }) {
  const { doc, data } = props;
  const outline = doc.sections.filter((s) => s.level === 2 || s.level === 3);
  const frozen = doc.version !== data.tree.current;
  const crumbs = crumbsOf(data, doc);
  return (
    <Layout title={doc.title} path={props.path}>
      <nav class="crumbs" aria-label="Where this document sits">
        {crumbs.map((c, i) => (
          <>
            {i ? <span class="sep"> / </span> : null}
            {c.href ? <a href={c.href}>{c.label}</a> : <span class={i === crumbs.length - 1 ? "here" : ""}>{c.label}</span>}
          </>
        ))}
        {frozen ? <span class="frozen"> · frozen milestone</span> : null}
      </nav>
      {props.progress ? <DocProgressPanel data={data} p={props.progress} ctx={props.ctx} /> : null}
      <div class="doc-layout">
        <Html class="markdown" html={props.html} />
        {outline.length ? (
          <aside>
            <strong>On this page</strong>
            <ul>
              {outline.map((s) => (
                <li class={`l${s.level}`}>
                  <a href={`#${s.anchor}`}>{s.heading.replace(/`/g, "")}</a>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>
    </Layout>
  );
}
