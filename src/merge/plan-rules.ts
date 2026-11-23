/**
 * Who is right (spec 134 §7, step 4): the rules over the differences of
 * joined persons, the details a bulk rule never overwrites, the counts and
 * examples of the rule tiles, and the conflicts of relations (other
 * parents, a second partner, a different marriage, a third parent, an
 * ancestor–descendant loop). Pure: no DOM; the plan (plan.ts) builds on it.
 */

import { Partnership, PartnershipId, Person, PersonId, StromData } from '../types.js';
import { imageMetaOf } from '../image-meta.js';
import { strings } from '../strings.js';
import { isPoolRef } from '../image-ref.js';
import { detectConflicts, suggestResolution } from './matching.js';
import { detectPartnershipConflicts, existingTargetOf, incomingAddedAsNew } from './executor.js';
import { isAncestorOrSelf } from './merge-check.js';
import { factStatusOf, reliabilityStep, userTreeOrigin } from '../reliability.js';
import { factVerifyInfo, factVerifyReaders } from '../verify.js';
import { MergeState, PartnershipConflictField } from './types.js';
import type { FieldKind, PlanRules, RuleChoice, RuleSource } from './plan.js';

// ==================== FIELDS ====================

/** Details of a person the plan names, and their kind. */
export const PERSON_FIELDS: ReadonlyArray<[keyof Person & string, FieldKind]> = [
    ['firstName', 'name'], ['lastName', 'name'], ['marriedSurname', 'name'], ['titleBefore', 'name'], ['titleAfter', 'name'],
    ['gender', 'sex'],
    ['birthDate', 'birth'], ['birthPlace', 'places'], ['birthAddress', 'birth'], ['birthAge', 'birth'],
    ['deathDate', 'death'], ['deathPlace', 'places'], ['deathAddress', 'death'], ['deathAge', 'death'], ['deathCause', 'death'],
    ['notes', 'notes'], ['photo', 'photos'],
];
const FIELD_KIND = new Map(PERSON_FIELDS);

/** The nine kinds of detail of step 4 "by kind", in their order. */
export const FIELD_KINDS: readonly FieldKind[] = ['name', 'birth', 'death', 'places', 'events', 'notes', 'photos', 'sex', 'marriage'];

/** The kind of a person's detail (step 4 "by kind"); a couple's detail is 'marriage'. */
export function fieldKind(field: string): FieldKind {
    if (field === 'marriage') return 'marriage';
    return FIELD_KIND.get(field as keyof Person & string) ?? 'events';
}

/** The length of an image's data URL: a pooled image's from its catalog entry (the same in either form). */
function imageTextLength(value: string): number {
    return isPoolRef(value) ? imageMetaOf(value)?.len ?? value.length : value.length;
}

/**
 * The plan text of a value written over `before`: another photo of the same
 * name and size reads as such, not as "photo (3222) → photo (3222)".
 */
export function afterText(field: string, before: string, after: string): string {
    return field === 'photo' && !!before && before === after ? strings.mergeWizard.otherPhoto : after;
}

/** A detail as plan text: a photo by its name and size (never the data URL), an unknown sex as nothing. */
export function fieldText(person: Person | undefined, field: string): string {
    if (!person) return '';
    if (field === 'photo') return person.photo ? `${person.photoOriginalName ?? 'photo'} (${imageTextLength(person.photo)})` : '';
    if (field === 'gender') return person.gender === 'unknown' ? '' : person.gender ?? '';
    const v = (person as unknown as Record<string, unknown>)[field];
    return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
}

// ==================== PROTECTED DETAILS (K5.4) ====================

/** Why a detail is protected from a bulk rule: proven by a record, confirmed by a person, from the research. */
export type Protection = 'proven' | 'human' | 'research';

/** The fact (reliability.ts) a person's detail belongs to. */
const FACT_OF: Readonly<Record<string, string>> = {
    firstName: 'name', lastName: 'name', marriedSurname: 'name', titleBefore: 'name', titleAfter: 'name',
    gender: 'sex',
    birthDate: 'birth', birthPlace: 'birth', birthAddress: 'birth', birthAge: 'birth',
    deathDate: 'death', deathPlace: 'death', deathAddress: 'death', deathAge: 'death', deathCause: 'death',
};

/** Why a fact of a person or a couple is protected, or null (its marks: fact-status, a confirmation, the research's origin). */
function factProtection(holder: Person | Partnership, fact: string): Protection | null {
    const origin = holder.researchOrigins?.[fact];
    const status = factStatusOf(holder, fact);
    const info = factVerifyInfo(holder, fact);
    const readers = factVerifyReaders(holder, fact);
    const fromOwnTree = userTreeOrigin(origin);
    const step = reliabilityStep({
        status, origin: fromOwnTree ? 'import' : origin?.kind,
        ...(info.confirmed ? { confirmedByHuman: true } : {}), ...(readers ? { readers } : {}),
    });
    if (step?.step === 'human') return 'human';
    if (step?.step === 'proven') return 'proven';
    if (origin?.kind === 'research' || status === 'probable' || status === 'possible') return 'research';
    return null;
}

/** Why the tree's value of a person's detail is protected from a bulk rule, or null. */
export function protectionOf(person: Person | undefined, field: string): Protection | null {
    const fact = FACT_OF[field];
    return person && fact ? factProtection(person, fact) : null;
}

/** A bulk rule (whole merge, kind, person) never overwrites this detail of the tree (K5.4); a choice of the value may. */
export function isProtected(person: Person | undefined, field: string): boolean {
    return protectionOf(person, field) !== null;
}

// ==================== RULES (K5.1–K5.3) ====================

/** What a difference ends as: the tree's value stays, the import's is written, the import's is kept alongside, still to go through. */
export type FieldResult = 'mine' | 'import' | 'both' | 'walk';

/** One difference of a joined person (the tree's value and the import's both set and not the same). */
export interface FieldDifference {
    /** The tree's person. */
    person: PersonId;
    /** The import's person joined with it. */
    source: PersonId;
    field: string;
    kind: FieldKind;
    before: string;
    after: string;
    protection: Protection | null;
}

/** The rule for a person's detail: the most specific level that says one (value > person > kind > all). */
export function ruleFor(rules: PlanRules, person: PersonId, field: string, also?: PersonId): RuleSource {
    const v = rules.value?.[`${person}|${field}`];
    if (v) return { level: 'value', choice: v };
    const p = rules.person?.[person] ?? (also ? rules.person?.[also] : undefined);
    if (p) return { level: 'person', choice: p };
    const k = rules.kind?.[fieldKind(field)];
    if (k) return { level: 'kind', choice: k };
    return { level: 'all', choice: rules.all };
}

/**
 * The import's value says the same as the tree's, only more precisely (K0.3:
 * the "more precise" suggestion, used only by the rule that asks for it): a
 * date of the same year known to the day or month, a place that contains the
 * tree's. Never a sex or a photo.
 */
export function isRefinement(field: string, before: string, after: string): boolean {
    if (!before || !after || before === after) return false;
    const s = suggestResolution(field as keyof Person, before, after);
    return s.resolution === 'use_incoming' && !!s.reason;
}

/**
 * The result of a difference under the rules (K5.1–K5.4): the narrower rule
 * wins; 'precise' takes the import's only where it refines the tree's;
 * 'each' leaves the tree's value until a value is chosen (to go through). A
 * protected value of the tree stays under every rule but a choice of the
 * value itself (`held`).
 */
export function resolveField(diff: Pick<FieldDifference, 'person' | 'field' | 'before' | 'after' | 'protection'>, rules: PlanRules, also?: PersonId): { result: FieldResult; source: RuleSource; held?: true } {
    const source = ruleFor(rules, diff.person, diff.field, also);
    const bulk = source.level !== 'value';
    const writes = (): { result: FieldResult; source: RuleSource; held?: true } =>
        bulk && diff.protection ? { result: 'mine', source, held: true } : { result: 'import', source };
    switch (source.choice) {
        case 'import': return writes();
        case 'both': return { result: 'both', source };
        case 'precise': return isRefinement(diff.field, diff.before, diff.after) ? writes() : { result: 'mine', source };
        case 'each': return { result: bulk ? 'walk' : 'mine', source };
        default: return { result: 'mine', source };
    }
}

/** The differences of a joined pair (the fields detectConflicts asks about). */
export function personDifferences(existing: Person, incoming: Person): FieldDifference[] {
    return detectConflicts(existing, incoming).map(c => {
        const field = c.field as string;
        return {
            person: existing.id, source: incoming.id, field, kind: fieldKind(field),
            before: fieldText(existing, field), after: fieldText(incoming, field), protection: protectionOf(existing, field),
        };
    });
}

/** The import's persons joined with a person of the tree: source id → the tree's id. */
export function joinedPairs(state: MergeState): Map<PersonId, PersonId> {
    const out = new Map<PersonId, PersonId>();
    for (const p of Object.values(state.incomingData.persons)) {
        if (p.isPlaceholder || state.decisions.get(p.id)?.type === 'skip') continue;
        const at = existingTargetOf(state, p.id);
        if (at && state.existingData.persons[at]) out.set(p.id, at);
    }
    return out;
}

// ==================== COUNTS OF THE RULE TILES ====================

/** An example of what a rule does, on one difference ("Josef Modřín, birth: 1871 → 1872"). */
export interface RuleExample {
    person: PersonId;
    field: string;
    kind: FieldKind;
    before: string;
    after: string;
    result: FieldResult;
}

/** One tile of step 4 (a whole-merge rule) with what it would do, the narrower rules standing. */
export interface RuleTile {
    choice: RuleChoice;
    /** The tree's value stays ("{n} differences stay"). */
    stays: number;
    /** The import's value is written ("{n} change"). */
    changes: number;
    /** Protected values the rule would change but does not ("{p} protected not"). */
    protected: number;
    /** The import's value kept alongside ("{n} kept alongside"). */
    side: number;
    /** Still to go through one by one ("{n} to go through"). */
    walk: number;
    example: RuleExample | null;
}

export interface RuleCounts {
    differences: number;
    /** Differences whose tree value is protected (K5.4). */
    protected: number;
    /** The five tiles, as if each were the rule for the whole merge. */
    tiles: Record<RuleChoice, RuleTile>;
    /** The differences of each kind and the rule each kind has (with where it comes from). */
    byKind: Record<FieldKind, { differences: number; rule: RuleSource }>;
    /** The tree's persons with differences, in the import's order: how many, and how many of them are exceptions. */
    byPerson: Array<{ person: PersonId; differences: number; exceptions: number }>;
    /** Differences decided by a narrower rule than the whole merge's, or protected from it. */
    exceptions: number;
    /** The current rules' result (the tile of `rules.all`). */
    current: RuleTile;
}

const RULE_CHOICES: readonly RuleChoice[] = ['mine', 'import', 'both', 'precise', 'each'];

/** The differences of the merge (joined persons' details and the details of couples both trees know). */
export function mergeDifferences(state: MergeState): FieldDifference[] {
    const out: FieldDifference[] = [];
    // Two of the import joined with one person: the first one's detail is the difference (as in the plan, 134 N4).
    const seen = new Set<string>();
    for (const [sourceId, treeId] of joinedPairs(state)) {
        for (const d of personDifferences(state.existingData.persons[treeId], state.incomingData.persons[sourceId])) {
            if (seen.has(`${d.person}|${d.field}`)) continue;
            seen.add(`${d.person}|${d.field}`);
            out.push(d);
        }
    }
    for (const c of marriageConflicts(state)) {
        out.push({ person: c.person, source: c.sourcePerson, field: 'marriage', kind: 'marriage',
            before: c.fields.map(f => f.mine).join(', '), after: c.fields.map(f => f.theirs).join(', '),
            protection: factProtection(state.existingData.partnerships[c.union!.tree], 'marriage') });
    }
    return out;
}

/**
 * The counts and examples of step 4 (K5.2): for each of the five tiles what
 * it would do with every difference (the narrower rules standing), the
 * differences by kind and by person, and the exceptions.
 */
export function ruleCounts(state: MergeState, rules: PlanRules): RuleCounts {
    const diffs = mergeDifferences(state);
    const tile = (choice: RuleChoice): RuleTile => {
        const r: PlanRules = { ...rules, all: choice };
        const t: RuleTile = { choice, stays: 0, changes: 0, protected: 0, side: 0, walk: 0, example: null };
        let fallback: RuleExample | null = null;
        for (const d of diffs) {
            const { result, held } = resolveField(d, r);
            if (result === 'import') t.changes++;
            else if (result === 'both') t.side++;
            else if (result === 'walk') { t.walk++; t.stays++; }
            else t.stays++;
            if (held) t.protected++;
            const ex: RuleExample = { person: d.person, field: d.field, kind: d.kind, before: d.before, after: d.after, result };
            fallback ??= ex;
            // The example shows the rule at work: a change, a value kept alongside, one to go through, or the tree's that stays.
            const shows = choice === 'import' || choice === 'precise' ? result === 'import' : choice === 'both' ? result === 'both' : choice === 'each' ? result === 'walk' : result === 'mine';
            if (!t.example && shows && d.field !== 'photo') t.example = ex;
        }
        t.example ??= fallback;
        return t;
    };
    const tiles = Object.fromEntries(RULE_CHOICES.map(c => [c, tile(c)])) as Record<RuleChoice, RuleTile>;
    const byKind = Object.fromEntries(FIELD_KINDS.map(k => [k, {
        differences: 0,
        rule: rules.kind?.[k] ? { level: 'kind', choice: rules.kind[k]! } : { level: 'all', choice: rules.all },
    }])) as RuleCounts['byKind'];
    const persons = new Map<PersonId, { person: PersonId; differences: number; exceptions: number }>();
    let exceptions = 0;
    let prot = 0;
    for (const d of diffs) {
        byKind[d.kind].differences++;
        if (d.protection) prot++;
        const { source, held } = resolveField(d, rules);
        const exception = source.level !== 'all' || !!held;
        if (exception) exceptions++;
        const row = persons.get(d.person) ?? persons.set(d.person, { person: d.person, differences: 0, exceptions: 0 }).get(d.person)!;
        row.differences++;
        if (exception) row.exceptions++;
    }
    return { differences: diffs.length, protected: prot, tiles, byKind, byPerson: [...persons.values()], exceptions, current: tiles[rules.all] };
}

// ==================== CONFLICTS OF RELATIONS (K5.5) ====================

/** other parents · a second partner · a different marriage · a third parent · an ancestor–descendant loop */
export type RelKind = 'parents' | 'partner' | 'marriage' | 'third-parent' | 'loop';
/** Keep mine · From the import · Both (only a partner and a marriage). */
export type RelChoice = 'mine' | 'import' | 'both';

export interface RelConflict {
    /** Stable key of the conflict (WizardChoices.relations). */
    key: string;
    kind: RelKind;
    /** The tree's person it is about: the child (parents, a loop), the partner, the couple's first partner. */
    person: PersonId;
    /** The import's person joined with it. */
    sourcePerson: PersonId;
    /** The tree's side: parents or partners (the tree's ids); the parent of a loop. */
    mine: PersonId[];
    /** The import's side: parents or partners (the import's ids). */
    theirs: PersonId[];
    /** The import's persons of `theirs` joined with the tree's (null: new). */
    theirsAt: Array<PersonId | null>;
    /** A marriage: the couple in both trees and its differing details. */
    union?: { source: PartnershipId; tree: PartnershipId };
    fields: Array<{ field: PartnershipConflictField; mine: string; theirs: string }>;
    /** The choices it offers; a loop only "Keep mine" (it is never written). */
    options: RelChoice[];
}

/** Where a person of the import ends in the target: the tree's id when joined, 'new' when added, undefined when not written. */
export type EndOf = (sourceId: PersonId) => PersonId | 'new' | undefined;

/** The ends by the comparison alone (joined, or added as new). */
function defaultEnds(state: MergeState): EndOf {
    const added = new Set(incomingAddedAsNew(state));
    const joined = joinedPairs(state);
    return id => joined.get(id) ?? (added.has(id) ? 'new' : undefined);
}

/** A couple's differing details, one conflict per couple both trees know (detectPartnershipConflicts). */
function marriageConflicts(state: MergeState): RelConflict[] {
    const byUnion = new Map<PartnershipId, RelConflict>();
    for (const c of detectPartnershipConflicts(state)) {
        let r = byUnion.get(c.incomingPartnershipId);
        if (!r) {
            const tree = state.existingData.partnerships[c.existingPartnershipId];
            const src = state.incomingData.partnerships[c.incomingPartnershipId];
            const first = existingTargetOf(state, src.person1Id) === tree.person1Id ? src.person1Id : src.person2Id;
            const second = first === src.person1Id ? src.person2Id : src.person1Id;
            r = {
                key: `marriage|${c.incomingPartnershipId}`, kind: 'marriage', person: tree.person1Id, sourcePerson: first,
                mine: [tree.person2Id], theirs: [second], theirsAt: [tree.person2Id],
                union: { source: c.incomingPartnershipId, tree: c.existingPartnershipId }, fields: [], options: ['mine', 'import', 'both'],
            };
            byUnion.set(c.incomingPartnershipId, r);
        }
        r.fields.push({ field: c.field, mine: c.existingValue, theirs: c.incomingValue });
    }
    return [...byUnion.values()];
}

/**
 * The conflicts of relations the write meets (K5.5), each decided on its
 * own: a joined child the import gives other parents or a third one, a
 * joined person the import gives a partner the tree does not know while the
 * import does not know the tree's, a couple both trees know with different
 * details (`marriage`, only where joined persons' details change: scope c,
 * d), a link of the import that would make a person its own ancestor
 * (`loop`, never written). `ends` says where the import's persons end (the
 * plan's fates; by default joined or added by the comparison).
 */
export function relationConflicts(state: MergeState, ends: EndOf = defaultEnds(state), withMarriage = true): RelConflict[] {
    const tree = state.existingData;
    const source = state.incomingData;
    const out: RelConflict[] = [];
    const real = (data: StromData, id: PersonId): boolean => !!data.persons[id] && !data.persons[id].isPlaceholder;
    const at = (id: PersonId): PersonId | null => { const e = ends(id); return e && e !== 'new' ? e : null; };
    for (const s of Object.values(source.persons)) {
        if (s.isPlaceholder) continue;
        const c = at(s.id);
        if (!c || !tree.persons[c]) continue;
        const mine = tree.persons[c].parentIds.filter(id => !!tree.persons[id] && id !== c);
        const theirs: PersonId[] = [];
        const ends2: Array<PersonId | 'new'> = [];
        for (const par of s.parentIds) {
            if (!real(source, par)) continue;
            const e = ends(par);
            if (!e) continue;
            if (e !== 'new' && (e === c || isAncestorOrSelf(tree, c, e))) {
                out.push({ key: `loop|${s.id}<${par}`, kind: 'loop', person: c, sourcePerson: s.id, mine: [e], theirs: [par], theirsAt: [e], fields: [], options: ['mine'] });
                continue;
            }
            theirs.push(par);
            ends2.push(e);
        }
        const extra = ends2.filter(e => e === 'new' || !mine.includes(e));
        if (!extra.length || mine.length + extra.length <= 2) continue;
        const shared = ends2.some(e => e !== 'new' && mine.includes(e));
        out.push({
            key: `parents|${s.id}`, kind: !shared && theirs.length >= 2 ? 'parents' : 'third-parent', person: c, sourcePerson: s.id,
            mine, theirs, theirsAt: ends2.map(e => e === 'new' ? null : e), fields: [], options: ['mine', 'import'],
        });
    }
    const treePartners = (id: PersonId): PersonId[] => (tree.persons[id]?.partnerships ?? []).flatMap(uid => {
        const u = tree.partnerships[uid];
        const o = u ? (u.person1Id === id ? u.person2Id : u.person1Id) : undefined;
        return o && real(tree, o) ? [o] : [];
    });
    const sourcePartners = (id: PersonId): PersonId[] => (source.persons[id]?.partnerships ?? []).flatMap(uid => {
        const u = source.partnerships[uid];
        const o = u ? (u.person1Id === id ? u.person2Id : u.person1Id) : undefined;
        return o && real(source, o) ? [o] : [];
    });
    const sourcesAt = new Map<PersonId, PersonId[]>();
    for (const id of Object.keys(source.persons) as PersonId[]) {
        const e = ends(id);
        if (e && e !== 'new') sourcesAt.set(e, [...(sourcesAt.get(e) ?? []), id]);
    }
    for (const u of Object.values(source.partnerships)) {
        if (!real(source, u.person1Id) || !real(source, u.person2Id)) continue;
        const e1 = ends(u.person1Id);
        const e2 = ends(u.person2Id);
        if (!e1 || !e2) continue;
        for (const [s, x, other, o] of [[u.person1Id, e1, e2, u.person2Id], [u.person2Id, e2, e1, u.person1Id]] as const) {
            if (x === 'new' || !tree.persons[x]) continue;
            const known = treePartners(x);
            if (other !== 'new' && known.includes(other)) break;
            // What the import knows of x's partners: through every import person that ends at x.
            const theirsKnown = new Set((sourcesAt.get(x) ?? [s]).flatMap(sourcePartners).map(at).filter((id): id is PersonId => !!id));
            const mine = known.filter(k => k !== other && !theirsKnown.has(k));
            if (!mine.length || mine.length < known.filter(k => k !== other).length) continue;
            out.push({
                key: `partner|${u.id}`, kind: 'partner', person: x, sourcePerson: s, mine, theirs: [o],
                theirsAt: [other === 'new' ? null : other], fields: [], options: ['mine', 'import', 'both'],
            });
            break;
        }
    }
    if (withMarriage) out.push(...marriageConflicts(state));
    return out;
}

/**
 * The choice that holds for a conflict of relations: the one made for it;
 * a loop always "Keep mine"; a marriage without one by the rules (kind
 * 'marriage' and wider, a protected couple's details kept); else "Keep mine".
 */
export function relationChoice(c: RelConflict, chosen: Readonly<Record<string, RelChoice>> | undefined, rules: PlanRules, protectedUnion = false): RelChoice {
    if (c.kind === 'loop') return 'mine';
    const own = chosen?.[c.key];
    if (own && c.options.includes(own)) return own;
    if (c.kind !== 'marriage') return 'mine';
    const rule = ruleFor(rules, c.person, 'marriage', c.mine[0]);
    if (rule.choice === 'both') return 'both';
    if (rule.choice === 'import') return protectedUnion ? 'mine' : 'import';
    if (rule.choice === 'precise') {
        const date = (f: string): string => (f === 'startDate' || f === 'endDate' ? 'birthDate' : 'birthPlace');
        return !protectedUnion && c.fields.every(f => f.field !== 'status' && isRefinement(date(f.field), f.mine, f.theirs)) ? 'import' : 'mine';
    }
    return 'mine';
}

/** Whether the couple's details in the tree are protected from a bulk rule (K5.4). */
export function isUnionProtected(union: Partnership | undefined): boolean {
    return !!union && factProtection(union, 'marriage') !== null;
}

// ==================== STEP 4 OR NOT ====================

/**
 * What step 4 shows for a plan: nothing (a new tree; scopes a) and b), where
 * no differing detail of a joined person changes, without conflicts of
 * relations), only the conflicts of relations (scopes a) and b) with some),
 * or the whole step (scopes c, d).
 */
export function planNeedsStep4(plan: { mode: string; scope: string; items: ReadonlyArray<{ kind: string }> }): 'skip' | 'relations-only' | 'full' {
    if (plan.mode !== 'add') return 'skip';
    if (plan.scope !== 'a' && plan.scope !== 'b') return 'full';
    return plan.items.some(i => i.kind === 'relation') ? 'relations-only' : 'skip';
}
