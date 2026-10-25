// A unified diff of one change, for dry runs and for the write's answer. Lines are compared after the common
// head and tail are set aside, which is exact for the edits the bot makes (one region per file).

export function unifiedDiff(path: string, before: string | null, after: string, context = 3): string {
  const a = before === null ? [] : before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  if (head === a.length && head === b.length) return "";

  const from = Math.max(0, head - context);
  const removed = a.slice(head, a.length - tail);
  const added = b.slice(head, b.length - tail);
  const lead = a.slice(from, head);
  const trail = a.slice(a.length - tail, Math.min(a.length, a.length - tail + context));
  const aLen = lead.length + removed.length + trail.length;
  const bLen = lead.length + added.length + trail.length;
  return [
    `--- ${before === null ? "/dev/null" : `a/${path}`}`,
    `+++ b/${path}`,
    `@@ -${aLen ? from + 1 : 0},${aLen} +${bLen ? from + 1 : 0},${bLen} @@`,
    ...lead.map((l) => ` ${l}`),
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
    ...trail.map((l) => ` ${l}`),
  ].join("\n");
}

/** The lines a change adds (for the text rules). */
export function addedLines(before: string | null, after: string): string[] {
  const a = before === null ? [] : before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return b.slice(head, b.length - tail);
}
