/**
 * The merge plan (spec 134 §0.2): what a merge or an import will do, built
 * from the wizard's choices. The wizard only builds it; the counts, the
 * "What will happen" step, the write and the record all work with the same
 * plan. No DOM here.
 *
 * Every person of the source (its "?" stand-ins aside) has exactly one fate:
 * joined with a person of the tree, added, not added, or still to decide.
 */

import { Person, PersonId, StromData, TreeId } from '../types.js';
import { strings } from '../strings.js';
import { normalizeName, quickMatch, detectConflicts } from './matching.js';
import { AUTO_CONFIRM_SCORE, executeMerge, existingTargetOf, detectPartnershipConflicts } from './executor.js';
import { mergeNoteText } from './notes.js';
import { checkMergeResult, MergeCheckProblem } from './merge-check.js';
import { FieldConflict, MergeState, MergeTrace, PersonMatch } from './types.js';
import { allMedia } from '../media.js';
import { contentFingerprint } from '../research-link.js';
import type { GedcomDroppedTag } from '../ged-parser.js';

// ==================== TYPES (§0.2) ====================

/** New tree · Add to a tree · Only compare. */
export type PlanMode = 'new' | 'add' | 'compare';
/** What happens to a person already in the tree (K2.3): a) only missing people, b) + empty details, c) detail by detail, d) only enrich. */
export type PlanScope = 'a' | 'b' | 'c' | 'd';
export type PersonFate = 'joined' | 'added' | 'skipped' | 'pending';
/** Who is right (K5.2); default 'mine'. */
export type RuleChoice = 'mine' | 'import' | 'both' | 'precise' | 'each';
export type FieldKind = 'name' | 'birth' | 'death' | 'places' | 'events' | 'notes' | 'photos' | 'sex' | 'marriage';

/** A kind of line of the source the tree does not take over (K1.6). */
export type DroppedTag = GedcomDroppedTag;

export interface PlanSource {
    kind: 'ged' | 'json' | 'tree' | 'view' | 'share';
    /** File name or tree name ("rodokmen-Jilmovi.ged", "Jilmovi – zkouška"). */
    label: string;
    program?: string;
    fileDate?: string;
    /** The source's import record id (GEDCOM), when it has one. */
    importId?: string;
    /** A fingerprint of the source (the file's SHA-256, or contentFingerprint of a tree), for a repeated merge (§13, K1.5). */
    fingerprint?: string;
    treeId?: TreeId;
    /** Persons of the source, its "?" stand-ins aside (buildPlan counts them). */
    persons: number;
}

export interface PlanTarget {
    /** Null for a new tree. */
    treeId: TreeId | null;
    name: string;
    persons: number;
    /** contentFingerprint of the target when the plan was built ('' for a new tree). */
    fingerprint: string;
    research: boolean;
}

/** Where a result's choice comes from (K5.1). */
export interface RuleSource {
    level: 'all' | 'kind' | 'person' | 'value';
    choice: RuleChoice;
}

/**
 * One thing the plan does. `person`/`target` ids of joined persons are the
 * tree's; `id` of person-add / skip / pending is the source's.
 * A `field` item: `before` the tree's value, `after` the import's; `on`
 * means the import's value is written (a kept difference is `on: false`).
 */
export type PlanItem =
    | { kind: 'person-add'; id: PersonId; on: boolean; via?: PersonId; why?: 'step3' | 'group' | 'manual' }
    /** `standIn`: a "?" of the source joined with the tree's "?" (not counted among the persons). */
    | { kind: 'person-join'; id: PersonId; target: PersonId; on: boolean; standIn?: boolean }
    /** An offered match nobody decided yet (K0.1: not counted as new). */
    | { kind: 'person-pending'; id: PersonId; candidate: PersonId; score: number }
    | { kind: 'field'; person: PersonId; field: string; before: string; after: string; rule: RuleSource; on: boolean; protected: boolean }
    | { kind: 'field-both'; person: PersonId; field: string; value: string; rule: RuleSource; on: boolean }
    | { kind: 'partnership-add' | 'link-add'; id: string; on: boolean }
    | { kind: 'source' | 'place' | 'media'; id: string; joinedWith?: string; on: boolean }
    /** `scope`: left out by scope d) (nobody new is added). */
    | { kind: 'skip'; id: PersonId; reason: 'step2' | 'step3' | 'group' | 'living' | 'branch' | 'scope' };

/** Who is right, by level (step 4, part B); the most specific level wins: value > person > kind > all. */
export interface PlanRules {
    all: RuleChoice;
    kind?: Partial<Record<FieldKind, RuleChoice>>;
    /** By the tree's person id. */
    person?: Record<string, RuleChoice>;
    /** By `${treePersonId}|${field}`. */
    value?: Record<string, RuleChoice>;
}

export interface MergePlan {
    id: string;
    mode: PlanMode;
    scope: PlanScope;
    source: PlanSource;
    target: PlanTarget;
    items: PlanItem[];
    notTaken: DroppedTag[];
    rules: PlanRules;
    createdAt: string;
    /** What step 4 would have to decide, whatever the scope: details that differ at joined persons, couples both trees know that differ. */
    conflicts: { differences: number; unions: number };
}

export interface PlanCounts {
    joined: number;
    added: number;
    skipped: number;
    pending: number;
    /** Persons of the source ("?" aside): joined + added + skipped + pending. */
    total: number;
    /** Details the write changes (field items on, the value differs). */
    fieldChanges: number;
    /** Differences where the tree's value stays. */
    differencesKept: number;
    partnerships: number;
    links: number;
}

/** The record of a merge (§0.3). Built by applyPlan; not stored yet (part C, data version 26). */
export interface MergeRecord {
    id: string;
    at: string;
    source: PlanSource;
    target: { name: string; newTree: boolean };
    counts: PlanCounts;
    state: 'valid' | 'partial' | 'undone';
    /** Ids in the tree of every person the merge added ("?" included). */
    added: PersonId[];
    /** [the tree's id, the source's id] of every joined person. */
    joined: Array<[PersonId, PersonId]>;
    /** Details of joined persons the write changed (ids in the tree). */
    fields: Array<{ person: PersonId; field: string; before: string; after: string }>;
    partnerships: string[];
    sources: string[];
    places: string[];
    media: string[];
    backupId?: string;
    sentToResearch?: string;
    undone?: Array<{ at: string; items: string[] }>;
}

/**
 * The wizard's choices (§3): the one state of its options, enough to build
 * the plan again at any step.
 */
export interface WizardChoices {
    mode: PlanMode;
    /** The tree written into (null: a new tree). */
    targetTreeId: TreeId | null;
    scope: PlanScope;
    /** Source and target swapped (two trees, step 1). */
    swapped: boolean;
    /** Step 1's "Save as JSON" (a GEDCOM file): the converted data downloaded, nothing written; the mode stays 'new'. */
    json?: boolean;
    source: PlanSource;
    /** The target tree's name; for a new tree the new tree's name. */
    targetName: string;
    targetResearch?: boolean;
    /** contentFingerprint of the target; worked out (once per tree data) when absent. */
    targetFingerprint?: string;
    /** Who is right (step 4); default everywhere 'mine'. */
    rules?: PlanRules;
    /** Source persons left out in step 3 (part B). */
    leftOut?: readonly PersonId[];
    /** The not taken over lines of the source (step 1). */
    notTaken?: readonly DroppedTag[];
    /** Keep the plan's id and time across rebuilds (the wizard sets them once). */
    planId?: string;
    createdAt?: string;
    /** When the plan was written (step 6). */
    writtenAt?: string;
    /** A new tree with people picked in step 3 ("Choose people…" of step 5). */
    pickPeople?: boolean;
}

/** A problem the check before saving found (merge-check kinds, plus the plan's own). */
export interface VerifyIssue {
    kind: MergeCheckProblem['kind'] | 'planAddedMissing' | 'planSkippedPresent';
    count: number;
    examples: string[];
}

// ==================== FIELDS ====================

/** Details of a person the plan names, and their kind. */
const PERSON_FIELDS: ReadonlyArray<[keyof Person & string, FieldKind]> = [
    ['firstName', 'name'], ['lastName', 'name'], ['marriedSurname', 'name'], ['titleBefore', 'name'], ['titleAfter', 'name'],
    ['gender', 'sex'],
    ['birthDate', 'birth'], ['birthPlace', 'places'], ['birthAddress', 'birth'], ['birthAge', 'birth'],
    ['deathDate', 'death'], ['deathPlace', 'places'], ['deathAddress', 'death'], ['deathAge', 'death'], ['deathCause', 'death'],
    ['notes', 'notes'], ['photo', 'photos'],
];
const FIELD_KIND = new Map(PERSON_FIELDS);

/** The kind of a person's detail (step 4 "by kind"). */
export function fieldKind(field: string): FieldKind {
    return FIELD_KIND.get(field as keyof Person & string) ?? 'events';
}

/** A detail as plan text: a photo by its name and size (never the data URL), an unknown sex as nothing. */
function fieldText(person: Person | undefined, field: string): string {
    if (!person) return '';
    if (field === 'photo') return person.photo ? `${person.photoOriginalName ?? 'photo'} (${person.photo.length})` : '';
    if (field === 'gender') return person.gender === 'unknown' ? '' : person.gender ?? '';
    const v = (person as unknown as Record<string, unknown>)[field];
    return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
}

function ruleFor(rules: PlanRules, person: PersonId, field: string): RuleSource {
    const v = rules.value?.[`${person}|${field}`];
    if (v) return { level: 'value', choice: v };
    const p = rules.person?.[person];
    if (p) return { level: 'person', choice: p };
    const k = rules.kind?.[fieldKind(field)];
    if (k) return { level: 'kind', choice: k };
    return { level: 'all', choice: rules.all };
}

/** Whether a rule writes the import's value of a difference ('both' and 'each' are part B; until then they keep the tree's). */
function ruleTakesImport(rule: RuleSource, before: string, after: string): boolean {
    if (rule.choice === 'import') return true;
    if (rule.choice === 'precise') return after.length > before.length && after.startsWith(before.slice(0, 4));
    return false;
}

const DEFAULT_RULES: PlanRules = { all: 'mine' };

// ==================== BUILD ====================

const fingerprints = new WeakMap<StromData, string>();
function targetFingerprint(data: StromData): string {
    let f = fingerprints.get(data);
    if (f === undefined) fingerprints.set(data, f = contentFingerprint(data));
    return f;
}

function namedPersons(data: StromData): Person[] {
    return Object.values(data.persons).filter(p => !p.isPlaceholder);
}

function newPlanId(): string {
    return `mp-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/**
 * The plan from the wizard's choices and the comparison (`state`; for a new
 * tree its tree may be empty and its matches are not used).
 * - joined: a pair decided "same" or picked by hand, or undecided with a score
 *   of AUTO_CONFIRM_SCORE or more;
 * - pending: an offered pair below that nobody decided (K0.1);
 * - skipped: "do not add" (step 2), left out in step 3, or scope d) (nobody new);
 * - added: the rest (not the same person, no match).
 * Details of joined persons by scope: a) none; b) only what the tree lacks;
 * c), d) also the differences, each by its rule (default 'mine': the tree's stays).
 */
export function buildPlan(state: MergeState, w: WizardChoices): MergePlan {
    const source = state.incomingData;
    const tree = state.existingData;
    const rules = w.rules ?? DEFAULT_RULES;
    const leftOut = new Set(w.leftOut ?? []);
    const items: PlanItem[] = [];
    /** Where each source person ends: the tree's id when joined, 'new' when added. */
    const fate = new Map<PersonId, PersonId | 'new'>();
    let differences = 0;

    const newTree = w.mode === 'new';
    const matchOf = new Map<PersonId, PersonMatch>();
    if (!newTree) for (const m of state.matches) matchOf.set(m.incomingId, m);

    for (const p of Object.values(source.persons)) {
        if (p.isPlaceholder) {
            const at = newTree ? undefined : existingTargetOf(state, p.id);
            if (at && tree.persons[at]) {
                items.push({ kind: 'person-join', id: p.id, target: at, on: true, standIn: true });
                fate.set(p.id, at);
            }
            continue;
        }
        const decision = newTree ? undefined : state.decisions.get(p.id);
        if (decision?.type === 'skip') {
            items.push({ kind: 'skip', id: p.id, reason: 'step2' });
            continue;
        }
        const at = newTree ? undefined : existingTargetOf(state, p.id);
        if (at && tree.persons[at]) {
            items.push({ kind: 'person-join', id: p.id, target: at, on: true });
            fate.set(p.id, at);
            differences += detectConflicts(tree.persons[at], p).length;
            items.push(...fieldItems(tree.persons[at], p, w.scope, rules));
            continue;
        }
        const match = matchOf.get(p.id);
        if (match && !decision && match.score < AUTO_CONFIRM_SCORE) {
            items.push({ kind: 'person-pending', id: p.id, candidate: match.existingId, score: match.score });
            continue;
        }
        if (!newTree && w.scope === 'd') {
            items.push({ kind: 'skip', id: p.id, reason: 'scope' });
            continue;
        }
        const on = !leftOut.has(p.id);
        items.push(on ? { kind: 'person-add', id: p.id, on } : { kind: 'person-add', id: p.id, on, why: 'step3' });
        if (on) fate.set(p.id, 'new');
    }

    // Couples and parent links the write brings (a "?" partner comes with its named one).
    const endOf = (id: PersonId): PersonId | 'new' | undefined => {
        const f = fate.get(id);
        if (f) return f;
        return source.persons[id]?.isPlaceholder ? 'new' : undefined;
    };
    for (const u of Object.values(source.partnerships)) {
        const a = endOf(u.person1Id);
        const b = endOf(u.person2Id);
        if (!a || !b) continue;
        if (source.persons[u.person1Id]?.isPlaceholder && source.persons[u.person2Id]?.isPlaceholder) continue;
        if (a !== 'new' && b !== 'new') {
            const known = tree.persons[a]?.partnerships.some(id => {
                const t = tree.partnerships[id];
                return !!t && ((t.person1Id === a && t.person2Id === b) || (t.person1Id === b && t.person2Id === a));
            });
            if (known) continue;
        }
        items.push({ kind: 'partnership-add', id: u.id, on: true });
    }
    for (const child of Object.values(source.persons)) {
        const c = fate.get(child.id);
        if (!c) continue;
        for (const parentId of child.parentIds) {
            const par = fate.get(parentId);
            if (!par) continue;
            if (c !== 'new' && par !== 'new' && tree.persons[c]?.parentIds.includes(par)) continue;
            items.push({ kind: 'link-add', id: `${child.id}<${parentId}`, on: true });
        }
    }
    // Sources come along whole (the same one joins the tree's, K1.7); places by name; files at persons that come along.
    const titleKey = (t: string | undefined): string => normalizeName(t ?? '');
    const treeSourceByTitle = new Map<string, string>();
    for (const s of Object.values(tree.sources ?? {})) if (s.title) treeSourceByTitle.set(titleKey(s.title), s.id);
    for (const s of Object.values(source.sources ?? {})) {
        const same = !newTree ? (tree.sources?.[s.id] && titleKey(tree.sources[s.id].title) === titleKey(s.title) ? s.id : treeSourceByTitle.get(titleKey(s.title))) : undefined;
        items.push(same ? { kind: 'source', id: s.id, joinedWith: same, on: true } : { kind: 'source', id: s.id, on: true });
    }
    for (const key of Object.keys(source.places ?? {})) {
        const same = !newTree && tree.places?.[key] ? key : undefined;
        items.push(same ? { kind: 'place', id: key, joinedWith: same, on: true } : { kind: 'place', id: key, on: true });
    }
    const treeFiles = new Map(newTree ? [] : allMedia(tree).filter(m => m.dataUrl).map(m => [m.dataUrl, m.id] as const));
    for (const m of allMedia(source)) {
        const at = m.places.find(pl => 'personId' in pl && fate.has(pl.personId));
        if (!at && m.places.some(pl => 'personId' in pl)) continue;
        const same = m.dataUrl ? treeFiles.get(m.dataUrl) : undefined;
        items.push(same ? { kind: 'media', id: m.id, joinedWith: same, on: true } : { kind: 'media', id: m.id, on: true });
    }

    return {
        id: w.planId ?? newPlanId(),
        mode: w.mode,
        scope: w.scope,
        source: { ...w.source, persons: namedPersons(source).length },
        target: {
            treeId: newTree ? null : w.targetTreeId,
            name: w.targetName,
            persons: newTree ? 0 : namedPersons(tree).length,
            fingerprint: newTree ? '' : (w.targetFingerprint ?? state.target?.fingerprint ?? targetFingerprint(tree)),
            research: !!w.targetResearch,
        },
        items,
        notTaken: [...(w.notTaken ?? [])],
        rules,
        createdAt: w.createdAt ?? new Date().toISOString(),
        conflicts: { differences, unions: newTree ? 0 : detectPartnershipConflicts(state).length },
    };
}

/** The detail items of a joined person by the scope. */
function fieldItems(existing: Person, incoming: Person, scope: PlanScope, rules: PlanRules): PlanItem[] {
    if (scope === 'a') return [];
    const out: PlanItem[] = [];
    const differing = new Set(detectConflicts(existing, incoming).map(c => c.field as string));
    for (const [field] of PERSON_FIELDS) {
        const before = fieldText(existing, field);
        let after = fieldText(incoming, field);
        if (field === 'notes') {
            if (!after) continue;
            if (before && scope === 'b') continue;
            after = mergeNoteText(existing.notes, incoming.notes) ?? '';
            if (after === before) continue;
            out.push({ kind: 'field', person: existing.id, field, before, after, rule: ruleFor(rules, existing.id, field), on: true, protected: false });
            continue;
        }
        if (!after || after === before) continue;
        const rule = ruleFor(rules, existing.id, field);
        if (!before) {
            // A gap the import fills.
            out.push({ kind: 'field', person: existing.id, field, before, after, rule, on: true, protected: false });
        } else if (scope !== 'b' && differing.has(field)) {
            out.push({ kind: 'field', person: existing.id, field, before, after, rule, on: ruleTakesImport(rule, before, after), protected: false });
        }
    }
    return out;
}

// ==================== COUNTS ====================

/** The counts of a plan (the one source of numbers of the wizard). */
export function planCounts(plan: MergePlan): PlanCounts {
    const c: PlanCounts = { joined: 0, added: 0, skipped: 0, pending: 0, total: plan.source.persons, fieldChanges: 0, differencesKept: 0, partnerships: 0, links: 0 };
    for (const item of plan.items) {
        switch (item.kind) {
            case 'person-join': if (!item.standIn) { if (item.on) c.joined++; else c.skipped++; } break;
            case 'person-add': if (item.on) c.added++; else c.skipped++; break;
            case 'skip': c.skipped++; break;
            case 'person-pending': c.pending++; break;
            case 'field':
                if (item.on && item.after !== item.before) c.fieldChanges++;
                else if (!item.on && item.before !== '' && item.after !== item.before) c.differencesKept++;
                break;
            case 'partnership-add': if (item.on) c.partnerships++; break;
            case 'link-add': if (item.on) c.links++; break;
        }
    }
    return c;
}

/**
 * The import is a copy of the tree (13b): everyone joined and the write
 * would change nothing (no one new, no detail, no couple, no link).
 */
export function bringsNothingNew(c: PlanCounts): boolean {
    return c.total > 0 && c.joined === c.total && c.added === 0 && c.pending === 0 && c.skipped === 0
        && c.fieldChanges === 0 && c.partnerships === 0 && c.links === 0;
}

/** Each source person's fate in the plan ("?" stand-ins aside). */
export function planFates(plan: MergePlan): Map<PersonId, PersonFate> {
    const out = new Map<PersonId, PersonFate>();
    for (const item of plan.items) {
        if (item.kind === 'person-join' && !item.standIn) out.set(item.id, item.on ? 'joined' : 'skipped');
        else if (item.kind === 'person-add') out.set(item.id, item.on ? 'added' : 'skipped');
        else if (item.kind === 'skip') out.set(item.id, 'skipped');
        else if (item.kind === 'person-pending') out.set(item.id, 'pending');
    }
    return out;
}

// ==================== FINGERPRINT ====================

function fnv1a(text: string, seed: number): number {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

/**
 * A fingerprint of what the plan does (for "Save the list" and resuming): the
 * mode, scope, source, target and the items, whatever their order; not the
 * plan's id nor its time.
 */
export function planFingerprint(plan: MergePlan): string {
    const items = plan.items.map(i => JSON.stringify(Object.keys(i).sort().map(k => [k, (i as Record<string, unknown>)[k]]))).sort();
    const s = plan.source;
    const text = JSON.stringify([plan.mode, plan.scope, s.kind, s.label, s.importId ?? '', s.fingerprint ?? '', s.persons,
        plan.target.treeId ?? '', plan.target.fingerprint, items]);
    return `${text.length.toString(36)}-${fnv1a(text, 0x811c9dc5).toString(36)}-${fnv1a(text, 0x01000193).toString(36)}`;
}

// ==================== WRITE ====================

const EMPTY_TREE = (): StromData => ({ persons: {}, partnerships: {} });

/**
 * The merge state that does exactly what the plan says (executeMerge works
 * only from it): joined persons as confirmed pairs, their differences
 * resolved by the plan's field items; everybody not added left out; scope
 * a) and b) as joinedDetails, d) as updateOnly.
 */
function stateOfPlan(plan: MergePlan, target: StromData, source: StromData): MergeState {
    const existing = plan.mode === 'new' ? EMPTY_TREE() : target;
    const takes = new Set<string>();
    for (const item of plan.items) if (item.kind === 'field' && item.on) takes.add(`${item.person}|${item.field}`);
    const matches: PersonMatch[] = [];
    const decisions = new Map<PersonId, import('./types.js').MatchDecision>();
    const joined = new Set<PersonId>();
    for (const item of plan.items) {
        if (item.kind === 'person-join' && item.on && existing.persons[item.target] && source.persons[item.id]) {
            const existingPerson = existing.persons[item.target];
            const incomingPerson = source.persons[item.id];
            const conflicts: FieldConflict[] = detectConflicts(existingPerson, incomingPerson).map(c => ({
                ...c, resolution: takes.has(`${item.target}|${c.field}`) ? 'use_incoming' : 'keep_existing',
            }));
            matches.push({ existingId: item.target, incomingId: item.id, confidence: 'high', reasons: ['manual'], score: 100, existingPerson, incomingPerson, conflicts });
            decisions.set(item.id, { type: 'confirm' });
            joined.add(item.id);
        } else if ((item.kind === 'person-add' && !item.on) || (item.kind === 'person-join' && !item.on && !item.standIn)
            || item.kind === 'skip' || item.kind === 'person-pending') {
            decisions.set(item.id, { type: 'skip' });
        }
    }
    const unmatchedIncoming = namedPersons(source).map(p => p.id).filter(id => !joined.has(id));
    return {
        existingData: existing,
        incomingData: source,
        matches,
        unmatchedExisting: [],
        unmatchedIncoming,
        decisions,
        conflictResolutions: new Map(),
        partnershipResolutions: new Map(),
        phase: 'executing',
        updateOnly: plan.mode !== 'new' && plan.scope === 'd',
        ...(plan.mode !== 'new' && plan.scope === 'a' ? { joinedDetails: 'none' as const } : {}),
        ...(plan.mode !== 'new' && plan.scope === 'b' ? { joinedDetails: 'empty' as const } : {}),
    };
}

/** The trace of the last applyPlan for its result (verifyResult without one passed). */
const traces = new WeakMap<StromData, MergeTrace>();

export interface ApplyResult {
    /** False: nothing may be saved (`data` is the target as it was; `issues` say why). */
    ok: boolean;
    data: StromData;
    record: MergeRecord;
    trace?: MergeTrace;
    issues: VerifyIssue[];
    /** The write's working backup (executeMerge), to delete once the result is stored. */
    backupKey?: string;
    /** The source's import record id → its id in the result (spec 066). */
    importMap?: Map<string, string>;
    /** Shared events of the source joined with one the tree holds (spec 085 §7). */
    sharedJoined?: number;
}

/** Every person of the source goes in: nobody left out, skipped or still to decide. */
export function planTakesAll(plan: MergePlan): boolean {
    return plan.items.every(i => !(i.kind === 'person-add' && !i.on) && i.kind !== 'skip' && i.kind !== 'person-pending');
}

/**
 * Write the plan: the target with the source merged in (a new tree: the
 * source, without the persons left out). Only what the plan says happens.
 * The target and the source are not changed. The record is returned, not
 * stored. With `ok: false` nothing may be saved (the check before saving).
 */
export async function applyPlan(plan: MergePlan, target: StromData, source: StromData): Promise<ApplyResult> {
    if (plan.mode === 'compare') throw new Error('A comparison plan is not written');
    const before = plan.mode === 'new' ? EMPTY_TREE() : target;
    const allIn = planTakesAll(plan);
    let data: StromData;
    let trace: MergeTrace;
    let extra: Pick<ApplyResult, 'backupKey' | 'importMap' | 'sharedJoined'> = {};
    if (plan.mode === 'new' && allIn) {
        // A new tree of the whole source, as the import made it so far.
        data = structuredClone(source);
        const same = <K extends string>(keys: K[]): Map<K, K> => new Map(keys.map(k => [k, k]));
        trace = {
            persons: same(Object.keys(source.persons) as PersonId[]),
            partnerships: same(Object.keys(source.partnerships) as Array<keyof typeof source.partnerships>),
            sources: same(Object.keys(source.sources ?? {})),
        };
    } else {
        const result = await executeMerge(stateOfPlan(plan, target, source));
        if (!result.success || !result.trace) {
            const issues: VerifyIssue[] = result.check?.problems.map(p => ({ ...p })) ?? [];
            return { ok: false, data: target, record: emptyRecord(plan), issues, ...(result.backupKey ? { backupKey: result.backupKey } : {}) };
        }
        data = result.mergedData;
        trace = result.trace;
        extra = {
            ...(result.backupKey ? { backupKey: result.backupKey } : {}),
            ...(result.importMap ? { importMap: result.importMap } : {}),
            ...(result.stats.sharedJoined ? { sharedJoined: result.stats.sharedJoined } : {}),
        };
    }
    traces.set(data, trace);
    const issues = verifyResult(plan, before, source, data, trace);
    if (issues.length) return { ok: false, data: target, record: emptyRecord(plan), trace, issues, ...extra };
    return { ok: true, data, record: recordOf(plan, before, source, data), trace, issues, ...extra };
}

function emptyRecord(plan: MergePlan): MergeRecord {
    return {
        id: plan.id, at: new Date().toISOString(), source: plan.source,
        target: { name: plan.target.name, newTree: plan.mode === 'new' }, counts: planCounts(plan), state: 'valid',
        added: [], joined: [], fields: [], partnerships: [], sources: [], places: [], media: [],
    };
}

function recordOf(plan: MergePlan, before: StromData, source: StromData, after: StromData): MergeRecord {
    const record = emptyRecord(plan);
    record.added = (Object.keys(after.persons) as PersonId[]).filter(id => !before.persons[id]);
    for (const item of plan.items) {
        if (item.kind === 'person-join' && item.on) record.joined.push([item.target, item.id]);
    }
    const seen = new Set<PersonId>();
    for (const [treeId] of record.joined) {
        if (seen.has(treeId)) continue;
        seen.add(treeId);
        for (const [field] of PERSON_FIELDS) {
            const was = fieldText(before.persons[treeId], field);
            const now = fieldText(after.persons[treeId], field);
            if (was !== now) record.fields.push({ person: treeId, field, before: was, after: now });
        }
    }
    record.partnerships = Object.keys(after.partnerships).filter(id => !(id in before.partnerships));
    record.sources = Object.keys(after.sources ?? {}).filter(id => !before.sources?.[id]);
    record.places = Object.keys(after.places ?? {}).filter(k => !before.places?.[k]);
    const had = new Set(allMedia(before).map(m => m.id));
    record.media = allMedia(after).map(m => m.id).filter(id => !had.has(id));
    void source;
    return record;
}

/**
 * The check before saving (K1.2, K1.3; §8 8b): checkMergeResult over the
 * plan (nothing of either tree lost, no new reference to nothing), and the
 * plan's own: every person the plan adds or joins is in the result, none it
 * leaves out is. `trace` = where the write put the source's records (from
 * applyPlan; looked up for a result applyPlan made when not passed).
 */
export function verifyResult(plan: MergePlan, before: StromData, source: StromData, after: StromData, trace?: MergeTrace): VerifyIssue[] {
    const used = trace ?? traces.get(after) ?? { persons: new Map(), partnerships: new Map(), sources: new Map() };
    const state = stateOfPlan(plan, plan.mode === 'new' ? EMPTY_TREE() : before, source);
    const issues: VerifyIssue[] = checkMergeResult(state, { mergedData: after, trace: used }).problems.map(p => ({ ...p }));
    const name = (id: PersonId): string => {
        const p = source.persons[id];
        const n = p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : '';
        return n || id;
    };
    const inResult = (id: PersonId): boolean => {
        const to = used.persons.get(id);
        return !!to && !!after.persons[to];
    };
    const missing: string[] = [];
    const present: string[] = [];
    for (const [id, fate] of planFates(plan)) {
        if ((fate === 'added' || fate === 'joined') && !inResult(id)) missing.push(name(id));
        if ((fate === 'skipped' || fate === 'pending') && inResult(id)) present.push(name(id));
    }
    if (missing.length) issues.push({ kind: 'planAddedMissing', count: missing.length, examples: missing.slice(0, 5) });
    if (present.length) issues.push({ kind: 'planSkippedPresent', count: present.length, examples: present.slice(0, 5) });
    return issues;
}

// ==================== STEP 1: EXAMPLE OF THE SCOPE ====================

/** The scope's examples on one person (step 1, §3). */
export interface ScopeExample {
    /** The tree's person (as named in the tree). */
    person: string;
    a: string;
    b: string;
    c: string;
    d: string;
}

/** How many source persons the quick look goes through (§3). */
const SCOPE_EXAMPLE_LOOK = 200;
/** A quick match this strong with a birth both know is a sure one. */
const SCOPE_EXAMPLE_SCORE = 70;

const personName = (p: Person): string => [p.firstName, p.lastName].filter(n => n && n !== '?').join(' ').trim();

/**
 * The scope's options a)–d) said on one person (§3): the first sure pair —
 * from the comparison when `state` is given, else by a quick look at the
 * first 200 persons of the source (the same name, quickMatch with the birth).
 * A relative the source adds stands for "what comes"; a detail the tree
 * lacks for b), a difference for c). Null without a sure pair.
 */
export function scopeExample(source: StromData, target: StromData, state?: MergeState): ScopeExample | null {
    const pairs: Array<[Person, Person]> = [];
    if (state) {
        for (const m of state.matches) {
            if (m.score < AUTO_CONFIRM_SCORE) continue;
            const e = target.persons[m.existingId];
            const i = source.persons[m.incomingId];
            if (e && i && !e.isPlaceholder && !i.isPlaceholder) pairs.push([e, i]);
        }
    } else {
        const byName = new Map<string, Person[]>();
        for (const p of namedPersons(target)) {
            const key = normalizeName(personName(p));
            if (!key) continue;
            const list = byName.get(key);
            if (list) list.push(p); else byName.set(key, [p]);
        }
        for (const i of namedPersons(source).slice(0, SCOPE_EXAMPLE_LOOK)) {
            for (const e of byName.get(normalizeName(personName(i))) ?? []) {
                const q = quickMatch(e, i, target, source);
                if (q.score >= SCOPE_EXAMPLE_SCORE && q.reasons.includes('birth')) { pairs.push([e, i]); break; }
            }
        }
    }
    if (pairs.length === 0) return null;
    const joinedSource = new Set(pairs.map(([, i]) => i.id));
    const relativeNew = ([e, i]: [Person, Person]): Person | undefined => {
        const rel = [...i.childIds, ...i.parentIds,
            ...i.partnerships.map(u => source.partnerships[u]).filter(u => !!u).map(u => u.person1Id === i.id ? u.person2Id : u.person1Id)]
            .map(id => source.persons[id])
            .filter((p): p is Person => !!p && !p.isPlaceholder && !joinedSource.has(p.id));
        const treeNames = new Set([...e.childIds, ...e.parentIds].map(id => target.persons[id]).filter(p => !!p).map(p => normalizeName(personName(p))));
        return rel.find(p => !treeNames.has(normalizeName(personName(p))));
    };
    const pair = pairs.find(p => !!relativeNew(p)) ?? pairs[0];
    const [e, i] = pair;
    const t = strings.mergeWizard;
    const who = personName(e) || personName(i);
    const relPerson = relativeNew(pair);
    const rel = relPerson ? personName(relPerson) : '';
    const label = (field: string): string => (t.fieldNames as Record<string, string>)[field] ?? field;
    const shown = (field: string, p: Person): string => `${label(field)} ${fieldText(p, field)}`;
    const simple = PERSON_FIELDS.map(([f]) => f).filter(f => f !== 'notes' && f !== 'photo' && f !== 'gender' && f in t.fieldNames);
    const fills = simple.find(f => !fieldText(e, f) && !!fieldText(i, f));
    const keeps = simple.find(f => !!fieldText(e, f));
    const differs = simple.find(f => !!fieldText(e, f) && !!fieldText(i, f) && fieldText(e, f) !== fieldText(i, f));
    return {
        person: who,
        a: rel ? t.exA(who, rel) : t.scopeADesc,
        b: fills && keeps ? t.exB(who, shown(fills, i), shown(keeps, e)) : t.scopeBDesc,
        c: differs ? t.exC(who, fieldText(e, differs), fieldText(i, differs), '') : t.scopeCDesc,
        d: rel ? t.exD(who, rel) : t.scopeDDesc,
    };
}

// ==================== §13: THE SAME SOURCE AGAIN ====================

/**
 * The earlier merge of the same source (§13 13c, K1.5): a record with the
 * same import id or the same fingerprint of the source, not undone; the
 * latest one. Null when this source was not merged before.
 */
export function isRepeatOf(source: PlanSource, merges: readonly MergeRecord[] | undefined): MergeRecord | null {
    let found: MergeRecord | null = null;
    for (const r of merges ?? []) {
        if (r.state === 'undone') continue;
        const sameId = !!source.importId && r.source.importId === source.importId;
        const samePrint = !!source.fingerprint && r.source.fingerprint === source.fingerprint;
        if (!sameId && !samePrint) continue;
        if (!found || r.at > found.at) found = r;
    }
    return found;
}
