// The texts of the invented demo research, one family per language (the same
// structure, so every screenshot shows the same thing in each). Nothing here is
// a real family. build-demo.ts writes it into a research through the strom CLI;
// gen-scans.mjs draws the register pages to match.

export interface Demo {
  /** The sample's default tree name (the showcase file's `name`, spec 143 UIX §1). */
  sampleName: string;
  tree: string; place: string; place2: string; house: string; // house number; "" where the records give none
  repo: string; country: string; url: string; mediaFrom: string;
  surname: string; surname2: string; surnameKat: string; occ: string;
  research: { main: string; husband: string; descendants: string; review: string; question: string };
  /** key → [GEDCOM name, name as written] */
  people: Record<string, [string, string]>;
  intake: string;
  books: { bapt: string; marr: string; baptOld: string; other: string; petr: string; census: string; grave: string; family: string; records: string; older: string };
  tasks: Record<string, string> & { why: Record<string, string>; doneWhen: Record<string, string> };
  src: Record<string, string>;
  tr: Record<string, string>;
  results: Record<string, string>;
  summaries: Record<string, string>;
  nexts: Record<string, string>;
  reasons: { paused: string; done: string; parked: string };
  notes: { matej: string };
  hypoJosef: string; hypoJosefA: string; hypoJosefB: string; hypoJosefNote: string; searchJosef: string;
  conflict: string; hypo: string; hypoA: string; hypoB: string; hypoNote: string;
  searchNeg: string; searchNote: string; searchNow: string; searchNowNote: string;
  story: { anna: string; annaTitle: string; annaFacts: string[]; josef: string; josefTitle: string };
  waitOn: string; askOn: string;
  /** Ludmila's baptism: the images the user saves (the edge "waiting for you" above her). */
  waitLudmila: string;
  /** The miller's family nothing links to the tree yet (an island), joined to Kateřina by the hypothesis. */
  island: { miller: [string, string]; wife: [string, string]; son: [string, string]; note: string };
  /** The birth registers of the place before the known ones begin, lost (a fire): the edge "lost" above Jan and Anna D. */
  lostBook: string;
  /**
   * An archive whose terms restrict automated download (invented, under example.org): the connector the agent made
   * for it, a book there, the task that needs its images — and the person's decision about them still to come
   * (strom's question, What waits, Settings → Archives, the app's waiting card). Nothing ever asks the host.
   */
  archive: {
    name: string; host: string; title: string; terms: string; reading: string;
    repo: string; book: string; bookId: string; years: string; images: string;
    task: string; summary: string; next: string;
  };
  /**
   * What waits, by the place where it is dealt with (research 1.13.2, What waits): an archive whose images go by hand
   * only (five tasks of images, some saved already), an office three requests go to (their texts in notes/), two
   * requests sent, the family, a site — and two more downloaders for Settings → Archives (one archive on two hosts,
   * one with no hourly cap). Every text a person reads is impersonal.
   */
  waits: Waits;
}

export interface Waits {
  manual: {
    name: string; host: string; title: string; terms: string; reading: string; repo: string;
    books: { name: string; id: string; kinds: string; years: string }[];
    /** book: index into books; have: how many of its images are in the folder already. */
    tasks: { what: string; book: number; images: string; about: string[]; have: number; on: string }[];
    summary: string; next: string;
  };
  /** Letters: `file` in the tree's notes/, `text` its content. */
  office: { to: string; letters: Letter[] };
  sent: (Letter & { to: string; daysAgo: number })[];
  family: { what: string; about: string[]; on: string };
  web: { what: string; about: string[]; on: string; url: string };
  twoHosts: { name: string; title: string; hosts: [string, string]; terms: string; reading: string };
  noCap: { name: string; title: string; host: string; terms: string; reading: string };
  why: { letter: string; photo: string; web: string; mill: string };
  doneWhen: { letter: string; photo: string; web: string; images: string };
}
export interface Letter { what: string; about: string[]; on: string; file: string; text: string }

const cs: Demo = {
  sampleName: "Ukázka – rod Horáků",
  tree: "Horákovi", place: "Dolní Lhota", place2: "Horní Lhota", house: "12",
  repo: "Státní oblastní archiv", country: "cz", url: "https://archiv.example.org/matriky", mediaFrom: "portál archivu",
  surname: "Horák", surname2: "Krejčí", surnameKat: "Vlk", occ: "rolník",
  research: {
    main: "Předci Anny Horákové", husband: "Předci Petra Malého", descendants: "Potomci Václava Horáka",
    review: "Revize: Věra Horáková", question: "Odkud pocházela Kateřina Vlková?",
  },
  people: {
    anna: ["Anna /Horáková/", "Anna Horáková"], josef: ["Josef /Horák/", "Josef Horák"], marie: ["Marie /Krejčí/", "Marie Krejčí"],
    vaclav: ["Václav /Horák/", "Václav Horák"], katerina: ["Kateřina /Vlková/", "Kateřina Vlková"],
    frantisek: ["František /Krejčí/", "František Krejčí"], ludmila: ["Ludmila /Nováková/", "Ludmila Nováková"],
    ruzena: ["Růžena /Horáková/", "Růžena Horáková"], karel: ["Karel /Horák/", "Karel Horák"], vera: ["Věra /Horáková/", "Věra Horáková"],
    petr: ["Petr /Malý/", "Petr Malý"], jana: ["Jana /Malá/", "Jana Malá"],
    jan: ["Jan /Horák/", "Jan Horák"], annaD: ["Anna /Dvořáková/", "Anna Dvořáková"], matej: ["Matěj /Horák/", "Matěj Horák"],
    tomas: ["Tomáš /Krejčí/", "Tomáš Krejčí"], rozalie: ["Rozálie /Černá/", "Rozálie Černá"],
    antonin: ["Antonín /Malý/", "Antonín Malý"], marieK: ["Marie /Kosová/", "Marie Kosová"],
  },
  intake: "Babička Anna se narodila v Dolní Lhotě čp. 12. Její manžel byl Petr Malý, dcera Jana. Sourozenci Karel a Věra. Babička vyprávěla, že prababička Kateřina přišla z mlýna v Horní Lhotě.",
  books: {
    bapt: "Dolní Lhota, N 1890–1935", marr: "Dolní Lhota, O 1890–1930", baptOld: "Dolní Lhota, N 1855–1889",
    other: "Horní Lhota, N 1860–1890", petr: "matrika narozených Horní Lhota 1929", census: "sčítání lidu 1880, Dolní Lhota", grave: "hřbitov v Dolní Lhotě", family: "rodinná paměť", records: "doložené záznamy výzkumu", older: "matriky kolem Dolní Lhoty 1800–1820",
  },
  tasks: {
    annaBapt: "Křest Anny Horákové 1931", parentsMarr: "Oddavky Josefa Horáka a Marie Krejčí", josefBapt: "Křest Josefa Horáka kolem 1898",
    marieBapt: "Křest Marie Krejčí kolem 1902", vaclavBapt: "Křest Václava Horáka kolem 1865", petrBirth: "Narození Petra Malého 1929",
    frantisekBapt: "Křest Františka Krejčího kolem 1874", katSearch: "Křty Vlků v Horní Lhotě", story: "Vyprávění o Anně Horákové",
    gpMarr: "Oddavky Václava Horáka a Kateřiny Vlkové", askFamily: "Kde se narodil Petr Malý?", mgMarr: "Oddavky Františka Krejčího a Ludmily Novákové",
    census1880: "Sčítání lidu 1880 v Dolní Lhotě", janDeath: "Úmrtí Jana Horáka kolem 1901", ludmilaBapt: "Křest Ludmily Novákové kolem 1876",
    antoninBapt: "Křest Antonína Malého", katReread: "Znovu přečíst oddavky: odkud byla nevěsta", grave: "Hrob rodiny Horákových",
    janMarr: "Oddavky Jana Horáka a Anny Dvořákové", matejBapt: "Kde je zapsán křest Matěje Horáka kolem 1810?", antoninMarr: "Oddavky Antonína Malého a Marie Kosové", tomasMarr: "Oddavky Tomáše Krejčího a Rozálie Černé", storyJosef: "Vyprávění o Josefu Horákovi",
    katBapt: "Křest Kateřiny Vlkové kolem 1870",
    why: {
      parents: "rodiče", grandparents: "rodiče obou snoubenců", birth: "datum a místo narození", origin: "odkud pocházela",
      katParents: "rodiče Kateřiny", askFamily: "matrika zatím nenalezena", household: "domácnost a děti", death: "datum úmrtí", grave: "nápis na náhrobku", story: "příběh do rodinné knihy",
    },
    doneWhen: { entry: "zápis nalezen", searched: "prohledáno celé", household: "domácnost nalezena", photo: "fotografie náhrobku", story: "vyprávění napsáno", answer: "odpověď rodiny" },
  },
  src: {
    anna: "Křest Anny Horákové 1931", marr: "Oddavky Josefa Horáka a Marie Krejčí 1924", josef: "Křest Josefa Horáka 1898",
    census: "Sčítání lidu 1921, Dolní Lhota čp. 12", marie: "Křest Marie Krejčí 1902", vaclav: "Křest Václava Horáka 1865",
    petr: "Narození Petra Malého 1929", frantisek: "Křest Františka Krejčího 1874",
  },
  tr: {
    anna: "Anna, nar. 14. ledna, křtěna 18. ledna 1931, Dolní Lhota čp. 12. Otec Josef Horák, rolník, syn Václava Horáka a Kateřiny roz. Vlkové. Matka Marie roz. Krejčí, dcera Františka Krejčího a Ludmily roz. Novákové. Kmotra Růžena Horáková, svobodná.",
    marr: "12. května 1924. Ženich Josef Horák, rolník, Dolní Lhota čp. 12, syn Václava Horáka a Kateřiny roz. Vlkové, 26 let. Nevěsta Marie Krejčí, Dolní Lhota čp. 31, dcera Františka Krejčího a Ludmily roz. Novákové, 21 let.",
    josef: "Josephus, natus 3. Martii 1898, Dolní Lhota No. 12. Pater Wenceslaus Horák, agricola, filius Joannis Horák. Mater Catharina nata Vlk, filia Joannis Vlk ex Horní Lhota.",
    josefTr: "Josef, narozen 3. března 1898, Dolní Lhota čp. 12. Otec Václav Horák, rolník, syn Jana Horáka. Matka Kateřina roz. Vlková, dcera Jana Vlka z Horní Lhoty.",
    census: "Josef Horák, hlava domácnosti, nar. 1897, rolník, Dolní Lhota čp. 12.",
    marie: "Marie, nar. 20. srpna 1902, Dolní Lhota čp. 31. Otec František Krejčí, kovář. Matka Ludmila roz. Nováková.",
    vaclav: "Wenceslaus, natus 1. Octobris 1865. Pater Joannes Horák, filius Matthiae Horák. Mater Anna nata Dvořák.",
    petr: "Petr, nar. 7. června 1929 v Horní Lhotě. Otec Antonín Malý, tesař. Matka Marie roz. Kosová.",
    frantisek: "Franciscus, natus 12. Februarii 1874. Pater Thomas Krejčí, faber ferrarius. Mater Rosalia nata Černá.",
  },
  results: {
    intake: "rodinná paměť zapsána: 4 osoby, 1 rodina",
    anna: "zápis křtu nalezen: rodiče Josef Horák a Marie Krejčí", marr: "oddavky 1924 nalezeny, rodiče obou snoubenců známí",
    josef: "křest 3. 3. 1898 nalezen; sčítání uvádí 1897", marie: "křest 20. 8. 1902 nalezen", vaclav: "křest 1865 nalezen, rodiče Jan Horák a Anna Dvořáková",
    petr: "narození 1929 nalezeno, rodiče Antonín Malý a Marie Kosová", frantisek: "křest 1874 nalezen, rodiče Tomáš Krejčí a Rozálie Černá",
    kat: "v Horní Lhotě 1866–1872 žádná Kateřina Vlková", story: "vyprávění napsáno",
  },
  summaries: {
    // the sample's last session (build-demo.ts SHOWCASE_SAMPLE=1): closed, to be continued
    paused: "Druhé čtení křtů rozpracováno (snímky 1–60 z 90), pokračuje se příště.",
    intake: "Zapsáno, co ví rodina: manžel Petr, dcera Jana, sourozenci Karel a Věra.", storyJosef: "Vyprávění o Josefovi napsáno z doložených zápisů.", wait: "Oddací matrika je jen k prohlížení, snímky 40–45 uloží uživatel.",
    anna: "Křest Anny 1931 nalezen: rodiče Josef Horák a Marie Krejčí.", marr: "Oddavky 1924: Josefovi rodiče Václav a Kateřina, Mariini František a Ludmila.",
    josef: "Josef pokřtěn 3. 3. 1898; sčítání 1921 uvádí rok 1897, rozpor zapsán.", marie: "Marie pokřtěna 24. 8. 1902, narozena 20. 8.",
    vaclav: "Křest Václava 1865: rodiče Jan Horák a Anna Dvořáková, děd Matěj.", petr: "Petr Malý narozen 7. 6. 1929 v Horní Lhotě.",
    frantisek: "Křest Františka 1874: rodiče Tomáš Krejčí a Rozálie Černá.", kat: "Kateřina v křtech Horní Lhoty 1866–1872 není, hledat dál.",
    story: "Vyprávění o Anně a Josefovi napsáno z doložených zápisů.",
  },
  nexts: {
    // the sample's last session (build-demo.ts SHOWCASE_SAMPLE=1): closed, to be continued
    paused: "dočíst snímky 61–90",
    intake: "křest Anny 1931", wait: "po uložení snímků přečíst oddavky",
    anna: "oddavky rodičů kolem 1924", marr: "křest Josefa kolem 1898", josef: "křest Marie kolem 1902", marie: "křest Václava kolem 1865",
    vaclav: "úmrtí Jana Horáka", petr: "křest Antonína Malého", frantisek: "oddavky Františka a Ludmily", kat: "křty Horní Lhoty 1868–1872 znovu, mlýn čp. 5", story: "rodiče Kateřiny",
  },
  reasons: { paused: "matriky Horní Lhoty po roce 1900 ještě nejsou online", done: "vše doloženo", parked: "až na jaře" },
  notes: { matej: "otec Jana Horáka podle křtu Václava" },
  hypoJosef: "Sloužil Josef za 1. světové války?", hypoJosefA: "A: sloužil u pěšího pluku", hypoJosefB: "B: jako rolník byl uvolněn", hypoJosefNote: "V roce 1917 mu bylo 19 let. Rozhodne vojenská kmenová kniha.", searchJosef: "Vojenské kmenové listy, ročník 1898",
  conflict: "Rok narození Josefa Horáka", hypo: "Byla Kateřina Vlková z mlýna v Horní Lhotě?",
  hypoA: "A: dcera Jana Vlka z Horní Lhoty čp. 5", hypoB: "B: dcera Josefa Vlka, mlynáře",
  hypoNote: "Rodinná paměť říká mlýn, křest Josefa 1898 říká Jan Vlk. Rozhodne její křest.",
  searchNeg: "Křty Vlků v Horní Lhotě 1866–1872", searchNote: "celé prohledáno, Kateřina Vlková tam není",
  searchNow: "Křty Vlků v Horní Lhotě 1868–1872, druhé čtení", searchNowNote: "rozpracováno: snímky 1–60 z 90",
  story: {
    annaTitle: "Dítě z čp. 12",
    anna: "Anna Horáková se narodila **14. ledna 1931** v Dolní Lhotě, v domě čp. 12, kde její rodina hospodařila už dvě generace. Pokřtěna byla o čtyři dny později.\n\n## Rodiče\n\nJejí otec Josef, *rolník*, se o sedm let dříve oženil s Marií Krejčí z téže vesnice.\n\n- otec: Josef Horák, narozen 1898\n- matka: Marie roz. Krejčí, narozena 1902\n- kmotra: teta Růžena Horáková\n\n## Sourozenci\n\nAnna měla staršího bratra Karla a mladší sestru Věru.",
    annaFacts: [
      "narození 14. 1. 1931, Dolní Lhota čp. 12",
      "křest 18. 1. 1931, kmotra Růžena Horáková (N 1890–1935, fol. 112)",
      "rodiče Josef Horák, rolník, a Marie roz. Krejčí",
      "oddavky rodičů 12. 5. 1924 v Dolní Lhotě",
      "sourozenci Karel a Věra",
    ],
    josefTitle: "Hospodář z Dolní Lhoty",
    josef: "Josef Horák se narodil **3. března 1898** jako syn Václava a Kateřiny.\n\nV roce 1924 se oženil s Marií Krejčí a převzal po otci hospodářství v čp. 12.",
  },
  waitOn: "Snímky 40–45 z oddací matriky Dolní Lhota 1890–1930 k uložení ručně: portál archivu nedovoluje stahování programem.",
  askOn: "Odpověď rodiny: ví někdo, kde přesně se Petr Malý narodil?",
  island: { miller: ["Josef /Vlk/", "Josef Vlk"], wife: ["Barbora /Vlková/", "Barbora Vlková"], son: ["Jan /Vlk/", "Jan Vlk"], note: "mlynář, mlýn v Horní Lhotě" },
  lostBook: "Dolní Lhota, N 1830–1854 (shořela 1856)",
  archive: {
    name: "matriky-vzorov", host: "matriky.example.org", title: "Digitální matriky Vzorov", terms: "https://matriky.example.org/podminky",
    reading: "Snímky matrik jsou volně k nahlížení; automatické stahování je omezené – jen pomalu a jen snímky pro konkrétní bádání.",
    repo: "Digitální matriky Vzorov", book: "Horní Lhota, O 1860–1875", bookId: "HL-O-1860", years: "1860-1875", images: "12-14",
    task: "Oddavky Vlků v Horní Lhotě 1860–1875",
    summary: "Oddací matrika Horní Lhoty je na portálu Digitální matriky Vzorov. Podmínky omezují automatické stahování: snímky 12–14 čekají na rozhodnutí.",
    next: "Po rozhodnutí stáhnout snímky 12–14 a najít oddavky rodičů Kateřiny Vlkové.",
  },
  waitLudmila: "Snímky 60–64 z matriky narozených Dolní Lhota 1855–1889 k uložení ručně: portál archivu nedovoluje stahování programem.",
  waits: {
    manual: {
      name: "archiv-vzorov", host: "badatelna.archiv-vzorov.example", title: "Archiv Vzorov – digitální badatelna", terms: "https://badatelna.archiv-vzorov.example/badatelsky-rad",
      reading: "Snímky jsou jen k prohlížení v digitální badatelně; badatelský řád dovoluje ukládat je jen ručně, žádnému programu.",
      repo: "Archiv Vzorov",
      books: [
        { name: "Horní Lhota, N 1830–1859", id: "HL-N-1830", kinds: "baptism", years: "1830-1859" },
        { name: "Horní Lhota, O 1830–1859", id: "HL-O-1830", kinds: "marriage", years: "1830-1859" },
        { name: "Horní Lhota, Z 1850–1900", id: "HL-Z-1850", kinds: "death", years: "1850-1900" },
        { name: "Soupis obyvatel Horní Lhota 1869", id: "HL-S-1869", kinds: "census", years: "1869-1869" },
      ],
      tasks: [
        { what: "Křest Josefa Vlka kolem 1838", book: 0, images: "112-115", about: ["miller"], have: 2, on: "Snímky 112–115 z matriky narozených Horní Lhota 1830–1859, k uložení ručně z digitální badatelny Archivu Vzorov." },
        { what: "Oddavky Josefa Vlka a Barbory", book: 1, images: "77-79", about: ["miller", "millerWife"], have: 0, on: "Snímky 77–79 z oddací matriky Horní Lhota 1830–1859, k uložení ručně z digitální badatelny Archivu Vzorov." },
        { what: "Soupis obyvatel 1869: mlýn čp. 5 v Horní Lhotě", book: 3, images: "5-8", about: ["miller", "millerWife", "millerSon"], have: 3, on: "Snímky 5–8 ze soupisu obyvatel Horní Lhota 1869, k uložení ručně z digitální badatelny Archivu Vzorov." },
        { what: "Úmrtí Josefa Vlka, mlynáře", book: 2, images: "140-142", about: ["miller"], have: 0, on: "Snímky 140–142 z matriky zemřelých Horní Lhota 1850–1900, k uložení ručně z digitální badatelny Archivu Vzorov." },
        { what: "Úmrtí Barbory Vlkové", book: 2, images: "201-202", about: ["millerWife"], have: 1, on: "Snímky 201–202 z matriky zemřelých Horní Lhota 1850–1900, k uložení ručně z digitální badatelny Archivu Vzorov." },
      ],
      summary: "Archiv Vzorov dovoluje snímky jen ručně: pět úkolů čeká na uložení snímků, žádosti na MěÚ Vzorová Lhota jsou připravené v notes/.",
      next: "po uložení snímků přečíst zápisy rodiny Vlků z mlýna",
    },
    office: {
      to: "MěÚ Vzorová Lhota",
      letters: [
        {
          what: "Výpis z matriky oddaných: Petr Malý a Anna Horáková", about: ["petr", "anna"], file: "notes/zadost-meu-oddavky-maly.md",
          on: "Odeslat žádost o výpis z matriky oddaných (Petr Malý a Anna Horáková, kolem 1955) a počkat na odpověď MěÚ Vzorová Lhota.",
          text: "MěÚ Vzorová Lhota, matrika\n\nDobrý den,\n\nžádám o vydání úplného výpisu z matriky oddaných pro sňatek Petra Malého (nar. 7. 6. 1929 v Horní Lhotě) a Anny Horákové (nar. 14. 1. 1931 v Dolní Lhotě), uzavřený kolem roku 1955.\n\nJsem jejich dcera; výpis slouží k rodopisnému bádání.\n\nS pozdravem\nJana Malá",
        },
        {
          what: "Výpis z matriky zemřelých: Antonín Malý", about: ["antonin"], file: "notes/zadost-meu-umrti-antonin.md",
          on: "Odeslat žádost o výpis z matriky zemřelých (Antonín Malý, tesař, zemřel po roce 1950) a počkat na odpověď MěÚ Vzorová Lhota.",
          text: "MěÚ Vzorová Lhota, matrika\n\nDobrý den,\n\nžádám o vydání výpisu z matriky zemřelých pro Antonína Malého, tesaře z Horní Lhoty, který zemřel po roce 1950.\n\nJsem jeho vnučka; výpis slouží k rodopisnému bádání.\n\nS pozdravem\nJana Malá",
        },
        {
          what: "Výpis z matriky narozených: Marie Kosová", about: ["marieK"], file: "notes/zadost-meu-narozeni-kosova.md",
          on: "Odeslat žádost o výpis z matriky narozených (Marie Kosová, kolem 1905) a počkat na odpověď MěÚ Vzorová Lhota.",
          text: "MěÚ Vzorová Lhota, matrika\n\nDobrý den,\n\nžádám o vydání výpisu z matriky narozených pro Marii Kosovou, narozenou kolem roku 1905, pozdější manželku Antonína Malého z Horní Lhoty.\n\nJsem její vnučka; výpis slouží k rodopisnému bádání.\n\nS pozdravem\nJana Malá",
        },
      ],
    },
    sent: [
      {
        what: "Farní kronika Horní Lhoty: zmínky o mlýně a rodině Vlků", about: ["katerina"], to: "Farní úřad Horní Lhota", daysAgo: 9, file: "notes/dotaz-fara-kronika.md",
        on: "Odpověď Farního úřadu Horní Lhota na dotaz k farní kronice (mlýn čp. 5, rodina Vlků).",
        text: "Farní úřad Horní Lhota\n\nDobrý den,\n\nobracím se s dotazem, zda farní kronika Horní Lhoty zmiňuje mlýn čp. 5 a rodinu mlynáře Josefa Vlka (kolem 1860–1880).\n\nS pozdravem\nJana Malá",
      },
      {
        what: "Pozemková kniha: dům Malých v Horní Lhotě", about: ["antonin", "marieK"], to: "SOkA Vzorov", daysAgo: 4, file: "notes/dotaz-soka-pozemkova-kniha.md",
        on: "Odpověď SOkA Vzorov na dotaz k pozemkové knize Horní Lhoty (dům Antonína Malého).",
        text: "Státní okresní archiv Vzorov\n\nDobrý den,\n\nprosím o informaci, zda archiv uchovává pozemkovou knihu Horní Lhoty se záznamem o domě Antonína Malého (kolem 1925–1935).\n\nS pozdravem\nJana Malá",
      },
    ],
    family: { what: "Svatební fotografie Petra a Anny Malých", about: ["petr", "anna"], on: "Fotografie ze svatby Petra a Anny Malých, pokud se v rodině dochovala." },
    web: {
      what: "Kmenový list Josefa Horáka (ročník 1898)", about: ["josef"], url: "https://vojenske-listy.example/rocnik-1898/horak-josef",
      on: "Kmenový list Josefa Horáka k dohledání v digitalizovaných vojenských listech: https://vojenske-listy.example/rocnik-1898/horak-josef",
    },
    twoHosts: {
      name: "krajske-matriky", title: "Krajské matriky online", hosts: ["matriky.kraj-vzorov.example", "snimky.kraj-vzorov.example"], terms: "https://matriky.kraj-vzorov.example/podminky",
      reading: "Snímky matrik jsou volně ke stažení i programem, v tempu, které portál uvádí.",
    },
    noCap: {
      name: "hroby-vzorov", title: "Hroby Vzorov", host: "hroby-vzorov.example", terms: "https://hroby-vzorov.example/o-projektu",
      reading: "Fotografie náhrobků jsou volně k dispozici, stahování programem portál výslovně dovoluje.",
    },
    why: { letter: "úřední záznam", photo: "fotografie do rodinné knihy", web: "vojenská služba", mill: "rodina z mlýna" },
    doneWhen: { letter: "odpověď úřadu", photo: "fotografie nalezena", web: "kmenový list nalezen", images: "snímky uloženy a přečteny" },
  },
};

const en: Demo = {
  sampleName: "Sample – the Hartley family",
  tree: "Hartley family", place: "Thornbury", place2: "Oakley", house: "",
  repo: "County Record Office", country: "gb", url: "https://records.example.org/registers", mediaFrom: "the record office's portal",
  surname: "Hartley", surname2: "Cooper", surnameKat: "Fletcher", occ: "farmer",
  research: {
    main: "Ancestors of Emily Hartley", husband: "Ancestors of Peter Walsh", descendants: "Descendants of William Hartley",
    review: "Review: Margaret Hartley", question: "Where did Sarah Fletcher come from?",
  },
  people: {
    anna: ["Emily /Hartley/", "Emily Hartley"], josef: ["Thomas /Hartley/", "Thomas Hartley"], marie: ["Mary /Cooper/", "Mary Cooper"],
    vaclav: ["William /Hartley/", "William Hartley"], katerina: ["Sarah /Fletcher/", "Sarah Fletcher"],
    frantisek: ["George /Cooper/", "George Cooper"], ludmila: ["Alice /Bennett/", "Alice Bennett"],
    ruzena: ["Edith /Hartley/", "Edith Hartley"], karel: ["Charles /Hartley/", "Charles Hartley"], vera: ["Margaret /Hartley/", "Margaret Hartley"],
    petr: ["Peter /Walsh/", "Peter Walsh"], jana: ["Jane /Walsh/", "Jane Walsh"],
    jan: ["John /Hartley/", "John Hartley"], annaD: ["Ann /Dawson/", "Ann Dawson"], matej: ["Richard /Hartley/", "Richard Hartley"],
    tomas: ["Samuel /Cooper/", "Samuel Cooper"], rozalie: ["Hannah /Price/", "Hannah Price"],
    antonin: ["Arthur /Walsh/", "Arthur Walsh"], marieK: ["Florence /Hill/", "Florence Hill"],
  },
  intake: "Grandma Emily was born in Thornbury, on Mill Lane. Her husband was Peter Walsh, their daughter Jane. Her brother Charles and sister Margaret. Grandma used to say her grandmother Sarah came from the mill at Oakley.",
  books: {
    bapt: "St Mary, Thornbury, baptisms 1890–1935", marr: "St Mary, Thornbury, marriages 1890–1930", baptOld: "St Mary, Thornbury, baptisms 1855–1889",
    other: "St John, Oakley, baptisms 1860–1890", petr: "birth register, Oakley 1929", census: "1881 census, Thornbury", grave: "Thornbury churchyard", family: "the family's memory", records: "the proven records of the research", older: "registers around Thornbury 1800–1820",
  },
  tasks: {
    annaBapt: "Baptism of Emily Hartley 1931", parentsMarr: "Marriage of Thomas Hartley and Mary Cooper", josefBapt: "Baptism of Thomas Hartley about 1898",
    marieBapt: "Baptism of Mary Cooper about 1902", vaclavBapt: "Baptism of William Hartley about 1865", petrBirth: "Birth of Peter Walsh 1929",
    frantisekBapt: "Baptism of George Cooper about 1874", katSearch: "Fletcher baptisms in Oakley", story: "The story of Emily Hartley",
    gpMarr: "Marriage of William Hartley and Sarah Fletcher", askFamily: "Where was Peter Walsh born?", mgMarr: "Marriage of George Cooper and Alice Bennett",
    census1880: "1881 census for Thornbury", janDeath: "Burial of John Hartley about 1901", ludmilaBapt: "Baptism of Alice Bennett about 1876",
    antoninBapt: "Baptism of Arthur Walsh", katReread: "Read the marriage again: where the bride came from", grave: "Hartley family grave",
    janMarr: "Marriage of John Hartley and Ann Dawson", matejBapt: "Where was Richard Hartley baptised about 1810?", antoninMarr: "Marriage of Arthur Walsh and Florence Hill", tomasMarr: "Marriage of Samuel Cooper and Hannah Price", storyJosef: "The story of Thomas Hartley",
    katBapt: "Baptism of Sarah Fletcher about 1870",
    why: {
      parents: "parents", grandparents: "parents of both", birth: "date and place of birth", origin: "where she came from",
      katParents: "Sarah's parents", askFamily: "no register found yet", household: "household and children", death: "date of death", grave: "the inscription", story: "a story for the family book",
    },
    doneWhen: { entry: "entry found", searched: "searched completely", household: "household found", photo: "photo of the headstone", story: "story written", answer: "the family's answer" },
  },
  src: {
    anna: "Baptism of Emily Hartley 1931", marr: "Marriage of Thomas Hartley and Mary Cooper 1924", josef: "Baptism of Thomas Hartley 1898",
    census: "1921 census, Thornbury, Mill Lane", marie: "Baptism of Mary Cooper 1902", vaclav: "Baptism of William Hartley 1865",
    petr: "Birth of Peter Walsh 1929", frantisek: "Baptism of George Cooper 1874",
  },
  tr: {
    anna: "No. 893. Baptised January 18th 1931, born January 14th. Emily, daughter of Thomas and Mary Hartley, Mill Lane, farmer. H. Ellis, Vicar.",
    marr: "No. 115. May 12th 1924. Thomas Hartley, 26, bachelor, farmer; father William Hartley, farmer. Mary Cooper, 21, spinster; father George Cooper, blacksmith.",
    josef: "No. 162. Baptised March 3rd 1898. Thomas, son of William and Sarah Hartley, Mill Lane, labourer. R. Price, Curate.",
    josefTr: "Thomas, baptised 3 March 1898 in Thornbury, son of William and Sarah Hartley of Mill Lane.",
    census: "Thomas Hartley, head, 24, farmer, born Thornbury, Mill Lane.",
    marie: "Mary, daughter of George and Alice Cooper, Church Street, blacksmith. Born August 20th 1902.",
    vaclav: "William, son of John and Ann Hartley, Mill Lane, labourer. Baptised October 2nd 1865.",
    petr: "Peter Walsh, born June 7th 1929 at Oakley. Father Arthur Walsh, carpenter. Mother Florence Walsh, formerly Hill.",
    frantisek: "George, son of Samuel and Hannah Cooper, blacksmith. Baptised February 15th 1874.",
  },
  results: {
    intake: "the family's memory recorded: 4 people, 1 family",
    anna: "baptism found: parents Thomas Hartley and Mary Cooper", marr: "1924 marriage found, fathers of both named",
    josef: "baptism 3 March 1898 found; the census implies 1897", marie: "baptism 1902 found", vaclav: "baptism 1865 found, parents John Hartley and Ann Dawson",
    petr: "birth 1929 found, parents Arthur Walsh and Florence Hill", frantisek: "baptism 1874 found, parents Samuel Cooper and Hannah Price",
    kat: "no Sarah Fletcher in Oakley 1866–1872", story: "story written",
  },
  summaries: {
    // the sample's last session (build-demo.ts SHOWCASE_SAMPLE=1): closed, to be continued
    paused: "Second reading of the baptisms in progress (images 1–60 of 90), to be continued.",
    intake: "Recorded what the family knows: husband Peter, daughter Jane, brother Charles and sister Margaret.", storyJosef: "The story of Thomas written from the proven entries.", wait: "The marriage register can only be viewed; the user saves images 40–45.",
    anna: "Emily's baptism 1931 found: parents Thomas Hartley and Mary Cooper.", marr: "1924 marriage: Thomas's father William, Mary's father George.",
    josef: "Thomas baptised 3 March 1898; the 1921 census implies 1897, conflict recorded.", marie: "Mary baptised 1902, born 20 August.",
    vaclav: "William's baptism 1865: parents John Hartley and Ann Dawson, grandfather Richard.", petr: "Peter Walsh born 7 June 1929 at Oakley.",
    frantisek: "George's baptism 1874: parents Samuel Cooper and Hannah Price.", kat: "Sarah is not in the Oakley baptisms 1866–1872; search on.",
    story: "The stories of Emily and Thomas written from the proven entries.",
  },
  nexts: {
    // the sample's last session (build-demo.ts SHOWCASE_SAMPLE=1): closed, to be continued
    paused: "read images 61–90",
    intake: "Emily's baptism 1931", wait: "read the marriage once the images are saved",
    anna: "parents' marriage about 1924", marr: "Thomas's baptism about 1898", josef: "Mary's baptism about 1902", marie: "William's baptism about 1865",
    vaclav: "John Hartley's burial", petr: "Arthur Walsh's baptism", frantisek: "marriage of George and Alice", kat: "Oakley baptisms 1868–1872 again, the mill", story: "Sarah's parents",
  },
  reasons: { paused: "the Oakley registers after 1900 are not online yet", done: "everything proven", parked: "in spring" },
  notes: { matej: "John Hartley's father, from William's baptism" },
  hypoJosef: "Did Thomas serve in the First World War?", hypoJosefA: "A: served in the infantry", hypoJosefB: "B: exempt as a farmer", hypoJosefNote: "He was 19 in 1917. The army service records will decide it.", searchJosef: "Army service records, men born 1898",
  conflict: "Birth year of Thomas Hartley", hypo: "Was Sarah Fletcher from the mill at Oakley?",
  hypoA: "A: daughter of John Fletcher of Oakley Farm", hypoB: "B: daughter of James Fletcher, miller",
  hypoNote: "The family says the mill; the 1898 baptism is silent. Her own baptism will decide it.",
  searchNeg: "Fletcher baptisms in Oakley 1866–1872", searchNote: "searched completely, no Sarah Fletcher",
  searchNow: "Fletcher baptisms in Oakley 1868–1872, second reading", searchNowNote: "in progress: images 1–60 of 90",
  story: {
    annaTitle: "The child of Mill Lane",
    anna: "Emily Hartley was born on **14 January 1931** in Thornbury, in the farmhouse on Mill Lane her family had worked for two generations. She was baptised four days later at St Mary's.\n\n## Her parents\n\nHer father Thomas, a *farmer*, had married Mary Cooper of the same village seven years before.\n\n- father: Thomas Hartley, born 1898\n- mother: Mary, born Cooper in 1902\n- officiating: the vicar, H. Ellis\n\n## Brother and sister\n\nEmily had an elder brother, Charles, and a younger sister, Margaret.",
    annaFacts: [
      "birth 14 January 1931, Mill Lane, Thornbury",
      "baptism 18 January 1931, St Mary's, Thornbury (baptisms 1890–1935, no. 893)",
      "parents Thomas Hartley, farmer, and Mary, born Cooper",
      "parents' marriage 12 May 1924 in Thornbury",
      "brother Charles and sister Margaret",
    ],
    josefTitle: "The farmer of Mill Lane",
    josef: "Thomas Hartley was born in **March 1898**, the son of William and Sarah.\n\nIn 1924 he married Mary Cooper and took over the farm on Mill Lane from his father.",
  },
  waitOn: "Images 40–45 of the Thornbury marriages 1890–1930 to be saved by hand: the record office's portal allows no downloading by a program.",
  askOn: "The family's answer: does anyone know where exactly Peter Walsh was born?",
  island: { miller: ["James /Fletcher/", "James Fletcher"], wife: ["Martha /Fletcher/", "Martha Fletcher"], son: ["John /Fletcher/", "John Fletcher"], note: "miller, Oakley Mill" },
  lostBook: "St Mary, Thornbury, baptisms 1830–1854 (burnt 1856)",
  archive: {
    name: "county-archives", host: "archives.example.org", title: "Example County Archives Online", terms: "https://archives.example.org/terms",
    reading: "Register images are free to view; automated downloading is restricted – slowly, and only the images a specific piece of research needs.",
    repo: "Example County Archives", book: "Oakley, marriages 1860–1875", bookId: "OAK-M-1860", years: "1860-1875", images: "12-14",
    task: "Fletcher marriages at Oakley 1860–1875",
    summary: "The Oakley marriage register is on Example County Archives Online. Its terms restrict automated downloading: images 12–14 wait for a decision.",
    next: "Once decided, fetch images 12–14 and find the marriage of Sarah Fletcher's parents.",
  },
  waitLudmila: "Images 60–64 of St Mary, Thornbury, baptisms 1855–1889 to be saved by hand: the record office's portal allows no downloading by a program.",
  waits: {
    manual: {
      name: "borough-archives", host: "readingroom.borough-archives.example", title: "Example Borough Archives – reading room", terms: "https://readingroom.borough-archives.example/rules",
      reading: "The images are for viewing in the online reading room only; its rules allow saving them by hand, never by a program.",
      repo: "Example Borough Archives",
      books: [
        { name: "St John, Oakley, baptisms 1830–1859", id: "OAK-B-1830", kinds: "baptism", years: "1830-1859" },
        { name: "St John, Oakley, marriages 1830–1859", id: "OAK-M-1830", kinds: "marriage", years: "1830-1859" },
        { name: "St John, Oakley, burials 1850–1900", id: "OAK-D-1850", kinds: "burial", years: "1850-1900" },
        { name: "1871 census, Oakley", id: "OAK-C-1871", kinds: "census", years: "1871-1871" },
      ],
      tasks: [
        { what: "Baptism of James Fletcher about 1838", book: 0, images: "112-115", about: ["miller"], have: 2, on: "Images 112–115 of the Oakley baptisms 1830–1859, to be saved by hand from the Example Borough Archives reading room." },
        { what: "Marriage of James Fletcher and Martha", book: 1, images: "77-79", about: ["miller", "millerWife"], have: 0, on: "Images 77–79 of the Oakley marriages 1830–1859, to be saved by hand from the Example Borough Archives reading room." },
        { what: "1871 census: Oakley Mill", book: 3, images: "5-8", about: ["miller", "millerWife", "millerSon"], have: 3, on: "Images 5–8 of the 1871 census of Oakley, to be saved by hand from the Example Borough Archives reading room." },
        { what: "Burial of James Fletcher, miller", book: 2, images: "140-142", about: ["miller"], have: 0, on: "Images 140–142 of the Oakley burials 1850–1900, to be saved by hand from the Example Borough Archives reading room." },
        { what: "Burial of Martha Fletcher", book: 2, images: "201-202", about: ["millerWife"], have: 1, on: "Images 201–202 of the Oakley burials 1850–1900, to be saved by hand from the Example Borough Archives reading room." },
      ],
      summary: "Example Borough Archives allows its images by hand only: five tasks wait for images to be saved, the requests to the register office are ready in notes/.",
      next: "once the images are saved, read the Fletcher entries of the mill",
    },
    office: {
      to: "Oakley Register Office",
      letters: [
        {
          what: "Marriage certificate: Peter Walsh and Emily Hartley", about: ["petr", "anna"], file: "notes/request-register-office-marriage-walsh.md",
          on: "Request for a marriage certificate (Peter Walsh and Emily Hartley, about 1955) to be sent; then the reply of Oakley Register Office.",
          text: "Oakley Register Office\n\nDear Sir or Madam,\n\nI would like to order a copy of the marriage certificate of Peter Walsh (born 7 June 1929 in Oakley) and Emily Hartley (born 14 January 1931 in Thornbury), married about 1955.\n\nI am their daughter; the certificate is for family history research.\n\nYours faithfully,\nJane Walsh",
        },
        {
          what: "Death certificate: Arthur Walsh", about: ["antonin"], file: "notes/request-register-office-death-arthur.md",
          on: "Request for a death certificate (Arthur Walsh, carpenter, died after 1950) to be sent; then the reply of Oakley Register Office.",
          text: "Oakley Register Office\n\nDear Sir or Madam,\n\nI would like to order a copy of the death certificate of Arthur Walsh, carpenter of Oakley, who died after 1950.\n\nI am his granddaughter; the certificate is for family history research.\n\nYours faithfully,\nJane Walsh",
        },
        {
          what: "Birth certificate: Florence Hill", about: ["marieK"], file: "notes/request-register-office-birth-hill.md",
          on: "Request for a birth certificate (Florence Hill, about 1905) to be sent; then the reply of Oakley Register Office.",
          text: "Oakley Register Office\n\nDear Sir or Madam,\n\nI would like to order a copy of the birth certificate of Florence Hill, born about 1905, later the wife of Arthur Walsh of Oakley.\n\nI am her granddaughter; the certificate is for family history research.\n\nYours faithfully,\nJane Walsh",
        },
      ],
    },
    sent: [
      {
        what: "Oakley parish chronicle: the mill and the Fletchers", about: ["katerina"], to: "St John's Parish Office, Oakley", daysAgo: 9, file: "notes/request-parish-chronicle.md",
        on: "Reply of St John's Parish Office, Oakley, to the request about the parish chronicle (Oakley Mill, the Fletchers).",
        text: "St John's Parish Office, Oakley\n\nDear Sir or Madam,\n\nI am writing to ask whether the parish chronicle of Oakley mentions Oakley Mill and the family of the miller James Fletcher (about 1860–1880).\n\nYours faithfully,\nJane Walsh",
      },
      {
        what: "Land records: the Walsh house at Oakley", about: ["antonin", "marieK"], to: "County Record Office", daysAgo: 4, file: "notes/request-record-office-land.md",
        on: "Reply of the County Record Office to the request about the Oakley land records (the house of Arthur Walsh).",
        text: "County Record Office\n\nDear Sir or Madam,\n\nCould you tell me whether the office holds the Oakley land records with an entry for the house of Arthur Walsh (about 1925–1935)?\n\nYours faithfully,\nJane Walsh",
      },
    ],
    family: { what: "Wedding photograph of Peter and Emily Walsh", about: ["petr", "anna"], on: "A photograph of the wedding of Peter and Emily Walsh, if one survives in the family." },
    web: {
      what: "Service record of Thomas Hartley (born 1898)", about: ["josef"], url: "https://service-records.example/1898/hartley-thomas",
      on: "Service record of Thomas Hartley to be looked up in the digitised army records: https://service-records.example/1898/hartley-thomas",
    },
    twoHosts: {
      name: "county-registers", title: "County Registers Online", hosts: ["registers.county-registers.example", "images.county-registers.example"], terms: "https://registers.county-registers.example/terms",
      reading: "Register images are free to download, by a program too, at the pace the portal states.",
    },
    noCap: {
      name: "graves-example", title: "Example Graves", host: "example-graves.example", terms: "https://example-graves.example/about",
      reading: "Photographs of gravestones are free to use; the site explicitly allows downloading by a program.",
    },
    why: { letter: "the official record", photo: "a photograph for the family book", web: "military service", mill: "the family of the mill" },
    doneWhen: { letter: "the office's reply", photo: "photograph found", web: "service record found", images: "images saved and read" },
  },
};

const de: Demo = {
  sampleName: "Beispiel – Familie Weber",
  tree: "Familie Weber", place: "Oberndorf", place2: "Unterdorf", house: "12",
  repo: "Diözesanarchiv", country: "de", url: "https://archiv.example.org/kirchenbuecher", mediaFrom: "Portal des Archivs",
  surname: "Weber", surname2: "Schneider", surnameKat: "Vogel", occ: "Landwirt",
  research: {
    main: "Vorfahren von Anna Weber", husband: "Vorfahren von Peter Klein", descendants: "Nachkommen von Georg Weber",
    review: "Überprüfung: Martha Weber", question: "Woher stammte Katharina Vogel?",
  },
  people: {
    anna: ["Anna /Weber/", "Anna Weber"], josef: ["Johann /Weber/", "Johann Weber"], marie: ["Maria /Schneider/", "Maria Schneider"],
    vaclav: ["Georg /Weber/", "Georg Weber"], katerina: ["Katharina /Vogel/", "Katharina Vogel"],
    frantisek: ["Franz /Schneider/", "Franz Schneider"], ludmila: ["Theresia /Huber/", "Theresia Huber"],
    ruzena: ["Rosa /Weber/", "Rosa Weber"], karel: ["Karl /Weber/", "Karl Weber"], vera: ["Martha /Weber/", "Martha Weber"],
    petr: ["Peter /Klein/", "Peter Klein"], jana: ["Julia /Klein/", "Julia Klein"],
    jan: ["Josef /Weber/", "Josef Weber"], annaD: ["Anna /Bauer/", "Anna Bauer"], matej: ["Michael /Weber/", "Michael Weber"],
    tomas: ["Martin /Schneider/", "Martin Schneider"], rozalie: ["Rosalia /Schwarz/", "Rosalia Schwarz"],
    antonin: ["Anton /Klein/", "Anton Klein"], marieK: ["Maria /Kaiser/", "Maria Kaiser"],
  },
  intake: "Oma Anna kam in Oberndorf Nr. 12 zur Welt. Ihr Mann war Peter Klein, die Tochter Julia. Geschwister Karl und Martha. Oma erzählte, Urgroßmutter Katharina sei von der Mühle in Unterdorf gekommen.",
  books: {
    bapt: "Oberndorf, Taufen 1890–1935", marr: "Oberndorf, Trauungen 1890–1930", baptOld: "Oberndorf, Taufen 1855–1889",
    other: "Unterdorf, Taufen 1860–1890", petr: "Geburtsregister Unterdorf 1929", census: "Volkszählung 1880, Oberndorf", grave: "Friedhof Oberndorf", family: "Erinnerung der Familie", records: "belegte Einträge der Forschung", older: "Kirchenbücher um Oberndorf 1800–1820",
  },
  tasks: {
    annaBapt: "Taufe von Anna Weber 1931", parentsMarr: "Trauung von Johann Weber und Maria Schneider", josefBapt: "Taufe von Johann Weber um 1898",
    marieBapt: "Taufe von Maria Schneider um 1902", vaclavBapt: "Taufe von Georg Weber um 1865", petrBirth: "Geburt von Peter Klein 1929",
    frantisekBapt: "Taufe von Franz Schneider um 1874", katSearch: "Taufen Vogel in Unterdorf", story: "Die Geschichte von Anna Weber",
    gpMarr: "Trauung von Georg Weber und Katharina Vogel", askFamily: "Wo wurde Peter Klein geboren?", mgMarr: "Trauung von Franz Schneider und Theresia Huber",
    census1880: "Volkszählung 1880 in Oberndorf", janDeath: "Tod von Josef Weber um 1901", ludmilaBapt: "Taufe von Theresia Huber um 1876",
    antoninBapt: "Taufe von Anton Klein", katReread: "Trauung neu lesen: woher die Braut kam", grave: "Grab der Familie Weber",
    janMarr: "Trauung von Josef Weber und Anna Bauer", matejBapt: "Wo wurde Michael Weber um 1810 getauft?", antoninMarr: "Trauung von Anton Klein und Maria Kaiser", tomasMarr: "Trauung von Martin Schneider und Rosalia Schwarz", storyJosef: "Die Geschichte von Johann Weber",
    katBapt: "Taufe von Katharina Vogel um 1870",
    why: {
      parents: "Eltern", grandparents: "Eltern beider Brautleute", birth: "Geburtsdatum und -ort", origin: "woher sie stammte",
      katParents: "Eltern von Katharina", askFamily: "noch kein Register gefunden", household: "Haushalt und Kinder", death: "Sterbedatum", grave: "Inschrift des Grabsteins", story: "Geschichte für das Familienbuch",
    },
    doneWhen: { entry: "Eintrag gefunden", searched: "vollständig durchsucht", household: "Haushalt gefunden", photo: "Foto des Grabsteins", story: "Geschichte geschrieben", answer: "Antwort der Familie" },
  },
  src: {
    anna: "Taufe von Anna Weber 1931", marr: "Trauung von Johann Weber und Maria Schneider 1924", josef: "Taufe von Johann Weber 1898",
    census: "Volkszählung 1921, Oberndorf Nr. 12", marie: "Taufe von Maria Schneider 1902", vaclav: "Taufe von Georg Weber 1865",
    petr: "Geburt von Peter Klein 1929", frantisek: "Taufe von Franz Schneider 1874",
  },
  tr: {
    anna: "Anna, geb. 14. Januar, getauft 18. Januar 1931, Oberndorf Nr. 12. Vater Johann Weber, Landwirt, Sohn des Georg Weber und der Katharina geb. Vogel. Mutter Maria geb. Schneider, Tochter des Franz Schneider und der Theresia geb. Huber. Patin Rosa Weber, ledig.",
    marr: "12. Mai 1924. Bräutigam Johann Weber, Landwirt, Oberndorf Nr. 12, Sohn des Georg Weber und der Katharina geb. Vogel, 26 Jahre. Braut Maria Schneider, Oberndorf Nr. 31, Tochter des Franz Schneider und der Theresia geb. Huber, 21 Jahre.",
    josef: "Joannes, natus 3. Martii 1898, Oberndorf No. 12. Pater Georgius Weber, agricola, filius Josephi Weber. Mater Catharina nata Vogel, filia Josephi Vogel ex Unterdorf.",
    josefTr: "Johann, geboren am 3. März 1898, Oberndorf Nr. 12. Vater Georg Weber, Landwirt, Sohn des Josef Weber. Mutter Katharina geb. Vogel, Tochter des Josef Vogel aus Unterdorf.",
    census: "Johann Weber, Haushaltsvorstand, geb. 1897, Landwirt, Oberndorf Nr. 12.",
    marie: "Maria, geb. 20. August 1902, Oberndorf Nr. 31. Vater Franz Schneider, Schmied. Mutter Theresia geb. Huber.",
    vaclav: "Georgius, natus 1. Octobris 1865. Pater Josephus Weber, filius Michaelis Weber. Mater Anna nata Bauer.",
    petr: "Peter, geb. 7. Juni 1929 in Unterdorf. Vater Anton Klein, Zimmermann. Mutter Maria geb. Kaiser.",
    frantisek: "Franciscus, natus 12. Februarii 1874. Pater Martinus Schneider, faber ferrarius. Mater Rosalia nata Schwarz.",
  },
  results: {
    intake: "Erinnerung der Familie erfasst: 4 Personen, 1 Familie",
    anna: "Taufeintrag gefunden: Eltern Johann Weber und Maria Schneider", marr: "Trauung 1924 gefunden, Eltern beider bekannt",
    josef: "Taufe 3. 3. 1898 gefunden; die Volkszählung nennt 1897", marie: "Taufe 20. 8. 1902 gefunden", vaclav: "Taufe 1865 gefunden, Eltern Josef Weber und Anna Bauer",
    petr: "Geburt 1929 gefunden, Eltern Anton Klein und Maria Kaiser", frantisek: "Taufe 1874 gefunden, Eltern Martin Schneider und Rosalia Schwarz",
    kat: "keine Katharina Vogel in Unterdorf 1866–1872", story: "Geschichte geschrieben",
  },
  summaries: {
    // the sample's last session (build-demo.ts SHOWCASE_SAMPLE=1): closed, to be continued
    paused: "Zweite Lesung der Taufen in Arbeit (Bilder 1–60 von 90), wird fortgesetzt.",
    intake: "Erfasst, was die Familie weiß: Ehemann Peter, Tochter Julia, Geschwister Karl und Martha.", storyJosef: "Die Geschichte von Johann aus belegten Einträgen geschrieben.", wait: "Das Trauungsbuch ist nur zum Ansehen; die Bilder 40–45 speichert der Nutzer.",
    anna: "Taufe von Anna 1931 gefunden: Eltern Johann Weber und Maria Schneider.", marr: "Trauung 1924: Johanns Eltern Georg und Katharina, Marias Franz und Theresia.",
    josef: "Johann getauft am 3. 3. 1898; die Volkszählung 1921 nennt 1897, Widerspruch notiert.", marie: "Maria getauft 1902, geboren am 20. 8.",
    vaclav: "Taufe von Georg 1865: Eltern Josef Weber und Anna Bauer, Großvater Michael.", petr: "Peter Klein geboren am 7. 6. 1929 in Unterdorf.",
    frantisek: "Taufe von Franz 1874: Eltern Martin Schneider und Rosalia Schwarz.", kat: "Katharina steht nicht in den Taufen von Unterdorf 1866–1872, weitersuchen.",
    story: "Die Geschichten von Anna und Johann aus belegten Einträgen geschrieben.",
  },
  nexts: {
    // the sample's last session (build-demo.ts SHOWCASE_SAMPLE=1): closed, to be continued
    paused: "Bilder 61–90 lesen",
    intake: "Taufe von Anna 1931", wait: "nach dem Speichern der Bilder die Trauung lesen",
    anna: "Trauung der Eltern um 1924", marr: "Taufe von Johann um 1898", josef: "Taufe von Maria um 1902", marie: "Taufe von Georg um 1865",
    vaclav: "Tod von Josef Weber", petr: "Taufe von Anton Klein", frantisek: "Trauung von Franz und Theresia", kat: "Taufen Unterdorf 1868–1872 erneut, die Mühle", story: "Eltern von Katharina",
  },
  reasons: { paused: "die Kirchenbücher von Unterdorf nach 1900 sind noch nicht online", done: "alles belegt", parked: "erst im Frühling" },
  notes: { matej: "Vater von Josef Weber laut Taufe von Georg" },
  hypoJosef: "Diente Johann im Ersten Weltkrieg?", hypoJosefA: "A: diente bei der Infanterie", hypoJosefB: "B: als Landwirt freigestellt", hypoJosefNote: "1917 war er 19 Jahre alt. Die Kriegsstammrolle wird es entscheiden.", searchJosef: "Kriegsstammrollen, Jahrgang 1898",
  conflict: "Geburtsjahr von Johann Weber", hypo: "Stammte Katharina Vogel von der Mühle in Unterdorf?",
  hypoA: "A: Tochter des Josef Vogel aus Unterdorf Nr. 5", hypoB: "B: Tochter des Anton Vogel, Müller",
  hypoNote: "Die Familie sagt: die Mühle. Die Taufe 1898 nennt Josef Vogel. Ihre eigene Taufe wird es entscheiden.",
  searchNeg: "Taufen Vogel in Unterdorf 1866–1872", searchNote: "vollständig durchsucht, keine Katharina Vogel",
  searchNow: "Taufen Vogel in Unterdorf 1868–1872, zweite Lesung", searchNowNote: "in Arbeit: Bilder 1–60 von 90",
  story: {
    annaTitle: "Das Kind aus Haus Nr. 12",
    anna: "Anna Weber kam am **14. Januar 1931** in Oberndorf zur Welt, im Haus Nr. 12, das ihre Familie schon seit zwei Generationen bewirtschaftete. Vier Tage später wurde sie getauft.\n\n## Die Eltern\n\nIhr Vater Johann, *Landwirt*, hatte sieben Jahre zuvor Maria Schneider aus demselben Dorf geheiratet.\n\n- Vater: Johann Weber, geboren 1898\n- Mutter: Maria geb. Schneider, geboren 1902\n- Patin: Tante Rosa Weber\n\n## Geschwister\n\nAnna hatte einen älteren Bruder, Karl, und eine jüngere Schwester, Martha.",
    annaFacts: [
      "Geburt 14. Januar 1931, Oberndorf, Haus Nr. 12",
      "Taufe 18. Januar 1931, Patin Rosa Weber (Taufen 1890–1935, fol. 112)",
      "Eltern Johann Weber, Landwirt, und Maria geb. Schneider",
      "Trauung der Eltern 12. Mai 1924 in Oberndorf",
      "Geschwister Karl und Martha",
    ],
    josefTitle: "Der Bauer aus Oberndorf",
    josef: "Johann Weber wurde am **3. März 1898** als Sohn von Georg und Katharina geboren.\n\n1924 heiratete er Maria Schneider und übernahm vom Vater den Hof Nr. 12.",
  },
  waitOn: "Bilder 40–45 der Trauungen Oberndorf 1890–1930, von Hand zu speichern: das Portal des Archivs erlaubt kein Herunterladen durch ein Programm.",
  askOn: "Antwort der Familie: weiß jemand, wo genau Peter Klein geboren wurde?",
  island: { miller: ["Anton /Vogel/", "Anton Vogel"], wife: ["Barbara /Vogel/", "Barbara Vogel"], son: ["Johann /Vogel/", "Johann Vogel"], note: "Müller, Mühle in Unterdorf" },
  lostBook: "Oberndorf, Taufen 1830–1854 (verbrannt 1856)",
  archive: {
    name: "kirchenbuch-muster", host: "kirchenbuch.example.org", title: "Kirchenbuchportal Musterland", terms: "https://kirchenbuch.example.org/nutzungsbedingungen",
    reading: "Die Bilder der Kirchenbücher sind frei einsehbar; automatisches Herunterladen ist eingeschränkt – nur langsam und nur Bilder für eine konkrete Forschung.",
    repo: "Archiv Musterland", book: "Unterdorf, Trauungen 1860–1875", bookId: "UD-T-1860", years: "1860-1875", images: "12-14",
    task: "Trauungen der Familie Vogel in Unterdorf 1860–1875",
    summary: "Das Trauungsbuch von Unterdorf liegt im Kirchenbuchportal Musterland. Die Bedingungen schränken das automatische Herunterladen ein: die Bilder 12–14 warten auf eine Entscheidung.",
    next: "Nach der Entscheidung die Bilder 12–14 laden und die Trauung der Eltern von Katharina Vogel finden.",
  },
  waitLudmila: "Bilder 60–64 der Taufen Oberndorf 1855–1889, von Hand zu speichern: das Portal des Archivs erlaubt kein Herunterladen durch ein Programm.",
  waits: {
    manual: {
      name: "archiv-musterstadt", host: "lesesaal.archiv-musterstadt.example", title: "Stadtarchiv Musterstadt – digitaler Lesesaal", terms: "https://lesesaal.archiv-musterstadt.example/benutzungsordnung",
      reading: "Die Bilder sind nur im digitalen Lesesaal einsehbar; die Benutzungsordnung erlaubt das Speichern nur von Hand, keinem Programm.",
      repo: "Stadtarchiv Musterstadt",
      books: [
        { name: "Unterdorf, Taufen 1830–1859", id: "UD-TA-1830", kinds: "baptism", years: "1830-1859" },
        { name: "Unterdorf, Trauungen 1830–1859", id: "UD-TR-1830", kinds: "marriage", years: "1830-1859" },
        { name: "Unterdorf, Sterbefälle 1850–1900", id: "UD-ST-1850", kinds: "death", years: "1850-1900" },
        { name: "Einwohnerliste Unterdorf 1871", id: "UD-EW-1871", kinds: "census", years: "1871-1871" },
      ],
      tasks: [
        { what: "Taufe von Anton Vogel um 1838", book: 0, images: "112-115", about: ["miller"], have: 2, on: "Bilder 112–115 der Taufen Unterdorf 1830–1859, von Hand zu speichern aus dem digitalen Lesesaal des Stadtarchivs Musterstadt." },
        { what: "Trauung von Anton Vogel und Barbara", book: 1, images: "77-79", about: ["miller", "millerWife"], have: 0, on: "Bilder 77–79 der Trauungen Unterdorf 1830–1859, von Hand zu speichern aus dem digitalen Lesesaal des Stadtarchivs Musterstadt." },
        { what: "Einwohnerliste 1871: die Mühle Nr. 5 in Unterdorf", book: 3, images: "5-8", about: ["miller", "millerWife", "millerSon"], have: 3, on: "Bilder 5–8 der Einwohnerliste Unterdorf 1871, von Hand zu speichern aus dem digitalen Lesesaal des Stadtarchivs Musterstadt." },
        { what: "Tod von Anton Vogel, Müller", book: 2, images: "140-142", about: ["miller"], have: 0, on: "Bilder 140–142 der Sterbefälle Unterdorf 1850–1900, von Hand zu speichern aus dem digitalen Lesesaal des Stadtarchivs Musterstadt." },
        { what: "Tod von Barbara Vogel", book: 2, images: "201-202", about: ["millerWife"], have: 1, on: "Bilder 201–202 der Sterbefälle Unterdorf 1850–1900, von Hand zu speichern aus dem digitalen Lesesaal des Stadtarchivs Musterstadt." },
      ],
      summary: "Das Stadtarchiv Musterstadt erlaubt Bilder nur von Hand: fünf Aufgaben warten auf gespeicherte Bilder, die Anfragen an das Standesamt liegen in notes/.",
      next: "nach dem Speichern der Bilder die Einträge der Familie Vogel von der Mühle lesen",
    },
    office: {
      to: "Standesamt Musterlingen",
      letters: [
        {
          what: "Eheregisterauszug: Peter Klein und Anna Weber", about: ["petr", "anna"], file: "notes/anfrage-standesamt-ehe-klein.md",
          on: "Anfrage nach einem Auszug aus dem Eheregister (Peter Klein und Anna Weber, um 1955) abzuschicken; dann die Antwort des Standesamts Musterlingen.",
          text: "Standesamt Musterlingen\n\nSehr geehrte Damen und Herren,\n\nich bitte um einen Auszug aus dem Eheregister für die Ehe von Peter Klein (geb. 7. 6. 1929 in Unterdorf) und Anna Weber (geb. 14. 1. 1931 in Oberndorf), geschlossen um 1955.\n\nIch bin ihre Tochter; der Auszug dient der Familienforschung.\n\nMit freundlichen Grüßen\nJulia Klein",
        },
        {
          what: "Sterberegisterauszug: Anton Klein", about: ["antonin"], file: "notes/anfrage-standesamt-tod-anton.md",
          on: "Anfrage nach einem Auszug aus dem Sterberegister (Anton Klein, Zimmermann, gestorben nach 1950) abzuschicken; dann die Antwort des Standesamts Musterlingen.",
          text: "Standesamt Musterlingen\n\nSehr geehrte Damen und Herren,\n\nich bitte um einen Auszug aus dem Sterberegister für Anton Klein, Zimmermann aus Unterdorf, gestorben nach 1950.\n\nIch bin seine Enkelin; der Auszug dient der Familienforschung.\n\nMit freundlichen Grüßen\nJulia Klein",
        },
        {
          what: "Geburtsregisterauszug: Maria Kaiser", about: ["marieK"], file: "notes/anfrage-standesamt-geburt-kaiser.md",
          on: "Anfrage nach einem Auszug aus dem Geburtsregister (Maria Kaiser, um 1905) abzuschicken; dann die Antwort des Standesamts Musterlingen.",
          text: "Standesamt Musterlingen\n\nSehr geehrte Damen und Herren,\n\nich bitte um einen Auszug aus dem Geburtsregister für Maria Kaiser, geboren um 1905, später verheiratet mit Anton Klein aus Unterdorf.\n\nIch bin ihre Enkelin; der Auszug dient der Familienforschung.\n\nMit freundlichen Grüßen\nJulia Klein",
        },
      ],
    },
    sent: [
      {
        what: "Pfarrchronik Unterdorf: die Mühle und die Familie Vogel", about: ["katerina"], to: "Pfarramt Unterdorf", daysAgo: 9, file: "notes/anfrage-pfarramt-chronik.md",
        on: "Antwort des Pfarramts Unterdorf auf die Anfrage zur Pfarrchronik (Mühle Nr. 5, Familie Vogel).",
        text: "Pfarramt Unterdorf\n\nSehr geehrte Damen und Herren,\n\nich frage an, ob die Pfarrchronik von Unterdorf die Mühle Nr. 5 und die Familie des Müllers Anton Vogel (um 1860–1880) erwähnt.\n\nMit freundlichen Grüßen\nJulia Klein",
      },
      {
        what: "Grundbuch: das Haus der Familie Klein in Unterdorf", about: ["antonin", "marieK"], to: "Kreisarchiv Musterland", daysAgo: 4, file: "notes/anfrage-kreisarchiv-grundbuch.md",
        on: "Antwort des Kreisarchivs Musterland auf die Anfrage zum Grundbuch Unterdorf (Haus von Anton Klein).",
        text: "Kreisarchiv Musterland\n\nSehr geehrte Damen und Herren,\n\nbitte teilen Sie mit, ob das Archiv das Grundbuch von Unterdorf mit einem Eintrag zum Haus von Anton Klein (um 1925–1935) verwahrt.\n\nMit freundlichen Grüßen\nJulia Klein",
      },
    ],
    family: { what: "Hochzeitsfoto von Peter und Anna Klein", about: ["petr", "anna"], on: "Ein Foto von der Hochzeit von Peter und Anna Klein, falls es in der Familie erhalten ist." },
    web: {
      what: "Kriegsstammrolle von Johann Weber (Jahrgang 1898)", about: ["josef"], url: "https://stammrollen.example/1898/weber-johann",
      on: "Kriegsstammrolle von Johann Weber in den digitalisierten Stammrollen nachzuschlagen: https://stammrollen.example/1898/weber-johann",
    },
    twoHosts: {
      name: "kirchenbuch-kreis", title: "Kirchenbücher des Kreises online", hosts: ["kirchenbuch.kreis-musterland.example", "bilder.kreis-musterland.example"], terms: "https://kirchenbuch.kreis-musterland.example/bedingungen",
      reading: "Die Bilder der Kirchenbücher dürfen frei geladen werden, auch durch ein Programm, im Tempo, das das Portal angibt.",
    },
    noCap: {
      name: "grabsteine-muster", title: "Grabsteine Musterland", host: "grabsteine-musterland.example", terms: "https://grabsteine-musterland.example/projekt",
      reading: "Die Fotos der Grabsteine sind frei nutzbar; das Portal erlaubt das Herunterladen durch ein Programm ausdrücklich.",
    },
    why: { letter: "der amtliche Eintrag", photo: "ein Foto für das Familienbuch", web: "Militärdienst", mill: "die Familie von der Mühle" },
    doneWhen: { letter: "Antwort des Amts", photo: "Foto gefunden", web: "Stammrolle gefunden", images: "Bilder gespeichert und gelesen" },
  },
};

const pl: Demo = {
  sampleName: "Przykład – rodzina Jaworskich",
  tree: "Rodzina Jaworskich", place: "Wierzbno Dolne", place2: "Wierzbno Górne", house: "12",
  repo: "Archiwum Diecezjalne", country: "pl", url: "https://archiwum.example.org/metryki", mediaFrom: "portal archiwum",
  surname: "Jaworski", surname2: "Krawczyk", surnameKat: "Wilk", occ: "rolnik",
  research: {
    main: "Przodkowie Zofii Jaworskiej", husband: "Przodkowie Piotra Mazura", descendants: "Potomkowie Wacława Jaworskiego",
    review: "Przegląd: Irena Jaworska", question: "Skąd pochodziła Katarzyna Wilk?",
  },
  people: {
    anna: ["Zofia /Jaworska/", "Zofia Jaworska"], josef: ["Józef /Jaworski/", "Józef Jaworski"], marie: ["Maria /Krawczyk/", "Maria Krawczyk"],
    vaclav: ["Wacław /Jaworski/", "Wacław Jaworski"], katerina: ["Katarzyna /Wilk/", "Katarzyna Wilk"],
    frantisek: ["Franciszek /Krawczyk/", "Franciszek Krawczyk"], ludmila: ["Ludwika /Nowak/", "Ludwika Nowak"],
    ruzena: ["Stefania /Jaworska/", "Stefania Jaworska"], karel: ["Karol /Jaworski/", "Karol Jaworski"], vera: ["Irena /Jaworska/", "Irena Jaworska"],
    petr: ["Piotr /Mazur/", "Piotr Mazur"], jana: ["Małgorzata /Mazur/", "Małgorzata Mazur"],
    jan: ["Jan /Jaworski/", "Jan Jaworski"], annaD: ["Anna /Dudek/", "Anna Dudek"], matej: ["Maciej /Jaworski/", "Maciej Jaworski"],
    tomas: ["Tomasz /Krawczyk/", "Tomasz Krawczyk"], rozalie: ["Rozalia /Czarnecka/", "Rozalia Czarnecka"],
    antonin: ["Antoni /Mazur/", "Antoni Mazur"], marieK: ["Maria /Drozd/", "Maria Drozd"],
  },
  intake: "Babcia Zofia urodziła się w Wierzbnie Dolnym pod numerem 12. Jej mężem był Piotr Mazur, córka to Małgorzata. Rodzeństwo: Karol i Irena. Babcia opowiadała, że prababcia Katarzyna przyszła z młyna w Wierzbnie Górnym.",
  books: {
    bapt: "Wierzbno Dolne, Księga urodzeń 1890–1935", marr: "Wierzbno Dolne, Księga ślubów 1890–1930", baptOld: "Wierzbno Dolne, Liber natorum 1855–1889",
    other: "Wierzbno Górne, Liber natorum 1860–1890", petr: "akta urodzeń Wierzbno Górne 1929", census: "spis ludności 1880, Wierzbno Dolne", grave: "cmentarz w Wierzbnie Dolnym", family: "pamięć rodzinna", records: "udokumentowane zapisy badania", older: "księgi metrykalne wokół Wierzbna Dolnego 1800–1820",
  },
  tasks: {
    annaBapt: "Chrzest Zofii Jaworskiej 1931", parentsMarr: "Ślub Józefa Jaworskiego i Marii Krawczyk", josefBapt: "Chrzest Józefa Jaworskiego ok. 1898",
    marieBapt: "Chrzest Marii Krawczyk ok. 1902", vaclavBapt: "Chrzest Wacława Jaworskiego ok. 1865", petrBirth: "Urodzenie Piotra Mazura 1929",
    frantisekBapt: "Chrzest Franciszka Krawczyka ok. 1874", katSearch: "Chrzty Wilków w Wierzbnie Górnym", story: "Opowieść o Zofii Jaworskiej",
    gpMarr: "Ślub Wacława Jaworskiego i Katarzyny Wilk", askFamily: "Gdzie urodził się Piotr Mazur?", mgMarr: "Ślub Franciszka Krawczyka i Ludwiki Nowak",
    census1880: "Spis ludności 1880 w Wierzbnie Dolnym", janDeath: "Zgon Jana Jaworskiego ok. 1901", ludmilaBapt: "Chrzest Ludwiki Nowak ok. 1876",
    antoninBapt: "Chrzest Antoniego Mazura", katReread: "Ponownie odczytać akt ślubu: skąd pochodziła panna młoda", grave: "Grób rodziny Jaworskich",
    janMarr: "Ślub Jana Jaworskiego i Anny Dudek", matejBapt: "Gdzie zapisano chrzest Macieja Jaworskiego ok. 1810?", antoninMarr: "Ślub Antoniego Mazura i Marii Drozd", tomasMarr: "Ślub Tomasza Krawczyka i Rozalii Czarneckiej", storyJosef: "Opowieść o Józefie Jaworskim",
    katBapt: "Chrzest Katarzyny Wilk ok. 1870",
    why: {
      parents: "rodzice", grandparents: "rodzice obojga nowożeńców", birth: "data i miejsce urodzenia", origin: "skąd pochodziła",
      katParents: "rodzice Katarzyny", askFamily: "metryka jeszcze nieodnaleziona", household: "gospodarstwo domowe i dzieci", death: "data zgonu", grave: "napis na nagrobku", story: "opowieść do Księgi rodu",
    },
    doneWhen: { entry: "akt odnaleziony", searched: "przeszukano całość", household: "gospodarstwo odnalezione", photo: "zdjęcie nagrobka", story: "opowieść napisana", answer: "odpowiedź rodziny" },
  },
  src: {
    anna: "Chrzest Zofii Jaworskiej 1931", marr: "Ślub Józefa Jaworskiego i Marii Krawczyk 1924", josef: "Chrzest Józefa Jaworskiego 1898",
    census: "Spis ludności 1921, Wierzbno Dolne nr 12", marie: "Chrzest Marii Krawczyk 1902", vaclav: "Chrzest Wacława Jaworskiego 1865",
    petr: "Urodzenie Piotra Mazura 1929", frantisek: "Chrzest Franciszka Krawczyka 1874",
  },
  tr: {
    anna: "Zofia, ur. 14 stycznia, ochrzczona 18 stycznia 1931, Wierzbno Dolne nr 12. Ojciec Józef Jaworski, rolnik, syn Wacława Jaworskiego i Katarzyny z d. Wilk. Matka Maria z d. Krawczyk, córka Franciszka Krawczyka i Ludwiki z d. Nowak. Chrzestna Stefania Jaworska, panna.",
    marr: "12 maja 1924. Pan młody Józef Jaworski, rolnik, Wierzbno Dolne nr 12, syn Wacława Jaworskiego i Katarzyny z d. Wilk, lat 26. Panna młoda Maria Krawczyk, Wierzbno Dolne nr 31, córka Franciszka Krawczyka i Ludwiki z d. Nowak, lat 21.",
    josef: "Josephus, natus 3. Martii 1898, Wierzbno Dolne No. 12. Pater Venceslaus Jaworski, agricola, filius Joannis Jaworski. Mater Catharina nata Wilk, filia Joannis Wilk ex Wierzbno Górne.",
    josefTr: "Józef, urodzony 3 marca 1898, Wierzbno Dolne nr 12. Ojciec Wacław Jaworski, rolnik, syn Jana Jaworskiego. Matka Katarzyna z d. Wilk, córka Jana Wilka z Wierzbna Górnego.",
    census: "Józef Jaworski, głowa gospodarstwa, ur. 1897, rolnik, Wierzbno Dolne nr 12.",
    marie: "Maria, ur. 20 sierpnia 1902, Wierzbno Dolne nr 31. Ojciec Franciszek Krawczyk, kowal. Matka Ludwika z d. Nowak.",
    vaclav: "Venceslaus, natus 1. Octobris 1865. Pater Joannes Jaworski, filius Matthiae Jaworski. Mater Anna nata Dudek.",
    petr: "Piotr, ur. 7 czerwca 1929 w Wierzbnie Górnym. Ojciec Antoni Mazur, cieśla. Matka Maria z d. Drozd.",
    frantisek: "Franciscus, natus 12. Februarii 1874. Pater Thomas Krawczyk, faber ferrarius. Mater Rosalia nata Czarnecka.",
  },
  results: {
    intake: "pamięć rodzinna zapisana: 4 osoby, 1 rodzina",
    anna: "akt chrztu odnaleziony: rodzice Józef Jaworski i Maria Krawczyk", marr: "akt ślubu z 1924 odnaleziony, rodzice obojga nowożeńców znani",
    josef: "chrzest z 3.3.1898 odnaleziony; spis podaje 1897", marie: "chrzest z 20.8.1902 odnaleziony", vaclav: "chrzest z 1865 odnaleziony, rodzice Jan Jaworski i Anna Dudek",
    petr: "urodzenie z 1929 odnalezione, rodzice Antoni Mazur i Maria Drozd", frantisek: "chrzest z 1874 odnaleziony, rodzice Tomasz Krawczyk i Rozalia Czarnecka",
    kat: "w Wierzbnie Górnym 1866–1872 brak Katarzyny Wilk", story: "opowieść napisana",
  },
  summaries: {
    // the sample's last session (build-demo.ts SHOWCASE_SAMPLE=1): closed, to be continued
    paused: "Drugie odczytanie chrztów w toku (skany 1–60 z 90), ciąg dalszy w następnej sesji.",
    intake: "Zapisano, co wie rodzina: mąż Piotr, córka Małgorzata, rodzeństwo Karol i Irena.", storyJosef: "Opowieść o Józefie napisana na podstawie udokumentowanych aktów.", wait: "Księga ślubów jest tylko do przeglądania, skany 40–45 czekają na ręczne zapisanie.",
    anna: "Chrzest Zofii z 1931 odnaleziony: rodzice Józef Jaworski i Maria Krawczyk.", marr: "Ślub z 1924: rodzice Józefa to Wacław i Katarzyna, rodzice Marii to Franciszek i Ludwika.",
    josef: "Józef urodzony 3.3.1898; spis z 1921 podaje rok 1897, sprzeczność zapisana.", marie: "Maria ochrzczona 24.8.1902, urodzona 20.08.",
    vaclav: "Chrzest Wacława z 1865: rodzice Jan Jaworski i Anna Dudek, dziadek Maciej.", petr: "Piotr Mazur urodzony 7.6.1929 w Wierzbnie Górnym.",
    frantisek: "Chrzest Franciszka z 1874: rodzice Tomasz Krawczyk i Rozalia Czarnecka.", kat: "Katarzyny nie ma w chrztach Wierzbna Górnego 1866–1872, szukać dalej.",
    story: "Opowieści o Zofii i Józefie napisane na podstawie udokumentowanych aktów.",
  },
  nexts: {
    // the sample's last session (build-demo.ts SHOWCASE_SAMPLE=1): closed, to be continued
    paused: "odczytać skany 61–90",
    intake: "chrzest Zofii z 1931", wait: "po zapisaniu skanów odczytać akt ślubu",
    anna: "ślub rodziców ok. 1924", marr: "chrzest Józefa ok. 1898", josef: "chrzest Marii ok. 1902", marie: "chrzest Wacława ok. 1865",
    vaclav: "zgon Jana Jaworskiego", petr: "chrzest Antoniego Mazura", frantisek: "ślub Franciszka i Ludwiki", kat: "chrzty Wierzbna Górnego 1868–1872 ponownie, młyn nr 5", story: "rodzice Katarzyny",
  },
  reasons: { paused: "księgi Wierzbna Górnego po 1900 roku nie są jeszcze online", done: "wszystko udokumentowane", parked: "dopiero wiosną" },
  notes: { matej: "ojciec Jana Jaworskiego według chrztu Wacława" },
  hypoJosef: "Czy Józef służył w wojsku w czasie I wojny światowej?", hypoJosefA: "A: służył w pułku piechoty", hypoJosefB: "B: jako rolnik był zwolniony", hypoJosefNote: "W 1917 roku miał 19 lat. Rozstrzygnie wojskowa karta ewidencyjna.", searchJosef: "Wojskowe karty ewidencyjne, rocznik 1898",
  conflict: "Rok urodzenia Józefa Jaworskiego", hypo: "Czy Katarzyna Wilk pochodziła z młyna w Wierzbnie Górnym?",
  hypoA: "A: córka Jana Wilka z Wierzbna Górnego nr 5", hypoB: "B: córka Józefa Wilka, młynarza",
  hypoNote: "Pamięć rodzinna mówi o młynie, chrzest Józefa z 1898 podaje Jana Wilka. Rozstrzygnie jej akt chrztu.",
  searchNeg: "Chrzty Wilków w Wierzbnie Górnym 1866–1872", searchNote: "przeszukano całość, Katarzyny Wilk tam nie ma",
  searchNow: "Chrzty Wilków w Wierzbnie Górnym 1868–1872, drugie odczytanie", searchNowNote: "w toku: skany 1–60 z 90",
  story: {
    annaTitle: "Dziecko z domu nr 12",
    anna: "Zofia Jaworska urodziła się **14 stycznia 1931** w Wierzbnie Dolnym, w domu nr 12, gdzie jej rodzina gospodarowała już od dwóch pokoleń. Ochrzczono ją cztery dni później.\n\n## Rodzice\n\nJej ojciec Józef, *rolnik*, siedem lat wcześniej poślubił Marię Krawczyk z tej samej wsi.\n\n- ojciec: Józef Jaworski, urodzony 1898\n- matka: Maria z d. Krawczyk, urodzona 1902\n- chrzestna: ciotka Stefania Jaworska\n\n## Rodzeństwo\n\nZofia miała starszego brata Karola i młodszą siostrę Irenę.",
    annaFacts: [
      "urodzenie 14.1.1931, Wierzbno Dolne nr 12",
      "chrzest 18.1.1931, chrzestna Stefania Jaworska (Księga urodzeń 1890–1935, k. 112)",
      "rodzice Józef Jaworski, rolnik, i Maria z d. Krawczyk",
      "ślub rodziców 12.5.1924 w Wierzbnie Dolnym",
      "rodzeństwo Karol i Irena",
    ],
    josefTitle: "Gospodarz z Wierzbna Dolnego",
    josef: "Józef Jaworski urodził się **3 marca 1898** jako syn Wacława i Katarzyny.\n\nW 1924 roku poślubił Marię Krawczyk i przejął po ojcu gospodarstwo pod numerem 12.",
  },
  waitOn: "Skany 40–45 z księgi ślubów Wierzbno Dolne 1890–1930 do zapisania ręcznie: portal archiwum nie pozwala na pobieranie programem.",
  askOn: "Odpowiedź rodziny: czy ktoś wie, gdzie dokładnie urodził się Piotr Mazur?",
  island: { miller: ["Józef /Wilk/", "Józef Wilk"], wife: ["Barbara /Wilk/", "Barbara Wilk"], son: ["Jan /Wilk/", "Jan Wilk"], note: "młynarz, młyn w Wierzbnie Górnym" },
  lostBook: "Wierzbno Dolne, Liber natorum 1830–1854 (spłonęła w 1856)",
  archive: {
    name: "metryki-wzorowo", host: "metryki.example.org", title: "Cyfrowe Metryki Wzorowo", terms: "https://metryki.example.org/regulamin",
    reading: "Skany ksiąg metrykalnych są swobodnie dostępne do przeglądania; automatyczne pobieranie jest ograniczone – tylko powoli i tylko skany do konkretnych badań.",
    repo: "Cyfrowe Metryki Wzorowo", book: "Wierzbno Górne, Liber copulatorum 1860–1875", bookId: "WG-S-1860", years: "1860-1875", images: "12-14",
    task: "Śluby Wilków w Wierzbnie Górnym 1860–1875",
    summary: "Księga ślubów Wierzbna Górnego jest w portalu Cyfrowe Metryki Wzorowo. Regulamin ogranicza automatyczne pobieranie: skany 12–14 czekają na decyzję.",
    next: "Po decyzji pobrać skany 12–14 i odnaleźć ślub rodziców Katarzyny Wilk.",
  },
  waitLudmila: "Skany 60–64 z księgi urodzeń Wierzbno Dolne 1855–1889 do zapisania ręcznie: portal archiwum nie pozwala na pobieranie programem.",
  waits: {
    manual: {
      name: "archiwum-wzorowo", host: "czytelnia.archiwum-wzorowo.example", title: "Archiwum Wzorowo – cyfrowa czytelnia", terms: "https://czytelnia.archiwum-wzorowo.example/regulamin",
      reading: "Skany są tylko do przeglądania w cyfrowej czytelni; regulamin pozwala zapisywać je wyłącznie ręcznie, żadnemu programowi.",
      repo: "Archiwum Wzorowo",
      books: [
        { name: "Wierzbno Górne, Liber natorum 1830–1859", id: "WG-U-1830", kinds: "baptism", years: "1830-1859" },
        { name: "Wierzbno Górne, Liber copulatorum 1830–1859", id: "WG-S-1830", kinds: "marriage", years: "1830-1859" },
        { name: "Wierzbno Górne, Liber mortuorum 1850–1900", id: "WG-Z-1850", kinds: "death", years: "1850-1900" },
        { name: "Spis mieszkańców Wierzbno Górne 1869", id: "WG-SP-1869", kinds: "census", years: "1869-1869" },
      ],
      tasks: [
        { what: "Chrzest Józefa Wilka ok. 1838", book: 0, images: "112-115", about: ["miller"], have: 2, on: "Skany 112–115 z księgi urodzeń Wierzbno Górne 1830–1859, do zapisania ręcznie z cyfrowej czytelni Archiwum Wzorowo." },
        { what: "Ślub Józefa Wilka i Barbary", book: 1, images: "77-79", about: ["miller", "millerWife"], have: 0, on: "Skany 77–79 z księgi ślubów Wierzbno Górne 1830–1859, do zapisania ręcznie z cyfrowej czytelni Archiwum Wzorowo." },
        { what: "Spis mieszkańców 1869: młyn nr 5 w Wierzbnie Górnym", book: 3, images: "5-8", about: ["miller", "millerWife", "millerSon"], have: 3, on: "Skany 5–8 ze spisu mieszkańców Wierzbno Górne 1869, do zapisania ręcznie z cyfrowej czytelni Archiwum Wzorowo." },
        { what: "Zgon Józefa Wilka, młynarza", book: 2, images: "140-142", about: ["miller"], have: 0, on: "Skany 140–142 z księgi zgonów Wierzbno Górne 1850–1900, do zapisania ręcznie z cyfrowej czytelni Archiwum Wzorowo." },
        { what: "Zgon Barbary Wilk", book: 2, images: "201-202", about: ["millerWife"], have: 1, on: "Skany 201–202 z księgi zgonów Wierzbno Górne 1850–1900, do zapisania ręcznie z cyfrowej czytelni Archiwum Wzorowo." },
      ],
      summary: "Archiwum Wzorowo pozwala zapisywać skany tylko ręcznie: pięć zadań czeka na zapisanie skanów, wnioski do USC Wzorowo są przygotowane w notes/.",
      next: "po zapisaniu skanów odczytać akty rodziny Wilków z młyna",
    },
    office: {
      to: "USC Wzorowo",
      letters: [
        {
          what: "Odpis aktu małżeństwa: Piotr Mazur i Zofia Jaworska", about: ["petr", "anna"], file: "notes/wniosek-usc-malzenstwo-mazur.md",
          on: "Wysłać wniosek o odpis aktu małżeństwa (Piotr Mazur i Zofia Jaworska, ok. 1955) i czekać na odpowiedź USC Wzorowo.",
          text: "Urząd Stanu Cywilnego Wzorowo\n\nDzień dobry,\n\nuprzejmie proszę o wydanie odpisu zupełnego aktu małżeństwa Piotra Mazura (ur. 7.6.1929 w Wierzbnie Górnym) i Zofii Jaworskiej (ur. 14.1.1931 w Wierzbnie Dolnym), zawartego ok. 1955 roku.\n\nJestem ich córką; odpis jest potrzebny do badań genealogicznych.\n\nZ poważaniem\nMałgorzata Mazur",
        },
        {
          what: "Odpis aktu zgonu: Antoni Mazur", about: ["antonin"], file: "notes/wniosek-usc-zgon-antoni.md",
          on: "Wysłać wniosek o odpis aktu zgonu (Antoni Mazur, cieśla, zmarł po 1950 roku) i czekać na odpowiedź USC Wzorowo.",
          text: "Urząd Stanu Cywilnego Wzorowo\n\nDzień dobry,\n\nuprzejmie proszę o wydanie odpisu aktu zgonu Antoniego Mazura, cieśli z Wierzbna Górnego, zmarłego po 1950 roku.\n\nJestem jego wnuczką; odpis jest potrzebny do badań genealogicznych.\n\nZ poważaniem\nMałgorzata Mazur",
        },
        {
          what: "Odpis aktu urodzenia: Maria Drozd", about: ["marieK"], file: "notes/wniosek-usc-urodzenie-drozd.md",
          on: "Wysłać wniosek o odpis aktu urodzenia (Maria Drozd, ok. 1905) i czekać na odpowiedź USC Wzorowo.",
          text: "Urząd Stanu Cywilnego Wzorowo\n\nDzień dobry,\n\nuprzejmie proszę o wydanie odpisu aktu urodzenia Marii Drozd, urodzonej ok. 1905 roku, późniejszej żony Antoniego Mazura z Wierzbna Górnego.\n\nJestem jej wnuczką; odpis jest potrzebny do badań genealogicznych.\n\nZ poważaniem\nMałgorzata Mazur",
        },
      ],
    },
    sent: [
      {
        what: "Kronika parafialna Wierzbna Górnego: wzmianki o młynie i rodzinie Wilków", about: ["katerina"], to: "Parafia Wierzbno Górne", daysAgo: 9, file: "notes/zapytanie-parafia-kronika.md",
        on: "Odpowiedź parafii Wierzbno Górne na zapytanie o kronikę parafialną (młyn nr 5, rodzina Wilków).",
        text: "Parafia Wierzbno Górne\n\nDzień dobry,\n\nzwracam się z zapytaniem, czy kronika parafialna Wierzbna Górnego wspomina o młynie nr 5 i rodzinie młynarza Józefa Wilka (ok. 1860–1880).\n\nZ poważaniem\nMałgorzata Mazur",
      },
      {
        what: "Księga gruntowa: dom Mazurów w Wierzbnie Górnym", about: ["antonin", "marieK"], to: "Archiwum Państwowe Wzorowo", daysAgo: 4, file: "notes/zapytanie-archiwum-ksiega-gruntowa.md",
        on: "Odpowiedź Archiwum Państwowego Wzorowo na zapytanie o księgę gruntową Wierzbna Górnego (dom Antoniego Mazura).",
        text: "Archiwum Państwowe Wzorowo\n\nDzień dobry,\n\nuprzejmie proszę o informację, czy archiwum przechowuje księgę gruntową Wierzbna Górnego z wpisem o domu Antoniego Mazura (ok. 1925–1935).\n\nZ poważaniem\nMałgorzata Mazur",
      },
    ],
    family: { what: "Zdjęcie ślubne Piotra i Zofii Mazurów", about: ["petr", "anna"], on: "Zdjęcie ze ślubu Piotra i Zofii Mazurów, jeśli zachowało się w rodzinie." },
    web: {
      what: "Karta ewidencyjna Józefa Jaworskiego (rocznik 1898)", about: ["josef"], url: "https://karty-wojskowe.example/rocznik-1898/jaworski-jozef",
      on: "Karta ewidencyjna Józefa Jaworskiego do odnalezienia w zdigitalizowanych kartach wojskowych: https://karty-wojskowe.example/rocznik-1898/jaworski-jozef",
    },
    twoHosts: {
      name: "metryki-wojewodzkie", title: "Metryki wojewódzkie online", hosts: ["metryki.wojewodztwo-wzorowo.example", "skany.wojewodztwo-wzorowo.example"], terms: "https://metryki.wojewodztwo-wzorowo.example/regulamin",
      reading: "Skany ksiąg metrykalnych można swobodnie pobierać, także programem, w tempie podanym przez portal.",
    },
    noCap: {
      name: "groby-wzorowo", title: "Groby Wzorowo", host: "groby-wzorowo.example", terms: "https://groby-wzorowo.example/o-projekcie",
      reading: "Zdjęcia nagrobków są swobodnie dostępne; portal wyraźnie pozwala na pobieranie programem.",
    },
    why: { letter: "akt urzędowy", photo: "zdjęcie do Księgi rodu", web: "służba wojskowa", mill: "rodzina z młyna" },
    doneWhen: { letter: "odpowiedź urzędu", photo: "zdjęcie odnalezione", web: "karta ewidencyjna odnaleziona", images: "skany zapisane i odczytane" },
  },
};

export default { cs, en, de, pl };
