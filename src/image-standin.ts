/**
 * Outputs of a large tree without its images in the page's memory (the gift
 * package, 1127): the builders of the family pages, the book, the fan and
 * the cover page take an image only as a data URL, and a tree whose photos
 * weigh gigabytes cannot be held expanded (expandImages) — the window runs
 * out of memory. They are built instead from a copy of the tree in which
 * each pooled image's reference is a stand-in data URL naming its image
 * (image-ref.ts poolStandIn: of the image's type and size, as the family
 * pages' window does it), and each text they write goes into a file as a
 * Blob of its pieces with each image put in its place, read from the pool a
 * few images at a time — the page holds the text and those few images,
 * never the tree's images whole.
 *
 * Byte for byte the output of the expanded tree: an image the pool does not
 * have (or cannot read now) is empty text in the copy, as expandImages makes
 * it; an image the pool keeps as text (an SVG data URL, not base64) is put
 * in whole, as it is small and a stand-in cannot stand for it.
 */

import { STAND_IN_IN_TEXT, poolStandIn, standInOf } from './image-ref.js';
import { poolRefIds, withPoolRefsReplaced } from './image-expand.js';
import { headMime, imageMetaOf } from './image-meta.js';
import { ensureImageMeta, loadImageUrls, pooledIds } from './media-pool.js';
import { withExifOrientation } from './excerpts.js';
import { dataUrlBytes } from './zip.js';
import type { StromData } from './types.js';

/** Images read per read of the pool while a text is written: the page holds only these besides the text. */
export const STAND_IN_IMAGES_PER_READ = 8;

/** A stand-in for every pooled image (`data` itself without any); see the module's comment. */
export async function treeWithPoolStandIns(data: StromData): Promise<StromData> {
    const ids = poolRefIds(data);
    if (ids.size === 0) return data;
    await ensureImageMeta(ids);
    const have = await pooledIds(ids);
    // Images kept as text (no stand-in can stand for them): read whole, they are small.
    const textual = new Set([...have].filter(id => {
        const head = imageMetaOf(id)?.head;
        return !head || !/;base64,$/i.test(head);
    }));
    const whole = textual.size ? await loadImageUrls([...textual]) : new Map<string, string>();
    return withPoolRefsReplaced(data, (id, holder) => {
        if (!have.has(id)) return '';
        if (textual.has(id)) return whole.get(id) ?? '';
        const own = Array.isArray(holder) ? {} : holder;
        const mime = headMime(imageMetaOf(id)!.head) || (typeof own.mimeType === 'string' && own.mimeType ? own.mimeType : 'image/jpeg');
        // An excerpt is shown by its orientation (excerpts.ts excerptImageUrl): the stand-in carries it.
        const orient = typeof own.orient === 'number' ? own.orient : 0;
        return poolStandIn(id, mime, orient) || '';
    });
}

/** A stand-in's image as it is shown (turned by its orientation); '' when the pool does not give it. */
function shown(url: string | undefined, orient: string | undefined): string {
    if (!url) return '';
    return orient ? withExifOrientation(url, Number(orient)) : url;
}

/**
 * A text with stand-ins as a Blob of `type` with every image in its place
 * (fillStandIns' text), read STAND_IN_IMAGES_PER_READ images at a time.
 */
export async function textBlobWithImages(text: string, type = ''): Promise<Blob> {
    const opts = type ? { type } : undefined;
    if (!text.includes('STROMPOOL')) return new Blob([text], opts);
    const matches = [...text.matchAll(STAND_IN_IN_TEXT)];
    if (matches.length === 0) return new Blob([text], opts);
    const parts: Blob[] = [];
    let from = 0;
    for (let i = 0; i < matches.length;) {
        // The next few distinct images, and every stand-in up to the last of them.
        const group = new Set<string>();
        let j = i;
        while (j < matches.length) {
            const id = `${matches[j][1]}:${matches[j][2]}`;
            if (!group.has(id) && group.size >= STAND_IN_IMAGES_PER_READ) break;
            group.add(id);
            j++;
        }
        const urls = await loadImageUrls([...group]);
        const out: string[] = [];
        for (let k = i; k < j; k++) {
            const m = matches[k];
            out.push(text.slice(from, m.index), shown(urls.get(`${m[1]}:${m[2]}`), m[3]));
            from = m.index! + m[0].length;
        }
        // Into a Blob at once: the images of this read leave the page's memory.
        parts.push(new Blob(out));
        i = j;
    }
    parts.push(new Blob([text.slice(from)]));
    return new Blob(parts, opts);
}

/** A stand-in's image as it is shown, read from the pool ('' when it does not give it); any other text as it is. */
export async function standInImage(src: string): Promise<string> {
    const s = standInOf(src);
    if (!s) return src;
    const url = (await loadImageUrls([s.id])).get(s.id);
    return url ? (s.orient ? withExifOrientation(url, s.orient) : url) : '';
}

/**
 * An image's bytes for a file of its own (the family pages' images folder):
 * a stand-in's read from the pool (turned by its orientation), any other
 * data URL decoded as it is; null when there are none.
 */
export async function imageFileBytes(src: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
    const s = standInOf(src);
    if (!s) return dataUrlBytes(src);
    const urls = await loadImageUrls([s.id]);
    const url = urls.get(s.id);
    if (!url) return null;
    return dataUrlBytes(s.orient ? withExifOrientation(url, s.orient) : url);
}
