// GFM table rows. A cell boundary is every `|` not escaped with `\` — code spans do not protect a pipe in GFM,
// so a row whose text holds a bare `|` renders broken on GitHub too; callers anchor on the cells they know.

/** The raw cells of `| a | b |`, surrounding spaces kept, so that `joinRow(splitRow(l)) === l`. */
export function splitRow(line: string): string[] {
  if (!line.startsWith("|") || !line.endsWith("|")) {
    throw new Error(`not a table row: ${line.slice(0, 60)}`);
  }
  return line.slice(1, -1).split(/(?<!\\)\|/);
}

export function joinRow(cells: readonly string[]): string {
  return `|${cells.join("|")}|`;
}

export function isRow(line: string): boolean {
  return line.startsWith("|") && line.endsWith("|") && line.length > 1;
}
