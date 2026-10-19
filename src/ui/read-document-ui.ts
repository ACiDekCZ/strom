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
import { storedResearchBridge, announcedResearchScheme } from '../research-device.js';
import {
    ReadAccepts, LiveRead, ReadResult, ReadFailure, ReadFileRefusal, ReadState,
    readRunning, readFileMime, readFileKind, readFileRefusals, readUsualMinutes, readDocYear, readPageImageUrl,
    putReadPage, startRead, fetchReadResult, readAgain, cancelRead, sanitizeLiveRead,
} from '../research-read.js';
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
type ErrorKind = 'down' | 'not-ready' | 'older' | 'failed' | 'cancelled' | 'busy' | 'limit' | 'unreadable';

type Phase = 'input' | 'progress' | 'result' | 'error';

interface DialogState {
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
}

/** A reading the app started: shown as done in the menu and the panel until opened. */
interface RecentRead { id: string; opened: boolean; research: string }

let st: DialogState | null = null;
let nextKey = 1;
/** The readings each research's bridge listed last (by research, then id). */
const readsByResearch = new Map<string, Map<string, LiveRead>>();
/** Results fetched in this page (for the notice, the menu's second line, the dialog). */
const results = new Map<string, ReadResult>();
/** Readings whose end was announced (once). */
const announced = new Set<string>();
let listening = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let pasteHandler: ((e: ClipboardEvent) => void) | null = null;
/** What the menu, the panel strip and the button last showed of the readings (redrawn when it changes). */
let drawnKey = '';

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

/** "2 readers, agree" / "2 readers, 3 places differ" / "1 reader". */
function agreeText(res: ReadResult): string {
    const t = strings.read;
    const n = Math.max(res.readers.ran, res.readers.asked);
    if (n < 2) return t.oneReader;
    if (res.readers.agree === 'differ') {
        const k = res.entries.reduce((sum, e) => sum + e.variants.length, 0);
        return t.differ(n, Math.max(1, k));
    }
    return t.agree;
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

const QR_GLYPH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">'
    + '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>'
    + '<path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg>';

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
        next.set(read.id, read);
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
                if (!before || before.state !== r.state || before.done !== r.done || before.version !== r.version) this.followReadInDialog(r);
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
                if (st && document.getElementById(DIALOG_ID) && st.phase !== 'progress' && st.phase !== 'result') this.refreshReadGate();
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
        if (!reply.ok) return cached ?? null;
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
    showReadDocumentDialog(opts: { personId?: string; files?: File[]; readId?: string } = {}): void {
        const link = this.researchOriginalsLink();
        if (!link) return;
        this.closeActionsMenu();
        this.hideContextMenu?.();
        if (this.isResearchMenuOpen?.()) this.closeResearchMenu();
        this.ensureReadListener();
        // Already open: files dropped on it again join its pages.
        if (st && document.getElementById(DIALOG_ID)) {
            if (opts.files?.length && st.phase === 'input') this.addReadFiles(opts.files);
            return;
        }
        const target = opts.readId
            ? this.readsOfResearch(link.researchId).find(r => r.id === opts.readId) ?? null
            : opts.files?.length || opts.personId ? null : this.readRunningNow() ?? this.readUnopenedNow();
        if (!target && !opts.readId && !this.readDocumentAccepts()) return;
        st = {
            phase: 'input', pages: [], personId: opts.personId ?? '', note: '', readers: storedReaders(), readId: '',
            sending: null, sawChecking: false, startedAt: Date.now(), error: null, result: results.get(opts.readId ?? '') ?? null,
            notice: '', picker: null, busy: false,
        };
        const overlay = document.createElement('div');
        overlay.id = DIALOG_ID;
        overlay.className = 'modal-overlay active';
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
        if (target || opts.readId) {
            st.readId = target?.id ?? opts.readId ?? '';
            st.phase = 'progress';
            if (target) this.followReadInDialog(target);
            else void this.openReadResult(st.readId);
        } else {
            if (opts.files?.length) this.addReadFiles(opts.files, false);
            this.renderReadDialog();
        }
        this.watchReads();
    },

    /** Close the dialog (a running reading goes on). */
    closeReadDocumentDialog(): void {
        document.getElementById(DIALOG_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== DIALOG_ID);
        if (pasteHandler) document.removeEventListener('paste', pasteHandler);
        pasteHandler = null;
        if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
        if (st) {
            st.picker?.destroy();
            revoke(st.pages);
        }
        st = null;
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
        const link = this.researchOriginalsLink();
        const tree = link ? TreeManager.getTreeMetadata(link.treeId)?.name ?? '' : '';
        const t = strings.read;
        let title = t.title;
        let sub = t.sub(tree);
        let body = '';
        let foot = '';
        let wide = false;
        if (st.phase === 'input') {
            body = this.readInputHtml();
            foot = this.readInputFootHtml();
        } else if (st.phase === 'progress') {
            const live = this.readLiveOf(st.readId);
            title = t.progressTitle;
            sub = t.progressSub(live?.name || st.pages[0]?.file.name || '', live?.pages || st.pages.filter(p => !p.refused).length);
            body = this.readProgressHtml();
            foot = this.readProgressFootHtml();
        } else if (st.phase === 'result' && st.result) {
            title = docLabel(st.result) || t.title;
            const label = title.charAt(0).toLocaleUpperCase() + title.slice(1);
            title = label;
            sub = this.readResultSubtitle(st.result);
            body = this.readResultHtml(st.result, link ? this.readBridgeBase(link.researchId) : '');
            foot = this.readResultFootHtml();
            wide = true;
        } else {
            body = this.readErrorHtml();
            foot = this.readErrorFootHtml();
        }
        overlay.innerHTML = `
            <div class="modal batch-dialog read-dialog${wide ? ' read-dialog--wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="read-title" data-phase="${st.phase}">
                <div class="modal-header batch-header">
                    <div class="audit-log-heading">
                        <h2 id="read-title">${esc(title)}</h2>
                        <div class="audit-log-subtitle">${esc(sub)}</div>
                    </div>
                    <button type="button" class="close-btn" data-act="close" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                ${st.notice ? `<p class="read-notice" role="status">${esc(st.notice)}</p>` : ''}
                <div class="modal-content batch-content read-content">${body}</div>
                <div class="buttons batch-footer read-footer">${foot}</div>
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
                </div>
                <div class="read-phone" aria-disabled="true">${QR_GLYPH}<span>${esc(t.phone)}</span></div>`;
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
        return `
                ${top}
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
            ? `<strong>${esc(t.footSum(taken, s.readers))}</strong> ${esc(t.usual(readUsualMinutes(s.readers)))}${refused ? ` · ${esc(t.refusedNotSent)}` : ''}`
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
        return readsByResearch.get(link.researchId)?.get(id) ?? null;
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
                <p class="read-progress-slow" id="read-progress-slow" hidden>${esc(t.slow)}</p>
                <p class="read-progress-note">${esc(t.closeNote)}</p>`;
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
            const usual = readUsualMinutes(live?.readers || s.readers);
            time.textContent = strings.read.running(usual, strings.read.elapsed(Math.floor(secs / 60), secs % 60));
            const slow = document.getElementById('read-progress-slow');
            if (slow) slow.hidden = secs < usual * 60 * 2;
        };
        paint();
        if (!tickTimer) tickTimer = setInterval(paint, 1000);
    },

    /** The dialog follows its reading: progress, then the result or what went wrong. */
    followReadInDialog(r: LiveRead): void {
        if (!st) return;
        st.readId = r.id;
        if (r.state === 'checking') st.sawChecking = true;
        if (readRunning(r.state)) {
            st.phase = 'progress';
            this.renderReadDialog();
            return;
        }
        if (r.state === 'done') { void this.openReadResult(r.id); return; }
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
        if (!res) {
            st.phase = 'error';
            st.error = { kind: this.researchBridgeUp(link.researchId) ? 'failed' : 'down' };
        } else if (res.state === 'unreadable') {
            st.phase = 'error';
            st.error = { kind: 'unreadable', why: res.doc.why ?? 'other' };
        } else {
            st.result = res;
            st.phase = 'result';
        }
        this.renderReadDialog();
        this.refreshReadSurfaces();
    },

    // ==================== THE RESULT (a skeleton; its full view comes with §4) ====================

    /** The result's subtitle: legibility and agreement. */
    readResultSubtitle(res: ReadResult): string {
        const t = strings.read;
        const legible = res.doc.legible === 'yes' ? t.legible : res.doc.legible === 'partly' ? t.partly : t.notLegible;
        return [legible, agreeText(res)].join(' · ');
    },

    /**
     * The result's body: the transcription as plain text. `base` is the
     * bridge's address: a page's image is `readPageImageUrl(base, page)`.
     */
    readResultHtml(res: ReadResult, base: string): string {
        const t = strings.read;
        void base;
        const partial = res.doc.legible === 'partly'
            ? `<p class="read-partial">${esc(t.partial(t.whyText[res.doc.why ?? 'other'] ?? t.whyText.other))}</p>` : '';
        const transcript = res.entries.map(e => e.transcript).filter(Boolean).join('\n\n');
        const translation = res.entries.map(e => e.translation).filter(Boolean).join('\n\n');
        return `
                <div class="read-result" id="read-result" data-read="${esc(res.id)}">
                    ${partial}
                    <section class="read-section">
                        <h3 class="read-section-title">${esc(t.sTranscript)}</h3>
                        ${transcript ? `<pre class="read-transcript">${esc(transcript)}</pre>` : `<p class="read-empty">${esc(t.noEntries)}</p>`}
                    </section>
                    ${translation ? `<section class="read-section"><h3 class="read-section-title">${esc(t.sTranslation)}</h3><pre class="read-transcript">${esc(translation)}</pre></section>` : ''}
                </div>`;
    },

    readResultFootHtml(): string {
        const t = strings.read;
        const another = this.readDocumentReady()
            ? `<button type="button" class="secondary" data-act="another">${esc(t.another)}</button>` : '';
        return `<span class="batch-foot-note"></span>${another}
                <button type="button" class="primary" data-act="close">${esc(t.close)}</button>`;
    },

    /** The dialog's result now: the reading, its result and the bridge's address (for the result's own view). */
    readDocumentCurrent(): { readId: string; result: ReadResult; base: string; researchId: string } | null {
        const link = this.researchOriginalsLink();
        if (!st?.result || !link) return null;
        return { readId: st.readId, result: st.result, base: this.readBridgeBase(link.researchId), researchId: link.researchId };
    },

    // ==================== ERRORS ====================

    readErrorHtml(): string {
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
        return `
                <div class="read-error" data-error="${err.kind}" role="alert">
                    <h3 class="read-error-title">${esc(title)}</h3>
                    ${text ? `<p class="read-error-text">${esc(text)}</p>` : ''}
                </div>`;
    },

    readErrorFootHtml(): string {
        const s = st!;
        const t = strings.read;
        const kind = s.error?.kind ?? 'failed';
        const btn = (act: string, label: string, primary = false): string =>
            `<button type="button" class="${primary ? 'primary' : 'secondary'}" data-act="${act}">${esc(label)}</button>`;
        const close = btn('close', t.close, kind === 'limit' || kind === 'cancelled');
        switch (kind) {
            case 'down':
                return `<span class="batch-foot-note"></span>${this.batchAvailable() && s.pages.length ? btn('as-material', t.addMaterials) : ''}`
                    + btn('close', t.close) + btn('open-research', t.openResearch, true);
            case 'not-ready': return `<span class="batch-foot-note"></span>${btn('close', t.close)}${btn('open-research', t.openResearch, true)}`;
            case 'older': return `<span class="batch-foot-note"></span>${btn('close', t.close)}${btn('update-research', t.updateResearch, true)}`;
            case 'failed': return `<span class="batch-foot-note"></span>${btn('close', t.close)}${btn('retry', t.retry, true)}`;
            case 'cancelled': return `<span class="batch-foot-note"></span>${s.readId ? btn('again', t.readAgain) : ''}${close}`;
            case 'busy': return `<span class="batch-foot-note"></span>${btn('close', t.close)}${btn('show-running', t.showRunning, true)}`;
            case 'unreadable': return `<span class="batch-foot-note"></span>${btn('close', t.close)}${btn('insert-other', t.insertOther, true)}`;
            default: return `<span class="batch-foot-note"></span>${close}`;
        }
    },

    // ==================== WIRING ====================

    wireReadDialog(overlay: HTMLElement): void {
        const s = st;
        if (!s) return;
        overlay.querySelectorAll<HTMLElement>('[data-act]').forEach(el => el.addEventListener('click', () => {
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
            }
        }));
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
            if (foot) {
                foot.innerHTML = this.readInputFootHtml();
                this.wireReadFooter(overlay);
            }
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
        if (s.phase === 'error' || s.phase === 'result') overlay.querySelector<HTMLElement>('.read-footer .primary')?.focus();
    },

    /** The footer alone again (the readers changed its sum). */
    wireReadFooter(overlay: HTMLElement): void {
        overlay.querySelectorAll<HTMLElement>('.read-footer [data-act]').forEach(el => el.addEventListener('click', () => {
            this.readReadFields(overlay);
            if (el.dataset.act === 'close') this.closeReadDocumentDialog();
            else if (el.dataset.act === 'read') void this.submitReadDocument();
        }));
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
        });
        readsByResearch.set(researchId, reads);
        results.delete(id);
        if (s) {
            s.readId = id;
            s.phase = 'progress';
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
        s.phase = 'error';
        const kind: ErrorKind = f.kind === 'down' ? 'down'
            : f.kind === 'not-ready' ? 'not-ready'
            : f.kind === 'read-busy' ? 'busy'
            : f.kind === 'limit' ? 'limit'
            : 'failed';
        s.error = { kind, failure: f };
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
