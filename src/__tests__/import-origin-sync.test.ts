/**
 * What goes to the research (1127, spec 066 point 2): every send names the
 * file a fact came from (`2 _STROM_IMPORT Ix` under each fact still as the
 * file gave it, `1 _STROM_IMPORT Ix` with SOUR/DATE/_AT/FILE in the HEAD),
 * from every way a file comes into a tree — a GEDCOM as a new tree, a GEDCOM
 * merged into the research's tree, a tree in a JSON or HTML file — and on
 * every send, also after the research's version was loaded back (its
 * `_STROM_ORIGIN` says `user` of facts an older send carried without marks,
 * `import Rn` of those it knows came from a file). A fact a person wrote,
 * changed or confirmed has no mark. Invented persons only.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { parseGedcom, convertToStrom, type GedcomImportOrigin } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { keepImports } from '../import-origin.js';
import { stabilizeIds } from '../research-link.js';
import { createMergeState } from '../merge/matching.js';
import { applyPlan, buildPlan, type WizardChoices } from '../merge/plan.js';
import { StorageManager } from '../storage.js';
import type { Person, PersonId, StromData, TreeId } from '../types.js';

const ORIGIN: GedcomImportOrigin = { at: '2026-11-25', file: 'rodokmen-mlynaru.ged', encoding: 'UTF-8' };
const RESEARCH = { id: 'b7c1d2e3-0000-4000-8000-000000001127', head: 'h1127' };

const FOREIGN = `0 HEAD
1 SOUR RODOKMENAR
2 NAME Rodokmenář
2 VERS 5.2
1 DATE 12 MAR 2024
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Kvido /Mlýnek/
1 SEX M
1 BIRT
2 DATE 1850
2 PLAC Hrachovec
1 OCCU mlynář
1 FAMS @F1@
0 @I2@ INDI
1 NAME Ludmila /Šťovíková/
1 SEX F
1 FAMS @F1@
0 @I3@ INDI
1 NAME Hostivít /Mlýnek/
1 SEX M
1 BIRT
2 DATE 1880
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 MARR
2 DATE 1875
0 TRLR
`;

function fromFile(): StromData {
    const r = convertToStrom(parseGedcom(FOREIGN), { importOrigin: ORIGIN });
    return migrateData(r.data);
}

function byName(data: StromData, first: string): Person {
    const p = Object.values(data.persons).find(x => x.firstName === first);
    if (!p) throw new Error(`no ${first}`);
    return p;
}

/** The GEDCOM a send to the research carries (researchGedcom). */
function send(data: StromData): string {
    return exportToGedcom(data, 'Mlýnkovi', { research: RESEARCH }).content;
}

/** The record lines of the person whose name starts with `first`. */
function personRecord(ged: string, first: string): string[] {
    const records = ged.split(/\r?\n(?=0 )/).map(r => r.split(/\r?\n/));
    return records.find(r => / INDI$/.test(r[0]) && r.some(l => l.startsWith(`1 NAME ${first}`))) ?? [];
}

/** The level-2+ lines under a level-1 tag of a record. */
function factBlock(record: string[], level1: string): string[] {
    const i = record.findIndex(l => l === `1 ${level1}` || l.startsWith(`1 ${level1} `));
    if (i < 0) return [];
    const end = record.findIndex((l, j) => j > i && l.startsWith('1 '));
    return record.slice(i + 1, end < 0 ? undefined : end);
}

/** The HEAD's import records: `I1` → its lines. */
function headImports(ged: string): Map<string, string[]> {
    const head = ged.split(/\r?\n(?=0 )/)[0].split(/\r?\n/);
    const out = new Map<string, string[]>();
    head.forEach((l, i) => {
        const m = /^1 _STROM_IMPORT (\S+)$/.exec(l);
        if (!m) return;
        const end = head.findIndex((x, j) => j > i && x.startsWith('1 '));
        out.set(m[1], head.slice(i + 1, end < 0 ? undefined : end));
    });
    return out;
}

/** The person, its name, sex, birth and occupation all marked with `id`; the HEAD names it with the file's data. */
function expectMarked(ged: string, first: string, id: string, facts: string[] = ['NAME', 'SEX', 'BIRT']): void {
    const rec = personRecord(ged, first);
    expect(rec, first).toContain(`1 _STROM_IMPORT ${id}`);
    for (const f of facts) expect(factBlock(rec, f), `${first} ${f}`).toContain(`2 _STROM_IMPORT ${id}`);
    const head = headImports(ged).get(id);
    expect(head, `HEAD ${id}`).toBeDefined();
    expect(head).toEqual(expect.arrayContaining(['2 SOUR Rodokmenář', '2 DATE 12 MAR 2024', '2 _AT 2026-11-25', '2 FILE rodokmen-mlynaru.ged']));
}

/**
 * The research's version of what it was sent, as a research gives it back:
 * every person with its number (REFN), no `_STROM_IMPORT` of the app's, and
 * `_STROM_ORIGIN <origin>` under each fact (`origin`: what the research
 * recorded of it), with `head` lines in its HEAD. Read as the app reads the
 * research's file (no import origin).
 */
function researchVersion(sent: StromData, origin: string, head: string[] = []): StromData {
    const lines = exportToGedcom(sent, 'Mlýnkovi', { research: RESEARCH }).content.split(/\r?\n/);
    const out: string[] = [];
    let inHead = true;
    let skipping = false;
    for (const l of lines) {
        if (inHead && l.startsWith('0 ') && !l.startsWith('0 HEAD')) {
            out.push(...head);
            inHead = false;
        }
        if (inHead && l.startsWith('1 _STROM_IMPORT ')) { skipping = true; continue; }
        if (skipping && /^[2-9] /.test(l)) continue;
        skipping = false;
        if (/^\d _STROM_IMPORT /.test(l)) continue;
        out.push(l);
        if (!inHead && /^1 (NAME|BIRT|DEAT|MARR|OCCU)( |$)/.test(l)) out.push(`2 _STROM_ORIGIN ${origin}`);
    }
    return convertToStrom(parseGedcom(out.join('\n')), {}).data;
}

/** The research's version loaded over the tree, as research-ui does (keepImports, then stabilizeIds). */
function loadBack(research: StromData, previous: StromData): StromData {
    return migrateData(stabilizeIds(keepImports(research, previous, ['origin']), previous));
}

/** The tree as sent, with every person numbered as the research numbered them (the app keeps the REFN it got). */
function numbered(data: StromData): StromData {
    const copy = structuredClone(data);
    let n = 0;
    for (const p of Object.values(copy.persons)) p.refn = `P${String(++n).padStart(4, '0')}`;
    return copy;
}

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-27T10:00:00Z'));
});
afterAll(() => vi.useRealTimers());

describe('a GEDCOM of another program as a new tree, then sent', () => {
    it('names the file in the HEAD and marks the person, its name, sex, birth, occupation and the marriage', () => {
        const ged = send(fromFile());
        expectMarked(ged, 'Kvido', 'I1', ['NAME', 'SEX', 'BIRT', 'OCCU']);
        expectMarked(ged, 'Ludmila', 'I1', ['NAME', 'SEX']);
        const fam = ged.split(/\r?\n(?=0 )/).find(r => / FAM\r?\n/.test(r.split('\n')[0] + '\n'))!.split(/\r?\n/);
        expect(factBlock(fam, 'MARR')).toContain('2 _STROM_IMPORT I1');
    });

    it('a fact written or changed by hand, and a person added by hand, carry no mark', () => {
        const data = fromFile();
        const k = byName(data, 'Kvido');
        k.birthPlace = 'Hrachovec u Mlýna';
        const b = byName(data, 'Hostivít');
        b.deathDate = '1950';
        data.persons['hand' as PersonId] = {
            id: 'hand' as PersonId, firstName: 'Radovan', lastName: 'Mlýnek', gender: 'male', isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], birthDate: '1990',
        };
        const ged = send(data);
        expect(factBlock(personRecord(ged, 'Kvido'), 'BIRT')).toContain('2 _STROM_IMPORT I1 DATE');
        expect(factBlock(personRecord(ged, 'Hostivít'), 'DEAT').join('\n')).not.toContain('_STROM_IMPORT');
        expect(personRecord(ged, 'Radovan').join('\n')).not.toContain('_STROM_IMPORT');
    });

    it('a fact confirmed by hand (065) carries no mark, the others of the person keep theirs', () => {
        const data = fromFile();
        const k = byName(data, 'Kvido');
        // A confirmation without a stored value holds while the fact has any value.
        k.confirmed = { birth: { at: '2026-11-26' } };
        const ged = send(data);
        const rec = personRecord(ged, 'Kvido');
        expect(factBlock(rec, 'BIRT')).toContain('2 _STROM_CONFIRMED 2026-11-26');
        expect(factBlock(rec, 'BIRT').join('\n')).not.toContain('_STROM_IMPORT');
        expect(factBlock(rec, 'NAME')).toContain('2 _STROM_IMPORT I1');
    });
});

describe('a tree carried in a JSON or HTML file (the same data), then sent', () => {
    it('keeps the import record and the marks', () => {
        const data = migrateData(JSON.parse(JSON.stringify(fromFile())));
        expectMarked(send(data), 'Kvido', 'I1', ['NAME', 'SEX', 'BIRT', 'OCCU']);
    });
});

describe('a GEDCOM merged into the research\'s tree, then sent', () => {
    beforeAll(() => {
        vi.spyOn(StorageManager, 'set').mockImplementation(() => undefined as never);
        vi.spyOn(StorageManager, 'get').mockImplementation(() => null as never);
    });

    it('the new people from the file carry the marks and the HEAD names the file', async () => {
        const target: StromData = { persons: {}, partnerships: {} };
        target.persons['t1' as PersonId] = {
            id: 't1' as PersonId, firstName: 'Radovan', lastName: 'Mlýnek', gender: 'male', isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], refn: 'P0001',
        };
        const source = fromFile();
        const state = createMergeState(target, source);
        state.decisions.clear();
        for (const id of Object.keys(source.persons) as PersonId[]) state.decisions.set(id, { type: 'reject' });
        delete state.updateOnly;
        const choices: WizardChoices = {
            mode: 'add', targetTreeId: 'tree-mlynek' as TreeId, scope: 'c', swapped: false,
            source: { kind: 'gedcom', name: 'rodokmen-mlynaru.ged' } as never, targetName: 'Mlýnkovi', targetFingerprint: 'fp',
            targetResearch: true, planId: 'mp-1127', createdAt: '2026-11-27T10:00:00.000Z',
        };
        const result = await applyPlan(buildPlan(state, choices), target, source);
        expect(result.ok).toBe(true);
        const ged = send(result.data);
        const id = [...headImports(ged).keys()][0];
        expect(id).toBeDefined();
        expectMarked(ged, 'Kvido', id, ['NAME', 'SEX', 'BIRT', 'OCCU']);
        expect(personRecord(ged, 'Radovan').join('\n')).not.toContain('_STROM_IMPORT');
    });
});

describe('after the research\'s version is loaded back from the bridge', () => {
    it('a research that recorded the facts as the user\'s (a send without marks): the next send still marks them', () => {
        const sent = numbered(fromFile());
        const back = loadBack(researchVersion(sent, 'user'), sent);
        expectMarked(send(back), 'Kvido', 'I1', ['NAME', 'SEX', 'BIRT', 'OCCU']);
        expectMarked(send(back), 'Hostivít', 'I1', ['NAME', 'SEX', 'BIRT']);
    });

    it('a research that recorded them from its own import record (R1): the next send still marks them with the app\'s', () => {
        const sent = numbered(fromFile());
        const head = ['1 _STROM_IMPORT R1', '2 SOUR Rodokmenář', '2 _AT 2026-11-25', '2 FILE rodokmen-mlynaru.ged'];
        const back = loadBack(researchVersion(sent, 'import R1', head), sent);
        expectMarked(send(back), 'Kvido', 'I1', ['NAME', 'SEX', 'BIRT', 'OCCU']);
    });

    it('a value the research changed carries no mark', () => {
        const sent = numbered(fromFile());
        const research = researchVersion(sent, 'research');
        byName(research, 'Kvido').birthDate = '1851';
        const ged = send(loadBack(research, sent));
        const birth = factBlock(personRecord(ged, 'Kvido'), 'BIRT');
        expect(birth).toContain('2 _STROM_IMPORT I1 PLAC');
        expect(birth).not.toContain('2 _STROM_IMPORT I1');
    });
});
