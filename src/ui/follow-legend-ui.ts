/**
 * The legend of following in the fan and on the map (spec 043 §6.5): folded
 * "◯ What the highlights mean", open a small card with the sessions' colours,
 * the trail and, on the map, the three kinds of work rings; at its foot the
 * "Session trail" switch (kept on the device; off only hides the trail).
 * Bottom left of the fan (above the fan's own colour legend) and of the map
 * (above its status bar). Not on a phone, where neither the trail nor the
 * legend is shown (§8). Open or folded is remembered while following runs;
 * it opens by itself the first time a trail appears.
 */

import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import { isPhoneBar } from '../breakpoints.js';
import { getFollowTrail, setFollowTrail } from '../live-follow-prefs.js';
import { uiModule } from './module.js';
import { helpMark } from './help-mark.js';
import {
    currentFollowTargets, followLegendOpen, followNumbered, followTrail, setFollowLegendOpen,
} from './live-follow-ui.js';

/** Keeps the fan's legend of following above the fan's own legend (their heights change when they fold). */
let fanLegendWatch: ResizeObserver | null = null;
let fanLegendWatched: Element | null = null;
let followHostWatched: Element | null = null;

function esc(t: string): string {
    return t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * The room the fan's card leaves above itself for the legend of following
 * (its height and the 8px gap), so a long card (family lines) does not push
 * the legend past the top of the fan; null gives it back.
 */
function reserveForFollow(own: HTMLElement | null, host: HTMLElement | null): void {
    if (!own) return;
    const h = host ? Math.ceil(host.getBoundingClientRect().height) : 0;
    const v = h ? `${h + 8}px` : '';
    if (own.style.getPropertyValue('--fan-legend-follow') !== v) {
        if (v) own.style.setProperty('--fan-legend-follow', v);
        else own.style.removeProperty('--fan-legend-follow');
    }
}

/**
 * Lift the legend over the fan's own colour legend (bottom left). Back /
 * forward stand right above that card too while they show: the CSS in
 * index.html lifts the legend over them (1122 E).
 */
function liftOverFanLegend(host: HTMLElement): void {
    const own = document.getElementById('fan-legend');
    const place = (): void => {
        // The fan's legend stands higher while the focus buttons are shown: measure where it is.
        reserveForFollow(own, host);
        const parent = host.parentElement;
        const r = own && !own.hidden ? own.getBoundingClientRect() : null;
        const bottom = !parent || !r || !r.height ? '14px' : `${Math.round(parent.getBoundingClientRect().bottom - r.top + 8)}px`;
        if (host.style.bottom !== bottom) host.style.bottom = bottom;
    };
    place();
    if (typeof ResizeObserver === 'undefined' || !own || (fanLegendWatched === own && followHostWatched === host)) return;
    fanLegendWatch?.disconnect();
    fanLegendWatch = new ResizeObserver(() => {
        const h = document.getElementById('follow-legend');
        if (h?.dataset.view === 'fan') place();
    });
    fanLegendWatch.observe(own);
    fanLegendWatch.observe(host);
    fanLegendWatched = own;
    followHostWatched = host;
}

export const followLegendMethods = uiModule({
    /** Draw (or take away) the legend of following for the view on screen. */
    renderFollowLegend(): void {
        const mode = TreeRenderer.getViewMode();
        const old = document.getElementById('follow-legend');
        const targets = currentFollowTargets();
        const trail = followTrail();
        const parent = mode === 'map' ? document.getElementById('map-container')
            : mode === 'fan' ? document.getElementById('fan-legend')?.parentElement ?? null : null;
        if (!parent || isPhoneBar() || (!targets.length && !trail.length)
            || (mode === 'map' && !parent.querySelector('.map-canvas'))) {
            old?.remove();
            reserveForFollow(document.getElementById('fan-legend'), null);
            return;
        }
        let host = old;
        if (host && (host.parentElement !== parent || host.dataset.view !== mode)) {
            host.remove();
            host = null;
        }
        if (!host) {
            host = document.createElement('div');
            host.id = 'follow-legend';
            host.className = 'follow-legend-host';
            host.dataset.view = mode;
            parent.appendChild(host);
            host.addEventListener('click', (e) => {
                const t = e.target as HTMLElement;
                if (t.closest('.follow-legend')) { this.setFollowLegend(true); return; }
                if (t.closest('.follow-legend-close')) { this.setFollowLegend(false); return; }
            });
            host.addEventListener('change', (e) => {
                const input = e.target as HTMLInputElement;
                if (!input.matches('.follow-legend-switch input')) return;
                setFollowTrail(input.checked);
                this.refreshFollowMarks(new Set());
                TreeRenderer.refreshCardTrail();
            });
        }
        const L = strings.live;
        const open = followLegendOpen() === true;
        const map = mode === 'map';
        let html: string;
        if (!open) {
            html = `<button type="button" class="follow-legend" aria-expanded="false"><span class="follow-legend-ring" aria-hidden="true"></span><span>${esc(L.legendTitle)}</span></button>`;
        } else {
            const row = (mark: string, text: string): string =>
                `<li><span class="follow-legend-mark ${mark}" aria-hidden="true"></span><span>${esc(text)}</span></li>`;
            const rows = [row('is-session follow-primary', L.legendSession(1))];
            if (map || followNumbered()) rows.push(row('is-session follow-accent', L.legendSession(2)));
            rows.push(row('is-trail', L.legendTrail));
            if (map) {
                rows.push(row('is-ring is-record', L.legendRecord));
                rows.push(row('is-ring is-person', L.legendPerson));
                rows.push(row('is-ring is-outscope', L.legendOut));
            }
            html = `<div class="follow-legend-card${map ? ' is-map' : ''}" role="group" aria-labelledby="follow-legend-title">
                <div class="follow-legend-head"><b id="follow-legend-title">${esc(L.legendTitle)}</b><button type="button" class="follow-legend-close" aria-expanded="true" aria-label="${esc(strings.buttons.close)}" title="${esc(strings.buttons.close)}">×</button></div>
                <ul class="follow-legend-rows">${rows.join('')}</ul>
                <label class="follow-legend-switch"><input type="checkbox" role="switch"${getFollowTrail() ? ' checked' : ''}><span>${esc(L.trailToggle)}</span></label>
            </div>`;
        }
        if (host.dataset.html !== html) {
            const focused = host.contains(document.activeElement);
            host.innerHTML = html;
            host.dataset.html = html;
            // What the highlights mean: its rule (S4.1.3), "?" before × in the open legend's heading.
            host.querySelector('.follow-legend-close')?.before(helpMark('following'));
            // Folding or opening keeps the keyboard where it was.
            if (focused) host.querySelector<HTMLElement>(open ? '.follow-legend-close' : '.follow-legend')?.focus();
        }
        if (mode === 'fan') liftOverFanLegend(host);
        else {
            host.style.bottom = '';
            reserveForFollow(document.getElementById('fan-legend'), null);
        }
    },

    /** Open or fold the legend (remembered while following runs). */
    setFollowLegend(open: boolean): void {
        setFollowLegendOpen(open);
        this.renderFollowLegend();
    },
});
