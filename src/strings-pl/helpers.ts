/**
 * Polish string helpers (kept apart from strings.ts so the Polish pack does
 * not import it at run time — strings.ts imports the pack).
 */

let rulesPl: Intl.PluralRules | null = null;

/** CLDR plural category of `n` in Polish: one = 1; few = 2–4, 22–24… (not 12–14); many = 0, 5–21…; other = fractions. */
export function pluralCategoryPl(n: number): Intl.LDMLPluralRule {
    try {
        if (!rulesPl) rulesPl = new Intl.PluralRules('pl');
        return rulesPl.select(n);
    } catch {
        if (!Number.isInteger(n)) return 'other';
        const a = Math.abs(n);
        if (a === 1) return 'one';
        const d = a % 10, h = a % 100;
        if (d >= 2 && d <= 4 && !(h >= 12 && h <= 14)) return 'few';
        return 'many';
    }
}

/** Polish word form for a count: one (1), few (2–4, 22–24…), many (0, 5–21, 25…, and fractions). */
export function plPl(n: number, one: string, few: string, many: string): string {
    const cat = pluralCategoryPl(n);
    return cat === 'one' ? one : cat === 'few' ? few : many;
}

/** Polish count form shorthand: `${n} ${word}` ("1 osoba", "3 osoby", "5 osób"). */
export const nPl = (n: number, one: string, few: string, many: string): string => `${n} ${plPl(n, one, few, many)}`;

/** A count with Polish digit grouping ("1 284"). */
export const numPl = (n: number): string => n.toLocaleString('pl-PL');

/** Polish list join: "a, b i c". */
export function joinAndPl(parts: string[]): string {
    const items = parts.filter(Boolean);
    if (items.length <= 1) return items[0] ?? '';
    return `${items.slice(0, -1).join(', ')} i ${items[items.length - 1]}`;
}

/** The first letter upper case. */
export const capFirstPl = (s: string): string => { const t = String(s ?? ''); return t ? t.charAt(0).toLocaleUpperCase('pl') + t.slice(1) : t; };

/** Kinds of a map search hit (Nominatim class/type groups). */
export const HIT_KIND_PL: Record<string, string> = {
    settlement: 'miejscowość', suburb: 'część miejscowości', road: 'ulica', house: 'dom', region: 'region', other: 'miejsce',
};

/** Polish adverbs for a text's language ("po niemiecku"); other languages by Intl. */
const PL_LANG_ADVERB: Record<string, string> = {
    pl: 'po polsku', cs: 'po czesku', de: 'po niemiecku', en: 'po angielsku', sk: 'po słowacku', la: 'po łacinie',
    fr: 'po francusku', it: 'po włosku', hu: 'po węgiersku', ru: 'po rosyjsku', uk: 'po ukraińsku', es: 'po hiszpańsku',
    nl: 'po niderlandzku', sl: 'po słoweńsku', hr: 'po chorwacku', sr: 'po serbsku', ro: 'po rumuńsku', yi: 'w jidysz',
    he: 'po hebrajsku', sv: 'po szwedzku', da: 'po duńsku', pt: 'po portugalsku', lt: 'po litewsku', be: 'po białorusku',
};

/** A language's name for "text in …" (the adverb "po niemiecku"). Unknown codes by Intl, else as they are. */
export function langNamePl(code: string): string {
    const base = String(code).toLowerCase().split('-')[0];
    if (PL_LANG_ADVERB[base]) return PL_LANG_ADVERB[base];
    try {
        const name = new Intl.DisplayNames(['pl'], { type: 'language' }).of(base);
        if (name && name !== base) return `w języku: ${name}`;
    } catch { /* an invalid code: as it is */ }
    return code;
}

type RelationSibling = { gender?: string; half: boolean };

/**
 * Tree overview, "Ask the family": a relative named by the path from the
 * chosen person ('F' = father, 'M' = mother, nearest first), in Polish
 * genitive chains: "matka ojca ojca", "brat ojca", "przyrodnia siostra matki ojca".
 */
export function relationPl(path: readonly string[], sibling?: RelationSibling): string {
    const head = sibling
        ? (sibling.gender === 'male' ? `${sibling.half ? 'przyrodni ' : ''}brat`
            : sibling.gender === 'female' ? `${sibling.half ? 'przyrodnia ' : ''}siostra`
            : `${sibling.half ? 'przyrodnie ' : ''}rodzeństwo`)
        : (path[path.length - 1] ?? 'F') === 'F' ? 'ojciec' : 'matka';
    const chain = sibling ? [...path] : path.slice(0, -1);
    return [head, ...chain.slice().reverse().map(x => x === 'F' ? 'ojca' : 'matki')].join(' ');
}

/** Sending to the research: shared count phrases (sync / treeSettings). */
export const syncChangesPl = (n: number) => nPl(n, 'zmiana', 'zmiany', 'zmian');
export const syncConflictsPl = (c: number) => `${nPl(c, 'sprzeczność', 'sprzeczności', 'sprzeczności')} do rozstrzygnięcia`;
export const syncWaitingPl = (n: number) => nPl(n, 'zmiana czeka', 'zmiany czekają', 'zmian czeka');

/** "What will be sent": people and the other changes ("1 osoba · 6 innych zmian", only others: "5 zmian"). */
export const sendCountPl = (n: number, o: number) => o === 0 ? nPl(n, 'osoba', 'osoby', 'osób')
    : n === 0 ? nPl(o, 'zmiana', 'zmiany', 'zmian')
    : `${nPl(n, 'osoba', 'osoby', 'osób')} · ${nPl(o, 'inna zmiana', 'inne zmiany', 'innych zmian')}`;
