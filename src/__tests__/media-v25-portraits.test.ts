/**
 * Data v25: every portrait is in a record of the tree's files. A tree of
 * v24 and older kept a portrait made from a file only on its person; read
 * here, each portrait gets its person's place in the record of that picture
 * (verification of 3.30.0, N2).
 */
import { describe, it, expect } from 'vitest';
import { migrateData } from '../data.js';
import { exportToGedcom } from '../ged-exporter.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { getDemoTree, DEMO_FOCUS, type DemoImageMaker } from '../demo-tree.js';
import { personMedia, allMedia } from '../media.js';
import { countImages } from '../attachments.js';
import { type PersonId, type StromData } from '../types.js';
import { STROM_DATA_VERSION } from '../version.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const pid = (id: string) => id as PersonId;

const person = (id: string, firstName: string, extra: Record<string, unknown> = {}) => ({
    id, firstName, lastName: 'Lindqvist', gender: 'male', isPlaceholder: false,
    partnerships: [], parentIds: [], childIds: [], ...extra,
});

/** A tree as 3.29 (data v21) kept it: portraits on the persons, an attachment on Oskar. */
function v21Tree(): Record<string, unknown> {
    return {
        version: 21,
        persons: {
            p1: person('p1', 'Oskar', {
                photo: PNG, photoOriginalName: 'oskar.png', photoDate: '1901',
                attachments: [{ id: 'a1', name: 'letter.png', mimeType: 'image/png', dataUrl: PNG2, sizeBytes: 70 }],
            }),
            // The same picture as Oskar's portrait: one record with two places.
            p2: person('p2', 'Edvin', { photo: PNG }),
            p3: person('p3', 'Valter'),
        },
        partnerships: {},
    };
}

/** As a tree saved by 3.30 (data v24) kept it, then read here again. */
function stored(data: StromData, version: number): Record<string, unknown> {
    return { ...JSON.parse(JSON.stringify(data)), version };
}

const portraitRecords = (data: StromData) => allMedia(data).filter(a => a.dataUrl === PNG);

describe('data v25: every portrait is in a record of the files', () => {
    it('is the data version or older than it', () => {
        expect(STROM_DATA_VERSION).toBeGreaterThanOrEqual(25);
    });

    it('a v21 tree with portraits: one record of each picture with every person of it, kind photo, name and date kept', () => {
        const data = migrateData(v21Tree());
        const records = portraitRecords(data);
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ name: 'oskar.png', mimeType: 'image/png', dataUrl: PNG, kind: 'photo', date: '1901',
            places: [{ personId: 'p1' }, { personId: 'p2' }] });
        expect(records[0].sizeBytes).toBeGreaterThan(60);
        // Nothing lost: the portraits stay, the attachment stays its own record.
        expect(data.persons[pid('p1')].photo).toBe(PNG);
        expect(data.persons[pid('p2')].photo).toBe(PNG);
        expect(personMedia(data, pid('p1')).map(a => a.dataUrl)).toEqual([PNG2, PNG]);
        expect(personMedia(data, pid('p3'))).toEqual([]);
        expect(allMedia(data)).toHaveLength(2);
    });

    it('a v24 tree without the portrait\'s record gets it; read again (saved or not) no second one', () => {
        const v24 = stored(migrateData({ ...v21Tree(), persons: { p2: person('p2', 'Edvin', { photo: PNG }) } }), 24);
        delete v24.media;
        const once = migrateData(structuredClone(v24));
        expect(portraitRecords(once)).toHaveLength(1);
        // The same stored data read again (not saved yet): the same record, by its id.
        const again = migrateData(structuredClone(v24));
        expect(portraitRecords(again).map(a => a.id)).toEqual(portraitRecords(once).map(a => a.id));
        // Saved as v25 and read: unchanged. Read again as v24 (a backup put back): still one record.
        expect(portraitRecords(migrateData(stored(once, STROM_DATA_VERSION)))).toHaveLength(1);
        expect(portraitRecords(migrateData(stored(once, 24)))).toHaveLength(1);
        // The data read here, read again (they carry no version): nothing more.
        expect(allMedia(migrateData(once))).toHaveLength(1);
    });

    it('a portrait whose picture is a record already gets the person\'s place there, no second record', () => {
        const v24 = {
            version: 24,
            persons: { p1: person('p1', 'Oskar', { photo: PNG }), p2: person('p2', 'Edvin') },
            partnerships: {},
            media: { a9: { id: 'a9', name: 'scan.png', mimeType: 'image/png', dataUrl: PNG, sizeBytes: 70, places: [{ personId: 'p2' }] } },
        };
        const data = migrateData(v24);
        expect(allMedia(data)).toHaveLength(1);
        expect(data.media!.a9.places).toEqual([{ personId: 'p2' }, { personId: 'p1' }]);
    });

    it('a record taken out after the update is not made again', () => {
        const once = migrateData(stored(migrateData(v21Tree()), 21));
        const id = portraitRecords(once)[0].id;
        delete once.media![id];
        expect(portraitRecords(migrateData(stored(once, STROM_DATA_VERSION)))).toEqual([]);
    });

    it('a research tree: the portrait of a person the research gave is left to the archive, one added here gets its record', () => {
        const tree = {
            version: 24, researchAsOf: '2026-11-01',
            persons: { p1: person('p1', 'Oskar', { refn: 'I12', photo: PNG }), p2: person('p2', 'Edvin', { photo: PNG2 }) },
            partnerships: {},
        };
        const data = migrateData(tree);
        expect(allMedia(data).map(a => [a.dataUrl, a.places])).toEqual([[PNG2, [{ personId: 'p2' }]]]);
    });

    it('data without a version (a GEDCOM read, a research\'s version) are left as they are', () => {
        const { version: _v, ...noVersion } = v21Tree();
        expect(allMedia(migrateData(noVersion))).toHaveLength(1);
    });

    it('a GEDCOM export writes the portrait once at its person, not again as its record', () => {
        const data = migrateData(v21Tree());
        const ged = exportToGedcom(data, 'T').content;
        const objes = ged.split('\n').filter(l => /^1 OBJE/.test(l) || /^0 @[^@]+@ OBJE/.test(l));
        // Oskar: portrait + letter; Edvin: portrait. No record of the portrait besides.
        expect(objes).toHaveLength(3);
        expect(ged.match(/_STROM_KIND photo/g)).toHaveLength(2);
    });
});

describe('portraits that come in without a data update get their record too', () => {
    it('the sample tree: each drawn portrait is a record of kind photo at its person', () => {
        const jpeg = (n: number) => 'data:image/jpeg;base64,' + String.fromCharCode(65 + n).repeat(64);
        const maker: DemoImageMaker = {
            entry: (_text, n) => ({
                page: { dataUrl: jpeg(10 + n), width: 1000, height: 1300, sizeBytes: 48 },
                excerpt: { dataUrl: jpeg(20 + n), width: 920, height: 132, sizeBytes: 48 },
                region: { x: 0.04, y: 0.5, w: 0.92, h: 0.1 },
            }),
            portrait: seed => jpeg(seed),
        };
        const data = getDemoTree(maker);
        const withPhoto = Object.values(data.persons).filter(p => p.photo);
        expect(withPhoto).toHaveLength(4);
        for (const p of withPhoto) {
            const records = allMedia(data).filter(a => a.dataUrl === p.photo);
            expect(records).toHaveLength(1);
            expect(records[0]).toMatchObject({ kind: 'photo', mimeType: 'image/jpeg', places: [{ personId: p.id }] });
        }
        // Johan's register page stays his first file, his portrait's record beside it.
        expect(personMedia(data, DEMO_FOCUS).map(a => a.dataUrl)).toEqual([jpeg(11), data.persons[DEMO_FOCUS].photo]);
        // Without pictures nothing is made.
        expect(getDemoTree().media).toBeUndefined();
    });

    it('a GEDCOM import: a portrait gets its record, the same picture one record; exported again it is written once', () => {
        const ged = exportToGedcom(migrateData(v21Tree()), 'T').content;
        const imported = convertToStrom(parseGedcom(ged), { importOrigin: { at: '2026-11-19', file: 't.ged' } }).data;
        const [oskar, edvin] = ['Oskar', 'Edvin'].map(n => Object.values(imported.persons).find(p => p.firstName === n)!);
        expect(oskar.photo).toBe(PNG);
        expect(edvin.photo).toBe(PNG);
        const records = portraitRecords(imported);
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ kind: 'photo', name: 'oskar.png', mimeType: 'image/png' });
        expect(records[0].places.map(pl => 'personId' in pl && pl.personId)).toEqual([oskar.id, edvin.id]);
        expect(allMedia(imported)).toHaveLength(2);
        // The import's summary counts the picture once, as the portraits it is (the letter a document).
        expect(countImages(imported)).toMatchObject({ photos: 2, attachments: 1 });
        // Loaded (no data update to make) and exported again: the portrait once at each person.
        const again = exportToGedcom(migrateData(imported), 'T').content;
        expect(again.match(/_STROM_KIND photo/g)).toHaveLength(2);
        expect(allMedia(migrateData(imported))).toHaveLength(2);
    });

    it('a GEDCOM read for a research (no import of a file) is left as it comes', () => {
        const ged = exportToGedcom(migrateData(v21Tree()), 'T').content;
        const read = convertToStrom(parseGedcom(ged)).data;
        expect(portraitRecords(read)).toEqual([]);
    });
});
