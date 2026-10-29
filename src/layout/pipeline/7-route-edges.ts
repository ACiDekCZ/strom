/**
 * Step 7: Route Edges (Simple Bus Routing)
 *
 * Creates connection lines (polylines) using bus routing:
 * - Vertical stem from parent union center
 * - Horizontal bus at midpoint between generations
 * - Vertical drops to each child
 *
 * Key simplification: connectorY === branchY always (no staircase).
 * Edge crossings are prevented by Step 6 (no sibling family interleaving);
 * a child's line that still cannot be routed without crossing, running
 * along or touching lines of other families is not drawn at all
 * (omitUnroutableDrops): the cards link to each other instead.
 *
 * Also creates spouse lines between partners in unions.
 */

import { PersonId, LayoutConfig, spouseLineOffset, personCardHeight } from '../../types.js';
import { computeGenerationBands } from './bands.js';
import { findChainExtraPartner } from './6-constraints.js';
import { connectionSegments, layoutSegments, LineViolation, LINE_EPS, SegmentIndex } from './line-geometry.js';
import {
    FamilyBlockModel,
    LayoutModel,
    OmittedEdge,
    RouteEdgesInput,
    RoutedModel,
    Connection,
    ChildDrop,
    SpouseLine,
    UnionId,
    UnionNode,
    BranchModel
} from './types.js';

/**
 * Route all edges and create connections.
 */
export function routeEdges(input: RouteEdgesInput): RoutedModel {
    const { constrained, config } = input;
    const { placed } = constrained;
    const { measured, unionX, personX } = placed;
    const { genModel } = measured;
    const { model, unionGen } = genModel;

    const connections: Connection[] = [];
    const spouseLines: SpouseLine[] = [];

    // Band top and height of each generation (cards are top-aligned in it)
    const bands = computeGenerationBands(genModel, personX, config);

    // Build set of secondary chain union IDs (stem from card bottom, not spouse line)
    const secondaryChainUnions = new Set<UnionId>();
    for (const [, chain] of model.partnerChains) {
        const primaryUnionId = model.personToUnion.get(chain.sharedPersonId);
        for (const uid of chain.unionIds) {
            if (uid !== primaryUnionId) {
                secondaryChainUnions.add(uid);
            }
        }
    }

    // The partner whose card a secondary chain union's stem leaves: the
    // extra partner of the chain block, the same person whose centre the
    // union's X was taken from (6-constraints recomputePositions).
    const chainStemPerson = new Map<UnionId, PersonId>();
    const blocks = (measured as FamilyBlockModel).blocks;
    if (blocks) {
        for (const block of blocks.values()) {
            const chainInfo = block.chainInfo;
            if (!chainInfo) continue;
            const primaryUnionId = model.personToUnion.get(chainInfo.chainPersonId);
            for (const uid of chainInfo.unionIds) {
                if (uid === primaryUnionId) continue;
                const union = model.unions.get(uid);
                if (!union) continue;
                // No extra partner: the union's X is partnerA's centre there too
                chainStemPerson.set(uid, findChainExtraPartner(union, chainInfo, model) ?? union.partnerA);
            }
        }
    }

    // A union with a hidden "?" stand-in (T11): its children's line starts
    // at the bottom of the known parent's card, and no spouse line is drawn.
    const hidden = model.hiddenPersonIds;
    const knownParentOf = (union: UnionNode): PersonId | null => {
        if (!hidden || !union.partnerB) return null;
        if (hidden.has(union.partnerB)) return union.partnerA;
        if (hidden.has(union.partnerA)) return union.partnerB;
        return null;
    };

    // Create connections for each union with children. A secondary chain
    // union's stem comes down from its own spouse line, between the two
    // parents, like a primary couple's (issue #6): it is placed after the
    // other lines, clear of the ones already in that gap (chainStemOnLine).
    const created = new Map<UnionId, Connection>();
    const deferred: UnionId[] = [];
    const chainStemOnLine = new Set<UnionId>();
    for (const [unionId, union] of model.unions) {
        if (union.childIds.length === 0) continue;
        if (chainStemPerson.has(unionId) && union.partnerB && !knownParentOf(union)) {
            deferred.push(unionId);
            continue;
        }

        const connection = createConnection(
            unionId,
            union,
            model.personToUnion,
            unionGen,
            unionX,
            personX,
            bands,
            config,
            secondaryChainUnions.has(unionId),
            knownParentOf(union),
            chainStemPerson.get(unionId) ?? null
        );

        if (connection) created.set(unionId, connection);
    }
    for (const unionId of deferred) {
        const union = model.unions.get(unionId)!;
        const stemPerson = chainStemPerson.get(unionId)!;
        const lineX = chainStemOnSpouseLine(union, stemPerson, genModel.personGen, personX, unionGen, created.values(), config);
        const connection = lineX !== null
            ? createConnection(unionId, union, model.personToUnion, unionGen, unionX, personX, bands, config,
                false, null, null, lineX)
            : createConnection(unionId, union, model.personToUnion, unionGen, unionX, personX, bands, config,
                true, null, stemPerson);
        if (!connection) continue;
        if (lineX !== null) chainStemOnLine.add(unionId);
        created.set(unionId, connection);
    }
    // In the order of the unions (the lane allocation depends on it)
    for (const unionId of model.unions.keys()) {
        const connection = created.get(unionId);
        if (connection) connections.push(connection);
    }

    // Create spouse lines
    for (const [unionId, union] of model.unions) {
        if (!union.partnerB || knownParentOf(union)) continue;

        const spouseLine = createSpouseLine(
            unionId,
            union,
            personX,
            unionGen,
            bands.top,
            config
        );

        if (spouseLine) {
            spouseLines.push(spouseLine);
        }
    }

    // Spouse lines that overlap in X in one generation (a marriage chain:
    // the far partner's line runs over the same gap as the near one) are
    // fanned out so every marriage keeps its own visible line.
    fanOutSpouseLines(spouseLines);

    // A couple's stem starts on its own spouse line, wherever the fan-out
    // put it (single parents and a secondary chain union whose gap had no
    // room start at the card bottom and are left alone).
    const spouseLineY = new Map<UnionId, number>();
    for (const sl of spouseLines) spouseLineY.set(sl.unionId, sl.y);
    for (const conn of connections) {
        if (secondaryChainUnions.has(conn.unionId) && !chainStemOnLine.has(conn.unionId)) continue;
        if (conn.stemPersonId) continue;
        const y = spouseLineY.get(conn.unionId);
        if (y !== undefined && model.unions.get(conn.unionId)?.partnerB) conn.stemTopY = y;
    }

    // Resolve bus collisions via lane allocation (branch-aware)
    const branchModel = measured as BranchModel;
    const hasBranches = branchModel.branches && branchModel.branches.size > 0;
    // Lane 0 of every line (resolveBusCollisions moves a line's horizontal
    // runs down to its lane)
    const laneZeroY = new Map<Connection, number>(connections.map(c => [c, c.branchY]));
    resolveBusCollisions(connections, config, hasBranches ? branchModel : null);

    // Two lines whose lane order is contradictory (each must lie above the
    // other: a 2-cycle in the lane graph) or that a lane bump cannot separate
    // are left on one lane by resolveBusCollisions. Their runs then merge
    // (a collinear violation), so omitUnroutableDrops below leaves out a
    // drop of one of them; no two lines share a lane with overlapping runs
    // in the result.

    // Resolve elbow clearance violations (nudge drops away from near segments)
    resolveElbowClearance(connections, config);

    // Lines that still cross, run along or touch lines of other families are
    // not drawn (the cards link to each other); the lanes are then allocated
    // again without them.
    const omittedEdges = omitUnroutableDrops(connections, spouseLines, model, personX, input.focusPersonId, () => {
        for (const conn of connections) {
            const offset = conn.branchY - (laneZeroY.get(conn) ?? conn.branchY);
            if (offset === 0) continue;
            conn.branchY -= offset;
            conn.connectorY -= offset;
            conn.stemBottomY -= offset;
            for (const drop of conn.drops) drop.topY -= offset;
        }
        resolveBusCollisions(connections, config, hasBranches ? branchModel : null);
        resolveElbowClearance(connections, config);
    });

    return {
        constrained,
        connections,
        spouseLines,
        ...(omittedEdges.length > 0 ? { omittedEdges } : {})
    };
}

// ==================== LINES THAT CANNOT BE ROUTED ====================

// In the browser IS_TEST = false; in Vitest globalThis.__vitest_worker__ is set.
const IS_TEST = typeof (globalThis as Record<string, unknown>).__vitest_worker__ !== 'undefined';

/**
 * A line left out: one child's drop, or (childId null) the whole line with
 * all its drops, when no single drop clears a violation.
 */
interface OmitCandidate {
    conn: Connection;
    childId: PersonId | null;
}

interface ScoredOmission {
    c: OmitCandidate;
    score: number;
    onLine: boolean;
    dist: number;
    single: boolean;
}

/**
 * Leave out the child lines that cannot be drawn without crossing, running
 * along or touching (T-touch) lines of other families (line-geometry.ts).
 * No layout rule avoids these knots (an in-law column inside a sibling bus,
 * two cross-married families, half-siblings married into two branches, two
 * lines the lane allocation had to leave on one lane), so the line is not
 * drawn and the cards link to each other instead.
 *
 * Greedy and deterministic, one child's drop at a time: a drop of every line
 * in a violation is a candidate (a drop's own, or each drop of a line whose
 * stem, connector or bus is in it); its score is the number of violations
 * that disappear with it (the line's bus and connector recomputed from the
 * remaining drops, the whole line gone with its last drop). The pick:
 * a line off the focus's line (the focus, their ancestors and descendants)
 * whenever one helps, then the highest score, then the child farther from
 * the focus, a line with a single child, and the union and person ids. When
 * no drop off the focus's line helps on its own (a stem that touches a
 * foreign line stays as long as one drop is left), the whole line of an
 * involved family is a candidate too (the fewest drops on the focus's line,
 * then the fewest drops: a family of two loses its line before one of five).
 *
 * Every pick removes at least one violation more than it adds, so the loop
 * ends within as many rounds as there were violations, and with the whole
 * line as a candidate it ends clean whenever every violation involves a
 * parent-child line: there is no cap on the number of lines left out. Cards
 * never move; afterwards `relane` allocates the lanes again, kept only when
 * it adds no violation. Under Vitest a violation or a lane shared by two
 * overlapping lines left after this step throws; in the browser the built-in
 * validation reports it (validation.ts, the same line check).
 */
export function omitUnroutableDrops(
    connections: Connection[],
    spouseLines: SpouseLine[],
    model: LayoutModel,
    personX: Map<PersonId, number>,
    focusPersonId: PersonId | undefined,
    relane: () => void
): OmittedEdge[] {
    const check = () => {
        const index = new SegmentIndex(layoutSegments({ connections, spouseLines }));
        return { index, violations: index.violations() };
    };
    let { index, violations } = check();
    const omitted: OmittedEdge[] = [];
    const { line, distance } = violations.length > 0
        ? focusRelations(model, focusPersonId)
        : { line: new Set<PersonId>(), distance: new Map<PersonId, number>() };
    const initial = violations.length;
    for (let round = 0; round < initial && violations.length > 0; round++) {
        const pick = bestOmission(connections, index, violations, line, distance);
        if ((globalThis as unknown as { __OMIT_DEBUG?: boolean }).__OMIT_DEBUG) {
            console.log(`[omit] round ${round}: ${violations.length} violations`,
                violations.slice(0, 8).map(v => `${v.type} ${v.detail}`),
                pick ? `→ omit ${pick.conn.unionId} → ${pick.childId ?? 'whole line'}` : '→ nothing helps');
        }
        if (!pick) break;
        const { conn, childId } = pick;
        const union = model.unions.get(conn.unionId);
        const parentIds = union
            ? [union.partnerA, union.partnerB].filter((id): id is PersonId =>
                !!id && !model.hiddenPersonIds?.has(id) && personX.has(id))
            : [];
        for (const drop of conn.drops) {
            if (childId !== null && drop.personId !== childId) continue;
            omitted.push({
                unionId: conn.unionId,
                childId: drop.personId,
                parentIds,
                ...(conn.stemPersonId !== undefined ? { stemPersonId: conn.stemPersonId } : {})
            });
        }
        // In place: the lane bookkeeping (relane) knows the line by its object
        const rest = childId === null ? null : withoutDrop(conn, childId);
        if (rest) Object.assign(conn, rest); else connections.splice(connections.indexOf(conn), 1);
        ({ index, violations } = check());
    }

    if (omitted.length > 0) {
        // The lanes without the omitted lines (fewer lanes where they forced
        // some); kept only when they add no violation
        const before = violations.length;
        const saved = connections.map(cloneConnection);
        relane();
        violations = check().violations;
        if (violations.length > before) {
            connections.splice(0, connections.length, ...saved);
            violations = check().violations;
        }
    }

    if (IS_TEST) {
        const shared = sharedLaneOverlaps(connections);
        if (violations.length > 0 || shared.length > 0) {
            throw new Error(`Step 7 left ${violations.length} line violation(s) and ${shared.length} shared lane(s) after omitting ${omitted.length} line(s): ` +
                [...violations.slice(0, 5).map(v => `${v.type} ${v.detail}`), ...shared.slice(0, 5)].join('; '));
        }
    }
    return omitted;
}

/**
 * Two lines on one lane whose horizontal runs (connector + bus) overlap:
 * they would read as one line. None may be left after omitUnroutableDrops.
 */
export function sharedLaneOverlaps(connections: readonly Connection[]): string[] {
    const found: string[] = [];
    for (const c of detectBusCollisions(connections as Connection[])) {
        if (c.overlapX[1] - c.overlapX[0] <= LINE_EPS) continue;
        found.push(`${c.unionId1} and ${c.unionId2} share the lane at Y=${c.y.toFixed(0)} over X=[${c.overlapX[0].toFixed(0)},${c.overlapX[1].toFixed(0)}]`);
    }
    return found;
}

/** The candidate to leave out next, or null when none removes a violation. */
function bestOmission(
    connections: Connection[],
    index: SegmentIndex,
    violations: LineViolation[],
    focusLine: ReadonlySet<PersonId>,
    distance: ReadonlyMap<PersonId, number>
): OmitCandidate | null {
    const byUnion = new Map<string, Connection>();
    for (const conn of connections) byUnion.set(String(conn.unionId), conn);

    // Violations each line is in, and the candidates
    const involved = new Map<string, number>();
    const candidates = new Map<string, OmitCandidate>();
    const add = (conn: Connection, childId: PersonId) => {
        const key = `${conn.unionId}\u0000${childId}`;
        if (!candidates.has(key)) candidates.set(key, { conn, childId });
    };
    for (const v of violations) {
        const owners = new Set<string>();
        for (const seg of [v.a, v.b]) {
            if (seg.kind === 'spouse') continue;
            const conn = byUnion.get(seg.owner);
            if (!conn) continue;
            owners.add(seg.owner);
            if (seg.kind === 'drop' && seg.childId) add(conn, seg.childId);
            else for (const drop of conn.drops) add(conn, drop.personId);
        }
        for (const owner of owners) involved.set(owner, (involved.get(owner) ?? 0) + 1);
    }

    let best: ScoredOmission | null = null;
    for (const c of candidates.values()) {
        const owner = String(c.conn.unionId);
        const rest = withoutDrop(c.conn, c.childId!);
        let after = 0;
        if (rest) for (const seg of connectionSegments(rest)) after += index.countViolationsWith(seg, owner);
        const score = (involved.get(owner) ?? 0) - after;
        if (score <= 0) continue;
        const entry = {
            c, score,
            onLine: focusLine.has(c.childId!),
            dist: distance.get(c.childId!) ?? Number.MAX_SAFE_INTEGER,
            single: c.conn.drops.length === 1
        };
        if (!best || betterOmission(entry, best)) best = entry;
    }
    if (best && !best.onLine) return best.c;

    // No drop off the focus's line helps on its own: the whole line of an
    // involved family (all its violations go with it), the one with the
    // fewest drops on the focus's line, then the fewest drops, then the most
    // violations cleared, by union id. It is taken over a single drop on the
    // focus's line only when none of its own drops is on that line.
    let whole: { conn: Connection; onLine: number; drops: number; score: number } | null = null;
    for (const [owner, count] of involved) {
        const conn = byUnion.get(owner)!;
        if (conn.drops.length < 2) continue; // the same as its one drop
        const entry = { conn, onLine: conn.drops.filter(d => focusLine.has(d.personId)).length, drops: conn.drops.length, score: count };
        if (!whole || betterWholeLine(entry, whole)) whole = entry;
    }
    if (whole && (!best || whole.onLine === 0)) return { conn: whole.conn, childId: null };
    return best?.c ?? null;
}

function betterWholeLine(
    a: { conn: Connection; onLine: number; drops: number; score: number },
    b: { conn: Connection; onLine: number; drops: number; score: number }
): boolean {
    if (a.onLine !== b.onLine) return a.onLine < b.onLine;
    if (a.drops !== b.drops) return a.drops < b.drops;
    if (a.score !== b.score) return a.score > b.score;
    return String(a.conn.unionId) < String(b.conn.unionId);
}

function betterOmission(a: ScoredOmission, b: ScoredOmission): boolean {
    if (a.onLine !== b.onLine) return !a.onLine;
    if (a.score !== b.score) return a.score > b.score;
    if (a.dist !== b.dist) return a.dist > b.dist;
    if (a.single !== b.single) return a.single;
    const au = String(a.c.conn.unionId), bu = String(b.c.conn.unionId);
    if (au !== bu) return au < bu;
    return a.c.childId! < b.c.childId!;
}

/** A line without one child's drop (bus and connector from the rest), or null without drops. */
function withoutDrop(conn: Connection, childId: PersonId): Connection | null {
    const drops = conn.drops.filter(d => d.personId !== childId).map(d => ({ ...d }));
    if (drops.length === 0) return null;
    const branchLeftX = Math.min(...drops.map(d => d.x));
    const branchRightX = Math.max(...drops.map(d => d.x));
    const connectorToX = conn.stemX < branchLeftX ? branchLeftX
        : conn.stemX > branchRightX ? branchRightX : conn.stemX;
    return { ...conn, drops, branchLeftX, branchRightX, connectorFromX: conn.stemX, connectorToX };
}

function cloneConnection(conn: Connection): Connection {
    return { ...conn, drops: conn.drops.map(d => ({ ...d })) };
}

/**
 * The focus's line (the focus, their ancestors and descendants) and every
 * person's distance from the focus (steps over partners, parents, children
 * and siblings).
 */
function focusRelations(model: LayoutModel, focusPersonId: PersonId | undefined):
    { line: Set<PersonId>; distance: Map<PersonId, number> } {
    const line = new Set<PersonId>();
    const distance = new Map<PersonId, number>();
    if (!focusPersonId || !model.persons.has(focusPersonId)) return { line, distance };

    const unionsOf = new Map<PersonId, UnionNode[]>();
    for (const union of model.unions.values()) {
        for (const pid of [union.partnerA, union.partnerB]) {
            if (!pid) continue;
            const list = unionsOf.get(pid);
            if (list) list.push(union); else unionsOf.set(pid, [union]);
        }
    }
    const parentUnion = (pid: PersonId): UnionNode | undefined => {
        const uid = model.childToParentUnion.get(pid);
        return uid ? model.unions.get(uid) : undefined;
    };

    line.add(focusPersonId);
    const up: PersonId[] = [focusPersonId];
    while (up.length > 0) {
        const u = parentUnion(up.pop()!);
        if (!u) continue;
        for (const pid of [u.partnerA, u.partnerB]) {
            if (pid && !line.has(pid)) { line.add(pid); up.push(pid); }
        }
    }
    const down: PersonId[] = [focusPersonId];
    const seen = new Set<PersonId>(down);
    while (down.length > 0) {
        for (const u of unionsOf.get(down.pop()!) ?? []) {
            for (const cid of u.childIds) {
                if (seen.has(cid)) continue;
                seen.add(cid);
                line.add(cid);
                down.push(cid);
            }
        }
    }

    distance.set(focusPersonId, 0);
    const queue: PersonId[] = [focusPersonId];
    for (let head = 0; head < queue.length; head++) {
        const pid = queue[head];
        const d = distance.get(pid)!;
        const next: PersonId[] = [];
        for (const u of unionsOf.get(pid) ?? []) {
            if (u.partnerA) next.push(u.partnerA);
            if (u.partnerB) next.push(u.partnerB);
            next.push(...u.childIds);
        }
        const pu = parentUnion(pid);
        if (pu) {
            if (pu.partnerA) next.push(pu.partnerA);
            if (pu.partnerB) next.push(pu.partnerB);
            next.push(...pu.childIds);
        }
        for (const n of next) {
            if (distance.has(n)) continue;
            distance.set(n, d + 1);
            queue.push(n);
        }
    }
    return { line, distance };
}

/** Vertical distance between spouse lines that overlap in X (T14). */
export const SPOUSE_LINE_SPACING = 6;

/**
 * Fan out spouse lines that overlap in X at the same base Y.
 *
 * Overlap groups are the connected components of the overlap relation, so
 * the result does not depend on the order of the unions. Within a group
 * every line takes the lowest free track among the lines it overlaps,
 * shortest line first: the nearest partner's line stays lowest (a couple's
 * stem leaves it downward without crossing the longer lines above), and a
 * group only grows as tall as its deepest stack of overlapping lines. The
 * tracks are centred on the card centre line.
 */
function fanOutSpouseLines(lines: SpouseLine[]): void {
    const overlaps = (a: SpouseLine, b: SpouseLine) =>
        Math.abs(a.y - b.y) <= 1 && a.xMax > b.xMin && b.xMax > a.xMin;

    const seen = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
        if (seen.has(i)) continue;
        // Connected component of the overlap relation, starting at line i
        const group: number[] = [];
        const stack = [i];
        seen.add(i);
        while (stack.length > 0) {
            const k = stack.pop()!;
            group.push(k);
            for (let j = 0; j < lines.length; j++) {
                if (!seen.has(j) && overlaps(lines[k], lines[j])) {
                    seen.add(j);
                    stack.push(j);
                }
            }
        }
        if (group.length <= 1) continue;

        const baseY = lines[i].y;
        const ordered = group.map(k => lines[k]).sort((a, b) =>
            (a.xMax - a.xMin) - (b.xMax - b.xMin) || a.xMin - b.xMin || String(a.unionId).localeCompare(String(b.unionId)));
        const track = new Map<SpouseLine, number>();
        for (const line of ordered) {
            const used = new Set<number>();
            for (const [other, t] of track) {
                if (line.xMax > other.xMin && other.xMax > line.xMin) used.add(t);
            }
            let t = 0;
            while (used.has(t)) t++;
            track.set(line, t);
        }
        const maxTrack = Math.max(...track.values());
        for (const [line, t] of track) {
            // Track 0 is the lowest line (largest y)
            line.y = baseY + (maxTrack / 2 - t) * SPOUSE_LINE_SPACING;
        }
    }
}

/**
 * Create a connection from a union to its children.
 * Uses simple bus routing with connectorY === branchY (no staircase).
 */
function createConnection(
    unionId: UnionId,
    union: UnionNode,
    personToUnion: Map<PersonId, UnionId>,
    unionGen: Map<UnionId, number>,
    unionX: Map<UnionId, number>,
    personX: Map<PersonId, number>,
    bands: { top: Map<number, number>; height: Map<number, number> },
    config: Pick<LayoutConfig, 'cardWidth' | 'cardHeight' | 'verticalGap' | 'spouseLineY' | 'personHeights'>,
    isSecondaryChain: boolean = false,
    soloParentId: PersonId | null = null,
    chainStemPersonId: PersonId | null = null,
    stemXOnLine: number | null = null
): Connection | null {
    const soloParentX = soloParentId ? personX.get(soloParentId) : undefined;
    const parentCenterX = soloParentX !== undefined ? soloParentX + config.cardWidth / 2 : unionX.get(unionId);
    const parentGen = unionGen.get(unionId);

    if (parentCenterX === undefined || parentGen === undefined) {
        return null;
    }

    const parentY = bands.top.get(parentGen);
    const parentBandHeight = bands.height.get(parentGen);
    if (parentY === undefined || parentBandHeight === undefined) {
        return null;
    }

    // Get child unions that are at higher generation (descendants)
    const childUnionIds = new Set<UnionId>();
    for (const childId of union.childIds) {
        const childUnionId = personToUnion.get(childId);
        if (childUnionId) {
            const childGen = unionGen.get(childUnionId);
            if (childGen !== undefined && childGen > parentGen) {
                childUnionIds.add(childUnionId);
            }
        }
    }

    if (childUnionIds.size === 0) {
        return null;
    }

    // Stem position (center of parent union, or a point on a secondary chain
    // union's spouse line, or extra partner center for a secondary chain
    // union without room there, or the known parent's center beside a
    // hidden stand-in)
    const stemX = stemXOnLine ?? parentCenterX;
    // Secondary chain unions without room on their spouse line: stem from the extra partner's card bottom
    // Standard two-partner unions: stem from spouse line level
    // Single-parent unions (and a hidden stand-in's): stem from the parent's card bottom
    let stemPersonId: PersonId | undefined;
    if (soloParentX !== undefined) stemPersonId = soloParentId!;
    else if (!union.partnerB) stemPersonId = union.partnerA;
    else if (isSecondaryChain) stemPersonId = chainStemPersonId ?? undefined;
    const fromCardBottom = isSecondaryChain || stemPersonId !== undefined;
    let stemTopY: number;
    if (stemPersonId !== undefined) {
        stemTopY = parentY + personCardHeight(config, stemPersonId);
    } else if (fromCardBottom) {
        // A chain union outside a chain block: the stem stands between the
        // two cards, below the taller one
        stemTopY = parentY + Math.max(
            personCardHeight(config, union.partnerA), personCardHeight(config, union.partnerB!));
    } else {
        stemTopY = parentY + spouseLineOffset(config);
    }

    // Child Y (next generation down): the top of the child band, where
    // every child card has its top
    const childGen = parentGen + 1;
    const childY = bands.top.get(childGen);
    if (childY === undefined) {
        return null;
    }

    // Bus Y is midpoint between the parent band's bottom (its tallest card)
    // and the child band's top
    const parentBottomY = parentY + parentBandHeight;
    const branchY = (parentBottomY + childY) / 2;

    // Create drops for each child
    const drops: ChildDrop[] = [];

    for (const childId of union.childIds) {
        const childUnionId = personToUnion.get(childId);
        if (!childUnionId || !childUnionIds.has(childUnionId)) continue;

        const childX = personX.get(childId);
        if (childX === undefined) continue;

        const dropX = childX + config.cardWidth / 2;

        drops.push({
            personId: childId,
            x: dropX,
            topY: branchY,
            bottomY: childY
        });
    }

    if (drops.length === 0) {
        return null;
    }

    // A stem just beside the outermost drop would make a small step (stem →
    // a few px of bus → drop). When it is that close and still above the
    // child's card, the drop comes down in the stem's axis instead (T09).
    // A stem from a card's bottom (marriage chain partner, single parent) may
    // be further off: chain partners stand partnerGap apart but the children's
    // blocks horizontalGap apart, so a chain child sits a multiple of the
    // difference (13, 26, 39 px…) beside its parent; up to a quarter card the
    // drop still comes down in the stem's axis.
    // The same holds for a stem from a chain union's spouse line.
    alignNearDropToStem(drops, stemX, config.cardWidth,
        fromCardBottom || stemXOnLine !== null ? config.cardWidth * DROP_STEM_SNAP_CARD_BOTTOM : DROP_STEM_SNAP);

    // Bus extends from leftmost to rightmost child drop
    const branchLeftX = Math.min(...drops.map(d => d.x));
    const branchRightX = Math.max(...drops.map(d => d.x));

    // Connector: horizontal from stem to bus edge (SAME Y as bus!)
    let connectorFromX = stemX;
    let connectorToX = stemX;

    if (stemX < branchLeftX) {
        connectorToX = branchLeftX;
    } else if (stemX > branchRightX) {
        connectorToX = branchRightX;
    }

    return {
        unionId,
        stemX,
        stemTopY,
        stemBottomY: branchY,   // Stem goes directly to bus Y
        branchY,
        branchLeftX,
        branchRightX,
        connectorFromX,
        connectorToX,
        connectorY: branchY,    // SAME as branchY - no staircase
        drops,
        ...(stemPersonId !== undefined ? { stemPersonId } : {})
    };
}

/**
 * Where a secondary chain union's stem leaves its spouse line: in the gap
 * between the extra partner's card and the next card toward the other
 * partner (with the two partners side by side, the gap between them), in
 * the middle of it unless a line of another family of that generation runs
 * there (a wide subtree of the primary couple reaches under the gap) - then
 * in the middle of the free part nearest to the gap's middle, minEdgeClearance
 * from the other lines. Null when no part of the gap at least partnerGap
 * wide is free: the stem then leaves the extra partner's card bottom.
 */
function chainStemOnSpouseLine(
    union: UnionNode,
    extraPartner: PersonId,
    personGen: Map<PersonId, number>,
    personX: Map<PersonId, number>,
    unionGen: Map<UnionId, number>,
    others: Iterable<Connection>,
    config: Pick<LayoutConfig, 'cardWidth' | 'partnerGap' | 'minEdgeClearance'>
): number | null {
    const other = union.partnerA === extraPartner ? union.partnerB : union.partnerA;
    const xE = personX.get(extraPartner);
    const xO = other ? personX.get(other) : undefined;
    const gen = unionGen.get(union.id);
    if (xE === undefined || xO === undefined || gen === undefined || xE === xO) return null;

    const w = config.cardWidth;
    let gapLeft: number;
    let gapRight: number;
    if (xE > xO) {
        gapLeft = xO + w;
        gapRight = xE;
        for (const [pid, x] of personX) {
            if (personGen.get(pid) === gen && x > xO && x < xE) gapLeft = Math.max(gapLeft, x + w);
        }
    } else {
        gapLeft = xE + w;
        gapRight = xO;
        for (const [pid, x] of personX) {
            if (personGen.get(pid) === gen && x > xE && x < xO) gapRight = Math.min(gapRight, x);
        }
    }
    if (gapRight - gapLeft < config.partnerGap) return null;

    // The parts of the gap the other lines of this generation leave free
    const taken: Array<[number, number]> = [];
    for (const conn of others) {
        if (unionGen.get(conn.unionId) !== gen) continue;
        const left = Math.min(conn.stemX, conn.branchLeftX, conn.connectorToX);
        const right = Math.max(conn.stemX, conn.branchRightX, conn.connectorToX);
        if (right + config.minEdgeClearance <= gapLeft || left - config.minEdgeClearance >= gapRight) continue;
        taken.push([left - config.minEdgeClearance, right + config.minEdgeClearance]);
    }
    taken.sort((a, b) => a[0] - b[0]);
    const free: Array<[number, number]> = [];
    let from = gapLeft;
    for (const [left, right] of taken) {
        if (left > from) free.push([from, Math.min(left, gapRight)]);
        from = Math.max(from, right);
        if (from >= gapRight) break;
    }
    if (from < gapRight) free.push([from, gapRight]);

    const middle = (gapLeft + gapRight) / 2;
    let best: number | null = null;
    for (const [left, right] of free) {
        if (right - left < config.partnerGap) continue;
        const x = (left + right) / 2;
        if (best === null || Math.abs(x - middle) < Math.abs(best - middle)) best = x;
    }
    return best;
}

/**
 * Create a spouse line between partners in a union.
 */
/** Largest stem/drop offset straightened instead of drawn as a step (px). */
export const DROP_STEM_SNAP = 12;
/** The same for a stem from a card's bottom, as a share of the card width. */
export const DROP_STEM_SNAP_CARD_BOTTOM = 0.25;
/** Snapped drop keeps this far from its card's side edges (rounded corners). */
const DROP_CARD_MARGIN = 16;

function alignNearDropToStem(drops: ChildDrop[], stemX: number, cardWidth: number, maxOffset: number): void {
    const xs = drops.map(d => d.x);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    if (stemX >= left && stemX <= right && drops.length > 1) return;  // stem meets the bus
    const outer = stemX < left
        ? drops.find(d => d.x === left)!
        : drops.find(d => d.x === right)!;
    const offset = Math.abs(stemX - outer.x);
    if (offset < 0.5 || offset > maxOffset) return;
    const cardLeft = outer.x - cardWidth / 2;
    if (stemX < cardLeft + DROP_CARD_MARGIN || stemX > cardLeft + cardWidth - DROP_CARD_MARGIN) return;
    outer.x = stemX;
}

function createSpouseLine(
    unionId: UnionId,
    union: UnionNode,
    personX: Map<PersonId, number>,
    unionGen: Map<UnionId, number>,
    genY: Map<number, number>,
    config: { cardWidth: number; cardHeight: number; spouseLineY?: number }
): SpouseLine | null {
    if (!union.partnerB) {
        return null;
    }

    const xA = personX.get(union.partnerA);
    const xB = personX.get(union.partnerB);
    const gen = unionGen.get(unionId);

    if (xA === undefined || xB === undefined || gen === undefined) {
        return null;
    }

    const y = genY.get(gen);
    if (y === undefined) {
        return null;
    }

    // The card's middle, or the header of a taller custom card (config.spouseLineY).
    const lineY = y + spouseLineOffset(config);
    // Use min/max to handle either partner ordering (chain blocks may reverse visual order)
    const leftX = Math.min(xA, xB);
    const rightX = Math.max(xA, xB);
    const xMin = leftX + config.cardWidth;
    const xMax = rightX;

    return {
        unionId,
        person1Id: union.partnerA,
        person2Id: union.partnerB,
        partnershipId: union.partnershipId,
        y: lineY,
        xMin,
        xMax
    };
}

// ==================== BUS COLLISION RESOLUTION ====================

/**
 * Resolve bus collisions via lane allocation.
 * When two buses are at the same Y level with overlapping X intervals,
 * offset the colliding bus to a different lane (small vertical offset).
 *
 * Checks ALL buses at the same Y level regardless of branch membership.
 * Branch corridors may not fully contain their buses (e.g., families with
 * widely-spread children), so cross-branch collision detection is needed.
 */
function resolveBusCollisions(
    connections: Connection[],
    config: { verticalGap: number },
    _branchModel: BranchModel | null
): void {
    if (connections.length < 2) return;

    const LANE_OFFSET = Math.min(8, config.verticalGap * 0.1);

    // Group connections by branchY only (check all buses at same Y)
    const byGroup = new Map<string, Connection[]>();
    for (const conn of connections) {
        const key = `${Math.round(conn.branchY)}`;
        if (!byGroup.has(key)) byGroup.set(key, []);
        byGroup.get(key)!.push(conn);
    }

    const EPS = 0.5;
    const MAX_LANES = 8;

    // Full horizontal footprint includes connector (stem to bus edge)
    const footprint = (conn: Connection): [number, number] => [
        Math.min(conn.stemX, conn.branchLeftX),
        Math.max(conn.stemX, conn.branchRightX)
    ];

    /**
     * Conflict test between two connections at candidate lanes.
     * Lane N sits N*LANE_OFFSET below lane 0. Considers:
     * - collinear horizontal overlap (same lane),
     * - a stem passing through a higher lane's horizontal run,
     * - drops passing through a lower lane's horizontal run.
     */
    const conflicts = (
        a: Connection, laneA: number,
        b: Connection, laneB: number
    ): boolean => {
        const [aLeft, aRight] = footprint(a);
        const [bLeft, bRight] = footprint(b);

        if (laneA === laneB) {
            // Same lane: any horizontal footprint overlap is a collision
            return aLeft <= bRight && aRight >= bLeft;
        }

        // Let hi = connection on the higher lane (smaller Y), lo = lower lane
        const [hi, hiL, hiR, lo, loL, loR] = laneA < laneB
            ? [a, aLeft, aRight, b, bLeft, bRight]
            : [b, bLeft, bRight, a, aLeft, aRight];

        // lo's stem extends DOWN through hi's lane Y: crossing if its X is
        // strictly inside hi's horizontal run
        if (lo.stemX > hiL + EPS && lo.stemX < hiR - EPS) return true;

        // hi's drops extend DOWN through lo's lane Y: crossing if a drop X is
        // strictly inside lo's horizontal run
        for (const drop of hi.drops) {
            if (drop.x > loL + EPS && drop.x < loR - EPS) return true;
        }

        return false;
    };

    for (const [, group] of byGroup) {
        if (group.length < 2) continue;

        // Sort by full left extent (including connector) for deterministic order
        group.sort((a, b) => Math.min(a.stemX, a.branchLeftX) - Math.min(b.stemX, b.branchLeftX));

        // Build ordering constraints between connections:
        //   "b ABOVE a" (lane(b) < lane(a)) is required when
        //     - b's stem X falls inside a's horizontal run (b's stem would
        //       otherwise pierce a's run), or
        //     - a's drop X falls inside b's horizontal run (a's drop pierces
        //       b's run whenever b is below a).
        // A cycle means a genuine topological knot: no lane order routes
        // both lines cleanly. Those pairs stay on one lane here, and the
        // merged run is a collinear violation that omitUnroutableDrops
        // resolves by leaving out a drop of one of them.
        const n = group.length;
        const above: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false));
        const inside = (x: number, left: number, right: number): boolean =>
            x > left + EPS && x < right - EPS;

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                const [jL, jR] = footprint(group[j]);
                // group[i]'s stem inside group[j]'s run → i must be above j
                // (otherwise i's stem, coming down from its cards, pierces j's run)
                if (inside(group[i].stemX, jL, jR)) above[i][j] = true;
                // group[j]'s drops inside group[i]'s run → i must be above j
                // (j's drops descend from j's lane; they pierce any run below it)
                for (const drop of group[j].drops) {
                    const [iL, iR] = footprint(group[i]);
                    if (inside(drop.x, iL, iR)) { above[i][j] = true; break; }
                }
            }
        }

        // Drop mutually-contradictory constraints (knots): keep neither (the
        // pair is left to omitUnroutableDrops)
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                if (above[i][j] && above[j][i]) {
                    above[i][j] = false;
                    above[j][i] = false;
                }
            }
        }

        // Longest-path lane assignment over the constraint DAG (cycles beyond
        // 2-node knots are broken by the iteration bound, lanes stop at
        // MAX_LANES; a line left crossing or sharing a lane that way is left
        // to omitUnroutableDrops)
        const lane = new Array<number>(n).fill(0);
        for (let pass = 0; pass < n; pass++) {
            let changed = false;
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) {
                    if (above[j][i] && lane[i] < lane[j] + 1) {
                        lane[i] = Math.min(lane[j] + 1, MAX_LANES);
                        changed = true;
                    }
                }
            }
            if (!changed) break;
        }

        // Same-lane horizontal overlaps (without ordering constraints between
        // them) get bumped to the next free lane that violates no constraint.
        for (let i = 0; i < n; i++) {
            let candidate = lane[i];
            let moved = true;
            let guard = 0;
            while (moved && guard++ <= MAX_LANES) {
                moved = false;
                for (let j = 0; j < i; j++) {
                    if (lane[j] !== candidate) continue;
                    if (conflicts(group[i], candidate, group[j], lane[j])) {
                        candidate++;
                        moved = true;
                        break;
                    }
                }
                // A bump must not push i below a connection that must be under it
                if (!moved) {
                    for (let j = 0; j < n; j++) {
                        if (above[i][j] && candidate >= lane[j]) {
                            // i must stay above j: bumping cannot separate
                            // them, i keeps its lane and the overlap is left
                            // to omitUnroutableDrops
                            candidate = lane[i];
                            moved = false;
                            break;
                        }
                    }
                }
            }
            lane[i] = Math.min(candidate, MAX_LANES);
        }

        for (let i = 0; i < n; i++) {
            if (lane[i] > 0) {
                const conn = group[i];
                const offset = lane[i] * LANE_OFFSET;
                conn.branchY += offset;
                conn.connectorY += offset;
                conn.stemBottomY += offset;
                for (const drop of conn.drops) {
                    drop.topY += offset;
                }
            }
        }
    }
}

/**
 * Detect bus collisions at the same Y level.
 * Returns pairs of connections whose buses overlap on X at the same Y.
 */
export function detectBusCollisions(
    connections: Connection[]
): Array<{ unionId1: UnionId; unionId2: UnionId; y: number; overlapX: [number, number] }> {
    const collisions: Array<{ unionId1: UnionId; unionId2: UnionId; y: number; overlapX: [number, number] }> = [];

    for (let i = 0; i < connections.length; i++) {
        for (let j = i + 1; j < connections.length; j++) {
            const a = connections[i];
            const b = connections[j];

            // Same Y level (within rounding tolerance)
            if (Math.abs(a.branchY - b.branchY) > 1) continue;

            // Check full footprint overlap (bus + connector)
            const aLeft = Math.min(a.stemX, a.branchLeftX);
            const aRight = Math.max(a.stemX, a.branchRightX);
            const bLeft = Math.min(b.stemX, b.branchLeftX);
            const bRight = Math.max(b.stemX, b.branchRightX);

            const overlapLeft = Math.max(aLeft, bLeft);
            const overlapRight = Math.min(aRight, bRight);

            if (overlapLeft < overlapRight) {
                collisions.push({
                    unionId1: a.unionId,
                    unionId2: b.unionId,
                    y: a.branchY,
                    overlapX: [overlapLeft, overlapRight]
                });
            }
        }
    }

    return collisions;
}

// ==================== ELBOW CLEARANCE RESOLUTION ====================

/**
 * An elbow point: where a vertical segment meets a horizontal segment in a connection.
 */
interface ElbowPoint {
    x: number;
    y: number;
    connectionIdx: number;
    type: 'stem-to-bus' | 'bus-to-drop';
}

/**
 * Extract all elbow points from connections.
 * Elbow = any point where a vertical segment meets a horizontal segment:
 * - Stem bottom (stemX, stemBottomY) — stem meets bus/connector
 * - Each drop top (drop.x, drop.topY) — drop meets bus
 */
function extractElbowPoints(connections: Connection[]): ElbowPoint[] {
    const elbows: ElbowPoint[] = [];

    for (let i = 0; i < connections.length; i++) {
        const conn = connections[i];

        // Stem-to-bus elbow (stem bottom meets the bus)
        elbows.push({
            x: conn.stemX,
            y: conn.stemBottomY,
            connectionIdx: i,
            type: 'stem-to-bus'
        });

        // Bus-to-drop elbows (each drop top meets bus)
        for (const drop of conn.drops) {
            elbows.push({
                x: drop.x,
                y: drop.topY,
                connectionIdx: i,
                type: 'bus-to-drop'
            });
        }
    }

    return elbows;
}

/**
 * A clearance violation between an elbow and a near vertical segment.
 */
interface ClearanceViolation {
    elbowIdx: number;
    nearConnectionIdx: number;
    nearSegmentType: 'stem' | 'drop' | 'bus-endpoint';
    distance: number;
    requiredShift: number;
    shiftDirection: number; // +1 or -1
}

/**
 * Detect clearance violations between elbow points and vertical segments
 * of other connections at the same Y range.
 */
function detectClearanceViolations(
    connections: Connection[],
    elbows: ElbowPoint[],
    minClearance: number
): ClearanceViolation[] {
    const violations: ClearanceViolation[] = [];

    for (let ei = 0; ei < elbows.length; ei++) {
        const elbow = elbows[ei];

        for (let ci = 0; ci < connections.length; ci++) {
            if (ci === elbow.connectionIdx) continue;

            const conn = connections[ci];

            // Check stem of other connection
            if (yRangesOverlap(conn.stemTopY, conn.stemBottomY, elbow.y)) {
                const dist = Math.abs(elbow.x - conn.stemX);
                if (dist < minClearance) {
                    violations.push({
                        elbowIdx: ei,
                        nearConnectionIdx: ci,
                        nearSegmentType: 'stem',
                        distance: dist,
                        requiredShift: minClearance - dist,
                        shiftDirection: elbow.x > conn.stemX ? 1 : -1
                    });
                }
            }

            // Check drops of other connection
            for (const drop of conn.drops) {
                if (yRangesOverlap(drop.topY, drop.bottomY, elbow.y)) {
                    const dist = Math.abs(elbow.x - drop.x);
                    if (dist < minClearance) {
                        violations.push({
                            elbowIdx: ei,
                            nearConnectionIdx: ci,
                            nearSegmentType: 'drop',
                            distance: dist,
                            requiredShift: minClearance - dist,
                            shiftDirection: elbow.x > drop.x ? 1 : -1
                        });
                    }
                }
            }

            // Check bus endpoints of other connection at same Y
            if (Math.abs(conn.branchY - elbow.y) < 1) {
                // Left endpoint
                const distLeft = Math.abs(elbow.x - conn.branchLeftX);
                if (distLeft < minClearance && distLeft > 0.5) {
                    violations.push({
                        elbowIdx: ei,
                        nearConnectionIdx: ci,
                        nearSegmentType: 'bus-endpoint',
                        distance: distLeft,
                        requiredShift: minClearance - distLeft,
                        shiftDirection: elbow.x > conn.branchLeftX ? 1 : -1
                    });
                }
                // Right endpoint
                const distRight = Math.abs(elbow.x - conn.branchRightX);
                if (distRight < minClearance && distRight > 0.5) {
                    violations.push({
                        elbowIdx: ei,
                        nearConnectionIdx: ci,
                        nearSegmentType: 'bus-endpoint',
                        distance: distRight,
                        requiredShift: minClearance - distRight,
                        shiftDirection: elbow.x > conn.branchRightX ? 1 : -1
                    });
                }
            }
        }
    }

    return violations;
}

/**
 * Check if a Y value falls within a vertical segment's Y range.
 */
function yRangesOverlap(segTopY: number, segBottomY: number, elbowY: number): boolean {
    const minY = Math.min(segTopY, segBottomY);
    const maxY = Math.max(segTopY, segBottomY);
    return elbowY >= minY - 1 && elbowY <= maxY + 1;
}

/**
 * Resolve elbow clearance violations by nudging drop X positions.
 * Only drops are nudged (not stems, which are tied to card centers).
 * Max nudge is capped at minEdgeClearance px to avoid excessive drift.
 */
function resolveElbowClearance(
    connections: Connection[],
    config: LayoutConfig
): void {
    const MAX_ITERATIONS = 5;
    const minClearance = config.minEdgeClearance;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        const elbows = extractElbowPoints(connections);
        const violations = detectClearanceViolations(connections, elbows, minClearance);

        if (violations.length === 0) break;

        let anyNudged = false;

        for (const violation of violations) {
            const elbow = elbows[violation.elbowIdx];

            // Only nudge drops (bus-to-drop elbows), not stems
            if (elbow.type !== 'bus-to-drop') continue;

            const conn = connections[elbow.connectionIdx];

            // Find the drop that matches this elbow
            const drop = conn.drops.find(d =>
                Math.abs(d.x - elbow.x) < 0.5 && Math.abs(d.topY - elbow.y) < 0.5
            );
            if (!drop) continue;

            // Cap nudge at minEdgeClearance
            const nudge = Math.min(violation.requiredShift, minClearance) * violation.shiftDirection;
            drop.x += nudge;

            // Update bus extents if the drop moved beyond current range
            conn.branchLeftX = Math.min(...conn.drops.map(d => d.x));
            conn.branchRightX = Math.max(...conn.drops.map(d => d.x));

            // Update connector if stem is outside bus range
            if (conn.stemX < conn.branchLeftX) {
                conn.connectorToX = conn.branchLeftX;
            } else if (conn.stemX > conn.branchRightX) {
                conn.connectorToX = conn.branchRightX;
            } else {
                conn.connectorToX = conn.stemX;
            }

            anyNudged = true;
        }

        if (!anyNudged) break;
    }
}

// ==================== STAIRCASE EDGE DETECTION ====================

/**
 * Staircase violation information.
 */
export interface StaircaseViolation {
    unionId: UnionId;
    horizontalSegmentCount: number;
    description: string;
}

/**
 * Detect staircase edges in the connections.
 * A staircase edge has connectorY !== branchY.
 */
export function detectStaircaseEdges(connections: Connection[]): StaircaseViolation[] {
    const violations: StaircaseViolation[] = [];

    for (const conn of connections) {
        const yLevels = new Set<number>();
        yLevels.add(Math.round(conn.branchY));

        const hasConnector = Math.abs(conn.connectorFromX - conn.connectorToX) > 0.5;
        if (hasConnector) {
            yLevels.add(Math.round(conn.connectorY));
        }

        if (yLevels.size > 1) {
            violations.push({
                unionId: conn.unionId,
                horizontalSegmentCount: yLevels.size,
                description: `Connection from union ${conn.unionId} has ${yLevels.size} horizontal segments at different Y levels. ` +
                    `connectorY=${conn.connectorY.toFixed(1)}, branchY=${conn.branchY.toFixed(1)}`
            });
        }
    }

    return violations;
}

/**
 * Check if any connections have staircase patterns.
 */
export function validateNoStaircaseEdges(connections: Connection[]): boolean {
    const violations = detectStaircaseEdges(connections);
    return violations.length === 0;
}
