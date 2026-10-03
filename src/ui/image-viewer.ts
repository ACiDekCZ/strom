/**
 * Fullscreen image viewer for source excerpts and image attachments: pinch,
 * wheel / trackpad and double-tap zoom, drag to pan, − / level / + buttons,
 * keys + − 0 and arrows. A tap on the backdrop, × or Escape closes it.
 *
 * The page disables browser zoom (viewport user-scalable=no), so the viewer
 * does its own: the stage takes all touches (touch-action: none) and the math
 * lives in src/image-zoom.ts.
 */

import { strings } from '../strings.js';
import {
    ZoomView, ZoomBox, fitView, clampView, zoomAt, panBy, zoomPercent, isFitted, scaleLimits, ZOOM_STEP,
} from '../image-zoom.js';

/** Double-tap / double-click: the zoom it jumps to from the fit (× fit). */
const DOUBLE_TAP_ZOOM = 3;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 30;
/** Movement that turns a tap into a drag. */
const DRAG_SLOP = 6;
const HINT_MS = 2600;

let view: ZoomView = { scale: 1, x: 0, y: 0 };
let box: ZoomBox = { nw: 0, nh: 0, vw: 0, vh: 0 };
let onClose: (() => void) | null = null;
let wired = false;
let hintTimer: ReturnType<typeof setTimeout> | null = null;

const pointers = new Map<number, { x: number; y: number }>();
let gesture: {
    startView: ZoomView;
    startX: number; startY: number;
    startDist: number; startMidX: number; startMidY: number;
    moved: boolean;
    onImage: boolean;
} | null = null;
let lastTap: { t: number; x: number; y: number } | null = null;

function el<T extends HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
}

function overlay(): HTMLElement | null { return el('attachment-overlay'); }
function img(): HTMLImageElement | null { return el<HTMLImageElement>('attachment-overlay-img'); }
function isOpen(): boolean { return !!overlay()?.classList.contains('active'); }

function measure(): void {
    const stage = el('image-viewer-stage');
    const image = img();
    box = {
        nw: image?.naturalWidth ?? 0,
        nh: image?.naturalHeight ?? 0,
        vw: stage?.clientWidth ?? window.innerWidth,
        vh: stage?.clientHeight ?? window.innerHeight,
    };
}

function render(animate = false): void {
    const image = img();
    const ov = overlay();
    if (!image || !ov) return;
    ov.classList.toggle('is-animating', animate);
    image.style.width = `${box.nw}px`;
    image.style.height = `${box.nh}px`;
    image.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    ov.classList.toggle('is-zoomed', !isFitted(view, box));
    const level = el<HTMLButtonElement>('image-viewer-level');
    if (level) level.textContent = `${zoomPercent(view, box)} %`;
    const { min, max } = scaleLimits(box);
    const zoomOut = el<HTMLButtonElement>('image-viewer-out');
    const zoomIn = el<HTMLButtonElement>('image-viewer-in');
    if (zoomOut) zoomOut.disabled = view.scale <= min * 1.001;
    if (zoomIn) zoomIn.disabled = view.scale >= max * 0.999;
}

function setView(next: ZoomView, animate = false): void {
    view = next;
    render(animate);
}

function fit(animate = false): void {
    setView(fitView(box), animate);
}

/** Zoom by a step around the viewport centre (buttons, keys). */
function step(factor: number): void {
    setView(zoomAt(view, factor, box.vw / 2, box.vh / 2, box), true);
    dismissHint();
}

/** Double-tap / double-click: into the point, or back to the fit. */
function toggleZoomAt(x: number, y: number): void {
    if (isFitted(view, box)) setView(zoomAt(view, DOUBLE_TAP_ZOOM, x, y, box), true);
    else fit(true);
    dismissHint();
}

function showHint(touch: boolean): void {
    const hint = el('image-viewer-hint');
    if (!hint) return;
    hint.textContent = touch ? strings.imageViewer.hintTouch : strings.imageViewer.hintMouse;
    hint.classList.add('show');
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(dismissHint, HINT_MS);
}

function dismissHint(): void {
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
    el('image-viewer-hint')?.classList.remove('show');
}

function stagePoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = el('image-viewer-stage')?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
}

function beginGesture(onImage: boolean): void {
    const pts = [...pointers.values()];
    const [a, b] = pts;
    gesture = {
        startView: { ...view },
        startX: a.x, startY: a.y,
        startDist: b ? Math.hypot(b.x - a.x, b.y - a.y) : 0,
        startMidX: b ? (a.x + b.x) / 2 : a.x,
        startMidY: b ? (a.y + b.y) / 2 : a.y,
        moved: gesture?.moved ?? false,
        onImage: gesture?.onImage ?? onImage,
    };
}

function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const stage = e.currentTarget as HTMLElement;
    try { stage.setPointerCapture(e.pointerId); } catch { /* a pointer that is not active */ }
    pointers.set(e.pointerId, stagePoint(e));
    if (pointers.size > 2) return;
    if (pointers.size === 1) gesture = null;
    beginGesture(e.target === img());
    overlay()?.classList.remove('is-animating');
}

function onPointerMove(e: PointerEvent): void {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, stagePoint(e));
    const pts = [...pointers.values()];
    if (pts.length >= 2 && gesture.startDist > 0) {
        const [a, b] = pts;
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
        // Scale around the starting midpoint, then follow the fingers' travel.
        const zoomed = zoomAt(gesture.startView, dist / gesture.startDist, gesture.startMidX, gesture.startMidY, box);
        setView(panBy(zoomed, midX - gesture.startMidX, midY - gesture.startMidY, box));
        gesture.moved = true;
        dismissHint();
        return;
    }
    const [p] = pts;
    const dx = p.x - gesture.startX, dy = p.y - gesture.startY;
    if (!gesture.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    gesture.moved = true;
    overlay()?.classList.add('is-panning');
    setView(panBy(gesture.startView, dx, dy, box));
    dismissHint();
}

function onPointerUp(e: PointerEvent): void {
    if (!pointers.has(e.pointerId)) return;
    const point = pointers.get(e.pointerId)!;
    pointers.delete(e.pointerId);
    overlay()?.classList.remove('is-panning');
    if (pointers.size > 0) {
        // One finger lifted from a pinch: the other goes on panning from here.
        beginGesture(false);
        if (gesture) gesture.moved = true;
        return;
    }
    const g = gesture;
    gesture = null;
    if (!g || g.moved || e.type === 'pointercancel') return;
    // A tap: a second one soon after on the same spot toggles the zoom; a
    // single tap on the backdrop closes.
    const now = performance.now();
    if (lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < DOUBLE_TAP_SLOP) {
        lastTap = null;
        toggleZoomAt(point.x, point.y);
        return;
    }
    lastTap = { t: now, x: point.x, y: point.y };
    if (!g.onImage) closeImageViewer();
}

function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = stagePoint(e);
    // Trackpad pinch arrives as a wheel with ctrlKey and small deltas.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? box.vh : 1;
    const speed = e.ctrlKey ? 0.01 : 0.0025;
    const factor = Math.exp(-e.deltaY * unit * speed);
    overlay()?.classList.remove('is-animating');
    setView(zoomAt(view, factor, p.x, p.y, box));
    dismissHint();
}

function onKey(e: KeyboardEvent): void {
    if (!isOpen()) return;
    const handled = (() => {
        switch (e.key) {
            case 'Escape': closeImageViewer(); return true;
            case '+': case '=': step(ZOOM_STEP); return true;
            case '-': case '_': step(1 / ZOOM_STEP); return true;
            case '0': fit(true); return true;
            case 'ArrowLeft': setView(panBy(view, 80, 0, box), true); return true;
            case 'ArrowRight': setView(panBy(view, -80, 0, box), true); return true;
            case 'ArrowUp': setView(panBy(view, 0, 80, box), true); return true;
            case 'ArrowDown': setView(panBy(view, 0, -80, box), true); return true;
            default: return false;
        }
    })();
    if (!handled) return;
    // The viewer sits over dialogs: its keys never reach the global handler
    // (Escape would close the edit dialog underneath).
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
}

function onResize(): void {
    if (!isOpen()) return;
    const wasFitted = isFitted(view, box);
    measure();
    if (wasFitted) fit(); else setView(clampView(view, box));
}

function wire(): void {
    if (wired) return;
    const stage = el('image-viewer-stage');
    if (!stage) return;
    wired = true;
    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('pointercancel', onPointerUp);
    stage.addEventListener('wheel', onWheel, { passive: false });
    // iOS Safari: keep its own page pinch out of the viewer.
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
        overlay()?.addEventListener(type, ev => ev.preventDefault());
    }
    el('image-viewer-in')?.addEventListener('click', () => step(ZOOM_STEP));
    el('image-viewer-out')?.addEventListener('click', () => step(1 / ZOOM_STEP));
    el('image-viewer-level')?.addEventListener('click', () => { fit(true); dismissHint(); });
    el('image-viewer-close')?.addEventListener('click', () => closeImageViewer());
    window.addEventListener('resize', onResize);
}

/**
 * The original behind a preview, in full quality (Strom Research): the bar's
 * button loads it over the preview with its progress; once here, a chip
 * names its size and "Back to preview" returns. All texts come with it.
 */
export interface ViewerOriginal {
    label: string;
    title: string;
    loading: string;
    loadedOf: (loaded: number, total: number) => string;
    chip: (width: number, height: number, bytes: number) => string;
    back: string;
    cancel: string;
    load: (progress: (loaded: number, total: number) => void, signal: AbortSignal) => Promise<{ url: string; bytes: number }>;
    onError: (err: unknown) => void;
    /** Start loading at once (opened from "Full quality"). */
    autoLoad?: boolean;
}

/** The preview the viewer opened on, and the original loaded over it (an object URL, revoked on close). */
let previewSrc = '';
let originalUrl: string | null = null;
let originalAbort: AbortController | null = null;

function mediaBar(): HTMLElement | null { return el('image-viewer-media'); }

/** Show an image in the stage, keeping the view fitted. */
function showSrc(src: string): void {
    const image = img();
    if (!image) return;
    image.onload = () => { measure(); fit(); image.style.visibility = ''; };
    image.src = src;
}

/** Draw the media bar for `original`: the button, the progress, or the chip with "Back to preview". */
function renderMediaBar(original: ViewerOriginal | undefined, state: { loading?: { loaded: number; total: number }; loaded?: { bytes: number } } = {}): void {
    const bar = mediaBar();
    if (!bar) return;
    bar.innerHTML = '';
    bar.hidden = !original;
    if (!original) return;
    const button = (text: string, onClick: () => void, title = ''): HTMLButtonElement => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'image-viewer-media-btn';
        b.textContent = text;
        if (title) b.title = title;
        b.addEventListener('click', onClick);
        return b;
    };
    if (state.loading) {
        const { loaded, total } = state.loading;
        const text = document.createElement('span');
        text.className = 'image-viewer-media-text';
        text.textContent = `${original.loading} · ${original.loadedOf(loaded, total)}`;
        const track = document.createElement('span');
        track.className = 'image-viewer-media-track';
        const fill = document.createElement('span');
        fill.style.width = `${total > 0 ? Math.min(100, Math.round(loaded / total * 100)) : 0}%`;
        track.appendChild(fill);
        bar.append(text, track, button(original.cancel, () => originalAbort?.abort()));
        return;
    }
    if (state.loaded) {
        const image = img();
        const chip = document.createElement('span');
        chip.className = 'image-viewer-media-text image-viewer-media-chip';
        chip.textContent = original.chip(image?.naturalWidth ?? 0, image?.naturalHeight ?? 0, state.loaded.bytes);
        bar.append(chip, button(original.back, () => {
            showSrc(previewSrc);
            renderMediaBar(original);
        }));
        return;
    }
    bar.append(button(original.label, () => { void loadOriginal(original); }, original.title));
}

async function loadOriginal(original: ViewerOriginal): Promise<void> {
    if (originalUrl) {
        const url = originalUrl;
        const image = img();
        showSrc(url);
        image?.addEventListener('load', () => renderMediaBar(original, { loaded: { bytes: loadedBytes } }), { once: true });
        return;
    }
    originalAbort?.abort();
    const ctl = new AbortController();
    originalAbort = ctl;
    renderMediaBar(original, { loading: { loaded: 0, total: 0 } });
    try {
        const { url, bytes } = await original.load((loaded, total) => {
            if (!ctl.signal.aborted) renderMediaBar(original, { loading: { loaded, total } });
        }, ctl.signal);
        if (ctl.signal.aborted || !isOpen()) { URL.revokeObjectURL(url); return; }
        originalUrl = url;
        loadedBytes = bytes;
        const image = img();
        showSrc(url);
        image?.addEventListener('load', () => renderMediaBar(original, { loaded: { bytes } }), { once: true });
    } catch (err) {
        renderMediaBar(original);
        if (!ctl.signal.aborted) original.onError(err);
    } finally {
        if (originalAbort === ctl) originalAbort = null;
    }
}
let loadedBytes = 0;

/** Open the viewer on an image (data URL); `close` runs after it closes. `original`: its full quality from the research. */
export function openImageViewer(dataUrl: string, close?: () => void, original?: ViewerOriginal): void {
    const image = img();
    const ov = overlay();
    if (!image || !ov || !dataUrl) return;
    previewSrc = dataUrl;
    renderMediaBar(original);
    if (original?.autoLoad) queueMicrotask(() => { void loadOriginal(original); });
    wire();
    onClose = close ?? null;
    pointers.clear();
    gesture = null;
    lastTap = null;
    const show = () => {
        measure();
        fit();
        image.style.visibility = '';
    };
    image.style.visibility = 'hidden';
    image.onload = show;
    image.src = dataUrl;
    ov.classList.add('active');
    if (image.complete && image.naturalWidth > 0) show();
    document.addEventListener('keydown', onKey, true);
    showHint(matchMedia('(hover: none), (pointer: coarse)').matches);
    // Focus the dialog itself (keys work at once, no ring on a button).
    ov.focus({ preventScroll: true });
}

export function closeImageViewer(): void {
    const ov = overlay();
    if (!ov) return;
    ov.classList.remove('active', 'is-zoomed', 'is-panning', 'is-animating');
    const image = img();
    if (image) { image.onload = null; image.removeAttribute('src'); image.style.transform = ''; }
    // The original stays in memory only while it is shown.
    originalAbort?.abort();
    originalAbort = null;
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    originalUrl = null;
    renderMediaBar(undefined);
    document.removeEventListener('keydown', onKey, true);
    dismissHint();
    pointers.clear();
    gesture = null;
    const done = onClose;
    onClose = null;
    done?.();
}
