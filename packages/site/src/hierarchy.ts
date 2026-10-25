// The one hierarchy every page shows: milestone → machine → front → the folders inside a front → documents.
// An old milestone has no machine folder; its fronts sit in one "Fronts" section. Anchors are stable and
// readable ("machine-1-150-rakun-04-rakun") so a document's breadcrumbs can point back to its section.
import type { Doc } from "@specs-bot/core";
import type { SiteData } from "./data.ts";

export interface FolderNode {
  /** The folder's name as on disk: "04-rakun", "125-validation-zod". */
  dir: string;
  anchor: string;
  /** Its README's title, else its context's or track's, without the number the name already says. */
  title?: string;
  readme?: Doc;
  docs: Doc[];
}

export interface FrontNode {
  dir: string;
  num: number;
  slug: string;
  machine: string;
  anchor: string;
  readme?: Doc;
  /** What the README's title says beyond the front's number and name (see shortTitle); may be empty. */
  title: string;
  /** Documents in the front's own folder (the README apart) and in unnumbered folders below it. */
  docs: Doc[];
  folders: FolderNode[];
  count: number;
}

export interface MachineNode {
  /** "machine-1"; "" for an old milestone, whose fronts have no machine. */
  name: string;
  anchor: string;
  readme?: Doc;
  title?: string;
  docs: Doc[];
  fronts: FrontNode[];
  count: number;
}

export interface MilestoneNode {
  version: string;
  current: boolean;
  /** The milestone's own documents (status, fronts, …) and those in unnumbered folders under it. */
  docs: Doc[];
  machines: MachineNode[];
  count: number;
}

/** A milestone's own documents in reading order; the rest by name. */
const MILESTONE_ORDER = ["README", "overview", "status", "fronts", "contracts", "deferred", "language-gaps", "closure"];

export function milestoneOf(data: SiteData, version: string): MilestoneNode {
  const docs = data.tree.docs.filter((d) => d.version === version);
  const top: Doc[] = [];
  const machines = new Map<string, MachineNode>();
  const fronts = new Map<string, FrontNode>();
  const folders = new Map<string, FolderNode>();

  for (const d of docs) {
    if (!d.front) {
      if (d.machine) {
        const m = machineOf(machines, d.machine);
        if (d.ref === `${version}/${d.machine}/README`) m.readme = d;
        else m.docs.push(d);
      } else {
        top.push(d);
      }
      continue;
    }
    const machine = d.machine ?? "";
    const m = machineOf(machines, machine);
    const fkey = `${machine}/${d.front.dir}`;
    let f = fronts.get(fkey);
    if (!f) {
      f = {
        dir: d.front.dir,
        num: d.front.num,
        slug: d.front.slug,
        machine,
        anchor: frontAnchor(machine, d.front.dir),
        title: "",
        docs: [],
        folders: [],
        count: 0,
      };
      fronts.set(fkey, f);
      m.fronts.push(f);
    }
    f.count++;
    if (!d.group) {
      if (d.ref.endsWith(`/${d.front.dir}/README`)) {
        f.readme = d;
        f.title = shortTitle(d.title, d.front.num, d.front.slug);
      } else {
        f.docs.push(d);
      }
      continue;
    }
    const gkey = `${fkey}/${d.group.dir}`;
    let g = folders.get(gkey);
    if (!g) {
      g = { dir: d.group.dir, anchor: folderAnchor(machine, d.front.dir, d.group.dir), docs: [] };
      folders.set(gkey, g);
      f.folders.push(g);
    }
    if (d.ref.endsWith(`/${d.group.dir}/README`)) {
      g.readme = d;
      g.title = shortTitle(d.title, d.group.num, d.group.slug);
    } else {
      g.docs.push(d);
      if (!g.readme && g.title === undefined && (d.name === "context" || d.name === "track")) {
        g.title = shortTitle(d.title, d.group.num, d.group.slug);
      }
    }
  }

  const ordered = [...machines.values()].sort((a, b) => byNumber(a.name, b.name));
  for (const m of ordered) {
    m.fronts.sort((a, b) => a.num - b.num || a.dir.localeCompare(b.dir));
    for (const f of m.fronts) {
      f.folders.sort((a, b) => byNumber(a.dir, b.dir));
      f.docs = sortDocs(f.docs);
      for (const g of f.folders) g.docs = sortDocs(g.docs);
    }
    m.docs = sortDocs(m.docs);
    m.count = m.fronts.reduce((n, f) => n + f.count, (m.readme ? 1 : 0) + m.docs.length);
    if (m.readme) m.title = m.readme.title;
  }
  return { version, current: version === data.tree.current, docs: sortDocs(top), machines: ordered, count: docs.length };
}

function machineOf(machines: Map<string, MachineNode>, name: string): MachineNode {
  let m = machines.get(name);
  if (!m) machines.set(name, (m = { name, anchor: machineAnchor(name), docs: [], fronts: [], count: 0 }));
  return m;
}

export function machineAnchor(machine: string): string {
  return machine || "fronts";
}

export function frontAnchor(machine: string, frontDir: string): string {
  return machine ? `${machine}-${frontDir}` : frontDir;
}

export function folderAnchor(machine: string, frontDir: string, dir: string): string {
  return `${frontAnchor(machine, frontDir)}-${dir}`;
}

/** The URL of a section of the Fronts page; the current milestone needs no version. */
export function frontsHref(data: SiteData, version: string, anchor?: string): string {
  const q = version === data.tree.current ? "" : `?version=${encodeURIComponent(version)}`;
  return `/fronts${q}${anchor ? `#${anchor}` : ""}`;
}

/**
 * What a title says beyond the folder's name, which is shown beside it: "Front 150 — rakun: the 16 members" in
 * `150-rakun` → "the 16 members"; "Track 04 — rakun" in `04-rakun` → "" (nothing more); "Front 144 — machine 1:
 * the checker" in `144-checker` → "machine 1: the checker". Only a prefix naming the folder's own number, then its
 * own name, goes.
 */
export function shortTitle(title: string, num: number, slug = ""): string {
  const m = title.match(/^(?:front|track)\s+0*(\d+)\s*[—–-]\s*(.+)$/i);
  let rest = m && Number(m[1]) === num ? m[2]! : title;
  if (slug) {
    const name = slug.replace(/-/g, "[ -]");
    const same = rest.match(new RegExp(`^\`?${name}\`?\\s*(?:[:—–]\\s*|$)`, "i"));
    if (same) rest = rest.slice(same[0].length);
  }
  return rest.trim();
}

/** "98-…" before "107-…"; unnumbered names after, by name. */
export function byNumber(a: string, b: string): number {
  const na = /^\d+/.test(a) ? Number.parseInt(a, 10) : Number.POSITIVE_INFINITY;
  const nb = /^\d+/.test(b) ? Number.parseInt(b, 10) : Number.POSITIVE_INFINITY;
  return na !== nb ? na - nb : a.localeCompare(b);
}

export function sortDocs(docs: Doc[]): Doc[] {
  const rank = (d: Doc) => {
    const i = MILESTONE_ORDER.indexOf(d.name);
    return i < 0 ? MILESTONE_ORDER.length : i;
  };
  return [...docs].sort((a, b) => rank(a) - rank(b) || a.ref.localeCompare(b.ref));
}

/**
 * A document's name below `dir`: "context", "examples/decorator-arguments-280". The last folder of that name:
 * front 105-i18n holds a folder 105-i18n of its own.
 */
export function labelBelow(d: Doc, dir: string): string {
  const i = d.ref.lastIndexOf(`/${dir}/`);
  return i < 0 ? d.name : d.ref.slice(i + dir.length + 2);
}

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Where a document sits, each level linking to its section of the Fronts page:
 * Fronts / 1.0.12-beta / machine-1 / 150-rakun / 04-rakun / track.
 */
export function crumbsOf(data: SiteData, d: Doc): Crumb[] {
  const crumbs: Crumb[] = [
    { label: "Fronts", href: frontsHref(data, data.tree.current) },
    { label: d.version, href: frontsHref(data, d.version) },
  ];
  const machine = d.machine ?? "";
  if (d.machine) crumbs.push({ label: d.machine, href: frontsHref(data, d.version, machineAnchor(machine)) });
  if (d.front) crumbs.push({ label: d.front.dir, href: frontsHref(data, d.version, frontAnchor(machine, d.front.dir)) });
  if (d.front && d.group) crumbs.push({ label: d.group.dir, href: frontsHref(data, d.version, folderAnchor(machine, d.front.dir, d.group.dir)) });
  // Folders between the deepest section and the file ("examples") are named, not linked.
  const known = [d.version, d.machine, d.front?.dir, d.group?.dir].filter(Boolean).length;
  const rest = d.ref.split("/").slice(known);
  for (const seg of rest.slice(0, -1)) crumbs.push({ label: seg });
  crumbs.push({ label: rest.at(-1)! });
  return crumbs;
}

/** The Fronts section a folder ref (one with no README of its own) stands for, if any document lives under it. */
export function sectionOfFolder(data: SiteData, ref: string): string | undefined {
  const inside = data.tree.docs.find((d) => d.ref.startsWith(`${ref}/`));
  if (!inside) return undefined;
  const depth = ref.split("/").length;
  const crumbs = crumbsOf(data, inside).slice(1); // drop "Fronts": index 0 is now the version
  // An unnumbered folder ("closure-audit") has no section of its own: its milestone's stands for it.
  return crumbs[depth - 1]?.href ?? frontsHref(data, inside.version);
}
