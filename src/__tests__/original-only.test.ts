/**
 * An attachment held only as its original by Strom Research (a TIFF, a HEIC,
 * a PDF over 2 MB): no preview in the tree, the file named by its hash. It
 * survives validation, goes to the research as an OBJE without data (the
 * file's name, FORM, `_STROM_SHA`) and comes back the same. Invented data.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { stripUnsafeMediaDataUrls, isOriginalOnlyAttachment } from '../validation.js';
import { StromData, Person, PersonId } from '../types.js';

const SHA = 'c'.repeat(64);

function tree(): StromData {
    const anna: Person = {
        id: 'p1' as PersonId, firstName: 'Anna', lastName: 'Víšková', gender: 'female', isPlaceholder: false,
        partnerships: [], parentIds: [],
        attachments: [{
            id: 'att1', name: 'matrika-1846.tif', mimeType: 'image/tiff', dataUrl: '', sizeBytes: 0, originalOnly: true,
            original: { sha256: SHA, name: 'matrika-1846.tif', mimeType: 'image/tiff', bytes: 148_000_000 },
        }],
    } as Person;
    return { version: 11, persons: { p1: anna }, partnerships: {} } as unknown as StromData;
}

describe('only-original attachments', () => {
    it('are kept by validation; an empty data URL without the mark is not', () => {
        const data = tree();
        expect(stripUnsafeMediaDataUrls(data)).toBe(0);
        expect(data.persons['p1' as PersonId].attachments).toHaveLength(1);
        const plain = tree();
        delete plain.persons['p1' as PersonId].attachments![0].originalOnly;
        expect(stripUnsafeMediaDataUrls(plain)).toBe(1);
        expect(isOriginalOnlyAttachment({ originalOnly: true, dataUrl: '', original: { sha256: 'nope' } })).toBe(false);
    });

    it('go to the research as an OBJE without data and come back the same', () => {
        const ged = exportToGedcom(tree(), 'Víškovi').content;
        const obje = ged.split('\n').slice(ged.split('\n').indexOf('1 OBJE'), ged.split('\n').indexOf('1 OBJE') + 6).join('\n');
        expect(obje).toContain('2 FORM tiff');
        expect(obje).toContain(`2 _STROM_SHA ${SHA}`);
        expect(obje).toContain('2 FILE matrika-1846.tif');
        expect(ged).not.toContain('data:');
        const back = convertToStrom(parseGedcom(ged)).data;
        const att = Object.values(back.persons)[0].attachments?.[0];
        expect(att).toMatchObject({ name: 'matrika-1846.tif', mimeType: 'image/tiff', dataUrl: '', originalOnly: true,
            original: { sha256: SHA, mimeType: 'image/tiff' } });
    });
});
