/**
 * The places that show the tree's images take a pooled image's reference
 * (`\u0000sm:<id>`) as well as a data URL, and look the same with either
 * (spec 135, part D3): the card's avatar and tooltip, a small portrait (the
 * slideshow), the fan's portraits, the table's couple's photo, a photo
 * coming in place (setImgState). A reference is written as the placeholder
 * with `data-pool-ref`, filled from the pool on screen; the resolver makes an
 * object URL or a Blob only of a raster image or a PDF, and one the pool does
 * not have gives nothing. StorageManager is an in-memory Map; data invented.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveObjectURL } from 'node:buffer';

const media = new Map<string, unknown>();

vi.mock('../storage.js', () => ({
    StorageManager: {
        async init() {},
        async get<T>(store: string, key: string): Promise<T | null> {
            return store === 'media' ? structuredClone((media.get(key) as T) ?? null) : null;
        },
        async set() {},
        async setTogether() {},
        async keys(store: string): Promise<string[]> { return store === 'media' ? [...media.keys()] : []; },
        async getAll(): Promise<unknown[]> { return []; },
        async getMany<T>(store: string, keys: string[]): Promise<Map<string, T | null>> {
            return new Map(keys.map(k => [k, store === 'media' ? structuredClone((media.get(k) as T) ?? null) : null]));
        },
        async delete() {},
        async flush() {},
    },
}));

import { POOL_REF, imageAddrAttr, IMAGE_PLACEHOLDER, POOL_REF_ATTR } from '../image-ref.js';
import {
    imageUrl, imageUrlNow, imageBlob, imgSrcAttr, releaseImageUrls, setImageSource, showsImage, sameImgSource,
    isShownImageType, setImageCacheLimits, imageCacheStats, startImageHydrator, stopImageHydrator,
} from '../image-src.js';
import { cardAvatarHtml, cardImageView, cardTooltipPhotoHtml, setImgState, smallPortraitHtml } from '../ui/image-slot.js';
import { slideshowPhotoHtml } from '../ui/slideshow.js';
import { fanPhotoPortrait } from '../ui/fan-view.js';
import { thumbHtml } from '../ui/table-view/table-grid.js';
import { columnById, thumbCell } from '../ui/table-view/table-columns.js';
import type { Person } from '../types.js';

/** Seeded bytes (repeatable). */
function noise(seed: number, n: number): Uint8Array {
    const bytes = new Uint8Array(n);
    let x = seed * 2654435761 >>> 0;
    for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; bytes[i] = x >>> 24; }
    return bytes;
}

/** Put an image into the pool as the pool stores one (`{head, bytes}`); its reference. */
function pooled(seed: number, head = 'data:image/png;base64,'): string {
    const id = 'p:' + (seed.toString(16).padStart(2, '0')).repeat(20);
    const bytes = noise(seed, 2000);
    media.set(id, { head, bytes: bytes.buffer });
    return POOL_REF + id;
}

const DATA = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const MISSING = POOL_REF + 'p:' + '0'.repeat(40);
const idOf = (ref: string) => ref.slice(POOL_REF.length);

beforeEach(() => media.clear());
afterEach(() => { releaseImageUrls(); setImageCacheLimits(); });

// ==================== A MINIMAL DOM ====================

class FakeEl {
    attrs = new Map<string, string>();
    classes = new Set<string>();
    children: FakeEl[] = [];
    constructor(readonly tagName: string, readonly ownerDocument: FakeDoc) {}
    getAttribute(n: string): string | null { return this.attrs.get(n) ?? null; }
    setAttribute(n: string, v: string): void { this.attrs.set(n, v); }
    removeAttribute(n: string): void { this.attrs.delete(n); }
    hasAttribute(n: string): boolean { return this.attrs.has(n); }
    querySelector(sel: string): FakeEl | null { return sel === 'img' ? this.children.find(c => c.tagName === 'IMG') ?? null : null; }
    replaceChildren(...els: FakeEl[]): void { this.children = els; }
    classList = {
        add: (c: string) => { this.classes.add(c); },
        remove: (c: string) => { this.classes.delete(c); },
        contains: (c: string) => this.classes.has(c),
    };
    style = { setProperty: () => {} };
}

/** No observers: the hydrator does not start here (what is set is what the helpers set). */
class FakeDoc {
    defaultView = {
        matchMedia: () => ({ matches: true }),   // reduced motion: no fade to wait for
        requestAnimationFrame: () => 0,
    };
    createElement(tag: string): FakeEl { return new FakeEl(tag.toUpperCase(), this); }
}

const asEl = (x: FakeEl) => x as unknown as HTMLElement;

// ==================== the resolver ====================

describe('the resolver: only a raster image or a PDF', () => {
    it('the types it shows', () => {
        for (const t of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'IMAGE/PNG']) expect(isShownImageType(t), t).toBe(true);
        for (const t of ['image/svg+xml', 'text/html', 'application/javascript', '', 'application/octet-stream']) expect(isShownImageType(t), t).toBe(false);
    });

    it('a pooled image of another type gives no object URL and no Blob', async () => {
        const svg = pooled(7, 'data:image/svg+xml;base64,');
        const html = pooled(8, 'data:text/html;base64,');
        expect(await imageUrl(svg)).toBe('');
        expect(await imageUrl(html)).toBe('');
        expect(imageUrlNow(svg)).toBe('');
        expect(await imageBlob(svg)).toBeNull();
        expect(await imageBlob(html)).toBeNull();
        // A PDF is handed on (a file), a PNG shown.
        const pdf = pooled(9, 'data:application/pdf;base64,');
        expect((await imageBlob(pdf))?.type).toBe('application/pdf');
        expect((await imageUrl(pooled(10))).startsWith('blob:')).toBe(true);
    });

    it('a reference the pool does not have gives nothing, without an error', async () => {
        expect(await imageUrl(MISSING)).toBe('');
        expect(await imageBlob(MISSING)).toBeNull();
    });
});

// ==================== HTML text ====================

describe('HTML text: a reference as the placeholder with its id', () => {
    it('imageAddrAttr: src or href, the address as it is or the placeholder', () => {
        const ref = pooled(1);
        expect(imageAddrAttr(DATA)).toBe(`src="${DATA}"`);
        expect(imageAddrAttr(DATA, 'href')).toBe(`href="${DATA}"`);
        expect(imageAddrAttr(ref, 'href')).toBe(`href="${IMAGE_PLACEHOLDER}" ${POOL_REF_ATTR}="${idOf(ref)}"`);
        // Not exactly a reference: text, escaped.
        expect(imageAddrAttr(ref + 'x')).toBe(`src="${ref}x"`);
    });

    it('the card: avatar and tooltip with a reference, the same markup as a data URL otherwise', () => {
        const ref = pooled(2);
        const view = cardImageView('none', true);
        const avatar = cardAvatarHtml(view, ref, 'AB', undefined, '0ms');
        expect(avatar).toBe(`<div class="card-avatar"><img src="${IMAGE_PLACEHOLDER}" ${POOL_REF_ATTR}="${idOf(ref)}" alt=""></div>`);
        expect(cardAvatarHtml(view, DATA, 'AB', undefined, '0ms')).toBe(`<div class="card-avatar"><img src="${DATA}" alt=""></div>`);
        expect(cardTooltipPhotoHtml(view, ref, 'AB')).toBe(`<img class="tt-photo" src="${IMAGE_PLACEHOLDER}" ${POOL_REF_ATTR}="${idOf(ref)}" alt="">`);
    });

    it('a small portrait and the slideshow take a reference as a photo', () => {
        const ref = pooled(3);
        const small = smallPortraitHtml('x-pic', ref, 'AB', 'none');
        expect(small).toContain(`${POOL_REF_ATTR}="${idOf(ref)}"`);
        expect(small).not.toContain('avatar-initials');
        expect(smallPortraitHtml('x-pic', ref, 'AB', 'refresh')).toContain(`data-img-state="refresh" aria-hidden="true"><img src="${IMAGE_PLACEHOLDER}" ${POOL_REF_ATTR}=`);
        const slide = slideshowPhotoHtml({ firstName: 'Ottokar', lastName: 'Brzobohatý', photo: ref }, 'none');
        expect(slide).toContain(`${POOL_REF_ATTR}="${idOf(ref)}"`);
        // Something that only starts like one is no photo.
        expect(smallPortraitHtml('x-pic', ref + 'x', 'AB', 'none')).toBe('');
    });

    it('the fan: a reference is the person\'s portrait', () => {
        const ref = pooled(4);
        const p = { id: 'p1', firstName: 'Ottokar', lastName: 'Brzobohatý', photo: ref } as unknown as Person;
        expect(fanPhotoPortrait(p)).toEqual({ href: ref });
        expect(fanPhotoPortrait(p, false)).toEqual({ href: ref });
    });

    it('the table: a reference goes by its id, no object URL of the table\'s own', () => {
        const ref = pooled(5);
        const col = columnById('unions', 'uPhoto')!;
        const spy = vi.spyOn(URL, 'createObjectURL');
        try {
            const html = thumbHtml(thumbCell(ref), col);
            expect(html).toContain(`<img src="${IMAGE_PLACEHOLDER}" ${POOL_REF_ATTR}="${idOf(ref)}" loading="lazy"`);
            expect(spy).not.toHaveBeenCalled();
            // A data URL as before: an object URL of the table's own.
            expect(thumbHtml(thumbCell(DATA), col)).toMatch(/<img src="blob:/);
            expect(spy).toHaveBeenCalledTimes(1);
        } finally {
            spy.mockRestore();
        }
    });
});

// ==================== elements ====================

describe('elements: setImageSource, showsImage, sameImgSource', () => {
    it('a reference not at hand: the placeholder and its id; at hand: its object URL at once', async () => {
        const doc = new FakeDoc();
        const ref = pooled(6);
        const a = doc.createElement('img');
        setImageSource(a as unknown as Element, ref);
        expect(a.getAttribute('src')).toBe(IMAGE_PLACEHOLDER);
        expect(a.getAttribute(POOL_REF_ATTR)).toBe(idOf(ref));
        const url = await imageUrl(ref);
        const b = doc.createElement('img');
        setImageSource(b as unknown as Element, ref);
        expect(b.getAttribute('src')).toBe(url);
        // The same image whatever each shows now.
        expect(showsImage(a as unknown as Element, ref)).toBe(true);
        expect(sameImgSource(a as unknown as Element, b as unknown as Element)).toBe(true);
        // Back to a data URL: the id goes.
        setImageSource(a as unknown as Element, DATA);
        expect(a.hasAttribute(POOL_REF_ATTR)).toBe(false);
        expect(showsImage(a as unknown as Element, DATA)).toBe(true);
        expect(showsImage(a as unknown as Element, ref)).toBe(false);
        expect(sameImgSource(a as unknown as Element, b as unknown as Element)).toBe(false);
    });
});

describe('setImgState: a photo that came as a reference', () => {
    it('waits for the image, then puts it in with its id; the same image again changes nothing', async () => {
        const doc = new FakeDoc();
        const host = doc.createElement('div');
        host.setAttribute('data-img-state', 'loading');
        const ref = pooled(11);
        setImgState(asEl(host), 'loaded', ref);
        // Not read yet: what the host shows stays (its veil), nothing half-drawn.
        expect(host.children).toHaveLength(0);
        expect(host.getAttribute('data-img-state')).toBe('loading');
        await vi.waitFor(() => expect(host.children).toHaveLength(1));
        const img = host.children[0];
        expect(img.getAttribute(POOL_REF_ATTR)).toBe(idOf(ref));
        expect(img.getAttribute('src')).toBe(imageUrlNow(ref));
        expect(resolveObjectURL(img.getAttribute('src')!)?.type).toBe('image/png');
        expect(host.getAttribute('data-img-state')).toBe('loaded');
        // Again with the same reference (an in-place update): kept, the state taken off.
        setImgState(asEl(host), 'loaded', ref);
        expect(host.children[0]).toBe(img);
        expect(host.hasAttribute('data-img-state')).toBe(false);
    });

    it('a reference the pool does not give: the state taken off, the content left', async () => {
        const doc = new FakeDoc();
        const host = doc.createElement('div');
        host.setAttribute('data-img-state', 'loading');
        const initials = doc.createElement('span');
        host.children.push(initials);
        setImgState(asEl(host), 'loaded', MISSING);
        await vi.waitFor(() => expect(host.hasAttribute('data-img-state')).toBe(false));
        expect(host.children).toEqual([initials]);
    });

    it('a data URL as before: in at once', () => {
        const doc = new FakeDoc();
        const host = doc.createElement('div');
        setImgState(asEl(host), 'loaded', DATA);
        expect(host.children[0].getAttribute('src')).toBe(DATA);
        expect(host.children[0].hasAttribute(POOL_REF_ATTR)).toBe(false);
    });
});

describe('imgSrcAttr', () => {
    it('is the address attribute of image-ref (no document here: nothing started)', () => {
        const ref = pooled(12);
        expect(imgSrcAttr(ref)).toBe(imageAddrAttr(ref));
        expect(imgSrcAttr(DATA)).toBe(imageAddrAttr(DATA));
    });
});

// ==================== the hydrator and the cache ====================

describe('the hydrator: images on screen stay, off screen they go', () => {
    /** An element the hydrator watches: attributes only. */
    class WatchedEl {
        nodeType = 1;
        tagName = 'IMG';
        attrs = new Map<string, string>();
        constructor(ref: string) { this.attrs.set('src', IMAGE_PLACEHOLDER); this.attrs.set(POOL_REF_ATTR, idOf(ref)); }
        getAttribute(k: string) { return this.attrs.get(k) ?? null; }
        setAttribute(k: string, v: string) { this.attrs.set(k, v); }
        hasAttribute(k: string) { return this.attrs.has(k); }
        querySelectorAll() { return [] as WatchedEl[]; }
    }

    function hydrated(els: WatchedEl[]): { doc: Document; show: (el: WatchedEl, on: boolean) => void } {
        let io: ((entries: { target: WatchedEl; isIntersecting: boolean }[]) => void) | null = null;
        class FakeIO {
            constructor(cb: typeof io) { io = cb; }
            observe() {}
            unobserve() {}
            disconnect() {}
        }
        class FakeMO { observe() {} disconnect() {} }
        const root = { nodeType: 1, tagName: 'HTML', hasAttribute: () => false, querySelectorAll: () => els };
        const doc = {
            documentElement: root,
            defaultView: { MutationObserver: FakeMO, IntersectionObserver: FakeIO },
            addEventListener() {}, removeEventListener() {},
        } as unknown as Document;
        startImageHydrator(doc);
        return { doc, show: (el, on) => io!([{ target: el, isIntersecting: on }]) };
    }

    it('more on screen than the cache allows: all kept (no reading again and again); off screen: let go to the bound', async () => {
        const refs = [pooled(21), pooled(22), pooled(23)];
        const els = refs.map(r => new WatchedEl(r));
        setImageCacheLimits(64 * 1024 * 1024, 1);
        const { doc, show } = hydrated(els);
        try {
            for (const el of els) show(el, true);
            await vi.waitFor(() => { for (const el of els) expect(el.getAttribute('src')!.startsWith('blob:')).toBe(true); });
            // Over the bound of one, as all three are on screen; every URL still valid.
            expect(imageCacheStats().count).toBe(3);
            for (const el of els) expect(resolveObjectURL(el.getAttribute('src')!)).toBeDefined();
            // Two scrolled away: their URLs revoked, their elements back to the placeholder.
            const gone = [els[0].getAttribute('src')!, els[1].getAttribute('src')!];
            show(els[0], false);
            show(els[1], false);
            await vi.waitFor(() => expect(imageCacheStats().count).toBe(1));
            for (const u of gone) expect(resolveObjectURL(u)).toBeUndefined();
            expect(els[0].getAttribute('src')).toBe(IMAGE_PLACEHOLDER);
            expect(els[1].getAttribute('src')).toBe(IMAGE_PLACEHOLDER);
            expect(imageUrlNow(refs[2])).toBe(els[2].getAttribute('src'));
            // Back on screen: read anew.
            show(els[0], true);
            await vi.waitFor(() => expect(els[0].getAttribute('src')!.startsWith('blob:')).toBe(true));
        } finally {
            stopImageHydrator(doc);
        }
    });

    it('one image in two places (a card and its tooltip): the one off screen gets it as well, read once', async () => {
        const ref = pooled(24);
        const card = new WatchedEl(ref);
        const tooltip = new WatchedEl(ref);
        const { doc, show } = hydrated([card, tooltip]);
        try {
            show(card, true);
            await vi.waitFor(() => expect(card.getAttribute('src')!.startsWith('blob:')).toBe(true));
            expect(tooltip.getAttribute('src')).toBe(card.getAttribute('src'));
        } finally {
            stopImageHydrator(doc);
        }
    });
});
