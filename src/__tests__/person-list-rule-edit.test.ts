import { describe, expect, it } from 'vitest';
import type { RuleCond, RuleGroup } from '../types.js';
import {
    addCondition, addGroup, canAddGroup, canExcept, dissolveGroup, duplicateNode, editedConditions, emptyRuleRoot,
    firstIncomplete, groupLevel, groupWithNext, groupWithNextState, moveBounds, moveNode, moveNodeTo, nodeAt,
    removeNode, setGroupOp, toggleExcept,
} from '../person-list-rule-edit.js';

const female: RuleCond = { t: 'cond', c: 'gender', p: { value: 'female' } };
const male: RuleCond = { t: 'cond', c: 'gender', p: { value: 'male' } };
const living: RuleCond = { t: 'cond', c: 'alive', p: { value: 'living' } };
const born = (from?: number, to?: number): RuleCond => ({ t: 'cond', c: 'born', p: { ...(from ? { from } : {}), ...(to ? { to } : {}) } });

/** A compact picture of a rule: conditions as c:value/years, groups as op[...], excepts with "!". */
function shape(g: RuleGroup): string {
    const node = (n: RuleGroup['items'][number]): string => {
        const s = n.t === 'group' ? `${n.op}[${n.items.map(node).join(',')}]`
            : n.c === 'born' ? `born:${n.p.from ?? ''}-${n.p.to ?? ''}`
                : `${n.c}:${(n.p as { value: string }).value}`;
        return (n.not ? '!' : '') + s;
    };
    return `${g.op}[${g.items.map(node).join(',')}]`;
}

function build(...conds: RuleCond[]): RuleGroup {
    let root = emptyRuleRoot();
    for (const c of conds) root = addCondition(root, '', c).root;
    return root;
}

describe('person-list-rule-edit', () => {
    it('adds conditions in order and never changes the old root', () => {
        const a = addCondition(emptyRuleRoot(), '', female);
        expect(a.path).toBe('0');
        const b = addCondition(a.root, '', living);
        expect(b.path).toBe('1');
        expect(shape(a.root)).toBe('all[gender:female]');
        expect(shape(b.root)).toBe('all[gender:female,alive:living]');
    });

    it('adds a new condition before the group\'s excepts', () => {
        const r = toggleExcept(build(female, living), '1').root;
        expect(shape(r)).toBe('all[gender:female,!alive:living]');
        const next = addCondition(r, '', born(1900, 1950));
        expect(next.path).toBe('1');
        expect(shape(next.root)).toBe('all[gender:female,born:1900-1950,!alive:living]');
    });

    it('moves a row within its part and not across the excepts', () => {
        let r = build(female, male, living);
        r = toggleExcept(r, '2').root;
        expect(moveBounds(r, '0')).toEqual({ up: false, down: true });
        expect(moveBounds(r, '1')).toEqual({ up: true, down: false });
        expect(moveBounds(r, '2')).toEqual({ up: false, down: false });
        const m = moveNode(r, '0', 1)!;
        expect(m.path).toBe('1');
        expect(shape(m.root)).toBe('all[gender:male,gender:female,!alive:living]');
        expect(moveNode(r, '1', 1)).toBeNull();
        // Dragging further than the part is clamped to it.
        expect(shape(moveNodeTo(build(female, male, living), '0', 9)!.root)).toBe('all[gender:male,alive:living,gender:female]');
    });

    it('puts an except at the end of its group and an included one at the end of the positives', () => {
        const r = build(female, living, born(1900));
        expect(canExcept(r, '0')).toBe(false);
        const ex = toggleExcept(r, '1');
        expect(ex.path).toBe('2');
        expect(shape(ex.root)).toBe('all[gender:female,born:1900-,!alive:living]');
        const back = toggleExcept(ex.root, '2');
        expect(back.path).toBe('2');
        expect(shape(back.root)).toBe('all[gender:female,born:1900-,alive:living]');
        // The first item cannot be made an except.
        expect(toggleExcept(r, '0').root).toBe(r);
    });

    it('groups a row with the next one and dissolves it again', () => {
        const r = build(female, male, living);
        const g = groupWithNext(r, '0')!;
        expect(g.path).toBe('0');
        expect(shape(g.root)).toBe('all[all[gender:female,gender:male],alive:living]');
        const any = setGroupOp(g.root, '0', 'any');
        expect(shape(any)).toBe('all[any[gender:female,gender:male],alive:living]');
        expect(groupWithNextState(r, '2')).toBe('disabled');
        const d = dissolveGroup(any, '0');
        expect(shape(d.root)).toBe('all[gender:female,gender:male,alive:living]');
        expect(d.path).toBe('0');
    });

    it('turns two excepts into one except group of "any" and back into excepts', () => {
        let r = build(female, male, living);
        r = toggleExcept(r, '1').root;
        r = toggleExcept(r, '1').root;
        expect(shape(r)).toBe('all[gender:female,!gender:male,!alive:living]');
        const g = groupWithNext(r, '1')!;
        expect(shape(g.root)).toBe('all[gender:female,!any[gender:male,alive:living]]');
        expect(shape(dissolveGroup(g.root, '1').root)).toBe('all[gender:female,!gender:male,!alive:living]');
    });

    it('nests groups at most three levels deep', () => {
        expect(groupLevel('')).toBe(1);
        expect(groupLevel('0')).toBe(2);
        expect(groupLevel('0.1')).toBe(3);
        const a = addGroup(build(female), '', living)!;
        expect(shape(a.root)).toBe('all[gender:female,all[alive:living]]');
        expect(a.path).toBe('1.0');
        expect(canAddGroup('1')).toBe(true);
        const b = addGroup(a.root, '1', male)!;
        expect(shape(b.root)).toBe('all[gender:female,all[alive:living,all[gender:male]]]');
        expect(b.path).toBe('1.1.0');
        // The third level offers no group, and "group with…" is not drawn there.
        expect(canAddGroup('1.1')).toBe(false);
        expect(addGroup(b.root, '1.1', female)).toBeNull();
        const c = addCondition(b.root, '1.1', female).root;
        expect(groupWithNextState(c, '1.1.0')).toBe('hidden');
        // A group of the second level with a nested group under it would be too deep.
        expect(groupWithNextState(addCondition(b.root, '1', female).root, '1.1')).toBe('disabled');
    });

    it('removes a group left empty and gives the neighbour to focus', () => {
        const a = addGroup(build(female, living), '', male)!;
        const r = removeNode(a.root, '2.0');
        expect(shape(r.root)).toBe('all[gender:female,alive:living]');
        const first = removeNode(build(female, living), '0');
        expect(first.path).toBe('0');
        expect(nodeAt(first.root, first.path)).toMatchObject({ c: 'alive' });
        expect(removeNode(build(female), '0').path).toBe('');
    });

    it('duplicates a row right after it', () => {
        const d = duplicateNode(build(female, living), '0');
        expect(d.path).toBe('1');
        expect(shape(d.root)).toBe('all[gender:female,gender:female,alive:living]');
    });

    it('finds the first incomplete condition counted over all levels', () => {
        const a = addGroup(build(female), '', born())!;
        expect(firstIncomplete(a.root)).toEqual({ n: 2, path: '1.0' });
        expect(firstIncomplete(build(female, born(1900)))).toBeNull();
    });

    it('counts the edited conditions against the start', () => {
        const start = build(female, living);
        expect(editedConditions(start, start)).toBe(0);
        expect(editedConditions(null, build(female))).toBe(1);
        expect(editedConditions(null, build(female, living))).toBe(2);
        expect(editedConditions(start, build(male, living))).toBe(1);
        expect(editedConditions(start, build(male, born(1900)))).toBe(2);
        expect(editedConditions(start, toggleExcept(start, '1').root)).toBe(1);
        // Moving rows changes no condition.
        expect(editedConditions(start, moveNode(start, '0', 1)!.root)).toBe(0);
    });
});
