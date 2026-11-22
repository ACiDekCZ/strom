/**
 * The merge wizard's way to a written tree (spec 134, story 0):
 * - K0.2 a failed check before saving creates and saves nothing, the wizard
 *   stays open with its answers and says what would have gone wrong;
 * - K0.4 the backup "Before merge" of the target comes from every way into
 *   the wizard, also with the tree's automatic backups off, and only once;
 * - K0.5 success (and the end of the working backup and the saved merge)
 *   only after the new tree's write has landed; a failed write leaves no
 *   tree behind and says so;
 * - K0.6 a resumed saved merge keeps its session until the merge is written
 *   or thrown away, and notices a target that changed since the matching.
 *
 * StorageManager is an in-memory Map per store (no IndexedDB in node); the UI
 * is a stand-in recording its dialogs. All people are invented.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Stores = Map<string, Map<string, unknown>>;
const stores: Stores = new Map();
function st(name: string): Map<string, unknown> {
    let m = stores.get(name);
    if (!m) { m = new Map(); stores.set(name, m); }
    return m;
}
/** A write the test makes fail: store + key → true. */
const failing = { write: (_store: string, _key: string) => false };

vi.mock('../storage.js', () => ({
    StorageManager: {
        async init() {},
        async get<T>(store: string, key: string): Promise<T | null> {
            return (st(store).get(key) as T) ?? null;
        },
        set(store: string, key: string, value: unknown): Promise<void> {
            if (failing.write(store, key)) return Promise.reject(new Error('QuotaExceededError'));
            st(store).set(key, structuredClone(value));
            return Promise.resolve();
        },
        setTogether(writes: { store: string; key: string; value: unknown }[]): Promise<void> {
            for (const w of writes) st(w.store).set(w.key, structuredClone(w.value));
            return Promise.resolve();
        },
        async delete(store: string, key: string): Promise<void> {
            st(store).delete(key);
        },
        async keys(store: string): Promise<string[]> {
            return [...st(store).keys()];
        },
        async getAll<T>(store: string): Promise<T[]> {
            return [...st(store).values()] as T[];
        },
        async getMany<T>(store: string, keys: string[]): Promise<Map<string, T | null>> {
            return new Map(keys.map(k => [k, (st(store).get(k) as T) ?? null]));
        },
        async flush(): Promise<void> {},
    },
}));

vi.mock('../merge/executor.js', async (importOriginal) => {
    const real = await importOriginal<typeof import('../merge/executor.js')>();
    return { ...real, executeMerge: vi.fn(real.executeMerge) };
});

import { TreeManager } from '../tree-manager.js';
import { DataManager } from '../data.js';
import { SettingsManager } from '../settings.js';
import { setUIGetter } from '../ui-ref.js';
import { MergerUI } from '../merge/ui.js';
import { executeMerge } from '../merge/executor.js';
import { mergeCheckMessage } from '../merge/merge-check.js';
import { createMergeState, rebaseMergeState, updateMatchDecision } from '../merge/matching.js';
import { listMergeSessionsInfo, saveMergeSession } from '../merge/persistence.js';
import { listSnapshots } from '../snapshots.js';
import { contentFingerprint } from '../research-link.js';
import { mergeUiMethods } from '../ui/merge-ui.js';
import { strings } from '../strings.js';
import { freshChoices, type WizardSource } from '../merge/wizard-ui.js';
import type { MergeState } from '../merge/types.js';
import type { PersonId, StromData, TreeId, TreeMetadata } from '../types.js';

const T1 = 't1' as TreeId;
const T2 = 't2' as TreeId;

function tree(people: Array<[string, string, string]>): StromData {
    const persons: StromData['persons'] = {};
    for (const [id, firstName, birthDate] of people) {
        persons[id as PersonId] = {
            id, firstName, lastName: 'Fictus', gender: 'female', birthDate, partnerships: [],
            parentIds: [], childIds: [],
        } as never;
    }
    return { version: 1, persons, partnerships: {} } as StromData;
}

function meta(id: string, name: string): TreeMetadata {
    return {
        id: id as TreeId, name, createdAt: '2026-01-01', lastModifiedAt: '2026-01-01',
        personCount: 0, partnershipCount: 0, sizeBytes: 0,
    };
}

function resetTreeManager(trees: TreeMetadata[]): void {
    const tm = TreeManager as unknown as {
        index: { version: number; activeTreeId: TreeId | null; trees: TreeMetadata[] };
        initialized: boolean; saveQueues: Map<TreeId, Promise<void>>; unreadableTrees: Set<TreeId>;
    };
    tm.index = { version: 1, activeTreeId: trees[0]?.id ?? null, trees };
    tm.initialized = true;
    tm.saveQueues = new Map();
    tm.unreadableTrees = new Set();
}

const TARGET = tree([['e1', 'Alma', '1901'], ['e2', 'Berta', '1903']]);
const INCOMING = tree([['i1', 'Alma', '1901'], ['i2', 'Cecilie', '1930']]);

/** The stand-in UI: every dialog recorded, the answers set per test. */
const ui = {
    alerts: [] as string[],
    confirms: [] as string[],
    confirmAnswer: false,
    showAlert: vi.fn(async (m: string) => { ui.alerts.push(m); }),
    showConfirm: vi.fn(async (m: string) => { ui.confirms.push(m); return ui.confirmAnswer; }),
    showToast: vi.fn(),
    showTreeManagerDialog: vi.fn(),
    closeTreeManagerDialog: vi.fn(),
    pushDialog: vi.fn(),
    afterImport: vi.fn(async () => {}),
    importNextPendingFor: vi.fn(() => false),
};

type MergerInternals = { mergeState: MergeState | null; preMergeBackup: Promise<string | null> | null };
const internals = () => MergerUI as unknown as MergerInternals;

beforeEach(async () => {
    stores.clear();
    failing.write = () => false;
    ui.alerts.length = 0;
    ui.confirms.length = 0;
    ui.confirmAnswer = false;
    vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(false);
    vi.spyOn(SettingsManager, 'isAuditLogEnabled').mockReturnValue(false);
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { getElementById: () => null, addEventListener() {}, removeEventListener() {} });
    setUIGetter(() => ui as never);
    resetTreeManager([meta('t1', 'Family'), meta('t2', 'Cousins')]);
    st('trees').set('t1', structuredClone(TARGET));
    st('trees').set('t2', structuredClone(INCOMING));
    expect(await DataManager.switchTree(T1)).toBe(true);
    internals().mergeState = null;
});

afterEach(async () => {
    await internals().preMergeBackup;
    await TreeManager.flush();
    MergerUI.handleCloseCancel();
    (MergerUI as unknown as { closeMergeModalInternal(): void }).closeMergeModalInternal();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** The wizard over the target with the file's people, every offered match answered "same person". */
function started(): MergeState {
    MergerUI.startMerge(structuredClone(INCOMING), 'cousins.ged');
    const state = internals().mergeState!;
    for (const m of state.matches) updateMatchDecision(state, m.incomingId, 'confirm');
    return state;
}

/**
 * The guide's step 5 pressed: its comparison done, the plan of the answers
 * written (a new tree "{target} + {source}", no name asked).
 */
async function writePlan(): Promise<void> {
    const m = MergerUI as unknown as {
        wizard: { rebuild(): void; next(): Promise<void> };
        wizardSource(): WizardSource;
    };
    const state = internals().mergeState!;
    state.wizard ??= { step: 1, reached: 1, compared: false, choices: freshChoices(m.wizardSource(), state) };
    Object.assign(state.wizard, { step: 5, reached: 5, compared: true });
    m.wizard.rebuild();
    await m.wizard.next();
}

async function preMergeSnapshots(id: TreeId): Promise<number> {
    return (await listSnapshots(id)).filter(s => s.reason === 'pre-merge').length;
}

describe('K0.2 · a failed check before saving', () => {
    it('creates and saves nothing, keeps the wizard and its answers, and says what would be lost', async () => {
        const state = started();
        updateMatchDecision(state, 'i2' as PersonId, 'reject');
        vi.mocked(executeMerge).mockResolvedValueOnce({
            success: false, mergedData: state.existingData,
            stats: { merged: 0, added: 0, skipped: 0, partnerships: 0 },
            check: { ok: false, problems: [{ kind: 'personLost', count: 2 }] } as never,
        });
        await writePlan();

        expect(TreeManager.getTrees().map(t => t.id)).toEqual([T1, T2]);
        expect(ui.alerts).toEqual([mergeCheckMessage([{ kind: 'personLost', count: 2 }])]);
        expect(internals().mergeState).toBe(state);
        expect(state.phase).toBe('reviewing');
        expect(state.decisions.get('i2' as PersonId)).toEqual({ type: 'reject' });
    });
});

describe('K0.4 · the backup "Before merge"', () => {
    it('is taken when the wizard starts from a file, also with automatic backups off', async () => {
        TreeManager.setAutoBackups(T1, false);
        MergerUI.startMerge(structuredClone(INCOMING), 'cousins.ged', false, { gedcom: true });
        await internals().preMergeBackup;
        expect(await preMergeSnapshots(T1)).toBe(1);
    });

    it('is taken once for a tree into a tree', async () => {
        const self = {
            mergeViewSourceLabel: '',
            updateUrlTreeParam() {},
            closeMergeTreesDialog() {},
            closeTreeManagerDialog() {},
        };
        await mergeUiMethods.runTreeMerge.call(self as never, null, T1, T2);
        await internals().preMergeBackup;
        await new Promise(r => setTimeout(r, 0));
        expect(await preMergeSnapshots(T1)).toBe(1);
    });

    it('is none for a view (snapshotNow says null there)', async () => {
        vi.spyOn(DataManager, 'isViewMode').mockReturnValue(true);
        const viewData = DataManager as unknown as { viewMode: boolean };
        const was = viewData.viewMode;
        viewData.viewMode = true;
        try {
            MergerUI.startMerge(structuredClone(INCOMING), 'cousins.ged');
            expect(await internals().preMergeBackup).toBeNull();
        } finally {
            viewData.viewMode = was;
        }
        expect(await preMergeSnapshots(T1)).toBe(0);
    });
});

describe('K0.5 · success only after the written tree', () => {
    it('a failed write: no success, no tree left behind, the working backup and the merge stay', async () => {
        const state = started();
        // Every tree written from now on fails (the browser's storage is full).
        failing.write = (store, key) => store === 'trees' && key.startsWith('tree_');
        await writePlan();

        expect(ui.alerts).toEqual([strings.merge.saveFailed]);
        expect(ui.confirms.some(m => m.includes(strings.merge.complete))).toBe(false);
        expect(TreeManager.getTrees().map(t => t.id)).toEqual([T1, T2]);
        expect([...st('merge').keys()].some(k => k.startsWith('backup-'))).toBe(true);
        expect(internals().mergeState).toBe(state);
        expect(state.phase).toBe('reviewing');
    });

    it('a write that lands: the tree is stored before success is said, the working backup goes', async () => {
        started();
        let storedAtSuccess = false;
        ui.showConfirm.mockImplementationOnce(async (m: string) => {
            ui.confirms.push(m);
            const id = TreeManager.getTrees().find(t => t.name === 'Family + cousins')?.id;
            storedAtSuccess = !!id && st('trees').has(id);
            return false;
        });
        await writePlan();

        expect(ui.alerts).toEqual([]);
        expect(storedAtSuccess).toBe(true);
        expect([...st('merge').keys()].some(k => k.startsWith('backup-'))).toBe(false);
        expect(TreeManager.getTrees()).toHaveLength(3);
    });
});

describe('K0.6 · a saved merge resumed', () => {
    async function savedMerge(): Promise<string> {
        const state = started();
        updateMatchDecision(state, 'i2' as PersonId, 'skip');
        const id = await saveMergeSession(state, 'Family + cousins', 'Family', 'Cousins');
        (MergerUI as unknown as { closeMergeModalInternal(): void }).closeMergeModalInternal();
        return id;
    }

    it('keeps its session when the wizard closes before anything is saved again', async () => {
        const id = await savedMerge();
        expect(await MergerUI.resumeSavedMerge(id)).toBe(true);
        MergerUI.closeMergeModal();
        expect((await listMergeSessionsInfo()).map(s => s.id)).toEqual([id]);
    });

    it('goes when the merge is written', async () => {
        const id = await savedMerge();
        await MergerUI.resumeSavedMerge(id);
        await writePlan();
        expect(await listMergeSessionsInfo()).toEqual([]);
    });

    it('says the target changed and finds the matches again over its current data, answers kept', async () => {
        const id = await savedMerge();
        DataManager.createPerson({ firstName: 'Dora', lastName: 'Fictus', gender: 'female', birthDate: '1960' });
        ui.confirmAnswer = true;
        await MergerUI.resumeSavedMerge(id);

        expect(ui.confirms).toEqual([strings.merge.resumeTargetChanged]);
        const state = internals().mergeState!;
        expect(Object.values(state.existingData.persons).map(p => p.firstName)).toContain('Dora');
        expect(state.target?.fingerprint).toBe(contentFingerprint(DataManager.getData()));
        expect(state.decisions.get('i2' as PersonId)).toEqual({ type: 'skip' });
    });

    it('an unchanged target resumes without a question', async () => {
        const id = await savedMerge();
        await MergerUI.resumeSavedMerge(id);
        expect(ui.confirms).toEqual([]);
        expect(ui.alerts).toEqual([]);
    });
});

describe('rebaseMergeState', () => {
    it('keeps answers whose people still exist and drops the others', () => {
        const state = createMergeState(structuredClone(TARGET), structuredClone(INCOMING));
        updateMatchDecision(state, 'i1' as PersonId, 'confirm');
        updateMatchDecision(state, 'i2' as PersonId, { type: 'manual_match', targetId: 'e2' as PersonId });
        const now = structuredClone(TARGET);
        delete now.persons['e2' as PersonId];
        now.persons['e1' as PersonId].birthDate = '1902';

        const rebased = rebaseMergeState(state, now, { treeId: T1, fingerprint: contentFingerprint(now) });
        expect(rebased.existingData).toBe(now);
        expect(rebased.decisions.get('i1' as PersonId)).toEqual({ type: 'confirm' });
        expect(rebased.decisions.has('i2' as PersonId)).toBe(false);
        const match = rebased.matches.find(m => m.incomingId === 'i1');
        expect(match?.existingPerson.birthDate).toBe('1902');
        expect(match?.conflicts.map(c => c.field)).toContain('birthDate');
        expect(rebased.unmatchedIncoming).toContain('i2');
        // The given state is as it was.
        expect(state.existingData.persons['e2' as PersonId]).toBeDefined();
        expect(state.decisions.size).toBe(2);
    });
});
