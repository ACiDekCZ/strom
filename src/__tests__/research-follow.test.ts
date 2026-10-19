/**
 * Switching trees follows the research live where an agent works (spec 011,
 * U4b): what opening a tree comes to (running → follow, idle → editable,
 * off / blocked → passive, nothing recent → ask first), what the panel's
 * line says (started, moved, nothing for the same tree), the research's name
 * beside the tree's only when it differs, and the texts in three languages.
 * The switch asks bridges through askResearchBridge only, no timer of its own.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LiveStatus, LiveWorker } from '../research-link.js';
import { researchTreeState, BridgeAnswer } from '../research-others.js';
import { answerFresh, followNotice, followOnOpen, researchNameBeside, FOLLOW_FRESH_MS } from '../research-follow.js';
import { strings, setLanguage } from '../strings.js';

const worker = (paused = false): LiveWorker => ({
    who: 'agent', since: '2026-10-19T08:00:00Z', task: 'Matriky Kolín', research: 'G1',
    ...(paused ? { paused: { until: '2026-10-19T12:00:00Z', reason: 'limit' } } : {}),
});

function status(o: Partial<LiveStatus> = {}): LiveStatus {
    return {
        treeId: 'R1', name: 'Novákovi z Kolína', head: 'abc', headAt: '', persons: 10, families: 3, working: [], waiting: [], links: [],
        queue: [], queueMore: 0, update: null, spend: null, lastIntake: null, researches: [], accepts: null, inbox: null, sends: null,
        version: '', features: null, recent: null, batches: null, ...o,
    } as LiveStatus;
}
const up = (o: Partial<LiveStatus> = {}, at = 1000): BridgeAnswer => ({ result: 'up', status: status(o), at });
const off: BridgeAnswer = { result: 'off', status: null, at: 1000 };
const denied: BridgeAnswer = { result: 'denied', status: null, at: 1000 };

describe('answerFresh', () => {
    it('takes an answer up to 15 s old, asks again after', () => {
        expect(answerFresh(null, 5000)).toBe(false);
        expect(answerFresh(up(), 1000 + FOLLOW_FRESH_MS)).toBe(true);
        expect(answerFresh(up(), 1001 + FOLLOW_FRESH_MS)).toBe(false);
    });
});

describe('followOnOpen', () => {
    it('follows a tree where an agent works, nothing asked', () => {
        expect(followOnOpen(researchTreeState(up({ working: [worker()] })), true)).toBe('follow');
    });

    it('leaves a tree whose bridge answers with nobody at work editable (paused runs count as nobody)', () => {
        expect(followOnOpen(researchTreeState(up()), true)).toBe('idle');
        expect(followOnOpen(researchTreeState(up({ working: [worker(true)] })), true)).toBe('idle');
        // A research without its agent there: never followed by itself.
        expect(followOnOpen(researchTreeState(up({ working: [worker()], accepts: { mode: 'auto', agentHere: false } as never })), true)).toBe('idle');
    });

    it('is passive when the bridge does not answer, the browser keeps it away, or no address is known', () => {
        expect(followOnOpen(researchTreeState(off), true)).toBe('off');
        expect(followOnOpen(researchTreeState(denied), true)).toBe('off');
        expect(followOnOpen(researchTreeState(denied), false)).toBe('off');
        expect(followOnOpen(researchTreeState(up({ working: [worker()] }), { noAddress: true }), true)).toBe('off');
    });

    it('asks first when what is known is not recent (whatever it said)', () => {
        expect(followOnOpen(null, false)).toBe('ask');
        expect(followOnOpen(researchTreeState(up({ working: [worker()] })), false)).toBe('ask');
        expect(followOnOpen(researchTreeState(off), false)).toBe('ask');
        // Asked and still nothing: passive.
        expect(followOnOpen(null, true)).toBe('off');
    });

    it('never starts over a tree followed already', () => {
        expect(followOnOpen({ kind: 'live', lines: 2, waiting: 1 }, true)).toBe('idle');
    });
});

describe('followNotice', () => {
    const novak = { id: 't1', name: 'Novákovi z Kolína' };
    const dvorak = { id: 't2', name: 'Dvořákovi (Morava)' };

    it('says following began, naming the research tree open before', () => {
        expect(followNotice({ tree: novak })).toEqual({ kind: 'started', tree: 'Novákovi z Kolína' });
        expect(followNotice({ tree: novak, prevOpen: dvorak })).toEqual({ kind: 'started', tree: 'Novákovi z Kolína', prev: 'Dvořákovi (Morava)' });
        expect(followNotice({ tree: novak, prevOpen: novak })).toEqual({ kind: 'started', tree: 'Novákovi z Kolína' });
    });

    it('says following moved from the tree followed before', () => {
        expect(followNotice({ tree: novak, prevFollowed: dvorak, prevOpen: dvorak })).toEqual({ kind: 'moved', tree: 'Novákovi z Kolína', prev: 'Dvořákovi (Morava)' });
    });

    it('says nothing when the same tree is followed again', () => {
        expect(followNotice({ tree: novak, prevFollowed: novak })).toBeNull();
    });
});

describe('researchNameBeside', () => {
    it('names the research only when it says something else than the tree', () => {
        expect(researchNameBeside('Novákovi z Kolína', 'Novákovi z Kolína')).toBeUndefined();
        expect(researchNameBeside('Novákovi z Kolína', '  novákovi Z KOLÍNA ')).toBeUndefined();
        expect(researchNameBeside('Novákovi', '')).toBeUndefined();
        expect(researchNameBeside('Novákovi', null)).toBeUndefined();
        expect(researchNameBeside('Novákovi', ' Kolín 1850 ')).toBe('Kolín 1850');
    });
});

describe('texts', () => {
    it('say the tree followed, the research beside it only when given, in three languages, impersonally', () => {
        for (const lang of ['en', 'cs', 'de'] as const) {
            setLanguage(lang);
            const o = strings.otherResearch;
            const all = [
                o.followingTree('Novákovi'), o.followingTree('Novákovi', 'Kolín 1850'),
                o.followStarted('Novákovi'), o.followStarted('Novákovi', 'Dvořákovi'),
                o.followMoved('Novákovi', 'Dvořákovi'), o.agentStarted,
            ];
            expect(o.followingTree('Novákovi')).toContain('Novákovi');
            expect(o.followingTree('Novákovi')).not.toContain('Kolín 1850');
            expect(o.followingTree('Novákovi', 'Kolín 1850')).toContain('Kolín 1850');
            expect(o.followStarted('Novákovi')).not.toContain('Dvořákovi');
            expect(o.followStarted('Novákovi', 'Dvořákovi')).toContain('Dvořákovi');
            expect(o.followMoved('Novákovi', 'Dvořákovi')).toContain('Dvořákovi');
            for (const t of all) expect(t).not.toMatch(/\b(you|your|vy|váš|vaše|ty|tvůj|Sie|Ihr|du|dein)\b/i);
        }
        setLanguage('en');
    });
});

describe('the switch', () => {
    it('asks bridges through askResearchBridge only, with no timer of its own', () => {
        const src = readFileSync(fileURLToPath(new URL('../ui/research-follow-ui.ts', import.meta.url)), 'utf8');
        expect(src).toMatch(/askResearchBridge\(/);
        expect(src).not.toMatch(/pollResearchBridge/);
        expect(src).not.toMatch(/\bfetch\(|setInterval|setTimeout/);
    });
});
