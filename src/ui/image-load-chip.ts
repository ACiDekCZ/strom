/**
 * The indicator of the tree's photos on their way, "Photos k / n" (spec 116
 * §6), and the notice of those that did not load (§7).
 *
 * One `button.img-load-chip` in the main window's body, filled from the
 * snapshot of the image queue (`strom:images-state`, src/image-loads.ts):
 * it shows once photos have been on their way for CHIP_SHOW_MS (a few quick
 * ones never blink), counts the whole tree ("· 3 not loaded" beside), ends
 * with ✓ for BUSY_DONE_MS when all came, or goes at once and leaves a
 * closable alert toast with why and "Try again" when some did not. A click
 * opens a small detail (`.img-load-pop`, Esc or a click beside closes it).
 * Another tree opened: it goes. While an output's progress toast counts the
 * photos itself (§8) it is held back: `suspendImageLoadChip()`.
 *
 * The decisions (`ImageLoadChipModel`) know no DOM, so they are tested with
 * fake timers alone; `initImageLoadChip()` binds them to the page.
 */

import { strings } from '../strings.js';
import { IMAGES_STATE_EVENT, imageLoads, type ImageFailReason, type ImageLoadSnapshot } from '../image-loads.js';
import { IMAGE_ANSWER_MS } from '../research-image-refs.js';
import { onToastChange, shownToast } from '../toast-slot.js';
import { BUSY_DONE_MS, announceBusy } from './busy.js';
import { barEl, setBarShare } from './prog-bar.js';
import { showToast, type ToastHandle } from './toast.js';

/** Photos on their way this long before the indicator shows (§6.2). */
export const CHIP_SHOW_MS = 400;
/** The kind of the notice of photos that did not load (one at a time). */
export const IMAGES_FAILED_TOAST = 'images-failed';

/** What the indicator shows: the count while photos come, ✓ once all came. */
export type ChipView =
    | { kind: 'run'; done: number; total: number; failed: number; left: number }
    | { kind: 'ok'; total: number };

/** The indicator's words for a view. */
export interface ChipWords {
    label: string;
    /** The whole count ("846 / 860 · 3 not loaded"): `main`, then `failed` after a space where some did not load. */
    count: string;
    main: string;
    failed: string;
    aria: string;
    /** The bar's share 0…1 (null: no bar, the ✓ view). */
    share: number | null;
}

export function chipWords(v: ChipView): ChipWords {
    const P = strings.photos;
    if (v.kind === 'ok') {
        const all = `${v.total} / ${v.total}`;
        return { label: P.chipLabel, count: all, main: all, failed: '', aria: P.chipAria(v.total, v.total), share: null };
    }
    const main = `${v.done} / ${v.total}`;
    const failed = v.failed > 0 ? P.chipFailed(v.failed) : '';
    return {
        label: P.chipLabel,
        count: failed ? `${main} ${failed}` : main,
        main,
        failed,
        aria: P.chipAria(v.done, v.total),
        share: v.total > 0 ? v.done / v.total : 0,
    };
}

/** Why the photos did not load: the first reason in the order offline → timeout → missing (§7). */
export function failedReasonText(reasons: readonly ImageFailReason[]): string {
    const why = (['offline', 'timeout', 'missing'] as const).find(r => reasons.includes(r));
    if (why === 'timeout') return strings.busy.errTimeout(Math.round(IMAGE_ANSWER_MS / 1000));
    if (why === 'missing') return strings.photos.whyMissing;
    return strings.busy.errOffline;
}

/** What the indicator's decisions act through (the page, or a test). */
export interface ChipDeps {
    /** The tree open now (a snapshot of another is not shown). */
    currentTreeId(): string | null;
    /** Show the view (null: hidden). */
    render(view: ChipView | null): void;
    /** The photos of this round that did not load: the notice (it replaces one before it). */
    showFailed(s: ImageLoadSnapshot): void;
    /** The notice goes (a new round, another load, all came after all). */
    closeFailed(): void;
    /** Said once, politely (the end ✓). */
    announce(text: string): void;
}

/** The indicator's decisions over the queue's snapshots (no DOM). */
export class ImageLoadChipModel {
    private view: ChipView | null = null;
    private last: ImageLoadSnapshot | null = null;
    private showTimer: ReturnType<typeof setTimeout> | null = null;
    private doneTimer: ReturnType<typeof setTimeout> | null = null;
    private held = 0;
    private failedShown = false;

    constructor(private readonly deps: ChipDeps) {}

    /** What is shown now (null: hidden; held back counts as hidden). */
    shown(): ChipView | null {
        return this.held > 0 ? null : this.view;
    }

    /** A snapshot of the queue (strom:images-state). */
    update(s: ImageLoadSnapshot): void {
        const before = this.last;
        const sameLoad = !!before && before.treeId === s.treeId && before.seq === s.seq;
        this.last = s;
        if (s.phase === 'idle' || s.treeId === null || s.treeId !== this.deps.currentTreeId()) {
            this.hide();
            this.closeFailed();
            return;
        }
        if (!sameLoad) this.closeFailed();
        if (s.phase === 'running') {
            this.clearDone();
            // A new round (Try again): the notice goes, the indicator counts the whole tree again.
            this.closeFailed();
            if (this.view) this.set(this.runView(s));
            else if (!this.showTimer) {
                this.showTimer = setTimeout(() => {
                    this.showTimer = null;
                    const now = this.last;
                    if (now?.phase === 'running' && now.treeId === this.deps.currentTreeId()) this.set(this.runView(now));
                }, CHIP_SHOW_MS);
            }
            return;
        }
        // Done: nothing more to come this round.
        this.clearShow();
        const roundEnded = sameLoad && before!.phase === 'running';
        if (s.failed > 0) {
            this.hide();
            // Held back for an output's wait: its own alert asks about them (§8), not a second one.
            if (roundEnded && !this.held) {
                this.failedShown = true;
                this.deps.showFailed(s);
            }
            return;
        }
        this.closeFailed();
        if (this.view?.kind === 'run') {
            this.set({ kind: 'ok', total: s.total });
            this.deps.announce(`✓ ${strings.photos.chipLabel} ${s.total} / ${s.total}`);
            this.doneTimer = setTimeout(() => {
                this.doneTimer = null;
                if (this.view?.kind === 'ok') this.set(null);
            }, BUSY_DONE_MS);
        }
    }

    /** Another tree is open now. */
    treeSwitched(): void {
        const s = this.last;
        if (s && s.treeId !== this.deps.currentTreeId()) {
            this.hide();
            this.closeFailed();
        }
    }

    /**
     * Hold the indicator back (an output's progress toast counts the photos,
     * §8), its notice of photos not loaded gone (the output asks about them);
     * the returned function lets it show again (once per hold).
     */
    suspend(): () => void {
        this.held++;
        this.deps.render(null);
        // The output asks about those not loaded itself: one alert, not two.
        this.closeFailed();
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.held = Math.max(0, this.held - 1);
            if (!this.held) this.deps.render(this.view);
        };
    }

    /** Stop every timer (tests, a page going). */
    dispose(): void {
        this.clearShow();
        this.clearDone();
    }

    private runView(s: ImageLoadSnapshot): ChipView {
        return { kind: 'run', done: s.done, total: s.total, failed: s.failed, left: s.left };
    }

    private set(view: ChipView | null): void {
        this.view = view;
        if (!this.held) this.deps.render(view);
    }

    private hide(): void {
        this.clearShow();
        this.clearDone();
        if (this.view) this.set(null);
    }

    private closeFailed(): void {
        if (!this.failedShown) return;
        this.failedShown = false;
        this.deps.closeFailed();
    }

    private clearShow(): void {
        if (this.showTimer) clearTimeout(this.showTimer);
        this.showTimer = null;
    }

    private clearDone(): void {
        if (this.doneTimer) clearTimeout(this.doneTimer);
        this.doneTimer = null;
    }
}

// ==================== ON THE PAGE ====================

let model: ImageLoadChipModel | null = null;

/** Hold the indicator back while an output's progress toast counts the photos (§6.1, §8); call the result to let it show. */
export function suspendImageLoadChip(): () => void {
    return model ? model.suspend() : () => undefined;
}

/** The indicator in the page (the main window, once). `currentTreeId`: the tree open now. */
export function initImageLoadChip(currentTreeId: () => string | null): void {
    if (model || typeof document === 'undefined') return;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.id = 'img-load-chip';
    chip.className = 'img-load-chip';
    chip.hidden = true;
    chip.setAttribute('aria-haspopup', 'dialog');
    chip.setAttribute('aria-expanded', 'false');
    chip.setAttribute('aria-controls', 'img-load-pop');
    const ok = document.createElement('span');
    ok.className = 'ok';
    ok.setAttribute('aria-hidden', 'true');
    ok.textContent = '✓';
    const label = document.createElement('span');
    label.className = 'prog-t';
    const count = document.createElement('span');
    count.className = 'img-load-n';
    const bar = barEl(0);
    chip.append(ok, label, count, bar);
    document.body.appendChild(chip);

    const pop = document.createElement('div');
    pop.id = 'img-load-pop';
    pop.className = 'img-load-pop';
    pop.setAttribute('role', 'dialog');
    pop.hidden = true;
    document.body.appendChild(pop);

    let view: ChipView | null = null;
    let toast: ToastHandle | null = null;

    const fillPop = (): void => {
        if (!view || view.kind !== 'run') return void closePop();
        const P = strings.photos;
        pop.setAttribute('aria-label', P.chipLabel);
        const head = document.createElement('b');
        head.textContent = `${P.chipLabel} ${view.done} / ${view.total}`;
        const left = document.createElement('span');
        left.textContent = P.detailLeft(view.left, view.failed);
        const note = document.createElement('span');
        note.className = 'img-load-pop-note';
        note.textContent = P.detailEditable;
        pop.replaceChildren(head, left, note);
        placePop();
    };
    const placePop = (): void => {
        if (pop.hidden) return;
        const r = chip.getBoundingClientRect();
        const up = r.top > window.innerHeight / 2;
        pop.style.left = `${r.left + r.width / 2}px`;
        pop.style.top = up ? '' : `${r.bottom + 6}px`;
        pop.style.bottom = up ? `${window.innerHeight - r.top + 6}px` : '';
    };
    const onKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape' || pop.hidden) return;
        e.stopPropagation();
        closePop();
        chip.focus();
    };
    const onDown = (e: PointerEvent): void => {
        const t = e.target as Node | null;
        if (t && (pop.contains(t) || chip.contains(t))) return;
        closePop();
    };
    function closePop(): void {
        if (pop.hidden) return;
        pop.hidden = true;
        chip.setAttribute('aria-expanded', 'false');
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('pointerdown', onDown, true);
    }
    const openPop = (): void => {
        if (!view || view.kind !== 'run') return;
        pop.hidden = false;
        chip.setAttribute('aria-expanded', 'true');
        fillPop();
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('pointerdown', onDown, true);
    };
    chip.addEventListener('click', () => (pop.hidden ? openPop() : closePop()));

    /** Keep clear of the pills of the tree (the highlight, following): below those at the top, above those at the bottom. */
    const clearOfPills = (): void => {
        let below = 0;
        let above = 0;
        const vh = window.innerHeight;
        for (const p of document.querySelectorAll<HTMLElement>('body > .evidence-pill')) {
            const r = p.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            if (r.top < vh / 2) below = Math.max(below, r.bottom + 8);
            else above = Math.max(above, vh - r.top + 8);
        }
        // A message at the bottom (at most 1024 wide the indicator stands there too): above it while it shows,
        // not under it. Its place without the slide it comes in with (offsetTop leaves the transform out).
        const t = shownToast();
        if (t?.isConnected && t.offsetHeight > 0 && t.offsetTop > vh / 2) above = Math.max(above, vh - t.offsetTop + 8);
        chip.style.setProperty('--img-chip-below', `${Math.round(below)}px`);
        chip.style.setProperty('--img-chip-above', `${Math.round(above)}px`);
    };
    const pills = typeof MutationObserver === 'function' ? new MutationObserver(() => { clearOfPills(); placePop(); }) : null;

    const render = (v: ChipView | null): void => {
        view = v;
        if (!v) {
            closePop();
            chip.hidden = true;
            pills?.disconnect();
            return;
        }
        const w = chipWords(v);
        label.textContent = w.label;
        // "· 3 not loaded" its own piece: on a phone it goes to the next line whole, not a word a line.
        count.replaceChildren(w.main);
        if (w.failed) {
            const f = document.createElement('span');
            f.className = 'img-load-f';
            f.textContent = w.failed;
            count.append(' ', f);
        }
        chip.setAttribute('aria-label', w.aria);
        ok.hidden = v.kind !== 'ok';
        bar.hidden = w.share === null;
        if (w.share !== null) setBarShare(bar, w.share);
        chip.classList.toggle('is-done', v.kind === 'ok');
        if (chip.hidden) {
            chip.hidden = false;
            pills?.observe(document.body, { childList: true, attributes: true, attributeFilter: ['class', 'data-view-mode'] });
        }
        clearOfPills();
        if (v.kind === 'ok') closePop();
        else fillPop();
    };

    model = new ImageLoadChipModel({
        currentTreeId,
        render,
        showFailed: (s) => {
            toast?.close();
            toast = showToast(failedReasonText(s.reasons), Infinity, {
                title: strings.photos.someFailed(s.failed),
                alert: true,
                closable: true,
                kind: IMAGES_FAILED_TOAST,
                // Through the bridge, no terminal, no agent: no mark. Only the load that failed (another may run by then).
                action: {
                    label: strings.busy.retry,
                    run: () => {
                        const q = imageLoads.current();
                        if (q && q.seq === s.seq && q.treeId === s.treeId) q.retry(q.failedKeys());
                    },
                },
            });
        },
        closeFailed: () => {
            toast?.close();
            toast = null;
            document.querySelector(`body > .toast[data-kind="${IMAGES_FAILED_TOAST}"]`)?.remove();
        },
        announce: announceBusy,
    });
    window.addEventListener(IMAGES_STATE_EVENT, (e) => model?.update((e as CustomEvent<ImageLoadSnapshot>).detail));
    window.addEventListener('strom:tree-switched', () => model?.treeSwitched());
    window.addEventListener('resize', () => { if (view) { clearOfPills(); placePop(); } });
    onToastChange(() => { if (view) { clearOfPills(); placePop(); } });
    // A load already under way (the indicator came later than the tree).
    const now = imageLoads.snapshot();
    if (now.phase === 'running') model.update(now);
}
