/**
 * Tree overview: the numbers the "Tree overview" dialog shows, as pure
 * functions over StromData (no DOM, no mutation, no settings). The dialog
 * calls them section by section when a section is first opened.
 *
 * Shared rules:
 * - Placeholders ("unknown parent" frames) never count and are never listed.
 * - Ancestors are parents through a biological or unspecified tie only
 *   (`parentRelTypes`, a missing entry is biological); adoptive, step and
 *   foster parents are not ancestors. Placeholder parents are not walked.
 * - An ancestor counts once, in the nearest generation where a breadth-first
 *   walk from the person reaches them (the research's `ancestorGenerations`
 *   in strom-research src/core/people.ts; research numbers generations from
 *   1 = the person, so research g = n + 1 here, and its expected 2^(g-1) is
 *   2^n). The walk goes father before mother, so an ancestor reached twice in
 *   one generation is taken through the father-most line.
 * - Every walk keeps a visited set, so a parent loop in bad data (validation
 *   reports it) ends instead of spinning.
 * - Order: generation, then "surname first name" (localeCompare), then id —
 *   the order the highlight's "Next ›" walks (src/ui/evidence-ui.ts).
 */

import { StromData, Person, PersonId, Partnership, parentSlots, FactStatus, FACT_STATUSES } from './types.js';
import { parseFlexDate, ageBetween, ageRangeBetween, toCanonical, yearOf } from './dates.js';
import { assignGenerations } from './generations.js';
import { personEvidence, unionsByPerson } from './evidence-level.js';
import { isLivingPerson, inferBirthUpperBounds } from './privacy.js';
import { readRecordedAge, ageBirthDate } from './recorded-age.js';
import { findComponents } from './components.js';
import { strings, getStringsForLang, Language } from './strings.js';

// ==================== shared helpers ====================

/** Smallest sample a share or a median is shown from (K5.1: "from n ≥ 5"). */
export const MIN_SAMPLE = 5;

/** Whether a sample is large enough to show its number. */
export function hasEnoughSample(n: number): boolean {
    return n >= MIN_SAMPLE;
}

/** One step up the pedigree: the father's ('F') or the mother's ('M') side. */
export type ParentSide = 'F' | 'M';

const isBioTie = (child: Person, parentId: PersonId): boolean => {
    const t = child.parentRelTypes?.[parentId];
    return t === undefined || t === 'biological';
};

/**
 * A person's biological or unspecified parents that are real persons in the
 * tree, each with the side they stand on (parentSlots: by gender, a lone
 * parent is the father unless she is a woman). Extra parents beyond two (bad
 * data) follow, on the side of their gender.
 */
function bioParents(data: StromData, person: Person): { person: Person; side: ParentSide }[] {
    const list: Person[] = [];
    for (const pid of person.parentIds) {
        const p = data.persons[pid];
        if (!p || p.isPlaceholder || !isBioTie(person, pid) || list.includes(p)) continue;
        list.push(p);
    }
    const [father, mother] = parentSlots(list.slice(0, 2));
    const out: { person: Person; side: ParentSide }[] = [];
    if (father) out.push({ person: father, side: 'F' });
    if (mother) out.push({ person: mother, side: 'M' });
    for (const p of list.slice(2)) out.push({ person: p, side: p.gender === 'female' ? 'M' : 'F' });
    return out;
}

const nameKey = (p: Person | undefined): string => `${p?.lastName ?? ''} ${p?.firstName ?? ''}`.trim();

/** Compare two people by name, then id (deterministic). */
function byName(data: StromData): (a: PersonId, b: PersonId) => number {
    return (a, b) => nameKey(data.persons[a]).localeCompare(nameKey(data.persons[b])) || (a < b ? -1 : a > b ? 1 : 0);
}

/** Sort ids by a generation map, then name, then id. */
function byGenerationThenName(data: StromData, gen: Map<PersonId, number>): (a: PersonId, b: PersonId) => number {
    const name = byName(data);
    return (a, b) => (gen.get(a) ?? 0) - (gen.get(b) ?? 0) || name(a, b);
}

const realPerson = (data: StromData, id: PersonId): Person | null => {
    const p = data.persons[id];
    return p && !p.isPlaceholder ? p : null;
};

/** The breadth-first ancestor walk every function here shares. */
interface AncestorWalk {
    /** Nearest generation of each ancestor (1 = parents). The root is not in it. */
    gen: Map<PersonId, number>;
    /** The side path from the root to each ancestor, along the walk ('M','F' = mother's father). */
    path: Map<PersonId, ParentSide[]>;
    /** Ancestors in the order the walk reached them. */
    order: PersonId[];
}

function walkAncestors(data: StromData, root: Person): AncestorWalk {
    const gen = new Map<PersonId, number>();
    const path = new Map<PersonId, ParentSide[]>([[root.id, []]]);
    const order: PersonId[] = [];
    let frontier: Person[] = [root];
    for (let n = 1; frontier.length > 0; n++) {
        const next: Person[] = [];
        for (const child of frontier) {
            for (const { person, side } of bioParents(data, child)) {
                if (path.has(person.id)) continue; // reached nearer already (or the root: a loop)
                gen.set(person.id, n);
                path.set(person.id, [...path.get(child.id)!, side]);
                order.push(person.id);
                next.push(person);
            }
        }
        frontier = next;
    }
    path.delete(root.id);
    return { gen, path, order };
}

/** A year with how it was found: from the birth or (no birth date) the baptism; approximate when the date is. */
export interface DatedYear {
    year: number;
    approx: boolean;
    from: 'birth' | 'baptism';
}

/** The birth year: the birth date, or the baptism's when no birth date (src/recorded-age.ts ageBirthDate). */
export function birthYearOf(p: Person): DatedYear | null {
    const birth = parseFlexDate(p.birthDate);
    if (birth) return { year: birth.year, approx: birth.qualifier !== '' || !!birth.end, from: 'birth' };
    const baptism = parseFlexDate(p.events?.find(e => e.type === 'baptism' && parseFlexDate(e.date))?.date);
    if (baptism) return { year: baptism.year, approx: baptism.qualifier !== '' || !!baptism.end, from: 'baptism' };
    return null;
}

/**
 * The date a life ended at, for ages and the "last 100 years" window: the
 * death date, else a death event's, else the burial's, else the cremation's
 * (a burial lies a few days after the death, which no whole-year age feels).
 */
export function deathDateOf(p: Person): string | undefined {
    if (parseFlexDate(p.deathDate)) return p.deathDate;
    for (const type of ['death', 'burial', 'cremation']) {
        const e = p.events?.find(x => x.type === type && parseFlexDate(x.date));
        if (e) return e.date;
    }
    return undefined;
}

// ==================== 1. ancestors by generation (K3.2, K3.3) ====================

/** One generation of the person's ancestors. */
export interface AncestorGeneration {
    /** 1 = parents, 2 = grandparents… */
    n: number;
    /** 2^n: the places in this generation of a full pedigree. */
    expected: number;
    /** Distinct ancestors counted in this generation (each in the nearest one only). */
    known: number;
    /** Of them, with a documented birth (personEvidence().birthCited: birthSourceIds, a cited birth or baptism event). */
    proven: number;
    /** The ancestors of this generation, by name. */
    ids: PersonId[];
    /**
     * The places of this generation (out of `expected`) a person in the tree
     * holds, an ancestor who appears more than once counted at every place
     * (pedigree collapse fills places without being a new person). At least
     * `known`; what `expected − filled` is really missing.
     */
    filled: number;
    /**
     * The people standing one generation nearer (the root for n = 1; along
     * any line, so a repeated ancestor counts at each depth) whose parents are
     * not both in the tree: where the missing people of this generation would
     * attach. By name. "Show in tree" of the "generation N: known K of E" card.
     */
    gapIds: PersonId[];
}

export interface AncestorOverview {
    rootId: PersonId;
    /** Generations 1… up to the deepest known; empty when no parent is in the tree. */
    generations: AncestorGeneration[];
    /** Every ancestor's (nearest) generation. */
    generationOf: Map<PersonId, number>;
    /** Every ancestor's side path from the root ('M','F' = the mother's father). */
    pathOf: Map<PersonId, ParentSide[]>;
    /**
     * Distinct ancestors reached along two or more different lines (pedigree
     * collapse, a cousin marriage): "N ancestors appear in the pedigree more
     * than once". Once an ancestor appears twice, all their own ancestors do
     * too, so they are all counted. In a parent loop (bad data) the count is a
     * lower bound. By generation, then name.
     */
    pedigreeCollapse: PersonId[];
    /**
     * Ancestors with a birth (date, place or a baptism) that no source cites —
     * the same rule as tree health's "Births without a source", among the
     * direct ancestors only. By generation, then name.
     */
    birthNoSource: PersonId[];
}

/**
 * The person's ancestors per generation: expected (2^n) / known / proven.
 * Agrees with the research's `strom stats` on expected and known (same walk);
 * proven differs by design: the app counts a cited birth or baptism
 * (src/evidence-level.ts), the research a birth whose status is "proven".
 */
export function ancestorGenerations(data: StromData, rootId: PersonId): AncestorOverview {
    const root = realPerson(data, rootId);
    const empty: AncestorOverview = {
        rootId, generations: [], generationOf: new Map(), pathOf: new Map(), pedigreeCollapse: [], birthNoSource: [],
    };
    if (!root) return empty;
    const walk = walkAncestors(data, root);
    const unions = unionsByPerson(data);
    const name = byName(data);
    const byGen = byGenerationThenName(data, walk.gen);

    const rows = new Map<number, PersonId[]>();
    for (const id of walk.order) {
        const n = walk.gen.get(id)!;
        (rows.get(n) ?? rows.set(n, []).get(n)!).push(id);
    }
    const deepest = Math.max(0, ...rows.keys());
    const generations: AncestorGeneration[] = [];
    const birthNoSource: PersonId[] = [];
    // Places per depth: how many lines of length n lead from the root to each
    // person. Bounded by `deepest`, so a parent loop (bad data) cannot run on.
    let places = new Map<PersonId, number>([[root.id, 1]]);
    for (let n = 1; n <= deepest; n++) {
        const next = new Map<PersonId, number>();
        let filled = 0;
        for (const [pid, count] of places) {
            for (const { person } of bioParents(data, data.persons[pid])) {
                next.set(person.id, (next.get(person.id) ?? 0) + count);
                filled += count;
            }
        }
        const ids = (rows.get(n) ?? []).slice().sort(name);
        let proven = 0;
        for (const id of ids) {
            const ev = personEvidence(data.persons[id], data, unions);
            if (ev?.birthCited) proven++;
            if (ev && ev.hasBirth && !ev.birthCited) birthNoSource.push(id);
        }
        const gapIds = [...places.keys()].filter(id => bioParents(data, data.persons[id]).length < 2).sort(name);
        generations.push({ n, expected: 2 ** n, known: ids.length, filled: Math.min(filled, 2 ** n), proven, ids, gapIds });
        places = next;
    }

    return {
        rootId,
        generations,
        generationOf: walk.gen,
        pathOf: walk.path,
        pedigreeCollapse: collapsedAncestors(data, root, walk).sort(byGen),
        birthNoSource: birthNoSource.sort(byGen),
    };
}

/**
 * Ancestors with two or more distinct paths from the root: path counts
 * (capped at 2) pushed child → parent in topological order (Kahn) over the
 * ancestor graph. Nodes of a parent loop are never released; what reached
 * them still counts.
 */
function collapsedAncestors(data: StromData, root: Person, walk: AncestorWalk): PersonId[] {
    const nodes: PersonId[] = [root.id, ...walk.order];
    const parentsOf = new Map<PersonId, PersonId[]>();
    const indegree = new Map<PersonId, number>();
    for (const id of nodes) {
        const parents = bioParents(data, data.persons[id]).map(x => x.person.id).filter(pid => pid !== root.id);
        parentsOf.set(id, parents);
        for (const pid of parents) indegree.set(pid, (indegree.get(pid) ?? 0) + 1);
    }
    const paths = new Map<PersonId, number>([[root.id, 1]]);
    const queue: PersonId[] = [root.id];
    for (let head = 0; head < queue.length; head++) {
        const id = queue[head];
        const here = paths.get(id) ?? 0;
        for (const pid of parentsOf.get(id) ?? []) {
            paths.set(pid, Math.min(2, (paths.get(pid) ?? 0) + here));
            const left = (indegree.get(pid) ?? 1) - 1;
            indegree.set(pid, left);
            if (left === 0) queue.push(pid);
        }
    }
    return walk.order.filter(id => (paths.get(id) ?? 0) >= 2);
}

// ==================== 2. four grandparent lines, line ends (K3.4) ====================

/** The four lines, in fixed order: father's father, father's mother, mother's father, mother's mother. */
export type GrandparentSlot = 'FF' | 'FM' | 'MF' | 'MM';
export const GRANDPARENT_SLOTS: readonly GrandparentSlot[] = ['FF', 'FM', 'MF', 'MM'];

export interface GrandparentLine {
    slot: GrandparentSlot;
    /** The grandparent, or null when not in the tree. */
    grandparentId: PersonId | null;
    /**
     * The farthest generation (n from the root: 2 = the grandparent) reached
     * through this grandparent, each ancestor in the nearest generation of a
     * walk from the grandparent. Null without a grandparent.
     */
    deepest: number | null;
    /** The ancestor shown for that generation: earliest birth year, then name, then id. */
    personId: PersonId | null;
    /** Their birth year (the baptism's when no birth date), or null. */
    year: DatedYear | null;
}

/** The person's four grandparent lines and how far each reaches. */
export function grandparentLines(data: StromData, rootId: PersonId): GrandparentLine[] {
    const root = realPerson(data, rootId);
    const sideOf = (p: Person | null, side: ParentSide): Person | null =>
        p ? bioParents(data, p).find(x => x.side === side)?.person ?? null : null;
    const father = sideOf(root, 'F');
    const mother = sideOf(root, 'M');
    const grandparents: Record<GrandparentSlot, Person | null> = {
        FF: sideOf(father, 'F'), FM: sideOf(father, 'M'), MF: sideOf(mother, 'F'), MM: sideOf(mother, 'M'),
    };
    const name = byName(data);
    return GRANDPARENT_SLOTS.map(slot => {
        const gp = grandparents[slot];
        if (!gp) return { slot, grandparentId: null, deepest: null, personId: null, year: null };
        const walk = walkAncestors(data, gp);
        let depth = 0;
        for (const g of walk.gen.values()) depth = Math.max(depth, g);
        const farthest = depth === 0 ? [gp.id] : walk.order.filter(id => walk.gen.get(id) === depth);
        const yearOfId = new Map(farthest.map(id => [id, birthYearOf(data.persons[id])]));
        farthest.sort((a, b) => (yearOfId.get(a)?.year ?? Infinity) - (yearOfId.get(b)?.year ?? Infinity) || name(a, b));
        const personId = farthest[0];
        return { slot, grandparentId: gp.id, deepest: 2 + depth, personId, year: yearOfId.get(personId) ?? null };
    });
}

/**
 * Where the person's lines end: ancestors without a biological or
 * unspecified parent in the tree, by generation then name (the order the
 * highlight's "Next ›" walks; pass them to startPersonHighlight).
 */
export function lineEndIds(data: StromData, rootId: PersonId): PersonId[] {
    const root = realPerson(data, rootId);
    if (!root) return [];
    const walk = walkAncestors(data, root);
    return walk.order
        .filter(id => bioParents(data, data.persons[id]).length === 0)
        .sort(byGenerationThenName(data, walk.gen));
}

// ==================== 3. rememberers (K4.1, K4.3) ====================

/** What a rememberer's record lacks. */
export type MissingFact = 'deathDate' | 'deathPlace' | 'deathCause' | 'birthPlace';

export interface Rememberer {
    id: PersonId;
    /** A direct ancestor, or a (full or half) sibling of one. */
    kind: 'ancestor' | 'sibling';
    /** Sibling only: they share some but not all of their parents. */
    half: boolean;
    /**
     * The side path from the root to the ancestor ('M','F' = the mother's
     * father); for a sibling, the path of the ancestor they are a sibling of
     * ("the father's father's sister" = ['F','F'] + kind sibling + gender).
     */
    path: ParentSide[];
    /** The ancestor's generation (n), for a sibling the generation of that ancestor. */
    generation: number;
    birthYear: DatedYear | null;
    /** Year of the death date (else death event, burial, cremation), or null. */
    deathYear: number | null;
    /** What only the family may still know: in the order deathDate, deathPlace, deathCause, birthPlace. */
    missing: MissingFact[];
    /** The open question for relatives (Person.question), when one is set. */
    question: string | null;
}

/**
 * The deceased ancestors of the person and their siblings (full and half,
 * through any shared biological or unspecified parent — a placeholder parent
 * counts as shared) whose lives are within living memory: died after
 * (currentYear − 100), or, with no death year, born after (currentYear − 120)
 * (birth year: the birth, else the baptism; death year: the death date, else a
 * death event, the burial, the cremation). Living people (isLivingPerson with
 * inferBirthUpperBounds, as the statistics) are left out; so are the person
 * and their own siblings. A sibling of several ancestors is listed with the
 * nearest one. Each entry says what is missing; the list holds everyone in the
 * window — the UI's "N with gaps" counts those with `missing.length > 0`
 * (remembererGaps). By generation, then name.
 */
export function rememberers(data: StromData, rootId: PersonId, currentYear: number): Rememberer[] {
    const root = realPerson(data, rootId);
    if (!root) return [];
    const walk = walkAncestors(data, root);
    const bounds = inferBirthUpperBounds(data);
    const inWindow = (p: Person): boolean => {
        if (isLivingPerson(p, currentYear, bounds)) return false;
        const died = yearOf(deathDateOf(p));
        if (died !== null) return died > currentYear - 100;
        const born = birthYearOf(p);
        return born !== null && born.year > currentYear - 120;
    };

    const out: Rememberer[] = [];
    const listed = new Set<PersonId>([root.id]);
    const entry = (p: Person, kind: Rememberer['kind'], ancestor: PersonId, half: boolean): Rememberer => ({
        id: p.id, kind, half, path: walk.path.get(ancestor) ?? [], generation: walk.gen.get(ancestor) ?? 0,
        birthYear: birthYearOf(p), deathYear: yearOf(deathDateOf(p)), missing: missingFacts(p),
        question: p.question?.trim() ? p.question : null,
    });
    for (const id of walk.order) {
        listed.add(id);
        const p = data.persons[id];
        if (inWindow(p)) out.push(entry(p, 'ancestor', id, false));
    }
    for (const id of walk.order) {
        const a = data.persons[id];
        const parentsOfA = siblingParents(data, a);
        for (const parentId of parentsOfA) {
            for (const cid of data.persons[parentId]?.childIds ?? []) {
                const c = realPerson(data, cid);
                if (!c || listed.has(c.id) || !isBioTie(c, parentId)) continue;
                listed.add(c.id);
                if (!inWindow(c)) continue;
                out.push(entry(c, 'sibling', id, isHalfSibling(data, a, c)));
            }
        }
    }
    const name = byName(data);
    return out.sort((a, b) => a.generation - b.generation || name(a.id, b.id));
}

/** The rememberers with at least one gap: the people the "Ask the family" list shows. */
export function remembererGaps(list: readonly Rememberer[]): PersonId[] {
    return list.filter(r => r.missing.length > 0).map(r => r.id);
}

/**
 * The rememberers whose death date or death place is missing (the "Where to
 * focus" card: "N people who died in the last 100 years: date or place of
 * death missing").
 */
export function remembererDeathGaps(list: readonly Rememberer[]): PersonId[] {
    return list.filter(r => r.missing.includes('deathDate') || r.missing.includes('deathPlace')).map(r => r.id);
}

/**
 * Whether a sibling of an ancestor is only a half sibling. Parents are matched
 * by role (father / mother, parentSlots). Half when, in some role, both have a
 * real (non-placeholder) parent and the two differ, or when in no role that
 * both have recorded (a placeholder included) they share the parent. A parent
 * missing on one side proves nothing: an ancestor with only a father recorded
 * and a sibling with both parents are full siblings as far as the tree knows.
 */
function isHalfSibling(data: StromData, a: Person, c: Person): boolean {
    const roles = (p: Person): [PersonId | null, PersonId | null] => {
        const [father, mother] = parentSlots(siblingParents(data, p).map(pid => data.persons[pid]).slice(0, 2));
        return [father?.id ?? null, mother?.id ?? null];
    };
    const ra = roles(a);
    const rc = roles(c);
    let bothRecorded = 0;
    let shared = 0;
    for (let i = 0; i < 2; i++) {
        const x = ra[i];
        const y = rc[i];
        if (!x || !y) continue;
        bothRecorded++;
        if (x === y) { shared++; continue; }
        if (realPerson(data, x) && realPerson(data, y)) return true;
    }
    return bothRecorded > 0 && shared === 0;
}

/** Biological or unspecified parents for sibling links, placeholders included (they stand for a shared parent). */
function siblingParents(data: StromData, p: Person): PersonId[] {
    return [...new Set(p.parentIds)].filter(pid => !!data.persons[pid] && isBioTie(p, pid));
}

/**
 * What the record of a death and a birth lacks; a fact on a matching event
 * counts as present. The death date counts only when it is complete (day,
 * month and year, no "about" / "before" / range): a bare year is exactly what
 * the family may still be able to complete.
 */
function missingFacts(p: Person): MissingFact[] {
    const events = p.events ?? [];
    const has = (types: string[], field: 'date' | 'place' | 'cause'): boolean =>
        events.some(e => types.includes(e.type) && !!e[field]?.trim());
    const out: MissingFact[] = [];
    const fullDate = (value?: string): boolean => {
        const d = parseFlexDate(value);
        return !!d && !d.qualifier && !d.end && d.day !== undefined;
    };
    if (!fullDate(p.deathDate) && !events.some(e => e.type === 'death' && fullDate(e.date))) out.push('deathDate');
    if (!p.deathPlace?.trim() && !has(['death'], 'place')) out.push('deathPlace');
    if (!p.deathCause?.trim() && !has(['death', 'burial'], 'cause')) out.push('deathCause');
    if (!p.birthPlace?.trim() && !has(['birth', 'baptism'], 'place')) out.push('birthPlace');
    return out;
}

// ==================== 4. honest age at death (K5.1) ====================

/** Ages above this are implausible and dropped. */
export const MAX_PLAUSIBLE_AGE = 120;
/** "Died under 5". */
export const CHILD_DEATH_AGE = 5;
/** "Adults": those who reached this age. */
export const ADULT_AGE = 15;

/** A person's age at death: an estimate in whole years and the range the data allows. */
export interface DeathAge {
    /** The estimate (ageBetween: a missing month or day counts as mid-period). */
    years: number;
    /** The youngest and oldest the person can have been. */
    min: number;
    max: number;
    from: 'dates' | 'recorded';
}

/** "~1850" → "1850" plus how many years each side may be off. */
function plainDate(value: string): { date: string; slack: number } | null {
    const d = parseFlexDate(value);
    if (!d || d.qualifier === '<' || d.qualifier === '>') return null;
    return { date: toCanonical({ ...d, qualifier: '' }), slack: d.qualifier === '~' ? 1 : 0 };
}

/**
 * The age at death, or null when unknown or implausible. Rules:
 * - From the dates: the birth date, else the baptism (ageBirthDate); the
 *   death date, else a death event, the burial, the cremation (deathDateOf).
 *   The range comes from the dates' precision (born "1862", died
 *   "12. 3. 1919": 56–57) and an approximate date ("~1850") widens it by a
 *   year on that side. A "before" / "after" date (<, >) says too little:
 *   the recorded age is used instead.
 * - Without both dates: the recorded age (Person.deathAge, else the age on a
 *   death or burial event; readRecordedAge): "54 let" = 54, "<1" = under a
 *   year, ">60" = 60 or more; INFANT and STILLBORN = 0; CHILD = 0–7 (GEDCOM:
 *   under 8).
 * - Ages below 0 (death before birth) or above 120 are dropped.
 */
export function deathAgeOf(p: Person): DeathAge | null {
    const birth = ageBirthDate(p);
    const death = deathDateOf(p);
    const b = birth ? plainDate(birth) : null;
    const e = death ? plainDate(death) : null;
    if (b && e) {
        const point = ageBetween(b.date, e.date);
        const range = ageRangeBetween(b.date, e.date);
        if (!point || !range) return null;
        const age: DeathAge = {
            years: point.years, min: Math.max(0, range.min - b.slack - e.slack), max: range.max + b.slack + e.slack, from: 'dates',
        };
        return age.years > MAX_PLAUSIBLE_AGE ? null : age;
    }
    const recorded = readRecordedAge(p.deathAge
        ?? p.events?.find(x => (x.type === 'death' || x.type === 'burial') && x.age?.trim())?.age);
    if (!recorded) return null;
    let age: DeathAge;
    if (recorded.kind === 'word') {
        age = recorded.word === 'CHILD'
            ? { years: 3, min: 0, max: 7, from: 'recorded' }
            : { years: 0, min: 0, max: 0, from: 'recorded' };
    } else {
        const y = recorded.years;
        age = recorded.qualifier === '<' ? { years: Math.max(0, y - 1), min: 0, max: Math.max(0, y - 1), from: 'recorded' }
            : recorded.qualifier === '>' ? { years: y, min: y, max: MAX_PLAUSIBLE_AGE, from: 'recorded' }
            : { years: y, min: y, max: y, from: 'recorded' };
    }
    return age.years > MAX_PLAUSIBLE_AGE ? null : age;
}

export interface DeathAgeSummary {
    /**
     * Of the deaths with a known age, how many were under 5. A person whose
     * age range spans 5 (born "1850", died "1855": 4–5) is left out of `n`.
     */
    diedUnder5: { count: number; n: number };
    /**
     * Median age at death of those who reached 15 (range from 15 up). A range
     * spanning 15 is left out. `median` is null when n = 0.
     */
    adultMedian: { median: number | null; n: number };
}

const median = (values: number[]): number | null => {
    if (values.length === 0) return null;
    const v = values.slice().sort((a, b) => a - b);
    const mid = v.length >> 1;
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};

/**
 * "Died under 5" and "Adult lifespan" instead of the misleading average
 * lifespan (which counted infants). Over `ids` (default: every real person);
 * people without an age at death (deathAgeOf) are not in the sample. Show
 * each number only when hasEnoughSample(n).
 */
export function deathAgeSummary(data: StromData, ids?: Iterable<PersonId>): DeathAgeSummary {
    let under5 = 0, n5 = 0;
    const adults: number[] = [];
    for (const id of ids ?? (Object.keys(data.persons) as PersonId[])) {
        const p = realPerson(data, id);
        const age = p ? deathAgeOf(p) : null;
        if (!age) continue;
        if (age.max < CHILD_DEATH_AGE) { under5++; n5++; } else if (age.min >= CHILD_DEATH_AGE) n5++;
        if (age.min >= ADULT_AGE) adults.push(age.years);
    }
    return { diedUnder5: { count: under5, n: n5 }, adultMedian: { median: median(adults), n: adults.length } };
}

// ==================== 5. generations relative to the person (K5.2) ====================

/**
 * Everyone connected to the person, with their generation relative to them:
 * 0 = the person's generation, −1 parents, −2 grandparents, +1 children…
 * Breadth-first over parent (−1), child (+1) and partner (same) links of any
 * kind (an adoptive parent is a generation up too), so siblings and cousins
 * land by the shared ancestor, partners and in-laws by their partner. The
 * shortest path wins (cousin marriage, an uncle marrying his niece); at equal
 * length parents go before children before partners, in data order.
 * Placeholders are walked through (a placeholder parent joins siblings) but
 * left out of the map.
 */
export function relativeGenerations(data: StromData, rootId: PersonId): Map<PersonId, number> {
    const out = new Map<PersonId, number>();
    if (!realPerson(data, rootId)) return out;
    const partners = new Map<PersonId, PersonId[]>();
    for (const [pid, list] of unionsByPerson(data)) {
        partners.set(pid as PersonId, list.map(u => (u.person1Id === pid ? u.person2Id : u.person1Id)));
    }
    const gen = new Map<PersonId, number>([[rootId, 0]]);
    const queue: PersonId[] = [rootId];
    for (let head = 0; head < queue.length; head++) {
        const id = queue[head];
        const p = data.persons[id];
        const g = gen.get(id)!;
        const visit = (next: PersonId, ng: number) => {
            if (gen.has(next) || !data.persons[next]) return;
            gen.set(next, ng);
            queue.push(next);
        };
        for (const x of p.parentIds) visit(x, g - 1);
        for (const x of p.childIds) visit(x, g + 1);
        for (const x of partners.get(id) ?? []) visit(x, g);
    }
    for (const [id, g] of gen) if (!data.persons[id].isPlaceholder) out.set(id, g);
    return out;
}

export interface GenerationMedian { generation: number; median: number | null; n: number; }
export interface GenerationChildren { generation: number; avgChildren: number; n: number; }

/** Adult age at death (deathAgeSummary's median) per relative generation, ascending. */
export function adultDeathAgeByGeneration(data: StromData, gens: Map<PersonId, number>): GenerationMedian[] {
    const groups = new Map<number, PersonId[]>();
    for (const [id, g] of gens) (groups.get(g) ?? groups.set(g, []).get(g)!).push(id);
    return [...groups.entries()]
        .map(([generation, ids]) => ({ generation, ...deathAgeSummary(data, ids).adultMedian }))
        .filter(x => x.n > 0)
        .sort((a, b) => a.generation - b.generation);
}

/**
 * Children per couple per relative generation, counted like the statistics'
 * computeFamilyStats: every union whose two persons exist (childless ones
 * too, all child ids), in the later generation of the two partners — here the
 * larger relative number. Unions with neither partner connected are skipped;
 * a placeholder partner takes no part. Averages rounded to 0.1.
 */
export function childrenPerCoupleByGeneration(data: StromData, gens: Map<PersonId, number>): GenerationChildren[] {
    const acc = new Map<number, { sum: number; n: number }>();
    for (const u of Object.values(data.partnerships ?? {}) as Partnership[]) {
        if (!data.persons[u.person1Id] || !data.persons[u.person2Id]) continue;
        const known = [gens.get(u.person1Id), gens.get(u.person2Id)].filter((g): g is number => g !== undefined);
        if (known.length === 0) continue;
        const g = Math.max(...known);
        const a = acc.get(g) ?? { sum: 0, n: 0 };
        a.sum += u.childIds.length; a.n += 1;
        acc.set(g, a);
    }
    return [...acc.entries()]
        .map(([generation, { sum, n }]) => ({ generation, avgChildren: Math.round((sum / n) * 10) / 10, n }))
        .sort((a, b) => a.generation - b.generation);
}

/** Years in one period of "Adult lifespan by birth period". */
export const BIRTH_PERIOD_YEARS = 50;

/** One birth period ("1800–1849") with its adults' median age at death. */
export interface PeriodMedian { from: number; to: number; median: number; n: number; }

/**
 * Adult lifespan per birth period: the median age at death of those who
 * reached 15 (deathAgeSummary's rule: an age range from 15 up), grouped by the
 * birth year (birthYearOf: the birth, else the baptism) into periods of
 * `years` starting at a multiple of it (1800–1849, 1850–1899). Over `ids`
 * (default: every real person). Only periods with hasEnoughSample(n), oldest
 * first; a period without enough adults is left out.
 */
export function adultLifespanByBirthPeriod(
    data: StromData, ids?: Iterable<PersonId>, years: number = BIRTH_PERIOD_YEARS,
): PeriodMedian[] {
    const groups = new Map<number, number[]>();
    for (const id of ids ?? (Object.keys(data.persons) as PersonId[])) {
        const p = realPerson(data, id);
        if (!p) continue;
        const age = deathAgeOf(p);
        const born = birthYearOf(p);
        if (!age || !born || age.min < ADULT_AGE) continue;
        const from = Math.floor(born.year / years) * years;
        (groups.get(from) ?? groups.set(from, []).get(from)!).push(age.years);
    }
    return [...groups.entries()]
        .filter(([, ages]) => hasEnoughSample(ages.length))
        .map(([from, ages]) => ({ from, to: from + years - 1, median: median(ages)!, n: ages.length }))
        .sort((a, b) => a.from - b.from);
}

// ==================== 6. generation names (Decision 17 Oct) ====================

/** "parents", "grandparents", "great-grandparents", "2nd great-grandparents"… (n ≥ 1). */
export function ancestorGenerationName(n: number): string {
    return strings.treeOverview.ancestorGeneration(n);
}

/** "children", "grandchildren", "great-grandchildren", "2nd great-grandchildren"… (n ≥ 1). */
export function descendantGenerationName(n: number): string {
    return strings.treeOverview.descendantGeneration(n);
}

/** A relative generation's name: −n ancestors, 0 the person's own, +n descendants. */
export function relativeGenerationName(offset: number): string {
    if (offset < 0) return ancestorGenerationName(-offset);
    if (offset > 0) return descendantGenerationName(offset);
    return strings.treeOverview.sameGeneration;
}

/**
 * A generation relative to a person, in a language: n > 0 ancestors (1 =
 * parents), n < 0 descendants (−1 = children), 0 the person's own.
 * 'plural' names the people ("grandparents"), 'of' the generation as a whole
 * ("grandparents' generation"). The one name every overview section uses.
 */
export function ancestorGenerationLabel(n: number, lang: Language, form: 'plural' | 'of' = 'plural'): string {
    const t = getStringsForLang(lang).treeOverview;
    if (n > 0) return form === 'of' ? t.ancestorGenerationOf(n) : t.ancestorGeneration(n);
    if (n < 0) return form === 'of' ? t.descendantGenerationOf(-n) : t.descendantGeneration(-n);
    return form === 'of' ? t.sameGenerationOf : t.sameGeneration;
}

// ==================== 7. header (unified definitions) ====================

export interface OverviewHeader {
    /** Real persons (placeholders excluded). Replaces both dialogs' "People". */
    persons: number;
    /**
     * Generation rows of the tree: distinct assignGenerations values among
     * real persons — the same number as the statistics' "Generations" tile
     * (computeFamilyStats().generations) and tree health's structure tile.
     */
    generations: number;
    /** First and last birth year (birth dates only), as the statistics' "Year span" tile; null without one. */
    yearSpan: { first: number; last: number } | null;
    /**
     * Real persons with a source on themselves, an event or one of their
     * unions (personEvidence().sources > 0). Replaces the statistics' "Source
     * coverage" (which missed union sources), so with tree health's "People
     * without a source" it adds up to all persons.
     */
    withSource: number;
    /** withSource / persons (0 for an empty tree). */
    withSourceShare: number;
    /**
     * Unconnected families (findComponents), not counting islands made only
     * of placeholders (as the statistics' banner; tree health counted them).
     * 1 = everyone is connected.
     */
    islands: number;
}

export function overviewHeader(data: StromData): OverviewHeader {
    const persons = Object.values(data.persons).filter(p => !p.isPlaceholder);
    const gen = assignGenerations(data);
    const rows = new Set<number>();
    const unions = unionsByPerson(data);
    let first = Infinity, last = -Infinity, withSource = 0;
    for (const p of persons) {
        rows.add(gen.get(p.id) ?? 0);
        const y = yearOf(p.birthDate);
        if (y !== null) { first = Math.min(first, y); last = Math.max(last, y); }
        if ((personEvidence(p, data, unions)?.sources ?? 0) > 0) withSource++;
    }
    return {
        persons: persons.length,
        generations: rows.size,
        yearSpan: first === Infinity ? null : { first, last },
        withSource,
        withSourceShare: persons.length > 0 ? withSource / persons.length : 0,
        islands: findComponents(data).filter(c => c.count > 0).length,
    };
}

// ==================== research certainty (K5.3) ====================

/** How many facts of one kind carry each research status. */
export interface CertaintyCounts {
    proven: number;
    probable: number;
    possible: number;
    lead: number;
    /** proven + probable + possible + lead (facts without a status are not counted). */
    total: number;
}

export interface ResearchCertainty {
    birth: CertaintyCounts;
    death: CertaintyCounts;
    marriage: CertaintyCounts;
}

/**
 * The research's statuses (FactStatus) of births, deaths and marriages, for
 * the "Certainty of research facts" bars of a research tree. A birth or a
 * death counts once per real person: the status of the birth / death fields,
 * else the status of a birth / death event. A marriage counts once per union
 * with at least one real partner: the status of the wedding fields
 * (Partnership.startStatus). A fact without a status is not counted — it is
 * not "uncertain", the research simply has not graded it.
 */
export function researchCertainty(data: StromData): ResearchCertainty {
    const empty = (): CertaintyCounts => ({ proven: 0, probable: 0, possible: 0, lead: 0, total: 0 });
    const out: ResearchCertainty = { birth: empty(), death: empty(), marriage: empty() };
    const add = (c: CertaintyCounts, status: FactStatus | undefined): void => {
        if (!status || !(FACT_STATUSES as readonly string[]).includes(status)) return;
        c[status]++;
        c.total++;
    };
    for (const p of Object.values(data.persons)) {
        if (p.isPlaceholder) continue;
        add(out.birth, p.birthStatus ?? p.events?.find(e => e.type === 'birth' && e.status)?.status);
        add(out.death, p.deathStatus ?? p.events?.find(e => e.type === 'death' && e.status)?.status);
    }
    for (const u of Object.values(data.partnerships)) {
        if (!realPerson(data, u.person1Id) && !realPerson(data, u.person2Id)) continue;
        add(out.marriage, u.startStatus);
    }
    return out;
}

// ==================== percentages ====================

/**
 * The number part of a percentage, the one format of the whole overview:
 * whole numbers from 10 % on ("62"), under 10 % one decimal unless it is zero
 * ("5", "0,2"), formatted by the language (Intl.NumberFormat: "2,5" in Czech
 * and German, "2.5" in English). Honest at both ends: "0" only when nothing
 * is there ("< 0,1" for a share above zero that would round to 0) and "100"
 * only when nothing is missing ("99" / "99,9" otherwise).
 */
export function percentNumber(part: number, whole: number, lang: Language): string {
    if (whole <= 0 || part <= 0) return '0';
    if (part >= whole) return format(lang, 0).format(100);
    const p = (part / whole) * 100;
    if (p >= 10) return format(lang, 0).format(Math.min(99, Math.round(p)));
    const tenths = Math.round(p * 10);
    if (tenths === 0) return `<\u00a0${format(lang, 1).format(0.1)}`;
    return format(lang, tenths % 10 === 0 ? 0 : 1).format(tenths / 10);
}

const percentFormats = new Map<string, Intl.NumberFormat>();
/** A cached number format of a language with exactly `digits` decimals. */
function format(lang: Language, digits: number): Intl.NumberFormat {
    const key = `${lang}|${digits}`;
    let f = percentFormats.get(key);
    if (!f) {
        f = new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
        percentFormats.set(key, f);
    }
    return f;
}

// ==================== 8. focus cards (K2.1) ====================

/** At most this many cards in "Where to focus". */
export const MAX_FOCUS_CARDS = 3;

/** The "births without a documented birth" card looks at the direct ancestors up to this generation. */
export const FOCUS_BIRTH_GENERATIONS = 4;

/** The direct ancestors of generations 1…FOCUS_BIRTH_GENERATIONS whose birth no source cites (the card's people). */
export function focusBirthNoSource(overview: AncestorOverview): PersonId[] {
    return overview.birthNoSource.filter(id => (overview.generationOf.get(id) ?? Infinity) <= FOCUS_BIRTH_GENERATIONS);
}

/** A generation counts as a gap when more than this share of its places is missing. */
export const GENERATION_GAP_SHARE = 1 / 4;

export type FocusCard =
    /** Validation errors → Fix (validation details). */
    | { kind: 'validation'; count: number }
    /**
     * The nearest ancestor generation whose places are filled less than three
     * quarters (repeated ancestors fill places too): count = expected − filled;
     * ids = gapIds.
     */
    | { kind: 'ancestorGap'; count: number; n: number; known: number; filled: number; expected: number; ids: PersonId[] }
    /** Direct ancestors' births without a source. */
    | { kind: 'birthNoSource'; count: number; ids: PersonId[] }
    /** Rememberers missing a death date or place (remembererDeathGaps). */
    | { kind: 'rememberers'; count: number; ids: PersonId[] }
    /** What waits for the user in the research (research trees only). */
    | { kind: 'researchWaiting'; count: number };

export interface FocusCardInput {
    /** validateTreeData(data).stats.errors */
    validationErrors: number;
    /** ancestorGenerations(...).generations ([] without a chosen person). */
    generations: readonly AncestorGeneration[];
    /** ancestorGenerations(...).birthNoSource */
    ancestorBirthsNoSource: readonly PersonId[];
    /** remembererDeathGaps(rememberers(...)) ([] without a chosen person). */
    rememberers: readonly PersonId[];
    /** Items waiting in the research; undefined for a tree that is not a research tree. */
    researchWaiting?: number;
}

/**
 * The cards of "Where to focus", in the fixed order validation errors →
 * nearest ancestor generation with less than three quarters of its places
 * filled (filled < 3/4 · expected, a generation without gapIds never) → direct ancestors' births without a source → rememberers →
 * research waiting; the first MAX_FOCUS_CARDS that apply. Empty: the tree is
 * in good shape (strings.treeOverview.goodShape).
 */
export function selectFocusCards(input: FocusCardInput): FocusCard[] {
    const cards: FocusCard[] = [];
    if (input.validationErrors > 0) cards.push({ kind: 'validation', count: input.validationErrors });
    const gap = input.generations.find(g =>
        g.gapIds.length > 0 && g.filled < g.expected * (1 - GENERATION_GAP_SHARE));
    if (gap) {
        cards.push({
            kind: 'ancestorGap', count: gap.expected - gap.filled, n: gap.n, known: gap.known, filled: gap.filled,
            expected: gap.expected, ids: [...gap.gapIds],
        });
    }
    if (input.ancestorBirthsNoSource.length > 0) {
        cards.push({ kind: 'birthNoSource', count: input.ancestorBirthsNoSource.length, ids: [...input.ancestorBirthsNoSource] });
    }
    if (input.rememberers.length > 0) {
        cards.push({ kind: 'rememberers', count: input.rememberers.length, ids: [...input.rememberers] });
    }
    if (input.researchWaiting !== undefined && input.researchWaiting > 0) {
        cards.push({ kind: 'researchWaiting', count: input.researchWaiting });
    }
    return cards.slice(0, MAX_FOCUS_CARDS);
}
