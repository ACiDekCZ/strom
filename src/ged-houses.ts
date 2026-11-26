/**
 * What a person said about houses in a GEDCOM file (spec 030 U4b, the
 * research's answer 8): a `0 @Hn@ _HOUSE` record for each house the tree's
 * owner named or joined (StromData.houses), read by Strom Research's sync as
 * the person's word and, once its gate opens, written back by it.
 *
 *   0 @H1@ _HOUSE
 *   1 PLAC Bělokamen            the town as the facts write it
 *   1 _NUM čp. 16               the number as written; one line per number
 *   2 DATE FROM 1860 TO 1915    the years of the tree's facts at that number
 *   1 NAME U Prouzalů           the name after the farm
 *   1 _SAME @H2@                a house joined to this one (HouseUserData.merged)
 *   1 _STROM_KEY belokamen|16   the house's id (HouseId)
 *
 * Only houses with a person's word go out (the research works the houses
 * out of the facts' places itself): one named or with houses joined, and
 * each house joined to it, so `_SAME` points at a record. What the file does
 * not carry (houses told apart, the location, events revealed for outputs)
 * stays in the app's own data (JSON). A record read back gives the name and
 * the houses joined: `_SAME` and the other numbers of the record, each of
 * which is the house under another number.
 */

import type { HouseId, HouseUserData, StromData } from './types.js';
import { collectHouses, houseIdOf, houseTownKey, isHouseId, sanitizeHouses } from './houses.js';

/** One number of a house in its record, with the years of the facts at it. */
export interface GedcomHouseNumber {
    house: string;
    from?: number;
    to?: number;
}

/** One `_HOUSE` record as the exporter writes it. */
export interface GedcomHouseRecord {
    key: HouseId;
    /** The town as the tree writes it (none when no fact of the tree is in it). */
    town?: string;
    numbers: GedcomHouseNumber[];
    name?: string;
    /** Keys of the records joined to this one (each is a record of the same list). */
    same: HouseId[];
}

/**
 * The `_HOUSE` records of a tree: each house with a name or houses joined,
 * then the houses joined to it (each once), in the order of StromData.houses.
 * Works on the data as it goes out (a privacy mode has already taken the
 * name of a protected house: applyLivingPrivacy).
 */
export function gedcomHouseRecords(data: StromData): GedcomHouseRecord[] {
    const user = data.houses;
    if (!user) return [];
    const wanted: HouseId[] = [];
    const seen = new Set<HouseId>();
    const want = (id: HouseId): void => {
        if (seen.has(id) || !isHouseId(id)) return;
        seen.add(id);
        wanted.push(id);
    };
    for (const [id, entry] of Object.entries(user)) {
        if (!entry.name?.trim() && !entry.merged?.length) continue;
        want(id);
        for (const m of entry.merged ?? []) want(m);
    }
    if (!wanted.length) return [];
    // Each house by its own number (no join): its text, town and years.
    const own = new Map(collectHouses({ ...data, houses: undefined }).map(h => [h.id, h]));
    const townOf = new Map<string, string>();
    for (const h of own.values()) if (!townOf.has(h.townKey)) townOf.set(h.townKey, h.ref.town);
    return wanted.map(id => {
        const h = own.get(id);
        const entry = user[id];
        const town = h?.ref.town ?? townOf.get(houseTownKey(id));
        const n = h?.numbers[0];
        const name = entry?.name?.trim();
        return {
            key: id,
            ...(town ? { town } : {}),
            numbers: h ? [{ house: h.text, ...(n?.from !== undefined ? { from: n.from } : {}), ...(n?.to !== undefined ? { to: n.to } : {}) }] : [],
            ...(name ? { name } : {}),
            same: (entry?.merged ?? []).filter(m => seen.has(m) && m !== id),
        };
    });
}

/** The DATE under a `_NUM`: "FROM 1860 TO 1915", "FROM 1860", "TO 1915"; none without years. */
export function gedcomHouseSpan(n: Pick<GedcomHouseNumber, 'from' | 'to'>): string | null {
    const parts = [n.from !== undefined ? `FROM ${n.from}` : '', n.to !== undefined ? `TO ${n.to}` : ''].filter(Boolean);
    return parts.length ? parts.join(' ') : null;
}

// ==================== READING ====================

/** A `_HOUSE` record being read, as written. */
export interface RawHouseRecord {
    xref: string;
    town?: string;
    numbers: GedcomHouseNumber[];
    name?: string;
    same: string[];
    key?: string;
    /** The level-1 tag the following level-2 lines belong to. */
    sub: string | null;
}

const MAX_NUMBERS = 50;
const MAX_SAME = 200;
const MAX_TEXT = 1000;

export function openHouseRecord(xref: string): RawHouseRecord {
    return { xref, numbers: [], same: [], sub: null };
}

/** "FROM 1860 TO 1915" (or one of the two), a single year: the years; anything else none. */
function spanOf(value: string): { from?: number; to?: number } {
    const v = value.trim();
    const single = /^(?:ABT\s+|EST\s+|CAL\s+)?(\d{3,4})$/i.exec(v);
    if (single) return { from: Number(single[1]), to: Number(single[1]) };
    const m = /^(?:FROM\s+(?:\S+\s+)*?(\d{3,4}))?\s*(?:TO\s+(?:\S+\s+)*?(\d{3,4}))?$/i.exec(v);
    if (!m || (!m[1] && !m[2])) return {};
    return { ...(m[1] ? { from: Number(m[1]) } : {}), ...(m[2] ? { to: Number(m[2]) } : {}) };
}

/** A CONC / CONT line appended to a value (a value of one line: CONT reads as a space). */
function more(text: string | undefined, tag: string, value: string): string | undefined {
    if (text === undefined) return undefined;
    const next = text + (tag === 'CONT' ? ' ' : '') + value;
    return next.length > MAX_TEXT ? next.slice(0, MAX_TEXT) : next;
}

/** Reads one line under a `_HOUSE` record; lines it does not know are skipped. */
export function readHouseRecordLine(rec: RawHouseRecord, level: number, tag: string, value: string): void {
    if (level === 1) {
        rec.sub = tag;
        switch (tag) {
            case 'PLAC': if (value && rec.town === undefined) rec.town = value.slice(0, MAX_TEXT); break;
            case 'NAME': if (value && rec.name === undefined) rec.name = value.slice(0, MAX_TEXT); break;
            case '_NUM': if (value && rec.numbers.length < MAX_NUMBERS) rec.numbers.push({ house: value.slice(0, MAX_TEXT) }); else rec.sub = null; break;
            case '_SAME': if (/^@[^@\s]+@$/.test(value.trim()) && rec.same.length < MAX_SAME) rec.same.push(value.trim()); break;
            case '_STROM_KEY': if (value && rec.key === undefined) rec.key = value.slice(0, MAX_TEXT); break;
        }
        return;
    }
    if (level !== 2) return;
    const isMore = tag === 'CONC' || tag === 'CONT';
    const last = rec.numbers[rec.numbers.length - 1];
    if (rec.sub === '_NUM' && last) {
        if (tag === 'DATE') Object.assign(last, spanOf(value));
        else if (isMore) last.house = more(last.house, tag, value) ?? last.house;
    } else if (rec.sub === '_STROM_KEY' && isMore) {
        rec.key = more(rec.key, tag, value);
    } else if (rec.sub === 'PLAC' && isMore) {
        rec.town = more(rec.town, tag, value);
    } else if (rec.sub === 'NAME' && isMore) {
        rec.name = more(rec.name, tag, value);
    }
}

/** The number a record's house has today: one still in use (no end) begun last, else the one ended last, else the last listed. */
function currentNumber(numbers: readonly GedcomHouseNumber[]): GedcomHouseNumber | undefined {
    let best: GedcomHouseNumber | undefined;
    const rank = (n: GedcomHouseNumber): number => n.to === undefined
        ? (n.from === undefined ? -1 : 100000 + n.from)
        : n.to;
    for (const n of numbers) if (!best || rank(n) >= rank(best)) best = n;
    return best;
}

/** The house a record is: its `_STROM_KEY`, else its town with its number of today. */
function recordKey(rec: RawHouseRecord): HouseId | null {
    const key = rec.key?.trim();
    if (key && isHouseId(key)) return key;
    const now = currentNumber(rec.numbers);
    if (!rec.town?.trim() || !now) return null;
    const id = houseIdOf(rec.town, now.house);
    return isHouseId(id) && !id.startsWith('|') && !id.endsWith('|') ? id : null;
}

/**
 * What the records say about houses (StromData.houses): each record's name,
 * and as houses joined to it its other numbers and the records it names
 * `_SAME`. A record without a key (no `_STROM_KEY`, no town with a number)
 * says nothing; none at all = undefined.
 */
export function housesFromRecords(records: readonly RawHouseRecord[]): Record<HouseId, HouseUserData> | undefined {
    if (!records.length) return undefined;
    const keys = new Map<string, HouseId>();
    for (const rec of records) {
        const key = recordKey(rec);
        if (key && !keys.has(rec.xref)) keys.set(rec.xref, key);
    }
    const out: Record<string, { name?: string; merged?: HouseId[] }> = {};
    for (const rec of records) {
        const key = keys.get(rec.xref);
        if (!key) continue;
        const entry = out[key] ??= {};
        const name = rec.name?.trim();
        if (name && !entry.name) entry.name = name;
        const joined: HouseId[] = [];
        if (rec.town?.trim()) {
            for (const n of rec.numbers) {
                const id = houseIdOf(rec.town, n.house);
                if (isHouseId(id) && !id.endsWith('|')) joined.push(id);
            }
        }
        for (const ptr of rec.same) {
            const id = keys.get(ptr);
            if (id) joined.push(id);
        }
        const merged = [...new Set([...(entry.merged ?? []), ...joined])].filter(id => id !== key);
        if (merged.length) entry.merged = merged;
    }
    return sanitizeHouses(out);
}
