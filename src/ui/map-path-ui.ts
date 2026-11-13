/**
 * The ancestors' path to one person in Migration over time (spec 054 §1–§3):
 * choosing the person (the timebar's "Path to a person…", the chip that
 * replaces the scope), drawing the path in the colours of the grandparent
 * (quarter) or great-grandparent (eighth) lines, the target and its states,
 * and the timebar's range yearFrom → yearTo with one framing of the path.
 *
 * The data comes from src/map-lines.ts (pure model), the colours from
 * src/map-line-colors.ts. Without a chosen person nothing here runs and the
 * map draws Migration over time as before (src/ui/map-ui.ts).
 *
 * Left for later parts, with their hooks here: the playback schedule and the
 * marks above the slider (mapTimeBounds, renderMapTimeCaption), the legend
 * (mapPathFocusClass, mapPathDrawnLines, LEGEND_WIDTH) and the person page's
 * entry (setMapPathTarget).
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import { PersonId, PlaceGeo } from '../types.js';
import { collectPlaces, groupTownPoints, knownStreets } from '../places.js';
import { MQ_MOBILE, MQ_PHONE_LANDSCAPE } from '../breakpoints.js';
import { fitBounds, pointInViewport, project, unproject } from '../map.js';
import { shownName } from '../person-name.js';
import { PathPersonPicker } from '../person-picker.js';
import {
    buildPathModel, branchClass, pathPoints, pathSegments, type LineClass, type PathLocate, type PathModel,
} from '../map-lines.js';
import { LINE_FOCUS_DIM, lineStyle, pointFill, pointSize, lineColorVar } from '../map-line-colors.js';
import { uiModule } from './module.js';
import { declutterMapLabels, type MapScope } from './map-ui.js';

/** The legend's width (drawn by the legend part): 300, from 1280 px 320 — the framing keeps clear of it. */
export const LEGEND_WIDTH = { base: 300, wide: 320, wideFrom: 1280 } as const;

/** Map point lookups of the whole tree (every kind), rebuilt when the tree or its places change. */
let locateCache: { rev: number; data: object; places: object | undefined; locate: PathLocate; display: Map<string, string> } | null = null;
/** Path models by person, for the same tree state as locateCache. */
let modelCache = new Map<PersonId, PathModel>();
/** The open picker, its host and what opened it. */
let picker: { ui: PathPersonPicker; host: HTMLElement; anchor: 'bar' | 'chip' } | null = null;
let pickerOutsideBound = false;
/** What the last draw showed: lines kept (at most 400) of all lines at that year. */
let lastDrawn = { shown: 0, total: 0 };

/** A stable side of a line's bow from its route (alternating looks random but never jumps between years). */
function bowSide(key: string): 1 | -1 {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return h & 1 ? 1 : -1;
}

/** A quadratic bow between two screen points: control point 12 % of the length off the middle, perpendicular. */
function bow(a: { x: number; y: number }, b: { x: number; y: number }, side: 1 | -1): { d: string; mx: number; my: number; len: number } {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y;
    const cx = mx - dy * 0.12 * side, cy = my + dx * 0.12 * side;
    const f = (n: number): string => n.toFixed(1);
    return {
        d: `M${f(a.x)} ${f(a.y)} Q${f(cx)} ${f(cy)} ${f(b.x)} ${f(b.y)}`,
        mx: (a.x + 2 * cx + b.x) / 4,
        my: (a.y + 2 * cy + b.y) / 4,
        len: Math.hypot(dx, dy),
    };
}

export const mapPathMethods = uiModule({
    /** The path is shown: the time mode on and a chosen person still in the tree. */
    mapPathOn(): boolean {
        if (!this.mapTimeOn || !this.mapPathTarget) return false;
        const p = DataManager.getPerson(this.mapPathTarget);
        return !!p && !p.isPlaceholder;
    },

    /** The scope the map applies: with the path the whole tree (the chosen scope is kept for later). */
    mapEffectiveScope(): MapScope {
        return this.mapPathOn() ? 'tree' : this.mapScope;
    },

    /** Place key → the map point it is drawn at (a town gathers its houses), over the whole tree and every kind. */
    mapPathLocate(): { locate: PathLocate; display: Map<string, string> } {
        const data = DataManager.getData();
        const rev = DataManager.getRevision();
        if (locateCache && locateCache.rev === rev && locateCache.data === data && locateCache.places === data.places) {
            return locateCache;
        }
        const spellings = this.mapSpellings(collectPlaces(data));
        const mapped = spellings.places.filter(p => p.geo).map(p => ({ key: p.key, usage: p.usage, geo: p.geo! }));
        const pointOf = new Map<string, { key: string; geo: PlaceGeo }>();
        const display = new Map<string, string>();
        for (const p of groupTownPoints(mapped, knownStreets(data))) {
            const info = this.mapMarkerInfo(p);
            display.set(info.key, info.display);
            for (const key of p.type === 'town' ? p.placeKeys : [p.key]) pointOf.set(key, { key: info.key, geo: info.geo });
        }
        const locate: PathLocate = key => pointOf.get(spellings.keyOf.get(key) ?? key) ?? null;
        locateCache = { rev, data, places: data.places, locate, display };
        modelCache = new Map();
        return locateCache;
    },

    /** The path model of a person (cached for the tree's state). */
    mapPathModelOf(id: PersonId): PathModel {
        const { locate } = this.mapPathLocate();
        let model = modelCache.get(id);
        if (!model) {
            model = buildPathModel(DataManager.getData(), id, { locate });
            modelCache.set(id, model);
        }
        return model;
    },

    /** The shown path's model, null without one. */
    mapPathModel(): PathModel | null {
        return this.mapPathOn() ? this.mapPathModelOf(this.mapPathTarget!) : null;
    },

    /** Distinct ancestors of a person on the map (the picker's rows). */
    mapPathCount(id: PersonId): number {
        return this.mapPathModelOf(id).onMapCount;
    },

    /**
     * The timebar's range: with the path yearFrom → yearTo (null without an
     * ancestor on the map), else the dated places of the scope.
     */
    mapTimeBounds(): { min: number; max: number } | null {
        const model = this.mapPathModel();
        if (model) return model.yearFrom !== null && model.yearTo !== null ? { min: model.yearFrom, max: model.yearTo } : null;
        const h = this.mapTimeHarvest();
        return h.minYear !== null && h.maxYear !== null ? { min: h.minYear, max: h.maxYear } : null;
    },

    /** The class the legend highlights (a pinned line), null for none. */
    mapPathFocusClass(): LineClass | null {
        return this.mapLineFocus === null ? null : branchClass(this.mapLineMode, this.mapLineFocus);
    },

    /** Lines of the last draw: kept (≤ 400) and all at that year (the legend's "400 of 1,250 lines shown"). */
    mapPathDrawnLines(): { shown: number; total: number } {
        return { ...lastDrawn };
    },

    // ------------------------------------------------------------ choosing

    /** The chosen person's name as shown. */
    mapPathName(): string {
        const p = this.mapPathTarget ? DataManager.getPerson(this.mapPathTarget) : undefined;
        return p ? shownName(p) : '';
    },

    mapPathPickerOpen(): boolean {
        return !!picker;
    },

    /** Open the choice of a person: over the timebar's button or under the chip; a sheet on a phone or a touch screen. */
    openMapPathPicker(anchor: 'bar' | 'chip'): void {
        const container = document.getElementById('map-container');
        if (!container) return;
        if (picker) {
            const same = picker.anchor === anchor;
            this.closeMapPathPicker(false);
            if (same) return;
        }
        this.closeMapPopup();
        const host = document.createElement('div');
        host.className = 'map-path-picker';
        host.setAttribute('role', 'dialog');
        host.setAttribute('aria-label', strings.map.pathPickTitle);
        const sheet = window.matchMedia(`${MQ_MOBILE}, (pointer: coarse)`).matches;
        host.classList.toggle('map-path-picker--sheet', sheet);
        host.classList.toggle('map-path-picker--land', sheet && window.matchMedia(MQ_PHONE_LANDSCAPE).matches);
        container.appendChild(host);
        if (sheet) {
            const grip = document.createElement('span');
            grip.className = 'map-path-picker-grip';
            grip.setAttribute('aria-hidden', 'true');
            host.appendChild(grip);
        }
        const inner = document.createElement('div');
        inner.className = 'map-path-picker-inner';
        host.appendChild(inner);
        const ui = new PathPersonPicker({
            mode: 'path',
            container: inner,
            recentId: TreeRenderer.getFocusPersonId(),
            selectedId: this.mapPathOn() ? this.mapPathTarget : null,
            onMapCount: id => this.mapPathCount(id),
            onSelect: id => this.setMapPathTarget(id),
            onClose: () => this.closeMapPathPicker(true),
        });
        picker = { ui, host, anchor };
        if (!sheet) this.positionMapPathPicker();
        this.syncMapPathOpeners();
        if (!window.matchMedia('(pointer: coarse)').matches) ui.focusInput();
        if (!pickerOutsideBound) {
            pickerOutsideBound = true;
            document.addEventListener('pointerdown', (e: PointerEvent) => {
                if (!picker) return;
                const t = e.target as Element | null;
                if (t?.closest?.('.map-path-picker, .map-path-btn, .map-path-chip-open, .map-time-caption-other')) return;
                this.closeMapPathPicker(false);
            }, true);
        }
    },

    /** The popover beside what opened it: above the timebar, or under the chip; within the map. */
    positionMapPathPicker(): void {
        const container = document.getElementById('map-container');
        if (!picker || !container) return;
        const host = picker.host;
        const box = container.getBoundingClientRect();
        const margin = 12;
        const width = Math.min(390, box.width - 2 * margin);
        host.style.width = `${width}px`;
        if (picker.anchor === 'chip') {
            const chip = container.querySelector('.map-path-chip') as HTMLElement | null;
            const r = chip?.getBoundingClientRect();
            const left = r ? r.left - box.left : margin;
            const top = r ? r.bottom - box.top + 8 : margin;
            host.style.left = `${Math.max(margin, Math.min(left, box.width - width - margin))}px`;
            host.style.top = `${top}px`;
            host.style.maxHeight = `${Math.max(160, Math.min(420, box.height - top - margin))}px`;
            return;
        }
        const bar = container.querySelector('#map-timebar') as HTMLElement | null;
        const btn = container.querySelector('.map-path-btn') as HTMLElement | null;
        const barRect = bar?.getBoundingClientRect();
        const btnRect = btn?.getBoundingClientRect();
        const bottom = barRect ? box.bottom - barRect.top + 8 : 80;
        const right = btnRect ? box.right - btnRect.right : margin;
        host.style.right = `${Math.max(margin, Math.min(right, box.width - width - margin))}px`;
        host.style.bottom = `${bottom}px`;
        host.style.maxHeight = `${Math.max(160, Math.min(420, box.height - bottom - margin))}px`;
    },

    /** Close the choice; `refocus`: back to what opened it. */
    closeMapPathPicker(refocus: boolean): void {
        if (!picker) return;
        const { ui, host, anchor } = picker;
        picker = null;
        ui.destroy();
        host.remove();
        this.syncMapPathOpeners();
        if (refocus) {
            const sel = anchor === 'chip' ? '.map-path-chip-open' : '.map-path-btn';
            (document.querySelector(`#map-container ${sel}`) as HTMLElement | null)?.focus();
        }
    },

    /** The openers say whether the choice is open. */
    syncMapPathOpeners(): void {
        const open = picker?.anchor;
        document.querySelector('#map-container .map-path-btn')?.setAttribute('aria-expanded', String(open === 'bar'));
        document.querySelector('#map-container .map-path-chip-open')?.setAttribute('aria-expanded', String(open === 'chip'));
        document.querySelector('#map-container .map-path-btn')?.classList.toggle('is-open', open === 'bar');
    },

    /**
     * Show the path to a person: the time mode on, the year at the earliest
     * ancestor on the map, the map framed once around the path and the target.
     * Null clears the path (clearMapPath).
     */
    setMapPathTarget(id: PersonId | null): void {
        if (id === null) { this.clearMapPath(); return; }
        const person = DataManager.getPerson(id);
        if (!person || person.isPlaceholder) return;
        this.closeMapPathPicker(false);
        this.stopMapTimePlay();
        this.closeMapPopup();
        this.mapPathTarget = id;
        this.mapLineFocus = null;
        this.mapTimeOn = true;
        const model = this.mapPathModelOf(id);
        if (model.yearFrom !== null) this.mapTimeYear = model.yearFrom;
        else if (model.target.year !== undefined) this.mapTimeYear = model.target.year;
        this.refreshMapPath();
        this.fitMapToPath();
        (document.querySelector('#map-container .map-path-chip-open') as HTMLElement | null)?.focus();
    },

    /** × on the chip: the path goes, the scope comes back, the year stays (within the scope's range). */
    clearMapPath(): void {
        this.stopMapTimePlay();
        this.closeMapPathPicker(false);
        this.closeMapPopup();
        this.mapPathTarget = null;
        this.mapLineFocus = null;
        this.refreshMapPath();
        (document.querySelector('#map-container .map-path-btn') as HTMLElement | null)?.focus();
    },

    /** Redraw what the path changes: the top left, the timebar, the layer and the status bar. */
    refreshMapPath(): void {
        const container = document.getElementById('map-container');
        this.renderMapTimeControls();
        if (!container) return;
        this.drawMapMarkers(container, this.mapPlaces());
        this.renderMapStatus(this.mapPlaces());
    },

    /** The chip in place of the scope (top left): "◎ Path to: Name ▾ │ ×". */
    renderMapPathChip(): void {
        const container = document.getElementById('map-container');
        const chip = container?.querySelector('.map-path-chip') as HTMLElement | null;
        const scope = container?.querySelector('.map-scope') as HTMLElement | null;
        const on = this.mapPathOn();
        if (scope) scope.hidden = on;
        if (!chip) return;
        chip.hidden = !on;
        if (!on) return;
        const name = this.mapPathName();
        const strong = chip.querySelector('.map-path-chip-name') as HTMLElement | null;
        if (strong) { strong.textContent = name; strong.title = name; }
    },

    /**
     * Frame the path once: every place of it and the target, clear of the
     * legend on the right (its width + 40), the timebar below (+ 30) and the
     * chip with the kinds above.
     */
    fitMapToPath(): void {
        const container = document.getElementById('map-container');
        const model = this.mapPathModel();
        if (!container || !model) return;
        const geos: PlaceGeo[] = [];
        const keys = new Set(model.onMap.map(a => a.pointKey!));
        if (model.target.pointKey) keys.add(model.target.pointKey);
        for (const key of keys) {
            const g = model.points.get(key);
            if (g) geos.push(g);
        }
        if (geos.length === 0) return;
        const { width, height } = this.mapViewportSize(container);
        const box = container.getBoundingClientRect();
        const phone = window.matchMedia(MQ_MOBILE).matches;
        const legend = !phone && !this.mapLegendCollapsed && model.onMapCount > 0
            ? (window.innerWidth >= LEGEND_WIDTH.wideFrom ? LEGEND_WIDTH.wide : LEGEND_WIDTH.base) + 40 : 0;
        const bar = container.querySelector('#map-timebar') as HTMLElement | null;
        const barRect = bar && !bar.hidden ? bar.getBoundingClientRect() : null;
        const bottom = barRect && barRect.height > 0 ? Math.max(30, box.bottom - barRect.top + 30) : 40;
        const tl = container.querySelector('.map-topleft') as HTMLElement | null;
        const tlRect = tl?.getBoundingClientRect();
        const top = tlRect && tlRect.height > 0 ? Math.max(30, tlRect.bottom - box.top + 20) : 40;
        const left = 30;
        const right = Math.max(legend, 60);
        const w = Math.max(80, width - left - right);
        const h = Math.max(80, height - top - bottom);
        const fit = fitBounds(geos, w, h, 10);
        const zoom = geos.length === 1 ? Math.min(fit.zoom, 10) : fit.zoom;
        // Centre the fit in the free box, not in the whole map.
        const c = project(fit.center, zoom);
        const dx = left + w / 2 - width / 2, dy = top + h / 2 - height / 2;
        this.mapCenter = unproject({ x: c.x - dx, y: c.y - dy }, zoom);
        this.mapZoom = zoom;
        this.closeMapPopup();
        this.drawMapTiles(container);
        this.drawMapMarkers(container, this.mapPlaces());
    },

    // ------------------------------------------------------------ drawing

    /**
     * The path at the slider's year: the lines (bowed, cased, patterned by
     * line, wider when fresh and for the trunk), the eighths' numbers, the
     * ancestors' points (split when several lines meet) and the target.
     */
    drawMapPathLayer(container: HTMLElement): void {
        const markers = container.querySelector('.map-markers') as HTMLElement | null;
        const lines = container.querySelector('.map-lines') as SVGElement | null;
        const model = this.mapPathModel();
        if (!markers || !model || !this.mapCenter) return;
        const { width, height } = this.mapViewportSize(container);
        const center = this.mapCenter, zoom = this.mapZoom;
        const at = (geo: PlaceGeo) => pointInViewport(geo, center, zoom, width, height);
        const visible = (p: { x: number; y: number }, m = 0): boolean => p.x >= -m && p.y >= -m && p.x <= width + m && p.y <= height + m;
        const year = this.mapTimeYear;
        const mode = this.mapLineMode;
        const colors = this.mapLineColors;
        const focus = colors ? this.mapPathFocusClass() : null;
        const esc = (t: string): string => this.escapeHtml(t);
        const { display } = this.mapPathLocate();

        // Lines.
        const { segs, total } = pathSegments(model, year, mode, geo => visible(at(geo)));
        lastDrawn = { shown: segs.length, total };
        const casing: string[] = [], strokes: string[] = [];
        const longest = new Map<number, { mx: number; my: number; len: number; cls: LineClass }>();
        // Drawn oldest priority last so the trunk and fresh lines lie on top.
        for (let i = segs.length - 1; i >= 0; i--) {
            const s = segs[i];
            const a = at(s.from), b = at(s.to);
            const bw = bow(a, b, bowSide(`${s.fromKey}->${s.toKey}`));
            const st = lineStyle(s.cls, { age: s.age, colors, focus });
            const op = st.opacity.toFixed(3);
            casing.push(`<path d="${bw.d}" fill="none" stroke="${st.casing}" stroke-width="${st.casingWidth}" stroke-linecap="round" opacity="${op}"/>`);
            strokes.push(`<path class="map-path-line" data-cls="${s.cls}" d="${bw.d}" fill="none" stroke="${st.stroke}" stroke-width="${st.width}"`
                + `${st.dash ? ` stroke-dasharray="${st.dash}"` : ''} stroke-linecap="${st.cap}" opacity="${op}"/>`);
            if (mode === 'eighth' && colors && s.eighth >= 0 && (visible(a) || visible(b))) {
                const best = longest.get(s.eighth);
                if (!best || bw.len > best.len) longest.set(s.eighth, { mx: bw.mx, my: bw.my, len: bw.len, cls: s.cls });
            }
        }
        const numbers = [...longest.entries()].sort((x, y) => x[0] - y[0]).map(([e, m]) => {
            const op = focus && focus !== m.cls ? 0.2 : 1;
            return `<g class="map-path-eighth" data-eighth="${e + 1}" opacity="${op}">`
                + `<circle cx="${m.mx.toFixed(1)}" cy="${m.my.toFixed(1)}" r="9" fill="var(--surface)" stroke="${lineColorVar(m.cls)}" stroke-width="2.5"/>`
                + `<text x="${m.mx.toFixed(1)}" y="${(m.my + 4).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--text)">${e + 1}</text></g>`;
        });
        if (lines) {
            lines.innerHTML = `<g class="map-path-casing">${casing.join('')}</g><g class="map-path-strokes">${strokes.join('')}</g>`
                + (numbers.length ? `<g class="map-path-eighths">${numbers.join('')}</g>` : '');
        }

        // Points.
        const html: string[] = [];
        for (const p of pathPoints(model, year, mode)) {
            const xy = at(p.geo);
            if (!visible(xy, 200)) continue;
            const size = pointSize(colors ? p.classes.length : 1, p.fresh);
            const fill = pointFill(p.classes, colors);
            const dim = focus && !p.classes.includes(focus) ? LINE_FOCUS_DIM.point : 1;
            const name = display.get(p.key) ?? '';
            html.push(`<button type="button" class="map-marker map-path-point${p.fresh ? ' is-fresh' : ''}" data-key="${esc(p.key)}" data-classes="${p.classes.join(' ')}"`
                + ` aria-label="${esc(name)}" style="left:${Math.round(xy.x)}px; top:${Math.round(xy.y)}px;${dim < 1 ? ` opacity:${dim};` : ''}">`
                + `<span class="map-marker-dot map-path-dot" style="width:${size}px; height:${size}px; background:${fill};"></span>`
                + `<span class="map-marker-label">${esc(name)}</span></button>`);
        }

        // The target: dashed and faint before the end, solid with a halo at the end.
        const t = model.target;
        const tGeo = t.pointKey ? model.points.get(t.pointKey) : undefined;
        if (tGeo && t.kind) {
            const xy = at(tGeo);
            const end = model.yearTo === null || year >= model.yearTo;
            const name = this.mapPathName();
            const label = end
                ? `◎ ${strings.map.pathGoalEnd(name, t.year ?? model.yearTo ?? undefined, t.kind)}`
                : `◎ ${strings.map.pathGoal(name)}`;
            html.push(`<div class="map-path-target${end ? ' is-reached' : ''}" data-key="${esc(t.pointKey!)}" style="left:${Math.round(xy.x)}px; top:${Math.round(xy.y)}px;">`
                + `<span class="map-path-target-ring" aria-hidden="true"><span class="map-path-target-dot"></span></span>`
                + `<span class="map-path-target-label" title="${esc(label)}">${esc(label)}</span></div>`);
        }
        markers.innerHTML = html.join('');
        declutterMapLabels(markers);
    },

    /**
     * The line under the slider. Here: the path's dead ends — no ancestor on
     * the map ("Choose another person"), or the target without a place at the
     * end. (What came onto the map in a year is the playback part's.)
     */
    renderMapTimeCaption(): void {
        const cap = document.querySelector('#map-container .map-time-caption') as HTMLElement | null;
        if (!cap) return;
        const model = this.mapPathModel();
        if (!model) { cap.hidden = true; cap.innerHTML = ''; return; }
        const esc = (t: string): string => this.escapeHtml(t);
        if (model.onMapCount === 0) {
            cap.innerHTML = `<span class="map-time-caption-text is-strong">${esc(strings.map.pathNoAncestors)}</span>`
                + ` <button type="button" class="map-time-caption-other">${esc(strings.map.pathOtherPerson)}</button>`;
            cap.hidden = false;
            return;
        }
        if (!model.target.pointKey && model.yearTo !== null && this.mapTimeYear >= model.yearTo) {
            cap.innerHTML = `<span class="map-time-caption-text is-strong">${esc(strings.map.pathTargetNoPlace(this.mapPathName()))}</span>`;
            cap.hidden = false;
            return;
        }
        cap.hidden = true;
        cap.innerHTML = '';
    },
});
