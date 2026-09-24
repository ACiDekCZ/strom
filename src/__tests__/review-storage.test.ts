/**
 * Review 2026-09-22, wave 1 B — storage, encryption and trees.
 *
 * StorageManager is replaced by an in-memory, per-store Map (no IndexedDB in
 * the node test env); encryption uses the real Web Crypto session. All data
 * is invented.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Stores = Map<string, Map<string, unknown>>;
const stores: Stores = new Map();
function st(name: string): Map<string, unknown> {
    let m = stores.get(name);
    if (!m) { m = new Map(); stores.set(name, m); }
    return m;
}

vi.mock('../storage.js', () => ({
    StorageManager: {
        async init() {},
        async get<T>(store: string, key: string): Promise<T | null> {
            return (st(store).get(key) as T) ?? null;
        },
        set(store: string, key: string, value: unknown): Promise<void> {
            st(store).set(key, structuredClone(value));
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
        async flush(): Promise<void> {},
    },
}));

import { TreeManager } from '../tree-manager.js';
import { DataManager } from '../data.js';
import { AuditLogManager } from '../audit-log.js';
import { SettingsManager } from '../settings.js';
import { CryptoSession, encrypt, isEncrypted } from '../crypto.js';
import { createSnapshot, deleteSnapshotsForTree, listSnapshots, reencodeAllSnapshots, getSnapshotJson } from '../snapshots.js';
import { saveBaseline, reencodeAllBaselines, loadBaseline } from '../share-baselines.js';
import { findAnyEncryptedRecord } from '../encryption-migrate.js';
import { isMultiTreeBackup, readEmbeddedHtml, readWindowAssignment } from '../backup-formats.js';
import { handleMessage, onTreeSavedElsewhere } from '../tab-sync.js';
import { getStringsForLang, setLanguage } from '../strings.js';
import { StromData, TreeId, TreeMetadata, AuditLog } from '../types.js';

let encryptionOn = false;
const events: string[] = [];

function tree(names: string[]): StromData {
    const persons: StromData['persons'] = {};
    names.forEach((n, i) => {
        persons[`p${i}` as never] = {
            id: `p${i}`, firstName: n, lastName: 'Example', gender: 'male', partnerships: [],
            parentIds: [], childIds: [],
        } as never;
    });
    return { version: 1, persons, partnerships: {} } as StromData;
}

function meta(id: string, name: string, extra: Partial<TreeMetadata> = {}): TreeMetadata {
    return {
        id: id as TreeId, name, createdAt: '2026-01-01', lastModifiedAt: '2026-01-01',
        personCount: 0, partnershipCount: 0, sizeBytes: 0, ...extra,
    };
}

function resetTreeManager(trees: TreeMetadata[] = []): void {
    const tm = TreeManager as unknown as {
        index: { version: number; activeTreeId: TreeId | null; trees: TreeMetadata[] };
        initialized: boolean; saveQueues: Map<TreeId, Promise<void>>; unreadableTrees: Set<TreeId>;
    };
    tm.index = { version: 1, activeTreeId: trees[0]?.id ?? null, trees };
    tm.initialized = true;
    tm.saveQueues = new Map();
    tm.unreadableTrees = new Set();
}

const settle = () => new Promise(r => setTimeout(r, 30));

beforeEach(() => {
    stores.clear();
    events.length = 0;
    encryptionOn = false;
    vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockImplementation(() => encryptionOn);
    vi.spyOn(SettingsManager, 'isAuditLogEnabled').mockReturnValue(true);
    const target = new EventTarget();
    target.addEventListener('strom:save-blocked', () => events.push('save-blocked'));
    target.addEventListener('strom:save-failed', () => events.push('save-failed'));
    vi.stubGlobal('window', target);
    AuditLogManager.init();
    const alm = AuditLogManager as unknown as { cache: Map<string, unknown>; loaded: Set<string> };
    alm.cache.clear();
    alm.loaded.clear();
    resetTreeManager();
});

afterEach(() => {
    CryptoSession.lock();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// ---------- K7 ----------
describe('K7 audit log under encryption', () => {
    it('loadForTree decrypts the stored log instead of caching an empty one', async () => {
        encryptionOn = true;
        await CryptoSession.unlock('audit-password-1');
        st('audit').set('t1', await CryptoSession.encrypt(JSON.stringify(
            { version: 1, entries: [{ t: 'x', a: 'person.create', d: 'Old Entry' }] })));
        await AuditLogManager.loadForTree('t1' as TreeId);
        AuditLogManager.log('t1' as TreeId, 'person.create', 'New Entry');
        await settle();
        const log = JSON.parse(await CryptoSession.decrypt(st('audit').get('t1') as never)) as AuditLog;
        expect(log.entries.map(e => e.d)).toEqual(['Old Entry', 'New Entry']);
    });

    it('locked at load: new entries never overwrite the encrypted history', async () => {
        encryptionOn = true;
        await CryptoSession.unlock('audit-password-1');
        const salt = CryptoSession.getSalt()!;
        st('audit').set('t1', await CryptoSession.encrypt(JSON.stringify(
            { version: 1, entries: [{ t: 'x', a: 'person.create', d: 'History' }] })));
        CryptoSession.lock();

        await AuditLogManager.loadForTree('t1' as TreeId);
        AuditLogManager.log('t1' as TreeId, 'person.create', 'While Locked');
        await settle();
        expect(isEncrypted(st('audit').get('t1'))).toBe(true);

        await CryptoSession.unlock('audit-password-1', salt);
        AuditLogManager.log('t1' as TreeId, 'person.create', 'After Unlock');
        await settle();
        const log = JSON.parse(await CryptoSession.decrypt(st('audit').get('t1') as never)) as AuditLog;
        expect(log.entries.map(e => e.d)).toEqual(['History', 'While Locked', 'After Unlock']);
    });
});

// ---------- K8 ----------
describe('K8 undecryptable tree is not empty', () => {
    it('reports undecryptable and refuses to save over it', async () => {
        resetTreeManager([meta('t1', 'Family')]);
        const cipher = await encrypt(JSON.stringify(tree(['Anna'])), 'right-password');
        st('trees').set('t1', cipher);
        encryptionOn = true;
        await CryptoSession.unlock('wrong-password');

        const read = await TreeManager.readTreeData('t1' as TreeId);
        expect(read.status).toBe('undecryptable');
        expect(TreeManager.isTreeUnreadable('t1' as TreeId)).toBe(true);

        TreeManager.saveTreeData('t1' as TreeId, tree([]));
        await TreeManager.flush('t1' as TreeId);
        expect(st('trees').get('t1')).toEqual(cipher);
        expect(events).toContain('save-blocked');
    });

    it('locked read is distinguished from a missing tree', async () => {
        resetTreeManager([meta('t1', 'Family'), meta('t2', 'Other')]);
        st('trees').set('t1', await encrypt(JSON.stringify(tree(['Anna'])), 'pw-123456'));
        expect((await TreeManager.readTreeData('t1' as TreeId)).status).toBe('locked');
        expect((await TreeManager.readTreeData('t2' as TreeId)).status).toBe('missing');
    });

    it('decrypting an embedded file never replaces the local session key', async () => {
        await CryptoSession.unlock('local-password');
        const localSalt = CryptoSession.getSalt();
        const dm = DataManager as unknown as {
            pendingEncryptedEmbedded: unknown; pendingEncryptedAllTrees: unknown;
            embeddedEnvelope: unknown; embeddedAllTrees: Record<string, unknown> | null;
            viewMode: boolean; currentTreeId: TreeId | null;
        };
        const shown = tree(['Shown']);
        dm.embeddedEnvelope = { exportId: 'exp_1', exportedAt: '', appVersion: '1', treeName: 'B', data: {} };
        dm.pendingEncryptedEmbedded = await encrypt(JSON.stringify(shown), 'file-password');
        dm.pendingEncryptedAllTrees = await encrypt(JSON.stringify({
            a: { name: 'A', data: tree(['Other']) },
            b: { name: 'B', data: shown },
        }), 'file-password');

        expect(await DataManager.decryptEmbeddedData('nope')).toBe(false);
        expect(await DataManager.decryptEmbeddedData('file-password')).toBe(true);
        expect(CryptoSession.getSalt()).toBe(localSalt);
        expect(dm.viewMode).toBe(true);
        // Password-protected "Export all" restores every tree, and the
        // switcher marks the tree the envelope shows (not simply the first).
        expect(Object.keys(dm.embeddedAllTrees ?? {})).toEqual(['a', 'b']);
        expect(DataManager.getEmbeddedTrees().find(t => t.isActive)?.id).toBe('b');
        dm.viewMode = false;
        dm.embeddedEnvelope = null;
        dm.embeddedAllTrees = null;
    });
});

// ---------- V1 ----------
describe('V1 deleting a tree deletes its backups', () => {
    it('deleteSnapshotsForTree reads id/treeId from meta', async () => {
        await createSnapshot('t1', tree(['A']), 'manual', 1000);
        await createSnapshot('t2', tree(['B']), 'manual', 2000);
        await deleteSnapshotsForTree('t1');
        expect(await listSnapshots('t1')).toHaveLength(0);
        expect(await listSnapshots('t2')).toHaveLength(1);
    });

    it('deleteTree cascades snapshots and share baselines', async () => {
        resetTreeManager([meta('t1', 'One'), meta('t2', 'Two')]);
        await createSnapshot('t1', tree(['A']), 'manual', 1000);
        await saveBaseline('t1', 'exp_x', tree(['A']), 1000);
        await TreeManager.deleteTree('t1' as TreeId);
        expect(await listSnapshots('t1')).toHaveLength(0);
        expect(st('shareBaselines').size).toBe(0);
    });
});

// ---------- V4 ----------
describe('V4 new trees are encrypted when encryption is on', () => {
    it('createTreeFromImport and duplicateTree write ciphertext', async () => {
        encryptionOn = true;
        await CryptoSession.unlock('enc-password');
        const id = TreeManager.createTreeFromImport(tree(['Secret Person']), 'Imported');
        await TreeManager.flush(id);
        expect(isEncrypted(st('trees').get(id))).toBe(true);

        const dup = await TreeManager.duplicateTree(id, 'Copy');
        await TreeManager.flush(dup!);
        expect(isEncrypted(st('trees').get(dup!))).toBe(true);
        expect(JSON.stringify(st('trees').get(dup!))).not.toContain('Secret Person');
    });
});

// ---------- coalesced saves (big image sets) ----------
describe('rapid saves of one tree are coalesced', () => {
    it('writes only the newest waiting state, and nothing else is lost', async () => {
        encryptionOn = false;
        resetTreeManager([meta('t1', 'One'), meta('t2', 'Two')]);
        const setSpy = vi.spyOn((await import('../storage.js')).StorageManager, 'set');
        TreeManager.saveTreeData('t1' as TreeId, tree(['A']));
        TreeManager.saveTreeData('t1' as TreeId, tree(['B']));
        TreeManager.saveTreeData('t1' as TreeId, tree(['C']));
        TreeManager.saveTreeData('t2' as TreeId, tree(['Other']));
        await TreeManager.flush();
        const treeWrites = setSpy.mock.calls.filter(c => c[0] === 'trees' && c[1] !== '_index');
        // One write per tree: the three t1 saves became one (the newest).
        expect(treeWrites.map(c => c[1])).toEqual(['t1', 't2']);
        expect(Object.values((st('trees').get('t1') as StromData).persons)[0].firstName).toBe('C');
        expect(Object.values((st('trees').get('t2') as StromData).persons)[0].firstName).toBe('Other');
        setSpy.mockRestore();
    });

    it('the saved state does not follow later changes of the live object', async () => {
        encryptionOn = false;
        resetTreeManager([meta('t1', 'One')]);
        const live = tree(['Before']);
        TreeManager.saveTreeData('t1' as TreeId, live);
        Object.values(live.persons)[0].firstName = 'Changed later';
        await TreeManager.flush();
        expect(Object.values((st('trees').get('t1') as StromData).persons)[0].firstName).toBe('Before');
    });
});

// ---------- S20 ----------
describe('S20 flush waits for the save queue; delete does not resurrect', () => {
    it('getTreeData sees the latest queued save', async () => {
        encryptionOn = true;
        await CryptoSession.unlock('enc-password');
        resetTreeManager([meta('t1', 'One')]);
        TreeManager.saveTreeData('t1' as TreeId, tree(['First']));
        TreeManager.saveTreeData('t1' as TreeId, tree(['Second']));
        const data = await TreeManager.getTreeData('t1' as TreeId);
        expect(Object.values(data!.persons)[0].firstName).toBe('Second');
    });

    it('a save queued before deleteTree does not bring the record back', async () => {
        encryptionOn = true;
        await CryptoSession.unlock('enc-password');
        resetTreeManager([meta('t1', 'One'), meta('t2', 'Two')]);
        TreeManager.saveTreeData('t1' as TreeId, tree(['Queued']));
        await TreeManager.deleteTree('t1' as TreeId);
        TreeManager.saveTreeData('t1' as TreeId, tree(['Late']));
        await TreeManager.flush();
        expect(st('trees').has('t1')).toBe(false);
    });
});

// ---------- S19 ----------
describe('S19 unambiguous tree URL parameter', () => {
    it('distinguishes colliding slugs and names without Latin letters', () => {
        resetTreeManager([
            meta('tree_1_aaaaa', 'Novák'),
            meta('tree_2_bbbbb', 'Novak'),
            meta('tree_3_ccccc', 'Семья'),
        ]);
        const a = TreeManager.getTreeSlug('tree_1_aaaaa' as TreeId)!;
        const b = TreeManager.getTreeSlug('tree_2_bbbbb' as TreeId)!;
        const c = TreeManager.getTreeSlug('tree_3_ccccc' as TreeId)!;
        expect(a).not.toBe(b);
        expect(c).toBeTruthy();
        expect(TreeManager.getTreeBySlug(a)?.id).toBe('tree_1_aaaaa');
        expect(TreeManager.getTreeBySlug(b)?.id).toBe('tree_2_bbbbb');
        expect(TreeManager.getTreeBySlug(c)?.id).toBe('tree_3_ccccc');
        // Old bookmarks (plain slug) still resolve.
        expect(TreeManager.getTreeBySlug('novak')).not.toBeNull();
    });
});

// ---------- S21 ----------
describe('S21 undo/redo respect the tree lock', () => {
    it('refuses to undo on a locked tree', () => {
        resetTreeManager([meta('t1', 'One', { isLocked: true })]);
        vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
        const dm = DataManager as unknown as { currentTreeId: TreeId | null; viewMode: boolean };
        dm.currentTreeId = 't1' as TreeId;
        dm.viewMode = false;
        expect(DataManager.undo()).toBeNull();
        expect(DataManager.redo()).toBeNull();
        expect(TreeManager.saveTreeData).not.toHaveBeenCalled();
    });
});

// ---------- S23 / S13 ----------
describe('S23 encryption toggle converts side stores', () => {
    it('snapshots and baselines follow encryption on and off', async () => {
        await createSnapshot('t1', tree(['Plain']), 'manual', 1000);
        await saveBaseline('t1', 'exp_1', tree(['Plain']), 1000);

        encryptionOn = true;
        await CryptoSession.unlock('enc-password');
        expect(await reencodeAllSnapshots()).toBe(0);
        expect(await reencodeAllBaselines()).toBe(0);
        const snap = [...st('snapshots').values()][0] as { encrypted?: unknown };
        expect(isEncrypted(snap.encrypted)).toBe(true);
        expect(isEncrypted((st('shareBaselines').get('exp_1') as { encrypted?: unknown }).encrypted)).toBe(true);
        expect(await findAnyEncryptedRecord()).not.toBeNull();

        encryptionOn = false;
        expect(await reencodeAllSnapshots()).toBe(0);
        expect(await reencodeAllBaselines()).toBe(0);
        CryptoSession.lock();
        const id = (await listSnapshots('t1'))[0].id;
        expect(await getSnapshotJson(id)).toContain('Plain');
        expect((await loadBaseline('exp_1'))?.persons).toBeTruthy();
        expect(await findAnyEncryptedRecord()).toBeNull();
    });

    it('audit logs follow encryption on', async () => {
        st('audit').set('t1', { version: 1, entries: [{ t: 'x', a: 'person.create', d: 'Plain Log' }] });
        encryptionOn = true;
        await CryptoSession.unlock('enc-password');
        expect(await AuditLogManager.reencodeAll()).toBe(0);
        expect(isEncrypted(st('audit').get('t1'))).toBe(true);
    });
});

// ---------- V5 ----------
describe('V5 "Export all" backups are readable', () => {
    const all = { t1: { name: 'One', data: tree(['A <b>']) }, t2: { name: 'Two', data: tree(['B']) } };
    // Mirrors the writer: '<' escaped so data cannot close the script tag.
    const forScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

    it('recognizes the multi-tree JSON shape, not a single tree', () => {
        expect(isMultiTreeBackup(all)).toBe(true);
        expect(isMultiTreeBackup(tree(['A']))).toBe(false);
        expect(isMultiTreeBackup({})).toBe(false);
    });

    it('reads both assignments from one script tag', () => {
        const envelope = { exportId: 'e', treeName: 'One', data: all.t1.data };
        const html = `<html><head><script>var app = 'window.STROM_EMBEDDED_DATA = ' + x;</script>`
            + `<script>window.STROM_EMBEDDED_DATA = ${forScript(envelope)};window.STROM_ALL_TREES = ${forScript(all)};</script>\n</head></html>`;
        const content = readEmbeddedHtml(html);
        expect(content.envelope?.treeName).toBe('One');
        expect(content.allTrees).toEqual(all);
        expect(readWindowAssignment(html, 'STROM_MISSING')).toBeUndefined();
    });

    it('keeps an encrypted trees bundle for the password step', async () => {
        const enc = await encrypt(JSON.stringify(all), 'file-pw');
        const html = `<script>window.STROM_EMBEDDED_DATA = null;window.STROM_ALL_TREES = ${forScript(enc)};</script>`;
        expect(isEncrypted(readEmbeddedHtml(html).allTrees)).toBe(true);
    });

    it('imports every tree as a new tree, with source export id on single import', async () => {
        resetTreeManager([meta('t0', getStringsForLang('de').treeManager.defaultTreeName)]);
        const dm = DataManager as unknown as { viewMode: boolean };
        dm.viewMode = false;
        const ids = await DataManager.importTreesAsNew([
            { name: 'One', data: all.t1.data }, { name: 'Two', data: all.t2.data },
        ]);
        expect(ids).toHaveLength(2);
        // The untouched empty default tree (German name) was cleaned up.
        expect(TreeManager.getTrees().map(t => t.name)).toEqual(['One', 'Two']);
    });
});

// ---------- V6 ----------
describe('V6 saves in another tab are announced', () => {
    it('routes other tabs\' saves and ignores malformed messages', () => {
        const seen: string[] = [];
        onTreeSavedElsewhere(id => seen.push(id));
        handleMessage({ type: 'tree-saved', treeId: 't9', tabId: 'another-tab' });
        handleMessage({ type: 'other' });
        handleMessage(null);
        expect(seen).toEqual(['t9']);
    });
});

// ---------- V7 ----------
describe('V7 reopening an imported HTML finds the tree', () => {
    it('importAllEmbeddedTrees records the source export id', async () => {
        resetTreeManager([meta('t0', 'Mine', { personCount: 3 })]);
        const dm = DataManager as unknown as {
            viewMode: boolean; embeddedEnvelope: unknown; embeddedAllTrees: unknown; data: StromData;
        };
        dm.viewMode = true;
        dm.embeddedAllTrees = null;
        dm.embeddedEnvelope = { exportId: 'exp_42', exportedAt: '', appVersion: '1', treeName: 'Shared', data: {} };
        dm.data = tree(['Shared Person']);
        await DataManager.importAllEmbeddedTrees();
        expect(TreeManager.findTreeByExportId('exp_42')?.name).toBe('Shared');
    });
});

// ---------- Low ----------
describe('import name suffix follows the UI language', () => {
    it('uses the strings resource, not a hardcoded Czech suffix', () => {
        setLanguage('en');
        const dm = DataManager as unknown as { getUniqueTreeName(n: string, s: Set<string>): string };
        const name = dm.getUniqueTreeName('Family', new Set(['family']));
        expect(name).toMatch(/^Family \(imported /);
        expect(name).not.toContain('import ze dne');
    });
});
