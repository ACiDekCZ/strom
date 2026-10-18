/**
 * The other research trees' state (spec 011): how a tree's state follows from
 * its bridge's last answer (live, running, idle, off, blocked; an archive
 * never runs), which trees "Elsewhere" names and the switcher's dot, which
 * bridges a round asks (not the open tree, not copies, not archives), and the
 * poller: one ask at a time, one round at a time, only while the page is
 * seen, a hung bridge turning off after the limit, no retry. The app's asking
 * goes through askResearchBridge only (status only, nothing sent).
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LiveStatus, LiveWaiting, LiveWorker } from '../research-link.js';
import {
    agoShort, BridgeAnswer, elsewhereTrees, otherBridgeTargets, OtherBridgesPoller, researchTreeNoteworthy, researchTreesDot,
    researchTreeState, workingLines,
} from '../research-others.js';

const worker = (research?: string, paused = false): LiveWorker => ({
    who: 'agent', since: '2026-10-18T08:00:00Z', task: 'Matriky Kolín', research,
    ...(paused ? { paused: { until: '2026-10-18T12:00:00Z', reason: 'limit' } } : {}),
});
const waiting = (id: string): LiveWaiting => ({ id, what: `Dopis ${id}`, on: 'odpověď', at: '2026-10-17T08:00:00Z' });

function status(o: Partial<LiveStatus> = {}): LiveStatus {
    return {
        treeId: 'R1', name: 'Novákovi z Kolína', head: 'abc', headAt: '', persons: 10, families: 3, working: [], waiting: [], links: [],
        queue: [], queueMore: 0, update: null, spend: null, lastIntake: null, researches: [], accepts: null, inbox: null, sends: null,
        version: '', features: null, recent: null, batches: null, ...o,
    } as LiveStatus;
}
const up = (o: Partial<LiveStatus> = {}): BridgeAnswer => ({ result: 'up', status: status(o), at: 1 });

describe('researchTreeState', () => {
    it('is nothing before the first answer', () => {
        expect(researchTreeState(null)).toBeNull();
    });

    it('counts the directions at work, not the paused ones, and the waiting', () => {
        const s = researchTreeState(up({ working: [worker('G1'), worker('G1'), worker('G2'), worker('G3', true)], waiting: [waiting('a')] }));
        expect(s).toEqual({ kind: 'running', lines: 2, waiting: 1 });
        expect(workingLines([worker(), worker()])).toBe(1);
        expect(workingLines([worker(), worker('G1')])).toBe(2);
    });

    it('is idle when nobody works or every run is paused', () => {
        expect(researchTreeState(up({ waiting: [waiting('a'), waiting('b'), waiting('c')] }))).toEqual({ kind: 'idle', lines: 0, waiting: 3 });
        expect(researchTreeState(up({ working: [worker('G1', true)] }))?.kind).toBe('idle');
    });

    it('is off without an answer, a timeout or without an address', () => {
        expect(researchTreeState({ result: 'off', status: null, at: 1 })).toEqual({ kind: 'off', lines: 0, waiting: 0 });
        expect(researchTreeState(null, { noAddress: true })?.kind).toBe('off');
        expect(researchTreeState(up({ working: [worker('G1')] }), { noAddress: true })?.kind).toBe('off');
    });

    it('is blocked when the browser denies the local network', () => {
        expect(researchTreeState({ result: 'denied', status: null, at: 1 })?.kind).toBe('blocked');
    });

    it('is live while followed, with its directions and waiting', () => {
        const s = researchTreeState({ result: 'off', status: null, at: 1 }, { live: { working: [worker('G1'), worker('G2')], waiting: [waiting('a')] } });
        expect(s).toEqual({ kind: 'live', lines: 2, waiting: 1 });
    });

    it('never runs nor waits in an archive or without its agent', () => {
        const archive = { mode: 'archive' } as LiveStatus['accepts'];
        expect(researchTreeState(up({ accepts: archive, working: [worker('G1')], waiting: [waiting('a')] }))).toEqual({ kind: 'idle', lines: 0, waiting: 0 });
        const agentless = { mode: 'agent', agentHere: false } as LiveStatus['accepts'];
        expect(researchTreeState(up({ accepts: agentless, working: [worker('G1')] }))?.kind).toBe('idle');
        expect(researchTreeState(null, { live: { working: [worker('G1')], waiting: [waiting('a')], accepts: archive } }))
            .toEqual({ kind: 'live', lines: 0, waiting: 0 });
    });
});

describe('Elsewhere and the dot', () => {
    const running = { kind: 'running' as const, lines: 2, waiting: 1 };
    const idleWaiting = { kind: 'idle' as const, lines: 0, waiting: 3 };
    const onlyRunning = { kind: 'running' as const, lines: 1, waiting: 0 };
    const idle = { kind: 'idle' as const, lines: 0, waiting: 0 };
    const off = { kind: 'off' as const, lines: 0, waiting: 0 };

    it('names running trees and trees with something waiting, waiting first, then by name', () => {
        const trees = [
            { name: 'Svobodovi', state: off }, { name: 'Bartošovi', state: onlyRunning }, { name: 'Dvořákovi (Morava)', state: idleWaiting },
            { name: 'Novákovi z Kolína', state: running }, { name: 'Malí', state: idle }, { name: 'Bez výzkumu', state: null },
        ];
        expect(elsewhereTrees(trees, 'cs').map(t => t.name)).toEqual(['Dvořákovi (Morava)', 'Novákovi z Kolína', 'Bartošovi']);
        expect(researchTreeNoteworthy({ kind: 'blocked', lines: 0, waiting: 0 })).toBe(false);
    });

    it('is amber when something waits anywhere, green when something only runs, none for off', () => {
        expect(researchTreesDot([onlyRunning, idleWaiting])).toBe('waiting');
        expect(researchTreesDot([onlyRunning, idle])).toBe('running');
        expect(researchTreesDot([off, idle, null])).toBeNull();
    });

    it('says how long ago in the short form', () => {
        const now = Date.UTC(2026, 9, 18, 12);
        expect(agoShort(now - 3 * 3_600_000, now, 'en')).toMatch(/3 hr/);
        expect(agoShort(now - 2 * 86_400_000, now, 'cs')).toMatch(/2/);
        expect(agoShort(now - 10_000, now, 'de')).toMatch(/1 Min/);
    });
});

describe('otherBridgeTargets', () => {
    const e = (treeId: string, researchId: string, o: Partial<{ copy: boolean; archive: boolean; hasAddress: boolean }> = {}) =>
        ({ treeId, researchId, copy: false, archive: false, hasAddress: true, ...o });

    it('asks the other trees once each, not the open tree, copies, archives or trees without an address', () => {
        const entries = [
            e('t1', 'R1'), e('t2', 'R2'), e('t2c', 'R2', { copy: true }), e('t3', 'R3', { archive: true }), e('t4', 'R4', { hasAddress: false }),
            e('t5', 'R5'), e('t5b', 'R5'), e('t1c', 'R1', { copy: true }),
        ];
        expect(otherBridgeTargets(entries, 't1')).toEqual(['R2', 'R5']);
        expect(otherBridgeTargets(entries, 't1', ['R5'])).toEqual(['R2']);
        // A copy open: its research's bridge is the open tree's own ask.
        expect(otherBridgeTargets(entries, 't2c')).toEqual(['R1', 'R5']);
    });
});

describe('OtherBridgesPoller', () => {
    const timings = { first: 3000, every: 60_000, fresh: 15_000, timeout: 1500 };
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    /** A fetch-like ask with an AbortSignal limit, as askResearchBridge does it. */
    function makeAsk(fetcher: (id: string, signal: AbortSignal) => Promise<LiveStatus>, log: { inFlight: number; max: number; asked: string[] }) {
        return async (id: string, timeout: number): Promise<BridgeAnswer> => {
            log.inFlight++;
            log.max = Math.max(log.max, log.inFlight);
            log.asked.push(id);
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), timeout);
            try {
                const s = await fetcher(id, ctrl.signal);
                return { result: 'up', status: s, at: Date.now() };
            } catch {
                return { result: 'off', status: null, at: Date.now() };
            } finally {
                clearTimeout(timer);
                log.inFlight--;
            }
        };
    }
    const hang = (signal: AbortSignal) => new Promise<LiveStatus>((_, reject) => signal.addEventListener('abort', () => reject(new Error('abort'))));
    const after = (ms: number, s: LiveStatus) => new Promise<LiveStatus>(resolve => setTimeout(() => resolve(s), ms));

    it('asks one bridge at a time, a hung one turning off after the limit, and rounds about every minute', async () => {
        const log = { inFlight: 0, max: 0, asked: [] as string[] };
        const answers = new Map<string, BridgeAnswer>();
        let rounds = 0;
        const fetcher = vi.fn((id: string, signal: AbortSignal) => id === 'R2' ? hang(signal) : after(200, status({ treeId: id, working: [worker('G1')] })));
        const poller = new OtherBridgesPoller({
            targets: () => ['R1', 'R2', 'R3'], ask: makeAsk(fetcher, log), visible: () => true, enabled: () => true,
            onAnswer: (id, a) => answers.set(id, a), onRound: () => rounds++, timings: () => timings,
        });
        poller.start();
        await vi.advanceTimersByTimeAsync(2999);
        expect(log.asked).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        await vi.advanceTimersByTimeAsync(200);
        expect(answers.get('R1')?.result).toBe('up');
        expect(log.asked).toEqual(['R1', 'R2']);
        await vi.advanceTimersByTimeAsync(1499);
        expect(answers.has('R2')).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(answers.get('R2')?.result).toBe('off');
        expect(researchTreeState(answers.get('R2')!)?.kind).toBe('off');
        await vi.advanceTimersByTimeAsync(200);
        expect(answers.get('R3')?.result).toBe('up');
        expect(rounds).toBe(1);
        expect(log.max).toBe(1);
        // No retry: R2 is asked again only in the next round.
        expect(log.asked).toEqual(['R1', 'R2', 'R3']);
        await vi.advanceTimersByTimeAsync(59_999);
        expect(log.asked.length).toBe(3);
        await vi.advanceTimersByTimeAsync(1);
        expect(log.asked.length).toBe(4);
        await vi.advanceTimersByTimeAsync(5000);
        expect(rounds).toBe(2);
        expect(log.max).toBe(1);
        poller.stop();
    });

    it('never runs two rounds at once and asks on opening only when the last round is older than the freshness', async () => {
        const log = { inFlight: 0, max: 0, asked: [] as string[] };
        const poller = new OtherBridgesPoller({
            targets: () => ['R1', 'R2'], ask: makeAsk((id) => after(1000, status({ treeId: id })), log), visible: () => true, enabled: () => true,
            onAnswer: () => {}, timings: () => timings,
        });
        poller.start();
        await vi.advanceTimersByTimeAsync(3000);
        expect(poller.busy).toBe(true);
        poller.kick(0);
        void poller.round();
        await vi.advanceTimersByTimeAsync(2000);
        expect(log.asked).toEqual(['R1', 'R2']);
        expect(log.max).toBe(1);
        // Fresh: opening the switcher 10 s later asks nothing.
        await vi.advanceTimersByTimeAsync(10_000);
        poller.kick();
        await vi.advanceTimersByTimeAsync(0);
        expect(log.asked.length).toBe(2);
        // Older than 15 s: it asks at once.
        await vi.advanceTimersByTimeAsync(6000);
        poller.kick();
        await vi.advanceTimersByTimeAsync(2000);
        expect(log.asked.length).toBe(4);
        poller.stop();
    });

    it('asks nothing while the page is hidden or the device has no access to bridges', async () => {
        const log = { inFlight: 0, max: 0, asked: [] as string[] };
        let visible = false;
        let enabled = true;
        const poller = new OtherBridgesPoller({
            targets: () => ['R1'], ask: makeAsk((id) => after(10, status({ treeId: id })), log), visible: () => visible, enabled: () => enabled,
            onAnswer: () => {}, timings: () => timings,
        });
        poller.start();
        await vi.advanceTimersByTimeAsync(3000);
        poller.kick(0);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(log.asked).toEqual([]);
        visible = true;
        enabled = false;
        await vi.advanceTimersByTimeAsync(60_000);
        poller.kick(0);
        expect(log.asked).toEqual([]);
        enabled = true;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(log.asked).toEqual(['R1']);
        poller.stop();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(log.asked).toEqual(['R1']);
    });

    it('a thrown ask counts as off and does not stop the round', async () => {
        const answers = new Map<string, BridgeAnswer>();
        const poller = new OtherBridgesPoller({
            targets: () => ['R1', 'R2'],
            ask: async (id) => { if (id === 'R1') throw new Error('x'); return up({ treeId: id }); },
            visible: () => true, enabled: () => true, onAnswer: (id, a) => answers.set(id, a), timings: () => timings,
        });
        await poller.round();
        expect(answers.size).toBe(0);
        poller.start();
        await vi.advanceTimersByTimeAsync(3000);
        expect(answers.get('R1')?.result).toBe('off');
        expect(answers.get('R2')?.result).toBe('up');
        poller.stop();
    });
});

describe('the app asks other bridges for their status only', () => {
    it('goes through askResearchBridge, never pollResearchBridge (which sends edits and fetches originals)', () => {
        const src = readFileSync(fileURLToPath(new URL('../ui/research-others-ui.ts', import.meta.url)), 'utf8');
        expect(src).toMatch(/askResearchBridge\(/);
        expect(src).not.toMatch(/pollResearchBridge/);
        expect(src).not.toMatch(/\bfetch\(/);
    });
});
