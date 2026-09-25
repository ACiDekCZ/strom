/**
 * Opening a research from Strom Research, the command-line research tool:
 *
 *   A. File Handling API — the installed app opens a .ged (launchQueue);
 *   B. ?import-url=<file on this computer> — fetched once and imported;
 *   C. a .ged dropped anywhere onto the window;
 *   D. ?live=<bridge on this computer> — follow a running research: the tree
 *      refreshes by itself, changed people glow, a small panel says who is
 *      at work, what changed and what waits for the user.
 *
 * All four end in the same place: a Strom Research file (header
 * `1 SOUR STROM_RESEARCH` + `1 _STROM_TREE <uuid>`) creates its tree the
 * first time and updates that tree afterwards, asking first when the user
 * changed it in the app. Any other GEDCOM goes to the normal import dialog.
 * Other trees are never touched.
 *
 * Every browser API used here is optional: without launchQueue, EventSource,
 * drag and drop or AbortController the matching feature is simply absent.
 * Everything from a bridge is untrusted text and is rendered as text only.
 * The pure logic lives in src/research-link.ts.
 */

import { DataManager, migrateData } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { StromData, TreeId, PersonId } from '../types.js';
import { parseGedcom, convertToStrom, decodeGedcomFile, parseGedcomDate } from '../ged-parser.js';
import { formatFlexDate } from '../dates.js';
import { formatLiveTime, formatLiveClock } from '../live-time.js';
import { isMobile } from '../breakpoints.js';
import {
    readResearchHeader, parseLoopbackUrl, parseLiveBridge, contentFingerprint, fingerprintLike,
    decideResearchOpen, stabilizeIds, sanitizeLiveStatus, sanitizeLiveChange,
    sanitizeWorking, parseEventData, extractChangedRefs, personsByRefs,
    humanizeChange, isGedcomFileName, isSafariBrowser,
    LiveBridgeUrls, LiveStatus, LiveChange, LiveWorker, LiveWaiting,
} from '../research-link.js';
import { uiModule } from './module.js';
import { iconSvg } from '../icons.js';
import { SettingsManager } from '../settings.js';
import { countImages, stripMedia } from '../attachments.js';

/** What a research open needs to know from the file (or the bridge). */
export interface ResearchSource {
    treeId: string | null;
    name: string | null;
    date: string | null;
}

export interface LiveChangeItem {
    text: string;
    at: string;
    personIds: PersonId[];
}

export interface LiveSession {
    bridge: LiveBridgeUrls;
    researchId: string;
    treeId: TreeId;
    name: string;
    head: string;
    working: LiveWorker[];
    waiting: LiveWaiting[];
    changes: LiveChangeItem[];
    ended: boolean;
    collapsed: boolean;
    /** Changes already seen when the panel was collapsed (for "N new"). */
    seenChanges: number;
    es: EventSource | null;
    timer: ReturnType<typeof setTimeout> | null;
    failures: number;
    /** Serialises tree refreshes (a change never overtakes another). */
    chain: Promise<void>;
}

/** Wait before reconnecting to the bridge's events / between status polls. */
const RECONNECT_MS = 2000;
/** Poll interval when the browser has no EventSource. */
const POLL_MS = 10000;
/** Failed probes in a row after which the bridge is taken as gone. */
const MAX_FAILURES = 2;
/** Most change lines kept in the panel. */
const MAX_CHANGES = 30;

/**
 * The followed bridge, kept for a reload of this tab (sessionStorage: survives
 * F5 in the same window, never reaches another window or the next start of
 * the app — the bridge address carries a secret token).
 */
const LIVE_RESUME_KEY = 'strom.live';

function rememberLiveBridge(base: string, treeId: string): void {
    try {
        sessionStorage.setItem(LIVE_RESUME_KEY, JSON.stringify({ bridge: base, treeId }));
    } catch { /* no storage: a reload just ends following */ }
}

function forgetLiveBridge(): void {
    try {
        sessionStorage.removeItem(LIVE_RESUME_KEY);
    } catch { /* nothing stored */ }
}

/** The bridge to follow again after a reload, or null. */
export function rememberedLiveBridge(): string | null {
    try {
        const raw = sessionStorage.getItem(LIVE_RESUME_KEY);
        if (!raw) return null;
        const bridge = (JSON.parse(raw) as { bridge?: unknown }).bridge;
        return typeof bridge === 'string' && parseLiveBridge(bridge) ? bridge : null;
    } catch {
        return null;
    }
}

let externalReady = false;
let live: LiveSession | null = null;
/** One open at a time: a second file waits for the first dialog. */
let openChain: Promise<unknown> = Promise.resolve();

function enqueueOpen<T>(job: () => Promise<T>): Promise<T | undefined> {
    const next = openChain.then(job, job).catch((err) => {
        console.error('Opening a research failed', err);
        return undefined;
    });
    openChain = next;
    return next;
}

/** fetch with a timeout where AbortController exists; never sends cookies. */
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
    if (typeof fetch !== 'function') throw new Error('fetch unavailable');
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;
    try {
        return await fetch(url, {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
            cache: 'no-store',
            signal: ctl?.signal,
        });
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function fetchGedcomText(url: string): Promise<string> {
    const res = await fetchWithTimeout(url, 30000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return decodeGedcomFile(await res.arrayBuffer());
}

async function fetchStatus(url: string): Promise<LiveStatus | null> {
    const res = await fetchWithTimeout(url, 10000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return sanitizeLiveStatus(await res.json());
}

/** Read a File as bytes (FileReader fallback for browsers without File.arrayBuffer). */
function readFileBuffer(file: Blob): Promise<ArrayBuffer> {
    if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
    });
}

/** A tree's stored data as the app would load it, or null when unreadable. */
async function readTree(treeId: TreeId): Promise<StromData | null> {
    if (DataManager.getCurrentTreeId() === treeId && !DataManager.isLocked()) return DataManager.getData();
    try {
        const data = await TreeManager.getTreeData(treeId);
        return data ? migrateData(data) : null;
    } catch {
        return null;
    }
}

/** Bytes of photos, attachments and excerpts a research brings (0 = none). */
function incomingImageBytes(data: StromData): number {
    return countImages(data).bytes;
}

function todayIso(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "23. 9. 2026" / "23 Sep 2026": the file's header date, else today. */
function researchDateLabel(gedDate: string | null): string {
    let iso = '';
    try {
        iso = gedDate ? parseGedcomDate(gedDate) : '';
    } catch {
        iso = '';
    }
    return formatFlexDate(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : todayIso());
}

/** Changed cards stay highlighted this long, then the highlight goes. */
const HIGHLIGHT_MS = 30_000;
/** Panel times ("5 min ago") are refreshed this often. */
const TIME_TICK_MS = 30_000;

let highlightTimer: ReturnType<typeof setTimeout> | null = null;
let timeTicker: ReturnType<typeof setInterval> | null = null;

/**
 * A time element of the panel: `ago` = "just now / N min ago / 14:36",
 * `since` = "since 14:36". Refreshed by the ticker from its data-ts.
 */
function timeEl(value: string, kind: 'ago' | 'since'): HTMLElement | null {
    const ts = Date.parse(value);
    if (!Number.isFinite(ts)) return null;
    const node = el('small', 'live-time');
    node.dataset.ts = String(ts);
    node.dataset.kind = kind;
    node.textContent = liveTimeText(ts, kind);
    return node;
}

function liveTimeText(ts: number, kind: 'ago' | 'since'): string {
    const lang = getCurrentLanguage();
    return kind === 'since'
        ? strings.research.since(formatLiveClock(ts, Date.now(), lang))
        : formatLiveTime(ts, Date.now(), lang, strings.research.justNow);
}

/** Keep the panel's times fresh while it is shown. */
function tickLiveTimes(): void {
    const panel = document.getElementById('live-panel');
    if (!panel) {
        if (timeTicker) clearInterval(timeTicker);
        timeTicker = null;
        return;
    }
    panel.querySelectorAll<HTMLElement>('.live-time[data-ts]').forEach((node) => {
        node.textContent = liveTimeText(Number(node.dataset.ts), node.dataset.kind === 'since' ? 'since' : 'ago');
    });
}

/** "user" (or nothing) is who the section heading already names. */
function waitsOnUser(on: string | undefined): boolean {
    return !on || /^\s*user\s*$/i.test(on);
}

/**
 * Where the panel may be: below whatever sits at the top on its side (the
 * standalone-file banner, the collaboration bar or badge), above whatever
 * sits at the bottom (zoom controls, bottom bar). Top-anchored layouts only;
 * the phone strip is placed by CSS.
 */
function placeLivePanel(panel: HTMLElement): void {
    panel.style.top = '';
    panel.style.maxHeight = '';
    if (panel.hidden || window.matchMedia('(max-width: 640px)').matches) return;
    const base = panel.getBoundingClientRect();
    const overlaps = (r: DOMRect) => r.width > 0 && r.height > 0 && r.left < base.right && r.right > base.left;
    let top = base.top;
    for (const sel of ['#embedded-mode-banner.visible', '#collab-bar', '#collab-badge']) {
        const node = document.querySelector<HTMLElement>(sel);
        if (!node || getComputedStyle(node).display === 'none') continue;
        const r = node.getBoundingClientRect();
        if (overlaps(r) && r.top < window.innerHeight / 3) top = Math.max(top, r.bottom + 8);
    }
    let bottom = window.innerHeight - 12;
    for (const sel of ['.control-block', '.zoom-controls', '.bottom-bar', '#view-mode-banner.visible']) {
        const node = document.querySelector<HTMLElement>(sel);
        if (!node) continue;
        const r = node.getBoundingClientRect();
        if (overlaps(r) && r.top > top) bottom = Math.min(bottom, r.top - 8);
    }
    if (top !== base.top) panel.style.top = `${Math.round(top)}px`;
    panel.style.maxHeight = `min(60vh, 520px, ${Math.max(120, Math.round(bottom - top))}px)`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export const researchUiMethods = uiModule({
    // ==================== ENTRY POINTS ====================

    /**
     * After the first render: read (and drop) ?import-url= / ?live= / ?open=,
     * start the file handler. Runs once; never throws.
     */
    initExternalOpen(): void {
        if (externalReady) return;
        externalReady = true;
        try {
            const params = new URLSearchParams(window.location.search);
            const importUrl = params.get('import-url');
            const liveUrl = params.get('live');
            if (importUrl !== null || liveUrl !== null || params.has('open')) {
                try {
                    const url = new URL(window.location.href);
                    url.searchParams.delete('import-url');
                    url.searchParams.delete('live');
                    url.searchParams.delete('open');
                    history.replaceState(null, '', url.toString());
                } catch { /* keep the address as it is */ }
            }
            window.addEventListener('strom:data-changed', () => this.syncLivePanelVisibility());
            window.addEventListener('resize', () => this.placeLivePanel());
            this.initLaunchQueue();
            const reveal = (): void => document.documentElement.classList.remove('external-opening');
            const explicit = liveUrl !== null || importUrl !== null || params.has('open');
            // Something else was asked for in this tab: the old bridge is over.
            if (explicit) forgetLiveBridge();
            const resume = explicit ? null : rememberedLiveBridge();
            if (liveUrl !== null) void this.startLiveFollow(liveUrl).finally(reveal);
            else if (importUrl !== null) void this.importResearchFromUrl(importUrl).finally(reveal);
            // A reload while following: follow the same bridge again, quietly.
            else if (resume !== null) void this.startLiveFollow(resume, { resume: true }).finally(reveal);
            else reveal();
        } catch (err) {
            document.documentElement.classList.remove('external-opening');
            console.warn('External open unavailable', err);
        }
    },

    /** A. File Handling API: the installed app was asked to open .ged files. */
    initLaunchQueue(): void {
        type LaunchParamsLike = { files?: ArrayLike<{ getFile?: () => Promise<File> }> };
        const lq = (window as unknown as {
            launchQueue?: { setConsumer?: (consumer: (params: LaunchParamsLike) => void) => void };
        }).launchQueue;
        if (!lq || typeof lq.setConsumer !== 'function') return;
        try {
            lq.setConsumer((params) => {
                const files = params?.files ? Array.from(params.files) : [];
                for (const handle of files) {
                    if (!handle || typeof handle.getFile !== 'function') continue;
                    void handle.getFile().then(
                        (file) => this.openGedcomFile(file),
                        (err) => console.warn('Launch file unreadable', err)
                    );
                }
            });
        } catch (err) {
            console.warn('launchQueue unavailable', err);
        }
    },

    /** C. A file dropped anywhere onto the window. No-op without drag and drop. */
    initFileDrop(): void {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;
        let depth = 0;
        const hasFiles = (e: DragEvent): boolean => {
            const types = e.dataTransfer?.types;
            if (!types) return false;
            return Array.prototype.indexOf.call(types, 'Files') >= 0;
        };
        const onFileInput = (e: Event): boolean =>
            !!(e.target as Element | null)?.closest?.('input[type="file"]');
        const modalOpen = (): boolean => !!document.querySelector('.modal-overlay.active');
        const overlay = (show: boolean): void => {
            let node = document.getElementById('drop-overlay');
            if (!show) {
                node?.classList.remove('active');
                return;
            }
            if (!node) {
                node = el('div', 'drop-overlay');
                node.id = 'drop-overlay';
                node.setAttribute('aria-hidden', 'true');
                node.appendChild(el('div', 'drop-overlay-box', strings.research.dropHint));
                document.body.appendChild(node);
            }
            const box = node.firstElementChild;
            if (box) box.textContent = strings.research.dropHint;
            node.classList.add('active');
        };

        try {
            window.addEventListener('dragenter', (e) => {
                if (!hasFiles(e) || onFileInput(e)) return;
                e.preventDefault();
                depth++;
                if (!modalOpen()) overlay(true);
            });
            window.addEventListener('dragover', (e) => {
                if (!hasFiles(e) || onFileInput(e)) return;
                // Without this the browser would navigate away to the file.
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = modalOpen() ? 'none' : 'copy';
            });
            window.addEventListener('dragleave', (e) => {
                if (!hasFiles(e)) return;
                depth = Math.max(0, depth - 1);
                if (depth === 0) overlay(false);
            });
            window.addEventListener('drop', (e) => {
                depth = 0;
                overlay(false);
                if (!hasFiles(e) || onFileInput(e)) return;
                e.preventDefault();
                if (modalOpen()) return;
                const file = e.dataTransfer?.files?.[0];
                if (file) void this.openGedcomFile(file);
            });
        } catch (err) {
            console.warn('Drag and drop unavailable', err);
        }
    },

    /** A local file (dropped or from the file handler). */
    async openGedcomFile(file: File): Promise<void> {
        if (!externalReady) {
            this.showToast(strings.research.notReady);
            return;
        }
        if (!isGedcomFileName(file?.name)) {
            this.showToast(strings.research.onlyGedcom, 4000);
            return;
        }
        let buffer: ArrayBuffer;
        try {
            buffer = await readFileBuffer(file);
        } catch {
            await this.showAlert(strings.gedcom.parseError, 'error');
            return;
        }
        await enqueueOpen(async () => {
            let text: string;
            try {
                text = decodeGedcomFile(buffer);
            } catch {
                await this.showAlert(strings.gedcom.parseError, 'error');
                return;
            }
            await this.openGedcomText(text);
        });
    },

    /** B. ?import-url=: a file offered by Strom Research on this computer. */
    async importResearchFromUrl(raw: string): Promise<void> {
        const url = parseLoopbackUrl(raw);
        if (!url) {
            this.showToast(strings.research.notLocal, 6000);
            return;
        }
        if (DataManager.isViewMode()) {
            this.showToast(strings.research.notInViewMode, 5000);
            return;
        }
        await enqueueOpen(async () => {
            let text: string;
            try {
                text = await fetchGedcomText(url.href);
            } catch (err) {
                console.warn('Fetching the research failed', err);
                await this.offerManualImport(strings.research.fetchFailed);
                return;
            }
            await this.openGedcomText(text);
        });
    },

    /** The browser refused the local address: explain, offer the file picker. */
    async offerManualImport(message: string): Promise<void> {
        // Safari blocks the local connection for good: say so and point to
        // the ways that work there (another browser, or drag the file in).
        const safari = typeof navigator !== 'undefined' && isSafariBrowser(navigator.userAgent || '');
        if (safari) message = strings.research.safariBlocked;
        const pick = await this.showConfirm(message, strings.research.fetchFailedTitle, {
            ok: strings.research.importManually,
            cancel: strings.research.close,
        });
        if (pick) this.startGedcomImportPlain();
    },

    // ==================== THE SHARED FLOW ====================

    /**
     * GEDCOM text from outside. A Strom Research file opens its research
     * tree; any other GEDCOM goes to the normal import dialog.
     */
    async openGedcomText(text: string): Promise<void> {
        if (DataManager.isViewMode()) {
            this.showToast(strings.research.notInViewMode, 5000);
            return;
        }
        const header = readResearchHeader(text);
        let result;
        try {
            result = convertToStrom(parseGedcom(text));
        } catch (err) {
            console.error('GEDCOM parse error:', err);
            await this.showAlert(strings.gedcom.parseError, 'error');
            return;
        }
        if (!header.isStromResearch) {
            // The same dialog as Import → GEDCOM (new tree / merge).
            this.importFromTreeManager = false;
            this.importToCurrentTree = false;
            this.gedcomResult = result;
            this.gedcomImportImages = null;
            this.showGedcomResultDialog();
            return;
        }
        if (!await this.ensureLocalUnlocked()) return;
        await this.applyResearch(result.data, header, {});
    },

    /**
     * Put a research into the right tree: create it the first time, update it
     * afterwards (asking when the user changed it in the app), switch to it.
     * Returns the tree, or null when the user cancelled.
     */
    async applyResearch(data: StromData, source: ResearchSource, opts: { head?: string; quiet?: boolean }): Promise<TreeId | null> {
        const name = source.name || strings.research.defaultName;
        const dateLabel = researchDateLabel(source.date);
        const existing = source.treeId ? TreeManager.findTreeByResearchId(source.treeId) : null;

        let previous: StromData | null = null;
        let includeImages = SettingsManager.isImportImages();
        let action = decideResearchOpen(null, null);
        let asCopy = false;
        if (existing) {
            const unreadable = TreeManager.isTreeUnreadable(existing.id);
            previous = unreadable ? null : await readTree(existing.id);
            action = decideResearchOpen(existing.research, previous ? fingerprintLike(previous, existing.research?.fingerprint) : null);
            if (unreadable || !previous) {
                // Cannot be read with this session's key: never overwrite it.
                asCopy = true;
            } else if (action === 'ask') {
                // Excerpts the user cut in this tree go with the update — say so.
                const ownExcerpts = Object.values(previous.sources ?? {}).some(src => src.excerpts?.length);
                const message = [strings.research.editedMessage(existing.name, TreeManager.isAutoBackupEnabled(existing.id)),
                    ownExcerpts ? strings.research.excerptsReplaced : ''].filter(Boolean).join('\n\n');
                const choice = await this.showChoice(
                    message,
                    strings.research.editedTitle,
                    [
                        { id: 'update', label: strings.research.update, variant: 'danger' },
                        { id: 'copy', label: strings.research.openCopy },
                    ],
                    incomingImageBytes(data) > 0
                        ? { label: strings.importImages.label, checked: includeImages,
                            detail: strings.importImages.size((incomingImageBytes(data) / (1024 * 1024)).toFixed(1)) }
                        : undefined
                );
                if (choice === null) return null;
                asCopy = choice === 'copy';
                if (incomingImageBytes(data) > 0) includeImages = this.choiceCheckboxChecked;
            }
        }
        // Images stay out when the user said so (the setting, or the checkbox).
        if (!includeImages) data = stripMedia(data);

        const previousTreeId = DataManager.getCurrentTreeId();
        let treeId: TreeId;
        let created = false;
        if (!existing || asCopy) {
            // The copy takes the link: the next open of this research updates
            // it, and the tree the user changed stays exactly as it is.
            if (existing) TreeManager.setResearchLink(existing.id, undefined);
            const treeName = existing ? strings.research.copyName(name, formatFlexDate(todayIso())) : name;
            treeId = await DataManager.importAsNewTree(data, treeName);
            created = true;
        } else {
            treeId = existing.id;
            if (existing.isHidden) TreeManager.setTreeVisibility(treeId, false);
            const stable = stabilizeIds(data, previous!);
            if (DataManager.getCurrentTreeId() !== treeId) {
                if (!await DataManager.switchTree(treeId)) return null;
                TreeRenderer.restoreFromSession();
            }
            // The user's own changes are about to be replaced: keep a backup.
            if (action === 'ask') await DataManager.snapshotNow('pre-import');
            DataManager.loadStromData(stable);
        }

        if (source.treeId) {
            TreeManager.setResearchLink(treeId, {
                id: source.treeId,
                fingerprint: contentFingerprint(DataManager.getData()),
                syncedAt: new Date().toISOString(),
                ...(opts.head ? { head: opts.head } : {}),
            });
        }

        const switched = previousTreeId !== treeId;
        this.updateTreeSwitcher();
        this.updateTreeManagerList();
        if (created) TreeRenderer.resetFocusHistory();
        await TreeRenderer.renderAsync();
        if (switched) {
            ZoomPan.centerOnFocusWithContext();
            if (!created) window.dispatchEvent(new CustomEvent('strom:tree-switched'));
        }
        this.refreshSearch();
        this.updateUrlTreeParam(treeId);

        const stored = DataManager.getData();
        // Count real people only: "?" placeholders (unknown partners) are not
        // part of the research and would inflate the summary.
        const persons = Object.values(stored.persons).filter(p => !p.isPlaceholder).length;
        const families = Object.keys(stored.partnerships).length;
        if (!opts.quiet) {
            this.showToast(created
                ? strings.research.opened(name, persons, families, dateLabel)
                : strings.research.updated(name, persons, families, dateLabel), 6000);
        }
        return treeId;
    },

    // ==================== D. LIVE BRIDGE ====================

    /** ?live=: follow a running research through its bridge on this computer. */
    async startLiveFollow(raw: string, opts: { resume?: boolean } = {}): Promise<void> {
        const bridge = parseLiveBridge(raw);
        if (!bridge) {
            if (opts.resume) forgetLiveBridge();
            else this.showToast(strings.research.notLocal, 6000);
            return;
        }
        if (DataManager.isViewMode()) {
            if (opts.resume) forgetLiveBridge();
            else this.showToast(strings.research.notInViewMode, 5000);
            return;
        }
        await enqueueOpen(async () => {
            if (!await this.ensureLocalUnlocked()) {
                if (opts.resume) forgetLiveBridge();
                return;
            }
            this.stopLiveFollow(true);

            let status: LiveStatus | null;
            let text: string;
            try {
                status = await fetchStatus(bridge.status);
                if (!status) throw new Error('bad status');
                if (!status.treeId) {
                    await this.showAlert(strings.research.liveNoTree, 'error');
                    return;
                }
                text = await fetchGedcomText(bridge.ged);
            } catch (err) {
                console.warn('Connecting to the research bridge failed', err);
                if (opts.resume) {
                    // The bridge stopped while the page reloaded (strom ends it
                    // after 2 h idle): nothing to import, just say so briefly.
                    forgetLiveBridge();
                    this.showToast(strings.research.ended, 4000);
                    return;
                }
                await this.offerManualImport(strings.research.liveFailed);
                return;
            }
            const header = readResearchHeader(text);
            if (header.treeId && header.treeId !== status.treeId) {
                await this.showAlert(strings.research.liveOtherTree, 'error');
                return;
            }
            let data: StromData;
            try {
                data = convertToStrom(parseGedcom(text)).data;
            } catch {
                await this.showAlert(strings.gedcom.parseError, 'error');
                return;
            }
            const name = status.name || header.name || strings.research.defaultName;
            const treeId = await this.applyResearch(
                data,
                { treeId: status.treeId, name, date: header.date },
                { head: status.head, quiet: opts.resume }
            );
            if (!treeId) {
                if (opts.resume) forgetLiveBridge();
                return;
            }
            rememberLiveBridge(bridge.base, treeId);

            live = {
                bridge,
                researchId: status.treeId,
                treeId,
                name,
                head: status.head,
                working: status.working,
                waiting: status.waiting,
                changes: [],
                ended: false,
                collapsed: isMobile(),
                seenChanges: 0,
                es: null,
                timer: null,
                failures: 0,
                chain: Promise.resolve(),
            };
            DataManager.setLiveTree(treeId);
            TreeRenderer.render();
            this.renderLivePanel();
            this.connectLiveEvents(live);
        });
    },

    /** Open the bridge's event stream (or poll its status without EventSource). */
    connectLiveEvents(s: LiveSession): void {
        if (s.ended || live !== s) return;
        if (typeof EventSource !== 'function') {
            this.scheduleLive(s, () => this.probeLive(s), POLL_MS);
            return;
        }
        let es: EventSource;
        try {
            es = new EventSource(s.bridge.events);
        } catch {
            this.scheduleLive(s, () => this.probeLive(s), POLL_MS);
            return;
        }
        s.es = es;
        const payload = (e: Event): unknown => parseEventData((e as MessageEvent).data);
        es.addEventListener('hello', (e) => {
            s.failures = 0;
            const status = sanitizeLiveStatus(payload(e));
            if (status) this.onLiveStatus(s, status);
        });
        es.addEventListener('change', (e) => {
            s.failures = 0;
            const change = sanitizeLiveChange(payload(e));
            if (change) this.enqueueLive(s, () => this.onLiveChange(s, change));
        });
        es.addEventListener('working', (e) => {
            s.working = sanitizeWorking(payload(e));
            this.renderLivePanel();
        });
        es.onerror = () => {
            if (s.es !== es) return;
            // The stream dropped: find out whether the bridge is still there
            // before reconnecting (EventSource alone would retry forever).
            es.close();
            s.es = null;
            void this.probeLive(s);
        };
    },

    /** Ask the bridge for its status: alive → reconnect; gone → ended. */
    async probeLive(s: LiveSession): Promise<void> {
        if (s.ended || live !== s) return;
        try {
            const status = await fetchStatus(s.bridge.status);
            if (!status) throw new Error('bad status');
            s.failures = 0;
            this.onLiveStatus(s, status);
            if (s.ended) return;
            if (typeof EventSource === 'function') this.scheduleLive(s, () => this.connectLiveEvents(s), RECONNECT_MS);
            else this.scheduleLive(s, () => this.probeLive(s), POLL_MS);
        } catch {
            s.failures++;
            if (s.failures >= MAX_FAILURES) this.endLiveFollow(s, 'ended');
            else this.scheduleLive(s, () => this.probeLive(s), RECONNECT_MS);
        }
    },

    scheduleLive(s: LiveSession, run: () => void, ms: number): void {
        if (s.timer) clearTimeout(s.timer);
        s.timer = setTimeout(() => {
            s.timer = null;
            if (!s.ended && live === s) run();
        }, ms);
    },

    enqueueLive(s: LiveSession, job: () => Promise<void>): void {
        s.chain = s.chain.then(job).catch((err) => console.warn('Live update failed', err));
    },

    /** A status (hello or probe): lists for the panel; a new head means a missed change. */
    onLiveStatus(s: LiveSession, status: LiveStatus): void {
        if (status.treeId && status.treeId !== s.researchId) {
            this.endLiveFollow(s, 'other');
            return;
        }
        s.working = status.working;
        s.waiting = status.waiting;
        if (status.head && status.head !== s.head) {
            this.enqueueLive(s, () => this.onLiveChange(s, { head: status.head, what: [], at: '' }));
        }
        this.renderLivePanel();
    },

    /** A change: refresh the tree, list what changed, light up those people. */
    async onLiveChange(s: LiveSession, change: LiveChange): Promise<void> {
        if (s.ended || live !== s) return;
        // A reconnect replays the last change; the tree already has it.
        if (change.head && change.head === s.head) return;
        const data = await this.refreshLiveTree(s, change.head);
        if (!data) return;
        const refs = extractChangedRefs(change.what);
        const changedIds = personsByRefs(data, refs);
        const nameOf = (ref: string): string | null => {
            const [id] = personsByRefs(data, [ref]);
            const p = id ? data.persons[id] : undefined;
            return p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || null : null;
        };
        const items: LiveChangeItem[] = change.what.map((line) => ({
            text: humanizeChange(line, nameOf, strings.research.changeWords),
            at: change.at,
            personIds: personsByRefs(data, extractChangedRefs([line])),
        }));
        s.changes = [...items.reverse(), ...s.changes].slice(0, MAX_CHANGES);
        if (DataManager.getCurrentTreeId() === s.treeId) {
            TreeRenderer.setChangedIds(new Set(changedIds));
            // The highlight marks what just came; it goes after a while.
            if (highlightTimer) clearTimeout(highlightTimer);
            highlightTimer = setTimeout(() => {
                highlightTimer = null;
                if (live === s) TreeRenderer.setChangedIds(null);
            }, HIGHLIGHT_MS);
        }
        this.renderLivePanel();
    },

    /** Fetch the research's current GEDCOM and put it into the followed tree only. */
    async refreshLiveTree(s: LiveSession, head: string): Promise<StromData | null> {
        let text: string;
        try {
            text = await fetchGedcomText(s.bridge.ged);
        } catch {
            // The probe after the stream error decides whether the bridge is gone.
            return null;
        }
        if (s.ended || live !== s) return null;
        const header = readResearchHeader(text);
        if (header.treeId && header.treeId !== s.researchId) {
            this.endLiveFollow(s, 'other');
            return null;
        }
        let data: StromData;
        try {
            data = convertToStrom(parseGedcom(text)).data;
        } catch {
            return null;
        }
        // Following live asks nothing: the setting decides about images.
        if (!SettingsManager.isImportImages()) data = stripMedia(data);
        if (!TreeManager.getTreeMetadata(s.treeId)) {
            // The user deleted the followed tree: stop, never recreate it.
            this.endLiveFollow(s, 'ended');
            return null;
        }
        const active = DataManager.getCurrentTreeId() === s.treeId;
        const previous = await readTree(s.treeId);
        const stable = migrateData(previous ? stabilizeIds(data, previous) : data);
        if (active) {
            DataManager.replaceWithSourceData(stable);
            this.refreshSearch();
        } else {
            TreeManager.updateTreeFromImport(s.treeId, stable);
        }
        if (head) s.head = head;
        TreeManager.setResearchLink(s.treeId, {
            id: s.researchId,
            fingerprint: contentFingerprint(active ? DataManager.getData() : stable),
            syncedAt: new Date().toISOString(),
            ...(s.head ? { head: s.head } : {}),
        });
        return active ? DataManager.getData() : stable;
    },

    /** The user stops following (or a new ?live= replaces the session). */
    stopLiveFollow(silent = false): void {
        const s = live;
        if (!s) return;
        this.endLiveFollow(s, 'stopped');
        if (!silent) this.showToast(strings.research.stopped);
    },

    /** End a session: close the stream, lift read-only, keep the last state. */
    endLiveFollow(s: LiveSession, reason: 'ended' | 'other' | 'stopped'): void {
        if (live !== s) return;
        forgetLiveBridge();
        const wasEnded = s.ended;
        s.ended = true;
        if (s.timer) clearTimeout(s.timer);
        s.timer = null;
        try {
            s.es?.close();
        } catch { /* already closed */ }
        s.es = null;
        if (DataManager.getLiveTreeId() === s.treeId) DataManager.setLiveTree(null);
        if (reason === 'stopped') {
            live = null;
            TreeRenderer.setChangedIds(null);
        } else if (!wasEnded && reason === 'other') {
            this.showToast(strings.research.liveOtherTree, 6000);
        }
        if (DataManager.getCurrentTreeId() === s.treeId) TreeRenderer.render();
        this.renderLivePanel();
    },

    /** Close the "following ended" panel. */
    closeLivePanel(): void {
        if (live && !live.ended) return;
        live = null;
        TreeRenderer.setChangedIds(null);
        this.renderLivePanel();
    },

    toggleLivePanel(): void {
        if (!live) return;
        live.collapsed = !live.collapsed;
        if (live.collapsed) live.seenChanges = live.changes.length;
        this.renderLivePanel();
    },

    syncLivePanelVisibility(): void {
        const panel = document.getElementById('live-panel');
        if (!panel || !live) return;
        panel.hidden = DataManager.getCurrentTreeId() !== live.treeId;
    },

    /** Draw the "Research now" panel. Bridge text is set as text, never HTML. */
    renderLivePanel(): void {
        const s = live;
        let panel = document.getElementById('live-panel');
        if (!s) {
            panel?.remove();
            return;
        }
        if (!panel) {
            panel = el('aside', 'live-panel');
            panel.id = 'live-panel';
            panel.setAttribute('role', 'region');
            document.body.appendChild(panel);
        }
        const r = strings.research;
        panel.setAttribute('aria-label', r.panelLabel);
        panel.classList.toggle('ended', s.ended);
        panel.classList.toggle('collapsed', s.collapsed);
        panel.hidden = DataManager.getCurrentTreeId() !== s.treeId;
        panel.replaceChildren();

        const head = el('div', 'live-panel-head');
        head.appendChild(el('span', 'live-dot'));
        const toggle = el('button', 'live-panel-toggle');
        toggle.type = 'button';
        toggle.setAttribute('aria-expanded', String(!s.collapsed));
        toggle.title = s.collapsed ? r.show : r.hide;
        toggle.onclick = () => this.toggleLivePanel();
        toggle.appendChild(el('span', 'live-panel-title', s.ended ? r.ended : r.panelTitle));
        const chevron = el('span', 'live-panel-chevron');
        chevron.setAttribute('aria-hidden', 'true');
        chevron.innerHTML = iconSvg('chevron-down', { size: 14 });
        toggle.appendChild(chevron);
        head.appendChild(toggle);
        const action = el('button', 'live-panel-action', s.ended ? r.close : r.stop);
        action.type = 'button';
        action.onclick = () => (s.ended ? this.closeLivePanel() : this.stopLiveFollow());
        head.appendChild(action);
        panel.appendChild(head);
        // Collapsed: what the hidden body would say first — new changes, and
        // that the tree cannot be edited meanwhile.
        if (s.collapsed) {
            const fresh = s.changes.length - s.seenChanges;
            const summary = el('div', 'live-panel-summary');
            if (fresh > 0) summary.appendChild(el('span', 'live-panel-chip live-panel-new', r.newChanges(fresh)));
            if (!s.ended) summary.appendChild(el('span', 'live-panel-chip', r.readOnly));
            if (summary.childElementCount > 0) panel.appendChild(summary);
        }

        const body = el('div', 'live-panel-body');
        body.appendChild(el('p', 'live-panel-state', s.ended ? r.endedText : r.following(s.name)));

        const section = (title: string, cls: string): HTMLUListElement => {
            body.appendChild(el('h4', 'live-panel-heading', title));
            const list = el('ul', `live-panel-list ${cls}`);
            body.appendChild(list);
            return list;
        };

        // Once following has ended the bridge's "who is working" is stale —
        // show it only while live.
        const working = s.ended ? null : section(r.atWork, 'live-working');
        if (working && s.working.length === 0) working.appendChild(el('li', 'live-empty', r.nobodyWorking));
        if (working) for (const w of s.working) {
            const li = el('li');
            li.appendChild(el('strong', undefined, w.who));
            if (w.task) li.appendChild(el('span', 'live-task', ` — ${w.task}`));
            const since = timeEl(w.since, 'since');
            if (since) li.appendChild(since);
            working.appendChild(li);
        }

        // Every change row looks the same; one that names a person in the
        // tree is a button (hover background) that shows that person.
        const changes = section(r.changes, 'live-changes');
        if (s.changes.length === 0) changes.appendChild(el('li', 'live-empty', r.noChanges));
        for (const c of s.changes) {
            const li = el('li');
            const target = c.personIds[0];
            const row = target ? el('button', 'live-change live-change-link') : el('div', 'live-change');
            row.appendChild(el('span', 'live-change-text', c.text));
            const at = timeEl(c.at, 'ago');
            if (at) row.appendChild(at);
            if (target && row instanceof HTMLButtonElement) {
                row.type = 'button';
                row.title = r.showInTree;
                row.onclick = () => {
                    if (!DataManager.getPerson(target)) return;
                    TreeRenderer.setFocus(target);
                    void TreeRenderer.renderAsync().then(() => ZoomPan.centerOnFocusWithContext());
                };
            }
            li.appendChild(row);
            changes.appendChild(li);
        }

        if (s.waiting.length > 0) {
            const waiting = section(r.waiting, 'live-waiting');
            for (const w of s.waiting) {
                const li = el('li', undefined, w.what);
                // "on" is the agent's free text; "user" only repeats the heading.
                if (!waitsOnUser(w.on)) li.appendChild(el('small', 'live-time', r.waitingOn(w.on!)));
                waiting.appendChild(li);
            }
            if (!s.ended) body.appendChild(el('p', 'live-panel-hint', r.waitingHint));
        }
        panel.appendChild(body);
        placeLivePanel(panel);
        if (!timeTicker) timeTicker = setInterval(tickLiveTimes, TIME_TICK_MS);
    },

    /** Re-place the panel (window resized, a bar appeared). */
    placeLivePanel(): void {
        const panel = document.getElementById('live-panel');
        if (panel) placeLivePanel(panel);
    },
});
