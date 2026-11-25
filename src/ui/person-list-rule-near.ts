/**
 * The editor of "Place and surroundings" (spec 136 §3.3): the place (the
 * tree's places, most used first, with a search), the surroundings in km
 * (place only · 5 · 10 · 25 · 50 · other…; on a phone a "within 10 km ▾"
 * choice), the events, "including places under it" (only when the place's
 * research record has places under it), and under them the places taken in
 * (`.plr-places`) with those without a location that may lie there. A
 * place's location is the Map's (geoOfKey); geocoding is never started here.
 */

import { strings } from '../strings.js';
import type { RuleNearEvent, RuleParamsMap } from '../types.js';
import { NEAR_MAX_KM, nearPlaces, placeHasBelow, rulePlaceChoices, treeHasPlaceCoords } from '../person-list-rules.js';
import { geoOfKey } from '../live-follow-map.js';
import { getUI } from '../ui-ref.js';
import { ctlPick, ctlSeg, escHtml, registerRuleCondEditor, typedInt, type RuleEditorCtx, type RulePickRow } from './person-list-rule-editors.js';

const KM_PRESETS = [0, 5, 10, 25, 50] as const;
const EVENTS: readonly RuleNearEvent[] = ['birth', 'death', 'marriage', 'residence'];
/** The places shown before "… and N more". */
const PLACES_SHOWN = 6;
/** A new "other…" distance. */
const KM_OTHER = 100;

/** The rows (path|place) whose places are unfolded. */
const unfolded = new Set<string>();

type Near = RuleParamsMap['near'];

/** The segment's choice of a distance: '0', '5', …, or 'other'. */
export function kmChoice(km: number): string {
    return (KM_PRESETS as readonly number[]).includes(km) ? String(km) : 'other';
}

function hasCenter(ctx: RuleEditorCtx, p: Near): boolean {
    return !!p.placeKey && !!geoOfKey(ctx.index.data, p.placeKey);
}

function openPlacesOnMap(ctx: RuleEditorCtx, key?: string): void {
    const overlay = ctx.host?.id;
    // The places of the tree without a location (the Map's own list); the dialog stays under it.
    getUI().showPlacesManager(key, overlay || undefined, 'tree', { unplaced: true });
}

registerRuleCondEditor('near', {
    group: 'c', order: 0,
    create: () => ({ placeKey: '', placeName: '', events: [...EVENTS], km: 0 }),
    paramsHtml: (cond, ctx) => {
        const t = strings.lists.rules;
        const n = t.near;
        const p = cond.p;
        const center = hasCenter(ctx, p);
        const place = ctlPick(ctx, 'place', t.pick.place, p.placeKey ? p.placeName || p.placeKey : t.pick.choose, !p.placeKey);
        const off = (v: string): string | false => v !== '0' && !center ? (treeHasPlaceCoords(ctx.index.data) ? n.noCoords : n.noneInTree) : false;
        const seg = ctlSeg(ctx, 'km', n.kmAria,
            [...KM_PRESETS.map(k => [String(k), k === 0 ? n.only : n.km(k)] as [string, string]), ['other', n.other]],
            kmChoice(p.km), { disabled: off, cls: 'plr-kmseg' });
        const other = kmChoice(p.km) === 'other'
            ? `<input type="number" class="pln-ctl plr-num plr-kmin" data-pc="kmn" data-key="${escHtml(ctx.key('kmn'))}" min="1" max="${NEAR_MAX_KM}" step="1"`
                + ` inputmode="numeric" value="${Number.isFinite(p.km) ? p.km : ''}" aria-label="${escHtml(n.kmInput)}"><span class="plr-u">km</span>`
            : '';
        // A phone: the distance as one control with a choice.
        const pick = ctlPick(ctx, 'kmpick', n.kmAria, p.km > 0 ? n.within(p.km) : n.only, false, 'plr-kmpick');
        const box = (name: string, on: boolean, label: string): string =>
            `<label class="plr-chk"><input type="checkbox" class="pln-ctl" data-pc="${escHtml(name)}" data-key="${escHtml(ctx.key(name))}"${on ? ' checked' : ''}>`
            + `<span>${escHtml(label)}</span></label>`;
        const events = `<span class="plr-evs" role="group" aria-label="${escHtml(n.eventsAria)}">`
            + EVENTS.map(e => box(`ev-${e}`, p.events.includes(e), t.say.events[e])).join('')
            + `</span>`;
        const below = p.placeKey && placeHasBelow(ctx.index.data, p.placeKey) ? box('below', !!p.below, n.below) : '';
        return place + seg + other + pick + events + below;
    },
    change: (cond, el) => {
        const p = cond.p;
        const name = el.dataset.pc ?? '';
        if (name === 'kmn') {
            const km = typedInt(el.value, 1, NEAR_MAX_KM);
            return { ...p, km: km ?? NaN };
        }
        if (name === 'below') {
            const next: Near = { ...p };
            if ((el as HTMLInputElement).checked) next.below = true; else delete next.below;
            return next;
        }
        if (name.startsWith('ev-')) {
            const ev = name.slice(3) as RuleNearEvent;
            const on = (el as HTMLInputElement).checked;
            const events = EVENTS.filter(e => e === ev ? on : p.events.includes(e));
            return { ...p, events };
        }
        return null;
    },
    input: (cond, el) => el.dataset.pc === 'kmn' ? { ...cond.p, km: typedInt(el.value, 1, NEAR_MAX_KM) ?? NaN } : null,
    click: (cond, el, ctx) => {
        const t = strings.lists.rules;
        const p = cond.p;
        const setKm = (v: string): void => {
            let km = v === 'other' ? (kmChoice(p.km) === 'other' ? p.km : KM_OTHER) : Number(v);
            if (!Number.isFinite(km)) km = KM_OTHER;
            if (km === p.km) return;
            ctx.update({ ...cond, p: { ...p, km } });
            if (v === 'other') requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`.pln-overlay [data-key="${CSS.escape(ctx.key('kmn'))}"]`)?.select());
        };
        switch (el.dataset.pc) {
            case 'place': {
                const rows: RulePickRow[] = rulePlaceChoices(ctx.index).map(pl => ({
                    id: pl.key, label: pl.name, value: strings.lists.persons(pl.persons), checked: pl.key === p.placeKey,
                }));
                ctx.menu(el, t.pick.place, rows, (key) => {
                    const pl = rows.find(r => r.id === key);
                    if (!pl || key === p.placeKey) return;
                    const next: Near = { ...p, placeKey: key, placeName: pl.label };
                    // Without a location the surroundings cannot count: the place only.
                    if (!geoOfKey(ctx.index.data, key)) next.km = 0;
                    if (!placeHasBelow(ctx.index.data, key)) delete next.below;
                    ctx.update({ ...cond, p: next });
                }, { wide: true, search: t.pick.search });
                return;
            }
            case 'km': setKm(el.dataset.v ?? '0'); return;
            case 'kmpick': {
                const center = hasCenter(ctx, p);
                const why = treeHasPlaceCoords(ctx.index.data) ? t.near.noCoords : t.near.noneInTree;
                const rows: RulePickRow[] = [...KM_PRESETS.map(k => String(k)), 'other'].map(v => ({
                    id: v, label: v === '0' ? t.near.only : v === 'other' ? t.near.other : t.near.within(Number(v)),
                    checked: kmChoice(p.km) === v, ...(v !== '0' && !center ? { disabled: true, why } : {}),
                }));
                ctx.menu(el, t.near.kmAria, rows, setKm);
                return;
            }
            case 'unfold': {
                const k = `${ctx.path}|${p.placeKey}`;
                if (unfolded.has(k)) unfolded.delete(k); else unfolded.add(k);
                ctx.update(cond);
                return;
            }
            case 'fixone': openPlacesOnMap(ctx, p.placeKey); return;
            case 'fix': case 'map': openPlacesOnMap(ctx); return;
        }
    },
    hintHtml: (cond, ctx) => {
        const n = strings.lists.rules.near;
        const p = cond.p;
        if (!p.placeKey) return '';
        const link = (name: string, text: string, expanded?: boolean): string =>
            `<button type="button" class="pl-link plr-link" data-pc="${name}" data-key="${escHtml(ctx.key(name))}"${expanded !== undefined ? ` aria-expanded="${expanded}"` : ''}>${escHtml(text)}</button>`;
        if (!treeHasPlaceCoords(ctx.index.data)) return `<span>${escHtml(n.noneInTree)}</span> ${link('map', n.openMap)}`;
        if (!hasCenter(ctx, p)) return `<span>${escHtml(n.noCoords)}</span> ${link('fixone', n.fixOne)}`;
        const { places, unplaced } = nearPlaces(ctx.index, p);
        if (!(p.km > 0)) return `<span>${escHtml(n.summary0(places.length))}</span>`;
        const open = unfolded.has(`${ctx.path}|${p.placeKey}`);
        let html = `<span>${escHtml(n.summary(p.km, places.length, unplaced.length))}</span> ${link('unfold', open ? n.hide : n.show, open)}`;
        if (!open) return html;
        const row = (name: string, km: string, persons: number): string =>
            `<li><span class="plr-pn">${escHtml(name)}</span><span class="plr-pk">${escHtml(km)}</span><span class="plr-pc">${escHtml(strings.lists.persons(persons))}</span></li>`;
        html += `<ul class="plr-places">${places.slice(0, PLACES_SHOWN).map(pl => row(pl.name, n.km(pl.km ?? 0), pl.persons)).join('')}`
            + (places.length > PLACES_SHOWN ? `<li class="plr-pmore">${escHtml(n.more(places.length - PLACES_SHOWN))}</li>` : '')
            + `</ul>`;
        if (unplaced.length) {
            html += `<div class="plr-plh">${escHtml(n.unplaced)}</div>`
                + `<ul class="plr-places plr-places--un">${unplaced.slice(0, PLACES_SHOWN).map(pl => row(pl.name, '?', pl.persons)).join('')}`
                + (unplaced.length > PLACES_SHOWN ? `<li class="plr-pmore">${escHtml(n.more(unplaced.length - PLACES_SHOWN))}</li>` : '')
                + `</ul>${link('fix', n.fixOnMap)}`;
        }
        return html;
    },
    firstControl: 'place',
    openOnAdd: true,
});
