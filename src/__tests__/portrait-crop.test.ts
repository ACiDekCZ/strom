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
    computeCoverCrop, PortraitView,
} from '../photo.js';
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

    it('clamping keeps every corner on the photo at any turn, angle and mirror', () => {
        const sizes: [number, number][] = [[400, 300], [300, 1200], [150, 150], [5000, 4000]];
        for (const [w, h] of sizes) {
            for (const quarterTurns of [0, 1, 2, 3] as const) {
                for (const angle of [-45, -12.5, 0, 7, 45]) {
                    for (const mirror of [false, true]) {
                        // Too far out and too wide on purpose.
                        const view = clampPortraitView({ cx: -1000, cy: 99999, zoom: 0.2, quarterTurns, angle, mirror }, w, h);
                        expect(view.zoom).toBeGreaterThanOrEqual(minZoomForAngle(angle) - 1e-12);
                        expect(cornersInside(view, w, h)).toBe(true);
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
        expect(c.region.x + c.region.w).toBeLessThanOrEqual(1 + 1e-6);
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
        // At the edge it stops: a long drag keeps the corners on the photo.
        const far = panPortraitView(view, -99999, 0, OUT, w, h);
        expect(cornersInside(far, w, h)).toBe(true);
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
    return { id, firstName: 'Ivo', lastName: 'Brabec', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...over };
}

/** A and B a couple with a 400 × 300 photo; A has a 400 × 300 attachment; C is no partner. */
function tree(sourceA?: PortraitSource, sourceC?: PortraitSource): StromData {
    return {
        persons: {
            [A]: person(A, { partnerships: [U], photo: PORTRAIT, photoSource: sourceA, attachments: [{ id: 'att1', name: 'studio.png', mimeType: 'image/png', dataUrl: png(400, 300), sizeBytes: 33 }] }),
            [B]: person(B, { gender: 'female', partnerships: [U] }),
            [C]: person(C, { photo: PORTRAIT, photoSource: sourceC }),
        },
        partnerships: { [U]: { id: U, person1Id: A, person2Id: B, childIds: [], status: 'married', photo: png(400, 300), photoOriginalName: 'wedding.png', photoDate: '1924' } },
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
            { attachmentId: 'att1', region: { x: 0.5, y: 0, w: 0.75, h: 1 } },   // outside the image
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
        d.persons[A].attachments![0].dataUrl = 'data:image/jpeg;base64,AA==';
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
        expect(DataManager.getPerson(A)?.photoSource).toBeDefined();
        DataManager.updatePartnership(U, { photo: '' });
        const union = DataManager.getData().partnerships[U];
        expect(union.photo).toBeUndefined();
        expect(union.photoOriginalName).toBeUndefined();
        expect(union.photoDate).toBeUndefined();
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
