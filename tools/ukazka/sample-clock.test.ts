// The order of time in the sample research (sample-clock.ts). Run: node --test tools/ukazka/sample-clock.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SampleClock, checkThenPack } from "./sample-clock.ts";

const NOW = Date.parse("2026-11-01T09:00:00.000Z");

/** The generator's way: at(minutes) sets the clock, each command moves it 1.5 minutes on (build-demo.ts). */
function replay(clock: SampleClock, plan: (number | "cmd")[], runMs = 800): number[] {
  let minutes = 0;
  const moments: number[] = [];
  for (const step of plan) {
    if (step !== "cmd") {
      minutes = step;
      continue;
    }
    const at = clock.next(minutes);
    moments.push(at);
    clock.ran(at, runMs);
    minutes = Math.max(minutes - 1.5, 0);
  }
  return moments;
}

test("R1: `task sent` at(34) after a session of ten commands from at(38) comes after the session, not before it", () => {
  const clock = new SampleClock(NOW);
  const moments = replay(clock, [38, ...Array<"cmd">(10).fill("cmd"), 34, "cmd", 30, "cmd", "cmd"]);
  for (let i = 1; i < moments.length; i++) assert.ok(moments[i]! > moments[i - 1]! + 800, `command ${i} at ${new Date(moments[i]!).toISOString()}`);
  // the session's last command ran at 24.5 minutes before now; `task sent` after its end, not at 34 minutes before
  assert.equal(moments[10], NOW - 24.5 * 60_000 + 800 + 1000);
  assert.equal(clock.moved, 3);
});

test("a command is never dated before the end of a slow one before it (3 s apart, one ran 5 s)", () => {
  const clock = new SampleClock(NOW);
  const a = clock.next(15.4);
  clock.ran(a, 5000);
  const b = clock.next(15.35);
  assert.equal(b, a + 6000);
});

test("moments in order stay as the generator set them", () => {
  const clock = new SampleClock(NOW);
  const moments = replay(clock, [120, "cmd", "cmd", 60, "cmd", 14, "cmd", 6, "cmd", 2, "cmd"]);
  assert.deepEqual(moments.map((m) => (NOW - m) / 60_000), [120, 118.5, 60, 14, 6, 2]);
  assert.equal(clock.moved, 0);
});

test("the build packs only a research strom checks: check first, its error stops the pack", () => {
  const calls: string[] = [];
  checkThenPack((...a) => calls.push(a.join(" ")), "out.zip");
  assert.deepEqual(calls, ["check", "pack --out out.zip"]);

  const refused: string[] = [];
  const strom = (...a: string[]) => {
    refused.push(a[0]!);
    if (a[0] === "check") throw new Error("strom check → 1: record was edited outside strom");
  };
  assert.throws(() => checkThenPack(strom, "out.zip"), /edited outside strom/);
  assert.deepEqual(refused, ["check"]);
});
