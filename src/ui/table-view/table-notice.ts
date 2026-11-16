/**
 * The strip under the Table's bar for a person the filter hides (spec 103
 * §2, 2a): "Hidden by the filter: {name}." with Show for now, Clear filters
 * and ×. It closes on ×, Escape in it, one of its actions, the next jump
 * and a change of the filter.
 */

import { strings } from '../../strings.js';

export interface NoticeHandlers {
    /** Show for now: the person's row in the table outside the filter. */
    onShow(): void;
    /** Clear filters: the filter and the search off, then the jump. */
    onClear(): void;
    /** × or Escape. */
    onClose(): void;
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The strip, hidden until `showNotice`. */
export function createNotice(handlers: NoticeHandlers): HTMLElement {
    const el = document.createElement('div');
    el.className = 'tv-notice';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.hidden = true;
    el.addEventListener('click', (e) => {
        const act = (e.target as Element).closest<HTMLElement>('[data-notice]')?.dataset.notice;
        if (act === 'show') handlers.onShow();
        else if (act === 'clear') handlers.onClear();
        else if (act === 'close') handlers.onClose();
    });
    el.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        handlers.onClose();
    });
    return el;
}

/** The strip for `name`, or hidden (null). */
export function showNotice(el: HTMLElement, name: string | null): void {
    if (name === null) {
        if (!el.hidden) { el.hidden = true; el.innerHTML = ''; }
        return;
    }
    const t = strings.table;
    const html = '<span class="tv-notice-dot" aria-hidden="true"></span>'
        + `<span class="tv-notice-text">${esc(t.link.hidden(name))}</span>`
        + '<span class="tv-notice-acts">'
        + `<button type="button" class="tv-notice-btn tv-notice-temp" data-notice="show">${esc(t.link.showTemp)}</button>`
        + `<button type="button" class="tv-notice-btn tv-notice-clear" data-notice="clear">${esc(t.clearFilters)}</button>`
        + `<button type="button" class="tv-notice-close" data-notice="close" aria-label="${esc(strings.buttons.close)}" title="${esc(strings.buttons.close)}">×</button>`
        + '</span>';
    if (el.hidden || el.innerHTML !== html) el.innerHTML = html;
    el.hidden = false;
}
