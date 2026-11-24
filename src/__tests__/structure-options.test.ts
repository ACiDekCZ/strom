/**
 * Change structure… (spec 139 §2.4): which options the dialog offers for a
 * tree and why a greyed one is greyed.
 */
import { describe, it, expect } from 'vitest';
import { structureOptions, isWhollyConnected, summarizeSubset, summarizeSubsetSteps, islandsOf, summarizeCopy, type StructureContext } from '../structure-options.js';
import type { PersonId, StromData } from '../types.js';
import { getStringsForLang } from '../strings.js';

const base: StructureContext = {
    isActive: true, readOnly: false, liveFollowing: false, otherTrees: true, connected: false,
};

function byKey(ctx: Partial<StructureContext>) {
    return Object.fromEntries(structureOptions({ ...base, ...ctx }).map(o => [o.key, o]));
}

describe('structureOptions', () => {
    it('lists all six options in the dialog order, grouped, with their direction', () => {
        const options = structureOptions(base);
        expect(options.map(o => `${o.group}/${o.key}/${o.dir}`)).toEqual([
            'newTree/select/new', 'newTree/copy/new',
            'split/families/split', 'split/parts/split',
            'join/into/into', 'join/file/file',
        ]);
        expect(options.every(o => o.enabled && !o.reason)).toBe(true);
    });

    it('a tree that is not open: the selection and the file need it open, the rest runs', () => {
        const o = byKey({ isActive: false });
        expect(o.select).toMatchObject({ enabled: false, reason: 'notOpen' });
        expect(o.file).toMatchObject({ enabled: false, reason: 'notOpen' });
        expect(o.copy.enabled).toBe(true);
        expect(o.families.enabled).toBe(true);
        expect(o.parts.enabled).toBe(true);
        expect(o.into.enabled).toBe(true);
    });

    it('a wholly connected tree has no separate parts', () => {
        const o = byKey({ connected: true });
        expect(o.parts).toMatchObject({ enabled: false, reason: 'connected' });
        expect(o.families.enabled).toBe(true);
    });

    it('while the parts are not counted yet, separating stays offered', () => {
        expect(byKey({ connected: null }).parts.enabled).toBe(true);
    });

    it('the only tree has nothing to join into', () => {
        const o = byKey({ otherTrees: false });
        expect(o.into).toMatchObject({ enabled: false, reason: 'noOther' });
        expect(o.file.enabled).toBe(true);
    });

    it('a followed tree cannot take a file; the reason offers to end following', () => {
        const o = byKey({ liveFollowing: true });
        expect(o.file).toMatchObject({ enabled: false, reason: 'followed', reasonAction: 'stopFollowing' });
        expect(o.select.enabled).toBe(true);
        expect(o.into.enabled).toBe(true);
    });

    it('a read-only tree has no dialog', () => {
        expect(structureOptions({ ...base, readOnly: true })).toEqual([]);
    });
});

describe('isWhollyConnected', () => {
    const person = (id: string, extra: Record<string, unknown> = {}) => ({
        id, firstName: id, lastName: 'Kalinovský', gender: 'male', isPlaceholder: false,
        parentIds: [], childIds: [], partnerships: [], ...extra,
    });

    it('two unrelated people are two parts', () => {
        const data = { persons: { a: person('a'), b: person('b') }, partnerships: {} } as unknown as StromData;
        expect(isWhollyConnected(data)).toBe(false);
    });

    it('a parent and a child are one family', () => {
        const data = {
            persons: { a: person('a', { childIds: ['b'] }), b: person('b', { parentIds: ['a'] }) },
            partnerships: {},
        } as unknown as StromData;
        expect(isWhollyConnected(data)).toBe(true);
    });

    it('an empty tree has nothing to separate', () => {
        expect(isWhollyConnected({ persons: {}, partnerships: {} } as unknown as StromData)).toBe(true);
    });
});

// ==================== §4 the summary before creating ====================

/**
 * The Ostrožní family: Jan + Marie (u1) have Petr and Eva; Petr + Lucie (u2)
 * have Tomáš; Eva + Karel (u3) have Hana. A pool reference (an image outside
 * memory) is Petr's portrait.
 */
function family(): StromData {
    const p = (id: string, first: string, extra: Record<string, unknown> = {}) => ({
        id, firstName: first, lastName: 'Ostrožní', gender: 'male', partnerships: [], parentIds: [], childIds: [], ...extra,
    });
    const persons: Record<string, unknown> = {
        jan: p('jan', 'Jan', { partnerships: ['u1'], childIds: ['petr', 'eva'], sourceIds: ['s1'] }),
        marie: p('marie', 'Marie', { gender: 'female', partnerships: ['u1'], childIds: ['petr', 'eva'] }),
        petr: p('petr', 'Petr', { parentIds: ['jan', 'marie'], partnerships: ['u2'], childIds: ['tomas'], photo: '\u0000sm:p:' + 'a'.repeat(40) }),
        eva: p('eva', 'Eva', { gender: 'female', parentIds: ['jan', 'marie'], partnerships: ['u3'], childIds: ['hana'] }),
        lucie: p('lucie', 'Lucie', { gender: 'female', partnerships: ['u2'], childIds: ['tomas'] }),
        karel: p('karel', 'Karel', { partnerships: ['u3'], childIds: ['hana'] }),
        tomas: p('tomas', 'Tomáš', { parentIds: ['petr', 'lucie'], events: [{ id: 'e1', type: 'occupation', sourceIds: ['s2'] }] }),
        hana: p('hana', 'Hana', { gender: 'female', parentIds: ['eva', 'karel'] }),
    };
    return {
        version: 1,
        persons,
        partnerships: {
            u1: { id: 'u1', person1Id: 'jan', person2Id: 'marie', childIds: ['petr', 'eva'], status: 'married', photo: 'data:image/jpeg;base64,AA' },
            u2: { id: 'u2', person1Id: 'petr', person2Id: 'lucie', childIds: ['tomas'], status: 'married', sourceIds: ['s3'] },
            u3: { id: 'u3', person1Id: 'eva', person2Id: 'karel', childIds: ['hana'], status: 'married' },
        },
        sources: {
            s1: { id: 's1', title: 'Matrika' }, s2: { id: 's2', title: 'Sčítání' }, s3: { id: 's3', title: 'Oddací' },
            s4: { id: 's4', title: 'Pozemková kniha' }, s5: { id: 's5', title: 'Nevyužitý' },
        },
        media: {
            m1: { id: 'm1', name: 'scan.jpg', mimeType: 'image/jpeg', dataUrl: '', places: [{ personId: 'hana' }] },
            m2: { id: 'm2', name: 'deed.pdf', mimeType: 'application/pdf', dataUrl: '', places: [{ personId: 'tomas' }, { sourceId: 's4' }] },
            m3: { id: 'm3', name: 'page.png', mimeType: 'image/png', dataUrl: '', places: [{ sourceId: 's4' }] },
            m4: { id: 'm4', name: 'karel.jpg', mimeType: 'image/jpeg', dataUrl: '', places: [{ personId: 'karel' }] },
        },
    } as unknown as StromData;
}

const ids = (...list: string[]) => new Set(list as PersonId[]);

describe('summarizeSubset', () => {
    it('counts couples by the creation rules: the partner of a couple with a selected child comes along', () => {
        // Tomáš alone pulls in nobody (no union of his); Petr + Tomáš glue Lucie in: couple u2.
        expect(summarizeSubset(family(), ids('tomas'))).toMatchObject({ persons: 1, couples: 0 });
        expect(summarizeSubset(family(), ids('petr', 'tomas'))).toMatchObject({ persons: 3, couples: 1 });
        // A couple without a selected child stays apart: Jan + Eva → no u1.
        expect(summarizeSubset(family(), ids('jan', 'karel'))).toMatchObject({ persons: 2, couples: 0 });
    });

    it('counts the cited sources, also as documents of the kept files; unused ones not', () => {
        // Petr + Tomáš (+ Lucie): s2 (Tomáš's event), s3 (u2), s4 (m2 is Tomáš's file and s4's document).
        expect(summarizeSubset(family(), ids('petr', 'tomas')).sources).toBe(3);
        expect(summarizeSubset(family(), ids('hana')).sources).toBe(0);
    });

    it('counts images by reference: portraits (also outside memory), couples\' photos and image files', () => {
        // Petr's pool portrait + m3 (the page of s4, kept with m2); m2 is a PDF.
        expect(summarizeSubset(family(), ids('petr', 'tomas')).images).toBe(2);
        // Jan, Marie, Petr, Eva: u1's couple photo + Petr's portrait.
        expect(summarizeSubset(family(), ids('jan', 'marie', 'petr', 'eva')).images).toBe(2);
        expect(summarizeSubset(family(), ids('hana')).images).toBe(1);
    });

    it('the separate parts: everyone but the largest part, with the person not selected who linked them', () => {
        // Jan, Marie, Petr, Tomáš (+ Lucie) hold together; Hana is linked to them only through Eva (not selected).
        const summary = summarizeSubset(family(), ids('jan', 'marie', 'petr', 'tomas', 'hana'));
        expect(summary.islands).toEqual([{ id: 'hana', via: 'eva' }]);
        expect(islandsOf(family(), ids('jan', 'marie', 'petr', 'tomas', 'hana'))).toEqual(summary.islands);
        // Karel with his selected daughter Hana glues Eva in, and Eva joins her father Jan: one part.
        expect(islandsOf(family(), ids('jan', 'hana', 'karel'))).toEqual([]);
        // Petr alone beside Hana's family: Petr is linked through his parents, Jan first on the way.
        expect(islandsOf(family(), ids('petr', 'eva', 'karel', 'hana'))).toEqual([{ id: 'petr', via: 'jan' }]);
        expect(islandsOf(family(), ids('jan', 'marie', 'petr', 'eva'))).toEqual([]);
    });

    it('a part that was separate in the tree already is not cut off by the selection', () => {
        const data = family();
        (data.persons as Record<string, unknown>).cizi = { id: 'cizi', firstName: 'Ota', lastName: 'Jesenský', gender: 'male', partnerships: [], parentIds: [], childIds: [] };
        expect(islandsOf(data, ids('jan', 'marie', 'cizi'))).toEqual([]);
    });

    it('counted in batches: yields the progress and ends with the same summary', () => {
        const data = family();
        const steps = summarizeSubsetSteps(data, ids('jan', 'marie', 'petr', 'eva', 'tomas', 'hana'), 2);
        const progress: string[] = [];
        let next = steps.next();
        while (!next.done) { progress.push(`${next.value.done}/${next.value.total}`); next = steps.next(); }
        // Lucie and Karel come along as glue: 8 people.
        expect(progress).toEqual(['2/8', '4/8', '6/8', '8/8', '8/8']);
        expect(next.value).toEqual(summarizeSubset(data, ids('jan', 'marie', 'petr', 'eva', 'tomas', 'hana')));
    });
});

describe('summarizeCopy', () => {
    it('counts the whole tree\'s sources and images by reference', () => {
        // Sources s1–s5; Petr's portrait, u1's photo, m1, m3, m4 (m2 is a PDF).
        expect(summarizeCopy(family())).toEqual({ sources: 5, images: 5 });
    });
});

// ==================== §3.3 / §4.3 the texts that count ====================


describe('the texts of who to take and the summary', () => {
    it('Czech: the generations and the people chosen by hand go by the count (1 / 2 / 5)', () => {
        const t = getStringsForLang('cs').structure;
        expect(t.whatAncestors('Josef Ostrožný', 1)).toBe('předci: Josef Ostrožný, 1 generace');
        expect(t.whatAncestors('Josef Ostrožný', 2)).toBe('předci: Josef Ostrožný, 2 generace');
        expect(t.whatAncestors('Josef Ostrožný', 5)).toBe('předci: Josef Ostrožný, 5 generací');
        expect(t.whatAncestors('Josef Ostrožný')).toBe('předci: Josef Ostrožný');
        expect(t.whatHand(1)).toBe('1 osoba vybraná ručně');
        expect(t.whatHand(2)).toBe('2 osoby vybrané ručně');
        expect(t.whatHand(5)).toBe('5 osob vybraných ručně');
        expect(t.stepOf(2, 3, t.stepWho)).toBe('krok 2 ze 3: koho vzít');
        expect(t.summaryLead(t.whatRod('Jesenský'))).toBe('Rod Jesenský – nový strom dostane:');
        expect(t.islands(1)).toBe('1 osoba je napojená jen přes nevybrané lidi a bude v novém stromu samostatně.');
        expect(t.islands(3)).toBe('3 osoby jsou napojené jen přes nevybrané lidi a budou v novém stromu samostatně.');
    });

    it('English, German and Polish', () => {
        const en = getStringsForLang('en').structure;
        expect(en.whatAncestors('Josef Ostrožný', 1)).toBe('ancestors: Josef Ostrožný, 1 generation');
        expect(en.whatAncestors('Josef Ostrožný', 4)).toBe('ancestors: Josef Ostrožný, 4 generations');
        expect(en.whatHand(1)).toBe('1 person chosen by hand');
        expect(en.whatHand(4)).toBe('4 people chosen by hand');
        const de = getStringsForLang('de').structure;
        expect(de.whatAncestors('Josef Ostrožný', 1)).toBe('Vorfahren: Josef Ostrožný, 1 Generation');
        expect(de.whatAncestors('Josef Ostrožný', 3)).toBe('Vorfahren: Josef Ostrožný, 3 Generationen');
        expect(de.whatHand(1)).toBe('1 von Hand gewählte Person');
        expect(de.whatHand(4)).toBe('4 von Hand gewählte Personen');
        const pl = getStringsForLang('pl').structure;
        expect(pl.whatAncestors('Josef Ostrožný', 1)).toBe('przodkowie: Josef Ostrožný, 1 pokolenie');
        expect(pl.whatAncestors('Josef Ostrožný', 2)).toBe('przodkowie: Josef Ostrožný, 2 pokolenia');
        expect(pl.whatAncestors('Josef Ostrožný', 5)).toBe('przodkowie: Josef Ostrožný, 5 pokoleń');
        expect(pl.whatHand(1)).toBe('1 osoba wybrana ręcznie');
        expect(pl.whatHand(3)).toBe('3 osoby wybrane ręcznie');
        expect(pl.whatHand(5)).toBe('5 osób wybranych ręcznie');
    });
});
