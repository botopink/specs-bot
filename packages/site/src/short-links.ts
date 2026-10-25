// The current milestone's documents need no version in their URL: `/docs/machine-1/144-botopink-lang/README`
// is the current one's, whatever milestone is current. A versioned URL (`/docs/1.0.12-beta/…`) keeps working and
// stays the permalink — the short one always means "the latest", which is what a reader of the work in progress
// wants; a frozen milestone has no short form.

const VERSION = /^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/;

export function isVersion(segment: string): boolean {
  return VERSION.test(segment);
}

/** The document ref a `/docs/` path means: a path that does not start with a version is the current milestone's. */
export function refOfPath(path: string, current: string): string {
  const first = path.split("/")[0] ?? "";
  return isVersion(first) || !current ? path : `${current}/${path}`;
}

/** The site's URL for a document ref: short for the current milestone, versioned for a frozen one. */
export function docHref(ref: string, current: string): string {
  return current && ref.startsWith(`${current}/`) ? `/docs/${ref.slice(current.length + 1)}` : `/docs/${ref}`;
}

/** Every link of a page to a current-milestone document, in its short form. */
export function shortenDocLinks(html: string, current: string): string {
  if (!current) return html;
  return html.replaceAll(`href="/docs/${current}/`, 'href="/docs/');
}
