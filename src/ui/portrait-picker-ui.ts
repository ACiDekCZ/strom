/**
 * "Portrait from a photo" (spec 107): a picker of the photos already at the
 * person — the tree's files and the research's pictures that name them —
 * that opens the crop editor over the one chosen. Nothing is attached or
 * looked for: a research's picture becomes the tree's file only at Done (or
 * the person dialog's Save), as "Use as portrait…" in the materials.
 *
 * A popover at its button with a mouse in a window over 1024 px; a bottom
 * sheet on touch and in narrower windows (a panel at the right on a phone
 * held sideways). One picker at a time. A person without such photos gets
 * today's file picker straight away.
 */

import { imgSrcAttr } from '../image-src.js';
import { DataManager } from '../data.js';
import { PersonId, Person, PortraitCrop } from '../types.js';
import { strings } from '../strings.js';
import { cachedMaterialList } from '../materials.js';
import { materialThumbs } from '../material-thumbs.js';
import { IMAGES_ARRIVED_EVENT, IMAGES_STATE_EVENT } from '../image-loads.js';
import { isTabletOrMobile } from '../breakpoints.js';
import { nameHtml } from '../person-name.js';
import { PortraitCandidate, portraitCandidates, photoPeopleOthers, portraitInitialFor } from '../portrait-candidates.js';
import { canEditPortrait, pickImageFile, portraitLinkImage, treePortraitCopy } from './portrait-actions-ui.js';
import { materialImageWait, materialTileLetters } from './materials-ui.js';
import { isCoarsePointer } from './bottom-sheet.js';
import { setTileState, tileFailedHtml, waitingTileHtml } from './image-slot.js';
import { busySpinHtml } from './busy.js';
import { uiModule } from './module.js';
import { researchActionLabel } from './research-open-mark.js';
import type { ResearchActionMark } from '../research-link.js';

/** Where the picker was opened: the person dialog (the portrait waits for Save) or the person page (written at once). */
export type PortraitPickWhere = 'dialog' | 'page';

export interface PortraitPickerModel {
    shown: PortraitCandidate[];
    /** The research's pictures left out while its bridge does not run. */
    researchOnly: number;
}

const POPOVER_ID = 'portrait-pick';
/** The tile's preview side (px) for "Not loaded" and the veil. */
const TILE_PX = 112;

interface PickerState {
    personId: PersonId;
    anchor: HTMLElement;
    where: PortraitPickWhere;
    kind: 'popover' | 'sheet';
    /** Where the picker draws (the popover, the sheet's body). */
    host: HTMLElement;
    /** What goes away on close (the popover, the sheet's overlay). */
    root: HTMLElement;
    /** The tile whose working copy is on its way, and the one that did not come. */
    busy: string | null;
    failed: string | null;
    /** The latest choice: a later one (or a close) drops an earlier answer. */
    token: number;
    off: () => void;
}

let picker: PickerState | null = null;
let pickSeq = 0;

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The preview size asked of the queue (a 2× display: the larger one). */
function thumbPx(): 128 | 256 {
    return typeof window !== 'undefined' && (window.devicePixelRatio ?? 1) >= 2 ? 256 : 128;
}

/** What the picker draws from (pure; tests). */
export interface PortraitPickerView {
    sheet: boolean;
    /** "From this device…" (touch) instead of "From the computer…". */
    touch: boolean;
    model: PortraitPickerModel;
    busy: string | null;
    failed: string | null;
    /** The "Start research" link's mark (drawn with its label), null: no link. */
    start: ResearchActionMark | null;
    thumbs?: { urlOf(sha: string, px: number): string | null; isWaiting(sha: string, px: number): boolean };
    px?: number;
}

/** A tile's accessible name: the photo, the others in it, the Portrait tag. */
export function portraitTileLabel(c: PortraitCandidate): string {
    const parts = [c.title];
    if (c.others.length) parts.push(strings.portrait.others(c.others.length));
    if (c.isSource) parts.push(strings.attachments.portraitTag);
    return parts.join(', ');
}

function tileHtml(c: PortraitCandidate, v: PortraitPickerView, first: boolean): string {
    const waiting = c.waits === 'loading';
    const busy = v.busy === c.key;
    const failed = v.failed === c.key;
    const letters = `<span class="portrait-pick-letters">${esc(materialTileLetters(c.item))}</span>`;
    const tag = c.isSource ? `<span class="attachment-tag portrait-pick-tag" title="${esc(strings.attachments.portraitTagTitle)}">${esc(strings.attachments.portraitTag)}</span>` : '';
    const over = busy ? `<span class="portrait-pick-busy">${busySpinHtml(14)}</span>` : '';
    const px = v.px ?? 128;
    let img: string;
    if (waiting) {
        img = waitingTileHtml('loading', { tag: 'span', cls: 'portrait-pick-img', px: TILE_PX, content: letters, extra: tag });
    } else if (failed) {
        img = `<span class="portrait-pick-img is-failed">${tileFailedHtml(TILE_PX)}${tag}</span>`;
    } else if (c.image) {
        img = `<span class="portrait-pick-img"><img ${imgSrcAttr(c.image)} alt="">${tag}${over}</span>`;
    } else {
        const ready = c.sha ? v.thumbs?.urlOf(c.sha, px) : null;
        const veil = !ready && c.sha && v.thumbs?.isWaiting(c.sha, px) ? ' data-img-state="loading"' : '';
        img = ready
            ? `<span class="portrait-pick-img"><img src="${esc(ready)}" alt="">${tag}${over}</span>`
            : `<span class="portrait-pick-img"${c.sha ? ` data-sha="${esc(c.sha)}"` : ''}${veil}>${letters}${tag}${over}</span>`;
    }
    const names = c.others.filter(Boolean);
    const title = waiting ? strings.photos.loading : names.length ? strings.portrait.alsoIn(names.join(', ')) : '';
    const cls = `portrait-pick-tile${waiting ? ' is-waiting' : ''}${busy ? ' is-busy' : ''}`;
    return `<button type="button" class="${cls}" data-key="${esc(c.key)}" tabindex="${first ? 0 : -1}" aria-label="${esc(portraitTileLabel(c))}"`
        + `${title ? ` title="${esc(title)}"` : ''}${waiting ? ' aria-disabled="true"' : ''}${busy ? ' aria-busy="true"' : ''}>`
        + `${img}<span class="portrait-pick-cap">${esc(c.title)}</span>`
        + `${c.others.length ? `<span class="portrait-pick-others">${esc(strings.portrait.others(c.others.length))}</span>` : ''}</button>`;
}

/** The picker's content: header, tiles, the research's sentence, the state of a choice, "From the computer…". */
export function portraitPickerHtml(v: PortraitPickerView): string {
    const p = strings.portrait;
    const n = v.model.shown.length;
    const head = v.sheet
        ? `<div class="bottom-sheet-section portrait-pick-section">${esc(p.pickTitle)}${n ? ` · ${n}` : ''}</div>`
        : `<div class="portrait-pick-head"><span class="portrait-pick-title">${esc(p.pickTitle)}</span><span class="portrait-pick-count">${n || ''}</span></div>`;
    const grid = n ? `<div class="portrait-pick-grid">${v.model.shown.map((c, i) => tileHtml(c, v, i === 0)).join('')}</div>` : '';
    const note = v.model.researchOnly > 0
        ? `<p class="portrait-pick-note" role="note">${esc(p.researchDown(v.model.researchOnly))}${v.start ? ` <button type="button" class="link-button portrait-pick-start" data-pick-act="start">${researchActionLabel(strings.sync.startResearch, v.start)}</button>` : ''}</p>`
        : '';
    let status = '';
    if (v.busy) status = `<p class="portrait-pick-status busy-st" role="status">${busySpinHtml(12)} ${esc(p.pickLoading)}</p>`;
    else if (v.failed) {
        status = `<p class="portrait-pick-status busy-msg is-err" role="status"><span>${esc(p.pickFailed)}</span> `
            + `<button type="button" class="link" data-pick-act="retry">${esc(strings.materials.retry)}</button></p>`;
    }
    const fileLabel = esc(v.touch ? p.fromDevice : p.fromComputer);
    const foot = v.sheet
        ? `<div class="bottom-sheet-divider" role="separator"></div><button type="button" class="bottom-sheet-item portrait-pick-file" data-pick-act="file">${fileLabel}</button>`
        : `<div class="portrait-pick-sep" role="separator"></div><button type="button" class="portrait-pick-item portrait-pick-file" data-pick-act="file">${fileLabel}</button>`;
    return head + grid + note + status + foot;
}

export const portraitPickerMethods = uiModule({
    /**
     * The photos a portrait of the person can be cut from now: the person's
     * materials as their section shows them (without a research that lists
     * them, on touch or with an older research: the tree's files only), what
     * "Use as portrait…" offers of them; a tree's file still on its way shown
     * waiting.
     */
    portraitPickerModel(personId: PersonId): PortraitPickerModel {
        const person = DataManager.getPerson(personId);
        if (!person) return { shown: [], researchOnly: 0 };
        const mc = this.materialsContext();
        const caps = mc?.caps ?? null;
        const list = mc?.caps.list ? cachedMaterialList(mc.treeId) : null;
        return portraitCandidates({
            items: this.personMaterialItems(personId),
            // A file still on its way is not in the tree's data yet: shown waiting when it is a picture.
            offer: item => materialImageWait(item) !== 'none'
                ? (item.attachment?.mimeType.startsWith('image/') && canEditPortrait(personId) ? { bridge: false } : null)
                : this.materialPortraitOffer(item, personId, caps),
            bridgeUp: !!caps?.bridgeUp && !!mc?.base,
            sourceId: this.portraitSourceAttachmentShown(person),
            treeCopy: treePortraitCopy,
            others: item => photoPeopleOthers(item, person, list?.people),
            waits: materialImageWait,
        });
    },

    /**
     * Open the picker at `anchor` ("Choose photo", and the entries of the
     * person dialog's header and the person page). A person without photos
     * to offer: today's file picker (the dialog's input; on the page a picker
     * of its own whose portrait is written at once).
     */
    openPortraitPicker(personId: PersonId, anchor: HTMLElement, opts: { where: PortraitPickWhere }): void {
        const again = !!picker && picker.anchor === anchor && picker.personId === personId;
        this.closePortraitPicker(false);
        // Its own button again: closed.
        if (again) return;
        const person = DataManager.getPerson(personId);
        if (!person || !canEditPortrait(personId)) return;
        const model = this.portraitPickerModel(personId);
        if (model.shown.length === 0 && model.researchOnly === 0) {
            this.portraitPickFile(personId, opts.where);
            return;
        }
        const sheet = isCoarsePointer() || isTabletOrMobile();
        let host: HTMLElement;
        let root: HTMLElement;
        if (sheet) {
            host = this.presentPortraitSheet(nameHtml(person), {
                label: strings.portrait.pickTitle,
                // Closed by the sheet itself (a swipe, a tap beside it, Escape).
                onClose: () => { if (picker?.host === host) dropPicker(); },
            });
            root = host.closest<HTMLElement>('.bottom-sheet-overlay') ?? host;
        } else {
            host = document.createElement('div');
            host.id = POPOVER_ID;
            host.className = 'portrait-pick';
            host.setAttribute('role', 'dialog');
            host.setAttribute('aria-label', strings.portrait.pickTitle);
            document.body.appendChild(host);
            root = host;
        }
        const onKey = (e: KeyboardEvent): void => {
            if (e.key !== 'Escape' || !picker) return;
            // The crop editor or a dialog over the picker takes its own Escape.
            if (document.querySelector('.portrait-editor-overlay')) return;
            e.preventDefault();
            e.stopPropagation();
            this.closePortraitPicker(true);
        };
        const onDown = (e: MouseEvent): void => {
            const t = e.target as Node | null;
            if (!picker || picker.kind !== 'popover' || !t) return;
            if (picker.root.contains(t) || picker.anchor.contains(t)) return;
            this.closePortraitPicker(false);
        };
        const onImages = (): void => this.renderPortraitPicker();
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('mousedown', onDown, true);
        window.addEventListener(IMAGES_ARRIVED_EVENT, onImages);
        window.addEventListener(IMAGES_STATE_EVENT, onImages);
        picker = {
            personId, anchor, where: opts.where, kind: sheet ? 'sheet' : 'popover', host, root,
            busy: null, failed: null, token: 0,
            off: () => {
                document.removeEventListener('keydown', onKey, true);
                document.removeEventListener('mousedown', onDown, true);
                window.removeEventListener(IMAGES_ARRIVED_EVENT, onImages);
                window.removeEventListener(IMAGES_STATE_EVENT, onImages);
            },
        };
        anchor.setAttribute('aria-expanded', 'true');
        host.addEventListener('click', (e) => this.portraitPickerClick(e));
        host.addEventListener('keydown', (e) => this.portraitPickerKeydown(e));
        this.renderPortraitPicker();
        const first = Array.from(host.querySelectorAll<HTMLElement>('.portrait-pick-tile')).find(t => t.getAttribute('aria-disabled') !== 'true')
            ?? host.querySelector<HTMLElement>('[data-pick-act="file"]');
        if (first?.classList.contains('portrait-pick-tile')) {
            host.querySelectorAll<HTMLElement>('.portrait-pick-tile').forEach(t => t.setAttribute('tabindex', t === first ? '0' : '-1'));
        }
        first?.focus({ preventScroll: true });
    },

    /**
     * Close the picker (Escape, a click beside it, "From the computer…", a
     * photo chosen, the dialog or page closed). `focusAnchor`: the focus back
     * at its button. `only`: only a picker opened there.
     */
    closePortraitPicker(focusAnchor = true, only?: PortraitPickWhere): void {
        const st = picker;
        if (!st || (only && st.where !== only)) return;
        dropPicker();
        if (st.kind === 'popover') st.root.remove();
        else if (this.bottomSheet === st.root) this.hideBottomSheet();
        if (focusAnchor && st.anchor.isConnected) st.anchor.focus({ preventScroll: true });
    },

    /** The picker is open (for this person). */
    portraitPickerOpen(personId?: PersonId): boolean {
        return !!picker && (!personId || picker.personId === personId);
    },

    /**
     * A photo chosen: the crop editor over it. The tree's picture opens at
     * once (the picker closed); a research's picture first comes over the
     * bridge while the picker stays open with its tile busy — not come, the
     * picker says so with "Try again". Another tile chosen meanwhile drops
     * the first answer.
     */
    async pickPortraitCandidate(personId: PersonId, key: string): Promise<void> {
        const c = this.portraitPickerModel(personId).shown.find(x => x.key === key);
        const person = DataManager.getPerson(personId);
        if (!c || !person || c.waits !== 'none') return;
        const initial = this.portraitPickInitial(person, c);
        const opts = initial ? { initial } : {};
        const st = picker && picker.personId === personId ? picker : null;
        if (!c.bridge || !st) {
            this.closePortraitPicker(false);
            await this.useMaterialAsPortrait(personId, c.item, opts);
            return;
        }
        const token = ++pickSeq;
        st.token = token;
        st.busy = key;
        st.failed = null;
        this.renderPortraitPicker();
        const mc = this.materialsContext();
        const record = mc?.caps.bridgeUp && mc.base ? await this.materialWorkingCopy(c.item, mc) : null;
        // Closed, or another photo chosen meanwhile: this answer goes nowhere.
        if (picker !== st || st.token !== token) return;
        if (!record || !portraitLinkImage({ record })) {
            st.busy = null;
            st.failed = key;
            this.renderPortraitPicker();
            return;
        }
        this.closePortraitPicker(false);
        await this.useMaterialLink(personId, { record }, opts);
    },

    /** Where the editor starts over a chosen photo: the portrait's crop when it is cut from it (as shown now). */
    portraitPickInitial(person: Person, c: PortraitCandidate): PortraitCrop | undefined {
        let shown: Pick<Person, 'photo' | 'photoSource'> = person;
        const dialogOpen = this.currentId === person.id && !!document.getElementById('person-modal')?.classList.contains('active');
        if (dialogOpen) {
            const preview = this.photoModel.value;
            const pending = this.pendingPortraitFor(preview);
            if (pending) {
                const origin = pending.origin && 'attachmentId' in pending.origin ? pending.origin : null;
                shown = { photo: pending.photo, photoSource: origin ? { ...origin, ...pending.crop } : undefined };
            } else if (preview !== person.photo) shown = { photo: preview, photoSource: undefined };
        }
        return portraitInitialFor(c.item, shown, treePortraitCopy(c.item)?.id);
    },

    /** "From the computer…" / "From this device…" (and a person without photos): today's file picker, in the same click. */
    portraitPickFile(personId: PersonId, where: PortraitPickWhere): void {
        this.closePortraitPicker(false);
        if (where === 'dialog') {
            (document.getElementById('input-photo') as HTMLInputElement | null)?.click();
            return;
        }
        pickImageFile(file => {
            const person = DataManager.getPerson(personId);
            void this.editPortraitNow(personId, { source: file, fileName: file.name, replace: !!person?.photo });
        });
    },

    /**
     * Draw the open picker again: the bridge came or went (a research's
     * picture in or out at its place by date, the sentence), the materials
     * came, a tree's file arrived. A tile waiting for a bridge that went away
     * did not come. Nothing when no picker is open.
     */
    renderPortraitPicker(): void {
        const st = picker;
        if (!st) return;
        if (!DataManager.getPerson(st.personId) || !canEditPortrait(st.personId)) {
            this.closePortraitPicker(false);
            return;
        }
        const model = this.portraitPickerModel(st.personId);
        if (st.busy && !model.shown.some(c => c.key === st.busy)) {
            st.failed = st.busy;
            st.busy = null;
            st.token = ++pickSeq;
        }
        // The focus stays on the same tile or button.
        const active = document.activeElement as HTMLElement | null;
        const focusKey = active && st.host.contains(active) ? (active.dataset?.key ? `k:${active.dataset.key}` : active.dataset?.pickAct ? `a:${active.dataset.pickAct}` : '') : '';
        const mc = this.materialsContext();
        const queue = materialThumbs();
        const px = thumbPx();
        const computer = mc?.env.onComputer ?? !isCoarsePointer();
        st.host.innerHTML = portraitPickerHtml({
            sheet: st.kind === 'sheet',
            touch: !computer,
            model,
            busy: st.busy,
            failed: st.failed,
            start: computer && model.researchOnly > 0 && this.researchStartUrl() ? this.researchSyncActionMark('startResearch') : null,
            thumbs: queue,
            px,
        });
        // The research's previews through the shared queue (as the materials' rows).
        const tiles = Array.from(st.host.querySelectorAll<HTMLElement>('.portrait-pick-img[data-sha]'));
        if (tiles.length && mc) {
            queue.setEnv({ treeId: mc.treeId, base: mc.base, thumb: mc.caps.thumb, bridgeUp: mc.caps.bridgeUp });
            for (const el of tiles) {
                const sha = el.dataset.sha ?? '';
                const c = model.shown.find(x => x.sha === sha);
                if (!c) continue;
                queue.want(
                    { sha, px, mime: c.item.mime, name: c.item.file?.name ?? c.title, bytes: c.item.bytes, where: strings.portrait.pickTitle },
                    url => {
                        if (!el.isConnected) return;
                        // No preview: the type's letters stay, the tile can still be chosen.
                        setTileState(el, 'none', TILE_PX);
                        if (!url) return;
                        el.querySelector('.portrait-pick-letters')?.remove();
                        el.insertAdjacentHTML('afterbegin', `<img src="${esc(url)}" alt="">`);
                    },
                    () => el.isConnected,
                    () => { if (el.isConnected) setTileState(el, 'loading', TILE_PX); },
                );
            }
        }
        if (focusKey) {
            const sel = focusKey.startsWith('k:') ? `.portrait-pick-tile[data-key="${focusKey.slice(2)}"]` : `[data-pick-act="${focusKey.slice(2)}"]`;
            const again = st.host.querySelector<HTMLElement>(sel);
            if (again) {
                st.host.querySelectorAll<HTMLElement>('.portrait-pick-tile').forEach(t => t.setAttribute('tabindex', t === again ? '0' : '-1'));
                again.focus({ preventScroll: true });
            }
        }
        // A button drawn anew meanwhile (the person page redrawn): the popover stays where it is.
        if (st.kind === 'popover' && st.anchor.isConnected) placePopover(st);
    },

    portraitPickerClick(e: MouseEvent): void {
        const st = picker;
        const target = e.target as HTMLElement | null;
        if (!st || !target) return;
        const act = target.closest<HTMLElement>('[data-pick-act]')?.dataset.pickAct;
        if (act === 'file') {
            this.portraitPickFile(st.personId, st.where);
            return;
        }
        if (act === 'start') {
            this.researchSyncAction('startResearch');
            return;
        }
        if (act === 'retry') {
            if (st.failed) void this.pickPortraitCandidate(st.personId, st.failed);
            return;
        }
        const tile = target.closest<HTMLElement>('.portrait-pick-tile[data-key]');
        if (!tile || tile.getAttribute('aria-disabled') === 'true') return;
        void this.pickPortraitCandidate(st.personId, tile.dataset.key ?? '');
    },

    /** Arrows between the tiles (one in the tab order). */
    portraitPickerKeydown(e: KeyboardEvent): void {
        const st = picker;
        const target = e.target as HTMLElement | null;
        if (!st || !target?.classList.contains('portrait-pick-tile')) return;
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: 0, ArrowDown: 0 }[e.key as 'ArrowLeft'];
        if (step === undefined) return;
        const grid = target.parentElement;
        const tiles = Array.from(st.host.querySelectorAll<HTMLElement>('.portrait-pick-tile'));
        const i = tiles.indexOf(target);
        const cols = grid ? Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length) : 3;
        const delta = e.key === 'ArrowUp' ? -cols : e.key === 'ArrowDown' ? cols : step;
        const next = tiles[i + delta];
        e.preventDefault();
        if (!next) return;
        tiles.forEach(t => t.setAttribute('tabindex', t === next ? '0' : '-1'));
        next.focus();
    },
});

/** Forget the open picker (its listeners, its button's state); its element is the caller's. */
function dropPicker(): void {
    const st = picker;
    if (!st) return;
    picker = null;
    pickSeq++;
    st.off();
    st.anchor.removeAttribute('aria-expanded');
}

/** The popover under its button (above it when there is no room), inside the window 8 px from its edges. */
function placePopover(st: PickerState): void {
    const r = st.anchor.getBoundingClientRect();
    const w = st.root.offsetWidth;
    const h = st.root.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left));
    const top = r.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4;
    st.root.style.left = `${left}px`;
    st.root.style.top = `${top}px`;
}
