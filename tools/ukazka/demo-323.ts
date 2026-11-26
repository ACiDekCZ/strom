// The demo's data for the novelties of Strom 3.23 and research 1.27 (section novinky323 of the showcase):
//  - the agent's browser ready: Claude Code (the demo's agent) with the Claude in Chrome extension in a Chrome profile
//    of the demo's own HOME (an empty folder under the extension's ID: strom only looks whether it is there);
//  - an invented archive only a person's browser goes to (strom's known terms of a test's own: STROM_ARCHIVES_FILE in
//    the demo's folder, never strom's list), its book and one task of the miller's wife waiting for two images saved
//    by hand: the app says at that item what the person's permission "through the browser" would let the agent do,
//    and Research for this tree lists the archive without permission, each with Permission….
// Nothing asks the archive (no-net.cjs; the host is under .example).
import fs from "node:fs";
import path from "node:path";

type Lang = "cs" | "en" | "de" | "pl";
interface Texts {
  host: string; name: string; quote: string; repo: string;
  book: string; bookId: string; years: string;
  what: string; images: string; on: string; why: string; doneWhen: string;
}

export const BROWSER_ARCHIVE: Record<Lang, Texts> = {
  cs: {
    host: "matriky.biskupstvi-vzorov.example", name: "Biskupský archiv Vzorov – matriky online",
    quote: "Snímky matrik lze prohlížet a ukládat jen v internetovém prohlížeči; automatizované nástroje do aplikace nesmějí.",
    repo: "Biskupský archiv Vzorov", book: "Vzorová Lhota, N 1835–1860", bookId: "VL-N-1835", years: "1835-1860",
    what: "Křest Barbory Vlkové kolem 1841", images: "18-19",
    on: "Snímky 18–19 z matriky narozených Vzorová Lhota 1835–1860, z matrik online Biskupského archivu Vzorov (jen přes prohlížeč).",
    why: "Odkud přišla Barbora, manželka mlynáře", doneWhen: "Zápis křtu nalezen a přepsán",
  },
  en: {
    host: "registers.example-diocese.example", name: "Example Diocesan Archives – registers online",
    quote: "The register images may be viewed and saved in a web browser only; automated tools may not use the service.",
    repo: "Example Diocesan Archives", book: "Oakley Green, baptisms 1835–1860", bookId: "OG-B-1835", years: "1835-1860",
    what: "Baptism of Martha Fletcher about 1841", images: "18-19",
    on: "Images 18–19 of the Oakley Green baptisms 1835–1860, from the Example Diocesan Archives registers online (browser only).",
    why: "Where Martha, the miller’s wife, came from", doneWhen: "The baptism entry found and transcribed",
  },
  de: {
    host: "kirchenbuecher.bistum-musterstadt.example", name: "Bistumsarchiv Musterstadt – Kirchenbücher online",
    quote: "Die Bilder der Kirchenbücher dürfen nur im Webbrowser angesehen und gespeichert werden; automatisierte Werkzeuge sind nicht zugelassen.",
    repo: "Bistumsarchiv Musterstadt", book: "Musterlingen, Taufen 1835–1860", bookId: "ML-TA-1835", years: "1835-1860",
    what: "Taufe von Barbara Vogel um 1841", images: "18-19",
    on: "Bilder 18–19 der Taufen Musterlingen 1835–1860, aus den Kirchenbüchern online des Bistumsarchivs Musterstadt (nur im Browser).",
    why: "Woher Barbara, die Frau des Müllers, kam", doneWhen: "Der Taufeintrag gefunden und abgeschrieben",
  },
  pl: {
    host: "metryki.diecezja-wzorowo.example", name: "Archiwum Diecezji Wzorowo – metryki online",
    quote: "Skany ksiąg metrykalnych można oglądać i zapisywać tylko w przeglądarce internetowej; narzędzia automatyczne nie mają dostępu.",
    repo: "Archiwum Diecezji Wzorowo", book: "Wzorowo, Liber natorum 1835–1860", bookId: "WZ-U-1835", years: "1835-1860",
    what: "Chrzest Barbary Wilk ok. 1841", images: "18-19",
    on: "Skany 18–19 z księgi urodzeń Wzorowo 1835–1860, z metryk online Archiwum Diecezji Wzorowo (tylko przez przeglądarkę).",
    why: "Skąd pochodziła Barbara, żona młynarza", doneWhen: "Wpis chrztu znaleziony i przepisany",
  },
};

const CLAUDE_IN_CHROME_ID = "fcoeoabgfenejglbffodgkkbkcdhcgfn";

/** Before the demo's first strom command: the pack of known terms and the extension in the demo HOME's Chrome. */
export function prepare323(lang: Lang, dir: string, home: string, env: Record<string, string>): void {
  const a = BROWSER_ARCHIVE[lang];
  const pack = path.join(dir, "archives-pack.json");
  fs.writeFileSync(pack, JSON.stringify({
    archives: [{ host: a.host, name: a.name, level: "restricted", browserOnly: true, terms: `https://${a.host}/podminky`, quote: a.quote, checked: "2026-11-01" }],
  }, null, 2) + "\n");
  env.STROM_ARCHIVES_FILE = pack;
  fs.mkdirSync(path.join(home, "Library", "Application Support", "Google", "Chrome", "Default", "Extensions", CLAUDE_IN_CHROME_ID, "1.0.0_0"), { recursive: true });
}

/** In the session that sets the waiting by place: the archive, its book, the task, waiting for two images. */
export function add323(o: {
  lang: Lang; strom: (...args: string[]) => Record<string, unknown>; id: (j: Record<string, unknown>, p: string) => string;
  country: string; research: string; about: string; place: string;
}): string {
  const a = BROWSER_ARCHIVE[o.lang];
  const R = o.id(o.strom("repo", "add", a.repo, "--country", o.country, "--url", `https://${a.host}`), "R");
  const B = o.id(o.strom("recordset", "add", a.book, "--repo", R, "--kinds", "baptism", "--places", o.place, "--years", a.years, "--access", "online-free", "--url", `https://${a.host}/${a.bookId}`), "B");
  const T = o.id(o.strom("task", "add", a.what, "--level", "link", "--research", o.research, "--about", o.about, "--where", B, "--why", a.why, "--done-when", a.doneWhen), "T");
  o.strom("task", "wait", T, "--images", `${B}:${a.images}`, "--on", a.on);
  return T;
}
