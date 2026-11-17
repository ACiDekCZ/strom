/**
 * A material's title, kind and date (spec 102 §2): the item shows the title
 * with the file's name beside it, search reads both, the tree's files change
 * in one undo step, the date field reads and writes GEDCOM-like text, and
 * the bridge's `POST /material/edit` for material outside the tree.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { Attachment, Gender, StromData, TreeId } from '../types.js';
import { setLanguage } from '../strings.js';
import {
    MaterialFile, MaterialList, editMaterial, materialDateForInput, materialDateFromInput, materialMatches, personMaterials,
} from '../materials.js';

const BASE = 'http://127.0.0.1:5998/0123456789abcdef0123456789abcdef';
const sha = (n: number) => n.toString(16).padStart(64, '0');
const TREE = 'material-title-tree' as TreeId;

function att(id: string, init: Partial<Attachment> = {}): Attachment {
    return { id, name: `${id}.jpg`, mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AA==', sizeBytes: 10, places: [], ...init };
}
function file(n: number, init: Partial<MaterialFile> = {}): MaterialFile {
    return { id: `I${String(n).padStart(4, '0')}`, name: `scan-${n}.jpg`, sha: sha(n), mime: 'image/jpeg', persons: ['P0001'], ...init };
}
function list(files: MaterialFile[]): MaterialList {
    return { files, batches: [], people: {}, fetchedAt: 1 };
}

function fakeFetch(answers: [number, unknown][]) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const impl = async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        const next = answers.shift();
        if (!next) throw new TypeError('Failed to fetch');
        return new Response(JSON.stringify(next[1]), { status: next[0], headers: { 'Content-Type': 'application/json' } });
    };
    return { calls, impl: impl as unknown as typeof fetch };
}

describe('the item: title, name, titled', () => {
    it('an untitled attachment shows its name and is not titled', () => {
        const [item] = personMaterials({ refn: 'P0001', attachments: [att('a1')] });
        expect(item.title).toBe('a1.jpg');
        expect(item.name).toBe('a1.jpg');
        expect(item.titled).toBe(false);
    });

    it("the tree's title wins over the research's, the file's name stays beside it", () => {
        const a = att('a1', { title: 'Wedding 1924', kind: 'photo', date: '1924', original: { sha256: sha(1), name: 'x.jpg', mimeType: 'image/jpeg', bytes: 5 } });
        const items = personMaterials({ refn: 'P0001', attachments: [a] }, list([file(1, { title: 'Research title' }), file(2, { title: 'Only research' })]));
        const both = items.find(i => i.attachment)!;
        expect(both.title).toBe('Wedding 1924');
        expect(both.name).toBe('scan-1.jpg');
        expect(both.titled).toBe(true);
        expect(both.kind).toBe('photo');
        const archive = items.find(i => !i.attachment)!;
        expect(archive.title).toBe('Only research');
        expect(archive.titled).toBe(true);
    });

    it('search reads the title, the file name and the note', () => {
        const [item] = personMaterials({ refn: 'P0001', attachments: [att('scan-0042', { title: 'Wedding outside the church', note: 'aunt Ermelinda' })] });
        expect(materialMatches(item, 'church')).toBe(true);
        expect(materialMatches(item, '0042')).toBe(true);
        expect(materialMatches(item, 'ermelinda')).toBe(true);
        expect(materialMatches(item, 'funeral')).toBe(false);
    });
});

describe('the date field', () => {
    afterEach(() => setLanguage('en'));

    it('writes GEDCOM text, reads it back in the field, refuses what it cannot read', () => {
        setLanguage('cs');
        expect(materialDateFromInput('asi 1910')).toBe('ABT 1910');
        expect(materialDateFromInput('12.5.1924')).toBe('12 MAY 1924');
        expect(materialDateFromInput('1919-1921')).toBe('BET 1919 AND 1921');
        expect(materialDateFromInput('')).toBe('');
        expect(materialDateFromInput('nonsense')).toBeNull();
        expect(materialDateForInput('ABT 1910')).toBe('~1910');
        expect(materialDateForInput('12 MAY 1924')).toBe('12.5.1924');
        expect(materialDateForInput('1924')).toBe('1924');
        expect(materialDateForInput(undefined)).toBe('');
    });
});

describe('DataManager.setMediaDetails', () => {
    beforeEach(() => {
        vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
        vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
        const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
        dm.data = { persons: {}, partnerships: {} };
        dm.currentTreeId = TREE;
        dm.viewMode = false;
        dm.pendingBefore = null;
        UndoManager.setActiveTree(null);
        UndoManager.setActiveTree(TREE);
    });

    it('changes title, kind, date and note in one undo step; empty clears', () => {
        const p = DataManager.createPerson({ firstName: 'Ada', lastName: 'Test', gender: 'female' as Gender });
        const a = DataManager.addAttachment(p.id, { name: 'scan.jpg', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AAAA', sizeBytes: 3 })!;
        expect(DataManager.canEditMedia(a.id)).toBe(true);
        expect(DataManager.setMediaDetails(a.id, { title: '  Wedding  ', kind: 'photo', date: 'MAY 1924', note: 'church' })).toBe(true);
        let m = DataManager.getMedia(a.id)!;
        expect([m.title, m.kind, m.date, m.note]).toEqual(['Wedding', 'photo', 'MAY 1924', 'church']);
        expect(DataManager.setMediaDetails(a.id, { title: '', kind: null })).toBe(true);
        m = DataManager.getMedia(a.id)!;
        expect([m.title, m.kind, m.date]).toEqual([undefined, undefined, 'MAY 1924']);
        DataManager.undo();
        m = DataManager.getMedia(a.id)!;
        expect([m.title, m.kind]).toEqual(['Wedding', 'photo']);
        DataManager.undo();
        m = DataManager.getMedia(a.id)!;
        expect([m.title, m.kind, m.date, m.note]).toEqual([undefined, undefined, undefined, undefined]);
    });

    it('many files at once are one undo step; unchanged files are left out (spec 102 §8d)', () => {
        const p = DataManager.createPerson({ firstName: 'Ada', lastName: 'Test', gender: 'female' as Gender });
        const one = (n: string) => DataManager.addAttachment(p.id, { name: n, mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AAAA', sizeBytes: 3 })!;
        const a = one('a.jpg'), b = one('b.jpg'), c = one('c.jpg');
        DataManager.setMediaDetails(c.id, { kind: 'record' });
        const changed = DataManager.setMediaDetailsMany([
            { id: a.id, details: { title: 'Box 1', kind: 'record' } },
            { id: b.id, details: { title: 'Box 2', kind: 'record' } },
            { id: c.id, details: { kind: 'record' } },
            { id: 'missing', details: { title: 'x' } },
        ]);
        expect(changed).toEqual([a.id, b.id]);
        expect([DataManager.getMedia(a.id)!.title, DataManager.getMedia(b.id)!.kind]).toEqual(['Box 1', 'record']);
        DataManager.undo();
        expect([DataManager.getMedia(a.id)!.title, DataManager.getMedia(b.id)!.title, DataManager.getMedia(c.id)!.kind]).toEqual([undefined, undefined, 'record']);
        expect(DataManager.setMediaDetailsMany([{ id: c.id, details: { kind: 'record' } }])).toEqual([]);
    });

    it('a read-only view changes nothing', () => {
        const p = DataManager.createPerson({ firstName: 'Ada', lastName: 'Test', gender: 'female' as Gender });
        const a = DataManager.addAttachment(p.id, { name: 'scan.jpg', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AAAA', sizeBytes: 3 })!;
        (DataManager as unknown as { viewMode: boolean }).viewMode = true;
        expect(DataManager.canEditMedia(a.id)).toBe(false);
        expect(DataManager.setMediaDetails(a.id, { title: 'x' })).toBe(false);
        (DataManager as unknown as { viewMode: boolean }).viewMode = false;
    });
});

describe('POST /material/edit', () => {
    it('sends the fields given and reads files, was and head', async () => {
        const f = fakeFetch([[200, {
            files: [{ id: 'I0001', name: 'a.jpg', sha: sha(1), persons: [], title: 'Wedding' }],
            changed: 1, was: { I0001: { title: '', kind: 'photo', date: '1924' }, bogus: { title: 'x' } },
            people: {}, head: 'a'.repeat(40),
        }]]);
        const res = await editMaterial(BASE, { ids: ['I0001'], title: 'Wedding', kind: '' }, { fetchImpl: f.impl });
        expect(f.calls[0].url).toContain('/material/edit');
        expect(f.calls[0].init?.method).toBe('POST');
        expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ ids: ['I0001'], title: 'Wedding', kind: '' });
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.value.files[0].title).toBe('Wedding');
        expect(res.value.was).toEqual({ I0001: { title: '', kind: 'photo', date: '1924' } });
    });

    it('checks the request before sending and maps refusals', async () => {
        const f = fakeFetch([]);
        expect((await editMaterial(BASE, { ids: [] , title: 'x' }, { fetchImpl: f.impl })).ok).toBe(false);
        expect((await editMaterial(BASE, { ids: ['I0001'] }, { fetchImpl: f.impl })).ok).toBe(false);
        expect((await editMaterial(BASE, { ids: ['bogus'], title: 'x' }, { fetchImpl: f.impl })).ok).toBe(false);
        expect(f.calls).toHaveLength(0);
        const g = fakeFetch([[400, { code: 'material.date', text: 'x' }]]);
        const res = await editMaterial(BASE, { ids: ['I0001'], date: 'x' }, { fetchImpl: g.impl });
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error.code).toBe('material.date');
    });
});
