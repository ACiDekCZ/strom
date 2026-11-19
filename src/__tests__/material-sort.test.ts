import { describe, it, expect } from 'vitest';
import { parseSortJob, parseMaterialFile, startMaterialSort, type MaterialItem, type SortLink } from '../materials.js';
import { sortNeeds, sortNeedy, sortNext, sortLeftMap, sortCopyOf, sortIsText, SORT_MAX_BATCHES, sortStripState, sortProposalCounts, sortLeftIds, sortRows, sortRowProposes, sortWrite, sortChip, sortBackRow, parseSortRevert, sortUnrelatedHideable, type SortChip, type SortRow, type SortTreeIndex } from '../material-sort.js';
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

    it('takes the files judged so far (filesDone) only as a whole count; anything else leaves the progress without a number', () => {
        const base = { id: 'sort-20261117120000-ab12', state: 'working', files: ['I0001', 'I0002'], at: '2026-11-17T12:00:00Z', proposals: [] };
        expect(parseSortJob({ ...base, filesDone: 1 })!.filesDone).toBe(1);
        expect(parseSortJob({ ...base, filesDone: 0 })!.filesDone).toBe(0);
        expect(parseSortJob({ ...base, filesDone: 1.7 })!.filesDone).toBe(1);
        for (const off of [undefined, -1, '1', null, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(parseSortJob({ ...base, filesDone: off })!).not.toHaveProperty('filesDone');
        }
    });

    it('takes why a file has no proposal (unproposed); an unknown reason or a broken entry is left out, an older research says nothing', () => {
        const base = { id: 'sort-20261117120000-ab12', state: 'done', files: ['I0001', 'I0002', 'I0003'], at: '2026-11-17T12:00:00Z', proposals: [] };
        const job = parseSortJob({ ...base, unproposed: [
            { id: 'I0001', why: 'nothing-said', said: '  A blank page,\n nothing on it  ' },
            { id: 'I0002', why: 'reader-failed', outcome: 'timeout' },
            { id: 'I0002', why: 'left-out' },
            { id: 'I0003', why: 'bored' },
            { id: 'nope', why: 'left-out' },
            'I0003', null,
            { id: 'I0003', why: 'nothing-new', said: 42 },
        ] })!;
        expect(job.unproposed).toEqual([
            { id: 'I0001', why: 'nothing-said', said: 'A blank page, nothing on it' },
            { id: 'I0002', why: 'reader-failed', outcome: 'timeout' },
            { id: 'I0003', why: 'nothing-new' },
        ]);
        expect(parseSortJob(base)!).not.toHaveProperty('unproposed');
        expect(parseSortJob({ ...base, unproposed: 'all of them' })!).not.toHaveProperty('unproposed');
        expect(parseSortJob({ ...base, unproposed: [{ id: 'I0001', why: 'bored' }] })!).not.toHaveProperty('unproposed');
        expect(parseSortJob({ ...base, unproposed: [{ id: 'I0001', why: 'dropped', said: 'x'.repeat(5000) }] })!.unproposed![0].said!.length).toBeLessThanOrEqual(1000);
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
        const { send, batches, over } = sortNext([tree, hidden, ...many], { scope: 'all', left: new Set() });
        expect(send).toHaveLength(55);
        expect(batches.map(b => b.length)).toEqual([50, 5]);
        expect(over).toBe(0);
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
        const none = new Set<string>();
        expect(sortNext(files, { scope: 'all', left: none }).send.map(i => i.file!.id)).toEqual(['I0003', 'I0004']);
        expect(sortNext(files, { scope: 'selection', left: none }).send.map(i => i.file!.id)).toEqual(['I0001', 'I0002', 'I0003', 'I0004']);
        // The batches count the files that go: finished ones neither fill them nor make more.
        const many = [...Array.from({ length: 30 }, (_, i) => item(`I${i + 100}`, { titled: true, persons: ['P0001'] })), ...Array.from({ length: 52 }, (_, i) => item(`I${i + 200}`))];
        const batch = sortNext(many, { scope: 'all', left: none });
        expect(batch.batches.map(b => b.length)).toEqual([50, 2]);
        expect(batch.send[0].file!.id).toBe('I200');
        expect(sortNext(many, { scope: 'selection', left: none }).batches.map(b => b.length)).toEqual([50, 32]);
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

describe('what the next sorting sends and in which order (spec 102 §4, K1.13)', () => {
    /** A file of the research: its name, batch, path, content (sha) and when it came. */
    const f = (id: string, name: string, init: { batch?: string; path?: string; sha?: string; at?: string; mime?: string;
        left?: unknown; sameAs?: string; of?: unknown[] } = {}): MaterialItem => item(id, {
        name, title: name,
        ...(init.batch ? { batch: { id: init.batch, name: init.batch } } : {}),
        ...(init.path ? { path: init.path } : {}),
        file: {
            id, name, sha: init.sha ?? id.toLowerCase().padEnd(64, '0'), persons: [],
            ...(init.batch ? { batch: init.batch } : {}), ...(init.path ? { path: init.path } : {}),
            ...(init.at ? { at: init.at } : {}), ...(init.mime ? { mime: init.mime } : {}),
            ...(init.left ? { left: init.left } : {}), ...(init.sameAs ? { sameAs: init.sameAs } : {}),
            ...(init.of ? { uses: { excerpts: 0, sources: [], tasks: 0, of: init.of } } : {}),
        } as unknown as MaterialItem['file'],
    });
    const ids = (list: readonly MaterialItem[]) => list.map(i => i.file!.id);
    const none = new Set<string>();

    it('pictures and PDFs first, then the other files; text and data files only when asked, and then last', () => {
        const files = [
            f('I0001', 'notes.md'), f('I0002', 'tape.mp3'), f('I0003', 'IMG_0403.jpg'), f('I0004', 'data.json'),
            f('I0005', 'sken-017.pdf'), f('I0006', 'list.csv'), f('I0007', 'letter.txt'), f('I0008', 'scan', { mime: 'image/tiff' }),
            f('I0009', 'archive.zip'), f('I0010', 'readme', { mime: 'text/plain' }),
        ];
        const plain = sortNext(files, { scope: 'all', left: none });
        expect(ids(plain.send)).toEqual(['I0003', 'I0005', 'I0008', 'I0002', 'I0009']);
        expect(ids(plain.skipped.text)).toEqual(['I0001', 'I0004', 'I0006', 'I0007', 'I0010']);
        const withText = sortNext(files, { scope: 'all', left: none, withText: true });
        expect(ids(withText.send)).toEqual(['I0003', 'I0005', 'I0008', 'I0002', 'I0009', 'I0001', 'I0004', 'I0006', 'I0007', 'I0010']);
        expect(withText.skipped.text).toEqual([]);
        expect(sortIsText({ name: 'Brief.MD' } as MaterialItem)).toBe(true);
        expect(sortIsText({ name: 'photo.jpg' } as MaterialItem)).toBe(false);
    });

    it('the files of one folder stay together, in the batches\' and folders\' order, and a folder that fits a batch is not split', () => {
        const files = [
            f('I0001', 'a1.jpg', { batch: 'b1', path: 'Talvany/a1.jpg' }),
            f('I0002', 'c1.jpg', { batch: 'b2', path: 'Ostrovid/c1.jpg' }),
            f('I0003', 'b1.jpg', { batch: 'b1', path: 'Quellmayer/b1.jpg' }),
            f('I0004', 'a2.jpg', { batch: 'b1', path: 'Talvany/a2.jpg' }),
            f('I0005', 'b2.jpg', { batch: 'b1', path: 'Quellmayer/b2.jpg' }),
        ];
        expect(ids(sortNext(files, { scope: 'all', left: none }).send)).toEqual(['I0001', 'I0004', 'I0003', 'I0005', 'I0002']);
        // 30 files of one folder, then 30 of another: the second starts a batch of its own rather than split at 50.
        const big = [
            ...Array.from({ length: 30 }, (_, i) => f(`I${1000 + i}`, `a${i}.jpg`, { batch: 'b1', path: `Talvany/a${i}.jpg` })),
            ...Array.from({ length: 30 }, (_, i) => f(`I${2000 + i}`, `b${i}.jpg`, { batch: 'b1', path: `Quellmayer/b${i}.jpg` })),
        ];
        const run = sortNext(big, { scope: 'all', left: none });
        expect(run.batches.map(b => b.length)).toEqual([30, 30]);
        expect(run.batches[1].every(i => i.path!.startsWith('Quellmayer/'))).toBe(true);
        // A folder bigger than a batch is split.
        const huge = Array.from({ length: 70 }, (_, i) => f(`I${3000 + i}`, `h${i}.jpg`, { batch: 'b1', path: `Ostrovid/h${i}.jpg` }));
        expect(sortNext(huge, { scope: 'all', left: none }).batches.map(b => b.length)).toEqual([50, 20]);
    });

    it('at most 30 batches (1500 files) at once; the rest is counted for the next action', () => {
        const many = Array.from({ length: 1520 }, (_, i) => f(`I${10000 + i}`, `p${i}.jpg`));
        const run = sortNext(many, { scope: 'all', left: none });
        expect(run.send).toHaveLength(1520);
        expect(run.batches).toHaveLength(SORT_MAX_BATCHES);
        expect(run.over).toBe(20);
    });

    it('of files with the same content only the original goes: by the research\'s sameAs behind its gate, else by the hash (the oldest)', () => {
        const sha = 'ab'.repeat(32);
        const files = [
            f('I0001', 'IMG_0412.jpg', { sha, at: '2026-11-02T10:00:00Z' }),
            f('I0002', 'IMG_0412 (1).jpg', { sha, at: '2026-11-01T10:00:00Z' }),
            f('I0003', 'IMG_0412 (2).jpg', { sha, at: '2026-11-03T10:00:00Z' }),
            f('I0004', 'other.jpg'),
        ];
        const byHash = sortCopyOf(files, false);
        expect([...byHash]).toEqual([['I0001', 'I0002'], ['I0003', 'I0002']]);
        const run = sortNext(files, { scope: 'all', left: none, copyOf: byHash });
        expect(ids(run.send)).toEqual(['I0002', 'I0004']);
        expect(ids(run.skipped.copies)).toEqual(['I0001', 'I0003']);
        // The research says it: only its word counts (the hashes are not compared then).
        const said = [f('I0001', 'a.jpg', { sha }), f('I0002', 'b.jpg', { sha }), f('I0005', 'c.jpg', { sameAs: 'I0004' }), f('I0004', 'd.jpg')];
        expect([...sortCopyOf(said, true)]).toEqual([['I0005', 'I0004']]);
        expect(ids(sortNext(said, { scope: 'all', left: none, copyOf: sortCopyOf(said, true) }).send)).toEqual(['I0001', 'I0002', 'I0004']);
        // Selected by hand: copies go too.
        expect(ids(sortNext(files, { scope: 'selection', left: none, copyOf: byHash }).send)).toEqual(['I0001', 'I0002', 'I0003', 'I0004']);
    });

    it('the file of a source is not sent behind the research\'s gate; without it, as before', () => {
        const of = [{ source: 'S12', via: 'input', cited: [], citedCount: 0, inTree: true }];
        const files = [f('I0001', 'matrika.pdf', { of }), f('I0002', 'IMG_1.jpg')];
        const gated = sortNext(files, { scope: 'all', left: none, sourceOf: true });
        expect(ids(gated.send)).toEqual(['I0002']);
        expect(ids(gated.skipped.sources)).toEqual(['I0001']);
        expect(ids(sortNext(files, { scope: 'all', left: none }).send)).toEqual(['I0001', 'I0002']);
        expect(ids(sortNext(files, { scope: 'selection', left: none, sourceOf: true }).send)).toEqual(['I0001', 'I0002']);
    });

    it('what the agent left unassigned is not sent again (the research\'s left behind its gate, else the app\'s memory), unless selected', () => {
        const left = { at: '2026-11-19T10:00:00Z', sort: 'sort-20261119100000-ab12', why: 'nothing-said', said: 'A blank page' };
        const files = [f('I0001', 'sken-019.pdf', { left }), f('I0002', 'IMG_2.jpg'), f('I0003', 'IMG_3.jpg')];
        const app = { I0003: { why: 'unrelated' } };
        // Without the gate: only what the app remembers.
        const without = sortLeftMap(files, { research: false, app });
        expect([...without.keys()]).toEqual(['I0003']);
        expect(ids(sortNext(files, { scope: 'all', left: without }).send)).toEqual(['I0001', 'I0002']);
        // Behind the gate: the research's word together with the app's.
        const gated = sortLeftMap(files, { research: true, app });
        expect(gated.get('I0001')).toEqual({ why: 'nothing-said', said: 'A blank page' });
        const run = sortNext(files, { scope: 'all', left: gated });
        expect(ids(run.send)).toEqual(['I0002']);
        expect(ids(run.skipped.left)).toEqual(['I0001', 'I0003']);
        expect(ids(sortNext(files, { scope: 'selection', left: gated }).send)).toEqual(['I0001', 'I0002', 'I0003']);
    });

    it('a batch takes only its own files', () => {
        const files = [f('I0001', 'a.jpg', { batch: 'b1' }), f('I0002', 'b.jpg', { batch: 'b2' }), f('I0003', 'c.jpg', { batch: 'b1' })];
        expect(ids(sortNext(files, { scope: 'batch', batchId: 'b1', left: none }).send)).toEqual(['I0001', 'I0003']);
    });
});

describe('the one strip of sorting (spec 102 §1)', () => {
    const base = { remembered: false, running: false, pending: 0, closed: false, next: 137 };
    it('A: files to sort and nothing remembered; nothing to sort and nothing remembered: no strip', () => {
        expect(sortStripState(base)).toBe('A');
        expect(sortStripState({ ...base, next: 0 })).toBeNull();
    });
    it('B and C while the agent works: C once proposals wait', () => {
        expect(sortStripState({ ...base, remembered: true, running: true })).toBe('B');
        expect(sortStripState({ ...base, remembered: true, running: true, pending: 44 })).toBe('C');
    });
    it('D: proposals wait and nothing works; all of it handled counts as E (it can be sorted further)', () => {
        expect(sortStripState({ ...base, remembered: true, pending: 44 })).toBe('D');
        expect(sortStripState({ ...base, remembered: true, pending: 0 })).toBe('E');
        expect(sortStripState({ ...base, remembered: true, pending: 0, next: 0 })).toBe('E');
    });
    it('E after the proposal closed with files left, F with nothing left (never "the proposal is ready" again)', () => {
        expect(sortStripState({ ...base, closed: true, next: 17 })).toBe('E');
        expect(sortStripState({ ...base, closed: true, next: 0 })).toBe('F');
    });
    it('files the agent left unassigned keep E (Go through by hand), never "All files have a title and a person"', () => {
        expect(sortStripState({ ...base, closed: true, next: 0, left: 10 })).toBe('E');
        expect(sortStripState({ ...base, closed: true, next: 0, left: 0 })).toBe('F');
        expect(sortStripState({ ...base, next: 0, left: 10 })).toBeNull();
    });
    it('a remembered sorting wins over the closed line of the last one', () => {
        expect(sortStripState({ ...base, remembered: true, running: true, closed: true })).toBe('B');
    });
});

describe('what "Sort the next" takes and what a closed proposal leaves (spec 102 §5, §6)', () => {
    const files = [item('I0001'), item('I0002'), item('I0003', { titled: true, persons: ['P0001'] }), item('I0004', { hidden: {} })];
    it('the files without a title or a person, except the ones the agent left unassigned before', () => {
        const ids = (left: Parameters<typeof sortNext>[1]['left']) => sortNext(files, { scope: 'all', left }).send.map(i => i.file!.id);
        expect(ids({})).toEqual(['I0001', 'I0002']);
        expect(ids({ I0002: { at: '2026-11-19T10:00:00Z' } })).toEqual(['I0001']);
        expect(ids(new Set(['I0001']))).toEqual(['I0002']);
    });
    const job = {
        files: ['I0001', 'I0002', 'I0005', 'I0006', 'I0007', 'I0008'],
        proposals: [
            { id: 'I0001', title: 'Quellmayer wedding', links: [], why: '', sure: 'high' as const },
            { id: 'I0002', title: 'Talvanen farm', links: [], why: '', sure: 'high' as const },
            { id: 'I0005', title: 'Ostrovid letter', links: [], why: '', sure: 'medium' as const },
            { id: 'I0006', links: [], why: 'A receipt', sure: 'low' as const, unrelated: true as const },
        ],
        unproposed: [{ id: 'I0007', why: 'nothing-said' as const }, { id: 'I0008', why: 'reader-failed' as const }],
    };
    const rows = sortRows(job, id => item(id), chip);
    it('counts the rows as the proposal window shows them', () => {
        expect(sortProposalCounts(rows, { I0001: 'accepted', I0002: 'rejected' })).toEqual({ files: 6, open: 1, accepted: 1, rejected: 1, unassigned: 3 });
        expect(sortProposalCounts(rows, {}).open).toBe(3);
    });
    it('remembers as unassigned the files with no proposal or not about the family, not those the research did not judge', () => {
        expect(sortLeftIds(rows, job.unproposed)).toEqual([{ id: 'I0006', why: 'unrelated' }, { id: 'I0007', why: 'nothing-said' }]);
        expect(sortLeftIds(rows)).toEqual([{ id: 'I0006', why: 'unrelated' }, { id: 'I0007' }, { id: 'I0008' }]);
    });
    it('a row accepted counts as accepted, never as unassigned, though the file has what was proposed now', () => {
        // After the acceptance the file has the title: its row, made anew, proposes nothing.
        const titled = (id: string) => {
            const i = item(id, { titled: true, title: 'Quellmayer wedding' });
            return { ...i, file: { ...i.file!, title: 'Quellmayer wedding' } } as MaterialItem;
        };
        const after = sortRows(job, id => id === 'I0001' ? titled(id) : item(id), chip);
        expect(sortRowProposes(after[0])).toBe(false);
        expect(sortProposalCounts(after, { I0001: 'accepted' })).toMatchObject({ accepted: 1, unassigned: 3, open: 2 });
        expect(sortLeftIds(after, job.unproposed, { I0001: 'accepted' }).map(x => x.id)).toEqual(['I0006', 'I0007']);
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

describe('a file the agent says is not about the family (spec 110, point 4)', () => {
    const job = parseSortJob({
        id: 'sort-20261118120000-ab12', state: 'done', files: ['I0001', 'I0002', 'I0003', 'I0004', 'I0005'], at: '2026-11-18T12:00:00Z',
        proposals: [
            { id: 'I0001', unrelated: true, title: 'Receipt from a shop', kind: 'other', links: [{ type: 'person', ref: 'P0001' }], why: 'A shop receipt from 2019', sure: 'high' },
            { id: 'I0002', unrelated: true, why: 'A screenshot of a phone', sure: 'medium' },
            { id: 'I0003', unrelated: 'yes', title: 'Wedding 1924', links: [], why: 'A veil', sure: 'high' },
            { id: 'I0004', unrelated: true, why: 'A stranger’s holiday photo', sure: 'low' },
            { id: 'I0005', unrelated: true, why: 'A ticket', sure: 'low' },
        ],
    })!;

    it('read only as `unrelated: true`; without it a proposal is read as before', () => {
        expect(job.proposals.map(p => p.unrelated ?? null)).toEqual([true, true, null, true, true]);
        expect(job.proposals[1]).toEqual({ id: 'I0002', links: [], sure: 'medium', why: 'A screenshot of a phone', unrelated: true });
        expect(job.proposals[2]).toEqual({ id: 'I0003', links: [], sure: 'high', why: 'A veil', title: 'Wedding 1924' });
    });

    it('unassigned with its reason, nothing of it offered; without the flag the row is as before', () => {
        const rows = sortRows(job, id => item(id), chip);
        expect(rows[0].unrelated).toBe(true);
        expect(rows[0].title).toBeUndefined();
        expect(rows[0].kind).toBeUndefined();
        expect(rows[0].chips).toEqual([]);
        expect(rows[0].proposal?.why).toBe('A shop receipt from 2019');
        expect(sortRowProposes(rows[0])).toBe(false);
        expect(sortWrite(rows[0])).toBeNull();
        expect(rows[2].unrelated).toBeUndefined();
        expect(rows[2].title).toEqual({ proposed: 'Wedding 1924' });
        expect(sortRowProposes(rows[2])).toBe(true);
    });

    it('Hide as Not about the family takes the research\'s files not hidden yet and not placed in the tree', () => {
        const items = new Map<string, MaterialItem>([
            ['I0001', item('I0001')],
            ['I0002', item('I0002', { hidden: { reason: 'unrelated' } })],
            ['I0003', item('I0003')],
            ['I0004', treeItem('I0004', { places: [{ personId: 'p1' as PersonId }] })],
            ['I0005', item('I0005', { origin: 'both' })],
        ]);
        const rows = sortRows(job, id => items.get(id) ?? null, chip);
        expect(sortUnrelatedHideable(rows).map(i => i.file?.id)).toEqual(['I0001', 'I0005']);
        // Without the flag nothing is offered to hide.
        const plain = sortRows({ files: job.files, proposals: job.proposals.map(({ unrelated: _u, ...p }) => p) }, id => items.get(id) ?? null, chip);
        expect(sortUnrelatedHideable(plain)).toEqual([]);
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

describe('what the research says of a file for the next sorting, behind its gates (spec 102 §4)', () => {
    it('left, sameAs and the sources a file is the file of are read; anything off is dropped', () => {
        const f = parseMaterialFile({
            id: 'I0012', name: 'sken-019.pdf', sha: 'c'.repeat(64), persons: [],
            left: { at: '2026-11-19T10:00:00Z', sort: 'sort-20261119100000-ab12', why: 'nothing-said', said: 'A blank page' },
            sameAs: 'I0003',
            uses: { excerpts: 0, sources: [], tasks: 0, of: [{ source: 'S12', via: 'input', title: 'Matrika Talvany', cited: ['P0001'], citedCount: 1, inTree: true }, { source: 'X1', via: 'input' }] },
        })!;
        expect(f.left).toEqual({ at: '2026-11-19T10:00:00Z', sort: 'sort-20261119100000-ab12', why: 'nothing-said', said: 'A blank page' });
        expect(f.sameAs).toBe('I0003');
        expect(f.uses?.of?.map(o => o.source)).toEqual(['S12']);
        const off = parseMaterialFile({ id: 'I0012', name: 'a.jpg', sha: 'c'.repeat(64), persons: [], left: { why: 'nothing-said' }, sameAs: 'I0012' })!;
        expect(off.left).toBeUndefined();
        expect(off.sameAs).toBeUndefined();
    });
});

describe('the back side and the portrait as chips of a proposal (spec 102 §10)', () => {
    const job = (links: unknown[], extra: Record<string, unknown> = {}) => parseSortJob({
        id: 'sort-20261119100000-ab12', state: 'done', files: ['I0403', 'I0413'],
        proposals: [{ id: 'I0403', title: 'Svatba Oskara a Ilsy', date: '5. 1924', kind: 'photo', links, why: 'Wedding', sure: 'high', ...extra }],
    })!;

    it('a link to another file of the research is its back side; the back has no row of its own', () => {
        const j = job([{ type: 'person', ref: 'P0001' }, { type: 'back', ref: 'I0413' }]);
        expect(j.proposals[0].back).toBe('I0413');
        expect(j.proposals[0].links.map(l => l.type)).toEqual(['person']);
        const rows = sortRows(j, id => item(id), chip);
        expect(rows.map(r => r.id)).toEqual(['I0403']);
        expect(rows[0].back?.id).toBe('I0413');
        // Itself, or not a file: no back side.
        expect(job([{ type: 'back', ref: 'I0403' }]).proposals[0].back).toBeUndefined();
        expect(job([{ type: 'back', ref: 'P0001' }]).proposals[0].back).toBeUndefined();
        // A portrait is the agent's word for a person (P…), never a guess of the app.
        expect(job([{ type: 'portrait', ref: 'P0002' }]).proposals[0].portrait).toBe('P0002');
        expect(job([{ type: 'portrait', ref: 'I0413' }]).proposals[0].portrait).toBeUndefined();
        expect(job([{ type: 'person', ref: 'P0002' }]).proposals[0].portrait).toBeUndefined();
        // A back the agent proposed something for keeps its own row, no chip.
        const both = parseSortJob({
            id: 'sort-20261119100000-ab12', state: 'done', files: ['I0403', 'I0413'],
            proposals: [{ id: 'I0403', title: 'Front', links: [{ type: 'back', ref: 'I0413' }], why: '', sure: 'high' }, { id: 'I0413', title: 'Back', links: [], why: '', sure: 'high' }],
        })!;
        const r2 = sortRows(both, id => item(id), chip);
        expect(r2.map(r => r.id)).toEqual(['I0403', 'I0413']);
        expect(r2[0].back).toBeUndefined();
    });

    it('accepting writes the back with the front\'s date, kind and links and the title with "(back)"; what a person set on it stays', () => {
        const j = job([{ type: 'person', ref: 'P0001' }, { type: 'back', ref: 'I0413' }]);
        const rub = (t: string) => `${t} (rub)`;
        const [row] = sortRows(j, id => item(id), chip);
        const b = sortBackRow(row, rub)!;
        const w = sortWrite(b.row, b.choice)!;
        expect(w.fileId).toBe('I0413');
        expect(w.title).toEqual({ value: 'Svatba Oskara a Ilsy (rub)', by: 'agent' });
        expect(w.date?.value).toBe('5. 1924');
        expect(w.kind?.value).toBe('photo');
        expect(w.persons).toEqual(['P0001']);
        // A back already titled by a person keeps its title; an edited front carries over.
        const titled = item('I0413', { titled: true, title: 'Věnování', file: { id: 'I0413', name: 'IMG_0413.jpg', sha: 'd'.repeat(64), persons: [], title: 'Věnování' } as unknown as MaterialItem['file'] });
        const [row2] = sortRows(j, id => id === 'I0413' ? titled : item(id), chip);
        expect(sortWrite(sortBackRow(row2, rub)!.row)!.title).toBeUndefined();
        const edited = sortBackRow(row, rub, { edit: { title: 'Svatba 1924' } })!;
        expect(sortWrite(edited.row, edited.choice)!.title).toEqual({ value: 'Svatba 1924 (rub)', by: 'user' });
        expect(sortBackRow({ ...row, back: undefined }, rub)).toBeNull();
    });
});
