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
import { WaitActionView, imagesState, waitingActions } from '../research-waiting.js';
import { DEFAULT_MEDIA_MAX_BYTES } from '../originals.js';
import { MQ_PHONE_BAR, isPhoneBar } from '../breakpoints.js';
import { setResearchActionLabel } from './research-open-mark.js';
import { uiModule } from './module.js';
import { el, liveSession, LiveSession } from './research-ui.js';
import { UploadNumbers, UploadOutcome, WaitingImagesUpload } from './waiting-images-upload.js';
import { WaitingAnswerForm, waitingAnswerChangedNote } from './waiting-answer-form.js';
import { bindImagesDrop, imagesShortEl, itemKey } from './waiting-images-ui.js';

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

export const waitingTaskMethods = uiModule({
    /** The task's numbers as the research says them now: those asked for (null: not known) and those saved. */
    waitingImagesNumbers(s: LiveSession, id: string): UploadNumbers {
        const w = s.waiting.find(x => x.id === id);
        const img = w ? imagesState(w) : null;
        if (!img || img.detail !== 'full' || !img.wanted) return { want: null, have: [] };
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
            if (liveSession() === s && s.overview) {
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
        if (liveSession() !== s || !s.overview) return;
        this.renderResearchOverview();
        document.querySelector<HTMLElement>(`#research-overview .research-overview__waiting-item[data-id="${CSS.escape(w.id)}"] [data-action="images"]`)?.focus();
    },

    /** The overview's detail of an item with its upload area open: the area (null: not open). */
    overviewImagesArea(s: LiveSession, w: LiveWaiting): HTMLElement | null {
        if (overviewImagesKey !== itemKey(s, w.id)) return null;
        return this.waitingImagesUpload(s, w, 'ov')?.root ?? null;
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
                    if (liveSession() === s && s.overview) this.renderResearchOverview();
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
});
