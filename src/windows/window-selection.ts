/**
 * The person selection shared between windows (spec 079 §2): a choice in one
 * window is highlighted in the others. The Table selects the person's row
 * (scrolled to only when out of view; during a cell's edit after it); the
 * family and descendants charts ring the person's card and pan to it only
 * when it is out of view — the focus (the chart's centre) never changes; the
 * Fan outlines the person's sectors, the Timeline their row and the Map
 * their places, each moving only when none is in view. A choice is a new
 * focus (a card, a sector, a row) or a person picked on the map. A satellite
 * with "Follow selection" off neither sends nor takes it (SatelliteClient);
 * the main window always follows and only marks. A satellite set to
 * "switch" (K2.1, the default of Family, Descendants and the Fan) moves its
 * centre to the person instead, as its card's Focus does; the centre it
 * takes this way is not sent on (no loop between two such windows).
 *
 * Following the research agent (spec 097 §4): a jump after the agent is not
 * a choice (its `strom:focus-changed` says `agent`), so no window sends it as
 * the selection, the main window neither. A satellite that follows the agent
 * (attached, not paused) only marks another window's choice — the ring of
 * the card, the row — and its view stays on the agent; paused or detached it
 * takes the choice as "Follow selection" says.
 */

import type { PersonId } from '../types.js';
import type { WindowRegistry } from './window-registry.js';
import type { SatelliteClient } from './satellite.js';
import type { TableSelectionShare } from '../ui/table-view/table-ui.js';
import { viewRecenters, type FollowMode } from './follow-mode.js';
import { VIEW_STEP_EVENT, WindowFocusController, type WindowFocusDeps, type WindowNotice } from './window-focus.js';

/** A person picked in a view without a new focus (a satellite's map): `detail.personId`. */
export const PERSON_CHOSEN_EVENT = 'strom:person-chosen';

/** What the selection needs from the app (UI, TreeRenderer, ZoomPan). */
export interface SelectionDeps {
    viewMode(): string;
    setTableSelectionShare(share: TableSelectionShare | null): void;
    /** `scroll` false: the row selected where it is (the Table follows the agent). */
    tableSharedSelect(personId: string | null, scroll?: boolean): void;
    /** The card ring (null: none). */
    setWindowSelected(personId: PersonId | null): void;
    /** Pan to the card (it is out of view). */
    glideTo(personId: PersonId): void;
    /** The Fan, the Timeline, the Map: show the person's mark, moving only when none is in view. */
    reveal(personId: PersonId): void;
    /**
     * Make the person this window's centre as its Focus does (the depth of a
     * new focus, the window's zoom kept, smoothly); false when the person is
     * not in the tree (nothing happens).
     */
    recenter(personId: PersonId): boolean;
    /**
     * The window follows the research agent now (attached, not paused; spec
     * 097 §4): another window's choice is only marked, the view not moved.
     * Absent: never (the main window).
     */
    agentAttached?(): boolean;
    /** The main window's side of a choice sent with `focus` (spec 110); absent: a satellite. */
    mainFocus?: MainFocusDeps;
}

/** What the notice's buttons do (spec 110 §2, §3): ×, "↶ {previous centre}", "Go to". */
export interface WindowNoticeActions {
    close(): void;
    restore(): void;
    goTo(personId: PersonId): void;
    /** A notice without × ran its time out (the run goes on). */
    expired(): void;
}

/** The main window's part of a choice sent with `focus` (spec 110 §2–§7). */
export interface MainFocusDeps extends Omit<WindowFocusDeps, 'ring' | 'showNotice'> {
    showNotice(notice: WindowNotice, announce: boolean, actions: WindowNoticeActions): void;
    /** Whether the person is drawn in the chart shown (Family, Descendants, Fan); null: another view. */
    drawn(personId: PersonId): boolean | null;
    /** Back in the view's history (the view before the run). */
    back(): void;
    /** "Go to" of the notice: the person made the centre, as the card's Focus does. */
    goTo(personId: PersonId): void;
}

/** The detail of `strom:focus-changed`: the person, and whether it was a jump after the agent (not a choice). */
interface FocusChangedDetail {
    personId?: string;
    agent?: boolean;
}

/** The person chosen by a new focus (null: none, or a jump after the agent — never sent as the selection). */
function chosenByFocus(e: Event): string | null {
    const d = (e as CustomEvent<FocusChangedDetail>).detail;
    return d?.personId && !d.agent ? d.personId : null;
}

/** Whether a drawn card of the person stands wholly inside the chart's area; null: not drawn. */
export function cardInView(doc: Document, personId: string): boolean | null {
    const sel = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(personId) : personId.replace(/"/g, '\\"');
    const card = doc.querySelector<HTMLElement>(`.person-card[data-id="${sel}"]`);
    const box = doc.getElementById('tree-container');
    if (!card || !box) return null;
    const c = box.getBoundingClientRect();
    const r = card.getBoundingClientRect();
    return r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom;
}

/**
 * Take another window's selection into this window's view: marked, or with
 * `switch` in a view that can move its centre, made the centre.
 */
export function applySharedSelection(personId: string | null, deps: SelectionDeps, doc: Document = document, follow: FollowMode = 'mark'): void {
    if (deps.agentAttached?.()) {
        // Following the agent (spec 097 §4, dotaz 3): the choice only marked, the view stays on the agent.
        deps.setWindowSelected(personId as PersonId | null);
        if (deps.viewMode() === 'table') deps.tableSharedSelect(personId, false);
        return;
    }
    if (follow === 'switch' && viewRecenters(deps.viewMode())) {
        // The centre itself says the person: no ring of another window's choice.
        deps.setWindowSelected(null);
        if (personId) deps.recenter(personId as PersonId);
        return;
    }
    deps.setWindowSelected(personId as PersonId | null);
    const mode = deps.viewMode();
    if (mode === 'table') {
        deps.tableSharedSelect(personId);
        return;
    }
    if (!personId) return;
    if (mode === 'fan' || mode === 'timeline' || mode === 'map') {
        deps.reveal(personId as PersonId);
        return;
    }
    if (mode !== 'family' && mode !== 'descendants') return;
    if (cardInView(doc, personId) === false) deps.glideTo(personId as PersonId);
}

/**
 * The main window: its choices go to the satellites, theirs are highlighted
 * here; a satellite's choice sent with `focus` becomes the centre here
 * (spec 110, WindowFocusController), and a person marked but not drawn in
 * the chart is said in the notice with "Go to". Returns the unsubscribe.
 */
export function wireMainSelection(registry: WindowRegistry, deps: SelectionDeps): () => void {
    deps.setTableSelectionShare({
        active: () => registry.list().length > 0,
        announce: (id) => registry.announceSelection(id),
    });
    const mf = deps.mainFocus;
    let ctl: WindowFocusController | null = null;
    if (mf) {
        const actions: WindowNoticeActions = {
            close: () => ctl?.endRun(),
            restore: () => { ctl?.endRun(); mf.back(); },
            goTo: (id) => { ctl?.endRun(); mf.goTo(id); },
            expired: () => ctl?.hide(),
        };
        ctl = new WindowFocusController({
            ...mf,
            ring: (id) => deps.setWindowSelected(id),
            showNotice: (n, announce) => mf.showNotice(n, announce, actions),
        });
    }
    const focusCtl = ctl;
    /** A choice marked here (mark only): a person the chart does not draw is said, with "Go to" (spec 110 §2). */
    const markNotice = (personId: string | null): void => {
        if (!focusCtl || !mf) return;
        const id = personId as PersonId | null;
        const absent = !!id && mf.exists(id) && !mf.hidden(id) && mf.drawn(id) === false;
        if (absent) focusCtl.notice({ kind: 'not-in-view', personId: id! });
        else if (focusCtl.noticeShown === 'not-in-view') focusCtl.hide();
    };
    // A step of this window's own ends a run of another window's centres (its own focus does not).
    const onStep = (): void => { if (focusCtl && !focusCtl.isApplying) focusCtl.endRun(); };
    if (focusCtl) window.addEventListener(VIEW_STEP_EVENT, onStep);
    const offEnded = focusCtl ? registry.onSendEnded((id) => focusCtl.sourceEnded(id)) : () => {};
    const onFocus = (e: Event): void => {
        const id = chosenByFocus(e);
        if (!id) return;
        // A person chosen here: the ring of another window's choice goes.
        deps.setWindowSelected(null);
        registry.announceSelection(id);
    };
    window.addEventListener('strom:focus-changed', onFocus);
    const off = registry.onSelect((personId, origin, meta) => {
        if (focusCtl && meta?.intent === 'focus') {
            focusCtl.take(personId, origin, meta.seq);
            return;
        }
        applySharedSelection(personId, deps);
        markNotice(personId);
    });
    return () => {
        window.removeEventListener('strom:focus-changed', onFocus);
        if (focusCtl) window.removeEventListener(VIEW_STEP_EVENT, onStep);
        offEnded();
        focusCtl?.dispose();
        off();
        deps.setTableSelectionShare(null);
    };
}

/**
 * A satellite: its choice goes out while following (a row of its Table, a
 * new focus of its chart, a person picked on its map), another window's
 * comes in.
 */
export function wireSatelliteSelection(client: SatelliteClient, deps: SelectionDeps): () => void {
    deps.setTableSelectionShare({
        active: () => client.followSelection,
        announce: (id) => client.announceSelection(id),
    });
    const onFocus = (e: Event): void => {
        const id = chosenByFocus(e);
        if (!id) return;
        // A person chosen here: the ring of another window's choice goes.
        deps.setWindowSelected(null);
        client.announceSelection(id);
    };
    const onChosen = (e: Event): void => {
        const id = (e as CustomEvent<{ personId?: string }>).detail?.personId;
        if (id) client.announceSelection(id);
    };
    window.addEventListener('strom:focus-changed', onFocus);
    window.addEventListener(PERSON_CHOSEN_EVENT, onChosen);
    const off = client.on('select', ({ personId }) => applySharedSelection(personId, deps, undefined, client.followMode));
    // "Follow selection" off: the mark of the last choice taken goes from every view (the card's ring, the
    // Fan's outline, the Timeline's row, the Map's places); the Table's row keeps its place without the shared look.
    const offFollow = client.on('follow', (on) => { if (!on) deps.setWindowSelected(null); });
    return () => {
        window.removeEventListener('strom:focus-changed', onFocus);
        window.removeEventListener(PERSON_CHOSEN_EVENT, onChosen);
        off();
        offFollow();
        deps.setTableSelectionShare(null);
    };
}
