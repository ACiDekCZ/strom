/**
 * The merge plan (spec 134 §0.2, §1 tests): the counts add up after every
 * choice of the guide, the write does only what the plan says (scope a) does
 * not touch joined persons, b) only fills gaps, d) adds nobody), nothing of
 * either tree is lost, an undecided pair below the threshold is still to
 * decide; the plan's fingerprint, the scope's example and a repeated source.
 * Invented trees only (helpers/merge-trees.ts), deterministic seeds.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { AUTO_CONFIRM_SCORE, existingTargetOf } from '../merge/executor.js';
import { createMergeState } from '../merge/matching.js';
import {
    applyPlan, bringsNothingNew, buildPlan, isRepeatOf, planCounts, planFates, planFingerprint, scopeExample, verifyResult,
    GroupDecision, MergePlan, MergeRecord, NewRel, PersonFate, PlanScope, PlanSource, WizardChoices,
    FIELD_KINDS, PlanRules, RelChoice, RuleChoice, mergeDifferences, relationConflicts, ruleCounts,
} from '../merge/plan.js';
import { newPersons, unlinkedGroups } from '../merge/plan-select.js';
import { MergeState } from '../merge/types.js';
import { StorageManager } from '../storage.js';
import { Partnership, PartnershipId, Person, PersonId, StromData } from '../types.js';
import { dangling, mulberry32, randomDecisions, sourceTree, targetTree } from './helpers/merge-trees.js';

const RUNS = 200;
const SCOPES: readonly PlanScope[] = ['a', 'b', 'c', 'd'];
/** The details of a person the plan names (plan.ts PERSON_FIELDS). */
const FIELDS = ['firstName', 'lastName', 'marriedSurname', 'titleBefore', 'titleAfter', 'gender', 'birthDate', 'birthPlace',
    'birthAddress', 'birthAge', 'deathDate', 'deathPlace', 'deathAddress', 'deathAge', 'deathCause', 'notes', 'photo'] as const;

const SOURCE: PlanSource = { kind: 'ged', label: 'rodokmen-Jilmovi.ged', persons: 0 };

function choices(over: Partial<WizardChoices> = {}): WizardChoices {
    return {
        mode: 'add', targetTreeId: 'tree-modřín' as WizardChoices['targetTreeId'], scope: 'c', swapped: false,
        source: SOURCE, targetName: 'Modřínovi', targetFingerprint: 'fp-target', planId: 'mp-test', createdAt: '2026-05-04T10:00:00.000Z',
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

/**
 * Random choices of step 3 (§5, §6): unticked people, people kept as "?",
 * the living left out, and a decision for each unlinked group (some left
 * undecided): add unlinked, a separate tree, do not add, or a link to a
 * person of the tree or of the import.
 */
function randomStep3(state: MergeState, rnd: () => number, scope: PlanScope): WizardChoices {
    const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
    const base = choices({ scope, groups: {} });
    const fresh = newPersons(state, base);
    const leftOut = fresh.filter(() => rnd() < 0.12);
    const out = new Set(leftOut);
    const placeholders = fresh.filter(id => !out.has(id) && rnd() < 0.08);
    const w: WizardChoices = { ...base, leftOut, placeholders, skipLiving: rnd() < 0.3 };
    if (rnd() < 0.2) w.splitGroups = ['all'];
    const treeIds = Object.keys(state.existingData.persons) as PersonId[];
    const importIds = named(state.incomingData).map(p => p.id);
    const rels: readonly NewRel[] = ['parent', 'child', 'partner'];
    const decisions: Record<string, GroupDecision> = {};
    for (const g of unlinkedGroups(state, w)) {
        const r = rnd();
        if (r < 0.15) continue;
        if (r < 0.35) decisions[g.key] = { kind: 'loose' };
        else if (r < 0.5) decisions[g.key] = { kind: 'own-tree' };
        else if (r < 0.65) decisions[g.key] = { kind: 'skip' };
        else {
            const inTree = rnd() < 0.6 && treeIds.length > 0;
            decisions[g.key] = { kind: 'connect', person: pick(g.persons), rel: pick(rels), to: pick(inTree ? treeIds : importIds), in: inTree ? 'tree' : 'import' };
        }
    }
    return { ...w, groups: decisions };
}

async function applyStep3(seed: number): Promise<string[]> {
    const { rnd, target, source, state } = pairOf(seed);
    randomDecisions(state, rnd);
    delete state.updateOnly;
    const w = randomStep3(state, rnd, (['a', 'b', 'c'] as const)[seed % 3]);
    const plan = buildPlan(state, w);
    const errors: string[] = [];
    const c = planCounts(plan);
    const persons = named(source);
    if (c.total !== persons.length) errors.push(`total ${c.total}, source has ${persons.length}`);
    if (c.joined + c.added + c.skipped + c.pending !== c.total) errors.push(`sum ${JSON.stringify(c)}`);
    const fates = planFates(plan);
    if (fates.size !== persons.length) errors.push(`${fates.size} fates for ${persons.length} persons`);
    for (const g of plan.groups ?? []) {
        for (const id of g.persons) {
            const fate = fates.get(id);
            const want = g.decision === null ? 'pending' : g.decision.kind === 'skip' ? 'skipped' : 'added';
            if (fate !== want) errors.push(`group ${g.key} (${g.decision?.kind ?? 'undecided'}): ${id} ${fate}`);
        }
    }
    for (const id of w.leftOut ?? []) if (fates.get(id) !== 'skipped') errors.push(`unticked ${id} ${fates.get(id)}`);
    for (const id of w.placeholders ?? []) if (fates.get(id) !== 'skipped') errors.push(`"?" ${id} ${fates.get(id)}`);
    if (errors.length) return errors;

    const targetBefore = JSON.stringify(target);
    const sourceBefore = JSON.stringify(source);
    const result = await applyPlan(plan, target, source);
    if (!result.ok) return [`not saved: ${JSON.stringify(result.issues).slice(0, 300)}`];
    if (result.issues.length) errors.push(`issues ${JSON.stringify(result.issues)}`);
    const again = verifyResult(plan, target, source, result.data, result.trace);
    if (again.length) errors.push(`verify ${JSON.stringify(again)}`);
    if (JSON.stringify(target) !== targetBefore) errors.push('target changed in place');
    if (JSON.stringify(source) !== sourceBefore) errors.push('source changed in place');
    const after = result.data;
    for (const id of Object.keys(target.persons)) if (!after.persons[id as PersonId]) errors.push(`tree person ${id} gone`);
    for (const id of Object.keys(target.partnerships)) if (!after.partnerships[id as PartnershipId]) errors.push(`tree couple ${id} gone`);
    const afterLinks = new Set(links(after));
    for (const l of links(target)) if (!afterLinks.has(l)) errors.push(`tree link ${l} gone`);
    const gone = dangling(after);
    if (gone.length) errors.push(`dangling ${gone.slice(0, 3).join(', ')}`);
    // The added: in the tree, or in a tree of their own.
    const own = (plan.groups ?? []).filter(g => g.decision?.kind === 'own-tree');
    const ownCount = own.reduce((n, g) => n + g.persons.length, 0);
    const addedNamed = named(after).filter(p => !target.persons[p.id]).length;
    if (addedNamed + ownCount !== c.added) errors.push(`added ${addedNamed} + own trees ${ownCount}, plan says ${c.added}`);
    if (result.ownTrees.length !== own.length) errors.push(`own trees ${result.ownTrees.length}, groups ${own.length}`);
    for (const t of result.ownTrees) {
        const n = named(t.data).length;
        if (n !== t.persons.length) errors.push(`own tree ${t.group}: ${n} persons, group has ${t.persons.length}`);
        const loose = dangling(t.data);
        if (loose.length) errors.push(`own tree ${t.group} dangling ${loose.slice(0, 3).join(', ')}`);
    }
    return errors;
}

describe(`step 3 on random pairs of invented trees (${RUNS} seeds)`, () => {
    beforeAll(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-05-04T10:00:00Z'));
    });
    afterAll(() => { vi.useRealTimers(); });

    it('unticked, "?", living and group decisions: the sums stay whole, the write is what the plan says, nothing of the tree is lost', async () => {
        const failures: string[] = [];
        for (let seed = 1; seed <= RUNS; seed++) {
            const errors = await applyStep3(seed);
            if (errors.length) failures.push(`seed ${seed}: ${errors.slice(0, 4).join('; ')}`);
        }
        expect(failures.join('\n')).toBe('');
    }, 120_000);
});

/** Random rules of step 4 (K5.1): a whole-merge rule, some kinds, persons and values of their own. */
function randomRules(state: MergeState, rnd: () => number): PlanRules {
    const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
    const choicesAll: readonly RuleChoice[] = ['mine', 'import', 'both', 'precise', 'each'];
    const rules: PlanRules = { all: pick(choicesAll) };
    for (const k of FIELD_KINDS) if (rnd() < 0.25) (rules.kind ??= {})[k] = pick(choicesAll);
    for (const d of mergeDifferences(state)) {
        if (rnd() < 0.1) (rules.person ??= {})[d.person] = pick(choicesAll);
        if (rnd() < 0.15) (rules.value ??= {})[`${d.person}|${d.field}`] = pick(['mine', 'import', 'both'] as const);
    }
    return rules;
}

/**
 * Random rules and choices of relations on a random pair (§7): the sums stay
 * whole, the check before saving finds nothing, and of the tree only what a
 * choice "From the import" replaces is gone.
 */
async function applyRules(seed: number): Promise<string[]> {
    const { rnd, target, source, state } = pairOf(seed);
    randomDecisions(state, rnd);
    delete state.updateOnly;
    const scope = SCOPES[seed % 4];
    const rules = randomRules(state, rnd);
    const first = buildPlan(state, choices({ scope, rules }));
    const relations: Record<string, RelChoice> = {};
    for (const i of first.items) {
        if (i.kind !== 'relation' || i.rel === 'loop') continue;
        const options: readonly RelChoice[] = i.rel === 'partner' || i.rel === 'marriage' ? ['mine', 'import', 'both'] : ['mine', 'import'];
        if (rnd() < 0.7) relations[i.key] = options[Math.floor(rnd() * options.length)];
    }
    const w = choices({ scope, rules, relations });
    const plan = buildPlan(state, w);
    const errors = checkPlan(plan, state, w);
    if (errors.length) return errors;
    for (const i of plan.items) {
        if (i.kind === 'relation' && i.rel !== 'loop' && relations[i.key] && i.choice !== relations[i.key]) errors.push(`relation ${i.key}: ${i.choice}, chosen ${relations[i.key]}`);
        if (i.kind === 'relation' && i.rel === 'loop' && i.choice !== 'mine') errors.push(`loop ${i.key} ${i.choice}`);
        if (i.kind === 'field' && i.on && i.protected && i.rule.level !== 'value') errors.push(`protected ${i.person}.${i.field} overwritten by ${i.rule.level}`);
    }
    const loops = new Set(plan.items.flatMap(i => i.kind === 'relation' && i.rel === 'loop' ? [i.key.slice('loop|'.length)] : []));
    for (const i of plan.items) if (i.kind === 'link-add' && loops.has(i.id)) errors.push(`loop link ${i.id} in the plan`);
    // The tiles' counts are the plan's: the current rule's changes, values alongside and kept values of persons.
    if (scope === 'c' || scope === 'd') {
        const rc = ruleCounts(state, rules);
        const personDiffs = rc.differences - rc.byKind.marriage.differences;
        const items = plan.items.filter(i => (i.kind === 'field' && i.before !== '' && i.after !== i.before && i.field !== 'notes') || i.kind === 'field-both');
        if (items.length !== personDiffs) errors.push(`differences ${items.length}, ruleCounts ${personDiffs}`);
    }
    if (errors.length) return errors;

    const result = await applyPlan(plan, target, source);
    if (!result.ok) return [`not saved: ${JSON.stringify(result.issues).slice(0, 300)}`];
    const again = verifyResult(plan, target, source, result.data, result.trace);
    if (again.length) errors.push(`verify ${JSON.stringify(again)}`);
    const after = result.data;
    const droppedUnions = new Set(plan.items.flatMap(i => i.kind === 'partnership-drop' ? [i.id] : []));
    const droppedLinks = new Set(plan.items.flatMap(i => i.kind === 'link-drop' ? [`${i.child}<${i.parent}`] : []));
    for (const id of Object.keys(target.persons)) if (!after.persons[id as PersonId]) errors.push(`tree person ${id} gone`);
    for (const id of Object.keys(target.partnerships)) {
        const gone = !after.partnerships[id as PartnershipId];
        if (gone !== droppedUnions.has(id as PartnershipId)) errors.push(`tree couple ${id} ${gone ? 'gone' : 'kept though replaced'}`);
    }
    const afterLinks = new Set(links(after));
    for (const l of links(target)) {
        if (!afterLinks.has(l) && !droppedLinks.has(l)) errors.push(`tree link ${l} gone`);
        if (afterLinks.has(l) && droppedLinks.has(l)) errors.push(`tree link ${l} kept though replaced`);
    }
    const gone = dangling(after);
    if (gone.length) errors.push(`dangling ${gone.slice(0, 3).join(', ')}`);
    // "Keep both" and a kept value never overwrite the tree's.
    for (const i of plan.items) {
        const was = detail(target.persons[i.kind === 'field' || i.kind === 'field-both' ? i.person : ('' as PersonId)], i.kind === 'field' || i.kind === 'field-both' ? i.field : '');
        if (i.kind === 'field-both' && detail(after.persons[i.person], i.field) !== was) errors.push(`both overwrote ${i.person}.${i.field}`);
        if (i.kind === 'field' && !i.on && i.before !== '' && i.field !== 'notes' && detail(after.persons[i.person], i.field) !== was) errors.push(`kept ${i.person}.${i.field} overwritten`);
    }
    return errors;
}

describe(`rules and conflicts of relations on random pairs of invented trees (${RUNS} seeds)`, () => {
    it('random rules and choices: the sums stay whole, the check passes, of the tree only what a choice replaces is gone', async () => {
        const failures: string[] = [];
        let relationsSeen = 0;
        for (let seed = 1; seed <= RUNS; seed++) {
            const errors = await applyRules(seed);
            if (errors.length) failures.push(`seed ${seed} scope ${SCOPES[seed % 4]}: ${errors.slice(0, 4).join('; ')}`);
            const { state } = pairOf(seed);
            relationsSeen += relationConflicts(state).length;
        }
        expect(failures.join('\n')).toBe('');
        expect(relationsSeen).toBeGreaterThan(0);
    }, 120_000);
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
        const tHer = t.person('t2', 'Dobroslava', 'Modřínová', { gender: 'female', birthDate: '1852' });
        t.couple(t.person('t1', 'Velemír', 'Modřín', { birthDate: '1850-03-12', birthPlace: 'Lipová' }), tHer);
        const s = tree();
        const sHim = s.person('s1', 'Velemír', 'Modřín', { birthDate: '1850-03-12', birthPlace: 'Lipová', deathDate: '1911' });
        s.couple(sHim, s.person('s2', 'Dobroslava', 'Modřínová', { gender: 'female', birthDate: '1852' }),
            [s.person('s3', 'Kojata', 'Modřín', { birthDate: '1878' })]);
        const ex = scopeExample(s.data, t.data);
        expect(ex).not.toBeNull();
        expect(ex!.person).toBe('Velemír Modřín');
        expect(ex!.a).toContain('Kojata Modřín');
        expect(ex!.d).toContain('Kojata Modřín');
        // The detail the tree lacks (the death) fills in b), one the tree has stays.
        expect(ex!.b).toContain('1911');
        expect(ex!.b).toContain('Velemír');
    });

    it('is null without a sure pair: another name, or the same name with no birth to go by', () => {
        const t = tree();
        t.person('t1', 'Velemír', 'Modřín');
        const s = tree();
        s.person('s1', 'Velemír', 'Modřín');
        expect(scopeExample(s.data, t.data)).toBeNull();
        const other = tree();
        other.person('s1', 'Hostivít', 'Jilm', { birthDate: '1850' });
        expect(scopeExample(other.data, t.data)).toBeNull();
        expect(scopeExample({ persons: {}, partnerships: {} }, t.data)).toBeNull();
    });
});

describe('bringsNothingNew (13b)', () => {
    it('a copy of the tree brings nothing new; a file with new people does', () => {
        const { target, state } = pairOf(7);
        const copy = createMergeState(target, structuredClone(target));
        const counts = planCounts(buildPlan(copy, choices({ scope: 'a' })));
        expect(counts.joined).toBe(counts.total);
        expect(bringsNothingNew(counts)).toBe(true);
        expect(bringsNothingNew(planCounts(buildPlan(state, choices({ scope: 'a' }))))).toBe(false);
        expect(bringsNothingNew({ ...counts, fieldChanges: 1 })).toBe(false);
        expect(bringsNothingNew({ ...counts, total: 0, joined: 0 })).toBe(false);
    });
});

describe('applyPlan: a new child of a couple both trees know', () => {
    it('hangs under that couple in every scope, the couple left as it is in a)', async () => {
        const t = tree();
        const tHer = t.person('t2', 'Dobroslava', 'Modřínová', { gender: 'female', birthDate: '1852-05-05' });
        t.couple(t.person('t1', 'Velemír', 'Modřín', { birthDate: '1850-03-12' }), tHer, [t.person('t3', 'Kojata', 'Modřín', { birthDate: '1878-01-01' })]);
        t.data.partnerships['u-t1-t2' as PartnershipId].startDate = '1875';
        const s = tree();
        const sHer = s.person('s2', 'Dobroslava', 'Modřínová', { gender: 'female', birthDate: '1852-05-05' });
        s.couple(s.person('s1', 'Velemír', 'Modřín', { birthDate: '1850-03-12' }), sHer,
            [s.person('s3', 'Kojata', 'Modřín', { birthDate: '1878-01-01' }), s.person('s4', 'Radhost', 'Modřín', { birthDate: '1880-02-02' })]);
        s.data.partnerships['u-s1-s2' as PartnershipId].startDate = '1876';
        for (const scope of ['a', 'b', 'c'] as const) {
            const state = createMergeState(t.data, s.data);
            const plan = buildPlan(state, choices({ scope }));
            expect(planCounts(plan)).toMatchObject({ joined: 3, added: 1, pending: 0 });
            const result = await applyPlan(plan, t.data, s.data);
            expect(result.ok).toBe(true);
            const unions = Object.values(result.data.partnerships);
            expect(unions).toHaveLength(1);
            const kid = Object.values(result.data.persons).find(p => p.firstName === 'Radhost')!;
            expect({ scope, kids: [...unions[0].childIds].sort() }).toEqual({ scope, kids: ['t3', kid.id].sort() });
            expect(kid.parentIds.sort()).toEqual(['t1', 't2']);
            if (scope === 'a') expect(unions[0].startDate).toBe('1875');
        }
    });
});

describe('isRepeatOf', () => {
    const record = (id: string, at: string, source: Partial<PlanSource>, state: MergeRecord['state'] = 'valid'): MergeRecord => ({
        id, at, source: { ...SOURCE, ...source }, target: { name: 'Modřínovi', newTree: false },
        counts: { joined: 0, added: 0, skipped: 0, pending: 0, total: 0, fieldChanges: 0, differencesKept: 0, alongside: 0, partnerships: 0, links: 0 },
        state, added: [], joined: [], fields: [], partnerships: [], sources: [], places: [], media: [],
    });

    it('finds the latest merge of the same source by its import id or fingerprint, not an undone one', () => {
        const merges = [
            record('m1', '2026-03-01T10:00:00.000Z', { importId: 'imp-jilm' }),
            record('m2', '2026-04-01T10:00:00.000Z', { importId: 'imp-jilm' }),
            record('m3', '2026-05-01T10:00:00.000Z', { importId: 'imp-jilm' }, 'undone'),
            record('m4', '2026-02-01T10:00:00.000Z', { fingerprint: 'sha-dubova' }),
        ];
        expect(isRepeatOf({ ...SOURCE, importId: 'imp-jilm' }, merges)?.id).toBe('m2');
        expect(isRepeatOf({ ...SOURCE, fingerprint: 'sha-dubova' }, merges)?.id).toBe('m4');
        expect(isRepeatOf({ ...SOURCE, importId: 'imp-other', fingerprint: 'sha-dubova' }, merges)?.id).toBe('m4');
    });

    it('is null for a source merged never, without ids, or with no merges at all', () => {
        const merges = [record('m1', '2026-03-01T10:00:00.000Z', { importId: 'imp-jilm' })];
        expect(isRepeatOf({ ...SOURCE, importId: 'imp-modřín' }, merges)).toBeNull();
        expect(isRepeatOf(SOURCE, merges)).toBeNull();
        expect(isRepeatOf({ ...SOURCE, importId: 'imp-jilm' }, undefined)).toBeNull();
        expect(isRepeatOf({ ...SOURCE, importId: 'imp-jilm' }, [record('m1', '2026-03-01T10:00:00.000Z', { importId: 'imp-jilm' }, 'undone')])).toBeNull();
    });
});
