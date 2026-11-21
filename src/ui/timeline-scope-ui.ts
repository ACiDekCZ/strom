/**
 * The Timeline's scope (spec 098 §11a): the view's bar over the axis with
 * "Scope", the shared switch "This view / Selection ▾ / Whole tree"
 * (src/ui/scope-seg-ui.ts) and, quietly on the right, how many people the
 * rows show (and how many lack a birth year); on a phone (and held sideways)
 * one button "Scope: … ▾" with its sheet. With This view or the Whole tree
 * the window's selection is highlighted on the rows (the renderer passes
 * timelineHighlightIds to the chart).
 *
 * The rows' people come from src/view-scope.ts (scopeIdList); the renderer
 * draws them (renderTimeline in src/renderer.ts).
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { strings, getCurrentLanguage } from '../strings.js';
import type { PersonId } from '../types.js';
import { scopeIdList, type ViewScope } from '../view-scope.js';
import { uiModule } from './module.js';
import { registerScopeHost, type ScopeSegHost } from './scope-seg-ui.js';
import { selectionIds, type SelectionChange } from './view-selection-ui.js';

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The people laid out in the tree view now (the rows of This view). */
function viewIds(): ReadonlySet<PersonId> {
    return TreeRenderer.getVisiblePersonIds({ includeView: true });
}

export const timelineScopeMethods = uiModule({
    /** The Timeline's part of the scope's switch (src/ui/scope-seg-ui.ts). */
    timelineScopeHost(): ScopeSegHost {
        return {
            root: () => document.getElementById('timeline-toolbar'),
            // The container scrolls under its sticky bar: the choice opens in it (scope-seg-ui adds the scroll).
            popoverParent: () => document.getElementById('timeline-container'),
            apply: (scope, opts) => this.applyTimelineScope(scope, opts),
            viewCount: () => viewIds().size,
            selectionChanged: (change, before) => this.timelineSelectionChanged(change, before),
        };
    },

    /**
     * The view's bar in the Timeline's container, built once (and in a new
     * UI language anew); returns the element the chart is drawn into.
     */
    timelineChrome(container: HTMLElement): HTMLElement {
        let bar = container.querySelector<HTMLElement>(':scope > #timeline-toolbar');
        let body = container.querySelector<HTMLElement>(':scope > .tl-body');
        if (!bar || !body) {
            container.innerHTML = '';
            bar = document.createElement('div');
            bar.id = 'timeline-toolbar';
            bar.className = 'tl-toolbar';
            bar.innerHTML = `<span class="tl-toolbar-label">${esc(strings.scope.label)}</span>`
                + this.scopeSegHtml('timeline')
                + `<span class="tl-toolbar-note" aria-live="polite"></span>`;
            body = document.createElement('div');
            body.className = 'tl-body';
            container.append(bar, body);
            registerScopeHost('timeline', this.timelineScopeHost());
            this.bindScopeSeg('timeline', bar);
            bar.dataset.lang = getCurrentLanguage();
            this.watchTimelineToolbar(bar);
        } else if (bar.dataset.lang !== getCurrentLanguage()) {
            bar.dataset.lang = getCurrentLanguage();
            const label = bar.querySelector('.tl-toolbar-label');
            if (label) label.textContent = strings.scope.label;
            this.retranslateScopeSeg('timeline');
        }
        this.syncViewScopeTree('timeline');
        this.renderScopeSeg('timeline');
        return body;
    },

    /**
     * `--tl-toolbar-bottom` on the body: where the bar ends (what stands at
     * the top keeps below it); a followed research's card placed below it.
     */
    watchTimelineToolbar(bar: HTMLElement): void {
        const publish = (): void => {
            const r = bar.getBoundingClientRect();
            if (r.height <= 0) return;
            document.body.style.setProperty('--tl-toolbar-bottom', `${Math.round(r.bottom)}px`);
            this.placeLivePanel?.();
        };
        if (typeof ResizeObserver === 'function') new ResizeObserver(publish).observe(bar);
        window.addEventListener('resize', () => requestAnimationFrame(publish));
        requestAnimationFrame(publish);
    },

    /**
     * The people of the Timeline's rows in its scope now (the Whole tree:
     * every real person); `view`: This view's people when not the ones laid
     * out (an output leaves out the people seen only through a view link).
     */
    timelineScopePersons(view?: () => ReadonlySet<PersonId>): PersonId[] {
        this.syncViewScopeTree('timeline');
        return scopeIdList(this.timelineScope, view ?? viewIds, () => selectionIds(), DataManager.getData().persons);
    },

    /** The people the Timeline highlights (§11a, 11a·2): the selection's with This view or the Whole tree; else null. */
    timelineHighlightIds(): ReadonlySet<PersonId> | null {
        this.syncViewScopeTree('timeline');
        return this.scopeHighlight('timeline');
    },

    /**
     * The bar's quiet note: the rows shown ("13 people"; with the selection
     * highlighted, said so) and the people left out for want of a birth year.
     */
    renderTimelineNote(rows: number, omitted: number, highlighted: boolean): void {
        const note = document.querySelector<HTMLElement>('#timeline-toolbar .tl-toolbar-note');
        if (!note) return;
        const S = strings.timeline;
        const parts = [highlighted ? S.rowsHighlighted(rows) : S.rows(rows)];
        if (omitted > 0) parts.push(S.omitted(omitted));
        const text = parts.join(' · ');
        if (note.textContent !== text) note.textContent = text;
        note.title = text;
    },

    /** A scope chosen for the Timeline (setViewScope): remembered, the rows drawn anew from the top. */
    applyTimelineScope(scope: ViewScope, _opts: { keepView?: boolean }): Promise<void> {
        this.rememberViewScope('timeline', scope);
        this.closeScopePicker(false);
        this.renderScopeSeg('timeline');
        if (TreeRenderer.getViewMode() !== 'timeline') return Promise.resolve();
        const box = document.getElementById('timeline-container');
        if (box) box.scrollTop = 0;
        return TreeRenderer.renderAsync();
    },

    /**
     * The window's selection changed and the Timeline's scope followed it
     * (scopeSelectionChanged): the open Timeline draws its rows and the
     * highlight anew; the switch shows the selection now.
     */
    timelineSelectionChanged(_change: SelectionChange, _before: ViewScope): void {
        this.renderScopeSeg('timeline');
        if (TreeRenderer.getViewMode() !== 'timeline') return;
        TreeRenderer.render();
    },
});
