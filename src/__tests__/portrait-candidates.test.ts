/**
 * "Portrait from a photo" (spec 107): which of a person's photos the picker
 * offers and in what order, who else is in each photo, and where the crop
 * editor starts. Invented data (the Novák family).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { Attachment, PersonId, StromData, TreeId } from '../types.js';
import { MaterialFile, MaterialItem } from '../materials.js';
import { PortraitCandidatesInput, portraitCandidates, photoPeopleOthers, portraitInitialFor, portraitCropOf } from '../portrait-candidates.js';

const TREE = 'portrait-candidates-tree' as TreeId;
const sha = (n: number) => n.toString(16).padStart(64, '0');

function att(id: string, init: Partial<Attachment> = {}): Attachment {
    return { id, name: `${id}.jpg`, mimeType: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${id}`, sizeBytes: 10, places: [], ...init };
}

function treeItem(a: Attachment, init: Partial<MaterialItem> = {}): MaterialItem {
    return { key: `a:${a.id}`, origin: 'tree', attachment: a, title: a.title ?? a.name, name: a.name, titled: false, persons: [], viaBatch: [], here: true, mime: a.mimeType, ...init };
}

function researchItem(n: number, title: string, init: Partial<MaterialItem> = {}, file: Partial<MaterialFile> = {}): MaterialItem {
    const f: MaterialFile = { id: `I${String(n).padStart(4, '0')}`, name: `scan-${n}.jpg`, sha: sha(n), mime: 'image/jpeg', persons: ['P0001'], ...file };
    return { key: `m:${f.id}`, origin: 'archive', file: f, title, name: f.name, titled: true, persons: f.persons, viaBatch: [], here: true, mime: 'image/jpeg', ...init };
}

function input(items: MaterialItem[], init: Partial<PortraitCandidatesInput> = {}): PortraitCandidatesInput {
    return {
        items,
        offer: item => ({ bridge: !item.attachment }),
        bridgeUp: true,
        sourceId: null,
        treeCopy: item => item.attachment,
        others: () => [],
        waits: () => 'none',
        ...init,
    };
}

function reset(): void {
    vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
    const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
    dm.data = { persons: {}, partnerships: {} };
    dm.currentTreeId = TREE;
    dm.viewMode = false;
    dm.pendingBefore = null;
    UndoManager.setActiveTree(null);
    UndoManager.setActiveTree(TREE);
}

beforeEach(reset);

describe('portraitCandidates', () => {
    it('newest first, undated last in the materials order', () => {
        const items = [
            treeItem(att('svatba'), { title: 'Svatba 1924', at: '2026-01-10T10:00:00Z' }),
            treeItem(att('dum'), { title: 'Rodina před domem, 1935' }),
            treeItem(att('jan50'), { title: 'Jan Novák, 1950', at: '2026-03-01T10:00:00Z' }),
            treeItem(att('vojna'), { title: 'Jan na vojně, 1918' }),
            researchItem(1, 'Výlet na Pálavu, 1956', { at: '2026-02-01T10:00:00Z' }),
        ];
        const { shown, researchOnly } = portraitCandidates(input(items));
        expect(shown.map(c => c.title)).toEqual(['Jan Novák, 1950', 'Výlet na Pálavu, 1956', 'Svatba 1924', 'Rodina před domem, 1935', 'Jan na vojně, 1918']);
        expect(researchOnly).toBe(0);
    });

    it("an attachment's own date counts when the item has none", () => {
        const items = [
            treeItem(att('a', { addedAt: '2026-01-01T00:00:00Z' }), { title: 'Svatba 1924' }),
            treeItem(att('b', { addedAt: '2026-05-01T00:00:00Z' }), { title: 'Křtiny Marie, 1926' }),
        ];
        expect(portraitCandidates(input(items)).shown.map(c => c.title)).toEqual(['Křtiny Marie, 1926', 'Svatba 1924']);
    });

    it('leaves out what is not offered and a tree file that did not come', () => {
        const items = [treeItem(att('a'), { title: 'Svatba 1924' }), treeItem(att('b'), { title: 'Rodina před domem, 1935' }), treeItem(att('c'))];
        const { shown } = portraitCandidates(input(items, {
            offer: item => (item.key === 'a:c' ? null : { bridge: false }),
            waits: item => (item.key === 'a:b' ? 'failed' : 'none'),
        }));
        expect(shown.map(c => c.key)).toEqual(['a:a']);
    });

    it('bridge down: the research pictures are counted, not shown', () => {
        const items = [treeItem(att('a')), researchItem(1, 'Výlet na Pálavu, 1956'), researchItem(2, 'Křtiny Marie, 1926'), treeItem(att('b'))];
        const down = portraitCandidates(input(items, { bridgeUp: false }));
        expect(down.shown.map(c => c.key)).toEqual(['a:a', 'a:b']);
        expect(down.researchOnly).toBe(2);
        const up = portraitCandidates(input(items));
        expect(up.shown).toHaveLength(4);
        expect(up.researchOnly).toBe(0);
    });

    it('the picture: the tree file at once, a research picture by its hash, a file on its way without', () => {
        const own = att('own');
        const copy = att('copy', { dataUrl: 'data:image/jpeg;base64,COPY' });
        const items = [treeItem(own), researchItem(1, 'Výlet na Pálavu, 1956'), researchItem(2, 'Svatba 1924'), treeItem(att('wait'))];
        const { shown } = portraitCandidates(input(items, {
            offer: item => ({ bridge: item.key === 'm:I0001' }),
            treeCopy: item => (item.key === 'm:I0002' ? copy : item.attachment),
            waits: item => (item.key === 'a:wait' ? 'loading' : 'none'),
        }));
        const by = (k: string) => shown.find(c => c.key === k)!;
        expect(by('a:own')).toMatchObject({ image: own.dataUrl, bridge: false });
        expect(by('a:own').sha).toBeUndefined();
        expect(by('m:I0001')).toMatchObject({ image: null, sha: sha(1), bridge: true });
        expect(by('m:I0002')).toMatchObject({ image: 'data:image/jpeg;base64,COPY', bridge: false });
        expect(by('a:wait')).toMatchObject({ image: null, waits: 'loading' });
    });

    it('marks the photo the portrait is cut from (own or its copy)', () => {
        const copy = att('jan50');
        const items = [treeItem(att('svatba')), researchItem(1, 'Jan Novák, 1950')];
        const { shown } = portraitCandidates(input(items, { sourceId: 'jan50', treeCopy: item => item.attachment ?? copy, offer: () => ({ bridge: false }) }));
        expect(shown.map(c => [c.key, c.isSource])).toEqual([['a:svatba', false], ['m:I0001', true]]);
    });
});

describe('photoPeopleOthers', () => {
    function named(firstName: string, lastName: string, refn?: string): PersonId {
        const p = DataManager.createPerson({ firstName, lastName, gender: 'male' });
        if (refn) DataManager.updatePerson(p.id, { refn });
        return p.id;
    }

    it("a research's file: its people and the sorting's, without the person, names from the list without years", () => {
        const jan = named('Jan', 'Novák', 'P0001');
        named('Josef', 'Novák', 'P0003');
        const item = researchItem(1, 'Svatba 1924', {}, { persons: ['P0001', 'P0002', 'P0003'], sorted: { persons: ['P0002', 'P0009'] } });
        const others = photoPeopleOthers(item, DataManager.getPerson(jan)!, { P0002: 'Marie Nováková (1902–1980)' });
        expect(others).toEqual(['Marie Nováková', 'Josef Novák', '']);
    });

    it('people only through the batch are not in the photo', () => {
        const jan = named('Jan', 'Novák', 'P0001');
        const item = researchItem(1, 'Rodina před domem, 1935', { viaBatch: ['P0004'] }, { persons: ['P0001'], batch: 'b1' });
        expect(photoPeopleOthers(item, DataManager.getPerson(jan)!, { P0004: 'Anežka Dvořáková' })).toEqual([]);
    });

    it("a tree's file: the people it is at, each once", () => {
        const jan = named('Jan', 'Novák');
        const marie = named('Marie', 'Nováková', 'P0002');
        const karel = named('Karel', 'Novák');
        const a = att('svatba', { places: [{ personId: jan }, { personId: marie }, { personId: karel }, { personId: marie }] });
        expect(photoPeopleOthers(treeItem(a), DataManager.getPerson(jan)!)).toEqual(['Marie Nováková', 'Karel Novák']);
    });

    it("both: one person named by the file and at the tree's file counts once", () => {
        const jan = named('Jan', 'Novák', 'P0001');
        const marie = named('Marie', 'Nováková', 'P0002');
        const a = att('svatba', { places: [{ personId: jan }, { personId: marie }] });
        const item = { ...researchItem(1, 'Svatba 1924', {}, { persons: ['P0001', 'P0002'] }), attachment: a, origin: 'both' as const };
        expect(photoPeopleOthers(item, DataManager.getPerson(jan)!)).toEqual(['Marie Nováková']);
    });
});

describe('portraitInitialFor', () => {
    const source = { attachmentId: 'jan50', region: { x: 0.1, y: 0.2, w: 0.3, h: 0.3 }, quarterTurns: 1 as const };

    it("the person's crop over the photo the portrait is cut from", () => {
        const person = { photo: 'data:image/jpeg;base64,P', photoSource: source };
        expect(portraitInitialFor(treeItem(att('jan50')), person)).toEqual({ region: source.region, quarterTurns: 1 });
        // A research's picture whose tree copy is that file.
        expect(portraitInitialFor(researchItem(1, 'Jan Novák, 1950'), person, 'jan50')).toEqual(portraitCropOf(source));
    });

    it('another photo, or no portrait: the editor starts by itself', () => {
        expect(portraitInitialFor(treeItem(att('svatba')), { photo: 'data:x', photoSource: source })).toBeUndefined();
        expect(portraitInitialFor(treeItem(att('jan50')), { photo: undefined, photoSource: source })).toBeUndefined();
        expect(portraitInitialFor(researchItem(1, 'Jan Novák, 1950'), { photo: 'data:x', photoSource: source })).toBeUndefined();
    });
});
