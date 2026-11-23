/**
 * The person page in the app and the tree's pooled images (spec 135).
 *
 * The page's builder (person-page.ts) takes an image only as a data URL, and
 * the tree in memory holds its stored images as pool references. The page is
 * therefore built from a tree in which the images it can show are whole:
 * the person's own — the portrait, the couples' photos, the person's files,
 * the excerpts of the sources the person cites or is cited in — read from the
 * pool once (a batch), kept while the page shows that person, never the
 * whole tree's images. Everything else stays as it is (shared, not copied).
 */

import { personMedia } from '../media.js';
import { personSourceRows } from '../person-sources.js';
import { poolIdOf } from '../image-ref.js';
import { loadImageUrls } from '../media-pool.js';
import type { StromData, PersonId, Person, Partnership, Attachment, Source } from '../types.js';

/** Content id → the image's data URL ('' when the pool does not have it, or cannot read it now). */
const images = new Map<string, string>();
/** Reads under way, by content id. */
const reading = new Map<string, Promise<void>>();

interface PageParts {
    person: Person | undefined;
    partnerships: Partnership[];
    media: Attachment[];
    sources: Source[];
}

/** Every string anywhere in `value` (plain objects and arrays). */
function eachString(value: unknown, fn: (s: string) => void, depth = 0): void {
    if (typeof value === 'string') { fn(value); return; }
    if (!value || typeof value !== 'object' || depth > 32) return;
    for (const v of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) eachString(v, fn, depth + 1);
}

/** The records of the tree that hold the images the person's page can show. */
function pageParts(data: StromData, personId: PersonId): PageParts {
    const person = data.persons[personId];
    if (!person) return { person, partnerships: [], media: [], sources: [] };
    const partnerships = (person.partnerships ?? []).map(id => data.partnerships[id]).filter((u): u is Partnership => !!u);
    const catalog = data.sources ?? {};
    const sourceIds = new Set<string>();
    for (const row of personSourceRows(data, personId, undefined, { stories: true })) sourceIds.add(row.source.id);
    // A source the person's or a couple's records name (a citation anywhere in them).
    const named = (s: string): void => { if (Object.prototype.hasOwnProperty.call(catalog, s)) sourceIds.add(s); };
    eachString(person, named);
    for (const u of partnerships) eachString(u, named);
    const sources = [...sourceIds].map(id => catalog[id]).filter((s): s is Source => !!s);
    return { person, partnerships, media: personMedia(data, personId), sources };
}

/** The content ids of the pooled images in `parts` (a source: its excerpts only). */
function partIds(parts: PageParts): Set<string> {
    const ids = new Set<string>();
    const add = (s: string): void => { const id = s.length === 46 ? poolIdOf(s) : null; if (id) ids.add(id); };
    eachString(parts.person, add);
    for (const u of parts.partnerships) eachString(u, add);
    for (const a of parts.media) eachString(a, add);
    for (const s of parts.sources) eachString(s.excerpts, add);
    return ids;
}

/**
 * The person's page images not read yet (their read is then due); the ones
 * kept for another person are let go.
 */
export function pageImagesToRead(data: StromData, personId: PersonId): string[] {
    const ids = partIds(pageParts(data, personId));
    for (const id of [...images.keys()]) if (!ids.has(id)) images.delete(id);
    return [...ids].filter(id => !images.has(id));
}

/** Read the images `ids` from the pool (once each; a read failing keeps them empty). */
export function readPageImages(ids: readonly string[]): Promise<void> {
    const fresh = ids.filter(id => !images.has(id) && !reading.has(id));
    if (fresh.length) {
        const job = loadImageUrls(fresh)
            .catch(() => new Map<string, string>())
            .then((urls) => {
                for (const id of fresh) {
                    images.set(id, urls.get(id) ?? '');
                    reading.delete(id);
                }
            });
        for (const id of fresh) reading.set(id, job);
    }
    return Promise.all(ids.map(id => reading.get(id)).filter(Boolean)).then(() => undefined);
}

/** `value` with a pooled image read for the page put back whole; anything else as it is. */
export function pageImageValue<T>(value: T): T {
    const id = typeof value === 'string' && value.length === 46 ? poolIdOf(value) : null;
    const url = id ? images.get(id) : undefined;
    return (url ? url : value) as T;
}

/** A copy of `value` with the images read put back whole; the same value when it has none (copy on write). */
function whole<T>(value: T, depth = 0): T {
    if (typeof value === 'string') return pageImageValue(value);
    if (!value || typeof value !== 'object' || depth > 32) return value;
    if (Array.isArray(value)) {
        let out: unknown[] | null = null;
        value.forEach((v, i) => {
            const w = whole(v, depth + 1);
            if (w !== v) { out ??= value.slice(); out[i] = w; }
        });
        return (out ?? value) as T;
    }
    let out: Record<string, unknown> | null = null;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const w = whole(v, depth + 1);
        if (w !== v) { out ??= { ...(value as Record<string, unknown>) }; out[k] = w; }
    }
    return (out ?? value) as T;
}

/** `map` with the records of `list` made whole (the same map when none changed). */
function wholeIn<T extends { id: string }>(map: Record<string, T> | undefined, list: T[], part: (t: T) => T): Record<string, T> | undefined {
    let out: Record<string, T> | null = null;
    for (const t of list) {
        const w = part(t);
        if (w !== t && map) { out ??= { ...map }; out[t.id] = w; }
    }
    return out ?? map;
}

/**
 * The tree the person's page is built from: the person's page images whole
 * (those read so far), every other part the tree's own.
 */
export function treeWithPageImages(data: StromData, personId: PersonId): StromData {
    if (images.size === 0) return data;
    const parts = pageParts(data, personId);
    if (!parts.person) return data;
    const person = whole(parts.person);
    const partnerships = wholeIn(data.partnerships, parts.partnerships, whole);
    const media = wholeIn(data.media, parts.media, whole);
    const sources = wholeIn(data.sources, parts.sources, s => {
        const excerpts = whole(s.excerpts);
        return excerpts === s.excerpts ? s : { ...s, excerpts };
    });
    if (person === parts.person && partnerships === data.partnerships && media === data.media && sources === data.sources) return data;
    return {
        ...data,
        persons: person === parts.person ? data.persons : { ...data.persons, [personId]: person },
        partnerships: partnerships ?? data.partnerships,
        ...(media ? { media } : {}),
        ...(sources ? { sources } : {}),
    };
}

/** The page closed: its images are let go. */
export function forgetPageImages(): void {
    images.clear();
}
