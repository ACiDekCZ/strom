/**
 * A growing branch in Awaiting action (spec 038 K7): its main button adds it
 * to the nearest RUNNING direction. The research names the narrowest
 * direction near the branch whatever its state; when that one is paused, the
 * app takes the narrowest running direction the branch's person is in (who
 * is in which direction, `directions.people`); with none, the paused one
 * stays and says it is paused. Invented data.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { strings } from '../strings.js';
import type { LiveWaiting, OffLineBranch } from '../research-link.js';

const people = new Map<string, string[]>();
vi.mock('../research-directions-write.js', async (importOriginal) => {
    const real = await importOriginal<typeof import('../research-directions-write.js')>();
    return { ...real, directionPeopleKept: () => people };
});

type Pick = { line: { id: string }; paused: boolean } | null;

describe('the direction a growing branch is added to', () => {
    let growingBranchLine: (s: unknown, w: LiveWaiting, b: OffLineBranch | undefined) => Pick;
    let waitBranchText: (w: LiveWaiting, s: unknown) => string;

    beforeAll(async () => {
        const m = await import('../ui/research-offline-ui.js') as unknown as {
            growingBranchLine: typeof growingBranchLine; waitBranchText: typeof waitBranchText;
        };
        growingBranchLine = m.growingBranchLine;
        waitBranchText = m.waitBranchText;
    }, 60000);

    const session = (pausedDown: boolean) => ({
        bridge: { base: 'http://127.0.0.1:1/x/' },
        researches: [
            { id: 'G0001', name: 'Předci: Eva Lhotáková', state: 'active' },
            { id: 'G0004', name: 'Potomci: Ludvík Brzobohatý', state: pausedDown ? 'paused' : 'active' },
            { id: 'G0005', name: 'Předci: Hedvika Lhotáková', state: 'done' },
        ],
        offLine: { mode: 'occasional', branches: [] },
    });
    const branch: OffLineBranch = {
        id: 'B-P0031', person: 'P0031', via: { person: 'P0012', rel: 'sibling' }, nearest: 'G0004',
        tasks: 5, persons: 5, samples: [], mode: 'occasional', own: false, grows: true,
    };
    const waiting = { id: 'W-B-P0031', what: '', kind: 'branch', branch: 'B-P0031', research: 'G0004', tasks: 5, persons: 5 } as unknown as LiveWaiting;

    it('the direction the research names, while it runs', () => {
        people.clear();
        people.set('P0012', ['G0004', 'G0001']);
        expect(growingBranchLine(session(false), waiting, branch)).toMatchObject({ line: { id: 'G0004' }, paused: false });
    });

    it('a paused one near: the narrowest running direction its person is in', () => {
        people.clear();
        people.set('P0012', ['G0004', 'G0005', 'G0001']);
        expect(growingBranchLine(session(true), waiting, branch)).toMatchObject({ line: { id: 'G0001' }, paused: false });
    });

    it('no running direction holds its person: the paused one, said so', () => {
        people.clear();
        people.set('P0012', ['G0004']);
        expect(growingBranchLine(session(true), waiting, branch)).toMatchObject({ line: { id: 'G0004' }, paused: true });
        // who is in which direction not read (an older research): the same
        people.clear();
        expect(growingBranchLine(session(true), waiting, branch)).toMatchObject({ line: { id: 'G0004' }, paused: true });
    });

    it('an ended one near and no running one: no direction to add to', () => {
        people.clear();
        expect(growingBranchLine(session(false), { ...waiting, research: 'G0005' } as LiveWaiting, { ...branch, nearest: 'G0005' })).toBeNull();
    });

    it('the sentence says a paused direction near is paused', () => {
        const L = strings.live;
        expect(waitBranchText(waiting, session(true))).toContain(`${'Potomci: Ludvík Brzobohatý'} ${L.dirNearPaused}`);
        expect(waitBranchText(waiting, session(false))).not.toContain(L.dirNearPaused);
    });
});
