/**
 * A GEDCOM of a tree holding pooled image references (spec 135, part D10b):
 * the tree is not expanded. exportToGedcom writes each pooled image's FILE as
 * a slot line (FILE_SLOT); here each slot gets its image's lines, read from
 * the pool a few images at a time, exactly as the export writes a data URL
 * (`gedcomFileLines`). The text comes back in parts (a file is a Blob of
 * them), byte for byte the GEDCOM of the tree with its images expanded.
 *
 * Every FORM and portrait check of the export reads the catalog (image-meta.ts),
 * so its entries are made first. An image the catalog or the pool cannot give
 * (not in the pool, encrypted while the session is locked) makes it fall back
 * to the export of the expanded tree, which writes such an image as empty text.
 */

import { exportToGedcom, FILE_SLOT, gedcomFileLines, type GedcomExportOptions, type GedcomExportResult } from './ged-exporter.js';
import { expandedData, poolRefIds, poolRefSnapshot } from './image-expand.js';
import { imageMetaOf } from './image-meta.js';
import { ensureImageMeta, loadImageUrls } from './media-pool.js';
import { poolIdOf } from './image-ref.js';
import type { StromData } from './types.js';

/** exportToGedcom's result with its text in parts: `parts.join('')` is the content. */
export interface GedcomWithImages extends Omit<GedcomExportResult, 'content'> {
    parts: string[];
}

/** Slots filled per read of the pool: an output holds only these images at a time besides the text written. */
const IMAGES_PER_READ = 8;

interface Slot { start: number; end: number; level: number; id: string }

function slotsOf(content: string): Slot[] | null {
    const out: Slot[] = [];
    for (let at = content.indexOf(FILE_SLOT); at >= 0; at = content.indexOf(FILE_SLOT, at + 1)) {
        const nl = content.indexOf('\n', at);
        const end = nl < 0 ? content.length : nl;
        const line = content.slice(at + FILE_SLOT.length, end);
        const space = line.indexOf(' ');
        const level = Number(line.slice(0, space));
        const id = poolIdOf(line.slice(space + 1));
        if (space < 1 || !Number.isInteger(level) || !id) return null;
        out.push({ start: at, end, level, id });
    }
    return out;
}

/** The parts with every slot filled, or null when an image is not readable now. */
async function filled(content: string): Promise<string[] | null> {
    const slots = slotsOf(content);
    if (!slots) return null;
    const parts: string[] = [];
    let from = 0;
    for (let i = 0; i < slots.length; i += IMAGES_PER_READ) {
        const group = slots.slice(i, i + IMAGES_PER_READ);
        const urls = await loadImageUrls([...new Set(group.map(s => s.id))]);
        for (const s of group) {
            const url = urls.get(s.id);
            if (!url) return null;
            parts.push(content.slice(from, s.start), gedcomFileLines(s.level, url));
            from = s.end;
        }
    }
    parts.push(content.slice(from));
    return parts;
}

function withParts(r: GedcomExportResult, parts: string[] = [r.content]): GedcomWithImages {
    return { stats: r.stats, xrefs: r.xrefs, media: r.media, parts };
}

/**
 * exportToGedcom of `data` (with or without pooled image references), its
 * images read as the text is written. Taken at the call: a change of the
 * data while the images are read does not reach it. `options.mediaRef`
 * gets a pooled image as its reference (prepareMediaRef knows both forms).
 */
export async function exportGedcomWithImages(data: StromData, treeName?: string, options: GedcomExportOptions = {}): Promise<GedcomWithImages> {
    const tree = poolRefSnapshot(data);
    const ids = poolRefIds(tree);
    if (ids.size === 0) return withParts(exportToGedcom(tree, treeName, options));
    await ensureImageMeta(ids);
    if ([...ids].every(id => imageMetaOf(id))) {
        const r = exportToGedcom(tree, treeName, options);
        const parts = await filled(r.content);
        if (parts) return withParts(r, parts);
    }
    return withParts(exportToGedcom(await expandedData(tree), treeName, options));
}

/** The GEDCOM's text (a send, a kept copy). */
export function gedcomText(g: GedcomWithImages): string {
    return g.parts.length === 1 ? g.parts[0] : g.parts.join('');
}
