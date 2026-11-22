/**
 * The merge plan (spec 134 §0.2, §1 tests): the counts add up after every
 * choice of the guide, the write does only what the plan says (scope a) does
 * not touch joined persons, b) only fills gaps, d) adds nobody), nothing of
 * either tree is lost, an undecided pair below the threshold is still to
 * decide; the plan's fingerprint, the scope's example and a repeated source.
 * Invented trees only (helpers/merge-trees.ts), deterministic seeds.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { AUTO_CONFIRM_SCORE, existingTargetOf } from '../merge/executor.js';
import { createMergeState } from '../merge/matching.js';
import {
    applyPlan, buildPlan, isRepeatOf, planCounts, planFates, planFingerprint, scopeExample,
    MergePlan, MergeRecord, PersonFate, PlanScope, PlanSource, WizardChoices,
} from '../merge/plan.js';
import { MergeState } from '../merge/types.js';
import { StorageManager } from '../storage.js';
import { Partnership, PartnershipId, Person, PersonId, StromData } from '../types.js';
import { mulberry32, randomDecisions, sourceTree, targetTree } from './helpers/merge-trees.js';

const RUNS = 200;
const SCOPES: readonly PlanScope[] = ['a', 'b', 'c', 'd'];
/** The details of a person the plan names (plan.ts PERSON_FIELDS). */
const FIELDS = ['firstName', 'lastName', 'marriedSurname', 'titleBefore', 'titleAfter', 'gender', 'birthDate', 'birthPlace',
    'birthAddress', 'birthAge', 'deathDate', 'deathPlace', 'deathAddress', 'deathAge', 'deathCause', 'notes', 'photo'] as const;

const SOURCE: PlanSource = { kind: 'ged', label: 'rodokmen-Habrovi.ged', persons: 0 };

function choices(over: Partial<WizardChoices> = {}): WizardChoices {
    return {
        mode: 'add', targetTreeId: 'tree-javor' as WizardChoices['targetTreeId'], scope: 'c', swapped: false,
        source: SOURCE, targetName: 'Javorovi', targetFingerprint: 'fp-target', planId: 'mp-test', createdAt: '2026-05-04T10:00:00.000Z',
        ...over,
    };
}

function pairOf(seed: number): { rnd: () => number; target: StromData; source: StromData; state: MergeState } {
    const rnd = mulberry32(seed);
    const target = targetTree(rnd);
    const source = sourceTree(target, rnd);
    return { rnd, target, source, state: createMergeState(target, source) };
}

const named = (data: StromData): Person[] => Object.values(data.persons).filter(p => !p.isPlaceholder);
const detail = (p: Person | undefined, field: string): unknown => (p as unknown as Record<string, unknown> | undefined)?.[field] ?? '';

/** Where a source person ends, by the rules buildPlan states (worked out here on its own). */
function expectedFate(state: MergeState, w: WizardChoices, id: PersonId): PersonFate {
    if (w.mode === 'new') return w.leftOut?.includes(id) ? 'skipped' : 'added';
    const decision = state.decisions.get(id);
    if (decision?.type === 'skip') return 'skipped';
    const at = existingTargetOf(state, id);
    if (at && state.existingData.persons[at]) return 'joined';
    const match = state.matches.find(m => m.incomingId === id);
    if (match && !decision && match.score < AUTO_CONFIRM_SCORE) return 'pending';
    if (w.scope === 'd') return 'skipped';
    return w.leftOut?.includes(id) ? 'skipped' : 'added';
}

/** The counts add up and every source person has the fate the rules give it. */
function checkPlan(plan: MergePlan, state: MergeState, w: WizardChoices): string[] {
    const errors: string[] = [];
    const c = planCounts(plan);
    const persons = named(state.incomingData);
    if (c.total !== persons.length) errors.push(`total ${c.total}, source has ${persons.length}`);
    if (c.joined + c.added + c.skipped + c.pending !== c.total) errors.push(`sum ${JSON.stringify(c)}`);
    const fates = planFates(plan);
    if (fates.size !== persons.length) errors.push(`${fates.size} fates for ${persons.length} persons`);
    const tally: Record<PersonFate, number> = { joined: 0, added: 0, skipped: 0, pending: 0 };
    for (const p of persons) {
        const want = expectedFate(state, w, p.id);
        const got = fates.get(p.id);
        if (got) tally[got]++;
        if (got !== want) errors.push(`${p.id}: ${got}, expected ${want}`);
    }
    if (tally.joined !== c.joined || tally.added !== c.added || tally.skipped !== c.skipped || tally.pending !== c.pending) {
        errors.push(`fates ${JSON.stringify(tally)} vs counts ${JSON.stringify(c)}`);
    }
    return errors;
}

/** One random step of the guide: a pair decided, a decision taken back, the scope changed, a person left out or back in. */
function randomStep(state: MergeState, w: WizardChoices, rnd: () => number): WizardChoices {
    const pick = <T>(list: readonly T[]): T | undefined => list.length ? list[Math.floor(rnd() * list.length)] : undefined;
    const treeIds = Object.keys(state.existingData.persons) as PersonId[];
    const r = rnd();
    if (r < 0.45) {
        const m = pick(state.matches);
        if (m) {
            const t = rnd();
            if (t < 0.3) state.decisions.set(m.incomingId, { type: 'confirm' });
            else if (t < 0.55) state.decisions.set(m.incomingId, { type: 'reject' });
            else if (t < 0.8) state.decisions.set(m.incomingId, { type: 'skip' });
            else state.decisions.set(m.incomingId, { type: 'manual_match', targetId: pick(treeIds)! });
        }
    } else if (r < 0.6) {
        const id = pick(state.unmatchedIncoming);
        if (id) state.decisions.set(id, rnd() < 0.5 ? { type: 'skip' } : { type: 'manual_match', targetId: pick(treeIds)! });
    } else if (r < 0.7) {
        const id = pick([...state.decisions.keys()]);
        if (id) state.decisions.delete(id);
    } else if (r < 0.85) {
        return { ...w, scope: pick(SCOPES)! };
    } else {
        const id = pick(named(state.incomingData))?.id;
        if (id) {
            const left = new Set(w.leftOut ?? []);
            if (left.has(id)) left.delete(id); else left.add(id);
            return { ...w, leftOut: [...left] };
        }
    }
    return w;
}

beforeAll(() => {
    vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
});

describe(`planCounts on random pairs of invented trees (${RUNS} seeds)`, () => {
    it('joined + added + skipped + pending = total after every choice of the guide', () => {
        const failures: string[] = [];
        for (let seed = 1; seed <= RUNS; seed++) {
            const { rnd, state } = pairOf(seed);
            let w = choices({ scope: SCOPES[seed % 4] });
            const steps = 8;
            for (let step = 0; step <= steps; step++) {
                if (step > 0) w = randomStep(state, w, rnd);
                const errors = checkPlan(buildPlan(state, w), state, w);
                if (errors.length) { failures.push(`seed ${seed} step ${step} scope ${w.scope}: ${errors.slice(0, 4).join('; ')}`); break; }
            }
            // A new tree from the same source: everybody added (but who is left out), nothing joined or pending.
            const wNew = choices({ mode: 'new', targetTreeId: null, leftOut: w.leftOut });
            const errors = checkPlan(buildPlan(state, wNew), state, wNew);
            if (errors.length) failures.push(`seed ${seed} new tree: ${errors.slice(0, 4).join('; ')}`);
        }
        expect(failures).toEqual([]);
    }, 60_000);
});

/** The tree's parent links, as "child<parent". */
const links = (data: StromData): string[] => Object.values(data.persons).flatMap(p => p.parentIds.map(par => `${p.id}<${par}`));

async function applyOne(seed: number): Promise<string[]> {
    const { rnd, target, source, state } = pairOf(seed);
    randomDecisions(state, rnd);
    delete state.updateOnly;
    const scope = SCOPES[seed % 4];
    const w = choices({ scope, rules: scope === 'c' && rnd() < 0.5 ? { all: 'import' } : undefined });
    const plan = buildPlan(state, w);
    const counts = planCounts(plan);
    const targetBefore = JSON.stringify(target);
    const sourceBefore = JSON.stringify(source);
    const result = await applyPlan(plan, target, source);
    if (!result.ok) return [`not saved: ${JSON.stringify(result.issues)}`];
    const errors: string[] = [];
    if (result.issues.length) errors.push(`issues ${JSON.stringify(result.issues)}`);
    if (JSON.stringify(target) !== targetBefore) errors.push('target changed in place');
    if (JSON.stringify(source) !== sourceBefore) errors.push('source changed in place');
    const after = result.data;
    // Nothing of the tree is lost.
    for (const id of Object.keys(target.persons)) if (!after.persons[id as PersonId]) errors.push(`tree person ${id} gone`);
    for (const id of Object.keys(target.partnerships)) if (!after.partnerships[id as PartnershipId]) errors.push(`tree couple ${id} gone`);
    const afterLinks = new Set(links(after));
    for (const l of links(target)) if (!afterLinks.has(l)) errors.push(`tree link ${l} gone`);
    // Every source person where the plan says, pending ones included (not in the tree).
    const at = (id: PersonId): PersonId | undefined => {
        const to = result.trace?.persons.get(id);
        return to && after.persons[to] ? to : undefined;
    };
    for (const [id, fate] of planFates(plan)) {
        const to = at(id);
        if ((fate === 'joined' || fate === 'added') && !to) errors.push(`${fate} ${id} not in the result`);
        if ((fate === 'skipped' || fate === 'pending') && to) errors.push(`${fate} ${id} in the result as ${to}`);
        if (fate === 'pending') {
            const m = state.matches.find(x => x.incomingId === id);
            if (!m || m.score >= AUTO_CONFIRM_SCORE || state.decisions.has(id)) errors.push(`pending ${id} is not an undecided pair below the threshold`);
        }
        if (fate === 'joined' && to && target.persons[to] === undefined) errors.push(`joined ${id} → ${to} not a tree person`);
    }
    const addedNamed = named(after).filter(p => !target.persons[p.id]).length;
    if (addedNamed !== counts.added) errors.push(`added ${addedNamed}, plan says ${counts.added}`);
    if (result.record.joined.length !== counts.joined) errors.push(`record joined ${result.record.joined.length}, plan ${counts.joined}`);
    // The joined persons' details by the scope.
    const joinedTargets = new Set(result.record.joined.map(([treeId]) => treeId));
    for (const id of joinedTargets) {
        for (const field of FIELDS) {
            const was = detail(target.persons[id], field);
            const now = detail(after.persons[id], field);
            if (scope === 'a' && now !== was) errors.push(`scope a changed ${id}.${field}: ${String(was)} → ${String(now)}`);
            if (scope === 'b' && was !== '' && now !== was) errors.push(`scope b overwrote ${id}.${field}: ${String(was)} → ${String(now)}`);
        }
    }
    if (scope === 'a' && result.record.fields.length) errors.push(`scope a record fields ${result.record.fields.length}`);
    if (scope === 'd') {
        const added = Object.keys(after.persons).filter(id => !target.persons[id as PersonId]);
        if (added.length) errors.push(`scope d added ${added.join(', ')}`);
        if (counts.added) errors.push(`scope d plan adds ${counts.added}`);
    }
    return errors;
}

describe(`applyPlan on random pairs of invented trees (${RUNS} seeds)`, () => {
    it('writes what the plan says, scope by scope, and loses nothing', async () => {
        const failures: string[] = [];
        for (let seed = 1; seed <= RUNS; seed++) {
            const errors = await applyOne(seed);
            if (errors.length) failures.push(`seed ${seed} scope ${SCOPES[seed % 4]}: ${errors.slice(0, 5).join('; ')}`);
        }
        expect(failures).toEqual([]);
    }, 120_000);

    it('a new tree takes the whole source as it is', async () => {
        const { source } = pairOf(7);
        const state = createMergeState({ persons: {}, partnerships: {} }, source);
        const plan = buildPlan(state, choices({ mode: 'new', targetTreeId: null }));
        const c = planCounts(plan);
        expect(c.added).toBe(named(source).length);
        expect(c.joined + c.pending + c.skipped).toBe(0);
        const result = await applyPlan(plan, { persons: {}, partnerships: {} }, source);
        expect(result.ok).toBe(true);
        expect(Object.keys(result.data.persons).sort()).toEqual(Object.keys(source.persons).sort());
    });
});

describe('edge sources', () => {
    it('an empty source: nothing to count, the tree stays as it is', async () => {
        const { target } = pairOf(3);
        const empty: StromData = { persons: {}, partnerships: {} };
        const state = createMergeState(target, empty);
        for (const scope of SCOPES) {
            const plan = buildPlan(state, choices({ scope }));
            expect(planCounts(plan)).toMatchObject({ joined: 0, added: 0, skipped: 0, pending: 0, total: 0, fieldChanges: 0 });
            const result = await applyPlan(plan, target, empty);
            expect(result.ok).toBe(true);
            expect(Object.keys(result.data.persons).sort()).toEqual(Object.keys(target.persons).sort());
            expect(Object.keys(result.data.partnerships).sort()).toEqual(Object.keys(target.partnerships).sort());
        }
    });

    it('a copy of the tree: every person joined, nobody new, nothing pending', async () => {
        for (let seed = 1; seed <= 20; seed++) {
            const { target } = pairOf(seed);
            const copy = structuredClone(target);
            const state = createMergeState(target, copy);
            const plan = buildPlan(state, choices({ scope: 'b' }));
            const c = planCounts(plan);
            expect({ seed, added: c.added, pending: c.pending, skipped: c.skipped, joined: c.joined })
                .toEqual({ seed, added: 0, pending: 0, skipped: 0, joined: named(target).length });
            expect(c.fieldChanges).toBe(0);
            const result = await applyPlan(plan, target, copy);
            expect(result.ok).toBe(true);
            expect(Object.keys(result.data.persons).length).toBe(Object.keys(target.persons).length);
        }
    });
});

describe('planFingerprint', () => {
    it('is the same whatever the order of the items and their keys, and not by id or time', () => {
        const { rnd, state } = pairOf(11);
        randomDecisions(state, rnd);
        const plan = buildPlan(state, choices({ scope: 'c' }));
        expect(plan.items.length).toBeGreaterThan(3);
        const shuffled: MergePlan = {
            ...plan,
            id: 'mp-other',
            createdAt: '2026-06-01T08:00:00.000Z',
            items: [...plan.items].reverse().map(i => Object.fromEntries(Object.entries(i).reverse()) as typeof i),
        };
        expect(planFingerprint(shuffled)).toBe(planFingerprint(plan));
        expect(planFingerprint(buildPlan(state, choices({ scope: 'c', planId: 'mp-again', createdAt: '2026-07-01T09:00:00.000Z' }))))
            .toBe(planFingerprint(plan));
    });

    it('changes with what the plan does', () => {
        const { state } = pairOf(12);
        const plan = buildPlan(state, choices({ scope: 'c' }));
        expect(planFingerprint({ ...plan, scope: 'b' })).not.toBe(planFingerprint(plan));
        expect(planFingerprint({ ...plan, items: plan.items.slice(1) })).not.toBe(planFingerprint(plan));
        expect(planFingerprint({ ...plan, target: { ...plan.target, fingerprint: 'other' } })).not.toBe(planFingerprint(plan));
    });
});

/** A small invented tree builder for the hand-made cases. */
function tree(): { data: StromData; person: (id: string, first: string, last: string, o?: Partial<Person>) => Person; couple: (a: Person, b: Person, kids?: Person[]) => void } {
    const data: StromData = { persons: {}, partnerships: {} };
    const person = (id: string, first: string, last: string, o: Partial<Person> = {}): Person => {
        const p: Person = {
            id: id as PersonId, firstName: first, lastName: last, gender: 'male', isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], ...o,
        };
        data.persons[p.id] = p;
        return p;
    };
    const couple = (a: Person, b: Person, kids: Person[] = []): void => {
        const u: Partnership = { id: `u-${a.id}-${b.id}` as PartnershipId, person1Id: a.id, person2Id: b.id, childIds: kids.map(k => k.id), status: 'married' };
        data.partnerships[u.id] = u;
        a.partnerships.push(u.id);
        b.partnerships.push(u.id);
        for (const k of kids) {
            k.parentIds.push(a.id, b.id);
            a.childIds.push(k.id);
            b.childIds.push(k.id);
        }
    };
    return { data, person, couple };
}

describe('scopeExample', () => {
    it('says the scopes on a person both trees know with a documented birth', () => {
        const t = tree();
        const tHer = t.person('t2', 'Dobroslava', 'Javorová', { gender: 'female', birthDate: '1852' });
        t.couple(t.person('t1', 'Velemír', 'Javor', { birthDate: '1850-03-12', birthPlace: 'Lipová' }), tHer);
        const s = tree();
        const sHim = s.person('s1', 'Velemír', 'Javor', { birthDate: '1850-03-12', birthPlace: 'Lipová', deathDate: '1911' });
        s.couple(sHim, s.person('s2', 'Dobroslava', 'Javorová', { gender: 'female', birthDate: '1852' }),
            [s.person('s3', 'Kojata', 'Javor', { birthDate: '1878' })]);
        const ex = scopeExample(s.data, t.data);
        expect(ex).not.toBeNull();
        expect(ex!.person).toBe('Velemír Javor');
        expect(ex!.a).toContain('Kojata Javor');
        expect(ex!.d).toContain('Kojata Javor');
        // The detail the tree lacks (the death) fills in b), one the tree has stays.
        expect(ex!.b).toContain('1911');
        expect(ex!.b).toContain('Velemír');
    });

    it('is null without a sure pair: another name, or the same name with no birth to go by', () => {
        const t = tree();
        t.person('t1', 'Velemír', 'Javor');
        const s = tree();
        s.person('s1', 'Velemír', 'Javor');
        expect(scopeExample(s.data, t.data)).toBeNull();
        const other = tree();
        other.person('s1', 'Hostivít', 'Habr', { birthDate: '1850' });
        expect(scopeExample(other.data, t.data)).toBeNull();
        expect(scopeExample({ persons: {}, partnerships: {} }, t.data)).toBeNull();
    });
});

describe('isRepeatOf', () => {
    const record = (id: string, at: string, source: Partial<PlanSource>, state: MergeRecord['state'] = 'valid'): MergeRecord => ({
        id, at, source: { ...SOURCE, ...source }, target: { name: 'Javorovi', newTree: false },
        counts: { joined: 0, added: 0, skipped: 0, pending: 0, total: 0, fieldChanges: 0, differencesKept: 0, partnerships: 0, links: 0 },
        state, added: [], joined: [], fields: [], partnerships: [], sources: [], places: [], media: [],
    });

    it('finds the latest merge of the same source by its import id or fingerprint, not an undone one', () => {
        const merges = [
            record('m1', '2026-03-01T10:00:00.000Z', { importId: 'imp-habr' }),
            record('m2', '2026-04-01T10:00:00.000Z', { importId: 'imp-habr' }),
            record('m3', '2026-05-01T10:00:00.000Z', { importId: 'imp-habr' }, 'undone'),
            record('m4', '2026-02-01T10:00:00.000Z', { fingerprint: 'sha-dubova' }),
        ];
        expect(isRepeatOf({ ...SOURCE, importId: 'imp-habr' }, merges)?.id).toBe('m2');
        expect(isRepeatOf({ ...SOURCE, fingerprint: 'sha-dubova' }, merges)?.id).toBe('m4');
        expect(isRepeatOf({ ...SOURCE, importId: 'imp-other', fingerprint: 'sha-dubova' }, merges)?.id).toBe('m4');
    });

    it('is null for a source merged never, without ids, or with no merges at all', () => {
        const merges = [record('m1', '2026-03-01T10:00:00.000Z', { importId: 'imp-habr' })];
        expect(isRepeatOf({ ...SOURCE, importId: 'imp-javor' }, merges)).toBeNull();
        expect(isRepeatOf(SOURCE, merges)).toBeNull();
        expect(isRepeatOf({ ...SOURCE, importId: 'imp-habr' }, undefined)).toBeNull();
        expect(isRepeatOf({ ...SOURCE, importId: 'imp-habr' }, [record('m1', '2026-03-01T10:00:00.000Z', { importId: 'imp-habr' }, 'undone')])).toBeNull();
    });
});
