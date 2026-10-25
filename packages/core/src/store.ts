// Everything the bot knows, read once from the specs-data repository. Only the api process calls this.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ChatMessage, loadChat } from "./chat/chat.ts";
import { type PendingDoc, parsePending } from "./decisions/pending.ts";
import { type RetiredDoc, parseRetired } from "./decisions/retired.ts";
import { type StepsDoc, parseSteps } from "./decisions/steps.ts";
import { type TakenDoc, parseTaken } from "./decisions/taken.ts";
import { type DocTree, loadDocs } from "./docs/load.ts";

export interface Store {
  /** Absolute path of <data>/specs — kept inside the server, never sent out. */
  specsDir: string;
  steps: StepsDoc;
  pending: PendingDoc;
  pendingPt?: PendingDoc;
  taken: TakenDoc;
  retired: RetiredDoc;
  tree: DocTree;
  chat: ChatMessage[];
}

export function loadStore(dataPath: string): Store {
  const specsDir = join(dataPath, "specs");
  const read = (name: string) => readFileSync(join(specsDir, name), "utf8");
  const pt = join(specsDir, "decisoes-pendentes.md");
  const chatDir = join(dataPath, "conversation-chat");
  return {
    specsDir,
    steps: parseSteps(read("decisions-taken-steps.md")),
    pending: parsePending(read("decisions-pending.md")),
    ...(existsSync(pt) ? { pendingPt: parsePending(read("decisoes-pendentes.md")) } : {}),
    taken: parseTaken(read("decisions-taken.md")),
    retired: parseRetired(read("retired.md")),
    tree: loadDocs(specsDir),
    chat: existsSync(chatDir) ? loadChat(chatDir) : [],
  };
}
