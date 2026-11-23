/**
 * The undecided rest of step 2 decided at once (K3.4, 134 N2): a pair with
 * the same parents or partner as the tree's person is left out of
 * "Add as new" / "Do not add" (as new it would double a family), the
 * buttons count the rest without it, and Continue stays locked until those
 * pairs are decided one by one. The family Modřín is invented.
 */

import { describe, it, expect } from 'vitest';
import { createMergeState, updateMatchDecision } from '../merge/matching.js';
import { buildPlan, planCounts, planFates, PlanSource, WizardChoices } from '../merge/plan.js';
import { pairRows, restSplit } from '../merge/steps/step2-who.js';
import { stepAvailability } from '../merge/wizard-steps.js';
import { strings } from '../strings.js';
import { Person, PersonId, StromData } from '../types.js';

const SOURCE: PlanSource = { kind: 'ged', label: 'modrinovi-2.ged', persons: 0 };

function choices(): WizardChoices {
    return {
        mode: 'add', targetTreeId: 'tree-modrin' as WizardChoices['targetTreeId'], scope: 'b', swapped: false,
        source: SOURCE, targetName: 'Modřínovi', targetFingerprint: 'fp', planId: 'mp-rest', createdAt: '2026-05-04T10:00:00.000Z',
    };
}

function person(id: string, first: string, last: string, gender: Person['gender'], o: Partial<Person> = {}): Person {
    return { id: id as PersonId, firstName: first, lastName: last, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...o };
}

/** Kvido 1921 and Florentýna 1924 with their son Teofil 1950; Vojmír Modřín 1930 of no known family. */
function tree(): StromData {
    return {
        persons: {
            t_kvido: person('t_kvido', 'Kvido', 'Modřín', 'male', { birthDate: '1921', partnerships: ['t_u1' as never], childIds: ['t_teofil' as PersonId] }),
            t_flor: person('t_flor', 'Florentýna', 'Modřínová', 'female', { birthDate: '1924', partnerships: ['t_u1' as never], childIds: ['t_teofil' as PersonId] }),
            t_teofil: person('t_teofil', 'Teofil', 'Modřín', 'male', { birthDate: '1950', parentIds: ['t_kvido', 't_flor'] as PersonId[] }),
            t_vojmir: person('t_vojmir', 'Vojmír', 'Modřín', 'male', { birthDate: '1930' }),
        },
        partnerships: { t_u1: { id: 't_u1' as never, person1Id: 't_kvido' as PersonId, person2Id: 't_flor' as PersonId, childIds: ['t_teofil' as PersonId], status: 'married' } },
    } as StromData;
}

/** The file: Kvido 1921 (the same), Florentýna, Teofil and Vojmír without dates (only offered). */
function file(): StromData {
    return {
        persons: {
            i_kvido: person('i_kvido', 'Kvido', 'Modřín', 'male', { birthDate: '1921', partnerships: ['i_u1' as never], childIds: ['i_teofil' as PersonId] }),
            i_flor: person('i_flor', 'Florentýna', 'Modřínová', 'female', { partnerships: ['i_u1' as never], childIds: ['i_teofil' as PersonId] }),
            i_teofil: person('i_teofil', 'Teofil', 'Modřín', 'male', { parentIds: ['i_kvido', 'i_flor'] as PersonId[] }),
            i_vojmir: person('i_vojmir', 'Vojmír', 'Modřín', 'male'),
        },
        partnerships: { i_u1: { id: 'i_u1' as never, person1Id: 'i_kvido' as PersonId, person2Id: 'i_flor' as PersonId, childIds: ['i_teofil' as PersonId], status: 'married' } },
    } as StromData;
}

describe('the undecided rest leaves out the pairs of one family (134 N2)', () => {
    it('Add as new / Do not add take only the pairs without the same parents or partner', () => {
        const state = createMergeState(tree(), file());
        const plan = buildPlan(state, choices());
        expect(planCounts(plan).pending).toBe(3);
        const { bulk, oneByOne } = restSplit(pairRows(state), planFates(plan));
        // Florentýna's partner and Teofil's parents are the tree's: decided one by one.
        expect(bulk).toEqual(['i_vojmir']);
        expect([...oneByOne].sort()).toEqual(['i_flor', 'i_teofil']);
    });

    it('after the rest is decided, the pairs of one family are still "to decide" and Continue waits for them', () => {
        const state = createMergeState(tree(), file());
        const rest = restSplit(pairRows(state), planFates(buildPlan(state, choices())));
        for (const id of rest.bulk) updateMatchDecision(state, id, 'reject');
        let plan = buildPlan(state, choices());
        expect(planCounts(plan).pending).toBe(rest.oneByOne.length);
        expect(stepAvailability(choices(), plan)[3]).toBe('locked');
        // The rest now offers nothing at once, only the sentence.
        expect(restSplit(pairRows(state), planFates(plan)).bulk).toEqual([]);
        for (const id of rest.oneByOne) updateMatchDecision(state, id, 'confirm');
        plan = buildPlan(state, choices());
        expect(planCounts(plan).pending).toBe(0);
        expect(stepAvailability(choices(), plan)[3]).toBe('ok');
    });

    it('says how many pairs are decided one by one, in every language', () => {
        expect(strings.mergeWizard.restOneByOne(2)).toMatch(/^2 /);
        expect(strings.mergeWizard.restOneByOne(1)).toMatch(/^1 /);
    });
});
