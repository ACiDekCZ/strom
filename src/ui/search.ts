/**
 * search UI methods. Extracted from the original UIClass;
 * see src/ui/module.ts for the composition pattern.
 */

import { DataManager, auditPersonName } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { TreePreview, TreeCompare } from '../tree-preview.js';
import {
    Person,
    PersonId,
    PartnershipId,
    PartnershipStatus,
    Gender,
    RelationType,
    RelationContext,
    StromData,
    TreeId,
    LAST_FOCUSED,
    LastFocusedMarker
} from '../types.js';
import { strings } from '../strings.js';
import { parseGedcom, convertToStrom, GedcomConversionResult } from '../ged-parser.js';
import {
    validateJsonImport,
    ValidationResult,
    MergerUI,
    getCurrentMergeInfo,
    listMergeSessionsInfo,
    deleteMergeSession,
    renameMergeSession
} from '../merge/index.js';
import { PersonPicker } from '../person-picker.js';
import { AppExporter } from '../export.js';
import { SettingsManager } from '../settings.js';
import { filterPersons, hasSearchCriteria, SearchCriteria } from '../search-filter.js';
import { ThemeMode, LanguageSetting, AppMode, AuditLog } from '../types.js';
import { CryptoSession, isEncrypted, encrypt, decrypt, EncryptedData } from '../crypto.js';
import { validateTreeData, ValidationResult as TreeValidationResult, ValidationIssue } from '../validation.js';
import * as CrossTree from '../cross-tree.js';
import { AuditLogManager } from '../audit-log.js';
import { uiModule } from './module.js';
import { isPhoneBar } from '../breakpoints.js';
import { shownName } from '../person-name.js';

/** The phone top bar (≤640px, or a phone sideways): the search folds to a magnifier there. */
export function isPhoneToolbar(): boolean {
    return isPhoneBar();
}

/** Filters set in the filter panel (the years count as one). */
function activeFilterCount(c: SearchCriteria): number {
    return [c.lastName, c.place, c.birthFrom ?? c.birthTo, c.gender, c.living].filter(v => v !== undefined && v !== '').length;
}

export const searchMethods = uiModule({
    initSearch(): void {
        const container = document.getElementById('toolbar-search-picker');
        if (!container) return;

        // Destroy existing picker if any
        if (this.toolbarSearchPicker) {
            this.toolbarSearchPicker.destroy();
        }

        this.toolbarSearchPicker = new PersonPicker({
            containerId: 'toolbar-search-picker',
            openOnFocus: true,
            onSelect: (personId) => {
                TreeRenderer.setFocus(personId);
                ZoomPan.centerOnPerson(personId);
                ZoomPan.highlightPerson(personId);
                // Clear picker after selection. clear() empties the input
                // programmatically — no 'input' event fires — so the live
                // match-dimming must be dropped here, or it sticks around
                // with a visibly empty search box.
                this.toolbarSearchPicker?.clear();
                if (this.searchFilterTimer) clearTimeout(this.searchFilterTimer);
                this.applySearchFilter();
            },
            placeholder: strings.search.placeholder,
            filter: (p) => !p.isPlaceholder,
            searchDetails: true,
        });

        // Live-highlight matches in the tree as the name query changes.
        const input = container.querySelector('.person-picker-input') as HTMLInputElement | null;
        if (input) {
            input.addEventListener('input', () => this.scheduleSearchFilter());
            // Phone: the focused field takes the whole bar (with Cancel); a
            // blur folds it back unless a query or a filter holds.
            input.addEventListener('focus', () => {
                if (isPhoneToolbar()) document.body.classList.add('search-open');
            });
            input.addEventListener('blur', () => {
                setTimeout(() => this.settleSearchAfterBlur(), 150);
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && isPhoneToolbar() && document.body.classList.contains('search-open')) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.cancelSearch();
                }
            });
        }
    },

    /** Phone: the magnifier opens the field over the whole bar, keyboard up. */
    openSearch(): void {
        document.body.classList.add('search-open');
        const input = document.querySelector<HTMLInputElement>('#toolbar-search-picker .person-picker-input');
        input?.focus();
    },

    /** Phone "Cancel" (and Esc / Back): the query AND the filters go, the bar is at rest. */
    cancelSearch(): void {
        if (document.getElementById('search-filters')?.style.display !== 'none') this.toggleSearchFilters();
        this.clearSearchFilters();
        document.querySelector<HTMLInputElement>('#toolbar-search-picker .person-picker-input')?.blur();
        document.body.classList.remove('search-open');
        this.syncSearchState();
    },

    /** × in the field: the text only; the filters stay. */
    clearSearchText(): void {
        this.toolbarSearchPicker?.clear();
        if (this.searchFilterTimer) clearTimeout(this.searchFilterTimer);
        this.applySearchFilter();
    },

    /**
     * After the field lost focus: still inside the search (the funnel, the
     * filter sheet, Cancel) keeps it open; otherwise it folds to the
     * magnifier, or stays as the active field while a query or a filter holds.
     */
    settleSearchAfterBlur(): void {
        const active = document.activeElement;
        const filtersOpen = document.getElementById('search-filters')?.style.display !== 'none';
        if (!filtersOpen && !(active instanceof Element && active.closest('.search-container, .search-cancel-btn'))) {
            document.body.classList.remove('search-open');
        }
        this.syncSearchState();
    },

    /** body.search-active: a query or a filter holds (the phone keeps the field then). */
    syncSearchState(): void {
        document.body.classList.toggle('search-active', hasSearchCriteria(this.readSearchCriteria()));
    },

    /**
     * Refresh toolbar search picker (e.g., after data import)
     */
    refreshSearch(): void {
        // Keep the typed query across a refresh (save, undo, import) and
        // re-apply the highlight for the new data, so the search box and the
        // dimmed cards never disagree. A different tree starts clean: the
        // old query/filters (and their person ids) mean nothing there.
        const treeId = DataManager.getCurrentTreeId();
        const sameTree = this.searchTreeId === null || this.searchTreeId === treeId;
        this.searchTreeId = treeId;
        const oldInput = document.querySelector('#toolbar-search-picker .person-picker-input') as HTMLInputElement | null;
        const query = sameTree ? (oldInput?.value ?? '') : '';
        this.initSearch();
        if (this.searchFilterTimer) clearTimeout(this.searchFilterTimer);
        if (!sameTree) {
            this.clearSearchFilters();
            return;
        }
        const newInput = document.querySelector('#toolbar-search-picker .person-picker-input') as HTMLInputElement | null;
        if (newInput && query) newInput.value = query;
        this.applySearchFilter();
    },

    // ==================== SEARCH FILTERS + HIGHLIGHT ====================

    toggleSearchFilters(): void {
        const panel = document.getElementById('search-filters');
        const toggle = document.getElementById('search-filter-toggle');
        if (!panel) return;
        const show = panel.style.display === 'none';
        panel.style.display = show ? '' : 'none';
        toggle?.classList.toggle('active', show);
        // Phone: the panel is a sheet from below (CSS) over a backdrop.
        document.body.classList.toggle('search-filters-open', show);
        if (show) {
            this.applySearchFilter();
            this.followKeyboardWithFilters(panel);
        } else {
            panel.style.bottom = '';
            // Closed ("Show n", ×): the keyboard goes; the field stays only while the search holds.
            const focused = document.activeElement;
            if (focused instanceof HTMLElement && panel.contains(focused)) focused.blur();
            this.settleSearchAfterBlur();
        }
    },

    /** Phone: the filter sheet's foot stays above the on-screen keyboard. */
    followKeyboardWithFilters(panel: HTMLElement): void {
        const vv = window.visualViewport;
        if (!vv || panel.dataset.keyboardWired) return;
        panel.dataset.keyboardWired = '1';
        const place = () => {
            if (panel.style.display === 'none' || !isPhoneToolbar()) { panel.style.bottom = ''; return; }
            const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
            panel.style.bottom = covered ? `${covered}px` : '';
        };
        vv.addEventListener('resize', place);
        vv.addEventListener('scroll', place);
    },

    /** The filter sheet's "Clear filters": the fields only, the query stays. */
    clearFilterFields(): void {
        for (const id of ['filter-lastname', 'filter-place', 'filter-year-from', 'filter-year-to', 'filter-gender', 'filter-living']) {
            const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
            if (el) el.value = '';
        }
        if (this.searchFilterTimer) clearTimeout(this.searchFilterTimer);
        this.applySearchFilter();
    },

    /** Debounced (150 ms) re-application of the search filter + highlight. */
    scheduleSearchFilter(): void {
        if (this.searchFilterTimer) clearTimeout(this.searchFilterTimer);
        this.searchFilterTimer = setTimeout(() => this.applySearchFilter(), 150);
    },

    /** Read the current criteria from the search box + filter fields. */
    readSearchCriteria(): SearchCriteria {
        const val = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value.trim() ?? '';
        const num = (id: string) => { const v = val(id); return v ? parseInt(v, 10) : undefined; };
        const query = (document.querySelector('#toolbar-search-picker .person-picker-input') as HTMLInputElement | null)?.value.trim() ?? '';
        const living = val('filter-living');
        return {
            query: query || undefined,
            lastName: val('filter-lastname') || undefined,
            place: val('filter-place') || undefined,
            birthFrom: num('filter-year-from'),
            birthTo: num('filter-year-to'),
            gender: (val('filter-gender') || undefined) as SearchCriteria['gender'],
            living: (living || undefined) as SearchCriteria['living'],
        };
    },

    applySearchFilter(): void {
        const criteria = this.readSearchCriteria();
        const countEl = document.getElementById('search-result-count');
        if (!hasSearchCriteria(criteria)) {
            TreeRenderer.setHighlight(null);
            if (countEl) countEl.textContent = '';
            const all = Object.values(DataManager.getData().persons).filter(p => !p.isPlaceholder).length;
            this.renderSearchSummary(null, criteria, all);
            return;
        }
        const ids = filterPersons(DataManager.getData(), criteria);
        TreeRenderer.setHighlight(new Set(ids));
        if (countEl) countEl.textContent = strings.searchFilters.resultCount(ids.length);
        this.renderSearchSummary(ids.length, criteria, ids.length);
    },

    /**
     * The phone's search summary: the count after the query (null = none),
     * the funnel's badge of active filters, the filter sheet's "Show n"
     * (disabled at none) — and body.search-active.
     */
    renderSearchSummary(count: number | null, criteria: SearchCriteria, shown: number): void {
        const queryCount = document.getElementById('search-query-count');
        if (queryCount) queryCount.textContent = count === null ? '' : strings.search.resultCount(count);
        const filters = activeFilterCount(criteria);
        const badge = document.getElementById('search-filter-badge');
        if (badge) {
            badge.hidden = filters === 0;
            badge.textContent = filters ? String(filters) : '';
            if (filters) badge.setAttribute('aria-label', strings.searchFilters.activeCount(filters));
            else badge.removeAttribute('aria-label');
        }
        const show = document.getElementById('search-filters-show') as HTMLButtonElement | null;
        if (show) {
            show.textContent = shown ? strings.searchFilters.show(shown) : strings.searchFilters.none;
            show.disabled = shown === 0;
        }
        document.body.classList.toggle('search-active', hasSearchCriteria(criteria));
    },

    clearSearchFilters(): void {
        for (const id of ['filter-lastname', 'filter-place', 'filter-year-from', 'filter-year-to', 'filter-gender', 'filter-living']) {
            const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
            if (el) el.value = '';
        }
        this.toolbarSearchPicker?.clear();
        TreeRenderer.setHighlight(null);
        const countEl = document.getElementById('search-result-count');
        if (countEl) countEl.textContent = '';
        this.applySearchFilter();
    },

    /**
     * Handle search results from URL parameter
     */
    handleSearchResults(results: import('../types.js').Person[], query: string): void {
        if (results.length === 0) {
            // No results - show info
            this.showAlert(`${strings.search.noResults}: "${query}"`, 'info');
        } else if (results.length === 1) {
            // Single result - auto focus and center
            TreeRenderer.setFocus(results[0].id);
            // Need to wait for render to complete before centering
            setTimeout(() => {
                ZoomPan.centerOnPerson(results[0].id);
                ZoomPan.highlightPerson(results[0].id);
            }, 100);
        } else {
            // Multiple results - show selection modal
            this.showSearchResultsModal(results, query);
        }
    },

    showSearchResultsModal(results: import('../types.js').Person[], _query: string): void {
        // Use confirmation modal for search results
        // Fresh Cancel / OK pair — not whatever the last confirm left there.
        this.resetConfirmButtons();
        const modal = document.getElementById('confirmation-modal');
        const title = document.getElementById('confirm-title');
        const message = document.getElementById('confirm-message');
        const options = document.getElementById('confirm-options');
        const confirmBtn = document.getElementById('confirm-ok-btn');
        const cancelBtn = document.getElementById('confirm-cancel-btn');

        if (!modal || !title || !message || !options || !confirmBtn) return;

        title.textContent = strings.search.multipleResults;
        message.textContent = strings.search.selectPerson;

        // Build options from results
        options.innerHTML = '';
        for (const person of results.slice(0, 10)) {  // Max 10 in modal
            const birthYear = person.birthDate?.split('-')[0] || '';
            const opt = document.createElement('div');
            opt.className = 'confirm-option';
            opt.innerHTML = `
                <input type="radio" name="search-result" value="${this.escapeHtml(person.id)}">
                <span>${this.escapeHtml(shownName(person, ''))} ${birthYear ? `(${this.escapeHtml(birthYear)})` : ''}</span>
            `;
            opt.onclick = () => {
                options.querySelectorAll('.confirm-option').forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
                (opt.querySelector('input') as HTMLInputElement).checked = true;
            };
            options.appendChild(opt);
        }

        const close = () => {
            modal.classList.remove('active');
        };

        // Setup cancel button
        if (cancelBtn) {
            cancelBtn.onclick = close;
        }

        // Setup confirm button
        confirmBtn.onclick = () => {
            const selected = options.querySelector('input:checked') as HTMLInputElement;
            if (selected) {
                const personId = selected.value as PersonId;
                TreeRenderer.setFocus(personId);
                setTimeout(() => {
                    ZoomPan.centerOnPerson(personId);
                    ZoomPan.highlightPerson(personId);
                }, 100);
            }
            close();
        };

        // Close on overlay click
        modal.onclick = (e) => {
            if (e.target === modal) close();
        };

        modal.classList.add('active');
    },

    escapeHtml(text: string): string {
        // Must also escape quotes: callers interpolate into HTML attributes.
        return (text || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
});
