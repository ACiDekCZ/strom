/**
 * The data of a phone's Research screen (spec 094 K3.13): what the research's
 * bridge says of a tree before the tree is on the device — read through the
 * gateway's sealed tunnel, cleaned, and kept as the last state to show without
 * a connection (§8, D6).
 *
 * - `GET glance` (feature `glance`): who works on which line now, the runs,
 *   the last 24 hours, the lines in the order of work, what waits (with what a
 *   device may do about each), the names of the people these name by ID, the
 *   tree's size;
 * - `GET finds?since&lang` (feature `finds`; `finds.person`: the person each
 *   group and child line is about, by ID);
 * - `GET people?q=` (feature `people.search`): at most 8 people by a name.
 *
 * Every answer is cleaned here (unknown fields dropped, texts flattened and
 * cut, IDs and times checked): nothing the bridge says can break the screen.
 * The screen is refreshed by the bridge's live events (`watchDeviceResearch`),
 * never by asking again and again.
 *
 * This module must never reach the tree (DataManager), the renderer or the
 * person picker, even through another module: the screen opens without them
 * (checked by `device-research-imports.test.ts`).
 */

import { deviceFetch } from './gateway-client';
import { deviceConnection, onDeviceConnection, onDeviceEvent } from './device-connection';
import { chosenTreeId, deviceTreeIdOk, findsSeenAt, loadResearchState, saveResearchState } from './device-store';

// ——— features ———

export const GLANCE_FEATURE = 'glance';
export const PEOPLE_SEARCH_FEATURE = 'people.search';
export const FINDS_FEATURE = 'finds';
export const FINDS_PERSON_FEATURE = 'finds.person';

/** What the research's bridge offers the Research screen, by its `/status.features`. */
export interface DeviceResearchFeatures {
    glance: boolean;
    peopleSearch: boolean;
    finds: boolean;
    /** Finds say the person (ID) of a group and a child line ("Show in the tree"). */
    findsPerson: boolean;
}

/** The features of a `/status` (its `features`, or the list itself); anything else: none. */
export function deviceResearchFeatures(statusOrFeatures: unknown): DeviceResearchFeatures {
    const list = Array.isArray(statusOrFeatures) ? statusOrFeatures : asRecord(statusOrFeatures)?.features;
    const has = new Set(Array.isArray(list) ? list.filter((f): f is string => typeof f === 'string') : []);
    const finds = has.has(FINDS_FEATURE);
    return {
        glance: has.has(GLANCE_FEATURE),
        peopleSearch: has.has(PEOPLE_SEARCH_FEATURE),
        finds,
        findsPerson: finds && has.has(FINDS_PERSON_FEATURE),
    };
}

/** No feature at all (the bridge not asked yet, or an older research). */
export const NO_RESEARCH_FEATURES: DeviceResearchFeatures = Object.freeze({ glance: false, peopleSearch: false, finds: false, findsPerson: false });

// ——— the shapes (core/glance.ts, core/phone-finds.ts and core/people.ts of the research) ———

/** The way of a line: up (ancestors), down (descendants), other. */
export type DeviceWay = 'up' | 'down' | 'other';
/** What a device may do about one of what waits (each through the bridge). */
export type DeviceWaitingDo = 'answer' | 'sent' | 'unsent' | 'retry' | 'line' | 'keep' | 'never' | 'decide';
export type DeviceRunState = 'working' | 'between' | 'paused' | 'finishing';

export interface DevicePaused {
    until: string;
    reason?: string;
}

export interface DeviceGlanceNow {
    /** Since when the agent works there. */
    since: string;
    paused?: DevicePaused;
    /** The line it works on (G…). */
    line?: string;
    way: DeviceWay;
    /** The task at work: its ID (T…) and its text. */
    task?: { id: string; text: string };
    /** Whom the work is about (P…), the family (F…). */
    person?: string;
    family?: string;
    /** The run it belongs to (POST runs/stop {run}). */
    run?: string;
}

export interface DeviceGlanceRun {
    id: string;
    /** The line it holds (G…); null: the whole queue. */
    line: string | null;
    way: DeviceWay;
    since: string;
    state: DeviceRunState;
    paused?: DevicePaused;
    task?: string;
}

export interface DeviceGlanceLine {
    id: string;
    /** Its place in the order of work (1 = first). */
    n: number;
    name: string;
    /** ancestors, descendants, person, question (a newer research may say more). */
    direction: string;
    way: DeviceWay;
    /** active, paused, done (a newer research may say more). */
    state: string;
    tasks: number;
    waiting: number;
    working: boolean;
    since: string;
    /** Whom it is about (P…). */
    focus?: string;
    reason?: string;
}

export interface DeviceHypothesis {
    variants: { label: string; claim: string }[];
    proposal?: { variant?: string; abandon?: true; decision: string };
    pick?: true;
}

export interface DeviceGlanceWaiting {
    id: string;
    kind: string;
    section: string;
    phase: 'todo' | 'sent';
    what: string;
    on?: string;
    at: string;
    sentAt?: string;
    group: { key: string; name: string; kind: string; url?: string };
    person?: string;
    line?: string;
    branch?: string;
    retry?: { can: boolean; until?: string; says: string };
    hypothesis?: DeviceHypothesis;
    do: DeviceWaitingDo[];
}

export interface DeviceGlance {
    head: string;
    headAt?: string;
    tree: { id: string; name: string; lang: string; state: string; kind?: string; persons: number; families: number; ged?: { bytes: number; head: string } };
    /** A research a newer strom wrote: nothing else is said. */
    locked?: { code: string };
    /** The last 24 hours. */
    day?: { persons: number; sources: number; saves: number; since: string };
    now: DeviceGlanceNow[];
    runs: DeviceGlanceRun[];
    /** When anybody worked on it last (nobody at work now). */
    lastWorked?: string;
    lines: DeviceGlanceLine[];
    waiting: { n: number; items: DeviceGlanceWaiting[] };
    /** Each person named by ID above: the name and the years of the life. */
    people: Record<string, { name: string; span?: string }>;
}

export type DeviceFindKind = 'person' | 'name' | 'family' | 'child' | 'fact' | 'fixed' | 'cited' | 'source' | 'conflict' | 'hypothesis';
export type DeviceFindGroupKind = 'person' | 'family' | 'sources' | 'resolved';

export interface DeviceFindLine {
    kind: DeviceFindKind;
    /** The record's own words ("" for a new person or family). */
    text: string;
    at: string;
    fact?: { kind: string; name: string; what: string };
    /** A child: the years of its life. */
    span?: string;
    /** A child: its person (P…), with `finds.person`. */
    person?: string;
    /** A hypothesis decided: the answer chosen, when the research says it ("· decided: yes"). */
    decided?: string;
}

export interface DeviceFindGroup {
    /** Stable, to keep what was drawn (never a record's ID). */
    key: string;
    kind: DeviceFindGroupKind;
    title?: string;
    name?: string;
    span?: string;
    /** A person: its ID; a family: its first partner's (with `finds.person`). */
    person?: string;
    /** Its newest line's moment. */
    at: string;
    lines: DeviceFindLine[];
}

export interface DeviceFinds {
    since: string;
    groups: DeviceFindGroup[];
    /** Groups past the bridge's limit, not given. */
    cut?: number;
    /** The newest find before the window: older ones can be asked for. */
    earlier?: string;
}

/** A person found by a name. */
export interface DevicePersonHit {
    id: string;
    name: string;
    span?: string;
    place?: string;
}

// ——— cleaning ———

type Rec = Record<string, unknown>;

function asRecord(v: unknown): Rec | null {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null;
}

const MAX_TEXT = 2000;
const MAX_NAME = 300;
const MAX_ID = 120;
const MAX_LINES = 500;
const MAX_NOW = 50;
const MAX_WAITING = 200;
const MAX_PEOPLE = 5000;
const MAX_GROUPS = 500;
const MAX_GROUP_LINES = 500;
const MAX_VARIANTS = 20;
/** The bridge gives at most 8 people for a name. */
export const PEOPLE_SEARCH_MAX = 8;

/** A text of one line (control characters and runs of spaces flattened), cut at `max`. */
function text(v: unknown, max = MAX_TEXT): string {
    if (typeof v !== 'string') return '';
    // eslint-disable-next-line no-control-regex
    const flat = v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (flat.length <= max) return flat;
    const cut = /[\uD800-\uDBFF]/.test(flat[max - 2] ?? '') ? max - 2 : max - 1;
    return flat.slice(0, cut) + '…';
}

function optText(v: unknown, max = MAX_TEXT): string | undefined {
    const t = text(v, max);
    return t || undefined;
}

/** A record's ID or a short code (no spaces, no control characters). */
function id(v: unknown, max = MAX_ID): string | undefined {
    return typeof v === 'string' && v.length > 0 && v.length <= max && /^[\p{L}\p{N}._:@#/+-]+$/u.test(v) ? v : undefined;
}

const PERSON_ID = /^P\d{1,9}$/;
function personId(v: unknown): string | undefined {
    return typeof v === 'string' && PERSON_ID.test(v) ? v : undefined;
}

/** An ISO time the clock reads. */
function time(v: unknown): string | undefined {
    return typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? v : undefined;
}

function count(v: unknown): number {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function oneOf<T extends string>(v: unknown, all: readonly T[]): T | undefined {
    return typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : undefined;
}

function list(v: unknown, max: number): unknown[] {
    return Array.isArray(v) ? v.slice(0, max) : [];
}

const WAYS: readonly DeviceWay[] = ['up', 'down', 'other'];
const RUN_STATES: readonly DeviceRunState[] = ['working', 'between', 'paused', 'finishing'];
const WAITING_DO: readonly DeviceWaitingDo[] = ['answer', 'sent', 'unsent', 'retry', 'line', 'keep', 'never', 'decide'];
const FIND_KINDS: readonly DeviceFindKind[] = ['person', 'name', 'family', 'child', 'fact', 'fixed', 'cited', 'source', 'conflict', 'hypothesis'];
const GROUP_KINDS: readonly DeviceFindGroupKind[] = ['person', 'family', 'sources', 'resolved'];

function paused(v: unknown): { paused?: DevicePaused } {
    const r = asRecord(v);
    const until = time(r?.until);
    if (!until) return {};
    const reason = optText(r?.reason, 200);
    return { paused: { until, ...(reason ? { reason } : {}) } };
}

function cleanNow(v: unknown): DeviceGlanceNow | null {
    const r = asRecord(v);
    if (!r) return null;
    const line = id(r.line);
    const task = asRecord(r.task);
    const taskId = id(task?.id);
    const taskText = text(task?.text);
    const person = personId(r.person);
    const family = id(r.family);
    const run = id(r.run);
    return {
        since: time(r.since) ?? '',
        ...paused(r.paused),
        ...(line ? { line } : {}),
        way: oneOf(r.way, WAYS) ?? 'other',
        ...(taskId && taskText ? { task: { id: taskId, text: taskText } } : {}),
        ...(person ? { person } : {}),
        ...(family ? { family } : {}),
        ...(run ? { run } : {}),
    };
}

function cleanRun(v: unknown): DeviceGlanceRun | null {
    const r = asRecord(v);
    const runId = id(r?.id);
    if (!r || !runId) return null;
    const task = id(r.task);
    return {
        id: runId,
        line: id(r.line) ?? null,
        way: oneOf(r.way, WAYS) ?? 'other',
        since: time(r.since) ?? '',
        state: oneOf(r.state, RUN_STATES) ?? 'working',
        ...paused(r.paused),
        ...(task ? { task } : {}),
    };
}

function cleanLine(v: unknown): DeviceGlanceLine | null {
    const r = asRecord(v);
    const lineId = id(r?.id);
    if (!r || !lineId) return null;
    const n = count(r.n);
    const focus = personId(r.focus);
    const reason = optText(r.reason);
    return {
        id: lineId,
        n,
        name: text(r.name, MAX_NAME) || String(n || lineId),
        direction: id(r.direction, 40) ?? 'other',
        way: oneOf(r.way, WAYS) ?? 'other',
        state: id(r.state, 40) ?? 'active',
        tasks: count(r.tasks),
        waiting: count(r.waiting),
        working: r.working === true,
        since: time(r.since) ?? '',
        ...(focus ? { focus } : {}),
        ...(reason ? { reason } : {}),
    };
}

function cleanHypothesis(v: unknown): DeviceHypothesis | undefined {
    const r = asRecord(v);
    if (!r) return undefined;
    const variants = list(r.variants, MAX_VARIANTS).flatMap((x) => {
        const o = asRecord(x);
        const label = text(o?.label, 40);
        return label ? [{ label, claim: text(o?.claim) }] : [];
    });
    const p = asRecord(r.proposal);
    const variant = text(p?.variant, 40);
    const decision = text(p?.decision);
    const proposal = p && (variant || p.abandon === true || decision)
        ? { ...(variant ? { variant } : {}), ...(p.abandon === true ? { abandon: true as const } : {}), decision }
        : undefined;
    return { variants, ...(proposal ? { proposal } : {}), ...(r.pick === true ? { pick: true as const } : {}) };
}

function cleanWaiting(v: unknown): DeviceGlanceWaiting | null {
    const r = asRecord(v);
    const itemId = id(r?.id);
    if (!r || !itemId) return null;
    const g = asRecord(r.group);
    const url = typeof g?.url === 'string' && g.url.length <= 2000 && /^https?:\/\/[^\s]+$/i.test(g.url) ? g.url : undefined;
    const on = optText(r.on);
    const sentAt = time(r.sentAt);
    const person = personId(r.person);
    const line = id(r.line);
    const branch = id(r.branch);
    const retry = asRecord(r.retry);
    const until = time(retry?.until);
    const hypothesis = cleanHypothesis(r.hypothesis);
    return {
        id: itemId,
        kind: id(r.kind, 40) ?? 'other',
        section: id(r.section, 40) ?? 'other',
        phase: r.phase === 'sent' ? 'sent' : 'todo',
        what: text(r.what),
        ...(on ? { on } : {}),
        at: time(r.at) ?? '',
        ...(sentAt ? { sentAt } : {}),
        group: { key: text(g?.key, MAX_ID) || 'other', name: text(g?.name, MAX_NAME), kind: id(g?.kind, 40) ?? 'other', ...(url ? { url } : {}) },
        ...(person ? { person } : {}),
        ...(line ? { line } : {}),
        ...(branch ? { branch } : {}),
        ...(retry && typeof retry.can === 'boolean' ? { retry: { can: retry.can, ...(until ? { until } : {}), says: text(retry.says) } } : {}),
        ...(hypothesis ? { hypothesis } : {}),
        do: [...new Set(list(r.do, WAITING_DO.length * 2).map((d) => oneOf(d, WAITING_DO)).filter((d): d is DeviceWaitingDo => !!d))],
    };
}

/** A glance as the bridge answered it, cleaned; null when it is no glance at all. */
export function sanitizeGlance(value: unknown): DeviceGlance | null {
    const r = asRecord(value);
    const t = asRecord(r?.tree);
    if (!r || !t) return null;
    const treeId = deviceTreeIdOk(t.id) ? t.id : '';
    const kind = id(t.kind, 40);
    const ged = asRecord(t.ged);
    const gedBytes = count(ged?.bytes);
    const tree: DeviceGlance['tree'] = {
        id: treeId,
        name: text(t.name, MAX_NAME),
        lang: id(t.lang, 20) ?? 'en',
        state: id(t.state, 40) ?? 'research',
        ...(kind ? { kind } : {}),
        persons: count(t.persons),
        families: count(t.families),
        ...(gedBytes ? { ged: { bytes: gedBytes, head: text(ged?.head, 80) } } : {}),
    };
    const headAt = time(r.headAt);
    const locked = asRecord(r.locked);
    if (locked) {
        return { head: '', tree, locked: { code: id(locked.code, 60) ?? 'tree.newer' }, now: [], runs: [], lines: [], waiting: { n: 0, items: [] }, people: {} };
    }
    const d = asRecord(r.day);
    const day = d ? { persons: count(d.persons), sources: count(d.sources), saves: count(d.saves), since: time(d.since) ?? '' } : undefined;
    const lastWorked = time(r.lastWorked);
    const w = asRecord(r.waiting);
    const items = list(w?.items, MAX_WAITING).map(cleanWaiting).filter((x): x is DeviceGlanceWaiting => !!x);
    const people: DeviceGlance['people'] = {};
    const said = asRecord(r.people);
    if (said) {
        for (const pid of Object.keys(said).slice(0, MAX_PEOPLE)) {
            const p = asRecord(said[pid]);
            if (!personId(pid) || !p) continue;
            const span = optText(p.span, 40);
            people[pid] = { name: text(p.name, MAX_NAME) || pid, ...(span ? { span } : {}) };
        }
    }
    return {
        head: text(r.head, 80),
        ...(headAt ? { headAt } : {}),
        tree,
        ...(day ? { day } : {}),
        now: list(r.now, MAX_NOW).map(cleanNow).filter((x): x is DeviceGlanceNow => !!x),
        runs: list(r.runs, MAX_NOW).map(cleanRun).filter((x): x is DeviceGlanceRun => !!x),
        ...(lastWorked ? { lastWorked } : {}),
        lines: list(r.lines, MAX_LINES).map(cleanLine).filter((x): x is DeviceGlanceLine => !!x),
        waiting: { n: Math.max(count(w?.n), items.length), items },
        people,
    };
}

function cleanFindLine(v: unknown): DeviceFindLine | null {
    const r = asRecord(v);
    const kind = oneOf(r?.kind, FIND_KINDS);
    if (!r || !kind) return null;
    const f = asRecord(r.fact);
    const factKind = id(f?.kind, 40);
    const span = optText(r.span, 40);
    const person = personId(r.person);
    const decided = optText(r.decided, MAX_NAME);
    return {
        kind,
        text: text(r.text),
        at: time(r.at) ?? '',
        ...(f && factKind ? { fact: { kind: factKind, name: text(f.name, MAX_NAME), what: text(f.what) } } : {}),
        ...(span ? { span } : {}),
        ...(person ? { person } : {}),
        ...(decided ? { decided } : {}),
    };
}

function cleanFindGroup(v: unknown): DeviceFindGroup | null {
    const r = asRecord(v);
    const kind = oneOf(r?.kind, GROUP_KINDS);
    const key = id(r?.key, 80);
    if (!r || !kind || !key) return null;
    const lines = list(r.lines, MAX_GROUP_LINES).map(cleanFindLine).filter((x): x is DeviceFindLine => !!x);
    if (!lines.length) return null;
    const title = optText(r.title, MAX_NAME);
    const name = optText(r.name, MAX_NAME);
    const span = optText(r.span, 40);
    const person = personId(r.person);
    return {
        key,
        kind,
        ...(title ? { title } : {}),
        ...(name ? { name } : {}),
        ...(span ? { span } : {}),
        ...(person ? { person } : {}),
        at: time(r.at) ?? lines.reduce((a, l) => (l.at > a ? l.at : a), ''),
        lines,
    };
}

/** Finds as the bridge answered them, cleaned; null when they are no finds at all. */
export function sanitizeFinds(value: unknown): DeviceFinds | null {
    const r = asRecord(value);
    if (!r || !Array.isArray(r.groups)) return null;
    const cut = count(r.cut);
    const earlier = time(r.earlier);
    return {
        since: time(r.since) ?? '',
        groups: list(r.groups, MAX_GROUPS).map(cleanFindGroup).filter((x): x is DeviceFindGroup => !!x),
        ...(cut ? { cut } : {}),
        ...(earlier ? { earlier } : {}),
    };
}

/** People found by a name (`{people: […]}`, or the list itself), cleaned: at most 8. */
export function sanitizePeopleHits(value: unknown): DevicePersonHit[] {
    const all = Array.isArray(value) ? value : asRecord(value)?.people;
    const out: DevicePersonHit[] = [];
    for (const x of list(all, PEOPLE_SEARCH_MAX * 4)) {
        const r = asRecord(x);
        const pid = personId(r?.id);
        if (!r || !pid || out.some((p) => p.id === pid)) continue;
        const span = optText(r.span, 40);
        const place = optText(r.place, MAX_NAME);
        out.push({ id: pid, name: text(r.name, MAX_NAME) || pid, ...(span ? { span } : {}), ...(place ? { place } : {}) });
        if (out.length >= PEOPLE_SEARCH_MAX) break;
    }
    return out;
}

// ——— reading through the gateway ———

/**
 * Reads of the bridge: a connection that fails (the gateway unreachable,
 * unpaired…) throws the gateway's error; an answer that is not one (an older
 * research's 404, a refusal, broken JSON) is null.
 */
async function readJson(path: string, treeId: string, signal?: AbortSignal | null): Promise<unknown> {
    const res = await deviceFetch(path, { tree: treeId, ...(signal ? { signal } : {}) });
    if (!res.ok) return null;
    try {
        return await res.json();
    } catch {
        return null;
    }
}

/** The research's features for a tree (its `/status`); none when it gives no status. */
export async function readDeviceResearchFeatures(treeId: string, signal?: AbortSignal | null): Promise<DeviceResearchFeatures> {
    return deviceResearchFeatures(await readJson('status', treeId, signal));
}

/** A tree's glance (feature `glance`). */
export async function readGlance(treeId: string, signal?: AbortSignal | null): Promise<DeviceGlance | null> {
    return sanitizeGlance(await readJson('glance', treeId, signal));
}

/** The path of the finds asked: since a moment (none: the last 24 hours), the facts named in `lang`. */
export function findsPath(o: { since?: string | null; lang?: string | null } = {}): string {
    const q = new URLSearchParams();
    const since = time(o.since);
    if (since) q.set('since', since);
    const lang = id(o.lang, 20);
    if (lang) q.set('lang', lang);
    const s = q.toString();
    return s ? `finds?${s}` : 'finds';
}

/** A tree's finds (feature `finds`): since `since` (none: the last 24 hours), facts named in the app's language. */
export async function readFinds(treeId: string, o: { since?: string | null; lang?: string | null; signal?: AbortSignal | null } = {}): Promise<DeviceFinds | null> {
    return sanitizeFinds(await readJson(findsPath(o), treeId, o.signal));
}

/** Whether a name asked for is one the bridge searches (two letters or digits at least). */
export function peopleQueryOk(q: string): boolean {
    return (q.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2;
}

/** People of a tree by a name (feature `people.search`): at most 8; a query too short asks nothing. */
export async function searchPeople(treeId: string, q: string, signal?: AbortSignal | null): Promise<DevicePersonHit[]> {
    const query = q.trim().slice(0, 200);
    if (!peopleQueryOk(query)) return [];
    return sanitizePeopleHits(await readJson(`people?${new URLSearchParams({ q: query }).toString()}`, treeId, signal));
}

// ——— the last state kept (§8, D6) ———

/** What the Research screen showed last for a tree: kept on the device, shown without a connection. */
export interface DeviceResearchState {
    /** When it was read (ISO). */
    at: string;
    glance: DeviceGlance | null;
    finds: DeviceFinds | null;
}

/** A state as kept, cleaned again when read back (a state of an older app, a broken one: null). */
export function sanitizeResearchState(value: unknown): DeviceResearchState | null {
    const r = asRecord(value);
    const at = time(r?.at);
    if (!r || !at) return null;
    const glance = r.glance === null || r.glance === undefined ? null : sanitizeGlance(r.glance);
    const finds = r.finds === null || r.finds === undefined ? null : sanitizeFinds(r.finds);
    return glance || finds ? { at, glance, finds } : null;
}

/** The last state of a tree's research kept on this device, or null. */
export async function heldResearchState(treeId: string): Promise<DeviceResearchState | null> {
    return sanitizeResearchState(await loadResearchState(treeId));
}

/** A state kept for a tree (a storage that fails keeps nothing: the screen still shows it). */
export async function keepResearchState(treeId: string, state: DeviceResearchState): Promise<void> {
    await saveResearchState(treeId, state).catch(() => undefined);
}

/**
 * The Research screen's data of a tree read now (what the features offer),
 * kept as its last state and returned. A part the research does not offer is
 * null; a part it offers but did not answer keeps the state held before. The
 * connection failing throws (the screen shows the held state).
 * `findsSince`: undefined asks since the finds were last seen here (none: the
 * last 24 hours); null asks the last 24 hours.
 */
export async function readDeviceResearch(treeId: string, o: {
    features: DeviceResearchFeatures;
    lang?: string | null;
    findsSince?: string | null;
    signal?: AbortSignal | null;
    now?: () => Date;
}): Promise<DeviceResearchState> {
    const since = o.findsSince === undefined ? await findsSeenAt(treeId) : o.findsSince;
    const [glance, finds] = await Promise.all([
        o.features.glance ? readGlance(treeId, o.signal) : Promise.resolve(null),
        o.features.finds ? readFinds(treeId, { since, lang: o.lang, signal: o.signal }) : Promise.resolve(null),
    ]);
    const held = (o.features.glance && !glance) || (o.features.finds && !finds) ? await heldResearchState(treeId) : null;
    const state: DeviceResearchState = {
        at: (o.now?.() ?? new Date()).toISOString(),
        glance: glance ?? (o.features.glance ? held?.glance ?? null : null),
        finds: finds ?? (o.features.finds ? held?.finds ?? null : null),
    };
    if (state.glance || state.finds) await keepResearchState(treeId, state);
    return state;
}

// ——— the live events ———

/** Why the screen reads again: the research changed, an agent began or ended its work, the connection came back. */
export type DeviceResearchRefresh = 'change' | 'working' | 'back';

/** The bridge's events that change what the screen shows (`hello`: the stream (re)opened). */
const REFRESH_EVENTS: Record<string, DeviceResearchRefresh> = { change: 'change', working: 'working', hello: 'back' };

/**
 * `onRefresh` called when the research of `treeId` changed (its bridge's live
 * events through the gateway: a commit, an agent's work, the stream opened
 * again) — at most once per `minGapMs`, `delayMs` after the first event of a
 * burst (an agent at work commits often). Only while `treeId` is the device's
 * chosen tree (the stream is of that tree). Returns the unsubscribe.
 */
export function watchDeviceResearch(treeId: string, onRefresh: (why: DeviceResearchRefresh) => void, o: { delayMs?: number; minGapMs?: number } = {}): () => void {
    const delayMs = o.delayMs ?? 400;
    const minGapMs = o.minGapMs ?? 3000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: DeviceResearchRefresh | null = null;
    let lastAt = -Infinity;
    let stopped = false;
    let wasConnected = deviceConnection()?.state === 'connected';
    const fire = (): void => {
        timer = null;
        if (stopped || !pending) return;
        const why = pending;
        pending = null;
        lastAt = Date.now();
        try { onRefresh(why); } catch { /* the screen's own */ }
    };
    const ask = (why: DeviceResearchRefresh): void => {
        if (stopped || chosenTreeId() !== treeId) return;
        // a connection back outweighs a change, a change a working
        if (!pending || why === 'back' || (why === 'change' && pending === 'working')) pending = why;
        if (timer) return;
        timer = setTimeout(fire, Math.max(delayMs, lastAt + minGapMs - Date.now()));
    };
    const offEvent = onDeviceEvent((e) => {
        const why = REFRESH_EVENTS[e.event];
        if (why) ask(why);
    });
    const offConn = onDeviceConnection((c) => {
        const connected = c.state === 'connected';
        if (connected && !wasConnected) ask('back');
        wasConnected = connected;
    });
    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        timer = null;
        offEvent();
        offConn();
    };
}
