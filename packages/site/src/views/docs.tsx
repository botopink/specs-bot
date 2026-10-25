import type { Doc } from "@specs-bot/core";
import type { SiteData } from "../data.ts";
import { type LinkContext, renderMarkdown } from "../markdown.ts";
import { Html, Layout } from "./layout.tsx";

interface Bucket {
  /** directory key: "machine-1", "150-rakun", "04-rakun" */
  key: string;
  docs: Doc[];
  children: Map<string, Bucket>;
}

function bucket(key: string): Bucket {
  return { key, docs: [], children: new Map() };
}

/** version → machine → front → group, each level keeping the docs that stop there. */
export function docTree(docs: Doc[]): Map<string, Bucket> {
  const versions = new Map<string, Bucket>();
  for (const d of docs) {
    let node = versions.get(d.version) ?? bucket(d.version);
    versions.set(d.version, node);
    const keys = [
      d.machine,
      d.front ? `${d.front.num}-${d.front.slug}` : undefined,
      d.group ? `${d.group.num}-${d.group.slug}` : undefined,
    ].filter((k): k is string => k !== undefined);
    for (const k of keys) {
      let next = node.children.get(k);
      if (!next) node.children.set(k, (next = bucket(k)));
      node = next;
    }
    node.docs.push(d);
  }
  return versions;
}

/** The part of a doc's ref below the deepest directory the tree shows it under. */
function labelOf(d: Doc, depthKey: string): string {
  const idx = d.ref.indexOf(`/${depthKey}/`);
  return idx >= 0 ? d.ref.slice(idx + depthKey.length + 2) : d.ref.split("/").slice(1).join("/");
}

function compareKeys(a: string, b: string): number {
  const na = Number.parseInt(a, 10);
  const nb = Number.parseInt(b, 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

function sortDocs(docs: Doc[]): Doc[] {
  // README first, then by ref.
  return [...docs].sort((a, b) => Number(b.name === "README") - Number(a.name === "README") || a.ref.localeCompare(b.ref));
}

function BucketView(props: { node: Bucket; open: boolean; frozen?: boolean; top?: boolean }) {
  const { node } = props;
  const children = [...node.children.values()].sort((a, b) => compareKeys(a.key, b.key));
  const count = countDocs(node);
  return (
    <details class="tree" open={props.open}>
      <summary>
        {node.key} <span class="frozen">{props.top ? (props.frozen ? "frozen · " : "current · ") : ""}{count} docs</span>
      </summary>
      {node.docs.length ? (
        <ul>
          {sortDocs(node.docs).map((d) => (
            <li>
              <a href={`/docs/${d.ref}`}>{labelOf(d, node.key)}</a> <span class="muted small">— {d.title}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {children.map((c) => (
        <BucketView node={c} open={props.open && !props.frozen && props.top === true} />
      ))}
    </details>
  );
}

function countDocs(node: Bucket): number {
  let n = node.docs.length;
  for (const c of node.children.values()) n += countDocs(c);
  return n;
}

export function DocsPage(props: { data: SiteData; path: string }) {
  const { tree } = props.data;
  const versions = docTree(tree.docs);
  const ordered = [...tree.versions].reverse().filter((v) => versions.has(v));
  return (
    <Layout title="Docs" path={props.path} prose>
      <h1>Docs</h1>
      <p class="muted">
        Every milestone document, by version, machine, front and group. {tree.current} is current; the others are frozen.
      </p>
      {ordered.map((v) => (
        <BucketView node={versions.get(v)!} open={v === tree.current} frozen={v !== tree.current} top />
      ))}
    </Layout>
  );
}

/** The document's body as HTML. Rendering a long document takes marked ~0.5 s, so the site caches it. */
export function renderDoc(doc: Doc, ctx: LinkContext): string {
  return renderMarkdown(doc.lines.join("\n"), ctx);
}

export function DocPage(props: { data: SiteData; doc: Doc; html: string; path: string }) {
  const { doc, data } = props;
  const outline = doc.sections.filter((s) => s.level === 2 || s.level === 3);
  const frozen = doc.version !== data.tree.current;
  const crumbs = doc.ref.split("/");
  return (
    <Layout title={doc.title} path={props.path}>
      <div class="crumbs">
        <a href="/docs">Docs</a>
        {crumbs.slice(0, -1).map((c, i) => {
          const readme = `${crumbs.slice(0, i + 1).join("/")}/README`;
          return (
            <>
              {" / "}
              {data.docByRef.has(readme) && readme !== doc.ref ? <a href={`/docs/${readme}`}>{c}</a> : c}
            </>
          );
        })}
        {" / "}
        {crumbs.at(-1)}
        {frozen ? <span class="frozen"> · frozen milestone</span> : null}
      </div>
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
