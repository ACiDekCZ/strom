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
 * Hooks for the re-centring history and the sector menu (B2): `onSectorTap`,
 * `onFocusTap`, `svgExtras` and the FanZoom callbacks wired in `ensureZoom`.
 */

import type { PersonId, StromData } from '../types.js';
import {
    buildFanModel, buildFanSvg, fanLineages, FanModel, FanShape, FanSvgOptions,
} from '../fan-chart.js';
import { FanColorMode, FanTheme, fanLegend, fanHasRepeats, fanRodColors, FanLegendItem } from '../fan-colors.js';
import { fanScreenSizes, clearFanMeasureCache } from '../fan-labels.js';
import { FanZoom, FanView as FanZoomView, FanZoomPoint } from '../fan-zoom.js';
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
        this.syncToolbar();
        const focus = this.host.focusId();
        const chart = this.chart;
        if (!chart || !focus) return;

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
        this.host.afterDraw();
    }

    /** Extra options of the drawing (B2: the outlined first occurrence, the way back in the focus disc). */
    protected svgExtras(): Partial<FanSvgOptions> {
        return {};
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
            onViewChange: () => this.scheduleRedraw(),
        });
        return this.zoom;
    }

    // ------------------------------------------------------------ taps

    private tap(target: Element | null, point: FanZoomPoint): void {
        const el = target?.closest?.('[data-fan-person], [data-fan-add]') ?? null;
        if (!el) return;
        const person = el.getAttribute('data-fan-person');
        if (el.getAttribute('data-fan-kind') === 'focus') { this.onFocusTap(point); return; }
        if (person) { this.onSectorTap(person as PersonId, el, point); return; }
        const add = el.getAttribute('data-fan-add');
        if (add && this.host.editable()) {
            const g = el.getAttribute('data-fan-add-gender');
            this.host.addParent(add as PersonId, g === 'male' || g === 'female' ? g : undefined);
        }
    }

    /** A sector of a person: re-centre on them (B2 adds the history and the animation). */
    protected onSectorTap(person: PersonId, _sector: Element, _point: FanZoomPoint): void {
        this.host.setFocus(person);
    }

    /** The focus disc (B2: a step back when there is one). */
    protected onFocusTap(_point: FanZoomPoint): void { /* nothing yet */ }

    // ------------------------------------------------------------ toolbar

    private wire(container: HTMLElement): void {
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
    }

    /** `--fan-toolbar-bottom` on the body: where the toolbar ends (the pills keep below it). */
    private publishToolbarBottom(): void {
        const bar = this.container?.querySelector<HTMLElement>('#fan-toolbar');
        const r = bar?.getBoundingClientRect();
        if (r && r.height > 0) document.body.style.setProperty('--fan-toolbar-bottom', `${Math.round(r.bottom)}px`);
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
