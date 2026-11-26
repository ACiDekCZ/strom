// The lines of the demo research (Strom 3.22 / research 1.26, the lines managed from the app): the research's five
// directions are its lines already (three running, one paused, one ended); here the rest of what the app shows of them,
// through the strom CLI only, as an agent and the person would do it:
// - a branch off the lines: the emigrant brother of Václav (family-data.ts frantisekH) with his two wives and two
//   children over the ocean, the people of the app's own family tree; five tasks about them, so the branch "grows"
//   (5 people) and What waits proposes a line for it;
// - the order of the lines changed by the person (the question second);
// - one task the person put next (the queue's reason "own").
// In the whole set since 3 Nov 2026 (make-showcase.sh: SHOWCASE_LINES, default 1; =0 only to compare what the lines
// change). build-demo.ts calls addLines() once, before the agent at work.
import { TEXT } from "./family-data.ts";

export type LinesLang = "cs" | "en" | "de" | "pl";

interface LinesText {
  emigration: (who: string) => string;
  marriage: (a: string, b: string, where: string, year: string) => string;
  baptism: (who: string, where: string, year: string) => string;
  /** Where the records of each task are (precise descriptions, no record set of the research). */
  passengers: string;
  parish: (where: string) => string;
  why: string;
  summary: string;
  next: string;
}

const LINES: Record<LinesLang, LinesText> = {
  cs: {
    emigration: (w) => `Vystěhování: ${w}, 1891`,
    marriage: (a, b, p, y) => `Oddavky: ${a} a ${b}, ${p} ${y}`,
    baptism: (w, p, y) => `Křest: ${w}, ${p} ${y}`,
    passengers: "seznamy cestujících 1891",
    parish: (p) => `matriky farností, ${p}`,
    why: "rodina vystěhovalce",
    summary: "Václavův bratr František se vystěhoval: dvě manželky a dvě děti za oceánem zapsány z dopisů domů.",
    next: "úmrtí Jana Horáka",
  },
  en: {
    emigration: (w) => `Emigration: ${w}, 1891`,
    marriage: (a, b, p, y) => `Marriage: ${a} and ${b}, ${p} ${y}`,
    baptism: (w, p, y) => `Baptism: ${w}, ${p} ${y}`,
    passengers: "passenger lists 1891",
    parish: (p) => `parish registers, ${p}`,
    why: "the emigrant's family",
    summary: "William's brother Henry emigrated: two wives and two children over the ocean recorded from the letters home.",
    next: "the death of the father",
  },
  de: {
    emigration: (w) => `Auswanderung: ${w}, 1891`,
    marriage: (a, b, p, y) => `Trauung: ${a} und ${b}, ${p} ${y}`,
    baptism: (w, p, y) => `Taufe: ${w}, ${p} ${y}`,
    passengers: "Passagierlisten 1891",
    parish: (p) => `Kirchenbücher, ${p}`,
    why: "die Familie des Auswanderers",
    summary: "Georgs Bruder Ludwig ist ausgewandert: zwei Ehefrauen und zwei Kinder in Übersee aus den Briefen nach Hause erfasst.",
    next: "der Tod des Vaters",
  },
  pl: {
    emigration: (w) => `Emigracja: ${w}, 1891`,
    marriage: (a, b, p, y) => `Ślub: ${a} i ${b}, ${p} ${y}`,
    baptism: (w, p, y) => `Chrzest: ${w}, ${p} ${y}`,
    passengers: "listy pasażerów 1891",
    parish: (p) => `księgi parafialne, ${p}`,
    why: "rodzina emigranta",
    summary: "Brat Wacława, Franciszek, wyemigrował: dwie żony i dwoje dzieci za oceanem zapisane z listów do domu.",
    next: "zgon ojca",
  },
};

type J = Record<string, unknown>;
interface LinesCtx {
  lang: LinesLang;
  strom: (...args: string[]) => J;
  at: (minutesAgo: number) => void;
  P: Record<string, string>;
  /** The research's lines: main (ancestors of the focus), husband, question, descendants (paused), review (ended). */
  G: { main: string; husband: string; question: string; descendants: string; review: string };
  doneWhen: string;
  /** The task the session of the branch runs on (an open task of the main line about the emigrant's father). */
  sessionTask: string;
  /** The task the person puts next. */
  nextTask: string;
  from: number;
}

const firstId = (j: J, prefix: string): string => {
  const m = JSON.stringify(j).match(new RegExp(`"id":"(${prefix}\\d{4,})"`));
  if (!m) throw new Error(`no ${prefix}… in ${JSON.stringify(j).slice(0, 300)}`);
  return m[1]!;
};

export function addLines(c: LinesCtx): void {
  const L = LINES[c.lang];
  // a tight clock: every command 3 s after the one before (strom's own step is 1.5 min), all before the agent at work
  let clock = c.from;
  const strom = (...args: string[]) => { c.at(clock); clock -= 0.05; return c.strom(...args); };
  const names = TEXT[c.lang].names;
  const where = TEXT[c.lang].places.emigrant.name;
  const nm = (k: string) => `${names[k]![0]} ${names[k]![1]}`;
  const ged = (k: string) => `${names[k]![0]} /${names[k]![1]}/`;
  const add = (k: string, sex: "M" | "F", born: string) => { c.P[k] = firstId(strom("person", "add", ged(k), "--sex", sex, "--born", born), "P"); return c.P[k]!; };
  const task = (what: string, about: string[], at: string) =>
    firstId(strom("task", "add", what, "--level", "link", ...about.flatMap((a) => ["--about", a]), "--where", at, "--why", L.why, "--done-when", c.doneWhen), "T");

  // the session on the father's death finds the emigrant son and his family in the letters home
  strom("session", "start", c.sessionTask);
  const parents = ((strom("person", "show", c.P.vaclav!).parentFamilies ?? []) as { id: string }[])[0]!.id;
  const f = add("frantisekH", "M", "1868");
  strom("family", "child", parents, f);
  const w1 = add("hWife1", "F", "1871");
  const son = add("hSon", "M", "1896");
  const w2 = add("hWife2", "F", "1879");
  const dau = add("hDaughter", "F", "1910");
  strom("family", "add", "--partner", f, "--partner", w1, "--child", son, "--married", "1894", "--married-place", where);
  strom("family", "add", "--partner", f, "--partner", w2, "--child", dau, "--married", "1908", "--married-place", where);
  strom("session", "close", "--continue", "--summary", L.summary, "--next", L.next);
  // their tasks outside the session: a task added in a session belongs to the session's line (research 1.26), these
  // belong to none — the branch off the lines (no research of their own, none of their people in a line)
  c.P.tEmig = task(L.emigration(nm("frantisekH")), [f], L.passengers);
  task(L.marriage(nm("frantisekH"), nm("hWife1"), where, "1894"), [f, w1], L.parish(where));
  task(L.baptism(nm("hSon"), where, "1896"), [son], L.parish(where));
  task(L.marriage(nm("frantisekH"), nm("hWife2"), where, "1908"), [f, w2], L.parish(where));
  task(L.baptism(nm("hDaughter"), where, "1910"), [dau], L.parish(where));

  // the person's order of the lines: the question second
  strom("research", "order", c.G.main, c.G.question, c.G.husband, c.G.descendants, c.G.review);
  // one task the person wants next
  strom("task", "order", c.nextTask, "--next");
}
