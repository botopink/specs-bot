// The fronts of one milestone: the milestone (h1) → its fronts (h3, one card each, with the machine that owns it)
// → the folders inside the front (h4: former fronts, tracks) → their documents. /fronts?owner=machine-1 keeps one
// owner's fronts. A sticky index beside it.
import type { Doc } from "@specs-bot/core";
import type { SiteData } from "../data.ts";
import { type FolderNode, type FrontNode, frontsHref, labelBelow, milestoneOf, movedAnchors } from "../hierarchy.ts";
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

/** Where a front stands, from its gathered progress: what the page's state chips filter on. */
export type FrontState = "active" | "todo" | "done" | "none";

export const STATE_LABEL: Record<FrontState, string> = { active: "in progress", todo: "not started", done: "done", none: "no steps found" };

export function frontState(p: FrontProgress | undefined): FrontState {
  if (!p) return "none";
  const { done, open, blocked } = p.counts;
  const total = done + open + blocked;
  return !total ? "none" : done === total ? "done" : done ? "active" : "todo";
}

/** The words a front is found by in the filter box: number, name, title, owner, the number it was. */
function haystack(f: FrontNode): string {
  return [String(f.num), f.dir, f.slug.replace(/-/g, " "), f.title, f.owner || "unassigned", f.formerly !== undefined ? `was ${f.formerly}` : ""]
    .join(" ")
    .toLowerCase();
}

export function FrontCard(props: { front: FrontNode; version: string; progress?: FrontProgress | undefined; href?: string; current?: boolean }) {
  const { front, version, progress, href } = props;
  return (
    <section class="front-card" id={front.anchor} data-q={haystack(front)} data-state={frontState(progress)}>
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
            ) : props.current ? (
              <>
                <a class="owner free" href="/fronts?owner=none" title="no machine has taken it: specs-bot claim" translate="no">
                  unassigned
                </a>
                {" · "}
              </>
            ) : null}
            {front.formerly !== undefined ? (
              <>
                <span class="was" title="the number its README's title still gives it: a group promoted to a front of its own">
                  was {front.formerly}
                </span>
                {" · "}
              </>
            ) : null}
            {[props.current ? "" : version, plural(front.count, "doc"), front.folders.length ? plural(front.folders.length, "folder") : ""]
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

/**
 * The old anchors: #machine-1 and #machine-1-150-rakun (the page that grouped fronts by machine), and a group's
 * #150-rakun-04-rakun (before flatten-groups.ts made every group a front of its own) → the front it became.
 */
const oldAnchors = (moved: Record<string, string>) => `(function(){var h=location.hash.slice(1),g=${JSON.stringify(moved).replace(/</g, "\\u003c")};
if(!h||document.getElementById(h))return;if(g[h]){location.replace("#"+g[h]);return;}
var m=h.match(/^(machine-\\d+)(?:-(.+))?$/);if(!m)return;
if(m[2])location.replace("#"+m[2]);else location.replace("/fronts?owner="+m[1]);})();`;

/**
 * The filter box and the state chips: hide every card (and its index entry) whose words do not hold all the
 * typed ones, or whose state is not the chosen one; `/` focuses the box; both are kept in the URL's query.
 */
const FILTER_SCRIPT = `(function(){var box=document.getElementById("ffilter");if(!box)return;
var cards=[].slice.call(document.querySelectorAll(".front-card[data-q]")),chips=[].slice.call(document.querySelectorAll("[data-pick]"));
var idx={};[].slice.call(document.querySelectorAll("aside [data-for]")).forEach(function(li){idx[li.getAttribute("data-for")]=li;});
var out=document.getElementById("fcount"),none=document.getElementById("fnone"),u=new URL(location.href),state=u.searchParams.get("state")||"";
box.value=u.searchParams.get("q")||"";
function run(){var w=box.value.toLowerCase().split(/\\s+/).filter(Boolean),n=0;
cards.forEach(function(c){var ok=(!state||c.getAttribute("data-state")===state)&&w.every(function(x){return c.getAttribute("data-q").indexOf(x)>=0});
c.hidden=!ok;if(idx[c.id])idx[c.id].hidden=!ok;if(ok)n++;});
chips.forEach(function(b){b.setAttribute("aria-pressed",String(b.getAttribute("data-pick")===state));});
out.textContent=n===cards.length?"":n+" of "+cards.length+" shown";none.hidden=n>0;
var q=new URL(location.href);if(box.value)q.searchParams.set("q",box.value);else q.searchParams.delete("q");
if(state)q.searchParams.set("state",state);else q.searchParams.delete("state");history.replaceState(null,"",q);}
box.addEventListener("input",run);
chips.forEach(function(b){b.addEventListener("click",function(){state=b.getAttribute("data-pick");run();});});
document.addEventListener("keydown",function(e){if(e.key==="/"&&document.activeElement!==box){e.preventDefault();box.focus();}});
if(box.value||state)run();})();`;

export function FrontsPage(props: { data: SiteData; version: string; path: string; progress: Map<number, FrontProgress>; owner?: string | undefined }) {
  const { data, version, owner } = props;
  const ms = milestoneOf(data, version);
  // ?owner=none keeps the fronts no machine has taken.
  const fronts = owner === "none" ? ms.fronts.filter((f) => !f.owner) : owner ? ms.fronts.filter((f) => f.owner === owner) : ms.fronts;
  const free = ms.fronts.filter((f) => !f.owner).length;
  const tally: Record<FrontState, number> = { active: 0, todo: 0, done: 0, none: 0 };
  for (const f of fronts) tally[frontState(props.progress.get(f.num))]++;
  const q = (o?: string) => {
    const params = new URLSearchParams();
    if (version !== data.tree.current) params.set("version", version);
    if (o) params.set("owner", o);
    const s = params.toString();
    return `/fronts${s ? `?${s}` : ""}`;
  };

  return (
    <Layout title={`Fronts — ${version}`} path={props.path}>
      <script dangerouslySetInnerHTML={{ __html: oldAnchors(movedAnchors(data)) }} />
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
            {ms.current ? (
              <nav class="versions owners" aria-label="Owner" translate="no">
                {owner ? <a href={q()}>all</a> : <span class="on">all</span>}
                {ms.owners.map((o) => {
                  const n = ms.fronts.filter((f) => f.owner === o).length;
                  return o === owner ? <span class="on">{o} · {n}</span> : <a href={q(o)}>{o} · {n}</a>;
                })}
                {free ? owner === "none" ? <span class="on">unassigned · {free}</span> : <a href={q("none")}>unassigned · {free}</a> : null}
              </nav>
            ) : null}
            <div class="front-tools" role="search">
              <input id="ffilter" type="search" placeholder="Filter fronts — number, name, title, owner  ( / )" aria-label="Filter fronts" />
              <div class="states" role="group" aria-label="State">
                <button type="button" data-pick="" aria-pressed="true">
                  all · {fronts.length}
                </button>
                {(["active", "todo", "done", "none"] as const).map((s) =>
                  tally[s] ? (
                    <button type="button" data-pick={s} aria-pressed="false" class={`st-${s}`}>
                      {STATE_LABEL[s]} · {tally[s]}
                    </button>
                  ) : null,
                )}
              </div>
              <span id="fcount" class="muted small" />
            </div>
            <p id="fnone" class="muted" hidden>
              No front matches.
            </p>
            {fronts.map((f) => (
              <FrontCard front={f} version={version} progress={props.progress.get(f.num)} href={frontProgressHref(data, version, f.num)} current={ms.current} />
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
              <li class="l3" data-for={f.anchor}>
                <a href={`#${f.anchor}`}>
                  <span class="inum">{f.num}</span> {f.slug}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      </div>
      <script dangerouslySetInnerHTML={{ __html: FILTER_SCRIPT }} />
    </Layout>
  );
}
