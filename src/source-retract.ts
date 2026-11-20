/**
 * Deleting a source of a followed tree in its research (spec 117 U4, §0):
 * in the research it is retracted — reversibly, with its history — and the
 * research's own preview says what rests on it.
 *
 * - the gates (`source.retract`, `material.trees` in `/status.features`) and
 *   where deleting is offered (`sourceRetractOffered`);
 * - the bridge's calls: the preview and the deletion (`POST /source/retract`,
 *   dry run first, then the bridge's confirmation of the list shown), Undo
 *   (`POST /source/restore`) and "Decision stands" (`POST /conflict/keep`),
 *   with the research's refusals as the app's kinds;
 * - the research's list of impacts read defensively, and what the dialog
 *   shows of it (`retractSummary`);
 * - the dialog's state (`RetractState`), and the tree's memory of sources
 *   deleted in edit mode until the research says it retracted them.
 *
 * The dialog is in src/ui/source-retract-ui.ts.
 */

import type { PartnershipId, PersonId, ResearchConflict, ResearchLink, StromData, TreeId } from './types.js';
import { DataManager } from './data.js';
import { TreeManager } from './tree-manager.js';
import { shownName } from './person-name.js';
import { isResearchHead, withAppVersion } from './research-link.js';
import { BridgeOptions, MATERIAL_TREES_FEATURE, RawAnswer, postInit, withBusyRetry } from './materials.js';
import { ResearchWriteHeld, writeHeldOfCode } from './research-write-held.js';

// ==================== GATES ====================

/** The research retracts a source the person deleted (preview, deletion, restore, conflict/keep, the marks of review). */
export const SOURCE_RETRACT_FEATURE = 'source.retract';
/** Family tree files in Materials (kept in src/materials.ts, which the Materials gates read). */
export { MATERIAL_TREES_FEATURE };

/** The research of a tree: its features as its bridge says them now (else last in this page), whether it answers now, its seal. */
export interface SourceRetractBridge {
    features: readonly string[] | null | undefined;
    /** The bridge answers now (and its address is known). */
    bridgeUp: boolean;
    /** The research cannot be written from here (sealed on another computer). */
    readOnly: boolean;
}

/** Where deleting a source is decided: the tree followed, the app read-only, the research's bridge. */
export interface SourceRetractEnv extends SourceRetractBridge {
    /** The open tree follows its live research (DataManager.isLiveFollowing). */
    following: boolean;
    /** No edits here at all (a view of a shared file, locked data, a newer app's tree). */
    appReadOnly: boolean;
}

/** Deleting offered and working (`on`), offered at rest while the bridge is not running (`off`), or not offered (null). */
export type SourceRetractOffer = 'on' | 'off' | null;

/** Where the bridge's state comes from (set by the research UI, research-sync-ui.ts; null: not known). */
export type SourceRetractLookup = (researchId: string) => SourceRetractBridge | null;

let bridgeOf: SourceRetractLookup = () => null;

export function setSourceRetractLookup(lookup: SourceRetractLookup): void {
    bridgeOf = lookup;
}

const has = (features: readonly string[] | null | undefined, f: string) => !!features?.includes(f);

/** What a set of features opens (a research that has not said them: nothing). */
export function sourceRetractTaken(features: readonly string[] | null | undefined): boolean {
    return has(features, SOURCE_RETRACT_FEATURE);
}

/** Family tree files in Materials and deleting them for good (`material.trees` read as all three gates). */
export function materialTreesTaken(features: readonly string[] | null | undefined): boolean {
    return has(features, MATERIAL_TREES_FEATURE);
}

/**
 * Deleting a source of a followed tree (§1, §9): not offered without a
 * followed tree, without the gate, in a read-only app or research; at rest
 * (`off`) while the bridge does not answer; else on.
 */
export function sourceRetractOfferedIn(env: SourceRetractEnv): SourceRetractOffer {
    if (!env.following || env.appReadOnly || env.readOnly || !sourceRetractTaken(env.features)) return null;
    return env.bridgeUp ? 'on' : 'off';
}

/** The same for the open tree, now. */
export function sourceRetractOffered(): SourceRetractOffer {
    const link = TreeManager.getActiveTreeMetadata()?.research;
    if (!link?.id || link.copy) return null;
    const bridge = bridgeOf(link.id.toLowerCase());
    if (!bridge) return null;
    return sourceRetractOfferedIn({
        ...bridge,
        following: DataManager.isLiveFollowing(),
        appReadOnly: DataManager.isReadOnly(),
    });
}

/**
 * Deleting a source of a tree tied to its research but not followed (edit
 * mode, §4): `preview` — the research has the gate and its bridge answers
 * (the §2 dialog, its list from the research, deleting here); `plain` — the
 * gate without the bridge (today's confirmation, "retracted with the next
 * write"); `old` — a research that said its features without the gate (it
 * keeps the source); `unknown` — features never said (today's confirmation).
 */
export type SourceRetractEditMode = 'preview' | 'plain' | 'old' | 'unknown';

export function sourceRetractEditModeIn(bridge: SourceRetractBridge | null): SourceRetractEditMode {
    if (sourceRetractTaken(bridge?.features)) return bridge!.bridgeUp && !bridge!.readOnly ? 'preview' : 'plain';
    return bridge?.features ? 'old' : 'unknown';
}

/** The same for a source of the open tree (its REFN): null when it is not the research's source or the tree is not tied in edit mode. */
export function sourceRetractEditMode(refn: unknown): SourceRetractEditMode | null {
    const link = TreeManager.getActiveTreeMetadata()?.research;
    if (!link?.id || link.copy || !ref(refn, SOURCE_REF) || DataManager.isLiveFollowing()) return null;
    return sourceRetractEditModeIn(bridgeOf(link.id.toLowerCase()));
}

/**
 * Restoring a retracted source in the research from the app (§4, "What was
 * written"): the gate, the bridge answering, the research writable from here.
 */
export function sourceRestoreOffered(): boolean {
    const link = TreeManager.getActiveTreeMetadata()?.research;
    if (!link?.id || link.copy || DataManager.isReadOnly()) return false;
    const bridge = bridgeOf(link.id.toLowerCase());
    return !!bridge && bridge.bridgeUp && !bridge.readOnly && sourceRetractTaken(bridge.features);
}

/**
 * "Decision stands" on a decided conflict marked for review (§8, §9): only
 * with the gate, the bridge answering and the research writable from here,
 * in an app that takes edits. Following the tree live is not needed (a
 * conflict is the research's, kept through its bridge).
 */
export function conflictKeepOfferedIn(bridge: SourceRetractBridge | null, appReadOnly: boolean): boolean {
    return !!bridge && !appReadOnly && !bridge.readOnly && bridge.bridgeUp && sourceRetractTaken(bridge.features);
}

/** The same for the open tree's research, now. */
export function conflictKeepOffered(): boolean {
    const link = TreeManager.getActiveTreeMetadata()?.research;
    if (!link?.id || link.copy) return false;
    return conflictKeepOfferedIn(bridgeOf(link.id.toLowerCase()), DataManager.isReadOnly());
}

/**
 * What an answer of "Decision stands" leaves on the card: kept (the mark is
 * gone, also when the research says it had none: `notMarked`, the tree is
 * loaded again quietly), read-only (the action goes, its sentence stays),
 * failed (the action stays with the sentence: the bridge's refusal, a busy
 * research waited out, no answer). A conflict the research no longer has
 * reads as kept too: loading the tree says the rest.
 */
export type ConflictKeepOutcome = 'kept' | 'readonly' | 'failed';

export function conflictKeepOutcome(result: RetractResult<KeepDone>): ConflictKeepOutcome {
    if (result.ok) return 'kept';
    switch (result.error.kind) {
        case 'notMarked': case 'conflictGone': return 'kept';
        case 'readonly': return 'readonly';
        case 'held': return result.error.held?.kind === 'seal' ? 'readonly' : 'failed';
        default: return 'failed';
    }
}

// ==================== THE RESEARCH'S LIST OF IMPACTS ====================

/** How many sources one call takes (the research's `RETRACT_MOST`); the app sends one. */
export const RETRACT_MAX_SOURCES = 50;
/** How long a list's items go; the rest only counted (`more`). */
export const RETRACT_LIST_MAX = 200;

/** One citation line of the source: whose fact (REFN of a person or a family), which, how many other sources it keeps. */
export interface SourceImpactCite {
    owner: string;
    /** The fact's tag (BIRT, NAME, MARR, FAM for a family itself …). */
    fact: string;
    /** The fact's id in the research (E0311), when it has one. */
    event?: string;
    others: number;
    locator?: string;
    main?: true;
}

export interface SourceImpactFact {
    owner: string;
    fact: string;
    event?: string;
}

/** A fact whose status the citations left cannot carry: its status now and after. */
export interface SourceImpactLowered extends SourceImpactFact {
    from: string;
    to: string;
}

export interface SourceImpactConflict {
    id: string;
    status: 'open' | 'decided';
    /** `review`: it stands on the source and gets the mark of review; `unchanged`: it does not. */
    becomes: 'review' | 'unchanged';
}

export interface SourceImpactTask {
    id: string;
    /** Its state now (open, doing, parked, waiting …), as the research says it. */
    state: string;
    /** Given up (the source was its only place) or the source taken out of its places. */
    becomes: 'dropped' | 'narrowed';
    /** Who works on it now (state doing). */
    heldBy?: string;
}

/** Citation lines by kind (a person's own citation is the research's first name's: `persons` is never read). */
export interface SourceImpactCounts {
    names: number;
    events: number;
    families: number;
    stories: number;
}

export interface SourceImpactMore {
    cites: number;
    stories: number;
    bare: number;
    lowered: number;
    conflicts: number;
    tasks: number;
    files: number;
}

/** What deleting one source takes with it (`impacts[]` of `POST /source/retract`). */
export interface SourceImpact {
    id: string;
    title: string;
    /** The file of the material it was made from (I…). */
    input?: string;
    counts: SourceImpactCounts;
    cites: SourceImpactCite[];
    stories: { owner: string; inText: boolean }[];
    /** Facts and names left with no citation. */
    bare: SourceImpactFact[];
    /** Facts becoming less certain (a bare one among them). */
    lowered: SourceImpactLowered[];
    conflicts: SourceImpactConflict[];
    tasks: SourceImpactTask[];
    /** The files of the material it is of (they stay in Materials). */
    files: string[];
    /** Its images from an archive (they stay with it). */
    images: number;
    more: SourceImpactMore;
}

const SOURCE_REF = /^S\d{1,9}$/;
const FILE_ID = /^I\d{1,9}$/;
const OWNER_REF = /^[PF]\d{1,9}$/;
const FACT_TAG = /^[A-Z_][A-Z0-9_]{0,31}$/;
const EVENT_REF = /^E\d{1,9}$/;
const CONFLICT_REF = /^X\d{1,9}$/;
const TASK_REF = /^[A-Za-z0-9_-]{1,60}$/;
const WORD = /^[a-z][a-zA-Z_-]{0,31}$/;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const ref = (v: unknown, re: RegExp): string | undefined => {
    const s = typeof v === 'string' ? v.trim() : '';
    return re.test(s) ? s : undefined;
};
const tag = (v: unknown): string | undefined => ref(typeof v === 'string' ? v.toUpperCase() : v, FACT_TAG);

/** A short text of the research, cleaned (control characters out), or undefined. */
function text(v: unknown, max: number): string | undefined {
    if (typeof v !== 'string') return undefined;
    const t = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/ {2,}/g, ' ').trim();
    return t ? t.slice(0, max) : undefined;
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, RETRACT_LIST_MAX) : []);

function factOf(v: unknown): SourceImpactFact | null {
    const o = obj(v);
    const owner = ref(o?.owner, OWNER_REF);
    // `name` stands for the fact of a name (as the contract once said it).
    const fact = tag(o?.fact) ?? (o?.name !== undefined ? 'NAME' : undefined);
    if (!o || !owner || !fact) return null;
    const event = ref(o.event, EVENT_REF);
    return { owner, fact, ...(event ? { event } : {}) };
}

/** The research's list of what deleting sources takes, source by source (anything not understood left out). */
export function parseSourceImpacts(raw: unknown): SourceImpact[] {
    const out: SourceImpact[] = [];
    for (const x of Array.isArray(raw) ? raw.slice(0, RETRACT_MAX_SOURCES) : []) {
        const o = obj(x);
        const id = ref(o?.id, SOURCE_REF);
        if (!o || !id || out.some(i => i.id === id)) continue;
        const c = obj(o.counts) ?? {};
        const m = obj(o.more) ?? {};
        const input = ref(o.input, FILE_ID);
        const cites: SourceImpactCite[] = [];
        for (const y of list(o.cites)) {
            const f = factOf(y);
            if (!f) continue;
            const yo = y as Record<string, unknown>;
            const locator = text(yo.locator, 200);
            cites.push({ ...f, others: count(yo.others), ...(locator ? { locator } : {}), ...(yo.main === true ? { main: true as const } : {}) });
        }
        const stories: SourceImpact['stories'] = [];
        for (const y of list(o.stories)) {
            const owner = ref(obj(y)?.owner, OWNER_REF);
            if (owner) stories.push({ owner, inText: obj(y)!.inText === true });
        }
        const bare = list(o.bare).map(factOf).filter((f): f is SourceImpactFact => !!f);
        const lowered: SourceImpactLowered[] = [];
        for (const y of list(o.lowered)) {
            const f = factOf(y);
            const yo = obj(y);
            const from = ref(yo?.from, WORD);
            const to = ref(yo?.to, WORD);
            if (f && from && to) lowered.push({ ...f, from, to });
        }
        const conflicts: SourceImpactConflict[] = [];
        for (const y of list(o.conflicts)) {
            const yo = obj(y);
            const cid = ref(yo?.id, CONFLICT_REF);
            if (!yo || !cid || conflicts.some(k => k.id === cid)) continue;
            // The research says its own state (resolved); the app's word is decided.
            const status = yo.status === 'decided' || yo.status === 'resolved' ? 'decided' : 'open';
            conflicts.push({ id: cid, status, becomes: yo.becomes === 'review' ? 'review' : 'unchanged' });
        }
        const tasks: SourceImpactTask[] = [];
        for (const y of list(o.tasks)) {
            const yo = obj(y);
            const tid = ref(yo?.id, TASK_REF);
            if (!yo || !tid || tasks.some(k => k.id === tid)) continue;
            const becomes = yo.becomes === 'dropped' || yo.becomes === 'narrowed' ? yo.becomes : null;
            if (!becomes) continue;
            const heldBy = text(yo.heldBy, 100);
            // `status` as the contract once named it.
            tasks.push({ id: tid, state: ref(yo.state ?? yo.status, WORD) ?? 'open', becomes, ...(heldBy ? { heldBy } : {}) });
        }
        const files = [...new Set(list(o.files).map(f => ref(f, FILE_ID)).filter((f): f is string => !!f))];
        out.push({
            id,
            title: text(o.title, 300) ?? id,
            ...(input ? { input } : {}),
            counts: { names: count(c.names), events: count(c.events), families: count(c.families), stories: count(c.stories) },
            cites, stories, bare, lowered, conflicts, tasks, files,
            images: count(o.images),
            more: {
                cites: count(m.cites), stories: count(m.stories), bare: count(m.bare), lowered: count(m.lowered),
                conflicts: count(m.conflicts), tasks: count(m.tasks), files: count(m.files),
            },
        });
    }
    return out;
}

// ==================== WHAT THE DIALOG SHOWS ====================

/** Rows shown of each list (§2): facts 4, without a source 3, less certain 3; conflicts and tasks all. */
export const RETRACT_SHOWN = { cites: 4, bare: 3, lowered: 3 } as const;

/** Whose a fact is, as the tree knows them (a person or a couple missing from it: its research id). */
export interface RetractOwner {
    ref: string;
    /** The person's name, the couple's names (joined by " & "), else the research id. */
    name: string;
    personId?: PersonId;
    partnershipId?: PartnershipId;
}

export interface RetractCiteRow {
    owner: RetractOwner;
    fact: string;
    event?: string;
    main: boolean;
    locator?: string;
    /** The fact keeps another source; else it is left without one. */
    hasOther: boolean;
}

export interface RetractFactRow {
    owner: RetractOwner;
    fact: string;
    event?: string;
}

export interface RetractLoweredRow extends RetractFactRow {
    from: string;
    to: string;
}

export interface RetractConflictRow {
    id: string;
    status: 'open' | 'decided';
    /** The conflict as the tree has it (its title; null: not in the tree). */
    conflict: ResearchConflict | null;
}

/** One source's impacts as the dialog shows them. */
export interface RetractSummary {
    id: string;
    title: string;
    input?: string;
    /** Citations on facts (names + events + families) and stories: counted by the research, never recounted here. */
    citations: number;
    stories: number;
    /** The kinds with their counts, those with none left out (no "persons": J8). */
    parts: { kind: keyof SourceImpactCounts; n: number }[];
    /** Nothing cites the source. */
    noCites: boolean;
    cites: RetractCiteRow[];
    /** Citation lines beyond the rows shown. */
    citesMore: number;
    /** Facts left without a source (the warning), the rows shown, the rest. */
    bare: number;
    bareRows: RetractFactRow[];
    bareMore: number;
    /** Facts becoming less certain, the bare ones not counted again (J2). */
    lowered: number;
    loweredRows: RetractLoweredRow[];
    loweredMore: number;
    /** A story names the source in its text (its code stays there as plain text). */
    storyInText: boolean;
    /** Conflicts marked for review (those staying unchanged left out). */
    conflicts: RetractConflictRow[];
    tasks: SourceImpactTask[];
    files: string[];
    images: number;
}

const factKey = (f: SourceImpactFact) => `${f.owner}|${f.fact}|${f.event ?? ''}`;

/** Who a research id names in the tree. */
export function retractOwner(ownerRef: string, data: Pick<StromData, 'persons' | 'partnerships'>): RetractOwner {
    if (ownerRef.startsWith('P')) {
        const person = Object.values(data.persons).find(p => p.refn?.trim() === ownerRef);
        return person ? { ref: ownerRef, name: shownName(person), personId: person.id } : { ref: ownerRef, name: ownerRef };
    }
    const couple = Object.values(data.partnerships).find(p => p.researchId?.trim() === ownerRef);
    if (!couple) return { ref: ownerRef, name: ownerRef };
    const names = [couple.person1Id, couple.person2Id].map(id => data.persons[id]).filter(p => !!p).map(p => shownName(p));
    return { ref: ownerRef, name: names.length ? names.join(' & ') : ownerRef, partnershipId: couple.id };
}

/** A conflict of the tree by its research id (null: none). */
function treeConflict(id: string, data: Pick<StromData, 'persons'>): ResearchConflict | null {
    for (const p of Object.values(data.persons)) {
        const c = p.research?.conflicts?.find(x => x.id === id);
        if (c) return c;
    }
    return null;
}

/**
 * The research's list for one source, as the dialog shows it (§2): the
 * counts as the research says them, the facts that rest on it (main
 * citations and those left without a source first), the facts left without a
 * source, those becoming less certain apart from those (J2), the conflicts
 * marked for review, the tasks, the files. Names from the tree.
 */
export function retractSummary(impact: SourceImpact, data: Pick<StromData, 'persons' | 'partnerships'>): RetractSummary {
    const owners = new Map<string, RetractOwner>();
    const owner = (r: string) => {
        let o = owners.get(r);
        if (!o) owners.set(r, o = retractOwner(r, data));
        return o;
    };
    const c = impact.counts;
    // Never fewer than the rows the research listed (a count it left out).
    const citations = Math.max(c.names + c.events + c.families, impact.cites.length + impact.more.cites);
    const stories = Math.max(c.stories, impact.stories.length + impact.more.stories);
    const parts = (['names', 'events', 'families', 'stories'] as const)
        .map(kind => ({ kind, n: kind === 'stories' ? stories : c[kind] }))
        .filter(p => p.n > 0);

    const rank = (x: SourceImpactCite) => (x.main ? 0 : x.others === 0 ? 1 : 2);
    const cites = impact.cites
        .map((x, i) => ({ x, i }))
        .sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i)
        .slice(0, RETRACT_SHOWN.cites)
        .map(({ x }): RetractCiteRow => ({
            owner: owner(x.owner), fact: x.fact, ...(x.event ? { event: x.event } : {}),
            main: !!x.main, ...(x.locator ? { locator: x.locator } : {}), hasOther: x.others > 0,
        }));

    const factRow = (f: SourceImpactFact): RetractFactRow => ({ owner: owner(f.owner), fact: f.fact, ...(f.event ? { event: f.event } : {}) });
    const bare = impact.bare.length + impact.more.bare;
    const bareRows = impact.bare.slice(0, RETRACT_SHOWN.bare).map(factRow);
    const bareKeys = new Set(impact.bare.map(factKey));
    const lowered = impact.lowered.filter(l => !bareKeys.has(factKey(l)));
    const loweredN = lowered.length + impact.more.lowered;
    const loweredRows = lowered.slice(0, RETRACT_SHOWN.lowered).map(l => ({ ...factRow(l), from: l.from, to: l.to }));

    return {
        id: impact.id,
        title: impact.title,
        ...(impact.input ? { input: impact.input } : {}),
        citations, stories, parts,
        noCites: citations === 0 && stories === 0,
        cites,
        citesMore: Math.max(0, citations - cites.length),
        bare, bareRows, bareMore: Math.max(0, bare - bareRows.length),
        lowered: loweredN, loweredRows, loweredMore: Math.max(0, loweredN - loweredRows.length),
        storyInText: impact.stories.some(s => s.inText),
        conflicts: impact.conflicts
            .filter(k => k.becomes === 'review')
            .map(k => ({ id: k.id, status: k.status, conflict: treeConflict(k.id, data) })),
        tasks: impact.tasks,
        files: impact.files,
        images: impact.images,
    };
}

/** What the research says of its tasks somewhere the app reads (its queue, its waiting list): their names by id. */
export interface RetractTaskSource {
    queue?: readonly { id: string; text: string }[];
    waiting?: readonly { id: string; what: string }[];
}

/**
 * The names of tasks the app knows (the research's queue and waiting list,
 * the first source that names a task wins); a task none of them has keeps
 * its id in the list (§2 "Tasks").
 */
export function retractTaskTitles(sources: readonly (RetractTaskSource | null | undefined)[]): Map<string, string> {
    const out = new Map<string, string>();
    const put = (id: string, name: string) => {
        const t = name.trim();
        if (id && t && !out.has(id)) out.set(id, t);
    };
    for (const s of sources) {
        if (!s) continue;
        for (const q of s.queue ?? []) put(q.id, q.text);
        for (const w of s.waiting ?? []) put(w.id, w.what);
    }
    return out;
}

// ==================== THE DIALOG'S STATE ====================

/**
 * The dialog's state (as material-delete.ts, without a box to tick: deleting
 * a source can be undone): `loading` while the preview is asked, `ready` with
 * its list, `sending` while the deletion goes, `failed` when no list could be
 * had. `note`: the list was asked again (it changed meanwhile, or the
 * confirmation ran out), said above it until the dialog closes.
 */
export interface RetractState {
    phase: 'loading' | 'ready' | 'sending' | 'failed';
    impacts: SourceImpact[];
    /** The bridge's confirmation of exactly the list shown (null: none yet). */
    confirm: string | null;
    note: 'changed' | 'expired' | null;
}

export function retractStart(): RetractState {
    return { phase: 'loading', impacts: [], confirm: null, note: null };
}

/** The preview answered: its list and its confirmation. */
export function retractListed(s: RetractState, impacts: SourceImpact[], confirm: string): RetractState {
    return { ...s, phase: 'ready', impacts, confirm };
}

/**
 * The research changed since the list was shown (409 with the new list): the
 * new list at once (none said: the one shown stays until the new preview
 * answers), no confirmation until a new preview gives one.
 */
export function retractChanged(s: RetractState, impacts?: SourceImpact[]): RetractState {
    return { phase: 'ready', impacts: impacts?.length ? impacts : s.impacts, confirm: null, note: 'changed' };
}

/** The confirmation ran out (15 minutes): the list stays until the new preview answers, no confirmation meanwhile. */
export function retractExpired(s: RetractState): RetractState {
    return { phase: 'ready', impacts: s.impacts, confirm: null, note: 'expired' };
}

export function retractSending(s: RetractState): RetractState {
    return { ...s, phase: 'sending' };
}

/** The deletion did not go (the list and its confirmation stay: it can be sent again). */
export function retractNotSent(s: RetractState): RetractState {
    return { ...s, phase: 'ready' };
}

export function retractFailed(s: RetractState): RetractState {
    return { ...s, phase: 'failed', confirm: null };
}

/** The danger button works: the list shown with the bridge's confirmation. */
export function retractCanGo(s: RetractState): boolean {
    return s.phase === 'ready' && !!s.confirm && s.impacts.length > 0;
}

// ==================== THE BRIDGE ====================

/**
 * A refusal as the app reads it:
 * - `body` (400 source.body; after a confirmation: `expired`, the 15 minutes ran out — ask the preview again);
 * - `gone` (404 source.unknown), `already` (409 source.retracted), `notRetracted` (409, restore), `notRestorable`
 *   (409, `why` merged | other), `changed` (409 source.retract-changed, with the new list);
 * - `busy` (409 source.busy, waited out quietly first), `readonly` (403 source.readonly), `failed` (500 source.failed);
 * - `conflictGone` (404 conflict.unknown), `notMarked` (409 conflict.notMarked);
 * - `held` (sealed elsewhere, files not downloaded, a full disk: the research's sentence);
 * - `missing` (404 without a code: a bridge without the route), `down` (no answer), `aborted`, `unknown` (anything else).
 */
export type RetractErrorKind =
    | 'body' | 'expired' | 'gone' | 'already' | 'notRetracted' | 'notRestorable' | 'changed'
    | 'busy' | 'readonly' | 'failed' | 'conflictGone' | 'notMarked' | 'held'
    | 'missing' | 'down' | 'aborted' | 'unknown';

export interface RetractError {
    kind: RetractErrorKind;
    /** HTTP status (0: no answer). */
    status: number;
    code?: string;
    /** The source or conflict the refusal names (`params.id`). */
    id?: string;
    /** `notRestorable`: why it cannot be put back. */
    why?: 'merged' | 'other';
    /** Seconds the research asked to wait (busy). */
    retry?: number;
    held?: ResearchWriteHeld;
}

const CODE_KINDS: Record<string, RetractErrorKind> = {
    'source.body': 'body',
    'source.unknown': 'gone',
    'source.retracted': 'already',
    'source.notRetracted': 'notRetracted',
    'source.notRestorable': 'notRestorable',
    'source.retract-changed': 'changed',
    'source.busy': 'busy',
    'source.readonly': 'readonly',
    'source.failed': 'failed',
    'conflict.unknown': 'conflictGone',
    'conflict.notMarked': 'notMarked',
};

/** A refusal of the bridge (`{error, code, params?}`) as the app's kind. */
export function retractErrorOf(status: number, body: unknown, retryAfter?: string | null): RetractError {
    const b = obj(body) ?? {};
    const code = typeof b.code === 'string' ? b.code : undefined;
    const held = status === 409 || status === 507 ? writeHeldOfCode(code, b.error, b.params) : null;
    if (held) return { kind: 'held', status, ...(code ? { code } : {}), held };
    let kind: RetractErrorKind = code && Object.prototype.hasOwnProperty.call(CODE_KINDS, code) ? CODE_KINDS[code] : 'unknown';
    if (kind === 'unknown' && !code) {
        if (status === 404) kind = 'missing';
        else if (status === 403) kind = 'readonly';
        else if (status === 503) kind = 'busy';
    }
    const err: RetractError = { kind, status, ...(code ? { code } : {}) };
    const p = obj(b.params) ?? {};
    const id = ref(p.id, /^[SX]\d{1,9}$/);
    if (id) err.id = id;
    if (kind === 'notRestorable') err.why = p.why === 'merged' ? 'merged' : 'other';
    const fromHeader = retryAfter ? Number(retryAfter) : NaN;
    const retry = Number.isFinite(fromHeader) ? fromHeader : typeof b.retry === 'number' ? b.retry : NaN;
    if (Number.isFinite(retry) && retry >= 0) err.retry = retry;
    return err;
}

/**
 * What an error asks of the dialog: load the tree again (the research
 * changed under it), send again (busy, failed, no answer), ask the preview
 * again (the list changed, the confirmation ran out), or nothing.
 */
export function retractErrorAction(err: RetractError): 'reload' | 'retry' | 'preview' | null {
    switch (err.kind) {
        case 'gone': case 'already': case 'notRetracted': case 'conflictGone': case 'notMarked': return 'reload';
        case 'busy': case 'failed': case 'down': return 'retry';
        case 'changed': case 'expired': return 'preview';
        default: return null;
    }
}

export type RetractResult<T> = { ok: true; value: T } | { ok: false; error: RetractError; changed?: SourceImpact[] };

/** The preview's answer: what deleting takes and the bridge's confirmation of that list (15 minutes). */
export interface RetractDry {
    sources: string[];
    impacts: SourceImpact[];
    confirm: string;
}

/** The deletion's answer. */
export interface RetractDone {
    sources: string[];
    retracted: string[];
    impacts: SourceImpact[];
    /** The research's head after the write ('' = not said), and just before it. */
    head: string;
    parent: string;
}

/** A citation Undo could not put back: the fact gone meanwhile, cited again already, or with another main citation. */
export interface RestoreSkipped {
    source?: string;
    owner: string;
    fact: string;
    event?: string;
    why: 'gone' | 'already' | 'main' | 'other';
}

/** Undo's answer. */
export interface RestoreDone {
    restored: string[];
    /** Citations put back. */
    citations: number;
    skipped: RestoreSkipped[];
    head: string;
    parent: string;
}

/** "Decision stands": the conflict no longer marked. */
export interface KeepDone {
    conflict: string;
    head: string;
    parent: string;
}

/** Busy is waited out (2 s, or what the research asks, three times at most); a changed list or another refusal never. */
const busyOnly = (a: RawAnswer): boolean => obj(a.body)?.code === 'source.busy';
const SOURCE_BUSY_DELAYS_MS = [2000, 2000, 2000] as const;

const bodyError = (): { ok: false; error: RetractError } => ({ ok: false, error: { kind: 'body', status: 0 } });
const sourceIds = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.map(x => ref(x, SOURCE_REF)).filter((x): x is string => !!x))] : []);
const validSources = (ids: readonly string[]) => ids.length > 0 && ids.length <= RETRACT_MAX_SOURCES && ids.every(i => SOURCE_REF.test(i));
const heads = (b: Record<string, unknown>) => ({ head: isResearchHead(b.head) ?? '', parent: isResearchHead(b.parent) ?? '' });

async function post(base: string, path: string, body: unknown, opts: BridgeOptions): Promise<RawAnswer | RetractError> {
    const answer = await withBusyRetry(withAppVersion(`${base}${path}`), postInit(body), { retryDelaysMs: SOURCE_BUSY_DELAYS_MS, ...opts }, false, busyOnly);
    return 'kind' in answer ? { kind: answer.kind === 'aborted' ? 'aborted' : 'down', status: 0 } : answer;
}

/** What deleting sources would take with them (`POST /source/retract {sources, dryRun: true}`): nothing is written. */
export async function retractSourceDry(base: string, sources: string[], opts: BridgeOptions = {}): Promise<RetractResult<RetractDry>> {
    if (!validSources(sources)) return bodyError();
    const answer = await post(base, '/source/retract', { sources, dryRun: true }, opts);
    if ('kind' in answer) return { ok: false, error: answer };
    const b = obj(answer.body);
    if (answer.status === 200 && b) {
        const confirm = typeof b.confirm === 'string' && b.confirm.length <= 4096 ? b.confirm : '';
        if (b.dryRun !== true || !confirm) return bodyError();
        return { ok: true, value: { sources: sourceIds(b.sources), impacts: parseSourceImpacts(b.impacts), confirm } };
    }
    return { ok: false, error: retractErrorOf(answer.status, answer.body, answer.retryAfter) };
}

/**
 * Delete sources in the research (`POST /source/retract {sources, confirm}`):
 * only with the confirmation of a preview whose list the person saw. A list
 * changed meanwhile comes back to be shown (`changed`); a confirmation that
 * ran out is `expired`.
 */
export async function retractSource(base: string, sources: string[], confirm: string, opts: BridgeOptions = {}): Promise<RetractResult<RetractDone>> {
    if (!validSources(sources) || !confirm) return bodyError();
    const answer = await post(base, '/source/retract', { sources, confirm }, opts);
    if ('kind' in answer) return { ok: false, error: answer };
    const b = obj(answer.body);
    if (answer.status === 200 && b) {
        return { ok: true, value: { sources: sourceIds(b.sources), retracted: sourceIds(b.retracted), impacts: parseSourceImpacts(b.impacts), ...heads(b) } };
    }
    const error = retractErrorOf(answer.status, answer.body, answer.retryAfter);
    if (error.kind === 'changed') return { ok: false, error, changed: parseSourceImpacts(b?.impacts ?? obj(b?.params)?.impacts) };
    // The confirmation no longer holds (15 minutes): a new preview.
    if (error.kind === 'body') error.kind = 'expired';
    return { ok: false, error };
}

function skippedOf(v: unknown): RestoreSkipped[] {
    const out: RestoreSkipped[] = [];
    for (const y of list(v)) {
        const f = factOf(y);
        if (!f) continue;
        const yo = y as Record<string, unknown>;
        const why = yo.why === 'gone' || yo.why === 'already' || yo.why === 'main' ? yo.why : 'other';
        const source = ref(yo.source, SOURCE_REF);
        out.push({ ...(source ? { source } : {}), ...f, why });
    }
    return out;
}

/** Undo: sources the person deleted put back with their citations (`POST /source/restore {sources}`). */
export async function restoreSource(base: string, sources: string[], opts: BridgeOptions = {}): Promise<RetractResult<RestoreDone>> {
    if (!validSources(sources)) return bodyError();
    const answer = await post(base, '/source/restore', { sources }, opts);
    if ('kind' in answer) return { ok: false, error: answer };
    const b = obj(answer.body);
    if (answer.status === 200 && b) {
        return { ok: true, value: { restored: sourceIds(b.restored), citations: count(b.citations), skipped: skippedOf(b.skipped), ...heads(b) } };
    }
    return { ok: false, error: retractErrorOf(answer.status, answer.body, answer.retryAfter) };
}

/** "Decision stands": a decided conflict marked for review kept as decided (`POST /conflict/keep {conflict}`). */
export async function keepConflict(base: string, conflict: string, opts: BridgeOptions = {}): Promise<RetractResult<KeepDone>> {
    const id = ref(conflict, CONFLICT_REF);
    if (!id) return bodyError();
    const answer = await post(base, '/conflict/keep', { conflict: id }, opts);
    if ('kind' in answer) return { ok: false, error: answer };
    const b = obj(answer.body);
    if (answer.status === 200 && b) return { ok: true, value: { conflict: ref(b.conflict, CONFLICT_REF) ?? id, ...heads(b) } };
    return { ok: false, error: retractErrorOf(answer.status, answer.body, answer.retryAfter) };
}

// ==================== SOURCES DELETED IN EDIT MODE ====================

/**
 * The sources the person deleted in edit mode, by their research id
 * (`ResearchLink.deletedSources`): sent as `_STROM_SOURCE_DELETED` until the
 * research says it retracted them (`retracted` of `/sync` or
 * `/status.sends`). Only the research's ids (S0042) are kept.
 */
export function deletedSourcesOf(link: Pick<ResearchLink, 'deletedSources'> | undefined): string[] {
    return sourceIds(link?.deletedSources);
}

/** The list with one more (kept once). */
export function withDeletedSource(ids: readonly string[], id: string): string[] {
    const s = ref(id, SOURCE_REF);
    const all = sourceIds(ids);
    return s && !all.includes(s) ? [...all, s] : all;
}

/** A research source id by its number (S42 and S0042 are one source, as the research reads them). */
const sourceNum = (id: unknown): string => (typeof id === 'string' && /^S\d{1,9}$/i.test(id.trim()) ? String(Number(id.trim().slice(1))) : '');

/** The list without those the research retracted (S42 = S0042). */
export function withoutDeletedSources(ids: readonly string[], gone: readonly string[]): string[] {
    const out = new Set(gone.map(sourceNum).filter(Boolean));
    return sourceIds(ids).filter(i => !out.has(sourceNum(i)));
}

/** Of the deleted sources, those back in the tree (Undo, a load): their research id is a source's REFN again. */
export function deletedSourcesBack(ids: readonly string[], data: Pick<StromData, 'sources'>): string[] {
    const present = new Set(Object.values(data.sources ?? {}).map(s => sourceNum(s.refn)).filter(Boolean));
    return sourceIds(ids).filter(i => present.has(sourceNum(i)));
}

/**
 * What a file for the research says deleted (`_STROM_SOURCE_DELETED`): the
 * remembered ones, only to a research with `source.retract` (else nothing;
 * an older one keeps the source and it comes back with the next load).
 */
export function deletedSourcesToSend(link: Pick<ResearchLink, 'id' | 'deletedSources'> | undefined): string[] {
    const ids = deletedSourcesOf(link);
    return ids.length && link?.id && sourceRetractTaken(bridgeOf(link.id.toLowerCase())?.features) ? ids : [];
}

/** Forget the deleted sources that are back in the tree's data (Undo after deleting): never sent as deleted. */
export function forgetDeletedSourcesBack(treeId: TreeId, data: Pick<StromData, 'sources'>): void {
    const back = deletedSourcesBack(deletedSourcesOf(TreeManager.getTreeMetadata(treeId)?.research), data);
    if (back.length) forgetDeletedSources(treeId, back);
}

/** Remember a source deleted in edit mode on the tree's research link (no link, no research id: nothing). */
export function rememberDeletedSource(treeId: TreeId, id: string): void {
    const link = TreeManager.getTreeMetadata(treeId)?.research;
    if (!link || !ref(id, SOURCE_REF)) return;
    const next = withDeletedSource(deletedSourcesOf(link), id);
    if (next.length !== deletedSourcesOf(link).length) TreeManager.patchResearchLink(treeId, { deletedSources: next });
}

/** Forget the sources the research retracted (the last one gone: the field goes). */
export function forgetDeletedSources(treeId: TreeId, gone: readonly string[]): void {
    const link = TreeManager.getTreeMetadata(treeId)?.research;
    const now = deletedSourcesOf(link);
    if (!link || !now.length || !gone.length) return;
    const next = withoutDeletedSources(now, gone);
    if (next.length !== now.length) TreeManager.patchResearchLink(treeId, { deletedSources: next.length ? next : undefined });
}
