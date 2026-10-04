/**
 * One source cited at several pages (a register book, an entry per page).
 *
 * A source here is the entry and its reference the page, so the import gave
 * the source the first citation's page and every other citation then showed
 * — and exported — that page. Now a citation of another page gets a source of
 * its own (same book, its page), and the export writes each page where it was.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { StromData } from '../types.js';

const importGed = (ged: string): StromData => convertToStrom(parseGedcom(ged)).data;
const head = '0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n';
const pages = (data: StromData): string[] => Object.values(data.sources ?? {}).map(s => s.reference ?? '').sort();
const birthPage = (data: StromData, first: string): string | undefined => {
    const p = Object.values(data.persons).find(x => x.firstName === first)!;
    return data.sources?.[p.birthSourceIds?.[0] ?? '']?.reference;
};

const BOOK = head
    + '0 @I1@ INDI\n1 NAME Josef /Novák/\n1 SEX M\n'
    + '1 BIRT\n2 DATE 1885\n2 SOUR @S1@\n3 PAGE fol. 12, č. 5\n'
    + '1 DEAT\n2 DATE 1950\n2 SOUR @S1@\n3 PAGE fol. 99, č. 41\n'
    + '0 @I2@ INDI\n1 NAME Anna /Nováková/\n1 SEX F\n'
    + '1 BIRT\n2 DATE 1888\n2 SOUR @S1@\n3 PAGE fol. 30, č. 7\n'
    + '0 @I3@ INDI\n1 NAME Marie /Nováková/\n1 SEX F\n'
    + '1 BIRT\n2 DATE 1890\n2 SOUR @S1@\n3 PAGE fol. 30, č. 7\n'
    + '0 @S1@ SOUR\n1 TITL Matrika Kamenice 1850–1950\n1 REPO @R1@\n'
    + '0 @R1@ REPO\n1 NAME SOA Zámrsk\n0 TRLR\n';

describe('GEDCOM: one source cited at several pages', () => {
    it('each page is a source of its own (same book), the same page twice is one', () => {
        const data = importGed(BOOK);
        expect(pages(data)).toEqual(['fol. 12, č. 5', 'fol. 30, č. 7', 'fol. 99, č. 41']);
        for (const s of Object.values(data.sources ?? {})) {
            expect(s.title).toBe('Matrika Kamenice 1850–1950');
            expect(s.repository).toBe('SOA Zámrsk');
        }
        expect(birthPage(data, 'Josef')).toBe('fol. 12, č. 5');
        expect(birthPage(data, 'Anna')).toBe('fol. 30, č. 7');
        expect(birthPage(data, 'Marie')).toBe('fol. 30, č. 7');
        const josef = Object.values(data.persons).find(x => x.firstName === 'Josef')!;
        expect(data.sources?.[josef.deathSourceIds![0]]?.reference).toBe('fol. 99, č. 41');
    });

    it('the export writes each citation\'s own page, and a second round changes nothing', () => {
        const first = exportToGedcom(importGed(BOOK)).content;
        const cited = first.split('\n').filter(l => / PAGE /.test(l) && l.startsWith('3 '));
        expect(cited).toEqual(['3 PAGE fol. 12, č. 5', '3 PAGE fol. 99, č. 41', '3 PAGE fol. 30, č. 7', '3 PAGE fol. 30, č. 7']);
        const again = importGed(first);
        expect(pages(again)).toEqual(['fol. 12, č. 5', 'fol. 30, č. 7', 'fol. 99, č. 41']);
        const body = (g: string) => g.slice(g.indexOf('0 @SUBM1@'));
        expect(body(exportToGedcom(again).content)).toBe(body(first));
    });

    it('a record with its own page keeps it; only a citation of another page gets its own source', () => {
        const ged = head
            + '0 @I1@ INDI\n1 NAME Josef /Novák/\n1 SEX M\n'
            + '1 BIRT\n2 SOUR @S1@\n3 PAGE fol. 1\n'
            + '1 DEAT\n2 SOUR @S1@\n3 PAGE fol. 2\n'
            + '0 @S1@ SOUR\n1 TITL Kniha\n1 PAGE fol. 1\n0 TRLR\n';
        const data = importGed(ged);
        expect(pages(data)).toEqual(['fol. 1', 'fol. 2']);
    });

    it('citations without a page, or all of one page, keep one source', () => {
        const ged = head
            + '0 @I1@ INDI\n1 NAME Josef /Novák/\n1 SEX M\n'
            + '1 BIRT\n2 SOUR @S1@\n3 PAGE fol. 7\n'
            + '1 DEAT\n2 SOUR @S1@\n'
            + '0 @I2@ INDI\n1 NAME Anna /Nováková/\n1 SEX F\n1 BIRT\n2 SOUR @S1@\n3 PAGE fol. 7\n'
            + '0 @S1@ SOUR\n1 TITL Kniha\n0 TRLR\n';
        expect(pages(importGed(ged))).toEqual(['fol. 7']);
    });
});
