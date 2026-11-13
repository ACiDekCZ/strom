/**
 * Texts of the ancestors' path on the map (spec 054 §5): plural forms in
 * Czech (1 / 2–4 / 5+), Polish (1 / 2–4 / 5+ and 12–14), English and German,
 * numbers formatted for the language, the gender of "unknown".
 */
import { describe, it, expect } from 'vitest';
import { getStringsForLang } from '../strings.js';

const map = (lang: 'en' | 'cs' | 'de' | 'pl') => getStringsForLang(lang).map;

describe('counted ancestors', () => {
    it('Czech: předek / předkové / předků, and "nejsou" for 2–4', () => {
        expect([1, 2, 4, 5, 22, 37].map(n => map('cs').pathPickOnMap(n))).toEqual([
            '1 předek na mapě', '2 předkové na mapě', '4 předkové na mapě', '5 předků na mapě', '22 předků na mapě', '37 předků na mapě']);
        expect(map('cs').linesRow('otcův otec', 18)).toBe('otcův otec · 18 předků');
        expect(map('cs').pathUndated(1)).toBe('1 předek bez data nebo místa na liště není.');
        expect(map('cs').pathUndated(3)).toBe('3 předkové bez data nebo místa na liště nejsou.');
        expect(map('cs').pathUndated(7)).toBe('7 předků bez data nebo místa na liště není.');
    });

    it('Polish: przodek / przodkowie / przodków (12–14 przodków, 22 przodkowie)', () => {
        expect([1, 2, 5, 12, 14, 22].map(n => map('pl').linesAncestors(n))).toEqual([
            '1 przodek', '2 przodkowie', '5 przodków', '12 przodków', '14 przodków', '22 przodkowie']);
        expect(map('pl').pathUndated(7)).toBe('7 przodków bez daty lub miejsca nie ma na osi czasu.');
    });

    it('English and German: one and other', () => {
        expect(map('en').pathPickOnMap(1)).toBe('1 ancestor on the map');
        expect(map('en').pathPickOnMap(37)).toBe('37 ancestors on the map');
        expect(map('en').pathUndated(1)).toBe('1 ancestor without a date or place is not on the timeline.');
        expect(map('en').pathUndated(7)).toBe('7 ancestors without a date or place are not on the timeline.');
        expect(map('de').linesRow('Vater des Vaters', 1)).toBe('Vater des Vaters · 1 Vorfahr');
        expect(map('de').linesRow('Vater des Vaters', 18)).toBe('Vater des Vaters · 18 Vorfahren');
        expect(map('de').pathUndated(7)).toBe('7 Vorfahren ohne Datum oder Ort sind nicht auf der Zeitleiste.');
    });
});

describe('numbers and the rest', () => {
    it('the cut formats numbers for the language (cs space, en comma, de point, pl none at four digits)', () => {
        const nbsp = (s: string) => s.replace(/[  ]/g, ' ');
        expect(nbsp(map('cs').linesCut(400, 1250))).toBe('Ukázáno 400 z 1 250 čar');
        expect(map('en').linesCut(400, 1250)).toBe('400 of 1,250 lines shown');
        expect(map('de').linesCut(400, 1250)).toBe('400 von 1.250 Linien gezeigt');
        expect(map('pl').linesCut(400, 1250)).toBe('Pokazano 400 z 1250 linii');
        expect(map('cs').timeMarkTitle('Ostrolist', 1752)).toBe('Ostrolist: nejstarší předek 1752');
    });

    it('"unknown" follows the gender of the relation in Czech and Polish', () => {
        expect(map('cs').linesUnknown('otcova matka', true)).toBe('otcova matka – neznámá');
        expect(map('cs').linesUnknown('matčin otec', false)).toBe('matčin otec – neznámý');
        expect(map('pl').linesUnknown('matka ojca', true)).toBe('matka ojca – nieznana');
        expect(map('en').linesUnknown('father’s mother', true)).toBe('father’s mother – unknown');
    });

    it('the end of the path names the kind of its place and the year', () => {
        expect(map('cs').pathGoalEnd('Jan Ostrolist', 1958, 'birth')).toBe('Jan Ostrolist · 1958');
        expect(map('cs').pathGoalEnd('Jan Ostrolist', 1985, 'residence')).toBe('Jan Ostrolist · bydliště 1985');
        expect(map('de').pathGoalEnd('Jan Ostrolist', undefined, 'baptism')).toBe('Jan Ostrolist · Taufe');
        expect(map('en').pathGoal('Jan Ostrolist')).toBe('end: Jan Ostrolist');
        expect(map('cs').linesImplex('Anna Ostrolistová', 1788, 'Pelyněk', 'Rozchodník'))
            .toBe('↻ Anna Ostrolistová (1788) je ve dvou větvích: Pelyněk a Rozchodník.');
        expect(map('en').linesImplex('Anna', undefined, 'A', 'B')).toBe('↻ Anna is in two lines: A and B.');
    });

    it('the eight great-grandparent relations exist in every language', () => {
        for (const lang of ['en', 'cs', 'de', 'pl'] as const) {
            const m = map(lang);
            const rels = [m.lineE8, m.lineE9, m.lineE10, m.lineE11, m.lineE12, m.lineE13, m.lineE14, m.lineE15];
            expect(new Set(rels).size, lang).toBe(8);
        }
        expect(map('cs').lineE10).toBe('otec otcovy matky');
        expect(map('pl').lineE13).toBe('matka ojca matki');
    });
});
