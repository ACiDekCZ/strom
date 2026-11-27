/**
 * The "Family houses" layer of the Map tab (spec 030 §9): the switch after the
 * kinds, the houses with a point of their own as small pills with their
 * number, the house bubble (its state and action, its people, House page ›,
 * Houses in this town ›, Move the point) and "On the map" of the house page.
 *
 * A house's point is the person's (placed or confirmed) at once; the
 * research's comes with the house's result, read over the bridge in the
 * background (two at a time, again only when the house's row changes) —
 * nothing waits for it. The map (src/ui/map-ui.ts) draws the points with its
 * markers and keeps the open bubble; the rules are src/map-houses.ts.
 */

import { DataManager } from '../data.js';
import { SettingsManager } from '../settings.js';
import { strings } from '../strings.js';
import { TreeRenderer } from '../renderer.js';
import { collectHouses, houseTitle, type TreeHouse } from '../houses.js';
import { houseGroupIds } from '../houses-view.js';
import { fetchHouse, houseCache, type HouseResearch } from '../house-bridge.js';
import { pointInViewport } from '../map.js';
import { HOUSE_MAP_MAX_ZOOM, houseElsewhereHtml } from '../house-map.js';
import { housesApartFromTowns, housesWithPoint, mapHouseLocation, mapHousePoints, mapHouseSummary, mapHousesSwitch, type MapHousePoint } from '../map-houses.js';
import { houseStateHtml } from './house-state-ui.js';
import { requestHouseMapMove } from './house-map-ui.js';
import { getCurrentLanguage } from '../strings.js';
import type { PersonId, StromData } from '../types.js';
import { uiModule } from './module.js';

/** The open bubble's key of a house (map-ui's openPoint): never a place's key. */
export const MAP_HOUSE_BUBBLE = '\u0003house:';
/** The zoom "On the map" of the house page opens at. */
export const MAP_HOUSE_ZOOM = 16;
/** People shown in a house bubble before "+ N more". */
const BUBBLE_PEOPLE = 5;
/** The research's results read for the map at the same time. */
const READ_AT_ONCE = 2;

function esc(text: string): string {
    return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** The tree's houses, worked out once per data revision; `byId` also by the numbers joined into them. */
let housesNow: { data: StromData; rev: number; houses: TreeHouse[]; byId: Map<string, TreeHouse> } | null = null;
function treeHousesNow(): { houses: TreeHouse[]; byId: Map<string, TreeHouse> } {
    const data = DataManager.getData();
    const rev = DataManager.getRevision();
    if (housesNow?.data !== data || housesNow.rev !== rev) {
        const houses = collectHouses(data);
        const byId = new Map<string, TreeHouse>();
        for (const h of houses) for (const id of houseGroupIds(h)) if (!byId.has(id)) byId.set(id, h);
        for (const h of houses) byId.set(h.id, h);
        housesNow = { data, rev, houses, byId };
    }
    return housesNow;
}

/** The houses' results asked for over a bridge: `<base>\0<key>` → the row's state and time it was asked at. */
const asked = new Map<string, string>();
const queue: { base: string; key: string }[] = [];
let reading = 0;
/** Bumped by every result that came: the points worked out from the results are worked out again. */
let readCount = 0;
let redrawQueued = false;

/** The points of the houses now (every house with a point), kept until the tree, the list or a result changes. */
let pointsNow: { sig: string; points: MapHousePoint[] } | null = null;

export const mapHousesMethods = uiModule({
    /** The research's result of a house for its point: the one read, else asked for in the background. */
    mapHouseResearch(house: TreeHouse): HouseResearch | null {
        const b = this.houseResearchBridge();
        const row = b ? this.houseResearchRow(house) : null;
        if (!b || !row) return null;
        const got = houseCache(b.base).get(row.key) ?? null;
        // A house the research has a record of: its result once, again when its row changes.
        const mark = `${row.state}|${row.at ?? ''}`;
        const id = `${b.base}\u0000${row.key}`;
        if (row.id && asked.get(id) !== mark) {
            asked.set(id, mark);
            queue.push({ base: b.base, key: row.key });
            this.readMapHouses();
        }
        return got;
    },

    /** Read the asked results, two at a time; the map redraws once they came. */
    readMapHouses(): void {
        while (reading < READ_AT_ONCE && queue.length) {
            const next = queue.shift()!;
            reading++;
            void fetchHouse(next.base, next.key).then(r => {
                reading--;
                if (r.ok) readCount++;
                this.readMapHouses();
                if (r.ok && r.house.location) this.refreshMapHouses();
            });
        }
    },

    /** Every house of the tree with a point (no scope). */
    mapHousePointsAll(): MapHousePoint[] {
        this.houseStatesSync();
        const { houses } = treeHousesNow();
        const b = this.houseResearchBridge();
        const sig = [DataManager.getRevision(), houses.length, b?.base ?? '', this.houseStatesRev(), readCount].join('|');
        if (pointsNow?.sig === sig && housesNow?.houses === houses) return pointsNow.points;
        const user = DataManager.getData().houses;
        const points = mapHousePoints(houses, user, h => this.mapHouseResearch(h));
        pointsNow = { sig, points };
        return points;
    },

    /** The layer's switch: shown when a house has a point, on unless switched off on this device. */
    mapHousesSwitch(): { shown: boolean; on: boolean } {
        return mapHousesSwitch(this.mapHousePointsAll().length > 0, SettingsManager.getMapHouses());
    },

    /** Is the layer drawn now (on, and not in Migration over time)? */
    mapHousesOn(): boolean {
        return !this.mapTimeOn && this.mapHousesSwitch().on;
    },

    /** The houses drawn now: with someone of the map's scope among their people, apart from their town's point. */
    mapHousePointsShown(): MapHousePoint[] {
        if (!this.mapHousesOn()) return [];
        const scope = this.mapScopePersons();
        const { byId } = treeHousesNow();
        const all = scope ? this.mapHousePointsAll().filter(p => byId.get(p.id)?.personIds.some(id => scope.has(id))) : this.mapHousePointsAll();
        // A house over its town's point stays in that point until the map is zoomed in.
        const towns = new Map(Object.entries(DataManager.getData().places ?? {}));
        return housesApartFromTowns(all, towns, this.mapZoom);
    },

    /** The ids of the houses drawn as points of their own (a town point's tag leaves them out); undefined: the layer is off. */
    mapHouseIdsWithPoint(): ReadonlySet<string> | undefined {
        return this.mapHousesOn() ? housesWithPoint(this.mapHousePointsShown()) : undefined;
    },

    /** The houses' pills over the map; `open`: the house whose bubble is open (filled). */
    mapHousePointsHtml(width: number, height: number, open: string | null): string {
        if (!this.mapCenter) return '';
        const { byId } = treeHousesNow();
        const P = strings.houses.page.map;
        return this.mapHousePointsShown().map(p => {
            const at = pointInViewport({ lat: p.lat, lon: p.lon }, this.mapCenter!, this.mapZoom, width, height);
            if (at.x < -60 || at.y < -60 || at.x > width + 60 || at.y > height + 60) return '';
            const h = byId.get(p.id);
            const title = h ? houseTitle(h) : p.label;
            // Researched: the ✓ of the Houses window's row, without its day (that is in the bubble; Milan 27 Nov 2026).
            const done = !!h && this.houseResearchRow(h)?.state === 'done';
            const label = done ? `${P.point(p.label)} · ${title} · ${strings.houses.researchedMark}` : `${P.point(p.label)} · ${title}`;
            return `<button type="button" class="map-house-pt${open === p.id ? ' is-open' : ''}${done ? ' is-done' : ''}" data-house="${esc(p.id)}"`
                + ` style="left:${Math.round(at.x)}px; top:${Math.round(at.y)}px;" aria-label="${esc(label)}"`
                + ` title="${esc(title)}">${done ? '<span class="map-house-ok" aria-hidden="true">✓</span>' : ''}${esc(p.label)}</button>`;
        }).join('');
    },

    /** The house bubble's content (map-ui's .map-popup); `all`: every person, not the first ones. */
    mapHouseBubbleHtml(house: TreeHouse, all: boolean): string {
        const H = strings.houses;
        const data = DataManager.getData();
        const name = data.houses?.[house.id]?.name ?? house.name ?? '';
        const summary = mapHouseSummary(house, H.persons);
        const b = this.houseResearchBridge();
        const state = b ? houseStateHtml(this.houseResearchRow(house), { lang: getCurrentLanguage(), answer: true }) + this.houseActionHtml(house) : '';
        const people = house.personIds
            .map(id => DataManager.getPerson(id))
            .filter((p): p is NonNullable<typeof p> => !!p);
        const shown = all ? people : people.slice(0, BUBBLE_PEOPLE);
        const chips = this.mapPopupPeople(shown.map(p => [p.id as PersonId, new Set()] as const), Infinity, '')
            + (people.length > shown.length
                ? `<button type="button" class="map-popup-more map-popup-hmore">${esc(strings.map.morePeople(people.length - shown.length))}</button>` : '');
        const canMove = !DataManager.isReadOnly();
        // The house's own point elsewhere (OpenStreetMap, Mapy.com, Google Maps, Street View; Milan 27 Nov 2026).
        const own = mapHouseLocation(house, data.houses, this.mapHouseResearch(house));
        const elsewhere = own ? houseElsewhereHtml({ lat: own.lat, lng: own.lon }, getCurrentLanguage()) : '';
        return `
            <div class="map-popup-grip" aria-hidden="true"></div>
            <div class="map-popup-top">
                <div class="map-popup-head">
                    <strong>${esc(houseTitle(house))}${name ? ` <span class="map-popup-hname">${esc(name)}</span>` : ''}</strong>
                    <button type="button" class="map-popup-close" aria-label="${esc(strings.buttons.close)}">×</button>
                </div>
                ${summary ? `<div class="map-popup-summary">${esc(summary)}</div>` : ''}
                ${state ? `<div class="map-popup-hstate">${state}</div>` : ''}
            </div>
            <div class="map-popup-body"><div class="map-popup-people">${chips}</div></div>
            ${elsewhere ? `<div class="map-popup-else">${elsewhere}</div>` : ''}
            <div class="map-popup-foot map-popup-hfoot">
                <button type="button" class="map-popup-house-page" data-house="${esc(house.id)}">${esc(H.page.open)}</button>
                <button type="button" class="map-popup-town-houses" data-town="${esc(house.ref.town)}">${esc(H.townHouses)}</button>
                ${canMove ? `<button type="button" class="map-popup-house-move" data-house="${esc(house.id)}">${esc(H.page.map.move)}</button>` : ''}
            </div>`;
    },

    /** The tree's house of an id (or of a number joined into it). */
    mapTreeHouse(id: string): TreeHouse | null {
        return treeHousesNow().byId.get(id) ?? null;
    },

    /** A house's line in a town bubble's row: its research state and House page › ('' for no house of the tree). */
    mapTownHouseMeta(id: string): string {
        const house = this.mapTreeHouse(id);
        if (!house) return '';
        const b = this.houseResearchBridge();
        const state = b ? houseStateHtml(this.houseResearchRow(house), { lang: getCurrentLanguage() }) : '';
        return `<div class="map-popup-house-meta">${state}`
            + `<button type="button" class="map-popup-house-page" data-house="${esc(house.id)}">${esc(strings.houses.page.open)}</button></div>`;
    },

    /**
     * A click in the house bubble that is the house's own: House page ›, Move
     * the point (the house page with the point being moved), the research's
     * action and Answer. False: not one of them (the map's own handling).
     */
    mapHouseBubbleClick(target: HTMLElement): boolean {
        const pageBtn = target.closest<HTMLElement>('.map-popup-house-page');
        if (pageBtn?.dataset.house) {
            this.closeMapPopup();
            this.openHouse(pageBtn.dataset.house);
            return true;
        }
        const move = target.closest<HTMLElement>('.map-popup-house-move');
        if (move?.dataset.house) {
            this.closeMapPopup();
            requestHouseMapMove(move.dataset.house);
            this.openHouse(move.dataset.house);
            return true;
        }
        if (this.houseActionClick(target)) return true;
        const answer = target.closest<HTMLElement>('.house-answer');
        if (answer?.dataset.question) {
            this.closeMapPopup();
            this.showOverviewWaitingItem(answer.dataset.question);
            return true;
        }
        return false;
    },

    /** Switch the layer on or off (this device); the points and the towns' tags follow. */
    toggleMapHouses(): void {
        if (this.mapTimeOn) return;
        SettingsManager.setMapHouses(!this.mapHousesSwitch().on);
        this.closeMapPopup();
        this.refreshMapContent();
    },

    /** A result or the list came: the open map draws its houses again (once per frame). */
    refreshMapHouses(): void {
        if (redrawQueued) return;
        redrawQueued = true;
        requestAnimationFrame(() => {
            redrawQueued = false;
            const map = document.getElementById('map-container');
            if (map?.querySelector('.map-canvas') && map.getClientRects().length > 0) this.refreshMapContent();
        });
    },

    /** Can "On the map" of the house page show the house: it has a point, or its town is on the map. */
    houseOnMapPossible(house: TreeHouse, research: HouseResearch | null): boolean {
        return !!mapHouseLocation(house, DataManager.getData().houses, research) || !!DataManager.getData().places?.[house.townKey];
    },

    /**
     * "On the map" of the house page: the Map tab with the layer on, the house
     * in the middle and its bubble open; a house without a point shows its town.
     */
    showHouseOnMap(house: TreeHouse, research: HouseResearch | null): void {
        const at = mapHouseLocation(house, DataManager.getData().houses, research);
        // To the map: the page and every dialog under it close (as the Houses window's way to the tree).
        this.closeHousePage({ restore: false });
        this.closeHousesWindow(false);
        // Zoomed in until the house stands apart from its town's point; one on the town's point shows the town.
        const town = DataManager.getData().places?.[house.townKey];
        const apart = (z: number): boolean => !town || !at
            || housesApartFromTowns([{ townKey: house.townKey, lat: at.lat, lon: at.lon }], new Map([[house.townKey, town]]), z).length > 0;
        let zoom = Math.min(MAP_HOUSE_ZOOM, HOUSE_MAP_MAX_ZOOM);
        while (zoom < HOUSE_MAP_MAX_ZOOM && !apart(zoom)) zoom++;
        if (!at || !apart(zoom)) { this.showPlaceOnMap(house.townKey); return; }
        SettingsManager.setMapHouses(true);
        // A house of people outside the map's scope: the whole tree.
        const scope = this.mapScopePersons();
        if (scope && !house.personIds.some(id => scope.has(id))) this.rememberMapScope('tree');
        if (this.mapTimeOn) this.setMapTimeOn(false);
        this.mapCenter = { lat: at.lat, lon: at.lon };
        this.mapZoom = zoom;
        this.closeMapPopup();
        TreeRenderer.presetViewMode('map');
        void TreeRenderer.renderAsync().then(() => this.showMapHouse(house.id));
    },
});
