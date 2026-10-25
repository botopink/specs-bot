import { expect, test } from "bun:test";
import { SPECS_DIR } from "../src/index.ts";

test("core exports the specs directory name", () => {
  expect(SPECS_DIR).toBe("specs");
});
