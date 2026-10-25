// Who is asking: `Authorization: Bearer <token>` names a party from SPECS_BOT_TOKENS (PLAN.md § 3, layer 4).
// Reads are open on the private network; a write needs a party (phase 3).
import type { MiddlewareHandler } from "hono";

export type Vars = { party: string | undefined };

export function identify(tokens: Map<string, string>): MiddlewareHandler<{ Variables: Vars }> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (token !== undefined && !tokens.has(token)) {
      return c.json({ error: "unknown token", hint: "check SPECS_BOT_TOKEN in the projects .env.local" }, 401);
    }
    c.set("party", token ? tokens.get(token) : undefined);
    await next();
  };
}
