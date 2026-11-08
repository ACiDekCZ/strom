/**
 * One mark of reliability per fact (spec 066 §2): who stands behind a value —
 * a person confirmed it, AI proved it from a record (one reader or two), the
 * research holds it probable or possible, it is still as an imported family
 * tree gave it (unverified), a lead, or no source. Pure: what is shown, and
 * where the person-origin row and the tree card's mini mark get it from.
 *
 * Where the app knows the origin from:
 * - the research's tree, when its bridge names `origin` (researchShowsOrigin):
 *   the research's `_STROM_ORIGIN` / `_STROM_WAS` (Person/Partnership
 *   .researchOrigins) and its `_STROM_STATUS`;
 * - otherwise the `import` step from the app's own record of the file
 *   (StromData.imports + importedValues) while the value equals the file's,
 *   and the research's status a file of the research gave (`_STROM_STATUS`,
 *   shown before 066 too); the research's origins are not read then.
 * A tree with no import record shows no "from family tree" mark (nothing is guessed).
 */

import type {
    FactPart, FactStatus, FactOriginKind, ImportRecord, Partnership, Person, ResearchFactOrigin, ResearchFactWas, StromData,
} from './types.js';
import {
    FactHolder, factImportParts, factParts, factsOf, factValue, importRecordOf, isPartnership,
} from './import-origin.js';
import { PersonEvidence, personEvidence } from './evidence-level.js';

/** The steps, strongest first (the table of §2; the tree card's mini mark takes the weakest). */
export const RELIABILITY_ORDER = ['human', 'proven', 'probable', 'possible', 'import', 'lead', 'none'] as const;
export type ReliabilityStepName = typeof RELIABILITY_ORDER[number];

export interface ReliabilityStep {
    step: ReliabilityStepName;
    /** `proven`: readers of the record that agree (1 when not said). */
    dots?: 1 | 2;
    /** `human` / `proven` / `probable` / `possible`: the value also came from an imported family tree (said in the tooltip). */
    fromImport?: boolean;
}

export interface ReliabilityInput {
    /** The research's status of the fact (`_STROM_STATUS`). */
    status?: FactStatus;
    /** Whose the value is according to the research (`_STROM_ORIGIN`; absent: the research's). */
    origin?: FactOriginKind;
    /** The value still equals what the imported file gave (a tree without the research: its only source of the mark). */
    valueFromImport?: boolean;
    /** Readers of the record that agree (065). */
    readers?: number;
    /** A person confirmed it (065). */
    confirmedByHuman?: boolean;
    /** No source for it (065). */
    noSource?: boolean;
}

/**
 * The step of one fact, or null (no mark):
 * 1. a person confirmed it, or its origin is the person's (`user`: after a revert, an accepted proposal, their edit) → human;
 * 2. proven (status or readers) → proven, dots by readers (1 when not said);
 * 3. probable / possible → that;
 * 4. from the import (origin `import` whose value was not changed, or a value equal to the file's) with no status or
 *    a lead → import;
 * 5. a lead → lead; no source → none; otherwise null.
 * Steps 1–3 carry `fromImport` when the value is also the file's.
 */
export function reliabilityStep(input: ReliabilityInput): ReliabilityStep | null {
    const { status, origin } = input;
    const fromFile = origin === 'import' ? input.valueFromImport !== false : origin === undefined && input.valueFromImport === true;
    const withImport = (s: ReliabilityStep): ReliabilityStep => (fromFile ? { ...s, fromImport: true } : s);
    if (input.confirmedByHuman || origin === 'user') return withImport({ step: 'human' });
    const readers = typeof input.readers === 'number' && Number.isFinite(input.readers) ? input.readers : 0;
    if (status === 'proven' || readers > 0) return withImport({ step: 'proven', dots: readers >= 2 ? 2 : 1 });
    if (status === 'probable' || status === 'possible') return withImport({ step: status });
    if (fromFile && (status === undefined || status === 'lead')) return { step: 'import' };
    if (status === 'lead') return { step: 'lead' };
    if (input.noSource) return { step: 'none' };
    return null;
}

/** A step's rank: higher is weaker (proven with one reader weaker than with two). */
function rank(s: ReliabilityStep): number {
    const i = RELIABILITY_ORDER.indexOf(s.step);
    return i * 2 + (s.step === 'proven' && s.dots !== 2 ? 1 : 0);
}

/** The weakest of the marks (none: null); facts with no mark do not count. */
export function weakestStep<T extends ReliabilityStep>(steps: readonly (T | null | undefined)[]): T | null {
    let weakest: T | null = null;
    for (const s of steps) if (s && (!weakest || rank(s) > rank(weakest))) weakest = s;
    return weakest;
}

/** Two marks look the same (step and dots). */
export function sameStep(a: ReliabilityStep | null | undefined, b: ReliabilityStep | null | undefined): boolean {
    if (!a || !b) return a === b;
    return a.step === b.step && (a.step !== 'proven' || (a.dots ?? 1) === (b.dots ?? 1));
}

export interface ReliabilityOptions {
    /** The tree is the research's (loaded from its bridge). */
    researchTree: boolean;
    /** Its bridge names `origin` in /status.features (researchShowsOrigin). */
    originFeature: boolean;
    /** What 065 knows of a fact (readers, confirmed, no source), when it does. */
    evidence?: (holder: FactHolder, fact: string) => Pick<ReliabilityInput, 'readers' | 'confirmedByHuman' | 'noSource'> | undefined;
}

export interface FactReliability extends ReliabilityStep {
    /** The import the value (or its parts) came from, for the tooltip ({prog}, {date}). */
    importRecord?: ImportRecord;
    /** Parts still from the import (empty: none or not known). */
    fromParts: FactPart[];
    /** Parts a person or the research changed since (a partial fact: `reliability.partial`). */
    changedParts: FactPart[];
    /** The research's earlier value of the family tree (§3 "Originally"), with the feature only. */
    was?: ResearchFactWas;
    /** The earlier value was replaced by a proposal the person accepted (§3f): the "accepted" note. */
    accepted?: boolean;
    /** The record the research changed it by (`origin.by(src)`), with the feature only. */
    sourceIds?: string[];
}

/** The research's status of a fact (`_STROM_STATUS`), when the fact carries one. */
export function factStatusOf(holder: FactHolder, fact: string): FactStatus | undefined {
    if (fact.startsWith('event:')) {
        const id = fact.slice(6);
        return (holder.events ?? []).find(e => e?.id === id)?.status;
    }
    if (isPartnership(holder)) return fact === 'marriage' ? holder.startStatus : fact === 'divorce' ? holder.endStatus : undefined;
    return fact === 'birth' ? holder.birthStatus : fact === 'death' ? holder.deathStatus : undefined;
}

/** The parts of a fact that have a value now. */
function partsWithValue(holder: FactHolder, fact: string): FactPart[] {
    return (Object.entries(factParts(holder, fact)) as [FactPart, string][])
        .filter(([, key]) => factValue(holder, key) !== '').map(([part]) => part);
}

/** A fact has a value at all (shown on the person card). */
export function factHasValue(holder: FactHolder, fact: string): boolean {
    return partsWithValue(holder, fact).length > 0;
}

/**
 * The earlier value was replaced by a proposal the person accepted: an earlier value kept with the person's origin
 * (a correction by a record keeps it with the research's origin; a revert leaves none).
 */
export function wasAccepted(origin: ResearchFactOrigin | null | undefined): boolean {
    return !!origin?.was && origin.kind === 'user';
}

/**
 * The mark of one fact of a person or a couple, with what the tooltip and the "Originally" row need; null: no mark.
 * The research's tree with `origin`: from its origin and status. Otherwise: `import` while the value equals the file's,
 * and only with that import's record.
 */
export function factReliability(data: Pick<StromData, 'imports'>, holder: FactHolder, fact: string,
    opts: ReliabilityOptions): FactReliability | null {
    const evidence = opts.evidence?.(holder, fact) ?? {};
    if (opts.researchTree && opts.originFeature) {
        const origin = holder.researchOrigins?.[fact];
        const status = factStatusOf(holder, fact);
        const step = reliabilityStep({ status, origin: origin?.kind, ...evidence });
        if (!step) return null;
        const has = partsWithValue(holder, fact);
        const fromParts = origin?.kind === 'import' ? (origin.parts?.length ? has.filter(p => origin.parts!.includes(p)) : has) : [];
        const changedParts = origin?.kind === 'import' && origin.parts?.length ? has.filter(p => !origin.parts!.includes(p)) : [];
        const record = origin?.kind === 'import' ? importRecordOf(data, origin.importId) : undefined;
        if (step.step === 'import' && !record) return null;
        return {
            ...step,
            ...(record ? { importRecord: record } : {}),
            fromParts,
            changedParts,
            ...(origin?.was ? { was: origin.was } : {}),
            ...(wasAccepted(origin) ? { accepted: true } : {}),
            ...(origin?.sourceIds?.length ? { sourceIds: [...origin.sourceIds] } : {}),
        };
    }
    // The research's status a file of the research gave (`_STROM_STATUS`, shown
    // since before 066) stays: with the import's value it is that step "from
    // the family tree" (a lead of it: from family tree).
    const status = factStatusOf(holder, fact);
    const parts = factImportParts(holder, fact);
    const record = parts.fromImport.length > 0 ? importRecordOf(data, parts.importId) : undefined;
    const step = reliabilityStep({ status, valueFromImport: !!record });
    if (!step) return null;
    return record
        ? { ...step, importRecord: record, fromParts: parts.fromImport, changedParts: parts.changed }
        : { ...step, fromParts: [], changedParts: [] };
}

/** The GEDCOM tag a conflict names for a person's fact. */
function conflictTagOf(fact: string): string | null {
    if (fact === 'name') return 'NAME';
    if (fact === 'sex') return 'SEX';
    if (fact === 'birth') return 'BIRT';
    if (fact === 'death') return 'DEAT';
    return null;
}

export interface PersonFactOrigin extends FactReliability {
    fact: string;
    /** An open conflict of the research on the fact, by whose value it proposes to change (§3g–3j). */
    conflictKind?: 'import' | 'user';
}

export interface PersonOriginSummary {
    /** Every fact shown (with a value) has the same mark: shown once in the person-origin row, none at the facts. */
    allSameStep?: ReliabilityStep;
    /** The import the person's facts came from (the row's {prog}, {date}, {loaded}); absent: no row. */
    importRecord?: ImportRecord;
    /** The facts with a mark, in the card's order. */
    facts: PersonFactOrigin[];
}

/**
 * What the person card shows of origin: each fact's mark, the import for the
 * person-origin row (shown when at least one fact is from it), and whether
 * all facts shown share one mark (`reliability.originAll`; otherwise
 * `reliability.originMixed` and marks at the facts).
 */
export function personOriginSummary(data: Pick<StromData, 'imports'>, person: Person, opts: ReliabilityOptions): PersonOriginSummary {
    const facts: PersonFactOrigin[] = [];
    const shown: (FactReliability | null)[] = [];
    const openConflicts = (person.research?.conflicts ?? []).filter(c => c.status === 'open' && c.kind);
    for (const fact of factsOf(person)) {
        if (!factHasValue(person, fact)) continue;
        const r = factReliability(data, person, fact, opts);
        shown.push(r);
        if (!r) continue;
        const tag = conflictTagOf(fact);
        const conflict = tag ? openConflicts.find(c => c.fact === tag) : undefined;
        facts.push({ fact, ...r, ...(conflict?.kind ? { conflictKind: conflict.kind } : {}) });
    }
    const fromImport = facts.find(f => f.importRecord && (f.step === 'import' || f.fromImport || f.fromParts.length > 0));
    const first = shown[0];
    const allSame = shown.length > 0 && !!first && shown.every(s => sameStep(s, first));
    return {
        ...(allSame && first ? { allSameStep: { step: first.step, ...(first.dots ? { dots: first.dots } : {}) } } : {}),
        ...(fromImport?.importRecord ? { importRecord: fromImport.importRecord } : {}),
        facts,
    };
}

/** The tree card's mini mark: the weakest of name, birth and death (§2f); null when none of them has one. */
export function cardReliability(data: Pick<StromData, 'imports'>, person: Person, opts: ReliabilityOptions): FactReliability | null {
    return weakestStep(['name', 'birth', 'death'].map(f => factReliability(data, person, f, opts)));
}

/** A couple's facts (marriage, divorce, their events), each with its mark. */
export function partnershipReliability(data: Pick<StromData, 'imports'>, ps: Partnership, opts: ReliabilityOptions): { fact: string; reliability: FactReliability }[] {
    const out: { fact: string; reliability: FactReliability }[] = [];
    for (const fact of factsOf(ps)) {
        const r = factHasValue(ps, fact) ? factReliability(data, ps, fact, opts) : null;
        if (r) out.push({ fact, reliability: r });
    }
    return out;
}

/** The tree card's facts its one mark speaks for (name, birth, death). */
export const CARD_STATUS_FACTS = ['name', 'birth', 'death'] as const;
export type CardStatusFact = typeof CARD_STATUS_FACTS[number];

/**
 * The tree card's one mark of sources and reliability (spec 066 P4 §1), by its class:
 * a person confirmed (✓), proven by two readers or fully cited (●●), proven by one
 * or partly cited (●○), the research has not proven it yet (○: probable, possible,
 * a lead), from the family tree, unverified (○○ dashed), no source (dotted frame).
 */
export type CardStatusClass = 'cs-human' | 'cs-p2' | 'cs-p1' | 'cs-res' | 'cs-import' | 'cs-none';

export interface CardStatus {
    cls: CardStatusClass;
    /** Where it comes from: the weakest step of the card's facts, or the citations alone. */
    source: 'step' | 'evidence';
    /** `step`: the weakest step (with its import record for the words). */
    step?: FactReliability;
    /** The person's citations, whenever the tree has sources (the count for the words, also beside a step). */
    evidence?: PersonEvidence;
    /** `step`: the facts that share the weakest step, in the card's order. */
    facts: CardStatusFact[];
}

export interface CardStatusOptions extends ReliabilityOptions {
    /** Any source anywhere in the tree (evidence-level.ts treeHasAnySource). */
    treeHasSources: boolean;
    /** Settings → Show on card → "Sources and reliability" (false: no mark). */
    status?: boolean;
    /** Each person's unions, when many cards are evaluated (evidence-level.ts unionsByPerson). */
    unions?: Map<string, Partnership[]>;
}

/** The tree knows where its facts came from: the research's bridge names `origin`, or a file of another program was imported. */
export function treeKnowsOrigin(data: Pick<StromData, 'imports'>, opts: ReliabilityOptions): boolean {
    return opts.originFeature || (data.imports?.length ?? 0) > 0;
}

/** A step's mark on the tree card. */
export function cardStatusClassOfStep(step: ReliabilityStep): CardStatusClass {
    switch (step.step) {
        case 'human': return 'cs-human';
        case 'proven': return step.dots === 2 ? 'cs-p2' : 'cs-p1';
        case 'import': return 'cs-import';
        case 'none': return 'cs-none';
        default: return 'cs-res';
    }
}

/**
 * The tree card's one mark (spec 066 P4 §1, table 1b), or null (nothing drawn):
 * 1. a placeholder, or the switch off → null;
 * 2. the tree knows the origin and one of name / birth / death has a step → the weakest
 *    step (a step from the family tree wins over citations that came with the file);
 * 3. otherwise, with any source in the tree → the person's citations (full ●●, partial ●○, none);
 * 4. otherwise null (a tree with neither sources nor origin has nothing to say).
 */
export function cardStatus(data: StromData, person: Person, opts: CardStatusOptions): CardStatus | null {
    if (person.isPlaceholder || opts.status === false) return null;
    const evidence = opts.treeHasSources ? personEvidence(person, data, opts.unions) ?? undefined : undefined;
    if (treeKnowsOrigin(data, opts)) {
        const facts = CARD_STATUS_FACTS.map(f => ({ f, r: factReliability(data, person, f, opts) }));
        const weakest = weakestStep(facts.map(x => x.r));
        if (weakest) {
            return {
                cls: cardStatusClassOfStep(weakest),
                source: 'step',
                step: weakest,
                ...(evidence ? { evidence } : {}),
                facts: facts.filter(x => x.r && sameStep(x.r, weakest)).map(x => x.f),
            };
        }
    }
    if (!evidence) return null;
    const cls: CardStatusClass = evidence.level === 'full' ? 'cs-p2' : evidence.level === 'partial' ? 'cs-p1' : 'cs-none';
    return { cls, source: 'evidence', evidence, facts: [] };
}
