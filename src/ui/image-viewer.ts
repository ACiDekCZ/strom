/**
 * Fullscreen image viewer for source excerpts and image attachments: pinch,
 * wheel / trackpad and double-tap zoom, drag to pan, − / level / + buttons,
 * keys + − 0 and arrows. A tap on the backdrop, × or Escape closes it.
 *
 * List mode (`openViewerList`, the materials): ‹ › beside the image, ← / →
 * while the image is fitted, a sideways swipe on touch; the position on top,
 * a details panel at the side (a bottom sheet on a phone) filled by the
 * caller, and a card instead of the image for files the browser cannot show.
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
/** A sideways swipe this long goes to the next item (list mode). */
const SWIPE_MIN = 50;

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
    /** The image was fitted when the gesture began (a sideways swipe goes to the next item). */
    fitted: boolean;
} | null = null;
let lastTap: { t: number; x: number; y: number } | null = null;

function el<T extends HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
}

function overlay(): HTMLElement | null { return el('attachment-overlay'); }
function isCard(): boolean { return !!overlay()?.classList.contains('is-card'); }
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
        fitted: gesture?.fitted ?? (isFitted(view, box) || isCard()),
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
    if (!g || e.type === 'pointercancel') return;
    // List mode: a sideways swipe over a fitted image (or a card) goes to the neighbour.
    if (list && g.moved && g.fitted && g.startDist === 0) {
        const dx = point.x - g.startX, dy = point.y - g.startY;
        if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.5) {
            goViewerList(dx < 0 ? 1 : -1);
            return;
        }
    }
    if (g.moved) return;
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
    // A dialog opened from the viewer (assigning, hiding) takes its own keys.
    if (document.querySelector('[data-over-viewer]')) return;
    const browse = !!list && (isFitted(view, box) || isCard());
    const handled = (() => {
        switch (e.key) {
            case 'Escape': closeImageViewer(); return true;
            case '+': case '=': if (isCard()) return false; step(ZOOM_STEP); return true;
            case '-': case '_': if (isCard()) return false; step(1 / ZOOM_STEP); return true;
            case '0': if (isCard()) return false; fit(true); return true;
            case 'ArrowLeft': if (browse) goViewerList(-1); else setView(panBy(view, 80, 0, box), true); return true;
            case 'ArrowRight': if (browse) goViewerList(1); else setView(panBy(view, -80, 0, box), true); return true;
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
    if (list) sheetHeight();
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
    el('image-viewer-prev')?.addEventListener('click', () => goViewerList(-1));
    el('image-viewer-next')?.addEventListener('click', () => goViewerList(1));
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
    if (list && isOpen()) closeImageViewer();
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
    if (list) {
        list = null;
        listToken++;
        ov.classList.remove('is-list', 'is-card');
        ov.style.removeProperty('--iv-sheet');
        const panel = el('image-viewer-panel');
        if (panel) panel.innerHTML = '';
        const card = el('image-viewer-card');
        if (card) { card.innerHTML = ''; card.hidden = true; }
        listNote(null);
        const pos = el('image-viewer-pos');
        if (pos) pos.textContent = '';
        if (image) { image.onerror = null; image.style.visibility = ''; }
    }
    const done = onClose;
    onClose = null;
    const back = returnFocus;
    returnFocus = null;
    done?.();
    if (back?.isConnected) back.focus({ preventScroll: true });
}

// ==================== LIST MODE ====================

/** What the caller draws for each item of a list. */
export interface ViewerSlots {
    /** An image: `preview` at once (when given), then `src` over it once loaded. `failed`: neither could be shown. */
    image: (src: string, preview?: string | null, failed?: () => void) => void;
    /** A card in place of the image (a file the browser does not show). */
    card: (content: HTMLElement) => void;
    /** The position line on top ("3 / 14 · Materials of Jan Novák"). */
    pos: (text: string) => void;
    /** A label over the bottom of the image ("Stored preview…"); null: none. */
    note: (text: string | null) => void;
    /** The details panel (emptied before each item). */
    panel: HTMLElement;
    /** Only the panel is drawn again (the stage keeps its image or card). */
    redraw?: boolean;
}

export interface ViewerList {
    count: number;
    index: number;
    show: (index: number, slots: ViewerSlots) => void;
}

let list: ViewerList | null = null;
/** Bumped on every drawn item: a late image load of the previous one is dropped. */
let listToken = 0;
let returnFocus: HTMLElement | null = null;

/** Is the viewer open in list mode. */
export function viewerListOpen(): boolean {
    return !!list && isOpen();
}

/** The item shown (list mode; -1: none). */
export function viewerListIndex(): number {
    return list && isOpen() ? list.index : -1;
}

function listImage(src: string, preview: string | null | undefined, failed: (() => void) | undefined, token: number): void {
    const image = img();
    const ov = overlay();
    const card = el('image-viewer-card');
    if (!image || !ov) return;
    ov.classList.remove('is-card');
    if (card) { card.innerHTML = ''; card.hidden = true; }
    const first = preview || src;
    image.style.visibility = 'hidden';
    image.onload = () => {
        if (token !== listToken) return;
        measure();
        fit();
        image.style.visibility = '';
    };
    image.onerror = () => {
        if (token === listToken && first === src) failed?.();
    };
    image.src = first;
    if (!preview || preview === src) return;
    // Full quality over the preview, once it is here (the view stays fitted).
    const full = new Image();
    full.onload = () => {
        if (token !== listToken || !isOpen()) return;
        const wasFitted = isFitted(view, box);
        image.onload = () => {
            if (token !== listToken) return;
            measure();
            if (wasFitted) fit(); else setView(clampView(view, box));
            image.style.visibility = '';
        };
        image.onerror = null;
        image.src = src;
    };
    full.onerror = () => { if (token === listToken) failed?.(); };
    full.src = src;
}

function listCard(content: HTMLElement, token: number): void {
    const image = img();
    const ov = overlay();
    const card = el('image-viewer-card');
    if (!image || !ov || !card || token !== listToken) return;
    image.onload = null;
    image.onerror = null;
    image.removeAttribute('src');
    image.style.visibility = 'hidden';
    ov.classList.add('is-card');
    ov.classList.remove('is-zoomed');
    card.innerHTML = '';
    card.appendChild(content);
    card.hidden = false;
    dismissHint();
}

/** On a phone the panel is a sheet under the image: the stage ends above it (collapsed). */
function sheetHeight(): void {
    const ov = overlay();
    const panel = el('image-viewer-panel');
    if (!ov || !panel) return;
    const phone = matchMedia('(max-width: 640px)').matches;
    if (!phone || panel.classList.contains('is-expanded')) {
        if (!phone) ov.style.removeProperty('--iv-sheet');
        return;
    }
    ov.style.setProperty('--iv-sheet', `${panel.offsetHeight}px`);
}

/** The panel's size changed (expanded, redrawn): the stage follows and the image stays fitted. */
export function relayoutViewer(): void {
    if (!isOpen()) return;
    sheetHeight();
    const wasFitted = isFitted(view, box);
    measure();
    if (wasFitted) fit(); else setView(clampView(view, box));
}

function listNote(text: string | null): void {
    const note = el('image-viewer-note');
    if (!note) return;
    note.textContent = text ?? '';
    note.hidden = !text;
}

function drawListItem(): void {
    const l = list;
    const ov = overlay();
    const panel = el('image-viewer-panel');
    if (!l || !ov || !panel) return;
    const token = ++listToken;
    listNote(null);
    pointers.clear();
    gesture = null;
    panel.innerHTML = '';
    panel.scrollTop = 0;
    const prev = el<HTMLButtonElement>('image-viewer-prev');
    const next = el<HTMLButtonElement>('image-viewer-next');
    if (prev) prev.disabled = l.index <= 0;
    if (next) next.disabled = l.index >= l.count - 1;
    ov.classList.toggle('is-single', l.count <= 1);
    l.show(l.index, {
        image: (src, preview, failed) => { if (token === listToken) listImage(src, preview, failed, token); },
        card: (content) => listCard(content, token),
        pos: (text) => { const p = el('image-viewer-pos'); if (p && token === listToken) p.textContent = text; },
        note: (text) => { if (token === listToken) listNote(text); },
        panel,
    });
    requestAnimationFrame(() => { if (token === listToken) relayoutViewer(); });
}

/** Go `delta` items along the list (‹ ›, arrows, swipe); stops at the ends. */
export function goViewerList(delta: number): void {
    const l = list;
    if (!l || !isOpen()) return;
    const next = Math.max(0, Math.min(l.count - 1, l.index + delta));
    if (next === l.index) return;
    l.index = next;
    renderMediaBar(undefined);
    drawListItem();
}

/** Draw the shown item again (its data changed): the panel only, or with `stage` the image or card too. */
export function redrawViewerList(opts: { stage?: boolean } = {}): void {
    const l = list;
    const panel = el('image-viewer-panel');
    if (!l || !panel || !isOpen()) return;
    if (opts.stage) {
        drawListItem();
        return;
    }
    const scroll = panel.scrollTop;
    const token = listToken;
    panel.innerHTML = '';
    l.show(l.index, {
        image: () => { /* the stage stays */ },
        card: () => { /* the stage stays */ },
        note: () => { /* the stage stays */ },
        pos: (text) => { const p = el('image-viewer-pos'); if (p && token === listToken) p.textContent = text; },
        panel,
        redraw: true,
    });
    panel.scrollTop = scroll;
    requestAnimationFrame(() => { if (token === listToken) relayoutViewer(); });
}

/** Open the viewer over a list of items: `show` draws each one (the stage and the panel). */
export function openViewerList(opts: ViewerList, close?: () => void): void {
    const ov = overlay();
    if (!ov || opts.count <= 0) return;
    if (isOpen()) closeImageViewer();
    wire();
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    list = { ...opts, index: Math.max(0, Math.min(opts.count - 1, opts.index)) };
    onClose = close ?? null;
    lastTap = null;
    renderMediaBar(undefined);
    ov.classList.add('is-list', 'active');
    drawListItem();
    document.addEventListener('keydown', onKey, true);
    ov.focus({ preventScroll: true });
}
