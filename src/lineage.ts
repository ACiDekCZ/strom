/**
 * Lineages ("rody") and selections for outputs (spec 028, P1).
 *
 * One definition of a lineage for every output: the tree overview, the family
 * book, the pages, the tree split. Computed from the data alone (Q5): nothing
 * is stored, so the same tree always yields the same lineages.
 *
 * WHAT A LINEAGE IS (Q1): the male line from its oldest documented bearer —
 * the descendants who carry the name, their daughters (members by birth) and
 * the wives who married in (shown beside the members, never counted as them).
 * Its KEY is the founder, not the surname: one surname can have several
 * unconnected lineages, and one lineage can carry several spellings.
 *
 * Every person has ONE birth lineage (Q2), found by walking up the "line
 * parent" — the parent the lineage passes through:
 *
 * - The father, as a rule. A documented father–child link carries the lineage
 *   even when the child's surname is written differently and the spelling is
 *   not grouped in the surname register: the key is the founder, and a spelling
 *   is evidence, not a family. Such a spelling is reported as an UNCONFIRMED
 *   form of the lineage (`otherForms`), a candidate for the user to confirm.
 * - The mother, when the child carries HER surname and not the father's: the
 *   child of an unmarried mother (with or without a recorded father) belongs to
 *   the mother's birth lineage, i.e. her father's line.
 * - Nobody, when there is no father and the child does not carry the mother's
 *   surname: the name is the trace of an undocumented father, so the child
 *   founds a lineage of its own.
 * - A person with no usable surname — a placeholder (even with a guessed
 *   surname), a nameless person, or a woman recorded under her husband's
 *   surname — follows the father (or the mother) whatever the names say: an
 *   unknown never splits a lineage, and never founds one (a lineage needs at
 *   least one named, real member; otherwise its people have no lineage).
 *
 * Step and foster parents never carry a lineage; adoptive ones do when no
 * other father is recorded (the child took the name).
 *
 * MARRIAGE (Q2): a daughter stays a member of her father's lineage and gets a
 * link into her husband's (`marriedInto`); a wife who married in is a spouse in
 * her husband's lineage with a link to her own birth lineage (`RodSpouse`). A
 * woman's birth and married surnames are never forms of one lineage.
 *
 * MANUAL CORRECTIONS (package 1031, `StromData.lineageOverrides`): a person in
 * `founders` starts a lineage of their own (their line parent is cut); the
 * children of a person in `notCarriers` start their own lines (that person
 * passes nothing on — how a lineage's founder is moved down the line). Unknown
 * ids are ignored. `previewOverride` says what a change would do before it is
 * made; `applyLineageChange` gives the fields to store.
 *
 * The tree split (src/split-families.ts, mode 'surname') carves DISJOINT
 * families by first claim for creating separate trees. It uses the surname-
 * line walk and the "unnamed person" rule from here (walkSurnameLine), but its
 * cut stays its own: a disjoint partition cannot hold a woman in two lineages.
 */

import { LineageOverrides, Partnership, PartnershipId, Person, PersonId, StromData } from './types.js';
import { addSurnameGroup, removeSurnameForm, sameSurname, surnameKey, withSurnameRules } from './surnames.js';
import { parseFlexDate, yearOf } from './dates.js';
import { placeKey } from './places.js';

/** A lineage's id: the id of the person at the top of its line. */
export type RodId = string & { readonly __brand: 'RodId' };

/**
 * A lineage with at most this many real members (married-in spouses not
 * counted) is small: in the book it goes into a summary chapter, in the
 * overview it is folded. On a real tree of 835 people, 113 of 147 surname
 * groups had 1–4 people — fragments rather than lineages (book analysis
 * 30 Oct 2026).
 */
export const SMALL_ROD_MAX_MEMBERS = 4;

/** A spouse shown in a lineage without being its member (Q2). */
export interface RodSpouse {
    personId: PersonId;
    /** The member they are married to. */
    spouseOfId: PersonId;
    partnershipId: PartnershipId;
    /** Their own birth lineage, or null when it is not known. */
    birthRodId: RodId | null;
}

/** A marriage of a person into another lineage (a daughter's link, Q2). */
export interface RodMarriage {
    partnershipId: PartnershipId;
    spouseId: PersonId;
    rodId: RodId;
}

/** A place named in a lineage's records, with how often. */
export interface RodPlace {
    /** The spelling used most. */
    name: string;
    count: number;
}

/** One lineage: who belongs to it and what the overview says about it (K1.2). */
export interface Rod {
    id: RodId;
    /** The top of the line — may be a placeholder bridging named siblings. */
    rootId: PersonId;
    /** The oldest documented bearer: a real person with a surname. */
    founderId: PersonId;
    /** The lineage's name, as its founder (or its first male bearer) writes it. */
    surname: string;
    /** Spellings members carry that are forms of `surname` (sameSurname), most used first. */
    forms: string[];
    /** Other spellings members carry, not confirmed as forms (most used first). */
    otherForms: string[];
    /** Members by birth, in line order (founder, then each child's line by birth). */
    memberIds: PersonId[];
    /** Spouses who married in, in the order of the members they married. */
    spouses: RodSpouse[];
    /** The lineage's families: unions it carries (see `rodFamilies`). */
    familyIds: PartnershipId[];
    /** Members who are real people (placeholders not counted). */
    realMemberCount: number;
    /** Married-in spouses who are real people. */
    realSpouseCount: number;
    /** First and last year in the members' and families' records. */
    period: { from: number; to: number } | null;
    /** Places in the members' and families' records, most used first. */
    places: RodPlace[];
    /** Generations of the line, the root's included. */
    generations: number;
    /** At most SMALL_ROD_MAX_MEMBERS real members. */
    small: boolean;
    /** One real member only (typically a wife whose parents are not recorded). */
    solitary: boolean;
    /** The founder's birth year (else the year of their earliest own record). */
    founderYear: number | null;
    /** That year is not exact: about / before / after, a period, or not a birth. */
    founderYearApprox: boolean;
    /**
     * Shaped by a manual correction (lineageOverrides): 'split' = the root is
     * in `founders` (a line split off by hand); 'founder' = the root's line
     * parent is in `notCarriers` (the founder moved down). Null = as computed.
     */
    manual: 'founder' | 'split' | null;
}

/** Everything about the lineages of one tree, computed once (see buildLineages). */
export interface LineageIndex {
    readonly data: StromData;
    /** Each person's birth lineage; null = none (no named real bearer in the line). */
    readonly rodByPerson: ReadonlyMap<PersonId, RodId | null>;
    /** The lineages, largest first. */
    readonly rods: ReadonlyMap<RodId, Rod>;
    /** The parent each person's lineage passes through (null at a line's top). */
    readonly lineParent: ReadonlyMap<PersonId, PersonId | null>;
    /** Line parents a correction cut (lineageOverrides): person → the parent it would follow. */
    readonly cutParent: ReadonlyMap<PersonId, PersonId>;
}

// ---------------------------------------------------------------------------
// Graph helpers (shared with the tree split)

/**
 * Partners of a person across all their unions (ids missing from the data
 * included; an empty partner slot — an import's one-parent union with a null
 * id — is not a partner).
 */
export function partnersOf(data: StromData, id: PersonId): PersonId[] {
    const p = data.persons[id];
    if (!p) return [];
    const out: PersonId[] = [];
    for (const uid of p.partnerships) {
        const u = data.partnerships[uid];
        if (!u) continue;
        const other = u.person1Id === id ? u.person2Id : u.person1Id;
        if (other) out.push(other);
    }
    return out;
}

/** Siblings of a person (sharing at least one parent). */
export function siblingsOf(data: StromData, id: PersonId): PersonId[] {
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

/** Deterministic order: birthdate as written, then id, so nothing ever wobbles. */
export function sortByBirth(data: StromData, ids: PersonId[]): PersonId[] {
    return ids.slice().sort((a, b) => compareByBirth(data, a, b));
}

function compareByBirth(data: StromData, a: PersonId, b: PersonId): number {
    const ba = data.persons[a]?.birthDate ?? '9999';
    const bb = data.persons[b]?.birthDate ?? '9999';
    if (ba !== bb) return ba < bb ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A person who can neither split a surname line nor found one: a placeholder
 * (GEDCOM slots often inherit a guessed surname) or someone with no surname.
 */
export function isLineless(data: StromData, id: PersonId): boolean {
    const p = data.persons[id];
    return !!p && (!!p.isPlaceholder || !surnameKey(p.lastName ?? ''));
}

// ---------------------------------------------------------------------------
// The surname-line walk of the tree split (mode 'surname'), kept here so both
// cuts share one rule for names and unknown people.

/**
 * Does this spouse found a surname line of their own (rather than staying with
 * the partner)? Yes with parents in the data, or with a child after their own
 * name; an unnamed person never does.
 */
export function foundsOwnSurnameLine(data: StromData, id: PersonId): boolean {
    const p = data.persons[id]!;
    if (isLineless(data, id)) return false;
    if (p.parentIds.some(x => !!data.persons[x])) return true;
    const n = p.lastName ?? '';
    if (!surnameKey(n)) return false;
    return p.childIds.some(ch =>
        data.persons[ch] && sameSurname(data.persons[ch]!.lastName ?? '', n, data));
}

/**
 * Grow a surname line ("rod" of the tree split) from the people in `work`:
 * everyone joined by parent–child links along ONE surname (sameSurname —
 * feminine forms and grouped spellings count), up to the founder and down to
 * the last bearer. `push` claims a person (and queues it) unless an earlier
 * family has it — first claim. A person with no surname stays with whichever
 * line reaches them first; a spouse is absorbed only when they have no line of
 * their own (see foundsOwnSurnameLine). Antonín (no parents recorded, children
 * named after him) FOUNDS his line; a childless in-law stays with her husband.
 */
export function walkSurnameLine(
    data: StromData,
    rodSurname: string,
    work: PersonId[],
    push: (id: PersonId) => void
): void {
    const rodKey = surnameKey(rodSurname);
    const inLine = (id: PersonId): boolean => {
        if (isLineless(data, id)) return true;
        return !!rodKey && sameSurname(data.persons[id]!.lastName!, rodSurname, data);
    };
    while (work.length > 0) {
        const id = work.shift()!;
        const p = data.persons[id];
        for (const ch of sortByBirth(data, p.childIds.filter(x => !!data.persons[x]))) {
            if (inLine(ch)) push(ch);
        }
        for (const par of sortByBirth(data, p.parentIds.filter(x => !!data.persons[x]))) {
            if (inLine(par)) push(par);
        }
        // Same-name SIBLINGS belong to the line even when the shared parent is
        // written differently (brothers under a father registered in another
        // spelling) — the parent stays free to found the differently-written
        // line; grouping the spellings in the surname register merges them.
        for (const sib of sortByBirth(data, siblingsOf(data, id).filter(x => !!data.persons[x]))) {
            if (inLine(sib)) push(sib);
        }
        for (const sp of sortByBirth(data, partnersOf(data, id).filter(x => !!data.persons[x]))) {
            if (!foundsOwnSurnameLine(data, sp)) push(sp);
        }
    }
}

// ---------------------------------------------------------------------------
// Lineages

/** Does this parent link carry descent? Step and foster parents do not. */
function isDescentLink(child: Person, parentId: PersonId): boolean {
    const rel = child.parentRelTypes?.[parentId];
    return rel !== 'step' && rel !== 'foster';
}

/** The child's parents that carry descent, existing in the data. */
function descentParents(data: StromData, child: Person): Person[] {
    return child.parentIds
        .filter(id => isDescentLink(child, id))
        .map(id => data.persons[id])
        .filter((p): p is Person => !!p);
}

/**
 * The father: the male parent (a biological one before an adoptive one); with
 * a mother and one parent of unrecorded sex, that one.
 */
function fatherOf(data: StromData, child: Person): Person | null {
    const parents = descentParents(data, child);
    const bio = (p: Person): boolean => (child.parentRelTypes?.[p.id] ?? 'biological') === 'biological';
    const males = parents.filter(p => p.gender === 'male');
    if (males.length) return males.find(bio) ?? males[0];
    const females = parents.filter(p => p.gender === 'female');
    const others = parents.filter(p => p.gender !== 'female');
    return females.length >= 1 && others.length === 1 ? others[0] : null;
}

function motherOf(data: StromData, child: Person): Person | null {
    const parents = descentParents(data, child).filter(p => p.gender === 'female');
    const bio = (p: Person): boolean => (child.parentRelTypes?.[p.id] ?? 'biological') === 'biological';
    return parents.find(bio) ?? parents[0] ?? null;
}

/**
 * Is this woman's recorded surname really her husband's? Registers and imports
 * often file a wife under her married name; it is never a form of her birth
 * lineage (021 K2.3).
 */
function surnameLooksMarried(data: StromData, p: Person): boolean {
    if (p.gender !== 'female') return false;
    const name = p.lastName ?? '';
    if (p.marriedSurname && same(name, p.marriedSurname, data)) return true;
    return partnersOf(data, p.id).some(sp => {
        const s = data.persons[sp];
        return !!s && !s.isPlaceholder && same(name, s.lastName ?? '', data);
    });
}

/** The person's own surname as lineage evidence, or '' when it is none. */
function birthSurname(data: StromData, p: Person): string {
    if (isLineless(data, p.id)) return '';
    const name = (p.lastName ?? '').trim();
    // With a father on record the married-name check is not needed (the father
    // wins anyway) — and it would wrongly blank a woman of the same name as
    // her husband (a cousin marriage).
    return surnameLooksMarried(data, p) && !fatherOf(data, p) ? '' : name;
}

/**
 * Build the lineage index of a tree. Pure and deterministic; call it once per
 * output and pass the index around (cheap: linear in the tree's size).
 */
export function buildLineages(data: StromData): LineageIndex {
    const prev = sameMemo;
    sameMemo = new Map();
    try {
        return withSurnameRules(data, () => computeLineages(data));
    } finally {
        sameMemo = prev;
    }
}

/**
 * sameSurname, remembered for one build: a lineage asks about the same few
 * names hundreds of times, and each answer normalises both names again.
 */
let sameMemo: Map<string, boolean> | null = null;

function same(a: string, b: string, data: StromData): boolean {
    if (!sameMemo) return sameSurname(a, b, data);
    const key = a + '\u0000' + b;
    let hit = sameMemo.get(key);
    if (hit === undefined) {
        hit = sameSurname(a, b, data);
        sameMemo.set(key, hit);
    }
    return hit;
}

/** The tree's lineage corrections as sets (a person in both lists is a founder). */
export function lineageOverridesOf(data: StromData): { founders: Set<PersonId>; notCarriers: Set<PersonId> } {
    const o = data.lineageOverrides;
    const founders = new Set<PersonId>((o?.founders ?? []).filter(id => !!data.persons[id as PersonId]) as PersonId[]);
    const notCarriers = new Set<PersonId>((o?.notCarriers ?? [])
        .filter(id => !!data.persons[id as PersonId] && !founders.has(id as PersonId)) as PersonId[]);
    return { founders, notCarriers };
}

/**
 * The corrections as they are worth storing: known ids only, each person in
 * one list (founders wins), sorted; undefined when nothing is left.
 */
export function cleanLineageOverrides(data: StromData, o: LineageOverrides | undefined = data.lineageOverrides): LineageOverrides | undefined {
    const known = (id: unknown): id is string => typeof id === 'string' && !!data.persons[id as PersonId];
    const founders = [...new Set((o?.founders ?? []).filter(known))].sort();
    const fset = new Set(founders);
    const notCarriers = [...new Set((o?.notCarriers ?? []).filter(known))].filter(id => !fset.has(id)).sort();
    if (!founders.length && !notCarriers.length) return undefined;
    return {
        ...(founders.length ? { founders } : {}),
        ...(notCarriers.length ? { notCarriers } : {}),
    };
}

function computeLineages(data: StromData): LineageIndex {
    const ids = sortByBirth(data, Object.keys(data.persons) as PersonId[]);
    const { founders, notCarriers } = lineageOverridesOf(data);
    // The line parent a correction cut (what the computation would have chosen).
    const cut = new Map<PersonId, PersonId>();
    const surnameOf = new Map<PersonId, string>();
    for (const id of ids) surnameOf.set(id, birthSurname(data, data.persons[id]));

    // 1. The line parent of every person (see the module comment).
    const lineParent = new Map<PersonId, PersonId | null>();
    // The surname a person's line carries: their own, or the nearest one above.
    const lineSurname = new Map<PersonId, string>();
    const resolving = new Set<PersonId>();

    const resolve = (id: PersonId): void => {
        if (lineParent.has(id)) return;
        if (resolving.has(id)) {          // a cycle in bad data: cut it here
            lineParent.set(id, null);
            lineSurname.set(id, surnameOf.get(id) ?? '');
            return;
        }
        resolving.add(id);
        const p = data.persons[id];
        const own = surnameOf.get(id) ?? '';
        const father = fatherOf(data, p);
        const mother = motherOf(data, p);
        let via: Person | null;
        if (!own) {
            via = father ?? mother;
        } else if (father) {
            resolve(father.id);
            const fatherName = lineSurname.get(father.id) ?? '';
            const carriesFather = !!fatherName && same(own, fatherName, data);
            const carriesMother = !!mother && same(own, (mother.lastName ?? '').trim(), data);
            via = !carriesFather && carriesMother ? mother : father;
        } else if (mother && same(own, (mother.lastName ?? '').trim(), data)) {
            via = mother;
        } else {
            via = null;
        }
        if (via && (founders.has(id) || notCarriers.has(via.id))) {
            cut.set(id, via.id);
            via = null;
        }
        if (via && !lineParent.has(id)) resolve(via.id);
        resolving.delete(id);
        if (lineParent.has(id)) return;   // set by the cycle guard meanwhile
        lineParent.set(id, via ? via.id : null);
        lineSurname.set(id, own || (via ? lineSurname.get(via.id) ?? '' : ''));
    };
    for (const id of ids) resolve(id);

    // 2. Line roots and the line tree (children in birth order).
    const rootOf = new Map<PersonId, PersonId>();
    const findRoot = (id: PersonId): PersonId => {
        const path: PersonId[] = [];
        let cur = id;
        const seen = new Set<PersonId>();
        while (!rootOf.has(cur)) {
            const up = lineParent.get(cur) ?? null;
            if (!up || seen.has(up)) break;
            seen.add(cur);
            path.push(cur);
            cur = up;
        }
        const root = rootOf.get(cur) ?? cur;
        rootOf.set(cur, root);
        for (const x of path) rootOf.set(x, root);
        return root;
    };
    const lineChildren = new Map<PersonId, PersonId[]>();
    for (const id of ids) {
        findRoot(id);
        const up = lineParent.get(id);
        if (up) lineChildren.set(up, [...(lineChildren.get(up) ?? []), id]);   // ids are birth-sorted
    }

    // 3. Members in line order, depth from the root.
    const byRoot = new Map<PersonId, { ordered: PersonId[]; depth: Map<PersonId, number> }>();
    for (const id of ids) {
        const root = rootOf.get(id)!;
        if (byRoot.has(root)) continue;
        const ordered: PersonId[] = [];
        const depth = new Map<PersonId, number>();
        const stack: [PersonId, number][] = [[root, 0]];
        while (stack.length) {
            const [cur, d] = stack.pop()!;
            if (depth.has(cur)) continue;
            depth.set(cur, d);
            ordered.push(cur);
            const kids = lineChildren.get(cur) ?? [];
            for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], d + 1]);
        }
        byRoot.set(root, { ordered, depth });
    }

    // 4. Which lines are lineages: those with a named real bearer.
    const isBearer = (id: PersonId): boolean => !data.persons[id].isPlaceholder && !!surnameOf.get(id);
    const rodByPerson = new Map<PersonId, RodId | null>();
    const drafts: { root: PersonId; ordered: PersonId[]; depth: Map<PersonId, number>; founder: PersonId }[] = [];
    for (const [root, { ordered, depth }] of byRoot) {
        const bearers = ordered.filter(isBearer);
        if (!bearers.length) {
            for (const id of ordered) rodByPerson.set(id, null);
            continue;
        }
        // The founder: the root when it is a named real person; otherwise the
        // oldest bearer of the shallowest generation that has one.
        const top = Math.min(...bearers.map(id => depth.get(id)!));
        const founder = sortByBirth(data, bearers.filter(id => depth.get(id) === top))[0];
        for (const id of ordered) rodByPerson.set(id, root as string as RodId);
        drafts.push({ root, ordered, depth, founder });
    }

    // 5. Families, spouses and the overview of each lineage.
    const rodsList: Rod[] = drafts.map(d => {
        const rod = summarise(data, d, rodByPerson, lineParent, surnameOf);
        const cutFrom = cut.get(d.root);
        rod.manual = !cutFrom ? null : founders.has(d.root) ? 'split' : 'founder';
        return rod;
    });
    rodsList.sort((a, b) => b.realMemberCount - a.realMemberCount || compareByBirth(data, a.founderId, b.founderId));
    const rods = new Map<RodId, Rod>(rodsList.map(r => [r.id, r]));
    return { data, rodByPerson, rods, lineParent, cutParent: cut };
}

/**
 * Who carries a lineage in this union: the man; in a couple of a woman and a
 * partner of unrecorded sex, that partner. Null for other couples (their
 * children follow their own line parents).
 */
function lineCarrier(data: StromData, u: Partnership): PersonId | null {
    const a = data.persons[u.person1Id];
    const b = data.persons[u.person2Id];
    if (!a || !b) return a?.gender === 'male' ? a.id : b?.gender === 'male' ? b.id : null;
    if (a.gender === 'male' && b.gender !== 'male') return a.id;
    if (b.gender === 'male' && a.gender !== 'male') return b.id;
    if (a.gender === 'female' && b.gender === 'unknown') return b.id;
    if (b.gender === 'female' && a.gender === 'unknown') return a.id;
    return null;
}

/**
 * The unions a lineage tells as its families: those whose carrier is a member,
 * and those that gave the lineage a child through the partner who is a member
 * (an unmarried mother's union with the recorded father).
 */
function rodFamilies(
    data: StromData,
    members: ReadonlySet<PersonId>,
    lineParent: ReadonlyMap<PersonId, PersonId | null>,
    ordered: PersonId[]
): PartnershipId[] {
    const out: PartnershipId[] = [];
    const seen = new Set<PartnershipId>();
    for (const id of ordered) {
        const p = data.persons[id];
        const unions = p.partnerships
            .map(uid => data.partnerships[uid])
            .filter((u): u is Partnership => !!u)
            .sort((x, y) => (x.startDate ?? '9999') < (y.startDate ?? '9999') ? -1
                : (x.startDate ?? '9999') > (y.startDate ?? '9999') ? 1 : 0);
        for (const u of unions) {
            if (seen.has(u.id)) continue;
            const carrier = lineCarrier(data, u);
            const carries = carrier === id
                || (carrier === null && members.has(u.person1Id) && members.has(u.person2Id))
                || u.childIds.some(ch => lineParent.get(ch) === id && members.has(ch));
            if (carries) { seen.add(u.id); out.push(u.id); }
        }
    }
    return out;
}

function summarise(
    data: StromData,
    d: { root: PersonId; ordered: PersonId[]; depth: Map<PersonId, number>; founder: PersonId },
    rodByPerson: ReadonlyMap<PersonId, RodId | null>,
    lineParent: ReadonlyMap<PersonId, PersonId | null>,
    surnameOf: ReadonlyMap<PersonId, string>
): Rod {
    const id = d.root as string as RodId;
    const members = new Set(d.ordered);
    const familyIds = rodFamilies(data, members, lineParent, d.ordered);

    const spouses: RodSpouse[] = [];
    const spouseSeen = new Set<PersonId>();
    for (const uid of familyIds) {
        const u = data.partnerships[uid];
        for (const [self, other] of [[u.person1Id, u.person2Id], [u.person2Id, u.person1Id]] as const) {
            if (!members.has(self) || members.has(other) || !data.persons[other] || spouseSeen.has(other)) continue;
            spouseSeen.add(other);
            spouses.push({ personId: other, spouseOfId: self, partnershipId: uid, birthRodId: rodByPerson.get(other) ?? null });
        }
    }

    // The name: the founder's, or — for a line founded by a woman — the first
    // male bearer's form of it (a Svobodová's sons make the Svoboda lineage).
    const founder = data.persons[d.founder];
    let surname = surnameOf.get(d.founder) ?? '';
    if (founder.gender !== 'male') {
        const man = d.ordered.find(m => data.persons[m].gender === 'male' && !data.persons[m].isPlaceholder
            && !!surnameOf.get(m) && same(surnameOf.get(m)!, surname, data));
        if (man) surname = surnameOf.get(man)!;
    }

    // Spellings: confirmed forms of the name vs the rest. A married name filed
    // as a woman's surname is not a form of anything here.
    const counts = new Map<string, { name: string; count: number }>();
    for (const m of d.ordered) {
        const name = surnameOf.get(m);
        if (!name || data.persons[m].isPlaceholder) continue;
        const key = surnameKey(name);
        const e = counts.get(key) ?? { name, count: 0 };
        e.count++;
        counts.set(key, e);
    }
    const byUse = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const forms = byUse.filter(f => same(f.name, surname, data)).map(f => f.name);
    const otherForms = byUse.filter(f => !same(f.name, surname, data))
        .filter(f => !d.ordered.some(m => surnameOf.get(m) === f.name && surnameLooksMarried(data, data.persons[m])))
        .map(f => f.name);

    // Period and places from the members' own records and the families'.
    const years: number[] = [];
    const placeCounts = new Map<string, Map<string, number>>();
    const addYear = (v?: string): void => { const y = yearOf(v); if (y != null) years.push(y); };
    const addPlace = (raw?: string): void => {
        const v = raw?.trim();
        if (!v) return;
        const key = placeKey(v);
        if (!key) return;
        const spellings = placeCounts.get(key) ?? new Map<string, number>();
        spellings.set(v, (spellings.get(v) ?? 0) + 1);
        placeCounts.set(key, spellings);
    };
    for (const m of d.ordered) {
        const p = data.persons[m];
        if (p.isPlaceholder) continue;
        addYear(p.birthDate); addYear(p.deathDate);
        addPlace(p.birthPlace); addPlace(p.deathPlace);
        for (const ev of p.events ?? []) { addYear(ev.date); addPlace(ev.place); }
    }
    for (const uid of familyIds) {
        const u = data.partnerships[uid];
        addYear(u.startDate); addPlace(u.startPlace);
        for (const ev of u.events ?? []) { addYear(ev.date); addPlace(ev.place); }
    }
    const places: RodPlace[] = [...placeCounts.values()].map(spellings => {
        const sorted = [...spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        return { name: sorted[0][0], count: sorted.reduce((s, [, n]) => s + n, 0) };
    }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    const realMemberCount = d.ordered.filter(m => !data.persons[m].isPlaceholder).length;
    const fy = founderYearOf(founder);
    return {
        id,
        rootId: d.root,
        founderId: d.founder,
        surname,
        forms,
        otherForms,
        memberIds: d.ordered,
        spouses,
        familyIds,
        realMemberCount,
        realSpouseCount: spouses.filter(s => !data.persons[s.personId].isPlaceholder).length,
        period: years.length ? { from: Math.min(...years), to: Math.max(...years) } : null,
        places,
        generations: Math.max(...d.ordered.map(m => d.depth.get(m)!)) + 1,
        small: realMemberCount <= SMALL_ROD_MAX_MEMBERS,
        solitary: realMemberCount === 1,
        founderYear: fy.year,
        founderYearApprox: fy.approx,
        manual: null,
    };
}

/** The founder's year for labels: birth, else baptism, else the earliest own record (approx). */
function founderYearOf(p: Person): { year: number | null; approx: boolean } {
    const exactOf = (v?: string): boolean => {
        const d = parseFlexDate(v);
        return !!d && !d.qualifier && !d.end && !d.period;
    };
    const birth = yearOf(p.birthDate);
    if (birth != null) return { year: birth, approx: !exactOf(p.birthDate) };
    const events = (p.events ?? []).filter(e => yearOf(e.date) != null);
    const baptism = events.find(e => e.type === 'baptism');
    if (baptism) return { year: yearOf(baptism.date), approx: true };
    const years = [...events.map(e => yearOf(e.date)!), yearOf(p.deathDate)].filter((y): y is number => y != null);
    return years.length ? { year: Math.min(...years), approx: true } : { year: null, approx: false };
}

/** The lineages of the tree, largest first. */
export function rods(index: LineageIndex): Rod[] {
    return [...index.rods.values()];
}

/** A person's birth lineage (Q2), or null when it is not known. */
export function rodOf(index: LineageIndex, personId: PersonId): RodId | null {
    return index.rodByPerson.get(personId) ?? null;
}

/** The lineage's members by birth, in line order. */
export function rodMembers(index: LineageIndex, rodId: RodId): PersonId[] {
    return index.rods.get(rodId)?.memberIds ?? [];
}

/**
 * The lineage's real members by generation: index 0 = the founder's
 * generation (I), then each step down the line. Depth is counted along the
 * line parents, so a placeholder bridging two generations keeps the people
 * below it in their own generation (it is left out itself, which can leave a
 * generation empty). Members above the founder (a placeholder root, a nameless
 * person) count as the founder's generation. Line order within a generation.
 */
export function rodGenerations(index: LineageIndex, rodId: RodId): PersonId[][] {
    const rod = index.rods.get(rodId);
    if (!rod) return [];
    const depth = new Map<PersonId, number>();
    const depthOf = (id: PersonId): number => {
        const path: PersonId[] = [];
        let cur: PersonId | null = id;
        while (cur && !depth.has(cur) && cur !== rod.rootId) {
            if (path.includes(cur)) break;   // a cycle in bad data
            path.push(cur);
            cur = index.lineParent.get(cur) ?? null;
        }
        if (cur === rod.rootId && !depth.has(cur)) depth.set(cur, 0);
        let d = cur && depth.has(cur) ? depth.get(cur)! : -1;
        for (let i = path.length - 1; i >= 0; i--) depth.set(path[i], ++d);
        return depth.get(id) ?? 0;
    };
    const top = depthOf(rod.founderId);
    const out: PersonId[][] = [];
    for (const id of rod.memberIds) {
        if (index.data.persons[id]?.isPlaceholder) continue;
        const g = Math.max(0, depthOf(id) - top);
        while (out.length <= g) out.push([]);
        out[g].push(id);
    }
    return out;
}

/** The spouses who married into the lineage, each with a link to their birth lineage. */
export function rodSpouses(index: LineageIndex, rodId: RodId): RodSpouse[] {
    return index.rods.get(rodId)?.spouses ?? [];
}

/**
 * The lineages a person married into: each union in which the partner carries
 * another lineage than the person's own (a daughter's "married into …" link).
 */
export function marriedInto(index: LineageIndex, personId: PersonId): RodMarriage[] {
    const { data } = index;
    const p = data.persons[personId];
    if (!p) return [];
    const own = rodOf(index, personId);
    const out: RodMarriage[] = [];
    for (const uid of p.partnerships) {
        const u = data.partnerships[uid];
        if (!u) continue;
        const spouseId = u.person1Id === personId ? u.person2Id : u.person1Id;
        if (lineCarrier(data, u) !== spouseId) continue;
        const rodId = rodOf(index, spouseId);
        if (rodId && rodId !== own) out.push({ partnershipId: uid, spouseId, rodId });
    }
    return out;
}

/**
 * What the "Family line" row of a person's card and page says (spec 1031
 * §3.1). A member: their birth lineage, with the other lineages they married
 * into. A spouse who married in: the lineage of the marriage, with the birth
 * lineage when it is one worth naming. Null: no row.
 */
export type PersonRodRow =
    | { kind: 'member'; rodId: RodId; marriedInto: RodId[] }
    | { kind: 'spouse'; rodId: RodId; birthRodId: RodId | null };

/** Per index: each spouse who married in → the lineages they married into (see spouseRodsOf). */
const spouseRodsCache = new WeakMap<LineageIndex, Map<PersonId, { rodId: RodId; partnershipId: PartnershipId }[]>>();

/**
 * The lineages a person is a spouse in (each lineage's `spouses`, as the
 * overview shows them), in the order of the person's unions.
 */
export function spouseRodsOf(index: LineageIndex, personId: PersonId): RodId[] {
    let map = spouseRodsCache.get(index);
    if (!map) {
        map = new Map();
        for (const rod of index.rods.values()) {
            for (const s of rod.spouses) {
                const list = map.get(s.personId) ?? [];
                list.push({ rodId: rod.id, partnershipId: s.partnershipId });
                map.set(s.personId, list);
            }
        }
        spouseRodsCache.set(index, map);
    }
    const unions = index.data.persons[personId]?.partnerships ?? [];
    const pos = (uid: PartnershipId): number => { const i = unions.indexOf(uid); return i < 0 ? unions.length : i; };
    const list = [...(map.get(personId) ?? [])].sort((a, b) => pos(a.partnershipId) - pos(b.partnershipId));
    const out: RodId[] = [];
    for (const e of list) if (!out.includes(e.rodId)) out.push(e.rodId);
    return out;
}

/**
 * The row of a person (see PersonRodRow). A person is told as a spouse who
 * married in when their own lineage says little — none, one person only, or
 * a small family while the marriage is into a lineage over the threshold —
 * and as a member otherwise (a daughter of a lineage keeps it and "married
 * into" the other). The birth lineage of a spouse is named only when it has
 * more than one person. A placeholder, or a person with no lineage of more
 * than themselves and no marriage into one, has no row.
 */
export function personRodRow(index: LineageIndex, personId: PersonId): PersonRodRow | null {
    const p = index.data.persons[personId];
    if (!p || p.isPlaceholder) return null;
    const ownId = rodOf(index, personId);
    const own = ownId ? index.rods.get(ownId) ?? null : null;
    const into = spouseRodsOf(index, personId).filter(id => id !== ownId);
    const big = into.filter(id => !index.rods.get(id)!.small);
    const asSpouse = into.length > 0 && (!own || own.solitary || (own.small && big.length > 0));
    if (asSpouse) {
        const rodId = big[0] ?? into[0];
        return { kind: 'spouse', rodId, birthRodId: own && !own.solitary && own.id !== rodId ? own.id : null };
    }
    if (!own || own.solitary) return null;
    return { kind: 'member', rodId: own.id, marriedInto: into };
}

// ---------------------------------------------------------------------------
// Labels

/**
 * The lineage's name for people (spec 1031 §0.3): its surname, and when other
 * lineages share it a qualifier in brackets — the place it lived most, else
 * its founder's year, else the founder's first name. A big lineage is told
 * apart from the other big ones only (a one-person "Fíšek" elsewhere does not
 * rename the main Fíšek line); a small one from every lineage of its name.
 */
export function rodLabel(rod: Rod, all: readonly Rod[], data?: StromData): string {
    const key = surnameKey(rod.surname);
    const peers = all.filter(r => r.id !== rod.id && surnameKey(r.surname) === key && (rod.small || !r.small));
    if (!peers.length || !rod.surname) return rod.surname;
    const place = rod.places[0]?.name;
    const pk = place ? placeKey(place) : '';
    const placeOf = (r: Rod): string => r.places[0] ? placeKey(r.places[0].name) : '';
    if (pk && !peers.some(r => placeOf(r) === pk)) return `${rod.surname} (${place})`;
    const year = rod.founderYear;
    if (year != null && !peers.some(r => r.founderYear === year)) return `${rod.surname} (${year})`;
    const first = (data ?? null)?.persons[rod.founderId]?.firstName?.trim() ?? '';
    if (first) {
        const firstOf = (r: Rod): string => (data?.persons[r.founderId]?.firstName ?? '').trim();
        if (!peers.some(r => firstOf(r) === first) || year == null) return `${rod.surname} (${first})`;
        return `${rod.surname} (${first}, ${year})`;
    }
    if (year != null) return `${rod.surname} (${year})`;
    return pk ? `${rod.surname} (${place})` : rod.surname;
}

/** Every lineage's label, by id (see rodLabel). */
export function rodLabels(index: LineageIndex): Map<RodId, string> {
    const all = rods(index);
    return new Map(all.map(r => [r.id, rodLabel(r, all, index.data)]));
}

// ---------------------------------------------------------------------------
// Corrections and their preview (package 1031 §2)

/** A change of a lineage's boundary or name forms, as the edit dialog offers it. */
export type LineageChange =
    /** Make a member the founder: the line above them passes nothing on. */
    | { kind: 'founder'; personId: PersonId }
    /** A member and their line start a lineage of their own. */
    | { kind: 'split'; personId: PersonId }
    /** Take back the correction that shaped this lineage. */
    | { kind: 'revert'; rodId: RodId }
    /** Group another spelling with the lineage's name (whole tree). */
    | { kind: 'addForm'; rodId: RodId; form: string }
    /** Take a spelling out of the name's group (whole tree). */
    | { kind: 'removeForm'; rodId: RodId; form: string };

/** What a change stores (only the fields it touches). */
export interface LineagePatch {
    lineageOverrides?: LineageOverrides | undefined;
    surnameVariants?: string[][] | undefined;
    /** For removeForm: the pair to remember as rejected ([removed, main]). */
    rejection?: string[];
    /** Which fields the patch sets (an undefined value clears the field). */
    fields: ('lineageOverrides' | 'surnameVariants')[];
}

/** A lineage in a preview: what the sentences need. */
export interface RodSummary {
    id: RodId;
    label: string;
    founderId: PersonId;
    founderYear: number | null;
    members: number;
    spouses: number;
    small: boolean;
}

/** One sentence of the preview (texts in strings.lineage.preview). */
export type PreviewLine =
    | { kind: 'startsWith'; personId: PersonId; year: number | null; members: number; spouses: number }
    | { kind: 'toSmall'; personIds: PersonId[] }
    | { kind: 'becomeRod'; personIds: PersonId[]; label: string }
    | { kind: 'ownLine'; personId: PersonId; label: string; members: number }
    | { kind: 'wholeTreeKeeps' }
    | { kind: 'newRod'; personId: PersonId; label: string; members: number; spouses: number }
    | { kind: 'splitMoves'; personId: PersonId; label: string; members: number; spouses: number }
    | { kind: 'merge'; label: string; otherLabel: string; members: number; otherMembers: number }
    | { kind: 'staySeparate' }
    | { kind: 'formWholeTree' }
    | { kind: 'splitByForm'; label: string; before: number; after: number; newLabel: string; personId: PersonId; year: number | null; members: number }
    | { kind: 'groupGone'; forms: string[] }
    | { kind: 'linkedByRelation' }
    | { kind: 'restored'; label: string; members: number; spouses: number }
    | { kind: 'noChange' };

export interface LineagePreview {
    before: RodSummary[];
    after: RodSummary[];
    lines: PreviewLine[];
    /** What applying it stores; null when the change does nothing. */
    patch: LineagePatch | null;
}

const summaryOf = (r: Rod, labels: ReadonlyMap<RodId, string>): RodSummary => ({
    id: r.id, label: labels.get(r.id) ?? r.surname, founderId: r.founderId, founderYear: r.founderYear,
    members: r.realMemberCount, spouses: r.realSpouseCount, small: r.small,
});

/** The ids above a person along their line, nearest first (cut links followed too). */
function lineAncestors(index: LineageIndex, personId: PersonId): PersonId[] {
    const out: PersonId[] = [];
    const seen = new Set<PersonId>([personId]);
    let cur = index.lineParent.get(personId) ?? null;
    while (cur && !seen.has(cur)) {
        seen.add(cur);
        out.push(cur);
        cur = index.lineParent.get(cur) ?? null;
    }
    return out;
}

/**
 * The fields a change stores, computed on `index` (built from the tree as it
 * is now). Null when it would change nothing.
 */
export function applyLineageChange(index: LineageIndex, change: LineageChange): LineagePatch | null {
    const { data } = index;
    const { founders, notCarriers } = lineageOverridesOf(data);
    const withSets = (): LineagePatch => {
        const next = cleanLineageOverrides(data, { founders: [...founders], notCarriers: [...notCarriers] });
        const same = JSON.stringify(next ?? null) === JSON.stringify(cleanLineageOverrides(data) ?? null);
        return same ? { fields: [] } : { lineageOverrides: next, fields: ['lineageOverrides'] };
    };
    switch (change.kind) {
        case 'founder': {
            if (!data.persons[change.personId]) return null;
            for (const id of lineAncestors(index, change.personId)) { notCarriers.add(id); founders.delete(id); }
            founders.delete(change.personId);
            notCarriers.delete(change.personId);
            break;
        }
        case 'split': {
            if (!data.persons[change.personId]) return null;
            founders.add(change.personId);
            notCarriers.delete(change.personId);
            break;
        }
        case 'revert': {
            const rod = index.rods.get(change.rodId);
            if (!rod) return null;
            founders.delete(rod.rootId);
            let up: PersonId | null = index.cutParent.get(rod.rootId) ?? null;
            const seen = new Set<PersonId>();
            while (up && notCarriers.has(up) && !seen.has(up)) {
                seen.add(up);
                notCarriers.delete(up);
                up = index.lineParent.get(up) ?? index.cutParent.get(up) ?? null;
            }
            break;
        }
        case 'addForm': {
            const rod = index.rods.get(change.rodId);
            const form = change.form.trim();
            if (!rod || !form || !rod.surname) return null;
            const before = JSON.stringify(data.surnameVariants ?? []);
            const variants = addSurnameGroup(data, [rod.surname, form]);
            if (JSON.stringify(variants) === before) return null;
            return { surnameVariants: variants, fields: ['surnameVariants'] };
        }
        case 'removeForm': {
            const rod = index.rods.get(change.rodId);
            if (!rod) return null;
            const r = removeSurnameForm(data, change.form, rod.surname);
            if (!r) return null;
            return { surnameVariants: r.variants.length ? r.variants : undefined, rejection: r.rejection, fields: ['surnameVariants'] };
        }
    }
    const patch = withSets();
    return patch.fields.length ? patch : null;
}

/** The tree with a patch applied (a shallow copy; the tree itself is untouched). */
export function withLineagePatch(data: StromData, patch: LineagePatch): StromData {
    const next: StromData = { ...data };
    for (const f of patch.fields) {
        if (f === 'lineageOverrides') next.lineageOverrides = patch.lineageOverrides;
        else next.surnameVariants = patch.surnameVariants;
    }
    return next;
}

/**
 * What a change would do, before it is made (spec 1031 §2.2): the lineages
 * before and after, and the sentences of the preview. Pure: the same
 * computation on a copy with the changed fields.
 */
export function previewOverride(data: StromData, change: LineageChange, beforeIndex?: LineageIndex): LineagePreview {
    const bi = beforeIndex && beforeIndex.data === data ? beforeIndex : buildLineages(data);
    const bLabels = rodLabels(bi);
    const before = rods(bi).map(r => summaryOf(r, bLabels));
    const patch = applyLineageChange(bi, change);
    if (!patch) return { before, after: before, lines: [{ kind: 'noChange' }], patch: null };
    const ai = buildLineages(withLineagePatch(data, patch));
    const aLabels = rodLabels(ai);
    const after = rods(ai).map(r => summaryOf(r, aLabels));
    const lines: PreviewLine[] = [];
    const real = (id: PersonId): boolean => !!data.persons[id] && !data.persons[id].isPlaceholder;
    const afterRodOf = (id: PersonId): Rod | null => { const r = rodOf(ai, id); return r ? ai.rods.get(r)! : null; };
    const beforeRodOf = (id: PersonId): Rod | null => { const r = rodOf(bi, id); return r ? bi.rods.get(r)! : null; };
    const label = (r: Rod): string => aLabels.get(r.id) ?? r.surname;

    // The people of a before-lineage, grouped by where they end up.
    const scatter = (from: Rod, except: RodId | null): void => {
        const toSmall: PersonId[] = [];
        const own = new Map<RodId, PersonId[]>();
        for (const id of from.memberIds) {
            if (!real(id)) continue;
            const r = afterRodOf(id);
            if (r && r.id === except) continue;
            if (!r || r.small) toSmall.push(id);
            else own.set(r.id, [...(own.get(r.id) ?? []), id]);
        }
        for (const [rid, ids] of own) {
            const r = ai.rods.get(rid)!;
            if (ids.includes(r.founderId) && r.founderId !== (bi.rods.get(rid)?.founderId ?? null)) {
                lines.push({ kind: 'ownLine', personId: r.founderId, label: label(r), members: r.realMemberCount });
            } else {
                lines.push({ kind: 'becomeRod', personIds: ids, label: label(r) });
            }
        }
        if (toSmall.length) lines.push({ kind: 'toSmall', personIds: toSmall });
    };

    switch (change.kind) {
        case 'founder': {
            const r = afterRodOf(change.personId);
            const was = beforeRodOf(change.personId);
            if (r) lines.push({ kind: 'startsWith', personId: change.personId, year: r.founderYear, members: r.realMemberCount, spouses: r.realSpouseCount });
            if (was) scatter(was, r?.id ?? null);
            lines.push({ kind: 'wholeTreeKeeps' });
            break;
        }
        case 'split': {
            const r = afterRodOf(change.personId);
            const was = beforeRodOf(change.personId);
            if (r) lines.push({ kind: 'newRod', personId: change.personId, label: label(r), members: r.realMemberCount, spouses: r.realSpouseCount });
            const rest = was ? afterRodOf(was.founderId) : null;
            if (rest && rest.id !== r?.id) {
                lines.push({ kind: 'splitMoves', personId: change.personId, label: label(rest), members: rest.realMemberCount, spouses: rest.realSpouseCount });
            }
            break;
        }
        case 'revert': {
            const was = bi.rods.get(change.rodId);
            const r = was ? afterRodOf(was.founderId) : null;
            if (r) lines.push({ kind: 'restored', label: label(r), members: r.realMemberCount, spouses: r.realSpouseCount });
            lines.push({ kind: 'wholeTreeKeeps' });
            break;
        }
        case 'addForm': {
            const rod = bi.rods.get(change.rodId)!;
            const merged = afterRodOf(rod.founderId);
            const joined = merged
                ? rods(bi).filter(o => o.id !== rod.id && o.memberIds.some(m => afterRodOf(m)?.id === merged.id))
                : [];
            if (joined.length) {
                for (const o of joined) {
                    lines.push({ kind: 'merge', label: bLabels.get(rod.id)!, otherLabel: bLabels.get(o.id)!, members: rod.realMemberCount, otherMembers: o.realMemberCount });
                }
            } else {
                lines.push({ kind: 'staySeparate' });
            }
            lines.push({ kind: 'formWholeTree' });
            break;
        }
        case 'removeForm': {
            const rod = bi.rods.get(change.rodId)!;
            const kept = afterRodOf(rod.founderId);
            const gone = rod.memberIds.filter(m => real(m) && afterRodOf(m)?.id !== kept?.id);
            const newRods = [...new Set(gone.map(m => afterRodOf(m)).filter((r): r is Rod => !!r))];
            for (const nr of newRods) {
                lines.push({
                    kind: 'splitByForm', label: bLabels.get(rod.id)!, before: rod.realMemberCount,
                    after: kept?.realMemberCount ?? 0, newLabel: label(nr), personId: nr.founderId,
                    year: nr.founderYear, members: nr.realMemberCount,
                });
            }
            if (!newRods.length) {
                const carriers = rod.memberIds.some(m => real(m) && same((data.persons[m].lastName ?? '').trim(), change.form, data));
                lines.push(carriers ? { kind: 'linkedByRelation' } : { kind: 'formWholeTree' });
            }
            const exact = (v: string): string => v.normalize('NFC').trim().toLowerCase();
            const group = (data.surnameVariants ?? []).find(g => g.some(n => exact(n) === exact(change.form)));
            if (group && group.length <= 2) lines.push({ kind: 'groupGone', forms: group });
            break;
        }
    }
    if (!lines.length) lines.push({ kind: 'noChange' });
    return { before, after, lines, patch };
}

// ---------------------------------------------------------------------------
// Selections for outputs (book, pages, later the web)

/**
 * What goes into an output (Q3) — one mechanism for the book and the pages.
 * `generations` limits the depth from the chosen person (1 = parents or
 * children only); missing = no limit.
 *
 * Extension point (P3, spec 028 Q4): `{ kind: 'house'; place: string; house:
 * string }` — the people with a record at that house (obec + čp.), across
 * lineages; add it here and in `selection` once the house key exists.
 */
export type SelectionSpec =
    | { kind: 'tree' }
    | { kind: 'rods'; rodIds: RodId[] }
    | { kind: 'ancestors'; personId: PersonId; generations?: number }
    | { kind: 'descendants'; personId: PersonId; generations?: number };

/** The people and families of one output. */
export interface Selection {
    /** The people the output is about, in reading order. */
    memberIds: PersonId[];
    /** People shown beside them by marriage only (married-in spouses). */
    spouseIds: PersonId[];
    /** Members first, then spouses. */
    personIds: PersonId[];
    /** The unions the output tells as families, in reading order. */
    familyIds: PartnershipId[];
}

/** The partners of the families who are not members, in family order. */
function spousesOfFamilies(data: StromData, members: ReadonlySet<PersonId>, familyIds: PartnershipId[]): PersonId[] {
    const out: PersonId[] = [];
    const seen = new Set<PersonId>();
    for (const uid of familyIds) {
        const u = data.partnerships[uid];
        for (const id of [u.person1Id, u.person2Id]) {
            if (!members.has(id) && data.persons[id] && !seen.has(id)) { seen.add(id); out.push(id); }
        }
    }
    return out;
}

function makeSelection(data: StromData, memberIds: PersonId[], familyIds: PartnershipId[], spouseIds?: PersonId[]): Selection {
    const spouses = spouseIds ?? spousesOfFamilies(data, new Set(memberIds), familyIds);
    return { memberIds, spouseIds: spouses, personIds: [...memberIds, ...spouses], familyIds };
}

/** Unions with a member partner, in the members' order (each union once). */
function unionsOfMembers(data: StromData, ordered: PersonId[]): PartnershipId[] {
    const out: PartnershipId[] = [];
    const seen = new Set<PartnershipId>();
    for (const id of ordered) {
        for (const uid of data.persons[id]?.partnerships ?? []) {
            if (data.partnerships[uid] && !seen.has(uid)) { seen.add(uid); out.push(uid); }
        }
    }
    return out;
}

/**
 * A branch (Q1): the ancestor and all their descendants through sons and
 * daughters alike, in reading order (each child's line in birth order), with
 * the spouses who married in and every union of a member.
 */
export function branch(data: StromData, ancestorId: PersonId, generations?: number): Selection {
    if (!data.persons[ancestorId]) return makeSelection(data, [], []);
    const ordered: PersonId[] = [];
    const seen = new Set<PersonId>();
    const stack: [PersonId, number][] = [[ancestorId, 0]];
    while (stack.length) {
        const [id, d] = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        ordered.push(id);
        if (generations != null && d >= generations) continue;
        const p = data.persons[id];
        const kids = sortByBirth(data, p.childIds.filter(ch => {
            const c = data.persons[ch];
            return !!c && isDescentLink(c, id);
        }));
        for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], d + 1]);
    }
    return makeSelection(data, ordered, unionsOfMembers(data, ordered));
}

/** The person and their ancestors, generation by generation, with the unions that produced them. */
function ancestors(data: StromData, personId: PersonId, generations?: number): Selection {
    if (!data.persons[personId]) return makeSelection(data, [], []);
    const ordered: PersonId[] = [personId];
    const seen = new Set<PersonId>([personId]);
    let frontier: PersonId[] = [personId];
    for (let d = 1; frontier.length && (generations == null || d <= generations); d++) {
        const next: PersonId[] = [];
        for (const id of frontier) {
            const p = data.persons[id];
            // Father before mother, as a pedigree reads.
            const parents = descentParents(data, p)
                .sort((a, b) => (a.gender === 'male' ? 0 : 1) - (b.gender === 'male' ? 0 : 1));
            for (const par of parents) {
                if (seen.has(par.id)) continue;
                seen.add(par.id);
                next.push(par.id);
            }
        }
        ordered.push(...next);
        frontier = next;
    }
    const members = new Set(ordered);
    // The unions that produced a member: both partners (or the only recorded
    // one) are the member's parents.
    const families: PartnershipId[] = [];
    const famSeen = new Set<PartnershipId>();
    for (const id of ordered) {
        const p = data.persons[id];
        const parents = new Set(descentParents(data, p).map(x => x.id));
        for (const par of parents) {
            for (const uid of data.persons[par].partnerships) {
                const u = data.partnerships[uid];
                if (!u || famSeen.has(uid) || !u.childIds.includes(id)) continue;
                if (!members.has(u.person1Id) && !members.has(u.person2Id)) continue;
                famSeen.add(uid);
                families.push(uid);
            }
        }
    }
    return makeSelection(data, ordered, families);
}

/** What one output shows: people and families for the chosen part of the tree. */
export function selection(source: StromData | LineageIndex, spec: SelectionSpec): Selection {
    const index = 'rodByPerson' in source ? source : null;
    const data = index ? index.data : source as StromData;
    switch (spec.kind) {
        case 'tree': {
            const all = sortByBirth(data, Object.keys(data.persons) as PersonId[]);
            const families = (Object.keys(data.partnerships) as PartnershipId[]).sort();
            return makeSelection(data, all, families, []);
        }
        case 'rods': {
            const idx = index ?? buildLineages(data);
            const memberIds: PersonId[] = [];
            const familyIds: PartnershipId[] = [];
            const spouseIds: PersonId[] = [];
            const seenM = new Set<PersonId>();
            const seenF = new Set<PartnershipId>();
            for (const rodId of spec.rodIds) {
                const rod = idx.rods.get(rodId);
                if (!rod) continue;
                for (const m of rod.memberIds) if (!seenM.has(m)) { seenM.add(m); memberIds.push(m); }
                for (const f of rod.familyIds) if (!seenF.has(f)) { seenF.add(f); familyIds.push(f); }
            }
            // A spouse of one chosen lineage may be a member of another one.
            const seenS = new Set<PersonId>();
            for (const rodId of spec.rodIds) {
                for (const s of idx.rods.get(rodId)?.spouses ?? []) {
                    if (!seenM.has(s.personId) && !seenS.has(s.personId)) { seenS.add(s.personId); spouseIds.push(s.personId); }
                }
            }
            return makeSelection(data, memberIds, familyIds, spouseIds);
        }
        case 'ancestors':
            return ancestors(data, spec.personId, spec.generations);
        case 'descendants':
            return branch(data, spec.personId, spec.generations);
        default: {
            const never: never = spec;
            return never;
        }
    }
}
