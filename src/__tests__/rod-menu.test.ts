/**
 * The person menu's "Select ›" (spec 098 §2, 1g; spec 039 §2.1 for the
 * lines): no row without a line of two people, ancestors or descendants; the
 * submenu has the birth line first with "birth" / "wife" for two lines, a
 * divider, then Ancestors and Descendants with their counts; "Clear the
 * selection" when the person is in the window's selection; offered in the
 * view mode too. Every name is invented.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildLineages, rodLabels, rodOf, RodId, LineageIndex } from '../lineage.js';
import { StromData, PersonId, Person, Partnership, PartnershipId } from '../types.js';
import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { contextMenuMethods, selectionMenuRows, PersonMenuAction } from '../ui/context-menu.js';
import { encodeSelectionRef } from '../view-selection.js';
import { resetViewSelection as resetRodView } from '../ui/view-selection-ui.js';

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

describe('the person menu\'s "Select ›" (§2)', () => {
    const data = sample();
    const idx = buildLineages(data);
    const labels = rodLabels(idx);
    const brumlak = rodIdOf(idx, 'hostivit');
    const trnkavec = rodIdOf(idx, 'kvido');
    const orechovsky = rodIdOf(idx, 'lumir');
    const sel = (ref: Parameters<typeof encodeSelectionRef>[0]): string => `select:${encodeSelectionRef(ref)}`;

    it('no line of two people, no ancestors, no descendants: no row', () => {
        expect(selectionMenuRows(idx, labels, P('vratislav'), null)).toEqual([]);
    });

    it('one row "Select" with a submenu: the line without a meta, a divider, the ancestors with their count', () => {
        const rows = selectionMenuRows(idx, labels, P('borivoj'), null);
        expect(actions(rows)).toEqual(['select']);
        expect(rows[0]).toMatchObject({ label: 'Select', kind: 'focus' });
        const sub = rows[0].submenu!;
        expect(actions(sub)).toEqual([sel({ kind: 'rod', rodId: brumlak }), sel({ kind: 'ancestors', personId: P('borivoj') })]);
        expect(sub[0]).toMatchObject({ label: 'Brumlák line', kind: 'focus' });
        expect(sub[0].meta).toBeUndefined();
        expect(sub[1]).toMatchObject({ label: 'Ancestors', meta: '2', divider: true });
    });

    it('the founder: Descendants with their count, no Ancestors', () => {
        const sub = selectionMenuRows(idx, labels, P('hostivit'), null)[0].submenu!;
        expect(actions(sub)).toEqual([sel({ kind: 'rod', rodId: brumlak }), sel({ kind: 'descendants', personId: P('hostivit') })]);
        expect(sub[1]).toMatchObject({ label: 'Descendants', meta: '3' });
    });

    it('several lines: the birth line first ("birth"), the husbands\' lines ("wife")', () => {
        const sub = selectionMenuRows(idx, labels, P('radoslava'), null)[0].submenu!;
        expect(actions(sub).slice(0, 3)).toEqual([brumlak, trnkavec, orechovsky].map(id => sel({ kind: 'rod', rodId: id })));
        expect(sub.slice(0, 3).map(a => a.meta)).toEqual(['birth', 'wife', 'wife']);
        expect(sub[3]).toMatchObject({ label: 'Ancestors', divider: true });
    });

    it('a person in the window\'s selection: "Clear the selection" under the row', () => {
        const rows = selectionMenuRows(idx, labels, P('borivoj'), { kind: 'rod', rodId: brumlak });
        expect(actions(rows)).toEqual(['select', 'select-clear']);
        expect(rows[1]).toMatchObject({ label: 'Clear the selection', kind: 'focus' });
        // Ancestors of Bořivoj: Hostivít is in, Vojmír is not.
        expect(actions(selectionMenuRows(idx, labels, P('hostivit'), { kind: 'ancestors', personId: P('borivoj') }))).toContain('select-clear');
        expect(actions(selectionMenuRows(idx, labels, P('vojmir'), { kind: 'ancestors', personId: P('borivoj') }))).toEqual(['select']);
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
        expect(rows[i + 1]).toBe('select');
        expect(rows[i + 2]).toMatch(/^select:rod:/);
    });

    it('in the view mode too', () => {
        readOnly = true;
        expect(menu('borivoj').filter(a => a.startsWith('select:rod:'))).toHaveLength(1);
        expect(menu('radoslava').filter(a => a.startsWith('select:rod:'))).toHaveLength(3);
        expect(menu('vratislav').some(a => a.startsWith('select'))).toBe(false);
    });
});
