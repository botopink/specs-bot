import { expect, test } from "bun:test";
import { markerIndex } from "../src/index.ts";

test("the marker index and the gap rows are read apart", () => {
  const r = markerIndex(`# Gaps

## Tables

| Gap | Note |
|---|---|
| **No name for a derived type** | x |

## Marker index

| File | Markers | Rows |
|---|---|---|
| \`specs/1.0.12-beta/m/x.bp\` | 2 | **No name for a derived type** · **Gone** |
`);
  expect(r.hasIndex).toBe(true);
  expect(r.rows).toEqual([{ path: "specs/1.0.12-beta/m/x.bp", count: 2, gaps: ["No name for a derived type", "Gone"] }]);
  expect([...r.gapTitles]).toEqual(["No name for a derived type"]);
});
