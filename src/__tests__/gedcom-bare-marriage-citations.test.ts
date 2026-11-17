/**
 * The citations of a family whose MARR says nothing (no date, place or
 * witness) go out on the family record, not under the bare MARR.
 *
 * Strom Research reads a bare MARR as no fact (every couple of the app is
 * "married") and drops what is under it. A family of one known parent and
 * several children (married to somebody unknown) goes out with such a MARR,
 * so the citations the research gave the family came back nowhere and every
 * send listed them as not written ("citations of a person, a name or a family
 * are not removed from the app"), though the user never touched them. On the
 * record they are the family's own, and the app reads them back into the same
 * list. A dated marriage keeps them under its MARR; so does one with a main
 * citation (only a fact's citations say one).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import type { StromData, Partnership } from '../types.js';

beforeEach(() => {
    vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
});

const importGed = (ged: string): StromData => convertToStrom(parseGedcom(ged)).data;
const exportGed = (data: StromData): string => exportToGedcom(data).content;

/** The lines of each FAM record of a file. */
function famRecords(ged: string): string[][] {
    const out: string[][] = [];
    let cur: string[] | null = null;
    for (const l of ged.split(/\r?\n/)) {
        if (l.startsWith('0 ')) { cur = / FAM$/.test(l) ? [l] : null; if (cur) out.push(cur); continue; }
        if (cur) cur.push(l);
    }
    return out;
}
/** The level-2 lines under a record's `1 MARR`. */
function underMarr(rec: string[]): string[] {
    const at = rec.findIndex(l => l === '1 MARR' || l.startsWith('1 MARR '));
    if (at < 0) return [];
    const out: string[] = [];
    for (const l of rec.slice(at + 1)) { if (/^[01] /.test(l)) break; out.push(l); }
    return out;
}
const sourceTitles = (data: StromData, u: Partnership): string[] =>
    (u.sourceIds ?? []).map(id => data.sources?.[id]?.title ?? '?').sort();

const HEAD = `0 HEAD
1 SOUR STROM_RESEARCH
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
`;
const SOURCES = `0 @S1@ SOUR
1 TITL Burial of Rosa, Ledeč No. 4, 1811
0 @S2@ SOUR
1 TITL Burial of Klara, Ledeč No. 4, 1811
`;

/** The research's family of one mother (married to somebody unknown) and her children, citing two burials. */
const ONE_PARENT = HEAD + `0 @I1@ INDI
1 NAME Dorota /Brzobohatá/
1 SEX F
1 FAMS @F1@
0 @I2@ INDI
1 NAME Rosa /Brzobohatá/
1 SEX F
1 FAMC @F1@
0 @I3@ INDI
1 NAME Klara /Brzobohatá/
1 SEX F
1 FAMC @F1@
0 @F1@ FAM
1 WIFE @I1@
1 CHIL @I2@
1 CHIL @I3@
1 MARR
1 SOUR @S1@
2 PAGE fol. 12
1 SOUR @S2@
` + SOURCES + '0 TRLR\n';

describe('GEDCOM: the citations of a bare marriage', () => {
    it('a family of one parent: its citations go out on the family record, not under its bare MARR, and come back the same', () => {
        const data = importGed(ONE_PARENT);
        const union = Object.values(data.partnerships).find(u => u.childIds.length === 2)!;
        expect(sourceTitles(data, union)).toEqual(['Burial of Klara, Ledeč No. 4, 1811', 'Burial of Rosa, Ledeč No. 4, 1811']);

        const ged = exportGed(data);
        const fam = famRecords(ged).find(r => r.filter(l => l.startsWith('1 CHIL')).length === 2)!;
        // Still the one parent's family, "married" (the bare MARR keeps the siblings one family).
        expect(fam.filter(l => l === '1 MARR')).toHaveLength(1);
        expect(underMarr(fam).filter(l => l.startsWith('2 SOUR'))).toEqual([]);
        expect(fam.filter(l => l.startsWith('1 SOUR'))).toHaveLength(2);

        const back = importGed(ged);
        const again = Object.values(back.partnerships).find(u => u.childIds.length === 2)!;
        expect(sourceTitles(back, again)).toEqual(sourceTitles(data, union));
        expect(again.status).toBe('married');
    });

    it('a dated marriage keeps its citations under its MARR', () => {
        const dated = ONE_PARENT.replace('1 MARR\n', '1 MARR\n2 DATE 3 FEB 1801\n');
        const ged = exportGed(importGed(dated));
        const fam = famRecords(ged).find(r => r.filter(l => l.startsWith('1 CHIL')).length === 2)!;
        expect(underMarr(fam).filter(l => l.startsWith('2 SOUR'))).toHaveLength(2);
        expect(fam.filter(l => l.startsWith('1 SOUR'))).toEqual([]);
    });

    it('a bare marriage with a main citation keeps them under its MARR, the main one marked', () => {
        const data = importGed(ONE_PARENT);
        const union = Object.values(data.partnerships).find(u => u.childIds.length === 2)!;
        union.citationMain = { sourceIds: union.sourceIds![1] };
        const ged = exportGed(data);
        const fam = famRecords(ged).find(r => r.filter(l => l.startsWith('1 CHIL')).length === 2)!;
        expect(underMarr(fam).filter(l => l.startsWith('2 SOUR'))).toHaveLength(2);
        expect(fam.filter(l => l.startsWith('1 SOUR'))).toEqual([]);
        const back = importGed(ged);
        const again = Object.values(back.partnerships).find(u => u.childIds.length === 2)!;
        expect(again.citationMain?.sourceIds).toBeTruthy();
    });

    it('a couple married with nothing known of the wedding: its citations on the family record too', () => {
        const couple = HEAD + `0 @I1@ INDI
1 NAME Dorota /Brzobohatá/
1 SEX F
1 FAMS @F1@
0 @I4@ INDI
1 NAME Matěj /Brzobohatý/
1 SEX M
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I4@
1 WIFE @I1@
1 MARR
1 SOUR @S1@
` + SOURCES + '0 TRLR\n';
        const ged = exportGed(importGed(couple));
        const fam = famRecords(ged)[0];
        expect(fam).toContain('1 MARR');
        expect(underMarr(fam).filter(l => l.startsWith('2 SOUR'))).toEqual([]);
        expect(fam.filter(l => l.startsWith('1 SOUR'))).toHaveLength(1);
        const back = importGed(ged);
        const u = Object.values(back.partnerships)[0];
        expect(sourceTitles(back, u)).toEqual(['Burial of Rosa, Ledeč No. 4, 1811']);
    });
});
