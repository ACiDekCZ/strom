/**
 * Crop editor: pick a rectangle out of an image (a register page) and get it
 * back as a compressed JPEG. A self-contained overlay built per open — no
 * markup in index.html beyond its CSS — shared by source excerpts and, later,
 * the person photo (fixed 1:1 aspect).
 *
 * Interaction: drag inside the frame moves it, the handles resize it, dragging
 * outside draws a new frame; wheel / pinch zoom, the stage scrolls when zoomed,
 * double-click fits. Keyboard on the frame: arrows move (Shift ×10), Alt+arrows
 * resize, Enter applies, Escape cancels.
 */

import { strings } from '../strings.js';
import { EXCERPT_MAX_SIDE, EXCERPT_QUALITY } from '../excerpts.js';
import { ATTACHMENT_MAX_SIDE, ATTACHMENT_QUALITY } from '../attachments.js';
import { dataUrlByteSize } from '../photo.js';

/** A rectangle in fractions of the image (0–1 from the top left). */
export interface CropRegion { x: number; y: number; w: number; h: number }

export interface CropOptions {
    /** Start with this frame (re-cropping); default a band across the middle. */
    region?: CropRegion;
    /** Offer "Also save the whole page as an attachment". */
    allowKeepPage?: boolean;
    /** Force a width/height ratio (1 for the photo). */
    aspect?: number;
    /** Title override. */
    title?: string;
}

export interface CropResult {
    /** The crop as a JPEG data URL, long side ≤ EXCERPT_MAX_SIDE. */
    dataUrl: string;
    width: number;
    height: number;
    sizeBytes: number;
    /** The frame in fractions of the (rotated) page. */
    region: CropRegion;
    /** The user asked to keep the whole page as an attachment. */
    keepPage: boolean;
    /** The whole (rotated) page compressed as an attachment — set when keepPage. */
    pageDataUrl?: string;
    /** The page was rotated, so `region` refers to the rotated page. */
    rotated: boolean;
}

/** Largest working canvas side: enough for any register scan, bounded memory. */
const WORK_MAX_SIDE = 4000;
/** Smallest usable frame, in on-screen pixels. */
const MIN_FRAME_W = 40;
const MIN_FRAME_H = 20;

/** Decode a Blob or data URL into an upright bitmap (EXIF orientation applied). */
async function decodeImage(source: Blob | string): Promise<ImageBitmap> {
    const blob = typeof source === 'string' ? await (await fetch(source)).blob() : source;
    return createImageBitmap(blob, { imageOrientation: 'from-image' });
}

/** Draw `img` onto a canvas rotated by quarter turns, scaled so its long side ≤ maxSide. */
function renderRotated(img: CanvasImageSource & { width: number; height: number }, turns: number, maxSide: number): HTMLCanvasElement {
    const t = ((turns % 4) + 4) % 4;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = t % 2 ? h : w;
    canvas.height = t % 2 ? w : h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((t * Math.PI) / 2);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    return canvas;
}

/** Cut `region` out of `page` as a JPEG, long side ≤ maxSide. */
export function cropToJpeg(page: HTMLCanvasElement, region: CropRegion, maxSide = EXCERPT_MAX_SIDE, quality = EXCERPT_QUALITY):
    { dataUrl: string; width: number; height: number } {
    const sx = region.x * page.width, sy = region.y * page.height;
    const sw = Math.max(1, region.w * page.width), sh = Math.max(1, region.h * page.height);
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(sw * scale));
    out.height = Math.max(1, Math.round(sh * scale));
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    // JPEG has no alpha: a transparent PNG screenshot would turn black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(page, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return { dataUrl: out.toDataURL('image/jpeg', quality), width: out.width, height: out.height };
}

/**
 * Compress a whole image (a pasted screenshot) as an excerpt without cropping.
 * Returns the JPEG plus its size.
 */
export async function compressWholeImage(source: Blob | string):
    Promise<{ dataUrl: string; width: number; height: number; sizeBytes: number }> {
    const bitmap = await decodeImage(source);
    try {
        const page = renderRotated(bitmap, 0, WORK_MAX_SIDE);
        const out = cropToJpeg(page, { x: 0, y: 0, w: 1, h: 1 });
        return { ...out, sizeBytes: dataUrlByteSize(out.dataUrl) };
    } finally {
        bitmap.close();
    }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keep a region inside the image with a positive size. */
function clampRegion(r: CropRegion): CropRegion {
    const w = clamp(r.w, 0.001, 1), h = clamp(r.h, 0.001, 1);
    return { x: clamp(r.x, 0, 1 - w), y: clamp(r.y, 0, 1 - h), w, h };
}

/** Rough JPEG size of a crop, for the live estimate (q0.8 on a scan ≈ 0.12 B/px). */
function estimateKb(w: number, h: number): number {
    return Math.max(1, Math.round((w * h * 0.12) / 1024));
}

type DragMode = { kind: 'move' | 'new' | 'resize'; handle?: string; startX: number; startY: number; start: CropRegion };

/**
 * Open the crop editor over everything else. Resolves with the crop, or null
 * when cancelled. Only one editor can be open at a time.
 */
export async function openCropEditor(source: Blob | string, options: CropOptions = {}): Promise<CropResult | null> {
    const bitmap = await decodeImage(source);
    let turns = 0;
    let page = renderRotated(bitmap, turns, WORK_MAX_SIDE);
    let region: CropRegion = clampRegion(options.region ?? { x: 0.1, y: 0.4, w: 0.8, h: 0.2 });
    let zoom = 1;
    const opener = document.activeElement as HTMLElement | null;
    const s = strings.crop;

    const overlay = document.createElement('div');
    overlay.className = 'crop-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'crop-title');
    const keepPageHtml = options.allowKeepPage ? `
        <label class="crop-keep"><input type="checkbox" id="crop-keep-page"> <span>${s.keepPage}</span></label>` : '';
    overlay.innerHTML = `
        <div class="crop-dialog">
            <div class="crop-toolbar">
                <button type="button" class="crop-cancel crop-narrow-only">${strings.buttons.cancel}</button>
                <h2 id="crop-title">${options.title ?? s.title}</h2>
                <div class="crop-tools">
                    <button type="button" class="crop-rot-l crop-wide-only" title="${s.rotateLeft}" aria-label="${s.rotateLeft}">↺</button>
                    <button type="button" class="crop-rot-r crop-wide-only" title="${s.rotateRight}" aria-label="${s.rotateRight}">↻</button>
                    <button type="button" class="crop-zoom-out crop-wide-only" title="${s.zoomOut}" aria-label="${s.zoomOut}">−</button>
                    <span class="crop-zoom-pct crop-wide-only" aria-live="polite">100 %</span>
                    <button type="button" class="crop-zoom-in crop-wide-only" title="${s.zoomIn}" aria-label="${s.zoomIn}">+</button>
                    <button type="button" class="crop-fit crop-wide-only">${s.fit}</button>
                    <button type="button" class="crop-close crop-wide-only close-btn" aria-label="${strings.buttons.close}">&times;</button>
                </div>
                <button type="button" class="crop-apply crop-apply-top crop-narrow-only primary">${s.applyShort}</button>
            </div>
            <div class="crop-stage">
                <div class="crop-wrap">
                    <div class="crop-frame" tabindex="0" role="application" aria-label="${s.aria}">
                        ${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(h => `<span class="crop-handle crop-h-${h}" data-handle="${h}"></span>`).join('')}
                    </div>
                </div>
            </div>
            <div class="crop-footer">
                <div class="crop-footer-tools crop-narrow-only">
                    <button type="button" class="crop-rot-l" title="${s.rotateLeft}" aria-label="${s.rotateLeft}">↺</button>
                    <button type="button" class="crop-rot-r" title="${s.rotateRight}" aria-label="${s.rotateRight}">↻</button>
                </div>
                <span class="crop-size"></span>
                ${keepPageHtml}
                <div class="crop-buttons crop-wide-only">
                    <button type="button" class="crop-cancel secondary">${strings.buttons.cancel}</button>
                    <button type="button" class="crop-apply primary">${s.apply}</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const q = <T extends HTMLElement>(sel: string) => overlay.querySelector<T>(sel)!;
    const stage = q<HTMLDivElement>('.crop-stage');
    const wrap = q<HTMLDivElement>('.crop-wrap');
    const frame = q<HTMLDivElement>('.crop-frame');
    const sizeEl = q<HTMLSpanElement>('.crop-size');
    const pctEl = q<HTMLSpanElement>('.crop-zoom-pct');
    wrap.prepend(page);

    /** Scale that fits the page into the stage at zoom 1. */
    const fitScale = (): number => {
        const pad = 16;
        const sw = Math.max(50, stage.clientWidth - pad * 2);
        const sh = Math.max(50, stage.clientHeight - pad * 2);
        return Math.min(sw / page.width, sh / page.height, 4);
    };
    const displayW = () => page.width * fitScale() * zoom;
    const displayH = () => page.height * fitScale() * zoom;

    const layout = (): void => {
        const w = displayW(), h = displayH();
        wrap.style.width = `${w}px`;
        wrap.style.height = `${h}px`;
        page.style.width = `${w}px`;
        page.style.height = `${h}px`;
        frame.style.left = `${region.x * w}px`;
        frame.style.top = `${region.y * h}px`;
        frame.style.width = `${region.w * w}px`;
        frame.style.height = `${region.h * h}px`;
        pctEl.textContent = `${Math.round(zoom * 100)} %`;
        const outScale = Math.min(1, EXCERPT_MAX_SIDE / Math.max(region.w * page.width, region.h * page.height));
        const ow = Math.round(region.w * page.width * outScale), oh = Math.round(region.h * page.height * outScale);
        sizeEl.textContent = s.size(ow, oh, estimateKb(ow, oh));
        const tooSmall = region.w * w < MIN_FRAME_W || region.h * h < MIN_FRAME_H;
        overlay.querySelectorAll<HTMLButtonElement>('.crop-apply').forEach(b => { b.disabled = tooSmall; });
    };

    const setZoom = (next: number, anchorX?: number, anchorY?: number): void => {
        const prev = zoom;
        zoom = clamp(next, 1, 8);
        if (zoom === prev) return;
        // Keep the point under the cursor (or the stage centre) in place.
        const ax = anchorX ?? stage.clientWidth / 2;
        const ay = anchorY ?? stage.clientHeight / 2;
        const px = (stage.scrollLeft + ax) / prev, py = (stage.scrollTop + ay) / prev;
        layout();
        stage.scrollLeft = px * zoom - ax;
        stage.scrollTop = py * zoom - ay;
    };

    const setRegion = (r: CropRegion): void => {
        region = options.aspect ? withAspect(r, options.aspect) : clampRegion(r);
        layout();
    };
    /** Force a width/height ratio (in page pixels), keeping the top left corner. */
    const withAspect = (r: CropRegion, aspect: number): CropRegion => {
        const wPx = r.w * page.width;
        const hPx = wPx / aspect;
        return clampRegion({ ...r, h: hPx / page.height });
    };

    const rotate = (dir: 1 | -1): void => {
        turns = (turns + dir + 4) % 4;
        const next = renderRotated(bitmap, turns, WORK_MAX_SIDE);
        page.replaceWith(next);
        page = next;
        // The frame turns with the page.
        const r = region;
        region = clampRegion(dir === 1
            ? { x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w }
            : { x: r.y, y: 1 - r.x - r.w, w: r.h, h: r.w });
        zoom = 1;
        layout();
    };

    // ---------- pointer ----------
    let drag: DragMode | null = null;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchStart: { dist: number; zoom: number } | null = null;

    const toFrac = (e: PointerEvent): { fx: number; fy: number } => {
        const rect = wrap.getBoundingClientRect();
        return { fx: (e.clientX - rect.left) / rect.width, fy: (e.clientY - rect.top) / rect.height };
    };

    wrap.addEventListener('pointerdown', (e) => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) {
            // Second finger: pinch zoom instead of dragging.
            drag = null;
            const [a, b] = [...pointers.values()];
            pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
            return;
        }
        const target = e.target as HTMLElement;
        const { fx, fy } = toFrac(e);
        const handle = target.dataset.handle;
        drag = handle ? { kind: 'resize', handle, startX: fx, startY: fy, start: { ...region } }
            : target === frame ? { kind: 'move', startX: fx, startY: fy, start: { ...region } }
            : { kind: 'new', startX: fx, startY: fy, start: { ...region } };
        wrap.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    wrap.addEventListener('pointermove', (e) => {
        if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinchStart && pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            const sr = stage.getBoundingClientRect();
            setZoom(pinchStart.zoom * dist / Math.max(1, pinchStart.dist), (a.x + b.x) / 2 - sr.left, (a.y + b.y) / 2 - sr.top);
            return;
        }
        if (!drag) return;
        const { fx, fy } = toFrac(e);
        const dx = fx - drag.startX, dy = fy - drag.startY;
        const r0 = drag.start;
        if (drag.kind === 'move') {
            setRegion({ ...r0, x: clamp(r0.x + dx, 0, 1 - r0.w), y: clamp(r0.y + dy, 0, 1 - r0.h) });
        } else if (drag.kind === 'new') {
            const x1 = clamp(Math.min(drag.startX, fx), 0, 1), x2 = clamp(Math.max(drag.startX, fx), 0, 1);
            const y1 = clamp(Math.min(drag.startY, fy), 0, 1), y2 = clamp(Math.max(drag.startY, fy), 0, 1);
            if (x2 - x1 > 0.005 && y2 - y1 > 0.005) setRegion({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
        } else {
            let { x, y } = r0;
            let right = r0.x + r0.w, bottom = r0.y + r0.h;
            const hnd = drag.handle ?? '';
            if (hnd.includes('w')) x = clamp(r0.x + dx, 0, right - 0.01);
            if (hnd.includes('e')) right = clamp(right + dx, x + 0.01, 1);
            if (hnd.includes('n')) y = clamp(r0.y + dy, 0, bottom - 0.01);
            if (hnd.includes('s')) bottom = clamp(bottom + dy, y + 0.01, 1);
            setRegion({ x, y, w: right - x, h: bottom - y });
        }
    });
    const endPointer = (e: PointerEvent): void => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchStart = null;
        drag = null;
    };
    wrap.addEventListener('pointerup', endPointer);
    wrap.addEventListener('pointercancel', endPointer);
    stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        const sr = stage.getBoundingClientRect();
        setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - sr.left, e.clientY - sr.top);
    }, { passive: false });
    stage.addEventListener('dblclick', () => { zoom = 1; layout(); });

    // ---------- result ----------
    return new Promise<CropResult | null>((resolve) => {
        let settled = false;
        const finish = (result: CropResult | null): void => {
            if (settled) return;
            settled = true;
            document.removeEventListener('keydown', onKey, true);
            window.removeEventListener('resize', layout);
            overlay.remove();
            bitmap.close();
            opener?.focus?.();
            resolve(result);
        };
        const apply = (): void => {
            const btn = overlay.querySelector<HTMLButtonElement>('.crop-apply');
            if (btn?.disabled) return;
            const out = cropToJpeg(page, region);
            const keepPage = !!overlay.querySelector<HTMLInputElement>('#crop-keep-page')?.checked;
            const result: CropResult = {
                ...out,
                sizeBytes: dataUrlByteSize(out.dataUrl),
                region: { ...region },
                keepPage,
                rotated: turns !== 0,
            };
            if (keepPage) {
                result.pageDataUrl = cropToJpeg(page, { x: 0, y: 0, w: 1, h: 1 }, ATTACHMENT_MAX_SIDE, ATTACHMENT_QUALITY).dataUrl;
            }
            finish(result);
        };

        // Capture phase: Escape / Enter belong to the editor, never to the
        // dialogs underneath (the source editor would close with it).
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                e.preventDefault(); e.stopImmediatePropagation();
                finish(null);
                return;
            }
            if (e.key === 'Tab') {
                const focusables = [...overlay.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]')]
                    .filter(el => el.offsetParent !== null && !(el as HTMLButtonElement).disabled);
                if (focusables.length === 0) return;
                const i = focusables.indexOf(document.activeElement as HTMLElement);
                const next = e.shiftKey ? (i <= 0 ? focusables.length - 1 : i - 1) : (i + 1) % focusables.length;
                e.preventDefault(); e.stopImmediatePropagation();
                focusables[next].focus();
                return;
            }
            if (document.activeElement !== frame) {
                // Other keys reach the dialog's own buttons (Space/Enter on a
                // focused button) but never the page below.
                e.stopImmediatePropagation();
                return;
            }
            e.stopImmediatePropagation();
            if (e.key === 'Enter') { e.preventDefault(); apply(); return; }
            const step = e.shiftKey ? 0.1 : 0.01;
            const d: Record<string, [number, number]> = {
                ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
            };
            const delta = d[e.key];
            if (!delta) return;
            e.preventDefault();
            if (e.altKey) setRegion({ ...region, w: region.w + delta[0], h: region.h + delta[1] });
            else setRegion({ ...region, x: clamp(region.x + delta[0], 0, 1 - region.w), y: clamp(region.y + delta[1], 0, 1 - region.h) });
        };
        document.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', layout);

        overlay.querySelectorAll('.crop-cancel, .crop-close').forEach(b => b.addEventListener('click', () => finish(null)));
        overlay.querySelectorAll('.crop-apply').forEach(b => b.addEventListener('click', apply));
        overlay.querySelectorAll('.crop-rot-l').forEach(b => b.addEventListener('click', () => rotate(-1)));
        overlay.querySelectorAll('.crop-rot-r').forEach(b => b.addEventListener('click', () => rotate(1)));
        q('.crop-zoom-in').addEventListener('click', () => setZoom(zoom * 1.25));
        q('.crop-zoom-out').addEventListener('click', () => setZoom(zoom / 1.25));
        q('.crop-fit').addEventListener('click', () => { zoom = 1; layout(); });

        requestAnimationFrame(() => {
            layout();
            frame.focus();
        });
    });
}
