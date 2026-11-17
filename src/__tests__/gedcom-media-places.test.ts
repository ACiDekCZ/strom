/**
 * The tree's files in GEDCOM (spec 102): a file's title and kind, and its
 * places — a person, a person's birth, death or event, a couple, a
 * couple's event, a source — written and read back. One place is an OBJE
 * in place as before; several are one `0 @Mn@ OBJE` record linked from each.
 */
import { describe, it, expect } from 'vitest';
import { migrateData } from '../data.js';
import { exportToGedcom } from '../ged-exporter.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { allMedia } from '../media.js';
import { carryOverMedia } from '../research-link.js';
import type { Attachment, MediaPlace, StromData } from '../types.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg';
/** A distinct picture per name (files of the same data are one file). */
const png = (n: number): string => `${PNG}${'A'.repeat(n)}==`;
const SHA = 'ab'.repeat(32);

const person = (id: string, firstName: string, extra: Record<string, unknown> = {}) => ({
    id, firstName, lastName: 'Lindqvist', gender: 'male', isPlaceholder: false,
    partnerships: ['u1'], parentIds: [], childIds: [], ...extra,
});

function tree(media: Record<string, Partial<Attachment> & { places: MediaPlace[] }>): StromData {
    const files: Record<string, Attachment> = {};
    let n = 0;
    for (const [id, m] of Object.entries(media)) {
        n++;
        files[id] = { id, name: `file${n}.png`, mimeType: 'image/png', dataUrl: png(n), sizeBytes: 10, ...m } as Attachment;
    }
    return migrateData({
        version: 24,
        persons: {
            p1: person('p1', 'Oskar', { birthDate: '1890', deathDate: '1950', events: [{ id: 'e1', type: 'occupation', note: 'smith' }] }),
            p2: person('p2', 'Greta', { gender: 'female' }),
        },
        partnerships: {
            u1: { id: 'u1', person1Id: 'p1', person2Id: 'p2', status: 'married', childIds: [], events: [{ id: 'ce1', type: 'engagement', date: '1912' }] },
        },
        sources: { s1: { id: 's1', title: 'Parish register' } },
        media: files,
    } as never);
}

const exported = (data: StromData, appMedia = false): string => exportToGedcom(data, 'T', appMedia ? { appMedia: true } : {}).content;
const load = (ged: string): StromData => migrateData(convertToStrom(parseGedcom(ged)).data as StromData);

/** The files read back, their places named by the people, the events and the source (ids are new). */
function readBack(ged: string): { name: string; title?: string; kind?: string; places: string[] }[] {
    const back = load(ged);
    const who = (id: string) => back.persons[id as never]?.firstName ?? '?';
    const eventOf = (owner: { events?: { id: string; type: string }[] } | undefined, id: string) => owner?.events?.find(e => e.id === id)?.type ?? '?';
    const name = (pl: MediaPlace): string => {
        if ('personId' in pl) {
            return `${who(pl.personId)}${pl.fact ? `/${pl.fact}` : ''}${pl.eventId ? `/${eventOf(back.persons[pl.personId], pl.eventId)}` : ''}`;
        }
        if ('partnershipId' in pl) {
            const u = back.partnerships[pl.partnershipId];
            return `${who(u?.person1Id ?? '')}+${who(u?.person2Id ?? '')}${pl.eventId ? `/${eventOf(u, pl.eventId)}` : ''}`;
        }
        return back.sources?.[pl.sourceId]?.title ?? '?';
    };
    return allMedia(back).map(a => ({
        name: a.name, ...(a.title ? { title: a.title } : {}), ...(a.kind ? { kind: a.kind } : {}), places: a.places.map(name).sort(),
    })).sort((a, b) => a.name.localeCompare(b.name));
}

describe('GEDCOM: a file\'s title, kind and places (spec 102)', () => {
    it('a title goes as TITL with the name as _STROM_NAME, a kind as TYPE under FORM', () => {
        const ged = exported(tree({ m1: { title: 'Wedding day', kind: 'document', places: [{ personId: 'p1' as never }] } }));
        expect(ged).toContain('1 OBJE\n2 FORM png\n3 TYPE document\n2 TITL Wedding day\n2 _STROM_NAME file1.png\n');
        expect(readBack(ged)).toEqual([{ name: 'file1.png', title: 'Wedding day', kind: 'document', places: ['Oskar'] }]);
    });

    it('a file at the birth, the death and an event goes under them', () => {
        const ged = exported(tree({
            m1: { places: [{ personId: 'p1' as never, fact: 'birth' }] },
            m2: { places: [{ personId: 'p1' as never, fact: 'death' }] },
            m3: { places: [{ personId: 'p1' as never, eventId: 'e1' }] },
        }));
        expect(ged).toMatch(/\n1 BIRT\n(?:2 .*\n)*2 OBJE\n3 FORM png\n3 TITL file1\.png\n/);
        expect(ged).toMatch(/\n1 DEAT\n(?:2 .*\n)*2 OBJE\n3 FORM png\n3 TITL file2\.png\n/);
        expect(ged).toMatch(/\n1 OCCU smith\n(?:2 .*\n)*2 OBJE\n3 FORM png\n3 TITL file3\.png\n/);
        expect(readBack(ged)).toEqual([
            { name: 'file1.png', places: ['Oskar/birth'] },
            { name: 'file2.png', places: ['Oskar/death'] },
            { name: 'file3.png', places: ['Oskar/occupation'] },
        ]);
    });

    it('a file of a couple goes to its family marked not its photo, one of its event under the event', () => {
        const data = tree({
            m1: { places: [{ partnershipId: 'u1' as never }] },
            m2: { places: [{ partnershipId: 'u1' as never, eventId: 'ce1' }] },
        });
        for (const appMedia of [false, true]) {
            const ged = exported(data, appMedia);
            expect(ged).toMatch(/\n1 OBJE\n2 FORM png\n2 TITL file1\.png\n2 _PRIM N\n/);
            expect(ged).toMatch(/\n1 ENGA\n(?:2 .*\n)*2 OBJE\n3 FORM png\n3 TITL file2\.png\n/);
            const back = load(ged);
            expect(Object.values(back.partnerships)[0].photo).toBeUndefined();
            expect(readBack(ged)).toEqual([
                { name: 'file1.png', places: ['Oskar+Greta'] },
                { name: 'file2.png', places: ['Oskar+Greta/engagement'] },
            ]);
        }
    });

    it('with the couple\'s photo, the photo stays the photo and the file a file of the couple', () => {
        const data = tree({ m1: { places: [{ partnershipId: 'u1' as never }] } });
        data.partnerships['u1' as never].photo = png(9);
        const ged = exported(data, true);
        expect(ged).toContain('2 _PRIM Y');
        const back = load(ged);
        expect(Object.values(back.partnerships)[0].photo).toBe(png(9));
        expect(readBack(ged)).toEqual([{ name: 'file1.png', places: ['Oskar+Greta'] }]);
    });

    it('a file of a source alone goes to the source record, one also at a person as its _SOUR', () => {
        const ged = exported(tree({
            m1: { places: [{ sourceId: 's1' }] },
            m2: { places: [{ personId: 'p1' as never }, { sourceId: 's1' }] },
        }));
        expect(ged).toMatch(/\n0 @S\d+@ SOUR\n(?:[1-9] .*\n)*1 OBJE\n2 FORM png\n2 TITL file1\.png\n2 FILE /);
        expect(ged).toMatch(/\n1 OBJE\n2 FORM png\n2 TITL file2\.png\n2 _SOUR @S\d+@\n2 FILE /);
        const back = load(ged);
        expect(back.sources?.[Object.keys(back.sources!)[0]]?.excerpts ?? []).toEqual([]);
        expect(readBack(ged)).toEqual([
            { name: 'file1.png', places: ['Parish register'] },
            { name: 'file2.png', places: ['Oskar', 'Parish register'] },
        ]);
    });

    it('a file at two places is one media record linked from both, one record again', () => {
        const ged = exported(tree({
            m1: { title: 'Letter', kind: 'record', note: 'From the attic', places: [{ personId: 'p1' as never, eventId: 'e1' }, { partnershipId: 'u1' as never }, { personId: 'p2' as never }] },
        }));
        expect(ged).toMatch(/\n1 OCCU smith\n(?:2 .*\n)*2 OBJE @M1@\n/);
        expect(ged).toMatch(/\n1 OBJE @M1@\n2 _PRIM N\n/);
        expect(ged).toMatch(/\n0 @M1@ OBJE\n1 FILE data:image\/png;base64,[^\n]*\n(?:2 CONC .*\n)*2 FORM png\n3 TYPE record\n2 TITL Letter\n1 _STROM_NAME file1\.png\n1 NOTE From the attic\n/);
        expect(ged.indexOf('0 @M1@ OBJE')).toBeLessThan(ged.indexOf('0 TRLR'));
        expect(ged.match(/0 @M\d+@ OBJE/g)).toHaveLength(1);
        expect(readBack(ged)).toEqual([
            { name: 'file1.png', title: 'Letter', kind: 'record', places: ['Greta', 'Oskar+Greta', 'Oskar/occupation'] },
        ]);
    });

    it('the research\'s form (the same file in place at each place, by its hash) is one record', () => {
        const ged = [
            '0 HEAD', '1 SOUR STROM_RESEARCH', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
            '0 @I1@ INDI', '1 NAME Oskar /Lindqvist/', '1 SEX M', '1 BIRT', '2 DATE 1890',
            '2 OBJE', '3 FORM png', '4 TYPE photo', '3 TITL Baptism', '3 _STROM_NAME baptism.png', `3 _STROM_SHA ${SHA}`, `3 FILE ${png(3)}`,
            '1 OBJE', '2 FORM png', '2 TITL baptism.png', `2 _STROM_SHA ${SHA}`, `2 FILE ${png(3)}`,
            '1 FAMS @F1@',
            '0 @I2@ INDI', '1 NAME Greta /Lindqvist/', '1 SEX F', '1 FAMS @F1@',
            '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 MARR', '2 DATE 1912',
            '2 OBJE', '3 FORM png', '3 TITL vows.png', `3 FILE ${png(4)}`,
            '0 TRLR',
        ].join('\n');
        expect(readBack(ged)).toEqual([
            { name: 'baptism.png', title: 'Baptism', kind: 'photo', places: ['Oskar', 'Oskar/birth'] },
            { name: 'vows.png', places: ['Oskar+Greta'] },
        ]);
    });

    it('another program\'s OBJE under an event is not read as a file of the tree', () => {
        const ged = [
            '0 HEAD', '1 SOUR OTHERPROG', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
            '0 @I1@ INDI', '1 NAME Oskar /Lindqvist/', '1 SEX M', '1 BIRT', '2 DATE 1890',
            '2 OBJE', '3 FORM png', '3 TITL baptism.png', `3 FILE ${png(3)}`,
            '0 TRLR',
        ].join('\n');
        expect(readBack(ged)).toEqual([]);
    });

    it('an untitled file at one place is written as before, byte for byte', () => {
        const data = tree({ m1: { note: 'Register page', date: '1920', original: { sha256: SHA, name: 'file1.png', mimeType: 'image/png', bytes: 5 }, places: [{ personId: 'p1' as never }, { sourceId: 's1' }] } });
        const ged = exportToGedcom(data, 'T', { mediaDates: true }).content;
        const at = ged.indexOf('\n1 OBJE\n');
        const block = ged.slice(at + 1).split('\n');
        const end = block.findIndex((l, i) => i > 0 && /^[01] /.test(l));
        expect(block.slice(0, end).join('\n')).toBe([
            '1 OBJE',
            '2 FORM png',
            '2 TITL file1.png',
            '2 NOTE Register page',
            '2 _SOUR @S1@',
            `2 _STROM_SHA ${SHA}`,
            `2 FILE ${png(1)}`,
            '2 _DATE 1920',
        ].join('\n'));
        expect(ged).not.toContain('_STROM_NAME');
        expect(ged).not.toContain('_PRIM');
        expect(ged).not.toMatch(/@M\d+@/);
    });
});

describe('carryOverMedia keeps the places of a couple and of events (spec 102)', () => {
    it('a file at a couple\'s event and at a person\'s event the next version lacks comes back there', () => {
        const previous = tree({
            m1: { places: [{ partnershipId: 'u1' as never, eventId: 'ce1' }] },
            m2: { places: [{ personId: 'p1' as never, eventId: 'e1' }] },
        });
        const next: StromData = { ...previous, media: undefined };
        const { data } = carryOverMedia(next, previous);
        const places = allMedia(data).map(a => a.places).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        expect(places).toEqual([
            [{ partnershipId: 'u1', eventId: 'ce1' }],
            [{ personId: 'p1', eventId: 'e1' }],
        ]);
    });
});
