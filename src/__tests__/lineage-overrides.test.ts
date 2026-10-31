/**
 * Lineage corrections and labels (package 1031): founders set by hand, lines
 * split off, taking a correction back, the preview of a change, labels of
 * lineages sharing a name, removing one spelling from a group, the data
 * version 14 field through a load and GEDCOM (both ways, the research's
 * version included). Fictional trees only: every name below is invented.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    buildLineages, rods, rodOf, rodLabel, rodLabels, previewOverride, applyLineageChange, cleanLineageOverrides,
    lineageOverridesOf, withLineagePatch, marriedInto, selection, RodId, LineageIndex, Rod,
} from '../lineage.js';
import { removeSurnameForm } from '../surnames.js';
import { DataManager, migrateData } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { keepLineageOverrides, contentFingerprint } from '../research-link.js';
import { diffOther, sentOtherRows, RESEARCH_UNREAD_KINDS } from '../research-changes.js';
import { extractSubtree } from '../subtree.js';
import { StromData, PersonId, Person, Partnership, PartnershipId, TreeId, STROM_DATA_VERSION } from '../types.js';

type Sex = 'male' | 'female';
interface Spec { first: string; last: string; sex: Sex; born?: string; parents?: string[]; place?: string }

function tree(people: Record<string, Spec>, unions: [string, string, string, string[]][] = [], extra: Partial<StromData> = {}): StromData {
    const persons: Record<string, Person> = {};
    for (const [id, s] of Object.entries(people)) {
        persons[id] = {
            id: id as PersonId, firstName: s.first, lastName: s.last, gender: s.sex, isPlaceholder: false,
            partnerships: [], parentIds: (s.parents ?? []) as PersonId[], childIds: [], birthDate: s.born,
            ...(s.place ? { birthPlace: s.place } : {}),
        } as Person;
    }
    for (const p of Object.values(persons)) for (const par of p.parentIds) persons[par]?.childIds.push(p.id);
    const partnerships: Record<string, Partnership> = {};
    for (const [uid, a, b, kids] of unions) {
        partnerships[uid] = { id: uid as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId, childIds: kids as PersonId[], status: 'married' };
        persons[a].partnerships.push(uid as PartnershipId);
        persons[b].partnerships.push(uid as PartnershipId);
    }
    return { version: STROM_DATA_VERSION, persons, partnerships, ...extra } as StromData;
}
const P = (id: string): PersonId => id as PersonId;
const rodIdOf = (idx: LineageIndex, id: string): RodId => {
    const r = rodOf(idx, P(id));
    expect(r).not.toBeNull();
    return r!;
};
const rodOfPerson = (idx: LineageIndex, id: string): Rod => idx.rods.get(rodIdOf(idx, id))!;

/** The Pštrosek line: Hroznata, his sons Budivoj and Želibor, their lines. */
function pstrosek(extra: Partial<StromData> = {}): StromData {
    return tree({
        hroznata: { first: 'Hroznata', last: 'Pštrosek', sex: 'male', born: '1780', place: 'Ostrovany' },
        budivoj: { first: 'Budivoj', last: 'Pštrosek', sex: 'male', born: '1810', parents: ['hroznata'] },
        zelibor: { first: 'Želibor', last: 'Pštrosek', sex: 'male', born: '1812', parents: ['hroznata'] },
        mstivoj: { first: 'Mstivoj', last: 'Pštrosek', sex: 'male', born: '1840', parents: ['budivoj'] },
        dalibora: { first: 'Dalibora', last: 'Rozinková', sex: 'female', born: '1842' },
        trpimir: { first: 'Trpimír', last: 'Pštrosek', sex: 'male', born: '1843', parents: ['budivoj'] },
        borislav: { first: 'Bořislav', last: 'Pštrosek', sex: 'male', born: '1868', parents: ['mstivoj', 'dalibora'] },
        zbyhnev: { first: 'Zbyhněv', last: 'Pštrosek', sex: 'male', born: '1870', parents: ['mstivoj', 'dalibora'] },
        vlastislava: { first: 'Vlastislava', last: 'Pštrosková', sex: 'female', born: '1872', parents: ['mstivoj', 'dalibora'] },
        cecilka: { first: 'Cecilka', last: 'Pštrosková', sex: 'female', born: '1874', parents: ['mstivoj', 'dalibora'] },
        lubor: { first: 'Lubor', last: 'Pštrosek', sex: 'male', born: '1845', parents: ['zelibor'] },
        dobroslav: { first: 'Dobroslav', last: 'Pštrosek', sex: 'male', born: '1875', parents: ['lubor'] },
    }, [['u1', 'mstivoj', 'dalibora', ['borislav', 'zbyhnev', 'vlastislava', 'cecilka']]], extra);
}

describe('lineage corrections: a founder moved down the line', () => {
    const data = pstrosek();
    const idx = buildLineages(data);

    it('without corrections the whole line is one lineage of its oldest bearer', () => {
        expect(rods(idx).filter(r => !r.small)).toHaveLength(1);
        const rod = rodOfPerson(idx, 'dobroslav');
        expect(rod.founderId).toBe('hroznata');
        expect(rod.realMemberCount).toBe(11);
        expect(rod.manual).toBeNull();
        expect(rod.founderYear).toBe(1780);
        expect(rod.founderYearApprox).toBe(false);
    });

    it('the line above the new founder passes nothing on (notCarriers)', () => {
        const patch = applyLineageChange(idx, { kind: 'founder', personId: P('mstivoj') })!;
        expect(patch.fields).toEqual(['lineageOverrides']);
        expect(patch.lineageOverrides).toEqual({ notCarriers: ['budivoj', 'hroznata'] });
        const after = buildLineages(withLineagePatch(data, patch));
        const rod = rodOfPerson(after, 'cecilka');
        expect(rod.founderId).toBe('mstivoj');
        expect(rod.realMemberCount).toBe(5);
        expect(rod.realSpouseCount).toBe(1);
        expect(rod.manual).toBe('founder');
        // Nobody is lost: everyone still has a lineage of their own.
        for (const id of Object.keys(data.persons)) if (id !== 'dalibora') expect(rodOf(after, P(id))).not.toBeNull();
        expect(rodOfPerson(after, 'dobroslav').founderId).toBe('zelibor');
    });

    it('the preview says where the rest goes and that the whole-tree book keeps everyone', () => {
        const pv = previewOverride(data, { kind: 'founder', personId: P('mstivoj') }, idx);
        expect(pv.lines[0]).toEqual({ kind: 'startsWith', personId: 'mstivoj', year: 1840, members: 5, spouses: 1 });
        const toSmall = pv.lines.find(l => l.kind === 'toSmall');
        expect(toSmall && toSmall.kind === 'toSmall' ? [...toSmall.personIds].sort() : []).toEqual(
            ['budivoj', 'dobroslav', 'hroznata', 'lubor', 'trpimir', 'zelibor']);
        expect(pv.lines[pv.lines.length - 1]).toEqual({ kind: 'wholeTreeKeeps' });
        expect(pv.before.length).toBeLessThan(pv.after.length);
        expect(pv.patch?.lineageOverrides).toEqual({ notCarriers: ['budivoj', 'hroznata'] });
    });

    it('"Restore automatic" takes the correction back whole', () => {
        const moved = withLineagePatch(data, applyLineageChange(idx, { kind: 'founder', personId: P('mstivoj') })!);
        const mi = buildLineages(moved);
        const pv = previewOverride(moved, { kind: 'revert', rodId: rodIdOf(mi, 'mstivoj') }, mi);
        expect(pv.patch).toEqual({ lineageOverrides: undefined, fields: ['lineageOverrides'] });
        expect(pv.lines[0]).toMatchObject({ kind: 'restored', members: 11 });
        const back = buildLineages(withLineagePatch(moved, pv.patch!));
        expect(rodOfPerson(back, 'cecilka').founderId).toBe('hroznata');
    });
});

describe('lineage corrections: a line split off by hand', () => {
    const data = pstrosek();
    const idx = buildLineages(data);

    it('the person and their line start a lineage of their own (founders)', () => {
        const pv = previewOverride(data, { kind: 'split', personId: P('lubor') }, idx);
        expect(pv.patch?.lineageOverrides).toEqual({ founders: ['lubor'] });
        expect(pv.lines[0]).toMatchObject({ kind: 'newRod', personId: 'lubor', members: 2, spouses: 0 });
        expect(pv.lines[1]).toMatchObject({ kind: 'splitMoves', personId: 'lubor', members: 9 });
        const after = buildLineages(withLineagePatch(data, pv.patch!));
        expect(rodOfPerson(after, 'dobroslav').manual).toBe('split');
        expect(rodOfPerson(after, 'zelibor').founderId).toBe('hroznata');
    });

    it('a person in both lists is a founder; unknown ids are ignored and cleaned away', () => {
        const both = pstrosek({ lineageOverrides: { founders: ['lubor', 'p_gone'], notCarriers: ['lubor', 'p_gone2'] } });
        const sets = lineageOverridesOf(both);
        expect([...sets.founders]).toEqual(['lubor']);
        expect([...sets.notCarriers]).toEqual([]);
        expect(cleanLineageOverrides(both)).toEqual({ founders: ['lubor'] });
        expect(rodOfPerson(buildLineages(both), 'dobroslav').founderId).toBe('lubor');
        expect(cleanLineageOverrides(pstrosek({ lineageOverrides: { founders: ['p_gone'] } }))).toBeUndefined();
    });

    it('a change that changes nothing gives no patch', () => {
        const split = pstrosek({ lineageOverrides: { founders: ['lubor'] } });
        const pv = previewOverride(split, { kind: 'split', personId: P('lubor') });
        expect(pv.patch).toBeNull();
        expect(pv.lines).toEqual([{ kind: 'noChange' }]);
    });
});

describe('rodLabel: lineages sharing a name', () => {
    const twoLines = (placeA?: string, placeB?: string, bornA = '1700', bornB = '1750'): LineageIndex => buildLineages(tree({
        a1: { first: 'Kostival', last: 'Pelyněk', sex: 'male', born: bornA, place: placeA },
        a2: { first: 'Mstivoj', last: 'Pelyněk', sex: 'male', born: '1730', parents: ['a1'], place: placeA },
        a3: { first: 'Trpimír', last: 'Pelyněk', sex: 'male', born: '1760', parents: ['a2'], place: placeA },
        a4: { first: 'Lubor', last: 'Pelyněk', sex: 'male', born: '1790', parents: ['a3'], place: placeA },
        a5: { first: 'Zbyhněv', last: 'Pelyněk', sex: 'male', born: '1820', parents: ['a4'], place: placeA },
        b1: { first: 'Želibor', last: 'Pelyněk', sex: 'male', born: bornB, place: placeB },
        b2: { first: 'Budivoj', last: 'Pelyněk', sex: 'male', born: '1780', parents: ['b1'], place: placeB },
        b3: { first: 'Hroznata', last: 'Pelyněk', sex: 'male', born: '1810', parents: ['b2'], place: placeB },
        b4: { first: 'Dobroslav', last: 'Pelyněk', sex: 'male', born: '1840', parents: ['b3'], place: placeB },
        b5: { first: 'Bořislav', last: 'Pelyněk', sex: 'male', born: '1870', parents: ['b4'], place: placeB },
    }));

    it('by the place each lived most', () => {
        const idx = twoLines('Ostrovany', 'Zálesí');
        const labels = rodLabels(idx);
        expect(labels.get(rodIdOf(idx, 'a5'))).toBe('Pelyněk (Ostrovany)');
        expect(labels.get(rodIdOf(idx, 'b5'))).toBe('Pelyněk (Zálesí)');
    });

    it('by the founder\'s year when the places are the same', () => {
        const idx = twoLines('Ostrovany', 'Ostrovany');
        const all = rods(idx);
        expect(rodLabel(rodOfPerson(idx, 'a5'), all, idx.data)).toBe('Pelyněk (1700)');
        expect(rodLabel(rodOfPerson(idx, 'b5'), all, idx.data)).toBe('Pelyněk (1750)');
    });

    it('by the founder\'s first name with neither place nor year', () => {
        const idx = twoLines(undefined, undefined, '', '');
        const labels = rodLabels(idx);
        expect(labels.get(rodIdOf(idx, 'a5'))).toBe('Pelyněk (Kostival)');
        expect(labels.get(rodIdOf(idx, 'b5'))).toBe('Pelyněk (Želibor)');
    });

    it('a lone bearer elsewhere does not rename the big lineage, but gets a qualifier itself', () => {
        const data = pstrosek();
        data.persons[P('solo')] = { id: P('solo'), firstName: 'Puškvorec', lastName: 'Pštrosek', gender: 'male', isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], birthDate: '1901', birthPlace: 'Lopuchov' } as Person;
        const idx = buildLineages(data);
        const labels = rodLabels(idx);
        expect(labels.get(rodIdOf(idx, 'mstivoj'))).toBe('Pštrosek');
        expect(labels.get(rodIdOf(idx, 'solo'))).toBe('Pštrosek (Lopuchov)');
    });

    it('a year written "about" is approximate', () => {
        const data = pstrosek();
        data.persons[P('hroznata')].birthDate = '~1780';
        const rod = rodOfPerson(buildLineages(data), 'mstivoj');
        expect(rod.founderYear).toBe(1780);
        expect(rod.founderYearApprox).toBe(true);
    });
});

describe('removeSurnameForm', () => {
    const groups = (variants: string[][]): StromData => ({ persons: {}, partnerships: {}, surnameVariants: variants } as StromData);

    it('takes one form out and remembers [removed, main] as rejected', () => {
        const r = removeSurnameForm(groups([['Pstrosek', 'Pštrosek', 'Pštrossek'], ['Routa', 'Routta']]), 'Pstrosek', 'Pštrosek');
        expect(r).toEqual({ variants: [['Pštrosek', 'Pštrossek'], ['Routa', 'Routta']], rejection: ['Pstrosek', 'Pštrosek'] });
    });

    it('a two-form group is gone', () => {
        const r = removeSurnameForm(groups([['Pštrosek', 'Pštrossek']]), 'Pštrossek', 'Pštrosek');
        expect(r).toEqual({ variants: [], rejection: ['Pštrossek', 'Pštrosek'] });
    });

    it('without a main form the group\'s first remaining form is the pair\'s other half', () => {
        expect(removeSurnameForm(groups([['Routa', 'Routta', 'Rauta']]), 'Routa')?.rejection).toEqual(['Routa', 'Routta']);
    });

    it('a form in no group: nothing to do', () => {
        expect(removeSurnameForm(groups([['Routa', 'Routta']]), 'Pštrosek')).toBeNull();
        expect(removeSurnameForm(groups([]), 'Pštrosek')).toBeNull();
    });
});

describe('forms that join lines: adding and removing one', () => {
    // Medulín is the son of Vlastislava, unmarried, written in another spelling: only the group joins him.
    const base = (variants?: string[][]): StromData => {
        const d = pstrosek(variants ? { surnameVariants: variants } : {});
        const add = (id: string, first: string, born: string, parents: string[]): void => {
            d.persons[P(id)] = { id: P(id), firstName: first, lastName: 'Pštrossek', gender: 'male', isPlaceholder: false,
                partnerships: [], parentIds: parents as PersonId[], childIds: [], birthDate: born } as Person;
            for (const par of parents) d.persons[P(par)].childIds.push(P(id));
        };
        add('medulin', 'Medulín', '1895', ['vlastislava']);
        add('kostival', 'Kostival', '1920', ['medulin']);
        return d;
    };

    it('without the group the son founds his own line; adding the form merges it', () => {
        const data = base();
        const idx = buildLineages(data);
        expect(rodOfPerson(idx, 'medulin').founderId).toBe('medulin');
        const pv = previewOverride(data, { kind: 'addForm', rodId: rodIdOf(idx, 'mstivoj'), form: 'Pštrossek' }, idx);
        expect(pv.patch?.surnameVariants).toEqual([['Pštrosek', 'Pštrossek']]);
        expect(pv.lines[0]).toMatchObject({ kind: 'merge', label: 'Pštrosek', members: 11, otherMembers: 2 });
        expect(pv.lines[pv.lines.length - 1]).toEqual({ kind: 'formWholeTree' });
    });

    it('removing the form splits the line again, and the group is gone', () => {
        const data = base([['Pštrosek', 'Pštrossek']]);
        const idx = buildLineages(data);
        expect(rodOfPerson(idx, 'kostival').founderId).toBe('hroznata');
        const pv = previewOverride(data, { kind: 'removeForm', rodId: rodIdOf(idx, 'mstivoj'), form: 'Pštrossek' }, idx);
        expect(pv.lines[0]).toMatchObject({ kind: 'splitByForm', before: 13, after: 11, personId: 'medulin', members: 2 });
        expect(pv.lines).toContainEqual({ kind: 'groupGone', forms: ['Pštrosek', 'Pštrossek'] });
        expect(pv.patch).toMatchObject({ surnameVariants: undefined, rejection: ['Pštrossek', 'Pštrosek'] });
    });

    it('a form carried along a parent-child link: the line stays, the preview says why', () => {
        const data = pstrosek({ surnameVariants: [['Pštrosek', 'Pštrossek']] });
        data.persons[P('dobroslav')].lastName = 'Pštrossek';
        const idx = buildLineages(data);
        const pv = previewOverride(data, { kind: 'removeForm', rodId: rodIdOf(idx, 'mstivoj'), form: 'Pštrossek' }, idx);
        expect(pv.lines[0]).toEqual({ kind: 'linkedByRelation' });
    });
});

describe('a union with an empty partner slot (person2Id null)', () => {
    it('lineages, marriages and selections do not trip over it', () => {
        const data = pstrosek();
        data.partnerships['u_lone' as PartnershipId] = {
            id: 'u_lone' as PartnershipId, person1Id: P('trpimir'), person2Id: null as unknown as PersonId, childIds: [], status: 'married',
        };
        data.persons[P('trpimir')].partnerships.push('u_lone' as PartnershipId);
        const idx = buildLineages(data);
        expect(rodOfPerson(idx, 'trpimir').founderId).toBe('hroznata');
        expect(marriedInto(idx, P('trpimir'))).toEqual([]);
        expect(selection(idx, { kind: 'rods', rodIds: [rodIdOf(idx, 'trpimir')] }).memberIds).toContain('trpimir');
    });
});

describe('data version 14: lineageOverrides through a load, a split and GEDCOM', () => {
    it('is 14', () => {
        expect(STROM_DATA_VERSION).toBe(14);
    });

    it('a v13 tree loads unchanged, without the field', () => {
        const v13 = { ...pstrosek(), version: 13 };
        const loaded = migrateData(structuredClone(v13));
        expect(loaded.lineageOverrides).toBeUndefined();
        for (const [id, p] of Object.entries(v13.persons)) expect(loaded.persons[id as PersonId]?.firstName).toBe(p.firstName);
    });

    it('a load keeps the corrections and drops junk and people no longer there', () => {
        const raw = { ...pstrosek(), lineageOverrides: { founders: ['lubor', 'p_gone', 7], notCarriers: 'x' } };
        expect(migrateData(structuredClone(raw) as unknown as StromData).lineageOverrides).toEqual({ founders: ['lubor'] });
        const empty = { ...pstrosek(), lineageOverrides: { founders: [] } };
        expect('lineageOverrides' in migrateData(empty)).toBe(false);
    });

    it('a split keeps the corrections of the people that come along', () => {
        const data = pstrosek({ lineageOverrides: { founders: ['lubor'], notCarriers: ['hroznata'] } });
        const part = extractSubtree(data, new Set([P('zelibor'), P('lubor'), P('dobroslav')]));
        expect(part.lineageOverrides).toEqual({ founders: ['lubor'] });
    });

    const byName = (d: StromData, ids?: string[]): string[] =>
        (ids ?? []).map(id => d.persons[id as PersonId]?.firstName ?? '?').sort();

    it('GEDCOM: `1 _STROM_LINE` under the person after SEX, the header mark, read back', () => {
        const data = pstrosek({ lineageOverrides: { founders: ['lubor'], notCarriers: ['budivoj', 'hroznata'] } });
        const ged = exportToGedcom(data, 'Pštrosek').content;
        expect(ged).toMatch(/\n1 _STROM_LINES Y\r?\n/);
        expect(ged).toMatch(/1 SEX M\r?\n1 _STROM_LINE FOUNDER/);
        expect((ged.match(/_STROM_LINE NOCARRY/g) ?? []).length).toBe(2);
        const back = convertToStrom(parseGedcom(ged)).data;
        expect(byName(back, back.lineageOverrides?.founders)).toEqual(['Lubor']);
        expect(byName(back, back.lineageOverrides?.notCarriers)).toEqual(['Budivoj', 'Hroznata']);
    });

    it('GEDCOM: a plain export without corrections has no mark; the file for the research always has it', () => {
        const data = pstrosek();
        expect(exportToGedcom(data, 'Pštrosek').content).not.toContain('_STROM_LINE');
        const research = exportToGedcom(data, 'Pštrosek', { research: {} } as Parameters<typeof exportToGedcom>[2]).content;
        expect(research).toMatch(/\n1 _STROM_LINES Y\r?\n/);
        expect(research).not.toContain('_STROM_LINE ');
        // Read back: the mark with nobody tagged is the research's "none" (an empty object), no mark says nothing.
        expect(convertToStrom(parseGedcom(research)).data.lineageOverrides).toEqual({});
        expect('lineageOverrides' in convertToStrom(parseGedcom(exportToGedcom(data, 'Pštrosek').content)).data).toBe(false);
    });

    it('GEDCOM: an unknown value is ignored', () => {
        const ged = exportToGedcom(pstrosek({ lineageOverrides: { founders: ['lubor'] } }), 'Pštrosek').content.replace('_STROM_LINE FOUNDER', '_STROM_LINE SOMETHING');
        expect(convertToStrom(parseGedcom(ged)).data.lineageOverrides).toEqual({});
    });

    it('a research version without the mark keeps the tree\'s corrections; with the mark its list is the truth', () => {
        const here = pstrosek({ lineageOverrides: { founders: ['lubor'] } });
        const without = pstrosek();
        expect(keepLineageOverrides(without, here).lineageOverrides).toEqual({ founders: ['lubor'] });
        const marked = { ...pstrosek(), lineageOverrides: {} };
        expect(keepLineageOverrides(marked, here)).toBe(marked);
        expect(migrateData(keepLineageOverrides(marked, here)).lineageOverrides).toBeUndefined();
    });

    it('the research fingerprint moves with a correction, and stays for a tree without any', () => {
        const plain = pstrosek();
        expect(contentFingerprint({ ...plain, lineageOverrides: {} })).toBe(contentFingerprint(plain));
        expect(contentFingerprint(pstrosek({ lineageOverrides: { founders: ['lubor'] } }))).not.toBe(contentFingerprint(plain));
    });

    it('the changes overview lists a correction, as app-only until the research reads `lineage.read`', () => {
        const other = diffOther(pstrosek(), pstrosek({ lineageOverrides: { founders: ['lubor'] } }))!;
        expect(other.lineage).toEqual({ count: 1, items: [{ personId: 'lubor', name: 'Lubor Pštrosek', now: 'founder' }] });
        expect(sentOtherRows(other)).toContainEqual({ type: 'lineage', id: '', title: '', kinds: [], count: 1, appOnly: true });
        const reads = new Set(RESEARCH_UNREAD_KINDS);
        reads.delete('lineage');
        expect(sentOtherRows(other, reads)).toContainEqual({ type: 'lineage', id: '', title: '', kinds: [], count: 1 });
    });
});

describe('DataManager.applyLineagePatch: one undo step, the change log, a rejected pair', () => {
    const TREE = 'lineage-test-tree' as TreeId;
    let log: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
        log = vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
        const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
        dm.data = pstrosek({ surnameVariants: [['Pštrosek', 'Pštrossek', 'Pstrosek']] });
        dm.currentTreeId = TREE;
        dm.viewMode = false;
        dm.pendingBefore = null;
        UndoManager.setActiveTree(null);
        UndoManager.setActiveTree(TREE);
    });

    it('a founder set by hand, undone', () => {
        const idx = buildLineages(DataManager.getData());
        const patch = applyLineageChange(idx, { kind: 'founder', personId: P('mstivoj') })!;
        expect(DataManager.applyLineagePatch(patch, 'founder', { action: 'lineage.founder', text: 'Mstivoj' })).toBe(true);
        expect(DataManager.getData().lineageOverrides).toEqual({ notCarriers: ['budivoj', 'hroznata'] });
        expect(log).toHaveBeenCalledWith(TREE, 'lineage.founder', 'Mstivoj');
        DataManager.undo();
        expect(DataManager.getData().lineageOverrides).toBeUndefined();
    });

    it('a removed form leaves its group and is remembered as rejected', () => {
        const idx = buildLineages(DataManager.getData());
        const patch = applyLineageChange(idx, { kind: 'removeForm', rodId: rodIdOf(idx, 'mstivoj'), form: 'Pstrosek' })!;
        DataManager.applyLineagePatch(patch, 'remove', { action: 'surnames.removeForm', text: 'Pstrosek' });
        const d = DataManager.getData();
        expect(d.surnameVariants).toEqual([['Pštrosek', 'Pštrossek']]);
        expect(d.surnameRejections?.map(r => r.forms)).toEqual([['Pstrosek', 'Pštrosek']]);
        expect(log).toHaveBeenCalledWith(TREE, 'surnames.removeForm', 'Pstrosek');
        DataManager.undo();
        expect(DataManager.getData().surnameVariants).toEqual([['Pštrosek', 'Pštrossek', 'Pstrosek']]);
        expect(DataManager.getData().surnameRejections).toBeUndefined();
    });
});
