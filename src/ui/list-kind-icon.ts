/**
 * The icon of a list's kind (spec 084 §1): fixed (a list), automatic (two
 * arrows round) and checklist (a ticked box). Inline SVG in `currentColor`,
 * hidden from assistive technology: the kind's word is always in the text or
 * the aria-label beside it. The colour comes from the class: fixed and
 * automatic neutral (`--text-light`), the checklist `--accent-text`.
 */

import type { ListKind } from '../person-lists.js';

const PATHS: Record<ListKind, string> = {
    fixed: '<path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10"/><path d="M4.6 6.5h.01M4.6 12h.01M4.6 17.5h.01" stroke-width="3.2"/>',
    auto: '<path d="M19.5 12a7.5 7.5 0 0 1-13.4 4.6"/><path d="M4.5 12a7.5 7.5 0 0 1 13.4-4.6"/><path d="M18.6 3.6v4.2h-4.2"/><path d="M5.4 20.4v-4.2h4.2"/>',
    work: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M8 12.4l2.8 2.8 5.3-5.6"/>',
};

/** The kind's colour: neutral for fixed and automatic, the accent for a checklist. */
export const LIST_KIND_COLOR: Record<ListKind, string> = {
    fixed: 'var(--text-light)',
    auto: 'var(--text-light)',
    work: 'var(--accent-text)',
};

/** The icon of a list's kind as an SVG string, `size` px square. */
export function listKindIcon(kind: ListKind, size = 16): string {
    const s = Math.max(1, Math.round(size));
    return `<svg class="list-kind-icon list-kind-${kind}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="color:${LIST_KIND_COLOR[kind]};flex:none">${PATHS[kind]}</svg>`;
}
