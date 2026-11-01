/**
 * Zoom and pan of the fan chart (spec 029 §1): the SVG's viewBox changes, not
 * a CSS transform, so the text stays sharp and a tap's `event.target` is the
 * sector under the finger at any zoom. The toolbar, the buttons and the
 * legend stand still around it.
 *
 * State `{ z, cx, cy }`: z = 1 is the whole fan, (cx, cy) the centre of the
 * visible part in fan units. With the fan's frame G and a W × H surface:
 *   ppu0 = min(W / G.w, H / G.h),  ppu = ppu0 · z,
 *   viewBox = [cx − W/2ppu, cy − H/2ppu, W/ppu, H/ppu]
 * (the viewBox has the surface's aspect ratio). z ∈ [1, 8]; the centre is
 * clamped so the view never leaves the frame, and a view larger than the
 * frame is centred on it. The Fan view lets a drag go past that, like the
 * family tree's pan, by a share of the view (`FAN_VIEW_OVERSCROLL`), so one
 * finger moves the whole fan too; the fan never leaves the screen.
 *
 * Two modes: 'view' (the Fan view: the wheel always zooms, the surface owns
 * every touch) and 'page' (a person page, a saved page: the wheel zooms only
 * with Ctrl/⌘ and otherwise shows a hint, one finger scrolls the page until
 * the fan is zoomed in).
 *
 * The math is pure (tested); `FanZoom` adds the DOM: pointer gestures,
 * wheel, keys, buttons, animation and the callbacks the renderer hooks into.
 * `fanZoomInlineScript()` is the same page-mode behaviour as one small
 * dependency-free script for saved HTML pages.
 */

import type { FanBounds } from './fan-chart.js';

// ---------------------------------------------------------------- constants (§1)

export const FAN_ZOOM_MIN = 1;
export const FAN_ZOOM_MAX = 8;
/** ＋ / − and the + / − keys. */
export const FAN_ZOOM_STEP = 1.6;
/** A double tap from the whole fan zooms to this. */
export const FAN_DOUBLE_TAP_ZOOM = 2.5;
/** At most this zoom still counts as "the whole fan" for a double tap. */
export const FAN_DOUBLE_TAP_FIT = 1.05;
/** A tap is decided after this wait (a second tap would make it a double tap). */
export const FAN_TAP_DELAY_MS = 250;
export const FAN_DOUBLE_TAP_MS = 280;
export const FAN_DOUBLE_TAP_SLOP = 30;
/** Movement that turns a press into a drag. */
export const FAN_DRAG_SLOP = 8;
/** Touch and pen only; the mouse has `contextmenu`. */
export const FAN_LONG_PRESS_MS = 500;
/** Labels are fitted again this long after the last step of a gesture. */
export const FAN_RELABEL_MS = 120;
export const FAN_ANIM_MS = 240;
export const FAN_HINT_MS = 1500;
/**
 * The Fan view's pan past the strict clamp, as a share of the smaller of the
 * view and the frame on each axis: at 0.5 at least half of that stays covered
 * by the fan (the whole fan moves by up to half its size; zoomed in, the
 * view's centre reaches the frame's edge). Pages keep 0 (their one finger
 * scrolls the page while the fan is whole).
 */
export const FAN_VIEW_OVERSCROLL = 0.5;
/** Arrow keys move the view by this share of it. */
export const FAN_PAN_STEP = 0.15;
/** Wheel: `k = exp(−deltaY · speed)`; a trackpad pinch arrives with ctrlKey. */
export const FAN_WHEEL_SPEED = 0.0018;
export const FAN_PINCH_WHEEL_SPEED = 0.01;

// ---------------------------------------------------------------- math

export interface FanView {
    z: number;
    cx: number;
    cy: number;
}

export interface FanViewBox {
    x: number;
    y: number;
    w: number;
    h: number;
    /** Screen px per fan unit. */
    ppu: number;
}

export type FanZoomMode = 'view' | 'page';

/** The whole fan: z = 1, centred on the frame. */
export function fanFitView(b: FanBounds): FanView {
    return { z: 1, cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
}

/** Screen px per unit at z = 1 (the whole frame fits the surface). */
export function fanBasePpu(b: FanBounds, W: number, H: number): number {
    if (!(b.w > 0 && b.h > 0 && W > 0 && H > 0)) return 1;
    return Math.min(W / b.w, H / b.h);
}

/** Free px kept between the whole fan and the top of the buttons over its corner. */
export const FAN_RESERVE_GAP = 6;

/**
 * The frame grown at the bottom so that the whole fan (z = 1) on a W × H
 * surface leaves `px` screen px free under the line y = `floor` — the
 * buttons in a bottom corner, beside the focus disc (the only drawing under
 * that line), then cover nothing (1101). The unchanged frame when it already
 * leaves that much, or when nothing would.
 */
export function fanReservedBounds(b: FanBounds, floor: number, W: number, H: number, px: number): FanBounds {
    if (!(px > 0 && px < H && W > 0 && b.w > 0 && b.h > 0)) return b;
    const free = (e: number): number => {
        const h = b.h + e, u = Math.min(W / b.w, H / h);
        return (H - h * u) / 2 + (b.y + h - floor) * u;
    };
    if (free(0) >= px) return b;
    let lo = 0, hi = b.h;
    while (free(hi) < px) hi *= 2;
    for (let i = 0; i < 40; i++) {
        const m = (lo + hi) / 2;
        if (free(m) >= px) hi = m; else lo = m;
    }
    return { ...b, h: b.h + hi };
}

/**
 * The px the buttons `el` take from the bottom of `surface` (with the gap);
 * 0 while they are not shown (print, a closed section).
 */
export function fanReservePx(surface: HTMLElement, el: HTMLElement | null | undefined): number {
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    if (!r.height) return 0;
    return Math.max(0, surface.getBoundingClientRect().bottom - r.top + FAN_RESERVE_GAP);
}

/**
 * z within [1, 8]; the centre keeps the view inside the frame (a larger view
 * is centred), widened on each side by `over` × min(view, frame) (the Fan
 * view's overscroll; 0 = strict).
 */
export function clampFanView(v: FanView, b: FanBounds, W: number, H: number, over = 0): FanView {
    const z = Math.max(FAN_ZOOM_MIN, Math.min(FAN_ZOOM_MAX, Number.isFinite(v.z) ? v.z : 1));
    const ppu = fanBasePpu(b, W, H) * z;
    const axis = (c: number, min: number, size: number, span: number): number => {
        const lo = span >= size ? min + size / 2 : min + span / 2;
        const hi = span >= size ? min + size / 2 : min + size - span / 2;
        if (!Number.isFinite(c)) return min + size / 2;
        const m = over > 0 ? over * Math.min(span, size) : 0;
        return Math.max(lo - m, Math.min(hi + m, c));
    };
    return { z, cx: axis(v.cx, b.x, b.w, W / ppu), cy: axis(v.cy, b.y, b.h, H / ppu) };
}

/** The viewBox of a (clamped) view on a W × H surface. */
export function fanViewBox(v: FanView, b: FanBounds, W: number, H: number, over = 0): FanViewBox {
    const c = clampFanView(v, b, W, H, over);
    const ppu = fanBasePpu(b, W, H) * c.z;
    const w = W / ppu, h = H / ppu;
    return { x: c.cx - w / 2, y: c.cy - h / 2, w, h, ppu };
}

/**
 * Zoom by `k` keeping the fan point under the surface point (sx, sy) where
 * it is: p = vb.x + sx/ppu, then cx' = p − (sx − W/2)/ppu'.
 */
export function fanZoomAt(v: FanView, k: number, sx: number, sy: number, b: FanBounds, W: number, H: number, over = 0): FanView {
    const vb = fanViewBox(v, b, W, H, over);
    const px = vb.x + sx / vb.ppu, py = vb.y + sy / vb.ppu;
    const z = Math.max(FAN_ZOOM_MIN, Math.min(FAN_ZOOM_MAX, (vb.ppu / fanBasePpu(b, W, H)) * k));
    const ppu2 = fanBasePpu(b, W, H) * z;
    return clampFanView({ z, cx: px - (sx - W / 2) / ppu2, cy: py - (sy - H / 2) / ppu2 }, b, W, H, over);
}

/** Move the content by (dx, dy) screen px (a drag to the right shows more of the left). */
export function fanPanBy(v: FanView, dx: number, dy: number, b: FanBounds, W: number, H: number, over = 0): FanView {
    const c = clampFanView(v, b, W, H, over);
    const ppu = fanBasePpu(b, W, H) * c.z;
    return clampFanView({ z: c.z, cx: c.cx - dx / ppu, cy: c.cy - dy / ppu }, b, W, H, over);
}

/** Two fingers: their distance `d` and midpoint (mx, my) in surface px. */
export interface FanPinch {
    d: number;
    mx: number;
    my: number;
}

/**
 * One step of a pinch: the content follows the fingers' midpoint, then scales
 * by the change of their distance around it (the point between the fingers
 * stays between them).
 */
export function fanPinchStep(v: FanView, prev: FanPinch, next: FanPinch, b: FanBounds, W: number, H: number, over = 0): FanView {
    let out = fanPanBy(v, next.mx - prev.mx, next.my - prev.my, b, W, H, over);
    if (prev.d > 0 && next.d > 0) out = fanZoomAt(out, next.d / prev.d, next.mx, next.my, b, W, H, over);
    return out;
}

/** The zoom factor of one wheel event (lines and pages are turned into px first). */
export function fanWheelFactor(deltaY: number, ctrlKey: boolean, deltaMode = 0, pageH = 800): number {
    const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? pageH : 1;
    return Math.exp(-deltaY * unit * (ctrlKey ? FAN_PINCH_WHEEL_SPEED : FAN_WHEEL_SPEED));
}

/** Ease-out cubic. */
export const fanEase = (t: number): number => 1 - Math.pow(1 - t, 3);

/** Interpolated view of an animation at eased progress e ∈ [0, 1]. */
export function fanLerpView(a: FanView, b: FanView, e: number): FanView {
    return { z: a.z + (b.z - a.z) * e, cx: a.cx + (b.cx - a.cx) * e, cy: a.cy + (b.cy - a.cy) * e };
}

/** Whether two views are the same (to a hair). */
export function sameFanView(a: FanView, b: FanView): boolean {
    return Math.abs(a.z - b.z) < 1e-6 && Math.abs(a.cx - b.cx) < 1e-6 && Math.abs(a.cy - b.cy) < 1e-6;
}

/** The modifier key of the wheel hint: ⌘ on Apple systems, Ctrl elsewhere. */
export function fanZoomModifier(): 'Ctrl' | '⌘' {
    if (typeof navigator === 'undefined') return 'Ctrl';
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.userAgentData?.platform || nav.platform || '';
    return /mac|iphone|ipad|ipod/i.test(platform) ? '⌘' : 'Ctrl';
}

// ---------------------------------------------------------------- DOM

export interface FanZoomPoint {
    /** Surface px (from its top-left corner). */
    x: number;
    y: number;
}

export interface FanZoomOptions {
    /** The element that holds the fan SVG and receives the gestures. */
    surface: HTMLElement;
    mode: FanZoomMode;
    /** The fan's frame (model.bounds); `setBounds` changes it. */
    bounds: FanBounds;
    /** A tap, decided after 250 ms (not a double tap, not a drag): the element under the pointer at press. */
    onTap?: (target: Element | null, point: FanZoomPoint) => void;
    /** A 500 ms press of a finger or a pen without moving. */
    onLongPress?: (target: Element | null, point: FanZoomPoint) => void;
    /** The mouse's context menu (right button, the context key); the native menu stays without a handler. */
    onContextMenu?: (target: Element | null, point: FanZoomPoint, e: MouseEvent) => void;
    /** 120 ms after the last change of the view: fit the labels for the new scale. */
    onViewChange?: (ppu: number, viewBox: FanViewBox) => void;
    /** Page mode: the wheel without Ctrl/⌘ shows the hint for 1.5 s (each turn extends it). */
    onHint?: (visible: boolean) => void;
    /** Buttons with `data-fan-zoom-act="in|out|fit"` (anywhere inside, usually a card over the surface). */
    controls?: HTMLElement | null;
    /** The motion is reduced: views change at once. Default: the OS setting. */
    reducedMotion?: () => boolean;
    /**
     * Buttons over a bottom corner: the whole fan keeps clear of them (the
     * frame grows at the bottom, see fanReservedBounds), measured with every
     * new size. `floor`: the lowest y of the drawing beside the focus disc.
     */
    reserve?: { el: HTMLElement; floor: number } | null;
}

interface Press {
    id: number;
    x: number;
    y: number;
    target: Element | null;
    pointerType: string;
    moved: boolean;
    multi: boolean;
    long: boolean;
}

const systemReducedMotion = (): boolean =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The fan's zoom on one surface. The surface gets `tabindex="0"` and its
 * touch-action; the SVG inside it (`svg.fan-svg`, replaced by every redraw)
 * gets the viewBox. A redraw should pass `viewBox()` as the viewport and
 * `ppu()` to the SVG builder so the new drawing already stands right.
 */
export class FanZoom {
    private readonly o: FanZoomOptions;
    /** The pan past the strict clamp (the Fan view only). */
    private readonly over: number;
    /** The fan's own frame; `bounds` is it grown for the reserved corner. */
    private frameBounds: FanBounds;
    private bounds: FanBounds;
    private view: FanView;
    private W = 0;
    private H = 0;
    private readonly pointers = new Map<number, FanZoomPoint>();
    private press: Press | null = null;
    private pinch: { d: number; mx: number; my: number } | null = null;
    private lastTap: { t: number; x: number; y: number } | null = null;
    private tapTimer: ReturnType<typeof setTimeout> | null = null;
    private longTimer: ReturnType<typeof setTimeout> | null = null;
    private relabelTimer: ReturnType<typeof setTimeout> | null = null;
    private hintTimer: ReturnType<typeof setTimeout> | null = null;
    private frame = 0;
    private anim = 0;
    private lastPointerType = 'mouse';
    private ro: ResizeObserver | null = null;
    private destroyed = false;
    /** A drag or pinch just ended: the click that follows is not a tap on a link. */
    private suppressClick = false;
    private readonly listeners: Array<[EventTarget, string, EventListener, AddEventListenerOptions | boolean | undefined]> = [];

    constructor(o: FanZoomOptions) {
        this.o = o;
        this.over = o.mode === 'view' ? FAN_VIEW_OVERSCROLL : 0;
        this.frameBounds = o.bounds;
        this.bounds = o.bounds;
        const s = o.surface;
        if (!s.hasAttribute('tabindex')) s.setAttribute('tabindex', '0');
        this.measure();
        this.view = fanFitView(this.bounds);
        this.on(s, 'pointerdown', e => this.down(e as PointerEvent));
        this.on(s, 'pointermove', e => this.move(e as PointerEvent));
        this.on(s, 'pointerup', e => this.up(e as PointerEvent));
        this.on(s, 'pointercancel', e => this.cancel(e as PointerEvent));
        // Only the surface's own capture counts: a touch is implicitly captured by the
        // sector it lands on, and taking it over for a drag makes that sector lose it
        // (the event bubbles here) — cancelling then froze a one-finger drag after a step.
        this.on(s, 'lostpointercapture', e => {
            if (e.target === s && this.pointers.has((e as PointerEvent).pointerId)) this.cancel(e as PointerEvent);
        });
        this.on(s, 'contextmenu', e => this.contextMenu(e as MouseEvent));
        this.on(s, 'wheel', e => this.wheel(e as WheelEvent), { passive: false });
        this.on(s, 'keydown', e => this.key(e as KeyboardEvent));
        // iOS Safari: its own page pinch stays out of the view.
        if (o.mode === 'view') for (const t of ['gesturestart', 'gesturechange']) this.on(s, t, e => e.preventDefault());
        // A drag that ends over a sector must not also click it (links in a page).
        this.on(s, 'click', e => { if (this.suppressClick) { this.suppressClick = false; e.preventDefault(); e.stopPropagation(); } }, true);
        if (o.controls) {
            this.on(o.controls, 'click', e => {
                const btn = (e.target as Element | null)?.closest?.('[data-fan-zoom-act]') as HTMLElement | null;
                if (!btn || !o.controls!.contains(btn)) return;
                e.stopPropagation();
                const act = btn.dataset.fanZoomAct;
                if (act === 'in') this.zoomBy(FAN_ZOOM_STEP);
                else if (act === 'out') this.zoomBy(1 / FAN_ZOOM_STEP);
                else if (act === 'fit') this.animateTo(fanFitView(this.bounds));
            });
        }
        if (typeof ResizeObserver === 'function') {
            this.ro = new ResizeObserver(() => this.resized());
            this.ro.observe(s);
        }
        this.applyTouchAction();
    }

    private on(t: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions | boolean): void {
        t.addEventListener(type, fn, opts);
        this.listeners.push([t, type, fn, opts]);
    }

    // ---- state

    /** The current view (clamped). */
    getView(): FanView {
        return clampFanView(this.view, this.bounds, this.W || 1, this.H || 1, this.over);
    }

    /** z (1 = the whole fan). */
    zoom(): number {
        return this.getView().z;
    }

    /** Screen px per fan unit now. */
    ppu(): number {
        return this.viewBox().ppu;
    }

    /** The visible part in fan units (the SVG's viewBox). */
    viewBox(): FanViewBox {
        if (!this.W || !this.H) this.measure();
        if (!this.W || !this.H) return { ...this.bounds, ppu: 1 };
        return fanViewBox(this.view, this.bounds, this.W, this.H, this.over);
    }

    /** Surface size in px. */
    size(): { W: number; H: number } {
        return { W: this.W, H: this.H };
    }

    isAnimating(): boolean {
        return this.anim !== 0;
    }

    /** A new frame (generations, shape or focus changed): back to the whole fan. */
    setBounds(b: FanBounds): void {
        this.frameBounds = b;
        this.bounds = b;
        this.reset();
    }

    /** The whole fan at once (§1.6, before printing). */
    reset(): void {
        this.stopAnim();
        this.measure();
        this.view = fanFitView(this.bounds);
        this.apply(true);
    }

    /** Put a view (clamped), e.g. back after printing. */
    setView(v: FanView, notify = true): void {
        this.stopAnim();
        this.view = { ...v };
        this.apply(true);
        if (notify) this.scheduleViewChange();
    }

    zoomBy(k: number, sx?: number, sy?: number): void {
        this.stopAnim();
        this.ensureSize();
        this.view = fanZoomAt(this.view, k, sx ?? this.W / 2, sy ?? this.H / 2, this.bounds, this.W, this.H, this.over);
        this.changed();
    }

    /** Move the content by screen px. */
    panBy(dx: number, dy: number): void {
        this.ensureSize();
        this.view = fanPanBy(this.view, dx, dy, this.bounds, this.W, this.H, this.over);
        this.changed();
    }

    /** Animate to a view (240 ms, ease-out cubic); reduced motion: at once. */
    animateTo(to: FanView, ms = FAN_ANIM_MS): void {
        this.stopAnim();
        this.ensureSize();
        const target = clampFanView(to, this.bounds, this.W, this.H, this.over);
        const from = this.getView();
        if (sameFanView(from, target)) { this.view = target; this.apply(true); return; }
        if ((this.o.reducedMotion ?? systemReducedMotion)() || typeof requestAnimationFrame !== 'function') {
            this.view = target;
            this.apply(true);
            this.scheduleViewChange(0);
            return;
        }
        const t0 = performance.now();
        const step = (t: number) => {
            if (this.destroyed) return;
            const k = Math.min(1, (t - t0) / ms);
            this.view = fanLerpView(from, target, fanEase(k));
            this.apply(true);
            if (k < 1) this.anim = requestAnimationFrame(step);
            else { this.anim = 0; this.scheduleViewChange(0); }
        };
        this.anim = requestAnimationFrame(step);
    }

    /** Write the viewBox onto the SVG now (after a redraw put a new one in). */
    applyNow(): void {
        this.apply(true);
    }

    destroy(): void {
        this.destroyed = true;
        this.stopAnim();
        for (const t of [this.tapTimer, this.longTimer, this.relabelTimer, this.hintTimer]) if (t) clearTimeout(t);
        if (this.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame);
        this.ro?.disconnect();
        for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
        this.listeners.length = 0;
        this.pointers.clear();
    }

    // ---- internals

    private svg(): SVGSVGElement | null {
        return this.o.surface.querySelector('svg.fan-svg');
    }

    private measure(): void {
        this.W = this.o.surface.clientWidth;
        this.H = this.o.surface.clientHeight;
        this.reserveCorner();
    }

    /** The frame for this size: grown so the whole fan keeps clear of the corner's buttons. */
    private reserveCorner(): void {
        const r = this.o.reserve;
        this.bounds = r && this.W && this.H
            ? fanReservedBounds(this.frameBounds, r.floor, this.W, this.H, fanReservePx(this.o.surface, r.el))
            : this.frameBounds;
    }

    private ensureSize(): void {
        if (!this.W || !this.H) this.measure();
        if (!this.W) this.W = 1;
        if (!this.H) this.H = 1;
    }

    private resized(): void {
        const W = this.o.surface.clientWidth, H = this.o.surface.clientHeight;
        if (W === this.W && H === this.H) return;
        this.W = W;
        this.H = H;
        if (!W || !H) return;
        this.reserveCorner();
        // §1.6: a new size starts from the whole fan again.
        this.stopAnim();
        this.view = fanFitView(this.bounds);
        this.apply(true);
        this.scheduleViewChange(0);
    }

    private stopAnim(): void {
        if (this.anim && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.anim);
        this.anim = 0;
    }

    private changed(): void {
        this.apply(false);
        this.scheduleViewChange();
    }

    /** viewBox + touch-action; `now` writes at once, else once per frame. */
    private apply(now: boolean): void {
        this.view = clampFanView(this.view, this.bounds, this.W || 1, this.H || 1, this.over);
        this.applyTouchAction();
        if (now || typeof requestAnimationFrame !== 'function') { this.writeViewBox(); return; }
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => { this.frame = 0; this.writeViewBox(); });
    }

    private writeViewBox(): void {
        const svg = this.svg();
        if (!svg) return;
        const vb = this.viewBox();
        const f = (n: number) => n.toFixed(2);
        svg.setAttribute('viewBox', `${f(vb.x)} ${f(vb.y)} ${f(vb.w)} ${f(vb.h)}`);
    }

    private applyTouchAction(): void {
        const s = this.o.surface.style;
        // The page keeps its one-finger scroll (and its own pinch elsewhere) until the fan is zoomed in.
        s.touchAction = this.o.mode === 'page' && this.view.z <= 1.001 ? 'pan-x pan-y' : 'none';
    }

    private scheduleViewChange(ms = FAN_RELABEL_MS): void {
        if (!this.o.onViewChange) return;
        if (this.relabelTimer) clearTimeout(this.relabelTimer);
        this.relabelTimer = setTimeout(() => {
            this.relabelTimer = null;
            if (this.destroyed || this.anim) return;
            const vb = this.viewBox();
            this.o.onViewChange?.(vb.ppu, vb);
        }, ms);
    }

    private point(e: { clientX: number; clientY: number }): FanZoomPoint {
        const r = this.o.surface.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    private cancelLong(): void {
        if (this.longTimer) clearTimeout(this.longTimer);
        this.longTimer = null;
    }

    private capture(id: number): void {
        try { this.o.surface.setPointerCapture(id); } catch { /* a pointer that is no longer active */ }
    }

    private down(e: PointerEvent): void {
        this.lastPointerType = e.pointerType || 'mouse';
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        // Buttons and cards over the surface keep their own clicks.
        const t = e.target as Element | null;
        if (t?.closest?.('button, [data-fan-zoom-ignore]')) return;
        this.ensureSize();
        const p = this.point(e);
        this.pointers.set(e.pointerId, p);
        if (this.pointers.size === 1) {
            this.stopAnim();
            this.suppressClick = false;
            this.press = { id: e.pointerId, x: p.x, y: p.y, target: t, pointerType: e.pointerType || 'mouse', moved: false, multi: false, long: false };
            this.cancelLong();
            if (e.pointerType !== 'mouse' && this.o.onLongPress) {
                this.longTimer = setTimeout(() => {
                    this.longTimer = null;
                    const pr = this.press;
                    if (!pr || pr.moved || pr.multi) return;
                    pr.long = true;
                    this.o.onLongPress?.(pr.target, { x: pr.x, y: pr.y });
                }, FAN_LONG_PRESS_MS);
            }
        } else if (this.pointers.size === 2) {
            // A second finger: a pinch, never a tap or a long press.
            this.cancelLong();
            if (this.press) this.press.multi = true;
            const [a, b] = [...this.pointers.values()];
            this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
            for (const id of this.pointers.keys()) this.capture(id);
        }
    }

    private move(e: PointerEvent): void {
        const prev = this.pointers.get(e.pointerId);
        if (!prev) return;
        const p = this.point(e);
        this.pointers.set(e.pointerId, p);
        if (this.pointers.size >= 2 && this.pinch) {
            const [a, b] = [...this.pointers.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            this.view = fanPinchStep(this.view, this.pinch, { d, mx, my }, this.bounds, this.W, this.H, this.over);
            this.pinch = { d, mx, my };
            this.changed();
            return;
        }
        const pr = this.press;
        if (!pr || pr.id !== e.pointerId) return;
        if (!pr.moved && Math.hypot(p.x - pr.x, p.y - pr.y) > FAN_DRAG_SLOP) {
            pr.moved = true;
            this.cancelLong();
            // A page keeps its own scroll while the fan is whole.
            if (this.o.mode === 'page' && this.view.z <= 1.001) return;
            this.capture(e.pointerId);
            this.suppressClick = true;
        }
        if (!pr.moved || pr.multi) return;
        if (this.o.mode === 'page' && this.view.z <= 1.001) return;
        this.panBy(p.x - prev.x, p.y - prev.y);
    }

    private up(e: PointerEvent): void {
        if (!this.pointers.has(e.pointerId)) return;
        this.pointers.delete(e.pointerId);
        this.cancelLong();
        if (this.pointers.size < 2) this.pinch = null;
        if (this.pointers.size > 0) return;
        const pr = this.press;
        this.press = null;
        if (!pr || pr.moved || pr.multi || pr.long) return;
        this.tap(pr);
    }

    private cancel(e: PointerEvent): void {
        this.pointers.delete(e.pointerId);
        this.cancelLong();
        if (this.pointers.size < 2) this.pinch = null;
        if (this.pointers.size === 0) this.press = null;
    }

    private tap(pr: Press): void {
        const now = performance.now();
        const last = this.lastTap;
        if (last && now - last.t < FAN_DOUBLE_TAP_MS && Math.hypot(pr.x - last.x, pr.y - last.y) < FAN_DOUBLE_TAP_SLOP) {
            // A double tap: into the spot from the whole fan, back to the whole fan otherwise.
            if (this.tapTimer) clearTimeout(this.tapTimer);
            this.tapTimer = null;
            this.lastTap = null;
            if (this.getView().z <= FAN_DOUBLE_TAP_FIT) {
                const vb = this.viewBox();
                this.animateTo({ z: FAN_DOUBLE_TAP_ZOOM, cx: vb.x + pr.x / vb.ppu, cy: vb.y + pr.y / vb.ppu });
            } else {
                this.animateTo(fanFitView(this.bounds));
            }
            return;
        }
        this.lastTap = { t: now, x: pr.x, y: pr.y };
        if (this.tapTimer) clearTimeout(this.tapTimer);
        this.tapTimer = setTimeout(() => {
            this.tapTimer = null;
            this.lastTap = null;
            if (!this.destroyed) this.o.onTap?.(pr.target, { x: pr.x, y: pr.y });
        }, FAN_TAP_DELAY_MS);
    }

    private contextMenu(e: MouseEvent): void {
        if (!this.o.onContextMenu && !this.o.onLongPress) return;
        e.preventDefault();
        // A finger's long press has its own timer (some browsers also send contextmenu).
        if (this.lastPointerType !== 'mouse' && this.o.onLongPress) return;
        if (!this.o.onContextMenu) return;
        this.o.onContextMenu(e.target as Element | null, this.point(e), e);
    }

    private wheel(e: WheelEvent): void {
        if (this.o.mode === 'page' && !(e.ctrlKey || e.metaKey)) {
            this.o.onHint?.(true);
            if (this.hintTimer) clearTimeout(this.hintTimer);
            this.hintTimer = setTimeout(() => { this.hintTimer = null; this.o.onHint?.(false); }, FAN_HINT_MS);
            return;
        }
        e.preventDefault();
        this.ensureSize();
        const p = this.point(e);
        this.zoomBy(fanWheelFactor(e.deltaY, e.ctrlKey, e.deltaMode, this.H), p.x, p.y);
    }

    private key(e: KeyboardEvent): void {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        const onSurface = e.target === this.o.surface;
        const vb = this.viewBox();
        const pan = (dx: number, dy: number) => this.panBy(-dx * vb.w * vb.ppu, -dy * vb.h * vb.ppu);
        switch (e.key) {
            case '+': case '=': this.zoomBy(FAN_ZOOM_STEP); break;
            case '-': case '_': this.zoomBy(1 / FAN_ZOOM_STEP); break;
            case '0': this.animateTo(fanFitView(this.bounds)); break;
            // Arrows move the view only with the focus on the surface (a sector uses them to move between sectors).
            case 'ArrowLeft': if (!onSurface) return; pan(-FAN_PAN_STEP, 0); break;
            case 'ArrowRight': if (!onSurface) return; pan(FAN_PAN_STEP, 0); break;
            case 'ArrowUp': if (!onSurface) return; pan(0, -FAN_PAN_STEP); break;
            case 'ArrowDown': if (!onSurface) return; pan(0, FAN_PAN_STEP); break;
            default: return;
        }
        e.preventDefault();
        e.stopPropagation();
    }
}

// ---------------------------------------------------------------- saved pages

/**
 * The page-mode zoom as one dependency-free script for saved HTML pages (one
 * copy serves every fan on the page). Markup it expects:
 *
 *   <div data-fan-zoom style="position:relative">      (the surface, sized by the page)
 *     <svg class="fan-svg" viewBox="x y w h">…</svg>   (drawn whole: the viewBox is the frame)
 *     <button data-fan-zoom-act="in|out|fit">…</button>
 *     <div data-fan-zoom-hint hidden aria-live="polite" data-mac="⌘ + …">Ctrl + …</div>
 *     <div data-fan-zoom-reserve="0">…</div>          (optional: the buttons' corner, its floor; see fanReservedBounds)
 *   </div>
 *
 * Same numbers as `FanZoom` in page mode: z 1–8, ＋/− ×1.6, ⛶ animated
 * (240 ms ease-out cubic, none with reduced motion), wheel only with
 * Ctrl/⌘ (else the hint for 1.5 s), pinch, a drag only when zoomed in (a
 * drag never follows a link), touch-action `pan-x pan-y` at z = 1, a new
 * size and printing back to the whole fan. Labels are not refitted (no model
 * in the page).
 */
export function fanZoomInlineScript(): string {
    return FAN_ZOOM_INLINE;
}

// Kept hand-compact (no build step for it): a test checks its size, that it
// parses, and that it uses nothing outside the page.
const FAN_ZOOM_INLINE = `(function(){var M=Math,R=matchMedia('(prefers-reduced-motion: reduce)').matches,mac=/mac|iphone|ipad/i.test(navigator.platform||'');
function F(el){var s=el.querySelector('svg.fan-svg');if(!s||el.__fz)return;el.__fz=1;var b=s.getAttribute('viewBox').split(/[ ,]+/).map(Number),G0={x:b[0],y:b[1],w:b[2],h:b[3]},G=G0,v,W,H,P={},n=0,pd=null,pin=null,sup=0,an=0,ht,hint=el.querySelector('[data-fan-zoom-hint]'),rk=el.querySelector('[data-fan-zoom-reserve]');
if(hint&&mac&&hint.getAttribute('data-mac'))hint.textContent=hint.getAttribute('data-mac');
function fit(){return{z:1,cx:G.x+G.w/2,cy:G.y+G.h/2}}
function sz(){W=el.clientWidth||1;H=el.clientHeight||1;G=G0;var r=rk&&rk.getBoundingClientRect(),q=r&&r.height?el.getBoundingClientRect().bottom-r.top+6:0,f=rk?+rk.getAttribute('data-fan-zoom-reserve')||0:0,lo=0,hi=G0.h,i,m;
function fr(e){var h=G0.h+e,u=M.min(W/G0.w,H/h);return(H-h*u)/2+(G0.y+h-f)*u}
if(!q||q>=H||fr(0)>=q)return;while(fr(hi)<q)hi*=2;for(i=0;i<40;i++){m=(lo+hi)/2;if(fr(m)>=q)hi=m;else lo=m}G={x:G0.x,y:G0.y,w:G0.w,h:G0.h+hi}}
function p0(){return M.min(W/G.w,H/G.h)}
function cl(c,m,S,sp){return sp>=S?m+S/2:M.max(m+sp/2,M.min(m+S-sp/2,c))}
function cv(q){var z=M.max(1,M.min(8,q.z)),u=p0()*z;return{z:z,cx:cl(q.cx,G.x,G.w,W/u),cy:cl(q.cy,G.y,G.h,H/u)}}
function vb(){v=cv(v);var u=p0()*v.z,w=W/u,h=H/u;return{x:v.cx-w/2,y:v.cy-h/2,w:w,h:h,u:u}}
function ap(){var r=vb();s.setAttribute('viewBox',[r.x,r.y,r.w,r.h].map(function(t){return t.toFixed(2)}).join(' '));el.style.touchAction=v.z<=1.001?'pan-x pan-y':'none'}
function zb(k,x,y){var r=vb();if(x==null){x=W/2;y=H/2}var px=r.x+x/r.u,py=r.y+y/r.u,z=M.max(1,M.min(8,v.z*k)),u=p0()*z;v={z:z,cx:px-(x-W/2)/u,cy:py-(y-H/2)/u};ap()}
function pan(dx,dy){var u=vb().u;v={z:v.z,cx:v.cx-dx/u,cy:v.cy-dy/u};ap()}
function to(t){cancelAnimationFrame(an);var f=v,t0=performance.now();t=cv(t);if(R){v=t;ap();return}
function st(n){var k=M.min(1,(n-t0)/240),e=1-M.pow(1-k,3);v={z:f.z+(t.z-f.z)*e,cx:f.cx+(t.cx-f.cx)*e,cy:f.cy+(t.cy-f.cy)*e};ap();if(k<1)an=requestAnimationFrame(st)}an=requestAnimationFrame(st)}
function pt(e){var r=el.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
function two(){var k=Object.keys(P),a=P[k[0]],c=P[k[1]];return{d:M.hypot(a.x-c.x,a.y-c.y),x:(a.x+c.x)/2,y:(a.y+c.y)/2}}
sz();v=fit();ap();
el.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('[data-fan-zoom-act]');if(a){e.preventDefault();a=a.getAttribute('data-fan-zoom-act');if(a=='in')zb(1.6);else if(a=='out')zb(1/1.6);else to(fit());return}if(sup){sup=0;e.preventDefault();e.stopPropagation()}},true);
el.addEventListener('wheel',function(e){if(!e.ctrlKey&&!e.metaKey){if(hint){hint.hidden=false;clearTimeout(ht);ht=setTimeout(function(){hint.hidden=true},1500)}return}e.preventDefault();var q=pt(e),u=e.deltaMode==1?16:e.deltaMode==2?H:1;zb(M.exp(-e.deltaY*u*(e.ctrlKey?.01:.0018)),q.x,q.y)},{passive:false});
el.addEventListener('pointerdown',function(e){if(e.pointerType=='mouse'&&e.button)return;if(e.target.closest('[data-fan-zoom-act]'))return;var q=pt(e);P[e.pointerId]=q;n++;if(n==1){sup=0;pd={id:e.pointerId,x:q.x,y:q.y,m:0}}else if(n==2){pin=two();for(var i in P)try{el.setPointerCapture(+i)}catch(x){}}});
el.addEventListener('pointermove',function(e){var o=P[e.pointerId];if(!o)return;var q=pt(e);P[e.pointerId]=q;if(n>=2&&pin){var c=two();pan(c.x-pin.x,c.y-pin.y);if(pin.d>0&&c.d>0)zb(c.d/pin.d,c.x,c.y);pin=c;sup=1;return}
if(!pd||pd.id!=e.pointerId||v.z<=1.001)return;if(!pd.m&&M.hypot(q.x-pd.x,q.y-pd.y)>8){pd.m=1;sup=1;try{el.setPointerCapture(e.pointerId)}catch(x){}}if(pd.m)pan(q.x-o.x,q.y-o.y)});
function up(e){if(!P[e.pointerId])return;delete P[e.pointerId];n--;if(n<2)pin=null;if(!n)pd=null}
el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);
if(window.ResizeObserver)new ResizeObserver(function(){var w=W,h=H;sz();if(w!=W||h!=H){v=fit();ap()}}).observe(el);
addEventListener('beforeprint',function(){cancelAnimationFrame(an);G=G0;v=fit();ap()})}
function all(){document.querySelectorAll('[data-fan-zoom]').forEach(F)}
if(document.readyState=='loading')document.addEventListener('DOMContentLoaded',all);else all()})();`;
