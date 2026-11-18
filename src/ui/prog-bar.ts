/**
 * The one progress bar (waiting buttons §2.8, 2h): `.bar` 4 px, a pill, its track the text's colour at 22 %, the
 * share in --primary. Every long run in the app draws it through here (reading a document, sending images, a batch,
 * the sources' images, looking places up); the words around it go in a `.prog` block: what runs with "k of n" at the
 * right (`.prog-k`), the bar, then what else is known with the actions at the right (`.prog-acts`).
 */

export interface BarOpts {
    /** A paused run: the share in --text-faint. */
    paused?: boolean;
    /** More classes on the bar. */
    cls?: string;
    /** Attributes for the bar as-is (a `role="progressbar"` with its values); without them it is `aria-hidden`. */
    attrs?: string;
}

/** The share 0…1 as a width, never past the ends. */
function width(share: number): string {
    return `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%`;
}

/** The bar as HTML: `share` 0…1, or null when it is not known (it runs). */
export function barHtml(share: number | null, opts: BarOpts = {}): string {
    const cls = ['bar', share === null ? 'ind' : '', opts.paused ? 'is-paused' : '', opts.cls ?? ''].filter(Boolean).join(' ');
    const attrs = opts.attrs ? ` ${opts.attrs}` : ' aria-hidden="true"';
    return `<span class="${cls}"${attrs}><i${share === null ? '' : ` style="width:${width(share)}"`}></i></span>`;
}

/** The bar as an element (its fill set by `setBarShare`). */
export function barEl(share: number | null, opts: Omit<BarOpts, 'attrs'> = {}): HTMLElement {
    const bar = document.createElement('span');
    bar.className = ['bar', share === null ? 'ind' : '', opts.paused ? 'is-paused' : '', opts.cls ?? ''].filter(Boolean).join(' ');
    bar.setAttribute('aria-hidden', 'true');
    bar.appendChild(document.createElement('i'));
    if (share !== null) setBarShare(bar, share);
    return bar;
}

/** A new share on a bar drawn before. */
export function setBarShare(bar: HTMLElement, share: number): void {
    bar.classList.remove('ind');
    const fill = bar.querySelector<HTMLElement>(':scope > i');
    if (fill) fill.style.width = width(share);
}
