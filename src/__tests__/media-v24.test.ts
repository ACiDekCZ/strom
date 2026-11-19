/**
 * Data v24: the tree's files move from Person.attachments into
 * StromData.media, one record per file with its places (spec 102 §0).
 */
import { describe, it, expect } from 'vitest';
import { migrateData } from '../data.js';
import { exportToGedcom } from '../ged-exporter.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { personMedia, mediaSourceId, allMedia } from '../media.js';
import { STROM_DATA_VERSION, type PersonId, type StromData } from '../types.js';
import { ORIGINAL_ONLY_DATA_URL } from '../validation.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SHA = 'a'.repeat(64);

const pid = (id: string) => id as PersonId;

/** A tree as data v23 kept it: the files on the persons, a scan's source by `sourceId`. */
function v23Tree(): Record<string, unknown> {
    const person = (id: string, firstName: string, attachments?: unknown[]) => ({
        id, firstName, lastName: 'Lindqvist', gender: 'male', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [],
        ...(attachments ? { attachments } : {}),
    });
    return {
        version: 23,
        persons: {
            p1: person('p1', 'Oskar', [
                { id: 'a1', name: 'parish.png', mimeType: 'image/png', dataUrl: PNG, sizeBytes: 70, note: 'Register page', sourceId: 's1' },
                { id: 'a2', name: 'letter.png', mimeType: 'image/png', dataUrl: PNG2, sizeBytes: 70, date: '1901' },
            ]),
            p2: person('p2', 'Edvin', [
                // The same scan at a second person, under another id: one record with two places.
                { id: 'a3', name: 'parish copy.png', mimeType: 'image/png', dataUrl: PNG, sizeBytes: 70 },
            ]),
            p3: person('p3', 'Valter', []),
        },
        partnerships: {},
        sources: { s1: { id: 's1', title: 'Parish register' } },
    };
}

describe('data v24: StromData.media', () => {
    it('is in the current data version', () => {
        expect(STROM_DATA_VERSION).toBeGreaterThanOrEqual(24);
    });

    it('moves the attachments into records with their places, the source as a place', () => {
        const data = migrateData(v23Tree());
        for (const p of Object.values(data.persons)) expect('attachments' in p).toBe(false);
        const a1 = data.media?.a1;
        expect(a1?.places).toEqual([{ personId: 'p1' }, { sourceId: 's1' }, { personId: 'p2' }]);
        expect(a1 && 'sourceId' in a1).toBe(false);
        expect(a1?.note).toBe('Register page');
        expect(mediaSourceId(a1!)).toBe('s1');
        expect(data.media?.a2?.places).toEqual([{ personId: 'p1' }]);
        expect(data.media?.a2?.date).toBe('1901');
    });

    it('joins the same file at several persons into one record (the first id wins)', () => {
        const data = migrateData(v23Tree());
        expect(Object.keys(data.media ?? {})).toEqual(['a1', 'a2']);
        expect(personMedia(data, pid('p1')).map(a => a.id)).toEqual(['a1', 'a2']);
        expect(personMedia(data, pid('p2')).map(a => a.id)).toEqual(['a1']);
    });

    it('joins by the original hash, a record showing the file wins over an original only', () => {
        const tree = v23Tree();
        const persons = tree.persons as Record<string, { attachments?: unknown[] }>;
        persons.p2.attachments = [{
            id: 'only', name: 'parish.tif', mimeType: 'image/tiff', dataUrl: ORIGINAL_ONLY_DATA_URL, sizeBytes: 0,
            originalOnly: true, original: { sha256: SHA.toUpperCase(), mimeType: 'image/tiff', bytes: 9000 },
        }];
        persons.p3.attachments = [{
            id: 'shown', name: 'parish.jpg', mimeType: 'image/png', dataUrl: PNG2, sizeBytes: 70,
            original: { sha256: SHA, mimeType: 'image/tiff', bytes: 9000 },
        }];
        const data = migrateData(tree);
        const joined = allMedia(data).filter(a => a.original?.sha256.toLowerCase() === SHA);
        expect(joined).toHaveLength(1);
        expect(joined[0].originalOnly).toBeFalsy();
        expect(joined[0].dataUrl).toBe(PNG2);
        expect(personMedia(data, pid('p2')).map(a => a.id)).toEqual([joined[0].id]);
        expect(personMedia(data, pid('p3')).map(a => a.id)).toEqual([joined[0].id]);
    });

    it('keeps an original only as one', () => {
        const tree = v23Tree();
        (tree.persons as Record<string, { attachments?: unknown[] }>).p3.attachments = [{
            id: 'only', name: 'deed.tif', mimeType: 'image/tiff', dataUrl: ORIGINAL_ONLY_DATA_URL, sizeBytes: 0,
            originalOnly: true, original: { sha256: SHA, mimeType: 'image/tiff', bytes: 9000 },
        }];
        const data = migrateData(tree);
        expect(data.media?.only).toMatchObject({ originalOnly: true, places: [{ personId: 'p3' }] });
    });

    it('an empty list of attachments leaves no record and no media', () => {
        const tree = v23Tree();
        for (const p of Object.values(tree.persons as Record<string, { attachments?: unknown[] }>)) p.attachments = [];
        const data = migrateData(tree);
        expect(data.media).toBeUndefined();
        for (const p of Object.values(data.persons)) expect('attachments' in p).toBe(false);
    });

    it('points a portrait source and an excerpt at the joined record', () => {
        const tree = v23Tree();
        const persons = tree.persons as Record<string, Record<string, unknown>>;
        persons.p2.photo = PNG;
        persons.p2.photoSource = { attachmentId: 'a3', region: { x: 0, y: 0, w: 1, h: 1 } };
        (tree.sources as Record<string, Record<string, unknown>>).s1.excerpts = [
            { id: 'e1', dataUrl: PNG, width: 1, height: 1, fromAttachmentId: 'a3' },
        ];
        const data = migrateData(tree);
        expect(data.persons[pid('p2')].photoSource?.attachmentId).toBe('a1');
        expect(data.sources?.s1.excerpts?.[0].fromAttachmentId).toBe('a1');
    });

    it('a v23 tree goes to v24 and its GEDCOM reads back with the same files', () => {
        const data = migrateData(v23Tree());
        const ged = exportToGedcom(data).content;
        // The scan at two people is one media record with its source (spec 102), the letter in place as before.
        expect(ged).toMatch(/\n0 @M1@ OBJE\n(?:[1-9] .*\n)*1 _SOUR @S\d+@\n/);
        expect(ged.match(/\n1 OBJE @M1@\n/g)).toHaveLength(2);
        const back = migrateData(convertToStrom(parseGedcom(ged)).data as StromData);
        const byName = (first: string) => Object.values(back.persons).find(p => p.firstName === first)!;
        const files = (first: string) => personMedia(back, byName(first).id).map(a => ({
            name: a.name, note: a.note, date: a.date, source: mediaSourceId(a) ? back.sources?.[mediaSourceId(a)!]?.title : undefined,
        }));
        expect(files('Oskar')).toEqual([
            { name: 'parish.png', note: 'Register page', date: undefined, source: 'Parish register' },
            { name: 'letter.png', note: undefined, date: undefined, source: undefined },
        ]);
        expect(files('Edvin').map(f => f.name)).toEqual(['parish.png']);
        expect(files('Valter')).toEqual([]);
    });
});
