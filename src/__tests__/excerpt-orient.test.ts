/**
 * A crop Strom Research sends back lies as its original is stored; with the
 * original's EXIF orientation (`2 _STROM_ORIENT 2–8` after `_STROM_SHA`) the
 * app shows it upright. The image stays as the research sent it (the tree
 * goes back unchanged); only the URL it is shown by carries an EXIF block.
 * Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { excerptImageUrl, withExifOrientation, imageSizeFromDataUrl } from '../excerpts.js';
import { exifOrientation } from '../originals.js';

/** A JPEG head of `width` × `height` (JFIF, a frame header, the end) — enough for the header readers. */
function tinyJpeg(width: number, height: number, exif?: number): string {
    const bytes = [0xFF, 0xD8,
        0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
    if (exif) {
        bytes.push(0xFF, 0xE1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
            0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01,
            0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, exif, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00);
    }
    bytes.push(0xFF, 0xC0, 0x00, 0x11, 0x08, height >> 8, height & 0xFF, width >> 8, width & 0xFF,
        0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xFF, 0xD9);
    return `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;
}

const bytesOf = (dataUrl: string): Uint8Array => new Uint8Array(Buffer.from(dataUrl.split(',')[1], 'base64'));

const SHA = 'b'.repeat(64);
const CROP = tinyJpeg(400, 100);

function treeGed(orient: string | null): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 CHAR UTF-8',
        '0 @P0001@ INDI', '1 NAME Anna /Víšková/', '1 SEX F', '1 SOUR @S0001@',
        '0 @S0001@ SOUR', '1 TITL Křestní matrika Čáslav',
        '1 OBJE', '2 FORM jpeg', '2 _STROM_KIND excerpt', '2 _STROM_CLIP C0007', `2 _STROM_SHA ${SHA}`,
        ...(orient ? [`2 _STROM_ORIENT ${orient}`] : []),
        `2 FILE ${CROP}`,
        '0 TRLR',
    ].join('\n');
}

const excerptOf = (ged: string) => Object.values(convertToStrom(parseGedcom(ged)).data.sources!)[0].excerpts![0];

describe('a research crop turned by its original\'s orientation (_STROM_ORIENT)', () => {
    it('reads the orientation onto the crop; its size is the crop as shown', () => {
        const exc = excerptOf(treeGed('6'));
        expect(exc.orient).toBe(6);
        expect(exc.dataUrl).toBe(CROP);
        expect({ w: exc.width, h: exc.height }).toEqual({ w: 100, h: 400 });
        // Mirrored only (2–4): the size stays.
        const mirrored = excerptOf(treeGed('3'));
        expect(mirrored.orient).toBe(3);
        expect({ w: mirrored.width, h: mirrored.height }).toEqual({ w: 400, h: 100 });
    });

    it('a crop without the line, or with a value out of 2–8, lies right', () => {
        expect(excerptOf(treeGed(null)).orient).toBeUndefined();
        expect(excerptOf(treeGed('1')).orient).toBeUndefined();
        expect(excerptOf(treeGed('9')).orient).toBeUndefined();
        expect(excerptImageUrl(excerptOf(treeGed(null)))).toBe(CROP);
    });

    it('sends the crop back as it came: the same image and the same line', () => {
        const ged = exportToGedcom(convertToStrom(parseGedcom(treeGed('6'))).data).content;
        expect(ged).toContain(`2 _STROM_SHA ${SHA}\n2 _STROM_ORIENT 6`);
        expect(ged).toContain(`2 FILE ${CROP}`);
        expect(excerptOf(ged).orient).toBe(6);
    });

    it('shows the crop by a URL whose EXIF block says the orientation', () => {
        const exc = excerptOf(treeGed('6'));
        const shown = excerptImageUrl(exc);
        expect(shown).not.toBe(CROP);
        expect(exifOrientation(bytesOf(shown))).toBe(6);
        // Still the same picture: the frame header reads as before.
        expect(imageSizeFromDataUrl(shown)).toEqual({ width: 400, height: 100 });
        // Built once per crop.
        expect(excerptImageUrl(exc)).toBe(shown);
    });

    it('leaves a JPEG that has an EXIF block already, a PNG and a plain orientation alone', () => {
        const withExif = tinyJpeg(10, 10, 8);
        expect(withExifOrientation(withExif, 6)).toBe(withExif);
        const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        expect(withExifOrientation(png, 6)).toBe(png);
        expect(withExifOrientation(CROP, 1)).toBe(CROP);
    });
});
