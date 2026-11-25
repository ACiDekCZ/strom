/**
 * The phone's Research screen (spec 094 K3.13): on a phone in the device mode
 * the app opens on what the research does now — Now, Waiting, Finds, Lines,
 * "Progress and queue ›" and the dock for photos — read from the research's
 * bridge (device-research-data.ts) before the tree is on the device. The tree
 * comes only when asked for (Family, Table, "Show in the tree"): downloaded
 * with its progress over the dock, or the copy held here at once
 * (`phoneOpenTree`). Back from the tree returns to this screen, the tree kept.
 *
 * Only a phone (`MQ_PHONE_BAR`) in the device mode, whose research offers the
 * screen's data (`glance`) or whose last state is held here; a tablet, a second
 * computer and the app elsewhere are as before.
 *
 * This module must never reach the tree (DataManager), the renderer or the
 * person picker, even through another module (device-research-imports.test.ts):
 * whatever needs the tree is asked through the UI (`this.…`), whose type only
 * is imported.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { uiModule } from './module.js';
import { MQ_PHONE_BAR } from '../breakpoints.js';
import { chosenTreeId, chooseTree, computerLabelOf, findsSeenAt, markFindsSeen, pairingNow } from '../device/device-store.js';
import { retryDeviceConnection } from '../device/device-connection.js';
import {
    heldResearchState, readDeviceResearch, readDeviceResearchFeatures, readFinds, watchDeviceResearch,
    type DeviceFindGroup, type DeviceFindLine, type DeviceFinds,
    type DeviceGlance, type DeviceGlanceLine, type DeviceGlanceNow, type DeviceResearchFeatures, type DeviceResearchState, type DeviceWay,
} from '../device/device-research-data.js';
import { deviceBridgeBase, researchDeviceAllows } from '../research-link.js';
import { setDirectionState, writeDirectionOrder, type BridgeWriteResult, type DirectionStateDo } from '../research-directions-write.js';
import { postRunStop } from '../research-runs-write.js';
import { formatLiveClock } from '../live-time.js';
import type { ViewMode } from '../types.js';

export const PHONE_RESEARCH_ID = 'phone-research';
export const PHONE_DOCK_ID = 'phone-dock';
/** The body's class while the screen is what is seen. */
export const PHONE_RESEARCH_ON = 'phone-research-on';
/** The body's class while the screen is offered (the bar's Research tab, Descendants under More). */
export const PHONE_RESEARCH_READY = 'phone-research-ready';
/** The history entry of the tree opened from the screen (Back returns to the screen). */
export const PHONE_TREE_STATE = 'tree';

/** How long the start waits for the research's features before it decides (then the tree opens as before). */
const FEATURES_WAIT_MS = 4000;

/** The sections of the screen, top to bottom on a phone held upright (§1 point 1). */
export const PHONE_SECTIONS = ['now', 'waiting', 'finds', 'lines'] as const;
export type PhoneSection = typeof PHONE_SECTIONS[number];
/** Held sideways (§1 point 6): Now and Waiting on the left, Finds, Lines and the dock on the right. */
export const PHONE_COLUMNS: Record<PhoneSection, 'a' | 'b'> = { now: 'a', waiting: 'a', finds: 'b', lines: 'b' };

/** The bottom bar's items (§1 point 3, variant A). */
export type PhoneBarItem = 'research' | 'family' | 'descendants' | 'add' | 'table' | 'more';

/**
 * The bottom bar's items for where the app runs: a phone in the device mode whose research offers the screen has
 * Research | Family | (+) | Table | More (Descendants under More); anything else Family | Descendants | (+) | Table | More.
 */
export function phoneBarItems(o: { deviceMode: boolean; phone: boolean; offered: boolean }): PhoneBarItem[] {
    return o.deviceMode && o.phone && o.offered
        ? ['research', 'family', 'add', 'table', 'more']
        : ['family', 'descendants', 'add', 'table', 'more'];
}

/** Whether the Research screen stands first for a tree: its research gives the screen's data, or its last state is held here. */
export function phoneScreenFor(o: { features: DeviceResearchFeatures | null; held: boolean }): boolean {
    return !!o.features?.glance || o.held;
}

/** Where the tree is opened to from the screen (§7): a view, a person (P…, the research's ID), the overview over the screen. */
export interface PhoneTreeTarget {
    view?: ViewMode;
    person?: string;
    overview?: boolean;
}

/** What opening the tree came to (`deviceOpenPhoneTree`). */
export type PhoneTreeOpen = 'open' | 'cancel' | 'failed' | 'offline';

let screenTreeId: string | null = null;
let features: DeviceResearchFeatures | null = null;
let shownState: DeviceResearchState | null = null;
/** The screen's tree's last read failed (no connection): the held state is shown. */
let readFailed = false;
let unwatch: (() => void) | null = null;
let reading: AbortController | null = null;
/** The trees opened here since the page opened, or held here (no "downloaded when opened" for them). */
const treesOpened = new Set<string>();
/** The tree's opening on its way (one at a time). */
let opening: Promise<boolean> | null = null;
/** Where each column was scrolled when the screen went (kept while the app is open). */
const scrollKept: Record<'main' | 'a' | 'b', number> = { main: 0, a: 0, b: 0 };
let phoneQuery: MediaQueryList | null = null;
let historyWatched = false;
let dockObserver: ResizeObserver | null = null;

/** The phone's media query (a phone either way up), or null where there is none. */
function phoneMedia(): MediaQueryList | null {
    if (phoneQuery) return phoneQuery;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
    phoneQuery = window.matchMedia(MQ_PHONE_BAR);
    return phoneQuery;
}

/** The viewport is a phone's (≤ 640 px, or a phone held sideways). */
export function phoneViewport(): boolean {
    return phoneMedia()?.matches ?? false;
}

/** Follow the phone's media query (each change calls `onChange`); once. */
export function watchPhoneViewport(onChange: () => void): void {
    const mq = phoneMedia();
    if (!mq || (mq as MediaQueryList & { __phoneWatched?: boolean }).__phoneWatched) return;
    (mq as MediaQueryList & { __phoneWatched?: boolean }).__phoneWatched = true;
    mq.addEventListener?.('change', onChange);
}

/** The Research screen is what is seen now. */
export function phoneResearchShown(): boolean {
    return typeof document !== 'undefined' && document.body.classList.contains(PHONE_RESEARCH_ON);
}

/** The screen is offered (a phone in the device mode, its research giving the screen's data). */
export function phoneResearchReady(): boolean {
    return typeof document !== 'undefined' && document.body.classList.contains(PHONE_RESEARCH_READY)
        && document.body.classList.contains('device-mode') && document.body.classList.contains('device-phone');
}

/** The tree of the screen (the device's chosen tree, as switched on the screen). */
export function phoneResearchTreeId(): string | null {
    return screenTreeId ?? chosenTreeId();
}

/** A tree opened here (or held here): the dock's "downloaded when opened" goes. */
export function notePhoneTreeOpened(treeId: string): void {
    treesOpened.add(treeId);
}

function computerName(): string {
    return computerLabelOf(pairingNow()?.computer);
}

/** The section's element (its body is where the section's rows go: appendPhoneNow…). */
function sectionEl(screen: HTMLElement, key: PhoneSection): { sec: HTMLElement; head: HTMLElement; sum: HTMLElement; body: HTMLElement } | null {
    const sec = screen.querySelector<HTMLElement>(`.phone-sec[data-sec="${key}"]`);
    const head = sec?.querySelector<HTMLElement>('.phone-sec__title');
    const sum = sec?.querySelector<HTMLElement>('.phone-sec__sum');
    const body = sec?.querySelector<HTMLElement>('.phone-sec__body');
    return sec && head && sum && body ? { sec, head, sum, body } : null;
}

/** The sections whose rows are kept by their keys across a render (only their texts change). */
const KEYED_SECTIONS: ReadonlySet<PhoneSection> = new Set<PhoneSection>(['now', 'finds', 'lines']);

/** One quiet sentence in a section's body (an empty section, §8 point 8). */
function quiet(body: HTMLElement, text: string): void {
    const p = document.createElement('p');
    p.className = 'phone-sec__quiet';
    p.textContent = text;
    body.append(p);
}

const CHEVRON = '<svg class="phone-research__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

// ——— Now and Lines (§2, §3) ———

/** The glyph of a line's way: ↑ ancestors, ↓ descendants, ? a person or a question. */
export function wayGlyph(way: DeviceWay): string {
    return way === 'up' ? '↑' : way === 'down' ? '↓' : '?';
}

/** How a line is moved in the order of work (§3 point 2). */
export type PhoneLineMove = 'up' | 'down' | 'first';

/** The order of work (line IDs) after `id` is moved; null when the move changes nothing (or the line is not there). */
export function movedLineOrder(ids: readonly string[], id: string, move: PhoneLineMove): string[] | null {
    const i = ids.indexOf(id);
    if (i < 0) return null;
    const to = move === 'up' ? i - 1 : move === 'down' ? i + 1 : 0;
    if (to < 0 || to >= ids.length || to === i) return null;
    const out = ids.filter(x => x !== id);
    out.splice(to, 0, id);
    return out;
}

/**
 * The lines in the order of work, numbered again from 1: by `order` when given (a move on its way; lines it does
 * not name keep their order after it), else by the research's own numbers.
 */
export function linesInOrder(lines: readonly DeviceGlanceLine[], order: readonly string[] | null = null): DeviceGlanceLine[] {
    const sorted = [...lines].sort((a, b) => a.n - b.n);
    if (order) {
        const at = new Map(order.map((id, i) => [id, i] as const));
        const rank = (l: DeviceGlanceLine): number => at.get(l.id) ?? order.length + sorted.indexOf(l);
        sorted.sort((a, b) => rank(a) - rank(b));
    }
    return sorted.map((l, i) => (l.n === i + 1 ? l : { ...l, n: i + 1 }));
}

/** Now's heading: "Now · n lines" when more than one line is worked on, else "Now". */
export function phoneNowTitle(now: readonly DeviceGlanceNow[]): string {
    const r = strings.deviceResearch;
    const lines = new Set(now.map(n => n.line ?? '')).size;
    return lines > 1 ? r.nowTitleLines(lines) : r.nowTitle;
}

/** What a row of Now says under its task: stopping, paused until a time, or working since a time. */
export function phoneNowMeta(n: DeviceGlanceNow, o: { stopping: boolean; lang: string; now?: number }): string {
    const r = strings.deviceResearch;
    if (o.stopping) return r.nowStopping;
    const at = o.now ?? Date.now();
    const clock = (iso: string): string => formatLiveClock(Date.parse(iso), at, o.lang);
    return n.paused ? r.nowPaused(clock(n.paused.until)) : r.nowSince(clock(n.since));
}

/** What Now says when nobody works (§2 point 4): never worked on, or nothing now and when it was worked on last. */
export function phoneNowIdle(g: DeviceGlance | null, o: { lang: string; now?: number }): { kind: 'never' } | { kind: 'idle'; last: string } | null {
    if (g?.now.length) return null;
    if (!g?.lastWorked) return { kind: 'never' };
    return { kind: 'idle', last: strings.live.lastWorked(formatLiveClock(Date.parse(g.lastWorked), o.now ?? Date.now(), o.lang), '') };
}

/** Whether a refusal of a line's write is the research being written just now (409, 503): "linesBusy" under the list. */
export function lineWriteBusy(r: BridgeWriteResult<object>): boolean {
    return !r.ok && (r.status === 409 || r.status === 503);
}

/**
 * The quiet sentences of what stays on the computer for now (spec 094 K3.15: the device starts the agent later, in
 * U19b, where each of these becomes a button). One place, so U19b replaces them here.
 */
export type PhoneComputerOnly = 'line-work' | 'batch-sort' | 'conflict';
export function phoneComputerOnlyNote(kind: PhoneComputerOnly, pc: string): string {
    switch (kind) {
        case 'line-work': return strings.device.dirWorkOnComputer(pc);
        case 'batch-sort': return strings.batch.sortOnComputer;
        case 'conflict': return strings.deviceResearch.conflictOnComputer(pc);
    }
}

// ——— Finds (§4) ———

/** At most this many lines of a group on the screen; the rest says "and n more". */
export const FIND_GROUP_LINES = 3;
/** How long Finds stay in view before what they show counts as seen here. */
export const FINDS_SEEN_MS = 2000;
/** How far back "Show older finds" reads (the bridge goes no further). */
const FINDS_OLDER_DAYS = 31;
/** How much of Finds is to be in view (px; a shorter section: all of it) for them to count as seen. */
const FINDS_VIEW_PX = 96;

function isoMs(iso: string | null | undefined): number {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) ? t : NaN;
}

/** Whether a find is newer than the finds last seen here (nothing seen yet: every find is). */
export function findIsNew(at: string, seenAt: string | null): boolean {
    const t = isoMs(at);
    if (!Number.isFinite(t)) return false;
    const seen = isoMs(seenAt);
    return !Number.isFinite(seen) || t > seen;
}

/**
 * What the finds are asked since, by when they were last seen here: just after it (the bridge's window holds its
 * start, and what was seen is not new); nothing seen yet: null (the last 24 hours).
 */
export function findsWindowSince(seenAt: string | null): string | null {
    const t = isoMs(seenAt);
    return Number.isFinite(t) ? new Date(t + 1).toISOString() : null;
}

/** The newest moment of the finds (ISO), or '' when there is none. */
export function newestFindAt(finds: DeviceFinds | null | undefined): string {
    let best = '';
    let bestMs = -Infinity;
    for (const g of finds?.groups ?? []) {
        for (const at of [g.at, ...g.lines.map(l => l.at)]) {
            const t = isoMs(at);
            if (Number.isFinite(t) && t > bestMs) {
                bestMs = t;
                best = at;
            }
        }
    }
    return best;
}

/** The heading's quiet summary: since the finds were last seen here, or (nothing seen yet) the last 24 hours. */
export function phoneFindsSummary(seenAt: string | null, o: { lang: string; now?: number }): string {
    const r = strings.deviceResearch;
    const t = isoMs(seenAt);
    return Number.isFinite(t) ? r.findsSince(formatLiveClock(t, o.now ?? Date.now(), o.lang)) : r.findsDay;
}

/** A name with its years in brackets ("Jan Lhoták (1851–1919)", as the research writes it) without them. */
function withoutSpan(text: string, span: string | undefined): string {
    const tail = span ? ` (${span})` : '';
    return tail && text.endsWith(tail) ? text.slice(0, -tail.length) : text;
}

/** A group's heading: a person or a family by its name (serif) with the years, sources and resolved by the app's words. */
export interface PhoneFindHead {
    name: string;
    years?: string;
    /** Sources and resolved: the app's own heading, sans-serif. */
    plain: boolean;
}

export function phoneFindHead(g: DeviceFindGroup): PhoneFindHead {
    const r = strings.deviceResearch;
    if (g.kind === 'sources') return { name: r.findsSources, plain: true };
    if (g.kind === 'resolved') return { name: r.findsResolved, plain: true };
    const name = g.kind === 'person' ? (g.name || withoutSpan(g.title ?? '', g.span)) : (g.title || g.name || '');
    return { name, ...(g.span ? { years: g.span } : {}), plain: false };
}

/** What a line of finds says: a quiet prefix (its kind), the record's words, a quiet suffix ("· corrected"). */
export interface PhoneFindText {
    prefix?: string;
    text: string;
    suffix?: string;
}

export function phoneFindText(l: DeviceFindLine, g: DeviceFindGroup): PhoneFindText {
    const r = strings.deviceResearch;
    const head = phoneFindHead(g);
    const named = (): string => (head.plain ? '' : head.years ? `${head.name} · ${head.years}` : head.name);
    switch (l.kind) {
        case 'person':
        case 'family':
            return { prefix: r.findPerson, text: l.text || named() };
        case 'name':
            return { prefix: r.findName, text: l.text };
        case 'child': {
            const name = withoutSpan(l.text, l.span);
            return { prefix: r.findChild, text: l.span ? `${name} · ${l.span}` : name };
        }
        case 'fact':
        case 'fixed':
        case 'cited': {
            const text = l.fact?.what && l.fact.name ? `${l.fact.name} · ${l.fact.what}` : l.text;
            const suffix = l.kind === 'fixed' ? r.findFixed : l.kind === 'cited' ? r.findCited : undefined;
            return { text, ...(suffix ? { suffix } : {}) };
        }
        case 'source':
            // Under "New sources" the heading says it already.
            return g.kind === 'sources' ? { text: l.text } : { prefix: r.findSource, text: l.text };
        case 'conflict':
            return { prefix: r.findConflict, text: l.text };
        case 'hypothesis':
            return { prefix: r.findQuestion, text: l.text, ...(l.decided ? { suffix: r.findDecided(l.decided) } : {}) };
    }
}

/** A group's lines newest first: at most `max` of them, and how many more there are. */
export function phoneFindLines(g: DeviceFindGroup, max: number = FIND_GROUP_LINES): { lines: DeviceFindLine[]; more: number } {
    const sorted = [...g.lines].sort((a, b) => (isoMs(b.at) || 0) - (isoMs(a.at) || 0));
    return { lines: sorted.slice(0, max), more: Math.max(0, sorted.length - max) };
}

/** The groups newest first. */
export function phoneFindGroups(groups: readonly DeviceFindGroup[]): DeviceFindGroup[] {
    return [...groups].sort((a, b) => (isoMs(b.at) || 0) - (isoMs(a.at) || 0));
}

/**
 * The older finds read on "Show older finds" that the list does not show yet: only their lines before `before`
 * (the start of the window shown), each group's moment its newest such line; groups left with none go.
 */
export function olderFindGroups(older: DeviceFinds, before: string): DeviceFindGroup[] {
    const limit = isoMs(before);
    const out: DeviceFindGroup[] = [];
    for (const g of older.groups) {
        const lines = Number.isFinite(limit) ? g.lines.filter(l => isoMs(l.at) < limit) : g.lines;
        if (!lines.length) continue;
        out.push({ ...g, lines, at: newestFindAt({ since: '', groups: [{ ...g, at: '', lines }] }) || g.at });
    }
    return phoneFindGroups(out);
}

/** How many lines of `next` are newer than all of `prev` (the finds that came while the screen ran). */
export function findsArrived(prev: DeviceFinds | null | undefined, next: DeviceFinds | null | undefined): number {
    const last = isoMs(newestFindAt(prev));
    if (!Number.isFinite(last)) return 0;
    let n = 0;
    for (const g of next?.groups ?? []) for (const l of g.lines) if (isoMs(l.at) > last) n++;
    return n;
}

/** Since when the detail of a group counts its finds: the window shown when all its lines are in it, else its oldest line. */
export function findGroupSince(g: DeviceFindGroup, windowSince: string | null): string {
    const w = isoMs(windowSince);
    const oldest = g.lines.reduce((a, l) => (isoMs(l.at) < isoMs(a) || !a ? l.at : a), '');
    return Number.isFinite(w) && g.lines.every(l => isoMs(l.at) >= w) ? windowSince! : oldest;
}

/** A stop asked here for a run, until the research says it finishes (or it is gone). */
const stopsAsked = new Set<string>();
/** A move of the order of work on its way (the list shown in it at once); null: none. */
let orderMoving: string[] | null = null;
/** The research refused the last write of the lines as being written just now: "linesBusy" until a write goes. */
let linesBusy = false;

/** The finds' window of each tree for this page's life: since they were last seen when the screen first read them (null: the last 24 hours). */
const findsWindow = new Map<string, string | null>();
/** When the screen's tree's finds were last seen here: the dots "new" are of the finds after it. */
let findsSeen: string | null = null;
/** The tree `findsSeen` is of (null: not read yet). */
let findsSeenOf: string | null = null;
/** The older finds read on "Show older finds" (until the tree changes or the page goes). */
let olderFinds: { treeId: string; finds: DeviceFinds } | null = null;
let olderReading = false;
/** The lines of finds that came while the screen ran with Finds out of view ("n new ↓"). */
let findsCame = 0;
/** What the screen shows was read while it was seen: a later read's newer finds came while it ran. */
let readWhileShown = false;
let findsObserver: IntersectionObserver | null = null;
let findsInView = false;
let seenTimer: ReturnType<typeof setTimeout> | null = null;

/** The section's element shape (appendPhoneNow…). */
type PhoneSectionEl = { sec: HTMLElement; head: HTMLElement; sum: HTMLElement; body: HTMLElement };

/** A keyed child of a section's body: kept across live changes (only its texts change, nothing flashes). */
interface KeyedRow {
    key: string;
    make: () => HTMLElement;
    fill: (el: HTMLElement) => void;
}

/** The body's children by `rows` (each kept by its key, only its texts rewritten); anything else goes. */
function syncRows(body: HTMLElement, rows: readonly KeyedRow[]): void {
    const old = new Map<string, HTMLElement>();
    for (const c of Array.from(body.children) as HTMLElement[]) {
        if (c.dataset.key) old.set(c.dataset.key, c);
    }
    const next = rows.map((row) => {
        const el = old.get(row.key) ?? row.make();
        el.dataset.key = row.key;
        row.fill(el);
        return el;
    });
    const keep = new Set(next);
    for (const c of Array.from(body.children)) if (!keep.has(c as HTMLElement)) c.remove();
    next.forEach((el, i) => {
        if (body.children[i] !== el) body.insertBefore(el, body.children[i] ?? null);
    });
}

/** Text set only when it changed. */
function setText(el: Element | null, text: string): void {
    if (el && el.textContent !== text) el.textContent = text;
}

/** A quiet sentence as a keyed row. */
function quietRow(key: string, text: string, cls = 'phone-sec__quiet'): KeyedRow {
    return {
        key,
        make: () => {
            const p = document.createElement('p');
            p.className = cls;
            return p;
        },
        fill: el => setText(el, text),
    };
}

/** A row of Now or Lines: (number), glyph, name, task, meta, ⋯ (44 px). */
function makeLineRow(act: 'now-menu' | 'line-menu', numbered: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = `phone-line${numbered ? ' phone-line--num' : ''}`;
    row.dataset.act = act;
    row.innerHTML = `${numbered ? '<span class="phone-line__n"></span>' : ''}<span class="phone-line__glyph" aria-hidden="true"></span>`
        + '<div class="phone-line__main"><span class="phone-line__name"></span><span class="phone-line__task"></span>'
        + '<span class="phone-line__meta"><span class="phone-line__meta-text"></span><span class="phone-line__chip"></span></span></div>'
        + '<button type="button" class="phone-line__more" aria-haspopup="menu">⋯</button>';
    return row;
}

function fillLineRow(row: HTMLElement, o: { n?: number; way: DeviceWay; name: string; task?: string; meta: string; chip?: string; off?: boolean; menu: string }): void {
    if (o.n !== undefined) setText(row.querySelector('.phone-line__n'), String(o.n));
    setText(row.querySelector('.phone-line__glyph'), wayGlyph(o.way));
    setText(row.querySelector('.phone-line__name'), o.name);
    const task = row.querySelector<HTMLElement>('.phone-line__task');
    if (task) {
        setText(task, o.task ?? '');
        task.hidden = !o.task;
    }
    setText(row.querySelector('.phone-line__meta-text'), o.meta);
    const chip = row.querySelector<HTMLElement>('.phone-line__chip');
    if (chip) {
        setText(chip, o.chip ?? '');
        chip.hidden = !o.chip;
    }
    row.classList.toggle('is-off', !!o.off);
    const more = row.querySelector<HTMLElement>('.phone-line__more');
    if (more && more.getAttribute('aria-label') !== o.menu) more.setAttribute('aria-label', o.menu);
}

/** A find's words into `el`: its quiet prefix, the record's words, its quiet suffix. */
function fillFindText(el: HTMLElement, t: PhoneFindText): void {
    const parts: Node[] = [];
    if (t.prefix) {
        const k = document.createElement('span');
        k.className = 'phone-find__k';
        k.textContent = t.prefix;
        parts.push(k, document.createTextNode(' '));
    }
    parts.push(document.createTextNode(t.text));
    if (t.suffix) {
        const k = document.createElement('span');
        k.className = 'phone-find__k';
        k.textContent = ` · ${t.suffix}`;
        parts.push(k);
    }
    el.replaceChildren(...parts);
}

/** A moment of the finds as Now says it: the time today, the day and time before. */
function findClock(iso: string, lang: string): string {
    const t = isoMs(iso);
    return Number.isFinite(t) ? formatLiveClock(t, Date.now(), lang) : '';
}

/** A group of finds on the screen (a button: its detail in a sheet): heading, time, at most three lines, "and n more". */
function findGroupRow(key: string, g: DeviceFindGroup, seenAt: string | null, older: boolean, dots = !older): KeyedRow {
    return {
        key,
        make: () => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'phone-find';
            b.dataset.act = 'find-group';
            b.setAttribute('aria-haspopup', 'dialog');
            return b;
        },
        fill: (b) => {
            const lang = getCurrentLanguage();
            const head = phoneFindHead(g);
            const { lines, more } = phoneFindLines(g);
            const shown = lines.map(l => ({ t: phoneFindText(l, g), fresh: dots && findIsNew(l.at, seenAt) }));
            const at = findClock(g.at, lang);
            const sig = JSON.stringify([head, at, shown, more, lang]);
            b.dataset.group = g.key;
            b.dataset.older = older ? '1' : '';
            if (b.dataset.sig === sig) return;
            b.dataset.sig = sig;
            const h = document.createElement('span');
            h.className = `phone-find__head${head.plain ? ' is-plain' : ''}`;
            const name = document.createElement('span');
            name.className = 'phone-find__name';
            name.textContent = head.name;
            h.append(name);
            if (head.years) {
                const years = document.createElement('span');
                years.className = 'phone-find__years';
                years.textContent = head.years;
                h.append(years);
            }
            const time = document.createElement('span');
            time.className = 'phone-find__at';
            time.textContent = at;
            h.append(time);
            const rows: HTMLElement[] = shown.map(({ t, fresh }) => {
                const line = document.createElement('span');
                line.className = 'phone-find__line';
                const dot = document.createElement('span');
                dot.className = `phone-find__dot${fresh ? ' is-new' : ''}`;
                if (fresh) {
                    dot.setAttribute('role', 'img');
                    dot.setAttribute('aria-label', strings.deviceResearch.findNew);
                } else dot.setAttribute('aria-hidden', 'true');
                const text = document.createElement('span');
                text.className = 'phone-find__text';
                fillFindText(text, t);
                line.append(dot, text);
                return line;
            });
            if (more) {
                const m = document.createElement('span');
                m.className = 'phone-find__more';
                m.textContent = strings.deviceResearch.findsGroupMore(more);
                rows.push(m);
            }
            b.replaceChildren(h, ...rows);
        },
    };
}

/** A quiet link-like button as a keyed row ("Show older finds"). */
function linkRow(key: string, act: string, text: string, busy: boolean): KeyedRow {
    return {
        key,
        make: () => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'phone-sec__link';
            b.dataset.act = act;
            return b;
        },
        fill: (b) => {
            setText(b, text);
            b.toggleAttribute('aria-busy', busy);
            (b as HTMLButtonElement).disabled = busy;
        },
    };
}

/** The scrolled part of the screen and the first kept element at its top (to keep it where it is across a render). */
function scrollAnchor(screen: HTMLElement): { box: HTMLElement; el: HTMLElement; top: number } | null {
    for (const box of Array.from(screen.querySelectorAll<HTMLElement>('[data-scroll]'))) {
        if (box.scrollTop <= 0 || box.scrollHeight <= box.clientHeight) continue;
        const top = box.getBoundingClientRect().top;
        for (const el of Array.from(box.querySelectorAll<HTMLElement>('.phone-sec__head, [data-key]'))) {
            const r = el.getBoundingClientRect();
            if (r.height > 0 && r.top >= top) return { box, el, top: r.top };
        }
    }
    return null;
}

/** What was under the finger stays there: rows put in above it move the scroll by as much (no overflow-anchor everywhere). */
function keepScrollAnchor(a: { box: HTMLElement; el: HTMLElement; top: number } | null): void {
    if (!a || !a.el.isConnected) return;
    const moved = a.el.getBoundingClientRect().top - a.top;
    if (Math.abs(moved) >= 1) a.box.scrollTop += moved;
}


export const phoneResearchMethods = uiModule({
    /** The Research screen is what is seen now. */
    phoneResearchActive(): boolean {
        return phoneResearchShown();
    },

    /**
     * At the device's start (and a tree chosen): on a phone whose research gives the screen's data (or whose last
     * state is held here), the screen instead of the tree — nothing downloaded. False: the tree opens as before.
     */
    async phoneResearchFirst(treeId: string): Promise<boolean> {
        if (!document.body.classList.contains('device-phone')) return false;
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), FEATURES_WAIT_MS) : undefined;
        let said: DeviceResearchFeatures | null = null;
        try {
            said = await readDeviceResearchFeatures(treeId, ctl?.signal ?? null);
        } catch { /* no connection: the state held here decides */ } finally {
            if (timer !== undefined) clearTimeout(timer);
        }
        const held = said?.glance ? null : await heldResearchState(treeId).catch(() => null);
        if (!phoneScreenFor({ features: said, held: !!held })) return false;
        screenTreeId = treeId;
        features = said;
        if (held) shownState = held;
        if (this.deviceTreeHeldHere(treeId)) treesOpened.add(treeId);
        document.body.classList.add(PHONE_RESEARCH_READY);
        this.watchPhoneHistory();
        return true;
    },

    /** The Research screen shown (over the tree, which stays as it is): its data read again, the bar's Research marked. */
    showPhoneResearch(): void {
        if (!phoneResearchReady()) return;
        let screen = document.getElementById(PHONE_RESEARCH_ID);
        if (!screen) screen = this.buildPhoneResearch();
        screen.hidden = false;
        document.body.classList.add(PHONE_RESEARCH_ON);
        // The home-screen icon's quiet line stands under the screen's header (§8 point 6).
        const line = document.getElementById('device-home-line');
        if (line && line.parentElement !== screen) screen.prepend(line);
        this.syncPhoneBar();
        this.updateTreeSwitcher();
        readWhileShown = false;
        findsCame = 0;
        this.renderPhoneResearch();
        for (const k of ['main', 'a', 'b'] as const) {
            const el = screen.querySelector<HTMLElement>(`[data-scroll="${k}"]`);
            if (el) el.scrollTop = scrollKept[k];
        }
        this.watchPhoneResearchData();
        void this.refreshPhoneResearch();
    },

    /** The screen goes (the tree is seen): where it was scrolled kept, the live reads stopped. */
    hidePhoneResearch(): void {
        const screen = document.getElementById(PHONE_RESEARCH_ID);
        if (screen) {
            for (const k of ['main', 'a', 'b'] as const) {
                const el = screen.querySelector<HTMLElement>(`[data-scroll="${k}"]`);
                if (el) scrollKept[k] = el.scrollTop;
            }
            screen.hidden = true;
            const line = document.getElementById('device-home-line');
            if (line && line.parentElement === screen) document.body.append(line);
        }
        document.body.classList.remove(PHONE_RESEARCH_ON);
        if (seenTimer) clearTimeout(seenTimer);
        seenTimer = null;
        unwatch?.();
        unwatch = null;
        reading?.abort();
        reading = null;
        this.syncPhoneBar();
        this.updateTreeSwitcher();
        this.updateViewModeUI();
    },

    /** The screen's frame: the columns, each section's heading and body, "Progress and queue ›", the dock. */
    buildPhoneResearch(): HTMLElement {
        const r = strings.deviceResearch;
        const screen = document.createElement('div');
        screen.id = PHONE_RESEARCH_ID;
        screen.className = 'phone-research';
        screen.setAttribute('role', 'region');
        screen.setAttribute('aria-label', r.researchTab);
        const sec = (key: PhoneSection): string => `
            <section class="phone-sec" data-sec="${key}" aria-labelledby="phone-sec-${key}">
                <h2 class="phone-sec__head"><span class="phone-sec__title" id="phone-sec-${key}"></span><span class="phone-sec__sum"></span></h2>
                <div class="phone-sec__body"></div>
            </section>`;
        const col = (c: 'a' | 'b'): string => PHONE_SECTIONS.filter(k => PHONE_COLUMNS[k] === c).map(sec).join('');
        screen.innerHTML = `
            <div class="phone-research__main" data-scroll="main">
                <div class="phone-finds-new" hidden><button type="button" class="phone-finds-new__btn" data-act="finds-new"><span class="phone-finds-new__pill"></span></button></div>
                <div class="phone-research__col phone-research__col--a" data-scroll="a">${col('a')}</div>
                <div class="phone-research__col phone-research__col--b" data-scroll="b">${col('b')}
                    <button type="button" class="phone-research__more" data-act="overview"><span class="phone-research__more-text"></span>${CHEVRON}</button>
                </div>
            </div>
            <div class="phone-dock" id="${PHONE_DOCK_ID}"></div>`;
        // Upright the sections stand one under the other in the order of §1 point 1 (Now, Waiting, Finds, Lines):
        // the columns are only the sideways layout's.
        screen.addEventListener('click', (e) => {
            const at = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-act]');
            const act = at?.dataset.act;
            if (act === 'overview') void this.phoneOpenOverview();
            else if (act === 'now-menu' && at) this.openPhoneNowMenu(Number(at.dataset.index));
            else if (act === 'line-menu' && at?.dataset.line) this.openPhoneLineMenu(at.dataset.line);
            else if (act === 'find-group' && at?.dataset.group) this.openPhoneFindGroup(at.dataset.group, at.dataset.older === '1');
            else if (act === 'finds-older') void this.phoneFindsOlder();
            else if (act === 'finds-new') this.phoneScrollToFinds();
        });
        const tabbar = document.getElementById('bottom-bar');
        if (tabbar?.parentElement) tabbar.parentElement.insertBefore(screen, tabbar);
        else document.body.append(screen);
        const dock = screen.querySelector<HTMLElement>(`#${PHONE_DOCK_ID}`);
        if (dock && typeof ResizeObserver === 'function') {
            dockObserver?.disconnect();
            // The toasts stand over the dock (§7 point 2): its height for the stylesheet.
            dockObserver = new ResizeObserver(() => {
                document.documentElement.style.setProperty('--phone-dock-h', `${dock.offsetHeight}px`);
            });
            dockObserver.observe(dock);
        }
        const finds = screen.querySelector<HTMLElement>('.phone-sec[data-sec="finds"]');
        if (finds && typeof IntersectionObserver === 'function') {
            findsObserver?.disconnect();
            // Finds in view (enough of them, past the header and the dock's edge): seen after FINDS_SEEN_MS (§4).
            findsObserver = new IntersectionObserver((entries) => {
                for (const e of entries) {
                    findsInView = e.isIntersecting && e.intersectionRect.height >= Math.min(FINDS_VIEW_PX, e.boundingClientRect.height) - 1;
                }
                this.phoneFindsViewChanged();
            }, { threshold: Array.from({ length: 21 }, (_, i) => i / 20) });
            findsObserver.observe(finds);
        }
        return screen;
    },

    /** The screen drawn from what is known now (the state read last, or the one held here). */
    renderPhoneResearch(): void {
        const screen = document.getElementById(PHONE_RESEARCH_ID);
        if (!screen) return;
        const r = strings.deviceResearch;
        const more = screen.querySelector('.phone-research__more-text');
        if (more) more.textContent = r.moreOverview;
        const state = shownState;
        const anchor = scrollAnchor(screen);
        screen.classList.toggle('is-down', readFailed);
        screen.classList.toggle('is-empty', !state);
        for (const key of PHONE_SECTIONS) {
            const el = sectionEl(screen, key);
            if (!el) continue;
            // Now and Lines keep their rows (a live change rewrites their texts only, §2 point 2).
            if (!state || !KEYED_SECTIONS.has(key)) el.body.replaceChildren();
            el.sum.textContent = '';
            el.sec.hidden = false;
        }
        const now = sectionEl(screen, 'now');
        // Nothing known of the research yet (§8 point 2): one sentence, the dock under it.
        if (!state) {
            for (const key of PHONE_SECTIONS) {
                const el = sectionEl(screen, key);
                if (el) el.sec.hidden = key !== 'now';
            }
            if (now) {
                now.head.textContent = r.nowTitle;
                quiet(now.body, r.stateNotHere);
            }
            this.renderPhoneDock();
            this.syncFindsPill();
            return;
        }
        if (now) this.appendPhoneNow(now, state);
        const waiting = sectionEl(screen, 'waiting');
        if (waiting) this.appendPhoneWaiting(waiting, state);
        const finds = sectionEl(screen, 'finds');
        if (finds) this.appendPhoneFinds(finds, state);
        const lines = sectionEl(screen, 'lines');
        if (lines) this.appendPhoneLines(lines, state);
        this.renderPhoneDock();
        keepScrollAnchor(anchor);
        this.syncFindsPill();
        this.phoneFindsSeenLater();
    },

    /**
     * Now (§2): each line at work — its glyph, its name, the task, since when (paused: until when; stopping…), ⋯ —
     * and the last 24 hours in one quiet line. Nobody at work: "Nothing is being worked on now" and when it was
     * last; never: one sentence. A live change rewrites the rows' texts only. An archive has no Now (§8).
     */
    appendPhoneNow(el: PhoneSectionEl, state: DeviceResearchState): void {
        const r = strings.deviceResearch;
        const g = state.glance;
        const lang = getCurrentLanguage();
        if (g?.tree.state === 'archive') {
            el.sec.hidden = true;
            el.body.replaceChildren();
            return;
        }
        const now = g?.now ?? [];
        setText(el.head, phoneNowTitle(now));
        // A stop asked is forgotten once its run finishes or is gone (the research says so).
        for (const run of [...stopsAsked]) {
            const known = g?.runs.find(x => x.id === run);
            const atWork = now.some(n => n.run === run);
            if (!atWork || known?.state === 'finishing') stopsAsked.delete(run);
        }
        const rows: KeyedRow[] = now.map((n, i) => {
            const line = n.line ? g?.lines.find(l => l.id === n.line) : undefined;
            const name = line?.name || (n.person ? g?.people[n.person]?.name : '') || n.task?.text || '';
            const task = name === n.task?.text ? undefined : n.task?.text;
            const finishing = !!n.run && g?.runs.find(x => x.id === n.run)?.state === 'finishing';
            const stopping = !!n.run && (stopsAsked.has(n.run) || finishing);
            return {
                key: `now:${n.run ?? n.line ?? i}`,
                make: () => makeLineRow('now-menu', false),
                fill: (row: HTMLElement) => {
                    row.dataset.index = String(i);
                    fillLineRow(row, { way: n.way, name, task, meta: phoneNowMeta(n, { stopping, lang }), menu: strings.deviceResearch.lineActions });
                    row.classList.toggle('is-stopping', stopping);
                },
            };
        });
        const idle = phoneNowIdle(g, { lang });
        if (idle?.kind === 'never') rows.push(quietRow('never', r.neverWorked));
        else if (idle?.kind === 'idle') {
            rows.push({
                key: 'idle',
                make: () => {
                    const box = document.createElement('div');
                    box.className = 'phone-now-idle';
                    box.innerHTML = '<span class="phone-dot is-ring" aria-hidden="true"></span>'
                        + '<div class="phone-line__main"><span class="phone-line__name"></span><span class="phone-line__meta"></span></div>';
                    return box;
                },
                fill: (box) => {
                    setText(box.querySelector('.phone-line__name'), strings.live.nothingAtWork);
                    setText(box.querySelector('.phone-line__meta'), idle.last);
                },
            });
        }
        if (g?.day) rows.push(quietRow('day', r.dayLine(g.day.persons, g.day.sources, g.day.saves), 'phone-sec__day'));
        syncRows(el.body, rows);
    },

    /** Waiting (§5; its rows: D5). Nothing waits: the section goes, one sentence said in its place. */
    appendPhoneWaiting(el: { sec: HTMLElement; head: HTMLElement; sum: HTMLElement; body: HTMLElement }, state: DeviceResearchState): void {
        const r = strings.deviceResearch;
        const n = state.glance?.waiting.n ?? 0;
        el.head.textContent = r.waitingTitle(n);
        el.sec.dataset.count = String(n);
        if (!n) quiet(el.body, r.waitingNone);
    },

    /**
     * Finds (§4): since they were last seen here (or the last 24 hours), the groups newest first — a person or a
     * family by its name and years, new sources, resolved — each with its time, at most three lines (a dot for what
     * came since they were last seen) and "and n more"; a tap shows the whole group. Under them the older finds once
     * asked for, "and n more in the overview" when the research cut the list, "Show older finds" when there are any.
     */
    appendPhoneFinds(el: PhoneSectionEl, state: DeviceResearchState): void {
        const r = strings.deviceResearch;
        setText(el.head, r.findsTitle);
        const treeId = phoneResearchTreeId();
        const finds = state.finds;
        if (finds) setText(el.sum, phoneFindsSummary(treeId ? findsWindow.get(treeId) ?? null : null, { lang: getCurrentLanguage() }));
        // Until it is known when they were last seen here, no dots (none flash and go).
        const known = !!treeId && findsSeenOf === treeId;
        const rows: KeyedRow[] = phoneFindGroups(finds?.groups ?? []).map(g => findGroupRow(`find:${g.key}`, g, findsSeen, false, known));
        if (!rows.length) rows.push(quietRow('none', r.findsNone));
        const older = olderFinds && olderFinds.treeId === treeId && finds ? olderFinds.finds : null;
        if (older && finds) rows.push(...olderFindGroups(older, finds.since).map(g => findGroupRow(`old:${g.key}`, g, null, true)));
        const cut = older ? older.cut : finds?.cut;
        if (cut) rows.push(quietRow('cut', r.findsCut(cut)));
        if (finds?.earlier && !older) rows.push(linkRow('older', 'finds-older', r.findsOlder, olderReading));
        syncRows(el.body, rows);
    },

    /** A group of finds tapped: its detail (§4 point 2). */
    openPhoneFindGroup(key: string, older: boolean): void {
        const treeId = phoneResearchTreeId();
        const finds = shownState?.finds;
        const pool = older
            ? (olderFinds && olderFinds.treeId === treeId && finds ? olderFindGroups(olderFinds.finds, finds.since) : [])
            : finds?.groups ?? [];
        const g = pool.find(x => x.key === key);
        if (g) this.showFindGroupSheet(g, older);
    },

    /**
     * The detail of a group of finds in a sheet from below: all its lines with their times, "n finds since t"; a
     * person (or a family by its first partner) with "Show in the tree", which opens the tree on that person (§7).
     * Sources have no "Open in the Research overview": the overview needs the tree.
     */
    showFindGroupSheet(g: DeviceFindGroup, older = false): void {
        const lang = getCurrentLanguage();
        const head = phoneFindHead(g);
        const treeId = phoneResearchTreeId();
        const list = document.createElement('div');
        list.className = 'phone-find-sheet';
        for (const l of phoneFindLines(g, Infinity).lines) {
            const row = document.createElement('div');
            row.className = 'phone-find-sheet__row';
            const text = document.createElement('span');
            text.className = 'phone-find-sheet__text';
            fillFindText(text, phoneFindText(l, g));
            const at = document.createElement('span');
            at.className = 'phone-find-sheet__at';
            at.textContent = findClock(l.at, lang);
            row.append(text, at);
            list.append(row);
        }
        const rows: { label: string; id?: string; run: () => void }[] = [];
        const person = g.person;
        if (person) rows.push({ label: strings.live.showInTree, id: 'phone-find-tree', run: () => { void this.phoneOpenTree({ person }); } });
        const since = findGroupSince(g, older || !treeId ? null : findsWindow.get(treeId) ?? null);
        this.presentMenuSheet(head.name, [{ rows, content: list }], {
            titleAside: head.years,
            subtitle: strings.deviceResearch.findsDetailSub(g.lines.length, findClock(since, lang)),
            overlayClass: `phone-sheet-overlay phone-find-overlay${head.plain ? ' is-plain' : ''}`,
        });
    },

    /** "Show older finds" (§4 point 3): the finds of the last 31 days read, those before the list's shown under it. */
    async phoneFindsOlder(): Promise<void> {
        const treeId = phoneResearchTreeId();
        if (!treeId || olderReading || !shownState?.finds) return;
        olderReading = true;
        this.renderPhoneResearch();
        try {
            const since = new Date(Date.now() - FINDS_OLDER_DAYS * 24 * 3600_000).toISOString();
            const older = await readFinds(treeId, { since, lang: getCurrentLanguage() });
            if (older && phoneResearchTreeId() === treeId) olderFinds = { treeId, finds: older };
        } catch { /* no connection: the link stays for another try */ } finally {
            olderReading = false;
        }
        if (phoneResearchShown()) this.renderPhoneResearch();
    },

    /** "n new ↓": its count while finds came with Finds out of view, hidden otherwise. */
    syncFindsPill(): void {
        const wrap = document.querySelector<HTMLElement>(`#${PHONE_RESEARCH_ID} .phone-finds-new`);
        if (!wrap) return;
        const show = findsCame > 0 && !findsInView && phoneResearchShown();
        wrap.hidden = !show;
        if (show) setText(wrap.querySelector('.phone-finds-new__pill'), strings.deviceResearch.findsNew(findsCame));
    },

    /** "n new ↓" tapped: Finds scrolled into view. */
    phoneScrollToFinds(): void {
        const sec = document.querySelector<HTMLElement>(`#${PHONE_RESEARCH_ID} .phone-sec[data-sec="finds"]`);
        findsCame = 0;
        this.syncFindsPill();
        sec?.scrollIntoView({ block: 'start' });
    },

    /** Finds came into view or went out of it: "n new ↓" goes once they are seen, the 2 s of "seen" start or stop. */
    phoneFindsViewChanged(): void {
        if (findsInView) findsCame = 0;
        this.syncFindsPill();
        this.phoneFindsSeenLater();
    },

    /**
     * Finds in view with something new among them: after FINDS_SEEN_MS still in view, what they show counts as seen
     * here (`markFindsSeen` with their newest moment) and the dots go. The heading's "since" moves on the next start.
     */
    phoneFindsSeenLater(): void {
        const treeId = phoneResearchTreeId();
        const newest = newestFindAt(shownState?.finds);
        const unseen = !!treeId && findsSeenOf === treeId && !!newest && findIsNew(newest, findsSeen);
        if (!findsInView || !phoneResearchShown() || !unseen) {
            if (seenTimer) clearTimeout(seenTimer);
            seenTimer = null;
            return;
        }
        if (seenTimer) return;
        seenTimer = setTimeout(() => {
            seenTimer = null;
            const now = phoneResearchTreeId();
            const at = newestFindAt(shownState?.finds);
            if (!findsInView || !phoneResearchShown() || !now || now !== treeId || !at || !findIsNew(at, findsSeen)) return;
            findsSeen = at;
            void markFindsSeen(now, at).catch(() => undefined);
            this.renderPhoneResearch();
        }, FINDS_SEEN_MS);
    },

    /**
     * Lines (§3) in the order of work: number, glyph, name, tasks, "paused" / "ended", ⋯ (the row too) for the
     * line's actions. A move shows at once; a refusal puts the row back and says "linesBusy" under the list until
     * a write goes. None: one sentence. An archive has no Lines (§8).
     */
    appendPhoneLines(el: PhoneSectionEl, state: DeviceResearchState): void {
        const r = strings.deviceResearch;
        const g = state.glance;
        setText(el.head, r.linesTitle);
        if (g?.tree.state === 'archive') {
            el.sec.hidden = true;
            el.body.replaceChildren();
            return;
        }
        const lines = linesInOrder(g?.lines ?? [], orderMoving);
        const rows: KeyedRow[] = lines.map(l => ({
            key: `line:${l.id}`,
            make: () => makeLineRow('line-menu', true),
            fill: (row: HTMLElement) => {
                row.dataset.line = l.id;
                const chip = l.state === 'paused' ? strings.live.dirPausedChip('') : l.state === 'done' ? r.lineEnded : undefined;
                fillLineRow(row, {
                    n: l.n, way: l.way, name: l.name, meta: l.state === 'done' ? '' : r.lineMeta(l.tasks), chip,
                    off: l.state !== 'active', menu: strings.deviceResearch.lineActions,
                });
            },
        }));
        if (!lines.length) rows.push(quietRow('none', r.linesNone));
        if (linesBusy) rows.push(quietRow('busy', r.linesBusy, 'phone-sec__quiet phone-sec__warn'));
        syncRows(el.body, rows);
    },

    /** The ⋯ of a row of Now (§2 point 3): Show in the tree, Line actions…, Stop run (with its confirmation). */
    openPhoneNowMenu(index: number): void {
        const g = shownState?.glance;
        const n = g?.now[index];
        if (!g || !n) return;
        const r = strings.deviceResearch;
        const L = strings.live;
        const line = n.line ? g.lines.find(l => l.id === n.line) : undefined;
        const name = line?.name || (n.person ? g.people[n.person]?.name : '') || n.task?.text || '';
        const stopping = !!n.run && (stopsAsked.has(n.run) || g.runs.find(x => x.id === n.run)?.state === 'finishing');
        const person = n.person ?? line?.focus;
        const rows: { label: string; run: () => void; danger?: boolean; sub?: string; id?: string }[] = [];
        if (person) rows.push({ label: L.showInTree, id: 'phone-now-tree', run: () => { void this.phoneOpenTree({ person }); } });
        if (line) rows.push({ label: `${r.lineActions}…`, id: 'phone-now-line', run: () => this.openPhoneLineMenu(line.id) });
        if (n.run && !stopping && researchDeviceAllows('run-stop')) {
            const run = n.run;
            rows.push({ label: L.stopRun, sub: r.stopSub(computerName()), danger: true, id: 'phone-now-stop', run: () => { void this.phoneStopRun(run, name); } });
        }
        if (!rows.length) return;
        const sub = [name === n.task?.text ? '' : n.task?.text ?? '', phoneNowMeta(n, { stopping, lang: getCurrentLanguage() })].filter(Boolean).join(' · ');
        this.presentMenuSheet(name, [{ rows }], { subtitle: sub, overlayClass: 'phone-sheet-overlay' });
    },

    /** Stop run (§2 point 3): asked first (as on the computer), then through the bridge; "stopping…" until it finishes. */
    async phoneStopRun(runId: string, lineName: string): Promise<void> {
        const r = strings.deviceResearch;
        const treeId = phoneResearchTreeId();
        if (!treeId || stopsAsked.has(runId) || !researchDeviceAllows('run-stop')) return;
        const pc = computerName();
        const ok = await this.showConfirm(r.stopText(pc), r.stopAsk(lineName), { confirmLabel: strings.live.stopRun, cancel: r.stopKeep, variant: 'danger' });
        if (!ok) return;
        stopsAsked.add(runId);
        this.renderPhoneResearch();
        const res = await postRunStop(deviceBridgeBase(treeId), runId);
        // 404: the run is gone already, nothing more to stop.
        if (!res.ok && res.status !== 404) {
            stopsAsked.delete(runId);
            if (res.reason) this.showToast(res.reason, 6000);
        }
        this.renderPhoneResearch();
        void this.refreshPhoneResearch();
    },

    /**
     * Line actions (§3 point 2): move up, down, to the top, pause ↔ resume, Show in the tree, End… (with its
     * confirmation) — each through the bridge, none with a mark. Under them the quiet sentence of what is on the
     * computer for now (phoneComputerOnlyNote).
     */
    openPhoneLineMenu(lineId: string): void {
        const g = shownState?.glance;
        if (!g || g.tree.state === 'archive') return;
        const lines = linesInOrder(g.lines, orderMoving);
        const line = lines.find(l => l.id === lineId);
        if (!line) return;
        const r = strings.deviceResearch;
        const L = strings.live;
        const rows: { label: string; run: () => void; danger?: boolean; id?: string }[] = [];
        const writes = researchDeviceAllows('direction');
        if (writes) {
            const move = (m: PhoneLineMove, label: string, id: string): void => {
                if (movedLineOrder(lines.map(l => l.id), line.id, m)) rows.push({ label, id, run: () => { void this.phoneMoveLine(line.id, m); } });
            };
            move('up', r.lineUp, 'phone-line-up');
            move('down', r.lineDown, 'phone-line-down');
            if (line.n > 2) move('first', r.lineFirst, 'phone-line-first');
            if (line.state === 'active') rows.push({ label: L.dirPause, id: 'phone-line-pause', run: () => { void this.phoneLineState(line.id, 'pause'); } });
            else rows.push({ label: r.lineResume, id: 'phone-line-resume', run: () => { void this.phoneLineState(line.id, 'resume'); } });
        }
        const focus = line.focus;
        if (focus) rows.push({ label: L.showInTree, id: 'phone-line-tree', run: () => { void this.phoneOpenTree({ person: focus }); } });
        if (writes && line.state !== 'done') {
            rows.push({ label: L.dirEndMenu, danger: true, id: 'phone-line-end', run: () => { void this.phoneEndLine(line.id, line.name); } });
        }
        this.presentMenuSheet(line.name, [{ rows, quiet: phoneComputerOnlyNote('line-work', computerName()) }], {
            subtitle: r.lineSheetSub(line.n, line.tasks), overlayClass: 'phone-sheet-overlay',
        });
    },

    /** A line moved in the order of work: shown at once, written through the bridge; refused, back where it was. */
    async phoneMoveLine(lineId: string, move: PhoneLineMove): Promise<void> {
        const treeId = phoneResearchTreeId();
        const g = shownState?.glance;
        if (!treeId || !g || orderMoving) return;
        const order = movedLineOrder(linesInOrder(g.lines).map(l => l.id), lineId, move);
        if (!order) return;
        orderMoving = order;
        this.renderPhoneResearch();
        const res = await writeDirectionOrder(deviceBridgeBase(treeId), order);
        orderMoving = null;
        if (res.ok) {
            linesBusy = false;
            // The research's order kept until its next glance says the same.
            const held = shownState?.glance;
            if (held) shownState = { ...shownState!, glance: { ...held, lines: linesInOrder(held.lines, order) } };
        } else if (lineWriteBusy(res)) linesBusy = true;
        this.renderPhoneResearch();
        if (res.ok) void this.refreshPhoneResearch();
    },

    /** A line paused, resumed or ended through the bridge; a refusal as the research being written says so under the list. */
    async phoneLineState(lineId: string, what: DirectionStateDo): Promise<boolean> {
        const treeId = phoneResearchTreeId();
        if (!treeId) return false;
        const res = await setDirectionState(deviceBridgeBase(treeId), lineId, what);
        if (res.ok) {
            linesBusy = false;
            const held = shownState?.glance;
            const next = what === 'pause' ? 'paused' : what === 'done' ? 'done' : 'active';
            if (held) shownState = { ...shownState!, glance: { ...held, lines: held.lines.map(l => (l.id === lineId ? { ...l, state: next } : l)) } };
        } else if (lineWriteBusy(res)) linesBusy = true;
        this.renderPhoneResearch();
        if (res.ok) void this.refreshPhoneResearch();
        return res.ok;
    },

    /** End… (§3 point 2, 3.5): asked first, then ended through the bridge. */
    async phoneEndLine(lineId: string, name: string): Promise<void> {
        const r = strings.deviceResearch;
        const ok = await this.showConfirm(r.lineEndText, r.lineEndAsk(name), { confirmLabel: r.lineEndOk, cancel: r.lineEndKeep, variant: 'danger' });
        if (ok) await this.phoneLineState(lineId, 'done');
    },

    /**
     * The dock (§6; its buttons and the queue's strip: D6): fixed at the bottom over the bar. Under its buttons,
     * until the tree is opened here once, "n people · downloaded when opened" (§7 point 3).
     */
    renderPhoneDock(): void {
        const dock = document.getElementById(PHONE_DOCK_ID);
        if (!dock) return;
        let actions = dock.querySelector<HTMLElement>('.phone-dock__actions');
        if (!actions) {
            actions = document.createElement('div');
            actions.className = 'phone-dock__actions';
            dock.append(actions);
        }
        let note = dock.querySelector<HTMLElement>('.phone-dock__note');
        const treeId = phoneResearchTreeId();
        const persons = shownState?.glance?.tree.persons ?? 0;
        const notYet = !!treeId && !treesOpened.has(treeId) && persons > 0;
        if (!notYet) {
            note?.remove();
            return;
        }
        if (!note) {
            note = document.createElement('p');
            note.className = 'phone-dock__note';
            dock.append(note);
        }
        note.textContent = strings.deviceResearch.treeNotYet(persons);
    },

    /** The screen's data read now (the held state first when nothing is drawn yet); a failed read keeps what is shown. */
    async refreshPhoneResearch(): Promise<void> {
        const treeId = phoneResearchTreeId();
        if (!treeId) return;
        if (findsSeenOf !== treeId || !findsWindow.has(treeId)) {
            // When the finds were last seen here: the dots' line, and (once per page) the window of the finds read.
            const seen = await findsSeenAt(treeId).catch(() => null);
            if (phoneResearchTreeId() !== treeId) return;
            if (!findsWindow.has(treeId)) findsWindow.set(treeId, seen);
            if (findsSeenOf !== treeId) {
                findsSeen = seen;
                findsSeenOf = treeId;
            }
        }
        if (!shownState) {
            const held = await heldResearchState(treeId).catch(() => null);
            if (held && phoneResearchTreeId() === treeId && !shownState) {
                shownState = held;
                this.renderPhoneResearch();
            }
        }
        reading?.abort();
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        reading = ctl;
        try {
            if (!features) features = await readDeviceResearchFeatures(treeId, ctl?.signal ?? null);
            const state = await readDeviceResearch(treeId, {
                features, lang: getCurrentLanguage(), findsSince: findsWindowSince(findsWindow.get(treeId) ?? null), signal: ctl?.signal ?? null,
            });
            if (reading !== ctl || phoneResearchTreeId() !== treeId) return;
            // Finds newer than all shown, read while the screen ran with Finds out of view: "n new ↓" (§4 point 4).
            const came = readWhileShown && phoneResearchShown() ? findsArrived(shownState?.finds, state.finds) : 0;
            if (came && !findsInView) findsCame += came;
            if (phoneResearchShown()) readWhileShown = true;
            shownState = state.glance || state.finds ? state : shownState;
            readFailed = false;
        } catch {
            if (reading !== ctl) return;
            readFailed = true;
        } finally {
            if (reading === ctl) reading = null;
        }
        if (phoneResearchShown()) this.renderPhoneResearch();
    },

    /** The bridge's live events read the screen again (only while it is seen). */
    watchPhoneResearchData(): void {
        unwatch?.();
        const treeId = phoneResearchTreeId();
        unwatch = treeId ? watchDeviceResearch(treeId, () => { void this.refreshPhoneResearch(); }) : null;
    },

    /** Another tree picked in the switcher on the screen (§1 point 8): only the screen's data, nothing downloaded. */
    async phonePickTree(researchId: string): Promise<void> {
        if (researchId === phoneResearchTreeId()) return;
        await chooseTree(researchId);
        // The event stream is of the chosen tree.
        retryDeviceConnection();
        screenTreeId = researchId;
        features = null;
        shownState = null;
        readFailed = false;
        olderFinds = null;
        findsCame = 0;
        readWhileShown = false;
        if (this.deviceTreeHeldHere(researchId)) treesOpened.add(researchId);
        this.updateTreeSwitcher();
        this.renderPhoneResearch();
        this.watchPhoneResearchData();
        await this.refreshPhoneResearch();
    },

    /** The name of the screen's tree for the switcher (null: the screen is not seen, the open tree's name stands). */
    phoneResearchTreeName(): string | null {
        if (!phoneResearchShown()) return null;
        const treeId = phoneResearchTreeId();
        if (!treeId) return null;
        return shownState?.glance?.tree.name || pairingNow()?.trees.find(t => t.id === treeId)?.name || null;
    },

    /**
     * The tree from the screen (§7): Family, Table, "Show in the tree", a person's link. The copy held here opens at
     * once; a tree never opened here is downloaded with its progress over the dock (Cancel: the screen stays as it
     * was); a failure says so with Try again; without a connection and a copy, one toast. Opened, the screen goes
     * (a history entry: Back returns to it) and the view or the person asked for is shown.
     */
    async phoneOpenTree(target: PhoneTreeTarget = {}): Promise<boolean> {
        if (opening) return opening;
        const treeId = phoneResearchTreeId();
        if (!treeId) {
            this.hidePhoneResearch();
            return false;
        }
        const run = async (): Promise<boolean> => {
            const res: PhoneTreeOpen = await this.deviceOpenPhoneTree(treeId, () => { void this.phoneOpenTree(target); });
            if (res === 'offline') this.showToast(strings.deviceResearch.treeNotHereOffline(computerName()), 6000);
            if (res !== 'open') return false;
            treesOpened.add(treeId);
            if (target.overview) {
                this.renderPhoneDock();
                this.openResearchOverview();
                return true;
            }
            if (phoneResearchShown()) {
                this.hidePhoneResearch();
                try { history.pushState({ phone: PHONE_TREE_STATE }, ''); } catch { /* Back leaves the app as before */ }
            }
            if (target.view) this.setDisplayViewMode(target.view);
            if (target.person) this.deviceShowResearchPerson(target.person);
            return true;
        };
        opening = run().finally(() => { opening = null; });
        return opening;
    },

    /** "Progress and queue ›": the Research overview's sheet over the screen, once the tree is here (§1 point 1). */
    async phoneOpenOverview(): Promise<void> {
        await this.phoneOpenTree({ overview: true });
    },

    /** The bar's Research tab: from the tree back to the screen (the tree stays open). */
    phoneResearchTab(): void {
        if (phoneResearchShown()) return;
        const st = history.state as { phone?: string } | null;
        if (st?.phone === PHONE_TREE_STATE) {
            // Back to the entry before the tree: its popstate shows the screen.
            history.back();
            return;
        }
        this.showPhoneResearch();
    },

    /** System Back from the tree opened from the screen shows the screen again (§1 point 5). */
    watchPhoneHistory(): void {
        if (historyWatched) return;
        historyWatched = true;
        window.addEventListener('popstate', (e) => {
            if (!phoneResearchReady()) return;
            const st = (e.state ?? null) as { phone?: string } | null;
            if (st?.phone === PHONE_TREE_STATE) {
                if (phoneResearchShown()) this.hidePhoneResearch();
                return;
            }
            if (!phoneResearchShown()) this.showPhoneResearch();
        });
    },

    /**
     * The bar's marks: Research marked (Linka, aria-current) while the screen is seen, the view's tab otherwise; the
     * screen's (+) hidden with its place kept (§1 point 3).
     */
    syncPhoneBar(): void {
        const shown = phoneResearchShown();
        const tab = document.getElementById('bb-view-research');
        if (tab) {
            if (shown) tab.setAttribute('aria-current', 'page');
            else tab.removeAttribute('aria-current');
        }
        if (shown) {
            for (const id of ['bb-view-family', 'bb-view-descendants', 'bb-view-table', 'bb-view-more']) {
                document.getElementById(id)?.classList.remove('active');
            }
        }
    },

    /** The viewport changed (a phone turned into a tablet's width, or back): the device mode's classes again. */
    phoneViewportChanged(): void {
        this.refreshDeviceModeUi();
        if (!phoneResearchReady() && phoneResearchShown()) this.hidePhoneResearch();
    },
});

/** The module's state forgotten (tests). */
export function resetPhoneResearchForTests(): void {
    screenTreeId = null;
    features = null;
    shownState = null;
    readFailed = false;
    treesOpened.clear();
    opening = null;
    stopsAsked.clear();
    orderMoving = null;
    linesBusy = false;
    findsWindow.clear();
    findsSeen = null;
    findsSeenOf = null;
    olderFinds = null;
    olderReading = false;
    findsCame = 0;
    readWhileShown = false;
    findsInView = false;
    if (seenTimer) clearTimeout(seenTimer);
    seenTimer = null;
}

