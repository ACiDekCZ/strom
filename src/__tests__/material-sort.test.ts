import { describe, it, expect } from 'vitest';
import { parseSortJob, startMaterialSort, type MaterialItem, type SortLink } from '../materials.js';
import { sortCandidates, sortNeeds, sortNeedy, sortWholeOffered, sortRows, sortRowProposes, sortWrite, sortChip, parseSortRevert, type SortChip, type SortRow, type SortTreeIndex } from '../material-sort.js';
import type { PartnershipId } from '../types.js';
import type { Attachment, PersonId } from '../types.js';

/** Sort with the agent (spec 102 §13): the proposal's reading and what accepting it writes. Invented data. */

function item(id: string, init: Partial<MaterialItem> = {}): MaterialItem {
    return {
        key: `m:${id}`, origin: 'archive', title: `${id}.jpg`, name: `${id}.jpg`, titled: false, persons: [], viaBatch: [], here: true,
        file: { id, name: `${id}.jpg`, sha: id.padEnd(64, '0'), persons: [] } as unknown as MaterialItem['file'],
        ...init,
    };
}

function treeItem(id: string, att: Partial<Attachment>): MaterialItem {
    const attachment = { id: `att-${id}`, name: `${id}.jpg`, mimeType: 'image/jpeg', places: [], ...att } as unknown as Attachment;
    return item(id, { key: `a:${attachment.id}`, origin: 'both', attachment, titled: !!att.title, title: att.title ?? `${id}.jpg` });
}

const chip = (link: SortLink): SortChip => ({
    link, kind: link.type === 'source' ? 'source' : link.type === 'event' ? 'event' : 'person',
    person: link.type === 'person' || link.type === 'event' ? link.ref : null,
    place: link.ref === 'P0001' ? { personId: 'p1' as PersonId, ...(link.event === 'BIRT' ? { fact: 'birth' as const } : {}) } : null,
    label: link.ref,
});

describe('reading a sorting', () => {
    it('keeps only valid proposals and links (anything off is dropped, never shown on a guess)', () => {
        const job = parseSortJob({
            id: 'sort-20261117120000-ab12', state: 'done', files: ['I0001', 'I0002', 'bad'], at: '2026-11-17T12:00:00Z',
            proposals: [
                { id: 'I0001', title: 'Wedding 1924', kind: 'photo', sure: 'high', why: 'Veil and flowers',
                    links: [{ type: 'person', ref: 'P0001' }, { type: 'person', ref: 'F0001' }, { type: 'event', ref: 'P0001', event: 'BIRT' }, { type: 'event', ref: 'P0001' }] },
                { id: 'I0001', title: 'twice' },
                { id: 'nope', title: 'x' },
                { id: 'I0002', kind: 'spaceship', sure: 'odd' },
            ],
        });
        expect(job).not.toBeNull();
        expect(job!.files).toEqual(['I0001', 'I0002']);
        expect(job!.proposals.map(p => p.id)).toEqual(['I0001', 'I0002']);
        expect(job!.proposals[0].links).toEqual([{ type: 'person', ref: 'P0001' }, { type: 'event', ref: 'P0001', event: 'BIRT' }]);
        expect(job!.proposals[1]).toEqual({ id: 'I0002', links: [], sure: 'medium', why: '' });
        expect(parseSortJob({ id: 'x', state: 'done' })).toBeNull();
        expect(parseSortJob({ id: 'sort-1', state: 'thinking' })).toBeNull();
    });

    it('sends a sorting once, never more than 50 files, without a quiet retry', async () => {
        const calls: { url: string; body: unknown }[] = [];
        const fetchImpl = async (url: string, init?: RequestInit) => {
            calls.push({ url, body: JSON.parse(String(init?.body)) });
            return new Response(JSON.stringify({ error: 'busy', code: 'material.busy' }), { status: 409 });
        };
        const ids = Array.from({ length: 51 }, (_, i) => `I${String(i + 1).padStart(4, '0')}`);
        expect((await startMaterialSort('http://b/x', { ids, text: '' }, { fetchImpl })).ok).toBe(false);
        expect(calls).toHaveLength(0);
        const res = await startMaterialSort('http://b/x', { ids: ids.slice(0, 2), text: 'Grandma’s box'.padEnd(2100, '.') }, { fetchImpl, sleep: async () => {} });
        expect(res.ok).toBe(false);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain('/material/sort');
        expect((calls[0].body as { text: string }).text).toHaveLength(2000);
    });
});

describe('the files a sorting takes', () => {
    it('only the research\'s files, not hidden, at most 50; counts what they lack', () => {
        const tree = item('I0009', { file: undefined, origin: 'tree' });
        const hidden = item('I0008', { hidden: {} });
        const many = Array.from({ length: 55 }, (_, i) => item(`I${String(i + 100)}`));
        const { send, over } = sortCandidates([tree, hidden, ...many]);
        expect(send).toHaveLength(50);
        expect(over).toBe(5);
        expect(sortNeeds([item('I0001'), item('I0002', { titled: true, persons: ['P0001'] }), item('I0003', { viaBatch: ['P0002'] })]))
            .toEqual({ n: 3, t: 2, p: 1 });
    });

    it('a batch, a filter or the whole view sends only the files without a title or a person; a selection sends what is selected', () => {
        const done = item('I0001', { titled: true, persons: ['P0001'] });
        const viaBatch = item('I0002', { titled: true, viaBatch: ['P0002'] });
        const noTitle = item('I0003', { persons: ['P0001'] });
        const noPerson = item('I0004', { titled: true });
        const hidden = item('I0005', { hidden: {} });
        const files = [done, viaBatch, noTitle, noPerson, hidden];
        expect(sortCandidates(files).send.map(i => i.file!.id)).toEqual(['I0003', 'I0004']);
        expect(sortCandidates(files, true).send.map(i => i.file!.id)).toEqual(['I0001', 'I0002', 'I0003', 'I0004']);
        // The limit counts the files that go: finished ones neither fill it nor make it over.
        const many = [...Array.from({ length: 30 }, (_, i) => item(`I${i + 100}`, { titled: true, persons: ['P0001'] })), ...Array.from({ length: 52 }, (_, i) => item(`I${i + 200}`))];
        const batch = sortCandidates(many);
        expect(batch.send).toHaveLength(50);
        expect(batch.over).toBe(2);
        expect(batch.send[0].file!.id).toBe('I200');
        expect(sortCandidates(many, true).over).toBe(32);
    });

    it('over everything: only the files without a title or a person (a person through the batch counts), never hidden or the tree\'s own', () => {
        const done = item('I0001', { titled: true, persons: ['P0001'] });
        const viaBatch = item('I0002', { titled: true, viaBatch: ['P0002'] });
        const noTitle = item('I0003', { persons: ['P0001'] });
        const noPerson = item('I0004', { titled: true });
        const hidden = item('I0005', { hidden: {} });
        const tree = item('I0006', { file: undefined, origin: 'tree' });
        expect(sortNeedy([done, viaBatch, noTitle, noPerson, hidden, tree]).map(i => i.file!.id)).toEqual(['I0003', 'I0004']);
    });
});

describe('the strip over everything and the more specific ones', () => {
    const base = { narrowed: false, remembered: false, offered: true, needy: 5, batches: [3, 2] };
    it('offered in the whole view when files need it and more than one batch strip would say it', () => {
        expect(sortWholeOffered(base)).toBe(true);
        // Loose files outside any batch: no batch strip offers them.
        expect(sortWholeOffered({ ...base, needy: 4, batches: [3] })).toBe(true);
        expect(sortWholeOffered({ ...base, needy: 2, batches: [] })).toBe(true);
    });
    it('the more specific strip wins: one batch with all of them, a narrowed view, a sorting at work or remembered', () => {
        expect(sortWholeOffered({ ...base, needy: 3, batches: [3] })).toBe(false);
        expect(sortWholeOffered({ ...base, narrowed: true })).toBe(false);
        expect(sortWholeOffered({ ...base, remembered: true })).toBe(false);
    });
    it('nothing missing, or a research that cannot sort: no strip', () => {
        expect(sortWholeOffered({ ...base, needy: 0, batches: [] })).toBe(false);
        expect(sortWholeOffered({ ...base, offered: false })).toBe(false);
    });
});

describe('the proposal against what a person set', () => {
    const job = {
        files: ['I0001', 'I0002', 'I0003'],
        proposals: [
            { id: 'I0001', title: 'Wedding 1924', date: '1924', kind: 'photo' as const, links: [{ type: 'person' as const, ref: 'P0001' }], why: 'w', sure: 'high' as const },
            { id: 'I0002', title: 'Letter', links: [], why: '', sure: 'low' as const },
        ],
    };

    it('a person\'s title stays (shown with the agent\'s other one); an agent\'s title is proposed over; no proposal = unassigned', () => {
        const items = new Map([
            ['I0001', treeItem('I0001', { title: 'Grandma and Grandpa', titleBy: undefined })],
            ['I0002', treeItem('I0002', { title: 'Old guess', titleBy: 'agent' })],
            ['I0003', item('I0003')],
        ]);
        const rows = sortRows(job, id => items.get(id) ?? null, chip);
        expect(rows.map(r => r.id)).toEqual(['I0001', 'I0002', 'I0003']);
        expect(rows[0].title).toEqual({ proposed: 'Wedding 1924', human: 'Grandma and Grandpa' });
        expect(rows[1].title).toEqual({ proposed: 'Letter' });
        expect(sortRowProposes(rows[2])).toBe(false);

        // Accepted as it is: the person's title is not written, the rest is (by the agent).
        const w = sortWrite(rows[0])!;
        expect(w.mediaId).toBe('att-I0001');
        expect(w.title).toBeUndefined();
        expect(w.date).toEqual({ value: '1924', by: 'agent' });
        expect(w.kind).toEqual({ value: 'photo', by: 'agent' });
        expect(w.places).toEqual([{ personId: 'p1', by: 'agent' }]);
        // "Use the proposal": only then the person's title is replaced.
        expect(sortWrite(rows[0], { use: { title: true } })!.title).toEqual({ value: 'Wedding 1924', by: 'agent' });
        // Edited: the details are the person's own.
        const edited = sortWrite(rows[0], { edit: { title: 'Wedding of Josef', chips: [] } })!;
        expect(edited.title).toEqual({ value: 'Wedding of Josef', by: 'user' });
        expect(edited.places).toEqual([]);
    });

    it('material outside the tree: details through the bridge, its people by REFN', () => {
        const rows: SortRow[] = sortRows(job, id => (id === 'I0001' ? item('I0001') : null), chip);
        const w = sortWrite(rows[0])!;
        expect(w.mediaId).toBeNull();
        expect(w.fileId).toBe('I0001');
        expect(w.persons).toEqual(['P0001']);
        expect(w.title).toEqual({ value: 'Wedding 1924', by: 'agent' });
        // A file the window does not know: nothing to write.
        expect(sortWrite(rows[1])).toBeNull();
    });

    it('a person the file already has is no proposal', () => {
        const rows = sortRows(job, id => (id === 'I0001' ? item('I0001', { persons: ['P0001'] }) : null), chip);
        expect(rows[0].chips).toEqual([]);
    });
});

describe('what accepting writes beyond people (spec 102 §13)', () => {
    const tree: SortTreeIndex = {
        person: ref => (ref === 'P0001' ? { id: 'p1' as PersonId, name: 'Josef Fíšek' } : null),
        family: ref => (ref === 'F0001' ? { id: 'f1' as PartnershipId, name: 'Josef & Anna' } : null),
        source: ref => (ref === 'S0001' ? { id: 'src1', title: 'Parish register' } : null),
    };
    const names = {
        event: (t: string) => t, unknown: (r: string) => `${r}?`, eventLabel: (w: string) => `Event: ${w}`,
        sourceLabel: (t: string) => `Source: ${t}`, newSource: (t: string) => `Source: ${t} (new)`,
    };
    const job = {
        files: ['I0001'],
        proposals: [{ id: 'I0001', title: 'Wedding 1924', sure: 'high' as const, why: '', links: [
            { type: 'person' as const, ref: 'P0001' },
            { type: 'event' as const, ref: 'P0001', event: 'BIRT' },
            { type: 'event' as const, ref: 'F0001', event: 'MARR' },
            { type: 'source' as const, ref: 'S0001' },
            { type: 'source' as const, ref: 'S0009' },
            { type: 'person' as const, ref: 'P0404' },
        ] }],
    };
    const chipOf = (link: SortLink, title?: string) => sortChip(link, tree, names, title);

    it('material outside the tree: people through the research, an event, a couple and a source in the tree, an unknown source made new', () => {
        const [row] = sortRows(job, () => item('I0001'), chipOf);
        expect(row.chips.find(c => c.link.ref === 'S0009')).toMatchObject({ newSource: 'S0009', place: null, label: 'Source: Wedding 1924 (new)' });
        const w = sortWrite(row)!;
        // A person the tree does not know is still the research's own: assigned there.
        expect(w.persons).toEqual(['P0001', 'P0404']);
        expect(w.places).toEqual([
            { personId: 'p1', fact: 'birth', by: 'agent' },
            { partnershipId: 'f1', by: 'agent' },
            { sourceId: 'src1', by: 'agent' },
        ]);
        expect(w.newSources).toEqual([{ ref: 'S0009', title: 'Wedding 1924' }]);
    });

    it('a file of the tree: every known place, the unknown source made new under the title written', () => {
        const [row] = sortRows(job, () => treeItem('I0001', {}), chipOf);
        const w = sortWrite(row, { edit: { title: 'The wedding', chips: row.chips } })!;
        expect(w.mediaId).toBe('att-I0001');
        expect(w.places.map(p => Object.keys(p)[0])).toEqual(['personId', 'personId', 'partnershipId', 'sourceId']);
        expect(w.places.every(p => p.by === 'user')).toBe(true);
        expect(w.newSources).toEqual([{ ref: 'S0009', title: 'The wedding' }]);
    });

    it('a person added by hand without the research\'s REFN goes to the tree for material outside it', () => {
        const [row] = sortRows(job, () => item('I0001'), chipOf);
        const added: SortChip = { link: { type: 'person', ref: '' }, kind: 'person', person: null, place: { personId: 'p7' as PersonId }, label: 'Ema' };
        const w = sortWrite(row, { edit: { chips: [added] } })!;
        expect(w.persons).toEqual([]);
        expect(w.places).toEqual([{ personId: 'p7', by: 'user' }]);
    });

    it('a stored undo is read back only in its shape (anything off dropped)', () => {
        expect(parseSortRevert({
            media: 'att-1', created: false, fields: { title: { value: 'Old', agent: true }, kind: { value: 5 } },
            places: [{ personId: 'p1', fact: 'birth', by: 'agent' }, { nope: 1 }, { sourceId: 's1' }],
            sources: ['s9', 3], was: { title: '', date: '1924' }, persons: ['P0001', 'X1'],
        })).toEqual({
            media: 'att-1', fields: { title: { value: 'Old', agent: true } },
            places: [{ personId: 'p1', fact: 'birth', by: 'agent' }, { sourceId: 's1' }],
            sources: ['s9'], was: { title: '', date: '1924' }, persons: ['P0001'],
        });
        expect(parseSortRevert({ places: [{ personId: 'p1' }] })).toBeNull();
        expect(parseSortRevert('x')).toBeNull();
    });
});
