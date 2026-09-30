/**
 * "Follow the agent in the tree": while following a research live, keep the
 * person the agent works on in the middle of the family view.
 *   - the target is the person of the first run in `working[]` that is not
 *     paused and names a person of the tree (the first row of "Now");
 *   - a jump: the family view, that person focused, the view glides there
 *     (zoom kept, 0.8 when too far out to read); at most one jump per 8 s,
 *     the latest target wins; never while a dialog, a menu, a card tooltip,
 *     typing or a highlight mode is up (then later);
 *   - the user moving the tree, focusing someone else or switching the view
 *     pauses it (a pill: Back to the agent · ×); 20 s without touching the
 *     tree it comes back by itself.
 * The switch is remembered per device; ending the live following keeps it.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { strings } from '../strings.js';
import { PersonId } from '../types.js';
import { uiModule } from './module.js';
import { el, liveSession } from './research-ui.js';

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
let listening = false;

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

/** Something the user is in the middle of: a jump would pull the tree from under it. */
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
        btn.classList.toggle('is-paused', followOn && pausedByUser);
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
        this.clearLiveFollowTimers();
        this.renderLiveFollowPill();
        this.renderLivePanel();
        if (on) this.followJump(true);
    },

    clearLiveFollowTimers(): void {
        if (jumpTimer) clearTimeout(jumpTimer);
        if (idleTimer) clearTimeout(idleTimer);
        jumpTimer = null;
        idleTimer = null;
    },

    /** A status, a change, a redraw: jump when the target moved on (or the user moved away). */
    syncLiveFollow(): void {
        this.listenForLiveFollow();
        if (!followActive()) {
            this.renderLiveFollowPill();
            return;
        }
        // The user focused someone else or left the family view since the last jump.
        if (!pausedByUser && lastTarget
            && (TreeRenderer.getFocusPersonId() !== lastTarget || TreeRenderer.getViewMode() !== 'family')) {
            this.pauseLiveFollow();
            return;
        }
        if (!pausedByUser) this.followJump(false);
    },

    /** Jump to the target now if nothing stands in the way; else later. `now`: skip the 8 s brake. */
    followJump(now: boolean): void {
        if (jumpTimer) clearTimeout(jumpTimer);
        jumpTimer = null;
        if (!followActive() || pausedByUser) return;
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
        TreeRenderer.setFocus(target, false, glide);
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

    /** Back to the agent: now, without the brake. */
    resumeLiveFollow(): void {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = null;
        pausedByUser = false;
        lastTarget = null;
        this.renderLiveFollowPill();
        this.renderLivePanel();
        this.followJump(true);
    },

    /** "Following paused · Back to the agent · ×" over the tree while the user has it. */
    renderLiveFollowPill(): void {
        const show = followActive() && pausedByUser;
        let pill = document.getElementById('live-follow-pill');
        if (!show) {
            pill?.remove();
            return;
        }
        if (pill) return;
        const L = strings.live;
        pill = el('div', 'evidence-pill live-follow-pill');
        pill.id = 'live-follow-pill';
        pill.setAttribute('role', 'status');
        pill.appendChild(el('span', 'evidence-pill-label', L.followPaused));
        const back = el('button', 'evidence-pill-next live-follow-back', L.followBack);
        back.type = 'button';
        back.onclick = () => this.resumeLiveFollow();
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
            if (!followActive() || pausedByUser || !lastTarget) return;
            if (TreeRenderer.getFocusPersonId() !== lastTarget || TreeRenderer.getViewMode() !== 'family') this.pauseLiveFollow();
        };
        ZoomPan.onChange(movedAway);
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
