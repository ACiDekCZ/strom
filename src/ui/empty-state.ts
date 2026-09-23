/**
 * One pattern for "nothing here yet" inside dialogs and panels: a serif
 * heading, one sentence saying what the list is for, and optionally the
 * primary action that fills it. No emoji, no italics (see .empty-block CSS).
 */

export interface EmptyStateOptions {
    title: string;
    text?: string;
    /** Label of the primary action button; omitted when the host already offers it. */
    actionLabel?: string;
    /** id for the action button (callers wire the click themselves). */
    actionId?: string;
    /** Extra class(es) on the block — keeps legacy hooks like `.sources-empty`. */
    className?: string;
    /** Left-aligned, tighter variant for inline sections (person modal). */
    compact?: boolean;
}

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function emptyStateHtml(o: EmptyStateOptions): string {
    const cls = ['empty-block', o.compact ? 'empty-block--compact' : '', o.className ?? '']
        .filter(Boolean).join(' ');
    const action = o.actionLabel
        ? `<button type="button" class="primary empty-block-action"${o.actionId ? ` id="${esc(o.actionId)}"` : ''}>${esc(o.actionLabel)}</button>`
        : '';
    return `<div class="${cls}">
        <div class="empty-block-title">${esc(o.title)}</div>
        ${o.text ? `<p class="empty-block-text">${esc(o.text)}</p>` : ''}
        ${action}
    </div>`;
}
