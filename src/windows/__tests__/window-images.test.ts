/**
 * The tree's images go to a satellite as references to the main window's own
 * strings (1122): the windows share one heap, so an image is held once.
 */
import { describe, it, expect } from 'vitest';
import { findImageSource, IMAGE_KEEP_MS, IMAGE_REF_MIN_LENGTH, IMAGE_REF_PREFIX, IMAGE_SOURCE_KEY, publishImageSource, restoreImages, WindowImageStore } from '../window-images.js';

const image = (fill: string) => 'data:image/jpeg;base64,' + fill.repeat(IMAGE_REF_MIN_LENGTH);

describe('WindowImageStore', () => {
    it('replaces long data URLs anywhere in the data, leaves the rest; the same content keeps its number', () => {
        const store = new WindowImageStore(() => 0);
        const a = image('A');
        const b = image('B');
        const data = { persons: { p1: { photo: a, firstName: 'Bořivoj', icon: 'data:image/png;base64,AAAA' } }, sources: [{ excerpts: [{ dataUrl: b }, { dataUrl: a }] }] };
        const out = store.replaceImages(data);
        expect(out.persons.p1.photo).toBe(IMAGE_REF_PREFIX + '1');
        expect(out.persons.p1.firstName).toBe('Bořivoj');
        expect(out.persons.p1.icon).toBe('data:image/png;base64,AAAA');
        expect(out.sources[0].excerpts.map(e => e.dataUrl)).toEqual([IMAGE_REF_PREFIX + '2', IMAGE_REF_PREFIX + '1']);
        // A new version brings a new string of the same content: same number, the newest string.
        const again = (a + ' ').slice(0, -1);
        const out2 = store.replaceImages({ photo: again });
        expect(out2.photo).toBe(IMAGE_REF_PREFIX + '1');
        expect(store.get(1)).toBe(again);
    });

    it('an image no longer in the tree is let go after a while, not at once', () => {
        let now = 0;
        const store = new WindowImageStore(() => now);
        store.replaceImages({ a: image('A'), b: image('B') });
        now = 1000;
        store.replaceImages({ a: image('A') });
        expect(store.get(2)).toBe(image('B'));
        now = 1000 + IMAGE_KEEP_MS + 1;
        store.replaceImages({ a: image('A') });
        expect(store.get(2)).toBeUndefined();
        expect(store.get(1)).toBe(image('A'));
        expect(store.size).toBe(1);
    });
});

describe('restoreImages', () => {
    it('puts the strings back in place; false when one is not known', () => {
        const store = new WindowImageStore(() => 0);
        const a = image('A');
        const sent = store.replaceImages({ persons: { p1: { photo: a } }, list: [a, 'x'] });
        const copy = structuredClone(sent);
        expect(restoreImages(copy, id => store.get(id))).toBe(true);
        expect(copy).toEqual({ persons: { p1: { photo: a } }, list: [a, 'x'] });
        expect(restoreImages({ photo: IMAGE_REF_PREFIX + '99' }, id => store.get(id))).toBe(false);
    });
});

describe('findImageSource', () => {
    it('finds the main window through the opener, also through a satellite that opened this one', () => {
        const store = new WindowImageStore(() => 0);
        const a = image('A');
        store.replaceImages({ a });
        const main = { closed: false, opener: null } as Record<string, unknown>;
        publishImageSource(store, main);
        const satellite = { closed: false, opener: main };
        expect(findImageSource({ opener: main })!(1)).toBe(a);
        expect(findImageSource({ opener: satellite })!(1)).toBe(a);
        expect(findImageSource({ opener: null })).toBeNull();
        expect(findImageSource({ opener: { closed: false, opener: null } })).toBeNull();
    });

    it('reads the main window\'s images at every look-up (its reload publishes new ones); nothing from a closed one', () => {
        const main = { closed: false, opener: null } as Record<string, unknown>;
        main[IMAGE_SOURCE_KEY] = () => 'first';
        const lookup = findImageSource({ opener: main })!;
        expect(lookup(1)).toBe('first');
        main[IMAGE_SOURCE_KEY] = () => 'second';
        expect(lookup(1)).toBe('second');
        main.closed = true;
        expect(lookup(1)).toBeUndefined();
    });

    it('a window it may not read (another origin) is no source', () => {
        const foreign = new Proxy({}, { get: () => { throw new Error('SecurityError'); } });
        expect(findImageSource({ opener: foreign })).toBeNull();
    });
});
