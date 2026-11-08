/**
 * Origin of facts in a GEDCOM import (spec 066): a file another program wrote
 * becomes one import record and marks everything it holds; Strom's own file
 * keeps the records and marks it carries; the export writes a mark only where
 * the value is still the file's, and a filtered export leaks none.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseGedcom, convertToStrom, GedcomImportOrigin } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { applyContentOptions, applyLivingPrivacy } from '../privacy.js';
import { factImportTags, isFromImport, localIsoDay, parseImportMark } from '../import-origin.js';
import { createMergeState } from '../merge/index.js';
import { executeMerge } from '../merge/executor.js';
import { StorageManager } from '../storage.js';
import { Person, StromData } from '../types.js';

const SHA = 'ab'.repeat(32);
const ORIGIN: GedcomImportOrigin = { at: '2026-11-08', file: 'rodokmen.ged', encoding: 'windows-1250', sha: SHA };

const FOREIGN = `0 HEAD
1 SOUR RODOKMENAR
2 NAME Rodokmenář
2 VERS 5.2
1 DATE 12 MAR 2024
2 TIME 10:00
1 FILE stary-rodokmen.ged
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Zbyhněv /Lanýžek/
1 SEX M
1 BIRT
2 DATE 1 JAN 1850
2 PLAC Kvasilov
1 OCCU Pecivál
1 DEAT
2 DATE 4 FEB 1910
1 FAMS @F1@
0 @I2@ INDI
1 NAME Bořislava /Hvězdoňová/
1 SEX F
1 DEAT Y
1 FAMS @F1@
0 @I3@ INDI
1 NAME Drahomil /Lanýžek/
1 SEX M
1 BIRT
2 DATE 3 MAR 1877
1 DEAT
2 DATE 1950
1 FAMC @F1@
1 SOUR @S1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 MARR
2 DATE 2 MAY 1875
2 PLAC Úlehle
0 @S1@ SOUR
1 TITL Matrika Kvasilov
0 TRLR
`;

function load(text: string, origin: GedcomImportOrigin | null = ORIGIN) {
    return convertToStrom(parseGedcom(text), origin ? { importOrigin: origin } : {});
}

function byName(data: StromData, first: string): Person {
    const p = Object.values(data.persons).find(x => x.firstName === first);
    if (!p) throw new Error(`no ${first}`);
    return p;
}

/** The lines of a record (from its level-0 line to the next one). */
function recordLines(ged: string, start: RegExp): string[] {
    const lines = ged.split(/\r?\n/);
    const i = lines.findIndex(l => start.test(l));
    if (i < 0) return [];
    const end = lines.findIndex((l, j) => j > i && l.startsWith('0 '));
    return lines.slice(i, end < 0 ? undefined : end);
}

/** The INDI record whose primary name starts with `first`. */
function personRecord(ged: string, first: string): string[] {
    const records = ged.split(/\r?\n(?=0 )/).map(r => r.split(/\r?\n/));
    return records.find(r => / INDI$/.test(r[0]) && r.some(l => l.startsWith(`1 NAME ${first}`))) ?? [];
}

/** The level-2 lines under a level-1 tag of a record. */
function factBlock(record: string[], level1: string): string[] {
    const i = record.findIndex(l => l === `1 ${level1}` || l.startsWith(`1 ${level1} `));
    if (i < 0) return [];
    const end = record.findIndex((l, j) => j > i && l.startsWith('1 '));
    return record.slice(i + 1, end < 0 ? undefined : end);
}

describe('a file another program wrote', () => {
    it('becomes one import record with the program, version, date, file, encoding and hash', () => {
        const result = load(FOREIGN);
        expect(result.importId).toBe('I1');
        expect(result.data.imports).toEqual([{
            id: 'I1', program: 'Rodokmenář', version: '5.2', fileDate: '12 MAR 2024', at: '2026-11-08',
            file: 'rodokmen.ged', encoding: 'windows-1250', sha: SHA,
        }]);
    });

    it('the header SOUR value names the program when there is no NAME; HEAD FILE stands in for a missing name', () => {
        const text = FOREIGN.replace('2 NAME Rodokmenář\n', '');
        const result = load(text, { at: '2026-11-08' });
        expect(result.data.imports?.[0]).toMatchObject({ program: 'RODOKMENAR', file: 'stary-rodokmen.ged' });
    });

    it('marks every fact, name, sex, couple fact, parent link and source', () => {
        const data = migrateData(load(FOREIGN).data);
        const z = byName(data, 'Zbyhněv');
        expect(z.importId).toBe('I1');
        for (const key of ['firstName', 'lastName', 'gender', 'birthDate', 'birthPlace', 'deathDate']) {
            expect(isFromImport(z, key), key).toBe(true);
        }
        const occ = z.events!.find(e => e.type === 'occupation')!;
        expect(z.importedValues?.[`event:${occ.id}.value`]).toEqual({ from: 'I1', value: 'Pecivál' });
        const couple = Object.values(data.partnerships)[0];
        expect(couple.importId).toBe('I1');
        expect(isFromImport(couple, 'startDate')).toBe(true);
        expect(isFromImport(couple, 'startPlace')).toBe(true);
        const kid = byName(data, 'Drahomil');
        expect(Object.keys(kid.importedParents ?? {}).sort()).toEqual([...kid.parentIds].sort());
        expect(Object.values(data.sources ?? {})[0].importId).toBe('I1');
    });

    it('nothing is recorded without importOrigin (the research reads and JSON stay as they were)', () => {
        const data = load(FOREIGN, null).data;
        expect(data.imports).toBeUndefined();
        expect(JSON.stringify(data)).not.toMatch(/importId|importedValues|importedParents/);
    });

    it('marks of ours in a foreign file are never read: everything is that file’s import', () => {
        const forged = FOREIGN
            .replace('1 CHAR UTF-8\n', '1 CHAR UTF-8\n1 _STROM_IMPORT I7\n2 SOUR Podvrh\n2 _AT 2020-01-01\n')
            .replace('0 @I1@ INDI\n', '0 @I1@ INDI\n1 _STROM_IMPORT I7\n')
            .replace('2 PLAC Kvasilov\n', '2 PLAC Kvasilov\n2 _STROM_IMPORT I7 PLAC\n2 _STROM_ORIGIN user\n2 _STROM_WAS 3 JAN 1850\n3 _STROM_IMPORT I7\n3 _PART DATE\n')
            .replace('1 CHIL @I3@\n', '1 CHIL @I3@\n2 _STROM_IMPORT I7\n');
        const result = load(forged);
        expect(result.data.imports?.map(r => r.id)).toEqual(['I1']);
        expect(result.data.imports?.[0].program).toBe('Rodokmenář');
        expect(JSON.stringify(result.data)).not.toContain('I7');
        const z = byName(result.data, 'Zbyhněv');
        expect(z.importedValues?.birthDate).toEqual({ from: 'I1', value: '1850-01-01' });
        expect(z.importedValues?.birthPlace).toEqual({ from: 'I1', value: 'Kvasilov' });
        expect(z.researchOrigins).toBeUndefined();
    });
});

describe('the export', () => {
    it('writes the records in the header and a mark under every record and fact still from the file', () => {
        const data = migrateData(load(FOREIGN).data);
        const { content: ged } = exportToGedcom(data);
        const head = recordLines(ged, /^0 HEAD$/);
        const i = head.indexOf('1 _STROM_IMPORT I1');
        expect(head.slice(i, i + 7)).toEqual([
            '1 _STROM_IMPORT I1', '2 SOUR Rodokmenář', '2 VERS 5.2', '2 DATE 12 MAR 2024', '2 _AT 2026-11-08',
            '2 FILE rodokmen.ged', `2 _SHA ${SHA}`,
        ]);
        const indi = personRecord(ged, 'Zbyhněv');
        expect(indi[1]).toBe('1 _STROM_IMPORT I1');
        expect(factBlock(indi, 'NAME')).toContain('2 _STROM_IMPORT I1');
        expect(factBlock(indi, 'SEX')).toEqual(['2 _STROM_IMPORT I1']);
        expect(factBlock(indi, 'BIRT')).toContain('2 _STROM_IMPORT I1');
        expect(factBlock(indi, 'OCCU')).toContain('2 _STROM_IMPORT I1');
        const fam = recordLines(ged, /^0 @F\d+@ FAM$/);
        expect(fam[1]).toBe('1 _STROM_IMPORT I1');
        expect(factBlock(fam, 'MARR')).toContain('2 _STROM_IMPORT I1');
        expect(factBlock(fam, 'CHIL')).toEqual(['2 _STROM_IMPORT I1']);
        expect(recordLines(ged, /^0 @S\d+@ SOUR$/)[1]).toBe('1 _STROM_IMPORT I1');
    });

    it('a changed value loses its mark; the parts still from the file are listed', () => {
        const data = migrateData(load(FOREIGN).data);
        const z = byName(data, 'Zbyhněv');
        z.birthPlace = 'Kvasilov u Úlehle';
        z.lastName = 'Lanýžková';
        expect(isFromImport(z, 'birthPlace')).toBe(false);
        expect(factImportTags(z, 'birth')).toEqual(['I1 DATE']);
        expect(factImportTags(z, 'name')).toEqual(['I1 GIVN']);
        const { content: ged } = exportToGedcom(data);
        const indi = personRecord(ged, 'Zbyhněv');
        expect(factBlock(indi, 'BIRT')).toContain('2 _STROM_IMPORT I1 DATE');
        expect(factBlock(indi, 'NAME')).toContain('2 _STROM_IMPORT I1 GIVN');
        // A fact wholly changed has no mark at all.
        z.birthDate = '1851-01-01';
        z.birthPlace = 'Úlehle';
        expect(factImportTags(z, 'birth')).toEqual([]);
        const again = personRecord(exportToGedcom(data).content, 'Zbyhněv');
        expect(factBlock(again, 'BIRT').some(l => l.includes('_STROM_IMPORT'))).toBe(false);
    });

    it('a privacy-filtered export leaks no imported value of what it hid', () => {
        const living = FOREIGN.replace('1 DEAT\n2 DATE 1950\n', '').replace('2 DATE 3 MAR 1877', '2 DATE 3 MAR 1977');
        const data = migrateData(load(living).data);
        const filtered = applyLivingPrivacy(data, 'initials', 2026);
        const kid = filtered.persons[byName(data, 'Drahomil').id];
        expect(kid.firstName).not.toBe('Drahomil');
        expect(kid.importedValues?.firstName).toBeUndefined();
        expect(kid.importedValues?.birthDate).toBeUndefined();
        expect(JSON.stringify(filtered)).not.toContain('Drahomil');
        const ged = exportToGedcom(filtered).content;
        const kidRecord = personRecord(ged, 'D.');
        expect(kidRecord.length).toBeGreaterThan(0);
        // The sex is shown as it came, so it keeps its mark; the hidden name and date do not.
        expect(factBlock(kidRecord, 'NAME').some(l => l.includes('_STROM_IMPORT'))).toBe(false);
        expect(factBlock(kidRecord, 'BIRT').some(l => l.includes('_STROM_IMPORT'))).toBe(false);
        expect(factBlock(kidRecord, 'SEX')).toEqual(['2 _STROM_IMPORT I1']);
        // Content left out takes its stored value with it.
        const noNotes = applyContentOptions(data, { photos: true, attachments: true, notes: false, sources: true });
        const z = byName(noNotes, 'Zbyhněv');
        for (const key of Object.keys(z.importedValues ?? {})) expect(key.endsWith('.value')).toBe(false);
    });
});

describe('Strom’s own file', () => {
    it('keeps the records and the marks as they are, the partial parts included', () => {
        const data = migrateData(load(FOREIGN).data);
        const z = byName(data, 'Zbyhněv');
        z.birthPlace = 'Úlehle';                                // a person’s now
        const kid = byName(data, 'Drahomil');
        const { content: ged } = exportToGedcom(data);
        const back = load(ged, { at: '2026-12-01', file: 'strom.ged', encoding: 'utf-8' });
        expect(back.importId).toBeUndefined();                  // no record of its own
        expect(back.data.imports).toEqual([{
            id: 'I1', program: 'Rodokmenář', version: '5.2', fileDate: '12 MAR 2024', at: '2026-11-08',
            file: 'rodokmen.ged', sha: SHA,
        }]);
        const z2 = byName(back.data, 'Zbyhněv');
        expect(z2.importId).toBe('I1');
        expect(isFromImport(z2, 'birthDate')).toBe(true);
        expect(z2.importedValues?.birthPlace).toBeUndefined();
        expect(isFromImport(z2, 'firstName')).toBe(true);
        expect(isFromImport(z2, 'gender')).toBe(true);
        expect(factImportTags(z2, 'birth')).toEqual(['I1 DATE']);
        const occ = z2.events!.find(e => e.type === 'occupation')!;
        expect(isFromImport(z2, `event:${occ.id}.value`)).toBe(true);
        const kid2 = byName(back.data, 'Drahomil');
        expect(Object.keys(kid2.importedParents ?? {}).length).toBe(kid.parentIds.length);
        const couple = Object.values(back.data.partnerships)[0];
        expect(couple.importId).toBe('I1');
        expect(isFromImport(couple, 'startPlace')).toBe(true);
        expect(Object.values(back.data.sources ?? {})[0].importId).toBe('I1');
        // And out again: the same marks.
        const twice = exportToGedcom(migrateData(back.data)).content;
        expect(twice.split('\n').filter(l => l.includes('_STROM_IMPORT')))
            .toEqual(ged.split('\n').filter(l => l.includes('_STROM_IMPORT')));
    });

    it('facts without a mark are a person’s; a mark naming no record is dropped', () => {
        const data = migrateData(load(FOREIGN, null).data);
        const ged = exportToGedcom(data).content
            .replace('0 @I1@ INDI\n', '0 @I1@ INDI\n1 _STROM_IMPORT I9\n');
        const back = load(ged).data;
        expect(back.imports).toBeUndefined();
        expect(JSON.stringify(back)).not.toMatch(/importId|importedValues|importedParents/);
    });

    it('origin and earlier values of the research are not read from a file', () => {
        const data = migrateData(load(FOREIGN).data);
        const ged = exportToGedcom(data).content
            .replace(/(1 BIRT\n)/, '$12 _STROM_ORIGIN user\n2 _STROM_WAS 3 JAN 1850\n3 _STROM_IMPORT I1\n3 _PART DATE\n');
        const back = load(ged).data;
        expect(JSON.stringify(back)).not.toContain('researchOrigins');
        expect(isFromImport(byName(back, 'Zbyhněv'), 'birthDate')).toBe(true);
    });
});

describe('merging a file into a tree', () => {
    beforeEach(() => { vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never); });

    it('marks only what came from the file and says which record it became', async () => {
        const existing: StromData = migrateData(load(FOREIGN, null).data);
        const z = byName(existing, 'Zbyhněv');
        delete z.birthDate;                                     // the file brings it
        existing.imports = [{ id: 'I1', program: 'Starší', at: '2026-01-01' }];
        const incoming = load(FOREIGN).data;
        const state = createMergeState(existing, incoming);
        for (const m of state.matches) state.decisions.set(m.incomingId, { type: 'confirm' } as never);
        const result = await executeMerge(state);
        expect(result.success).toBe(true);
        expect(result.importMap?.get('I1')).toBe('I2');
        const merged = byName(result.mergedData, 'Zbyhněv');
        expect(merged.importedValues?.birthDate).toEqual({ from: 'I2', value: '1850-01-01' });
        // The birth place the tree had is a person's, though the file says the same.
        expect(merged.importedValues?.birthPlace).toBeUndefined();
    });
});

describe('helpers', () => {
    it('parseImportMark reads the id and the parts, and nothing that is not one', () => {
        expect(parseImportMark('I1')).toEqual({ id: 'I1' });
        expect(parseImportMark(' I12  DATE plac ')).toEqual({ id: 'I12', parts: ['DATE', 'PLAC'] });
        expect(parseImportMark('R1 VAL')).toEqual({ id: 'R1', parts: ['VAL'] });
        expect(parseImportMark('I1 XYZ')).toBeNull();
        expect(parseImportMark('import I1')).toBeNull();
        expect(parseImportMark('')).toBeNull();
    });

    it('localIsoDay is the local calendar day', () => {
        expect(localIsoDay(new Date(2026, 10, 8, 23, 59))).toBe('2026-11-08');
    });
});
