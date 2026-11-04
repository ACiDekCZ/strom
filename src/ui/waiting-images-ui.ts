/**
 * The images of a book an awaiting item waits for (spec 048 U6 §3, §4), shared
 * by the Research overview and the small panel: the short state in a row
 * (dots and how many), the book's frame in a detail, what arrived since the
 * last status (lit a while, told to a screen reader), and a row that takes
 * files dropped on it ("Drop here: images for this task").
 */

import { strings } from '../strings.js';
import { LiveWaiting } from '../research-link.js';
import { ImagesState, imageRanges, imagesArrived, imagesState } from '../research-waiting.js';

/** The followed research as far as these helpers need it (its tree and its items). */
interface ImagesSession {
    treeId: string;
    waiting: readonly LiveWaiting[];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** An item's key across redraws: its tree and its id. */
export const itemKey = (s: { treeId: string }, id: string): string => `${s.treeId}|${id}`;

/** The images state each item had at the last drawing, and the numbers that came since (until its detail folds). */
const imagesSeen = new Map<string, ImagesState>();
const imagesArrivals = new Map<string, { nums: number[]; at: number }>();
/** How long the short state is lit after images arrived. */
const ARRIVED_MS = 4000;
/** Number chips in the book's frame at most (more: the sentence says it). */
const MAX_SLOT_CHIPS = 24;

/** Told to a screen reader once (images arrived). */
export function announceWaiting(text: string): void {
    let region = document.getElementById('waiting-live-region');
    if (!region) {
        region = el('div', 'waiting-live-region');
        region.id = 'waiting-live-region';
        region.setAttribute('role', 'status');
        region.setAttribute('aria-live', 'polite');
        document.body.appendChild(region);
    }
    region.textContent = text;
}

/** What came to each item's images since the last drawing (a new status): lit for a while, said once. */
export function noteImagesArrived(s: ImagesSession): void {
    const T = strings.live.waitingTask;
    const said: string[] = [];
    for (const w of s.waiting) {
        const now = imagesState(w);
        const key = itemKey(s, w.id);
        if (!now) continue;
        const before = imagesSeen.get(key);
        imagesSeen.set(key, now);
        if (!before) continue;
        const nums = imagesArrived(before, now);
        if (nums.length === 0 && now.have <= before.have) continue;
        const prev = imagesArrivals.get(key)?.nums ?? [];
        const all = [...new Set([...prev, ...nums])].sort((a, b) => a - b);
        imagesArrivals.set(key, { nums: all, at: Date.now() });
        if (nums.length > 0) said.push(T.justArrived(imageRanges(nums), nums.length));
    }
    if (said.length > 0) announceWaiting(said.join('. '));
}

/** The short state of an item's images in its row: dots (up to 8) and how many, or which are needed. */
export function imagesShortEl(key: string, img: ImagesState): HTMLElement {
    const T = strings.live.waitingTask;
    const box = el('span', 'waiting-images');
    const arrival = imagesArrivals.get(key);
    const since = arrival ? Date.now() - arrival.at : Infinity;
    if (img.detail !== 'unknown' && img.want !== undefined && img.want > 0 && img.want <= 8) {
        const dots = el('span', 'img-dots');
        dots.setAttribute('aria-hidden', 'true');
        const nums = img.wanted && img.saved && img.wanted.length === img.want ? img.wanted : null;
        for (let i = 0; i < img.want; i++) {
            const on = nums ? img.saved!.includes(nums[i]) : i < img.have;
            const dot = el('span', on ? 'img-dot is-on' : 'img-dot');
            if (on && since < ARRIVED_MS && (nums ? arrival!.nums.includes(nums[i]) : i === img.have - 1)) {
                dot.classList.add('is-new');
                dot.style.animationDelay = `-${Math.round(since)}ms`;
            }
            dots.appendChild(dot);
        }
        box.appendChild(dots);
    }
    const missing = img.missing ?? [];
    const text = img.detail === 'unknown' ? T.imagesUnknown(img.have)
        : img.have > 0 || missing.length === 0 ? T.imagesShort(img.have, img.want ?? img.have)
            : T.imagesNeeded(imageRanges(missing), missing.length);
    const short = el('span', 'waiting-images__text', text);
    if (since < ARRIVED_MS) {
        short.classList.add('is-arrived');
        short.style.animationDelay = `-${Math.round(since)}ms`;
    }
    box.appendChild(short);
    if (arrival && arrival.nums.length > 0) {
        box.appendChild(el('span', 'waiting-images__arrived', `· ${T.justArrived(imageRanges(arrival.nums), arrival.nums.length)}`));
    }
    return box;
}

/** The sentence of an item's images ("1 of 2 images saved – image 58 missing."). */
export function imagesSentence(img: ImagesState): string {
    const T = strings.live.waitingTask;
    if (img.detail === 'unknown') return `${T.imagesUnknown(img.have)}.`;
    const missing = img.missing ?? [];
    const want = img.want ?? img.have;
    return missing.length === 0 ? T.imagesStateOld(img.have, want)
        : img.have > 0 ? T.imagesState(img.have, want, imageRanges(missing), missing.length)
            : T.imagesNone(imageRanges(missing), missing.length);
}

/**
 * The state of an item's images in its detail: the book's frame with a chip
 * per number (saved / missing) and a sentence; a count not known: the
 * sentence and how it is finished; an older research: the sentence alone.
 */
export function appendImagesDetail(host: HTMLElement, img: ImagesState): void {
    const T = strings.live.waitingTask;
    const missing = img.missing ?? [];
    if (img.detail === 'unknown') {
        host.appendChild(el('p', 'wait-book__state', T.imagesUnknown(img.have)));
        host.appendChild(el('p', 'research-overview__waiting-hint wait-book__hint', T.unknownHint));
        return;
    }
    const sentence = imagesSentence(img);
    if (img.detail === 'old') {
        host.appendChild(el('p', 'wait-book__state', sentence));
        return;
    }
    const frame = el('div', 'wait-book');
    if (img.book) {
        frame.appendChild(el('span', 'wait-book__label', T.book));
        frame.appendChild(el('span', 'wait-book__name', img.book));
    }
    if (img.wanted && img.saved && img.wanted.length <= MAX_SLOT_CHIPS) {
        const slots = el('ul', 'wait-book__slots');
        for (const n of img.wanted) {
            const saved = img.saved.includes(n);
            const chip = el('li', saved ? 'wait-book__slot is-saved' : 'wait-book__slot', `${saved ? '✓' : '○'} ${n} · ${saved ? T.slotSaved : T.slotMissing}`);
            chip.dataset.image = String(n);
            slots.appendChild(chip);
        }
        frame.appendChild(slots);
    }
    frame.appendChild(el('p', 'wait-book__state', sentence));
    host.appendChild(frame);
}

/** Images sent from here: taken as seen (the next status does not light them as arrived by themselves). */
export function takeOwnImages(key: string, now: ImagesState | null): void {
    if (now) imagesSeen.set(key, now);
    imagesArrivals.delete(key);
}

/** What arrived at an item was seen (its detail folded). */
export function forgetImagesArrived(key: string): void {
    imagesArrivals.delete(key);
}

/** The overview closed: nothing is remembered as seen or arrived. */
export function clearImagesSeen(): void {
    imagesArrivals.clear();
    imagesSeen.clear();
}

/** A drag carries files (not text or a link). */
export function dragHasFiles(e: DragEvent): boolean {
    return !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
}

/**
 * A row that takes images for its task: while files are dragged over it the
 * whole row is the target ("⤓ Drop here: images for this task"); dropped,
 * they go to `take`. Anything but files is not taken (no preventDefault).
 */
export function bindImagesDrop(row: HTMLElement, take: (files: File[]) => void): void {
    let overlay: HTMLElement | null = null;
    const off = (): void => {
        row.classList.remove('is-drop-target');
        overlay?.remove();
        overlay = null;
    };
    row.addEventListener('dragover', (e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        if (overlay) return;
        row.classList.add('is-drop-target');
        overlay = el('span', 'waiting-drop-overlay', `⤓ ${strings.live.waitingTask.dropRow}`);
        overlay.setAttribute('aria-hidden', 'true');
        row.appendChild(overlay);
    });
    row.addEventListener('dragleave', (e) => {
        if (e.relatedTarget instanceof Node && row.contains(e.relatedTarget)) return;
        off();
    });
    row.addEventListener('drop', (e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        off();
        const files = [...(e.dataTransfer?.files ?? [])];
        if (files.length > 0) take(files);
    });
}
