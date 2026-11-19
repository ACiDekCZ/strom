/**
 * The state of a place that shows an image (spec 116): one look for every
 * avatar and tile while a photo comes after the tree. The data and the
 * queue live in src/image-loads.ts; this is the UI's one source of how such
 * a place says it: the attribute `data-img-state` on the element that holds
 * the <img> ("loading" | "refresh" | "failed"; none: as always), a veil
 * pulsing in one phase for the whole window (`--img-phase`), and a short
 * fade-in when the image comes (index.html, "Photo states").
 *
 * The card's own wording of the states (its tooltip row, its aria-label)
 * is here too, so the tree's cards and their in-place updates write the
 * same markup (src/renderer.ts).
 */

import { imageLoads, type FieldKey } from '../image-loads.js';
import { sharedPhaseDelay } from '../card-signals.js';
import { iconSvg } from '../icons.js';
import { strings } from '../strings.js';

/** none: no image on its way (as always); loaded: it came (in place, fading in). */
export type ImgState = 'none' | 'loading' | 'refresh' | 'loaded' | 'failed';

/** One pulse of the veil there and back (index.html @keyframes img-wait: 1.6 s each way). */
export const IMG_PULSE_MS = 3200;

/** The attribute every image place carries while its image is not in. */
const ATTR = 'data-img-state';

/**
 * The state of the field `key` from the evidence: on its way ('loading';
 * 'refresh' when the field holds a stored image meanwhile, `hasValue`),
 * 'failed', 'loaded'; 'none' when no load waits for it.
 */
export function imgStateOf(key: FieldKey, hasValue: boolean): ImgState {
    switch (imageLoads.stateOf(key)) {
        case 'pending': return hasValue ? 'refresh' : 'loading';
        case 'failed': return 'failed';
        case 'loaded': return 'loaded';
        default: return 'none';
    }
}

/** The host's attribute for HTML strings: ` data-img-state="loading"`, or nothing (none, loaded). */
export function imgStateAttr(state: ImgState): string {
    return state === 'loading' || state === 'refresh' || state === 'failed' ? ` ${ATTR}="${state}"` : '';
}

/** The negative delay that puts the veil into the window's one phase now (sharedPhaseDelay). */
export function imgPhaseDelay(now: number = clockNow()): string {
    return sharedPhaseDelay(IMG_PULSE_MS, now);
}

/** The phase of the pulse as an inline style: `--img-phase:-1234ms` (on #tree-canvas, a window's root, a host). */
export function imgPhaseStyle(now?: number): string {
    return `--img-phase:${imgPhaseDelay(now)}`;
}

/**
 * Set the state of a host in the DOM: the attribute set or taken away;
 * 'loaded' with `src` puts the image in (a new one fades in, unless the
 * window asks for reduced motion; the same image stays as it is). A veil
 * that starts here takes the window's phase, so it pulses with the others.
 * Nothing else of the host's content changes (its initials, a tile's glyph
 * are the caller's).
 */
export function setImgState(host: HTMLElement, state: ImgState, src?: string): void {
    const was = host.getAttribute(ATTR);
    if (state === 'loaded') {
        const img = host.querySelector('img');
        if (!src || img?.getAttribute('src') === src) {
            if (was !== null) host.removeAttribute(ATTR);
            return;
        }
        const win = host.ownerDocument?.defaultView ?? null;
        const fresh = (host.ownerDocument ?? document).createElement('img');
        const fade = !reducedMotion(win);
        // The attribute stays 'loaded' while the image fades in (index.html: the transition is under [data-img-state]).
        host.setAttribute(ATTR, 'loaded');
        if (fade) fresh.classList.add('is-arriving');
        fresh.setAttribute('src', src);
        fresh.setAttribute('alt', '');
        host.replaceChildren(fresh);
        if (fade) arriveNext(fresh, win);
        return;
    }
    if (state === 'none') {
        if (was !== null) host.removeAttribute(ATTR);
        return;
    }
    if (was === state) return;
    host.setAttribute(ATTR, state);
    if (state === 'loading' || state === 'refresh') host.style.setProperty('--img-phase', imgPhaseDelay());
}

/** A tile's glyph: the picture (or the picture struck through) and an optional word under it. */
export function imgGlyphHtml(kind: 'image' | 'image-off', note?: string, size = 24): string {
    return `<span class="img-slot-glyph">${iconSvg(kind, { size, strokeWidth: 1.6 })}`
        + `${note ? `<span class="img-slot-note">${esc(note)}</span>` : ''}</span>`;
}

// ==================== THE CARD ====================

/** How a tree card shows its portrait in a state (spec 116 §1.3, §2). */
export interface CardImageView {
    /** The avatar's state (a portrait that did not come leaves the card calm: none). */
    avatar: ImgState;
    /** Counted as a card with a photo (`has-photo`; the photo size of the view counts it too). */
    photo: boolean;
    /** The tooltip's photo column: the image, the initials of one on its way, none. */
    ttPhoto: 'img' | 'initials' | null;
    /** The tooltip's last row. */
    ttRow: 'loading' | 'loadingNew' | 'failed' | 'failedNew' | null;
    /** The end of the card's aria-label. */
    aria: 'loading' | 'failed' | null;
}

/** The card's look of its portrait in `state` (`hasPhoto`: the person holds a portrait now). */
export function cardImageView(state: ImgState, hasPhoto: boolean): CardImageView {
    switch (state) {
        case 'loading':
            return { avatar: 'loading', photo: true, ttPhoto: 'initials', ttRow: 'loading', aria: 'loading' };
        case 'refresh':
            return { avatar: 'refresh', photo: true, ttPhoto: 'img', ttRow: 'loadingNew', aria: 'loading' };
        case 'failed':
            // The kept portrait stays without a mark; without one the card is as one with no photo.
            return hasPhoto
                ? { avatar: 'none', photo: true, ttPhoto: 'img', ttRow: 'failedNew', aria: null }
                : { avatar: 'none', photo: false, ttPhoto: null, ttRow: 'failed', aria: 'failed' };
        default:
            return { avatar: 'none', photo: hasPhoto, ttPhoto: hasPhoto ? 'img' : null, ttRow: null, aria: null };
    }
}

/**
 * The card's avatar: the portrait (`photo`: the one it holds now) or the
 * initials; a portrait a load brings carries its hash (`sha`, the card's
 * signature tells it by that, I7) and its state with the window's phase.
 */
export function cardAvatarHtml(view: CardImageView, photo: string | undefined, initials: string, sha: string | undefined, phase: string): string {
    const veil = view.avatar === 'loading' || view.avatar === 'refresh';
    const attrs = sha ? ` data-img-sha="${esc(sha)}"${imgStateAttr(view.avatar)}${veil ? ` style="--img-phase:${esc(phase)}"` : ''}` : '';
    const inner = photo ? `<img src="${esc(photo)}" alt="">` : `<span class="avatar-initials">${esc(initials)}</span>`;
    return `<div class="card-avatar"${attrs}>${inner}</div>`;
}

/** The tooltip's row of the portrait's state ('' without one). */
export function cardImageRowHtml(row: CardImageView['ttRow']): string {
    if (!row) return '';
    const p = strings.photos;
    const failed = row === 'failed' || row === 'failedNew';
    const text = row === 'loading' ? p.loading : row === 'loadingNew' ? p.loadingNew : row === 'failed' ? p.failed : p.failedNew;
    return `<div class="tt-line tt-img-state${failed ? ' tt-img-failed' : ''}">`
        + `${failed ? iconSvg('image-off', { size: 12 }) : ''}<span>${esc(text)}</span></div>`;
}

/** The tooltip's photo column ('' without one). */
export function cardTooltipPhotoHtml(view: CardImageView, photo: string | undefined, initials: string): string {
    if (view.ttPhoto === 'img' && photo) return `<img class="tt-photo" src="${esc(photo)}" alt="">`;
    if (view.ttPhoto === 'initials') {
        return `<span class="tt-photo"${imgStateAttr('loading')}><span class="avatar-initials">${esc(initials)}</span></span>`;
    }
    return '';
}

/** The card's aria-label with the state of its portrait at the end (an earlier state's words taken off). */
export function withImgAria(label: string, aria: CardImageView['aria']): string {
    const p = strings.photos;
    let out = label;
    for (const t of [p.ariaLoading, p.ariaFailed]) out = out.split(`, ${t}`).join('');
    if (aria) out = `${out}, ${aria === 'loading' ? p.ariaLoading : p.ariaFailed}`;
    return out;
}

// ==================== HELPERS ====================

/** The animations' clock (as the agent's arcs take it: src/renderer.ts spinDelay). */
function clockNow(): number {
    if (typeof document !== 'undefined') {
        const t = document.timeline?.currentTime;
        if (typeof t === 'number') return t;
    }
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function reducedMotion(win: Window | null): boolean {
    const w = win ?? (typeof window !== 'undefined' ? window : null);
    return w?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Take the arriving image's class off once a frame showed it hidden (after it decoded): the opacity transition runs. */
function arriveNext(img: HTMLImageElement, win: Window | null): void {
    const raf = win?.requestAnimationFrame?.bind(win)
        ?? (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn: FrameRequestCallback) => setTimeout(() => fn(0), 16));
    const go = () => raf(() => raf(() => img.classList.remove('is-arriving')));
    if (typeof img.decode === 'function') img.decode().then(go, go);
    else go();
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
