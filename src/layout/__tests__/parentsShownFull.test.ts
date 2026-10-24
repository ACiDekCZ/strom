/**
 * Parents shown in place beyond the ancestor depth (PipelineInput.extraDepthFor,
 * the "▸ parents" of an ancestor at the edge of the depth): for every
 * fixture, every person as focus, ancestor depths 1 to 7, the standard and
 * expanded modes, cards of one height and of their own heights, every
 * ancestor the layout reports at the edge (LayoutResult.ancestorDepthEdge)
 * gets their parents shown in place. The strict checks of
 * allPersonsFull.test.ts hold (valid positions, no card overlap, the built-in
 * validation, the geometry audit; bands with own heights), no tolerance
 * widened; the parents are drawn as a couple in the row above the person,
 * nobody drawn before leaves, the click adds one generation above that branch
 * alone (the parents and, in the expanded mode, their other partners), and
 * the person is no longer at the edge. Only the parents come, at every
 * depth: the person's siblings (the parents' other children) and their
 * descendants stay out of the view, also for a parent of the focus at depth
 * 1, whose aunts and uncles with their families the selection holds already
 * (includeParentSiblings).
 *
 * With the parents' children shown in the same step (the "▸ siblings" of an
 * edge ancestor: extraDepthFor [P] and expandChildrenOf the parents) every
 * promised sibling is drawn as well, beside each other, with their partners
 * (as every child shown in place, and as the view draws a relative: one
 * partner in the standard mode, every one in the expanded mode; an empty
 * "?" stand-in excepted) and
 * without their children (the cousins come with the sibling's own
 * "▸ children"); closing the step gives the view before back, position for
 * position.
 *
 * The edge is the layout's own: the persons of the line reached at the depth
 * whose parents lie beyond it, never a person whose parents are folded or
 * drawn another way.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { loadFixture } from './helpers/loadFixture.js';
import { runLayoutPipeline, planShownChildrenFolding } from '../pipeline/index.js';
import { assertNoNodeOverlap, assertValidPositions } from './helpers/assertions.js';
import { auditGeometry } from './helpers/geometryAudit.js';
import { auditBands, syntheticPersonHeights } from './helpers/bandAudit.js';
import { PersonId, LayoutConfig, DEFAULT_LAYOUT_CONFIG, StromData } from '../../types.js';
import type { LayoutResult } from '../pipeline/types.js';
import { normalizeSingleParents } from '../../single-parent.js';
import { hiddenChildIds } from '../../marriage-order.js';
import { isDiagramStandIn } from '../pipeline/placeholders.js';

const DEPTHS = [1, 2, 3, 4, 5, 6, 7];

const MODES = [
    { name: 'standard', heights: false, autoExpand: false },
    { name: 'expanded', heights: false, autoExpand: true },
    { name: 'standard-v3', heights: true, autoExpand: false },
    { name: 'expanded-v3', heights: true, autoExpand: true },
];

const FIXTURES = readdirSync(join(process.cwd(), 'test'))
    .filter(n => /^(comprehensive|edge-.*|etalon-.*|real-large)\.json$/.test(n))
    .map(n => n.replace(/\.json$/, ''))
    .filter(f => existsSync(join(process.cwd(), 'test', `${f}.json`)))
    .sort();

function layout(data: StromData, focus: PersonId, config: LayoutConfig, depth: number, autoExpand: boolean,
    extraDepthFor: PersonId[] = [], shown: PersonId[] = []): LayoutResult {
    const input = {
        data, focusPersonId: focus, config, ancestorDepth: depth, descendantDepth: depth,
        includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy: { mode: autoExpand ? 'expanded' as const : 'standard' as const, autoExpand },
        ...(extraDepthFor.length ? { extraDepthFor } : {}),
        ...(shown.length ? { expandChildrenOf: shown } : {}),
    };
    // As the renderer: children shown go through the folding planner
    return shown.length ? planShownChildrenFolding(input).result : runLayoutPipeline(input);
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

/**
 * Cards between the children of one of the person's unions in their row that
 * are neither such a child nor in a child's partner chain (the child's
 * partners, their other partners and so on: one chain of marriages, drawn
 * side by side as the plain depth draws it).
 */
function foreignBetweenChildren(data: StromData, pid: PersonId, positions: Map<PersonId, { x: number; y: number }>): string[] {
    const out: string[] = [];
    for (const uid of data.persons[pid]?.partnerships ?? []) {
        const kids = (data.partnerships[uid]?.childIds ?? []).filter(c => positions.has(c));
        if (kids.length < 2) continue;
        const own = new Set<PersonId>();
        for (const stack = [...kids]; stack.length > 0;) {
            const id = stack.pop()!;
            if (own.has(id)) continue;
            own.add(id);
            stack.push(...partnersOf(data, id).filter(o => positions.has(o)));
        }
        const y = positions.get(kids[0])!.y;
        if (kids.some(k => Math.abs(positions.get(k)!.y - y) > 1)) continue;
        const xs = kids.map(k => positions.get(k)!.x);
        const lo = Math.min(...xs), hi = Math.max(...xs);
        for (const [id, p] of positions) {
            if (own.has(id) || Math.abs(p.y - y) > 1) continue;
            if (p.x > lo && p.x < hi) out.push(`${id} between the children of ${uid}`);
        }
    }
    return out;
}

/** The person's siblings (the parents' other children) and everyone descended from them. */
function siblingsAndDescendants(data: StromData, id: PersonId): PersonId[] {
    const out = new Set<PersonId>();
    const stack = (data.persons[id]?.parentIds ?? []).flatMap(q => data.persons[q]?.childIds ?? []).filter(c => c !== id);
    while (stack.length > 0) {
        const c = stack.pop()!;
        if (out.has(c) || c === id) continue;
        out.add(c);
        stack.push(...(data.persons[c]?.childIds ?? []));
    }
    return [...out];
}

/** The persons a person's union partners are (any union). */
function partnersOf(data: StromData, id: PersonId): PersonId[] {
    return (data.persons[id]?.partnerships ?? []).map(u => data.partnerships[u]).filter(u => !!u)
        .map(u => u.person1Id === id ? u.person2Id : u.person1Id);
}

describe('Parents shown in place beyond the depth: full pipeline invariants', () => {
    for (const fixture of FIXTURES) {
        for (const mode of MODES) {
            it(`${fixture} [${mode.name}]`, () => {
                const data = loadFixture(fixture);
                normalizeSingleParents(data);
                const before = JSON.stringify(data);
                const ids = (Object.keys(data.persons) as PersonId[]).filter(id => !data.persons[id].isPlaceholder);
                const config: LayoutConfig = mode.heights
                    ? { ...DEFAULT_LAYOUT_CONFIG, spouseLineY: 25, personHeights: syntheticPersonHeights(ids) }
                    : DEFAULT_LAYOUT_CONFIG;
                const failures: string[] = [];
                let checked = 0, siblings = 0;
                for (const depth of DEPTHS) for (const focus of ids) {
                    const base = layout(data, focus, config, depth, mode.autoExpand);
                    for (const pid of base.ancestorDepthEdge ?? []) {
                        const where = `${focus} d${depth} parents of ${pid}`;
                        checked++;
                        // The edge is the depth's: no parent drawn, the person drawn
                        const person = data.persons[pid];
                        if (!base.positions.has(pid) || person.parentIds.some(q => base.positions.has(q))) {
                            failures.push(`${where}: reported at the edge with a parent in view`);
                            continue;
                        }
                        const r = layout(data, focus, config, depth, mode.autoExpand, [pid]);
                        strict(r, config, mode.heights, where, failures);
                        if (!r.positions.has(pid)) failures.push(`${where}: the person left the view`);
                        const parents = person.parentIds.filter(q => data.persons[q] && !data.persons[q].isPlaceholder);
                        const missing = parents.filter(q => !r.positions.has(q));
                        if (missing.length) failures.push(`${where}: parents not drawn ${missing.join(',')}`);
                        const g = genOf(r, pid);
                        for (const q of parents) {
                            if (r.positions.has(q) && genOf(r, q) !== (g ?? 0) - 1) failures.push(`${where}: parent ${q} not in the row above`);
                        }
                        if ((r.ancestorDepthEdge ?? []).includes(pid)) failures.push(`${where}: still at the edge`);
                        // Nobody drawn before leaves; the new cards are the parents and their partners
                        const lost = [...base.positions.keys()].filter(id => !r.positions.has(id));
                        if (lost.length) failures.push(`${where}: left the view ${lost.slice(0, 5).join(',')}`);
                        const allowed = new Set<PersonId>(person.parentIds);
                        for (const q of person.parentIds) for (const o of partnersOf(data, q)) allowed.add(o);
                        const extra = [...r.positions.keys()].filter(id => !base.positions.has(id) && !allowed.has(id));
                        if (extra.length) failures.push(`${where}: more than the parents came in ${extra.slice(0, 5).join(',')}`);
                        // Never the person's siblings nor anyone descended from them (the aunts and uncles at depth 1)
                        const kin = siblingsAndDescendants(data, pid).filter(id => r.positions.has(id) && !base.positions.has(id));
                        if (kin.length) failures.push(`${where}: siblings or their descendants came in ${kin.slice(0, 5).join(',')}`);
                        // The parents' line comes down to the person
                        const line = r.connections.find(c => c.drops.some(d => d.personId === pid));
                        if (parents.length && !line && !(r.omittedEdges ?? []).some(e => e.childId === pid)) failures.push(`${where}: no line to the person`);

                        // "▸ siblings" of the edge ancestor: one generation more and the parents' children, one step
                        const inR = (id: PersonId) => r.positions.has(id);
                        const showable = parents.filter(q => inR(q) && hiddenChildIds(data, q, inR).length > 0);
                        if (showable.length === 0) continue;
                        siblings++;
                        const promised = [...new Set(showable.flatMap(q => hiddenChildIds(data, q, inR)))];
                        const s = layout(data, focus, config, depth, mode.autoExpand, [pid], showable);
                        const sw = `${where} with siblings (${showable.join('+')})`;
                        strict(s, config, mode.heights, sw, failures);
                        if (!s.positions.has(pid)) failures.push(`${sw}: the person left the view`);
                        for (const q of showable) if (!s.positions.has(q)) failures.push(`${sw}: the parent ${q} left the view`);
                        const notDrawn = promised.filter(c => !s.positions.has(c));
                        if (notDrawn.length) failures.push(`${sw}: siblings not drawn ${notDrawn.join(',')}`);
                        for (const q of showable) {
                            const apart = foreignBetweenChildren(data, q, s.positions);
                            if (apart.length) failures.push(`${sw}: not beside each other, ${apart.slice(0, 3).join('; ')}`);
                        }
                        // The siblings come with their partners, as the view draws a
                        // relative (the standard mode one partner, the expanded mode
                        // every one), not with their children
                        const partnersOfSibling = (c: PersonId) => partnersOf(data, c).filter(o => data.persons[o] && !isDiagramStandIn(data, o));
                        const partners = new Set(promised.flatMap(partnersOfSibling));
                        const noPartner = promised.flatMap(c => {
                            const own = partnersOfSibling(c);
                            const drawn = own.filter(o => s.positions.has(o));
                            return mode.autoExpand ? own.filter(o => !s.positions.has(o)) : own.length > 0 && drawn.length === 0 ? [c] : [];
                        });
                        if (noPartner.length) failures.push(`${sw}: partners of the siblings not drawn ${noPartner.slice(0, 5).join(',')}`);
                        const cousins = promised.flatMap(c => data.persons[c]?.childIds ?? [])
                            .filter(k => s.positions.has(k) && !r.positions.has(k) && !promised.includes(k) && !partners.has(k));
                        if (cousins.length) failures.push(`${sw}: the siblings' children came in ${cousins.slice(0, 5).join(',')}`);
                        // Closing the step gives the view before back
                        const closed = layout(data, focus, config, depth, mode.autoExpand);
                        if (closed.positions.size !== base.positions.size) failures.push(`${sw}: closed, other cards`);
                        for (const [id, p] of base.positions) {
                            const b = closed.positions.get(id);
                            if (!b || b.x !== p.x || b.y !== p.y) { failures.push(`${sw}: closed, ${id} moved`); break; }
                        }
                    }
                }
                expect(failures.slice(0, 20), `${fixture} [${mode.name}], ${failures.length} failures of ${checked} (+${siblings} with siblings)`).toEqual([]);
                if (process.env.PARENTS_SHOWN_COUNTS) console.log(`${fixture} [${mode.name}] ${checked} (+${siblings})`);
                // The sweep reaches edge ancestors and their siblings
                if (fixture === 'comprehensive') expect(checked > 0 && siblings > 0).toBe(true);
                // Showing parents never changes the tree's data
                expect(JSON.stringify(data)).toBe(before);
            }, 600_000);
        }
    }
});

describe('Parents shown in place beyond the depth: nested and closed', () => {
    // Two clicks up the same branch (the person's "▸ parents", then the
    // father's or the mother's): two generations above that branch alone.
    // Closing (the input without the person) gives back the layout before,
    // position for position. Depth 2 and 3, every person as focus.
    for (const fixture of FIXTURES) {
        it(fixture, () => {
            const data = loadFixture(fixture);
            normalizeSingleParents(data);
            const ids = (Object.keys(data.persons) as PersonId[]).filter(id => !data.persons[id].isPlaceholder);
            const config = DEFAULT_LAYOUT_CONFIG;
            const failures: string[] = [];
            for (const autoExpand of [false, true]) for (const depth of [2, 3]) for (const focus of ids) {
                const base = layout(data, focus, config, depth, autoExpand);
                for (const pid of base.ancestorDepthEdge ?? []) {
                    const once = layout(data, focus, config, depth, autoExpand, [pid]);
                    for (const q of data.persons[pid].parentIds) {
                        if (!(once.ancestorDepthEdge ?? []).includes(q)) continue;
                        const where = `${focus} d${depth}${autoExpand ? ' expanded' : ''} parents of ${pid}, then of ${q}`;
                        const twice = layout(data, focus, config, depth, autoExpand, [pid, q]);
                        strict(twice, config, false, where, failures);
                        const grand = data.persons[q].parentIds.filter(x => data.persons[x] && !data.persons[x].isPlaceholder);
                        const missing = grand.filter(x => !twice.positions.has(x));
                        if (missing.length) failures.push(`${where}: parents not drawn ${missing.join(',')}`);
                        const lost = [...once.positions.keys()].filter(id => !twice.positions.has(id));
                        if (lost.length) failures.push(`${where}: left the view ${lost.slice(0, 5).join(',')}`);
                        // Closing the inner click gives the view of the outer one back
                        const back = layout(data, focus, config, depth, autoExpand, [pid]);
                        for (const [id, p] of once.positions) {
                            const b = back.positions.get(id);
                            if (!b || b.x !== p.x || b.y !== p.y) { failures.push(`${where}: closed, ${id} moved`); break; }
                        }
                        break;
                    }
                    // Closing gives the view before back
                    const closed = layout(data, focus, config, depth, autoExpand);
                    if (closed.positions.size !== base.positions.size) failures.push(`${focus} d${depth}: closed, other cards`);
                    for (const [id, p] of base.positions) {
                        const b = closed.positions.get(id);
                        if (!b || b.x !== p.x || b.y !== p.y) { failures.push(`${focus} d${depth}: closed, ${id} moved`); break; }
                    }
                    break;
                }
            }
            expect(failures.slice(0, 20), `${fixture}, ${failures.length} failures`).toEqual([]);
        }, 600_000);
    }
});

describe('Parents shown in place beyond the depth: which persons the layout extended', () => {
    // LayoutResult.extraDepthDrawn names the persons of extraDepthFor whose
    // parents the extension drew. With the depth one higher their parents
    // are in view without it: the same input extends nobody and lays out
    // exactly as the input without them (the screen then drops them from
    // its "▾ parents" state, renderer.ts pruneParentsShown).
    it('comprehensive, every focus, depth 2 then 3', () => {
        const data = loadFixture('comprehensive');
        normalizeSingleParents(data);
        const ids = (Object.keys(data.persons) as PersonId[]).filter(id => !data.persons[id].isPlaceholder);
        const config = DEFAULT_LAYOUT_CONFIG;
        const failures: string[] = [];
        let checked = 0;
        for (const autoExpand of [false, true]) for (const focus of ids) {
            const base = layout(data, focus, config, 2, autoExpand);
            expect(base.extraDepthDrawn).toBeUndefined();
            for (const pid of base.ancestorDepthEdge ?? []) {
                const where = `${focus}${autoExpand ? ' expanded' : ''} parents of ${pid}`;
                const once = layout(data, focus, config, 2, autoExpand, [pid]);
                if (JSON.stringify(once.extraDepthDrawn) !== JSON.stringify([pid])) failures.push(`${where}: drawn ${once.extraDepthDrawn}`);
                const deeper = layout(data, focus, config, 3, autoExpand, [pid]);
                const plain = layout(data, focus, config, 3, autoExpand);
                if (!data.persons[pid].parentIds.every(q => !plain.positions.has(pid) || plain.positions.has(q) || !data.persons[q] || data.persons[q].isPlaceholder)) continue;
                checked++;
                if (deeper.extraDepthDrawn !== undefined) failures.push(`${where}: depth 3 still extends ${deeper.extraDepthDrawn}`);
                if (deeper.positions.size !== plain.positions.size) failures.push(`${where}: depth 3, other cards`);
                for (const [id, p] of plain.positions) {
                    const b = deeper.positions.get(id);
                    if (!b || b.x !== p.x || b.y !== p.y) { failures.push(`${where}: depth 3, ${id} moved`); break; }
                }
            }
        }
        expect(checked).toBeGreaterThan(0);
        expect(failures.slice(0, 20), `${failures.length} failures`).toEqual([]);
    }, 120_000);
});
