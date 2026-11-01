/**
 * One registry of the images of a saved file (spec 026 §0.4): every image is
 * embedded once, as `.img-N { background-image: url(…) }` in one <style>, and
 * each place that shows it refers to its class. The same record excerpt on a
 * person's page, a family's page and a lineage's page is in the file once.
 *
 * Pure and synchronous (vitest, the app's worker-free build). An image is
 * known by its whole content (the data URL without white space) — the exact
 * key a content hash stands for, without the chance of two images sharing one.
 * Reducing an image (canvas, asynchronous) is the caller's: `replace` hands
 * the registry the smaller copy a step before made.
 */

/** Record excerpts ("clips") or photographs and portraits ("photos"). */
export type RegistryImageKind = 'clip' | 'photo';

/** What a file carries of a kind of image (§6.2): as it is, reduced, or nothing. */
export type ImageChoice = 'full' | 'small' | 'none';

/** Reduced images (§0.4): photos to 1600 px, excerpts to 1200 px on the longer side, JPEG 0.82. */
export const SHRINK_PHOTO_PX = 1600;
export const SHRINK_CLIP_PX = 1200;
export const SHRINK_QUALITY = 0.82;

export interface ImageRegistryOptions {
    clips?: ImageChoice;
    photos?: ImageChoice;
    /** The reduced copy of an image ('small'), or null to keep it as it is. */
    replace?: (dataUrl: string, kind: RegistryImageKind) => string | null;
    /** The image's width and height (for its aspect ratio in the CSS), when known. */
    size?: (dataUrl: string) => { w: number; h: number } | null;
}

interface Entry { n: number; src: string; kind: RegistryImageKind; ratio: string | null }

const SAFE_IMAGE = /^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+$/;

export class ImageRegistry {
    private readonly byKey = new Map<string, Entry>();
    private readonly list: Entry[] = [];

    constructor(private readonly opts: ImageRegistryOptions = {}) {}

    /** What the file carries of a kind of image. */
    choice(kind: RegistryImageKind): ImageChoice {
        return (kind === 'clip' ? this.opts.clips : this.opts.photos) ?? 'full';
    }

    /**
     * The class of an image ('img-7'), registered on first use; null when the
     * file carries no images of its kind or the data URL is not a safe image.
     */
    add(dataUrl: string, kind: RegistryImageKind): string | null {
        const e = this.entry(dataUrl, kind);
        return e ? `img-${e.n}` : null;
    }

    /** The number of an image's class (7 for 'img-7'), registered on first use; null as `add`. */
    number(dataUrl: string, kind: RegistryImageKind): number | null {
        return this.entry(dataUrl, kind)?.n ?? null;
    }

    private entry(dataUrl: string, kind: RegistryImageKind): Entry | null {
        const choice = this.choice(kind);
        if (choice === 'none') return null;
        const key = dataUrl.replace(/\s+/g, '');
        if (!SAFE_IMAGE.test(key)) return null;
        let e = this.byKey.get(key);
        if (!e) {
            const small = choice === 'small' ? this.opts.replace?.(key, kind)?.replace(/\s+/g, '') : null;
            const src = small && SAFE_IMAGE.test(small) ? small : key;
            const size = this.opts.size?.(src) ?? null;
            e = { n: this.list.length + 1, src, kind, ratio: size && size.w > 0 && size.h > 0 ? `${size.w} / ${size.h}` : null };
            this.byKey.set(key, e);
            this.list.push(e);
        }
        return e;
    }

    /** Images registered. */
    get count(): number {
        return this.list.length;
    }

    /** Characters of the embedded data URLs (≈ bytes: base64 is ASCII). */
    get length(): number {
        let n = 0;
        for (const e of this.list) n += e.src.length;
        return n;
    }

    /** The registered images in order (number, the embedded data URL, the kind). */
    entries(): readonly { n: number; src: string; kind: RegistryImageKind }[] {
        return this.list.map(e => ({ n: e.n, src: e.src, kind: e.kind }));
    }

    /**
     * The rules of one <style>: `.img-N{background-image:url("…");--pp-ar:w / h}` (as the person page writes them);
     * `url(n)` puts another address in place of the data URL (a set of files: `obrazky/img-N.jpg`).
     */
    css(url?: (n: number) => string): string {
        return this.list.map(e => `.img-${e.n}{background-image:url("${url ? url(e.n) : e.src}")${e.ratio ? `;--pp-ar:${e.ratio}` : ''}}`).join('\n');
    }
}
