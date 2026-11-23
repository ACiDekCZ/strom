/**
 * The same file merged again (spec 134 §13 13c, K1.5, K0.7): the second
 * merge of one GEDCOM file into the tree it went into finds the first by the
 * file's fingerprint, says how many of its people are new and how many are
 * joined with the earlier merge, and duplicates nobody (its people join the
 * ones the first merge added through their records' ids in the file).
 * The tree Modřínovi and the file of the Jilms are invented.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { createMergeState } from '../merge/matching.js';
import { applyPlan, buildPlan, importedBefore, isRepeatOf, planCounts, repeatCounts, type MergeRecord, type PlanSource, type WizardChoices } from '../merge/plan.js';
import { StorageManager } from '../storage.js';
import type { StromData } from '../types.js';

const GED = readFileSync('e2e/fixtures/rodokmen-jilmovi.ged', 'utf8');
const TREE = JSON.parse(readFileSync('e2e/fixtures/modrinovi.json', 'utf8')) as StromData;
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

beforeAll(() => { vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never); });
afterAll(() => { vi.restoreAllMocks(); });

function load(text: string, at: string): StromData {
    return convertToStrom(parseGedcom(text), { importOrigin: { at, file: 'rodokmen-jilmovi.ged', sha: SHA } }).data;
}

function source(data: StromData): PlanSource {
    return {
        kind: 'ged', label: 'rodokmen-jilmovi.ged', importId: 'I1', fingerprint: SHA,
        persons: Object.values(data.persons).filter(p => !p.isPlaceholder).length,
    };
}

function choices(src: PlanSource, at: string): WizardChoices {
    return {
        mode: 'add', targetTreeId: 'tree-modřín' as WizardChoices['targetTreeId'], scope: 'a', swapped: false,
        source: src, targetName: 'Modřínovi', planId: `mp-${at}`, createdAt: at,
    };
}

/** One merge of the file into `tree` as the guide writes it: compare, the plan as offered, the write, its record kept. */
async function mergeOnce(tree: StromData, at: string, skip: string[] = []): Promise<{ after: StromData; record: MergeRecord; counts: ReturnType<typeof planCounts> }> {
    const incoming = load(GED, at.slice(0, 10));
    const state = createMergeState(structuredClone(tree), incoming);
    const plan = buildPlan(state, choices(source(incoming), at));
    for (const item of plan.items) {
        if (item.kind !== 'person-add') continue;
        const p = incoming.persons[item.id];
        if (p && skip.includes(p.firstName)) item.on = false;
    }
    const result = await applyPlan(plan, state.existingData, incoming);
    if (!result.ok) throw new Error(JSON.stringify(result.issues).slice(0, 300));
    const after = result.data;
    after.merges = [...(after.merges ?? []), result.record];
    return { after, record: result.record, counts: planCounts(plan) };
}

const people = (data: StromData): string[] =>
    Object.values(data.persons).filter(p => !p.isPlaceholder).map(p => `${p.firstName} ${p.lastName}`).sort();

describe('the same file merged again (13c)', () => {
    it('finds the first merge, counts 0 new and 4 joined, and the second write duplicates nobody', async () => {
        const first = await mergeOnce(TREE, '2026-11-20T10:00:00.000Z');
        expect(first.counts.added).toBe(3);
        const again = load(GED, '2026-11-22');
        const before = isRepeatOf(source(again), first.after.merges);
        expect(before?.id).toBe(first.record.id);
        expect(repeatCounts(again, first.after, before!)).toEqual({ joined: 4, fresh: 0 });

        const second = await mergeOnce(first.after, '2026-11-22T10:00:00.000Z');
        expect(second.counts).toMatchObject({ added: 0, joined: 4, pending: 0 });
        expect(people(second.after)).toEqual(people(first.after));
    });

    it('people left out the first time are the new ones and come in once', async () => {
        const first = await mergeOnce(TREE, '2026-11-20T10:00:00.000Z', ['Kasián']);
        expect(people(first.after)).not.toContain('Kasián Jilm');
        const again = load(GED, '2026-11-22');
        expect(repeatCounts(again, first.after, isRepeatOf(source(again), first.after.merges)!)).toEqual({ joined: 3, fresh: 1 });

        const second = await mergeOnce(first.after, '2026-11-22T10:00:00.000Z');
        expect(second.counts).toMatchObject({ added: 1, joined: 3 });
        expect(people(second.after).filter(n => n === 'Kasián Jilm')).toHaveLength(1);
        expect(people(second.after).filter(n => n === 'Amos Jilm')).toHaveLength(1);
    });

    it('another file is not the same file, though its import id in the file is I1 too', async () => {
        const first = await mergeOnce(TREE, '2026-11-20T10:00:00.000Z');
        expect(isRepeatOf({ kind: 'ged', label: 'rodokmen-habrovi.ged', importId: 'I1', fingerprint: 'f'.repeat(64), persons: 4 }, first.after.merges)).toBeNull();
    });

    it('a tree made of the file without a merge\'s record (K0.7): its import of the same file is found, its people joined', () => {
        const made = load(GED, '2026-10-02');
        const again = load(GED, '2026-11-22');
        expect(isRepeatOf(source(again), made.merges)).toBeNull();
        expect(importedBefore(source(again), made)?.at).toBe('2026-10-02');
        expect(importedBefore({ ...source(again), fingerprint: 'f'.repeat(64) }, made)).toBeNull();
        expect(repeatCounts(again, made, null)).toEqual({ joined: 4, fresh: 0 });
    });
});
