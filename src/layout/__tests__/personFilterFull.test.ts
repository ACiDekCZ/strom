/**
 * "Hide others" (PipelineInput.personFilter, spec 098 §8): for every
 * fixture, every person as focus, the standard and expanded modes, cards of
 * one height and of their own heights, three selections laid out alone:
 *
 * - the focus's ancestors (a pure pedigree: the focus and its ancestors in
 *   depth, nobody else),
 * - the focus's family line with the spouses who married in (as the
 *   highlight's faint ones join the filter),
 * - scattered persons (every third of the view by id, a list of people):
 *   many of them without a line to anyone else.
 *
 * The strict checks of allPersonsFull.test.ts hold (valid positions, no card
 * overlap, the built-in validation, the geometry audit; bands with own
 * heights), no tolerance widened. Drawn are exactly the whole view's persons
 * of the filter and the focus; each in the row of its generation in the
 * whole view; lines only between persons drawn.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { loadFixture } from './helpers/loadFixture.js';
import { runLayoutPipeline } from '../pipeline/index.js';
import { drawnPersonIds } from '../pipeline/index.js';
import { assertNoNodeOverlap, assertValidPositions } from './helpers/assertions.js';
import { auditGeometry } from './helpers/geometryAudit.js';
import { auditBands, syntheticPersonHeights } from './helpers/bandAudit.js';
import { PersonId, LayoutConfig, DEFAULT_LAYOUT_CONFIG, StromData } from '../../types.js';
import type { LayoutResult, PipelineInput } from '../pipeline/types.js';
import { normalizeSingleParents } from '../../single-parent.js';
import { buildLineages, realRodMembers, realRodSpouses, rodOf } from '../../lineage.js';
import { selectionPersonIds } from '../../view-selection.js';

const DEPTHS = [2, 4];

const MODES = [
    { name: 'standard', heights: false, autoExpand: false },
    { name: 'expanded', heights: false, autoExpand: true },
    { name: 'standard-v3', heights: true, autoExpand: false },
];

const FIXTURES = readdirSync(join(process.cwd(), 'test'))
    .filter(n => /^(comprehensive|edge-.*|etalon-.*|real-large)\.json$/.test(n))
    .map(n => n.replace(/\.json$/, ''))
    .filter(f => existsSync(join(process.cwd(), 'test', `${f}.json`)))
    .sort();

function input(data: StromData, focus: PersonId, config: LayoutConfig, depth: number, autoExpand: boolean, descendantsOnly = false): PipelineInput {
    return {
        data, focusPersonId: focus, config, ancestorDepth: descendantsOnly ? 0 : depth, descendantDepth: depth,
        includeSpouseAncestors: false, includeParentSiblings: !descendantsOnly, includeParentSiblingDescendants: !descendantsOnly,
        displayPolicy: { mode: autoExpand ? 'expanded' as const : 'standard' as const, autoExpand, expandLineageOnly: descendantsOnly },
    };
}

/** The strict checks of the all-persons harness. */
function strict(r: LayoutResult, config: LayoutConfig, heights: boolean, where: string, failures: string[]): void {
    try { assertValidPositions(r.positions); } catch (e) { failures.push(`${where} Positions: ${(e as Error).message.split('\n')[0]}`); }
    try { assertNoNodeOverlap(r.positions, config.cardWidth, config.cardHeight); } catch (e) { failures.push(`${where} Overlap: ${(e as Error).message.split('\n')[0]}`); }
    if (!r.diagnostics.validationPassed) for (const err of r.diagnostics.errors.slice(0, 3)) failures.push(`${where} Validation: ${err}`);
    for (const v of auditGeometry(r, config).slice(0, 3)) failures.push(`${where} Geometry: [${v.type}] ${v.detail}`);
    if (heights) for (const v of auditBands(r, config).slice(0, 3)) failures.push(`${where} Bands: ${v}`);
}

/** The band (generation) a drawn card stands in. */
function genOf(r: LayoutResult, id: PersonId): number | undefined {
    const y = r.positions.get(id)?.y;
    return y === undefined ? undefined : (r.bands ?? []).find(b => y >= b.top - 1 && y < b.top + b.height + 1)?.generation;
}

/** The filtered layout against the whole view: who is drawn, in which row, which lines. */
function check(data: StromData, inp: PipelineInput, filter: ReadonlySet<PersonId>, config: LayoutConfig, heights: boolean,
    where: string, failures: string[]): LayoutResult {
    const full = runLayoutPipeline(inp);
    const r = runLayoutPipeline({ ...inp, personFilter: filter });
    strict(r, config, heights, where, failures);
    const focus = inp.focusPersonId;
    const expected = new Set([...full.positions.keys()].filter(id => id === focus || filter.has(id)));
    const missing = [...expected].filter(id => !r.positions.has(id));
    const extra = [...r.positions.keys()].filter(id => !expected.has(id));
    if (missing.length) failures.push(`${where}: not drawn ${missing.slice(0, 5).join(',')}`);
    if (extra.length) failures.push(`${where}: drawn outside the filter ${extra.slice(0, 5).join(',')}`);
    for (const id of r.positions.keys()) {
        if (genOf(r, id) !== genOf(full, id)) failures.push(`${where}: ${id} in row ${genOf(r, id)}, the whole view's ${genOf(full, id)}`);
    }
    for (const c of r.connections) for (const d of c.drops) {
        if (!r.positions.has(d.personId)) failures.push(`${where}: a line to ${d.personId} not drawn`);
    }
    for (const s of r.spouseLines) {
        if (!r.positions.has(s.person1Id) || !r.positions.has(s.person2Id)) failures.push(`${where}: a partner line to someone not drawn`);
    }
    // The counts (bulk-family, the focus bar) see the same persons
    const counted = drawnPersonIds({ ...inp, personFilter: filter });
    const countedOff = [...counted].filter(id => !r.positions.has(id));
    if (countedOff.length) failures.push(`${where}: counted but not drawn ${countedOff.slice(0, 5).join(',')}`);
    return r;
}

describe('Hide others: the layout of the selection alone', () => {
    for (const fixture of FIXTURES) {
        for (const mode of MODES) {
            it(`${fixture} [${mode.name}]`, () => {
                const data = loadFixture(fixture);
                normalizeSingleParents(data);
                const index = buildLineages(data);
                const ids = (Object.keys(data.persons) as PersonId[]).filter(id => !data.persons[id].isPlaceholder).sort();
                const config: LayoutConfig = mode.heights
                    ? { ...DEFAULT_LAYOUT_CONFIG, spouseLineY: 25, personHeights: syntheticPersonHeights(ids) }
                    : DEFAULT_LAYOUT_CONFIG;
                const failures: string[] = [];
                let checked = 0;
                for (const depth of DEPTHS) for (const focus of ids) {
                    const inp = input(data, focus, config, depth, mode.autoExpand);
                    // Ancestors: a pure pedigree
                    const anc = selectionPersonIds(data, index, { kind: 'ancestors', personId: focus }) ?? new Set<PersonId>();
                    const r = check(data, inp, anc, config, mode.heights, `${focus} d${depth} ancestors`, failures);
                    const notAnc = [...r.positions.keys()].filter(id => id !== focus && !anc.has(id));
                    if (notAnc.length) failures.push(`${focus} d${depth} ancestors: not an ancestor drawn ${notAnc.join(',')}`);
                    checked++;
                    // The family line with its spouses
                    const rod = rodOf(index, focus);
                    if (rod) {
                        const set = new Set<PersonId>([...realRodMembers(index, rod), ...realRodSpouses(index, rod)]);
                        check(data, inp, set, config, mode.heights, `${focus} d${depth} line ${rod}`, failures);
                        checked++;
                    }
                    // Scattered persons (a list): every third of the view
                    const scattered = new Set(ids.filter((_, i) => (i + ids.indexOf(focus)) % 3 === 0));
                    check(data, inp, scattered, config, mode.heights, `${focus} d${depth} list`, failures);
                    checked++;
                    // Descendants, in the Descendants view
                    if (depth === 2) {
                        const des = selectionPersonIds(data, index, { kind: 'descendants', personId: focus }) ?? new Set<PersonId>();
                        check(data, input(data, focus, config, depth, mode.autoExpand, true), des, config, mode.heights,
                            `${focus} d${depth} descendants view`, failures);
                        checked++;
                    }
                }
                expect(checked).toBeGreaterThan(0);
                expect(failures.slice(0, 20)).toEqual([]);
            });
        }
    }

    it('an empty selection draws the focus alone', () => {
        const data = loadFixture('comprehensive');
        normalizeSingleParents(data);
        const focus = (Object.keys(data.persons) as PersonId[]).find(id => !data.persons[id].isPlaceholder)!;
        const r = runLayoutPipeline({ ...input(data, focus, DEFAULT_LAYOUT_CONFIG, 3, false), personFilter: new Set() });
        expect([...r.positions.keys()]).toEqual([focus]);
        expect(r.connections).toEqual([]);
    });
});
