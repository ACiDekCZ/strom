/**
 * Whom to add (spec 134 §5) and the unlinked groups (§6), over the data
 * alone: which new people of the import link to the tree's people and
 * through whom, who loses the one way to the tree when a person is
 * unticked, the variants of step 3, the living among the new, and the groups
 * of new people with no way to the tree. No DOM; buildPlan and the step 3
 * UI share these.
 *
 * Words: "joined" = a person of the import the plan joins with a person of
 * the tree; "new" = a person of the import the plan would add (not joined,
 * not left out in step 2, not an undecided pair, not scope d). A "?" of the
 * import that is not joined is a way between people, never a person.
 */

import { Person, PersonId, StromData } from '../types.js';
import { strings } from '../strings.js';
import { existingTargetOf, AUTO_CONFIRM_SCORE } from './executor.js';
import { MergeState } from './types.js';
import { findRelationship, KinshipTerm } from '../kinship.js';
import { selection as lineageSelection } from '../lineage.js';
import { inferBirthUpperBounds, isLivingPerson } from '../privacy.js';
import { masculineFormIn, sameSurname, surnameKey } from '../surnames.js';
import { yearOf } from '../dates.js';
import { isAncestorOrSelf } from './merge-check.js';
import { normalizeSingleParents, isPurePlaceholder, fillPlaceholder } from '../single-parent.js';
import { generatePartnershipId } from '../ids.js';
import type { WizardChoices } from './plan.js';

// ==================== THE NEW PEOPLE ====================

/** What a person of the import is before step 3. */
export type BaseFate = 'joined' | 'step2' | 'pending' | 'scope' | 'new';

/**
 * Each named person of the import before step 3 (the rules of buildPlan):
 * left out in step 2, joined, an undecided pair, left out by scope d), or new.
 * A new tree has no one joined, no pair, no scope.
 */
export function baseFates(state: MergeState, w: Pick<WizardChoices, 'mode' | 'scope'>): Map<PersonId, BaseFate> {
    const out = new Map<PersonId, BaseFate>();
    const newTree = w.mode === 'new';
    const scored = new Map<PersonId, number>();
    if (!newTree) for (const m of state.matches) scored.set(m.incomingId, m.score);
    for (const p of Object.values(state.incomingData.persons)) {
        if (p.isPlaceholder) continue;
        if (newTree) { out.set(p.id, 'new'); continue; }
        const decision = state.decisions.get(p.id);
        if (decision?.type === 'skip') { out.set(p.id, 'step2'); continue; }
        const at = existingTargetOf(state, p.id);
        if (at && state.existingData.persons[at]) { out.set(p.id, 'joined'); continue; }
        const score = scored.get(p.id);
        if (score !== undefined && !decision && score < AUTO_CONFIRM_SCORE) { out.set(p.id, 'pending'); continue; }
        out.set(p.id, w.scope === 'd' ? 'scope' : 'new');
    }
    return out;
}

/** The new people of the import (step 3's list), in the import's order. */
export function newPersons(state: MergeState, w: Pick<WizardChoices, 'mode' | 'scope'>): PersonId[] {
    return [...baseFates(state, w)].filter(([, f]) => f === 'new').map(([id]) => id);
}

/** The joined persons of the import ("?" joined with the tree's "?" included): source id → the tree's id. */
function joinedOf(state: MergeState, w: Pick<WizardChoices, 'mode' | 'scope'>): Map<PersonId, PersonId> {
    const out = new Map<PersonId, PersonId>();
    if (w.mode === 'new') return out;
    for (const p of Object.values(state.incomingData.persons)) {
        if (!p.isPlaceholder && state.decisions.get(p.id)?.type === 'skip') continue;
        const at = existingTargetOf(state, p.id);
        if (at && state.existingData.persons[at]) out.set(p.id, at);
    }
    return out;
}

/**
 * Who step 3 keeps: the ticked new people, and the people kept as a "?"
 * (`standIns`; ways between people, not people added).
 */
export interface Selection {
    ticked: ReadonlySet<PersonId>;
    standIns: ReadonlySet<PersonId>;
}

/** The selection the choices make: the new people but the left out ones (and the living, with skipLiving); the "?" ones apart. */
export function selectionOf(state: MergeState, w: WizardChoices): Selection {
    const fresh = newPersons(state, w);
    const freshSet = new Set(fresh);
    const standIns = new Set((w.placeholders ?? []).filter(id => freshSet.has(id)));
    const left = new Set(w.leftOut ?? []);
    const living = w.skipLiving ? new Set(livingNew(state, w)) : null;
    const ticked = new Set(fresh.filter(id => !standIns.has(id) && !left.has(id) && !living?.has(id)));
    return { ticked, standIns };
}

// ==================== THE GRAPH ====================

/** How a person is related to a neighbour: the person is the neighbour's parent, child or partner. */
export type NewRel = 'parent' | 'child' | 'partner';

interface Graph { neighbors: Map<PersonId, Array<[PersonId, NewRel]>> }

const graphs = new WeakMap<StromData, Graph>();

/** Parents, children and partners of every person of the import (worked out once per data). */
function graphOf(data: StromData): Graph {
    let g = graphs.get(data);
    if (g) return g;
    const neighbors = new Map<PersonId, Array<[PersonId, NewRel]>>();
    const add = (a: PersonId, b: PersonId, rel: NewRel): void => {
        if (a === b || !data.persons[a] || !data.persons[b]) return;
        const list = neighbors.get(a) ?? neighbors.set(a, []).get(a)!;
        if (!list.some(([id]) => id === b)) list.push([b, rel]);
    };
    for (const p of Object.values(data.persons)) {
        for (const par of p.parentIds) { add(p.id, par, 'child'); add(par, p.id, 'parent'); }
        for (const ch of p.childIds) { add(p.id, ch, 'parent'); add(ch, p.id, 'child'); }
    }
    for (const u of Object.values(data.partnerships)) {
        add(u.person1Id, u.person2Id, 'partner');
        add(u.person2Id, u.person1Id, 'partner');
    }
    graphs.set(data, g = { neighbors });
    return g;
}

/** Where a new person links to the tree (step 3's "links via"). */
export interface NewConnection {
    /** The joined person of the import the way ends at. */
    viaSource: PersonId;
    /** That person in the tree. */
    via: PersonId;
    /** People on the way (1: a parent, child or partner of the joined person). */
    steps: number;
    /** The next person on the way to the tree (the joined one at 1 step). */
    next: PersonId;
    /** What the person is to `next`. */
    rel: NewRel;
    /** The way: the person first, the joined person last. */
    path: PersonId[];
}

/**
 * Breadth-first from every joined person over the import's parents,
 * children and partners, through the people in `through` (and the import's
 * own "?"). The first way found to each person is its shortest.
 */
function reach(state: MergeState, joined: Map<PersonId, PersonId>, through: (id: PersonId) => boolean): Map<PersonId, { from: PersonId; rel: NewRel; root: PersonId; steps: number }> {
    const source = state.incomingData;
    const { neighbors } = graphOf(source);
    const seen = new Map<PersonId, { from: PersonId; rel: NewRel; root: PersonId; steps: number }>();
    let frontier: PersonId[] = [...joined.keys()];
    const isSeed = (id: PersonId): boolean => joined.has(id);
    for (let steps = 1; frontier.length; steps++) {
        const next: PersonId[] = [];
        for (const id of frontier) {
            const root = isSeed(id) ? id : seen.get(id)!.root;
            for (const [n, relOfN] of neighbors.get(id) ?? []) {
                if (isSeed(n) || seen.has(n)) continue;
                const p = source.persons[n];
                if (!p || !(through(n) || p.isPlaceholder)) continue;
                // relOfN: what `id` is to n, so n is its inverse to id.
                seen.set(n, { from: id, rel: inverse(relOfN), root, steps });
                next.push(n);
            }
        }
        frontier = next;
    }
    return seen;
}

/** The other side of a relation: the parent of someone has them as a child. */
function inverse(r: NewRel): NewRel {
    return r === 'parent' ? 'child' : r === 'child' ? 'parent' : 'partner';
}

/**
 * The new people that link to the tree, each with the joined person the
 * shortest way ends at (§5 "links via"). `selection`: only the ticked and
 * "?" people carry a way (default: every new person, the list of step 3).
 */
export function connectedNew(state: MergeState, w: WizardChoices, selection?: Selection): Map<PersonId, NewConnection> {
    const joined = joinedOf(state, w);
    const fresh = new Set(newPersons(state, w));
    const carries = selection
        ? (id: PersonId): boolean => selection.ticked.has(id) || selection.standIns.has(id)
        : (id: PersonId): boolean => fresh.has(id);
    const seen = reach(state, joined, carries);
    const out = new Map<PersonId, NewConnection>();
    for (const [id, s] of seen) {
        if (!fresh.has(id)) continue;
        if (selection && !selection.ticked.has(id)) continue;
        const path: PersonId[] = [id];
        let at = id;
        while (!joined.has(at)) { at = seen.get(at)!.from; path.push(at); }
        out.set(id, { viaSource: s.root, via: joined.get(s.root)!, steps: s.steps, next: path[1], rel: s.rel, path });
    }
    return out;
}

/** The kinship words of a new person to the next one on its way ("father", "child"), from the import; null when none. */
export function connectionTerm(state: MergeState, id: PersonId, c: Pick<NewConnection, 'next'>): KinshipTerm | null {
    return findRelationship(state.incomingData, c.next, id)?.term ?? null;
}

/** The people of the selection with a way to the tree. */
function linkedSet(state: MergeState, w: WizardChoices, sel: Selection): Set<PersonId> {
    const seen = reach(state, joinedOf(state, w), id => sel.ticked.has(id) || sel.standIns.has(id));
    return new Set([...seen.keys()].filter(id => sel.ticked.has(id)));
}

/**
 * The ticked new people who lose their only way to the tree when `ids` are
 * unticked (K4.3), nearest to them first. Empty when another way remains
 * for everybody.
 */
export function dependentsVia(state: MergeState, w: WizardChoices, ids: PersonId | readonly PersonId[], sel: Selection): PersonId[] {
    const off = new Set(typeof ids === 'string' ? [ids] : ids);
    const before = linkedSet(state, w, sel);
    const without: Selection = {
        ticked: new Set([...sel.ticked].filter(id => !off.has(id))),
        standIns: new Set([...sel.standIns].filter(id => !off.has(id))),
    };
    const after = linkedSet(state, w, without);
    const lost = new Set([...before].filter(id => !off.has(id) && !after.has(id)));
    // Nearest first: breadth-first from the unticked over the lost ones.
    const { neighbors } = graphOf(state.incomingData);
    const out: PersonId[] = [];
    const seen = new Set<PersonId>(off);
    let frontier = [...off];
    while (frontier.length) {
        const next: PersonId[] = [];
        for (const id of frontier) {
            for (const [n] of neighbors.get(id) ?? []) {
                if (seen.has(n)) continue;
                seen.add(n);
                if (lost.has(n)) out.push(n);
                if (lost.has(n) || state.incomingData.persons[n]?.isPlaceholder) next.push(n);
            }
        }
        frontier = next;
    }
    for (const id of lost) if (!seen.has(id)) out.push(id);
    return out;
}

// ==================== VARIANTS (§5) ====================

export type Generations = 2 | 4 | 'all';

/** Step 3's variants: they tick the new people, each can then be changed by hand. */
export type SelectVariant =
    | { kind: 'all' }
    | { kind: 'linked'; steps: 1 | 2 | 3 | 4 | 5 }
    | { kind: 'ancestors'; person: PersonId; generations: Generations }
    | { kind: 'descendants'; person: PersonId; generations: Generations }
    | { kind: 'rod'; surname: string }
    | { kind: 'manual' };

/** The person's ancestors in the import (the person not included), up to `generations`. */
export function ancestorsOf(source: StromData, person: PersonId, generations: Generations): PersonId[] {
    const sel = lineageSelection(source, { kind: 'ancestors', personId: person, ...(generations === 'all' ? {} : { generations }) });
    return sel.memberIds.filter(id => id !== person && !source.persons[id]?.isPlaceholder);
}

/** The person's descendants in the import (the person not included) and the partners who married in, up to `generations`. */
export function descendantsOf(source: StromData, person: PersonId, generations: Generations): PersonId[] {
    const sel = lineageSelection(source, { kind: 'descendants', personId: person, ...(generations === 'all' ? {} : { generations }) });
    return sel.personIds.filter(id => id !== person && !source.persons[id]?.isPlaceholder);
}

/**
 * The new people a variant ticks (the others it unticks). Ancestors and
 * descendants are the person's in the import, only those not in the tree;
 * the person too, when new. A family: the new people whose surname is a
 * form of it. Only linked: the new people at most `steps` people from a
 * joined one.
 */
export function variantSelection(state: MergeState, w: WizardChoices, v: SelectVariant): Set<PersonId> {
    const fresh = newPersons(state, w);
    const freshSet = new Set(fresh);
    const source = state.incomingData;
    const only = (ids: Iterable<PersonId>): Set<PersonId> => new Set([...ids].filter(id => freshSet.has(id)));
    switch (v.kind) {
        case 'all': return new Set(fresh);
        case 'manual': return new Set();
        case 'linked': {
            const out = new Set<PersonId>();
            for (const [id, c] of connectedNew(state, w)) if (c.steps <= v.steps) out.add(id);
            return out;
        }
        case 'ancestors': return only([v.person, ...ancestorsOf(source, v.person, v.generations)]);
        case 'descendants': return only([v.person, ...descendantsOf(source, v.person, v.generations)]);
        case 'rod': {
            const name = v.surname.trim();
            if (!name) return new Set();
            return new Set(fresh.filter(id => {
                const last = source.persons[id]?.lastName?.trim();
                return !!last && sameSurname(last, name, source);
            }));
        }
    }
}

/** The ids left out for a ticked set (WizardChoices.leftOut): every new person not ticked. */
export function leftOutFor(state: MergeState, w: WizardChoices, ticked: ReadonlySet<PersonId>): PersonId[] {
    return newPersons(state, w).filter(id => !ticked.has(id));
}

// ==================== LIVING (K4.5) ====================

const bounds = new WeakMap<StromData, Map<string, number>>();

/**
 * The new people the privacy rules treat as living (the same rule as the
 * Table, the exports and sharing: isLivingPerson with the birth bounds
 * inferred from the import).
 */
export function livingNew(state: MergeState, w: Pick<WizardChoices, 'mode' | 'scope'>, year: number = new Date().getFullYear()): PersonId[] {
    const source = state.incomingData;
    let b = bounds.get(source);
    if (!b) bounds.set(source, b = inferBirthUpperBounds(source));
    const known = b;
    return newPersons(state, w).filter(id => isLivingPerson(source.persons[id], year, known));
}

// ==================== UNLINKED GROUPS (§6) ====================

export interface UnlinkedGroup {
    /** Stable while the group keeps its first person: 'g:<id>', 'singles', 'all', or '<key>/<surname>' when split. */
    key: string;
    kind: 'family' | 'singles' | 'all' | 'rod';
    title: string;
    /** The group's people, in the import's order. */
    persons: PersonId[];
    years: { from: number; to: number } | null;
    /** Places of birth and death, most frequent first (at most 3). */
    places: string[];
}

/** A group's decision (K4.4): link to a person, add unlinked, a separate tree, or do not add. */
export type GroupDecision =
    | { kind: 'connect'; person: PersonId; rel: NewRel; to: PersonId; in: 'tree' | 'import' }
    | { kind: 'loose' }
    | { kind: 'own-tree' }
    | { kind: 'skip' };

/**
 * The ticked new people with no way to the tree, in groups: each set of
 * them related among themselves is a group; people with no relative among
 * them are one group "Individuals" (6e); when nobody of the import is
 * joined at all, every one of them is one group of the whole import (6f).
 * A key in `split` divides that group by family (surname). Largest first,
 * the individuals last.
 */
export function unlinkedGroups(state: MergeState, w: WizardChoices, sel: Selection = selectionOf(state, w), split: ReadonlySet<string> = new Set(w.splitGroups ?? [])): UnlinkedGroup[] {
    if (w.mode !== 'add' || w.scope === 'd') return [];
    const source = state.incomingData;
    const linked = linkedSet(state, w, sel);
    const order = Object.keys(source.persons) as PersonId[];
    const unlinked = order.filter(id => sel.ticked.has(id) && !linked.has(id));
    if (!unlinked.length) return [];
    const groups: UnlinkedGroup[] = [];
    const make = (key: string, kind: UnlinkedGroup['kind'], persons: PersonId[]): UnlinkedGroup =>
        ({ key, kind, persons, title: groupTitle(source, persons, kind), years: groupYears(source, persons), places: groupPlaces(source, persons) });
    const push = (g: UnlinkedGroup): void => {
        if (!split.has(g.key)) { groups.push(g); return; }
        for (const [surname, persons] of bySurname(source, g.persons)) {
            const sub = make(`${g.key}/${surnameKey(surname) || '-'}`, 'rod', persons);
            if (surname) sub.title = strings.mergeWizard.groupFamily(surname, sub.places[0] ?? '');
            groups.push(sub);
        }
    };
    if (joinedOf(state, w).size === 0) {
        push(make('all', 'all', unlinked));
        return groups;
    }
    const unlinkedSet = new Set(unlinked);
    const joined = joinedOf(state, w);
    const index = new Map(order.map((id, i) => [id, i]));
    const { neighbors } = graphOf(source);
    const done = new Set<PersonId>();
    const singles: PersonId[] = [];
    for (const start of unlinked) {
        if (done.has(start)) continue;
        const members: PersonId[] = [];
        const stack = [start];
        const visited = new Set<PersonId>([start]);
        while (stack.length) {
            const id = stack.pop()!;
            if (unlinkedSet.has(id)) { members.push(id); done.add(id); }
            for (const [n] of neighbors.get(id) ?? []) {
                if (visited.has(n)) continue;
                const p = source.persons[n];
                // Through the group's people, the "?" kept, the import's own "?" that no one joined.
                if (unlinkedSet.has(n) || sel.standIns.has(n) || (p?.isPlaceholder && !joined.has(n))) {
                    visited.add(n);
                    stack.push(n);
                }
            }
        }
        if (members.length === 1) { singles.push(members[0]); continue; }
        members.sort((a, b) => index.get(a)! - index.get(b)!);
        push(make(`g:${members[0]}`, 'family', members));
    }
    groups.sort((a, b) => b.persons.length - a.persons.length);
    if (singles.length) push(make('singles', 'singles', singles));
    return groups;
}

/** The people by surname (its masculine form where the rules give one), most people first. */
function bySurname(source: StromData, persons: readonly PersonId[]): Array<[string, PersonId[]]> {
    const out = new Map<string, { name: string; ids: PersonId[] }>();
    for (const id of persons) {
        const name = familyName(source, source.persons[id]);
        const key = surnameKey(name);
        const entry = out.get(key) ?? out.set(key, { name, ids: [] }).get(key)!;
        entry.ids.push(id);
    }
    return [...out.values()].sort((a, b) => b.ids.length - a.ids.length).map(e => [e.name, e.ids]);
}

function familyName(source: StromData, p: Person | undefined): string {
    const last = p?.lastName?.trim() ?? '';
    if (!last || last === '?') return '';
    return masculineFormIn(last, source) ?? last;
}

function displayName(p: Person | undefined): string {
    return p ? [p.firstName, p.lastName].filter(n => n && n !== '?').join(' ').trim() : '';
}

/**
 * A group's name: "{name} and children" for a parent and their children,
 * else its most frequent surname with its most frequent place; the
 * individuals and the whole import by their kind.
 */
export function groupTitle(source: StromData, persons: readonly PersonId[], kind: UnlinkedGroup['kind'] = 'family'): string {
    const t = strings.mergeWizard;
    if (kind === 'singles') return t.groupSingles;
    if (kind === 'all') return t.groupAll;
    if (persons.length >= 2) {
        const head = persons.find(id => persons.every(o => o === id || source.persons[id]?.childIds.includes(o)));
        if (head) return t.groupWithChildren(displayName(source.persons[head]) || '?');
    }
    const [surname] = bySurname(source, persons).find(([s]) => !!s) ?? [''];
    const place = groupPlaces(source, persons)[0] ?? '';
    if (!surname) return displayName(source.persons[persons[0]]) || t.groupSingles;
    return t.groupFamily(surname, place);
}

function groupYears(source: StromData, persons: readonly PersonId[]): { from: number; to: number } | null {
    let from = Infinity;
    let to = -Infinity;
    for (const id of persons) {
        const p = source.persons[id];
        for (const y of [yearOf(p?.birthDate), yearOf(p?.deathDate)]) {
            if (y === null) continue;
            from = Math.min(from, y);
            to = Math.max(to, y);
        }
    }
    return from === Infinity ? null : { from, to };
}

/** The settlement of a place written "Křemenná, okres …" (its first part). */
const placeHead = (s: string): string => s.split(',')[0].trim();

function groupPlaces(source: StromData, persons: readonly PersonId[]): string[] {
    const count = new Map<string, number>();
    for (const id of persons) {
        const p = source.persons[id];
        for (const pl of [p?.birthPlace, p?.deathPlace]) {
            const head = pl ? placeHead(pl) : '';
            if (head) count.set(head, (count.get(head) ?? 0) + 1);
        }
    }
    return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([name]) => name);
}

// ==================== WRITING STEP 3'S CHOICES ====================

/** A "?" in place of a person (the "Keep as ?" of K4.3): its links and nothing else. */
export function standInOf(p: Person): Person {
    return {
        id: p.id, firstName: '?', lastName: '', gender: p.gender, isPlaceholder: true,
        partnerships: [...p.partnerships], parentIds: [...p.parentIds], childIds: [...p.childIds],
    };
}

/**
 * The import as the write takes it: each person kept as a "?" replaced by
 * one (no name, no dates, no files of its own). Shallow: the import itself
 * is not changed; nothing is copied when no one is kept as a "?".
 */
export function sourceWithStandIns(source: StromData, standIns: readonly PersonId[]): StromData {
    if (!standIns.length) return source;
    const ids = new Set(standIns);
    const persons = { ...source.persons };
    for (const id of ids) if (persons[id]) persons[id] = standInOf(persons[id]);
    const out: StromData = { ...source, persons };
    if (source.media) {
        const media: NonNullable<StromData['media']> = {};
        for (const [key, att] of Object.entries(source.media)) {
            const places = att.places.filter(pl => !('personId' in pl && ids.has(pl.personId)));
            if (places.length === att.places.length) media[key] = att;
            else if (places.length) media[key] = { ...att, places };
        }
        out.media = media;
    }
    return out;
}

/**
 * Link `a` and `b` in written data (a group's "link to a person"): `a` is
 * the `rel` of `b`. A third parent, a cycle in the ancestry or a person
 * missing refuses (false, nothing changed). A child gets the family of its
 * two parents (the existing one, or a new one), or a "?" family when the
 * link gives it its only parent.
 */
export function linkPersons(data: StromData, a: PersonId, rel: NewRel, b: PersonId): boolean {
    const pa = data.persons[a];
    const pb = data.persons[b];
    if (!pa || !pb || a === b) return false;
    if (rel === 'partner') {
        const known = pa.partnerships.some(uid => {
            const u = data.partnerships[uid];
            return !!u && (u.person1Id === b || u.person2Id === b);
        });
        if (known) return true;
        const male = pa.gender === 'female' && pb.gender !== 'female' ? pb : pa;
        const other = male === pa ? pb : pa;
        const id = generatePartnershipId();
        data.partnerships[id] = { id, person1Id: male.id, person2Id: other.id, childIds: [], status: 'married' };
        pa.partnerships.push(id);
        pb.partnerships.push(id);
        return true;
    }
    const parentId = rel === 'parent' ? a : b;
    const childId = rel === 'parent' ? b : a;
    const parent = data.persons[parentId];
    const child = data.persons[childId];
    if (child.parentIds.includes(parentId)) return true;
    if (isAncestorOrSelf(data, childId, parentId)) return false;
    const stand = child.parentIds.length >= 2 ? child.parentIds.find(pid => isPurePlaceholder(data, pid)) : undefined;
    if (child.parentIds.length >= 2 && !stand) return false;
    if (stand) {
        fillPlaceholder(data, stand, parentId, [childId]);
        if (!parent.childIds.includes(childId)) parent.childIds.push(childId);
        if (!child.parentIds.includes(parentId)) child.parentIds.push(parentId);
        return true;
    }
    parent.childIds.push(childId);
    child.parentIds.push(parentId);
    const otherId = child.parentIds.find(pid => pid !== parentId);
    if (otherId) {
        let union = Object.values(data.partnerships).find(u =>
            (u.person1Id === otherId && u.person2Id === parentId) || (u.person1Id === parentId && u.person2Id === otherId));
        if (!union) {
            const other = data.persons[otherId];
            const id = generatePartnershipId();
            const [p1, p2] = other.gender === 'female' && parent.gender !== 'female' ? [parentId, otherId] : [otherId, parentId];
            union = { id, person1Id: p1, person2Id: p2, childIds: [], status: 'married' };
            data.partnerships[id] = union;
            data.persons[p1].partnerships.push(id);
            data.persons[p2].partnerships.push(id);
        }
        if (!union.childIds.includes(childId)) union.childIds.push(childId);
    } else {
        normalizeSingleParents(data);
    }
    return true;
}
