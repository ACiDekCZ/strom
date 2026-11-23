/**
 * "Follow the agent in the tree": while following a research live, keep the
 * person the agent works on in the middle of the family view.
 *   - the target is the person of the first run in `working[]` that is not
 *     paused and names a person of the tree (the first row of "Now");
 *   - a jump: the family view, that person focused, the view glides there
 *     (zoom kept, 0.8 when too far out to read); at most one jump per 8 s,
 *     the latest target wins; never while a dialog, a menu, a card tooltip,
 *     typing or a highlight mode is up (then later);
 *   - the user moving the tree, focusing someone else or switching to the
 *     descendants or the timeline pauses it (a pill: Back to the agent · ×);
 *     20 s without touching the tree it comes back by itself.
 * Following runs in the family view, the fan or the map ("Follow in", the
 * view tabs): switching among these keeps it on. In the fan nothing moves:
 * the people worked on are marked (fan-follow-ui.ts), the fan centres on the
 * person focused before following started (or a pinned or chosen one).
 * The switch is remembered per device; ending the live following keeps it.
 */

import { canvasBusy } from './canvas-busy.js';
import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { strings } from '../strings.js';
import { PersonId, ViewMode } from '../types.js';
import { LAST_FOCUSED } from '../model-values.js';
import { uiModule } from './module.js';
import { el, liveSession } from './research-ui.js';
import { segmentArrowTarget } from './live-section-edit.js';
import { topPrefs } from './live-section-prefs.js';
import { FollowView, FOLLOW_VIEWS, getFollowView, getFanCenterSetting, getFanPerson, getFollowTrail, getFocusBefore, setFocusBefore } from '../live-follow-prefs.js';
import {
    FollowTarget, TrailEntry, followTargets, changedTargets, fanCenter, pushTrail,
    CardTrailEntry, pushCardTrail, sessionTone, startFocusBefore,
    FollowMark, FollowRun, FollowRunsOpts, FollowTone, followedRunOf, leadFirst, rowMarks, runNumbers, runLabel, runTone,
} from '../live-follow-targets.js';
import { liveRuns, runLinesOn, type LiveRun } from '../research-runs.js';
import { runName, runWaitText } from '../research-runs-text.js';
import { directionGlyph } from './research-directions-ui.js';
import { agentMirror } from '../windows/agent-mirror.js';
import type { LiveSession } from './research-ui.js';
import type { LiveDiff } from '../live-diff.js';
import { isPhoneBar } from '../breakpoints.js';
import { shownName } from '../person-name.js';
import { WorkPlace, resolveWorkPlace, samePlace, workPlaceId } from '../live-follow-map.js';
import { WORKING_PLACE_FEATURE } from '../research-link.js';
import { windowAgentFollow } from '../windows/agent-follow-state.js';

const FOLLOW_KEY = 'strom-live-follow';
/** The far-out zoom where cards lose their text, and the zoom a jump then takes. */
const ZOOM_FAR = 0.55;
const ZOOM_READABLE = 0.8;

/** Timings (a test may shorten them through `__LIVE_FOLLOW_MS`). */
function timing(): { gap: number; idle: number; retry: number } {
    const t = (globalThis as { __LIVE_FOLLOW_MS?: { gap?: number; idle?: number; retry?: number } }).__LIVE_FOLLOW_MS;
    return { gap: t?.gap ?? 8000, idle: t?.idle ?? 20_000, retry: t?.retry ?? 1000 };
}

function storedOn(): boolean {
    try {
        return localStorage.getItem(FOLLOW_KEY) === '1';
    } catch {
        return false;
    }
}

function storeOn(on: boolean): void {
    try {
        if (on) localStorage.setItem(FOLLOW_KEY, '1');
        else localStorage.removeItem(FOLLOW_KEY);
    } catch { /* not kept */ }
}

let followOn = storedOn();
/** The user took over: no jumps until Back, or 20 s without touching the tree. */
let pausedByUser = false;
/** The person the last jump went to (and focused). */
let lastTarget: PersonId | null = null;
/**
 * A jump laid out under the canvas overlay (Follow switched on): its focus comes only after the overlay is painted,
 * so meanwhile the focus still standing elsewhere is not the user's having moved away (no pause), and no second jump.
 */
let jumpPending: PersonId | null = null;
let lastJumpAt = 0;
let jumpTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
/** The map's own pause comes back after 20 s without touching the map. */
let mapIdleTimer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

/** One run of following (on, live, this tree); gone when following ends. */
interface FollowSession {
    /** The view following runs in (or last ran in). */
    view: FollowView;
    /** The focus when following started; the user focusing someone in the family view replaces it. */
    focusBefore: PersonId | null;
    /** The fan's centre pinned from a sector's menu. */
    fanPinned: PersonId | null;
    /** The map was moved by hand: it stops panning to the work (marks, pulse and trail go on). */
    mapPaused: boolean;
    /** The people and places worked on before (memory only; drawn by the fan and the map). */
    trail: TrailEntry[];
    /**
     * The people a live load added or changed (spec 055 K3.2; memory only;
     * drawn as dots on the cards of the family view). A list of its own: the
     * fan's and the map's trail stays as it was.
     */
    cardTrail: CardTrailEntry[];
    /** Row of working[] → its last person (the signal only on a change). */
    lastTargets: Map<number, PersonId>;
    /** Row of working[] → its last work place (the map's signal only on a change). */
    lastPlaces: Map<number, WorkPlace>;
    /** The legend of the marks is open (null: not yet shown; it opens when the trail first appears). */
    legendOpen: boolean | null;
    /**
     * The fan signals once where the agent works when it is next drawn: following turned on, the app
     * opened again, the fan chosen, Back to the agent (Milan 5 Nov 2026).
     */
    fanArrive: boolean;
    /** The same once on arriving on the map: its work rings pulse once (Milan 5 Nov 2026). */
    mapArrive: boolean;
}

let session: FollowSession | null = null;
/** The view mode last seen, to tell a switch of view from a move inside one. */
let seenMode: ViewMode | null = null;

/**
 * The run chosen to follow (spec 126 U10 §7; this window's memory, never stored): null, or once it ends,
 * the default (followedRunOf). Another window of the app takes the main window's (its mirror's `follow.run`).
 */
let chosenRunId: string | null = null;
/** The run followed when following last looked (a change jumps at once). */
let lastFollowedRun: string | null = null;
/** The open choice of the run followed (the pill's menu). */
let runMenu: { el: HTMLElement; anchor: HTMLElement; ac: AbortController } | null = null;

function closeRunMenu(): void {
    if (!runMenu) return;
    runMenu.ac.abort();
    runMenu.el.remove();
    runMenu.anchor.setAttribute('aria-expanded', 'false');
    runMenu = null;
}

const isFollowView = (m: ViewMode): m is FollowView => (FOLLOW_VIEWS as readonly string[]).includes(m);

/** Another window follows in the view it shows (O5); a view without jumps counts as the family view. */
function shownFollowView(): FollowView {
    const mode = TreeRenderer.getViewMode();
    return isFollowView(mode) ? mode : 'family';
}

function personOfRefn(): (refn: string) => PersonId | null {
    const persons = Object.values(DataManager.getData().persons);
    return (refn: string) => persons.find(x => x.refn === refn)?.id ?? null;
}

/** The tree's default person: the one set for it, else the first one. */
function defaultPerson(): PersonId | null {
    const d = DataManager.getData();
    const set = d.defaultPersonId;
    if (set && set !== LAST_FOCUSED && d.persons[set]) return set;
    return (Object.keys(d.persons)[0] as PersonId | undefined) ?? null;
}

/** The runs following marks (spec 126 U10 §7): the research's runs in Now's order, none ended (empty: sessions as before). */
function followRunsOf(s: LiveSession | null): Array<LiveRun & FollowRun> {
    if (!s || !runLinesOn(s.features)) return [];
    return liveRuns(s).filter(r => r.state !== 'ended').map(r => ({
        ...r, ...(r.kind === 'line' ? { glyph: directionGlyph(s.researches.find(d => d.id === r.research)) } : {}),
    }));
}

/**
 * The run followed now (null: no runs, or none to follow): the one chosen here while it runs (another
 * window: the main window's), else the first in Now not waiting that works on a person of this tree.
 */
function followedRunNow(s: LiveSession | null = liveSession()): string | null {
    const runs = followRunsOf(s);
    if (runs.length === 0) return null;
    const mirror = agentMirror();
    const chosen = mirror ? mirror.follow().run ?? null : chosenRunId;
    const personOf = personOfRefn();
    const id = followedRunOf(runs, chosen, r => r.workers.some(w => !w.paused && !!w.person && !!personOf(w.person)));
    // The run chosen ended (or is gone): the default from now on.
    if (!mirror && chosenRunId && id !== chosenRunId) chosenRunId = null;
    return id;
}

/** The runs and the run followed, for the marks; `phone`: only the run followed (spec 126 U10 §7, 7e). */
function runsOpts(s: LiveSession | null, phone = false): FollowRunsOpts {
    const runs = followRunsOf(s);
    if (runs.length === 0) return {};
    const followedRunId = followedRunNow(s);
    return { runs, followedRunId, ...(phone ? { onlyRun: followedRunId } : {}) };
}

/** The run the tree follows: the run followed's person (with runs), else the first one at work on a person of this tree. */
function followTarget(): PersonId | null {
    const s = liveSession();
    if (!s) return null;
    const persons = Object.values(DataManager.getData().persons);
    const followed = followedRunNow(s);
    const run = followed ? followRunsOf(s).find(r => r.id === followed) : undefined;
    for (const w of run ? run.workers : s.working) {
        if (w.paused || !w.person) continue;
        const p = persons.find(x => x.refn === w.person);
        if (p) return p.id;
    }
    return null;
}

/** The people following puts the focus on: those worked on now and the last jump's target. */
function workedNow(): Set<PersonId> {
    const s = liveSession();
    const out = new Set<PersonId>(s ? followTargets(s.working, personOfRefn(), runsOpts(s)).map(t => t.personId) : []);
    if (lastTarget) out.add(lastTarget);
    return out;
}

/**
 * Following in another window of the app (spec 097 §1–§4; null: the main
 * window, whose ◎ switch and settings are the device's). There the window's
 * own state decides whether it follows (src/windows/agent-follow-state.ts);
 * it follows in the view it shows (never the "Follow in" setting), stores
 * nothing of the main window's (the switch, the focus before following),
 * and its pause is said by its strip, not by the pill.
 */
export interface LiveFollowScope {
    /** The window follows the agent (attached or paused). */
    on(): boolean;
    /** Follow the agent here, or detach this window. */
    setOn(on: boolean): void;
    /** Following here paused (moved by hand) or back. */
    setPaused(paused: boolean): void;
}

let scope: LiveFollowScope | null = null;
/** Following as the centre's button last saw it (renderLiveFollowPill). */
let lastFollowedHere = false;

export function setLiveFollowScope(s: LiveFollowScope | null): void {
    scope = s;
}

/**
 * The main window started by taking over (spec 097 §7): ◎ as it was in the
 * closed main window, before following starts again.
 */
export function adoptLiveFollowOn(on: boolean): void {
    if (scope) return;
    followOn = on;
    storeOn(on);
}

/** Keys that move in the Table's rows or scroll it. */
const TABLE_MOVE_KEY = /^(Arrow(Up|Down|Left|Right)|PageUp|PageDown|Home|End| )$/;

/**
 * The user takes the Table over (spec 097 §5: a pause, never the app's own
 * scroll): the wheel over the grid, a press on its scroll bar or in its rows
 * (a cell, a name), a key that moves in its rows or scrolls it (not while a
 * cell is edited). Its bar, head and status line do not.
 */
function tableTakenOver(e: Event): boolean {
    const target = e.target as HTMLElement | null;
    const grid = target?.closest('.tv-grid');
    if (!target || !grid) return false;
    if (e.type === 'wheel') return true;
    if (e.type === 'keydown') {
        const k = e as KeyboardEvent;
        if (k.ctrlKey || k.metaKey || k.altKey || target.closest('input, textarea, select, [contenteditable="true"]')) return false;
        return TABLE_MOVE_KEY.test(k.key);
    }
    // The grid itself under the press: its scroll bar.
    return target === grid || !!target.closest('.tv-body');
}

/** Following is switched on here: the window's own state, else the ◎ switch. */
function isOn(): boolean {
    return scope ? scope.on() : followOn;
}

/** The window's state hears whether following is paused here (by hand, or the map's panning). */
function reportPaused(): void {
    scope?.setPaused(pausedByUser || !!session?.mapPaused);
}

/** Following applies: on, live, on the research's own tree, not read-only. */
function followActive(): boolean {
    const s = liveSession();
    return isOn() && !!s && !s.ended && s.treeId === DataManager.getCurrentTreeId() && !DataManager.isViewMode();
}

/** The session of following, started when following applies, dropped when it does not. */
function followSession(): FollowSession | null {
    if (!followActive()) {
        session = null;
        return null;
    }
    if (!session) {
        const treeId = DataManager.getCurrentTreeId();
        // Another window keeps nothing of the main window's: neither its kept focus nor its view (O5: the one it shows).
        const focusBefore = startFocusBefore({
            focus: TreeRenderer.getFocusPersonId(), worked: workedNow(), kept: treeId && !scope ? getFocusBefore(treeId) : null,
            defaultPerson: defaultPerson(), exists: id => !!DataManager.getPerson(id),
        });
        if (treeId && !scope) setFocusBefore(treeId, focusBefore);
        session = {
            view: scope ? shownFollowView() : getFollowView(), focusBefore, fanPinned: null,
            mapPaused: false, trail: [], cardTrail: [], lastTargets: new Map(), lastPlaces: new Map(), legendOpen: null,
            fanArrive: true, mapArrive: true,
        };
        seenMode = TreeRenderer.getViewMode();
    }
    return session;
}

/** Every person worked on now, by session (none while following does not apply); on a phone the run followed's alone. */
export function currentFollowTargets(): FollowTarget[] {
    const s = liveSession();
    if (!followActive() || !s) return [];
    return followTargets(s.working, personOfRefn(), runsOpts(s, isPhoneBar())).sort(leadFirst);
}

/** A mark's colour group now: a run's by the run followed (spec 126 U10 §7), else its session's (043). */
export function followTone(x: { session: number; runId?: string }): FollowTone {
    return x.runId ? runTone(x.runId, followedRunNow()) : sessionTone(x.session);
}

/** The bridge names the place record a run works on (`working.place`); without it the field is not read. */
function placeFromBridge(): boolean {
    return !!liveSession()?.features?.includes(WORKING_PLACE_FEATURE);
}

/** Where each run at work works (row of working[] → its place), for the given targets. */
export function currentWorkPlaces(targets: readonly FollowTarget[] = currentFollowTargets()): Map<number, WorkPlace> {
    const s = liveSession();
    const out = new Map<number, WorkPlace>();
    if (!s) return out;
    const data = DataManager.getData();
    const usePlace = placeFromBridge();
    for (const t of targets) out.set(t.row, resolveWorkPlace(data, { personId: t.personId, place: s.working[t.row]?.place }, usePlace));
    return out;
}

/** A session's colour on the cards (043: the first one primary, the others accent; a run: the one followed primary). */
function toneColor(x: { session: number; runId?: string }): string {
    return followTone(x) === 'primary' ? 'var(--follow-c1)' : 'var(--follow-c2)';
}

/**
 * The session a live load's change of a person belongs to (an estimate: the
 * bridge does not say): the run at work on that person or on a parent, a
 * child or a partner of theirs; else the run whose task the last change
 * came with; else the first one. Not following: the first one.
 */
export function liveSessionOf(id: PersonId): { session: number; runId?: string } {
    const s = liveSession();
    const first = { session: 1 };
    if (!s || !followActive()) return first;
    const targets = followTargets(s.working, personOfRefn(), runsOpts(s)).sort(leadFirst);
    if (targets.length === 0) return first;
    const data = DataManager.getData();
    const p = data.persons[id];
    const near = new Set<PersonId>([id, ...(p?.parentIds ?? []), ...(p?.childIds ?? [])]);
    for (const uid of p?.partnerships ?? []) {
        const u = data.partnerships[uid];
        if (u) { near.add(u.person1Id); near.add(u.person2Id); }
    }
    const mark = (t: FollowTarget) => ({ session: t.session, ...(t.runId ? { runId: t.runId } : {}) });
    const byPerson = targets.find(t => t.personId === id) ?? targets.find(t => near.has(t.personId));
    if (byPerson) return mark(byPerson);
    const task = s.changes[0]?.task;
    const byTask = task ? targets.find(t => t.task === task) : undefined;
    return byTask ? mark(byTask) : mark(targets[0]);
}

/** The trail on the cards (newest first): following on, the trail on, not on a phone. */
function cardTrailShown(): ReadonlyArray<{ personId: PersonId; kind: 'added' | 'changed'; color: string }> {
    if (!followActive() || !session || !getFollowTrail() || isPhoneBar()) return [];
    const now = Date.now();
    session.cardTrail = pushCardTrail(session.cardTrail, [], now);
    return session.cardTrail.map(e => ({ personId: e.personId, kind: e.kind, color: toneColor(e) }));
}

/** A live load's scene ended: the people it added or changed go to the front of the card trail. */
function noteLiveLoad(diff: LiveDiff): void {
    const fs = followSession();
    if (!fs) return;
    const now = Date.now();
    const entries: CardTrailEntry[] = [
        ...diff.added.map(personId => ({ personId, kind: 'added' as const, ...liveSessionOf(personId), at: now })),
        ...[...new Set([...diff.changed.keys(), ...diff.merged.values()])]
            .filter(personId => !diff.added.includes(personId))
            .map(personId => ({ personId, kind: 'changed' as const, ...liveSessionOf(personId), at: now })),
    ];
    if (entries.length === 0) return;
    fs.cardTrail = pushCardTrail(fs.cardTrail, entries, now);
    TreeRenderer.refreshCardTrail();
}

let liveHooksSet = false;
/** What a live load of the tree asks following (TreeRenderer.renderLive): colours, the card trail, the jump targets. */
export function setLiveRenderHooks(): void {
    if (liveHooksSet) return;
    liveHooksSet = true;
    TreeRenderer.setLiveHooks({
        colorOf: id => toneColor(liveSessionOf(id)),
        jumpTargets: () => new Set(pausedByUser ? [] : currentFollowTargets().map(t => t.personId)),
        onLoaded: noteLiveLoad,
        cardTrail: cardTrailShown,
    });
}

/** The trail of this run of following (newest first; empty when not following). */
export function followTrail(): readonly TrailEntry[] {
    return followActive() ? session?.trail ?? [] : [];
}

/** The map was moved by hand while following there. */
export function followMapPaused(): boolean {
    return followActive() && !!session?.mapPaused;
}

/** The legend of the marks: open (true), folded (false), not shown yet (null). */
export function followLegendOpen(): boolean | null {
    return followActive() ? session?.legendOpen ?? null : null;
}

export function setFollowLegendOpen(open: boolean): void {
    if (followActive() && session) session.legendOpen = open;
}

/** The timings of following (a test may shorten them). */
export function followTiming(): { gap: number; idle: number; retry: number } {
    return timing();
}

/** Session numbers are shown (two or more runs at work). */
export function followNumbered(): boolean {
    const s = liveSession();
    if (!s || !followActive()) return false;
    const opts = runsOpts(s);
    // A phone marks the run followed alone (spec 126 U10 §7): no labels for one run.
    if (opts.runs && isPhoneBar()) return false;
    return rowMarks(s.working, opts).numbered;
}

/** The fan is drawn while following: true once after it is opened (the arrival's signal is due). */
export function takeFanArrival(): boolean {
    const fs = followSession();
    if (!fs?.fanArrive) return false;
    fs.fanArrive = false;
    return true;
}

/** The map is drawn while following: true once after it is opened (the arrival's signal is due). */
export function takeMapArrival(): boolean {
    const fs = followSession();
    if (!fs?.mapArrive) return false;
    fs.mapArrive = false;
    return true;
}

/** The pinned fan centre (null: none, or not following). */
export function followPinned(): PersonId | null {
    return followActive() ? session?.fanPinned ?? null : null;
}

/** Where the fan centres while following (null: not following). */
export function followFanCenter(): PersonId | null {
    const fs = followSession();
    if (!fs) return null;
    const persons = DataManager.getData().persons;
    const treeId = DataManager.getCurrentTreeId();
    return fanCenter({
        pinned: fs.fanPinned,
        setting: getFanCenterSetting(),
        chosen: treeId ? getFanPerson(treeId) : null,
        defaultPerson: defaultPerson(),
        focusBefore: fs.focusBefore,
        exists: id => !!persons[id],
    });
}

/**
 * Something the user is in the middle of: a jump would pull the tree from
 * under it. `highlight`: a passing highlight of a group; the window's
 * selection is a lasting state and does not hold the jumps back (spec 098 §7).
 */
export function followBusy(highlight: boolean): boolean {
    return somethingOpen(highlight);
}

function somethingOpen(highlight: boolean): boolean {
    if (highlight) return true;
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return true;
    return !!document.querySelector(
        '.modal-overlay.active, .context-menu, .bottom-sheet-overlay, .person-card:hover .card-tooltip');
}

export const liveFollowMethods = uiModule({
    /** The ◎ switch (the small panel, the overview, the phone strip). */
    liveFollowButton(size: 'panel' | 'overview' | 'phone'): HTMLButtonElement | null {
        const s = liveSession();
        if (!s || s.ended || DataManager.isViewMode()) return null;
        const L = strings.live;
        const btn = el('button', `live-follow-btn live-follow-btn--${size} sel-opt`, '◎');
        btn.dataset.selForm = 'chip';
        btn.type = 'button';
        if (size === 'panel') btn.id = 'live-follow';
        const on = isOn();
        btn.setAttribute('aria-pressed', String(on));
        btn.classList.toggle('is-on', on);
        btn.classList.toggle('is-paused', on && (pausedByUser || (followMapPaused() && TreeRenderer.getViewMode() === 'map')));
        const label = on ? L.followOff : L.followOn;
        btn.setAttribute('aria-label', label);
        btn.title = on && !followTarget() ? `${label} · ${L.followIdle}` : label;
        btn.onclick = () => this.setLiveFollow(!isOn());
        return btn;
    },

    isLiveFollowOn(): boolean {
        return isOn();
    },

    /**
     * Following applies to the open tree now: ◎ on AND a live session of
     * this very tree. ◎ alone is a device preference kept across trees, so a
     * copy or an unlinked tree opened with it on is not followed.
     */
    isLiveFollowActive(): boolean {
        return followActive();
    },

    /**
     * The agent is followed in this window (spec 097): the main window's ◎
     * with a live session on this tree, or this satellite attached to it or
     * paused (its own state; detached does not follow). "Focus on the
     * centre of the selection" is then not offered (spec 098 §13).
     */
    agentFollowedHere(): boolean {
        const w = windowAgentFollow();
        return followActive() || w === 'attached' || w === 'paused';
    },

    setLiveFollow(on: boolean): void {
        // Another window: its own state (attach / detach), nothing stored on the device.
        if (scope) scope.setOn(on);
        else {
            followOn = on;
            storeOn(on);
        }
        pausedByUser = false;
        lastTarget = null;
        session = null;
        this.clearLiveFollowTimers();
        const fs = on ? followSession() : null;
        if (fs) {
            const targets = currentFollowTargets();
            fs.lastTargets = changedTargets(new Map(), targets).next;
            fs.lastPlaces = currentWorkPlaces(targets);
            if (fs.view === 'map' && TreeRenderer.getViewMode() === 'map') this.mapFollowPan(true);
            if (fs.view !== 'family' && TreeRenderer.getViewMode() !== fs.view) this.switchFollowView(fs.view);
        }
        this.renderLiveFollowPill();
        this.renderLivePanel();
        this.refreshFollowMarks(new Set());
        // Off drops the pin: the fan's "Centre: … · Release" label goes with it.
        if (!on) TreeRenderer.getFanView()?.refreshPill();
        // A44, §8: the jump of the click laid out under the canvas overlay (the agent's own jumps glide as before).
        if (on) this.followJump(true, true);
    },

    /** The view following runs in now (null: not following). */
    liveFollowView(): FollowView | null {
        return followSession()?.view ?? null;
    },

    /** "Follow in": run following in another view (no pause; a jump there at once). */
    setLiveFollowView(view: FollowView): void {
        const fs = followSession();
        if (!fs) return;
        if (TreeRenderer.getViewMode() === view) {
            fs.view = view;
            this.renderLivePanel();
            return;
        }
        this.switchFollowView(view);
    },

    /** Switch the view for following (its own switch: never counted as the user taking over). */
    switchFollowView(view: FollowView): void {
        const fs = followSession();
        if (!fs) return;
        fs.view = view;
        seenMode = view;
        lastTarget = null;
        if (view === 'fan') fs.fanArrive = true;
        if (view === 'map') fs.mapArrive = true;
        if (view === 'family') {
            // Paused or nothing to jump to: the family view all the same.
            if (TreeRenderer.getViewMode() !== 'family') TreeRenderer.setViewMode('family');
            this.followJump(true);
        } else {
            TreeRenderer.setViewMode(view);
        }
        this.renderLivePanel();
    },

    /**
     * "Follow in: Family / Fan / Map" (the small panel, the overview, the
     * phone strip): only while following is on, and while the top shows it
     * (hidden, following goes on in the view chosen before). Radios, an
     * arrow key moves and chooses at once.
     */
    liveFollowViewRow(where: 'panel' | 'overview' | 'phone'): HTMLElement | null {
        const s = liveSession();
        if (!isOn() || !s || s.ended || DataManager.isViewMode()) return null;
        if (!topPrefs().followIn) return null;
        const fs = followSession();
        if (!fs) return null;
        const row = el('div', `live-follow-view live-follow-view--${where}`);
        row.setAttribute('role', 'radiogroup');
        const label = el('span', 'live-follow-view__label', strings.live.followIn);
        label.id = `live-follow-view-l-${where}`;
        row.setAttribute('aria-labelledby', label.id);
        const seg = el('div', 'live-follow-view__seg sel-seg');
        const V = strings.viewModeSwitch;
        const choose = (v: FollowView, focus: boolean): void => {
            this.setLiveFollowView(v);
            // The panel is drawn anew: the focus goes to the same choice there.
            if (focus) requestAnimationFrame(() => document.querySelector<HTMLElement>(`.live-follow-view--${where} [data-view="${v}"]`)?.focus());
        };
        FOLLOW_VIEWS.forEach((v, i) => {
            const b = el('button', 'live-follow-view__opt sel-opt', V[v]);
            b.type = 'button';
            b.dataset.selForm = 'seg';
            b.setAttribute('role', 'radio');
            b.setAttribute('aria-checked', String(fs.view === v));
            b.tabIndex = fs.view === v ? 0 : -1;
            b.dataset.view = v;
            b.onclick = () => choose(v, false);
            b.onkeydown = (e) => {
                const t = segmentArrowTarget(e.key, i, FOLLOW_VIEWS.length);
                if (t === null) return;
                e.preventDefault();
                choose(FOLLOW_VIEWS[t], true);
            };
            seg.appendChild(b);
        });
        row.append(label, seg);
        return row;
    },

    /**
     * The session number of a row of "At work" (1, 2, … in the colours of
     * the marks in the fan; a run's label, "↑ 2"): only while following and
     * two or more rows run; a paused row has none.
     */
    liveWorkingNumber(index: number): FollowMark | null {
        const s = liveSession();
        if (!s || !followActive()) return null;
        const { marks, numbered } = rowMarks(s.working, runsOpts(s));
        return numbered ? marks[index] ?? null : null;
    },

    /** Where the fan centres when following opens it (null: not following, the fan's own rule). */
    liveFollowFanCenter(): PersonId | null {
        return followFanCenter();
    },

    /** The pinned fan centre (null: none). */
    liveFollowPinned(): PersonId | null {
        return followPinned();
    },

    /** Pin a person as the fan's centre (the sector menu); re-centre there. */
    pinFanCenter(id: PersonId): void {
        const fs = followSession();
        if (!fs) return;
        fs.fanPinned = id;
        TreeRenderer.getFanView()?.recenterAsOrigin(id);
    },

    /**
     * Release the pinned centre: back to the centre the rule gives
     * (`recenter` false: the caller centres the fan itself, e.g. on the
     * tree's default person, spec 111 §7).
     */
    unpinFanCenter(recenter = true): void {
        const fs = followSession();
        if (!fs) return;
        fs.fanPinned = null;
        if (!recenter) return;
        const centre = followFanCenter();
        if (centre) TreeRenderer.getFanView()?.recenterAsOrigin(centre);
    },

    /**
     * The people worked on changed (or following started, or the view): note
     * the rows whose person changed (they signal) and mark the fan again.
     * `pulse`: the rows to signal (default: those that changed now).
     */
    refreshFollowMarks(pulse?: Set<number>): void {
        const fs = followActive() ? session : null;
        let changed = pulse ?? new Set<number>();
        let moved = pulse ?? new Set<number>();
        if (fs) {
            const targets = currentFollowTargets();
            const places = currentWorkPlaces(targets);
            const diff = changedTargets(fs.lastTargets, targets);
            // The map signals a run that moved to another place (a new run counts).
            const placeChanged = new Set<number>();
            for (const t of targets) if (!samePlace(fs.lastPlaces.get(t.row), places.get(t.row))) placeChanged.add(t.row);
            if (!pulse) {
                changed = diff.changed;
                moved = placeChanged;
            }
            // The run's previous person and place go to the front of the trail.
            const now = Date.now();
            for (const t of targets) {
                if (!diff.changed.has(t.row) && !placeChanged.has(t.row)) continue;
                const prev = fs.lastTargets.get(t.row);
                if (!prev) continue;
                const was = fs.lastPlaces.get(t.row);
                fs.trail = pushTrail(fs.trail, {
                    personId: prev, placeKey: was && was.kind !== 'noPlace' ? workPlaceId(was) : null, session: t.session,
                    ...(t.runId ? { runId: t.runId } : {}), at: now, geo: was?.geo ?? null,
                }, now);
            }
            fs.lastTargets = diff.next;
            fs.lastPlaces = places;
            // The legend opens by itself the first time a trail appears.
            if (fs.legendOpen === null && fs.trail.length > 0) fs.legendOpen = true;
        }
        const mode = TreeRenderer.getViewMode();
        if (mode === 'fan') this.applyFanFollowMarks(changed);
        if (mode === 'map') this.applyMapFollowMarks(moved);
        else this.clearMapFollowMarks();
        this.renderFollowLegend();
    },

    clearLiveFollowTimers(): void {
        if (jumpTimer) clearTimeout(jumpTimer);
        if (idleTimer) clearTimeout(idleTimer);
        if (mapIdleTimer) clearTimeout(mapIdleTimer);
        jumpTimer = null;
        idleTimer = null;
        mapIdleTimer = null;
        this.stopMapFollowPan();
    },

    /** A status, a change, a redraw: jump when the target moved on (or the user moved away). */
    syncLiveFollow(): void {
        this.listenForLiveFollow();
        if (!followSession()) {
            this.renderLiveFollowPill();
            this.refreshFollowMarks();
            return;
        }
        if (this.followViewChanged()) return;
        this.refreshFollowMarks();
        // Another run followed (chosen in the main window, or the one followed ended): there at once (spec 126 U10 §7).
        const run = followedRunNow();
        const switched = run !== lastFollowedRun && lastFollowedRun !== null && run !== null;
        lastFollowedRun = run;
        this.renderLiveFollowPill();
        // The user focused someone else in the family view since the last jump.
        if (!switched && this.followMovedAway()) return;
        if (!pausedByUser) this.followJump(switched);
    },

    /**
     * The view mode changed since last seen: the family view, the fan or the
     * map take following along (no pause, a jump there at once); the
     * descendants or the timeline pause it. True when it changed.
     */
    followViewChanged(): boolean {
        const fs = followSession();
        const mode = TreeRenderer.getViewMode();
        if (!fs || mode === seenMode) return false;
        const left = seenMode;
        seenMode = mode;
        // Leaving the map ends its own pause (the next visit pans to the work again).
        if (left === 'map' && fs.mapPaused) this.endMapPause();
        if (!isFollowView(mode)) {
            // Another window follows in the view it shows (§4): the descendants or the timeline have no jumps there, no pause.
            if (scope) {
                lastTarget = null;
                this.refreshFollowMarks(new Set());
                return true;
            }
            this.pauseLiveFollow();
            return true;
        }
        fs.view = mode;
        if (mode === 'fan') fs.fanArrive = true;
        if (mode === 'map') fs.mapArrive = true;
        lastTarget = null;
        this.renderLivePanel();
        this.refreshFollowMarks(new Set());
        if (mode === 'map' && !pausedByUser) this.mapFollowPan(true);
        if (!pausedByUser) this.followJump(true);
        return true;
    },

    /** In the family view the user focused someone else than the last jump did: pause (true). */
    followMovedAway(): boolean {
        const fs = followSession();
        if (!fs || !lastTarget || TreeRenderer.getViewMode() !== 'family') return false;
        const focus = TreeRenderer.getFocusPersonId();
        if (!focus || focus === lastTarget) return false;
        if (jumpPending && jumpPending === lastTarget) return false;
        // The user's own focus: the fan centres on it from now on — not a person worked on now
        // (Show in tree from Now while the jump waits for its brake).
        if (!workedNow().has(focus)) {
            fs.focusBefore = focus;
            const treeId = DataManager.getCurrentTreeId();
            if (treeId && !scope) setFocusBefore(treeId, focus);
        }
        if (pausedByUser) return false;
        this.pauseLiveFollow();
        return true;
    },

    /** Jump to the target now if nothing stands in the way; else later. `now`: skip the 8 s brake. */
    followJump(now: boolean, byUser = false): void {
        if (jumpTimer) clearTimeout(jumpTimer);
        jumpTimer = null;
        if (!followActive() || pausedByUser) return;
        // The fan and the map do not move with the agent: their marks follow (refreshFollowMarks).
        if ((followSession()?.view ?? 'family') !== 'family') return;
        // Another window jumps only in the family view it shows (§4: never switched there by following).
        if (scope && TreeRenderer.getViewMode() !== 'family') return;
        const target = followTarget();
        if (!target) return;
        const there = target === lastTarget && TreeRenderer.getFocusPersonId() === target && TreeRenderer.getViewMode() === 'family';
        if (there || (jumpPending === target && target === lastTarget)) return;
        const t = timing();
        if (somethingOpen(this.isEvidenceHighlightOn() && this.evidenceHighlightKind() !== 'selection')) {
            jumpTimer = setTimeout(() => this.followJump(now), t.retry);
            return;
        }
        const wait = now ? 0 : lastJumpAt + t.gap - Date.now();
        if (wait > 0) {
            jumpTimer = setTimeout(() => this.followJump(false), wait);
            return;
        }
        lastTarget = target;
        lastJumpAt = Date.now();
        const scale = ZoomPan.getScale() < ZOOM_FAR ? ZOOM_READABLE : ZoomPan.getScale();
        const glide = (id: PersonId): void => { ZoomPan.glideToPerson(id, scale); };
        if (TreeRenderer.getViewMode() !== 'family') TreeRenderer.presetViewMode('family');
        seenMode = 'family';
        if (byUser) {
            jumpPending = target;
            // A later jump (the agent's own) meanwhile takes its place: this one then lays out nothing.
            void canvasBusy(async () => {
                if (jumpPending === target) await TreeRenderer.setFocus(target, false, glide, { agent: true });
            }).finally(() => { if (jumpPending === target) jumpPending = null; });
        } else {
            jumpPending = null;
            void TreeRenderer.setFocus(target, false, glide, { agent: true });
        }
    },

    /**
     * A label of a person worked on outside the fan: the family view, that
     * person focused and glided to (no brake). The fan's depth stays.
     */
    followToPerson(id: PersonId): void {
        const fs = followSession();
        if (!fs || !DataManager.getPerson(id)) return;
        fs.view = 'family';
        pausedByUser = false;
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = null;
        jumpPending = null;
        lastTarget = id;
        lastJumpAt = Date.now();
        const scale = ZoomPan.getScale() < ZOOM_FAR ? ZOOM_READABLE : ZoomPan.getScale();
        TreeRenderer.presetViewMode('family');
        seenMode = 'family';
        TreeRenderer.setFocus(id, false, (pid: PersonId) => { ZoomPan.glideToPerson(pid, scale); }, { agent: true });
        this.renderLiveFollowPill();
        this.renderLivePanel();
    },

    /** The user took over: pause (the pill), come back after 20 s without touching the tree. */
    pauseLiveFollow(): void {
        if (!followActive()) return;
        const first = !pausedByUser;
        pausedByUser = true;
        // A jump still waiting for the overlay's paint does not land after the user took over.
        jumpPending = null;
        if (jumpTimer) clearTimeout(jumpTimer);
        jumpTimer = null;
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => this.resumeLiveFollow(), timing().idle);
        if (first) {
            reportPaused();
            this.renderLiveFollowPill();
            this.renderLivePanel();
            this.placeMapFollowChrome();
        }
    },

    /** Back to the agent: now, without the brake, in the view following last ran in. */
    resumeLiveFollow(): void {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = null;
        pausedByUser = false;
        lastTarget = null;
        reportPaused();
        this.renderLiveFollowPill();
        this.renderLivePanel();
        const fsNow = followSession();
        // Another window comes back in the view it shows (O5): Back never switches its view.
        if (fsNow && scope) fsNow.view = shownFollowView();
        if (fsNow?.view === 'fan' || fsNow?.view === 'map') {
            if (fsNow.view === 'fan') fsNow.fanArrive = true; else fsNow.mapArrive = true;
            if (TreeRenderer.getViewMode() === fsNow.view) this.refreshFollowMarks(new Set());
        }
        const view = fsNow?.view ?? 'family';
        if (view !== 'family' && TreeRenderer.getViewMode() !== view) {
            this.switchFollowView(view);
            return;
        }
        this.followJump(true);
    },

    /**
     * The map moved by hand (a drag, the wheel, a pinch, +/−, Fit) while
     * following there: only the map's panning to the work pauses; the marks,
     * the signal and the trail go on. 20 s without touching the map it comes
     * back by itself.
     */
    noteMapMovedByUser(): void {
        const fs = followSession();
        if (!fs || fs.view !== 'map' || TreeRenderer.getViewMode() !== 'map') return;
        this.stopMapFollowPan();
        const first = !fs.mapPaused;
        fs.mapPaused = true;
        if (mapIdleTimer) clearTimeout(mapIdleTimer);
        mapIdleTimer = setTimeout(() => this.resumeMapFollow(), timing().idle);
        if (first) {
            reportPaused();
            this.renderLiveFollowPill();
            this.renderLivePanel();
        }
    },

    /** Back to the agent on the map: panning on again, the map goes to the place worked on now. */
    resumeMapFollow(): void {
        this.endMapPause();
        // Back on the map: its rings signal once where the agent works, as on arriving.
        if (session && TreeRenderer.getViewMode() === 'map') {
            session.mapArrive = true;
            this.applyMapFollowMarks(new Set());
        }
        this.mapFollowPan(true, true);
    },

    /** The map's pause ends (Back, 20 s, the map left): the pill and the ◎ switch say so. */
    endMapPause(): void {
        if (mapIdleTimer) clearTimeout(mapIdleTimer);
        mapIdleTimer = null;
        const was = !!session?.mapPaused;
        if (session) session.mapPaused = false;
        if (!was) return;
        reportPaused();
        this.renderLiveFollowPill();
        this.renderLivePanel();
        this.placeMapFollowChrome();
    },

    /**
     * "Following paused · Back to the agent · ×" over the tree while the user
     * has it; on the map moved by hand "Map panning paused · Back to the agent · ×".
     */
    renderLiveFollowPill(): void {
        // Following came or went: the centre's button on the focused card follows (spec 098 §13).
        const followed = this.agentFollowedHere();
        if (followed !== lastFollowedHere) {
            lastFollowedHere = followed;
            TreeRenderer.refreshSelectionCenter();
        }
        // Another window says its pause in its strip (§3, dotaz 1): no pill there, not even the map's.
        // Two or more runs (spec 126 U10 §7): following says which run it follows, and offers the others.
        const live = liveSession();
        const runs = followRunsOf(live);
        const runId = runs.length >= 2 ? followedRunNow(live) : null;
        const run = runId ? runs.find(r => r.id === runId) : undefined;
        const kind = scope || !followActive() ? null
            : pausedByUser ? 'follow'
                : followMapPaused() && TreeRenderer.getViewMode() === 'map' ? 'map'
                    : run ? 'pick' : null;
        const phone = isPhoneBar();
        const name = run && live ? runName(run, live.researches) : '';
        const stamp = `${kind}|${name}|${phone}`;
        let pill = document.getElementById('live-follow-pill');
        if (pill && pill.dataset.stamp !== stamp) {
            pill.remove();
            pill = null;
            closeRunMenu();
        }
        if (!kind || pill) return;
        const L = strings.live;
        pill = el('div', `evidence-pill live-follow-pill${kind === 'map' ? ' live-follow-pill--map' : kind === 'pick' ? ' live-follow-pill--pick' : ''}`);
        pill.id = 'live-follow-pill';
        pill.dataset.kind = kind;
        pill.dataset.stamp = stamp;
        if (run) pill.dataset.run = run.id;
        pill.setAttribute('role', 'status');
        if (kind === 'pick') {
            const what = el('span', 'evidence-pill-pick-text');
            what.append(`${L.followRunPill} `, el('b', undefined, name));
            if (phone) {
                // The phone says which run it follows; the choice is on a larger screen (§7, 7e).
                const label = el('span', 'evidence-pill-label');
                label.appendChild(what);
                label.title = `${L.followRunPill} ${name}`;
                pill.appendChild(label);
            } else {
                const pick = el('button', 'evidence-pill-label evidence-pill-label--pick');
                pick.type = 'button';
                pick.setAttribute('aria-haspopup', 'menu');
                pick.setAttribute('aria-expanded', 'false');
                pick.setAttribute('aria-label', L.followRunAria(name));
                pick.title = `${L.followRunPill} ${name}`;
                const chev = el('span', 'evidence-pill-pick-chev', '▾');
                chev.setAttribute('aria-hidden', 'true');
                pick.append(what, chev);
                pick.onclick = () => this.openFollowRunMenu(pick);
                pill.appendChild(pick);
            }
        } else {
            if (kind === 'map') pill.appendChild(el('span', 'live-follow-pill__mark', '◎')).setAttribute('aria-hidden', 'true');
            pill.appendChild(el('span', 'evidence-pill-label', kind === 'map' ? L.mapPaused : L.followPaused));
            const back = el('button', 'evidence-pill-next live-follow-back', L.followBack);
            back.type = 'button';
            back.onclick = () => (kind === 'map' ? this.resumeMapFollow() : this.resumeLiveFollow());
            pill.appendChild(back);
            // Two or more runs: the run followed, muted, after Back to the agent.
            if (name) pill.appendChild(el('span', 'live-follow-pill__run', name));
        }
        const close = el('button', 'evidence-pill-close', '×');
        close.type = 'button';
        close.setAttribute('aria-label', L.followOff);
        close.title = L.followOff;
        close.onclick = () => this.setLiveFollow(false);
        pill.append(close);
        document.body.appendChild(pill);
    },

    /**
     * The runs to follow (spec 126 U10 §7, 7b): a row per run that is not ended, in Now's order ("1 · Whole
     * queue", "↑ 2 · Kubíčkovi z Dolní Lhoty", under it the agent and the person), the run followed drawn by
     * the selection line, a waiting run grey with what it waits for; at the end "Stop following here".
     */
    openFollowRunMenu(anchor: HTMLElement, from?: LiveSession, followedId?: string | null): void {
        const again = runMenu?.anchor === anchor;
        closeRunMenu();
        if (again) return;
        const s = from ?? liveSession();
        const runs = followRunsOf(s);
        if (!s || runs.length < 2) return;
        const L = strings.live;
        const followed = followedId !== undefined ? followedId : followedRunNow(s);
        const { numbers } = runNumbers(runs);
        const persons = Object.values(DataManager.getData().persons);
        const menu = el('div', 'live-follow-run-menu');
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', L.followRunMenu);
        menu.appendChild(el('div', 'live-follow-run-menu__head', L.followRunMenu)).setAttribute('aria-hidden', 'true');
        for (const r of runs) {
            const n = numbers.get(r.id) ?? 0;
            const item = el('button', `live-follow-run-menu__item sel-opt${r.state === 'waiting' ? ' is-wait' : ''}`);
            item.type = 'button';
            item.dataset.selForm = 'row';
            item.dataset.run = r.id;
            item.setAttribute('role', 'menuitemradio');
            item.setAttribute('aria-checked', String(r.id === followed));
            const head = el('span', 'live-follow-run-menu__name');
            head.append(el('span', 'live-follow-run-menu__num', runLabel(r, n)), ` · ${runName(r, s.researches)}`);
            const w = r.workers.find(x => !x.paused && x.person) ?? r.workers[0];
            const who = w?.person ? persons.find(p => p.refn === w.person) : undefined;
            const sub = r.state === 'waiting' ? runWaitText(r)
                : [r.agentName || w?.who || '', who ? shownName(who) : ''].filter(Boolean).join(' · ');
            item.appendChild(head);
            if (sub) item.appendChild(el('span', 'live-follow-run-menu__sub', sub));
            item.onclick = () => {
                closeRunMenu();
                this.setFollowedRun(r.id);
            };
            menu.appendChild(item);
        }
        menu.appendChild(el('div', 'live-follow-run-menu__sep')).setAttribute('role', 'separator');
        const off = el('button', 'live-follow-run-menu__off', L.followOff);
        off.type = 'button';
        off.setAttribute('role', 'menuitem');
        off.onclick = () => {
            closeRunMenu();
            this.setLiveFollow(false);
        };
        menu.appendChild(off);
        document.body.appendChild(menu);
        const r = anchor.getBoundingClientRect();
        const w = menu.offsetWidth;
        menu.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 8)))}px`;
        menu.style.top = `${Math.round(r.bottom + 6)}px`;
        anchor.setAttribute('aria-expanded', 'true');
        const items = (): HTMLElement[] => [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
        (items().find(i => i.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus({ preventScroll: true });
        const ac = new AbortController();
        runMenu = { el: menu, anchor, ac };
        menu.addEventListener('keydown', (e) => {
            const list = items();
            const at = list.indexOf(document.activeElement as HTMLElement);
            if (e.key === 'Escape') {
                e.preventDefault();
                closeRunMenu();
                anchor.focus({ preventScroll: true });
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                list[(at + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
            }
        }, { signal: ac.signal });
        // A click outside (after this one is over) closes it.
        setTimeout(() => document.addEventListener('pointerdown', (e) => {
            const t = e.target as Node;
            if (!menu.contains(t) && !anchor.contains(t)) closeRunMenu();
        }, { signal: ac.signal }), 0);
    },

    /** The run followed now (spec 126 U10 §7; null: no runs to choose from). */
    followedRun(): string | null {
        return followedRunNow();
    },

    /**
     * Follow this run (Now, the pill, the overview's window): it takes the primary colour and following
     * goes to its person at once. In this window's memory only; another window asks the main one.
     */
    setFollowedRun(id: string | null): void {
        if (agentMirror()) return;
        chosenRunId = id;
        lastFollowedRun = followedRunNow();
        // The marks take the colours of the run followed, Now and the other windows say it (a redraw of the panel).
        this.refreshFollowMarks(new Set());
        this.renderLivePanel();
        this.renderLiveFollowPill();
        if (!followActive() || pausedByUser) return;
        if (followSession()?.view === 'map' && TreeRenderer.getViewMode() === 'map') this.mapFollowPan(true);
        this.followJump(true);
    },

    /** Following paused here (by hand, or the map's panning while the map is shown). */
    liveFollowPausedHere(): boolean {
        return followActive() && (pausedByUser || (followMapPaused() && TreeRenderer.getViewMode() === 'map'));
    },

    /** The agent works on a person of this tree now (else following has nobody to jump to). */
    liveFollowHasTarget(): boolean {
        return followTarget() !== null;
    },

    /** The person following goes to now: the first run's at work on a person of this tree (null: none). */
    liveFollowTarget(): PersonId | null {
        return followTarget();
    },

    /** Back to the agent from another window's strip: the pause by hand, else the map's. */
    liveFollowBack(): void {
        if (pausedByUser) this.resumeLiveFollow();
        else if (session?.mapPaused) this.resumeMapFollow();
        else this.followJump(true);
    },

    /**
     * Another window's live session ended or its main window changed: following
     * there starts afresh (no pause, no timers, no marks), nothing is stored.
     */
    resetLiveFollowHere(): void {
        pausedByUser = false;
        lastTarget = null;
        session = null;
        this.clearLiveFollowTimers();
        this.renderLiveFollowPill();
        this.refreshFollowMarks(new Set());
    },

    /** Moving or zooming the tree by hand, and the F key. */
    listenForLiveFollow(): void {
        setLiveRenderHooks();
        if (listening) return;
        const container = document.getElementById('tree-container');
        if (!container) return;
        listening = true;
        const touched = (e: Event): void => {
            if (!followActive()) return;
            // The fan and the map: moving them by hand does not pause (only keeps a pause going).
            if (TreeRenderer.getViewMode() === 'fan' || TreeRenderer.getViewMode() === 'map') {
                if (pausedByUser) this.pauseLiveFollow();
                return;
            }
            const target = e.target as HTMLElement | null;
            // The Table (spec 097 §5): only its own scroll or a press in its rows takes it over, not its bars or head.
            if (TreeRenderer.getViewMode() === 'table') {
                if (tableTakenOver(e)) this.pauseLiveFollow();
                else if (pausedByUser) this.pauseLiveFollow();
                return;
            }
            // A press on a card or a control opens something (that holds the jump); on the canvas it drags.
            if (e.type !== 'wheel' && target?.closest('.person-card, button, a, input, .context-menu')) {
                if (pausedByUser) this.pauseLiveFollow();
                return;
            }
            this.pauseLiveFollow();
        };
        container.addEventListener('mousedown', touched, true);
        container.addEventListener('touchstart', touched, { capture: true, passive: true });
        container.addEventListener('wheel', touched, { capture: true, passive: true });
        container.addEventListener('keydown', (e) => {
            // A key that moves in the Table's rows (spec 097 §5) takes it over; any other key keeps a pause going.
            if (followActive() && TreeRenderer.getViewMode() === 'table' && tableTakenOver(e)) this.pauseLiveFollow();
            else if (pausedByUser) this.pauseLiveFollow();
        }, true);
        // Someone else focused or another view since the last jump (search,
        // Focus in the menu, the view tabs): the user has the tree.
        const movedAway = (): void => {
            if (!followSession()) return;
            if (this.followViewChanged()) return;
            this.followMovedAway();
        };
        ZoomPan.onChange(movedAway);
        // A press on a card holds the jump; once it drags past the threshold it is a pan like one from the canvas (T38).
        ZoomPan.onCardPanStart(() => { if (followActive() && TreeRenderer.getViewMode() === 'family') this.pauseLiveFollow(); });
        new MutationObserver(movedAway).observe(document.body, { attributes: true, attributeFilter: ['data-view-mode'] });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'f' && e.key !== 'F') return;
            if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
            const active = document.activeElement as HTMLElement | null;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable)) return;
            const inPlace = !active || active === document.body
                || !!active.closest('#live-panel, #research-overview, #tree-container');
            const s = liveSession();
            if (!inPlace || !s || s.ended || s.treeId !== DataManager.getCurrentTreeId() || DataManager.isViewMode()) return;
            if (document.querySelector('.modal-overlay.active')) return;
            e.preventDefault();
            this.setLiveFollow(!isOn());
        });
    },
});
