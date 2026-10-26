// Document URLs are the refs themselves (`/docs/150-rakun/README`): the tree has no version or machine folders.
// A link from before the flattening (`/docs/1.0.12-beta/machine-1/150-rakun/README`, or the short form without
// the version) still lands: the data's moved.json maps old refs to new ones, or to a permalink of a removed file.

import type { DocTree } from "@specs-bot/core";

export function docHref(ref: string): string {
  return `/docs/${ref}`;
}

/** Where an old document path goes now: a ref, a permalink (https://…), or undefined when it was never known. */
export function movedTo(tree: DocTree, path: string): string | undefined {
  const at = (p: string) => tree.moved.get(p) ?? tree.moved.get(`${p}/README`);
  const direct = at(path);
  if (direct) return direct;
  // The short form of the old current milestone's paths: /docs/machine-1/150-rakun/README.
  return at(`${tree.current}/${path}`);
}
