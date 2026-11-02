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

/** The choice of a line in the window's bar; `onPick` gets the chosen item's `data-rod` (backlog: the tree view). */
export function wireRodPicker(root: HTMLElement, onPick?: (rod: string) => void): void {
    const pick = root.querySelector<HTMLDetailsElement>('.sp-fbar details.sp-rodpick');
    if (!pick) return;
    const input = pick.querySelector<HTMLInputElement>('.sp-rodpick-q');
    const items = (): HTMLElement[] => [...pick.querySelectorAll<HTMLElement>('.sp-rodpick-list > li')];
    const visible = (): HTMLElement[] => items().filter(li => !li.hidden).map(li => li.querySelector<HTMLElement>('.sp-rodpick-a')).filter((a): a is HTMLElement => !!a);
    const filter = (): void => {
        const k = rodPickKey(input?.value ?? '');
        let n = 0;
        for (const li of items()) {
            const key = li.dataset.q;
            const on = !k || (key !== undefined && key.includes(k));
            li.hidden = !on;
            if (on && key !== undefined) n++;
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
    });
    input?.addEventListener('input', filter);
    input?.addEventListener('keydown', (e) => {
        const a = visible();
        if (e.key === 'Enter' && a.length) { e.preventDefault(); a[0].click(); }
        else if (e.key === 'ArrowDown' && a.length) { e.preventDefault(); a[0].focus(); }
    });
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
    });
    pick.addEventListener('click', (e) => {
        const a = (e.target as HTMLElement).closest<HTMLElement>('.sp-rodpick-a');
        if (!a) return;
        const rod = a.closest<HTMLElement>('li')?.dataset.rod ?? '';
        shut();
        onPick?.(rod);
    });
    root.addEventListener('click', (e) => {
        if (pick.open && !pick.contains(e.target as Node)) shut();
    });
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
