/**
 * A place without a location on the person card (spec 034 §8): its small
 * state badge after the name in the life timeline, and the place menu a
 * click on it opens — a popover by the place (300 px), a bottom sheet on a
 * phone. What the menu offers is place-actions.ts' placeMenu (by state and
 * by where the research is); a place with a location still opens the map.
 */

import { DataManager } from '../data.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { collectPlaces, placeKey } from '../places.js';
import { placeStateBadge, placeStateText, PLACE_STATE_GLYPHS, type PlaceIdentity } from '../place-identity.js';
import { placeMenu, placeMenuBadge, type PlaceMenuAction } from '../place-actions.js';
import { MQ_MOBILE } from '../breakpoints.js';
import { uiModule } from './module.js';

/** A place of the open card's timeline: the map point it is drawn as, its location, its state. */
interface LifePlace {
    key: string;
    hasGeo: boolean;
    id?: PlaceIdentity;
}

/** The places of the timeline as last drawn (placeKey → state); null: worked out per place. */
let lifePlaces: Map<string, LifePlace> | null = null;

/** How old the research's places may be when a card opens before it reads them again. */
const LIVE_MAX_AGE_MS = 15000;

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const placeMenuMethods = uiModule({
    /**
     * Before the timeline is drawn: its places with their states (a spelling
     * joined to a place on the map counts as located), and the research's
     * places read when they are older than a moment.
     */
    prepareLifelinePlaces(places: readonly (string | undefined)[]): void {
        const data = DataManager.getData();
        const keys = [...new Set(places.filter((p): p is string => !!p?.trim()).map(p => placeKey(p)))];
        const own = (k: string): boolean => !!data.places?.[k];
        const keyOf = keys.some(k => !own(k)) ? this.mapSpellings(collectPlaces(data)).keyOf : new Map<string, string>();
        const unlocated = keys.filter(k => !own(keyOf.get(k) ?? k));
        const ids = unlocated.length ? this.placeIdentitiesNow(unlocated) : new Map<string, PlaceIdentity>();
        lifePlaces = new Map(keys.map(k => {
            const point = keyOf.get(k) ?? k;
            return [k, { key: point, hasGeo: own(point), id: ids.get(k) }];
        }));
        if (unlocated.length) void this.refreshPlacesLive(LIVE_MAX_AGE_MS);
    },

    /** A place of the timeline as drawn (worked out on its own when it was not prepared). */
    lifelinePlace(place: string): LifePlace {
        const key = placeKey(place);
        const known = lifePlaces?.get(key);
        if (known) return known;
        return { key, hasGeo: !!DataManager.getData().places?.[key] };
    },

    /** The small state badge of a place without a location ('' none). */
    lifelinePlaceBadge(place: string): string {
        const id = this.lifelinePlace(place).id;
        if (!id || !placeMenuBadge(id)) return '';
        return placeStateBadge(id, getCurrentLanguage(), { small: true, className: 'pm-place-badge' });
    },

    /** The research's places changed: an open card redraws its places' badges (not under an open menu). */
    refreshPersonPlaceStates(): void {
        const modal = document.getElementById('person-modal');
        if (!this.currentId || !modal?.classList.contains('active')) return;
        if (document.querySelector('.place-menu')) return;
        if (!document.querySelector('#pm-lifeline-body .pm-place-badge, #pm-lifeline-body .pm-lifeline-link.is-place')) return;
        this.renderPersonLifeline(this.currentId, true);
    },

    /**
     * The place menu of a place without a location: by its state, by the
     * place on the card; a phone opens it as a sheet. Without a state to
     * show (an older tree read), the Places dialog on the place as before.
     */
    openPlaceMenu(place: string, anchor: HTMLElement): void {
        if (anchor.getAttribute('aria-expanded') === 'true') { this.closeLifelineHistoryPopups(); return; }
        this.closeLifelineHistoryPopups();
        const info = this.lifelinePlace(place);
        const id = info.id;
        if (!id || !placeMenuBadge(id)) {
            this.leavePersonModalThen(() => this.showPlacesManager(info.key, undefined, 'tree'));
            return;
        }
        const lang = getCurrentLanguage();
        const menu = placeMenu(id, this.placesResearchContext().access);
        const s = strings.places;
        const labels: Record<PlaceMenuAction, string> = {
            answer: s.dialog.answer, find: strings.map.findOnMap, look: s.research.look,
            lookAgain: s.research.lookAgain, unqueue: s.research.unqueue, places: s.menu.openPlaces,
        };
        const stateLine = placeStateText(id, lang) + (id.state === 'undet' && id.why ? `: ${id.why}` : '');
        const head = `<div class="place-menu-head" role="presentation"><strong class="place-menu-name">${esc(place)}</strong>`
            + `<span class="place-menu-state" data-state="${id.state}"><span aria-hidden="true">${PLACE_STATE_GLYPHS[id.state]}</span> ${esc(stateLine)}</span></div>`;
        const items = menu.items.map(it => `<button type="button" role="menuitem" class="place-menu-item${it.primary ? ' is-primary' : ''}" data-action="${it.action}">`
            + `${it.research ? '<span class="place-menu-diamond" aria-hidden="true">◆</span> ' : ''}${esc(labels[it.action])}</button>`).join('');
        const note = menu.note ? `<p class="place-menu-note">${esc(s.menu.note)}</p>` : '';
        const label = s.menu.label(place);
        const run = (action: PlaceMenuAction): void => this.runPlaceMenu(action, info.key, id);

        if (window.matchMedia(MQ_MOBILE).matches) {
            const sheet = this.showLifelineHistorySheet('place-menu place-menu-sheet', 'menu', label,
                `${head}<div class="bottom-sheet-items">${items}</div>${note}`);
            sheet.addEventListener('click', (e) => {
                const row = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
                if (!row) return;
                this.hideBottomSheet();
                run(row.dataset.action as PlaceMenuAction);
            });
            sheet.addEventListener('keydown', (e) => placeMenuKeys(e, sheet));
            sheet.querySelector<HTMLElement>('[data-action]')?.focus({ preventScroll: true });
            return;
        }

        const el = document.createElement('div');
        el.className = 'pm-lifeline-hmenu place-menu';
        el.setAttribute('role', 'menu');
        el.setAttribute('aria-label', label);
        el.innerHTML = head + items + note;
        el.addEventListener('click', (e) => {
            const row = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
            if (!row) return;
            e.stopPropagation();
            this.closeLifelineHistoryPopups();
            run(row.dataset.action as PlaceMenuAction);
        });
        this.openLifelineHistoryPopup(el, anchor, (e) => placeMenuKeys(e, el));
        el.querySelector<HTMLElement>('[data-action]')?.focus();
    },

    /** One step of the place menu. */
    runPlaceMenu(action: PlaceMenuAction, key: string, id: PlaceIdentity): void {
        switch (action) {
            case 'answer':
                this.leavePersonModalThen(() => this.openWaitingPlaces(id.waitingId));
                return;
            case 'find':
                this.leavePersonModalThen(() => this.showPlacesManager(key, undefined, 'tree'));
                return;
            case 'places':
                this.leavePersonModalThen(() => this.showPlacesManager(key, undefined, 'tree', { focus: id.state === 'undet' ? 'why' : 'row' }));
                return;
            case 'look':
            case 'lookAgain':
                void this.queuePlaces([key], false);
                return;
            case 'unqueue':
                void this.unqueuePlace(key);
                return;
        }
    },
});

/** ↑ / ↓ (and Home / End) over the menu's items. */
function placeMenuKeys(e: KeyboardEvent, menu: HTMLElement): void {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const rows = [...menu.querySelectorAll<HTMLElement>('[data-action]')];
    if (!rows.length) return;
    e.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1
        : e.key === 'ArrowDown' ? (at + 1) % rows.length : (at - 1 + rows.length) % rows.length;
    rows[next].focus();
}
