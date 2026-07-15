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
        if (sources.length === 0) {
            container.innerHTML = `<div class="sources-empty sources-empty-block"><div class="sources-empty-icon">📚</div>${esc(strings.sources.empty)}</div>`;
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
                        <button type="button" title="${esc(strings.sources.edit)}"
                            onclick="window.Strom.UI.showEditSourceModal('${esc(src.id)}')">&#9998;</button>
                        <button type="button" title="${esc(strings.sources.delete)}"
                            onclick="window.Strom.UI.deleteSource('${esc(src.id)}')">&#128465;</button>
                    </div>
                </div>`;
        }).join('');
    },

    async deleteSource(sourceId: string): Promise<void> {
        const count = DataManager.countSourceCitations(sourceId);
        const confirmed = await this.showConfirm(strings.sources.deleteConfirm(count), strings.sources.delete);
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
        document.getElementById('source-editor-modal')?.classList.add('active');
    },

    closeSourceEditor(): void {
        document.getElementById('source-editor-modal')?.classList.remove('active');
        this.editingSourceId = null;
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

        if (this.editingSourceId) {
            DataManager.updateSource(this.editingSourceId, payload);
        } else {
            const created = DataManager.addSource(payload);
            // Created from the picker → immediately cite it to the context.
            if (created && this.citeSourceAfterCreate) {
                this.applyCitation(created.id);
            }
        }

        const citeAfterCreate = this.citeSourceAfterCreate;
        // closeSourceEditor tears down the picker too when it was a create+cite.
        this.closeSourceEditor();
        if (!citeAfterCreate) this.renderSourcesList();
        this.refreshCitationChips();
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
                <button type="button" class="source-chip-remove" title="${esc(strings.sources.remove)}"
                    onclick="window.Strom.UI.${removeHandler}('${esc(id)}')">&times;</button>
            </span>`).join('');
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
                <button type="button" class="source-picker-item" onclick="window.Strom.UI.pickSource('${esc(s.id)}')">
                    <span class="source-title">${esc(s.title)}</span>
                    ${meta ? `<span class="source-meta"> — ${esc(meta)}</span>` : ''}
                </button>`;
        }).join('');
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
