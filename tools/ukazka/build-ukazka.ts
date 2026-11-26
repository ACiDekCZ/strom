// Builds the showcase files (spec 143, format `strom-showcase` 1) of the invented demo research, one per language:
//
//   node build-ukazka.ts <outdir> [cs en de pl]
//
// For each language:
//   1. the sample research (build-demo.ts with SHOWCASE_SAMPLE=1 SHOWCASE_LINES=1), checked by check-sample.ts;
//   2. its bridge started at the sample's moment (STROM_SAMPLE_CLOCK): status, log, material, the whole queue (pages
//      of 100) and tree.ged?media=app taken, the bridge stopped; the research must not have changed (HEAD, git status);
//   3. the bridge's answers cleaned for a public file (no address or secret of the bridge, no amounts, nobody at work,
//      no path or setting of the computer that built it), the header put first;
//   4. the file checked (size, header, the research's id, nothing of the bridge or the computer, no time after the
//      moment) — any failure ends the build with exit 1;
//   5. the research checked by strom (strom check: an error ends the build) and packed for `strom demo` (strom pack);
//      the package must not name the computer that built it (no /Users/…, no build folder, in its files or history).
//
// <outdir>/<lang>/strom-ukazka-<lang>.json         the file the app opens (served at /demo/<lang>/ on the web)
// <outdir>/<lang>/strom-ukazka-<lang>.json.sha256  its SHA-256 (hex, one line)
// <outdir>/<lang>/VERSION                          the sample's version (one line)
// <outdir>/<lang>/strom-ukazka-<lang>-<version>.strom (+ .sha256)  the research packed (strom pack, a ZIP) for strom demo
// <outdir>/work/<lang>/                            the sample research the files were made of (build-demo.ts)
// <outdir>/sizes.json                              the sizes of the files
//
// STROM_CLI names strom-research's sources (as for build-demo.ts); their package.json gives `researchVersion`, this
// repository's package.json `appVersion` and `sampleVersion`. Run it isolated: the demo has its own HOME and strom
// config under <outdir>/work, and no network (no-net.cjs).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SAMPLE_AS_OF, SAMPLE_LANGS, sampleExportId, sampleTreeId, type SampleLang } from "./sample.ts";
import { checkThenPack } from "./sample-clock.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const args = process.argv.slice(2);
if (!args[0] || args[0].startsWith("-")) {
  console.error("usage: node build-ukazka.ts <outdir> [cs en de pl]");
  process.exit(2);
}
const out = path.resolve(args[0]);
const langs = (args.length > 1 ? args.slice(1) : [...SAMPLE_LANGS]) as SampleLang[];
for (const l of langs) if (!(SAMPLE_LANGS as readonly string[]).includes(l)) throw new Error(`not a sample language: ${l}`);
const cli = process.env.STROM_CLI ?? path.join(os.homedir(), "Projects/strom-research/src/cli.ts");
if (!fs.existsSync(cli)) throw new Error(`STROM_CLI: no ${cli}`);
/** The nearest package.json above a file. */
function packageOf(from: string): { version: string } {
  for (let d = path.dirname(from); d !== path.dirname(d); d = path.dirname(d)) {
    const p = path.join(d, "package.json");
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")) as { version: string };
  }
  throw new Error(`no package.json above ${from}`);
}
const appVersion = packageOf(path.join(repo, "x")).version;
const researchVersion = packageOf(cli).version;
const sampleVersion = appVersion;
/** A file over this is a failed build (format §1). */
const MAX_BYTES = 20 * 1024 * 1024;

type J = Record<string, unknown>;
const DATA = (await import(path.join(here, "demo-data.ts"))).default as Record<SampleLang, import("./demo-data.ts").Demo>;

function run(what: string, cmd: string, argv: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string {
  const r = spawnSync(cmd, argv, { cwd: opts.cwd ?? repo, env: opts.env ?? process.env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${what} → ${r.status}\n${(r.stdout ?? "").slice(-2000)}\n${(r.stderr ?? "").slice(-4000)}`);
  return r.stdout;
}

const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");

/** One bridge answer (JSON or text), asked again while the bridge is still working it out (202, 503). */
async function ask(url: string, as: "json" | "text"): Promise<J | string> {
  for (let i = 0; ; i++) {
    const r = await fetch(url);
    if (r.ok && r.status !== 202) return as === "json" ? ((await r.json()) as J) : await r.text();
    if ((r.status === 202 || r.status === 503) && i < 120) {
      await new Promise((ok) => setTimeout(ok, 500));
      continue;
    }
    throw new Error(`GET ${url.replace(/\/\/[^/]+\/[^/?]+/, "//<bridge>")} → ${r.status} ${(await r.text()).slice(0, 300)}`);
  }
}

/** Every key of a value, nested (for the checks). */
function* keysOf(v: unknown): Generator<string> {
  if (Array.isArray(v)) for (const x of v) yield* keysOf(x);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
    yield k;
    yield* keysOf(x);
  }
}

/** A value without the keys named (amounts, a session's measurements), at any depth. */
function without<T>(v: T, keys: ReadonlySet<string>): T {
  if (Array.isArray(v)) return v.map((x) => without(x, keys)) as T;
  if (v && typeof v === "object") {
    const o: J = {};
    for (const [k, x] of Object.entries(v)) if (!keys.has(k)) o[k] = without(x, keys);
    return o as T;
  }
  return v;
}

/** The parts of /status that say something of the computer, the person or the bridge (format §4, B). */
const STATUS_NULL = ["path", "treesRoot", "accepts", "spend", "phone", "update", "channel", "seal", "sends", "inbox", "batches"];
/** Parts of /status left out whole: the bridge's own settings and life. */
const STATUS_DROP = ["live"];
/** Keys never in the file (amounts, a session's measurements). */
const NO_KEYS = new Set(["costUsd", "metrics"]);

/** A value with every string's mention of a folder put as the person reads it: the demo's HOME as `~`. */
function homeAsTilde<T>(v: T, home: string): T {
  if (typeof v === "string") return v.split(home).join("~") as T;
  if (Array.isArray(v)) return v.map((x) => homeAsTilde(x, home)) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, homeAsTilde(x, home)])) as T;
  return v;
}

/** The status as the published file carries it. */
function cleanStatus(status: J): J {
  const s: J = without(status, NO_KEYS);
  for (const k of STATUS_DROP) delete s[k];
  for (const k of STATUS_NULL) if (k in s) s[k] = null;
  s.working = [];
  if ("runs" in s) s.runs = [];
  // a research link keeps its place but never the bridge's secret
  if (Array.isArray(s.links)) {
    s.links = (s.links as unknown[]).map((l) => (typeof l === "string" ? l.replace(/([?&])(token|secret|key)=[^&]*/g, "$1").replace(/[?&]$/, "") : l));
  }
  return s;
}

const MONTHS: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
/**
 * Hosts a public file may name: the invented archives (example.org, the reserved .example), the project's own pages,
 * the agent's browser extension and the public map layers the research offers for houses (status.houses.layers:
 * ČÚZK, the 1950s aerial images of CENIA).
 */
const HOSTS = /^(?:[a-z0-9-]+\.)*(?:example\.org|example|stromapp\.info|chromewebstore\.google\.com|github\.com|cuzk\.gov\.cz|cenia\.cz)$/i;

/** What fails in a built file (format §5); empty when it is fine. */
function check(lang: SampleLang, text: string, secrets: string[], asOf: string): { failed: string[]; notes: string[] } {
  const failed: string[] = [];
  const notes: string[] = [];
  const bytes = Buffer.byteLength(text);
  if (bytes > MAX_BYTES) failed.push(`size ${bytes} B over ${MAX_BYTES} B`);
  if (text.charCodeAt(0) === 0xfeff) failed.push("a BOM");
  if (!text.startsWith('{"kind":"strom-showcase"')) failed.push("the header is not first");
  let f: J;
  try {
    f = JSON.parse(text) as J;
  } catch (e) {
    return { failed: [...failed, `not JSON: ${(e as Error).message}`], notes };
  }
  if (f.kind !== "strom-showcase") failed.push(`kind ${String(f.kind)}`);
  if (f.format !== 1) failed.push(`format ${String(f.format)}`);
  if (f.lang !== lang) failed.push(`lang ${String(f.lang)}`);
  if (f.exportId !== sampleExportId(lang)) failed.push(`exportId ${String(f.exportId)}`);
  if (f.sizeBytes !== bytes) failed.push(`sizeBytes ${String(f.sizeBytes)} ≠ ${bytes}`);
  if (f.asOf !== asOf) failed.push(`asOf ${String(f.asOf)}`);
  for (const k of ["sampleVersion", "appVersion", "researchVersion", "name", "family"]) if (typeof f[k] !== "string" || !f[k]) failed.push(`no ${k}`);
  const tree = f.tree as { format?: string; text?: string } | undefined;
  const ged = tree?.text ?? "";
  if (tree?.format !== "ged" || !/^0 HEAD\b/.test(ged)) failed.push("tree: not a GEDCOM");
  const treeId = /^1 _STROM_TREE (\S+)/m.exec(ged)?.[1];
  const research = f.research as J | null;
  if (!research) failed.push("no research");
  else {
    if (research.id !== treeId) failed.push(`research.id ${String(research.id)} ≠ _STROM_TREE ${treeId}`);
    if (research.id !== sampleTreeId(lang)) failed.push(`research.id ${String(research.id)} is not the sample's fixed id ${sampleTreeId(lang)}`);
    const st = research.status as J | null;
    const stId = (st?.tree as J | undefined)?.id;
    if (stId !== undefined && stId !== research.id) failed.push(`status.tree.id ${String(stId)} ≠ research.id`);
    for (const k of ["status", "log", "material", "queue"]) if (!research[k] || typeof research[k] !== "object") failed.push(`research.${k} missing`);
    if (st) {
      if (st.spend !== null) failed.push("status.spend not null");
      if (st.accepts !== null) failed.push("status.accepts not null");
      if (!Array.isArray(st.working) || st.working.length) failed.push("status.working not []");
      if ("live" in st) failed.push("status.live present");
    }
  }
  // nothing of the bridge or of the computer
  for (const [what, needle] of [["127.0.0.1", "127.0.0.1"], ["localhost", "localhost"], ["costUsd", "costUsd"], ["/Users/", "/Users/"], ["/home/", "/home/"], ["/private/", "/private/"], ["C:\\", "C:\\\\"], [os.homedir(), os.homedir()], ...secrets.map((s) => ["a secret of the bridge", s] as const)] as const) {
    if (needle && text.includes(needle)) failed.push(`${what} in the file (${text.split(needle).length - 1}×)`);
  }
  for (const k of new Set(keysOf(f))) if (NO_KEYS.has(k)) failed.push(`key ${k}`);
  // no time after the moment: ISO times anywhere, GEDCOM dates of the last years (a change's date)
  const limit = Date.parse(asOf);
  let times = 0;
  for (const m of text.matchAll(/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)/g)) {
    times++;
    const t = Date.parse(m[1]!);
    if (Number.isFinite(t) && t > limit) failed.push(`time ${m[1]} after ${asOf}`);
  }
  for (const m of ged.matchAll(/\b(\d{1,2}) (JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) (\d{4})\b/g)) {
    const t = Date.UTC(Number(m[3]), MONTHS[m[2]!]!, Number(m[1]));
    if (t > limit) failed.push(`GEDCOM date ${m[0]} after ${asOf}`);
  }
  // only the invented hosts and the project's own pages; e-mails only of example.org
  const hosts = new Set<string>();
  for (const m of text.matchAll(/\bhttps?:\/\/([a-z0-9.-]+)/gi)) hosts.add(m[1]!.toLowerCase());
  for (const h of hosts) if (!HOSTS.test(h)) failed.push(`host ${h}`);
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g)) if (!/(^|\.)example\.org$/i.test(m[1]!)) failed.push(`e-mail at ${m[1]}`);
  // images only of the kinds the app keeps (ged-parser SAFE_*_DATA_URL)
  const kinds = new Map<string, number>();
  for (const m of text.matchAll(/data:([a-z]+\/[a-z0-9.+-]+)[;,]/gi)) kinds.set(m[1]!, (kinds.get(m[1]!) ?? 0) + 1);
  for (const k of kinds.keys()) if (!/^image\/(jpeg|png|webp)$/.test(k)) failed.push(`data URL of ${k}`);
  notes.push(`${times} times, hosts: ${[...hosts].sort().join(", ") || "none"}, images: ${[...kinds].map(([k, n]) => `${n}× ${k}`).join(", ") || "none"}`);
  return { failed: [...new Set(failed)], notes };
}

/** Where a package (strom pack, a ZIP) names a folder of a computer: its files outside .git, and its history. */
function machinePaths(pack: string, folders: string[]): string[] {
  const marks = [...new Set([...folders, "/Users/", "C:\\Users\\", "C:/Users/"])];
  const x = fs.mkdtempSync(path.join(os.tmpdir(), "ukazka-pack-"));
  try {
    run("unzip", "unzip", ["-q", pack, "-d", x]);
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === ".git") {
            const log = run(`git log -p ${path.relative(x, dir)}`, "git", ["log", "-p", "--all", "--format=%H %an %ae%n%B"], { cwd: dir, env: { ...process.env, GIT_DIR: p } });
            for (const m of marks) if (log.includes(m)) found.push(`history of ${path.relative(x, dir) || "."}: ${m}`);
          } else walk(p);
        } else if (e.isFile()) {
          const text = fs.readFileSync(p, "latin1");
          for (const m of marks) if (text.includes(m)) found.push(`${path.relative(x, p)}: ${m}`);
        }
      }
    };
    walk(x);
    return found;
  } finally {
    fs.rmSync(x, { recursive: true, force: true });
  }
}

/** The sizes of everything built (sizes.json). */
const sizes: Record<string, { file: number; pack: number }> = {};

async function build(lang: SampleLang): Promise<void> {
  const t0 = Date.now();
  const work = path.join(out, "work", lang);
  const dest = path.join(out, lang);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const buildEnv = { ...process.env, STROM_CLI: cli, SHOWCASE_SAMPLE: "1", SHOWCASE_LINES: "1", SHOWCASE_NOW: "", SHOWCASE_323: "", SHOWCASE_QUERY: "", SHOWCASE_SEALED: "" };
  run(`build-demo ${lang}`, process.execPath, [path.join(here, "build-demo.ts"), lang, work], { env: buildEnv });
  console.log(run(`check-sample ${lang}`, process.execPath, [path.join(here, "check-sample.ts"), work]).trim().split("\n").pop());

  const meta = JSON.parse(fs.readFileSync(path.join(work, "sample.json"), "utf8")) as { asOf: string; lang: string; treeId?: string };
  if (meta.asOf !== SAMPLE_AS_OF && !process.env.SHOWCASE_NOW) throw new Error(`sample.json: asOf ${meta.asOf}`);
  const env = JSON.parse(fs.readFileSync(path.join(work, "env.json"), "utf8")) as Record<string, string>;
  const treeDir = fs.readFileSync(path.join(work, "tree.txt"), "utf8").trim();
  const strom = (...a: string[]) => {
    const stdout = run(`strom ${a.join(" ")}`, process.execPath, [cli, ...a, "--json"], {
      cwd: treeDir,
      env: { ...env, STROM_NONINTERACTIVE: "1", STROM_SAMPLE_CLOCK: meta.asOf },
    });
    return JSON.parse(stdout) as J;
  };
  const git = (...a: string[]) => run(`git ${a.join(" ")}`, "git", a, { cwd: treeDir, env: { ...process.env, ...env } }).trim();
  const head = git("rev-parse", "HEAD");

  // 2. the bridge's answers at the sample's moment
  const started = strom("live", "start");
  const data = (started.data ?? started) as J;
  const base = String(data.url ?? "").replace(/\/+$/, "");
  if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\/[^/]+$/.test(base)) throw new Error(`live start: no bridge address in ${JSON.stringify(started).slice(0, 400)}`);
  const token = base.split("/").pop()!;
  const port = new URL(base).port;
  let status: J, log: J, material: J, queue: J, ged: string;
  try {
    status = (await ask(`${base}/status`, "json")) as J;
    log = (await ask(`${base}/log`, "json")) as J;
    material = (await ask(`${base}/material`, "json")) as J;
    // the whole queue as one body: the bridge gives at most 100 a page (format A)
    const first = (await ask(`${base}/queue?from=0&count=100`, "json")) as J & { items?: unknown[]; next?: number };
    const items = [...(first.items ?? [])];
    for (let next = first.next; typeof next === "number"; ) {
      const page = (await ask(`${base}/queue?from=${next}&count=100`, "json")) as J & { items?: unknown[]; next?: number };
      items.push(...(page.items ?? []));
      next = page.next;
    }
    queue = { ...first, items, from: 0 };
    delete queue.next;
    if (typeof first.total === "number" && items.length !== first.total) throw new Error(`queue: ${items.length} items of ${first.total}`);
    // the tree with its images in it, as the app imports it (src/research-link.ts: tree.ged, media=app; no images=ref)
    ged = (await ask(`${base}/tree.ged?media=app`, "text")) as string;
  } finally {
    strom("live", "stop");
  }
  if (git("rev-parse", "HEAD") !== head) throw new Error("the bridge changed the research (HEAD moved)");
  if (git("status", "--porcelain")) throw new Error(`the bridge changed the research:\n${git("status", "--porcelain")}`);

  // 3. the file
  const treeId = /^1 _STROM_TREE (\S+)/m.exec(ged)?.[1];
  if (!treeId) throw new Error("tree.ged: no _STROM_TREE");
  const d = DATA[lang];
  // the folders a waiting task names (the shared inbox's: waiting[].inbox.dir) as in the person's home, not the build's
  const research = homeAsTilde({
    id: treeId,
    status: cleanStatus(status),
    log: without(log, NO_KEYS),
    material: without(material, NO_KEYS),
    queue: without(queue, NO_KEYS),
  }, env.HOME!);
  const header = {
    kind: "strom-showcase",
    format: 1,
    lang,
    exportId: sampleExportId(lang),
    sampleVersion,
    appVersion,
    researchVersion,
    asOf: meta.asOf,
    name: d.sampleName,
    family: d.surname,
    sizeBytes: 0,
  };
  const body = { tree: { format: "ged", text: ged }, research };
  // the size is part of the file: written until it says its own
  let text = "";
  for (let i = 0; i < 5; i++) {
    text = JSON.stringify({ ...header, ...body });
    const n = Buffer.byteLength(text);
    if (n === header.sizeBytes) break;
    header.sizeBytes = n;
  }
  // 4. the checks
  const { failed, notes } = check(lang, text, [token, `:${port}/`], meta.asOf);
  for (const n of notes) console.log(`${lang}: ${n}`);
  if (failed.length) {
    fs.writeFileSync(path.join(dest, `strom-ukazka-${lang}.json.failed`), text);
    throw new Error(`${lang}: the file failed its checks:\n  ${failed.join("\n  ")}`);
  }
  const file = path.join(dest, `strom-ukazka-${lang}.json`);
  fs.writeFileSync(file, text);
  fs.writeFileSync(`${file}.sha256`, `${sha256(text)}\n`);
  fs.writeFileSync(path.join(dest, "VERSION"), `${sampleVersion}\n`);

  // 5. the research packed for strom demo (the same research: the same id)
  const zip = path.join(work, `pack-${lang}.zip`);
  fs.rmSync(zip, { force: true });
  checkThenPack(strom, zip);
  if (git("rev-parse", "HEAD") !== head || git("status", "--porcelain")) throw new Error("strom pack changed the research");
  const pack = path.join(dest, `strom-ukazka-${lang}-${sampleVersion}.strom`);
  fs.renameSync(zip, pack);
  const packBytes = fs.readFileSync(pack);
  // nothing of the computer that built it (strom pack since research 1.37 leaves the agents' files out): its files and
  // its history (git log -p) without a home folder or the build's folder
  const named = machinePaths(pack, [work, os.homedir()]);
  if (named.length) throw new Error(`${lang}: the package names the computer that built it:\n  ${named.slice(0, 20).join("\n  ")}`);
  fs.writeFileSync(`${pack}.sha256`, `${sha256(packBytes)}\n`);
  sizes[lang] = { file: Buffer.byteLength(text), pack: packBytes.length };
  console.log(`${lang}: ${path.relative(out, file)} ${(Buffer.byteLength(text) / 1e6).toFixed(2)} MB, ${path.relative(out, pack)} ${(packBytes.length / 1e6).toFixed(2)} MB, research ${treeId} (${Math.round((Date.now() - t0) / 1000)} s)`);
}

fs.mkdirSync(out, { recursive: true });
for (const lang of langs) await build(lang);
const sizesFile = path.join(out, "sizes.json");
const all = fs.existsSync(sizesFile) ? (JSON.parse(fs.readFileSync(sizesFile, "utf8")) as typeof sizes) : {};
fs.writeFileSync(sizesFile, JSON.stringify({ ...all, ...sizes }, null, 2) + "\n");
console.log(`build-ukazka: ${langs.join(", ")} ok (sample ${sampleVersion}, app ${appVersion}, research ${researchVersion})`);
