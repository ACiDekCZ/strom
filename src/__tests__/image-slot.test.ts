/**
 * The state of a place with an image (spec 116 §1, §2, §9.2): one attribute
 * for every avatar and tile, a veil pulsing in one phase, a photo that comes
 * fading in (not under reduced motion); the tree card's look of each state
 * (has-photo, the tooltip's column and row, the aria-label) and its
 * signature, which a photo coming does not change (I7). Invented data only.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
    cardAvatarHtml, cardImageRowHtml, cardImageView, cardTooltipPhotoHtml, imgGlyphHtml, imgPhaseDelay, imgPhaseStyle,
    imgStateAttr, imgStateOf, setImgState, withImgAria, IMG_PULSE_MS, type ImgState,
} from '../ui/image-slot.js';
import { cardsOnScreen, imageBySha, viewHasAvatar } from '../renderer.js';
import { resetImageLoads, startImageLoad, type ImageLoadDeps, type PendingImage } from '../image-loads.js';
import { sha256Hex } from '../research-image-refs.js';
import { strings } from '../strings.js';
import { budgetReport, measureAgainstBudget } from './helpers/perf-budget.js';

// ==================== A MINIMAL DOM ====================

/** Just what setImgState touches: attributes, classes, one <img> child, the window's motion and frames. */
class FakeEl {
    attrs = new Map<string, string>();
    classes = new Set<string>();
    children: FakeEl[] = [];
    props = new Map<string, string>();
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
    style = { setProperty: (n: string, v: string) => { this.props.set(n, v); } };
}

class FakeDoc {
    frames: FrameRequestCallback[] = [];
    reduced = false;
    defaultView = {
        matchMedia: (q: string) => ({ matches: q.includes('reduced-motion') && this.reduced }),
        requestAnimationFrame: (fn: FrameRequestCallback) => { this.frames.push(fn); return this.frames.length; },
    };
    createElement(tag: string): FakeEl { return new FakeEl(tag.toUpperCase(), this); }
    /** Run the frames asked for so far (and none asked for meanwhile). */
    frame(): void { for (const fn of this.frames.splice(0)) fn(0); }
}

function host(o: { reduced?: boolean; img?: string } = {}): { el: HTMLElement; raw: FakeEl; doc: FakeDoc } {
    const doc = new FakeDoc();
    doc.reduced = !!o.reduced;
    const raw = doc.createElement('div');
    if (o.img) {
        const img = doc.createElement('img');
        img.setAttribute('src', o.img);
        raw.children.push(img);
    }
    return { el: raw as unknown as HTMLElement, raw, doc };
}

const OLD = 'data:image/jpeg;base64,T0xE';
const NEW = 'data:image/jpeg;base64,TkVX';

// ==================== image-slot ====================

describe('image-slot: the attribute and the phase', () => {
    it('imgStateAttr marks loading, refresh and failed; none and loaded carry nothing', () => {
        expect(imgStateAttr('loading')).toBe(' data-img-state="loading"');
        expect(imgStateAttr('refresh')).toBe(' data-img-state="refresh"');
        expect(imgStateAttr('failed')).toBe(' data-img-state="failed"');
        expect(imgStateAttr('none')).toBe('');
        expect(imgStateAttr('loaded')).toBe('');
    });

    it('every veil drawn at any moment pulses in one phase: the delay puts it where the page clock is', () => {
        expect(IMG_PULSE_MS).toBe(3200);
        expect(imgPhaseDelay(4434)).toBe('-1234ms');
        expect(imgPhaseStyle(4434)).toBe('--img-phase:-1234ms');
        // Two moments one whole pulse apart are in the same phase.
        expect(imgPhaseDelay(1000)).toBe(imgPhaseDelay(1000 + IMG_PULSE_MS * 7));
    });

    it('a tile glyph: the picture or the picture struck through, with an optional word', () => {
        expect(imgGlyphHtml('image-off', 'Not <loaded>')).toContain('<span class="img-slot-note">Not &lt;loaded&gt;</span>');
        expect(imgGlyphHtml('image')).not.toContain('img-slot-note');
        expect(imgGlyphHtml('image-off', undefined, 16)).toContain('width="16"');
        expect(imgGlyphHtml('image-off')).toContain('M3 3l18 18');
    });
});

describe('image-slot: setImgState in the DOM', () => {
    it('loading and refresh set the attribute and the window\'s phase on the host; none takes it off', () => {
        const { el, raw } = host();
        setImgState(el, 'loading');
        expect(raw.getAttribute('data-img-state')).toBe('loading');
        expect(raw.props.get('--img-phase')).toMatch(/^-\d+ms$/);
        setImgState(el, 'failed');
        expect(raw.getAttribute('data-img-state')).toBe('failed');
        setImgState(el, 'none');
        expect(raw.hasAttribute('data-img-state')).toBe(false);
        expect(raw.children).toEqual([]);
    });

    it('a photo that comes replaces the content and fades in: hidden a frame, then the class goes', () => {
        const { el, raw, doc } = host();
        raw.children.push(doc.createElement('span'));
        setImgState(el, 'loading');
        setImgState(el, 'loaded', NEW);
        expect(raw.children).toHaveLength(1);
        const img = raw.children[0];
        expect(img.tagName).toBe('IMG');
        expect(img.getAttribute('src')).toBe(NEW);
        expect(img.getAttribute('alt')).toBe('');
        // The transition runs under [data-img-state] (index.html): the host keeps one while the photo fades in.
        expect(raw.getAttribute('data-img-state')).toBe('loaded');
        expect(img.classes.has('is-arriving')).toBe(true);
        doc.frame();
        expect(img.classes.has('is-arriving')).toBe(true);
        doc.frame();
        expect(img.classes.has('is-arriving')).toBe(false);
    });

    it('the old photo waiting for a new one: the new one takes its place, fading in', () => {
        const { el, raw, doc } = host({ img: OLD });
        setImgState(el, 'refresh');
        expect(raw.getAttribute('data-img-state')).toBe('refresh');
        expect(raw.children[0].getAttribute('src')).toBe(OLD);
        setImgState(el, 'loaded', NEW);
        expect(raw.children[0].getAttribute('src')).toBe(NEW);
        expect(raw.children[0].classes.has('is-arriving')).toBe(true);
        doc.frame();
        doc.frame();
        expect(raw.children[0].classes.has('is-arriving')).toBe(false);
    });

    it('under reduced motion the photo is simply there: no arriving class, no frame asked', () => {
        const { el, raw, doc } = host({ reduced: true });
        setImgState(el, 'loaded', NEW);
        expect(raw.children[0].getAttribute('src')).toBe(NEW);
        expect(raw.children[0].classes.size).toBe(0);
        expect(doc.frames).toHaveLength(0);
    });

    it('the same photo stays as it is (its element too); the attribute goes', () => {
        const { el, raw } = host({ img: NEW });
        const before = raw.children[0];
        raw.setAttribute('data-img-state', 'refresh');
        setImgState(el, 'loaded', NEW);
        expect(raw.children[0]).toBe(before);
        expect(raw.hasAttribute('data-img-state')).toBe(false);
    });
});

describe('image-slot: the state of a field from the load', () => {
    afterEach(() => resetImageLoads());

    it('pending reads loading (refresh over a stored photo), a missing one failed, a field no load waits for none', async () => {
        const deps: ImageLoadDeps = {
            fetch: {
                fetch: async (_url, init) => {
                    const shas = (JSON.parse(String(init.body)) as { images: string[] }).images;
                    // The bridge has none of them.
                    return new Response(JSON.stringify({ images: [], missing: shas, more: [] }), { status: 200 });
                },
                sha256Hex, sleep: async () => {},
            },
            currentTreeId: () => 'tree-a',
            write: () => [],
            store: () => {},
            emit: () => {},
        };
        const pending: PendingImage[] = [{ key: 'person:p1:photo', ref: { sha: 'a'.repeat(64), mime: 'image/jpeg' }, owner: { personIds: ['p1' as never] } }];
        const q = startImageLoad({ treeId: 'tree-a', url: 'http://127.0.0.1:1/x/images', pending, deps })!;
        expect(imgStateOf('person:p1:photo', false)).toBe('loading');
        expect(imgStateOf('person:p1:photo', true)).toBe('refresh');
        expect(imgStateOf('person:p2:photo', false)).toBe('none');
        await q.whenIdle();
        expect(imgStateOf('person:p1:photo', false)).toBe('failed');
    });
});

// ==================== the tree card ====================

describe('the card in each state (spec 116 §1.3, §2)', () => {
    const p = strings.photos;

    it('on its way: the initials under the veil, has-photo (the view keeps the photo size), its column and row in the tooltip', () => {
        const v = cardImageView('loading', false);
        expect(v).toEqual({ avatar: 'loading', photo: true, ttPhoto: 'initials', ttRow: 'loading', aria: 'loading' });
        const html = cardAvatarHtml(v, undefined, 'VŠ', 'abc', '-120ms');
        expect(html).toBe('<div class="card-avatar" data-img-sha="abc" data-img-state="loading" style="--img-phase:-120ms"><span class="avatar-initials">VŠ</span></div>');
        expect(cardTooltipPhotoHtml(v, undefined, 'VŠ')).toBe('<span class="tt-photo" data-img-state="loading"><span class="avatar-initials">VŠ</span></span>');
        expect(cardImageRowHtml(v.ttRow)).toBe(`<div class="tt-line tt-img-state"><span>${p.loading}</span></div>`);
    });

    it('a stored photo waiting for a new one shows it under the same veil; the tooltip says a new one loads', () => {
        const v = cardImageView('refresh', true);
        expect(v).toEqual({ avatar: 'refresh', photo: true, ttPhoto: 'img', ttRow: 'loadingNew', aria: 'loading' });
        expect(cardAvatarHtml(v, OLD, 'VŠ', 'abc', '-1ms')).toContain(`data-img-state="refresh" style="--img-phase:-1ms"><img src="${OLD}" alt="">`);
        expect(cardImageRowHtml(v.ttRow)).toContain(p.loadingNew);
    });

    it('one that did not come: calm as a card without a photo; the tooltip row and the aria-label say it', () => {
        const v = cardImageView('failed', false);
        expect(v).toEqual({ avatar: 'none', photo: false, ttPhoto: null, ttRow: 'failed', aria: 'failed' });
        const html = cardAvatarHtml(v, undefined, 'OQ', 'abc', '-1ms');
        expect(html).not.toContain('data-img-state');
        expect(html).not.toContain('--img-phase');
        expect(cardTooltipPhotoHtml(v, undefined, 'OQ')).toBe('');
        const row = cardImageRowHtml(v.ttRow);
        expect(row).toContain('tt-img-failed');
        expect(row).toContain('M3 3l18 18');
        expect(row).toContain(p.failed);
    });

    it('a new one that did not come over a stored photo: the photo stays without a mark; the tooltip says the new one did not load', () => {
        const v = cardImageView('failed', true);
        expect(v).toEqual({ avatar: 'none', photo: true, ttPhoto: 'img', ttRow: 'failedNew', aria: null });
        expect(cardAvatarHtml(v, OLD, 'LQ', 'abc', '-1ms')).not.toContain('data-img-state');
        expect(cardImageRowHtml(v.ttRow)).toContain(p.failedNew);
    });

    it('no load: as always', () => {
        expect(cardImageView('none', true)).toEqual({ avatar: 'none', photo: true, ttPhoto: 'img', ttRow: null, aria: null });
        expect(cardImageView('none', false)).toEqual({ avatar: 'none', photo: false, ttPhoto: null, ttRow: null, aria: null });
        expect(cardAvatarHtml(cardImageView('none', false), undefined, 'AB', undefined, '-1ms')).toBe('<div class="card-avatar"><span class="avatar-initials">AB</span></div>');
        expect(cardImageRowHtml(null)).toBe('');
    });

    it('the aria-label ends with the state; a later state replaces it, none takes it off', () => {
        const base = 'Otakar Quellmayer, 1899 – 1917; locked';
        const loading = withImgAria(base, 'loading');
        expect(loading).toBe(`${base}, ${p.ariaLoading}`);
        expect(withImgAria(loading, 'failed')).toBe(`${base}, ${p.ariaFailed}`);
        expect(withImgAria(loading, null)).toBe(base);
    });

    it('the view keeps the photo size of cards with photos while the portraits are on their way (nobody has one yet)', () => {
        const waiting = [{ isPlaceholder: false }, { isPlaceholder: false }];
        expect(viewHasAvatar(waiting, 'normal')).toBe(true);
        expect(viewHasAvatar([{ isPlaceholder: true }], 'normal')).toBe(false);
        expect(viewHasAvatar(waiting, 'compact')).toBe(false);
    });
});

describe('a photo coming is no change of the card (I7)', () => {
    const sha = 'f'.repeat(64);
    /** A card as the renderer draws it in `state` (`photo`: the portrait the person holds then). */
    function card(state: ImgState, photo: string | undefined, name = 'Hedvika Quellmayerová'): string {
        const v = cardImageView(state, !!photo);
        const shell = `<div class="person-card female has-avatar${v.photo ? ' has-photo' : ''} focused" data-id="p1" tabindex="0" role="button" `
            + `aria-label="${withImgAria(`${name}, 1872 – 1944`, v.aria)}"></div>`;
        const tt = cardTooltipPhotoHtml(v, photo, 'HQ');
        const inner = `<div class="card-avatar-wrap">${cardAvatarHtml(v, photo, 'HQ', sha, `-${state.length}ms`)}</div>`
            + `<div class="card-body"><div class="name"><span class="name-text">${name}</span></div></div>`
            + `<div class="card-tooltip${tt ? ' has-photo' : ''}" data-img-sha="${sha}">${tt}<div class="tt-body"><div class="tt-name">${name}</div>`
            + `${cardImageRowHtml(v.ttRow)}<div class="tt-foot">…</div></div></div>`;
        return imageBySha(shell, inner);
    }

    it('on its way, come, not come, a stored one waiting for a new one: one signature', () => {
        const loading = card('loading', undefined);
        expect(card('loaded', NEW)).toBe(loading);
        expect(card('none', NEW)).toBe(loading);
        expect(card('failed', undefined)).toBe(loading);
        expect(card('refresh', OLD)).toBe(loading);
        expect(card('failed', OLD)).toBe(loading);
        expect(loading).not.toContain('data:image');
        expect(loading).not.toContain('data-img-state');
        expect(loading).not.toContain(strings.photos.ariaLoading);
    });

    it('a change of the text still is one', () => {
        expect(card('loaded', NEW, 'Hedvika Quellmayerová-Talvanenová')).not.toBe(card('loading', undefined));
    });

    it('in place (classes reordered, the attribute set after the hash) reads as drawn anew', () => {
        const drawn = card('loaded', NEW);
        const sha2 = sha;
        const shell = `<div class="person-card female has-avatar focused has-photo" data-id="p1" tabindex="0" role="button" aria-label="Hedvika Quellmayerová, 1872 – 1944"></div>`;
        const inner = `<div class="card-avatar-wrap"><div class="card-avatar" data-img-sha="${sha2}" style="--img-phase:-77ms" data-img-state="loaded"><img class="is-arriving" src="${NEW}" alt=""></div></div>`
            + `<div class="card-body"><div class="name"><span class="name-text">Hedvika Quellmayerová</span></div></div>`
            + `<div class="card-tooltip has-photo" data-img-sha="${sha2}"><img class="tt-photo" src="${NEW}" alt=""><div class="tt-body"><div class="tt-name">Hedvika Quellmayerová</div><div class="tt-foot">…</div></div></div>`;
        expect(imageBySha(shell, inner)).toBe(drawn);
    });
});

describe('the cards on screen come first (K1.6)', () => {
    const cards = [
        { id: 'far-left', x: -900, y: 0, w: 160, h: 60 },
        { id: 'middle', x: 420, y: 270, w: 160, h: 60 },
        { id: 'edge', x: 950, y: 0, w: 160, h: 60 },
        { id: 'below', x: 400, y: 2000, w: 160, h: 60 },
    ];

    it('only cards in the view, nearest its middle first; the pan and the zoom count', () => {
        expect(cardsOnScreen(cards, { scale: 1, tx: 0, ty: 0 }, { width: 1000, height: 600 })).toEqual(['middle', 'edge']);
        // Panned to the left side of the world: the far-left card comes into view.
        expect(cardsOnScreen(cards, { scale: 1, tx: 1000, ty: 0 }, { width: 1000, height: 600 })).toEqual(['far-left']);
        // Zoomed far out: all of them, the middle one still first.
        const all = cardsOnScreen(cards, { scale: 0.2, tx: 400, ty: 100 }, { width: 1000, height: 600 });
        expect(all).toHaveLength(4);
        expect(cardsOnScreen(cards, { scale: 1, tx: 0, ty: 0 }, { width: 0, height: 0 })).toEqual([]);
    });
});

describe('performance: the state of 1 240 cards', () => {
    /** Calibration rounds: about as long as the measured work (as in the other perf tests). */
    const CALIBRATION_ROUNDS = 2;
    const CALIBRATION_REFERENCE_MS = 11;
    const BUDGET_MS = 20;

    it('draws and compares 1 240 cards with their portraits on their way within the budget', () => {
        const states: ImgState[] = ['loading', 'refresh', 'loaded', 'failed', 'none'];
        const photo = `data:image/jpeg;base64,${'A'.repeat(4000)}`;
        const run = () => {
            let n = 0;
            for (let i = 0; i < 1240; i++) {
                const state = states[i % states.length];
                const has = state === 'refresh' || state === 'loaded' || (state === 'none' && i % 2 === 0);
                const v = cardImageView(state, has);
                const avatar = cardAvatarHtml(v, has ? photo : undefined, 'AB', `sha${i}`, '-10ms');
                const tt = cardTooltipPhotoHtml(v, has ? photo : undefined, 'AB');
                const shell = `<div class="person-card male has-avatar${v.photo ? ' has-photo' : ''}" aria-label="${withImgAria(`Person ${i}`, v.aria)}"></div>`;
                n += imageBySha(shell, `${avatar}<div class="card-tooltip" data-img-sha="sha${i}">${tt}<div class="tt-body">${cardImageRowHtml(v.ttRow)}</div></div>`).length;
            }
            return n;
        };
        expect(run()).toBeGreaterThan(0);
        const m = measureAgainstBudget(run, {
            budgetMs: BUDGET_MS, calibrationRounds: CALIBRATION_ROUNDS, referenceMs: CALIBRATION_REFERENCE_MS,
            minPairs: 2, maxPairs: 6,
        });
        console.log(budgetReport('image states, 1240 cards', m, BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(BUDGET_MS);
    }, 60_000);
});
