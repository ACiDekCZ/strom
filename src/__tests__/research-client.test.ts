/**
 * The device of a send (spec 094 K2.4): what the app sends to the bridge
 * (`_STROM_CLIENT` in the header, never in a file), what it reads back from
 * the bridge (`/status.sends[].client`, `/log entries[].via`, the two sends
 * of a conflict in a send's answer) and the sides of a conflict kept for
 * later. An older bridge says none of it: nothing new. Invented data.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    researchHeaderLines, sanitizeResearchClient, sanitizeSends, sanitizeLiveLog, sanitizeSyncReply, conflictSentOf,
    type SyncConflictSent,
} from '../research-link.js';
import { exportToGedcom } from '../ged-exporter.js';
import { createEmptyData } from '../data.js';
import {
    rememberConflictSent, researchConflictSides, forgetConflictSent, mergeConflictSent, conflictSidesOf,
    researchAutoState, patchResearchAutoState, CONFLICT_SENT_MOST,
} from '../research-device.js';

const RID = 'a1b2c3d4-0000-4000-8000-0000000000a1';
const MAC = { id: '7f3c2a10-1b2c-4d5e-8f90-a1b2c3d4e5f6', name: 'Chrome · Mac' };
const WIN = { id: 'c0ffee00-0000-4000-8000-000000000002', name: 'Edge · Windows' };

describe('the header of a send names the sending browser', () => {
    it('beside the state sent: `_STROM_CLIENT` and its name', () => {
        const lines = researchHeaderLines({ id: RID, appTree: 'tree_1700000000000_ab12c', sent: 'v2-1k3f-abc-def', client: MAC });
        expect(lines).toEqual([
            `1 _STROM_TREE ${RID}`, '1 _STROM_APP_TREE tree_1700000000000_ab12c', '1 _STROM_SENT v2-1k3f-abc-def',
            `1 _STROM_CLIENT ${MAC.id}`, '2 NAME Chrome · Mac',
        ]);
    });

    it('without a name: the id alone', () => {
        expect(researchHeaderLines({ id: RID, client: { id: 'dev-1' } })).toEqual([`1 _STROM_TREE ${RID}`, '1 _STROM_CLIENT dev-1']);
    });

    it('an id of a wrong shape: no device; a name never breaks the line', () => {
        expect(researchHeaderLines({ id: RID, client: { id: 'has spaces', name: 'Chrome · Mac' } })).toEqual([`1 _STROM_TREE ${RID}`]);
        expect(researchHeaderLines({ id: RID, client: { id: 'dev-1', name: 'Chrome\n0 @I1@ INDI' } }))
            .toEqual([`1 _STROM_TREE ${RID}`, '1 _STROM_CLIENT dev-1', '2 NAME Chrome 0 @I1@ INDI']);
    });

    it('an exported file never carries it (only a send to the bridge gives the device)', () => {
        const ged = exportToGedcom(createEmptyData(), 'Hrotkovi', { research: { id: RID, head: 'aaaaaaa' } }).content;
        expect(ged).toContain(`1 _STROM_TREE ${RID}`);
        expect(ged).not.toContain('_STROM_CLIENT');
        const sent = exportToGedcom(createEmptyData(), 'Hrotkovi', { research: { id: RID, sent: 'v2-x', client: WIN } }).content;
        expect(sent).toMatch(/^1 _STROM_SENT v2-x\r?\n1 _STROM_CLIENT c0ffee00-0000-4000-8000-000000000002\r?\n2 NAME Edge · Windows$/m);
    });
});

describe('a device as the bridge names it', () => {
    it('id and name, checked', () => {
        expect(sanitizeResearchClient(MAC)).toEqual(MAC);
        expect(sanitizeResearchClient({ id: 'dev-1' })).toEqual({ id: 'dev-1' });
        expect(sanitizeResearchClient({ id: 'dev-1', name: '   ' })).toEqual({ id: 'dev-1' });
        expect(sanitizeResearchClient({ id: 'dev-1', name: 42 })).toEqual({ id: 'dev-1' });
    });

    it('a bad id drops the device', () => {
        expect(sanitizeResearchClient({ id: 'x'.repeat(65), name: 'Chrome · Mac' })).toBeNull();
        expect(sanitizeResearchClient({ id: 'a/b' })).toBeNull();
        expect(sanitizeResearchClient({ name: 'Chrome · Mac' })).toBeNull();
        expect(sanitizeResearchClient('dev-1')).toBeNull();
        expect(sanitizeResearchClient(null)).toBeNull();
        expect(sanitizeResearchClient(undefined)).toBeNull();
    });

    it('the name: one line, no control or direction characters, at most 60 graphemes; a broken one none', () => {
        expect(sanitizeResearchClient({ id: 'd', name: 'Chrome\u0000 ·‮ Mac\n' })).toEqual({ id: 'd', name: 'Chrome · Mac' });
        const long = sanitizeResearchClient({ id: 'd', name: '👨‍👩‍👧'.repeat(70) });
        expect(long?.name).toBe('👨‍👩‍👧'.repeat(60));
        expect(sanitizeResearchClient({ id: 'd', name: 'Chrome � Mac' })).toEqual({ id: 'd' });
        expect(sanitizeResearchClient({ id: 'd', name: 'Chrome \uD800 Mac' })).toEqual({ id: 'd' });
    });
});

describe('/status.sends[].client', () => {
    const send = (extra: Record<string, unknown>) => ({ intake: 'R20261124101500000-a1b2', at: '2026-11-24T10:15:00Z', state: 'written', ...extra });

    it('a send with its device', () => {
        expect(sanitizeSends([send({ client: WIN })])?.[0].client).toEqual(WIN);
    });

    it('a bad id: no device, the send kept', () => {
        const [rec] = sanitizeSends([send({ client: { id: 'bad id', name: 'Edge · Windows' } })])!;
        expect(rec.intake).toBe('R20261124101500000-a1b2');
        expect('client' in rec).toBe(false);
    });

    it('an older bridge: none said, nothing new', () => {
        const [rec] = sanitizeSends([send({})])!;
        expect('client' in rec).toBe(false);
    });
});

describe('/log entries[].via', () => {
    const entry = (extra: Record<string, unknown>) => ({ head: 'abc1234', at: '2026-11-24T10:15:00Z', what: ['P0001'], ...extra });

    it('an entry a send wrote names its device', () => {
        expect(sanitizeLiveLog({ entries: [entry({ via: MAC })] })?.[0].via).toEqual(MAC);
        expect(sanitizeLiveLog({ entries: [entry({ via: { id: 'dev-1' } })] })?.[0].via).toEqual({ id: 'dev-1' });
    });

    it('a bad id, or none (an older bridge, the agent\'s own commit): no via', () => {
        expect('via' in sanitizeLiveLog({ entries: [entry({ via: { id: '' } })] })![0]).toBe(false);
        expect('via' in sanitizeLiveLog({ entries: [entry({})] })![0]).toBe(false);
    });
});

describe('the two sends of a conflict (POST /sync conflicts[].sent)', () => {
    const conflict = (extra: Record<string, unknown>) => ({ id: 'X0007', person: 'P0012', fact: 'BIRT', take: true,
        sides: { user: '1904', research: '1906' }, ...extra });

    it('the earlier send (its value stands) and the later one, each with its device', () => {
        const reply = sanitizeSyncReply({ ok: true, conflicts: [conflict({
            sent: { user: { client: WIN }, research: { input: 'I0003', client: MAC } },
        })] });
        expect(reply.conflictSent).toEqual([{ id: 'X0007', earlier: { client: MAC, input: 'I0003' }, later: { client: WIN } }]);
        expect(reply.conflictIds).toEqual(['X0007']);
    });

    it('a send without a device (an older app): that side without one', () => {
        expect(conflictSentOf([conflict({ sent: { user: { client: WIN }, research: { input: 'I0003' } } })]))
            .toEqual([{ id: 'X0007', earlier: { input: 'I0003' }, later: { client: WIN } }]);
        expect(conflictSentOf([conflict({ sent: { user: {}, research: {} } })]))
            .toEqual([{ id: 'X0007', earlier: {}, later: {} }]);
    });

    it('a bad id drops that device, a bad input is left out', () => {
        expect(conflictSentOf([conflict({ sent: { user: { client: { id: 'no good' } }, research: { input: 'X1', client: { id: '' } } } })]))
            .toEqual([{ id: 'X0007', earlier: {}, later: {} }]);
    });

    it('no `sent` (a conflict with the research\'s own value, an older bridge): none', () => {
        expect(sanitizeSyncReply({ ok: true, conflicts: [conflict({})] }).conflictSent).toEqual([]);
        expect(sanitizeSyncReply({ ok: true, conflicts: 2 }).conflictSent).toEqual([]);
        expect(conflictSentOf([conflict({ sent: 'yes' }), conflict({ id: 'bad', sent: { user: {} } })])).toEqual([]);
    });

    it('each conflict once, at most 20', () => {
        const many = Array.from({ length: 30 }, (_, i) => conflict({ id: `X${String(i + 1).padStart(4, '0')}`, sent: { user: { client: WIN } } }));
        const got = conflictSentOf([...many.slice(0, 2), many[0], ...many.slice(2)]);
        expect(got).toHaveLength(20);
        expect(got.map(c => c.id).slice(0, 3)).toEqual(['X0001', 'X0002', 'X0003']);
    });
});

function memoryStorage(): Storage {
    const store = new Map<string, string>();
    return {
        get length() { return store.size; },
        clear: () => store.clear(),
        getItem: (k: string) => store.get(k) ?? null,
        key: (i: number) => [...store.keys()][i] ?? null,
        removeItem: (k: string) => { store.delete(k); },
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
    };
}

const sent = (id: string, earlier?: { id: string; name?: string }, later?: { id: string; name?: string }, input?: string): SyncConflictSent => ({
    id, earlier: { ...(earlier ? { client: earlier } : {}), ...(input ? { input } : {}) }, later: later ? { client: later } : {},
});

describe('the sides of a conflict, kept per tree', () => {
    const TREE = 'tree_1700000000000_ab12c';
    let storage: Storage;
    beforeEach(() => { storage = memoryStorage(); vi.stubGlobal('localStorage', storage); });
    afterEach(() => vi.unstubAllGlobals());

    it('kept from the answer, read later (after a reload too), other state kept beside it', () => {
        rememberConflictSent(TREE, [sent('X0007', MAC, WIN, 'I0003')]);
        patchResearchAutoState(TREE, { edits: 3 });
        // A reload: everything is read from the storage again.
        const raw = storage.getItem(`strom-research-auto:${TREE}`)!;
        storage.clear();
        storage.setItem(`strom-research-auto:${TREE}`, raw);
        expect(researchConflictSides(TREE, 'X0007')).toEqual({ earlier: MAC, later: WIN });
        expect(researchAutoState(TREE).edits).toBe(3);
        expect(researchConflictSides(TREE, 'X0008')).toBeNull();
        expect(researchConflictSides('tree_other', 'X0007')).toBeNull();
    });

    it('a side without a device stays empty', () => {
        rememberConflictSent(TREE, [sent('X0007', undefined, WIN)]);
        expect(researchConflictSides(TREE, 'X0007')).toEqual({ earlier: {}, later: WIN });
    });

    it('an older bridge (nothing said): nothing kept', () => {
        rememberConflictSent(TREE, []);
        expect(storage.getItem(`strom-research-auto:${TREE}`)).toBeNull();
        expect(researchAutoState(TREE).conflictSent).toBeUndefined();
    });

    it('decided: forgotten', () => {
        rememberConflictSent(TREE, [sent('X0007', MAC, WIN), sent('X0009', WIN, MAC)]);
        forgetConflictSent(TREE, 'X0007');
        expect(researchConflictSides(TREE, 'X0007')).toBeNull();
        expect(researchConflictSides(TREE, 'X0009')).toEqual({ earlier: WIN, later: MAC });
        forgetConflictSent(TREE, 'X0009');
        expect(researchAutoState(TREE).conflictSent).toBeUndefined();
    });

    it('named again: the new sides; at most 50, the oldest go', () => {
        rememberConflictSent(TREE, [sent('X0001', MAC, WIN)]);
        rememberConflictSent(TREE, Array.from({ length: CONFLICT_SENT_MOST + 5 }, (_, i) => sent(`X${1000 + i}`, MAC, WIN)));
        rememberConflictSent(TREE, [sent('X1010', WIN, MAC)]);
        const kept = researchAutoState(TREE).conflictSent!;
        expect(kept).toHaveLength(CONFLICT_SENT_MOST);
        expect(researchConflictSides(TREE, 'X0001')).toBeNull();
        expect(researchConflictSides(TREE, 'X1004')).toBeNull();
        expect(researchConflictSides(TREE, 'X1005')).toEqual({ earlier: MAC, later: WIN });
        expect(kept[kept.length - 1].id).toBe('X1010');
        expect(researchConflictSides(TREE, 'X1010')).toEqual({ earlier: WIN, later: MAC });
    });

    it('a stored state is read like any outside input', () => {
        storage.setItem(`strom-research-auto:${TREE}`, JSON.stringify({ conflictSent: [
            { id: 'X0007', earlier: { id: MAC.id, name: MAC.name, input: 'I0003' }, later: { id: WIN.id } },
            { id: 'nope', earlier: {}, later: {} },
            { id: 'X0008', earlier: { id: 'bad id' }, later: {} },
            { id: 'X0009', earlier: 'x', later: {} },
        ] }));
        expect(researchAutoState(TREE).conflictSent).toEqual([
            { id: 'X0007', earlier: { id: MAC.id, name: MAC.name, input: 'I0003' }, later: { id: WIN.id } },
        ]);
    });

    it('the pure helpers', () => {
        const stored = mergeConflictSent(undefined, [sent('X0002', MAC, undefined, 'I0001')], 3);
        expect(stored).toEqual([{ id: 'X0002', earlier: { ...MAC, input: 'I0001' }, later: {} }]);
        expect(conflictSidesOf(stored, ' X0002 ')).toEqual({ earlier: MAC, later: {} });
        expect(conflictSidesOf(stored, 'P0002')).toBeNull();
        expect(conflictSidesOf(undefined, 'X0002')).toBeNull();
    });
});
