/**
 * The strip under the Table's bar for a person the filter hides (spec 103
 * §2, 2a): "Hidden by the filter: {name}." with Show for now, Clear filters
 * and ×. It closes on ×, Escape in it, one of its actions, the next jump
 * and a change of the filter. A person outside the Table's scope (spec 084
 * §9, spec 098 §11c): "Not in the list: {name}." (the selection, This view)
 * with Show for now, Whole tree and ×.
 */

import { strings } from '../../strings.js';

export interface NoticeHandlers {
    /** Show for now: the person's row in the table outside the filter. */
    onShow(): void;
    /** Clear filters: the filter and the search off, then the jump. */
    onClear(): void;
    /** Whole tree (spec 084 §9): the scope off, then the jump. */
    onWhole(): void;
    /** × or Escape. */
    onClose(): void;
}

/** What the strip is about: a person the filter hides, one outside the scope. */
export type NoticeKind = 'filter' | 'list';

/** The scope a person is outside of: a list, another selection, This view. */
export type NoticeScope = 'list' | 'selection' | 'view';

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
        else if (act === 'whole') handlers.onWhole();
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

/** The strip for `name`, or hidden (null); `scope`: what the person is outside of (spec 098 §5, §11c). */
export function showNotice(el: HTMLElement, name: string | null, kind: NoticeKind = 'filter', scope: NoticeScope = 'list'): void {
    if (name === null) {
        if (!el.hidden) { el.hidden = true; el.innerHTML = ''; }
        return;
    }
    const t = strings.table;
    const text = kind === 'list'
        ? (scope === 'selection' ? t.notInSelection(name) : scope === 'view' ? t.notInView(name) : t.notInList(name))
        : t.link.hidden(name);
    const html = '<span class="tv-notice-dot" aria-hidden="true"></span>'
        + `<span class="tv-notice-text">${esc(text)}</span>`
        + '<span class="tv-notice-acts">'
        + `<button type="button" class="tv-notice-btn tv-notice-temp" data-notice="show">${esc(t.link.showTemp)}</button>`
        + (kind === 'list' ? `<button type="button" class="tv-notice-btn tv-notice-whole" data-notice="whole">${esc(t.scopeWhole)}</button>`
            : `<button type="button" class="tv-notice-btn tv-notice-clear" data-notice="clear">${esc(t.clearFilters)}</button>`)
        + `<button type="button" class="tv-notice-close" data-notice="close" aria-label="${esc(strings.buttons.close)}" title="${esc(strings.buttons.close)}">×</button>`
        + '</span>';
    el.classList.toggle('tv-notice--list', kind !== 'filter');
    if (el.hidden || el.innerHTML !== html) el.innerHTML = html;
    el.hidden = false;
}
