// Builds the invented demo research of one language for the showcase screenshots,
// entirely through the strom CLI (as an agent would): a family over five
// generations, five directions (running, paused, ended), sessions spread over the
// last three days (their commits dated so — the app's history and "last 24 h"),
// sources with scans of invented register pages and their excerpts, a conflict,
// a hypothesis, searches, stories, tasks waiting for the user, a queue — and an
// agent at work right now (a worker kept present by a small process).
//
//   node build-demo.ts <cs|en|de|pl> <outdir>
//
// <outdir>/home      the demo user's HOME (the research in home/Documents/Strom/<tree>)
// <outdir>/config    strom's user config
// <outdir>/env.json  the environment to run strom in it
// <outdir>/tree.txt  the tree's folder
// <outdir>/worker.pid the process that keeps the agent "at work" (kill it when done)
//
// STROM_CLI overrides the strom sources (default ~/Projects/strom-research/src/cli.ts).
//
// Two modes:
// - the screenshots (default): times relative to the moment of the build, an agent at work now (worker.pid), the
//   invented cost of each session — what the gallery shows;
// - the sample (SHOWCASE_SAMPLE=1): a fixed moment (SHOWCASE_NOW, default SAMPLE_AS_OF in sample.ts) as "now" of the whole
//   research — strom's own clock too (fixed-clock.cjs), no agent at work (its last session closed, to be continued),
//   no costs, no record edited by hand (the data as strom wrote it). Built twice, the same times. sample.json
//   beside env.json says the moment; check-sample.ts checks the result.
// SHOWCASE_NOW alone fixes the moment of a screenshot build (strom's clock with it) and changes nothing else.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { addPlaces } from "./demo-places.ts";
import { add323, prepare323 } from "./demo-323.ts";
import { SAMPLE, fixedMoment, sampleTreeId } from "./sample.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const lang = (process.argv[2] ?? "cs") as "cs" | "en" | "de" | "pl";
const dir = path.resolve(process.argv[3] ?? `/tmp/showcase-${lang}`);
const cli = process.env.STROM_CLI ?? path.join(os.homedir(), "Projects/strom-research/src/cli.ts");
const AS_OF = fixedMoment();

// A running worker of an earlier build of this folder goes first.
try {
  process.kill(Number(fs.readFileSync(path.join(dir, "worker.pid"), "utf8")));
} catch { /* none */ }
fs.rmSync(dir, { recursive: true, force: true });
const home = path.join(dir, "home");
fs.mkdirSync(home, { recursive: true });
const gitconfig = path.join(dir, "gitconfig");
fs.writeFileSync(gitconfig, "[user]\n\tname = Demo\n\temail = demo@example.org\n");
const LOCALES = { cs: "cs_CZ.UTF-8", en: "en_GB.UTF-8", de: "de_DE.UTF-8", pl: "pl_PL.UTF-8" };
const env: Record<string, string> = {
  HOME: home,
  USERPROFILE: home,
  STROM_CONFIG_DIR: path.join(dir, "config"),
  LANG: LOCALES[lang],
  PATH: process.env.PATH ?? "",
  GIT_CONFIG_GLOBAL: gitconfig,
  GIT_CONFIG_NOSYSTEM: "1",
  STROM_NO_DIALOG: "1",
  STROM_NO_OPEN: "1",
  STROM_NO_INSTALL: "1",
  STROM_UPDATES: "off",
  STROM_APP_DIRS: "",
  // The app beyond the research's last release (what each variant of a hypothesis would connect, conflicts decided
  // from the app): the research writes it only for another copy of the app than the public one — the beta.
  STROM_APP_URL: process.env.SHOWCASE_APP_URL ?? "https://beta.stromapp.info/run/",
  // nothing of the demo goes to the network: only this computer's own addresses (no-net.cjs)
  NODE_OPTIONS: `--require ${path.join(here, "no-net.cjs")}` + (AS_OF ? ` --require ${path.join(here, "fixed-clock.cjs")}` : ""),
};
// Strom 3.23 / research 1.27 (demo-323.ts): the agent's browser ready, an archive only a person's browser goes to
// (SHOWCASE_323=1; off by default until the set of 3.23 is shot)
const WITH_323 = process.env.SHOWCASE_323 === "1";
if (WITH_323) prepare323(lang, dir, home, env);
fs.writeFileSync(path.join(dir, "env.json"), JSON.stringify(env));

// The research's clock: each command's commit is dated `clock` (minutes before now); with a fixed moment
// (AS_OF) strom's own clock runs from the same time (STROM_SAMPLE_CLOCK, fixed-clock.cjs).
const NOW = AS_OF ? Date.parse(AS_OF) : Date.now();
let clock = 4400;
const at = (minutesAgo: number) => { clock = minutesAgo; };
let cwd = dir;
/** The environment of the next strom command only (the sample's `init`: its fixed id). */
let once: Record<string, string> = {};
type J = Record<string, unknown>;
function strom(...args: string[]): J {
  return stromExit(0, ...args);
}
/** strom as the agent runs it (never asking: STROM_NONINTERACTIVE), expected to end with `exit`. */
function stromExit(exit: number, ...args: string[]): J {
  const when = new Date(NOW - clock * 60_000).toISOString();
  const r = spawnSync(process.execPath, [cli, ...args, "--json"], {
    cwd,
    env: { ...env, STROM_NONINTERACTIVE: "1", GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when, ...(AS_OF ? { STROM_SAMPLE_CLOCK: when } : {}), ...once },
    encoding: "utf8",
  });
  once = {};
  if (r.status !== exit) throw new Error(`strom ${args.join(" ")} → ${r.status} (expected ${exit})\n${r.stdout}\n${r.stderr}`);
  clock = Math.max(clock - 1.5, 0);
  try {
    return JSON.parse(r.stdout) as J;
  } catch {
    return {};
  }
}
/** The first ID of a kind (P, E, S, M, T, G, F, H, X…) in a command's JSON answer. */
function id(j: J, prefix: string): string {
  const seen = JSON.stringify(j).match(new RegExp(`"id":"(${prefix}\\d{4,})"`));
  if (!seen) throw new Error(`no ${prefix}… in ${JSON.stringify(j).slice(0, 300)}`);
  return seen[1]!;
}

// ————————————————————————————————————————— the texts of each language
const DATA = await import(path.join(here, "demo-data.ts"));
const d = DATA.default[lang] as import("./demo-data.ts").Demo;
const n: Record<string, [string, string]> = { ...d.people, miller: d.island.miller, millerWife: d.island.wife, millerSon: d.island.son };

// ————————————————————————————————————————— scans of invented register pages
const scans = path.join(dir, "scans");
const g = spawnSync(process.execPath, [path.join(here, "gen-scans.mjs"), lang, scans], { encoding: "utf8" });
if (g.status !== 0) throw new Error(`gen-scans: ${g.stderr}`);
const clips = JSON.parse(fs.readFileSync(path.join(scans, "clips.json"), "utf8")) as Record<string, { x: number; y: number; w: number; h: number }>;
const clip = (m: string, page: string) => { const c = clips[page]!; return `${m}@${c.x},${c.y},${c.w},${c.h}`; };

// ————————————————————————————————————————— three days ago: the research begins
// Every task is added in the session that finds the need for it (as an agent
// plans its next steps), so strom's frontier finds each person covered and the
// history groups each change under its task.
at(4400);
strom("setup", "--yes", "--lang", lang);
// the sample's research has the same id in every build (sampleTreeId): the file on the web and `strom demo` are one research
const TREE_ID = SAMPLE ? sampleTreeId(lang) : "";
if (TREE_ID) once = { STROM_SAMPLE_TREE_ID: TREE_ID, NODE_OPTIONS: `${env.NODE_OPTIONS} --require ${path.join(here, "fixed-id.cjs")}` };
strom("init", d.tree);
cwd = path.join(home, "Documents", "Strom", d.tree);
if (TREE_ID) {
  const got = (JSON.parse(fs.readFileSync(path.join(cwd, "strom.json"), "utf8")) as { id?: string }).id;
  if (got !== TREE_ID) throw new Error(`the sample's tree id: ${got}, expected ${TREE_ID} (fixed-id.cjs)`);
}
fs.writeFileSync(path.join(dir, "tree.txt"), cwd);
// Five generations: Matěj above them is the direction's limit (the muted edge)
const G1 = id(strom("research", "new", d.research.main, "--new-person", n.anna[0], "--sex", "F", "--born", "1931", "--born-place", d.place, "--generations", "5"), "G");
const P = { anna: "P0001" } as Record<string, string>;
strom("intake", "--text", d.intake);
const R1 = id(strom("repo", "add", d.repo, "--country", d.country, "--automation", "manual"), "R");
const B1 = id(strom("recordset", "add", d.books.bapt, "--repo", R1, "--kinds", "baptism", "--places", d.place, "--years", "1890-1935", "--access", "online-free"), "B");
const B2 = id(strom("recordset", "add", d.books.marr, "--repo", R1, "--kinds", "marriage", "--places", d.place, "--years", "1890-1930", "--access", "online-free"), "B");
const B3 = id(strom("recordset", "add", d.books.baptOld, "--repo", R1, "--kinds", "baptism", "--places", d.place, "--years", "1855-1889", "--access", "online-free"), "B");
const B4 = id(strom("recordset", "add", d.books.other, "--repo", R1, "--kinds", "baptism", "--places", d.place2, "--years", "1860-1890", "--access", "online-free"), "B");
// The births before the known books begin are lost (the edge "lost" above Jan and Anna Dvořáková)
strom("recordset", "add", d.lostBook, "--repo", R1, "--kinds", "baptism", "--places", d.place, "--years", "1830-1854", "--access", "lost");
const person = (key: string, sex: "M" | "F", ...more: string[]) => { P[key] = id(strom("person", "add", n[key]![0], "--sex", sex, ...more), "P"); return P[key]!; };
const task = (what: string, level: string, research: string, about: string[], where: string, why: string, done: string) =>
  id(strom("task", "add", what, "--level", level, "--research", research, ...about.flatMap((a) => ["--about", a]), "--where", where, "--why", why, "--done-when", done), "T");
/** One session of the agent: its task, what it records and plans, its end. */
function session(t: string, work: () => void, result: string, summary: string, next: string): void {
  strom("session", "start", t);
  work();
  strom("task", "done", t, "--result", result);
  strom("session", "close", "--summary", summary, "--next", next);
}
const media = (file: string, book: string, image: string) => id(strom("media", "add", path.join(scans, file), "--recordset", book, "--image", image, "--url", d.url, "--from", d.mediaFrom), "M");
const T = d.tasks;
const W = T.why, D = T.doneWhen;
/** The open story task strom proposed for a person (stories: yes), if any. */
function storyTask(p: string): string | undefined {
  const all = (strom("task", "list", "--limit", "500").tasks ?? []) as { id: string; level: string; state: string; subject: string[] }[];
  return all.find((t) => t.level === "narrate" && t.state === "open" && t.subject.includes(p))?.id;
}

/** A downloader as an agent makes it (strom connector new), its reading of the terms in connector.json; `hosts` all it may reach. */
function connector(name: string, url: string, title: string, policy: Record<string, unknown>, hosts?: string[]): void {
  strom("connector", "new", name, "--url", url, "--title", title);
  const file = path.join(home, "Documents", "Strom", "shared", "plugins", "connectors", name, "connector.json");
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  m.policy = { ...m.policy, ...policy };
  if (hosts) m.hosts = hosts;
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + "\n");
}

// The family's knowledge first: what the user told (the task strom made of it)
const tIntake = ((strom("task", "list").tasks ?? []) as { id: string; level: string }[]).find((t) => t.level === "intake")!.id;
session(tIntake, () => {
  person("petr", "M", "--born", "1929");
  person("jana", "F", "--born", "1956");
  person("karel", "M", "--born", "1928");
  person("vera", "F", "--born", "1935");
  strom("family", "add", "--partner", P.petr!, "--partner", P.anna!, "--child", P.jana!);
  P.tAnna = task(T.annaBapt, "link", G1, [P.anna!], B1, W.parents, D.entry);
}, d.results.intake, d.summaries.intake, d.nexts.intake);

// The house number, where the records give one (English ones name the street, not a number)
const house = d.house ? ["--house", d.house] : [];

// ————————————————————————————————————————— two days ago: Anna's baptism, her parents' marriage
at(2950);
session(P.tAnna, () => {
  const m = media("bapt1931.jpg", B1, "112");
  const s = id(strom("source", "add", d.src.anna, "--kind", "baptism", "--recordset", B1, "--locator", "fol. 112", "--date", "18 JAN 1931", "--information", "primary",
    "--transcript", d.tr.anna, "--media", m, "--clip", clip(m, "bapt1931")), "S");
  strom("event", "add", P.anna!, "BIRT", "--date", "14 JAN 1931", "--place", d.place, ...house, "--cite", s, "--status", "proven");
  strom("event", "add", P.anna!, "CHR", "--date", "18 JAN 1931", "--place", d.place, "--cite", s, "--status", "proven", "--with", `godparent:${n.ruzena[1]}`);
  person("josef", "M", "--cite", s);
  person("marie", "F", "--cite", s);
  person("ruzena", "F", "--cite", s);
  P.F1 = id(strom("family", "add", "--partner", P.josef!, "--partner", P.marie!, "--child", P.anna!, "--child", P.karel!, "--child", P.vera!, "--cite", s), "F");
  P.tMarr = task(T.parentsMarr, "link", G1, [P.josef!, P.marie!], B2, W.grandparents, D.entry);
}, d.results.anna, d.summaries.anna, d.nexts.anna);

at(2700);
session(P.tMarr, () => {
  const m = media("marr1924.jpg", B2, "58");
  const s = id(strom("source", "add", d.src.marr, "--kind", "marriage", "--recordset", B2, "--locator", "fol. 58", "--date", "12 MAY 1924", "--information", "primary",
    "--transcript", d.tr.marr, "--media", m, "--clip", clip(m, "marr1924")), "S");
  strom("event", "add", P.F1!, "MARR", "--date", "12 MAY 1924", "--place", d.place, "--cite", s, "--status", "proven", "--age", "husband:26", "--age", "wife:21");
  person("vaclav", "M", "--cite", s);
  person("katerina", "F", "--cite", s);
  person("frantisek", "M", "--cite", s);
  person("ludmila", "F", "--cite", s);
  strom("family", "add", "--partner", P.vaclav!, "--partner", P.katerina!, "--child", P.josef!, "--child", P.ruzena!, "--cite", s);
  strom("family", "add", "--partner", P.frantisek!, "--partner", P.ludmila!, "--child", P.marie!, "--cite", s);
  P.tJosef = task(T.josefBapt, "link", G1, [P.josef!], B1, W.birth, D.entry);
  P.tMarie = task(T.marieBapt, "link", G1, [P.marie!], B1, W.birth, D.entry);
  P.tGp = task(T.gpMarr, "link", G1, [P.vaclav!, P.katerina!], B2, W.katParents, D.entry);
  P.tMg = task(T.mgMarr, "link", G1, [P.frantisek!, P.ludmila!], B2, W.parents, D.entry);
}, d.results.marr, d.summaries.marr, d.nexts.marr);

// Other directions, begun by the user
at(2400);
const G2 = id(strom("research", "new", d.research.husband, "--person", P.petr!), "G");
P.tPetr = task(T.petrBirth, "link", G2, [P.petr!], d.books.petr, W.parents, D.entry);
const G4 = id(strom("research", "new", d.research.descendants, "--person", P.vaclav!, "--direction", "descendants"), "G");
const G5 = id(strom("research", "new", d.research.review, "--person", P.vera!, "--direction", "person"), "G");
at(1700);
strom("research", "pause", G4, "--reason", d.reasons.paused);
at(1560);
strom("research", "done", G5, "--reason", d.reasons.done);

// ————————————————————————————————————————— the last 24 hours
at(1320);
session(P.tJosef, () => {
  const m = media("bapt1898.jpg", B1, "21");
  const s = id(strom("source", "add", d.src.josef, "--kind", "baptism", "--recordset", B1, "--locator", "fol. 21", "--date", "3 MAR 1898", "--information", "primary", "--language", "la",
    "--transcript", d.tr.josef, "--translation", d.tr.josefTr, "--media", m, "--clip", clip(m, "bapt1898")), "S");
  strom("event", "add", P.josef!, "BIRT", "--date", "3 MAR 1898", "--place", d.place, ...house, "--cite", s, "--status", "proven");
  strom("search", "add", T.josefBapt, "--recordset", B1, "--years", "1897-1899", "--surname", d.surname, "--method", "page-by-page", "--result", "found", "--found", s);
  const c = id(strom("source", "add", d.src.census, "--kind", "census", "--information", "secondary", "--transcript", d.tr.census), "S");
  strom("event", "add", P.josef!, "OCCU", "--value", d.occ, "--cite", c, "--status", "probable");
  strom("conflict", "add", d.conflict, "--about", P.josef!, "--fact", "BIRT", "--claim", `${s}: 1898`, "--claim", `${c}: 1897`);
  strom("hypothesis", "add", d.hypoJosef, "--about", P.josef!, "--variant", d.hypoJosefA, "--variant", d.hypoJosefB, "--note", d.hypoJosefNote);
  strom("search", "add", d.searchJosef, "--years", "1916-1918", "--surname", d.surname, "--method", "index", "--result", "negative");
  P.tVaclav = task(T.vaclavBapt, "link", G1, [P.vaclav!], B3, W.parents, D.entry);
  const tp = task(T.grave, "enrich", G1, [P.josef!], d.books.grave, W.grave, D.photo);
  strom("task", "park", tp, "--reason", d.reasons.parked);
}, d.results.josef, d.summaries.josef, d.nexts.josef);

at(1080);
session(P.tMarie, () => {
  const s = id(strom("source", "add", d.src.marie, "--kind", "baptism", "--recordset", B1, "--locator", "fol. 47", "--date", "24 AUG 1902", "--information", "primary", "--transcript", d.tr.marie), "S");
  strom("event", "add", P.marie!, "BIRT", "--date", "20 AUG 1902", "--place", d.place, "--cite", s, "--status", "proven");
  strom("search", "add", T.marieBapt, "--recordset", B1, "--years", "1901-1903", "--surname", d.surname2, "--method", "page-by-page", "--result", "found", "--found", s);
  P.tFr = task(T.frantisekBapt, "link", G1, [P.frantisek!], B3, W.parents, D.entry);
  P.tLudmila = task(T.ludmilaBapt, "link", G1, [P.ludmila!], B3, W.parents, D.entry);
}, d.results.marie, d.summaries.marie, d.nexts.marie);

at(760);
session(P.tVaclav!, () => {
  const s = id(strom("source", "add", d.src.vaclav, "--kind", "baptism", "--recordset", B3, "--locator", "fol. 88", "--date", "2 OCT 1865", "--information", "primary", "--language", "la", "--transcript", d.tr.vaclav), "S");
  strom("event", "add", P.vaclav!, "BIRT", "--date", "1 OCT 1865", "--place", d.place, "--cite", s, "--status", "proven");
  person("jan", "M", "--born", "ABT 1838", "--cite", s);
  person("annaD", "F", "--cite", s);
  person("matej", "M", "--cite", s, "--note", d.notes.matej);
  strom("family", "add", "--partner", P.jan!, "--partner", P.annaD!, "--child", P.vaclav!, "--cite", s);
  strom("family", "add", "--partner", P.matej!, "--child", P.jan!, "--cite", s);
  task(T.janMarr, "link", G1, [P.jan!, P.annaD!], B3, W.parents, D.entry);
  task(T.janDeath, "link", G1, [P.jan!], B3, W.death, D.entry);
  task(T.census1880, "link", G1, [P.vaclav!], d.books.census, W.household, D.household);
}, d.results.vaclav, d.summaries.vaclav, d.nexts.vaclav);

at(520);
session(P.tPetr, () => {
  const s = id(strom("source", "add", d.src.petr, "--kind", "baptism", "--information", "primary", "--date", "1929", "--transcript", d.tr.petr), "S");
  strom("event", "add", P.petr!, "BIRT", "--date", "7 JUN 1929", "--place", d.place2, "--cite", s, "--status", "proven");
  person("antonin", "M", "--cite", s);
  person("marieK", "F", "--cite", s);
  strom("family", "add", "--partner", P.antonin!, "--partner", P.marieK!, "--child", P.petr!, "--cite", s);
  task(T.antoninBapt, "link", G2, [P.antonin!], d.books.petr, W.parents, D.entry);
  task(T.antoninMarr, "link", G2, [P.antonin!, P.marieK!], d.books.petr, W.parents, D.entry);
  // what the family may know, asked through the user
  const tq = task(T.askFamily, "request", G2, [P.petr!], d.books.family, W.askFamily, D.answer);
  strom("task", "wait", tq, "--on", d.askOn, "--kind", "family");
  // What waits by place (research 1.13.2): requests to an office (their texts in notes/), two sent already, the
  // family's photo, a site — planned here, set waiting below
  const Wt = d.waits;
  fs.mkdirSync(path.join(cwd, "notes"), { recursive: true });
  for (const l of [...Wt.office.letters, ...Wt.sent]) fs.writeFileSync(path.join(cwd, l.file), l.text + "\n");
  P.letters = Wt.office.letters.map((l) => task(l.what, "link", G2, l.about.map((k) => P[k]!), Wt.office.to, Wt.why.letter, Wt.doneWhen.letter)).join(",");
  P.sent = Wt.sent.map((l) => task(l.what, "link", G2, l.about.map((k) => P[k]!), l.to, Wt.why.letter, Wt.doneWhen.letter)).join(",");
  P.tPhoto = task(Wt.family.what, "enrich", G2, Wt.family.about.map((k) => P[k]!), d.books.family, Wt.why.photo, Wt.doneWhen.photo);
  P.tWeb = task(Wt.web.what, "link", G1, Wt.web.about.map((k) => P[k]!), Wt.web.url, Wt.why.web, Wt.doneWhen.web);
}, d.results.petr, d.summaries.petr, d.nexts.petr);

at(330);
session(P.tFr, () => {
  const s = id(strom("source", "add", d.src.frantisek, "--kind", "baptism", "--recordset", B3, "--locator", "fol. 131", "--date", "1874", "--information", "primary", "--language", "la", "--transcript", d.tr.frantisek), "S");
  strom("event", "add", P.frantisek!, "BIRT", "--date", "12 FEB 1874", "--place", d.place, "--cite", s, "--status", "proven");
  person("tomas", "M", "--cite", s);
  person("rozalie", "F", "--cite", s);
  strom("family", "add", "--partner", P.tomas!, "--partner", P.rozalie!, "--child", P.frantisek!, "--cite", s);
  task(T.tomasMarr, "link", G1, [P.tomas!, P.rozalie!], B3, W.parents, D.entry);
}, d.results.frantisek, d.summaries.frantisek, d.nexts.frantisek);

// Where did Kateřina come from? A question the user asked, a hypothesis, a search in vain.
at(200);
const G3 = id(strom("research", "new", d.research.question, "--person", P.katerina!, "--direction", "question", "--question", d.research.question), "G");
const tKat = task(T.katSearch, "link", G3, [P.katerina!], B4, W.origin, D.searched);
session(tKat, () => {
  // The miller's family from the baptisms of the other village: nothing links it to the tree yet (an island),
  // the hypothesis would join it to Kateřina
  person("miller", "M", "--born", "ABT 1838", "--born-place", d.place2, "--note", d.island.note);
  person("millerWife", "F");
  person("millerSon", "M", "--born", "1868", "--born-place", d.place2);
  const FM = id(strom("family", "add", "--partner", P.miller!, "--partner", P.millerWife!, "--child", P.millerSon!), "F");
  const H = id(strom("hypothesis", "add", d.hypo, "--about", P.katerina!, "--about", P.miller!, "--variant", d.hypoA, "--variant", d.hypoB, "--note", d.hypoNote), "H");
  // what variant B would connect: Kateřina a child of the miller's family (the app can show it linked in the view only)
  strom("hypothesis", "link", H, "B", "--child", P.katerina!, "--of", FM);
  strom("search", "add", d.searchNeg, "--recordset", B4, "--years", "1866-1872", "--surname", d.surnameKat, "--method", "page-by-page", "--result", "negative", "--note", d.searchNote);
  task(T.katReread, "verify", G3, [P.katerina!], B2, W.origin, D.entry);
  P.tKatBapt = task(T.katBapt, "link", G1, [P.katerina!], B4, W.katParents, D.entry);
  // The marriages of the other village lie on another archive's portal, whose terms restrict automated download:
  // the agent makes its connector (its reading of the terms in connector.json, as an agent writes it), records the
  // archive and the book, and plans the task. Invented, under example.org; nothing ever asks the host.
  const A = d.archive;
  strom("connector", "new", A.name, "--url", `https://${A.host}`, "--title", A.title);
  const manifest = path.join(home, "Documents", "Strom", "shared", "plugins", "connectors", A.name, "connector.json");
  const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
  m.policy = { ...m.policy, automation: "restricted", terms: A.terms, termsSummary: A.reading };
  fs.writeFileSync(manifest, JSON.stringify(m, null, 2) + "\n");
  const RA = id(strom("repo", "add", A.repo, "--country", d.country, "--url", `https://${A.host}`), "R");
  P.BA = id(strom("recordset", "add", A.book, "--repo", RA, "--kinds", "marriage", "--places", d.place2, "--years", A.years, "--access", "online-free", "--url", `https://${A.host}/${A.bookId}`), "B");
  P.tKatMarr = task(A.task, "link", G3, [P.katerina!], P.BA, W.katParents, D.entry);
  // The miller's family in another archive whose rules allow its images by hand only (its downloader says so: the
  // level "manual"); five tasks of images saved by hand, planned here, set waiting below.
  const M = d.waits.manual;
  connector(M.name, `https://${M.host}`, M.title, { automation: "manual", terms: M.terms, termsSummary: M.reading });
  const RM = id(strom("repo", "add", M.repo, "--country", d.country, "--url", `https://${M.host}`, "--automation", "manual"), "R");
  const BM = M.books.map((b) => id(strom("recordset", "add", b.name, "--repo", RM, "--kinds", b.kinds, "--places", d.place2, "--years", b.years, "--access", "online-free", "--url", `https://${M.host}/${b.id}`), "B"));
  P.manual = M.tasks.map((x) => task(x.what, "link", G3, x.about.map((k) => P[k]!), BM[x.book]!, d.waits.why.mill, d.waits.doneWhen.images)).join(",");
  P.BM = BM.join(",");
  // Settings → Archives: one archive on two hosts (one line for both), one with no hourly cap
  const H2 = d.waits.twoHosts;
  connector(H2.name, `https://${H2.hosts[0]}`, H2.title, { automation: "allowed", terms: H2.terms, termsSummary: H2.reading, pace: { minIntervalMs: 3000, perHour: 600 } }, H2.hosts);
  const NC = d.waits.noCap;
  connector(NC.name, `https://${NC.host}`, NC.title, { automation: "allowed", terms: NC.terms, termsSummary: NC.reading });
}, d.results.kat, d.summaries.kat, d.nexts.kat);

// Stories for the family book (the tasks strom proposed, else our own)
at(110);
session(storyTask(P.josef!) ?? task(T.storyJosef, "narrate", G1, [P.josef!], d.books.records, W.story, D.story), () => {
  strom("story", "set", P.josef!, "--text", d.story.josef, "--title", d.story.josefTitle, "--final");
  P.tStory = storyTask(P.anna!) ?? task(T.story, "narrate", G1, [P.anna!], d.books.records, W.story, D.story);
}, d.results.story, d.summaries.storyJosef, d.nexts.story);
at(85);
session(P.tStory!, () => {
  strom("story", "set", P.anna!, "--text", d.story.anna, "--title", d.story.annaTitle);
}, d.results.story, d.summaries.story, d.nexts.story);

// The marriage of Václav and Kateřina: the portal allows no program, the user saves the images
at(55);
strom("session", "start", P.tGp!);
strom("task", "wait", P.tGp!, "--images", `${B2}:40-45`, "--on", d.waitOn);
strom("session", "close", "--summary", d.summaries.wait, "--next", d.nexts.wait);

// Ludmila's baptism: the portal allows no program either, the user saves the images (the edge "waiting for you")
at(40);
strom("task", "wait", P.tLudmila!, "--images", `${B3}:60-64`, "--on", d.waitLudmila);

// What waits by place (research 1.13.2): the archive by hand only, the office, the family, a site — set waiting in
// one session; two requests sent days ago (the person said so)
at(38);
{
  const Wt = d.waits;
  const manual = P.manual!.split(","), books = P.BM!.split(","), letters = P.letters!.split(","), sent = P.sent!.split(",");
  strom("session", "start", manual[0]!);
  Wt.manual.tasks.forEach((x, k) => strom("task", "wait", manual[k]!, "--images", `${books[x.book]}:${x.images}`, "--on", x.on));
  Wt.office.letters.forEach((l, k) => strom("task", "wait", letters[k]!, "--on", l.on, "--kind", "letter", "--to", Wt.office.to, "--request", l.file));
  Wt.sent.forEach((l, k) => strom("task", "wait", sent[k]!, "--on", l.on, "--kind", "letter", "--to", l.to, "--request", l.file));
  strom("task", "wait", P.tPhoto!, "--on", Wt.family.on, "--kind", "family");
  strom("task", "wait", P.tWeb!, "--on", Wt.web.on, "--kind", "web", "--url", Wt.web.url);
  if (WITH_323) P.tBrowser = add323({ lang, strom, id, country: d.country, research: G3, about: P.millerWife!, place: d.place2 });
  strom("session", "close", "--summary", Wt.manual.summary, "--next", Wt.manual.next);
  at(34);
  strom("task", "sent", ...sent);
}

// The archive's images: the fetch meets its terms (images only with the person's permission). Nobody to ask in an
// agent's session: the question waits for the person (strom's menu, the app) and the task waits for the decision.
at(30);
strom("session", "start", P.tKatMarr!);
stromExit(4, "fetch", d.archive.name, d.archive.bookId, "--images", d.archive.images, "--recordset", P.BA!);
strom("session", "close", "--continue", "--summary", d.archive.summary, "--next", d.archive.next);

// The places: facts in other forms, identified places, a question with candidates, a queue (demo-places.ts)
await addPlaces({ lang, strom, at, P, d, env, from: 25, to: 15.5 });

// The lines (Strom 3.22, research 1.26): a branch off the lines that grows, the person's order of the lines, a task
// put next (demo-lines.ts) — in the whole set since 3 Nov 2026 (make-showcase.sh: SHOWCASE_LINES, default 1)
if (process.env.SHOWCASE_LINES === "1") {
  const { addLines } = await import("./demo-lines.ts");
  const open = (strom("task", "list", "--limit", "500").tasks ?? []) as { id: string; what: string }[];
  const byWhat = (what: string) => open.find((t) => t.what === what)?.id ?? (() => { throw new Error(`no task "${what}"`); })();
  addLines({
    lang, strom, at, P, G: { main: G1, husband: G2, question: G3, descendants: G4, review: G5 }, doneWhen: D.entry,
    sessionTask: byWhat(T.janDeath), nextTask: byWhat(T.census1880), from: 15.4,
  });
}

// strom query (research 1.32): the Horáks of house 12 as millers, births before 1800, stories of the mill
// (demo-query.ts, Czech only; SHOWCASE_QUERY=1, off by default: shots made on request, prefix fb-query-)
if (process.env.SHOWCASE_QUERY === "1") {
  const { addQuery } = await import("./demo-query.ts");
  addQuery({ lang, strom, id, P, G1, place: d.place });
}

// ————————————————————————————————————————— an agent at work now (the sample: its session closed, to be continued)
at(14);
if (SAMPLE) {
  strom("session", "start", P.tKatBapt!);
  at(6);
  strom("search", "add", d.searchNow, "--recordset", B4, "--years", "1868-1872", "--surname", d.surnameKat, "--method", "page-by-page", "--result", "partial", "--note", d.searchNowNote);
  strom("session", "close", "--continue", "--summary", d.summaries.paused!, "--next", d.nexts.paused!);
} else {
  const WORKER = "run-demo";
  const holder = spawn(process.execPath, [path.join(here, "worker.mjs"), cwd, WORKER, "Claude Code on its own", String(NOW - 14 * 60_000)], { detached: true, stdio: "ignore" });
  holder.unref();
  fs.writeFileSync(path.join(dir, "worker.pid"), String(holder.pid));
  const lock = path.join(cwd, ".strom", "workers", `${WORKER}.json`);
  for (let i = 0; i < 100 && !fs.existsSync(lock); i++) spawnSync("sleep", ["0.05"]);
  env.STROM_WORKER = WORKER;
  strom("session", "start", P.tKatBapt!);
  at(6);
  strom("search", "add", d.searchNow, "--recordset", B4, "--years", "1868-1872", "--surname", d.surnameKat, "--method", "page-by-page", "--result", "partial", "--note", d.searchNowNote);
  delete env.STROM_WORKER;
}

const SEALED = SAMPLE || !!process.env.SHOWCASE_SEALED;
// What waits by place: some images of the archive by hand only saved into their folders already (saved x/y), and
// the two requests sent days ago (strom writes the moment of `task sent`; the demo's requests went out earlier).
{
  const Wt = d.waits;
  const shared = path.join(home, "Documents", "Strom", "shared");
  const scan = fs.readdirSync(scans).find((f) => f.endsWith(".jpg"))!;
  P.manual!.split(",").forEach((t, k) => {
    const rec = JSON.parse(fs.readFileSync(path.join(cwd, "data", "tasks", `${t}.json`), "utf8"));
    const dir = path.join(shared, "inbox", rec.awaits.folder);
    fs.mkdirSync(dir, { recursive: true });
    const [from] = Wt.manual.tasks[k]!.images.split("-").map(Number);
    for (let i = 0; i < Wt.manual.tasks[k]!.have; i++) {
      const file = path.join(dir, `${from! + i}.jpg`);
      fs.copyFileSync(path.join(scans, scan), file);
      if (!AS_OF) continue;
      // At a fixed moment the images were saved a day before it, each a page of its own (strom sets aside a file
      // the same as an image it has, …same-as-M0004): the page with its book and number after its end
      fs.appendFileSync(file, `\n${rec.awaits.folder} ${from! + i}\n`);
      fs.utimesSync(file, new Date(NOW - 86_400_000), new Date(NOW - 86_400_000));
    }
  });
  // …and strom took them at that moment, as a session's start does (no bridge takes them later, at its own time)
  if (AS_OF) { at(2); strom("media", "add", "--inbox", "--waiting"); }
  // SHOWCASE_SEALED=1 (and the sample): the demo's data kept as strom wrote it (no record edited here), so strom
  // writes into it later too (the phone's page sending photos, 47); the letters then show as sent just now
  if (!SEALED) P.sent!.split(",").forEach((t, k) => {
    const file = path.join(cwd, "data", "tasks", `${t}.json`);
    const rec = JSON.parse(fs.readFileSync(file, "utf8"));
    const days = Wt.sent[k]!.daysAgo;
    rec.sent = { ...rec.sent, at: new Date(NOW - days * 86_400_000).toISOString() };
    rec.updated = new Date(NOW - (days + 1) * 86_400_000).toISOString();
    fs.writeFileSync(file, JSON.stringify(rec, null, 2) + "\n");
  });
}

// What each finished session cost: the demo ran no agent, so strom knows no cost. Written as an agent's
// run would have reported it (invented, about $0.62 a session): the spend in the panel and the cost on
// the edge of the tree. Not with SHOWCASE_SEALED nor in the sample (no costs: see above).
if (!SEALED) {
  const dirS = path.join(cwd, "data", "sessions");
  let k = 0;
  for (const f of fs.readdirSync(dirS).sort()) {
    const file = path.join(dirS, f);
    const rec = JSON.parse(fs.readFileSync(file, "utf8"));
    if (rec.state !== "closed") continue;
    const cost = [0.58, 0.71, 0.49, 0.66, 0.62, 0.74, 0.55][k++ % 7]!;
    rec.metrics = { model: "claude-sonnet-5", costUsd: cost, turns: 18 + (k * 7) % 23, durationMs: (9 + (k * 5) % 14) * 60_000 };
    fs.writeFileSync(file, JSON.stringify(rec, null, 2) + "\n");
  }
  // Into the last change, keeping its time: a commit of its own would show as a change "session metrics"
  // at the top of the live panel's latest changes.
  const when = spawnSync("git", ["log", "-1", "--format=%cI"], { cwd, env, encoding: "utf8" }).stdout.trim();
  spawnSync("git", ["commit", "-qa", "--amend", "--no-edit"], { cwd, env: { ...env, GIT_COMMITTER_DATE: when } });
}
// Settings → Archives: the person confirmed the two downloaders whose archives allow their images (their readings
// accepted in a terminal, as only a person can: here the demo's own terminal, its own settings folder) — one archive
// with an hourly cap, one without.
// By default (SHOWCASE_NO_ACCEPT unset or 1) they stay waiting for the person: a run by an agent gives no consent, not
// even in the demo. Only SHOWCASE_NO_ACCEPT=0, a person's run, accepts them.
for (const name of process.env.SHOWCASE_NO_ACCEPT !== "0" ? [] : [d.waits.twoHosts.name, d.waits.noCap.name]) {
  const r = spawnSync("python3", [path.join(here, "tty_run.py"), dir, "", "allow", "archive", name, "--accept"], { env: { ...process.env, STROM_CLI: cli }, encoding: "utf8" });
  if (!/accepted|přijat|akzeptiert|allowed|dovoleno|erlaubt|dozwolon|obowiązuje/u.test(r.stdout)) throw new Error(`allow archive ${name} --accept: ${r.stdout}\n${r.stderr}`);
}
strom("export", "gedcom");
// At a fixed moment the shared inbox's times too: strom reads them (a folder or file changed lately is still being
// saved, waitsUntil) and its own moves of files there (…same-as-M0004) are dated by this computer's clock.
if (AS_OF) {
  const before = new Date(NOW - 86_400_000);
  const settle = (p: string) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const q = path.join(p, e.name);
      if (e.isDirectory()) settle(q);
      if (fs.statSync(q).mtimeMs > before.getTime()) fs.utimesSync(q, before, before);
    }
    if (fs.statSync(p).mtimeMs > before.getTime()) fs.utimesSync(p, before, before);
  };
  const inbox = path.join(home, "Documents", "Strom", "shared", "inbox");
  if (fs.existsSync(inbox)) settle(inbox);
}
if (AS_OF) fs.writeFileSync(path.join(dir, "sample.json"), JSON.stringify({ asOf: new Date(NOW).toISOString(), lang, sample: SAMPLE, ...(TREE_ID ? { treeId: TREE_ID } : {}) }) + "\n");
console.log(JSON.stringify({ tree: cwd, research: { main: G1, husband: G2, question: G3, descendants: G4, review: G5 }, people: P }));
