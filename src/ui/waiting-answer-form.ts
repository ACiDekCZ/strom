/**
 * The answer to a waiting task written in the app (spec 048 §2): a label, a
 * text field (up to 4000 characters, a counter from 3600), the hint, an error
 * line and Send / Cancel. One component for the Research overview's detail,
 * the small panel's dialog and the phone's sheet (those may draw their own
 * buttons: `buttons: false`, then `submit()` and `onChange`).
 *
 * The draft is kept per tree and task on this device while it is written
 * (300 ms after the last key) and comes back when the form opens again, also
 * after a reload; it goes once the research took the answer (or had it
 * already). The host sends (`send`) and says how it went; the form shows it.
 * The node outlives a host's redraw: keep the instance, append its `root` again.
 */

import { strings } from '../strings.js';
import { WAITING_ANSWER_MAX, clearWaitingDraft, readWaitingDraft, waitingAnswerText, writeWaitingDraft } from '../research-waiting-write.js';

/** How a send went: taken (or taken already), refused for now, or the item is no longer answered here. */
export type WaitingAnswerOutcome =
    /** The research took the answer (200). */
    | 'saved'
    /** The item is gone (404: answered already, or done elsewhere). */
    | 'gone'
    /** The task waits for something else now (409 waiting.changed); the draft stays for the new wording. */
    | 'changed'
    /** The item is answered in the terminal (409 waiting.no-answer). */
    | 'no-answer'
    /** The research is busy or the tree held (503 / 423): again shortly. */
    | 'busy'
    /** Not saved (500, 507, no answer …). */
    | 'fail'
    /** Nothing sent (a send of this item runs already). */
    | 'skipped';

export type WaitingAnswerError = 'busy' | 'fail';

export interface WaitingAnswerFormOptions {
    treeId: string;
    task: string;
    /** Unique per place it is drawn in (ids of the field, its hint and error). */
    idPrefix: string;
    send: (text: string) => Promise<WaitingAnswerOutcome>;
    /** Cancel: the host closes the form (the draft stays). */
    cancel: () => void;
    /** After a send that ends the form ('saved', 'gone', 'no-answer'): the host closes it. */
    done?: (outcome: WaitingAnswerOutcome) => void;
    /** Send and Cancel under the field (default); false: the host draws its own. */
    buttons?: boolean;
    /** Whether it can be sent, it is being sent or an error is shown changed (the host's own buttons). */
    onChange?: (form: WaitingAnswerForm) => void;
}

/** Characters from which the counter shows. */
export const WAITING_ANSWER_COUNT_FROM = 3600;
/** The draft is written this long after the last key. */
const DRAFT_DELAY_MS = 300;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
    const n = document.createElement(tag);
    n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
}

export class WaitingAnswerForm {
    readonly root: HTMLElement;
    readonly textarea: HTMLTextAreaElement;
    private readonly opts: WaitingAnswerFormOptions;
    private readonly count: HTMLElement;
    private readonly errorLine: HTMLElement;
    private readonly sendBtn: HTMLButtonElement | null = null;
    private readonly draftLine: HTMLElement | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private busy = false;
    private err: WaitingAnswerError | null = null;
    private finished = false;

    constructor(opts: WaitingAnswerFormOptions) {
        this.opts = opts;
        const T = strings.live.waitingTask;
        const id = opts.idPrefix.replace(/[^A-Za-z0-9_-]/g, '_');
        this.root = node('div', 'waiting-answer');
        this.root.dataset.task = opts.task;
        const label = node('label', 'waiting-answer__label', T.answerLabel);
        label.htmlFor = `${id}-text`;
        this.textarea = node('textarea', 'waiting-answer__text');
        this.textarea.id = `${id}-text`;
        this.textarea.rows = 4;
        this.textarea.maxLength = WAITING_ANSWER_MAX;
        this.textarea.placeholder = T.answerPlaceholder;
        this.textarea.value = readWaitingDraft(opts.treeId, opts.task);
        this.textarea.setAttribute('aria-describedby', `${id}-hint ${id}-error`);
        const foot = node('div', 'waiting-answer__foot');
        const hint = node('p', 'waiting-answer__hint', T.answerHint);
        hint.id = `${id}-hint`;
        this.count = node('span', 'waiting-answer__count');
        this.count.setAttribute('aria-live', 'polite');
        foot.append(hint, this.count);
        this.errorLine = node('p', 'waiting-answer__error');
        this.errorLine.id = `${id}-error`;
        this.errorLine.setAttribute('role', 'alert');
        this.root.append(label, this.textarea, foot, this.errorLine);
        if (opts.buttons !== false) {
            const row = node('div', 'waiting-answer__buttons');
            const send = node('button', 'waiting-action waiting-action--primary waiting-answer__send', T.answerSend);
            send.type = 'button';
            send.onclick = () => { void this.submit(); };
            const cancel = node('button', 'waiting-action waiting-action--link waiting-answer__cancel', T.cancel);
            cancel.type = 'button';
            cancel.onclick = () => this.cancel();
            row.append(send, cancel);
            const draft = node('p', 'waiting-answer__draft', T.draftKept);
            this.root.append(row, draft);
            this.sendBtn = send;
            this.draftLine = draft;
        }
        this.textarea.addEventListener('input', () => {
            this.keepDraftSoon();
            this.update();
        });
        this.textarea.addEventListener('keydown', (e) => {
            // Ctrl / Cmd + Enter sends; Escape is Cancel (not the overview's or the page's Escape).
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void this.submit();
            } else if (e.key === 'Escape' && !e.isComposing) {
                e.preventDefault();
                e.stopPropagation();
                this.cancel();
            }
        });
        this.update();
    }

    /** The text as it would go (null: empty or too long). */
    get text(): string | null {
        return waitingAnswerText(this.textarea.value);
    }

    get canSend(): boolean {
        return !this.busy && !this.finished && this.text !== null;
    }

    get sending(): boolean {
        return this.busy;
    }

    get error(): WaitingAnswerError | null {
        return this.err;
    }

    /** The answer was taken: the form is spent (its draft gone). */
    get spent(): boolean {
        return this.finished;
    }

    focus(): void {
        this.textarea.focus();
        const end = this.textarea.value.length;
        this.textarea.setSelectionRange(end, end);
    }

    /** Close by Cancel: what is written stays as the draft. */
    cancel(): void {
        this.keepDraftNow();
        this.opts.cancel();
    }

    /** The draft written now (a form let go by its host). */
    keepDraftNow(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        if (!this.finished) writeWaitingDraft(this.opts.treeId, this.opts.task, this.textarea.value);
    }

    async submit(): Promise<WaitingAnswerOutcome | null> {
        const text = this.text;
        if (this.busy || this.finished || text === null) return null;
        this.keepDraftNow();
        this.busy = true;
        this.update();
        let outcome: WaitingAnswerOutcome;
        try {
            outcome = await this.opts.send(text);
        } catch {
            outcome = 'fail';
        }
        this.busy = false;
        if (outcome === 'saved' || outcome === 'gone') {
            this.finished = true;
            this.err = null;
            clearWaitingDraft(this.opts.treeId, this.opts.task);
        } else {
            this.err = outcome === 'busy' || outcome === 'fail' ? outcome : null;
        }
        this.update();
        if (outcome === 'saved' || outcome === 'gone' || outcome === 'no-answer') this.opts.done?.(outcome);
        return outcome;
    }

    private keepDraftSoon(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.keepDraftNow(), DRAFT_DELAY_MS);
    }

    private update(): void {
        const T = strings.live.waitingTask;
        const n = [...this.textarea.value].length;
        this.count.textContent = n >= WAITING_ANSWER_COUNT_FROM ? T.answerCount(n, WAITING_ANSWER_MAX) : '';
        this.count.hidden = n < WAITING_ANSWER_COUNT_FROM;
        this.errorLine.textContent = this.err === 'busy' ? T.answerBusy : this.err === 'fail' ? T.answerFail : '';
        this.errorLine.hidden = !this.err;
        this.root.classList.toggle('has-error', !!this.err);
        this.root.classList.toggle('is-sending', this.busy);
        this.textarea.readOnly = this.busy;
        if (this.sendBtn) {
            this.sendBtn.textContent = this.err ? T.retry : T.answerSend;
            this.sendBtn.setAttribute('aria-disabled', String(!this.canSend));
        }
        if (this.draftLine) this.draftLine.hidden = !(this.err && this.textarea.value.trim());
        this.opts.onChange?.(this);
    }
}

/**
 * The ochre note at the top of an item after 409 waiting.changed: nothing
 * was sent, the task waits for something else now (its new wording below),
 * the draft stays for it.
 */
export function waitingAnswerChangedNote(): HTMLElement {
    const T = strings.live.waitingTask;
    const box = node('div', 'waiting-answer-changed');
    box.setAttribute('role', 'alert');
    box.append(node('p', 'waiting-answer-changed__title', T.answerChanged), node('p', 'waiting-answer-changed__more', T.answerChangedMore));
    return box;
}
