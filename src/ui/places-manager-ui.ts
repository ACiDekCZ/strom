/**
 * The Places dialog (K5/A6, §4–§7 of "map kinds and houses"): every place of
 * the tree with its name and its location on the map.
 *
 * It exists because both halves can go wrong and neither could be fixed:
 *   - a place the geocoder cannot find ("Kravaře u Č. Lípy" — a spelling
 *     only the family uses) had no way to get onto the map at all,
 *   - a place matched to the WRONG spot (a same-named town elsewhere) fell
 *     out of the "missing" list and became unreachable.
 *
 * Searching and renaming are kept apart on purpose. The search query is
 * throwaway — type the nearest town, take the coordinates; only the location
 * is attached. The name is the record: renaming it rewrites every use in the
 * tree, so it shows first how many entries change.
 *
 * A town with several places that hold a house ("Bělokamen 16", "Bělokamen
 * čp. 4") is one group: its houses under it, a location by the town for the
 * ones the map does not know, and — in a tree of the app's own — the split of
 * the places into the town and the house field. A research tree splits in its
 * research (a bulk fix), so the dialog links there instead.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { PersonId, PlaceGeo } from '../types.js';
import {
    collectPlaces, orphanedPlaceKeys, placeKey, PlaceUsage, sortPlacesForManager, placeFilterText, placeMatchesFilter,
    readPlacesSort, knownStreets, townOfPlace, placeTownGroups, townHousePlaces, splitPlaceHouses, countPlaceUses,
    houseKey, TownGroup, TownHousePlace, TOWN_POINT_PREFIX,
} from '../places.js';
import { foldText, KnownStreets } from '../streets.js';
import {
    geocodeTown, placesCentroid, searchPlaceCandidates, hitKind, hitLabelParts, GeocodeCandidate,
} from '../geocode.js';
import { fixText, STREET_PLACES_FIX } from '../research-fixes.js';
import { onComputer } from './research-ui.js';
import { uiModule } from './module.js';
import { normalizeModal } from './modal-skeleton.js';
import type { MapScope } from './map-ui.js';

/** A row of the dialog: a place with its location, when it has one. */
interface ManagerPlace {
    key: string;
    usage: PlaceUsage;
    geo?: PlaceGeo;
}

/** The dialog's places by key, as last drawn (what its search looks in). */
let managerPlaces = new Map<string, PlaceUsage>();
/** The dialog's town groups by townKey, as last drawn. */
let managerGroups = new Map<string, TownGroup>();
/** Groups opened (▾), and groups showing all their houses — kept over a redraw, cleared on a fresh open. */
let expandedTowns = new Set<string>();
let allShownTowns = new Set<string>();
/** The card offering a by-town location for the town's other house places, shown after a redraw. */
let pendingOffer: { key: string; town: string; others: string[]; geo: PlaceGeo } | null = null;
let offerTimer: number | null = null;

/** The tree's streets (knownStreets), read once per draw of the dialog. */
let managerKnown: KnownStreets = () => undefined;

/** Members shown in an opened group before "Show all N". */
const GROUP_FIRST = 8;
/** An offer with no other place to fill goes away by itself after this long. */
const OFFER_DONE_MS = 4000;

/** Place keys of the whole tree (a rename into one of them merges). */
function allPlaceKeys(): Set<string> {
    return new Set(collectPlaces(DataManager.getData()).keys());
}

/** Distinct houses the place's facts carry in their house field. */
function houseFieldCount(usage: PlaceUsage): number {
    const houses = new Set<string>();
    for (const byHouse of usage.houses.values()) {
        for (const h of byHouse.keys()) if (h) houses.add(houseKey(h));
    }
    return houses.size;
}

/**
 * The other places of `town` (by its key, over the whole tree) that hold a
 * house and have no location yet: what "use for the other house numbers too"
 * fills.
 */
function otherUnplacedOfTown(town: string, exceptKey: string): string[] {
    const data = DataManager.getData();
    const known = knownStreets(data);
    const townKey = placeKey(town);
    const out: string[] = [];
    for (const [key, usage] of collectPlaces(data)) {
        if (key === exceptKey || data.places?.[key]) continue;
        const parsed = townOfPlace(usage.display, known);
        if (parsed && placeKey(parsed.town) === townKey) out.push(key);
    }
    return out;
}

export const placesManagerMethods = uiModule({
    placesForManager(scope: MapScope): ManagerPlace[] {
        const data = DataManager.getData();
        const filter: ReadonlySet<PersonId> | undefined =
            scope === 'tree' ? undefined : TreeRenderer.getVisiblePersonIds();
        // By name, as the UI language sorts, unless the dialog's sort says
        // otherwise — a long list is read like an index. The places without
        // coordinates have their own chip (and stay marked).
        return sortPlacesForManager([...collectPlaces(data, filter)]
            .map(([key, usage]) => ({ key, usage, geo: data.places?.[key] })), this.placesSort, getCurrentLanguage());
    },

    /**
     * @param focusKey scroll to this place and open its search straight away;
     *   a town (`town:<townKey>`, or the town's own place) opens its group
     * @param parentDialogId dialog to return to on Escape/Close (tree manager)
     * @param scope which places to list, when the caller knows better
     * @param opts.keepFilter a redraw: keep the search, the chip and the opened groups
     * @param opts.unplaced open with the "No location" chip on
     *
     * Opened from the map it follows the map's scope; opened from anywhere else
     * "this view" would mean nothing, so it covers the whole tree.
     */
    showPlacesManager(focusKey?: string, parentDialogId?: string, scope?: MapScope,
        opts: { keepFilter?: boolean; unplaced?: boolean } = {}): void {
        this.placesManagerScope = scope ?? (parentDialogId ? 'tree' : this.mapScope);
        this.placesManagerParent = parentDialogId ?? null;
        const places = this.placesForManager(this.placesManagerScope);
        if (places.length === 0) {
            this.showToast(strings.map.noPlacesAtAll);
            return;
        }
        const data = DataManager.getData();
        managerPlaces = new Map(places.map(p => [p.key, p.usage]));
        managerKnown = knownStreets(data);
        managerGroups = new Map(placeTownGroups(data, managerPlaces).map(g => [g.townKey, g]));
        // A fresh open starts with the whole list; a redraw (a rename, a pin) keeps the search.
        if (!opts.keepFilter) {
            this.placesFilter = { query: '', unplacedOnly: !!opts.unplaced };
            expandedTowns = new Set();
            allShownTowns = new Set();
            pendingOffer = null;
        }
        const unplaced = places.filter(p => !p.geo).length;
        if (!unplaced) this.placesFilter.unplacedOnly = false;
        const f = this.placesFilter;
        const m = strings.map;
        // Coordinate entries no person/event/partnership refers to any more. They
        // never appear as rows (the list is built from used places), so the
        // footer action is the only handle on them.
        const orphanCount = orphanedPlaceKeys(data).length;
        this.closeMapPopup();

        document.getElementById('places-modal')?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = 'places-modal';
        overlay.innerHTML = `
            <div class="modal places-modal modal--lg" role="dialog" data-dialog-kind="info" aria-modal="true">
                <div class="modal-header">
                    <h2>${m.placesTitle}</h2>
                    <button class="close-btn" id="places-close-x" aria-label="${strings.buttons.close}">&times;</button>
                </div>
                <p class="places-intro">${m.placesIntro}</p>
                <div class="places-list">
                    ${this.renderPlacesList(places)}
                </div>
                <p class="places-empty" id="places-filter-none" hidden>${m.filterNone}</p>
                <div class="buttons places-footer">
                    <button type="button" class="secondary places-clean-orphans" id="places-clean-orphans"
                        ${orphanCount === 0 ? 'disabled' : ''}>${m.cleanOrphans(orphanCount)}</button>
                    <button type="button" class="secondary" id="places-close" data-dismiss>${strings.buttons.close}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        // Wrap the body into its scroll container now, not in the skeleton's
        // observer later: moving the rows there afterwards would drop the
        // scroll to the focused place and the focus in its search (N9).
        const modal = overlay.querySelector('.modal') as HTMLElement;
        normalizeModal(modal);
        // The search stays put over the scrolling list (as in History of places).
        const bar = document.createElement('div');
        bar.className = 'places-bar';
        bar.innerHTML = `
            <div class="hm-search">
                <svg class="hm-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="M16 16l4.5 4.5"></path></svg>
                <input type="search" id="places-filter" autocomplete="off" spellcheck="false" enterkeyhint="search"
                       placeholder="${this.escapeHtml(m.filterPh)}" aria-label="${this.escapeHtml(m.filterPh)}" value="${this.escapeHtml(f.query)}">
                <span class="hm-search-count" id="places-filter-count" aria-live="polite"></span>
                <button type="button" class="hm-search-clear" id="places-filter-clear" hidden aria-label="${this.escapeHtml(m.filterClear)}">&times;</button>
            </div>
            ${unplaced ? `<button type="button" class="hd-chip places-unplaced-chip" id="places-unplaced" aria-pressed="${f.unplacedOnly}"
                title="${this.escapeHtml(m.filterUnplacedLabel)}">${this.escapeHtml(m.filterUnplaced)} <span class="hd-chip-n">${unplaced}</span></button>` : ''}
            <select class="places-sort" id="places-sort" aria-label="${this.escapeHtml(m.sortLabel)}" title="${this.escapeHtml(m.sortLabel)}">
                ${([['name', m.sortName], ['people', m.sortPeople], ['unplaced', m.sortUnplaced]] as const)
                    .map(([v, label]) => `<option value="${v}"${this.placesSort === readPlacesSort(v) ? ' selected' : ''}>${this.escapeHtml(label)}</option>`).join('')}
            </select>`;
        modal.insertBefore(bar, modal.querySelector(':scope > .modal-content'));
        const input = bar.querySelector('#places-filter') as HTMLInputElement;
        const setQuery = (q: string): void => {
            this.placesFilter.query = q;
            this.applyPlacesFilter();
        };
        input.addEventListener('input', () => setQuery(input.value));
        input.addEventListener('keydown', (e) => {
            // Escape empties the search first; the next one closes the dialog.
            if (e.key === 'Escape' && input.value) {
                e.preventDefault();
                e.stopPropagation();
                input.value = '';
                setQuery('');
            }
        });
        (bar.querySelector('#places-filter-clear') as HTMLButtonElement).onclick = () => {
            input.value = '';
            setQuery('');
            input.focus();
        };
        const chip = bar.querySelector('#places-unplaced') as HTMLButtonElement | null;
        if (chip) chip.onclick = () => {
            this.placesFilter.unplacedOnly = !this.placesFilter.unplacedOnly;
            chip.setAttribute('aria-pressed', String(this.placesFilter.unplacedOnly));
            this.applyPlacesFilter();
        };

        const sortSelect = bar.querySelector('#places-sort') as HTMLSelectElement;
        sortSelect.onchange = () => {
            // The old "without location first" option is the state order (place-identity), step B replaces the select.
            this.placesSort = readPlacesSort(sortSelect.value);
            this.applyPlacesSort();
        };

        const close = (): void => this.closePlacesManager();
        overlay.onclick = (e) => {
            if (e.target === overlay) { close(); return; }
            const hist = (e.target as HTMLElement).closest<HTMLElement>('[data-place-hist]');
            if (hist) this.placesHistoryAction(hist.dataset.placeHist ?? '', hist.dataset.hkey ?? '');
        };
        (overlay.querySelector('#places-close-x') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#places-close') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#places-clean-orphans') as HTMLButtonElement).onclick = () => void this.cleanOrphanPlaces();
        overlay.querySelectorAll<HTMLElement>('.place-row[data-key]').forEach(row => this.bindPlaceRow(row));
        overlay.querySelectorAll<HTMLElement>('.place-group').forEach(group => this.bindPlaceGroup(group));
        // History lines and the search texts last: they end in applyPlacesFilter.
        this.refreshPlacesHistoryRows();
        this.showPendingOffer();

        if (focusKey) this.focusPlaceInManager(focusKey);

        // Same stack discipline as other child dialogs (see showAuditLog): the
        // parent hides while the manager is open and Escape/Close returns to it.
        this.clearDialogStack();
        if (parentDialogId) {
            this.pushDialog(parentDialogId);
            this.closeDialogById(parentDialogId);
        }
        this.pushDialog('places-modal');
    },

    /** The list: places outside a town group as rows, each town group as its head, strip and houses. */
    renderPlacesList(places: readonly ManagerPlace[]): string {
        const inGroup = new Map<string, string>();
        for (const g of managerGroups.values()) {
            for (const mem of g.members) inGroup.set(mem.key, g.townKey);
            if (g.ownKey) inGroup.set(g.ownKey, g.townKey);
        }
        const byKey = new Map(places.map(p => [p.key, p]));
        const out: string[] = [];
        const drawn = new Set<string>();
        for (const p of this.sortedManagerItems(places)) {
            if ('group' in p) {
                if (drawn.has(p.group.townKey)) continue;
                drawn.add(p.group.townKey);
                out.push(this.renderPlaceGroup(p.group, byKey));
            } else if (!inGroup.has(p.key)) {
                out.push(this.renderPlaceRow(p));
            }
        }
        return out.join('');
    },

    /**
     * The dialog's top-level items in the order of the sort: the places outside
     * a group, and each group as one item by its sums (its town's name, all its
     * people, unplaced when a house is). Inside a group the order is natural.
     */
    sortedManagerItems(places: readonly ManagerPlace[]): (ManagerPlace | { key: string; usage: PlaceUsage; geo?: unknown; group: TownGroup })[] {
        const geos = DataManager.getData().places ?? {};
        const grouped = new Set<string>();
        const items: (ManagerPlace | { key: string; usage: PlaceUsage; geo?: unknown; group: TownGroup })[] = [];
        for (const g of managerGroups.values()) {
            for (const mem of g.members) grouped.add(mem.key);
            if (g.ownKey) grouped.add(g.ownKey);
            const own = g.ownKey ? managerPlaces.get(g.ownKey) : undefined;
            let count = own?.count ?? 0;
            for (const mem of g.members) count += managerPlaces.get(mem.key)?.count ?? 0;
            const usage: PlaceUsage = {
                display: g.town, variants: new Map(), count,
                personIds: new Array<PersonId>(g.personCount), kinds: new Map(), houses: new Map(),
            };
            const placed = g.unplacedCount === 0 && (!g.ownKey || !!geos[g.ownKey]);
            items.push({ key: g.ownKey ?? `${TOWN_POINT_PREFIX}${g.townKey}`, usage, geo: placed ? true : undefined, group: g });
        }
        for (const p of places) if (!grouped.has(p.key)) items.push(p);
        return sortPlacesForManager(items, this.placesSort, getCurrentLanguage());
    },

    renderPlaceGroup(g: TownGroup, byKey: ReadonlyMap<string, ManagerPlace>): string {
        const m = strings.map;
        const own = g.ownKey ? byKey.get(g.ownKey) : undefined;
        const meta = `${m.houseNumbers(g.houseCount)} · ${m.usedBy(g.personCount)}`;
        const head = own
            ? this.renderPlaceRow(own, { group: g, meta })
            : `<div class="place-group-title">
                   <div class="place-head">
                       ${this.placeCaretHtml(g.town)}
                       <span class="place-title place-group-name">${this.escapeHtml(g.town)}</span>
                       <span class="place-count">${this.escapeHtml(meta)}</span>
                       ${g.unplacedCount ? `<span class="place-unplaced-tag">${this.escapeHtml(m.unplacedN(g.unplacedCount))}</span>` : ''}
                   </div>
               </div>`;
        const members = g.members.map(mem => byKey.get(mem.key)).filter((p): p is ManagerPlace => !!p);
        return `
            <div class="place-group" data-town="${this.escapeHtml(g.townKey)}">
                ${head}
                <div class="place-group-strip">${this.placeStripHtml(g)}</div>
                <div class="place-group-members">
                    ${members.map(p => this.renderPlaceRow(p, { sub: true })).join('')}
                    <div class="place-group-more" hidden>
                        <button type="button" class="place-show-all">${this.escapeHtml(m.showAllN(members.length))}</button>
                    </div>
                </div>
            </div>`;
    },

    /** The group's ▸/▾, named by its town. */
    placeCaretHtml(town: string): string {
        return `<button type="button" class="place-caret" aria-expanded="false" aria-label="${this.escapeHtml(town)}"><span aria-hidden="true">▸</span></button>`;
    },

    /**
     * The group's strip, in its idle state: in a tree of the app's own the
     * split into town and house; in a research tree the research's way.
     */
    placeStripHtml(g: TownGroup): string {
        const m = strings.map;
        if (this.activeResearchId()) return this.placeResearchHtml(g.town, [g.townKey, ...g.members.map(x => x.key)], true);
        return `
            <div class="place-strip-idle">
                <span class="place-strip-note">${this.escapeHtml(m.housesNote)}</span>
                <button type="button" class="place-split-all secondary">${this.escapeHtml(m.splitAll(g.town, g.members.length))}</button>
            </div>`;
    },

    /**
     * A research tree's word about town and house: on this computer the link
     * to the research's fix (only for the towns the research names, when it
     * names them), elsewhere the way there in the research's menu.
     * `strip`: the group's strip (the sentence always); else a row's link only.
     */
    placeResearchHtml(town: string, keys: readonly string[], strip: boolean): string {
        const m = strings.map;
        const here = onComputer() && this.researchKnownHere();
        const { fix, towns } = this.streetPlacesFixNow();
        if (!here) {
            if (!strip) return '';
            const title = fix ? fixText(fix.title, getCurrentLanguage()) : '';
            return `<p class="place-research-note">${this.escapeHtml(m.researchElsewhere(title || m.researchElsewhereFix))}</p>`;
        }
        const url = this.activeResearchLink('fixes', { fix: STREET_PLACES_FIX });
        const keySet = new Set(keys);
        const folded = foldText(town);
        const named = !towns || !!fix?.towns?.some(t =>
            foldText(t.key) === folded || foldText(t.town) === folded || t.places.some(p => keySet.has(placeKey(p))));
        const link = url && named
            ? `<span class="place-research-link-line">
                   <button type="button" class="place-research-link">${this.escapeHtml(m.researchLink)} <span aria-hidden="true">↗</span></button>
                   ${fix && fix.count > 0 ? `<span class="place-research-count">${this.escapeHtml(m.researchCount(fix.count))}</span>` : ''}
               </span>`
            : '';
        if (!strip) return link;
        return `<div class="place-research"><p class="place-research-note">${this.escapeHtml(m.researchHere)}</p>${link}</div>`;
    },

    /** "Fix in the research": the research's terminal at its street-places fix. */
    openStreetPlacesFix(): void {
        if (this.researchFixesNow()?.reply.fixes.some(f => f.id === STREET_PLACES_FIX)) {
            this.runResearchFix(STREET_PLACES_FIX, 'open');
            return;
        }
        const url = this.activeResearchLink('fixes', { fix: STREET_PLACES_FIX });
        if (url) this.launchResearchLink(url);
    },

    renderPlaceRow(p: ManagerPlace, opts: { sub?: boolean; group?: TownGroup; meta?: string } = {}): string {
        const m = strings.map;
        const geo = p.geo;
        const box = geo
            ? `<div class="place-pin">
                   ${geo.byTown
                       ? `<span class="place-bytown"><span aria-hidden="true">⌖</span> ${this.escapeHtml(m.byTown(geo.byTown))}</span>
                          ${(geo.townChoices ?? 0) > 1 ? `<span class="place-nearest">${this.escapeHtml(m.nearestTown)}</span>` : ''}`
                       : `<span class="place-pin-label"><span class="place-pin-mark" aria-hidden="true">⌖</span> ${this.escapeHtml(geo.label ?? `${geo.lat.toFixed(3)}, ${geo.lon.toFixed(3)}`)}</span>`}
                   <span class="place-pin-acts">
                       <button type="button" class="place-change place-link-btn">${m.changePin}</button>
                       ${geo.byTown ? '' : `<button type="button" class="place-remove place-link-btn is-quiet">${m.removePin}</button>`}
                   </span>
               </div>`
            : `<div class="place-pin place-pin-none">
                   <span class="place-hint">${m.notOnMap}</span>
                   <button type="button" class="place-change place-find">${m.findOnMap}</button>
               </div>`;
        const g = opts.group;
        const houses = houseFieldCount(p.usage);
        const meta = opts.meta
            ?? (houses > 0 ? m.afterSplit(p.usage.personIds.length, houses) : m.usedBy(p.usage.personIds.length));
        const acts = [`<button type="button" class="place-rename-open place-act">✎ ${m.rename}</button>`];
        if (!g && this.placeSplittable(p.usage.display)) {
            if (this.activeResearchId()) {
                const parsed = townOfPlace(p.usage.display, managerKnown);
                const link = parsed ? this.placeResearchHtml(parsed.town, [p.key, placeKey(parsed.town)], false) : '';
                if (link) acts.push(link);
            } else {
                acts.push(`<button type="button" class="place-split-one place-act">${m.splitOne}</button>`);
            }
        }
        const cls = ['place-row'];
        if (!geo) cls.push('place-row-unplaced');
        if (opts.sub) cls.push('place-row-sub');
        if (g) cls.push('place-group-head');
        return `
            <div class="${cls.join(' ')}" data-key="${this.escapeHtml(p.key)}">
                <div class="place-grid">
                    <div class="place-main">
                        <div class="place-head">
                            ${g ? this.placeCaretHtml(g.town) : ''}
                            <span class="place-title">${this.escapeHtml(p.usage.display)}</span>
                            <span class="place-count">${this.escapeHtml(meta)}</span>
                            ${g?.unplacedCount ? `<span class="place-unplaced-tag">${this.escapeHtml(m.unplacedN(g.unplacedCount))}</span>` : ''}
                        </div>
                        <div class="place-acts">${acts.join('')}</div>
                        <div class="place-rename-form" hidden>
                            <label class="place-field-label">${m.newName}
                                <input type="text" class="place-new-name" value="${this.escapeHtml(p.usage.display)}" autocomplete="off" spellcheck="false">
                            </label>
                        </div>
                    </div>
                    ${box}
                </div>
                <div class="place-rename-preview" hidden></div>
                <div class="place-split-card" hidden></div>
                <div class="place-search" hidden>
                    <label class="place-field-label">${m.searchUnder}
                        <span class="place-search-row">
                            <input type="text" class="place-query" value="${this.escapeHtml(p.usage.display)}" autocomplete="off" spellcheck="false">
                            <button type="button" class="place-search-go">${m.search}</button>
                        </span>
                    </label>
                    <div class="place-attach-note"><span class="place-attach-mark" aria-hidden="true">ⓘ</span><span>${m.attachOnly}</span></div>
                    <div class="place-results"></div>
                </div>
                <div class="place-offer" hidden></div>
            </div>`;
    },

    /** A place the split takes on its own: a house recognised by the research's rules, not a number alone. */
    placeSplittable(display: string): boolean {
        const parsed = townOfPlace(display, managerKnown);
        return !!parsed && !parsed.bare;
    },

    bindPlaceRow(row: HTMLElement): void {
        const key = row.getAttribute('data-key') ?? '';
        const search = row.querySelector('.place-search') as HTMLElement;
        const query = row.querySelector('.place-query') as HTMLInputElement;
        const go = row.querySelector('.place-search-go') as HTMLButtonElement;
        const run = (): void => { void this.searchPlaceFromManager(key, query.value, row); };
        go.onclick = run;
        query.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } };

        (row.querySelector('.place-change') as HTMLButtonElement).onclick = () => {
            search.hidden = false;
            query.focus();
            query.select();
        };
        const remove = row.querySelector('.place-remove') as HTMLButtonElement | null;
        if (remove) remove.onclick = () => this.removePlacePin(key);
        (row.querySelector('.place-rename-open') as HTMLButtonElement).onclick = () => this.openPlaceRename(row, key);
        const split = row.querySelector('.place-split-one') as HTMLButtonElement | null;
        if (split) split.onclick = () => this.openPlaceSplitOne(row, key);
        const research = row.querySelector('.place-research-link') as HTMLButtonElement | null;
        if (research) research.onclick = () => this.openStreetPlacesFix();
    },

    bindPlaceGroup(group: HTMLElement): void {
        const townKey = group.dataset.town ?? '';
        const caret = group.querySelector('.place-caret') as HTMLButtonElement | null;
        const toggle = (): void => {
            if (expandedTowns.has(townKey)) expandedTowns.delete(townKey);
            else expandedTowns.add(townKey);
            this.applyPlacesFilter();
        };
        if (caret) caret.onclick = toggle;
        // The heading's name opens the group too (a town without its own place has nothing else).
        const name = group.querySelector('.place-group-title .place-title, .place-group-head .place-title') as HTMLElement | null;
        if (name) name.onclick = toggle;
        (group.querySelector('.place-show-all') as HTMLButtonElement).onclick = () => {
            allShownTowns.add(townKey);
            this.applyPlacesFilter();
        };
        this.bindPlaceStrip(group);
    },

    bindPlaceStrip(group: HTMLElement): void {
        const strip = group.querySelector('.place-group-strip') as HTMLElement;
        const splitAll = strip.querySelector('.place-split-all') as HTMLButtonElement | null;
        if (splitAll) splitAll.onclick = () => this.startGroupSplit(group);
        const research = strip.querySelector('.place-research-link') as HTMLButtonElement | null;
        if (research) research.onclick = () => this.openStreetPlacesFix();
    },

    /** Put the group's strip back to its idle state. */
    resetPlaceStrip(group: HTMLElement): void {
        const g = managerGroups.get(group.dataset.town ?? '');
        if (!g) return;
        (group.querySelector('.place-group-strip') as HTMLElement).innerHTML = this.placeStripHtml(g);
        this.bindPlaceStrip(group);
    },

    /** "Split all numbers in X…": numbers alone ask first whether they are houses, then the preview. */
    startGroupSplit(group: HTMLElement): void {
        const g = managerGroups.get(group.dataset.town ?? '');
        if (!g) return;
        const m = strings.map;
        const strip = group.querySelector('.place-group-strip') as HTMLElement;
        const keys = g.members.map(x => x.key);
        if (!g.hasBare) {
            this.showPlaceSplitPreview(strip, g.town, keys, undefined, () => this.resetPlaceStrip(group));
            return;
        }
        const { bareExamples } = townHousePlaces(DataManager.getData(), g.townKey, managerPlaces);
        strip.innerHTML = `
            <div class="place-bare-card" role="group">
                <p class="place-card-head">${this.escapeHtml(m.bareQuestion(g.town))}</p>
                <div class="place-bare-examples">${bareExamples.map(e => `<span>${this.escapeHtml(e.display)}</span>`).join('')}</div>
                <p class="place-card-note">${this.escapeHtml(m.bareExplain)}</p>
                <div class="place-card-buttons">
                    <button type="button" class="place-bare-yes primary">${this.escapeHtml(m.bareYes)}</button>
                    <button type="button" class="place-bare-no secondary">${this.escapeHtml(m.bareNo)}</button>
                </div>
            </div>`;
        (strip.querySelector('.place-bare-no') as HTMLButtonElement).onclick = () => this.resetPlaceStrip(group);
        (strip.querySelector('.place-bare-yes') as HTMLButtonElement).onclick = () =>
            this.showPlaceSplitPreview(strip, g.town, keys, new Set([g.townKey]), () => this.resetPlaceStrip(group));
        (strip.querySelector('.place-bare-yes') as HTMLButtonElement).focus();
    },

    /** A row's own split (one recognised house place). */
    openPlaceSplitOne(row: HTMLElement, key: string): void {
        const usage = managerPlaces.get(key);
        const parsed = usage ? townOfPlace(usage.display, managerKnown) : null;
        if (!usage || !parsed) return;
        const card = row.querySelector('.place-split-card') as HTMLElement;
        card.hidden = false;
        this.showPlaceSplitPreview(card, parsed.town, [key], undefined, () => {
            card.hidden = true;
            card.innerHTML = '';
        }, [{ key, display: usage.display, town: parsed.town, house: parsed.house, bare: false }]);
    },

    /**
     * The split's preview into `host`: three examples, how many entries and
     * people change, what stays as it is, then Split N · Cancel. The counts
     * come from the same dry run the change makes.
     */
    showPlaceSplitPreview(host: HTMLElement, town: string, keys: readonly string[], bareTowns: ReadonlySet<string> | undefined,
        cancel: () => void, examples?: TownHousePlace[]): void {
        const m = strings.map;
        const data = DataManager.getData();
        const dry = splitPlaceHouses(data, keys, { bareTowns });
        const ex = examples ?? townHousePlaces(data, placeKey(town), managerPlaces).examples
            .filter(e => !e.bare || bareTowns?.has(placeKey(e.town)));
        host.innerHTML = `
            <div class="place-split-preview" role="group">
                <p class="place-card-head">${this.escapeHtml(m.splitHead(town, keys.length))}</p>
                <div class="place-split-examples">
                    ${ex.map(e => `<s>${this.escapeHtml(e.display)}</s><span><span class="place-arrow" aria-hidden="true">→ </span>${this.escapeHtml(e.town)} · <strong>${this.escapeHtml(e.house)}</strong></span>`).join('')}
                </div>
                <p class="place-card-text">${this.escapeHtml(m.splitCount(dry.changed, dry.persons))}</p>
                ${dry.skipped > 0 ? `<p class="place-card-warn">${this.escapeHtml(m.splitSkipped(dry.skipped))}</p>` : ''}
                ${dry.noHouseField > 0 ? `<p class="place-card-warn">${this.escapeHtml(m.splitNoHouseField(dry.noHouseField))}</p>` : ''}
                <p class="place-card-note">${this.escapeHtml(m.undoableUndo(strings.undo.undo))}</p>
                <div class="place-card-buttons">
                    <button type="button" class="place-split-go primary"${dry.changed === 0 ? ' disabled' : ''}>${this.escapeHtml(m.splitGo(dry.changed))}</button>
                    <button type="button" class="place-split-cancel secondary">${this.escapeHtml(strings.buttons.cancel)}</button>
                </div>
            </div>`;
        (host.querySelector('.place-split-cancel') as HTMLButtonElement).onclick = cancel;
        const go = host.querySelector('.place-split-go') as HTMLButtonElement;
        go.onclick = () => {
            const res = DataManager.splitPlacesIntoHouses(town, keys, bareTowns);
            if (res.changed === 0) return;
            this.showToast(m.splitDone(res.changed, town));
            this.refreshPlacesManager(undefined, false);
        };
        go.focus();
    },

    /**
     * "✎ Rename…": the new name in the row and, under it, what the rewrite
     * touches — counted once, as the dialog opened the field — with the old
     * name struck through and the new one live as it is typed.
     */
    openPlaceRename(row: HTMLElement, key: string): void {
        const usage = managerPlaces.get(key);
        if (!usage) return;
        const m = strings.map;
        const head = row.querySelector('.place-head') as HTMLElement;
        const acts = row.querySelector('.place-acts') as HTMLElement;
        const form = row.querySelector('.place-rename-form') as HTMLElement;
        const input = row.querySelector('.place-new-name') as HTMLInputElement;
        const preview = row.querySelector('.place-rename-preview') as HTMLElement;
        const { uses, persons } = countPlaceUses(DataManager.getData(), key);
        const keys = allPlaceKeys();
        head.hidden = true;
        acts.hidden = true;
        form.hidden = false;
        preview.hidden = false;
        preview.innerHTML = `
            <p class="place-card-head">${this.escapeHtml(m.renameCount(uses, persons))}</p>
            <p class="place-rename-line"><s>${this.escapeHtml(usage.display)}</s><span class="place-arrow" aria-hidden="true">→</span><strong class="place-rename-to"></strong></p>
            <p class="place-card-warn place-rename-merge" hidden>${this.escapeHtml(m.renameMerge)}</p>
            <p class="place-card-note">${this.escapeHtml(m.undoableUndo(strings.undo.undo))}</p>
            <div class="place-card-buttons">
                <button type="button" class="place-rename-go primary" disabled>${this.escapeHtml(m.renameGo(uses))}</button>
                <button type="button" class="place-rename-cancel secondary">${this.escapeHtml(strings.buttons.cancel)}</button>
            </div>`;
        const to = preview.querySelector('.place-rename-to') as HTMLElement;
        const merge = preview.querySelector('.place-rename-merge') as HTMLElement;
        const go = preview.querySelector('.place-rename-go') as HTMLButtonElement;
        // Rename only lights up once the name actually differs — no accidental
        // tree-wide rewrite from clicking around.
        const sync = (): void => {
            const value = input.value.trim();
            to.textContent = value;
            const target = placeKey(value);
            merge.hidden = !value || target === key || !keys.has(target);
            go.disabled = !value || value === usage.display.trim();
        };
        const cancel = (): void => {
            preview.hidden = true;
            preview.innerHTML = '';
            form.hidden = true;
            head.hidden = false;
            acts.hidden = false;
            input.value = usage.display;
            (row.querySelector('.place-rename-open') as HTMLButtonElement).focus();
        };
        input.oninput = sync;
        input.onkeydown = (e) => {
            if (e.key === 'Escape') {
                // The rename goes, the dialog stays.
                e.preventDefault();
                e.stopPropagation();
                cancel();
            } else if (e.key === 'Enter' && !go.disabled) {
                e.preventDefault();
                go.click();
            }
        };
        (preview.querySelector('.place-rename-cancel') as HTMLButtonElement).onclick = cancel;
        go.onclick = () => this.renamePlaceFromManager(key, input.value);
        sync();
        input.focus();
        input.select();
    },

    /** Open the dialog at a place: its row (search open), or a town's group opened. */
    focusPlaceInManager(focusKey: string): void {
        const modal = document.getElementById('places-modal');
        if (!modal) return;
        const townKey = focusKey.startsWith(TOWN_POINT_PREFIX) ? focusKey.slice(TOWN_POINT_PREFIX.length) : focusKey;
        const group = managerGroups.get(townKey);
        const memberOf = group ? null : [...managerGroups.values()].find(g => g.members.some(x => x.key === focusKey));
        const resetFilter = (): void => {
            this.placesFilter = { query: '', unplacedOnly: false };
            const input = modal.querySelector('#places-filter') as HTMLInputElement | null;
            if (input) input.value = '';
            modal.querySelector('#places-unplaced')?.setAttribute('aria-pressed', 'false');
        };
        if (group) {
            expandedTowns.add(townKey);
            this.applyPlacesFilter();
            const el = modal.querySelector<HTMLElement>(`.place-group[data-town="${CSS.escape(townKey)}"]`);
            if (el?.hidden) {
                resetFilter();
                this.applyPlacesFilter();
            }
            el?.scrollIntoView({ block: 'start' });
            return;
        }
        if (memberOf) {
            expandedTowns.add(memberOf.townKey);
            if (memberOf.members.findIndex(x => x.key === focusKey) >= GROUP_FIRST) allShownTowns.add(memberOf.townKey);
            this.applyPlacesFilter();
        }
        const row = modal.querySelector<HTMLElement>(`.place-row[data-key="${CSS.escape(townKey)}"]`);
        // Opened on a place the search or the chip hides: the whole list again.
        if (row?.hidden) {
            resetFilter();
            this.applyPlacesFilter();
        }
        // Open its search first (it focuses the query), then bring the
        // whole, now taller row into view.
        (row?.querySelector('.place-change') as HTMLButtonElement | null)?.click();
        row?.scrollIntoView({ block: 'center' });
    },

    /** What each row's search looks in: its names in the tree and, with a history of places, its other names. */
    refreshPlacesFilterText(): void {
        const modal = document.getElementById('places-modal');
        if (!modal) return;
        const rows = [...modal.querySelectorAll<HTMLElement>('.place-row[data-key]')];
        const aliases = this.placesHistoryAliases(rows.map(r => r.dataset.key ?? ''));
        for (const row of rows) {
            const key = row.dataset.key ?? '';
            const usage = managerPlaces.get(key);
            row.dataset.search = usage ? placeFilterText(key, usage, aliases.get(key)) : placeKey(key);
        }
        for (const group of modal.querySelectorAll<HTMLElement>('.place-group')) {
            const g = managerGroups.get(group.dataset.town ?? '');
            const head = group.querySelector<HTMLElement>('.place-group-head');
            group.dataset.search = [head?.dataset.search ?? '', placeKey(g?.town ?? ''), g?.townKey ?? ''].filter(Boolean).join(' | ');
        }
        this.applyPlacesFilter();
    },

    /**
     * Put the items in the order of the chosen sort. The elements move, they
     * are not redrawn: an open search in a row, its results and a typed new
     * name all stay. A group moves whole; inside it the order stays natural.
     */
    applyPlacesSort(): void {
        const list = document.querySelector<HTMLElement>('#places-modal .places-list');
        if (!list) return;
        const geos = DataManager.getData().places ?? {};
        const rows = new Map([...list.querySelectorAll<HTMLElement>(':scope > .place-row[data-key]')]
            .map(r => [r.dataset.key ?? '', r] as const));
        const groups = new Map([...list.querySelectorAll<HTMLElement>(':scope > .place-group')]
            .map(g => [g.dataset.town ?? '', g] as const));
        const places = [...managerPlaces].map(([key, usage]) => ({ key, usage, geo: geos[key] }));
        for (const item of this.sortedManagerItems(places)) {
            const el = 'group' in item ? groups.get(item.group.townKey) : rows.get(item.key);
            if (el) list.appendChild(el);
        }
    },

    /**
     * Show the rows the search and the "No location" chip let through; the
     * count and the empty state. A group shows whole (as opened or closed)
     * when its town matches and the chip is off; else only its houses that
     * pass, opened.
     */
    applyPlacesFilter(): void {
        const modal = document.getElementById('places-modal');
        if (!modal) return;
        const f = this.placesFilter;
        const pass = (row: HTMLElement): boolean => (!f.unplacedOnly || row.classList.contains('place-row-unplaced'))
            && placeMatchesFilter(row.dataset.search ?? '', f.query);
        const all = modal.querySelectorAll('.place-row[data-key]').length;
        let found = 0;
        for (const row of modal.querySelectorAll<HTMLElement>('.places-list > .place-row[data-key]')) {
            row.hidden = !pass(row);
            if (!row.hidden) found++;
        }
        for (const group of modal.querySelectorAll<HTMLElement>('.place-group')) {
            const townKey = group.dataset.town ?? '';
            const head = group.querySelector<HTMLElement>(':scope > .place-group-head');
            const members = [...group.querySelectorAll<HTMLElement>('.place-row-sub')];
            const more = group.querySelector<HTMLElement>('.place-group-more')!;
            const headMatch = placeMatchesFilter(group.dataset.search ?? '', f.query);
            let open: boolean;
            if (!f.unplacedOnly && headMatch) {
                open = expandedTowns.has(townKey);
                const showAll = allShownTowns.has(townKey);
                members.forEach((row, i) => { row.hidden = !open || (!showAll && i >= GROUP_FIRST); });
                more.hidden = !open || showAll || members.length <= GROUP_FIRST;
                group.hidden = false;
                found += (head ? 1 : 0) + members.length;
            } else {
                const shown = members.filter(row => (!f.unplacedOnly || row.classList.contains('place-row-unplaced'))
                    && (headMatch || placeMatchesFilter(row.dataset.search ?? '', f.query)));
                const set = new Set(shown);
                members.forEach(row => { row.hidden = !set.has(row); });
                more.hidden = true;
                group.hidden = shown.length === 0;
                open = !group.hidden;
                found += shown.length;
            }
            if (head) head.hidden = group.hidden;
            group.classList.toggle('is-open', open);
            const caret = group.querySelector<HTMLElement>('.place-caret');
            if (caret) {
                caret.setAttribute('aria-expanded', String(open));
                caret.firstElementChild!.textContent = open ? '▾' : '▸';
            }
        }
        const filtering = !!f.query.trim() || f.unplacedOnly;
        const count = modal.querySelector('#places-filter-count');
        if (count) count.textContent = filtering ? strings.map.filterCount(found, all) : '';
        const clear = modal.querySelector<HTMLElement>('#places-filter-clear');
        if (clear) clear.hidden = !f.query;
        const none = modal.querySelector<HTMLElement>('#places-filter-none');
        if (none) none.hidden = found > 0;
    },

    closePlacesManager(): void {
        document.getElementById('places-modal')?.remove();
        pendingOffer = null;
        this.dialogStack = this.dialogStack.filter(d => d !== 'places-modal');
        // Return to whoever opened the manager (tree manager), per stack rules.
        const parent = this.dialogStack[this.dialogStack.length - 1];
        if (parent) this.openDialogById(parent);
    },

    /** Redraw the dialog in place, keeping the map behind it in step. */
    refreshPlacesManager(focusKey?: string, keepOffer = false): void {
        if (!keepOffer) pendingOffer = null;
        this.mapCenter = null;  // what is on the map changed — reframe it
        TreeRenderer.render();
        if (document.getElementById('places-modal')) {
            this.showPlacesManager(focusKey, this.placesManagerParent ?? undefined, this.placesManagerScope, { keepFilter: true });
        }
    },

    /** The tree changed under the open dialog (Undo, Redo): redraw it, if it is open. */
    placesManagerTreeChanged(): void {
        if (!document.getElementById('places-modal')) return;
        pendingOffer = null;
        this.showPlacesManager(undefined, this.placesManagerParent ?? undefined, this.placesManagerScope, { keepFilter: true });
    },

    renamePlaceFromManager(key: string, newName: string): void {
        const changed = DataManager.renamePlaceTo(key, newName);
        if (changed === 0) return;
        this.showToast(strings.map.renamed(changed));
        this.refreshPlacesManager();
    },

    removePlacePin(key: string): void {
        DataManager.clearPlaceGeo(key);
        this.refreshPlacesManager();
    },

    /** Sweep coordinate entries nothing in the tree points at any more. Confirms
     *  with the count, then deletes via the normal mutation path (undo + audit
     *  + Undo toast) and redraws the manager. */
    async cleanOrphanPlaces(): Promise<void> {
        const count = orphanedPlaceKeys(DataManager.getData()).length;
        if (count === 0) return;
        if (!await this.showConfirm(strings.map.cleanOrphansConfirm(count), strings.danger.cleanPlacesTitle(count),
            { confirmLabel: strings.danger.cleanPlaces, variant: 'danger' })) return;
        const removed = DataManager.clearOrphanPlaces();
        if (removed > 0) this.showToast(strings.map.cleanOrphansDone(removed));
        this.refreshPlacesManager();
    },

    /**
     * Search under whatever name was typed and offer what comes back. Nothing
     * found and the name holds a house: the town is looked up instead (as the
     * automatic run does) and its location attached "by the town".
     */
    async searchPlaceFromManager(key: string, query: string, row: HTMLElement): Promise<void> {
        const results = row.querySelector('.place-results') as HTMLElement;
        const text = query.trim();
        if (!text || this.placeSearchBusy) return;
        // The typed name goes out too, so the same consent rule applies.
        if (!await this.confirmGeocoding(1)) return;

        results.innerHTML = `<span class="place-hint">${strings.map.searching}</span>`;
        this.placeSearchBusy = true;
        const data = DataManager.getData();
        let candidates: GeocodeCandidate[];
        let byTown: PlaceGeo | null = null;
        try {
            candidates = await searchPlaceCandidates(text);
            if (candidates.length === 0) {
                const parsed = townOfPlace(text, knownStreets(data));
                if (parsed) byTown = await geocodeTown(parsed.town, { centroid: placesCentroid(data.places) });
            }
        } finally {
            this.placeSearchBusy = false;
        }
        if (byTown?.byTown) {
            this.attachPlaceByTown(key, byTown, byTown.byTown);
            return;
        }
        if (candidates.length === 0) {
            results.innerHTML = `<span class="place-hint">${strings.map.noCandidates}</span>`;
            return;
        }

        const kindText = strings.map.hitKind;
        results.innerHTML = candidates.map((c, i) => {
            const { name, region } = hitLabelParts(c.geo.label);
            const sub = [kindText(hitKind(c)), region].filter(Boolean).join(' · ');
            return `
                <button type="button" class="place-candidate" data-index="${i}">
                    <strong>${this.escapeHtml(name || `${c.geo.lat}, ${c.geo.lon}`)}</strong>
                    ${sub ? `<span class="place-candidate-sub">${this.escapeHtml(sub)}</span>` : ''}
                </button>`;
        }).join('');
        results.querySelectorAll<HTMLButtonElement>('.place-candidate').forEach(btn => {
            btn.onclick = () => {
                const c = candidates[Number(btn.dataset.index)];
                // A settlement for a place with a house: the town's location, "by the town".
                const usage = managerPlaces.get(key);
                const parsed = c.settlement && usage ? townOfPlace(usage.display, managerKnown) : null;
                if (parsed) {
                    this.attachPlaceByTown(key, { ...c.geo, byTown: parsed.town }, parsed.town);
                    return;
                }
                // An exact point: no longer "by the town".
                DataManager.setPlaceGeos(new Map([[key, c.geo]]));
                this.showToast(strings.map.matched(c.geo.label ?? ''));
                this.refreshPlacesManager();
            };
        });
    },

    /** Attach a location found by the town and offer it for the town's other house places without one. */
    attachPlaceByTown(key: string, geo: PlaceGeo, town: string): void {
        DataManager.setPlaceGeos(new Map([[key, geo]]));
        pendingOffer = { key, town, others: otherUnplacedOfTown(town, key), geo };
        this.refreshPlacesManager(undefined, true);
    },

    /** The offer card under its row, after the redraw that showed the new location. */
    showPendingOffer(): void {
        if (offerTimer !== null) { clearTimeout(offerTimer); offerTimer = null; }
        const offer = pendingOffer;
        if (!offer) return;
        const modal = document.getElementById('places-modal');
        const row = modal?.querySelector<HTMLElement>(`.place-row[data-key="${CSS.escape(offer.key)}"]`);
        const card = row?.querySelector<HTMLElement>('.place-offer');
        if (!row || !card) return;
        const m = strings.map;
        const usage = managerPlaces.get(offer.key);
        const n = offer.others.length;
        card.hidden = false;
        card.innerHTML = `
            <p class="place-offer-done"><span aria-hidden="true">✓ </span>${this.escapeHtml(m.attachedByTown(usage?.display ?? offer.town))}</p>
            ${n > 0 ? `
                <div class="place-card-buttons">
                    <button type="button" class="place-offer-go primary">${this.escapeHtml(m.useForOthers(offer.town, n))}</button>
                    <button type="button" class="place-offer-skip secondary">${this.escapeHtml(m.justThis)}</button>
                </div>
                <p class="place-card-note">${this.escapeHtml(m.othersNote)}</p>` : ''}`;
        const dismiss = (): void => {
            if (pendingOffer === offer) pendingOffer = null;
            card.hidden = true;
            card.innerHTML = '';
        };
        if (n === 0) {
            offerTimer = window.setTimeout(() => { offerTimer = null; dismiss(); }, OFFER_DONE_MS);
            return;
        }
        (card.querySelector('.place-offer-skip') as HTMLButtonElement).onclick = dismiss;
        (card.querySelector('.place-offer-go') as HTMLButtonElement).onclick = () => {
            const geo: PlaceGeo = { ...offer.geo, byTown: offer.town };
            // Only those still without a location (an Undo in between may have changed it).
            const places = DataManager.getData().places ?? {};
            const todo = offer.others.filter(k => !places[k]);
            pendingOffer = null;
            if (todo.length === 0) { dismiss(); return; }
            DataManager.setPlaceGeos(new Map(todo.map(k => [k, geo])), strings.undo.attachByTown(offer.town));
            this.showToast(m.othersDone(todo.length, offer.town));
            this.refreshPlacesManager();
        };
        row.scrollIntoView({ block: 'nearest' });
    },
});
