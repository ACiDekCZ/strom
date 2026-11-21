/**
 * The materials viewer (spec 017 §4): the image viewer's list mode with the
 * file's details beside it. ‹ ›, arrows and a swipe go through the list the
 * item was opened from (in its order); files the browser does not show get a
 * card (PDF, TIFF, audio, a file not on the computer, one over the app's
 * limit). The details panel names the people (a tree person is a link), the
 * fields that are known and the actions (the writes go to `materialAction`).
 *
 * While the research is not running: images from the remembered previews,
 * other files "open once the research runs", writes shown but disabled.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { isPendingImageUrl } from '../research-image-refs.js';
import { imageLoads } from '../image-loads.js';
import { materialImageWait } from './materials-ui.js';
import { mediaPersonId, treeMedia } from '../media.js';
import { setResearchOpenLabel } from './research-open-mark.js';
import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { Person, PersonId } from '../types.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { researchLinkMark } from '../research-link.js';
import { announcedResearchScheme } from '../research-device.js';
import {
    MaterialItem, cachedMaterialList, materialFileItem, materialType, materialKindLabel, materialFolder,
    materialFromKey, fileExt, fileUrl, thumbUrl, materialSystemLink, getCachedThumb, researchMakesThumb,
    batchFolderLabel, materialDate, attachmentItem,
} from '../materials.js';
import { iconSvg } from '../icons.js';
import { detailsKeys, materialDetailsEdit, materialDetailsFields, materialDetailsOf } from './material-details-ui.js';
import { attachmentResizeState, pdfBlobFromDataUrl } from '../attachments.js';
import { formatBytesShort } from './originals-ui.js';
import { openViewerList, closeImageViewer, viewerListOpen, viewerListIndex, redrawViewerList, relayoutViewer, goViewerList, ViewerSlots } from './image-viewer.js';
import { MaterialOpenCtx, MaterialsContext, appendBreakable, materialItemSha, materialTileLetters, treeAttachmentsKey } from './materials-ui.js';
import { uiModule } from './module.js';

/** Images the browser shows itself. */
const VIEWABLE_IMAGES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const VIEWABLE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
/** Previews the research makes of these (GIF / WebP / TIFF: 415). */
const PREVIEWED = ['image/jpeg', 'image/png'];
/** Larger files open in the system's program (the app does not load them). */
const MAX_VIEW_BYTES = 40 * 1024 * 1024;
const PDF_URL_LIFETIME_MS = 60_000;

interface ViewerState {
    items: MaterialItem[];
    ctx: MaterialOpenCtx;
    /** Object URLs made for this opening (remembered previews), revoked on close. */
    urls: string[];
    /** The phone's sheet pulled up (kept while going through the list). */
    expanded: boolean;
    /** The tree's attachments when it was last drawn (a commit that changed them redraws). */
    drawnAttachments: string;
    /** The item whose title, kind and date are being edited (its key; spec 102 §2). */
    editing: string | null;
    /** "Where used" shows all its places (§3; "+ N more" clicked). */
    usesOpen: boolean;
    /** Go through (spec 102 §8c): the files saved, the shown file's unsaved change (saved when going on). */
    review: { saved: Set<string>; pending: (() => Promise<void>) | null; index: number } | null;
    /** The stage waits for a file of the tree still on its way (spec 116 §5): its coming draws the stage again. */
    stageWaits?: boolean;
}

/**
 * A text field's caret (or selection) reaches its start / end: ← / → go
 * along the review only from there (the whole title selected goes on).
 */
function caretAt(el: EventTarget | null, end: boolean): boolean {
    if (!(el instanceof HTMLInputElement) || el.type !== 'text') return true;
    return end ? (el.selectionEnd ?? 0) === el.value.length : (el.selectionStart ?? 0) === 0;
}

function inTextField(el: EventTarget | null): boolean {
    return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type === 'text');
}

let viewer: ViewerState | null = null;

/** The edit fields' selectors whose typed text a redraw keeps. */
const DRAFT_FIELDS = ['.mat-edit-title', '.mat-edit-date', '.mat-edit-note'];

/** What was typed or chosen in the panel's edit fields (only what differs from what they were drawn with), and the focus. */
interface EditDraft {
    key: string;
    values: [string, string][];
    kind?: string;
    focus?: { sel: string; start: number | null; end: number | null; dir: 'forward' | 'backward' | 'none' | null };
}

function viewerEditForm(): HTMLElement | null {
    return document.querySelector<HTMLElement>('#image-viewer-panel .mv-edit-form');
}

function pressedKind(form: HTMLElement): string {
    return form.querySelector<HTMLElement>('.mat-edit-kind-opt[aria-pressed="true"]')?.dataset.kind ?? '';
}

function takeEditDraft(st: ViewerState): EditDraft | null {
    const form = st.editing ? viewerEditForm() : null;
    if (!form || !st.editing) return null;
    const values: [string, string][] = [];
    for (const sel of DRAFT_FIELDS) {
        const el = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel);
        if (el && el.value !== el.defaultValue) values.push([sel, el.value]);
    }
    const seg = form.querySelector<HTMLElement>('.mat-edit-kind');
    const kind = seg && pressedKind(form) !== (seg.dataset.drawnKind ?? '') ? pressedKind(form) : undefined;
    const active = document.activeElement;
    let focus: EditDraft['focus'];
    if (active instanceof HTMLElement && form.contains(active)) {
        const sel = DRAFT_FIELDS.find(f => active.matches(f))
            ?? (active.matches('.mat-edit-kind-opt') && active.dataset.kind ? `.mat-edit-kind-opt[data-kind="${active.dataset.kind}"]` : undefined);
        const text = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null;
        if (sel) focus = { sel, start: text?.selectionStart ?? null, end: text?.selectionEnd ?? null, dir: text?.selectionDirection ?? null };
    }
    return values.length || kind !== undefined || focus ? { key: st.editing, values, ...(kind !== undefined ? { kind } : {}), ...(focus ? { focus } : {}) } : null;
}

function putEditDraft(st: ViewerState, draft: EditDraft | null): void {
    const form = draft && st.editing === draft.key ? viewerEditForm() : null;
    if (!form || !draft) return;
    for (const [sel, value] of draft.values) {
        const el = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel);
        if (!el) continue;
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (draft.kind !== undefined && pressedKind(form) !== draft.kind) {
        form.querySelector<HTMLButtonElement>(draft.kind ? `.mat-edit-kind-opt[data-kind="${draft.kind}"]` : '.mat-edit-kind-opt[aria-pressed="true"]')?.click();
    }
    const f = draft.focus;
    const el = f ? form.querySelector<HTMLElement>(f.sel) : null;
    if (!f || !el) return;
    el.focus({ preventScroll: true });
    if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && f.start !== null && f.end !== null) {
        el.setSelectionRange(f.start, f.end, f.dir ?? undefined);
    }
}

/**
 * The details drawn anew (the list or the tree changed: an answer of the
 * research, a commit): what is being typed in the edit fields stays, with the
 * focus and the caret (an answer while going through replaced the title under the hand).
 */
function redrawKeepingDraft(st: ViewerState): void {
    const draft = takeEditDraft(st);
    redrawViewerList();
    putEditDraft(st, draft);
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
}

/** The person whose attachment this is (null: it is gone). */
export function attachmentOwner(attachmentId: string): Person | null {
    const id = mediaPersonId(DataManager.getMedia(attachmentId));
    return id ? DataManager.getPerson(id) : null;
}

function receivedTime(iso: string): string {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return '';
    return new Date(t).toLocaleString(getCurrentLanguage(), { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function itemName(item: MaterialItem): string {
    return item.file?.name ?? item.attachment?.name ?? item.title;
}

function isViewableImage(item: MaterialItem): boolean {
    const mime = (item.mime ?? '').toLowerCase();
    if (mime) return VIEWABLE_IMAGES.includes(mime);
    return VIEWABLE_EXT.includes(fileExt(itemName(item)));
}

/** The attachment's own image (a data URL), when it has one. */
function attachmentImage(item: MaterialItem): string | null {
    const att = item.attachment;
    // A stand-in of a file still on its way is never an image to show (spec 116 §5).
    return att && !att.originalOnly && att.mimeType.startsWith('image/') && att.dataUrl && !isPendingImageUrl(att.dataUrl) ? att.dataUrl : null;
}

export function attachmentPdf(item: MaterialItem): { dataUrl: string; mimeType: string } | null {
    const att = item.attachment;
    return att && !att.originalOnly && att.dataUrl && !isPendingImageUrl(att.dataUrl) && att.mimeType === 'application/pdf' ? { dataUrl: att.dataUrl, mimeType: att.mimeType } : null;
}

export function openPdfBlob(pdf: { dataUrl: string; mimeType: string }): boolean {
    const blob = pdfBlobFromDataUrl(pdf.dataUrl, pdf.mimeType);
    if (!blob) return false;
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), PDF_URL_LIFETIME_MS);
    return true;
}

function releaseUrls(state: ViewerState | null): void {
    if (!state) return;
    for (const url of state.urls) URL.revokeObjectURL(url);
    state.urls = [];
}

interface CardButton { label: string; run: () => void; primary?: boolean; /** Opens the research: its mark. */ research?: boolean }

/** The card in place of an image: the type's tile (or a preview), a sentence and its buttons. */
/** An object URL of a downloaded file is let go this long after its click (the save has started by then). */
const DOWNLOAD_URL_LIFETIME_MS = 10_000;

function clickLink(href: string, file: string, newTab: boolean): void {
    const a = document.createElement('a');
    a.href = href;
    a.download = file;
    if (newTab) { a.target = '_blank'; a.rel = 'noopener'; }
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

/**
 * Save a file of another origin (the research's bridge) under its name: a
 * browser ignores `download` on such a link and only opens the file, so it is
 * fetched and saved from a blob. A fetch that fails (CORS, network, the
 * bridge gone): the file opens in a new tab, as the link alone does.
 */
export async function downloadFromBridge(href: string, file: string, fetcher: typeof fetch = fetch): Promise<boolean> {
    let blob: Blob;
    try {
        const res = await fetcher(href, { method: 'GET', mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        blob = await res.blob();
    } catch {
        clickLink(href, file, true);
        return false;
    }
    const url = URL.createObjectURL(blob);
    clickLink(url, file, false);
    setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
    return true;
}

function viewerCard(letters: string, text: string, buttons: CardButton[], preview?: string | null): HTMLElement {
    const card = h('div', 'mv-card');
    const tile = h('div', 'mv-card-tile');
    tile.setAttribute('aria-hidden', 'true');
    if (preview) {
        const img = h('img');
        img.alt = '';
        img.onerror = () => { tile.textContent = letters; };
        img.src = preview;
        tile.appendChild(img);
    } else {
        tile.textContent = letters;
    }
    const sentence = h('p', 'mv-card-text', text);
    sentence.setAttribute('role', 'status');
    card.append(tile, sentence);
    if (buttons.length) {
        const row = h('div', 'mv-card-actions');
        for (const b of buttons) {
            const btn = h('button', b.primary ? 'is-primary' : '', b.label);
            if (b.research) setResearchOpenLabel(btn, b.label);
            btn.type = 'button';
            btn.addEventListener('click', () => b.run());
            row.appendChild(btn);
        }
        card.appendChild(row);
    }
    return card;
}

export const materialViewerMethods = uiModule({
    /**
     * Open `items[index]` (the section's and the window's click): a PDF in a
     * new tab, anything else in the viewer with `items` around it.
     */
    openMaterialItems(items: MaterialItem[], index: number, ctx: MaterialOpenCtx): void {
        const item = items[index];
        if (!item) return;
        if (this.openMaterialPdf(item)) return;
        this.openMaterialViewer(items, index, ctx);
    },

    /** A PDF opened straight in a new tab (true), when it can be (the attachment's copy, or the bridge's file). */
    openMaterialPdf(item: MaterialItem): boolean {
        if (materialType(item.mime, itemName(item)) !== 'pdf') return false;
        const pdf = attachmentPdf(item);
        if (pdf) return openPdfBlob(pdf);
        const ctx = this.materialsContext();
        const sha = materialItemSha(item);
        if (!item.file || !ctx?.caps.bridgeUp || !ctx.base || !sha || !item.here) return false;
        window.open(fileUrl(ctx.base, sha), '_blank', 'noopener');
        return true;
    },

    /** The viewer over `items`, starting at `index` (4a). */
    openMaterialViewer(items: MaterialItem[], index: number, ctx: MaterialOpenCtx): void {
        if (!items[index]) return;
        this.closeMaterialsItemMenu();
        const review = ctx.where === 'review';
        const state: ViewerState = {
            items: [...items], ctx, urls: [], expanded: false, drawnAttachments: treeAttachmentsKey(), editing: null, usesOpen: false,
            review: review ? { saved: new Set(), pending: null, index } : null,
        };
        viewer = state;
        openViewerList(
            {
                count: state.items.length, index,
                show: (i, slots) => this.drawMaterialInViewer(i, slots),
                // F2: the shown item's title, kind and date; P: Link to… (spec 102 §4).
                key: (e) => {
                    if (e.altKey || e.ctrlKey || e.metaKey || viewer !== state) return false;
                    // Going through, the fields stay open: P and S work outside a text field (spec 102 §8c).
                    if (state.editing && !(state.review && !inTextField(e.target))) return false;
                    if (e.key === 'p' || e.key === 'P' || ((e.key === 's' || e.key === 'S') && state.review)) {
                        const id = e.key === 'p' || e.key === 'P' ? 'attach' : 'makeSource';
                        const btn = document.querySelector<HTMLElement>(`#image-viewer-panel .mv-act[data-action="${id}"]`);
                        if (!btn || btn.getAttribute('aria-disabled') === 'true') return false;
                        btn.click();
                        return true;
                    }
                    if (e.key !== 'F2') return false;
                    const item = state.items[viewerListIndex()];
                    if (!item || materialDetailsEdit(item, this.materialsContext()) !== 'on') return false;
                    this.editMaterialInViewer(item.key);
                    return true;
                },
            },
            () => {
                releaseUrls(state);
                if (viewer === state) viewer = null;
                if (state.review) {
                    // Ended (Esc, ×, the last file): what was not saved stays as it was.
                    state.review.pending = null;
                    const saved = state.review.saved.size;
                    this.showToast(strings.materials.bulkDone(saved, state.items.length), 5000, { closable: true, kind: 'materials' });
                    state.ctx.done?.(saved);
                }
            },
        );
    },

    /** Go through: save the shown file's change (if any) and go to the next one; after the last the review ends. */
    async reviewNext(delta: 1 | -1, save: boolean): Promise<void> {
        const st = viewer;
        if (!st?.review) return;
        const pending = st.review.pending;
        st.review.pending = null;
        if (save && pending) await pending();
        if (viewer !== st) return;
        const at = viewerListIndex();
        if (delta > 0 && at >= st.items.length - 1) { closeImageViewer(); return; }
        goViewerList(delta);
    },

    /** The remembered list changed: the shown item's details again (its image stays). */
    materialViewerListChanged(): void {
        if (viewer && viewerListOpen()) redrawKeepingDraft(viewer);
    },

    /** A commit or an undo: the details again when the tree's attachments changed. */
    materialViewerTreeChanged(): void {
        if (!viewer || !viewerListOpen()) return;
        const key = treeAttachmentsKey();
        if (key === viewer.drawnAttachments) return;
        viewer.drawnAttachments = key;
        // The shown file was on its way: it came (its image) or did not (Try again) — the stage too.
        if (viewer.stageWaits) redrawViewerList({ stage: true });
        else redrawKeepingDraft(viewer);
    },

    /** The item as it is now (the remembered list changed after an action; an attachment may be gone). */
    freshMaterialItem(item: MaterialItem): MaterialItem {
        let attachment = item.attachment;
        // The tree's file as it is now (its title, kind or date may have changed).
        if (attachment) {
            // A file still on its way is the tree's too (spec 116 §5: the view's record, its stand-in).
            const now = DataManager.getMedia(attachment.id) ?? imageLoads.view(DataManager.getData()).media?.[attachment.id];
            attachment = now?.places.length ? now : undefined;
        }
        if (!item.file) return attachment ? { ...attachmentItem(attachment, item.persons), ...(item.uses !== undefined ? { uses: item.uses } : {}) } : item;
        // Linked here (spec 102 §4) or restored: the tree's record of the same original joins it.
        if (!attachment && item.file.sha) {
            const sha = item.file.sha.toLowerCase();
            attachment = treeMedia(DataManager.getData()).find(a => a.original?.sha256?.toLowerCase() === sha);
        }
        const ctx = this.materialsContext();
        const list = ctx ? cachedMaterialList(ctx.treeId) : null;
        const file = list?.files.find(f => f.id === item.file!.id);
        const built = !list || !file
            ? (attachment === item.attachment ? item : { ...materialFileItem(item.file, { batches: [] }, attachment), batch: item.batch })
            : materialFileItem(file, list, attachment);
        // The file of a source (spec 102 §7): its sources as the research says them now.
        const of = ctx?.caps.list && ctx.caps.sourceOf ? (file ?? item.file).uses?.of : undefined;
        const fresh = of?.length ? { ...built, sourceOf: of } : built;
        // Taken out of the tree and not back yet: still hidden "removed".
        const wasId = item.removedId ?? item.attachment?.id;
        const out = !attachment && wasId ? DataManager.getMedia(wasId) : undefined;
        if (out && !out.places.length && out.removed) return { ...fresh, removedId: out.id, hidden: { reason: 'removed' } };
        if (fresh.removedId && attachment) { const { removedId: _r, hidden: _h, ...rest } = fresh; return rest; }
        return fresh;
    },

    drawMaterialInViewer(index: number, slots: ViewerSlots): void {
        const st = viewer;
        if (!st) return;
        const item = this.freshMaterialItem(st.items[index]);
        st.items[index] = item;
        const ctx = this.materialsContext();
        let pending: (() => Promise<void>) | null = null;
        if (st.review) {
            // Another file: the one before keeps what was typed in it (← → and a swipe save as well).
            if (st.review.index !== index) {
                pending = st.review.pending;
                st.review.pending = null;
                st.review.index = index;
            }
            // "Esc ends" only where there is a keyboard: a touch screen's line would run under the zoom buttons.
            const esc = window.matchMedia('(pointer: coarse)').matches ? '' : ` · ${strings.materials.reviewEsc}`;
            slots.pos(`${strings.materials.reviewHead(index + 1, st.items.length, st.ctx.label ?? '')}${esc}`);
            st.editing = materialDetailsEdit(item, ctx) === 'on' ? item.key : null;
            st.expanded = true;
        } else slots.pos(strings.materials.viewerPos(index + 1, st.items.length, st.ctx.label ?? ''));
        if (st.editing && st.editing !== item.key) st.editing = null;
        if (!slots.redraw) this.drawMaterialStage(item, ctx, slots, st);
        this.drawMaterialPanel(item, ctx, slots.panel, st);
        // Saved after this file is drawn: the save's redraw draws the panel anew instead of a second copy.
        if (pending) void pending();
        // Going through: the title field ready for typing (on a computer; a phone's keyboard waits for a tap).
        if (st.review && st.editing === item.key && !slots.redraw && !window.matchMedia?.('(pointer: coarse)').matches) {
            const ready = (): void => {
                if (viewer !== st || viewerListIndex() !== index) return;
                const title = slots.panel.querySelector<HTMLInputElement>('.mat-edit-title');
                if (!title || document.activeElement === title) return;
                title.focus();
                title.select();
            };
            // At once when going on (←, →, Enter, Skip), so a key pressed right after reaches the field
            // and not the viewer behind it (a → there would move the image instead of going on).
            ready();
            // The first file is drawn before the overlay takes the focus: after it, once more.
            setTimeout(ready, 0);
        }
    },

    /** The panel's title becomes its fields (✎, F2, "Add a title"). */
    editMaterialInViewer(key: string): void {
        const st = viewer;
        if (!st) return;
        st.editing = key;
        st.expanded = true;
        redrawViewerList();
        const title = document.querySelector<HTMLInputElement>('#image-viewer-panel .mat-edit-title');
        title?.focus();
        title?.select();
    },

    /** Back from editing: the panel again, the focus on ✎. */
    endMaterialEdit(): void {
        const st = viewer;
        if (!st) return;
        st.editing = null;
        redrawViewerList();
        document.querySelector<HTMLElement>('#image-viewer-panel .mv-edit')?.focus();
    },

    /** The edit's fields with Save / Cancel (Enter, Esc; Esc does not close the viewer). */
    materialEditForm(item: MaterialItem): HTMLElement {
        const m = strings.materials;
        const { note: _note, ...before } = materialDetailsOf(item);
        const fields = materialDetailsFields(before);
        const form = h('div', 'mv-edit-form');
        form.appendChild(fields.root);
        const bar = h('div', 'mv-edit-bar');
        const save = h('button', 'mv-act is-primary', strings.buttons.save);
        save.type = 'button';
        save.dataset.action = 'saveDetails';
        const cancel = h('button', 'mv-act', strings.buttons.cancel);
        cancel.type = 'button';
        cancel.dataset.action = 'cancelDetails';
        const st = viewer;
        if (st?.review) return this.reviewEditForm(item, form, fields, before, bar, save, cancel);
        bar.append(save, cancel, h('span', 'mv-keys', m.keysHint));
        form.appendChild(bar);
        const run = async () => {
            if (save.getAttribute('aria-busy') === 'true') return;
            const after = fields.read();
            if (!after) return;
            save.setAttribute('aria-busy', 'true');
            const ok = await this.saveMaterialDetails(item, before, after);
            save.removeAttribute('aria-busy');
            if (ok && viewer?.editing === item.key) this.endMaterialEdit();
        };
        save.addEventListener('click', () => void run());
        cancel.addEventListener('click', () => this.endMaterialEdit());
        detailsKeys(form, () => void run(), () => this.endMaterialEdit());
        return form;
    },

    /**
     * The fields while going through (8c): "Save and next →" (under Without
     * source: "Create a source from this file…" first), "Skip"; Enter or →
     * at the field's end save and go on, ← goes back (saving), Esc ends.
     */
    reviewEditForm(item: MaterialItem, form: HTMLElement, fields: ReturnType<typeof materialDetailsFields>, before: ReturnType<typeof materialDetailsOf>, bar: HTMLElement, save: HTMLButtonElement, skip: HTMLButtonElement): HTMLElement {
        const m = strings.materials;
        const st = viewer!;
        const review = st.review!;
        save.textContent = m.saveNext;
        save.dataset.action = 'saveNext';
        skip.textContent = m.skipFile;
        skip.dataset.action = 'skip';
        const touch = window.matchMedia?.('(pointer: coarse)').matches;
        const keys = h('span', touch ? 'mv-keys is-swipe' : 'mv-keys', touch ? m.reviewSwipe : m.reviewKeys);
        if (st.ctx.noSource && this.canEditSources() && !DataManager.isReadOnly()) {
            const make = h('button', 'mv-act is-primary', m.makeSource);
            make.type = 'button';
            make.dataset.action = 'reviewSource';
            save.classList.remove('is-primary');
            make.addEventListener('click', () => void (async () => {
                await review.pending?.();
                review.pending = null;
                const fresh = this.freshMaterialItem(item);
                if (await this.makeSourceFromMaterial(fresh, { personId: this.materialContextPerson() }) && viewer === st) {
                    review.saved.add(item.key);
                    void this.reviewNext(1, false);
                }
            })());
            bar.append(make);
        }
        bar.append(save, skip, keys);
        form.appendChild(bar);
        // What would be saved now (none when nothing changed or the date cannot be read).
        const pending = async (): Promise<void> => {
            const after = fields.read();
            if (!after) return;
            const changed = after.title !== before.title || after.kind !== before.kind || after.date !== before.date;
            if (!changed) return;
            if (await this.saveMaterialDetails(item, before, after)) review.saved.add(item.key);
        };
        review.pending = pending;
        save.addEventListener('click', () => void this.reviewNext(1, true));
        skip.addEventListener('click', () => void this.reviewNext(1, false));
        form.dataset.ownKeys = '';
        form.addEventListener('keydown', (e) => {
            if (e.isComposing) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                review.pending = null;
                closeImageViewer();
            } else if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
                e.preventDefault();
                e.stopPropagation();
                if (fields.read()) void this.reviewNext(1, true);
            } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.shiftKey && caretAt(e.target, e.key === 'ArrowRight')
                && !(e.target as HTMLElement).closest('.mat-edit-kind')) {
                e.preventDefault();
                e.stopPropagation();
                void this.reviewNext(e.key === 'ArrowRight' ? 1 : -1, true);
            }
        });
        return form;
    },

    /** The image, or the card for a file the browser does not show (§4.1, §8.1). */
    drawMaterialStage(item: MaterialItem, ctx: MaterialsContext | null, slots: ViewerSlots, st: ViewerState): void {
        const m = strings.materials;
        const letters = materialTileLetters(item);
        const ext = fileExt(itemName(item)).toUpperCase() || letters;
        const sha = materialItemSha(item);
        const up = !!ctx?.caps.bridgeUp && !!ctx.base;
        const inArchive = item.origin !== 'tree' && !!item.file;
        const attImage = attachmentImage(item);
        const pdf = attachmentPdf(item);
        const type = materialType(item.mime, itemName(item));
        const systemLink = inArchive && ctx && sha && ctx.caps.openLinks !== false
            ? materialSystemLink(ctx.researchId, sha, announcedResearchScheme()) : null;
        const openSystem: CardButton[] = systemLink ? [{ label: m.openSystem, run: () => this.launchResearchLink(systemLink), research: researchLinkMark('media') !== 'none' }] : [];
        const startUrl = this.researchStartUrl();
        const start: CardButton[] = startUrl ? [{ label: strings.sync.startResearch, run: () => this.researchSyncAction('startResearch'), primary: true, research: this.researchSyncActionMark('startResearch') !== 'none' }] : [];
        const fallback = () => slots.card(viewerCard(letters, m.openSystemText(ext), openSystem));

        // A file of the tree still on its way (spec 116 §5, as §4.4): "Loading the photo…", or not come with Try again.
        const waits = materialImageWait(item);
        st.stageWaits = waits !== 'none';
        if (waits === 'loading' || waits === 'failed') {
            const id = item.attachment?.id;
            slots.wait(waits, waits === 'failed' && id ? () => imageLoads.retry([`media:${id}`]) : undefined);
            return;
        }

        // A family tree file (spec 117 §5): no preview, its letters and its kind.
        if (item.tree) {
            slots.card(viewerCard(letters, m.treeFile, []));
            return;
        }
        // Only in the tree: its own copy.
        if (!inArchive) {
            if (attImage) slots.image(attImage, null, fallback);
            else if (pdf) slots.card(viewerCard('PDF', m.pdfText, [{ label: m.openPdf, run: () => openPdfBlob(pdf), primary: true }]));
            else slots.card(viewerCard(letters, m.openSystemText(ext), []));
            return;
        }
        // Not on the research's computer: the tree's copy when there is one, else only the record.
        if (!item.here) {
            if (attImage) slots.image(attImage, null, fallback);
            else slots.card(viewerCard(letters, ctx?.agent ? m.notHereResearch : m.notHere, []));
            return;
        }
        const big = (item.bytes ?? 0) > MAX_VIEW_BYTES;
        if (type === 'image' && isViewableImage(item) && !big) {
            if (up && sha) {
                const mime = (item.mime ?? '').toLowerCase();
                const preview = attImage ?? (ctx!.caps.thumb && PREVIEWED.includes(mime) ? thumbUrl(ctx!.base!, sha, 512) : null);
                slots.image(fileUrl(ctx!.base!, sha), preview, fallback);
                return;
            }
            if (attImage) {
                slots.image(attImage, null, fallback);
                return;
            }
            void this.rememberedPreview(ctx, sha).then(url => {
                if (url) {
                    st.urls.push(url);
                    slots.image(url, null, () => slots.card(viewerCard(letters, m.opensWhenRunning, [...start, ...openSystem])));
                    slots.note(m.previewOnly);
                } else {
                    slots.card(viewerCard(letters, m.opensWhenRunning, [...start, ...openSystem]));
                }
            });
            return;
        }
        // An image the browser does not show (TIFF, HEIC) with the tree's copy: that copy.
        if (type === 'image' && attImage) {
            slots.image(attImage, null, fallback);
            return;
        }
        if (type === 'pdf') {
            if (pdf) slots.card(viewerCard('PDF', m.pdfText, [{ label: m.openPdf, run: () => openPdfBlob(pdf), primary: true }]));
            else if (up && sha) slots.card(viewerCard('PDF', m.pdfText, [{ label: m.openPdf, run: () => { window.open(fileUrl(ctx!.base!, sha), '_blank', 'noopener'); }, primary: true }]));
            else slots.card(viewerCard('PDF', m.opensWhenRunning, [...start, ...openSystem]));
            return;
        }
        if (!up) {
            slots.card(viewerCard(letters, m.opensWhenRunning, [...start, ...openSystem]));
            return;
        }
        // (No preview asked of what the research does not preview: TIFF, GIF, WebP — 415.)
        const preview = ctx!.caps.thumb && sha && type === 'image' && researchMakesThumb(item.mime, itemName(item)) ? thumbUrl(ctx!.base!, sha, 256) : null;
        slots.card(viewerCard(letters, m.openSystemText(ext), openSystem, preview));
    },

    /** A remembered preview of the file (the largest kept), as an object URL. */
    async rememberedPreview(ctx: MaterialsContext | null, sha: string | null): Promise<string | null> {
        if (!ctx || !sha) return null;
        for (const px of [512, 256, 128]) {
            const blob = await getCachedThumb(ctx.treeId, sha, px).catch(() => null);
            if (blob) return URL.createObjectURL(blob);
        }
        return null;
    },

    /** The details panel (4a; the phone's sheet collapsed or pulled up). */
    drawMaterialPanel(item: MaterialItem, ctx: MaterialsContext | null, panel: HTMLElement, st: ViewerState): void {
        const m = strings.materials;
        const agent = !!ctx?.agent;
        const inArchive = item.origin !== 'tree' && !!item.file;
        const up = !!ctx?.caps.bridgeUp && !!ctx?.base;
        const sha = materialItemSha(item);
        panel.classList.toggle('is-expanded', st.expanded);
        const edit = materialDetailsEdit(item, ctx);
        const editing = st.editing === item.key && edit === 'on';
        if (editing) {
            panel.removeAttribute('aria-labelledby');
            panel.setAttribute('aria-label', item.title);
        } else {
            panel.removeAttribute('aria-label');
            panel.setAttribute('aria-labelledby', 'mv-title');
        }

        // Title with ✎ (or its fields while editing), the phone's one line.
        const head = h('div', 'mv-head');
        const name = itemName(item);
        if (editing) {
            head.appendChild(this.materialEditForm(item));
        } else {
            const titleRow = h('div', 'mv-title-row');
            const title = h('h2', 'mv-title');
            appendBreakable(title, item.title);
            title.id = 'mv-title';
            titleRow.appendChild(title);
            if (edit === 'on' || edit === 'off') {
                const pen = h('button', 'mv-edit');
                pen.type = 'button';
                pen.innerHTML = iconSvg('pencil', { size: 14 });
                pen.setAttribute('aria-label', m.editTitle);
                pen.title = edit === 'off' ? m.actionsWhenRunning : m.editTitle;
                if (edit === 'off') pen.setAttribute('aria-disabled', 'true');
                const key = item.key;
                pen.addEventListener('click', () => { if (edit === 'on') this.editMaterialInViewer(key); });
                titleRow.appendChild(pen);
            }
            head.appendChild(titleRow);
            if (!item.titled && edit === 'on') {
                const add = h('button', 'link-button mv-add-title', m.addTitle);
                add.type = 'button';
                const key = item.key;
                add.addEventListener('click', () => this.editMaterialInViewer(key));
                head.appendChild(add);
            }
            if (edit === 'older') head.appendChild(h('p', 'mv-sentence is-muted mv-older-edit', m.olderEdit));
        }
        const summary = [materialKindLabel(item), item.date ? materialDate(item.date) : '', item.origin === 'tree' ? '' : batchFolderLabel(item)].filter(Boolean).join(' · ');
        head.appendChild(h('div', 'mv-summary', summary));
        // The attachment the owner's portrait is cut from (spec 107 §4).
        const portraitOwner = item.origin === 'tree' && item.attachment ? attachmentOwner(item.attachment.id) : null;
        const isPortraitSource = !!portraitOwner && !!item.attachment && this.portraitSourceAttachmentShown(portraitOwner) === item.attachment.id;
        if (isPortraitSource) {
            const tag = h('span', 'attachment-tag mv-portrait-tag', strings.attachments.portraitTag);
            tag.title = strings.attachments.portraitTagTitle;
            head.appendChild(tag);
        }

        // Where it is used (§3; it took the place of the people's chips).
        const body = h('div', 'mv-body');
        body.appendChild(this.materialUsesBlock(item, ctx, {
            expanded: st.usesOpen, where: 'viewer',
            expand: () => { st.usesOpen = true; redrawViewerList(); },
        }));

        // The fields that are known.
        const fields = h('dl', 'mv-fields');
        const field = (label: string, value: string | HTMLElement) => {
            if (!value) return;
            fields.appendChild(h('dt', '', label));
            const dd = h('dd');
            if (typeof value === 'string') dd.textContent = value;
            else dd.appendChild(value);
            fields.appendChild(dd);
        };
        // The file's name under a title (spec 102 §2); kind and date are the fields while editing.
        if (item.titled && name) {
            field(m.f.file, name);
            (fields.lastElementChild as HTMLElement).classList.add('mv-file');
        }
        if (!editing) {
            field(m.f.kind, materialKindLabel(item));
            if (item.date) field(m.f.date, materialDate(item.date));
        }
        if (item.batch) {
            const batchId = item.batch.id;
            const link = h('button', 'link-button', item.batch.name);
            link.type = 'button';
            link.addEventListener('click', () => {
                closeImageViewer();
                this.openMaterials({ batch: batchId });
            });
            field(m.f.batch, link);
        }
        field(m.f.folder, materialFolder(item.path));
        const notes = agent && item.file?.notes?.length
            ? item.file.notes.map(n => n.text).filter(Boolean).join('\n')
            : item.noteUser ?? '';
        field(m.f.note, notes);
        if (item.at) {
            const from = materialFromKey(item.file?.from);
            field(m.f.received, [receivedTime(item.at), from ? m.from[from] : ''].filter(Boolean).join(' · '));
        }
        if (item.bytes) {
            const type = (fileExt(name) || '').toUpperCase();
            const att = item.attachment;
            // Said only of a picture that was downscaled; one whose size cannot be read says the limit.
            const resized = item.origin === 'tree' && att ? attachmentResizeState(att) : null;
            const note = resized === 'resized' ? m.resized : resized === 'unknown' ? m.resizedAtMost : '';
            field(m.f.size, [formatBytesShort(item.bytes), type, note].filter(Boolean).join(' · '));
        }
        // Why the agent left it unassigned (spec 102 §4.4): the reader's own words, else the reason.
        if (item.agentLeft) {
            const why = item.agentLeft.why as keyof typeof m.agentSort.unproposed | undefined;
            field(m.agentSort.unassignedWhy, item.agentLeft.said || (why && m.agentSort.unproposed[why]) || m.agentSort.unproposed['left-out']);
        }
        if (agent && inArchive) {
            if (item.state === 'processed') field(m.f.state, m.agentDone);
            else if (item.state === 'new') field(m.f.state, ctx ? this.materialWaitingLabel(ctx.researchId) : m.agentWaiting);
        }
        if (fields.childElementCount) body.appendChild(fields);

        // Where it is kept (§2.4), and an older research.
        if (item.origin === 'both') body.appendChild(h('p', 'mv-sentence', agent ? m.keptArchiveResearch : m.keptArchive));
        else if (item.origin === 'tree') body.appendChild(h('p', 'mv-sentence', m.keptApp));
        // The file of a source that comes to the tree (spec 102 §7): in the tree through the source.
        else if (inArchive && item.sourceOf?.some(s => s.inTree)) body.appendChild(h('p', 'mv-sentence', m.agentSort.keptViaSource));
        else if (inArchive) body.appendChild(h('p', 'mv-sentence', agent ? m.archiveOnlyResearch : m.archiveOnly));
        if (inArchive && ctx?.caps.list && !ctx.caps.assign) body.appendChild(h('p', 'mv-sentence is-muted', m.assignNewer));

        // The phone's "All details".
        const more = h('button', 'link-button mv-more', st.expanded ? m.fewerDetails : m.allDetails);
        more.type = 'button';
        more.setAttribute('aria-expanded', String(st.expanded));
        more.addEventListener('click', () => {
            st.expanded = !st.expanded;
            panel.classList.toggle('is-expanded', st.expanded);
            more.textContent = st.expanded ? m.fewerDetails : m.allDetails;
            more.setAttribute('aria-expanded', String(st.expanded));
            relayoutViewer();
        });

        // Actions.
        const foot = h('div', 'mv-foot');
        const actions = h('div', 'mv-actions');
        let writes = false;
        const action = (label: string, run: () => void, opts: { primary?: boolean; danger?: boolean; write?: boolean; id: string; research?: boolean }) => {
            const b = h('button', `mv-act${opts.primary ? ' is-primary' : ''}${opts.danger ? ' is-danger' : ''}`, label);
            if (opts.research) setResearchOpenLabel(b, label);
            b.type = 'button';
            b.dataset.action = opts.id;
            const off = !!opts.write && !up;
            if (opts.write) writes = true;
            if (off) b.setAttribute('aria-disabled', 'true');
            b.addEventListener('click', () => { if (!off) run(); });
            actions.appendChild(b);
        };
        const download = (href: string, file: string) => {
            const a = h('a', 'mv-act', m.download);
            a.href = href;
            a.download = file;
            a.dataset.action = 'download';
            if (!href.startsWith('data:')) {
                a.target = '_blank';
                a.rel = 'noopener';
                // Another origin: the link alone would only open it (it stays for a middle click or a copy).
                a.addEventListener('click', (e) => {
                    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    if (a.getAttribute('aria-busy') === 'true') return;
                    a.setAttribute('aria-busy', 'true');
                    void downloadFromBridge(href, file).finally(() => a.removeAttribute('aria-busy'));
                });
            }
            actions.appendChild(a);
        };
        // Link to… (spec 102 §4): the tree's file in the tree; material outside it needs the bridge (Q2).
        const inTree = !!item.attachment?.places?.length;
        // A family tree file (spec 117 §5): Delete permanently… is its only action.
        const canAttach = item.tree ? false : inTree ? DataManager.canEditMedia(item.attachment!.id) : inArchive && !!ctx?.caps.assign && !item.removedId && !DataManager.isReadOnly();
        // The person the materials were opened for (their card, the window filtered to them) is chosen at the start (1121).
        if (canAttach) action(m.attach, () => this.openAttachDialog([item], { personId: st.ctx.personId ?? this.materialContextPerson() }), { primary: true, write: !inTree, id: 'attach' });
        // Create a source from this file… (spec 102 §5): the second action, the same conditions as Link to….
        if (canAttach && this.canEditSources()) action(m.makeSource, () => void this.makeSourceFromMaterial(item, { personId: this.materialContextPerson() }), { write: !inTree, id: 'makeSource' });
        if (inArchive && !item.tree) {
            if (item.removedId && item.hidden) {
                // Taken out of the tree: back with its places (the tree's own write).
                if (!DataManager.isReadOnly()) action(m.restore, () => this.restoreRemovedMaterials([item]), { id: 'restore' });
            } else if (ctx?.caps.assign && !inTree && !DataManager.isReadOnly()) {
                if (item.hidden) action(m.restore, () => this.materialAction('restore', [item], { where: 'viewer' }), { write: true, id: 'restore' });
                else action(m.hide, () => this.materialAction('hide', [item], { where: 'viewer' }), { write: true, id: 'hide' });
            }
            const link = ctx && sha && ctx.caps.openLinks !== false ? materialSystemLink(ctx.researchId, sha, announcedResearchScheme()) : null;
            // A read-only tree (spec 102 §12g): only Download.
            if (link && !DataManager.isReadOnly()) action(m.openSystem, () => this.launchResearchLink(link), { id: 'openSystem', research: researchLinkMark('media') !== 'none' });
            if (up && sha && item.here) download(fileUrl(ctx!.base!, sha), name);
            else if (item.attachment?.dataUrl && !item.attachment.originalOnly) download(item.attachment.dataUrl, item.attachment.name);
        } else if (item.attachment) {
            const att = item.attachment;
            if (att.dataUrl && !att.originalOnly) download(att.dataUrl, att.name);
        }
        // Use as portrait (spec 107 §4): the tree's file for its owner (the tree's own write); a research's picture
        // for the person the materials were opened for (1121), over the bridge unless the tree has the file.
        const portrait = item.origin === 'tree'
            ? (item.attachment ? this.materialPortraitOffer(item, attachmentOwner(item.attachment.id)?.id ?? null, ctx?.caps ?? null) : null)
            : this.materialPortraitOffer(item, st.ctx.personId ?? this.materialContextPerson(), ctx?.caps ?? null);
        if (portrait && !isPortraitSource && !this.materialPortraitShown(item, portrait.personId)) {
            const forId = portrait.personId;
            action(m.useAsPortrait, () => {
                closeImageViewer();
                void this.useMaterialAsPortrait(forId, item);
            }, { id: 'useAsPortrait', write: portrait.bridge });
            // Opened for that person: right after the first action, among those a phone's collapsed sheet shows (1121).
            if (forId === (st.ctx.personId ?? this.materialContextPerson()) && actions.childElementCount > 2) {
                actions.insertBefore(actions.lastElementChild!, actions.children[1]);
            }
        }
        if (inTree && DataManager.canEditMedia(item.attachment!.id)) {
            action(m.removeFromTree, () => void this.openRemoveFromTreeDialog(item, { leave: () => closeImageViewer() }), { danger: true, id: 'removeFromTree' });
        }
        // Delete permanently… (spec 102 §9): the last action, behind `material.delete`, never in a tree that is read only.
        if (inArchive && ctx?.caps.delete && !DataManager.isReadOnly()) {
            const leave = { leave: () => closeImageViewer(), ctx: { where: 'viewer' as const } };
            action(m.del.forever, () => void (item.tree ? this.openTreeFileDelete(item, leave) : this.openDeleteDialog([item], leave)), { danger: true, write: true, id: 'delete' });
        }
        if ((writes || edit === 'off') && !up) foot.appendChild(h('p', 'mv-off', m.actionsWhenRunning));
        if (actions.childElementCount) foot.appendChild(actions);

        panel.append(head, body, h('div', 'mv-gap'), more);
        // A file still on its way: its details only, no actions until it comes (spec 116 §5).
        if (materialImageWait(item) !== 'none') {
            head.querySelector('.mv-edit')?.remove();
            return;
        }
        if (foot.childElementCount) panel.appendChild(foot);
    },

    /** The person the materials were opened from (their card is open), for Link to…'s event and union targets. */
    materialContextPerson(): PersonId | null {
        return document.getElementById('person-modal')?.classList.contains('active') ? this.currentId ?? null : null;
    },

    /** A tree person's chip: the viewer and the window close and the tree focuses on them (the menu does not open). */
    focusMaterialPerson(personId: PersonId): void {
        closeImageViewer();
        if (document.getElementById('materials-modal')) this.closeMaterials();
        if (document.getElementById('person-modal')?.classList.contains('active')) {
            this.closeModal();
            // Unsaved changes: their dialog decides; the tree stays where it is.
            if (document.getElementById('person-modal')?.classList.contains('active')) return;
        }
        if (DataManager.getPerson(personId)) TreeRenderer.setFocus(personId);
    },
});
