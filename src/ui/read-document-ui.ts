/**
 * "Read a document" (spec 013): photos, scans or a PDF of one document go to
 * the research's bridge, whose agent reads them (transcription, translation,
 * explanation). One dialog: input → progress → result, with the error states
 * in place of its content. The reading goes on with the dialog closed: the
 * research menu, a strip in the Research panel and the button's dot say how
 * far it is, a notice says when it is done.
 *
 * Nothing is kept in the tree: the app remembers only the ids of its last
 * readings (`read.recent`) and the number of readers chosen (`read.readers`).
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { PersonId } from '../types.js';
import { PersonPicker } from '../person-picker.js';
import { sha256OfBlob } from '../sha256.js';
import { originalTargets } from '../originals.js';
import { parseLiveBridge, researchSchemeUrl, LiveStatus } from '../research-link.js';
import { storedResearchBridge, announcedResearchScheme, researchLinksEnabled } from '../research-device.js';
import {
    ReadAccepts, LiveRead, ReadResult, ReadFailure, ReadFileRefusal, ReadState, ReadPage, ReadEntry, ReadRegion,
    readRunning, readSlow, readFileMime, readFileKind, readFileRefusals, readUsualMinutes, readDocYear, readPageImageUrl,
    putReadPage, startRead, fetchReadResult, readAgain, cancelRead, sanitizeLiveRead, READ_FEATURE,
} from '../research-read.js';
import {
    LineSeg, parseTranscript, parseBlock, lineRegion, lineAt, defaultEntryIndex, canPropose, resultSections, glossFlavor,
    entryName, variantCount, cropLayout,
} from '../read-result.js';
import { openImageViewer } from './image-viewer.js';
import { formatBytesShort } from './originals-ui.js';
import { onComputer, bridgeFailure } from './research-ui.js';
import { onBridgeStatus } from './research-sync-ui.js';
import { uiModule } from './module.js';

const DIALOG_ID = 'read-document-modal';
const RECENT_KEY = 'read.recent';
const READERS_KEY = 'read.readers';
const RECENT_MAX = 20;
const POLL_MS = 5000;
const NOTICE_MS = 10_000;
const NOTE_MAX = 500;
/** The explanation unfolded (`'1'`) or folded (`'0'`) in the result; unset: unfolded where there is room. */
const GLOSS_KEY = 'read.glossOpen';
/** Below this the result's scan is a strip over the text with the chosen entry's crop. */
const STRIP_QUERY = '(max-width: 900px), (max-width: 1024px) and (max-height: 500px) and (orientation: landscape)';

/** One inserted file (a page of the document). */
interface Page {
    key: number;
    file: File;
    mime: string;
    kind: string;
    /** An object URL for a picture the browser shows ('' = no preview: HEIC, PDF). */
    preview: string;
    /** Its SHA-256, once computed (on sending). */
    sha: string;
    /** Refused by the research itself (415, too large): it stays in the list with that reason. */
    refused: ReadFileRefusal | null;
}

/** What stands in place of the dialog's content. */
type ErrorKind = 'down' | 'not-ready' | 'older' | 'failed' | 'cancelled' | 'busy' | 'limit' | 'unreadable' | 'source' | 'held';

/** Why a source's reading cannot be shown (the `source` error: the source's own transcription stands in). */
export type SourceWhy = 'down' | 'older' | 'none' | 'archive' | 'unlinked' | 'computer' | 'other';

/** `propose`: the tree suggestion of the chosen entry; `written`: what the click wrote. */
export type Phase = 'input' | 'progress' | 'result' | 'error' | 'propose' | 'written';

export interface DialogState {
    phase: Phase;
    pages: Page[];
    personId: string;
    note: string;
    readers: 1 | 2;
    /** The reading shown (progress, result, its error). */
    readId: string;
    /** While the pages go: page k of n. */
    sending: { k: number; n: number } | null;
    /** The reading came to "comparing readings" (the step shows from then on). */
    sawChecking: boolean;
    startedAt: number;
    error: { kind: ErrorKind; failure?: ReadFailure; why?: string } | null;
    result: ReadResult | null;
    /** A quiet line over the content ("New reading cancelled; the previous result stands."). */
    notice: string;
    picker: PersonPicker | null;
    busy: boolean;
    /** The result's chosen entry (index into `entries`). */
    entry: number;
    /** The chosen transcription line of that entry (-1 = none). */
    line: number;
    /** The page shown on the scan (`pages[].n`). */
    page: number;
    /** A second reader started from the suggestion runs: the suggestion stays, the progress shows over it. */
    second: boolean;
    /** Opened from a source (its reading): when the result cannot be shown, the source's transcription stands in. */
    sourceId: string;
    /** The entry to show first (a source's `readingEntry`; '' = the usual choice). */
    entryId: string;
}

/** A reading the app started: shown as done in the menu and the panel until opened. */
interface RecentRead { id: string; opened: boolean; research: string }

let st: DialogState | null = null;

/** The open dialog's state (null: closed). For the suggestion's own module. */
export function readDialogState(): DialogState | null {
    return st;
}
let nextKey = 1;
/** The readings each research's bridge listed last (by research, then id). */
const readsByResearch = new Map<string, Map<string, LiveRead>>();
/** Results fetched in this page (for the notice, the menu's second line, the dialog). */
const results = new Map<string, ReadResult>();
/** Readings known from the research's history (`GET reads`) only: their origin and state for the dialog. */
const historyReads = new Map<string, LiveRead>();
/** Why a reading's result could not be fetched last (by id). */
const lastFailure = new Map<string, ReadFailure>();
/** Readings whose end was announced (once). */
const announced = new Set<string>();
let listening = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let pasteHandler: ((e: ClipboardEvent) => void) | null = null;
/** What the menu, the panel strip and the button last showed of the readings (redrawn when it changes). */
let drawnKey = '';
/** Lays the result's scan out again when its box changes size. */
let scanObserver: ResizeObserver | null = null;

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function readRecent(): RecentRead[] {
    try {
        const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
        if (!Array.isArray(raw)) return [];
        return raw.filter((r): r is RecentRead => !!r && typeof r === 'object' && typeof r.id === 'string')
            .map(r => ({ id: r.id, opened: !!r.opened, research: typeof r.research === 'string' ? r.research : '' }))
            .slice(0, RECENT_MAX);
    } catch {
        return [];
    }
}

function writeRecent(list: RecentRead[]): void {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch { /* not remembered */ }
}

function rememberRead(id: string, research: string): void {
    writeRecent([{ id, opened: false, research }, ...readRecent().filter(r => r.id !== id)]);
}

function markOpened(id: string): void {
    const list = readRecent();
    const rec = list.find(r => r.id === id);
    if (!rec || rec.opened) return;
    rec.opened = true;
    writeRecent(list);
}

function storedReaders(): 1 | 2 {
    try { return localStorage.getItem(READERS_KEY) === '2' ? 2 : 1; } catch { return 1; }
}

function storeReaders(n: 1 | 2): void {
    try { localStorage.setItem(READERS_KEY, String(n)); } catch { /* not remembered */ }
}

/** A long name shortened in the middle (the whole name in `title`). */
function middleName(name: string, max = 42): string {
    if (name.length <= max) return name;
    const tail = Math.floor((max - 1) / 3);
    return `${name.slice(0, max - 1 - tail)}…${name.slice(-tail)}`;
}

function previewable(mime: string): boolean {
    return mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp' || mime === 'image/gif';
}

function revoke(pages: readonly Page[]): void {
    for (const p of pages) if (p.preview) URL.revokeObjectURL(p.preview);
}

function finalState(state: ReadState): boolean {
    return !readRunning(state);
}

/** "křest, 1843" — the document's kind and year from its result ('' without one). */
function docLabel(res: ReadResult | null | undefined): string {
    if (!res) return '';
    const kinds = strings.read.kinds;
    const kind = kinds[res.doc.kind] ?? kinds.other;
    const year = readDocYear(res.doc.date);
    return year ? `${kind}, ${year}` : kind;
}

/** "2 readers, agree" (green) / "2 readers, 3 places differ" (amber) / "1 reader" (grey). */
function agreeTone(res: ReadResult): { tone: 'is-ok' | 'is-warn' | 'is-muted'; text: string } {
    const t = strings.read;
    const n = res.readers.ran || res.readers.asked;
    if (n < 2) return { tone: 'is-muted', text: t.oneReader };
    if (res.readers.agree === 'differ' || res.readers.agree === 'fixed') {
        return { tone: 'is-warn', text: t.differ(n, Math.max(1, variantCount(res.entries))) };
    }
    return { tone: 'is-ok', text: t.agree };
}

function agreeText(res: ReadResult): string {
    return agreeTone(res).text;
}

/** A language's name in the app's language ("Latin", "latinsky"). */
function langName(code: string): string {
    const base = code.toLowerCase().split('-')[0];
    const own = strings.read.langNames[base];
    if (own) return own;
    try {
        return new Intl.DisplayNames([getCurrentLanguage()], { type: 'language' }).of(code) ?? code;
    } catch {
        return code;
    }
}

function langNames(codes: readonly string[]): string {
    return codes.map(langName).join(' / ');
}

/** A transcription's span without its marks (for a sentence): `[?]` dropped, `[...]` as an ellipsis. */
function plainMarks(text: string): string {
    return text.replace(/\[\?\]/g, '').replace(/\[(?:\.{2,}|…)\]/g, '…').replace(/\s+/g, ' ').trim();
}

/** Transcription segments as HTML: shape and colour for every mark (dotted, a block, a slash). */
function segsHtml(segs: readonly LineSeg[]): string {
    const t = strings.read;
    return segs.map((sg): string => {
        switch (sg.t) {
            case 'text': return esc(sg.s);
            case 'uncertain':
                return `<mark class="uncertain" title="${esc(t.uncertain)}">${esc(sg.s || '?')}<span class="read-sr"> (${esc(t.uncertain)})</span></mark>`;
            case 'illegible': return `<span class="illegible" role="img" aria-label="${esc(t.illegibleSr)}">${esc(t.illegible)}</span>`;
            case 'sep': return '<span class="read-sep" aria-hidden="true"> | </span>';
            case 'variant':
                return `<span class="read-variant" title="${esc(t.variantNote(plainMarks(sg.at), plainMarks(sg.other)))}">`
                    + `<span class="read-variant-a">${segsHtml(sg.a)}</span><span class="read-variant-slash" aria-hidden="true">/</span>`
                    + `<span class="read-variant-b">${segsHtml(sg.b)}</span></span>`;
        }
    }).join('');
}

/** A region (fractions of the page) as absolute position in per cent. */
export function regionStyle(r: ReadRegion): string {
    const pc = (v: number): string => `${Math.round(v * 100000) / 1000}%`;
    return `left:${pc(r[0])};top:${pc(r[1])};width:${pc(r[2])};height:${pc(r[3])}`;
}

/** The explanation unfolded: as last chosen, else where the result has room for it. */
function glossOpen(): boolean {
    try {
        const v = localStorage.getItem(GLOSS_KEY);
        if (v === '1' || v === '0') return v === '1';
    } catch { /* storage off */ }
    return window.innerWidth > 1180;
}

/**
 * A crop of a read page as HTML: `region` (fractions; null = the whole page)
 * fitted into a `w` × `h` box. For a person's or an event's crop in a
 * suggestion (e.g. 96 × 34).
 */
export function readCropHtml(imageUrl: string, page: Pick<ReadPage, 'w' | 'h'> | null, region: ReadRegion | null, w: number, h: number, alt = ''): string {
    if (!imageUrl) return `<span class="read-crop read-crop--empty" style="width:${w}px;height:${h}px"></span>`;
    const ratio = page && page.w > 0 && page.h > 0 ? page.w / page.h : 0.75;
    const c = cropLayout(region, w, h, ratio, 0.01);
    return `<span class="read-crop" style="width:${w}px;height:${h}px"><img src="${esc(imageUrl)}" alt="${esc(alt)}" draggable="false"`
        + ` style="width:${c.width.toFixed(1)}px;height:${c.height.toFixed(1)}px;left:${c.left.toFixed(1)}px;top:${c.top.toFixed(1)}px"></span>`;
}

function whyReason(accepts: ReadAccepts): string {
    const t = strings.read;
    const reason = t.why[accepts.why] ?? t.why.other;
    if (accepts.why === 'limit' && accepts.resets) {
        const at = new Date(accepts.resets);
        if (Number.isFinite(at.getTime())) {
            return `${reason}, ${t.limitUntil(at.toLocaleTimeString(getCurrentLanguage(), { hour: '2-digit', minute: '2-digit' }))}`;
        }
    }
    return reason;
}

export const readDocumentMethods = uiModule({
    // ==================== WHEN IT IS OFFERED ====================

    /**
     * What the research reads now (`accepts.read` of its live status), or null:
     * not a computer, Safari, not a research tree, an archive or a research
     * waiting for its agent, a research that does not read (older), or its
     * bridge not answering.
     */
    readDocumentAccepts(): ReadAccepts | null {
        this.ensureReadListener();
        const link = this.researchOriginalsLink();
        if (!link || !onComputer() || bridgeFailure(null) === 'safari') return null;
        if (this.activeResearchArchive() || this.activeResearchAgentAway()) return null;
        return this.researchStatusOf(link.researchId)?.accepts?.read ?? null;
    },

    /** Reading can start now (no other reading running). */
    readDocumentReady(): boolean {
        const accepts = this.readDocumentAccepts();
        return !!accepts?.ready && !this.readRunningNow();
    },

    /** The research's readings as its bridge listed them last. */
    readsOfResearch(researchId: string): LiveRead[] {
        return Array.from(readsByResearch.get(researchId)?.values() ?? []);
    },

    /** The reading running in the open tree's research (the app's own first), or null. */
    readRunningNow(): LiveRead | null {
        const link = this.researchOriginalsLink();
        if (!link) return null;
        const running = this.readsOfResearch(link.researchId).filter(r => readRunning(r.state));
        return running.find(r => r.from === 'app') ?? running[0] ?? null;
    },

    /** A reading this app started that ended and was not opened yet (newest first), or null. */
    readUnopenedNow(): LiveRead | null {
        const link = this.researchOriginalsLink();
        if (!link) return null;
        const reads = readsByResearch.get(link.researchId);
        if (!reads) return null;
        for (const rec of readRecent()) {
            if (rec.opened) continue;
            const r = reads.get(rec.id);
            if (r && (r.state === 'done' || r.state === 'unreadable')) return r;
        }
        return null;
    },

    /**
     * The research menu's item, or null (not offered). Running: its state and a
     * dot; done and not opened: "Document read"; not ready: inactive with the
     * reason and a separate "Open research ↗".
     */
    readMenuEntry(): { label: string; sub: string; ai: boolean; disabled: boolean; dot: boolean; link?: { label: string; method: string } } | null {
        const accepts = this.readDocumentAccepts();
        if (!accepts) return null;
        const t = strings.read;
        const running = this.readRunningNow();
        if (running) {
            const sub = running.state === 'queued' ? t.menuQueued : t.menuRunningSub(running.done, running.readers);
            return { label: t.menuRunning, sub, ai: false, disabled: false, dot: true };
        }
        const unopened = this.readUnopenedNow();
        if (unopened?.state === 'done') {
            return { label: t.menuDone, sub: t.menuDoneSub(docLabel(results.get(unopened.id))), ai: false, disabled: false, dot: false };
        }
        if (unopened) return { label: t.menuUnreadable, sub: t.menuUnreadableSub, ai: false, disabled: false, dot: false };
        if (!accepts.ready) {
            return { label: t.menu, sub: t.menuNotNow(whyReason(accepts)), ai: true, disabled: true, dot: false,
                link: { label: t.openResearch, method: 'researchActionOpen' } };
        }
        return { label: t.menu, sub: t.menuSub, ai: true, disabled: false, dot: false };
    },

    // ==================== FOLLOWING THE READINGS ====================

    /** Listen to every status of a bridge (once): the readings it lists. */
    ensureReadListener(): void {
        if (listening) return;
        listening = true;
        onBridgeStatus((researchId, status) => this.onReadStatus(researchId, status));
        // A status that came before: its readings at once (no notice for what ended before).
        const link = this.researchOriginalsLink();
        const known = link ? this.researchStatusOf(link.researchId) : null;
        if (link && known) this.onReadStatus(link.researchId, known);
    },

    /** A status of a research's bridge: its readings, what ended, what to redraw. */
    onReadStatus(researchId: string, status: LiveStatus): void {
        const prev = readsByResearch.get(researchId) ?? new Map<string, LiveRead>();
        const next = new Map<string, LiveRead>();
        for (const r of status.reads ?? []) next.set(r.id, r);
        // A reading just started and not listed yet: kept until the bridge names it.
        if (st?.readId && !next.has(st.readId) && prev.get(st.readId) && readRunning(prev.get(st.readId)!.state)) {
            next.set(st.readId, prev.get(st.readId)!);
        }
        readsByResearch.set(researchId, next);
        this.readsChanged(researchId, prev);
    },

    /** The research's `read` event (following live): one reading's new state, at once. */
    noteReadEvent(researchId: string, data: unknown): void {
        const read = sanitizeLiveRead(data);
        if (!read) return;
        const prev = readsByResearch.get(researchId) ?? new Map<string, LiveRead>();
        const next = new Map(prev);
        // The event does not carry the expected time: the last one the status gave stays while it runs.
        const expect = prev.get(read.id)?.expectSecs;
        next.set(read.id, expect && read.expectSecs === undefined && readRunning(read.state) ? { ...read, expectSecs: expect } : read);
        readsByResearch.set(researchId, next);
        this.readsChanged(researchId, prev);
    },

    /** After new readings: announce what ended, follow it in the dialog, redraw the menu, the strip and the button. */
    readsChanged(researchId: string, prev: Map<string, LiveRead>): void {
        const reads = readsByResearch.get(researchId)!;
        const mine = new Set(readRecent().map(r => r.id));
        for (const r of reads.values()) {
            const before = prev.get(r.id);
            const shownHere = !!st && st.readId === r.id && !!document.getElementById(DIALOG_ID);
            if (shownHere) {
                if (!before || before.state !== r.state || before.done !== r.done || before.version !== r.version || before.entries !== r.entries) this.followReadInDialog(r);
                continue;
            }
            // Ended with the dialog closed (or showing something else): the notice, once.
            if (mine.has(r.id) && finalState(r.state) && (!before || readRunning(before.state)) && !announced.has(r.id)) {
                announced.add(r.id);
                void this.announceReadEnd(researchId, r);
            }
        }
        this.watchReads();
        this.refreshReadSurfaces();
    },

    /** Redraw the research menu, the panel strip and the button when what they show of the readings changed. */
    refreshReadSurfaces(): void {
        const running = this.readRunningNow();
        const unopened = this.readUnopenedNow();
        const key = [running?.id ?? '', running?.state ?? '', running?.done ?? '', unopened?.id ?? '', unopened?.state ?? '',
            unopened ? docLabel(results.get(unopened.id)) : '', this.readDocumentAccepts()?.ready ?? ''].join('|');
        if (key === drawnKey) return;
        drawnKey = key;
        setTimeout(() => {
            this.refreshResearchMenu();
            if (document.getElementById('live-panel')) this.renderLivePanel();
        }, 0);
    },

    /** Ask the bridge every few seconds while a reading runs or the dialog is open (the event stream may be off). */
    watchReads(): void {
        const link = this.researchOriginalsLink();
        const needed = !!link && (!!document.getElementById(DIALOG_ID) || this.readsOfResearch(link.researchId).some(r => readRunning(r.state)));
        if (!needed) {
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            return;
        }
        if (pollTimer) return;
        pollTimer = setInterval(() => {
            const l = this.researchOriginalsLink();
            if (!l) { this.watchReads(); return; }
            void this.askResearchBridge(l.researchId, POLL_MS).then(() => {
                if (st && document.getElementById(DIALOG_ID) && (st.phase === 'input' || st.phase === 'error')) this.refreshReadGate();
                if (st?.phase === 'propose') this.refreshReadProposeFoot();
                this.watchReads();
            });
        }, POLL_MS);
    },

    /** The notice when a reading of this app ended with the dialog closed. */
    async announceReadEnd(researchId: string, r: LiveRead): Promise<void> {
        const t = strings.read;
        const show = { label: t.show, run: () => this.showReadDocumentDialog({ readId: r.id }) };
        if (r.state === 'done') {
            const res = await this.loadReadResult(researchId, r.id);
            const parts = res ? [docLabel(res), agreeText(res)].filter(Boolean).join(' · ') : '';
            this.showToast(t.notice(parts), NOTICE_MS, { action: show, hold: true, kind: 'read' });
            this.refreshReadSurfaces();
        } else if (r.state === 'unreadable') {
            this.showToast(t.noticeUnreadable, NOTICE_MS, { action: { ...show, label: t.showWhy }, hold: true, kind: 'read' });
        } else if (r.state === 'failed') {
            this.showToast(t.noticeFailed, NOTICE_MS, { action: show, hold: true, kind: 'read' });
        }
    },

    /** The bridge's base address (`http://127.0.0.1:<port>/<token>`) of a research, or ''. */
    readBridgeBase(researchId: string): string {
        return parseLiveBridge(storedResearchBridge(researchId)?.base)?.base ?? '';
    },

    /** A reading's result (cached once it is final). */
    async loadReadResult(researchId: string, id: string): Promise<ReadResult | null> {
        const cached = results.get(id);
        if (cached && finalState(cached.state)) return cached;
        const base = this.readBridgeBase(researchId);
        if (!base) return cached ?? null;
        const reply = await fetchReadResult(base, id);
        if (!reply.ok) {
            lastFailure.set(id, reply.failure);
            return cached ?? null;
        }
        lastFailure.delete(id);
        results.set(id, reply.value);
        return reply.value;
    },

    // ==================== THE STRIP IN THE RESEARCH PANEL ====================

    /** Under the panel's head, above "Elsewhere": the running reading, or one read and not opened yet. */
    appendReadStrip(panel: HTMLElement): void {
        const t = strings.read;
        const running = this.readRunningNow();
        const unopened = running ? null : this.readUnopenedNow();
        const r = running ?? unopened;
        if (!r) return;
        const strip = document.createElement('div');
        strip.className = 'rs-elsewhere rs-elsewhere--panel read-strip';
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'rs-elsewhere__row read-strip__row';
        row.id = 'read-strip';
        const dot = document.createElement('span');
        dot.className = `read-strip__dot${running ? ' is-running' : r.state === 'done' ? ' is-done' : ' is-warn'}`;
        dot.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'rs-elsewhere__label read-strip__label';
        label.textContent = running
            ? (running.state === 'queued' ? t.stripQueued : t.stripRunning)
            : r.state === 'done' ? t.stripDone : r.state === 'unreadable' ? t.stripUnreadable : t.stripFailed;
        const name = document.createElement('span');
        name.className = 'rs-elsewhere__name read-strip__name';
        const what = running
            ? [running.readers >= 2 ? t.stripReaders(running.done, running.readers) : '', running.name].filter(Boolean).join(' · ')
            : docLabel(results.get(r.id)) || r.name;
        name.textContent = what;
        if (what) name.title = what;
        const chev = document.createElement('span');
        chev.className = 'rs-elsewhere__chev';
        chev.textContent = '›';
        chev.setAttribute('aria-hidden', 'true');
        row.append(dot, label, name, chev);
        row.setAttribute('aria-label', [label.textContent, what].filter(Boolean).join(', '));
        row.onclick = () => this.showReadDocumentDialog({ readId: r.id });
        strip.appendChild(row);
        panel.appendChild(strip);
    },

    // ==================== THE DIALOG ====================

    /**
     * Open the dialog: with files (a drop) or a person (its menu) in the input;
     * with a reading's id (the notice, the strip) on that reading; else on the
     * running reading, the one read and not opened, or a new input.
     */
    showReadDocumentDialog(opts: { personId?: string; files?: File[]; readId?: string; read?: LiveRead; sourceId?: string; entryId?: string } = {}): void {
        const link = this.researchOriginalsLink();
        // A source's reading opens without a research too: its transcription then stands in.
        const source = opts.sourceId ? DataManager.getData().sources?.[opts.sourceId] : undefined;
        const sourceRead = source?.reading ?? '';
        if (!link && !sourceRead) return;
        this.closeActionsMenu();
        this.hideContextMenu?.();
        if (this.isResearchMenuOpen?.()) this.closeResearchMenu();
        this.ensureReadListener();
        // Already open: files dropped on it again join its pages.
        if (st && document.getElementById(DIALOG_ID)) {
            if (opts.files?.length && st.phase === 'input') this.addReadFiles(opts.files);
            return;
        }
        const readId = sourceRead || opts.readId || '';
        if (opts.read && opts.read.id === readId) historyReads.set(readId, opts.read);
        const target = !link ? null : readId
            // Not listed live any more (an older reading of the history): as the history said it.
            ? this.readsOfResearch(link.researchId).find(r => r.id === readId) ?? (opts.read?.id === readId ? opts.read : null)
            : opts.files?.length || opts.personId ? null : this.readRunningNow() ?? this.readUnopenedNow();
        if (!target && !readId && !this.readDocumentAccepts()) return;
        st = {
            phase: 'input', pages: [], personId: opts.personId ?? '', note: '', readers: storedReaders(), readId: '',
            sending: null, sawChecking: false, startedAt: Date.now(), error: null, result: results.get(readId) ?? null,
            notice: '', picker: null, busy: false, entry: 0, line: -1, page: 1, second: false,
            sourceId: sourceRead ? opts.sourceId ?? '' : '', entryId: sourceRead ? source?.readingEntry ?? '' : opts.entryId ?? '',
        };
        const overlay = document.createElement('div');
        overlay.id = DIALOG_ID;
        overlay.className = 'modal-overlay active';
        // Opened over a dialog that stands higher than the usual (a source's detail): above it.
        const under = Array.from(document.querySelectorAll<HTMLElement>('.modal-overlay.active'))
            .reduce((max, el) => Math.max(max, Number(getComputedStyle(el).zIndex) || 0), 0);
        if (under > 200) overlay.style.zIndex = String(under + 1);
        document.body.appendChild(overlay);
        this.pushDialog(DIALOG_ID);
        pasteHandler = (e: ClipboardEvent) => {
            if (!st || st.phase !== 'input') return;
            const files = Array.from(e.clipboardData?.files ?? []);
            if (files.length === 0) return;
            e.preventDefault();
            this.addReadFiles(files);
        };
        document.addEventListener('paste', pasteHandler);
        const blocked = sourceRead ? this.readSourceBlocked() : null;
        if (blocked) {
            st.readId = readId;
            st.phase = 'error';
            st.error = { kind: 'source', why: blocked };
            this.renderReadDialog();
        } else if (target || readId) {
            st.readId = target?.id ?? readId;
            st.phase = 'progress';
            if (target) this.followReadInDialog(target);
            else void this.openReadResult(st.readId);
        } else {
            if (opts.files?.length) this.addReadFiles(opts.files, false);
            this.renderReadDialog();
        }
        this.watchReads();
    },

    /** A source's reading result (its link in the source's detail and a person's sources). */
    showReadingOfSource(sourceId: string): void {
        this.showReadDocumentDialog({ sourceId });
    },

    /** Why a source's reading cannot be fetched now at all (null: ask the research). */
    readSourceBlocked(): SourceWhy | null {
        const link = this.researchOriginalsLink();
        if (!link) return this.researchSyncLink() && researchLinksEnabled() && !onComputer() ? 'computer' : 'unlinked';
        if (this.activeResearchAgentless()) return 'archive';
        if (!this.researchBridgeUp(link.researchId) || !this.readBridgeBase(link.researchId)) return 'down';
        // An older research has no reading results to give (`GET read/<id>` is an unknown path there).
        const status = this.researchStatusOf(link.researchId);
        if (status && !status.features?.includes(READ_FEATURE) && !status.accepts?.read) return 'older';
        return null;
    },

    /** Close the dialog (a running reading goes on). */
    closeReadDocumentDialog(): void {
        document.getElementById(DIALOG_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== DIALOG_ID);
        if (pasteHandler) document.removeEventListener('paste', pasteHandler);
        pasteHandler = null;
        if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
        scanObserver?.disconnect();
        scanObserver = null;
        if (st) {
            st.picker?.destroy();
            revoke(st.pages);
        }
        st = null;
        this.resetReadPropose();
        this.watchReads();
        this.refreshReadSurfaces();
    },

    /** Files picked, dropped or pasted: pages in order (a refused one stays with its reason). */
    addReadFiles(files: File[], render = true): void {
        if (!st) return;
        for (const file of files) {
            const mime = readFileMime(file);
            st.pages.push({ key: nextKey++, file, mime, kind: readFileKind(file), preview: previewable(mime) ? URL.createObjectURL(file) : '', sha: '', refused: null });
        }
        st.notice = '';
        if (render) this.renderReadDialog();
    },

    /** The pages' refusals: the research's own first, then its kinds, size and count (in order). */
    readPageRefusals(): (ReadFileRefusal | null)[] {
        const accepts = this.researchReadAcceptsAny();
        if (!st) return [];
        if (!accepts) return st.pages.map(p => p.refused);
        const open = st.pages.filter(p => !p.refused);
        const r = readFileRefusals(open.map(p => ({ type: p.mime, name: p.file.name, size: p.file.size })), accepts);
        let i = 0;
        return st.pages.map(p => p.refused ?? r[i++] ?? null);
    },

    /** What the research reads, live or as it said last (the dialog keeps its limits while the bridge is away). */
    researchReadAcceptsAny(): ReadAccepts | null {
        const link = this.researchOriginalsLink();
        if (!link) return null;
        return this.researchStatusOf(link.researchId)?.accepts?.read ?? this.researchAcceptsOf(link.researchId)?.read ?? null;
    },

    /** What stands in the way of reading now, in the input (null: nothing). */
    readInputGate(): ErrorKind | null {
        const link = this.researchOriginalsLink();
        if (!link) return 'down';
        const status = this.researchStatusOf(link.researchId);
        if (!status || !this.researchBridgeUp(link.researchId)) return 'down';
        const accepts = status.accepts?.read;
        if (!accepts) return 'older';
        if (!accepts.ready) return 'not-ready';
        return null;
    },

    /** After a status with the input or an error shown: its gate again (a bridge back, a research updated). */
    refreshReadGate(): void {
        if (!st) return;
        if (st.phase === 'error' && st.error?.kind === 'source' && (st.error.why === 'down' || st.error.why === 'older')) {
            const why = this.readSourceBlocked();
            if (!why) {
                st.phase = 'progress';
                st.error = null;
                void this.openReadResult(st.readId);
            } else if ((why === 'down' || why === 'older') && why !== st.error.why) {
                st.error = { kind: 'source', why };
                this.renderReadDialog();
            }
            return;
        }
        if (st.phase === 'error' && st.error && ['down', 'not-ready', 'older'].includes(st.error.kind)) {
            if (!this.readInputGate()) {
                st.phase = 'input';
                st.error = null;
                this.renderReadDialog();
            }
            return;
        }
        if (st.phase === 'input') {
            const gate = this.readInputGate();
            if (gate) {
                st.phase = 'error';
                st.error = { kind: gate };
                this.renderReadDialog();
            }
        }
    },

    // ==================== RENDERING ====================

    renderReadDialog(): void {
        const overlay = document.getElementById(DIALOG_ID);
        if (!overlay || !st) return;
        if (st.phase === 'input') {
            const gate = this.readInputGate();
            if (gate) { st.phase = 'error'; st.error = { kind: gate }; }
        }
        st.picker?.destroy();
        st.picker = null;
        scanObserver?.disconnect();
        scanObserver = null;
        const link = this.researchOriginalsLink();
        const tree = link ? TreeManager.getTreeMetadata(link.treeId)?.name ?? '' : '';
        const t = strings.read;
        let title = t.title;
        let sub = t.sub(tree);
        let subHtml = '';
        let body = '';
        let foot = '';
        let wide = false;
        let headLead = '';
        if (st.phase === 'input') {
            body = this.readInputHtml();
            foot = this.readInputFootHtml();
        } else if (st.phase === 'progress') {
            const live = this.readLiveOf(st.readId);
            title = t.progressTitle;
            // The dialog's own files name it first: a page the research already had comes back under its hash.
            sub = t.progressSub(st.pages.find(p => !p.refused)?.file.name || live?.name || '', live?.pages || st.pages.filter(p => !p.refused).length);
            body = this.readProgressHtml();
            foot = this.readProgressFootHtml();
        } else if ((st.phase === 'propose' || st.phase === 'written') && st.result) {
            const view = this.readProposeView(link ? this.readBridgeBase(link.researchId) : '');
            title = view.title;
            sub = view.sub;
            body = view.body;
            foot = view.foot;
            wide = view.wide;
            headLead = view.lead;
        } else if (st.phase === 'result' && st.result) {
            title = this.readResultTitle(st.result);
            subHtml = this.readResultSubtitle(st.result);
            body = this.readResultHtml(st.result, link ? this.readBridgeBase(link.researchId) : '');
            foot = this.readResultFootHtml();
            wide = true;
        } else {
            body = this.readErrorHtml();
            foot = this.readErrorFootHtml();
            if (st.error?.kind === 'source') {
                const src = DataManager.getData().sources?.[st.sourceId];
                title = src?.title || t.sourceLink.replace(/…$/, '');
                sub = tree;
            }
        }
        overlay.innerHTML = `
            <div class="modal batch-dialog read-dialog${wide ? ' read-dialog--wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="read-title" data-phase="${st.phase}">
                <div class="modal-header batch-header">
                    ${headLead}<div class="audit-log-heading">
                        <h2 id="read-title">${esc(title)}</h2>
                        <div class="audit-log-subtitle${subHtml ? ' read-result-sub' : ''}">${subHtml || esc(sub)}</div>
                    </div>
                    <button type="button" class="close-btn" data-act="close" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                ${st.notice ? `<p class="read-notice" role="status">${esc(st.notice)}</p>` : ''}
                <div class="modal-content batch-content read-content${wide ? ' read-content--result' : ''}">${body}</div>
                <div class="buttons batch-footer read-footer${wide || st.phase === 'written' ? ' read-footer--result' : ''}">${foot}</div>
            </div>`;
        this.wireReadDialog(overlay);
        this.tickReadProgress();
    },

    readInputHtml(): string {
        const s = st!;
        const t = strings.read;
        const accepts = this.researchReadAcceptsAny();
        const types = accepts?.types ?? [];
        const kinds = types.map(m => readFileKind({ type: m, name: '' })).join(', ');
        const limits = accepts ? t.limits(kinds, accepts.pages, Math.round(accepts.max / 1024 / 1024)) : '';
        const accept = [...types, ...types.includes('image/heic') ? ['.heic', '.heif'] : []].join(',');
        let top: string;
        if (s.pages.length === 0) {
            top = `
                <div class="read-drop" id="read-drop">
                    <div class="read-drop-title">${esc(t.drop)}</div>
                    <div class="read-drop-sub">${esc(t.dropSub)}</div>
                    <button type="button" class="secondary read-pick" data-act="pick">${esc(t.pick)}</button>
                    ${limits ? `<div class="read-limits">${esc(limits)}</div>` : ''}
                </div>`;
        } else {
            const refusals = this.readPageRefusals();
            const taken = s.pages.filter((_, i) => !refusals[i]);
            const size = taken.reduce((sum, p) => sum + p.file.size, 0);
            top = `
                <div class="read-pages-head">
                    <span class="read-pages-title">${esc(t.pagesTitle)}</span>
                    <span class="read-pages-sum">${esc(t.pagesSummary(taken.length, formatBytesShort(size)))}</span>
                    <span class="read-pages-hint">${esc(t.pagesHint)}</span>
                </div>
                <ol class="read-pages" id="read-pages">${this.readPageRowsHtml(refusals)}</ol>
                <div class="read-more" id="read-drop">
                    <span>${esc(t.dropMore)}</span>
                    <button type="button" class="research-sync-link read-pick-more" data-act="pick">${esc(t.pickMore)}</button>
                </div>`;
        }
        const readers = (accepts?.readers ?? 1) >= 2 ? `
                <fieldset class="read-readers">
                    <legend>${esc(t.readers)}</legend>
                    ${([1, 2] as const).map(n => `
                    <label class="read-reader${s.readers === n ? ' is-checked' : ''}">
                        <input type="radio" name="read-readers" value="${n}"${s.readers === n ? ' checked' : ''}>
                        <span class="read-reader-text"><strong>${esc(n === 1 ? t.r1 : t.r2)}</strong><span>${esc(n === 1 ? t.r1Sub : t.r2Sub)}</span></span>
                    </label>`).join('')}
                </fieldset>` : '';
        const slow = readSlow(accepts?.expectSecs) ? `<p class="read-slow-note">${esc(t.slowReader)}</p>` : '';
        return `
                ${top}
                ${slow}
                <input type="file" id="read-input" multiple accept="${esc(accept)}" hidden>
                <div class="read-fields">
                    <div class="batch-field"><span id="read-person-label">${esc(t.person)} <span class="batch-optional">${esc(t.optional)}</span></span>
                        <div id="read-person-picker" class="read-person-picker"></div></div>
                    <label class="batch-field"><span>${esc(t.note)} <span class="batch-optional">${esc(t.optional)}</span></span>
                        <textarea id="read-note" rows="2" maxlength="${NOTE_MAX}" placeholder="${esc(t.notePlaceholder)}">${esc(s.note)}</textarea></label>
                </div>
                ${readers}`;
    },

    readPageRowsHtml(refusals: (ReadFileRefusal | null)[]): string {
        const s = st!;
        const t = strings.read;
        let n = 0;
        return s.pages.map((p, i) => {
            const refusal = refusals[i];
            const name = p.file.name || p.kind;
            const size = formatBytesShort(p.file.size);
            const thumb = p.preview
                ? `<img src="${esc(p.preview)}" alt="" draggable="false">`
                : `<span class="read-tile"><strong>${esc(p.kind)}</strong><small>${esc(t.noPreview)}</small></span>`;
            if (refusal) {
                const why = refusal.kind === 'type' ? `${t.errType(refusal.type)} ${t.asMaterial}`
                    : refusal.kind === 'size' ? t.errSize(refusal.mb, refusal.maxMb) : t.errPages(refusal.pages);
                return `
                    <li class="read-page is-refused" data-key="${p.key}">
                        <span class="read-grip" aria-hidden="true"></span>
                        <span class="read-thumb">${thumb}</span>
                        <span class="read-page-text">
                            <span class="read-page-name" title="${esc(name)}">${esc(middleName(name))}</span>
                            <span class="read-page-why">${esc(why)}</span>
                            <span class="read-page-meta">${esc(t.refusedLine(p.kind, size))}</span>
                        </span>
                        <span class="read-page-actions">
                            <button type="button" class="research-sync-link read-remove" data-act="remove" data-key="${p.key}" aria-label="${esc(t.removeSr(name))}">${esc(t.remove)}</button>
                        </span>
                    </li>`;
            }
            n++;
            const first = n === 1;
            const last = !s.pages.slice(i + 1).some((_, j) => !refusals[i + 1 + j]);
            return `
                    <li class="read-page" data-key="${p.key}" draggable="true" tabindex="0" aria-label="${esc(`${t.pageLine(n, p.kind, size)}, ${name}`)}">
                        <span class="read-grip" aria-hidden="true">⋮⋮</span>
                        <span class="read-thumb">${thumb}</span>
                        <span class="read-page-text">
                            <span class="read-page-name" title="${esc(name)}">${esc(middleName(name))}</span>
                            <span class="read-page-meta">${esc(t.pageLine(n, p.kind, size))}</span>
                            ${p.preview ? '' : `<span class="read-page-meta">${esc(t.noPreviewSub)}</span>`}
                        </span>
                        <span class="read-page-actions">
                            <button type="button" class="read-icon-btn" data-act="up" data-key="${p.key}" aria-label="${esc(t.moveUp(name))}"${first ? ' disabled' : ''}>↑</button>
                            <button type="button" class="read-icon-btn" data-act="down" data-key="${p.key}" aria-label="${esc(t.moveDown(name))}"${last ? ' disabled' : ''}>↓</button>
                            <button type="button" class="read-icon-btn" data-act="remove" data-key="${p.key}" aria-label="${esc(t.removeSr(name))}">×</button>
                        </span>
                    </li>`;
        }).join('');
    },

    readInputFootHtml(): string {
        const s = st!;
        const t = strings.read;
        const refusals = this.readPageRefusals();
        const taken = s.pages.filter((_, i) => !refusals[i]).length;
        const refused = s.pages.length - taken;
        const note = taken > 0
            ? `<strong>${esc(t.footSum(taken, s.readers))}</strong> ${esc(t.usual(readUsualMinutes(s.readers, this.researchReadAcceptsAny()?.expectSecs)))}${refused ? ` · ${esc(t.refusedNotSent)}` : ''}`
            : '';
        return `
                <div class="batch-foot-note" id="read-foot-note">${note}</div>
                <button type="button" class="secondary" data-act="close">${esc(t.close)}</button>
                <button type="button" class="primary" data-act="read"${taken === 0 || s.busy ? ' disabled' : ''}>${esc(t.read)}</button>`;
    },

    /** The reading as the bridge listed it last (null: not listed). */
    readLiveOf(id: string): LiveRead | null {
        const link = this.researchOriginalsLink();
        if (!link || !id) return null;
        return readsByResearch.get(link.researchId)?.get(id) ?? historyReads.get(id) ?? null;
    },

    /** How long a reading takes (seconds): the bridge's word for it, else what the research said before it started. */
    readExpectSecs(live: LiveRead | null): number | undefined {
        return live?.expectSecs ?? this.researchReadAcceptsAny()?.expectSecs;
    },

    /**
     * Whether the agent itself is slow (the several-minutes line). While queued
     * the bridge's time includes the wait for the readings before it, so only
     * the research's word for one reading counts there.
     */
    readSlowNow(live: LiveRead | null): boolean {
        return readSlow(live?.state === 'queued' ? this.researchReadAcceptsAny()?.expectSecs : this.readExpectSecs(live));
    },

    readProgressHtml(): string {
        const s = st!;
        const t = strings.read;
        const live = this.readLiveOf(s.readId);
        const state: ReadState | 'sending' = s.sending ? 'sending' : live?.state ?? 'queued';
        if (state === 'checking') s.sawChecking = true;
        const readers = live?.readers || s.readers;
        const first = s.pages.find(p => !p.refused);
        const thumb = first?.preview
            ? `<img src="${esc(first.preview)}" alt="">`
            : `<span class="read-tile"><strong>${esc(first?.kind ?? '')}</strong></span>`;
        const step = (mark: 'done' | 'now' | 'wait', text: string, extra = ''): string =>
            `<li class="read-step is-${mark}"><span class="read-step-mark" aria-hidden="true">${mark === 'done' ? '✓' : ''}</span>`
            + `<span class="read-step-body"><span class="read-step-text">${esc(text)}</span>${extra}</span></li>`;
        const sendingText = s.sending ? t.sendingPage(s.sending.k, s.sending.n) : state === 'queued' ? t.queued : t.sent;
        const sendMark = state === 'sending' ? 'now' : state === 'queued' ? 'now' : 'done';
        const readMark = state === 'reading' ? 'now' : state === 'checking' || state === 'done' ? 'done' : 'wait';
        const done = live?.done ?? 0;
        const bar = readers >= 2 && (state === 'reading' || state === 'checking')
            ? `<span class="read-step-sub">${esc(t.readersDone(done, readers))}</span>`
              + `<span class="batch-bar read-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${readers}" aria-valuenow="${done}" aria-label="${esc(t.readersDone(done, readers))}"><span style="width:${Math.round(done / readers * 100)}%"></span></span>`
            : '';
        const steps = [
            step(sendMark, sendingText),
            step(readMark, readMark === 'done' ? t.readDone : t.reading, bar),
            ...(s.sawChecking ? [step(state === 'checking' ? 'now' : 'done', t.checking)] : []),
        ].join('');
        return `
                <div class="read-progress">
                    <div class="read-progress-thumb">${thumb}</div>
                    <ol class="read-steps">${steps}</ol>
                </div>
                <p class="read-progress-time" id="read-progress-time"></p>
                <p class="read-progress-expect" id="read-progress-expect"${this.readSlowNow(live) ? '' : ' hidden'}>${esc(t.slowReader)}</p>
                <p class="read-progress-slow" id="read-progress-slow" hidden>${esc(t.slow)}</p>
                <p class="read-progress-note">${esc(t.closeNote)}</p>
                ${this.readSoFarHtml()}`;
    },

    /** While it reads: the entries read so far (a result that grows), with their marks. */
    readSoFarHtml(): string {
        const sofar = st ? results.get(st.readId) : undefined;
        if (!sofar || !readRunning(sofar.state) || sofar.entries.length === 0) return '';
        const entries = sofar.entries.map(e => `<div class="read-sofar-entry">${parseTranscript(e).lines
            .map(l => `<div class="read-sofar-line">${segsHtml(l.segs)}</div>`).join('')}</div>`).join('');
        return `<section class="read-sofar" aria-live="polite"><h3 class="read-section-title">${esc(strings.read.soFar(sofar.entries.length))}</h3>${entries}</section>`;
    },

    readProgressFootHtml(): string {
        const s = st!;
        const t = strings.read;
        const live = this.readLiveOf(s.readId);
        // Readings started in the research (its agent, the terminal) are not cancelled from here.
        const cancel = s.readId && !s.sending && live?.from !== 'research'
            ? `<button type="button" class="read-cancel" data-act="cancel"${s.busy ? ' disabled' : ''}>${esc(t.cancel)}</button>` : '';
        return `${cancel}<span class="batch-foot-note"></span>
                <button type="button" class="primary" data-act="close">${esc(t.closeKeep)}</button>`;
    },

    /** The elapsed time and the "taking longer" line (every second while the progress shows). */
    tickReadProgress(): void {
        const showing = st?.phase === 'progress' && !!document.getElementById('read-progress-time');
        if (!showing) {
            if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
            return;
        }
        const paint = (): void => {
            const s = st;
            const time = document.getElementById('read-progress-time');
            if (!s || !time || s.phase !== 'progress') { this.tickReadProgress(); return; }
            const live = this.readLiveOf(s.readId);
            const since = Date.parse(live?.since ?? '') || s.startedAt;
            const secs = Math.max(0, Math.floor((Date.now() - since) / 1000));
            const usual = readUsualMinutes(live?.readers || s.readers, this.readExpectSecs(live));
            time.textContent = strings.read.running(usual, strings.read.elapsed(Math.floor(secs / 60), secs % 60));
            const slow = document.getElementById('read-progress-slow');
            if (slow) slow.hidden = secs < usual * 60 * 2;
            // A new expected time from /status shows at once, not only at the next state.
            const expect = document.getElementById('read-progress-expect');
            if (expect) expect.hidden = !this.readSlowNow(live);
        };
        paint();
        if (!tickTimer) tickTimer = setInterval(paint, 1000);
    },

    /** The dialog follows its reading: progress, then the result or what went wrong. */
    followReadInDialog(r: LiveRead): void {
        if (!st) return;
        st.readId = r.id;
        if (r.state === 'checking') st.sawChecking = true;
        // What was written stays on screen whatever the reading does next.
        if (st.phase === 'written') return;
        if (readRunning(r.state) && st.phase === 'propose') {
            // A second reader from the suggestion: its progress over the suggestion, the choices kept.
            st.second = true;
            this.redrawReadPropose();
            return;
        }
        if (st.phase === 'propose' && r.state !== 'done') {
            // The second reading ended without a result: the first one's suggestion stays.
            st.second = false;
            st.notice = r.state === 'cancelled' ? strings.read.againCancelled : strings.read.failed;
            this.renderReadDialog();
            return;
        }
        if (readRunning(r.state)) {
            st.phase = 'progress';
            this.renderReadDialog();
            // Entries read so far show under the progress (the bridge gives the result as it grows).
            const link = this.researchOriginalsLink();
            const have = results.get(r.id)?.entries.length ?? 0;
            if (link && r.entries > have) {
                void this.loadReadResult(link.researchId, r.id).then(res => {
                    if (res && st && st.readId === r.id && st.phase === 'progress' && res.entries.length > have) this.renderReadDialog();
                });
            }
            return;
        }
        if (r.state === 'done') { void this.openReadResult(r.id); return; }
        st.second = false;
        markOpened(r.id);
        announced.add(r.id);
        st.phase = 'error';
        st.error = r.state === 'unreadable' ? { kind: 'unreadable' } : r.state === 'cancelled' ? { kind: 'cancelled' } : { kind: 'failed' };
        if (r.state === 'unreadable') {
            const link = this.researchOriginalsLink();
            if (link) {
                void this.loadReadResult(link.researchId, r.id).then(res => {
                    if (!st || st.readId !== r.id || st.error?.kind !== 'unreadable') return;
                    st.error.why = res?.doc.why ?? 'other';
                    this.renderReadDialog();
                });
            }
        }
        this.renderReadDialog();
        this.refreshReadSurfaces();
    },

    /** Fetch and show a reading's result (opened: off the menu and the strip). */
    async openReadResult(id: string): Promise<void> {
        const link = this.researchOriginalsLink();
        if (!link || !st) return;
        const res = await this.loadReadResult(link.researchId, id);
        if (!st || st.readId !== id) return;
        markOpened(id);
        announced.add(id);
        const failure = lastFailure.get(id);
        if (!res && st.sourceId) {
            // The source's own transcription stands in for what the research cannot give.
            st.phase = 'error';
            const why: SourceWhy = failure?.kind === 'none' ? (this.activeResearchAgentless() ? 'archive' : 'none')
                : !this.researchBridgeUp(link.researchId) ? 'down' : 'other';
            st.error = { kind: 'source', why, ...(failure ? { failure } : {}) };
        } else if (!res) {
            st.phase = 'error';
            st.error = { kind: this.researchBridgeUp(link.researchId) ? 'failed' : 'down', ...(failure ? { failure } : {}) };
        } else if ((res.state === 'failed' || res.state === 'cancelled') && st.phase !== 'propose' && st.phase !== 'written') {
            st.phase = 'error';
            st.error = st.sourceId ? { kind: 'source', why: 'other' } : { kind: res.state };
        } else if (res.state === 'unreadable') {
            st.phase = 'error';
            st.error = { kind: 'unreadable', why: res.doc.why ?? 'other' };
        } else if (st.phase === 'propose' || st.phase === 'written') {
            // The suggestion (or what was written) stays; a new result of the same entry refreshes the suggestion.
            const before = st.result;
            const entryId = before?.entries[st.entry]?.id;
            const k = res.entries.findIndex(e => e.id === entryId);
            const fresh = st.second;
            st.second = false;
            if (st.phase === 'propose' && k >= 0) {
                st.result = res;
                st.entry = k;
                st.page = res.entries[k].page;
                // Readers that agree on the entry: nothing is highlighted, so the notice says they agree.
                if (fresh && !st.notice) st.notice = res.entries[k].variants.length ? strings.read.secondDone : strings.read.secondAgree;
                this.refreshReadPropose(before);
            }
        } else {
            st.result = res;
            st.phase = 'result';
            const refn = this.readLiveOf(id)?.person
                || (st.personId ? originalTargets({ personId: st.personId as PersonId }, DataManager.getData()).person ?? '' : '');
            const chosen = st.entryId ? res.entries.findIndex(e => e.id === st!.entryId) : -1;
            st.entry = chosen >= 0 ? chosen : defaultEntryIndex(res.entries, refn);
            st.line = -1;
            st.page = res.entries[st.entry]?.page ?? res.pages[0]?.n ?? 1;
        }
        this.renderReadDialog();
        this.refreshReadSurfaces();
    },

    // ==================== THE RESULT ====================

    /** "Baptism entry, Latin, Kurrent, 1846": the document's kind, languages, script and year. */
    readResultTitle(res: ReadResult): string {
        const t = strings.read;
        const kind = t.kindTitles[res.doc.kind] ?? t.kindTitles.other;
        return [kind, langNames(res.doc.language), t.scripts[res.doc.script] ?? '', readDocYear(res.doc.date)].filter(Boolean).join(', ');
    },

    /** The result's subtitle (HTML): the file's name, then legibility and the readers as pills. */
    readResultSubtitle(res: ReadResult): string {
        const t = strings.read;
        const name = res.pages[0]?.name ?? '';
        const file = name
            ? `<span class="read-file" title="${esc(name)}">${esc(res.pages.length > 1 ? t.progressSub(middleName(name, 40), res.pages.length) : middleName(name, 48))}</span>` : '';
        const legible = res.doc.legible === 'yes' ? { tone: 'is-ok', text: t.legible }
            : { tone: 'is-warn', text: res.doc.legible === 'partly' ? t.partly : t.notLegible };
        const agree = agreeTone(res);
        return `${file}<span class="read-pills"><span class="read-pill ${legible.tone}" data-pill="legible">${esc(legible.text)}</span>`
            + `<span class="read-pill ${agree.tone}" data-pill="readers">${esc(agree.text)}</span></span>`;
    },

    /**
     * The result's body: the scan (left) and the text of the chosen entry
     * (right). `base` is the bridge's address: a page's image is
     * `readPageImageUrl(base, page)`.
     */
    readResultHtml(res: ReadResult, base: string): string {
        const s = st!;
        const entry = res.entries[s.entry] ?? null;
        return `
                <div class="read-result" id="read-result" data-read="${esc(res.id)}" data-entry="${s.entry}">
                    <div class="read-scan" id="read-scan">${this.readScanHtml(res, base)}</div>
                    <div class="read-text" id="read-text">${this.readTextHtml(res, entry)}</div>
                </div>`;
    },

    /** The page shown on the scan (the chosen entry's, or the one picked by its tab). */
    readShownPage(res: ReadResult): ReadPage | null {
        const s = st!;
        return res.pages.find(p => p.n === s.page) ?? res.pages[0] ?? null;
    },

    /** The scan: the entries' pills, the pages' tabs, the page with the entries' frames, the hint. */
    readScanHtml(res: ReadResult, base: string): string {
        const s = st!;
        const t = strings.read;
        const entries = res.entries;
        const page = this.readShownPage(res);
        const pageN = page?.n ?? s.page;
        const pills = entries.length >= 2 && s.phase === 'result'
            ? `<div class="read-entries" role="group" aria-label="${esc(t.entriesLabel)}">${entries.map((e, k) => {
                const name = entryName(e);
                return `<button type="button" class="read-entry-pill${k === s.entry ? ' is-selected' : ''}" data-act="entry" data-entry="${k}"`
                    + ` aria-pressed="${k === s.entry}" aria-label="${esc(t.entrySr(k + 1, name))}"><span class="read-entry-n">${k + 1}</span>`
                    + `${name ? `<span class="read-entry-name">${esc(middleName(name, 28))}</span>` : ''}</button>`;
            }).join('')}</div>` : '';
        const tabs = res.pages.length >= 2
            ? `<div class="read-page-tabs" role="group">${res.pages.map(p =>
                `<button type="button" class="read-page-tab${p.n === pageN ? ' is-selected' : ''}" data-act="page" data-page="${p.n}" aria-pressed="${p.n === pageN}">${esc(t.pageAlt(p.n))}</button>`).join('')}</div>`
            : '';
        const url = page && base ? readPageImageUrl(base, page) : '';
        const ratio = page && page.w > 0 && page.h > 0 ? `${page.w} / ${page.h}` : '3 / 4';
        const img = url
            ? `<img class="read-scan-img" src="${esc(url)}" alt="${esc(t.pageAlt(pageN))}" draggable="false">`
            : `<span class="read-scan-noimg">${esc(t.noImage)}</span>`;
        const variants = (entries[s.entry]?.variants.length ?? 0) > 0;
        const hint = s.phase === 'result' && (entries.length >= 2 || variants) ? `<p class="read-scan-hint">${esc(t.scanHint(variants))}</p>` : '';
        return `${pills}${tabs}
                    <div class="read-scan-box">
                        <div class="read-scan-view" id="read-scan-view">
                            <div class="read-scan-sheet" id="read-scan-sheet" style="aspect-ratio: ${ratio}">
                                ${img}
                                <div class="read-scan-marks" id="read-scan-marks">${this.readScanMarksHtml(res, pageN)}</div>
                            </div>
                        </div>
                        ${url ? `<button type="button" class="read-scan-open" data-act="open-page" aria-label="${esc(t.openPage)}" title="${esc(t.openPage)}"><span aria-hidden="true">⤢</span></button>` : ''}
                    </div>
                    ${hint}`;
    },

    /** The frames of the entries on a page (the chosen one solid), the lines that differ (amber), the shown line. */
    readScanMarksHtml(res: ReadResult, pageN: number): string {
        const s = st!;
        const t = strings.read;
        const many = res.entries.length >= 2;
        const frames = res.entries.map((e, k) => {
            if (e.page !== pageN || !e.region) return '';
            const name = entryName(e);
            return `<button type="button" class="read-frame${k === s.entry ? ' is-selected' : ''}" data-entry="${k}" style="${regionStyle(e.region)}"`
                + ` aria-label="${esc(t.entrySr(k + 1, name))}" aria-pressed="${k === s.entry}">`
                + `${many ? `<span class="read-frame-n" aria-hidden="true">${k + 1}</span>` : ''}</button>`;
        }).join('');
        const entry = res.entries[s.entry];
        let lines = '';
        if (entry?.region && entry.page === pageN) {
            const parsed = parseTranscript(entry);
            const n = parsed.lines.length;
            lines = parsed.lines.map((l, j) => l.variant
                ? `<span class="read-scan-var" data-line="${j}" style="${regionStyle(lineRegion(entry.region!, j, n))}"></span>` : '').join('');
        }
        return `${frames}${lines}<span class="read-scan-line" id="read-scan-line" hidden></span>`;
    },

    /** The text column: a partly legible note, then the sections the document's kind and its data give. */
    readTextHtml(res: ReadResult, entry: ReadEntry | null): string {
        const s = st!;
        const t = strings.read;
        const partial = res.doc.legible !== 'yes'
            ? `<div class="read-partial" role="note"><strong>${esc(t.partialLead)}</strong> ${esc(t.partialText(t.whyText[res.doc.why ?? 'other'] ?? t.whyText.other))}`
              + ` <button type="button" class="read-link" data-act="insert-other">${esc(t.betterPhoto)}</button></div>` : '';
        if (!entry) return `${partial}<p class="read-empty">${esc(t.noEntries)}</p>`;
        const sec = resultSections(res, entry, getCurrentLanguage());
        const parts: string[] = [partial];
        if (sec.transcript) {
            const parsed = parseTranscript(entry);
            const focusable = entry.region ? ' tabindex="0"' : '';
            const lines = parsed.lines.map((l, j) =>
                `<div class="read-line${l.variant ? ' has-variant' : ''}${j === s.line ? ' is-active' : ''}" data-line="${j}"${focusable}>${segsHtml(l.segs)}</div>`).join('');
            const legend: string[] = [];
            if (parsed.marks.uncertain) legend.push(`<li><span class="read-key read-key--uncertain" aria-hidden="true">a</span>${esc(t.uncertain)}</li>`);
            if (parsed.marks.variant) {
                for (const v of entry.variants.slice(0, 6)) {
                    legend.push(`<li><span class="read-key read-key--variant" aria-hidden="true">/</span>${esc(t.variantNote(plainMarks(v.at), plainMarks(v.other)))}</li>`);
                }
            }
            if (parsed.marks.illegible) legend.push(`<li><span class="read-key read-key--illegible" aria-hidden="true"></span>${esc(t.illegibleNote)}</li>`);
            const langs = langNames(res.doc.language);
            parts.push(`
                <section class="read-section read-section--transcript" aria-labelledby="read-s-transcript">
                    <div class="read-section-head">
                        <h3 class="read-section-title" id="read-s-transcript">${esc(sec.inscription ? t.sInscription : t.sTranscript)}</h3>
                        <span class="read-section-sub">${esc(t.transcriptSub(langs))}</span>
                        <button type="button" class="read-copy" data-act="copy">${esc(t.copy)}</button>
                    </div>
                    <div class="read-transcript" id="read-transcript">${lines}</div>
                    ${legend.length ? `<ul class="read-legend">${legend.join('')}</ul>` : ''}
                </section>`);
        }
        if (sec.translation) {
            parts.push(`
                <section class="read-section read-section--translation" aria-labelledby="read-s-translation">
                    <div class="read-section-head"><h3 class="read-section-title" id="read-s-translation">${esc(t.sTranslation)}</h3></div>
                    <div class="read-translation">${parseBlock(entry.translation).map(l => `<p>${segsHtml(l)}</p>`).join('')}</div>
                </section>`);
        }
        if (sec.gloss) {
            const flavor = glossFlavor(res.doc.kind);
            const n = entry.glossary.length;
            const sub = flavor === 'terms' ? (n ? t.glossTerms(n) : '') : flavor === 'symbols' ? t.glossSymbols : flavor === 'context' ? t.glossContext : '';
            const open = glossOpen();
            const items = entry.glossary.map(g => `<dt>${esc(g.term)}</dt><dd>${esc(g.meaning)}`
                + `${g.kind !== 'term' ? ` <span class="read-gloss-kind">${esc(t.glossKinds[g.kind] ?? g.kind)}</span>` : ''}</dd>`).join('');
            parts.push(`
                <section class="read-section read-section--gloss${open ? ' is-open' : ''}">
                    <div class="read-section-head">
                        <h3 class="read-section-title"><button type="button" class="read-gloss-toggle" data-act="gloss" aria-expanded="${open}" aria-controls="read-gloss-body">`
                            + `<span class="read-chev" aria-hidden="true"></span>${esc(t.sGloss)}</button></h3>
                        ${sub ? `<span class="read-section-sub">${esc(sub)}</span>` : ''}
                    </div>
                    <div class="read-gloss-body" id="read-gloss-body"${open ? '' : ' hidden'}>
                        ${items ? `<dl class="read-gloss">${items}</dl>` : ''}
                        ${sec.about ? `<h4 class="read-about-title">${esc(t.sAbout)}</h4><p class="read-about">${esc(res.context)}</p>` : ''}
                    </div>
                </section>`);
        }
        if (sec.mentioned) {
            const people = entry.persons.map(p => {
                const name = [p.given, p.surname].filter(Boolean).join(' ') || p.written;
                const role = p.role === 'mentioned' ? '' : p.roleText || t.roles[p.role] || '';
                const meta = [role, p.age, p.occupation, p.residence].filter(Boolean).join(' · ');
                return `<li><span class="read-person-name">${esc(name)}</span>${meta ? ` <span class="read-person-meta">${esc(meta)}</span>` : ''}</li>`;
            }).join('');
            parts.push(`
                <section class="read-section read-section--mentioned" aria-labelledby="read-s-mentioned">
                    <div class="read-section-head"><h3 class="read-section-title" id="read-s-mentioned">${esc(t.sMentioned)}</h3></div>
                    <ul class="read-mentioned">${people}</ul>
                </section>`);
        }
        return parts.join('');
    },

    readResultFootHtml(): string {
        const t = strings.read;
        const res = st?.result;
        const propose = canPropose(res?.entries[st?.entry ?? 0]);
        const another = this.readDocumentReady()
            ? `<button type="button" class="secondary" data-act="another">${esc(t.another)}</button>` : '';
        return `<span class="batch-foot-note read-kept">${esc(t.kept)}</span>${another}
                <button type="button" class="${propose ? 'secondary' : 'primary'}" data-act="close">${esc(t.close)}</button>
                ${propose ? `<button type="button" class="primary" data-act="propose">${esc(t.propose)}</button>` : ''}`;
    },

    /** Choose an entry: the whole result (scan, text, suggestion) follows it. */
    readSelectEntry(i: number): void {
        const s = st;
        const res = s?.result;
        if (!s || !res || !res.entries[i] || i === s.entry || s.phase !== 'result') return;
        s.entry = i;
        s.line = -1;
        s.page = res.entries[i].page;
        this.readRedrawResult(true);
    },

    /** Show another page of the document on the scan. */
    readSelectPage(n: number): void {
        const s = st;
        if (!s?.result || n === s.page || !s.result.pages.some(p => p.n === n)) return;
        s.page = n;
        this.readRedrawResult(false);
    },

    /** Redraw the scan, the text and the footer (the header stays). */
    readRedrawResult(textToTop: boolean): void {
        const overlay = document.getElementById(DIALOG_ID);
        const s = st;
        if (!overlay || !s?.result || s.phase !== 'result') return;
        const link = this.researchOriginalsLink();
        const scan = overlay.querySelector<HTMLElement>('#read-scan');
        const text = overlay.querySelector<HTMLElement>('#read-text');
        const foot = overlay.querySelector<HTMLElement>('.read-footer');
        const keep = text?.scrollTop ?? 0;
        overlay.querySelector('#read-result')?.setAttribute('data-entry', String(s.entry));
        if (scan) scan.innerHTML = this.readScanHtml(s.result, link ? this.readBridgeBase(link.researchId) : '');
        if (text) {
            text.innerHTML = this.readTextHtml(s.result, s.result.entries[s.entry] ?? null);
            text.scrollTop = textToTop ? 0 : keep;
        }
        if (foot) foot.innerHTML = this.readResultFootHtml();
        this.wireReadResult(overlay);
    },

    /** The result's own wiring: lines ↔ scan, frames, the scan's layout. */
    wireReadResult(overlay: HTMLElement): void {
        const s = st;
        if (!s?.result) return;
        scanObserver?.disconnect();
        scanObserver = null;
        const view = overlay.querySelector<HTMLElement>('#read-scan-view');
        const sheet = overlay.querySelector<HTMLElement>('#read-scan-sheet');
        const img = sheet?.querySelector<HTMLImageElement>('img');
        img?.addEventListener('load', () => this.layoutReadScan());
        img?.addEventListener('error', () => {
            img.replaceWith(Object.assign(document.createElement('span'), { className: 'read-scan-noimg', textContent: strings.read.noImage }));
            overlay.querySelector('.read-scan-open')?.remove();
        });
        overlay.querySelectorAll<HTMLElement>('.read-line[data-line]').forEach(line => {
            const j = Number(line.dataset.line);
            line.addEventListener('mouseenter', () => this.showReadScanLine(j));
            line.addEventListener('mouseleave', () => this.showReadScanLine(st?.line ?? -1));
            line.addEventListener('focus', () => this.showReadScanLine(j));
            line.addEventListener('blur', () => this.showReadScanLine(st?.line ?? -1));
            line.addEventListener('click', () => this.readSelectLine(j === st?.line ? -1 : j, false));
            line.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                this.readSelectLine(j === st?.line ? -1 : j, false);
            });
        });
        overlay.querySelectorAll<HTMLElement>('.read-frame').forEach(frame => frame.addEventListener('click', (e) => {
            const k = Number(frame.dataset.entry);
            const cur = st;
            if (!cur?.result) return;
            if (k !== cur.entry) { this.readSelectEntry(k); return; }
            const entry = cur.result.entries[k];
            if (!entry?.region || !sheet || e.detail === 0) return;
            const rect = sheet.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            const n = parseTranscript(entry).lines.length;
            const j = lineAt(entry.region, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, n);
            if (j >= 0) this.readSelectLine(j, true);
        }));
        if (view && typeof ResizeObserver !== 'undefined') {
            scanObserver = new ResizeObserver(() => this.layoutReadScan());
            scanObserver.observe(view);
        }
        this.layoutReadScan();
        this.showReadScanLine(s.line);
        this.readScrollScanToEntry();
    },

    /** A transcription line chosen (on the text or the scan): marked in both; -1 clears it. */
    readSelectLine(j: number, fromScan: boolean): void {
        const s = st;
        if (!s) return;
        s.line = j;
        const lines = document.querySelectorAll<HTMLElement>(`#${DIALOG_ID} .read-line[data-line]`);
        lines.forEach(l => l.classList.toggle('is-active', Number(l.dataset.line) === j));
        this.showReadScanLine(j);
        if (fromScan && j >= 0) {
            const line = document.querySelector<HTMLElement>(`#${DIALOG_ID} .read-line[data-line="${j}"]`);
            line?.scrollIntoView({ block: 'nearest' });
        }
    },

    /** The highlight of line `j` of the chosen entry on the scan (its region split evenly); -1 hides it. */
    showReadScanLine(j: number): void {
        const el = document.getElementById('read-scan-line');
        const s = st;
        if (!el || !s?.result) return;
        const entry = s.result.entries[s.entry];
        const page = this.readShownPage(s.result);
        if (j < 0 || !entry?.region || entry.page !== (page?.n ?? entry.page)) { el.hidden = true; return; }
        const parsed = parseTranscript(entry);
        el.hidden = false;
        el.setAttribute('style', regionStyle(lineRegion(entry.region, j, parsed.lines.length)));
        el.classList.toggle('is-variant', !!parsed.lines[j]?.variant);
    },

    /** Lay the page out: whole and scrollable beside the text, or the chosen entry's crop in the narrow strip. */
    layoutReadScan(): void {
        const s = st;
        const view = document.getElementById('read-scan-view');
        const sheet = document.getElementById('read-scan-sheet');
        if (!s?.result || !view || !sheet) return;
        const page = this.readShownPage(s.result);
        const img = sheet.querySelector('img');
        let ratio = page && page.w > 0 && page.h > 0 ? page.w / page.h : 0;
        if (!ratio && img && img.naturalWidth > 0 && img.naturalHeight > 0) {
            ratio = img.naturalWidth / img.naturalHeight;
            sheet.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
        }
        const strip = window.matchMedia(STRIP_QUERY).matches;
        view.classList.toggle('is-strip', strip);
        if (!strip) {
            sheet.style.width = sheet.style.height = sheet.style.left = sheet.style.top = '';
            return;
        }
        const entry = s.result.entries[s.entry];
        const region = entry && entry.page === page?.n ? entry.region : null;
        const c = cropLayout(region, view.clientWidth, view.clientHeight, ratio || 0.75);
        sheet.style.width = `${c.width}px`;
        sheet.style.height = `${c.height}px`;
        sheet.style.left = `${c.left}px`;
        sheet.style.top = `${c.top}px`;
    },

    /** Beside the text: scroll the page so the chosen entry's frame shows. */
    readScrollScanToEntry(): void {
        const view = document.getElementById('read-scan-view');
        const frame = view?.querySelector<HTMLElement>('.read-frame.is-selected');
        if (!view || !frame || view.classList.contains('is-strip')) return;
        const v = view.getBoundingClientRect();
        const f = frame.getBoundingClientRect();
        if (f.top >= v.top && f.bottom <= v.bottom) return;
        view.scrollTop += f.top - v.top - 24;
    },

    /** "Copy transcription": the chosen entry's text with its original marks (`[?]`, `[...]`). */
    async copyReadTranscript(): Promise<void> {
        const entry = st?.result?.entries[st.entry];
        if (!entry) return;
        try {
            await navigator.clipboard.writeText(entry.transcript);
            this.showToast(strings.read.copied);
        } catch {
            this.showToast(strings.read.copyFailed);
        }
    },

    /** The source's own transcription (when its reading cannot be shown). */
    async copySourceTranscript(): Promise<void> {
        const text = st ? DataManager.getData().sources?.[st.sourceId]?.transcript ?? '' : '';
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            this.showToast(strings.read.copied);
        } catch {
            this.showToast(strings.read.copyFailed);
        }
    },

    /** Fold or unfold the explanation (remembered). */
    toggleReadGloss(btn: HTMLElement): void {
        const open = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', String(open));
        const body = document.getElementById('read-gloss-body');
        if (body) body.hidden = !open;
        btn.closest('.read-section')?.classList.toggle('is-open', open);
        try { localStorage.setItem(GLOSS_KEY, open ? '1' : '0'); } catch { /* storage off */ }
    },

    /** The whole page in the image viewer (⤢). */
    openReadPage(): void {
        const s = st;
        const link = this.researchOriginalsLink();
        if (!s?.result || !link) return;
        const page = this.readShownPage(s.result);
        const base = this.readBridgeBase(link.researchId);
        if (page && base && page.image) openImageViewer(readPageImageUrl(base, page));
    },

    /**
     * "Suggest for the tree…": the step that builds the suggestion from the
     * chosen entry (`readDocumentSelection()`). The step itself comes with the
     * suggestion's own view; until then the button only exists.
     */
    readDocumentPropose(): void {
        const sel = this.readDocumentSelection();
        if (!sel || !canPropose(sel.entry) || !st) return;
        this.openReadPropose();
    },

    /** The dialog's result now: the reading, its result and the bridge's address (for the result's own view). */
    readDocumentCurrent(): { readId: string; result: ReadResult; base: string; researchId: string } | null {
        const link = this.researchOriginalsLink();
        if (!st?.result || !link) return null;
        return { readId: st.readId, result: st.result, base: this.readBridgeBase(link.researchId), researchId: link.researchId };
    },

    /**
     * The chosen entry with what a suggestion needs: its page and that page's
     * image URL ('' = none). A person's or an event's crop is
     * `readCropHtml(sel.imageUrl, sel.page, region, w, h)`.
     */
    readDocumentSelection(): {
        readId: string; result: ReadResult; base: string; researchId: string;
        entryIndex: number; entry: ReadEntry; page: ReadPage | null; imageUrl: string;
    } | null {
        const cur = this.readDocumentCurrent();
        const s = st;
        const entry = cur && s ? cur.result.entries[s.entry] : undefined;
        if (!cur || !s || !entry) return null;
        const page = cur.result.pages.find(p => p.n === entry.page) ?? null;
        return { ...cur, entryIndex: s.entry, entry, page, imageUrl: page && cur.base ? readPageImageUrl(cur.base, page) : '' };
    },

    // ==================== ERRORS ====================

    readErrorHtml(): string {
        const err = st!.error ?? { kind: 'failed' as ErrorKind };
        if (err.kind === 'source') return this.readSourceBlockHtml();
        const { title, text } = this.readErrorWords();
        return `
                <div class="read-error" data-error="${err.kind}" role="alert">
                    <h3 class="read-error-title">${esc(title)}</h3>
                    ${text ? `<p class="read-error-text">${esc(text)}</p>` : ''}
                </div>`;
    },

    /** A source's reading that cannot be shown: why, then the transcription the source carries (with its marks). */
    readSourceBlockHtml(): string {
        const s = st!;
        const t = strings.read;
        const why = s.error?.why ?? 'other';
        const transcript = DataManager.getData().sources?.[s.sourceId]?.transcript?.trim() ?? '';
        const lines = transcript
            ? parseBlock(transcript).map(segs => `<div class="read-source-line">${segsHtml(segs) || '&nbsp;'}</div>`).join('')
            : `<p class="read-source-none">${esc(t.sourceNoTranscript)}</p>`;
        return `
                <div class="read-error read-source-block" data-error="source" data-why="${esc(why)}" role="alert">
                    <h3 class="read-error-title">${esc(t.sourceBlockTitle)}</h3>
                    <p class="read-error-text">${esc(t.sourceWhy[why] ?? t.sourceWhy.other)}</p>
                </div>
                <section class="read-source-transcript" aria-labelledby="read-source-title">
                    <h3 class="read-section-title" id="read-source-title">${esc(t.sourceTranscript)}</h3>
                    <div class="read-source-lines">${lines}</div>
                </section>`;
    },

    /** The error state's title and explanation. */
    readErrorWords(): { title: string; text: string } {
        const s = st!;
        const t = strings.read;
        const err = s.error ?? { kind: 'failed' as ErrorKind };
        const accepts = this.researchReadAcceptsAny();
        let title = '';
        let text = '';
        switch (err.kind) {
            case 'down': title = t.notRunning; text = t.notRunningSub; break;
            case 'not-ready': {
                const why = err.failure?.why ?? accepts?.why ?? 'other';
                title = t.notReady(whyReason({ ...(accepts ?? { ready: false, readers: 1, types: [], max: 0, pages: 0, langs: [] }), why, resets: err.failure?.resets ?? accepts?.resets ?? '' }));
                break;
            }
            case 'older': title = t.older; break;
            case 'failed': title = t.failed; text = t.failedWhy[err.failure?.kind ?? ''] ?? ''; break;
            case 'cancelled': title = t.cancelled; break;
            // Held by the research (sealed elsewhere, files not downloaded, a full disk): its own sentence (017 U7).
            case 'held': {
                const held = err.failure?.held ?? { kind: 'seal' as const, said: '' };
                const words = this.researchWriteHeldText(held, false);
                title = words.title;
                text = held.said || words.sub;
                break;
            }
            case 'busy': title = t.busy; break;
            case 'limit': {
                title = t.limit(err.failure?.per ?? 'queue');
                const at = err.failure?.resets ? new Date(err.failure.resets)
                    : err.failure?.retryAfterMs ? new Date(Date.now() + err.failure.retryAfterMs) : null;
                if (at && Number.isFinite(at.getTime())) text = t.limitAt(at.toLocaleTimeString(getCurrentLanguage(), { hour: '2-digit', minute: '2-digit' }));
                break;
            }
            case 'unreadable': {
                const why = err.why ?? 'other';
                title = t.unreadable(t.whyText[why] ?? t.whyText.other);
                text = t.advice[why] ?? t.advice.other;
                break;
            }
        }
        return { title, text };
    },

    readErrorFootHtml(): string {
        const s = st!;
        const t = strings.read;
        const kind = s.error?.kind ?? 'failed';
        const btn = (act: string, label: string, primary = false): string =>
            `<button type="button" class="${primary ? 'primary' : 'secondary'}" data-act="${act}">${esc(label)}</button>`;
        const close = btn('close', t.close, kind === 'limit' || kind === 'cancelled');
        // A reading started in the research is not read again from here.
        const own = this.readLiveOf(s.readId)?.from !== 'research';
        switch (kind) {
            case 'source': {
                const hasText = !!DataManager.getData().sources?.[s.sourceId]?.transcript?.trim();
                const open = s.error?.why === 'down' && !!this.researchOriginalsLink();
                const update = s.error?.why === 'older';
                return `<span class="batch-foot-note"></span>${hasText ? btn('copy-source', t.copy) : ''}`
                    + btn('close', t.close, !open && !update) + (open ? btn('open-research', t.openResearch, true) : '')
                    + (update ? btn('update-research', t.updateResearch, true) : '');
            }
            case 'down':
                return `<span class="batch-foot-note"></span>${this.batchAvailable() && s.pages.length ? btn('as-material', t.addMaterials) : ''}`
                    + btn('close', t.close) + btn('open-research', t.openResearch, true);
            case 'not-ready': return `<span class="batch-foot-note"></span>${btn('close', t.close)}${btn('open-research', t.openResearch, true)}`;
            case 'older': return `<span class="batch-foot-note"></span>${btn('close', t.close)}${btn('update-research', t.updateResearch, true)}`;
            case 'failed': return `<span class="batch-foot-note"></span>${own ? `${btn('close', t.close)}${btn('retry', t.retry, true)}` : btn('close', t.close, true)}`;
            case 'cancelled': return `<span class="batch-foot-note"></span>${s.readId && own ? btn('again', t.readAgain) : ''}${close}`;
            case 'busy': return `<span class="batch-foot-note"></span>${btn('close', t.close)}${btn('show-running', t.showRunning, true)}`;
            case 'held': {
                const seal = this.researchSealAction(s.error?.failure?.held)[0];
                return `<span class="batch-foot-note"></span>${btn('close', t.close, !seal)}${seal ? btn('seal', seal.label, true) : ''}`;
            }
            case 'unreadable': return `<span class="batch-foot-note"></span>${btn('close', t.close)}${btn('insert-other', t.insertOther, true)}`;
            default: return `<span class="batch-foot-note"></span>${close}`;
        }
    },

    // ==================== WIRING ====================

    wireReadDialog(overlay: HTMLElement): void {
        const s = st;
        if (!s) return;
        // One delegated listener for every action (the overlay stays, its content is redrawn).
        if (!overlay.dataset.wired) {
            overlay.dataset.wired = '1';
            overlay.addEventListener('click', (e) => {
                const el = (e.target as Element | null)?.closest<HTMLElement>('[data-act]');
                if (!el || !overlay.contains(el) || (el as HTMLButtonElement).disabled) return;
                this.readDialogAct(el, overlay);
            });
        }
        const input = overlay.querySelector<HTMLInputElement>('#read-input');
        input?.addEventListener('change', () => {
            this.readReadFields(overlay);
            const files = Array.from(input.files ?? []);
            input.value = '';
            if (files.length) this.addReadFiles(files);
        });
        // Files dropped on the dialog (the window's own drop is off while a dialog is open).
        const content = overlay.querySelector<HTMLElement>('.read-content');
        const drop = overlay.querySelector<HTMLElement>('#read-drop');
        const hasFiles = (e: DragEvent): boolean => Array.prototype.indexOf.call(e.dataTransfer?.types ?? [], 'Files') >= 0;
        if (content && s.phase === 'input') {
            content.addEventListener('dragover', (e) => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                drop?.classList.add('is-over');
            });
            content.addEventListener('dragleave', (e) => {
                if (!content.contains(e.relatedTarget as Node | null)) drop?.classList.remove('is-over');
            });
            content.addEventListener('drop', (e) => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                e.stopPropagation();
                drop?.classList.remove('is-over');
                this.readReadFields(overlay);
                const files = Array.from(e.dataTransfer?.files ?? []);
                if (files.length) this.addReadFiles(files);
            });
        }
        // The pages' order: dragging a row, or Alt+↑/↓ on it.
        let dragged = 0;
        overlay.querySelectorAll<HTMLElement>('.read-page[draggable="true"]').forEach(row => {
            const key = Number(row.dataset.key);
            row.addEventListener('dragstart', (e) => {
                dragged = key;
                row.classList.add('is-dragging');
                e.dataTransfer?.setData('text/plain', String(key));
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            });
            row.addEventListener('dragend', () => { dragged = 0; row.classList.remove('is-dragging'); });
            row.addEventListener('dragover', (e) => {
                if (!dragged || hasFiles(e)) return;
                e.preventDefault();
                e.stopPropagation();
            });
            row.addEventListener('drop', (e) => {
                if (!dragged || hasFiles(e)) return;
                e.preventDefault();
                e.stopPropagation();
                this.readReadFields(overlay);
                this.placeReadPage(dragged, key);
            });
            row.addEventListener('keydown', (e) => {
                if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.target !== row) return;
                e.preventDefault();
                this.readReadFields(overlay);
                this.moveReadPage(key, e.key === 'ArrowUp' ? -1 : 1);
                document.querySelector<HTMLElement>(`#${DIALOG_ID} .read-page[data-key="${key}"]`)?.focus();
            });
        });
        overlay.querySelectorAll<HTMLInputElement>('input[name="read-readers"]').forEach(radio => radio.addEventListener('change', () => {
            this.readReadFields(overlay);
            s.readers = radio.value === '2' ? 2 : 1;
            overlay.querySelectorAll('.read-reader').forEach(card => card.classList.toggle('is-checked', !!card.querySelector('input:checked')));
            const foot = overlay.querySelector('.read-footer');
            if (foot) foot.innerHTML = this.readInputFootHtml();
        }));
        const pickerHost = overlay.querySelector<HTMLElement>('#read-person-picker');
        if (pickerHost && s.phase === 'input') {
            try {
                const data = DataManager.getData();
                s.picker = new PersonPicker({
                    containerId: 'read-person-picker',
                    onSelect: (id) => { s.personId = id; },
                    persons: Object.values(data.persons).filter(p => !p.isPlaceholder),
                    showBirthYear: true,
                });
                if (s.personId) s.picker.setValue(s.personId as PersonId);
                pickerHost.querySelector('input')?.setAttribute('aria-labelledby', 'read-person-label');
            } catch (err) {
                console.warn('Person picker unavailable', err);
            }
        }
        if (s.phase === 'result' || s.phase === 'propose') this.wireReadResult(overlay);
        if (s.phase === 'propose' || s.phase === 'written') this.wireReadPropose(overlay);
        if (s.phase === 'error' || s.phase === 'result' || s.phase === 'written') overlay.querySelector<HTMLElement>('.read-footer .primary')?.focus();
    },

    /** A click on an element with `data-act` in the dialog. */
    readDialogAct(el: HTMLElement, overlay: HTMLElement): void {
        const s = st;
        if (!s) return;
        this.readReadFields(overlay);
        const key = Number(el.dataset.key);
        switch (el.dataset.act) {
            case 'close': this.closeReadDocumentDialog(); break;
            case 'pick': overlay.querySelector<HTMLInputElement>('#read-input')?.click(); break;
            case 'remove': this.moveReadPage(key, 0); break;
            case 'up': this.moveReadPage(key, -1); break;
            case 'down': this.moveReadPage(key, 1); break;
            case 'read': void this.submitReadDocument(); break;
            case 'cancel': void this.cancelReadDocument(); break;
            case 'retry': void this.retryReadDocument(); break;
            case 'seal': this.researchSyncAction('sealTakeOver'); break;
            case 'again': void this.readDocumentAgain(); break;
            case 'another': this.newReadInput(); break;
            case 'insert-other': this.newReadInput(true); break;
            case 'show-running': {
                const running = this.readRunningNow();
                if (running) { s.readId = running.id; this.followReadInDialog(running); }
                break;
            }
            case 'open-research': this.openResearchFromRead(); break;
            case 'update-research':
                if (this.researchLinkAvailable('update')) this.researchActionUpdate();
                else this.showResearchUpdateHelp();
                break;
            case 'as-material': {
                const files = s.pages.map(p => ({ file: p.file, path: p.file.name }));
                this.closeReadDocumentDialog();
                this.showBatchDialog({ files });
                break;
            }
            case 'entry': this.readSelectEntry(Number(el.dataset.entry)); break;
            case 'page': this.readSelectPage(Number(el.dataset.page)); break;
            case 'open-page': this.openReadPage(); break;
            case 'copy': void this.copyReadTranscript(); break;
            case 'copy-source': void this.copySourceTranscript(); break;
            case 'gloss': this.toggleReadGloss(el); break;
            case 'propose': this.readDocumentPropose(); break;
            default: this.readProposeAct(el); break;
        }
    },

    /** The person and the note as typed (kept across redraws). */
    readReadFields(overlay: HTMLElement): void {
        if (!st) return;
        const note = overlay.querySelector<HTMLTextAreaElement>('#read-note');
        if (note) st.note = note.value.slice(0, NOTE_MAX);
        const person = overlay.querySelector<HTMLInputElement>('#read-person-picker input');
        if (person && st.picker) st.personId = person.value.trim() ? st.picker.getValue() ?? '' : '';
    },

    /** Move a page up (-1) or down (+1) among the taken ones; 0 removes it. */
    moveReadPage(key: number, by: -1 | 0 | 1): void {
        if (!st) return;
        const i = st.pages.findIndex(p => p.key === key);
        if (i < 0) return;
        if (by === 0) {
            revoke(st.pages.splice(i, 1));
        } else {
            const refusals = this.readPageRefusals();
            let j = i + by;
            while (j >= 0 && j < st.pages.length && refusals[j]) j += by;
            if (j < 0 || j >= st.pages.length) return;
            const [page] = st.pages.splice(i, 1);
            st.pages.splice(j, 0, page);
        }
        this.renderReadDialog();
    },

    /** A page dragged onto another one takes its place. */
    placeReadPage(key: number, onto: number): void {
        if (!st || key === onto) return;
        const from = st.pages.findIndex(p => p.key === key);
        const to = st.pages.findIndex(p => p.key === onto);
        if (from < 0 || to < 0) return;
        const [page] = st.pages.splice(from, 1);
        st.pages.splice(to, 0, page);
        this.renderReadDialog();
    },

    /** "Read another" / "Insert another photo": the input again (the pages kept for another photo). */
    newReadInput(keepPages = false): void {
        if (!st) return;
        if (!keepPages) { revoke(st.pages); st.pages = []; }
        st.phase = 'input';
        st.error = null;
        st.result = null;
        st.readId = '';
        st.notice = '';
        st.sending = null;
        st.sawChecking = false;
        st.entry = 0;
        st.line = -1;
        st.page = 1;
        this.renderReadDialog();
    },

    openResearchFromRead(): void {
        const link = this.researchOriginalsLink();
        if (this.researchLinkAvailable('open')) { this.researchActionOpen(); return; }
        const url = link ? researchSchemeUrl('open', { tree: link.researchId }, announcedResearchScheme()) : null;
        if (url) this.launchResearchLink(url);
    },

    // ==================== SENDING ====================

    /** "Read": every taken page (`PUT media/<sha>`), then `POST read`. Nothing else is asked. */
    async submitReadDocument(): Promise<void> {
        const s = st;
        const link = this.researchOriginalsLink();
        if (!s || s.busy || !link) return;
        const refusals = this.readPageRefusals();
        const pages = s.pages.filter((_, i) => !refusals[i]);
        if (pages.length === 0) return;
        const base = this.readBridgeBase(link.researchId);
        if (!base) { this.readFailed({ kind: 'down', code: '', status: 0, retryAfterMs: 0 }); return; }
        storeReaders(s.readers);
        const refn = s.personId ? originalTargets({ personId: s.personId as PersonId }, DataManager.getData()).person : undefined;
        s.busy = true;
        s.phase = 'progress';
        s.readId = '';
        s.notice = '';
        s.startedAt = Date.now();
        s.sending = { k: 1, n: pages.length };
        this.renderReadDialog();
        for (let i = 0; i < pages.length; i++) {
            if (st !== s) return;
            const p = pages[i];
            s.sending = { k: i + 1, n: pages.length };
            this.renderReadDialog();
            if (!p.sha) p.sha = await sha256OfBlob(p.file);
            const reply = await putReadPage(base, p.sha, p.file, { name: p.file.name, person: refn, mime: p.mime });
            if (st !== s) return;
            if (!reply.ok) {
                s.busy = false;
                s.sending = null;
                const f = reply.failure;
                // The research does not take this file: it stays in the list with the reason.
                if (f.kind === 'type' || f.kind === 'large') {
                    p.refused = f.kind === 'type' ? { kind: 'type', type: p.kind }
                        : { kind: 'size', mb: Math.ceil(p.file.size / 1024 / 1024 * 10) / 10, maxMb: f.most ?? Math.round((this.researchReadAcceptsAny()?.max ?? 0) / 1024 / 1024) };
                    s.phase = 'input';
                    this.renderReadDialog();
                    return;
                }
                this.readFailed(f);
                return;
            }
        }
        const reply = await startRead(base, {
            files: pages.map(p => p.sha), readers: s.readers, lang: getCurrentLanguage(), person: refn, note: s.note,
        });
        if (st !== s) return;
        s.busy = false;
        s.sending = null;
        if (!reply.ok) {
            const f = reply.failure;
            if ((f.kind === 'type' || f.kind === 'large') && f.sha) {
                const p = s.pages.find(x => x.sha === f.sha);
                if (p) {
                    p.refused = f.kind === 'type' ? { kind: 'type', type: p.kind } : { kind: 'size', mb: Math.ceil(p.file.size / 1024 / 1024 * 10) / 10, maxMb: f.most ?? 0 };
                    s.phase = 'input';
                    this.renderReadDialog();
                    return;
                }
            }
            this.readFailed(f);
            return;
        }
        this.readStarted(link.researchId, reply.value.read, reply.value.state, pages.length, pages[0]?.file.name ?? '');
    },

    /** A reading started (or started again): remembered, followed. */
    readStarted(researchId: string, id: string, state: ReadState, pages: number, name: string): void {
        const s = st;
        rememberRead(id, researchId);
        announced.delete(id);
        const now = new Date().toISOString();
        const reads = new Map(readsByResearch.get(researchId) ?? []);
        const prev = reads.get(id);
        reads.set(id, {
            id, state, version: (prev?.version ?? 0) + 1, at: now, since: now, files: pages, pages, readers: s?.readers ?? 1,
            done: 0, entries: 0, name: prev?.name ?? name, person: prev?.person ?? '', from: 'app',
            ...(this.researchReadAcceptsAny()?.expectSecs ? { expectSecs: this.researchReadAcceptsAny()!.expectSecs } : {}),
        });
        readsByResearch.set(researchId, reads);
        results.delete(id);
        if (s) {
            s.readId = id;
            if (s.phase !== 'propose') s.phase = 'progress';
            s.startedAt = Date.now();
            s.sawChecking = false;
            this.renderReadDialog();
        }
        this.watchReads();
        this.refreshReadSurfaces();
        // The status soon after: the bridge's own state of it.
        void this.askResearchBridge(researchId, POLL_MS);
    },

    /** A refusal or no answer: its own state in the dialog (§7). */
    readFailed(f: ReadFailure): void {
        const s = st;
        if (!s) return;
        s.busy = false;
        s.sending = null;
        const kind: ErrorKind = f.kind === 'down' ? 'down'
            : f.kind === 'not-ready' ? 'not-ready'
            : f.kind === 'read-busy' ? 'busy'
            : f.kind === 'limit' ? 'limit'
            : f.kind === 'held' ? 'held'
            : 'failed';
        s.error = { kind, failure: f };
        if (s.phase === 'propose') {
            // A second reader refused: the suggestion of the first stays, the reason above it.
            const { title, text } = this.readErrorWords();
            s.error = null;
            s.second = false;
            s.notice = [title, text].filter(Boolean).join(' ');
            this.renderReadDialog();
            return;
        }
        s.phase = 'error';
        this.renderReadDialog();
    },

    /** "Cancel reading": at once, no question. A reading again cancelled: the previous result stands. */
    async cancelReadDocument(): Promise<void> {
        const s = st;
        const link = this.researchOriginalsLink();
        if (!s?.readId || !link || s.busy) return;
        const base = this.readBridgeBase(link.researchId);
        if (!base) return;
        s.busy = true;
        this.renderReadDialog();
        const reply = await cancelRead(base, s.readId);
        if (st !== s) return;
        s.busy = false;
        if (!reply.ok) { this.readFailed(reply.failure); return; }
        const id = s.readId;
        const reads = new Map(readsByResearch.get(link.researchId) ?? []);
        const prev = reads.get(id);
        if (prev) reads.set(id, { ...prev, state: reply.value.state, version: reply.value.version, since: new Date().toISOString() });
        readsByResearch.set(link.researchId, reads);
        announced.add(id);
        markOpened(id);
        if (reply.value.state === 'done') {
            // A reading again cancelled: the previous version stands.
            results.delete(id);
            s.second = false;
            s.notice = strings.read.againCancelled;
            await this.openReadResult(id);
        } else if (reply.value.state === 'cancelled' || !reply.value.cancelled) {
            s.phase = 'error';
            s.error = { kind: reply.value.state === 'cancelled' ? 'cancelled' : 'failed' };
            this.renderReadDialog();
            if (!reply.value.cancelled && prev) this.followReadInDialog({ ...prev, state: reply.value.state });
        }
        this.refreshReadSurfaces();
    },

    /** "Try again": the same reading again when there is one, else the pages sent anew. */
    async retryReadDocument(): Promise<void> {
        if (!st) return;
        if (st.readId) { await this.readDocumentAgain(); return; }
        st.phase = 'input';
        st.error = null;
        await this.submitReadDocument();
    },

    /** "Read again" (`POST read/<id>/again`). */
    async readDocumentAgain(): Promise<void> {
        const s = st;
        const link = this.researchOriginalsLink();
        if (!s?.readId || !link || s.busy) return;
        const base = this.readBridgeBase(link.researchId);
        if (!base) { this.readFailed({ kind: 'down', code: '', status: 0, retryAfterMs: 0 }); return; }
        s.busy = true;
        const reply = await readAgain(base, s.readId, s.readers);
        if (st !== s) return;
        s.busy = false;
        if (!reply.ok) { this.readFailed(reply.failure); return; }
        s.error = null;
        const prev = this.readLiveOf(s.readId);
        this.readStarted(link.researchId, reply.value.read, reply.value.state, prev?.pages ?? s.pages.length, prev?.name ?? '');
    },

    // ==================== A DROP ON THE TREE ====================

    /**
     * A drag over the window offers "Read now" beside "Add to materials": 1 to
     * `pages` files the research reads, reading possible now. Null: the usual drop.
     */
    readDropOffered(dt: DataTransfer | null): boolean {
        if (!dt || !this.readDocumentReady()) return false;
        const accepts = this.readDocumentAccepts();
        if (!accepts) return false;
        const items = Array.from(dt.items ?? []).filter(i => i.kind === 'file');
        if (items.length === 0 || items.length > accepts.pages) return false;
        // A HEIC may come without a type while dragged: only known types count.
        return items.every(i => !!i.type && accepts.types.includes(i.type.toLowerCase()));
    },
});
