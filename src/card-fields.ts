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
import { parseFlexDate, formatFlexDate, toCanonical } from './dates.js';
import { newestLifeEvent, sortLifeEvents } from './events.js';
import { strings } from './strings.js';

export type CardFieldKey = 'birth' | 'baptism' | 'death' | 'burial' | 'occupation' | 'marriage' | 'divorce';

export const CARD_FIELD_KEYS: readonly CardFieldKey[] =
    ['birth', 'baptism', 'death', 'burial', 'occupation', 'marriage', 'divorce'];

/** Lines a card holds at most: more would make every card in the chart tall. */
export const MAX_CARD_LINES = 5;

export interface CardFieldSettings {
    /** All seven keys, in the order the lines appear. */
    order: CardFieldKey[];
    /** The ticked ones (at most MAX_CARD_LINES). */
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
}

/**
 * What "Custom" starts with the first time: what the detailed card shows
 * (birth and death with their places, the occupation), years only.
 */
export const DEFAULT_CARD_FIELDS: CardFieldSettings = {
    order: [...CARD_FIELD_KEYS],
    on: ['birth', 'death', 'occupation'],
    place: ['birth', 'baptism', 'death', 'burial', 'marriage', 'divorce'],
    cause: false,
    baptismFallback: true,
    burialFallback: true,
    fullDate: false,
};

/** Keys whose line can carry a place (an occupation has none). */
export const PLACE_KEYS: readonly CardFieldKey[] = ['birth', 'baptism', 'death', 'burial', 'marriage', 'divorce'];

/** The mark in front of each line. ⚰ gets a text-style selector so no emoji font takes it. */
export const CARD_MARKS: Record<CardFieldKey, string> = {
    birth: '*', baptism: '≈', death: '†', burial: '⚰︎', occupation: '', marriage: '⚭', divorce: '⚮',
};

/** Repair whatever was stored: unknown keys out, all keys in the order, at most five on. */
export function normalizeCardFields(raw: Partial<CardFieldSettings> | undefined): CardFieldSettings {
    const d = DEFAULT_CARD_FIELDS;
    const known = (list: unknown): CardFieldKey[] => Array.isArray(list)
        ? [...new Set(list.filter((k): k is CardFieldKey => CARD_FIELD_KEYS.includes(k as CardFieldKey)))]
        : [];
    const order = known(raw?.order);
    for (const k of CARD_FIELD_KEYS) if (!order.includes(k)) order.push(k);
    const on = raw?.on ? known(raw.on).slice(0, MAX_CARD_LINES) : [...d.on];
    return {
        order,
        on,
        place: raw?.place ? known(raw.place) : [...d.place],
        cause: typeof raw?.cause === 'boolean' ? raw.cause : d.cause,
        baptismFallback: typeof raw?.baptismFallback === 'boolean' ? raw.baptismFallback : d.baptismFallback,
        burialFallback: typeof raw?.burialFallback === 'boolean' ? raw.burialFallback : d.burialFallback,
        fullDate: typeof raw?.fullDate === 'boolean' ? raw.fullDate : d.fullDate,
    };
}

/**
 * The card box for a number of lines: the name row plus 17px a line. The width
 * is the narrowest one; the renderer widens every card of a view to its
 * longest text (src/card-width.ts).
 */
export function customCardSize(lines: number): { cardWidth: number; cardHeight: number } {
    return { cardWidth: 200, cardHeight: 56 + 17 * Math.max(0, Math.min(MAX_CARD_LINES, lines)) };
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
    /** The place, said in full in the tooltip when the line is cut. */
    place?: string;
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
        const rest = [placeText, extra?.trim() ?? ''].filter(Boolean).join(' · ');
        const text = [[dateText, placeText].filter(Boolean).join(' '), extra?.trim() ?? ''].filter(Boolean).join(' · ');
        if (!text) return;
        out.push({ key, mark, text, date: dateText, rest, spoken: `${label} ${text}`, ...(placeText ? { place: placeText } : {}) });
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
                if (job) out.push({ key, mark: '', text: job, date: '', rest: job, wide: true, spoken: `${types.occupation} ${job}` });
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
 */
export function cardLineHtml(l: CardLine, esc: (text: string) => string): string {
    const mark = `<span class="card-line-mark" aria-hidden="true">${esc(l.mark)}</span>`;
    const more = l.more ? `<span class="card-line-more"> ${esc(l.more)}</span>` : '';
    const place = `<span class="card-line-place${l.wide ? ' card-line-place--wide' : ''}">`
        + `<span class="card-line-rest">${esc(l.rest)}</span>${more}</span>`;
    const date = l.wide ? '' : `<span class="card-line-date">${esc(l.date)}</span>${l.rest || l.more ? ' ' : ''}`;
    return `<div class="card-line card-line--${l.key}">${mark}${date}${place}</div>`;
}
