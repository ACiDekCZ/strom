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
import { chosenTreeId, chooseTree, computerLabelOf, pairingNow } from '../device/device-store.js';
import { retryDeviceConnection } from '../device/device-connection.js';
import {
    heldResearchState, readDeviceResearch, readDeviceResearchFeatures, watchDeviceResearch,
    type DeviceResearchFeatures, type DeviceResearchState,
} from '../device/device-research-data.js';
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

/** One quiet sentence in a section's body (an empty section, §8 point 8). */
function quiet(body: HTMLElement, text: string): void {
    const p = document.createElement('p');
    p.className = 'phone-sec__quiet';
    p.textContent = text;
    body.append(p);
}

const CHEVRON = '<svg class="phone-research__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

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
                <div class="phone-research__col phone-research__col--a" data-scroll="a">${col('a')}</div>
                <div class="phone-research__col phone-research__col--b" data-scroll="b">${col('b')}
                    <button type="button" class="phone-research__more" data-act="overview"><span class="phone-research__more-text"></span>${CHEVRON}</button>
                </div>
            </div>
            <div class="phone-dock" id="${PHONE_DOCK_ID}"></div>`;
        // Upright the sections stand one under the other in the order of §1 point 1 (Now, Waiting, Finds, Lines):
        // the columns are only the sideways layout's.
        screen.addEventListener('click', (e) => {
            const act = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-act]')?.dataset.act;
            if (act === 'overview') void this.phoneOpenOverview();
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
        screen.classList.toggle('is-down', readFailed);
        screen.classList.toggle('is-empty', !state);
        for (const key of PHONE_SECTIONS) {
            const el = sectionEl(screen, key);
            if (!el) continue;
            el.body.replaceChildren();
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
    },

    /** Now (§2; its rows: D3). */
    appendPhoneNow(el: { sec: HTMLElement; head: HTMLElement; sum: HTMLElement; body: HTMLElement }, state: DeviceResearchState): void {
        const r = strings.deviceResearch;
        const g = state.glance;
        const lines = new Set((g?.now ?? []).map(n => n.line ?? '')).size;
        el.head.textContent = lines > 1 ? r.nowTitleLines(lines) : r.nowTitle;
        if (!g || (!g.now.length && !g.lastWorked)) quiet(el.body, r.neverWorked);
    },

    /** Waiting (§5; its rows: D5). Nothing waits: the section goes, one sentence said in its place. */
    appendPhoneWaiting(el: { sec: HTMLElement; head: HTMLElement; sum: HTMLElement; body: HTMLElement }, state: DeviceResearchState): void {
        const r = strings.deviceResearch;
        const n = state.glance?.waiting.n ?? 0;
        el.head.textContent = r.waitingTitle(n);
        el.sec.dataset.count = String(n);
        if (!n) quiet(el.body, r.waitingNone);
    },

    /** Finds (§4; its groups: D4). */
    appendPhoneFinds(el: { sec: HTMLElement; head: HTMLElement; sum: HTMLElement; body: HTMLElement }, state: DeviceResearchState): void {
        const r = strings.deviceResearch;
        el.head.textContent = r.findsTitle;
        if (!state.finds?.groups.length) quiet(el.body, r.findsNone);
    },

    /** Lines (§3; its rows: D3). */
    appendPhoneLines(el: { sec: HTMLElement; head: HTMLElement; sum: HTMLElement; body: HTMLElement }, state: DeviceResearchState): void {
        const r = strings.deviceResearch;
        el.head.textContent = r.linesTitle;
        if (!state.glance?.lines.length) quiet(el.body, r.linesNone);
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
            const state = await readDeviceResearch(treeId, { features, lang: getCurrentLanguage(), signal: ctl?.signal ?? null });
            if (reading !== ctl || phoneResearchTreeId() !== treeId) return;
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
}

