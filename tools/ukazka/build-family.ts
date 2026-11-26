// Builds the invented family of one language as a Strom JSON (the app's own
// export format) for the general screenshots: family-data.ts gives the shape and
// the words, gen-scans.mjs the register pages whose entries the sources carry
// as excerpts, demo-data.ts the stories. A few dates are moved relative to
// `today` (a birthday and a wedding anniversary in the coming days), so the
// anniversaries panel has something to show whenever the set is made.
//
//   node build-family.ts <cs|en|de|pl> <outdir> [YYYY-MM-DD]   (SHOWCASE_SAMPLE=1 / SHOWCASE_NOW: that day, sample.ts)
//
// <outdir>/family.json         the tree (import it as a new tree)
// <outdir>/family-photos.json  the same tree with a photo for the people drawn in ./portraits/<key>.jpg
//                              (gen-portraits.mjs; the photo on the card, Strom 3.29: only the shots that ask for it)
// <outdir>/scans/              the register pages it was cut from
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FAMILY, UNIONS, TEXT, SOURCE_SHAPE, type Ev } from "./family-data.ts";
import { fixedMoment } from "./sample.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const lang = (process.argv[2] ?? "cs") as "cs" | "en" | "de" | "pl";
const dir = path.resolve(process.argv[3] ?? `/tmp/strom-showcase/family-${lang}`);
// the day: the argument, else the sample's fixed moment (sample.ts), else the day of the build
const today = process.argv[4] ?? (fixedMoment() || new Date().toISOString()).slice(0, 10);
const t = TEXT[lang];
const demo = ((await import(path.join(here, "demo-data.ts"))).default)[lang] as import("./demo-data.ts").Demo;

fs.mkdirSync(dir, { recursive: true });
const scans = path.join(dir, "scans");
const g = spawnSync(process.execPath, [path.join(here, "gen-scans.mjs"), lang, scans], { encoding: "utf8" });
if (g.status !== 0) throw new Error(`gen-scans: ${g.stderr}`);
const clips = JSON.parse(fs.readFileSync(path.join(scans, "clips.json"), "utf8")) as Record<string, { x: number; y: number; w: number; h: number }>;
const size = clips._size!;
const jpeg = (file: string) => {
  const b = fs.readFileSync(path.join(scans, file));
  return { dataUrl: `data:image/jpeg;base64,${b.toString("base64")}`, sizeBytes: b.length };
};

/** The day `days` after today, in the year of `date` (YYYY-MM-DD). */
function soon(date: string, days: number): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${date.slice(0, 4)}-${d.toISOString().slice(5, 10)}`;
}

let seq = 0;
const nid = (p: string) => `${p}_${(++seq).toString(36)}`;
const pid = (key: string) => `fam_${key}`;
const place = (k?: keyof typeof t.places) => (k ? t.places[k].name : undefined);

// ── the register entries: transcript, the entry cut out of its page, the page itself
type Source = Record<string, unknown> & { id: string };
const sources: Record<string, Source> = {};
const pages: Record<string, { id: string; name: string; mimeType: string; dataUrl: string; sizeBytes: number; sourceId: string }> = {};
for (const [key, s] of Object.entries(t.sources)) {
  const id = `src_${key}`;
  const shape = SOURCE_SHAPE[key] ?? {};
  const src: Source = { id, title: s.title, repository: s.repository, quality: shape.quality ?? 3, transcript: s.transcript };
  if (shape.events) src.events = shape.events;
  if (s.reference) src.reference = s.reference;
  if (s.date) src.recordDate = s.date;
  if (s.scan) {
    const c = clips[s.scan]!;
    const page = jpeg(`${s.scan}.jpg`);
    const attId = `att_${key}`;
    pages[key] = { id: attId, name: `${s.scan}.jpg`, mimeType: "image/jpeg", ...page, sourceId: id };
    src.excerpts = [{
      id: `exc_${key}`, ...jpeg(`${s.scan}-clip.jpg`), width: c.w, height: c.h, fromAttachmentId: attId,
      region: { x: c.x / size.w, y: c.y / size.h, w: c.w / size.w, h: c.h / size.h },
    }];
  }
  sources[id] = src;
}

// ── people
type Person = Record<string, unknown> & { id: string; partnerships: string[]; parentIds: string[]; childIds: string[]; sourceIds?: string[] };
const persons: Record<string, Person> = {};
const cite = (p: Person, src: string) => { (p.sourceIds ??= [] as string[]).includes(`src_${src}`) || p.sourceIds.push(`src_${src}`); };
for (const [key, f] of Object.entries(FAMILY)) {
  const [firstName, lastName] = t.names[key] ?? (() => { throw new Error(`${lang}: no name for ${key}`); })();
  const p: Person = { id: pid(key), firstName, lastName, gender: f.sex, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] };
  if (f.born) p.birthDate = f.birthdaySoon ? soon(f.born, f.birthdaySoon) : f.born;
  if (f.bornAt) p.birthPlace = place(f.bornAt);
  if (f.died) p.deathDate = f.died;
  if (f.diedAt) p.deathPlace = place(f.diedAt);
  if (f.deathCause) p.deathCause = t.words[f.deathCause];
  if (f.birthSource) { p.birthSourceIds = [`src_${f.birthSource}`]; cite(p, f.birthSource); }
  if (f.birthSources) { p.birthSourceIds = f.birthSources.map((k) => `src_${k}`); for (const k of f.birthSources) cite(p, k); }
  if (f.events?.length) {
    p.events = f.events.map((e: Ev) => {
      const ev: Record<string, unknown> = { id: nid("ev"), type: e.type };
      const date = e.dateOf ? t.sources[e.dateOf]!.date : e.date;
      if (date) ev.date = date;
      if (e.house) ev.address = t.words[e.house];
      if (e.share) ev.shareId = `sh${e.share.replace(/[^A-Za-z0-9]/g, "")}`.slice(0, 16);
      if (e.age && date && f.born) {
        const [by, bm = 6, bd = 15] = f.born.replace("~", "").split("-").map(Number);
        const [ey, em = 6, ed = 15] = date.split("-").map(Number);
        ev.age = String(ey - by - ((em < bm || (em === bm && ed < bd)) ? 1 : 0));
      }
      if (e.place) ev.place = place(e.place);
      if (e.word) ev.note = t.words[e.word];
      if (e.source) { ev.sourceIds = [`src_${e.source}`]; cite(p, e.source); }
      if (e.godparents) ev.participants = e.godparents.map((g) => FAMILY[g] ? { id: nid("pa"), role: "godparent", personId: pid(g) } : { id: nid("pa"), role: "godparent", name: t.words[g] });
      return ev;
    });
  }
  if (t.notes[key]) p.notes = t.notes[key];
  if (t.nameVariants[key]) p.nameVariants = t.nameVariants[key];
  if (pages[key]) p.attachments = [pages[key]];
  persons[p.id] = p;
}
persons[pid("katerina")]!.question = t.question;
persons[pid("anna")]!.story = { title: demo.story.annaTitle, status: "final", text: demo.story.anna, facts: demo.story.annaFacts };
persons[pid("josef")]!.story = { title: demo.story.josefTitle, status: "final", text: demo.story.josef };

// ── families
const partnerships: Record<string, Record<string, unknown>> = {};
for (const u of UNIONS) {
  const a = persons[pid(u.a)]!, b = u.b ? persons[pid(u.b)]! : undefined;
  const kids = (u.kids ?? []).map((k) => persons[pid(k)]!);
  for (const c of kids) {
    c.parentIds = b ? [a.id, b.id] : [a.id];
    for (const parent of b ? [a, b] : [a]) if (!parent.childIds.includes(c.id)) parent.childIds.push(c.id);
  }
  if (!b) continue;
  const [p1, p2] = a.gender === "female" && b.gender === "male" ? [b, a] : [a, b];
  const id = `u_${p1.id}_${p2.id}`;
  const union: Record<string, unknown> = { id, person1Id: p1.id, person2Id: p2.id, childIds: kids.map((c) => c.id), status: u.status ?? "married" };
  if (u.date) union.startDate = u.anniversarySoon ? soon(u.date, u.anniversarySoon) : u.date;
  if (u.place) union.startPlace = place(u.place);
  if (u.source) { union.sourceIds = [`src_${u.source}`]; cite(p1, u.source); cite(p2, u.source); }
  partnerships[id] = union;
  p1.partnerships.push(id);
  p2.partnerships.push(id);
}

// ── places with their coordinates (keyed like the app: placeKey)
const placeKey = (raw: string) => raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.,;]/g, " ").replace(/\s+/g, " ").trim();
const places = Object.fromEntries(Object.values(t.places).map((p) => [placeKey(p.name), { lat: p.lat, lon: p.lon, label: p.label }]));

const data = {
  version: 8,
  persons,
  partnerships,
  sources,
  places,
  surnameVariants: t.surnameVariants,
  defaultPersonId: pid("jana"),
};
fs.writeFileSync(path.join(dir, "family.json"), JSON.stringify(data));

// ── the same tree with the drawn portraits as photos (a square JPEG data URL, as the app keeps a photo)
const portraits = process.env.SHOWCASE_PORTRAITS ?? path.join(here, "portraits");
const photos: Record<string, Person> = {};
let withPhoto = 0;
for (const [id, p] of Object.entries(persons)) {
  const file = path.join(portraits, `${id.replace(/^fam_/, "")}.jpg`);
  if (fs.existsSync(file)) { photos[id] = { ...p, photo: `data:image/jpeg;base64,${fs.readFileSync(file).toString("base64")}` }; withPhoto++; }
  else photos[id] = p;
}
if (!withPhoto) console.error(`no portraits in ${portraits} (node gen-portraits.mjs): family-photos.json has no photo`);
fs.writeFileSync(path.join(dir, "family-photos.json"), JSON.stringify({ ...data, persons: photos }));
console.log(JSON.stringify({ file: path.join(dir, "family.json"), tree: t.tree, persons: Object.keys(persons).length, families: Object.keys(partnerships).length, photos: withPhoto }));
