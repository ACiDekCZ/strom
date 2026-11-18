/**
 * "Books" in "Research for this tree" (spec 105 §4): the research's two
 * settings of its books (`/status.books.settings`) as a collapsible group —
 * from how many tasks a book is offered for downloading, and the downloaded
 * book first in the queue. Plain data in, HTML out; the dialog writes a
 * change through the bridge (`POST books`).
 */

import { strings } from '../strings.js';
import {
    BOOKS_MIN_TASKS_DEFAULT, BOOKS_MIN_TASKS_MAX, BOOKS_MIN_TASKS_MIN, BOOKS_SAME_BOOK_DEFAULT, type LiveBooksSettings,
} from '../research-link.js';

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** What stands under the group: the write on its way, the research's confirmation, a sentence (with Try again). */
export type BooksSettingNote = { kind: 'busy' } | { kind: 'ok' } | { kind: 'text'; text: string; retry?: boolean };

export interface BooksSettingInput {
    settings: LiveBooksSettings;
    /** The group is open. */
    open: boolean;
    /** The research's bridge answers (else the controls rest, dimmed). */
    up: boolean;
    note?: BooksSettingNote | null;
    /** The number field's text as typed, when it is not a valid number (shown with its sentence). */
    invalid?: string | null;
}

/** A number of tasks typed in the field, or null (not a whole number 1–999). */
export function booksMinTasksInput(text: string): number | null {
    const t = text.trim();
    if (!/^\d{1,3}$/.test(t)) return null;
    const n = Number(t);
    return n >= BOOKS_MIN_TASKS_MIN && n <= BOOKS_MIN_TASKS_MAX ? n : null;
}

/** "yes" / "no" in the app's language. */
function yesNo(v: 'yes' | 'no'): string {
    return v === 'yes' ? strings.treeSettings.booksYes : strings.treeSettings.booksNo;
}

export function booksSettingHtml(o: BooksSettingInput): string {
    const t = strings.treeSettings;
    const s = o.settings;
    const busy = o.note?.kind === 'busy';
    const off = !o.up || busy ? ' disabled' : '';
    const same = s.sameBook === 'yes';
    const dflt = ` <span class="research-transcripts-default">${esc(t.default)}</span>`;
    const invalid = o.invalid != null;
    const minDefault = s.minTasksDefault ?? BOOKS_MIN_TASKS_DEFAULT;
    const sameDefault = s.sameBookDefault ?? BOOKS_SAME_BOOK_DEFAULT;
    const n = o.note;
    const note = !n ? '' : n.kind === 'busy'
        ? `<p class="research-stories-note research-readtask-note" id="research-books-note" role="status"><i class="busy-spin" aria-hidden="true"></i><span>${esc(t.rtBusy)}</span></p>`
        : n.kind === 'ok'
            ? `<p class="research-stories-note research-readtask-note is-ok" id="research-books-note" role="status"><span class="research-readtask-ok" aria-hidden="true">✓</span><span>${esc(t.booksOk)}</span></p>`
            : `<p class="research-stories-note research-readtask-note" id="research-books-note" role="status"><span>${esc(n.text)}</span>${n.retry
                ? ` <button type="button" class="link-button research-books-retry" id="research-books-retry">${esc(t.booksRetry)}</button>` : ''}</p>`;
    return `
        <details class="research-group research-books-group" id="research-books-group"${o.open ? ' open' : ''}>
            <summary class="research-group-summary">
                <span class="research-group-caret" aria-hidden="true"></span>
                <span class="research-group-title">${esc(t.booksGroup)}</span>
                <span class="research-group-value"><span class="research-group-value-full">${esc(t.booksSum(s.minTasks, same))}</span><span class="research-group-value-short">${esc(t.booksSumShort(s.minTasks))}</span></span>
            </summary>
            <div class="research-books${o.up ? '' : ' is-down'}" id="research-books">
                <div class="research-books-row">
                    <span class="settings-text">
                        <label class="settings-name" for="research-books-min">${esc(t.minTasks)}${s.minTasksOwn ? '' : dflt}</label>
                        <span class="settings-desc" id="research-books-min-desc">${esc(t.minTasksDesc)}</span>
                    </span>
                    <span class="research-books-field">
                        <input type="number" class="research-books-min${invalid ? ' is-invalid' : ''}" id="research-books-min" inputmode="numeric"
                            min="${BOOKS_MIN_TASKS_MIN}" max="${BOOKS_MIN_TASKS_MAX}" step="1" value="${esc(invalid ? o.invalid! : String(s.minTasks))}"
                            aria-describedby="research-books-min-desc${invalid ? ' research-books-invalid' : ''}"${invalid ? ' aria-invalid="true"' : ''}${off}>
                        <span class="research-books-unit">${esc(t.minTasksUnit)}</span>
                    </span>
                </div>
                ${invalid ? `<p class="research-books-invalid" id="research-books-invalid" role="status">${esc(t.minTasksInvalid)}</p>` : ''}
                ${s.minTasksOwn ? `<button type="button" class="link-button research-books-reset" id="research-books-min-reset"${off}>${esc(t.resetDefault(String(minDefault)))}</button>` : ''}
                <label class="settings-checkbox research-books-same">
                    <input type="checkbox" role="switch" id="research-books-same"${same ? ' checked' : ''}${off}>
                    <span class="settings-text"><span class="settings-name">${esc(t.sameBook)}${s.sameBookOwn ? '' : dflt}</span><span class="settings-desc">${esc(t.sameBookDesc)}</span></span>
                </label>
                ${s.sameBookOwn ? `<button type="button" class="link-button research-books-reset" id="research-books-same-reset"${off}>${esc(t.resetDefault(yesNo(sameDefault)))}</button>` : ''}
                ${note}
            </div>
        </details>`;
}
