/**
 * Children shown in place (PipelineInput.expandChildrenOf, the card's
 * children tab): for every fixture, every person as focus, the standard and
 * expanded modes, cards of one height and of their own heights, every drawn
 * person with a child out of view gets their children shown in place. The
 * strict checks of allPersonsFull.test.ts hold (valid positions, no card
 * overlap, the built-in validation, the geometry audit; bands with own
 * heights), no tolerance widened, and the person's children are drawn.
 *
 * The cards to check are the ones the renderer offers the tab on, by its
 * own decision (hiddenRelativesTabs), and the children it promises
 * (hiddenChildIds) are the ones a click must draw; the "▾ children" bubble
 * then names exactly those (newlyShownChildIds), none drawn before. No case
 * is exempt: partner chains through several people (a marriage cascade, a
 * remarriage web, a merged chain) draw every child too.
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
import type { PipelineInput } from '../pipeline/types.js';
import { normalizeSingleParents } from '../../single-parent.js';
import { hiddenRelativesTabs, hiddenChildIds, newlyShownChildIds } from '../../marriage-order.js';

const DEPTHS = [2, 4, 8];

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

function layout(data: StromData, focus: PersonId, config: LayoutConfig, depth: number, autoExpand: boolean, shown: PersonId[] = []) {
    return runLayoutPipeline({
        data, focusPersonId: focus, config, ancestorDepth: depth, descendantDepth: depth,
        includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy: { mode: autoExpand ? 'expanded' : 'standard', autoExpand },
        ...(shown.length ? { expandChildrenOf: shown } : {}),
    });
}

/** As layout(), with the ancestors folded that the shown children call for (planShownChildrenFolding). */
function plan(data: StromData, focus: PersonId, config: LayoutConfig, depth: number, autoExpand: boolean, shown: PersonId[] = [], extra: Partial<PipelineInput> = {}) {
    return planShownChildrenFolding({
        data, focusPersonId: focus, config, ancestorDepth: depth, descendantDepth: depth,
        includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy: { mode: autoExpand ? 'expanded' : 'standard', autoExpand },
        ...(shown.length ? { expandChildrenOf: shown } : {}),
        ...extra,
    });
}

/**
 * Cards standing between the children of one of the person's unions in their
 * row that are neither such a child nor a child's partner: the children were
 * not shown together (invariant 5).
 */
function foreignBetweenChildren(data: StromData, pid: PersonId, positions: Map<PersonId, { x: number; y: number }>): string[] {
    const out: string[] = [];
    for (const uid of data.persons[pid]?.partnerships ?? []) {
        const kids = (data.partnerships[uid]?.childIds ?? []).filter(c => positions.has(c));
        if (kids.length < 2) continue;
        const own = new Set<PersonId>(kids);
        for (const k of kids) for (const ku of data.persons[k]?.partnerships ?? []) {
            const u = data.partnerships[ku];
            if (u) { own.add(u.person1Id); own.add(u.person2Id); }
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

describe('Children shown in place: full pipeline invariants', () => {
    for (const fixture of FIXTURES) {
        for (const mode of MODES) {
            it(`${fixture} [${mode.name}]`, () => {
                const data = loadFixture(fixture);
                // The fixture's own "?" stand-ins are foci too (their card is drawn then)
                const standIns = (Object.keys(data.persons) as PersonId[]).filter(id => data.persons[id].isPlaceholder);
                normalizeSingleParents(data);
                const before = JSON.stringify(data);
                const ids = (Object.keys(data.persons) as PersonId[]).filter(id => !data.persons[id].isPlaceholder);
                const foci = [...ids, ...standIns.filter(id => data.persons[id])];
                const config: LayoutConfig = mode.heights
                    ? { ...DEFAULT_LAYOUT_CONFIG, spouseLineY: 25, personHeights: syntheticPersonHeights(ids) }
                    : DEFAULT_LAYOUT_CONFIG;
                const failures: string[] = [];
                const noSiblings = new Set<PersonId>();
                for (const depth of DEPTHS) for (const focus of foci) {
                    const base = layout(data, focus, config, depth, mode.autoExpand);
                    const inBase = (id: PersonId) => base.positions.has(id);
                    // Every drawn card, a "?" stand-in's too: the renderer offers the tab on any
                    for (const pid of base.positions.keys()) {
                        const person = data.persons[pid];
                        if (!person) continue;
                        // The renderer's decision: the tab is offered, these children promised
                        if (!hiddenRelativesTabs(data, pid, inBase, noSiblings).includes('children')) continue;
                        const promised = hiddenChildIds(data, pid, inBase);
                        const visibleBefore = new Set(person.childIds.filter(inBase));
                        const planned = plan(data, focus, config, depth, mode.autoExpand, [pid]);
                        const r = planned.result;
                        const where = `${focus} d${depth} shows ${pid}`;
                        // Ancestors folded for the shown children: gone from the view, the person stays
                        for (const [q, by] of planned.foldedFor) {
                            if (by !== pid) failures.push(`${where}: ${q} folded for ${by}`);
                            if (!r.positions.has(q)) failures.push(`${where}: folded ${q} left the view`);
                            const drawnParents = (data.persons[q]?.parentIds ?? []).filter(id => r.positions.has(id));
                            if (drawnParents.length) failures.push(`${where}: folded ${q} keeps parents ${drawnParents.join(',')}`);
                        }
                        try { assertValidPositions(r.positions); } catch (e) { failures.push(`${where} Positions: ${(e as Error).message.split('\n')[0]}`); }
                        try { assertNoNodeOverlap(r.positions, config.cardWidth, config.cardHeight); } catch (e) { failures.push(`${where} Overlap: ${(e as Error).message.split('\n')[0]}`); }
                        if (!r.diagnostics.validationPassed) for (const err of r.diagnostics.errors.slice(0, 3)) failures.push(`${where} Validation: ${err}`);
                        for (const v of auditGeometry(r, config).slice(0, 3)) failures.push(`${where} Geometry: [${v.type}] ${v.detail}`);
                        if (mode.heights) for (const v of auditBands(r, config).slice(0, 3)) failures.push(`${where} Bands: ${v}`);
                        // The person stays drawn; their children are drawn
                        if (!r.positions.has(pid)) failures.push(`${where}: the person left the view`);
                        const missing = promised.filter(c => !r.positions.has(c));
                        if (missing.length) failures.push(`${where}: children not drawn ${missing.join(',')}`);
                        // The children shown are the promised ones: none drawn before the click
                        const named = newlyShownChildIds(data, pid, id => r.positions.has(id), visibleBefore);
                        if (named.join(',') !== promised.join(',')) failures.push(`${where}: shown ${named.join(',')} for promised ${promised.join(',')}`);
                        // Children drawn before stay drawn
                        const lost = [...visibleBefore].filter(c => !r.positions.has(c));
                        if (lost.length) failures.push(`${where}: children left the view ${lost.join(',')}`);
                        // In place: the children of each of the person's unions stand together in their row
                        const apart = foreignBetweenChildren(data, pid, r.positions);
                        if (apart.length) failures.push(`${where}: not beside each other, ${apart.slice(0, 3).join('; ')}`);
                    }
                }
                expect(failures.slice(0, 20), `${fixture} [${mode.name}], ${failures.length} failures`).toEqual([]);
                // Showing children never changes the tree's data
                expect(JSON.stringify(data)).toBe(before);
            }, 600_000);
        }
    }
});

/** Stem of the person's union lines to the nearest edge of the children's span (0: the stem is over the children). */
function stemToSpan(data: StromData, r: { positions: Map<PersonId, { x: number }>; connections: { stemX: number; drops: { personId: PersonId }[] }[] }, pid: PersonId, cw: number): number {
    let best = 0;
    for (const c of r.connections) {
        const kids = c.drops.map(d => d.personId).filter(id => r.positions.has(id));
        if (!kids.some(id => data.persons[id]?.parentIds.includes(pid))) continue;
        const xs = kids.map(id => r.positions.get(id)!.x);
        const lo = Math.min(...xs), hi = Math.max(...xs) + cw;
        best = Math.max(best, c.stemX < lo ? lo - c.stemX : c.stemX > hi ? c.stemX - hi : 0);
    }
    return best;
}

/** Empty room in the row between the person and each partner drawn in it (cards standing between them are not empty room). */
function partnerRoom(data: StromData, positions: Map<PersonId, { x: number; y: number }>, pid: PersonId, cw: number): number {
    const p = positions.get(pid);
    if (!p) return 0;
    let best = 0;
    for (const uid of data.persons[pid]?.partnerships ?? []) {
        const u = data.partnerships[uid];
        if (!u) continue;
        const q = positions.get(u.person1Id === pid ? u.person2Id : u.person1Id);
        if (!q || Math.abs(q.y - p.y) > 1) continue;
        const lo = Math.min(p.x, q.x), hi = Math.max(p.x, q.x);
        const between = [...positions.values()].filter(o => Math.abs(o.y - p.y) < 1 && o.x > lo && o.x < hi).map(o => o.x).sort((a, b) => a - b);
        let room = 0, at = lo + cw;
        for (const x of [...between, hi]) { room += Math.max(0, x - at); at = Math.max(at, x + cw); }
        best = Math.max(best, room);
    }
    return best;
}

/** The focus and every ancestor of the focus. */
function directLine(data: StromData, focus: PersonId): Set<PersonId> {
    const line = new Set<PersonId>([focus]);
    const todo = [focus];
    while (todo.length) {
        for (const p of data.persons[todo.pop()!]?.parentIds ?? []) {
            if (!line.has(p)) { line.add(p); todo.push(p); }
        }
    }
    return line;
}

describe('Children shown in place: two clicks deep, near their parents', () => {
    // A child the first click showed shows its own children. Both persons'
    // lines come down over (or within two card widths of) their children, and
    // each stands within two card widths of their partners: two card widths is
    // the rule the ancestor folding works to (planShownChildrenFolding, B2),
    // the room of one card plus the gaps around it. Depth 8 only (the deepest
    // view, every ancestor row in play); every person as focus.
    //
    // The distance checks cover children drawn in a row of the focus's
    // grandparents or above (generation -2 and up), the rows Phase B places:
    // there the children of an ancestor's sibling or of an ancestor's other
    // marriage are free to stand under their parents. Children in the rows of
    // the focus's parents and below sit in the rows Phase A locks around the
    // focus family, where the focus family's own subtree comes first (its
    // bus may not be overlapped), and children who are half-siblings of a
    // direct-line ancestor drawn in their row stand beside that ancestor as
    // its sibling run, so their distance is the direct line's (the ancestor
    // tree above it), not the click's. Children shown together in a row of
    // the focus's parents or below can still be split by the focus family
    // there (a known limit, docs/CURRENT.MD), so contiguity is checked in the
    // same rows as the distances; overlaps, validation, the geometry audit
    // and the bands are checked for every case.
    for (const fixture of FIXTURES) {
        for (const mode of MODES) {
            it(`${fixture} [${mode.name}]`, () => {
                const data = loadFixture(fixture);
                normalizeSingleParents(data);
                const ids = (Object.keys(data.persons) as PersonId[]).filter(id => !data.persons[id].isPlaceholder);
                const config: LayoutConfig = mode.heights
                    ? { ...DEFAULT_LAYOUT_CONFIG, spouseLineY: 25, personHeights: syntheticPersonHeights(ids) }
                    : DEFAULT_LAYOUT_CONFIG;
                const cw = config.cardWidth;
                const none = new Set<PersonId>();
                const failures: string[] = [];
                const genOf = (r: ReturnType<typeof layout>, id: PersonId) => {
                    const y = r.positions.get(id)?.y;
                    return y === undefined ? undefined : (r.bands ?? []).find(b => y >= b.top - 1 && y < b.top + b.height + 1)?.generation;
                };
                const deep = (r: ReturnType<typeof layout>, pid: PersonId) =>
                    (data.persons[pid]?.childIds ?? []).some(c => (genOf(r, c) ?? 0) <= -2);
                const near = (r: ReturnType<typeof layout>, shown: PersonId[], where: string, focus: PersonId) => {
                    const line = directLine(data, focus);
                    for (const pid of shown) {
                        if (!deep(r, pid)) continue;
                        const kids = (data.persons[pid]?.childIds ?? []).filter(c => r.positions.has(c));
                        const halfSiblingsOfLine = kids.some(c => data.persons[c].parentIds.some(par =>
                            par !== pid && data.persons[par]?.childIds.some(s => s !== c && line.has(s) && genOf(r, s) === genOf(r, c))));
                        if (halfSiblingsOfLine) continue;
                        const stem = stemToSpan(data, r, pid, cw);
                        if (stem > 2 * cw) failures.push(`${where}: ${pid}'s line ${(stem / cw).toFixed(1)} card widths from the children`);
                        const room = partnerRoom(data, r.positions, pid, cw);
                        if (room > 2 * cw) failures.push(`${where}: ${pid} ${(room / cw).toFixed(1)} card widths from a partner`);
                    }
                };
                for (const focus of ids) {
                    const base = layout(data, focus, config, 8, mode.autoExpand);
                    for (const first of base.positions.keys()) {
                        if (!data.persons[first]) continue;
                        if (!hiddenRelativesTabs(data, first, id => base.positions.has(id), none).includes('children')) continue;
                        const one = plan(data, focus, config, 8, mode.autoExpand, [first]).result;
                        near(one, [first], `${focus} shows ${first}`, focus);
                        const inOne = (id: PersonId) => one.positions.has(id);
                        for (const second of data.persons[first].childIds) {
                            if (base.positions.has(second) || !inOne(second)) continue;
                            if (!hiddenRelativesTabs(data, second, inOne, none, new Set([first])).includes('children')) continue;
                            const promised = hiddenChildIds(data, second, inOne);
                            const r = plan(data, focus, config, 8, mode.autoExpand, [first, second]).result;
                            const where = `${focus} shows ${first} > ${second}`;
                            try { assertNoNodeOverlap(r.positions, cw, config.cardHeight); } catch (e) { failures.push(`${where} Overlap: ${(e as Error).message.split('\n')[0]}`); }
                            if (!r.diagnostics.validationPassed) for (const err of r.diagnostics.errors.slice(0, 3)) failures.push(`${where} Validation: ${err}`);
                            for (const v of auditGeometry(r, config).slice(0, 3)) failures.push(`${where} Geometry: [${v.type}] ${v.detail}`);
                            if (mode.heights) for (const v of auditBands(r, config).slice(0, 3)) failures.push(`${where} Bands: ${v}`);
                            const missing = promised.filter(c => !r.positions.has(c));
                            if (missing.length) failures.push(`${where}: children not drawn ${missing.join(',')}`);
                            const apart = deep(r, second) ? foreignBetweenChildren(data, second, r.positions) : [];
                            if (apart.length) failures.push(`${where}: not beside each other, ${apart.slice(0, 3).join('; ')}`);
                            near(r, [first, second].filter(id => r.positions.has(id)), where, focus);
                        }
                    }
                }
                expect(failures.slice(0, 20), `${fixture} [${mode.name}], ${failures.length} failures`).toEqual([]);
            }, 600_000);
        }
    }
});

describe('Children shown in place: an ancestor\'s other marriage and an ancestor\'s brother', () => {
    // edge-ancestor-far-children: the focus's great-grandfather (fff) has a
    // second wife with two children, and his brother (bro) four children;
    // above them a wide ancestry. Before the fix the brother's children stood
    // a whole ancestor tree apart (spaced by the reserve for the ancestry
    // above their parents) and the second wife stood more than three card
    // widths off her husband, so the folding took his ancestors away.
    const FIX = 'edge-ancestor-far-children';
    const fixturePresent = existsSync(join(process.cwd(), 'test', `${FIX}.json`));
    for (const autoExpand of [false, true]) {
        const mode = autoExpand ? 'expanded' : 'standard';
        // From the focus the brother's children are in the great-grandparents'
        // row (Phase B); from the focus's father they are in his parents' row
        // (gen -1, placed and locked by Phase A).
        for (const focus of ['focus', 'f'] as PersonId[]) it.runIf(fixturePresent)(`the brother's children stand side by side under him, focus ${focus} [${mode}]`, () => {
            const data = loadFixture(FIX);
            const cw = DEFAULT_LAYOUT_CONFIG.cardWidth;
            const r = plan(data, focus, DEFAULT_LAYOUT_CONFIG, 8, autoExpand, ['ffff', 'bro'] as PersonId[]).result;
            const kids = data.persons['bro' as PersonId].childIds;
            const xs = kids.map(k => r.positions.get(k)!.x).sort((a, b) => a - b);
            const step = cw + DEFAULT_LAYOUT_CONFIG.horizontalGap;
            // Siblings next to each other: the span of n cards with one gap
            // between neighbours (a partner standing beside a child would add a
            // partner slot; these children have none).
            expect(xs[xs.length - 1] - xs[0]).toBeLessThanOrEqual((kids.length - 1) * step + 1);
            expect(foreignBetweenChildren(data, 'bro' as PersonId, r.positions)).toEqual([]);
            expect(stemToSpan(data, r, 'bro' as PersonId, cw)).toBeLessThanOrEqual(2 * cw);
        });
        it.runIf(fixturePresent)(`the second wife stands beside her husband, his ancestors stay [${mode}]`, () => {
            const data = loadFixture(FIX);
            const cw = DEFAULT_LAYOUT_CONFIG.cardWidth;
            const p = plan(data, 'focus' as PersonId, DEFAULT_LAYOUT_CONFIG, 8, autoExpand, ['fff'] as PersonId[]);
            const at = (id: string) => p.result.positions.get(id as PersonId);
            expect([...p.foldedFor.keys()]).toEqual([]);
            expect(at('ffff')).toBeDefined();
            expect(Math.abs(at('fff_w2')!.x - at('fff')!.x)).toBeLessThanOrEqual(cw + DEFAULT_LAYOUT_CONFIG.partnerGap + 1);
            expect(stemToSpan(data, p.result, 'fff_w2' as PersonId, cw)).toBeLessThanOrEqual(cw);
        });
    }
});

describe('Children shown in place: selection and hiding again', () => {
    const data = loadFixture('comprehensive');
    const P = (id: string) => id as PersonId;

    it('a grandfather shows his children (the father\'s siblings) and hides them again to the same layout', () => {
        // Focus a grandchild: the grandparents' other children stand two rows up
        const focus = P('grandchild_1');
        const base = layout(data, focus, DEFAULT_LAYOUT_CONFIG, 6, true);
        const gf = P('gp_h_h');
        const hidden = data.persons[gf].childIds.filter(c => !base.positions.has(c));
        expect(hidden.length).toBeGreaterThan(0);
        const shown = layout(data, focus, DEFAULT_LAYOUT_CONFIG, 6, true, [gf]);
        for (const c of data.persons[gf].childIds) expect(shown.positions.has(c), c).toBe(true);
        // The children's own partners and descendants stay out
        for (const c of hidden) {
            for (const gc of data.persons[c].childIds) if (!base.positions.has(gc)) expect(shown.positions.has(gc), gc).toBe(false);
        }
        expect(auditGeometry(shown, DEFAULT_LAYOUT_CONFIG)).toEqual([]);
        // Hiding: the same input as before, the same layout
        const again = layout(data, focus, DEFAULT_LAYOUT_CONFIG, 6, true, []);
        expect(JSON.stringify([...again.positions])).toBe(JSON.stringify([...base.positions]));
    });

    it('a father with two families in the standard mode shows the children of both, each under its own union', () => {
        const focus = P('focus');
        const base = layout(data, focus, DEFAULT_LAYOUT_CONFIG, 6, false);
        expect(base.positions.has(P('halfsibling_1'))).toBe(false);
        const shown = layout(data, focus, DEFAULT_LAYOUT_CONFIG, 6, false, [P('father')]);
        expect(shown.positions.has(P('halfsibling_1'))).toBe(true);
        expect(shown.positions.has(P('stepmother'))).toBe(true);
        // The half-sibling hangs on the father's union with the stepmother
        const conn = shown.connections.find(c => c.drops.some(d => d.personId === P('halfsibling_1')));
        expect(conn).toBeDefined();
        const union = Object.values(data.partnerships).find(u => u.childIds.includes(P('halfsibling_1')))!;
        expect([union.person1Id, union.person2Id].sort()).toEqual([P('father'), P('stepmother')].sort());
        expect(auditGeometry(shown, DEFAULT_LAYOUT_CONFIG)).toEqual([]);
    });

    it('a widow remarried twice beside the focus\'s second wife: every family\'s children drawn, each under its couple', () => {
        // adam (focus) is married to dana and to bea; bea also to cyril and
        // emil. Their partnership is folded for both (each primary
        // elsewhere): one chain union, so the two chains join into one.
        const web = loadFixture('edge-remarriage-web');
        const r = layout(web, P('adam'), DEFAULT_LAYOUT_CONFIG, 2, true);
        for (const c of ['k_ab1', 'k_ab2', 'k_ad1', 'k_cb1', 'k_eb1']) expect(r.positions.has(P(c)), c).toBe(true);
        for (const c of ['k_cb1', 'k_eb1', 'k_ab1']) {
            const conn = r.connections.filter(x => x.drops.some(d => d.personId === P(c)));
            expect(conn.length, c).toBe(1);
            // The line comes down from between the child's own parents
            const xs = web.persons[P(c)].parentIds.map(p => r.positions.get(p)!.x);
            const w = DEFAULT_LAYOUT_CONFIG.cardWidth;
            expect(conn[0].stemX, c).toBeGreaterThanOrEqual(Math.min(...xs) - w);
            expect(conn[0].stemX, c).toBeLessThanOrEqual(Math.max(...xs) + w);
        }
        expect(auditGeometry(r, DEFAULT_LAYOUT_CONFIG)).toEqual([]);
    });

    it('a marriage cascade: chains joined through a third person draw the shown children', () => {
        // b-c, c-d, d-e: d's chain meets c's on one union and c's meets b's on
        // another, so b's chain joins too and b's first family is drawn
        const cascade = loadFixture('edge-marriage-cascade');
        const base = layout(cascade, P('d'), DEFAULT_LAYOUT_CONFIG, 2, true);
        expect(base.positions.has(P('k_ab'))).toBe(false);
        const shown = layout(cascade, P('d'), DEFAULT_LAYOUT_CONFIG, 2, true, [P('b')]);
        for (const c of ['k_ab', 'k_bc', 'k_cd', 'k_de']) expect(shown.positions.has(P(c)), c).toBe(true);
        expect(auditGeometry(shown, DEFAULT_LAYOUT_CONFIG)).toEqual([]);
    });

    it('a great-great-grandfather with twelve hidden children shows them beside his direct-line child, under the couple', () => {
        // Six generations up the father's line; the shown siblings must not
        // land in the other half of the pedigree or under foreign cards
        const tree = loadFixture('edge-ancestor-children');
        for (const mode of [false, true]) {
            const focus = P('focus');
            const gf = P('f_m_f_m_f_f');
            const base = layout(tree, focus, DEFAULT_LAYOUT_CONFIG, 6, mode);
            const r = layout(tree, focus, DEFAULT_LAYOUT_CONFIG, 6, mode, [gf]);
            const kids = tree.persons[gf].childIds;
            expect(kids.length).toBe(13);
            for (const c of kids) expect(r.positions.has(c), c).toBe(true);
            assertNoNodeOverlap(r.positions, DEFAULT_LAYOUT_CONFIG.cardWidth, DEFAULT_LAYOUT_CONFIG.cardHeight);
            expect(auditGeometry(r, DEFAULT_LAYOUT_CONFIG)).toEqual([]);
            expect(foreignBetweenChildren(tree, gf, r.positions)).toEqual([]);
            // The couple stands over its children's span
            const xs = kids.map(c => r.positions.get(c)!.x);
            const couple = [gf, P('f_m_f_m_f_m')].map(p => r.positions.get(p)!.x);
            const mid = (Math.min(...couple) + Math.max(...couple)) / 2;
            expect(mid).toBeGreaterThan(Math.min(...xs));
            expect(mid).toBeLessThan(Math.max(...xs));
            // The direct-line child keeps its place relative to the focus row
            expect(r.positions.get(P('f_m_f_m_f'))!.y).toBe(base.positions.get(P('f_m_f_m_f'))!.y);
        }
    });

    it('a person out of the view is skipped', () => {
        const focus = P('focus');
        const base = layout(data, focus, DEFAULT_LAYOUT_CONFIG, 1, true);
        const far = (Object.keys(data.persons) as PersonId[]).find(id => !base.positions.has(id) && data.persons[id].childIds.length > 0)!;
        const shown = layout(data, focus, DEFAULT_LAYOUT_CONFIG, 1, true, [far]);
        expect(JSON.stringify([...shown.positions])).toBe(JSON.stringify([...base.positions]));
    });
});

describe('Children shown in place: inner siblings and folded ancestors', () => {
    const P = (id: string) => id as PersonId;
    const cw = DEFAULT_LAYOUT_CONFIG.cardWidth;
    const x = (r: { positions: Map<PersonId, { x: number }> }, id: string) => r.positions.get(P(id))!.x;
    /** Horizontal distance from the stem of the line to `child` to the child's card centre. */
    const stemToChild = (r: ReturnType<typeof layout>, child: string) => {
        const conn = r.connections.find(c => c.drops.some(d => d.personId === P(child)))!;
        return Math.abs(conn.stemX - (x(r, child) + cw / 2));
    };
    /** The layout's widest stem–children gap of the person's unions (0: the stem is above the children). */
    const spanGap = (data: StromData, r: ReturnType<typeof layout>, pid: PersonId) => {
        let best = 0;
        for (const c of r.connections) {
            const kids = c.drops.map(d => d.personId).filter(id => r.positions.has(id));
            if (!kids.some(id => data.persons[id]?.parentIds.includes(pid))) continue;
            const xs = kids.map(id => r.positions.get(id)!.x);
            const lo = Math.min(...xs), hi = Math.max(...xs) + cw;
            best = Math.max(best, c.stemX < lo ? lo - c.stemX : c.stemX > hi ? c.stemX - hi : 0);
        }
        return best;
    };
    const clean = (r: ReturnType<typeof layout>) => {
        assertNoNodeOverlap(r.positions, cw, DEFAULT_LAYOUT_CONFIG.cardHeight);
        expect(auditGeometry(r, DEFAULT_LAYOUT_CONFIG)).toEqual([]);
        expect(r.diagnostics.validationPassed).toBe(true);
    };

    it('C: a grandfather on the mother\'s side shows his children beyond the grandmother without parents, the couple stays over its child', () => {
        const tree = loadFixture('edge-ancestor-inner-siblings');
        for (const mode of [false, true]) {
            const planned = plan(tree, P('focus'), DEFAULT_LAYOUT_CONFIG, 4, mode, [P('m_f_f')]);
            const r = planned.result;
            // Row: Adrian, Evelyn, then his siblings (not between the halves of the pedigree)
            const row = ['m_f', 'm_m', 'm_f_s1', 'm_f_s2', 'm_f_s3'].map(id => x(r, id));
            expect(row).toEqual([...row].sort((a, b) => a - b));
            expect(x(r, 'f_m')).toBeLessThan(x(r, 'm_f'));
            expect(stemToChild(r, 'm')).toBeLessThanOrEqual(cw);
            expect(planned.foldedFor.size).toBe(0);
            expect(r.innerSiblingRuns).toEqual([{ personId: P('m_f'), partnerId: P('m_m'), besidePartner: true }]);
            expect(foreignBetweenChildren(tree, P('m_f_f'), r.positions)).toEqual([]);
            clean(r);
        }
    });

    it('B: a grandfather on the father\'s side folds the grandfather\'s parents; his children stand beyond, hiding them restores the layout', () => {
        const tree = loadFixture('edge-ancestor-inner-siblings');
        for (const mode of [false, true]) {
            const raw = layout(tree, P('focus'), DEFAULT_LAYOUT_CONFIG, 4, mode, [P('f_m_f')]);
            expect(raw.innerSiblingRuns).toEqual([{ personId: P('f_m'), partnerId: P('f_f'), besidePartner: false }]);
            const planned = plan(tree, P('focus'), DEFAULT_LAYOUT_CONFIG, 4, mode, [P('f_m_f')]);
            const r = planned.result;
            expect([...planned.foldedFor]).toEqual([[P('f_f'), P('f_m_f')]]);
            expect([...planned.foldedAncestorsOf]).toEqual([[P('f_m_f'), [P('f_f')]]]);
            expect(r.positions.has(P('f_f_f'))).toBe(false);
            expect(r.positions.has(P('f_f_m'))).toBe(false);
            const row = ['f_m_s1', 'f_m_s2', 'f_f', 'f_m'].map(id => x(r, id));
            expect(row).toEqual([...row].sort((a, b) => a - b));
            expect(stemToChild(r, 'f')).toBeLessThanOrEqual(cw);
            clean(r);
            // Closed again: the input without children shown gives the original layout
            const base = layout(tree, P('focus'), DEFAULT_LAYOUT_CONFIG, 4, mode);
            const closed = plan(tree, P('focus'), DEFAULT_LAYOUT_CONFIG, 4, mode);
            expect(JSON.stringify([...closed.result.positions])).toBe(JSON.stringify([...base.positions]));
            expect(closed.result.positions.has(P('f_f_f'))).toBe(true);
        }
    });

    it('B on the mother\'s side: the grandmother\'s parents fold for the grandfather\'s children', () => {
        const tree = loadFixture('edge-ancestor-inner-siblings');
        tree.persons[P('m_m_f')] = { ...tree.persons[P('m_f_f')], id: P('m_m_f'), firstName: 'Silas', lastName: 'Wren', partnerships: ['u_m_m_f_m' as never], childIds: [P('m_m')], birthDate: '1902-02-02' };
        tree.persons[P('m_m_m')] = { ...tree.persons[P('m_f_m')], id: P('m_m_m'), firstName: 'Odile', lastName: 'Wren', partnerships: ['u_m_m_f_m' as never], childIds: [P('m_m')], birthDate: '1905-05-05' };
        tree.partnerships['u_m_m_f_m' as never] = { ...tree.partnerships['u_m_f_f_m_f_m' as never], id: 'u_m_m_f_m' as never, person1Id: P('m_m_f'), person2Id: P('m_m_m'), childIds: [P('m_m')] };
        tree.persons[P('m_m')].parentIds = [P('m_m_f'), P('m_m_m')];
        for (const mode of [false, true]) {
            const raw = layout(tree, P('focus'), DEFAULT_LAYOUT_CONFIG, 4, mode, [P('m_f_f')]);
            expect(raw.innerSiblingRuns).toEqual([{ personId: P('m_f'), partnerId: P('m_m'), besidePartner: false }]);
            const planned = plan(tree, P('focus'), DEFAULT_LAYOUT_CONFIG, 4, mode, [P('m_f_f')]);
            const r = planned.result;
            expect([...planned.foldedFor]).toEqual([[P('m_m'), P('m_f_f')]]);
            expect(r.positions.has(P('m_m_f'))).toBe(false);
            expect(r.positions.has(P('m_m_m'))).toBe(false);
            const row = ['m_f', 'm_m', 'm_f_s1', 'm_f_s2', 'm_f_s3'].map(id => x(r, id));
            expect(row).toEqual([...row].sort((a, b) => a - b));
            expect(stemToChild(r, 'm')).toBeLessThanOrEqual(cw);
            clean(r);
            const closed = plan(tree, P('focus'), DEFAULT_LAYOUT_CONFIG, 4, mode);
            expect(closed.result.positions.has(P('m_m_f'))).toBe(true);
        }
    });

    it('a fold of ancestors the view reaches another way (pedigree collapse) folds nothing', () => {
        // Evelyn is a daughter of Horace and Rosalind too: they stay for Ann
        const tree = loadFixture('edge-ancestor-inner-siblings');
        tree.persons[P('m_m')].parentIds = [P('f_m_f'), P('f_m_m')];
        const u = tree.persons[P('f_m_f')].partnerships[0];
        tree.partnerships[u].childIds.push(P('m_m'));
        tree.persons[P('f_m_f')].childIds.push(P('m_m'));
        tree.persons[P('f_m_m')].childIds.push(P('m_m'));
        for (const mode of [false, true]) {
            const forced = layout(tree, P('focus'), DEFAULT_LAYOUT_CONFIG, 4, mode, [P('m_f_f')]);
            const folded = runLayoutPipeline({
                data: tree, focusPersonId: P('focus'), config: DEFAULT_LAYOUT_CONFIG, ancestorDepth: 4, descendantDepth: 4,
                includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true,
                displayPolicy: { mode: mode ? 'expanded' : 'standard', autoExpand: mode },
                expandChildrenOf: [P('m_f_f')], foldAncestorsOf: [P('m_m')],
            });
            expect(folded.positions.has(P('f_m_f'))).toBe(true);
            expect(folded.positions.has(P('f_m_m'))).toBe(true);
            expect(JSON.stringify([...folded.positions])).toBe(JSON.stringify([...forced.positions]));
            const planned = plan(tree, P('focus'), DEFAULT_LAYOUT_CONFIG, 4, mode, [P('m_f_f')]);
            expect(planned.foldedFor.size).toBe(0);
            expect(planned.result.positions.has(P('f_m_f'))).toBe(true);
            clean(planned.result);
        }
    });

    it('B2: a great-grandfather\'s line far from his children folds the ancestors standing in between', () => {
        const tree = loadFixture('edge-ancestor-span');
        normalizeSingleParents(tree);
        const pid = P('p_fff');
        for (const mode of [false, true]) {
            const raw = layout(tree, P('focus'), DEFAULT_LAYOUT_CONFIG, 8, mode, [pid]);
            expect(spanGap(tree, raw, pid)).toBeGreaterThan(2 * cw);
            const planned = plan(tree, P('focus'), DEFAULT_LAYOUT_CONFIG, 8, mode, [pid]);
            expect([...planned.foldedFor]).toEqual([[P('p_ffm'), pid]]);
            expect(spanGap(tree, planned.result, pid)).toBeLessThanOrEqual(2 * cw);
            for (const a of tree.persons[P('p_ffm')].parentIds) expect(planned.result.positions.has(a), a).toBe(false);
            clean(planned.result);
        }
    });

    it('B2: every children tab of the deep fixtures ends within two card widths, or nothing between the couple and the children can fold', () => {
        for (const fixture of ['edge-ancestor-span', 'edge-ancestor-children']) {
            const tree = loadFixture(fixture);
            normalizeSingleParents(tree);
            for (const mode of [false, true]) {
                const base = layout(tree, P('focus'), DEFAULT_LAYOUT_CONFIG, 8, mode);
                const visible = (id: PersonId) => base.positions.has(id);
                for (const pid of base.positions.keys()) {
                    if (!hiddenRelativesTabs(tree, pid, visible, new Set()).includes('children')) continue;
                    const planned = plan(tree, P('focus'), DEFAULT_LAYOUT_CONFIG, 8, mode, [pid]);
                    const gap = spanGap(tree, planned.result, pid);
                    if (gap <= 2 * cw) continue;
                    // Still far: no fold was kept for it, and folding both partners' ancestors does not help
                    expect(planned.foldedAncestorsOf.has(pid), `${fixture} ${pid}`).toBe(false);
                    const partners = tree.persons[pid].partnerships
                        .flatMap(u => [tree.partnerships[u].person1Id, tree.partnerships[u].person2Id])
                        .filter(id => id !== pid && planned.result.positions.has(id));
                    const all = runLayoutPipeline({
                        data: tree, focusPersonId: P('focus'), config: DEFAULT_LAYOUT_CONFIG, ancestorDepth: 8, descendantDepth: 8,
                        includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true,
                        displayPolicy: { mode: mode ? 'expanded' : 'standard', autoExpand: mode },
                        expandChildrenOf: [pid], foldAncestorsOf: [pid, ...partners],
                    });
                    expect(spanGap(tree, all, pid), `${fixture} ${pid}`).toBeGreaterThan(2 * cw);
                }
            }
        }
    });

    it('without children shown the plan is runLayoutPipeline\'s and a fold alone is ignored', () => {
        for (const fixture of ['comprehensive', 'edge-ancestor-inner-siblings', 'edge-ancestor-span']) {
            const tree = loadFixture(fixture);
            normalizeSingleParents(tree);
            const focus = P('focus');
            const base = layout(tree, focus, DEFAULT_LAYOUT_CONFIG, 4, true);
            const planned = plan(tree, focus, DEFAULT_LAYOUT_CONFIG, 4, true, [], { foldAncestorsOf: [P('f')] });
            expect(planned.foldedFor.size).toBe(0);
            expect(planned.foldedAncestorsOf.size).toBe(0);
            expect(JSON.stringify(planned.result)).toBe(JSON.stringify(base));
            const foldOnly = runLayoutPipeline({
                data: tree, focusPersonId: focus, config: DEFAULT_LAYOUT_CONFIG, ancestorDepth: 4, descendantDepth: 4,
                includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true,
                displayPolicy: { mode: 'expanded', autoExpand: true }, foldAncestorsOf: [focus, P('f'), P('m')],
            });
            expect(JSON.stringify(foldOnly)).toBe(JSON.stringify(base));
        }
    });
});

describe('Children shown in place: a grandparent\'s extra partner on the inner side', () => {
    const P = (id: string) => id as PersonId;
    const cw = DEFAULT_LAYOUT_CONFIG.cardWidth;
    const x = (r: { positions: Map<PersonId, { x: number }> }, id: string) => r.positions.get(P(id))!.x;

    it('the mother\'s father shows a child of his second wife (who stands left of him): it stands beyond the mother and her sisters, never on the father\'s card', () => {
        // Oswin's second wife Wanda stands on his left, above the focus's
        // father; her son Gero cannot come down under her. The mother's
        // sister Ilse is drawn elsewhere (her husband's family, left).
        const tree = loadFixture('edge-children-elsewhere-father');
        // The same with a sister in the mother's row (the full siblings come first)
        const withSister = loadFixture('edge-children-elsewhere-father');
        withSister.persons[P('aunt2')] = { ...withSister.persons[P('half_v')], id: P('aunt2'), firstName: 'Hedda', parentIds: [P('v_fa'), P('v_mo')], birthDate: '1955-02-14' };
        for (const id of ['v_fa', 'v_mo']) withSister.persons[P(id)].childIds.push(P('aunt2'));
        withSister.partnerships['u_v_fa_v_mo' as never].childIds.push(P('aunt2'));
        for (const [data, row] of [[tree, ['father', 'mother', 'half_v']], [withSister, ['father', 'mother', 'aunt2', 'half_v']]] as const) {
            for (const mode of [false, true]) for (const focus of ['focus', 'cousin']) {
                const r = plan(data, P(focus), DEFAULT_LAYOUT_CONFIG, 4, mode, [P('v_fa')]).result;
                const xs = row.map(id => x(r, id));
                expect(xs, `${focus} ${mode}`).toEqual([...xs].sort((a, b) => a - b));
                expect(foreignBetweenChildren(data, P('v_fa'), r.positions)).toEqual([]);
                assertNoNodeOverlap(r.positions, cw, DEFAULT_LAYOUT_CONFIG.cardHeight);
                expect(auditGeometry(r, DEFAULT_LAYOUT_CONFIG)).toEqual([]);
                expect(r.diagnostics.validationPassed).toBe(true);
                // Its line would cross the line to the mother: the cards link instead
                expect(r.omittedEdges?.some(e => e.childId === P('half_v'))).toBe(true);
            }
        }
    });
});
