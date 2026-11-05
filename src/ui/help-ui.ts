/**
 * "How Strom works": the help window.
 *
 * The help is embedded in the app file (src/help/help-data.ts); the window
 * opens only once its language is inflated, so it never shows a loading
 * state and works offline the same as online. It sits above every other
 * window (the Research overview, the Places window, the conflicts panel):
 * Escape closes the help alone, closing returns the keyboard to what opened it.
 *
 * Screens: the contents (parts A · R · S with their chapters), a chapter
 * (its rules, a jump to one rule highlighted for a moment), the search
 * results and the glossary. Every move inside the window is remembered (up
 * to 30 places, with the scroll position); Back returns there, and the
 * system Back (a history entry pushed when the window opens) does the same,
 * closing the window when nothing is left.
 *
 * Everything is drawn with createElement + textContent; the only links out
 * are https, opened in a new window.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { APP_VERSION } from '../types.js';
import { isPhoneBar } from '../breakpoints.js';
import { findRule, hasHelpData, helpDocInfo, helpLangOf, loadHelp } from '../help/help-data.js';
import {
    buildHelpIndex, helpTermLabel, searchHelp, type HelpSearchIndex, type HelpSeg,
} from '../help/help-search.js';
import type {
    HelpBlock, HelpChapter, HelpHeading, HelpInline, HelpLang, HelpLangData, HelpList, HelpMeta, HelpTerm,
} from '../help/help-types.js';
import { uiModule } from './module.js';

/** Where the help's links lead. */
const INSTALL_URL = 'https://stromapp.info/research/help/';
const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
const SOURCE_URL = 'https://github.com/ACiDekCZ/strom-doc';
const SHORT_LINK = (id: string): string => `https://stromapp.info/doc/${id}`;
const WEB_LINK = (lang: HelpLang, chapter: string, rule: string | null): string =>
    `https://stromapp.info/doc/${lang}/${chapter}/${rule ? `#${rule}` : ''}`;

const HISTORY_MAX = 30;
const HIGHLIGHT_MS = 2600;
const COPIED_MS = 2000;
const SEARCH_DEBOUNCE_MS = 80;
/** A rule counts as the current one once its heading is this close to the top. */
const CURRENT_RULE_PX = 60;
const NUMBER_RE = /^([ARSars]\d+)((?:\.\d+)*)$/;

type Screen = 'home' | 'art' | 'search' | 'index';

/** One remembered place of the window. */
interface Snap {
    scr: Screen;
    ch: string;
    rule: string | null;
    q: string;
    top: number;
    label: string;
}

interface HelpWindow {
    lang: HelpLang;
    data: HelpLangData;
    index: HelpSearchIndex | null;
    scr: Screen;
    ch: string;
    /** The rule the reader is at (by scrolling, or the one jumped to). */
    cur: string | null;
    q: string;
    hist: Snap[];
    notice: string | null;
    tocOpen: boolean;
    overlay: HTMLElement;
    modal: HTMLElement;
    main: HTMLElement;
    col: HTMLElement;
    side: HTMLElement;
    back: HTMLButtonElement;
    backLabel: HTMLElement;
    input: HTMLInputElement;
    clear: HTMLButtonElement;
    closeBtn: HTMLButtonElement;
    opener: HTMLElement | null;
    timers: Set<ReturnType<typeof setTimeout>>;
    searchTimer: ReturnType<typeof setTimeout> | null;
    scrollFrame: number;
    /** The scroll position a jump left the chapter at: there, the rule jumped to stays the current one. */
    pinnedTop: number | null;
    cleanup: () => void;
}

let win: HelpWindow | null = null;
/** history.back() calls of a closing window whose popstate is still to come. */
let pendingPops = 0;
let popListening = false;
let researchVersionOf: () => string = () => '';
let startTourOf: (() => void) | null = null;

/** How the window learns the version of the research connected to the tree ('' = none). */
export function setHelpResearchVersion(fn: () => string): void {
    researchVersionOf = fn;
}

/** How the contents start the app tour (the window closes first). */
export function setHelpTour(fn: () => void): void {
    startTourOf = fn;
}

/**
 * Another window or sheet is open under the help (it was opened from a "?"
 * there): the tour would point at controls covered by it, so it is not offered.
 */
function coveredByWindow(w: HelpWindow): boolean {
    return Array.from(document.querySelectorAll('.modal-overlay.active, .bottom-sheet-overlay.active'))
        .some(o => o !== w.overlay);
}

/** The help window is open. */
export function isHelpOpen(): boolean {
    return win !== null;
}

const closeListeners = new Set<() => void>();

/** Called after the help closes (its opener has the keyboard back by then). Returns the way to stop listening. */
export function onHelpClose(fn: () => void): () => void {
    closeListeners.add(fn);
    return () => { closeListeners.delete(fn); };
}

// ---------------------------------------------------------------------------
// Small DOM helpers (no innerHTML anywhere).

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

function svgIcon(kind: 'search' | 'back' | 'link' | 'close'): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.classList.add('help-icon', `help-icon-${kind}`);
    const add = (name: string, attrs: Record<string, string>): void => {
        const n = document.createElementNS(ns, name);
        for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
        svg.appendChild(n);
    };
    if (kind === 'search') {
        add('circle', { cx: '11', cy: '11', r: '7' });
        add('path', { d: 'M20 20l-3.5-3.5' });
    } else if (kind === 'back') {
        add('path', { d: 'M15 18l-6-6 6-6' });
    } else if (kind === 'close') {
        add('path', { d: 'M18 6 6 18M6 6l12 12' });
    } else {
        add('path', { d: 'M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5' });
        add('path', { d: 'M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5' });
    }
    return svg;
}

/** A link out: https only, a new window, " ↗" after the text. Anything else stays text. */
function outLink(url: string, text: string, cls = 'help-out'): HTMLElement {
    if (!/^https:\/\//i.test(url)) return el('span', undefined, text);
    const a = el('a', cls, `${text} ↗`);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
}

/** A control that moves inside the window, drawn as a link. */
function navButton(cls: string, text: string, run: () => void): HTMLButtonElement {
    const b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', run);
    return b;
}

function segsInto(parent: HTMLElement, segs: HelpSeg[]): void {
    for (const s of segs) parent.appendChild(s.m ? el('mark', 'help-hit', s.t) : document.createTextNode(s.t));
}

/** "na čem agent pracuje" → "Na čem agent pracuje" (the contents line of a chapter). */
function sentence(text: string): string {
    return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
}

/** Version numbers compared part by part; "-beta.N" and the like are left out. */
function versionOlder(have: string, need: string): boolean {
    const parts = (v: string): number[] => v.replace(/^v/i, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
    const a = parts(have);
    const b = parts(need);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        if (x !== y) return x < y;
    }
    return false;
}

function plainVersion(v: string): string {
    return v.replace(/^v/i, '').split('-')[0];
}

async function copyText(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        return;
    } catch {
        // Fall back below (no clipboard permission, an older browser).
    }
    const area = el('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); } catch { /* nothing more to try */ }
    area.remove();
}

// ---------------------------------------------------------------------------
// State and moves.

function later(w: HelpWindow, ms: number, run: () => void): void {
    const t = setTimeout(() => { w.timers.delete(t); run(); }, ms);
    w.timers.add(t);
}

function chapterOf(w: HelpWindow, id: string): HelpChapter | null {
    return w.data.chapters.find(c => c.id === id) ?? null;
}

function ruleTitle(w: HelpWindow, id: string): string {
    const found = findRule(w.lang, id);
    if (!found) return id;
    return `${id} ${found.block ? found.block.title : found.chapter.title}`;
}

function snapOf(w: HelpWindow): Snap {
    const s = strings.help;
    const label = w.scr === 'art' ? (w.cur ?? w.ch)
        : w.scr === 'index' ? s.index
            : w.scr === 'search' && w.q.trim() ? `„${w.q.trim()}“`
                : s.home;
    return { scr: w.scr, ch: w.ch, rule: w.cur, q: w.q, top: w.main.scrollTop, label };
}

function remember(w: HelpWindow): void {
    w.hist.push(snapOf(w));
    if (w.hist.length > HISTORY_MAX) w.hist.splice(0, w.hist.length - HISTORY_MAX);
}

/** Go to a chapter or rule number; an unknown number shows the contents with a note. */
function go(w: HelpWindow, id: string, push = true): void {
    if (push) remember(w);
    w.notice = null;
    w.tocOpen = false;
    const m = NUMBER_RE.exec(id.trim());
    const ch = m ? m[1].toUpperCase() : '';
    const full = m ? ch + m[2] : id.trim();
    if (!m || !chapterOf(w, ch) || (m[2] && !findRule(w.lang, full)?.block)) {
        w.scr = 'home';
        w.notice = strings.help.unknown(full);
        setQuery(w, '');
        render(w, { top: 0 });
        return;
    }
    w.scr = 'art';
    w.ch = ch;
    w.cur = m[2] ? full : null;
    setQuery(w, '');
    render(w, { jump: m[2] ? full : null });
}

function goHome(w: HelpWindow): void {
    remember(w);
    w.scr = 'home';
    w.notice = null;
    setQuery(w, '');
    render(w, { top: 0 });
}

function openIndex(w: HelpWindow, term?: string): void {
    remember(w);
    w.scr = 'index';
    w.notice = null;
    setQuery(w, '');
    render(w, { term: term ?? null });
}

function openSearch(w: HelpWindow): void {
    if (w.scr !== 'search') {
        remember(w);
        w.scr = 'search';
        w.notice = null;
        render(w, { top: 0 });
    }
    w.input.focus();
}

/** Back one place; nothing remembered: the contents. False when there was nowhere to go. */
function goBack(w: HelpWindow): boolean {
    const last = w.hist.pop();
    w.notice = null;
    if (!last) {
        if (w.scr === 'home') return false;
        w.scr = 'home';
        setQuery(w, '');
        render(w, { top: 0 });
        return true;
    }
    w.scr = last.scr;
    w.ch = last.ch;
    w.cur = last.rule;
    setQuery(w, last.scr === 'search' ? last.q : '');
    render(w, { top: last.top });
    return true;
}

function setQuery(w: HelpWindow, q: string): void {
    w.q = q;
    if (w.input.value !== q) w.input.value = q;
    w.clear.hidden = q.length === 0;
}

/** The search field changed (after the short pause of typing). */
function queryChanged(w: HelpWindow): void {
    const q = w.input.value;
    w.clear.hidden = q.length === 0;
    if (w.scr !== 'search') {
        if (q.trim().length < 2) { w.q = q; return; }
        remember(w);
        w.scr = 'search';
        w.notice = null;
        w.q = q;
        render(w, { top: 0 });
        return;
    }
    if (!q && !isPhoneBar() && w.hist.length > 0) {
        w.q = '';
        goBack(w);
        return;
    }
    w.q = q;
    render(w, { top: 0 });
}

function searchEnter(w: HelpWindow): void {
    const q = w.input.value.trim();
    if (q.length < 2) return;
    if (NUMBER_RE.test(q)) {
        go(w, q);
        return;
    }
    const first = searchHelp(indexOf(w), q).rules[0];
    if (first) go(w, first.rule.id);
}

function indexOf(w: HelpWindow): HelpSearchIndex {
    if (!w.index) w.index = buildHelpIndex(w.data);
    return w.index;
}

// ---------------------------------------------------------------------------
// Drawing.

interface RenderOpts {
    /** Scroll the main column here (back). */
    top?: number;
    /** Jump to this rule and highlight it. */
    jump?: string | null;
    /** The glossary: scroll to this term. */
    term?: string | null;
}

function render(w: HelpWindow, opts: RenderOpts = {}): void {
    const s = strings.help;
    w.modal.dataset.screen = w.scr;
    w.modal.dataset.hasHist = w.hist.length > 0 ? '1' : '0';
    const prev = w.hist[w.hist.length - 1];
    const backAria = s.backTo(prev ? prev.label : s.home);
    w.back.setAttribute('aria-label', backAria);
    w.back.title = backAria;

    w.side.replaceChildren();
    w.side.hidden = w.scr !== 'art';
    if (w.scr === 'art') drawSide(w);

    const col = el('div', 'help-col');
    if (w.scr === 'home') drawHome(w, col);
    else if (w.scr === 'art') drawArticle(w, col);
    else if (w.scr === 'search') drawSearch(w, col);
    else drawIndex(w, col);
    w.col.replaceWith(col);
    w.col = col;

    w.pinnedTop = null;
    if (opts.jump) {
        jumpTo(w, opts.jump);
    } else if (opts.term) {
        const row = w.main.querySelector<HTMLElement>(`[data-term="${CSS.escape(opts.term)}"]`);
        w.main.scrollTop = row ? Math.max(0, row.offsetTop - 10) : 0;
        if (row) flash(w, row);
    } else {
        w.main.scrollTop = opts.top ?? 0;
    }
    if (w.scr === 'art') trackCurrent(w);
}

function flash(w: HelpWindow, target: HTMLElement): void {
    target.classList.add('is-target');
    later(w, HIGHLIGHT_MS, () => target.classList.remove('is-target'));
}

function jumpTo(w: HelpWindow, id: string): void {
    const rule = w.main.querySelector<HTMLElement>(`[data-rule="${CSS.escape(id)}"]`);
    if (!rule) { w.main.scrollTop = 0; return; }
    w.main.scrollTop = Math.max(0, rule.offsetTop - 14);
    // Near the end of a chapter the rule cannot reach the top: it is the current one all the same.
    w.cur = id;
    w.pinnedTop = w.main.scrollTop;
    flash(w, rule);
    rule.querySelector<HTMLElement>('.help-rule-title')?.focus({ preventScroll: true });
}

/** The rule at the top of the chapter as the reader scrolls (the list on the left, the web link). */
function trackCurrent(w: HelpWindow): void {
    if (w.scr !== 'art') return;
    let cur: string | null = null;
    const top = w.main.scrollTop;
    if (w.pinnedTop !== null && Math.abs(top - w.pinnedTop) < 2) {
        cur = w.cur;
    } else {
        w.pinnedTop = null;
        for (const h of w.main.querySelectorAll<HTMLElement>('[data-rule]')) {
            if (h.offsetTop - top <= CURRENT_RULE_PX) cur = h.dataset.rule ?? null;
            else break;
        }
        w.cur = cur;
    }
    for (const r of w.side.querySelectorAll<HTMLElement>('.help-side-rule')) {
        const id = r.dataset.rule ?? '';
        r.classList.toggle('is-current', !!cur && (cur === id || cur.startsWith(`${id}.`)));
    }
    const web = w.col.querySelector<HTMLAnchorElement>('.help-web');
    if (web) {
        const url = WEB_LINK(w.lang, w.ch, cur);
        web.href = url;
        web.title = url;
    }
}

function partTitle(w: HelpWindow, id: string): string {
    return w.data.parts.find(p => p.id === id)?.title ?? id;
}

function drawSide(w: HelpWindow): void {
    const s = strings.help;
    w.side.appendChild(navButton('help-side-home', s.home, () => goHome(w)));
    for (const part of w.data.parts) {
        const group = el('div', 'help-side-part');
        group.appendChild(el('span', 'help-side-part-title', `${part.id} · ${part.title}`));
        for (const c of w.data.chapters.filter(x => x.part === part.id)) {
            const open = c.id === w.ch;
            const row = el('button', 'help-side-ch');
            row.type = 'button';
            if (open) row.setAttribute('aria-current', 'page');
            row.appendChild(el('span', 'help-num', c.id));
            row.appendChild(el('span', 'help-side-ch-title', c.title));
            row.addEventListener('click', () => go(w, c.id));
            group.appendChild(row);
            if (open) {
                const rules = el('div', 'help-side-rules');
                for (const b of c.blocks) {
                    if (b.k !== 'h' || b.level !== 2) continue;
                    const r = navButton('help-side-rule', `${b.id} ${b.title}`, () => go(w, b.id));
                    r.dataset.rule = b.id;
                    rules.appendChild(r);
                }
                group.appendChild(rules);
            }
        }
        w.side.appendChild(group);
    }
    const foot = el('div', 'help-side-foot');
    foot.appendChild(navButton('help-linkbtn', s.index, () => openIndex(w)));
    foot.appendChild(outLink(INSTALL_URL, s.install, 'help-out help-install'));
    w.side.appendChild(foot);
}

function drawFoot(): HTMLElement {
    const s = strings.help;
    const foot = el('div', 'help-foot');
    foot.appendChild(document.createTextNode(`${s.lic} · `));
    foot.appendChild(outLink(LICENSE_URL, s.licLink));
    foot.appendChild(document.createTextNode(' · '));
    foot.appendChild(outLink(SOURCE_URL, s.source));
    return foot;
}

function drawHome(w: HelpWindow, col: HTMLElement): void {
    const s = strings.help;
    const home = el('div', 'help-home');
    if (w.notice) {
        const n = el('div', 'help-notice', w.notice);
        n.setAttribute('role', 'status');
        home.appendChild(n);
    }
    // Phone: the search field leads the contents (the header has none here).
    const fake = el('button', 'help-home-search');
    fake.type = 'button';
    fake.setAttribute('aria-label', s.search);
    fake.appendChild(svgIcon('search'));
    fake.appendChild(el('span', undefined, s.searchPh));
    fake.addEventListener('click', () => openSearch(w));
    home.appendChild(fake);

    const info = el('div', 'help-home-info');
    info.appendChild(navButton('help-linkbtn help-index-link', s.index, () => openIndex(w)));
    const tour = startTourOf;
    if (tour && !coveredByWindow(w)) {
        info.appendChild(navButton('help-linkbtn help-tour-link', strings.tour.menu, () => {
            closeHelp();
            tour();
        }));
    }
    const { describes } = helpDocInfo();
    info.appendChild(el('span', 'help-docver', s.docVer(plainVersion(describes.app), plainVersion(describes.research))));
    home.appendChild(info);

    for (const part of w.data.parts) {
        const sec = el('section', 'help-part');
        const head = el('div', 'help-part-head');
        head.appendChild(el('span', 'help-part-id', part.id));
        head.appendChild(el('h2', 'help-part-title', part.title));
        sec.appendChild(head);
        const grid = el('div', 'help-chapters');
        for (const c of w.data.chapters.filter(x => x.part === part.id)) {
            const row = el('button', 'help-ch');
            row.type = 'button';
            row.dataset.chapter = c.id;
            row.appendChild(el('span', 'help-num', c.id));
            const text = el('span', 'help-ch-text');
            text.appendChild(el('span', 'help-ch-title', c.title));
            if (c.desc) text.appendChild(el('span', 'help-ch-desc', sentence(c.desc)));
            row.appendChild(text);
            row.addEventListener('click', () => go(w, c.id));
            grid.appendChild(row);
        }
        sec.appendChild(grid);
        home.appendChild(sec);
    }

    const end = el('div', 'help-home-end');
    end.appendChild(outLink(INSTALL_URL, s.install, 'help-out help-install'));
    end.appendChild(drawFoot());
    home.appendChild(end);
    col.appendChild(home);
}

// --- inline text and blocks of a chapter

function drawInline(w: HelpWindow, parent: HTMLElement, content: HelpInline[]): void {
    for (const x of content) {
        if (typeof x === 'string') parent.appendChild(document.createTextNode(x));
        else if ('b' in x) parent.appendChild(el('strong', undefined, x.b));
        else if ('i' in x) parent.appendChild(el('em', undefined, x.i));
        else if ('code' in x) parent.appendChild(el('code', 'help-icode', x.code));
        else if ('url' in x) parent.appendChild(outLink(x.url, x.t));
        else parent.appendChild(refLink(w, x.ref, x.t));
    }
}

/** A link to a number of the help (a rule, a chapter, the glossary or one of its terms). */
function refLink(w: HelpWindow, ref: string, text: string): HTMLElement {
    const a = el('a', 'help-ref', text);
    a.href = `#${ref}`;
    const isIndex = ref === 'index' || ref.startsWith('index#');
    a.title = isIndex ? strings.help.index : ruleTitle(w, ref);
    a.addEventListener('click', (e) => {
        e.preventDefault();
        if (isIndex) openIndex(w, ref.includes('#') ? ref.slice(ref.indexOf('#') + 1) : undefined);
        else go(w, ref);
    });
    return a;
}

function drawList(w: HelpWindow, list: HelpList): HTMLElement {
    const l = el(list.k, 'help-list');
    list.items.forEach((item, n) => {
        const li = el('li');
        drawInline(w, li, item);
        const sub = list.sub?.[n];
        if (sub) li.appendChild(drawList(w, sub));
        l.appendChild(li);
    });
    return l;
}

/**
 * The notes under a rule whose version is newer than the connected research
 * ('' = none connected: not compared) or, as a safeguard, than this app.
 * Research first; versions as numbers only (a beta suffix left out).
 */
export function helpVersionNotes(since: HelpHeading['since'], research: string, app: string): string[] {
    if (!since) return [];
    const s = strings.help;
    const notes: string[] = [];
    const have = research ? plainVersion(research) : '';
    if (since.research && have && versionOlder(have, since.research)) {
        notes.push(s.verRes(have, plainVersion(since.research)));
    }
    if (since.app && app && versionOlder(app, since.app)) {
        notes.push(s.verApp(plainVersion(app), plainVersion(since.app)));
    }
    return notes;
}

function versionNotes(since: HelpHeading['since']): string[] {
    return helpVersionNotes(since, researchVersionOf() || '', APP_VERSION);
}

function noteEl(text: string): HTMLElement {
    const n = el('span', 'help-ver-note');
    n.appendChild(el('span', 'help-ver-dot'));
    n.appendChild(document.createTextNode(text));
    return n;
}

function drawMeta(w: HelpWindow, meta: HelpMeta, notes: string[]): HTMLElement {
    const box = el('div', 'help-meta');
    for (const item of meta.items) {
        box.appendChild(el('span', 'help-meta-label', item.label));
        const value = el('span', 'help-meta-value');
        drawInline(w, value, item.c);
        box.appendChild(value);
        if (item.since) for (const n of notes) box.appendChild(noteEl(n));
    }
    return box;
}

function drawTable(w: HelpWindow, block: Extract<HelpBlock, { k: 'table' }>): HTMLElement {
    const wrap = el('div', 'help-table-wrap');
    wrap.setAttribute('role', 'region');
    wrap.tabIndex = 0;
    wrap.setAttribute('aria-label', block.head.join(', '));
    const table = el('table', 'help-table');
    const thead = el('thead');
    const hr = el('tr');
    for (const h of block.head) hr.appendChild(el('th', undefined, h));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');
    for (const row of block.rows) {
        const tr = el('tr');
        for (const cell of row) {
            const td = el('td');
            drawInline(w, td, cell);
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
}

function drawHeading(w: HelpWindow, h: HelpHeading): HTMLElement {
    const s = strings.help;
    const level = Math.min(4, Math.max(2, h.level));
    const wrap = el('div', `help-rule help-rule--${level}`);
    wrap.dataset.rule = h.id;
    const title = el(level === 2 ? 'h2' : level === 3 ? 'h3' : 'h4', 'help-rule-title');
    title.id = `help-${h.id}`;
    title.tabIndex = -1;
    title.appendChild(el('span', 'help-num', h.id));
    title.appendChild(document.createTextNode(h.title));
    wrap.appendChild(title);
    const copy = el('button', 'help-copy');
    copy.type = 'button';
    copy.setAttribute('aria-label', s.copyAria(h.id));
    copy.title = SHORT_LINK(h.id);
    copy.appendChild(svgIcon('link'));
    const done = el('span', 'help-copy-done');
    done.setAttribute('role', 'status');
    copy.appendChild(done);
    copy.addEventListener('click', () => {
        void copyText(SHORT_LINK(h.id));
        copy.classList.add('is-copied');
        done.textContent = `✓ ${s.copied}`;
        later(w, COPIED_MS, () => {
            copy.classList.remove('is-copied');
            done.textContent = '';
        });
    });
    wrap.appendChild(copy);
    return wrap;
}

function drawBlocks(w: HelpWindow, parent: HTMLElement, blocks: HelpBlock[]): void {
    let notes: string[] = [];
    let notesPlaced = true;
    let heading: HTMLElement | null = null;
    const placeLeftover = (): void => {
        // A rule with a version and no Since line of its own: the note goes under its heading.
        if (!notesPlaced && heading && notes.length) {
            const box = el('div', 'help-meta help-meta--notes');
            for (const n of notes) box.appendChild(noteEl(n));
            heading.after(box);
        }
        notesPlaced = true;
    };
    for (const b of blocks) {
        switch (b.k) {
            case 'h':
                placeLeftover();
                heading = drawHeading(w, b);
                parent.appendChild(heading);
                notes = versionNotes(b.since);
                notesPlaced = notes.length === 0;
                break;
            case 'p': {
                const p = el('p', 'help-p');
                drawInline(w, p, b.c);
                parent.appendChild(p);
                break;
            }
            case 'ul':
            case 'ol':
                parent.appendChild(drawList(w, b));
                break;
            case 'table':
                parent.appendChild(drawTable(w, b));
                break;
            case 'code':
                parent.appendChild(el('pre', 'help-code', b.text));
                break;
            case 'meta': {
                const hasSince = b.items.some(i => i.since);
                parent.appendChild(drawMeta(w, b, hasSince && !notesPlaced ? notes : []));
                if (hasSince) notesPlaced = true;
                break;
            }
            case 'quote': {
                const q = el('blockquote', 'help-quote');
                drawBlocks(w, q, b.blocks);
                parent.appendChild(q);
                break;
            }
        }
    }
    placeLeftover();
}

function drawToc(w: HelpWindow, c: HelpChapter): HTMLElement | null {
    const rules = c.blocks.filter((b): b is HelpHeading => b.k === 'h' && b.level <= 3);
    if (rules.length === 0) return null;
    const s = strings.help;
    const box = el('div', 'help-toc');
    const toggle = el('button', 'help-toc-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', w.tocOpen ? 'true' : 'false');
    const chev = el('span', 'help-toc-chev', w.tocOpen ? '▾' : '▸');
    chev.setAttribute('aria-hidden', 'true');
    toggle.appendChild(chev);
    toggle.appendChild(el('span', 'help-toc-label', s.toc));
    toggle.appendChild(el('span', 'help-toc-count', `· ${rules.filter(r => r.level === 2).length}`));
    const list = el('div', 'help-toc-list');
    list.hidden = !w.tocOpen;
    for (const r of rules) {
        const row = el('button', `help-toc-row help-toc-row--${r.level}`);
        row.type = 'button';
        row.appendChild(el('span', 'help-num', r.id));
        row.appendChild(el('span', 'help-toc-title', r.title));
        row.addEventListener('click', () => go(w, r.id));
        list.appendChild(row);
    }
    toggle.addEventListener('click', () => {
        w.tocOpen = !w.tocOpen;
        toggle.setAttribute('aria-expanded', w.tocOpen ? 'true' : 'false');
        chev.textContent = w.tocOpen ? '▾' : '▸';
        list.hidden = !w.tocOpen;
    });
    box.appendChild(toggle);
    box.appendChild(list);
    return box;
}

function drawArticle(w: HelpWindow, col: HTMLElement): void {
    const s = strings.help;
    const c = chapterOf(w, w.ch);
    if (!c) return;
    const art = el('article', 'help-article');
    const crumbs = el('div', 'help-crumbs');
    const trail = el('span', 'help-trail');
    trail.appendChild(navButton('help-linkbtn', s.home, () => goHome(w)));
    const sep = el('span', undefined, '›');
    sep.setAttribute('aria-hidden', 'true');
    trail.appendChild(sep);
    trail.appendChild(el('span', undefined, `${c.part} · ${partTitle(w, c.part)}`));
    crumbs.appendChild(trail);
    const web = outLink(WEB_LINK(w.lang, c.id, w.cur), s.web, 'help-out help-web');
    web.title = WEB_LINK(w.lang, c.id, w.cur);
    crumbs.appendChild(web);
    art.appendChild(crumbs);

    const h1 = el('h1', 'help-h1');
    h1.tabIndex = -1;
    h1.appendChild(el('span', 'help-num', c.id));
    h1.appendChild(document.createTextNode(c.title));
    art.appendChild(h1);

    const toc = drawToc(w, c);
    if (toc) art.appendChild(toc);

    if (c.introC.length) {
        const intro = el('p', 'help-intro');
        drawInline(w, intro, c.introC);
        art.appendChild(intro);
    }
    drawBlocks(w, art, c.blocks);

    const at = w.data.chapters.indexOf(c);
    const pager = el('nav', 'help-pager');
    pager.setAttribute('aria-label', s.pager);
    const card = (ch: HelpChapter | undefined, dir: 'prev' | 'next'): HTMLElement => {
        if (!ch) return el('span', 'help-pager-empty');
        const b = el('button', `help-pager-card help-pager-${dir}`);
        b.type = 'button';
        b.appendChild(el('span', 'help-pager-dir', dir === 'prev' ? `‹ ${s.prev}` : `${s.next} ›`));
        const t = el('span', 'help-pager-title');
        t.appendChild(el('span', 'help-num', ch.id));
        t.appendChild(document.createTextNode(ch.title));
        b.appendChild(t);
        b.addEventListener('click', () => go(w, ch.id));
        return b;
    };
    pager.appendChild(card(w.data.chapters[at - 1], 'prev'));
    pager.appendChild(card(w.data.chapters[at + 1], 'next'));
    art.appendChild(pager);
    art.appendChild(drawFoot());
    col.appendChild(art);
}

// --- search and glossary

function refChips(w: HelpWindow, term: HelpTerm): HTMLElement {
    const chips = el('span', 'help-chips');
    for (const id of term.refs) {
        const chip = navButton('help-chip', id, () => go(w, id));
        chip.title = ruleTitle(w, id);
        chips.appendChild(chip);
    }
    return chips;
}

function drawSearch(w: HelpWindow, col: HTMLElement): void {
    const s = strings.help;
    const box = el('div', 'help-results');
    box.setAttribute('role', 'region');
    box.setAttribute('aria-live', 'polite');
    box.setAttribute('aria-label', s.search);
    const q = w.q.trim();
    const indexLink = (): HTMLElement => navButton('help-linkbtn help-index-link', s.index, () => openIndex(w));
    if (q.length < 2) {
        const hint = el('div', 'help-search-hint');
        hint.appendChild(el('span', undefined, s.searchHint));
        hint.appendChild(indexLink());
        box.appendChild(hint);
        col.appendChild(box);
        return;
    }
    const r = searchHelp(indexOf(w), q);
    if (r.number) {
        const num = r.number;
        const row = el('button', 'help-num-hit');
        row.type = 'button';
        row.appendChild(el('span', 'help-num-hit-go', s.jump));
        const t = el('span', 'help-num-hit-title');
        t.appendChild(el('span', 'help-num', num.id));
        t.appendChild(document.createTextNode(num.title));
        row.appendChild(t);
        row.appendChild(el('kbd', 'help-kbd', s.enter));
        row.addEventListener('click', () => go(w, num.id));
        box.appendChild(row);
    }
    if (r.terms.length) {
        const group = el('div', 'help-group');
        group.appendChild(el('h2', 'help-group-title', s.terms));
        for (const hit of r.terms) {
            const row = el('div', 'help-term-hit');
            const label = el('span', 'help-term-label');
            segsInto(label, hit.labelSegs);
            row.appendChild(label);
            row.appendChild(el('span', 'help-term-def', hit.term.term.def));
            row.appendChild(refChips(w, hit.term.term));
            group.appendChild(row);
        }
        box.appendChild(group);
    }
    if (r.rules.length) {
        const group = el('div', 'help-group');
        group.appendChild(el('h2', 'help-group-title', `${s.rules} · ${r.rules.length}`));
        for (const hit of r.rules) {
            const row = el('button', 'help-rule-hit');
            row.type = 'button';
            const head = el('span', 'help-rule-hit-head');
            const title = el('span', 'help-rule-hit-title');
            title.appendChild(el('span', 'help-num', hit.rule.id));
            segsInto(title, hit.titleSegs);
            head.appendChild(title);
            if (hit.rule.level > 1) {
                head.appendChild(el('span', 'help-rule-hit-ch', `${hit.rule.chapter.id} ${hit.rule.chapter.title}`));
            }
            row.appendChild(head);
            if (hit.snippet) {
                const snip = el('span', 'help-snippet');
                segsInto(snip, hit.snippet);
                row.appendChild(snip);
            }
            row.addEventListener('click', () => go(w, hit.rule.id));
            group.appendChild(row);
        }
        box.appendChild(group);
    }
    if (!r.number && !r.terms.length && !r.rules.length) {
        const none = el('div', 'help-none');
        none.appendChild(el('span', 'help-none-title', s.none(q)));
        none.appendChild(el('span', 'help-none-hint', s.noneHint));
        none.appendChild(indexLink());
        box.appendChild(none);
    }
    col.appendChild(box);
}

function drawIndex(w: HelpWindow, col: HTMLElement): void {
    const s = strings.help;
    const box = el('div', 'help-index');
    const head = el('div', 'help-index-head');
    const h1 = el('h1', 'help-h1', s.index);
    h1.tabIndex = -1;
    head.appendChild(h1);
    head.appendChild(el('span', 'help-index-note', s.idxNote));
    box.appendChild(head);

    const collator = new Intl.Collator(w.lang);
    const terms = w.data.terms
        .map(term => ({ term, label: helpTermLabel(term.term) }))
        .sort((a, b) => collator.compare(a.label, b.label));
    const letters = el('div', 'help-letters');
    letters.setAttribute('role', 'navigation');
    letters.setAttribute('aria-label', s.letters);
    const rows = el('div', 'help-terms');
    const seen = new Set<string>();
    for (const { term, label } of terms) {
        const letter = label.charAt(0).toLocaleUpperCase(w.lang);
        const row = el('div', 'help-term');
        row.dataset.term = term.id;
        if (!seen.has(letter)) {
            seen.add(letter);
            row.dataset.letter = letter;
            const chip = navButton('help-chip help-letter', letter, () => {
                w.main.scrollTop = Math.max(0, row.offsetTop - 10);
            });
            letters.appendChild(chip);
        }
        row.appendChild(el('span', 'help-term-label', label));
        const body = el('span', 'help-term-body');
        body.appendChild(el('span', 'help-term-def', term.def));
        body.appendChild(refChips(w, term));
        row.appendChild(body);
        rows.appendChild(row);
    }
    box.appendChild(letters);
    box.appendChild(rows);
    col.appendChild(box);
}

// ---------------------------------------------------------------------------
// Opening and closing.

function buildWindow(lang: HelpLang, data: HelpLangData, opener: HTMLElement | null): HelpWindow {
    const s = strings.help;
    const overlay = el('div', 'modal-overlay help-overlay');
    overlay.id = 'help-overlay';
    const modal = el('div', 'modal help-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', s.title);
    modal.dataset.skeleton = 'skip';
    modal.tabIndex = -1;

    const header = el('div', 'help-header');
    const back = el('button', 'help-back');
    back.type = 'button';
    back.appendChild(svgIcon('back'));
    const backLabel = el('span', 'help-back-label', s.back);
    back.appendChild(backLabel);
    header.appendChild(back);
    header.appendChild(el('span', 'help-title', s.title));
    const search = el('label', 'help-search');
    search.appendChild(svgIcon('search'));
    const input = el('input', 'help-search-input');
    input.type = 'search';
    input.placeholder = s.searchPh;
    input.setAttribute('aria-label', s.search);
    input.autocomplete = 'off';
    input.spellcheck = false;
    search.appendChild(input);
    const clear = el('button', 'help-search-clear', '×');
    clear.type = 'button';
    clear.setAttribute('aria-label', s.clear);
    clear.title = s.clear;
    clear.hidden = true;
    search.appendChild(clear);
    header.appendChild(search);
    const searchOpen = el('button', 'help-search-open');
    searchOpen.type = 'button';
    searchOpen.setAttribute('aria-label', s.search);
    searchOpen.title = s.search;
    searchOpen.appendChild(svgIcon('search'));
    header.appendChild(searchOpen);
    const closeBtn = el('button', 'help-close');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', s.close);
    closeBtn.title = s.closeT;
    closeBtn.appendChild(svgIcon('close'));
    header.appendChild(closeBtn);
    modal.appendChild(header);

    const body = el('div', 'help-body');
    const side = el('nav', 'help-side');
    side.setAttribute('aria-label', s.home);
    side.hidden = true;
    body.appendChild(side);
    const main = el('div', 'help-main');
    const col = el('div', 'help-col');
    main.appendChild(col);
    body.appendChild(main);
    modal.appendChild(body);
    overlay.appendChild(modal);

    const w: HelpWindow = {
        lang, data, index: null, scr: 'home', ch: data.chapters[0]?.id ?? '', cur: null, q: '', hist: [],
        notice: null, tocOpen: false, overlay, modal, main, col, side, back, backLabel, input, clear, closeBtn,
        opener, timers: new Set(), searchTimer: null, scrollFrame: 0, pinnedTop: null, cleanup: () => {},
    };

    back.addEventListener('click', () => { goBack(w); });
    closeBtn.addEventListener('click', () => closeHelp());
    searchOpen.addEventListener('click', () => openSearch(w));
    clear.addEventListener('click', () => {
        if (w.scr === 'search' && !isPhoneBar() && w.hist.length > 0) {
            setQuery(w, '');
            goBack(w);
        } else {
            setQuery(w, '');
            if (w.scr === 'search') render(w, { top: 0 });
        }
        input.focus();
    });
    input.addEventListener('input', () => {
        if (w.searchTimer) clearTimeout(w.searchTimer);
        w.searchTimer = setTimeout(() => { w.searchTimer = null; queryChanged(w); }, SEARCH_DEBOUNCE_MS);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        if (w.searchTimer) { clearTimeout(w.searchTimer); w.searchTimer = null; }
        searchEnter(w);
    });
    main.addEventListener('scroll', () => {
        if (w.scr !== 'art' || w.scrollFrame) return;
        w.scrollFrame = requestAnimationFrame(() => { w.scrollFrame = 0; trackCurrent(w); });
    }, { passive: true });
    // A click on the backdrop closes the window on a computer (the global
    // backdrop handler leaves overlays with their own onclick alone).
    overlay.onclick = (e) => {
        if (e.target === overlay && !isPhoneBar()) closeHelp();
    };

    // Escape belongs to the help while it is open: in the search field it
    // first clears the query, then it closes the window (and nothing below it).
    const onKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape' || e.isComposing) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (document.activeElement === input && input.value) {
            if (w.searchTimer) { clearTimeout(w.searchTimer); w.searchTimer = null; }
            setQuery(w, '');
            if (w.scr === 'search') render(w, { top: 0 });
            return;
        }
        closeHelp();
    };
    window.addEventListener('keydown', onKey, true);
    w.cleanup = () => window.removeEventListener('keydown', onKey, true);
    return w;
}

function onPopState(): void {
    if (pendingPops > 0) {
        pendingPops--;
        return;
    }
    const w = win;
    if (!w) return;
    if (w.hist.length > 0) {
        goBack(w);
        history.pushState({ stromHelp: 1 }, '');
    } else {
        closeHelp({ fromHistory: true });
    }
}

/**
 * Open "How Strom works": its contents, a chapter or rule ('R2', 'R2.4') or
 * the glossary ('index'). The window appears only with its content ready.
 * `opener` gets the keyboard back when the window closes. Already open: it
 * moves there (Back returns).
 */
export async function openHelp(target?: string, opener?: HTMLElement | null): Promise<void> {
    if (!hasHelpData()) return;
    const lang = helpLangOf(getCurrentLanguage());
    let data: HelpLangData;
    try {
        data = await loadHelp(lang);
    } catch {
        return;
    }
    if (win) {
        if (target === 'index') openIndex(win);
        else if (target) go(win, target);
        else goHome(win);
        return;
    }
    const focusBack = opener ?? (document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement : null);
    const w = buildWindow(lang, data, focusBack);
    win = w;
    document.body.appendChild(w.overlay);
    w.overlay.classList.add('active');
    let jumped = false;
    if (target === 'index') {
        w.scr = 'index';
        render(w);
    } else if (target) {
        go(w, target, false);
        jumped = w.scr === 'art' && !!w.cur;
    } else {
        render(w);
    }
    if (!popListening) {
        window.addEventListener('popstate', onPopState);
        popListening = true;
    }
    history.pushState({ stromHelp: 1 }, '');
    if (!jumped) {
        const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
        if (w.scr === 'home' && !isPhoneBar() && !coarse) w.input.focus({ preventScroll: true });
        else if (w.scr === 'art') w.col.querySelector<HTMLElement>('.help-h1')?.focus({ preventScroll: true });
        else w.closeBtn.focus({ preventScroll: true });
    }
}

/** Close the help (its history goes with it; the next open starts over). */
export function closeHelp(opts: { fromHistory?: boolean } = {}): void {
    const w = win;
    if (!w) return;
    win = null;
    w.cleanup();
    for (const t of w.timers) clearTimeout(t);
    if (w.searchTimer) clearTimeout(w.searchTimer);
    if (w.scrollFrame) cancelAnimationFrame(w.scrollFrame);
    w.overlay.classList.remove('active');
    w.overlay.remove();
    if (!opts.fromHistory && (history.state as { stromHelp?: number } | null)?.stromHelp) {
        pendingPops++;
        history.back();
    }
    const opener = w.opener;
    if (opener && opener.isConnected && opener.getClientRects().length > 0) opener.focus({ preventScroll: true });
    for (const fn of [...closeListeners]) fn();
}

export const helpMethods = uiModule({
    /** Open "How Strom works" (see openHelp). */
    showHelp(target?: string, opener?: HTMLElement | null): void {
        void openHelp(target, opener);
    },

    /** About → "How Strom works": About closes, the help opens on its contents. */
    showHelpFromAbout(): void {
        this.closeAboutDialog();
        void openHelp();
    },

    closeHelp(): void {
        closeHelp();
    },
});
