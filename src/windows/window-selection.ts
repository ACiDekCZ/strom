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
 * the main window always follows.
 */

import type { PersonId } from '../types.js';
import type { WindowRegistry } from './window-registry.js';
import type { SatelliteClient } from './satellite.js';
import type { TableSelectionShare } from '../ui/table-view/table-ui.js';

/** A person picked in a view without a new focus (a satellite's map): `detail.personId`. */
export const PERSON_CHOSEN_EVENT = 'strom:person-chosen';

/** What the selection needs from the app (UI, TreeRenderer, ZoomPan). */
export interface SelectionDeps {
    viewMode(): string;
    setTableSelectionShare(share: TableSelectionShare | null): void;
    tableSharedSelect(personId: string | null): void;
    /** The card ring (null: none). */
    setWindowSelected(personId: PersonId | null): void;
    /** Pan to the card (it is out of view). */
    glideTo(personId: PersonId): void;
    /** The Fan, the Timeline, the Map: show the person's mark, moving only when none is in view. */
    reveal(personId: PersonId): void;
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

/** Take another window's selection into this window's view. */
export function applySharedSelection(personId: string | null, deps: SelectionDeps, doc: Document = document): void {
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

/** The main window: its choices go to the satellites, theirs are highlighted here. Returns the unsubscribe. */
export function wireMainSelection(registry: WindowRegistry, deps: SelectionDeps): () => void {
    deps.setTableSelectionShare({
        active: () => registry.list().length > 0,
        announce: (id) => registry.announceSelection(id),
    });
    const onFocus = (e: Event): void => {
        const id = (e as CustomEvent<{ personId?: string }>).detail?.personId;
        if (!id) return;
        // A person chosen here: the ring of another window's choice goes.
        deps.setWindowSelected(null);
        registry.announceSelection(id);
    };
    window.addEventListener('strom:focus-changed', onFocus);
    const off = registry.onSelect((personId) => applySharedSelection(personId, deps));
    return () => {
        window.removeEventListener('strom:focus-changed', onFocus);
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
        const id = (e as CustomEvent<{ personId?: string }>).detail?.personId;
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
    const off = client.on('select', ({ personId }) => applySharedSelection(personId, deps));
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
