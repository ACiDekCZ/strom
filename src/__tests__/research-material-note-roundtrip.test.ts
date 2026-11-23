/**
 * A file the research gives with the tree and a note under its OBJE goes back
 * in a send with that NOTE, the same text, whether its data go with it or by
 * reference (spec 133: `_STROM_DATA <sha>` in place of FILE), in place at a
 * person and as a media record of two persons. A send without the NOTE reads
 * in the research as the note taken off (the stuck research of 1.35). The
 * NOTE goes through the one cut of every long value (CONC / CONT): cut and
 * joined back it is the text again, with emoji, combining marks and CJK at
 * the cut. Invented data.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { migrateData } from '../data.js';
import { exportToGedcom } from '../ged-exporter.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { allMedia } from '../media.js';
import { mediaRefOf, treeDataUrls } from '../research-media-ref.js';
import type { Attachment, StromData } from '../types.js';

/** A small JPEG; `salt` makes its bytes (and hash) its own. */
function jpeg(salt: number): Buffer {
    return Buffer.from([0xFF, 0xD8,
        0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
        0xFF, 0xFE, 0x00, 0x04, salt >> 8, salt & 0xFF,
        0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x40,
        0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
        ...Array.from({ length: 200 }, (_, i) => (i * 7 + salt) & 0xFF),
        0xFF, 0xD9]);
}
const shaOf = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const urlOf = (b: Buffer): string => `data:image/jpeg;base64,${b.toString('base64')}`;

const LETTER = jpeg(21);
const GROUP = jpeg(22);
const IMAGES = new Map([LETTER, GROUP].map(b => [shaOf(b), urlOf(b)]));

const LETTER_NOTE = `od mamky fotky – Семья 家族 👨‍👩‍👧 ${'dopis z Lhoty '.repeat(20)}konec`;
const GROUP_NOTE = 'Svatba v Brodu 1924\nvlevo strýc Ctibor 🇨🇿, vpravo teta Ludmila';

/** The research's tree as a load gives it: a file in place, one as a media record of two persons. */
function researchGed(letterNote: string, groupNote: string): string {
    const note = (level: number, text: string): string[] => text.split('\n').map(t => t.replace(/@/g, '@@')).flatMap((part, i) => {
        // Cut as a writer of CONC does: about every 90 characters, beside no space (a line's edge spaces are not
        // kept) and not inside an escaped '@@'.
        const cuts = [0];
        for (let s = 90; s < part.length; s += 90) {
            while (s < part.length && (part[s] === ' ' || part[s - 1] === ' ' || part[s - 1] === '@')) s++;
            if (s < part.length) cuts.push(s);
        }
        return cuts.map((s, k) => {
            const piece = part.slice(s, cuts[k + 1] ?? part.length);
            return k === 0 ? (i === 0 ? `${level} NOTE ${piece}` : `${level + 1} CONT ${piece}`) : `${level + 1} CONC ${piece}`;
        });
    });
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 CHAR UTF-8',
        '0 @P0001@ INDI', '1 NAME Hostivít /Pšeničný/', '1 SEX M', '1 REFN P0001',
        '1 OBJE', '2 FORM jpg', '2 TITL dopis.jpg', ...note(2, letterNote), `2 FILE strom-image:${shaOf(LETTER)}`, '3 _MIME image/jpeg',
        '1 OBJE @O1@',
        '0 @P0002@ INDI', '1 NAME Ctirada /Pšeničná/', '1 SEX F', '1 REFN P0002',
        '1 OBJE @O1@',
        '0 @O1@ OBJE', `1 FILE strom-image:${shaOf(GROUP)}`, '2 FORM jpg', '2 TITL svatba.jpg', ...note(1, groupNote),
        '0 TRLR', '',
    ].join('\n');
}

const load = (ged: string): StromData =>
    migrateData(convertToStrom(parseGedcom(ged), { images: IMAGES }).data as StromData);

const OPTIONS = { research: { id: 'r-1', head: 'h1', appTree: 't1', sent: 'fp' }, appMedia: true, mediaDates: true } as const;

/** Both sends: every file with its data, and every file by reference (the research holds them all). */
function sends(data: StromData): { withData: string; byRef: string } {
    const shas = new Map(treeDataUrls(data).map(url => {
        const b64 = url.slice(url.indexOf(',') + 1);
        return [url, createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex')] as const;
    }));
    const ref = mediaRefOf({ known: true }, new Set(shas.values()), new Set(), url => shas.get(url));
    return {
        withData: exportToGedcom(data, 'T', OPTIONS).content,
        byRef: exportToGedcom(data, 'T', { ...OPTIONS, mediaRef: ref }).content,
    };
}

/** The NOTE values under each OBJE of a file, read line by line as a reader of CONC / CONT does. */
function objeNotes(ged: string): { note: string; lines: string[] }[] {
    const lines = ged.split('\n');
    const out: { note: string; lines: string[] }[] = [];
    let objeLevel = -1;
    for (let i = 0; i < lines.length; i++) {
        const m = /^(\d+) (?:@\w+@ )?(\w+)(?: (.*))?$/.exec(lines[i]);
        if (!m) continue;
        const level = Number(m[1]);
        if (m[2] === 'OBJE' && !/^\d+ OBJE @/.test(lines[i])) { objeLevel = level; continue; }
        if (level <= objeLevel) objeLevel = level === objeLevel && m[2] === 'OBJE' ? level : -1;
        if (objeLevel < 0 || m[2] !== 'NOTE' || level !== objeLevel + 1) continue;
        const own = [lines[i]];
        let note = m[3] ?? '';
        for (let j = i + 1; j < lines.length; j++) {
            const c = new RegExp(`^${level + 1} (CONC|CONT)(?: (.*))?$`).exec(lines[j]);
            if (!c) break;
            own.push(lines[j]);
            note += (c[1] === 'CONT' ? '\n' : '') + (c[2] ?? '');
        }
        out.push({ note, lines: own });
    }
    return out;
}

const notesOf = (data: StromData): (string | undefined)[] => allMedia(data).map((a: Attachment) => a.note).sort();
const hasLoneSurrogate = (s: string): boolean => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
const utf8 = (s: string): number => Buffer.byteLength(s, 'utf8');

describe('a file the research gave with a NOTE goes back with it', () => {
    it('import: each file keeps its note', () => {
        expect(notesOf(load(researchGed(LETTER_NOTE, GROUP_NOTE)))).toEqual([GROUP_NOTE, LETTER_NOTE].sort());
    });

    it('a send with data and one by reference write the same NOTE under each OBJE, read back the same', () => {
        const data = load(researchGed(LETTER_NOTE, GROUP_NOTE));
        const { withData, byRef } = sends(data);
        // By reference indeed: no FILE with data, a _STROM_DATA in place of each.
        expect(byRef).not.toContain('FILE data:');
        expect(byRef.match(/_STROM_DATA [0-9a-f]{64}/g)).toHaveLength(2);
        expect(withData.match(/FILE data:image\/jpeg/g)).toHaveLength(2);
        for (const ged of [withData, byRef]) {
            expect(objeNotes(ged).map(n => n.note).sort()).toEqual([GROUP_NOTE, LETTER_NOTE].sort());
            // The NOTE's own lines are the same in both sends (only the data lines differ).
            expect(objeNotes(ged).map(n => n.lines)).toEqual(objeNotes(withData).map(n => n.lines));
            expect(notesOf(load(ged.replace(/_STROM_DATA ([0-9a-f]{64})/g, 'FILE strom-image:$1')))).toEqual([GROUP_NOTE, LETTER_NOTE].sort());
        }
    });

    it('a second send of what came back is the same text (nothing to change in the research)', () => {
        const first = sends(load(researchGed(LETTER_NOTE, GROUP_NOTE))).withData;
        const again = sends(load(first)).withData;
        expect(objeNotes(again)).toEqual(objeNotes(first));
    });
});

describe('the NOTE of a file is cut and joined back whole (fuzz)', () => {
    // Characters that a careless cut tears apart: emoji with joiners and skin
    // tones, a flag, combining marks, CJK in and outside the BMP, an escaped '@'.
    const HARD = ['👨‍👩‍👧', '👍🏽', '🇨🇿🇩🇪', 'é', 'ạ̈', '각', '家族', '𠮷', '@', 'ř', ' '];
    let seed = 1123;
    const rand = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };

    it('every NOTE line is whole characters within 255 bytes, and the lines join to the text', () => {
        for (let round = 0; round < 60; round++) {
            // A run of plain letters that puts a hard character right at the cut (about 200 bytes in).
            const lead = 'a'.repeat(180 + rand(30));
            let tail = '';
            while (tail.length < 300) tail += HARD[rand(HARD.length)] + (rand(3) ? 'ž' : '');
            // A value's edge spaces are not kept by GEDCOM; inside it they are.
            tail = tail.trim();
            const text = rand(4) ? `${lead}${tail}` : `${lead}${tail}\n${tail}${lead}`;
            const data = load(researchGed(text, `${tail} ${text}`));
            expect(notesOf(data)).toEqual([text, `${tail} ${text}`].sort());
            const { withData, byRef } = sends(data);
            for (const ged of [withData, byRef]) {
                const notes = objeNotes(ged);
                expect(notes.map(n => n.note.replace(/@@/g, '@')).sort()).toEqual([text, `${tail} ${text}`].sort());
                for (const line of notes.flatMap(n => n.lines)) {
                    expect(hasLoneSurrogate(line)).toBe(false);
                    expect(utf8(line)).toBeLessThanOrEqual(255);
                    // A line never starts with a mark or a joiner that belongs to the character before it.
                    expect(/^\d+ (?:CONC|CONT) [\p{M}‍\u{1F3FB}-\u{1F3FF}]/u.test(line)).toBe(false);
                }
                expect(notesOf(load(ged.replace(/_STROM_DATA ([0-9a-f]{64})/g, 'FILE strom-image:$1')))).toEqual([text, `${tail} ${text}`].sort());
            }
        }
    });
});
