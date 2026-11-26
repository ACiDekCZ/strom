/**
 * The research bridge's routes of house histories (spec 030, part 1): the
 * state (`/status.houses`, features `house*`), the list of houses the
 * research knows (`GET <token>/houses`, read again only on a new `rev`), one
 * house's whole result (`GET <token>/houses/<key|id>`), material and a memory
 * to a house (`POST /houses/material`) and a person's word on a renumbering, a
 * point or "not the same house" (`POST /houses/confirm`). The results live
 * here, in memory, never in the tree's data: what a person said is
 * StromData.houses (src/houses.ts). Simple requests (text/plain JSON, no
 * cookies) like the other writes; replies typed; never throws.
 */

import type { HouseId } from './types.js';
import {
    cleanText, houseSearchLink, HOUSE_REQUEST_WITH_MAX, isResearchHead, sanitizeHouseEstimate, sanitizeLiveHouses, withAppVersion,
    type HouseFeature, type LiveHouseEstimate, type LiveHouses,
} from './research-link.js';
import { writeHeldOfRefusal, type ResearchWriteHeld } from './research-write-held.js';
import type { ResearchHouseNumber } from './houses.js';

/** How long a read may take. */
export const HOUSE_READ_TIMEOUT_MS = 15_000;
/** How long a write may take (the research commits it). */
export const HOUSE_WRITE_TIMEOUT_MS = 15_000;
/** The most a reply may weigh (a house with a long history stays far below). */
const HOUSE_MAX_BYTES = 4 * 1024 * 1024;
/** The most items of one list kept from a reply. */
const MAX_ITEMS = 2000;

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

// ==================== STATE ====================

/** Whether the research can do this part of house histories (`/status.features`). */
export function houseFeature(features: readonly string[] | null | undefined, name: HouseFeature): boolean {
    return !!features?.includes(name);
}

/** `/status.houses` of a status: null without the feature `house` or without a valid state. */
export function houseStatus(status: { features?: readonly string[] | null; houses?: LiveHouses | null } | null | undefined): LiveHouses | null {
    return houseFeature(status?.features, 'house') ? status?.houses ?? null : null;
}

// ==================== TYPES ====================

/** How sure the research is (K6.5); a number may be `probable`. */
export type HouseCertainty = 'high' | 'medium' | 'guess' | 'probable';
/** Who wrote an item: the research's agent, or one's own research taken over (§2.8). */
export type HouseOrigin = 'research' | 'import';
/** A house's state: `none` = only material, not researched yet (§4.2). */
export type HouseState = 'none' | 'queued' | 'running' | 'done' | 'waiting' | 'held';
/** What the house's task does: take one's own research over, the house, its town's frame. */
export type HouseWork = 'takeover' | 'house' | 'town';

/** A source of an item: a source of the research (S…), a page of it, or a web address. */
export type HouseSource = { source: string; page?: string } | { url: string };

export interface HousePlace {
    key: string;
    id?: string;
    name: string;
}

/** A question of the house waiting for a person (`question.id`: the task T… that waits; answered the usual way). */
export interface HouseQuestion {
    id: string;
    text: string;
}

/** The counts of a house's result in the list. */
export interface HouseSummary {
    events: number;
    holders: number;
    residents: number;
    unknown: number;
    materials: number;
    passed: number;
}

/** One row of `GET /houses` (a house with a record, a task or material). */
export interface HouseListRow {
    /** The research's record (A…); none yet for a house known by a task or a material only. */
    id?: string;
    key: HouseId;
    place: HousePlace;
    house: string;
    name?: string;
    /** The house's numbers over time the research found (a renumbering told apart by a person left out). */
    numbers?: HouseRowNumber[];
    state: HouseState;
    at?: string;
    task?: string;
    work?: HouseWork;
    question?: HouseQuestion;
    persons: number;
    years?: { from: number; to: number };
    summary: HouseSummary;
}

/** A number of a row of `GET /houses`: `{number, from?, to?, certainty}` (listRow of the research). */
export interface HouseRowNumber extends ResearchHouseNumber {
    certainty?: HouseCertainty;
}

export interface HouseNumberItem extends ResearchHouseNumber {
    id: string;
    certainty?: HouseCertainty;
    sources: HouseSource[];
    /** A renumbering the agent proposes: a person confirms it (`/houses/confirm` `renumber`). */
    proposed?: boolean;
    text?: string;
    /** The day a person confirmed it. */
    confirmed?: string;
}

export interface HouseLocation {
    lat: number;
    lon: number;
    how?: string;
    certainty?: HouseCertainty;
    /** The day a person confirmed the point, null: not confirmed. */
    confirmed: string | null;
    sources: HouseSource[];
    origin?: HouseOrigin;
}

export type HouseEventKind = 'built' | 'rebuilt' | 'fire' | 'flood' | 'transfer' | 'renumber' | 'demolished' | 'auction' | 'other';

export interface HouseEvent {
    id: string;
    kind: HouseEventKind;
    date?: string;
    text: string;
    certainty?: HouseCertainty;
    sources: HouseSource[];
    origin?: HouseOrigin;
    /** The material it came from (M…/I…). */
    material?: string;
    at?: string;
}

export type HouseHolderHow = 'purchase' | 'inheritance' | 'marriage' | 'auction' | 'allotment' | 'other';

export interface HouseHolder {
    id: string;
    name: string;
    /** The person of the tree (the research's id, P…/I…), when it is one. */
    person?: string;
    from?: string;
    to?: string;
    how?: HouseHolderHow;
    certainty?: HouseCertainty;
    sources: HouseSource[];
    origin?: HouseOrigin;
}

export type HouseResidentRole = 'farmer' | 'retired' | 'lodger' | 'servant' | 'tenant' | 'other';

export interface HouseResident {
    id: string;
    name: string;
    person?: string;
    role?: HouseResidentRole;
    from?: string;
    to?: string;
    sources: HouseSource[];
    origin?: HouseOrigin;
}

export interface HouseMap {
    id: string;
    kind: string;
    url?: string;
    /** Only a link to open by hand (a site that does not allow reading by an agent). */
    manual?: boolean;
    sheet?: string;
    /** A layer of `/status.houses.layers` (part 2). */
    layer?: string;
    origin?: HouseOrigin;
}

/** A source gone through: found something (`found`), found nothing, or not said (a research taken over). */
export interface HousePassed {
    id: string;
    what: string;
    source?: string;
    url?: string;
    found?: boolean;
    at?: string;
    origin?: HouseOrigin;
}

/** A link to go through by hand (`o…`): not gone through yet. */
export interface HouseManual {
    id: string;
    what: string;
    url: string;
    why?: string;
}

export interface HouseUnknown {
    id: string;
    text: string;
    /** The question (Q…/T…) asked of a person, null: none asked. */
    question: string | null;
}

export interface HouseArchiveOnly {
    id: string;
    archive: string;
    fond?: string;
    signature?: string;
    what: string;
}

/** Material of a house: a file (I…/M…), one's own research taken over, a memory (text only through material, §4.4). */
export interface HouseMaterial {
    id: string;
    kind: string;
    title?: string;
    text?: string;
    witness?: string;
    file?: string;
    at?: string;
}

export interface HouseLook {
    text: string;
    certainty?: HouseCertainty;
    images: { url?: string; license?: string; credit?: string; file?: string }[];
}

/** The frame of the house's town (its record in the research), when there is one. */
export interface HouseTown {
    /** The town's record in the research (A…); a frame still asked for may come without one. */
    id?: string;
    /** The research's place of the town. */
    place?: { id: string; name?: string };
    text: string;
    passed: HousePassed[];
    manual: HouseManual[];
    archiveOnly: HouseArchiveOnly[];
    maps: HouseMap[];
    unknown: HouseUnknown[];
    /** When the town's frame task was done (a date; true from an older bridge that only said so). */
    done?: string | true;
    task?: string;
    state?: HouseState;
}

/** One house's whole result (`GET /houses/<key|id>`, §2.4 with §4.2/§4.4). No `recent`: the app works it out. */
export interface HouseResearch {
    /** The research's record (A…); none yet for a house known by a task or a material only. */
    id?: string;
    key: HouseId;
    place: HousePlace;
    house: string;
    name?: string;
    nameBy?: string;
    state: HouseState;
    at?: string;
    task?: string;
    work?: HouseWork;
    question?: HouseQuestion;
    /** The tree's people of the house (the research's ids). */
    persons: string[];
    years?: { from: number; to: number };
    numbers: HouseNumberItem[];
    location?: HouseLocation;
    timeline: HouseEvent[];
    holders: HouseHolder[];
    residents: HouseResident[];
    look?: HouseLook;
    maps: HouseMap[];
    passed: HousePassed[];
    manual: HouseManual[];
    unknown: HouseUnknown[];
    archiveOnly: HouseArchiveOnly[];
    materials: HouseMaterial[];
    /** Items of the timeline (ids) sensitive for outputs (K1.4a). */
    sensitive: string[];
    town?: HouseTown;
    /** Houses joined as the same one. */
    same: { id: string; key: HouseId }[];
    rev?: string;
}

// ==================== SANITIZING ====================

const ID_RE = /^[A-Za-z0-9_.:-]{1,40}$/;
const KEY_MAX = 400;
const STATES: readonly HouseState[] = ['none', 'queued', 'running', 'done', 'waiting', 'held'];
const WORKS: readonly HouseWork[] = ['takeover', 'house', 'town'];
const CERTAINTIES: readonly HouseCertainty[] = ['high', 'medium', 'guess', 'probable'];
const EVENT_KINDS: readonly HouseEventKind[] = ['built', 'rebuilt', 'fire', 'flood', 'transfer', 'renumber', 'demolished', 'auction', 'other'];
const HOLDER_HOWS: readonly HouseHolderHow[] = ['purchase', 'inheritance', 'marriage', 'auction', 'allotment', 'other'];
const ROLES: readonly HouseResidentRole[] = ['farmer', 'retired', 'lodger', 'servant', 'tenant', 'other'];

const idOf = (v: unknown): string | undefined => (typeof v === 'string' && ID_RE.test(v) ? v : undefined);
const text = (v: unknown, max = 2000): string | undefined => {
    const t = cleanText(v, max);
    return t ? t : undefined;
};
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | undefined => (list.includes(v as T) ? v as T : undefined);
const keyOf = (v: unknown): HouseId | undefined =>
    typeof v === 'string' && v.includes('|') && v.length <= KEY_MAX && v === v.trim() ? v : undefined;
const count = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10_000_000 ? v : 0);
const isoDay = (v: unknown): string | undefined => (typeof v === 'string' && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(v) ? v : undefined);
const date = (v: unknown): string | undefined => text(v, 40);
const httpUrl = (v: unknown): string | undefined => {
    if (typeof v !== 'string' || v.length > 2000) return undefined;
    try {
        const u = new URL(v);
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
    } catch {
        return undefined;
    }
};
const origin = (v: unknown): HouseOrigin | undefined => oneOf(v, ['research', 'import'] as const);

function list<T>(v: unknown, item: (r: Record<string, unknown>) => T | null): T[] {
    if (!Array.isArray(v)) return [];
    const out: T[] = [];
    for (const x of v.slice(0, MAX_ITEMS)) {
        const r = asRecord(x);
        const it = r ? item(r) : null;
        if (it) out.push(it);
    }
    return out;
}

function sources(v: unknown): HouseSource[] {
    if (!Array.isArray(v)) return [];
    const out: HouseSource[] = [];
    for (const x of v.slice(0, 200)) {
        if (typeof x === 'string') {
            const id = idOf(x);
            if (id) out.push({ source: id });
            continue;
        }
        const r = asRecord(x);
        if (!r) continue;
        const url = httpUrl(r.url);
        const source = idOf(r.source);
        if (source) out.push({ source, ...(text(r.page, 200) ? { page: text(r.page, 200)! } : {}) });
        else if (url) out.push({ url });
    }
    return out;
}

const opt = <K extends string, V>(k: K, v: V | undefined): { [P in K]?: V } =>
    (v === undefined ? {} : { [k]: v } as { [P in K]?: V });

function place(v: unknown): HousePlace | null {
    const r = asRecord(v);
    const key = typeof r?.key === 'string' && r.key.length <= KEY_MAX ? r.key : undefined;
    const name = text(r?.name, 400);
    if (!r || key === undefined || !name) return null;
    return { key, ...opt('id', idOf(r.id)), name };
}

function years(v: unknown): { from: number; to: number } | undefined {
    const r = asRecord(v);
    const ok = (y: unknown): y is number => typeof y === 'number' && Number.isInteger(y) && y > 0 && y < 3000;
    return r && ok(r.from) && ok(r.to) && r.from <= r.to ? { from: r.from, to: r.to } : undefined;
}

function question(v: unknown): HouseQuestion | undefined {
    const r = asRecord(v);
    const id = idOf(r?.id);
    const t = text(r?.text, 1000);
    return id && t ? { id, text: t } : undefined;
}

function passed(r: Record<string, unknown>): HousePassed | null {
    const id = idOf(r.id);
    const what = text(r.what, 1000);
    if (!id || !what) return null;
    return {
        id, what, ...opt('source', idOf(r.source)), ...opt('url', httpUrl(r.url)),
        ...opt('found', typeof r.found === 'boolean' ? r.found : undefined), ...opt('at', isoDay(r.at)), ...opt('origin', origin(r.origin)),
    };
}

function manual(r: Record<string, unknown>): HouseManual | null {
    const id = idOf(r.id);
    const what = text(r.what, 1000);
    const url = httpUrl(r.url);
    return id && what && url ? { id, what, url, ...opt('why', text(r.why, 1000)) } : null;
}

function unknownItem(r: Record<string, unknown>): HouseUnknown | null {
    const id = idOf(r.id);
    const t = text(r.text, 1000);
    return id && t ? { id, text: t, question: idOf(r.question) ?? null } : null;
}

function archiveOnly(r: Record<string, unknown>): HouseArchiveOnly | null {
    const id = idOf(r.id);
    const archive = text(r.archive, 400);
    const what = text(r.what, 1000);
    if (!id || !archive || !what) return null;
    return { id, archive, ...opt('fond', text(r.fond, 400)), ...opt('signature', text(r.signature, 200)), what };
}

function mapItem(r: Record<string, unknown>): HouseMap | null {
    const id = idOf(r.id);
    const kind = text(r.kind, 40);
    const url = httpUrl(r.url);
    const layer = idOf(r.layer);
    if (!id || !kind || (!url && !layer)) return null;
    return {
        id, kind, ...opt('url', url), ...opt('manual', r.manual === true ? true : undefined), ...opt('sheet', text(r.sheet, 200)),
        ...opt('layer', layer), ...opt('origin', origin(r.origin)),
    };
}

function material(r: Record<string, unknown>): HouseMaterial | null {
    const id = idOf(r.id);
    const kind = text(r.kind, 40);
    if (!id || !kind) return null;
    return {
        id, kind, ...opt('title', text(r.title, 400)), ...opt('text', text(r.text, 20_000)), ...opt('witness', text(r.witness, 400)),
        ...opt('file', text(r.file, 400)), ...opt('at', isoDay(r.at)),
    };
}

function numberItem(r: Record<string, unknown>): HouseNumberItem | null {
    const id = idOf(r.id);
    const number = text(r.number, 100);
    if (!id || !number) return null;
    const proposal = asRecord(r.proposal);
    const proposed = r.proposed === true || !!proposal;
    return {
        id, number, ...opt('from', date(r.from)), ...opt('to', date(r.to)), ...opt('certainty', oneOf(r.certainty, CERTAINTIES)),
        sources: sources(r.sources ?? proposal?.sources),
        ...opt('proposed', proposed ? true : undefined), ...opt('text', text(r.text ?? proposal?.text, 1000)),
        ...opt('confirmed', isoDay(r.confirmed)),
    };
}

function location(v: unknown): HouseLocation | undefined {
    const r = asRecord(v);
    if (!r || typeof r.lat !== 'number' || typeof r.lon !== 'number' || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)
        || Math.abs(r.lat) > 90 || Math.abs(r.lon) > 180) return undefined;
    return {
        lat: r.lat, lon: r.lon, ...opt('how', text(r.how, 40)), ...opt('certainty', oneOf(r.certainty, CERTAINTIES)),
        confirmed: isoDay(r.confirmed) ?? null, sources: sources(r.sources), ...opt('origin', origin(r.origin)),
    };
}

function look(v: unknown): HouseLook | undefined {
    const r = asRecord(v);
    const t = text(r?.text, 4000);
    if (!r || !t) return undefined;
    return {
        text: t, ...opt('certainty', oneOf(r.certainty, CERTAINTIES)),
        images: list(r.images, i => {
            const url = httpUrl(i.url);
            const file = text(i.file, 400);
            return url || file ? { ...opt('url', url), ...opt('license', text(i.license, 200)), ...opt('credit', text(i.credit, 400)), ...opt('file', file) } : null;
        }),
    };
}

function town(v: unknown): HouseTown | undefined {
    const r = asRecord(v);
    if (!r) return undefined;
    const id = idOf(r.id);
    const pr = asRecord(r.place);
    const placeId = idOf(pr ? pr.id : r.place);
    const townPlace = placeId ? { id: placeId, ...opt('name', text(pr?.name, 200)) } : undefined;
    const task = idOf(r.task);
    // A record (A…), its place or its task: something to show; anything else is not a town's frame.
    if (!id && !townPlace && !task) return undefined;
    const done = isoDay(r.done) ?? (r.done === true ? true : undefined);
    return {
        ...opt('id', id), ...opt('place', townPlace), text: text(r.text, 4000) ?? '',
        passed: list(r.passed, passed), manual: list(r.manual, manual), archiveOnly: list(r.archiveOnly, archiveOnly),
        maps: list(r.maps, mapItem), unknown: list(r.unknown, unknownItem),
        ...opt('done', done), ...opt('task', task), ...opt('state', oneOf(r.state, STATES)),
    };
}

/** A number of a list row: an object as the research sends it (a bare text, as an older bridge did, is its number). */
function rowNumber(v: unknown): HouseRowNumber | null {
    if (typeof v === 'string') {
        const number = text(v, 100);
        return number ? { number } : null;
    }
    const r = asRecord(v);
    const number = text(r?.number, 100);
    if (!r || !number) return null;
    return { number, ...opt('from', date(r.from)), ...opt('to', date(r.to)), ...opt('certainty', oneOf(r.certainty, CERTAINTIES)) };
}

/** A row of `GET /houses`, checked; null: not a house the app can show. */
export function sanitizeHouseRow(value: unknown): HouseListRow | null {
    const r = asRecord(value);
    const id = idOf(r?.id);
    const key = keyOf(r?.key);
    const p = place(r?.place);
    const house = text(r?.house, 200);
    const state = oneOf(r?.state, STATES);
    if (!r || !key || !p || !house || !state) return null;
    const s = asRecord(r.summary) ?? {};
    const numbers = Array.isArray(r.numbers) ? r.numbers.slice(0, MAX_ITEMS).map(rowNumber).filter((n): n is HouseRowNumber => !!n) : undefined;
    return {
        ...opt('id', id), key, place: p, house, ...opt('name', text(r.name, 200)), ...opt('numbers', numbers?.length ? numbers : undefined), state,
        ...opt('at', isoDay(r.at)), ...opt('task', idOf(r.task)), ...opt('work', oneOf(r.work, WORKS)), ...opt('question', question(r.question)),
        persons: count(r.persons), ...opt('years', years(r.years)),
        summary: {
            events: count(s.events), holders: count(s.holders), residents: count(s.residents),
            unknown: count(s.unknown), materials: count(s.materials), passed: count(s.passed),
        },
    };
}

/** One house's whole result, checked (the detail itself or `{house: …}` of a write's reply); null: none. */
export function sanitizeHouseResearch(value: unknown): HouseResearch | null {
    const outer = asRecord(value);
    const r = outer && asRecord(outer.house) && !keyOf(outer.key) ? asRecord(outer.house)! : outer;
    const id = idOf(r?.id);
    const key = keyOf(r?.key);
    const p = place(r?.place);
    const house = text(r?.house, 200);
    const state = oneOf(r?.state, STATES);
    if (!r || !key || !p || !house || !state) return null;
    const timeline = list(r.timeline, e => {
        const eid = idOf(e.id);
        const t = text(e.text, 4000);
        if (!eid || !t) return null;
        return {
            id: eid, kind: oneOf(e.kind, EVENT_KINDS) ?? 'other', ...opt('date', date(e.date)), text: t,
            ...opt('certainty', oneOf(e.certainty, CERTAINTIES)), sources: sources(e.sources), ...opt('origin', origin(e.origin)),
            ...opt('material', idOf(e.material)), ...opt('at', isoDay(e.at)),
        } satisfies HouseEvent;
    });
    const holders = list(r.holders, h => {
        const hid = idOf(h.id);
        const name = text(h.name, 400);
        if (!hid || !name) return null;
        return {
            id: hid, name, ...opt('person', idOf(h.person)), ...opt('from', date(h.from)), ...opt('to', date(h.to)),
            ...opt('how', oneOf(h.how, HOLDER_HOWS)), ...opt('certainty', oneOf(h.certainty, CERTAINTIES)),
            sources: sources(h.sources), ...opt('origin', origin(h.origin)),
        } satisfies HouseHolder;
    });
    const residents = list(r.residents, h => {
        const hid = idOf(h.id);
        const name = text(h.name, 400);
        if (!hid || !name) return null;
        return {
            id: hid, name, ...opt('person', idOf(h.person)), ...opt('role', oneOf(h.role, ROLES)),
            ...opt('from', date(h.from)), ...opt('to', date(h.to)), sources: sources(h.sources), ...opt('origin', origin(h.origin)),
        } satisfies HouseResident;
    });
    const persons = Array.isArray(r.persons) ? r.persons.map(idOf).filter((x): x is string => !!x) : [];
    const timelineIds = new Set(timeline.map(e => e.id));
    const sensitive = Array.isArray(r.sensitive)
        ? [...new Set(r.sensitive.map(idOf).filter((x): x is string => !!x && timelineIds.has(x)))] : [];
    return {
        ...opt('id', id), key, place: p, house, ...opt('name', text(r.name, 200)), ...opt('nameBy', text(r.nameBy, 40)), state,
        ...opt('at', isoDay(r.at)), ...opt('task', idOf(r.task)), ...opt('work', oneOf(r.work, WORKS)), ...opt('question', question(r.question)),
        persons, ...opt('years', years(r.years)),
        numbers: list(r.numbers, numberItem), ...opt('location', location(r.location)),
        timeline, holders, residents, ...opt('look', look(r.look)),
        maps: list(r.maps, mapItem), passed: list(r.passed, passed), manual: list(r.manual, manual),
        unknown: list(r.unknown, unknownItem), archiveOnly: list(r.archiveOnly, archiveOnly), materials: list(r.materials, material),
        sensitive, ...opt('town', town(r.town)),
        same: list(r.same, x => {
            const sid = idOf(x.id);
            const skey = keyOf(x.key);
            return sid && skey ? { id: sid, key: skey } : null;
        }),
        ...opt('rev', typeof outer?.rev === 'string' && outer.rev.length <= 80 ? outer.rev : typeof r.rev === 'string' && r.rev.length <= 80 ? r.rev : undefined),
    };
}

// ==================== CACHE ====================

/**
 * The results read in this session, by the house's key; a key that changed
 * (the town's or the house's text written another way) while its id stayed is
 * the same house: its result moves to the new key.
 */
export class HouseResearchCache {
    private byKey = new Map<HouseId, HouseResearch>();
    private keyOfId = new Map<string, HouseId>();
    list: { rev: string; houses: HouseListRow[] } | null = null;
    /** The towns of the towns' frame tasks met (task T… → the town's name; spec 030 §14: the queue names them). */
    readonly townTasks = new Map<string, string>();

    get(keyOrId: string): HouseResearch | undefined {
        return this.byKey.get(keyOrId) ?? this.byKey.get(this.keyOfId.get(keyOrId) ?? '');
    }

    put(house: HouseResearch): void {
        const was = house.id ? this.keyOfId.get(house.id) : undefined;
        if (was !== undefined && was !== house.key) this.byKey.delete(was);
        const other = this.byKey.get(house.key);
        if (other?.id && other.id !== house.id) this.keyOfId.delete(other.id);
        this.byKey.set(house.key, house);
        if (house.id) this.keyOfId.set(house.id, house.key);
        if (house.town?.task) this.townTasks.set(house.town.task, house.town.place?.name || house.place.name);
    }

    /** A new list: the rows' keys carry the results read under an old key of the same id. */
    putList(rev: string, houses: HouseListRow[]): void {
        this.list = { rev, houses };
        for (const row of houses) {
            const was = row.id ? this.keyOfId.get(row.id) : undefined;
            if (was === undefined || was === row.key) continue;
            const h = this.byKey.get(was);
            if (h) this.put({ ...h, key: row.key });
        }
    }

    clear(): void {
        this.byKey.clear();
        this.keyOfId.clear();
        this.townTasks.clear();
        this.list = null;
    }
}

const caches = new Map<string, HouseResearchCache>();

/** The cache of one bridge (`base`: its address with its token). */
export function houseCache(base: string): HouseResearchCache {
    let c = caches.get(base);
    if (!c) {
        c = new HouseResearchCache();
        caches.set(base, c);
    }
    return c;
}

/** Forget every result (a research unlinked, tests). */
export function clearHouseCaches(): void {
    caches.clear();
}

// ==================== READ ====================

const TIMED_OUT = '\u0000timeout';
const TOO_BIG = '\u0000too-big';

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; text: string } | null> {
    if (typeof fetch !== 'function') return null;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    let late = false;
    const timer = ctl ? setTimeout(() => { late = true; ctl.abort(); }, timeoutMs) : null;
    try {
        const res = await fetch(withAppVersion(url), { mode: 'cors', credentials: 'omit', cache: 'no-store', ...init, signal: ctl?.signal });
        const len = Number(res.headers?.get?.('Content-Length') ?? '');
        if (Number.isFinite(len) && len > HOUSE_MAX_BYTES) {
            try { await res.body?.cancel(); } catch { /* nothing to cancel */ }
            return { status: res.status, text: TOO_BIG };
        }
        const body = await res.text();
        return { status: res.status, text: body.length > HOUSE_MAX_BYTES ? TOO_BIG : body };
    } catch {
        return late ? { status: 0, text: TIMED_OUT } : null;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function jsonOf(t: string): unknown {
    try { return JSON.parse(t); } catch { return null; }
}

/**
 * Why a read failed: `network` the bridge not reached, `timeout` no answer in time, `too-big` over the limit,
 * `unknown-house` 404 (a house where nobody of the tree lived, §2.6), `invalid` not a reply the app reads,
 * `refused` any other status.
 */
export type HouseReadError = 'network' | 'timeout' | 'too-big' | 'unknown-house' | 'invalid' | 'refused';

export type HousesReadResult =
    | { ok: true; rev: string; houses: HouseListRow[]; cached: boolean }
    | { ok: false; code: HouseReadError; status: number };

function readFailure(res: { status: number; text: string } | null): { ok: false; code: HouseReadError; status: number } | null {
    if (!res) return { ok: false, code: 'network', status: 0 };
    if (res.text === TIMED_OUT) return { ok: false, code: 'timeout', status: 0 };
    if (res.text === TOO_BIG) return { ok: false, code: 'too-big', status: res.status };
    if (res.status === 404) return { ok: false, code: 'unknown-house', status: 404 };
    if (res.status < 200 || res.status >= 300) return { ok: false, code: 'refused', status: res.status };
    return null;
}

/**
 * The houses the research knows (`GET <token>/houses`). `rev`: `/status.houses.rev` now — the list read for it
 * already is given again without asking (`cached: true`).
 */
export async function fetchHouses(base: string, opts: { rev?: string; timeoutMs?: number } = {}): Promise<HousesReadResult> {
    const cache = houseCache(base);
    if (opts.rev && cache.list?.rev === opts.rev) return { ok: true, rev: cache.list.rev, houses: cache.list.houses, cached: true };
    const res = await request(`${base}/houses`, { method: 'GET' }, opts.timeoutMs ?? HOUSE_READ_TIMEOUT_MS);
    const failed = readFailure(res);
    if (failed) return failed;
    const r = asRecord(jsonOf(res!.text));
    if (!r || typeof r.rev !== 'string' || r.rev.length > 80 || !Array.isArray(r.houses)) return { ok: false, code: 'invalid', status: res!.status };
    const houses = r.houses.slice(0, MAX_ITEMS).map(sanitizeHouseRow).filter((h): h is HouseListRow => !!h);
    cache.putList(r.rev, houses);
    return { ok: true, rev: r.rev, houses, cached: false };
}

export type HouseReadResult =
    | { ok: true; house: HouseResearch }
    | { ok: false; code: HouseReadError; status: number };

/** One house's whole result (`GET <token>/houses/<key|id>`), kept in the cache under its key. */
export async function fetchHouse(base: string, keyOrId: string, opts: { timeoutMs?: number } = {}): Promise<HouseReadResult> {
    const res = await request(`${base}/houses/${encodeURIComponent(keyOrId)}`, { method: 'GET' }, opts.timeoutMs ?? HOUSE_READ_TIMEOUT_MS);
    const failed = readFailure(res);
    if (failed) return failed;
    const house = sanitizeHouseResearch(jsonOf(res!.text));
    if (!house) return { ok: false, code: 'invalid', status: res!.status };
    houseCache(base).put(house);
    return { ok: true, house };
}

// ==================== WRITE ====================

/**
 * Why a write did not go: `invalid` 400 house.body; `town` 400 with reasonCode house.town (the town has no place
 * in the research); `unknown-house` 404 house.unknown; `archive` 409 house.archive; `held` sealed elsewhere / not
 * downloaded / disk full (each with its feature); `locked` 423; `busy` 503 research.busy; `full` 507;
 * `network` no answer; `timeout` no answer in time (the write may have gone through); `unknown` anything else.
 */
export type HouseWriteError = 'invalid' | 'town' | 'unknown-house' | 'archive' | 'held' | 'locked' | 'busy' | 'full' | 'network' | 'timeout' | 'unknown';

export type HouseWriteResult =
    | { ok: true; house: HouseResearch | null; materials: string[]; head: string; parent: string }
    | { ok: false; code: HouseWriteError; status: number; reason: string; bridgeCode: string; held?: ResearchWriteHeld };

/** The reply to `POST /houses/material` or `/houses/confirm`, typed. */
export function houseWriteReply(status: number, body: unknown, features: readonly string[] | null | undefined): HouseWriteResult {
    const r = asRecord(body) ?? {};
    if (status >= 200 && status < 300) {
        const house = sanitizeHouseResearch(r.house ? { house: r.house } : null);
        const materials = Array.isArray(r.materials)
            ? r.materials.map(m => idOf(asRecord(m)?.id) ?? idOf(m)).filter((x): x is string => !!x) : [];
        return { ok: true, house, materials, head: isResearchHead(r.head) ?? '', parent: isResearchHead(r.parent) ?? '' };
    }
    const reason = cleanText(typeof r.text === 'string' && r.text ? r.text : r.error, 400);
    const code = typeof r.code === 'string' && /^[a-z0-9.-]{1,40}$/.test(r.code) ? r.code : '';
    const out = (c: HouseWriteError, extra: { held?: ResearchWriteHeld } = {}): HouseWriteResult =>
        ({ ok: false, code: c, status, reason, bridgeCode: code, ...extra });
    const held = writeHeldOfRefusal(code, r.error, features, r.params);
    if (held) return out('held', { held });
    if (status === 400) return out(r.reasonCode === 'house.town' ? 'town' : 'invalid');
    if (status === 404) return out('unknown-house');
    if (status === 409 && (code === 'house.archive' || !code)) return out('archive');
    if (status === 423 || code === 'locked') return out('locked');
    if (status === 503 || code === 'research.busy' || code === 'busy') return out('busy');
    if (status === 507 || code === 'disk.full') return out('full');
    return out('unknown');
}

async function postHouse(base: string, path: string, body: unknown, features: readonly string[] | null | undefined): Promise<HouseWriteResult> {
    const res = await request(`${base}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: JSON.stringify(body),
    }, HOUSE_WRITE_TIMEOUT_MS);
    if (!res) return { ok: false, code: 'network', status: 0, reason: '', bridgeCode: '' };
    if (res.text === TIMED_OUT) return { ok: false, code: 'timeout', status: 0, reason: '', bridgeCode: '' };
    const reply = houseWriteReply(res.status, jsonOf(res.text), features);
    if (reply.ok && reply.house) houseCache(base).put(reply.house);
    return reply;
}

/** A memory of a house: its text, who told it (kept only with the witness's consent, §4.4). */
export interface HouseMemory {
    text: string;
    witness?: string;
    witnessConsent: boolean;
}

/** The body of `POST /houses/material`: a memory, a name after the farm, files already sent (I…). */
export interface HouseMaterialBody {
    house: HouseId;
    memory?: HouseMemory;
    name?: string;
    files?: string[];
}

/** The body as sent, checked: null when it says nothing (no memory, name or file). */
export function houseMaterialBody(body: HouseMaterialBody): HouseMaterialBody | null {
    const house = keyOf(body.house);
    if (!house) return null;
    const memoryText = body.memory ? text(body.memory.text, 20_000) : undefined;
    const witness = body.memory?.witnessConsent ? text(body.memory.witness, 400) : undefined;
    const name = text(body.name, 200);
    const files = (body.files ?? []).map(idOf).filter((x): x is string => !!x);
    if (!memoryText && !name && !files.length) return null;
    return {
        house,
        ...(memoryText ? { memory: { text: memoryText, ...(witness ? { witness } : {}), witnessConsent: !!body.memory?.witnessConsent } } : {}),
        ...(name ? { name } : {}),
        ...(files.length ? { files } : {}),
    };
}

/** Material or a memory to a house (feature `house.material`): the research keeps it for the house's task. */
export async function sendHouseMaterial(base: string, body: HouseMaterialBody, features: readonly string[] | null | undefined): Promise<HouseWriteResult> {
    const clean = houseMaterialBody(body);
    if (!clean) return { ok: false, code: 'invalid', status: 0, reason: '', bridgeCode: '' };
    return postHouse(base, '/houses/material', clean, features);
}

/** The body of `POST /houses/confirm`: a renumbering (`id` of the number), a point (`lat`, `lon`), not the same house. */
export type HouseConfirmBody =
    | { house: HouseId; what: 'renumber'; id: string }
    | { house: HouseId; what: 'location'; lat?: number; lon?: number }
    | { house: HouseId; what: 'notSame'; id?: string };

/** A person's word on a house (feature `house.confirm`); the reply is the whole house, kept in the cache. */
export async function confirmHouse(base: string, body: HouseConfirmBody, features: readonly string[] | null | undefined): Promise<HouseWriteResult> {
    return postHouse(base, '/houses/confirm', body, features);
}

/**
 * What a batch of files to a house adds to `POST /batch/<id>/done`: `{house}` when the research takes material
 * to a house (`house.material`), else nothing (the files go as a plain batch).
 */
export function batchDoneHouse(house: string | undefined, features: readonly string[] | null | undefined): { house?: HouseId } {
    const key = keyOf(house);
    return key && houseFeature(features, 'house.material') ? { house: key } : {};
}

// ==================== THE SETTING AND A REQUEST (part 2, §4.5) ====================

/** Why `POST /houses {on}` did not go: as `HouseWriteError` (400 house.body `invalid`, 500 house.failed `unknown`). */
export type HousesAutoResult =
    | { ok: true; houses: LiveHouses | null; head: string; parent: string }
    | { ok: false; code: HouseWriteError; status: number; reason: string; bridgeCode: string; held?: ResearchWriteHeld };

/** The reply to `POST /houses {on}`, typed: the state the research keeps now (as `/status.houses`) and its commit. */
export function housesAutoReply(status: number, body: unknown, features: readonly string[] | null | undefined): HousesAutoResult {
    const r = asRecord(body) ?? {};
    if (status >= 200 && status < 300) {
        return { ok: true, houses: sanitizeLiveHouses(r.houses), head: isResearchHead(r.head) ?? '', parent: isResearchHead(r.parent) ?? '' };
    }
    const refused = houseWriteReply(status, body, features);
    return refused.ok ? { ok: false, code: 'unknown', status, reason: '', bridgeCode: '' } : refused;
}

/**
 * House histories on or off for this tree (`POST <token>/houses {"on": bool}`, feature `house.auto`), written at
 * once, no terminal, both ways (§4.5, like census records): switching off sets the waiting house tasks aside.
 */
export async function setHousesAuto(base: string, on: boolean, features: readonly string[] | null | undefined): Promise<HousesAutoResult> {
    const res = await request(`${base}/houses`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: JSON.stringify({ on }),
    }, HOUSE_WRITE_TIMEOUT_MS);
    if (!res) return { ok: false, code: 'network', status: 0, reason: '', bridgeCode: '' };
    if (res.text === TIMED_OUT) return { ok: false, code: 'timeout', status: 0, reason: '', bridgeCode: '' };
    return housesAutoReply(res.status, jsonOf(res.text), features);
}

/**
 * What a request of a house gave: `queued` (the setting on: the house's task is on top of the queue, with the
 * task of its town's frame when the town has none yet), or `link` (the setting off, 403 house.link: the research's
 * terminal says the estimate and asks — no task is made until its yes), or a refusal as any house write.
 */
export type HouseRequestResult =
    | { ok: true; state: 'queued'; house: HouseListRow | null; task: string; town?: string; head: string; parent: string }
    | { ok: false; code: 'link'; status: number; reason: string; bridgeCode: string; link: string; estimate: LiveHouseEstimate | null }
    | { ok: false; code: HouseWriteError; status: number; reason: string; bridgeCode: string; held?: ResearchWriteHeld };

/** Who a request's link is for: the tree and the research's scheme. */
export interface HouseLinkCheck {
    tree: string;
    scheme?: string;
}

/** The houses a request takes besides the house: keys, without the house itself or a repeat, at most two. */
export function houseRequestWith(house: string, more: readonly string[]): HouseId[] {
    const out: HouseId[] = [];
    for (const k of more) {
        const key = keyOf(k);
        if (key && key !== house && !out.includes(key)) out.push(key);
        if (out.length === HOUSE_REQUEST_WITH_MAX) break;
    }
    return out;
}

/** The reply to `POST /houses/request`, typed; `link` is the research's own only when it is the one the app would build. */
export function houseRequestReply(status: number, body: unknown, features: readonly string[] | null | undefined,
    sent: { house: HouseId; with: HouseId[] }, check: HouseLinkCheck): HouseRequestResult {
    const r = asRecord(body) ?? {};
    if (status >= 200 && status < 300) {
        const task = idOf(r.task) ?? '';
        return {
            ok: true, state: 'queued', house: sanitizeHouseRow(r.house), task, ...opt('town', idOf(r.town)),
            head: isResearchHead(r.head) ?? '', parent: isResearchHead(r.parent) ?? '',
        };
    }
    const code = typeof r.code === 'string' && /^[a-z0-9.-]{1,40}$/.test(r.code) ? r.code : '';
    if (status === 403 && code === 'house.link') {
        const own = houseSearchLink(check.tree, sent.house, sent.with, check.scheme);
        const said = typeof r.link === 'string' ? r.link : '';
        const link = own && said === own ? said : own ?? '';
        const reason = cleanText(typeof r.text === 'string' && r.text ? r.text : r.error, 400);
        return { ok: false, code: 'link', status, reason, bridgeCode: code, link, estimate: sanitizeHouseEstimate(r.estimate) };
    }
    const refused = houseWriteReply(status, body, features);
    return refused.ok ? { ok: false, code: 'unknown', status, reason: '', bridgeCode: code } : refused;
}

/**
 * Ask the research for a house's history (`POST <token>/houses/request {house, with?}`, feature `house.request`):
 * `with` at most two more houses of the family in the same town (another town's house is refused by the research).
 * With the setting off the answer is the terminal's link (`code: 'link'`); never throws.
 */
export async function requestHouse(base: string, house: string, more: readonly string[], features: readonly string[] | null | undefined,
    check: HouseLinkCheck): Promise<HouseRequestResult> {
    const key = keyOf(house);
    if (!key) return { ok: false, code: 'invalid', status: 0, reason: '', bridgeCode: '' };
    const withKeys = houseRequestWith(key, more);
    const res = await request(`${base}/houses/request`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: JSON.stringify({ house: key, ...(withKeys.length ? { with: withKeys } : {}) }),
    }, HOUSE_WRITE_TIMEOUT_MS);
    if (!res) return { ok: false, code: 'network', status: 0, reason: '', bridgeCode: '' };
    if (res.text === TIMED_OUT) return { ok: false, code: 'timeout', status: 0, reason: '', bridgeCode: '' };
    const reply = houseRequestReply(res.status, jsonOf(res.text), features, { house: key, with: withKeys }, check);
    // The town's frame asked for with it: the queue names its task by the town.
    if (reply.ok && reply.town && reply.house) houseCache(base).townTasks.set(reply.town, reply.house.place.name);
    return reply;
}

/**
 * "Move to the top" (§2, the setting on): the bridge has no route of its own for it — a request of a house whose
 * task waits moves that task on top of the queue (§2.6), so it is a request of the house alone.
 */
export function moveHouseToTop(base: string, house: string, features: readonly string[] | null | undefined,
    check: HouseLinkCheck): Promise<HouseRequestResult> {
    return requestHouse(base, house, [], features, check);
}
