/**
 * Random pairs of invented trees merged with random decisions (spec 134
 * K0.2): nothing of either tree is lost, the counts add up and no reference
 * points at nothing. Deterministic seeds; a failure names its seed.
 *
 * Besides the check of the production code (checkMergeResult) the test checks
 * on its own: the tree's persons, couples and parent links are all there,
 * every incoming person ends where its decision says, links are mutual and
 * nothing dangles.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { executeMerge, AUTO_CONFIRM_SCORE } from '../merge/executor.js';
import { createMergeState } from '../merge/matching.js';
import { StorageManager } from '../storage.js';
import { MergeState } from '../merge/types.js';
import { PartnershipId, PersonId } from '../types.js';
import { dangling, mulberry32, randomDecisions, sourceTree, targetTree } from './helpers/merge-trees.js';

const RUNS = 200;

/** Where each incoming non-placeholder person should end, by the rules the dialog states. */
function expectedFate(state: MergeState, id: PersonId): 'merged' | 'added' | 'left' {
    const d = state.decisions.get(id);
    if (d?.type === 'skip') return 'left';
    if (d?.type === 'manual_match') return 'merged';
    const m = state.matches.find(x => x.incomingId === id);
    if (m && (d?.type === 'confirm' || (!d && m.score >= AUTO_CONFIRM_SCORE))) return 'merged';
    return state.updateOnly ? 'left' : 'added';
}

async function runOne(seed: number): Promise<string[]> {
    const rnd = mulberry32(seed);
    const existing = targetTree(rnd);
    const incoming = sourceTree(existing, rnd);
    const existingCopy = structuredClone(existing);
    const state = createMergeState(existing, incoming);
    randomDecisions(state, rnd);
    const result = await executeMerge(state);
    const errors: string[] = [];
    if (!result.success) {
        return [`merge not saved: ${JSON.stringify(result.check?.problems ?? result.errors)}`];
    }
    const merged = result.mergedData;
    // The production check passed and its tallies add up.
    if (!result.check?.ok) errors.push('check not ok');
    for (const [kind, t] of Object.entries(result.check?.tallies ?? {})) {
        if (t.merged + t.added + t.left + t.lost !== t.source || t.lost) errors.push(`tally ${kind}: ${JSON.stringify(t)}`);
    }
    // The merge did not change its inputs.
    if (JSON.stringify(existing) !== JSON.stringify(existingCopy)) errors.push('existing data changed in place');
    // Nothing of the tree is gone.
    for (const p of Object.values(existing.persons)) {
        if (!merged.persons[p.id]) errors.push(`tree person ${p.id} gone`);
        for (const parent of p.parentIds) if (!merged.persons[p.id]?.parentIds.includes(parent)) errors.push(`tree link ${p.id}←${parent} gone`);
    }
    for (const id of Object.keys(existing.partnerships)) if (!merged.partnerships[id as PartnershipId]) errors.push(`tree couple ${id} gone`);
    for (const [id, src] of Object.entries(existing.sources ?? {})) {
        if (!merged.sources?.[id]) errors.push(`tree source ${id} gone`);
        else if (merged.sources[id].title !== src.title) errors.push(`tree source ${id} replaced`);
    }
    // Every incoming source is in the result (as its own entry or joined to one of the same title).
    const mergedTitles = new Set(Object.values(merged.sources ?? {}).map(x => x.title));
    for (const src of Object.values(incoming.sources ?? {})) if (!mergedTitles.has(src.title)) errors.push(`incoming source ${src.id} lost`);
    // A person new to the tree cites sources by their titles in the import.
    for (const p of Object.values(incoming.persons)) {
        const to = result.trace?.persons.get(p.id);
        if (!to || existing.persons[to] || !merged.persons[to]) continue;
        const want = (p.sourceIds ?? []).map(id => incoming.sources?.[id]?.title).sort();
        const got = (merged.persons[to].sourceIds ?? []).map(id => merged.sources?.[id]?.title).sort();
        if (JSON.stringify(want) !== JSON.stringify(got)) errors.push(`added ${p.id} cites ${JSON.stringify(got)}, import ${JSON.stringify(want)}`);
    }
    for (const id of Object.keys(existing.media ?? {})) if (!merged.media?.[id]) errors.push(`tree file ${id} gone`);
    // Every incoming person where its decision says.
    let expectedAdded = 0;
    for (const p of Object.values(incoming.persons)) {
        if (p.isPlaceholder) continue;
        const fate = expectedFate(state, p.id);
        if (fate === 'added') expectedAdded++;
        if (fate === 'merged') {
            const d = state.decisions.get(p.id);
            const target = d?.type === 'manual_match' ? d.targetId : state.matches.find(m => m.incomingId === p.id)!.existingId;
            if (!merged.persons[target]) errors.push(`merged person ${p.id} → ${target} missing`);
        }
    }
    // Every incoming parent link between two persons that came along is there,
    // unless the child has two other parents or the link would close a circle;
    // every incoming file at a person that came along is at that person.
    const placed = (id: PersonId): PersonId | undefined => {
        const to = result.trace?.persons.get(id);
        return to && merged.persons[to] ? to : undefined;
    };
    const above = (from: PersonId, target: PersonId): boolean => {
        const seen = new Set<PersonId>();
        const todo = [from];
        while (todo.length) {
            const id = todo.pop()!;
            if (id === target) return true;
            if (!seen.has(id)) { seen.add(id); todo.push(...(merged.persons[id]?.parentIds ?? [])); }
        }
        return false;
    };
    for (const p of Object.values(incoming.persons)) {
        const c = placed(p.id);
        if (!c) continue;
        for (const par of p.parentIds) {
            const to = placed(par);
            if (!to || to === c || merged.persons[c].parentIds.includes(to)) continue;
            const others = merged.persons[c].parentIds.filter(id => id !== to);
            if (others.length < 2 && !above(to, c)) errors.push(`incoming link ${p.id}←${par} (${c}←${to}) lost`);
        }
    }
    for (const att of Object.values(incoming.media ?? {})) {
        const pl = att.places[0];
        const at = 'personId' in pl ? placed(pl.personId) : undefined;
        if (!at) continue;
        const kept = Object.values(merged.media ?? {}).some(m => m.dataUrl === att.dataUrl && m.places.some(x => 'personId' in x && x.personId === at));
        if (!kept) errors.push(`incoming file ${att.id} not at ${at}`);
    }
    const newNamed = Object.values(merged.persons).filter(p => !existing.persons[p.id] && !p.isPlaceholder).length;
    if (newNamed !== expectedAdded) errors.push(`added ${newNamed} persons, expected ${expectedAdded}`);
    // Links are mutual and nothing points at nothing.
    for (const p of Object.values(merged.persons)) {
        for (const c of p.childIds) if (!merged.persons[c]?.parentIds.includes(p.id)) errors.push(`one-sided ${p.id}→${c}`);
        for (const par of p.parentIds) if (!merged.persons[par]?.childIds.includes(p.id)) errors.push(`one-sided ${p.id}←${par}`);
        for (const u of p.partnerships) {
            const pu = merged.partnerships[u];
            if (pu && pu.person1Id !== p.id && pu.person2Id !== p.id) errors.push(`couple ${u} not ${p.id}'s`);
        }
    }
    errors.push(...dangling(merged).map(d => `dangling ${d}`));
    return errors;
}

beforeAll(() => {
    vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
});

describe(`random pairs of invented trees (${RUNS} seeds)`, () => {
    it('nothing is lost, the counts add up, no reference points at nothing', async () => {
        const failures: string[] = [];
        for (let seed = 1; seed <= RUNS; seed++) {
            const errors = await runOne(seed);
            if (errors.length) failures.push(`seed ${seed}: ${errors.slice(0, 5).join('; ')}`);
        }
        expect(failures).toEqual([]);
    }, 30_000);
});
