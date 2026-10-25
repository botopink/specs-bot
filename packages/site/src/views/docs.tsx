import type { Doc } from "@specs-bot/core";
import type { SiteData } from "../data.ts";
import { crumbsOf } from "../hierarchy.ts";
import { type LinkContext, renderMarkdown } from "../markdown.ts";
import { Html, Layout } from "./layout.tsx";

/** The document's body as HTML. Rendering a long document takes marked ~0.5 s, so the site caches it. */
export function renderDoc(doc: Doc, ctx: LinkContext): string {
  return renderMarkdown(doc.lines.join("\n"), ctx);
}

export function DocPage(props: { data: SiteData; doc: Doc; html: string; path: string }) {
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
