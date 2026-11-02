/**
 * The person menu's family lines (spec 039 §2.1, §2.2): no row without a
 * line of two people, "Only the X line" for one, the birth line first with
 * "birth" / "wife" for two, a submenu from three; the chosen line's row shows
 * the whole tree; offered in the view mode too. Every name is invented.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildLineages, rodLabels, rodOf, RodId, LineageIndex } from '../lineage.js';
import { StromData, PersonId, Person, Partnership, PartnershipId } from '../types.js';
import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { contextMenuMethods, rodMenuRows, PersonMenuAction } from '../ui/context-menu.js';
import { resetRodView } from '../ui/rod-view.js';

type Sex = 'male' | 'female';
interface Spec { first: string; last: string; sex: Sex; born?: string; parents?: string[] }

function tree(people: Record<string, Spec>, unions: [string, string, string, string[]][]): StromData {
    const persons: Record<string, Person> = {};
    for (const [id, s] of Object.entries(people)) {
        persons[id] = {
            id: id as PersonId, firstName: s.first, lastName: s.last, gender: s.sex, isPlaceholder: false,
            partnerships: [], parentIds: (s.parents ?? []) as PersonId[], childIds: [], birthDate: s.born,
        } as Person;
    }
    for (const p of Object.values(persons)) for (const par of p.parentIds) persons[par]?.childIds.push(p.id);
    const partnerships: Record<string, Partnership> = {};
    for (const [uid, a, b, kids] of unions) {
        partnerships[uid] = { id: uid as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId, childIds: kids as PersonId[], status: 'married' };
        persons[a].partnerships.push(uid as PartnershipId);
        persons[b].partnerships.push(uid as PartnershipId);
    }
    return { version: 13, persons, partnerships } as StromData;
}

// Radoslava Brumláková, born to the Brumlák line, married first into the
// Trnkavec line and then into the Ořechovský line; Vratislav is alone.
const sample = (): StromData => tree({
    hostivit: { first: 'Hostivít', last: 'Brumlák', sex: 'male', born: '1800' },
    borivoj: { first: 'Bořivoj', last: 'Brumlák', sex: 'male', born: '1830', parents: ['hostivit'] },
    radoslava: { first: 'Radoslava', last: 'Brumláková', sex: 'female', born: '1832', parents: ['hostivit'] },
    kvido: { first: 'Kvido', last: 'Trnkavec', sex: 'male', born: '1795' },
    spytihnev: { first: 'Spytihněv', last: 'Trnkavec', sex: 'male', born: '1828', parents: ['kvido'] },
    lumir: { first: 'Lumír', last: 'Ořechovský', sex: 'male', born: '1800' },
    vojmir: { first: 'Vojmír', last: 'Ořechovský', sex: 'male', born: '1826', parents: ['lumir'] },
    vratislav: { first: 'Vratislav', last: 'Kopýtko', sex: 'male', born: '1900' },
}, [
    ['u1', 'spytihnev', 'radoslava', []],
    ['u2', 'vojmir', 'radoslava', []],
]);

const P = (id: string): PersonId => id as PersonId;
const rodIdOf = (idx: LineageIndex, id: string): RodId => rodOf(idx, P(id))!;
const actions = (rows: PersonMenuAction[]): string[] => rows.map(a => a.action);

describe('the person menu\'s lines (§2.1)', () => {
    const data = sample();
    const idx = buildLineages(data);
    const labels = rodLabels(idx);
    const brumlak = rodIdOf(idx, 'hostivit');
    const trnkavec = rodIdOf(idx, 'kvido');
    const orechovsky = rodIdOf(idx, 'lumir');

    it('no line of two people: no row', () => {
        expect(rodMenuRows(idx, labels, P('vratislav'), null)).toEqual([]);
    });

    it('one line: "Only the X line" without a meta', () => {
        const rows = rodMenuRows(idx, labels, P('borivoj'), null);
        expect(actions(rows)).toEqual([`rod-only:${brumlak}`]);
        expect(rows[0].label).toBe('Only the Brumlák line');
        expect(rows[0].meta).toBeUndefined();
        expect(rows[0].kind).toBe('focus');
    });

    it('two lines: the birth line first ("birth"), the husband\'s line ("husband")', () => {
        const rows = rodMenuRows(idx, labels, P('spytihnev'), null);
        // Spytihněv: born Trnkavec, his wife's line is not his.
        expect(actions(rows)).toEqual([`rod-only:${trnkavec}`]);
        const two = buildLineages(tree({
            hostivit: { first: 'Hostivít', last: 'Brumlák', sex: 'male', born: '1800' },
            borivoj: { first: 'Bořivoj', last: 'Brumlák', sex: 'male', born: '1830', parents: ['hostivit'] },
            radoslava: { first: 'Radoslava', last: 'Brumláková', sex: 'female', born: '1832', parents: ['hostivit'] },
            kvido: { first: 'Kvido', last: 'Trnkavec', sex: 'male', born: '1795' },
            spytihnev: { first: 'Spytihněv', last: 'Trnkavec', sex: 'male', born: '1828', parents: ['kvido'] },
        }, [['u1', 'spytihnev', 'radoslava', []]]));
        const r2 = rodMenuRows(two, rodLabels(two), P('radoslava'), null);
        expect(r2.map(a => [a.label, a.meta])).toEqual([
            ['Only the Brumlák line', 'birth'],
            ['Only the Trnkavec line', 'wife'],
        ]);
    });

    it('three lines: a submenu "Only one line", birth first', () => {
        const rows = rodMenuRows(idx, labels, P('radoslava'), null);
        expect(rows).toHaveLength(1);
        expect(rows[0].label).toBe('Only one line');
        expect(rows[0].submenu?.map(a => a.action)).toEqual([`rod-only:${brumlak}`, `rod-only:${trnkavec}`, `rod-only:${orechovsky}`]);
        expect(rows[0].submenu?.map(a => a.meta)).toEqual(['birth', 'wife', 'wife']);
    });

    it('the chosen line: its row shows the whole tree', () => {
        expect(actions(rodMenuRows(idx, labels, P('borivoj'), brumlak))).toEqual(['rod-clear']);
        const rows = rodMenuRows(idx, labels, P('radoslava'), trnkavec);
        expect(rows[0]).toMatchObject({ action: 'rod-clear', label: 'Show the whole tree' });
        expect(rows[1].submenu?.map(a => a.action)).toEqual([`rod-only:${brumlak}`, `rod-only:${orechovsky}`]);
        // Another line chosen: the person's rows unchanged.
        expect(actions(rodMenuRows(idx, labels, P('borivoj'), trnkavec))).toEqual([`rod-only:${brumlak}`]);
    });
});

describe('getPersonMenuActions offers the lines (§2.2)', () => {
    let data: StromData;
    let readOnly = false;
    // Every helper of the menu answers "nothing"; only the lines are real.
    const host = new Proxy({} as Record<string, unknown>, {
        get(_t, prop: string) {
            if (prop === 'getPersonMenuActions') return contextMenuMethods.getPersonMenuActions;
            if (prop === 'personViewLinkMenu') return () => ({ head: [], afterFocus: [] });
            if (prop === 'personResearchKnows' || prop === 'materialsContext') return () => null;
            if (prop === 'personSourceCount' || prop === 'personMaterialsCount') return () => 0;
            if (prop === 'materialAvailable' || prop === 'readDocumentReady' || prop === 'materialsListOn') return () => false;
            return () => [];
        },
    });
    const menu = (id: string): string[] => {
        const out: string[] = [];
        const walk = (rows: PersonMenuAction[]): void => rows.forEach(a => { out.push(a.action); if (a.submenu) walk(a.submenu); });
        walk((contextMenuMethods.getPersonMenuActions as (this: unknown, p: PersonId) => PersonMenuAction[]).call(host, P(id)));
        return out;
    };

    beforeEach(() => {
        data = sample();
        readOnly = false;
        vi.spyOn(DataManager, 'getData').mockImplementation(() => data);
        vi.spyOn(DataManager, 'getCurrentTreeId').mockImplementation(() => 'brumlak' as never);
        vi.spyOn(DataManager, 'getPerson').mockImplementation((id: PersonId) => data.persons[id]);
        vi.spyOn(DataManager, 'isReadOnly').mockImplementation(() => readOnly);
        vi.spyOn(DataManager, 'isPersonLocked').mockImplementation(() => false);
        vi.spyOn(DataManager, 'isTreeLocked').mockImplementation(() => false);
        vi.spyOn(TreeRenderer, 'canToggleChildren').mockImplementation(() => false);
        resetRodView();
    });
    afterEach(() => { vi.restoreAllMocks(); resetRodView(); });

    it('in the normal menu, right after Show descendants', () => {
        const rows = menu('borivoj');
        const i = rows.indexOf('descendants');
        expect(i).toBeGreaterThanOrEqual(0);
        expect(rows[i + 1]).toMatch(/^rod-only:/);
    });

    it('in the view mode too', () => {
        readOnly = true;
        expect(menu('borivoj').filter(a => a.startsWith('rod-only:'))).toHaveLength(1);
        expect(menu('radoslava').filter(a => a.startsWith('rod-only:'))).toHaveLength(3);
        expect(menu('vratislav').some(a => a.startsWith('rod'))).toBe(false);
    });
});
