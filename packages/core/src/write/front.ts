// Who works a front (the maintainer, 2026-10-26): the `owner` key of the front README's metadata block, set only
// when a machine takes the front to work it — `front.claim` by the machine itself, `front.assign` by the
// maintainer — and removed by `front.release`. A front of the current milestone with no owner is free; the
// documents under a front inherit its owner (load.ts).
import type { Doc } from "../docs/doc.ts";
import { withMeta } from "../docs/meta.ts";
import type { Front, Model } from "../model.ts";
import { PARTIES } from "./chat.ts";
import { type Plan, WriteError } from "./plan.ts";

const MACHINES = PARTIES.filter((p) => p.startsWith("machine-"));

/** A current front by its folder ("150-rakun") or its number when only one folder has it. */
export function frontFor(model: Model, front: string): { front: Front; readme: Doc } {
  const current = model.fronts.filter((f) => f.version === model.tree.current);
  const want = front.trim().replace(/\/+$/, "").replace(/\/README$/, "");
  const found = /^\d+$/.test(want) ? current.filter((f) => f.num === Number(want)) : current.filter((f) => f.ref === want);
  if (!found.length) {
    const old = model.fronts.find((f) => f.ref === want || String(f.num) === want);
    if (old) throw new WriteError("frozen", `front ${want} is in ${old.version}, a closed milestone`, `only ${model.tree.current}'s fronts are worked`);
    throw new WriteError("not-found", `no front ${want} in ${model.tree.current}`, "specs-bot fronts lists them");
  }
  if (found.length > 1) {
    throw new WriteError("invalid", `${found.length} fronts have the number ${want}: ${found.map((f) => f.ref).join(", ")}`, "name the folder");
  }
  const f = found[0]!;
  const readme = f.readme ? model.docByRef.get(f.readme) : undefined;
  if (!readme) throw new WriteError("invalid", `front ${f.ref} has no README to hold its owner`);
  return { front: f, readme };
}

function setOwner(readme: Doc, front: Front, owner: string | undefined, op: string, what: string): Plan {
  const meta = { ...readme.meta };
  if (!meta.milestone) meta.milestone = readme.version;
  if (owner) meta.owner = owner;
  else delete meta.owner;
  return {
    op,
    refs: [front.ref],
    message: `spec(${readme.version}): ${front.ref}: ${what}`,
    summary: `${front.ref}: ${what}`,
    changes: [{ path: `specs/${readme.ref}.md`, before: readme.lines.join("\n"), after: withMeta(readme.lines, meta).join("\n") }],
  };
}

/** A machine takes a free front to work it. */
export function claimFront(model: Model, input: { front: string }, party: string): Plan {
  if (!(MACHINES as string[]).includes(party)) {
    throw new WriteError("forbidden", `${party} works no front`, "the maintainer gives a front to a machine with specs-bot assign <front> --to <machine>");
  }
  const { front, readme } = frontFor(model, input.front);
  const owner = readme.meta.owner;
  if (owner === party) throw new WriteError("invalid", `${front.ref} is already ${party}'s`);
  if (owner) throw new WriteError("conflict", `${front.ref} is ${owner}'s`, `${owner} releases it (specs-bot release ${front.ref}), or the maintainer reassigns it`, { owner });
  return setOwner(readme, front, party, "front.claim", `claimed by ${party}`);
}

/** The owner (or the maintainer) lets a front go: it is free again. */
export function releaseFront(model: Model, input: { front: string }, party: string): Plan {
  const { front, readme } = frontFor(model, input.front);
  const owner = readme.meta.owner;
  if (!owner) throw new WriteError("invalid", `${front.ref} has no owner`);
  if (owner !== party && party !== "maintainer") throw new WriteError("forbidden", `${front.ref} is ${owner}'s; only ${owner} or the maintainer releases it`, undefined, { owner });
  return setOwner(readme, front, undefined, "front.release", `released by ${party}`);
}

/** The maintainer gives a front to a machine, whoever held it. */
export function assignFront(model: Model, input: { front: string; to: string }, party: string): Plan {
  if (party !== "maintainer") throw new WriteError("forbidden", "only the maintainer assigns a front", "a machine takes a free front with specs-bot claim <front>");
  if (!(MACHINES as string[]).includes(input.to)) throw new WriteError("invalid", `${input.to} is no machine (${MACHINES.join(", ")})`);
  const { front, readme } = frontFor(model, input.front);
  const owner = readme.meta.owner;
  if (owner === input.to) throw new WriteError("invalid", `${front.ref} is already ${input.to}'s`);
  return setOwner(readme, front, input.to, "front.assign", owner ? `reassigned from ${owner} to ${input.to}` : `assigned to ${input.to}`);
}
