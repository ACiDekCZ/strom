/**
 * Files of a book's inbox set aside (`inbox.aside`) in Awaiting action: the
 * item's sentence, its detail (the saved image it is compared with, the
 * book's folder, the answers) and the answer written through the bridge
 * (`POST <token>/books/aside`). The pure half is research-aside.ts.
 *
 * Answering goes through the bridge, without a terminal: no mark (CLAUDE.md).
 * The overview's own window asks the main window to write (writeAsideAnswer
 * is overridden there).
 */

import { strings } from '../strings.js';
import { LiveWaiting, MAX_IMAGE_NUMBER, asideFileName, asideWaiting, imageNumber, researchLinkMark, type LiveBookAside } from '../research-link.js';
import { bookById, bookTitle } from '../research-books.js';
import { withBusyRetry } from '../research-directions.js';
import { answerBookAside, asideAnswers, asideOutcomeOf, asideWaitingText, type AsideDo, type AsideOutcome } from '../research-aside.js';
import { el, liveSession, type LiveSession } from './research-ui.js';
import { BOOK_GROUP_PREFIX } from '../research-waiting.js';
import { setResearchActionLabel } from './research-open-mark.js';
import { runBusy } from './busy.js';
import type { UIClass } from './index.js';

/** Answers on their way: the item and what it answers (its button works, the others wait, dimmed). */
const answering = new Map<string, AsideDo>();
/** A refused answer's sentence at its item, and how to try it again. */
const problems = new Map<string, { text: string; tone: 'warn' | 'danger'; retry: (() => void) | null }>();
/** "Another number…" open at an item, with the number typed so far (kept over a redraw). */
const typed = new Map<string, string>();
/** Items answered here (or elsewhere): hidden while a status read before the answer still lists them. */
const answered = new Set<string>();

/** A number typed: a whole number 1–999999, else null. */
function typedNumber(text: string): number | null {
    const t = text.trim();
    return /^\d{1,6}$/.test(t) ? imageNumber(Number(t)) : null;
}

export const waitingAsideMethods = {
    /**
     * A new status's waiting items: a file answered here stays hidden while a status read before the answer
     * still lists it; once a status leaves it out, it is forgotten.
     */
    withoutAsideAnswers(items: LiveWaiting[]): LiveWaiting[] {
        for (const id of [...answered]) if (!items.some(w => w.id === id)) answered.delete(id);
        return answered.size === 0 ? items : items.filter(w => !answered.has(w.id));
    },

    /** The small panel's "Decide": the overview opens at the item, its book's group unfolded and its detail open. */
    showOverviewWaitingItem(this: UIClass, id: string): void {
        const s = liveSession();
        const w = s?.waiting.find(x => x.id === id);
        if (s && w) {
            s.waitingView.open.set('phase:todo', true);
            if (w.book) s.waitingView.open.set(`group:todo:${BOOK_GROUP_PREFIX}${w.book}`, true);
            s.waitingView.detail = w.id;
        }
        this.openResearchOverview({ showWaiting: true });
        document.querySelector<HTMLElement>(`#research-overview .research-overview__waiting-item[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
    },

    /** The sentence of a file set aside, in the UI's language, with its book's title (its id when the book is not listed). */
    asideText(w: LiveWaiting, s: { books?: LiveSession['books'] } | null): string {
        const book = bookById(s, w.book);
        return asideWaitingText(w, book ? bookTitle(book) : null, strings.live.aside);
    },

    /**
     * The detail of a file set aside: the saved image it is compared with, where the new file is (the book's
     * folder, opened by the research without a terminal when it can be), the answers through the bridge, and a
     * refused answer's sentence. A phone or a bridge that does not answer: the answers held, as a growing branch's.
     */
    appendAsideWaitingActions(this: UIClass, host: HTMLElement, w: LiveWaiting, s: LiveSession): void {
        const a = w.aside;
        if (!a) return;
        const T = strings.live.aside;
        const L = strings.live;
        const facts = el('div', 'research-overview__waiting-meta');
        facts.appendChild(el('span', 'research-overview__waiting-inbox', T.compared(a.kind === 'other' ? a.image ?? null : null, a.media)));
        host.appendChild(facts);
        const where = el('div', 'research-overview__waiting-meta');
        where.appendChild(el('span', 'research-overview__muted', T.folderHint));
        const book = bookById(s, a.recordset);
        const folder = book?.folder ? this.activeResearchLink('book', { book: book.id, bookDo: 'folder' }) : null;
        if (folder && book) {
            const btn = setResearchActionLabel(el('button', 'link-button research-overview__book-folder'), L.books.folderBook, researchLinkMark('book'), { sr: false });
            btn.type = 'button';
            btn.dataset.book = book.id;
            btn.setAttribute('aria-label', `${L.books.folderBook} · ${bookTitle(book)}`);
            btn.onclick = (e) => {
                e.stopPropagation();
                this.launchResearchLink(folder);
            };
            where.appendChild(btn);
        }
        host.appendChild(where);
        const down = s.ended || s.lostSince !== null;
        const box = el('div', 'research-offline__wait-actions research-overview__aside-actions');
        const busy = answering.get(w.id);
        const add = (label: string, cls: string, what: AsideDo | 'another', run: (btn: HTMLElement) => void): HTMLElement => {
            const btn = el('button', `live-waiting-answer research-overview__waiting-action ${cls}`.trim(), label);
            btn.type = 'button';
            btn.dataset.do = what;
            btn.dataset.action = `aside-${what}`;
            btn.dataset.focusKey = `aside-${what}:${w.id}`;
            if (down) {
                btn.setAttribute('aria-disabled', 'true');
                btn.title = L.waitBranchDown;
            } else if (busy && busy !== what) btn.setAttribute('aria-disabled', 'true');
            else btn.onclick = () => run(btn);
            box.appendChild(btn);
            return btn;
        };
        const open = typed.has(w.id);
        for (const what of asideAnswers(a)) {
            if (what === 'discard') {
                add(a.kind === 'same' ? T.bin : T.keep(a.image ?? null), open ? '' : 'is-primary', 'discard', (btn) => this.answerAside(btn, s, w, 'discard'));
            } else if (what === 'take' && a.image !== undefined) {
                add(T.take(a.image), '', 'take', (btn) => this.answerAside(btn, s, w, 'take'));
            } else if (what === 'image' && !open) {
                add(T.another, '', 'another', () => {
                    typed.set(w.id, '');
                    problems.delete(w.id);
                    this.renderResearchOverview();
                    document.querySelector<HTMLInputElement>(`#research-overview [data-focus-key="${CSS.escape(`aside-num:${w.id}`)}"]`)?.focus();
                });
            }
        }
        host.appendChild(box);
        if (open) host.appendChild(this.asideNumberBox(s, w, a, down));
        if (down) host.appendChild(el('p', 'research-overview__muted research-offline__held', L.waitBranchDown));
        const problem = problems.get(w.id);
        if (problem) {
            const msg = el('div', `research-direction__problem is-${problem.tone}`);
            msg.setAttribute('role', 'alert');
            msg.appendChild(el('span', undefined, problem.text));
            if (problem.retry) {
                const retry = el('button', 'link-button research-direction__retry', L.dirRetry);
                retry.type = 'button';
                retry.dataset.do = 'retry';
                const run = problem.retry;
                retry.onclick = () => run();
                msg.appendChild(retry);
            }
            host.appendChild(msg);
        }
    },

    /** "Another number…": the field (1–999999, as a task's image number) with Save and Cancel. */
    asideNumberBox(this: UIClass, s: LiveSession, w: LiveWaiting, a: LiveBookAside, down: boolean): HTMLElement {
        const T = strings.live.aside;
        const box = el('div', 'waiting-upload__again research-overview__aside-number');
        const field = el('input', 'waiting-upload__num waiting-upload__num--free') as HTMLInputElement;
        field.type = 'text';
        field.inputMode = 'numeric';
        field.autocomplete = 'off';
        field.maxLength = String(MAX_IMAGE_NUMBER).length;
        field.placeholder = a.image !== undefined ? String(a.image) : '';
        field.style.setProperty('--ph-len', String(Math.max(3, field.placeholder.length)));
        field.value = typed.get(w.id) ?? '';
        field.dataset.focusKey = `aside-num:${w.id}`;
        field.setAttribute('aria-label', `${asideFileName(a)}: ${T.numLabel}`);
        const label = el('label', 'research-overview__aside-numlabel', T.numLabel);
        const id = `aside-num-${w.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
        field.id = id;
        label.htmlFor = id;
        const save = el('button', 'live-waiting-answer research-overview__waiting-action is-primary', T.save);
        save.type = 'button';
        save.dataset.do = 'image';
        save.dataset.action = 'aside-image';
        save.dataset.focusKey = `aside-image:${w.id}`;
        const busy = answering.get(w.id);
        const ready = (): boolean => !down && (!busy || busy === 'image') && typedNumber(field.value) !== null;
        const send = (): void => {
            const n = typedNumber(field.value);
            if (n === null || !ready()) return;
            this.answerAside(save, s, w, 'image', n);
        };
        save.setAttribute('aria-disabled', String(!ready()));
        save.onclick = send;
        field.oninput = () => {
            typed.set(w.id, field.value);
            save.setAttribute('aria-disabled', String(!ready()));
        };
        field.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                send();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                typed.delete(w.id);
                this.renderResearchOverview();
            }
        };
        const cancel = el('button', 'link-button research-overview__aside-cancel', T.cancel);
        cancel.type = 'button';
        cancel.onclick = () => {
            typed.delete(w.id);
            problems.delete(w.id);
            this.renderResearchOverview();
        };
        box.append(label, field, save, cancel);
        return box;
    },

    /** An answer from its button: the button works until the outcome (no time of its own: the bridge's 30 s end it). */
    answerAside(this: UIClass, btn: HTMLElement, s: LiveSession, w: LiveWaiting, what: AsideDo, image?: number): void {
        if (answering.has(w.id)) return;
        answering.set(w.id, what);
        problems.delete(w.id);
        void runBusy(btn, async () => {
            let out: AsideOutcome;
            try {
                out = await this.writeAsideAnswer(s, w, what, image);
            } finally {
                answering.delete(w.id);
            }
            if (out.ok || out.gone) typed.delete(w.id);
            else problems.set(w.id, { text: out.text, tone: out.tone, retry: out.retry ? () => this.answerAside(btn, s, w, what, image) : null });
            this.renderResearchOverview();
            return out.ok;
        }, { label: strings.busy.saving, timeoutMs: Infinity });
    },

    /**
     * Write an answer through the bridge (one retry when the research is busy): done — the files set aside as
     * the answer says them now, a toast; 404 — answered elsewhere, the item just goes; else why not.
     */
    async writeAsideAnswer(this: UIClass, s: LiveSession, w: LiveWaiting, what: AsideDo, image?: number): Promise<AsideOutcome> {
        const a = w.aside;
        if (!a || s.ended) return { ok: false, gone: true };
        const T = strings.live.aside;
        const head = await this.waitingHeadBeforeWrite(s);
        const r = await withBusyRetry(() => answerBookAside(s.bridge.base, a.file, what, image));
        if (s.ended) return { ok: false, gone: true };
        if (!r.ok) {
            // The number the answer would fill: the typed one, or the file's own when it is taken as its image.
            const out = asideOutcomeOf(r, what === 'take' ? a.image : image, T, strings.live.dirBusy, strings.live.waitBranchDown);
            if (!out.ok && out.gone) {
                this.settleAside(s, [w.id], null);
                this.researchStatusAfterWrite(s);
            }
            return out;
        }
        if (r.head) this.researchTakeOwnWriteHead(s.researchId, head, r.head, r.parent);
        this.settleAside(s, [w.id], r.aside);
        this.showToast(what === 'take' && a.image !== undefined ? T.toastTake(a.image) : what === 'image' && image !== undefined ? T.toastImage(image) : T.toastBin, 6000);
        this.researchStatusAfterWrite(s);
        return { ok: true };
    },

    /**
     * After an answer: the item (and any file the answer no longer lists) goes at once and stays hidden until
     * a status leaves it out; `now` (the answer's list) replaces the books' files set aside.
     */
    settleAside(this: UIClass, s: LiveSession, gone: readonly string[], now: LiveBookAside[] | null): void {
        const fresh = now ? asideWaiting({ aside: now }) : null;
        const keep = fresh ? new Set(fresh.map(x => x.id)) : null;
        for (const id of gone) answered.add(id);
        for (const x of s.waiting) if (x.kind === 'aside' && keep && !keep.has(x.id)) answered.add(x.id);
        s.waiting = s.waiting.filter(x => !answered.has(x.id));
        if (s.books && now) {
            const { aside: _old, ...rest } = s.books;
            s.books = now.length > 0 ? { ...rest, aside: now } : rest;
        }
        this.renderLivePanel();
    },
};
