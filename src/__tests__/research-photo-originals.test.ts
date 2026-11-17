/**
 * The originals of a portrait and of a couple's photo kept by the archive
 * (spec 108 K2.4, Strom Research 1.35): a couple's original goes as
 * `PUT /media` with `X-Strom-Family` (only to a research with
 * `accepts.media.family` and `material.links`), waits for the couple's
 * number, and its photo names it by `_STROM_SHA` under the FAM; a portrait's
 * new file is the original of the person's attachment (same gate). An older
 * research: nothing of it, as before. Plus the files a version with the
 * tree's files left out of the archive: one write with them is due again
 * (researchMediaSentAfterReturn). Invented data only.
 */
import { describe, it, expect } from 'vitest';
import { originalTargets, uploadHeaders, takesPortraitOriginals, takesCoupleOriginals } from '../originals.js';
import { carryOverMedia, researchMediaSentAfterReturn, researchMediaFirstSendDue, sanitizeAccepts } from '../research-link.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { MediaOriginal, Partnership, PartnershipId, StromData } from '../types.js';

const b64 = (bytes: number[]): string => btoa(String.fromCharCode(...bytes));
/** A JPEG header (SOI + APP0 + SOF0) claiming the given size. */
function jpegDataUrl(width: number, height: number): string {
    const app0 = [0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
    const sof0 = [0xFF, 0xC0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3,
        1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
    return 'data:image/jpeg;base64,' + b64([0xFF, 0xD8, ...app0, ...sof0, 0xFF, 0xD9]);
}
const COUPLE_JPEG = jpegDataUrl(1600, 1067);
const SHA = 'c0ffee'.padEnd(64, '7');
const ORIGINAL: MediaOriginal = { sha256: SHA, name: 'svatba 1911 💍.tif', mimeType: 'image/tiff', bytes: 48_000_000, orientation: 6 };

const COUPLE = `0 HEAD
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Hostivít /Řeřichal/
1 SEX M
1 DEAT Y
1 FAMS @F3@
0 @I2@ INDI
1 NAME Vratislava /Kmínová/
1 SEX F
1 DEAT Y
1 FAMS @F3@
0 @F3@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1911
`;

const load = (text: string): StromData => migrateData(convertToStrom(parseGedcom(text)).data);
function onlyCouple(data: StromData): Partnership {
    const all = Object.values(data.partnerships);
    expect(all).toHaveLength(1);
    return all[0];
}
/** The lines of the FAM records. */
const famRecords = (ged: string): string[][] => ged.split(/\r?\n(?=0 )/)
    .map(r => r.split(/\r?\n/).filter(l => l !== ''))
    .filter(r => / FAM$/.test(r[0]));

/** `/status.accepts` of Strom Research 1.35 (couple's originals) and of an older one. */
const ACCEPTS_135 = sanitizeAccepts({ sync: { auto: 'write' }, media: { max: 1e9, region: true, family: true } });
const ACCEPTS_OLDER = sanitizeAccepts({ sync: { auto: 'write' }, media: { max: 1e9, region: true } });

describe('which research keeps the originals of portraits and couples’ photos (K2.4)', () => {
    it('accepts.media.family is read from the bridge’s answer', () => {
        expect(ACCEPTS_135?.mediaFamily).toBe(true);
        expect(ACCEPTS_OLDER?.mediaFamily).toBeUndefined();
    });

    it('a couple’s original: accepts.media.family with material.links; its status not asked yet: what it said it takes', () => {
        expect(takesCoupleOriginals(ACCEPTS_135, ['media.app', 'material.links'])).toBe(true);
        expect(takesCoupleOriginals(ACCEPTS_135, null)).toBe(true);
        // A research whose status says no material.links (gone back to an older version), or without the family.
        expect(takesCoupleOriginals(ACCEPTS_135, ['media.app'])).toBe(false);
        expect(takesCoupleOriginals(ACCEPTS_OLDER, ['material.links'])).toBe(false);
        expect(takesCoupleOriginals(ACCEPTS_OLDER, null)).toBe(false);
        expect(takesCoupleOriginals(null, ['material.links'])).toBe(false);
        expect(takesCoupleOriginals({ media: false, mediaFamily: true }, ['material.links'])).toBe(false);
    });

    it('a portrait’s original as the attachment’s: material.links; not asked yet: accepts.media.family; an older research: no', () => {
        expect(takesPortraitOriginals(ACCEPTS_135, ['material.links'])).toBe(true);
        expect(takesPortraitOriginals(ACCEPTS_OLDER, ['material.links'])).toBe(true);
        expect(takesPortraitOriginals(ACCEPTS_135, null)).toBe(true);
        expect(takesPortraitOriginals(ACCEPTS_OLDER, null)).toBe(false);
        expect(takesPortraitOriginals(ACCEPTS_135, ['media.app'])).toBe(false);
        expect(takesPortraitOriginals(ACCEPTS_OLDER, [])).toBe(false);
        expect(takesPortraitOriginals(null, ['material.links'])).toBe(false);
    });
});

describe('a couple’s original to the research (PUT /media with X-Strom-Family)', () => {
    const U = 'u_1' as PartnershipId;
    const data = (researchId?: string): StromData => ({
        persons: {},
        partnerships: { [U]: { id: U, person1Id: 'p_a', person2Id: 'p_b', childIds: [], status: 'married', photo: COUPLE_JPEG,
            ...(researchId ? { researchId } : {}) } as never },
    });

    it('the couple’s number in the research is the target; without one it waits (not gone); the couple gone: dropped', () => {
        expect(originalTargets({ partnershipId: U }, data('F0003'))).toEqual({ ready: true, gone: false, family: 'F0003' });
        expect(originalTargets({ partnershipId: U }, data())).toEqual({ ready: false, gone: false });
        expect(originalTargets({ partnershipId: U }, { persons: {}, partnerships: {} })).toEqual({ ready: false, gone: true });
        // A person's original as ever.
        expect(originalTargets({ personId: 'p_x' as never }, { persons: { p_x: { refn: 'P0007' } }, partnerships: {} } as never))
            .toEqual({ ready: true, gone: false, person: 'P0007' });
    });

    it('the headers: the family, the name, the type; never the family beside a source or a task (media.bad-header)', () => {
        const rec = { mimeType: 'image/tiff', name: ORIGINAL.name };
        const h = uploadHeaders(rec, { family: 'F0003', region: true });
        expect(h).toEqual({ 'Content-Type': 'image/tiff', 'X-Strom-Name': encodeURIComponent(ORIGINAL.name), 'X-Strom-Family': 'F0003' });
        expect(uploadHeaders(rec, { family: 'F0003', source: 'S0001' })['X-Strom-Family']).toBeUndefined();
        expect(uploadHeaders(rec, { family: 'F0003', task: 'T0004' })['X-Strom-Family']).toBeUndefined();
        // A person's original: no family header, as before.
        expect(Object.keys(uploadHeaders(rec, { person: 'P0001' })).sort()).toEqual(['Content-Type', 'X-Strom-Name', 'X-Strom-Person']);
    });
});

describe('the couple’s photo names its original in the file (`_STROM_SHA` under the FAM)', () => {
    function tree(original?: MediaOriginal): StromData {
        const data = load(COUPLE + '0 TRLR\n');
        const union = onlyCouple(data);
        union.photo = COUPLE_JPEG;
        union.photoOriginalName = ORIGINAL.name;
        if (original) union.photoOriginal = original;
        return data;
    }

    it('written with its orientation, and read back onto the couple (the research gives it back so)', () => {
        const ged = exportToGedcom(tree(ORIGINAL), 'T', { appMedia: true }).content;
        const [fam] = famRecords(ged);
        const obje = fam.slice(fam.indexOf('1 OBJE'));
        expect(obje).toContain(`2 _STROM_SHA ${SHA}`);
        expect(obje).toContain('2 _STROM_ORIENT 6');
        expect(obje).toContain('2 _PRIM Y');
        const back = onlyCouple(load(ged));
        expect(back.photo).toBe(COUPLE_JPEG);
        expect(back.photoOriginal).toEqual({ sha256: SHA, name: ORIGINAL.name, mimeType: 'image/jpeg', bytes: 0, orientation: 6 });
    });

    it('a photo without an original (an older research, a tree without one): no hash, as before', () => {
        const ged = exportToGedcom(tree(), 'T', { appMedia: true }).content;
        expect(famRecords(ged)[0].some(l => l.includes('_STROM_SHA'))).toBe(false);
        expect(onlyCouple(load(ged)).photoOriginal).toBeUndefined();
    });

    it('an update without the photo carries it with its original; the same photo back without the hash keeps it named', () => {
        const previous = tree(ORIGINAL);
        const without = structuredClone(previous);
        const u = onlyCouple(without);
        delete u.photo; delete u.photoOriginal; delete u.photoOriginalName;
        const carried = carryOverMedia(without, previous);
        expect(carried.carried).toBe(1);
        expect(onlyCouple(carried.data).photoOriginal).toEqual(ORIGINAL);

        const sameNoHash = structuredClone(previous);
        delete onlyCouple(sameNoHash).photoOriginal;
        const kept = carryOverMedia(sameNoHash, previous);
        expect(kept.carried).toBe(0);
        expect(onlyCouple(kept.data).photoOriginal).toEqual(ORIGINAL);
    });
});

describe('files of the tree a version with its files left out of the archive (point 4 of the 108 U8 package)', () => {
    it('nothing carried: the archive holds them all, no write due; some carried: one write with them is due again', () => {
        expect(researchMediaSentAfterReturn('r1', 0)).toBe('r1');
        expect(researchMediaSentAfterReturn('r1', 2)).toBeUndefined();
        const due = (carried: number) => researchMediaFirstSendDue({ declares: true, hasMedia: true, researchId: 'r1',
            sentTo: researchMediaSentAfterReturn('r1', carried) });
        expect(due(0)).toBe(false);
        expect(due(1)).toBe(true);
        // An older research (the write does not say it carries every file): never due.
        expect(researchMediaFirstSendDue({ declares: false, hasMedia: true, researchId: 'r1', sentTo: researchMediaSentAfterReturn('r1', 1) })).toBe(false);
    });
});
