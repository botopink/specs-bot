// The fronts of a milestone as a document: a section per machine, a subsection per front, a sub-subsection per
// folder inside the front (a former front or a track), each listing its documents. Headings, not collapsed lists.
import { anchorOf, type Doc } from "@specs-bot/core";
import type { SiteData } from "../data.ts";
import { Layout } from "./layout.tsx";

interface Part {
  dir: string;
  title?: string;
  docs: Doc[];
}

interface FrontView {
  dir: string;
  readme?: Doc;
  docs: Doc[];
  parts: Map<string, Part>;
}

interface MachineView {
  name: string;
  readme?: Doc;
  docs: Doc[];
  fronts: Map<string, FrontView>;
}

/** "98-…" before "107-…"; unnumbered names after, by name. */
function byNumber(a: string, b: string): number {
  const na = /^\d+/.test(a) ? Number.parseInt(a, 10) : Number.POSITIVE_INFINITY;
  const nb = /^\d+/.test(b) ? Number.parseInt(b, 10) : Number.POSITIVE_INFINITY;
  return na !== nb ? na - nb : a.localeCompare(b);
}

export function frontsOf(docs: Doc[]): { top: Doc[]; machines: MachineView[] } {
  const top: Doc[] = [];
  const machines = new Map<string, MachineView>();
  for (const d of docs) {
    // An old milestone has no machine folder: its fronts sit directly under it.
    const key = d.machine ?? "";
    if (!d.front) {
      if (!d.machine) top.push(d);
      else {
        const m = machineOf(machines, key);
        if (d.name === "README") m.readme = d;
        else m.docs.push(d);
      }
      continue;
    }
    const m = machineOf(machines, key);
    let f = m.fronts.get(d.front.dir);
    if (!f) m.fronts.set(d.front.dir, (f = { dir: d.front.dir, docs: [], parts: new Map() }));
    if (!d.group) {
      if (d.ref.endsWith(`/${d.front.dir}/README`)) f.readme = d;
      else f.docs.push(d);
      continue;
    }
    let p = f.parts.get(d.group.dir);
    if (!p) f.parts.set(d.group.dir, (p = { dir: d.group.dir, docs: [] }));
    p.docs.push(d);
    if (d.ref.endsWith(`/${d.group.dir}/README`) || (!p.title && (d.name === "context" || d.name === "track"))) p.title = d.title;
  }
  return { top, machines: [...machines.values()].sort((a, b) => byNumber(a.name, b.name)) };
}

function machineOf(machines: Map<string, MachineView>, name: string): MachineView {
  let m = machines.get(name);
  if (!m) machines.set(name, (m = { name, docs: [], fronts: new Map() }));
  return m;
}

/** The part of a document's ref below `dir`: "context", "examples/decorator-arguments-280". */
function below(d: Doc, dir: string): string {
  const i = d.ref.indexOf(`/${dir}/`);
  return i < 0 ? d.name : d.ref.slice(i + dir.length + 2);
}

function DocList(props: { docs: Doc[]; dir: string }) {
  if (!props.docs.length) return null;
  const docs = [...props.docs].sort((a, b) => Number(b.name === "README") - Number(a.name === "README") || a.ref.localeCompare(b.ref));
  return (
    <ul class="doclist">
      {docs.map((d) => (
        <li>
          <a href={`/docs/${d.ref}`}>{below(d, props.dir)}</a> <span class="muted small">— {d.title}</span>
        </li>
      ))}
    </ul>
  );
}

export function FrontsPage(props: { data: SiteData; version: string; path: string }) {
  const { data, version } = props;
  const { top, machines } = frontsOf(data.tree.docs.filter((d) => d.version === version));
  const frozen = version !== data.tree.current;
  const id = (...parts: string[]) => anchorOf(parts.filter(Boolean).join(" "));

  return (
    <Layout title={`Fronts — ${version}`} path={props.path}>
      <div class="doc-layout">
        <div class="markdown">
          <h1>
            Fronts — {version}
            {frozen ? <span class="frozen"> · frozen milestone</span> : null}
          </h1>
          <p class="muted">
            Other milestones:{" "}
            {[...data.tree.versions].reverse().map((v, i) => (
              <>
                {i ? " · " : ""}
                {v === version ? <strong>{v}</strong> : <a href={`/fronts?version=${v}`}>{v}</a>}
              </>
            ))}
          </p>
          {top.length ? (
            <>
              <h2 id="milestone">The milestone</h2>
              <DocList docs={top} dir={version} />
            </>
          ) : null}
          {machines.map((m) => (
            <section>
              <h2 id={id(m.name || "fronts")}>
                {m.readme ? <a href={`/docs/${m.readme.ref}`}>{m.name}</a> : m.name || "Fronts"}
                {m.readme ? <span class="muted"> — {m.readme.title}</span> : null}
              </h2>
              <DocList docs={m.docs} dir={m.name} />
              {[...m.fronts.values()]
                .sort((a, b) => byNumber(a.dir, b.dir))
                .map((f) => (
                  <section>
                    <h3 id={id(m.name, f.dir)}>
                      {f.readme ? <a href={`/docs/${f.readme.ref}`}>{f.dir}</a> : f.dir}
                      {f.readme ? <span class="muted"> — {f.readme.title}</span> : null}
                    </h3>
                    <DocList docs={f.docs} dir={f.dir} />
                    {[...f.parts.values()]
                      .sort((a, b) => byNumber(a.dir, b.dir))
                      .map((p) => (
                        <>
                          <h4 id={id(m.name, f.dir, p.dir)}>
                            {p.dir}
                            {p.title ? <span class="muted"> — {p.title}</span> : null}
                          </h4>
                          <DocList docs={p.docs} dir={p.dir} />
                        </>
                      ))}
                  </section>
                ))}
            </section>
          ))}
        </div>
        <aside>
          <strong>Sections</strong>
          <ul>
            {top.length ? (
              <li>
                <a href="#milestone">The milestone</a>
              </li>
            ) : null}
            {machines.map((m) => (
              <>
                <li>
                  <a href={`#${id(m.name || "fronts")}`}>{m.name || "Fronts"}</a>
                </li>
                {[...m.fronts.values()]
                  .sort((a, b) => byNumber(a.dir, b.dir))
                  .map((f) => (
                    <li class="l3">
                      <a href={`#${id(m.name, f.dir)}`}>{f.dir}</a>
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
