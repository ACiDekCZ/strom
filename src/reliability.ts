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
 * In both, a fact a person confirmed (spec 065: by hand in the app while its
 * value is unchanged, or the research's `_STROM_CONFIRMED`) is `human`, and
 * the research's last check (`_STROM_CHECKED proven`, `_READERS`) gives the
 * readers of a proven fact.
 * A tree with no import record shows no "from family tree" mark (nothing is guessed).
 */

import type {
    FactPart, FactStatus, FactOriginKind, ImportRecord, Partnership, Person, ResearchFactOrigin, ResearchFactWas, StromData,
} from './types.js';
import { personSourceIds } from './types.js';
import {
    FactHolder, factImportParts, factParts, factsOf, factValue, importRecordOf, isPartnership,
} from './import-origin.js';
import { PersonEvidence, personEvidence } from './evidence-level.js';
import { factVerifyInfo, factVerifyReaders } from './verify.js';

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
 * What the fact's own data say of it (spec 065): a confirmation by a person
 * (in the app by hand while the value is unchanged, or in the research) and
 * the readers the research's last check counted.
 */
function verifyEvidence(holder: FactHolder, fact: string): Pick<ReliabilityInput, 'readers' | 'confirmedByHuman'> {
    const info = factVerifyInfo(holder, fact);
    const readers = factVerifyReaders(holder, fact);
    return {
        ...(info.confirmed ? { confirmedByHuman: true } : {}),
        ...(readers ? { readers } : {}),
    };
}

/** The fields a caller's evidence says (undefined ones do not override). */
function definedOnly<T extends object>(value: T | undefined): Partial<T> {
    if (!value) return {};
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * The mark of one fact of a person or a couple, with what the tooltip and the "Originally" row need; null: no mark.
 * The research's tree with `origin`: from its origin and status. Otherwise: `import` while the value equals the file's,
 * and only with that import's record.
 */
export function factReliability(data: Pick<StromData, 'imports'>, holder: FactHolder, fact: string,
    opts: ReliabilityOptions): FactReliability | null {
    const evidence = { ...verifyEvidence(holder, fact), ...definedOnly(opts.evidence?.(holder, fact)) };
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
    const step = reliabilityStep({ status, valueFromImport: !!record, ...evidence });
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
 * The tree card's one mark of sources and reliability (spec 066 P4 §1, K5.1), by its class.
 * Per fact of the card with a step: a person confirmed it (✓), proven (●●, however many readers),
 * probable or possible read from a source (●○: a citation at the fact of quality QUAY 2 or 3),
 * only a trace (○: a lead; probable or possible without such a citation), from the family tree,
 * unverified (○○ dashed), no source (dotted frame). The card takes the weakest.
 * A tree that does not know the origin keeps the citations' meaning: full ●●, partial ●○, none.
 */
export type CardStatusClass = 'cs-human' | 'cs-p2' | 'cs-p1' | 'cs-res' | 'cs-import' | 'cs-none';

/** Every mark, strongest first (the tree legend's order). */
export const CARD_STATUS_CLASSES: readonly CardStatusClass[] = ['cs-human', 'cs-p2', 'cs-p1', 'cs-res', 'cs-import', 'cs-none'];

export interface CardStatus {
    cls: CardStatusClass;
    /** Where it comes from: the card's facts (a tree that knows the origin), or the citations alone. */
    source: 'step' | 'evidence';
    /** `step`: the step the facts of the mark share (with its import record for the words); absent when they do not share one. */
    step?: FactReliability;
    /** The person's citations, whenever the tree has sources (the count for the words, also beside a step). */
    evidence?: PersonEvidence;
    /** `step`: the facts that give the mark (the weakest), in the card's order; none when the person's other facts give it. */
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

const BIRTH_EVENT_TYPES = new Set(['birth', 'baptism']);
const DEATH_EVENT_TYPES = new Set(['death', 'burial', 'cremation']);

/** The lowest quality (GEDCOM QUAY) of a citation that reads a fact from a source: an original, or a copy with primary information. */
export const CARD_SOURCE_QUALITY = 2;

/** The person has the fact at all: a name, or a date, a place or an event of the birth (baptism) or the death (burial). */
function cardFactPresent(person: Person, fact: CardStatusFact): boolean {
    if (factHasValue(person, fact)) return true;
    const types = fact === 'birth' ? BIRTH_EVENT_TYPES : fact === 'death' ? DEATH_EVENT_TYPES : null;
    return !!types && (person.events ?? []).some(e => types.has(e.type));
}

/**
 * The citations at a fact itself: the name by the person's own citations (INDI / NAME.SOUR), the birth
 * and the death by their fields or a birth / baptism (death / burial) event, any of them by the record
 * the research changed it by.
 */
function cardFactCitations(person: Person, fact: CardStatusFact, r: FactReliability): string[] {
    const ids = [...(r.sourceIds ?? [])];
    if (fact === 'name') return [...ids, ...(person.sourceIds ?? [])];
    const types = fact === 'birth' ? BIRTH_EVENT_TYPES : DEATH_EVENT_TYPES;
    ids.push(...((fact === 'birth' ? person.birthSourceIds : person.deathSourceIds) ?? []));
    for (const e of person.events ?? []) if (types.has(e.type)) ids.push(...(e.sourceIds ?? []));
    return ids;
}

/**
 * One of the citations reads the fact from a source: its quality (GEDCOM QUAY, kept on the cited
 * entry as `Source.quality`) is 2 or 3. A family tree or a memory (0), an authored work or a copy
 * with secondary information (1), and a citation without a QUAY, do not.
 */
export function citesSourceRead(data: Pick<StromData, 'sources'>, ids: readonly string[] | undefined): boolean {
    return (ids ?? []).some(id => (data.sources?.[id]?.quality ?? -1) >= CARD_SOURCE_QUALITY);
}

/**
 * One fact's mark on the tree card (K5.1), for a fact with a step: a person ✓; proven ●● (the readers
 * stay in the words); from the family tree ○○; a lead ○; probable or possible read from a source
 * (`read`: a citation of QUAY 2 or 3 at the fact) ●○, otherwise ○; no source the dotted frame.
 */
export function cardStatusClassOfFact(step: ReliabilityStep, read: boolean): CardStatusClass {
    switch (step.step) {
        case 'human': return 'cs-human';
        case 'proven': return 'cs-p2';
        case 'import': return 'cs-import';
        case 'none': return 'cs-none';
        case 'probable': case 'possible': return read ? 'cs-p1' : 'cs-res';
        default: return 'cs-res';
    }
}

const READ_STEPS: ReadonlySet<ReliabilityStepName> = new Set(['human', 'proven', 'probable', 'possible']);

/**
 * The mark of a person whose name, birth and death have no step (K5.1), from the person's other
 * facts and the couple's (residence, occupation, a wedding…): one confirmed, proven, probable or
 * possible with a citation of QUAY 2 or 3 → ●○ (the person is known from a record, e.g. as a father
 * in a child's baptism); otherwise the strongest of the rest (a lead ○, the family tree ○○, no
 * source); no step anywhere: ○ when the person cites anything, the dotted frame when not.
 */
function otherFactsClass(data: StromData, person: Person, opts: CardStatusOptions): CardStatusClass {
    const eventFacts = (events: readonly { id: string; sourceIds?: string[] }[] | undefined) =>
        (events ?? []).filter(e => e && typeof e.id === 'string').map(e => ({ fact: `event:${e.id}`, ids: e.sourceIds ?? [] }));
    const holders: { holder: Person | Partnership; facts: { fact: string; ids: string[] }[] }[] = [
        { holder: person, facts: eventFacts(person.events) },
    ];
    const unions = opts.unions?.get(person.id)
        ?? (person.partnerships ?? []).map(id => data.partnerships?.[id]).filter((u): u is Partnership => !!u);
    for (const u of unions) {
        holders.push({ holder: u, facts: [
            { fact: 'marriage', ids: u.sourceIds ?? [] }, { fact: 'divorce', ids: u.divorceSourceIds ?? [] }, ...eventFacts(u.events),
        ] });
    }
    let strongest: CardStatusClass | null = null;
    let cites = personSourceIds(person).length > 0;
    for (const { holder, facts } of holders) {
        for (const { fact, ids } of facts) {
            if (ids.length) cites = true;
            const r = factReliability(data, holder, fact, opts);
            if (!r) continue;
            const cls: CardStatusClass = READ_STEPS.has(r.step) && citesSourceRead(data, [...ids, ...(r.sourceIds ?? [])]) ? 'cs-p1'
                : r.step === 'import' ? 'cs-import' : r.step === 'none' ? 'cs-none' : 'cs-res';
            if (!strongest || CARD_STATUS_CLASSES.indexOf(cls) < CARD_STATUS_CLASSES.indexOf(strongest)) strongest = cls;
        }
    }
    return strongest ?? (cites ? 'cs-res' : 'cs-none');
}

/**
 * The tree card's one mark (spec 066 P4 §1, K5.1), or null (nothing drawn):
 * 1. a placeholder, or the switch off → null;
 * 2. the tree knows the origin → the weakest of the marks of name, birth and death the person has
 *    and that have a step (cardStatusClassOfFact; a fact without a step does not count, cited or
 *    not; a step from the family tree wins over citations that came with the file); none of them
 *    with a step → the person's other facts (otherFactsClass). The person's citations as a whole
 *    are not asked then;
 * 3. otherwise, with any source in the tree → the person's citations (full ●●, partial ●○, none);
 * 4. otherwise null (a tree with neither sources nor origin has nothing to say).
 */
export function cardStatus(data: StromData, person: Person, opts: CardStatusOptions): CardStatus | null {
    if (person.isPlaceholder || opts.status === false) return null;
    const evidence = opts.treeHasSources ? personEvidence(person, data, opts.unions) ?? undefined : undefined;
    if (treeKnowsOrigin(data, opts)) {
        const facts = CARD_STATUS_FACTS.filter(f => cardFactPresent(person, f)).flatMap(f => {
            const r = factReliability(data, person, f, opts);
            return r ? [{ f, r, cls: cardStatusClassOfFact(r, citesSourceRead(data, cardFactCitations(person, f, r))) }] : [];
        });
        const cls = CARD_STATUS_CLASSES.reduce<CardStatusClass | null>((w, c) => (facts.some(x => x.cls === c) ? c : w), null);
        if (!cls) return { cls: otherFactsClass(data, person, opts), source: 'step', ...(evidence ? { evidence } : {}), facts: [] };
        const mine = facts.filter(x => x.cls === cls);
        const first = mine[0].r;
        const shared = mine.every(x => x.r.step === first.step) ? weakestStep(mine.map(x => x.r)) : null;
        return {
            cls,
            source: 'step',
            ...(shared ? { step: shared } : {}),
            ...(evidence ? { evidence } : {}),
            facts: mine.map(x => x.f),
        };
    }
    if (!evidence) return null;
    const cls: CardStatusClass = evidence.level === 'full' ? 'cs-p2' : evidence.level === 'partial' ? 'cs-p1' : 'cs-none';
    return { cls, source: 'evidence', evidence, facts: [] };
}
