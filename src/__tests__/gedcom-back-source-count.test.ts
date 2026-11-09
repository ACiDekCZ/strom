/**
 * Two source records of another program's file, cited at many events, each
 * citation with a page of its own. The import makes one source per page
 * cited (a source is one entry in Strom, its reference the page), and "Back
 * to {prog}" writes them as the two records again, the pages on the
 * citations. The export's summary counts what the file carries: 2 sources,
 * not one per citation.
 */
import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { backSourceRecordCount, exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { countCitations } from '../privacy.js';
import { StromData } from '../types.js';

const NAMES = ['Bořivoj', 'Ludmila', 'Vendelín', 'Apolena', 'Kvirin', 'Ermelinda', 'Hostivít', 'Zbyslava', 'Radhost', 'Dobroslava'];

/** Ten people of an older program's file, born per the first register and married per the second. */
function registerFile(): string {
    const out = ['0 HEAD', '1 SOUR FamilyApp', '2 VERS 5.2', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8'];
    let fol = 12;
    NAMES.forEach((name, i) => {
        out.push(`0 @I${i + 1}@ INDI`, `1 NAME ${name} /Kmínek/`, `1 SEX ${i % 2 ? 'F' : 'M'}`,
            '1 BIRT', `2 DATE ${1840 + i}`, '2 SOUR @S1@', `3 PAGE fol. ${fol}`);
        fol += 3;
        if (i < 4) out.push('1 EVEN', '2 TYPE Confirmation', `2 DATE ${1852 + i}`, '2 SOUR @S2@', `3 PAGE fol. ${fol}`);
        fol += 3;
    });
    out.push('0 @S1@ SOUR', '1 TITL Matrika narozených Horní Kmínov 1840–1880', '1 AUTH Farní úřad Horní Kmínov',
        '0 @S2@ SOUR', '1 TITL Matrika biřmovaných Horní Kmínov 1850–1900', '0 TRLR', '');
    return out.join('\n');
}

function load(): StromData {
    const r = convertToStrom(parseGedcom(registerFile()), { importOrigin: { at: '2026-11-09', file: 'kminov.ged', encoding: 'utf-8' } });
    return migrateData(r.data);
}

const sourceRecords = (ged: string): string[] => ged.split(/\r?\n/).filter(l => /^0 @[^@]+@ SOUR$/.test(l));

describe('"Back to {prog}" counts the source records it writes', () => {
    it('two records cited at 14 pages: 14 entries in the tree, 2 records back, the summary says 2', () => {
        const data = load();
        // The tree's model: one source per page cited (an entry each).
        expect(Object.keys(data.sources ?? {})).toHaveLength(14);
        expect(countCitations(data)).toBe(14);
        const backTo = data.imports![0].id;
        const ged = exportToGedcom(data, 'Kmínek', { backTo }).content;
        expect(sourceRecords(ged)).toHaveLength(2);
        expect(ged.split('\n').filter(l => /^\d SOUR @/.test(l) && !l.startsWith('0'))).toHaveLength(14);
        expect(backSourceRecordCount(data, backTo)).toBe(2);
    });

    it('a title edited here makes a record of its own, and the count follows the file', () => {
        const data = load();
        const one = Object.values(data.sources!).find(s => s.reference === 'fol. 15')!;
        one.title = 'Matrika narozených Horní Kmínov (opis)';
        const backTo = data.imports![0].id;
        const ged = exportToGedcom(data, 'Kmínek', { backTo }).content;
        expect(sourceRecords(ged)).toHaveLength(3);
        expect(backSourceRecordCount(data, backTo)).toBe(3);
    });

    it('without an import to go back to, every source is a record of its own', () => {
        const data = load();
        expect(backSourceRecordCount(data, undefined)).toBe(14);
        expect(sourceRecords(exportToGedcom(data, 'Kmínek').content)).toHaveLength(14);
        delete data.imports;
        expect(backSourceRecordCount(data, 'I1')).toBe(14);
    });
});
