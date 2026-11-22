/**
 * A file of the research's material that becomes a file of the tree (linked
 * to a person, used as a portrait, a source's file) takes the sender's note
 * along: a send of the tree writes it as the file's NOTE. Without it the
 * send carried the file with no NOTE, which the research read as the note
 * taken off by the user (its commit refused, every write after it stuck).
 * And a NOTE of a file the research gave with the tree stays in the export.
 * Invented data.
 */
import { describe, it, expect } from 'vitest';
import { migrateData } from '../data.js';
import { exportToGedcom } from '../ged-exporter.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { allMedia } from '../media.js';
import { materialFileItem, materialRecordNote, parseMaterialFile } from '../materials.js';
import { materialAttachMethods } from '../ui/material-attach-ui.js';
import type { Attachment, StromData } from '../types.js';

const SHA = 'cd'.repeat(32);
const NOTE = 'od babičky z Lhoty – Семья 家族';

const person = (id: string, firstName: string, extra: Record<string, unknown> = {}) => ({
    id, firstName, lastName: 'Lindqvist', gender: 'male', isPlaceholder: false, refn: 'P0001',
    partnerships: [], parentIds: [], childIds: [], ...extra,
});

function treeWith(media: Record<string, Attachment>): StromData {
    return migrateData({ version: 24, persons: { p1: person('p1', 'Oskar') }, partnerships: {}, media } as never);
}

const load = (ged: string): StromData => migrateData(convertToStrom(parseGedcom(ged)).data as StromData);

/** A file of the research's material outside the tree, with the sender's notes and a note of whoever sorted it. */
function materialItem(mime: string, bytes: number) {
    const file = parseMaterialFile({
        id: 'I0109', sha: SHA, name: 'lhota.mp3', mime, bytes, persons: ['P0001'],
        notes: [
            { text: 'first word', at: '2026-11-21T16:30:00.000Z', by: 'user' },
            { text: NOTE, at: '2026-11-21T16:33:01.860Z', by: 'user' },
            { text: 'sorted as a recording', at: '2026-11-21T16:40:00.000Z', by: 'agent' },
        ],
    });
    expect(file).not.toBeNull();
    return materialFileItem(file!, { batches: [] });
}

describe('a file of the material linked into the tree keeps the sender\'s note', () => {
    it('the working copy carries the sender\'s last note (the one the research reads as the file\'s note)', async () => {
        const item = materialItem('audio/mpeg', 2048);
        expect(materialRecordNote(item)).toBe(NOTE);
        // A recording is linked as its original only: no fetch from the bridge.
        const record = await materialAttachMethods.materialWorkingCopy.call({} as never, item, { base: 'http://127.0.0.1:9/t' } as never);
        expect(record?.note).toBe(NOTE);
    });

    it('linked to a person, the send writes the note under its OBJE and reads it back', async () => {
        const item = materialItem('audio/mpeg', 2048);
        const record = await materialAttachMethods.materialWorkingCopy.call({} as never, item, { base: 'http://127.0.0.1:9/t' } as never);
        const data = treeWith({ att1: { ...record!, id: 'att1', places: [{ personId: 'p1' as never }] } as Attachment });
        const ged = exportToGedcom(data, 'T', { appMedia: true }).content;
        const obje = ged.slice(ged.indexOf('1 OBJE'), ged.indexOf('\n1 ', ged.indexOf('1 OBJE') + 1));
        expect(obje).toContain(`2 NOTE ${NOTE}`);
        expect(allMedia(load(ged)).map(a => a.note)).toEqual([NOTE]);
    });

    it('without a note of the sender: none (a sorter\'s note is not the file\'s note)', () => {
        const file = parseMaterialFile({ id: 'I0110', sha: SHA, name: 'a.jpg', persons: [], notes: [{ text: 'sorted', by: 'agent' }] });
        expect(materialRecordNote(materialFileItem(file!, { batches: [] }))).toBeUndefined();
    });
});

describe('a NOTE of a file the research gave with the tree stays in the export', () => {
    it('import with the NOTE under the OBJE, export: the same NOTE', () => {
        const long = `${NOTE} ${'slovo '.repeat(60)}konec`;
        // Cut inside a word, as a writer of CONC does (a line's edge spaces are not kept).
        const cut = long.indexOf('slovo', 100) + 2;
        const ged = [
            '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
            '0 @I1@ INDI', '1 NAME Oskar /Lindqvist/', '1 SEX M', '1 REFN P0001',
            '1 OBJE', '2 FORM jpeg', '2 TITL lhota.jpg', `2 NOTE ${long.slice(0, cut)}`, `3 CONC ${long.slice(cut)}`,
            `2 _STROM_SHA ${SHA}`, '2 FILE lhota.jpg',
            '0 TRLR',
        ].join('\n');
        const data = load(ged);
        expect(allMedia(data).map(a => a.note)).toEqual([long]);
        const back = load(exportToGedcom(data, 'T', { appMedia: true }).content);
        expect(allMedia(back).map(a => a.note)).toEqual([long]);
    });
});
