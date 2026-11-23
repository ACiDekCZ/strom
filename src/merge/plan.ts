/**
 * The merge plan (spec 134 §0.2): what a merge or an import will do, built
 * from the wizard's choices. The wizard only builds it; the counts, the
 * "What will happen" step, the write and the record all work with the same
 * plan. No DOM here.
 *
 * Every person of the source (its "?" stand-ins aside) has exactly one fate:
 * joined with a person of the tree, added, not added, or still to decide.
 */

import { PartnershipId, Person, PersonId, StromData, TreeId } from '../types.js';
import { strings } from '../strings.js';
import { normalizeName, quickMatch, detectConflicts } from './matching.js';
import { AUTO_CONFIRM_SCORE, executeMerge, existingTargetOf, detectPartnershipConflicts } from './executor.js';
import { generateAttachmentId, generateLifeEventId } from '../ids.js';
import { mergeNoteText } from './notes.js';
import { checkMergeResult, MergeCheckProblem } from './merge-check.js';
import { FieldConflict, MergeRelations, MergeState, MergeTrace, PartnershipConflictField, PersonMatch } from './types.js';
import { addPersonMedia, allMedia } from '../media.js';
import { contentFingerprint } from '../research-link.js';
import type { GedcomDroppedTag } from '../ged-parser.js';
import {
    GroupDecision, NewRel, SelectVariant, UnlinkedGroup, baseFates, connectRefusal, linkPersons, livingNew, selectionOf, sourceWithStandIns, unlinkedGroups,
} from './plan-select.js';

import {
    PERSON_FIELDS, EndOf, RelChoice, RelKind, fieldText, isUnionProtected, personDifferences, relationChoice, relationConflicts, resolveField, ruleFor,
} from './plan-rules.js';

export type { GroupDecision, NewRel, SelectVariant, UnlinkedGroup } from './plan-select.js';
export type { FieldDifference, FieldResult, Protection, RelChoice, RelConflict, RelKind, RuleCounts, RuleExample, RuleTile } from './plan-rules.js';
export {
    FIELD_KINDS, fieldKind, isProtected, isRefinement, mergeDifferences, planNeedsStep4, protectionOf, relationConflicts, resolveField, ruleCounts,
} from './plan-rules.js';

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
    /** `ownTree`: the key of the group that goes into a tree of its own (not into the target; counted as added). */
    | { kind: 'person-add'; id: PersonId; on: boolean; via?: PersonId; why?: 'step3' | 'group' | 'manual'; ownTree?: string }
    /** `standIn`: a "?" of the source joined with the tree's "?" (not counted among the persons). */
    | { kind: 'person-join'; id: PersonId; target: PersonId; on: boolean; standIn?: boolean }
    /** An offered match nobody decided yet (K0.1: not counted as new). */
    | { kind: 'person-pending'; id: PersonId; candidate: PersonId; score: number }
    | { kind: 'field'; person: PersonId; field: string; before: string; after: string; rule: RuleSource; on: boolean; protected: boolean }
    | { kind: 'field-both'; person: PersonId; field: string; value: string; rule: RuleSource; on: boolean }
    /**
     * A couple (the import's id) or a parent link (`${child}<${parent}`, the
     * import's ids) the write brings; `on: false`: a conflict of relations
     * kept the tree's (K5.5), not written. A link that would make a loop is
     * never in the plan.
     */
    | { kind: 'partnership-add' | 'link-add'; id: string; on: boolean }
    /** A conflict of relations and the choice that holds for it (K5.5). */
    | { kind: 'relation'; key: string; rel: RelKind; choice: RelChoice; union?: PartnershipId }
    /** A couple of the tree the import's partner replaces ("From the import" of a second partner; the tree's id). */
    | { kind: 'partnership-drop'; id: PartnershipId }
    /** A parent link of the tree the import's parents replace ("From the import" of other parents; the tree's ids). */
    | { kind: 'link-drop'; child: PersonId; parent: PersonId }
    | { kind: 'source' | 'place' | 'media'; id: string; joinedWith?: string; on: boolean }
    /** A new person in an unlinked group nobody decided yet (§6; to decide, not added). */
    | { kind: 'group-pending'; id: PersonId; group: string }
    /** A group's link to a person (§6 "Link to a person…"): `person` (of the group) is the `rel` of `to` (in the tree or the import). */
    | { kind: 'connect'; group: string; person: PersonId; rel: NewRel; to: PersonId; in: 'tree' | 'import' }
    /**
     * `scope`: left out by scope d) (nobody new is added). `standIn`: the
     * person is written as a "?" with its links and nothing else (K4.3 "Keep
     * as ?"); still not added, not counted among the persons.
     */
    | { kind: 'skip'; id: PersonId; reason: 'step2' | 'step3' | 'group' | 'living' | 'branch' | 'scope'; standIn?: boolean };

/** An unlinked group as the plan decided it (§6). */
export interface PlanGroup {
    key: string;
    kind: UnlinkedGroup['kind'];
    title: string;
    persons: PersonId[];
    /** The decision that holds; null: still to decide (its persons pending). */
    decision: GroupDecision | null;
    /** The name of the tree an own-tree group becomes ("{target} – {group}"). */
    ownTreeName?: string;
}

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
    /** The unlinked groups (§6) when the guide asks about them (WizardChoices.groups set). */
    groups?: PlanGroup[];
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
    /** Differences where the import's value is kept alongside the tree's ("Keep both", K5.3). */
    alongside: number;
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
    /** The conflicts of relations decided one by one (K5.5), by RelConflict.key; absent: "Keep mine". */
    relations?: Readonly<Record<string, RelChoice>>;
    /** The variant of step 3 that ticked the new persons last (absent: All new); the ticks may since be changed by hand. */
    variant?: SelectVariant;
    /** Source persons left out in step 3 (part B). */
    leftOut?: readonly PersonId[];
    /** Why a left out person is out when not by hand: 'branch' = with an unticked person whose branch went too (K4.3). */
    leftOutReason?: Readonly<Record<string, 'branch'>>;
    /** New persons kept as a "?" (K4.3 "Keep as ?"): their links stay, nothing of their own comes. */
    placeholders?: readonly PersonId[];
    /** "Leave out living" (K4.5): the new persons the privacy rules treat as living are not added. */
    skipLiving?: boolean;
    /**
     * The unlinked groups' decisions by group key (§6). Absent: the groups are
     * not asked about (their persons are added as before); present, even
     * empty: a group without a decision is still to decide.
     */
    groups?: Readonly<Record<string, GroupDecision>>;
    /** Group keys split by family ("Split by family", 6d). */
    splitGroups?: readonly string[];
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
    kind: MergeCheckProblem['kind'] | 'planAddedMissing' | 'planSkippedPresent' | 'planLinkMissing' | 'planStandInMissing';
    count: number;
    examples: string[];
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
    const items: PlanItem[] = [];
    /** Where each source person ends in the target: the tree's id when joined, 'new' when added (an own-tree group's persons not). */
    const fate = new Map<PersonId, PersonId | 'new'>();
    let differences = 0;

    const newTree = w.mode === 'new';
    const matchOf = new Map<PersonId, PersonMatch>();
    if (!newTree) for (const m of state.matches) matchOf.set(m.incomingId, m);
    const base = baseFates(state, w);
    const fresh: PersonId[] = [];

    for (const p of Object.values(source.persons)) {
        if (p.isPlaceholder) {
            const at = newTree ? undefined : existingTargetOf(state, p.id);
            if (at && tree.persons[at]) {
                items.push({ kind: 'person-join', id: p.id, target: at, on: true, standIn: true });
                fate.set(p.id, at);
            }
            continue;
        }
        switch (base.get(p.id)) {
            case 'step2':
                items.push({ kind: 'skip', id: p.id, reason: 'step2' });
                break;
            case 'joined': {
                const at = existingTargetOf(state, p.id)!;
                items.push({ kind: 'person-join', id: p.id, target: at, on: true });
                fate.set(p.id, at);
                differences += detectConflicts(tree.persons[at], p).length;
                items.push(...fieldItems(tree.persons[at], p, w.scope, rules));
                break;
            }
            case 'pending': {
                const match = matchOf.get(p.id)!;
                items.push({ kind: 'person-pending', id: p.id, candidate: match.existingId, score: match.score });
                break;
            }
            case 'scope':
                items.push({ kind: 'skip', id: p.id, reason: 'scope' });
                break;
            default:
                fresh.push(p.id);
        }
    }

    // Step 3 (§5, §6): who of the new persons comes, kept as a "?", left out, or waits for its group's decision.
    const sel = selectionOf(state, w);
    const leftOut = new Set(w.leftOut ?? []);
    const living = w.skipLiving ? new Set(livingNew(state, w)) : null;
    const groups = !newTree && w.groups ? unlinkedGroups(state, w, sel) : [];
    const decided = groupDecisions(groups, w.groups ?? {}, tree, sel, base, d => connectRefusal(state, w, d, sel) === null);
    const groupOf = new Map<PersonId, UnlinkedGroup>();
    for (const g of groups) for (const id of g.persons) groupOf.set(id, g);
    const standIns: PersonId[] = [];
    for (const id of fresh) {
        if (sel.standIns.has(id)) { standIns.push(id); continue; }
        if (leftOut.has(id)) { items.push({ kind: 'skip', id, reason: w.leftOutReason?.[id] === 'branch' ? 'branch' : 'step3' }); continue; }
        if (living?.has(id)) { items.push({ kind: 'skip', id, reason: 'living' }); continue; }
        const g = groupOf.get(id);
        const d = g ? decided.get(g.key) ?? null : undefined;
        if (d === null) { items.push({ kind: 'group-pending', id, group: g!.key }); continue; }
        if (d?.kind === 'skip') { items.push({ kind: 'skip', id, reason: 'group' }); continue; }
        if (d?.kind === 'own-tree') { items.push({ kind: 'person-add', id, on: true, why: 'group', ownTree: g!.key }); continue; }
        if (d?.kind === 'connect') items.push({ kind: 'person-add', id, on: true, why: 'group', via: d.to });
        else if (d?.kind === 'loose') items.push({ kind: 'person-add', id, on: true, why: 'group' });
        else items.push({ kind: 'person-add', id, on: true });
        fate.set(id, 'new');
    }
    for (const g of groups) {
        const d = decided.get(g.key);
        if (d?.kind === 'connect') items.push({ kind: 'connect', group: g.key, person: d.person, rel: d.rel, to: d.to, in: d.in });
    }
    // A "?" is written where it still stands between two persons the write brings or joins.
    const { neighbors } = sourceGraph(source);
    for (const id of standIns) {
        const between = (neighbors.get(id) ?? []).filter(n => fate.has(n)).length;
        items.push(between >= 2 ? { kind: 'skip', id, reason: 'step3', standIn: true } : { kind: 'skip', id, reason: 'step3' });
        if (between >= 2) fate.set(id, 'new');
    }
    const planGroups: PlanGroup[] | undefined = !newTree && w.groups ? groups.map(g => {
        const d = decided.get(g.key) ?? null;
        return { key: g.key, kind: g.kind, title: g.title, persons: g.persons, decision: d,
            ...(d?.kind === 'own-tree' ? { ownTreeName: strings.mergeWizard.ownTreeName(w.targetName, g.title) } : {}) };
    }) : undefined;

    // Couples and parent links the write brings (a "?" partner comes with its named one).
    const endOf = (id: PersonId): PersonId | 'new' | undefined => {
        const f = fate.get(id);
        if (f) return f;
        return source.persons[id]?.isPlaceholder ? 'new' : undefined;
    };
    // The conflicts of relations (K5.5), each by its choice: what is not written, what of the tree is replaced.
    const rel = newTree ? { left: new Set<string>(), loops: new Set<string>(), items: [] as PlanItem[] }
        : relationEffects(state, w, rules, endOf as EndOf);
    items.push(...rel.items);
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
        items.push({ kind: 'partnership-add', id: u.id, on: !rel.left.has(u.id) });
    }
    for (const child of Object.values(source.persons)) {
        const c = fate.get(child.id);
        if (!c) continue;
        for (const parentId of child.parentIds) {
            const par = fate.get(parentId);
            if (!par) continue;
            if (c !== 'new' && par !== 'new' && tree.persons[c]?.parentIds.includes(par)) continue;
            const key = `${child.id}<${parentId}`;
            if (rel.loops.has(key)) continue;
            items.push({ kind: 'link-add', id: key, on: !rel.left.has(key) });
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
    const standInSet = new Set(items.flatMap(i => i.kind === 'skip' && i.standIn ? [i.id] : []));
    const treeFiles = new Map(newTree ? [] : allMedia(tree).filter(m => m.dataUrl).map(m => [m.dataUrl, m.id] as const));
    for (const m of allMedia(source)) {
        const at = m.places.find(pl => 'personId' in pl && fate.has(pl.personId) && !standInSet.has(pl.personId));
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
        ...(planGroups ? { groups: planGroups } : {}),
    };
}

/**
 * The conflicts of relations of the plan (K5.5) and what each choice does:
 * the plan's `relation` items, the drops of the tree's couples and links an
 * import's version replaces, the import's couples and links "Keep mine"
 * leaves out (`left`: a couple's id or a link's `${child}<${parent}`), and
 * the links that would make a loop (never in the plan). A couple's details
 * (`marriage`) only where joined persons' details may change (c, d).
 */
function relationEffects(state: MergeState, w: WizardChoices, rules: PlanRules, ends: EndOf): { left: Set<string>; loops: Set<string>; items: PlanItem[] } {
    const tree = state.existingData;
    const source = state.incomingData;
    const left = new Set<string>();
    const loops = new Set<string>();
    const items: PlanItem[] = [];
    const parentsOf = (id: PersonId): PersonId[] => source.persons[id]?.parentIds ?? [];
    for (const c of relationConflicts(state, ends, w.scope === 'c' || w.scope === 'd')) {
        const choice = relationChoice(c, w.relations, rules, c.union ? isUnionProtected(tree.partnerships[c.union.tree]) : false);
        items.push({ kind: 'relation', key: c.key, rel: c.kind, choice, ...(c.union ? { union: c.union.tree } : {}) });
        if (c.kind === 'loop') { loops.add(`${c.sourcePerson}<${c.theirs[0]}`); continue; }
        if (c.kind === 'parents' || c.kind === 'third-parent') {
            const theirs = new Set(c.theirsAt.filter((id): id is PersonId => !!id));
            if (choice === 'import') {
                for (const p of c.mine) if (!theirs.has(p)) items.push({ kind: 'link-drop', child: c.person, parent: p });
            } else {
                // The import's parents the tree does not have stay out.
                for (const par of parentsOf(c.sourcePerson)) {
                    const e = ends(par);
                    if (e && (e === 'new' || !c.mine.includes(e))) left.add(`${c.sourcePerson}<${par}`);
                }
            }
        } else if (c.kind === 'partner') {
            const union = c.key.slice('partner|'.length);
            if (choice === 'mine') left.add(union);
            else if (choice === 'import') {
                for (const uid of tree.persons[c.person]?.partnerships ?? []) {
                    const u = tree.partnerships[uid];
                    if (u && c.mine.includes(u.person1Id === c.person ? u.person2Id : u.person1Id)) items.push({ kind: 'partnership-drop', id: u.id });
                }
            }
        }
    }
    return { left, loops, items };
}

/** Parents, children and partners of the import's persons (each person's neighbours). */
function sourceGraph(source: StromData): { neighbors: Map<PersonId, PersonId[]> } {
    let g = sourceGraphs.get(source);
    if (g) return g;
    const neighbors = new Map<PersonId, PersonId[]>();
    const add = (a: PersonId, b: PersonId): void => {
        if (a === b) return;
        const list = neighbors.get(a) ?? neighbors.set(a, []).get(a)!;
        if (!list.includes(b)) list.push(b);
    };
    for (const p of Object.values(source.persons)) {
        for (const par of p.parentIds) { add(p.id, par); add(par, p.id); }
    }
    for (const u of Object.values(source.partnerships)) { add(u.person1Id, u.person2Id); add(u.person2Id, u.person1Id); }
    sourceGraphs.set(source, g = { neighbors });
    return g;
}
const sourceGraphs = new WeakMap<StromData, { neighbors: Map<PersonId, PersonId[]> }>();

/**
 * The decision that holds for each group (null: still to decide). A link
 * holds while its person is in the group and its other person ends in the
 * target: a person of the tree, or of the import joined, added, or in a
 * group added (unlinked or linked itself); never one of its own group,
 * and never a link that would give a child a third parent.
 */
function groupDecisions(
    groups: readonly UnlinkedGroup[],
    given: Readonly<Record<string, GroupDecision>>,
    tree: StromData,
    sel: { ticked: ReadonlySet<PersonId> },
    base: ReadonlyMap<PersonId, string>,
    writable: (d: Extract<GroupDecision, { kind: 'connect' }>) => boolean,
): Map<string, GroupDecision | null> {
    const out = new Map<string, GroupDecision | null>();
    const groupOf = new Map<PersonId, string>();
    for (const g of groups) {
        for (const id of g.persons) groupOf.set(id, g.key);
        const d = given[g.key] ?? null;
        out.set(g.key, d && d.kind === 'connect' && (!g.persons.includes(d.person) || !writable(d)) ? null : d);
    }
    const inTarget = (d: Extract<GroupDecision, { kind: 'connect' }>, own: string): boolean => {
        if (d.in === 'tree') return !!tree.persons[d.to];
        if (base.get(d.to) === 'joined') return true;
        if (!sel.ticked.has(d.to)) return false;
        const g = groupOf.get(d.to);
        if (!g) return true;
        if (g === own) return false;
        const other = out.get(g);
        return other?.kind === 'loose' || other?.kind === 'connect';
    };
    for (let changed = true; changed;) {
        changed = false;
        for (const [key, d] of out) {
            if (d?.kind === 'connect' && !inTarget(d, key)) { out.set(key, null); changed = true; }
        }
    }
    return out;
}

/**
 * The detail items of a joined person by the scope: a gap the import fills;
 * in c) and d) each difference by its rule (K5.1–K5.4): the import's value
 * written (`on`), the tree's kept (`on: false`, a protected one held by a
 * bulk rule), or the import's kept alongside (`field-both`, K5.3).
 */
function fieldItems(existing: Person, incoming: Person, scope: PlanScope, rules: PlanRules): PlanItem[] {
    if (scope === 'a') return [];
    const out: PlanItem[] = [];
    const differing = new Map(personDifferences(existing, incoming).map(d => [d.field, d] as const));
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
            const d = differing.get(field)!;
            const { result, source } = resolveField(d, rules);
            if (result === 'both') out.push({ kind: 'field-both', person: existing.id, field, value: after, rule: source, on: true });
            else out.push({ kind: 'field', person: existing.id, field, before, after, rule: source, on: result === 'import', protected: !!d.protection });
        }
    }
    return out;
}

// ==================== COUNTS ====================

/** The counts of a plan (the one source of numbers of the wizard). */
export function planCounts(plan: MergePlan): PlanCounts {
    const c: PlanCounts = { joined: 0, added: 0, skipped: 0, pending: 0, total: plan.source.persons, fieldChanges: 0, differencesKept: 0, alongside: 0, partnerships: 0, links: 0 };
    for (const item of plan.items) {
        switch (item.kind) {
            case 'person-join': if (!item.standIn) { if (item.on) c.joined++; else c.skipped++; } break;
            case 'person-add': if (item.on) c.added++; else c.skipped++; break;
            case 'skip': c.skipped++; break;
            case 'person-pending': case 'group-pending': c.pending++; break;
            case 'connect': if (item.rel === 'partner') c.partnerships++; else c.links++; break;
            case 'field':
                if (item.on && item.after !== item.before) c.fieldChanges++;
                else if (!item.on && item.before !== '' && item.after !== item.before) c.differencesKept++;
                break;
            case 'field-both': if (item.on) c.alongside++; break;
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
        else if (item.kind === 'person-pending' || item.kind === 'group-pending') out.set(item.id, 'pending');
    }
    return out;
}

/** The persons the plan writes as a "?" (K4.3 "Keep as ?"). */
export function planStandIns(plan: MergePlan): PersonId[] {
    return plan.items.flatMap(i => i.kind === 'skip' && i.standIn ? [i.id] : []);
}

/** The persons of each own-tree group (by group key): they go into a tree of their own, not into the target. */
export function planOwnTrees(plan: MergePlan): Map<string, PersonId[]> {
    const out = new Map<string, PersonId[]>();
    for (const i of plan.items) {
        if (i.kind !== 'person-add' || !i.on || !i.ownTree) continue;
        const list = out.get(i.ownTree) ?? out.set(i.ownTree, []).get(i.ownTree)!;
        list.push(i.id);
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
        } else if ((item.kind === 'person-add' && (!item.on || item.ownTree)) || (item.kind === 'person-join' && !item.on && !item.standIn)
            || (item.kind === 'skip' && !item.standIn) || item.kind === 'person-pending' || item.kind === 'group-pending') {
            decisions.set(item.id, { type: 'skip' });
        }
    }
    // A person kept as a "?" is one in `source` (sourceWithStandIns) and comes as a person of its own.
    const unmatchedIncoming = [...namedPersons(source).map(p => p.id).filter(id => !joined.has(id)), ...planStandIns(plan)];
    // The conflicts of relations (K5.5): what is left out, what of the tree is replaced, a couple's details from the import.
    const relations: MergeRelations = {};
    const partnershipResolutions = new Map<PartnershipId, Partial<Record<PartnershipConflictField, 'keep_existing' | 'use_incoming'>>>();
    for (const item of plan.items) {
        if (item.kind === 'partnership-add' && !item.on) (relations.leftUnions ??= []).push(item.id as PartnershipId);
        else if (item.kind === 'link-add' && !item.on) (relations.leftLinks ??= []).push(item.id);
        // A link that would make a loop is never written, not even through the couple it comes with.
        else if (item.kind === 'relation' && item.rel === 'loop') (relations.leftLinks ??= []).push(item.key.slice('loop|'.length));
        else if (item.kind === 'partnership-drop') (relations.dropUnions ??= []).push(item.id);
        else if (item.kind === 'link-drop') (relations.dropLinks ??= []).push(`${item.child}<${item.parent}`);
        else if (item.kind === 'relation' && item.rel === 'marriage' && item.choice === 'import') {
            const all: Partial<Record<PartnershipConflictField, 'use_incoming'>> = { status: 'use_incoming', startDate: 'use_incoming', startPlace: 'use_incoming', endDate: 'use_incoming' };
            partnershipResolutions.set(item.key.slice('marriage|'.length) as PartnershipId, all);
        }
    }
    return {
        existingData: existing,
        incomingData: source,
        matches,
        unmatchedExisting: [],
        unmatchedIncoming,
        decisions,
        conflictResolutions: new Map(),
        partnershipResolutions,
        ...(Object.keys(relations).length ? { relations } : {}),
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
    /**
     * The own-tree groups (§6 "Separate tree"), each written as a new tree of
     * its own: not in `data`; the caller stores each as a tree named `name`
     * (TreeManager.createTree) with the same backup and record. Empty when none.
     */
    ownTrees: OwnTreeResult[];
}

/** One own-tree group written as a new tree. */
export interface OwnTreeResult {
    group: string;
    /** "{target} – {group}". */
    name: string;
    /** Source ids of the group's persons. */
    persons: PersonId[];
    data: StromData;
    record: MergeRecord;
    trace: MergeTrace;
    backupKey?: string;
}

/** Every person of the source goes in: nobody left out, skipped or still to decide. */
export function planTakesAll(plan: MergePlan): boolean {
    return plan.items.every(i => !(i.kind === 'person-add' && (!i.on || i.ownTree)) && i.kind !== 'skip'
        && i.kind !== 'person-pending' && i.kind !== 'group-pending');
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
    const original = source;
    source = sourceWithStandIns(source, planStandIns(plan));
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
            return { ok: false, data: target, record: emptyRecord(plan), issues, ownTrees: [], ...(result.backupKey ? { backupKey: result.backupKey } : {}) };
        }
        data = result.mergedData;
        trace = result.trace;
        // "Keep both" (K5.3): the import's values alongside the tree's.
        keepAlongside(plan, data, source);
        // The groups linked to a person (§6): each link the plan names.
        for (const item of plan.items) {
            if (item.kind !== 'connect') continue;
            const a = trace.persons.get(item.person);
            const b = item.in === 'tree' ? item.to : trace.persons.get(item.to);
            if (a && b && data.persons[a] && data.persons[b]) linkPersons(data, a, item.rel, b);
        }
        extra = {
            ...(result.backupKey ? { backupKey: result.backupKey } : {}),
            ...(result.importMap ? { importMap: result.importMap } : {}),
            ...(result.stats.sharedJoined ? { sharedJoined: result.stats.sharedJoined } : {}),
        };
    }
    traces.set(data, trace);
    const issues = verifyResult(plan, before, original, data, trace);
    const ownTrees: OwnTreeResult[] = [];
    for (const [group, persons] of planOwnTrees(plan)) {
        const own = await writeOwnTree(plan, group, persons, original);
        if (!own.ok) issues.push(...own.issues);
        else ownTrees.push(own.tree);
    }
    if (issues.length) return { ok: false, data: target, record: emptyRecord(plan), trace, issues, ownTrees: [], ...extra };
    return { ok: true, data, record: recordOf(plan, before, source, data), trace, issues, ownTrees, ...extra };
}

/** A line of a note once: added after the note's text, never twice. */
function addNoteLine(note: string | undefined, line: string): string {
    const text = note?.trim() ?? '';
    if (text.split('\n').some(l => l.trim() === line)) return note ?? '';
    return text ? `${text}\n\n${line}` : line;
}

/**
 * "Keep both" (K5.3) at the result: nothing of the tree's is overwritten
 * and the import's value is kept beside it — another spelling of a name
 * among the name's variants, another birth or death as an event of an
 * alternative record, another photo among the person's files, any other
 * detail as the line "The import says: …" of the note; a couple's other
 * details likewise as a line of its note.
 */
function keepAlongside(plan: MergePlan, data: StromData, source: StromData): void {
    const t = strings.mergeWizard;
    const label = (field: string): string => (t.fieldNames as Record<string, string>)[field] ?? field;
    const sourceOf = new Map<PersonId, PersonId>();
    for (const i of plan.items) if (i.kind === 'person-join' && !i.standIn) sourceOf.set(i.target, i.id);
    const events = new Map<string, import('../types.js').LifeEvent>();
    for (const item of plan.items) {
        if (item.kind === 'relation' && item.rel === 'marriage' && item.choice === 'both') {
            const src = source.partnerships[item.key.slice('marriage|'.length) as PartnershipId];
            const into = item.union ? data.partnerships[item.union] : undefined;
            if (!src || !into) continue;
            const said = (['startDate', 'startPlace', 'endDate'] as const).map(f => src[f]).filter((v): v is string => !!v && v !== '');
            if (src.status && src.status !== into.status) said.unshift(src.status);
            if (said.length) into.note = addNoteLine(into.note, t.importSays(said.join(', ')));
            continue;
        }
        if (item.kind !== 'field-both' || !item.on) continue;
        const person = data.persons[item.person];
        const incoming = source.persons[sourceOf.get(item.person) ?? ('' as PersonId)];
        if (!person || !incoming) continue;
        const field = item.field;
        if (field === 'firstName' || field === 'lastName' || field === 'marriedSurname') {
            const key = item.value.trim().toLowerCase();
            const have = [person.firstName, person.lastName, person.marriedSurname ?? '', ...(person.nameVariants ?? [])].map(v => v.trim().toLowerCase());
            if (key && !have.includes(key)) (person.nameVariants ??= []).push(item.value.trim());
        } else if (field === 'birthDate' || field === 'birthPlace' || field === 'deathDate' || field === 'deathPlace') {
            const fact = field.startsWith('birth') ? 'birth' : 'death';
            const k = `${person.id}|${fact}`;
            let ev = events.get(k);
            if (!ev) {
                ev = { id: generateLifeEventId(), type: 'custom', customLabel: fact === 'birth' ? strings.gedcomNotes.altBirth : strings.gedcomNotes.altDeath };
                (person.events ??= []).push(ev);
                events.set(k, ev);
            }
            if (field.endsWith('Date')) ev.date = item.value; else ev.place = item.value;
        } else if (field === 'photo' && incoming.photo) {
            const mime = /^data:([^;,]+)/.exec(incoming.photo)?.[1] ?? 'image/jpeg';
            addPersonMedia(data, person.id, {
                id: generateAttachmentId(), name: incoming.photoOriginalName ?? 'photo', mimeType: mime, dataUrl: incoming.photo,
                sizeBytes: Math.round(incoming.photo.length * 0.75), kind: 'photo', ...(incoming.photoDate ? { date: incoming.photoDate } : {}),
            });
        } else {
            const value = field === 'gender' && (item.value === 'male' || item.value === 'female') ? strings.gender[item.value] : item.value;
            person.notes = addNoteLine(person.notes, t.importSays(`${label(field)} ${value}`));
        }
    }
}

/** An own-tree group written as a new tree: the group's persons alone, as a new tree from the import takes them. */
async function writeOwnTree(plan: MergePlan, group: string, persons: PersonId[], source: StromData): Promise<{ ok: true; tree: OwnTreeResult } | { ok: false; issues: VerifyIssue[] }> {
    const members = new Set(persons);
    const name = plan.groups?.find(g => g.key === group)?.ownTreeName ?? strings.mergeWizard.ownTreeName(plan.target.name, group);
    const items: PlanItem[] = namedPersons(source).map(p => members.has(p.id)
        ? { kind: 'person-add', id: p.id, on: true }
        : { kind: 'skip', id: p.id, reason: 'group' });
    const sub: MergePlan = {
        ...plan, id: `${plan.id}-${group}`, mode: 'new', items,
        target: { treeId: null, name, persons: 0, fingerprint: '', research: false },
        conflicts: { differences: 0, unions: 0 },
    };
    delete sub.groups;
    const result = await applyPlan(sub, EMPTY_TREE(), source);
    if (!result.ok || !result.trace) return { ok: false, issues: result.issues };
    return { ok: true, tree: { group, name, persons, data: result.data, record: result.record, trace: result.trace, ...(result.backupKey ? { backupKey: result.backupKey } : {}) } };
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
    const standIns = new Set(planStandIns(plan));
    const state = stateOfPlan(plan, plan.mode === 'new' ? EMPTY_TREE() : before, sourceWithStandIns(source, [...standIns]));
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
    const noStandIn: string[] = [];
    const ownTree = new Set([...planOwnTrees(plan).values()].flat());
    for (const [id, fate] of planFates(plan)) {
        if (standIns.has(id)) {
            const to = used.persons.get(id);
            if (!to || !after.persons[to]?.isPlaceholder) noStandIn.push(name(id));
            continue;
        }
        const target = fate === 'joined' || (fate === 'added' && !ownTree.has(id));
        if (target && !inResult(id)) missing.push(name(id));
        if (!target && inResult(id)) present.push(name(id));
    }
    if (missing.length) issues.push({ kind: 'planAddedMissing', count: missing.length, examples: missing.slice(0, 5) });
    if (present.length) issues.push({ kind: 'planSkippedPresent', count: present.length, examples: present.slice(0, 5) });
    if (noStandIn.length) issues.push({ kind: 'planStandInMissing', count: noStandIn.length, examples: noStandIn.slice(0, 5) });
    // Each link of a group to a person is there.
    const noLink: string[] = [];
    for (const item of plan.items) {
        if (item.kind !== 'connect') continue;
        const a = used.persons.get(item.person);
        const b = item.in === 'tree' ? item.to : used.persons.get(item.to);
        if (!a || !b || !related(after, a, item.rel, b)) noLink.push(`${name(item.person)} → ${b ?? item.to}`);
    }
    if (noLink.length) issues.push({ kind: 'planLinkMissing', count: noLink.length, examples: noLink.slice(0, 5) });
    return issues;
}

/** Whether `a` is the `rel` of `b` in the data. */
function related(data: StromData, a: PersonId, rel: NewRel, b: PersonId): boolean {
    const pa = data.persons[a];
    const pb = data.persons[b];
    if (!pa || !pb) return false;
    if (rel === 'parent') return pb.parentIds.includes(a) && pa.childIds.includes(b);
    if (rel === 'child') return pa.parentIds.includes(b) && pb.childIds.includes(a);
    return pa.partnerships.some(uid => {
        const u = data.partnerships[uid];
        return !!u && ((u.person1Id === a && u.person2Id === b) || (u.person1Id === b && u.person2Id === a));
    });
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
