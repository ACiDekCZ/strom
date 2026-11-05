/**
 * Following the research agent in the fan: the people worked on are marked
 * over the fan without drawing it again — an outline in the session's colour
 * (a dashed one on repeats), a pin outside the fan for a sector too narrow to
 * see, session numbers when two or more runs work at once, a signal (two
 * pulses) only when a run moves to another person, a hint at the edge for a
 * sector outside the view, and a label at the nearest person of the fan for
 * someone the fan does not draw (rows under the fan on a phone).
 * Put back after every draw of the fan (afterDraw) and on every change.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { PersonId } from '../types.js';
import { shownNameFull } from '../person-name.js';
import { isPhoneBar } from '../breakpoints.js';
import { FOCUS_R, FanModel } from '../fan-chart.js';
import { findFanAnchor, fanPeople, FanAnchor } from '../fan-follow-anchor.js';
import { FollowTarget, sessionTone } from '../live-follow-targets.js';
import { trailStrength } from '../live-follow-map.js';
import { getFollowTrail } from '../live-follow-prefs.js';
import { uiModule } from './module.js';
import { currentFollowTargets, followNumbered, followPinned, followTrail } from './live-follow-ui.js';
import type { FanMenuItemId } from './fan-view.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** A sector narrower than this on its outer arc gets a pin outside the fan (px). */
const NARROW_PX = 16;
/** A sector whose middle is this close to the view's edge counts as outside (px). */
const EDGE_MARGIN = 30;

function reducedMotion(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
}

function htmlEl<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

function nameOf(id: PersonId): string {
    const p = DataManager.getData().persons[id];
    return p ? shownNameFull(p) : '';
}

/** Geometry of a key of the model (null: the focus disc or none). */
function sectorGeom(model: FanModel, key: string): { r1: number; r2: number; lo: number; hi: number; desc: boolean } | null {
    const a = model.sectors.find(s => s.key === key);
    if (a) return { r1: a.r1, r2: a.r2, lo: a.lo, hi: a.hi, desc: false };
    const d = model.desc.find(s => s.key === key);
    return d ? { r1: d.r1, r2: d.r2, lo: d.lo, hi: d.hi, desc: true } : null;
}

/** The key of a person's first occurrence in the fan, and the keys of the repeats. */
function keysOf(model: FanModel, id: PersonId): { first: string | null; repeats: string[] } {
    if (model.focus.id === id) {
        const repeats = model.desc.filter(s => s.person?.id === id && s.repeatOfKey).map(s => s.key);
        return { first: 'f', repeats };
    }
    let first: string | null = null;
    const repeats: string[] = [];
    for (const s of model.sectors) {
        if (s.person?.id !== id) continue;
        if (s.repeatOf) repeats.push(s.key); else first ??= s.key;
    }
    for (const s of model.desc) {
        if (s.person?.id !== id) continue;
        if (s.repeatOfKey) repeats.push(s.key); else first ??= s.key;
    }
    return { first, repeats };
}

/** A sector's middle in fan units. */
function midOf(model: FanModel, key: string): { x: number; y: number } {
    const g = key === 'f' ? null : sectorGeom(model, key);
    if (!g) return { x: 0, y: 0 };
    const r = (g.r1 + g.r2) / 2, a = ((g.lo + g.hi) / 2) * Math.PI / 180;
    return { x: r * Math.cos(a), y: -r * Math.sin(a) };
}

/** Eight arrows by the direction (screen angle, y down). */
function arrowFor(dx: number, dy: number): string {
    const arrows = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
    const a = Math.atan2(dy, dx);
    const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
    return arrows[i];
}

/** The anchors already found: target | centre | rings | descendants → anchor. */
const anchorCache = new Map<string, FanAnchor>();

function anchorOf(model: FanModel, target: PersonId, visible: ReadonlySet<PersonId>): FanAnchor {
    const key = [target, model.focus.id, model.generations, model.descGenerations, model.shape].join('|');
    let a = anchorCache.get(key);
    if (!a) {
        if (anchorCache.size > 200) anchorCache.clear();
        a = findFanAnchor(DataManager.getData(), target, model, visible);
        anchorCache.set(key, a);
    }
    return a;
}

/** One label at an anchor (several people there make one label). */
interface ChipGroup {
    anchorId: PersonId | null;
    entries: Array<{ targets: FollowTarget[]; anchor: FanAnchor }>;
}

export const fanFollowMethods = uiModule({
    /** The marks of following over the fan (cleared when following does not apply). `pulse`: rows that changed. */
    applyFanFollowMarks(pulse?: Set<number>): void {
        const chart = document.getElementById('fan-chart');
        const stage = document.getElementById('fan-stage');
        const svg = chart?.querySelector<SVGSVGElement>('svg.fan-svg') ?? null;
        svg?.querySelectorAll('.fan-follow-layer').forEach(e => e.remove());
        svg?.querySelectorAll('.is-trail').forEach(e => {
            e.classList.remove('is-trail');
            (e as SVGElement).style.removeProperty('--trail-o');
        });
        svg?.querySelectorAll('.is-working, .is-working-repeat').forEach(e => {
            e.classList.remove('is-working', 'is-working-repeat');
            e.removeAttribute('data-follow-session');
            const t = e.querySelector(':scope > title');
            if (t?.getAttribute('data-follow-base') !== null && t) {
                t.textContent = t.getAttribute('data-follow-base');
                t.removeAttribute('data-follow-base');
            }
        });
        stage?.querySelector('.fan-follow-overlay')?.remove();
        const fan = TreeRenderer.getFanView();
        const model = fan?.getModel() ?? null;
        const zoom = fan?.getZoom() ?? null;
        if (!chart || !stage || !svg || !fan || !model || !zoom || TreeRenderer.getViewMode() !== 'fan') return;
        // The fan's redraw may take the legend along: put it back.
        if (!document.getElementById('follow-legend')) this.renderFollowLegend();
        const targets = currentFollowTargets();
        const trail = getFollowTrail() && !isPhoneBar() ? followTrail() : [];
        if (!targets.length && !trail.length) return;
        const numbered = followNumbered();
        const vb = zoom.viewBox();
        const ppu = vb.ppu || 1;
        const px = (n: number) => n / ppu;
        const layer = svgEl('g', { class: 'fan-follow-layer', 'pointer-events': 'none', 'aria-hidden': 'true' });
        svg.appendChild(layer);
        const visible = fanPeople(model);
        const motion = !reducedMotion();

        // The trail first (under the marks): a person the fan does not draw leaves it on the anchor;
        // a sector worked on now carries only the mark.
        if (trail.length) {
            const now = new Set<string>();
            for (const t of targets) {
                const k = keysOf(model, t.personId).first;
                if (k) now.add(k);
            }
            const spotOf = (pid: PersonId): string | null => {
                const k = keysOf(model, pid).first;
                if (k) return k;
                const a = anchorOf(model, pid, visible);
                return a.kind !== 'none' && a.anchorId ? keysOf(model, a.anchorId).first : null;
            };
            for (const [key, v] of trailStrength(trail, e => spotOf(e.personId), now)) {
                const el = svg.querySelector<SVGElement>(`[data-fan-key="${key}"]`);
                const attrs = { class: `fan-trail follow-${sessionTone(v.session)}`, style: `--trail-o: ${v.opacity}` };
                let shape: SVGElement | null = null;
                if (key === 'f') shape = svgEl('circle', { ...attrs, cx: 0, cy: 0, r: FOCUS_R });
                else {
                    const d = el?.querySelector('.fan-fill')?.getAttribute('d');
                    if (d) shape = svgEl('path', { ...attrs, d });
                }
                if (!shape) continue;
                shape.setAttribute('data-trail-key', key);
                layer.appendChild(shape);
                if (el) {
                    el.classList.add('is-trail');
                    el.style.setProperty('--trail-o', String(v.opacity));
                }
            }
        }

        const byPerson = new Map<PersonId, FollowTarget[]>();
        for (const t of targets) {
            const list = byPerson.get(t.personId) ?? [];
            list.push(t);
            byPerson.set(t.personId, list);
        }
        const outside: Array<{ targets: FollowTarget[]; anchor: FanAnchor }> = [];
        const edges: Array<{ key: string; targets: FollowTarget[] }> = [];
        const { W, H } = zoom.size();

        for (const [pid, list] of byPerson) {
            list.sort((a, b) => a.session - b.session);
            const lead = list[0];
            const tone = sessionTone(lead.session);
            const { first, repeats } = keysOf(model, pid);
            if (!first) {
                const anchor = anchorOf(model, pid, visible);
                if (anchor.kind !== 'in') outside.push({ targets: list, anchor });
                continue;
            }
            const title = list.map(t => strings.fan.workingTitle(t.task)
                + (numbered ? ` · ${strings.live.sessionN(t.session)}` : '')).join('\n');
            const el = svg.querySelector<SVGElement>(`[data-fan-key="${first}"]`);
            if (el) {
                el.classList.add('is-working');
                el.setAttribute('data-follow-session', String(lead.session));
                const t = el.querySelector(':scope > title');
                if (t) {
                    t.setAttribute('data-follow-base', t.textContent ?? '');
                    t.textContent = `${t.textContent ?? ''}\n${title}`;
                }
            }
            const shape = (cls: string, width: number): SVGElement => {
                const common = {
                    class: `${cls} follow-${tone}`, fill: 'none', 'stroke-width': width,
                    'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke',
                };
                if (first === 'f') return svgEl('circle', { ...common, cx: 0, cy: 0, r: FOCUS_R });
                const d = el?.querySelector('.fan-fill')?.getAttribute('d');
                return svgEl('path', { ...common, d: d ?? '' });
            };
            const drawable = first === 'f' || !!el?.querySelector('.fan-fill');
            if (drawable) {
                const glow = shape('fan-work-glow', 7);
                if (motion && list.some(t => pulse?.has(t.row))) {
                    glow.classList.add('is-pulse');
                    glow.addEventListener('animationend', () => glow.classList.remove('is-pulse'), { once: true });
                }
                layer.append(glow, shape('fan-work-line', 2.6));
            }
            for (const rk of repeats) {
                const rel = svg.querySelector<SVGElement>(`[data-fan-key="${rk}"]`);
                rel?.classList.add('is-working-repeat');
                const d = rel?.querySelector('.fan-fill')?.getAttribute('d');
                if (d) {
                    layer.appendChild(svgEl('path', {
                        class: `fan-work-weak follow-${tone}`, d, fill: 'none', 'stroke-width': 1.6,
                        'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke',
                    }));
                }
            }
            // A pin outside a narrow sector; a number inside a wide one (two or more sessions).
            const g = first === 'f' ? null : sectorGeom(model, first);
            const a = g ? ((g.lo + g.hi) / 2) * Math.PI / 180 : Math.PI / 2;
            const narrow = !!g && g.r2 * (g.hi - g.lo) * Math.PI / 180 * ppu < NARROW_PX;
            const nums = numbered ? list.map(t => t.session) : [];
            if (g && narrow) {
                const rt = g.desc ? model.Rd : model.R;
                const r0 = rt + px(4), r1 = rt + px(26);
                const pin = svgEl('g', { class: `fan-work-pin follow-${tone}` });
                pin.appendChild(svgEl('line', {
                    x1: r0 * Math.cos(a), y1: -r0 * Math.sin(a), x2: r1 * Math.cos(a), y2: -r1 * Math.sin(a),
                    'stroke-width': 2, 'vector-effect': 'non-scaling-stroke',
                }));
                if (!nums.length) pin.appendChild(svgEl('circle', { cx: r1 * Math.cos(a), cy: -r1 * Math.sin(a), r: px(4.5) }));
                layer.appendChild(pin);
                nums.forEach((n, i) => {
                    const rr = r1 + px(4 + i * 18);
                    layer.appendChild(this.fanFollowNumber(n, rr * Math.cos(a), -rr * Math.sin(a), ppu));
                });
            } else if (nums.length) {
                const rr = g ? g.r2 - px(12) : FOCUS_R - px(14);
                const cx = g ? rr * Math.cos(a) : 0, cy = g ? -rr * Math.sin(a) : -rr;
                nums.forEach((n, i) => {
                    // Two sessions on one person: the numbers side by side.
                    const off = (i - (nums.length - 1) / 2) * px(19);
                    const tx = g ? -Math.sin(a) * off : off, ty = g ? -Math.cos(a) * off : 0;
                    layer.appendChild(this.fanFollowNumber(n, cx + tx, cy + ty, ppu));
                });
            }
            // Outside the view: a hint at its edge.
            const pt = fan.sectorPoint(first);
            if (pt && (pt.x < EDGE_MARGIN || pt.x > W - EDGE_MARGIN || pt.y < EDGE_MARGIN || pt.y > H - EDGE_MARGIN)) {
                edges.push({ key: first, targets: list });
            }
        }

        if (!outside.length && !edges.length) return;
        const overlay = htmlEl('div', 'fan-follow-overlay');
        // The overlay covers the chart (stage px of the fan are the chart's).
        const sr = stage.getBoundingClientRect(), cr = chart.getBoundingClientRect();
        overlay.style.left = `${cr.left - sr.left}px`;
        overlay.style.top = `${cr.top - sr.top}px`;
        overlay.style.width = `${cr.width}px`;
        overlay.style.height = `${cr.height}px`;
        stage.appendChild(overlay);
        this.fanFollowEdges(overlay, model, edges, W, H);
        this.fanFollowChips(overlay, model, outside, numbered, W, H);
    },

    /** A session number in the fan (a circle in its colour, the number in the surface's colour). */
    fanFollowNumber(n: number, x: number, y: number, ppu: number): SVGElement {
        const g = svgEl('g', { class: `fan-work-num follow-${sessionTone(n)}` });
        g.appendChild(svgEl('circle', { cx: x, cy: y, r: 8.5 / ppu, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }));
        const t = svgEl('text', {
            x, y, 'font-size': 11 / ppu, 'font-weight': 700, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        });
        t.textContent = String(n);
        g.appendChild(t);
        return g;
    },

    /** A hint at the view's edge toward each person worked on outside it; a click pans there (zoom kept). */
    fanFollowEdges(overlay: HTMLElement, model: FanModel, edges: Array<{ key: string; targets: FollowTarget[] }>, W: number, H: number): void {
        const fan = TreeRenderer.getFanView();
        const zoom = fan?.getZoom();
        if (!fan || !zoom || !edges.length) return;
        const taken: Array<{ side: string; bottom: number; right: number }> = [];
        for (const e of edges) {
            const pt = fan.sectorPoint(e.key);
            if (!pt) continue;
            const lead = e.targets[0];
            const name = nameOf(lead.personId);
            const btn = htmlEl('button', 'fan-follow-edge');
            btn.type = 'button';
            btn.setAttribute('data-follow-session', String(lead.session));
            btn.classList.add(`follow-${sessionTone(lead.session)}`);
            btn.setAttribute('aria-label', strings.fan.edgeGo(name));
            btn.title = strings.fan.edgeGo(name);
            btn.append(htmlEl('span', 'fan-follow-edge-dot', arrowFor(pt.x - W / 2, pt.y - H / 2)), htmlEl('span', 'fan-follow-edge-name', name));
            overlay.appendChild(btn);
            const bw = btn.offsetWidth, bh = btn.offsetHeight;
            let x = Math.min(Math.max(pt.x - bw / 2, 8), W - bw - 8);
            let y = Math.min(Math.max(pt.y - bh / 2, 8), H - bh - 8);
            const side = pt.x < EDGE_MARGIN ? 'l' : pt.x > W - EDGE_MARGIN ? 'r' : pt.y < EDGE_MARGIN ? 't' : 'b';
            // Two on the same side: one under the other.
            for (const t of taken) if (t.side === side && y < t.bottom + 8 && Math.abs(x - t.right + bw) < bw + 8) y = t.bottom + 8;
            y = Math.min(y, H - bh - 8);
            x = Math.max(8, x);
            btn.style.left = `${Math.round(x)}px`;
            btn.style.top = `${Math.round(y)}px`;
            taken.push({ side, bottom: y + bh, right: x + bw });
            const mid = midOf(model, e.key);
            btn.addEventListener('click', () => zoom.animateTo({ z: zoom.zoom(), cx: mid.x, cy: mid.y }));
        }
    },

    /** Labels of people worked on that the fan does not draw, at their anchors (rows on a phone). */
    fanFollowChips(overlay: HTMLElement, model: FanModel, outside: Array<{ targets: FollowTarget[]; anchor: FanAnchor }>, numbered: boolean, W: number, H: number): void {
        if (!outside.length) return;
        const fan = TreeRenderer.getFanView();
        const zoom = fan?.getZoom();
        if (!fan || !zoom) return;
        const lang = getCurrentLanguage();
        const F = strings.fan;
        const groups = new Map<string, ChipGroup>();
        for (const o of outside) {
            const k = o.anchor.anchorId ?? '';
            const g = groups.get(k) ?? { anchorId: o.anchor.anchorId, entries: [] };
            g.entries.push(o);
            groups.set(k, g);
        }
        const rows = isPhoneBar();
        const list = rows ? htmlEl('div', 'fan-follow-rows') : null;
        if (list) {
            overlay.appendChild(list);
            // Upright, the fan stands low (above the strip) and the room above it is empty: the rows there,
            // under the pills at its top (the centre pin, the original person, the paused pill).
            if (!matchMedia('(orientation: landscape) and (max-height: 500px)').matches) {
                const place = (): void => {
                    const box = overlay.getBoundingClientRect();
                    let clear = 8;
                    for (const sel of ['#fan-center-pin', '#fan-origin-pill', '#fan-legend-chip', '#live-follow-pill', '#evidence-pill']) {
                        const el = document.querySelector<HTMLElement>(sel);
                        const r = el && !el.hidden ? el.getBoundingClientRect() : null;
                        if (r && r.height > 0 && r.top < box.top + box.height / 2) clear = Math.max(clear, r.bottom - box.top + 8);
                    }
                    list.style.top = `${Math.round(clear)}px`;
                    list.style.bottom = 'auto';
                };
                place();
                // The pills are placed after the fan's drawing: once more when they stand.
                requestAnimationFrame(() => requestAnimationFrame(() => { if (list.isConnected) place(); }));
            }
        }
        const lines = rows ? null : svgEl('svg', { class: 'fan-follow-leads', width: W, height: H, 'aria-hidden': 'true' }) as SVGSVGElement;
        if (lines) overlay.appendChild(lines);
        const centre = fan.sectorPoint('f') ?? { x: W / 2, y: H / 2 };
        const vb = zoom.viewBox();
        const placed: Array<{ el: HTMLElement; side: 'l' | 'r' | 't'; x: number; y: number; ax: number; ay: number; tone: string; lead: boolean }> = [];
        // Above the fan, on the centre's vertical: where a label stands that has no ray of its own.
        const top = { x: centre.x, y: centre.y - Math.max(model.R, model.Rd) * vb.ppu - 12 };

        const relText = (o: { anchor: FanAnchor }): string => {
            if (o.anchor.kind === 'beyond') return F.genN(o.anchor.generation ?? 0);
            return o.anchor.term ? o.anchor.term[lang] : '';
        };

        for (const g of groups.values()) {
            const lead = g.entries.map(e => e.targets[0]).sort((a, b) => a.session - b.session)[0];
            const tone = sessionTone(lead.session);
            const chip = htmlEl('button', `fan-follow-chip follow-${tone}`);
            chip.type = 'button';
            chip.setAttribute('data-follow-session', String(lead.session));
            if (g.anchorId) chip.setAttribute('data-anchor', g.anchorId);
            const mark = numbered ? htmlEl('span', 'fan-follow-chip-num', String(lead.session)) : htmlEl('span', 'fan-follow-chip-dot');
            mark.setAttribute('aria-hidden', 'true');
            const text = htmlEl('span', 'fan-follow-chip-text');
            const head = htmlEl('span', 'fan-follow-chip-head');
            let sub = '';
            if (g.entries.length === 1) {
                const e = g.entries[0];
                const pid = e.targets[0].personId;
                chip.setAttribute('data-person', pid);
                const name = htmlEl('b', '', nameOf(pid));
                if (e.anchor.kind === 'none') {
                    head.append(`${F.workOutside} `, name);
                    sub = F.noRelation(nameOf(model.focus.id));
                } else {
                    const rel = relText(e);
                    head.append(`${F.workOn} `, name, rel ? ` (${rel})` : '');
                    if (e.anchor.kind === 'beyond' && g.anchorId) {
                        const term = findTerm(e.anchor, lang);
                        sub = F.genSub(term, nameOf(g.anchorId), model.generations);
                    }
                }
                chip.title = e.targets.map(t => F.workingTitle(t.task)).join('\n');
                chip.addEventListener('click', () => this.followToPerson(pid));
            } else {
                head.textContent = F.nPeople(g.entries.length);
                sub = g.entries.map(e => {
                    const rel = relText(e);
                    return `${nameOf(e.targets[0].personId)}${rel ? ` (${rel})` : ''}`;
                }).join(' · ');
                chip.setAttribute('aria-haspopup', 'menu');
                chip.addEventListener('click', () => this.fanFollowChipMenu(chip, g));
            }
            text.appendChild(head);
            if (sub) text.appendChild(htmlEl('span', 'fan-follow-chip-sub', sub));
            chip.append(mark, text);
            (list ?? overlay).appendChild(chip);

            // The anchor's dot (also on a phone, where the label is a row under the fan).
            const ap = g.anchorId ? fan.pointOfPerson(g.anchorId) : null;
            if (ap && lines) lines.appendChild(svgEl('circle', { class: `fan-follow-dot follow-${tone}`, cx: ap.x, cy: ap.y, r: 3.5 }));
            if (list) {
                if (ap) {
                    const dot = htmlEl('span', `fan-follow-anchor-dot follow-${tone}`);
                    dot.style.left = `${Math.round(ap.x)}px`;
                    dot.style.top = `${Math.round(ap.y)}px`;
                    overlay.appendChild(dot);
                }
                continue;
            }
            // Where: out on the anchor's ray, past the fan's edge. No anchor, or the centre itself (a sibling,
            // a spouse or a descendant of the centre): above the fan, no leader line across the rings (the
            // label names the relation to the centre; its dot marks the centre).
            if (!ap || !g.anchorId || g.anchorId === model.focus.id) {
                if (!ap || !g.anchorId) chip.classList.add('is-corner');
                chip.style.maxWidth = `${Math.min(300, W - 24)}px`;
                placed.push({ el: chip, side: 't', x: top.x, y: top.y, ax: ap?.x ?? top.x, ay: ap?.y ?? top.y, tone, lead: false });
                continue;
            }
            const isDesc = model.desc.some(s => s.person?.id === g.anchorId) && !model.sectors.some(s => s.person?.id === g.anchorId);
            const rt = (isDesc ? model.Rd : Math.max(model.R, model.Rd)) * vb.ppu + 12;
            let dx = ap.x - centre.x, dy = ap.y - centre.y;
            const len = Math.hypot(dx, dy);
            if (len < 1) { dx = 0; dy = -1; } else { dx /= len; dy /= len; }
            const px = centre.x + dx * rt, py = centre.y + dy * rt;
            const side: 'l' | 'r' | 't' = dx < -0.35 ? 'l' : dx > 0.35 ? 'r' : 't';
            const room = side === 'l' ? px : side === 'r' ? W - px : W;
            chip.style.maxWidth = `${Math.max(140, Math.min(290, room - 18))}px`;
            placed.push({ el: chip, side, x: px, y: py, ax: ap.x, ay: ap.y, tone, lead: true });
        }

        // What stands over the surface (the research's card, the legend, the zoom buttons, the pills): a label
        // there would be hidden under it.
        const or = overlay.getBoundingClientRect();
        const obstacles = ['#live-panel', '#fan-legend', '#fan-legend-chip', '#fan-zoom-controls', '#evidence-pill',
            '#live-follow-pill', '#fan-center-pin', '#fan-origin-pill']
            .map(sel => document.querySelector<HTMLElement>(sel))
            .filter((el): el is HTMLElement => !!el && !el.hidden && el.getClientRects().length > 0)
            .map(el => el.getBoundingClientRect())
            .filter(r => r.width > 0 && r.height > 0)
            .map(r => ({ left: r.left - or.left, right: r.right - or.left, top: r.top - or.top, bottom: r.bottom - or.top }));
        const GAP = 8;
        const clear = (el: HTMLElement, x: number, y: number): { x: number; y: number; w: number; h: number } => {
            let w = el.offsetWidth, h = el.offsetHeight;
            for (let pass = 0; pass < 4; pass++) {
                const o = obstacles.find(b => b.left < x + w + GAP && b.right > x - GAP && b.top < y + h + GAP && b.bottom > y - GAP);
                if (!o) break;
                // Beside it, on the fan's side (as wide as a label gets there); where there is no room, under it.
                const left = o.left + (o.right - o.left) / 2 > W / 2;
                const room = left ? o.left - GAP - 8 : W - 8 - o.right - GAP;
                if (room >= 140) {
                    el.style.maxWidth = `${Math.min(290, room)}px`;
                    w = el.offsetWidth; h = el.offsetHeight;
                    x = left ? o.left - w - GAP : o.right + GAP;
                    y = Math.min(y, H - h - 8);
                } else if (o.bottom + GAP + h <= H - 8) y = o.bottom + GAP;
                else y = Math.max(8, o.top - h - GAP);
            }
            return { x, y, w, h };
        };

        // Lay the labels out: per side by height, none over another, none outside the surface nor under
        // what stands over it.
        for (const side of ['l', 'r', 't'] as const) {
            const mine = placed.filter(p => p.side === side).sort((a, b) => a.y - b.y);
            let floor = 8;
            for (const p of mine) {
                const w = p.el.offsetWidth, h = p.el.offsetHeight;
                let x = side === 'l' ? p.x - w : side === 'r' ? p.x : p.x - w / 2;
                let y = side === 't' ? p.y - h : p.y - h / 2;
                x = Math.min(Math.max(x, 8), W - w - 8);
                y = Math.max(y, floor);
                y = Math.min(y, H - h - 8);
                const moved = clear(p.el, x, y);
                x = moved.x; y = moved.y;
                const cw = moved.w, ch = moved.h;
                floor = y + ch + 8;
                p.el.style.left = `${Math.round(x)}px`;
                p.el.style.top = `${Math.round(y)}px`;
                if (lines && p.lead) {
                    // The edge towards the ray (a label moved beside what stands over it may sit on the other side).
                    const ex = side === 't' ? x + cw / 2 : p.x >= x + cw ? x + cw : p.x <= x ? x : side === 'l' ? x + cw : x;
                    const ey = side === 't' ? y + ch : y + ch / 2;
                    lines.insertBefore(svgEl('polyline', {
                        class: `fan-follow-lead follow-${p.tone}`, fill: 'none', 'stroke-width': 1.4,
                        points: `${p.ax},${p.ay} ${side === 't' ? ex : p.x},${side === 't' ? p.y : ey} ${ex},${ey}`,
                    }), lines.firstChild);
                }
            }
        }
    },

    /** Several people at one anchor: a small menu of them; a click goes to that person. */
    fanFollowChipMenu(chip: HTMLElement, g: ChipGroup): void {
        const overlay = chip.parentElement?.closest('.fan-follow-overlay') ?? chip.parentElement;
        overlay?.querySelector('.fan-follow-menu')?.remove();
        if (!overlay) return;
        const menu = htmlEl('div', 'fan-follow-menu');
        menu.setAttribute('role', 'menu');
        for (const e of g.entries) {
            const pid = e.targets[0].personId;
            const item = htmlEl('button', 'fan-follow-menu-item', nameOf(pid));
            item.type = 'button';
            item.setAttribute('role', 'menuitem');
            item.setAttribute('data-person', pid);
            item.addEventListener('click', () => { menu.remove(); this.followToPerson(pid); });
            menu.appendChild(item);
        }
        overlay.appendChild(menu);
        const cr = chip.getBoundingClientRect(), or = (overlay as HTMLElement).getBoundingClientRect();
        menu.style.left = `${Math.round(Math.max(8, Math.min(cr.left - or.left, or.width - menu.offsetWidth - 8)))}px`;
        menu.style.top = `${Math.round(Math.min(cr.bottom - or.top + 4, or.height - menu.offsetHeight - 8))}px`;
        (menu.querySelector('button') as HTMLButtonElement | null)?.focus();
        const close = (ev: Event): void => {
            if (ev instanceof KeyboardEvent && ev.key !== 'Escape') return;
            if (ev.type === 'pointerdown' && menu.contains(ev.target as Node)) return;
            menu.remove();
            document.removeEventListener('pointerdown', close, true);
            document.removeEventListener('keydown', close, true);
        };
        setTimeout(() => {
            document.addEventListener('pointerdown', close, true);
            document.addEventListener('keydown', close, true);
        }, 0);
    },

    /** The pin / release items of a person's menu in the fan while following. */
    fanFollowMenuItems(id: PersonId, _isCentre: boolean): Array<{ id: FanMenuItemId; label: string; run: () => void }> {
        if (this.liveFollowFanCenter() === null) return [];
        if (followPinned() === id) return [{ id: 'unpin', label: strings.fan.unpin, run: () => this.unpinFanCenter() }];
        return [{ id: 'pin', label: strings.fan.pin, run: () => this.pinFanCenter(id) }];
    },
});

/** The anchor's relation for the sub-row ("great-grandmother"). */
function findTerm(anchor: FanAnchor, lang: ReturnType<typeof getCurrentLanguage>): string {
    return anchor.term ? anchor.term[lang] : '';
}
