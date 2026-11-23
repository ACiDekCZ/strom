/**
 * Merging, a change packet and a research version over a tree that holds its
 * images as pooled references (spec 135, part D10a): a file or packet brings
 * the same picture as a data URL, and that must never read as another
 * picture — no "photo against photo" difference, no second attachment or
 * excerpt, no source split off, no change counted, nothing lost. The merge
 * guide stores the import's images in the pool at its start (a copy, the
 * given data unchanged) and holds them against the pool's cleanup while open;
 * its saved session names them by reference.
 *
 * StorageManager is an in-memory Map per store. All people are invented.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const stores = new Map<string, Map<string, unknown>>();
function st(name: string): Map<string, unknown> {
    let m = stores.get(name);
    if (!m) { m = new Map(); stores.set(name, m); }
    return m;
}

vi.mock('../storage.js', () => ({
    StorageManager: {
        async init() {},
        async get<T>(store: string, key: string): Promise<T | null> {
            return structuredClone((st(store).get(key) as T) ?? null);
        },
        async set(store: string, key: string, value: unknown): Promise<void> {
            st(store).set(key, structuredClone(value));
        },
        async setTogether(writes: { store: string; key: string; value: unknown }[]): Promise<void> {
            for (const w of writes) st(w.store).set(w.key, structuredClone(w.value));
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
            return new Map(keys.map(k => [k, structuredClone((st(store).get(k) as T) ?? null)]));
        },
        async flush(): Promise<void> {},
    },
}));

import { POOL_REF, withPoolLock, storeImages, collectPoolGarbageLocked, pooledIds, POOL_UNUSED_GRACE_MS } from '../media-pool.js';
import { clearImageMeta, computeImageMeta, setImageMeta } from '../image-meta.js';
import { poolIdOf } from '../image-ref.js';
import { sameImageSync, sameWithImages, imageFinder } from '../image-equal.js';
import { poolTreeImages } from '../image-intern.js';
import { memoryImageIds, collectPoolRefIds } from '../pool-memory.js';
import { createMergeState, detectConflicts, rebaseMergeState, updateMatchDecision } from '../merge/matching.js';
import { executeMerge } from '../merge/executor.js';
import { applyPlan, buildPlan, planCounts, type WizardChoices } from '../merge/plan.js';
import { compactValue, mergeEdits, personPrint, valueKey } from '../merge/record.js';
import { writePlan, writeUndo } from '../merge/write.js';
import { fieldText } from '../merge/plan-rules.js';
import { planList } from '../merge/steps/step5-plan.js';
import { recordGroups } from '../merge/undo-view.js';
import { exportPlan } from '../merge/plan-export.js';
import { treeEditCount } from '../merge/resume-change.js';
import { conflictPhotoHtml } from '../merge/steps/step4-rules.js';
import { buildChangePacket, summarizeChangePacket, applyPacketOntoData } from '../share-diff.js';
import { carryOverMedia, contentFingerprint } from '../research-link.js';
import { TreeManager } from '../tree-manager.js';
import { strings } from '../strings.js';
import { DataManager } from '../data.js';
import { SettingsManager } from '../settings.js';
import { setUIGetter } from '../ui-ref.js';
import { MergerUI } from '../merge/ui.js';
import { freshChoices, type WizardSource } from '../merge/wizard-ui.js';
import type { MergeState } from '../merge/types.js';
import type { Attachment, Partnership, PartnershipId, Person, PersonId, StromData, TreeId, TreeMetadata } from '../types.js';

/** A PNG-looking data URL of pseudo-random bytes (seeded, repeatable; over 1 kB, so the pool takes it). */
function image(seed: number, n = 2400): string {
    const bytes = new Uint8Array(n);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let x = seed * 2654435761 >>> 0;
    for (let i = 8; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; bytes[i] = x >>> 24; }
    return 'data:image/png;base64,' + Buffer.from(bytes).toString('base64');
}

/** Store the data URLs in the pool (as a save does) and give their references. */
async function pool(...urls: string[]): Promise<string[]> {
    const { ids } = await withPoolLock(() => storeImages(new Set(urls), false, 'test'));
    return urls.map(u => POOL_REF + ids.get(u)!);
}

const A = 'p_a' as PersonId, B = 'p_b' as PersonId;
const U = 'u_ab' as PartnershipId;

function person(id: PersonId, extra: Partial<Person> = {}): Person {
    return {
        id, firstName: id === A ? 'Bertold' : 'Ilmara', lastName: 'Vranec', gender: id === A ? 'male' : 'female',
        birthDate: id === A ? '1871-03-02' : '1875-09-14', partnerships: [U], parentIds: [], childIds: [], ...extra,
    } as Person;
}

/** A couple with a portrait, a file at the husband and a source with an excerpt (each as given: data URL or reference). */
function couple(img: { portrait: string; file: string; excerpt: string }, ids = { file: 'm1', excerpt: 'e1' }): StromData {
    return {
        version: 25,
        persons: { [A]: person(A, { photo: img.portrait }), [B]: person(B) },
        partnerships: { [U]: { id: U, person1Id: A, person2Id: B, childIds: [], status: 'married' } as Partnership },
        media: {
            [ids.file]: { id: ids.file, name: 'scan.png', mimeType: 'image/png', dataUrl: img.file, sizeBytes: 1800, places: [{ personId: A }] } as Attachment,
        },
        sources: {
            s1: { id: 's1', title: 'Matrika Vranov 1871', excerpts: [{ id: ids.excerpt, dataUrl: img.excerpt, width: 10, height: 10, sizeBytes: 1800, fromAttachmentId: ids.file }] },
        },
    } as unknown as StromData;
}

beforeEach(() => {
    stores.clear();
    clearImageMeta();
});

describe('one picture in either form (image-equal.ts)', () => {
    it('sameImageSync: a data URL and its reference are one picture, another picture is not', async () => {
        const [x, y] = [image(1), image(2)];
        const [rx, ry] = await pool(x, y);
        expect(sameImageSync(x, rx)).toBe(true);
        expect(sameImageSync(rx, x)).toBe(true);
        expect(sameImageSync(y, rx)).toBe(false);
        expect(sameImageSync(rx, ry)).toBe(false);
        expect(sameImageSync(rx, rx)).toBe(true);
        // Without the catalog entry the `p:` id is still the data URL's own hash.
        clearImageMeta();
        expect(sameImageSync(x, rx)).toBe(true);
        expect(sameImageSync(y, rx)).toBe(false);
    });

    it('sameImageSync: an encrypted image\'s `e:` id by its catalog hash', async () => {
        const x = image(3);
        const enc = 'e:' + '5'.repeat(40);
        setImageMeta(enc, await computeImageMeta(x));
        expect(sameImageSync(x, POOL_REF + enc)).toBe(true);
        expect(sameImageSync(image(4), POOL_REF + enc)).toBe(false);
        expect(sameImageSync(x, POOL_REF + 'e:' + '6'.repeat(40))).toBe(false);
    });

    it('sameWithImages and imageFinder compare records with images in either form', async () => {
        const [x, y] = [image(5), image(6)];
        const [rx] = await pool(x);
        expect(sameWithImages(person(A, { photo: rx }), person(A, { photo: x }))).toBe(true);
        expect(sameWithImages(person(A, { photo: rx }), person(A, { photo: y }))).toBe(false);
        expect(sameWithImages(person(A, { photo: rx }), person(A, { photo: x, notes: 'jiný' }))).toBe(false);
        expect(sameWithImages({ a: 1, photo: rx }, { photo: x, a: 1 }, true)).toBe(true);
        expect(sameWithImages({ a: 1, photo: rx }, { photo: x, a: 1 }, false)).toBe(false);
        const find = imageFinder([[rx, 'm1'], [y, 'm2']] as const);
        expect(find(x)).toBe('m1');
        expect(find(y)).toBe('m2');
        expect(find(image(7))).toBeUndefined();
    });
});

describe('the import into the pool (poolTreeImages)', () => {
    it('stores the images, gives a copy with references and leaves the given data as they were', async () => {
        const data = couple({ portrait: image(10), file: image(11), excerpt: image(12) });
        const given = structuredClone(data);
        let adopted: StromData | null = null;
        const pooled = await poolTreeImages(data, 'test-import', false, p => { adopted = p; return true; });
        expect(pooled).toBe(adopted);
        expect(data).toEqual(given);
        expect(poolIdOf(pooled!.persons[A].photo)).toBeTruthy();
        expect(poolIdOf(pooled!.media!.m1.dataUrl)).toBeTruthy();
        expect(poolIdOf(pooled!.sources!.s1.excerpts![0].dataUrl)).toBeTruthy();
        // Records without an image are shared, not copied.
        expect(pooled!.persons[B]).toBe(data.persons[B]);
        expect(pooled!.partnerships).toBe(data.partnerships);
        const stored = new Set(st('media').keys());
        for (const v of [pooled!.persons[A].photo, pooled!.media!.m1.dataUrl, pooled!.sources!.s1.excerpts![0].dataUrl]) {
            expect(stored.has(poolIdOf(v)!)).toBe(true);
        }
        // Not taken: nothing given back; data without a long data URL: nothing stored.
        expect(await poolTreeImages(data, 'test-import', false, () => false)).toBeNull();
        expect(await poolTreeImages(pooled!, 'test-import', false, () => true)).toBeNull();
    });
});

describe('merge over references (merge/*)', () => {
    async function pair(): Promise<{ tree: StromData; file: StromData; refs: string[]; urls: string[] }> {
        const urls = [image(20), image(21), image(22)];
        const refs = await pool(...urls);
        const tree = couple({ portrait: refs[0], file: refs[1], excerpt: refs[2] });
        // The same couple and the same pictures in a file: data URLs, its own ids for the file and the excerpt.
        const file = couple({ portrait: urls[0], file: urls[1], excerpt: urls[2] }, { file: 'm9', excerpt: 'e9' });
        return { tree, file, refs, urls };
    }

    it('the same portrait is no difference; another one is', async () => {
        const { tree, file } = await pair();
        expect(detectConflicts(tree.persons[A], file.persons[A]).filter(c => c.field === 'photo')).toEqual([]);
        const other = person(A, { photo: image(23) });
        expect(detectConflicts(tree.persons[A], other).map(c => c.field)).toContain('photo');
        expect(fieldText(tree.persons[A], 'photo')).toBe(fieldText(file.persons[A], 'photo'));
    });

    it('the write keeps one file, one excerpt and one source, and its check loses nothing', async () => {
        const { tree, file, refs } = await pair();
        const state = createMergeState(tree, file);
        for (const m of state.matches) updateMatchDecision(state, m.incomingId, 'confirm');
        expect(state.matches.map(m => m.incomingId).sort()).toEqual([A, B]);
        const result = await executeMerge(state);
        expect(result.success).toBe(true);
        const merged = result.mergedData;
        expect(Object.keys(merged.media ?? {})).toEqual(['m1']);
        expect(merged.media!.m1.dataUrl).toBe(refs[1]);
        expect(Object.keys(merged.sources ?? {})).toEqual(['s1']);
        expect(merged.sources!.s1.excerpts!.map(e => e.id)).toEqual(['e1']);
        expect(merged.persons[A].photo).toBe(refs[0]);
        expect(result.check?.ok).toBe(true);
    });

    it('the plan joins the file with the tree\'s own', async () => {
        const { tree, file } = await pair();
        const state = createMergeState(tree, file);
        for (const m of state.matches) updateMatchDecision(state, m.incomingId, 'confirm');
        const w: WizardChoices = {
            mode: 'add', targetTreeId: 't1' as TreeId, scope: 'c', swapped: false,
            source: { kind: 'json', label: 'vranec.json', persons: 2 }, targetName: 'Vranec', targetFingerprint: 'fp',
            planId: 'mp-test', createdAt: '2026-05-04T10:00:00.000Z',
        };
        const plan = buildPlan(state, w);
        expect(plan.items.find(i => i.kind === 'media')).toMatchObject({ id: 'm9', joinedWith: 'm1' });
    });

    it('a resumed merge\'s target whose images were saved meanwhile did not change', async () => {
        const { tree, file } = await pair();
        const before = { ...tree, persons: file.persons };
        expect(treeEditCount(before, tree)).toBe(0);
        expect(treeEditCount(before, { ...tree, persons: { ...tree.persons, [B]: person(B, { notes: 'nová' }) } })).toBe(1);
    });

    it('step 4 shows a pooled portrait', async () => {
        const [ref] = await pool(image(24));
        const html = conflictPhotoHtml(ref, 'BV', 'none');
        expect(html).toContain('<img class="conflict-photo"');
        expect(html).toContain(`data-pool-ref="${poolIdOf(ref)}"`);
    });
});

describe('a change packet over references (share-diff.ts)', () => {
    it('a packet applied before (its picture saved since) has no effect and keeps the reference', async () => {
        const x = image(30);
        const [rx] = await pool(x);
        const base: StromData = { version: 25, persons: { [A]: person(A, { partnerships: [] }) }, partnerships: {} } as StromData;
        const sender: StromData = { ...base, persons: { ...base.persons, [B]: person(B, { partnerships: [], photo: x }) } };
        const packet = buildChangePacket(base, sender, { baseExportId: 'exp-1' });
        // The recipient accepted it, and saving put the picture into the pool.
        const current: StromData = { ...base, persons: { ...base.persons, [B]: person(B, { partnerships: [], photo: rx }) } };
        const summary = summarizeChangePacket(current, packet);
        expect(summary.hasEffect).toBe(false);
        expect(summary.mediaCount).toBe(0);
        expect(applyPacketOntoData(current, packet).persons[B].photo).toBe(rx);
    });
});

describe('a research version over references (research-link.ts carryOverMedia)', () => {
    it('the research\'s data URL of the tree\'s file and excerpt is that file, not one more', async () => {
        const urls = [image(40), image(41), image(42)];
        const refs = await pool(...urls);
        const previous = couple({ portrait: refs[0], file: refs[1], excerpt: refs[2] });
        const next = couple({ portrait: urls[0], file: urls[1], excerpt: urls[2] }, { file: 'm7', excerpt: 'e7' });
        const out = carryOverMedia(next, previous).data;
        expect(Object.keys(out.media ?? {})).toEqual(['m7']);
        expect(out.sources!.s1.excerpts!.map(e => e.id)).toEqual(['e7']);
    });
});

describe('a portrait told by its content, not its name and length (merge/plan.ts)', () => {
    async function photoPlan(treePhoto: string, filePhoto: string) {
        const tree: StromData = { version: 25, persons: { [A]: person(A, { partnerships: [], photo: treePhoto }) }, partnerships: {} } as StromData;
        const file: StromData = { version: 25, persons: { [A]: person(A, { partnerships: [], photo: filePhoto }) }, partnerships: {} } as StromData;
        const state = createMergeState(tree, file);
        for (const m of state.matches) updateMatchDecision(state, m.incomingId, 'confirm');
        const plan = buildPlan(state, {
            mode: 'add', targetTreeId: 't1' as TreeId, scope: 'c', swapped: false, rules: { all: 'import' },
            source: { kind: 'json', label: 'vranec.json', persons: 1 }, targetName: 'Vranec', targetFingerprint: contentFingerprint(tree),
            planId: 'mp-photo', createdAt: '2026-05-04T10:00:00.000Z',
        });
        return { plan, tree, file };
    }
    const photoItems = (plan: { items: Array<{ kind: string; field?: string }> }) => plan.items.filter(i => i.field === 'photo');

    it('another portrait of the same length and no name is a difference the write takes; the same one in another form is none', async () => {
        const [mine, other] = [image(90), image(91)];
        expect(mine.length).toBe(other.length);
        const [rMine] = await pool(mine);
        const { plan, tree, file } = await photoPlan(rMine, other);
        expect(photoItems(plan)).toEqual([expect.objectContaining({ kind: 'field', field: 'photo', on: true })]);
        const applied = await applyPlan(plan, tree, file);
        expect(applied.ok).toBe(true);
        if (!applied.ok) return;
        expect(applied.data.persons[A].photo).toBe(other);
        expect(applied.record.fields.map(f => f.field)).toContain('photo');
        // The tree's portrait as the file's data URL: nothing to do.
        const same = await photoPlan(rMine, mine);
        expect(photoItems(same.plan)).toEqual([]);
    });

    it('another portrait of the same name and size reads as such in step 5, the history, the undo and the saved list, not "photo (n) → photo (n)"', async () => {
        const [mine, other] = [image(92), image(93)];
        const { plan, tree, file } = await photoPlan(mine, other);
        const was = fieldText(tree.persons[A], 'photo');
        expect(fieldText(file.persons[A], 'photo')).toBe(was);
        const same = `${was} → ${was}`;
        const told = `${was} → ${strings.mergeWizard.otherPhoto}`;
        const state = createMergeState(tree, file);
        const step5 = planList(plan, state).flatMap(g => g.lines).map(l => l.text).filter(t => t.includes(was));
        expect(step5).toHaveLength(1);
        expect(step5[0]).toContain(told);
        expect(step5[0]).not.toContain(same);
        const applied = await applyPlan(plan, tree, file);
        expect(applied.ok).toBe(true);
        if (!applied.ok) return;
        // One change counted alike in step 5 and in the record (134 N4: one count).
        expect(planCounts(plan).fieldChanges).toBe(1);
        expect(applied.record.counts.fieldChanges).toBe(1);
        expect(applied.record.fields.filter(f => f.field === 'photo')).toHaveLength(1);
        const undo = recordGroups(applied.record, applied.data).find(g => g.key === 'fields')!.lines.map(l => l.text);
        expect(undo.join('\n')).toContain(told);
        expect(undo.join('\n')).not.toContain(same);
        const { txt } = exportPlan(plan, { source: file, target: tree, year: 2026 });
        expect(txt).toContain(told);
        expect(txt).not.toContain(same);
    });
});

describe('the record of a merge over references (merge/record.ts, spec 134 part C)', () => {
    it('a picture is one token in either form, never the reference itself', async () => {
        const [url] = [image(70)];
        const [ref] = await pool(url);
        expect(compactValue(ref)).toEqual(compactValue(url));
        expect(compactValue(ref)).toMatchObject({ $img: expect.stringMatching(/^\d+:/) });
        expect(valueKey({ photo: ref })).toBe(valueKey({ photo: url }));
        // An added person's print: the same before and after the picture was saved.
        expect(personPrint(person(B, { photo: ref }))).toBe(personPrint(person(B, { photo: url })));
        expect(personPrint(person(B, { photo: ref }))).not.toBe(personPrint(person(B, { photo: image(71) })));
    });

    it('the edits of a merge name no pooled image (the load would drop it, the cleanup would not see it)', async () => {
        const urls = [image(72), image(73), image(74), image(75)];
        const refs = await pool(...urls);
        const before = couple({ portrait: refs[0], file: refs[1], excerpt: refs[2] });
        const after = structuredClone(before);
        after.persons[A].photo = refs[3];
        after.media!.m1.dataUrl = refs[3];
        after.sources!.s1.excerpts![0].dataUrl = refs[3];
        const edits = mergeEdits(before, after);
        expect(edits.map(e => `${e.in}.${e.key}`).sort()).toEqual(['media.dataUrl', 'persons.photo', 'sources.excerpts']);
        expect(collectPoolRefIds(edits, new Set())).toEqual(new Set());
        expect(JSON.stringify(edits)).not.toContain(POOL_REF);
        expect(edits.find(e => e.key === 'photo')?.before).toEqual(compactValue(urls[0]));
        // The same pictures saved meanwhile (references against data URLs): no edit.
        expect(mergeEdits(couple({ portrait: urls[0], file: urls[1], excerpt: urls[2] }), before)).toEqual([]);
    });
});

describe('the merge guide pools the import (merge/ui.ts)', () => {
    const T1 = 't1' as TreeId;
    const ui = {
        showAlert: vi.fn(async () => {}), showConfirm: vi.fn(async () => false), showToast: vi.fn(),
        showTreeManagerDialog: vi.fn(), showTreeValidationDialog: vi.fn(async () => {}), refreshSearch: vi.fn(),
        updateTreeSwitcher: vi.fn(), closeTreeManagerDialog: vi.fn(), pushDialog: vi.fn(),
        afterImport: vi.fn(async () => {}), importNextPendingFor: vi.fn(() => false),
    };
    type Internals = {
        mergeState: MergeState | null; incomingPooling: Promise<void>;
        performAutoSave(): void; closeMergeModalInternal(): void;
        wizard: { rebuild(): void; next(): Promise<void> }; wizardSource(): WizardSource;
    };
    const internals = (): Internals => MergerUI as unknown as Internals;

    function meta(id: string, name: string): TreeMetadata {
        return { id: id as TreeId, name, createdAt: '2026-01-01', lastModifiedAt: '2026-01-01', personCount: 0, partnershipCount: 0, sizeBytes: 0 };
    }

    beforeEach(async () => {
        vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(false);
        vi.spyOn(SettingsManager, 'isAuditLogEnabled').mockReturnValue(false);
        vi.stubGlobal('window', new EventTarget());
        vi.stubGlobal('document', { getElementById: () => null, addEventListener() {}, removeEventListener() {} });
        setUIGetter(() => ui as never);
        const tm = TreeManager as unknown as {
            index: { version: number; activeTreeId: TreeId | null; trees: TreeMetadata[] };
            initialized: boolean; saveQueues: Map<TreeId, Promise<void>>; unreadableTrees: Set<TreeId>;
        };
        tm.index = { version: 1, activeTreeId: T1, trees: [meta('t1', 'Vranec')] };
        tm.initialized = true;
        tm.saveQueues = new Map();
        tm.unreadableTrees = new Set();
        internals().mergeState = null;
    });

    afterEach(async () => {
        await TreeManager.flush();
        internals().closeMergeModalInternal();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('holds the import with references, keeps them from the cleanup, saves them by reference and writes one picture each', async () => {
        const [x, y] = [image(50), image(51)];
        const [rx] = await pool(x);
        st('trees').set('t1', { version: 25, persons: { [A]: person(A, { partnerships: [], photo: rx }) }, partnerships: {} });
        expect(await DataManager.switchTree(T1)).toBe(true);
        expect(DataManager.getData().persons[A].photo).toBe(rx);

        // The file: the same man with the same portrait, and his wife with a portrait of her own.
        const file: StromData = {
            version: 25,
            persons: { [A]: person(A, { photo: x }), [B]: person(B, { photo: y }) },
            partnerships: { [U]: { id: U, person1Id: A, person2Id: B, childIds: [], status: 'married' } as Partnership },
        } as StromData;
        const given = structuredClone(file);
        MergerUI.startMerge(file, 'vranec.json');
        await internals().incomingPooling;
        const incoming = internals().mergeState!.incomingData;
        expect(incoming.persons[A].photo).toBe(rx);
        const ry = incoming.persons[B].photo!;
        expect(poolIdOf(ry)).toBeTruthy();
        expect(file).toEqual(given);
        // While the guide is open the cleanup sees both pictures as held.
        const held = memoryImageIds();
        expect(held.has(poolIdOf(rx)!)).toBe(true);
        expect(held.has(poolIdOf(ry)!)).toBe(true);

        // Its session names the import's picture by reference.
        internals().performAutoSave();
        await internals().incomingPooling;
        await new Promise(r => setTimeout(r, 0));
        const saved = JSON.stringify([...st('merge').values()]);
        expect(saved).toContain(poolIdOf(ry)!);
        expect(saved).not.toContain(y.slice(30, 90));

        // Compared, every pair the same person: no portrait difference, the write keeps one picture each.
        const opened = internals().mergeState!;
        const state = rebaseMergeState(opened, opened.existingData, opened.target);
        state.phase = 'reviewing';
        for (const m of state.matches) updateMatchDecision(state, m.incomingId, 'confirm');
        expect(state.matches.flatMap(m => m.conflicts ?? []).filter(c => c.field === 'photo')).toEqual([]);
        internals().mergeState = state;
        state.wizard = { step: 5, reached: 5, compared: true, choices: { ...freshChoices(internals().wizardSource(), state), into: 'tree' } };
        internals().wizard.rebuild();
        await internals().wizard.next();
        await TreeManager.flush();
        const data = DataManager.getData();
        expect(data.persons[A].photo).toBe(rx);
        expect(Object.values(data.persons).find(p => p.firstName === 'Ilmara')?.photo).toBe(ry);
    });
    it('Save for later tells Manage trees of the session only once it is stored (it waits for the import\'s images)', async () => {
        st('trees').set('t1', { version: 25, persons: { [A]: person(A, { partnerships: [] }) }, partnerships: {} });
        expect(await DataManager.switchTree(T1)).toBe(true);
        const file: StromData = {
            version: 25,
            persons: { [A]: person(A, { photo: image(60) }), [B]: person(B, { photo: image(61) }) },
            partnerships: { [U]: { id: U, person1Id: A, person2Id: B, childIds: [], status: 'married' } as Partnership },
        } as StromData;
        MergerUI.startMerge(file, 'vranec.json');
        // What an open Manage trees would list when told of the change.
        const listed: number[] = [];
        const onChange = (): void => { listed.push(((st('merge').get('sessions') as unknown[] | undefined) ?? []).length); };
        window.addEventListener('strom:merge-session-changed', onChange);
        try {
            MergerUI.saveForLater();
            await internals().incomingPooling;
            await vi.waitFor(() => expect(listed.length).toBeGreaterThan(0));
            expect(listed).toEqual([1]);
        } finally {
            window.removeEventListener('strom:merge-session-changed', onChange);
        }
    });

    it('a merge that replaced a portrait: its stored record names no image, the cleanup keeps the old one by the backup, the undo puts its reference back', async () => {
        const T2 = 't2' as TreeId;
        (TreeManager as unknown as { index: { trees: TreeMetadata[] } }).index.trees.push(meta('t2', 'Vranec II'));
        const [old, fresh, wife] = [image(80), image(81), image(82)];
        const [rOld] = await pool(old);
        st('trees').set('t2', { version: 25, persons: { [A]: person(A, { partnerships: [], photo: rOld, photoOriginalName: 'stara.png' }) }, partnerships: {} });
        // The file: the same man with another portrait, and his wife; pooled as the guide does.
        const file: StromData = {
            version: 25,
            persons: { [A]: person(A, { photo: fresh, photoOriginalName: 'nova.png' }), [B]: person(B, { photo: wife }) },
            partnerships: { [U]: { id: U, person1Id: A, person2Id: B, childIds: [], status: 'married' } as Partnership },
        } as StromData;
        let source: StromData | null = null;
        await poolTreeImages(file, 'test:file', false, pooled => { source = pooled; return true; });
        expect(source).not.toBeNull();
        const incoming = source as unknown as StromData;
        const target = (await TreeManager.getTreeData(T2))!;
        expect(target.persons[A].photo).toBe(rOld);
        const state = createMergeState(target, incoming);
        for (const m of state.matches) updateMatchDecision(state, m.incomingId, 'confirm');
        const plan = buildPlan(state, {
            mode: 'add', targetTreeId: T2, scope: 'c', swapped: false, rules: { all: 'import' },
            source: { kind: 'json', label: 'vranec.json', persons: 2 }, targetName: 'Vranec II', targetFingerprint: contentFingerprint(target),
            planId: 'mp-portrait', createdAt: '2026-05-04T10:00:00.000Z',
        });
        const written = await writePlan(plan, { target, source: incoming, into: 'tree' });
        expect(written.ok).toBe(true);
        await TreeManager.flush();
        const rFresh = incoming.persons[A].photo!;
        expect(poolIdOf(rFresh)).toBeTruthy();

        // Stored: the record keeps a token of the old portrait, no reference of it.
        expect(JSON.stringify(st('trees').get('t2'))).not.toContain(poolIdOf(rOld)!);
        const stored = (await TreeManager.getTreeData(T2))!;
        expect(stored.persons[A].photo).toBe(rFresh);
        const edit = stored.merges![0].edits!.find(e => e.in === 'persons' && e.key === 'photo')!;
        expect(edit.before).toEqual(compactValue(old));

        // A week and more of cleanups: the old portrait stays, the backup "Before merge" names it.
        const t0 = Date.now();
        await withPoolLock(() => collectPoolGarbageLocked(t0));
        await withPoolLock(() => collectPoolGarbageLocked(t0 + POOL_UNUSED_GRACE_MS + 86_400_000));
        expect(await pooledIds([poolIdOf(rOld)!])).toEqual(new Set([poolIdOf(rOld)!]));

        // The undo: the old portrait back by its reference (the backup read with references, not whole).
        const undone = await writeUndo(T2, plan.id, { at: '2026-05-05T10:00:00.000Z' });
        expect(undone.ok).toBe(true);
        if (!undone.ok) return;
        expect(undone.kept).toEqual([]);
        expect(undone.data.persons[A].photo).toBe(rOld);
        await TreeManager.flush();
        expect((await TreeManager.getTreeData(T2))!.persons[A].photo).toBe(rOld);
    });
});
