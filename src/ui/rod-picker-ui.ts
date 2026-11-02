/**
 * The choice of a line and the whole tree's introduction in the app's window
 * (spec 026 P3 §1.3, §2.3): what the saved file's script does
 * (PAGE_SET_SCRIPT in src/family-pages-css.ts), for the window's markup.
 *
 * The choice: the search field filters the lines (without diacritics), ↓/↑
 * move between the links, Enter opens the first one, Escape and a click
 * outside close it. Its links are `data-sp-open` buttons the window follows.
 * The introduction: the sorting segment, the lines' filter, "Show all N
 * lines", the pairs' folds and the jumps of "Other families" letters.
 */

import { rodPickKey } from '../rod-picker.js';

function finePointer(): boolean {
    return !!window.matchMedia?.('(pointer: fine)').matches;
}

export interface WireRodPickerOptions {
    /** The `<details>` itself (the tree view's bar); default: the one in root's `.sp-fbar`. */
    pick?: HTMLDetailsElement;
    /** Removes every listener (the tree view wires its choice again after each change). */
    signal?: AbortSignal;
    /** Where a click closes the choice (default: root). */
    outside?: EventTarget;
    /** The first result of a query framed, the one Enter picks (the tree view, spec 039 §1.3). */
    markFirst?: boolean;
}

/**
 * The choice of a line in the window's bar or the tree view's toolbar;
 * `onPick` gets the chosen item's `data-rod`. With `data-other-mode="expand"`
 * (spec 039 §1.4) "Other families" unfolds the small lines under itself and
 * a query looks through them too.
 */
export function wireRodPicker(root: HTMLElement, onPick?: (rod: string) => void, opts: WireRodPickerOptions = {}): void {
    const pick = opts.pick ?? root.querySelector<HTMLDetailsElement>('.sp-fbar details.sp-rodpick');
    if (!pick) return;
    const on = { signal: opts.signal };
    const expand = pick.dataset.otherMode === 'expand';
    const input = pick.querySelector<HTMLInputElement>('.sp-rodpick-q');
    const items = (): HTMLElement[] => [...pick.querySelectorAll<HTMLElement>('.sp-rodpick-list > li')];
    const visible = (): HTMLElement[] => items().filter(li => !li.hidden)
        .map(li => li.querySelector<HTMLElement>('.sp-rodpick-a, .sp-rodpick-x')).filter((a): a is HTMLElement => !!a);
    const toggleBtn = (): HTMLButtonElement | null => pick.querySelector<HTMLButtonElement>('.sp-rodpick-x');
    let unfolded = false;
    const filter = (): void => {
        const k = rodPickKey(input?.value ?? '');
        let n = 0;
        let smallHits = 0;
        for (const li of items()) {
            const key = li.dataset.q;
            const match = !k || (key !== undefined && key.includes(k));
            if (li.classList.contains('sp-rodpick-small')) {
                // Unfolded by the button, or found by a query (shown right under "Other families").
                const shown = k ? match : unfolded;
                li.hidden = !shown;
                if (k && match) { n++; smallHits++; }
                continue;
            }
            li.hidden = !match;
            if (match && key !== undefined) n++;
        }
        if (expand) {
            const other = pick.querySelector<HTMLElement>('.sp-rodpick-other');
            if (other) other.hidden = !!k && smallHits === 0;
            const x = toggleBtn();
            const open = k ? smallHits > 0 : unfolded;
            x?.setAttribute('aria-expanded', String(open));
            const chev = x?.querySelector('.sp-rodpick-xchev');
            if (chev) chev.textContent = open ? '▾' : '▸';
        }
        if (opts.markFirst) {
            pick.querySelectorAll('.sp-rodpick-first').forEach(el => el.classList.remove('sp-rodpick-first'));
            if (k) visible().find(a => a.classList.contains('sp-rodpick-a'))?.classList.add('sp-rodpick-first');
        }
        const none = pick.querySelector<HTMLElement>('.sp-rodpick-none');
        if (none) none.hidden = !k || n > 0;
    };
    const shut = (): void => {
        if (!pick.open) return;
        pick.open = false;
        if (input?.value) { input.value = ''; filter(); }
    };
    pick.addEventListener('toggle', () => {
        if (pick.open) { if (input && finePointer()) input.focus({ preventScroll: true }); }
        else if (input?.value) { input.value = ''; filter(); }
    }, on);
    input?.addEventListener('input', filter, on);
    input?.addEventListener('keydown', (e) => {
        const a = visible();
        const first = a.find(el => el.classList.contains('sp-rodpick-a'));
        if (e.key === 'Enter' && first && (input.value || !opts.markFirst)) { e.preventDefault(); first.click(); }
        else if (e.key === 'ArrowDown' && a.length) { e.preventDefault(); a[0].focus(); }
    }, on);
    pick.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!pick.open) return;
            // The choice's Escape only: the window stays open.
            e.preventDefault();
            e.stopPropagation();
            shut();
            pick.querySelector<HTMLElement>('summary')?.focus();
            return;
        }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const a = visible();
        const i = a.indexOf(document.activeElement as HTMLElement);
        if (i < 0) return;
        e.preventDefault();
        if (e.key === 'ArrowDown') a[Math.min(a.length - 1, i + 1)].focus();
        else if (i > 0) a[i - 1].focus();
        else input?.focus();
    }, on);
    pick.addEventListener('click', (e) => {
        const x = (e.target as HTMLElement).closest<HTMLElement>('.sp-rodpick-x');
        if (x) {
            unfolded = !unfolded;
            if (input?.value) input.value = '';
            filter();
            return;
        }
        const a = (e.target as HTMLElement).closest<HTMLElement>('.sp-rodpick-a');
        if (!a) return;
        const rod = a.closest<HTMLElement>('li')?.dataset.rod ?? '';
        shut();
        onPick?.(rod);
    }, on);
    (opts.outside ?? root).addEventListener('click', (e) => {
        if (pick.open && !pick.contains(e.target as Node)) shut();
    }, on);
    // A current small line shows unfolded at once (the row that says where the view is).
    if (expand && pick.querySelector('.sp-rodpick-small[aria-current]')) { unfolded = true; filter(); }
}

/** The rows of the lines: the filter, the first `data-sp-cut` rows until "Show all", the "nothing found" line. */
function syncRows(sec: HTMLElement): void {
    const ol = sec.querySelector<HTMLElement>('.sp-rrows');
    if (!ol) return;
    const k = rodPickKey(sec.querySelector<HTMLInputElement>('.sp-rods-q')?.value ?? '');
    const cut = Number(ol.dataset.spCut ?? 0);
    const all = ol.hasAttribute('data-sp-all');
    let i = 0;
    let n = 0;
    for (const li of ol.querySelectorAll<HTMLElement>('.sp-rrow')) {
        const match = !k || (li.dataset.q ?? '').includes(k);
        li.hidden = !(match && (!!k || all || !cut || i < cut));
        if (match) { i++; n++; }
    }
    const more = sec.querySelector<HTMLElement>('.sp-rrows-all');
    if (more) more.hidden = !!k || all || !cut;
    const none = sec.querySelector<HTMLElement>('.sp-rrows-none');
    if (none) none.hidden = !k || n > 0;
}

/** The sorting segment: by size, the oldest first, by name (`data-sp-o` holds the three ranks); "Other families" stays last. */
function sortLines(sec: HTMLElement, k: number): void {
    sec.querySelectorAll<HTMLElement>('[data-sp-sort]').forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.spSort) === k)));
    sec.querySelectorAll<HTMLElement>('.sp-sortable').forEach(box => {
        const kids = [...box.children] as HTMLElement[];
        const rank = (el: HTMLElement): number => Number((el.dataset.spO ?? '').split(' ')[k]);
        const keyed = kids.filter(c => c.dataset.spO !== undefined).sort((a, b) => rank(a) - rank(b));
        const rest = kids.filter(c => c.dataset.spO === undefined);
        for (const c of [...keyed, ...rest]) box.appendChild(c);
    });
    syncRows(sec);
}

/** The whole tree's introduction and "Other families" in the window. */
export function wireTreePages(root: HTMLElement): void {
    root.querySelectorAll<HTMLDetailsElement>('details.sp-pair[data-sp-fold]').forEach(f => { f.open = false; });
    const sec = root.querySelector<HTMLElement>('section.sp-page--tree');
    if (sec) {
        syncRows(sec);
        sec.querySelector<HTMLInputElement>('.sp-rods-q')?.addEventListener('input', () => syncRows(sec));
        sec.addEventListener('click', (e) => {
            const t = e.target as HTMLElement;
            const sort = t.closest<HTMLElement>('[data-sp-sort]');
            if (sort) { sortLines(sec, Number(sort.dataset.spSort)); return; }
            if (t.closest('.sp-rrows-all')) {
                sec.querySelector('.sp-rrows')?.setAttribute('data-sp-all', '');
                syncRows(sec);
            }
        });
    }
    root.addEventListener('click', (e) => {
        const jump = (e.target as HTMLElement).closest<HTMLElement>('[data-sp-jump]');
        if (!jump) return;
        const to = root.querySelector<HTMLElement>(`#${CSS.escape(jump.dataset.spJump ?? '')}`);
        to?.scrollIntoView({ block: 'start' });
    });
}
