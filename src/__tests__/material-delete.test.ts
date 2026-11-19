/**
 * Delete permanently (spec 102 §9, K1.17; the research's V3): the list of
 * impacts as the research sends it, the dry run and the confirmation (a
 * changed list is never waited out as busy), what the dialog says of the
 * list, its state (the button only with the list's confirmation and the box
 * ticked; a changed list asks again), the files leaving the remembered list
 * and the remembered sorting (§12). Invented data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setLanguage, strings } from '../strings.js';
import {
    parseDeleteImpacts, deleteMaterialDry, deleteMaterial, dropFromCache, saveMaterialList, cachedMaterialList,
    setMaterialsBackend, memoryMaterialsBackend, type DeleteImpact, type MaterialFile,
} from '../materials.js';
import {
    deletableFiles, deleteSummary, deleteWarns, deleteHasRefs, deleteStart, deleteListed, deleteChanged, deleteTicked, deleteCanGo,
} from '../material-delete.js';
import { sortJobWithout, sortRememberedWithout, sortRunRest } from '../material-sort.js';
import { sortRememberedFrom, type ResearchSortRemembered } from '../research-device.js';

const BASE = 'http://127.0.0.1:5998/0123456789abcdef0123456789abcdef';
const sha = (n: number) => n.toString(16).padStart(64, '0');

function fakeFetch(answers: [number, unknown, Record<string, string>?][]) {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const impl = async (url: string, init?: RequestInit): Promise<Response> => {
        calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
        const next = answers.shift();
        if (!next) throw new TypeError('connection refused');
        const [status, body, headers] = next;
        return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: headers ?? {} });
    };
    return { impl, calls };
}

function impact(id: string, over: Partial<DeleteImpact> = {}): DeleteImpact {
    return { id, name: `${id}.jpg`, sha: '', sources: [], excerpts: 0, people: [], links: 0, tasks: [], bytes: 'deleted', sameAs: [], ...over };
}

beforeEach(() => setLanguage('en'));

describe('parseDeleteImpacts', () => {
    it('reads the research\'s impacts as V3 sends them (sameAs an array)', () => {
        const list = parseDeleteImpacts([
            {
                id: 'I0017', name: 'sken-017.pdf', sha: sha(17),
                sources: [
                    { id: 'S0001', title: 'Matrika narozených Talvany 1895–1910', via: 'input', citedCount: 3 },
                    { id: 'S0001', title: 'again', via: 'input', citedCount: 9 },
                    { id: 'S0002', title: 'Sčítání lidu Ostrovid 1921', via: 'media', citedCount: 1.7 },
                    { id: 'X1', title: 'not a source', via: 'input' },
                    { id: 'S0003', title: 'unknown way', via: 'mail' },
                ],
                excerpts: 3, people: ['P0042', 'nope', 'P0042'], links: 2, tasks: ['t-ostrovid', 'bad task!'],
                bytes: 'kept', keptWhy: 'sameAs', sameAs: ['I0020', 'I0017', 'x', 'I0020'],
            },
            { id: 'I0018', name: 'b.jpg', sha: 'short', bytes: 'deleted', keptWhy: 'sameAs', sameAs: 'I0019' },
            { id: 'I0017', name: 'twice' },
            { id: 'bad' },
            'x',
        ]);
        expect(list).toEqual([
            {
                id: 'I0017', name: 'sken-017.pdf', sha: sha(17),
                sources: [
                    { id: 'S0001', title: 'Matrika narozených Talvany 1895–1910', via: 'input', citedCount: 3 },
                    { id: 'S0002', title: 'Sčítání lidu Ostrovid 1921', via: 'media', citedCount: 1 },
                ],
                excerpts: 3, people: ['P0042'], links: 2, tasks: ['t-ostrovid'], bytes: 'kept', keptWhy: 'sameAs', sameAs: ['I0020'],
            },
            // Not an array: no files of the same content; not said as kept: the bytes go.
            { id: 'I0018', name: 'b.jpg', sha: '', sources: [], excerpts: 0, people: [], links: 0, tasks: [], bytes: 'deleted', sameAs: [] },
        ]);
        expect(parseDeleteImpacts(null)).toEqual([]);
        expect(parseDeleteImpacts({ impacts: [] })).toEqual([]);
    });
});

describe('the bridge: dry run, then the confirmation', () => {
    it('asks the dry run first and deletes only with its confirmation', async () => {
        const f = fakeFetch([
            [200, { files: ['I0001'], dryRun: true, impacts: [{ id: 'I0001', name: 'a.jpg', links: 1 }], confirm: 'signed-1' }],
            [200, { files: ['I0001'], deleted: ['I0001'], impacts: [{ id: 'I0001', name: 'a.jpg', links: 1 }], head: 'c0ffee000001' }],
        ]);
        const dry = await deleteMaterialDry(BASE, ['I0001'], { fetchImpl: f.impl });
        expect(dry.ok && dry.value.confirm).toBe('signed-1');
        expect(dry.ok && dry.value.impacts[0].links).toBe(1);
        const done = await deleteMaterial(BASE, ['I0001'], 'signed-1', { fetchImpl: f.impl });
        expect(done).toEqual({ ok: true, value: { files: ['I0001'], deleted: ['I0001'], impacts: [impact('I0001', { name: 'a.jpg', links: 1 })], head: 'c0ffee000001' } });
        expect(f.calls.map(c => c.body)).toEqual([{ files: ['I0001'], dryRun: true }, { files: ['I0001'], confirm: 'signed-1' }]);
        expect(f.calls[0].url).toMatch(/\/material\/delete(\?|$)/);
    });

    it('never sends a deletion without a confirmation, nor more than 500 files', async () => {
        const f = fakeFetch([]);
        expect((await deleteMaterial(BASE, ['I0001'], '', { fetchImpl: f.impl })).ok).toBe(false);
        expect((await deleteMaterialDry(BASE, [], { fetchImpl: f.impl })).ok).toBe(false);
        expect((await deleteMaterialDry(BASE, Array.from({ length: 501 }, (_, k) => `I${k + 1}`), { fetchImpl: f.impl })).ok).toBe(false);
        expect((await deleteMaterialDry(BASE, ['P0001'], { fetchImpl: f.impl })).ok).toBe(false);
        expect(f.calls).toHaveLength(0);
    });

    it('a dry run without a confirmation is no list to delete by', async () => {
        const f = fakeFetch([[200, { files: ['I0001'], dryRun: true, impacts: [] }]]);
        expect((await deleteMaterialDry(BASE, ['I0001'], { fetchImpl: f.impl })).ok).toBe(false);
    });

    it('409 material.delete-changed: the new list at once, never tried again quietly', async () => {
        const f = fakeFetch([
            [409, { error: 'changed', code: 'material.delete-changed', text: 'changed', impacts: [{ id: 'I0001', name: 'a.jpg', links: 2 }] }],
            [200, { files: ['I0001'], deleted: ['I0001'], impacts: [], head: 'c0ffee000002' }],
        ]);
        const waits: number[] = [];
        const res = await deleteMaterial(BASE, ['I0001'], 'signed-1', { fetchImpl: f.impl, sleep: async ms => { waits.push(ms); } });
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.changed).toEqual([impact('I0001', { name: 'a.jpg', links: 2 })]);
        expect(f.calls).toHaveLength(1);
        expect(waits).toEqual([]);
    });

    it('a busy research is waited out; an expired confirmation is material.body', async () => {
        const f = fakeFetch([
            [409, { error: 'busy', code: 'material.busy', text: 'busy' }, { 'retry-after': '0' }],
            [400, { error: 'body', code: 'material.body', text: 'body' }],
        ]);
        const res = await deleteMaterial(BASE, ['I0001'], 'old', { fetchImpl: f.impl, sleep: async () => {} });
        expect(f.calls).toHaveLength(2);
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.changed).toBeUndefined();
        expect(res.error).toMatchObject({ kind: 'body', code: 'material.body', status: 400 });
    });
});

describe('what the dialog says of the list', () => {
    it('one row per source, the strongest effect; excerpts only with the bytes; counts over all files', () => {
        const s = deleteSummary([
            impact('I0001', { sources: [{ id: 'S0001', title: 'Matrika', via: 'media', citedCount: 2 }], excerpts: 3, links: 1, people: ['P0042'] }),
            impact('I0002', { sources: [{ id: 'S0001', title: 'Matrika', via: 'input', citedCount: 3 }], people: ['P0042', 'P0043'], tasks: ['t1'] }),
            impact('I0003', { sources: [{ id: 'S0002', title: 'Sčítání', via: 'excerpt', citedCount: 0 }], excerpts: 4, bytes: 'kept', keptWhy: 'otherResearch' }),
            impact('I0004'),
        ]);
        expect(s.sources).toEqual([
            { id: 'S0001', title: 'Matrika', effect: 'unlinked', citedCount: 3, files: ['I0001.jpg', 'I0002.jpg'] },
            { id: 'S0002', title: 'Sčítání', effect: 'unchanged', citedCount: 0, files: ['I0003.jpg'] },
        ]);
        expect(s.excerpts).toBe(3);
        expect(s.links).toBe(1);
        expect(s.people).toEqual(['P0042', 'P0043']);
        expect(s.peopleFiles).toBe(2);
        expect(s.tasks).toEqual(['t1']);
        expect(s.kept).toBe(1);
        expect(s.keptOther).toBe(true);
        expect(s.withRefs).toBe(3);
        expect(s.files).toBe(4);
        expect(deleteWarns(s)).toBe(true);
        expect(deleteHasRefs(impact('I0009'))).toBe(false);
        // Kept bytes: nothing of a source changes, no warning.
        expect(deleteWarns(deleteSummary([impact('I0003', { sources: [{ id: 'S0002', title: 'x', via: 'media', citedCount: 0 }], excerpts: 4, bytes: 'kept' })]))).toBe(false);
    });

    it('the texts in four languages say what the research does and never address anyone', () => {
        for (const lang of ['en', 'cs', 'de', 'pl'] as const) {
            setLanguage(lang);
            const d = strings.materials.del;
            expect(d.understand.length).toBeGreaterThan(10);
            expect(d.manyRefs(2, 12)).toMatch(/2/);
        }
        setLanguage('cs');
        const d = strings.materials.del;
        expect(d.manyRefs(2, 12)).toBe('2 ze 12 souborů na něco odkazují.');
        expect(d.more(7)).toBe('a 7 dalších');
        expect(d.toast(12)).toBe('Smazáno natrvalo: 12 souborů.');
        expect(d.understand).toBe('Rozumím, smazání nejde v aplikaci vrátit');
        expect(d.understandHint(1)).toMatch(/dřívějších zálohách výzkumu/);
        setLanguage('pl');
        expect(strings.materials.del.toast(5)).toBe('Usunięto trwale: 5 plików.');
    });

    it('the hint under the box and the people row follow the count of files (verification of sorting, findings 1)', () => {
        setLanguage('cs');
        let d = strings.materials.del;
        expect(d.understandHint(1)).toMatch(/^Soubor zůstane jen /);
        for (const n of [2, 4, 5, 12]) {
            expect(d.understandHint(n)).toMatch(/^Soubory zůstanou jen v dřívějších zálohách výzkumu\./);
            expect(d.understandHintArchive(n)).toMatch(/^Soubory zůstanou jen v dřívějších zálohách archivu\./);
        }
        expect(d.understandHintArchive(1)).toMatch(/^Soubor zůstane /);
        expect(d.subPeople(1, 1)).toBe('soubor zmizí z jejich materiálů');
        expect(d.subPeople(1, 12)).toBe('1 soubor zmizí z jejich materiálů');
        expect(d.subPeople(3, 12)).toBe('3 soubory zmizí z jejich materiálů');
        expect(d.subPeople(7, 12)).toBe('7 souborů zmizí z jejich materiálů');
        expect(d.subTasks(1)).toMatch(/^soubor z nich vypadne;/);
        expect(d.subTasks(12)).toMatch(/^soubory z nich vypadnou;/);

        setLanguage('en');
        d = strings.materials.del;
        expect(d.understandHint(1)).toMatch(/^The file stays /);
        expect(d.understandHint(3)).toMatch(/^The files stay /);
        expect(d.understandHintArchive(7)).toMatch(/^The files stay only in earlier backups of the archive\./);
        expect(d.subPeople(1, 1)).toBe('the file leaves their materials');
        expect(d.subPeople(1, 12)).toBe('1 file leaves their materials');
        expect(d.subPeople(7, 12)).toBe('7 files leave their materials');
        expect(d.subTasks(1)).toMatch(/^the file leaves them;/);
        expect(d.subTasks(3)).toMatch(/^the files leave them;/);

        setLanguage('de');
        d = strings.materials.del;
        expect(d.understandHint(1)).toMatch(/^Die Datei bleibt /);
        expect(d.understandHint(3)).toMatch(/^Die Dateien bleiben /);
        expect(d.understandHintArchive(12)).toMatch(/^Die Dateien bleiben nur in früheren Sicherungen des Archivs\./);
        expect(d.subPeople(1, 12)).toBe('1 Datei verschwindet aus ihren Materialien');
        expect(d.subPeople(7, 12)).toBe('7 Dateien verschwinden aus ihren Materialien');
        expect(d.subTasks(1)).toMatch(/^die Datei fällt heraus;/);
        expect(d.subTasks(12)).toMatch(/^die Dateien fallen heraus;/);

        setLanguage('pl');
        d = strings.materials.del;
        expect(d.understandHint(1)).toMatch(/^Plik zostanie /);
        expect(d.subTasks(1)).toMatch(/^plik z nich wypadnie;/);
        expect(d.subTasks(5)).toMatch(/^pliki z nich wypadną;/);
        for (const n of [2, 5, 22, 25]) expect(d.understandHint(n)).toMatch(/^Pliki zostaną /);
        expect(d.understandHintArchive(25)).toMatch(/^Pliki zostaną tylko we wcześniejszych kopiach zapasowych archiwum\./);
        expect(d.subPeople(1, 1)).toBe('plik zniknie z ich materiałów');
        expect(d.subPeople(1, 30)).toBe('1 plik zniknie z ich materiałów');
        expect(d.subPeople(3, 30)).toBe('3 pliki znikną z ich materiałów');
        expect(d.subPeople(5, 30)).toBe('5 plików zniknie z ich materiałów');
        expect(d.subPeople(22, 30)).toBe('22 pliki znikną z ich materiałów');
        expect(d.subPeople(25, 30)).toBe('25 plików zniknie z ich materiałów');
    });

    it('only the research\'s files can be deleted (not the tree\'s own attachments)', () => {
        const file = { id: 'I0001', name: 'a', sha: sha(1), persons: [] } as MaterialFile;
        expect(deletableFiles([
            { origin: 'tree' as const }, { origin: 'archive' as const, file }, { origin: 'both' as const, file }, { origin: 'archive' as const },
        ])).toHaveLength(2);
    });
});

describe('the dialog\'s state', () => {
    it('the button works only with the list\'s confirmation and the box ticked', () => {
        let s = deleteStart();
        expect(deleteCanGo(deleteTicked(s, true))).toBe(false);
        s = deleteListed(s, [impact('I0001')], 'signed-1');
        expect(deleteCanGo(s)).toBe(false);
        s = deleteTicked(s, true);
        expect(deleteCanGo(s)).toBe(true);
        expect(deleteCanGo({ ...s, phase: 'sending' })).toBe(false);
        expect(deleteCanGo(deleteTicked(s, false))).toBe(false);
    });

    it('a changed list (409) is shown at once, the box unticked, no confirmation until a new dry run', () => {
        let s = deleteTicked(deleteListed(deleteStart(), [impact('I0001')], 'signed-1'), true);
        s = deleteChanged(s, 'changed', [impact('I0001', { links: 2 })]);
        expect(s).toEqual({ phase: 'ready', impacts: [impact('I0001', { links: 2 })], confirm: null, understood: false, note: 'changed' });
        expect(deleteCanGo(deleteTicked(s, true))).toBe(false);
        // The new dry run: its confirmation; the box still asks again.
        s = deleteListed(s, [impact('I0001', { links: 2 })], 'signed-2');
        expect(deleteCanGo(s)).toBe(false);
        expect(deleteCanGo(deleteTicked(s, true))).toBe(true);
        expect(s.note).toBe('changed');
        // Ran out (no new list said): the list shown stays.
        const e = deleteChanged(deleteTicked(s, true), 'expired');
        expect(e.impacts).toEqual(s.impacts);
        expect(e.confirm).toBeNull();
        expect(e.note).toBe('expired');
    });
});

describe('the files leave what is remembered', () => {
    beforeEach(() => setMaterialsBackend(memoryMaterialsBackend()));

    it('the remembered list and its batches\' counts', async () => {
        const file = (n: number, batch?: string): MaterialFile => ({ id: `I${String(n).padStart(4, '0')}`, name: `s-${n}.jpg`, sha: sha(n), persons: [], ...(batch ? { batch } : {}) });
        await saveMaterialList('t1', { files: [file(1, 'b1'), file(2, 'b1'), file(3)], batches: [{ id: 'b1', name: 'Quellmayer letters', files: 2 } as never], people: {}, fetchedAt: 1 }, { kind: 'all' });
        await dropFromCache('t1', ['I0001', 'I0003']);
        const l = cachedMaterialList('t1')!;
        expect(l.files.map(f => f.id)).toEqual(['I0002']);
        expect(l.batches[0].files).toBe(1);
    });

    it('the remembered sorting (§12): its batches, what was decided, the proposals read before', () => {
        const r: ResearchSortRemembered = {
            id: 'sort-20261119-a1', files: ['I0001', 'I0002'], text: '', at: '2026-11-19T08:00:00Z',
            decided: { I0001: 'accepted', I0002: 'rejected' }, reverts: { I0001: { media: 'm' } },
            run: { id: 'run-20261119-ab', batches: [['I0001', 'I0002'], ['I0051'], ['I0101', 'I0102']], sorts: ['sort-20261119-a1'], next: 1, scope: 'all' },
        };
        const next = sortRememberedWithout(r, ['I0001', 'I0051'])!;
        expect(next.files).toEqual(['I0002']);
        expect(next.decided).toEqual({ I0002: 'rejected' });
        expect(next.reverts).toEqual({});
        // A batch whose every file went keeps them: its index still names the research's batch.
        expect(next.run!.batches).toEqual([['I0002'], ['I0051'], ['I0101', 'I0102']]);
        expect(next.gone).toEqual(['I0001', 'I0051']);
        expect(sortRunRest(next.run!, { done: [0] }, next.gone)).toEqual({ batches: 1, files: ['I0101', 'I0102'] });
        expect(sortRememberedWithout(r, ['I0999'])).toBeNull();
        // Stored and read again.
        expect(sortRememberedFrom(JSON.parse(JSON.stringify(next)))!.gone).toEqual(['I0001', 'I0051']);

        const job = {
            id: 'sort-20261119-a1', state: 'done' as const, files: ['I0001', 'I0002'], at: '',
            proposals: [{ id: 'I0001', links: [], why: '', sure: 'high' }, { id: 'I0002', links: [], why: '', sure: 'high' }] as never,
            unproposed: [{ id: 'I0001', why: 'dropped' as const }],
        };
        const left = sortJobWithout(job, ['I0001']);
        expect(left.files).toEqual(['I0002']);
        expect(left.proposals.map(p => p.id)).toEqual(['I0002']);
        expect(left.unproposed).toEqual([]);
        expect(sortJobWithout(job, ['I0999'])).toBe(job);
    });
});
