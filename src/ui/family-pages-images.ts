/**
 * The family pages in the app's window and the tree's pooled images
 * (spec 135). The pages' builders (family-pages-html.ts, person-page.ts) take
 * an image only as a data URL, and the tree in memory holds its stored images
 * as pool references. The window's set is therefore built from a copy of the
 * tree in which each reference is a stand-in data URL naming its image
 * (image-ref.ts poolStandIn: of the image's type and size, so a page lays
 * out as with the image itself); a page drawn in the window gets the images
 * it shows put in, read from the pool once (a batch) and kept while that
 * page is shown — never the whole tree's images.
 */

import { STAND_IN_IN_TEXT, poolStandIn } from '../image-ref.js';
import { withPoolRefsReplaced } from '../image-expand.js';
import { headMime, imageMetaOf } from '../image-meta.js';
import { loadImageUrls } from '../media-pool.js';
import { withExifOrientation } from '../excerpts.js';
import type { StromData } from '../types.js';

/** The tree with a stand-in in place of every pooled image's reference (`data` itself without any). */
export function treeWithStandIns(data: StromData): StromData {
    return withPoolRefsReplaced(data, (id, holder) => {
        const own = Array.isArray(holder) ? {} : holder;
        const meta = imageMetaOf(id);
        const mime = meta ? headMime(meta.head) : typeof own.mimeType === 'string' && own.mimeType ? own.mimeType : 'image/jpeg';
        // An excerpt is shown by its orientation (excerpts.ts excerptImageUrl): the stand-in carries it.
        const orient = typeof own.orient === 'number' ? own.orient : 0;
        return poolStandIn(id, mime, orient);
    });
}

/** The pooled images the stand-ins of a built text name. */
export function standInIds(text: string): string[] {
    if (!text.includes('STROMPOOL')) return [];
    const ids = new Set<string>();
    for (const m of text.matchAll(STAND_IN_IN_TEXT)) ids.add(`${m[1]}:${m[2]}`);
    return [...ids];
}

/** The text with each stand-in replaced by its image (turned by its orientation); one not had becomes ''. */
export function fillStandIns(text: string, urls: ReadonlyMap<string, string>): string {
    if (!text.includes('STROMPOOL')) return text;
    return text.replace(STAND_IN_IN_TEXT, (_m, kind: string, hex: string, orient?: string) => {
        const url = urls.get(`${kind}:${hex}`) ?? '';
        return url && orient ? withExifOrientation(url, Number(orient)) : url;
    });
}

/** The images of the page shown (content id → data URL, '' when the pool does not have it or cannot read it now). */
const pageImages = new Map<string, string>();

/**
 * A page's built text with its images put in. Null while some are still to
 * be read: they are read (one batch) and `redraw` is called once they are in
 * — the caller draws the page again (if it is still the one shown). Only the
 * images of the page last drawn are kept.
 */
export function withFamilyPageImages(text: string, redraw: () => void): string | null {
    const ids = standInIds(text);
    if (ids.length === 0) return text;
    const missing = ids.filter(id => !pageImages.has(id));
    if (missing.length > 0) {
        const done = (urls: ReadonlyMap<string, string>): void => {
            for (const id of missing) pageImages.set(id, urls.get(id) ?? '');
            redraw();
        };
        loadImageUrls(missing).then(done, () => done(new Map()));
        return null;
    }
    const shown = new Set(ids);
    for (const id of [...pageImages.keys()]) if (!shown.has(id)) pageImages.delete(id);
    return fillStandIns(text, pageImages);
}

/** Let the page's images go (the window closed). */
export function forgetFamilyPageImages(): void {
    pageImages.clear();
}

/** How many images are kept (tests). */
export function familyPageImageCount(): number {
    return pageImages.size;
}
