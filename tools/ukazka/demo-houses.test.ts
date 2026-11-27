// The houses of the demo research (demo-houses.ts): what the generator asks the research to write, in each language.
// Run: node --test tools/ukazka/demo-houses.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { addHouses, HOUSE_MILL, PICTURES_BASE, PICTURES_DIR, millName, type HousesLang } from "./demo-houses.ts";

const LANGS: HousesLang[] = ["cs", "en", "de", "pl"];

/** addHouses run against a research that only records: each command as the person or as the agent. */
function run(lang: HousesLang, consent: boolean, home: [number, number] = [49.5, -2.5255]) {
  const calls: { as: "person" | "agent"; args: string[] }[] = [];
  const times: number[] = [];
  const any = new Proxy({}, { get: (_t, k) => (typeof k === "string" ? `X_${k}` : undefined) }) as Record<string, string>;
  const names = new Proxy({}, { get: (_t, k) => (typeof k === "string" ? [`/${k}/`, `Name ${k}`] : undefined) }) as Record<string, [string, string]>;
  const answer = (args: string[]) => (args[0] === "house" && args[1] === "request" ? { status: "ok", data: { task: "T0100", town: "T0099" } } : { status: "ok", data: {} });
  addHouses({
    lang, consent, home, from: 15.48,
    strom: (...args) => { calls.push({ as: "person", args }); return answer(args) as never; },
    agent: (...args) => { calls.push({ as: "agent", args }); return answer(args) as never; },
    at: (m) => { times.push(m); },
    P: any, n: names, d: { place: "Village", place2: "Other" },
  });
  return { calls, times };
}

for (const lang of LANGS) {
  test(`${lang}: without consent nothing is asked in the person's name (ZAKLAD §6)`, () => {
    const { calls } = run(lang, false);
    // only reading as the person (house list), nothing written in their name
    assert.deepEqual(calls.filter((c) => c.as === "person" && !["list", "show"].includes(c.args[1]!)), []);
    assert.ok(!calls.some((c) => c.args.includes("--yes") || c.args.includes("request")));
    // the mill's history is still written, as the research's
    assert.ok(calls.some((c) => c.args.slice(0, 3).join(" ") === "house add holder"));
  });

  test(`${lang}: with consent the mill is asked for once and its two tasks are done in sessions`, () => {
    const { calls } = run(lang, true);
    const req = calls.filter((c) => c.args[0] === "house" && c.args[1] === "request");
    assert.deepEqual(req.map((c) => [c.as, c.args.at(-2), c.args.at(-1)]), [["person", HOUSE_MILL, "--yes"], ["person", "5", "--yes"]]);
    const done = calls.filter((c) => c.args[0] === "task" && c.args[1] === "done").map((c) => c.args[2]);
    assert.deepEqual(done, ["T0099", "T0100"]);
    assert.equal(calls.filter((c) => c.args[0] === "session" && c.args[1] === "start").length, 2);
  });

  test(`${lang}: a negative coordinate is the option's value, not an option`, () => {
    const { calls } = run(lang, false);
    const loc = calls.find((c) => c.args.slice(0, 3).join(" ") === "house add location")!;
    assert.ok(loc.args.includes("--lon=-2.5255") && loc.args.includes("--lat=49.5"), loc.args.join(" "));
    assert.ok(!loc.args.some((a) => /^-\d/.test(a)), loc.args.join(" "));
  });

  test(`${lang}: every text is written, the pictures exist, one field name is the mill's`, () => {
    const { calls, times } = run(lang, true);
    for (const c of calls) for (const a of c.args) assert.ok(a !== "" && !a.includes("undefined"), `${c.args.join(" ")}`);
    const pics = calls.flatMap((c) => c.args.filter((a) => a.startsWith(PICTURES_BASE)));
    assert.ok(pics.length >= 2);
    for (const url of pics) assert.ok(fs.existsSync(path.join(PICTURES_DIR, path.basename(url))), url);
    const fields = calls.filter((c) => c.args.slice(0, 3).join(" ") === "house add field-name");
    assert.equal(fields.length, 3);
    assert.equal(fields.filter((c) => c.args.includes("--house") && c.args.at(-1) === HOUSE_MILL).length, 1);
    assert.ok(millName(lang).length > 0);
    // the research's clock only goes on: each command after the one before
    for (let i = 1; i < times.length; i++) assert.ok(times[i]! < times[i - 1]!, `command ${i}`);
  });
}
