/**
 * Children shown in place, two clicks deep (from childrenShownFull.test.ts,
 * which holds the rest of the harness and its description): a child the first
 * click showed shows its own children, near their parents, with the strict
 * checks of allPersonsFull.test.ts. A file of its own so the sweep runs beside
 * the others.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { loadFixture } from './helpers/loadFixture.js';
import { runLayoutPipeline } from '../pipeline/index.js';
import { assertNoNodeOverlap, assertValidPositions } from './helpers/assertions.js';
import { auditGeometry } from './helpers/geometryAudit.js';
import { auditBands, syntheticPersonHeights } from './helpers/bandAudit.js';
import { PersonId, LayoutConfig, DEFAULT_LAYOUT_CONFIG, StromData } from '../../types.js';
import { normalizeSingleParents } from '../../single-parent.js';
import { hiddenRelativesTabs, hiddenChildIds, newlyShownChildIds, siblingsTabState, newlyShownSiblingIds, unionChildIdSet } from '../../marriage-order.js';
import { DEPTHS, MODES, FIXTURES, layout, plan, foreignBetweenChildren, stemToSpan, stemGapPastFamily } from './helpers/childrenShown.js';

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
