/**
 * Images and the answer of an awaiting task outside the overview's detail
 * (spec 048 §3, §7, §8): "Add images" in the overview's detail or in a
 * dialog of the small panel, a file dropped on a row, the small panel's one
 * main action of an item, its dialog for the images and the answer, and the
 * phone's full-screen sheet for the answer. What goes through the bridge has
 * no mark; a terminal action keeps its mark.
 */

import { browserNote } from '../research-browser.js';
import { isHelpOpen } from './help-ui.js';
import { strings } from '../strings.js';
import { LiveWaiting, researchLinkMark, researchTaskRef } from '../research-link.js';
import { WaitActionView, deliverSentence, deliverSteps, deliverWebUrl, imagesState, waitingActions, waitingDeliver } from '../research-waiting.js';
import { bookById } from '../research-books.js';
import { DEFAULT_MEDIA_MAX_BYTES } from '../originals.js';
import { MQ_PHONE_BAR, isPhoneBar } from '../breakpoints.js';
import { researchOpenSrText, setResearchActionLabel } from './research-open-mark.js';
import { uiModule } from './module.js';
import { shiftHeld } from './busy.js';
import type { ToastWorkEnd } from './toast.js';
import { WAITING_ROWS_SCOPE } from './waiting-row-notes.js';
import { el, liveSession, LiveSession, researchSession } from './research-ui.js';
import { rangesWhole } from './ranges-whole.js';
import { UploadNumbers, UploadOutcome, WaitingImagesUpload } from './waiting-images-upload.js';
import { WaitingAnswerForm, waitingAnswerChangedNote } from './waiting-answer-form.js';
import { bindImagesDrop, imagesShortEl, itemKey } from './waiting-images-ui.js';
import {
    auditChangeLines, auditExplain, auditFixError, auditLeftLines, type AuditFixError, type AuditPreview, type WaitingAudit,
} from '../research-audit.js';
import {
    getWaitingAuditPreview, postWaitingAudit, type WaitingAuditPreviewResult, type WaitingAuditResult, type WaitingWriteRefused,
} from '../research-waiting-write.js';

const DIALOG_ID = 'waiting-dialog';
const SHEET_ID = 'waiting-answer-sheet';

type UploadPlace = 'ov' | 'dlg';

/** The upload areas by place and item: the files chosen stay while it is closed (until Cancel or sent). */
const uploads = new Map<string, WaitingImagesUpload>();
/** The overview's item whose upload area is open, and the line each item's last upload left (until its detail folds). */
let overviewImagesKey: string | null = null;
const overviewResults = new Map<string, string>();
/** The small panel's dialog (its item and what it shows) and how it is let go. */
let dialogFor: { key: string; kind: 'images' | 'answer' } | null = null;
let dialogCleanup: (() => void) | null = null;
/** Answer forms of the panel's dialog and the phone's sheet (their drafts are kept per tree and task anyway). */
const dialogForms = new Map<string, WaitingAnswerForm>();
const sheetForms = new Map<string, WaitingAnswerForm>();
let sheetCleanup: (() => void) | null = null;

function isPhone(): boolean {
    return !!window.matchMedia?.(MQ_PHONE_BAR).matches;
}

/** The line the item's last upload left in its detail. */
export function overviewImagesResult(key: string): string | null {
    return overviewResults.get(key) ?? null;
}

/** The item's detail folds: its upload area closes (unless files are being sent; the files chosen stay) and its line goes. */
export function foldOverviewImages(key: string): void {
    overviewResults.delete(key);
    if (overviewImagesKey === key && !uploads.get(`ov|${key}`)?.sending) overviewImagesKey = null;
}

/** The overview closes: no upload area open, no line kept. */
export function clearOverviewImages(): void {
    overviewImagesKey = null;
    overviewResults.clear();
}

/** A window key handler taking Escape before everything else (the overview's, the page's). */
function onEscape(run: () => void): () => void {
    const onKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape' || e.isComposing || isHelpOpen()) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        run();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
}

/**
 * A finding row's state by item (tree|id; spec 109 §2.1), kept outside the
 * list so it survives every re-render (new data of the bridge):
 * `keeping` while "Leave as is" is written, `kept` once written (the row
 * stays hidden while the status still carries that finding's stamp). The
 * fix's own states (loading, preview, writing) are kept here too, by
 * `openWaitingAuditFix` (its preview replaces the row's actions).
 */
export interface AuditUiState {
    /**
     * `keeping`/`kept`: Leave as is written / done; `loading`: the fix's
     * preview read; `preview`: shown (its footer's Fix asks for the write);
     * `busy`: the fix written; `fixed`/`gone`: written, or the finding gone —
     * the row hidden until the status no longer carries that stamp; `idle`:
     * the row's actions again, with why the preview was not read.
     */
    phase: 'keeping' | 'kept' | 'loading' | 'preview' | 'busy' | 'fixed' | 'gone' | 'idle';
    /** The finding's stamp the state belongs to (another one: the state is dropped, an open preview says it changed). */
    stamp: string;
    /** The research's preview (preview, busy). */
    preview?: AuditPreview;
    /** Why the last read or write was refused (said in the preview, or under the row's actions). */
    error?: AuditFixError;
    /** The preview read again (Reload after the task changed). */
    reloading?: boolean;
}

const auditStates = new Map<string, AuditUiState>();
/** Where each item's finding row was drawn last (a phone's sheet: the preview is a sheet of its own). */
const auditDrawnIn = new Map<string, AuditMode>();

/** Where the overview is drawn (its docked column, over the tree, the phone's sheet, its own window). */
export type AuditMode = 'docked' | 'overlay' | 'sheet' | 'window';

/** The finding row's state of an item (none: idle). */
export function waitingAuditState(key: string): AuditUiState | null {
    return auditStates.get(key) ?? null;
}

/** Set (or clear) the finding row's state of an item. */
export function setWaitingAuditState(key: string, state: AuditUiState | null): void {
    if (state) auditStates.set(key, state);
    else auditStates.delete(key);
}

/**
 * The finding to show at an item (null: none — an older research, no
 * finding, or one just left as it is). A state of a finding the status no
 * longer carries goes.
 */
export function waitingAuditShown(s: { treeId: string } | null, w: LiveWaiting): WaitingAudit | null {
    const key = s ? itemKey(s, w.id) : null;
    const st = key ? auditStates.get(key) : undefined;
    if (st && st.stamp !== w.audit?.stamp) {
        // An open preview of a task that changed meanwhile stays, saying so (Reload reads it again).
        if (w.audit && st.preview && (st.phase === 'preview' || st.phase === 'busy')) {
            st.stamp = w.audit.stamp;
            if (st.phase === 'preview') st.error = 'changed';
            return w.audit;
        }
        auditStates.delete(key!);
        return w.audit ?? null;
    }
    if (!w.audit || st?.phase === 'kept' || st?.phase === 'fixed' || st?.phase === 'gone') return null;
    return w.audit;
}

/** The item just fixed (tree|id): its title focused and scrolled into view once drawn, again when the new status moves it. */
let fixedFocus: string | null = null;

/**
 * The item just fixed, drawn (spec 109 §2.4): its row (the title) in view
 * and focused, unless the focus went elsewhere meanwhile. Its key goes once
 * the status no longer carries the finding (the item stands where it now
 * belongs).
 */
export function auditFixedRowDrawn(key: string, row: HTMLElement): void {
    if (fixedFocus !== key) return;
    if (!auditStates.has(key)) fixedFocus = null;
    row.dataset.focusKey = `audit-fixed|${key}`;
    queueMicrotask(() => {
        if (!row.isConnected) return;
        const a = document.activeElement;
        if (a && a !== document.body && a !== row && a.isConnected && !a.closest('.waiting-audit')) return;
        row.scrollIntoView?.({ block: 'nearest' });
        row.focus({ preventScroll: true });
    });
}

/** Why the fix's preview or write was refused, said in the footer (or under the row's actions); '' for none or a change. */
function auditErrorText(error: AuditFixError | undefined): string {
    const A = strings.live.waitingAudit;
    switch (error) {
        case 'busy': return A.auditErr503;
        case 'locked': return A.auditErrLocked;
        case 'disk': return A.auditErrDisk;
        case 'other': return strings.live.waitingWrite.failed;
        default: return '';
    }
}

/** The phone's preview sheet (spec 109 §2.3): its item and how it is let go. */
const AUDIT_SHEET_ID = 'waiting-audit-sheet';
let auditSheetFor: string | null = null;
let auditSheetCleanup: (() => void) | null = null;

/** The folder's small icon before its line. */
function folderIcon(): SVGSVGElement {
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '12');
    svg.setAttribute('viewBox', '0 0 14 12');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS(svgNs, 'path');
    path.setAttribute('d', 'M1 2.2c0-.6.4-1 1-1h3.2l1.3 1.4H12c.6 0 1 .4 1 1V10c0 .6-.4 1-1 1H2c-.6 0-1-.4-1-1z');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.1');
    svg.appendChild(path);
    return svg;
}

/** A small spinner (still with reduced motion). */
function spinner(): HTMLElement {
    const spin = el('i', 'busy-spin');
    spin.setAttribute('aria-hidden', 'true');
    return spin;
}

/** The overview's item of a task (its own window's too). */
function overviewItemEl(id: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`#research-overview .research-overview__waiting-item[data-id="${CSS.escape(id)}"]`);
}

/** A refusal of the overview window's main window, typed again (untrusted: only its code, status and held kind). */
export function auditRefusalOf(v: unknown): WaitingWriteRefused {
    const r = v && typeof v === 'object' ? v as Record<string, unknown> : {};
    const code = typeof r.code === 'string' && /^[a-z-]{1,30}$/.test(r.code) ? r.code as WaitingWriteRefused['code'] : 'network';
    const held = r.held && typeof r.held === 'object' ? r.held as Record<string, unknown> : null;
    const kind = held && (held.kind === 'disk' || held.kind === 'seal' || held.kind === 'cloud') ? held.kind : null;
    return {
        ok: false, code, status: typeof r.status === 'number' ? r.status : 0, retryAfter: null, reason: '',
        ...(kind ? { held: { kind, said: typeof held!.said === 'string' ? held!.said.slice(0, 400) : '' } } : {}),
    };
}

/** The finding's mark: a small warning triangle (its title and label: what it means; `decorative`: the text beside says it). */
export function waitingAuditMarkEl(title: string, decorative = false): HTMLElement {
    const mark = el('span', 'waiting-audit-mark');
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('viewBox', '0 0 14 14');
    svg.setAttribute('focusable', 'false');
    if (decorative) {
        svg.setAttribute('aria-hidden', 'true');
    } else {
        mark.title = title;
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', title);
    }
    for (const [cls, d] of [['tri', 'M7 1.2 13.2 12.4H.8Z'], ['ink', 'M6.3 5h1.4l-.2 4.1h-1zM7 10.1a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6z']]) {
        const path = document.createElementNS(svgNs, 'path');
        path.setAttribute('class', cls);
        path.setAttribute('d', d);
        svg.appendChild(path);
    }
    mark.appendChild(svg);
    return mark;
}

/** The research takes no write now: it ended, or its bridge is lost (the last known items and findings stay). */
export function auditResearchUnavailable(s: LiveSession): boolean {
    return s.ended || s.lostSince !== null;
}

export const waitingTaskMethods = uiModule({
    /**
     * The task's numbers as the research says them now: those asked for
     * (null: not known) and those saved; at a task that does not know how
     * many it wants, the book's next free number (K044).
     */
    waitingImagesNumbers(s: LiveSession, id: string): UploadNumbers {
        const w = s.waiting.find(x => x.id === id);
        const img = w ? imagesState(w) : null;
        const next = img?.detail === 'unknown' ? w?.inbox?.next : undefined;
        if (!img || img.detail !== 'full' || !img.wanted) return { want: null, have: [], ...(next !== undefined ? { next } : {}) };
        return { want: [...img.wanted], have: [...(img.saved ?? [])] };
    },

    /** The upload area of an item in a place, the same over every redraw (its files, their numbers, how they go). */
    waitingImagesUpload(s: LiveSession, w: LiveWaiting, place: UploadPlace): WaitingImagesUpload | null {
        const task = researchTaskRef(w.id);
        if (!task) return null;
        const key = `${place}|${itemKey(s, w.id)}`;
        const have = uploads.get(key);
        if (have) return have;
        const upload = new WaitingImagesUpload({
            idPrefix: `${place}-images-${w.id.replace(/[^A-Za-z0-9_-]/g, '_')}`,
            maxBytes: s.accepts?.mediaMaxBytes ?? DEFAULT_MEDIA_MAX_BYTES,
            numbers: () => this.waitingImagesNumbers(s, w.id),
            upload: (file, opts) => this.uploadWaitingImage(s, task, file, opts),
            narrow: place === 'dlg',
            done: (outcome) => {
                uploads.delete(key);
                this.waitingImagesDone(s, w, place, outcome);
            },
            cancel: () => {
                uploads.delete(key);
                if (place === 'ov') this.closeOverviewImages(s, w);
                else this.closeWaitingDialog();
            },
        });
        uploads.set(key, upload);
        return upload;
    },

    /** Every file went: the area closes, the line (overview) or the toast (panel) says how it stands. */
    waitingImagesDone(s: LiveSession, w: LiveWaiting, place: UploadPlace, outcome: UploadOutcome): void {
        const key = itemKey(s, w.id);
        const text = this.settleWaitingImages(s, w, outcome);
        if (place === 'ov') {
            if (overviewImagesKey === key) overviewImagesKey = null;
            if (text) overviewResults.set(key, text);
            if (researchSession() === s && s.overview) {
                this.renderResearchOverview();
                document.querySelector<HTMLElement>(`#research-overview .research-overview__waiting-item[data-id="${CSS.escape(w.id)}"] [data-action="images"]`)?.focus();
            }
        } else {
            if (dialogFor?.key === key && dialogFor.kind === 'images') this.closeWaitingDialog();
            if (text) this.showToast(text, 6000, { kind: 'waiting-images' });
        }
    },

    /**
     * "Add images" at an item (spec 048 §3): in the overview, the upload area
     * opens in its detail; from the small panel, in a dialog; dropped files
     * come in at once. Only with `accepts.media.taskImages`, never on a phone.
     */
    openWaitingImages(s: LiveSession, w: LiveWaiting, files?: readonly File[]): void {
        if (!this.liveWaitingWrites(s).images || !researchTaskRef(w.id) || isPhone()) return;
        if (s.overview && document.getElementById('research-overview')) this.openOverviewImages(s, w, files);
        else this.openWaitingDialog(s, w, 'images', files);
    },

    /** The upload area in the overview's detail of the item (opened, the actions hide meanwhile). */
    openOverviewImages(s: LiveSession, w: LiveWaiting, files?: readonly File[]): void {
        const upload = this.waitingImagesUpload(s, w, 'ov');
        if (!upload) return;
        const key = itemKey(s, w.id);
        this.closeOverviewAnswer();
        this.closeWaitingMoreMenu();
        overviewImagesKey = key;
        overviewResults.delete(key);
        s.waitingView.detail = w.id;
        if (files && files.length > 0) upload.addFiles(files);
        this.renderResearchOverview();
        if (upload.root.isConnected) {
            upload.root.scrollIntoView?.({ block: 'nearest' });
            upload.focus();
        }
    },

    closeOverviewImages(s: LiveSession, w: LiveWaiting): void {
        if (overviewImagesKey === itemKey(s, w.id)) overviewImagesKey = null;
        if (researchSession() !== s || !s.overview) return;
        this.renderResearchOverview();
        document.querySelector<HTMLElement>(`#research-overview .research-overview__waiting-item[data-id="${CSS.escape(w.id)}"] [data-action="images"]`)?.focus();
    },

    /** The overview's detail of an item with its upload area open: the area (null: not open). */
    overviewImagesArea(s: LiveSession, w: LiveWaiting): HTMLElement | null {
        if (overviewImagesKey !== itemKey(s, w.id)) return null;
        return this.waitingImagesUpload(s, w, 'ov')?.root ?? null;
    },

    // ==================== DELIVERING IMAGES (spec 105 U4 §5) ====================

    /** An item takes images through the bridge (on a computer): it is drawn as images to deliver, not an answer. */
    waitingTakesImages(s: LiveSession, w: LiveWaiting): boolean {
        return !!waitingActions(w, { writes: this.liveWaitingWrites(s), links: false, phone: false })?.some(v => v.key === 'images');
    },

    /** The answer's heading and hint of an item: one taking images says why they cannot be had (5b). */
    waitingAnswerTexts(s: LiveSession, w: LiveWaiting): { label?: string; hint?: string } {
        if (!this.waitingTakesImages(s, w)) return {};
        const T = strings.live.waitingTask;
        return { label: T.answerImagesLabel, hint: T.answerImagesHint };
    },

    /**
     * The Deliver block of an item taking images (spec 105 U4 §5, 5a–5h): what
     * is delivered (the numbers still missing, as files, into the book's or
     * the task's folder), then on a computer the steps in their order —
     * ① the archive's website ↗, ② its folder (the book's through the bridge,
     * no mark; otherwise the task's, the terminal mark; the sentence names
     * the same folder), ③ "Add images"
     * the one main action — a step that cannot go from here is left out and
     * the next takes its number; arrows between them, each with the step it
     * leads to (never at the end of a line), under each other in a
     * narrow column (`column`, or the phase's container under 380 px). A
     * phone: the sentence and where images are saved, no steps. `upload`:
     * the upload area stands under the block (the panel's dialog), the
     * last step it is, no button for it. `retryMain`: "Retry with the agent"
     * is the item's main action (spec 089 §1.2), ③ outlined then.
     */
    waitingDeliverEl(s: LiveSession, w: LiveWaiting, opts: { phone: boolean; steps: boolean; column?: boolean; upload?: boolean; retryMain?: boolean }): HTMLElement {
        const L = strings.live;
        const T = L.waitingTask;
        const box = el('div', 'research-overview__waiting-deliver');
        const book = bookById(s, w.book);
        // The book's folder through the bridge (as in its band); else the task's, in the terminal.
        const bookFolder = w.book && book?.folder ? this.activeResearchLink('book', { book: w.book, bookDo: 'folder' }) : null;
        box.appendChild(el('span', 'research-overview__deliver-label', T.deliverLabel));
        // The sentence names the folder the folder step opens (a phone: the book's when the research has it).
        box.appendChild(el('p', 'research-overview__deliver-text', deliverSentence(waitingDeliver(w, s.books, opts.phone || !!bookFolder), T)));
        if (opts.phone) {
            box.appendChild(el('p', 'research-overview__deliver-phone', T.deliverPhone));
            return box;
        }
        if (!opts.steps) return box;
        const task = researchTaskRef(w.id);
        const views = waitingActions(w, { writes: this.liveWaitingWrites(s), links: this.researchLinkAvailable('task'), phone: false }) ?? [];
        const web = deliverWebUrl(w, book);
        const taskFolder = !bookFolder && task && views.some(v => v.key === 'folder') ? this.activeResearchLink('task', { task, taskDo: 'folder' }) : null;
        const steps = deliverSteps({ web, folder: !!(bookFolder || taskFolder), images: !opts.upload && views.some(v => v.key === 'images') });
        if (steps.length === 0) return box;
        const total = steps.length + (opts.upload ? 1 : 0);
        const row = el('div', `research-overview__deliver-steps${opts.column ? ' is-column' : ''}`);
        steps.forEach((step, i) => {
            // The arrow goes with the step it leads to (one unit that does not wrap): never left at the end of a line.
            let slot: HTMLElement = row;
            if (i > 0) {
                slot = el('span', 'research-overview__deliver-pair');
                const arrow = el('span', 'research-overview__deliver-arrow', '→');
                arrow.setAttribute('aria-hidden', 'true');
                slot.appendChild(arrow);
                row.appendChild(slot);
            }
            const item = el('span', 'research-overview__deliver-step');
            const num = el('span', 'research-overview__deliver-num', String(i + 1));
            num.setAttribute('aria-hidden', 'true');
            item.appendChild(num);
            let action: HTMLElement;
            if (step === 'web') {
                const a = el('a', 'waiting-action waiting-action--link research-overview__deliver-web', T.archiveWeb);
                a.href = web!;
                a.title = web!;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.setAttribute('aria-label', T.stepAria(i + 1, total, T.archiveWeb));
                a.onclick = (e) => e.stopPropagation();
                action = a;
            } else {
                const filled = step === 'images' && !opts.retryMain;
                const btn = el('button', `waiting-action ${filled ? 'waiting-action--primary' : 'waiting-action--secondary'} research-overview__waiting-action`);
                btn.type = 'button';
                if (step === 'images') {
                    btn.textContent = T.haveImages;
                    btn.dataset.write = 'bridge';
                    btn.setAttribute('aria-label', T.stepAria(i + 1, total, T.haveImages));
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        this.openWaitingImages(s, w);
                    };
                } else if (bookFolder) {
                    setResearchActionLabel(btn, L.books.folderBook, researchLinkMark('book'), { sr: false });
                    btn.dataset.book = w.book!;
                    btn.setAttribute('aria-label', T.stepAria(i + 1, total, L.books.folderBook));
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        this.launchResearchLink(bookFolder);
                    };
                } else {
                    const mark = researchLinkMark('task', { taskDo: 'folder' });
                    setResearchActionLabel(btn, T.openFolder, mark, { sr: false });
                    btn.setAttribute('aria-label', `${T.stepAria(i + 1, total, T.openFolder)}${mark === 'none' ? '' : researchOpenSrText(mark === 'agent')}`);
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        this.launchResearchLink(taskFolder!);
                    };
                }
                action = btn;
            }
            action.dataset.action = step;
            item.appendChild(action);
            slot.appendChild(item);
        });
        box.appendChild(row);
        return box;
    },

    // ==================== SMALL PANEL ====================

    /**
     * A row of the small panel waiting for images, a website or a check
     * (spec 048 §7): its images' short state and ONE action, the main one of
     * its kind (Add images, Open website ↗, Answer); Add images and Answer
     * through the bridge open a dialog; a terminal action keeps its mark.
     * Files dropped on the row open the dialog with them. False: not such an
     * item (its row stays as before).
     */
    appendPanelWaitingTask(li: HTMLElement, what: HTMLElement, s: LiveSession, w: LiveWaiting): boolean {
        const phone = isPhone();
        const views = waitingActions(w, { writes: this.liveWaitingWrites(s), links: !phone && this.researchLinkAvailable('task'), phone });
        if (!views) return false;
        // Two lines of its text beside the action (§7); the whole text on hover.
        what.classList.add('waiting-panel-what');
        if (!what.title && w.what) what.title = w.what;
        const img = imagesState(w);
        if (img) what.after(imagesShortEl(itemKey(s, w.id), img));
        const action = views[0] ? this.panelWaitingAction(s, w, views[0]) : null;
        if (action) li.appendChild(action);
        if (!phone && views.some(v => v.key === 'images')) {
            li.classList.add('takes-images');
            bindImagesDrop(li, (files) => this.openWaitingDialog(s, w, 'images', files));
        }
        return true;
    },

    /**
     * What "Answer" does at one waiting item, as its row's button in the
     * panel does: a task with images, a website or a check by its main action
     * (while following), a question about a place in the Places window, else
     * the task in the research by its link. Null: nothing answers it here.
     */
    waitingAnswerAction(w: LiveWaiting): (() => void) | null {
        const s = liveSession();
        if (s && !s.ended) {
            const phone = isPhone();
            const views = waitingActions(w, { writes: this.liveWaitingWrites(s), links: !phone && this.researchLinkAvailable('task'), phone });
            if (views) {
                const action = views[0] ? this.panelWaitingAction(s, w, views[0]) : null;
                return action ? () => action.click() : null;
            }
        }
        if (w.kind === 'place' && this.waitingPlacesAccess().canAnswer) return () => this.showWaitingPlaces(w.place ?? w.id);
        // A file of a book's inbox set aside: decided in the overview's row.
        if (w.kind === 'aside') return s && !s.ended && this.canExpandLivePanel() ? () => this.showOverviewWaitingItem(w.id) : null;
        if (this.canAnswerResearchWaiting(w)) return () => this.answerResearchTask(w);
        return null;
    },

    /**
     * The answer's control of one waiting item, as its row in the panel
     * Awaiting action draws it (the Table view's bubble, §16.4): while
     * following, the item's main action; a question about a place, its card;
     * else the task in the research by its link. Null: nothing answers it here.
     */
    waitingAnswerControl(w: LiveWaiting): HTMLElement | null {
        const s = liveSession();
        if (s && !s.ended) {
            const phone = isPhone();
            const views = waitingActions(w, { writes: this.liveWaitingWrites(s), links: !phone && this.researchLinkAvailable('task'), phone });
            if (views) return views[0] ? this.panelWaitingAction(s, w, views[0]) : null;
        }
        if (w.kind === 'place' && this.waitingPlacesAccess().canAnswer) {
            const place = el('button', 'live-waiting-answer', strings.places.waiting.answer);
            place.type = 'button';
            place.dataset.action = 'place';
            place.onclick = () => this.showWaitingPlaces(w.place ?? w.id);
            return place;
        }
        if (w.kind === 'aside') {
            // A file of a book's inbox set aside: decided in the overview's row (it opens there).
            if (!s || s.ended || !this.canExpandLivePanel()) return null;
            const open = el('button', 'live-waiting-answer', strings.live.aside.panelOpen);
            open.type = 'button';
            open.dataset.action = 'aside-open';
            open.onclick = () => this.showOverviewWaitingItem(w.id);
            return open;
        }
        if (!this.canAnswerResearchWaiting(w)) return null;
        const answer = setResearchActionLabel(el('button', 'live-waiting-answer'), strings.research.answer, researchLinkMark('task'));
        answer.type = 'button';
        answer.onclick = () => this.answerResearchTask(w);
        return answer;
    },

    panelWaitingAction(s: LiveSession, w: LiveWaiting, v: WaitActionView): HTMLElement | null {
        const T = strings.live.waitingTask;
        const cls = 'live-waiting-answer waiting-panel-action';
        if (v.key === 'web') {
            if (!w.url) return null;
            const a = el('a', `${cls} is-web`, T.openWeb);
            a.href = w.url;
            a.title = w.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.dataset.action = 'web';
            return a;
        }
        const btn = el('button', cls);
        btn.type = 'button';
        btn.dataset.action = v.key;
        if (v.via === 'bridge') {
            btn.classList.add('is-bridge');
            btn.dataset.write = 'bridge';
            btn.textContent = v.key === 'images' ? T.haveImages : T.answer;
            btn.onclick = (e) => {
                e.stopPropagation();
                if (v.key === 'images') this.openWaitingDialog(s, w, 'images');
                else if (isPhone()) this.openWaitingAnswerSheet(s, w);
                else this.openWaitingDialog(s, w, 'answer');
            };
            return btn;
        }
        const task = researchTaskRef(w.id);
        // Back to the agent (spec 089) is never the panel's action.
        if (v.key === 'images' || v.key === 'retry') return null;
        const taskDo = v.key === 'answer' ? undefined : v.key;
        const url = task ? this.activeResearchLink('task', { task, taskDo }) : null;
        if (!url) return null;
        btn.classList.add('is-terminal');
        setResearchActionLabel(btn, v.key === 'answer' ? T.answer : v.key === 'chat' ? T.discuss : T.openFolder, researchLinkMark('task', { taskDo }));
        btn.onclick = (e) => {
            e.stopPropagation();
            this.launchResearchLink(url);
        };
        return btn;
    },

    /**
     * The small panel's dialog of an item: "Add images" (the upload area) or
     * "Answer" (the answer form), the task's title under its heading; Escape,
     * × or a click beside it closes it (the files chosen and the draft stay).
     */
    openWaitingDialog(s: LiveSession, w: LiveWaiting, kind: 'images' | 'answer', files?: readonly File[]): void {
        const task = researchTaskRef(w.id);
        if (!task) return;
        const writes = this.liveWaitingWrites(s);
        if (kind === 'images' ? !writes.images || isPhone() : !writes.answer) return;
        const key = itemKey(s, w.id);
        // The same dialog again: only the files dropped come in.
        if (dialogFor?.key === key && dialogFor.kind === kind && document.getElementById(DIALOG_ID)) {
            if (kind === 'images' && files?.length) this.waitingImagesUpload(s, w, 'dlg')?.addFiles(files);
            return;
        }
        this.closeWaitingDialog();
        const T = strings.live.waitingTask;
        const overlay = el('div', 'modal-overlay active waiting-dialog-overlay');
        overlay.id = DIALOG_ID;
        const box = el('div', 'waiting-dialog');
        box.dataset.kind = kind;
        box.dataset.id = w.id;
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-labelledby', `${DIALOG_ID}-title`);
        const head = el('div', 'waiting-dialog__head');
        const titles = el('div', 'waiting-dialog__titles');
        const title = el('h2', 'waiting-dialog__title', kind === 'images' ? T.haveImages : T.answer);
        title.id = `${DIALOG_ID}-title`;
        const sub = el('p', 'waiting-dialog__task', w.what);
        sub.title = w.what;
        titles.append(title, sub);
        const x = el('button', 'waiting-dialog__close', '×');
        x.type = 'button';
        x.setAttribute('aria-label', strings.buttons.close);
        x.title = strings.buttons.close;
        x.onclick = () => this.closeWaitingDialog();
        head.append(titles, x);
        const body = el('div', 'waiting-dialog__body');
        box.append(head, body);
        overlay.appendChild(box);
        overlay.onclick = (e) => { if (e.target === overlay) this.closeWaitingDialog(); };
        if (kind === 'images') {
            const upload = this.waitingImagesUpload(s, w, 'dlg');
            if (!upload) return;
            if (files?.length) upload.addFiles(files);
            // An archive only the agent's browser reaches (spec 048 §11.2): one line above the upload.
            const phone = isPhoneBar();
            const note = browserNote(s.browser, w, s.waiting, { phone, links: !phone && this.researchLinkAvailable('archive') });
            if (note) body.appendChild(this.browserNoteEl(note, s.researchId, 'waiting-dialog__browser'));
            // What is delivered and the steps before it, under each other (5d); the upload area is the last step.
            body.appendChild(this.waitingDeliverEl(s, w, { phone: false, steps: true, column: true, upload: true }));
            body.appendChild(upload.root);
            document.body.appendChild(overlay);
            upload.focus();
        } else {
            const form = this.panelAnswerForm(s, w, task, body);
            body.appendChild(form.root);
            document.body.appendChild(overlay);
            form.focus();
        }
        dialogFor = { key, kind };
        dialogCleanup = onEscape(() => this.closeWaitingDialog());
    },

    /** The answer form of the panel's dialog (the item's wording may have changed meanwhile: the ochre note). */
    panelAnswerForm(s: LiveSession, w: LiveWaiting, task: string, body: HTMLElement): WaitingAnswerForm {
        const key = itemKey(s, w.id);
        const kept = dialogForms.get(key);
        if (kept && !kept.spent) return kept;
        const form = new WaitingAnswerForm({
            treeId: s.treeId, task, idPrefix: `dlg-answer-${w.id}`,
            ...this.waitingAnswerTexts(s, w),
            send: async (text) => {
                const now = s.waiting.find(x => x.id === w.id) ?? w;
                const outcome = await this.sendWaitingAnswer(s, now, text);
                if (outcome === 'changed' && !body.querySelector('.waiting-answer-changed')) body.prepend(waitingAnswerChangedNote());
                return outcome;
            },
            cancel: () => this.closeWaitingDialog(),
            done: () => {
                dialogForms.delete(key);
                this.closeWaitingDialog();
            },
        });
        dialogForms.set(key, form);
        return form;
    },

    closeWaitingDialog(): void {
        dialogCleanup?.();
        dialogCleanup = null;
        if (dialogFor) dialogForms.get(dialogFor.key)?.keepDraftNow();
        dialogFor = null;
        document.getElementById(DIALOG_ID)?.remove();
    },

    isWaitingDialogOpen(): boolean {
        return !!document.getElementById(DIALOG_ID);
    },

    // ==================== PHONE ====================

    /**
     * "Answer" on a phone (spec 048 §8): a full-screen sheet, Cancel · Answer ·
     * Send in its head, the task's title, the field filling the rest; with the
     * keyboard up the sheet follows the visible height, the head with Send
     * stays on top. Errors and the draft as in the overview (the error above
     * the field).
     */
    openWaitingAnswerSheet(s: LiveSession, w: LiveWaiting): void {
        const task = researchTaskRef(w.id);
        if (!task || !this.liveWaitingWrites(s).answer) return;
        this.closeWaitingAnswerSheet();
        this.closeWaitingMoreMenu();
        const T = strings.live.waitingTask;
        const key = itemKey(s, w.id);
        const sheet = el('div', 'modal-overlay active waiting-answer-sheet');
        sheet.id = SHEET_ID;
        sheet.dataset.id = w.id;
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-modal', 'true');
        sheet.setAttribute('aria-labelledby', `${SHEET_ID}-title`);
        const head = el('div', 'waiting-answer-sheet__head');
        const cancel = el('button', 'waiting-answer-sheet__cancel', T.cancel);
        cancel.type = 'button';
        const title = el('h2', 'waiting-answer-sheet__title', T.answerTitle);
        title.id = `${SHEET_ID}-title`;
        const send = el('button', 'waiting-answer-sheet__send', T.answerSendShort);
        send.type = 'button';
        head.append(cancel, title, send);
        const what = el('p', 'waiting-answer-sheet__task', w.what);
        const body = el('div', 'waiting-answer-sheet__body');
        const sync = (f: WaitingAnswerForm): void => {
            send.setAttribute('aria-disabled', String(!f.canSend));
            send.textContent = f.error ? T.retry : T.answerSendShort;
            send.classList.toggle('is-sending', f.sending);
        };
        let form = sheetForms.get(key);
        if (!form || form.spent) {
            form = new WaitingAnswerForm({
                treeId: s.treeId, task, idPrefix: `sheet-answer-${w.id}`, buttons: false,
                ...this.waitingAnswerTexts(s, w),
                send: async (text) => {
                    const now = s.waiting.find(x => x.id === w.id) ?? w;
                    const outcome = await this.sendWaitingAnswer(s, now, text);
                    const sheetBody = document.querySelector(`#${SHEET_ID} .waiting-answer-sheet__body`);
                    if (outcome === 'changed' && sheetBody && !sheetBody.querySelector('.waiting-answer-changed')) sheetBody.prepend(waitingAnswerChangedNote());
                    return outcome;
                },
                cancel: () => this.closeWaitingAnswerSheet(true),
                done: () => {
                    sheetForms.delete(key);
                    this.closeWaitingAnswerSheet(true);
                    if (researchSession() === s && s.overview) this.renderResearchOverview();
                },
                onChange: (f) => {
                    const btn = document.querySelector<HTMLElement>(`#${SHEET_ID} .waiting-answer-sheet__send`);
                    if (btn) {
                        btn.setAttribute('aria-disabled', String(!f.canSend));
                        btn.textContent = f.error ? T.retry : T.answerSendShort;
                        btn.classList.toggle('is-sending', f.sending);
                    }
                },
            });
            sheetForms.set(key, form);
        }
        const f = form;
        cancel.onclick = () => f.cancel();
        send.onclick = () => {
            if (send.getAttribute('aria-disabled') === 'true') return;
            void f.submit();
        };
        body.appendChild(f.root);
        sheet.append(head, what, body);
        document.body.appendChild(sheet);
        sync(f);
        // The keyboard up: the sheet as high as what is visible, its head on top.
        const vv = window.visualViewport;
        const fit = (): void => {
            if (!vv) return;
            sheet.style.height = `${Math.round(vv.height)}px`;
            sheet.style.top = `${Math.round(vv.offsetTop)}px`;
        };
        vv?.addEventListener('resize', fit);
        vv?.addEventListener('scroll', fit);
        fit();
        const offKey = onEscape(() => f.cancel());
        sheetCleanup = () => {
            offKey();
            vv?.removeEventListener('resize', fit);
            vv?.removeEventListener('scroll', fit);
            f.keepDraftNow();
        };
        f.focus();
    },

    /** The phone's answer sheet closes (its draft stays); `back`: the focus goes back to the item's Answer. */
    closeWaitingAnswerSheet(back = false): void {
        sheetCleanup?.();
        sheetCleanup = null;
        const sheet = document.getElementById(SHEET_ID);
        const id = sheet?.dataset.id;
        sheet?.remove();
        if (back && id) {
            document.querySelector<HTMLElement>(`#research-overview .research-overview__waiting-item[data-id="${CSS.escape(id)}"] [data-action="answer"]`)?.focus();
        }
    },

    /**
     * The finding row of a task (spec 109 §1, K1.4, K1.6): the heading with
     * its mark, what it means, and Fix · Discuss with the agent · Leave as is
     * (the fix's preview, while open, in place of these). Null: no finding to
     * show (an older research, none, or just left as it is). Fix and Leave
     * as is go through the bridge (no mark) and wait while the research is
     * unavailable; Discuss is the task's chat link as ever (AI + terminal),
     * only where the item offers it and task links open (never on a phone).
     */
    waitingAuditEl(s: LiveSession, w: LiveWaiting, mode: AuditMode): HTMLElement | null {
        const audit = waitingAuditShown(s, w);
        const task = researchTaskRef(w.id);
        if (!audit || !task) return null;
        const A = strings.live.waitingAudit;
        const hasAgent = !!w.actions?.includes('chat');
        const box = el('div', 'waiting-audit');
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', A.auditHead);
        box.dataset.task = task;
        const head = el('div', 'waiting-audit__head');
        head.append(waitingAuditMarkEl(A.auditHead, true), el('span', 'waiting-audit__title', A.auditHead));
        box.appendChild(head);
        const text = auditExplain(audit.kinds, audit.fix, hasAgent, A);
        if (text) box.appendChild(el('p', 'waiting-audit__text', text));
        // The fix's loading, preview or outcome (part of K1.5): in place of the row's actions.
        const fixArea = this.waitingAuditFixArea(s, w, mode);
        if (fixArea) {
            box.appendChild(fixArea);
            return box;
        }
        const unavailable = auditResearchUnavailable(s);
        const keeping = waitingAuditState(itemKey(s, w.id))?.phase === 'keeping';
        const actions = el('div', 'waiting-audit__actions');
        if (audit.fix !== 'none') {
            const fix = el('button', 'waiting-audit__btn', A.auditFix);
            fix.type = 'button';
            fix.dataset.action = 'audit-fix';
            fix.dataset.focusKey = `audit-fix|${w.id}`;
            fix.disabled = unavailable || keeping;
            if (unavailable) fix.title = A.auditUnavailable;
            fix.onclick = (e) => {
                e.stopPropagation();
                // The rows moved under the pointer a moment ago (another finding fixed, undone or kept): not meant for this one (109 U4).
                if (shiftHeld(WAITING_ROWS_SCOPE, e)) return;
                void this.openWaitingAuditFix(s, w, mode);
            };
            actions.appendChild(fix);
        }
        const chatUrl = hasAgent && mode !== 'sheet' && this.researchLinkAvailable('task')
            ? this.activeResearchLink('task', { task, taskDo: 'chat' }) : null;
        if (chatUrl) {
            const chat = setResearchActionLabel(el('button', 'waiting-audit__btn'), strings.live.waitingTask.discuss, researchLinkMark('task', { taskDo: 'chat' }));
            chat.type = 'button';
            chat.dataset.action = 'chat';
            chat.title = A.auditChatTitle;
            const hint = el('span', 'waiting-audit__hint', A.auditChatTitle);
            hint.id = `waiting-audit-chat-${task}-${mode}`;
            chat.setAttribute('aria-describedby', hint.id);
            chat.onclick = (e) => {
                e.stopPropagation();
                this.launchResearchLink(chatUrl);
            };
            actions.append(chat, hint);
        }
        const keep = el('button', 'waiting-audit__keep', A.auditKeep);
        keep.type = 'button';
        keep.dataset.action = 'audit-keep';
        keep.disabled = unavailable || keeping;
        keep.onclick = (e) => {
            e.stopPropagation();
            if (shiftHeld(WAITING_ROWS_SCOPE, e)) return;
            void this.keepWaitingAudit(s, w);
        };
        actions.appendChild(keep);
        box.appendChild(actions);
        if (unavailable) {
            box.appendChild(el('p', 'waiting-audit__msg', A.auditUnavailable));
        } else {
            // The preview could not be read (spec 109 §2.6): why, under the actions (Fix tries again).
            const st = waitingAuditState(itemKey(s, w.id));
            const why = st?.phase === 'idle' ? auditErrorText(st.error) : '';
            if (why) {
                const msg = el('p', 'waiting-audit__msg waiting-audit__msg--err', why);
                msg.setAttribute('role', 'alert');
                box.appendChild(msg);
            }
        }
        return box;
    },

    /**
     * Fix at a finding (spec 109 §2.2, K1.5): the research's preview of the
     * fix read (`GET <base>/waiting/<T…>/fix`), its loading in place of the
     * row's actions; then the preview there (a phone: its sheet, only with
     * the data). One preview open at a time: another item's closes.
     */
    async openWaitingAuditFix(s: LiveSession, w: LiveWaiting, _mode: AuditMode): Promise<void> {
        const task = researchTaskRef(w.id);
        const audit = w.audit;
        const key = itemKey(s, w.id);
        const cur = auditStates.get(key);
        if (!task || !audit || auditResearchUnavailable(s)) return;
        if (cur && cur.phase !== 'idle' && cur.phase !== 'preview') return;
        for (const [k, st] of auditStates) {
            if (k !== key && (st.phase === 'loading' || st.phase === 'preview' || st.phase === 'idle')) auditStates.delete(k);
        }
        if (auditSheetFor && auditSheetFor !== key) this.closeWaitingAuditSheet();
        fixedFocus = null;
        auditStates.set(key, { phase: 'loading', stamp: audit.stamp });
        this.renderLivePanel();
        const result = await this.readWaitingAuditPreview(s, w);
        const st = auditStates.get(key);
        // Cancelled, or another item's preview opened meanwhile.
        if (!st || st.phase !== 'loading') return;
        this.takeWaitingAuditPreview(s, w, result);
    },

    /** The preview read (or Reload): shown and focused; empty or gone: the row goes; refused: said. */
    takeWaitingAuditPreview(s: LiveSession, w: LiveWaiting, result: WaitingAuditPreviewResult): void {
        const key = itemKey(s, w.id);
        const st = auditStates.get(key);
        if (!st) return;
        const now = s.waiting.find(x => x.id === w.id)?.audit;
        const stamp = now?.stamp ?? st.stamp;
        if (result.ok && result.preview.changes.length === 0 || !result.ok && auditFixError(result) === 'gone') {
            this.waitingAuditGone(s, w.id, stamp);
            return;
        }
        if (result.ok) {
            auditStates.set(key, { phase: 'preview', stamp, preview: result.preview });
        } else if (st.preview) {
            // Reload refused: the preview it had stays, saying why.
            auditStates.set(key, { phase: 'preview', stamp, preview: st.preview, error: auditFixError(result) });
        } else {
            auditStates.set(key, { phase: 'idle', stamp, error: auditFixError(result) });
        }
        this.renderLivePanel();
        this.syncWaitingAuditSheet(s, w);
        const sheet = auditSheetFor === key ? document.getElementById(AUDIT_SHEET_ID) : null;
        const root = sheet ?? overviewItemEl(w.id);
        const target = auditStates.get(key)?.phase === 'idle'
            ? root?.querySelector<HTMLElement>('[data-action="audit-fix"]')
            : root?.querySelector<HTMLElement>('.waiting-audit__preview-title');
        target?.focus({ preventScroll: !sheet });
        if (!sheet) target?.scrollIntoView?.({ block: 'nearest' });
    },

    /** The finding is gone (spec 109 §2.6, 2l): the row goes, the item as it is now, said by a toast. */
    waitingAuditGone(s: LiveSession, id: string, stamp: string): void {
        const key = itemKey(s, id);
        auditStates.set(key, { phase: 'gone', stamp });
        if (auditSheetFor === key) this.closeWaitingAuditSheet();
        this.renderLivePanel();
        this.researchStatusAfterWrite(s);
        this.showToast(strings.live.waitingAudit.auditGone, 6000, { kind: 'waiting-audit-gone' });
        overviewItemEl(id)?.querySelector<HTMLElement>('.research-overview__waiting-row')?.focus({ preventScroll: true });
    },

    /** The fix's preview from the research (its own window asks its main window). */
    readWaitingAuditPreview(s: LiveSession, w: LiveWaiting): Promise<WaitingAuditPreviewResult> {
        const task = researchTaskRef(w.id);
        if (!task) return Promise.resolve(auditRefusalOf({ code: 'invalid' }));
        return getWaitingAuditPreview(s.bridge.base, task);
    },

    /**
     * The fix written (spec 109 §2.4): `{do: 'fix', expect}` with the
     * preview's stamp. Written: the research's new version taken, its status
     * read again (the app moves nothing itself) and a toast with Undo (8 s);
     * "the images are saved already" when the fix woke the task.
     */
    async writeWaitingAuditFix(s: LiveSession, w: LiveWaiting, expect: string): Promise<WaitingAuditResult> {
        const task = researchTaskRef(w.id);
        if (!task) return auditRefusalOf({ code: 'invalid' });
        const before = await this.waitingHeadBeforeWrite(s);
        const result = await postWaitingAudit(s.bridge.base, task, 'fix', { expect });
        if (result.ok) {
            this.takeWaitingWriteHead(s, before, result);
            const A = strings.live.waitingAudit;
            this.showToast(result.woke.includes(task) ? A.auditFixedWoke : A.auditFixed, 8000, {
                kind: 'waiting-audit-fixed',
                // Undo works in the toast (§4): "Undoing…", then its end there.
                action: { label: strings.live.waitingWrite.undo, work: { label: strings.busy.reverting }, run: () => this.undoWaitingAuditFix(s, w.id) },
            });
        }
        if (result.ok || auditFixError(result) === 'gone' || auditFixError(result) === 'changed') this.researchStatusAfterWrite(s);
        return result;
    },

    /** Fix in the preview's footer: written once (a second click while it is written does nothing). */
    async confirmWaitingAuditFix(s: LiveSession, w: LiveWaiting): Promise<void> {
        const key = itemKey(s, w.id);
        const st = auditStates.get(key);
        if (!st?.preview || st.phase !== 'preview' || st.reloading || auditResearchUnavailable(s)
            || st.error === 'changed' || st.error === 'locked' || st.error === 'disk') return;
        const preview = st.preview;
        auditStates.set(key, { phase: 'busy', stamp: st.stamp, preview });
        this.redrawWaitingAudit(s, w);
        const result = await this.writeWaitingAuditFix(s, w, preview.stamp);
        const now = auditStates.get(key);
        if (result.ok) {
            auditStates.set(key, { phase: 'fixed', stamp: now?.stamp ?? st.stamp });
            fixedFocus = key;
            if (auditSheetFor === key) this.closeWaitingAuditSheet();
            this.waitingRowsMoved(s);
            this.renderLivePanel();
            return;
        }
        const error = auditFixError(result);
        if (error === 'gone') {
            this.waitingAuditGone(s, w.id, now?.stamp ?? st.stamp);
            return;
        }
        auditStates.set(key, { phase: 'preview', stamp: now?.stamp ?? st.stamp, preview, error });
        this.redrawWaitingAudit(s, w);
        // The focus where the refusal leaves something to do: Reload, Fix again, else Cancel.
        const root = auditSheetFor === key ? document.getElementById(AUDIT_SHEET_ID) : overviewItemEl(w.id);
        const next = error === 'changed' ? '[data-action="audit-reload"]'
            : error === 'locked' || error === 'disk' ? '[data-action="audit-cancel"]' : '[data-action="audit-confirm"]';
        root?.querySelector<HTMLElement>(next)?.focus({ preventScroll: true });
    },

    /** Reload (the task changed meanwhile): the preview read again, the one shown stays until it comes. */
    async reloadWaitingAuditFix(s: LiveSession, w: LiveWaiting): Promise<void> {
        const key = itemKey(s, w.id);
        const st = auditStates.get(key);
        if (!st || st.phase !== 'preview' || st.reloading) return;
        st.reloading = true;
        this.redrawWaitingAudit(s, w);
        const result = await this.readWaitingAuditPreview(s, w);
        const now = auditStates.get(key);
        if (now !== st) return;
        st.reloading = false;
        this.takeWaitingAuditPreview(s, w, result);
    },

    /** Cancel (or Escape): the preview closes, the focus back on the row's Fix. */
    cancelWaitingAuditFix(s: LiveSession, id: string): void {
        const key = itemKey(s, id);
        const st = auditStates.get(key);
        if (!st || st.phase === 'busy') return;
        if (st.phase === 'loading' || st.phase === 'preview' || st.phase === 'idle') auditStates.delete(key);
        if (auditSheetFor === key) this.closeWaitingAuditSheet();
        this.renderLivePanel();
        overviewItemEl(id)?.querySelector<HTMLElement>('[data-action="audit-fix"]')?.focus({ preventScroll: true });
    },

    /** Undo in the toast (spec 109 §2.4, 2g): `{do: 'unfix'}`, no preview; changed since: it cannot be undone here. */
    /** Its end is the toast's (§4): "Undone" there, or why not ("Try again" where another try may change it). */
    async undoWaitingAuditFix(s: LiveSession, id: string): Promise<ToastWorkEnd | undefined> {
        const task = researchTaskRef(id);
        if (!task) return undefined;
        const before = await this.waitingHeadBeforeWrite(s);
        const result = await postWaitingAudit(s.bridge.base, task, 'unfix');
        const A = strings.live.waitingAudit;
        let end: ToastWorkEnd | undefined;
        if (result.ok) {
            this.takeWaitingWriteHead(s, before, result);
            const key = itemKey(s, id);
            if (auditStates.get(key)?.phase === 'fixed') auditStates.delete(key);
            if (fixedFocus === key) fixedFocus = null;
            this.waitingRowsMoved(s);
            this.renderLivePanel();
            end = { ok: true, text: A.auditUndone };
        } else if (result.code === 'audit-changed' || result.code === 'changed') {
            end = { ok: false, text: A.auditUndoFailed, whole: true, retry: false };
        } else {
            end = this.waitingAuditRefusedEnd(result);
        }
        this.researchStatusAfterWrite(s);
        return end;
    },

    /** The row drawn again, and the phone's sheet with it. */
    redrawWaitingAudit(s: LiveSession, w: LiveWaiting): void {
        this.renderLivePanel();
        this.syncWaitingAuditSheet(s, w);
    },

    /**
     * The fix's loading or preview at an item, in place of the finding row's
     * actions (null: none open, or on a phone the preview is its sheet). An
     * open preview on a phone opens its sheet; one turned to a wider window
     * comes back into the item.
     */
    waitingAuditFixArea(s: LiveSession, w: LiveWaiting, mode: AuditMode): HTMLElement | null {
        const key = itemKey(s, w.id);
        auditDrawnIn.set(key, mode);
        const st = auditStates.get(key);
        if (!st) return null;
        const A = strings.live.waitingAudit;
        if (st.phase === 'loading') {
            const box = el('div', 'waiting-audit__loading');
            box.setAttribute('role', 'status');
            box.append(spinner(), el('span', undefined, A.auditLoading));
            return box;
        }
        if ((st.phase !== 'preview' && st.phase !== 'busy') || !st.preview) return null;
        if (mode === 'sheet') {
            queueMicrotask(() => this.syncWaitingAuditSheet(s, w));
            return null;
        }
        if (auditSheetFor === key) queueMicrotask(() => this.closeWaitingAuditSheet());
        const section = el('section', 'waiting-audit__preview');
        section.setAttribute('aria-labelledby', `waiting-audit-chg-${w.id}-${mode}`);
        const parts = this.waitingAuditPreviewParts(s, w, st, st.preview, mode, `${w.id}-${mode}`);
        if (parts.alert) section.appendChild(parts.alert);
        section.append(parts.title, ...parts.body);
        const foot = el('footer', 'waiting-audit__foot');
        const btns = el('div', 'waiting-audit__foot-btns');
        btns.append(parts.cancel, parts.fix);
        foot.append(parts.note, btns);
        section.appendChild(foot);
        // Escape is Cancel (not the overview's); a click elsewhere leaves it open.
        section.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || e.isComposing) return;
            e.preventDefault();
            e.stopPropagation();
            this.cancelWaitingAuditFix(s, w.id);
        });
        section.addEventListener('click', (e) => e.stopPropagation());
        return section;
    },

    /**
     * The preview's parts (§2.3, §2.6): "What changes" (its title focused once
     * read), the changes and what remains (with Discuss with the agent where
     * the item offers it), the note or why it was refused, Cancel and Fix.
     */
    waitingAuditPreviewParts(s: LiveSession, w: LiveWaiting, st: AuditUiState, preview: AuditPreview, mode: AuditMode, idBase: string): {
        alert: HTMLElement | null; title: HTMLElement; body: HTMLElement[]; note: HTMLElement; cancel: HTMLButtonElement; fix: HTMLButtonElement;
    } {
        const A = strings.live.waitingAudit;
        const busy = st.phase === 'busy';
        const unavailable = auditResearchUnavailable(s);
        const hasAgent = !!w.actions?.includes('chat');
        const phone = mode === 'sheet';
        const title = el(phone ? 'h3' : 'h4', 'waiting-audit__preview-title waiting-audit__sec', A.auditChanges);
        title.id = `waiting-audit-chg-${idBase}`;
        title.tabIndex = -1;
        title.dataset.focusKey = `audit-preview|${w.id}`;
        let alert: HTMLElement | null = null;
        if (st.error === 'changed') {
            alert = el('div', 'waiting-audit__err waiting-audit__err--top');
            alert.setAttribute('role', 'alert');
            const reload = el('button', 'waiting-audit__reload', A.auditReload);
            reload.type = 'button';
            reload.dataset.action = 'audit-reload';
            reload.dataset.focusKey = `audit-reload|${w.id}`;
            reload.disabled = !!st.reloading || unavailable;
            if (st.reloading) reload.prepend(spinner());
            reload.onclick = (e) => {
                e.stopPropagation();
                void this.reloadWaitingAuditFix(s, w);
            };
            alert.append(el('b', undefined, A.auditErr409), document.createTextNode(` ${A.auditErr409Detail} `), reload);
        }
        const body: HTMLElement[] = [];
        const list = el('ul', 'waiting-audit__chg-list');
        const titleOf = (task: string): string | null => s.waiting.find(x => researchTaskRef(x.id) === task)?.what ?? null;
        for (const line of auditChangeLines(preview, titleOf, A)) {
            const li = el('li', `waiting-audit__chg waiting-audit__chg--${line.kind}`);
            const glyph = el('span', 'waiting-audit__glyph', line.kind === 'new' ? '+' : '→');
            glyph.setAttribute('aria-hidden', 'true');
            const what = el('div', 'waiting-audit__chg-body');
            const main = el('div', 'waiting-audit__chg-text');
            main.append(line.kind === 'new' ? el('span', 'waiting-audit__tag', line.lead) : el('b', undefined, line.lead), rangesWhole(` ${line.text}`));
            what.appendChild(main);
            if (line.sub) {
                const sub = el('div', 'waiting-audit__sub');
                if (line.sub.folder) sub.appendChild(folderIcon());
                sub.appendChild(rangesWhole(line.sub.text));
                what.appendChild(sub);
            }
            li.append(glyph, what);
            list.appendChild(li);
        }
        body.push(list);
        const left = auditLeftLines(preview, hasAgent, A);
        if (left.length > 0) {
            body.push(el(phone ? 'h4' : 'h5', 'waiting-audit__remains-title waiting-audit__sec', A.auditRemains));
            const rest = el('ul', 'waiting-audit__chg-list waiting-audit__remains');
            const task = researchTaskRef(w.id);
            const chatUrl = task && hasAgent && mode !== 'sheet' && this.researchLinkAvailable('task')
                ? this.activeResearchLink('task', { task, taskDo: 'chat' }) : null;
            left.forEach((text, i) => {
                const li = el('li', 'waiting-audit__chg waiting-audit__chg--left');
                const glyph = el('span', 'waiting-audit__glyph', '–');
                glyph.setAttribute('aria-hidden', 'true');
                const what = el('div', 'waiting-audit__chg-body');
                what.appendChild(el('div', 'waiting-audit__chg-text')).appendChild(rangesWhole(text));
                // Discuss with the agent once, at the first book the agent adds (AI + terminal, as ever).
                if (chatUrl && i === 0) {
                    const act = el('div', 'waiting-audit__chg-act');
                    const chat = setResearchActionLabel(el('button', 'waiting-audit__chat'), strings.live.waitingTask.discuss, researchLinkMark('task', { taskDo: 'chat' }));
                    chat.type = 'button';
                    chat.dataset.action = 'chat';
                    chat.title = A.auditChatTitle;
                    chat.onclick = (e) => {
                        e.stopPropagation();
                        this.launchResearchLink(chatUrl);
                    };
                    act.appendChild(chat);
                    what.appendChild(act);
                }
                li.append(glyph, what);
                rest.appendChild(li);
            });
            body.push(rest);
        }
        // The footer's line: why it was refused (no alarm colour), the research unavailable, else what the fix does.
        const errText = auditErrorText(st.error);
        let note: HTMLElement;
        if (unavailable) {
            note = el('p', 'waiting-audit__note waiting-audit__note--msg', A.auditUnavailable);
        } else if (errText) {
            note = el('p', 'waiting-audit__err', errText);
            note.setAttribute('role', 'alert');
        } else {
            note = el('p', 'waiting-audit__note', A.auditFixNote);
        }
        const cancel = el('button', 'waiting-audit__cancel', strings.live.waitingTask.cancel);
        cancel.type = 'button';
        cancel.dataset.action = 'audit-cancel';
        cancel.dataset.focusKey = `audit-cancel|${w.id}`;
        cancel.disabled = busy;
        cancel.onclick = (e) => {
            e.stopPropagation();
            this.cancelWaitingAuditFix(s, w.id);
        };
        const fix = el('button', 'waiting-audit__confirm');
        fix.type = 'button';
        fix.dataset.action = 'audit-confirm';
        fix.dataset.focusKey = `audit-confirm|${w.id}`;
        if (busy) fix.append(spinner(), document.createTextNode(A.auditBusy));
        else fix.textContent = A.auditFix;
        fix.disabled = busy || unavailable || !!st.reloading || st.error === 'changed' || st.error === 'locked' || st.error === 'disk';
        if (busy) fix.setAttribute('aria-busy', 'true');
        fix.onclick = (e) => {
            e.stopPropagation();
            void this.confirmWaitingAuditFix(s, w);
        };
        return { alert, title, body, note, cancel, fix };
    },

    /**
     * The phone's preview (§2.3, 2n, 2o): the app's bottom sheet — handle,
     * "What changes" over the task's title, the changes scrolling, Cancel ·
     * Fix fixed at its foot (each half, 44 px). Dragged down, the backdrop
     * tapped or Escape: Cancel. Opened only with the data; drawn again as the
     * state changes (the focus kept by its control).
     */
    syncWaitingAuditSheet(s: LiveSession, w: LiveWaiting): void {
        const key = itemKey(s, w.id);
        const st = auditStates.get(key);
        const open = !!st?.preview && (st.phase === 'preview' || st.phase === 'busy') && auditDrawnIn.get(key) === 'sheet';
        if (!open) {
            if (auditSheetFor === key) this.closeWaitingAuditSheet();
            return;
        }
        const now = s.waiting.find(x => x.id === w.id) ?? w;
        const parts = this.waitingAuditPreviewParts(s, now, st!, st!.preview!, 'sheet', `${w.id}-sheet`);
        const sign = JSON.stringify([st!.phase, st!.error ?? '', !!st!.reloading, auditResearchUnavailable(s), st!.preview!.stamp]);
        let overlay = document.getElementById(AUDIT_SHEET_ID);
        if (overlay && auditSheetFor === key && overlay.dataset.sign === sign) return;
        const focusKey = (document.activeElement as HTMLElement | null)?.closest(`#${AUDIT_SHEET_ID}`) ? (document.activeElement as HTMLElement).dataset.focusKey : undefined;
        const fresh = !overlay || auditSheetFor !== key;
        if (fresh) {
            this.closeWaitingAuditSheet();
            overlay = el('div', 'bottom-sheet-overlay waiting-audit-sheet-overlay');
            overlay.id = AUDIT_SHEET_ID;
            auditSheetFor = key;
            const sheet = el('div', 'bottom-sheet waiting-audit-sheet');
            sheet.setAttribute('role', 'dialog');
            sheet.setAttribute('aria-modal', 'true');
            overlay.appendChild(sheet);
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) this.cancelWaitingAuditFix(s, w.id);
            });
            // Dragged down far enough: Cancel (as the app's other sheets).
            let startY = 0;
            let dragging = false;
            sheet.addEventListener('touchstart', (e) => {
                const body = sheet.querySelector('.waiting-audit-sheet__body');
                dragging = !(body && body.contains(e.target as Node) && body.scrollTop > 0);
                startY = e.touches[0].clientY;
                sheet.style.transition = 'none';
            }, { passive: true });
            sheet.addEventListener('touchmove', (e) => {
                if (!dragging) return;
                const dy = e.touches[0].clientY - startY;
                if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
            }, { passive: true });
            sheet.addEventListener('touchend', (e) => {
                const was = dragging;
                dragging = false;
                sheet.style.transition = '';
                const dy = e.changedTouches[0].clientY - startY;
                if (was && dy > 80) this.cancelWaitingAuditFix(s, w.id);
                else sheet.style.transform = '';
            });
            document.body.appendChild(overlay);
            const off = onEscape(() => this.cancelWaitingAuditFix(s, w.id));
            auditSheetCleanup = off;
            requestAnimationFrame(() => overlay?.classList.add('active'));
        }
        overlay!.dataset.sign = sign;
        const sheet = overlay!.querySelector<HTMLElement>('.waiting-audit-sheet')!;
        const handle = el('div', 'bottom-sheet-handle');
        handle.setAttribute('aria-hidden', 'true');
        const head = el('div', 'waiting-audit-sheet__head');
        head.append(parts.title, el('p', 'waiting-audit-sheet__task', now.what));
        sheet.setAttribute('aria-labelledby', parts.title.id);
        const body = el('div', 'waiting-audit-sheet__body');
        if (parts.alert) body.appendChild(parts.alert);
        body.append(...parts.body, parts.note);
        const foot = el('div', 'waiting-audit-sheet__foot');
        foot.append(parts.cancel, parts.fix);
        const scroll = sheet.querySelector('.waiting-audit-sheet__body')?.scrollTop ?? 0;
        sheet.replaceChildren(handle, head, body, foot);
        body.scrollTop = scroll;
        const target = focusKey ? sheet.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`) : fresh ? parts.title : null;
        if (target && !(target as HTMLButtonElement).disabled) target.focus({ preventScroll: true });
        else if (focusKey) parts.cancel.disabled ? parts.title.focus({ preventScroll: true }) : parts.cancel.focus({ preventScroll: true });
    },

    /** The phone's preview sheet goes (the state is the caller's). */
    closeWaitingAuditSheet(): void {
        auditSheetCleanup?.();
        auditSheetCleanup = null;
        auditSheetFor = null;
        document.getElementById(AUDIT_SHEET_ID)?.remove();
    },

    /**
     * Leave as is (spec 109 §4, K1.6): written at once, no question (the
     * finding's stamp as `expect`); the row and its mark go, Discuss goes back
     * to the item's actions, and a toast offers Undo (8 s). A finding gone or
     * changed meanwhile: just the new data; the research busy, locked or its
     * disk full: said, the row stays.
     */
    async keepWaitingAudit(s: LiveSession, w: LiveWaiting): Promise<void> {
        const task = researchTaskRef(w.id);
        const audit = w.audit;
        const key = itemKey(s, w.id);
        if (!task || !audit || auditResearchUnavailable(s) || auditStates.has(key)) return;
        auditStates.set(key, { phase: 'keeping', stamp: audit.stamp });
        this.renderLivePanel();
        const before = await this.waitingHeadBeforeWrite(s);
        const result = await postWaitingAudit(s.bridge.base, task, 'keep', { expect: audit.stamp });
        if (result.ok) this.takeWaitingWriteHead(s, before, result);
        const ok = result.ok || result.code === 'none' || result.code === 'audit-none' || result.code === 'changed';
        if (result.ok) auditStates.set(key, { phase: 'kept', stamp: audit.stamp });
        else auditStates.delete(key);
        // The finding's row goes (kept): the next one moves up under the pointer.
        this.waitingRowsMoved(s);
        this.renderLivePanel();
        this.researchStatusAfterWrite(s);
        if (result.ok) {
            const A = strings.live.waitingAudit;
            this.showToast(A.auditKept, 8000, {
                kind: 'waiting-audit-kept',
                // Undo works in the toast (§4): "Undoing…", then its end there.
                action: { label: strings.live.waitingWrite.undo, work: { label: strings.busy.reverting }, run: () => this.unkeepWaitingAudit(s, w.id) },
            });
        } else if (!ok) {
            this.showWaitingAuditRefused(result);
        }
    },

    /** Undo of Leave as is: the finding is offered again (the next status brings it back). */
    async unkeepWaitingAudit(s: LiveSession, id: string): Promise<ToastWorkEnd | undefined> {
        const task = researchTaskRef(id);
        if (!task) return undefined;
        const before = await this.waitingHeadBeforeWrite(s);
        const result = await postWaitingAudit(s.bridge.base, task, 'unkeep');
        if (result.ok) this.takeWaitingWriteHead(s, before, result);
        auditStates.delete(itemKey(s, id));
        this.waitingRowsMoved(s);
        this.renderLivePanel();
        this.researchStatusAfterWrite(s);
        if (result.ok) return { ok: true, text: strings.busy.undone };
        // The finding gone meanwhile: nothing to undo (the toast just goes).
        if (result.code === 'none' || result.code === 'audit-none') return undefined;
        return this.waitingAuditRefusedEnd(result);
    },

    /**
     * A refused write of a finding as the end of a toast's Undo working in it: the research writing, locked or
     * its disk full there ("Try again"); a refusal with the research's own way on in a toast of its own.
     */
    waitingAuditRefusedEnd(result: Exclude<WaitingAuditResult, { ok: true }>): ToastWorkEnd | undefined {
        const A = strings.live.waitingAudit;
        if (result.code === 'busy') return { ok: false, text: A.auditErr503, whole: true };
        if (result.code === 'locked') return { ok: false, text: A.auditErrLocked, whole: true };
        if (result.code === 'full' || (result.code === 'held' && result.held?.kind === 'disk')) return { ok: false, text: A.auditErrDisk, whole: true };
        this.showWaitingAuditRefused(result);
        return undefined;
    },

    /** A refused write of a finding, said (spec 109 §2.6): the research writing, locked, its disk full, or another refusal. */
    showWaitingAuditRefused(result: Exclude<WaitingAuditResult, { ok: true }>): void {
        const A = strings.live.waitingAudit;
        if (result.code === 'busy') this.showToast(A.auditErr503, 6000, { kind: 'waiting-failed' });
        else if (result.code === 'locked') this.showToast(A.auditErrLocked, 6000, { kind: 'waiting-failed' });
        else if (result.code === 'full' || (result.code === 'held' && result.held?.kind === 'disk')) this.showToast(A.auditErrDisk, 6000, { kind: 'waiting-failed' });
        else this.showWaitingRefused(result);
    },
});
