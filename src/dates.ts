/**
 * Flexible (partial) genealogy dates.
 *
 * Canonical storage format: `[qualifier]YYYY[-MM[-DD]]`
 *   - qualifier: '' (exact), '~' (about), '<' (before), '>' (after)
 *   - precision by omission: '1880' (year), '1880-05' (month), '1880-05-15' (day)
 * Legacy full ISO dates ('YYYY-MM-DD') are valid canonical values, so existing
 * data needs no migration.
 *
 * User input accepts Czech and English forms: '15.5.1880', '5/1880', '1880',
 * 'kolem 1880', 'před 1880', 'po 1880', 'about 1880', 'bef 1880', '~1880'...
 */

import { getCurrentLanguage } from './strings.js';

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
}

const CANONICAL_RE = /^([~<>]?)(\d{3,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/;

const QUALIFIER_WORDS: Record<string, DateQualifier> = {
    '~': '~', 'kolem': '~', 'okolo': '~', 'cca': '~', 'circa': '~', 'about': '~', 'abt': '~', 'ca': '~',
    '<': '<', 'před': '<', 'pred': '<', 'do': '<', 'before': '<', 'bef': '<',
    '>': '>', 'po': '>', 'od': '>', 'after': '>', 'aft': '>',
};

function daysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
}

/**
 * Parse a canonical stored value into components. Returns null when the value
 * is missing or not a valid canonical flex date.
 */
export function parseFlexDate(value?: string): FlexDate | null {
    if (!value) return null;
    const trimmed = value.trim();

    // Range 'A..B' — both sides plain canonical dates (no qualifiers).
    const dots = trimmed.indexOf('..');
    if (dots > 0) {
        const start = parseFlexDate(trimmed.slice(0, dots));
        const end = parseFlexDate(trimmed.slice(dots + 2));
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
 * Normalize free-form user input (Czech or English) into the canonical
 * storage format. Returns '' for empty input, null for unparseable input.
 */
export function normalizeDateInput(input: string): string | null {
    let s = input.trim();
    if (!s) return '';

    // Range: 'A..B', 'mezi A a B', 'between A and B' — sides normalize
    // through the single-date path (no qualifiers inside a range).
    const rangeMatch = /^(?:mezi|between)\s+(.+?)\s+(?:a|and)\s+(.+)$/i.exec(s);
    const sides = rangeMatch ? [rangeMatch[1], rangeMatch[2]]
        : s.includes('..') ? s.split('..', 2) : null;
    if (sides) {
        const a = normalizeDateInput(sides[0]);
        const b = normalizeDateInput(sides[1]);
        if (!a || !b || /^[~<>]/.test(a) || /^[~<>]/.test(b) || a.includes('..') || b.includes('..')) return null;
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
    } else if ((m = /^(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{3,4})$/.exec(s))) {
        // '15.5.1880', '15/5/1880' (day first — Czech convention)
        day = parseInt(m[1], 10);
        month = parseInt(m[2], 10);
        year = parseInt(m[3], 10);
    } else if ((m = /^(\d{3,4})-(\d{1,2})-(\d{1,2})$/.exec(s))) {
        // ISO '1880-05-15'
        year = parseInt(m[1], 10);
        month = parseInt(m[2], 10);
        day = parseInt(m[3], 10);
    } else {
        return null;
    }

    if (year === undefined || year < 100 || year > 2200) return null;
    const candidate: FlexDate = { qualifier, year, month, day };
    const canonical = toCanonical(candidate);
    return parseFlexDate(canonical) ? canonical : null;
}

/** True when the input is empty or normalizes to a valid canonical date. */
export function isValidDateInput(input: string): boolean {
    return normalizeDateInput(input) !== null;
}

/**
 * Year for display, keeping the qualifier symbol ('~1880', '<1905').
 * Returns '' when the value is missing/invalid.
 */
export function displayYear(value?: string): string {
    const d = parseFlexDate(value);
    if (!d) return value ? value.split('-')[0] : '';
    return `${d.qualifier}${d.year}`;
}

/** Numeric year (qualifier stripped), or null. */
export function yearOf(value?: string): number | null {
    const d = parseFlexDate(value);
    return d ? d.year : null;
}

/** Sort key: canonical value without the qualifier (keeps determinism). */
export function dateSortKey(value?: string): string {
    if (!value) return '';
    return /^[~<>]/.test(value) ? value.slice(1) : value;
}

const QUALIFIER_TEXT: Record<'cs' | 'en' | 'de', Record<Exclude<DateQualifier, ''>, string>> = {
    cs: { '~': 'kolem', '<': 'před', '>': 'po' },
    en: { '~': 'about', '<': 'before', '>': 'after' },
    de: { '~': 'um', '<': 'vor', '>': 'nach' },
};

/**
 * Human-readable form for tooltips/details:
 *   cs: '15. 5. 1880', '5/1880', 'kolem 1880'
 *   en: '5/15/1880', '5/1880', 'about 1880'
 *   de: '15.5.1880', '5/1880', 'um 1880'
 */
export function formatFlexDate(value?: string, lang?: 'cs' | 'en' | 'de'): string {
    const d = parseFlexDate(value);
    if (!d) return value ?? '';
    const cur = getCurrentLanguage();
    const locale = lang ?? (cur === 'cs' ? 'cs' : cur === 'de' ? 'de' : 'en');

    let core: string;
    if (d.day !== undefined && d.month !== undefined) {
        core = locale === 'cs'
            ? `${d.day}. ${d.month}. ${d.year}`
            : locale === 'de'
                ? `${d.day}.${d.month}.${d.year}`
                : `${d.month}/${d.day}/${d.year}`;
    } else if (d.month !== undefined) {
        core = `${d.month}/${d.year}`;
    } else {
        core = `${d.year}`;
    }

    if (d.end) {
        const endCore = formatFlexDate(toCanonical({ qualifier: '', ...d.end }), locale);
        return locale === 'cs'
            ? `mezi ${core} a ${endCore}`
            : locale === 'de'
                ? `zwischen ${core} und ${endCore}`
                : `between ${core} and ${endCore}`;
    }

    return d.qualifier ? `${QUALIFIER_TEXT[locale][d.qualifier]} ${core}` : core;
}

/**
 * Locale-aware form for EDIT INPUTS. Czech users see the Czech convention
 * ('15.5.1880', '5.1880', '~1880') — every emitted form parses back through
 * normalizeDateInput. English keeps the canonical ISO form: 'M/D/YYYY' would
 * be ambiguous with the day-first parsing the inputs accept.
 */
export function formatDateForInput(value?: string): string {
    if (!value) return '';
    const d = parseFlexDate(value);
    if (!d) return value;
    if (d.end) return value;  // ranges stay canonical ('1880..1885')
    // Czech and German both write dates day-first with dots ('15.5.1880'), and
    // every emitted form parses back through normalizeDateInput. English keeps
    // the canonical ISO form: 'M/D/YYYY' would clash with day-first parsing.
    const inputLang = getCurrentLanguage();
    if (inputLang !== 'cs' && inputLang !== 'de') return value;
    const q = d.qualifier;
    if (d.day !== undefined && d.month !== undefined) return `${q}${d.day}.${d.month}.${d.year}`;
    if (d.month !== undefined) return `${q}${d.month}.${d.year}`;
    return `${q}${d.year}`;
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
