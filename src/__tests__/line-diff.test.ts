import { describe, it, expect } from 'vitest';
import { diffLines, type LineDiffPart } from '../line-diff.js';

const same = (text: string): LineDiffPart => ({ op: 'same', text });
const del = (text: string): LineDiffPart => ({ op: 'del', text });
const add = (text: string): LineDiffPart => ({ op: 'add', text });

describe('diffLines', () => {
    it('keeps identical texts whole', () => {
        expect(diffLines('Kovář v Smrkově.\nOženil se 1865.', 'Kovář v Smrkově.\nOženil se 1865.'))
            .toEqual([same('Kovář v Smrkově.'), same('Oženil se 1865.')]);
    });

    it('a paragraph added at the end: the old text kept, only the new paragraph added', () => {
        const old = 'Kovář v Smrkově.\n\nOženil se 1865.';
        const next = `${old}\n\nKřest v matrice Smrkov, fol. 12.`;
        expect(diffLines(old, next)).toEqual([
            same('Kovář v Smrkově.'), same(''), same('Oženil se 1865.'),
            add(''), add('Křest v matrice Smrkov, fol. 12.'),
        ]);
    });

    it('a paragraph added in the middle', () => {
        expect(diffLines('První.\n\nTřetí.', 'První.\n\nDruhý.\n\nTřetí.')).toEqual([
            same('První.'), same(''), add('Druhý.'), add(''), same('Třetí.'),
        ]);
    });

    it('a changed line: the old one removed, then the new one added, the rest kept', () => {
        expect(diffLines('Narozen 1840.\nKovář.\nZemřel 1901.', 'Narozen 1840.\nKovář a sedlák.\nZemřel 1901.')).toEqual([
            same('Narozen 1840.'), del('Kovář.'), add('Kovář a sedlák.'), same('Zemřel 1901.'),
        ]);
    });

    it('several changed lines in a row read all old, then all new', () => {
        expect(diffLines('a\nb\nc\nz', 'a\nx\ny\nz')).toEqual([same('a'), del('b'), del('c'), add('x'), add('y'), same('z')]);
    });

    it('a removed line and an added one apart from each other', () => {
        expect(diffLines('a\nb\nc\nd', 'a\nc\nd\ne')).toEqual([same('a'), del('b'), same('c'), same('d'), add('e')]);
    });

    it('empty lines are lines: one added or removed shows, a blank line kept stays blank', () => {
        expect(diffLines('a\nb', 'a\n\nb')).toEqual([same('a'), add(''), same('b')]);
        expect(diffLines('a\n\n\nb', 'a\n\nb')).toEqual([same('a'), same(''), del(''), same('b')]);
        expect(diffLines('', 'a')).toEqual([del(''), add('a')]);
    });

    it('trailing spaces and Windows line ends are not a change; the kept line as the new text has it', () => {
        expect(diffLines('a  \r\nb', 'a\nb\t')).toEqual([same('a'), same('b\t')]);
    });

    it('emoji and CJK lines are compared whole, never cut', () => {
        const old = '家族の記録 🌳\n祖父は鍛冶屋でした。';
        const next = '家族の記録 🌳\n祖父は鍛冶屋でした。\n👨‍👩‍👧 三人の子供';
        expect(diffLines(old, next)).toEqual([same('家族の記録 🌳'), same('祖父は鍛冶屋でした。'), add('👨‍👩‍👧 三人の子供')]);
        expect(diffLines('🌳 strom', '🌲 strom')).toEqual([del('🌳 strom'), add('🌲 strom')]);
    });

    it('the new text read from the kept and added lines, the old one from the kept and removed ones', () => {
        const old = 'p1\n\np2\nx\n\np4';
        const next = 'p0\np1\n\np2 changed\n\np4\n\np5';
        const parts = diffLines(old, next);
        expect(parts.filter(p => p.op !== 'del').map(p => p.text).join('\n')).toBe(next);
        expect(parts.filter(p => p.op !== 'add').map(p => p.text).join('\n')).toBe(old);
    });
});
