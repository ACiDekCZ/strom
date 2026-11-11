/**
 * A large tree's pages (1102 §7, §8): the size verdict of a whole tree of
 * thousands of people, the people with only a name and years without a page
 * of their own, the indexes split by letters, the set of files' folders in
 * each language, its stable and relative paths, and the time the save takes.
 * Built on the invented synthetic tree.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    PAGE_SET_FOLDERS, PAGE_SET_INDEX_LETTER_ROWS, PAGE_SET_MINIMAL_FROM_PAGES, PAGE_SET_MS_PER_IMAGE, PAGE_SET_MS_PER_PAGE,
    PageSet, ZIP_PICK_LINES, buildPageSet, estimatePageSetSize, indexLetter, isMinimalPerson, isProtectedPerson, pageSetLivingNames, pageSetPath, sizeVerdict,
} from '../family-pages.js';
import { buildPageSetFilesAsync } from '../family-pages-html.js';
import { Person, PersonId, StromData } from '../types.js';
import { ZipEntry, ZipWriter, buildZip } from '../zip.js';
import { syntheticTree } from './helpers/synthetic-tree.js';
import { resolveIn } from './family-pages-zip.test.js';

const NOW = new Date(2026, 10, 2);

function treeSet(data: StromData, extra: Partial<Parameters<typeof buildPageSet>[2]> = {}): PageSet {
    return buildPageSet(data, { kind: 'tree' }, { lang: 'cs', now: NOW, ...extra });
}

function text(e: ZipEntry): string {
    return typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
}

/** A copy of a synthetic tree with some surnames that start with Ch and Č (invented names). */
function lettersTree(persons: number): StromData {
    const { data } = syntheticTree({ persons });
    const ps = Object.values(data.persons) as Person[];
    ps.forEach((p, i) => {
        if (i % 7 === 0) p.lastName = 'Chvostánek';
        else if (i % 11 === 0) p.lastName = 'Čtverák';
    });
    return data;
}

/** A safety net for a loaded machine (the full suite with other runs beside it); the tests check no time. */
const LOADED_TIMEOUT = { timeout: 60_000 };

describe('a whole tree of about 4800 people (1102 §7.1, §7.3)', LOADED_TIMEOUT, () => {
    let data: StromData;
    let full: PageSet;
    let minimal: PageSet;
    beforeAll(() => {
        data = syntheticTree({ persons: 4800 }).data;
        full = treeSet(data);
        minimal = treeSet(data, { minimal: true });
    }, 120_000);

    it('is a set of files, with an estimate of its size and time', () => {
        const size = estimatePageSetSize(full);
        expect(size.pages).toBe(full.pages.length);
        expect(size.pages).toBeGreaterThan(PAGE_SET_MINIMAL_FROM_PAGES);
        expect(sizeVerdict(size.bytes)).toBe('set');
        // The set of files carries every file's head and bar: more than the single file.
        expect(size.zipBytes).toBeGreaterThan(size.bytes);
        expect(size.mb).toBeCloseTo(size.bytes / 1e6, 6);
        expect(size.textMb).toBeCloseTo(size.textBytes / 1e6, 6);
    });

    it('the seconds: pages and reduced images by the device, a phone six times slower', () => {
        const desk = estimatePageSetSize(full, { device: 'desktop' });
        const phone = estimatePageSetSize(full, { device: 'phone' });
        expect(desk.seconds).toBeCloseTo(full.pages.length * PAGE_SET_MS_PER_PAGE.desktop / 1000, 6);
        expect(phone.seconds).toBeCloseTo(full.pages.length * PAGE_SET_MS_PER_PAGE.phone / 1000, 6);
        expect(PAGE_SET_MS_PER_PAGE.phone / PAGE_SET_MS_PER_PAGE.desktop).toBeCloseTo(6, 6);
        expect(PAGE_SET_MS_PER_IMAGE.phone / PAGE_SET_MS_PER_IMAGE.desktop).toBeCloseTo(6, 6);
        // Without images the estimate is the pages alone; a reduction adds the images' time.
        expect(estimatePageSetSize(full, { photos: 'small', clips: 'small' }).seconds).toBeGreaterThanOrEqual(desk.seconds);
    });

    it('the people with only a name and years lose their pages and nothing else', () => {
        expect(minimal.minimalIds.size).toBeGreaterThan(0);
        expect([...full.minimalIds]).toEqual([...minimal.minimalIds]);
        expect(full.pages.length - minimal.pages.length).toBe(minimal.minimalIds.size);
        for (const id of minimal.minimalIds) {
            expect(isMinimalPerson(data.persons[id]!)).toBe(true);
            expect(minimal.personSlug.has(id)).toBe(false);
            expect(full.personSlug.has(id)).toBe(true);
        }
        expect(estimatePageSetSize(minimal).bytes).toBeLessThan(estimatePageSetSize(full).bytes);
        // The families and lines stay the same.
        expect([...minimal.familySlug.keys()]).toEqual([...full.familySlug.keys()]);
        expect(minimal.rodIds).toEqual(full.rodIds);
    });

    it('the predicate: a name and years only; a place, an event, a story, a photo, a note or a source give a page', () => {
        const base = { id: 'x' as PersonId, firstName: 'Ivo', lastName: 'Testák', gender: 'male', partnerships: [], parentIds: [], childIds: [], birthDate: '1801', deathDate: '1850' } as unknown as Person;
        expect(isMinimalPerson(base)).toBe(true);
        expect(isMinimalPerson({ ...base, birthPlace: 'Smyslenov' })).toBe(false);
        expect(isMinimalPerson({ ...base, deathPlace: 'Smyslenov' })).toBe(false);
        expect(isMinimalPerson({ ...base, events: [{ type: 'residence' }] } as unknown as Person)).toBe(false);
        expect(isMinimalPerson({ ...base, story: { text: 'Mlynář.' } } as unknown as Person)).toBe(false);
        expect(isMinimalPerson({ ...base, notes: 'Poznámka' })).toBe(false);
        expect(isMinimalPerson({ ...base, notes: '   ' })).toBe(true);
    });
});

describe('the indexes split by letters (1102 §7.4)', LOADED_TIMEOUT, () => {
    it('more than 500 rows: a page per letter, Ch after H and Č apart from C, every row on one letter page', () => {
        const set = treeSet(lettersTree(1400));
        const letters = set.indexLetters.persons;
        expect(letters.length).toBeGreaterThan(1);
        expect(letters.reduce((a, l) => a + l.rows, 0)).toBeGreaterThan(PAGE_SET_INDEX_LETTER_ROWS);
        const keys = letters.map(l => l.key);
        expect(keys).toContain('Ch');
        expect(keys).toContain('Č');
        const slugs = new Map(letters.map(l => [l.key, l.slug]));
        expect(slugs.get('Ch')).toBe('rejstrik-osoby-ch');
        expect(slugs.get('Č')).toBe('rejstrik-osoby-c-hacek');
        // Ch comes after H in Czech, Č after C.
        if (keys.includes('H')) expect(keys.indexOf('Ch')).toBeGreaterThan(keys.indexOf('H'));
        // The index's link leads to the first letter; every letter is a page of its own.
        expect(set.indexSlug.persons).toBe(letters[0].slug);
        for (const l of letters) expect(set.bySlug.get(l.slug)).toMatchObject({ kind: 'index', id: 'persons', letter: l.key });
        expect(pageSetPath(set, slugs.get('Č')!)).toBe('rejstrik/osoby-c-hacek.html');
    }, 60_000);

    it('a small tree keeps one page per index', () => {
        const set = treeSet(syntheticTree({ persons: 300, founders: 20 }).data);
        expect(set.indexLetters.persons).toEqual([]);
        expect(set.bySlug.get(set.indexSlug.persons)?.letter).toBeUndefined();
    });

    it('the letters by language: Ch only in Czech, Ä with A in German, Č apart in Czech', () => {
        expect(indexLetter('Chvostánek', 'cs')).toBe('Ch');
        expect(indexLetter('Chvostánek', 'en')).toBe('C');
        expect(indexLetter('Čtverák', 'cs')).toBe('Č');
        expect(indexLetter('Ärmling', 'de')).toBe('A');
        expect(indexLetter('Ábelík', 'cs')).toBe('A');
    });
});

describe('the set of files of a large tree (1102 §7.5, §8)', LOADED_TIMEOUT, () => {
    let set: PageSet;
    let entries: ZipEntry[];
    beforeAll(async () => {
        set = treeSet(lettersTree(900));
        entries = await buildPageSetFilesAsync(set);
    }, 120_000);

    it('index.html alone at the top, every page in its language\'s folder, ASCII lower case', () => {
        const paths = entries.map(e => e.path);
        expect(paths.filter(p => !p.includes('/'))).toEqual(['index.html']);
        expect(new Set(paths).size).toBe(paths.length);
        const f = PAGE_SET_FOLDERS.cs;
        const allowed = new Set(Object.values(f));
        for (const p of paths) {
            expect(p, p).toMatch(/^[a-z0-9_./-]+$/);
            if (p.includes('/')) expect(allowed.has(p.split('/')[0]), p).toBe(true);
        }
        expect(paths.some(p => p.startsWith(`${f.persons}/`))).toBe(true);
        expect(paths.some(p => p.startsWith(`${f.families}/`))).toBe(true);
        expect(paths.some(p => p.startsWith(`${f.rods}/`))).toBe(true);
        expect(paths.some(p => p.startsWith(`${f.index}/osoby-`))).toBe(true);
    });

    it('every relative link leads to a file of the set; nothing from the network', () => {
        const files = new Set(entries.map(e => e.path));
        for (const e of entries.filter(x => x.path.endsWith('.html') || x.path.endsWith('.css'))) {
            const t = text(e);
            for (const m of t.matchAll(/(?:href|src)="([^"#]+)"/g)) {
                // A link out (the app's home page) is a plain link; nothing loads from the network.
                if (/^(?:mailto:|https?:)/.test(m[1])) continue;
                if (/\.(?:html|css|js|jpg|png)$/.test(m[1])) expect(files.has(resolveIn(e.path, m[1])), `${e.path} → ${m[1]}`).toBe(true);
            }
            for (const m of t.matchAll(/url\("?([^")]+)"?\)/g)) {
                if (m[1].startsWith('data:') || m[1].startsWith('#')) continue;
                expect(m[1], e.path).not.toMatch(/^(?:https?:)?\/\//);
            }
            expect(t, e.path).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)="(?:https?:)?\/\//);
        }
    });

    it('the same tree gives the same paths', async () => {
        const again = await buildPageSetFilesAsync(treeSet(lettersTree(900)));
        expect(again.map(e => e.path)).toEqual(entries.map(e => e.path));
    }, 120_000);

    it('no protected person has a page or a path', () => {
        const prot = [...set.protectedTree.living].filter(id => isProtectedPerson(set.protectedTree, id));
        expect(prot.length).toBeGreaterThan(0);
        expect(pageSetLivingNames(set).length).toBeGreaterThan(0);
        for (const id of prot) expect(set.personSlug.has(id), id).toBe(false);
        const personPaths = new Set([...set.personSlug.values()].map(slug => pageSetPath(set, slug)));
        for (const e of entries.filter(x => x.path.startsWith('osoby/'))) expect(personPaths.has(e.path), e.path).toBe(true);
    });

    it('the folders follow the language', async () => {
        const small = syntheticTree({ persons: 400, founders: 20 }).data;
        for (const lang of ['en', 'de'] as const) {
            const s = buildPageSet(small, { kind: 'tree' }, { lang, now: NOW });
            const paths = (await buildPageSetFilesAsync(s)).map(e => e.path);
            const f = PAGE_SET_FOLDERS[lang];
            expect(paths.some(p => p.startsWith(`${f.files}/`) && p.endsWith('.css')), lang).toBe(true);
            expect(paths.some(p => p.startsWith(`${f.persons}/`)), lang).toBe(true);
            expect(paths.some(p => p.startsWith(`${f.index}/`)), lang).toBe(true);
            expect(paths.filter(p => !p.includes('/'))).toEqual(['index.html']);
        }
    }, 120_000);
});

describe('the choice of a line in a set of many lines (1102 §7.5)', () => {
    it('the full choice on the introduction and the line pages, a short one on the people\'s pages', async () => {
        const data = syntheticTree({ persons: 2500 }).data;
        const set = treeSet(data);
        expect(set.rodIds.length).toBeGreaterThan(ZIP_PICK_LINES);
        const entries = await buildPageSetFilesAsync(set);
        const by = new Map(entries.map(e => [e.path, text(e)]));
        const items = (html: string): number => (html.match(/<li class="sp-rodpick-/g) ?? []).length;
        const intro = by.get('index.html')!;
        const person = entries.find(e => e.path.startsWith('osoby/'))!;
        const p = by.get(person.path)!;
        expect(items(p)).toBeLessThan(items(intro));
        expect(items(p)).toBeLessThanOrEqual(3);
        // The estimate keeps above the files.
        const bytes = entries.reduce((a, e) => a + (typeof e.data === 'string' ? new TextEncoder().encode(e.data).length : e.data.length), 0);
        expect(estimatePageSetSize(set).zipBytes).toBeGreaterThan(bytes * 0.9);
    }, 120_000);
});

describe('the archive written an entry at a time (1102 §7.5)', LOADED_TIMEOUT, () => {
    it('ZipWriter in parts gives the same bytes as buildZip', () => {
        const when = new Date(2026, 0, 2, 3, 4, 6);
        const entries: ZipEntry[] = [{ path: 'index.html', data: '<p>Ahoj</p>' }, { path: 'osoby/a.html', data: new Uint8Array([1, 2, 3]) }];
        const parts: Uint8Array[] = [];
        const w = new ZipWriter(p => { parts.push(p); }, when);
        for (const e of entries) w.add(e.path, e.data);
        w.finish();
        expect(w.count).toBe(2);
        const joined = new Uint8Array(w.bytes);
        let at = 0;
        for (const p of parts) { joined.set(p, at); at += p.length; }
        expect([...joined]).toEqual([...buildZip(entries, when)]);
    });
});
