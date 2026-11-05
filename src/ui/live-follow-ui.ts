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

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { strings } from '../strings.js';
import { PersonId, ViewMode, LAST_FOCUSED } from '../types.js';
import { uiModule } from './module.js';
import { el, liveSession } from './research-ui.js';
import { segmentArrowTarget } from './live-section-edit.js';
import { FollowView, FOLLOW_VIEWS, getFollowView, getFanCenterSetting, getFanPerson } from '../live-follow-prefs.js';
import {
    FollowTarget, TrailEntry, followTargets, changedTargets, sessionNumbers, fanCenter, pushTrail,
} from '../live-follow-targets.js';
import { WorkPlace, resolveWorkPlace, samePlace, workPlaceId } from '../live-follow-map.js';
import { WORKING_PLACE_FEATURE } from '../research-link.js';

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
    /** Row of working[] → its last person (the signal only on a change). */
    lastTargets: Map<number, PersonId>;
    /** Row of working[] → its last work place (the map's signal only on a change). */
    lastPlaces: Map<number, WorkPlace>;
    /** The legend of the marks is open (null: not yet shown; it opens when the trail first appears). */
    legendOpen: boolean | null;
}

let session: FollowSession | null = null;
/** The view mode last seen, to tell a switch of view from a move inside one. */
let seenMode: ViewMode | null = null;

const isFollowView = (m: ViewMode): m is FollowView => (FOLLOW_VIEWS as readonly string[]).includes(m);

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

/** The run the tree follows: the first one at work on a person of this tree. */
function followTarget(): PersonId | null {
    const s = liveSession();
    if (!s) return null;
    const persons = Object.values(DataManager.getData().persons);
    for (const w of s.working) {
        if (w.paused || !w.person) continue;
        const p = persons.find(x => x.refn === w.person);
        if (p) return p.id;
    }
    return null;
}

/** Following applies: on, live, on the research's own tree, not read-only. */
function followActive(): boolean {
    const s = liveSession();
    return followOn && !!s && !s.ended && s.treeId === DataManager.getCurrentTreeId() && !DataManager.isViewMode();
}

/** The session of following, started when following applies, dropped when it does not. */
function followSession(): FollowSession | null {
    if (!followActive()) {
        session = null;
        return null;
    }
    if (!session) {
        session = {
            view: getFollowView(), focusBefore: TreeRenderer.getFocusPersonId(), fanPinned: null,
            mapPaused: false, trail: [], lastTargets: new Map(), lastPlaces: new Map(), legendOpen: null,
        };
        seenMode = TreeRenderer.getViewMode();
    }
    return session;
}

/** Every person worked on now, by session (none while following does not apply). */
export function currentFollowTargets(): FollowTarget[] {
    const s = liveSession();
    if (!followActive() || !s) return [];
    return followTargets(s.working, personOfRefn());
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
    return !!s && followActive() && sessionNumbers(s.working).numbered;
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

/** Something the user is in the middle of: a jump would pull the tree from under it. */
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
        const btn = el('button', `live-follow-btn live-follow-btn--${size}`, '◎');
        btn.type = 'button';
        if (size === 'panel') btn.id = 'live-follow';
        btn.setAttribute('aria-pressed', String(followOn));
        btn.classList.toggle('is-on', followOn);
        btn.classList.toggle('is-paused', followOn && (pausedByUser || (followMapPaused() && TreeRenderer.getViewMode() === 'map')));
        const label = followOn ? L.followOff : L.followOn;
        btn.setAttribute('aria-label', label);
        btn.title = followOn && !followTarget() ? `${label} · ${L.followIdle}` : label;
        btn.onclick = () => this.setLiveFollow(!followOn);
        return btn;
    },

    isLiveFollowOn(): boolean {
        return followOn;
    },

    setLiveFollow(on: boolean): void {
        followOn = on;
        storeOn(on);
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
        if (on) this.followJump(true);
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
     * phone strip): only while following is on. Radios, an arrow key moves
     * and chooses at once.
     */
    liveFollowViewRow(where: 'panel' | 'overview' | 'phone'): HTMLElement | null {
        const s = liveSession();
        if (!followOn || !s || s.ended || DataManager.isViewMode()) return null;
        const fs = followSession();
        if (!fs) return null;
        const row = el('div', `live-follow-view live-follow-view--${where}`);
        row.setAttribute('role', 'radiogroup');
        const label = el('span', 'live-follow-view__label', strings.live.followIn);
        label.id = `live-follow-view-l-${where}`;
        row.setAttribute('aria-labelledby', label.id);
        const seg = el('div', 'live-follow-view__seg');
        const V = strings.viewModeSwitch;
        const choose = (v: FollowView, focus: boolean): void => {
            this.setLiveFollowView(v);
            // The panel is drawn anew: the focus goes to the same choice there.
            if (focus) requestAnimationFrame(() => document.querySelector<HTMLElement>(`.live-follow-view--${where} [data-view="${v}"]`)?.focus());
        };
        FOLLOW_VIEWS.forEach((v, i) => {
            const b = el('button', 'live-follow-view__opt', V[v]);
            b.type = 'button';
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
     * the marks in the fan): only while following and two or more rows run;
     * a paused row has none.
     */
    liveWorkingNumber(index: number): number | null {
        const s = liveSession();
        if (!s || !followActive()) return null;
        const { numbers, numbered } = sessionNumbers(s.working);
        return numbered ? numbers[index] ?? null : null;
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

    /** Release the pinned centre: back to the centre the rule gives. */
    unpinFanCenter(): void {
        const fs = followSession();
        if (!fs) return;
        fs.fanPinned = null;
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
                    personId: prev, placeKey: was && was.kind !== 'noPlace' ? workPlaceId(was) : null, session: t.session, at: now,
                    geo: was?.geo ?? null,
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
        // The user focused someone else in the family view since the last jump.
        if (this.followMovedAway()) return;
        if (!pausedByUser) this.followJump(false);
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
            this.pauseLiveFollow();
            return true;
        }
        fs.view = mode;
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
        // The user's own focus: the fan centres on it from now on.
        fs.focusBefore = focus;
        if (pausedByUser) return false;
        this.pauseLiveFollow();
        return true;
    },

    /** Jump to the target now if nothing stands in the way; else later. `now`: skip the 8 s brake. */
    followJump(now: boolean): void {
        if (jumpTimer) clearTimeout(jumpTimer);
        jumpTimer = null;
        if (!followActive() || pausedByUser) return;
        // The fan and the map do not move with the agent: their marks follow (refreshFollowMarks).
        if ((followSession()?.view ?? 'family') !== 'family') return;
        const target = followTarget();
        if (!target) return;
        const there = target === lastTarget && TreeRenderer.getFocusPersonId() === target && TreeRenderer.getViewMode() === 'family';
        if (there) return;
        const t = timing();
        if (somethingOpen(this.isEvidenceHighlightOn())) {
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
        TreeRenderer.setFocus(target, false, glide);
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
        lastTarget = id;
        lastJumpAt = Date.now();
        const scale = ZoomPan.getScale() < ZOOM_FAR ? ZOOM_READABLE : ZoomPan.getScale();
        TreeRenderer.presetViewMode('family');
        seenMode = 'family';
        TreeRenderer.setFocus(id, false, (pid: PersonId) => { ZoomPan.glideToPerson(pid, scale); });
        this.renderLiveFollowPill();
        this.renderLivePanel();
    },

    /** The user took over: pause (the pill), come back after 20 s without touching the tree. */
    pauseLiveFollow(): void {
        if (!followActive()) return;
        const first = !pausedByUser;
        pausedByUser = true;
        if (jumpTimer) clearTimeout(jumpTimer);
        jumpTimer = null;
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => this.resumeLiveFollow(), timing().idle);
        if (first) {
            this.renderLiveFollowPill();
            this.renderLivePanel();
        }
    },

    /** Back to the agent: now, without the brake, in the view following last ran in. */
    resumeLiveFollow(): void {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = null;
        pausedByUser = false;
        lastTarget = null;
        this.renderLiveFollowPill();
        this.renderLivePanel();
        const view = followSession()?.view ?? 'family';
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
            this.renderLiveFollowPill();
            this.renderLivePanel();
        }
    },

    /** Back to the agent on the map: panning on again, the map goes to the place worked on now. */
    resumeMapFollow(): void {
        this.endMapPause();
        this.mapFollowPan(true, true);
    },

    /** The map's pause ends (Back, 20 s, the map left): the pill and the ◎ switch say so. */
    endMapPause(): void {
        if (mapIdleTimer) clearTimeout(mapIdleTimer);
        mapIdleTimer = null;
        const was = !!session?.mapPaused;
        if (session) session.mapPaused = false;
        if (!was) return;
        this.renderLiveFollowPill();
        this.renderLivePanel();
    },

    /**
     * "Following paused · Back to the agent · ×" over the tree while the user
     * has it; on the map moved by hand "Map panning paused · Back to the agent · ×".
     */
    renderLiveFollowPill(): void {
        const kind = !followActive() ? null
            : pausedByUser ? 'follow'
                : followMapPaused() && TreeRenderer.getViewMode() === 'map' ? 'map' : null;
        let pill = document.getElementById('live-follow-pill');
        if (pill && pill.dataset.kind !== kind) {
            pill.remove();
            pill = null;
        }
        if (!kind || pill) return;
        const L = strings.live;
        pill = el('div', `evidence-pill live-follow-pill${kind === 'map' ? ' live-follow-pill--map' : ''}`);
        pill.id = 'live-follow-pill';
        pill.dataset.kind = kind;
        pill.setAttribute('role', 'status');
        if (kind === 'map') pill.appendChild(el('span', 'live-follow-pill__mark', '◎')).setAttribute('aria-hidden', 'true');
        pill.appendChild(el('span', 'evidence-pill-label', kind === 'map' ? L.mapPaused : L.followPaused));
        const back = el('button', 'evidence-pill-next live-follow-back', L.followBack);
        back.type = 'button';
        back.onclick = () => (kind === 'map' ? this.resumeMapFollow() : this.resumeLiveFollow());
        const close = el('button', 'evidence-pill-close', '×');
        close.type = 'button';
        close.setAttribute('aria-label', L.followOff);
        close.title = L.followOff;
        close.onclick = () => this.setLiveFollow(false);
        pill.append(back, close);
        document.body.appendChild(pill);
    },

    /** Moving or zooming the tree by hand, and the F key. */
    listenForLiveFollow(): void {
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
        container.addEventListener('keydown', () => { if (pausedByUser) this.pauseLiveFollow(); }, true);
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
            this.setLiveFollow(!followOn);
        });
    },
});
