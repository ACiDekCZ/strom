/**
 * The portrait cut from an original (spec 107, part A): the pure crop math in
 * photo.ts, the load rules for Person.photoSource and Partnership.photo
 * (validation.ts via migrateData) and the DataManager paths that unlink a
 * portrait from an original that goes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    defaultPortraitCrop, portraitRect, portraitPageSize, minZoomForAngle, maxPortraitZoom, portraitZoomRange,
    clampPortraitView, clampPortraitCrop, portraitViewFromCrop, portraitCropFromView, defaultPortraitView,
    panPortraitView, zoomPortraitView, straightenPortraitView, turnPortraitView, mirrorPortraitView,
    portraitViewMatrix, portraitOutputMatrix, invertMatrix, applyMatrix, isPortraitRegionSquare,
    isPortraitSourceShape, isDefaultPortraitCrop, portraitSourcePixels, dropDanglingPortraitSources,
    computeCoverCrop, PortraitView, stripPhotos, totalPhotoBytes, dataUrlByteSize, isPortraitRegionShape,
    PORTRAIT_EMPTY_FILL,
} from '../photo.js';
import { countImages } from '../attachments.js';
import { addPersonMedia, personMedia } from '../media.js';
import { applyContentOptions, applyLivingPrivacy } from '../privacy.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { createMergeState, updateConflictResolution } from '../merge/matching.js';
import { executeMerge } from '../merge/executor.js';
import { StorageManager } from '../storage.js';
import { carryOverMedia } from '../research-link.js';
import { cleanPortraitSources, stripUnsafeMediaDataUrls } from '../validation.js';
import { DataManager, migrateData } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { UndoManager } from '../undo.js';
import { StromData, Person, PersonId, PartnershipId, TreeId, PortraitSource } from '../types.js';

const OUT = 256;

/** The original's pixel under an output pixel of a view. */
function sourcePoint(view: PortraitView, w: number, h: number, u: number, v: number): { x: number; y: number } {
    return applyMatrix(invertMatrix(portraitViewMatrix(view, w, h, OUT))!, u, v);
}

/** Whether all four corners of the frame land on the original (no empty corner in the portrait). */
function cornersInside(view: PortraitView, w: number, h: number): boolean {
    const eps = 1e-6 * Math.max(w, h);
    return [[0, 0], [OUT, 0], [0, OUT], [OUT, OUT]].every(([u, v]) => {
        const p = sourcePoint(view, w, h, u, v);
        return p.x >= -eps && p.y >= -eps && p.x <= w + eps && p.y <= h + eps;
    });
}

/** Whether the frame's centre lands on the original. */
function centreInside(view: PortraitView, w: number, h: number): boolean {
    const eps = 1e-6 * Math.max(w, h);
    const p = sourcePoint(view, w, h, OUT / 2, OUT / 2);
    return p.x >= -eps && p.y >= -eps && p.x <= w + eps && p.y <= h + eps;
}

const close = (a: { x: number; y: number }, b: { x: number; y: number }, digits = 6): void => {
    expect(a.x).toBeCloseTo(b.x, digits);
    expect(a.y).toBeCloseTo(b.y, digits);
};

describe('portrait crop math', () => {
    it('opens on the centred square compressPhoto has always cut (wide and narrow)', () => {
        const wide = defaultPortraitCrop(400, 300);
        expect(wide).toEqual({ region: { x: 0.125, y: 0, w: 0.75, h: 1 } });
        expect(portraitRect(wide, 400, 300)).toMatchObject({ cx: 200, cy: 150, side: 300, angle: 0 });
        const narrow = defaultPortraitCrop(300, 1200);
        expect(narrow.region).toEqual({ x: 0, y: 0.375, w: 1, h: 0.25 });
        // The same pixels as computeCoverCrop.
        const c = computeCoverCrop(300, 1200);
        expect(narrow.region.y * 1200).toBe(c.sy);
        expect(isDefaultPortraitCrop(narrow, 300, 1200)).toBe(true);
        expect(isDefaultPortraitCrop({ ...narrow, angle: 1 }, 300, 1200)).toBe(false);
    });

    it('the opening view maps the frame onto the centred square, upright', () => {
        const view = defaultPortraitView(400, 300);
        expect(view.zoom).toBeCloseTo(1, 9);
        close(sourcePoint(view, 400, 300, 0, 0), { x: 50, y: 0 });
        close(sourcePoint(view, 400, 300, OUT, OUT), { x: 350, y: 300 });
        expect(portraitOutputMatrix(defaultPortraitCrop(400, 300), 400, 300).map(n => +n.toFixed(9)))
            .toEqual([OUT / 300, 0, 0, OUT / 300, -50 * OUT / 300, 0].map(n => +n.toFixed(9)));
    });

    it('min zoom grows with the angle: 1 upright, √2 at ±45°', () => {
        expect(minZoomForAngle(0)).toBe(1);
        expect(minZoomForAngle(45)).toBeCloseTo(Math.SQRT2, 12);
        expect(minZoomForAngle(-45)).toBeCloseTo(Math.SQRT2, 12);
        expect(minZoomForAngle(-10)).toBeCloseTo(minZoomForAngle(10), 12);
    });

    it('max zoom: 800 %, a small photo only to shorter side / 128, never below the min', () => {
        expect(maxPortraitZoom(4000, 3000)).toBe(8);
        expect(maxPortraitZoom(300, 200)).toBeCloseTo(200 / 128, 12);
        expect(maxPortraitZoom(100, 100)).toBe(1);
        // 150 px: max 1.17 is below √2 — at 45° the range collapses to the min.
        const r = portraitZoomRange(150, 150, 45);
        expect(r.min).toBeCloseTo(Math.SQRT2, 12);
        expect(r.max).toBe(r.min);
    });

    it('clamping keeps the frame\'s centre on the photo at any turn, angle and mirror', () => {
        const sizes: [number, number][] = [[400, 300], [300, 1200], [150, 150], [5000, 4000]];
        for (const [w, h] of sizes) {
            for (const quarterTurns of [0, 1, 2, 3] as const) {
                for (const angle of [-45, -12.5, 0, 7, 45]) {
                    for (const mirror of [false, true]) {
                        // Too far out and too wide on purpose.
                        const view = clampPortraitView({ cx: -1000, cy: 99999, zoom: 0.2, quarterTurns, angle, mirror }, w, h);
                        expect(view.zoom).toBeGreaterThanOrEqual(minZoomForAngle(angle) - 1e-12);
                        expect(centreInside(view, w, h)).toBe(true);
                    }
                }
            }
        }
    });

    it('limits the angle to ±45° in steps of 0.5 and the turns to 0–3', () => {
        const v = clampPortraitView({ cx: 0, cy: 0, zoom: 1, quarterTurns: 7 as never, angle: 61.3, mirror: false }, 400, 300);
        expect(v.angle).toBe(45);
        expect(v.quarterTurns).toBe(3);
        expect(clampPortraitView({ ...v, angle: -3.3 }, 400, 300).angle).toBe(-3.5);
        expect(clampPortraitView({ ...v, zoom: 99 }, 400, 300).zoom).toBeCloseTo(300 / 128, 12);
    });

    it('a crop and its view convert both ways', () => {
        const crop = { region: { x: 0.3, y: 0.2, w: 0.25, h: 0.25 * 300 / 400 }, quarterTurns: 1 as const, angle: 4.5 };
        // Page 3000 × 4000 after one turn: the region is a square of 750 px.
        expect(portraitPageSize(4000, 3000, 1)).toEqual({ width: 3000, height: 4000 });
        const view = portraitViewFromCrop(crop, 4000, 3000);
        expect(view.zoom).toBeCloseTo(4, 9);
        const back = portraitCropFromView(view, 4000, 3000);
        expect(back.quarterTurns).toBe(1);
        expect(back.angle).toBe(4.5);
        expect(back.region.x).toBeCloseTo(crop.region.x, 6);
        expect(back.region.h).toBeCloseTo(crop.region.h, 6);
        expect(portraitSourcePixels(crop, 4000, 3000)).toBeCloseTo(750, 9);
    });

    it('clamping a stored crop keeps its origin', () => {
        const src: PortraitSource = { attachmentId: 'a1', region: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, angle: 80 };
        const c = clampPortraitCrop(src, 400, 400);
        expect(c.attachmentId).toBe('a1');
        expect(c.angle).toBe(45);
        // The frame may reach past the edge, its centre stays on the photo.
        expect(c.region.x + c.region.w / 2).toBeCloseTo(1, 6);
        expect(c.region.y + c.region.h / 2).toBeCloseTo(1, 6);
    });

    it('four quarter turns come back; the point under the frame stays under it', () => {
        const w = 4000, h = 3000;
        // A turn goes back to the smallest covering zoom (the whole shorter
        // side), so the point stays only where the edge lets it: here it does.
        let view = clampPortraitView({ cx: 2400, cy: 1500, zoom: 6, quarterTurns: 0, angle: 0, mirror: false }, w, h);
        const centre = sourcePoint(view, w, h, OUT / 2, OUT / 2);
        for (let i = 1; i <= 4; i++) {
            view = turnPortraitView(view, 1, w, h);
            expect(view.quarterTurns).toBe(i % 4);
            close(sourcePoint(view, w, h, OUT / 2, OUT / 2), centre);
        }
        const back = turnPortraitView(view, -1, w, h);
        expect(back.quarterTurns).toBe(3);
        close(sourcePoint(back, w, h, OUT / 2, OUT / 2), centre);
        expect(back.zoom).toBe(1);
    });

    it('mirroring swaps left and right of the portrait, whatever the turn', () => {
        const w = 4000, h = 3000;
        for (const quarterTurns of [0, 1, 2, 3] as const) {
            const view = clampPortraitView({ cx: 1400, cy: 1300, zoom: 3, quarterTurns, angle: 12, mirror: false }, w, h);
            const mirrored = mirrorPortraitView(view, w, h);
            expect(mirrored.mirror).toBe(true);
            for (const [u, v] of [[0, 0], [40, 200], [OUT, 10]]) {
                close(sourcePoint(mirrored, w, h, OUT - u, v), sourcePoint(view, w, h, u, v), 4);
            }
            const twice = mirrorPortraitView(mirrored, w, h);
            close(sourcePoint(twice, w, h, 30, 70), sourcePoint(view, w, h, 30, 70), 4);
        }
    });

    it('dragging moves the photo with the pointer, also when straightened', () => {
        const w = 4000, h = 3000;
        const view = clampPortraitView({ cx: 2000, cy: 1500, zoom: 4, quarterTurns: 0, angle: 20, mirror: false }, w, h);
        const under = sourcePoint(view, w, h, 100, 100);
        const moved = panPortraitView(view, 30, -15, OUT, w, h);
        close(sourcePoint(moved, w, h, 130, 85), under, 4);
        // A long drag stops with the frame's centre on the photo's edge.
        const far = panPortraitView(view, -99999, 0, OUT, w, h);
        expect(centreInside(far, w, h)).toBe(true);
        expect(cornersInside(far, w, h)).toBe(false);
    });

    it('zooming about the pointer keeps the point under it', () => {
        const w = 4000, h = 3000;
        const view = clampPortraitView({ cx: 2000, cy: 1500, zoom: 2, quarterTurns: 1, angle: -8, mirror: true }, w, h);
        const under = sourcePoint(view, w, h, 60, 200);
        const zoomed = zoomPortraitView(view, 5, w, h, { x: 60 - OUT / 2, y: 200 - OUT / 2, framePx: OUT });
        expect(zoomed.zoom).toBe(5);
        close(sourcePoint(zoomed, w, h, 60, 200), under, 4);
    });

    it('straightening raises the zoom only as far as it must', () => {
        const view = defaultPortraitView(400, 300);
        const s = straightenPortraitView(view, 45, 400, 300);
        expect(s.zoom).toBeCloseTo(Math.SQRT2, 12);
        expect(straightenPortraitView({ ...s, zoom: 2 }, 0, 400, 300).zoom).toBe(2);
        expect(cornersInside(s, 400, 300)).toBe(true);
    });

    it('a region is square in the pixels of the turned page, within 1 %', () => {
        expect(isPortraitRegionSquare({ x: 0, y: 0, w: 0.75, h: 1 }, 400, 300)).toBe(true);
        expect(isPortraitRegionSquare({ x: 0, y: 0, w: 0.75, h: 1 }, 400, 300, 1)).toBe(false);
        expect(isPortraitRegionSquare({ x: 0, y: 0, w: 1, h: 0.75 }, 400, 300, 1)).toBe(true);
        expect(isPortraitRegionSquare({ x: 0, y: 0, w: 0.5, h: 0.66 }, 400, 300)).toBe(true);   // 200 vs 198
        expect(isPortraitRegionSquare({ x: 0, y: 0, w: 0.5, h: 0.6 }, 400, 300)).toBe(false);   // 200 vs 180
    });

    it('the shape of a portrait source: one origin, a valid region and angle', () => {
        const region = { x: 0, y: 0, w: 0.5, h: 0.5 };
        expect(isPortraitSourceShape({ attachmentId: 'a', region })).toBe(true);
        expect(isPortraitSourceShape({ partnershipId: 'u', region, quarterTurns: 2, angle: -45, mirror: true })).toBe(true);
        expect(isPortraitSourceShape({ attachmentId: 'a', partnershipId: 'u', region })).toBe(false);
        expect(isPortraitSourceShape({ region })).toBe(false);
        expect(isPortraitSourceShape({ attachmentId: 'a', region, angle: 45.5 })).toBe(false);
        expect(isPortraitSourceShape({ attachmentId: 'a', region, quarterTurns: 4 })).toBe(false);
        expect(isPortraitSourceShape({ attachmentId: 'a', region: { x: 0.8, y: 0, w: 0.5, h: 0.5 } })).toBe(false);
        expect(isPortraitSourceShape({ attachmentId: 'a', region, mirror: false })).toBe(false);
    });
});

// ── The load rules ──

/** A PNG data URL whose header says `w` × `h` (enough for dataUrlImageSize). */
function png(w: number, h: number): string {
    const b = new Uint8Array(33);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(b.buffer).setUint32(16, w);
    new DataView(b.buffer).setUint32(20, h);
    return `data:image/png;base64,${Buffer.from(b).toString('base64')}`;
}

const PORTRAIT = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD';
const A = 'p_a' as PersonId, B = 'p_b' as PersonId, C = 'p_c' as PersonId;
const U = 'u_ab' as PartnershipId;

function person(id: PersonId, over: Partial<Person> = {}): Person {
    return { id, firstName: 'Zorbin', lastName: 'Quellmar', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...over };
}

/** A and B a couple with a 400 × 300 photo; A has a 400 × 300 attachment; C is no partner. */
function tree(sourceA?: PortraitSource, sourceC?: PortraitSource): StromData {
    return {
        persons: {
            [A]: person(A, { partnerships: [U], photo: PORTRAIT, photoSource: sourceA }),
            [B]: person(B, { gender: 'female', partnerships: [U] }),
            [C]: person(C, { photo: PORTRAIT, photoSource: sourceC }),
        },
        partnerships: { [U]: { id: U, person1Id: A, person2Id: B, childIds: [], status: 'married', photo: png(400, 300), photoOriginalName: 'wedding.png', photoDate: '1924' } },
        media: { att1: { id: 'att1', name: 'studio.png', mimeType: 'image/png', dataUrl: png(400, 300), sizeBytes: 33, places: [{ personId: A }] } },
    };
}

describe('portrait source on load', () => {
    const square = { x: 0.125, y: 0, w: 0.75, h: 1 };

    it('keeps a valid one, from an attachment and from the union', () => {
        const d = tree({ attachmentId: 'att1', region: square, angle: -3 }, undefined);
        expect(cleanPortraitSources(d)).toBe(0);
        expect(d.persons[A].photoSource).toEqual({ attachmentId: 'att1', region: square, angle: -3 });
        const u = tree({ partnershipId: U, region: square, mirror: true });
        expect(cleanPortraitSources(u)).toBe(0);
    });

    it('a region square only after its quarter turn', () => {
        // 400 × 300 turned once is 300 × 400: w 0.5 → 150 px, h 0.375 → 150 px.
        const turned = { x: 0, y: 0, w: 0.5, h: 0.375 };
        expect(cleanPortraitSources(tree({ attachmentId: 'att1', region: turned, quarterTurns: 1 }))).toBe(0);
        expect(cleanPortraitSources(tree({ attachmentId: 'att1', region: turned }))).toBe(1);
    });

    it('drops one that breaks a rule, the portrait stays', () => {
        const bad: PortraitSource[] = [
            { attachmentId: 'att1', partnershipId: U, region: square },          // both origins
            { region: square },                                                  // none
            { attachmentId: 'att1', region: { x: 0.7, y: 0, w: 0.75, h: 1 } },   // its centre off the image
            { attachmentId: 'att1', region: { x: 0, y: 0, w: 0.5, h: 1 } },      // not a square
            { attachmentId: 'att1', region: square, angle: 46 },                 // beyond 45°
            { attachmentId: 'gone', region: square },                            // no such attachment
            { partnershipId: 'u_gone' as PartnershipId, region: square },        // no such union
        ];
        for (const src of bad) {
            const d = tree(src);
            expect(cleanPortraitSources(d)).toBe(1);
            expect(d.persons[A].photoSource).toBeUndefined();
            expect(d.persons[A].photo).toBe(PORTRAIT);
        }
        // A union photo of a couple the person is not in.
        const d = tree(undefined, { partnershipId: U, region: square });
        expect(cleanPortraitSources(d)).toBe(1);
        // A union without a photo.
        const e = tree({ partnershipId: U, region: square });
        delete e.partnerships[U].photo;
        expect(cleanPortraitSources(e)).toBe(1);
        // No portrait: nothing to have a source.
        const f = tree({ attachmentId: 'att1', region: square });
        delete f.persons[A].photo;
        expect(cleanPortraitSources(f)).toBe(1);
    });

    it('an image whose size cannot be read keeps its source', () => {
        const d = tree({ attachmentId: 'att1', region: { x: 0, y: 0, w: 0.5, h: 1 } });
        d.media!.att1.dataUrl = 'data:image/jpeg;base64,AA==';
        expect(cleanPortraitSources(d)).toBe(0);
    });

    it('a couple\'s photo that is not an image goes, with its name and date', () => {
        const d = tree();
        d.partnerships[U].photo = 'data:text/html;base64,PHNjcmlwdD4=';
        expect(stripUnsafeMediaDataUrls(d)).toBe(1);
        expect(d.partnerships[U]).not.toHaveProperty('photo');
        expect(d.partnerships[U]).not.toHaveProperty('photoOriginalName');
        expect(d.partnerships[U]).not.toHaveProperty('photoDate');
    });

    it('a tree of version 22 (no portrait sources, no couple photos) loads unchanged', () => {
        const v22: StromData = { version: 22, persons: { [C]: person(C, { photo: PORTRAIT, photoDate: '1950' }) }, partnerships: {} };
        const loaded = migrateData(structuredClone(v22));
        expect(loaded.persons[C]).toEqual(v22.persons[C]);
    });

    it('migrateData drops a dangling source and keeps a valid one', () => {
        const d = tree({ attachmentId: 'att1', region: square }, { attachmentId: 'att1', region: square });
        const loaded = migrateData(d);
        expect(loaded.persons[A].photoSource?.attachmentId).toBe('att1');
        expect(loaded.persons[C].photoSource).toBeUndefined();
        expect(loaded.partnerships[U].photo).toBe(png(400, 300));
    });

    it('dropDanglingPortraitSources: only those whose original went', () => {
        const d = tree({ partnershipId: U, region: square });
        expect(dropDanglingPortraitSources(d)).toBe(0);
        delete d.partnerships[U].photo;
        expect(dropDanglingPortraitSources(d)).toBe(1);
        expect(d.persons[A].photoSource).toBeUndefined();
    });
});

// ── DataManager: the original goes, the portrait stays ──

const TREE = 'portrait-crop-tree' as TreeId;

function load(data: StromData): void {
    vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
    dm.data = data;
    dm.currentTreeId = TREE;
    dm.viewMode = false;
    dm.pendingBefore = null;
    DataManager.onMutationCommitted = null;
    UndoManager.setActiveTree(null);
    UndoManager.setActiveTree(TREE);
}

describe('DataManager and the portrait\'s original', () => {
    const square = { x: 0.125, y: 0, w: 0.75, h: 1 };
    beforeEach(() => load(tree()));

    it('updatePerson saves a source with the portrait; a new portrait without one drops it', () => {
        DataManager.updatePerson(A, { photo: PORTRAIT, photoSource: { attachmentId: 'att1', region: square, angle: 2 } });
        expect(DataManager.getPerson(A)?.photoSource).toEqual({ attachmentId: 'att1', region: square, angle: 2 });
        DataManager.updatePerson(A, { photo: 'data:image/jpeg;base64,/9j/AAAA' });
        expect(DataManager.getPerson(A)?.photoSource).toBeUndefined();
    });

    it('removing the portrait removes its source', () => {
        DataManager.updatePerson(A, { photo: PORTRAIT, photoSource: { attachmentId: 'att1', region: square } });
        DataManager.updatePerson(A, { photo: '' });
        expect(DataManager.getPerson(A)?.photo).toBeUndefined();
        expect(DataManager.getPerson(A)?.photoSource).toBeUndefined();
    });

    it('a malformed source is not saved', () => {
        DataManager.updatePerson(A, { photoSource: { region: square } as PortraitSource });
        expect(DataManager.getPerson(A)?.photoSource).toBeUndefined();
    });

    it('deleting the original attachment keeps the portrait without its source', () => {
        load(tree({ attachmentId: 'att1', region: square }));
        DataManager.removeAttachment(A, 'att1');
        expect(DataManager.getPerson(A)?.photo).toBe(PORTRAIT);
        expect(DataManager.getPerson(A)?.photoSource).toBeUndefined();
    });

    it('deleting the union keeps the portraits cut from its photo, without their source', () => {
        load(tree({ partnershipId: U, region: square }));
        DataManager.removePartnership(A, B);
        expect(DataManager.getData().partnerships[U]).toBeUndefined();
        expect(DataManager.getPerson(A)?.photo).toBe(PORTRAIT);
        expect(DataManager.getPerson(A)?.photoSource).toBeUndefined();
    });

    it('a new or removed couple photo unlinks the portraits; its name and date go with it', () => {
        load(tree({ partnershipId: U, region: square }));
        DataManager.updatePartnership(U, { photoDate: '1925' });
        expect(DataManager.getData().partnerships[U].photoDate).toBe('1925');
        // Its original (spec 108 K2.4) is set with it and goes with it.
        DataManager.updatePartnership(U, { photoOriginal: { sha256: 'A'.repeat(64), name: 'wedding.tif', mimeType: 'image/tiff', bytes: 9000 } });
        expect(DataManager.getData().partnerships[U].photoOriginal).toEqual({ sha256: 'a'.repeat(64), name: 'wedding.tif', mimeType: 'image/tiff', bytes: 9000 });
        expect(DataManager.getPerson(A)?.photoSource).toBeDefined();
        DataManager.updatePartnership(U, { photo: '' });
        const union = DataManager.getData().partnerships[U];
        expect(union.photo).toBeUndefined();
        expect(union.photoOriginalName).toBeUndefined();
        expect(union.photoDate).toBeUndefined();
        expect(union.photoOriginal).toBeUndefined();
        expect(DataManager.getPerson(A)?.photoSource).toBeUndefined();
        // An unsafe one is not taken.
        DataManager.updatePartnership(U, { photo: 'data:text/html;base64,AA==' });
        expect(DataManager.getData().partnerships[U].photo).toBeUndefined();
    });

    it('merging two people folds a duplicate union\'s photo into the kept one', () => {
        // C is a second record of A, married to B too, the photo on that union.
        const d = tree();
        const U2 = 'u_cb' as PartnershipId;
        d.partnerships[U2] = { ...d.partnerships[U], id: U2, person1Id: C };
        delete d.partnerships[U].photo;
        delete d.partnerships[U].photoOriginalName;
        delete d.partnerships[U].photoDate;
        d.persons[C].partnerships = [U2];
        d.persons[B].partnerships = [U, U2];
        d.persons[B].photo = PORTRAIT;
        d.persons[B].photoSource = { partnershipId: U2, region: square };
        load(d);
        DataManager.mergePersons(A, C, {}, new Map([[U2, 'merge']]));
        const union = DataManager.getData().partnerships[U];
        expect(union.photo).toBe(png(400, 300));
        expect(union.photoOriginalName).toBe('wedding.png');
        expect(DataManager.getData().partnerships[U2]).toBeUndefined();
        expect(DataManager.getPerson(B)?.photoSource?.partnershipId).toBe(U);
    });
});

// ── Without photos, privacy ──

describe('photos left out of an export', () => {
    const square = { x: 0.125, y: 0, w: 0.75, h: 1 };

    it('stripPhotos takes the portraits, their originals and the couples\' photos', () => {
        const d = tree({ attachmentId: 'att1', region: square });
        addPersonMedia(d, A, { id: 'att2', name: 'letter.png', mimeType: 'image/png', dataUrl: png(10, 10), sizeBytes: 33 });
        const out = stripPhotos(d);
        expect(out.persons[A].photo).toBeUndefined();
        expect(out.persons[A].photoSource).toBeUndefined();
        // The original is a photo of the person; another attachment stays.
        expect(personMedia(out, A).map(a => a.id)).toEqual(['att2']);
        expect(out.partnerships[U]).not.toHaveProperty('photo');
        expect(out.partnerships[U]).not.toHaveProperty('photoOriginalName');
        expect(out.partnerships[U]).not.toHaveProperty('photoDate');
        // The input is untouched.
        expect(d.partnerships[U].photo).toBeDefined();
    });

    it('countImages and totalPhotoBytes count the couple\'s photo with the photos', () => {
        const d = tree();
        expect(countImages(d).photos).toBe(3);
        expect(countImages(d).attachments).toBe(1);
        expect(totalPhotoBytes(d)).toBe(2 * dataUrlByteSize(PORTRAIT) + dataUrlByteSize(png(400, 300)));
    });

    it('without attachments, the portrait keeps no link to its original', () => {
        const out = applyContentOptions(tree({ attachmentId: 'att1', region: square }),
            { photos: true, attachments: false, notes: true, sources: true });
        expect(out.persons[A].photo).toBe(PORTRAIT);
        expect(out.persons[A].photoSource).toBeUndefined();
        expect(out.partnerships[U].photo).toBeDefined();
    });
});

describe('living people under a privacy mode', () => {
    const square = { x: 0.125, y: 0, w: 0.75, h: 1 };
    const DEAD = { birthDate: '1890', deathDate: '1960' };

    it('a living person loses the portrait\'s source and its original', () => {
        const d = tree({ attachmentId: 'att1', region: square });
        Object.assign(d.persons[B], DEAD);
        const out = applyLivingPrivacy(d, 'anonymous', 2026, { keepDeceasedSources: true });
        expect(out.persons[A].photoSource).toBeUndefined();
        expect(personMedia(out, A)).toHaveLength(0);
    });

    it('the couple\'s photo goes when either partner is living, with the deceased one\'s link to it', () => {
        const d = tree();
        Object.assign(d.persons[A], DEAD, { photoSource: { partnershipId: U, region: square } });
        const out = applyLivingPrivacy(d, 'initials', 2026, { keepDeceasedSources: true });
        expect(out.partnerships[U]).not.toHaveProperty('photo');
        expect(out.partnerships[U]).not.toHaveProperty('photoOriginalName');
        expect(out.persons[A].photo).toBe(PORTRAIT);
        expect(out.persons[A].photoSource).toBeUndefined();
    });

    it('a couple both deceased keeps its photo and the portraits their source', () => {
        const d = tree();
        Object.assign(d.persons[A], DEAD, { photoSource: { partnershipId: U, region: square } });
        Object.assign(d.persons[B], DEAD);
        const out = applyLivingPrivacy(d, 'anonymous', 2026, { keepDeceasedSources: true });
        expect(out.partnerships[U].photo).toBe(png(400, 300));
        expect(out.persons[A].photoSource).toEqual({ partnershipId: U, region: square });
    });

    it('without the deceased\'s sources every attachment goes, and the links to them', () => {
        const d = tree({ attachmentId: 'att1', region: square });
        Object.assign(d.persons[A], DEAD);
        Object.assign(d.persons[B], DEAD);
        const out = applyLivingPrivacy(d, 'anonymous', 2026);
        expect(out.persons[A].photo).toBe(PORTRAIT);
        expect(out.persons[A].photoSource).toBeUndefined();
    });
});

// ── Merging a file into the tree ──

const COUPLE_GED = [
    '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
    '0 @I1@ INDI', '1 NAME Zorbin /Quellmar/', '1 SEX M', '1 BIRT', '2 DATE 3 MAR 1881', '1 DEAT', '2 DATE 1950', '1 FAMS @F1@',
    '0 @I2@ INDI', '1 NAME Ottavine /Fenwray/', '1 SEX F', '1 BIRT', '2 DATE 12 JUN 1884', '1 DEAT', '2 DATE 1961', '1 FAMS @F1@',
    '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 MARR', '2 DATE 1905',
    '0 TRLR',
].join('\n');

describe('merging a tree with portraits and a couple photo', () => {
    const square = { x: 0.125, y: 0, w: 0.75, h: 1 };
    const OTHER = 'data:image/jpeg;base64,/9j/BBBB';
    const importGed = (): StromData => convertToStrom(parseGedcom(COUPLE_GED)).data;
    const named = (d: StromData, first: string): Person => Object.values(d.persons).find(p => p.firstName === first)!;
    const union = (d: StromData) => Object.values(d.partnerships)[0];

    /** The incoming tree: his portrait cut from his attachment, hers from the couple's photo. */
    function incomingTree(): StromData {
        const d = importGed();
        const he = named(d, 'Zorbin'), she = named(d, 'Ottavine'), u = union(d);
        addPersonMedia(d, he.id, { id: 'att-in', name: 'studio.png', mimeType: 'image/png', dataUrl: png(400, 300), sizeBytes: 33 });
        he.photo = PORTRAIT;
        he.photoSource = { attachmentId: 'att-in', region: square, angle: 5 };
        u.photo = png(400, 300);
        u.photoOriginalName = 'wedding.png';
        she.photo = OTHER;
        she.photoSource = { partnershipId: u.id, region: square };
        return d;
    }

    beforeEach(() => {
        vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
    });

    it('into a tree without them: the portraits bring their originals, the union its photo', async () => {
        const existing = importGed();
        // The same studio photo is in the tree already, under its own id.
        addPersonMedia(existing, named(existing, 'Zorbin').id, { id: 'att-own', name: 'studio.png', mimeType: 'image/png', dataUrl: png(400, 300), sizeBytes: 33 });
        const result = await executeMerge(createMergeState(existing, incomingTree()));
        expect(result.success).toBe(true);
        const merged = result.mergedData;
        const he = named(merged, 'Zorbin'), she = named(merged, 'Ottavine'), u = union(merged);
        expect(u.id).toBe(union(existing).id);
        expect(u.photo).toBe(png(400, 300));
        expect(u.photoOriginalName).toBe('wedding.png');
        expect(he.photoSource).toEqual({ attachmentId: 'att-own', region: square, angle: 5 });
        expect(she.photo).toBe(OTHER);
        expect(she.photoSource).toEqual({ partnershipId: u.id, region: square });
    });

    it('the tree\'s own couple photo stays; a portrait cut from the other one keeps no link', async () => {
        const existing = importGed();
        union(existing).photo = png(640, 480);
        const merged = (await executeMerge(createMergeState(existing, incomingTree()))).mergedData;
        expect(union(merged).photo).toBe(png(640, 480));
        expect(named(merged, 'Ottavine').photo).toBe(OTHER);
        expect(named(merged, 'Ottavine').photoSource).toBeUndefined();
    });

    it('the winning portrait brings its source: the tree\'s own by default, the file\'s when chosen', async () => {
        const existing = importGed();
        const own = named(existing, 'Zorbin');
        addPersonMedia(existing, own.id, { id: 'att-old', name: 'old.png', mimeType: 'image/png', dataUrl: png(300, 300), sizeBytes: 33 });
        own.photo = 'data:image/jpeg;base64,/9j/CCCC';
        own.photoSource = { attachmentId: 'att-old', region: { x: 0, y: 0, w: 1, h: 1 } };

        const kept = await executeMerge(createMergeState(existing, incomingTree()));
        expect(named(kept.mergedData, 'Zorbin').photoSource).toEqual(own.photoSource);

        const chosen = createMergeState(existing, incomingTree());
        const match = chosen.matches.find(m => m.incomingPerson.firstName === 'Zorbin')!;
        updateConflictResolution(chosen, match.incomingId, 'photo', 'use_incoming');
        const he = named((await executeMerge(chosen)).mergedData, 'Zorbin');
        expect(he.photo).toBe(PORTRAIT);
        expect(he.photoSource).toEqual({ attachmentId: 'att-in', region: square, angle: 5 });
    });
    it('a portrait whose frame reaches past its photo\'s edge keeps that source', async () => {
        const incoming = incomingTree();
        const past = { x: -0.3, y: 0, w: 0.75, h: 1 };
        named(incoming, 'Zorbin').photoSource = { attachmentId: 'att-in', region: past };
        const he = named((await executeMerge(createMergeState(importGed(), incoming))).mergedData, 'Zorbin');
        expect(he.photoSource?.region).toEqual(past);
    });
});

// ── An update from the research ──

describe('an update from the research keeps the app\'s portrait sources and couple photos', () => {
    const square = { x: 0.125, y: 0, w: 0.75, h: 1 };

    /** What the research sends back: the same people, no images (it keeps none of the app's). */
    function fromResearch(previous: StromData): StromData {
        const next = structuredClone(previous);
        for (const p of Object.values(next.persons)) {
            delete p.photo; delete p.photoSource;
        }
        delete next.media;
        for (const u of Object.values(next.partnerships)) {
            delete u.photo; delete u.photoOriginalName; delete u.photoDate;
        }
        return next;
    }

    it('the couple\'s photo, the portraits and their sources come along', () => {
        const previous = tree({ attachmentId: 'att1', region: square, angle: -2 });
        previous.persons[B].photo = PORTRAIT;
        previous.persons[B].photoSource = { partnershipId: U, region: square };
        const { data, lost } = carryOverMedia(fromResearch(previous), previous);
        expect(lost).toBe(0);
        expect(data.partnerships[U]).toMatchObject({ photo: png(400, 300), photoOriginalName: 'wedding.png', photoDate: '1924' });
        expect(data.persons[A].photoSource).toEqual({ attachmentId: 'att1', region: square, angle: -2 });
        expect(data.persons[B].photoSource).toEqual({ partnershipId: U, region: square });
    });

    it('the couple under a new id (the same two people) keeps its photo, the portrait follows', () => {
        const previous = tree();
        previous.persons[B].photo = PORTRAIT;
        previous.persons[B].photoSource = { partnershipId: U, region: square };
        const next = fromResearch(previous);
        const U2 = 'u_new' as PartnershipId;
        next.partnerships = { [U2]: { ...next.partnerships[U], id: U2 } };
        next.persons[A].partnerships = [U2];
        next.persons[B].partnerships = [U2];
        const { data } = carryOverMedia(next, previous);
        expect(data.partnerships[U2].photo).toBe(png(400, 300));
        expect(data.persons[B].photoSource).toEqual({ partnershipId: U2, region: square });
    });

    it('the research\'s own photos win: a portrait or couple photo it changed is not overwritten, the old source not put on it', () => {
        const previous = tree({ partnershipId: U, region: square });
        const next = fromResearch(previous);
        next.persons[A].photo = 'data:image/jpeg;base64,/9j/DDDD';
        next.partnerships[U].photo = png(640, 480);
        const { data } = carryOverMedia(next, previous);
        expect(data.persons[A].photo).toBe('data:image/jpeg;base64,/9j/DDDD');
        expect(data.persons[A].photoSource).toBeUndefined();
        expect(data.partnerships[U].photo).toBe(png(640, 480));
    });

    it('a couple the research no longer has counts as lost', () => {
        const previous = tree();
        const next = fromResearch(previous);
        next.partnerships = {};
        next.persons[A].partnerships = [];
        next.persons[B].partnerships = [];
        // The attachment of A comes along; the couple's photo has no couple to go to.
        expect(carryOverMedia(next, previous).lost).toBe(1);
    });
});

// ── A frame past the photo's edge (1123) ──

describe('a frame past the photo\'s edge', () => {
    const w = 900, h = 600;
    /** A view of the 900 × 600 photo, upright: zoom 2 is a frame of 300 page px. */
    const at = (cx: number, cy: number, zoom = 2): PortraitView => ({ cx, cy, zoom, quarterTurns: 0, angle: 0, mirror: false });
    /** 400 × 300 (tree()): the 300 px square, 120 px of it off the left edge. */
    const past = { x: -0.3, y: 0, w: 0.75, h: 1 };

    it('the photo moves under the frame past its edge; the frame\'s centre on the edge is the stop', () => {
        // A frame of 300 px on screen at zoom 2: one screen pixel is one page pixel.
        // Before, the frame stopped with its side on the edge (centre 150 px in).
        const v = panPortraitView(at(200, 300), 100, 0, 300, w, h);
        expect(v.cx).toBeCloseTo(100, 9);
        const crop = portraitCropFromView(v, w, h);
        expect(crop.region.x).toBeCloseTo(-50 / 900, 6);
        expect(crop.region.w).toBeCloseTo(300 / 900, 6);
        // Further on, the centre stops on the edge: half the frame off the photo.
        const far = panPortraitView(v, 5000, 5000, 300, w, h);
        expect(far).toMatchObject({ cx: 0, cy: 0, zoom: 2 });
        const r = portraitCropFromView(far, w, h).region;
        expect(r.x).toBeCloseTo(-150 / 900, 6);
        expect(r.y).toBeCloseTo(-0.25, 6);
        expect(panPortraitView(v, -99999, -99999, 300, w, h)).toMatchObject({ cx: 900, cy: 600 });
    });

    it('zooming without a pointer keeps the frame\'s centre, also at the edge; the range is as before', () => {
        const v = at(20, 580, 1.5);
        const zin = zoomPortraitView(v, 4, w, h);
        expect(zin).toMatchObject({ cx: 20, cy: 580, zoom: 4 });
        // Out to 100 %: the frame reaches past two edges, its centre has not moved.
        const zout = zoomPortraitView(zin, 1, w, h);
        expect(zout).toMatchObject({ cx: 20, cy: 580, zoom: 1 });
        expect(portraitCropFromView(zout, w, h).region.x).toBeLessThan(0);
        expect(zoomPortraitView(v, 99, w, h).zoom).toBe(portraitZoomRange(w, h, 0).max);
        expect(zoomPortraitView(v, 0.1, w, h).zoom).toBe(1);
    });

    it('zooming about the pointer keeps the point under it past the edge, the centre held on the photo', () => {
        const v = at(100, 300, 2);
        const under = sourcePoint(v, w, h, OUT / 2 - 100, OUT / 2);
        const z = zoomPortraitView(v, 4, w, h, { x: -100, y: 0, framePx: OUT });
        close(sourcePoint(z, w, h, OUT / 2 - 100, OUT / 2), under, 4);
        expect(portraitCropFromView(z, w, h).region.x).toBeLessThan(0);
        // Out about a point right of the centre: the centre would leave the photo; it stops on the edge.
        expect(zoomPortraitView(at(30, 300, 2), 1, w, h, { x: 120, y: 0, framePx: OUT }).cx).toBe(0);
    });

    it('the guard: the frame\'s centre never leaves the photo (also on a turned page)', () => {
        expect(clampPortraitView(at(-50, 700), w, h)).toMatchObject({ cx: 0, cy: 600 });
        // Turned once, the page is 600 × 900.
        expect(clampPortraitView({ ...at(950, -1), quarterTurns: 1 }, w, h)).toMatchObject({ cx: 600, cy: 0 });
        expect(centreInside(clampPortraitView({ ...at(-9, 9999), angle: 30 }, w, h), w, h)).toBe(true);
    });

    it('a crop past the edge and its view convert both ways; one inside the photo is kept as it was', () => {
        const crop = { region: { x: -0.1, y: 0.6, w: 1 / 3, h: 0.5 } };
        const back = portraitCropFromView(portraitViewFromCrop(crop, w, h), w, h);
        expect(back.region.x).toBeCloseTo(-0.1, 6);
        expect(back.region.y).toBeCloseTo(0.6, 6);
        expect(back.region.y + back.region.h).toBeGreaterThan(1);
        expect(clampPortraitCrop({ attachmentId: 'a', ...crop }, w, h)).toEqual({ attachmentId: 'a', ...back });
        // An older crop inside the photo, also one at the old limit when straightened: unchanged.
        const inside = { region: { x: 0.2, y: 0.1, w: 0.4, h: 0.6 } };
        expect(clampPortraitCrop(inside, w, h)).toEqual(inside);
        const limit = portraitCropFromView({ ...at(150 * minZoomForAngle(10), 300), angle: 10 }, w, h);
        expect(cornersInside(portraitViewFromCrop(limit, w, h), w, h)).toBe(true);
        expect(clampPortraitCrop(limit, w, h)).toEqual(limit);
    });

    it('the shape of a region: past the edge yes; its centre off the photo, a side over the whole, nothing: no', () => {
        expect(isPortraitRegionShape({ x: -0.5, y: -0.5, w: 1, h: 1 })).toBe(true);
        expect(isPortraitSourceShape({ attachmentId: 'a', region: { x: -0.2, y: 0.7, w: 0.4, h: 0.6 } })).toBe(true);
        expect(isPortraitSourceShape({ partnershipId: 'u', region: { x: 0.8, y: -0.3, w: 0.4, h: 0.6 } })).toBe(true);
        expect(isPortraitSourceShape({ attachmentId: 'a', region: { x: -0.21, y: 0, w: 0.4, h: 0.6 } })).toBe(false);
        expect(isPortraitSourceShape({ attachmentId: 'a', region: { x: 0.5, y: 0.71, w: 0.4, h: 0.6 } })).toBe(false);
        expect(isPortraitSourceShape({ attachmentId: 'a', region: { x: 0, y: 0, w: 1.01, h: 0.5 } })).toBe(false);
        expect(isPortraitSourceShape({ attachmentId: 'a', region: { x: 0, y: 0, w: 0, h: 0.5 } })).toBe(false);
        expect(isPortraitSourceShape({ attachmentId: 'a', region: { x: Number.NaN, y: 0, w: 0.5, h: 0.5 } })).toBe(false);
    });

    it('the neutral fill is the light card\'s empty portrait colour', () => {
        expect(PORTRAIT_EMPTY_FILL).toBe('#f0e9da');
    });

    it('a source past the edge holds on load (attachment and couple photo), also after a JSON round trip', () => {
        const d = tree({ attachmentId: 'att1', region: past, angle: 3 });
        expect(cleanPortraitSources(d)).toBe(0);
        expect(d.persons[A].photoSource).toEqual({ attachmentId: 'att1', region: past, angle: 3 });
        expect(cleanPortraitSources(tree({ partnershipId: U, region: { x: 0.5, y: -0.4, w: 0.75, h: 1 } }))).toBe(0);
        const loaded = migrateData(JSON.parse(JSON.stringify(tree({ attachmentId: 'att1', region: past }))));
        expect(loaded.persons[A].photoSource).toEqual({ attachmentId: 'att1', region: past });
    });

    it('updatePerson saves it', () => {
        load(tree());
        DataManager.updatePerson(A, { photo: PORTRAIT, photoSource: { attachmentId: 'att1', region: past } });
        expect(DataManager.getPerson(A)?.photoSource).toEqual({ attachmentId: 'att1', region: past });
    });

    it('an update from the research (a followed tree) carries it, and the tree loads with it', () => {
        const previous = tree({ attachmentId: 'att1', region: past });
        previous.persons[B].photo = PORTRAIT;
        previous.persons[B].photoSource = { partnershipId: U, region: { x: 0.5, y: -0.4, w: 0.75, h: 1 } };
        const next = structuredClone(previous);
        for (const p of Object.values(next.persons)) { delete p.photo; delete p.photoSource; }
        delete next.media;
        for (const u of Object.values(next.partnerships)) { delete u.photo; delete u.photoOriginalName; delete u.photoDate; }
        const { data } = carryOverMedia(next, previous);
        const loaded = migrateData(JSON.parse(JSON.stringify(data)));
        expect(loaded.persons[A].photoSource).toEqual({ attachmentId: 'att1', region: past });
        expect(loaded.persons[B].photoSource).toEqual({ partnershipId: U, region: { x: 0.5, y: -0.4, w: 0.75, h: 1 } });
    });
});
