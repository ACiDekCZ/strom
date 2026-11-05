/**
 * Following the research agent on the map (spec 043 §5, §6.4): where each
 * session works now is a ring in the session's colour over the place (solid:
 * the research's place record; dashed: a place of the person from the tree;
 * a hollow dot inside when the place is outside the map's scope or kinds),
 * with its name to the right and the session's number when two or more run.
 * A run that moves to another place signals once (two pulses), and so do
 * the rings once on arriving on the map (not on a zoom or a pan); the map pans
 * only when the place of session 1 is outside the view and the map is not
 * paused (moved by hand: live-follow-ui.ts). A place without a position, or
 * a person without a place, gets a line at the top instead. The trail of
 * the places worked on before: empty rings, older fainter, a dotted line
 * between one session's places (not on a phone).
 *
 * Its own layer over the markers: the map's markers are drawn anew on every
 * frame of a pan, the work marks only move (a running pulse goes on).
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { SettingsManager } from '../settings.js';
import { strings } from '../strings.js';
import { PersonId } from '../types.js';
import { shownName } from '../person-name.js';
import { isPhoneBar } from '../breakpoints.js';
import { fitBounds, pointInViewport, project, unproject } from '../map.js';
import type { MapPoint } from '../places.js';
import { FollowTarget, sessionTone } from '../live-follow-targets.js';
import { GeoPoint, WorkPlace, mapTrailDots, mapTrailLines, workPlaceId } from '../live-follow-map.js';
import { getFollowTrail } from '../live-follow-prefs.js';
import { uiModule } from './module.js';
import { liveSession, timeEl } from './research-ui.js';
import {
    currentFollowTargets, currentWorkPlaces, followBusy, followMapPaused, followNumbered, followTiming, followTrail,
    takeMapArrival,
} from './live-follow-ui.js';

/** A place this close to the view's edge counts as outside it (px). */
const PAN_MARGIN = 64;
const PAN_MS = 400;

/** One place worked on now (one or more runs there). */
interface WorkMark {
    id: string;
    place: WorkPlace;
    /** Where the ring stands: the map point's position when the place is one, else the place's own. */
    geo: GeoPoint;
    /** The map point it stands on (null: outside the map's scope or kinds). */
    pointKey: string | null;
    targets: FollowTarget[];
}

/** The work marks drawn now (repositioned on every frame of a pan). */
let marks: WorkMark[] = [];
/** The trail's dotted lines drawn now. */
let lines: Array<{ session: number; from: GeoPoint; to: GeoPoint }> = [];
let panFrame = 0;
let panTimer: ReturnType<typeof setTimeout> | null = null;
let lastPanAt = 0;

function reducedMotion(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function esc(t: string): string {
    return t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function personName(id: PersonId): string {
    const p = DataManager.getPerson(id);
    return p ? shownName(p) : '';
}

/** Where the place comes from, in one line ("record place" / "person's place · birth"). */
function sourceText(place: WorkPlace, long: boolean): string {
    const m = strings.map;
    if (place.recordId && place.kind === 'record') return long ? m.workRecordSrc : m.workRecord;
    return place.event ? m.workPerson(m.workEvents[place.event]) : '';
}

/** The map point a place key is drawn as (a spelling joined to a place, a house in its town). */
function pointOf(points: readonly MapPoint[], key: string, joined: string): MapPoint | undefined {
    return points.find(p => p.key === key) ?? points.find(p => p.key === joined)
        ?? points.find(p => p.type === 'town' && p.placeKeys.includes(key));
}

const LANDSCAPE_PHONE = '(max-width: 1024px) and (max-height: 500px) and (orientation: landscape)';

/** The bottom of what stands at the top of the map over the given columns (px from the container's top). */
function clearBelow(container: HTMLElement, left: number, right: number, from: number, sels: string): number {
    const box = container.getBoundingClientRect();
    let top = from;
    for (const el of document.querySelectorAll(sels)) {
        const r = el.getBoundingClientRect();
        if (!r.height || r.top > box.top + box.height / 2) continue;
        if (r.right <= left || r.left >= right) continue;
        top = Math.max(top, r.bottom - box.top + 8);
    }
    return top;
}

/**
 * The map's pause pill stands under the map's scope and kind pills, the
 * notices under the pill (top centre). A phone and a phone held sideways
 * place both by CSS alone.
 */
function placeMapChrome(container: HTMLElement): void {
    const phone = isPhoneBar() || matchMedia(LANDSCAPE_PHONE).matches;
    const pill = document.querySelector<HTMLElement>('#live-follow-pill.live-follow-pill--map');
    if (pill) {
        pill.style.top = '';
        if (!phone) {
            const box = container.getBoundingClientRect();
            const r = pill.getBoundingClientRect();
            const top = clearBelow(container, r.left, r.right, r.top - box.top, '#map-container .map-topleft > *');
            pill.style.top = `${Math.round(box.top + top)}px`;
        }
    }
    const host = container.querySelector<HTMLElement>('.map-follow-notices');
    if (!host) return;
    host.style.top = '';
    if (phone) return;
    host.style.top = '12px';
    const me = host.getBoundingClientRect();
    host.style.top = `${Math.round(clearBelow(container, me.left, me.right, 12,
        '#live-follow-pill, #evidence-pill, #map-container .map-topleft > *, #map-container .map-controls'))}px`;
}

export const mapFollowMethods = uiModule({
    /** Take the work marks, notices and trail off the map. */
    clearMapFollowMarks(): void {
        marks = [];
        lines = [];
        document.querySelectorAll('#map-container .map-follow-layer, #map-container .map-trail-line, #map-container .map-follow-notices')
            .forEach(e => e.remove());
        document.querySelectorAll('#map-container .map-marker.is-worked').forEach(e => e.classList.remove('is-worked'));
    },

    /**
     * Put the marks of following on the map (after each draw of the map and
     * each change of the work). `pulse`: the rows whose place changed now.
     */
    applyMapFollowMarks(pulse?: Set<number>): void {
        const container = document.getElementById('map-container');
        const canvas = container?.querySelector<HTMLElement>('.map-canvas');
        const targets = currentFollowTargets();
        const trail = followTrail();
        if (!container || !canvas || TreeRenderer.getViewMode() !== 'map' || !SettingsManager.isMapTilesAcknowledged()
            || (!targets.length && !trail.length)) {
            this.clearMapFollowMarks();
            return;
        }
        // A redraw of the map may take the legend along: put it back.
        if (!document.getElementById('follow-legend')) this.renderFollowLegend();
        // The signals due now: the rows whose place changed, and every ring once on arriving on the map
        // (following on, the map chosen, the app opened again, Back to the agent). A zoom or a pan does not.
        const due = new Set<number>(pulse ?? []);
        if (takeMapArrival()) for (const t of targets) due.add(t.row);
        const places = currentWorkPlaces(targets);
        const points = this.mapPoints();
        const byId = new Map<string, WorkMark>();
        const missing: Array<{ target: FollowTarget; place: WorkPlace }> = [];
        for (const t of [...targets].sort((a, b) => a.session - b.session)) {
            const place = places.get(t.row);
            if (!place) continue;
            if (!place.geo) { missing.push({ target: t, place }); continue; }
            const id = workPlaceId(place);
            const had = byId.get(id);
            if (had) { had.targets.push(t); continue; }
            const point = place.key ? pointOf(points, place.key, this.mapPointKeyOf(place.key)) : undefined;
            byId.set(id, { id, place, geo: point ? { lat: point.geo.lat, lon: point.geo.lon } : place.geo, pointKey: point?.key ?? null, targets: [t] });
        }
        marks = [...byId.values()];

        // The layer right above the markers: the trail's rings first, the work marks over them.
        let layer = canvas.querySelector<HTMLElement>('.map-follow-layer');
        if (!layer) {
            layer = document.createElement('div');
            layer.className = 'map-follow-layer';
            canvas.querySelector('.map-markers')?.after(layer);
        }
        const numbered = followNumbered();
        const motion = !reducedMotion();
        const showTrail = getFollowTrail() && !isPhoneBar();
        const current = new Set(marks.map(m => m.id));
        const dots = showTrail ? mapTrailDots(trail, current) : [];
        const now = new Map<number, { key: string; geo: GeoPoint }>();
        for (const m of marks) for (const t of m.targets) if (!now.has(t.session)) now.set(t.session, { key: m.id, geo: m.geo });
        lines = showTrail ? mapTrailLines(trail, now) : [];

        const keep = new Set<Element>();
        for (const d of dots) {
            let dot = layer.querySelector<HTMLElement>(`.map-trail-dot[data-key="${CSS.escape(d.key)}"]`);
            if (!dot) {
                dot = document.createElement('span');
                dot.dataset.key = d.key;
                layer.prepend(dot);
            }
            dot.className = `map-trail-dot follow-${sessionTone(d.session)}`;
            dot.dataset.lat = String(d.geo.lat);
            dot.dataset.lon = String(d.geo.lon);
            dot.dataset.followSession = String(d.session);
            dot.style.setProperty('--trail-o', String(d.opacity));
            dot.setAttribute('aria-hidden', 'true');
            keep.add(dot);
        }
        const m = strings.map;
        for (const w of marks) {
            const lead = w.targets[0];
            let el = layer.querySelector<HTMLElement>(`.map-marker-work[data-key="${CSS.escape(w.id)}"]`);
            if (!el) {
                el = document.createElement('div');
                el.dataset.key = w.id;
                layer.appendChild(el);
            }
            const out = !w.pointKey;
            const pulsing = el.classList.contains('is-pulse');
            el.className = `map-marker-work follow-${sessionTone(lead.session)} ${w.place.kind === 'record' ? 'is-record' : 'is-person'}${out ? ' is-outscope' : ''}${pulsing ? ' is-pulse' : ''}`;
            el.dataset.followSession = String(lead.session);
            el.dataset.lat = String(w.geo.lat);
            el.dataset.lon = String(w.geo.lon);
            if (w.pointKey) el.dataset.point = w.pointKey; else delete el.dataset.point;
            const src = sourceText(w.place, false);
            const sub = [src, out ? m.outScope : ''].filter(Boolean).join(' · ');
            const label = `${m.workHead}: ${w.place.name}${numbered ? ` · ${strings.live.sessionN(lead.session)}` : ''}`;
            const html = `<button type="button" class="map-work-ring" aria-label="${esc(label)}" title="${esc(w.targets.map(t => t.task).filter(Boolean).join('\n') || label)}">${out ? '<span class="map-work-hollow" aria-hidden="true"></span>' : ''}</button>`
                + (numbered ? w.targets.map((t, i) => `<span class="map-work-num follow-${sessionTone(t.session)}" style="--i:${i}" aria-hidden="true">${t.session}</span>`).join('') : '')
                + `<span class="map-work-label" aria-hidden="true"><b>${esc(w.place.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>`;
            if (el.dataset.html !== html) {
                el.innerHTML = html;
                el.dataset.html = html;
            }
            if (motion && w.targets.some(t => due.has(t.row))) {
                el.classList.remove('is-pulse');
                void el.offsetWidth;
                el.classList.add('is-pulse');
                el.dataset.pulseAt = String(Math.round(performance.now()));
                const box = el;
                const done = (): void => { box.classList.remove('is-pulse'); };
                box.addEventListener('animationend', done, { once: true });
                setTimeout(done, 1700);
            }
            keep.add(el);
        }
        layer.querySelectorAll(':scope > *').forEach(e => { if (!keep.has(e)) e.remove(); });
        if (!layer.dataset.wired) {
            layer.dataset.wired = '1';
            layer.addEventListener('click', (e) => {
                const ring = (e.target as HTMLElement).closest('.map-marker-work') as HTMLElement | null;
                if (ring?.dataset.key) this.showMapWork(ring.dataset.key);
            });
        }

        // The trail's dotted lines under everything of the layer.
        let svg = canvas.querySelector<SVGSVGElement>('svg.map-trail-line');
        if (lines.length && !svg) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'map-trail-line');
            svg.setAttribute('aria-hidden', 'true');
            layer.before(svg);
        } else if (!lines.length) {
            svg?.remove();
        }
        this.renderMapFollowNotices(container, missing, numbered);
        this.positionMapFollow(container);
        if (targets.some(t => t.session === 1 && pulse?.has(t.row))) this.mapFollowPan(false);
    },

    /** Lines for a place without a position or a person without a place, one per session. */
    renderMapFollowNotices(container: HTMLElement, missing: Array<{ target: FollowTarget; place: WorkPlace }>, numbered: boolean): void {
        let host = container.querySelector<HTMLElement>('.map-follow-notices');
        if (!missing.length) { host?.remove(); return; }
        if (!host) {
            host = document.createElement('div');
            host.className = 'map-follow-notices';
            host.setAttribute('role', 'status');
            container.appendChild(host);
            host.addEventListener('click', (e) => {
                const b = (e.target as HTMLElement).closest('.map-follow-locate') as HTMLElement | null;
                if (b?.dataset.key) this.showPlacesManager(b.dataset.key, undefined, 'tree');
            });
        }
        const m = strings.map;
        const readOnly = DataManager.isViewMode();
        const html = missing.map(({ target, place }) => {
            const name = place.kind === 'noPlace' ? personName(target.personId) : place.name;
            const full = place.kind === 'noPlace' ? m.noPlace(name) : m.noCoords(name);
            const rest = full.startsWith(name) ? full.slice(name.length) : ` ${full}`;
            const known = place.kind === 'noCoords' && place.key && !readOnly ? place.key : null;
            return `<div class="map-follow-notice follow-${sessionTone(target.session)}" data-follow-session="${target.session}">`
                + `<span class="map-follow-notice-mark" aria-hidden="true">${numbered ? target.session : ''}</span>`
                + `<span class="map-follow-notice-text"><b>${esc(name)}</b>${esc(rest)}</span>`
                + (known ? `<button type="button" class="map-follow-locate" data-key="${esc(known)}">${esc(m.locate)}</button>` : '')
                + '</div>';
        }).join('');
        if (host.dataset.html !== html) {
            host.innerHTML = html;
            host.dataset.html = html;
        }
        placeMapChrome(container);
    },

    /** Place the map's pause pill and notices again (the pill came or went). */
    placeMapFollowChrome(): void {
        const container = document.getElementById('map-container');
        if (container && TreeRenderer.getViewMode() === 'map') placeMapChrome(container);
    },

    /** Move the marks with the map (after every draw of the markers: a pan, a zoom). */
    positionMapFollow(container: HTMLElement): void {
        placeMapChrome(container);
        const layer = container.querySelector<HTMLElement>('.map-follow-layer');
        if (!layer || !this.mapCenter) return;
        const { width, height } = this.mapViewportSize(container);
        const at = (g: GeoPoint) => pointInViewport({ lat: g.lat, lon: g.lon }, this.mapCenter!, this.mapZoom, width, height);
        layer.querySelectorAll<HTMLElement>('[data-lat]').forEach(el => {
            const p = at({ lat: Number(el.dataset.lat), lon: Number(el.dataset.lon) });
            el.style.left = `${Math.round(p.x)}px`;
            el.style.top = `${Math.round(p.y)}px`;
        });
        // The ordinary marker under a work ring keeps its dot, its name stands beside the ring instead.
        const worked = new Set(marks.map(m => m.pointKey).filter((k): k is string => !!k));
        container.querySelectorAll<HTMLElement>('.map-markers .map-marker').forEach(mk => {
            mk.classList.toggle('is-worked', worked.has(mk.dataset.key ?? ''));
        });
        const svg = container.querySelector<SVGSVGElement>('svg.map-trail-line');
        if (svg) {
            svg.innerHTML = lines.map(l => {
                const a = at(l.from), b = at(l.to);
                return `<line class="follow-${sessionTone(l.session)}" x1="${Math.round(a.x)}" y1="${Math.round(a.y)}" x2="${Math.round(b.x)}" y2="${Math.round(b.y)}"/>`;
            }).join('');
        }
    },

    /**
     * A click on a work ring: the place's bubble with "Work in progress" in
     * it, or a bubble of the work alone (a place outside the map's scope, a
     * record no fact names).
     */
    showMapWork(id: string): void {
        const mark = marks.find(m => m.id === id);
        if (!mark) return;
        if (mark.pointKey) { this.showMapPlace(mark.pointKey); return; }
        const m = strings.map;
        const lead = mark.targets[0];
        const head = `<div class="map-popup-grip" aria-hidden="true"></div>
            <div class="map-popup-top">
                <div class="map-popup-head">
                    <strong>${esc(mark.place.name)}</strong>
                    <button type="button" class="map-popup-close" aria-label="${esc(strings.buttons.close)}">×</button>
                </div>
                <div class="map-popup-label">${esc([sourceText(mark.place, true), m.outScope].filter(Boolean).join(' · '))}</div>
            </div>`;
        this.showMapWorkBubble(head + this.mapWorkSectionsHtml(mark.targets, false), mark.geo, lead.session);
    },

    /** "Work in progress" of the runs at a map point, for its bubble (after its head). */
    mapPopupWork(popup: HTMLElement, pointKey: string): void {
        popup.querySelectorAll('.map-popup-work').forEach(e => e.remove());
        const mark = marks.find(m => m.pointKey === pointKey);
        if (!mark) return;
        popup.querySelector('.map-popup-top')?.insertAdjacentHTML('afterend', this.mapWorkSectionsHtml(mark.targets, true, mark.place));
        this.fillMapWorkTimes(popup);
    },

    /** One block per run: its session, where the place comes from, the task, the person (a link), since when. */
    mapWorkSectionsHtml(targets: readonly FollowTarget[], withSource: boolean, place?: WorkPlace): string {
        const numbered = followNumbered();
        const s = liveSession();
        return targets.map(t => {
            const src = withSource && place ? sourceText(place, true) : '';
            const since = s?.working[t.row]?.since ?? '';
            return `<div class="map-popup-work follow-${sessionTone(t.session)}" data-follow-session="${t.session}">
                <div class="map-popup-work-head"><span class="map-popup-work-dot" aria-hidden="true"></span>${esc(strings.map.workHead)}${numbered ? ` · ${esc(strings.live.sessionN(t.session))}` : ''}</div>
                ${src ? `<div class="map-popup-work-src">${esc(src)}</div>` : ''}
                ${t.task ? `<div class="map-popup-work-task">${esc(t.task)}</div>` : ''}
                <button type="button" class="map-work-person" data-person-id="${esc(t.personId)}">${esc(personName(t.personId))}</button>
                <span class="map-popup-work-time" data-since="${esc(since)}"></span>
            </div>`;
        }).join('');
    },

    /** "since 10:02 · 4 min" in the work blocks of a bubble (the live panel's own text). */
    fillMapWorkTimes(popup: HTMLElement): void {
        popup.querySelectorAll<HTMLElement>('.map-popup-work-time[data-since]').forEach(span => {
            const t = timeEl(span.dataset.since ?? '', 'sincefor');
            if (t) span.replaceWith(t);
            else span.remove();
        });
    },

    /** Stop a pan in flight (the user took the map, following ended). */
    stopMapFollowPan(): void {
        if (panFrame) cancelAnimationFrame(panFrame);
        if (panTimer) clearTimeout(panTimer);
        panFrame = 0;
        panTimer = null;
    },

    /**
     * Pan to the place session 1 works on, when it is outside the view (64 px
     * margin) and the map is not paused; `now`: without the 8 s brake;
     * `centre`: also when it is in view (Back to the agent). A dialog, a menu
     * or typing puts it off. The zoom stays; a place more than two views away
     * is framed together with the view's centre (zoom at most the current).
     */
    mapFollowPan(now: boolean, centre = false): void {
        if (panTimer) clearTimeout(panTimer);
        panTimer = null;
        if (this.liveFollowView() !== 'map' || TreeRenderer.getViewMode() !== 'map' || followMapPaused()) return;
        const t = followTiming();
        const container = document.getElementById('map-container');
        if (!container?.querySelector('.map-canvas') || !this.mapCenter) {
            // The map is still being drawn: once more in a moment.
            panTimer = setTimeout(() => this.mapFollowPan(now, centre), t.retry);
            return;
        }
        const lead = currentFollowTargets().find(x => x.session === 1);
        const geo = lead ? currentWorkPlaces([lead]).get(lead.row)?.geo : null;
        if (!lead || !geo) return;
        if (followBusy(this.isEvidenceHighlightOn())) {
            panTimer = setTimeout(() => this.mapFollowPan(now, centre), t.retry);
            return;
        }
        const wait = now ? 0 : lastPanAt + t.gap - Date.now();
        if (wait > 0) {
            panTimer = setTimeout(() => this.mapFollowPan(false, centre), wait);
            return;
        }
        const mark = marks.find(m => m.targets.some(x => x.row === lead.row));
        const where = mark?.geo ?? geo;
        const { width, height } = this.mapViewportSize(container);
        const at = pointInViewport({ lat: where.lat, lon: where.lon }, this.mapCenter, this.mapZoom, width, height);
        const inside = at.x >= PAN_MARGIN && at.x <= width - PAN_MARGIN && at.y >= PAN_MARGIN && at.y <= height - PAN_MARGIN;
        if (inside && !centre) return;
        lastPanAt = Date.now();
        const far = Math.abs(at.x - width / 2) > 2 * width || Math.abs(at.y - height / 2) > 2 * height;
        let target = { center: { lat: where.lat, lon: where.lon }, zoom: this.mapZoom };
        if (far) {
            const fit = fitBounds([this.mapCenter, { lat: where.lat, lon: where.lon }], width, height, PAN_MARGIN);
            target = { center: fit.center, zoom: Math.min(fit.zoom, this.mapZoom) };
        }
        const redraw = (): void => {
            this.drawMapTiles(container);
            this.drawMapMarkers(container, this.mapPlaces());
        };
        this.stopMapFollowPan();
        if (reducedMotion() || target.zoom !== this.mapZoom) {
            this.mapCenter = target.center;
            this.mapZoom = target.zoom;
            redraw();
            return;
        }
        const z = this.mapZoom;
        const from = project(this.mapCenter, z), to = project(target.center, z);
        const start = performance.now();
        const step = (ts: number): void => {
            const k = Math.min(1, (ts - start) / PAN_MS);
            const e = 1 - Math.pow(1 - k, 3);
            this.mapCenter = unproject({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e }, z);
            redraw();
            panFrame = k < 1 ? requestAnimationFrame(step) : 0;
        };
        panFrame = requestAnimationFrame(step);
    },
});
