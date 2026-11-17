/**
 * The materials overview (spec 017 U5, E3): items of the research and the
 * tree in one list, the filters, the groups (batches with their folders,
 * days received), the virtual list's rows, Shift ranges, short person
 * labels, the remembered view, and the shared preview queue. Invented data.
 */

import { describe, it, expect } from 'vitest';
import { Attachment } from '../types.js';
import { MaterialFile, MaterialList, MaterialResult, ThumbSize, researchMakesThumb } from '../materials.js';
import {
    overviewItems, overviewGroups, overviewRows, overviewSummary, emptyFilters, passesFilters, activeFilterCount,
    rowsInView, stickyGroupAt, gridColumns, rangeKeys, nameWithoutYears, personsShort, parseViewPrefs, localDay,
    parseFilters, storedFilters, sortOverviewGroups, itemInTree,
    fromKey, OverviewFilters, RowMetrics, firstFolderLine, inMaterialFolder, TreeRecord, itemWithoutPerson,
} from '../materials-overview.js';
import { MaterialThumbQueue, ThumbDeps, thumbSource } from '../material-thumbs.js';

const sha = (n: number) => n.toString(16).padStart(64, '0');

function file(n: number, init: Partial<MaterialFile> = {}): MaterialFile {
    return {
        id: `I${String(n).padStart(4, '0')}`, name: `scan-${n}.jpg`, sha: sha(n), mime: 'image/jpeg', persons: [],
        at: '2026-10-10T10:00:00.000Z', ...init,
    };
}

function att(id: string, init: Partial<Attachment> = {}): Attachment {
    return { id, name: `${id}.jpg`, mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AA==', sizeBytes: 10, places: [], ...init };
}

function list(files: MaterialFile[], extra: Partial<MaterialList> = {}): MaterialList {
    return { files, batches: [], people: {}, fetchedAt: 1, ...extra };
}

const filters = (f: Partial<OverviewFilters> = {}): OverviewFilters => ({ ...emptyFilters(), ...f });

/** A file of the tree with its people's keys and how many places it is used in. */
const rec = (a: Attachment, persons: string[] = [], uses = persons.length): TreeRecord => ({ att: a, persons, uses });

const BOX = { id: 'b-box', name: 'Box from the attic', at: '2026-10-10T09:00:00.000Z', files: 4 };
const OLD = { id: 'b-old', name: 'Old letters', at: '2026-09-01T09:00:00.000Z', files: 2, persons: ['P0002'] };

function sample(): MaterialList {
    return list([
        file(1, { batch: 'b-box', path: 'Photos/1930/a.jpg', persons: ['P0001'], kind: 'photo' }),
        file(2, { batch: 'b-box', path: 'Photos/1930/b.jpg', title: 'Wedding in Žďár' }),
        file(3, { batch: 'b-box', path: 'Letters/c.pdf', mime: 'application/pdf', kind: 'document' }),
        file(4, { batch: 'b-box', path: 'root.jpg', hidden: { reason: 'duplicate' } }),
        file(5, { batch: 'b-old', path: 'x.jpg' }),
        file(6, { batch: 'b-old', path: 'y.jpg' }),
        file(7, { from: 'the terminal', at: '2026-10-12T10:00:00.000Z', notes: [{ by: 'user', text: 'Grandmother’s note' }] }),
        file(8, { from: 'the Strom app', at: '2026-10-11T10:00:00.000Z', persons: ['P0003'] }),
    ], { batches: [OLD, BOX] });
}

describe('overview items', () => {
    it('joins a file of the tree with its original and keeps files without one as tree items', () => {
        const items = overviewItems(sample(), [
            rec(att('a1', { original: { sha256: sha(1).toUpperCase(), name: 'a.jpg', mimeType: 'image/jpeg', bytes: 1 } }), ['P0001'], 3),
            rec(att('a2'), ['P0001']),
            rec(att('a3')),
        ]);
        expect(items.find(i => i.key === 'm:I0001')?.origin).toBe('both');
        expect(items.find(i => i.key === 'm:I0001')?.uses).toBe(3);
        expect(items.filter(i => i.origin === 'tree').map(i => i.key)).toEqual(['a:a2', 'a:a3']);
        expect(items.find(i => i.key === 'a:a2')?.persons).toEqual(['P0001']);
        expect(items).toHaveLength(10);
    });

    it('material.links: the tree\'s file joins the research\'s own record of it (by its id), not a batch\'s copy; an older research by the hash (spec 102 §1)', () => {
        const original = { sha256: sha(9), name: 'a.jpg', mimeType: 'image/jpeg', bytes: 1 };
        const records = list([
            file(1, { batch: 'b-box', sha: sha(9) }),
            file(2, { sha: sha(9), origin: 'app', links: [{ type: 'person', ref: 'P0001' }] }),
        ], { batches: [BOX] });
        const items = overviewItems(records, [rec(att('a1', { original }), ['P0001'], 2)]);
        expect(items.map(i => [i.key, i.origin])).toEqual([['m:I0001', 'archive'], ['m:I0002', 'both']]);
        expect(items.find(i => i.key === 'm:I0002')?.uses).toBe(2);
        // An older research (no origin, no links): one item, joined by the hash.
        const older = overviewItems(list([file(3, { sha: sha(9) })]), [rec(att('a1', { original }), ['P0001'], 2)]);
        expect(older.map(i => [i.key, i.origin])).toEqual([['m:I0003', 'both']]);
    });

    it('one item per file: a file of two people is listed once with both (spec 102 §1)', () => {
        const items = overviewItems(null, [rec(att('a1', { addedAt: '2026-11-02T10:00:00.000Z' }), ['p_anna', 'p_karel'], 4)]);
        expect(items.map(i => i.key)).toEqual(['a:a1']);
        expect(items[0].persons).toEqual(['p_anna', 'p_karel']);
        expect(items[0].uses).toBe(4);
        expect(items[0].at).toBe('2026-11-02T10:00:00.000Z');
    });

    it('works without a remembered list (only the tree)', () => {
        const items = overviewItems(null, [rec(att('a1'), ['P0001'])]);
        expect(items.map(i => i.origin)).toEqual(['tree']);
    });
});

describe('filters', () => {
    const items = overviewItems(sample(), []);
    const keys = (f: Partial<OverviewFilters>) => items.filter(i => passesFilters(i, filters(f))).map(i => i.key);

    it('leaves hidden files out unless asked', () => {
        expect(keys({})).not.toContain('m:I0004');
        expect(keys({ showHidden: true })).toContain('m:I0004');
    });

    it('by person, also through the batch', () => {
        expect(keys({ person: 'P0002' })).toEqual(['m:I0005', 'm:I0006']);
        expect(keys({ person: 'P0001' })).toEqual(['m:I0001']);
    });

    it('by kind, with "no kind"', () => {
        expect(keys({ kinds: ['photo', 'document'] })).toEqual(['m:I0001', 'm:I0003']);
        expect(keys({ kinds: ['none'] })).toEqual(['m:I0002', 'm:I0005', 'm:I0006', 'm:I0007', 'm:I0008']);
    });

    it('without a person: nobody directly nor through the batch', () => {
        expect(keys({ noPerson: true })).toEqual(['m:I0002', 'm:I0003', 'm:I0007']);
    });

    it('searches name, title, path and notes without diacritics', () => {
        expect(keys({ query: 'zdar' })).toEqual(['m:I0002']);
        expect(keys({ query: 'GRANDMOTHER note' })).toEqual(['m:I0007']);
        expect(keys({ query: 'letters' })).toEqual(['m:I0003']);
    });

    it('searches a titled file by its title, its file name and its note (spec 102 §2)', () => {
        const titled = overviewItems(list([file(9, { name: 'IMG_0042.jpg' })]), [
            rec(att('a1', { title: 'Wedding outside the church', note: 'From aunt Ermelinda', original: { sha256: sha(9), name: 'IMG_0042.jpg', mimeType: 'image/jpeg', bytes: 1 } }), ['P0001']),
            rec(att('a2', { name: 'letter-1931.jpg', title: 'Letter from Bohdalec' }), ['P0001']),
        ]);
        const found = (query: string) => titled.filter(i => passesFilters(i, filters({ query }))).map(i => i.key);
        expect(found('church')).toEqual(['m:I0009']);
        expect(found('img_0042')).toEqual(['m:I0009']);
        expect(found('ermelinda')).toEqual(['m:I0009']);
        expect(found('bohdalec')).toEqual(['a:a2']);
        expect(found('letter-1931')).toEqual(['a:a2']);
        expect(found('funeral')).toEqual([]);
    });

    it('counts the active filters (not the search)', () => {
        expect(activeFilterCount(filters({ person: 'P1', kinds: ['photo', 'none'], query: 'x' }))).toBe(2);
        expect(activeFilterCount(filters({ batch: 'b', noPerson: true, showHidden: true }))).toBe(3);
    });
});

describe('summary', () => {
    it('counts files, batches, files without a person and hidden ones', () => {
        const l = sample();
        expect(overviewSummary(overviewItems(l, [rec(att('t'), ['P1'])]), l, true))
            .toMatchObject({ files: 7, batches: 2, noPerson: 3, hidden: 1 });
    });

    it('takes the batches’ own counts while their files are not known', () => {
        const l = list([file(7)], { batches: [{ ...BOX, files: 120 }] });
        expect(overviewSummary(overviewItems(l, []), l, false).files).toBe(121);
    });
});

describe('groups by batch', () => {
    const l = sample();
    const items = overviewItems(l, [rec(att('t1'), ['P1'])]);
    const groups = (f: Partial<OverviewFilters> = {}, loaded = true) =>
        overviewGroups({ items, list: l, filters: filters(f), mode: 'batch', batchLoaded: () => loaded });

    it('batches newest first, then single files with the tree’s own files (no group of the tree, spec 102 §1)', () => {
        expect(groups().map(g => g.key)).toEqual(['b:b-box', 'b:b-old', 'loose']);
        expect(groups().find(g => g.key === 'loose')?.items.map(i => i.key)).toEqual(['m:I0007', 'm:I0008', 'a:t1']);
    });

    it('a batch: files outside folders first, then the folder tree from the paths', () => {
        const box = groups({ showHidden: true })[0];
        expect(box.root.map(i => i.key)).toEqual(['m:I0004']);
        // Each folder after its parent, its own name indented one level in; counts with the subfolders.
        expect(box.folders.map(f => [f.label, f.name, f.depth, f.items.length, f.files.length])).toEqual([
            ['Letters', 'Letters', 0, 1, 1], ['Photos', 'Photos', 0, 2, 0], ['Photos / 1930', '1930', 1, 2, 2],
        ]);
        expect(box.folders[2].parent).toBe('f:b-box/Photos');
        expect(firstFolderLine(box)).toEqual(['f:b-box/Letters']);
        expect(box.items.map(i => i.key)).toEqual(['m:I0004', 'm:I0003', 'm:I0001', 'm:I0002']);
        expect(groups()[0].total).toBe(3);
    });

    it('a folder holds its subfolders\' files; the first folder line opens down to files', () => {
        expect(inMaterialFolder('Photos/1930/a.jpg', 'Photos')).toBe(true);
        expect(inMaterialFolder('Photos/1930/a.jpg', 'Photos / 1930')).toBe(true);
        expect(inMaterialFolder('Photos 2/a.jpg', 'Photos')).toBe(false);
        expect(inMaterialFolder('a.jpg', 'Photos')).toBe(false);
        const deep = list([file(1, { batch: 'b-box', path: 'Box/Attic/1930/a.jpg' }), file(2, { batch: 'b-box', path: 'Box/Attic/1950/b.jpg' })], { batches: [BOX] });
        const g = overviewGroups({ items: overviewItems(deep, []), list: deep, filters: filters(), mode: 'batch', batchLoaded: () => true })[0];
        expect(g.folders.map(f => `${'-'.repeat(f.depth)}${f.name} ${f.items.length}`)).toEqual(['Box 2', '-Attic 2', '--1930 1', '--1950 1']);
        expect(firstFolderLine(g)).toEqual(['f:b-box/Box', 'f:b-box/Box / Attic', 'f:b-box/Box / Attic / 1930']);
        expect(g.items.map(i => i.key)).toEqual(['m:I0001', 'm:I0002']);
    });

    it('with a filter: groups without a match go, counts say k of n', () => {
        const g = groups({ noPerson: true });
        expect(g.map(x => x.key)).toEqual(['b:b-box', 'loose']);
        expect([g[0].items.length, g[0].total]).toEqual([2, 3]);
        expect(groups({ query: 'nothing-like-this' })).toEqual([]);
    });

    it('a batch filter shows only that batch', () => {
        expect(groups({ batch: 'b-old' }).map(g => g.key)).toEqual(['b:b-old']);
    });

    it('unknown batches are pending with the research’s count', () => {
        const only = list([], { batches: [BOX] });
        const g = overviewGroups({ items: [], list: only, filters: filters(), mode: 'batch', batchLoaded: () => false });
        expect(g).toHaveLength(1);
        expect(g[0]).toMatchObject({ pending: true, total: 4 });
        // A search cannot look into them.
        expect(overviewGroups({ items: [], list: only, filters: filters({ query: 'x' }), mode: 'batch', batchLoaded: () => false })).toEqual([]);
    });

    it('single files say where they came from', () => {
        expect(groups().find(g => g.key === 'loose')?.froms).toEqual(['cli', 'app']);
        expect([fromKey('batch from the Strom app'), fromKey('from a phone'), fromKey(undefined)]).toEqual(['batch', 'phone', null]);
    });
});

describe('groups by date', () => {
    const l = sample();
    const items = overviewItems(l, [rec(att('t1'), ['P1'])]);
    const now = Date.parse('2026-10-23T12:00:00.000Z');

    it('a group per local day, newest first; older than 60 days together, the tree’s files without a time with them', () => {
        const old = list([...l.files, file(9, { at: '2026-07-01T10:00:00.000Z' })], { batches: l.batches });
        const g = overviewGroups({ items: overviewItems(old, [rec(att('t1'), ['P1'])]), list: old, filters: filters(), mode: 'date', batchLoaded: () => true, now });
        expect(g.map(x => x.key)).toEqual([`d:${localDay(l.files[6].at)}`, `d:${localDay(l.files[7].at)}`, `d:${localDay(l.files[0].at)}`, 'earlier']);
        expect(g[3].items.map(i => i.key)).toEqual(['m:I0009', 'a:t1']);
        const box = g[2];
        expect(box.batchNames).toEqual(['Box from the attic', 'Old letters']);
        expect(box.looseCount).toBe(0);
        expect(g[0].looseCount).toBe(1);
    });

    it('filters apply per day', () => {
        const g = overviewGroups({ items, list: l, filters: filters({ person: 'P0003' }), mode: 'date', batchLoaded: () => true, now });
        expect(g.map(x => x.items.map(i => i.key))).toEqual([['m:I0008']]);
    });
});

describe('groups of a tree without an archive (spec 102 §1)', () => {
    const now = Date.parse('2026-11-17T12:00:00.000Z');
    const items = overviewItems(null, [
        rec(att('a1', { addedAt: '2026-11-16T09:00:00.000Z' }), ['p_ilsa', 'p_oskar']),
        rec(att('a2', { addedAt: '2026-11-02T09:00:00.000Z' }), ['p_anton']),
        rec(att('a3', { addedAt: '2026-11-16T10:00:00.000Z' }), ['p_ilsa']),
        rec(att('a4'), []),
        rec(att('a5'), ['p_oskar']),
    ]);
    const names: Record<string, string> = { p_ilsa: 'Ilsa Talvanen', p_oskar: 'Oskar Quellmayer', p_anton: 'Anton Ostrovid' };

    it('by the day added, newest first, with the day’s people; files without a time under Earlier', () => {
        const g = overviewGroups({ items, list: null, filters: filters(), mode: 'added', batchLoaded: () => true, now });
        expect(g.map(x => x.key)).toEqual([`d:${localDay('2026-11-16T09:00:00.000Z')}`, `d:${localDay('2026-11-02T09:00:00.000Z')}`, 'earlier']);
        expect(g[0].items.map(i => i.key)).toEqual(['a:a3', 'a:a1']);
        expect(g[0].persons).toEqual(['p_ilsa', 'p_oskar']);
        expect(g[2].items.map(i => i.key)).toEqual(['a:a4', 'a:a5']);
    });

    it('by person: a group per person by name, a file under each of its people, files without a person last', () => {
        const g = overviewGroups({ items, list: null, filters: filters(), mode: 'person', batchLoaded: () => true, now, personName: k => names[k] ?? null });
        expect(g.map(x => x.key)).toEqual(['p:p_anton', 'p:p_ilsa', 'p:p_oskar', 'noperson']);
        expect(g[1].items.map(i => i.key)).toEqual(['a:a3', 'a:a1']);
        expect(g[2].items.map(i => i.key)).toEqual(['a:a1', 'a:a5']);
        expect(g[2].persons).toEqual(['p_oskar']);
        expect(g[3].items.map(i => i.key)).toEqual(['a:a4']);
    });

    it('the tree\u2019s files count in the summary; a file only at a source or a union is without a person', () => {
        const tree = overviewItems(null, [
            rec(att('b1', { places: [{ personId: 'p1' as never }] }), ['p1']),
            rec(att('b2', { places: [{ sourceId: 's1' }] }), []),
            rec(att('b3', { places: [{ partnershipId: 'u1' as never }] }), []),
            // At a person the research does not know yet (no REFN): not "without a person".
            rec(att('b4', { places: [{ personId: 'p2' as never }] }), []),
        ]);
        expect(tree.filter(itemWithoutPerson).map(i => i.key)).toEqual(['a:b2', 'a:b3']);
        expect(overviewSummary(tree, null, true, true)).toMatchObject({ files: 4, batches: 0, noPerson: 2, hidden: 0 });
        // With an archive the tree's own files stay out of the archive's counts.
        expect(overviewSummary(tree, null, true).files).toBe(0);
    });

    it('the person filter and the search apply by person too', () => {
        const g = overviewGroups({ items, list: null, filters: filters({ person: 'p_ilsa' }), mode: 'person', batchLoaded: () => true, now, personName: k => names[k] ?? null });
        expect(g.map(x => x.key)).toEqual(['p:p_ilsa', 'p:p_oskar']);
        expect(g[1].items.map(i => i.key)).toEqual(['a:a1']);
    });
});

const METRICS: RowMetrics = { view: 'grid', cols: 2, tileRow: 100, restoreExtra: 20, listRow: 48, group: 60, folder: 30, skeleton: 80, groupEnd: 10 };

describe('rows of the virtual list', () => {
    const l = sample();
    const items = overviewItems(l, []);
    const groups = overviewGroups({ items, list: l, filters: filters({ showHidden: true }), mode: 'batch', batchLoaded: () => true });

    it('closed groups are only headers', () => {
        const layout = overviewRows(groups, () => false, METRICS);
        expect(layout.rows.map(r => r.type)).toEqual(['group', 'group', 'group']);
        expect(layout.height).toBe(180);
        expect(layout.order).toEqual([]);
    });

    it('an open batch: root tiles, folder headers, open folders’ tiles in rows of `cols`', () => {
        const open = new Set(['b:b-box', 'f:b-box/Photos', 'f:b-box/Photos / 1930']);
        const layout = overviewRows(groups, k => open.has(k), METRICS);
        expect(layout.rows.map(r => r.type)).toEqual(['group', 'tiles', 'folder', 'folder', 'folder', 'tiles', 'end', 'group', 'group']);
        // A closed parent hides its subfolders.
        const shut = overviewRows(groups, k => k === 'b:b-box' || k === 'f:b-box/Photos / 1930', METRICS);
        expect(shut.rows.filter(r => r.type === 'folder').map(r => r.key)).toEqual(['f:b-box/Letters', 'f:b-box/Photos']);
        // The row with the hidden file has room for "Restore".
        expect(layout.rows[1].height).toBe(120);
        expect(layout.order.map(i => i.key)).toEqual(['m:I0004', 'm:I0001', 'm:I0002']);
        expect(layout.rowOf.get('m:I0002')).toBe(5);
        expect(layout.rows[5].top).toBe(60 + 120 + 30 + 30 + 30);
    });

    it('a list: one row per item', () => {
        const layout = overviewRows(groups, k => k === 'loose', { ...METRICS, view: 'list' });
        expect(layout.rows.filter(r => r.type === 'item')).toHaveLength(2);
    });

    it('3000 files: only the rows in view are drawn', () => {
        const many = list(Array.from({ length: 3000 }, (_, i) => file(i + 1, { batch: 'b-box', path: `F${i % 3}/s-${i}.jpg` })), { batches: [BOX] });
        const g = overviewGroups({ items: overviewItems(many, []), list: many, filters: filters(), mode: 'batch', batchLoaded: () => true });
        const layout = overviewRows(g, () => true, { ...METRICS, cols: 6 });
        expect(layout.order).toHaveLength(3000);
        const view = rowsInView(layout.rows, 20_000, 20_800);
        expect(view.end - view.start).toBeLessThan(12);
        expect(layout.rows[view.start].top + layout.rows[view.start].height).toBeGreaterThan(20_000);
        expect(rowsInView(layout.rows, layout.height - 10, layout.height + 500).end).toBe(layout.rows.length);
    });

    it('the sticky header is the last group above the scroll position', () => {
        const layout = overviewRows(groups, k => k === 'b:b-box', METRICS);
        expect(stickyGroupAt(layout.rows, 0)?.row.key).toBe('b:b-box');
        const second = layout.rows.find(r => r.key === 'b:b-old')!;
        expect(stickyGroupAt(layout.rows, 50)?.next).toBe(second.top);
        expect(stickyGroupAt(layout.rows, second.top + 1)?.row.key).toBe('b:b-old');
    });

    it('columns for a width', () => {
        expect(gridColumns(1100, 124, 12)).toBe(8);
        expect(gridColumns(50, 124, 12)).toBe(1);
    });
});

describe('small helpers', () => {
    it('Shift ranges in display order, either way round', () => {
        const order = overviewItems(sample(), []).slice(0, 5);
        expect(rangeKeys(order, 'm:I0004', 'm:I0002')).toEqual(['m:I0002', 'm:I0003', 'm:I0004']);
        expect(rangeKeys(order, 'gone', 'm:I0002')).toEqual(['m:I0002']);
    });

    it('names without years, first person "+N"', () => {
        expect(nameWithoutYears('Jan Novák (1901–1975)')).toBe('Jan Novák');
        expect(nameWithoutYears('Marie Nováková (*1905)')).toBe('Marie Nováková');
        expect(nameWithoutYears('Josef Dvořák')).toBe('Josef Dvořák');
        const names: Record<string, string> = { P1: 'Jan Novák (1901–1975)' };
        expect(personsShort(['P1', 'P2', 'P3'], r => names[r] ?? null)).toBe('Jan Novák +2');
        expect(personsShort([], () => null)).toBe('');
    });

    it('the remembered view, defaults for anything else', () => {
        expect(parseViewPrefs('{"group":"date","view":"list"}')).toEqual({ group: 'date', appGroup: 'added', view: 'list', sort: null, filters: {} });
        expect(parseViewPrefs('{"group":"date","appGroup":"person"}')).toEqual({ group: 'date', appGroup: 'person', view: 'grid', sort: null, filters: {} });
        expect(parseViewPrefs('{"group":"person","appGroup":"batch"}')).toEqual({ group: 'batch', appGroup: 'added', view: 'grid', sort: null, filters: {} });
        expect(parseViewPrefs('nonsense')).toEqual({ group: 'batch', appGroup: 'added', view: 'grid', sort: null, filters: {} });
        expect(parseViewPrefs(null)).toEqual({ group: 'batch', appGroup: 'added', view: 'grid', sort: null, filters: {} });
    });
});

// ==================== THE PREVIEW QUEUE ====================

function fakeDeps(answer: (sha: string) => MaterialResult<Blob> | Promise<MaterialResult<Blob>>) {
    const asked: string[] = [];
    const cache = new Map<string, Blob>();
    const sleeps: number[] = [];
    const gates: (() => void)[] = [];
    const deps: ThumbDeps = {
        async getCached(_t, s, px) { return cache.get(`${s}@${px}`) ?? null; },
        async putCached(_t, s, px, blob) { cache.set(`${s}@${px}`, blob); },
        async fetchThumb(_b, s, px: ThumbSize) { asked.push(`${s}@${px}`); return answer(s); },
        async fetchFile(_b, s) { asked.push(`file:${s}`); return new Blob(['big']); },
        async shrink() { return new Blob(['small']); },
        sleep: (ms) => { sleeps.push(ms); return new Promise<void>(resolve => gates.push(resolve)); },
        createUrl: () => `blob:${Math.random()}`,
        revokeUrl: () => undefined,
    };
    return { deps, asked, cache, sleeps, gates };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const ENV = { treeId: 't', base: 'http://127.0.0.1:1/x', thumb: true, bridgeUp: true };
const ok = (): MaterialResult<Blob> => ({ ok: true, value: new Blob(['png']) });

describe('preview queue', () => {
    it('at most 4 at once, the newest wish first', async () => {
        const waiting: ((r: MaterialResult<Blob>) => void)[] = [];
        const { deps, asked } = fakeDeps(() => new Promise(resolve => waiting.push(resolve)));
        const q = new MaterialThumbQueue(deps);
        q.setEnv(ENV);
        for (let i = 1; i <= 6; i++) q.want({ sha: sha(i), px: 256, mime: 'image/jpeg' }, () => undefined);
        await tick();
        expect(asked).toHaveLength(4);
        expect(q.snapshot()).toMatchObject({ phase: 'running', total: 6, left: 6 });
        waiting.forEach(w => w(ok()));
        await tick(); await tick();
        expect(asked).toHaveLength(6);
        waiting.forEach(w => w(ok()));
        await tick(); await tick();
        expect(q.snapshot()).toMatchObject({ phase: 'idle', left: 0 });
    });

    it('from the cache without asking; a wish whose tile left is dropped', async () => {
        const { deps, asked, cache } = fakeDeps(ok);
        cache.set(`${sha(1)}@256`, new Blob(['x']));
        const q = new MaterialThumbQueue(deps, 1);
        q.setEnv(ENV);
        const got: (string | null)[] = [];
        q.want({ sha: sha(1), px: 256, mime: 'image/jpeg' }, url => got.push(url));
        q.pause();
        q.want({ sha: sha(2), px: 256, mime: 'image/jpeg' }, url => got.push(url), () => false);
        await tick();
        q.resume();
        await tick();
        expect(asked).toEqual([]);
        expect(got).toHaveLength(1);
        expect(q.urlOf(sha(1), 256)).toBe(got[0]);
    });

    it('415 is remembered (the icon), until the window opens again', async () => {
        const { deps, asked } = fakeDeps(() => ({ ok: false, error: { kind: 'type', status: 415 } }));
        const q = new MaterialThumbQueue(deps);
        q.setEnv(ENV);
        const got: (string | null)[] = [];
        q.want({ sha: sha(1), px: 256, mime: 'image/bmp' }, url => got.push(url));
        await tick(); await tick();
        expect(got).toEqual([null]);
        expect(q.hasFailed(sha(1), 256)).toBe(true);
        q.want({ sha: sha(1), px: 256, mime: 'image/bmp' }, url => got.push(url));
        expect(asked).toHaveLength(1);
        q.resetFailures();
        q.want({ sha: sha(1), px: 256, mime: 'image/bmp' }, url => got.push(url));
        await tick(); await tick();
        expect(asked).toHaveLength(2);
    });

    it('a busy research (503) is waited for, then asked again', async () => {
        let busy = true;
        const { deps, asked, sleeps, gates } = fakeDeps(() => (busy ? { ok: false, error: { kind: 'busy', status: 503, retry: 2 } } : ok()));
        const q = new MaterialThumbQueue(deps);
        q.setEnv(ENV);
        const got: (string | null)[] = [];
        q.want({ sha: sha(1), px: 256, mime: 'image/jpeg' }, url => got.push(url));
        await tick(); await tick();
        expect(sleeps).toEqual([2000]);
        busy = false;
        // The wait is over (the queue's own clock: no new asks before it).
        (q as unknown as { busyUntil: number }).busyUntil = 0;
        gates.forEach(g => g());
        await tick(); await tick(); await tick();
        expect(asked).toHaveLength(2);
        expect(got).toHaveLength(1);
        expect(got[0]).toMatch(/^blob:/);
    });

    it('nothing from the bridge while it is not running; paused asks nothing', async () => {
        const { deps, asked } = fakeDeps(ok);
        const q = new MaterialThumbQueue(deps);
        q.setEnv({ ...ENV, bridgeUp: false });
        const got: (string | null)[] = [];
        q.want({ sha: sha(1), px: 256, mime: 'image/jpeg' }, url => got.push(url));
        await tick();
        expect(got).toEqual([null]);
        expect(q.hasFailed(sha(1), 256)).toBe(false);
        q.setEnv(ENV);
        q.pause();
        q.want({ sha: sha(2), px: 256, mime: 'image/jpeg' }, url => got.push(url));
        await tick();
        expect(asked).toEqual([]);
        expect(q.snapshot().phase).toBe('paused');
        q.resume();
        await tick(); await tick();
        expect(asked).toHaveLength(1);
    });

    it('TIFF, GIF and WebP are never asked of the research (it answers 415): WebP made here, others the icon', () => {
        expect(thumbSource({ mime: 'image/tiff' }, ENV)).toBeNull();
        expect(thumbSource({ mime: 'image/gif' }, ENV)).toBeNull();
        expect(thumbSource({ mime: 'image/webp', bytes: 1000 }, ENV)).toBe('local');
        expect(thumbSource({ mime: 'image/webp', bytes: 9 * 1024 * 1024 }, ENV)).toBeNull();
        expect(thumbSource({ name: 'scan.TIF' }, ENV)).toBeNull();
        expect(thumbSource({ mime: 'application/octet-stream', name: 'a.gif' }, ENV)).toBeNull();
        expect(thumbSource({ mime: 'image/jpeg' }, ENV)).toBe('research');
        expect(thumbSource({ name: 'scan.png' }, ENV)).toBe('research');
        expect(researchMakesThumb('image/tiff', 'x.tif')).toBe(false);
        expect(researchMakesThumb('image/png', 'x.png')).toBe(true);
        expect(researchMakesThumb('application/pdf', 'x.pdf')).toBe(true);
        expect(researchMakesThumb('audio/mpeg', 'x.mp3')).toBe(false);
    });

    it('without the research’s previews: JPEG/PNG/WebP up to 8 MB made here, others the icon', async () => {
        const env = { ...ENV, thumb: false };
        expect(thumbSource({ mime: 'image/jpeg', bytes: 1000 }, env)).toBe('local');
        expect(thumbSource({ mime: 'image/jpeg', bytes: 9 * 1024 * 1024 }, env)).toBeNull();
        expect(thumbSource({ mime: 'image/tiff' }, env)).toBeNull();
        expect(thumbSource({ mime: 'application/pdf' }, ENV)).toBe('research');
        expect(thumbSource({ mime: 'audio/mpeg' }, ENV)).toBeNull();
        const { deps, asked, cache } = fakeDeps(ok);
        const q = new MaterialThumbQueue(deps);
        q.setEnv(env);
        q.want({ sha: sha(1), px: 256, mime: 'image/png', bytes: 100 }, () => undefined);
        await tick(); await tick(); await tick();
        expect(asked).toEqual([`file:${sha(1)}`]);
        expect(cache.has(`${sha(1)}@256`)).toBe(true);
    });
});

describe('review filters, counts and the list sort (spec 102 §8)', () => {
    // I0001 is in the tree too (same original), I0002 and I0003 only in the archive; a:t is the tree's own.
    const both = () => overviewItems(list([
        file(1, { title: 'Wedding' } as Partial<MaterialFile>),
        file(2, { date: '1931' } as Partial<MaterialFile>),
        file(3, { title: 'Letter' } as Partial<MaterialFile>),
    ]), [
        { ...rec(att('j', { original: { sha256: sha(1), name: 'scan-1.jpg', mimeType: 'image/jpeg', bytes: 1 } }), ['P1']), source: 'Parish register' },
        rec(att('t', { title: 'Grave', date: '1950' }), ['P1']),
    ]);

    it('without a title, without a source, in the tree or only in the archive', () => {
        const items = both();
        const pick = (f: Partial<OverviewFilters>) => items.filter(i => passesFilters(i, filters(f))).map(i => i.key).sort();
        expect(items.filter(itemInTree).map(i => i.key).sort()).toEqual(['a:t', 'm:I0001']);
        expect(pick({ where: 'tree' })).toEqual(['a:t', 'm:I0001']);
        expect(pick({ where: 'archive' })).toEqual(['m:I0002', 'm:I0003']);
        expect(pick({ noSource: true })).toEqual(['a:t', 'm:I0002', 'm:I0003']);
        expect(pick({ noTitle: true })).toEqual(['m:I0002']);
        expect(pick({ noTitle: true, where: 'tree' })).toEqual([]);
        expect(activeFilterCount(filters({ noTitle: true, noSource: true, where: 'archive' }))).toBe(3);
    });

    it('the counts are over every file shown, the tree\u2019s own too', () => {
        expect(overviewSummary(both(), null, true)).toMatchObject({ noTitle: 1, noSource: 3, inTree: 2, onlyArchive: 2 });
    });

    it('remembers kinds and the toggles, never the person or the search', () => {
        const f = filters({ kinds: ['photo'], noTitle: true, where: 'archive', person: 'P1', query: 'x' });
        const stored = storedFilters(f);
        expect(stored).toEqual({ kinds: ['photo'], noTitle: true, where: 'archive' });
        expect(parseFilters(JSON.parse(JSON.stringify(stored)))).toEqual({ kinds: ['photo'], noTitle: true, where: 'archive' });
        expect(parseFilters({ kinds: ['nonsense', 'document'], where: 'elsewhere', noSource: 1 })).toEqual({ kinds: ['document'] });
        expect(parseViewPrefs('{"sort":{"col":"date","dir":-1},"filters":{"noSource":true}}'))
            .toMatchObject({ sort: { col: 'date', dir: -1 }, filters: { noSource: true } });
        expect(parseViewPrefs('{"sort":{"col":"size","dir":1}}').sort).toBeNull();
    });

    it('sorts the list by a column both ways, empty values last, ties in the group\u2019s order', () => {
        const tree = overviewItems(null, [
            rec(att('a', { title: 'Grave', date: '1950' }), ['P1']),
            { ...rec(att('b', { date: '1931' }), ['P1']), source: 'Parish register' },
            rec(att('c', { title: 'Letter' }), ['P1']),
            { ...rec(att('d', { title: 'Album', date: '1931' }), ['P1']), source: 'Census' },
        ]);
        const groups = () => overviewGroups({ items: tree, list: null, filters: filters(), mode: 'added', batchLoaded: () => true, now: Date.parse('2026-11-17T12:00:00.000Z'), personName: () => null });
        expect(groups()).toHaveLength(1);
        const order = (sort: { col: 'title' | 'date' | 'source'; dir: 1 | -1 } | null) =>
            sortOverviewGroups(groups(), sort, { personName: () => null, kindLabel: () => '' }).flatMap(g => g.items.map(i => i.key));
        const flat = order(null);
        expect(order({ col: 'date', dir: 1 })).toEqual(['a:b', 'a:d', 'a:a', 'a:c']);
        expect(order({ col: 'date', dir: -1 })).toEqual(['a:a', 'a:b', 'a:d', 'a:c']);
        expect(order({ col: 'source', dir: 1 })).toEqual(['a:d', 'a:b', 'a:a', 'a:c']);
        expect(order({ col: 'source', dir: -1 })).toEqual(['a:b', 'a:d', 'a:a', 'a:c']);
        expect(order(null)).toEqual(flat);
    });
});
