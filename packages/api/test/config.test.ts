import { describe, expect, test } from "bun:test";
import { loadConfig, parseTokens } from "../src/config.ts";

const base = { SPECS_BOT_HOST: "192.168.1.15", SPECS_BOT_PORT: "7165", SPECS_DATA_PATH: "/srv/specs-data" };

describe("loadConfig", () => {
  test("reads host, port, data path and tokens", () => {
    const c = loadConfig({ ...base, SPECS_BOT_TOKENS: "machine-1=aaa,machine-2=bbb" });
    expect(c.host).toBe("192.168.1.15");
    expect(c.port).toBe(7165);
    expect(c.tokens.get("bbb")).toBe("machine-2");
  });

  test("names every missing variable", () => {
    expect(() => loadConfig({})).toThrow("SPECS_BOT_HOST, SPECS_BOT_PORT, SPECS_DATA_PATH");
  });

  test("refuses a port that is not one", () => {
    expect(() => loadConfig({ ...base, SPECS_BOT_PORT: "71x" })).toThrow("not a port");
  });
});

describe("parseTokens", () => {
  test("empty means no tokens", () => {
    expect(parseTokens("").size).toBe(0);
  });

  test("refuses an entry without machine=token", () => {
    expect(() => parseTokens("aaa")).toThrow("not machine=token");
  });

  test("refuses a repeated token", () => {
    expect(() => parseTokens("machine-1=aaa,machine-2=aaa")).toThrow("repeats a token");
  });
});
