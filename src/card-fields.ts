/**
 * The "Custom" card: the details a person card shows, one line per event, as
 * chosen in Settings → Person card. Genealogists print their charts for
 * relatives and want birth, baptism, death (and its cause), burial,
 * occupation, marriage or divorce on them — each with its date and place.
 *
 * One line per event: a mark, the date, the place, for a death the cause
 * ("† 1919 Horní Lhota · souchotiny"). A person without the detail gets no
 * line (never an empty "†"); the lines pack upwards and the card keeps one
 * height for everybody, because the layout spaces every card the same. Pure:
 * the on-screen card, the poster, the settings preview and the card's
 * aria-label all read the same lines.
 */

import { Person, StromData, LifeEvent, Partnership } from './types.js';
import { parseFlexDate, formatFlexDate, toCanonical, ageBetween } from './dates.js';
import { newestLifeEvent, sortLifeEvents } from './events.js';
import { strings } from './strings.js';
import { isLivingPerson } from './privacy.js';
import type { CardLineRows, CardRow } from './card-width.js';
import { CARD_REFERENCE_YEAR } from './card-width.js';

export type CardFieldKey = 'birth' | 'baptism' | 'death' | 'burial' | 'occupation' | 'marriage' | 'divorce';

export const CARD_FIELD_KEYS: readonly CardFieldKey[] =
    ['birth', 'baptism', 'death', 'burial', 'occupation', 'marriage', 'divorce'];

/** How a line names its event: a mark ("* 1862") or a word ("Birth 1862"). */
export type CardLineStyle = 'marks' | 'labels';
/** How many rows one detail may take: 1, 2, or 0 = the whole text. */
export type CardValueLines = 0 | 1 | 2;
/** One height for every card of the view, or each card as tall as its content. */
export type CardHeightMode = 'view' | 'content';
/** The widest a custom card gets (src/card-width.ts); all three start at 200 and grow with the text. */
export type CardWidthCap = 240 | 320 | 400;

export const CARD_LINE_STYLES: readonly CardLineStyle[] = ['marks', 'labels'];
export const CARD_VALUE_LINES: readonly CardValueLines[] = [1, 2, 0];
export const CARD_HEIGHT_MODES: readonly CardHeightMode[] = ['view', 'content'];
/** Narrow, medium (the card before the width choice), wide. */
export const CARD_WIDTH_CAPS: readonly CardWidthCap[] = [240, 320, 400];

export interface CardFieldSettings {
    /** All seven keys, in the order the lines appear. */
    order: CardFieldKey[];
    /** The ticked ones (any number of the seven). */
    on: CardFieldKey[];
    /** Keys whose line carries the place. */
    place: CardFieldKey[];
    /** The death line carries the cause. */
    cause: boolean;
    /** No birth recorded: the baptism stands in (registers often have only that). */
    baptismFallback: boolean;
    /** No death recorded: the burial stands in. */
    burialFallback: boolean;
    /** Full dates instead of years. */
    fullDate: boolean;
    /*
     * The card's appearance (src/card-width.ts: the width, the rows a detail
     * wraps into, the label column, the header, the view's card height or,
     * with `height` 'content', each card's own).
     */
    /** Marks or words in front of the lines. */
    style: CardLineStyle;
    /** Rows one detail may take (0 = the whole text). */
    lines: CardValueLines;
    /** One height for the view, or each card by its content. */
    height: CardHeightMode;
    /** The widest the card gets. */
    widthCap: CardWidthCap;
    /** The life years under the name. */
    years: boolean;
}

/**
 * What "Custom" starts with the first time: what the detailed card shows
 * (birth and death with their places, the occupation), years only, marks,
 * every detail whole, each card as tall as its content, medium width. This is
 * also the "Brief" preset.
 */
export const DEFAULT_CARD_FIELDS: CardFieldSettings = {
    order: [...CARD_FIELD_KEYS],
    on: ['birth', 'death', 'occupation'],
    place: ['birth', 'baptism', 'death', 'burial', 'marriage', 'divorce'],
    cause: false,
    baptismFallback: true,
    burialFallback: true,
    fullDate: false,
    style: 'marks',
    lines: 0,
    height: 'content',
    widthCap: 320,
    years: false,
};

/** Keys whose line can carry a place (an occupation has none). */
export const PLACE_KEYS: readonly CardFieldKey[] = ['birth', 'baptism', 'death', 'burial', 'marriage', 'divorce'];

/** The mark in front of each line. ⚰ gets a text-style selector so no emoji font takes it. */
export const CARD_MARKS: Record<CardFieldKey, string> = {
    birth: '*', baptism: '≈', death: '†', burial: '⚰︎', occupation: '', marriage: '⚭', divorce: '⚮',
};

/**
 * Repair whatever was stored: unknown keys out, all keys in the order, every
 * appearance option valid. Settings saved before an option existed (or with a
 * value it does not know) get its default.
 */
export function normalizeCardFields(raw: Partial<CardFieldSettings> | undefined): CardFieldSettings {
    const d = DEFAULT_CARD_FIELDS;
    const known = (list: unknown): CardFieldKey[] => Array.isArray(list)
        ? [...new Set(list.filter((k): k is CardFieldKey => CARD_FIELD_KEYS.includes(k as CardFieldKey)))]
        : [];
    const oneOf = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
        allowed.includes(value as T) ? value as T : fallback;
    const order = known(raw?.order);
    for (const k of CARD_FIELD_KEYS) if (!order.includes(k)) order.push(k);
    const on = raw?.on ? known(raw.on) : [...d.on];
    return {
        order,
        on,
        place: raw?.place ? known(raw.place) : [...d.place],
        cause: typeof raw?.cause === 'boolean' ? raw.cause : d.cause,
        baptismFallback: typeof raw?.baptismFallback === 'boolean' ? raw.baptismFallback : d.baptismFallback,
        burialFallback: typeof raw?.burialFallback === 'boolean' ? raw.burialFallback : d.burialFallback,
        fullDate: typeof raw?.fullDate === 'boolean' ? raw.fullDate : d.fullDate,
        style: oneOf(raw?.style, CARD_LINE_STYLES, d.style),
        lines: oneOf(raw?.lines, CARD_VALUE_LINES, d.lines),
        height: oneOf(raw?.height, CARD_HEIGHT_MODES, d.height),
        widthCap: oneOf(raw?.widthCap, CARD_WIDTH_CAPS, d.widthCap),
        years: typeof raw?.years === 'boolean' ? raw.years : d.years,
    };
}

// ============= Presets =============

export type CardPresetKey = 'brief' | 'register' | 'all';
export const CARD_PRESET_KEYS: readonly CardPresetKey[] = ['brief', 'register', 'all'];

/** What each preset sets; the details it leaves unticked follow in the order they had. */
const PRESETS: Record<CardPresetKey, Omit<CardFieldSettings, 'order'>> = {
    // The default card.
    brief: { ...DEFAULT_CARD_FIELDS, on: [...DEFAULT_CARD_FIELDS.on], place: [...DEFAULT_CARD_FIELDS.place] },
    // What a parish register records, each with its place, the cause of death, full dates, words.
    register: {
        ...DEFAULT_CARD_FIELDS,
        on: ['birth', 'baptism', 'marriage', 'death', 'burial'],
        place: [...PLACE_KEYS], cause: true, fullDate: true,
        style: 'labels', lines: 0, height: 'content', widthCap: 320, years: false,
    },
    // Everything a card can carry, on the wide card.
    all: {
        ...DEFAULT_CARD_FIELDS,
        on: ['birth', 'baptism', 'marriage', 'divorce', 'death', 'burial', 'occupation'],
        place: [...PLACE_KEYS], cause: true, fullDate: true,
        style: 'labels', lines: 0, height: 'content', widthCap: 400, years: false,
    },
};

/**
 * The settings a preset makes: its details ticked in its order, the rest after
 * them in the order they had in `from`, the baptism and burial standing in as
 * by default.
 */
export function cardPreset(key: CardPresetKey, from: CardFieldSettings = DEFAULT_CARD_FIELDS): CardFieldSettings {
    const p = PRESETS[key];
    const rest = normalizeCardFields(from).order.filter(k => !p.on.includes(k));
    return normalizeCardFields({ ...p, on: [...p.on], place: [...p.place], order: [...p.on, ...rest] });
}

/**
 * The preset these settings are exactly, or null. Compared: the ticked details
 * in their order, the place and the cause on them, full dates, and the
 * appearance (style, length, height, width, years). Not compared: the order of
 * unticked details, places of unticked ones, the stand-ins.
 */
export function matchCardPreset(settings: CardFieldSettings): CardPresetKey | null {
    const s = normalizeCardFields(settings);
    const shown = s.order.filter(k => s.on.includes(k));
    const same = (p: CardFieldSettings): boolean => {
        const want = p.order.filter(k => p.on.includes(k));
        return want.length === shown.length && want.every((k, i) => shown[i] === k)
            && shown.filter(k => PLACE_KEYS.includes(k)).every(k => p.place.includes(k) === s.place.includes(k))
            && (!shown.includes('death') || p.cause === s.cause)
            && p.fullDate === s.fullDate && p.style === s.style && p.lines === s.lines
            && p.height === s.height && p.widthCap === s.widthCap && p.years === s.years;
    };
    return CARD_PRESET_KEYS.find(k => same(cardPreset(k))) ?? null;
}

/**
 * The card box for a number of lines: the name row plus 17px a line. The width
 * is the narrowest one; the renderer widens every card of a view to its
 * longest text (src/card-width.ts). This is the view's height with one row a
 * detail; when details wrap the renderer measures the view's tallest card
 * instead (customCardViewHeight) and starts from this one.
 */
export function customCardSize(lines: number, years = false): { cardWidth: number; cardHeight: number } {
    // The years under the name make the header 3px taller (19 + 14 instead of the avatar's 30).
    return { cardWidth: 200, cardHeight: 56 + (years ? 3 : 0) + 17 * Math.max(0, lines) };
}

export interface CardLine {
    key: CardFieldKey;
    mark: string;
    /** "1919 Horní Lhota · souchotiny". */
    text: string;
    /** The date column: "1919", "after 1875", "1850–1855" ('' when the line has no date). */
    date: string;
    /** The place column: the place and, for a death, the cause ("Horní Lhota · souchotiny"). */
    rest: string;
    /** "+1" after the place for further marriages; never cut. */
    more?: string;
    /** The line has no date column (the occupation): its text starts where the dates do. */
    wide?: boolean;
    /** The line in words, for the aria-label: "Death 1919 Horní Lhota · souchotiny". */
    spoken: string;
    /**
     * The event's word, the line's label in the labels style: the event the
     * line shows, so a stand-in says its own ("Baptism" on the birth line).
     */
    label?: string;
    /** The place alone (without the cause). */
    place?: string;
    /** The cause of death alone: after the place with " · " in `rest`, its own row when a detail is whole. */
    cause?: string;
    /**
     * The date is long by its kind (cardDateIsLong): an estimate or a range
     * with a whole date, a text that is no date. It never goes into the date
     * column, however narrow it is (src/card-width.ts isLongCardDate).
     */
    dateLong?: boolean;
}

/**
 * A date for a card line: the year (or the whole date), an estimate in words
 * ("about 1855", "after 1919"), a range with a dash ("1850–1855").
 */
export function cardDate(value: string | undefined, full: boolean): string {
    const d = parseFlexDate(value);
    if (!d) return value?.trim() ?? '';
    const core = (x: { year: number; month?: number; day?: number }): string =>
        full ? formatFlexDate(toCanonical({ year: x.year, month: x.month, day: x.day, qualifier: '' })) : String(x.year);
    if (d.end) return `${core(d)}–${core(d.end)}`;
    const c = strings.card;
    const word = d.qualifier === '~' ? c.dateAbout : d.qualifier === '<' ? c.dateBefore : d.qualifier === '>' ? c.dateAfter : '';
    return word ? `${word} ${core(d)}` : core(d);
}

/**
 * Whether a date is long by its kind, as the card writes it (`full`: the
 * whole date, else the year): an estimate in words with a month ("kolem
 * 12. 3. 1790", "um 12.3.1790"), a range with a month on either side ("22. 11.
 * 1830–28. 12. 1831") and a text that is no date. An ordinary date is a
 * whole date, a month and year, a year, an estimate of a year ("kolem 1790")
 * and a range of years; with years only every parsed date is ordinary.
 */
export function cardDateIsLong(value: string | undefined, full: boolean): boolean {
    const d = parseFlexDate(value);
    if (!d) return !!value?.trim();
    if (!full) return false;
    const withMonth = d.month !== undefined || d.end?.month !== undefined;
    return withMonth && (!!d.qualifier || !!d.end);
}

/**
 * The ordinary dates of the current language and date setting (`full`: the
 * whole date, else the year), each kind with its real values: with the whole
 * date every day (1–31) of every month (1–12) as the language writes it (no
 * leading zero) and every month and year, then an estimate of a year in
 * words, a range of years and the year. The year is CARD_REFERENCE_YEAR;
 * src/card-width.ts customCardMetrics writes it with the widest digit of the
 * card font, and the widest of them is as wide as the date column of a card
 * may get, so every ordinary date fits under it and a date long by its kind
 * (cardDateIsLong) is not needed to fit.
 */
export function cardDateReferences(full: boolean): string[] {
    const y = CARD_REFERENCE_YEAR;
    const out: string[] = [];
    if (full) {
        const two = (n: number) => String(n).padStart(2, '0');
        for (let m = 1; m <= 12; m++) {
            out.push(cardDate(`${y}-${two(m)}`, true));
            // Every day of the month (1888 is a leap year: 29 February too).
            const days = new Date(Date.UTC(Number(y), m, 0)).getUTCDate();
            for (let day = 1; day <= days; day++) out.push(cardDate(`${y}-${two(m)}-${two(day)}`, true));
        }
    }
    out.push(...[`~${y}`, `<${y}`, `>${y}`, `${y}..${y}`, y].map(d => cardDate(d, full)));
    return [...new Set(out)];
}

/**
 * The life years under the name (the option "Years under the name"), as the
 * detailed card says them: "1841 – 1922", estimates in words ("c. 1855 –
 * after 1919"), "* 1958" for the living, "1841 †" for one presumed dead
 * without a death date; '' without any year (no such row).
 */
export function cardYears(person: Person, presumedDead = false): string {
    if (person.isPlaceholder) return '';
    const birth = cardDate(person.birthDate, false);
    const death = cardDate(person.deathDate, false);
    if (death) return `${birth || '?'} – ${death}`;
    if (birth) return presumedDead ? `${birth} †` : `* ${birth}`;
    return '';
}

const firstOf = (person: Person, types: LifeEvent['type'][]): LifeEvent | undefined => {
    for (const type of types) {
        const hit = sortLifeEvents((person.events ?? []).filter(e => e.type === type && (e.date || e.place)))[0];
        if (hit) return hit;
    }
    return undefined;
};

/**
 * The marriage a card speaks of: the primary one, else the oldest. Only a
 * marriage — a relationship without one has no wedding to show. `count` is how
 * many marriages the person has in all (the line says "+1" for the rest).
 */
export function cardMarriage(person: Person, data: StromData): { union: Partnership; count: number } | null {
    const unions = person.partnerships
        .map(id => data.partnerships[id])
        .filter((u): u is Partnership => !!u && (u.status === 'married' || u.status === 'divorced'));
    if (unions.length === 0) return null;
    const primary = unions.find(u => u.isPrimary)
        ?? [...unions].sort((a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999'))[0];
    return { union: primary, count: unions.length };
}

/** The lines of one person's custom card, in the chosen order. */
export function cardLines(person: Person, data: StromData, s: CardFieldSettings): CardLine[] {
    const out: CardLine[] = [];
    const types = strings.events.types;
    const add = (key: CardFieldKey, mark: string, label: string, date: string | undefined, place: string | undefined,
        extra?: string): void => {
        const placeText = s.place.includes(key) ? place?.trim() ?? '' : '';
        const dateText = cardDate(date, s.fullDate);
        const cause = extra?.trim() ?? '';
        const rest = [placeText, cause].filter(Boolean).join(' · ');
        const text = [[dateText, placeText].filter(Boolean).join(' '), cause].filter(Boolean).join(' · ');
        if (!text) return;
        out.push({ key, mark, text, date: dateText, rest, spoken: `${label} ${text}`, label,
            ...(placeText ? { place: placeText } : {}), ...(cause ? { cause } : {}),
            ...(dateText && cardDateIsLong(date, s.fullDate) ? { dateLong: true } : {}) });
    };
    for (const key of s.order) {
        if (!s.on.includes(key)) continue;
        switch (key) {
            case 'birth': {
                if (person.birthDate || person.birthPlace) {
                    add('birth', CARD_MARKS.birth, types.birth, person.birthDate, person.birthPlace);
                } else if (s.baptismFallback && !s.on.includes('baptism')) {
                    const b = firstOf(person, ['baptism']);
                    // The baptism shows with its own mark, so it is never read as the birth.
                    if (b) add('birth', CARD_MARKS.baptism, types.baptism, b.date, b.place);
                }
                break;
            }
            case 'baptism': {
                const b = firstOf(person, ['baptism']);
                if (b) add('baptism', CARD_MARKS.baptism, types.baptism, b.date, b.place);
                break;
            }
            case 'death': {
                const cause = s.cause ? person.deathCause : undefined;
                if (person.deathDate || person.deathPlace || cause) {
                    add('death', CARD_MARKS.death, types.death, person.deathDate, person.deathPlace, cause);
                } else if (s.burialFallback && !s.on.includes('burial')) {
                    const b = firstOf(person, ['burial', 'cremation']);
                    if (b) add('death', CARD_MARKS.burial, types[b.type], b.date, b.place);
                }
                break;
            }
            case 'burial': {
                const b = firstOf(person, ['burial', 'cremation']);
                if (b) add('burial', CARD_MARKS.burial, types[b.type], b.date, b.place);
                break;
            }
            case 'occupation': {
                const jobs = (person.events ?? []).filter(e => e.type === 'occupation' && e.note?.trim());
                const job = newestLifeEvent(jobs)?.note?.trim().split('\n')[0];
                if (job) {
                    out.push({ key, mark: '', text: job, date: '', rest: job, wide: true, spoken: `${types.occupation} ${job}`,
                        label: types.occupation });
                }
                break;
            }
            case 'marriage': {
                const m = cardMarriage(person, data);
                if (!m) break;
                const more = m.count > 1 ? strings.card.moreMarriages(m.count - 1) : '';
                const before = out.length;
                add('marriage', CARD_MARKS.marriage, strings.fields.marriageRow, m.union.startDate, m.union.startPlace);
                if (more && out.length > before) {
                    const line = out[out.length - 1];
                    line.text = `${line.text} ${more}`;
                    line.spoken = `${line.spoken} ${more}`;
                    line.more = more;
                }
                break;
            }
            case 'divorce': {
                // The same marriage as the marriage line, never another one's divorce.
                const m = cardMarriage(person, data);
                if (!m || !(m.union.status === 'divorced' || m.union.endDate || m.union.endPlace)) break;
                add('divorce', CARD_MARKS.divorce, strings.fields.divorceRow, m.union.endDate, m.union.endPlace);
                break;
            }
        }
    }
    return out;
}

/**
 * A line on the card: the mark, the date and the place in a grid (index.html
 * .card-line); the occupation has no date and spans both columns. The space
 * between the date and the place is not drawn (grid) but keeps the line's
 * text readable when copied. "+1" stays outside the part that shortens.
 * `cut`: the place does not fit and shortens — its full text goes to a title.
 * `rows`: the place column wrapped into rows (src/card-width.ts
 * customCardRows, a detail longer than one row): each row its own element,
 * never wrapped by the browser, so the screen draws the rows the height and
 * the image export were computed from; a value that ended in "…" says itself
 * in full in a title. Without `rows` the line is one row the browser shortens
 * (the one-row card, as before).
 * `style` 'labels': the event's word in the label column instead of the mark,
 * then the value: the date, 5px, the place (cardLabelLineHtml).
 * `longDate` (marks): the date is wider than the view's date column
 * (card-line--longdate): with `rows` it takes the first row across both
 * columns and the place's rows start under it (its empty first row is not
 * drawn); on one row the place follows the date and shortens.
 * `esc` must escape quotes as well (the text goes into an attribute).
 */
export function cardLineHtml(l: CardLine, esc: (text: string) => string, cut = false, rows?: CardLineRows,
    style: CardLineStyle = 'marks', longDate = false): string {
    if (style === 'labels') return cardLabelLineHtml(l, esc, cut, rows);
    const long = longDate && !l.wide && !!l.date ? ' card-line--longdate' : '';
    const mark = `<span class="card-line-mark" aria-hidden="true">${esc(l.mark)}</span>`;
    const date = l.wide ? '' : `<span class="card-line-date">${esc(l.date)}</span>${l.rest || l.more ? ' ' : ''}`;
    const placeClass = `card-line-place${l.wide ? ' card-line-place--wide' : ''}`;
    if (rows) {
        const title = rows.cut && l.rest ? ` title="${esc(l.rest)}"` : '';
        const shown = long && rows.rows[0] && !rows.rows[0].text && !rows.rows[0].tail ? rows.rows.slice(1) : rows.rows;
        const drawn = shown.map(r => `<span class="card-line-row${r.cause ? ' card-line-row--cause' : ''}">${esc(r.text)}`
            + `${r.tail ? `<span class="card-line-more">${esc(r.tail)}</span>` : ''}</span>`).join('');
        return `<div class="card-line card-line--${l.key} card-line--rows${long}">${mark}${date}<span class="${placeClass}"${title}>${drawn}</span></div>`;
    }
    const more = l.more ? `<span class="card-line-more"> ${esc(l.more)}</span>` : '';
    // A place cut short (an ellipsis, card-width.ts customCardCutLines) is said
    // in full in a native tooltip; `esc` escapes quotes, so it is safe in the attribute.
    const title = cut && l.rest ? ` title="${esc(l.rest)}"` : '';
    const place = `<span class="${placeClass}">`
        + `<span class="card-line-rest"${title}>${esc(l.rest)}</span>${more}</span>`;
    return `<div class="card-line card-line--${l.key}${long}">${mark}${date}${place}</div>`;
}

/**
 * A line in the labels style (index.html .card-line--label): the label in
 * the view's label column, the value after it. One row: the date, 5px, the
 * place shortened by the browser. Rows: each drawn as it is, the date (or
 * its piece) at the start of its row, every row starting at the value's
 * start; a value that ended in "…" says itself (date and place) in a title.
 */
function cardLabelLineHtml(l: CardLine, esc: (text: string) => string, cut: boolean, rows?: CardLineRows): string {
    const label = `<span class="card-line-label">${esc(l.label ?? '')}</span>`;
    const whole = l.more ? l.text.slice(0, l.text.length - l.more.length).trimEnd() : l.text;
    if (rows) {
        const title = rows.cut ? ` title="${esc(whole)}"` : '';
        const row = (r: CardRow): string => `<span class="card-line-row${r.cause ? ' card-line-row--cause' : ''}">`
            + `${r.date ? `<span class="card-line-date">${esc(r.date)}</span>` : ''}`
            + `${r.text ? `<span class="card-line-text">${esc(r.text)}</span>` : ''}`
            + `${r.tail ? `<span class="card-line-more">${esc(r.tail)}</span>` : ''}</span>`;
        return `<div class="card-line card-line--label card-line--${l.key} card-line--rows">${label}`
            + `<span class="card-line-value"${title}>${rows.rows.map(row).join('')}</span></div>`;
    }
    const date = l.date ? `<span class="card-line-date">${esc(l.date)}</span>` : '';
    const more = l.more ? `<span class="card-line-more"> ${esc(l.more)}</span>` : '';
    const title = cut ? ` title="${esc(whole)}"` : '';
    const rest = l.rest ? `<span class="card-line-rest"${title}>${esc(l.rest)}</span>` : '';
    return `<div class="card-line card-line--label card-line--${l.key}">${label}<span class="card-line-value">${date}${rest}${more}</span></div>`;
}

/**
 * What this person did (the detailed card's trade row). Occupation is an
 * event (it changes over a life: apprentice, journeyman, master), so for a
 * one-line summary take the newest dated one — the trade they ended up with;
 * same rule as the occupation field in the person dialog.
 */
export function cardOccupation(person: Person): string | null {
    const jobs = (person.events ?? []).filter(e => e.type === 'occupation' && e.note?.trim());
    if (jobs.length === 0) return null;
    return newestLifeEvent(jobs)?.note?.trim() ?? null;
}

/**
 * Age at death, or today's age for someone plausibly still alive (the
 * detailed card's "age 67"). Without a death date it must NOT count to today
 * for a historical person — that produced ages like 230. When it cannot be
 * known, it is null.
 */
export function cardAge(person: Person): number | null {
    if (!person.birthDate) return null;
    if (!person.deathDate && !isLivingPerson(person, new Date().getFullYear())) return null;
    // Shared age rule (handles qualified / partial / range dates).
    const age = ageBetween(person.birthDate, person.deathDate || undefined);
    return age ? age.years : null;
}
