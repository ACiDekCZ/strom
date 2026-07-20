/**
 * Splitting one tree into the families it contains (N4).
 *
 * INVARIANT #0 — the partition is a property of the DATA, not the vantage point.
 * The families are carved by walking the tree from a REFERENCE person chosen
 * deterministically from the data itself, never from the volatile UI focus. So
 * the same tree always yields the same families. The focus person only changes
 * PRESENTATION: which family is listed first (the one it belongs to), which row
 * is pre-highlighted, and which person the created tree opens on.
 *
 * WHAT counts as one family is the user's choice (SplitMode): surname LINES
 * ("rody" — one name up and down), or BRANCHES the way the tree grew (the
 * reference line plus each in-law branch). Both modes share the same carve
 * skeleton, folding rules and presentation.
 *
 * Reference person: the senior member (birthdate → id) of the tree's LARGEST
 * blood lineage — the biggest set of people joined by parent–child links,
 * counting real (non-placeholder) people. That is the tree's backbone; carving
 * the branches relative to it is stable and orientation-free.
 *
 * Each person lands in exactly one family — the first that reaches them (first
 * claim), so a cousin marriage does not duplicate anybody. A boundary person
 * (connector) stays a member of its own family but is ALSO added as a single
 * anchor card when the neighbouring family's tree is created — that shared card
 * lets the cross-tree badge link the two families. Placeholder-only groups fold
 * into the real family that owns them; no family is ever a run of unknown slots.
 */

import { PersonId, StromData } from './types.js';
import { selectSubgraph } from './layout/pipeline/1-select-subgraph.js';
import { sameSurname, surnameKey } from './surnames.js';

/**
 * How the tree is cut into families — both are focus-invariant (invariant #0):
 *
 * - 'surname': classic family LINES ("rody"). A child belongs to the line of
 *   the parent whose surname they carry (via sameSurname, so Víšková ↔ Víšek
 *   and grouped spellings count); the line follows that name up and down. A
 *   spouse who has no parents here and no children after their own name stays
 *   with their partner — anyone with a line of their own founds it.
 * - 'lineage': branches the way the tree grew — the reference line plus every
 *   in-law/ancestral branch hanging off it (children + spouses closure;
 *   parents root new branches).
 * - 'perspective': ONE PERSON'S view — deliberately the only cut that DEPENDS
 *   on chosen people (invariant #0 does not apply; that is its purpose). The
 *   base tree is the person's own line: direct ancestors, their blood siblings,
 *   own siblings and all descendants with spouses. Sibling FAMILIES stay in
 *   the base up to a configurable ancestor generation (first cousins by
 *   default) with per-sibling overrides; everything else falls into automatic
 *   neighbouring families connected through the boundary people.
 */
export type SplitMode = 'surname' | 'lineage' | 'perspective';

/** Configuration of the 'perspective' cut. */
export interface PerspectiveOptions {
    /** People whose view forms a base tree each, in claim order (first wins). */
    baseIds: PersonId[];
    /**
     * Sibling families stay in the base tree up to this ancestor generation:
     * 0 = own siblings only, 1 = parents' siblings too (first cousins visible),
     * 2 = grandparents' siblings too (second cousins).
     */
    cousinDepth: number;
    /** Per-sibling overrides: true = cut their family off, false = keep it. */
    cutOverrides?: ReadonlyMap<PersonId, boolean>;
}

/** One boundary sibling the 'perspective' cut can be tuned at. */
export interface PerspectiveCutCandidate {
    id: PersonId;
    /** 0 = own sibling, 1 = parent's sibling, 2 = grandparent's sibling… */
    generation: number;
    /** How many people their family (spouses + descendants) would take along. */
    familySize: number;
    /** Whether the current options keep that family in the base tree. */
    kept: boolean;
}

/** One proposed family: a disjoint slice of the tree with an entry person. */
export interface FamilyComponent {
    /** The person this family was grown from (its carve seed). */
    focusId: PersonId;
    /**
     * The boundary person that seeded this family, or null for the root one. It
     * belongs to the PARENT family; the tree-creation step adds it back as an
     * anchor so the cross-tree link can form. Never counted in `personIds`.
     */
    connectorId: PersonId | null;
    /** Persons this family owns — disjoint from every other family, sorted. */
    personIds: PersonId[];
    /** Person the new tree opens on (a member of personIds, or the connector). */
    defaultPersonId: PersonId;
    /**
     * The real person the family is named after — never a placeholder. The
     * family's own SENIOR member ("Rodina X" reads as the family founded by X),
     * tilted to the spouse carrying the family's dominant surname, so the
     * Krepčík family is named after František Krepčík, not his wife.
     */
    nameAnchorId: PersonId;
    /** True for the family that contains the UI focus (presentation only). */
    isFirst: boolean;
    /**
     * Presentation only: the BRIDGE person the viewer's focus walks through to
     * reach this family — the last person BEFORE stepping in (usually a member
     * of the viewer's own family, e.g. "napojeno přes Evu" for her parents'
     * family). Undefined for the focus's own family.
     */
    viaFromFocusId?: PersonId;
    /**
     * 'perspective' base tree: named after and opened on its chosen person
     * (never renamed to the senior — "Rodina Milana" is Milan's view, not his
     * great-grandfather's).
     */
    personal?: boolean;
}

/** Partners of a person across all their unions. */
function partnersOf(data: StromData, id: PersonId): PersonId[] {
    const p = data.persons[id];
    if (!p) return [];
    const out: PersonId[] = [];
    for (const uid of p.partnerships) {
        const u = data.partnerships[uid];
        if (!u) continue;
        out.push(u.person1Id === id ? u.person2Id : u.person1Id);
    }
    return out;
}

/** Siblings of a person (sharing at least one parent). */
function siblingsOf(data: StromData, id: PersonId): PersonId[] {
    const p = data.persons[id];
    if (!p) return [];
    const out = new Set<PersonId>();
    for (const parentId of p.parentIds) {
        const parent = data.persons[parentId];
        if (!parent) continue;
        for (const childId of parent.childIds) {
            if (childId !== id) out.add(childId);
        }
    }
    return [...out];
}

/** Every first-degree relative of a person that exists in the data. */
function relativesOf(data: StromData, id: PersonId): PersonId[] {
    const p = data.persons[id];
    if (!p) return [];
    return [...p.parentIds, ...p.childIds, ...siblingsOf(data, id), ...partnersOf(data, id)]
        .filter(r => data.persons[r]);
}

/** Deterministic order: birthdate, then id, so the split never wobbles. */
function sortIds(data: StromData, ids: PersonId[]): PersonId[] {
    return ids.slice().sort((a, b) => {
        const ba = data.persons[a]?.birthDate ?? '9999';
        const bb = data.persons[b]?.birthDate ?? '9999';
        if (ba !== bb) return ba < bb ? -1 : 1;
        return a < b ? -1 : a > b ? 1 : 0;
    });
}

function isReal(data: StromData, id: PersonId): boolean {
    const p = data.persons[id];
    return !!p && !p.isPlaceholder;
}

/**
 * The reference person the partition is carved from (invariant #0): the senior
 * member of the LARGEST blood lineage. Blood lineages are the connected groups
 * under parent–child links; the largest by real-person count is the tree's
 * backbone, and its oldest member (birthdate → id) is a stable, data-only seed.
 */
export function referenceLineageAnchor(data: StromData): PersonId {
    const all = Object.keys(data.persons) as PersonId[];
    // Blood-connected components under parent<->child edges.
    const seen = new Set<PersonId>();
    const componentOf = new Map<PersonId, PersonId[]>();
    for (const start of all) {
        if (seen.has(start)) continue;
        const comp: PersonId[] = [];
        const stack = [start];
        seen.add(start);
        while (stack.length) {
            const id = stack.pop()!;
            comp.push(id);
            const p = data.persons[id];
            for (const r of [...p.parentIds, ...p.childIds]) {
                if (data.persons[r] && !seen.has(r)) { seen.add(r); stack.push(r); }
            }
        }
        for (const m of comp) componentOf.set(m, comp);
    }
    // Pick the largest lineage by real-person count; tie → the one whose senior
    // person is older. Return that lineage's senior real person.
    let best: PersonId | null = null;
    let bestScore = -1;
    for (const start of sortIds(data, all)) {          // senior-first iteration
        if (!isReal(data, start)) continue;
        const comp = componentOf.get(start)!;
        const senior = sortIds(data, comp.filter(id => isReal(data, id)))[0];
        if (senior !== start) continue;                // count each lineage once, at its senior
        const score = comp.filter(id => isReal(data, id)).length;
        if (score > bestScore) { bestScore = score; best = start; }
    }
    return best ?? sortIds(data, all)[0];
}

/** Walk everyone connected to `start` among a set of still-uncovered persons. */
function walkIsland(data: StromData, start: PersonId, pool: Set<PersonId>): PersonId[] {
    const group: PersonId[] = [];
    const queue: PersonId[] = [start];
    const seen = new Set<PersonId>([start]);
    while (queue.length) {
        const id = queue.pop()!;
        group.push(id);
        for (const r of relativesOf(data, id)) {
            if (pool.has(r) && !seen.has(r)) {
                seen.add(r);
                queue.push(r);
            }
        }
    }
    return group;
}

/**
 * Break the whole tree into disjoint families.
 *
 * The partition is carved from the deterministic reference lineage (invariant
 * #0) and is identical whatever `focusId` is. `focusId` only decides which
 * family is listed first and which person its new tree opens on.
 */
export function decomposeIntoFamilies(
    data: StromData,
    focusId: PersonId,
    mode: SplitMode = 'surname',
    perspective?: PerspectiveOptions
): FamilyComponent[] {
    if (mode === 'perspective') return decomposePerspective(data, focusId, perspective);
    const rootSeed = referenceLineageAnchor(data);

    const covered = new Set<PersonId>();
    const components: FamilyComponent[] = [];
    const enqueued = new Set<PersonId>([rootSeed]);
    const queue: { root: PersonId; connector: PersonId | null }[] = [
        { root: rootSeed, connector: null },
    ];

    while (queue.length > 0) {
        const { root, connector } = queue.shift()!;
        const isRoot = components.length === 0;

        const claimedSet = new Set<PersonId>();
        const work: PersonId[] = [];
        const push = (id: PersonId): void => {
            if (data.persons[id] && !covered.has(id)) {
                covered.add(id);
                claimedSet.add(id);
                work.push(id);
            }
        };
        push(root);

        if (mode === 'surname') {
            // A family LINE ("rod"): everyone joined to the root by parent–child
            // links along ONE surname (sameSurname — feminine forms and grouped
            // spellings count), up to the founder and down to the last bearer.
            // A person with no surname stays with whichever line reaches them
            // first — an unnamed slot must not break a line in two. A spouse is
            // absorbed only when they have no line of their own here: no parents
            // in the data and no child after their own name. Antonín Krepčík
            // (no parents recorded, children named after him) FOUNDS the
            // Krepčík line; Zdena the childless in-law stays with her husband.
            const rodSurname = data.persons[root]?.lastName ?? '';
            const rodKey = surnameKey(rodSurname);
            // Placeholders count as unnamed even when a surname was guessed for
            // them (GEDCOM slots often inherit one) — an unknown person must
            // never break a line in two, nor found one.
            const isUnnamed = (id: PersonId): boolean => {
                const p = data.persons[id];
                return !!p && (!!p.isPlaceholder || !surnameKey(p.lastName ?? ''));
            };
            const inLine = (id: PersonId): boolean => {
                if (isUnnamed(id)) return true;
                return !!rodKey && sameSurname(data.persons[id]!.lastName!, rodSurname, data);
            };
            const foundsOwnLine = (sp: PersonId): boolean => {
                const p = data.persons[sp]!;
                if (isUnnamed(sp)) return false;
                if (p.parentIds.some(x => !!data.persons[x])) return true;
                const n = p.lastName ?? '';
                if (!surnameKey(n)) return false;
                return p.childIds.some(ch =>
                    data.persons[ch] && sameSurname(data.persons[ch]!.lastName ?? '', n, data));
            };
            while (work.length > 0) {
                const id = work.shift()!;
                const p = data.persons[id];
                for (const ch of sortIds(data, p.childIds.filter(x => !!data.persons[x]))) {
                    if (inLine(ch)) push(ch);
                }
                for (const par of sortIds(data, p.parentIds.filter(x => !!data.persons[x]))) {
                    if (inLine(par)) push(par);
                }
                // Same-name SIBLINGS belong to the line even when the shared
                // parent is written differently (Víšek brothers under a father
                // registered as Výsek) — the parent stays free to found the
                // differently-written line; grouping the spellings in the
                // surname register merges the two lines into one.
                for (const sib of sortIds(data, siblingsOf(data, id).filter(x => !!data.persons[x]))) {
                    if (inLine(sib)) push(sib);
                }
                for (const sp of sortIds(data, partnersOf(data, id))) {
                    if (!foundsOwnLine(sp)) push(sp);
                }
            }
        } else {
            // 'lineage' branches: the root, every blood DESCENDANT, the spouses
            // who married in, and those spouses' children from any union —
            // closed under "descendants + direct spouse", never depth-limited.
            // (A depth-limited "view" here was the bug that spilled great-
            // grandchildren into the next family and drew previews full of
            // parentless islands.) A member's PARENTS are deliberately not
            // claimed: each parent couple roots its own family — that is what
            // keeps the Výsek and Voigt sides of one person's ancestry apart.
            while (work.length > 0) {
                const id = work.shift()!;
                const p = data.persons[id];
                for (const ch of sortIds(data, p.childIds.filter(x => !!data.persons[x]))) push(ch);
                for (const sp of sortIds(data, partnersOf(data, id))) push(sp);
            }
        }

        // Boundary neighbours seed the next families. In 'lineage' mode only
        // PARENTS can be uncovered (children and spouses are always claimed);
        // in 'surname' mode a different-surname parent, child or spouse each
        // starts (or joins) its own line, so every uncovered neighbour seeds.
        const newParents: { parent: PersonId; child: PersonId }[] = [];
        for (const id of sortIds(data, [...claimedSet])) {
            const p = data.persons[id];
            const neighbours = mode === 'surname'
                ? [...p.parentIds, ...p.childIds, ...partnersOf(data, id)]
                : p.parentIds;
            for (const par of sortIds(data, neighbours.filter(x => data.persons[x] && !covered.has(x)))) {
                newParents.push({ parent: par, child: id });
            }
        }

        // A root whose blood an earlier family fully owns adds nothing.
        if (!isRoot && claimedSet.size === 0) continue;

        const claimed = sortIds(data, [...claimedSet]);
        components.push({
            focusId: root,
            connectorId: connector,
            personIds: claimed,
            // The connector is the shared person an earlier family owns; it is
            // added as an anchor at tree-creation time, so it is a valid default.
            defaultPersonId: isRoot ? rootSeed : (connector as PersonId),
            nameAnchorId: isRoot ? rootSeed : (connector as PersonId), // finalised below
            isFirst: isRoot,   // carve-root; re-pointed to the focus's family below
        });

        for (const { parent, child } of newParents) {
            if (!enqueued.has(parent)) {
                enqueued.add(parent);
                queue.push({ root: parent, connector: child });
            }
        }
    }

    // Safety net: anything the walk could not reach (separate families sharing
    // the file) becomes its own island, so the split always covers 100%.
    const pool = new Set<PersonId>(
        (Object.keys(data.persons) as PersonId[]).filter(id => !covered.has(id))
    );
    for (const start of sortIds(data, [...pool])) {
        if (covered.has(start)) continue;
        const island = sortIds(data, walkIsland(data, start, pool));
        for (const id of island) covered.add(id);
        components.push({
            focusId: island[0],
            connectorId: null,
            personIds: island,
            defaultPersonId: island[0],
            nameAnchorId: island[0], // finalised below
            isFirst: false,
        });
    }

    return presentForFocus(data, finaliseComponents(data, components, mode), focusId);
}

/** Filled-in perspective options: base defaults to the dialog's focus person. */
function resolvePerspective(focusId: PersonId, opts?: PerspectiveOptions): Required<PerspectiveOptions> {
    return {
        baseIds: opts?.baseIds?.length ? opts.baseIds : [focusId],
        cousinDepth: opts?.cousinDepth ?? 1,
        cutOverrides: opts?.cutOverrides ?? new Map<PersonId, boolean>(),
    };
}

/**
 * The 'perspective' cut (see SplitMode): each chosen person gets a base tree —
 * their own line, cut at the siblings whose families are not kept — and
 * whatever remains falls into automatic neighbouring families, each connected
 * through the boundary person it hangs off. Deterministic given the options,
 * but by design NOT focus-invariant: the chosen people are the point.
 */
function decomposePerspective(
    data: StromData,
    focusId: PersonId,
    optsIn?: PerspectiveOptions
): FamilyComponent[] {
    const opts = resolvePerspective(focusId, optsIn);
    const covered = new Set<PersonId>();
    const components: FamilyComponent[] = [];

    for (const base of opts.baseIds) {
        if (!data.persons[base] || covered.has(base)) continue;
        const claimedSet = new Set<PersonId>();
        const claim = (id: PersonId): boolean => {
            if (data.persons[id] && !covered.has(id)) {
                covered.add(id);
                claimedSet.add(id);
                return true;
            }
            return false;
        };
        // A whole family hanging down from `seed`: descendants and the spouses
        // who married in (children + direct spouse closure, same as 'lineage').
        const growDown = (seed: PersonId): void => {
            const work: PersonId[] = [seed];
            while (work.length > 0) {
                const id = work.shift()!;
                const p = data.persons[id]!;
                for (const ch of sortIds(data, p.childIds.filter(x => !!data.persons[x]))) {
                    if (claim(ch)) work.push(ch);
                }
                for (const sp of sortIds(data, partnersOf(data, id))) {
                    if (claim(sp)) work.push(sp);
                }
            }
        };

        // The person, their spouses and all descendants with spouses…
        claim(base);
        growDown(base);
        // …then straight up the ancestor line, taking each level's blood
        // siblings along: with their whole family when kept, alone when cut
        // (the family then falls to a neighbouring tree through them).
        let frontier: PersonId[] = [base];
        let gen = 0;
        const sibsSeen = new Set<PersonId>();
        while (frontier.length > 0) {
            const next: PersonId[] = [];
            for (const person of frontier) {
                for (const sib of sortIds(data, siblingsOf(data, person).filter(x => !!data.persons[x]))) {
                    if (sibsSeen.has(sib)) continue;
                    sibsSeen.add(sib);
                    const kept = keepFamily(sib, gen, opts);
                    if (claim(sib) && kept) growDown(sib);
                }
                const p = data.persons[person];
                for (const par of sortIds(data, (p?.parentIds ?? []).filter(x => !!data.persons[x]))) {
                    if (claim(par)) next.push(par);
                }
            }
            frontier = next;
            gen += 1;
        }

        if (claimedSet.size === 0) continue;
        components.push({
            focusId: base,
            connectorId: null,
            personIds: sortIds(data, [...claimedSet]),
            defaultPersonId: base,
            nameAnchorId: base,
            isFirst: components.length === 0,
            personal: true,
        });
    }

    // Everything the base trees did not keep: connected groups, each linked
    // back through the boundary person it touches (an uncle's wife and
    // children connect through the uncle).
    const pool = new Set<PersonId>(
        (Object.keys(data.persons) as PersonId[]).filter(id => !covered.has(id))
    );
    for (const start of sortIds(data, [...pool])) {
        if (covered.has(start)) continue;
        const island = sortIds(data, walkIsland(data, start, pool));
        for (const id of island) covered.add(id);
        let connector: PersonId | null = null;
        outer: for (const id of island) {
            for (const r of sortIds(data, relativesOf(data, id))) {
                if (!pool.has(r)) { connector = r; break outer; }
            }
        }
        components.push({
            focusId: island[0],
            connectorId: connector,
            personIds: island,
            defaultPersonId: island[0],
            nameAnchorId: island[0], // finalised below
            isFirst: false,
        });
    }

    return presentForFocus(data, finaliseComponents(data, components, 'perspective'), focusId);
}

/**
 * The boundary siblings the 'perspective' cut can be tuned at: every real
 * sibling along the base people's ancestor lines who has a family of their own
 * (a spouse or children). `familySize` is what that family would take along.
 */
export function perspectiveCutCandidates(
    data: StromData,
    focusId: PersonId,
    optsIn?: PerspectiveOptions
): PerspectiveCutCandidate[] {
    const opts = resolvePerspective(focusId, optsIn);
    const out: PerspectiveCutCandidate[] = [];
    const seen = new Set<PersonId>();

    const familySize = (sib: PersonId): number => {
        // The sibling's own family hanging down from them, sibling excluded.
        const group = new Set<PersonId>([sib]);
        const work: PersonId[] = [sib];
        while (work.length > 0) {
            const id = work.shift()!;
            const p = data.persons[id]!;
            for (const r of [...p.childIds, ...partnersOf(data, id)]) {
                if (data.persons[r] && !group.has(r)) { group.add(r); work.push(r); }
            }
        }
        return group.size - 1;
    };

    for (const base of opts.baseIds) {
        if (!data.persons[base]) continue;
        let frontier: PersonId[] = [base];
        let gen = 0;
        const ancestorsSeen = new Set<PersonId>([base]);
        while (frontier.length > 0) {
            const next: PersonId[] = [];
            for (const person of frontier) {
                for (const sib of sortIds(data, siblingsOf(data, person).filter(x => !!data.persons[x]))) {
                    if (seen.has(sib) || !isReal(data, sib)) continue;
                    seen.add(sib);
                    const size = familySize(sib);
                    if (size === 0) continue;   // nothing to cut, nothing to keep
                    out.push({ id: sib, generation: gen, familySize: size, kept: keepFamily(sib, gen, opts) });
                }
                for (const par of sortIds(data, (data.persons[person]?.parentIds ?? []).filter(x => !!data.persons[x]))) {
                    if (!ancestorsSeen.has(par)) { ancestorsSeen.add(par); next.push(par); }
                }
            }
            frontier = next;
            gen += 1;
        }
    }
    return out;
}

function keepFamily(sib: PersonId, gen: number, opts: Required<PerspectiveOptions>): boolean {
    return opts.cutOverrides.has(sib) ? !opts.cutOverrides.get(sib)! : gen <= opts.cousinDepth;
}

/** The family's own senior real member (birthdate→id), or null if it has none. */
function firstRealOwned(data: StromData, c: FamilyComponent): PersonId | null {
    const reals = c.personIds.filter(id => isReal(data, id));
    return reals.length ? sortIds(data, reals)[0] : null;
}

/**
 * The senior, or the senior's spouse when the spouse carries the family's most
 * common surname and the senior does not — the lineage name should name the
 * family. Names are compared with sameSurname, so Svoboda and Svobodová count
 * as ONE name and the founder is never outvoted by his own daughters' feminine
 * forms. Tie (or no co-member spouse) → the senior.
 */
function pickBetterNamed(data: StromData, personIds: PersonId[], senior: PersonId): PersonId {
    const members = new Set(personIds);
    const reals = personIds.filter(id => isReal(data, id));
    const nameOf = (id: PersonId): string => data.persons[id]?.lastName ?? '';
    const score = (id: PersonId): number => {
        const n = nameOf(id);
        if (!surnameKey(n)) return 0;
        return reals.filter(o => sameSurname(nameOf(o), n, data)).length;
    };
    let best = senior;
    let bestScore = score(senior);
    for (const sp of sortIds(data, partnersOf(data, senior))) {
        if (!members.has(sp) || !isReal(data, sp)) continue;
        const s = score(sp);
        if (s > bestScore) { best = sp; bestScore = s; }
    }
    return best;
}

/**
 * Fold placeholder-only families away and give every surviving family a real
 * name anchor and a sensible default person.
 *
 * A family with no real member of its own is not a family a reader would
 * recognise — it is a run of GEDCOM placeholder slots (unknown spouses, unnamed
 * children) that hangs off one real person. Instead its persons fold into the
 * real family that reached them (the one owning its connector), so the split
 * still covers everyone exactly once but never offers an empty family.
 *
 * In the 'surname' and 'perspective' cuts a family with a SINGLE real member
 * folds the same way: one person is not a family, they are somebody's relative
 * — a lone daughter-in-law's child, a twice-married widow's other husband —
 * and belong with the family that reached them. ('lineage' branches keep even
 * one-person families: there the person IS the whole in-law branch.)
 */
function finaliseComponents(data: StromData, components: FamilyComponent[], mode: SplitMode): FamilyComponent[] {
    const realCount = (c: FamilyComponent): number =>
        c.personIds.filter(id => isReal(data, id)).length;
    // 'lineage' keeps one-person families (the person IS the whole in-law
    // branch there); the other cuts fold them into the family they hang off.
    const foldsAway = (c: FamilyComponent): boolean =>
        realCount(c) === 0
        || (mode !== 'lineage' && !c.personal && realCount(c) === 1 && c.connectorId != null);
    const survives = (c: FamilyComponent): boolean => !foldsAway(c);

    const ownerOf = new Map<PersonId, number>();
    components.forEach((c, i) => c.personIds.forEach(id => ownerOf.set(id, i)));

    // The surviving real family a placeholder-only component folds into: follow
    // its connector to the owning family, and on up until a real family. The
    // connector always lives in an EARLIER family, so this terminates; the root
    // family is the guaranteed real fallback.
    const target = new Map<number, number>();
    const targetFor = (i: number): number => {
        if (target.has(i)) return target.get(i)!;
        target.set(i, 0); // guard against a pathological cycle
        const c = components[i];
        let t = 0;
        if (c.connectorId != null) {
            const owner = ownerOf.get(c.connectorId);
            if (owner != null && owner !== i) t = survives(components[owner]) ? owner : targetFor(owner);
        }
        target.set(i, t);
        return t;
    };

    const foldedInto = new Map<number, PersonId[]>();
    components.forEach((c, i) => {
        if (survives(c)) return;
        const t = targetFor(i);
        foldedInto.set(t, [...(foldedInto.get(t) ?? []), ...c.personIds]);
    });

    const result: FamilyComponent[] = [];
    components.forEach((c, i) => {
        if (!survives(c)) return; // folded away above
        const extra = foldedInto.get(i);
        const personIds = extra ? sortIds(data, [...c.personIds, ...extra]) : c.personIds;

        // A 'perspective' base tree is one person's view: it keeps that
        // person's name and opens on them, whoever its senior is.
        if (c.personal) {
            result.push({ ...c, personIds });
            return;
        }

        // Name anchor: the family's own SENIOR real member (birthdate → id).
        // "Rodina X" reads as "the family founded by X", so the oldest member
        // carries the name — the owner asked exactly this ("why Antonín and
        // not František, when František is older?"). How the family connects
        // to the rest is a different fact and stays on the cross-reference
        // line ("napojeno na …"), never in the name.
        // Between the senior and their spouse (when both are members), the name
        // goes to whichever of the couple carries the family's most common
        // surname — "Rodina František Krepčík", not "Rodina Anna Kadeřávková",
        // for a family of Krepčíks. Tie → the senior (older) one.
        const senior = firstRealOwned(data, { ...c, personIds }) ?? c.focusId;
        const nameAnchorId = pickBetterNamed(data, personIds, senior);

        // Open on the shared connector card (the visible cross-tree link) when it
        // is a real person; otherwise open on the family's own name anchor.
        const defaultPersonId = (!c.isFirst && c.connectorId != null && isReal(data, c.connectorId))
            ? c.connectorId
            : nameAnchorId;

        result.push({ ...c, personIds, nameAnchorId, defaultPersonId });
    });

    return result;
}

/**
 * Re-order for the UI focus (presentation only — the partition is untouched):
 * the family that CONTAINS the focus is listed first and pre-highlighted, and
 * its new tree opens on the focus person. Everything else keeps its carve order.
 * If the focus is a placeholder that folded into a family, that family leads.
 */
function presentForFocus(data: StromData, families: FamilyComponent[], focusId: PersonId): FamilyComponent[] {
    const reordered = families.map(c => ({ ...c, isFirst: false }));

    // "Napojeno přes …" the way the VIEWER walks there: BFS over person links
    // from the focus; the first member of each family we step into is the
    // person the viewer connects through. Presentation only — the partition
    // and the tree-creation connector anchors are untouched.
    const famOf = new Map<PersonId, number>();
    reordered.forEach((c, i) => c.personIds.forEach(id => famOf.set(id, i)));
    const focusFam = famOf.get(focusId);
    if (focusFam !== undefined) {
        const seen = new Set<PersonId>([focusId]);
        const bfs: PersonId[] = [focusId];
        while (bfs.length > 0) {
            const id = bfs.shift()!;
            for (const r of sortIds(data, relativesOf(data, id))) {
                if (seen.has(r)) continue;
                seen.add(r);
                bfs.push(r);
                const f = famOf.get(r);
                if (f !== undefined && f !== focusFam && reordered[f].viaFromFocusId === undefined) {
                    // Prefer the near-side bridge (how the viewer names the
                    // link); fall back to the far-side member if it is unreal.
                    reordered[f].viaFromFocusId = isReal(data, id) ? id : (isReal(data, r) ? r : undefined);
                }
            }
        }
    }

    const idx = reordered.findIndex(c => c.personIds.includes(focusId));
    if (idx < 0) {
        if (reordered[0]) reordered[0].isFirst = true;
        return reordered;
    }
    const [focusFamily] = reordered.splice(idx, 1);
    focusFamily.isFirst = true;
    // Open the focus's own tree on the focus person (if it is a real member).
    if (isReal(data, focusId)) focusFamily.defaultPersonId = focusId;
    reordered.unshift(focusFamily);
    return reordered;
}

/**
 * The persons whose data travels into a family's new tree: the family itself
 * plus its connector anchor (if any). The connector is the single shared card
 * that lets the cross-tree badge link the family back to its neighbour.
 */
export function seedIdsFor(component: FamilyComponent): Set<PersonId> {
    const ids = new Set<PersonId>(component.personIds);
    if (component.connectorId) ids.add(component.connectorId);
    return ids;
}

/**
 * The person to lay a family's preview out from, so that EVERY member is drawn
 * (count == preview). A family reaches sideways through in-laws and half-sibs
 * that a single vantage would clip; we pick the member whose full selection
 * covers the most of the family (senior wins ties). Meant for a small,
 * self-contained family tree (the output of `extractSubtree`).
 */
export function bestRenderFocus(family: StromData): PersonId {
    const ids = Object.keys(family.persons) as PersonId[];
    if (ids.length <= 1) return ids[0];
    let best = ids[0];
    let bestReach = -1;
    for (const id of sortIds(family, ids)) {
        const reach = selectSubgraph({
            data: family,
            focusPersonId: id,
            ancestorDepth: 40,
            descendantDepth: 40,
            includeSpouseAncestors: true,
            includeParentSiblings: true,
            includeParentSiblingDescendants: true,
        }).persons.size;
        if (reach > bestReach) { bestReach = reach; best = id; }
    }
    return best;
}
