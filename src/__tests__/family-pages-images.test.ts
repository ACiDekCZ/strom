/**
 * The family pages in the app's window and the tree's pooled images
 * (spec 135, D8): the window's set is built from the tree with a stand-in
 * data URL for each reference (of the image's type and size), and a page
 * drawn gets the images it shows put in, read from the pool once — never
 * the whole tree's images. All data is invented.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildPageSet } from '../family-pages.js';
import { renderPage } from '../family-pages-html.js';
import { poolStandIn, standInOf, POOL_REF } from '../image-ref.js';
import { noteImageMeta, noteOwnImages, clearImageMeta } from '../image-meta.js';
import { dataUrlImageSize, dataUrlByteSize } from '../photo.js';
import { isSafePhotoDataUrl } from '../validation.js';
import { withExifOrientation } from '../excerpts.js';
import { StorageManager } from '../storage.js';
import { treeWithStandIns, standInIds, fillStandIns, withFamilyPageImages, forgetFamilyPageImages, familyPageImageCount } from '../ui/family-pages-images.js';
import type { Person, PersonId, StromData } from '../types.js';

const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const ID = 'p:' + '3c'.repeat(20);
const ID2 = 'p:' + '7e'.repeat(20);
const NOW = new Date('2026-11-20T10:00:00Z');
const META = { len: 90_000, head: 'data:image/png;base64,', bytes: 67_000, w: 300, h: 400, token: 'img:x', mtok: 'm' };

function person(id: string, first: string, extra: Partial<Person> = {}): Person {
    return { id: id as PersonId, firstName: first, lastName: 'Šťovíčková', gender: 'female', parentIds: [], childIds: [], partnerships: [], birthDate: '1880', ...extra } as Person;
}

function tree(photo: string): StromData {
    return { persons: { ma: person('ma', 'Radomila', { photo }) }, partnerships: {} } as StromData;
}

function pages(data: StromData): string {
    const set = buildPageSet(data, { kind: 'descendants', person: 'ma' as PersonId }, { lang: 'cs', now: NOW });
    return [...set.bySlug.keys()].map(slug => renderPage(set, slug)).join('\n');
}

afterEach(() => {
    forgetFamilyPageImages();
    clearImageMeta();
    vi.restoreAllMocks();
});

describe('a pooled image\'s stand-in', () => {
    it('passes as an image of its type, names its image and orientation, and is as large as the image', () => {
        noteImageMeta({ [ID]: META });
        const s = poolStandIn(ID, 'image/png');
        expect(s.startsWith('data:image/png;base64,')).toBe(true);
        expect((s.length - s.indexOf(',') - 1) % 4).toBe(0);
        expect(isSafePhotoDataUrl(s)).toBe(true);
        expect(standInOf(s)).toEqual({ id: ID, orient: 0 });
        expect(standInOf(poolStandIn(ID, 'image/jpeg', 6))).toEqual({ id: ID, orient: 6 });
        expect(standInOf(IMG)).toBeNull();
        expect(dataUrlImageSize(s)).toEqual({ w: 300, h: 400 });
        expect(dataUrlByteSize(s)).toBe(67_000);
    });

    it('the tree with stand-ins is a copy: the tree keeps its references', () => {
        noteImageMeta({ [ID]: META });
        const data = tree(POOL_REF + ID);
        const shown = treeWithStandIns(data);
        expect(data.persons['ma' as PersonId].photo).toBe(POOL_REF + ID);
        expect(standInOf(shown.persons['ma' as PersonId].photo)).toEqual({ id: ID, orient: 0 });
        // Without references: the tree itself.
        const plain = tree(IMG);
        expect(treeWithStandIns(plain)).toBe(plain);
    });
});

describe('a page of the window', () => {
    it('shows the portrait a reference names (none without the stand-in), and only that page\'s images are read', () => {
        noteOwnImages({ [ID]: 0 });
        noteImageMeta({ [ID]: { ...META, head: 'data:image/jpeg;base64,' } });
        const withRefs = tree(POOL_REF + ID);
        // The builders take an image only as a data URL: a reference alone shows nothing.
        expect(pages(withRefs)).not.toContain('sp-portrait');
        const html = pages(treeWithStandIns(withRefs));
        expect(standInIds(html)).toEqual([ID]);
        const filled = fillStandIns(html, new Map([[ID, IMG]]));
        expect(filled).toContain(`src="${IMG}"`);
        expect(filled).not.toContain('STROMPOOL');
        // The same page as from the image itself.
        expect(filled).toBe(pages(tree(IMG)));
    });

    it('an excerpt\'s stand-in is turned by its orientation once filled; one the pool lacks becomes empty', () => {
        const text = `<img src="${poolStandIn(ID, 'image/jpeg', 6)}"><img src="${poolStandIn(ID2, 'image/jpeg')}">`;
        expect(fillStandIns(text, new Map([[ID, IMG]]))).toBe(`<img src="${withExifOrientation(IMG, 6)}"><img src="">`);
    });

    it('reads a page\'s missing images in one batch, then draws; keeps the images of the page drawn last only', async () => {
        const getMany = vi.spyOn(StorageManager, 'getMany').mockImplementation(async (_store: string, keys: string[]) =>
            new Map(keys.map(k => [k, k === ID || k === ID2 ? { text: IMG } : null])) as never);
        const page1 = `<img src="${poolStandIn(ID, 'image/jpeg')}"><img src="${poolStandIn(ID2, 'image/jpeg')}">`;
        const redraw = vi.fn();
        expect(withFamilyPageImages(page1, redraw)).toBeNull();
        await vi.waitFor(() => expect(redraw).toHaveBeenCalledTimes(1));
        expect(getMany).toHaveBeenCalledTimes(1);
        expect(getMany.mock.calls[0][1]).toEqual([ID, ID2]);
        expect(withFamilyPageImages(page1, redraw)).toBe(`<img src="${IMG}"><img src="${IMG}">`);
        const page2 = `<img src="${poolStandIn(ID, 'image/jpeg')}">`;
        expect(withFamilyPageImages(page2, redraw)).toBe(`<img src="${IMG}">`);
        expect(familyPageImageCount()).toBe(1);
        expect(withFamilyPageImages('<p>no image</p>', redraw)).toBe('<p>no image</p>');
        expect(getMany).toHaveBeenCalledTimes(1);
    });
});
