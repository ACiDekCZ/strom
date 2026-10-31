/**
 * The family book dialog's memory and entry rules (1031 §4.8), the saved
 * book's file name, the estimate across generations and the count of other
 * families. Pure: a fake storage stands in for localStorage. Invented names
 * only.
 */

import { describe, it, expect } from 'vitest';
import {
    BOOK_GENERATIONS_DEFAULT, bookEntrySelection, bookMemoryKey, bookOptionsFromMemory, bookRodChoices,
    clampBookGenerations, loadBookMemory, parseBookMemory, saveBookMemory,
} from '../book-memory.js';
import { BOOK_PART_KEYS, BookOptions, bookRodCounts, defaultBookOptions, estimateBook } from '../book-options.js';
import { buildBookModel } from '../book-model.js';
import { bookFileName } from '../book-window.js';
import { buildFamilyBook } from '../book.js';
import { buildLineages, otherFamilyRods, rodOf, RodId } from '../lineage.js';
import { Partnership, PartnershipId, Person, PersonId, StromData } from '../types.js';

/** A Map-backed Storage; `fail` makes reads or writes throw (private mode, quota). */
function fakeStorage(init: Record<string, string> = {}, fail: { get?: boolean; set?: boolean } = {}) {
    const map = new Map(Object.entries(init));
    return {
        map,
        getItem(k: string): string | null {
            if (fail.get) throw new Error('denied');
            return map.has(k) ? map.get(k)! : null;
        },
        setItem(k: string, v: string): void {
            if (fail.set) throw new Error('quota');
            map.set(k, v);
        },
    };
}

const P = (id: string): PersonId => id as PersonId;

function person(id: string, first: string, last: string, gender: 'male' | 'female', born: string, parents: string[] = []): Person {
    return {
        id: P(id), firstName: first, lastName: last, gender, isPlaceholder: false, birthDate: born,
        parentIds: parents.map(P), childIds: [], partnerships: [],
    };
}

/**
 * The Vrbovec line over four generations (big), the Ostrožan father and son
 * (small, another family) and the wives who married in without parents.
 */
function vrbovec(): StromData {
    const persons: Record<string, Person> = {};
    const partnerships: Record<string, Partnership> = {};
    const add = (p: Person): void => { persons[p.id] = p; };
    add(person('v1', 'Hostivít', 'Vrbovec', 'male', '1700'));
    add(person('w1', 'Zdislava', 'Kvítková', 'female', '1705'));
    add(person('v2', 'Bořivoj', 'Vrbovec', 'male', '1730', ['v1', 'w1']));
    add(person('w2', 'Dobroslava', 'Pelyňková', 'female', '1733'));
    add(person('v3', 'Bolemír', 'Vrbovec', 'male', '1732', ['v1', 'w1']));
    add(person('v4', 'Svatoboj', 'Vrbovec', 'male', '1760', ['v2', 'w2']));
    add(person('w4', 'Radoslava', 'Mlíčňáková', 'female', '1762'));
    add(person('v5', 'Hostivít', 'Vrbovec', 'male', '1790', ['v4', 'w4']));
    add(person('o1', 'Dobroslav', 'Ostrožan', 'male', '1750'));
    add(person('o2', 'Bolemír', 'Ostrožan', 'male', '1780', ['o1']));
    const union = (id: string, a: string, b: string, kids: string[]): void => {
        partnerships[id] = { id: id as PartnershipId, person1Id: P(a), person2Id: P(b), status: 'married', childIds: kids.map(P) };
        persons[a].partnerships.push(id as PartnershipId);
        persons[b].partnerships.push(id as PartnershipId);
        for (const k of kids) { persons[a].childIds.push(P(k)); persons[b].childIds.push(P(k)); }
    };
    union('u1', 'v1', 'w1', ['v2', 'v3']);
    union('u2', 'v2', 'w2', ['v4']);
    union('u3', 'v4', 'w4', ['v5']);
    persons.o2.parentIds = [P('o1')];
    persons.o1.childIds = [P('o2')];
    return { version: 13, persons, partnerships } as unknown as StromData;
}

const opts = (o: Partial<BookOptions> = {}): BookOptions => ({ ...defaultBookOptions('en'), ...o });

describe('book memory: per tree on this device', () => {
    it('saves under strom.book.{treeId} and loads only for that tree', () => {
        const s = fakeStorage();
        saveBookMemory(s, 'tree-a', opts({ detail: 'all', privacy: 'full', lang: 'de', notes: true }));
        expect([...s.map.keys()]).toEqual([bookMemoryKey('tree-a')]);
        expect(bookMemoryKey('tree-a')).toBe('strom.book.tree-a');
        const m = loadBookMemory(s, 'tree-a')!;
        expect(m).toMatchObject({ detail: 'all', privacy: 'full', lang: 'de', notes: true, research: false, preset: 'custom' });
        expect(loadBookMemory(s, 'tree-b')).toBeNull();
        // Without a tree nothing is kept or read.
        saveBookMemory(s, null, opts());
        expect(s.map.size).toBe(1);
        expect(loadBookMemory(s, null)).toBeNull();
    });

    it('never remembers the selection or the title; reopening takes the entry\'s selection and the automatic title', () => {
        const s = fakeStorage();
        saveBookMemory(s, 't', opts({ selection: { kind: 'ancestors', person: P('v5'), generations: 7 }, title: 'Hand-typed title', detail: 'brief' }));
        const raw = JSON.parse(s.map.get('strom.book.t')!);
        expect(Object.keys(raw).sort()).toEqual(['detail', 'lang', 'notes', 'parts', 'preset', 'privacy', 'research']);
        const reopened = bookOptionsFromMemory('en', loadBookMemory(s, 't'), { kind: 'tree' });
        expect(reopened.selection).toEqual({ kind: 'tree' });
        expect(reopened.title).toBeUndefined();
        expect(reopened.detail).toBe('brief');
    });

    it('a choice of lineages becomes lastRods; another kind of choice keeps the previous one', () => {
        const s = fakeStorage();
        saveBookMemory(s, 't', opts({ selection: { kind: 'rods', rods: ['r1', 'r2'] as RodId[] } }));
        expect(loadBookMemory(s, 't')!.lastRods).toEqual(['r1', 'r2']);
        saveBookMemory(s, 't', opts({ selection: { kind: 'tree' } }));
        expect(loadBookMemory(s, 't')!.lastRods).toEqual(['r1', 'r2']);
        saveBookMemory(s, 't', opts({ selection: { kind: 'rods', rods: ['r3'] as RodId[] } }));
        expect(loadBookMemory(s, 't')!.lastRods).toEqual(['r3']);
    });

    it('the presets: the family and research ones are remembered as such, any other change as Custom', () => {
        const s = fakeStorage();
        saveBookMemory(s, 't', opts());
        expect(loadBookMemory(s, 't')!.preset).toBe('family');
        saveBookMemory(s, 't', opts({ detail: 'all', notes: true, research: true }));
        expect(loadBookMemory(s, 't')!.preset).toBe('research');
        saveBookMemory(s, 't', opts({ parts: { ...opts().parts, index: false } }));
        expect(loadBookMemory(s, 't')!.preset).toBe('custom');
        expect(bookOptionsFromMemory('en', loadBookMemory(s, 't'), { kind: 'tree' }).parts.index).toBe(false);
        // A preset stored without its parts (an entry cut short) is applied as a preset.
        const research = bookOptionsFromMemory('en', parseBookMemory('{"preset":"research"}'), { kind: 'tree' });
        expect(research).toMatchObject({ detail: 'all', notes: true, research: true });
    });

    it('a damaged entry or an unusable storage never breaks the dialog: the defaults stand', () => {
        for (const raw of ['{bad', '[]', '"x"', '42', 'null', '{}']) {
            expect(parseBookMemory(raw), raw).toBeNull();
        }
        // Malformed fields are left out one by one; good ones stay.
        const m = parseBookMemory(JSON.stringify({
            detail: 'huge', privacy: 'secret', lang: 'fr', notes: 'yes', research: true,
            parts: { toc: 'no', index: false, bogus: true }, lastRods: [1, '', 'r9'], preset: 'all',
        }));
        expect(m).toEqual({ research: true, parts: { index: false }, lastRods: ['r9'] });
        const o = bookOptionsFromMemory('cs', m, { kind: 'tree' });
        expect(o).toMatchObject({ detail: 'normal', privacy: 'initials', lang: 'cs', notes: false, research: true });
        expect(o.parts.index).toBe(false);
        expect(o.parts.toc).toBe(true);
        // The families are always in, whatever is stored.
        expect(bookOptionsFromMemory('en', parseBookMemory('{"parts":{"families":false}}'), { kind: 'tree' }).parts.families).toBe(true);
        // Storage that throws: nothing read, nothing thrown.
        expect(loadBookMemory(fakeStorage({}, { get: true }), 't')).toBeNull();
        expect(() => saveBookMemory(fakeStorage({}, { set: true }), 't', opts())).not.toThrow();
        expect(loadBookMemory(null, 't')).toBeNull();
        expect(() => saveBookMemory(undefined, 't', opts())).not.toThrow();
    });

    it('the book\'s options never touch the person card\'s settings or lifelineDefaults: one key of its own', () => {
        const others = {
            'strom-settings': JSON.stringify({ cardWidth: 'wide', lifelineDefaults: { 't': { childEvents: true, history: false } } }),
            'strom-lifeline-defaults': '{"t":{"childEvents":false,"history":true}}',
        };
        const s = fakeStorage(others);
        saveBookMemory(s, 't', opts({ detail: 'all', notes: true, research: true, privacy: 'anonymous', lang: 'de' }));
        saveBookMemory(s, 't', opts({ detail: 'brief' }));
        for (const [k, v] of Object.entries(others)) expect(s.map.get(k)).toBe(v);
        expect([...s.map.keys()].filter(k => !(k in others))).toEqual(['strom.book.t']);
        // Building and estimating the book leaves the tree's data as it was.
        const data = vrbovec();
        (data as StromData & { lifelineDefaults?: unknown }).lifelineDefaults = { childEvents: true };
        const before = JSON.stringify(data);
        const o = opts({ detail: 'all', notes: true, research: true, privacy: 'full' });
        estimateBook(data, o);
        buildFamilyBook(data, o, { now: new Date('2026-10-31T12:00:00Z'), dateLabel: 'x' });
        expect(JSON.stringify(data)).toBe(before);
    });
});

describe('book entry: the first selection (§4.8)', () => {
    const data = vrbovec();
    const index = buildLineages(data);
    const vrb = rodOf(index, P('v1'))!;
    const ostr = rodOf(index, P('o1'))!;

    it('from a lineage: that lineage; from a person: their descendants, 4 generations', () => {
        expect(bookEntrySelection({ kind: 'rods', rods: [ostr] }, index)).toEqual({ kind: 'rods', rods: [ostr] });
        expect(bookEntrySelection({ kind: 'person', person: P('v2') }, index, [vrb]))
            .toEqual({ kind: 'descendants', person: P('v2'), generations: BOOK_GENERATIONS_DEFAULT });
        expect(BOOK_GENERATIONS_DEFAULT).toBe(4);
    });

    it('from the menu: the last lineages while they all still exist as choices, else the whole tree', () => {
        expect(bookRodChoices(index)).toEqual([vrb]);
        expect(bookEntrySelection({ kind: 'menu' }, index, [vrb])).toEqual({ kind: 'rods', rods: [vrb] });
        expect(bookEntrySelection({ kind: 'menu' }, index)).toEqual({ kind: 'tree' });
        expect(bookEntrySelection({ kind: 'menu' }, index, [])).toEqual({ kind: 'tree' });
        // One of them gone (deleted, or merged by a correction): the whole tree.
        expect(bookEntrySelection({ kind: 'menu' }, index, [vrb, 'gone' as RodId])).toEqual({ kind: 'tree' });
        // A small lineage is no choice of the dialog.
        expect(bookEntrySelection({ kind: 'menu' }, index, [ostr])).toEqual({ kind: 'tree' });
    });

    it('generations are clamped to 1–12', () => {
        expect([0, 1, 4.4, 12, 13, -3, NaN].map(clampBookGenerations)).toEqual([1, 1, 4, 12, 12, 1, 4]);
    });
});

describe('the saved book\'s file name', () => {
    it('is the title with .html; characters no file system takes become a dash, never an empty name', () => {
        expect(bookFileName('Rod Vrbovec')).toBe('Rod Vrbovec.html');
        expect(bookFileName('Předci: Bořivoj Vrbovec')).toBe('Předci- Bořivoj Vrbovec.html');
        expect(bookFileName('A/B\\C*?"<>|D')).toBe('A-B-C-D.html');
        expect(bookFileName('  two   spaces ')).toBe('two spaces.html');
        expect(bookFileName('tab\tand\nline')).toBe('tab-and-line.html');
        expect(bookFileName('...hidden.')).toBe('hidden.html');
        expect(bookFileName('')).toBe('book.html');
        expect(bookFileName('///')).toBe('book.html');
    });
});

describe('the estimate across generations', () => {
    const data = vrbovec();

    it('a book of descendants grows with its generations and says how many generations of families it spans', () => {
        const est = [1, 2, 3, 4, 12].map(g => estimateBook(data, opts({ selection: { kind: 'descendants', person: P('v1'), generations: g } })));
        // 1 = the children: the founder's family and his son's; the great-grandson (gen. 3) has no family of his own.
        expect(est.map(e => e.generations)).toEqual([2, 3, 3, 3, 3]);
        for (let i = 1; i < est.length; i++) {
            expect(est[i].persons).toBeGreaterThanOrEqual(est[i - 1].persons);
            expect(est[i].chapters).toBeGreaterThanOrEqual(est[i - 1].chapters);
            expect(est[i].pages).toBeGreaterThanOrEqual(est[i - 1].pages);
        }
        expect(est[0].chapters).toBe(2);
        expect(est[4].chapters).toBe(3);
        expect(est[4].persons).toBeGreaterThan(est[0].persons);
    });

    it('a book of ancestors as well', () => {
        const up = [1, 2, 3].map(g => estimateBook(data, opts({ selection: { kind: 'ancestors', person: P('v5'), generations: g } })));
        expect(up.map(e => e.persons)).toEqual([...up.map(e => e.persons)].sort((a, b) => a - b));
        expect(up[2].generations).toBeGreaterThan(up[0].generations);
    });

    it('every part off but the families: the estimate shrinks', () => {
        const none = Object.fromEntries(BOOK_PART_KEYS.map(k => [k, false])) as BookOptions['parts'];
        expect(estimateBook(data, opts({ parts: none })).pages).toBeLessThanOrEqual(estimateBook(data, opts()).pages);
    });
});

describe('other families: the dialog, the book and the tree overview count alike', () => {
    it('married-in wives without parents are not other families', () => {
        const data = vrbovec();
        const index = buildLineages(data);
        const other = otherFamilyRods(index).map(r => r.founderId);
        expect(other).toEqual([P('o1')]);
        expect(bookRodCounts(data, { index })).toEqual({ rods: 1, other: 1 });
        expect(buildBookModel(data, { kind: 'tree' }, index).smallRods.map(r => r.founderId)).toEqual([P('o1')]);
        // Three wives married in: three lineages of their own, none counted.
        expect(index.rods.size).toBe(5);
        const book = buildFamilyBook(data, opts({ privacy: 'full' }), { now: new Date('2026-10-31T12:00:00Z'), dateLabel: 'x' });
        const at = book.indexOf('id="book-small-rods"');
        const others = book.slice(at, book.indexOf('</section>', at));
        expect(others).toContain('Ostrožan');
        expect(others).not.toContain('Kvítková');
    });
});
