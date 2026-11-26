/**
 * "Give a family tree" (spec 093 §2, §4, §9): the guide's window. A page-sized
 * dialog (#gift-modal, `.modal--page`) with the six steps as side tabs and the
 * summary under them, the steps' panes on the right and Back / Next under
 * them. On a phone (and a phone held sideways) the whole screen: the steps
 * one at a time, the subtitle a button that opens the list of steps as a
 * bottom sheet. The state lives in src/gift-guide.ts (no DOM); this file draws
 * it and changes it. × and Escape make nothing and remember the settings.
 */

import type { Person, PersonId, StromData, TreeId } from '../types.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { SettingsManager } from '../settings.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { shownName } from '../person-name.js';
import { personInitials } from '../initials.js';
import { yearOf } from '../dates.js';
import { filterAndSort } from '../person-picker.js';
import { MQ_PHONE_BAR } from '../breakpoints.js';
import { formatTreeSize } from '../format.js';
import { iconSvg } from '../icons.js';
import { inferBirthUpperBounds, isLivingPerson, type PrivacyMode } from '../privacy.js';
import { giftPersonKey, loadGiftMemory } from '../gift-memory.js';
import {
    buildGiftBatch, buildGiftPackage, estimateGiftSize, GiftOutOfMemory, giftBatchFileName, giftFileNames, giftNamesLabel, giftStepsFor, isAbortError,
    type GiftPackageEnv, type GiftPackageResult, type GiftPartKey, type GiftProgress, type GiftSizeEstimate, type GiftStep,
} from '../gift-package.js';
import { buildGiftCover, giftDefaultSalutation, giftFacts } from '../gift-cover.js';
import { AppExporter } from '../export.js';
import { appFontFaceCss, POSTER_LINE_FACES, POSTER_SERIF_FACES } from '../poster-fonts.js';
import { bookItalicFontCss } from '../book-font.js';
import { bookOptionsFromMemory, loadBookMemory, pagesChoicesFromMemory } from '../book-memory.js';
import {
    GIFT_DEFAULT_DEPTH, GIFT_DEPTHS, giftBranchCandidates, giftCutData, giftCutIds, giftDepthCounts,
    type GiftBranch, type GiftCut, type GiftDepth, type GiftLang, type GiftLetter, type GiftSettings,
} from '../gift-tree.js';
import { ancestorGenerations, descentParentIds } from '../lineage.js';
import { findRelationship } from '../kinship.js';
import { giftBranchAdds, giftPreviewModel, type GiftPreviewModel, type GiftPreviewStub } from '../gift-preview-model.js';
import { giftPreviewCentreOn, renderGiftPreview, type GiftPreviewView } from './gift-preview.js';
import {
    GIFT_GUIDE_STEPS, giftCanProceed, giftDepthIndex, giftFullSet, giftGoTo, giftGuideStart, giftHasFamily,
    giftCoverPreviewHtml, giftIsoDate, giftLivingModel, giftRecipients, giftRemember, giftResolvedLetter, giftResolvedSettings,
    giftSuggestedPartner, giftSummary, giftToggleFull,
    type GiftLivingModel, type GiftMode, type GiftState, type GiftSummary,
} from '../gift-guide.js';
import { uiModule } from './module.js';
import { MODAL_BACK_CHEVRON } from './modal-back.js';
import { openPersonPopover } from './person-popover.js';
import { confirmMemoryForOutput } from './memory-limit-ui.js';
import { barEl } from './prog-bar.js';
import { spinEl } from './busy.js';
import { svgToPngBlob } from './svg-png.js';
import { fanPhotoPortrait } from './fan-view.js';
import { selectionPersonIds, type SelectionRef } from '../view-selection.js';
import { selectionIndex, selectionText } from './view-selection-ui.js';
import { listDisplayName, listKind } from '../person-lists.js';
import { listKindIcon } from './list-kind-icon.js';
import {
    giftBatchActive, giftBatchDefaultSalutation, giftBatchRows, giftBatchRowSettings, giftBatchSalutation, giftOwnDiff, giftOwnParts,
    type GiftOwnSettings, type GiftRecipientRow,
} from '../gift-batch.js';

export const GIFT_MODAL_ID = 'gift-modal';

/** From this many living people step 3 offers a search over its list (§4 [24]). */
export const GIFT_LIVING_SEARCH_FROM = 50;

/** From this many people step 2 leads with the package's size and the preview is a scaled-down overview (§3 [21]). */
export const GIFT_CUT_LARGE_FROM = 600;

/** How the guide is opened: a person (or a couple), the mode, a list (B4), the first step. */
export interface GiftTreeOpenOptions {
    personId?: PersonId;
    recipients?: PersonId[];
    mode?: GiftMode;
    listId?: string;
    /** The window's selection (098) as the list of recipients. */
    selection?: SelectionRef;
    step?: number;
}

interface GiftUi {
    g: GiftState;
    data: StromData;
    /** The person in focus when the guide opened ("person in focus" under the name). */
    focusId: PersonId | null;
    listId?: string;
    /** Step 3's search over the living. */
    query: string;
    /** A tap on the greyed "list" choice on a phone: the sentence why under the choices. */
    listWhy: boolean;
    closePicker: (() => void) | null;
    summaryKey: string;
    summary: GiftSummary | null;
    livingKey: string;
    living: GiftLivingModel | null;
    mq: MediaQueryList | null;
    onMq: (() => void) | null;
    /** Step 2 on a phone: the full preview with the branches (its own screen, "… › Branches"). */
    branchesScreen: boolean;
    /** Step 2's preview: where it looks (kept over changes of the cut), for which recipients and box. */
    view: GiftPreviewView | null;
    viewKey: string;
    /** The ancestors' stubs unfolded by a click. */
    expanded: Set<string>;
    /** Step 2's numbers for the cut now (computed again only when the cut changes). */
    cutInfo: GiftCutInfo | null;
    /** The branches' relation words, for these recipients. */
    relKey: string;
    rel: Map<PersonId, { kin: string; path: string }>;
    /** The preview's window listeners (its menu). */
    dropPreview: (() => void) | null;
    /** The package being made, or the end of the last making (§8); null: the steps. */
    run: GiftRun | null;
    /** "Create another": the settings carried to the next person when they have none of their own. */
    carry: GiftSettings | null;
    /** The cover page's preview for these settings. */
    coverKey: string;
    coverHtml: string;
    /** Step 4's estimates for these settings. */
    estKey: string;
    est: { now: GiftSizeEstimate; all: GiftSizeEstimate } | null;
    /** Step 5's typing: the cover page's preview drawn again a moment later. */
    letterTimer: number;
    /** A list or the selection (§7 [53]): its recipients' rows; null for a person or a couple. */
    batch: GiftBatchUi | null;
}

/** Where a batch's recipients come from: a list of people or the window's selection (098). */
type GiftBatchSource = { kind: 'list'; listId: string } | { kind: 'selection'; ref: SelectionRef };

interface GiftBatchUi {
    source: GiftBatchSource | null;
    /** The selection the guide was opened with (offered beside the lists). */
    selection: SelectionRef | null;
    /** "Spouses and partners as one package". */
    pairs: boolean;
    rows: GiftRecipientRow[];
    removed: Set<string>;
    own: Map<string, GiftOwnSettings>;
    salutations: Map<string, string>;
    /** The row steps 2–5 show (step 5's ‹ name ›). */
    preview: string | null;
    /** The row edited on its own (§7 [54]) and the common settings meanwhile. */
    edit: string | null;
    common: GiftSettings | null;
    /** Each row's numbers for the settings now (computed again only when they change). */
    statsKey: string;
    stats: Map<string, GiftSummary>;
    /** The outer archive's name typed in step 6. */
    fileName?: string;
}

interface GiftCutInfo {
    key: string;
    ids: Set<PersonId>;
    branches: GiftBranch[];
    counts: Record<GiftDepth, number>;
    noAncestors: boolean;
    model: GiftPreviewModel | null;
    modelKey: string;
    /** The size with photos (only for a large cut). */
    withPhotos: number | null;
}

let ui: GiftUi | null = null;

/** The cover page's own window over the guide ("Open in a window", "Open the cover page"). */
export const GIFT_COVER_ID = 'gift-cover-modal';

/** The making of one package (§8): its phase, the progress, the finished file. */
interface GiftRun {
    phase: 'making' | 'cancelled' | 'done' | 'nodownload' | 'oom' | 'failed';
    ctrl: AbortController | null;
    steps: GiftStep[];
    progress: GiftProgress | null;
    /** The steps finished, with the bytes each added to the archive. */
    sizes: Map<GiftStep, number>;
    persons: number;
    result: GiftPackageResult | null;
    /** The cover page the package wrote ("Open the cover page"). */
    coverHtml: string;
    names: string;
    couple: boolean;
    oomPart?: GiftStep;
    error?: string;
    /** The progress drawing waiting for the next frame. */
    frame: number;
}

/** Save a Blob as a file (an `<a download>`; the URL let go once the browser has it). */
function downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The system's share sheet takes a ZIP file (a phone's "Share…"). */
function canShareZip(): boolean {
    try {
        return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
            && !!navigator.canShare?.({ files: [new File([''], 'x.zip', { type: 'application/zip' })] });
    } catch {
        return false;
    }
}

function bookStorage(): Storage | null {
    try { return window.localStorage; } catch { return null; }
}

/** What the making needs from the app: the app's file, PNG drawing, fonts, the book's and pages' remembered choices, the fan's look. */
function giftPackageEnv(treeId: TreeId | null, settings: GiftSettings, onCover: (html: string) => void): GiftPackageEnv {
    const memory = loadBookMemory(bookStorage(), treeId);
    const book = bookOptionsFromMemory(settings.letter.lang, memory, { kind: 'tree' });
    const colorMode = TreeRenderer.getFanColorMode();
    const lineFonts = appFontFaceCss([...POSTER_SERIF_FACES, ...POSTER_LINE_FACES]);
    return {
        app: (data, o) => AppExporter.buildFocusAppBlob(data, { ...o, ...(treeId ? { trackTreeId: treeId } : {}) }),
        png: svgToPngBlob,
        fonts: { pages: lineFonts, book: appFontFaceCss(POSTER_SERIF_FACES) + bookItalicFontCss(), fan: lineFonts },
        book,
        pages: pagesChoicesFromMemory(memory),
        fan: {
            look: TreeRenderer.getFanLook(),
            colorMode: colorMode === 'rod' ? 'gender' : colorMode,
            portrait: (p) => fanPhotoPortrait(p, false),
        },
        cover: (data, info) => {
            const html = buildGiftCover(data, info);
            onCover(html);
            return html;
        },
    };
}

/** The archive's default name for the guide's recipients (the letter's language, this year). */
function defaultZipName(u: GiftUi): string {
    const people = giftRecipients(u.g).map(id => ({ id, name: shownName(u.data.persons[id]) || '?' }));
    return giftFileNames(u.g.settings.letter.lang, people, new Date().getFullYear()).zip;
}

/** Step 4's estimates: the package as chosen, and every part's size as if it were in (cached by the settings). */
function estimatesOf(u: GiftUi): { now: GiftSizeEstimate; all: GiftSizeEstimate } {
    const key = JSON.stringify([cutKey(u.g)]);
    if (!u.est || u.estKey !== key) {
        const now = new Date();
        const s = u.g.settings;
        u.est = {
            now: estimateGiftSize(u.data, s, { now }),
            all: estimateGiftSize(u.data, { ...s, photos: s.photos, parts: { app: true, pages: true, book: true, fan: true, gedcom: true } }, { now }),
        };
        u.estKey = key;
    }
    return u.est;
}

/** A segment of two to four choices (role radiogroup; arrows move the choice), each with a quiet line under it. */
function giftSegment(
    label: string, key: string, options: Array<{ key: string; label: string; sub?: string; on: boolean }>, pick: (key: string) => void,
): HTMLElement {
    const seg = el('div', `sel-seg gift-seg gift-seg-${key}`);
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', label);
    options.forEach(o => {
        const b = el('button', 'sel-opt gift-seg-o');
        b.type = 'button';
        b.dataset.selForm = 'seg';
        b.dataset.gk = `${key}-${o.key}`;
        b.dataset.opt = o.key;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(o.on));
        b.tabIndex = o.on ? 0 : -1;
        b.appendChild(el('span', 'gift-seg-l', o.label));
        if (o.sub) b.appendChild(el('span', 'gift-seg-n', o.sub));
        b.addEventListener('click', () => { if (!o.on) pick(o.key); });
        seg.appendChild(b);
    });
    seg.addEventListener('keydown', (e) => {
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const i = options.findIndex(o => o.on);
        const next = options[(i + step + options.length) % options.length];
        pick(next.key);
        document.querySelector<HTMLElement>(`#${GIFT_MODAL_ID} [data-gk="${key}-${next.key}"]`)?.focus({ preventScroll: true });
    });
    return seg;
}

/**
 * "Create another" (§8): the last package's choices for a person without
 * their own — the depth, the protection, the parts, photos and the letter's
 * language, motif and date; the branches, the exceptions, the message (the
 * template again) and the file's name are the new person's.
 */
function giftCarried(data: StromData, fresh: GiftSettings, carry: GiftSettings): GiftSettings {
    const lang = carry.letter.lang;
    const persons = fresh.cut.recipients.map(id => data.persons[id]).filter((p): p is Person => !!p);
    const salutation = lang === fresh.letter.lang || !persons.length
        ? fresh.letter.salutation
        : giftDefaultSalutation(persons.length === 1 ? persons[0] : persons, lang);
    return {
        cut: { ...fresh.cut, depth: carry.cut.depth },
        privacy: { ...carry.privacy, fullIds: [] },
        parts: { ...carry.parts },
        photos: carry.photos,
        letter: { ...fresh.letter, lang, motif: carry.letter.motif, date: carry.letter.date, salutation, message: '' },
    };
}

function lang(): GiftLang {
    return getCurrentLanguage() as GiftLang;
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', className, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
}

function isPhone(): boolean {
    return typeof matchMedia === 'function' && matchMedia(MQ_PHONE_BAR).matches;
}

/** A day as the language writes it ("24. 12. 2026", "12/24/2026"). */
export function giftDateLabel(iso: string, language: GiftLang = lang()): string {
    const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'numeric', year: 'numeric' }).format(d);
}

/** Whether the person menu offers "Give a family tree…": the person has parents, a partner or children (§1). */
export function canGiftTree(personId: PersonId): boolean {
    return giftHasFamily(DataManager.getData(), personId);
}

/** The person menu's quiet date: the day the last package for this person was made (§9 [66]), else undefined. */
export function giftMenuMeta(personId: PersonId): string | undefined {
    const memory = loadGiftMemory(TreeManager.getActiveTreeId(), giftPersonKey([personId]));
    return memory?.madeAt ? giftDateLabel(memory.madeAt) : undefined;
}

/** "1941–2015", "* 1972", "† 1990" or ''. */
function yearsOf(p: Person): string {
    const b = yearOf(p.birthDate), d = yearOf(p.deathDate);
    if (b !== null && d !== null) return `${b}–${d}`;
    if (b !== null) return `* ${b}`;
    if (d !== null) return `† ${d}`;
    return '';
}

function realPerson(data: StromData, id: PersonId | null | undefined): Person | null {
    const p = id ? data.persons[id] : undefined;
    return p && !p.isPlaceholder ? p : null;
}

/** The settings the summary and step 3 depend on, as a key (computed again only when it changes). */
function cutKey(g: GiftState): string {
    const s = g.settings;
    return JSON.stringify([s.cut, s.privacy, s.parts, s.photos]);
}

function summaryOf(u: GiftUi): GiftSummary {
    const key = cutKey(u.g);
    if (!u.summary || u.summaryKey !== key) {
        u.summary = giftSummary(u.data, u.g.settings, new Date());
        u.summaryKey = key;
    }
    return u.summary;
}

function livingOf(u: GiftUi): GiftLivingModel {
    const s = u.g.settings;
    const key = JSON.stringify([s.cut, s.privacy.others]);
    if (!u.living || u.livingKey !== key) {
        u.living = giftLivingModel(u.data, s, lang(), new Date().getFullYear(), p => shownName(p) || '?');
        u.livingKey = key;
    }
    return u.living;
}

/** The active tree's lists with people, by name (the batch's source field). */
function batchLists(): Array<{ id: string; name: string; count: number; icon: string }> {
    return DataManager.getPersonLists()
        .map(list => ({ id: list.id, name: listDisplayName(list), count: DataManager.getPersonListIds(list.id).length, icon: listKindIcon(listKind(list), 16) }))
        .filter(l => l.count > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
}

function batchSourceIds(src: GiftBatchSource | null): PersonId[] {
    if (!src) return [];
    if (src.kind === 'list') return DataManager.getPersonListIds(src.listId);
    return [...(selectionPersonIds(DataManager.getData(), selectionIndex().index, src.ref) ?? [])];
}

function batchSourceLabel(src: GiftBatchSource | null): string {
    if (!src) return '';
    if (src.kind === 'selection') return selectionText(src.ref);
    const list = DataManager.getPersonList(src.listId);
    return list ? listDisplayName(list) : '';
}

function batchNew(data: StromData, source: GiftBatchSource | null, selection: SelectionRef | null): GiftBatchUi {
    const b: GiftBatchUi = {
        source, selection, pairs: true, rows: giftBatchRows(data, batchSourceIds(source), true),
        removed: new Set(), own: new Map(), salutations: new Map(), preview: null, edit: null, common: null, statsKey: '', stats: new Map(),
    };
    b.preview = giftBatchActive(b)[0]?.key ?? null;
    return b;
}

function batchRow(b: GiftBatchUi, key: string | null): GiftRecipientRow | null {
    return key ? b.rows.find(r => r.key === key) ?? null : null;
}

/** The common settings: the guide's own, or the ones put aside while a row is edited. */
function batchCommon(u: GiftUi): GiftSettings {
    return u.batch?.common ?? u.g.settings;
}

/** A row's names: "Daniel Berg", "Eva Berg and Jonas Holm". */
function batchRowName(u: GiftUi, row: GiftRecipientRow): string {
    return giftNamesLabel(lang(), row.recipients.map(id => realPerson(u.data, id)).filter((p): p is Person => !!p).map(p => shownName(p) || '?'));
}

/** Steps 2–5 show the preview row: its recipients and its salutation over the common settings. */
function batchShow(u: GiftUi): void {
    const b = u.batch;
    if (!b || b.edit) return;
    const active = giftBatchActive(b);
    if (!active.some(r => r.key === b.preview)) b.preview = active[0]?.key ?? null;
    const row = batchRow(b, b.preview);
    const s = u.g.settings;
    const recipients = row ? [...row.recipients] : [];
    u.g.recipients = recipients.length ? recipients : [null];
    s.cut = { ...s.cut, recipients };
    if (row) s.letter = { ...s.letter, salutation: giftBatchSalutation(u.data, b, s, row) };
}

/** Each row's people, generations, living and size for its own settings over the common ones. */
function batchStats(u: GiftUi): Map<string, GiftSummary> {
    const b = u.batch!;
    const common = batchCommon(u);
    const key = JSON.stringify([common.cut.depth, common.cut.branches, common.privacy, common.parts, common.photos, [...b.own], b.rows.map(r => r.key)]);
    if (b.statsKey !== key) {
        const now = new Date();
        b.stats = new Map(b.rows.filter(r => !r.lone).map(r => [r.key, giftSummary(u.data, giftBatchRowSettings(u.data, b, common, r), now)]));
        b.statsKey = key;
    }
    return b.stats;
}

/** The batch's totals: packages, recipients, couples, the living and the outer ZIP's size. */
function batchTotals(u: GiftUi): { packages: number; recipients: number; couples: number; living: number; bytes: number } {
    const b = u.batch!;
    const stats = batchStats(u);
    const active = giftBatchActive(b);
    let living = 0;
    let bytes = 0;
    for (const r of active) {
        const st = stats.get(r.key);
        if (st) { living += st.living; bytes += st.bytes; }
    }
    return {
        packages: active.length, recipients: active.reduce((n, r) => n + r.recipients.length, 0),
        couples: active.filter(r => r.recipients.length === 2).length, living, bytes,
    };
}

/** The guide can go on: the recipients chosen with a family; a batch has at least one package. */
function canGo(u: GiftUi): boolean {
    if (u.batch && !u.batch.edit && !giftBatchActive(u.batch).length) return false;
    return canGo(u);
}

/** A small round portrait place with the initials (the design's avatar), framed by gender. */
function avatar(p: Person): HTMLElement {
    const av = el('span', p.gender === 'female' ? 'gift-av is-f' : 'gift-av', personInitials(p.firstName, p.lastName));
    av.setAttribute('aria-hidden', 'true');
    return av;
}

/** A branch's family in or out: an exception only where it differs from what the depth gives. */
export function giftSetBranch(cut: GiftCut, b: Pick<GiftBranch, 'siblingId' | 'generation'>, on: boolean): GiftCut {
    const byDepth = cut.depth === 'all' || b.generation <= cut.depth;
    const branches = { ...cut.branches };
    if (on === byDepth) delete branches[b.siblingId];
    else branches[b.siblingId] = on;
    return { ...cut, branches };
}

/** Step 2's numbers for the cut now: its people, the branches, the four depths' counts (cached by the cut). */
function cutInfoOf(u: GiftUi): GiftCutInfo {
    const cut = u.g.settings.cut;
    const key = JSON.stringify(cut);
    if (u.cutInfo && u.cutInfo.key === key) return u.cutInfo;
    const noAncestors = cut.recipients.every(r => ancestorGenerations(u.data, r).length === 0);
    const ids = giftCutIds(u.data, cut);
    u.cutInfo = {
        key, ids, noAncestors,
        branches: giftBranchCandidates(u.data, cut),
        counts: giftDepthCounts(u.data, cut),
        model: null, modelKey: '',
        withPhotos: ids.size >= GIFT_CUT_LARGE_FROM
            ? estimateGiftSize(u.data, { ...u.g.settings, photos: true }, { now: new Date() }).total
            : null,
    };
    return u.cutInfo;
}

/** A stub's text in the language now. */
function stubLabel(stub: GiftPreviewStub): string {
    const T = strings.giftTree.cut;
    if (stub.kind === 'family') return T.stubFamily(stub.count);
    if (stub.kind === 'generations') return T.stubGenerations(stub.generations, stub.count);
    return T.stubSide(stub.surname, stub.count);
}

/** The preview's drawing for the cut now and the unfolded stubs (cached). */
function previewModelOf(u: GiftUi, info: GiftCutInfo): GiftPreviewModel {
    const key = `${[...u.expanded].sort().join(',')}|${getCurrentLanguage()}`;
    if (!info.model || info.modelKey !== key) {
        info.model = giftPreviewModel({
            data: u.data, ids: info.ids, recipients: u.g.settings.cut.recipients,
            branches: info.branches, expanded: u.expanded, stubLabel,
        });
        info.modelKey = key;
    }
    return info.model;
}

/**
 * The path from a recipient up to an ancestor ('F' through a man, 'M' through
 * a woman, nearest first), for the relation's words; null when not found.
 */
function pathUp(data: StromData, from: PersonId, to: PersonId): string[] | null {
    const seen = new Map<PersonId, string[]>([[from, []]]);
    const queue: PersonId[] = [from];
    for (let i = 0; i < queue.length; i++) {
        const id = queue[i];
        const path = seen.get(id)!;
        if (id === to) return path;
        for (const p of descentParentIds(data, id)) {
            if (seen.has(p)) continue;
            seen.set(p, [...path, data.persons[p]?.gender === 'female' ? 'M' : 'F']);
            queue.push(p);
        }
    }
    return null;
}

/** A branch's relation words: the kinship term ("aunt") and the path ("father's sister"). */
function branchRelation(u: GiftUi, b: GiftBranch): { kin: string; path: string } {
    const recipients = u.g.settings.cut.recipients;
    const key = `${recipients.join('|')}|${getCurrentLanguage()}`;
    if (u.relKey !== key) { u.rel = new Map(); u.relKey = key; }
    const known = u.rel.get(b.siblingId);
    if (known) return known;
    const sib = u.data.persons[b.siblingId];
    let path = '';
    let kin = '';
    for (const r of recipients) {
        const up = pathUp(u.data, r, b.ancestorId);
        if (!up) continue;
        path = strings.treeOverview.remRelation(up, { gender: sib?.gender, half: b.half });
        kin = findRelationship(u.data, r, b.siblingId)?.term[lang()] ?? '';
        break;
    }
    const out = { kin: kin && kin !== path ? kin : '', path };
    u.rel.set(b.siblingId, out);
    return out;
}

export const giftTreeMethods = uiModule({
    /**
     * Open the guide (`window.Strom.UI.showGiftTree`): for a person (default:
     * the person in focus), a couple or a list; it starts from what was
     * remembered for them (§9) or from the defaults.
     */
    showGiftTree(opts: GiftTreeOpenOptions = {}): void {
        const overlay = document.getElementById(GIFT_MODAL_ID);
        if (!overlay) return;
        if (ui) this.closeGiftTree();
        const data = DataManager.getData();
        const focusId = TreeRenderer.getFocusPersonId() ?? null;
        const first = opts.recipients?.[0] ?? opts.personId ?? focusId ?? null;
        let mode: GiftMode = opts.mode ?? (opts.recipients && opts.recipients.length === 2 ? 'pair' : 'single');
        if (mode === 'list' && isPhone()) mode = 'single';
        let batch: GiftBatchUi | null = null;
        if (mode === 'list') {
            const lists = batchLists();
            const listId = opts.listId && lists.some(l => l.id === opts.listId) ? opts.listId : lists[0]?.id;
            const source: GiftBatchSource | null = opts.selection ? { kind: 'selection', ref: opts.selection } : listId ? { kind: 'list', listId } : null;
            batch = batchNew(data, source, opts.selection ?? null);
        }
        const previewRow = batch ? batchRow(batch, batch.preview) : null;
        const recipients: Array<PersonId | null> = previewRow ? [...previewRow.recipients] : [realPerson(data, first)?.id ?? null];
        if (mode === 'pair') {
            const second = opts.recipients?.[1] ?? (recipients[0] ? giftSuggestedPartner(data, recipients[0]) : null);
            recipients.push(realPerson(data, second)?.id ?? null);
        }
        const g = giftGuideStart({
            data, treeId: TreeManager.getActiveTreeId(), mode, recipients,
            lang: lang(), signature: SettingsManager.getSenderName(), now: new Date(),
        });
        ui = {
            g, data, focusId, listId: opts.listId, query: '', listWhy: false, closePicker: null,
            summaryKey: '', summary: null, livingKey: '', living: null, mq: null, onMq: null,
            branchesScreen: false, view: null, viewKey: '', expanded: new Set(), cutInfo: null,
            relKey: '', rel: new Map(), dropPreview: null, run: null, carry: null, coverKey: '', coverHtml: '', estKey: '', est: null, letterTimer: 0,
            batch,
        };
        if (opts.step && canGo(ui)) giftGoTo(g, opts.step);
        // A window turned between phone and wider: the steps drawn again (the greyed list choice, the footer).
        if (typeof matchMedia === 'function') {
            const mq = matchMedia(MQ_PHONE_BAR);
            const onMq = (): void => this.giftRender();
            mq.addEventListener('change', onMq);
            ui.mq = mq;
            ui.onMq = onMq;
        }
        this.wireGiftModal(overlay);
        if (this.isPersonPageOpen()) this.dialogStack = this.dialogStack.filter(id => id !== GIFT_MODAL_ID);
        else this.clearDialogStack();
        this.pushDialog(GIFT_MODAL_ID);
        overlay.classList.add('active');
        this.giftRender();
        requestAnimationFrame(() => {
            overlay.querySelector<HTMLElement>('.gift-pane [aria-checked="true"], .gift-pane button, .gift-pane input')?.focus({ preventScroll: true });
        });
    },

    /** The footer's and header's buttons (wired once; they act on the guide open now). */
    wireGiftModal(overlay: HTMLElement): void {
        if (overlay.dataset.wired) return;
        overlay.dataset.wired = '1';
        overlay.querySelector('#gift-prev')?.addEventListener('click', () => this.giftStep(-1));
        overlay.querySelector('#gift-next')?.addEventListener('click', () => {
            if (!ui) return;
            if (ui.g.step >= GIFT_GUIDE_STEPS) this.giftCreatePackage();
            else this.giftStep(1);
        });
        overlay.querySelector('#gift-back')?.addEventListener('click', () => {
            if (!ui) return;
            if (ui.run) {
                if (ui.run.phase === 'making') this.giftCancelRun();
                else this.giftLeaveRun();
                return;
            }
            if (ui.branchesScreen) { this.giftBranchesScreen(false); return; }
            if (ui.batch?.edit) { this.giftBatchEditEnd(true); return; }
            if (ui.g.step <= 1) this.closeGiftTree();
            else this.giftStep(-1);
        });
        overlay.querySelector('#gift-sub-btn')?.addEventListener('click', () => this.giftStepsSheet());
        overlay.querySelector('#gift-nav')?.addEventListener('click', (e) => {
            const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-step]');
            if (!tab || tab.getAttribute('aria-disabled') === 'true' || !ui) return;
            this.giftGo(Number(tab.dataset.step));
        });
    },

    /** The guide is open. */
    isGiftTreeOpen(): boolean {
        return !!ui && !!document.getElementById(GIFT_MODAL_ID)?.classList.contains('active');
    },

    /** Escape: the open person choice first, then the window (nothing made, the settings remembered). */
    giftEscape(): void {
        if (this.giftCloseCover()) return;
        if (ui?.closePicker) { ui.closePicker(); return; }
        if (ui?.run?.phase === 'making') { this.giftCancelRun(); return; }
        if (ui?.branchesScreen) { this.giftBranchesScreen(false); return; }
        this.closeGiftTree();
    },

    /** Close the guide: nothing is made; the settings are remembered for this person or couple (§9). */
    closeGiftTree(): void {
        const u = ui;
        ui = null;
        if (u) {
            u.closePicker?.();
            u.dropPreview?.();
            // Closed while making: the making stops and nothing stays (the package's own cleanup).
            u.run?.ctrl?.abort();
            u.run = null;
            if (u.letterTimer) clearTimeout(u.letterTimer);
            if (u.mq && u.onMq) u.mq.removeEventListener('change', u.onMq);
            if (canGo(u)) giftRemember(u.g, summaryOf(u).persons, new Date());
        }
        document.getElementById(GIFT_COVER_ID)?.remove();
        document.getElementById(GIFT_MODAL_ID)?.querySelector('.gift-run-foot')?.remove();
        document.getElementById(GIFT_MODAL_ID)?.classList.remove('active');
        this.dialogStack = this.dialogStack.filter(id => id !== GIFT_MODAL_ID);
    },

    /** "Create package" (step 6, §8): the memory check, then the making with its progress. */
    giftCreatePackage(): void {
        void this.giftCreateAsync();
    },

    async giftCreateAsync(): Promise<void> {
        const u = ui;
        if (!u || u.run?.phase === 'making' || !canGo(u)) return;
        const s = u.g.settings;
        // Near the browser's limit: the question first; "Leave the photos out" makes it without them.
        const answer = await confirmMemoryForOutput({
            what: 'gift', canLeaveOut: s.photos, data: giftCutData(u.data, s.cut), whole: true,
        });
        if (ui !== u || answer === 'cancel') return;
        if (answer === 'without') s.photos = false;
        await this.giftRunPackage();
    },

    /** Make the package now: the progress in the pane, then done (the download), cancelled or the error. */
    async giftRunPackage(): Promise<void> {
        const u = ui;
        if (!u) return;
        u.closePicker?.();
        const settings = giftResolvedSettings(u.data, u.g.settings);
        const people = giftRecipients(u.g).map(id => realPerson(u.data, id)).filter((p): p is Person => !!p).map(p => shownName(p) || '?');
        const run: GiftRun = {
            phase: 'making', ctrl: new AbortController(), steps: giftStepsFor(settings.parts), progress: null,
            sizes: new Map(), persons: summaryOf(u).persons, result: null, coverHtml: '',
            names: giftNamesLabel(lang(), people), couple: people.length > 1, frame: 0,
        };
        u.run = run;
        this.giftRender();
        const treeId = TreeManager.getActiveTreeId();
        const treeName = (treeId ? TreeManager.getTreeMetadata(treeId)?.name : '') || strings.giftTree.title;
        try {
            const result = await buildGiftPackage({
                data: u.data, settings, treeName, signal: run.ctrl!.signal,
                onProgress: (p) => {
                    run.progress = p;
                    if (p.size !== undefined) run.sizes.set(p.step, p.size);
                    this.giftRunTick(run);
                },
                env: giftPackageEnv(treeId, settings, (html) => { run.coverHtml = html; }),
            });
            if (ui !== u || u.run !== run) return;
            run.phase = 'done';
            run.ctrl = null;
            run.result = result;
            u.g.memory = giftRemember(u.g, result.persons, new Date(), { made: true }) ?? u.g.memory;
            this.giftRender();
            // A desktop saves the file at once; a phone offers Share and Save to Files.
            if (!isPhone()) this.giftDownload();
        } catch (e) {
            if (ui !== u || u.run !== run) return;
            run.ctrl = null;
            if (isAbortError(e)) run.phase = 'cancelled';
            else if (e instanceof GiftOutOfMemory) { run.phase = 'oom'; run.oomPart = e.part; }
            else { run.phase = 'failed'; run.error = e instanceof Error ? e.message : String(e); }
            this.giftRender();
        }
    },

    /** One progress report: the pane drawn again on the next frame (many reports, one drawing). */
    giftRunTick(run: GiftRun): void {
        if (run.frame) return;
        const draw = (): void => {
            run.frame = 0;
            const pane = document.getElementById('gift-pane');
            if (!ui || ui.run !== run || run.phase !== 'making' || !pane) return;
            pane.replaceChildren();
            this.giftRenderRun(pane);
        };
        run.frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(draw) : (setTimeout(draw, 16) as unknown as number);
    },

    /** Cancel the making: nothing stays half-made (the package's own cleanup), the pane says Cancelled. */
    giftCancelRun(): void {
        ui?.run?.ctrl?.abort();
    },

    /** Leave the making's end (done, cancelled, an error) for the steps again. */
    giftLeaveRun(step?: number): void {
        const u = ui;
        if (!u?.run || u.run.phase === 'making') return;
        u.run = null;
        if (step) giftGoTo(u.g, step);
        this.giftRender();
    },

    /** Save the finished package as a file (the done row's name, "Save to Files", "Download again"). */
    giftDownload(): void {
        const r = ui?.run;
        if (!r?.result) return;
        try {
            downloadBlob(r.result.blob, r.result.fileName);
        } catch {
            r.phase = 'nodownload';
            this.giftRender();
        }
    },

    /** A phone's "Share…": the system's share sheet with the ZIP; dismissing it is no error. */
    async giftShare(): Promise<void> {
        const r = ui?.run;
        if (!r?.result) return;
        const file = new File([r.result.blob], r.result.fileName, { type: 'application/zip' });
        try {
            await navigator.share({ files: [file], title: r.result.fileName });
        } catch (e) {
            if ((e as { name?: string })?.name === 'AbortError') return;
            if (ui?.run === r) { r.phase = 'nodownload'; this.giftRender(); }
        }
    },

    /** "Create another": step 1 with the person choice open; the settings carried over to a person without their own. */
    giftAnother(): void {
        const u = ui;
        if (!u) return;
        u.carry = JSON.parse(JSON.stringify(u.g.settings)) as GiftSettings;
        u.run = null;
        giftGoTo(u.g, 1);
        this.giftRender();
        const anchor = document.querySelector<HTMLElement>(`#${GIFT_MODAL_ID} [data-gk="change-0"]`);
        if (anchor) this.giftPickPerson(0, anchor);
    },

    /** "Without the app" / "Try without photos" after running out of memory: the smaller package at once. */
    giftRetrySmaller(what: 'app' | 'photos'): void {
        const u = ui;
        if (!u) return;
        if (what === 'app') u.g.settings.parts = { ...u.g.settings.parts, app: false };
        else u.g.settings.photos = false;
        u.run = null;
        void this.giftRunPackage();
    },

    /** The cover page in its own window over the guide (steps 5, 6 and the end). */
    giftOpenCover(html?: string): void {
        const u = ui;
        if (!u) return;
        const doc = html ?? this.giftCoverHtml();
        document.getElementById(GIFT_COVER_ID)?.remove();
        const overlay = el('div', 'modal-overlay active gift-cover-overlay');
        overlay.id = GIFT_COVER_ID;
        const modal = el('div', 'modal modal--lg modal--page gift-cover-modal');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.dataset.dialogKind = 'info';
        const head = el('div', 'modal-header');
        const title = el('h2', undefined, strings.giftTree.review.coverH);
        title.id = 'gift-cover-title';
        modal.setAttribute('aria-labelledby', title.id);
        const close = button('close-btn', '×', () => this.giftCloseCover());
        close.setAttribute('aria-label', strings.buttons.close);
        head.append(title, close);
        const frame = el('iframe', 'gift-cover-frame');
        frame.setAttribute('sandbox', '');
        frame.title = strings.giftTree.review.coverH;
        frame.srcdoc = doc;
        modal.append(head, frame);
        overlay.appendChild(modal);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) this.giftCloseCover(); });
        document.body.appendChild(overlay);
        close.focus({ preventScroll: true });
    },

    giftCloseCover(): boolean {
        const node = document.getElementById(GIFT_COVER_ID);
        if (!node) return false;
        node.remove();
        document.querySelector<HTMLElement>(`#${GIFT_MODAL_ID} [data-gk="open-cover"]`)?.focus({ preventScroll: true });
        return true;
    },

    /** The cover page as the package would write it now (cached while the settings stay). */
    giftCoverHtml(): string {
        const u = ui!;
        const key = JSON.stringify([u.g.settings, lang()]);
        if (u.coverKey !== key) {
            const treeId = TreeManager.getActiveTreeId();
            const treeName = (treeId ? TreeManager.getTreeMetadata(treeId)?.name : '') || strings.giftTree.title;
            u.coverHtml = giftCoverPreviewHtml(u.data, u.g.settings, { treeName, now: new Date() });
            u.coverKey = key;
        }
        return u.coverHtml;
    },

    /** The scaled-down cover page (steps 5 and 6): a still picture of the page, a click opens it in a window. */
    giftCoverThumb(): HTMLElement {
        const box = el('div', 'gift-thumb');
        const frame = el('iframe', 'gift-thumb-frame');
        frame.setAttribute('sandbox', '');
        frame.setAttribute('aria-hidden', 'true');
        frame.tabIndex = -1;
        frame.srcdoc = this.giftCoverHtml();
        box.appendChild(frame);
        box.addEventListener('click', () => this.giftOpenCover());
        return box;
    },

    /** A step forward or back. */
    giftStep(delta: number): void {
        if (!ui) return;
        this.giftGo(ui.g.step + delta);
    },

    /** Show a step (a side tab, the phone's list of steps, "Straight to preview"). */
    giftGo(step: number): void {
        if (!ui) return;
        if (ui.run?.phase === 'making') return;
        if (step > 1 && !canGo(ui)) return;
        if (ui.batch?.edit && (step < 2 || step > 5)) { this.giftBatchEditEnd(true); return; }
        ui.run = null;
        ui.closePicker?.();
        giftGoTo(ui.g, step);
        ui.query = '';
        ui.branchesScreen = false;
        this.giftRender();
        const pane = document.getElementById('gift-pane');
        if (pane) pane.scrollTop = 0;
    },

    /** Draw the window: header, side, the step's pane, footer. The focused control keeps its focus. */
    giftRender(): void {
        const u = ui;
        const overlay = document.getElementById(GIFT_MODAL_ID);
        if (!u || !overlay) return;
        const active = document.activeElement as HTMLElement | null;
        const focusKey = active && overlay.contains(active) ? active.dataset.gk : undefined;
        const t = strings.giftTree;
        const g = u.g;
        const names = t.stepNames;
        const can = canGo(u);
        const sum = summaryOf(u);
        overlay.dataset.step = String(g.step);

        // Header: ‹ the step before (a phone: ‹ always, from step 1 it closes), the title, "step N of 6: …".
        const back = overlay.querySelector<HTMLButtonElement>('#gift-back');
        const sub2 = g.step === 2 && u.branchesScreen && isPhone();
        const editing = u.batch?.edit ? batchRow(u.batch, u.batch.edit) : null;
        if (back) {
            back.classList.toggle('is-first', g.step <= 1 && !sub2 && !editing);
            back.innerHTML = MODAL_BACK_CHEVRON;
            const label = editing ? t.batch.allRecipients : sub2 ? names[g.step - 1] : g.step > 1 ? names[g.step - 2] : strings.buttons.close;
            back.appendChild(el('span', 'gift-back-name', g.step > 1 ? label : ''));
            back.setAttribute('aria-label', editing ? label : g.step > 1 ? `${t.guide.back}: ${label}` : strings.buttons.close);
        }
        const title = overlay.querySelector('#gift-title');
        if (title) title.textContent = editing ? `${t.title} · ${batchRowName(u, editing)}` : t.title;
        overlay.classList.toggle('is-own', !!editing);
        const sub = overlay.querySelector('#gift-sub');
        if (sub) sub.textContent = t.step(g.step, names[g.step - 1]) + (editing ? ` · ${t.batch.ownSub}` : '');
        const subBtn = overlay.querySelector('#gift-sub-btn');
        if (subBtn) {
            subBtn.textContent = `${t.stepPhone(g.step, names[g.step - 1])}${sub2 ? ` › ${t.cut.branchesSub}` : ''} `;
            const caret = el('span', 'gift-sub-caret', '▾');
            caret.setAttribute('aria-hidden', 'true');
            subBtn.appendChild(caret);
            subBtn.setAttribute('aria-haspopup', 'dialog');
        }

        // The side: the six steps, then the summary.
        const nav = overlay.querySelector<HTMLElement>('#gift-nav');
        if (nav) {
            nav.replaceChildren();
            nav.setAttribute('aria-label', t.guide.stepsH);
            nav.appendChild(el('div', 'structure-who-head', t.guide.stepsH));
            const tabs = el('div', 'structure-who-tabs');
            for (let i = 1; i <= GIFT_GUIDE_STEPS; i++) {
                const tab = el('button', 'sel-tab gift-tab');
                tab.type = 'button';
                tab.dataset.selDir = 'side';
                tab.dataset.step = String(i);
                tab.dataset.gk = `tab-${i}`;
                if (i === g.step) tab.setAttribute('aria-current', 'step');
                if ((i > 1 && !can) || u.run?.phase === 'making' || (editing && (i < 2 || i > 5))) tab.setAttribute('aria-disabled', 'true');
                const k = el('span', 'gift-k', String(i));
                k.setAttribute('aria-hidden', 'true');
                tab.append(k, el('span', 'gift-tab-l', names[i - 1]));
                if (g.done.has(i)) {
                    const ok = el('span', 'gift-ok');
                    ok.innerHTML = iconSvg('check', { size: 14 });
                    ok.appendChild(el('span', 'gift-sr', t.guide.stepDone));
                    tab.appendChild(ok);
                }
                tabs.appendChild(tab);
            }
            nav.appendChild(tabs);
            nav.appendChild(this.giftSummaryEl(sum));
        }

        // The step's pane.
        const pane = overlay.querySelector<HTMLElement>('#gift-pane');
        if (pane) {
            const top = pane.scrollTop;
            u.dropPreview?.();
            u.dropPreview = null;
            pane.replaceChildren();
            if (editing && !u.run) pane.appendChild(this.giftBatchOwnLine(editing));
            if (u.run) this.giftRenderRun(pane);
            else if (g.step === 1) this.giftRenderForWhom(pane);
            else if (g.step === 2) this.giftRenderCut(pane);
            else if (g.step === 3) this.giftRenderLiving(pane);
            else if (g.step === 4) this.giftRenderParts(pane);
            else if (g.step === 5) this.giftRenderLetter(pane);
            else if (g.step === 6) this.giftRenderReview(pane);
            else pane.appendChild(el('h3', 'gift-h3', names[g.step - 1]));
            pane.scrollTop = top;
        }

        // The footer: a phone's summary line, Back or Cancel, Next or Create package.
        const footSum = overlay.querySelector<HTMLElement>('#gift-foot-sum');
        if (footSum) {
            footSum.innerHTML = can
                ? `<b>${sum.persons}</b> ${esc(t.guide.persons(sum.persons))} · <b>${sum.living}</b> ${esc(t.guide.living(sum.living))} · ${esc(t.guide.about(formatTreeSize(sum.bytes, lang())))}`
                : '';
        }
        const prev = overlay.querySelector<HTMLButtonElement>('#gift-prev');
        const cancel = overlay.querySelector<HTMLButtonElement>('#gift-cancel');
        const next = overlay.querySelector<HTMLButtonElement>('#gift-next');
        if (prev) { prev.hidden = g.step <= 1; prev.textContent = t.guide.back; }
        if (cancel) cancel.hidden = g.step > 1;
        if (next) {
            next.textContent = editing && g.step >= 5 ? t.batch.allRecipients : g.step >= GIFT_GUIDE_STEPS ? t.create : t.guide.next;
            next.disabled = !can;
        }
        // While making and at its end: the run's own buttons instead of the guide's.
        overlay.querySelector('.gift-run-foot')?.remove();
        const foot = overlay.querySelector<HTMLElement>('.gift-foot');
        foot?.classList.toggle('is-run', !!u.run);
        for (const b of [footSum, prev, cancel, next]) b?.toggleAttribute('data-run-hidden', !!u.run);
        if (u.run && foot) this.giftRunFoot(foot);
        overlay.dataset.run = u.run?.phase ?? '';

        if (focusKey) overlay.querySelector<HTMLElement>(`[data-gk="${focusKey}"]`)?.focus({ preventScroll: true });
    },

    // ---- Step 4: What the package holds (§5) ----

    giftRenderParts(pane: HTMLElement): void {
        const u = ui!;
        const s = u.g.settings;
        const t = strings.giftTree;
        const K = t.pkg;
        const language = lang();
        const est = estimatesOf(u);
        const size = (n: number): string => formatTreeSize(n, language);
        const cols = el('div', 'gift-cols is-s4');
        const left = el('div', 'gift-col gift-parts');
        const right = el('div', 'gift-col gift-zip');

        left.appendChild(el('h3', 'gift-h3', K.partsH));
        const list = el('div', 'gift-pt');
        const part = (key: 'cover' | GiftPartKey, on: boolean, link?: { text: string; run: () => void }): void => {
            const row = el('label', `gift-pt-r${on ? '' : ' is-off'}${key === 'cover' ? ' is-locked' : ''}`);
            const input = el('input');
            input.type = 'checkbox';
            input.checked = on;
            input.dataset.gk = `part-${key}`;
            input.dataset.part = key;
            if (key === 'cover') input.disabled = true;
            else input.addEventListener('change', () => {
                s.parts = { ...s.parts, [key]: input.checked };
                this.giftRender();
            });
            const text = el('span', 'gift-pt-x');
            text.appendChild(el('span', 'gift-pt-t', K.part[key].t));
            const d = el('span', 'gift-pt-d', K.part[key].d);
            if (link) {
                const a = button('link-button gift-pt-link', link.text, () => link.run());
                a.dataset.gk = `part-link-${key}`;
                a.addEventListener('click', (e) => e.preventDefault());
                d.append(' ', a);
            }
            text.appendChild(d);
            row.append(input, text, el('span', 'gift-pt-s', size(est.all.parts[key])));
            list.appendChild(row);
        };
        part('cover', true);
        part('app', s.parts.app);
        part('pages', s.parts.pages);
        part('book', s.parts.book, { text: K.bookSettings, run: () => this.giftBookSettings() });
        part('fan', s.parts.fan, { text: K.fanLook, run: () => { void this.giftFanLook(); } });
        part('gedcom', s.parts.gedcom);
        left.appendChild(list);

        // Photos: with them (how many, how much) or without.
        left.appendChild(el('h3', 'gift-h3 gift-photos-h', K.photosH));
        const photos = est.now.photos;
        left.appendChild(giftSegment(K.photosH, 'photos', [
            { key: 'on', label: K.withPhotos, sub: photos.count ? K.photosCount(photos.count, size(photos.bytes)) : K.noPhotos, on: s.photos },
            { key: 'off', label: K.withoutPhotos, sub: K.smaller, on: !s.photos },
        ], (key) => {
            s.photos = key === 'on';
            this.giftRender();
        }));
        left.appendChild(el('p', 'gift-note', K.photosNote));

        // The ZIP's contents as the package names them (the letter's language).
        right.appendChild(el('h3', 'gift-h3', K.zipH));
        const tree = el('div', 'gift-zip-tree');
        const people = giftRecipients(u.g).map(id => ({ id, name: shownName(u.data.persons[id]) || '?' }));
        const names = giftFileNames(s.letter.lang, people, new Date().getFullYear(), s.fileName);
        const row = (level: number, name: string, opts: { folder?: boolean; bytes?: number; off?: boolean } = {}): void => {
            const r = el('div', `gift-zip-r is-l${level}${opts.off ? ' is-off' : ''}`);
            const ic = el('span', 'gift-zip-ic');
            ic.setAttribute('aria-hidden', 'true');
            ic.innerHTML = iconSvg(opts.folder ? 'folder' : 'file', { size: 14 });
            r.append(ic, el('span', 'gift-zip-n', name), el('span', 'gift-zip-s', opts.bytes !== undefined && !opts.off ? size(opts.bytes) : ''));
            tree.appendChild(r);
        };
        const p = s.parts;
        const parts = est.now.parts;
        row(0, names.zip);
        row(1, names.folder, { folder: true });
        row(2, names.start, { bytes: parts.cover });
        row(2, names.app, { bytes: parts.app, off: !p.app });
        row(2, names.pages, { folder: true, bytes: parts.pages, off: !p.pages });
        row(2, names.book, { bytes: parts.book, off: !p.book });
        names.fans.forEach((f, i) => {
            const last = i === names.fans.length - 1;
            row(2, `${f.stem}.svg`, { off: !p.fan });
            row(2, `${f.stem}.png`, { off: !p.fan, ...(last ? { bytes: parts.fan } : {}) });
        });
        const slash = names.gedcom.indexOf('/');
        row(2, names.gedcom.slice(0, slash), { folder: true, off: !p.gedcom });
        row(3, names.gedcom.slice(slash + 1), { bytes: parts.gedcom, off: !p.gedcom });
        right.appendChild(tree);
        const tot = el('div', 'gift-zip-tot');
        tot.append(el('b', undefined, K.total(size(est.now.total))),
            el('span', undefined, [K.lessPhotos(size(est.now.withoutPhotos)), ...(p.app ? [K.lessApp(size(est.now.withoutApp))] : [])].join(' · ')));
        right.appendChild(tot);
        right.appendChild(el('p', 'gift-note', K.zipNote));

        cols.append(left, right);
        pane.appendChild(cols);
    },

    /**
     * "Book settings…" / "Fan look…": the guide steps aside for the app's own
     * dialog and comes back at this step when it closes (the package takes
     * the choices made there).
     */
    giftAside(target: HTMLElement, closed: () => boolean, back?: () => void): void {
        const u = ui;
        const overlay = document.getElementById(GIFT_MODAL_ID);
        if (!u || !overlay) return;
        overlay.classList.remove('active');
        this.dialogStack = this.dialogStack.filter(id => id !== GIFT_MODAL_ID);
        const obs = new MutationObserver(() => {
            if (!closed()) return;
            obs.disconnect();
            back?.();
            if (ui !== u) return;
            overlay.classList.add('active');
            this.pushDialog(GIFT_MODAL_ID);
            this.giftRender();
            overlay.querySelector<HTMLElement>('.gift-pane input, .gift-pane button')?.focus({ preventScroll: true });
        });
        obs.observe(target, { attributes: true, attributeFilter: ['class', 'hidden'] });
    },

    giftBookSettings(): void {
        const modal = document.getElementById('book-modal');
        if (!ui || !modal) return;
        this.giftAside(modal, () => !modal.classList.contains('active'));
        this.showBookDialog('book');
    },

    async giftFanLook(): Promise<void> {
        if (!ui) return;
        const before = TreeRenderer.getViewMode();
        if (before !== 'fan') await TreeRenderer.setViewMode('fan');
        const panel = document.getElementById('fan-look-panel');
        const btn = document.getElementById('fan-look-btn');
        if (!panel || !btn) return;
        this.giftAside(panel, () => panel.hidden, () => {
            if (before !== 'fan') void TreeRenderer.setViewMode(before);
        });
        btn.click();
    },

    // ---- Step 5: Cover letter (§6) ----

    giftRenderLetter(pane: HTMLElement): void {
        const u = ui!;
        const s = u.g.settings;
        const t = strings.giftTree;
        const L = t.letter;
        const G = t.guide;
        const cols = el('div', 'gift-cols is-s5');
        const left = el('div', 'gift-col gift-letter');
        const right = el('div', 'gift-col gift-cover-col');
        const letter = s.letter;
        const persons = giftRecipients(u.g).map(id => u.data.persons[id]).filter((p): p is Person => !!p);

        // The letter's language and the motif.
        const top = el('div', 'gift-letter-top');
        const langField = el('label', 'gift-field gift-letter-lang');
        langField.appendChild(el('span', 'gift-label', L.langH));
        const select = el('select', 'gift-select');
        select.dataset.gk = 'letter-lang';
        for (const code of ['cs', 'en', 'de', 'pl'] as GiftLang[]) {
            const o = el('option', undefined, L.langName[code]);
            o.value = code;
            o.selected = letter.lang === code;
            select.appendChild(o);
        }
        select.addEventListener('change', () => {
            const next = select.value as GiftLang;
            const was = persons.length ? giftDefaultSalutation(persons.length === 1 ? persons[0] : persons, letter.lang) : '';
            const salutation = persons.length && letter.salutation === was
                ? giftDefaultSalutation(persons.length === 1 ? persons[0] : persons, next) : letter.salutation;
            s.letter = { ...s.letter, lang: next, salutation };
            this.giftRender();
        });
        langField.appendChild(select);
        const motif = el('div', 'gift-field gift-letter-motif');
        motif.appendChild(el('span', 'gift-label', L.motifH));
        motif.appendChild(giftSegment(L.motifH, 'motif', (['none', 'xmas'] as const).map(m => ({ key: m, label: L.motif[m], on: letter.motif === m })), (key) => {
            s.letter = { ...s.letter, motif: key as GiftLetter['motif'] };
            this.giftRender();
        }));
        top.append(langField, motif);
        left.appendChild(top);

        // The salutation the template puts in (a batch: each recipient's own, in step 1's table).
        if (u.batch && !u.batch.edit) {
            const salField = el('div', 'gift-field gift-letter-sal');
            salField.append(el('span', 'gift-label', L.salutationH), el('p', 'gift-note gift-sal-note', strings.giftTree.batch.salutationNote));
            left.appendChild(salField);
        } else {
            const salField = el('label', 'gift-field gift-letter-sal');
            salField.appendChild(el('span', 'gift-label', L.salutationH));
            const sal = el('input', 'gift-input');
            sal.type = 'text';
            sal.value = letter.salutation;
            sal.dataset.gk = 'letter-salutation';
            sal.addEventListener('input', () => {
                s.letter = { ...s.letter, salutation: sal.value };
                this.giftLetterChanged();
            });
            salField.appendChild(sal);
            left.appendChild(salField);
        }

        // The message: the template until rewritten; "Insert the template again".
        const msgField = el('div', 'gift-field gift-letter-msg');
        const msgHead = el('div', 'gift-letter-msg-head');
        const msgLabel = el('label', 'gift-label', L.messageH);
        msgLabel.htmlFor = 'gift-letter-message';
        const again = button('link-button gift-reinsert', L.reinsert, () => {
            s.letter = { ...s.letter, message: '' };
            this.giftRender();
            document.getElementById('gift-letter-message')?.focus({ preventScroll: true });
        });
        again.dataset.gk = 'letter-reinsert';
        again.hidden = !letter.message;
        msgHead.append(msgLabel, again);
        const area = el('textarea', 'gift-input gift-textarea');
        area.id = 'gift-letter-message';
        area.dataset.gk = 'letter-message';
        const template = giftResolvedLetter(u.data, { ...s, letter: { ...letter, message: '' } }).message;
        area.value = letter.message || template;
        area.addEventListener('input', () => {
            s.letter = { ...s.letter, message: area.value === template ? '' : area.value };
            again.hidden = !s.letter.message;
            this.giftLetterChanged();
        });
        msgField.append(msgHead, area, el('p', 'gift-note', L.messageNote));
        left.appendChild(msgField);

        // The signature and the date.
        const sigRow = el('div', 'gift-letter-sig');
        const sigField = el('label', 'gift-field gift-letter-sign');
        sigField.appendChild(el('span', 'gift-label', G.signatureShort));
        const sig = el('input', 'gift-input');
        sig.type = 'text';
        sig.value = letter.signature;
        sig.dataset.gk = 'letter-signature';
        sig.addEventListener('input', () => {
            s.letter = { ...s.letter, signature: sig.value };
            this.giftLetterChanged();
        });
        sigField.appendChild(sig);
        const dateField = el('label', 'gift-field gift-letter-date');
        dateField.appendChild(el('span', 'gift-label', L.dateH));
        const date = el('input', 'gift-input');
        date.type = 'date';
        date.value = letter.date;
        date.dataset.gk = 'letter-date';
        date.addEventListener('change', () => {
            if (!date.value) return;
            s.letter = { ...s.letter, date: date.value };
            this.giftRender();
        });
        dateField.appendChild(date);
        sigRow.append(sigField, dateField);
        left.appendChild(sigRow);

        // What the letter's figures are.
        left.appendChild(el('h3', 'gift-h3 gift-numbers-h', L.numbersH));
        left.appendChild(el('p', 'gift-note gift-numbers', this.giftNumbersLine()));

        const head = el('div', 'gift-cover-head');
        head.appendChild(el('h3', 'gift-h3', L.previewH));
        const open = button('link-button gift-open-cover', L.openWindow, () => this.giftOpenCover());
        open.dataset.gk = 'open-cover';
        head.appendChild(open);
        right.appendChild(head);
        const sw = this.giftBatchPreviewSwitch();
        if (sw) right.appendChild(sw);
        right.appendChild(this.giftCoverThumb());

        cols.append(left, right);
        pane.appendChild(cols);
    },

    /** The letter typed: the side's summary stays, the cover page's preview follows a moment later. */
    giftLetterChanged(): void {
        const u = ui;
        if (!u) return;
        if (u.letterTimer) clearTimeout(u.letterTimer);
        u.letterTimer = setTimeout(() => {
            u.letterTimer = 0;
            if (ui !== u) return;
            const frame = document.querySelector<HTMLIFrameElement>(`#${GIFT_MODAL_ID} .gift-thumb-frame`);
            if (frame) frame.srcdoc = this.giftCoverHtml();
        }, 400) as unknown as number;
    },

    /** "From the family tree, not the whole tree: 84 people, 7 generations, the oldest ancestor …". */
    giftNumbersLine(): string {
        const u = ui!;
        const L = strings.giftTree.letter;
        const G = strings.giftTree.guide;
        const s = u.g.settings;
        const cut = giftCutData(u.data, s.cut);
        const recipients = s.cut.recipients.filter(id => !!cut.persons[id]);
        const f = giftFacts(cut, recipients, lang(), new Date());
        const items = [`${f.persons} ${G.persons(f.persons)}`, `${f.generations} ${G.generations(f.generations)}`];
        if (f.oldest) {
            const p = cut.persons[f.oldest.id];
            if (p && !isLivingPerson(p, new Date().getFullYear(), inferBirthUpperBounds(cut))) {
                const when = f.oldest.year === null ? '' : f.oldest.approx ? `${strings.giftTree.cover.about} ${f.oldest.year}` : String(f.oldest.year);
                items.push(L.oldest(f.oldest.name, [when, f.oldest.place ?? ''].filter(Boolean).join(', ')));
            }
        }
        items.push(L.placesAndPath, L.byGeneration);
        return L.numbers(items.join(', '));
    },

    // ---- Step 6: Preview and create (§8) ----

    giftRenderReview(pane: HTMLElement): void {
        const u = ui!;
        const s = u.g.settings;
        const t = strings.giftTree;
        const G = t.guide;
        const R = t.review;
        const language = lang();
        const sum = summaryOf(u);
        const cols = el('div', 'gift-cols is-s6');
        const left = el('div', 'gift-col gift-review');
        const right = el('div', 'gift-col gift-cover-col');

        const stats = el('div', 'structure-stats gift-stats gift-review-stats');
        const stat = (value: string, label: string): void => {
            const box = el('div', 'structure-stat');
            box.append(el('b', undefined, value), el('span', undefined, label));
            stats.appendChild(box);
        };
        const batch = u.batch && !u.batch.edit ? u.batch : null;
        const B = t.batch;
        if (batch) {
            // A batch: packages, recipients, the living and the outer ZIP.
            const tot = batchTotals(u);
            stat(String(tot.packages), B.packages(tot.packages));
            stat(String(tot.recipients), G.persons(tot.recipients));
            stat(String(tot.living), G.living(tot.living));
            stat(formatTreeSize(tot.bytes, language), R.zipStat);
        } else {
            stat(String(sum.persons), G.persons(sum.persons));
            stat(String(sum.generations), G.generations(sum.generations));
            stat(String(sum.living), G.living(sum.living));
            stat(formatTreeSize(sum.bytes, language), R.zipStat);
        }
        left.appendChild(stats);

        // What the package will be, each row with "Change" to its step.
        const dl = el('dl', 'gift-dl gift-review-dl');
        const names = giftRecipients(u.g).map(id => realPerson(u.data, id)).filter((p): p is Person => !!p).map(p => shownName(p) || '?');
        const row = (dt: string, dd: string, step: number | null): void => {
            const d = el('dd', undefined, dd);
            if (step) {
                const change = button('link-button gift-change', R.change, () => this.giftGo(step));
                change.dataset.gk = `change-step-${step}`;
                change.setAttribute('aria-label', `${R.change}: ${dt}`);
                d.append(' ', change);
            }
            dl.append(el('dt', undefined, dt), d);
        };
        if (batch) {
            const n = giftBatchActive(batch).length;
            row(R.forRow, `${batchSourceLabel(batch.source) || B.tableH} · ${n} ${B.packages(n)}`, 1);
        } else {
            row(R.forRow, giftNamesLabel(language, names), 1);
        }
        const rows = this.giftSettingsRows(sum);
        const L = t.letter;
        rows.forEach(([dt, dd], i) => {
            if (i === 3) {
                const sig = s.letter.signature.trim();
                dd = [L.langName[s.letter.lang], G.motif[s.letter.motif], giftDateLabel(s.letter.date, language),
                    ...(sig ? [R.signed(sig)] : [])].join(' · ');
            }
            row(dt, dd, i + 2);
        });
        left.appendChild(dl);

        // The archive's name (the default from the recipients and the year).
        const field = el('label', 'gift-field gift-filename');
        field.appendChild(el('span', 'gift-label', R.fileName));
        const input = el('input', 'gift-input');
        input.type = 'text';
        input.dataset.gk = 'file-name';
        input.spellcheck = false;
        input.autocomplete = 'off';
        const fallback = batch ? giftBatchFileName(s.letter.lang, new Date().getFullYear()) : defaultZipName(u);
        input.value = (batch ? batch.fileName : s.fileName) ?? fallback;
        input.addEventListener('input', () => {
            const v = input.value.trim();
            const name = v && v !== fallback ? v : undefined;
            if (batch) batch.fileName = name;
            else s.fileName = name;
        });
        field.appendChild(input);
        left.appendChild(field);
        left.appendChild(el('p', 'gift-note', R.local));

        const head = el('div', 'gift-cover-head');
        head.appendChild(el('h3', 'gift-h3', R.coverH));
        const open = button('link-button gift-open-cover', L.openWindow, () => this.giftOpenCover());
        open.dataset.gk = 'open-cover';
        head.appendChild(open);
        right.appendChild(head);
        right.appendChild(this.giftCoverThumb());

        cols.append(left, right);
        pane.appendChild(cols);
    },

    // ---- The making (§8): progress, cancelled, done, the errors ----

    giftRenderRun(pane: HTMLElement): void {
        const u = ui!;
        const run = u.run!;
        const t = strings.giftTree;
        const M = t.make;
        const language = lang();
        const box = el('div', 'gift-run');
        box.dataset.phase = run.phase;
        pane.appendChild(box);
        const h = (text: string): void => {
            const h3 = el('h3', 'gift-h3 gift-run-h', text);
            h3.tabIndex = -1;
            box.appendChild(h3);
        };

        if (run.phase === 'making') {
            h(`${M.making} · ${run.names}`);
            const p = run.progress;
            const n = run.steps.length;
            const k = p ? p.stepIndex : 1;
            const step = p?.step ?? run.steps[0];
            const part = p?.total ? (p.done ?? 0) / p.total : 0;
            const share = Math.min(1, Math.max(0, (k - 1 + (p?.size !== undefined ? 1 : part)) / n));
            const prog = el('div', 'prog gift-prog');
            const line = el('div', 'prog-line');
            let label = t.steps[step];
            if (p?.total && step === 'pages') label += ` · ${M.pagesOf(p.done ?? 0, p.total)}`;
            if (p?.total && step === 'book') label += ` · ${M.chaptersOf(p.done ?? 0, p.total)}`;
            line.append(el('span', 'prog-t', label), el('span', 'prog-k', M.stepOf(k, n)));
            prog.append(line, barEl(share));
            box.appendChild(prog);

            const list = el('ul', 'gift-steps');
            run.steps.forEach((st, i) => {
                const done = run.sizes.has(st) && (i + 1 < k || p?.size !== undefined);
                const now = !done && i + 1 === k;
                const li = el('li', `gift-stp${done ? ' is-done' : now ? ' is-now' : ' is-wait'}`);
                const mark = el('span', 'gift-stp-i');
                mark.setAttribute('aria-hidden', 'true');
                if (done) mark.innerHTML = iconSvg('check', { size: 14 });
                else if (now) mark.appendChild(spinEl(12));
                else mark.textContent = '·';
                li.append(mark, el('span', 'gift-stp-t', t.steps[st]));
                const k2 = el('span', 'gift-stp-k');
                if (done) {
                    k2.textContent = st === 'cut'
                        ? `${run.persons} ${t.guide.persons(run.persons)}`
                        : formatTreeSize(run.sizes.get(st) ?? 0, language);
                }
                li.appendChild(k2);
                list.appendChild(li);
            });
            box.appendChild(list);
            box.appendChild(el('p', 'gift-note', M.note));
            return;
        }

        if (run.phase === 'cancelled') {
            h(M.cancelledH);
            box.appendChild(el('p', 'gift-lead', M.cancelledLead));
            return;
        }

        if (run.phase === 'oom') {
            h(M.oomH);
            box.appendChild(el('p', 'gift-lead', M.oomLead(M.oomPart[run.oomPart ?? 'zip'])));
            return;
        }

        if (run.phase === 'failed') {
            h(M.failedH);
            box.appendChild(el('p', 'gift-lead', M.failedLead(run.error ?? '')));
            return;
        }

        const r = run.result!;
        const size = formatTreeSize(r.bytes, language);
        if (run.phase === 'nodownload') {
            h(M.noDownloadH);
            box.appendChild(el('p', 'gift-lead', M.noDownloadLead(size)));
            box.appendChild(el('p', 'gift-note', M.noDownloadNote));
            return;
        }

        // Done: the file (a click saves it again), open the cover page, create another.
        h(M.doneH);
        const file = el('div', 'gift-done-file');
        const ic = el('span', 'gift-done-ic');
        ic.setAttribute('aria-hidden', 'true');
        ic.innerHTML = iconSvg('file', { size: 18 });
        const name = button('gift-done-name', r.fileName, () => this.giftDownload());
        name.dataset.gk = 'done-file';
        file.append(ic, name, el('span', 'gift-done-size', size));
        box.appendChild(file);
        const phone = isPhone();
        const acts = el('div', 'gift-done-acts');
        const openCover = button(phone ? 'link-button gift-open-cover' : 'secondary gift-open-cover', M.openCover,
            () => this.giftOpenCover(run.coverHtml || undefined));
        openCover.dataset.gk = 'open-cover';
        acts.appendChild(openCover);
        if (!phone) {
            const another = button('secondary gift-another', M.another, () => this.giftAnother());
            another.dataset.gk = 'another';
            acts.appendChild(another);
        }
        box.appendChild(acts);
        if (phone) box.appendChild(el('p', 'gift-note', M.shareNote));
        if (u.g.mode !== 'list') {
            box.appendChild(el('p', 'gift-note', phone ? M.savedShort(run.names, run.couple) : M.saved(run.names, run.couple)));
        }
    },

    /** The footer while making and at its end (the guide's own buttons hidden meanwhile). */
    giftRunFoot(foot: HTMLElement): void {
        const u = ui!;
        const run = u.run!;
        const M = strings.giftTree.make;
        const host = el('div', 'gift-run-foot');
        foot.appendChild(host);
        const add = (cls: string, text: string, key: string, onClick: () => void): HTMLButtonElement => {
            const b = button(cls, text, onClick);
            b.dataset.gk = key;
            host.appendChild(b);
            return b;
        };
        const closeBtn = (): void => { add('secondary', strings.buttons.close, 'run-close', () => this.closeGiftTree()); };
        switch (run.phase) {
            case 'making':
                host.appendChild(el('span', 'gift-run-hint', M.foot));
                add('secondary is-danger-text', strings.buttons.cancel, 'run-cancel', () => this.giftCancelRun());
                break;
            case 'cancelled':
            case 'failed':
                closeBtn();
                add('primary', M.again, 'run-again', () => { u.run = null; void this.giftRunPackage(); });
                break;
            case 'nodownload':
                closeBtn();
                add('primary', M.downloadAgain, 'run-download', () => { run.phase = 'done'; this.giftRender(); this.giftDownload(); });
                break;
            case 'oom':
                closeBtn();
                if (u.g.settings.parts.app) add('secondary', M.withoutApp, 'run-no-app', () => this.giftRetrySmaller('app'));
                if (u.g.settings.photos) add('primary', M.tryWithoutPhotos, 'run-no-photos', () => this.giftRetrySmaller('photos'));
                break;
            case 'done':
                if (isPhone()) {
                    const share = canShareZip();
                    add(share ? 'secondary' : 'primary', M.saveFiles, 'run-save', () => this.giftDownload());
                    if (share) add('primary', M.share, 'run-share', () => { void this.giftShare(); });
                } else {
                    add('primary', M.finish, 'run-finish', () => this.closeGiftTree());
                }
                break;
        }
    },

    /** The side's summary (§2): the name, people and generations, the living, the ZIP's size. */
    giftSummaryEl(sum: GiftSummary): HTMLElement {
        const u = ui!;
        const t = strings.giftTree.guide;
        const box = el('div', 'gift-sum');
        box.setAttribute('aria-live', 'polite');
        const B = strings.giftTree.batch;
        const line = (html: string): void => { const s = el('span'); s.innerHTML = html; box.appendChild(s); };
        if (u.batch && !u.batch.edit) {
            // A batch: the list's name, packages and recipients, couples, the outer ZIP's size.
            box.appendChild(el('span', 'gift-sum-name', batchSourceLabel(u.batch.source) || B.tableH));
            if (!canGo(u)) return box;
            const tot = batchTotals(u);
            line(`<b>${tot.packages}</b> ${esc(B.packages(tot.packages))} · ${tot.recipients} ${esc(t.persons(tot.recipients))}`);
            if (tot.couples) box.appendChild(el('span', undefined, `${tot.couples} ${B.couples(tot.couples)}`));
            box.appendChild(el('span', undefined, t.zip(formatTreeSize(tot.bytes, lang()))));
            return box;
        }
        const names = giftRecipients(u.g).map(id => realPerson(u.data, id)).filter((p): p is Person => !!p).map(p => shownName(p) || '?');
        box.appendChild(el('span', 'gift-sum-name', giftNamesLabel(lang(), names)));
        if (!canGo(u)) return box;
        line(`<b>${sum.persons}</b> ${esc(t.persons(sum.persons))} · ${sum.generations} ${esc(t.generations(sum.generations))}`);
        line(`<b>${sum.living}</b> ${esc(t.living(sum.living))}`);
        box.appendChild(el('span', undefined, t.zip(formatTreeSize(sum.bytes, lang()))));
        if (u.batch?.edit && u.batch.common) {
            // One row edited: which steps are its own.
            const parts = giftOwnParts(giftOwnDiff(u.batch.common, u.g.settings) ?? undefined);
            if (parts.length) box.appendChild(el('span', 'gift-sum-own', B.ownParts(parts.map(k => B.ownPart[k]).join(', '))));
        }
        return box;
    },

    /** The phone's list of steps (the subtitle's ▾): a bottom sheet with the steps and the summary. */
    giftStepsSheet(): void {
        const u = ui;
        if (!u) return;
        const t = strings.giftTree;
        const can = canGo(u);
        const sum = summaryOf(u);
        const rows = t.stepNames.map((name, i) => ({
            label: name, icon: String(i + 1), active: i + 1 === u.g.step,
            value: u.g.done.has(i + 1) ? '✓' : '',
            id: `gift-sheet-step-${i + 1}`,
            ...(i > 0 && !can ? { disabled: true } : {}),
            run: () => this.giftGo(i + 1),
        }));
        const quiet = can
            ? `${sum.persons} ${t.guide.persons(sum.persons)} · ${sum.living} ${t.guide.living(sum.living)} · ${t.guide.about(formatTreeSize(sum.bytes, lang()))}`
            : undefined;
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        this.presentMenuSheet(t.guide.stepsH, [{ rows, ...(quiet ? { quiet } : {}) }], { overlayClass: 'gift-steps-sheet' });
    },

    // ---- Step 1: For whom (§2 [8–10], §9 [65]) ----

    giftRenderForWhom(pane: HTMLElement): void {
        const u = ui!;
        const g = u.g;
        const t = strings.giftTree;
        const G = t.guide;
        const phone = isPhone();
        const can = canGo(u);
        const cols = el('div', 'gift-cols is-s1');
        const left = el('div', 'gift-col');
        const right = el('div', 'gift-col gift-defaults');

        left.appendChild(el('h3', 'gift-h3', G.forWhomH));
        // The three choices (a radio group of .sel-opt rows with a dot).
        const group = el('div', 'structure-choice gift-modes');
        group.setAttribute('role', 'radiogroup');
        group.setAttribute('aria-label', G.forWhomH);
        const modes: GiftMode[] = ['single', 'pair', 'list'];
        const choices: HTMLButtonElement[] = [];
        for (const m of modes) {
            const off = m === 'list' && phone;
            const b = el('button', 'sel-opt gift-mode');
            b.type = 'button';
            b.setAttribute('role', 'radio');
            b.dataset.mode = m;
            b.dataset.gk = `mode-${m}`;
            b.setAttribute('aria-checked', String(g.mode === m));
            b.tabIndex = g.mode === m ? 0 : -1;
            const dot = el('span', 'structure-dot');
            dot.setAttribute('aria-hidden', 'true');
            const text = el('span', 'option-text');
            text.append(el('span', 'option-title', G.mode[m].t), el('span', 'option-desc', off ? G.listPhoneWhy : G.mode[m].d));
            const ic = el('span', 'gift-mode-ic');
            ic.innerHTML = iconSvg(m === 'single' ? 'user' : m === 'pair' ? 'users' : 'list', { size: 16, strokeWidth: 1.7 });
            b.append(dot, text, ic);
            if (off) b.setAttribute('aria-disabled', 'true');
            b.addEventListener('click', () => {
                if (off) { u.listWhy = true; this.giftRender(); return; }
                this.giftSetMode(m);
            });
            choices.push(b);
            group.appendChild(b);
        }
        group.addEventListener('keydown', (e) => {
            if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
            const live = choices.filter(c => c.getAttribute('aria-disabled') !== 'true');
            const at = live.findIndex(c => c.dataset.mode === g.mode);
            const to = live[(at + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : live.length - 1)) % live.length];
            if (!to) return;
            e.preventDefault();
            this.giftSetMode(to.dataset.mode as GiftMode);
        });
        left.appendChild(group);
        if (phone && u.listWhy) left.appendChild(el('p', 'gift-note', G.listPhoneNote));

        // A list or the selection: the source, the couples, the signature and the recipients' table.
        if (g.mode === 'list' && u.batch) {
            cols.classList.add('is-list');
            this.giftBatchPick(left);
            cols.appendChild(left);
            pane.appendChild(cols);
            return;
        }

        // Who: one person, or the couple's two.
        const who = el('div', 'gift-who');
        const chosen = g.recipients;
        who.appendChild(el('span', 'gift-label', g.mode === 'pair' ? G.recipients : G.recipient));
        const first = realPerson(u.data, chosen[0]);
        who.appendChild(this.giftPersonRow(first, 0, first && first.id === u.focusId ? strings.selection.focusSub : '', strings.selection.changePerson));
        if (g.mode === 'pair') {
            const second = realPerson(u.data, chosen[1]);
            const suggested = first ? giftSuggestedPartner(u.data, first.id) : null;
            who.appendChild(this.giftPersonRow(second, 1, second && second.id === suggested ? G.partnerFromTree : '', G.otherPerson));
            if (!second) who.appendChild(el('p', 'gift-note', G.secondMissing));
            else who.appendChild(el('p', 'gift-note', G.pairNote));
        } else if (first && !giftHasFamily(u.data, first.id)) {
            // A person alone in the tree: nothing to make a family tree of (§1 [9]).
            const lone = el('p', 'gift-note gift-lone', G.lonePerson(shownName(first) || '?', first.gender === 'female', strings.selection.changePerson));
            lone.id = 'gift-lone';
            who.appendChild(lone);
        }
        if (g.memory) {
            // §9 [65]: the steps start from last time's settings.
            const last = el('p', 'gift-last');
            last.appendChild(el('b', undefined, t.last(giftDateLabel(g.memory.lastAt))));
            last.append(` ${G.lastMore} `);
            const restart = button('link-button', t.restart, () => this.giftRestart());
            restart.dataset.gk = 'restart';
            last.appendChild(restart);
            who.appendChild(last);
        }
        left.appendChild(who);

        left.appendChild(this.giftSignatureField());

        cols.appendChild(left);
        if (can) {
            const sum = summaryOf(u);
            right.appendChild(el('h3', 'gift-h3', g.memory ? G.lastH : G.defaultsH));
            const dl = el('dl', 'gift-dl');
            for (const [dt, dd] of this.giftSettingsRows(sum)) {
                dl.append(el('dt', undefined, dt), el('dd', undefined, dd));
            }
            right.appendChild(dl);
            right.appendChild(el('p', 'gift-note gift-defaults-note', g.memory ? G.cutChanged(sum.persons - g.memory.cutSize) : G.fastNote));
            const fast = button('secondary gift-fast', t.fast, () => this.giftGo(GIFT_GUIDE_STEPS));
            fast.dataset.gk = 'fast';
            right.appendChild(fast);
            // A phone: one quiet sentence and the link instead of the four rows.
            const phoneFast = el('p', 'gift-note gift-phone-fast');
            phoneFast.append(`${g.memory ? G.phoneLast : G.phoneDefaults} `);
            const link = button('link-button', t.fast, () => this.giftGo(GIFT_GUIDE_STEPS));
            link.dataset.gk = 'fast-phone';
            phoneFast.appendChild(link);
            right.appendChild(phoneFast);
            cols.appendChild(right);
        }
        pane.appendChild(cols);
    },

    /** The signature (shown in the letter and when the app opens). */
    giftSignatureField(): HTMLElement {
        const g = ui!.g;
        const G = strings.giftTree.guide;
        const field = el('label', 'gift-field gift-signature');
        field.appendChild(el('span', 'gift-label', isPhone() ? G.signatureShort : G.signature));
        const input = el('input', 'gift-input');
        input.type = 'text';
        input.value = g.settings.letter.signature;
        input.dataset.gk = 'signature';
        input.autocomplete = 'off';
        input.addEventListener('input', () => {
            g.settings.letter = { ...g.settings.letter, signature: input.value };
        });
        field.appendChild(input);
        return field;
    },

    /** Step 1 of a batch (§7 [53]): the list or selection, couples as one package, the signature, the recipients. */
    giftBatchPick(left: HTMLElement): void {
        const u = ui!;
        const b = u.batch!;
        const B = strings.giftTree.batch;
        const lists = batchLists();

        // The list or the selection (as the export's list field: the kind's icon, "name · N people").
        if (!lists.length && !b.selection) {
            left.appendChild(el('p', 'gift-note gift-batch-none', B.noLists));
        } else {
            const field = el('div', 'gift-field gift-batch-source');
            const label = el('label', 'gift-label', B.sourceH);
            label.htmlFor = 'gift-batch-source';
            field.appendChild(label);
            const row = el('div', 'export-list-field');
            const icon = el('span', 'export-list-kind');
            icon.setAttribute('aria-hidden', 'true');
            const src = b.source;
            icon.innerHTML = src?.kind === 'list' ? (lists.find(l => l.id === src.listId)?.icon ?? '') : iconSvg('list', { size: 16 });
            const select = el('select', 'gift-input gift-select');
            select.id = 'gift-batch-source';
            select.dataset.gk = 'batch-source';
            if (b.selection) {
                const o = el('option', undefined, `${selectionText(b.selection)} · ${strings.lists.persons(batchSourceIds({ kind: 'selection', ref: b.selection }).length)}`);
                o.value = 'selection';
                select.appendChild(o);
            }
            for (const l of lists) {
                const o = el('option', undefined, `${l.name} · ${strings.lists.persons(l.count)}`);
                o.value = `list:${l.id}`;
                select.appendChild(o);
            }
            select.value = src?.kind === 'selection' ? 'selection' : src ? `list:${src.listId}` : '';
            select.addEventListener('change', () => this.giftBatchSetSource(select.value));
            row.append(icon, select);
            field.appendChild(row);
            left.appendChild(field);
        }
        left.appendChild(this.giftCheck('batch-pairs', B.pairs, b.pairs, (on) => this.giftBatchSetPairs(on)));
        left.appendChild(this.giftSignatureField());

        // The recipients: one row per package.
        const active = giftBatchActive(b);
        const recipients = active.reduce((n, r) => n + r.recipients.length, 0);
        const couples = active.filter(r => r.recipients.length === 2).length;
        const head = el('div', 'gift-rcp-head');
        head.appendChild(el('h3', 'gift-h3', `${B.tableH} · ${B.tableCount(active.length, recipients, couples)}`));
        head.appendChild(el('p', 'gift-note gift-rcp-note', B.tableNote));
        left.appendChild(head);
        const shown = b.rows.filter(r => !b.removed.has(r.key));
        if (!active.length && b.source) left.appendChild(el('p', 'gift-note gift-batch-empty', B.empty));
        if (shown.length) left.appendChild(this.giftBatchTable(shown));
        if (b.removed.size) {
            const note = el('p', 'gift-note gift-rcp-removed', `${B.removed(b.removed.size)} `);
            const back = button('link-button', B.putBack, () => {
                b.removed.clear();
                batchShow(u);
                this.giftRender();
            });
            back.dataset.gk = 'put-back';
            note.appendChild(back);
            left.appendChild(note);
        }
    },

    /** The recipients' table: name (years or "couple"), salutation, people, living, common/own with Edit…, ×. */
    giftBatchTable(rows: GiftRecipientRow[]): HTMLElement {
        const u = ui!;
        const b = u.batch!;
        const B = strings.giftTree.batch;
        const common = batchCommon(u);
        const stats = batchStats(u);
        const table = el('div', 'gift-rcp');
        table.setAttribute('role', 'table');
        table.setAttribute('aria-label', B.tableH);
        const head = el('div', 'gift-rcp-h');
        head.setAttribute('role', 'row');
        for (const [cls, text] of [['who', B.col.who], ['sal', B.col.salutation], ['num', B.col.persons], ['num', B.col.living], ['set', B.col.settings], ['x', '']] as const) {
            const c = el('span', `gift-rcp-c is-${cls}`, text);
            c.setAttribute('role', 'columnheader');
            head.appendChild(c);
        }
        table.appendChild(head);
        for (const r of rows) {
            const name = batchRowName(u, r);
            const own = b.own.has(r.key);
            const line = el('div', `gift-rcp-r${r.lone ? ' is-lone' : ''}${own ? ' is-own' : ''}`);
            line.setAttribute('role', 'row');
            line.dataset.key = r.key;
            const cell = (cls: string): HTMLElement => {
                const c = el('div', `gift-rcp-c is-${cls}`);
                c.setAttribute('role', 'cell');
                line.appendChild(c);
                return c;
            };
            const who = cell('who');
            const first = realPerson(u.data, r.recipients[0]);
            who.append(el('span', 'gift-rcp-name', name),
                el('span', 'gift-rcp-s', r.recipients.length === 2 ? B.couple : first ? yearsOf(first) : ''));
            const sal = cell('sal');
            if (!r.lone) {
                const input = el('input', 'gift-input gift-rcp-sal');
                input.type = 'text';
                input.autocomplete = 'off';
                input.value = giftBatchSalutation(u.data, b, common, r);
                input.dataset.gk = `sal-${r.key}`;
                input.setAttribute('aria-label', `${B.col.salutation}: ${name}`);
                input.addEventListener('input', () => {
                    b.salutations.set(r.key, input.value);
                    if (r.key === b.preview) u.g.settings.letter = { ...u.g.settings.letter, salutation: input.value };
                });
                sal.appendChild(input);
            }
            const st = stats.get(r.key);
            cell('num').textContent = st ? String(st.persons) : '–';
            cell('num').textContent = st ? String(st.living) : '–';
            const set = cell('set');
            if (r.lone) {
                set.appendChild(el('span', 'gift-rcp-tag', B.lone));
            } else {
                set.appendChild(el('span', 'gift-rcp-tag', own ? B.own : B.common));
                const edit = button('link-button gift-rcp-edit', B.edit, () => this.giftBatchEdit(r.key));
                edit.dataset.gk = `edit-${r.key}`;
                edit.setAttribute('aria-label', B.editFor(name));
                set.append(' ', edit);
            }
            const x = button('gift-rcp-x', '×', () => {
                b.removed.add(r.key);
                batchShow(u);
                this.giftRender();
            });
            x.dataset.gk = `rm-${r.key}`;
            x.title = B.remove;
            x.setAttribute('aria-label', B.removeFor(name));
            cell('x').appendChild(x);
            table.appendChild(line);
        }
        return table;
    },

    /** Another list or the selection: its rows (own settings and salutations kept by person). */
    giftBatchSetSource(value: string): void {
        const u = ui;
        const b = u?.batch;
        if (!u || !b) return;
        b.source = value === 'selection' && b.selection ? { kind: 'selection', ref: b.selection }
            : value.startsWith('list:') ? { kind: 'list', listId: value.slice(5) } : null;
        if (b.source?.kind === 'list') u.listId = b.source.listId;
        b.rows = giftBatchRows(u.data, batchSourceIds(b.source), b.pairs);
        b.removed.clear();
        batchShow(u);
        this.giftRender();
    },

    /** "Spouses and partners as one package" on or off: the rows again. */
    giftBatchSetPairs(on: boolean): void {
        const u = ui;
        const b = u?.batch;
        if (!u || !b) return;
        b.pairs = on;
        b.rows = giftBatchRows(u.data, batchSourceIds(b.source), on);
        batchShow(u);
    },

    /** "Edit…" (§7 [54]): steps 2–5 for this row alone, from its settings now (common with its own over them). */
    giftBatchEdit(key: string): void {
        const u = ui;
        const b = u?.batch;
        const row = b ? batchRow(b, key) : null;
        if (!u || !b || !row || b.edit) return;
        b.common = u.g.settings;
        b.edit = key;
        u.g.settings = giftBatchRowSettings(u.data, b, b.common, row);
        u.g.recipients = [...row.recipients];
        this.giftGo(2);
    },

    /** Back to all recipients: what the edit changed stays the row's own; `keep` false drops it ("Back to common"). */
    giftBatchEditEnd(keep: boolean): void {
        const u = ui;
        const b = u?.batch;
        const row = b ? batchRow(b, b.edit) : null;
        if (!u || !b || !b.common || !row) return;
        const common = b.common;
        if (keep) {
            const diff = giftOwnDiff(common, u.g.settings);
            if (diff) b.own.set(row.key, diff);
            else b.own.delete(row.key);
            const typed = u.g.settings.letter.salutation;
            const fallback = giftBatchDefaultSalutation(u.data, row, b.own.get(row.key)?.letter?.lang ?? common.letter.lang);
            if (typed === fallback) b.salutations.delete(row.key);
            else b.salutations.set(row.key, typed);
        } else {
            b.own.delete(row.key);
        }
        u.g.settings = common;
        b.common = null;
        b.edit = null;
        batchShow(u);
        u.closePicker?.();
        u.branchesScreen = false;
        u.g.step = 1;
        this.giftRender();
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`#${GIFT_MODAL_ID} [data-gk="edit-${row.key}"]`)?.focus({ preventScroll: true }));
    },

    /** The edit's sentence on top of steps 2–5: "Changes only for … – the others have the common settings. Back to common". */
    giftBatchOwnLine(row: GiftRecipientRow): HTMLElement {
        const B = strings.giftTree.batch;
        const p = el('p', 'gift-own-line');
        p.append(el('b', undefined, B.ownH(batchRowName(ui!, row))), ` ${B.ownRest} `);
        const back = button('link-button', B.backToCommon, () => this.giftBatchEditEnd(false));
        back.dataset.gk = 'back-to-common';
        p.appendChild(back);
        return p;
    },

    /** Step 5's ‹ name ›: the letter's preview for the previous or next recipient. */
    giftBatchPreviewSwitch(): HTMLElement | null {
        const u = ui!;
        const b = u.batch;
        if (!b || b.edit) return null;
        const active = giftBatchActive(b);
        if (active.length < 2) return null;
        const B = strings.giftTree.batch;
        const at = Math.max(0, active.findIndex(r => r.key === b.preview));
        const go = (d: number): void => {
            b.preview = active[(at + d + active.length) % active.length].key;
            batchShow(u);
            this.giftRender();
        };
        const box = el('div', 'gift-switch');
        const prev = button('gift-switch-b', '‹', () => go(-1));
        prev.dataset.gk = 'preview-prev';
        prev.setAttribute('aria-label', B.previewPrev);
        const next = button('gift-switch-b', '›', () => go(1));
        next.dataset.gk = 'preview-next';
        next.setAttribute('aria-label', B.previewNext);
        const name = el('span', 'gift-switch-name', batchRowName(u, active[at]));
        name.setAttribute('aria-live', 'polite');
        box.append(prev, name, next);
        return box;
    },

    /** A recipient's row: portrait, name, years and what they are, "Change…" (or "Choose a person…" while missing). */
    giftPersonRow(p: Person | null, index: number, note: string, change: string): HTMLElement {
        const row = el('div', 'gift-prow');
        const G = strings.giftTree.guide;
        if (p) {
            row.appendChild(avatar(p));
            const text = el('div', 'gift-ptext');
            text.appendChild(el('div', 'gift-pname', shownName(p) || '?'));
            const place = p.birthPlace ? p.birthPlace.split(',')[0].trim() : '';
            const years = [yearsOf(p), place].filter(Boolean).join(', ');
            const sub = [years, note].filter(Boolean).join(' · ');
            if (sub) text.appendChild(el('div', 'gift-pyears', sub));
            row.appendChild(text);
        } else {
            row.appendChild(el('div', 'gift-ptext gift-pnone', G.secondMissing));
        }
        const btn = el('button', 'link-button gift-change', p ? change : G.choosePerson);
        btn.type = 'button';
        btn.dataset.gk = `change-${index}`;
        btn.setAttribute('aria-expanded', 'false');
        btn.addEventListener('click', () => this.giftPickPerson(index, btn));
        row.appendChild(btn);
        return row;
    },

    /** "Change…" / "Another person…": the person popover (search over the tree, the person in focus offered). */
    giftPickPerson(index: number, anchor: HTMLElement): void {
        const u = ui;
        const overlay = document.getElementById(GIFT_MODAL_ID);
        if (!u || !overlay) return;
        if (u.closePicker) { u.closePicker(); return; }
        const tv = strings.treeOverview;
        const suggested: Array<{ id: PersonId; meta: string }> = [];
        const current = u.g.recipients[index];
        if (current) suggested.push({ id: current, meta: '' });
        if (index === 1 && u.g.recipients[0]) {
            const partner = giftSuggestedPartner(u.data, u.g.recipients[0]);
            if (partner) suggested.push({ id: partner, meta: strings.giftTree.guide.partnerFromTree });
        }
        if (u.focusId) suggested.push({ id: u.focusId, meta: tv.inFocus });
        u.closePicker = openPersonPopover({
            host: overlay, anchor, data: u.data, selectedId: current ?? null, suggested,
            labels: { search: tv.searchPerson, list: strings.giftTree.guide.choosePerson, noMatch: tv.noMatch },
            onClose: () => { if (ui) ui.closePicker = null; },
            onPick: (id) => {
                if (!ui) return;
                const next = [...ui.g.recipients];
                next[index] = id;
                // A couple: a new first person brings their own last partner along.
                if (ui.g.mode === 'pair' && index === 0) next[1] = giftSuggestedPartner(ui.data, id);
                this.giftRestartFor(ui.g.mode, next);
                requestAnimationFrame(() => document.querySelector<HTMLElement>(`#${GIFT_MODAL_ID} [data-gk="change-${index}"]`)?.focus());
            },
        });
    },

    /** One person / a couple / a list. A couple's second person: the first one's last partner. */
    giftSetMode(mode: GiftMode): void {
        const u = ui;
        if (!u || u.g.mode === mode) return;
        if (mode === 'list') {
            const lists = batchLists();
            const listId = u.listId && lists.some(l => l.id === u.listId) ? u.listId : lists[0]?.id;
            u.batch = batchNew(u.data, listId ? { kind: 'list', listId } : null, null);
            const row = batchRow(u.batch, u.batch.preview);
            this.giftRestartFor('list', row ? [...row.recipients] : [null]);
            return;
        }
        const first = u.batch ? (u.focusId ?? u.g.recipients[0] ?? null) : u.g.recipients[0] ?? null;
        u.batch = null;
        const recipients: Array<PersonId | null> = [first];
        if (mode === 'pair') recipients.push(first ? giftSuggestedPartner(u.data, first) : null);
        this.giftRestartFor(mode, recipients);
    },

    /**
     * The guide for other recipients: their remembered settings or the
     * defaults (settings are kept per person or couple, §9); the signature
     * typed stays.
     */
    giftRestartFor(mode: GiftMode, recipients: Array<PersonId | null>): void {
        const u = ui;
        if (!u) return;
        const signature = u.g.settings.letter.signature;
        u.g = giftGuideStart({
            data: u.data, treeId: u.g.treeId, mode, recipients, lang: lang(), signature, now: new Date(),
        });
        u.g.settings.letter = { ...u.g.settings.letter, signature };
        if (u.carry && !u.g.memory) u.g.settings = giftCarried(u.data, u.g.settings, u.carry);
        u.query = '';
        this.giftRender();
    },

    /** "Start over with defaults": last time's settings left (they stay remembered until the guide closes). */
    giftRestart(): void {
        const u = ui;
        if (!u) return;
        u.g = giftGuideStart({
            data: u.data, treeId: u.g.treeId, mode: u.g.mode, recipients: u.g.recipients,
            lang: lang(), signature: SettingsManager.getSenderName(), now: new Date(), storage: null,
        });
        this.giftRender();
        document.querySelector<HTMLElement>(`#${GIFT_MODAL_ID} [data-gk="mode-${u.g.mode}"]`)?.focus({ preventScroll: true });
    },

    /** Step 1's four rows: what the tree, the living, the package and the letter will be (§2, §9). */
    giftSettingsRows(sum: GiftSummary): Array<[string, string]> {
        const u = ui!;
        const s = u.g.settings;
        const G = strings.giftTree.guide;
        const language = lang();
        const branches = Object.keys(s.cut.branches).length;
        const cut = [G.cutDepth[giftDepthIndex(s.cut.depth)] ?? G.cutDepth[GIFT_DEPTHS.length - 1],
            ...(branches ? [G.cutBranches(branches)] : [])].join(', ') + ` · ${sum.persons} ${G.persons(sum.persons)}`;
        let living: string;
        if (sum.living === 0) living = G.livingNone;
        else if (s.privacy.others === 'full') living = G.livingAll;
        else {
            const model = livingOf(u);
            const extra = model.rows.filter(r => !r.household && s.privacy.fullIds.includes(r.id)).length;
            const firsts = giftRecipients(u.g).map(id => u.data.persons[id]?.firstName || shownName(u.data.persons[id]) || '?');
            const others = s.privacy.others as Exclude<PrivacyMode, 'full'>;
            living = `${G.livingFull(giftNamesLabel(language, firsts), extra)}, ${G.others[others]}`;
        }
        const parts = [G.parts.letter, ...(['app', 'pages', 'book', 'fan', 'gedcom'] as const).filter(k => s.parts[k]).map(k => G.parts[k])];
        const pkg = `${parts.join(', ')}, ${s.photos ? G.withPhotos : G.withoutPhotos} · ${G.about(formatTreeSize(sum.bytes, language))}`;
        const today = giftIsoDate(new Date());
        const letter = [s.letter.message ? G.letterOwn : G.letterTemplate, G.motif[s.letter.motif],
            s.letter.date === today ? G.today : giftDateLabel(s.letter.date, language)].join(', ');
        return [[G.rows.cut, cut], [G.rows.living, living], [G.rows.parts, pkg], [G.rows.letter, letter]];
    },

    // ---- Step 3: Living people (§4 [13, 23–25, 37–39]) ----

    giftRenderLiving(pane: HTMLElement): void {
        const u = ui!;
        const s = u.g.settings;
        const G = strings.giftTree.guide;
        const model = livingOf(u);
        const full = giftFullSet(model, s);
        const living = model.rows.length;
        const cols = el('div', 'gift-cols is-s3');
        const left = el('div', 'gift-col gift-living');
        const right = el('div', 'gift-col gift-protect');

        if (living > 0) {
            // The numbers: living of all, in full, shortened (a phone: four, the people last).
            const stats = el('div', 'structure-stats gift-stats');
            const stat = (n: number, label: string, cls = ''): void => {
                const box = el('div', `structure-stat${cls}`);
                box.append(el('b', undefined, String(n)), el('span', undefined, label));
                stats.appendChild(box);
            };
            const others = s.privacy.others;
            stat(living, G.statLivingOf(living, model.persons), ' gift-stat-wide');
            stat(living, G.living(living), ' gift-stat-phone');
            stat(full.size, G.statFull);
            if (others !== 'full') {
                stat(living - full.size, G.statShort[others], ' gift-stat-wide');
                stat(living - full.size, G.statShortPhone, ' gift-stat-phone');
            }
            stat(model.persons, G.persons(model.persons), ' gift-stat-phone');
            left.appendChild(stats);

            const head = el('div', 'gift-living-head');
            head.append(el('h3', 'gift-h3', G.livingH), el('span', 'gift-faint', G.checkedFull));
            left.appendChild(head);

            const listHost = el('div', 'gift-living-list');
            if (living >= GIFT_LIVING_SEARCH_FROM) {
                const search = el('input', 'gift-input gift-search');
                search.type = 'search';
                search.placeholder = G.searchLiving;
                search.setAttribute('aria-label', G.searchLiving);
                search.value = u.query;
                search.dataset.gk = 'living-search';
                search.autocomplete = 'off';
                search.addEventListener('input', () => {
                    u.query = search.value;
                    this.giftFillLiving(listHost);
                });
                left.appendChild(search);
            }
            left.appendChild(listHost);
            this.giftFillLiving(listHost);
        } else {
            left.appendChild(el('p', 'gift-lead', G.noLiving));
            left.appendChild(el('p', 'gift-note', G.noLivingNote));
        }

        if (living > 0) {
            // The other living: today's modes, with what each makes of them.
            const field = el('label', 'gift-field gift-others');
            field.appendChild(el('span', 'gift-label', G.othersH));
            const select = el('select', 'gift-select');
            select.dataset.gk = 'others';
            const P = strings.privacy;
            const labels: Record<PrivacyMode, string> = {
                full: P.modeFull, initials: P.modeInitials, anonymous: P.modeAnonymous, minimal: P.modeMinimal,
            };
            for (const m of ['initials', 'anonymous', 'minimal', 'full'] as PrivacyMode[]) {
                const o = el('option', undefined, labels[m]);
                o.value = m;
                o.selected = s.privacy.others === m;
                select.appendChild(o);
            }
            select.addEventListener('change', () => {
                s.privacy = { ...s.privacy, others: select.value as PrivacyMode };
                this.giftRender();
            });
            field.appendChild(select);
            right.appendChild(field);
            right.appendChild(el('p', 'gift-faint gift-mode-desc', G.modeDesc[s.privacy.others]));

            right.appendChild(el('h3', 'gift-h3 gift-sens-h', G.sensitiveH));
            const sens = el('div', 'content-checks gift-checks gift-sens');
            for (const key of ['birthDates', 'addresses', 'contacts', 'photos', 'notes', 'religion', 'sources'] as const) {
                sens.appendChild(this.giftCheck(`sens-${key}`, G.sensitive[key], s.privacy.sensitive[key], (on) => {
                    s.privacy = { ...s.privacy, sensitive: { ...s.privacy.sensitive, [key]: on } };
                }));
            }
            right.appendChild(sens);
        }
        right.appendChild(el('h3', 'gift-h3 gift-dead-h', G.deadH));
        const dead = el('div', 'content-checks gift-checks gift-dead');
        for (const key of ['causes', 'notes', 'sources'] as const) {
            dead.appendChild(this.giftCheck(`dead-${key}`, G.dead[key], s.privacy.dead[key], (on) => {
                s.privacy = { ...s.privacy, dead: { ...s.privacy.dead, [key]: on } };
            }));
        }
        right.appendChild(dead);
        right.appendChild(el('p', 'gift-note gift-all-parts', strings.giftTree.allParts));

        cols.append(left, right);
        pane.appendChild(cols);
    },

    /** A `.content-check` box; a change redraws the summary (the size follows photos and the rest). */
    giftCheck(key: string, label: string, on: boolean, set: (on: boolean) => void): HTMLElement {
        const box = el('label', 'content-check');
        const input = el('input');
        input.type = 'checkbox';
        input.checked = on;
        input.dataset.gk = key;
        input.addEventListener('change', () => {
            set(input.checked);
            this.giftRender();
        });
        box.append(input, el('span', undefined, label));
        return box;
    },

    /** Step 3's rows of the living: the household locked on top, the rest ticked for "in full" (filtered by the search). */
    giftFillLiving(host: HTMLElement): void {
        const u = ui!;
        const s = u.g.settings;
        const G = strings.giftTree.guide;
        const model = livingOf(u);
        const full = giftFullSet(model, s);
        const allFull = s.privacy.others === 'full';
        host.replaceChildren();
        let rows = model.rows;
        const q = u.query.trim();
        if (q) {
            const persons = rows.map(r => u.data.persons[r.id]).filter((p): p is Person => !!p);
            const hit = new Set(filterAndSort(q, persons, u.data).map(p => p.id));
            rows = rows.filter(r => hit.has(r.id));
            if (!rows.length) { host.appendChild(el('p', 'gift-faint gift-nomatch', G.noMatch)); return; }
        }
        const list = el('ul', 'gift-lv');
        list.setAttribute('aria-label', G.livingH);
        let householdEnded = false;
        const householdNote = (): void => {
            const li = el('li', 'gift-lv-note gift-faint', strings.giftTree.household);
            list.appendChild(li);
        };
        for (const r of rows) {
            if (!r.household && !householdEnded) {
                householdEnded = true;
                if (rows.some(x => x.household)) householdNote();
            }
            const isFull = full.has(r.id);
            const li = el('li', 'gift-lv-r' + (isFull ? ' is-full' : ''));
            const label = el('label', 'gift-lv-label');
            const input = el('input');
            input.type = 'checkbox';
            input.checked = isFull;
            input.dataset.gk = `lv-${r.id}`;
            if (r.household || allFull) input.disabled = true;
            input.addEventListener('change', () => {
                giftToggleFull(s, r.id, input.checked);
                this.giftRender();
            });
            const text = el('span', 'gift-lv-text');
            text.appendChild(el('span', 'gift-lv-name', r.name));
            const rel = r.recipient ? G.recipientRel(r.female) : r.relation;
            if (rel) text.appendChild(el('span', 'gift-lv-rel', rel));
            label.append(input, text);
            li.appendChild(label);
            li.appendChild(el('span', 'gift-lv-v', isFull ? G.fullWord : r.shortened));
            list.appendChild(li);
        }
        if (!householdEnded && rows.some(x => x.household)) householdNote();
        host.appendChild(list);
    },

    // ---- Step 2: Who is in it (§3) ----

    /** The depth of the ancestors' families, the preview of the cut, the branches (a phone: the branches on their own screen). */
    giftRenderCut(pane: HTMLElement): void {
        const u = ui!;
        const s = u.g.settings;
        const T = strings.giftTree.cut;
        const G = strings.giftTree.guide;
        const phone = isPhone();
        const info = cutInfoOf(u);
        const sum = summaryOf(u);
        // The view and the unfolded stubs belong to these recipients; the view also to this screen.
        const rk = s.cut.recipients.join('|');
        const viewKey = `${rk}#${phone ? (u.branchesScreen ? 'sub' : 'phone') : 'wide'}`;
        if (u.viewKey !== viewKey) {
            if (!u.viewKey.startsWith(`${rk}#`)) u.expanded = new Set();
            u.view = null;
            u.viewKey = viewKey;
        }

        if (phone && u.branchesScreen) {
            const wrap = el('div', 'gift-cut-sub');
            const host = el('div', 'gift-prev-host');
            wrap.appendChild(host);
            wrap.appendChild(el('p', 'gift-note gift-br-note', T.branchesNoteShort));
            wrap.appendChild(this.giftBranchList(info));
            pane.appendChild(wrap);
            this.giftMountPreview(host, info, sum, false);
            return;
        }

        const cols = el('div', 'gift-cols is-s2');
        const left = el('div', 'gift-col gift-cut');
        if (info.ids.size >= GIFT_CUT_LARGE_FROM) {
            // §3 [21]: a cut this big leads with what the package would be.
            const lead = el('p', 'structure-who-lead gift-cut-lead');
            lead.innerHTML = `<b>${esc(T.count(info.ids.size))}</b>${esc(T.largeLead(
                `${sum.generations} ${G.generations(sum.generations)}`,
                `${sum.living.toLocaleString(lang())} ${G.living(sum.living)}`,
                formatTreeSize(info.withPhotos ?? sum.bytes, lang()),
            ))}`;
            left.appendChild(lead);
        }
        const head = el('div', 'gift-cut-head');
        head.append(el('h3', 'gift-h3', T.depthH), el('span', 'gift-faint gift-cut-hint', T.depthHint));
        left.appendChild(head);
        left.appendChild(phone ? this.giftDepthRows(info) : this.giftDepthSeg(info));

        // The sentence under the depth: no ancestors [19], every choice the same [20], else what is never in it.
        const same = !info.noAncestors && GIFT_DEPTHS.every(d => info.counts[d] === info.counts.all);
        let note: string = T.outLine;
        if (info.noAncestors) {
            const names = s.cut.recipients.map(id => realPerson(u.data, id)).filter((p): p is Person => !!p);
            const who = names.length > 1 ? 'pair' : names[0]?.gender === 'female' ? 'f' : 'm';
            note = T.noAncestors(giftNamesLabel(lang(), names.map(p => shownName(p) || '?')), who);
        } else if (same) note = `${T.sameCounts} ${T.outLine}`;
        const noteEl = el('p', 'gift-note gift-cut-note', note);
        noteEl.id = 'gift-cut-note';
        left.appendChild(noteEl);

        const host = el('div', 'gift-prev-host');
        left.appendChild(host);
        if (phone) {
            const open = button('secondary gift-br-open', T.branchesOpen, () => this.giftBranchesScreen(true));
            open.dataset.gk = 'branches-open';
            left.appendChild(open);
        }
        cols.appendChild(left);

        if (!phone) {
            const right = el('div', 'gift-col gift-branches');
            right.appendChild(el('h3', 'gift-h3', T.branchesH));
            right.appendChild(el('p', 'gift-note gift-br-note', T.branchesNote));
            right.appendChild(this.giftBranchList(info));
            cols.appendChild(right);
        }
        pane.appendChild(cols);
        this.giftMountPreview(host, info, sum, phone);
    },

    /** The depth as a segment of four, each with its count (wider than a phone). */
    giftDepthSeg(info: GiftCutInfo): HTMLElement {
        const u = ui!;
        const T = strings.giftTree.cut;
        const cut = u.g.settings.cut;
        const seg = el('div', 'sel-seg gift-seg');
        seg.setAttribute('role', 'radiogroup');
        seg.setAttribute('aria-label', T.depthH);
        if (info.noAncestors) seg.setAttribute('aria-disabled', 'true');
        GIFT_DEPTHS.forEach((d, i) => {
            const b = el('button', 'sel-opt gift-seg-o');
            b.type = 'button';
            b.dataset.selForm = 'seg';
            b.dataset.depth = String(d);
            b.dataset.gk = `depth-${i}`;
            b.setAttribute('role', 'radio');
            const on = !info.noAncestors && cut.depth === d;
            b.setAttribute('aria-checked', String(on));
            b.tabIndex = on || (info.noAncestors && i === 0) ? 0 : -1;
            if (info.noAncestors) b.setAttribute('aria-disabled', 'true');
            b.append(el('span', 'gift-seg-l', T.depth[i]), el('span', 'gift-seg-n', info.noAncestors ? '—' : T.count(info.counts[d])));
            b.addEventListener('click', () => this.giftSetDepth(d));
            seg.appendChild(b);
        });
        seg.addEventListener('keydown', (e) => this.giftDepthKey(e));
        return seg;
    },

    /** A phone: the depth as rows with a dot, what each means and its count. */
    giftDepthRows(info: GiftCutInfo): HTMLElement {
        const u = ui!;
        const T = strings.giftTree.cut;
        const cut = u.g.settings.cut;
        const group = el('div', 'structure-choice gift-depths');
        group.setAttribute('role', 'radiogroup');
        group.setAttribute('aria-label', T.depthH);
        if (info.noAncestors) group.setAttribute('aria-disabled', 'true');
        GIFT_DEPTHS.forEach((d, i) => {
            const b = el('button', 'sel-opt gift-depth');
            b.type = 'button';
            b.setAttribute('role', 'radio');
            b.dataset.depth = String(d);
            b.dataset.gk = `depth-${i}`;
            const on = !info.noAncestors && cut.depth === d;
            b.setAttribute('aria-checked', String(on));
            b.tabIndex = on || (info.noAncestors && i === 0) ? 0 : -1;
            if (info.noAncestors) b.setAttribute('aria-disabled', 'true');
            const dot = el('span', 'structure-dot');
            dot.setAttribute('aria-hidden', 'true');
            const text = el('span', 'option-text');
            text.append(
                el('span', 'option-title', d === GIFT_DEFAULT_DEPTH ? T.defaultMark(T.depth[i]) : T.depth[i]),
                el('span', 'option-desc', T.depthDesc[i]),
            );
            b.append(dot, text, el('b', 'gift-depth-n', info.noAncestors ? '—' : T.count(info.counts[d])));
            b.addEventListener('click', () => this.giftSetDepth(d));
            group.appendChild(b);
        });
        group.addEventListener('keydown', (e) => this.giftDepthKey(e));
        return group;
    },

    /** Arrows move the depth (not without ancestors). */
    giftDepthKey(e: KeyboardEvent): void {
        const u = ui;
        if (!u || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        if (cutInfoOf(u).noAncestors) return;
        e.preventDefault();
        const at = GIFT_DEPTHS.indexOf(u.g.settings.cut.depth);
        const next = GIFT_DEPTHS[(at + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : GIFT_DEPTHS.length - 1)) % GIFT_DEPTHS.length];
        this.giftSetDepth(next);
        document.querySelector<HTMLElement>(`#${GIFT_MODAL_ID} [data-gk="depth-${GIFT_DEPTHS.indexOf(next)}"]`)?.focus({ preventScroll: true });
    },

    /** Change the depth: the preview, the counts and the summary follow. */
    giftSetDepth(depth: GiftDepth): void {
        const u = ui;
        if (!u || cutInfoOf(u).noAncestors || u.g.settings.cut.depth === depth) return;
        u.g.settings.cut = { ...u.g.settings.cut, depth };
        this.giftRender();
    },

    /** A branch's family in or out of the cut. */
    giftSetBranch(b: GiftBranch, on: boolean): void {
        const u = ui;
        if (!u) return;
        u.g.settings.cut = giftSetBranch(u.g.settings.cut, b, on);
        this.giftRender();
    },

    /** The phone's own screen with the full preview and the branches (open), or back to step 2 (closed). */
    giftBranchesScreen(open: boolean): void {
        const u = ui;
        if (!u) return;
        u.closePicker?.();
        u.branchesScreen = open;
        this.giftRender();
        const pane = document.getElementById('gift-pane');
        if (pane) pane.scrollTop = 0;
        if (!open) document.querySelector<HTMLElement>(`#${GIFT_MODAL_ID} [data-gk="branches-open"]`)?.focus({ preventScroll: true });
    },

    /** The siblings of the ancestors by generation: a box (their family in), the relation, the counts. */
    giftBranchList(info: GiftCutInfo): HTMLElement {
        const u = ui!;
        const T = strings.giftTree.cut;
        const list = el('div', 'gift-brl');
        if (!info.branches.length) {
            list.appendChild(el('p', 'gift-faint gift-br-none', T.noBranches));
            return list;
        }
        let gen = -1;
        let group: HTMLElement | null = null;
        for (const b of info.branches) {
            if (b.generation !== gen || !group) {
                gen = b.generation;
                const title = el('div', 'gift-br-g', T.branchGroup(gen));
                title.id = `gift-br-g-${gen}`;
                group = el('div', 'gift-br-list');
                group.setAttribute('role', 'group');
                group.setAttribute('aria-labelledby', title.id);
                list.append(title, group);
            }
            const p = u.data.persons[b.siblingId];
            const has = giftBranchAdds(b) > 0;
            const row = el(has ? 'label' : 'div', 'gift-br-r' + (has && !b.included ? ' is-off' : ''));
            row.dataset.id = b.siblingId;
            if (has) {
                const input = el('input');
                input.type = 'checkbox';
                input.checked = b.included;
                input.dataset.gk = `br-${b.siblingId}`;
                input.addEventListener('change', () => this.giftSetBranch(b, input.checked));
                row.appendChild(input);
            } else {
                row.appendChild(el('span', 'gift-br-x'));
            }
            const text = el('span', 'gift-br-t');
            text.appendChild(el('span', 'gift-br-n', p ? shownName(p) || '?' : '?'));
            const rel = branchRelation(u, b);
            const parts = [rel.kin, rel.path].filter(Boolean);
            const other = b.half && b.otherParentId ? u.data.persons[b.otherParentId] : undefined;
            if (other) parts.push(T.otherParent(other.gender ?? 'unknown', shownName(other) || '?'));
            if (parts.length) text.appendChild(el('span', 'gift-br-s', parts.join(' · ')));
            row.appendChild(text);
            const count = el('span', 'gift-br-c');
            count.innerHTML = !has
                ? `<b>${b.aloneCount}</b> · ${esc(T.branchAlone)}`
                : b.included
                    ? `<b>${b.familyCount}</b> ${esc(T.branchWith)}`
                    : `<b>${b.aloneCount}</b> · ${esc(T.branchWithN(b.familyCount))}`;
            row.appendChild(count);
            group!.appendChild(row);
        }
        return list;
    },

    /** Draw the preview into its place (`still`: the phone's small one, no controls). */
    giftMountPreview(host: HTMLElement, info: GiftCutInfo, sum: GiftSummary, still: boolean): void {
        const u = ui!;
        const T = strings.giftTree.cut;
        const G = strings.giftTree.guide;
        const model = previewModelOf(u, info);
        const n = info.ids.size;
        const num = (x: number): string => x.toLocaleString(lang());
        const top = n >= GIFT_CUT_LARGE_FROM
            ? `<b>${num(n)}</b> ${esc(G.persons(n))} · ${esc(T.previewMoves)}`
            : still
                ? `<b>${num(n)}</b> ${esc(G.persons(n))} · ${sum.generations} ${esc(G.generations(sum.generations))}`
                : `<b>${num(n)}</b> ${esc(G.persons(n))} · ${sum.generations} ${esc(G.generations(sum.generations))} · <b>${num(sum.living)}</b> ${esc(G.living(sum.living))}`;
        const branchOf = new Map(info.branches.map(b => [b.siblingId, b]));
        u.dropPreview = renderGiftPreview(host, {
            model, topHtml: top, label: T.previewLabel, still,
            view: u.view,
            onView: (v) => { if (ui) ui.view = v; },
            card: (id) => {
                const p = u.data.persons[id];
                return {
                    name: p ? shownName(p) || '?' : '?',
                    years: p ? yearsOf(p) : '',
                    initials: p ? personInitials(p.firstName, p.lastName) : '?',
                    female: p?.gender === 'female',
                };
            },
            stubTitle: (stub) => {
                if (stub.kind !== 'family') return `${T.stubOpenLabel} (${stub.count})`;
                const p = u.data.persons[stub.personId];
                return T.stubFamilyLabel(p ? shownName(p) || '?' : '?', stub.count);
            },
            onStub: (stub) => {
                const b = stub.kind === 'family' ? branchOf.get(stub.personId) : undefined;
                if (b) { this.giftSetBranch(b, true); return; }
                if (stub.kind !== 'family') { u.expanded.add(stub.key); this.giftRender(); }
            },
            menu: (id) => {
                const p = u.data.persons[id];
                if (!p) return null;
                const name = shownName(p) || '?';
                const items: Array<{ label: string; run: () => void }> = [];
                const b = branchOf.get(id);
                const adds = b ? giftBranchAdds(b) : 0;
                if (b && adds > 0) {
                    if (b.included) {
                        const rel = branchRelation(u, b);
                        const who = rel.kin ? `${rel.kin} ${name}` : name;
                        items.push({ label: T.menuRemove(who, adds), run: () => this.giftSetBranch(b, false) });
                    } else {
                        items.push({ label: T.menuAdd(adds), run: () => this.giftSetBranch(b, true) });
                    }
                }
                items.push({
                    label: T.menuFocus,
                    run: () => {
                        const stage = host.querySelector<HTMLElement>('.gift-prev-stage');
                        if (!ui?.view || !stage) return;
                        ui.view = giftPreviewCentreOn(model, ui.view, id, stage.clientWidth, stage.clientHeight);
                        this.giftRender();
                    },
                });
                return { title: name, items };
            },
            onMenu: (close) => { if (ui) ui.closePicker = close; },
            texts: { zoomIn: T.zoomIn, zoomOut: T.zoomOut, fit: T.zoomFit, fitLabel: T.zoomFitLabel },
        });
    },
});
