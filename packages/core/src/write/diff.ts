// Line diffs of one change, for dry runs, the write's answer and the text rules. The common head and tail are
// set aside, then the middle is aligned by its longest common subsequence, so a write that touches two far
// places (the record's head and its last row) shows two hunks and adds only its own lines.

type Op = { kind: " " | "-" | "+"; line: string; a: number; b: number };

function align(a: string[], b: string[]): Op[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const am = a.slice(head, a.length - tail);
  const bm = b.slice(head, b.length - tail);

  // LCS lengths of the suffixes, row by row (the middle is small: one write's region or two).
  const n = am.length;
  const m = bm.length;
  const lcs = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] = am[i] === bm[j] ? lcs[(i + 1) * (m + 1) + j + 1]! + 1 : Math.max(lcs[(i + 1) * (m + 1) + j]!, lcs[i * (m + 1) + j + 1]!);
    }
  }
  const ops: Op[] = [];
  for (let k = 0; k < head; k++) ops.push({ kind: " ", line: a[k]!, a: k, b: k });
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && am[i] === bm[j]) {
      ops.push({ kind: " ", line: am[i]!, a: head + i, b: head + j });
      i++;
      j++;
    } else if (i < n && (j === m || lcs[(i + 1) * (m + 1) + j]! >= lcs[i * (m + 1) + j + 1]!)) {
      // A removed line before the added one, as diff prints them.
      ops.push({ kind: "-", line: am[i]!, a: head + i, b: head + j });
      i++;
    } else {
      ops.push({ kind: "+", line: bm[j]!, a: head + i, b: head + j });
      j++;
    }
  }
  for (let k = 0; k < tail; k++) ops.push({ kind: " ", line: a[a.length - tail + k]!, a: a.length - tail + k, b: b.length - tail + k });
  return ops;
}

export function unifiedDiff(path: string, before: string | null, after: string, context = 3): string {
  const a = before === null ? [] : before.split("\n");
  const ops = align(a, after.split("\n"));
  const changed = ops.map((o, k) => (o.kind === " " ? -1 : k)).filter((k) => k >= 0);
  if (!changed.length) return "";

  // Group changes whose contexts touch into hunks.
  const hunks: [number, number][] = [];
  for (const k of changed) {
    const last = hunks.at(-1);
    if (last && k - last[1] <= 2 * context) last[1] = k;
    else hunks.push([k, k]);
  }
  const out = [`--- ${before === null ? "/dev/null" : `a/${path}`}`, `+++ b/${path}`];
  for (const [first, last] of hunks) {
    const from = Math.max(0, first - context);
    const to = Math.min(ops.length - 1, last + context);
    const span = ops.slice(from, to + 1);
    const aLen = span.filter((o) => o.kind !== "+").length;
    const bLen = span.filter((o) => o.kind !== "-").length;
    const aStart = aLen ? span.find((o) => o.kind !== "+")!.a + 1 : span[0]!.a;
    const bStart = bLen ? span.find((o) => o.kind !== "-")!.b + 1 : span[0]!.b;
    out.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`, ...span.map((o) => `${o.kind}${o.line}`));
  }
  return out.join("\n");
}

/** The lines a change adds — only its own, wherever they are (for the text rules). */
export function addedLines(before: string | null, after: string): string[] {
  return align(before === null ? [] : before.split("\n"), after.split("\n"))
    .filter((o) => o.kind === "+")
    .map((o) => o.line);
}
