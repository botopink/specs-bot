// After a write lands, the host pushes specs-data to its remote (PLAN.md § 3, layer 5): in the background, one
// push at a time, coalescing writes that arrive while one runs; a failure is kept for /api/health and retried
// with the next write or after a minute. Only the host pushes, with its own key.
import { git } from "@specs-bot/core";

export interface PushState {
  enabled: boolean;
  /** Commits on the branch the remote does not have yet (-1 when unknown). */
  ahead: number;
  lastPushAt?: string;
  lastError?: string;
}

export class Pusher {
  #running: Promise<void> | undefined;
  #again = false;
  #retry: ReturnType<typeof setTimeout> | undefined;
  state: PushState;

  constructor(
    readonly dataPath: string,
    readonly opts: { enabled: boolean; remote?: string; branch?: string; sshKey?: string },
  ) {
    this.state = { enabled: opts.enabled, ahead: -1 };
  }

  #env(): Record<string, string> {
    return this.opts.sshKey ? { GIT_SSH_COMMAND: `ssh -i ${this.opts.sshKey} -o IdentitiesOnly=yes -o BatchMode=yes` } : {};
  }

  /** Ask for a push; returns when the push this request joined has run. */
  request(): Promise<void> {
    if (!this.opts.enabled) return Promise.resolve();
    if (this.#running) {
      this.#again = true;
      return this.#running;
    }
    this.#running = this.#loop().finally(() => (this.#running = undefined));
    return this.#running;
  }

  async #loop(): Promise<void> {
    do {
      this.#again = false;
      const remote = this.opts.remote ?? "origin";
      const branch = this.opts.branch ?? "main";
      try {
        await git(this.dataPath, ["push", "--quiet", remote, `HEAD:refs/heads/${branch}`], this.#env());
        this.state = { enabled: true, ahead: 0, lastPushAt: new Date().toISOString() };
      } catch (e) {
        const ahead = await git(this.dataPath, ["rev-list", "--count", `${remote}/${branch}..HEAD`]).then(Number, () => -1);
        this.state = { ...this.state, ahead, lastError: (e as Error).message };
        console.error(`specs-bot: push failed (${ahead} commits waiting): ${(e as Error).message}`);
        clearTimeout(this.#retry);
        this.#retry = setTimeout(() => void this.request(), 60_000);
      }
    } while (this.#again);
  }
}
