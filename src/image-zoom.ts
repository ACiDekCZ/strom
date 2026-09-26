/**
 * Zoom and pan math for the fullscreen image viewer (excerpts, scans).
 *
 * A view maps the image's natural pixels onto the viewport: a point (u, v) of
 * the image lands at (x + u·scale, y + v·scale). Pure: the UI owns the DOM,
 * pointer tracking and animation.
 */

export interface ZoomView {
    scale: number;
    x: number;
    y: number;
}

export interface ZoomBox {
    /** Natural image size in px. */
    nw: number;
    nh: number;
    /** Viewport size in px. */
    vw: number;
    vh: number;
}

/** Share of the viewport the fitted image may take (a frame of backdrop around it). */
export const FIT_MARGIN = 0.92;

/** Zoom steps of the buttons and keys. */
export const ZOOM_STEP = 1.5;

/** The whole image, centred, as large as the viewport allows — never enlarged past 2×. */
export function fitView(box: ZoomBox): ZoomView {
    if (box.nw <= 0 || box.nh <= 0) return { scale: 1, x: 0, y: 0 };
    const scale = Math.min((box.vw * FIT_MARGIN) / box.nw, (box.vh * FIT_MARGIN) / box.nh, 2);
    return {
        scale,
        x: (box.vw - box.nw * scale) / 2,
        y: (box.vh - box.nh * scale) / 2,
    };
}

/** Allowed scale: from the fitted size up to 4 natural pixels per screen pixel (at least 8× the fit). */
export function scaleLimits(box: ZoomBox): { min: number; max: number } {
    const min = fitView(box).scale;
    return { min, max: Math.max(min * 8, 4) };
}

/**
 * Keep the image on screen: a side smaller than the viewport is centred, a
 * larger one may not uncover backdrop at its edges.
 */
export function clampView(view: ZoomView, box: ZoomBox): ZoomView {
    const { min, max } = scaleLimits(box);
    const scale = Math.min(max, Math.max(min, view.scale));
    const axis = (pos: number, natural: number, viewport: number): number => {
        const size = natural * scale;
        if (size <= viewport) return (viewport - size) / 2;
        return Math.min(0, Math.max(viewport - size, pos));
    };
    return { scale, x: axis(view.x, box.nw, box.vw), y: axis(view.y, box.nh, box.vh) };
}

/** Scale by `factor` keeping the screen point (px, py) over the same image point. */
export function zoomAt(view: ZoomView, factor: number, px: number, py: number, box: ZoomBox): ZoomView {
    const { min, max } = scaleLimits(box);
    const scale = Math.min(max, Math.max(min, view.scale * factor));
    const k = scale / view.scale;
    return clampView({ scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k }, box);
}

/** Move by (dx, dy) screen px, within the bounds. */
export function panBy(view: ZoomView, dx: number, dy: number, box: ZoomBox): ZoomView {
    return clampView({ scale: view.scale, x: view.x + dx, y: view.y + dy }, box);
}

/** Zoom level relative to the fitted size, in percent (the fit reads 100 %). */
export function zoomPercent(view: ZoomView, box: ZoomBox): number {
    return Math.round((view.scale / fitView(box).scale) * 100);
}

/** At (or within a hair of) the fitted size. */
export function isFitted(view: ZoomView, box: ZoomBox): boolean {
    return view.scale <= fitView(box).scale * 1.001;
}
