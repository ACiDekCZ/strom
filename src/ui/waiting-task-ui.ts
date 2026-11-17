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
import { el, liveSession, LiveSession, researchSession } from './research-ui.js';
import { UploadNumbers, UploadOutcome, WaitingImagesUpload } from './waiting-images-upload.js';
import { WaitingAnswerForm, waitingAnswerChangedNote } from './waiting-answer-form.js';
import { bindImagesDrop, imagesShortEl, itemKey } from './waiting-images-ui.js';
import { auditExplain, type WaitingAudit } from '../research-audit.js';
import { postWaitingAudit, type WaitingAuditResult } from '../research-waiting-write.js';

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
    phase: 'keeping' | 'kept';
    /** The finding's stamp the state belongs to (another one: the state is dropped). */
    stamp: string;
}

const auditStates = new Map<string, AuditUiState>();

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
        auditStates.delete(key!);
        return w.audit ?? null;
    }
    if (!w.audit || st?.phase === 'kept') return null;
    return w.audit;
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
     * last step it is, no button for it.
     */
    waitingDeliverEl(s: LiveSession, w: LiveWaiting, opts: { phone: boolean; steps: boolean; column?: boolean; upload?: boolean }): HTMLElement {
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
                const btn = el('button', `waiting-action ${step === 'images' ? 'waiting-action--primary' : 'waiting-action--secondary'} research-overview__waiting-action`);
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
        if (v.key === 'images') return null;
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
            fix.disabled = unavailable || keeping;
            if (unavailable) fix.title = A.auditUnavailable;
            fix.onclick = (e) => {
                e.stopPropagation();
                this.openWaitingAuditFix(s, w, mode);
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
            void this.keepWaitingAudit(s, w);
        };
        actions.appendChild(keep);
        box.appendChild(actions);
        if (unavailable) box.appendChild(el('p', 'waiting-audit__msg', A.auditUnavailable));
        return box;
    },

    /**
     * Fix at a finding (spec 109 §2, K1.5): the research's preview of the fix
     * opens in place of the row's actions (a phone: its sheet). The preview,
     * the write and its Undo are the next part's; until then nothing opens.
     */
    openWaitingAuditFix(_s: LiveSession, _w: LiveWaiting, _mode: AuditMode): void {
        // The fix's preview (GET <base>/waiting/<T…>/fix) comes with spec 109 §2.
    },

    /** The fix's loading, preview or outcome at an item, in place of the finding row's actions (null: none open). */
    waitingAuditFixArea(_s: LiveSession, _w: LiveWaiting, _mode: AuditMode): HTMLElement | null {
        return null;
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
        this.renderLivePanel();
        this.researchStatusAfterWrite(s);
        if (result.ok) {
            const A = strings.live.waitingAudit;
            this.showToast(A.auditKept, 8000, {
                kind: 'waiting-audit-kept',
                action: { label: strings.live.waitingWrite.undo, run: () => { void this.unkeepWaitingAudit(s, w.id); } },
            });
        } else if (!ok) {
            this.showWaitingAuditRefused(result);
        }
    },

    /** Undo of Leave as is: the finding is offered again (the next status brings it back). */
    async unkeepWaitingAudit(s: LiveSession, id: string): Promise<void> {
        const task = researchTaskRef(id);
        if (!task) return;
        const before = await this.waitingHeadBeforeWrite(s);
        const result = await postWaitingAudit(s.bridge.base, task, 'unkeep');
        if (result.ok) this.takeWaitingWriteHead(s, before, result);
        auditStates.delete(itemKey(s, id));
        this.renderLivePanel();
        this.researchStatusAfterWrite(s);
        if (!result.ok && result.code !== 'none' && result.code !== 'audit-none') this.showWaitingAuditRefused(result);
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
