// The fronts of one milestone: the milestone (h1) → its fronts (h3, one card each, with the machine that owns it)
// → the folders inside the front (h4: former fronts, tracks) → their documents. /fronts?owner=machine-1 keeps one
// owner's fronts. A sticky index beside it.
import type { Doc } from "@specs-bot/core";
import type { SiteData } from "../data.ts";
import { type FolderNode, type FrontNode, frontsHref, labelBelow, milestoneOf } from "../hierarchy.ts";
import type { FrontProgress } from "../progress.ts";
import { Layout, plural, Title } from "./layout.tsx";
import { frontProgressHref, ProgressLine } from "./progress.tsx";

/** A document as a chip: its name, its title on hover. */
function Chips(props: { docs: Doc[]; dir: string }) {
  if (!props.docs.length) return null;
  return (
    <ul class="chips">
      {props.docs.map((d) => (
        <li>
          <a class="chip" href={`/docs/${d.ref}`} title={d.title}>
            {labelBelow(d, props.dir)}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The documents a front or folder holds, each with its title: used where there is room. */
function DocRows(props: { docs: Doc[]; dir: string }) {
  if (!props.docs.length) return null;
  return (
    <ul class="doclist">
      {props.docs.map((d) => (
        <li>
          <a href={`/docs/${d.ref}`}>{labelBelow(d, props.dir)}</a> <span class="muted small">— {d.title}</span>
        </li>
      ))}
    </ul>
  );
}

function FolderRow({ folder }: { folder: FolderNode }) {
  const docs = folder.readme ? [folder.readme, ...folder.docs] : folder.docs;
  return (
    <div class="folder">
      <h4 id={folder.anchor}>
        <a class="anchor" href={`#${folder.anchor}`}>
          <span class="fdir">{folder.dir}</span>
        </a>
        {folder.title ? (
          <span class="ftitle">
            {" "}
            <Title text={folder.title} />
          </span>
        ) : null}
      </h4>
      <Chips docs={docs} dir={folder.dir} />
    </div>
  );
}

export function FrontCard(props: { front: FrontNode; version: string; progress?: FrontProgress | undefined; href?: string }) {
  const { front, version, progress, href } = props;
  return (
    <section class="front-card" id={front.anchor}>
      <header>
        <span class="fnum">{front.num}</span>
        <div class="fhead">
          <h3>
            {front.readme ? <a href={`/docs/${front.readme.ref}`}>{front.slug}</a> : front.slug}
            <a class="anchor-link" href={`#${front.anchor}`} aria-label="Link to this front">
              #
            </a>
          </h3>
          {front.title ? (
            <p class="ftitle">
              <Title text={front.title} />
            </p>
          ) : null}
          <p class="fmeta">
            {front.owner ? (
              <>
                <a class="owner" href={`/fronts?owner=${front.owner}`} title="the machine that works this front" translate="no">
                  owner: {front.owner}
                </a>
                {" · "}
              </>
            ) : null}
            {[front.owner ? "" : version, plural(front.count, "doc"), front.folders.length ? plural(front.folders.length, "folder") : ""]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </header>
      {progress && href ? <ProgressLine p={progress} href={href} /> : null}
      <Chips docs={front.docs} dir={front.dir} />
      {front.folders.length ? (
        <div class="folders">
          {front.folders.map((g) => (
            <FolderRow folder={g} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** The old anchors (#machine-1, #machine-1-150-rakun) of the page that grouped fronts by machine. */
const OLD_ANCHORS = `(function(){var h=location.hash.slice(1),m=h.match(/^(machine-\\d+)(?:-(.+))?$/);if(!m)return;
if(m[2])location.replace("#"+m[2]);else location.replace("/fronts?owner="+m[1]);})();`;

export function FrontsPage(props: { data: SiteData; version: string; path: string; progress: Map<number, FrontProgress>; owner?: string | undefined }) {
  const { data, version, owner } = props;
  const ms = milestoneOf(data, version);
  const fronts = owner ? ms.fronts.filter((f) => f.owner === owner) : ms.fronts;
  const q = (o?: string) => {
    const params = new URLSearchParams();
    if (version !== data.tree.current) params.set("version", version);
    if (o) params.set("owner", o);
    const s = params.toString();
    return `/fronts${s ? `?${s}` : ""}`;
  };

  return (
    <Layout title={`Fronts — ${version}`} path={props.path}>
      <script dangerouslySetInnerHTML={{ __html: OLD_ANCHORS }} />
      <div class="doc-layout">
        <div>
          <h1>
            {version} <span class={ms.current ? "pill current" : "pill frozen-pill"}>{ms.current ? "current" : "frozen"}</span>
          </h1>
          <p class="muted">
            {plural(ms.fronts.length, "front")} · {plural(ms.count, "document")}
          </p>
          <nav class="versions" aria-label="Milestones">
            {[...data.tree.versions].reverse().map((v) =>
              v === version ? <span class="on">{v}</span> : <a href={frontsHref(data, v)}>{v}</a>,
            )}
          </nav>
          {ms.docs.length ? (
            <section>
              <h2 id="milestone">
                <a class="anchor" href="#milestone">
                  The milestone
                </a>
              </h2>
              <DocRows docs={ms.docs} dir="milestone" />
            </section>
          ) : null}
          <section>
            <h2 id="fronts">
              <a class="anchor" href="#fronts">
                Fronts
              </a>
              <span class="muted small"> · {plural(fronts.length, "front")}</span>
            </h2>
            {ms.owners.length ? (
              <nav class="versions owners" aria-label="Owner" translate="no">
                {owner ? <a href={q()}>all</a> : <span class="on">all</span>}
                {ms.owners.map((o) => {
                  const n = ms.fronts.filter((f) => f.owner === o).length;
                  return o === owner ? <span class="on">{o} · {n}</span> : <a href={q(o)}>{o} · {n}</a>;
                })}
              </nav>
            ) : null}
            {fronts.map((f) => (
              <FrontCard front={f} version={version} progress={props.progress.get(f.num)} href={frontProgressHref(data, version, f.num)} />
            ))}
          </section>
        </div>
        <aside>
          <strong>Sections</strong>
          <ul>
            {ms.docs.length ? (
              <li>
                <a href="#milestone">The milestone</a>
              </li>
            ) : null}
            <li>
              <a href="#fronts">Fronts</a>
            </li>
            {fronts.map((f) => (
              <li class="l3">
                <a href={`#${f.anchor}`}>
                  <span class="inum">{f.num}</span> {f.slug}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </Layout>
  );
}
