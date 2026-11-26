// The order of time in the sample research (spec 143): strom checks a research by its operations ordered by their
// time across all its logs, so a write dated before one already made reads as a record "edited outside strom" (found
// in R1: `task sent` at 08:26 after a session's `task wait` at 08:35 — strom unpack and strom demo refused the
// package). Used by build-demo.ts (each command's moment) and build-ukazka.ts (strom check before strom pack).

/**
 * The clock of the sample's strom commands: each command at its moment of the demo (minutes before the sample's
 * "now"), but never before the end of the command before it — strom's own clock (fixed-clock.cjs) runs on from a
 * command's start, so everything a command wrote lies between its start and its start plus the real time it took.
 */
export class SampleClock {
  /** The end of the last command on the demo's clock (ms). */
  private last = Number.NEGATIVE_INFINITY;
  /** How many commands came later than their moment (said by the build). */
  moved = 0;

  /** The sample's "now" (ms). */
  readonly now: number;
  /** The least time between the end of one command and the start of the next (ms). */
  readonly gapMs: number;

  constructor(now: number, gapMs = 1000) {
    this.now = now;
    this.gapMs = gapMs;
  }

  /** The moment of the next command, `minutesAgo` minutes before now — or just after the last command's end. */
  next(minutesAgo: number): number {
    const want = this.now - minutesAgo * 60_000;
    if (want > this.last) return want;
    this.moved++;
    return this.last + this.gapMs;
  }

  /** A command started at `at` ran `ms` of real time: what it wrote lies before `at + ms`. */
  ran(at: number, ms: number): void {
    this.last = Math.max(this.last, at + Math.max(0, ms));
  }
}

/**
 * The research packed for `strom demo` only when strom finds it whole: `strom check` first (an error ends the build),
 * then `strom pack`. `strom` throws on a command that fails (exit other than 0).
 */
export function checkThenPack(strom: (...args: string[]) => unknown, out: string): void {
  strom("check");
  strom("pack", "--out", out);
}
