// The fronts of one milestone, as sections: the milestone (h1) → a machine (h2) → a front (h3, one card each) →
// the folders inside the front (h4: former fronts, tracks) → their documents. A sticky index beside it.
import type { Doc } from "@specs-bot/core";
import type { SiteData } from "../data.ts";
import { type FolderNode, type FrontNode, frontsHref, labelBelow, type MachineNode, milestoneOf } from "../hierarchy.ts";
import { Layout, plural, Title } from "./layout.tsx";

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

export function FrontCard({ front, version }: { front: FrontNode; version: string }) {
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
            {[front.machine || version, plural(front.count, "doc"), front.folders.length ? plural(front.folders.length, "folder") : ""]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </header>
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

function MachineSection({ machine, version }: { machine: MachineNode; version: string }) {
  return (
    <section class="machine">
      <h2 id={machine.anchor}>
        <a class="anchor" href={`#${machine.anchor}`}>
          {machine.name || "Fronts"}
        </a>
        <span class="muted small">
          {" "}
          · {plural(machine.fronts.length, "front")} · {plural(machine.count, "doc")}
        </span>
      </h2>
      {machine.readme || machine.docs.length ? (
        <p class="machine-docs">
          {machine.readme ? (
            <>
              <a href={`/docs/${machine.readme.ref}`}>{machine.readme.title}</a>
            </>
          ) : null}
          {machine.docs.map((d) => (
            <>
              {" · "}
              <a href={`/docs/${d.ref}`} title={d.title}>
                {labelBelow(d, machine.name)}
              </a>
            </>
          ))}
        </p>
      ) : null}
      {machine.fronts.map((f) => (
        <FrontCard front={f} version={version} />
      ))}
    </section>
  );
}

export function FrontsPage(props: { data: SiteData; version: string; path: string }) {
  const { data, version } = props;
  const ms = milestoneOf(data, version);
  const fronts = ms.machines.reduce((n, m) => n + m.fronts.length, 0);

  return (
    <Layout title={`Fronts — ${version}`} path={props.path}>
      <div class="doc-layout">
        <div>
          <h1>
            {version} <span class={ms.current ? "pill current" : "pill frozen-pill"}>{ms.current ? "current" : "frozen"}</span>
          </h1>
          <p class="muted">
            {plural(fronts, "front")} · {plural(ms.count, "document")}
            {ms.machines.some((m) => m.name) ? ` · ${plural(ms.machines.filter((m) => m.name).length, "machine")}` : ""}
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
              <DocRows docs={ms.docs} dir={version} />
            </section>
          ) : null}
          {ms.machines.map((m) => (
            <MachineSection machine={m} version={version} />
          ))}
        </div>
        <aside>
          <strong>Sections</strong>
          <ul>
            {ms.docs.length ? (
              <li>
                <a href="#milestone">The milestone</a>
              </li>
            ) : null}
            {ms.machines.map((m) => (
              <>
                <li>
                  <a href={`#${m.anchor}`}>{m.name || "Fronts"}</a>
                </li>
                {m.fronts.map((f) => (
                  <li class="l3">
                    <a href={`#${f.anchor}`}>
                      <span class="inum">{f.num}</span> {f.slug}
                    </a>
                  </li>
                ))}
              </>
            ))}
          </ul>
        </aside>
      </div>
    </Layout>
  );
}
