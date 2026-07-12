/**
 * Photo helper tests (pure logic; canvas-based compressPhoto is browser-only).
 */

import { describe, it, expect } from 'vitest';
import { computeCoverCrop, dataUrlByteSize, totalPhotoBytes, stripPhotos } from '../photo.js';
import { applyLivingPrivacy } from '../privacy.js';
import { StromData, Person, PersonId, PartnershipId } from '../types.js';

function person(id: string, over: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: 'Jan', lastName: 'Novák', gender: 'male',
        isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...over,
    };
}
function tree(...persons: Person[]): StromData {
    const map: StromData['persons'] = {};
    for (const p of persons) map[p.id] = p;
    return { persons: map, partnerships: {} as Record<PartnershipId, never> };
}

// A tiny 1x1 JPEG data URL.
const DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD';

describe('computeCoverCrop', () => {
    it('landscape: centered square of the shorter side', () => {
        expect(computeCoverCrop(400, 300)).toEqual({ sx: 50, sy: 0, size: 300 });
    });
    it('portrait: centered square of the shorter side', () => {
        expect(computeCoverCrop(300, 400)).toEqual({ sx: 0, sy: 50, size: 300 });
    });
    it('already square: no offset', () => {
        expect(computeCoverCrop(256, 256)).toEqual({ sx: 0, sy: 0, size: 256 });
    });
    it('rounds odd offsets', () => {
        expect(computeCoverCrop(101, 100)).toEqual({ sx: 1, sy: 0, size: 100 });
    });
});

describe('dataUrlByteSize', () => {
    it('estimates the base64 payload size', () => {
        // 32 base64 chars, no padding -> 24 bytes
        expect(dataUrlByteSize(DATA_URL)).toBe(24);
    });
});

describe('totalPhotoBytes', () => {
    it('sums photo sizes across persons', () => {
        const data = tree(person('a', { photo: DATA_URL }), person('b'), person('c', { photo: DATA_URL }));
        expect(totalPhotoBytes(data)).toBe(48);
    });
    it('is zero with no photos', () => {
        expect(totalPhotoBytes(tree(person('a')))).toBe(0);
    });
});

describe('stripPhotos', () => {
    it('removes photos on a deep copy without touching the original', () => {
        const data = tree(person('a', { photo: DATA_URL, photoOriginalName: 'me.jpg' }));
        const out = stripPhotos(data);
        expect(out.persons['a' as PersonId].photo).toBeUndefined();
        expect(out.persons['a' as PersonId].photoOriginalName).toBeUndefined();
        expect(data.persons['a' as PersonId].photo).toBe(DATA_URL);
    });
});

describe('privacy strips photos of living persons', () => {
    it('removes the photo in initials/anonymous/minimal but keeps it in full', () => {
        const living = person('a', { photo: DATA_URL, birthDate: '1990' });
        for (const mode of ['initials', 'anonymous', 'minimal'] as const) {
            const out = applyLivingPrivacy(tree(living), mode, 2026);
            expect(out.persons['a' as PersonId].photo).toBeUndefined();
        }
        const full = applyLivingPrivacy(tree(living), 'full', 2026);
        expect(full.persons['a' as PersonId].photo).toBe(DATA_URL);
    });
});
