/**
 * Flexible (partial) genealogy dates.
 *
 * Canonical storage format: `[qualifier]YYYY[-MM[-DD]]`
 *   - qualifier: '' (exact), '~' (about), '<' (before), '>' (after)
 *   - precision by omission: '1880' (year), '1880-05' (month), '1880-05-15' (day)
 *   - range 'A..B': the date lies somewhere between A and B (GEDCOM BET … AND …)
 *   - period 'A/B', 'A/', '/B': something lasted from A to B, from A, to B
 *     (GEDCOM FROM … TO …, FROM …, TO …)
 * Legacy full ISO dates ('YYYY-MM-DD') are valid canonical values, so existing
 * data needs no migration.
 *
 * User input accepts Czech, English and German forms: '15.5.1880', '5/1880',
 * '1880', '15 May 1880', 'May 15, 1880', 'kolem 1880', 'před 1880', 'po 1880',
 * 'about 1880', 'bef 1880', 'um 1880', 'vor 1880', 'nach 1880', '~1880'...
 */

import { getCurrentLanguage } from './strings.js';
import { isAboutWord, isBetweenWord, readDateWords } from './date-words.js';

export type DateQualifier = '' | '~' | '<' | '>';

export interface FlexDate {
    qualifier: DateQualifier;
    year: number;
    month?: number;
    day?: number;
    /**
     * Date RANGE ('1880..1885', GEDCOM BET/AND, FROM/TO): year/month/day above
     * hold the range START; `end` holds the other bound. Ranges never carry a
     * qualifier. Consumers that ignore `end` conservatively see the start.
     */
    end?: { year: number; month?: number; day?: number };
    /**
     * A PERIOD (GEDCOM FROM/TO, canonical 'A/B', 'A/', '/B'): how long
     * something lasted, not when a single moment happened. With `end` it is
     * FROM start TO end; without, the qualifier tells the side: '>' is FROM
     * start (open end), '<' is TO start. Consumers that ignore it see the
     * period as a range or as after/before, as the dates were read before.
     */
    period?: true;
}

/** A canonical date with no qualifier, range or period (one side of 'A/B'). */
const PLAIN_RE = /^\d{3,4}(?:-\d{1,2}(?:-\d{1,2})?)?$/;

const CANONICAL_RE = /^([~<>]?)(\d{3,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/;

const QUALIFIER_WORDS: Record<string, DateQualifier> = {
    '~': '~', 'kolem': '~', 'okolo': '~', 'cca': '~', 'circa': '~', 'about': '~', 'abt': '~', 'ca': '~',
    '<': '<', 'před': '<', 'pred': '<', 'do': '<', 'before': '<', 'bef': '<',
    '>': '>', 'po': '>', 'od': '>', 'after': '>', 'aft': '>',
    // German (the DE placeholder offers 'um 1880')
    'um': '~', 'etwa': '~', 'zirka': '~', 'vor': '<', 'nach': '>',
    // Polish ('ok. 1880', 'około 1880', 'przed 1880', 'po 1880')
    'ok': '~', 'około': '~', 'przed': '<',
};

/** English month names and abbreviations (GEDCOM uses JAN…DEC too). */
const MONTH_NAMES: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
    sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
    dec: 12, december: 12,
};

function daysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
}

/**
 * Parse a stored value into components. Returns null when the value is
 * missing or not a date. A canonical value is read as it is; any other text
 * (a date a person wrote into the data: 'Cca 5/1850', 'Mezi 1850-1852') is
 * read the way the date field reads it (normalizeDateInput, in the UI
 * language), and the text itself is never changed.
 */
export function parseFlexDate(value?: string): FlexDate | null {
    if (!value) return null;
    return parseCanonical(value) ?? readStoredText(value);
}

/** Text readings of stored values, by UI language and value. */
const storedTextReadings = new Map<string, FlexDate | null>();

/** A stored value that is not canonical, read as typed text (see parseFlexDate). */
function readStoredText(value: string): FlexDate | null {
    // Every date has a year: text without three figures in a row is no date.
    if (!/\d{3}/.test(value)) return null;
    const lang = getCurrentLanguage();
    const key = `${lang}\u0000${value}`;
    let read = storedTextReadings.get(key);
    if (read === undefined) {
        const canonical = normalizeDateInput(value, lang);
        read = canonical ? parseCanonical(canonical) : null;
        if (storedTextReadings.size > 5000) storedTextReadings.clear();
        storedTextReadings.set(key, read);
    }
    return read ? { ...read, ...(read.end ? { end: { ...read.end } } : {}) } : null;
}

/**
 * The canonical form of a stored value: the value itself when it is
 * canonical, its reading when it is a date written as text ('Cca 5/1850' →
 * '~1850-05'), else the value unchanged.
 */
export function canonicalDate(value: string): string {
    if (!value || parseCanonical(value)) return value;
    const read = readStoredText(value);
    return read ? toCanonical(read) : value;
}

/** Parse a canonical value only (no reading of text). */
function parseCanonical(value?: string): FlexDate | null {
    if (!value) return null;
    const trimmed = value.trim();

    // Period 'A/B', 'A/', '/B' — each side a plain canonical date.
    const slash = /^([^/]*)\/([^/]*)$/.exec(trimmed);
    if (slash) {
        const [, a, b] = slash;
        if ((a && !PLAIN_RE.test(a)) || (b && !PLAIN_RE.test(b)) || (!a && !b)) return null;
        const start = parseCanonical(a || b);
        if (!start) return null;
        if (!a) return { ...start, qualifier: '<', period: true };
        if (!b) return { ...start, qualifier: '>', period: true };
        const end = parseCanonical(b);
        if (!end) return null;
        return { ...start, end: { year: end.year, month: end.month, day: end.day }, period: true };
    }

    // Range 'A..B' — both sides plain canonical dates (no qualifiers).
    const dots = trimmed.indexOf('..');
    if (dots > 0) {
        const start = parseCanonical(trimmed.slice(0, dots));
        const end = parseCanonical(trimmed.slice(dots + 2));
        if (!start || !end || start.qualifier || end.qualifier || start.end || end.end) return null;
        return { ...start, end: { year: end.year, month: end.month, day: end.day } };
    }

    const m = CANONICAL_RE.exec(trimmed);
    if (!m) return null;

    const qualifier = (m[1] ?? '') as DateQualifier;
    const year = parseInt(m[2], 10);
    const month = m[3] !== undefined ? parseInt(m[3], 10) : undefined;
    const day = m[4] !== undefined ? parseInt(m[4], 10) : undefined;

    if (month !== undefined && (month < 1 || month > 12)) return null;
    if (day !== undefined && (month === undefined || day < 1 || day > daysInMonth(year, month))) return null;

    return { qualifier, year, month, day };
}

/** Build the canonical storage string from components. */
export function toCanonical(date: FlexDate): string {
    if (date.period) {
        const start = toCanonical({ qualifier: '', year: date.year, month: date.month, day: date.day });
        if (date.end) return `${start}/${toCanonical({ qualifier: '', ...date.end })}`;
        return date.qualifier === '<' ? `/${start}` : `${start}/`;
    }
    let s = `${date.qualifier}${date.year}`;
    if (date.month !== undefined) {
        s += `-${String(date.month).padStart(2, '0')}`;
        if (date.day !== undefined) {
            s += `-${String(date.day).padStart(2, '0')}`;
        }
    }
    if (date.end) {
        s += `..${toCanonical({ qualifier: '', ...date.end })}`;
    }
    return s;
}

/**
 * Normalize free-form user input (Czech, English or German) into the
 * canonical storage format. Returns '' for empty input, null for unparseable
 * input.
 *
 * All-numeric day/month order follows the UI language, the same way
 * formatFlexDate displays it: dotted input ('15.5.1880') is always day-first;
 * slash input is month-first in English ('5/15/1880', the US habit; the
 * display names the month, '15 May 1880') and day-first in Czech and German. An English slash date whose
 * first number cannot be a month ('15/5/1880') is read day-first, since that
 * is the only valid reading. `lang` defaults to the current UI language.
 * Beyond these, the forms of readWrittenForms ('asi 1850', 'mezi 1850-1852').
 * The GEDCOM import comes here only for a date not written in GEDCOM words
 * (readWrittenDate); a date already in the data that is not canonical is
 * read here too (parseFlexDate).
 */
export function normalizeDateInput(input: string, lang?: 'cs' | 'en' | 'de' | 'pl'): string | null {
    const s = input.trim();
    if (!s) return '';
    return normalizeDateForm(s, lang) ?? readWrittenForms(s, lang);
}

/** The date forms of normalizeDateInput the field has always read. */
function normalizeDateForm(input: string, lang?: 'cs' | 'en' | 'de' | 'pl'): string | null {
    let s = input;
    const cur = lang ?? getCurrentLanguage();
    const monthFirstSlash = cur !== 'cs' && cur !== 'de' && cur !== 'pl';

    // Period: 'A/B', 'A/', '/B' as stored (the edit field shows it so), and
    // 'od A do B', 'from A to B', 'von A bis B'. 'od A' alone stays "after".
    const stored = parseCanonical(s);
    if (stored?.period) return toCanonical(stored);
    const periodMatch = /^(?:od|from|von|ab)\s+(.+?)\s+(?:do|to|bis)\s+(.+)$/i.exec(s);
    if (periodMatch) {
        const a = normalizeDateInput(periodMatch[1], lang);
        const b = normalizeDateInput(periodMatch[2], lang);
        if (!a || !b || !PLAIN_RE.test(a) || !PLAIN_RE.test(b)) return null;
        return `${a}/${b}`;
    }

    // Range: 'A..B', 'mezi A a B', 'between A and B' — sides normalize
    // through the single-date path (no qualifiers inside a range).
    const rangeMatch = /^(?:mezi|between|zwischen|między)\s+(.+?)\s+(?:a|and|und)\s+(.+)$/i.exec(s);
    const sides = rangeMatch ? [rangeMatch[1], rangeMatch[2]]
        : s.includes('..') ? s.split('..') : null;
    if (sides) {
        if (sides.length !== 2) return null;   // '1880..1885..1890'
        const a = normalizeDateInput(sides[0], lang);
        const b = normalizeDateInput(sides[1], lang);
        if (!a || !b || !PLAIN_RE.test(a) || !PLAIN_RE.test(b)) return null;
        return `${a}..${b}`;
    }

    // Qualifier: leading symbol or word
    let qualifier: DateQualifier = '';
    const symbol = s[0];
    if (symbol === '~' || symbol === '<' || symbol === '>') {
        qualifier = symbol as DateQualifier;
        s = s.slice(1).trim();
    } else {
        const wordMatch = /^([a-zA-Zá-žÁ-Ž]+)[.\s]+(.*)$/.exec(s);
        if (wordMatch) {
            const q = QUALIFIER_WORDS[wordMatch[1].toLowerCase()];
            if (q) {
                qualifier = q;
                s = wordMatch[2].trim();
            }
        }
    }

    let year: number | undefined;
    let month: number | undefined;
    let day: number | undefined;

    let m: RegExpExecArray | null;
    if ((m = /^(\d{3,4})$/.exec(s))) {
        // '1880'
        year = parseInt(m[1], 10);
    } else if ((m = /^(\d{1,2})\s*[./]\s*(\d{3,4})$/.exec(s))) {
        // '5/1880', '5.1880'
        month = parseInt(m[1], 10);
        year = parseInt(m[2], 10);
    } else if ((m = /^(\d{3,4})-(\d{1,2})$/.exec(s))) {
        // '1880-05'
        year = parseInt(m[1], 10);
        month = parseInt(m[2], 10);
    } else if ((m = /^(\d{1,2})\s*([./])\s*(\d{1,2})\s*([./])\s*(\d{3,4})$/.exec(s))) {
        // '15.5.1880' (always day first), '15/5/1880' (cs/de) or
        // '5/15/1880' (en, month first — see the function comment)
        const first = parseInt(m[1], 10);
        const second = parseInt(m[3], 10);
        const slashes = m[2] === '/' && m[4] === '/';
        const monthFirst = slashes && monthFirstSlash && first <= 12;
        day = monthFirst ? second : first;
        month = monthFirst ? first : second;
        year = parseInt(m[5], 10);
    } else if ((m = /^(\d{3,4})-(\d{1,2})-(\d{1,2})$/.exec(s))) {
        // ISO '1880-05-15'
        year = parseInt(m[1], 10);
        month = parseInt(m[2], 10);
        day = parseInt(m[3], 10);
    } else if ((m = /^(\d{1,2})\.?\s+([a-zA-Z]+)\.?,?\s+(\d{3,4})$/.exec(s)) && MONTH_NAMES[m[2].toLowerCase()]) {
        // '15 May 1880', '15 MAY 1880' (unambiguous in every locale)
        day = parseInt(m[1], 10);
        month = MONTH_NAMES[m[2].toLowerCase()];
        year = parseInt(m[3], 10);
    } else if ((m = /^([a-zA-Z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{3,4})$/.exec(s)) && MONTH_NAMES[m[1].toLowerCase()]) {
        // 'May 15, 1880'
        month = MONTH_NAMES[m[1].toLowerCase()];
        day = parseInt(m[2], 10);
        year = parseInt(m[3], 10);
    } else if ((m = /^([a-zA-Z]+)\.?\s+(\d{3,4})$/.exec(s)) && MONTH_NAMES[m[1].toLowerCase()]) {
        // 'May 1880'
        month = MONTH_NAMES[m[1].toLowerCase()];
        year = parseInt(m[2], 10);
    } else {
        return null;
    }

    if (year === undefined || year < 100 || year > 2200) return null;
    const candidate: FlexDate = { qualifier, year, month, day };
    const canonical = toCanonical(candidate);
    return parseCanonical(canonical) ? canonical : null;
}

/**
 * Forms people write a date in beyond the field's own (normalizeDateInput):
 *   - local words with filler: 'asi 1850', 'po roce 1932', 'kolem r. 1850'
 *     (the words of src/date-words.ts);
 *   - a range with a hyphen: '1850-1852', '5/1850-7/1851', '5-7/1850' (May
 *     to July 1850), '10-12/5/1850' (10 to 12 May), also after a between-word
 *     ('mezi 1850-1852', 'zwischen 1850 - 1852') and after an about-word
 *     ('cca 1850-1852': a range says "somewhere between" already, the closest
 *     GEDCOM has is BET … AND …).
 * The start must not lie after the end. Anything else gives null.
 */
function readWrittenForms(s: string, lang?: 'cs' | 'en' | 'de' | 'pl'): string | null {
    const plainOf = (t: string): string | null => {
        const d = normalizeDateInput(t, lang);
        return d && PLAIN_RE.test(d) ? d : null;
    };
    const local = readDateWords(s, plainOf);
    if (local) return local;
    return readHyphenRange(s, lang)?.date ?? null;
}

/** A range written with a hyphen (see readWrittenForms), and whether an about-word was left out. */
function readHyphenRange(text: string, lang?: 'cs' | 'en' | 'de' | 'pl'): { date: string; about: boolean } | null {
    let s = text;
    let about = false;
    for (let i = 0; i < 2; i++) {
        const word = /^(\p{L}+)\.?\s+(.+)$/u.exec(s);
        if (!word) break;
        if (isBetweenWord(word[1])) s = word[2];
        else if (!about && i === 0 && isAboutWord(word[1])) { about = true; s = word[2]; }
        else return null;
    }
    const m = /^([\d./]+)\s*[-–]\s*([\d./]+)$/.exec(s);
    if (!m) return null;
    const endValue = normalizeDateInput(m[2], lang);
    const end = endValue && PLAIN_RE.test(endValue) ? parseCanonical(endValue) : null;
    if (!end) return null;
    // The start may leave out what it shares with the end: '5-7/1850', '10-12/5/1850'.
    let startText = m[1];
    if (/^\d{1,2}$/.test(startText)) {
        if (end.day !== undefined) startText = `${startText}.${end.month}.${end.year}`;
        else if (end.month !== undefined) startText = `${startText}.${end.year}`;
        else return null;
    } else if (/^\d{1,2}[./]\d{1,2}[./]?$/.test(startText) && end.day !== undefined) {
        startText = `${startText.replace(/[./]$/, '')}${startText.includes('/') ? '/' : '.'}${end.year}`;
    }
    const startValue = normalizeDateInput(startText, lang);
    const start = startValue && PLAIN_RE.test(startValue) ? parseCanonical(startValue) : null;
    if (!start || !startValue || !endValue) return null;
    const first = (d: FlexDate) => d.year * 10000 + (d.month ?? 1) * 100 + (d.day ?? 1);
    if (first(start) > first(end)) return null;
    return { date: startValue === endValue ? startValue : `${startValue}..${endValue}`, about };
}

/**
 * A date written the way people write it rather than in GEDCOM words, for
 * the GEDCOM import (spec: tester T42): a numeric day, month and year
 * ('12/5/1850', 'cca 2/3/1850') or a range with a hyphen ('mezi 1850-1852',
 * 'cca 1850-1852'), read as the date field reads it in the UI language.
 * `assumed` says the reading took a choice the text does not make itself: a
 * slash date whose day and month could swap ('2/3/1850'), or an about-word
 * left out of a range — the importer then keeps the text as written beside
 * the date. Null for anything else (GEDCOM forms read on their own).
 */
export function readWrittenDate(text: string, lang?: 'cs' | 'en' | 'de' | 'pl'): { date: string; assumed: boolean } | null {
    const s = text.trim();
    const slashDates = [...s.matchAll(/(?:^|[^\d/])(\d{1,2})\/(\d{1,2})\/\d{3,4}(?![\d/])/g)];
    if (slashDates.length === 0 && !/\d\s*[-–]\s*\d/.test(s)) return null;
    const date = normalizeDateInput(s, lang);
    if (!date) return null;
    const swappable = slashDates.some(m => +m[1] <= 12 && +m[2] <= 12 && m[1] !== m[2]);
    const range = readHyphenRange(s, lang);
    return { date, assumed: swappable || (range !== null && range.date === date && range.about) };
}

/** True when the input is empty or normalizes to a valid canonical date. */
export function isValidDateInput(input: string): boolean {
    return normalizeDateInput(input) !== null;
}

/**
 * Year for display, keeping the qualifier symbol ('~1880', '<1905'). A range
 * of years says both ('1872..1875' → '1872–1875', as the cards' cardDate):
 * its start alone would read as an exact year. Returns '' when the value is
 * missing/invalid.
 */
export function displayYear(value?: string): string {
    const d = parseFlexDate(value);
    if (!d) return value ? value.split('-')[0] : '';
    if (d.end && d.end.year !== d.year) return `${d.year}–${d.end.year}`;
    return `${d.qualifier}${d.year}`;
}

/**
 * The year ranges of a card's years written short where the century is
 * shared ('1650–1655 – 1720–1725' → '1650–55 – 1720–25'), for a card row too
 * narrow for them whole. A range across centuries ('1698–1702') or running
 * backwards stays as it is.
 */
export function shortYearRanges(text: string): string {
    return text.replace(/\b(\d\d)(\d\d)–(\d\d)(\d\d)\b/g, (whole, c1: string, y1: string, c2: string, y2: string) =>
        c1 === c2 && y2 > y1 ? `${c1}${y1}–${y2}` : whole);
}

/** Numeric year (qualifier stripped), or null. */
export function yearOf(value?: string): number | null {
    const d = parseFlexDate(value);
    return d ? d.year : null;
}

/**
 * Intra-year fraction (0.05..0.95) from a flex date, so dates of one year
 * order by month and day; a date without a month or day takes its middle.
 */
export function yearFraction(date: string | undefined): number {
    const d = parseFlexDate(date);
    if (!d) return 0.5;
    const month = d.month ?? 6;
    const day = d.day ?? 15;
    return 0.05 + ((month - 1) / 12) * 0.85 + (day / 31) * (0.85 / 12);
}

/** Sort key: canonical value without the qualifier (keeps determinism). */
export function dateSortKey(value?: string): string {
    if (!value) return '';
    value = canonicalDate(value);
    return /^[~<>/]/.test(value) ? value.slice(1) : value;
}

const QUALIFIER_TEXT: Record<'cs' | 'en' | 'de' | 'pl', Record<Exclude<DateQualifier, ''>, string>> = {
    cs: { '~': 'kolem', '<': 'před', '>': 'po' },
    en: { '~': 'about', '<': 'before', '>': 'after' },
    de: { '~': 'um', '<': 'vor', '>': 'nach' },
    pl: { '~': 'ok.', '<': 'przed', '>': 'po' },
};

/** The words of a period (GEDCOM FROM … TO …): 'od 1871 do 1882'. */
const PERIOD_TEXT: Record<'cs' | 'en' | 'de' | 'pl', { from: string; to: string; since: string }> = {
    cs: { from: 'od', to: 'do', since: 'od' },
    en: { from: 'from', to: 'to', since: 'from' },
    de: { from: 'von', to: 'bis', since: 'ab' },
    pl: { from: 'od', to: 'do', since: 'od' },
};

/** English month abbreviations for display, as GEDCOM writes them ('15 MAY 1880'). */
const MONTH_ABBR_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Polish month names by the case a preposition asks for: the nominative alone
 * ('maj 1880'), the genitive after ok./od/do ('ok. maja 1880'), the
 * instrumental after przed/między ('przed majem 1880'), the locative after po
 * ('po maju 1880').
 */
type PlMonthCase = 'nom' | 'gen' | 'ins' | 'loc';
const MONTH_PL: Record<PlMonthCase, string[]> = {
    nom: ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'],
    gen: ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'],
    ins: ['styczniem', 'lutym', 'marcem', 'kwietniem', 'majem', 'czerwcem', 'lipcem', 'sierpniem', 'wrześniem', 'październikiem', 'listopadem', 'grudniem'],
    loc: ['styczniu', 'lutym', 'marcu', 'kwietniu', 'maju', 'czerwcu', 'lipcu', 'sierpniu', 'wrześniu', 'październiku', 'listopadzie', 'grudniu'],
};
/** The case of a Polish month after a qualifier word. */
const PL_QUALIFIER_CASE: Record<Exclude<DateQualifier, ''>, PlMonthCase> = { '~': 'gen', '<': 'ins', '>': 'loc' };

/** The date itself, without qualifier words ('15. 5. 1880', 'May 1880', 'maja 1880'). */
function flexDateCore(d: { year: number; month?: number; day?: number }, locale: 'cs' | 'en' | 'de' | 'pl', plCase: PlMonthCase): string {
    if (d.day !== undefined && d.month !== undefined) {
        return locale === 'cs'
            ? `${d.day}. ${d.month}. ${d.year}`
            : locale === 'de' || locale === 'pl'
                ? `${d.day}.${d.month}.${d.year}`
                : `${d.day} ${MONTH_ABBR_EN[d.month - 1]} ${d.year}`;
    }
    if (d.month !== undefined) {
        return locale === 'en' ? `${MONTH_ABBR_EN[d.month - 1]} ${d.year}`
            : locale === 'pl' ? `${MONTH_PL[plCase][d.month - 1]} ${d.year}`
            : `${d.month}/${d.year}`;
    }
    return `${d.year}`;
}

/**
 * Human-readable form for tooltips/details:
 *   cs: '15. 5. 1880', '5/1880', 'kolem 1880'
 *   en: '15 May 1880', 'May 1880', 'about 1880'
 *   de: '15.5.1880', '5/1880', 'um 1880'
 *   pl: '15.5.1880', 'maj 1880', 'ok. 1880' (no leading zeros in running
 *       text; a month is named, in the case its preposition asks for)
 * English names the month: an all-numeric '3/4/1850' reads differently in the
 * US and in Britain. Every English form parses back through normalizeDateInput.
 */
export function formatFlexDate(value?: string, lang?: 'cs' | 'en' | 'de' | 'pl'): string {
    const d = parseFlexDate(value);
    if (!d) return value ?? '';
    const cur = getCurrentLanguage();
    const locale = lang ?? (cur === 'cs' ? 'cs' : cur === 'de' ? 'de' : cur === 'pl' ? 'pl' : 'en');
    const core = (c: PlMonthCase) => flexDateCore(d, locale, c);

    if (d.period) {
        const w = PERIOD_TEXT[locale];
        // Polish od/do take the genitive.
        if (!d.end) return `${d.qualifier === '<' ? w.to : w.since} ${core('gen')}`;
        return `${w.from} ${core('gen')} ${w.to} ${flexDateCore(d.end, locale, 'gen')}`;
    }

    if (d.end) {
        const endCore = flexDateCore(d.end, locale, 'ins');
        return locale === 'cs'
            ? `mezi ${core('ins')} a ${endCore}`
            : locale === 'de'
                ? `zwischen ${core('ins')} und ${endCore}`
                : locale === 'pl'
                ? `między ${core('ins')} a ${endCore}`
                : `between ${core('ins')} and ${endCore}`;
    }

    return d.qualifier ? `${QUALIFIER_TEXT[locale][d.qualifier]} ${core(PL_QUALIFIER_CASE[d.qualifier])}` : core('nom');
}

/**
 * A date in parts for a compact display (the Table view, spec 073 §5.3): the
 * qualifier apart (the caller says it as a short word), the date itself as
 * formatFlexDate writes it, a range as "start–end". A period is said whole.
 */
export function flexDateParts(value: string | undefined, lang: 'cs' | 'en' | 'de' | 'pl'): { qualifier: DateQualifier; main: string } | null {
    const d = parseFlexDate(value);
    if (!d) return null;
    if (d.period) return { qualifier: '', main: formatFlexDate(value, lang) };
    if (d.end) return { qualifier: '', main: `${flexDateCore(d, lang, 'nom')}–${flexDateCore(d.end, lang, 'nom')}` };
    return { qualifier: d.qualifier, main: flexDateCore(d, lang, d.qualifier && lang === 'pl' ? PL_QUALIFIER_CASE[d.qualifier] : 'nom') };
}

/**
 * Locale-aware form for EDIT INPUTS. Czech and German users see the dotted
 * day-first convention ('15.5.1880', '5.1880', '~1880'); English keeps the
 * canonical ISO form ('1880-05-15'), which no reader can misread. Every
 * emitted form parses back to the same value through normalizeDateInput in
 * the same language.
 */
export function formatDateForInput(value?: string): string {
    if (!value) return '';
    // A date written as text in the data stays as written in the field.
    const d = parseCanonical(value);
    if (!d) return value;
    if (d.end || d.period) return value;  // ranges and periods stay canonical ('1880..1885', '1880/1885')
    // Czech, German and Polish write dates day-first with dots ('15.5.1880').
    // English keeps ISO: unambiguous for readers of either convention.
    const inputLang = getCurrentLanguage();
    if (inputLang !== 'cs' && inputLang !== 'de' && inputLang !== 'pl') return value;
    const q = d.qualifier;
    if (d.day !== undefined && d.month !== undefined) return `${q}${d.day}.${d.month}.${d.year}`;
    if (d.month !== undefined) return `${q}${d.month}.${d.year}`;
    return `${q}${d.year}`;
}

type Ymd = [number, number, number];
type YmdParts = { year: number; month?: number; day?: number };
/** The first day a date of this precision can mean ('1880' → 1 Jan 1880). */
const firstDay = (d: YmdParts): Ymd => [d.year, d.month ?? 1, d.day ?? 1];
/** The last day a date of this precision can mean ('1880' → 31 Dec 1880). */
const lastDay = (d: YmdParts): Ymd =>
    [d.year, d.month ?? 12, d.day ?? (d.month === undefined ? 31 : daysInMonth(d.year, d.month))];
/** Whole years from one day to another. */
const yearsFromTo = (from: Ymd, to: Ymd): number => {
    let n = to[0] - from[0];
    if (to[1] < from[1] || (to[1] === from[1] && to[2] < from[2])) n--;
    return n;
};

/**
 * The ages a person can have been at an event, in whole years, from the
 * precision of both dates: born "1862" and dead "12. 3. 1919" is 56 (born late
 * in 1862) to 57 (born early). Null when a date is missing or only an estimate
 * (~, <, >) — an estimate says too little to compare a recorded age with.
 * A range date ('1850..1855') counts with its whole span.
 */
export function ageRangeBetween(birth?: string, end?: string): { min: number; max: number } | null {
    const b = parseFlexDate(birth);
    const e = parseFlexDate(end);
    if (!b || !e || b.qualifier || e.qualifier) return null;
    const min = yearsFromTo(lastDay(b.end ?? b), firstDay(e));
    const max = yearsFromTo(firstDay(b), lastDay(e.end ?? e));
    if (max < 0) return null;
    return { min: Math.max(0, min), max };
}

/**
 * An estimated age (spec 073 §5.1, "≈ 67"): the difference of the years when
 * either date is only an estimate (~, <, >) — nothing finer can be said.
 * Null when a date is missing or the end lies wholly before the start.
 */
export function approxAgeBetween(birth?: string, end?: string): number | null {
    const b = parseFlexDate(birth);
    const e = parseFlexDate(end);
    if (!b || !e) return null;
    const endYear = e.end?.year ?? e.year;
    if (endYear < b.year) return null;
    return Math.max(0, e.year - b.year);
}

/**
 * Age in years between two flex dates (end omitted = today).
 * `approx` is true when either side is qualified or lacks full precision.
 */
export function ageBetween(birth?: string, end?: string): { years: number; approx: boolean } | null {
    const b = parseFlexDate(birth);
    if (!b) return null;

    let e: FlexDate | null;
    if (end === undefined) {
        const now = new Date();
        e = { qualifier: '', year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
    } else {
        e = parseFlexDate(end);
        if (!e) return null;
    }

    const approx = b.qualifier !== '' || e.qualifier !== '' ||
        b.month === undefined || b.day === undefined ||
        e.month === undefined || e.day === undefined;

    // Missing precision defaults to mid-period for a fair estimate
    const bm = b.month ?? 7, bd = b.day ?? (b.month === undefined ? 2 : 15);
    const em = e.month ?? 7, ed = e.day ?? (e.month === undefined ? 2 : 15);

    let years = e.year - b.year;
    if (em < bm || (em === bm && ed < bd)) years--;

    if (years < 0) return null;
    return { years, approx };
}

/** An age said as precisely as the dates allow (see ageReached). */
export interface AgeReached {
    kind: 'exact' | 'about' | 'atLeast' | 'atMost' | 'span';
    years: number;
    /** The upper end of a `span`. */
    max?: number;
}

/**
 * The age a person reached, said as precisely as the dates allow (the card's
 * age line and the hover card). End omitted = today.
 *   - plain dates (also year- or month-only, estimated from mid-period as
 *     ageBetween does): `exact`;
 *   - an estimate ('~', about) on either side: `about` the estimated value;
 *   - "before"/"after" ('<', '>') that all push the age the same way: a bound
 *     that holds whatever the true dates are — born 1888-11-11, died after
 *     1950 is `atLeast` 61; bounds that push opposite ways say nothing (null);
 *   - a range ('1802..1804') against a plain date: the `span` of possible ages
 *     (`exact` when it narrows to one year).
 * An estimate mixed with a bound, or a range with any qualifier, is too vague
 * to state: null. Null as well without a birth date or for a negative age.
 */
export function ageReached(birth?: string, end?: string): AgeReached | null {
    const b = parseFlexDate(birth);
    if (!b) return null;
    let e: FlexDate | null;
    if (end === undefined) {
        const now = new Date();
        e = { qualifier: '', year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
    } else {
        e = parseFlexDate(end);
        if (!e) return null;
    }

    if (b.end || e.end) {
        if (b.qualifier || e.qualifier) return null;
        const span = ageRangeBetween(birth, end ?? toCanonical(e));
        if (!span) return null;
        return span.min === span.max ? { kind: 'exact', years: span.min } : { kind: 'span', years: span.min, max: span.max };
    }

    const estimated = b.qualifier === '~' || e.qualifier === '~';
    // Born earlier or died later than stated: the age can only be larger.
    const older = b.qualifier === '<' || e.qualifier === '>';
    // Born later or died earlier than stated: the age can only be smaller.
    const younger = b.qualifier === '>' || e.qualifier === '<';

    if (!estimated && !older && !younger) {
        const age = ageBetween(birth, end ?? toCanonical(e));
        return age ? { kind: 'exact', years: age.years } : null;
    }
    if (estimated) {
        if (older || younger) return null;
        const age = ageBetween(birth, end ?? toCanonical(e));
        return age ? { kind: 'about', years: age.years } : null;
    }
    if (older && younger) return null;
    if (older) {
        const min = yearsFromTo(lastDay(b), firstDay(e));
        return min > 0 ? { kind: 'atLeast', years: min } : null;
    }
    const max = yearsFromTo(firstDay(b), lastDay(e));
    return max > 0 ? { kind: 'atMost', years: max } : null;
}

/**
 * The local calendar day (`YYYY-MM-DD`) of an ISO instant with a time and a
 * zone (`2026-10-31T06:12:05Z`, `…+02:00`, `…+0200`), or null when the value
 * is not such an instant (a bare day, a GEDCOM date, a time without a zone).
 * The research writes its stamps in UTC: near midnight the UTC day is not the
 * day the user is in.
 */
export function instantLocalDay(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})$/i.exec(value.trim());
    if (!m) return null;
    const zone = m[2].toUpperCase() === 'Z' ? 'Z' : m[2].replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2');
    const ts = Date.parse(m[1].toUpperCase() + zone);
    if (!Number.isFinite(ts)) return null;
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${String(d.getFullYear()).padStart(4, '0')}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
