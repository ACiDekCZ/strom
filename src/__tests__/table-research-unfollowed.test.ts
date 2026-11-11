/**
 * The Table view without following (spec 057 §7.4, variant G): the agent's
 * work and queue come from the status the research's bridge gave at the
 * regular ask, so Agent and Research tasks look as while following; an empty
 * queue is "nothing queued" only when the bridge said so; without an answer
 * (the bridge down, nothing asked) the cells stay "–" as before. Invented
 * data only.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { sanitizeLiveStatus } from '../research-link.js';
import { setLanguage } from '../strings.js';
import type { Person, PersonId, StromData, TreeId } from '../types.js';
import type { researchTableLive as TableLive } from '../ui/research-ui.js';
import type { rememberBridgeStatus as Remember } from '../ui/research-sync-ui.js';
import { researchCell, researchTableEnv } from '../ui/table-view/table-research.js';

const TREE = 'tree-unfollowed' as TreeId;
const RESEARCH = '5e1d7c42-9a3b-4f60-8c2d-1b0a9e8f7d6c';
const NOW = Date.parse('2026-11-10T12:00:00Z');

const person = (id: string, refn: string, firstName: string): Person => ({
    id: id as PersonId, firstName, lastName: 'Bělohoubek', gender: 'male', refn, partnerships: [], parentIds: [], childIds: [],
} as unknown as Person);
const data = {
    version: 11, persons: { a: person('a', 'P0001', 'Tobiáš'), b: person('b', 'P0002', 'Radim') }, partnerships: {},
} as unknown as StromData;

let tableLive: typeof TableLive;
let remember: typeof Remember;

beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    setLanguage('en');
    ({ researchTableLive: tableLive } = await import('../ui/research-ui.js'));
    ({ rememberBridgeStatus: remember } = await import('../ui/research-sync-ui.js'));
}, 60000);
afterAll(() => vi.useRealTimers());
afterEach(() => vi.restoreAllMocks());

/** The research tree open, not followed (a tree of this device, editable). */
function openTree(): void {
    vi.spyOn(DataManager, 'getCurrentTreeId').mockReturnValue(TREE);
    vi.spyOn(DataManager, 'isViewMode').mockReturnValue(false);
    vi.spyOn(TreeManager, 'getTreeMetadata').mockReturnValue({ id: TREE, name: 'Bělohoubkovi', research: { id: RESEARCH } } as never);
}

/** What the bridge said at the regular ask. */
function said(extra: Record<string, unknown>): void {
    const status = sanitizeLiveStatus({ tree: { id: RESEARCH, name: 'Bělohoubkovi' }, head: 'a1b2c3d4e5f6', ...extra });
    remember(RESEARCH, status!);
}

const cellText = (live: ReturnType<typeof TableLive>, refn: string, col: 'rAgent' | 'rTasks'): string => {
    const env = researchTableEnv(data, { kind: 'research', live: live.live, working: live.working, queue: live.queue, now: NOW });
    const p = Object.values(data.persons).find(x => x.refn === refn)!;
    return researchCell(env, p, col).text;
};

describe('the Table without following (spec 057 §7.4)', () => {
    it('nothing said by the bridge: the agent\'s cells stay "–"', () => {
        openTree();
        const live = tableLive();
        expect(live.live).toBe(false);
        expect(cellText(live, 'P0001', 'rAgent')).toBe('–');
        expect(cellText(live, 'P0002', 'rTasks')).toBe('–');
    });

    it('the bridge answers: the agent at work and the queue from its status, as while following', () => {
        openTree();
        said({
            working: [{ who: 'agent-matriky', task: 'Křest Tobiáše', person: 'P0001', since: '2026-11-10T11:55:00Z' }],
            queue: [{ id: 'T0007', state: 'next', person: 'P0002', text: 'Sňatek Radima' }],
        });
        const live = tableLive();
        expect(live.live).toBe(true);
        expect(live.queue.map(q => q.id)).toEqual(['T0007']);
        expect(cellText(live, 'P0001', 'rAgent')).toBe('working: Křest Tobiáše');
        expect(cellText(live, 'P0002', 'rAgent')).toBe('in the queue');
        expect(cellText(live, 'P0002', 'rTasks')).toBe('1 · next no. 1 in the queue');
        // The same status gives the same lists (the table is not built anew for nothing).
        const again = tableLive();
        expect(again.working).toBe(live.working);
        expect(again.queue).toBe(live.queue);
    });

    it('an empty queue said by the bridge: nothing queued (not "–")', () => {
        openTree();
        said({ working: [], queue: [] });
        const live = tableLive();
        expect(live.live).toBe(true);
        expect(cellText(live, 'P0002', 'rTasks')).toBe('');
        expect(cellText(live, 'P0002', 'rAgent')).toBe('');
    });

    it('a status of another research does not count', () => {
        openTree();
        vi.spyOn(TreeManager, 'getTreeMetadata').mockReturnValue({ id: TREE, name: 'Bělohoubkovi', research: { id: 'other-research' } } as never);
        remember('other-research', sanitizeLiveStatus({ tree: { id: RESEARCH }, head: 'a1b2c3d4e5f6', queue: [{ id: 'T1', state: 'next', person: 'P0002', text: 'x' }] })!);
        expect(tableLive().live).toBe(false);
    });
});
