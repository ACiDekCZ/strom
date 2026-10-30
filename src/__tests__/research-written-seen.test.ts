/**
 * "Written to the research … · What was written ›" is news only until seen
 * (1028): a write seen once stays seen when the app remembers the same write
 * again — its send closed anew from the bridge's record after the bridge
 * started again (an update), with the research's own time — while another
 * write is news again. A write that left conflicts stays in sight. Invented data.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { researchAutoState, patchResearchAutoState, researchWriteIsNews, researchWriteKey } from '../research-device.js';
import { researchSyncState, ResearchSyncInput } from '../research-sync.js';
import { TreeManager } from '../tree-manager.js';
import { DataManager } from '../data.js';
import type { ResearchLink, TreeId } from '../types.js';

const TREE = 'tree_1700000000000_ab12c' as TreeId;
const RID = '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10';
const WRITTEN_AT = '2026-10-24T08:52:00Z';

type Ui = {
    researchNoteWrittenSeen(treeId: TreeId): void;
    settleResearchSend(treeId: TreeId, status: unknown): Promise<void>;
};

describe('a write already seen is no news', () => {
    let methods: Record<string, unknown>;
    let store: Map<string, string>;
    let link: ResearchLink;

    beforeAll(async () => {
        const { researchSyncMethods } = await import('../ui/research-sync-ui.js') as unknown as { researchSyncMethods: Record<string, unknown> };
        methods = researchSyncMethods;
    }, 60000);

    beforeEach(() => {
        store = new Map();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
            key: (i: number) => [...store.keys()][i] ?? null,
            get length() { return store.size; },
        });
        link = { id: RID, fingerprint: 'f1', syncedAt: '2026-10-20T08:00:00Z', head: 'h1' } as ResearchLink;
        vi.spyOn(TreeManager, 'getTreeMetadata').mockImplementation(() => ({ research: link }) as never);
        vi.spyOn(TreeManager, 'patchResearchLink').mockImplementation((_id, patch) => { link = { ...link, ...patch } as ResearchLink; return true as never; });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    const ui = (): Ui => ({ ...methods, refreshResearchSyncUi: () => undefined, researchNoteWritten: () => undefined } as unknown as Ui);
    const written = (intake: string, at = WRITTEN_AT, conflicts = 0): void =>
        patchResearchAutoState(TREE, { lastWritten: { at, changes: 10, conflicts, intake, fingerprint: 'f1' } });
    /** The menu's state of the tree, the bridge up and nothing to send or load. */
    const kind = (): string => {
        const st = researchAutoState(TREE);
        const input: ResearchSyncInput = {
            link, capable: true, shown: true, matchesBase: true, current: 'f1', bridgeUp: true, remoteHead: 'h1',
            written: researchWriteIsNews(st) ? st.lastWritten ?? null : null,
        } as ResearchSyncInput;
        return researchSyncState(input).kind;
    };
    /** The bridge's status after it started again: its record of the send written on 24 October. */
    const statusWith = (intake: string) => ({
        inbox: null, head: 'h2', lastIntake: null,
        sends: [{ intake, at: '2026-10-24T08:50:00Z', state: 'written', changes: 10, tries: null, tree: TREE, sent: 'f1',
            decidedAt: WRITTEN_AT, reason: '', conflicts: null, conflictPersons: [] }],
    });

    it('a write not seen yet is the state; seen, the tree is in sync', () => {
        written('I0042');
        expect(kind()).toBe('written');
        ui().researchNoteWrittenSeen(TREE);
        expect(researchAutoState(TREE).writtenSeen).toBe('I0042');
        expect(kind()).toBe('inSync');
    });

    it('the bridge started again and closes the same send from its record: still seen, no "Written" again', async () => {
        written('I0042', '2026-10-24T08:52:03.120Z');
        ui().researchNoteWrittenSeen(TREE);
        // The app had the send as pending (the page closed while it went); the new bridge's record closes it.
        link = { ...link, sent: { fingerprint: 'f1', at: '2026-10-24T08:50:00Z', changes: 10, head: 'h1', intake: 'I0042', state: 'pending' } };
        await ui().settleResearchSend(TREE, statusWith('I0042'));
        const st = researchAutoState(TREE);
        // Remembered again, at the research's own time of the write…
        expect(st.lastWritten?.at).toBe(WRITTEN_AT);
        expect(link.sent?.state).toBe('written');
        // …and still the write seen.
        expect(researchWriteIsNews(st)).toBe(false);
        expect(kind()).toBe('inSync');
    });

    it('another write after the restart is news again', async () => {
        written('I0042');
        ui().researchNoteWrittenSeen(TREE);
        link = { ...link, sent: { fingerprint: 'f1', at: '2026-10-28T15:00:00Z', changes: 3, head: 'h1', intake: 'I0050', state: 'pending' } };
        await ui().settleResearchSend(TREE, { ...statusWith('I0050'), sends: [{ ...statusWith('I0050').sends[0], decidedAt: '2026-10-28T15:01:00Z' }] });
        expect(researchAutoState(TREE).lastWritten?.intake).toBe('I0050');
        expect(kind()).toBe('written');
    });

    it('a write without the research\'s mark is named by its time', () => {
        patchResearchAutoState(TREE, { lastWritten: { at: WRITTEN_AT, changes: 2, conflicts: 0 } });
        ui().researchNoteWrittenSeen(TREE);
        expect(researchAutoState(TREE).writtenSeen).toBe(WRITTEN_AT);
        expect(researchWriteIsNews(researchAutoState(TREE))).toBe(false);
        patchResearchAutoState(TREE, { lastWritten: { at: '2026-10-28T15:01:00Z', changes: 1, conflicts: 0 } });
        expect(researchWriteIsNews(researchAutoState(TREE))).toBe(true);
    });

    it('a write that left conflicts stays in sight, seen or not', () => {
        written('I0042', WRITTEN_AT, 1);
        ui().researchNoteWrittenSeen(TREE);
        expect(researchWriteIsNews(researchAutoState(TREE))).toBe(true);
        expect(researchWriteIsNews(researchAutoState(TREE), true)).toBe(true);
        expect(kind()).toBe('written');
    });

    it('a seen write whose count of conflicts outlived them is no news; not seen yet, it is (1031)', () => {
        written('I0042', WRITTEN_AT, 2);
        expect(researchWriteIsNews(researchAutoState(TREE), false)).toBe(true);
        ui().researchNoteWrittenSeen(TREE);
        expect(researchWriteIsNews(researchAutoState(TREE), false)).toBe(false);
    });

    it('the write\'s conflicts count as open only while one of the people it named has one open here (1031)', () => {
        const open = new Set<string>();
        const methodsWith = { ...methods, personOpenConflicts: (id: string) => open.has(id) ? [{ status: 'open' }] : [],
            researchOpenConflictTotal: () => open.size } as unknown as { researchWrittenConflictsOpen(treeId: TreeId): boolean };
        vi.spyOn(DataManager, 'getCurrentTreeId').mockReturnValue(TREE);
        vi.spyOn(DataManager, 'getPerson').mockImplementation((id: string) => ({ id }) as never);
        patchResearchAutoState(TREE, { lastWritten: { at: WRITTEN_AT, changes: 18, conflicts: 1, persons: ['p_jan'], intake: 'I0042' } });
        expect(methodsWith.researchWrittenConflictsOpen(TREE)).toBe(false);
        open.add('p_jan');
        expect(methodsWith.researchWrittenConflictsOpen(TREE)).toBe(true);
        // None named: any open conflict in the tree.
        patchResearchAutoState(TREE, { lastWritten: { at: WRITTEN_AT, changes: 18, conflicts: 1, intake: 'I0042' } });
        expect(methodsWith.researchWrittenConflictsOpen(TREE)).toBe(true);
        open.clear();
        expect(methodsWith.researchWrittenConflictsOpen(TREE)).toBe(false);
        // No conflicts left by the write: nothing open of it.
        written('I0042');
        open.add('p_jan');
        expect(methodsWith.researchWrittenConflictsOpen(TREE)).toBe(false);
    });

    it('the seen mark survives a reload (kept in this browser), bounded', () => {
        store.set(`strom-research-auto:${TREE}`, JSON.stringify({ lastWritten: { at: WRITTEN_AT, changes: 1, conflicts: 0, intake: 'I1' }, writtenSeen: 'I1' }));
        expect(researchAutoState(TREE).writtenSeen).toBe('I1');
        expect(researchWriteKey(researchAutoState(TREE).lastWritten!)).toBe('I1');
        store.set(`strom-research-auto:${TREE}`, JSON.stringify({ writtenSeen: 'x'.repeat(500) }));
        expect(researchAutoState(TREE).writtenSeen).toBeUndefined();
    });
});
