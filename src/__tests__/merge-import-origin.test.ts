/**
 * A merged tree is an import (1127, Milan 27 Nov 2026): a merge of another
 * tree of the app (spec 134) into a tree — here the research's — sends what
 * it brought as from a family tree, `2 _STROM_IMPORT Ix` under each fact and
 * `1 _STROM_IMPORT Ix` with `2 SOUR Strom`, `2 _AT`, `2 FILE` (the tree's
 * name) in the HEAD, also when that tree has no import record of its own (an
 * older tree, one made by hand). A fact a person confirmed, the target's own
 * facts and a value the target kept carry no mark; a tree with its own import
 * keeps it; the marks stay after the research's version is loaded back; the
 * undo takes the record and the marks back. Invented persons only.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { parseGedcom, convertToStrom, type GedcomImportOrigin } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { fileImports, keepImports } from '../import-origin.js';
import { factReliability } from '../reliability.js';
import { stabilizeIds } from '../research-link.js';
import { createMergeState } from '../merge/matching.js';
import { applyPlan, buildPlan, type PlanSource, type WizardChoices } from '../merge/plan.js';
import { applyUndo } from '../merge/undo-plan.js';
import { importOriginOf } from '../tree-row.js';
import { StorageManager } from '../storage.js';
import type { Partnership, PartnershipId, Person, PersonId, StromData, TreeId } from '../types.js';

const RESEARCH = { id: 'b7c1d2e3-0000-4000-8000-000000001127', head: 'h1127' };
const TREE_NAME = 'Mlýnkovi – starý strom';
const DAY = '2026-11-27';

function person(id: string, firstName: string, gender: 'male' | 'female', over: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName, lastName: 'Mlýnek', gender, isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...over,
    };
}

/** An older tree of the app without any import record: a couple with a son, made by hand or loaded before data version 15. */
function oldTree(): StromData {
    const k = person('s1', 'Kvirin', 'male', { birthDate: '1850', birthPlace: 'Hrachovec', deathDate: '1921', partnerships: ['su1' as PartnershipId], childIds: ['s3' as PersonId] });
    const l = person('s2', 'Ludmila', 'female', { lastName: 'Šťovíková', partnerships: ['su1' as PartnershipId], childIds: ['s3' as PersonId] });
    const b = person('s3', 'Bonifác', 'male', { birthDate: '1880', parentIds: ['s1' as PersonId, 's2' as PersonId] });
    const u: Partnership = {
        id: 'su1' as PartnershipId, person1Id: k.id, person2Id: l.id, childIds: [b.id], status: 'married', startDate: '1875',
    } as Partnership;
    return migrateData({ persons: { [k.id]: k, [l.id]: l, [b.id]: b }, partnerships: { [u.id]: u } } as StromData);
}

/** The research's tree: a person of its own and Kvirin without his place of birth (numbered by the research). */
function researchTree(): StromData {
    const r = person('t1', 'Radovan', 'male', { refn: 'P0001', birthDate: '1990' });
    const k = person('t2', 'Kvirin', 'male', { refn: 'P0002', birthDate: '1850', deathDate: '1920' });
    return migrateData({ persons: { [r.id]: r, [k.id]: k }, partnerships: {} } as StromData);
}

const FOREIGN = `0 HEAD
1 SOUR RODOKMENAR
2 NAME Rodokmenář
1 DATE 12 MAR 2024
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Kvirin /Mlýnek/
1 SEX M
1 BIRT
2 DATE 1850
2 PLAC Hrachovec
0 TRLR
`;
const ORIGIN: GedcomImportOrigin = { at: '2026-11-20', file: 'rodokmen-mlynaru.ged', encoding: 'UTF-8' };

/** A tree of the app loaded from a GEDCOM of another program (its own import I1), with a person added by hand since. */
function importedTree(): StromData {
    const data = migrateData(convertToStrom(parseGedcom(FOREIGN), { importOrigin: ORIGIN }).data);
    data.persons['hand' as PersonId] = person('hand', 'Radmila', 'female', { birthDate: '1910' });
    return data;
}

function byName(data: StromData, first: string): Person {
    const p = Object.values(data.persons).find(x => x.firstName === first);
    if (!p) throw new Error(`no ${first}`);
    return p;
}

function send(data: StromData): string {
    return exportToGedcom(data, 'Mlýnkovi', { research: RESEARCH }).content;
}

function personRecord(ged: string, first: string): string[] {
    const records = ged.split(/\r?\n(?=0 )/).map(r => r.split(/\r?\n/));
    return records.find(r => / INDI$/.test(r[0]) && r.some(l => l.startsWith(`1 NAME ${first}`))) ?? [];
}

function factBlock(record: string[], level1: string): string[] {
    const i = record.findIndex(l => l === `1 ${level1}` || l.startsWith(`1 ${level1} `));
    if (i < 0) return [];
    const end = record.findIndex((l, j) => j > i && l.startsWith('1 '));
    return record.slice(i + 1, end < 0 ? undefined : end);
}

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

/** The id of the HEAD's record of the merged tree (`2 SOUR Strom`). */
function mergedTreeImport(ged: string): string | undefined {
    return [...headImports(ged)].find(([, lines]) => lines.includes('2 SOUR Strom'))?.[0];
}

/** The source tree merged into `target`: every person added, except those `join` names (source id → target id). */
async function merge(target: StromData, source: StromData, join: Record<string, string> = {}, from: Partial<PlanSource> = {}) {
    const state = createMergeState(target, source);
    state.decisions.clear();
    for (const id of Object.keys(source.persons) as PersonId[]) {
        state.decisions.set(id, join[id] ? { type: 'manual_match', targetId: join[id] as PersonId } : { type: 'reject' });
    }
    delete state.updateOnly;
    const choices: WizardChoices = {
        mode: 'add', targetTreeId: 'tree-mlynek' as TreeId, scope: 'c', swapped: false,
        source: { kind: 'tree', label: TREE_NAME, persons: 0, ...from }, targetName: 'Mlýnkovi', targetFingerprint: 'fp',
        targetResearch: true, planId: 'mp-1127', createdAt: `${DAY}T10:00:00.000Z`,
    };
    const result = await applyPlan(buildPlan(state, choices), target, source);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    const after = result.data;
    after.merges = [...(after.merges ?? []), result.record];
    return { after, record: result.record };
}

/** The research's version of what it was sent (see import-origin-sync.test.ts): no app marks, `_STROM_ORIGIN user` under each fact. */
function researchVersion(sent: StromData): StromData {
    const lines = send(sent).split(/\r?\n/);
    const out: string[] = [];
    let inHead = true;
    let skipping = false;
    for (const l of lines) {
        if (inHead && l.startsWith('0 ') && !l.startsWith('0 HEAD')) inHead = false;
        if (inHead && l.startsWith('1 _STROM_IMPORT ')) { skipping = true; continue; }
        if (skipping && /^[2-9] /.test(l)) continue;
        skipping = false;
        if (/^\d _STROM_IMPORT /.test(l)) continue;
        out.push(l);
        if (!inHead && /^1 (NAME|BIRT|DEAT|MARR|OCCU)( |$)/.test(l)) out.push('2 _STROM_ORIGIN user');
    }
    return convertToStrom(parseGedcom(out.join('\n')), {}).data;
}

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${DAY}T10:00:00Z`));
    vi.spyOn(StorageManager, 'set').mockImplementation(() => undefined as never);
    vi.spyOn(StorageManager, 'get').mockImplementation(() => null as never);
});
afterAll(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('an older tree without an import record merged into the research\'s tree', () => {
    it('the HEAD names the merged tree (SOUR Strom, _AT the day of the merge, FILE its name) and its people carry the marks', async () => {
        const { after } = await merge(researchTree(), oldTree());
        const ged = send(after);
        const id = mergedTreeImport(ged);
        expect(id).toBeDefined();
        expect(headImports(ged).get(id!)).toEqual(['2 SOUR Strom', `2 _AT ${DAY}`, `2 FILE ${TREE_NAME}`]);
        for (const [first, facts] of [['Ludmila', ['NAME', 'SEX']], ['Bonifác', ['NAME', 'SEX']]] as const) {
            const rec = personRecord(ged, first);
            expect(rec, first).toContain(`1 _STROM_IMPORT ${id}`);
            for (const f of facts) expect(factBlock(rec, f), `${first} ${f}`).toContain(`2 _STROM_IMPORT ${id}`);
        }
        const fam = ged.split(/\r?\n(?=0 )/).map(r => r.split(/\r?\n/)).find(r => / FAM$/.test(r[0]))!;
        expect(fam).toContain(`1 _STROM_IMPORT ${id}`);
        expect(factBlock(fam, 'MARR')).toContain(`2 _STROM_IMPORT ${id}`);
    });

    it('the target\'s own people and facts carry no mark; a joined person only what it took from the merged tree', async () => {
        const { after } = await merge(researchTree(), oldTree(), { s1: 't2' });
        const ged = send(after);
        const id = mergedTreeImport(ged)!;
        expect(personRecord(ged, 'Radovan').join('\n')).not.toContain('_STROM_IMPORT');
        const k = personRecord(ged, 'Kvirin');
        // The record is the research's own; the place of birth came from the merged tree, the dates were the tree's (the death date kept against the merged tree's).
        expect(k).not.toContain(`1 _STROM_IMPORT ${id}`);
        expect(factBlock(k, 'BIRT')).toContain(`2 _STROM_IMPORT ${id} PLAC`);
        expect(factBlock(k, 'BIRT')).not.toContain(`2 _STROM_IMPORT ${id}`);
        expect(factBlock(k, 'DEAT')).toContain('2 DATE 1920');
        expect(factBlock(k, 'DEAT').join('\n')).not.toContain('_STROM_IMPORT');
        expect(factBlock(k, 'NAME').join('\n')).not.toContain('_STROM_IMPORT');
    });

    it('a fact a person confirmed in the merged tree carries no mark, the others of the person keep theirs', async () => {
        const source = oldTree();
        byName(source, 'Bonifác').confirmed = { birth: { at: '2026-11-21' } };
        const { after } = await merge(researchTree(), source);
        const ged = send(after);
        const id = mergedTreeImport(ged)!;
        const b = personRecord(ged, 'Bonifác');
        expect(factBlock(b, 'BIRT')).toContain('2 _STROM_CONFIRMED 2026-11-21');
        expect(factBlock(b, 'BIRT').join('\n')).not.toContain('_STROM_IMPORT');
        expect(factBlock(b, 'NAME')).toContain(`2 _STROM_IMPORT ${id}`);
        expect(byName(after, 'Bonifác').importedValues?.birthDate).toBeUndefined();
    });

    it('the tree\'s row names no file it was loaded from, and "Back to" offers no program', async () => {
        const { after } = await merge(researchTree(), oldTree());
        expect(after.imports?.map(r => r.program)).toEqual(['Strom']);
        expect(importOriginOf(after)).toBeUndefined();
        expect(fileImports(after.imports)).toEqual([]);
    });

    it('in a tree without the research its facts read "from the family tree", the target\'s do not', async () => {
        const target = researchTree();
        const { after } = await merge(target, oldTree());
        const opts = { researchTree: false, originFeature: false };
        expect(factReliability(after, byName(after, 'Ludmila'), 'name', opts)?.step).toBe('import');
        expect(factReliability(after, byName(after, 'Ludmila'), 'name', opts)?.importRecord?.file).toBe(TREE_NAME);
        expect(factReliability(after, after.persons['t1' as PersonId], 'name', opts)?.step).not.toBe('import');
    });

    it('after the research\'s version is loaded back from the bridge, the next send still marks them', async () => {
        const { after } = await merge(researchTree(), oldTree());
        let n = 10;
        for (const p of Object.values(after.persons)) p.refn ??= `P${String(++n).padStart(4, '0')}`;
        const back = migrateData(stabilizeIds(keepImports(researchVersion(after), after, ['origin']), after));
        const ged = send(back);
        const id = mergedTreeImport(ged);
        expect(id).toBeDefined();
        expect(headImports(ged).get(id!)).toEqual(['2 SOUR Strom', `2 _AT ${DAY}`, `2 FILE ${TREE_NAME}`]);
        const l = personRecord(ged, 'Ludmila');
        expect(factBlock(l, 'NAME')).toContain(`2 _STROM_IMPORT ${id}`);
        expect(factBlock(personRecord(ged, 'Bonifác'), 'BIRT')).toContain(`2 _STROM_IMPORT ${id}`);
        expect(personRecord(ged, 'Radovan').join('\n')).not.toContain('_STROM_IMPORT');
    });

    it('the undo takes the import record and the marks back', async () => {
        const target = researchTree();
        const { after, record } = await merge(target, oldTree(), { s1: 't2' });
        expect(after.imports?.length).toBe(1);
        expect(after.persons['t2' as PersonId].importedValues?.birthPlace).toBeDefined();
        const undone = applyUndo(record, after).data;
        expect(undone.imports ?? []).toEqual([]);
        const k = undone.persons['t2' as PersonId];
        expect(k.importedValues).toBeUndefined();
        expect(k.importId).toBeUndefined();
        expect(k.birthPlace).toBeUndefined();
        expect(send(undone)).not.toContain('_STROM_IMPORT');
    });
});

describe('a tree with its own import merged', () => {
    it('keeps the file\'s import; only what the tree does not know the origin of is the merged tree\'s', async () => {
        const source = importedTree();
        // Changed by hand since the import: a person's.
        byName(source, 'Kvirin').birthPlace = 'Hrachovec u Mlýna';
        const target = researchTree();
        delete target.persons['t2' as PersonId];
        const { after } = await merge(target, source);
        const ged = send(after);
        const heads = headImports(ged);
        const fileId = [...heads].find(([, lines]) => lines.includes('2 SOUR Rodokmenář'))?.[0];
        const treeId = mergedTreeImport(ged);
        expect(fileId).toBeDefined();
        expect(treeId).toBeDefined();
        const k = personRecord(ged, 'Kvirin');
        expect(k).toContain(`1 _STROM_IMPORT ${fileId}`);
        expect(factBlock(k, 'NAME')).toContain(`2 _STROM_IMPORT ${fileId}`);
        expect(factBlock(k, 'BIRT')).toContain(`2 _STROM_IMPORT ${fileId} DATE`);
        expect(k.join('\n')).not.toContain(`_STROM_IMPORT ${treeId}`);
        const r = personRecord(ged, 'Radmila');
        expect(r).toContain(`1 _STROM_IMPORT ${treeId}`);
        expect(factBlock(r, 'BIRT')).toContain(`2 _STROM_IMPORT ${treeId}`);
        // The tree's row still names the file it was loaded from.
        expect(importOriginOf(after)).toEqual({ file: 'rodokmen-mlynaru.ged', kind: 'gedcom' });
    });

    it('a GEDCOM of another program merged makes no record of a merged tree', async () => {
        const data = migrateData(convertToStrom(parseGedcom(FOREIGN), { importOrigin: ORIGIN }).data);
        const { after } = await merge(researchTree(), data, {}, { kind: 'ged', label: 'rodokmen-mlynaru.ged', importId: 'I1' });
        expect(after.imports?.map(r => r.program)).toEqual(['Rodokmenář']);
    });
});
