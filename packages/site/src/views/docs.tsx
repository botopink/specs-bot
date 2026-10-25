import type { Doc } from "@specs-bot/core";
import type { SiteData } from "../data.ts";
import { type LinkContext, renderMarkdown } from "../markdown.ts";
import { Html, Layout } from "./layout.tsx";

interface Folder {
  /** The directory's own name, as on disk: "machine-1", "150-rakun", "04-rakun". */
  name: string;
  /** Its README, shown as the folder's title and link. */
  readme?: Doc;
  /** The other documents directly in it. */
  docs: Doc[];
  children: Map<string, Folder>;
}

function folder(name: string): Folder {
  return { name, docs: [], children: new Map() };
}

/** version → the directories under it, as on disk; each folder keeps its README apart from its other documents. */
export function docTree(docs: Doc[]): Map<string, Folder> {
  const versions = new Map<string, Folder>();
  for (const d of docs) {
    const [version, ...rest] = d.ref.split("/");
    let node = versions.get(version!) ?? folder(version!);
    versions.set(version!, node);
    for (const dir of rest.slice(0, -1)) {
      let next = node.children.get(dir);
      if (!next) node.children.set(dir, (next = folder(dir)));
      node = next;
    }
    if (d.name === "README") node.readme = d;
    else node.docs.push(d);
  }
  return versions;
}

/** "98-packaging-tail" before "107-release"; unnumbered names ("machine-1", "examples") after, by name. */
function compareNames(a: string, b: string): number {
  const na = /^\d+/.test(a) ? Number.parseInt(a, 10) : Number.POSITIVE_INFINITY;
  const nb = /^\d+/.test(b) ? Number.parseInt(b, 10) : Number.POSITIVE_INFINITY;
  return na !== nb ? na - nb : a.localeCompare(b);
}

/** The README's title; a former front kept as context only (no README) takes its context's or track's. */
function titleOf(node: Folder): string | undefined {
  return node.readme?.title ?? node.docs.find((d) => d.name === "context" || d.name === "track")?.title;
}

function countDocs(node: Folder): number {
  let n = node.docs.length + (node.readme ? 1 : 0);
  for (const c of node.children.values()) n += countDocs(c);
  return n;
}

/** A milestone's own documents first in reading order, the rest by name. */
const MILESTONE_ORDER = ["overview", "status", "fronts", "contracts", "deferred", "language-gaps"];

function sortDocs(docs: Doc[]): Doc[] {
  const rank = (d: Doc) => {
    const i = MILESTONE_ORDER.indexOf(d.name);
    return i < 0 ? MILESTONE_ORDER.length : i;
  };
  return [...docs].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

function FolderView(props: { node: Folder; depth: number; current: boolean }) {
  const { node, depth } = props;
  const children = [...node.children.values()].sort((a, b) => compareNames(a.name, b.name));
  // The current milestone opens down to its machines; a front opens when clicked.
  const open = props.current && depth <= 1;
  return (
    <details class="tree" open={open}>
      <summary>
        {node.readme ? <a href={`/docs/${node.readme.ref}`}>{node.name}</a> : <span>{node.name}</span>}
        {depth > 0 && titleOf(node) ? <span class="muted"> — {titleOf(node)}</span> : null}
        <span class="frozen">
          {" "}
          {depth === 0 ? (props.current ? "current · " : "frozen · ") : ""}
          {countDocs(node)} docs
        </span>
      </summary>
      {node.docs.length ? (
        <ul>
          {sortDocs(node.docs).map((d) => (
            <li>
              <a href={`/docs/${d.ref}`}>{d.name}</a> <span class="muted small">— {d.title}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {children.map((c) => (
        <FolderView node={c} depth={depth + 1} current={props.current} />
      ))}
    </details>
  );
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
        <FolderView node={versions.get(v)!} depth={0} current={v === tree.current} />
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
