/**
 * The file of a source in the Materials window (spec 102 §7, research gate
 * `material.sourceOf`): `uses.of` of `GET /material` and `of` of
 * `GET /material/<I…>/uses` read by one parser; with the gate the item
 * carries its sources, counts as assigned ("Without a person" and "Without a
 * source" leave it out), is in the tree by its source's `inTree`, counts its
 * sources in the tree among its places (not twice) and names the people
 * citing them; without the gate nothing changes. Invented data.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { strings, setLanguage } from '../strings.js';
import { Attachment } from '../types.js';
import { MaterialFile, MaterialList, fileWithoutPerson, parseMaterialFile, parseMaterialUses } from '../materials.js';
import {
    overviewItems, overviewSummary, emptyFilters, passesFilters, itemInTree, itemWithoutPerson, personsShort,
    sourceOfPersons, OverviewFilters, TreeRecord,
} from '../materials-overview.js';

const sha = (n: number) => n.toString(16).padStart(64, '0');
const filters = (f: Partial<OverviewFilters> = {}): OverviewFilters => ({ ...emptyFilters(), ...f });

const REGISTER = { source: 'S12', via: 'input', title: 'Matrika narozených Talvany 1895–1910', cited: ['P0003', 'P0007'], citedCount: 3, inTree: true };
const CENSUS = { source: 'S14', via: 'media', title: 'Sčítání lidu Talvany 1921', cited: ['P0009'], citedCount: 1, inTree: true };

function raw(n: number, of?: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: `I${String(n).padStart(4, '0')}`, name: `sken-0${n}.pdf`, sha: sha(n), mime: 'application/pdf', persons: [],
        at: '2026-10-24T10:00:00.000Z',
        uses: { excerpts: 0, sources: of ? (of as { source: string }[]).map(o => o.source) : [], tasks: 0, ...(of ? { of } : {}) },
        ...extra,
    };
}

function list(files: MaterialFile[]): MaterialList {
    return { files, batches: [], people: { P0003: 'Ilsa Talvanenová (1901–1980)', P0007: 'Oskar Quellmayer', P0009: 'Hedda Ostrovid' }, fetchedAt: 1 };
}

const parsed = (...rows: Record<string, unknown>[]) => rows.map(r => parseMaterialFile(r)!);

afterEach(() => setLanguage('en'));

describe('the sources a file is the file of, read from the research', () => {
    it('`of` of GET /material/<I…>/uses is read by the same parser as `uses.of` of GET /material', () => {
        const answer = { excerpts: 1, sources: ['S12'], tasks: 0, of: [REGISTER, { source: 'S0x', via: 'input' }, { source: 'S13', via: 'scan' }] };
        const uses = parseMaterialUses(answer)!;
        expect(uses.of).toEqual([{ source: 'S12', via: 'input', title: 'Matrika narozených Talvany 1895–1910', cited: ['P0003', 'P0007'], citedCount: 3, inTree: true }]);
        expect(parseMaterialFile(raw(17, answer.of))!.uses?.of).toEqual(uses.of);
        // An older research: no `of`, the uses as before.
        expect(parseMaterialUses({ excerpts: 2, sources: ['S12'], tasks: 1 })).toEqual({ excerpts: 2, sources: ['S12'], tasks: 1 });
    });

    it('a source without `inTree` is not in the tree; `citedCount` is at least the people named', () => {
        const uses = parseMaterialUses({ excerpts: 0, sources: [], tasks: 0, of: [{ source: 'S5', via: 'excerpt', cited: ['P0001', 'P0002'] }] })!;
        expect(uses.of).toEqual([{ source: 'S5', via: 'excerpt', cited: ['P0001', 'P0002'], citedCount: 2, inTree: false }]);
    });
});

describe('the file of a source in the overview (spec 102 §7)', () => {
    const files = () => parsed(raw(17, [REGISTER]), raw(18, [CENSUS, { ...REGISTER, via: 'excerpt' }]), raw(19), raw(20, [{ ...CENSUS, inTree: false }]));

    it('with the gate: its sources and the first one\'s title as its source; assigned, so "Without a person" leaves it out', () => {
        const items = overviewItems(list(files()), [], { sourceOf: true });
        const [a, b, plain, outside] = items;
        expect(a.sourceOf?.map(s => s.source)).toEqual(['S12']);
        expect(a.source).toBe('Matrika narozených Talvany 1895–1910');
        expect(b.sourceOf?.map(s => s.source)).toEqual(['S14', 'S12']);
        expect(b.source).toBe('Sčítání lidu Talvany 1921');
        expect(plain.sourceOf).toBeUndefined();
        expect(items.map(itemWithoutPerson)).toEqual([false, false, true, false]);
        expect(items.filter(i => passesFilters(i, filters({ noPerson: true }))).map(i => i.key)).toEqual(['m:I0019']);
        expect(items.filter(i => passesFilters(i, filters({ noSource: true }))).map(i => i.key)).toEqual(['m:I0019']);
        const sum = overviewSummary(items, list(files()), true);
        expect(sum.noPerson).toBe(1);
        expect(sum.noSource).toBe(1);
        expect(outside.persons).toEqual([]);
    });

    it('"In the tree" by the source\'s inTree; its sources in the tree count among its places', () => {
        const items = overviewItems(list(files()), [], { sourceOf: true });
        expect(items.map(itemInTree)).toEqual([true, true, false, false]);
        expect(items.map(i => i.uses ?? 0)).toEqual([1, 2, 0, 0]);
        const sum = overviewSummary(items, list(files()), true);
        expect(sum.inTree).toBe(2);
        expect(sum.onlyArchive).toBe(2);
        expect(items.filter(i => passesFilters(i, filters({ where: 'tree' }))).map(i => i.key)).toEqual(['m:I0017', 'm:I0018']);
    });

    it('a tree\'s file already at the source: the source is not counted twice', () => {
        const a: Attachment = {
            id: 'att1', name: 'sken-017.pdf', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AA==', sizeBytes: 10, places: [],
            original: { sha256: sha(17), name: 'sken-017.pdf', mimeType: 'application/pdf', bytes: 10 },
        } as Attachment;
        const tree: TreeRecord[] = [{ att: a, persons: ['P0003'], uses: 2, source: 'Matrika (strom)', sourceRefs: ['S12'] }];
        const [item] = overviewItems(list(files()), tree, { sourceOf: true });
        expect(item.uses).toBe(2);
        // The tree's own source stays the Source column's title.
        expect(item.source).toBe('Matrika (strom)');
    });

    it('the people citing its sources after its own, each once, with how many more the research counted', () => {
        const [a, b] = overviewItems(list(files()), [], { sourceOf: true });
        expect(sourceOfPersons(a)).toEqual({ persons: ['P0003', 'P0007'], more: 1 });
        expect(sourceOfPersons(b)).toEqual({ persons: ['P0009', 'P0003', 'P0007'], more: 1 });
        expect(sourceOfPersons({ persons: ['P0007'], sourceOf: a.sourceOf })).toEqual({ persons: ['P0007', 'P0003'], more: 1 });
        const names: Record<string, string> = { P0003: 'Ilsa Talvanenová (1901–1980)', P0007: 'Oskar Quellmayer' };
        const { persons, more } = sourceOfPersons(a);
        expect(personsShort(persons, r => names[r] ?? null, more)).toBe('Ilsa Talvanenová +2');
        expect(personsShort(['P0007'], r => names[r] ?? null)).toBe('Oskar Quellmayer');
    });

    it('without the gate (an older research): the files as before, even when the answer carries `of`', () => {
        const items = overviewItems(list(files()), []);
        expect(items.every(i => i.sourceOf === undefined)).toBe(true);
        expect(items.map(i => i.source)).toEqual([undefined, undefined, undefined, undefined]);
        expect(items.map(itemWithoutPerson)).toEqual([true, true, true, true]);
        expect(items.map(itemInTree)).toEqual([false, false, false, false]);
    });

    it('fileWithoutPerson: the file of a source is assigned only with the gate', () => {
        const [a, , plain] = files();
        expect(fileWithoutPerson(a, { batches: [] })).toBe(true);
        expect(fileWithoutPerson(a, { batches: [] }, { sourceOf: true })).toBe(false);
        expect(fileWithoutPerson(plain, { batches: [] }, { sourceOf: true })).toBe(true);
    });
});

describe('texts of the file of a source', () => {
    it('tags, via, cited by and the sentence in the four languages, impersonal', () => {
        const s = () => strings.materials.agentSort;
        setLanguage('cs');
        expect([s().sourceOfN(1), s().sourceOfN(2), s().sourceOfN(5)]).toEqual(['Zdroj pramene', 'Zdroj 2 pramenů', 'Zdroj 5 pramenů']);
        expect(s().citedBy('Ilsa Talvanenová', 2)).toBe('Cituje: Ilsa Talvanenová, + 2');
        expect(s().citedBy('Ilsa Talvanenová', 0)).toBe('Cituje: Ilsa Talvanenová');
        expect(s().sourcesN(2)).toBe('2 prameny');
        setLanguage('en');
        expect([s().sourceOfN(1), s().sourceOfN(2)]).toEqual(['File of a source', 'File of 2 sources']);
        expect(s().citedBy('Ilsa Talvanen', 2)).toBe('Cited by: Ilsa Talvanen, + 2');
        setLanguage('de');
        expect(s().sourceOfN(2)).toBe('Datei von 2 Quellen');
        setLanguage('pl');
        expect(s().sourceOfN(2)).toBe('Plik 2 źródeł');
        expect(s().keptViaSource).toBe('Plik jest w badaniu; w drzewie jest przez źródło.');
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
            setLanguage(lang);
            const all = [s().tagSourceOf, s().usesSourceOf, s().viaInput, s().viaMedia, s().viaExcerpt, s().keptViaSource].join(' ');
            expect(all).not.toMatch(/\b([Yy]ou|[Yy]our|Sie|Ihr|du|[Vv]y|[Vv]áš|[Vv]aše|[Tt]y)\b/);
        }
    });
});
