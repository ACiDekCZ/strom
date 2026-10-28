/**
 * Reading a GEDCOM DATE value into the app's flex date (see src/dates.ts):
 * the reader the GEDCOM import uses, kept apart so a kept date form
 * (Person / Partnership `gedcomDates`) can be checked against its date
 * without loading the whole parser.
 */

import { normalizeDateInput } from './dates.js';
import { readDateWords } from './date-words.js';

const MONTHS: Record<string, string> = {
    'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04',
    'MAY': '05', 'JUN': '06', 'JUL': '07', 'AUG': '08',
    'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
};

/**
 * Parse GEDCOM date format to a canonical flex date string (see src/dates.ts).
 * Precision and qualifiers are PRESERVED: "ABT 1900" -> "~1900",
 * "JUN 1900" -> "1900-06", "3 JUN 1900" -> "1900-06-03", "BEF 1900" -> "<1900".
 */
export function parseGedcomDate(dateStr: string): string {
    return readGedcomDate(dateStr).date;
}

/**
 * The part of a GEDCOM date the date field cannot hold, to be kept as a note
 * line — or null when the date was read whole. A date phrase ("INT 1900 (per
 * census)", "(about Easter 1900)") gives its phrase; a date that was only
 * partly understood ("3 XYZ 1900" keeps just the year) gives the value as
 * written, so what the record said is never silently narrowed.
 */
export function gedcomDatePhrase(dateStr: string): string | null {
    const read = readGedcomDate(dateStr);
    if (!read.phrase && !read.lossy) return null;
    // A bare phrase is given as its words; a phrase riding on a date, or a
    // date read only in part, as the whole value — the context matters.
    if (read.phrase && !read.date) return read.phrase;
    return dateStr.replace(/@#D[^@]*@\s*/gi, '').trim() || null;
}

const YEAR_RE = /^\d{3,4}$/;

/**
 * A date with no words around it, for readDateWords: a GEDCOM one read whole
 * ("3 MAR 1919", "1919") or a dotted day-first one ("12. 3. 1919").
 */
function bareDate(s: string): string | null {
    const read = readGedcomDate(s);
    if (read.date && !read.lossy && !read.phrase) return read.date;
    if (s.includes('/')) return null;   // 5/3/1919: day and month order unknown
    return normalizeDateInput(s.replace(/\.\s+/g, '.'), 'de') || null;
}

function readGedcomDate(dateStr: string): { date: string; lossy: boolean; phrase: string } {
    if (!dateStr || !dateStr.trim()) return { date: '', lossy: false, phrase: '' };

    // Calendar escape (@#DJULIAN@, @#DGREGORIAN@ …): the calendar itself has
    // no representation here, but the date after it is an ordinary date —
    // strip the escape and keep the date instead of parsing the whole line
    // to '' (which silently lost every pre-1752 Julian date).
    dateStr = dateStr.trim().replace(/^@#D[^@]*@\s*/i, '');

    // A date phrase in parentheses — the whole value ("(about Easter 1900)")
    // or the tail of an interpreted date ("INT 1900 (per census)"). The phrase
    // is the record's own words; the date in front of it, if any, is read.
    let phrase = '';
    const withPhrase = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(dateStr);
    if (withPhrase) {
        phrase = withPhrase[2].trim();
        dateStr = withPhrase[1].trim();
        if (!dateStr) return { date: '', lossy: !phrase, phrase };
    }

    // A range (BET X AND Y: the date lies between) -> 'x..y'; a period (FROM X
    // TO Y: something lasted from one to the other) -> 'x/y', FROM X -> 'x/',
    // TO Y -> '/y'. Kept apart, so a period goes back out as FROM/TO.
    const plain = (d: string) => !!d && !/^[~<>]/.test(d) && !d.includes('..') && !d.includes('/');
    const range = /^(BET|BETWEEN|FROM)\s+(.+?)\s+(AND|TO)\s+(.+)$/i.exec(dateStr.trim());
    if (range) {
        const a = readGedcomDate(range[2]);
        const b = readGedcomDate(range[4]);
        const lossy = a.lossy || b.lossy;
        if (plain(a.date) && plain(b.date)) {
            return { date: range[1].toUpperCase() === 'FROM' ? `${a.date}/${b.date}` : `${a.date}..${b.date}`, lossy, phrase };
        }
        return { date: a.date || b.date || '', lossy: true, phrase };
    }
    const oneSided = /^(FROM|TO)\s+(.+)$/i.exec(dateStr.trim());
    if (oneSided) {
        const d = readGedcomDate(oneSided[2]);
        if (plain(d.date)) {
            return { date: oneSided[1].toUpperCase() === 'FROM' ? `${d.date}/` : `/${d.date}`, lossy: d.lossy, phrase };
        }
        return { date: d.date, lossy: true, phrase };
    }

    // Words of a local language another program wrote instead of the GEDCOM
    // keywords ("Po 1919", "kolem r. 1850", "zwischen 1850 und 1855"). The
    // meaning is kept whole, so no "as written" note is needed.
    const local = readDateWords(dateStr, bareDate);
    if (local) return { date: local, lossy: false, phrase };

    // Qualifier prefixes map to flex-date qualifiers instead of being dropped.
    // INT (interpreted) is an approximation of what the phrase says.
    let qualifier = '';
    let cleaned = dateStr.trim().replace(
        /^(ABT|ABOUT|EST|CAL|INT|BEF|BEFORE|AFT|AFTER)\s+/i,
        (m) => {
            const q = m.trim().toUpperCase();
            if (q === 'BEF' || q === 'BEFORE') qualifier = '<';
            else if (q === 'AFT' || q === 'AFTER') qualifier = '>';
            else qualifier = '~';
            return '';
        }
    );

    // The calendar escape sits AFTER any qualifier ("ABT @#DJULIAN@ 1699"),
    // so strip it here too — the top-of-function strip only sees a leading one.
    cleaned = cleaned.replace(/^@#D[^@]*@\s*/i, '');

    // Dual year "1699/00" (old-style/new-style before the 1752 calendar shift):
    // both notations name the same moment. The flex-date model has no dual-year
    // form, so the year AS WRITTEN in the record (the first one) is kept — the
    // least lossy single value, and the one a reader finds in the source.
    const parts = cleaned.split(/\s+/).filter(Boolean).map(p => p.replace(/^(\d{3,4})\/\d{1,2}$/, '$1'));
    const monthOf = (p: string | undefined): string | undefined => p ? MONTHS[p.toUpperCase()] : undefined;
    const lastIsYear = parts.length > 0 && YEAR_RE.test(parts[parts.length - 1]);

    if (parts.length === 3 && monthOf(parts[1]) && /^\d{1,2}$/.test(parts[0])
        && +parts[0] >= 1 && +parts[0] <= 31 && lastIsYear) {
        // "3 JUN 1900" -> "1900-06-03"
        return { date: `${qualifier}${parts[2]}-${monthOf(parts[1])}-${parts[0].padStart(2, '0')}`, lossy: false, phrase };
    } else if (parts.length === 2 && monthOf(parts[0]) && lastIsYear) {
        // "JUN 1900" -> "1900-06" (month precision, no fabricated day)
        return { date: `${qualifier}${parts[1]}-${monthOf(parts[0])}`, lossy: false, phrase };
    } else if (parts.length === 1 && lastIsYear) {
        // "1900" -> "1900" (year precision, no fabricated month/day)
        return { date: `${qualifier}${parts[0]}`, lossy: false, phrase };
    } else if (lastIsYear) {
        // A day or month that is not a GEDCOM one ("3 XYZ 1900"): the year is
        // certain, the rest is not — keep the year, never invent a month.
        // A word in front of the date that is not known at all ("Nejspíš
        // 1919") may say "after" or "before": the year is only an estimate.
        const wordFirst = !qualifier && /^\p{L}/u.test(parts[0]) && !monthOf(parts[0]);
        return { date: `${wordFirst ? '~' : qualifier}${parts[parts.length - 1]}`, lossy: true, phrase };
    }
    return { date: '', lossy: parts.length > 0, phrase };
}
