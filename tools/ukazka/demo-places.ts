// The places of the demo research (Strom 3.21 / research 1.25, identification of places): the place records an agent
// writes (strom place identify / propose / unlocated / verify / queue) over a few facts that write a place in another
// form — a spelling of the records, an old name with its years, a name in another language — so the app's Places
// window shows every state (confirmed, identified, a question with candidates, not to be determined, queued, not on
// the map yet) and the research's place records have people and facts (History of places: "Find local history…").
// build-demo.ts calls addPlaces() once, before the agent at work; everything is invented except the names and
// coordinates of public towns. The candidates of the question are real towns of one name.
//
// Also here, for the shots of 3.21 (shots-321.ts): the kinds of history in a copy of the demo research (historyKinds),
// the id of a demo research's tree (treeIdOf).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export type PlacesLang = "cs" | "en" | "de" | "pl";

/** A town or city: its name today, coordinates, kind. */
interface Town { name: string; lat: number; lon: number; kind: string }

export interface PlacesText {
  /** The gazetteer the identifications stand on (invented title, no address). */
  gazetteer: string;
  /** The home village (demo-data place): another spelling of the records, its parish, why, the check. */
  home: { form: string; old?: string; kind: string; parish: string; why: string; verify: string };
  /** The other village (demo-data place2). */
  home2: { kind: string; why: string };
  /** A town written with its old name (the old name with its years). */
  renamed: Town & { fact: string; years: string; why: string };
  /** A city written with its name in another language (a name still in use). */
  other: Town & { fact: string; alt: string; why: string };
  /** A town near home, identified plainly. */
  near: Town & { why: string };
  /** A name several places have: the research asks which one (1–3 candidates: name, lat, lon, why, district, country). */
  question: { fact: string; candidates: [string, number, number, string, string, string][]; why: string };
  /** A name not to be determined yet: why, and what would decide it. */
  unlocated: { fact: string; why: string; needs: string };
  /** Places queued for identification: one from the registers of the archive (an area of its own), one without a source. */
  queued: { cited: string; plain: string };
  /** A place nobody has looked for yet (not on the map, not queued). */
  offMap: string;
  /** The research's session of identification: its summary and what comes next. */
  session: { summary: string; next: string };
}

/**
 * The texts and places per language. cs: the demo's Dolní Lhota (Zlín district); en: Thornbury (Gloucestershire);
 * de: Oberndorf am Neckar; pl: around Tarnów (until family-data.ts / demo-data.ts give the Polish demo its village).
 */
export const PLACES: Record<PlacesLang, PlacesText> = {
  cs: {
    gazetteer: "Místopisný slovník obcí",
    home: {
      form: "Lhota Dolní", old: "Unter-Lhota", kind: "obec", parish: "Dolní Lhota",
      why: "Farnost Dolní Lhota vede matriky rodiny, okres i roky souhlasí.",
      verify: "Křest 1931 i oddavky 1924 jsou zapsané ve farnosti Dolní Lhota.",
    },
    home2: { kind: "obec", why: "Sousední obec téže farnosti; mlynářova rodina je v jejích matrikách." },
    renamed: { fact: "Gottwaldov", name: "Zlín", lat: 49.2268, lon: 17.6667, kind: "město", years: "1949-1989", why: "Okresní město; v letech 1949–1989 se jmenovalo Gottwaldov." },
    other: { fact: "Wien", name: "Vídeň", lat: 48.2084, lon: 16.3725, kind: "město", alt: "Wien@de", why: "Zápis o pobytu v německém jazyce; Wien je Vídeň." },
    near: { name: "Luhačovice", lat: 49.0997, lon: 17.7577, kind: "město", why: "Lázeňské město v okrese Zlín, kousek od Dolní Lhoty." },
    question: {
      fact: "Bystřice", why: "Obcí jménem Bystřice je několik a zápis neuvádí přívlastek ani okres.",
      candidates: [
        ["Bystřice pod Hostýnem", 49.3992, 17.674, "Nejbližší z obcí toho jména, asi 30 km od Dolní Lhoty.", "Kroměříž", "CZ"],
        ["Bystřice pod Lopeníkem", 48.976, 17.787, "Leží na Slovácku, kam se z Dolní Lhoty chodilo za prací.", "Uherské Hradiště", "CZ"],
        ["Bystřice nad Pernštejnem", 49.523, 16.261, "Vzdálená, ale v matrikách se psala i bez přívlastku.", "Žďár nad Sázavou", "CZ"],
      ],
    },
    unlocated: { fact: "Lhota", why: "V okolí je několik obcí jménem Lhota a zápis neuvádí farnost.", needs: "Farnost nebo okres ze zápisu." },
    queued: { cited: "Pozlovice", plain: "Provodov" },
    offMap: "Chicago",
    session: { summary: 'Ztotožněno 5 míst: Dolní Lhota (ověřena, i zápis Lhota Dolní a Unter-Lhota), Horní Lhota, Zlín (Gottwaldov), Vídeň (Wien), Luhačovice. U Bystřice tři kandidáti, Lhota bez farnosti nejde určit.', next: 'Ve frontě zůstávají 2 místa ve 2 oblastech: Pozlovice z matrik archivu a Provodov bez pramene.' },
  },
  en: {
    gazetteer: "Gazetteer of English Parishes",
    home: {
      form: "Thornbury, Glos.", kind: "town", parish: "Thornbury",
      why: "The parish of Thornbury keeps the family's registers; the county and the years agree.",
      verify: "The baptism of 1931 and the marriage of 1924 are both in the Thornbury registers.",
    },
    home2: { kind: "village", why: "A village of the same parish; the miller's family is in its registers." },
    renamed: { fact: "Kingstown", name: "Dún Laoghaire", lat: 53.2944, lon: -6.1339, kind: "town", years: "1821-1920", why: "The harbour town south of Dublin; called Kingstown from 1821 to 1920." },
    other: { fact: "Caerdydd", name: "Cardiff", lat: 51.4817, lon: -3.1792, kind: "city", alt: "Caerdydd@cy", why: "A Welsh chapel record; Caerdydd is the Welsh name of Cardiff." },
    near: { name: "Berkeley", lat: 51.691, lon: -2.459, kind: "town", why: "A market town in Gloucestershire, a few miles from Thornbury." },
    question: {
      fact: "Newport", why: "Several towns are called Newport and the record gives no county.",
      candidates: [
        ["Newport", 51.5842, -2.9977, "The nearest of the name, across the Severn from Thornbury.", "Newport", "GB"],
        ["Newport", 50.7008, -1.2933, "On the Isle of Wight; the family had relatives in Hampshire.", "Isle of Wight", "GB"],
        ["Newport", 52.7691, -2.3786, "In Shropshire, written without a county in the registers too.", "Telford and Wrekin", "GB"],
      ],
    },
    unlocated: { fact: "Upton", why: "There are several villages called Upton nearby and the record names no parish.", needs: "The parish or the county from the record." },
    queued: { cited: "Alveston", plain: "Olveston" },
    offMap: "Toronto",
    session: { summary: 'Identified 5 places: Thornbury (checked, the form Thornbury, Glos. too), Oakley, Dún Laoghaire (Kingstown), Cardiff (Caerdydd), Berkeley. Newport has three candidates; Upton cannot be told without its parish.', next: "Two places stay in the queue, in two areas: Alveston from the archive's registers and Olveston without a source." },
  },
  de: {
    gazetteer: "Ortslexikon Württemberg",
    home: {
      form: "Oberndorf a. N.", kind: "Stadt", parish: "Oberndorf",
      why: "Die Pfarrei Oberndorf führt die Kirchenbücher der Familie; Oberamt und Jahre stimmen.",
      verify: "Die Taufe 1931 und die Trauung 1924 stehen beide in den Büchern der Pfarrei Oberndorf.",
    },
    home2: { kind: "Dorf", why: "Ein Dorf derselben Pfarrei; die Müllerfamilie steht in seinen Büchern." },
    renamed: { fact: "Karl-Marx-Stadt", name: "Chemnitz", lat: 50.8278, lon: 12.9214, kind: "Stadt", years: "1953-1990", why: "Die Stadt in Sachsen hieß von 1953 bis 1990 Karl-Marx-Stadt." },
    other: { fact: "Strasbourg", name: "Straßburg", lat: 48.5734, lon: 7.7521, kind: "Stadt", alt: "Strasbourg@fr", why: "Ein französischer Eintrag; Strasbourg ist Straßburg." },
    near: { name: "Rottweil", lat: 48.1678, lon: 8.627, kind: "Stadt", why: "Die Kreisstadt, wenige Kilometer neckaraufwärts von Oberndorf." },
    question: {
      fact: "Neustadt", why: "Viele Orte heißen Neustadt, und der Eintrag nennt keinen Zusatz.",
      candidates: [
        ["Titisee-Neustadt", 47.9256, 8.2117, "Am nächsten, im Schwarzwald, gut 60 km von Oberndorf.", "Breisgau-Hochschwarzwald", "DE"],
        ["Neustadt an der Weinstraße", 49.35, 8.139, "In der Pfalz, wohin viele aus Württemberg zur Arbeit gingen.", "Neustadt an der Weinstraße", "DE"],
        ["Neustadt an der Donau", 48.8, 11.7686, "Weit entfernt, aber in den Büchern ebenfalls ohne Zusatz geschrieben.", "Kelheim", "DE"],
      ],
    },
    unlocated: { fact: "Hausen", why: "In der Gegend gibt es mehrere Orte namens Hausen, und der Eintrag nennt keine Pfarrei.", needs: "Die Pfarrei oder das Oberamt aus dem Eintrag." },
    queued: { cited: "Sulz am Neckar", plain: "Waldmössingen" },
    offMap: "New York",
    session: { summary: '5 Orte identifiziert: Oberndorf (geprüft, auch die Schreibung Oberndorf a. N.), Unterdorf, Chemnitz (Karl-Marx-Stadt), Straßburg (Strasbourg), Rottweil. Für Neustadt gibt es drei Kandidaten; Hausen lässt sich ohne Pfarrei nicht bestimmen.', next: 'In der Warteschlange bleiben 2 Orte in 2 Gebieten: Sulz am Neckar aus den Kirchenbüchern des Archivs und Waldmössingen ohne Quelle.' },
  },
  pl: {
    gazetteer: "Słownik geograficzny miejscowości",
    home: {
      form: "", kind: "wieś", parish: "",
      why: "Parafia prowadzi księgi metrykalne rodziny; powiat i lata się zgadzają.",
      verify: "Chrzest z 1931 roku i ślub z 1924 roku są zapisane w księgach tej parafii.",
    },
    home2: { kind: "wieś", why: "Sąsiednia wieś tej samej parafii; rodzina młynarza jest w jej księgach." },
    renamed: { fact: "Stalinogród", name: "Katowice", lat: 50.2649, lon: 19.0238, kind: "miasto", years: "1953-1956", why: "Miasto na Śląsku; w latach 1953–1956 nosiło nazwę Stalinogród." },
    other: { fact: "Wien", name: "Wiedeń", lat: 48.2084, lon: 16.3725, kind: "miasto", alt: "Wien@de", why: "Wpis w języku niemieckim; Wien to Wiedeń." },
    near: { name: "Tarnów", lat: 50.0121, lon: 20.9858, kind: "miasto", why: "Miasto powiatowe, kilka kilometrów od wsi rodziny." },
    question: {
      fact: "Dąbrowa", why: "Miejscowości o nazwie Dąbrowa jest wiele, a wpis nie podaje przydomka ani powiatu.",
      candidates: [
        ["Dąbrowa Tarnowska", 50.1747, 20.9867, "Najbliższa z miejscowości tej nazwy, około 20 km od wsi rodziny.", "dąbrowski", "PL"],
        ["Dąbrowa Górnicza", 50.3217, 19.1949, "W Zagłębiu, dokąd wielu ludzi z okolicy szło do pracy w kopalniach.", "Dąbrowa Górnicza", "PL"],
        ["Dąbrowa Białostocka", 53.6539, 23.3486, "Daleko, ale w księgach też pisana bez przydomka.", "sokólski", "PL"],
      ],
    },
    unlocated: { fact: "Wola", why: "W okolicy jest kilka wsi o nazwie Wola, a wpis nie podaje parafii.", needs: "Parafia albo powiat z wpisu." },
    queued: { cited: "Zbylitowska Góra", plain: "Wierzchosławice" },
    offMap: "Chicago",
    session: { summary: 'Zidentyfikowano 5 miejsc: Wierzbno Dolne (sprawdzone, także zapis Dolne Wierzbno), Wierzbno Górne, Katowice (Stalinogród), Wiedeń (Wien), Tarnów. Dla Dąbrowy są trzy kandydatury; Woli nie da się ustalić bez parafii.', next: 'W kolejce zostają 2 miejsca z 2 obszarów: Zbylitowska Góra z ksiąg archiwum i Wierzchosławice bez źródła.' },
  },
};

/** The home village's coordinates (family-data.ts, the app's family: the same place), else near Tarnów for pl. */
async function homeCoords(lang: PlacesLang): Promise<{ home: [number, number]; mill: [number, number] }> {
  const { TEXT } = await import(path.join(HERE, "family-data.ts")) as { TEXT: Record<string, { places?: Record<string, { lat: number; lon: number }> }> };
  const p = TEXT[lang]?.places;
  if (p?.home && p.mill) return { home: [p.home.lat, p.home.lon], mill: [p.mill.lat, p.mill.lon] };
  return { home: [50.0402, 21.0512], mill: [50.0581, 21.0723] };
}

/** Another spelling of a village's name as a register writes it: the words swapped ("Dolní Lhota" → "Lhota Dolní"). */
function swapped(name: string): string {
  const w = name.split(/\s+/);
  return w.length === 2 ? `${w[1]} ${w[0]}` : `${name} (par.)`;
}

type J = Record<string, unknown>;
export interface PlacesCtx {
  lang: PlacesLang;
  /** strom in the demo research as the agent runs it (build-demo.ts), its JSON answer. */
  strom: (...args: string[]) => J;
  /** The research's clock: the next command's commit `minutes` before now. */
  at: (minutes: number) => void;
  /** The demo's people by their keys (build-demo.ts P). */
  P: Record<string, string>;
  /** The demo's texts (demo-data.ts): place, place2, src.frantisek. */
  d: { place: string; place2: string; src: Record<string, string> };
  /** strom's environment in build-demo.ts (the session of the research's identification: STROM_SESSION). */
  env: Record<string, string>;
  /** Minutes before now the first command is dated, and the last (the commands spread between them). */
  from?: number;
  to?: number;
}

/**
 * The facts in other forms and the place records of the demo research. Facts on people at the side of the tree (the
 * places' forms on their cards), status lead; one cited from a register of the archive. The person queues the places
 * off the map (the app's Places: Find in the research), the research identifies them in a session of its task
 * places:identify (written "by the research") and leaves two in the queue: two areas, two sessions.
 */
export async function addPlaces(c: PlacesCtx): Promise<void> {
  const T = PLACES[c.lang];
  const { home, mill } = await homeCoords(c.lang);
  const form = T.home.form || swapped(c.d.place);
  const parish = T.home.parish || c.d.place;
  // read first (nothing written, no commit)
  const sources = (c.strom("source", "list", "--limit", "500").sources ?? []) as { id: string; title: string }[];
  const cite = sources.find((x) => x.title === c.d.src.frantisek)?.id;
  const taskIds = () => new Set(((c.strom("task", "list").tasks ?? []) as { id: string }[]).map((t) => t.id));
  const before = taskIds();

  const steps: ((t: number) => unknown)[] = [];
  const s = (...args: string[]) => steps.push(() => c.strom(...args));
  const ev = (who: string, tag: string, date: string, place: string, ...more: string[]) =>
    s("event", "add", c.P[who]!, tag, "--date", date, "--place", place, "--status", "lead", ...more);

  // the facts, as the registers write them
  ev("vaclav", "DEAT", "1932", form);
  if (T.home.old) ev("marieK", "BIRT", "1903", T.home.old);
  ev("frantisek", "DEAT", "1955", T.renamed.fact);
  ev("millerSon", "RESI", "1925", T.other.fact);
  // the same towns under today's names (another source): each a group of its names in the app's Places
  ev("frantisek", "BURI", "1955", T.renamed.name);
  ev("millerSon", "DEAT", "1961", T.other.name);
  ev("ruzena", "RESI", "1921", T.offMap);
  ev("karel", "RESI", "1958", T.question.fact);
  ev("rozalie", "RESI", "1880", T.unlocated.fact);
  ev("millerWife", "RESI", "1870", T.queued.plain);
  ev("annaD", "DEAT", "1902", T.near.name);
  ev("tomas", "RESI", "1874", T.queued.cited, ...(cite ? ["--cite", cite] : []));

  // the person asks for them (all but the one far away): the research's task of places comes
  s("place", "queue", c.d.place, c.d.place2, form, ...(T.home.old ? [T.home.old] : []), T.renamed.fact, T.other.fact, T.near.name,
    T.question.fact, T.unlocated.fact, T.queued.cited, T.queued.plain);
  let session = "";
  steps.push((t) => {
    const task = [...taskIds()].find((x) => !before.has(x));
    c.at(t);
    const j = c.strom("session", "start", ...(task ? [task] : []));
    session = String((j.session as { id?: string } | undefined)?.id ?? "");
    if (session) c.env.STROM_SESSION = session;
    return j;
  });
  // identified in the session, the home village checked
  const gz = ["--source-title", T.gazetteer];
  s("place", "identify", c.d.place, `--lat=${home[0]}`, `--lon=${home[1]}`, "--kind", T.home.kind, "--why", T.home.why, ...gz,
    "--form", form, ...(T.home.old ? ["--alt", `${T.home.old}@de:-1918`] : []), "--jurisdiction", `parish:${parish}`);
  s("place", "verify", c.d.place, "--ok", "--why", T.home.verify);
  s("place", "identify", c.d.place2, `--lat=${mill[0]}`, `--lon=${mill[1]}`, "--kind", T.home2.kind, "--why", T.home2.why, ...gz,
    "--jurisdiction", `parish:${parish}`);
  const R = T.renamed;
  s("place", "identify", R.fact, "--name", R.name, `--lat=${R.lat}`, `--lon=${R.lon}`, "--kind", R.kind, "--why", R.why, ...gz,
    "--alt", `${R.fact}:${R.years}`);
  const O = T.other;
  s("place", "identify", O.fact, "--name", O.name, `--lat=${O.lat}`, `--lon=${O.lon}`, "--kind", O.kind, "--why", O.why, ...gz, "--alt", O.alt);
  const N = T.near;
  s("place", "identify", N.name, `--lat=${N.lat}`, `--lon=${N.lon}`, "--kind", N.kind, "--why", N.why, ...gz);
  // the question with its candidates, the place not to be determined
  s("place", "propose", T.question.fact, "--why", T.question.why, ...T.question.candidates.flatMap((x) => ["--candidate", x.join("|")]));
  s("place", "unlocated", T.unlocated.fact, "--why", T.unlocated.why, "--needs", T.unlocated.needs);
  steps.push(() => {
    try {
      return c.strom("session", "close", "--continue", "--summary", T.session.summary, "--next", T.session.next);
    } finally {
      delete c.env.STROM_SESSION;
    }
  });

  const from = c.from ?? 29, to = c.to ?? 16;
  steps.forEach((step, i) => {
    const t = from - ((from - to) * i) / Math.max(1, steps.length - 1);
    c.at(t);
    step(t);
  });
}

// ── for the shots (shots-321.ts)

/** The id of the tree of a demo research folder (t-<lang>, a copy): its strom.json. */
export function treeIdOf(dir: string): string {
  const tree = fs.readFileSync(path.join(dir, "tree.txt"), "utf8").trim();
  return (JSON.parse(fs.readFileSync(path.join(tree, "strom.json"), "utf8")) as { id: string }).id;
}

/** strom in a pseudo-terminal of a research folder, as a person types it (answers one by one): its screen as text. */
export function personTypes(dir: string, answers: string, ...args: string[]): string {
  const res = spawnSync("python3", [path.join(HERE, "tty_run.py"), dir, answers, ...args], { encoding: "utf8" });
  return res.stdout.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

/** The answer "yes" of strom's questions in a terminal, per language. */
export const YES: Record<PlacesLang, string> = { cs: "a", en: "y", de: "j", pl: "t" };

/**
 * The kinds of history a person chose for the tree (Settings → Person card, column Search; strom config set
 * history.kinds): looked through without law and other events first (no language's demo history has them), then those on and economy and disasters
 * off — so aligning has something to hide, to show again and to search. In a copy of the demo research, its history
 * (lib-history.ts addHistory) added between the two settings. strom asks the person to confirm ("y" in every language).
 */
export function historyKinds(r: { dir: string; strom: (...a: string[]) => string }, addHistory: () => void): void {
  try { r.strom("config", "set", "history.kinds", "all,-law,-other", "--for-tree"); }
  catch { personTypes(r.dir, "y", "config", "set", "history.kinds", "all,-law,-other", "--for-tree"); }
  addHistory();
  personTypes(r.dir, "y|y", "config", "set", "history.kinds", "all,-economy,-disaster", "--for-tree");
}
