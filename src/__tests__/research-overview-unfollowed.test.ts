/**
 * The Research overview without following (spec 057 §7): it opens for any
 * research tree, followed or not, at any width (⤢ in the small panel only
 * while following); the Research menu has the overview first and following
 * live second (Follow live with no mark, Stop while following); without the
 * bridge the sections only it fills are named once, without the hidden ones;
 * the lines come from the tree's file with their people.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { researchActionsMethods } from '../ui/research-actions-ui.js';
import { researchOverviewMethods } from '../ui/research-overview-ui.js';
import { afterTurnOnKeys, skeletonLines } from '../research-overview-source.js';
import { researchLinkMark } from '../research-link.js';
import { PREF_KEYS, PrefKey } from '../ui/live-section-prefs.js';
import type { Person, PersonId, StromData } from '../types.js';
import { setLanguage, strings } from '../strings.js';

afterEach(() => {
    setLanguage('en');
    vi.unstubAllGlobals();
});

/** A UI where every method not named answers "nothing" (null). */
function fakeUi(overrides: Record<string, unknown>): never {
    return new Proxy(overrides, {
        get: (target, key) => (key in target ? target[key as string] : () => null),
    }) as never;
}

/** A research tree on a computer whose research announced its links (`live` among them). */
function menuUi(o: { following?: boolean; archive?: boolean; announced?: boolean } = {}): never {
    const ui: Record<string, unknown> = {
        researchMenuShown: () => true,
        activeResearchId: () => 'R1',
        researchAnyAnnounced: () => o.announced !== false,
        researchLinkAvailable: () => o.announced !== false,
        researchSyncCapable: () => true,
        researchBridgeFresh: () => true,
        activeResearchArchive: () => !!o.archive,
        activeResearchAgentAway: () => false,
        activeResearchModeKnown: () => true,
        isFollowingActiveResearch: () => !!o.following,
        researchWaitingCount: () => 0,
        researchBlockChangesElsewhere: () => false,
        researchOlderBlockHtml: () => '',
        historyManageAvailable: () => false,
    };
    ui.researchMenuModel = researchActionsMethods.researchMenuModel;
    return fakeUi(ui);
}

describe('Research menu: the overview first, following live second (§7.1)', () => {
    it('not followed: Research overview, then Follow live without a mark', () => {
        const model = researchActionsMethods.researchMenuModel.call(menuUi());
        expect(model.first.slice(0, 2).map(i => i.id)).toEqual(['research-item-overview', 'research-item-live']);
        const live = model.first[1];
        expect(live.label).toBe(strings.research.followLive);
        expect(live.ext).toBeFalsy();
        expect(live.ai).toBeFalsy();
        expect(live.method).toBe('researchActionLive');
        expect(researchLinkMark('live')).toBe('none');
    });

    it('followed: Research overview, then Stop following', () => {
        const model = researchActionsMethods.researchMenuModel.call(menuUi({ following: true }));
        expect(model.first.slice(0, 2).map(i => i.id)).toEqual(['research-item-overview', 'research-item-stop']);
        expect(model.first[1].label).toBe(strings.research.stop);
        expect(model.first.some(i => i.id === 'research-item-live')).toBe(false);
    });

    it('an archive (no agent to follow): the overview without Follow live', () => {
        const model = researchActionsMethods.researchMenuModel.call(menuUi({ archive: true }));
        expect(model.first[0].id).toBe('research-item-overview');
        expect([...model.first, ...model.more].some(i => i.id === 'research-item-live')).toBe(false);
    });

    it('a research that announced no links: the overview still first', () => {
        const model = researchActionsMethods.researchMenuModel.call(menuUi({ announced: false }));
        expect(model.first[0].id).toBe('research-item-overview');
        expect(model.first.some(i => i.id === 'research-item-live')).toBe(false);
    });
});

describe('canOpenResearchOverview without following (§7.1)', () => {
    const at = (width: number): void => {
        vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: q.includes('max-width: 640px') ? width <= 640 : false }) });
    };

    it('a research tree not followed opens it, on a computer and on a phone of 390 px', () => {
        for (const width of [1280, 390]) {
            at(width);
            const ui = fakeUi({ isFollowingActiveResearch: () => false, activeResearchId: () => 'R1' });
            expect(researchOverviewMethods.canOpenResearchOverview.call(ui)).toBe(true);
            // ⤢ in the small panel stays only while following.
            expect(researchOverviewMethods.canExpandLivePanel.call(ui)).toBe(false);
        }
    });

    it('a tree without research: no overview', () => {
        at(1280);
        const ui = fakeUi({ isFollowingActiveResearch: () => false, activeResearchId: () => null });
        expect(researchOverviewMethods.canOpenResearchOverview.call(ui)).toBe(false);
    });
});

describe('afterTurnOnKeys: what comes once the research runs (§7.2)', () => {
    it('only the bridge\'s sections, in the user\'s order, without the hidden ones', () => {
        const order: PrefKey[] = ['queue', 'waiting', 'changes', 'directions', 'working', 'knows'];
        expect(afterTurnOnKeys(order, {})).toEqual(['queue', 'changes', 'working']);
        expect(afterTurnOnKeys(order, { changes: 'hidden', working: 'collapsed' })).toEqual(['queue', 'working']);
    });

    it('all of them hidden: no line', () => {
        expect(afterTurnOnKeys([...PREF_KEYS], { working: 'hidden', changes: 'hidden', queue: 'hidden' })).toEqual([]);
    });
});

describe('skeletonLines: the lines from the tree\'s file (§7.2)', () => {
    const person = (id: string, lines: string[]): Person => ({
        id: id as PersonId, firstName: id, lastName: '', gender: 'male', parentIds: [], childIds: [], partnerships: [],
        research: { places: lines.map(line => ({ line })) },
    }) as unknown as Person;

    it('each line with its name and how many people stand in it, in the file\'s order', () => {
        const data = {
            persons: {
                a: person('a', ['L1', 'L1']),
                b: person('b', ['L1', 'L2']),
                c: person('c', []),
            },
            researchDirections: { lines: [{ id: 'L2', name: 'Brennwald line' }, { id: 'L1', name: 'Ostrander line' }, { id: 'L3', name: '' }] },
        } as unknown as Pick<StromData, 'persons' | 'researchDirections'>;
        expect(skeletonLines(data)).toEqual([
            { id: 'L2', name: 'Brennwald line', persons: 1 },
            { id: 'L1', name: 'Ostrander line', persons: 2 },
            { id: 'L3', name: 'L3', persons: 0 },
        ]);
    });

    it('a file naming no lines: none', () => {
        expect(skeletonLines({ persons: {}, researchDirections: undefined } as never)).toEqual([]);
    });
});
