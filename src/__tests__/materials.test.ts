/**
 * Materials (spec 017 U5): joining attachments with the research's files,
 * sorting, gates, actions, search, the bridge client's errors and quiet
 * retries, and the cache's limits (in memory; IndexedDB itself is not tested).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Attachment } from '../types.js';
import { setLanguage, strings } from '../strings.js';
import {
    MaterialFile, MaterialList, MaterialCacheRecord, MaterialCaps, ThumbMeta,
    parseMaterialList, personMaterials, materialActions, materialCaps, matList, matAssign, matThumb,
    materialMatches, foldText, fileWithoutPerson, materialKindLabel, batchFolderLabel, materialFolder, materialType,
    fetchMaterial, assignMaterial, hideMaterial, fetchThumb, materialErrorText, materialErrorAction, materialErrorOf,
    materialUrl, thumbUrl, fileUrl, materialSystemLink,
    applyMaterialAnswer, trimListForCache, thumbsToEvict, LIST_CACHE_LIMIT,
    setMaterialsBackend, memoryMaterialsBackend, saveMaterialList, mergeIntoCache, cachedMaterialList, primeMaterials,
    clearMaterialsCache, putCachedThumb, getCachedThumb, personMaterialCount,
    directPersons, materialFromKey, addedPersons, assignUndoRequests, batchUndoRequest, applyBatchPersons, mergeAssignIntoCache,
    materialDate,
} from '../materials.js';
import { formatFlexDate } from '../dates.js';

const BASE = 'http://127.0.0.1:5998/0123456789abcdef0123456789abcdef';
const sha = (n: number) => n.toString(16).padStart(64, '0');

function file(n: number, init: Partial<MaterialFile> = {}): MaterialFile {
    return { id: `I${String(n).padStart(4, '0')}`, name: `scan-${n}.jpg`, sha: sha(n), mime: 'image/jpeg', persons: [], ...init };
}

function list(files: MaterialFile[], extra: Partial<MaterialList> = {}): MaterialList {
    return { files, batches: [], people: {}, fetchedAt: 1, ...extra };
}

function att(id: string, init: Partial<Attachment> = {}): Attachment {
    return { id, name: `${id}.jpg`, mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AA==', sizeBytes: 10, ...init };
}

const caps = (over: Partial<MaterialCaps> = {}): MaterialCaps => ({ list: true, assign: true, thumb: true, bridgeUp: true, ...over });

/** A fetch answering from a queue of [status, body, headers]. */
function fakeFetch(answers: [number, unknown, Record<string, string>?][]) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const impl = async (url: string, init?: RequestInit): Promise<Response> => {
        calls.push({ url, init });
        const next = answers.shift();
        if (!next) throw new TypeError('connection refused');
        const [status, body, headers] = next;
        return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: headers ?? {} });
    };
    return { impl, calls };
}

beforeEach(() => setLanguage('en'));

describe('parseMaterialList', () => {
    it('keeps valid records and drops broken ones', () => {
        const l = parseMaterialList({
            files: [
                { id: 'I0001', name: 'a.jpg', sha: sha(1), persons: ['P0001', 'bad'], kind: 'photo', hidden: { reason: 'duplicate', by: 'app' } },
                { id: 'X1', name: 'b.jpg', sha: sha(2), persons: [] },
                { id: 'I0003', name: 'c.jpg', sha: 'nothex', persons: [] },
                { id: 'I0001', name: 'dup.jpg', sha: sha(9), persons: [] },
            ],
            batches: [{ id: 'b1', name: 'Box', files: 2, persons: ['P0002'] }, { name: 'no id' }],
            people: { P0001: 'Jan Novák (1901–1975)', nope: 'x' },
        }, 5);
        expect(l.files.map(f => f.id)).toEqual(['I0001']);
        expect(l.files[0].persons).toEqual(['P0001']);
        expect(l.files[0].hidden).toEqual({ reason: 'duplicate', by: 'app' });
        expect(l.batches).toEqual([{ id: 'b1', name: 'Box', files: 2, persons: ['P0002'] }]);
        expect(l.people).toEqual({ P0001: 'Jan Novák (1901–1975)' });
        expect(l.fetchedAt).toBe(5);
    });
});

describe('personMaterials', () => {
    const person = (attachments: Attachment[], refn: string | undefined = 'P0001') => ({ refn, attachments });

    it('joins an attachment with its original (both), keeps the others (tree / archive)', () => {
        const a1 = att('a1', { original: { sha256: sha(1), name: 'x.jpg', mimeType: 'image/jpeg', bytes: 5 } });
        const a2 = att('a2');
        const l = list([
            file(1, { persons: ['P0001'], at: '2026-10-01T10:00:00Z', title: 'Wedding' }),
            file(2, { persons: ['P0001'], at: '2026-10-02T10:00:00Z' }),
            file(3, { persons: ['P0009'], at: '2026-10-03T10:00:00Z' }),
        ]);
        const items = personMaterials(person([a1, a2]), l);
        expect(items.map(i => [i.key, i.origin])).toEqual([
            ['m:I0002', 'archive'], ['m:I0001', 'both'], ['a:a2', 'tree'],
        ]);
        const both = items[1];
        expect(both.attachment?.id).toBe('a1');
        expect(both.title).toBe('Wedding');
        expect(both.persons).toEqual(['P0001']);
    });

    it('joins by hash even when the file no longer names the person', () => {
        const a1 = att('a1', { original: { sha256: sha(7), name: 'x.jpg', mimeType: 'image/jpeg', bytes: 5 } });
        const items = personMaterials(person([a1]), list([file(7, { persons: ['P0005'] })]));
        expect(items).toHaveLength(1);
        expect(items[0].origin).toBe('both');
    });

    it('marks people only through the batch as viaBatch', () => {
        const l = list([
            file(1, { batch: 'b1', persons: [] }),
            file(2, { batch: 'b1', persons: ['P0001'] }),
            file(3, { batch: 'b1', persons: [], sorted: { persons: ['P0001'] } }),
        ], { batches: [{ id: 'b1', name: 'Box', files: 3, persons: ['P0001'] }] });
        const items = personMaterials(person([]), l);
        const by = Object.fromEntries(items.map(i => [i.key, i]));
        expect(by['m:I0001'].viaBatch).toEqual(['P0001']);
        expect(by['m:I0001'].batch).toEqual({ id: 'b1', name: 'Box' });
        expect(by['m:I0002'].viaBatch).toEqual([]);
        expect(by['m:I0003'].viaBatch).toEqual([]);
    });

    it('sorts by time received, newest first; items without a time last in attachment order', () => {
        const l = list([
            file(1, { persons: ['P0001'], at: '2026-01-01T00:00:00Z' }),
            file(2, { persons: ['P0001'], at: '2026-05-01T00:00:00Z' }),
            file(3, { persons: ['P0001'] }),
        ]);
        const items = personMaterials(person([att('z'), att('y')]), l);
        expect(items.map(i => i.key)).toEqual(['m:I0002', 'm:I0001', 'a:z', 'a:y', 'm:I0003']);
    });

    it('leaves hidden files out unless asked', () => {
        const l = list([file(1, { persons: ['P0001'], hidden: { reason: 'unrelated' } }), file(2, { persons: ['P0001'] })]);
        expect(personMaterials(person([]), l).map(i => i.key)).toEqual(['m:I0002']);
        const all = personMaterials(person([]), l, { includeHidden: true });
        expect(all.map(i => i.key).sort()).toEqual(['m:I0001', 'm:I0002']);
        expect(all.find(i => i.key === 'm:I0001')?.hidden).toEqual({ reason: 'unrelated' });
    });

    it('a person without a REFN, or without a list: attachments only', () => {
        const l = list([file(1, { persons: ['P0001'] })]);
        expect(personMaterials({ refn: undefined, attachments: [att('a')] }, l).map(i => i.key)).toEqual(['a:a']);
        expect(personMaterials(person([att('a')]), null).map(i => i.origin)).toEqual(['tree']);
    });

    it('takes the sender note, else the attachment note; here from the file', () => {
        const a = att('a', { note: 'from the drawer', original: { sha256: sha(1), name: 'x', mimeType: 'image/jpeg', bytes: 1 } });
        const l = list([
            file(1, { persons: ['P0001'], notes: [{ by: 'agent', text: 'sorted' }] }),
            file(2, { persons: ['P0001'], here: false, notes: [{ by: 'user', text: 'Attic, 1980' }, { by: 'agent', text: 'x' }] }),
        ]);
        const by = Object.fromEntries(personMaterials(person([a]), l).map(i => [i.key, i]));
        expect(by['m:I0001'].noteUser).toBe('from the drawer');
        expect(by['m:I0002'].noteUser).toBe('Attic, 1980');
        expect(by['m:I0002'].here).toBe(false);
        expect(by['m:I0001'].here).toBe(true);
    });

    it('counts for the menu: items without hidden; without the list the attachments', () => {
        const l = list([file(1, { persons: ['P0001'] }), file(2, { persons: ['P0001'], hidden: {} })]);
        expect(personMaterialCount(person([att('a')]), l, true)).toBe(2);
        expect(personMaterialCount(person([att('a')]), l, false)).toBe(1);
    });
});

describe('without a person', () => {
    it('needs no person on the file, from sorting nor on its batch', () => {
        const batches = [{ id: 'b1', name: 'B', files: 1, persons: ['P0001'] }, { id: 'b2', name: 'C', files: 1 }];
        expect(fileWithoutPerson(file(1), { batches })).toBe(true);
        expect(fileWithoutPerson(file(1, { batch: 'b2' }), { batches })).toBe(true);
        expect(fileWithoutPerson(file(1, { batch: 'b1' }), { batches })).toBe(false);
        expect(fileWithoutPerson(file(1, { persons: ['P0002'] }), { batches })).toBe(false);
        expect(fileWithoutPerson(file(1, { sorted: { persons: ['P0002'] } }), { batches })).toBe(false);
    });
});

describe('labels', () => {
    it('kind from kind, else from the type (TIFF/HEIC named)', () => {
        expect(materialKindLabel({ kind: 'photo', title: 'x' })).toBe('Photo');
        expect(materialKindLabel({ mime: 'image/tiff', title: 'x.tif' })).toBe('Image TIFF');
        expect(materialKindLabel({ mime: 'image/jpeg', title: 'x.jpg' })).toBe('Image');
        expect(materialKindLabel({ mime: 'application/pdf', title: 'x.pdf' })).toBe('PDF');
        expect(materialKindLabel({ mime: 'audio/mpeg', title: 'x' })).toBe('Audio');
        expect(materialKindLabel({ title: 'x.heic' })).toBe('Image HEIC');
        expect(materialKindLabel({ title: 'notes.txt' })).toBe('File');
        setLanguage('cs');
        expect(materialKindLabel({ kind: 'record', title: 'x' })).toBe(strings.materials.kind.record);
    });

    it('type from mime, else the extension', () => {
        expect(materialType('image/png')).toBe('image');
        expect(materialType(undefined, 'a.TIF')).toBe('image');
        expect(materialType('application/octet-stream', 'a.pdf')).toBe('pdf');
        expect(materialType('text/plain', 'a.jpg')).toBe('file');
    });

    it('batch › folder; outside a batch: single files', () => {
        expect(materialFolder('Grandma/Letters/1946.jpg')).toBe('Grandma / Letters');
        expect(materialFolder('1946.jpg')).toBe('');
        expect(batchFolderLabel({ batch: { id: 'b', name: 'Box' }, path: 'Letters/a.jpg' })).toBe('Box › Letters');
        expect(batchFolderLabel({ batch: { id: 'b', name: 'Box' }, path: 'a.jpg' })).toBe('Box');
        expect(batchFolderLabel({})).toBe(strings.materials.loose);
        // A tree attachment without its original in the research: "In the tree", batch or not.
        expect(batchFolderLabel({ origin: 'tree' })).toBe(strings.materials.inTreeGroup);
        expect(batchFolderLabel({ origin: 'archive' })).toBe(strings.materials.loose);
    });
});

describe('search', () => {
    it('matches every word without diacritics or case in title, name, path and notes', () => {
        const [item] = personMaterials({ refn: 'P0001', attachments: [] }, list([file(1, {
            persons: ['P0001'], title: 'Svatba Novákových', name: 'IMG_2041.jpg', path: 'Půda/Dopisy/IMG_2041.jpg',
            notes: [{ by: 'agent', text: 'Žďár nad Sázavou' }],
        })]));
        expect(foldText('Žďár ŠÍLENĚ')).toBe('zdar silene');
        expect(materialMatches(item, 'novakovych')).toBe(true);
        expect(materialMatches(item, 'img_2041')).toBe(true);
        expect(materialMatches(item, 'puda dopisy')).toBe(true);
        expect(materialMatches(item, 'zdar SAZAVOU')).toBe(true);
        expect(materialMatches(item, 'zdar brno')).toBe(false);
        expect(materialMatches(item, '  ')).toBe(true);
    });
});

describe('gates', () => {
    const env = { features: ['material.list', 'material.assign', 'material.thumb'], linked: true, onComputer: true, bridgeUp: true };

    it('list needs a linked tree on a computer and the capability (not the bridge)', () => {
        expect(matList(env)).toBe(true);
        expect(matList({ ...env, bridgeUp: false })).toBe(true);
        expect(matList({ ...env, onComputer: false })).toBe(false);
        expect(matList({ ...env, linked: false })).toBe(false);
        expect(matList({ ...env, features: ['material.assign'] })).toBe(false);
        expect(matList({ ...env, features: null })).toBe(false);
    });

    it('assign needs its capability; previews need the bridge running', () => {
        expect(matAssign({ ...env, features: ['material.list'] })).toBe(false);
        expect(matAssign({ ...env, bridgeUp: false })).toBe(true);
        expect(matThumb(env)).toBe(true);
        expect(matThumb({ ...env, bridgeUp: false })).toBe(false);
        expect(matThumb({ ...env, features: ['material.list', 'material.assign'] })).toBe(false);
        expect(materialCaps({ ...env, onComputer: false })).toEqual({ list: false, assign: false, thumb: false, bridgeUp: true });
    });
});

describe('materialActions', () => {
    const l = list([
        file(1, { persons: ['P0001'], batch: 'b1' }),
        file(2, { batch: 'b1' }),
        file(3, { persons: ['P0001'], hidden: {} }),
    ], { batches: [{ id: 'b1', name: 'Box', files: 2, persons: ['P0002'] }] });
    const items = personMaterials({ refn: 'P0001', attachments: [att('t')] }, l, { includeHidden: true });
    const by = Object.fromEntries(items.map(i => [i.key, i]));
    const ids = (a: { id: string }[]) => a.map(x => x.id);

    it('archive item: open, assign, remove, hide, system, batch', () => {
        expect(ids(materialActions(by['m:I0001'], caps(), { person: 'P0001' })))
            .toEqual(['open', 'assign', 'removeFromPerson', 'hide', 'openSystem', 'showInBatch']);
    });

    it('a hidden item restores instead of hiding', () => {
        expect(ids(materialActions(by['m:I0003'], caps(), { person: 'P0001' })))
            .toEqual(['open', 'assign', 'removeFromPerson', 'restore', 'openSystem']);
    });

    it('a person only through the batch: removing offers the whole batch', () => {
        const it2 = personMaterials({ refn: 'P0002', attachments: [] }, l).find(i => i.key === 'm:I0002')!;
        const remove = materialActions(it2, caps(), { person: 'P0002' }).find(a => a.id === 'removeFromPerson');
        expect(remove).toEqual({ id: 'removeFromPerson', viaBatch: true });
    });

    it('tree item: open, download, delete', () => {
        expect(ids(materialActions(by['a:t'], caps(), { person: 'P0001' }))).toEqual(['open', 'download', 'deleteFromTree']);
    });

    it('an older research: no writes; bridge down: writes disabled', () => {
        expect(ids(materialActions(by['m:I0001'], caps({ assign: false }), { person: 'P0001' })))
            .toEqual(['open', 'openSystem', 'showInBatch']);
        const down = materialActions(by['m:I0001'], caps({ bridgeUp: false }), { person: 'P0001' });
        expect(down.filter(a => a.disabled === 'bridgeDown').map(a => a.id)).toEqual(['assign', 'removeFromPerson', 'hide']);
        expect(down.find(a => a.id === 'open')?.disabled).toBeUndefined();
    });
});

describe('bridge client', () => {
    it('builds URLs and turns down bad filters without asking', async () => {
        expect(materialUrl(BASE, { person: 'P0012', files0: true })).toMatch(/\/material\?person=P0012&files=0&app=/);
        expect(materialUrl(BASE, { batch: 'b 1' })).toMatch(/\/material\?batch=b(\+|%20)1&/);
        expect(materialUrl(BASE, { person: 'Jan' })).toBeNull();
        expect(thumbUrl(BASE, sha(1), 256)).toContain(`/media/${sha(1)}?thumb=256`);
        expect(fileUrl(BASE, sha(1))).toContain(`/media/${sha(1)}?file=1`);
        expect(materialSystemLink('3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77', sha(1)))
            .toBe(`strom-research://media?tree=3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77&sha=${sha(1)}`);
        const f = fakeFetch([]);
        const res = await fetchMaterial(BASE, { person: 'nobody' }, { fetchImpl: f.impl });
        expect(res).toEqual({ ok: false, error: { kind: 'query', status: 0 } });
        expect(f.calls).toHaveLength(0);
    });

    it('fetches and parses the list', async () => {
        const f = fakeFetch([[200, { files: [{ id: 'I0001', name: 'a', sha: sha(1), persons: [] }], batches: [] }]]);
        const res = await fetchMaterial(BASE, {}, { fetchImpl: f.impl, now: () => 42 });
        expect(res.ok && res.value.files.length).toBe(1);
        expect(res.ok && res.value.fetchedAt).toBe(42);
        expect(f.calls[0].init?.credentials).toBe('omit');
    });

    it('retries a busy research quietly: 1, 2, 4 s, then gives up', async () => {
        const busy: [number, unknown] = [409, { error: 'busy', code: 'material.busy', text: '…' }];
        const f = fakeFetch([busy, busy, busy, busy]);
        const waits: number[] = [];
        const res = await assignMaterial(BASE, { files: ['I0001'], add: ['P0001'] }, { fetchImpl: f.impl, sleep: async ms => { waits.push(ms); } });
        expect(waits).toEqual([1000, 2000, 4000]);
        expect(f.calls).toHaveLength(4);
        expect(res.ok).toBe(false);
        if (!res.ok) {
            expect(res.error.kind).toBe('busy');
            expect(materialErrorText(res.error, false)).toBe(strings.materials.errBusy);
            expect(materialErrorText(res.error, true)).toBe(strings.materials.errBusyResearch);
            expect(materialErrorAction(res.error)).toBe('retry');
        }
    });

    it('waits as long as the research asks (capped), and succeeds after busy', async () => {
        const f = fakeFetch([
            [409, { code: 'material.busy', retry: 3 }],
            [409, { code: 'material.busy' }, { 'Retry-After': '60' }],
            [200, { files: [{ id: 'I0001', name: 'a', sha: sha(1), persons: ['P0001'] }], people: { P0001: 'Jan' }, kept: [{ id: 'I0001', person: 'P0002', batch: 'b1' }] }],
        ]);
        const waits: number[] = [];
        const res = await assignMaterial(BASE, { files: ['I0001'], add: ['P0001'], remove: ['P0002'] }, { fetchImpl: f.impl, sleep: async ms => { waits.push(ms); } });
        expect(waits).toEqual([3000, 10_000]);
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.value.kept).toEqual([{ id: 'I0001', person: 'P0002', batch: 'b1' }]);
            expect(res.value.people).toEqual({ P0001: 'Jan' });
        }
        expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ files: ['I0001'], add: ['P0001'], remove: ['P0002'] });
        expect(f.calls[0].init?.method).toBe('POST');
    });

    it('maps refusals to texts (archive vs research) and actions', async () => {
        const cases: [number, string, string, string][] = [
            [404, 'material.person', strings.materials.errPerson, strings.materials.errPersonResearch],
            [404, 'material.file', strings.materials.errFile, strings.materials.errFileResearch],
            [403, 'material.readonly', strings.materials.errReadonly, strings.materials.errReadonlyResearch],
            [404, 'material.batch', strings.materials.errGeneric, strings.materials.errGeneric],
            [400, 'material.body', strings.materials.errGeneric, strings.materials.errGeneric],
            [400, 'material.query', strings.materials.errGeneric, strings.materials.errGeneric],
            [410, 'media.gone', strings.materials.notHere, strings.materials.notHereResearch],
        ];
        for (const [status, code, archive, research] of cases) {
            const f = fakeFetch([[status, { error: 'x', code, text: 'x', params: { id: 'P0001' } }]]);
            const res = await hideMaterial(BASE, { files: ['I0001'], hidden: true, reason: 'duplicate' }, { fetchImpl: f.impl });
            expect(res.ok).toBe(false);
            if (res.ok) continue;
            expect(res.error.code).toBe(code);
            expect(materialErrorText(res.error, false)).toBe(archive);
            expect(materialErrorText(res.error, true)).toBe(research);
        }
        expect(materialErrorAction(materialErrorOf(404, { code: 'material.batch' }))).toBe('reload');
        expect(materialErrorAction(materialErrorOf(403, { code: 'material.readonly' }))).toBeNull();
    });

    it('a bridge not answering is "down"', async () => {
        const f = fakeFetch([]);
        const res = await fetchMaterial(BASE, {}, { fetchImpl: f.impl });
        expect(res).toEqual({ ok: false, error: { kind: 'down', status: 0 } });
    });

    it('checks the request before sending', async () => {
        const f = fakeFetch([]);
        const o = { fetchImpl: f.impl };
        expect((await assignMaterial(BASE, { files: ['I0001'] }, o)).ok).toBe(false);
        expect((await assignMaterial(BASE, { files: ['I0001'], batch: 'b', add: ['P0001'] }, o)).ok).toBe(false);
        expect((await assignMaterial(BASE, { files: ['I1'], add: ['Jan'] }, o)).ok).toBe(false);
        expect((await hideMaterial(BASE, { files: [], hidden: true }, o)).ok).toBe(false);
        expect(f.calls).toHaveLength(0);
        const g = fakeFetch([[200, { files: [], people: {}, kept: [] }]]);
        await assignMaterial(BASE, { batch: 'b1', remove: ['P0001'] }, { fetchImpl: g.impl });
        expect(JSON.parse(String(g.calls[0].init?.body))).toEqual({ batch: 'b1', remove: ['P0001'] });
    });

    it('previews: the image, or 415 as a type it cannot show', async () => {
        const ok = async (url: string) => new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), { status: 200, headers: { 'X-Url': url } });
        const res = await fetchThumb(BASE, sha(1), 256, { fetchImpl: ok });
        expect(res.ok && res.value.size).toBe(3);
        const f = fakeFetch([[415, { code: 'thumb.type' }]]);
        const bad = await fetchThumb(BASE, sha(1), 256, { fetchImpl: f.impl });
        expect(!bad.ok && bad.error.kind).toBe('type');
    });
});

describe('cache', () => {
    beforeEach(() => setMaterialsBackend(memoryMaterialsBackend()));

    it('stores answers by scope and merges assign answers by id', async () => {
        const all = list([file(1, { persons: ['P0001'] }), file(2)], { batches: [{ id: 'b1', name: 'B', files: 5 }], people: { P0001: 'Jan' } });
        await saveMaterialList('t1', all, { kind: 'all' });
        expect(cachedMaterialList('t1')?.files).toHaveLength(2);
        await mergeIntoCache('t1', [file(2, { persons: ['P0003'] }), file(3)], { P0003: 'Eva' });
        const l = cachedMaterialList('t1')!;
        expect(l.files.map(f => [f.id, f.persons])).toEqual([['I0001', ['P0001']], ['I0002', ['P0003']], ['I0003', []]]);
        expect(l.people).toEqual({ P0001: 'Jan', P0003: 'Eva' });
        // Read back after the memory map is cleared (as after a reload, same storage).
        const backendRows = await primeMaterials('t1');
        expect(backendRows?.list.files).toHaveLength(3);
        await clearMaterialsCache('t1');
        expect(cachedMaterialList('t1')).toBeNull();
    });

    it('a person\'s answer takes the person off files no longer theirs; batch counts stay', () => {
        const prev: MaterialCacheRecord = {
            treeId: 't', full: true, opened: {},
            list: list([file(1, { persons: ['P0001', 'P0002'] }), file(2, { persons: ['P0001'] })], { batches: [{ id: 'b1', name: 'B', files: 9 }] }),
        };
        const next = applyMaterialAnswer(prev, 't', list([file(2, { persons: ['P0001'] })], { batches: [{ id: 'b1', name: 'B2', files: 1 }], fetchedAt: 7 }), { kind: 'person', person: 'P0001' });
        expect(next.list.files.map(f => f.persons)).toEqual([['P0002'], ['P0001']]);
        expect(next.list.batches).toEqual([{ id: 'b1', name: 'B2', files: 9 }]);
        expect(next.list.fetchedAt).toBe(7);
        expect(prev.list.files[0].persons).toEqual(['P0001', 'P0002']);
    });

    it('a batch answer replaces that batch\'s files and remembers it was opened', () => {
        const prev: MaterialCacheRecord = { treeId: 't', full: false, opened: {}, list: list([file(1, { batch: 'b1' }), file(2, { batch: 'b2' })]) };
        const next = applyMaterialAnswer(prev, 't', list([file(3, { batch: 'b1' })], { batches: [{ id: 'b1', name: 'B', files: 1 }], fetchedAt: 100 }), { kind: 'batch', batch: 'b1' });
        expect(next.list.files.map(f => f.id)).toEqual(['I0002', 'I0003']);
        expect(next.opened).toEqual({ b1: 100 });
        const files0 = applyMaterialAnswer(next, 't', list([], { batches: [{ id: 'b9', name: 'N', files: 4 }] }), { kind: 'files0' });
        expect(files0.list.files).toHaveLength(2);
        expect(files0.list.batches.map(b => b.id)).toEqual(['b9']);
    });

    it('over 5 MB keeps only batches and files of batches opened in the last 30 days', () => {
        const now = Date.UTC(2026, 9, 23);
        const big = 'x'.repeat(2000);
        const files: MaterialFile[] = [];
        for (let i = 1; i <= 3000; i++) files.push(file(i, { batch: i <= 100 ? 'recent' : i <= 2000 ? 'old' : undefined, notes: [{ text: big }] }));
        const rec: MaterialCacheRecord = {
            treeId: 't', full: true, list: list(files, { batches: [{ id: 'recent', name: 'R', files: 100 }, { id: 'old', name: 'O', files: 1900 }] }),
            opened: { recent: now - 2 * 86_400_000, old: now - 40 * 86_400_000 },
        };
        expect(JSON.stringify(rec).length).toBeGreaterThan(LIST_CACHE_LIMIT);
        const kept = trimListForCache(rec, now);
        expect(kept.full).toBe(false);
        expect(kept.list.files).toHaveLength(100);
        expect(kept.list.files.every(f => f.batch === 'recent')).toBe(true);
        expect(kept.list.batches).toHaveLength(2);
        expect(kept.opened).toEqual({ recent: now - 2 * 86_400_000 });
        const small: MaterialCacheRecord = { ...rec, list: list([file(1)]) };
        expect(trimListForCache(small, now)).toBe(small);
    });

    it('previews: least recently used go over the limit', async () => {
        const rows: ThumbMeta[] = [
            { key: 'a', treeId: 't', sha: 'a', px: 256, bytes: 30, usedAt: 3 },
            { key: 'b', treeId: 't', sha: 'b', px: 256, bytes: 30, usedAt: 1 },
            { key: 'c', treeId: 't', sha: 'c', px: 256, bytes: 30, usedAt: 2 },
        ];
        expect(thumbsToEvict(rows, 100)).toEqual([]);
        expect(thumbsToEvict(rows, 60)).toEqual(['b']);
        expect(thumbsToEvict(rows, 20)).toEqual(['b', 'c', 'a']);
        const blob = new Blob([new Uint8Array(10)]);
        await putCachedThumb('t', sha(1), 256, blob, 1);
        expect((await getCachedThumb('t', sha(1), 256, 2))?.size).toBe(10);
        expect(await getCachedThumb('t', sha(1), 128)).toBeNull();
    });

    it('falls back to memory when the storage fails', async () => {
        const broken = memoryMaterialsBackend();
        broken.getList = async () => { throw new Error('blocked'); };
        broken.putList = async () => { throw new Error('blocked'); };
        setMaterialsBackend(broken);
        await saveMaterialList('t2', list([file(1)]), { kind: 'all' });
        expect(cachedMaterialList('t2')?.files).toHaveLength(1);
    });
});

describe('assign and its undo', () => {
    beforeEach(() => setMaterialsBackend(memoryMaterialsBackend()));

    it('a file names its own and its sorting\'s people, not its batch\'s', () => {
        expect(directPersons(file(1, { persons: ['P0001'], sorted: { persons: ['P0002', 'P0001'] }, batch: 'b1' }))).toEqual(['P0001', 'P0002']);
    });

    it('where a file came from', () => {
        expect(materialFromKey('the Strom app')).toBe('app');
        expect(materialFromKey('batch from the Strom app')).toBe('batch');
        expect(materialFromKey('phone')).toBe('phone');
        expect(materialFromKey('terminal')).toBe('cli');
        expect(materialFromKey('cli')).toBe('cli');
        expect(materialFromKey('somewhere')).toBeNull();
        expect(materialFromKey(undefined)).toBeNull();
    });

    it('the people an assign really added (not those already there)', () => {
        const before = [file(1, { persons: ['P0001'] }), file(2)];
        const after = [file(1, { persons: ['P0001', 'P0002'] }), file(2, { persons: ['P0001', 'P0002'] })];
        expect(addedPersons(before, after, ['P0001', 'P0002', 'P0003'])).toEqual(['P0001', 'P0002']);
        expect(addedPersons(after, after, ['P0001'])).toEqual([]);
    });

    it('undo takes off only what the assign added and puts back only what it took off', () => {
        const before = [file(1, { persons: ['P0001'] }), file(2), file(3, { persons: ['P0002'] })];
        const after = [file(1, { persons: ['P0001', 'P0003'] }), file(2, { persons: ['P0003'] }), file(3)];
        expect(assignUndoRequests(before, after)).toEqual([
            { files: ['I0001', 'I0002'], remove: ['P0003'] },
            { files: ['I0003'], add: ['P0002'] },
        ]);
        expect(assignUndoRequests(before, before)).toEqual([]);
    });

    it('a whole batch\'s undo: only the people really changed', () => {
        const batch = { id: 'b1', persons: ['P0001'] };
        expect(batchUndoRequest(batch, ['P0001', 'P0002'], [])).toEqual({ batch: 'b1', remove: ['P0002'] });
        expect(batchUndoRequest(batch, [], ['P0001', 'P0003'])).toEqual({ batch: 'b1', add: ['P0001'] });
        expect(batchUndoRequest(batch, ['P0001'], [])).toBeNull();
    });

    it('a batch\'s people change in the remembered list (pure) and with an assign answer', async () => {
        const rec: MaterialCacheRecord = { treeId: 't', list: list([], { batches: [{ id: 'b1', name: 'B', files: 2, persons: ['P0001'] }] }), full: true, opened: {} };
        const next = applyBatchPersons(rec, 'b1', ['P0002'], ['P0001']);
        expect(next.list.batches[0].persons).toEqual(['P0002']);
        expect(rec.list.batches[0].persons).toEqual(['P0001']);
        expect(applyBatchPersons(rec, 'nope', ['P0002'])).toBe(rec);

        await saveMaterialList('t3', rec.list, { kind: 'all' });
        await mergeAssignIntoCache('t3', [file(1, { batch: 'b1' })], { P0002: 'Eva' }, { id: 'b1', add: ['P0002'] });
        const l = cachedMaterialList('t3')!;
        expect(l.batches[0].persons).toEqual(['P0001', 'P0002']);
        expect(l.files.map(f => f.id)).toEqual(['I0001']);
        expect(l.people.P0002).toBe('Eva');
    });
});

describe('materialDate', () => {
    it('shows a GEDCOM date formatted, not as the raw text', () => {
        expect(materialDate('12 MAY 1932')).toBe(formatFlexDate('1932-05-12'));
        expect(materialDate('12 MAY 1932')).not.toBe('12 MAY 1932');
    });
    it('keeps a free text as written', () => {
        expect(materialDate('spring of the flood')).toBe('spring of the flood');
    });
});
