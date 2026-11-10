/**
 * Table view (spec 073 §7.4): the bubble of a cell's finding and the legend
 * of the marks (§7.3, the status line's "Marks ⓘ").
 *
 * On a computer a panel (310 px) under the cell or the button, kept inside
 * the window; on a phone the same content in a sheet from the bottom with
 * 44 px buttons (table-ui.ts hosts the sheet). A finding shows its mark and
 * level, the type's title, the detail, "Not an error" (or, marked already,
 * the note and "Report again") and "Data quality ›"; a read-only tree has no
 * button and a quiet sentence instead. Escape, a click outside, a scroll of
 * the grid or a resize closes it; the focus goes back to the cell.
 */

import { strings } from '../../strings.js';
import { markHtml } from './table-grid.js';
import type { CellSeverity } from './table-model.js';

/** One finding as the bubble shows it. */
export interface BubbleFinding {
    severity: CellSeverity;
    /** The type's title (translateValidationType). */
    title: string;
    detail: string;
}

export interface BubbleActions {
    readOnly: boolean;
    /** "Not an error" on the finding at `index`. */
    dismiss(index: number): void;
    /** "Report again" on a finding marked "Not an error". */
    restore(index: number): void;
    /** "Data quality ›" on the finding at `index`. */
    quality(index: number): void;
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The level word over a finding: "error", "to check", "lead"; "Unusual, but checked" for a marked one. */
export function bubbleHeading(severity: CellSeverity): string {
    return severity === 'unusual' ? strings.table.unusualChecked : strings.table.sev[severity];
}

/** The bubble's content: each finding of the cell, the shown one first. */
export function bubbleHtml(findings: readonly BubbleFinding[], readOnly: boolean, sheet: boolean): string {
    const t = strings.table;
    return findings.map((f, i) => {
        const unusual = f.severity === 'unusual';
        let html = `<section class="tv-bub-finding" data-i="${i}">`;
        if (findings.length > 1) html += `<div class="tv-bub-count">${esc(t.findingOf(i + 1, findings.length))}</div>`;
        // On a phone the sheet's title says the level of the first finding.
        if (!sheet || i > 0) {
            html += `<div class="tv-bub-head">${markHtml(f.severity)}<span class="tv-bub-level">${esc(bubbleHeading(f.severity))}</span></div>`;
        }
        html += `<div class="tv-bub-msg">${esc(f.title)}</div>`;
        if (f.detail) html += `<div class="tv-bub-detail">${esc(f.detail)}</div>`;
        if (unusual) html += `<div class="tv-bub-note">${esc(t.dismissedNote)}</div>`;
        html += '<div class="tv-bub-actions">';
        if (!readOnly) {
            html += `<button type="button" class="tv-bub-btn" data-act="${unusual ? 'restore' : 'dismiss'}" data-i="${i}">`
                + `${esc(unusual ? t.reReport : t.notError)}</button>`;
        }
        html += `<button type="button" class="tv-bub-link" data-act="quality" data-i="${i}">${esc(t.toQuality)}</button></div>`;
        if (readOnly) html += `<div class="tv-bub-note">${esc(t.roNote)}</div>`;
        return html + '</section>';
    }).join('');
}

/** The legend's rows (§7.3: the four marks and what else a cell can show, none of them a finding). */
export function legendHtml(): string {
    const t = strings.table;
    const marks: CellSeverity[] = ['error', 'warning', 'info', 'unusual'];
    let html = '';
    for (const m of marks) {
        html += `<div class="tv-leg-row"><span class="tv-leg-sym">${markHtml(m)}</span>`
            + `<span class="tv-leg-name">${esc(t.sev[m])}</span><span class="tv-leg-text">${esc(t.legendText[m])}</span></div>`;
    }
    const others: [keyof typeof t.legendKind, string][] = [
        ['uncertain', '<span class="tv-leg-sample tv-cell--uncertain"><span class="tv-cell-text">1890–1892</span></span>'],
        ['reliability', '<span class="tv-leg-sample tv-leg-pill" aria-hidden="true">✓</span>'],
        ['subst', `<span class="tv-leg-sample"><span class="tv-subst" aria-hidden="true">${esc(t.subst.bapShort)}</span></span>`],
        ['computed', '<span class="tv-leg-sample tv-leg-computed" aria-hidden="true">≈ 67</span>'],
        ['na', '<span class="tv-leg-sample tv-leg-computed" aria-hidden="true">–</span>'],
    ];
    html += '<div class="tv-bub-sep" role="separator"></div>';
    for (const [k, sym] of others) {
        html += `<div class="tv-leg-row"><span class="tv-leg-sym">${sym}</span>`
            + `<span class="tv-leg-name">${esc(t.legendKind[k])}</span><span class="tv-leg-text">${esc(t.legendText[k])}</span></div>`;
    }
    return html;
}

/** One further citation of a cell (§14.3) as its bubble lists it. */
export interface BubbleCite {
    title: string;
    /** The archive and the reference ("Archive · fol. 12"), empty when neither is written. */
    meta: string;
}

/** The further citations' bubble (§14.3): a title, then each source as a button that opens it. */
export function citesHtml(cites: readonly BubbleCite[]): string {
    let html = `<div class="tv-bub-title">${esc(strings.table.citesTitle)}</div><div class="tv-bub-cites">`;
    cites.forEach((c, i) => {
        html += `<button type="button" class="tv-bub-cite" data-act="source" data-i="${i}">`
            + `<span class="tv-bub-cite-title">${esc(c.title)}</span>`
            + (c.meta ? `<span class="tv-bub-cite-meta">${esc(c.meta)}</span>` : '') + '</button>';
    });
    return html + '</div>';
}

let open: { el: HTMLElement; close(focusBack: boolean): void } | null = null;

export function closeTableBubble(focusBack = false): void {
    open?.close(focusBack);
}

export function isTableBubbleOpen(): boolean {
    return !!open;
}

/**
 * A panel under `anchor` (the rectangle it had when asked: the grid may have
 * drawn again since). `focusBack` gets the focus when it closes by a key.
 * `scroller` closes it when it scrolls.
 */
export function openBubblePanel(opts: {
    rect: DOMRect; label: string; html: string; kind: 'finding' | 'legend' | 'cites';
    focusBack: () => HTMLElement | null; scroller?: HTMLElement | null;
    onAction?: (act: string, index: number) => void;
}): HTMLElement {
    closeTableBubble(false);
    const el = document.createElement('div');
    el.className = `tv-bubble tv-bubble--${opts.kind}`;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', opts.label);
    el.tabIndex = -1;
    el.innerHTML = opts.html;
    document.body.appendChild(el);

    const r = opts.rect;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const below = r.bottom + 4;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : below;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;

    const close = (focusBack: boolean): void => {
        if (open?.el !== el) return;
        open = null;
        el.remove();
        document.removeEventListener('pointerdown', onOutside, true);
        window.removeEventListener('resize', onResize);
        opts.scroller?.removeEventListener('scroll', onResize);
        if (focusBack) opts.focusBack()?.focus({ preventScroll: true });
    };
    const onOutside = (e: PointerEvent): void => { if (!el.contains(e.target as Node)) close(false); };
    const onResize = (): void => close(false);
    el.addEventListener('click', (e) => {
        const btn = (e.target as Element).closest<HTMLElement>('[data-act]');
        if (!btn) return;
        close(true);
        opts.onAction?.(btn.dataset.act!, Number(btn.dataset.i ?? 0));
    });
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close(true);
            return;
        }
        if (e.key !== 'Tab') return;
        // The focus stays in the bubble while it is open.
        const items = [...el.querySelectorAll<HTMLElement>('button')];
        if (!items.length) { e.preventDefault(); return; }
        const at = items.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at + 1) % items.length;
        e.preventDefault();
        items[next].focus();
    });
    setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0);
    window.addEventListener('resize', onResize);
    opts.scroller?.addEventListener('scroll', onResize, { passive: true });
    open = { el, close };
    (el.querySelector<HTMLElement>('button') ?? el).focus({ preventScroll: true });
    return el;
}

/** The phone's sheet content: a title row with ×, then the bubble's content. */
export function sheetElement(title: string, html: string, kind: 'finding' | 'legend' | 'cites', onClose: () => void,
    onAction?: (act: string, index: number) => void): HTMLElement {
    const el = document.createElement('div');
    el.className = `bottom-sheet tv-bubble tv-bubble--sheet tv-bubble--${kind}`;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', title);
    el.innerHTML = '<div class="tv-bub-sheet-head">'
        + `<span class="tv-bub-sheet-title">${esc(title)}</span>`
        + `<button type="button" class="tv-bub-close" aria-label="${esc(strings.buttons.close)}">×</button></div>`
        + `<div class="tv-bub-sheet-body">${html}</div>`;
    el.querySelector('.tv-bub-close')!.addEventListener('click', onClose);
    el.addEventListener('click', (e) => {
        const btn = (e.target as Element).closest<HTMLElement>('[data-act]');
        if (!btn) return;
        onClose();
        onAction?.(btn.dataset.act!, Number(btn.dataset.i ?? 0));
    });
    return el;
}
