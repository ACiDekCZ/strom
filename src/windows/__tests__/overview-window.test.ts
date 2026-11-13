/**
 * The contract of the Research overview in a window of its own (spec 079 K3):
 * a snapshot crosses as a structured clone and names nothing of the bridge's
 * address or token; a session gives up its stream, timers and promise chain;
 * the actions an overview window may ask for are checked before they run (a
 * research link is named, never an address).
 */

import { describe, it, expect } from 'vitest';
import type { LiveSession } from '../../ui/research-ui.js';
import {
    OVERVIEW_ACTION_IDS, OVERVIEW_ACTIONS_TO_MAIN, bridgeSecrets, cloneSafe, overviewSessionData, overviewSessionFromData, readOverviewAction,
} from '../overview-window.js';

const BASE = 'http://127.0.0.1:47123/b/Zq8tY2kQw9xLmN4p/';

class FakeEventSource { close(): void { /* nothing */ } }

function session(): LiveSession {
    return {
        bridge: { base: BASE, status: `${BASE}status`, ged: `${BASE}ged`, events: `${BASE}events`, log: `${BASE}log` },
        researchId: 'R1', treeId: 't1', name: 'Okurkovi', head: 'abc', headAt: '', working: [], waiting: [
            { id: 'W1', kind: 'question', title: 'Answer it', note: `see ${BASE}x` },
        ], features: null, accepts: null, queue: [], queueMore: 0, update: null, spend: null, lastIntake: null, researches: [],
        autoCollapsed: new Set(['queue']), seenWaiting: new Set(['W1']), waitingPendingOpen: new Set(), overviewShown: new Set(),
        waitingView: { open: new Set(['W1']) }, seenInSection: 0, startedAt: 1, startPersons: 2, startSources: 3, overview: true,
        logged: false, changes: [], adds: [], recent: null, ended: false, collapsed: false, seenChanges: 0,
        es: new FakeEventSource(), timer: setTimeout(() => {}, 0), statusSoon: setTimeout(() => {}, 0), failures: 0, lostSince: null,
        chain: Promise.resolve(),
    } as unknown as LiveSession;
}

describe('the snapshot crosses windows', () => {
    it('a session: no bridge, stream, timers or chain; a structured clone takes it; the token is nowhere', () => {
        const s = session();
        const data = overviewSessionData(s, bridgeSecrets(s.bridge.base));
        for (const k of ['bridge', 'es', 'timer', 'statusSoon', 'chain']) expect(k in data).toBe(false);
        const cloned = structuredClone(data);
        expect(cloned.name).toBe('Okurkovi');
        expect(cloned.autoCollapsed).toEqual(new Set(['queue']));
        expect(JSON.stringify({ ...cloned, sets: [...cloned.seenWaiting] })).not.toContain('Zq8tY2kQw9xLmN4p');
        // A string naming the bridge is left out, the item stays.
        expect(cloned.waiting[0]).toEqual({ id: 'W1', kind: 'question', title: 'Answer it' });
        clearTimeout(s.timer!);
        clearTimeout(s.statusSoon!);
    });

    it('cloneSafe leaves out functions, promises, DOM-like and other class instances; keeps Maps, Sets and Dates', () => {
        const out = cloneSafe({
            n: 1, f: () => 1, p: Promise.resolve(), c: new FakeEventSource(), list: [1, () => 2, 'x'],
            m: new Map<string, unknown>([['a', 1], ['b', () => 1]]), d: new Date(5), nested: { ok: true, bad: Symbol('s') },
        }) as Record<string, unknown>;
        expect(out).toEqual({ n: 1, list: [1, null, 'x'], m: new Map([['a', 1]]), d: new Date(5), nested: { ok: true } });
        expect(() => structuredClone(out)).not.toThrow();
    });

    it('bridgeSecrets: the address and its token, whatever form the address takes', () => {
        expect(bridgeSecrets(BASE, null, '')).toEqual(expect.arrayContaining([BASE, 'Zq8tY2kQw9xLmN4p']));
        expect(bridgeSecrets('http://127.0.0.1:1/?t=SECRETSECRET')).toContain('t=SECRETSECRET');
    });

    it('the window\'s session has an empty bridge: nothing it draws reaches the bridge', () => {
        const s = overviewSessionFromData(overviewSessionData(session(), [BASE]));
        expect(s.bridge).toEqual({ base: '', status: '', ged: '', events: '', log: '' });
        expect(s.es).toBeNull();
        expect(s.timer).toBeNull();
    });
});

describe('the actions an overview window may ask for', () => {
    it('every action of the list is known to the check', () => {
        expect(new Set(OVERVIEW_ACTION_IDS).size).toBe(OVERVIEW_ACTION_IDS.length);
        for (const id of OVERVIEW_ACTIONS_TO_MAIN) expect(OVERVIEW_ACTION_IDS).toContain(id);
    });

    it('valid ones pass with only what they take', () => {
        expect(readOverviewAction('show-person', { personId: 'P1', extra: 1 })).toEqual({ action: 'show-person', args: { personId: 'P1' } });
        expect(readOverviewAction('line-move', { directionId: 'D1', move: { drop: 2 } })).toEqual({ action: 'line-move', args: { directionId: 'D1', move: { drop: 2 } } });
        expect(readOverviewAction('hover-person', { personId: null })).toEqual({ action: 'hover-person', args: { personId: null } });
        expect(readOverviewAction('turn-on', undefined)).toEqual({ action: 'turn-on' });
        expect(readOverviewAction('direction-found', { directionId: 'D1' })).toEqual({ action: 'direction-found', args: { directionId: 'D1' } });
        expect(readOverviewAction('research-link', { link: 'chat', params: { tree: 'other', person: 'P0012' } }))
            .toEqual({ action: 'research-link', args: { link: 'chat', params: { person: 'P0012' } } });
        // Work on the queue (spec 052 §5): the choice as text, the agent's toast in the main window.
        expect(readOverviewAction('research-link', { link: 'work', params: { workDo: 'tasks', n: '7' }, kind: 'agent' }))
            .toEqual({ action: 'research-link', args: { link: 'work', params: { workDo: 'tasks', n: '7' }, kind: 'agent' } });
        expect(readOverviewAction('queue-more', { filter: { state: 'next' }, slot: 'queue', seed: { items: [], total: 40 } }))
            .toEqual({ action: 'queue-more', args: { filter: { state: 'next' }, slot: 'queue', seed: { items: [], total: 40 } } });
        // A task's own place in the queue (K3 – S2 #1): written by the main window.
        expect(readOverviewAction('queue-order', { task: 'T1', do: 'next', extra: 1 })).toEqual({ action: 'queue-order', args: { task: 'T1', do: 'next' } });
        expect(readOverviewAction('queue-order', { task: 'T1', do: 'default' })).toEqual({ action: 'queue-order', args: { task: 'T1', do: 'default' } });
        // queue.next's Undo: the place before, as the bridge said it.
        expect(readOverviewAction('queue-order', { task: 'T1', do: 'restore', was: { own: 'next', at: '2026-11-13T08:00:00Z' } }))
            .toEqual({ action: 'queue-order', args: { task: 'T1', do: 'restore', was: { own: 'next', at: '2026-11-13T08:00:00Z' } } });
        expect(readOverviewAction('queue-order', { task: 'T1', do: 'restore', was: {} })).toEqual({ action: 'queue-order', args: { task: 'T1', do: 'restore', was: {} } });
        expect(readOverviewAction('queue-order', { task: 'T1', do: 'restore' })).toBeNull();
        expect(readOverviewAction('queue-order', { task: 'T1', do: 'restore', was: { own: 'next' } })).toBeNull();
    });

    it('anything else is refused', () => {
        expect(readOverviewAction('eval', {})).toBeNull();
        expect(readOverviewAction('show-person', { personId: '' })).toBeNull();
        expect(readOverviewAction('line-state', { directionId: 'D1', do: 'delete' })).toBeNull();
        expect(readOverviewAction('line-move', { directionId: 'D1', move: { drop: -1 } })).toBeNull();
        expect(readOverviewAction('follow-view', { view: 'table' })).toBeNull();
        // A research link is one of the research's actions with plain parameters, never an address.
        expect(readOverviewAction('research-link', { link: 'https://example.org' })).toBeNull();
        expect(readOverviewAction('research-link', { link: 'chat', params: { person: { toString: 1 } } })).toBeNull();
        expect(readOverviewAction('waiting-file', { itemId: 'W1', file: 'not a file' })).toBeNull();
        expect(readOverviewAction('queue-list', { filter: { state: 'all' }, slot: 'queue' })).toBeNull();
        expect(readOverviewAction('queue-order', { task: 'T1', do: 'first' })).toBeNull();
        expect(readOverviewAction('queue-order', { task: '', do: 'next' })).toBeNull();
    });
});
