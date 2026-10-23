/**
 * Materials (spec 017): the family's files kept by the research (or the
 * Strom archive) beside the tree's attachments.
 *
 * Here: the person's section in the editor, the item's ⋯ menu, the entry
 * points' shared state (counts, gates), loading and remembering the list,
 * and the materials window's entry `openMaterials` (its content is the
 * overview, built on top of this).
 *
 * Gates only by `/status.features` (remembered per research, so the cached
 * list stays readable while the research is not running); a touch device,
 * a tree without a research or a research without `material.list` keeps
 * today's attachments unchanged.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { Person, PersonId } from '../types.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { setMaterialsCountProvider } from '../card-signals.js';
import { researchPersonRef, parseLiveBridge } from '../research-link.js';
import { storedResearchBridge, announcedResearchScheme, researchLinksEnabled } from '../research-device.js';
import {
    MATERIAL_LIST_FEATURE, MATERIAL_ASSIGN_FEATURE, MATERIAL_THUMB_FEATURE, MATERIALS_EVENT,
    MaterialCaps, MaterialEnv, MaterialItem, MaterialList, MaterialAction, MaterialActionId, MaterialFile, MaterialBatch,
    materialCaps, materialActions, personMaterials, materialCounter, materialKindLabel, batchFolderLabel,
    materialType, fileExt, primeMaterials, cachedMaterials, cachedMaterialList, saveMaterialList,
    fetchMaterial, getCachedThumb, fileUrl, materialSystemLink,
    clearMaterialsCache, mergeIntoCache, markBatchOpened, materialDate,
} from '../materials.js';
import { materialThumbs } from '../material-thumbs.js';
import { formatBytesShort } from './originals-ui.js';
import { onComputer } from './research-ui.js';
import { openImageViewer } from './image-viewer.js';
import { uiModule } from './module.js';

const MODAL_ID = 'materials-modal';
const SECTION_ID = 'materials-section';
const MENU_ID = 'materials-item-menu';
/** Rows of the person's section before "All materials of this person (N) ›". */
export const PERSON_SECTION_ROWS = 6;
/** The person's section's previews (the window's are 256). */
const THUMB_PX = 128;
/** The research's material capabilities, remembered per research (`/status` is gone while it is not running). */
const FEATURES_KEY = 'strom-material-features:';
const MATERIAL_FEATURE_NAMES = [MATERIAL_LIST_FEATURE, MATERIAL_ASSIGN_FEATURE, MATERIAL_THUMB_FEATURE];
/** Images the browser shows itself (others open in the system or as a file). */
const VIEWABLE_IMAGES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const BATCH_ID = /^[A-Za-z0-9_.-]{1,120}$/;

export interface MaterialsOpenOptions {
    person?: string;
    batch?: string;
    group?: 'batch' | 'date';
}

/** Where a research write on items was asked from (the dialogs' context). */
export interface MaterialActionCtx {
    /** The person whose section it came from (REFN). */
    person?: string | null;
    where?: 'section' | 'window' | 'viewer';
    /** A batch's ⋯ (the items are its files). */
    batch?: MaterialBatch;
    /** A folder's ⋯ inside a batch (`path`: the folder as shown, e.g. "Fotky / 1930"). */
    folder?: { batch: string; path: string };
    /** The items are the window's selection (a successful action ends selecting). */
    selection?: boolean;
    /** The element the action came from (the viewer's chip: the "only through the batch" bubble sits by it). */
    anchor?: HTMLElement;
    /** Called once a write started without a dialog has its answer (the element that asked for it stops waiting). */
    settled?: () => void;
}

/** Where an item was opened from, for the viewer (its ‹ › go through `items`). */
export interface MaterialOpenCtx {
    where: 'section' | 'window';
    /** What the items are ("Jan Novák", a batch's name) for the viewer's header. */
    label?: string;
}

/** What the materials need to know about the active tree (null: not linked to a research). */
export interface MaterialsContext {
    treeId: string;
    researchId: string;
    /** The bridge's base URL as last stored (null: never known here). */
    base: string | null;
    env: MaterialEnv;
    caps: MaterialCaps;
    /** A research with an agent (texts say "research"); else an archive (texts say "Strom archive"). */
    agent: boolean;
}

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ==================== REMEMBERED CAPABILITIES ====================

/** The material capabilities a research said last time (null: never said here). */
export function rememberedMaterialFeatures(researchId: string): string[] | null {
    try {
        const raw = localStorage.getItem(FEATURES_KEY + researchId);
        const parsed = raw ? JSON.parse(raw) as unknown : null;
        return Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === 'string' && MATERIAL_FEATURE_NAMES.includes(f)) : null;
    } catch {
        return null;
    }
}

/** Keep what a research says it can do with materials (only the material capabilities). True: it changed. */
export function rememberMaterialFeatures(researchId: string, features: readonly string[]): boolean {
    const mine = MATERIAL_FEATURE_NAMES.filter(f => features.includes(f));
    const prev = rememberedMaterialFeatures(researchId);
    if (prev && prev.length === mine.length && prev.every(f => mine.includes(f))) return false;
    try {
        localStorage.setItem(FEATURES_KEY + researchId, JSON.stringify(mine));
    } catch { /* storage full or blocked: only this page knows */ }
    return true;
}

export function forgetMaterialFeatures(researchId: string): void {
    try { localStorage.removeItem(FEATURES_KEY + researchId); } catch { /* blocked */ }
}

// ==================== DISCONNECTING ====================

/** Files of the list that are shown (not hidden). */
export function shownFileCount(list: Pick<MaterialList, 'files'> | null | undefined): number {
    return list ? list.files.filter(f => !f.hidden).length : 0;
}

/**
 * The paragraph a disconnect dialog adds after its text (7b): only when the
 * tree's remembered list has files. `agent`: a research with an agent.
 */
export async function materialsDisconnectNote(treeId: string, agent: boolean): Promise<string | null> {
    await primeMaterials(treeId);
    const n = shownFileCount(cachedMaterialList(treeId));
    if (n === 0) return null;
    return agent ? strings.materials.disconnectNoteResearch(n) : strings.materials.disconnectNote(n);
}

/** After disconnecting: the tree's remembered list and previews go (the research keeps its files). */
export async function forgetTreeMaterials(treeId: string, researchId?: string): Promise<void> {
    await clearMaterialsCache(treeId);
    if (researchId) forgetMaterialFeatures(researchId);
}

// ==================== SMALL FORMATTERS ====================

/** "1. 10." this year, else "1. 10. 2025" (in the app's language). */
export function materialShortDate(iso: string | undefined, now: Date = new Date()): string {
    const t = iso ? Date.parse(iso) : NaN;
    if (Number.isNaN(t)) return '';
    const d = new Date(t);
    const opts: Intl.DateTimeFormatOptions = d.getFullYear() === now.getFullYear()
        ? { day: 'numeric', month: 'numeric' } : { day: 'numeric', month: 'numeric', year: 'numeric' };
    return d.toLocaleDateString(getCurrentLanguage(), opts);
}

export function materialStaleTime(ms: number): string {
    return new Date(ms).toLocaleString(getCurrentLanguage(), { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** The type tile's letters (PDF, TIFF, JPG). */
export function materialTileLetters(item: MaterialItem): string {
    const ext = fileExt(item.file?.name ?? item.attachment?.name ?? item.title);
    if (ext) return ext.replace(/^jpeg$/, 'jpg').slice(0, 4).toUpperCase();
    const type = materialType(item.mime);
    return type === 'pdf' ? 'PDF' : (strings.materials.type[type] ?? '?').slice(0, 4).toUpperCase();
}

/** The SHA-256 of the item's file (for its preview from the bridge). */
export function materialItemSha(item: MaterialItem): string | null {
    return item.file?.sha ?? item.attachment?.original?.sha256 ?? null;
}

/** The second line: kind · date · size (with an agent: its state). */
function metaLine(item: MaterialItem, agent: boolean): string {
    const m = strings.materials;
    const parts = [materialKindLabel(item)];
    if (item.date) parts.push(materialDate(item.date));
    if (item.bytes) parts.push(formatBytesShort(item.bytes));
    if (agent && item.origin !== 'tree') {
        if (item.state === 'processed') parts.push(m.agentDone);
        else if (item.state === 'new') parts.push(m.agentWaiting);
    }
    return parts.join(' · ');
}

const ACTION_LABEL: Record<MaterialActionId, () => string> = {
    open: () => strings.materials.open,
    assign: () => strings.materials.assign,
    removeFromPerson: () => strings.materials.removeFromThis,
    hide: () => strings.materials.hide,
    restore: () => strings.materials.restore,
    openSystem: () => strings.materials.openSystem,
    showInBatch: () => strings.materials.showInBatch,
    download: () => strings.materials.download,
    deleteFromTree: () => strings.materials.deleteFromTree,
};

/** Where the item's ⋯ menu draws a line above (the research's writes, then the rest). */
const DIVIDER_BEFORE: MaterialActionId[] = ['openSystem', 'deleteFromTree'];

// ==================== MODULE STATE ====================

/** The person's items as drawn in the section (by key), for the ⋯ menu and opening. */
let sectionItems = new Map<string, MaterialItem>();
/** Which attachments the tree holds and on whom: a change redraws what shows them (window, section, viewer). */
export function treeAttachmentsKey(): string {
    const parts: string[] = [];
    for (const p of DataManager.getAllPersons()) {
        if (!p.attachments?.length) continue;
        parts.push(`${p.id}|${p.refn ?? ''}|${p.attachments.map(a => a.id).join(',')}`);
    }
    return parts.join(';');
}

/** The attachments the open person's section and list were drawn with (ids). */
let sectionAttachments = '';
const personAttachmentIds = (p: Person): string => (p.attachments ?? []).map(a => a.id).join(',');
/** People whose `?person=` is being asked now (REFN). */
const personLoading = new Set<string>();
/** Trees whose whole list was asked in this page (once per page; later answers come per person). */
const fullAsked = new Set<string>();
/** What the cards and the gates showed last (a change redraws the cards). */
let drawnSignature = '';
let providerState: { on: boolean; count: ((p: Person) => number) | null } = { on: false, count: null };
/** The last state of the gates and the bridge the section was drawn with. */
let lastBridgeKey = '';

/** The section's lazy previews (as rows come into view). */
let thumbObserver: IntersectionObserver | null = null;

let menuAnchor: HTMLElement | null = null;
let menuKeyHandler: ((e: KeyboardEvent) => void) | null = null;
let menuOutsideHandler: ((e: MouseEvent) => void) | null = null;

export const materialsMethods = uiModule({
    // ==================== GATES ====================

    /** The active tree's research and what it lets the materials do (null: not linked). */
    materialsContext(): MaterialsContext | null {
        const ctx = this.researchSyncLink();
        if (!ctx) return null;
        const researchId = ctx.link.id;
        const live = this.researchStatusOf(researchId)?.features;
        const features = live ?? rememberedMaterialFeatures(researchId);
        const bridgeUp = this.researchBridgeUp(researchId);
        const env: MaterialEnv = { features, linked: true, onComputer: onComputer(), bridgeUp };
        const links = researchLinksEnabled();
        return {
            treeId: ctx.treeId,
            researchId,
            base: parseLiveBridge(storedResearchBridge(researchId)?.base)?.base ?? null,
            env,
            caps: materialCaps({ ...env, ...(links ? {} : { links: false }) }),
            agent: !this.researchAgentlessFor(researchId, ctx.link),
        };
    },

    /** Materials from the research are shown in this tree (on a computer, a research that lists them). */
    materialsListOn(): boolean {
        return !!this.materialsContext()?.caps.list;
    },

    /** A tree linked to a research, on a touch device: attachments under "Materials" with a sentence (8.3). */
    materialsTouchLinked(): boolean {
        const ctx = this.materialsContext();
        return !!ctx && !ctx.env.onComputer;
    },

    /** The person's materials as the section shows them (hidden ones left out). */
    personMaterialItems(personId: PersonId): MaterialItem[] {
        const person = DataManager.getPerson(personId);
        if (!person) return [];
        const ctx = this.materialsContext();
        return personMaterials(person, ctx?.caps.list ? cachedMaterialList(ctx.treeId) : null);
    },

    /** The person menu's "Materials N" (0: no row; only where materials are shown). */
    personMaterialsCount(personId: PersonId): number {
        if (!this.materialsListOn()) return 0;
        return this.personMaterialItems(personId).length;
    },

    /** The Research menu's "Materials N": the remembered files without hidden ones (null: nothing remembered). */
    materialsTotalCount(): number | null {
        const ctx = this.materialsContext();
        if (!ctx?.caps.list) return null;
        const list = cachedMaterialList(ctx.treeId);
        return list ? shownFileCount(list) : null;
    },

    // ==================== THE WINDOW ====================

    /**
     * The materials window. Its filter (a person, a batch) and grouping
     * come from `opts`, are shown as active and are not kept after closing.
     */
    openMaterials(opts: MaterialsOpenOptions = {}): void {
        if (!this.materialsListOn()) return;
        this.closeMaterialsItemMenu();
        this.closeActionsMenu();
        this.hideContextMenu?.();
        if (this.isResearchMenuOpen()) this.closeResearchMenu();
        document.getElementById(MODAL_ID)?.remove();
        const overlay = document.createElement('div');
        overlay.id = MODAL_ID;
        overlay.className = 'modal-overlay active';
        const person = opts.person ? researchPersonRef(opts.person) : null;
        const batch = typeof opts.batch === 'string' && BATCH_ID.test(opts.batch) ? opts.batch : null;
        if (person) overlay.dataset.person = person;
        if (batch) overlay.dataset.batch = batch;
        const group = opts.group === 'date' || opts.group === 'batch' ? opts.group : undefined;
        overlay.dataset.group = group ?? 'batch';
        const m = strings.materials;
        overlay.innerHTML = `
            <div class="modal modal--lg materials-window" role="dialog" aria-modal="true" aria-labelledby="materials-title">
                <div class="modal-header mw-head">
                    <div class="mw-titles">
                        <h2 id="materials-title">${esc(m.title)}</h2>
                        <span class="mw-summary" role="status" aria-live="polite"></span>
                    </div>
                    <div class="mw-selhead">
                        <span class="mw-selhead-count" role="status"></span>
                        <button type="button" class="link-button mw-selhead-done">${esc(m.done)}</button>
                    </div>
                    <div class="mw-toolbar">
                        <input type="search" id="materials-search" class="mw-search" placeholder="${esc(m.search)}" aria-label="${esc(m.search)}" autocomplete="off" spellcheck="false">
                        <div class="mw-tools"></div>
                    </div>
                    <button type="button" class="close-btn" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                <div class="modal-content materials-window-body" id="materials-window-body"></div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeMaterials(); });
        overlay.querySelector('.close-btn')?.addEventListener('click', () => this.closeMaterials());
        this.pushDialog(MODAL_ID);
        if (batch) {
            const ctx = this.materialsContext();
            if (ctx) void markBatchOpened(ctx.treeId, batch);
        }
        this.initMaterialsWindow({ ...(group ? { group } : {}), person, batch });
        (overlay.querySelector('.close-btn') as HTMLElement | null)?.focus();
    },

    closeMaterials(): void {
        this.teardownMaterialsWindow();
        document.getElementById(MODAL_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== MODAL_ID);
    },

    // ==================== THE PERSON'S SECTION ====================

    /**
     * Switch the editor's "Sources and attachments" between today's
     * attachments and the materials (a research that lists them, or a
     * linked tree on touch). True: the section is shown whatever the
     * advanced-fields setting says.
     */
    applyMaterialsSection(person: Person | null): boolean {
        const listOn = !!person && this.materialsListOn();
        const touch = !!person && !listOn && this.materialsTouchLinked();
        const heading = document.querySelector<HTMLElement>('#pm-section-research .pm-section-title');
        const headKey = listOn || touch ? 'personModal.sectionSourcesMaterials' : 'personModal.sectionSources';
        if (heading && heading.dataset.i18n !== headKey) {
            heading.dataset.i18n = headKey;
            heading.textContent = listOn || touch ? strings.personModal.sectionSourcesMaterials : strings.personModal.sectionSources;
        }
        const attachments = document.getElementById('attachments-section');
        const label = attachments?.querySelector<HTMLElement>(':scope > label');
        const labelKey = touch ? 'materials.title' : 'attachments.title';
        if (label && label.dataset.i18n !== labelKey) {
            label.dataset.i18n = labelKey;
            label.textContent = touch ? strings.materials.title : strings.attachments.title;
        }
        const addBtn = document.getElementById('btn-add-attachment');
        const addKey = touch ? 'material.add' : 'attachments.add';
        if (addBtn && addBtn.dataset.i18n !== addKey) {
            addBtn.dataset.i18n = addKey;
            addBtn.textContent = touch ? strings.material.add : strings.attachments.add;
        }
        let touchNote = document.getElementById('attachments-materials-note');
        if (touch && !touchNote && attachments) {
            touchNote = document.createElement('p');
            touchNote.id = 'attachments-materials-note';
            touchNote.className = 'materials-note';
            touchNote.setAttribute('role', 'note');
            attachments.querySelector('#attachments-list')?.before(touchNote);
        }
        if (touchNote) {
            touchNote.hidden = !touch;
            const ctx = touch ? this.materialsContext() : null;
            touchNote.textContent = touch ? (ctx?.agent ? strings.materials.desktopOnlyResearch : strings.materials.desktopOnly) : '';
        }
        const section = document.getElementById(SECTION_ID);
        if (section) section.hidden = !listOn;
        if (listOn && attachments) attachments.style.display = 'none';
        else if (touch && attachments) attachments.style.display = '';
        if (listOn) this.renderMaterialsSection();
        else {
            thumbObserver?.disconnect();
            sectionItems = new Map();
        }
        return listOn || touch;
    },

    /** Draw the person's materials (the editor's current person). */
    renderMaterialsSection(): void {
        const section = document.getElementById(SECTION_ID);
        if (!section || section.hidden || !this.currentId) return;
        const person = DataManager.getPerson(this.currentId);
        const ctx = this.materialsContext();
        if (!person || !ctx?.caps.list) return;
        const m = strings.materials;
        const locked = DataManager.isPersonLocked(this.currentId);
        const refn = researchPersonRef(person.refn);
        const rec = cachedMaterials(ctx.treeId);
        sectionAttachments = personAttachmentIds(person);
        const items = this.personMaterialItems(this.currentId);
        const shown = items.slice(0, PERSON_SECTION_ROWS);
        sectionItems = new Map(shown.map(i => [i.key, i]));
        lastBridgeKey = `${ctx.caps.list}|${ctx.caps.assign}|${ctx.caps.bridgeUp}`;

        // The state above the rows: no REFN, not running (with the time), nothing remembered.
        const start = this.researchStartUrl() ? `<button type="button" class="link-button materials-start" data-act="start">${esc(strings.sync.startResearch.replace(' ↗', ''))}</button>` : '';
        let state = 'live';
        let note = '';
        if (!refn) {
            state = 'norefn';
            note = `<p class="materials-note" role="note">${esc(ctx.agent ? m.noRefnResearch : m.noRefn)}</p>`;
        } else if (!rec && !ctx.caps.bridgeUp) {
            state = 'nocache';
            note = `<div class="materials-bar" role="status"><span>${esc(m.loadWhenRunning)}</span>${start}</div>`;
        } else if (!ctx.caps.bridgeUp) {
            state = 'stale';
            note = `<div class="materials-bar" role="status"><span>${esc(m.stale(materialStaleTime(rec?.list.fetchedAt || Date.now())))}</span>${start}</div>`;
        }
        // Rows from the research still on their way (nothing remembered yet): two placeholder rows.
        const loading = !!refn && !rec && personLoading.has(refn);
        if (loading) state = 'loading';
        section.dataset.state = state;

        const addLabel = strings.material.add;
        const add = locked ? '' : `<button type="button" class="secondary btn-sm materials-add" data-act="add">${esc(addLabel)}</button>`;
        const rows = shown.map(item => this.materialRowHtml(item, ctx, refn, locked)).join('');
        const skeleton = loading
            ? `<div class="material-row is-skeleton" aria-hidden="true"><span class="material-thumb"></span><span class="material-skel-lines"><span></span><span></span></span></div>`.repeat(2)
            : '';
        const empty = items.length === 0 && !loading
            ? `<div class="materials-empty"><p>${esc(ctx.agent ? m.emptyTextResearch : m.emptyText)}</p>${locked ? '' : `<button type="button" class="primary btn-sm materials-add" data-act="add">${esc(addLabel)}</button>`}</div>`
            : '';
        const more = items.length > PERSON_SECTION_ROWS
            ? `<button type="button" class="link-button materials-all" data-act="all-person">${esc(m.allForPerson(items.length))}</button>`
            : items.length > 0 ? `<button type="button" class="link-button materials-all" data-act="all">${esc(m.all)}</button>` : '';
        section.innerHTML = `
            <div class="materials-head">
                <span class="materials-title">${esc(m.title)}</span>
                <span class="materials-count">${items.length || ''}</span>
                <span class="materials-head-gap"></span>
                ${items.length || loading ? add : ''}
            </div>
            ${note}
            ${rows || skeleton ? `<div class="materials-list" role="list">${rows}${skeleton}</div>` : ''}
            ${empty}
            ${more}`;
        this.wireMaterialsSection(section, ctx);
    },

    /** One row of the person's section (2a). */
    materialRowHtml(item: MaterialItem, ctx: MaterialsContext, refn: string | null, locked: boolean): string {
        const m = strings.materials;
        const att = item.attachment;
        const imgPreview = att && !att.originalOnly && att.mimeType.startsWith('image/') && att.dataUrl;
        const sha = materialItemSha(item);
        const lazy = !imgPreview && !!sha && item.origin !== 'tree' && ['image', 'pdf'].includes(materialType(item.mime, item.title));
        const thumb = imgPreview
            ? `<span class="material-thumb"><img src="${esc(att.dataUrl)}" alt=""></span>`
            : `<span class="material-thumb"${lazy ? ` data-sha="${esc(sha)}"` : ''}><span class="material-row-tile">${esc(materialTileLetters(item))}</span></span>`;
        const where = `<span class="material-line3"><span class="material-where">${esc(batchFolderLabel(item))}</span>${refn && item.viaBatch.includes(refn) ? `<span class="material-via">${esc(m.viaBatch)}</span>` : ''}</span>`;
        // A tree attachment keeps its own note field (editable as before); the research's note is shown.
        let note = '';
        if (item.origin === 'tree' && att && !locked) {
            note = `<input type="text" class="attachment-note-input material-note-input" value="${esc(att.note ?? '')}" placeholder="${esc(strings.attachments.notePlaceholder)}" data-attachment-id="${esc(att.id)}" aria-label="${esc(strings.attachments.notePlaceholder)}">`;
        } else if (item.noteUser) {
            note = `<span class="material-note">„${esc(item.noteUser)}“</span>`;
        }
        const at = materialShortDate(item.at);
        return `
            <div class="material-row" role="listitem" tabindex="0" data-key="${esc(item.key)}" aria-label="${esc(item.title)}">
                ${thumb}
                <span class="material-main">
                    <span class="material-title" title="${esc(item.title)}">${esc(item.title)}</span>
                    <span class="material-meta">${esc(metaLine(item, ctx.agent))}</span>
                    ${where}
                    ${note}
                </span>
                <span class="material-side">
                    <span class="material-at">${esc(at)}</span>
                    <button type="button" class="material-more" data-act="menu" aria-haspopup="menu" aria-label="${esc(strings.materials.menu)}: ${esc(item.title)}">⋯</button>
                </span>
            </div>`;
    },

    wireMaterialsSection(section: HTMLElement, ctx: MaterialsContext): void {
        section.querySelectorAll<HTMLElement>('[data-act]').forEach(el => {
            if (el.closest('.material-row')) return;
            el.addEventListener('click', () => {
                const person = this.currentId ? DataManager.getPerson(this.currentId) : null;
                const refn = researchPersonRef(person?.refn);
                switch (el.dataset.act) {
                    case 'add': this.addMaterialForCurrentPerson(); break;
                    case 'start': this.researchSyncAction('startResearch'); break;
                    case 'all-person': this.openMaterials(refn ? { person: refn, group: 'date' } : {}); break;
                    case 'all': this.openMaterials(); break;
                }
            });
        });
        section.querySelectorAll<HTMLElement>('.material-row[data-key]').forEach(row => {
            const key = row.dataset.key ?? '';
            row.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                if (target.closest('input, textarea')) return;
                if (target.closest('.material-more')) {
                    e.stopPropagation();
                    this.showMaterialsItemMenu(key, target.closest('.material-more') as HTMLElement);
                    return;
                }
                this.openSectionMaterial(key);
            });
            row.addEventListener('keydown', (e) => {
                if (e.target !== row) return;
                if (e.key === 'Enter') { e.preventDefault(); this.openSectionMaterial(key); }
            });
        });
        section.querySelectorAll<HTMLInputElement>('.material-note-input[data-attachment-id]').forEach(el => {
            el.addEventListener('change', () => this.updateAttachmentNoteFromInput(el.dataset.attachmentId ?? '', el.value));
        });
        this.observeMaterialThumbs(section, ctx);
    },

    /** "Add material…": the dialog for a research that takes files, else today's attachment picker. */
    addMaterialForCurrentPerson(): void {
        if (!this.currentId) return;
        if (this.materialAvailable()) this.showMaterialDialog({ personId: this.currentId });
        else (document.getElementById('input-attachment') as HTMLInputElement | null)?.click();
    },

    /** Ask the research for the person's files again (quietly; the section redraws from the answer). */
    async refreshPersonMaterials(personId: PersonId): Promise<void> {
        const ctx = this.materialsContext();
        const person = DataManager.getPerson(personId);
        const refn = researchPersonRef(person?.refn);
        if (!ctx?.caps.list || !ctx.caps.bridgeUp || !ctx.base || !refn || personLoading.has(refn)) return;
        personLoading.add(refn);
        if (!cachedMaterials(ctx.treeId) && this.currentId === personId) this.renderMaterialsSection();
        try {
            const answer = await fetchMaterial(ctx.base, { person: refn });
            if (answer.ok) await saveMaterialList(ctx.treeId, answer.value, { kind: 'person', person: refn });
        } finally {
            personLoading.delete(refn);
            if (this.currentId === personId) this.renderMaterialsSection();
        }
    },

    /** Ask for the whole list once in this page (cards' and menus' counts), while the bridge runs. */
    async refreshAllMaterials(): Promise<void> {
        const ctx = this.materialsContext();
        if (!ctx?.caps.list || !ctx.caps.bridgeUp || !ctx.base || fullAsked.has(ctx.treeId)) return;
        fullAsked.add(ctx.treeId);
        const answer = await fetchMaterial(ctx.base, {});
        if (answer.ok) await saveMaterialList(ctx.treeId, answer.value, { kind: 'all' });
        else fullAsked.delete(ctx.treeId);
    },

    /** Scroll the open editor to the materials (or the attachments on touch). */
    scrollToMaterialsSection(): void {
        const section = document.getElementById(SECTION_ID);
        const target = section && !section.hidden ? section : document.getElementById('attachments-section');
        target?.scrollIntoView({ block: 'start' });
    },

    /** The person's editor, scrolled to their materials (menu "Materials N", the toast's "Show"). */
    showPersonMaterials(personId: PersonId): void {
        if (this.currentId !== personId || !document.getElementById('person-modal')?.classList.contains('active')) {
            this.clearDialogStack();
            this.pushDialog('person-modal');
            this.showEditPersonModal(personId);
        }
        requestAnimationFrame(() => this.scrollToMaterialsSection());
    },

    // ==================== OPENING ====================

    /** An item of the person's section, opened with all the person's items around it. */
    openSectionMaterial(key: string): void {
        const item = sectionItems.get(key);
        if (!item || !this.currentId) return;
        const all = this.personMaterialItems(this.currentId);
        const index = all.findIndex(i => i.key === key);
        const person = DataManager.getPerson(this.currentId);
        const label = person ? strings.materials.ctxPerson(`${person.firstName} ${person.lastName}`.trim()) : '';
        if (index >= 0) this.openMaterialItems(all, index, { where: 'section', label });
        else this.openMaterial(item);
    },

    /** One item without a viewer: an attachment's preview, an image, a PDF, else the system's program. */
    openMaterial(item: MaterialItem): void {
        const att = item.attachment;
        if (att) {
            if (att.originalOnly) this.openAttachmentFullQuality(att.id);
            else this.previewAttachment(att.id);
            return;
        }
        const file = item.file;
        const ctx = this.materialsContext();
        if (!file || !ctx) return;
        const m = strings.materials;
        const startAction = this.researchStartUrl() ? { action: { label: strings.sync.startResearch.replace(' ↗', ''), run: () => this.researchSyncAction('startResearch') } } : {};
        const mime = (file.mime ?? '').toLowerCase();
        if (!ctx.caps.bridgeUp || !ctx.base) {
            // Not running: a remembered preview of an image, else it opens once the research runs.
            if (materialType(file.mime, file.name) === 'image') {
                void getCachedThumb(ctx.treeId, file.sha, THUMB_PX).then(blob => {
                    if (blob) {
                        const url = URL.createObjectURL(blob);
                        openImageViewer(url, () => URL.revokeObjectURL(url));
                        this.showToast(m.previewOnly, 6000, { closable: true });
                    } else {
                        this.showToast(m.opensWhenRunning, 6000, { closable: true, ...startAction });
                    }
                });
                return;
            }
            this.showToast(m.opensWhenRunning, 6000, { closable: true, ...startAction });
            return;
        }
        if (!item.here) {
            this.showToast(ctx.agent ? m.notHereResearch : m.notHere, 6000, { closable: true });
            return;
        }
        if (VIEWABLE_IMAGES.includes(mime)) {
            openImageViewer(fileUrl(ctx.base, file.sha));
            return;
        }
        if (mime === 'application/pdf') {
            window.open(fileUrl(ctx.base, file.sha), '_blank', 'noopener');
            return;
        }
        // Anything the browser does not show: the system's program, through the research.
        const link = ctx.caps.links !== false ? materialSystemLink(ctx.researchId, file.sha, announcedResearchScheme()) : null;
        if (link) this.launchResearchLink(link);
        else window.open(fileUrl(ctx.base, file.sha), '_blank', 'noopener');
    },

    // ==================== THE ⋯ MENU ====================

    showMaterialsItemMenu(key: string, anchor: HTMLElement): void {
        const item = sectionItems.get(key);
        const ctx = this.materialsContext();
        if (!item || !ctx) return;
        this.closeMaterialsItemMenu();
        const person = this.currentId ? DataManager.getPerson(this.currentId) : null;
        const refn = researchPersonRef(person?.refn);
        const locked = !!this.currentId && DataManager.isPersonLocked(this.currentId);
        const actions = materialActions(item, ctx.caps, { person: refn, where: 'menu' })
            // Nothing to download from an attachment that is only its original; a locked person keeps its files.
            .filter(a => !(a.id === 'download' && (!item.attachment?.dataUrl || item.attachment.originalOnly)))
            .filter(a => !(a.id === 'deleteFromTree' && locked));
        const menu = document.createElement('div');
        menu.id = MENU_ID;
        menu.className = 'materials-item-menu';
        menu.setAttribute('role', 'menu');
        menu.innerHTML = actions.map((a, i) => {
            const divider = i > 0 && DIVIDER_BEFORE.includes(a.id) ? '<div class="materials-item-menu-divider" role="separator"></div>' : '';
            const off = a.disabled ? ` aria-disabled="true" title="${esc(strings.materials.actionsWhenRunning)}"` : '';
            const danger = a.id === 'deleteFromTree' ? ' is-danger' : '';
            return `${divider}<button type="button" role="menuitem" class="materials-item-menu-row${danger}" data-action="${a.id}"${off}>${esc(ACTION_LABEL[a.id]())}</button>`;
        }).join('');
        document.body.appendChild(menu);
        menuAnchor = anchor;
        anchor.setAttribute('aria-expanded', 'true');
        const r = anchor.getBoundingClientRect();
        const w = menu.offsetWidth;
        const h = menu.offsetHeight;
        const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
        const top = r.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4;
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        menu.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(btn => btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (btn.getAttribute('aria-disabled') === 'true') return;
            const action = actions.find(a => a.id === btn.dataset.action);
            this.closeMaterialsItemMenu();
            anchor.focus();
            if (action) this.runMaterialItemAction(item, action, refn);
        }));
        menuKeyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.closeMaterialsItemMenu();
                anchor.focus();
                return;
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const rows = Array.from(menu.querySelectorAll<HTMLElement>('[data-action]'));
                const i = rows.indexOf(document.activeElement as HTMLElement);
                const next = rows[(i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length];
                e.preventDefault();
                next?.focus();
            }
        };
        menuOutsideHandler = (e: MouseEvent) => {
            if (!menu.contains(e.target as Node)) this.closeMaterialsItemMenu();
        };
        document.addEventListener('keydown', menuKeyHandler, true);
        setTimeout(() => { if (menuOutsideHandler) document.addEventListener('mousedown', menuOutsideHandler, true); }, 0);
        menu.querySelector<HTMLElement>('[data-action]')?.focus();
    },

    closeMaterialsItemMenu(): void {
        document.getElementById(MENU_ID)?.remove();
        menuAnchor?.removeAttribute('aria-expanded');
        menuAnchor = null;
        if (menuKeyHandler) document.removeEventListener('keydown', menuKeyHandler, true);
        if (menuOutsideHandler) document.removeEventListener('mousedown', menuOutsideHandler, true);
        menuKeyHandler = null;
        menuOutsideHandler = null;
    },

    runMaterialItemAction(item: MaterialItem, action: MaterialAction, refn: string | null): void {
        const ctx = this.materialsContext();
        switch (action.id) {
            case 'open': this.openSectionMaterial(item.key); break;
            case 'openSystem': {
                const sha = materialItemSha(item);
                const link = ctx && sha ? materialSystemLink(ctx.researchId, sha, announcedResearchScheme()) : null;
                if (link) this.launchResearchLink(link);
                break;
            }
            case 'showInBatch': if (item.batch) this.openMaterials({ batch: item.batch.id }); break;
            case 'download': {
                const att = item.attachment;
                if (!att?.dataUrl || att.originalOnly) break;
                const a = document.createElement('a');
                a.href = att.dataUrl;
                a.download = att.name;
                document.body.appendChild(a);
                a.click();
                a.remove();
                break;
            }
            case 'deleteFromTree': if (item.attachment) void this.deleteAttachment(item.attachment.id); break;
            default: this.materialAction(action.id, [item], { person: refn, where: 'section' });
        }
    },

    // ==================== PREVIEWS ====================

    /** Previews of the research's files (the shared queue), as the section's rows come into view. */
    observeMaterialThumbs(root: HTMLElement, ctx: MaterialsContext): void {
        thumbObserver?.disconnect();
        thumbObserver = null;
        const tiles = Array.from(root.querySelectorAll<HTMLElement>('.material-thumb[data-sha]'));
        if (tiles.length === 0) return;
        const queue = materialThumbs();
        queue.setEnv({ treeId: ctx.treeId, base: ctx.base, thumb: ctx.caps.thumb, bridgeUp: ctx.caps.bridgeUp });
        const want = (el: HTMLElement) => {
            const sha = el.dataset.sha;
            const item = sectionItems.get(el.closest<HTMLElement>('.material-row')?.dataset.key ?? '');
            if (!sha) return;
            queue.want(
                { sha, px: THUMB_PX, mime: item?.mime, name: item?.file?.name ?? item?.title, bytes: item?.bytes, where: strings.materials.title },
                url => {
                    if (!url || !el.isConnected) return;
                    el.innerHTML = `<img src="${esc(url)}" alt="">`;
                    el.classList.add('has-thumb');
                },
                () => el.isConnected && el.dataset.vis !== '0',
            );
        };
        if (typeof IntersectionObserver !== 'function') {
            tiles.forEach(want);
            return;
        }
        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                const el = entry.target as HTMLElement;
                el.dataset.vis = entry.isIntersecting ? '1' : '0';
                if (entry.isIntersecting) want(el);
            }
        }, { rootMargin: '200px' });
        thumbObserver = observer;
        tiles.forEach(el => observer.observe(el));
    },

    // ==================== KEEPING UP ====================

    /**
     * Called whenever the research's state was redrawn (polls): remember its
     * material capabilities, redraw what depends on the gates and the
     * bridge, and ask again once the bridge runs.
     */
    materialsBridgeChanged(): void {
        const link = this.researchSyncLink();
        if (!link) return;
        const live = this.researchStatusOf(link.link.id)?.features;
        if (live) rememberMaterialFeatures(link.link.id, live);
        const ctx = this.materialsContext();
        const key = ctx ? `${ctx.caps.list}|${ctx.caps.assign}|${ctx.caps.bridgeUp}` : '';
        const changed = key !== lastBridgeKey;
        if (ctx?.caps.list && ctx.caps.bridgeUp) {
            void this.refreshAllMaterials();
            if (changed && this.currentId && document.getElementById('person-modal')?.classList.contains('active')) {
                void this.refreshPersonMaterials(this.currentId);
            }
        }
        this.refreshMaterialsWindow();
        if (changed) {
            lastBridgeKey = key;
            const person = this.currentId ? DataManager.getPerson(this.currentId) : null;
            // The whole section's visibility (attachments back when materials go away).
            if (person && document.getElementById('person-modal')?.classList.contains('active')) this.applyAdvancedFieldVisibility(person);
        }
        this.refreshMaterialsCounts();
    },

    /** The cards' "Materials N": recomputed; the tree redrawn only when what it shows changed. */
    refreshMaterialsCounts(): void {
        const ctx = this.materialsContext();
        const on = !!ctx?.caps.list;
        const list = on && ctx ? cachedMaterialList(ctx.treeId) : null;
        providerState = { on, count: on ? materialCounter(list) : null };
        const signature = on && ctx ? `${ctx.treeId}|${list?.fetchedAt ?? 0}|${list?.files.length ?? 0}` : '';
        if (signature !== drawnSignature) {
            const had = drawnSignature !== '' || on;
            drawnSignature = signature;
            if (had && DataManager.getCurrentTreeId()) TreeRenderer.render();
        }
    },

    /**
     * A commit or an undo: when the tree's attachments changed (deleted with a
     * hidden file, brought back by Undo, added or removed anywhere), the open
     * Materials window, the person's section and the viewer follow at once.
     */
    materialsTreeChanged(): void {
        this.refreshMaterialsWindow();
        const person = this.currentId ? DataManager.getPerson(this.currentId) : null;
        if (person && document.getElementById('person-modal')?.classList.contains('active')
            && personAttachmentIds(person) !== sectionAttachments) {
            this.renderAttachmentsList();
            this.renderMaterialsSection();
        }
        this.materialViewerTreeChanged();
    },

    /** The remembered list changed (an answer, a save): redraw the section and the counts. */
    materialsListChanged(treeId: string): void {
        const ctx = this.materialsContext();
        if (!ctx || ctx.treeId !== treeId) return;
        if (document.getElementById('person-modal')?.classList.contains('active')) this.renderMaterialsSection();
        this.refreshMaterialsWindow();
        this.refreshMaterialsCounts();
        this.materialViewerListChanged();
    },

    /** Put what was just saved into the remembered list (before the research's own answer comes). */
    async materialsSaved(personId: PersonId, files: { id: string; name: string; sha: string; mime: string; bytes: number; note: string }[]): Promise<void> {
        const ctx = this.materialsContext();
        const person = DataManager.getPerson(personId);
        const refn = researchPersonRef(person?.refn);
        if (!ctx?.caps.list || !refn) return;
        if (files.length === 0) {
            void this.refreshPersonMaterials(personId);
            return;
        }
        const at = new Date().toISOString();
        const records: MaterialFile[] = files.map(f => ({
            id: f.id, name: f.name, sha: f.sha, mime: f.mime, bytes: f.bytes, at, from: 'app',
            persons: [refn], ...(f.note ? { notes: [{ at, by: 'user', text: f.note }] } : {}),
        }));
        await mergeIntoCache(ctx.treeId, records);
        void this.refreshPersonMaterials(personId);
    },

    initMaterials(): void {
        setMaterialsCountProvider((p: Person) => (providerState.on && providerState.count ? providerState.count(p) : null));
        window.addEventListener(MATERIALS_EVENT, (e) => {
            const treeId = (e as CustomEvent<{ treeId?: string }>).detail?.treeId;
            if (treeId) this.materialsListChanged(treeId);
        });
        const prime = () => {
            const ctx = this.materialsContext();
            if (ctx) void primeMaterials(ctx.treeId).then(() => this.refreshMaterialsCounts());
            else this.refreshMaterialsCounts();
        };
        window.addEventListener('strom:tree-switched', prime);
        prime();
    },
});
