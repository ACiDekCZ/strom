// The houses of the demo research (Strom 3.33 / research 1.38, spec 030 and 145): the mill no. 12 of the home village
// with its history as the research found it — its numbers over time, holders and residents, a fire, its look with the
// check of it, the municipality's pictures and field names, what is not known and what was gone through — and the
// house no. 5 of the other village waiting in the queue. Everything is invented: the people off the tree, the texts,
// the pictures (gen-houses.mjs: drawn, served from stromapp.info/ukazka/domy/ once published), the map link
// (example.org); the house's point is the village's own point of the demo (family-data.ts), no building of a real place.
//
// build-demo.ts calls addHouses() once, after the places (the municipalities are place records then) and before the
// lines. What the research writes of the houses (strom house add …) needs nobody's consent: written as the agent
// (origin research) always. What makes the mill "researched" and puts no. 5 in the queue is the person's word —
// strom house request … --yes — and only a person's run asks it (consent: SHOWCASE_NO_ACCEPT=0); without it the
// mill keeps its items and shows as not researched, no. 5 has no task (ZAKLAD §6: an agent's run gives no consent).
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export type HousesLang = "cs" | "en" | "de" | "pl";

/** Where the drawn pictures are published (gen-houses.mjs → tools/ukazka/houses/<name>.jpg); the shots serve them from the folder. */
export const PICTURES_BASE = "https://stromapp.info/ukazka/domy/";
export const PICTURES_DIR = path.join(HERE, "houses");
export const pictureUrl = (name: "green" | "valley" | "mill") => `${PICTURES_BASE}${name}.jpg`;
/** The licence of the drawings (the demo's own work). */
export const PICTURES_LICENCE = "CC BY 4.0";

/** The two houses: the mill of the home village and the house of the other village. */
export const HOUSE_MILL = "12";
export const HOUSE_OTHER = "5";

interface HousesText {
  /** The mill's name after its use. */
  name: string;
  /** The people off the tree: the holder before the family, a servant, a lodger. */
  holder0: string; servant: string; lodger: string;
  events: { built: string; renumber: string; fire: string; rebuilt: string };
  unknown: string; unknownLook: string;
  passed: { land: string; chronicle: string; checklist: string };
  look: string; lookCheck: string;
  memory: string;
  map: string;
  credit: string;
  town: { summary: string; green: string; valley: string; fields: [string, string, string][] };
  /** The person's request answered (a person's run only): the research's sessions. */
  sessions: { townResult: string; townSummary: string; townNext: string; result: string; summary: string; next: string };
}

const TEXT: Record<HousesLang, HousesText> = {
  cs: {
    name: "Mlýn",
    holder0: "Ambrož Vochomůrka", servant: "Leokadie Šimšálková", lodger: "Bonifác Pazderník",
    events: {
      built: "Mlýn na potoce pod vsí postaven; rok uvádí jen pozdější obecní kronika.",
      renumber: "Při přečíslování obce dostal mlýn místo čp. 9 číslo 12.",
      fire: "Požár mlýna: vyhořela střecha a mlýnice, vodní kolo zůstalo.",
      rebuilt: "Mlýn obnoven, obytná část nově zděná.",
    },
    unknown: "Kdo držel mlýn mezi lety 1786 a 1801?",
    unknownLook: "Fotografie mlýna z doby před požárem 1868 se nenašla; mlýnici zná jen popis v kronice.",
    passed: {
      land: "Pozemková kniha Dolní Lhota 1850–1950, vložka čp. 12",
      chronicle: "Obecní kronika 1923–1950",
      checklist: "prošlo se: pozemková kniha, matriky farnosti, obecní kronika, pomístní jména, dnešní letecký snímek",
    },
    look: "Přízemní mlýn se štítem k návsi a mlýnicí s vodním kolem na straně k potoku; po požáru 1868 obytná část zděná, střecha z pálených tašek.",
    lookCheck: "Obrázek údolí pod vsí ukazuje u potoka budovu s vodním kolem – nejspíš čp. 12.",
    memory: "Babička vyprávěla, že kolo se točilo ještě po válce a že se tu mlelo i pro sousední Horní Lhotu.",
    map: "Dnešní letecký snímek",
    credit: "Strom, ukázková kresba",
    town: {
      summary: "Farnost Dolní Lhota, katastrální území Dolní Lhota; pozemkové knihy od roku 1850, obecní kronika od roku 1923.",
      green: "Náves od jihu s kaplí a rybníčkem",
      valley: "Údolí pod vsí s mlýnem u potoka (čp. 12)",
      fields: [["Za Vochomůrkou", "louka", HOUSE_MILL], ["Pazderníkův náhon", "náhon", ""], ["Kvasnicovo pole", "pole", ""]],
    },
    sessions: {
      townResult: "Kostra obce Dolní Lhota: farnost, pozemkové knihy, kronika, pomístní jména a obrázky obce.",
      townSummary: "Obec Dolní Lhota: farnost a katastr, pozemkové knihy od roku 1850, kronika od roku 1923, tři pomístní jména, dva obrázky obce.",
      townNext: "Dům čp. 12 podle pozemkové knihy.",
      result: "Dějiny mlýna čp. 12: držitelé 1801–1950, čísla domu, požár 1868, podoba a co zůstává otevřené.",
      summary: "Mlýn čp. 12 v Dolní Lhotě: pět držitelů od roku 1801, z toho čtyři Horákové; do roku 1805 čp. 9; požár 1868 a obnova 1869.",
      next: "Podoba mlýna: projít obrázek údolí pod vsí.",
    },
  },
  en: {
    name: "The Mill",
    holder0: "Joseph Lane", servant: "Ellen Marsh", lodger: "Walter Bryant",
    events: {
      built: "The mill on the brook below the village built; the year is given only by a later parish history.",
      renumber: "When the houses were numbered anew, the mill became no. 12 instead of no. 9.",
      fire: "Fire at the mill: the roof and the milling floor burnt, the water wheel was left standing.",
      rebuilt: "The mill rebuilt, the dwelling part now of brick.",
    },
    unknown: "Who held the mill between 1786 and 1801?",
    unknownLook: "No photograph of the mill from before the fire of 1868 was found; the milling floor is known only from the parish history.",
    passed: {
      land: "Manorial court rolls of Thornbury 1850–1925, entries for no. 12",
      chronicle: "Parish magazine 1923–1950",
      checklist: "gone through: the court rolls, the parish registers, the parish magazine, the field names, today's aerial photograph",
    },
    look: "A low mill with its gable to the green and the milling floor with a water wheel on the brook side; after the fire of 1868 the dwelling of brick, the roof of clay tiles.",
    lookCheck: "The picture of the valley below the village shows a building with a water wheel by the brook — most likely no. 12.",
    memory: "Grandmother used to say the wheel still turned after the war and that the mill ground corn for Oakley too.",
    map: "Today's aerial photograph",
    credit: "Strom, sample drawing",
    town: {
      summary: "The parish of Thornbury; court rolls from 1850, a parish magazine from 1923.",
      green: "The green from the south, with the chapel and the pond",
      valley: "The valley below the village with the mill by the brook (no. 12)",
      fields: [["Mill Meadow", "meadow", HOUSE_MILL], ["The Leat", "millrace", ""], ["Long Furlong", "field", ""]],
    },
    sessions: {
      townResult: "The skeleton of Thornbury: the parish, the court rolls, the parish magazine, field names and pictures.",
      townSummary: "Thornbury: the parish, court rolls from 1850, the parish magazine from 1923, three field names, two pictures of the place.",
      townNext: "The house no. 12 from the court rolls.",
      result: "The history of the mill no. 12: holders 1801–1950, its numbers, the fire of 1868, its look and what stays open.",
      summary: "The mill no. 12 at Thornbury: five holders since 1801, four of them Hartleys; no. 9 until 1805; the fire of 1868 and the rebuilding in 1869.",
      next: "The look of the mill: the picture of the valley below the village.",
    },
  },
  de: {
    name: "Mühle",
    holder0: "Jakob Haas", servant: "Kreszenz Maier", lodger: "Lorenz Fink",
    events: {
      built: "Die Mühle am Bach unterhalb des Dorfes erbaut; das Jahr nennt erst eine spätere Ortschronik.",
      renumber: "Bei der Neunummerierung des Ortes erhielt die Mühle statt Nr. 9 die Nr. 12.",
      fire: "Brand der Mühle: Dach und Mahlstube brannten aus, das Wasserrad blieb stehen.",
      rebuilt: "Die Mühle wiederaufgebaut, der Wohnteil nun gemauert.",
    },
    unknown: "Wer besaß die Mühle zwischen 1786 und 1801?",
    unknownLook: "Ein Foto der Mühle aus der Zeit vor dem Brand 1868 fand sich nicht; die Mahlstube kennt nur die Beschreibung der Chronik.",
    passed: {
      land: "Grundbuch Oberndorf 1850–1950, Blatt Haus Nr. 12",
      chronicle: "Ortschronik 1923–1950",
      checklist: "durchgesehen: Grundbuch, Kirchenbücher der Pfarrei, Ortschronik, Flurnamen, heutiges Luftbild",
    },
    look: "Eine eingeschossige Mühle mit dem Giebel zum Dorfplatz und der Mahlstube mit Wasserrad zur Bachseite; nach dem Brand 1868 der Wohnteil gemauert, das Dach mit Ziegeln gedeckt.",
    lookCheck: "Das Bild des Tals unterhalb des Dorfes zeigt am Bach ein Gebäude mit Wasserrad – wohl Nr. 12.",
    memory: "Die Großmutter erzählte, das Rad habe sich noch nach dem Krieg gedreht und man habe hier auch für Unterdorf gemahlen.",
    map: "Heutiges Luftbild",
    credit: "Strom, Beispielzeichnung",
    town: {
      summary: "Pfarrei Oberndorf, Gemarkung Oberndorf; Grundbücher ab 1850, Ortschronik ab 1923.",
      green: "Der Dorfplatz von Süden mit Kapelle und Weiher",
      valley: "Das Tal unterhalb des Dorfes mit der Mühle am Bach (Nr. 12)",
      fields: [["Mühlwiese", "Wiese", HOUSE_MILL], ["Mühlgraben", "Mühlkanal", ""], ["Lange Äcker", "Feld", ""]],
    },
    sessions: {
      townResult: "Gerüst des Ortes Oberndorf: Pfarrei, Grundbücher, Chronik, Flurnamen und Bilder des Ortes.",
      townSummary: "Oberndorf: Pfarrei und Gemarkung, Grundbücher ab 1850, Chronik ab 1923, drei Flurnamen, zwei Bilder des Ortes.",
      townNext: "Das Haus Nr. 12 nach dem Grundbuch.",
      result: "Geschichte der Mühle Nr. 12: Besitzer 1801–1950, Hausnummern, Brand 1868, Aussehen und was offen bleibt.",
      summary: "Die Mühle Nr. 12 in Oberndorf: fünf Besitzer seit 1801, davon vier Weber; bis 1805 Nr. 9; Brand 1868 und Wiederaufbau 1869.",
      next: "Aussehen der Mühle: das Bild des Tals unterhalb des Dorfes durchgehen.",
    },
  },
  pl: {
    name: "Młyn",
    holder0: "Jakub Kubiakowski", servant: "Leokadia Sówczyńska", lodger: "Bonifacy Pazdernik",
    events: {
      built: "Młyn nad potokiem poniżej wsi zbudowany; rok podaje dopiero późniejsza kronika gminy.",
      renumber: "Przy przenumerowaniu wsi młyn otrzymał nr 12 zamiast nr 9.",
      fire: "Pożar młyna: spłonął dach i izba młyńska, koło wodne ocalało.",
      rebuilt: "Młyn odbudowany, część mieszkalna odtąd murowana.",
    },
    unknown: "Kto władał młynem w latach 1786–1801?",
    unknownLook: "Nie znaleziono fotografii młyna sprzed pożaru 1868; izbę młyńską zna tylko opis w kronice.",
    passed: {
      land: "Księga hipoteczna Wierzbno Dolne 1850–1950, karta domu nr 12",
      chronicle: "Kronika gminy 1923–1950",
      checklist: "przejrzano: księgę hipoteczną, księgi parafialne, kronikę gminy, nazwy terenowe, dzisiejsze zdjęcie lotnicze",
    },
    look: "Parterowy młyn szczytem do placu i izbą młyńską z kołem wodnym od strony potoku; po pożarze 1868 część mieszkalna murowana, dach kryty dachówką.",
    lookCheck: "Obraz doliny poniżej wsi pokazuje nad potokiem budynek z kołem wodnym – zapewne nr 12.",
    memory: "Babcia opowiadała, że koło kręciło się jeszcze po wojnie i że mielono tu także dla Wierzbna Górnego.",
    map: "Dzisiejsze zdjęcie lotnicze",
    credit: "Strom, rysunek przykładowy",
    town: {
      summary: "Parafia Wierzbno Dolne, obręb Wierzbno Dolne; księgi hipoteczne od 1850 r., kronika gminy od 1923 r.",
      green: "Plac wiejski od południa z kapliczką i stawem",
      valley: "Dolina poniżej wsi z młynem nad potokiem (nr 12)",
      fields: [["Pod Młynem", "łąka", HOUSE_MILL], ["Młynówka", "kanał młyński", ""], ["Długie Zagony", "pole", ""]],
    },
    sessions: {
      townResult: "Szkielet wsi Wierzbno Dolne: parafia, księgi hipoteczne, kronika, nazwy terenowe i obrazy wsi.",
      townSummary: "Wierzbno Dolne: parafia i obręb, księgi hipoteczne od 1850 r., kronika od 1923 r., trzy nazwy terenowe, dwa obrazy wsi.",
      townNext: "Dom nr 12 według księgi hipotecznej.",
      result: "Dzieje młyna nr 12: właściciele 1801–1950, numery domu, pożar 1868, wygląd i to, co pozostaje otwarte.",
      summary: "Młyn nr 12 w Wierzbnie Dolnym: pięciu właścicieli od 1801 r., w tym czterech Jaworskich; do 1805 r. nr 9; pożar 1868 i odbudowa 1869.",
      next: "Wygląd młyna: przejrzeć obraz doliny poniżej wsi.",
    },
  },
};

type J = Record<string, unknown>;
export interface HousesCtx {
  lang: HousesLang;
  /** strom in the demo research (build-demo.ts), its JSON answer (the data itself, no envelope): as the person (no agent's mark). */
  strom: (...args: string[]) => J;
  /** strom as the agent runs it (STROM_IN_AGENT): what the research writes of a house is the research's (origin research). */
  agent: (...args: string[]) => J;
  /** The research's clock: the next command's commit `minutes` before now. */
  at: (minutesAgo: number) => void;
  /** The demo's people by their keys (build-demo.ts P). */
  P: Record<string, string>;
  /** The demo's names (demo-data.ts people: [GEDCOM name, plain name]). */
  n: Record<string, [string, string]>;
  /** The demo's villages (demo-data.ts): the home village, the other one. */
  d: { place: string; place2: string };
  /** The village's point (family-data.ts places.home): the house's point too. */
  home: [number, number];
  /** The person's consent given (a person's run, SHOWCASE_NO_ACCEPT=0): the mill asked for and researched, no. 5 queued. */
  consent: boolean;
  /** Minutes before now the first command is dated (the commands follow a few seconds apart). */
  from: number;
}

/** The houses of the demo research: the facts with their numbers, the mill's history, no. 5 asked for (with consent). */
export function addHouses(c: HousesCtx): { mill: string; other: string } {
  const T = TEXT[c.lang];
  let clock = c.from;
  const tick = () => { c.at(clock); clock -= 0.004; };
  const person = (...a: string[]) => { tick(); return c.strom(...a); };
  const agent = (...a: string[]) => { tick(); return c.agent(...a); };
  const mill = [c.d.place, HOUSE_MILL];
  const other = [c.d.place2, HOUSE_OTHER];
  const item = (kind: string, ...a: string[]) => agent("house", "add", kind, ...mill, ...a);
  const town = (kind: string, ...a: string[]) => agent("house", "add", kind, "--town", c.d.place, ...a);
  const name = (k: string) => c.n[k]![1];

  // the facts with the house's number, as the registers and the census give them (leads): four generations in the
  // mill (with the births at no. 12 of build-demo where the records give a number), two in the house of the other
  // village — over the threshold of the app's Houses (2 generations or 30 years)
  const resi = (who: string, year: string, where: string[]) =>
    agent("event", "add", c.P[who]!, "RESI", "--date", year, "--place", where[0]!, "--house", where[1]!, "--status", "lead");
  resi("jan", "1870", mill);
  resi("vaclav", "1900", mill);
  resi("josef", "1925", mill);
  resi("antonin", "1921", other);
  resi("petr", "1935", other);

  // the person's word: look for the mill's history (its municipality's skeleton first) — only a person's run
  const asked = c.consent ? person("house", "request", ...mill, "--yes") as { task?: string; town?: string } : {};
  const session = (task: string | undefined, work: () => void, result: string, summary: string, next: string) => {
    if (!task) return work();
    person("session", "start", task);
    work();
    person("task", "done", task, "--result", result);
    person("session", "close", "--summary", summary, "--next", next);
  };

  // the municipality's skeleton: what its houses' research stands on
  session(asked.town, () => {
    town("summary", "--text", T.town.summary);
    town("picture", "--url", pictureUrl("green"), "--license", PICTURES_LICENCE, "--credit", T.credit, "--shows", T.town.green);
    town("picture", "--url", pictureUrl("valley"), "--license", PICTURES_LICENCE, "--credit", T.credit, "--shows", T.town.valley);
    for (const [fname, kind, house] of T.town.fields) town("field-name", "--name", fname, "--kind", kind, ...(house ? ["--house", house] : []));
  }, T.sessions.townResult, T.sessions.townSummary, T.sessions.townNext);

  // the mill
  const holder0 = T.holder0;
  session(asked.task, () => {
    item("name", "--name", T.name);
    item("number", "--number", "9", "--until", "1805", "--certainty", "high");
    item("number", "--number", HOUSE_MILL, "--since", "1805", "--certainty", "high");
    item("event", "--kind", "built", "--date", "1786", "--text", T.events.built, "--certainty", "guess");
    item("event", "--kind", "renumber", "--date", "1805", "--text", T.events.renumber, "--certainty", "high");
    item("event", "--kind", "fire", "--date", "1868-05", "--text", T.events.fire, "--certainty", "high");
    item("event", "--kind", "rebuilt", "--date", "1869", "--text", T.events.rebuilt, "--certainty", "medium");
    item("holder", "--name", holder0, "--since", "1801", "--until", "1832", "--how", "purchase", "--certainty", "medium");
    item("holder", "--name", name("matej"), "--person", c.P.matej!, "--since", "1832", "--until", "1863", "--how", "purchase", "--certainty", "high");
    item("holder", "--name", name("jan"), "--person", c.P.jan!, "--since", "1863", "--until", "1894", "--how", "inheritance", "--certainty", "high");
    item("holder", "--name", name("vaclav"), "--person", c.P.vaclav!, "--since", "1894", "--until", "1932", "--how", "inheritance", "--certainty", "high");
    item("holder", "--name", name("josef"), "--person", c.P.josef!, "--since", "1932", "--until", "1950", "--how", "inheritance", "--certainty", "medium");
    item("resident", "--name", name("jan"), "--person", c.P.jan!, "--role", "retired", "--since", "1894", "--until", "1902");
    item("resident", "--name", T.servant, "--role", "servant", "--since", "1880", "--until", "1880");
    item("resident", "--name", T.lodger, "--role", "lodger", "--since", "1900", "--until", "1904");
    item("location", `--lat=${c.home[0]}`, `--lon=${c.home[1]}`, "--how", "description", "--certainty", "guess");
    item("map", "--kind", "ortho", "--url", `https://example.org/maps/${c.lang}/mill`, "--manual", "--label", T.map);
    item("look", "--text", T.look, "--certainty", "medium", "--image", pictureUrl("mill"), "--license", PICTURES_LICENCE, "--credit", T.credit);
    item("look-check", "--next", "picture", "--text", T.lookCheck);
    item("unknown", "--text", T.unknown);
    item("unknown", "--look", "--text", T.unknownLook);
    item("passed", "--what", T.passed.land, "--found", "yes", "--url", `https://example.org/land/${c.lang}/12`);
    item("passed", "--what", T.passed.chronicle, "--found", "no");
    item("passed", "--checklist", "--what", T.passed.checklist);
    item("material", "--memory", T.memory);
  }, T.sessions.result, T.sessions.summary, T.sessions.next);

  // the house of the other village: asked for too, its task in the queue in its place (not first)
  if (c.consent) {
    const o = person("house", "request", ...other, "--yes") as { task?: string; town?: string };
    for (const t of [o.town, o.task]) if (t) person("task", "order", t, "--default");
  }
  const list = (c.strom("house", "list").houses ?? []) as { id?: string; house: string; place: { name: string } }[];
  const idOf = (place: string, no: string) => list.find((h) => h.place.name === place && h.house === no)?.id ?? `${place}|${no}`;
  return { mill: idOf(c.d.place, HOUSE_MILL), other: idOf(c.d.place2, HOUSE_OTHER) };
}

/** The mill's name in a language (the shots find its row by it). */
export const millName = (lang: HousesLang): string => TEXT[lang].name;
