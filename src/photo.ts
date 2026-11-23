/**
 * Person photo handling: compress an uploaded image into a small square JPEG
 * data URL that can live inside the single-file export, the pure math of a
 * portrait cut from an original (spec 107: crop, quarter turns, straighten,
 * mirror — testable without a canvas), and helpers for stripping photos out
 * of exported data.
 */

import { StromData, PortraitCrop, PortraitSource, Person } from './types.js';
import { deleteMedia, personMediaById } from './media.js';
import { pendingImageOf } from './research-image-refs.js';
import { dataUrlTextByteSize, dataUrlTextImageSize } from './data-url-size.js';
import { isPoolRef, standInOf, POOL_REF } from './image-ref.js';
import { pooledImageByteSize, pooledImageSize } from './image-meta.js';

/** Target avatar size in device-independent pixels. */
export const PHOTO_SIZE = 256;
/** JPEG quality for the compressed portrait. */
export const PHOTO_QUALITY = 0.8;

export interface CropRect {
    sx: number;
    sy: number;
    size: number;
}

/**
 * Cover-crop rectangle: the largest centered square that fits the source image,
 * so the whole target square is covered without distortion. Pure math (no DOM),
 * so it is unit-testable without a canvas.
 */
export function computeCoverCrop(srcWidth: number, srcHeight: number): CropRect {
    const size = Math.min(srcWidth, srcHeight);
    return {
        sx: Math.round((srcWidth - size) / 2),
        sy: Math.round((srcHeight - size) / 2),
        size,
    };
}

/**
 * Compress a user-selected image file into a square JPEG data URL.
 * Uses createImageBitmap with EXIF orientation applied, then a 256x256
 * cover-crop on a canvas. Browser-only (needs canvas + createImageBitmap).
 */
export async function compressPhoto(file: File): Promise<string> {
    // Respect EXIF orientation so phone photos are upright.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
        const crop = computeCoverCrop(bitmap.width, bitmap.height);
        const canvas = document.createElement('canvas');
        canvas.width = PHOTO_SIZE;
        canvas.height = PHOTO_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        ctx.drawImage(bitmap, crop.sx, crop.sy, crop.size, crop.size, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
        return canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
    } finally {
        bitmap.close();
    }
}

/**
 * Rotate a square photo data URL by a multiple of 90°. The stored portrait is
 * already a square JPEG, so rotation keeps it square. `quarterTurns` is
 * clockwise (1 = 90° right, -1 = 90° left). Browser-only (canvas + Image).
 * Takes a pooled image's reference too (its bytes read from the pool); the
 * result is a new data URL either way.
 */
export function rotatePhotoDataUrl(dataUrl: string, quarterTurns: number): Promise<string> {
    const turns = ((quarterTurns % 4) + 4) % 4;
    if (turns === 0 || !isPoolRef(dataUrl)) return rotatePhotoAt(dataUrl, dataUrl, turns);
    // A pooled image: its bytes read from the pool, shown from an object URL of its own while drawn.
    return import('./image-src.js').then(async ({ imageBlob }) => {
        const blob = await imageBlob(dataUrl);
        if (!blob) throw new Error('Image load failed');
        const url = URL.createObjectURL(blob);
        try {
            return await rotatePhotoAt(dataUrl, url, turns);
        } finally {
            URL.revokeObjectURL(url);
        }
    });
}

/** rotatePhotoDataUrl with the image loaded from `src` (the value itself, or an object URL of a pooled one's bytes). */
function rotatePhotoAt(dataUrl: string, src: string, turns: number): Promise<string> {
    return new Promise((resolve, reject) => {
        if (turns === 0) { resolve(dataUrl); return; }
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = PHOTO_SIZE;
                canvas.height = PHOTO_SIZE;
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('Canvas 2D context unavailable');
                ctx.translate(PHOTO_SIZE / 2, PHOTO_SIZE / 2);
                ctx.rotate((turns * Math.PI) / 2);
                ctx.drawImage(img, -PHOTO_SIZE / 2, -PHOTO_SIZE / 2, PHOTO_SIZE, PHOTO_SIZE);
                resolve(canvas.toDataURL('image/jpeg', PHOTO_QUALITY));
            } catch (e) {
                reject(e instanceof Error ? e : new Error(String(e)));
            }
        };
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = src;
    });
}

/**
 * Approximate byte size of a data-URL string (base64 payload); for a pooled
 * image's reference, the same value from the image catalog (image-meta.ts).
 */
export function dataUrlByteSize(dataUrl: string): number {
    if (isPoolRef(dataUrl)) return pooledImageByteSize(dataUrl);
    const standIn = standInOf(dataUrl);
    return standIn ? pooledImageByteSize(POOL_REF + standIn.id) : dataUrlTextByteSize(dataUrl);
}

/** Total bytes of all photos in a tree: the persons' portraits and the couples' photos (spec 107). */
export function totalPhotoBytes(data: StromData): number {
    let total = 0;
    // One on its way (the app's view, spec 116 §5) weighs as the image it stands for.
    const size = (url: string): number => pendingImageOf(url)?.bytes ?? dataUrlByteSize(url);
    for (const person of Object.values(data.persons)) {
        if (person.photo) total += size(person.photo);
    }
    for (const union of Object.values(data.partnerships)) {
        if (union.photo) total += size(union.photo);
    }
    return total;
}

/**
 * Return a deep copy of `data` with every photo removed (for "export without
 * photos"): the portraits, the originals they were cut from (the attachment a
 * portrait's photoSource names is a photo of the person, also when
 * attachments are kept) and the couples' photos. Does not mutate the original.
 */
export function stripPhotos(data: StromData): StromData {
    const copy = structuredClone(data);
    const gone = new Set<string>();
    for (const person of Object.values(copy.persons)) {
        const fromAttachment = person.photoSource?.attachmentId;
        if (fromAttachment && personMediaById(copy, person.id, fromAttachment)) gone.add(fromAttachment);
        delete person.photo;
        delete person.photoOriginalName;
        delete person.photoDate;
        delete person.photoSource;
    }
    deleteMedia(copy, gone);
    for (const union of Object.values(copy.partnerships)) {
        delete union.photo;
        delete union.photoOriginalName;
        delete union.photoDate;
        delete union.photoOriginal;
    }
    // An excerpt cut from such an original keeps its image, not the link.
    for (const src of Object.values(copy.sources ?? {})) {
        for (const exc of src.excerpts ?? []) {
            if (exc.fromAttachmentId && gone.has(exc.fromAttachmentId)) {
                delete exc.fromAttachmentId;
                delete exc.region;
            }
        }
    }
    return copy;
}

/**
 * Drop, in place, every portrait source whose original is no longer in the
 * tree (the attachment of the person, or the union's photo, went: a filter, a
 * merge, a removal). The portrait itself stays. Returns how many went.
 */
export function dropDanglingPortraitSources(data: StromData): number {
    let dropped = 0;
    for (const person of Object.values(data.persons)) {
        if (person?.photoSource && !portraitSourceExists(data, person)) {
            delete person.photoSource;
            dropped++;
        }
    }
    return dropped;
}

/** Whether the original a person's portrait was cut from is still there (false without a photoSource). */
export function portraitSourceExists(data: StromData, person: Person): boolean {
    const src = person.photoSource;
    if (!src || !person.photo) return false;
    if (src.attachmentId) {
        const att = personMediaById(data, person.id, src.attachmentId);
        return !!att && !att.originalOnly;
    }
    if (src.partnershipId) {
        const union = data.partnerships[src.partnershipId];
        return !!union?.photo && (union.person1Id === person.id || union.person2Id === person.id);
    }
    return false;
}

// ── The portrait cut from an original (spec 107) ──
//
// The model: a fixed square frame over a movable photo. The original
// (`width` × `height`, upright as decoded) is first mirrored, then turned by
// quarter turns: that is the "page". The frame is a square on the page
// (PortraitCrop.region, fractions of the page); the page is then turned by
// `angle` about the frame's centre and the axis-aligned frame is cut and
// scaled to PHOTO_SIZE. Everything below is pure math on numbers (no canvas):
// the editor (src/ui/crop-editor.ts, portrait mode) keeps a PortraitView
// while the photo is moved and turns it into a PortraitCrop on Done.

/**
 * What a portrait shows where its frame reaches past the photo's edge: the
 * light theme's --avatar-bg (an empty portrait on the card). A fixed colour,
 * as JPEG has no alpha: the same in both themes, in print and in exports.
 */
export const PORTRAIT_EMPTY_FILL = '#f0e9da';
/** Highest zoom (800 %) of a portrait's frame over its cover scale. */
export const PORTRAIT_MAX_ZOOM = 8;
/** The frame never covers fewer original pixels than this (at most 2× the real resolution of PHOTO_SIZE). */
export const PORTRAIT_MIN_SOURCE_PX = 128;
/** Straightening limit in degrees, either way. */
export const PORTRAIT_MAX_ANGLE = 45;
/** Straightening step in degrees. */
export const PORTRAIT_ANGLE_STEP = 0.5;

/** A quarter-turn count 0–3. */
export type QuarterTurns = 0 | 1 | 2 | 3;

/**
 * The editor's working state of a portrait, in page pixels (the original
 * after the mirror and the quarter turns):
 * - `cx`, `cy`: the page point under the frame's centre;
 * - `zoom`: 1 = the frame covers the page's shorter side, 2 = half of it…;
 * - `quarterTurns`, `angle` (degrees, clockwise), `mirror` as PortraitCrop.
 */
export interface PortraitView {
    cx: number;
    cy: number;
    zoom: number;
    quarterTurns: QuarterTurns;
    angle: number;
    mirror: boolean;
}

/** The frame on the page in page pixels: its centre, its side, the angle, and the page's size. */
export interface PortraitRect {
    pageWidth: number;
    pageHeight: number;
    cx: number;
    cy: number;
    side: number;
    angle: number;
}

/** A 2D affine matrix as canvas `setTransform(a, b, c, d, e, f)` takes it: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type AffineMatrix = [number, number, number, number, number, number];

const toQuarterTurns = (n: number | undefined): QuarterTurns => ((((Math.round(n ?? 0)) % 4) + 4) % 4) as QuarterTurns;
const rad = (deg: number): number => (deg * Math.PI) / 180;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** The page's size: the original's, its sides swapped by an odd number of quarter turns. */
export function portraitPageSize(width: number, height: number, quarterTurns?: number): { width: number; height: number } {
    return toQuarterTurns(quarterTurns) % 2 ? { width: height, height: width } : { width, height };
}

/**
 * The smallest zoom at which the frame, turned by `angle` degrees, still lies
 * inside the page (no empty corner): |cos| + |sin| — 1 at 0°, √2 at ±45°.
 * The same for any aspect ratio: the turned frame's bounding box is a square.
 */
export function minZoomForAngle(angle: number): number {
    const a = rad(angle);
    return Math.abs(Math.cos(a)) + Math.abs(Math.sin(a));
}

/**
 * The highest zoom for an original of `width` × `height` (either order of the
 * sides): min(800 %, shorter side / 128 px), never below 100 %. A small photo
 * (shorter side < 256 px) thus stops at 2× its real resolution.
 */
export function maxPortraitZoom(width: number, height: number): number {
    return Math.max(1, Math.min(PORTRAIT_MAX_ZOOM, Math.min(width, height) / PORTRAIT_MIN_SOURCE_PX));
}

/** The zoom range at `angle` for an original of `width` × `height`: [min, max], min winning over a lower max. */
export function portraitZoomRange(width: number, height: number, angle: number): { min: number; max: number } {
    const min = Math.max(1, minZoomForAngle(angle));
    return { min, max: Math.max(min, maxPortraitZoom(width, height)) };
}

/**
 * The opening crop of an original: the largest centred square, upright
 * (computeCoverCrop in fractions) — what compressPhoto has always cut.
 */
export function defaultPortraitCrop(width: number, height: number): PortraitCrop {
    const c = computeCoverCrop(width, height);
    return { region: { x: c.sx / width, y: c.sy / height, w: c.size / width, h: c.size / height } };
}

/** Whether a crop is the opening one (defaultPortraitCrop, no turn, no straightening, no mirror), within a hair. */
export function isDefaultPortraitCrop(crop: PortraitCrop, width: number, height: number): boolean {
    if (toQuarterTurns(crop.quarterTurns) || (crop.angle ?? 0) !== 0 || crop.mirror) return false;
    const d = defaultPortraitCrop(width, height).region;
    const r = crop.region;
    const eps = 1e-4;
    return Math.abs(r.x - d.x) < eps && Math.abs(r.y - d.y) < eps && Math.abs(r.w - d.w) < eps && Math.abs(r.h - d.h) < eps;
}

/** The frame of a crop on the page, in page pixels. */
export function portraitRect(crop: PortraitCrop, width: number, height: number): PortraitRect {
    const page = portraitPageSize(width, height, crop.quarterTurns);
    const { x, y, w, h } = crop.region;
    return {
        pageWidth: page.width, pageHeight: page.height,
        cx: (x + w / 2) * page.width, cy: (y + h / 2) * page.height,
        // Square in pixels by definition; the mean evens out rounding.
        side: (w * page.width + h * page.height) / 2,
        angle: crop.angle ?? 0,
    };
}

/** How many original pixels the frame's side covers (under PHOTO_SIZE the portrait may be blurry). */
export function portraitSourcePixels(crop: PortraitCrop, width: number, height: number): number {
    return portraitRect(crop, width, height).side;
}

/**
 * Whether a region is a square in pixels of the page (`width` × `height` the
 * original, turned by `quarterTurns`), within `tolerance` (1 %) of the longer side.
 */
export function isPortraitRegionSquare(region: PortraitCrop['region'], width: number, height: number, quarterTurns?: number, tolerance = 0.01): boolean {
    const page = portraitPageSize(width, height, quarterTurns);
    const a = region.w * page.width;
    const b = region.h * page.height;
    return Math.abs(a - b) <= tolerance * Math.max(a, b);
}

/** The working view of a crop (the editor opens on it). */
export function portraitViewFromCrop(crop: PortraitCrop, width: number, height: number): PortraitView {
    const r = portraitRect(crop, width, height);
    return {
        cx: r.cx, cy: r.cy,
        zoom: r.side > 0 ? Math.min(r.pageWidth, r.pageHeight) / r.side : 1,
        quarterTurns: toQuarterTurns(crop.quarterTurns),
        angle: r.angle,
        mirror: crop.mirror === true,
    };
}

/**
 * A view brought inside its limits: quarter turns 0–3, the angle within ±45°
 * in steps of 0.5, the zoom within portraitZoomRange, and the frame's centre
 * on the page (0…width, 0…height). The frame itself may reach past the
 * page's edge (a face close to the photo's edge can still be centred); what
 * it covers off the page is PORTRAIT_EMPTY_FILL in the portrait.
 */
export function clampPortraitView(view: PortraitView, width: number, height: number): PortraitView {
    const quarterTurns = toQuarterTurns(view.quarterTurns);
    const raw = Number.isFinite(view.angle) ? view.angle : 0;
    const angle = Math.round(Math.max(-PORTRAIT_MAX_ANGLE, Math.min(PORTRAIT_MAX_ANGLE, raw)) / PORTRAIT_ANGLE_STEP) * PORTRAIT_ANGLE_STEP || 0;
    const page = portraitPageSize(width, height, quarterTurns);
    const range = portraitZoomRange(width, height, angle);
    const zoom = Math.max(range.min, Math.min(range.max, Number.isFinite(view.zoom) ? view.zoom : 1));
    const fit = (v: number, size: number): number => Math.max(0, Math.min(size, Number.isFinite(v) ? v : size / 2));
    return { cx: fit(view.cx, page.width), cy: fit(view.cy, page.height), zoom, quarterTurns, angle, mirror: view.mirror === true };
}

/** The crop a view stands for (clamped first; fractions rounded to 6 places, defaults left out). */
export function portraitCropFromView(view: PortraitView, width: number, height: number): PortraitCrop {
    const v = clampPortraitView(view, width, height);
    const page = portraitPageSize(width, height, v.quarterTurns);
    const side = Math.min(page.width, page.height) / v.zoom;
    const crop: PortraitCrop = {
        region: {
            x: round6((v.cx - side / 2) / page.width), y: round6((v.cy - side / 2) / page.height),
            w: round6(side / page.width), h: round6(side / page.height),
        },
    };
    if (v.quarterTurns) crop.quarterTurns = v.quarterTurns;
    if (v.angle) crop.angle = v.angle;
    if (v.mirror) crop.mirror = true;
    return crop;
}

/** A crop brought inside its limits (see clampPortraitView). Keeps a PortraitSource's attachmentId / partnershipId. */
export function clampPortraitCrop<T extends PortraitCrop>(crop: T, width: number, height: number): T {
    const { region: _r, quarterTurns: _q, angle: _a, mirror: _m, ...rest } = crop;
    return { ...rest, ...portraitCropFromView(portraitViewFromCrop(crop, width, height), width, height) } as T;
}

/** The opening view of an original (defaultPortraitCrop). */
export function defaultPortraitView(width: number, height: number): PortraitView {
    return portraitViewFromCrop(defaultPortraitCrop(width, height), width, height);
}

/** Frame (screen) pixels per page pixel for a frame of `framePx` on screen. */
export function portraitScale(view: PortraitView, width: number, height: number, framePx: number): number {
    const page = portraitPageSize(width, height, view.quarterTurns);
    return (framePx * view.zoom) / Math.min(page.width, page.height);
}

/** A screen offset turned back onto the page (by −angle) and scaled from screen to page pixels. */
function screenToPage(view: PortraitView, dx: number, dy: number, scale: number): { x: number; y: number } {
    const a = rad(view.angle);
    const cos = Math.cos(a), sin = Math.sin(a);
    return { x: (cos * dx + sin * dy) / scale, y: (-sin * dx + cos * dy) / scale };
}

/**
 * The photo dragged by (dx, dy) screen pixels under a frame of `framePx`: it
 * follows the pointer (the page point under the frame's centre moves the
 * other way), clamped.
 */
export function panPortraitView(view: PortraitView, dx: number, dy: number, framePx: number, width: number, height: number): PortraitView {
    const d = screenToPage(view, dx, dy, portraitScale(view, width, height, framePx));
    return clampPortraitView({ ...view, cx: view.cx - d.x, cy: view.cy - d.y }, width, height);
}

/**
 * The view at another zoom, clamped. With `anchor` (a screen point as the
 * offset from the frame's centre, under a frame of `framePx`) the page point
 * under it stays under it — the wheel and two fingers zoom about the pointer;
 * without, about the frame's centre.
 */
export function zoomPortraitView(view: PortraitView, zoom: number, width: number, height: number,
    anchor?: { x: number; y: number; framePx: number }): PortraitView {
    const range = portraitZoomRange(width, height, view.angle);
    const next = Math.max(range.min, Math.min(range.max, zoom));
    if (!anchor) return clampPortraitView({ ...view, zoom: next }, width, height);
    const before = screenToPage(view, anchor.x, anchor.y, portraitScale(view, width, height, anchor.framePx));
    const after = screenToPage({ ...view, zoom: next }, anchor.x, anchor.y, portraitScale({ ...view, zoom: next }, width, height, anchor.framePx));
    return clampPortraitView({ ...view, zoom: next, cx: view.cx + before.x - after.x, cy: view.cy + before.y - after.y }, width, height);
}

/**
 * The view straightened to `angle` degrees: the zoom rises to
 * minZoomForAngle when it must (never drops), clamped.
 */
export function straightenPortraitView(view: PortraitView, angle: number, width: number, height: number): PortraitView {
    return clampPortraitView({ ...view, angle, zoom: Math.max(view.zoom, minZoomForAngle(angle)) }, width, height);
}

/**
 * The view turned by a quarter turn (`1` clockwise, `-1` back): the page
 * point under the frame's centre stays under it,
 * the zoom goes back to the smallest that covers the frame.
 */
export function turnPortraitView(view: PortraitView, delta: 1 | -1, width: number, height: number): PortraitView {
    const page = portraitPageSize(width, height, view.quarterTurns);
    // Clockwise: (x, y) on a page of w × h → (h − y, x); back: (y, w − x).
    const [cx, cy] = delta === 1 ? [page.height - view.cy, view.cx] : [view.cy, page.width - view.cx];
    return clampPortraitView({
        ...view, cx, cy, quarterTurns: toQuarterTurns(view.quarterTurns + delta), zoom: minZoomForAngle(view.angle),
    }, width, height);
}

/**
 * The view mirrored: the portrait comes out as the mirror image of what it
 * was (left and right swapped), the same crop. Mirroring comes before the
 * turns, so with an odd number of them it takes two more turns to swap left
 * and right rather than top and bottom; the angle changes sign.
 */
export function mirrorPortraitView(view: PortraitView, width: number, height: number): PortraitView {
    const page = portraitPageSize(width, height, view.quarterTurns);
    const quarterTurns = toQuarterTurns(view.quarterTurns + (view.quarterTurns % 2 ? 2 : 0));
    return clampPortraitView({
        ...view, cx: page.width - view.cx, quarterTurns, angle: -view.angle || 0, mirror: !view.mirror,
    }, width, height);
}

/** a ∘ b: first b, then a. */
function compose(a: AffineMatrix, b: AffineMatrix): AffineMatrix {
    return [
        a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
    ];
}

/** The original's pixels onto the page: the mirror, then the quarter turns. */
export function portraitPageMatrix(width: number, height: number, quarterTurns: number, mirror: boolean): AffineMatrix {
    let m: AffineMatrix = mirror ? [-1, 0, 0, 1, width, 0] : [1, 0, 0, 1, 0, 0];
    let h = height, w = width;
    for (let i = 0; i < toQuarterTurns(quarterTurns); i++) {
        // Clockwise on a w × h page: (x, y) → (h − y, x).
        m = compose([0, 1, -1, 0, h, 0], m);
        [w, h] = [h, w];
    }
    return m;
}

/**
 * The original's pixels onto a square of `outSize` × `outSize` holding the
 * frame of `view` (the portrait itself at PHOTO_SIZE, the editor's frame at
 * its size on screen): `ctx.setTransform(...m); ctx.drawImage(original, 0, 0)`
 * draws it. The page is turned by `angle` about the frame's centre.
 */
export function portraitViewMatrix(view: PortraitView, width: number, height: number, outSize: number): AffineMatrix {
    const s = portraitScale(view, width, height, outSize);
    const a = rad(view.angle);
    const cos = Math.cos(a) * s, sin = Math.sin(a) * s;
    // out = s·R(angle)·(p − c) + outSize / 2
    const toOut: AffineMatrix = [cos, sin, -sin, cos,
        outSize / 2 - (cos * view.cx - sin * view.cy), outSize / 2 - (sin * view.cx + cos * view.cy)];
    return compose(toOut, portraitPageMatrix(width, height, view.quarterTurns, view.mirror));
}

/** portraitViewMatrix of a stored crop (e.g. the portrait at PHOTO_SIZE on Done). */
export function portraitOutputMatrix(crop: PortraitCrop, width: number, height: number, outSize: number = PHOTO_SIZE): AffineMatrix {
    return portraitViewMatrix(portraitViewFromCrop(crop, width, height), width, height, outSize);
}

/** Apply an affine matrix to a point. */
export function applyMatrix(m: AffineMatrix, x: number, y: number): { x: number; y: number } {
    return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** The inverse of an affine matrix (null when it has none). */
export function invertMatrix(m: AffineMatrix): AffineMatrix | null {
    const det = m[0] * m[3] - m[1] * m[2];
    if (!det) return null;
    const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
    return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/**
 * Whether a value is a portrait's region (fractions of the page): finite,
 * its sides above 0 and at most the page's (zoom ≥ 100 %), its centre on the
 * page. The frame itself may reach past the page's edge (clampPortraitView).
 */
export function isPortraitRegionShape(v: unknown): v is PortraitCrop['region'] {
    if (!v || typeof v !== 'object') return false;
    const { x, y, w, h } = v as Record<string, unknown>;
    if (![x, y, w, h].every(n => typeof n === 'number' && Number.isFinite(n))) return false;
    const [nx, ny, nw, nh] = [x, y, w, h] as number[];
    const eps = 1e-6;
    if (!(nw > 0 && nh > 0 && nw <= 1.0001 && nh <= 1.0001)) return false;
    const mx = nx + nw / 2, my = ny + nh / 2;
    return mx >= -eps && mx <= 1 + eps && my >= -eps && my <= 1 + eps;
}

/** Whether a value is a well-formed PortraitSource (exactly one origin, a region with its centre on the page, a sane angle); no lookup. */
export function isPortraitSourceShape(v: unknown): v is PortraitSource {
    if (!v || typeof v !== 'object') return false;
    const s = v as Record<string, unknown>;
    const hasAtt = typeof s.attachmentId === 'string' && s.attachmentId !== '';
    const hasUnion = typeof s.partnershipId === 'string' && s.partnershipId !== '';
    if (hasAtt === hasUnion) return false;
    if ('attachmentId' in s && !hasAtt) return false;
    if ('partnershipId' in s && !hasUnion) return false;
    if (!isPortraitRegionShape(s.region)) return false;
    if (s.quarterTurns !== undefined && s.quarterTurns !== 1 && s.quarterTurns !== 2 && s.quarterTurns !== 3) return false;
    if (s.angle !== undefined && !(typeof s.angle === 'number' && Number.isFinite(s.angle) && Math.abs(s.angle) <= PORTRAIT_MAX_ANGLE)) return false;
    if (s.mirror !== undefined && s.mirror !== true) return false;
    return true;
}

/**
 * An image's pixel size from its data URL's header (PNG, GIF, JPEG, WebP),
 * else null; for a pooled image's reference, the same value from the image
 * catalog (image-meta.ts).
 */
export function dataUrlImageSize(url: string): { w: number; h: number } | null {
    if (isPoolRef(url)) return pooledImageSize(url);
    // A pooled image's stand-in (image-ref.ts poolStandIn) is as large as its image.
    const standIn = standInOf(url);
    return standIn ? pooledImageSize(POOL_REF + standIn.id) : dataUrlTextImageSize(url);
}

