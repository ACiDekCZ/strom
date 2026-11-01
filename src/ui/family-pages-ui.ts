/**
 * The family pages in the app (spec 026 §0.8, §3.3, §6.5, §6.6).
 *
 * The window: a page of a set (a lineage, the hub, a branch, a family, an
 * index) shown inside the person page's window (src/ui/person-page-ui.ts), so
 * a person's page, a lineage's and a family's share one back stack with
 * "‹ Back". The content is the file's (pageSetSectionHtml), its links
 * `data-sp-open` buttons: a person opens the app's person page, a lineage,
 * family or page of the set the set's page. The window's set is built on the
 * app's language with full data (as the person page window) and families as
 * pages; it is kept until the tree changes.
 *
 * The file: built a page at a time (an idle callback between pages, Cancel
 * stops it and nothing is saved), images reduced beforehand when the choice
 * says so (shrinkImage: 1600 px photos, 1200 px record excerpts, JPEG 0.82),
 * saved by a download or shared where the device shares files.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { PartnershipId, PersonId, StromData } from '../types.js';
import { BookSelectionSpec } from '../book-options.js';
import { PageSet, PageSetOptions, SetPage, buildPageSet, pageSetFileName, pageSetImages } from '../family-pages.js';
import { buildPageSetHtmlAsync, pageSetBarHtml, pageSetRenderedPages, pageSetSearchHtml, pageSetSectionHtml } from '../family-pages-html.js';
import { ensureFamilyPagesAppCss } from '../family-pages-css.js';
import { SHRINK_CLIP_PX, SHRINK_PHOTO_PX, SHRINK_QUALITY } from '../image-registry.js';
import { RodId, buildLineages, rodOf } from '../lineage.js';
import { appFontFaceCss, POSTER_LINE_FACES, POSTER_SERIF_FACES } from '../poster-fonts.js';
import { shrinkImage } from './person-page-ui.js';
import { uiModule } from './module.js';

/** A page of a set in the window: the set by its selection, the page by its slug, its title for "‹ Back". */
export interface SetRef {
    spec: BookSelectionSpec;
    slug: string;
    title: string;
}

let cache: { key: string; set: PageSet } | null = null;
let cacheWatched = false;

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function ensureAppCss(): void {
    ensureFamilyPagesAppCss();
}

function treeName(): string {
    return TreeManager.getActiveTreeMetadata()?.name || '';
}

/** The window's set for a selection: the app's language, full data, families as pages; kept until the tree changes. */
export function windowPageSet(spec: BookSelectionSpec): PageSet {
    const key = `${DataManager.getCurrentTreeId() ?? ''}|${getCurrentLanguage()}|${JSON.stringify(spec)}`;
    if (cache?.key === key) return cache.set;
    if (!cacheWatched) {
        cacheWatched = true;
        window.addEventListener('strom:user-change', () => { cache = null; });
    }
    const set = buildPageSet(DataManager.getData(), spec, { lang: getCurrentLanguage(), privacy: 'full', families: 'pages' }, { treeName: treeName() });
    cache = { key, set };
    return set;
}

function refOf(spec: BookSelectionSpec, set: PageSet, slug: string): SetRef {
    const page = set.bySlug.get(slug) ?? set.bySlug.get(set.introSlug);
    return { spec, slug: page?.slug ?? set.introSlug, title: page?.title ?? '' };
}

/** The page of a lineage: the lineage's own set, its introduction. */
export function rodPageRef(rodId: RodId): SetRef {
    const spec: BookSelectionSpec = { kind: 'rods', rods: [rodId] };
    const set = windowPageSet(spec);
    return refOf(spec, set, set.rodSlug.get(rodId) ?? set.introSlug);
}

/** The introduction of a set (the hub, the lineage, the branch). */
export function setIntroRef(spec: BookSelectionSpec): SetRef {
    const set = windowPageSet(spec);
    return refOf(spec, set, set.introSlug);
}

/**
 * Where a `data-sp-open` value leads from the page shown: a person to the
 * app's person page; a page, lineage or family of the same set to that page;
 * a lineage outside the set to its own set; a family outside it to the set of
 * a partner's lineage (else the first partner's person page).
 */
export function resolveSetTarget(current: SetRef | null, target: string): { person: PersonId } | { set: SetRef } | null {
    const at = target.indexOf(':');
    if (at < 0) return null;
    const kind = target.slice(0, at);
    const id = target.slice(at + 1);
    if (!id) return null;
    if (kind === 'person') return { person: id as PersonId };
    const set = current ? windowPageSet(current.spec) : null;
    if (kind === 'page') return set && current && set.bySlug.has(id) ? { set: refOf(current.spec, set, id) } : null;
    if (kind === 'rod') {
        const slug = set?.rodSlug.get(id as RodId);
        return set && current && slug ? { set: refOf(current.spec, set, slug) } : { set: rodPageRef(id as RodId) };
    }
    if (kind === 'family') {
        const slug = set?.familySlug.get(id as PartnershipId);
        if (set && current && slug) return { set: refOf(current.spec, set, slug) };
        const data = DataManager.getData();
        const u = data.partnerships[id as PartnershipId];
        if (!u) return null;
        const index = buildLineages(data);
        for (const pid of [u.person1Id, u.person2Id]) {
            const rod = pid ? rodOf(index, pid) : null;
            if (!rod) continue;
            const spec: BookSelectionSpec = { kind: 'rods', rods: [rod] };
            const other = windowPageSet(spec);
            const fs = other.familySlug.get(u.id);
            if (fs) return { set: refOf(spec, other, fs) };
        }
        return { person: u.person1Id };
    }
    return null;
}

/** The kicker under the window's title: what kind of page it is. */
function kickerOf(page: SetPage): string {
    const F = strings.familyPages;
    switch (page.kind) {
        case 'rod': return F.kRod;
        case 'branch': return F.kBranch;
        case 'family': return F.kFam;
        case 'person': return F.kPer;
        case 'hub': return F.kHub;
        default: return F.winTitle;
    }
}

// ─── The file (§6.5, §6.6) ─────────────────────────────────────────────────

/** Cancel during the build: nothing is saved. */
export class PagesCancelled extends Error {
    constructor() { super('cancelled'); this.name = 'PagesCancelled'; }
}

export interface PagesJob { cancelled: boolean }

export interface PagesFile {
    html: string;
    name: string;
    bytes: number;
    title: string;
}

/** An idle moment of the app (the window stays usable between pages); a short timeout without requestIdleCallback. */
function idle(): Promise<void> {
    return new Promise(resolve => {
        const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
        if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(() => resolve(), { timeout: 50 });
        else setTimeout(resolve, 0);
    });
}

function stepOf(page: SetPage | undefined): string {
    const S = strings.familyPages.step;
    switch (page?.kind) {
        case 'rod': case 'branch': return S.rod;
        case 'family': return S.family;
        case 'person': return S.person;
        case 'index': return S.index;
        default: return S.other;
    }
}

/**
 * Build the file a page at a time: the set, the reduced images, the pages,
 * the file. `onStep(done, total, text)` reports the pages done (0 / 0 while
 * preparing and reducing images). Throws PagesCancelled once `job.cancelled`.
 */
export async function buildPagesFile(
    data: StromData, spec: BookSelectionSpec, opts: PageSetOptions, job: PagesJob,
    onStep: (done: number, total: number, text: string) => void,
): Promise<PagesFile> {
    const F = strings.familyPages;
    const check = (): void => { if (job.cancelled) throw new PagesCancelled(); };
    onStep(0, 0, F.step.prepare);
    await idle();
    check();
    let set = buildPageSet(data, spec, opts, { treeName: treeName() });
    const want = pageSetImages(set).filter(i => (i.kind === 'clip' ? set.options.clips : set.options.photos) === 'small');
    if (want.length) {
        const small = new Map<string, string>();
        for (let i = 0; i < want.length; i++) {
            onStep(0, 0, F.step.images(i, want.length));
            const img = want[i];
            const out = await shrinkImage(img.dataUrl, img.kind === 'clip' ? SHRINK_CLIP_PX : SHRINK_PHOTO_PX, SHRINK_QUALITY);
            if (out) small.set(img.dataUrl, out);
            check();
        }
        onStep(0, 0, F.step.images(want.length, want.length));
        set = buildPageSet(data, spec, opts, { treeName: treeName(), replaceImage: (u) => small.get(u) ?? null });
    }
    const pages = pageSetRenderedPages(set);
    onStep(0, pages.length, stepOf(pages[0]));
    const html = await buildPageSetHtmlAsync(set, {
        fontCss: appFontFaceCss([...POSTER_SERIF_FACES, ...POSTER_LINE_FACES]),
        pause: async () => { await idle(); check(); },
        progress: (done, total) => onStep(done, total, done < total ? stepOf(pages[done]) : F.step.write),
    });
    check();
    return { html, name: pageSetFileName(set), bytes: new Blob([html]).size, title: set.bySlug.get(set.introSlug)?.title ?? '' };
}

/** Save by a download (as the person page and the book do). */
export function downloadPagesFile(file: PagesFile): void {
    const blob = new Blob([file.html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Web Share with a file, where the device shares files. */
export function canSharePagesFile(): boolean {
    try {
        const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
        return typeof nav.share === 'function' && !!nav.canShare?.({ files: [new File([''], 'x.html', { type: 'text/html' })] });
    } catch {
        return false;
    }
}

export async function sharePagesFile(file: PagesFile): Promise<void> {
    const f = new File([file.html], file.name, { type: 'text/html' });
    await navigator.share({ files: [f], title: file.title || file.name });
}

/**
 * The window's bar (§3.1, §3.4): the search draws its results over the page
 * while the field holds a query (Escape or Cancel brings the page back where
 * it was, the window stays open), the magnifier and Menu of a narrow window,
 * the alphabet of the index of people. Its links are `data-sp-open` buttons
 * the window's delegation follows; a new page draws a new bar.
 */
function wireWindowBar(scroller: HTMLElement, set: PageSet): void {
    const root = scroller.querySelector<HTMLElement>('.sp-appset');
    const bar = root?.querySelector<HTMLElement>('.sp-fbar');
    const input = bar?.querySelector<HTMLInputElement>('.sp-q');
    const results = root?.querySelector<HTMLElement>('.sp-results');
    const menu = bar?.querySelector<HTMLElement>('.sp-menu');
    const menuBtn = bar?.querySelector<HTMLElement>('.sp-fbar-menu');
    if (!root || !bar || !input || !results || !menu || !menuBtn) return;
    // The folds of the indexes start folded, as in the file (open in its markup for a file without the script).
    root.querySelectorAll<HTMLDetailsElement>('details.sp-ix-more[open]').forEach(f => { f.open = false; });
    let on = false;
    let saved = 0;
    const setQuery = (value: string, keep = false): void => {
        const q = value.trim();
        bar.classList.toggle('sp-fbar--has', value !== '');
        if (q) {
            if (!on) { on = true; saved = scroller.scrollTop; root.classList.add('sp-searching'); results.hidden = false; scroller.scrollTop = 0; }
            results.innerHTML = pageSetSearchHtml(set, q);
        } else if (on) {
            on = false;
            root.classList.remove('sp-searching');
            results.hidden = true;
            results.innerHTML = '';
            if (!keep) scroller.scrollTop = saved;
        }
    };
    const shutMenu = (): void => { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); };
    const cancel = (): void => { input.value = ''; setQuery(''); bar.classList.remove('sp-fbar--q'); };
    input.addEventListener('input', () => setQuery(input.value));
    input.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        // The search's Escape only: the window stays open.
        e.preventDefault();
        e.stopPropagation();
        cancel();
    });
    root.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !menu.hidden) { e.preventDefault(); e.stopPropagation(); shutMenu(); menuBtn.focus(); }
    });
    root.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.sp-fbar-cancel')) { cancel(); input.blur(); return; }
        if (target.closest('.sp-fbar-lupa')) { shutMenu(); bar.classList.add('sp-fbar--q'); input.focus(); return; }
        if (target.closest('.sp-fbar-menu')) {
            const open = menu.hidden;
            menu.hidden = !open;
            menuBtn.setAttribute('aria-expanded', String(open));
            return;
        }
        if (!target.closest('.sp-fbar')) shutMenu();
        const letter = target.closest<HTMLElement>('[data-sp-letter]');
        if (letter) {
            const v = letter.dataset.spLetter ?? '';
            const box = letter.closest('.sp-ix') ?? root;
            box.querySelectorAll<HTMLElement>('[data-sp-letter]').forEach(x => {
                if (x === letter) x.setAttribute('aria-current', 'true'); else x.removeAttribute('aria-current');
            });
            box.querySelectorAll<HTMLElement>('[data-sp-group]').forEach(g => { g.hidden = v !== '' && g.dataset.spGroup !== v; });
        }
    });
}

export const familyPagesMethods = uiModule({
    /** A set's page in the window (the introduction by default): on top of the window's stack, or a new window. */
    openFamilyPages(spec: BookSelectionSpec, slug?: string): void {
        const set = windowPageSet(spec);
        this.openPersonPageSet(refOf(spec, set, slug ?? set.introSlug));
    },

    /** The page of a lineage (the tree overview, the person card's lineage row, the person page). */
    openRodPage(rodId: RodId): void {
        this.openPersonPageSet(rodPageRef(rodId));
    },

    /** A `data-sp-open` link of the window. */
    openFamilyPagesTarget(current: SetRef | null, target: string): void {
        const to = resolveSetTarget(current, target);
        if (!to) return;
        if ('person' in to) {
            if (DataManager.getPerson(to.person)) this.navigatePersonPage(to.person);
            return;
        }
        this.openPersonPageSet(to.set);
    },

    /** Draw a set's page in the window's body and header (the person page's window calls this for a set entry). */
    renderFamilyPagesEntry(overlay: HTMLElement, ref: SetRef): void {
        ensureAppCss();
        const set = windowPageSet(ref.spec);
        let slug = ref.slug;
        let html = pageSetSectionHtml(set, slug);
        if (!html) { slug = set.introSlug; html = pageSetSectionHtml(set, slug); }
        const page = set.bySlug.get(slug);
        const title = page?.title ?? strings.familyPages.winTitle;
        (overlay.querySelector('#pp-title') as HTMLElement).textContent = title;
        (overlay.querySelector('.pp-sub') as HTMLElement).textContent = page ? kickerOf(page) : '';
        (overlay.querySelector('.pp-mname') as HTMLElement).textContent = title;
        (overlay.querySelector('.pp-myears') as HTMLElement).textContent = '';
        const scroller = overlay.querySelector('.pp-body') as HTMLElement;
        scroller.innerHTML = `<div class="sp-appset" lang="${esc(set.options.lang)}">${pageSetBarHtml(set, slug)}`
            + `<div class="sp-app"><div class="sp-results" aria-live="polite" hidden></div>${html}</div></div>`;
        wireWindowBar(scroller, set);
    },

    /** "Save as file": the dialog with the pages output and this set's selection. */
    familyPagesWindowSave(ref: SetRef): void {
        this.openBookDialog({ kind: 'menu' }, undefined, { output: 'pages', selection: ref.spec });
    },

    /** "Family book": the book's window with the same selection. */
    familyPagesWindowBook(ref: SetRef): void {
        this.openFamilyBookFor(ref.spec);
    },
});
