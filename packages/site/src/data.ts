// The site renders core's read model; the api loads it once and hands it over (PLAN.md § 2).
import { loadModel, type Model } from "@specs-bot/core";

export type SiteData = Model;

export type Loaded = { ok: true; data: SiteData } | { ok: false; error: string };

export function loadSiteData(dataPath: string): Loaded {
  try {
    return { ok: true, data: loadModel(dataPath) };
  } catch (e) {
    // The message may name a file under the data path; the pages show only that loading failed.
    console.error(`specs-bot: data not loaded: ${(e as Error).message}`);
    return { ok: false, error: "the specs could not be read" };
  }
}
