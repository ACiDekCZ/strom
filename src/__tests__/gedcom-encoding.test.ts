/**
 * GEDCOM files from Czech and Polish Windows programs: "1 CHAR ANSI" means the
 * code page of the computer that wrote the file (Windows-1250 there), and some
 * programs name it outright (CP1250, WINDOWS-1250). Reading those bytes as
 * Windows-1252 turned "Dvořák" into "Dvoøák". Fixtures: test/gedcom-encoding/
 * (fictional names, generated once with each code page).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    parseGedcom, convertToStrom, decodeGedcomBytes, decodeGedcomFile, guessSingleByteEncoding,
} from '../ged-parser.js';

const FIXTURES = join(__dirname, '..', '..', 'test', 'gedcom-encoding');
const fixture = (name: string): ArrayBuffer => {
    const bytes = readFileSync(join(FIXTURES, name));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};
const fullNames = (text: string): string[] =>
    Object.values(convertToStrom(parseGedcom(text)).data.persons).map(p => `${p.firstName} ${p.lastName}`);
const places = (text: string): string[] =>
    Object.values(convertToStrom(parseGedcom(text)).data.persons).map(p => p.birthPlace ?? '');

const CZECH = ['Vojtěch Dvořák', 'Zdeňka Pokorná', 'Řehoř Kučera', 'Ludmila Šťastná', 'Matěj Vlček'];

/** Encode text in a single-byte Windows code page (TextEncoder only does UTF-8). */
function encode(text: string, encoding: string): Uint8Array {
    const decoder = new TextDecoder(encoding);
    const map = new Map<string, number>();
    for (let b = 0; b < 256; b++) map.set(decoder.decode(new Uint8Array([b])), b);
    return Uint8Array.from([...text].map(c => {
        const b = map.get(c);
        if (b === undefined) throw new Error(`${encoding} cannot encode ${c}`);
        return b;
    }));
}

describe('GEDCOM encodings from Windows programs', () => {
    it('reads "1 CHAR ANSI" with Czech letters as Windows-1250', () => {
        const d = decodeGedcomBytes(fixture('ansi-czech.ged'));
        expect(d.encoding).toBe('windows-1250');
        expect(d.how).toBe('content');
        expect(d.declared).toBe('ANSI');
        expect(fullNames(d.text)).toEqual(CZECH);
        expect(places(d.text)).toContain('Žďár nad Sázavou');
    });

    it('reads CHAR CP1250 and CHAR WINDOWS-1250 as declared', () => {
        const cp = decodeGedcomBytes(fixture('cp1250-czech.ged'));
        expect([cp.encoding, cp.how]).toEqual(['windows-1250', 'declared']);
        expect(fullNames(cp.text)).toEqual(CZECH.slice(0, 2));
        const win = decodeGedcomBytes(fixture('windows-1250-czech.ged'));
        expect([win.encoding, win.how]).toEqual(['windows-1250', 'declared']);
        expect(fullNames(win.text)).toEqual(CZECH.slice(2));
    });

    it('reads Polish ANSI (ł ą ż) as Windows-1250', () => {
        const d = decodeGedcomBytes(fixture('ansi-polish.ged'));
        expect(d.encoding).toBe('windows-1250');
        expect(fullNames(d.text)).toEqual(['Łucja Wąsowska', 'Żaneta Jabłońska']);
        expect(places(d.text)).toEqual(['Łódź', 'Częstochowa']);
    });

    it('keeps Western ANSI files (French, Italian, German) as Windows-1252', () => {
        const d = decodeGedcomBytes(fixture('ansi-western.ged'));
        expect(d.encoding).toBe('windows-1252');
        expect(fullNames(d.text)).toEqual(['Thérèse Lefèvre', 'Niccolò Bellini', 'Jürgen Weiß', 'François Mercier']);
        expect(places(d.text)).toEqual(['Besançon', 'Forlì', 'Köln', 'Genève']);
    });

    it('guesses a file without CHAR, and one wrongly labelled UTF-8, from the bytes', () => {
        for (const name of ['no-char-czech.ged', 'utf8-label-cp1250-czech.ged']) {
            const d = decodeGedcomBytes(fixture(name));
            expect(d.encoding, name).toBe('windows-1250');
            expect(d.how, name).toBe('content');
            expect(fullNames(d.text), name).toEqual(CZECH);
        }
    });

    it('keeps a valid UTF-8 file labelled ANSI as UTF-8', () => {
        const d = decodeGedcomBytes(fixture('ansi-utf8-czech.ged'));
        expect(d.encoding).toBe('utf-8');
        expect(fullNames(d.text)).toEqual(CZECH);
    });

    it('a chosen encoding overrides the declaration and the guess', () => {
        const d = decodeGedcomBytes(fixture('ansi-czech.ged'), 'windows-1252');
        expect([d.encoding, d.how]).toEqual(['windows-1252', 'chosen']);
        expect(fullNames(d.text)[0]).toBe('Vojtìch Dvoøák');
        // and back: the same bytes, the right page
        expect(fullNames(decodeGedcomBytes(fixture('ansi-czech.ged'), 'windows-1250').text)).toEqual(CZECH);
    });

    it('a chosen UTF-8 drops the byte order mark', () => {
        const utf8 = new TextEncoder().encode('0 HEAD\n0 @I1@ INDI\n1 NAME Matěj /Vlček/\n0 TRLR\n');
        const bytes = new Uint8Array([0xEF, 0xBB, 0xBF, ...utf8]);
        const d = decodeGedcomBytes(bytes.buffer, 'utf-8');
        expect(d.text.startsWith('0 HEAD')).toBe(true);
    });

    it('reports whether the file has any non-ASCII byte', () => {
        const ascii = new TextEncoder().encode('0 HEAD\n1 CHAR ANSI\n0 @I1@ INDI\n1 NAME Jan /Novak/\n0 TRLR\n');
        expect(decodeGedcomBytes(ascii.buffer as ArrayBuffer).nonAscii).toBe(false);
        expect(decodeGedcomBytes(fixture('ansi-czech.ged')).nonAscii).toBe(true);
    });

    it('decodeGedcomFile stays the plain-text entry point', () => {
        expect(fullNames(decodeGedcomFile(fixture('ansi-czech.ged')))).toEqual(CZECH);
    });
});

describe('guessSingleByteEncoding (word votes)', () => {
    const guess = (text: string, page: string) => guessSingleByteEncoding(encode(text, page));

    it('Czech words with š ž á í ý ú next to č ř ě vote Central', () => {
        expect(guess('Bohdan Čermák, Ondřej Hrubý', 'windows-1250')).toBe('windows-1250');
        expect(guess('Kučerová', 'windows-1250')).toBe('windows-1250');
    });

    it('letters only 1250 has (ť ľ ł ą ż ź) vote Central on their own', () => {
        for (const word of ['Šťěpán', 'Ľubica', 'Łukasz', 'Mąka', 'żona', 'Źródło']) {
            expect(guess(word, 'windows-1250'), word).toBe('windows-1250');
        }
    });

    it('French and Italian words stay Western', () => {
        expect(guess('Hélène Dupré, Thérèse, Agnès, Mosè, Niccolò', 'windows-1252')).toBe('windows-1252');
        expect(guess('Françoise Lefèvre', 'windows-1252')).toBe('windows-1252');
    });

    it('a Spanish ¿ opening a sentence is not a Polish ż', () => {
        expect(guess('¿Quién? Muñoz Núñez', 'windows-1252')).toBe('windows-1252');
    });

    it('German and Scandinavian text reads the same in both pages, so it stays Western', () => {
        expect(guess('Jürgen Weiß, Müller, Ørsted, Bjørn', 'windows-1252')).toBe('windows-1252');
    });

    it('words that do not decide (Matěj alone) keep the GEDCOM meaning of ANSI', () => {
        expect(guess('Matěj', 'windows-1250')).toBe('windows-1252');
    });
});
