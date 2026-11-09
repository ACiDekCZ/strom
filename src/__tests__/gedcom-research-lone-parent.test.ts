/**
 * The research's family of one parent alone (`1 WIFE` + `1 CHIL`…,
 * `1 _STROM_NO_COUPLE Y`, its `_STROM_IMPORT` with `_XREF` / `_UID`) goes
 * through the app whole: one "?" family of all its children, and the GEDCOM
 * for the research writes it as it came — one family, its import with its
 * ids and the no-couple mark. Read as loose links it became a family per
 * child without any of them (fictional people).
 */
import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { migrateData } from '../data.js';
import { researchGedcom } from '../ui/research-ui.js';
import { carryOverMedia } from '../research-link.js';
import { normalizeSingleParents } from '../single-parent.js';
import { StromData, Person, PersonId } from '../types.js';

const RESEARCH = `0 HEAD
1 SOUR STROM_RESEARCH
2 VERS 1.29.0
2 NAME Strom Research
1 DATE 9 NOV 2026
1 _STROM_TREE 7df304f5-0000-4b04-9183-000000000001
1 _STROM_HEAD 38d5173cdfd18fc104b8a7a4f1346cd47e4ff51d
1 _STROM_IMPORT R1
2 SOUR MYHERITAGE
2 _AT 2026-11-09
2 FILE ozubec.ged
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @P0001@ INDI
1 NAME Libuna /Ozubcová/
1 SEX F
1 REFN P0001
2 TYPE strom-research
1 _STROM_IMPORT R1
2 _XREF @I1@
2 _UID 0AF1B2C3D4E5F60718293A4B5C6D7E01
1 BIRT
2 DATE 1860
1 FAMS @F0001@
0 @P0002@ INDI
1 NAME Bořek /Ozubec/
1 SEX M
1 REFN P0002
2 TYPE strom-research
1 _STROM_IMPORT R1
2 _XREF @I2@
1 BIRT
2 DATE 1885
1 FAMC @F0001@
0 @P0003@ INDI
1 NAME Jarka /Ozubcová/
1 SEX F
1 REFN P0003
2 TYPE strom-research
1 _STROM_IMPORT R1
2 _XREF @I3@
1 FAMC @F0001@
0 @F0001@ FAM
1 WIFE @P0001@
1 CHIL @P0002@
1 CHIL @P0003@
1 _STROM_NO_COUPLE Y
1 _STROM_IMPORT R1
2 _XREF @F1@
2 _UID 0AF1B2C3D4E5F60718293A4B5C6D7F01
0 TRLR
`;

const load = (ged: string): StromData => migrateData(convertToStrom(parseGedcom(ged)).data);
const forResearch = (data: StromData): string => researchGedcom(data, 'Ozubec', { id: 'r-lone' }, 'line');

/** The file's FAM records, each as its lines. */
function families(ged: string): string[][] {
    const out: string[][] = [];
    let cur: string[] | null = null;
    for (const line of ged.split(/\r?\n/)) {
        if (line.startsWith('0 ')) {
            cur = / FAM$/.test(line) ? [line] : null;
            if (cur) out.push(cur);
        } else if (cur) cur.push(line);
    }
    return out;
}

const named = (data: StromData, first: string): Person => Object.values(data.persons).find(p => p.firstName === first)!;

describe('the research\'s family of one parent alone (_STROM_NO_COUPLE)', () => {
    it('reads as one "?" family of all its children, with its import ids', () => {
        const data = load(RESEARCH);
        const unions = Object.values(data.partnerships);
        expect(unions).toHaveLength(1);
        const [u] = unions;
        const mother = named(data, 'Libuna');
        expect([u.person1Id, u.person2Id]).toContain(mother.id);
        expect(u.childIds.map(id => data.persons[id].firstName).sort()).toEqual(['Bořek', 'Jarka']);
        expect(Object.values(data.persons).filter(p => p.isPlaceholder)).toHaveLength(1);
        expect(u.noCouple).toBe(true);
        expect(u.originalIds?.[0]).toMatchObject({ from: 'R1', xref: 'F1' });
    });

    it('goes to the research as it came: one family with its import, _XREF, _UID and the no-couple mark, the same round after round', () => {
        const first = forResearch(load(RESEARCH));
        const fams = families(first);
        expect(fams).toHaveLength(1);
        const fam = fams[0];
        expect(fam.filter(l => l.startsWith('1 CHIL '))).toHaveLength(2);
        expect(fam.filter(l => /^1 (HUSB|WIFE) /.test(l))).toHaveLength(1);
        expect(fam).toContain('1 _STROM_NO_COUPLE Y');
        expect(fam).toContain('1 _STROM_IMPORT R1');
        expect(fam).toContain('2 _XREF @F1@');
        expect(fam).toContain('2 _UID 0AF1B2C3D4E5F60718293A4B5C6D7F01');
        expect(fam.some(l => l === '1 MARR')).toBe(false);
        // The same lines as the research wrote them (its pointers renumbered).
        const theirs = families(RESEARCH)[0].slice(1).filter(l => !/^1 (WIFE|CHIL) /.test(l)).sort();
        expect(fam.slice(1).filter(l => !/^1 (WIFE|CHIL) /.test(l)).sort()).toEqual(theirs);
        // Each person's FAMS / FAMC name that one family.
        expect(first.split('\n').filter(l => /^1 FAM[SC] /.test(l)).map(l => l.slice(7))).toEqual([fam[0].slice(2, -4), fam[0].slice(2, -4), fam[0].slice(2, -4)]);

        // Back from the research (the app's file read again) and out again: byte for byte.
        const second = forResearch(load(first));
        expect(families(second)).toEqual(fams);
    });

    it('a tree an earlier beta split into a "?" family per child is one family again once loaded from the research', () => {
        // What the earlier beta kept: the mother's loose links made a "?" family each.
        const previous = load(RESEARCH);
        const mother = named(previous, 'Libuna');
        const kids = [named(previous, 'Bořek'), named(previous, 'Jarka')];
        for (const id of Object.keys(previous.partnerships)) delete previous.partnerships[id as never];
        for (const p of Object.values(previous.persons)) {
            if (p.isPlaceholder) { delete previous.persons[p.id]; continue; }
            p.partnerships = [];
            p.parentIds = p.parentIds.filter(id => id === mother.id);
        }
        mother.childIds = kids.map(k => k.id as PersonId);
        normalizeSingleParents(previous);
        expect(Object.keys(previous.partnerships)).toHaveLength(2);
        expect(families(forResearch(previous))).toHaveLength(2);

        const { data } = carryOverMedia(load(RESEARCH), previous);
        expect(Object.keys(data.partnerships)).toHaveLength(1);
        const fams = families(forResearch(data));
        expect(fams).toHaveLength(1);
        expect(fams[0]).toContain('2 _XREF @F1@');
        expect(fams[0]).toContain('1 _STROM_NO_COUPLE Y');
    });
});
