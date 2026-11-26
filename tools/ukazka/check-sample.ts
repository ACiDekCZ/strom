// Checks a sample build (build-demo.ts with SHOWCASE_SAMPLE=1) before anything is made of it:
//   node check-sample.ts <outdir>        (the folder build-demo.ts wrote: env.json, tree.txt, sample.json)
// - its moment: sample.json, every time in the research's records, its export, its git history and the times of the
//   files in the shared inbox at or before it;
// - nobody at work: no worker of strom, no worker.pid, every session closed;
// - no costs: no costUsd, no metrics of a session;
// - the data as strom wrote it: git status clean.
// Also lists (without failing) what the published file must not carry and S2 removes: paths of this computer.
// Exit 1 when a check fails.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const dir = path.resolve(process.argv[2] ?? "");
/** What failed, by kind (time, worker, cost, session, git…). */
const failed = new Map<string, string[]>();
const fail = { push: (kind: string, what: string) => failed.set(kind, [...(failed.get(kind) ?? []), what]) };
const note: string[] = [];
const meta = JSON.parse(fs.readFileSync(path.join(dir, "sample.json"), "utf8")) as { asOf: string; lang: string; sample: boolean };
if (!meta.sample) fail.push("build", "sample.json: not a sample build (SHOWCASE_SAMPLE=1)");
const asOf = Date.parse(meta.asOf);
const tree = fs.readFileSync(path.join(dir, "tree.txt"), "utf8").trim();
const env = JSON.parse(fs.readFileSync(path.join(dir, "env.json"), "utf8")) as Record<string, string>;

/** Every file of the research (its git folder aside). */
function files(root: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.name === ".git") continue;
    const p = path.join(root, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}
const TEXT = /\.(json|jsonl|ged|md|txt|yaml|yml)$/i;
const ISO = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))/g;
let times = 0;
for (const f of files(tree)) {
  const rel = path.relative(tree, f);
  if (!TEXT.test(f)) continue;
  // a bridge's own record of its runs (started, ended at its clock): never part of a sample
  if (/^\.strom[\\/]live(-last)?\.json$/.test(rel)) continue;
  const s = fs.readFileSync(f, "utf8");
  for (const m of s.matchAll(ISO)) {
    times++;
    if (Date.parse(m[1]!) > asOf) fail.push("time", `${rel}: ${m[1]} after ${meta.asOf}`);
  }
  if (/costUsd/.test(s)) fail.push("cost", `${rel}: costUsd`);
  if (rel.startsWith(`data${path.sep}sessions${path.sep}`)) {
    const rec = JSON.parse(s) as { state?: string; metrics?: unknown };
    if (rec.state !== "closed") fail.push("session", `${rel}: session ${rec.state}`);
    if (rec.metrics) fail.push("cost", `${rel}: metrics`);
  }
  if (s.includes(dir)) note.push(`${rel}: a path of the build (${dir})`);
}
const workers = path.join(tree, ".strom", "workers");
if (fs.existsSync(workers) && fs.readdirSync(workers).some((f) => f.endsWith(".json"))) fail.push("worker", ".strom/workers: a worker present");
if (fs.existsSync(path.join(dir, "worker.pid"))) fail.push("worker", "worker.pid present");
// strom reads the times of the shared inbox's folders and files (one changed lately is still being saved)
const inbox = path.join(env.HOME ?? "", "Documents", "Strom", "shared", "inbox");
/** Every folder below one, itself included. */
function folders(root: string): string[] {
  return [root, ...fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((e) => folders(path.join(root, e.name)))];
}
if (fs.existsSync(inbox)) for (const f of [...folders(inbox), ...files(inbox)]) {
  const at = fs.statSync(f).mtimeMs;
  if (at > asOf) fail.push("time", `${path.relative(inbox, f)}: saved ${new Date(at).toISOString()} after ${meta.asOf}`);
}

const git = (...a: string[]) => spawnSync("git", a, { cwd: tree, env: { ...process.env, ...env }, encoding: "utf8" }).stdout;
const commits = git("log", "--all", "--format=%H %aI %cI").trim().split("\n").filter(Boolean);
for (const c of commits) {
  const [h, a, cm] = c.split(" ");
  if (Date.parse(a!) > asOf || Date.parse(cm!) > asOf) fail.push("time", `commit ${h!.slice(0, 8)}: ${a} / ${cm} after ${meta.asOf}`);
}
const dirty = git("status", "--porcelain").trim();
if (dirty) fail.push("git", `git status not clean:\n${dirty}`);

console.log(`sample ${meta.lang} at ${meta.asOf}: ${commits.length} commits, ${times} times in the records`);
for (const n of note.slice(0, 20)) console.log(`note: ${n}`);
if (note.length > 20) console.log(`note: … ${note.length - 20} more`);
let count = 0;
for (const [kind, all] of failed) {
  count += all.length;
  for (const f of all.slice(0, 5)) console.log(`FAIL ${kind}: ${f}`);
  if (all.length > 5) console.log(`FAIL ${kind}: … ${all.length - 5} more`);
}
console.log(count ? `check-sample: ${count} failed (${[...failed.keys()].join(", ")})` : "check-sample: ok");
process.exit(count ? 1 : 0);
