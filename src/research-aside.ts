/**
 * Files of a book's inbox folder the research set aside (`inbox.aside`,
 * Strom Research 1.36): another scan than the image saved under its number
 * ('other'), or the same scan as an image saved under another number
 * ('same'). The research never deletes them; it asks. The app shows each as
 * a decision in Awaiting action, under its book (asideWaiting in
 * research-link.ts), and answers through the bridge
 * (`POST <token>/books/aside`):
 * - `discard`: the saved image stays, the file goes to the system's bin;
 * - `take` ('other' only): the new file is the image of its number;
 * - `image` + `image: n` ('other' only): the new file is image n of the book.
 * The answer says the files set aside now (`aside`); 404 `aside.unknown`: answered
 * elsewhere meanwhile (the item just goes).
 */

import { LiveBookAside, LiveWaiting, asideFileName, imageNumber, sanitizeBooksAside } from './research-link.js';
import { researchBridgeWrite, type BridgeWriteResult, type DirectionWriteRefused } from './research-directions-write.js';
import type { strings } from './strings.js';

/** An answer to a file set aside. */
export type AsideDo = 'discard' | 'take' | 'image';

/** The texts of the files set aside (`strings.live.aside` of a language). */
export type AsideTexts = typeof strings.live.aside;

/** The answers a file set aside offers, in their order: 'other' keep / take (its number known) / another number; 'same' only the bin. */
export function asideAnswers(a: Pick<LiveBookAside, 'kind' | 'image'>): AsideDo[] {
    if (a.kind === 'same') return ['discard'];
    return a.image !== undefined ? ['discard', 'take', 'image'] : ['discard', 'image'];
}

/** The item's sentence: the file, what it is against which saved image, of which book (its title, else its id). */
export function asideWaitingText(w: Pick<LiveWaiting, 'aside' | 'what'>, bookTitle: string | null, T: AsideTexts): string {
    const a = w.aside;
    if (!a) return w.what;
    const file = asideFileName(a);
    return a.kind === 'same' ? T.same(file, a.media) : T.other(file, a.image ?? null, a.media, bookTitle || a.recordset);
}

/** What a written answer says: what was done and the files set aside now. */
export interface AsideWritten {
    done: AsideDo;
    aside: LiveBookAside[];
}

/** Answer a file set aside (`POST <token>/books/aside`); `image` only with `do: 'image'`. Never throws. */
export function answerBookAside(base: string, file: string, what: AsideDo, image?: number): Promise<BridgeWriteResult<AsideWritten>> {
    const n = what === 'image' ? imageNumber(image) : null;
    if (!file || !['discard', 'take', 'image'].includes(what) || (what === 'image' && n === null)) {
        return Promise.resolve({ ok: false, code: 'invalid', status: 0, errorCode: '', retryAfter: null, reason: '' });
    }
    return researchBridgeWrite(base, 'POST', 'books/aside', { file, do: what, ...(n !== null ? { image: n } : {}) }, r => ({
        done: r.done === 'take' || r.done === 'image' ? r.done : 'discard',
        aside: sanitizeBooksAside(r.aside),
    }));
}

/** How an answer ended, as the row shows it: done, gone (answered elsewhere), or refused with its sentence and whether Try again helps. */
export type AsideOutcome =
    | { ok: true }
    | { ok: false; gone: true }
    | { ok: false; gone?: false; text: string; retry: boolean; tone: 'warn' | 'danger' };

/** The sentence of a refused answer (busy, not running, the number taken, the bin only, the research's own words). */
export function asideRefusalText(r: DirectionWriteRefused, image: number | undefined, T: AsideTexts, busy: string, down: string): string {
    if (r.code === 'busy') return busy;
    if (r.code === 'network') return down;
    if (r.errorCode === 'aside.taken' && image !== undefined) return T.taken(image);
    if (r.errorCode === 'aside.same') return T.sameOnly;
    if (r.code === 'held' && r.held?.said) return r.held.said;
    return r.reason ? T.notSavedSaid(r.reason) : T.notSaved;
}

/** A refused answer as its outcome (404: gone). */
export function asideOutcomeOf(r: DirectionWriteRefused, image: number | undefined, T: AsideTexts, busy: string, down: string): AsideOutcome {
    if (r.code === 'none') return { ok: false, gone: true };
    return {
        ok: false, text: asideRefusalText(r, image, T, busy, down),
        retry: r.code === 'busy' || r.code === 'network' || r.code === 'failed', tone: r.code === 'busy' ? 'warn' : 'danger',
    };
}

/** An outcome as the overview's own window got it from the main window (null: not one). */
export function readAsideOutcome(v: unknown): AsideOutcome | null {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (o.ok === true) return { ok: true };
    if (o.ok !== false) return null;
    if (o.gone === true) return { ok: false, gone: true };
    if (typeof o.text !== 'string') return null;
    return { ok: false, text: o.text.slice(0, 400), retry: o.retry === true, tone: o.tone === 'warn' ? 'warn' : 'danger' };
}
