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
    batchFolderLabel, materialDate, isPortraitCandidate, attachmentItem,
} from '../materials.js';
import { iconSvg } from '../icons.js';
import { detailsKeys, materialDetailsEdit, materialDetailsFields, materialDetailsOf } from './material-details-ui.js';
import { canEditPortrait } from './portrait-actions-ui.js';
import { pdfBlobFromDataUrl } from '../attachments.js';
import { formatBytesShort } from './originals-ui.js';
import { openViewerList, closeImageViewer, viewerListOpen, viewerListIndex, redrawViewerList, relayoutViewer, ViewerSlots } from './image-viewer.js';
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
}

let viewer: ViewerState | null = null;

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
    return att && !att.originalOnly && att.mimeType.startsWith('image/') && att.dataUrl ? att.dataUrl : null;
}

function attachmentPdf(item: MaterialItem): { dataUrl: string; mimeType: string } | null {
    const att = item.attachment;
    return att && !att.originalOnly && att.dataUrl && att.mimeType === 'application/pdf' ? { dataUrl: att.dataUrl, mimeType: att.mimeType } : null;
}

function openPdfBlob(pdf: { dataUrl: string; mimeType: string }): boolean {
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
        const state: ViewerState = { items: [...items], ctx, urls: [], expanded: false, drawnAttachments: treeAttachmentsKey(), editing: null, usesOpen: false };
        viewer = state;
        openViewerList(
            {
                count: state.items.length, index,
                show: (i, slots) => this.drawMaterialInViewer(i, slots),
                // F2: the shown item's title, kind and date; P: Link to… (spec 102 §4).
                key: (e) => {
                    if (e.altKey || e.ctrlKey || e.metaKey || viewer !== state || state.editing) return false;
                    if (e.key === 'p' || e.key === 'P') {
                        const btn = document.querySelector<HTMLElement>('#image-viewer-panel .mv-act[data-action="attach"]');
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
            },
        );
    },

    /** The remembered list changed: the shown item's details again (its image stays). */
    materialViewerListChanged(): void {
        if (viewer && viewerListOpen()) redrawViewerList();
    },

    /** A commit or an undo: the details again when the tree's attachments changed. */
    materialViewerTreeChanged(): void {
        if (!viewer || !viewerListOpen()) return;
        const key = treeAttachmentsKey();
        if (key === viewer.drawnAttachments) return;
        viewer.drawnAttachments = key;
        redrawViewerList();
    },

    /** The item as it is now (the remembered list changed after an action; an attachment may be gone). */
    freshMaterialItem(item: MaterialItem): MaterialItem {
        let attachment = item.attachment;
        // The tree's file as it is now (its title, kind or date may have changed).
        if (attachment) {
            const now = DataManager.getMedia(attachment.id);
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
        const fresh = !list || !file
            ? (attachment === item.attachment ? item : { ...materialFileItem(item.file, { batches: [] }, attachment), batch: item.batch })
            : materialFileItem(file, list, attachment);
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
        slots.pos(strings.materials.viewerPos(index + 1, st.items.length, st.ctx.label ?? ''));
        if (st.editing && st.editing !== item.key) st.editing = null;
        if (!slots.redraw) this.drawMaterialStage(item, ctx, slots, st);
        this.drawMaterialPanel(item, ctx, slots.panel, st);
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
            const resized = item.origin === 'tree' && att && !att.originalOnly && !att.original && att.mimeType.startsWith('image/');
            field(m.f.size, [formatBytesShort(item.bytes), type, resized ? m.resized : ''].filter(Boolean).join(' · '));
        }
        if (agent && inArchive) {
            if (item.state === 'processed') field(m.f.state, m.agentDone);
            else if (item.state === 'new') field(m.f.state, m.agentWaiting);
        }
        if (fields.childElementCount) body.appendChild(fields);

        // Where it is kept (§2.4), and an older research.
        if (item.origin === 'both') body.appendChild(h('p', 'mv-sentence', agent ? m.keptArchiveResearch : m.keptArchive));
        else if (item.origin === 'tree') body.appendChild(h('p', 'mv-sentence', m.keptApp));
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
        const canAttach = inTree ? DataManager.canEditMedia(item.attachment!.id) : inArchive && !!ctx?.caps.assign && !item.removedId && !DataManager.isReadOnly();
        if (canAttach) action(m.attach, () => this.openAttachDialog([item], { personId: this.materialContextPerson() }), { primary: true, write: !inTree, id: 'attach' });
        if (inArchive) {
            if (item.removedId && item.hidden) {
                // Taken out of the tree: back with its places (the tree's own write).
                if (!DataManager.isReadOnly()) action(m.restore, () => this.restoreRemovedMaterials([item]), { id: 'restore' });
            } else if (ctx?.caps.assign && !inTree) {
                if (item.hidden) action(m.restore, () => this.materialAction('restore', [item], { where: 'viewer' }), { write: true, id: 'restore' });
                else action(m.hide, () => this.materialAction('hide', [item], { where: 'viewer' }), { write: true, id: 'hide' });
            }
            const link = ctx && sha && ctx.caps.openLinks !== false ? materialSystemLink(ctx.researchId, sha, announcedResearchScheme()) : null;
            if (link) action(m.openSystem, () => this.launchResearchLink(link), { id: 'openSystem', research: researchLinkMark('media') !== 'none' });
            if (up && sha && item.here) download(fileUrl(ctx!.base!, sha), name);
            else if (item.attachment?.dataUrl && !item.attachment.originalOnly) download(item.attachment.dataUrl, item.attachment.name);
        } else if (item.attachment) {
            const att = item.attachment;
            if (att.dataUrl && !att.originalOnly) download(att.dataUrl, att.name);
            const owner = attachmentOwner(att.id);
            // Use as portrait (spec 107 §4): the tree's own write, so it does not wait for the research's bridge.
            if (owner && isPortraitCandidate(att) && !isPortraitSource && canEditPortrait(owner.id)) {
                const ownerId = owner.id;
                action(m.useAsPortrait, () => {
                    closeImageViewer();
                    void this.useAttachmentAsPortrait(ownerId, att.id);
                }, { id: 'useAsPortrait' });
            }
        }
        if (inTree && DataManager.canEditMedia(item.attachment!.id)) {
            action(m.removeFromTree, () => void this.openRemoveFromTreeDialog(item, { leave: () => closeImageViewer() }), { danger: true, id: 'removeFromTree' });
        }
        if ((writes || edit === 'off') && !up) foot.appendChild(h('p', 'mv-off', m.actionsWhenRunning));
        if (actions.childElementCount) foot.appendChild(actions);

        panel.append(head, body, h('div', 'mv-gap'), more);
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
