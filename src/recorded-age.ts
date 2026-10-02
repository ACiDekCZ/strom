/**
 * The age a register gives at an event ("54 let", "3 Monate", "kojenec") — kept
 * as the user or the file wrote it, read here only to compare it with the age
 * the dates give and to write it back as a GEDCOM AGE ("54y", "INFANT").
 *
 * The age a priest wrote is often a year or more off the one the birth date
 * gives. The difference is a lead (another person, a mistake in the entry),
 * never an error, so nothing here rejects a value: what cannot be read is
 * simply not compared and goes out as written.
 */

import { foldDateWord } from './date-words';
import { strings, getCurrentLanguage, plural, Language } from './strings';
import { ageRangeBetween } from './dates';
import { Person } from './types';

export type AgeWord = 'INFANT' | 'STILLBORN' | 'CHILD';

/** A recorded age that could be read: a span, or one of GEDCOM's age words. */
export type RecordedAge =
    | { kind: 'span'; qualifier: '' | '<' | '>'; years: number; months: number; weeks: number; days: number }
    | { kind: 'word'; word: AgeWord };

/** Unit words (folded, see foldDateWord): exact forms, and stems a form may start with. */
const UNITS: { unit: 'y' | 'm' | 'w' | 'd'; exact: string[]; stems: string[] }[] = [
    { unit: 'y', exact: ['y', 'yr', 'yrs', 'r', 'j', 'let', 'lat', 'g', 'г', 'лет', 'рік', 'л'],
        stems: ['year', 'rok', 'jahr', 'lata', 'год', 'рок'] },
    { unit: 'm', exact: ['m', 'mo', 'mos', 'mon'],
        stems: ['month', 'mesic', 'mesiac', 'miesiac', 'miesiec', 'monat', 'мес', 'міс'] },
    { unit: 'w', exact: ['w', 'wk', 'wks', 'tyd', 'tyz'],
        stems: ['week', 'tyden', 'tydn', 'tyzden', 'tyzdn', 'tydzien', 'tygod', 'woche', 'недел', 'тижд', 'тижн'] },
    { unit: 'd', exact: ['d', 'dn', 'dni', 'dnu', 'дн', 'дні', 'дня'],
        stems: ['day', 'den', 'dzien', 'tag', 'ден', 'дней', 'днів'] },
];

const unitOf = (word: string): 'y' | 'm' | 'w' | 'd' | null => {
    for (const u of UNITS) {
        if (u.exact.includes(word) || u.stems.some(s => word.startsWith(s))) return u.unit;
    }
    return null;
};

/** GEDCOM's age words in the languages of the registers (folded). */
const AGE_WORDS: Record<AgeWord, string[]> = {
    INFANT: ['infant', 'kojenec', 'kojenka', 'nemluvne', 'dojca', 'niemowle', 'saugling', 'младенец', 'немовля'],
    STILLBORN: ['stillborn', 'mrtve narozene', 'mrtve narozeny', 'mrtve narozena', 'mrtvorozene', 'mrtvo narodene',
        'martwo urodzone', 'totgeboren', 'totgeburt', 'мертворожденный', 'мертворождённый', 'мертвонароджений'],
    CHILD: ['child', 'dite', 'dieta', 'dziecko', 'kind', 'ребенок', 'дитина'],
};

/** Words joining the parts of an age: "54 let a 3 měsíce", "1 Jahr und 2 Monate". */
const JOINERS = new Set(['a', 'and', 'und', 'i', 'и', 'і', 'та']);

/** Read a recorded age, or null when it is not one this can read. */
export function readRecordedAge(text?: string): RecordedAge | null {
    const raw = (text ?? '').trim();
    if (!raw) return null;
    const folded = raw.split(/\s+/).map(foldDateWord).join(' ');
    for (const [word, forms] of Object.entries(AGE_WORDS) as [AgeWord, string[]][]) {
        if (forms.includes(folded) || forms.includes(folded.toLowerCase())) return { kind: 'word', word };
    }

    let rest = folded;
    let qualifier: '' | '<' | '>' = '';
    if (rest.startsWith('<') || rest.startsWith('>')) {
        qualifier = rest[0] as '<' | '>';
        rest = rest.slice(1).trim();
    }
    // Numbers glued to their unit ("54y", "3m") or apart ("54 let"); commas
    // and joiners between the parts.
    const tokens = rest.replace(/(\d)(\p{L})/gu, '$1 $2').split(/[\s,]+/).filter(Boolean);
    const out = { years: 0, months: 0, weeks: 0, days: 0 };
    let any = false;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (JOINERS.has(t)) continue;
        if (!/^\d{1,3}$/.test(t)) return null;
        const n = Number(t);
        const next = tokens[i + 1];
        const unit = next !== undefined && !/^\d/.test(next) && !JOINERS.has(next) ? unitOf(next) : null;
        if (next !== undefined && !/^\d/.test(next) && !JOINERS.has(next) && !unit) return null;
        // A bare number is years ("54"), as GEDCOM reads it too.
        const key = ({ y: 'years', m: 'months', w: 'weeks', d: 'days' } as const)[unit ?? 'y'];
        out[key] += n;
        any = true;
        if (unit) i++;
    }
    if (!any) return null;
    return { kind: 'span', qualifier, ...out };
}

/**
 * The value to write as GEDCOM `AGE`: "54y", "27y 3m", "<1y", "INFANT"; a
 * value that cannot be read goes out as written. GEDCOM 5.5.1 has no weeks, so
 * weeks are written as days.
 */
export function gedcomAge(text: string): string {
    const age = readRecordedAge(text);
    if (!age) return text.trim();
    if (age.kind === 'word') return age.word;
    const days = age.days + age.weeks * 7;
    const parts = [
        age.years ? `${age.years}y` : '',
        age.months ? `${age.months}m` : '',
        days ? `${days}d` : '',
    ].filter(Boolean);
    return `${age.qualifier}${parts.join(' ') || '0y'}`;
}

/**
 * A GEDCOM AGE in words of the UI language ("54y" → "54 let"), for the field
 * on import. A value GEDCOM does not define is kept as written.
 */
export function localAge(gedcom: string): string {
    const v = gedcom.trim();
    const g = strings.gedcomNotes;
    const word = g.ageWords[v.toUpperCase()];
    if (word) return word;
    const m = /^([<>])?\s*(?:(\d+)\s*y)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*w)?\s*(?:(\d+)\s*d)?$/i.exec(v);
    const bare = /^([<>])?\s*(\d+)$/.exec(v);
    if (bare) return `${bare[1] ?? ''}${g.ageUnit(Number(bare[2]), 'y')}`;
    if (!m || (!m[2] && !m[3] && !m[4] && !m[5])) return v;
    const parts: string[] = [];
    if (m[2]) parts.push(g.ageUnit(Number(m[2]), 'y'));
    if (m[3]) parts.push(g.ageUnit(Number(m[3]), 'm'));
    if (m[4]) parts.push(g.ageUnit(Number(m[4]), 'w'));
    if (m[5]) parts.push(g.ageUnit(Number(m[5]), 'd'));
    return `${m[1] ?? ''}${parts.join(' ')}`;
}

/** How the recorded age stands against the dates: the computed range and the gap, if any. */
export interface AgeCheck {
    /** "56–57 let", "19 let". */
    range: string;
    /** Whole years outside the range ("2 roky"), or '' when the record agrees or cannot be compared. */
    differs: string;
}

/**
 * The age the dates give at an event, and how far the recorded one lies from
 * it. Null without a birth date (or with only an estimate on either side).
 * The gap is the distance to the nearest end of the range.
 */
export function checkRecordedAge(recorded: string | undefined, birth?: string, event?: string): AgeCheck | null {
    const span = ageRangeBetween(birth, event);
    if (!span) return null;
    const lang = getCurrentLanguage();
    const unit = strings.gedcomNotes.ageUnit(span.max, 'y').replace(/^\d+\s*/, '');
    const range = span.min === span.max
        ? strings.gedcomNotes.ageUnit(span.min, 'y')
        : `${span.min}–${span.max} ${unit}`;
    const age = readRecordedAge(recorded);
    let differs = '';
    if (age?.kind === 'span' && !age.qualifier) {
        const years = age.years;
        const gap = years < span.min ? span.min - years : years > span.max ? years - span.max : 0;
        // Months, weeks or days alone are under a year: they agree with an age of 0.
        if (gap > 0 && !(years === 0 && span.min === 0)) {
            differs = `${gap} ${plural(lang, gap, ...yearWords(lang))}`;
        }
    }
    return { range, differs };
}

function yearWords(lang: Language): [string, string, string] {
    if (lang === 'cs') return ['rok', 'roky', 'let'];
    if (lang === 'de') return ['Jahr', 'Jahre', 'Jahre'];
    return ['year', 'years', 'years'];
}

/**
 * The date an age is counted from: the birth, or — when only the baptism was
 * recorded, as registers often have it — the baptism. `birthOverride` is the
 * birth as typed in a form: a date wins, '' or null means "no birth".
 */
export function ageBirthDate(person: Person | null | undefined, birthOverride?: string | null): string | undefined {
    if (birthOverride) return birthOverride;
    if (birthOverride === undefined && person?.birthDate) return person.birthDate;
    return person?.events?.find(e => e.type === 'baptism' && e.date)?.date;
}
