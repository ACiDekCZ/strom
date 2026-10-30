/**
 * The person page window (spec 025, part B): one person's life on a read-only
 * page over the tree — opened from the person menu's header or the phone's
 * bottom sheet. The body is buildPersonPageBody (src/person-page.ts) in mode
 * 'app'; this module is the window around it: the header, the table of
 * contents, navigation to relatives and back, the ⋯ menu, print, and the
 * "Save as HTML" dialog with sharing on phones and tablets.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { PersonId, StromData, Attachment } from '../types.js';
import { PrivacyMode } from '../privacy.js';
import { placeKey } from '../places.js';
import { researchPersonRef } from '../research-link.js';
import { personSourceRows } from '../person-sources.js';
import { shownName } from '../person-name.js';
import { isDesktop, isTablet, MQ_PHONE_BAR } from '../breakpoints.js';
import { appFontFaceCss, POSTER_SERIF_FACES, POSTER_LINE_FACES } from '../poster-fonts.js';
import {
    PERSON_PAGE_ALL_GROUPS, PersonPageGroups, PersonPageOptions, PersonPageContext, PersonPageData,
    preparePersonPageData, protectPersonPageTree, buildPersonPageBody, buildPersonPageDocument, personPageSections,
    personPageFileName, estimatePersonPageSize, personPageSizeMb, personPageLivingNames, personPageTocCurrent,
    PERSON_PAGE_DEFAULT_PRIVACY, PERSON_PAGE_PRIVACY_MODES, personPageExportPrivacy, personPageChartInput, personPageFileToggles,
} from '../person-page.js';
import { selectMapPlace, placeOrderKey, PlacePoint } from '../person-page-map.js';
import { lifeChartHtml } from '../person-page-chart.js';
import { PERSON_PAGE_CSS } from '../person-page-css.js';
import { uiModule } from './module.js';
import { openImageViewer } from './image-viewer.js';
import { personSubtitle } from './person-sources-ui.js';
import { HISTORY_CHANGED_EVENT } from './history-ui.js';

export const PERSON_PAGE_ID = 'person-page-modal';
export const PERSON_PAGE_EXPORT_ID = 'person-page-export-modal';
const CSS_ID = 'person-page-css';
/** Over 15 MB a file may not pass by e-mail (§5.1). */
const LARGE_BYTES = 15_000_000;
/** A swipe this far down closes the export dialog shown as a bottom sheet. */
const SHEET_SWIPE_CLOSE_PX = 80;
/** The export dialog's groups, in its order. */
const GROUP_ORDER: ('history' | 'childEvents' | 'sources' | 'research')[] = ['history', 'childEvents', 'sources', 'research'];
/** Groups a privacy other than full data leaves out for living people only (K2.7); the deceased keep them. */
const LIVING_DROPS: ReadonlySet<keyof PersonPageGroups> = new Set(['excerpts', 'materials', 'pdf', 'sources']);
/** Attachment images longer than this are reduced for the saved file (§3.5). */
const SHRINK_EDGE_PX = 1600;
const SHRINK_QUALITY = 0.82;

/** One image reduced to SHRINK_EDGE_PX on its longer side (JPEG), or null when it is small enough or cannot be read. */
function shrinkImage(dataUrl: string): Promise<string | null> {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            const edge = Math.max(w, h);
            if (!w || !h || edge <= SHRINK_EDGE_PX) { resolve(null); return; }
            const k = SHRINK_EDGE_PX / edge;
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(w * k);
            canvas.height = Math.round(h * k);
            const g = canvas.getContext('2d');
            if (!g) { resolve(null); return; }
            // A transparent PNG becomes JPEG on white, not on black.
            g.fillStyle = '#ffffff';
            g.fillRect(0, 0, canvas.width, canvas.height);
            g.drawImage(img, 0, 0, canvas.width, canvas.height);
            try {
                const out = canvas.toDataURL('image/jpeg', SHRINK_QUALITY);
                resolve(out.length < dataUrl.length ? out : null);
            } catch {
                resolve(null);
            }
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });
}

/** The person's attachment images over SHRINK_EDGE_PX, reduced: attachment id → the smaller data URL. */
async function shrinkAttachments(list: readonly Attachment[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const a of list) {
        if (!a.mimeType.startsWith('image/') || !a.dataUrl?.startsWith('data:image/')) continue;
        const small = await shrinkImage(a.dataUrl);
        if (small) out.set(a.id, small);
    }
    return out;
}

/** The tree with one person's attachments swapped for their reduced copies (the tree itself untouched). */
function withShrunkAttachments(data: StromData, personId: PersonId, shrunk: ReadonlyMap<string, string>): StromData {
    const p = data.persons[personId];
    if (!p?.attachments || !shrunk.size) return data;
    const attachments = p.attachments.map(a => {
        const small = shrunk.get(a.id);
        return small ? { ...a, dataUrl: small, mimeType: 'image/jpeg', sizeBytes: Math.round(small.length * 0.75) } : a;
    });
    return { ...data, persons: { ...data.persons, [personId]: { ...p, attachments } } };
}
const PRIVACY_MODES = PERSON_PAGE_PRIVACY_MODES;

/** One page of the window: the person, where it was scrolled, what was open, the switches and the selected place. */
interface PageEntry {
    personId: PersonId;
    scrollTop: number;
    open: Set<string>;
    toggles: { history: boolean; childEvents: boolean; kidPlaces: boolean };
    /** The place selected in the places map (placeKey). */
    place: string | null;
}

interface PageState {
    /** The person the window was opened for (focus returns to that card). */
    origin: PersonId;
    current: PageEntry;
    /** The pages before the current one ("‹ Name" goes back). */
    back: PageEntry[];
}

let state: PageState | null = null;
/** Stops the contents following the scroll (the window's current page). */
let tocCleanup: (() => void) | null = null;
/** A section picked in the contents stays marked while the page scrolls to it. */
let tocPick: ((id: string) => void) | null = null;
let editObserver: MutationObserver | null = null;
let rerenderQueued = false;
let userChangeHandler: (() => void) | null = null;
/** Keeps the header's Share/Save button right when the window changes size (a resized browser, a turned device). */
let resizeHandler: (() => void) | null = null;
/** Redraws the life chart for the column's width (the current page's). */
let chartObserver: ResizeObserver | null = null;
/** The last measured width of the life chart (the next page starts with it). */
let chartWidth = 0;
/** The current page's places map points (the place clicked in the text, Open in map). */
let pagePlaces: readonly PlacePoint[] = [];
/** How long a timeline row stays highlighted after a jump from the chart or the places list (ms). */
const OSA_FLASH_MS = 1300;

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function freshEntry(personId: PersonId): PageEntry {
    return { personId, scrollTop: 0, open: new Set(), toggles: { history: true, childEvents: true, kidPlaces: true }, place: null };
}

function cloneEntry(e: PageEntry): PageEntry {
    return { personId: e.personId, scrollTop: e.scrollTop, open: new Set(e.open), toggles: { ...e.toggles }, place: e.place };
}

function reducedMotion(): boolean {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function nameOf(personId: PersonId): string {
    const p = DataManager.getPerson(personId);
    return p ? shownName(p) : '?';
}

/** The page's content CSS, once into the app document (index.html carries only the window chrome). */
function ensurePageCss(): void {
    if (document.getElementById(CSS_ID)) return;
    const style = document.createElement('style');
    style.id = CSS_ID;
    style.textContent = PERSON_PAGE_CSS;
    document.head.appendChild(style);
}

/** Web Share with a file (phones, tablets): Share…; without it only Save (§6.1). */
function canShareFiles(): boolean {
    try {
        const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
        return typeof nav.share === 'function' && !!nav.canShare?.({ files: [new File([''], 'x.html', { type: 'text/html' })] });
    } catch {
        return false;
    }
}

function phoneBar(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia(MQ_PHONE_BAR).matches;
}

/** Desktop: only "Save as HTML"; a phone always has the header button (Share or Save), a tablet with Web Share only. */
function syncShareButton(): void {
    const share = overlayEl()?.querySelector<HTMLButtonElement>('.pp-share');
    if (!share) return;
    const shareOk = canShareFiles();
    share.hidden = isDesktop() || (!phoneBar() && !(isTablet() && shareOk));
    share.textContent = shareOk ? strings.personPage.share : strings.personPage.saveShort;
}

function overlayEl(): HTMLElement | null {
    return document.getElementById(PERSON_PAGE_ID);
}

function bodyEl(): HTMLElement | null {
    return overlayEl()?.querySelector<HTMLElement>('.pp-body') ?? null;
}

export const personPageMethods = uiModule({
    /** Open the person page of `personId` (the menu header, the bottom sheet's button). */
    showPersonPage(personId: PersonId): void {
        if (!DataManager.getPerson(personId)) return;
        this.openPersonPageState({ origin: personId, current: freshEntry(personId), back: [] });
    },

    /** Is the person page window open? */
    isPersonPageOpen(): boolean {
        return !!overlayEl();
    },

    /** Open (or reopen, after a place on the map) the window in a given state. */
    openPersonPageState(s: PageState): void {
        this.closePersonPage({ focus: false });
        ensurePageCss();
        state = { origin: s.origin, current: cloneEntry(s.current), back: s.back.map(cloneEntry) };
        const P = strings.personPage;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active modal-overlay--page';
        overlay.id = PERSON_PAGE_ID;
        overlay.innerHTML = `
            <div class="modal modal--page person-page" role="dialog" aria-modal="true" aria-labelledby="pp-title" data-skeleton="skip">
                <header class="pp-head">
                    <button type="button" class="pp-back" hidden><span class="pp-back-arrow" aria-hidden="true">‹</span><span class="pp-back-name"></span></button>
                    <div class="pp-titles"><h2 id="pp-title">${esc(P.title)}</h2><span class="pp-sub"></span></div>
                    <span class="pp-mtitle" aria-hidden="true"><span class="pp-mname"></span><span class="pp-myears"></span></span>
                    <button type="button" class="pp-hbtn pp-print">${esc(P.print)}</button>
                    <button type="button" class="pp-hbtn pp-save">${esc(P.save)}</button>
                    <button type="button" class="pp-hbtn pp-share" hidden></button>
                    <button type="button" class="pp-hbtn pp-more" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(P.moreActions)}">⋯</button>
                    <button type="button" class="pp-close" aria-label="${esc(P.close)}">&times;</button>
                </header>
                <div class="pp-menu" role="menu" aria-label="${esc(P.moreActions)}" hidden></div>
                <div class="pp-body" tabindex="-1"></div>
            </div>`;
        document.body.appendChild(overlay);
        this.dialogStack = this.dialogStack.filter(d => d !== PERSON_PAGE_ID);
        this.pushDialog(PERSON_PAGE_ID);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) { this.closePersonPage(); return; }
            this.onPersonPageClick(e);
        });
        overlay.addEventListener('keydown', (e) => this.onPersonPageKey(e));
        // An edit saved from "Edit person" (or anything else changing the tree or its history) redraws the page in place.
        userChangeHandler = () => {
            if (rerenderQueued) return;
            rerenderQueued = true;
            requestAnimationFrame(() => {
                rerenderQueued = false;
                if (!overlayEl()) return;
                this.snapshotPersonPage();
                this.renderPersonPage();
            });
        };
        window.addEventListener('strom:user-change', userChangeHandler);
        // The history layer read (or changed) after the window opened: its rows come in place.
        window.addEventListener(HISTORY_CHANGED_EVENT, userChangeHandler);
        resizeHandler = () => syncShareButton();
        window.addEventListener('resize', resizeHandler);
        // The person editor closed over the page: back to reading.
        const pm = document.getElementById('person-modal');
        if (pm && typeof MutationObserver !== 'undefined') {
            editObserver = new MutationObserver(() => {
                if (!pm.classList.contains('active') && overlayEl() && !document.querySelector('.modal-overlay.active:not(.modal-overlay--page)')) {
                    bodyEl()?.focus({ preventScroll: true });
                }
            });
            editObserver.observe(pm, { attributes: true, attributeFilter: ['class'] });
        }
        this.renderPersonPage();
        bodyEl()?.focus({ preventScroll: true });
    },

    /** Close the whole window (Esc, ×, outside); focus back to the card it was opened from. */
    closePersonPage(opts: { focus?: boolean } = {}): void {
        const overlay = overlayEl();
        this.closePersonPageExport();
        tocCleanup?.();
        tocCleanup = null;
        editObserver?.disconnect();
        editObserver = null;
        chartObserver?.disconnect();
        chartObserver = null;
        pagePlaces = [];
        if (userChangeHandler) {
            window.removeEventListener('strom:user-change', userChangeHandler);
            window.removeEventListener(HISTORY_CHANGED_EVENT, userChangeHandler);
        }
        userChangeHandler = null;
        if (resizeHandler) window.removeEventListener('resize', resizeHandler);
        resizeHandler = null;
        this.dialogStack = this.dialogStack.filter(d => d !== PERSON_PAGE_ID);
        if (!overlay) { state = null; return; }
        overlay.remove();
        const origin = state?.origin;
        state = null;
        if (opts.focus !== false && origin) {
            document.querySelector<HTMLElement>(`#tree-canvas .person-card[data-id="${CSS.escape(origin)}"]`)?.focus({ preventScroll: true });
        }
    },

    /** Draw the current page (a new page, back, a redraw after an edit) with its scroll, folds and switches. */
    renderPersonPage(): void {
        const overlay = overlayEl();
        if (!overlay || !state) return;
        const entry = state.current;
        if (!DataManager.getPerson(entry.personId)) { this.closePersonPage(); return; }
        const P = strings.personPage;
        const lang = getCurrentLanguage();
        const opts = this.personPageOptions(entry.personId, {
            mode: 'app', links: 'app', toggles: entry.toggles, open: entry.open, selectedPlace: entry.place,
            ...(chartWidth ? { chartWidth } : {}),
        });
        const page = preparePersonPageData(DataManager.getData(), opts, this.personPageContext(entry.personId));
        const body = buildPersonPageBody(page, opts);
        pagePlaces = page.places;
        const sections = personPageSections(body, lang);
        // The contents start with the header's details (the top of the page), counted apart from the four sections.
        const tocItems = [{ id: 'pp-sec-facts', label: P.sec.facts }, ...sections];
        const toc = sections.length >= 4
            ? `<nav class="pp-toc" aria-label="${esc(P.toc)}"><div class="pp-toc-h">${esc(P.toc)}</div><ol>`
                + tocItems.map(s => `<li><a class="pp-toc-link" href="#${esc(s.id)}" data-pp-toc="${esc(s.id)}">${esc(s.label)}</a></li>`).join('')
                + '</ol></nav>'
            : '';

        // Header: the person, the way back, the actions this device offers.
        const name = nameOf(entry.personId);
        const sub = personSubtitle(entry.personId);
        (overlay.querySelector('.pp-sub') as HTMLElement).textContent = sub;
        (overlay.querySelector('.pp-mname') as HTMLElement).textContent = name;
        const years = sub.slice(name.length);
        (overlay.querySelector('.pp-myears') as HTMLElement).textContent = years;
        const back = overlay.querySelector('.pp-back') as HTMLButtonElement;
        const prev = state.back[state.back.length - 1];
        back.hidden = !prev;
        if (prev) {
            const prevName = nameOf(prev.personId);
            (back.querySelector('.pp-back-name') as HTMLElement).textContent = prevName;
            back.setAttribute('aria-label', P.back(prevName));
            back.title = P.back(prevName);
        }
        syncShareButton();
        this.closePersonPageMenu(false);

        const scroller = overlay.querySelector('.pp-body') as HTMLElement;
        scroller.innerHTML = `<div class="pp-layout">${toc}${body}</div>`;
        scroller.scrollTop = entry.scrollTop;
        this.watchPersonPageToc();
        this.watchPersonPageChart(personPageChartInput(page, opts.now), lang);
    },

    /** The life chart follows the column's width (§2.2): one set of labels for the width it has. */
    watchPersonPageChart(input: ReturnType<typeof personPageChartInput>, lang: ReturnType<typeof getCurrentLanguage>): void {
        chartObserver?.disconnect();
        chartObserver = null;
        const host = bodyEl()?.querySelector<HTMLElement>('.pp-chart-host');
        if (!host || !input || typeof ResizeObserver === 'undefined') return;
        let drawn = chartWidth;
        chartObserver = new ResizeObserver(() => {
            const w = Math.round(host.clientWidth);
            if (w <= 0 || Math.abs(w - drawn) < 2) return;
            drawn = w;
            chartWidth = w;
            host.innerHTML = lifeChartHtml(input, { lang, mode: 'app', width: w });
        });
        chartObserver.observe(host);
    },

    /** The options of the window's page (mode 'app') or the file's (mode 'file'). */
    personPageOptions(personId: PersonId, over: Partial<PersonPageOptions>): PersonPageOptions {
        return {
            personId,
            lang: getCurrentLanguage(),
            mode: 'app',
            links: 'app',
            groups: { ...PERSON_PAGE_ALL_GROUPS },
            privacy: 'full',
            toggles: { history: true, childEvents: true },
            research: this.activeResearchId() !== null,
            now: new Date(),
            ...over,
        };
    },

    /** What the page reads from the app around the data: history layer, waiting tasks, last change, read-only. */
    personPageContext(personId: PersonId): PersonPageContext {
        const ctx: PersonPageContext = { readOnly: DataManager.isReadOnly() };
        const history = this.personPageHistory(personId);
        if (history) ctx.history = history;
        const ref = researchPersonRef(DataManager.getPerson(personId)?.refn);
        if (ref) {
            const waiting = (this.researchWaiting()?.items ?? [])
                .filter(w => w.person === ref && w.kind !== 'story' && w.kind !== 'permission')
                .map(w => w.what).filter(Boolean);
            if (waiting.length) ctx.waiting = waiting;
        }
        const treeId = DataManager.getCurrentTreeId();
        const meta = treeId ? TreeManager.getTreeMetadata(treeId) : null;
        const changedAt = meta?.changedAt ?? meta?.lastModifiedAt;
        if (changedAt) ctx.changedAt = changedAt;
        return ctx;
    },

    /** The table of contents marks the section being read; at the end of the page the last one (personPageTocCurrent). */
    watchPersonPageToc(): void {
        tocCleanup?.();
        tocCleanup = null;
        tocPick = null;
        const scroller = bodyEl();
        const links = [...(scroller?.querySelectorAll<HTMLAnchorElement>('.pp-toc-link') ?? [])];
        if (!scroller || links.length === 0) return;
        const mark = (id: string): void => {
            for (const a of links) {
                if (a.dataset.ppToc === id) a.setAttribute('aria-current', 'true');
                else a.removeAttribute('aria-current');
            }
        };
        const update = (): void => {
            const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
            const sections = links.flatMap(a => {
                const sec = scroller.querySelector<HTMLElement>(`#${CSS.escape(a.dataset.ppToc ?? '')}`);
                return sec ? [{ id: sec.id, top: sec.getBoundingClientRect().top - base }] : [];
            });
            const id = personPageTocCurrent(sections, scroller);
            if (id) mark(id);
        };
        // A pick holds until the scroll it started has settled.
        let picked = false;
        let settle = 0;
        const holdPick = (): void => {
            window.clearTimeout(settle);
            settle = window.setTimeout(() => { picked = false; }, 180);
        };
        let frame = 0;
        const onScroll = (): void => {
            if (picked) { holdPick(); return; }
            if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(); });
        };
        tocPick = (id: string): void => { picked = true; mark(id); holdPick(); };
        scroller.addEventListener('scroll', onScroll, { passive: true });
        tocCleanup = () => {
            scroller.removeEventListener('scroll', onScroll);
            cancelAnimationFrame(frame);
            window.clearTimeout(settle);
            tocPick = null;
        };
        update();
    },

    /** Where the page is now, kept in its entry (scroll; folds and switches are kept as they change). */
    snapshotPersonPage(): void {
        const scroller = bodyEl();
        if (state && scroller) state.current.scrollTop = scroller.scrollTop;
    },

    /** A relative's page in the same window; the current one goes on the back stack. */
    navigatePersonPage(personId: PersonId): void {
        if (!state || !DataManager.getPerson(personId) || personId === state.current.personId) return;
        this.snapshotPersonPage();
        state.back.push(state.current);
        state.current = freshEntry(personId);
        this.renderPersonPage();
        bodyEl()?.focus({ preventScroll: true });
    },

    /** "‹ Name" / Alt+←: the previous page with its scroll, folds and switches. */
    personPageBack(): void {
        if (!state || state.back.length === 0) return;
        state.current = state.back.pop()!;
        this.renderPersonPage();
        bodyEl()?.focus({ preventScroll: true });
    },

    onPersonPageKey(e: KeyboardEvent): void {
        const menu = overlayEl()?.querySelector<HTMLElement>('.pp-menu');
        if (menu && !menu.hidden) {
            const items = [...menu.querySelectorAll<HTMLElement>('.pp-menu-item')].filter(el => el.getClientRects().length > 0);
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.closePersonPageMenu(true);
                return;
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
                e.preventDefault();
                e.stopPropagation();
                const at = items.indexOf(document.activeElement as HTMLElement);
                const to = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
                    : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items[to]?.focus();
                return;
            }
        }
        if (e.altKey && e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            this.personPageBack();
            return;
        }
        // A row of the places list: Enter / Space as a click.
        const row = (e.key === 'Enter' || e.key === ' ') ? (e.target as HTMLElement).closest?.<HTMLElement>('li[data-pp-map-place]') : null;
        if (row) {
            e.preventDefault();
            this.pickPersonPageMapPlace(row);
        }
    },

    onPersonPageClick(e: MouseEvent): void {
        const target = e.target as HTMLElement;
        const overlay = overlayEl();
        if (!overlay || !state) return;
        const menu = overlay.querySelector<HTMLElement>('.pp-menu');
        if (menu && !menu.hidden && !target.closest('.pp-menu') && !target.closest('.pp-more')) this.closePersonPageMenu(false);

        // The header.
        if (target.closest('.pp-close')) { this.closePersonPage(); return; }
        if (target.closest('.pp-back')) { this.personPageBack(); return; }
        if (target.closest('.pp-print')) { this.printPersonPage(); return; }
        if (target.closest('.pp-save')) { this.showPersonPageExport(false); return; }
        if (target.closest('.pp-share')) { this.showPersonPageExport(canShareFiles()); return; }
        if (target.closest('.pp-more')) { this.togglePersonPageMenu(); return; }
        const menuItem = target.closest<HTMLElement>('[data-pp-menu]');
        if (menuItem) { this.runPersonPageMenu(menuItem.dataset.ppMenu ?? ''); return; }

        // The table of contents: scroll the body, never the location hash.
        const tocLink = target.closest<HTMLAnchorElement>('[data-pp-toc]');
        if (tocLink) {
            e.preventDefault();
            const sec = bodyEl()?.querySelector<HTMLElement>(`#${CSS.escape(tocLink.dataset.ppToc ?? '')}`);
            if (sec) tocPick?.(sec.id);
            sec?.scrollIntoView({ block: 'start', behavior: 'smooth' });
            return;
        }

        // The page's content (delegation on .pp-body).
        // The places map (§1.4): a point or a row selects; the selected row again leads to the timeline.
        const mapPlace = target.closest<HTMLElement>('.pp-places [data-pp-map-place]');
        if (mapPlace) { this.pickPersonPageMapPlace(mapPlace); return; }
        // The life chart (§2.1): a period, mark or line leads to its timeline row.
        const osa = target.closest<HTMLElement>('.pp-chart [data-pp-osa]');
        if (osa) { e.preventDefault(); this.scrollPersonPageOsa(osa.dataset.ppOsa ?? ''); return; }
        const storyJump = target.closest<HTMLElement>('[data-pp-story]');
        if (storyJump) { e.preventDefault(); this.openPersonPageStory(storyJump.dataset.ppStory ?? ''); return; }
        const personBtn = target.closest<HTMLElement>('[data-pp-person]');
        if (personBtn) { this.navigatePersonPage(personBtn.dataset.ppPerson as PersonId); return; }
        const placeBtn = target.closest<HTMLElement>('[data-pp-place]');
        if (placeBtn) { this.showPersonPagePlace(placeBtn.dataset.ppPlace ?? ''); return; }
        const fold = target.closest<HTMLElement>('[data-pp-toggle]');
        if (fold) { this.togglePersonPageFold(fold, fold.getAttribute('aria-expanded') !== 'true'); return; }
        const sw = target.closest<HTMLElement>('[data-pp-switch]');
        if (sw?.dataset.ppSwitch === 'kidPlaces') {
            // Children's places change the map's frame: the page is drawn again where it was.
            state.current.toggles.kidPlaces = sw.getAttribute('aria-checked') !== 'true';
            this.snapshotPersonPage();
            this.renderPersonPage();
            overlay.querySelector<HTMLElement>('[data-pp-switch="kidPlaces"]')?.focus({ preventScroll: true });
            return;
        }
        if (sw) {
            const key = sw.dataset.ppSwitch === 'history' ? 'history' : 'childEvents';
            const on = sw.getAttribute('aria-checked') !== 'true';
            sw.setAttribute('aria-checked', String(on));
            state.current.toggles[key] = on;
            overlay.querySelector('article.pp')?.classList.toggle(key === 'history' ? 'pp-no-history' : 'pp-no-kids', !on);
            return;
        }
        const zoom = target.closest<HTMLElement>('[data-pp-zoom]');
        if (zoom) {
            const src = (zoom.querySelector('img') ?? zoom.closest('.pp-fig')?.querySelector('img'))?.getAttribute('src');
            if (src) openImageViewer(src, () => zoom.focus({ preventScroll: true }));
            return;
        }
        const differs = target.closest<HTMLElement>('[data-pp-differs]');
        if (differs) {
            const disc = overlay.querySelector<HTMLElement>('[data-pp-toggle][aria-controls="pp-research-body"]');
            if (disc) {
                this.togglePersonPageFold(disc, true);
                overlay.querySelector('#pp-research')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                disc.focus({ preventScroll: true });
            }
            return;
        }
        const act = target.closest<HTMLElement>('[data-pp-action]');
        if (act) this.runPersonPageAction(act.dataset.ppAction ?? '', act);
    },

    /**
     * A link to a couple's chapter (continued reading, the family tree at the
     * wedding; spec 027 §5.1): unfold the chapter, scroll to it, focus it.
     */
    openPersonPageStory(chapterId: string): void {
        const body = bodyEl();
        const chapter = chapterId ? body?.querySelector<HTMLElement>(`#${CSS.escape(chapterId)}`) : null;
        if (!chapter) return;
        const more = chapter.querySelector<HTMLElement>(`[data-pp-toggle][aria-controls="${CSS.escape(`${chapterId}-rest`)}"]`);
        if (more) this.togglePersonPageFold(more, true);
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        chapter.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
        chapter.focus({ preventScroll: true });
    },

    /** Open or close a fold (Sources, a source card, For researchers, siblings, the story's basis). */
    togglePersonPageFold(btn: HTMLElement, open: boolean): void {
        const region = document.getElementById(btn.getAttribute('aria-controls') ?? '');
        btn.setAttribute('aria-expanded', String(open));
        if (region) region.hidden = !open;
        const key = btn.dataset.ppToggle;
        if (key && state) {
            if (open) state.current.open.add(key);
            else state.current.open.delete(key);
        }
    },

    /** The page's actions into the app: a source, Materials, the research. */
    runPersonPageAction(action: string, el: HTMLElement): void {
        if (!state) return;
        if (action === 'map:open') { this.openPersonPageMap(); return; }
        const personId = state.current.personId;
        const person = DataManager.getPerson(personId);
        if (action === 'source') {
            const id = el.dataset.ppSource ?? '';
            if (!DataManager.getData().sources?.[id]) return;
            const row = personSourceRows(DataManager.getData(), personId, strings).find(r => r.source.id === id);
            // Over the window, which stays open under the viewer.
            this.showSourceViewer(id, row?.cites[0]?.ctx ?? null);
            return;
        }
        if (action === 'materials') {
            if (person?.refn && this.materialsListOn()) {
                this.openMaterials({ person: person.refn });
            } else {
                this.closePersonPage({ focus: false });
                this.showPersonMaterials(personId);
            }
            return;
        }
        if (action === 'research:open' || action === 'research:find') {
            const ref = this.personResearchRef(personId);
            const arg = el.dataset.ppArg;
            let url: string | null = null;
            if (action === 'research:find') url = this.personFindSourceUrl(personId);
            else if (arg && person?.research?.conflicts?.some(k => k.id === arg)) url = this.activeResearchLink('conflict', { conflict: arg, conflictDo: 'decide' });
            else if (ref) url = this.activeResearchLink('review', { person: ref, scope: 'person' });
            if (url) this.launchResearchLink(url, 'terminal');
        }
    },

    /** Select a place of the places map (a point or a row); the selected row clicked again goes to the place's first event. */
    pickPersonPageMapPlace(el: HTMLElement): void {
        const body = bodyEl();
        const key = el.dataset.ppMapPlace ?? '';
        if (!body || !state || !key) return;
        const again = el.classList.contains('pp-map-row') && el.classList.contains('is-sel');
        selectMapPlace(body, key);
        state.current.place = key;
        if (again && el.dataset.ppOsa) this.scrollPersonPageOsa(el.dataset.ppOsa);
    },

    /** Scroll the text timeline to a row (#osa-…) and highlight it briefly (§2.1). */
    scrollPersonPageOsa(id: string): void {
        const target = id ? bodyEl()?.querySelector<HTMLElement>(`#${CSS.escape(id)}`) : null;
        const row = target?.closest<HTMLElement>('.pp-row') ?? target;
        // A row the switches hide (history, children's events) has no box: nothing to show.
        if (!row || row.getClientRects().length === 0) return;
        row.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
        row.classList.remove('pp-osa-flash');
        void row.offsetWidth;
        row.classList.add('pp-osa-flash');
        window.setTimeout(() => row.classList.remove('pp-osa-flash'), OSA_FLASH_MS);
    },

    /**
     * A place in the header or the timeline (§1.6, Milan): when the page's
     * Places section names it, scroll there and select it (the page stays);
     * otherwise the app's map as before.
     */
    showPersonPagePlace(place: string): void {
        const body = bodyEl();
        const key = placeKey(place);
        const section = body?.querySelector<HTMLElement>('#pp-sec-places');
        const listed = !!section && !!key && (!!section.querySelector(`[data-pp-map-place="${CSS.escape(key)}"]`)
            || pagePlaces.some(p => !p.rel && p.placeKey === key));
        if (!body || !section || !state || !listed) { this.openPersonPagePlace(place); return; }
        if (section.querySelector(`[data-pp-map-place="${CSS.escape(key)}"]`)) {
            selectMapPlace(body, key);
            state.current.place = key;
        }
        section.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    },

    /** "Open in map ›": the app's map at the selected place, else the first place of the life (the round 1 flow). */
    openPersonPageMap(): void {
        if (!state) return;
        const geo = DataManager.getData().places ?? {};
        const ordered = [...pagePlaces].filter(p => !p.rel).sort((a, b) => placeOrderKey(a) - placeOrderKey(b));
        const pick = (state.current.place ? pagePlaces.find(p => p.placeKey === state!.current.place) : undefined)
            ?? ordered.find(p => !!geo[p.placeKey]) ?? ordered[0];
        if (pick) this.openPersonPagePlace(pick.place);
    },

    /** A place: the window closes, the map (or the places manager) opens; the toast brings the page back. */
    openPersonPagePlace(place: string): void {
        if (!state || !place) return;
        this.snapshotPersonPage();
        const parked: PageState = { origin: state.origin, current: cloneEntry(state.current), back: state.back.map(cloneEntry) };
        const key = placeKey(place);
        const hasGeo = !!DataManager.getData().places?.[key];
        this.closePersonPage({ focus: false });
        if (hasGeo) this.showPlaceOnMap(key);
        else this.showPlacesManager(key, undefined, 'tree');
        const P = strings.personPage;
        this.showToast(P.placeToast(place), 10000, {
            kind: 'person-page',
            action: {
                label: P.placeBack,
                run: () => {
                    // The places manager gives way to the page it came from (the map is the tree's view: the page opens over it).
                    if (document.getElementById('places-modal')) this.closePlacesManager();
                    if (DataManager.getPerson(parked.current.personId)) this.openPersonPageState(parked);
                },
            },
        });
    },

    // ── The ⋯ menu ──

    togglePersonPageMenu(): void {
        const menu = overlayEl()?.querySelector<HTMLElement>('.pp-menu');
        if (!menu) return;
        if (!menu.hidden) { this.closePersonPageMenu(true); return; }
        if (!state) return;
        const P = strings.personPage;
        const personId = state.current.personId;
        const canEdit = !DataManager.isReadOnly() && !DataManager.isPersonLocked(personId);
        const item = (key: string, label: string, narrow = false): string =>
            `<button type="button" class="pp-menu-item${narrow ? ' pp-menu-item--narrow' : ''}" role="menuitem" data-pp-menu="${key}">${esc(label)}</button>`;
        // Phones (and a phone held sideways) have Save and Print here; wider windows have them in the header.
        menu.innerHTML = item('save', P.save, true) + item('print', P.print, true)
            + (canEdit ? item('edit', P.edit) : '') + item('focus', P.focus);
        menu.hidden = false;
        overlayEl()?.querySelector('.pp-more')?.setAttribute('aria-expanded', 'true');
        [...menu.querySelectorAll<HTMLElement>('.pp-menu-item')].find(el => el.getClientRects().length > 0)?.focus();
    },

    closePersonPageMenu(focusButton: boolean): void {
        const overlay = overlayEl();
        const menu = overlay?.querySelector<HTMLElement>('.pp-menu');
        if (!menu || menu.hidden) return;
        menu.hidden = true;
        menu.innerHTML = '';
        const btn = overlay?.querySelector<HTMLElement>('.pp-more');
        btn?.setAttribute('aria-expanded', 'false');
        if (focusButton) btn?.focus();
    },

    runPersonPageMenu(key: string): void {
        this.closePersonPageMenu(false);
        if (!state) return;
        const personId = state.current.personId;
        if (key === 'save') this.showPersonPageExport(false);
        else if (key === 'print') this.printPersonPage();
        else if (key === 'edit') {
            if (DataManager.isReadOnly() || DataManager.isPersonLocked(personId)) return;
            // The editor opens over the page; saving redraws the page (strom:user-change).
            this.snapshotPersonPage();
            this.pushDialog('person-modal');
            this.showEditPersonModal(personId);
        } else if (key === 'focus') {
            this.closePersonPage({ focus: false });
            this.runPersonMenuAction(personId, 'focus');
        }
    },

    /** Print the page only (the tree and the window's controls stay out, §6.2). */
    printPersonPage(): void {
        document.body.classList.add('printing-person-page');
        const done = (): void => {
            document.body.classList.remove('printing-person-page');
            window.removeEventListener('afterprint', done);
        };
        window.addEventListener('afterprint', done);
        window.print();
    },

    // ── "Save as HTML" (§5.1, §5.5, §6.1) ──

    showPersonPageExport(share: boolean): void {
        if (!state) return;
        this.closePersonPageExport();
        const personId = state.current.personId;
        const P = strings.personPage;
        const X = P.export;
        const data = DataManager.getData();
        // Attachment images over 1600 px go into the file reduced (§3.5); the tree keeps the originals.
        let shrunk = new Map<string, string>();
        const fileData = (): StromData => withShrunkAttachments(data, personId, shrunk);
        const now = new Date();
        const ctx = this.personPageContext(personId);
        const fontCss = appFontFaceCss([...POSTER_SERIF_FACES, ...POSTER_LINE_FACES]);
        const fileOpts = (groups: PersonPageGroups, privacy: PrivacyMode): PersonPageOptions => this.personPageOptions(personId, {
            mode: 'file', links: 'plain', groups, privacy, now, fontCss, open: new Set(),
            // Every switch as the window shows it when saving: what is visible is what gets saved.
            toggles: personPageFileToggles(state?.current.toggles ?? { history: true, childEvents: true, kidPlaces: true }),
        });
        // The groups, their counts and the living people come from the full page.
        let fullProt = protectPersonPageTree(data, 'full', now);
        const full = preparePersonPageData(data, fileOpts({ ...PERSON_PAGE_ALL_GROUPS }, 'full'), { ...ctx, protected: fullProt });
        const shown = GROUP_ORDER.filter(g => full.counts[g] > 0);
        // The images "Attach images" adds, counted as the size line counts them (the portrait aside).
        const imageCount = full.counts.excerpts + full.counts.materials
            ? estimatePersonPageSize(full, fileOpts({ ...PERSON_PAGE_ALL_GROUPS }, 'full')).images : 0;
        const living = full.living.size > 0;
        const treeId = DataManager.getCurrentTreeId();
        const saved = treeId ? TreeManager.getPersonPageExport(treeId) : undefined;
        const groups: PersonPageGroups = { ...PERSON_PAGE_ALL_GROUPS, ...(saved?.groups ?? {}) };
        let privacy: PrivacyMode = personPageExportPrivacy(living, saved?.privacy);
        const shareOk = share && canShareFiles() && !isDesktop();
        const deviceShare = canShareFiles() && !isDesktop();

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = PERSON_PAGE_EXPORT_ID;
        const pv = strings.privacy;
        const modeLabel: Record<PrivacyMode, string> = {
            full: pv.modeFull, initials: pv.modeInitials, anonymous: pv.modeAnonymous, minimal: pv.modeMinimal,
        };
        const checks = shown.map(g => `
            <label class="ppx-check" data-ppx-row="${g}"${LIVING_DROPS.has(g) ? ' data-ppx-drops' : ''}>
                <input type="checkbox" data-ppx-group="${g}"${groups[g] ? ' checked' : ''}>
                <span class="ppx-check-label">${esc(X.group[g])}</span>
                <span class="ppx-count">${full.counts[g]}</span>
            </label>`).join('');
        const privacyHtml = living ? `
            <div class="ppx-sec">
                <div class="ppx-label" id="ppx-privacy-h">${esc(X.privacy)}</div>
                <div class="ppx-privacy" role="radiogroup" aria-labelledby="ppx-privacy-h">
                    ${PRIVACY_MODES.map(m => `<button type="button" class="segment-btn" role="radio" data-ppx-privacy="${m}" aria-checked="false">${esc(modeLabel[m])}</button>`).join('')}
                </div>
                <p class="ppx-note">${esc(X.privacyWho(personPageLivingNames(full, DataManager.getData()).join(', ')))}</p>
            </div>` : '';
        // Images and documents (§3.5): the source excerpts and image attachments together, the PDFs apart.
        const M = P.media;
        const mediaRow = (key: 'images' | 'pdf', label: string, on: boolean) => `
            <label class="ppx-check" data-ppx-row="${key}" data-ppx-drops>
                <input type="checkbox" data-ppx-media="${key}"${on ? ' checked' : ''}>
                <span class="ppx-check-label">${esc(label)}</span>
            </label>`;
        const mediaHtml = imageCount || full.counts.pdf ? `
            <div class="ppx-sec" role="group" aria-labelledby="ppx-media-h">
                <div class="ppx-label" id="ppx-media-h">${esc(M.title)}</div>
                <div class="ppx-checks">
                    ${imageCount ? mediaRow('images', M.images(imageCount), groups.excerpts && groups.materials) : ''}
                    ${full.counts.pdf ? mediaRow('pdf', M.pdf(full.counts.pdf), groups.pdf) : ''}
                </div>
                ${imageCount ? `<p class="ppx-note ppx-shrink">${esc(M.shrink)}</p>` : ''}
            </div>` : '';
        const footer = deviceShare
            ? `<button type="button" class="secondary" data-dismiss>${esc(X.cancel)}</button>`
                + `<button type="button" class="${shareOk ? 'secondary' : 'primary'}" data-ppx="save">${esc(X.saveDevice)}</button>`
                + (shareOk ? `<button type="button" class="primary" data-ppx="share">${esc(X.shareBtn)}</button>` : '')
            : `<button type="button" class="secondary" data-dismiss>${esc(X.cancel)}</button>`
                + `<button type="button" class="primary" data-ppx="save">${esc(X.save)}</button>`;
        overlay.innerHTML = `
            <div class="modal modal--sm pp-export" role="dialog" aria-modal="true" aria-labelledby="ppx-title">
                <span class="ppx-grab" aria-hidden="true"></span>
                <div class="modal-header">
                    <div class="ppx-titles"><h2 id="ppx-title">${esc(shareOk ? X.titleShare : X.title)}</h2><span class="ppx-sub ppx-sub--who">${esc(personSubtitle(personId))}</span><span class="ppx-sub ppx-sub--file" id="ppx-file-sub"></span></div>
                    <button type="button" class="close-btn" data-ppx="close" aria-label="${esc(P.close)}">&times;</button>
                </div>
                <div class="ppx-sec ppx-sec--file">
                    <div class="ppx-label">${esc(X.file)}</div>
                    <div class="ppx-file" id="ppx-file"></div>
                </div>
                <div class="ppx-sec" role="group" aria-labelledby="ppx-content-h">
                    <div class="ppx-label" id="ppx-content-h">${esc(X.content)}</div>
                    ${checks ? `<div class="ppx-checks">${checks}</div>` : ''}
                    <p class="ppx-note ppx-always">${esc(X.always)}</p>
                    <p class="ppx-note ppx-drops" id="ppx-drops" hidden>${esc(X.privacyDrops)}</p>
                </div>
                ${mediaHtml}
                ${privacyHtml}
                <div class="ppx-size">
                    <strong id="ppx-size-mb"></strong>
                    <span class="ppx-size-hint">${esc(X.sizeHint)}</span>
                    <span class="ppx-size-large" id="ppx-size-large" hidden>${esc(M.big)}</span>
                </div>
                <div class="buttons">
                    <span class="ppx-remember">${esc(X.remember)}</span>
                    ${footer}
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.pushDialog(PERSON_PAGE_EXPORT_ID);

        let current: { page: PersonPageData; opts: PersonPageOptions } | null = null;
        const refresh = (): void => {
            const drops = privacy !== 'full';
            // The groups stay on: only the living lose them, the note says so.
            for (const row of overlay.querySelectorAll<HTMLElement>('[data-ppx-row]')) {
                const input = row.querySelector('input') as HTMLInputElement;
                if (drops && row.hasAttribute('data-ppx-drops')) input.setAttribute('aria-describedby', 'ppx-drops');
                else input.removeAttribute('aria-describedby');
            }
            (overlay.querySelector('#ppx-drops') as HTMLElement).hidden = !(drops && !!overlay.querySelector('[data-ppx-drops]'));
            for (const b of overlay.querySelectorAll<HTMLElement>('[data-ppx-privacy]')) {
                const on = b.dataset.ppxPrivacy === privacy;
                b.classList.toggle('active', on);
                b.setAttribute('aria-checked', String(on));
                b.tabIndex = on ? 0 : -1;
            }
            const opts = fileOpts({ ...groups }, privacy);
            const page = privacy === 'full'
                ? preparePersonPageData(fileData(), opts, { ...ctx, protected: fullProt })
                : preparePersonPageData(fileData(), opts, ctx);
            current = { page, opts };
            const fileName = personPageFileName(page);
            (overlay.querySelector('#ppx-file') as HTMLElement).textContent = fileName;
            (overlay.querySelector('#ppx-file-sub') as HTMLElement).textContent = fileName;
            const size = estimatePersonPageSize(page, opts);
            (overlay.querySelector('#ppx-size-mb') as HTMLElement).textContent = X.size(personPageSizeMb(size.bytes, getCurrentLanguage()), size.images);
            (overlay.querySelector('#ppx-size-large') as HTMLElement).hidden = size.bytes <= LARGE_BYTES;
        };
        const remember = (): void => {
            // A page without living people offers no choice: keep the one remembered before.
            if (treeId) TreeManager.setPersonPageExport(treeId, {
                groups: { ...groups }, privacy: living ? privacy : saved?.privacy ?? PERSON_PAGE_DEFAULT_PRIVACY,
            });
        };
        const build = (): { html: string; name: string; title: string } | null => {
            if (!current) return null;
            const html = buildPersonPageDocument(current.page, current.opts);
            const p = current.page.tree.persons[current.page.personId];
            return { html, name: personPageFileName(current.page), title: p ? shownName(p) : P.title };
        };
        const saveFile = async (): Promise<void> => {
            remember();
            await shrinking;
            const out = build();
            this.closePersonPageExport();
            if (!out) return;
            try {
                const blob = new Blob([out.html], { type: 'text/html;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = out.name;
                a.rel = 'noopener';
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                this.showToast(X.saved(out.name), 4000, { kind: 'person-page' });
            } catch {
                this.showToast(X.error, 8000, { kind: 'person-page', action: { label: X.retry, run: () => this.showPersonPageExport(false) } });
            }
        };
        const shareFile = async (): Promise<void> => {
            remember();
            await shrinking;
            const out = build();
            this.closePersonPageExport();
            if (!out) return;
            try {
                const file = new File([out.html], out.name, { type: 'text/html' });
                await navigator.share({ files: [file], title: out.title });
            } catch (err) {
                if ((err as { name?: string } | null)?.name === 'AbortError') return;
                this.showToast(X.error, 8000, { kind: 'person-page', action: { label: X.retry, run: () => this.showPersonPageExport(true) } });
            }
        };

        overlay.addEventListener('click', (e) => {
            const t = e.target as HTMLElement;
            if (t === overlay || t.closest('[data-dismiss]') || t.closest('[data-ppx="close"]')) { this.closePersonPageExport(); return; }
            if (t.closest('[data-ppx="save"]')) { void saveFile(); return; }
            if (t.closest('[data-ppx="share"]')) { void shareFile(); return; }
            const pb = t.closest<HTMLElement>('[data-ppx-privacy]');
            if (pb) { privacy = pb.dataset.ppxPrivacy as PrivacyMode; refresh(); }
        });
        overlay.addEventListener('change', (e) => {
            const media = (e.target as HTMLElement).closest<HTMLInputElement>('[data-ppx-media]');
            if (media) {
                if (media.dataset.ppxMedia === 'pdf') groups.pdf = media.checked;
                else groups.excerpts = groups.materials = media.checked;
                refresh();
                return;
            }
            const input = (e.target as HTMLElement).closest<HTMLInputElement>('[data-ppx-group]');
            if (!input) return;
            groups[input.dataset.ppxGroup as keyof PersonPageGroups] = input.checked;
            refresh();
        });
        // The privacy choice is a radio group: ←/→/↑/↓ move the choice.
        overlay.addEventListener('keydown', (e) => {
            const pb = (e.target as HTMLElement).closest<HTMLElement>('[data-ppx-privacy]');
            if (!pb || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
            e.preventDefault();
            const at = PRIVACY_MODES.indexOf(privacy);
            const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
            privacy = PRIVACY_MODES[(at + step + PRIVACY_MODES.length) % PRIVACY_MODES.length];
            refresh();
            overlay.querySelector<HTMLElement>(`[data-ppx-privacy="${privacy}"]`)?.focus();
        });
        refresh();
        // Reduce the large attachment images meanwhile; the size and the file follow.
        const shrinking = shrinkAttachments(data.persons[personId]?.attachments ?? []).then(map => {
            if (!map.size) return;
            shrunk = map;
            fullProt = protectPersonPageTree(fileData(), 'full', now);
            if (overlay.isConnected) refresh();
        }).catch(() => undefined);
        const box = overlay.querySelector('.modal') as HTMLElement;
        // As a phone's bottom sheet: a swipe down from the handle or the title closes it.
        let dragY: number | null = null;
        box.addEventListener('touchstart', (e) => {
            const t = e.target as HTMLElement;
            dragY = t.closest('.ppx-grab, .modal-header') && getComputedStyle(box.querySelector('.ppx-grab') as HTMLElement).display !== 'none'
                ? e.touches[0].clientY : null;
        }, { passive: true });
        box.addEventListener('touchmove', (e) => {
            if (dragY === null) return;
            const dy = e.touches[0].clientY - dragY;
            box.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
        }, { passive: true });
        box.addEventListener('touchend', (e) => {
            if (dragY === null) return;
            const dy = e.changedTouches[0].clientY - dragY;
            dragY = null;
            box.style.transform = '';
            if (dy > SHEET_SWIPE_CLOSE_PX) this.closePersonPageExport();
        });
        box.setAttribute('tabindex', '-1');
        box.focus({ preventScroll: true });
    },

    closePersonPageExport(): void {
        const el = document.getElementById(PERSON_PAGE_EXPORT_ID);
        this.dialogStack = this.dialogStack.filter(d => d !== PERSON_PAGE_EXPORT_ID);
        if (!el) return;
        el.remove();
        overlayEl()?.querySelector<HTMLElement>('.pp-save, .pp-body')?.focus({ preventScroll: true });
    },
});
