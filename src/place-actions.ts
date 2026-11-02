/**
 * What the map and the person card offer for a place (spec 034 §7, §8):
 * the map bar's actions before and after the map's own lookup, the
 * bubble's research blocks, the person card's place menu by state.
 *
 * Pure: the UI (ui/map-ui.ts, ui/person-modal.ts) draws what these say.
 */

import type { PlaceIdentity } from './place-identity.js';
import type { PlacesResearchAccess } from './places-bridge.js';
import { canCheck, hasWhyHere } from './places-dialog.js';

// ==================== MAP BAR ====================

export type MapBarAction = 'geocode' | 'research' | 'confirm' | 'places';

export interface MapBarInput {
    /** Places on the map now. */
    shown: number;
    /** Places in scope without a location. */
    missing: number;
    /** Of those, the map's own lookup asked and found nothing. */
    missingTried: number;
    access: PlacesResearchAccess;
    /** Places the research waits to have confirmed. */
    confirm: number;
}

export interface MapBarState {
    /** The map's lookup ran and every place still missing is one it did not find. */
    after: boolean;
    /** At most three, in this order. */
    actions: MapBarAction[];
}

/**
 * The bar's actions. Before the map's lookup: look them up on the map and
 * Places. After it, with places it did not find: Look up in the research
 * (the research here), "? N to confirm" (any research), Places.
 */
export function mapBarState(i: MapBarInput): MapBarState {
    const after = i.missing > 0 && i.missingTried >= i.missing;
    if (!after) return { after, actions: i.missing > 0 ? ['geocode', 'places'] : ['places'] };
    const actions: MapBarAction[] = [];
    if (i.access === 'ok') actions.push('research');
    if (i.access !== 'none' && i.confirm > 0) actions.push('confirm');
    actions.push('places');
    return { after, actions };
}

// ==================== MAP BUBBLE ====================

export interface MapBubbleResearch {
    /** The ochre block: the check's reason with Keep and Change. */
    check: boolean;
    /** Check in the research. */
    checkResearch: boolean;
    /** "Why here ›" (a place the research identified). */
    whyHere: boolean;
    /** "Check in the research works on the computer with the research." instead of the step. */
    note: boolean;
}

/** What the bubble of a located place adds to its people (§7). */
export function mapBubbleResearch(id: PlaceIdentity, access: PlacesResearchAccess): MapBubbleResearch {
    const check = id.state === 'check';
    // Check: a check mark, or a location the map's own lookup found.
    const offers = canCheck(id) && (check || id.origin === 'map');
    return {
        check,
        checkResearch: offers && access === 'ok',
        whyHere: id.origin === 'research' && hasWhyHere(id),
        note: offers && access !== 'ok' && access !== 'none',
    };
}

// ==================== PERSON CARD ====================

export type PlaceMenuAction = 'answer' | 'find' | 'look' | 'lookAgain' | 'unqueue' | 'places';

export interface PlaceMenuItem {
    action: PlaceMenuAction;
    /** Drawn bold: the step the state asks for. */
    primary: boolean;
    /** A step of the research (the research here only). */
    research: boolean;
}

export interface PlaceMenu {
    items: PlaceMenuItem[];
    /** "Look up in the research works on the computer with the research." under the items. */
    note: boolean;
}

/** Does the person card mark this place with its state (no location yet)? */
export function placeMenuBadge(id: PlaceIdentity): boolean {
    return !id.located && (id.state === 'none' || id.state === 'queued' || id.state === 'running'
        || id.state === 'confirm' || id.state === 'undet');
}

/**
 * The menu of a place without a location on the person card (§8), by its
 * state. The research's steps only with the research here; any other research access
 * says where they go instead (not for a place waiting for an answer).
 */
export function placeMenu(id: PlaceIdentity, access: PlacesResearchAccess): PlaceMenu {
    const res = access === 'ok';
    const item = (action: PlaceMenuAction, primary = false): PlaceMenuItem =>
        ({ action, primary, research: action === 'look' || action === 'lookAgain' || action === 'unqueue' });
    let items: PlaceMenuItem[];
    let researchStep = false;
    switch (id.state) {
        case 'confirm':
            items = [item('answer', true), item('find'), item('places')];
            break;
        case 'queued':
            researchStep = true;
            items = res ? [item('unqueue'), item('places', true)] : [item('places', true)];
            break;
        case 'running':
            items = [item('places', true)];
            break;
        case 'undet':
            researchStep = true;
            items = res ? [item('places', true), item('lookAgain'), item('find')] : [item('places', true), item('find')];
            break;
        default:
            researchStep = true;
            items = res ? [item('find', true), item('look'), item('places')] : [item('find', true), item('places')];
    }
    return { items, note: researchStep && !res && access !== 'none' };
}
