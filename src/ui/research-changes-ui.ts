/**
 * Changes per person (A2): what the user changed since the research's
 * version, person by person — "What will be sent" before a send, "What was
 * written" after one. The base is the copy of the research's version kept in
 * this browser (research-copy.ts), refreshed whenever the tree takes a version
 * from the research or the research writes a send. A copy that no longer
 * matches the tree's tie (another path moved the base) is not used.
 */

import { researchOpenLabel } from './research-open-mark.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { Person, PersonId, StromData, TreeId } from '../types.js';
import { formatLiveClock } from '../live-time.js';
import {
    ChangeKind, PersonChange, diffByPerson, baseCopy, diffOther, otherRowCount, previewInexact, OtherChanges, SourceChange, CoupleChange,
    SourceChangeKind, CoupleChangeKind, PlaceChange, VariantChange, SentOtherRow, sentOtherRows, sanitizeSentOtherRow,
    sourceAppOnly, coupleAppOnly, placesAppOnly, variantsAppOnly, lineageAppOnly, pairNotWritten, RESEARCH_UNREAD_KINDS,
} from '../research-changes.js';
import { saveResearchCopy, loadResearchCopy, saveResearchPrevCopy, loadResearchPrevCopy } from '../research-copy.js';
import { researchAutoState, patchResearchAutoState, noteResearchSendPreviewSkipped } from '../research-device.js';
import { researchSendMode, personsByResearchRefs } from './research-sync-ui.js';
import { researchFactLabel } from './person-research-ui.js';
import { uiModule } from './module.js';
import { surnamesReadByResearch, lineageReadByResearch } from './surname-suggest-ui.js';
import { returnFocusAfterViewer } from './sources.js';
import { shownNameOrEmpty } from '../person-name.js';

const PANEL_ID = 'research-changes-panel';
/** The fingerprint the kept copy stands for (the tie's base, or the written send's). */
const FP_KEY = 'strom-research-base-fp:';
/** The fingerprint of the copy before the last written send (the base again once that send is taken back). */
const FP_PREV_KEY = 'strom-research-base-prev-fp:';
/** What the last written send carried, person by person (for "What was written"). */
const WRITTEN_KEY = 'strom-research-written:';
/** At most this many kinds on a row, then "+ N more". */
const KINDS_SHOWN = 3;
/** At most this many people kept for "What was written". */
const WRITTEN_MAX = 200;
/** A section of "What will be sent" up to this many rows shows them all; a longer one its first GROUP_HEAD, then "+ N more". */
const GROUP_ALL = 5;
const GROUP_HEAD = 3;
/** "+ N more" adds this many rows (a section's, an expanded list's). */
const GROUP_STEP = 50;
/** An expanded list of places or surname variants shows this many first. */
const DETAIL_HEAD = 20;

/** The copy of the open tree's research version, as loaded (base null: none kept). */
let copy: { treeId: string; base: StromData | null; fp: string } | null = null;
/** The copy before the last written send replaced it (loaded with `copy`). */
let prevCopy: { treeId: string; base: StromData | null; fp: string } | null = null;
let loading: string | null = null;
let loadingDone: Promise<void> | null = null;
let memo: { treeId: string; key: string; list: PersonChange[] } | null = null;
/** The changes beyond the people, against the base they were told from. */
let otherMemo: { base: StromData; key: string; other: OtherChanges } | null = null;
/** The changes beyond the people when the open tree is in step with the research: none. */
const NO_OTHER: OtherChanges = { sources: [], couples: [] };
/**
 * A send still pending in the research: its data and list, kept until it is
 * written; `stands`: the fingerprints the kept copy could stand for when it
 * went (the tie's base, the last written send's).
 */
const pendingSent = new Map<string, { fingerprint: string; data: StromData; list: PersonChange[] | null; other: SentOtherRow[]; stands: string[] }>();

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function storedFp(treeId: string): string {
    try { return localStorage.getItem(FP_KEY + treeId) ?? ''; } catch { return ''; }
}

function sanitizeChange(v: unknown): PersonChange | null {
    const r = v as Record<string, unknown> | null;
    if (!r || typeof r.personId !== 'string' || typeof r.name !== 'string' || !Array.isArray(r.kinds)) return null;
    return {
        personId: r.personId as PersonId, name: r.name.slice(0, 200),
        kinds: r.kinds.filter((k): k is ChangeKind => typeof k === 'string').slice(0, 20),
        ...(r.deleted === true ? { deleted: true } : {}),
        ...(r.deleted === true && typeof r.refn === 'string' && /^P\d{1,9}$/.test(r.refn) ? { refn: r.refn } : {}),
    };
}

/** "What was written": the last written send's people and its rows beyond them (null: none kept). */
export function researchWrittenList(treeId: string): { at: string; list: PersonChange[]; other: SentOtherRow[] } | null {
    try {
        const raw = localStorage.getItem(WRITTEN_KEY + treeId);
        if (!raw) return null;
        const p = JSON.parse(raw) as { at?: unknown; list?: unknown; other?: unknown };
        if (typeof p.at !== 'string' || !Array.isArray(p.list)) return null;
        return {
            at: p.at, list: p.list.map(sanitizeChange).filter((c): c is PersonChange => !!c),
            other: Array.isArray(p.other) ? p.other.slice(0, WRITTEN_MAX).map(sanitizeSentOtherRow).filter((r): r is SentOtherRow => !!r) : [],
        };
    } catch {
        return null;
    }
}

function storeWritten(treeId: string, at: string, list: PersonChange[], other: SentOtherRow[] = []): void {
    try {
        localStorage.setItem(WRITTEN_KEY + treeId, JSON.stringify({ at, list: list.slice(0, WRITTEN_MAX), ...(other.length ? { other: other.slice(0, WRITTEN_MAX) } : {}) }));
    } catch { /* not kept */ }
}

/** Forget what this browser keeps of a tree's changes (the tree deleted). */
export function forgetResearchChanges(treeId: string): void {
    try {
        localStorage.removeItem(FP_KEY + treeId);
        localStorage.removeItem(FP_PREV_KEY + treeId);
        localStorage.removeItem(WRITTEN_KEY + treeId);
    } catch { /* nothing kept */ }
    if (copy?.treeId === treeId) copy = null;
    if (prevCopy?.treeId === treeId) prevCopy = null;
    pendingSent.delete(treeId);
}

/** The labels of a row's kinds: at most three, then "+ N more". */
export function changeKindsText(kinds: readonly ChangeKind[]): string {
    const c = strings.changes;
    const label: Record<ChangeKind, string> = {
        added: c.kindAdded, deleted: c.kindDeleted, name: c.kindName, gender: c.kindGender, birth: c.kindBirth, death: c.kindDeath,
        marriage: c.kindMarriage, event: c.kindEvent, godparent: c.kindGodparent, witness: c.kindWitness,
        citation: c.kindCitation, source: c.kindSource, attachment: c.kindAttachment,
        attachmentRemoved: c.kindAttachmentRemoved, note: c.kindNote, parents: c.kindParents, other: c.kindOther,
    };
    return kindsLine(kinds.map(k => label[k]));
}

/** At most three labels, then "+ N more". */
function kindsLine(labels: readonly string[]): string {
    const c = strings.changes;
    const shown = labels.slice(0, KINDS_SHOWN);
    return [...shown, ...(labels.length > KINDS_SHOWN ? [c.more(labels.length - KINDS_SHOWN)] : [])].join(' · ');
}

/** The labels of a source row's kinds. */
export function sourceKindsText(kinds: readonly SourceChangeKind[]): string {
    const c = strings.changes;
    const label: Record<SourceChangeKind, string> = {
        added: c.kindSourceAdded, deleted: c.kindSourceDeleted, title: c.kindTitle, transcript: c.kindTranscript, page: c.kindPage,
        excerptAdded: c.kindExcerptAdded, excerptRemoved: c.kindExcerptRemoved, attachment: c.kindSourceAttachment, other: c.kindOther,
    };
    return kindsLine(kinds.map(k => label[k]));
}

/** The labels of a couple row's kinds. */
export function coupleKindsText(kinds: readonly CoupleChangeKind[]): string {
    const c = strings.changes;
    const label: Record<CoupleChangeKind, string> = {
        childOrder: c.kindChildOrder, mainMarriage: c.kindMainMarriage, marriageEvidence: c.kindMarriageEvidence, singleParent: c.kindSingleParent,
    };
    return kindsLine(kinds.map(k => label[k]));
}

/** A person's name for a row beyond the people ("?" stand-in: "unknown parent"); `data` first, then `base`. */
function rowPersonName(id: PersonId, data: StromData, base?: StromData | null): string {
    const p: Person | undefined = data.persons[id] ?? base?.persons[id];
    if (!p) return '?';
    if (p.isPlaceholder) return strings.changes.unknownParent;
    return shownNameOrEmpty(p) || `${p.firstName} ${p.lastName}`.trim() || '?';
}

/** The context line of a source row: who cites it. */
function sourceContext(ch: SourceChange, data: StromData): string {
    const c = strings.changes;
    if (ch.deleted || ch.attachmentOnly) return '';
    if (ch.citedBy.persons > 0) return c.citedPersons(ch.citedBy.persons);
    if (ch.citedBy.couple) return c.citedCouple(rowPersonName(ch.citedBy.couple[0], data), rowPersonName(ch.citedBy.couple[1], data));
    return c.citedNone;
}

/** Coordinates as a row shows them ("50.071, 15.208"; none: "–"). */
function coordText(p: PlaceChange): string {
    return p.lat === undefined || p.lon === undefined ? '–' : `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`;
}

/** The one row of places / surname variants: a summary and a toggle expanding its list. */
/**
 * The kinds of change the research does not read: the spelling groups are
 * read by a research that says `surnames.read` (spec 021 §4.4).
 */
function researchUnread(readsSurnames: boolean, readsLineage = false): ReadonlySet<string> {
    if (!readsSurnames && !readsLineage) return RESEARCH_UNREAD_KINDS;
    const out = new Set(RESEARCH_UNREAD_KINDS);
    if (readsSurnames) out.delete('variants');
    if (readsLineage) out.delete('lineage');
    return out;
}

function summaryRow(key: 'places' | 'variants', labelHtml: string, context: string, toggle: string, appOnly = false): string {
    return `<li class="research-changes-row is-summary" data-kind="${key}"><span class="research-changes-icon is-ring" aria-hidden="true"></span>`
        + `<span class="research-changes-text">${rowLine(`<span class="research-changes-name">${labelHtml}</span>`, '', appOnly)}`
        + (context ? `<span class="research-changes-ctx">${esc(context)}</span>` : '')
        + `<button type="button" class="link-button research-changes-toggle" data-toggle="${key}" aria-expanded="false"`
        + ` aria-controls="research-changes-detail-${key}">${esc(toggle)}</button>`
        + `<ul class="research-changes-detail" id="research-changes-detail-${key}" hidden></ul></span></li>`;
}

/** The person a couple row centres the tree on: its first partner (the other when the first is gone or a stand-in). */
function coupleFocus(ch: CoupleChange, data: StromData): PersonId | null {
    const ok = (id: PersonId): boolean => !!data.persons[id] && !data.persons[id].isPlaceholder;
    return ok(ch.p1) ? ch.p1 : ok(ch.p2) ? ch.p2 : null;
}

/** A row's name line: a grey type before it (rows of mixed kinds), the "app only" tag after it. */
function rowLine(nameHtml: string, type: string, appOnly: boolean): string {
    if (!type && !appOnly) return nameHtml;
    const c = strings.changes;
    return `<span class="research-changes-line">${type ? `<span class="research-changes-type">${esc(type)}</span>` : ''}${nameHtml}`
        + (appOnly ? `<span class="research-changes-tag" title="${esc(c.appOnlyTitle)}">${esc(c.appOnly)}</span>` : '') + '</span>';
}

/** A person's row: a ring before a send, a tick once written. */
function personRowOf(ch: PersonChange, mode: 'send' | 'written'): string {
    const name = ch.deleted || !DataManager.getPerson(ch.personId)
        ? `<span class="research-changes-name is-deleted">${esc(ch.name)}</span>`
        : `<button type="button" class="research-changes-name" data-person="${esc(ch.personId)}">${esc(ch.name)}</button>`;
    return `<li class="research-changes-row" data-kind="person">`
        + `<span class="research-changes-icon ${mode === 'written' ? 'is-check' : 'is-ring'}" aria-hidden="true">${mode === 'written' ? '✓' : ''}</span>`
        + `<span class="research-changes-text">${name}<span class="research-changes-kinds">${esc(changeKindsText(ch.kinds))}</span></span>`
        + '</li>';
}

/**
 * A row beyond the people as a written send carried it: its type, its name (a source or a couple still in the
 * tree as a link), its kinds. `appOnly`: in the quiet section of what the research does not read (no tick).
 */
function otherRowOf(r: SentOtherRow, as: 'written' | 'appOnly', data: StromData): string {
    const c = strings.changes;
    let name: string;
    let type: string;
    let kinds = '';
    if (r.type === 'source') {
        type = c.typeSource;
        kinds = sourceKindsText(r.kinds as SourceChangeKind[]);
        name = !r.deleted && data.sources?.[r.id]
            ? `<button type="button" class="research-changes-name" data-source="${esc(r.id)}">${esc(data.sources[r.id].title?.trim() || r.title)}</button>`
            : `<span class="research-changes-name${r.deleted ? ' is-deleted' : ''}">${esc(r.title)}</span>`;
    } else if (r.type === 'couple') {
        type = c.typeCouple;
        kinds = coupleKindsText(r.kinds as CoupleChangeKind[]);
        const label = r.p1 && r.p2 ? c.coupleName(rowPersonName(r.p1, data), rowPersonName(r.p2, data)) : '?';
        const focus = r.p1 && r.p2 && !r.deleted ? coupleFocus({ partnershipId: r.id, p1: r.p1, p2: r.p2, kinds: [] }, data) : null;
        name = focus
            ? `<button type="button" class="research-changes-name" data-couple="${esc(focus)}">${esc(label)}</button>`
            : `<span class="research-changes-name">${esc(label)}</span>`;
    } else if (r.type === 'places') {
        type = c.typePlaces;
        name = `<span class="research-changes-name">${esc(c.placesRow(r.count ?? 0))}</span>`;
    } else if (r.type === 'lineage') {
        type = c.typeLineage;
        name = `<span class="research-changes-name">${esc(c.lineageRow(r.count ?? 0))}</span>`;
    } else {
        type = c.typeVariants;
        name = `<span class="research-changes-name">${esc(c.variantsRow(r.count ?? 0))}</span>`;
        kinds = r.surname ? c.variantsOf(r.surname) : '';
    }
    const icon = as === 'written'
        ? '<span class="research-changes-icon is-check" aria-hidden="true">✓</span>'
        : '<span class="research-changes-icon is-ring" aria-hidden="true"></span>';
    return `<li class="research-changes-row" data-kind="${r.type}">${icon}`
        + `<span class="research-changes-text">${rowLine(name, type, false)}${kinds ? `<span class="research-changes-kinds">${esc(kinds)}</span>` : ''}</span></li>`;
}


export const researchChangesMethods = uiModule({
    /**
     * Keep `data` as the research's version of a tree (a load, a hand-over,
     * a written send). `fp` is the fingerprint the tie counts as the base
     * (default: the tie's own, set just before).
     */
    researchKeepCopy(treeId: TreeId, data: StromData, fp?: string): void {
        const base = fp ?? TreeManager.getTreeMetadata(treeId)?.research?.fingerprint ?? '';
        copy = { treeId, base: baseCopy(data), fp: base };
        // A new base (a load, a hand-over): no send of the old one can be taken back into it.
        if (prevCopy?.treeId === treeId) prevCopy = null;
        memo = null;
        try {
            localStorage.setItem(FP_KEY + treeId, base);
            localStorage.removeItem(FP_PREV_KEY + treeId);
        } catch { /* the copy is not trusted next time */ }
        void saveResearchCopy(treeId, data, base);
    },

    /**
     * What changed in the open tree since the research's version, person by
     * person; null when it is not known (no copy kept, still loading, or the
     * copy no longer stands for the tie's base). Cached until the next edit.
     */
    researchChangesNow(): PersonChange[] | null {
        const b = this.researchChangesBase();
        if (!b) return null;
        if (b === 'same') return [];
        const { treeId, base, key } = b;
        if (memo && memo.treeId === treeId && memo.key === key) return memo.list;
        const list = diffByPerson(base, DataManager.getData());
        memo = { treeId, key, list };
        return list;
    },

    /**
     * What changed in the open tree beyond the people (sources, couples,
     * places, surname variants) since the same base as researchChangesNow;
     * null when that is not known. Cached until the next edit.
     */
    researchOtherNow(): OtherChanges | null {
        const b = this.researchChangesBase();
        if (!b) return null;
        if (b === 'same') return NO_OTHER;
        if (otherMemo && otherMemo.base === b.base && otherMemo.key === b.key) return otherMemo.other;
        const other = diffOther(b.base, DataManager.getData()) ?? NO_OTHER;
        otherMemo = { base: b.base, key: b.key, other };
        return other;
    },

    /** Rows "What will be sent" lists (people, and the rest: places and surname variants one each); null: not known. */
    researchChangesCount(): { persons: number; other: number } | null {
        const list = this.researchChangesNow();
        if (!list) return null;
        return { persons: list.length, other: otherRowCount(this.researchOtherNow()) };
    },

    /**
     * The tree as the research last had it — the copy kept since the last
     * load or written send, the base of the changes per person (and of a
     * conflict's "sending comes first"): 'same' while the open tree is in step
     * with it; null when not known (no copy kept, still loading — the sync UI
     * is refreshed once it is —, or the copy no longer stands for the tie's base).
     */
    researchChangesBase(): 'same' | { treeId: TreeId; base: StromData; key: string } | null {
        const ctx = this.researchSyncLink();
        if (!ctx) return null;
        const { treeId, link } = ctx;
        if (!copy || copy.treeId !== treeId) {
            if (loading !== treeId) {
                loading = treeId;
                const fp = storedFp(treeId);
                let prevFp = '';
                try { prevFp = localStorage.getItem(FP_PREV_KEY + treeId) ?? ''; } catch { /* not trusted */ }
                loadingDone = Promise.all([loadResearchCopy(treeId, fp), loadResearchPrevCopy(treeId, prevFp)]).then(([base, prev]) => {
                    if (loading !== treeId) return;
                    loading = null;
                    loadingDone = null;
                    copy = { treeId, base, fp };
                    prevCopy = prev && prevFp ? { treeId, base: prev, fp: prevFp } : null;
                    memo = null;
                    this.refreshResearchSyncUi();
                });
            }
            return null;
        }
        const fps = this.researchSyncFingerprints(treeId, link);
        // In step with the research: nothing to tell; a tree without a copy gets one now.
        if (fps.matchesBase) {
            if (!copy.base || copy.fp !== link.fingerprint) this.researchKeepCopy(treeId, DataManager.getData(), link.fingerprint);
            return 'same';
        }
        const written = link.sent?.state === 'written' ? link.sent.fingerprint : '';
        // The send that made the copy was taken back: the research stands where it was before it (R6 of the N1 round).
        const undone = link.sent?.state === 'undone' && copy.fp === link.sent.fingerprint && prevCopy?.treeId === treeId && prevCopy.base;
        const base = undone ? prevCopy!.base : copy.base;
        if (!undone && (!copy.base || !copy.fp || (copy.fp !== link.fingerprint && copy.fp !== written))) return null;
        if (!base) return null;
        return { treeId, base, key: `${undone ? 'u' : 'c'}:${fps.current}` };
    },

    /** As researchChangesNow, waiting for the copy to load when it is not yet. */
    async researchChangesReady(): Promise<PersonChange[] | null> {
        const now = this.researchChangesNow();
        if (now !== null || !loadingDone) return now;
        await loadingDone;
        return this.researchChangesNow();
    },

    /**
     * The research's version is not what the kept copy says: the titles never
     * went there (B18-1). The copy standing for one of `from` becomes
     * `change(copy)` standing for `to`, so the changes per person show what
     * the research lacks. A copy not read yet is read first.
     */
    async researchRetagCopy(treeId: TreeId, from: readonly string[], to: string, change: (data: StromData) => StromData): Promise<void> {
        if (copy?.treeId !== treeId && DataManager.getCurrentTreeId() === treeId) await this.researchChangesReady();
        if (copy?.treeId !== treeId || !copy.base || !copy.fp || !from.includes(copy.fp)) return;
        copy = { treeId, base: change(copy.base), fp: to };
        memo = null;
        try { localStorage.setItem(FP_KEY + treeId, to); } catch { /* not trusted next time */ }
        void saveResearchCopy(treeId, copy.base!, to);
    },

    /** A send is about to go: what it carries (for "What was written" once written). */
    researchNoteSending(treeId: TreeId, data: StromData, fingerprint: string): void {
        const list = DataManager.getCurrentTreeId() === treeId ? this.researchChangesNow() : null;
        const other = list ? sentOtherRows(this.researchOtherNow(), researchUnread(surnamesReadByResearch(treeId), lineageReadByResearch(treeId))) : [];
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        const stands = [link?.fingerprint ?? '', link?.sent?.state === 'written' ? link.sent.fingerprint : ''].filter(Boolean);
        pendingSent.set(treeId, { fingerprint, data: baseCopy(data), list, other, stands });
    },

    /**
     * The research wrote the send with this fingerprint and took nothing new
     * from it (N40): its version is still the kept copy, which now stands for
     * this send as well (`fp`: the send's fingerprint now, when it changed
     * since), so the changes per person stay listed against it. Taken back,
     * the research stands where it stood: the same copy again.
     */
    researchNoteTookNothing(treeId: TreeId, fingerprint: string, fp = fingerprint): void {
        const p = pendingSent.get(treeId);
        if (!p || p.fingerprint !== fingerprint) return;
        pendingSent.delete(treeId);
        const retag = (): void => {
            // Only a copy that stood for the research's version when the send went.
            if (copy?.treeId !== treeId || !copy.base || !copy.fp || copy.fp === fp || !p.stands.includes(copy.fp)) return;
            prevCopy = { treeId, base: copy.base, fp: copy.fp };
            copy = { treeId, base: copy.base, fp };
            memo = null;
            try {
                localStorage.setItem(FP_PREV_KEY + treeId, prevCopy.fp);
                localStorage.setItem(FP_KEY + treeId, fp);
            } catch { /* not trusted next time */ }
            void saveResearchPrevCopy(treeId, prevCopy.base!, prevCopy.fp);
            void saveResearchCopy(treeId, copy.base!, fp);
        };
        // The copy not read yet: read now, retagged once it is.
        if (copy?.treeId !== treeId && DataManager.getCurrentTreeId() === treeId) this.researchChangesNow();
        if (loading === treeId && loadingDone) {
            void loadingDone.then(() => { retag(); this.refreshResearchSyncUi(); });
        } else {
            retag();
        }
    },

    /**
     * The research wrote the send with this fingerprint: its data is the
     * research's version, its list what was written. `retagged`: the sent
     * state took the research's numbers since, so the copy is that state
     * under its fingerprint (the send's fingerprint now).
     */
    researchNoteWritten(treeId: TreeId, fingerprint: string, at: string, retagged?: { fingerprint: string; data: StromData }): void {
        const p = pendingSent.get(treeId);
        if (!p || p.fingerprint !== fingerprint) return;
        pendingSent.delete(treeId);
        // The copy it replaces: the research's version again if this send is taken back.
        if (copy?.treeId === treeId && copy.base && copy.fp) {
            prevCopy = { treeId, base: copy.base, fp: copy.fp };
            try { localStorage.setItem(FP_PREV_KEY + treeId, copy.fp); } catch { /* not trusted next time */ }
            void saveResearchPrevCopy(treeId, copy.base, copy.fp);
        }
        const base = retagged ? baseCopy(retagged.data) : p.data;
        const fp = retagged?.fingerprint ?? fingerprint;
        copy = { treeId, base, fp };
        memo = null;
        try { localStorage.setItem(FP_KEY + treeId, fp); } catch { /* not trusted next time */ }
        void saveResearchCopy(treeId, base, fp);
        if (p.list) storeWritten(treeId, at, p.list, p.other);
    },

    // ==================== THE PANEL ====================

    /** Open "What will be sent" / "What was written" under the toolbar's button (or the ⋯ button). */
    showResearchChanges(mode: 'send' | 'written', opts: { confirm?: boolean; inexact?: boolean } = {}): void {
        this.closeActionsMenu();
        this.closeResearchChanges();
        const ctx = this.researchSyncLink();
        if (!ctx) return;
        const c = strings.changes;
        const s = strings.sync;
        const clock = (iso: string | undefined): string => {
            const t = iso ? Date.parse(iso) : NaN;
            return Number.isFinite(t) ? formatLiveClock(t, Date.now(), getCurrentLanguage()) : '';
        };
        const auto = researchSendMode(ctx.link) === 'auto';
        const data = DataManager.getData();
        let list: PersonChange[];
        let title: string;
        let sub: string;
        let foot = '';
        let footPair = false;
        let notWrittenHtml = '';
        let writtenHead = '';
        let moreWritten = 0;
        let moreWrittenPeople = true;
        let writtenRows: string[] = [];
        let appOnlyRows: string[] = [];
        let other: OtherChanges | null = null;
        let inexact = false;
        if (mode === 'written') {
            this.researchNoteWrittenSeen(ctx.treeId);
            const w = researchWrittenList(ctx.treeId);
            const st = researchAutoState(ctx.treeId);
            const lw = st.lastWritten;
            list = w?.list ?? [];
            const sentOther = w?.other ?? [];
            title = c.writtenTitle(clock(w?.at ?? lw?.at));
            const k = lw?.changes ?? list.length;
            const conflicts = lw?.conflicts ?? 0;
            sub = conflicts ? `${s.changesN(k)} · ${s.conflictsN(conflicts)}` : s.changesN(k);
            // What the research does not read stays in the app: a quiet section of its own, never "written".
            const appOnly = sentOther.filter(r => r.appOnly);
            let written = sentOther.filter(r => !r.appOnly);
            // What the research did not write (its `applied`, not what went, V-J): first, amber, with its reason;
            // the people, sources and couples it named are not listed as written.
            const nw = st.notWritten && (st.notWritten.fingerprint === ctx.link.sent?.fingerprint || st.notWritten.fingerprint === lw?.fingerprint) ? st.notWritten : null;
            let quiet = false;
            // The archive still holds what this send did not write: its version can be loaded at once.
            let keptHere = false;
            if (nw) {
                if (!nw.seen) patchResearchAutoState(ctx.treeId, { notWritten: { ...nw, seen: true } });
                // A person this send removed here is paired by its number there: the window had it.
                const paired = pairNotWritten(nw.items, data, list);
                const named = new Set<string>();
                const items = paired.rows.map(row => {
                    const n = row.item;
                    const removed = row.type === 'person' && !!row.deleted;
                    const why = n.why === 'kept' ? (removed ? s.notWrittenKeptUndone : s.notWrittenKept)
                        : n.why === 'report' ? s.notWrittenReport : n.why === 'pick' ? s.notWrittenPick
                        : n.why === 'removed' ? s.notWrittenRemoved : c.noReason;
                    // Kept there, or removed there by another window: the research's version (without them) at once.
                    if (n.why === 'kept' || n.why === 'removed') keptHere = true;
                    let name: string;
                    let what = '';
                    let type = '';
                    if (row.type === 'person') {
                        const id = row.personId;
                        if (id) named.add(id);
                        const p = id ? data.persons[id] : undefined;
                        const who = p ? shownNameOrEmpty(p) : row.deleted?.name || n.name || n.person;
                        what = n.fact ? researchFactLabel(n.fact) : '';
                        name = id && p
                            ? `<button type="button" class="research-changes-name" data-person="${esc(id)}">${esc(who)}</button>`
                            : `<span class="research-changes-name">${esc(who || '?')}</span>`;
                    } else if (row.type === 'source') {
                        named.add(`source:${row.sourceId}`);
                        type = c.typeSource;
                        const sent = sentOther.find(r => r.type === 'source' && r.id === row.sourceId);
                        what = sent ? sourceKindsText(sent.kinds as SourceChangeKind[]) : '';
                        name = `<button type="button" class="research-changes-name" data-source="${esc(row.sourceId)}">${esc(row.title)}</button>`;
                    } else {
                        type = c.typePlaces;
                        name = `<span class="research-changes-name">${esc(row.place)}</span>`;
                    }
                    return `<li class="research-changes-row is-not-written" data-kind="${row.type}"><span class="research-changes-icon is-warn" aria-hidden="true">!</span>`
                        + `<span class="research-changes-text">${rowLine(name, type, false)}${what ? `<span class="research-changes-kinds">${esc(what)}</span>` : ''}`
                        + `<span class="research-changes-why">${esc(why)}</span></span></li>`;
                });
                const unnamed = nw.unexplained + paired.unnamed;
                if (unnamed > 0) {
                    items.push(`<li class="research-changes-row is-not-written"><span class="research-changes-icon is-warn" aria-hidden="true">!</span>`
                        + `<span class="research-changes-text"><span class="research-changes-name">${esc(c.unnamed(unnamed))}</span>`
                        + `<span class="research-changes-why">${esc(c.noReason)}</span></span></li>`);
                }
                const m = nw.items.length + nw.unexplained;
                notWrittenHtml = `<div class="research-changes-section is-warn">${esc(c.notWrittenSection(m))}</div><ul class="research-changes-list">${items.join('')}</ul>`;
                list = list.filter(ch => !named.has(ch.personId));
                written = written.filter(r => !(r.type === 'source' && named.has(`source:${r.id}`)));
                // Places named as not written leave the written summary (its count less those).
                const placesNot = paired.rows.filter(row => row.type === 'places').length;
                if (placesNot) {
                    written = written.flatMap(r => r.type !== 'places' ? [r]
                        : (r.count ?? 0) > placesNot ? [{ ...r, count: (r.count ?? 0) - placesNot }] : []);
                }
                writtenHead = c.writtenSection(nw.written);
                sub = s.writtenCount(nw.written, m);
                quiet = true;
                this.refreshResearchSyncUi();
            }
            writtenRows = [...list.map(ch => personRowOf(ch, 'written')), ...written.map(r => otherRowOf(r, 'written', data))];
            // Quiet rows after what was not written: the first three, then "and N more".
            if (quiet) {
                moreWritten = Math.max(0, writtenRows.length - 3);
                moreWrittenPeople = written.length === 0;
                writtenRows = writtenRows.slice(0, 3);
            }
            appOnlyRows = appOnly.map(r => otherRowOf(r, 'appOnly', data));
            // Conflicts the same in an archive as in a research: a fact changed in both copies is one (F40).
            if (conflicts && this.researchDecideUrl(ctx.treeId)) {
                foot = `<button type="button" class="research-sync-link" data-act="decide">${researchOpenLabel(s.decideInResearch)}</button>`;
            }
            if (keptHere) foot += `<button type="button" class="research-sync-link" data-act="loadNewer">${esc(s.loadVersion)}</button>`;
        } else {
            const now = this.researchChangesNow();
            other = now === null ? null : this.researchOtherNow();
            list = now ?? [];
            title = c.willSendTitle;
            // Changed since the research last had the tree: its version loaded, or the last send it wrote
            // (also when a later send is still on its way or was taken back).
            const lastSent = ctx.link.sent?.state === 'written' ? ctx.link.sent.closedAt ?? ctx.link.sent.at : '';
            const since = [lastSent, researchAutoState(ctx.treeId).lastWritten?.at ?? '', ctx.link.syncedAt]
                .filter(t => Number.isFinite(Date.parse(t))).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
            const o = otherRowCount(other);
            // No count when the exact list cannot be told: no base to compare with (a restore before loading, a send
            // taken back with no copy before it, the copy not read yet) — or, about to send, nothing it could
            // name although the tree is not where the research's version is ("0 people" would say nothing changed).
            inexact = previewInexact(now, other, opts);
            sub = inexact ? c.changedSince(clock(since)) : auto ? c.willSendAutoSub(list.length, o) : c.willSendSub(list.length, o, clock(since));
            footPair = !(auto && !opts.confirm);
            foot = auto && !opts.confirm
                ? `<button type="button" class="research-sync-link" data-act="send">${esc(s.sendNow)}</button>`
                : (opts.confirm && !ctx.link.previewDue
                    ? `<label class="research-changes-skip"><input type="checkbox" id="research-changes-skip"> ${esc(c.skipPreview)}</label>` : '')
                    + `<button type="button" class="secondary btn-sm" data-act="close">${esc(strings.buttons.close)}</button>`
                    + `<button type="button" class="primary btn-sm" data-act="send">${esc(s.barSend)}</button>`;
        }
        const personRow = (ch: PersonChange): string => personRowOf(ch, mode);
        // The sections of "What will be sent": the rows of each kind, a long one grouped ("+ N more" adds GROUP_STEP).
        const groups = new Map<string, { rows: (() => string)[]; shown: number }>();
        const section = (key: string, head: string, rows: (() => string)[]): string => {
            if (!rows.length) return '';
            const shown = rows.length <= GROUP_ALL ? rows.length : GROUP_HEAD;
            groups.set(key, { rows, shown });
            const rest = rows.length - shown;
            return (head ? `<div class="research-changes-section" data-section="${key}">${esc(head)}</div>` : '')
                + `<ul class="research-changes-list" data-group="${key}">${rows.slice(0, shown).map(r => r()).join('')}</ul>`
                + (rest > 0 ? `<button type="button" class="link-button research-changes-more-btn" data-more="${key}">${esc(c.more(rest))}</button>` : '');
        };
        let bodyHtml: string;
        if (mode === 'send') {
            const base = this.researchChangesBase();
            const baseData = base && base !== 'same' ? base.base : null;
            const sourceRows = (other?.sources ?? []).map(ch => (): string => {
                const linked = !ch.deleted && !ch.attachmentOnly && !!data.sources?.[ch.sourceId];
                const name = linked
                    ? `<button type="button" class="research-changes-name" data-source="${esc(ch.sourceId)}">${esc(ch.title)}</button>`
                    : `<span class="research-changes-name${ch.deleted ? ' is-deleted' : ''}">${esc(ch.title)}</span>`;
                const context = sourceContext(ch, data);
                return `<li class="research-changes-row" data-kind="source"><span class="research-changes-icon is-ring" aria-hidden="true"></span>`
                    + `<span class="research-changes-text">${rowLine(name, '', sourceAppOnly(ch.kinds))}<span class="research-changes-kinds">${esc(sourceKindsText(ch.kinds))}</span>`
                    + (context ? `<span class="research-changes-ctx">${esc(context)}</span>` : '') + '</span></li>';
            });
            const coupleRows = (other?.couples ?? []).map(ch => (): string => {
                const label = c.coupleName(rowPersonName(ch.p1, data, baseData), rowPersonName(ch.p2, data, baseData));
                const focus = coupleFocus(ch, data);
                const name = focus
                    ? `<button type="button" class="research-changes-name" data-couple="${esc(focus)}">${esc(label)}</button>`
                    : `<span class="research-changes-name${ch.deleted ? ' is-deleted' : ''}">${esc(label)}</span>`;
                return `<li class="research-changes-row" data-kind="couple"><span class="research-changes-icon is-ring" aria-hidden="true"></span>`
                    + `<span class="research-changes-text">${rowLine(name, '', coupleAppOnly(ch.kinds))}<span class="research-changes-kinds">${esc(coupleKindsText(ch.kinds))}</span></span></li>`;
            });
            const places = other?.places?.count ? other.places : null;
            const variants = other?.surnameVariants?.count ? other.surnameVariants : null;
            const placesRow = places ? [(): string => summaryRow('places', esc(c.placesRow(places.count)), '', c.showPlaces, placesAppOnly(places.items))] : [];
            const variantsRow = variants ? [(): string => {
                const added = variants.items.filter(v => !v.removed).length;
                const removed = variants.items.length - added;
                const label = [added ? c.variantsRow(added) : '', removed ? c.variantsRemovedRow(removed) : ''].filter(Boolean).join(' · ');
                const surnames = new Set(variants.items.map(v => v.surname));
                const of = surnames.size === 1 ? c.variantsOf([...surnames][0]) : c.variantsOfN(surnames.size);
                return summaryRow('variants', esc(label), of, c.show, variantsAppOnly(researchUnread(surnamesReadByResearch())));
            }] : [];
            // Lineage corrections: one row per person (a founder set or taken back).
            const lineageRows = (other?.lineage?.items ?? []).map(ch => (): string => {
                const name = data.persons[ch.personId]
                    ? `<button type="button" class="research-changes-name" data-person="${esc(ch.personId)}">${esc(ch.name)}</button>`
                    : `<span class="research-changes-name is-deleted">${esc(ch.name)}</span>`;
                const kind = ch.now === 'founder' ? c.lineageFounder : ch.now === 'notCarrier' ? c.lineageNotCarrier : c.lineageCleared;
                return `<li class="research-changes-row" data-kind="lineage"><span class="research-changes-icon is-ring" aria-hidden="true"></span>`
                    + `<span class="research-changes-text">${rowLine(name, '', lineageAppOnly(researchUnread(surnamesReadByResearch(), lineageReadByResearch())))}`
                    + `<span class="research-changes-kinds">${esc(kind)}</span></span></li>`;
            });
            const others = sourceRows.length + coupleRows.length + placesRow.length + variantsRow.length + lineageRows.length;
            bodyHtml = (inexact ? `<p class="research-changes-inexact">${esc(c.inexact)}</p>` : '')
                + section('persons', others ? c.sectionPersons(list.length) : '', list.map(ch => () => personRow(ch)))
                + section('sources', c.sectionSources(sourceRows.length), sourceRows)
                + section('couples', c.sectionCouples(coupleRows.length), coupleRows)
                + section('places', places ? c.sectionPlaces(places.count) : '', placesRow)
                + section('variants', variants ? c.sectionVariants(variants.count) : '', variantsRow)
                + section('lineage', lineageRows.length ? c.sectionLineage(lineageRows.length) : '', lineageRows);
        } else {
            const rows = writtenRows.join('');
            bodyHtml = notWrittenHtml
                + (writtenHead && (rows || moreWritten) ? `<div class="research-changes-section">${esc(writtenHead)}</div>` : '')
                + (rows ? `<ul class="research-changes-list${writtenHead ? ' is-quiet' : ''}">${rows}</ul>` : '')
                + (moreWritten ? `<div class="research-changes-more">${esc(moreWrittenPeople ? c.andMore(moreWritten) : c.more(moreWritten))}</div>` : '')
                // What the research does not read: quiet, under what was written.
                + (appOnlyRows.length ? `<div class="research-changes-section" data-section="appOnly">${esc(c.appOnlySection(appOnlyRows.length))}</div>`
                    + `<ul class="research-changes-list is-quiet" data-group="appOnly">${appOnlyRows.join('')}</ul>` : '');
        }
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.className = 'research-changes-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', title);
        panel.dataset.mode = mode;
        panel.innerHTML = `
            <div class="research-changes-head">
                <div class="research-changes-title">${esc(title)}</div>
                <div class="research-changes-sub">${esc(sub)}</div>
            </div>
            <div class="research-changes-body">${bodyHtml}</div>
            ${foot ? `<div class="research-changes-foot${footPair ? ' is-pair' : ''}">${foot}</div>` : ''}`;
        document.body.appendChild(panel);
        this.positionResearchChanges();
        // The expanded list of places / surname variants: its first DETAIL_HEAD, then "+ N more" adds GROUP_STEP.
        const detailShown = new Map<string, number>();
        const detailItems = (key: string): { a: string; b: string; removed?: boolean }[] => key === 'places'
            ? (other?.places?.items ?? []).map(p => ({ a: p.name, b: coordText(p) }))
            : (other?.surnameVariants?.items ?? []).map((v: VariantChange) => ({ a: v.surname, b: v.variant, removed: v.removed }));
        const renderDetail = (key: string, ul: HTMLElement): void => {
            const items = detailItems(key);
            const shown = Math.min(items.length, detailShown.get(key) ?? DETAIL_HEAD);
            detailShown.set(key, shown);
            const rest = items.length - shown;
            ul.innerHTML = items.slice(0, shown).map(it => `<li class="research-changes-detail-row"><span>${esc(it.a)}</span>`
                + `<span class="research-changes-detail-value${it.removed ? ' is-removed' : ''}">${esc(it.b)}</span></li>`).join('')
                + (rest > 0 ? `<li><button type="button" class="link-button research-changes-more-btn" data-detail-more="${key}">${esc(c.more(rest))}</button></li>` : '');
        };
        panel.addEventListener('click', (e) => {
            const btn = (e.target as Element | null)?.closest<HTMLButtonElement>('button');
            if (!btn || !panel.contains(btn)) return;
            const d = btn.dataset;
            if (d.person || d.couple) {
                // A person or a couple: the tree centred on it (a couple on its first partner), the panel closed.
                const id = (d.person ?? d.couple) as PersonId;
                this.closeResearchChanges();
                TreeRenderer.setFocus(id);
                ZoomPan.centerOnPerson(id);
            } else if (d.source) {
                // A source: its viewer over the panel, which stays; focus back on the row once the viewer closes.
                this.showSourceViewer(d.source, null);
                returnFocusAfterViewer(btn);
            } else if (d.more) {
                const g = groups.get(d.more);
                const ul = panel.querySelector<HTMLElement>(`ul[data-group="${d.more}"]`);
                if (!g || !ul) return;
                const next = Math.min(g.rows.length, g.shown + GROUP_STEP);
                ul.insertAdjacentHTML('beforeend', g.rows.slice(g.shown, next).map(r => r()).join(''));
                g.shown = next;
                const rest = g.rows.length - next;
                if (rest > 0) btn.textContent = c.more(rest);
                else {
                    // The next row takes the focus the button had.
                    (ul.lastElementChild?.querySelector<HTMLElement>('button') ?? ul.lastElementChild as HTMLElement | null)?.focus?.();
                    btn.remove();
                }
            } else if (d.toggle) {
                const ul = panel.querySelector<HTMLElement>(`#research-changes-detail-${d.toggle}`);
                if (!ul) return;
                const open = btn.getAttribute('aria-expanded') !== 'true';
                if (open && !ul.childElementCount) renderDetail(d.toggle, ul);
                ul.hidden = !open;
                btn.setAttribute('aria-expanded', String(open));
                btn.textContent = d.toggle === 'places' ? (open ? c.hidePlaces : c.showPlaces) : (open ? c.hide : c.show);
            } else if (d.detailMore) {
                const ul = panel.querySelector<HTMLElement>(`#research-changes-detail-${d.detailMore}`);
                if (!ul) return;
                const before = detailShown.get(d.detailMore) ?? DETAIL_HEAD;
                detailShown.set(d.detailMore, before + GROUP_STEP);
                renderDetail(d.detailMore, ul);
                (ul.children[before]?.querySelector<HTMLElement>('button') ?? ul.querySelector<HTMLElement>('[data-detail-more]'))?.focus?.();
            }
        });
        panel.querySelector('[data-act="close"]')?.addEventListener('click', () => this.closeResearchChanges());
        panel.querySelector<HTMLButtonElement>('[data-act="send"]')?.addEventListener('click', (e) => {
            const btn = e.currentTarget as HTMLButtonElement;
            if (panel.querySelector<HTMLInputElement>('#research-changes-skip')?.checked) noteResearchSendPreviewSkipped(ctx.treeId, true);
            // Seen what goes: Send here sends ("Sending…" until the research answers, then the toast tells).
            if (btn.classList.contains('primary')) {
                btn.disabled = true;
                btn.textContent = s.sending;
                panel.querySelectorAll<HTMLInputElement>('input, [data-act="close"]').forEach(el => { el.disabled = true; });
                void this.researchSendNow({ previewed: true }).finally(() => {
                    if (document.getElementById(PANEL_ID) === panel) this.closeResearchChanges();
                });
                return;
            }
            this.closeResearchChanges();
            void this.researchSendNow({ previewed: true });
        });
        panel.querySelector('[data-act="loadNewer"]')?.addEventListener('click', () => {
            this.closeResearchChanges();
            void this.researchLoadNewer();
        });
        panel.querySelector('[data-act="decide"]')?.addEventListener('click', () => {
            this.closeResearchChanges();
            this.researchSyncAction('decideInResearch');
        });
        document.getElementById('research-sync-send-more')?.setAttribute('aria-expanded', 'true');
        // Esc closes it from the start: a key pressed before a timer ran (input goes first on a busy
        // page) was lost and the panel stayed. A click outside closes it once the opening click is over.
        document.addEventListener('keydown', closeOnEsc, true);
        setTimeout(() => {
            if (document.getElementById(PANEL_ID) === panel) document.addEventListener('pointerdown', closeOnOutside, true);
        }, 0);
        (panel.querySelector<HTMLElement>('button') ?? panel).focus?.();
    },

    /**
     * Under the "N ⌄" part of the Send button when shown, else under the Send button, the amber pill's
     * button, the research's mark or the pill (where the research is in the toolbar, R6 of the N1 round
     * and of beta.56), else under ⋯; within the window. Only a control with a box counts (a hidden ⋯
     * below 1025px has none): with no such control the panel opens at the right, under the toolbar.
     * It never covers the toolbar, whatever its anchor.
     */
    positionResearchChanges(): void {
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;
        const boxed = (el: HTMLElement | null): HTMLElement | null => {
            if (!el || !el.offsetParent) return null;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 ? el : null;
        };
        const shown = (id: string): HTMLElement | null => boxed(document.getElementById(id));
        const anchor = shown('research-sync-send-more') ?? shown('research-sync-send')
            ?? boxed(document.querySelector<HTMLElement>('#research-sync-pill .research-sync-pill-send'))
            ?? shown('research-sync-mark') ?? shown('research-sync-pill')
            ?? boxed(document.querySelector<HTMLElement>('.actions-menu-btn'));
        const rect = anchor?.getBoundingClientRect();
        const width = Math.min(panel.offsetWidth || 360, window.innerWidth - 16);
        const right = window.innerWidth - width - 8;
        const left = rect ? Math.max(8, Math.min(rect.right - width, right)) : Math.max(8, right);
        const toolbar = document.querySelector<HTMLElement>('.toolbar')?.getBoundingClientRect();
        const toolbarBottom = toolbar && toolbar.height > 0 ? toolbar.bottom : 56;
        const top = Math.round(Math.max(rect?.bottom ?? 0, toolbarBottom) + 6);
        panel.style.top = `${top}px`;
        panel.style.left = `${Math.round(left)}px`;
        // At most the window less 72px, and never past its bottom edge: the list between head and foot scrolls.
        // An Undo pill under the panel is a floor too, so Close / Send stay clickable above it.
        let floor = window.innerHeight - 8;
        // The current pill: one still fading out (a second change right after the first) is about to go,
        // and being narrower it could miss the panel while the new one covers Send.
        const pill = this.undoToastEl ?? null;
        const pillRect = pill?.isConnected ? pill.getBoundingClientRect() : undefined;
        if (pillRect && pillRect.width && pillRect.left < left + width && pillRect.right > left) {
            // The pill rises 12px as it shows and sinks as it goes: its resting top is the box less the lift
            // still to come, read from the running transform (the show class is set before the rise ends).
            const t = getComputedStyle(pill!).transform;
            const lift = t && t !== 'none' ? new DOMMatrix(t).m42 : 0;
            const restTop = pillRect.top - lift;
            floor = Math.min(floor, Math.floor(restTop) - 8);
        }
        panel.style.maxHeight = `${Math.max(160, Math.min(window.innerHeight - 72, floor - top))}px`;
    },

    closeResearchChanges(): void {
        document.getElementById(PANEL_ID)?.remove();
        document.getElementById('research-sync-send-more')?.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', closeOnOutside, true);
        document.removeEventListener('keydown', closeOnEsc, true);
    },

    /**
     * The send button's second part "N ⌄". Its place is always kept (an
     * invisible one when the people are not known or `reserve`), so the
     * toolbar does not move when it comes.
     */
    researchSendMoreHtml(reserve = false): string {
        const n = reserve ? null : this.researchChangesCount();
        const total = n ? n.persons + n.other : 0;
        if (!n || total === 0) {
            return '<span class="research-sync-send-more research-sync-send-more--placeholder" aria-hidden="true">0 <span>⌄</span></span>';
        }
        const open = !!document.getElementById(PANEL_ID);
        return `<button type="button" class="research-sync-send-more" id="research-sync-send-more" aria-haspopup="dialog" aria-expanded="${open}"`
            + ` aria-label="${esc(strings.changes.showWhat(n.persons, n.other))}" onclick="event.stopPropagation(); window.Strom.UI.toggleResearchChanges()">`
            + `${total > 99 ? '99+' : total} <span aria-hidden="true">⌄</span></button>`;
    },

    toggleResearchChanges(): void {
        if (document.getElementById(PANEL_ID)) this.closeResearchChanges();
        else this.showResearchChanges('send');
    },

    /** The names for the "load over your changes" dialog: at most five, then "and N more" ('' when not known). */
    async researchOverwriteNames(): Promise<string> {
        const list = await this.researchChangesReady();
        if (!list || list.length === 0) return '';
        const c = strings.changes;
        const lines = list.slice(0, 5).map(ch => `• ${ch.name} (${changeKindsText(ch.kinds)})`);
        if (list.length > 5) lines.push(c.andMore(list.length - 5));
        return `${c.overwriteIntro}\n${lines.join('\n')}`;
    },
});

function closeOnOutside(e: Event): void {
    const panel = document.getElementById(PANEL_ID);
    const target = e.target as Node | null;
    if (!panel || (target && (panel.contains(target) || document.getElementById('research-sync-send-more')?.contains(target)))) return;
    // A dialog over the panel (a source's viewer opened from a row): its clicks are its own, the panel stays.
    if (target instanceof Element && target.closest('.modal-overlay.active')) return;
    window.Strom?.UI?.closeResearchChanges();
}

function closeOnEsc(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !document.getElementById(PANEL_ID)) return;
    // A dialog over the panel (a source's viewer opened from a row) closes first, the panel stays.
    if (document.querySelector('.modal-overlay.active')) return;
    e.stopPropagation();
    e.preventDefault();
    window.Strom?.UI?.closeResearchChanges();
}
