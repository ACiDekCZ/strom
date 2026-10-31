/**
 * The Fan view (spec 029 §1–§3, §6, §9.4–§9.5): the fan SVG filling its
 * stage with zoom and pan (FanZoom), the view's toolbar (shape, generations,
 * descendants, colours), the zoom buttons, the legend (a card; on a phone a
 * chip that opens a sheet with the colour choice) and the browser's print.
 *
 * The renderer owns the settings (persisted on the device) and the focus; it
 * hands them in through `FanViewHost` and calls `render()` whenever the view
 * is drawn. A change of focus, shape or generations starts from the whole fan;
 * colours and the legend keep the zoom.
 *
 * Interaction (§5, §1.7, §7.2): a tap re-centres on the person (the old fan
 * grows away from the tap, the new one comes in from its centre), the focus
 * disc steps back, the "↺ Original person" pill returns to the person the
 * view opened with; leaving the view forgets that way back (`deactivate`).
 * A long press, a right click or Shift+F10 opens the sector's menu (a sheet
 * on touch, a context menu at the cursor with a mouse). Keys move between
 * the sectors with one tab stop (roving tabindex); a repeated person shows
 * where it first appears.
 */

import type { PersonId, StromData } from '../types.js';
import {
    buildFanModel, buildFanSvg, fanLineages, FanModel, FanShape, FanSvgOptions,
} from '../fan-chart.js';
import { FanColorMode, FanTheme, fanLegend, fanHasRepeats, fanRodColors, FanLegendItem } from '../fan-colors.js';
import { fanScreenSizes, clearFanMeasureCache } from '../fan-labels.js';
import { FanZoom, FanView as FanZoomView, FanZoomPoint } from '../fan-zoom.js';
import { fanNavNodes, fanNavMove, FanNavDir } from '../fan-nav.js';
import { fanYears } from '../fan-labels.js';
import { shownNameFull } from '../person-name.js';
import { strings } from '../strings.js';
import { syncDepthStepper } from './depth-stepper.js';
import { isMobile } from '../breakpoints.js';
import { FAN_STORAGE_KEYS } from '../storage-keys.js';

export interface FanViewSettings {
    generations: number;
    descGenerations: number;
    shape: FanShape;
    colorMode: FanColorMode;
}

/** What the view needs of the app (the renderer). */
export interface FanViewHost {
    data(): StromData;
    focusId(): PersonId | null;
    settings(): FanViewSettings;
    setGenerations(n: number): void;
    setDescGenerations(n: number): void;
    setShape(shape: FanShape): void;
    setColorMode(mode: FanColorMode): void;
    /** The Fan view is the one shown. */
    active(): boolean;
    /** Re-centre the app (and the fan) on a person. */
    setFocus(id: PersonId): void;
    /** The "+" of an empty slot (editing only). */
    addParent(childId: PersonId, gender?: 'male' | 'female'): void;
    /** The tree can be edited (empty slots get their "+"). */
    editable(): boolean;
    showKekule(): boolean;
    esc(text: string): string;
    relTypeLabel: FanSvgOptions['relTypeLabel'];
    addParentLabel(): string;
    /** After every redraw of the SVG (the evidence highlight is put back). */
    afterDraw(): void;
    /** The person's detail (the same dialog as elsewhere; read-only where the tree is). */
    personDetail(id: PersonId): void;
    /** The person's page. */
    personPage(id: PersonId): void;
    /** A menu as the app's bottom sheet; `onClose` runs once it closes (any way). */
    menuSheet(menu: FanMenuSpec, onClose: () => void): void;
    /** Close that sheet. */
    hideMenuSheet(): void;
}

/** One sector's menu (§5.4). */
export interface FanMenuSpec {
    title: string;
    /** Years and the number ("1781–1840 · no. 6"). */
    sub: string;
    items: Array<{ id: FanMenuItemId; label: string; kbd?: string; run: () => void }>;
}

export type FanMenuItemId = 'recenter' | 'detail' | 'page' | 'first' | 'add';

/** §5.5: the re-centring swap. */
const SWAP_MS = 320;
const FADE_MS = 200;
const FLASH_MS = 1800;

function reducedMotion(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function coarsePointer(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/** The pending swap: the old drawing (a copy over the stage) waits for the new focus. */
interface Swap {
    layer: HTMLElement;
    kind: 'zoom' | 'fade';
    point: FanZoomPoint;
    timer: ReturnType<typeof setTimeout>;
}

const SVG_UID = 'fan-svg-main';

function readLegendOpen(): boolean | null {
    try {
        const v = localStorage.getItem(FAN_STORAGE_KEYS.legendOpen);
        return v === '1' ? true : v === '0' ? false : null;
    } catch { return null; }
}

export class FanViewController {
    private readonly host: FanViewHost;
    private container: HTMLElement | null = null;
    private chart: HTMLElement | null = null;
    private zoom: FanZoom | null = null;
    private model: FanModel | null = null;
    private modelKey = '';
    private redrawFrame = 0;
    private legendOpen: boolean;
    /** The view the screen showed before the browser printed the whole fan. */
    private printView: FanZoomView | null = null;
    private printing = false;
    private sheetReturn: HTMLElement | null = null;

    // ---- re-centring (§5.2)
    /** The person the view opened with (null outside the view). */
    private origin: PersonId | null = null;
    /** The focuses before the current one (the disc's "↶ back"). */
    private history: PersonId[] = [];
    /** The focus last drawn. */
    private shown: PersonId | null = null;
    /** How the coming focus change was asked for here (null: from elsewhere — search, ↩). */
    private pendingNav: 'back' | 'origin' | null = null;
    private swap: Swap | null = null;
    private swapAnims: Animation[] = [];
    private pill: HTMLButtonElement | null = null;
    /** Where the toolbar ended when last published ('' while it is not shown). */
    private toolbarBottom = '';
    private pillTimer: ReturnType<typeof setTimeout> | null = null;

    // ---- menu (§5.4)
    private menuEl: HTMLElement | null = null;
    private menuKey: string | null = null;
    private menuCleanup: (() => void) | null = null;
    private menuOpenedAt = 0;
    private ring: HTMLElement | null = null;
    /** A press that closed the menu doesn't tap the sector under it. */
    private ignoreTapUntil = 0;

    // ---- keys and the first occurrence (§1.7, §7.2)
    /** The one sector in the tab order. */
    private rovingKey = 'f';
    private flashKey: string | null = null;
    private flashTimer: ReturnType<typeof setTimeout> | null = null;
    /** The next draw puts the keyboard focus (if it is in the fan) on the focus disc. */
    private refocusDisc = false;

    constructor(host: FanViewHost) {
        this.host = host;
        // §0.5: open on a computer, closed on a phone (where the legend is a chip and a sheet).
        this.legendOpen = readLegendOpen() ?? !isMobile();
    }

    /** The current fan model (null before the first draw or without a focus). */
    getModel(): FanModel | null {
        return this.model;
    }

    /** The zoom of the view (null before the first draw). */
    getZoom(): FanZoom | null {
        return this.zoom;
    }

    // ------------------------------------------------------------ drawing

    /** Draw the view into its container (#fan-container). */
    render(container: HTMLElement): void {
        this.container = container;
        if (!container.dataset.wired) {
            container.dataset.wired = '1';
            this.wire(container);
        }
        this.chart = container.querySelector('#fan-chart');
        this.wireSectors();
        this.syncToolbar();
        const focus = this.host.focusId();
        const chart = this.chart;
        if (!chart || !focus) return;

        const changed = this.trackFocus(focus);
        if (changed) { this.closeMenu(false); this.clearFlash(false); this.rovingKey = 'f'; this.refocusDisc = true; }
        const set = this.host.settings();
        const model = buildFanModel(this.host.data(), focus, {
            generations: set.generations, shape: set.shape, descGenerations: set.descGenerations,
        });
        this.model = model;
        if (!model) { chart.innerHTML = ''; this.renderLegend(); return; }
        const zoom = this.ensureZoom(chart, model);
        // §1.6: a new focus, shape or depth (or a frame that grew) starts from the whole fan.
        const b = model.bounds;
        const key = [focus, model.shape, model.generations, model.descGenerations, b.x, b.y, b.w, b.h].map(String).join('|');
        if (key !== this.modelKey) {
            this.modelKey = key;
            zoom.setBounds(b);
        }
        this.draw();
        this.renderLegend();
        if (changed) this.playSwap();
        this.updatePill();
    }

    /** Redraw the SVG for the current zoom (colours, labels after a gesture). */
    redraw(): void {
        if (!this.model || !this.chart) return;
        this.draw();
        this.syncToolbar();
        this.renderLegend();
    }

    private draw(): void {
        const chart = this.chart, model = this.model, zoom = this.zoom;
        if (!chart || !model || !zoom) return;
        if (this.redrawFrame) { cancelAnimationFrame(this.redrawFrame); this.redrawFrame = 0; }
        const vb = this.printing ? { ...model.bounds, ppu: zoom.viewBox().ppu } : zoom.viewBox();
        const active = document.activeElement;
        const keyFocused = active instanceof Element && active !== chart && chart.contains(active)
            ? active.closest('[data-fan-key]')?.getAttribute('data-fan-key') ?? null : null;
        chart.innerHTML = buildFanSvg(model, {
            esc: this.host.esc,
            editable: this.host.editable(),
            addParentLabel: this.host.addParentLabel(),
            showKekule: this.host.showKekule(),
            relTypeLabel: this.host.relTypeLabel,
            colorMode: this.host.settings().colorMode,
            ppu: vb.ppu,
            viewport: { x: vb.x, y: vb.y, w: vb.w, h: vb.h },
            sizes: fanScreenSizes(isMobile()),
            uid: SVG_UID,
            ...this.svgExtras(),
        });
        this.setupSectors(keyFocused);
        this.host.afterDraw();
    }

    /** Extra options of the drawing: the outlined first occurrence, the way back in the focus disc. */
    protected svgExtras(): Partial<FanSvgOptions> {
        const extras: Partial<FanSvgOptions> = {};
        if (this.flashKey) extras.marks = [this.flashKey];
        const back = this.backTarget();
        if (back) {
            const p = this.host.data().persons[back];
            extras.focusBack = { row: strings.fan.backRow, title: strings.fan.backTo(p ? shownNameFull(p) : '') };
        }
        return extras;
    }

    /** The labels again for the new scale, in the next frame (several changes, one redraw). */
    private scheduleRedraw(): void {
        if (this.redrawFrame) return;
        this.redrawFrame = requestAnimationFrame(() => {
            this.redrawFrame = 0;
            if (this.host.active()) this.draw();
        });
    }

    private ensureZoom(chart: HTMLElement, model: FanModel): FanZoom {
        if (this.zoom) return this.zoom;
        this.zoom = new FanZoom({
            surface: chart,
            mode: 'view',
            bounds: model.bounds,
            controls: this.container?.querySelector<HTMLElement>('#fan-zoom-controls') ?? null,
            onTap: (target, point) => this.tap(target, point),
            onLongPress: (target, point) => this.pressMenu(target, point, 'sheet'),
            onContextMenu: (target, point, e) => this.pressMenu(target, point, 'context', e),
            onViewChange: () => this.scheduleRedraw(),
        });
        return this.zoom;
    }

    // ------------------------------------------------------------ taps

    private tap(target: Element | null, point: FanZoomPoint): void {
        if (this.busy() || performance.now() < this.ignoreTapUntil) return;
        const el = target?.closest?.('[data-fan-person], [data-fan-add]') ?? null;
        if (!el) return;
        const person = el.getAttribute('data-fan-person');
        if (el.getAttribute('data-fan-kind') === 'focus') { this.onFocusTap(point); return; }
        if (person) { this.onSectorTap(person as PersonId, el, point); return; }
        // §5.1: an empty slot (editing) offers adding the father or the mother.
        if (el.getAttribute('data-fan-add') && this.host.editable()) {
            this.openMenu(el, point, coarsePointer() || isMobile() ? 'sheet' : 'context');
        }
    }

    /** A sector of a person: re-centre on them. */
    protected onSectorTap(person: PersonId, _sector: Element, point: FanZoomPoint): void {
        this.recenter(person, point);
    }

    /** The focus disc: a step back when there is one. */
    protected onFocusTap(_point: FanZoomPoint): void {
        this.goBack();
    }

    // ------------------------------------------------------------ re-centring (§5.2, §5.5)

    /**
     * Note a new focus (called on every render). The first one in the view is
     * the origin; a step taken here or elsewhere (search, the app's ↩) goes
     * into the history — one that returns to the last entry takes it out.
     */
    private trackFocus(focus: PersonId): boolean {
        if (!this.origin || !this.shown) {
            this.origin = focus;
            this.shown = focus;
            this.history = [];
            this.pendingNav = null;
            return false;
        }
        if (focus === this.shown) return false;
        const nav = this.pendingNav;
        this.pendingNav = null;
        if (nav === 'origin') this.history = [];
        else if (nav !== 'back') {
            if (this.history[this.history.length - 1] === focus) this.history.pop();
            else this.history.push(this.shown);
        }
        this.shown = focus;
        const persons = this.host.data().persons;
        // People deleted meanwhile drop out of the way back.
        this.history = this.history.filter((id, i, all) => !!persons[id] && id !== all[i - 1]);
        while (this.history[this.history.length - 1] === focus) this.history.pop();
        if (this.origin && !persons[this.origin]) this.origin = focus;
        return true;
    }

    /** Where "↶ back" leads (null: nowhere). */
    private backTarget(): PersonId | null {
        return this.history[this.history.length - 1] ?? null;
    }

    /**
     * The view is left (another view, another tree): the way back and the
     * origin are forgotten, an open menu closes. Cheap and idempotent — the
     * renderer calls it on every render of another view.
     */
    deactivate(): void {
        if (!this.origin && !this.shown && !this.menuKey && !this.swap && !this.flashKey) return;
        this.origin = null;
        this.shown = null;
        this.history = [];
        this.pendingNav = null;
        this.closeMenu(false);
        this.endSwap();
        this.clearFlash(false);
        this.rovingKey = 'f';
        this.updatePill(true);
    }

    /** The way back is there (tests read it). */
    getHistory(): readonly PersonId[] {
        return this.history;
    }

    getOrigin(): PersonId | null {
        return this.origin;
    }

    private busy(): boolean {
        return !!this.swap || this.swapAnims.length > 0;
    }

    private recenter(id: PersonId, point?: FanZoomPoint): void {
        if (this.busy() || id === this.host.focusId()) return;
        this.beginSwap('zoom', point);
        this.host.setFocus(id);
    }

    private goBack(): void {
        const prev = this.backTarget();
        if (!prev || this.busy()) return;
        this.history.pop();
        this.pendingNav = 'back';
        this.beginSwap('fade');
        this.host.setFocus(prev);
    }

    private goOrigin(): void {
        const origin = this.origin;
        if (!origin || origin === this.host.focusId() || this.busy()) return;
        this.pendingNav = 'origin';
        this.beginSwap('fade');
        this.host.setFocus(origin);
    }

    /**
     * Keep a copy of the drawing over the stage until the new focus is drawn
     * (reduced motion: none — the fans swap at once). The copy carries no
     * sector attributes, classes or ids of the live drawing.
     */
    private beginSwap(kind: Swap['kind'], point?: FanZoomPoint): void {
        this.endSwap();
        const chart = this.chart;
        const svg = chart?.querySelector('svg.fan-svg');
        if (!chart || !svg || reducedMotion() || typeof chart.animate !== 'function') return;
        const layer = document.createElement('div');
        layer.className = 'fan-swap-old';
        layer.setAttribute('aria-hidden', 'true');
        layer.appendChild(this.ghostOf(svg as SVGSVGElement));
        chart.after(layer);
        const { W, H } = this.zoom?.size() ?? { W: chart.clientWidth, H: chart.clientHeight };
        // Taps wait for the swap; a focus that never comes (refused) lets them go again.
        const timer = setTimeout(() => this.endSwap(), 1500);
        this.swap = { layer, kind, point: point ?? { x: W / 2, y: H / 2 }, timer };
    }

    /** A copy of the drawing for the swap: nothing in it answers to the live fan's selectors. */
    private ghostOf(svg: SVGSVGElement): SVGSVGElement {
        const copy = svg.cloneNode(true) as SVGSVGElement;
        copy.querySelectorAll('title').forEach(t => t.remove());
        const rename = (v: string) => v.replace(/(^|[\s#(])fan-/g, '$1fanold-');
        for (const el of [copy, ...copy.querySelectorAll('*')]) {
            for (const a of [...el.attributes]) {
                if (a.name.startsWith('data-fan')) el.removeAttribute(a.name);
                else if (a.name === 'id' || a.name === 'class' || a.name === 'href' || a.name === 'xlink:href' || /url\(#/.test(a.value)) {
                    el.setAttribute(a.name, rename(a.value));
                }
            }
        }
        copy.querySelectorAll('style').forEach(st => { st.textContent = (st.textContent ?? '').replace(/([.#])fan-/g, '$1fanold-'); });
        copy.removeAttribute('tabindex');
        copy.setAttribute('focusable', 'false');
        return copy;
    }

    /** The new focus is drawn: the old fan leaves, the new one comes (§5.5). */
    private playSwap(): void {
        const swap = this.swap;
        const chart = this.chart;
        if (!swap || !chart) return;
        clearTimeout(swap.timer);
        this.swap = null;
        const { layer } = swap;
        const done = () => { layer.remove(); this.swapAnims = []; };
        let out: Animation, inn: Animation;
        if (swap.kind === 'zoom') {
            const vb = this.zoom!.viewBox();
            layer.style.transformOrigin = `${swap.point.x}px ${swap.point.y}px`;
            chart.style.transformOrigin = `${(0 - vb.x) * vb.ppu}px ${(0 - vb.y) * vb.ppu}px`;
            out = layer.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.5)' }],
                { duration: SWAP_MS, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
            inn = chart.animate([{ opacity: 0, transform: 'scale(0.85)' }, { opacity: 1, transform: 'scale(1)' }],
                { duration: SWAP_MS, easing: 'cubic-bezier(.2,.7,.3,1)' });
        } else {
            out = layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease', fill: 'forwards' });
            inn = chart.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease' });
        }
        this.swapAnims = [out, inn];
        out.onfinish = done;
        out.oncancel = done;
    }

    private endSwap(): void {
        if (this.swap) {
            clearTimeout(this.swap.timer);
            this.swap.layer.remove();
            this.swap = null;
        }
        for (const a of this.swapAnims) a.cancel();
        this.swapAnims = [];
        this.stage()?.querySelectorAll('.fan-swap-old').forEach(el => el.remove());
    }

    private stage(): HTMLElement | null {
        return this.container?.querySelector<HTMLElement>('#fan-stage') ?? null;
    }

    // ------------------------------------------------------------ the origin pill

    /** "↺ Original person · Name" while the focus is another person (fades when it returns). */
    private updatePill(now = false): void {
        const pill = this.pill;
        if (!pill) return;
        const origin = this.origin;
        const focus = this.host.focusId();
        const show = !!origin && !!focus && origin !== focus && this.host.active();
        if (this.pillTimer) { clearTimeout(this.pillTimer); this.pillTimer = null; }
        if (show) {
            const p = this.host.data().persons[origin!];
            const name = p ? shownNameFull(p) : '';
            const nameEl = pill.querySelector<HTMLElement>('.fan-origin-name');
            if (nameEl) nameEl.textContent = name;
            pill.setAttribute('aria-label', strings.fan.originAria(name));
            pill.title = strings.fan.originAria(name);
            pill.classList.remove('is-leaving');
            pill.hidden = false;
            this.placePill();
            return;
        }
        if (pill.hidden) return;
        if (now || reducedMotion()) { pill.hidden = true; pill.classList.remove('is-leaving'); return; }
        pill.classList.add('is-leaving');
        this.pillTimer = setTimeout(() => {
            this.pillTimer = null;
            pill.hidden = true;
            pill.classList.remove('is-leaving');
        }, FADE_MS);
    }

    /**
     * Keep the pill clear of the tree's pills (evidence, live follow), of a
     * followed research's card and of the legend chip when they stand at the
     * top of the stage: narrower when one is to its right, otherwise below it.
     */
    private placePill(): void {
        const pill = this.pill, stage = this.stage();
        if (!pill || pill.hidden || !stage) return;
        pill.style.top = '';
        pill.style.maxWidth = '';
        const s = stage.getBoundingClientRect();
        if (s.width === 0) return;
        const obstacles = ['#evidence-pill', '#live-follow-pill', '#live-panel', '#fan-legend-chip', '#fan-legend', '#fan-zoom-controls']
            .map(sel => document.querySelector<HTMLElement>(sel))
            // Not offsetParent: the tree's pills and the card are fixed, whose offsetParent is always null.
            .filter((el): el is HTMLElement => !!el && !el.hidden && el.getClientRects().length > 0)
            .map(el => el.getBoundingClientRect())
            .filter(r => r.width > 0 && r.height > 0 && r.top < s.top + s.height / 2);
        const GAP = 8;
        for (let pass = 0; pass < 4; pass++) {
            const r = pill.getBoundingClientRect();
            const hit = obstacles.find(o => o.left < r.right + GAP && o.right > r.left - GAP && o.top < r.bottom + GAP && o.bottom > r.top - GAP);
            if (!hit) return;
            if (hit.left - r.left - GAP >= 150) {
                pill.style.maxWidth = `${Math.floor(hit.left - r.left - GAP)}px`;
            } else {
                pill.style.top = `${Math.ceil(hit.bottom - s.top + GAP)}px`;
                pill.style.maxWidth = '';
            }
        }
    }

    private wirePill(container: HTMLElement): void {
        this.pill = container.querySelector<HTMLButtonElement>('#fan-origin-pill');
        const pill = this.pill;
        if (!pill) return;
        pill.addEventListener('click', () => this.goOrigin());
        const replace = () => { if (!pill.hidden) this.placePill(); };
        if (typeof MutationObserver === 'function') new MutationObserver(replace).observe(document.body, { childList: true });
        if (typeof ResizeObserver === 'function') {
            const stage = this.stage();
            if (stage) new ResizeObserver(replace).observe(stage);
        }
        window.addEventListener('resize', replace);
    }

    // ------------------------------------------------------------ the sector menu (§5.4)

    /** A long press (touch) or the mouse's context menu over a sector. */
    private pressMenu(target: Element | null, point: FanZoomPoint, style: 'sheet' | 'context', e?: MouseEvent): void {
        if (this.busy()) return;
        // The context key's own contextmenu event after its keydown opened the menu.
        if (this.menuKey && performance.now() - this.menuOpenedAt < 600) return;
        const el = target?.closest?.('[data-fan-person], [data-fan-add]') ?? null;
        if (!el) return;
        this.openMenu(el, point, style, e ? { x: e.clientX, y: e.clientY } : undefined);
    }

    /** The menu of one sector (null: it has none — the unknown partner, an empty slot outside editing). */
    private menuSpec(el: Element): FanMenuSpec | null {
        const S = strings.fan;
        const key = el.getAttribute('data-fan-key') ?? '';
        const kind = el.getAttribute('data-fan-kind');
        const pid = el.getAttribute('data-fan-person') as PersonId | null;
        const num = kind === 'focus' ? 1 : Number(el.getAttribute('data-fan-ahnentafel')) || null;
        if (pid) {
            const p = this.host.data().persons[pid];
            if (!p) return null;
            const items: FanMenuSpec['items'] = [];
            if (kind !== 'focus') items.push({ id: 'recenter', label: S.recenter, kbd: 'Enter', run: () => this.recenter(pid, this.sectorPoint(key) ?? undefined) });
            items.push({ id: 'detail', label: S.personDetail, run: () => this.host.personDetail(pid) });
            items.push({ id: 'page', label: S.personPage, run: () => this.host.personPage(pid) });
            const first = el.getAttribute('data-fan-repeat-of');
            if (first) {
                const n = /^a(\d+)$/.exec(first);
                items.push({ id: 'first', label: S.showFirst(n ? Number(n[1]) : null), run: () => this.showFirst(first) });
            }
            return { title: shownNameFull(p), sub: [fanYears(p), num ? S.number(num) : ''].filter(Boolean).join(' · '), items };
        }
        const child = el.getAttribute('data-fan-add') as PersonId | null;
        if (!child || !this.host.editable()) return null;
        const male = el.getAttribute('data-fan-add-gender') === 'male';
        return {
            title: male ? S.emptyFather : S.emptyMother,
            sub: num ? S.number(num) : '',
            items: [{ id: 'add', label: male ? S.addFather : S.addMother, run: () => this.host.addParent(child, male ? 'male' : 'female') }],
        };
    }

    /**
     * Open the menu of a sector: a bottom sheet (touch, a phone) with a ring
     * at the press, or a context menu by the cursor (a mouse). `client`: the
     * cursor in window px (otherwise the stage point is used).
     */
    private openMenu(el: Element, point: FanZoomPoint, style: 'sheet' | 'context', client?: { x: number; y: number }): void {
        const spec = this.menuSpec(el);
        if (!spec) return;
        const key = el.getAttribute('data-fan-key') ?? 'f';
        this.closeMenu(false);
        this.rovingKey = key;
        this.applyRoving();
        this.menuKey = key;
        this.menuOpenedAt = performance.now();
        if (style === 'sheet') {
            this.showRing(point);
            this.host.menuSheet(spec, () => {
                if (this.menuKey !== key) return;
                this.menuKey = null;
                this.hideRing();
                this.ignoreTapUntil = performance.now() + 400;
                requestAnimationFrame(() => {
                    const a = document.activeElement;
                    if (!a || a === document.body) this.focusKey(key);
                });
            });
            return;
        }
        const rect = this.chart?.getBoundingClientRect();
        const at = client ?? { x: (rect?.left ?? 0) + point.x, y: (rect?.top ?? 0) + point.y };
        this.showContextMenu(spec, at);
    }

    private showContextMenu(spec: FanMenuSpec, at: { x: number; y: number }): void {
        const esc = this.host.esc;
        const menu = document.createElement('div');
        menu.className = 'context-menu fan-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', spec.title);
        menu.innerHTML = `<div class="context-menu-header fan-menu-head" role="presentation"><span class="fan-menu-name">${esc(spec.title)}</span>`
            + (spec.sub ? `<span class="fan-menu-sub">${esc(spec.sub)}</span>` : '') + '</div>'
            + spec.items.map((it, i) => `<div class="context-menu-item" role="menuitem" tabindex="-1" data-fan-menu="${it.id}" data-i="${i}">`
                + `<span>${esc(it.label)}</span>${it.kbd ? `<kbd class="menu-kbd">${esc(it.kbd)}</kbd>` : ''}</div>`).join('');
        document.body.appendChild(menu);
        // Right of and below the cursor (+10 px), flipped at the window's edges.
        const M = 8, w = menu.offsetWidth, h = menu.offsetHeight;
        let x = at.x + 10, y = at.y + 10;
        if (x + w > window.innerWidth - M) x = Math.max(M, at.x - w - 10);
        if (y + h > window.innerHeight - M) y = Math.max(M, at.y - h - 10);
        menu.style.left = `${Math.round(x)}px`;
        menu.style.top = `${Math.round(y)}px`;
        this.menuEl = menu;

        const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
        const run = (item: HTMLElement) => {
            const it = spec.items[Number(item.dataset.i)];
            this.closeMenu(it.id !== 'detail' && it.id !== 'page' && it.id !== 'add');
            it.run();
        };
        menu.addEventListener('click', (e) => {
            const item = (e.target as Element).closest<HTMLElement>('[role="menuitem"]');
            if (item) run(item);
        });
        const onKey = (e: KeyboardEvent) => {
            const i = items.indexOf(document.activeElement as HTMLElement);
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeMenu(true); return; }
            if (e.key === 'Tab') { e.preventDefault(); this.closeMenu(true); return; }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
                e.preventDefault(); e.stopPropagation();
                const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
                    : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items[n]?.focus();
                return;
            }
            if ((e.key === 'Enter' || e.key === ' ') && i >= 0) { e.preventDefault(); e.stopPropagation(); run(items[i]); }
        };
        const onDown = (e: PointerEvent) => {
            if (menu.contains(e.target as Node)) return;
            if (this.chart?.contains(e.target as Node)) this.ignoreTapUntil = performance.now() + 700;
            this.closeMenu(false);
        };
        const onScroll = () => this.closeMenu(false);
        window.addEventListener('keydown', onKey, true);
        document.addEventListener('pointerdown', onDown, true);
        window.addEventListener('resize', onScroll);
        window.addEventListener('blur', onScroll);
        this.menuCleanup = () => {
            window.removeEventListener('keydown', onKey, true);
            document.removeEventListener('pointerdown', onDown, true);
            window.removeEventListener('resize', onScroll);
            window.removeEventListener('blur', onScroll);
        };
        items[0]?.focus({ preventScroll: true });
    }

    /** Close the open menu; `refocus`: the focus goes back to its sector. */
    private closeMenu(refocus: boolean): void {
        const key = this.menuKey;
        if (!key) return;
        this.menuKey = null;
        this.hideRing();
        if (this.menuEl) {
            this.menuCleanup?.();
            this.menuCleanup = null;
            this.menuEl.remove();
            this.menuEl = null;
        } else if (document.querySelector('.fan-menu-sheet')) {
            // The sheet: the app's own close (its onClose sees the menu already closed).
            this.host.hideMenuSheet();
        }
        if (refocus) this.focusKey(key);
    }

    private showRing(p: FanZoomPoint): void {
        this.hideRing();
        const stage = this.stage();
        if (!stage) return;
        const ring = document.createElement('div');
        ring.className = 'fan-press-ring';
        ring.setAttribute('aria-hidden', 'true');
        ring.style.left = `${p.x}px`;
        ring.style.top = `${p.y}px`;
        stage.appendChild(ring);
        this.ring = ring;
    }

    private hideRing(): void {
        this.ring?.remove();
        this.ring = null;
    }

    // ------------------------------------------------------------ the first occurrence (§7.2)

    /** The geometry of a sector by its key. */
    private sectorOf(key: string): { r1: number; r2: number; lo: number; hi: number } | null {
        const m = this.model;
        if (!m) return null;
        return m.sectors.find(s => s.key === key) ?? m.desc.find(s => s.key === key) ?? null;
    }

    /** A sector's middle in stage px (null: no such sector). */
    private sectorPoint(key: string): FanZoomPoint | null {
        const zoom = this.zoom;
        if (!zoom) return null;
        const vb = zoom.viewBox();
        if (key === 'f') return { x: (0 - vb.x) * vb.ppu, y: (0 - vb.y) * vb.ppu };
        const s = this.sectorOf(key);
        if (!s) return null;
        const r = (s.r1 + s.r2) / 2, a = ((s.lo + s.hi) / 2) * Math.PI / 180;
        return { x: (r * Math.cos(a) - vb.x) * vb.ppu, y: (-r * Math.sin(a) - vb.y) * vb.ppu };
    }

    /** "Show first occurrence": outlined for 1.8 s, the view pans to it when it is outside (the zoom stays). */
    private showFirst(key: string): void {
        const s = this.sectorOf(key);
        const zoom = this.zoom;
        if (!s || !zoom) return;
        if (this.flashTimer) clearTimeout(this.flashTimer);
        this.flashKey = key;
        this.flashTimer = setTimeout(() => this.clearFlash(true), FLASH_MS);
        const vb = zoom.viewBox();
        const r = (s.r1 + s.r2) / 2, a = ((s.lo + s.hi) / 2) * Math.PI / 180;
        const x = r * Math.cos(a), y = -r * Math.sin(a);
        const inside = x >= vb.x && x <= vb.x + vb.w && y >= vb.y && y <= vb.y + vb.h;
        this.draw();
        if (!inside) zoom.animateTo({ z: zoom.zoom(), cx: x, cy: y });
    }

    private clearFlash(redraw: boolean): void {
        if (this.flashTimer) { clearTimeout(this.flashTimer); this.flashTimer = null; }
        if (!this.flashKey) return;
        this.flashKey = null;
        if (redraw && this.host.active()) this.draw();
    }

    /** Hover or keyboard focus on a repeat outlines where the person first appears (no redraw). */
    private hintFirst(el: Element | null): void {
        const svg = this.chart?.querySelector('svg.fan-svg');
        svg?.querySelectorAll('.fan-mark-hint').forEach(m => m.remove());
        const first = el?.closest('[data-fan-repeat-of]')?.getAttribute('data-fan-repeat-of');
        if (!svg || !first) return;
        const d = svg.querySelector(`[data-fan-key="${first}"] .fan-fill`)?.getAttribute('d');
        if (!d) return;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'fan-mark fan-mark-hint');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-width', '3');
        path.setAttribute('vector-effect', 'non-scaling-stroke');
        path.setAttribute('pointer-events', 'none');
        svg.appendChild(path);
    }

    // ------------------------------------------------------------ keys (§1.7)

    /** After a draw: one sector in the tab order, names for assistive technology, the keyboard focus kept. */
    private setupSectors(keyFocused: string | null): void {
        const chart = this.chart, model = this.model;
        const svg = chart?.querySelector('svg.fan-svg');
        if (!chart || !model || !svg) return;
        svg.setAttribute('role', 'group');
        const keys = new Set(fanNavNodes(model, this.host.editable()).map(n => n.key));
        if (!keys.has(this.rovingKey)) this.rovingKey = 'f';
        svg.querySelectorAll<SVGElement>('[data-fan-key]').forEach(el => {
            const key = el.getAttribute('data-fan-key')!;
            if (!keys.has(key)) return;
            el.setAttribute('tabindex', key === this.rovingKey ? '0' : '-1');
            el.setAttribute('role', 'button');
        });
        // A new focus: the keyboard continues from the focus disc.
        const refocus = this.refocusDisc ? 'f' : keyFocused;
        this.refocusDisc = false;
        if (keyFocused && refocus) this.focusKey(refocus);
    }

    private applyRoving(): void {
        this.chart?.querySelectorAll<SVGElement>('[data-fan-key][tabindex]').forEach(el => {
            el.setAttribute('tabindex', el.getAttribute('data-fan-key') === this.rovingKey ? '0' : '-1');
        });
    }

    /** Put the keyboard focus on a sector (it becomes the tab stop). */
    private focusKey(key: string): void {
        const el = this.chart?.querySelector<SVGElement>(`[data-fan-key="${key}"][tabindex]`)
            ?? this.chart?.querySelector<SVGElement>('[data-fan-key="f"]');
        if (!el) return;
        this.rovingKey = el.getAttribute('data-fan-key') ?? 'f';
        this.applyRoving();
        el.focus({ preventScroll: true });
        this.keyRing(el);
    }

    /** The outline of the sector that has the keyboard focus. */
    private keyRing(el: Element | null): void {
        const svg = this.chart?.querySelector('svg.fan-svg');
        svg?.querySelectorAll('.fan-key-ring').forEach(m => m.remove());
        if (!svg || !el || !(el as HTMLElement).matches?.(':focus-visible')) return;
        const shape = el.querySelector('.fan-fill, .fan-empty-edge, .fan-focus-disc');
        if (!shape) return;
        const ring = shape.cloneNode(false) as SVGElement;
        for (const a of [...ring.attributes]) if (a.name !== 'd' && a.name !== 'cx' && a.name !== 'cy' && a.name !== 'r') ring.removeAttribute(a.name);
        ring.setAttribute('class', 'fan-key-ring');
        ring.setAttribute('fill', 'none');
        ring.setAttribute('vector-effect', 'non-scaling-stroke');
        ring.setAttribute('pointer-events', 'none');
        svg.appendChild(ring);
    }

    private sectorKeys(e: KeyboardEvent): void {
        const chart = this.chart;
        if (!chart || e.altKey || e.ctrlKey || e.metaKey) return;
        // Backspace steps back anywhere in the fan.
        if (e.key === 'Backspace') {
            if (this.backTarget()) { e.preventDefault(); this.goBack(); }
            return;
        }
        const el = (e.target as Element).closest?.('[data-fan-key]');
        if (!el || e.target === chart) return;
        const key = el.getAttribute('data-fan-key')!;
        const menuKey = e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);
        if (menuKey) {
            e.preventDefault();
            e.stopPropagation();
            const p = this.sectorPoint(key) ?? { x: 0, y: 0 };
            this.openMenu(el, p, coarsePointer() || isMobile() ? 'sheet' : 'context');
            return;
        }
        if (e.shiftKey) return;
        const dirs: Record<string, FanNavDir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
        const dir = dirs[e.key];
        if (dir && this.model) {
            e.preventDefault();
            e.stopPropagation();
            const next = fanNavMove(fanNavNodes(this.model, this.host.editable()), key, dir, this.model.shape === 'full');
            if (next) this.focusKey(next);
            return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (this.busy()) return;
            const pid = el.getAttribute('data-fan-person') as PersonId | null;
            if (el.getAttribute('data-fan-kind') === 'focus') { this.goBack(); return; }
            if (pid) { this.recenter(pid, this.sectorPoint(key) ?? undefined); return; }
            if (el.getAttribute('data-fan-add')) this.openMenu(el, this.sectorPoint(key) ?? { x: 0, y: 0 }, coarsePointer() || isMobile() ? 'sheet' : 'context');
        }
    }

    private wireSectors(): void {
        const chart = this.chart;
        if (!chart || chart.dataset.fanKeysWired) return;
        chart.dataset.fanKeysWired = '1';
        chart.addEventListener('keydown', e => this.sectorKeys(e));
        chart.addEventListener('focusin', e => {
            const el = (e.target as Element).closest?.('[data-fan-key]') ?? null;
            if (el) {
                this.rovingKey = el.getAttribute('data-fan-key') ?? 'f';
                this.applyRoving();
            }
            this.keyRing(el);
            this.hintFirst(el);
        });
        chart.addEventListener('focusout', () => { this.keyRing(null); this.hintFirst(null); });
        const hover = typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches;
        if (hover) {
            chart.addEventListener('pointerover', e => {
                if ((e as PointerEvent).pointerType !== 'mouse') return;
                this.hintFirst((e.target as Element).closest?.('[data-fan-repeat-of]') ?? null);
            });
            chart.addEventListener('pointerleave', () => {
                const a = document.activeElement;
                this.hintFirst(a && chart.contains(a) ? a : null);
            });
        }
    }

    // ------------------------------------------------------------ toolbar

    private wire(container: HTMLElement): void {
        this.wirePill(container);
        container.addEventListener('click', (e) => {
            const t = e.target as Element;
            const shape = t.closest<HTMLElement>('.fan-shape-btn');
            if (shape?.dataset.fanShape) { this.host.setShape(shape.dataset.fanShape as FanShape); return; }
            const color = t.closest<HTMLElement>('.fan-color-btn');
            if (color?.dataset.fanColor) { this.host.setColorMode(color.dataset.fanColor as FanColorMode); return; }
            if (t.closest('#fan-legend-head')) { this.toggleLegend(); return; }
            if (t.closest('#fan-legend-chip')) { this.openSheet(); return; }
            if (t.closest('[data-fan-sheet-close]')) { this.closeSheet(); return; }
        });
        container.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.sheetOpen()) { e.preventDefault(); e.stopPropagation(); this.closeSheet(); return; }
            this.radioKeys(e);
        });
        const gen = container.querySelector<HTMLSelectElement>('#fan-gen-native');
        gen?.addEventListener('change', () => this.host.setGenerations(parseInt(gen.value, 10)));
        const desc = container.querySelector<HTMLSelectElement>('#fan-desc-native');
        desc?.addEventListener('change', () => this.host.setDescGenerations(parseInt(desc.value, 10)));
        const colorSel = container.querySelector<HTMLSelectElement>('#fan-color-select');
        colorSel?.addEventListener('change', () => this.host.setColorMode(colorSel.value as FanColorMode));

        // §9.4: the browser prints the whole fan in light colours, then the screen's view comes back.
        window.addEventListener('beforeprint', () => this.beforePrint());
        window.addEventListener('afterprint', () => this.afterPrint());
        // The web font changes the measured widths once it is in.
        document.fonts?.ready?.then(() => {
            clearFanMeasureCache();
            if (this.host.active()) this.draw();
        }).catch(() => { /* no font loading API */ });
        // The pills of the tree stand below the toolbar (it may wrap).
        if (typeof ResizeObserver === 'function') {
            const bar = container.querySelector<HTMLElement>('#fan-toolbar');
            if (bar) new ResizeObserver(() => this.publishToolbarBottom()).observe(bar);
        }
        // It also moves without changing size (the top bar gives way to the side bar held sideways).
        window.addEventListener('resize', () => {
            this.publishToolbarBottom();
            requestAnimationFrame(() => this.publishToolbarBottom());
        });
    }

    /** `--fan-toolbar-bottom` on the body: where the toolbar ends (the pills keep below it). */
    private publishToolbarBottom(): void {
        const bar = this.container?.querySelector<HTMLElement>('#fan-toolbar');
        const r = bar?.getBoundingClientRect();
        const value = r && r.height > 0 ? `${Math.round(r.bottom)}px` : '';
        if (value === this.toolbarBottom) return;
        this.toolbarBottom = value;
        if (value) document.body.style.setProperty('--fan-toolbar-bottom', value);
        // A followed research's card stands below the toolbar (and back at the top once the
        // view is left) and the pills move with it: the card is fitted again, then the
        // original person pill keeps clear of them.
        window.dispatchEvent(new Event('strom:fan-toolbar-moved'));
        if (this.pill && !this.pill.hidden) this.placePill();
    }

    /** Arrow keys inside a radio group move the choice (roving tabindex). */
    private radioKeys(e: KeyboardEvent): void {
        const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
        if (!keys.includes(e.key)) return;
        const radio = (e.target as Element).closest<HTMLElement>('[role="radio"]');
        const group = radio?.closest('[role="radiogroup"]');
        if (!radio || !group) return;
        const all = [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
        const i = all.indexOf(radio);
        const n = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1
            : (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + all.length) % all.length;
        e.preventDefault();
        e.stopPropagation();
        all[n].focus();
        all[n].click();
    }

    private syncToolbar(): void {
        const c = this.container;
        if (!c) return;
        const set = this.host.settings();
        const radios = (sel: string, attr: string, value: string) => {
            c.querySelectorAll<HTMLElement>(sel).forEach(b => {
                const on = b.getAttribute(attr) === value;
                b.setAttribute('aria-checked', on ? 'true' : 'false');
                b.tabIndex = on ? 0 : -1;
                b.classList.toggle('is-on', on);
            });
        };
        radios('.fan-shape-btn', 'data-fan-shape', set.shape);
        radios('.fan-color-btn', 'data-fan-color', set.colorMode);
        const gen = c.querySelector<HTMLSelectElement>('#fan-gen-native');
        if (gen) { gen.value = String(set.generations); syncDepthStepper(gen); }
        const desc = c.querySelector<HTMLSelectElement>('#fan-desc-native');
        if (desc) { desc.value = String(set.descGenerations); syncDepthStepper(desc); }
        c.querySelector<HTMLElement>('#fan-desc-stepper')?.toggleAttribute('hidden', set.shape !== 'two');
        c.dataset.fanShape = set.shape;
        const colorSel = c.querySelector<HTMLSelectElement>('#fan-color-select');
        if (colorSel) colorSel.value = set.colorMode;
        this.publishToolbarBottom();
    }

    // ------------------------------------------------------------ legend

    private colorLabel(mode: FanColorMode): string {
        const S = strings.fan;
        return mode === 'line' ? S.colorLine : mode === 'rod' ? S.colorRod : S.colorGender;
    }

    /** The legend rows with their swatches in the three themes (switching the theme needs no redraw). */
    private legendRows(): Array<{ item: FanLegendItem; light: FanLegendItem; dark: FanLegendItem; print: FanLegendItem }> {
        const model = this.model;
        if (!model) return [];
        const mode = this.host.settings().colorMode;
        const rc = mode === 'rod' ? fanRodColors(fanLineages(model.data)) : null;
        const of = (theme: FanTheme) => fanLegend(model, mode, theme, rc);
        const light = of('light'), dark = of('dark'), print = of('print');
        return light.map((item, i) => ({ item, light: item, dark: dark[i] ?? item, print: print[i] ?? item }));
    }

    private swatch(r: { light: FanLegendItem; dark: FanLegendItem; print: FanLegendItem }): string {
        const v = (name: string, a: FanLegendItem) => `--${name}:${a.color};--${name}2:${a.color2 ?? a.color};`;
        return `<span class="fan-sw" aria-hidden="true" style="${v('sl', r.light)}${v('sd', r.dark)}${v('sp', r.print)}"></span>`;
    }

    private legendItemsHtml(): string {
        const esc = this.host.esc;
        const rows = this.legendRows().map(r =>
            `<div class="fan-legend-row" data-fan-legend="${esc(r.item.key)}">${this.swatch(r)}`
            + `<span class="fan-legend-label">${esc(r.item.label)}</span>`
            + (r.item.who ? `<span class="fan-legend-who">${esc(r.item.who)}</span>` : '')
            + '</div>');
        if (this.model && fanHasRepeats(this.model)) {
            rows.push(`<div class="fan-legend-row fan-legend-repeats" data-fan-legend="repeats"><span class="fan-sw fan-sw-hatch" aria-hidden="true"></span>`
                + `<span class="fan-legend-label">${esc(strings.fan.legendRepeats)}</span></div>`);
        }
        return rows.join('');
    }

    private renderLegend(): void {
        const c = this.container;
        if (!c) return;
        const mode = this.host.settings().colorMode;
        const label = this.colorLabel(mode);
        const esc = this.host.esc;
        const items = this.legendItemsHtml();
        const legend = c.querySelector<HTMLElement>('#fan-legend');
        const head = c.querySelector<HTMLElement>('#fan-legend-head');
        const list = c.querySelector<HTMLElement>('#fan-legend-items');
        legend?.classList.toggle('is-open', this.legendOpen);
        legend?.toggleAttribute('hidden', !this.model);
        if (head) {
            head.innerHTML = `<span class="fan-legend-title">${esc(strings.fan.legend)} · ${esc(label)}</span>`
                + `<span class="fan-legend-arrow" aria-hidden="true">${this.legendOpen ? '▾' : '▸'}</span>`;
            head.setAttribute('aria-expanded', this.legendOpen ? 'true' : 'false');
        }
        if (list) list.innerHTML = items;
        const chip = c.querySelector<HTMLElement>('#fan-legend-chip');
        if (chip) {
            const dots = this.legendRows().slice(0, 3)
                .map(r => `<span class="fan-chip-dot" style="--sl:${r.light.color};--sd:${r.dark.color}"></span>`).join('');
            chip.innerHTML = `<span class="fan-chip-dots" aria-hidden="true">${dots}</span>`
                + `<span class="fan-chip-label">${esc(label)}</span><span class="fan-chip-arrow" aria-hidden="true">▴</span>`;
            chip.setAttribute('aria-label', strings.fan.colorsChip(label));
            chip.toggleAttribute('hidden', !this.model);
        }
        const sheetItems = c.querySelector<HTMLElement>('#fan-sheet-items');
        if (sheetItems) sheetItems.innerHTML = items;
    }

    private toggleLegend(): void {
        this.legendOpen = !this.legendOpen;
        try { localStorage.setItem(FAN_STORAGE_KEYS.legendOpen, this.legendOpen ? '1' : '0'); } catch { /* ignore */ }
        this.renderLegend();
    }

    private sheetOpen(): boolean {
        const sheet = this.container?.querySelector<HTMLElement>('#fan-sheet');
        return !!sheet && !sheet.hidden;
    }

    private openSheet(): void {
        const c = this.container;
        const sheet = c?.querySelector<HTMLElement>('#fan-sheet');
        if (!c || !sheet) return;
        this.sheetReturn = c.querySelector<HTMLElement>('#fan-legend-chip');
        sheet.hidden = false;
        this.sheetReturn?.setAttribute('aria-expanded', 'true');
        c.querySelector<HTMLElement>('.fan-sheet [role="radio"][aria-checked="true"]')?.focus();
    }

    private closeSheet(): void {
        const sheet = this.container?.querySelector<HTMLElement>('#fan-sheet');
        if (!sheet || sheet.hidden) return;
        sheet.hidden = true;
        this.sheetReturn?.setAttribute('aria-expanded', 'false');
        this.sheetReturn?.focus();
        this.sheetReturn = null;
    }

    // ------------------------------------------------------------ print

    private beforePrint(): void {
        // The tiled poster prints its own sheets.
        if (!this.host.active() || !this.zoom || !this.model || document.body.classList.contains('poster-printing')) return;
        this.printView = this.zoom.getView();
        this.printing = true;
        this.closeSheet();
        this.zoom.reset();
        this.draw();
    }

    private afterPrint(): void {
        if (!this.printing) return;
        this.printing = false;
        const v = this.printView;
        this.printView = null;
        if (!this.zoom || !this.model) return;
        const restore = () => {
            if (!this.zoom || this.printing) return;
            if (v) this.zoom.setView(v, false);
            this.draw();
        };
        restore();
        // The screen's layout comes back with a resize, which starts from the
        // whole fan: the view is put back once more after it (two frames later).
        requestAnimationFrame(() => requestAnimationFrame(restore));
    }
}
