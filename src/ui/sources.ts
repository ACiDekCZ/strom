/**
 * Sources / citations UI: the per-tree Sources manager, the single-source
 * editor, and the citation chips + source picker shown on persons and life
 * events. Every mutation goes straight through DataManager (its own undoable
 * action), independent of the person modal's staged Save/Cancel.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { PersonId, PartnershipId, Source } from '../types.js';
import { strings } from '../strings.js';
import { uiModule } from './module.js';
import { emptyStateHtml } from './empty-state.js';
import { autoGrowAll } from './autogrow.js';

import { iconSvg } from '../icons.js';
/** HTML-escape a user string for safe innerHTML insertion. */
function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Secondary line for a source: repository / reference joined with a middot. */
function sourceMeta(source: Source): string {
    return [source.repository, source.reference].filter(Boolean).join(' · ');
}

export const sourcesMethods = uiModule({
    // ==================== SOURCES MANAGER ====================

    showSourcesDialog(): void {
        if (DataManager.isTreeLocked()) return;
        this.renderSourcesList();
        document.getElementById('sources-modal')?.classList.add('active');
    },

    closeSourcesDialog(): void {
        document.getElementById('sources-modal')?.classList.remove('active');
    },

    /** Render the per-tree source catalog as a table with edit/delete actions. */
    renderSourcesList(): void {
        const container = document.getElementById('sources-list');
        if (!container) return;
        const sources = Object.values(DataManager.getData().sources ?? {});
        // The empty state carries "Add source" itself; the footer copy hides
        // meanwhile so the dialog keeps a single primary action.
        const footer = document.querySelector<HTMLElement>('#sources-modal .sources-footer');
        if (footer) footer.hidden = sources.length === 0;
        if (sources.length === 0) {
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
        sources.sort((a, b) => a.title.localeCompare(b.title));
        container.innerHTML = sources.map(src => {
            const count = DataManager.countSourceCitations(src.id);
            const meta = sourceMeta(src);
            return `
                <div class="source-row">
                    <div class="source-main">
                        <span class="source-title">${esc(src.title)}</span>
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
        container.querySelectorAll<HTMLElement>('.source-edit-btn[data-source-id]').forEach(btn => {
            btn.addEventListener('click', () => this.showEditSourceModal(btn.dataset.sourceId ?? ''));
        });
        container.querySelectorAll<HTMLElement>('.source-delete-btn[data-source-id]').forEach(btn => {
            btn.addEventListener('click', () => { void this.deleteSource(btn.dataset.sourceId ?? ''); });
        });
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

    // ==================== SOURCE EDITOR ====================

    showAddSourceModal(): void {
        this.editingSourceId = null;
        this.setSourceFields('', '', '', '', '');
        this.openSourceEditor(strings.sources.addTitle);
    },

    showEditSourceModal(sourceId: string): void {
        const src = DataManager.getData().sources?.[sourceId];
        if (!src) return;
        this.editingSourceId = sourceId;
        this.setSourceFields(src.title, src.repository ?? '', src.reference ?? '', src.url ?? '', src.note ?? '');
        this.openSourceEditor(strings.sources.editTitle);
    },

    setSourceFields(title: string, repository: string, reference: string, url: string, note: string): void {
        (document.getElementById('input-source-title') as HTMLInputElement).value = title;
        (document.getElementById('input-source-repository') as HTMLInputElement).value = repository;
        (document.getElementById('input-source-reference') as HTMLInputElement).value = reference;
        (document.getElementById('input-source-url') as HTMLInputElement).value = url;
        (document.getElementById('input-source-note') as HTMLTextAreaElement).value = note;
    },

    openSourceEditor(title: string): void {
        const titleEl = document.getElementById('source-editor-title');
        if (titleEl) titleEl.textContent = title;
        const modal = document.getElementById('source-editor-modal');
        if (!modal) return;
        modal.classList.add('active');
        // What a citation says about a record is prose too.
        autoGrowAll(modal, '#input-source-note');
        // Baseline for the "unsaved changes" question on close.
        this.sourceEditorSnapshot = this.sourceEditorState();
    },

    /** The editor's form values as one comparable string. */
    sourceEditorState(): string {
        return JSON.stringify(['title', 'repository', 'reference', 'url', 'note'].map(f =>
            (document.getElementById(`input-source-${f}`) as HTMLInputElement | null)?.value ?? ''));
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
        // If this editor was opened from the picker, tear the picker down too.
        if (this.citeSourceAfterCreate) {
            this.citeSourceAfterCreate = false;
            this.closeSourcePicker();
        }
    },

    /** Validate and persist the source editor, then refresh whatever is open. */
    saveSourceFromModal(): void {
        const title = (document.getElementById('input-source-title') as HTMLInputElement).value.trim();
        const repository = (document.getElementById('input-source-repository') as HTMLInputElement).value.trim();
        const reference = (document.getElementById('input-source-reference') as HTMLInputElement).value.trim();
        const url = (document.getElementById('input-source-url') as HTMLInputElement).value.trim();
        const note = (document.getElementById('input-source-note') as HTMLTextAreaElement).value.trim();

        if (!title) {
            this.showAlert(strings.sources.titleRequired, 'warning');
            return;
        }

        const payload: Omit<Source, 'id'> = { title };
        if (repository) payload.repository = repository;
        if (reference) payload.reference = reference;
        if (url) payload.url = url;
        if (note) payload.note = note;

        const citedPartnership = this.citeSourceAfterCreate && !!this.citationContext
            && 'partnershipId' in this.citationContext;
        if (this.editingSourceId) {
            // Emptied optional fields go as explicit undefined, or the old
            // value would survive the save (updateSource drops these keys).
            payload.repository = repository || undefined;
            payload.reference = reference || undefined;
            payload.url = url || undefined;
            payload.note = note || undefined;
            DataManager.updateSource(this.editingSourceId, payload);
        } else if (this.citeSourceAfterCreate) {
            // Created from the picker → immediately cite it to the context.
            // One user action, one undo step.
            DataManager.runBatch(strings.undo.addSource(title), () => {
                const created = DataManager.addSource(payload);
                if (created) this.applyCitation(created.id);
            });
        } else {
            DataManager.addSource(payload);
        }

        const citeAfterCreate = this.citeSourceAfterCreate;
        // forceCloseSourceEditor tears down the picker too when it was a create+cite.
        this.forceCloseSourceEditor();
        if (!citeAfterCreate) this.renderSourcesList();
        this.refreshCitationChips();
        // A source cited on a partnership shows in the relationships panel.
        if (citedPartnership) this.refreshRelationshipsPanel();
    },

    // ==================== CITATION CHIPS ====================

    /** Chips for the sourceIds, with a remove (uncite) action per chip. */
    renderSourceChips(containerId: string, sourceIds: string[] | undefined, removeHandler: string): void {
        const container = document.getElementById(containerId);
        if (!container) return;
        const sources = DataManager.getData().sources ?? {};
        const ids = (sourceIds ?? []).filter(id => sources[id]);
        if (ids.length === 0) {
            container.innerHTML = `<span class="sources-empty">${esc(strings.sources.empty)}</span>`;
            return;
        }
        container.innerHTML = ids.map(id => `
            <span class="source-chip">
                <span class="source-chip-label" title="${esc(sourceMeta(sources[id]))}">${esc(sources[id].title)}</span>
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
    },

    /** Refresh whichever citation chip lists are currently on screen. */
    refreshCitationChips(): void {
        if (this.currentId) {
            const person = DataManager.getPerson(this.currentId);
            this.renderSourceChips('person-sources-chips', person?.sourceIds, 'uncitePersonSource');
        }
        if (this.currentId && this.editingEventId) {
            const ev = DataManager.getPerson(this.currentId)?.events?.find(e => e.id === this.editingEventId);
            this.renderSourceChips('event-sources-chips', ev?.sourceIds, 'unciteEventSource');
        }
    },

    renderPersonSourcesChips(): void {
        if (!this.currentId) return;
        const person = DataManager.getPerson(this.currentId);
        this.renderSourceChips('person-sources-chips', person?.sourceIds, 'uncitePersonSource');
    },

    renderEventSourcesChips(): void {
        if (!this.currentId || !this.editingEventId) return;
        const ev = DataManager.getPerson(this.currentId)?.events?.find(e => e.id === this.editingEventId);
        this.renderSourceChips('event-sources-chips', ev?.sourceIds, 'unciteEventSource');
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

    /** List selectable sources (filtered by the search box), excluding ones
     *  already cited in the current context. */
    renderSourcePickerList(): void {
        const container = document.getElementById('source-picker-list');
        if (!container) return;
        const query = ((document.getElementById('source-picker-search') as HTMLInputElement | null)?.value ?? '').toLowerCase();
        const already = new Set(this.currentCitationSourceIds());
        const sources = Object.values(DataManager.getData().sources ?? {})
            .filter(s => !already.has(s.id))
            .filter(s => !query || s.title.toLowerCase().includes(query) || sourceMeta(s).toLowerCase().includes(query))
            .sort((a, b) => a.title.localeCompare(b.title));

        if (sources.length === 0) {
            container.innerHTML = `<div class="sources-empty">${esc(strings.sources.emptyPicker)}</div>`;
            return;
        }
        container.innerHTML = sources.map(s => {
            const meta = sourceMeta(s);
            return `
                <button type="button" class="source-picker-item" data-source-id="${esc(s.id)}">
                    <span class="source-title">${esc(s.title)}</span>
                    ${meta ? `<span class="source-meta"> — ${esc(meta)}</span>` : ''}
                </button>`;
        }).join('');
        container.querySelectorAll<HTMLElement>('.source-picker-item[data-source-id]').forEach(btn => {
            btn.addEventListener('click', () => this.pickSource(btn.dataset.sourceId ?? ''));
        });
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

    pickSource(sourceId: string): void {
        const wasPartnership = !!this.citationContext && 'partnershipId' in this.citationContext;
        this.applyCitation(sourceId);
        this.closeSourcePicker();
        this.refreshCitationChips();
        if (wasPartnership) this.refreshRelationshipsPanel();
    },

    /** "New source…" in the picker: open the editor; on save it cites the result. */
    createSourceFromPicker(): void {
        this.citeSourceAfterCreate = true;
        // Hide the picker overlay so the editor is not covered (keep the context).
        document.getElementById('source-picker-modal')?.classList.remove('active');
        this.showAddSourceModal();
    },
});
