/**
 * Other partners shown in place (PipelineInput.showPartnersOf, the "▸ ∞"
 * pill): for every fixture, every person as focus, a sample of depths, the
 * standard and expanded modes, cards of one height and of their own heights,
 * every drawn person with a partner of a union without children out of view
 * (partnerIdsShownInPlace) gets those partners shown in place. The strict
 * checks of allPersonsFull.test.ts hold (valid positions, no card overlap,
 * the built-in validation, the geometry audit; bands with own heights), no
 * tolerance widened; each partner is drawn in the person's row, on the side
 * away from the partner drawn before, nobody drawn before leaves and the
 * new cards are those partners alone (a person drawn with one union, as
 * the standard mode draws everyone, as a partner chain draws the other
 * unions of the selection too, as the children tab does). Closing (the input without the
 * person) gives back the layout before, position for position.
 *
 * With the person's children shown in the same view (expandChildrenOf) the
 * partners come as well, the children stay drawn.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { loadFixture } from './helpers/loadFixture.js';
import { runLayoutPipeline, planShownChildrenFolding, partnerIdsShownInPlace } from '../pipeline/index.js';
import { assertNoNodeOverlap, assertValidPositions } from './helpers/assertions.js';
import { auditGeometry } from './helpers/geometryAudit.js';
import { auditBands, syntheticPersonHeights } from './helpers/bandAudit.js';
import { PersonId, PartnershipId, LayoutConfig, DEFAULT_LAYOUT_CONFIG, StromData } from '../../types.js';
import type { LayoutResult } from '../pipeline/types.js';
import { normalizeSingleParents } from '../../single-parent.js';
import { hiddenChildIds, offeredPartners } from '../../marriage-order.js';

const DEPTHS = [1, 2, 3, 5];

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
    showPartnersOf: PersonId[] = [], shown: PersonId[] = [], showPartnerUnions: PartnershipId[] = []): LayoutResult {
    const input = {
        data, focusPersonId: focus, config, ancestorDepth: depth, descendantDepth: depth,
        includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy: { mode: autoExpand ? 'expanded' as const : 'standard' as const, autoExpand },
        ...(showPartnersOf.length ? { showPartnersOf } : {}),
        ...(showPartnerUnions.length ? { showPartnerUnions } : {}),
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

/** The person's union partners drawn in a layout. */
function drawnPartners(data: StromData, id: PersonId, r: LayoutResult): PersonId[] {
    return (data.persons[id]?.partnerships ?? []).map(u => data.partnerships[u]).filter(u => !!u)
        .map(u => u.person1Id === id ? u.person2Id : u.person1Id)
        .filter(p => p !== id && r.positions.has(p));
}

/** The person's partners, their descendants and the descendants' partners. */
function familyOf(data: StromData, id: PersonId): Set<PersonId> {
    const out = new Set<PersonId>();
    const partners = (pid: PersonId) => (data.persons[pid]?.partnerships ?? []).map(u => data.partnerships[u]).filter(u => !!u)
        .map(u => u.person1Id === pid ? u.person2Id : u.person1Id);
    for (const q of partners(id)) out.add(q);
    const stack = [...(data.persons[id]?.childIds ?? [])];
    while (stack.length) {
        const c = stack.pop()!;
        if (out.has(c) && c !== id) continue;
        out.add(c);
        for (const q of partners(c)) out.add(q);
        stack.push(...(data.persons[c]?.childIds ?? []));
    }
    return out;
}

/** The partners out of view a "▸ ∞" of the person promises in a layout. */
function promisedPartners(data: StromData, id: PersonId, r: LayoutResult): PersonId[] {
    return partnerIdsShownInPlace(data, id).filter(p => !r.positions.has(p));
}

describe('Other partners shown in place: full pipeline invariants', () => {
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
                let checked = 0, withChildren = 0;
                for (const depth of DEPTHS) for (const focus of ids) {
                    const base = layout(data, focus, config, depth, mode.autoExpand);
                    for (const pid of base.positions.keys()) {
                        const promised = promisedPartners(data, pid, base);
                        if (promised.length === 0) continue;
                        const where = `${focus} d${depth} partners of ${pid}`;
                        checked++;
                        const r = layout(data, focus, config, depth, mode.autoExpand, [pid]);
                        strict(r, config, mode.heights, where, failures);
                        if (!r.positions.has(pid)) failures.push(`${where}: the person left the view`);
                        const missing = promised.filter(q => !r.positions.has(q));
                        if (missing.length) failures.push(`${where}: partners not drawn ${missing.join(',')}`);
                        const g = genOf(r, pid);
                        for (const q of promised) {
                            if (r.positions.has(q) && genOf(r, q) !== g) failures.push(`${where}: partner ${q} not in the person's row`);
                        }
                        // On the side away from the partners drawn before
                        const was = drawnPartners(data, pid, base);
                        const px = r.positions.get(pid)?.x ?? 0;
                        const sides = new Set(was.map(q => Math.sign((r.positions.get(q)?.x ?? px) - px)));
                        if (sides.size === 1) {
                            for (const q of promised) {
                                const x = r.positions.get(q)?.x;
                                if (x !== undefined && sides.has(Math.sign(x - px))) failures.push(`${where}: partner ${q} on the side of the partner drawn before`);
                            }
                        }
                        // Nobody drawn before leaves; the new cards are the partners
                        const lost = [...base.positions.keys()].filter(id => !r.positions.has(id));
                        if (lost.length) failures.push(`${where}: left the view ${lost.slice(0, 5).join(',')}`);
                        // (a person drawn with one union, as the standard mode draws everyone and the
                        // expanded mode a stepchild: as a chain the person's other unions of the
                        // selection come too, the partners and their families)
                        const family = familyOf(data, pid);
                        const extra = [...r.positions.keys()].filter(id => !base.positions.has(id) && !promised.includes(id)
                            && !family.has(id));
                        if (extra.length) failures.push(`${where}: more than the partners came in ${extra.slice(0, 5).join(',')}`);
                        // The person is no longer promising partners
                        if (promisedPartners(data, pid, r).length) failures.push(`${where}: still promising partners`);

                        // With the person's children shown in the same view
                        const inR = (id: PersonId) => r.positions.has(id);
                        if (hiddenChildIds(data, pid, inR).length === 0) continue;
                        withChildren++;
                        const c = layout(data, focus, config, depth, mode.autoExpand, [pid], [pid]);
                        const cw = `${where} with children`;
                        strict(c, config, mode.heights, cw, failures);
                        const notDrawn = promised.filter(q => !c.positions.has(q));
                        if (notDrawn.length) failures.push(`${cw}: partners not drawn ${notDrawn.join(',')}`);
                        const childless = layout(data, focus, config, depth, mode.autoExpand, [], [pid]);
                        const gone = [...childless.positions.keys()].filter(id => !c.positions.has(id));
                        if (gone.length) failures.push(`${cw}: left the view ${gone.slice(0, 5).join(',')}`);
                    }
                }
                expect(failures.slice(0, 20), `${fixture} [${mode.name}], ${failures.length} failures of ${checked} (+${withChildren} with children)`).toEqual([]);
                if (process.env.PARTNERS_SHOWN_COUNTS) console.log(`${fixture} [${mode.name}] ${checked} (+${withChildren})`);
                // Showing partners never changes the tree's data
                expect(JSON.stringify(data)).toBe(before);
            }, 600_000);
        }
    }
});

describe('Other partners shown in place: nested and closed', () => {
    // A partner shown in place who has other childless partners shows them
    // in turn (nested); closing the inner step gives the view of the outer
    // one back, closing all the view before, position for position.
    for (const fixture of FIXTURES) {
        it(fixture, () => {
            const data = loadFixture(fixture);
            normalizeSingleParents(data);
            const ids = (Object.keys(data.persons) as PersonId[]).filter(id => !data.persons[id].isPlaceholder);
            const config = DEFAULT_LAYOUT_CONFIG;
            const failures: string[] = [];
            const same = (a: LayoutResult, b: LayoutResult, where: string) => {
                if (a.positions.size !== b.positions.size) { failures.push(`${where}: other cards`); return; }
                for (const [id, p] of a.positions) {
                    const q = b.positions.get(id);
                    if (!q || q.x !== p.x || q.y !== p.y) { failures.push(`${where}: ${id} moved`); return; }
                }
            };
            for (const autoExpand of [false, true]) for (const depth of [2, 3]) for (const focus of ids) {
                const base = layout(data, focus, config, depth, autoExpand);
                for (const pid of base.positions.keys()) {
                    if (promisedPartners(data, pid, base).length === 0) continue;
                    const where = `${focus} d${depth}${autoExpand ? ' expanded' : ''} partners of ${pid}`;
                    const once = layout(data, focus, config, depth, autoExpand, [pid]);
                    // Nested: a partner shown here shows their own other partners
                    for (const q of promisedPartners(data, pid, base)) {
                        if (promisedPartners(data, q, once).length === 0) continue;
                        const twice = layout(data, focus, config, depth, autoExpand, [pid, q]);
                        strict(twice, config, false, `${where}, then of ${q}`, failures);
                        const missing = promisedPartners(data, q, once).filter(x => !twice.positions.has(x));
                        if (missing.length) failures.push(`${where}, then of ${q}: partners not drawn ${missing.join(',')}`);
                        same(once, layout(data, focus, config, depth, autoExpand, [pid]), `${where}, then of ${q} closed`);
                    }
                    same(base, layout(data, focus, config, depth, autoExpand), `${where} closed`);
                }
            }
            expect(failures.slice(0, 20), `${fixture}, ${failures.length} failures`).toEqual([]);
        }, 600_000);
    }
});

describe('Every marriage of a child shown in place in the standard mode (showPartnerUnions, round 5 §36)', () => {
    // A child a children step brought stands with one partner; its "▸ ∞"
    // offers every marriage out of view (offeredPartners). For every child
    // so brought with a marriage with children among them: the strict checks
    // hold, every offered partner stands in the child's row, the children of
    // those marriages are drawn, and only the partner the child stood with
    // may leave (it gives its place to the marriage with children).
    for (const fixture of FIXTURES) {
        for (const heights of [false, true]) {
            it(`${fixture}${heights ? ' [v3]' : ''}`, () => {
                const data = loadFixture(fixture);
                normalizeSingleParents(data);
                const before = JSON.stringify(data);
                const ids = (Object.keys(data.persons) as PersonId[]).filter(id => !data.persons[id].isPlaceholder);
                const config: LayoutConfig = heights
                    ? { ...DEFAULT_LAYOUT_CONFIG, spouseLineY: 25, personHeights: syntheticPersonHeights(ids) }
                    : DEFAULT_LAYOUT_CONFIG;
                const failures: string[] = [];
                let checked = 0;
                for (const depth of [2, 3]) for (const focus of ids) {
                    const base = layout(data, focus, config, depth, false);
                    for (const pid of base.positions.keys()) {
                        if (hiddenChildIds(data, pid, id => base.positions.has(id)).length === 0) continue;
                        const shown = layout(data, focus, config, depth, false, [], [pid]);
                        for (const child of shown.positions.keys()) {
                            if (base.positions.has(child) || !(data.persons[pid]?.childIds ?? []).includes(child)) continue;
                            const offers = offeredPartners(data, child, id => shown.positions.has(id), true);
                            if (!offers.some(o => o.childCount > 0)) continue;
                            checked++;
                            const where = `${focus} d${depth} children of ${pid}, every marriage of ${child}`;
                            const r = layout(data, focus, config, depth, false, [], [pid], offers.map(o => o.partnershipId));
                            strict(r, config, heights, where, failures);
                            if (!r.positions.has(child)) { failures.push(`${where}: the child left the view`); continue; }
                            const g = genOf(r, child);
                            for (const o of offers) {
                                if (!r.positions.has(o.partnerId)) failures.push(`${where}: partner ${o.partnerId} not drawn`);
                                else if (genOf(r, o.partnerId) !== g) failures.push(`${where}: partner ${o.partnerId} not in the child's row`);
                                const kids = data.partnerships[o.partnershipId].childIds.filter(k => !data.persons[k]?.isPlaceholder);
                                const missing = kids.filter(k => !r.positions.has(k));
                                if (missing.length) failures.push(`${where}: children of ${o.partnershipId} not drawn ${missing.join(',')}`);
                            }
                            const stoodWith = new Set(drawnPartners(data, child, shown));
                            const lost = [...shown.positions.keys()].filter(id => !r.positions.has(id) && !stoodWith.has(id));
                            if (lost.length) failures.push(`${where}: left the view ${lost.slice(0, 5).join(',')}`);
                        }
                    }
                }
                expect(failures.slice(0, 20), `${fixture}, ${failures.length} failures of ${checked}`).toEqual([]);
                if (process.env.PARTNERS_SHOWN_COUNTS) console.log(`${fixture} every marriage ${checked}`);
                expect(JSON.stringify(data)).toBe(before);
            }, 600_000);
        }
    }
});

describe('Every marriage of a person in the plain depth (showPartnerUnions, round 6 §46, §42)', () => {
    // A person the view draws without any expansion (an ancestor, the focus,
    // a sibling, a descendant) whose marriage with children stands out of
    // view: its "▸ ∞" offers every marriage out of view as on a child shown
    // in place (offeredPartners). A click on the pill brings them all, a
    // click on one name that marriage alone (with its children). For every
    // such person: the strict checks hold, each partner stands in the
    // person's row, the children of the marriages are drawn, nobody drawn
    // before leaves (the partner beside the card stays: nothing is
    // exchanged in the plain depth) and closing (the input without the
    // unions) gives the layout back, position for position.
    const MODES46 = [
        { name: 'standard', heights: false, autoExpand: false },
        { name: 'expanded', heights: false, autoExpand: true },
        { name: 'standard-v3', heights: true, autoExpand: false },
    ];
    for (const fixture of FIXTURES) {
        for (const mode of MODES46) {
            it(`${fixture} [${mode.name}]`, () => {
                const data = loadFixture(fixture);
                normalizeSingleParents(data);
                const before = JSON.stringify(data);
                const ids = (Object.keys(data.persons) as PersonId[]).filter(id => !data.persons[id].isPlaceholder);
                const config: LayoutConfig = mode.heights
                    ? { ...DEFAULT_LAYOUT_CONFIG, spouseLineY: 25, personHeights: syntheticPersonHeights(ids) }
                    : DEFAULT_LAYOUT_CONFIG;
                const failures: string[] = [];
                let checked = 0;
                const same = (a: LayoutResult, b: LayoutResult, where: string) => {
                    if (a.positions.size !== b.positions.size) { failures.push(`${where}: other cards`); return; }
                    for (const [id, p] of a.positions) {
                        const q = b.positions.get(id);
                        if (!q || q.x !== p.x || q.y !== p.y) { failures.push(`${where}: ${id} moved`); return; }
                    }
                };
                for (const depth of [2, 3]) for (const focus of ids) {
                    const base = layout(data, focus, config, depth, mode.autoExpand);
                    for (const pid of base.positions.keys()) {
                        const offers = offeredPartners(data, pid, id => base.positions.has(id), true);
                        if (!offers.some(o => o.childCount > 0)) continue;
                        // The pill (every marriage) and each marriage with children alone (a name)
                        const picks = [offers, ...offers.filter(o => o.childCount > 0).map(o => [o])];
                        for (const pick of picks) {
                            checked++;
                            const where = `${focus} d${depth} ${pick.length === offers.length && picks.length > 2 ? 'every marriage' : `marriage ${pick.map(o => o.partnershipId).join(',')}`} of ${pid}`;
                            const r = layout(data, focus, config, depth, mode.autoExpand, [], [], pick.map(o => o.partnershipId));
                            strict(r, config, mode.heights, where, failures);
                            if (!r.positions.has(pid)) { failures.push(`${where}: the person left the view`); continue; }
                            const g = genOf(r, pid);
                            for (const o of pick) {
                                if (!r.positions.has(o.partnerId)) failures.push(`${where}: partner ${o.partnerId} not drawn`);
                                else if (genOf(r, o.partnerId) !== g) failures.push(`${where}: partner ${o.partnerId} not in the person's row`);
                                const kids = data.partnerships[o.partnershipId].childIds.filter(k => !data.persons[k]?.isPlaceholder);
                                const missing = kids.filter(k => !r.positions.has(k));
                                if (missing.length) failures.push(`${where}: children of ${o.partnershipId} not drawn ${missing.join(',')}`);
                            }
                            // Only the marriages picked: the others stay out of view
                            for (const o of offers) {
                                if (!pick.includes(o) && r.positions.has(o.partnerId)) failures.push(`${where}: partner ${o.partnerId} not picked came in`);
                            }
                            const lost = [...base.positions.keys()].filter(id => !r.positions.has(id));
                            if (lost.length) failures.push(`${where}: left the view ${lost.slice(0, 5).join(',')}`);
                        }
                        same(base, layout(data, focus, config, depth, mode.autoExpand), `${focus} d${depth} ${pid} closed`);
                    }
                }
                expect(failures.slice(0, 20), `${fixture} [${mode.name}], ${failures.length} failures of ${checked}`).toEqual([]);
                if (process.env.PARTNERS_SHOWN_COUNTS) console.log(`${fixture} [${mode.name}] plain depth ${checked}`);
                expect(JSON.stringify(data)).toBe(before);
            }, 900_000);
        }
    }
});

describe('One marriage at a time in the expanded mode (showPartnerUnions, round 7 §50)', () => {
    // The expanded mode's "▸ ∞" offers the marriages without children out of
    // view (offeredPartners); a click on one name in its bubble (or in the
    // person menu's "∞ Other partners") brings that marriage alone, a later
    // click on the pill the rest (the union picked first, then the others).
    // For every drawn person with such a marriage, each one alone and each
    // one followed by the rest: the strict checks hold, the person
    // stays, each partner picked stands in the person's row, the ones not
    // picked stay out, nobody drawn before leaves, and closing (the input
    // without the unions) gives the layout back, position for position.
    for (const fixture of FIXTURES) {
        for (const heights of [false, true]) {
            it(`${fixture}${heights ? ' [v3]' : ''}`, () => {
                const data = loadFixture(fixture);
                normalizeSingleParents(data);
                const before = JSON.stringify(data);
                const ids = (Object.keys(data.persons) as PersonId[]).filter(id => !data.persons[id].isPlaceholder);
                const config: LayoutConfig = heights
                    ? { ...DEFAULT_LAYOUT_CONFIG, spouseLineY: 25, personHeights: syntheticPersonHeights(ids) }
                    : DEFAULT_LAYOUT_CONFIG;
                const failures: string[] = [];
                let checked = 0;
                const same = (a: LayoutResult, b: LayoutResult, where: string) => {
                    if (a.positions.size !== b.positions.size) { failures.push(`${where}: other cards`); return; }
                    for (const [id, p] of a.positions) {
                        const q = b.positions.get(id);
                        if (!q || q.x !== p.x || q.y !== p.y) { failures.push(`${where}: ${id} moved`); return; }
                    }
                };
                for (const depth of [2, 3]) for (const focus of ids) {
                    const base = layout(data, focus, config, depth, true);
                    for (const pid of base.positions.keys()) {
                        const offers = offeredPartners(data, pid, id => base.positions.has(id), false);
                        if (offers.length === 0) continue;
                        for (const one of offers) {
                            const rest = offers.filter(o => o !== one);
                            for (const pick of rest.length > 0 ? [[one], [one, ...rest]] : [[one]]) {
                                checked++;
                                const where = `${focus} d${depth} ${pick.length === 1 ? 'marriage' : 'rest after'} ${one.partnershipId} of ${pid}`;
                                const r = layout(data, focus, config, depth, true, [], [], pick.map(o => o.partnershipId));
                                strict(r, config, heights, where, failures);
                                if (!r.positions.has(pid)) { failures.push(`${where}: the person left the view`); continue; }
                                const g = genOf(r, pid);
                                for (const o of pick) {
                                    if (!r.positions.has(o.partnerId)) failures.push(`${where}: partner ${o.partnerId} not drawn`);
                                    else if (genOf(r, o.partnerId) !== g) failures.push(`${where}: partner ${o.partnerId} not in the person's row`);
                                }
                                for (const o of offers) {
                                    if (!pick.includes(o) && r.positions.has(o.partnerId)) failures.push(`${where}: partner ${o.partnerId} not picked came in`);
                                }
                                const lost = [...base.positions.keys()].filter(id => !r.positions.has(id));
                                if (lost.length) failures.push(`${where}: left the view ${lost.slice(0, 5).join(',')}`);
                            }
                        }
                        same(base, layout(data, focus, config, depth, true), `${focus} d${depth} ${pid} closed`);
                    }
                }
                expect(failures.slice(0, 20), `${fixture}${heights ? ' [v3]' : ''}, ${failures.length} failures of ${checked}`).toEqual([]);
                if (process.env.PARTNERS_SHOWN_COUNTS) console.log(`${fixture}${heights ? ' [v3]' : ''} expanded one by one ${checked}`);
                expect(JSON.stringify(data)).toBe(before);
            }, 900_000);
        }
    }
});
