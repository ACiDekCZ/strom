/**
 * Spec 116 §5 (U4d2): the other places B — the tiles of lists while the
 * tree's files and crops come after the tree (the Materials window, a
 * person's materials and files, the previews of dialogs), a source's
 * thumbnail, viewer and editor, the held rows of a bulk load, the table's
 * couple's photo. One look: the tile under the veil while it comes, the
 * struck-through picture ("Not loaded" from 64 px) once it did not.
 * Invented data only.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { standInState, tileFailedHtml, waitingTileHtml, TILE_NOTE_MIN_PX } from '../ui/image-slot.js';
import { pendingImageUrl, sha256Hex } from '../research-image-refs.js';
import { imageLoads, resetImageLoads, startImageLoad, type ImageLoadDeps, type PendingImage } from '../image-loads.js';
import { thumbCell, columnById } from '../ui/table-view/table-columns.js';
import { thumbHtml } from '../ui/table-view/table-grid.js';
import { sourceThumbHtml, waitingExcerptHtml, refRatioStyle } from '../ui/sources.js';
import { heldRowState } from '../ui/research-images-ui.js';
import { strings } from '../strings.js';
import type { PersonId, Source, SourceExcerpt } from '../types.js';

const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const SHA_F = 'f'.repeat(64);
const SHA_D = 'd'.repeat(64);
const SHA_E = 'e'.repeat(64);
const WAIT_F = pendingImageUrl({ sha: SHA_F, mime: 'image/jpeg', bytes: 64_000 });
const WAIT_D = pendingImageUrl({ sha: SHA_D, mime: 'image/jpeg', bytes: 30_000 });

afterEach(() => resetImageLoads());

/**
 * A load of the open tree "tree-b" whose research lacks every image: all
 * wait until `whenIdle`, then all failed.
 */
function load(pending: PendingImage[]) {
    const deps: ImageLoadDeps = {
        fetch: {
            fetch: async (_url, init) => {
                const shas = (JSON.parse(String(init.body)) as { images: string[] }).images;
                return new Response(JSON.stringify({ images: [], missing: shas, more: [] }), { status: 200 });
            },
            sha256Hex, sleep: async () => {},
        },
        currentTreeId: () => 'tree-b', write: () => [], store: () => {}, emit: () => {},
    };
    return startImageLoad({ treeId: 'tree-b', url: 'http://127.0.0.1:1/x/images', pending, deps })!;
}

const crop = (id: string, caption?: string): SourceExcerpt => ({ id, dataUrl: '', width: 600, height: 150, sizeBytes: 30_000, ...(caption ? { caption } : {}) });

describe('a tile of a list (waitingTileHtml)', () => {
    it('while it comes: its own content under the veil; once it did not: the struck-through picture, "Not loaded" from 64 px, the title', () => {
        const loading = waitingTileHtml('loading', { tag: 'span', cls: 'mw-thumb', px: 120, content: '<span class="mw-type">JPG</span>', extra: '<i>m</i>' });
        expect(loading).toBe('<span class="mw-thumb" data-img-state="loading"><span class="mw-type">JPG</span><i>m</i></span>');
        const big = waitingTileHtml('failed', { tag: 'span', cls: 'mw-thumb', px: 120, content: 'JPG', extra: '<i>m</i>' });
        expect(big).toContain('data-img-state="failed"');
        expect(big).toContain(`title="${strings.photos.failed}"`);
        expect(big).toContain(`<span class="img-slot-note">${strings.photos.tileFailed}</span>`);
        expect(big).toContain('M3 3l18 18');
        expect(big).not.toContain('JPG');
        expect(big).toContain('<i>m</i>');
        // A small tile (a row, a chip): the glyph alone, its size as asked.
        const small = waitingTileHtml('failed', { tag: 'span', cls: 'material-thumb', px: 48 });
        expect(small).not.toContain('img-slot-note');
        expect(small).toContain('width="16"');
        expect(waitingTileHtml('failed', { tag: 'span', cls: 'source-chip-thumb', px: 0, glyph: 11 })).toContain('width="11"');
        expect(tileFailedHtml(TILE_NOTE_MIN_PX)).toContain('img-slot-note');
        expect(tileFailedHtml(TILE_NOTE_MIN_PX - 1)).not.toContain('img-slot-note');
        // Any other state: the place draws its tile as always.
        expect(waitingTileHtml('none', { tag: 'span', cls: 'x', px: 48 })).toBe('');
        expect(waitingTileHtml('loaded', { tag: 'span', cls: 'x', px: 48 })).toBe('');
    });

    it('a file of the tree on its way reads loading, then failed once the research lacks it; an image reads none', async () => {
        const q = load([{ key: 'media:m1', ref: { sha: SHA_F, mime: 'image/jpeg' }, owner: { personIds: ['p1' as PersonId], mediaId: 'm1' } }]);
        expect(standInState(WAIT_F)).toBe('loading');
        expect(standInState(IMG)).toBe('none');
        expect(standInState(undefined)).toBe('none');
        await q.whenIdle();
        expect(standInState(WAIT_F)).toBe('failed');
    });
});

describe('the table\'s couple\'s photo (spec 116 §5)', () => {
    const col = columnById('unions', 'uPhoto')!;

    it('on its way: the empty tile under the veil, "yes" and sorted with the photos; not come: struck through with its title', async () => {
        const q = load([{ key: 'union:u1:photo', ref: { sha: SHA_E, mime: 'image/jpeg' }, owner: { personIds: [], partnershipId: 'u1' as never } }]);
        const loading = thumbCell(undefined, 'union:u1:photo');
        expect(loading).toMatchObject({ empty: false, text: strings.table.yes, sortKey: 0, thumbState: 'loading' });
        const loadingHtml = thumbHtml(loading, col);
        expect(loadingHtml).toMatch(/^<button type="button" class="tv-thumb"[^>]* data-img-state="loading"><\/button>$/);
        // An older photo meanwhile: the photo under the veil.
        const refresh = thumbCell(IMG, 'union:u1:photo');
        expect(refresh.thumbState).toBe('refresh');
        expect(thumbHtml(refresh, col)).toContain('data-img-state="refresh"');
        expect(thumbHtml(refresh, col)).toContain('<img');
        await q.whenIdle();
        const failed = thumbCell(undefined, 'union:u1:photo');
        expect(failed).toMatchObject({ empty: false, sortKey: 0, thumbState: 'failed' });
        const failedHtml = thumbHtml(failed, col);
        expect(failedHtml).toMatch(/^<span class="tv-thumb"/);
        expect(failedHtml).toContain(`title="${strings.photos.failed}"`);
        expect(failedHtml).toContain('width="11"');
        expect(failedHtml).not.toContain('<img');
        // An older photo whose newer one did not come: the photo, calm.
        expect(thumbCell(IMG, 'union:u1:photo').thumbState).toBeUndefined();
    });

    it('without a load: the photo, or an empty cell', () => {
        expect(thumbCell(undefined, 'union:u1:photo').empty).toBe(true);
        const cell = thumbCell(IMG, 'union:u1:photo');
        expect(cell.thumbState).toBeUndefined();
        expect(thumbHtml(cell, col)).toContain('<img');
        expect(thumbHtml(cell, col)).not.toContain('data-img-state');
    });
});

describe('a source\'s crops on their way (spec 116 §5)', () => {
    const src = { id: 's1', title: 'Matrika zemřelých Zvonovice 1890–1910' } as Source;

    it('waitingExcerpts lists them in order with their state; another tree open: none', async () => {
        const q = load([
            { key: 'excerpt:s1:x1', ref: { sha: SHA_D, mime: 'image/jpeg', width: 600, height: 150 }, owner: { personIds: [], sourceId: 's1' }, excerpt: { record: crop('x1', 'Zápis'), after: [] } },
            { key: 'excerpt:s2:x2', ref: { sha: SHA_E, mime: 'image/jpeg' }, owner: { personIds: [], sourceId: 's2' }, excerpt: { record: crop('x2'), after: [] } },
        ]);
        const now = imageLoads.waitingExcerpts('s1');
        expect(now.map(w => [w.key, w.state, w.record.caption])).toEqual([['excerpt:s1:x1', 'pending', 'Zápis']]);
        await q.whenIdle();
        expect(imageLoads.waitingExcerpts('s1').map(w => w.state)).toEqual(['failed']);
        expect(imageLoads.waitingExcerpts('s9')).toEqual([]);
    });

    it('a chip, a row, a picker: the veil without a glyph while it comes, the struck-through picture once it did not', async () => {
        const q = load([{ key: 'excerpt:s1:x1', ref: { sha: SHA_D, mime: 'image/jpeg' }, owner: { personIds: [], sourceId: 's1' }, excerpt: { record: crop('x1'), after: [] } }]);
        const chip = sourceThumbHtml(src, 'chip');
        expect(chip).toBe('<span class="source-chip-thumb is-waiting" aria-hidden="true" data-img-state="loading"></span>');
        expect(sourceThumbHtml(src, 'row')).toContain('data-img-state="loading"');
        await q.whenIdle();
        const row = sourceThumbHtml(src, 'row');
        expect(row).toContain('data-img-state="failed"');
        expect(row).toContain('width="12"');
        expect(sourceThumbHtml(src, 'chip')).toContain('width="11"');
        // Its own crop is drawn as always; without crops and without one coming: the file icon.
        expect(sourceThumbHtml({ ...src, excerpts: [{ ...crop('x0'), dataUrl: IMG }] }, 'chip')).toContain(`<img class="source-chip-thumb" src="${IMG}"`);
        expect(sourceThumbHtml({ ...src, id: 's9' }, 'chip')).toContain('source-chip-icon');
    });

    it('the viewer and the editor: its place in the ratio with "Loading the photo…"; not come: "Not loaded" and Try again', () => {
        const w = { key: 'excerpt:s1:x1', state: 'pending' as const, ref: { sha: SHA_D, mime: 'image/jpeg', width: 600, height: 150 }, record: crop('x1') };
        const loading = waitingExcerptHtml(w, 'viewer-excerpt-box');
        expect(loading).toContain('data-img-state="loading"');
        expect(loading).toContain('style="aspect-ratio: 600 / 150"');
        expect(loading).toContain(strings.photos.loading);
        expect(loading).not.toContain('data-excerpt-retry');
        const failed = waitingExcerptHtml({ ...w, state: 'failed' }, 'excerpt-img');
        expect(failed).toContain('data-img-state="failed"');
        expect(failed).toContain(strings.photos.tileFailed);
        expect(failed).toContain(`<span>${strings.photos.failed}</span>`);
        expect(failed).toContain(`data-excerpt-retry="excerpt:s1:x1">${strings.busy.retry}</button>`);
        expect(failed).not.toContain('is-err');
        // A stand-in is never an <img>.
        expect(loading + failed).not.toContain('<img');
        expect(refRatioStyle({})).toBe('');
    });
});

describe('the held rows of a bulk load (spec 116 §5)', () => {
    it('the source downloaded now under the veil, one that did not come struck through, else as it is', () => {
        const q = { current: 'S2', hasFailed: (r: string) => r === 'S1' };
        expect(heldRowState(q, 'S1')).toBe('failed');
        expect(heldRowState(q, 'S2')).toBe('loading');
        expect(heldRowState(q, 'S3')).toBeNull();
        expect(heldRowState({ current: null, hasFailed: () => false }, 'S2')).toBeNull();
    });
});
