/**
 * The Research overview's own window by its width (spec 083 §4): from 1100 px
 * the sections stand in two columns, from 1600 px in three, each column
 * scrolled by itself (the window's body does not scroll), at most 660 px
 * wide and centred; under 1100 px one column as the panel, unchanged.
 *
 * The overview draws its sections one after another into its body as
 * always; here they are then moved into the columns. A section's split
 * comes from its guessed height (`overview-columns.ts`) and is made anew
 * only when the column count changes, a section is folded, unfolded, hidden
 * or moved, or the Queue loads more — never for live data or typing (the
 * split is kept by the sections' keys). A long section (a search field or
 * more than 8 rows) gets a sticky head in a column: its heading, field,
 * chips and what was found stay on top while its rows scroll.
 *
 * A drag of the window's border across a threshold draws nothing anew: the
 * same nodes move into the new columns, the focus (and a field's caret)
 * and the section in sight stay where they were.
 */

import {
    OverviewColumns, estimateSectionHeight, overviewColumnCount, planOverviewColumns,
} from '../overview-columns.js';

/** One section as drawn: its top-level nodes in the body, how tall it is guessed to be. */
interface ColSection {
    key: string;
    nodes: ChildNode[];
    collapsed: boolean;
    est: number;
    /** Its wrapper in a column (made once, kept). */
    wrap: HTMLElement | null;
    /** The parts lifted from its body into the sticky head (put back for one column). */
    lifted: Element[];
}

interface Drawn {
    root: HTMLElement;
    body: HTMLElement;
    /** Before the sections: the follow note, the summary, the frame "not running", the update strip. */
    lead: ChildNode[];
    sections: ColSection[];
    /** After them (the line on what comes once the research runs). */
    tail: ChildNode[];
}

/** Where a column (or the one body) was scrolled before a redraw. */
export interface OverviewScroll {
    cols: number[] | null;
    body: number;
}

let drawn: Drawn | null = null;
/** The column count drawn now (its hysteresis state; null: none yet). */
let count: OverviewColumns | null = null;
let planSig = '';
let planKeys: string[][] = [];
/** Each section's rows as its drawing said them (without a search). */
const rowsOf = new Map<string, number>();
/** What a section loaded on demand (the Queue's pages): more loaded splits the sections anew. */
const loadedOf = new Map<string, number>();
let observer: ResizeObserver | null = null;
let observed: HTMLElement | null = null;

/** The parts of a section's body that belong to its sticky head, while they lead it. */
const HEAD_PARTS = '[role="search"], .research-overview__filters, .research-overview__timeline-bar, '
    + '.research-overview__search-status, .research-overview__search-empty, .research-overview__queue-result';

/**
 * A section's rows for its guessed height (a search does not count); set
 * while it is drawn. `loaded`: what it loaded on demand ("Load more" of the
 * Queue), whose change splits the sections anew (live data does not).
 */
export function noteOverviewSectionRows(key: string, rows: number, loaded = 0): void {
    rowsOf.set(key, rows);
    loadedOf.set(key, loaded);
}

/** The overview closed: nothing of its columns is kept. */
export function resetOverviewColumns(): void {
    drawn = null;
    count = null;
    planSig = '';
    planKeys = [];
    rowsOf.clear();
    loadedOf.clear();
    observer?.disconnect();
    observed = null;
}

/** The width the window's content has. */
function widthOf(root: HTMLElement): number {
    return root.getBoundingClientRect().width || window.innerWidth;
}

/**
 * A drawing of the window's overview begins: how many columns it gets (the
 * width now, with the hysteresis), where it was scrolled, and the rows of
 * the sections are said anew. Its root is watched for its width.
 */
export function beginOverviewColumns(root: HTMLElement): OverviewScroll {
    rowsOf.clear();
    loadedOf.clear();
    watch(root);
    const body = root.querySelector<HTMLElement>(':scope > .research-overview__body');
    const cols = body ? [...body.querySelectorAll<HTMLElement>(':scope > .research-overview__col')] : [];
    return { cols: cols.length > 0 ? cols.map(c => c.scrollTop) : null, body: body?.scrollTop ?? 0 };
}

/** The nodes `body` got after `mark` (null: from its start). */
export function nodesAfter(body: HTMLElement, mark: ChildNode | null): ChildNode[] {
    const out: ChildNode[] = [];
    for (let n = mark ? mark.nextSibling : body.firstChild; n; n = n.nextSibling) out.push(n);
    return out;
}

/** The section's body (`.live-section__body`) among its nodes. */
function bodyOf(sec: ColSection): HTMLElement | null {
    for (const n of sec.nodes) if (n instanceof HTMLElement && n.classList.contains('live-section__body')) return n;
    return null;
}

/** Rows of a section in its drawing (lines in Lines, tasks, items) when it said none. */
function domRows(sec: ColSection): number {
    const body = bodyOf(sec);
    if (!body) return 0;
    const lines = body.querySelectorAll('[data-direction]:not([data-direction] [data-direction])').length;
    return lines > 0 ? lines : body.querySelectorAll('li, [data-row]').length;
}

/**
 * The drawing is done: its sections (`drawnSections`, each the nodes it put
 * into the body) go into the columns the width holds; the rest of the body
 * stays above them (lead) or under the last (tail). Scrolled as before.
 */
export function arrangeOverviewColumns(root: HTMLElement, body: HTMLElement,
    drawnSections: { key: string; nodes: ChildNode[] }[], scroll: OverviewScroll): void {
    const first = drawnSections[0]?.nodes[0] ?? null;
    const last = drawnSections.length > 0 ? drawnSections[drawnSections.length - 1].nodes[drawnSections[drawnSections.length - 1].nodes.length - 1] : null;
    const all = [...body.childNodes];
    const lead = first ? all.slice(0, all.indexOf(first)) : all;
    const tail = last ? all.slice(all.indexOf(last) + 1) : [];
    const sections: ColSection[] = drawnSections.map(d => {
        const sec: ColSection = { key: d.key, nodes: d.nodes, collapsed: false, est: 0, wrap: null, lifted: [] };
        const heading = d.nodes.flatMap(n => n instanceof HTMLElement
            ? [n.matches('[aria-controls][aria-expanded]') ? n : n.querySelector<HTMLElement>(':scope > [aria-controls][aria-expanded]')] : [])
            .find(Boolean);
        sec.collapsed = heading?.getAttribute('aria-expanded') === 'false';
        sec.est = estimateSectionHeight({ key: d.key, collapsed: sec.collapsed, rows: rowsOf.get(d.key) ?? domRows(sec) });
        return sec;
    });
    drawn = { root, body, lead, sections, tail };
    count = overviewColumnCount(widthOf(root), count);
    place(drawn, count, false);
    if (root.classList.contains('is-cols')) {
        const cols = colsOf(body);
        if (scroll.cols && scroll.cols.length === cols.length) cols.forEach((c, i) => { c.scrollTop = scroll.cols![i]; });
    } else {
        body.scrollTop = scroll.body;
    }
}

function colsOf(body: HTMLElement): HTMLElement[] {
    return [...body.querySelectorAll<HTMLElement>(':scope > .research-overview__col')];
}

/** The columns' groups of sections for `n` columns: the kept split, or a new one when what it stands on changed. */
function groupsFor(d: Drawn, n: OverviewColumns): ColSection[][] {
    const sig = JSON.stringify([n, d.sections.map(s => [s.key, s.collapsed, loadedOf.get(s.key) ?? 0])]);
    if (sig !== planSig || planKeys.length === 0) {
        // The columns' height: the body's, less what stands above them.
        let lead = 0;
        for (const n of d.lead) if (n instanceof HTMLElement) lead += n.offsetHeight;
        const area = Math.max(0, d.body.clientHeight - lead);
        const groups = planOverviewColumns(d.sections.map(s => s.est), n, area);
        planKeys = groups.map(g => g.map(i => d.sections[i].key));
        planSig = sig;
    }
    const byKey = new Map(d.sections.map(s => [s.key, s]));
    return planKeys.map(g => g.flatMap(k => byKey.get(k) ?? [])).filter(g => g.length > 0);
}

/** The focus and a field's selection before nodes move (a moved node loses the focus). */
function saveFocus(root: HTMLElement): (() => void) {
    const active = document.activeElement as HTMLElement | null;
    if (!active || !root.contains(active)) return () => {};
    const field = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null;
    let sel: [number | null, number | null, 'forward' | 'backward' | 'none' | null] | null = null;
    try {
        if (field) sel = [field.selectionStart, field.selectionEnd, field.selectionDirection];
    } catch { /* not a text field */ }
    return () => {
        if (!active.isConnected || document.activeElement === active) return;
        active.focus({ preventScroll: true });
        if (field && sel && sel[0] !== null && sel[1] !== null) {
            try { field.setSelectionRange(sel[0], sel[1], sel[2] ?? undefined); } catch { /* not a text field */ }
        }
    };
}

/** The element a section starts with (its wrapper in a column, else its first node). */
function topOf(sec: ColSection): HTMLElement | null {
    if (sec.wrap?.isConnected) return sec.wrap;
    return sec.nodes.find((n): n is HTMLElement => n instanceof HTMLElement) ?? null;
}

/** The section that has the focus, else the first one in sight at the top of the first column; and how far below that column's top it starts. */
function anchorOf(d: Drawn): { sec: ColSection; offset: number } | null {
    const active = document.activeElement;
    const scrollerOf = (el: HTMLElement): HTMLElement => el.closest<HTMLElement>('.research-overview__col') ?? d.body;
    let sec = active ? d.sections.find(s => s.nodes.some(n => n.contains(active)) || !!s.wrap?.contains(active)) ?? null : null;
    if (!sec) {
        const firstCol = colsOf(d.body)[0] ?? d.body;
        const top = firstCol.getBoundingClientRect().top;
        sec = d.sections.find(s => {
            const el = topOf(s);
            if (!el || scrollerOf(el) !== firstCol) return false;
            const last = s.wrap?.isConnected ? s.wrap : (s.nodes[s.nodes.length - 1] as HTMLElement | undefined);
            return (last?.getBoundingClientRect().bottom ?? 0) > top;
        }) ?? null;
    }
    const el = sec ? topOf(sec) : null;
    if (!sec || !el) return null;
    return { sec, offset: el.getBoundingClientRect().top - scrollerOf(el).getBoundingClientRect().top };
}

/** Lift the heading, field, chips and what was found of a long section into its sticky head. */
function liftHead(sec: ColSection, wrap: HTMLElement): void {
    const body = bodyOf(sec);
    if (!body || body.hidden) return;
    const parts: Element[] = [];
    for (const c of [...body.children]) {
        if (!c.matches(HEAD_PARTS)) break;
        parts.push(c);
    }
    const field = parts.some(p => p.matches('[role="search"]'));
    if (!field && body.querySelectorAll('li, [data-row]').length <= 8) return;
    const head = document.createElement('div');
    head.className = `research-overview__section-head${field ? ' has-field' : ''}`;
    const before = sec.nodes.slice(0, sec.nodes.indexOf(body));
    head.append(...before, ...parts);
    sec.lifted = parts;
    wrap.prepend(head);
}

/** One column again: the lifted parts back at the top of the section's body. */
function unlift(sec: ColSection): void {
    if (sec.lifted.length === 0) return;
    bodyOf(sec)?.prepend(...sec.lifted);
    sec.lifted = [];
}

/** Put the drawn sections into `n` columns (one: straight into the body, as the panel). */
function place(d: Drawn, n: OverviewColumns, keepAnchor: boolean): void {
    const { root, body } = d;
    const restoreFocus = saveFocus(root);
    const anchor = keepAnchor ? anchorOf(d) : null;
    for (const s of d.sections) unlift(s);
    const groups = n >= 2 && d.sections.length > 0 ? groupsFor(d, n) : [];
    if (groups.length === 0) {
        root.classList.remove('is-cols');
        body.classList.remove('has-lead');
        body.style.removeProperty('--ov-cols');
        body.replaceChildren(...d.lead, ...d.sections.flatMap(s => s.nodes), ...d.tail);
        for (const s of d.sections) s.wrap?.remove();
    } else {
        root.classList.add('is-cols');
        const kids: Node[] = [];
        if (d.lead.length > 0) {
            const lead = document.createElement('div');
            lead.className = 'research-overview__lead';
            lead.append(...d.lead);
            kids.push(lead);
        }
        body.classList.toggle('has-lead', d.lead.length > 0);
        body.style.setProperty('--ov-cols', String(groups.length));
        groups.forEach((g, i) => {
            const col = document.createElement('div');
            col.className = 'research-overview__col';
            col.dataset.col = String(i);
            // Focusable by a click into its empty room: Page Down and the space bar scroll it.
            col.tabIndex = -1;
            for (const s of g) {
                const wrap = s.wrap ??= document.createElement('div');
                wrap.className = 'research-overview__sec';
                wrap.dataset.sec = s.key;
                wrap.replaceChildren(...s.nodes);
                liftHead(s, wrap);
                col.appendChild(wrap);
            }
            if (i === groups.length - 1) col.append(...d.tail);
            kids.push(col);
        });
        body.replaceChildren(...kids);
        // A row focused under a sticky head is not hidden by it.
        for (const col of colsOf(body)) {
            let pad = 0;
            for (const h of col.querySelectorAll<HTMLElement>('.research-overview__section-head')) pad = Math.max(pad, h.offsetHeight);
            col.style.scrollPaddingTop = pad > 0 ? `${pad}px` : '';
        }
    }
    if (anchor) {
        const el = topOf(anchor.sec);
        const scroller = el?.closest<HTMLElement>('.research-overview__col') ?? body;
        if (el) scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset;
    }
    restoreFocus();
}

/** The window's width changed: across a threshold the same nodes move into the new columns. */
function resized(): void {
    const d = drawn;
    if (!d || !d.root.isConnected || !d.body.isConnected) return;
    const n = overviewColumnCount(widthOf(d.root), count);
    if (n === count) return;
    count = n;
    place(d, n, true);
}

function watch(root: HTMLElement): void {
    if (observed === root) return;
    observer?.disconnect();
    observed = root;
    if (typeof ResizeObserver !== 'function') return;
    observer ??= new ResizeObserver(() => resized());
    observer.observe(root);
}
