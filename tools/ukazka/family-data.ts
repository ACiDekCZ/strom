// The invented family for the app's general screenshots (family view, fan chart,
// timeline, map, family book, person detail…): the same family as the demo
// research (demo-data.ts) — Horákovi / the Hartley family / Familie Weber /
// Rodzina Jaworskich —
// grown into a full tree of seven generations, from an ancestor born about 1810
// to children born after 2010, with places (coordinates baked in), life events,
// register entries with their excerpts, stories, emigrants and anniversaries
// close to the day the screenshots are made. Nothing here is a real family.
//
// The SHAPE is one for all languages (FAMILY below: who, when, where, which
// events); the WORDS are per language (TEXT). build-family.ts puts them
// together into a Strom JSON. Add a person: a row in FAMILY and a name in every
// TEXT[lang].names.

/** Place keys used in FAMILY; each language names them (TEXT[lang].places) and gives their coordinates. */
export type PlaceKey = "home" | "mill" | "spa" | "town" | "city" | "capital" | "uni" | "emigrant" | "abroad";

export type Ev = {
  type: "baptism" | "burial" | "occupation" | "residence" | "military" | "emigration" | "immigration" | "education" | "confirmation" | "census";
  date?: string;
  /** The date of this source key's record (TEXT[lang].sources[k].date: the census day differs by language). */
  dateOf?: string;
  /** TEXT[lang].words key: the house or address (the event's address field). */
  house?: string;
  /** One event of several persons (Strom 3.28 shared event): every copy with the same key shares its id. */
  share?: string;
  /** The age the record gives, counted from the birth to the event's date. */
  age?: boolean;
  place?: PlaceKey;
  /** TEXT[lang].words key: the occupation, school, regiment… (shown as the note). */
  word?: string;
  /** Godparents / witnesses: keys of FAMILY persons, or TEXT[lang].words keys (people outside the tree). */
  godparents?: string[];
  /** A source key of TEXT[lang].sources that cites this event. */
  source?: string;
};

export type P = {
  sex: "male" | "female";
  born?: string;
  bornAt?: PlaceKey;
  died?: string;
  diedAt?: PlaceKey;
  events?: Ev[];
  /** A source key citing the birth. */
  birthSource?: string;
  /** Several source keys citing the birth (the order of a fact's citations, Strom 3.29): instead of birthSource. */
  birthSources?: string[];
  /** TEXT[lang].words key: the cause of death, as a register records it (the Register card shows it). */
  deathCause?: string;
  /** Relative to the day of the screenshots: born this many days later (an anniversary soon), keeping the year of `born`. */
  birthdaySoon?: number;
};

export type U = {
  a: string;
  b: string;
  kids?: string[];
  date?: string;
  place?: PlaceKey;
  status?: "married" | "divorced" | "partners";
  source?: string;
  /** The wedding anniversary falls this many days after the day of the screenshots (keeping the year of `date`). */
  anniversarySoon?: number;
};

/** Everyone, by key. The focus person of the family view is `jana`; the fan chart's `tomasN`. */
export const FAMILY: Record<string, P> = {
  // ── generation 1–2: the oldest Horáks
  // (the oldest: approximate years, as the registers before 1840 leave them; an approximate founder reads "about")
  matej: { sex: "male", born: "~1810", bornAt: "home", died: "1878-11-03", diedAt: "home", deathCause: "oldAge", events: [{ type: "occupation", word: "farmer" }, { type: "burial", date: "1878-11-06", place: "home" }] },
  jan: { sex: "male", born: "1838-06-24", bornAt: "home", died: "1901-02-17", diedAt: "home", deathCause: "dropsy", events: [{ type: "baptism", date: "1838-06-25", place: "home" }, { type: "occupation", word: "farmer" }, { type: "residence", place: "home", word: "house12" }, { type: "burial", date: "1901-02-20", place: "home" }] },
  annaD: { sex: "female", born: "~1840", bornAt: "home", died: "1905-12-08", diedAt: "home", deathCause: "consumption", events: [{ type: "burial", date: "1905-12-11", place: "home" }] },
  tomas: { sex: "male", born: "1846-09-29", bornAt: "home", died: "1910-04-02", diedAt: "home", deathCause: "heart", events: [{ type: "baptism", date: "1846-09-30", place: "home" }, { type: "occupation", word: "blacksmith" }, { type: "burial", date: "1910-04-05", place: "home" }] },
  rozalie: { sex: "female", born: "1849-03-12", bornAt: "mill", died: "1920-01-25", diedAt: "home", deathCause: "oldAge", events: [{ type: "baptism", date: "1849-03-13", place: "mill" }, { type: "burial", date: "1920-01-28", place: "home" }] },
  jakub: { sex: "male", born: "1870-07-25", bornAt: "mill", died: "1935-10-14", diedAt: "mill", deathCause: "cancer", events: [{ type: "baptism", date: "1870-07-26", place: "mill" }, { type: "occupation", word: "carpenter" }, { type: "burial", date: "1935-10-17", place: "mill" }] },
  terezie: { sex: "female", born: "1874-10-15", bornAt: "mill", died: "1949-05-30", diedAt: "mill", events: [{ type: "baptism", date: "1874-10-16", place: "mill" }, { type: "burial", date: "1949-06-02", place: "mill" }] },
  josefKos: { sex: "male", born: "1868-03-19", bornAt: "spa", died: "1930-08-09", diedAt: "spa", deathCause: "heart", events: [{ type: "baptism", date: "1868-03-20", place: "spa" }, { type: "occupation", word: "innkeeper" }, { type: "burial", date: "1930-08-12", place: "spa" }] },
  johana: { sex: "female", born: "1872-05-24", bornAt: "spa", died: "1950-02-11", diedAt: "spa", events: [{ type: "baptism", date: "1872-05-25", place: "spa" }, { type: "burial", date: "1950-02-14", place: "spa" }] },
  karelN: { sex: "male", born: "1898-11-04", bornAt: "city", died: "1970-06-21", diedAt: "city", events: [{ type: "baptism", date: "1898-11-06", place: "city" }, { type: "occupation", word: "tram" }, { type: "burial", date: "1970-06-24", place: "city" }] },
  ludmilaN: { sex: "female", born: "1902-02-28", bornAt: "city", died: "1985-09-16", diedAt: "city", events: [{ type: "baptism", date: "1902-03-02", place: "city" }, { type: "occupation", word: "cook" }, { type: "burial", date: "1985-09-19", place: "city" }] },
  josefS: { sex: "male", born: "1900-08-30", bornAt: "town", died: "1975-03-03", diedAt: "city", events: [{ type: "baptism", date: "1900-09-01", place: "town" }, { type: "occupation", word: "shoemaker" }, { type: "burial", date: "1975-03-06", place: "city" }] },
  marieS: { sex: "female", born: "1904-12-06", bornAt: "town", died: "1990-07-19", diedAt: "city", events: [{ type: "baptism", date: "1904-12-08", place: "town" }, { type: "occupation", word: "spinner" }, { type: "burial", date: "1990-07-23", place: "city" }] },
  // the parents of five of Jana's great-great-grandparents: the fan of five generations around her nearly full
  jakubFa: { sex: "male", born: "1841-03-08", bornAt: "mill", died: "1903-11-19", diedAt: "mill", deathCause: "pneumonia", events: [{ type: "baptism", date: "1841-03-09", place: "mill" }, { type: "occupation", word: "cottager" }, { type: "burial", date: "1903-11-22", place: "mill" }] },
  jakubMo: { sex: "female", born: "1845-07-21", bornAt: "mill", died: "1912-02-04", diedAt: "mill", events: [{ type: "baptism", date: "1845-07-22", place: "mill" }, { type: "burial", date: "1912-02-07", place: "mill" }] },
  terezieFa: { sex: "male", born: "1846-05-02", bornAt: "mill", died: "1915-09-27", diedAt: "mill", events: [{ type: "baptism", date: "1846-05-03", place: "mill" }, { type: "occupation", word: "farmer" }, { type: "burial", date: "1915-09-30", place: "mill" }] },
  terezieMo: { sex: "female", born: "1850-01-16", bornAt: "mill", died: "1921-06-08", diedAt: "mill", deathCause: "oldAge", events: [{ type: "baptism", date: "1850-01-17", place: "mill" }, { type: "burial", date: "1921-06-11", place: "mill" }] },
  josefKosFa: { sex: "male", born: "1839-10-14", bornAt: "spa", died: "1899-04-30", diedAt: "spa", deathCause: "consumption", events: [{ type: "baptism", date: "1839-10-15", place: "spa" }, { type: "occupation", word: "innkeeper" }, { type: "burial", date: "1899-05-03", place: "spa" }] },
  josefKosMo: { sex: "female", born: "1843-12-03", bornAt: "spa", died: "1908-03-17", diedAt: "spa", events: [{ type: "baptism", date: "1843-12-04", place: "spa" }, { type: "burial", date: "1908-03-20", place: "spa" }] },
  johanaFa: { sex: "male", born: "1842-06-19", bornAt: "spa", died: "1910-01-12", diedAt: "spa", events: [{ type: "baptism", date: "1842-06-20", place: "spa" }, { type: "occupation", word: "baker" }, { type: "burial", date: "1910-01-15", place: "spa" }] },
  johanaMo: { sex: "female", born: "1847-09-09", bornAt: "spa", died: "1913-10-25", diedAt: "spa", deathCause: "heart", events: [{ type: "baptism", date: "1847-09-10", place: "spa" }, { type: "burial", date: "1913-10-28", place: "spa" }] },
  ludmilaFa: { sex: "male", born: "1848-08-28", bornAt: "home", died: "1919-12-30", diedAt: "home", deathCause: "stroke", events: [{ type: "baptism", date: "1848-08-29", place: "home" }, { type: "occupation", word: "cottager" }, { type: "burial", date: "1920-01-02", place: "home" }] },
  ludmilaMo: { sex: "female", born: "1851-04-14", bornAt: "home", died: "1925-07-02", diedAt: "home", events: [{ type: "baptism", date: "1851-04-15", place: "home" }, { type: "burial", date: "1925-07-05", place: "home" }] },

  // ── generation 3: Václav and his emigrant brother, the Krejčís, the Malýs
  vaclav: { sex: "male", born: "1865-10-01", bornAt: "home", died: "1931-03-12", diedAt: "home", deathCause: "stroke", events: [{ type: "baptism", date: "1865-10-02", place: "home" }, { type: "occupation", word: "farmer", source: "josef" }, { type: "census", dateOf: "census", place: "home", house: "house12", source: "census", share: "census1921", age: true }, { type: "burial", date: "1931-03-15", place: "home" }] },
  frantisekH: {
    sex: "male", born: "1868-05-14", bornAt: "home", died: "1934-12-02", diedAt: "emigrant", deathCause: "pneumonia",
    events: [{ type: "baptism", date: "1868-05-15", place: "home" }, { type: "occupation", word: "farmhand" }, { type: "emigration", date: "1891-04-18", place: "home", word: "ship", source: "emig" }, { type: "immigration", date: "1891-05-02", place: "emigrant", source: "emig" }, { type: "occupation", word: "factory" }, { type: "burial", date: "1934-12-05", place: "emigrant" }],
  },
  // the emigrant's two marriages over the ocean: a widower who married again (marriage order, app-32)
  hWife1: { sex: "female", born: "1871-09-12", bornAt: "home", died: "1905-02-21", diedAt: "emigrant", deathCause: "consumption", events: [{ type: "baptism", date: "1871-09-13", place: "home" }, { type: "burial", date: "1905-02-24", place: "emigrant" }] },
  hWife2: { sex: "female", born: "1879-04-03", bornAt: "emigrant", died: "1951-08-30", diedAt: "emigrant", events: [{ type: "baptism", date: "1879-04-05", place: "emigrant" }, { type: "burial", date: "1951-09-02", place: "emigrant" }] },
  hSon: { sex: "male", born: "1896-07-19", bornAt: "emigrant", died: "1962-01-08", diedAt: "emigrant", events: [{ type: "baptism", date: "1896-07-21", place: "emigrant" }, { type: "occupation", word: "machinist" }, { type: "burial", date: "1962-01-11", place: "emigrant" }] },
  hDaughter: { sex: "female", born: "1910-03-26", bornAt: "emigrant", died: "1994-11-02", diedAt: "emigrant", events: [{ type: "baptism", date: "1910-03-27", place: "emigrant" }, { type: "occupation", word: "teacher" }, { type: "burial", date: "1994-11-05", place: "emigrant" }] },
  katerina: { sex: "female", born: "~1870", bornAt: "mill", died: "1944-01-30", diedAt: "home", deathCause: "oldAge", events: [{ type: "census", dateOf: "census", place: "home", house: "house12", source: "census", share: "census1921", age: true }, { type: "burial", date: "1944-02-02", place: "home" }] },
  frantisek: { sex: "male", born: "1874-02-12", bornAt: "home", died: "1940-09-06", diedAt: "home", deathCause: "cancer", events: [{ type: "baptism", date: "1874-02-13", place: "home" }, { type: "occupation", word: "blacksmith" }, { type: "burial", date: "1940-09-09", place: "home" }] },
  ludmila: { sex: "female", born: "1876-06-08", bornAt: "home", died: "1950-11-23", diedAt: "home", deathCause: "oldAge", events: [{ type: "baptism", date: "1876-06-09", place: "home" }, { type: "burial", date: "1950-11-26", place: "home" }] },
  antonin: { sex: "male", born: "1898-04-02", bornAt: "mill", died: "1962-12-27", diedAt: "mill", deathCause: "heart", events: [{ type: "baptism", date: "1898-04-03", place: "mill" }, { type: "occupation", word: "carpenter" }, { type: "burial", date: "1962-12-30", place: "mill" }] },
  marieK: { sex: "female", born: "1902-09-17", bornAt: "spa", died: "1979-04-04", diedAt: "mill", events: [{ type: "baptism", date: "1902-09-18", place: "spa" }, { type: "burial", date: "1979-04-07", place: "mill" }] },
  jiriN: { sex: "male", born: "1925-01-19", bornAt: "city", died: "1998-10-08", diedAt: "city", events: [{ type: "baptism", date: "1925-01-20", place: "city" }, { type: "occupation", word: "engineer" }, { type: "burial", date: "1998-10-12", place: "city" }] },
  eva: { sex: "female", born: "1928-07-07", bornAt: "city", died: "2015-02-14", diedAt: "city", events: [{ type: "baptism", date: "1928-07-08", place: "city" }, { type: "occupation", word: "teacher" }, { type: "burial", date: "2015-02-17", place: "city" }] },

  // ── generation 4: Josef and Marie
  josef: {
    // the birth cited three times (the order of a fact's citations, app-61): the baptism entry, the death entry of
    // 1967, the baptisms' index
    sex: "male", born: "1898-03-03", bornAt: "home", died: "1967-11-20", diedAt: "home", birthSources: ["josef", "josefDeath", "josefIndex"], deathCause: "pneumonia",
    events: [
      { type: "baptism", date: "1898-03-06", place: "home", godparents: ["gpJosef1"], source: "josef" },
      { type: "military", date: "1916", word: "regiment" },
      { type: "occupation", word: "farmer", source: "census" },
      { type: "census", dateOf: "census", place: "home", house: "house12", source: "census", share: "census1921", age: true },
      // the same residence recorded separately for three people (a lead to join them into one event, app-57c)
      { type: "residence", date: "1936-04-01", place: "home", house: "house31" },
      { type: "burial", date: "1967-11-23", place: "home" },
    ],
  },
  // the same godparent as at Josef's baptism: a recurring godparent (a lead in Tree overview › Data quality, app-17)
  ruzena: { sex: "female", born: "1900-10-09", bornAt: "home", died: "1975-06-01", diedAt: "home", events: [{ type: "baptism", date: "1900-10-11", place: "home", godparents: ["gpJosef1"] }, { type: "occupation", word: "seamstress" }, { type: "census", dateOf: "census", place: "home", house: "house12", source: "census", share: "census1921", age: true }, { type: "burial", date: "1975-06-04", place: "home" }] },
  marie: { sex: "female", born: "1902-08-20", bornAt: "home", died: "1988-01-15", diedAt: "town", deathCause: "heart", events: [{ type: "baptism", date: "1902-08-24", place: "home" }, { type: "residence", date: "1936-04-01", place: "home", house: "house31" }, { type: "burial", date: "1988-01-19", place: "home" }] },

  // ── generation 5: Anna, her brother and sister; Petr
  karel: { sex: "male", born: "1928-05-21", bornAt: "home", died: "2001-08-13", diedAt: "town", events: [{ type: "baptism", date: "1928-05-22", place: "home" }, { type: "occupation", word: "machinist" }, { type: "burial", date: "2001-08-16", place: "town" }] },
  bozena: { sex: "female", born: "1930-11-30", bornAt: "spa", died: "2012-03-22", diedAt: "town", events: [{ type: "baptism", date: "1930-12-01", place: "spa" }, { type: "occupation", word: "clerk" }, { type: "burial", date: "2012-03-25", place: "town" }] },
  anna: {
    sex: "female", born: "1931-01-14", bornAt: "home", died: "2019-06-02", diedAt: "town", birthSource: "anna",
    events: [
      { type: "baptism", date: "1931-01-18", place: "home", godparents: ["ruzena"], source: "anna" },
      { type: "residence", date: "1936-04-01", place: "home", house: "house31" },
      { type: "education", date: "1950", place: "town", word: "nurseSchool" },
      { type: "occupation", word: "nurse" },
      { type: "burial", date: "2019-06-05", place: "home" },
    ],
  },
  petr: { sex: "male", born: "1929-06-07", bornAt: "mill", died: "2004-09-28", diedAt: "town", events: [{ type: "baptism", date: "1929-06-08", place: "mill" }, { type: "occupation", word: "toolmaker" }, { type: "burial", date: "2004-10-01", place: "town" }] },
  vera: { sex: "female", born: "1935-04-11", bornAt: "home", events: [{ type: "emigration", date: "1968-09", place: "home" }, { type: "residence", place: "abroad" }, { type: "occupation", word: "translator" }] },
  veraH: { sex: "male", born: "1932-02-03", bornAt: "abroad", died: "2009-11-11", diedAt: "abroad", events: [{ type: "baptism", date: "1932-02-05", place: "abroad" }, { type: "occupation", word: "musician" }, { type: "burial", date: "2009-11-14", place: "abroad" }] },

  // ── generation 6: Jana (the focus), her brother, her cousins; Pavel
  jiriK: { sex: "male", born: "1955-03-15", bornAt: "town", events: [{ type: "occupation", word: "engineer" }] },
  hana: { sex: "female", born: "1958-09-02", bornAt: "town", events: [{ type: "occupation", word: "doctor" }, { type: "residence", place: "city" }] },
  jana: { sex: "female", born: "1956-04-22", bornAt: "town", events: [{ type: "education", date: "1979", place: "uni", word: "university" }, { type: "occupation", word: "teacher" }, { type: "residence", place: "city" }] },
  martinM: { sex: "male", born: "1960-12-18", bornAt: "town", events: [{ type: "occupation", word: "architect" }, { type: "residence", place: "capital" }] },
  pavel: { sex: "male", born: "1953-08-09", bornAt: "city", events: [{ type: "occupation", word: "engineer" }] },

  // ── generation 7–8: Jana's children and grandchildren
  tomasN: { sex: "male", born: "1981-02-05", bornAt: "city", events: [{ type: "education", date: "2005", place: "uni", word: "university" }, { type: "occupation", word: "it" }] },
  lucie: { sex: "female", born: "1984-06-30", bornAt: "uni" },
  kristyna: { sex: "female", born: "1985-10-27", bornAt: "city", events: [{ type: "occupation", word: "designer" }, { type: "residence", place: "capital" }] },
  martin: { sex: "male", born: "1983-01-12", bornAt: "capital" },
  ema: { sex: "female", born: "2010-05-17", bornAt: "city", birthdaySoon: 3 },
  jakubN: { sex: "male", born: "2013-09-08", bornAt: "city" },
  adam: { sex: "male", born: "2015-03-24", bornAt: "capital", birthdaySoon: 12 },
};

export const UNIONS: U[] = [
  { a: "matej", b: "", kids: ["jan"] },
  { a: "jan", b: "annaD", kids: ["vaclav", "frantisekH"], date: "1863-11-10", place: "home" },
  { a: "tomas", b: "rozalie", kids: ["frantisek"], date: "1871-02-07", place: "home" },
  { a: "jakub", b: "terezie", kids: ["antonin"], date: "1895-01-29", place: "mill" },
  { a: "josefKos", b: "johana", kids: ["marieK"], date: "1896-06-16", place: "spa" },
  { a: "karelN", b: "ludmilaN", kids: ["jiriN"], date: "1923-05-05", place: "city" },
  { a: "josefS", b: "marieS", kids: ["eva"], date: "1926-09-11", place: "town" },
  { a: "jakubFa", b: "jakubMo", kids: ["jakub"], date: "1868-02-11", place: "mill" },
  { a: "terezieFa", b: "terezieMo", kids: ["terezie"], date: "1872-11-05", place: "mill" },
  { a: "josefKosFa", b: "josefKosMo", kids: ["josefKos"], date: "1866-05-22", place: "spa" },
  { a: "johanaFa", b: "johanaMo", kids: ["johana"], date: "1870-02-08", place: "spa" },
  { a: "ludmilaFa", b: "ludmilaMo", kids: ["ludmila"], date: "1874-06-30", place: "home" },
  { a: "vaclav", b: "katerina", kids: ["josef", "ruzena"], date: "1896-01-21", place: "home" },
  { a: "frantisekH", b: "hWife1", kids: ["hSon"], date: "1894-10-06", place: "emigrant" },
  { a: "frantisekH", b: "hWife2", kids: ["hDaughter"], date: "1908-05-16", place: "emigrant" },
  { a: "frantisek", b: "ludmila", kids: ["marie"], date: "1899-11-14", place: "home" },
  { a: "antonin", b: "marieK", kids: ["petr"], date: "1927-04-23", place: "mill" },
  { a: "jiriN", b: "eva", kids: ["pavel"], date: "1951-10-20", place: "city" },
  { a: "josef", b: "marie", kids: ["karel", "anna", "vera"], date: "1924-05-12", place: "home", source: "marr" },
  { a: "karel", b: "bozena", kids: ["jiriK", "hana"], date: "1953-07-18", place: "spa" },
  { a: "petr", b: "anna", kids: ["jana", "martinM"], date: "1954-06-26", place: "home", anniversarySoon: 8 },
  { a: "veraH", b: "vera", date: "1970-03-14", place: "abroad" },
  { a: "pavel", b: "jana", kids: ["tomasN", "kristyna"], date: "1979-09-15", place: "city" },
  { a: "tomasN", b: "lucie", kids: ["ema", "jakubN"], date: "2008-08-23", place: "uni" },
  { a: "martin", b: "kristyna", kids: ["adam"], date: "2012-06-09", place: "capital" },
];

/**
 * What a source is beyond its words, the same in every language: its reliability (GEDCOM QUAY, default 3 =
 * Original) and the events its record records (Source.events, GEDCOM EVENTS_RECORDED: the primary record of a
 * fact in the order of its citations).
 */
export const SOURCE_SHAPE: Record<string, { quality?: number; events?: string[] }> = {
  josef: { events: ["BIRT", "CHR"] },
  josefDeath: { events: ["DEAT", "BURI"] },
  josefIndex: { quality: 2 },
};

export interface Text {
  tree: string;
  /** key → [first name, surname] (women: maiden name). */
  names: Record<string, [string, string]>;
  places: Record<PlaceKey, { name: string; lat: number; lon: number; label: string }>;
  /** Occupations, schools, godparents outside the tree… (Ev.word, Ev.godparents). */
  words: Record<string, string>;
  /** Register entries: title, repository, reference, recorded, transcript, and the scan page of gen-scans.mjs it is cut from. */
  sources: Record<string, { title: string; repository: string; reference?: string; date?: string; transcript: string; scan?: string }>;
  notes: Record<string, string>;
  question: string;
  nameVariants: Record<string, string[]>;
  surnameVariants: string[][];
}

const cs: Text = {
  tree: "Horákovi",
  names: {
    matej: ["Matěj", "Horák"], jan: ["Jan", "Horák"], annaD: ["Anna", "Dvořáková"], tomas: ["Tomáš", "Krejčí"], rozalie: ["Rozálie", "Černá"],
    jakub: ["Jakub", "Malý"], terezie: ["Terezie", "Pokorná"], josefKos: ["Josef", "Kos"], johana: ["Johana", "Benešová"],
    karelN: ["Karel", "Novotný"], ludmilaN: ["Ludmila", "Šimková"], josefS: ["Josef", "Svoboda"], marieS: ["Marie", "Dušková"],
    vaclav: ["Václav", "Horák"], frantisekH: ["František", "Horák"],
    hWife1: ["Marie", "Pospíšilová"], hWife2: ["Aloisie", "Kratochvílová"], hSon: ["Jaroslav", "Horák"], hDaughter: ["Helena", "Horáková"], katerina: ["Kateřina", "Vlková"], frantisek: ["František", "Krejčí"], ludmila: ["Ludmila", "Nováková"],
    antonin: ["Antonín", "Malý"], marieK: ["Marie", "Kosová"], jiriN: ["Jiří", "Novotný"], eva: ["Eva", "Svobodová"],
    josef: ["Josef", "Horák"], ruzena: ["Růžena", "Horáková"], marie: ["Marie", "Krejčí"],
    karel: ["Karel", "Horák"], bozena: ["Božena", "Kopecká"], anna: ["Anna", "Horáková"], petr: ["Petr", "Malý"], vera: ["Věra", "Horáková"], veraH: ["Franz", "Huber"],
    jiriK: ["Jiří", "Horák"], hana: ["Hana", "Horáková"], jana: ["Jana", "Malá"], martinM: ["Martin", "Malý"], pavel: ["Pavel", "Novotný"],
    tomasN: ["Tomáš", "Novotný"], lucie: ["Lucie", "Marková"], kristyna: ["Kristýna", "Novotná"], martin: ["Martin", "Dvořák"],
    ema: ["Ema", "Novotná"], jakubN: ["Jakub", "Novotný"], adam: ["Adam", "Dvořák"],
    jakubFa: ["Ignác", "Malý"], jakubMo: ["Anna", "Kubálková"], terezieFa: ["Vavřinec", "Pokorný"], terezieMo: ["Rozálie", "Vrabcová"],
    josefKosFa: ["Matouš", "Kos"], josefKosMo: ["Marie", "Valoušková"], johanaFa: ["Šimon", "Beneš"], johanaMo: ["Kateřina", "Holínková"],
    ludmilaFa: ["Florián", "Novák"], ludmilaMo: ["Johana", "Machýčková"],
  },
  places: {
    home: { name: "Dolní Lhota", lat: 49.1372, lon: 17.8124, label: "Dolní Lhota, okres Zlín, Zlínský kraj, Česko" },
    mill: { name: "Horní Lhota", lat: 49.162, lon: 17.7995, label: "Horní Lhota, okres Zlín, Zlínský kraj, Česko" },
    spa: { name: "Luhačovice", lat: 49.0997, lon: 17.7577, label: "Luhačovice, okres Zlín, Zlínský kraj, Česko" },
    town: { name: "Zlín", lat: 49.2268, lon: 17.6667, label: "Zlín, okres Zlín, Zlínský kraj, Česko" },
    city: { name: "Brno", lat: 49.1922, lon: 16.6113, label: "Brno, okres Brno-město, Jihomoravský kraj, Česko" },
    capital: { name: "Praha", lat: 50.0875, lon: 14.4213, label: "Praha, Česko" },
    uni: { name: "Olomouc", lat: 49.5941, lon: 17.2511, label: "Olomouc, okres Olomouc, Olomoucký kraj, Česko" },
    emigrant: { name: "Chicago", lat: 41.8756, lon: -87.6244, label: "Chicago, Cook County, Illinois, United States" },
    abroad: { name: "Vídeň", lat: 48.2084, lon: 16.3725, label: "Wien, Österreich" },
  },
  words: {
    farmer: "rolník", blacksmith: "kovář", carpenter: "tesař", innkeeper: "hostinský", tram: "řidič tramvaje", shoemaker: "obuvník",
    farmhand: "čeledín", factory: "dělník na jatkách", ship: "lodí z Brém do New Yorku", engineer: "inženýr", teacher: "učitelka",
    regiment: "pěší pluk č. 3, italská fronta", seamstress: "švadlena", machinist: "strojník", nurseSchool: "zdravotnická škola", nurse: "zdravotní sestra",
    toolmaker: "nástrojař", translator: "překladatelka", doctor: "lékařka", university: "Univerzita Palackého", architect: "architekt",
    it: "programátor", designer: "grafička", house12: "čp. 12", house31: "čp. 31", pneumonia: "zápal plic", stroke: "mrtvice", gpJosef1: "Jan Vlk, mlynář z Horní Lhoty",
    oldAge: "sešlost věkem", dropsy: "vodnatelnost", consumption: "tuberkulóza plic", heart: "selhání srdce", cancer: "rakovina",
    cook: "kuchařka", spinner: "přadlena", cottager: "domkář", baker: "pekař", clerk: "úřednice", musician: "hudebník",
  },
  sources: {
    anna: { title: "Křest Anny Horákové 1931", repository: "Státní oblastní archiv", reference: "Dolní Lhota, N 1890–1935, fol. 112", date: "1931-01-18", scan: "bapt1931",
      transcript: "Anna, nar. 14. ledna, křtěna 18. ledna 1931, Dolní Lhota čp. 12. Otec Josef Horák, rolník, syn Václava Horáka a Kateřiny roz. Vlkové. Matka Marie roz. Krejčí, dcera Františka Krejčího a Ludmily roz. Novákové. Kmotra Růžena Horáková, svobodná." },
    marr: { title: "Oddavky Josefa Horáka a Marie Krejčí 1924", repository: "Státní oblastní archiv", reference: "Dolní Lhota, O 1890–1930, fol. 58", date: "1924-05-12", scan: "marr1924",
      transcript: "12. května 1924. Ženich Josef Horák, rolník, Dolní Lhota čp. 12, syn Václava Horáka a Kateřiny roz. Vlkové, 26 let. Nevěsta Marie Krejčí, Dolní Lhota čp. 31, dcera Františka Krejčího a Ludmily roz. Novákové, 21 let." },
    josef: { title: "Křest Josefa Horáka 1898", repository: "Státní oblastní archiv", reference: "Dolní Lhota, N 1890–1935, fol. 21", date: "1898-03-06", scan: "bapt1898",
      transcript: "Josephus, natus 3. Martii 1898, Dolní Lhota No. 12. Pater Wenceslaus Horák, agricola, filius Joannis Horák. Mater Catharina nata Vlk, filia Joannis Vlk ex Horní Lhota." },
    josefDeath: { title: "Úmrtí Josefa Horáka 1967", repository: "Matriční úřad Dolní Lhota", reference: "Kniha zemřelých 1960–1975, č. 23", date: "1967-11-22",
      transcript: "Josef Horák, rolník, Dolní Lhota čp. 12, zemřel 20. listopadu 1967, zápal plic. Narozen 3. března 1898 v Dolní Lhotě, syn Václava Horáka a Kateřiny roz. Vlkové. Manželka Marie roz. Krejčí. Pohřben 23. listopadu 1967." },
    josefIndex: { title: "Index narozených Dolní Lhota 1890–1935", repository: "Státní oblastní archiv", reference: "Dolní Lhota, index N 1890–1935, písmeno H",
      transcript: "Horák Josef, nar. 3. 3. 1898, čp. 12, N 1890–1935, fol. 21." },
    census: { title: "Sčítání lidu 1921, Dolní Lhota čp. 12", repository: "Státní okresní archiv Zlín", date: "1921-02-15",
      transcript: "Josef Horák, hlava domácnosti, nar. 1897, rolník, Dolní Lhota čp. 12." },
    emig: { title: "Seznam cestujících, Brémy – New York 1891", repository: "Staatsarchiv Bremen", reference: "loď Fulda, č. 214", date: "1891-04-18",
      transcript: "Horák, František, 22 let, čeledín, Dolní Lhota, Rakousko. Cíl: Chicago." },
  },
  notes: {
    katerina: "Podle rodinné paměti pocházela z mlýna v Horní Lhotě.",
    frantisekH: "Vystěhoval se v roce 1891 do Chicaga. Dopisy domů se zachovaly do roku 1912.",
    vera: "V roce 1968 odešla do Vídně, kde se provdala.",
  },
  question: "Ví někdo, ze které rodiny Vlků Kateřina pocházela? Babička říkala, že z mlýna.",
  nameVariants: { josef: ["Josephus Horák"], vaclav: ["Wenceslaus Horák"] },
  surnameVariants: [["Horák", "Horak", "Horaak"]],
};

const en: Text = {
  tree: "Hartley family",
  names: {
    matej: ["Richard", "Hartley"], jan: ["John", "Hartley"], annaD: ["Ann", "Dawson"], tomas: ["Samuel", "Cooper"], rozalie: ["Hannah", "Price"],
    jakub: ["Albert", "Walsh"], terezie: ["Ellen", "Moore"], josefKos: ["Frederick", "Hill"], johana: ["Clara", "Wood"],
    karelN: ["Harold", "Turner"], ludmilaN: ["Dorothy", "Green"], josefS: ["Walter", "Clark"], marieS: ["Lilian", "Shaw"],
    vaclav: ["William", "Hartley"], frantisekH: ["Henry", "Hartley"],
    hWife1: ["Agnes", "Brooks"], hWife2: ["Rose", "Kelly"], hSon: ["Walter", "Hartley"], hDaughter: ["Helen", "Hartley"], katerina: ["Sarah", "Fletcher"], frantisek: ["George", "Cooper"], ludmila: ["Alice", "Bennett"],
    antonin: ["Arthur", "Walsh"], marieK: ["Florence", "Hill"], jiriN: ["Kenneth", "Turner"], eva: ["Joyce", "Clark"],
    josef: ["Thomas", "Hartley"], ruzena: ["Edith", "Hartley"], marie: ["Mary", "Cooper"],
    karel: ["Charles", "Hartley"], bozena: ["Joan", "Ellis"], anna: ["Emily", "Hartley"], petr: ["Peter", "Walsh"], vera: ["Margaret", "Hartley"], veraH: ["David", "Miller"],
    jiriK: ["Michael", "Hartley"], hana: ["Susan", "Hartley"], jana: ["Jane", "Walsh"], martinM: ["Richard", "Walsh"], pavel: ["David", "Turner"],
    tomasN: ["James", "Turner"], lucie: ["Laura", "Hughes"], kristyna: ["Kate", "Turner"], martin: ["Ben", "Harris"],
    ema: ["Ella", "Turner"], jakubN: ["Oliver", "Turner"], adam: ["Leo", "Harris"],
    jakubFa: ["Edward", "Walsh"], jakubMo: ["Martha", "Pritchard"], terezieFa: ["Joseph", "Moore"], terezieMo: ["Eliza", "Rowe"],
    josefKosFa: ["Robert", "Hill"], josefKosMo: ["Harriet", "Lane"], johanaFa: ["Edwin", "Wood"], johanaMo: ["Sophia", "Gough"],
    ludmilaFa: ["Isaac", "Bennett"], ludmilaMo: ["Elizabeth", "Croft"],
  },
  places: {
    home: { name: "Thornbury", lat: 51.6078, lon: -2.5255, label: "Thornbury, South Gloucestershire, England, United Kingdom" },
    mill: { name: "Oakley", lat: 51.6298, lon: -2.5654, label: "Oakley, South Gloucestershire, England, United Kingdom" },
    spa: { name: "Bath", lat: 51.3814, lon: -2.3597, label: "Bath, Bath and North East Somerset, England, United Kingdom" },
    town: { name: "Gloucester", lat: 51.8654, lon: -2.2458, label: "Gloucester, Gloucestershire, England, United Kingdom" },
    city: { name: "Bristol", lat: 51.443, lon: -2.5817, label: "City of Bristol, England, United Kingdom" },
    capital: { name: "London", lat: 51.5074, lon: -0.1278, label: "Greater London, England, United Kingdom" },
    uni: { name: "Cardiff", lat: 51.4817, lon: -3.1792, label: "Cardiff, Wales, United Kingdom" },
    emigrant: { name: "New York", lat: 40.7127, lon: -74.006, label: "New York, United States" },
    abroad: { name: "Toronto", lat: 43.6535, lon: -79.3839, label: "Toronto, Ontario, Canada" },
  },
  words: {
    farmer: "farmer", blacksmith: "blacksmith", carpenter: "carpenter", innkeeper: "innkeeper", tram: "tram driver", shoemaker: "shoemaker",
    farmhand: "farm labourer", factory: "dock labourer", ship: "from Liverpool to New York", engineer: "engineer", teacher: "teacher",
    regiment: "Gloucestershire Regiment, Western Front", seamstress: "seamstress", machinist: "machinist", nurseSchool: "nursing school", nurse: "nurse",
    toolmaker: "toolmaker", translator: "translator", doctor: "doctor", university: "Cardiff University", architect: "architect",
    it: "software developer", designer: "graphic designer", house12: "Mill Lane", house31: "Church Lane", pneumonia: "pneumonia", stroke: "stroke", gpJosef1: "John Fletcher, miller of Oakley",
    oldAge: "old age", dropsy: "dropsy", consumption: "consumption", heart: "heart failure", cancer: "cancer",
    cook: "cook", spinner: "spinner", cottager: "cottager", baker: "baker", clerk: "clerk", musician: "musician",
  },
  sources: {
    anna: { title: "Baptism of Emily Hartley 1931", repository: "County Record Office", reference: "St Mary, Thornbury, baptisms 1890–1935, no. 893", date: "1931-01-18", scan: "bapt1931",
      transcript: "No. 893. Baptised January 18th 1931, born January 14th. Emily, daughter of Thomas and Mary Hartley, Mill Lane, farmer. H. Ellis, Vicar." },
    marr: { title: "Marriage of Thomas Hartley and Mary Cooper 1924", repository: "County Record Office", reference: "St Mary, Thornbury, marriages 1890–1930, no. 58", date: "1924-05-12", scan: "marr1924",
      transcript: "May 12th 1924. Thomas Hartley, 26, bachelor, farmer, Mill Lane, son of William Hartley, farmer. Mary Cooper, 21, spinster, Thornbury, daughter of George Cooper, blacksmith." },
    josef: { title: "Baptism of Thomas Hartley 1898", repository: "County Record Office", reference: "St Mary, Thornbury, baptisms 1890–1935, no. 412", date: "1898-03-06", scan: "bapt1898",
      transcript: "No. 412. Born March 3rd, baptised March 6th 1898. Thomas, son of William and Sarah Hartley, Mill Lane, farmer." },
    josefDeath: { title: "Death of Thomas Hartley 1967", repository: "Thornbury Register Office", reference: "Deaths 1967, no. 23", date: "1967-11-22",
      transcript: "Twentieth November 1967, Mill Lane, Thornbury. Thomas Hartley, farmer, born 3 March 1898 at Thornbury, son of William Hartley. Cause of death: pneumonia. Informant: Charles Hartley, son." },
    josefIndex: { title: "Index of baptisms, St Mary, Thornbury 1890–1935", repository: "County Record Office", reference: "St Mary, Thornbury, baptism index, letter H",
      transcript: "Hartley, Thomas, born 3 Mar 1898, baptised 6 Mar 1898, Mill Lane, no. 412." },
    census: { title: "1921 census, Thornbury, Mill Lane", repository: "The National Archives", date: "1921-06-19",
      transcript: "Thomas Hartley, head, 23, farmer, born Thornbury about 1897." },
    emig: { title: "Passenger list, Liverpool – New York 1891", repository: "The National Archives", reference: "SS Britannic, no. 214", date: "1891-04-18",
      transcript: "Hartley, Henry, 22, farm labourer, Thornbury, England. Destination: New York." },
  },
  notes: {
    katerina: "The family says she came from the mill at Oakley.",
    frantisekH: "Sailed for New York in 1891. His letters home survive up to 1912.",
    vera: "Emigrated to Toronto in 1968, where she married.",
  },
  question: "Does anyone know which Fletchers Sarah came from? Grandma always said the mill.",
  nameVariants: { josef: ["Thos. Hartley"], vaclav: ["Wm. Hartley"] },
  surnameVariants: [["Hartley", "Hartly", "Heartley"]],
};

const de: Text = {
  tree: "Familie Weber",
  names: {
    matej: ["Michael", "Weber"], jan: ["Josef", "Weber"], annaD: ["Anna", "Bauer"], tomas: ["Martin", "Schneider"], rozalie: ["Rosalia", "Schwarz"],
    jakub: ["Jakob", "Klein"], terezie: ["Elisabeth", "Wolf"], josefKos: ["Paul", "Kaiser"], johana: ["Johanna", "Fischer"],
    karelN: ["Wilhelm", "Becker"], ludmilaN: ["Hedwig", "Roth"], josefS: ["Otto", "Richter"], marieS: ["Frieda", "Neumann"],
    vaclav: ["Georg", "Weber"], frantisekH: ["Ludwig", "Weber"],
    hWife1: ["Magdalena", "Frank"], hWife2: ["Barbara", "Lorenz"], hSon: ["Friedrich", "Weber"], hDaughter: ["Luise", "Weber"], katerina: ["Katharina", "Vogel"], frantisek: ["Franz", "Schneider"], ludmila: ["Theresia", "Huber"],
    antonin: ["Anton", "Klein"], marieK: ["Maria", "Kaiser"], jiriN: ["Hans", "Becker"], eva: ["Ilse", "Richter"],
    josef: ["Johann", "Weber"], ruzena: ["Rosa", "Weber"], marie: ["Maria", "Schneider"],
    karel: ["Karl", "Weber"], bozena: ["Gertrud", "Lang"], anna: ["Anna", "Weber"], petr: ["Peter", "Klein"], vera: ["Martha", "Weber"], veraH: ["Robert", "Miller"],
    jiriK: ["Thomas", "Weber"], hana: ["Monika", "Weber"], jana: ["Julia", "Klein"], martinM: ["Stefan", "Klein"], pavel: ["Michael", "Becker"],
    tomasN: ["Daniel", "Becker"], lucie: ["Sarah", "Hoffmann"], kristyna: ["Lena", "Becker"], martin: ["Jonas", "Wagner"],
    ema: ["Emma", "Becker"], jakubN: ["Leon", "Becker"], adam: ["Felix", "Wagner"],
    jakubFa: ["Andreas", "Klein"], jakubMo: ["Walburga", "Sauter"], terezieFa: ["Matthias", "Wolf"], terezieMo: ["Kreszentia", "Haag"],
    josefKosFa: ["Xaver", "Kaiser"], josefKosMo: ["Agatha", "Moosmann"], johanaFa: ["Konrad", "Fischer"], johanaMo: ["Genoveva", "Rapp"],
    ludmilaFa: ["Sebastian", "Huber"], ludmilaMo: ["Ursula", "Hengstler"],
  },
  places: {
    home: { name: "Oberndorf", lat: 48.2909, lon: 8.5711, label: "Oberndorf am Neckar, Landkreis Rottweil, Baden-Württemberg, Deutschland" },
    mill: { name: "Unterdorf", lat: 48.2479, lon: 8.5969, label: "Unterdorf, Landkreis Rottweil, Baden-Württemberg, Deutschland" },
    spa: { name: "Rottweil", lat: 48.1678, lon: 8.627, label: "Rottweil, Landkreis Rottweil, Baden-Württemberg, Deutschland" },
    town: { name: "Tübingen", lat: 48.5203, lon: 9.0536, label: "Tübingen, Landkreis Tübingen, Baden-Württemberg, Deutschland" },
    city: { name: "Stuttgart", lat: 48.7784, lon: 9.18, label: "Stuttgart, Baden-Württemberg, Deutschland" },
    capital: { name: "München", lat: 48.1371, lon: 11.5754, label: "München, Bayern, Deutschland" },
    uni: { name: "Freiburg im Breisgau", lat: 47.9961, lon: 7.8494, label: "Freiburg im Breisgau, Baden-Württemberg, Deutschland" },
    emigrant: { name: "Chicago", lat: 41.8756, lon: -87.6244, label: "Chicago, Cook County, Illinois, United States" },
    abroad: { name: "New York", lat: 40.7127, lon: -74.006, label: "New York, United States" },
  },
  words: {
    farmer: "Landwirt", blacksmith: "Schmied", carpenter: "Zimmermann", innkeeper: "Gastwirt", tram: "Straßenbahnfahrer", shoemaker: "Schuhmacher",
    farmhand: "Knecht", factory: "Arbeiter im Schlachthof", ship: "mit dem Schiff von Bremen nach New York", engineer: "Ingenieur", teacher: "Lehrerin",
    regiment: "Infanterie-Regiment 125, Westfront", seamstress: "Näherin", machinist: "Maschinist", nurseSchool: "Krankenpflegeschule", nurse: "Krankenschwester",
    toolmaker: "Werkzeugmacher", translator: "Übersetzerin", doctor: "Ärztin", university: "Universität Freiburg", architect: "Architekt",
    it: "Softwareentwickler", designer: "Grafikerin", house12: "Haus Nr. 12", house31: "Haus Nr. 31", pneumonia: "Lungenentzündung", stroke: "Schlaganfall", gpJosef1: "Josef Vogel, Müller aus Unterdorf",
    oldAge: "Altersschwäche", dropsy: "Wassersucht", consumption: "Lungenschwindsucht", heart: "Herzschwäche", cancer: "Krebs",
    cook: "Köchin", spinner: "Spinnerin", cottager: "Häusler", baker: "Bäcker", clerk: "Büroangestellte", musician: "Musiker",
  },
  sources: {
    anna: { title: "Taufe von Anna Weber 1931", repository: "Diözesanarchiv", reference: "Oberndorf, Taufen 1890–1935, fol. 112", date: "1931-01-18", scan: "bapt1931",
      transcript: "Anna, geboren am 14. Januar, getauft am 18. Januar 1931, Oberndorf Nr. 12. Vater Johann Weber, Landwirt, Sohn des Georg Weber und der Katharina geb. Vogel. Mutter Maria geb. Schneider, Tochter des Franz Schneider und der Theresia geb. Huber. Patin Rosa Weber, ledig." },
    marr: { title: "Trauung von Johann Weber und Maria Schneider 1924", repository: "Diözesanarchiv", reference: "Oberndorf, Trauungen 1890–1930, fol. 58", date: "1924-05-12", scan: "marr1924",
      transcript: "12. Mai 1924. Bräutigam Johann Weber, Landwirt, Oberndorf Nr. 12, Sohn des Georg Weber und der Katharina geb. Vogel, 26 Jahre. Braut Maria Schneider, Oberndorf Nr. 31, Tochter des Franz Schneider und der Theresia geb. Huber, 21 Jahre." },
    josef: { title: "Taufe von Johann Weber 1898", repository: "Diözesanarchiv", reference: "Oberndorf, Taufen 1890–1935, fol. 21", date: "1898-03-06", scan: "bapt1898",
      transcript: "Joannes, natus 3. Martii 1898, Oberndorf No. 12. Pater Georgius Weber, agricola, filius Josephi Weber. Mater Catharina nata Vogel, filia Josephi Vogel ex Unterdorf." },
    josefDeath: { title: "Sterbeeintrag Johann Weber 1967", repository: "Standesamt Oberndorf", reference: "Sterberegister 1967, Nr. 23", date: "1967-11-22",
      transcript: "Oberndorf, den 22. November 1967. Johann Weber, wohnhaft in Oberndorf Nr. 12, ist am 20. November 1967 verstorben. Geboren am 3. März 1898 in Oberndorf, Sohn von Georg Weber und Katharina geb. Vogel. Ehefrau: Maria geb. Schneider." },
    josefIndex: { title: "Namensindex der Taufen, Oberndorf 1890–1935", repository: "Diözesanarchiv", reference: "Oberndorf, Taufen 1890–1935, Index W",
      transcript: "Weber, Johann, geb. 3. 3. 1898, getauft 6. 3. 1898, Nr. 12, fol. 21." },
    census: { title: "Volkszählung 1925, Oberndorf Nr. 12", repository: "Staatsarchiv Sigmaringen", date: "1925-06-16",
      transcript: "Johann Weber, Haushaltsvorstand, geb. 1897, Landwirt, Oberndorf Nr. 12." },
    emig: { title: "Passagierliste Bremen – New York 1891", repository: "Staatsarchiv Bremen", reference: "Dampfer Fulda, Nr. 214", date: "1891-04-18",
      transcript: "Weber, Ludwig, 22 J., Knecht, Oberndorf, Württemberg. Ziel: Chicago." },
  },
  notes: {
    katerina: "Nach der Erinnerung der Familie stammte sie von der Mühle in Unterdorf.",
    frantisekH: "Wanderte 1891 nach Chicago aus. Seine Briefe nach Hause sind bis 1912 erhalten.",
    vera: "Ging 1968 nach New York und heiratete dort.",
  },
  question: "Weiß jemand, aus welcher Familie Vogel Katharina stammte? Die Großmutter sagte immer: von der Mühle.",
  nameVariants: { josef: ["Joannes Weber"], vaclav: ["Georgius Weber"] },
  surnameVariants: [["Weber", "Wewer", "Weeber"]],
};

const pl: Text = {
  tree: "Rodzina Jaworskich",
  names: {
    matej: ["Maciej", "Jaworski"], jan: ["Jan", "Jaworski"], annaD: ["Anna", "Dudek"], tomas: ["Tomasz", "Krawczyk"], rozalie: ["Rozalia", "Czarnecka"],
    jakub: ["Jakub", "Mazur"], terezie: ["Teresa", "Kmieć"], josefKos: ["Józef", "Drozd"], johana: ["Joanna", "Laskowska"],
    karelN: ["Kazimierz", "Nowicki"], ludmilaN: ["Leokadia", "Szymańska"], josefS: ["Józef", "Stępniak"], marieS: ["Maria", "Kubiak"],
    vaclav: ["Wacław", "Jaworski"], frantisekH: ["Franciszek", "Jaworski"],
    hWife1: ["Marianna", "Pawłowska"], hWife2: ["Aleksandra", "Kozłowska"], hSon: ["Stanisław", "Jaworski"], hDaughter: ["Helena", "Jaworska"], katerina: ["Katarzyna", "Wilk"], frantisek: ["Franciszek", "Krawczyk"], ludmila: ["Ludwika", "Nowak"],
    antonin: ["Antoni", "Mazur"], marieK: ["Maria", "Drozd"], jiriN: ["Jerzy", "Nowicki"], eva: ["Ewa", "Stępniak"],
    josef: ["Józef", "Jaworski"], ruzena: ["Stefania", "Jaworska"], marie: ["Maria", "Krawczyk"],
    karel: ["Karol", "Jaworski"], bozena: ["Bożena", "Zarzycka"], anna: ["Zofia", "Jaworska"], petr: ["Piotr", "Mazur"], vera: ["Irena", "Jaworska"], veraH: ["Erik", "Lindqvist"],
    jiriK: ["Andrzej", "Jaworski"], hana: ["Hanna", "Jaworska"], jana: ["Małgorzata", "Mazur"], martinM: ["Marek", "Mazur"], pavel: ["Paweł", "Nowicki"],
    tomasN: ["Tomasz", "Nowicki"], lucie: ["Agnieszka", "Ostrowska"], kristyna: ["Katarzyna", "Nowicka"], martin: ["Marcin", "Dąbrowski"],
    ema: ["Zuzanna", "Nowicka"], jakubN: ["Jakub", "Nowicki"], adam: ["Adam", "Dąbrowski"],
    jakubFa: ["Ignacy", "Mazur"], jakubMo: ["Anna", "Kubica"], terezieFa: ["Wawrzyniec", "Kmieć"], terezieMo: ["Rozalia", "Wróblewska"],
    josefKosFa: ["Mateusz", "Drozd"], josefKosMo: ["Agata", "Mróz"], johanaFa: ["Szymon", "Laskowski"], johanaMo: ["Katarzyna", "Gil"],
    ludmilaFa: ["Florian", "Nowak"], ludmilaMo: ["Marianna", "Mach"],
  },
  places: {
    // an invented pair of villages south of Tarnów, on the coordinates of real villages nearby
    home: { name: "Wierzbno Dolne", lat: 49.9239, lon: 20.9431, label: "Wierzbno Dolne, powiat tarnowski, województwo małopolskie, Polska" },
    mill: { name: "Wierzbno Górne", lat: 49.9017, lon: 20.9126, label: "Wierzbno Górne, powiat tarnowski, województwo małopolskie, Polska" },
    spa: { name: "Krynica-Zdrój", lat: 49.4216, lon: 20.9597, label: "Krynica-Zdrój, powiat nowosądecki, województwo małopolskie, Polska" },
    town: { name: "Tarnów", lat: 50.0121, lon: 20.9858, label: "Tarnów, województwo małopolskie, Polska" },
    city: { name: "Kraków", lat: 50.0614, lon: 19.9366, label: "Kraków, województwo małopolskie, Polska" },
    capital: { name: "Warszawa", lat: 52.2297, lon: 21.0122, label: "Warszawa, województwo mazowieckie, Polska" },
    uni: { name: "Wrocław", lat: 51.1079, lon: 17.0385, label: "Wrocław, województwo dolnośląskie, Polska" },
    emigrant: { name: "Chicago", lat: 41.8756, lon: -87.6244, label: "Chicago, Cook County, Illinois, United States" },
    abroad: { name: "Sztokholm", lat: 59.3293, lon: 18.0686, label: "Stockholm, Sverige" },
  },
  words: {
    farmer: "rolnik", blacksmith: "kowal", carpenter: "cieśla", innkeeper: "karczmarz", tram: "motorniczy tramwaju", shoemaker: "szewc",
    farmhand: "parobek", factory: "robotnik w rzeźni", ship: "statkiem z Bremy do Nowego Jorku", engineer: "inżynier", teacher: "nauczycielka",
    regiment: "pułk piechoty nr 57, front włoski", seamstress: "szwaczka", machinist: "maszynista", nurseSchool: "szkoła pielęgniarek", nurse: "pielęgniarka",
    toolmaker: "narzędziowiec", translator: "tłumaczka", doctor: "lekarka", university: "Uniwersytet Wrocławski", architect: "architekt",
    it: "programista", designer: "graficzka", house12: "dom nr 12", house31: "dom nr 31", pneumonia: "zapalenie płuc", stroke: "apopleksja", gpJosef1: "Jan Wilk, młynarz z Wierzbna Górnego",
    oldAge: "starość", dropsy: "puchlina wodna", consumption: "gruźlica płuc", heart: "niewydolność serca", cancer: "rak",
    cook: "kucharka", spinner: "prządka", cottager: "chałupnik", baker: "piekarz", clerk: "urzędniczka", musician: "muzyk",
  },
  sources: {
    anna: { title: "Chrzest Zofii Jaworskiej 1931", repository: "Archiwum Diecezjalne", reference: "Wierzbno Dolne, Księga urodzeń 1890–1935, k. 112", date: "1931-01-18", scan: "bapt1931",
      transcript: "Zofia, ur. 14 stycznia, ochrzczona 18 stycznia 1931, Wierzbno Dolne nr 12. Ojciec Józef Jaworski, rolnik, syn Wacława Jaworskiego i Katarzyny z d. Wilk. Matka Maria z d. Krawczyk, córka Franciszka Krawczyka i Ludwiki z d. Nowak. Chrzestna Stefania Jaworska, panna." },
    marr: { title: "Ślub Józefa Jaworskiego i Marii Krawczyk 1924", repository: "Archiwum Diecezjalne", reference: "Wierzbno Dolne, Księga ślubów 1890–1930, k. 58", date: "1924-05-12", scan: "marr1924",
      transcript: "12 maja 1924. Pan młody Józef Jaworski, rolnik, Wierzbno Dolne nr 12, syn Wacława Jaworskiego i Katarzyny z d. Wilk, lat 26. Panna młoda Maria Krawczyk, Wierzbno Dolne nr 31, córka Franciszka Krawczyka i Ludwiki z d. Nowak, lat 21." },
    josef: { title: "Chrzest Józefa Jaworskiego 1898", repository: "Archiwum Diecezjalne", reference: "Wierzbno Dolne, Księga urodzeń 1890–1935, k. 21", date: "1898-03-06", scan: "bapt1898",
      transcript: "Josephus, natus 3. Martii 1898, Wierzbno Dolne No. 12. Pater Venceslaus Jaworski, agricola, filius Joannis Jaworski. Mater Catharina nata Wilk, filia Joannis Wilk ex Wierzbno Górne." },
    josefDeath: { title: "Akt zgonu Józefa Jaworskiego 1967", repository: "Urząd Stanu Cywilnego", reference: "Księga zgonów 1967, akt nr 23", date: "1967-11-22",
      transcript: "Wierzbno Dolne, 22 listopada 1967 r. Józef Jaworski, rolnik, zamieszkały w Wierzbnie Dolnym nr 12, zmarł 20 listopada 1967 r. Urodzony 3 marca 1898 r. w Wierzbnie Dolnym, syn Wacława Jaworskiego. Żona Maria z domu Krawczyk." },
    josefIndex: { title: "Indeks urodzeń, Wierzbno Dolne 1890–1935", repository: "Archiwum Diecezjalne", reference: "Wierzbno Dolne, Księga urodzeń 1890–1935, indeks J",
      transcript: "Jaworski Józef, ur. 3 III 1898, ochrzczony 6 III 1898, nr 12, k. 21." },
    census: { title: "Spis ludności 1921, Wierzbno Dolne nr 12", repository: "Archiwum Państwowe w Tarnowie", date: "1921-09-30",
      transcript: "Józef Jaworski, głowa gospodarstwa, ur. 1897, rolnik, Wierzbno Dolne nr 12." },
    emig: { title: "Lista pasażerów, Brema – Nowy Jork 1891", repository: "Staatsarchiv Bremen", reference: "statek Fulda, nr 214", date: "1891-04-18",
      transcript: "Jaworski, Franciszek, 22 lata, parobek, Wierzbno Dolne, Galicja, Austria. Cel: Chicago." },
  },
  notes: {
    katerina: "Według pamięci rodzinnej pochodziła z młyna w Wierzbnie Górnym.",
    frantisekH: "Wyemigrował w 1891 roku do Chicago. Listy do domu zachowały się do 1912 roku.",
    vera: "W 1968 roku wyjechała do Sztokholmu, gdzie wyszła za mąż.",
  },
  question: "Czy ktoś wie, z której rodziny Wilków pochodziła Katarzyna? Babcia zawsze mówiła, że z młyna.",
  nameVariants: { josef: ["Josephus Jaworski"], vaclav: ["Venceslaus Jaworski"] },
  surnameVariants: [["Jaworski", "Jaworsky", "Jaworskij"]],
};

export const TEXT: Record<"cs" | "en" | "de" | "pl", Text> = { cs, en, de, pl };
