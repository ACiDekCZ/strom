/**
 * A participant's note (godparent, witness, another person of the event) may
 * run over several lines: `CONC` continues the line, `CONT` starts a new one.
 * They were dropped, so a long or multi-line note — Strom's own export writes
 * one so — came back cut after its first physical line. A citation under a
 * participant has no place in the app (citations belong to the fact): it is
 * counted among the lines left out. Export → import returns every note exactly,
 * with emoji, combining marks and CJK right at a cut. Invented data.
 */
import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import type { EventParticipant, Person, StromData } from '../types.js';

const GED = [
    '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
    '0 @I1@ INDI', '1 NAME Bořivoj /Křemenáček/', '1 SEX M', '1 FAMS @F1@',
    '1 ASSO @I2@', '2 RELA Friend', '2 NOTE soused od', '3 CONC  mládí', '3 CONT druhý řádek',
    '1 BAPM', '2 DATE 3 APR 1851', '2 SOUR @S1@', '3 PAGE fol. 1',
    '2 _WITN Hostivít Zvonokrt', '3 RELA Godparent', '3 NOTE sedlák z Hřeben', '4 CONC ova', '4 CONT čp. 5',
    '3 SOUR @S2@', '4 PAGE fol. 9',
    '1 BIRT', '2 DATE 1 APR 1851', '2 ASSO @I2@', '3 RELA Godparent', '3 NOTE strýc', '4 CONC  z otcovy strany', '4 CONT', '4 CONT kmotr i u bratra',
    '0 @I2@ INDI', '1 NAME Zbyhoň /Pšenkovec/', '1 SEX M',
    '0 @I3@ INDI', '1 NAME Vratislavka /Ořechovská/', '1 SEX F', '1 FAMS @F1@',
    '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I3@',
    '1 MARR', '2 DATE 1878', '2 _WITN Radhošť Hřebenáč', '3 RELA Witness', '3 NOTE bratr nevěs', '4 CONC ty', '4 CONT ze mlýna',
    '1 MARB', '2 DATE 1878', '2 ASSO @I2@', '3 ROLE WITN', '3 NOTE ohlášky', '4 CONT třikrát',
    '0 @S1@ SOUR', '1 TITL Matrika Horní Bludovec',
    '0 @S2@ SOUR', '1 TITL Kniha kmotrů',
    '0 TRLR',
].join('\n');

const load = (text: string) => convertToStrom(parseGedcom(text));
const person = (d: StromData, first: string): Person => Object.values(d.persons).find(p => p.firstName === first)!;
const notes = (parts: EventParticipant[] | undefined): (string | undefined)[] => (parts ?? []).map(p => p.note);

describe('a participant\'s note with CONC / CONT lines', () => {
    it('is read whole under an event, a birth, a wedding, a couple\'s event and the person', () => {
        const { data: d } = load(GED);
        const bori = person(d, 'Bořivoj');
        const baptism = bori.events!.find(e => e.type === 'baptism')!;
        // The birth's godparent moves to the christening.
        expect(notes(baptism.participants)).toEqual([
            'sedlák z Hřebenova\nčp. 5',
            'strýc z otcovy strany\n\nkmotr i u bratra',
        ]);
        const union = Object.values(d.partnerships)[0];
        expect(notes(union.participants)).toEqual(['bratr nevěsty\nze mlýna']);
        expect(notes(union.events!.find(e => e.type === 'banns')!.participants)).toEqual(['ohlášky\ntřikrát']);
        expect(bori.notes).toBe('Association: Zbyhoň Pšenkovec (Friend) — soused od mládí\ndruhý řádek');
    });

    it('a citation under a participant is counted as left out; the event\'s own citation stays', () => {
        const { data: d, stats } = load(GED);
        expect(stats.droppedTagSummary).toBe('SOUR ×1');
        const baptism = person(d, 'Bořivoj').events!.find(e => e.type === 'baptism')!;
        expect(baptism.sourceIds!.map(id => [d.sources![id].title, d.sources![id].reference])).toEqual([
            ['Matrika Horní Bludovec', 'fol. 1'],
        ]);
    });

    it('goes back with its lines and is read again the same', () => {
        const { data: d } = load(GED);
        const out = exportToGedcom(d, 'Křemenáček', {}).content;
        expect(out).toContain('3 NOTE sedlák z Hřebenova\n4 CONT čp. 5');
        const { data: again } = load(out);
        const baptism = (data: StromData) => person(data, 'Bořivoj').events!.find(e => e.type === 'baptism')!;
        expect(notes(baptism(again).participants)).toEqual(notes(baptism(d).participants));
        expect(notes(Object.values(again.partnerships)[0].participants)).toEqual(['bratr nevěsty\nze mlýna']);
    });
});

/** Clusters that span several UTF-16 units, code points or bytes. */
const TRICKY = ['🔴', '👨‍👩‍👧', '👍🏽', '🇨🇿🇩🇪', '1️⃣', 'é', 'ạ̈', 'ů', '漢字', '日本語の文', '한국어', '@'];

const encoder = new TextEncoder();
const strictDecoder = new TextDecoder('utf-8', { fatal: true });

/** A note with `ch` at every offset around the first cut, alone and on a later line. */
function* notesAroundCut(ch: string): Generator<string> {
    for (let pad = 182; pad <= 202; pad++) {
        yield 'x'.repeat(pad) + ch + ' konec';
        yield 'ř'.repeat(Math.floor(pad / 2)) + ch + ch + 'tail';
        yield '漢'.repeat(Math.floor(pad / 3)) + ch + '字';
        yield `první řádek\n${'x'.repeat(pad)}${ch}${ch}\n\n${'y'.repeat(pad - 5)} ${ch} z`;
    }
}

/** Deterministic pseudo-random numbers (mulberry32). */
function random(seed: number): () => number {
    let a = seed;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Lines of words: single spaces, no space at a line's ends (GEDCOM readers trim those). */
function randomNote(next: () => number): string {
    const pieces = [...TRICKY, 'kmotr', 'Hřebenáč', 'x', 'ab', '…', 'ß', 'ł'];
    const lines: string[] = [];
    const lineCount = 1 + Math.floor(next() * 3);
    for (let l = 0; l < lineCount; l++) {
        const words: string[] = [];
        const wordCount = Math.floor(next() * 120);
        for (let w = 0; w < wordCount; w++) {
            let word = '';
            const len = 1 + Math.floor(next() * 6);
            for (let k = 0; k < len; k++) word += pieces[Math.floor(next() * pieces.length)];
            words.push(word);
        }
        lines.push(words.join(' '));
    }
    return lines.join('\n').replace(/^\n+/, 'a\n');
}

describe('a participant\'s note cut into CONC / CONT lines and joined again is the note written', () => {
    const base = load(GED).data;
    const roundTrip = (texts: string[]): void => {
        const d: StromData = structuredClone(base);
        const baptism = person(d, 'Bořivoj').events!.find(e => e.type === 'baptism')!;
        baptism.participants = texts.map((note, i) => ({ id: `pt_fuzz_${i}`, role: 'witness', name: `Zbyhoň Kmínovec ${i}`, note }));
        const out = exportToGedcom(d, 'Křemenáček', {}).content;
        for (const line of out.split('\n')) {
            const bytes = encoder.encode(line);
            expect(strictDecoder.decode(bytes)).toBe(line);
            expect(bytes.length).toBeLessThanOrEqual(255);
        }
        const again = person(load(out).data, 'Bořivoj').events!.find(e => e.type === 'baptism')!;
        expect(notes(again.participants)).toEqual(texts);
    };

    for (const ch of TRICKY) {
        it(`with ${JSON.stringify(ch)} at the cut`, () => {
            const texts = [...notesAroundCut(ch)];
            expect(texts.some(t => encoder.encode(t).length > 200)).toBe(true);
            roundTrip(texts);
        });
    }

    it('random notes of words, emoji, combining marks and CJK', () => {
        const next = random(1115);
        for (let round = 0; round < 20; round++) {
            roundTrip(Array.from({ length: 10 }, () => randomNote(next)));
        }
    });
});
