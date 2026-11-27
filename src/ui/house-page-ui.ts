/**
 * The house page's window (spec 030 §3, K7.1): the person page's frame
 * (`.modal--page`) with "‹ Houses", Save HTML and ⋯, the page drawn by
 * src/house-page.ts. The research's result of the house is read once per
 * list rev (`GET /houses/<key>`) and the page redraws when it comes, when the
 * list changes and when the tree changes (the name after the farm, a reveal).
 *
 * `openHousePage(id, parent)` is where every "House page ›" ends
 * (`openHouse`); `parent` is a dialog under it (Houses, Places) that hides
 * while the page is open and comes back when it closes.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { DataManager } from '../data.js';
import type { HouseId, HouseUserData } from '../types.js';
import { houseTitle, type TreeHouse } from '../houses.js';
import {
    confirmHouse, fetchHouse, houseCache, houseFeature, houseStatus, requestHouseStory, type HouseResearch, type HouseStoryWriteResult,
    type HouseWriteResult,
} from '../house-bridge.js';
import { houseImportLink, researchDeviceAllows, researchLinkMark, type ResearchStoryDo } from '../research-link.js';
import { houseStoryTarget } from './story-compare-ui.js';
import { announcedResearchScheme } from '../research-device.js';
import { buildHousePage, buildHousePageDocument, housePageFileName, housePageSectionId, housePageSections, type HousePageSectionKey } from '../house-page.js';
import { HOUSE_PAGE_CSS } from '../house-page-css.js';
import { PERSON_PAGE_CSS } from '../person-page-css.js';
import { appFontFaceCss, POSTER_SERIF_FACES } from '../poster-fonts.js';
import { houseStateHtml, withRevealed } from './house-state-ui.js';
import { houseMaterialError } from './house-material-ui.js';
import { researchActionLabel, researchBridgeActionLabel } from './research-open-mark.js';
import { runBusy } from './busy.js';
import { mountHouseMap, resetHouseMapState } from './house-map-ui.js';
import { uiModule } from './module.js';

export const HOUSE_PAGE_ID = 'house-page-modal';
const CSS_ID = 'house-page-css';
const PERSON_CSS_ID = 'person-page-css';

function esc(text: string): string {
    return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

interface PageState {
    id: HouseId;
    parent: string | null;
    userChange: () => void;
    /** The name after the farm being written (the redraw keeps the field). */
    editingName: boolean;
    /** A section to show once it is drawn (What waits opens the page at the story, spec 145 T4). */
    section?: HousePageSectionKey;
}

let page: PageState | null = null;
/** The research's results of houses read for the page: by key, with the list's rev they were read for. */
const read = new Map<string, { rev: string; house: HouseResearch }>();
const loading = new Set<string>();

function overlayEl(): HTMLElement | null {
    return document.getElementById(HOUSE_PAGE_ID);
}

/** The page's content CSS (the person page's and the house's), once into the app document. */
function ensureCss(): void {
    if (!document.getElementById(CSS_ID)) {
        const style = document.createElement('style');
        style.id = CSS_ID;
        // The person page's rules come with it when that page was never opened (its own id keeps them once).
        style.textContent = (document.getElementById(PERSON_CSS_ID) ? '' : PERSON_PAGE_CSS) + HOUSE_PAGE_CSS;
        document.head.appendChild(style);
    }
}

export const housePageMethods = uiModule({
    /** Is the house page open? */
    isHousePageOpen(): boolean {
        return !!overlayEl();
    },

    /** Open the page of a house of the tree (its id or a number joined into it): false when the tree has no such house. */
    openHousePage(id: string, parent?: string, opts: { section?: HousePageSectionKey } = {}): boolean {
        const house = this.treeHouseOf(id);
        if (!house) return false;
        const keepParent = page?.parent ?? null;
        this.closeHousePage({ restore: false });
        ensureCss();
        const P = strings.houses.page;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active modal-overlay--page';
        overlay.id = HOUSE_PAGE_ID;
        overlay.innerHTML = `
            <div class="modal modal--page house-page" role="dialog" aria-modal="true" aria-labelledby="hp-title" data-skeleton="skip">
                <header class="pp-head">
                    <button type="button" class="pp-back hp-back"><span class="pp-back-arrow" aria-hidden="true">‹</span><span class="pp-back-name">${esc(strings.houses.title)}</span></button>
                    <div class="pp-titles"><h2 id="hp-title"></h2><span class="pp-sub"></span></div>
                    <span class="pp-mtitle" aria-hidden="true"><span class="pp-mname"></span></span>
                    <button type="button" class="pp-hbtn pp-save">${esc(P.save)}</button>
                    <button type="button" class="pp-hbtn pp-more" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(P.more)}">⋯</button>
                    <button type="button" class="pp-close" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </header>
                <div class="pp-menu" role="menu" aria-label="${esc(P.more)}" hidden></div>
                <div class="pp-body" tabindex="-1"></div>
            </div>`;
        document.body.appendChild(overlay);

        // The dialog it was opened over hides and comes back on close (the Houses window, Places).
        const under = parent ?? keepParent;
        const parentId = under && (under === keepParent || document.getElementById(under)?.classList.contains('active')) ? under : null;
        if (parentId) {
            if (!this.dialogStack.includes(parentId)) this.pushDialog(parentId);
            this.closeDialogById(parentId);
        }
        this.dialogStack = this.dialogStack.filter(d => d !== HOUSE_PAGE_ID);
        this.pushDialog(HOUSE_PAGE_ID);

        let queued = false;
        const userChange = (): void => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => {
                queued = false;
                if (overlayEl()) this.renderHousePage();
            });
        };
        page = { id: house.id, parent: parentId, userChange, editingName: false, ...(opts.section ? { section: opts.section } : {}) };
        window.addEventListener('strom:user-change', userChange);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) { this.closeHousePage(); return; }
            this.onHousePageClick(e);
        });
        overlay.addEventListener('keydown', (e) => this.onHousePageKey(e));
        this.houseStatesSync();
        this.renderHousePage();
        // The body takes the focus, unless the map's point being moved took it (the Map tab's Move the point).
        const body = overlay.querySelector<HTMLElement>('.pp-body');
        if (!body?.contains(document.activeElement)) body?.focus({ preventScroll: true });
        return true;
    },

    /** Close the page; the dialog it was opened over comes back (unless `restore` is false). */
    closeHousePage(opts: { restore?: boolean } = {}): void {
        const overlay = overlayEl();
        const was = page;
        if (was) window.removeEventListener('strom:user-change', was.userChange);
        page = null;
        resetHouseMapState();
        this.dialogStack = this.dialogStack.filter(d => d !== HOUSE_PAGE_ID);
        overlay?.remove();
        if (!was?.parent) return;
        if (opts.restore === false) return;
        this.openDialogById(was.parent);
        if (was.parent === 'houses-modal') this.refreshHousesWindow();
    },

    /** Escape: the ⋯ menu first, the name being written next, then the window. False: not the page's. */
    housePageEscape(topId: string | undefined): boolean {
        if (topId !== HOUSE_PAGE_ID) return false;
        const menu = overlayEl()?.querySelector<HTMLElement>('.pp-menu');
        if (menu && !menu.hidden) { this.closeHousePageMenu(true); return true; }
        if (page?.editingName) {
            page.editingName = false;
            this.renderHousePage();
            overlayEl()?.querySelector<HTMLElement>('.hp-name-edit')?.focus();
            return true;
        }
        this.closeHousePage();
        return true;
    },

    /** The list of the research changed, or the tree did: the open page is drawn again. */
    refreshHousePage(): void {
        if (overlayEl() && page && !page.editingName) this.renderHousePage();
    },

    /** The research's whole result of a house (read once per list rev; the page redraws when it comes), null none. */
    housePageResearch(house: TreeHouse): HouseResearch | null {
        const b = this.houseResearchBridge();
        const row = b ? this.houseResearchRow(house) : null;
        if (!b || !row) return null;
        const rev = this.houseStatesRev();
        const got = read.get(row.key);
        if (got && got.rev === rev) return got.house;
        if (!loading.has(row.key)) {
            loading.add(row.key);
            void fetchHouse(b.base, row.key).then(r => {
                loading.delete(row.key);
                if (!r.ok) return;
                read.set(row.key, { rev, house: r.house });
                if (page?.id === house.id) this.refreshHousePage();
            });
        }
        // A result the bridge read for another view (the Map tab's houses) serves until this one comes.
        return got?.house ?? houseCache(b.base).get(row.key) ?? this.houseResearchRead(house);
    },

    /**
     * Whether a house of the tree has an approved story (spec 145 T4, `house.story`): the detail the bridge read,
     * else read once per list rev, the list first when none is read (`then` when a story came); false without the
     * bridge or the feature.
     */
    houseHasStory(id: string, then?: () => void): boolean {
        const b = this.houseResearchBridge();
        if (!b || !houseFeature(b.features, 'house.story')) return false;
        const house = this.treeHouseOf(id);
        if (!house) return false;
        const row = this.houseResearchRow(house);
        if (!row) {
            // The research's list not read yet (no view of houses opened): read it, then the house's detail.
            if (then && !this.houseStatesRev()) void this.loadHouseStates().then(() => { if (this.houseResearchRow(house)) then(); });
            return false;
        }
        const rev = this.houseStatesRev();
        const got = read.get(row.key);
        if (got && got.rev === rev) return got.house.story?.status === 'final';
        if (!loading.has(row.key)) {
            loading.add(row.key);
            void fetchHouse(b.base, row.key).then(r => {
                loading.delete(row.key);
                if (!r.ok) return;
                read.set(row.key, { rev, house: r.house });
                if (page?.id === house.id) this.refreshHousePage();
                if (r.house.story?.status === 'final') then?.();
            });
        }
        const known = got?.house ?? houseCache(b.base).get(row.key) ?? this.houseResearchRead(house);
        return known?.story?.status === 'final';
    },

    /** Draw the page of the open house, its scroll kept. */
    renderHousePage(): void {
        const overlay = overlayEl();
        if (!overlay || !page) return;
        const house = this.treeHouseOf(page.id);
        if (!house) { this.closeHousePage(); return; }
        page.id = house.id;
        const lang = getCurrentLanguage();
        const P = strings.houses.page;
        const H = strings.houses;
        const data = DataManager.getData();
        const b = this.houseResearchBridge();
        const row = b ? this.houseResearchRow(house) : null;
        const research = this.housePageResearch(house);
        const canEdit = !DataManager.housesReadOnly();
        const materialActions = b ? [
            houseFeature(b.features, 'house.material')
                ? `<button type="button" class="hp-mini house-attach">${esc(H.attach)}</button>` : '',
            houseFeature(b.features, 'house.import') && researchDeviceAllows('house')
                ? `<button type="button" class="hp-mini house-import">${researchActionLabel(H.import, researchLinkMark('house', { houseDo: 'import' }))}</button>` : '',
        ].join('') : '';
        const stateHtml = b ? houseStateHtml(row, { lang, answer: true }) + this.houseActionHtml(house) : '';
        const layers = b ? houseStatus(this.researchStatusOf(b.researchId))?.layers ?? [] : [];
        // Attach material… under a look not known (spec 145 T1): the same action, only for a tree that can be changed.
        const lookAttach = b && canEdit && houseFeature(b.features, 'house.material')
            ? `<button type="button" class="hp-mini house-attach">${esc(H.attach)}</button>` : '';
        // The story's decisions (spec 145 T4): a draft approved in the research, a new version compared here.
        const story = research?.story;
        const storyApprove = story?.status === 'draft' && this.houseStoryUrl(research, 'final')
            ? `<button type="button" class="hp-mini hp-mini--primary" data-hp-act="story-approve">${researchActionLabel(strings.research.approveStory, researchLinkMark('story'))}</button>` : '';
        const storyCompare = story?.status === 'final' && story.draft
            ? `<button type="button" class="hp-mini" data-hp-act="story-compare">${esc(strings.story.compare)}</button>` : '';
        const body = buildHousePage(data, house, research, 'app', {
            lang, now: new Date(), research: !!b, state: row?.state ?? null, layers, look: !!b && houseFeature(b.features, 'house.look'),
            app: {
                stateHtml, materialActionsHtml: materialActions, lookAttachHtml: lookAttach, canEdit,
                canConfirm: canEdit && !!b && houseFeature(b.features, 'house.confirm'),
                storyApproveHtml: storyApprove, storyCompareHtml: storyCompare,
            },
        });
        const sections = housePageSections(body, lang);
        const toc = sections.length >= 3
            ? `<nav class="pp-toc" aria-label="${esc(strings.personPage.toc)}"><div class="pp-toc-h">${esc(strings.personPage.toc)}</div><ol>`
                + sections.map(s => `<li><a class="pp-toc-link sel-tab" data-sel-dir="side" href="#${esc(s.id)}" data-pp-toc="${esc(s.id)}"><span class="sel-l" data-label="${esc(s.label)}">${esc(s.label)}</span></a></li>`).join('')
                + '</ol></nav>'
            : '';
        // The number kept to its marker in the header too (houseTitle; designer's round 2, question 18).
        const title = houseTitle(house);
        const name = data.houses?.[house.id]?.name ?? house.name ?? research?.name ?? '';
        (overlay.querySelector('#hp-title') as HTMLElement).textContent = title;
        (overlay.querySelector('#hp-title') as HTMLElement).title = title;
        (overlay.querySelector('.pp-sub') as HTMLElement).textContent = name;
        (overlay.querySelector('.pp-mname') as HTMLElement).textContent = title;
        this.closeHousePageMenu(false);
        const scroller = overlay.querySelector('.pp-body') as HTMLElement;
        const top = scroller.scrollTop;
        scroller.innerHTML = `<div class="pp-layout">${toc}${body}</div>`;
        scroller.scrollTop = top;
        mountHouseMap(scroller, {
            houseId: house.id,
            onSave: (p) => { void this.saveHousePoint(house, p, 'manual'); },
            onConfirm: () => { void this.saveHousePoint(house, null, 'confirmed'); },
            redraw: () => this.renderHousePage(),
        });
        if (page.editingName) this.startHouseNameEdit();
        // The section asked for, once the research's result drew it.
        const want = page.section ? scroller.querySelector<HTMLElement>(`#${housePageSectionId(page.section)}`) : null;
        if (want) {
            delete page.section;
            want.scrollIntoView({ block: 'start' });
        }
    },

    onHousePageKey(e: KeyboardEvent): void {
        const menu = overlayEl()?.querySelector<HTMLElement>('.pp-menu');
        if (!menu || menu.hidden) return;
        const items = [...menu.querySelectorAll<HTMLElement>('.pp-menu-item')].filter(el => el.getClientRects().length > 0);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            e.stopPropagation();
            const at = items.indexOf(document.activeElement as HTMLElement);
            const to = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
                : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[to]?.focus();
        }
    },

    onHousePageClick(e: MouseEvent): void {
        const target = e.target as HTMLElement;
        const overlay = overlayEl();
        if (!overlay || !page) return;
        const house = this.treeHouseOf(page.id);
        if (!house) return;
        const menu = overlay.querySelector<HTMLElement>('.pp-menu');
        if (menu && !menu.hidden && !target.closest('.pp-menu') && !target.closest('.pp-more')) this.closeHousePageMenu(false);

        // The header.
        if (target.closest('.pp-close')) { this.closeHousePage(); return; }
        if (target.closest('.hp-back')) { this.housePageBack(house); return; }
        if (target.closest('.pp-save')) { this.saveHousePage(house); return; }
        if (target.closest('.pp-more')) { this.toggleHousePageMenu(house); return; }
        const menuItem = target.closest<HTMLElement>('[data-hp-menu]');
        if (menuItem) { this.runHousePageMenu(house, menuItem.dataset.hpMenu ?? '', menuItem); return; }

        // The contents: scroll the body, never the location hash.
        const tocLink = target.closest<HTMLAnchorElement>('[data-pp-toc]');
        if (tocLink) {
            e.preventDefault();
            overlay.querySelector<HTMLElement>(`#${CSS.escape(tocLink.dataset.ppToc ?? '')}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
            return;
        }
        // A link inside the page to a section ("see What is not known").
        const inner = target.closest<HTMLAnchorElement>('a[href^="#hp-sec-"]');
        if (inner) {
            e.preventDefault();
            overlay.querySelector<HTMLElement>(inner.getAttribute('href')!)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
            return;
        }

        // The page's content.
        const person = target.closest<HTMLElement>('.hp-person[data-person-id]');
        if (person) {
            const id = person.dataset.personId ?? '';
            this.closeHousePage({ restore: false });
            this.closeHouseParents();
            this.focusFromMap(id);
            return;
        }
        const answer = target.closest<HTMLElement>('[data-hp-act="answer"], .house-answer');
        if (answer) {
            const q = answer.dataset.question;
            if (!q) return;
            this.closeHousePage({ restore: false });
            this.closeHouseParents();
            this.showOverviewWaitingItem(q);
            return;
        }
        const act = target.closest<HTMLElement>('[data-hp-act]');
        if (act) { void this.housePageAct(house, act); return; }
        if (this.houseActionClick(target)) return;
        this.houseMaterialClick(target, house);
    },

    /** Leave the dialogs the page was opened over (to the tree, to the overview). */
    closeHouseParents(): void {
        if (document.getElementById('houses-modal')) this.closeHousesWindow(false);
        for (const id of [...this.dialogStack].reverse()) {
            if (id === 'places-modal') document.getElementById(id)?.remove();
            else this.closeFloatingDialog(id);
        }
        this.clearDialogStack();
    },

    /** "‹ Houses": back to the Houses window it came from, else the window on this house. */
    housePageBack(house: TreeHouse): void {
        const parent = page?.parent ?? null;
        if (parent === 'houses-modal' && document.getElementById('houses-modal')) {
            this.closeHousePage();
            return;
        }
        this.closeHousePage({ restore: false });
        this.showHousesWindow({ town: house.ref.town, house: house.id, ...(parent ? { parent } : {}) });
    },

    /** An action inside the page: the name after the farm, a reveal, Confirm / Not the same house. */
    async housePageAct(house: TreeHouse, el: HTMLElement): Promise<void> {
        const act = el.dataset.hpAct;
        if (act === 'story-approve') {
            const url = this.houseStoryUrl(this.housePageResearch(house), 'final');
            if (url) this.launchResearchLink(url);
            return;
        }
        if (act === 'story-compare') {
            const research = this.housePageResearch(house);
            const target = research ? houseStoryTarget(research, houseTitle(house)) : null;
            if (target) this.showStoryCompare(target);
            return;
        }
        if (act === 'name') {
            if (DataManager.housesReadOnly() || !page) return;
            page.editingName = true;
            this.startHouseNameEdit();
            return;
        }
        if (act === 'reveal') {
            const eventId = el.dataset.event;
            if (!eventId || DataManager.housesReadOnly()) return;
            const user = DataManager.getData().houses?.[house.id];
            const reveal = withRevealed(user?.revealInOutputs, eventId, el.dataset.reveal === 'show');
            const next: HouseUserData = { ...(user ?? {}), revealInOutputs: reveal };
            if (!reveal.length) delete next.revealInOutputs;
            if (DataManager.setHousesUserData({ [house.id]: Object.keys(next).length ? next : undefined }, houseTitle(house))) {
                this.renderHousePage();
                overlayEl()?.querySelector<HTMLElement>(`.hp-reveal[data-event="${CSS.escape(eventId)}"]`)?.focus({ preventScroll: true });
            }
            return;
        }
        if (act === 'renumber' || act === 'not-same') {
            const b = this.houseResearchBridge();
            const id = el.dataset.number;
            if (!b || !id || !houseFeature(b.features, 'house.confirm')) return;
            const key = (this.houseResearchRow(house)?.key ?? house.id) as HouseId;
            const body = act === 'renumber' ? { house: key, what: 'renumber' as const, id } : { house: key, what: 'notSame' as const, id };
            const r: HouseWriteResult | undefined = await runBusy(el, () => confirmHouse(b.base, body, b.features),
                { label: strings.busy.sending, kind: 'write' });
            if (!r) return;
            if (!r.ok) {
                this.showToast(houseMaterialError(r, () => (r.held ? this.researchWriteHeldText(r.held, false).toast : '')), 6000);
                return;
            }
            if (r.house) read.set(r.house.key, { rev: this.houseStatesRev(), house: r.house });
            void this.loadHouseStates();
            this.renderHousePage();
        }
    },

    /**
     * The point of the house (§4): a moved point (`manual`) or the research's
     * point confirmed (`confirmed`) into the tree (one undo step), and to the
     * research (`/houses/confirm {what: 'location'}`) when it knows the house.
     */
    async saveHousePoint(house: TreeHouse, point: { lat: number; lng: number } | null, how: 'manual' | 'confirmed'): Promise<void> {
        if (DataManager.housesReadOnly()) return;
        const research = this.housePageResearch(house);
        const at = point ?? (research?.location ? { lat: research.location.lat, lng: research.location.lon } : null);
        if (!at) return;
        const user = DataManager.getData().houses?.[house.id];
        const next: HouseUserData = { ...(user ?? {}), location: { lat: at.lat, lng: at.lng, how } };
        DataManager.setHousesUserData({ [house.id]: next }, houseTitle(house));
        this.renderHousePage();
        const b = this.houseResearchBridge();
        const row = b ? this.houseResearchRow(house) : null;
        if (!b || !row || !houseFeature(b.features, 'house.confirm')) return;
        const body = how === 'manual'
            ? { house: row.key as HouseId, what: 'location' as const, lat: at.lat, lon: at.lng }
            : { house: row.key as HouseId, what: 'location' as const };
        const r: HouseWriteResult = await confirmHouse(b.base, body, b.features);
        if (!r.ok) {
            this.showToast(houseMaterialError(r, () => (r.held ? this.researchWriteHeldText(r.held, false).toast : '')), 6000);
            return;
        }
        if (r.house) read.set(r.house.key, { rev: this.houseStatesRev(), house: r.house });
        if (overlayEl()) this.renderHousePage();
    },

    /** The name after the farm written in place: Enter or leaving the field saves, Escape leaves it as it was. */
    startHouseNameEdit(): void {
        const overlay = overlayEl();
        if (!overlay || !page) return;
        const house = this.treeHouseOf(page.id);
        const line = overlay.querySelector<HTMLElement>('.hp-hero .hp-aka');
        if (!house || !line) return;
        const P = strings.houses.page;
        const was = DataManager.getData().houses?.[house.id]?.name ?? house.name ?? '';
        line.innerHTML = `<input type="text" class="hp-name-input" maxlength="80" autocomplete="off" spellcheck="false" aria-label="${esc(P.nameLabel)}" placeholder="${esc(P.nameLabel)}">`;
        const input = line.querySelector('input') as HTMLInputElement;
        input.value = was;
        let done = false;
        const finish = (save: boolean): void => {
            if (done || !page) return;
            done = true;
            page.editingName = false;
            const name = input.value.trim();
            if (save && name !== was) {
                const user = DataManager.getData().houses?.[house.id];
                const next: HouseUserData = { ...(user ?? {}) };
                if (name) next.name = name; else delete next.name;
                DataManager.setHousesUserData({ [house.id]: Object.keys(next).length ? next : undefined }, houseTitle(house));
            }
            this.renderHousePage();
            overlayEl()?.querySelector<HTMLElement>('.hp-name-edit')?.focus({ preventScroll: true });
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
        });
        input.addEventListener('blur', () => finish(true));
        input.focus();
        input.select();
    },

    /** Save HTML (K7.1): the page for outputs, one self-contained file. */
    saveHousePage(house: TreeHouse): void {
        const P = strings.houses.page;
        try {
            const b = this.houseResearchBridge();
            const html = buildHousePageDocument(DataManager.getData(), house, this.housePageResearch(house), {
                lang: getCurrentLanguage(), now: new Date(), research: !!b, state: b ? this.houseResearchRow(house)?.state ?? null : null,
                look: !!b && houseFeature(b.features, 'house.look'),
                layers: b ? houseStatus(this.researchStatusOf(b.researchId))?.layers ?? [] : [],
                fontCss: appFontFaceCss([...POSTER_SERIF_FACES]),
            });
            const name = housePageFileName(house);
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = name;
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            this.showToast(P.saved(name), 4000, { kind: 'person-page' });
        } catch {
            this.showToast(P.saveError, 8000, { kind: 'person-page' });
        }
    },

    // ── The house's story (spec 145 T4) ──

    /** "Write the story of the house": only with `house.story` (a research with its agent; never an archive or the demo). */
    houseStoryPossible(): boolean {
        const b = this.houseResearchBridge();
        return !!b && houseFeature(b.features, 'house.story') && researchDeviceAllows('house-story');
    },

    /** Its label with its mark (the AI badge alone): a new version once the house has a story. */
    houseStoryLabel(research: HouseResearch | null): string {
        const again = !!research?.story && research.story.status !== null;
        return researchBridgeActionLabel(again ? strings.houses.writeStoryAgain : strings.houses.writeStory, 'house-story');
    },

    /** The link that approves the house's story or keeps the approved one (`story?house=A…`), or null. */
    houseStoryUrl(research: HouseResearch | null, how: ResearchStoryDo): string | null {
        return research?.id && research.story ? this.activeResearchLink('story', { house: research.id, storyDo: how }) : null;
    },

    /**
     * Ask the research's agent for the house's story (`POST /houses/story`): its task on top of the queue; the page
     * shows its state then. `el`: the button that waits.
     */
    async askHouseStory(house: TreeHouse, el?: HTMLElement | null): Promise<void> {
        const b = this.houseResearchBridge();
        if (!b || !houseFeature(b.features, 'house.story')) return;
        const research = this.housePageResearch(house) ?? this.houseResearchRead(house);
        const ref = research?.id ?? this.houseResearchRow(house)?.key;
        if (!ref) { this.showToast(strings.houses.errStoryNone, 6000); return; }
        const send = (): Promise<HouseStoryWriteResult> => requestHouseStory(b.base, ref, b.features);
        const r: HouseStoryWriteResult | undefined = el ? await runBusy(el, send, { label: strings.busy.sending, kind: 'write' }) : await send();
        if (!r) return;
        if (!r.ok) {
            this.showToast(r.code === 'none' ? strings.houses.errStoryNone
                : houseMaterialError(r, () => (r.held ? this.researchWriteHeldText(r.held, false).toast : '')), 6000);
            return;
        }
        this.showToast(r.made ? strings.houses.storyAsked : strings.houses.storyMoved, 5000);
        if (r.house) read.set(r.house.key, { rev: this.houseStatesRev(), house: r.house });
        void this.loadHouseStates();
        if (overlayEl()) this.renderHousePage();
    },

    // ── The ⋯ menu ──

    toggleHousePageMenu(house: TreeHouse): void {
        const overlay = overlayEl();
        const menu = overlay?.querySelector<HTMLElement>('.pp-menu');
        if (!overlay || !menu) return;
        if (!menu.hidden) { this.closeHousePageMenu(true); return; }
        const P = strings.houses.page;
        const H = strings.houses;
        const canEdit = !DataManager.housesReadOnly();
        const b = this.houseResearchBridge();
        const item = (key: string, label: string, narrow = false, html = false): string =>
            `<button type="button" class="pp-menu-item${narrow ? ' pp-menu-item--narrow' : ''}" role="menuitem" data-hp-menu="${key}">${html ? label : esc(label)}</button>`;
        const sep = '<div class="pp-menu-sep" role="separator"></div>';
        const groups = [
            [
                item('save', P.save, true), item('book', P.openInBook),
                // The Map tab with the Family houses layer and the house in the middle (spec 030 §9).
                this.houseOnMapPossible(house, this.housePageResearch(house)) ? item('map', P.onMap) : '',
                canEdit ? item('name', P.nameMenu) : '',
            ].join(''),
            b ? [
                // The house's action, as beside its state (houseActionOf): ask, move to the top, ask again.
                ((a) => a ? item(`act-${a.action}`, a.html, false, true) : '')(this.houseActionNow(house, 14)),
                // spec 145 T2: the agent's chat about the house, only with `house.chat`.
                this.houseChatPossible() ? item('chat', this.houseChatLabel(), false, true) : '',
                // spec 145 T4: the agent writes the house's story, through the bridge (the AI badge alone).
                this.houseStoryPossible() ? item('story', this.houseStoryLabel(this.housePageResearch(house)), false, true) : '',
                houseFeature(b.features, 'house.material') ? item('attach', H.attach) : '',
                houseFeature(b.features, 'house.import') && researchDeviceAllows('house')
                    ? item('import', researchActionLabel(H.import, researchLinkMark('house', { houseDo: 'import' })), false, true) : '',
            ].join('') : '',
            canEdit ? [
                item('merge', H.merge),
                this.houseSplitCandidates(house).length ? item('split', H.split) : '',
            ].join('') : '',
        ].filter(Boolean);
        menu.innerHTML = groups.join(sep);
        menu.hidden = false;
        overlay.querySelector('.pp-more')?.setAttribute('aria-expanded', 'true');
        [...menu.querySelectorAll<HTMLElement>('.pp-menu-item')].find(el => el.getClientRects().length > 0)?.focus();
    },

    closeHousePageMenu(focusButton: boolean): void {
        const overlay = overlayEl();
        const menu = overlay?.querySelector<HTMLElement>('.pp-menu');
        if (!menu || menu.hidden) return;
        menu.hidden = true;
        menu.innerHTML = '';
        const btn = overlay?.querySelector<HTMLElement>('.pp-more');
        btn?.setAttribute('aria-expanded', 'false');
        if (focusButton) btn?.focus();
    },

    runHousePageMenu(house: TreeHouse, key: string, el: HTMLElement): void {
        this.closeHousePageMenu(false);
        if (key === 'save') { this.saveHousePage(house); return; }
        if (key === 'book') {
            // The book's dialog opens over the page, on this house (spec 030 §8).
            this.openBookDialog({ kind: 'menu' }, undefined, { output: 'book', selection: { kind: 'house', place: house.ref.town, house: house.text } });
            return;
        }
        if (key === 'map') { this.showHouseOnMap(house, this.housePageResearch(house)); return; }
        if (key === 'name') {
            if (!page || DataManager.housesReadOnly()) return;
            page.editingName = true;
            this.startHouseNameEdit();
            return;
        }
        if (key === 'act-top' || key === 'act-request' || key === 'act-again') {
            this.runHouseAction(house, key === 'act-top' ? 'top' : key === 'act-again' ? 'again' : 'request',
                overlayEl()?.querySelector<HTMLElement>('.pp-more'));
            return;
        }
        if (key === 'chat') { this.openHouseChat(house, el); return; }
        if (key === 'story') { void this.askHouseStory(house, overlayEl()?.querySelector<HTMLElement>('.pp-more')); return; }
        if (key === 'attach') { this.showHouseMaterialDialog(house); return; }
        if (key === 'import') {
            const b = this.houseResearchBridge();
            const url = b ? houseImportLink(b.researchId, announcedResearchScheme()) : null;
            if (url) void this.launchResearchLink(url, 'terminal', el);
            return;
        }
        if (key === 'merge' || key === 'split') {
            // The Houses window's dialogs: the window on this house under them.
            const parent = page?.parent ?? null;
            this.closeHousePage({ restore: false });
            if (!document.getElementById('houses-modal')) {
                this.showHousesWindow({ town: house.ref.town, house: house.id, ...(parent && parent !== 'houses-modal' ? { parent } : {}) });
            } else {
                this.openDialogById('houses-modal');
                this.refreshHousesWindow();
            }
            if (key === 'merge') this.showHouseMergeDialog(house.id);
            else this.showHouseSplitDialog(house.id);
        }
    },
});
