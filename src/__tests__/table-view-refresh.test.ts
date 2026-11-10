/**
 * Table view (spec 073 §10.3): after a change of the data the rows keep their
 * place (a row that no longer passes stays, stale), the rows an edit or the
 * research's bridge changed, and the names in the bridge's toast.
 */

import { describe, it, expect } from 'vitest';
import { buildTableModel, rowKey, type TableModel } from '../ui/table-view/table-model.js';
import {
    bridgeChanges, changedKeys, familyKeys, keepOrder, namesList, rowKeysFor, watchEdit,
} from '../ui/table-view/table-refresh.js';
import type { PersonId, StromData } from '../types.js';

function tree(): StromData {
    const person = (id: string, firstName: string, lastName: string, gender: 'male' | 'female', extra: object = {}) =>
        ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
    return {
        version: 17,
        persons: {
            a: person('a', 'Radoslav', 'Kmínek', 'male', { partnerships: ['u1'], childIds: ['c'], birthDate: '1890' }),
            b: person('b', 'Hedvika', 'Šafránová', 'female', { partnerships: ['u1'], childIds: ['c'], birthDate: '1893' }),
            c: person('c', 'Jaromír', 'Kmínek', 'male', { parentIds: ['a', 'b'], birthDate: '1921' }),
            d: person('d', 'Otýlie', 'Pelyňková', 'female', { birthDate: '1925' }),
        },
        partnerships: {
            u1: { id: 'u1', person1Id: 'a', person2Id: 'b', childIds: ['c'], status: 'married', startDate: '1919' },
        },
    } as unknown as StromData;
}

const build = (data: StromData, rev = 1): TableModel => buildTableModel(data, { rev, homeId: 'c' as PersonId, lang: 'en', year: 2026 });
const keys = (rows: readonly { kind: string; id: string }[]) => rows.map(r => `${r.kind === 'person' ? 'p' : 'u'}:${r.id}`);

describe('keepOrder (§10.3)', () => {
    it('keeps the last order in the new model and marks a row that no longer passes as stale', () => {
        const before = build(tree());
        const shown = [before.personRows.get('d' as PersonId)!, before.personRows.get('a' as PersonId)!, before.personRows.get('c' as PersonId)!];
        const data = tree();
        (data.persons as unknown as Record<string, { birthDate?: string }>).a.birthDate = '1960';
        const after = build(data, 2);
        // The fresh pass: "a" no longer passes, "b" passes now (and was not shown).
        const fresh = [after.personRows.get('c' as PersonId)!, after.personRows.get('b' as PersonId)!, after.personRows.get('d' as PersonId)!];
        const kept = keepOrder(after, shown, fresh);
        expect(keys(kept.rows)).toEqual(['p:d', 'p:a', 'p:c', 'p:b']);
        expect([...kept.stale]).toEqual(['p:a']);
        // The rows are the new model's.
        expect(kept.rows[1]).toBe(after.personRows.get('a' as PersonId));
    });

    it('drops a row gone from the data', () => {
        const before = build(tree());
        const shown = [before.personRows.get('d' as PersonId)!, before.personRows.get('c' as PersonId)!];
        const data = tree();
        delete (data.persons as unknown as Record<string, unknown>).d;
        const after = build(data, 2);
        const kept = keepOrder(after, shown, [after.personRows.get('c' as PersonId)!]);
        expect(keys(kept.rows)).toEqual(['p:c']);
        expect(kept.stale.size).toBe(0);
    });

    it('works for union rows', () => {
        const m = build(tree());
        const u = m.unionRows.get('u1' as never)!;
        const kept = keepOrder(m, [u], []);
        expect(rowKey(kept.rows[0])).toBe('u:u1');
        expect(kept.stale.has('u:u1')).toBe(true);
    });
});

describe('the rows an edit changed (§10.3)', () => {
    it('watches the person, the parents, the children, the unions and the partners', () => {
        expect(familyKeys(tree(), 'a' as PersonId).sort()).toEqual(['p:a', 'p:b', 'p:c', 'u:u1']);
        expect(familyKeys(tree(), 'c' as PersonId).sort()).toEqual(['p:a', 'p:b', 'p:c']);
        expect(familyKeys(tree(), 'zz' as PersonId)).toEqual([]);
    });

    it('tells what changed after the save, nothing after a cancel', () => {
        const data = tree();
        const watched = watchEdit(data, familyKeys(data, 'a' as PersonId));
        expect(changedKeys(data, watched)).toEqual([]);
        (data.persons as unknown as Record<string, { deathDate?: string }>).a.deathDate = '1958';
        (data.partnerships as unknown as Record<string, { startDate?: string }>).u1.startDate = '1918';
        expect(changedKeys(data, watched).sort()).toEqual(['p:a', 'u:u1']);
    });

    it('maps changed records to the rows of each table', () => {
        const data = tree();
        expect([...rowKeysFor(data, 'persons', ['u:u1'])].sort()).toEqual(['p:a', 'p:b']);
        expect([...rowKeysFor(data, 'persons', ['p:d'])]).toEqual(['p:d']);
        expect([...rowKeysFor(data, 'unions', ['p:a'])]).toEqual(['u:u1']);
        expect([...rowKeysFor(data, 'unions', ['p:d'])]).toEqual([]);
        expect([...rowKeysFor(data, 'unions', ['u:u1'])]).toEqual(['u:u1']);
    });
});

describe('a change from the research\'s bridge (§10.3, 10d)', () => {
    it('counts the facts changed and names the records', () => {
        const before = tree();
        const after = tree();
        const persons = after.persons as unknown as Record<string, Record<string, unknown>>;
        persons.d.birthDate = '1926';
        persons.d.birthPlace = 'Lhotka';
        (after.partnerships as unknown as Record<string, Record<string, unknown>>).u1.startPlace = 'Dolní Věžnice';
        const ch = bridgeChanges(before, after);
        expect(ch.keys.sort()).toEqual(['p:d', 'u:u1']);
        expect(ch.facts).toBe(3);
    });

    it('counts a person added as one fact', () => {
        const before = tree();
        const after = tree();
        (after.persons as unknown as Record<string, unknown>).e = { id: 'e', firstName: 'Kvido', lastName: 'Pelyněk', gender: 'male', partnerships: [], parentIds: [], childIds: [] };
        expect(bridgeChanges(before, after)).toEqual({ keys: ['p:e'], facts: 1 });
        expect(bridgeChanges(before, tree())).toEqual({ keys: [], facts: 0 });
    });
});

describe('namesList', () => {
    it('shows two names, then an ellipsis', () => {
        expect(namesList(['A'])).toBe('A');
        expect(namesList(['A', 'B'])).toBe('A, B');
        expect(namesList(['A', 'B', 'C'])).toBe('A, B…');
    });
});
