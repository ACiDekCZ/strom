/**
 * Original ids from a GEDCOM import (spec 066 K3.2): a file another program
 * wrote leaves each person and family its xref and id lines there (`_UID`,
 * `UID`, `RIN`, `EXID` + TYPE, `_FSFTID`, `AFN`); Strom's own file carries
 * them under `1 _STROM_IMPORT Ix`; "Back to {prog}" writes the program's
 * xrefs back where they are safe, the id lines as level-1 lines, and an xref
 * it cannot use as REFN.
 */
import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom, GedcomImportOrigin } from '../ged-parser.js';
import { exportToGedcom, isSafeXref } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { applyLivingPrivacy } from '../privacy.js';
import {
    carryMergedImports, cleanImportOrigin, keepImports, ORIGIN_IDS_FEATURE, remapHolderImports,
} from '../import-origin.js';
import { OriginalIds, Partnership, Person, PersonId, StromData } from '../types.js';

const ORIGIN: GedcomImportOrigin = { at: '2026-11-08', file: 'export.ged', encoding: 'utf-8' };

const MYHERITAGE = `0 HEAD
1 SOUR MYHERITAGE
2 NAME MyHeritage Family Tree Builder
2 VERS 5.5.1
1 DATE 2 OCT 2026
1 CHAR UTF-8
0 @I500001@ INDI
1 _UPD 2 OCT 2026 10:00:00 GMT -0500
1 NAME Hromoslav /Ozubec/
1 SEX M
1 BIRT
2 DATE 1880
1 FAMS @F500001@
1 RIN MH:I500001
1 _UID 5F3A1B2C3D4E5F60718293A4B5C6D7E8
0 @I500002@ INDI
1 NAME Libuna /Šťovíková/
1 SEX F
1 FAMS @F500001@
1 RIN MH:I500002
1 _UID 6A3A1B2C3D4E5F60718293A4B5C6D7E9
0 @I500003@ INDI
1 NAME Mlhoň /Ozubec/
1 SEX M
1 FAMC @F500001@
1 RIN MH:I500003
1 _UID 7B3A1B2C3D4E5F60718293A4B5C6D7EA
0 @F500001@ FAM
1 HUSB @I500001@
1 WIFE @I500002@
1 CHIL @I500003@
1 RIN MH:F500001
1 _UID 8C3A1B2C3D4E5F60718293A4B5C6D7EB
0 TRLR
`;

const GRAMPS = `0 HEAD
1 SOUR Gramps
2 VERS 5.2.3
2 NAME Gramps
1 DATE 8 NOV 2026
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I0001@ INDI
1 NAME Quillon /Marbleworth/
1 SEX M
1 FAMS @F0001@
1 CHAN
2 DATE 8 NOV 2026
0 @I0002@ INDI
1 NAME Tansy /Marbleworth/
1 SEX F
1 FAMS @F0001@
0 @F0001@ FAM
1 HUSB @I0001@
1 WIFE @I0002@
0 TRLR
`;

const ROOTSMAGIC = `0 HEAD
1 SOUR RootsMagic
2 NAME RootsMagic
2 VERS 9.0
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Odalric /Fennelby/
1 SEX M
1 _FSFTID KWCB-HZ2
1 AFN 9XQ4-7LM
1 FAMS @F1@
0 @I2@ INDI
1 NAME Wrenna /Fennelby/
1 SEX F
1 _FSFTID LZ7K-3PD
1 FAMS @F1@
0 @I3@ INDI
1 NAME Corvin /Fennelby/
1 SEX M
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
0 TRLR
`;

const FS_TYPE = 'https://www.familysearch.org/ark:/61903/4:1:';
const GEDCOM7 = `0 HEAD
1 GEDC
2 VERS 7.0
1 SOUR Thistlewade
2 NAME Thistlewade Genealogy
0 @I-1@ INDI
1 NAME Quillon /Thistlewade/
1 SEX M
1 UID 0c2b1c9e-6a8b-4f33-9a8a-1b2c3d4e5f60
1 EXID KWCB-HZ2
2 TYPE ${FS_TYPE}
1 FAMS @FAMILY_WITH_A_LONG_NAME_1@
0 @I2@ INDI
1 NAME Tansy /Fennelby/
1 SEX F
1 FAMS @FAMILY_WITH_A_LONG_NAME_1@
0 @FAMILY_WITH_A_LONG_NAME_1@ FAM
1 HUSB @I-1@
1 WIFE @I2@
1 EXID 77
2 TYPE https://example.org/families
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

function onlyCouple(data: StromData): Partnership {
    const list = Object.values(data.partnerships);
    expect(list).toHaveLength(1);
    return list[0];
}

/** The records of a file, each as its lines. */
function records(ged: string): string[][] {
    return ged.split(/\r?\n(?=0 )/).map(r => r.split(/\r?\n/));
}

/** The INDI record whose primary name starts with `first`. */
function personRecord(ged: string, first: string): string[] {
    return records(ged).find(r => / INDI$/.test(r[0]) && r.some(l => l.startsWith(`1 NAME ${first}`))) ?? [];
}

/** The xref of a person's record ("@I3@"). */
function xrefOf(ged: string, first: string): string {
    return personRecord(ged, first)[0]?.split(' ')[1] ?? '';
}

/** Every level-0 xref of a file. */
function allXrefs(ged: string): string[] {
    return records(ged).map(r => r[0].split(' ')[1]).filter(x => x?.startsWith('@'));
}

describe('reading another program’s file', () => {
    it('MyHeritage: the xref, _UID and RIN of each person and family, as written', () => {
        const { data, stats } = load(MYHERITAGE);
        expect(byName(data, 'Hromoslav').originalIds).toEqual([{
            from: 'I1', xref: 'I500001',
            ids: [{ tag: 'RIN', value: 'MH:I500001' }, { tag: '_UID', value: '5F3A1B2C3D4E5F60718293A4B5C6D7E8' }],
        }]);
        expect(onlyCouple(data).originalIds).toEqual([{
            from: 'I1', xref: 'F500001',
            ids: [{ tag: 'RIN', value: 'MH:F500001' }, { tag: '_UID', value: '8C3A1B2C3D4E5F60718293A4B5C6D7EB' }],
        }]);
        expect(stats.unsupportedTags).toBe(0);
    });

    it('FamilySearch ids (_FSFTID, AFN) are kept and no longer counted as unsupported', () => {
        const { data, stats } = load(ROOTSMAGIC);
        expect(byName(data, 'Odalric').originalIds).toEqual([{
            from: 'I1', xref: 'I1', ids: [{ tag: '_FSFTID', value: 'KWCB-HZ2' }, { tag: 'AFN', value: '9XQ4-7LM' }],
        }]);
        expect(byName(data, 'Corvin').originalIds).toEqual([{ from: 'I1', xref: 'I3' }]);
        expect(stats.droppedTagSummary).not.toMatch(/_FSFTID|AFN/);
    });

    it('GEDCOM 7: UID and EXID with its TYPE, on a person and a family', () => {
        const { data } = load(GEDCOM7);
        expect(byName(data, 'Quillon').originalIds).toEqual([{
            from: 'I1', xref: 'I-1', ids: [
                { tag: 'UID', value: '0c2b1c9e-6a8b-4f33-9a8a-1b2c3d4e5f60' },
                { tag: 'EXID', value: 'KWCB-HZ2', type: FS_TYPE },
            ],
        }]);
        expect(onlyCouple(data).originalIds).toEqual([{
            from: 'I1', xref: 'FAMILY_WITH_A_LONG_NAME_1', ids: [{ tag: 'EXID', value: '77', type: 'https://example.org/families' }],
        }]);
    });

    it('nothing is kept without importOrigin', () => {
        const { data } = load(MYHERITAGE, null);
        expect(Object.values(data.persons).some(p => p.originalIds)).toBe(false);
    });
});

describe('Strom’s own file', () => {
    it('carries the ids under 1 _STROM_IMPORT and reads them back; its own xrefs never become original ones', () => {
        const data = migrateData(load(MYHERITAGE).data);
        const ged = exportToGedcom(data).content;
        const rec = personRecord(ged, 'Hromoslav');
        const at = rec.indexOf('1 _STROM_IMPORT I1');
        expect(rec.slice(at, at + 4)).toEqual([
            '1 _STROM_IMPORT I1', '2 _XREF @I500001@', '2 RIN MH:I500001', '2 _UID 5F3A1B2C3D4E5F60718293A4B5C6D7E8',
        ]);
        // A plain export writes no id line of its own at level 1 and keeps Strom's xrefs.
        expect(rec.some(l => /^1 (_UID|RIN) /.test(l))).toBe(false);
        expect(xrefOf(ged, 'Hromoslav')).toMatch(/^@I\d@$/);

        const back = migrateData(load(ged, { at: '2026-12-01', file: 'strom.ged' }).data);
        for (const first of ['Hromoslav', 'Libuna', 'Mlhoň']) {
            expect(byName(back, first).originalIds).toEqual(byName(data, first).originalIds);
        }
        expect(onlyCouple(back).originalIds).toEqual(onlyCouple(data).originalIds);
        // And out again: the same lines.
        expect(exportToGedcom(back).content.split('\n').filter(l => /^2 (_XREF|_UID|RIN) /.test(l)))
            .toEqual(ged.split('\n').filter(l => /^2 (_XREF|_UID|RIN) /.test(l)));
    });

    it('the EXID TYPE goes under its line at level 3 and comes back', () => {
        const data = migrateData(load(GEDCOM7).data);
        const ged = exportToGedcom(data).content;
        const rec = personRecord(ged, 'Quillon');
        expect(rec).toContain('2 _XREF @I-1@');
        const i = rec.indexOf('2 EXID KWCB-HZ2');
        expect(rec[i + 1]).toBe(`3 TYPE ${FS_TYPE}`);
        const back = migrateData(load(ged, { at: '2026-12-01' }).data);
        expect(byName(back, 'Quillon').originalIds).toEqual(byName(data, 'Quillon').originalIds);
    });

    it('a second 1 _STROM_IMPORT only brings ids: the person still came from the first', () => {
        const data = migrateData(load(MYHERITAGE).data);
        data.imports!.push({ id: 'I2', program: 'Gramps', at: '2026-11-09' });
        const h = byName(data, 'Hromoslav');
        h.originalIds!.push({ from: 'I2', xref: 'I0001' });
        const ged = exportToGedcom(data).content;
        const rec = personRecord(ged, 'Hromoslav');
        expect(rec.filter(l => l.startsWith('1 _STROM_IMPORT'))).toEqual(['1 _STROM_IMPORT I1', '1 _STROM_IMPORT I2']);
        expect(rec[rec.indexOf('1 _STROM_IMPORT I2') + 1]).toBe('2 _XREF @I0001@');
        const back = migrateData(load(ged, { at: '2026-12-01' }).data);
        const h2 = byName(back, 'Hromoslav');
        expect(h2.importId).toBe('I1');
        expect(h2.originalIds).toEqual(h.originalIds);
    });

    it('the file for the research carries the same block', () => {
        const data = migrateData(load(ROOTSMAGIC).data);
        const ged = exportToGedcom(data, 'Fennelby', { research: { id: 'r-test' }, titles: 'tags', readings: false }).content;
        const rec = personRecord(ged, 'Odalric');
        const at = rec.indexOf('1 _STROM_IMPORT I1');
        expect(rec.slice(at, at + 4)).toEqual(['1 _STROM_IMPORT I1', '2 _XREF @I1@', '2 _FSFTID KWCB-HZ2', '2 AFN 9XQ4-7LM']);
    });

    it('ids of an import the file does not know, and an invalid entry, are dropped', () => {
        const data = migrateData(load(ROOTSMAGIC).data);
        const ged = exportToGedcom(data).content.replace('1 _STROM_IMPORT I1\n2 _XREF @I1@', '1 _STROM_IMPORT I7\n2 _XREF @I1@');
        const back = migrateData(load(ged, { at: '2026-12-01' }).data);
        expect(byName(back, 'Odalric').originalIds).toBeUndefined();
        expect(byName(back, 'Wrenna').originalIds).toEqual([{ from: 'I1', xref: 'I2', ids: [{ tag: '_FSFTID', value: 'LZ7K-3PD' }] }]);
    });
});

describe('Back to {prog}', () => {
    it('MyHeritage: the same xrefs and id lines as the file had', () => {
        const data = migrateData(load(MYHERITAGE).data);
        const ged = exportToGedcom(data, 'Ozubec', { backTo: 'I1' }).content;
        expect(xrefOf(ged, 'Hromoslav')).toBe('@I500001@');
        expect(xrefOf(ged, 'Libuna')).toBe('@I500002@');
        expect(xrefOf(ged, 'Mlhoň')).toBe('@I500003@');
        const rec = personRecord(ged, 'Hromoslav');
        expect(rec).toContain('1 RIN MH:I500001');
        expect(rec).toContain('1 _UID 5F3A1B2C3D4E5F60718293A4B5C6D7E8');
        expect(rec).toContain('1 FAMS @F500001@');
        expect(rec.some(l => l.startsWith('1 REFN'))).toBe(false);
        const fam = records(ged).find(r => r[0] === '0 @F500001@ FAM')!;
        expect(fam).toEqual(expect.arrayContaining(['1 HUSB @I500001@', '1 WIFE @I500002@', '1 CHIL @I500003@',
            '1 RIN MH:F500001', '1 _UID 8C3A1B2C3D4E5F60718293A4B5C6D7EB']));
        expect(new Set(allXrefs(ged)).size).toBe(allXrefs(ged).length);
    });

    it('Gramps: @I0001@ and @F0001@ come back', () => {
        const data = migrateData(load(GRAMPS).data);
        const ged = exportToGedcom(data, 'Marbleworth', { backTo: 'I1' }).content;
        expect(xrefOf(ged, 'Quillon')).toBe('@I0001@');
        expect(xrefOf(ged, 'Tansy')).toBe('@I0002@');
        expect(records(ged).some(r => r[0] === '0 @F0001@ FAM')).toBe(true);
    });

    it('GEDCOM 7: EXID with TYPE at level 1; an xref of the wrong form goes as REFN with the program', () => {
        const data = migrateData(load(GEDCOM7).data);
        const ged = exportToGedcom(data, 'Thistlewade', { backTo: 'I1' }).content;
        const rec = personRecord(ged, 'Quillon');
        expect(xrefOf(ged, 'Quillon')).toMatch(/^@I\d+@$/);              // I-1 is no 5.5.1 xref
        const refn = rec.indexOf('1 REFN I-1');
        expect(refn).toBeGreaterThan(0);
        expect(rec[refn + 1]).toBe('2 TYPE Thistlewade Genealogy xref');
        const exid = rec.indexOf('1 EXID KWCB-HZ2');
        expect(rec[exid + 1]).toBe(`2 TYPE ${FS_TYPE}`);
        expect(rec).toContain('1 UID 0c2b1c9e-6a8b-4f33-9a8a-1b2c3d4e5f60');
        expect(xrefOf(ged, 'Tansy')).toBe('@I2@');
        // A family xref longer than 22 characters cannot be used either.
        const fam = records(ged).find(r => / FAM$/.test(r[0]))!;
        expect(fam[0]).not.toContain('FAMILY_WITH');
        expect(fam).toContain('1 REFN FAMILY_WITH_A_LONG_NAME_1');
    });

    it('generated xrefs go around the original ones (people, families, sources share the names)', () => {
        const data = migrateData(load(ROOTSMAGIC).data);
        // A person added here, a source, and a family-less parent link.
        const odalric = byName(data, 'Odalric');
        const newcomer: Person = {
            id: 'p_new' as PersonId, firstName: 'Wrenna', lastName: 'Ozubcová', gender: 'female', isPlaceholder: false,
            parentIds: [], childIds: [], partnerships: [],
        };
        data.persons[newcomer.id] = newcomer;
        // An original xref that looks like a source's.
        byName(data, 'Wrenna').originalIds = [{ from: 'I1', xref: 'S1' }];
        data.sources = { s1: { id: 's1', title: 'Parish book', repository: 'Archive' } } as StromData['sources'];
        odalric.sourceIds = ['s1'];
        const ged = exportToGedcom(data, 'Fennelby', { backTo: 'I1' }).content;
        expect(xrefOf(ged, 'Odalric')).toBe('@I1@');
        expect(xrefOf(ged, 'Wrenna /Fennelby')).toBe('@S1@');
        expect(xrefOf(ged, 'Corvin')).toBe('@I3@');
        // The first number free: neither I1 nor I3.
        expect(xrefOf(ged, 'Wrenna /Ozubcová')).toBe('@I2@');
        expect(records(ged).find(r => / SOUR$/.test(r[0]))![0]).toBe('0 @S2@ SOUR');
        expect(records(ged).some(r => r[0] === '0 @F1@ FAM')).toBe(true);
        const xs = allXrefs(ged).map(x => x.toUpperCase());
        expect(new Set(xs).size).toBe(xs.length);
        expect(xs).toContain('@SUBM1@');
    });

    it('two people claiming the same original xref: neither gets it, both carry it as REFN', () => {
        const data = migrateData(load(ROOTSMAGIC).data);
        byName(data, 'Corvin').originalIds = [{ from: 'I1', xref: 'I1' }];
        const ged = exportToGedcom(data, 'Fennelby', { backTo: 'I1' }).content;
        expect(xrefOf(ged, 'Odalric')).not.toBe('@I1@');
        expect(xrefOf(ged, 'Corvin')).not.toBe('@I1@');
        expect(allXrefs(ged)).not.toContain('@I1@');
        for (const first of ['Odalric', 'Corvin']) {
            const rec = personRecord(ged, first);
            expect(rec[rec.indexOf('1 REFN I1') + 1]).toBe('2 TYPE RootsMagic xref');
        }
        expect(personRecord(ged, 'Odalric')).toContain('1 _FSFTID KWCB-HZ2');
        expect(xrefOf(ged, 'Wrenna')).toBe('@I2@');
    });

    it('the import it goes back to wins over an older file of the same program; another program’s ids stay out', () => {
        const data = migrateData(load(ROOTSMAGIC).data);
        data.imports!.push({ id: 'I2', program: 'RootsMagic', at: '2026-11-09' }, { id: 'I3', program: 'Gramps', at: '2026-11-10' });
        // The newer RootsMagic file numbers Wrenna I1; the older one gave I1 to Odalric.
        byName(data, 'Wrenna').originalIds = [{ from: 'I2', xref: 'I1' }, { from: 'I3', xref: 'I0002', ids: [{ tag: '_UID', value: 'ABC' }] }];
        const ged = exportToGedcom(data, 'Fennelby', { backTo: 'I2' }).content;
        expect(xrefOf(ged, 'Wrenna')).toBe('@I1@');
        expect(xrefOf(ged, 'Odalric')).not.toBe('@I1@');
        expect(personRecord(ged, 'Odalric')).toContain('1 REFN I1');
        expect(personRecord(ged, 'Wrenna').some(l => l.startsWith('1 _UID'))).toBe(false);
    });

    it('without backTo the export is as before: Strom’s own numbering', () => {
        const data = migrateData(load(MYHERITAGE).data);
        const ged = exportToGedcom(data).content;
        expect(allXrefs(ged).filter(x => /^@I/.test(x)).sort()).toEqual(['@I1@', '@I2@', '@I3@']);
        expect(ged).not.toMatch(/^1 REFN/m);
    });

    it('the xref form check', () => {
        expect(isSafeXref('I500001')).toBe(true);
        expect(isSafeXref('F0001')).toBe(true);
        expect(isSafeXref('P_12')).toBe(true);
        expect(isSafeXref('I-1')).toBe(false);
        expect(isSafeXref('')).toBe(false);
        expect(isSafeXref('X'.repeat(20))).toBe(true);
        expect(isSafeXref('X'.repeat(21))).toBe(false);
    });
});

describe('privacy', () => {
    it('a living person hidden by the export keeps no id of the other system; the deceased keep theirs', () => {
        const living = ROOTSMAGIC.replace('1 NAME Wrenna /Fennelby/\n', '1 NAME Wrenna /Fennelby/\n1 BIRT\n2 DATE 1990\n')
            .replace('1 NAME Odalric /Fennelby/\n', '1 NAME Odalric /Fennelby/\n1 DEAT\n2 DATE 1950\n');
        const data = migrateData(load(living).data);
        const filtered = applyLivingPrivacy(data, 'initials', 2026);
        const w = filtered.persons[byName(data, 'Wrenna').id];
        expect(w.originalIds).toBeUndefined();
        expect(onlyCouple(filtered).originalIds).toBeUndefined();
        expect(filtered.persons[byName(data, 'Odalric').id].originalIds).toEqual(byName(data, 'Odalric').originalIds);
        const ged = exportToGedcom(filtered).content;
        expect(ged).not.toContain('LZ7K-3PD');
        expect(ged).toContain('KWCB-HZ2');
    });
});

describe('keeping the ids', () => {
    it('a tree without ids loads unchanged', () => {
        const data = migrateData(load(MYHERITAGE).data);
        for (const p of Object.values(data.persons)) delete p.originalIds;
        for (const ps of Object.values(data.partnerships)) delete ps.originalIds;
        const before = JSON.stringify(data);
        expect(JSON.stringify(migrateData(JSON.parse(before)))).toBe(before);
    });

    it('a tree with ids loads unchanged', () => {
        const data = migrateData(load(GEDCOM7).data);
        const before = JSON.stringify(data);
        expect(JSON.stringify(migrateData(JSON.parse(before)))).toBe(before);
    });

    it('cleaning drops entries of unknown imports, bad lines and empty entries', () => {
        const data = migrateData(load(ROOTSMAGIC).data);
        const o = byName(data, 'Odalric');
        o.originalIds = [
            { from: 'I1', xref: '@I1@', ids: [{ tag: '_fsftid', value: ' KWCB-HZ2 ' }, { tag: 'NAME', value: 'x' }, { tag: 'AFN', value: '' }] },
            { from: 'I9', xref: 'I4' },
            { from: 'I1' },
            'junk',
        ] as unknown as OriginalIds[];
        cleanImportOrigin(data, data.imports);
        expect(o.originalIds).toEqual([{ from: 'I1', xref: 'I1', ids: [{ tag: '_FSFTID', value: 'KWCB-HZ2' }] }]);
        const w = byName(data, 'Wrenna');
        w.originalIds = [{ from: 'I9', xref: 'I2' }];
        cleanImportOrigin(data, data.imports);
        expect(w.originalIds).toBeUndefined();
    });

    it('merging holders joins the ids of both without duplicates; a remap renames and joins them', () => {
        const a = { id: 'a', originalIds: [{ from: 'I1', xref: 'I1', ids: [{ tag: '_UID', value: 'U1' }] }] } as unknown as Person;
        const b = {
            id: 'b', originalIds: [
                { from: 'I1', xref: 'I9', ids: [{ tag: '_UID', value: 'U1' }, { tag: 'RIN', value: '9' }] },
                { from: 'I2', xref: 'P5' },
            ],
        } as unknown as Person;
        carryMergedImports(a, structuredClone(a), b, new Map([['I2', 'I3']]));
        expect(a.originalIds).toEqual([
            { from: 'I1', xref: 'I1', ids: [{ tag: '_UID', value: 'U1' }, { tag: 'RIN', value: '9' }] },
            { from: 'I3', xref: 'P5' },
        ]);
        remapHolderImports(a, new Map([['I3', 'I1']]));
        expect(a.originalIds).toEqual([
            { from: 'I1', xref: 'I1', ids: [{ tag: '_UID', value: 'U1' }, { tag: 'RIN', value: '9' }] },
        ]);
    });

    it('a research version without origin.ids: the tree keeps its ids; with it the research’s file counts', () => {
        const previous = migrateData(load(ROOTSMAGIC).data);
        let n = 0;
        for (const p of Object.values(previous.persons)) p.refn = `P${++n}`;
        const next = structuredClone(previous);
        for (const p of Object.values(next.persons)) delete p.originalIds;
        for (const ps of Object.values(next.partnerships)) delete ps.originalIds;
        const kept = keepImports(next, previous);
        expect(byName(kept, 'Odalric').originalIds).toEqual(byName(previous, 'Odalric').originalIds);
        expect(onlyCouple(kept).originalIds).toEqual(onlyCouple(previous).originalIds);
        // The research's own ids (once it sends them) come first.
        byName(next, 'Wrenna').originalIds = [{ from: 'I1', xref: 'I22' }];
        expect(byName(keepImports(next, previous), 'Wrenna').originalIds).toEqual([{ from: 'I1', xref: 'I22' }]);
        const withFeature = keepImports(next, previous, [ORIGIN_IDS_FEATURE]);
        expect(byName(withFeature, 'Odalric').originalIds).toBeUndefined();
        expect(byName(withFeature, 'Wrenna').originalIds).toEqual([{ from: 'I1', xref: 'I22' }]);
    });
});
