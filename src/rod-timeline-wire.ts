/**
 * The controls of a line's timeline page (1102 §5.2), for the saved file
 * (embedded in PAGE_SET_SCRIPT as source text) and for the app's window
 * (called on the rendered page). Self-contained: no imports, no names from
 * outside the function, so its source text runs on its own.
 *
 * The century segment zooms the overview to the century ±10 years and opens
 * only that century's events ("All": the whole period, the century with the
 * most events open). The chips filter the rows by kind (`data-off` on the
 * timeline; the stylesheet hides them on screen only); History also hides the
 * bands. Printing shows the whole period with every century open.
 */
export function wireRodTimelines(root: Document | Element): void {
    const doc = root.ownerDocument || (root as Document);
    const all = Array.prototype.slice.call(root.querySelectorAll('.sp-tl:not([data-tl-on])')) as HTMLElement[];
    all.forEach(tl => {
        tl.setAttribute('data-tl-on', '');
        const A = +(tl.getAttribute('data-a') || 0), B = +(tl.getAttribute('data-b') || 0);
        const main = tl.getAttribute('data-main') || '';
        const groups = Array.prototype.slice.call(tl.querySelectorAll('details.sp-tl-c')) as HTMLDetailsElement[];
        let cent = '';
        const range = (a: number, b: number): void => {
            const span = b - a;
            if (!(span > 0)) return;
            Array.prototype.slice.call(tl.querySelectorAll('[data-f]')).forEach((el: HTMLElement) => {
                const f = +(el.getAttribute('data-f') || 0), t = +(el.getAttribute('data-t') || 0);
                const x = Math.max(f, a), y = Math.min(t, b);
                if (y < a || x > b) { el.style.display = 'none'; return; }
                el.style.display = '';
                el.style.left = ((x - a) / span * 100).toFixed(2) + '%';
                el.style.width = (Math.max(y - x, 0.5) / span * 100).toFixed(2) + '%';
            });
            const ticks = tl.querySelector('.sp-tl-ticks');
            if (ticks) {
                const step = span > 200 ? 100 : span > 80 ? 50 : 25;
                let html = '';
                for (let y = Math.ceil(a / step) * step; y <= b; y += step) html += '<span style="left:' + ((y - a) / span * 100).toFixed(2) + '%">' + y + '</span>';
                ticks.innerHTML = html;
            }
        };
        const openOnly = (c: string): void => { groups.forEach(g => { g.open = g.getAttribute('data-c') === c; }); };
        const century = (c: string): void => {
            cent = c;
            Array.prototype.slice.call(tl.querySelectorAll('[data-tl-c]')).forEach((b: HTMLElement) => {
                b.setAttribute('aria-checked', String(b.getAttribute('data-tl-c') === c));
            });
            if (c) { const n = +c; range((n - 1) * 100 - 10, n * 100 + 10); openOnly(c); }
            else { range(A, B); openOnly(main); }
        };
        const filter = (): void => {
            const off: string[] = [];
            Array.prototype.slice.call(tl.querySelectorAll('[data-tl-k]')).forEach((b: HTMLElement) => {
                if (b.getAttribute('aria-pressed') === 'false') off.push(b.getAttribute('data-tl-k') || '');
            });
            if (off.length) tl.setAttribute('data-off', off.join(' ')); else tl.removeAttribute('data-off');
            groups.forEach(g => {
                const rows = Array.prototype.slice.call(g.querySelectorAll('.sp-tl-row')) as HTMLElement[];
                const shown = rows.some(x => off.indexOf(x.getAttribute('data-k') || '') < 0);
                g.classList.toggle('sp-tl-none', !shown);
            });
        };
        tl.addEventListener('click', e => {
            const t = e.target as Element;
            const c = t.closest ? t.closest('[data-tl-c]') : null;
            if (c) { century(c.getAttribute('data-tl-c') || ''); return; }
            const k = t.closest ? t.closest('[data-tl-k]') : null;
            if (k) { k.setAttribute('aria-pressed', String(k.getAttribute('aria-pressed') === 'false')); filter(); }
        });
        // Printing: the whole period, every century open; then back as it was.
        let was: boolean[] | null = null;
        (tl as unknown as { spTlPrint: (on: boolean) => void }).spTlPrint = (on: boolean): void => {
            if (on) { was = groups.map(g => g.open); groups.forEach(g => { g.open = true; }); range(A, B); }
            else if (was) { const w = was; groups.forEach((g, i) => { g.open = w[i]; }); was = null; century(cent); }
        };
        openOnly(main);
    });
    const win = doc.defaultView as (Window & { spTlPrintOn?: boolean }) | null;
    if (win && !win.spTlPrintOn) {
        win.spTlPrintOn = true;
        const each = (on: boolean): void => {
            Array.prototype.slice.call(doc.querySelectorAll('.sp-tl[data-tl-on]')).forEach((tl: HTMLElement) => {
                const f = (tl as unknown as { spTlPrint?: (on: boolean) => void }).spTlPrint;
                if (f) f(on);
            });
        };
        win.addEventListener('beforeprint', () => each(true));
        win.addEventListener('afterprint', () => each(false));
    }
}

/** The source text for a saved file: runs the wiring on the document. */
export function rodTimelineScript(): string {
    return `(${wireRodTimelines.toString()})(document);`;
}
