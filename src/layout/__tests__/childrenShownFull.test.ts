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
import { hiddenRelativesTabs, hiddenChildIds, newlyShownChildIds, siblingsTabState, newlyShownSiblingIds, unionChildIdSet } from '../../marriage-order.js';

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

/**
 * Siblings shown in place (§1 of the siblings round): the card's "▸ siblings"
 * with a parent in view is one step that shows the children of the parents
 * in view (expandChildrenOf: [father, mother]). For every card the renderer
 * offers it on (siblingsTabState, with the drawn lines of the view), the
 * strict checks hold, every promised sibling is drawn, nothing drawn before
 * leaves, the siblings named after the click are exactly the promised ones,
 * and the tab turns to "▾ siblings".
 */
describe('Siblings shown in place: both parents in one step', () => {
    for (const fixture of FIXTURES) {
        for (const mode of MODES) {
            it(`${fixture} [${mode.name}]`, () => {
                const data = loadFixture(fixture);
                const standIns = (Object.keys(data.persons) as PersonId[]).filter(id => data.persons[id].isPlaceholder);
                normalizeSingleParents(data);
                const before = JSON.stringify(data);
                const ids = (Object.keys(data.persons) as PersonId[]).filter(id => !data.persons[id].isPlaceholder);
                const foci = [...ids, ...standIns.filter(id => data.persons[id])];
                const config: LayoutConfig = mode.heights
                    ? { ...DEFAULT_LAYOUT_CONFIG, spouseLineY: 25, personHeights: syntheticPersonHeights(ids) }
                    : DEFAULT_LAYOUT_CONFIG;
                const unionKids = unionChildIdSet(data);
                const failures: string[] = [];
                let checked = 0;
                for (const depth of DEPTHS) for (const focus of foci) {
                    const base = layout(data, focus, config, depth, mode.autoExpand);
                    const inBase = (id: PersonId) => base.positions.has(id);
                    const drops = new Set(base.connections.flatMap(c => c.drops.map(d => d.personId)));
                    for (const pid of base.positions.keys()) {
                        if (!data.persons[pid]) continue;
                        const tab = siblingsTabState(data, pid, inBase, unionKids, new Set(), new Set(), { hangsOnLine: id => drops.has(id) });
                        if (tab?.kind !== 'siblingsHere') continue;
                        checked++;
                        const parents = tab.parents;
                        const visibleBefore = new Map(parents.map(q => [q, new Set(data.persons[q].childIds.filter(inBase))] as const));
                        const r = plan(data, focus, config, depth, mode.autoExpand, parents).result;
                        const where = `${focus} d${depth} shows the siblings of ${pid} (${parents.join('+')})`;
                        try { assertValidPositions(r.positions); } catch (e) { failures.push(`${where} Positions: ${(e as Error).message.split('\n')[0]}`); }
                        try { assertNoNodeOverlap(r.positions, config.cardWidth, config.cardHeight); } catch (e) { failures.push(`${where} Overlap: ${(e as Error).message.split('\n')[0]}`); }
                        if (!r.diagnostics.validationPassed) for (const err of r.diagnostics.errors.slice(0, 3)) failures.push(`${where} Validation: ${err}`);
                        for (const v of auditGeometry(r, config).slice(0, 3)) failures.push(`${where} Geometry: [${v.type}] ${v.detail}`);
                        if (mode.heights) for (const v of auditBands(r, config).slice(0, 3)) failures.push(`${where} Bands: ${v}`);
                        if (!r.positions.has(pid)) failures.push(`${where}: the person left the view`);
                        for (const q of parents) if (!r.positions.has(q)) failures.push(`${where}: the parent ${q} left the view`);
                        const missing = tab.promised.filter(c => !r.positions.has(c));
                        if (missing.length) failures.push(`${where}: siblings not drawn ${missing.join(',')}`);
                        const inR = (id: PersonId) => r.positions.has(id);
                        const named = newlyShownSiblingIds(data, pid, inR, new Set(parents), q => visibleBefore.get(q));
                        if ([...named].sort().join(',') !== [...tab.promised].sort().join(',')) failures.push(`${where}: shown ${named.join(',')} for promised ${tab.promised.join(',')}`);
                        for (const [q, seen] of visibleBefore) {
                            const lost = [...seen].filter(c => !inR(c));
                            if (lost.length) failures.push(`${where}: children of ${q} left the view ${lost.join(',')}`);
                            const apart = foreignBetweenChildren(data, q, r.positions);
                            if (apart.length) failures.push(`${where}: not beside each other, ${apart.slice(0, 3).join('; ')}`);
                        }
                        // The tab turns to "▾ siblings" (the same rule on the new view)
                        const rDrops = new Set(r.connections.flatMap(c => c.drops.map(d => d.personId)));
                        const after = siblingsTabState(data, pid, inR, unionKids, new Set(parents), new Set(),
                            { visibleBefore: q => visibleBefore.get(q), hangsOnLine: id => rDrops.has(id) });
                        if (after?.kind !== 'siblingsShown') failures.push(`${where}: the tab after the click is ${after?.kind ?? 'none'}`);
                    }
                }
                expect(failures.slice(0, 20), `${fixture} [${mode.name}], ${failures.length} failures of ${checked}`).toEqual([]);
                expect(JSON.stringify(data)).toBe(before);
            }, 600_000);
        }
    }
});

/**
 * Stem of the person's union lines to the nearest edge of the children's span
 * (0: the stem is over the children), as stemGapPastFamily measures it.
 */
function stemToSpan(data: StromData, r: { positions: Map<PersonId, { x: number }>; connections: { stemX: number; drops: { personId: PersonId }[] }[] }, pid: PersonId, cw: number): number {
    let best = 0;
    for (const c of r.connections) {
        const kids = c.drops.map(d => d.personId).filter(id => r.positions.has(id));
        if (!kids.some(id => data.persons[id]?.parentIds.includes(pid))) continue;
        best = Math.max(best, stemGapPastFamily(data, r.positions, pid, kids, c.stemX, cw));
    }
    return best;
}

/**
 * How far a union's stem stands from its children (`kids`, drawn): to the
 * nearest edge of their span, 0 over it. The person's other children stand
 * together under their parents (invariant 5), each family with its partners
 * and descendants as one piece (invariant 4), and a child's partner may stand
 * on the inner side (a couple's order follows gender, invariant 3): when such
 * cards stand between the stem and the children, their width is not the
 * stem's distance — what counts is the stem's distance to them plus theirs to
 * the children (the line passes over that family, which cannot stand
 * elsewhere). `own`: the children not counted as such a family (default:
 * the union's own).
 */
function stemGapPastFamily(data: StromData, positions: Map<PersonId, { x: number }>, pid: PersonId, kids: PersonId[], stemX: number, cw: number,
    own: PersonId[] = kids): number {
    const xs = kids.map(k => positions.get(k)!.x);
    const lo = Math.min(...xs), hi = Math.max(...xs) + cw;
    let gap = stemX < lo ? lo - stemX : stemX > hi ? stemX - hi : 0;
    if (gap === 0) return 0;
    const fam = new Set<PersonId>();
    const todo = (data.persons[pid].childIds as PersonId[]).filter(k => !own.includes(k));
    while (todo.length) {
        const k = todo.pop()!;
        if (fam.has(k)) continue;
        fam.add(k);
        todo.push(...(data.persons[k]?.childIds ?? []));
    }
    for (const k of [...fam, ...own]) for (const u of data.persons[k]?.partnerships ?? []) {
        const pp = data.partnerships[u];
        if (pp) for (const q of [pp.person1Id, pp.person2Id]) if (!own.includes(q)) fam.add(q);
    }
    const left = stemX < lo;
    const between = [...fam].map(id => positions.get(id)).filter((p): p is { x: number } => !!p)
        .filter(p => left ? p.x + cw > stemX && p.x + cw <= lo + 1 : p.x < stemX && p.x >= hi - 1);
    if (between.length > 0) {
        const near = left ? Math.min(...between.map(p => p.x)) : Math.max(...between.map(p => p.x + cw));
        const far = left ? Math.max(...between.map(p => p.x + cw)) : Math.min(...between.map(p => p.x));
        gap = Math.max(0, left ? near - stemX : stemX - near) + (left ? lo - far : far - hi);
    }
    return gap;
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

/**
 * A grandparent on the line whose other marriage's children (drawn in the
 * parents' row) stand further than two card widths from that marriage's line,
 * with the measured distance in card widths as the cap (it may not grow):
 * - eE_v4_hub, eNE_v4_hub: the line child's family stands locked under the
 *   hub and its partner (invariants 4 and 5); the children of the other
 *   marriages stand in the partners' order beside it (invariants 2 and 9),
 *   and the other partners stand next to the hub, so the farthest marriage's
 *   line comes down three to four card widths from its children.
 * - eG_father: the half-sibling's husband stands between her and the line
 *   (a couple's order follows gender, invariant 3), and the focus family
 *   keeps its gap.
 */
const KNOWN_HALF_SIBLING_STEMS: Partial<Record<string, number>> = {
    eE_v4_hub: 3.5,
    eNE_v4_hub: 4.1,
    eG_father: 2.4,
};

describe('Children shown in place: two clicks deep, near their parents', () => {
    // A child the first click showed shows its own children. Both persons'
    // lines come down over (or within two card widths of) their children, and
    // each stands within two card widths of their partners: two card widths is
    // the rule the ancestor folding works to (planShownChildrenFolding, B2),
    // the room of one card plus the gaps around it. Depth 8 only (the deepest
    // view, every ancestor row in play); every person as focus.
    //
    // A shown child with no children of its own drawn stands one gap from
    // the next card of its family in the row (a sibling or a sibling's
    // partner): Phase B packs a sibling run by the contour of each
    // sibling's drawn subtree (packSiblingRun), so a childless sibling does
    // not wait a whole children row away from her brother. This also holds
    // for the half-siblings of a direct-line ancestor.
    //
    // The distance checks cover children drawn in a row of the focus's
    // grandparents or above (generation -2 and up), the rows Phase B places:
    // there the children of an ancestor's sibling or of an ancestor's other
    // marriage are free to stand under their parents. They also cover a
    // sibling of an ancestor in the grandparents' row whose children are
    // drawn in the parents' row: the children move up to the focus family
    // before Phase A locks them (pullAncestorSiblingChildren) and the sibling
    // stands over them in its run (packSiblingRun, pinned members), unless
    // a child is also the parent of someone drawn in the focus's row (a
    // cousin marriage: the child stands over that grandchild). Children in the rows of
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
                const deep = (r: ReturnType<typeof layout>, pid: PersonId, line: Set<PersonId>) => {
                    const kids = (data.persons[pid]?.childIds ?? []).filter(c => r.positions.has(c));
                    if (kids.some(c => (genOf(r, c) ?? 0) <= -2)) return true;
                    return !line.has(pid) && (genOf(r, pid) ?? 0) === -2 && kids.length > 0
                        && kids.every(c => !(data.persons[c]?.childIds ?? []).some(g => r.positions.has(g)));
                };
                const near = (r: ReturnType<typeof layout>, shown: PersonId[], where: string, focus: PersonId) => {
                    const line = directLine(data, focus);
                    for (const pid of shown) {
                        if (line.has(pid) && genOf(r, pid) === -2) {
                            // A grandparent on the line: the children of his or
                            // her other marriages, drawn in the parents' row,
                            // come up beside the line child before Phase A
                            // locks the row (pullAncestorSiblingChildren), and
                            // the other partner faces the line child's side
                            // (faceLineSiblings), so their line is drawn and
                            // comes down near them
                            const half = (data.persons[pid]?.childIds ?? []).filter(c => r.positions.has(c) && !line.has(c)
                                && genOf(r, c) === -1 && data.persons[c].parentIds.some(par => par !== pid && !line.has(par)));
                            if (half.length === 0) continue;
                            // (a child married to someone drawn here stands with
                            // that partner's family; her line can be dropped)
                            const lost = half.filter(c => r.omittedEdges?.some(e => e.childId === c)
                                && !(data.persons[c].partnerships ?? []).some(u => {
                                    const pp = data.partnerships[u];
                                    return !!pp && r.positions.has(pp.person1Id === c ? pp.person2Id : pp.person1Id);
                                }));
                            if (lost.length) failures.push(`${where}: ${pid}'s line to ${lost.join(',')} not drawn`);
                            for (const c of r.connections) {
                                const ks = c.drops.map(d => d.personId);
                                if (!ks.some(k => half.includes(k)) || ks.some(k => line.has(k))) continue;
                                // The line passes over the line child's full siblings
                                // and their families (stemGapPastFamily)
                                const gap = stemGapPastFamily(data, r.positions, pid, ks.filter(k => r.positions.has(k)), c.stemX, cw, half);
                                if (gap > (KNOWN_HALF_SIBLING_STEMS[pid] ?? 2) * cw) failures.push(`${where}: ${pid}'s line ${(gap / cw).toFixed(1)} card widths from the children of the other marriage`);
                            }
                            continue;
                        }
                        if (!deep(r, pid, line)) continue;
                        const kids = (data.persons[pid]?.childIds ?? []).filter(c => r.positions.has(c));
                        const halfSiblingsOfLine = kids.some(c => data.persons[c].parentIds.some(par =>
                            par !== pid && data.persons[par]?.childIds.some(s => s !== c && line.has(s) && genOf(r, s) === genOf(r, c))));
                        // A child with no children of its own drawn stands right
                        // beside the next card of its family in the row (a
                        // sibling or a sibling's partner), not a children row away
                        const family = new Set<PersonId>(kids);
                        for (const k of kids) for (const ku of data.persons[k]?.partnerships ?? []) {
                            const u = data.partnerships[ku];
                            if (u) { family.add(u.person1Id); family.add(u.person2Id); }
                        }
                        for (const k of kids) {
                            if ((genOf(r, k) ?? 0) > -2 || (data.persons[k]?.childIds ?? []).some(c => r.positions.has(c))) continue;
                            const at = r.positions.get(k)!;
                            const row = [...r.positions].filter(([, p]) => Math.abs(p.y - at.y) < 1).sort((a, b) => a[1].x - b[1].x);
                            const i = row.findIndex(([id]) => id === k);
                            const gaps = [row[i - 1], row[i + 1]]
                                .filter((e): e is [PersonId, { x: number; y: number }] => !!e && family.has(e[0]))
                                .map(([, p]) => Math.abs(p.x - at.x) - cw);
                            const step = Math.max(config.horizontalGap, config.partnerGap) + 1;
                            if (gaps.length > 0 && Math.min(...gaps) > step) failures.push(`${where}: ${k} ${(Math.min(...gaps) / cw).toFixed(1)} card widths from its family's next card`);
                        }
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
                        // Every card the first click brought: a child, and a child's
                        // partner (the step brings the partner itself; its own
                        // "▸ children" draws them as the child's does)
                        const brought = [...one.positions.keys()].filter(id => !base.positions.has(id) && data.persons[id]);
                        for (const second of brought) {
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
                            const apart = deep(r, second, directLine(data, focus)) ? foreignBetweenChildren(data, second, r.positions) : [];
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
        // The great-grandfather's elder sister (eld, childless) stands beyond
        // the brother, whose six children reach farther out than his couple.
        // Packed by block widths she stood a whole children row off the
        // brother's card, and the parents were centred on the run's widest
        // row rather than over their children.
        it.runIf(fixturePresent)(`a childless sibling stands next to her brother's card, the parents over their children [${mode}]`, () => {
            const data = loadFixture(FIX);
            const cw = DEFAULT_LAYOUT_CONFIG.cardWidth;
            const r = plan(data, 'focus' as PersonId, DEFAULT_LAYOUT_CONFIG, 8, autoExpand, ['ffff', 'bro'] as PersonId[]).result;
            const x = (id: string) => r.positions.get(id as PersonId)!.x;
            // card left edges: eld | bro bro_w ... fff
            expect(x('bro') - (x('eld') + cw)).toBeLessThanOrEqual(DEFAULT_LAYOUT_CONFIG.horizontalGap + 1);
            // The parents over the middle of their children's cards, measured
            // with the great-great-grandparents in the top row: with their
            // ancestry drawn, each couple's branches keep to their own side
            // and may hold the parents off the middle (in expanded mode the
            // great-great-grandmother's parents' tree has to fit between her
            // card and the great-grandfather's right edge).
            const top = plan(data, 'focus' as PersonId, DEFAULT_LAYOUT_CONFIG, 4, autoExpand, ['ffff', 'bro'] as PersonId[]).result;
            const tx = (id: string) => top.positions.get(id as PersonId)!.x;
            const kids = data.persons['ffff' as PersonId].childIds.map(k => tx(k));
            const middle = (Math.min(...kids) + Math.max(...kids) + cw) / 2;
            const parents = (tx('ffff') + tx('fffm') + cw) / 2;
            expect(Math.abs(parents - middle)).toBeLessThanOrEqual(1);
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

describe('Children shown in place: a great-uncle\'s children in the parents\' row', () => {
    // etalon-stress-all: the focus's great-grandparents (eNC_dad, eNC_mom)
    // show their twelve children; eNC_kid1 then shows his two children, who
    // are drawn in the row of the focus's parents (gen -1, locked by Phase A).
    // Step 5 left them between the two halves of the pedigree or far beyond
    // the focus family; eNC_kid1 then either stood a dozen card widths off
    // them or was pushed out of his sibling run, his line to them dropped.
    // Now the children stand beside the focus family on the side his run
    // takes, and he stands over them as one of the run.
    const FIX = 'etalon-stress-all';
    const fixturePresent = existsSync(join(process.cwd(), 'test', `${FIX}.json`));
    for (const autoExpand of [false, true]) {
        const mode = autoExpand ? 'expanded' : 'standard';
        for (const focus of ['eN_bridge_kid0', 'eN_bridge_kid1'] as PersonId[]) it.runIf(fixturePresent)(`eNC_kid1 stands over his children in his sibling run, focus ${focus} [${mode}]`, () => {
            const data = loadFixture(FIX);
            normalizeSingleParents(data);
            const cfg = DEFAULT_LAYOUT_CONFIG;
            const cw = cfg.cardWidth;
            const r = plan(data, focus, cfg, 8, autoExpand, ['eNC_dad', 'eNC_kid1'] as PersonId[]).result;
            expect((r.omittedEdges ?? []).map(e => e.childId)).toEqual([]);
            expect(stemToSpan(data, r, 'eNC_kid1' as PersonId, cw)).toBeLessThanOrEqual(cw);
            // His couple within one card width of the next sibling's card (he
            // stands over his children, so up to half a card more than a gap)
            const at = r.positions.get('eNC_kid1' as PersonId)!;
            const row = [...r.positions].filter(([, p]) => Math.abs(p.y - at.y) < 1).sort((a, b) => a[1].x - b[1].x);
            const siblings = new Set(data.persons['eNC_dad' as PersonId].childIds);
            const i = row.findIndex(([id]) => id === 'eNC_kid1');
            const own = new Set<PersonId>(['eNC_kid1' as PersonId, 'eNC_kid1_sp' as PersonId]);
            let lo = i; while (lo > 0 && own.has(row[lo - 1][0])) lo--;
            let hi = i; while (hi < row.length - 1 && own.has(row[hi + 1][0])) hi++;
            const gaps = [row[lo - 1], row[hi + 1]]
                .filter((e): e is [PersonId, { x: number; y: number }] => !!e && siblings.has(e[0]))
                .map(([, p]) => p.x < row[lo][1].x ? row[lo][1].x - (p.x + cw) : p.x - (row[hi][1].x + cw));
            expect(gaps.length).toBeGreaterThan(0);
            expect(Math.min(...gaps)).toBeLessThanOrEqual(cw);
        });
    }
});

describe('Children shown in place: a great-aunt\'s two marriages in the parents\' row', () => {
    // edge-shown-chain-cousins: the focus's great-grandparents show their
    // children; the grandmother's sisters a2 and a3 each stand in the
    // expanded display between two husbands (a chain: first husband, wife,
    // second husband), each marriage with one child. A second click on a
    // husband (or the wife) shows that marriage's child in the row of the
    // focus's parents (gen -1, locked by Phase A). The child was pulled up to
    // the focus's parents, but the second husband's line comes down two and a
    // half cards out from the chain's inner edge: 2.2 card widths off the
    // child. The child now stops where the chain, standing beside the
    // grandmother, has its line over it, and the chain stands there by its
    // lines, not by its middle.
    const FIX = 'edge-shown-chain-cousins';
    const P = (id: string) => id as PersonId;
    const cfg = DEFAULT_LAYOUT_CONFIG;
    const cw = cfg.cardWidth;
    for (const focus of ['focus', 'sib']) for (const second of ['a2h1', 'a2h2', 'a2', 'a3h1', 'a3h2', 'a3']) {
        it(`${second}'s line comes down over the child, the chain beside the grandmother, focus ${focus}`, () => {
            const data = loadFixture(FIX);
            normalizeSingleParents(data);
            const r = plan(data, P(focus), cfg, 8, true, [P('ggf'), P(second)]).result;
            const wife = second.slice(0, 2);
            const kids = data.persons[P(wife)].childIds.filter(c => data.persons[c].parentIds.includes(P(second)));
            for (const k of kids) expect(r.positions.has(k)).toBe(true);
            expect(stemToSpan(data, r, P(second), cw)).toBeLessThanOrEqual(cfg.horizontalGap);
            // The chain right beside the grandmother's card in her row
            const gm = r.positions.get(P('gm'))!;
            const chain = [`${wife}h1`, `${wife}h2`, wife].map(id => r.positions.get(P(id))!.x);
            expect(Math.min(...chain) - (gm.x + cw)).toBeLessThanOrEqual(cfg.horizontalGap + 1);
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

    it('a shown son\'s wife shows her own children (a nested click on a card the first click brought), in both displays', () => {
        // edge-shown-child-family: g5's "▸ children" brings his son s4a with
        // his wife s4aw1; her "▸ children" then shows their two children
        const family = loadFixture('edge-shown-child-family');
        for (const autoExpand of [true, false]) {
            const first = layout(family, P('focus'), DEFAULT_LAYOUT_CONFIG, 6, autoExpand, [P('g5')]);
            expect(first.positions.has(P('s4aw1'))).toBe(true);
            for (const c of ['s4a1', 's4a2']) expect(first.positions.has(P(c)), c).toBe(false);
            const nested = layout(family, P('focus'), DEFAULT_LAYOUT_CONFIG, 6, autoExpand, [P('g5'), P('s4aw1')]);
            for (const c of ['s4a1', 's4a2']) expect(nested.positions.has(P(c)), `${c} ${autoExpand}`).toBe(true);
            // The other marriage's children stay behind her husband's own tab
            for (const c of ['s4a3', 's4a4']) expect(nested.positions.has(P(c)), c).toBe(false);
            expect(auditGeometry(nested, DEFAULT_LAYOUT_CONFIG)).toEqual([]);
            // Hiding: the first click's layout again
            const again = layout(family, P('focus'), DEFAULT_LAYOUT_CONFIG, 6, autoExpand, [P('g5')]);
            expect(JSON.stringify([...again.positions])).toBe(JSON.stringify([...first.positions]));
        }
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

    it('the mother\'s father shows a child of his second wife: it stands beyond the mother and her sisters, never on the father\'s card, with his mother beyond Trudel over him', () => {
        // Oswin's second wife Wanda stood on his left (a man's other partners
        // stand left of him), above the focus's father: her son Gero could not
        // come down under her and his line was dropped. She now stands beyond
        // Trudel, on the side of the mother's siblings, over her son. The
        // mother's sister Ilse is drawn elsewhere (her husband's family, left).
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
                expect(r.omittedEdges?.some(e => e.childId === P('half_v')) ?? false).toBe(false);
                expect(x(r, 'v_w2')).toBeGreaterThan(x(r, 'v_mo'));
                expect(Math.abs(x(r, 'v_w2') - x(r, 'half_v')), `${focus} ${mode}`).toBeLessThanOrEqual(cw + DEFAULT_LAYOUT_CONFIG.horizontalGap);
            }
        }
    });

    it('a great-grandfather with four wives shows his children: the other wives stand on his daughter\'s side, each over her child, every line drawn', () => {
        // Hub's line child K3 is a wife whose husband has parents in view, so
        // her siblings stand to her right. Hub's other wives stood on his left
        // (a man's other partners stand left of him) and the lines down to
        // their children ran across the line to K3: all three were dropped.
        // The other wives now stand to the right of K3's mother, nearest
        // first, each over her own child (faceLineSiblings).
        const data = loadFixture('etalon-stress-all');
        normalizeSingleParents(data);
        for (const mode of [false, true]) for (const depth of [4, 8]) {
            const r = plan(data, P('eN_bridge_kid1'), DEFAULT_LAYOUT_CONFIG, depth, mode, [P('eNE_v4_hub')]).result;
            const where = `${mode} d${depth}`;
            expect(r.omittedEdges ?? [], where).toEqual([]);
            expect(['eNE_v4_hub', 'eNE_v4_p3', 'eNE_v4_p0', 'eNE_v4_p1', 'eNE_v4_p2'].map(id => x(r, id)), where)
                .toEqual(['eNE_v4_hub', 'eNE_v4_p3', 'eNE_v4_p0', 'eNE_v4_p1', 'eNE_v4_p2'].map(id => x(r, id)).sort((a, b) => a - b));
            for (const i of [0, 1, 2]) {
                expect(Math.abs(x(r, `eNE_v4_p${i}`) - x(r, `eNE_v4_k${i}`)), `${where} p${i}`).toBeLessThanOrEqual(cw + DEFAULT_LAYOUT_CONFIG.horizontalGap);
            }
            assertNoNodeOverlap(r.positions, cw, DEFAULT_LAYOUT_CONFIG.cardHeight);
            expect(auditGeometry(r, DEFAULT_LAYOUT_CONFIG)).toEqual([]);
            expect(r.diagnostics.validationPassed).toBe(true);
        }
    });

    it('a great-grandmother with a second husband shows her children: he stands beyond her husband, on the side of her daughter\'s siblings, over his child', () => {
        // Grandmother Wendelgard is a wife whose husband Ottfried has no parents in
        // view (and, in the second tree, has no husband at all): her sisters
        // stand beyond Ottfried, on the father's side, left. Her mother Hilde's
        // second husband Xaver stood on Hilde's right (a woman's other
        // partners stand right of her), across the line down to Wendelgard; he now
        // stands on the left of the couple, over his son Kunibald.
        type Row = [id: string, first: string, gender: 'male' | 'female', born: string];
        const build = (withOttfried: boolean): StromData => {
            const persons: Record<string, unknown> = {};
            const partnerships: Record<string, unknown> = {};
            const rows: Row[] = [
                ['focus', 'Felix', 'male', '1990-01-01'], ['fa', 'Franz', 'male', '1960-01-01'], ['mo', 'Marta', 'female', '1962-01-01'],
                ['gf', 'Ottfried', 'male', '1930-01-01'], ['gm', 'Wendelgard', 'female', '1932-01-01'], ['sis', 'Selma', 'female', '1934-01-01'],
                ['ggf', 'Georg', 'male', '1900-01-01'], ['ggm', 'Hilde', 'female', '1905-01-01'], ['xav', 'Xaver', 'male', '1898-01-01'],
                ['kas', 'Kunibald', 'male', '1940-01-01'],
            ];
            for (const [id, first, gender, born] of rows) {
                if (id === 'gf' && !withOttfried) continue;
                persons[id] = { id, firstName: first, lastName: 'Ortner', gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], birthDate: born };
            }
            const union = (id: string, a: string | null, b: string, kids: string[]) => {
                partnerships[id] = { id, person1Id: a ?? b, person2Id: a ? b : undefined, childIds: kids, status: 'married' };
                for (const p of a ? [a, b] : [b]) {
                    (persons[p] as { partnerships: string[]; childIds: string[] }).partnerships.push(id);
                    (persons[p] as { childIds: string[] }).childIds.push(...kids);
                }
                for (const k of kids) (persons[k] as { parentIds: string[] }).parentIds.push(...(a ? [a, b] : [b]));
            };
            union('u_fa_mo', 'fa', 'mo', ['focus']);
            if (withOttfried) union('u_gf_gm', 'gf', 'gm', ['fa']);
            else {
                (persons.gm as { childIds: string[] }).childIds.push('fa');
                (persons.fa as { parentIds: string[] }).parentIds.push('gm');
            }
            union('u_ggf_ggm', 'ggf', 'ggm', ['gm', 'sis']);
            union('u_xav_ggm', 'xav', 'ggm', ['kas']);
            const data = { persons, partnerships } as unknown as StromData;
            normalizeSingleParents(data);
            return data;
        };
        for (const withOttfried of [true, false]) {
            const data = build(withOttfried);
            for (const mode of [false, true]) for (const depth of [4, 8]) {
                const r = plan(data, P('focus'), DEFAULT_LAYOUT_CONFIG, depth, mode, [P('ggm')]).result;
                const where = `${withOttfried ? 'couple' : 'lone'} ${mode} d${depth}`;
                expect(r.omittedEdges ?? [], where).toEqual([]);
                expect(x(r, 'xav'), where).toBeLessThan(x(r, 'ggf'));
                expect(x(r, 'ggf'), where).toBeLessThan(x(r, 'ggm'));
                expect(Math.abs(x(r, 'xav') - x(r, 'kas')), where).toBeLessThanOrEqual(cw + DEFAULT_LAYOUT_CONFIG.horizontalGap);
                assertNoNodeOverlap(r.positions, cw, DEFAULT_LAYOUT_CONFIG.cardHeight);
                expect(auditGeometry(r, DEFAULT_LAYOUT_CONFIG)).toEqual([]);
                expect(r.diagnostics.validationPassed).toBe(true);
            }
        }
    });
});

describe('Children shown in place: far families in the ancestors\' rows', () => {
    const P = (id: string) => id as PersonId;
    const cw = DEFAULT_LAYOUT_CONFIG.cardWidth;
    const gap = DEFAULT_LAYOUT_CONFIG.horizontalGap;
    const x = (r: { positions: Map<PersonId, { x: number }> }, id: string) => r.positions.get(P(id))!.x;
    /** Persons as "id gender born" ("?id gender" is a "?" stand-in), unions as "id father|- mother kids,...". */
    const tree = (people: string[], unions: string[]): StromData => {
        const persons: Record<string, unknown> = {};
        const partnerships: Record<string, unknown> = {};
        for (const line of people) {
            const [raw, gender, born] = line.split(' ');
            const stand = raw.startsWith('?');
            const id = stand ? raw.slice(1) : raw;
            persons[id] = stand
                ? { id, firstName: '?', lastName: '', gender, isPlaceholder: true, partnerships: [], parentIds: [], childIds: [] }
                : { id, firstName: id[0].toUpperCase() + id.slice(1), lastName: 'Ortner', gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], birthDate: born };
        }
        for (const line of unions) {
            const [id, a, b, kidList] = line.split(' ');
            const kids = kidList ? kidList.split(',') : [];
            const parents = a === '-' ? [b] : [a, b];
            partnerships[id] = { id, person1Id: parents[0], person2Id: parents[1], childIds: kids, status: 'married' };
            for (const p of parents) {
                (persons[p] as { partnerships: string[] }).partnerships.push(id);
                (persons[p] as { childIds: string[] }).childIds.push(...kids);
            }
            for (const k of kids) (persons[k] as { parentIds: string[] }).parentIds.push(...parents);
        }
        const data = { persons, partnerships } as unknown as StromData;
        normalizeSingleParents(data);
        return data;
    };
    const sound = (r: ReturnType<typeof plan>['result'], where: string) => {
        expect(r.omittedEdges ?? [], where).toEqual([]);
        assertNoNodeOverlap(r.positions, cw, DEFAULT_LAYOUT_CONFIG.cardHeight);
        expect(auditGeometry(r, DEFAULT_LAYOUT_CONFIG), where).toEqual([]);
        expect(r.diagnostics.validationPassed, where).toBe(true);
    };

    it('a grandmother with the children of a second marriage shown: her couple with the grandfather stays over their daughter, her parents over her', () => {
        // The grandmother's block holds both her marriages; the slot of her
        // ancestor tree widened for the four children of the second one, and
        // her couple with the grandfather stood at the slot's far end, four
        // card widths from their daughter (the mother).
        const data = tree(
            ['focus female 2008-01-01', 'sib male 2006-01-01', 'fa male 1978-01-01', 'mo female 1980-01-01', 'gf male 1949-01-01', 'gm female 1943-01-01',
                'ggf male 1915-01-01', 'ggm female 1918-01-01', 'h2 male 1938-01-01', 'k1 female 1962-01-01', 'k1s male 1960-01-01', 'k1a male 1985-01-01',
                'k1b female 1987-01-01', 'k2 male 1964-01-01', 'k2s female 1965-01-01', 'k2a male 1990-01-01', 'k2b female 1992-01-01', 'k2c male 1994-01-01',
                'k3 male 1966-01-01', 'k4 female 1968-01-01', 'k4s male 1966-02-01', 'k4a female 1993-01-01', 'k4b male 1995-01-01'],
            ['u_fa_mo fa mo sib,focus', 'u_gf_gm gf gm mo', 'u_ggf_ggm ggf ggm gm', 'u_h2_gm h2 gm k1,k2,k3,k4',
                'u_k1 k1s k1 k1a,k1b', 'u_k2 k2 k2s k2a,k2b,k2c', 'u_k4 k4s k4 k4a,k4b']);
        for (const mode of [false, true]) for (const depth of [4, 8]) {
            const r = plan(data, P('focus'), DEFAULT_LAYOUT_CONFIG, depth, mode, [P('gm')]).result;
            const where = `${mode} d${depth}`;
            const mid = (a: string, b: string) => (Math.min(x(r, a), x(r, b)) + Math.max(x(r, a), x(r, b)) + cw) / 2;
            expect(Math.abs(mid('gf', 'gm') - (x(r, 'mo') + cw / 2)), where).toBeLessThanOrEqual(cw);
            expect(Math.abs(mid('ggf', 'ggm') - (x(r, 'gm') + cw / 2)), where).toBeLessThanOrEqual(cw);
            sound(r, where);
        }
    });

    it('a great-aunt with a "?" family: her childless sister stands beside her, and the "?" child beside her other children', () => {
        // The grandmother is a wife whose husband has no parents: her sisters
        // stand on her husband's side. Oo's chain keeps a slot for the hidden
        // "?" partner; the slot counted as a card, and Qq stood a card away
        // from Oo. With the focus one generation lower, Oo's "?" daughter
        // stood apart from her half-siblings, under the empty slot.
        const data = tree(
            ['?qx male', 'baby male 2030-01-01', 'hb male 2003-01-01', 'focus female 2005-01-01', 'fa male 1975-01-01', 'mo female 1977-01-01', 'gpa male 1945-01-01',
                'gma female 1947-01-01', 'l1 male 1914-01-01', 'l2 female 1920-01-01', 'qq female 1945-01-01', 'qqs male 1943-01-01', 'qk male 1970-01-01',
                'oo female 1955-01-01', 'pp male 1950-06-01', 'o1 female 1975-03-01', 'o2 male 1977-01-01', 'o3 female 1996-01-01'],
            ['u_focus hb focus baby','u_fa_mo fa mo focus', 'u_gpa_gma gpa gma fa', 'u_l1_l2 l1 l2 qq,gma,oo', 'u_qq qqs qq qk',
                'u_pp_oo pp oo o1,o2', 'u_oo qx oo o3']);
        for (const focus of ['focus', 'baby']) for (const mode of [false, true]) for (const depth of [4, 8]) {
            const r = plan(data, P(focus), DEFAULT_LAYOUT_CONFIG, depth, mode, [P('l1'), P('oo')]).result;
            const where = `${focus} ${mode} d${depth}`;
            expect(x(r, 'oo') - x(r, 'qq') - cw, where).toBeLessThanOrEqual(gap + 1);
            if (focus === 'baby') expect(x(r, 'o1') - x(r, 'o3') - cw, where).toBeLessThanOrEqual(gap + 1);
            sound(r, where);
        }
    });

    it('a great-grandmother\'s second husband and then his daughter show their children: the daughter\'s children stand in the parents\' row beside the focus parents, never on the father\'s sister', () => {
        // Lia's children belong in the parents' row; their component reaches
        // the focus parents through the great-grandmother, and the pairwise
        // passes pushed it back and forth until it stood on the father's
        // sister Ada and her husband, with its lines dropped.
        const data = tree(
            ['focus male 1960-01-01', 'sib female 1962-01-01', 'fa male 1930-01-01', 'mo female 1932-01-01', 'gf male 1905-01-01', 'gm female 1907-01-01',
                'ggf1 male 1870-01-01', 'ggm female 1875-01-01', 'dd male 1872-01-01', 'gff male 1875-01-01', 'gfm female 1878-01-01',
                'ada female 1931-01-01', 'adah male 1929-01-01', 'a2 male 1934-01-01', 'a2w female 1935-01-01', 'a2k male 1960-06-01', 'a2k2 female 1962-02-01',
                'a2k3 male 1964-02-01', 'a3 male 1936-01-01', 'a3w female 1937-01-01', 'a3k female 1962-06-01', 'a3k2 male 1964-03-01', 'a3k3 female 1966-03-01',
                'a3k4 male 1968-03-01', 'a4 male 1938-01-01', 'a4w female 1940-01-01', 'a4k male 1965-01-01', 'a4k2 female 1967-01-01', 'a4k3 male 1969-01-01',
                'a4k4 female 1971-01-01', 'e1 male 1898-01-01', 'e2 female 1900-01-01', 'lia female 1902-01-01', 'e3 male 1904-01-01', 'e4 female 1906-01-01',
                'liah male 1900-06-01', 'ob male 1925-01-01', 'cz female 1927-01-01', 'g2 female 1909-01-01'],
            ['u_fa_mo fa mo focus,sib', 'u_gf_gm gf gm fa,ada,a2,a3,a4', 'u_gff gff gfm gf', 'u_ggm1 ggf1 ggm gm,g2', 'u_ggm2 dd ggm e1,e2,lia,e3,e4',
                'u_ada adah ada', 'u_a2 a2 a2w a2k,a2k2,a2k3', 'u_a3 a3 a3w a3k,a3k2,a3k3,a3k4', 'u_a4 a4 a4w a4k,a4k2,a4k3,a4k4', 'u_lia liah lia ob,cz']);
        // (The second husband is drawn in the expanded mode only.)
        for (const depth of [4, 8]) {
            const r = plan(data, P('focus'), DEFAULT_LAYOUT_CONFIG, depth, true, [P('dd'), P('lia')]).result;
            const where = `expanded d${depth}`;
            expect(r.positions.has(P('ob')) && r.positions.has(P('cz')), where).toBe(true);
            sound(r, where);
        }
    });
});
