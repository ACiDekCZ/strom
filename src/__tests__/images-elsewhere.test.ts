/**
 * Spec 116 §5 (U4d1): the other places that show the tree's images while
 * they come — the slideshow, the research's changes, a merge conflict, the
 * person page and the family pages in the app's window — and the counts that
 * depend on images. A file and print never carry a state.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { smallPortraitHtml, pageImageWait } from '../ui/image-slot.js';
import { changePicHtml } from '../ui/research-changes-ui.js';
import { conflictPhotoHtml } from '../merge/ui.js';
import { slideshowPhotoHtml } from '../ui/slideshow.js';
import {
    preparePersonPageData, buildPersonPageBody, buildPersonPageDocument, PERSON_PAGE_ALL_GROUPS,
    type PersonPageOptions, type PageImageWait,
} from '../person-page.js';
import { buildPageSet } from '../family-pages.js';
import { renderPage } from '../family-pages-html.js';
import { PERSON_PAGE_CSS, PERSON_PAGE_WAIT_CSS, personPageFileCss } from '../person-page-css.js';
import { FAMILY_PAGES_APP_CSS } from '../family-pages-css.js';
import { pendingImageUrl, pendingImageOf, sha256Hex } from '../research-image-refs.js';
import { resetImageLoads, startImageLoad, type ImageLoadDeps, type PendingImage } from '../image-loads.js';
import { totalPhotoBytes, dataUrlByteSize } from '../photo.js';
import { personMedia } from '../attachments.js';
import { diffValues } from '../research-changes.js';
import { getStringsForLang, strings } from '../strings.js';
import type { Gender, Partnership, PartnershipId, Person, PersonId, StromData } from '../types.js';

const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const NOW = new Date('2026-11-20T10:00:00Z');
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const WAIT_A = pendingImageUrl({ sha: SHA_A, mime: 'image/jpeg', bytes: 52_000 });
const WAIT_B = pendingImageUrl({ sha: SHA_B, mime: 'image/jpeg', bytes: 81_000 });
const WAIT_C = pendingImageUrl({ sha: SHA_C, mime: 'image/png', bytes: 7_000 });
const cs = getStringsForLang('cs');

afterEach(() => resetImageLoads());

function person(id: string, first: string, last: string, gender: Gender, extra: Partial<Person> = {}): Person {
    return { id: id as PersonId, firstName: first, lastName: last, gender, parentIds: [], childIds: [], partnerships: [], ...extra } as Person;
}

/** Bohumil (portrait on its way) and Ludmila (a photo), married, with a couple's photo and a crop on their way. */
function tree(o: { portrait?: string; couple?: string; crop?: string } = {}): StromData {
    const u = 'u1' as PartnershipId;
    return {
        persons: {
            bo: person('bo', 'Bohumil', 'Křepelka', 'male', { birthDate: '1871', deathDate: '1931', partnerships: [u], photo: o.portrait ?? WAIT_A, sourceIds: ['s1'], childIds: ['ji' as PersonId] }),
            lu: person('lu', 'Ludmila', 'Pěnkavová', 'female', { birthDate: '1875', deathDate: '1940', partnerships: [u], photo: IMG, childIds: ['ji' as PersonId] }),
            ji: person('ji', 'Jiřina', 'Křepelková', 'female', { birthDate: '1899', deathDate: '1970', parentIds: ['bo', 'lu'] as PersonId[] }),
        },
        partnerships: {
            u1: { id: u, person1Id: 'bo' as PersonId, person2Id: 'lu' as PersonId, status: 'married', childIds: ['ji' as PersonId], startDate: '1897', photo: o.couple ?? WAIT_B, sourceIds: ['s2'] } as Partnership,
        },
        sources: {
            s1: { id: 's1', title: 'Matrika narozených Lipník 1860–1880', excerpts: [{ id: 'x1', dataUrl: o.crop ?? WAIT_C, width: 400, height: 100, sizeBytes: 7_000 }] },
            s2: { id: 's2', title: 'Matrika oddaných Lipník', excerpts: [{ id: 'x2', dataUrl: o.crop ?? WAIT_C, width: 400, height: 100, sizeBytes: 7_000 }] },
        },
    } as StromData;
}

/** What the app's window answers for the tree's images: the portrait and the crop on their way, the couple's photo did not come. */
const wait = (src: string, key?: string): PageImageWait => {
    const sha = pendingImageOf(src)?.sha;
    if (sha === SHA_A) return { state: 'loading', w: 300, h: 400 };
    if (sha === SHA_B) return { state: 'failed' };
    if (sha === SHA_C) return { state: 'loading', w: 400, h: 100 };
    return { state: key === 'person:lu:photo' ? 'refresh' : 'none' };
};

function opts(o: Partial<PersonPageOptions> = {}): PersonPageOptions {
    return {
        personId: 'bo' as PersonId, lang: 'cs', mode: 'app', links: 'app', groups: { ...PERSON_PAGE_ALL_GROUPS },
        privacy: 'full', toggles: { history: true, childEvents: true }, research: false, now: NOW, ...o,
    };
}
const page = (data: StromData, o: Partial<PersonPageOptions> = {}): string => {
    const op = opts(o);
    return buildPersonPageBody(preparePersonPageData(data, op), op);
};

describe('a small portrait of a list or a dialog (smallPortraitHtml)', () => {
    it('the photo; while it comes the initials under the veil; one that did not come the initials, calm, with its title', () => {
        expect(smallPortraitHtml('x', IMG, 'BK', 'none')).toBe(`<img class="x" src="${IMG}" alt="" aria-hidden="true">`);
        const loading = smallPortraitHtml('x', undefined, 'BK', 'loading');
        expect(loading).toContain('data-img-state="loading"');
        expect(loading).toContain('<span class="avatar-initials">BK</span>');
        expect(loading).not.toContain('<img');
        const failed = smallPortraitHtml('x', undefined, 'BK', 'failed', 'Fotka se nenačetla.');
        expect(failed).not.toContain('data-img-state');
        expect(failed).toContain('title="Fotka se nenačetla."');
        expect(failed).toContain('BK');
        // An older photo while a newer one comes: the photo under the veil.
        const refresh = smallPortraitHtml('x', IMG, 'BK', 'refresh');
        expect(refresh).toContain('data-img-state="refresh"');
        expect(refresh).toContain(`<img src="${IMG}"`);
        // A stand-in is never an <img>; without a photo and without one coming: nothing.
        expect(smallPortraitHtml('x', WAIT_A, 'BK', 'loading')).not.toContain('<img');
        expect(smallPortraitHtml('x', undefined, 'BK', 'none')).toBe('');
    });
});

describe('the slideshow, the research changes, a merge conflict (spec 116 §5)', () => {
    const bo = { firstName: 'Bohumil', lastName: 'Křepelka' };

    it('slideshow: the block as an avatar with initials while it comes; none when it did not come', () => {
        const loading = slideshowPhotoHtml({ ...bo, photo: undefined }, 'loading');
        expect(loading).toMatch(/^<div class="slideshow-photo"><span class="slideshow-pic img-slot-pic is-initials" data-img-state="loading"/);
        expect(loading).toContain('>BK<');
        expect(slideshowPhotoHtml({ ...bo, photo: undefined }, 'failed')).toBe('');
        expect(slideshowPhotoHtml({ ...bo, photo: undefined }, 'none')).toBe('');
        expect(slideshowPhotoHtml({ ...bo, photo: IMG }, 'none')).toContain(`src="${IMG}"`);
    });

    it('research changes: a 30 px avatar with initials while it comes, the initials when it did not', () => {
        const loading = changePicHtml({ ...bo, photo: undefined }, 'loading');
        expect(loading).toContain('class="research-changes-pic img-slot-pic is-initials"');
        expect(loading).toContain('data-img-state="loading"');
        const failed = changePicHtml({ ...bo, photo: undefined }, 'failed');
        expect(failed).toContain('>BK<');
        expect(failed).not.toContain('data-img-state');
        expect(changePicHtml({ ...bo, photo: IMG }, 'none')).toContain('<img class="research-changes-pic"');
        expect(changePicHtml({ ...bo, photo: undefined }, 'none')).toBe('');
    });

    it('merge conflict: the avatar while it comes, the initials with the title when it did not; a stand-in never an <img>', () => {
        const loading = conflictPhotoHtml(undefined, 'BK', 'loading');
        expect(loading).toContain('class="conflict-photo img-slot-pic is-initials"');
        expect(loading).toContain('data-img-state="loading"');
        const failed = conflictPhotoHtml(undefined, 'BK', 'failed');
        expect(failed).toContain(`title="${strings.photos.failed}"`);
        expect(failed).not.toContain('data-img-state');
        expect(failed).toContain('>BK<');
        expect(conflictPhotoHtml(WAIT_A, 'BK', 'none')).not.toContain('<img');
        expect(conflictPhotoHtml(IMG, 'BK', 'none')).toContain('<img class="conflict-photo"');
        expect(conflictPhotoHtml(undefined, 'BK', 'none')).toBe('—');
    });
});

describe('the person page in the app\'s window (spec 116 §5)', () => {
    it('the portrait on its way: the initials in the photo\'s 128 px square under the veil, no zoom', () => {
        const html = page(tree(), { imageWait: wait });
        expect(html).toContain('<span class="pp-portrait pp-portrait--wait" data-img-state="loading"');
        expect(html).toContain('<span class="pp-initials-text" aria-hidden="true">BK</span>');
        expect(html).not.toContain(`src="${WAIT_A}"`);
        expect(html).not.toContain('data-pp-img-retry');
    });

    it('the portrait that did not come: the same square, calm, without the zoom, Try again under it (the window only)', () => {
        const html = page(tree(), { imageWait: (src, key) => pendingImageOf(src)?.sha === SHA_A ? { state: 'failed' } : wait(src, key) });
        expect(html).toContain('<div class="pp-portrait-col"><span class="pp-portrait pp-portrait--wait" role="img"');
        expect(html).toContain(`<span>${cs.photos.failed}</span>`);
        expect(html).toContain(`data-pp-img-retry="person:bo:photo">${cs.busy.retry}</button>`);
        const hero = html.slice(html.indexOf('<header class="pp-hero'), html.indexOf('</header>'));
        expect(hero).not.toContain('⤢');
    });

    it('a stored portrait while a newer one comes: the photo under the refresh veil', () => {
        const html = page(tree(), { personId: 'lu' as PersonId, imageWait: wait });
        expect(html).toMatch(/<button type="button" class="pp-portrait" data-img-state="refresh" data-pp-zoom/);
    });

    it('the gallery and the figures: a tile with the glyph while it comes, crossed out with "Not loaded" when it did not, never the stand-in', () => {
        const html = page(tree(), { imageWait: wait });
        // The couple's photo did not come: a tile with image-off and the note.
        expect(html).toMatch(/<span class="pp-gal-thumb pp-img-wait" data-img-state="failed" role="img" aria-label="[^"]+">/);
        expect(html).toContain(`<span class="img-slot-note">${cs.photos.tileFailed}</span>`);
        // The crop on its way: a tile in its own ratio under the veil.
        expect(html).toMatch(/class="pp-[a-z-]+ pp-img-wait" data-img-state="loading" style="--pp-ar:400 \/ 100"/);
        for (const w of [WAIT_A, WAIT_B, WAIT_C]) expect(html).not.toContain(w);
    });

    it('a file and print have no state, no Try again (and the window\'s CSS of states is not the file\'s)', () => {
        const op = opts({ mode: 'file', links: 'plain' });
        const file = buildPersonPageDocument(preparePersonPageData(tree({ portrait: IMG, couple: IMG, crop: IMG }), op), op);
        expect(file).not.toContain('data-img-state');
        expect(file).not.toContain('pp-img-wait');
        expect(file).not.toContain('busy-msg');
        expect(personPageFileCss()).not.toContain('pp-portrait--wait');
        expect(PERSON_PAGE_CSS).not.toContain('pp-portrait--wait');
        expect(PERSON_PAGE_WAIT_CSS).toContain('.pp-portrait--wait');
        // The window without a load: as before.
        expect(page(tree({ portrait: IMG, couple: IMG, crop: IMG }))).not.toContain('pp-img-wait');
    });

    it('the materials count the images on their way', () => {
        const html = page(tree(), { imageWait: wait });
        expect(html).toMatch(/<span class="pp-count">[1-9]/);
    });
});

describe('the family pages in the app\'s window (spec 116 §5)', () => {
    const all = (data: StromData, withWait: boolean): string => {
        const set = buildPageSet(data, { kind: 'descendants', person: 'bo' as PersonId }, { lang: 'cs', now: NOW, ...(withWait ? { imageWait: wait } : {}) });
        return [...set.bySlug.keys()].map(slug => renderPage(set, slug)).join('\n');
    };

    it('a portrait on its way: the 64×80 place with the glyph under the veil; the couple\'s crop: a tile', () => {
        const html = all(tree(), true);
        expect(html).toMatch(/<span class="sp-portrait sp-img-wait" data-img-state="loading"[^>]*><span class="img-slot-glyph"><svg[^>]*width="18"/);
        expect(html).toMatch(/<span class="sp-clip-img sp-img-wait" data-img-state="loading" style="--pp-ar:400 \/ 100"/);
        for (const w of [WAIT_A, WAIT_C]) expect(html).not.toContain(`src="${w}"`);
        expect(FAMILY_PAGES_APP_CSS).toContain('.sp-img-wait');
    });

    it('a portrait that did not come: image-off', () => {
        const html = all(tree(), false);
        // Without the window's answer (no load): what did not come shows crossed out, never as a broken image.
        expect(html).toContain('sp-portrait sp-img-wait');
        expect(html).not.toContain(`src="${WAIT_A}"`);
    });
});

describe('the app\'s view of the tree: a real load (pageImageWait)', () => {
    it('a stand-in reads loading while it comes, failed once the research lacks it; the size from its reference', async () => {
        const deps: ImageLoadDeps = {
            fetch: {
                fetch: async (_url, init) => {
                    const shas = (JSON.parse(String(init.body)) as { images: string[] }).images;
                    return new Response(JSON.stringify({ images: [], missing: shas, more: [] }), { status: 200 });
                },
                sha256Hex, sleep: async () => {},
            },
            currentTreeId: () => 'tree-a', write: () => [], store: () => {}, emit: () => {},
        };
        const pending: PendingImage[] = [{ key: 'person:bo:photo', ref: { sha: SHA_A, mime: 'image/jpeg', width: 300, height: 400 }, owner: { personIds: ['bo' as PersonId] } }];
        const q = startImageLoad({ treeId: 'tree-a', url: 'http://127.0.0.1:1/x/images', pending, deps })!;
        expect(pageImageWait(WAIT_A)).toEqual({ state: 'loading', w: 300, h: 400 });
        expect(pageImageWait(IMG, 'person:bo:photo').state).toBe('refresh');
        expect(pageImageWait(IMG, 'person:lu:photo').state).toBe('none');
        await q.whenIdle();
        expect(pageImageWait(WAIT_A).state).toBe('failed');
    });
});

describe('the counts that depend on images (spec 116 §5)', () => {
    it('a portrait or a couple\'s photo on its way weighs as its image', () => {
        const data = tree({ crop: IMG });
        expect(totalPhotoBytes(data)).toBe(52_000 + 81_000 + dataUrlByteSize(IMG));
        expect(personMedia(data.persons['bo' as PersonId], data).photoBytes).toBe(52_000);
    });

    it('the dialog "Load the research\'s version" compares no images: a stand-in there makes no row and is never shown', () => {
        const here = tree({ portrait: IMG, couple: IMG, crop: IMG });
        const there = tree();
        const diff = diffValues(here, there);
        expect(diff.rows).toEqual([]);
        expect(JSON.stringify(diff)).not.toContain('STROMPENDING');
    });
});
