/**
 * Sources / citations UI: the per-tree Sources manager, the source viewer, the
 * single-source editor (with the entry's excerpts), and the citation chips +
 * source picker shown on persons, life events and partnerships.
 *
 * Citing and unciting go straight through DataManager (each its own undoable
 * action). The editor stages everything — fields, excerpts, a page kept as an
 * attachment — and saves it in one undo step.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { SettingsManager } from '../settings.js';
import { PersonId, PartnershipId, Source, SourceExcerpt, MAX_EXCERPTS_UI } from '../types.js';
import { strings } from '../strings.js';
import { uiModule } from './module.js';
import { emptyStateHtml } from './empty-state.js';
import { autoGrowAll } from './autogrow.js';
import { iconSvg } from '../icons.js';
import { safeHttpUrl } from '../validation.js';
import { formatFlexDate, normalizeDateInput, formatDateForInput, yearOf } from '../dates.js';
import { dataUrlByteSize } from '../photo.js';
import { totalExcerptBytes } from '../attachments.js';
import { excerptFromDataUrl } from '../excerpts.js';
import { openCropEditor, compressWholeImage, CropRegion } from './crop-editor.js';
import { eventTypeLabel } from './person-events.js';

/** What a citation applies to: a person, one of their events, or a partnership. */
export type CitationContext = { personId: PersonId; eventId?: string } | { partnershipId: PartnershipId };

/** An excerpt staged in the editor, with what only lives until the editor closes. */
export interface ExcerptDraft {
    excerpt: SourceExcerpt;
    /** The image it was cut from (a pasted screenshot, an uploaded file) — for "Crop". */
    original?: Blob;
    /** The whole page to save as an attachment of this person on Save. */
    pendingPage?: { personId: PersonId; dataUrl: string; name: string };
}

/** HTML-escape a user string for safe innerHTML insertion. */
function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Human-readable byte size (kB / MB). */
function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

/** Secondary line for a source: repository / reference joined with a middot. */
function sourceMeta(source: Source): string {
    return [source.repository, source.reference].filter(Boolean).join(' · ');
}

/** Label of a QUAY value as the editor names it (0 reads as "uncertain"). */
function qualityLabel(q: number | undefined): string {
    if (q === undefined) return '';
    return q >= 3 ? strings.sources.quality3 : q === 2 ? strings.sources.quality2 : strings.sources.quality1;
}

/** Thumbnail (or document icon) for a source, in one of the three sizes. */
function sourceThumbHtml(src: Source, kind: 'chip' | 'row' | 'picker'): string {
    const first = src.excerpts?.[0];
    if (first && kind === 'chip') return `<img class="source-${kind}-thumb" src="${esc(first.dataUrl)}" alt="">`;
    // Lists: the image comes when the row scrolls into view (hydrateThumbs).
    // Putting every excerpt into the markup parsed and escaped ~100 MB of
    // text for a catalog of a few hundred scans.
    if (first) return `<img class="source-${kind}-thumb" data-thumb-source="${esc(src.id)}" alt="">`;
    return `<span class="source-${kind}-icon" aria-hidden="true">${iconSvg('file', { size: kind === 'chip' ? 13 : 16 })}</span>`;
}

/** One observer per list, replaced on every render. */
const thumbObservers = new WeakMap<HTMLElement, IntersectionObserver>();

/** Give the list's thumbnails their image once they are (nearly) visible. */
function hydrateThumbs(container: HTMLElement): void {
    thumbObservers.get(container)?.disconnect();
    const imgs = container.querySelectorAll<HTMLImageElement>('img[data-thumb-source]');
    if (imgs.length === 0) return;
    const fill = (img: HTMLImageElement) => {
        const url = DataManager.getData().sources?.[img.dataset.thumbSource ?? '']?.excerpts?.[0]?.dataUrl;
        if (url) img.src = url;
        img.removeAttribute('data-thumb-source');
    };
    if (typeof IntersectionObserver === 'undefined') {
        imgs.forEach(fill);
        return;
    }
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            fill(entry.target as HTMLImageElement);
        }
    }, { rootMargin: '200px 0px' });
    imgs.forEach(img => observer.observe(img));
    thumbObservers.set(container, observer);
}

/**
 * The clickable part of a citation chip (thumbnail + title). Shared with the
 * relationships panel, which renders its own chips for partnerships.
 */
export function sourceChipOpenHtml(src: Source): string {
    return `<button type="button" class="source-chip-open" data-source-open="${esc(src.id)}"
        aria-label="${esc(strings.sources.chipOpen(src.title))}" title="${esc(sourceMeta(src) || src.title)}">
        ${sourceThumbHtml(src, 'chip')}<span class="source-chip-label">${esc(src.title)}</span></button>`;
}

/** Full name of a person for labels ("Jan Novák"). */
function personName(personId: PersonId): string {
    const p = DataManager.getPerson(personId);
    if (!p) return '?';
    return [p.firstName, p.lastName].filter(Boolean).join(' ') || '?';
}

/** Does the page run on a touch screen (no keyboard hint then)? */
function isCoarsePointer(): boolean {
    try { return window.matchMedia?.('(pointer: coarse)').matches ?? false; } catch { return false; }
}

const isMac = (): boolean => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The first image in a clipboard / drag payload, if any. */
function imageFromTransfer(dt: DataTransfer | null): File | null {
    if (!dt) return null;
    for (const item of Array.from(dt.items ?? [])) {
        if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
    }
    for (const file of Array.from(dt.files ?? [])) {
        if (file.type.startsWith('image/')) return file;
    }
    return null;
}

export const sourcesMethods = uiModule({
    // ==================== SOURCES MANAGER ====================

    showSourcesDialog(): void {
        if (DataManager.isTreeLocked()) return;
        const search = document.getElementById('sources-search') as HTMLInputElement | null;
        if (search) {
            search.value = '';
            search.oninput = () => this.renderSourcesList();
        }
        this.renderSourcesList();
        document.getElementById('sources-modal')?.classList.add('active');
    },

    closeSourcesDialog(): void {
        document.getElementById('sources-modal')?.classList.remove('active');
        if (this.returnToPickerAfterManager) {
            this.returnToPickerAfterManager = false;
            this.renderSourcePickerList();
            document.getElementById('source-picker-modal')?.classList.add('active');
        }
    },

    /** "Manage sources" in the picker: the catalog on top, back to the picker on close. */
    manageSourcesFromPicker(): void {
        this.returnToPickerAfterManager = true;
        document.getElementById('source-picker-modal')?.classList.remove('active');
        this.showSourcesDialog();
    },

    /** Render the per-tree source catalog as a table with view/edit/delete actions. */
    renderSourcesList(): void {
        const container = document.getElementById('sources-list');
        if (!container) return;
        const all = Object.values(DataManager.getData().sources ?? {});
        // The empty state carries "Add source" itself; the footer copy hides
        // meanwhile so the dialog keeps a single primary action.
        const footer = document.querySelector<HTMLElement>('#sources-modal .sources-footer');
        if (footer) footer.hidden = all.length === 0;
        const search = document.getElementById('sources-search') as HTMLInputElement | null;
        if (search) search.hidden = all.length <= 10;
        const totalEl = document.getElementById('sources-total');
        if (totalEl) {
            const bytes = totalExcerptBytes(DataManager.getData());
            totalEl.hidden = bytes <= 1024 * 1024;
            totalEl.textContent = strings.sources.excerptsTotal(formatBytes(bytes));
        }
        if (all.length === 0) {
            container.innerHTML = emptyStateHtml({
                title: strings.emptyStates.sourcesTitle,
                text: strings.emptyStates.sourcesText,
                actionLabel: strings.sources.add,
                actionId: 'sources-empty-add',
                className: 'sources-empty',
            });
            document.getElementById('sources-empty-add')
                ?.addEventListener('click', () => this.showAddSourceModal());
            return;
        }
        const query = search && !search.hidden ? search.value.trim().toLowerCase() : '';
        const sources = all.filter(s => this.sourceMatches(s, query)).sort((a, b) => a.title.localeCompare(b.title));
        const counts = DataManager.sourceCitationCounts();
        container.innerHTML = sources.map(src => {
            const count = counts.get(src.id) ?? 0;
            const meta = sourceMeta(src);
            return `
                <div class="source-row">
                    ${sourceThumbHtml(src, 'row')}
                    <div class="source-main">
                        <button type="button" class="source-row-open" data-source-id="${esc(src.id)}">
                            <span class="source-title">${esc(src.title)}</span></button>
                        ${meta ? `<span class="source-meta"> — ${esc(meta)}</span>` : ''}
                        ${count > 0 ? `<span class="source-count">${esc(strings.sources.citations(count))}</span>` : ''}
                    </div>
                    <div class="source-actions">
                        <button type="button" class="source-edit-btn" title="${esc(strings.sources.edit)}" aria-label="${esc(strings.sources.edit)}"
                            data-source-id="${esc(src.id)}">${iconSvg('pencil')}</button>
                        <button type="button" class="source-delete-btn" title="${esc(strings.danger.deleteSource)}" aria-label="${esc(strings.danger.deleteSource)}"
                            data-source-id="${esc(src.id)}">${iconSvg('trash')}</button>
                    </div>
                </div>`;
        }).join('');
        // Source ids come from data files: handlers via data attributes, never
        // inline JS (&#39; is decoded back to a quote inside an attribute).
        container.querySelectorAll<HTMLElement>('.source-row-open[data-source-id]').forEach(btn => {
            btn.addEventListener('click', () => this.showSourceViewer(btn.dataset.sourceId ?? '', null));
        });
        container.querySelectorAll<HTMLElement>('.source-edit-btn[data-source-id]').forEach(btn => {
            btn.addEventListener('click', () => this.showEditSourceModal(btn.dataset.sourceId ?? ''));
        });
        container.querySelectorAll<HTMLElement>('.source-delete-btn[data-source-id]').forEach(btn => {
            btn.addEventListener('click', () => { void this.deleteSource(btn.dataset.sourceId ?? ''); });
        });
        hydrateThumbs(container);
    },

    /** Search over title, archive, reference and transcript (case-insensitive). */
    sourceMatches(src: Source, query: string): boolean {
        if (!query) return true;
        return [src.title, sourceMeta(src), src.transcript ?? ''].some(t => t.toLowerCase().includes(query));
    },

    async deleteSource(sourceId: string): Promise<void> {
        const count = DataManager.countSourceCitations(sourceId);
        // Name what is being deleted — several rows would otherwise get the
        // same sentence and the wrong one is one click away.
        const title = DataManager.getData().sources?.[sourceId]?.title ?? '';
        const d = strings.danger;
        const message = [count > 0 ? d.sourceCited(count) : '', d.undoHint].filter(Boolean).join(' ');
        const confirmed = await this.showConfirm(message, d.deleteSourceTitle(title),
            { confirmLabel: d.deleteSource, variant: 'danger' });
        if (!confirmed) return;
        DataManager.removeSource(sourceId);
        this.renderSourcesList();
        // Any open citation chips may now be stale.
        this.refreshCitationChips();
    },

    // ==================== SOURCE VIEWER ====================

    /**
     * Show one entry: its excerpts, a link to the page, the transcript and
     * what it supports. `ctx` is the citation chip it was opened from (a new
     * "entry from the same register" is then cited there too).
     */
    showSourceViewer(sourceId: string, ctx: CitationContext | null): void {
        const src = DataManager.getData().sources?.[sourceId];
        if (!src) return;
        this.sourceViewerId = sourceId;
        this.sourceViewerContext = ctx;
        this.renderSourceViewer();
        document.getElementById('source-viewer-modal')?.classList.add('active');
    },

    closeSourceViewer(): void {
        document.getElementById('source-viewer-modal')?.classList.remove('active');
        this.sourceViewerId = null;
        this.sourceViewerContext = null;
    },

    /** Can the current user change sources (not a read-only view, not locked)? */
    canEditSources(): boolean {
        return !DataManager.isReadOnly() && !DataManager.isTreeLocked();
    },

    renderSourceViewer(): void {
        const src = this.sourceViewerId ? DataManager.getData().sources?.[this.sourceViewerId] : undefined;
        const body = document.getElementById('source-viewer-body');
        if (!src || !body) return;
        const s = strings.sources;
        const editable = this.canEditSources();

        const titleEl = document.getElementById('source-viewer-title');
        if (titleEl) titleEl.textContent = src.title;
        const metaEl = document.getElementById('source-viewer-meta');
        if (metaEl) {
            const parts = [src.repository, src.reference,
                src.recordDate ? s.recordedOn(formatFlexDate(src.recordDate)) : ''].filter(Boolean).map(t => esc(t!));
            const q = qualityLabel(src.quality);
            if (q) parts.push(`<span class="source-quality-tag">${esc(q)}</span>`);
            metaEl.innerHTML = parts.join(' · ');
        }

        const chunks: string[] = [];
        const excerpts = src.excerpts ?? [];
        excerpts.forEach((exc, i) => {
            const alt = exc.caption || s.excerptAlt(src.title);
            chunks.push(`
                <figure class="viewer-excerpt">
                    <img src="${esc(exc.dataUrl)}" alt="${esc(alt)}" data-excerpt-index="${i}">
                    <button type="button" class="viewer-zoom" data-excerpt-index="${i}" aria-label="${esc(s.viewerZoom)}">⤢</button>
                    ${exc.caption ? `<figcaption>${esc(exc.caption)}</figcaption>` : ''}
                </figure>`);
        });
        if (excerpts.length === 0 && editable) {
            chunks.push(`<button type="button" class="secondary viewer-add-excerpt">${esc(s.addExcerpt)}</button>`);
        }
        const pageUrl = safeHttpUrl(excerpts[0]?.pageUrl) ?? safeHttpUrl(src.url);
        if (pageUrl) {
            chunks.push(`<a class="viewer-open-page" href="${esc(pageUrl)}" target="_blank" rel="noopener noreferrer">${esc(s.viewerOpenPage)} ↗</a>`);
        }
        if (src.transcript) {
            chunks.push(`<section><h3 class="viewer-section-title">${esc(s.viewerTranscript)}</h3>
                <p class="viewer-transcript">${esc(src.transcript)}</p></section>`);
        }
        const cites = DataManager.listSourceCitations(src.id).map(ref => {
            if (ref.kind === 'partnership') {
                const u = DataManager.getData().partnerships[ref.partnershipId];
                return u ? s.citedPartnership(personName(u.person1Id), personName(u.person2Id)) : '';
            }
            if (ref.kind === 'event') {
                const ev = DataManager.getPerson(ref.personId)?.events?.find(e => e.id === ref.eventId);
                if (!ev) return '';
                const year = yearOf(ev.date);
                return `${personName(ref.personId)} — ${eventTypeLabel(ev)}${year !== null ? ` (${year})` : ''}`;
            }
            return personName(ref.personId);
        }).filter(Boolean);
        if (cites.length > 0) {
            chunks.push(`<section><h3 class="viewer-section-title">${esc(s.viewerCites)}</h3>
                <ul class="viewer-cites">${cites.map(c => `<li>${esc(c)}</li>`).join('')}</ul></section>`);
        }
        body.innerHTML = chunks.join('');

        body.querySelectorAll<HTMLElement>('[data-excerpt-index]').forEach(el => {
            el.addEventListener('click', () => {
                const exc = excerpts[Number(el.dataset.excerptIndex)];
                if (exc) this.showImageOverlay(exc.dataUrl);
            });
        });
        body.querySelector('.viewer-add-excerpt')?.addEventListener('click', () => this.editFromSourceViewer(true));

        const editBtn = document.getElementById('source-viewer-edit');
        if (editBtn) editBtn.hidden = !editable;
        const sameBook = document.getElementById('source-viewer-same-book');
        if (sameBook) sameBook.hidden = !editable;
        // Read-only: nothing to do in the footer (the × and Escape close).
        const footer = document.querySelector<HTMLElement>('#source-viewer-modal .source-viewer-footer');
        if (footer) footer.hidden = !editable;
    },

    /** "Edit" in the viewer: the editor on top; the viewer comes back when it closes. */
    editFromSourceViewer(focusExcerpt = false): void {
        const id = this.sourceViewerId;
        if (!id) return;
        const ctx = this.sourceViewerContext;
        this.reopenViewerAfterEditor = id;
        document.getElementById('source-viewer-modal')?.classList.remove('active');
        this.sourceEditorContext = ctx;
        this.showEditSourceModal(id);
        if (focusExcerpt) {
            document.querySelector<HTMLElement>('#source-excerpts button')?.focus();
        }
    },

    // ==================== SOURCE EDITOR ====================

    showAddSourceModal(seed: Partial<Source> = {}, titlePlaceholder = ''): void {
        this.editingSourceId = null;
        this.fillSourceEditor(seed, titlePlaceholder);
        this.openSourceEditor(strings.sources.addTitle);
    },

    showEditSourceModal(sourceId: string): void {
        const src = DataManager.getData().sources?.[sourceId];
        if (!src) return;
        this.editingSourceId = sourceId;
        this.fillSourceEditor(src);
        this.openSourceEditor(strings.sources.editTitle);
    },

    /** Put a source's values into the editor form (and stage its excerpts). */
    fillSourceEditor(src: Partial<Source>, titlePlaceholder = ''): void {
        const set = (id: string, v: string | undefined) => {
            const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
            if (el) el.value = v ?? '';
        };
        set('input-source-title', src.title);
        set('input-source-repository', src.repository);
        set('input-source-reference', src.reference);
        set('input-source-url', src.url);
        set('input-source-note', src.note);
        set('input-source-transcript', src.transcript);
        set('input-source-recorddate', formatDateForInput(src.recordDate));
        const titleInput = document.getElementById('input-source-title') as HTMLInputElement | null;
        if (titleInput) titleInput.placeholder = titlePlaceholder;
        this.excerptDrafts = (src.excerpts ?? []).map(e => ({ excerpt: structuredClone(e) }));
        this.sourceQualityDraft = src.quality;
        const more = document.getElementById('source-more') as HTMLDetailsElement | null;
        if (more) more.open = !!(src.transcript || src.recordDate || src.quality !== undefined);
    },

    openSourceEditor(title: string): void {
        const titleEl = document.getElementById('source-editor-title');
        if (titleEl) titleEl.textContent = title;
        const modal = document.getElementById('source-editor-modal');
        if (!modal) return;
        // Whoever opened the editor without a context (the catalog) cites nothing.
        if (this.sourceEditorContext === null && this.citationContext) this.sourceEditorContext = this.citationContext;
        this.wireSourceEditor();
        this.renderExcerptBlock();
        this.renderQualityControl();
        const sameBook = document.getElementById('source-editor-same-book');
        if (sameBook) sameBook.hidden = !this.editingSourceId;
        modal.classList.add('active');
        // What a citation says about a record is prose too.
        autoGrowAll(modal, '#input-source-note, #input-source-transcript');
        // Baseline for the "unsaved changes" question on close.
        this.sourceEditorSnapshot = this.sourceEditorState();
    },

    /** One-time handlers: paste an image anywhere in the editor, reliability buttons. */
    wireSourceEditor(): void {
        if (this.sourceEditorWired) return;
        this.sourceEditorWired = true;
        const modal = document.getElementById('source-editor-modal');
        modal?.addEventListener('paste', (e) => {
            const file = imageFromTransfer((e as ClipboardEvent).clipboardData);
            // Only an image is taken over; text pastes into the field as usual.
            if (!file) return;
            e.preventDefault();
            void this.addExcerptFromPaste(file);
        });
        document.querySelectorAll<HTMLButtonElement>('#source-quality [data-quality]').forEach(btn => {
            btn.addEventListener('click', () => {
                const q = Number(btn.dataset.quality);
                // A second click on the chosen level clears it.
                this.sourceQualityDraft = this.sourceQualityDraft === q
                    || (q === 1 && this.sourceQualityDraft === 0) ? undefined : q;
                this.renderQualityControl();
            });
            btn.addEventListener('keydown', (e) => {
                const order = [3, 2, 1];
                const i = order.indexOf(Number(btn.dataset.quality));
                const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? order[(i + 1) % 3]
                    : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? order[(i + 2) % 3] : null;
                if (next === null) return;
                e.preventDefault();
                this.sourceQualityDraft = next;
                this.renderQualityControl();
                document.querySelector<HTMLElement>(`#source-quality [data-quality="${next}"]`)?.focus();
            });
        });
    },

    renderQualityControl(): void {
        // An imported 0 ("unreliable") shows as the lowest level and survives
        // until the user picks something else.
        const q = this.sourceQualityDraft;
        const shown = q === 0 ? 1 : q;
        document.querySelectorAll<HTMLButtonElement>('#source-quality [data-quality]').forEach(btn => {
            const on = Number(btn.dataset.quality) === shown;
            btn.setAttribute('aria-checked', String(on));
            btn.tabIndex = on || (shown === undefined && btn.dataset.quality === '3') ? 0 : -1;
        });
    },

    /** The editor's form values as one comparable string. */
    sourceEditorState(): string {
        const fields = ['title', 'repository', 'reference', 'url', 'note', 'transcript', 'recorddate'].map(f =>
            (document.getElementById(`input-source-${f}`) as HTMLInputElement | null)?.value ?? '');
        const excerpts = this.excerptDrafts.map(d => [d.excerpt.dataUrl.length, d.excerpt.dataUrl.slice(-64), d.excerpt.caption ?? '']);
        return JSON.stringify([fields, excerpts, this.sourceQualityDraft ?? null]);
    },

    hasSourceEditorChanges(): boolean {
        if (this.sourceEditorSnapshot === null) return false;
        if (!document.getElementById('source-editor-modal')?.classList.contains('active')) return false;
        return this.sourceEditorState() !== this.sourceEditorSnapshot;
    },

    /** Cancel / Escape: ask before throwing away edits, like the person modal. */
    closeSourceEditor(): void {
        if (this.hasSourceEditorChanges()) {
            this.showUnsavedEditorDialog(strings.sources.unsavedMessage,
                () => this.saveSourceFromModal(),
                () => this.forceCloseSourceEditor());
            return;
        }
        this.forceCloseSourceEditor();
    },

    forceCloseSourceEditor(): void {
        document.getElementById('source-editor-modal')?.classList.remove('active');
        this.editingSourceId = null;
        this.sourceEditorSnapshot = null;
        this.excerptDrafts = [];
        this.sourceQualityDraft = undefined;
        this.sourceEditorContext = null;
        document.querySelector('.excerpt-page-picker')?.remove();
        // If this editor was opened from the picker, tear the picker down too.
        if (this.citeSourceAfterCreate) {
            this.citeSourceAfterCreate = false;
            this.closeSourcePicker();
        }
        // "Edit" from the viewer: back to the (refreshed) viewer.
        const back = this.reopenViewerAfterEditor;
        if (back) {
            this.reopenViewerAfterEditor = null;
            if (DataManager.getData().sources?.[back]) {
                this.showSourceViewer(back, this.sourceViewerContext);
            } else {
                this.closeSourceViewer();
            }
        }
    },

    /** Validate and persist the source editor, then refresh whatever is open. */
    saveSourceFromModal(): void {
        const val = (id: string) => ((document.getElementById(id) as HTMLInputElement | null)?.value ?? '').trim();
        const title = val('input-source-title');
        const repository = val('input-source-repository');
        const reference = val('input-source-reference');
        const url = val('input-source-url');
        const note = val('input-source-note');
        const transcript = val('input-source-transcript');
        const recordDate = normalizeDateInput(val('input-source-recorddate'));

        if (!title) {
            this.showAlert(strings.sources.titleRequired, 'warning');
            return;
        }
        if (recordDate === null) {
            this.showAlert(strings.personModal.invalidDate, 'warning');
            return;
        }

        const payload: Omit<Source, 'id'> = { title };
        if (repository) payload.repository = repository;
        if (reference) payload.reference = reference;
        if (url) payload.url = url;
        if (note) payload.note = note;
        if (transcript) payload.transcript = transcript;
        if (recordDate) payload.recordDate = recordDate;
        if (this.sourceQualityDraft !== undefined) payload.quality = this.sourceQualityDraft;

        const citedPartnership = this.citeSourceAfterCreate && !!this.citationContext
            && 'partnershipId' in this.citationContext;
        const drafts = this.excerptDrafts;
        const editingId = this.editingSourceId;
        const citeAfterCreate = this.citeSourceAfterCreate;

        // One user action, one undo step: pages kept as attachments, the source
        // and (from the picker) its citation.
        DataManager.runBatch(editingId ? strings.undo.editSource(title) : strings.undo.addSource(title), () => {
            const excerpts: SourceExcerpt[] = drafts.map(d => {
                const exc = { ...d.excerpt };
                if (d.pendingPage) {
                    const att = DataManager.addAttachment(d.pendingPage.personId, {
                        name: d.pendingPage.name, mimeType: 'image/jpeg',
                        dataUrl: d.pendingPage.dataUrl, sizeBytes: dataUrlByteSize(d.pendingPage.dataUrl),
                    });
                    if (att) exc.fromAttachmentId = att.id;
                    else delete exc.region;
                }
                return exc;
            });
            if (excerpts.length > 0) payload.excerpts = excerpts;
            if (editingId) {
                // Emptied optional fields go as explicit undefined, or the old
                // value would survive the save (updateSource drops these keys).
                DataManager.updateSource(editingId, {
                    ...payload,
                    repository: repository || undefined,
                    reference: reference || undefined,
                    url: url || undefined,
                    note: note || undefined,
                    transcript: transcript || undefined,
                    recordDate: recordDate || undefined,
                    quality: this.sourceQualityDraft,
                    excerpts: excerpts.length > 0 ? excerpts : undefined,
                });
            } else {
                const created = DataManager.addSource(payload);
                // Created from the picker (or "same register" from a chip) →
                // immediately cite it to that context.
                if (created && citeAfterCreate) {
                    this.applyCitation(created.id);
                    this.noteRecentSource(created.id);
                }
            }
        });

        // forceCloseSourceEditor tears down the picker too when it was a create+cite.
        this.forceCloseSourceEditor();
        if (!citeAfterCreate) this.renderSourcesList();
        this.refreshCitationChips();
        if (drafts.some(d => d.pendingPage)) this.renderAttachmentsList();
        // A source cited on a partnership shows in the relationships panel.
        if (citedPartnership) this.refreshRelationshipsPanel();
    },

    // ==================== EXCERPTS (editor) ====================

    /** Draw the excerpt block: filled excerpts, then the ways to add one. */
    renderExcerptBlock(): void {
        const box = document.getElementById('source-excerpts');
        if (!box) return;
        const s = strings.sources;
        const items = this.excerptDrafts.map((d, i) => {
            const canCrop = !!d.original || this.attachmentForExcerpt(d.excerpt) !== null;
            return `
                <div class="excerpt-item" data-index="${i}">
                    <img class="excerpt-img" src="${esc(d.excerpt.dataUrl)}" alt="${esc(d.excerpt.caption || s.excerptLabel)}" data-action="zoom">
                    <div class="excerpt-bar">
                        <input type="text" class="excerpt-caption" value="${esc(d.excerpt.caption ?? '')}"
                            placeholder="${esc(s.excerptCaption)}" aria-label="${esc(s.excerptCaption)}" data-action="caption">
                        <span class="excerpt-size">${esc(formatBytes(d.excerpt.sizeBytes))}</span>
                        ${canCrop ? `<button type="button" class="secondary" data-action="crop">${esc(s.excerptCrop)}</button>` : ''}
                        <button type="button" class="secondary" data-action="replace">${esc(s.excerptReplace)}</button>
                        <button type="button" class="excerpt-remove" data-action="remove" title="${esc(s.excerptRemove)}"
                            aria-label="${esc(s.excerptRemove)}">${iconSvg('trash')}</button>
                    </div>
                </div>`;
        }).join('');
        const count = this.excerptDrafts.length;
        const adder = count === 0
            ? this.excerptAdderHtml(-1, true)
            : count < MAX_EXCERPTS_UI
                ? `<button type="button" class="link-button excerpt-add-second" data-action="add-second">+ ${esc(s.excerptAddSecond)}</button>`
                : '';
        box.innerHTML = items + adder;

        box.querySelectorAll<HTMLElement>('[data-action]').forEach(el => {
            const index = Number(el.closest<HTMLElement>('[data-index]')?.dataset.index ?? -1);
            const action = el.dataset.action;
            if (action === 'caption') {
                el.addEventListener('input', () => {
                    const d = this.excerptDrafts[index];
                    if (!d) return;
                    const v = (el as HTMLInputElement).value.trim();
                    if (v) d.excerpt.caption = v; else delete d.excerpt.caption;
                });
                return;
            }
            el.addEventListener('click', (e) => {
                if (action === 'zoom') this.showImageOverlay(this.excerptDrafts[index]?.excerpt.dataUrl ?? '');
                else if (action === 'crop') void this.recropExcerpt(index);
                else if (action === 'replace') this.showExcerptAdderMenu(el, index);
                else if (action === 'remove') { this.excerptDrafts.splice(index, 1); this.renderExcerptBlock(); }
                else if (action === 'add-second') this.showExcerptAdderMenu(el, -1);
                else if (action === 'paste') void this.pasteExcerptFromClipboard(Number((e.currentTarget as HTMLElement).dataset.target));
                else if (action === 'upload') this.pickExcerptFile(Number((e.currentTarget as HTMLElement).dataset.target));
                else if (action === 'from-attachment') this.showAttachmentPagePicker(el, Number((e.currentTarget as HTMLElement).dataset.target));
            });
        });

        // Drop an image on the empty block.
        const empty = box.querySelector<HTMLElement>('.excerpt-empty');
        if (empty) {
            empty.addEventListener('dragover', (e) => { e.preventDefault(); empty.classList.add('dragover'); });
            empty.addEventListener('dragleave', () => empty.classList.remove('dragover'));
            empty.addEventListener('drop', (e) => {
                e.preventDefault();
                empty.classList.remove('dragover');
                const file = imageFromTransfer(e.dataTransfer);
                if (file) void this.addExcerptFromUpload(file, -1);
            });
        }
    },

    /**
     * The three ways to add an excerpt: paste, upload, crop from an attachment.
     * `target` is the draft to replace, or -1 to add a new one. With `empty`
     * it is the dashed empty state with its explanation.
     */
    excerptAdderHtml(target: number, empty: boolean): string {
        const s = strings.sources;
        const kbd = isCoarsePointer() ? '' : ` <kbd>${isMac() ? '⌘V' : 'Ctrl+V'}</kbd>`;
        const pages = this.excerptContextPages();
        const buttons = `
            <div class="excerpt-actions">
                <button type="button" class="secondary" data-action="paste" data-target="${target}">${esc(s.excerptPaste)}${kbd}</button>
                <button type="button" class="secondary" data-action="upload" data-target="${target}">${esc(s.excerptUpload)}</button>
                ${pages.length > 0 ? `<button type="button" class="secondary" data-action="from-attachment" data-target="${target}">${esc(s.excerptFromAttachment)}</button>` : ''}
            </div>`;
        return empty ? `<div class="excerpt-empty"><p>${esc(s.excerptEmpty)}</p>${buttons}</div>` : buttons;
    },

    /** Replace / add-second: the same three choices, just under the button. */
    showExcerptAdderMenu(anchor: HTMLElement, target: number): void {
        document.querySelector('.excerpt-adder-menu')?.remove();
        const menu = document.createElement('div');
        menu.className = 'excerpt-adder-menu';
        menu.innerHTML = this.excerptAdderHtml(target, false);
        anchor.closest('.excerpt-item, .source-excerpts')?.appendChild(menu);
        menu.querySelectorAll<HTMLElement>('[data-action]').forEach(el => {
            el.addEventListener('click', () => {
                const t = Number(el.dataset.target);
                menu.remove();
                if (el.dataset.action === 'paste') void this.pasteExcerptFromClipboard(t);
                else if (el.dataset.action === 'upload') this.pickExcerptFile(t);
                else this.showAttachmentPagePicker(anchor, t);
            });
        });
        menu.querySelector<HTMLElement>('button')?.focus();
    },

    /** Button "Paste from clipboard": the async clipboard API, else explain Ctrl+V. */
    async pasteExcerptFromClipboard(target: number): Promise<void> {
        try {
            if (!navigator.clipboard?.read) throw new Error('no clipboard.read');
            const items = await navigator.clipboard.read();
            for (const item of items) {
                const type = item.types.find(t => t.startsWith('image/'));
                if (type) {
                    await this.addExcerptFromPaste(await item.getType(type), target);
                    return;
                }
            }
            this.showToast(strings.sources.excerptNotImage);
        } catch {
            // No API (file://, Firefox) or permission refused: the keyboard
            // shortcut always works — the editor listens for paste.
            this.showToast(strings.sources.excerptPasteHint);
        }
    },

    pickExcerptFile(target: number): void {
        const input = document.getElementById('source-excerpt-file') as HTMLInputElement | null;
        if (!input) return;
        input.dataset.target = String(target);
        input.click();
    },

    handleExcerptFile(input: HTMLInputElement): void {
        const file = input.files?.[0];
        const target = Number(input.dataset.target ?? -1);
        input.value = '';
        if (file) void this.addExcerptFromUpload(file, target);
    },

    /** A screenshot is already the crop: compress it and take it as it is. */
    async addExcerptFromPaste(blob: Blob, target = -1): Promise<void> {
        if (target < 0 && this.excerptDrafts.length >= MAX_EXCERPTS_UI) {
            this.showToast(strings.sources.excerptMax);
            return;
        }
        try {
            const out = await compressWholeImage(blob);
            const exc = excerptFromDataUrl(out.dataUrl, { width: out.width, height: out.height });
            if (!exc) throw new Error('not an image');
            this.putExcerptDraft({ excerpt: exc, original: blob }, target);
        } catch {
            this.showAlert(strings.sources.excerptReadError, 'warning');
        }
    },

    /** An uploaded scan is a whole page: crop it first. */
    async addExcerptFromUpload(file: File, target: number): Promise<void> {
        if (target < 0 && this.excerptDrafts.length >= MAX_EXCERPTS_UI) {
            this.showToast(strings.sources.excerptMax);
            return;
        }
        const pagePerson = this.keepPagePersonId();
        try {
            const result = await openCropEditor(file, { allowKeepPage: pagePerson !== null });
            if (!result) return;
            const exc = excerptFromDataUrl(result.dataUrl, { width: result.width, height: result.height });
            if (!exc) throw new Error('not an image');
            const draft: ExcerptDraft = { excerpt: exc, original: file };
            if (result.keepPage && result.pageDataUrl && pagePerson) {
                exc.region = result.region;
                draft.pendingPage = { personId: pagePerson, dataUrl: result.pageDataUrl, name: file.name || 'page.jpg' };
            }
            this.putExcerptDraft(draft, target);
        } catch {
            this.showAlert(strings.sources.excerptReadError, 'warning');
        }
    },

    /** "Crop" on a staged excerpt: from its original, or from the page it was cut from. */
    async recropExcerpt(index: number): Promise<void> {
        const d = this.excerptDrafts[index];
        if (!d) return;
        const att = this.attachmentForExcerpt(d.excerpt);
        const source: Blob | string | undefined = att?.dataUrl ?? d.pendingPage?.dataUrl ?? d.original;
        if (!source) return;
        const fromPage = !!att || !!d.pendingPage;
        try {
            const result = await openCropEditor(source, { region: fromPage ? d.excerpt.region : undefined });
            if (!result) return;
            const exc = excerptFromDataUrl(result.dataUrl, {
                width: result.width, height: result.height,
                caption: d.excerpt.caption, pageUrl: d.excerpt.pageUrl,
            });
            if (!exc) return;
            // A rotated page no longer matches the stored one: the link goes.
            if (fromPage && !result.rotated) {
                exc.region = result.region;
                if (att) exc.fromAttachmentId = att.id;
            }
            this.excerptDrafts[index] = { ...d, excerpt: exc, pendingPage: result.rotated ? undefined : d.pendingPage };
            this.renderExcerptBlock();
        } catch {
            this.showAlert(strings.sources.excerptReadError, 'warning');
        }
    },

    /** "Crop from attachment": a small grid of the context's page images. */
    showAttachmentPagePicker(anchor: HTMLElement, target: number): void {
        document.querySelector('.excerpt-page-picker')?.remove();
        const pages = this.excerptContextPages();
        if (pages.length === 0) return;
        const grid = document.createElement('div');
        grid.className = 'excerpt-page-picker';
        grid.setAttribute('role', 'group');
        grid.setAttribute('aria-label', strings.sources.excerptPickPage);
        grid.innerHTML = pages.map((p, i) =>
            `<button type="button" data-page="${i}" title="${esc(p.name)}" aria-label="${esc(p.name)}"><img src="${esc(p.dataUrl)}" alt=""></button>`).join('');
        (anchor.closest('.excerpt-empty, .excerpt-item') ?? document.getElementById('source-excerpts'))?.appendChild(grid);
        grid.querySelectorAll<HTMLElement>('[data-page]').forEach(btn => {
            btn.addEventListener('click', () => {
                grid.remove();
                void this.addExcerptFromAttachment(pages[Number(btn.dataset.page)], target);
            });
        });
        grid.querySelector<HTMLElement>('button')?.focus();
    },

    async addExcerptFromAttachment(page: { id: string; dataUrl: string }, target: number): Promise<void> {
        if (target < 0 && this.excerptDrafts.length >= MAX_EXCERPTS_UI) {
            this.showToast(strings.sources.excerptMax);
            return;
        }
        try {
            const result = await openCropEditor(page.dataUrl, {});
            if (!result) return;
            const extra: { width: number; height: number; fromAttachmentId?: string; region?: CropRegion } =
                { width: result.width, height: result.height };
            if (!result.rotated) { extra.fromAttachmentId = page.id; extra.region = result.region; }
            const exc = excerptFromDataUrl(result.dataUrl, extra);
            if (exc) this.putExcerptDraft({ excerpt: exc }, target);
        } catch {
            this.showAlert(strings.sources.excerptReadError, 'warning');
        }
    },

    putExcerptDraft(draft: ExcerptDraft, target: number): void {
        if (target >= 0 && this.excerptDrafts[target]) {
            // A replacement keeps the caption the user wrote.
            const caption = this.excerptDrafts[target].excerpt.caption;
            if (caption && !draft.excerpt.caption) draft.excerpt.caption = caption;
            this.excerptDrafts[target] = draft;
        } else if (this.excerptDrafts.length < MAX_EXCERPTS_UI) {
            this.excerptDrafts.push(draft);
        } else {
            this.showToast(strings.sources.excerptMax);
            return;
        }
        this.renderExcerptBlock();
    },

    /** The person attachment an excerpt was cut from, while it still exists. */
    attachmentForExcerpt(exc: SourceExcerpt): { id: string; dataUrl: string } | null {
        if (!exc.fromAttachmentId) return null;
        for (const person of Object.values(DataManager.getData().persons)) {
            const att = person.attachments?.find(a => a.id === exc.fromAttachmentId);
            if (att) return att;
        }
        return null;
    },

    /** Persons whose attachments the editor may crop from (person, or both partners). */
    excerptContextPersonIds(): PersonId[] {
        const ctx = this.sourceEditorContext;
        if (!ctx) return [];
        if ('partnershipId' in ctx) {
            const u = DataManager.getData().partnerships[ctx.partnershipId];
            return u ? [u.person1Id, u.person2Id] : [];
        }
        return [ctx.personId];
    },

    /** The one person a whole page can be saved to (none for a marriage). */
    keepPagePersonId(): PersonId | null {
        const ctx = this.sourceEditorContext;
        if (!ctx || 'partnershipId' in ctx) return null;
        return DataManager.isPersonLocked(ctx.personId) ? null : ctx.personId;
    },

    /** Image attachments of the context persons, to crop an excerpt from. */
    excerptContextPages(): { id: string; dataUrl: string; name: string }[] {
        const out: { id: string; dataUrl: string; name: string }[] = [];
        for (const pid of this.excerptContextPersonIds()) {
            for (const att of DataManager.getPerson(pid)?.attachments ?? []) {
                if (att.mimeType.startsWith('image/')) out.push(att);
            }
        }
        return out;
    },

    // ==================== "ANOTHER ENTRY FROM THE SAME REGISTER" ====================

    /**
     * A new source with the same archive, reference and link as the current
     * one (editor or viewer). Opened from a citation chip, it is cited there.
     */
    startSameBookEntry(): void {
        const editorOpen = document.getElementById('source-editor-modal')?.classList.contains('active');
        const baseId = editorOpen ? this.editingSourceId : this.sourceViewerId;
        const base = baseId ? DataManager.getData().sources?.[baseId] : undefined;
        if (!base) return;
        const go = (): void => {
            const ctx = this.sourceViewerContext ?? this.sourceEditorContext;
            // The new entry replaces the viewer: do not bring it back on close.
            this.reopenViewerAfterEditor = null;
            if (editorOpen) this.forceCloseSourceEditor();
            this.closeSourceViewer();
            if (ctx) {
                this.citationContext = ctx;
                this.citeSourceAfterCreate = true;
            }
            this.sourceEditorContext = ctx;
            this.showAddSourceModal({ repository: base.repository, reference: base.reference, url: base.url }, base.title);
            document.getElementById('input-source-title')?.focus();
        };
        if (editorOpen && this.hasSourceEditorChanges()) {
            this.showUnsavedEditorDialog(strings.sources.unsavedMessage,
                () => { const id = this.editingSourceId; this.saveSourceFromModal(); if (id) go(); },
                () => go());
            return;
        }
        go();
    },

    // ==================== IMAGE OVERLAY ====================

    /** Fullscreen image (the attachment preview overlay, shared). */
    showImageOverlay(dataUrl: string): void {
        if (!dataUrl) return;
        this.showAttachmentImage(dataUrl);
    },

    // ==================== CITATION CHIPS ====================

    /** Chips for the sourceIds: open the viewer, remove (uncite) per chip. */
    renderSourceChips(containerId: string, sourceIds: string[] | undefined, removeHandler: string, ctx?: CitationContext): void {
        const container = document.getElementById(containerId);
        if (!container) return;
        const sources = DataManager.getData().sources ?? {};
        // Set: trees imported before the parser deduped may repeat an id.
        const ids = [...new Set(sourceIds ?? [])].filter(id => sources[id]);
        if (ids.length === 0) {
            container.innerHTML = `<span class="sources-empty">${esc(strings.sources.empty)}</span>`;
            return;
        }
        container.innerHTML = ids.map(id => `
            <span class="source-chip ${sources[id].excerpts?.length ? 'has-thumb' : 'has-icon'}">
                ${sourceChipOpenHtml(sources[id])}
                <button type="button" class="source-chip-remove" title="${esc(strings.sources.remove)}" aria-label="${esc(strings.sources.remove)}"
                    data-source-id="${esc(id)}">&times;</button>
            </span>`).join('');
        // Source ids come from data files: no inline JS (see renderSourcesList).
        const handler = (this as unknown as Record<string, unknown>)[removeHandler];
        container.querySelectorAll<HTMLElement>('.source-chip-remove[data-source-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (typeof handler === 'function') handler.call(this, btn.dataset.sourceId ?? '');
            });
        });
        container.querySelectorAll<HTMLElement>('.source-chip-open[data-source-open]').forEach(btn => {
            btn.addEventListener('click', () => this.showSourceViewer(btn.dataset.sourceOpen ?? '', ctx ?? null));
        });
    },

    /** Refresh whichever citation chip lists are currently on screen. */
    refreshCitationChips(): void {
        if (this.currentId) this.renderPersonSourcesChips();
        if (this.currentId && this.editingEventId) this.renderEventSourcesChips();
    },

    renderPersonSourcesChips(): void {
        if (!this.currentId) return;
        const person = DataManager.getPerson(this.currentId);
        this.renderSourceChips('person-sources-chips', person?.sourceIds, 'uncitePersonSource', { personId: this.currentId });
    },

    renderEventSourcesChips(): void {
        if (!this.currentId || !this.editingEventId) return;
        const ev = DataManager.getPerson(this.currentId)?.events?.find(e => e.id === this.editingEventId);
        this.renderSourceChips('event-sources-chips', ev?.sourceIds, 'unciteEventSource',
            { personId: this.currentId, eventId: this.editingEventId });
    },

    uncitePersonSource(sourceId: string): void {
        if (!this.currentId) return;
        DataManager.uncitePerson(this.currentId, sourceId);
        this.renderPersonSourcesChips();
    },

    unciteEventSource(sourceId: string): void {
        if (!this.currentId || !this.editingEventId) return;
        DataManager.unciteEvent(this.currentId, this.editingEventId, sourceId);
        this.renderEventSourcesChips();
    },

    // ==================== SOURCE PICKER ====================

    showSourcePickerForPerson(): void {
        if (!this.currentId) return;
        this.citationContext = { personId: this.currentId };
        this.openSourcePicker();
    },

    showSourcePickerForEvent(): void {
        if (!this.currentId || !this.editingEventId) return;
        this.citationContext = { personId: this.currentId, eventId: this.editingEventId };
        this.openSourcePicker();
    },

    /** Cite a source on a partnership (marriage record etc.). */
    showSourcePickerForPartnership(partnershipId: PartnershipId): void {
        this.citationContext = { partnershipId };
        this.openSourcePicker();
    },

    openSourcePicker(): void {
        const search = document.getElementById('source-picker-search') as HTMLInputElement | null;
        if (search) {
            search.value = '';
            search.oninput = () => this.renderSourcePickerList();
        }
        this.renderSourcePickerList();
        document.getElementById('source-picker-modal')?.classList.add('active');
        search?.focus();
    },

    closeSourcePicker(): void {
        document.getElementById('source-picker-modal')?.classList.remove('active');
        this.citationContext = null;
    },

    /**
     * List selectable sources (filtered by the search box), excluding ones
     * already cited in the current context. A big catalog gets a "Recently
     * used" group on top while the search is empty.
     */
    renderSourcePickerList(): void {
        const container = document.getElementById('source-picker-list');
        if (!container) return;
        const query = ((document.getElementById('source-picker-search') as HTMLInputElement | null)?.value ?? '').trim().toLowerCase();
        const already = new Set(this.currentCitationSourceIds());
        const catalog = DataManager.getData().sources ?? {};
        const sources = Object.values(catalog)
            .filter(s => !already.has(s.id))
            .filter(s => this.sourceMatches(s, query))
            .sort((a, b) => a.title.localeCompare(b.title));

        if (sources.length === 0) {
            container.innerHTML = `<div class="sources-empty">${esc(strings.sources.emptyPicker)}</div>`;
            return;
        }
        const item = (s: Source) => {
            const meta = sourceMeta(s);
            return `
                <button type="button" class="source-picker-item" data-source-id="${esc(s.id)}">
                    ${sourceThumbHtml(s, 'picker')}
                    <span class="source-picker-text">
                        <span class="source-title">${esc(s.title)}</span>
                        ${meta ? `<span class="source-meta"> — ${esc(meta)}</span>` : ''}
                    </span>
                </button>`;
        };
        const treeId = TreeManager.getActiveTreeId();
        const recent = !query && Object.keys(catalog).length > 8 && treeId
            ? SettingsManager.getRecentSourceIds(treeId).map(id => catalog[id]).filter((s): s is Source => !!s && !already.has(s.id))
            : [];
        container.innerHTML = recent.length > 0
            ? `<div class="source-picker-section">${esc(strings.sources.recent)}</div>${recent.map(item).join('')}
               <div class="source-picker-section">${esc(strings.sources.all)}</div>${sources.map(item).join('')}`
            : sources.map(item).join('');
        container.querySelectorAll<HTMLElement>('.source-picker-item[data-source-id]').forEach(btn => {
            btn.addEventListener('click', () => this.pickSource(btn.dataset.sourceId ?? ''));
        });
        hydrateThumbs(container);
    },

    /** Source ids already cited in the active citation context. */
    currentCitationSourceIds(): string[] {
        const ctx = this.citationContext;
        if (!ctx) return [];
        if ('partnershipId' in ctx) {
            return DataManager.getData().partnerships[ctx.partnershipId]?.sourceIds ?? [];
        }
        const person = DataManager.getPerson(ctx.personId);
        if (!person) return [];
        if (ctx.eventId) {
            return person.events?.find(e => e.id === ctx.eventId)?.sourceIds ?? [];
        }
        return person.sourceIds ?? [];
    },

    /** Apply a citation of `sourceId` to the active context. */
    applyCitation(sourceId: string): void {
        const ctx = this.citationContext;
        if (!ctx) return;
        if ('partnershipId' in ctx) {
            DataManager.citePartnership(ctx.partnershipId, sourceId);
        } else if (ctx.eventId) {
            DataManager.citeEvent(ctx.personId, ctx.eventId, sourceId);
        } else {
            DataManager.citePerson(ctx.personId, sourceId);
        }
    },

    /** Remember a citation for the picker's "Recently used" (per browser, per tree). */
    noteRecentSource(sourceId: string): void {
        const treeId = TreeManager.getActiveTreeId();
        if (treeId) SettingsManager.noteRecentSource(treeId, sourceId);
    },

    pickSource(sourceId: string): void {
        const wasPartnership = !!this.citationContext && 'partnershipId' in this.citationContext;
        this.applyCitation(sourceId);
        this.noteRecentSource(sourceId);
        this.closeSourcePicker();
        this.refreshCitationChips();
        if (wasPartnership) this.refreshRelationshipsPanel();
    },

    /** "New source…" in the picker: open the editor with a title from the context. */
    createSourceFromPicker(): void {
        this.citeSourceAfterCreate = true;
        this.sourceEditorContext = this.citationContext;
        // Hide the picker overlay so the editor is not covered (keep the context).
        document.getElementById('source-picker-modal')?.classList.remove('active');
        this.showAddSourceModal({ title: this.suggestedSourceTitle() });
        // The suggestion is a start, not a decision: select it for overtyping.
        const input = document.getElementById('input-source-title') as HTMLInputElement | null;
        input?.select();
    },

    /**
     * A title from what is being cited: "Jan Novák", "Baptism – Jan Novák, 1865",
     * "Marriage – Jan Novák and Anna Nová, 1890". A missing year is left out.
     */
    suggestedSourceTitle(): string {
        const ctx = this.citationContext;
        if (!ctx) return '';
        const withYear = (text: string, date?: string) => {
            const year = yearOf(date);
            return year !== null ? `${text}, ${year}` : text;
        };
        if ('partnershipId' in ctx) {
            const u = DataManager.getData().partnerships[ctx.partnershipId];
            if (!u) return '';
            return withYear(strings.sources.newTitleMarriage(personName(u.person1Id), personName(u.person2Id)), u.startDate);
        }
        const name = personName(ctx.personId);
        if (!ctx.eventId) return name;
        const ev = DataManager.getPerson(ctx.personId)?.events?.find(e => e.id === ctx.eventId);
        return ev ? withYear(`${eventTypeLabel(ev)} – ${name}`, ev.date) : name;
    },
});
