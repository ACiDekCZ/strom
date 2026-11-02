import { describe, it, expect } from 'vitest';
import { mapBarState, mapBubbleResearch, placeMenu, placeMenuBadge } from '../place-actions.js';
import type { PlaceIdentity, PlaceState } from '../place-identity.js';

const id = (state: PlaceState, extra: Partial<PlaceIdentity> = {}): PlaceIdentity =>
    ({ state, located: ['placed', 'verified', 'check', 'town'].includes(state), ...extra });
const actions = (m: ReturnType<typeof placeMenu>): string[] => m.items.map(i => i.action);

describe('mapBarState', () => {
    it('before the lookup: look up on the map and Places', () => {
        expect(mapBarState({ shown: 10, missing: 4, missingTried: 0, access: 'ok', confirm: 2 }))
            .toEqual({ after: false, actions: ['geocode', 'places'] });
        // A new place the lookup did not try yet keeps the map's own lookup.
        expect(mapBarState({ shown: 10, missing: 4, missingTried: 3, access: 'ok', confirm: 0 }).after).toBe(false);
    });

    it('everything placed: Places only', () => {
        expect(mapBarState({ shown: 10, missing: 0, missingTried: 0, access: 'ok', confirm: 0 }))
            .toEqual({ after: false, actions: ['places'] });
    });

    it('after the lookup with the research here: ◆, to confirm, Places (three at most)', () => {
        expect(mapBarState({ shown: 14, missing: 4, missingTried: 4, access: 'ok', confirm: 2 }))
            .toEqual({ after: true, actions: ['research', 'confirm', 'places'] });
        expect(mapBarState({ shown: 14, missing: 4, missingTried: 4, access: 'ok', confirm: 0 }).actions)
            .toEqual(['research', 'places']);
    });

    it('after the lookup with the research elsewhere: no ◆, to confirm stays', () => {
        for (const access of ['phone', 'elsewhere', 'old'] as const) {
            expect(mapBarState({ shown: 14, missing: 4, missingTried: 4, access, confirm: 3 }).actions).toEqual(['confirm', 'places']);
        }
    });

    it('after the lookup without a research: Places only', () => {
        expect(mapBarState({ shown: 14, missing: 4, missingTried: 4, access: 'none', confirm: 3 }))
            .toEqual({ after: true, actions: ['places'] });
    });
});

describe('mapBubbleResearch', () => {
    it('a check mark: the block, ◆ Check with the research here', () => {
        expect(mapBubbleResearch(id('check', { origin: 'research' }), 'ok'))
            .toEqual({ check: true, checkResearch: true, whyHere: true, note: false });
        expect(mapBubbleResearch(id('check', { origin: 'map' }), 'phone'))
            .toEqual({ check: true, checkResearch: false, whyHere: false, note: true });
    });

    it('a check mark on a place placed by hand: Keep and Change only', () => {
        expect(mapBubbleResearch(id('check', { origin: 'hand' }), 'ok'))
            .toEqual({ check: true, checkResearch: false, whyHere: false, note: false });
    });

    it('the map placed it: ◆ Check in the research', () => {
        expect(mapBubbleResearch(id('placed', { origin: 'map' }), 'ok').checkResearch).toBe(true);
        expect(mapBubbleResearch(id('placed', { origin: 'map' }), 'none'))
            .toEqual({ check: false, checkResearch: false, whyHere: false, note: false });
    });

    it('the research placed it: Why here, no ◆', () => {
        expect(mapBubbleResearch(id('verified', { origin: 'research' }), 'ok'))
            .toEqual({ check: false, checkResearch: false, whyHere: true, note: false });
        expect(mapBubbleResearch(id('placed', { origin: 'hand' }), 'ok'))
            .toEqual({ check: false, checkResearch: false, whyHere: false, note: false });
    });
});

describe('placeMenu', () => {
    it('the badge: places without a location in a research state', () => {
        for (const s of ['none', 'queued', 'running', 'confirm', 'undet'] as const) expect(placeMenuBadge(id(s))).toBe(true);
        for (const s of ['placed', 'verified', 'check', 'town'] as const) expect(placeMenuBadge(id(s))).toBe(false);
    });

    it('to confirm: answer in Waiting first, never the note', () => {
        const m = placeMenu(id('confirm'), 'phone');
        expect(actions(m)).toEqual(['answer', 'find', 'places']);
        expect(m.items[0].primary).toBe(true);
        expect(m.note).toBe(false);
    });

    it('no location: Find on the map first; ◆ only with the research here', () => {
        expect(actions(placeMenu(id('none'), 'ok'))).toEqual(['find', 'look', 'places']);
        expect(placeMenu(id('none'), 'ok').items.find(i => i.action === 'look')?.research).toBe(true);
        const phone = placeMenu(id('none'), 'phone');
        expect(actions(phone)).toEqual(['find', 'places']);
        expect(phone.note).toBe(true);
    });

    it('without a research: no ◆ and no note', () => {
        for (const s of ['none', 'queued', 'undet'] as const) {
            const m = placeMenu(id(s), 'none');
            expect(m.items.some(i => i.research)).toBe(false);
            expect(m.note).toBe(false);
        }
    });

    it('queued: remove from the queue with the research here', () => {
        expect(actions(placeMenu(id('queued'), 'ok'))).toEqual(['unqueue', 'places']);
        expect(actions(placeMenu(id('queued'), 'elsewhere'))).toEqual(['places']);
        expect(placeMenu(id('queued'), 'elsewhere').note).toBe(true);
        expect(actions(placeMenu(id('running'), 'ok'))).toEqual(['places']);
    });

    it('undetermined: the detail first, ◆ look up again', () => {
        const m = placeMenu(id('undet'), 'ok');
        expect(actions(m)).toEqual(['places', 'lookAgain', 'find']);
        expect(m.items[0].primary).toBe(true);
        expect(actions(placeMenu(id('undet'), 'old'))).toEqual(['places', 'find']);
    });
});
