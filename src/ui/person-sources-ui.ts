/**
 * Read-only looks at one person from the person menu: "Sources" (every
 * source cited on the person, their events and marriages, plus a quick
 * "Cite a source") and "Story" (the narrative set as prose). Both are
 * info dialogs built per open; editing stays in the person dialog.
 */

import { DataManager } from '../data.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { PersonId, Source } from '../types.js';
import { yearOf } from '../dates.js';
import { personSourceRows as personSourceRowsOf, PersonSourceRow } from '../person-sources.js';
import { storyProseHtml } from '../story-text.js';
import { uiModule } from './module.js';
import { normalizeModal } from './modal-skeleton.js';
import { storyWithDraft, draftDate } from './story-compare-ui.js';
import { CitationContext, qualityLabel, sourceThumbHtml, hydrateThumbs } from './sources.js';
import { shownName } from '../person-name.js';

const SOURCES_ID = 'person-sources-modal';
const STORY_ID = 'person-story-modal';

/** HTML-escape a user string for safe innerHTML insertion. */
function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fullName(personId: PersonId): string {
    const p = DataManager.getPerson(personId);
    if (!p) return '?';
    return shownName(p);
}

/** "Jan Novák · 1865–1932" (the years only when known). */
export function personSubtitle(personId: PersonId): string {
    const p = DataManager.getPerson(personId);
    const born = yearOf(p?.birthDate);
    const died = yearOf(p?.deathDate);
    const years = born !== null || died !== null ? `${born ?? ''}–${died ?? ''}` : '';
    return [fullName(personId), years].filter(Boolean).join(' · ');
}

/** The person's sources, one row per source (see src/person-sources.ts). */
function personSourceRows(personId: PersonId): PersonSourceRow[] {
    return personSourceRowsOf(DataManager.getData(), personId, strings);
}

export const personSourcesMethods = uiModule({
    /** Distinct sources cited on the person, their events and their marriages. */
    personSourceCount(personId: PersonId): number {
        return personSourceRows(personId).length;
    },

    /** Citing is possible: an editable tree and the person not locked. */
    canCiteOnPerson(personId: PersonId): boolean {
        return this.canEditSources() && !DataManager.isPersonLocked(personId);
    },

    // ==================== SOURCES ====================

    showPersonSourcesDialog(personId: PersonId): void {
        // Replace an open one; the stack entry (pushed by the caller) stays.
        document.getElementById(SOURCES_ID)?.remove();
        if (!DataManager.getPerson(personId)) return;
        this.personSourcesId = personId;
        this.personSourcesShown = null;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = SOURCES_ID;
        overlay.innerHTML = `
            <div class="modal modal--md person-sources-modal" role="dialog" data-dialog-kind="info" aria-modal="true" aria-labelledby="person-sources-title">
                <div class="modal-header">
                    <div class="audit-log-heading">
                        <h2 id="person-sources-title">${esc(strings.personSources.title)}</h2>
                        <div class="audit-log-subtitle" id="person-sources-subtitle"></div>
                    </div>
                    <button type="button" class="close-btn" id="person-sources-close-x" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                <div class="person-sources-list" id="person-sources-list"></div>
                <div class="buttons">
                    <button type="button" class="link-button" id="person-sources-find" hidden>${esc(strings.research.findSource)}</button>
                    <button type="button" class="secondary" id="person-sources-close" data-dismiss>${esc(strings.buttons.close)}</button>
                    <button type="button" class="primary" id="person-sources-cite">${esc(strings.sources.cite)}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const close = (): void => this.closePersonSourcesDialog();
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        (overlay.querySelector('#person-sources-close-x') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#person-sources-close') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#person-sources-cite') as HTMLButtonElement).onclick = () => this.showSourcePickerForPersonId(personId, true);
        // No source yet: the research can look for one (the dialog stays open).
        (overlay.querySelector('#person-sources-find') as HTMLButtonElement).onclick = () => {
            const url = this.personFindSourceUrl(personId);
            if (url) this.launchResearchLink(url);
        };
        this.renderPersonSourcesDialog();
        // Reading, not typing: focus the dialog itself, not the first control.
        const box = overlay.querySelector('.modal') as HTMLElement;
        box.setAttribute('tabindex', '-1');
        box.focus({ preventScroll: true });
    },

    closePersonSourcesDialog(): void {
        document.getElementById(SOURCES_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== SOURCES_ID);
        this.personSourcesId = null;
        this.personSourcesShown = null;
    },

    /** (Re)draw the list — also after a citation made from the dialog. */
    renderPersonSourcesDialog(): void {
        const personId = this.personSourcesId;
        const list = document.getElementById('person-sources-list');
        if (!personId || !list) return;
        const s = strings.personSources;
        const rows = personSourceRows(personId);

        const subtitle = document.getElementById('person-sources-subtitle');
        if (subtitle) {
            subtitle.textContent = [personSubtitle(personId), rows.length > 0 ? s.countSub(rows.length) : '']
                .filter(Boolean).join(' · ');
        }
        const cite = document.getElementById('person-sources-cite');
        if (cite) cite.hidden = !this.canCiteOnPerson(personId);
        const find = document.getElementById('person-sources-find');
        if (find) find.hidden = rows.length > 0 || !this.personFindSourceUrl(personId);

        // Rows new or with a new label since the last draw get a short highlight.
        const before = this.personSourcesShown;
        const key = (r: PersonSourceRow): string => `${r.source.id}\u0000${r.cites.map(c => c.label).join('\u0000')}`;
        this.personSourcesShown = new Set(rows.map(key));

        if (rows.length === 0) {
            list.innerHTML = `<p class="person-sources-empty">${esc(s.empty)}</p>`;
            return;
        }
        // An archive has no reading results to give: no link to one.
        const readings = !this.activeResearchAgentless();
        list.innerHTML = rows.map((r, i) => {
            const q = qualityLabel(r.source.quality);
            const labels = r.cites.map(c => c.title
                ? `<span title="${esc(c.title)}">${esc(c.label)}</span>` : esc(c.label)).join(' · ');
            const cls = before !== null && !before.has(key(r)) ? 'person-source-row is-new' : 'person-source-row';
            const row = `
                <button type="button" class="${cls}" data-row="${i}">
                    ${sourceThumbHtml(r.source, 'picker')}
                    <span class="person-source-text">
                        <span class="person-source-title">${esc(r.source.title)}</span>
                        <span class="person-source-meta">${labels}${q ? ` <span class="source-quality-tag">${esc(q)}</span>` : ''}</span>
                    </span>
                </button>`;
            // A source written from a reading: its whole result beside the row (a button cannot hold another).
            return r.source.reading && readings
                ? `<div class="person-source-item">${row}<button type="button" class="link-button person-source-reading" data-reading="${i}">${esc(strings.read.sourceLink)}</button></div>`
                : row;
        }).join('');
        list.querySelectorAll<HTMLElement>('.person-source-row').forEach(btn => {
            btn.addEventListener('click', () => {
                const r = rows[Number(btn.dataset.row)];
                if (r) this.showSourceViewer(r.source.id, r.cites[0].ctx);
            });
        });
        list.querySelectorAll<HTMLElement>('.person-source-reading').forEach(btn => {
            btn.addEventListener('click', () => {
                const r = rows[Number(btn.dataset.reading)];
                if (r) this.showReadingOfSource(r.source.id);
            });
        });
        hydrateThumbs(list);
    },

    // ==================== STORY ====================

    showPersonStoryDialog(personId: PersonId): void {
        document.getElementById(STORY_ID)?.remove();
        const person = DataManager.getPerson(personId);
        const story = person?.story;
        if (!person || !story?.text?.trim()) return;
        const s = strings.story;
        const editable = !DataManager.isReadOnly() && !DataManager.isPersonLocked(personId);
        const facts = (story.facts ?? []).filter(f => f.trim());
        // A research draft can be approved there (the label changes with the next version).
        const approveUrl = this.storyApproveUrl(personId);
        // An approved story with a new version waiting: say so and offer the comparison.
        const waiting = storyWithDraft({ personId });

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = STORY_ID;
        overlay.innerHTML = `
            <div class="modal modal--md story-reader" role="dialog" data-dialog-kind="info" aria-modal="true" aria-labelledby="person-story-heading">
                <div class="modal-header">
                    <div class="audit-log-heading">
                        <h2 id="person-story-heading">${esc(s.readerTitle)}</h2>
                        <div class="audit-log-subtitle">${esc(personSubtitle(personId))}${waiting
                            ? ` <span class="story-nv-tag">${esc(s.nvBadge)}</span>`
                            : story.status === 'draft' ? ` <span class="story-draft-tag">${esc(s.statusDraft)}</span>` : ''}</div>
                    </div>
                    <button type="button" class="close-btn" id="person-story-close-x" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                <div class="story-reader-body" id="person-story-body" tabindex="-1" lang="${getCurrentLanguage()}">
                    ${waiting ? `<div class="story-nv-banner"><span>${esc(s.nvReader(draftDate(waiting)))}</span><button type="button" class="story-nv-compare" id="person-story-compare">${esc(s.compare)}</button></div>` : ''}
                    ${story.title ? `<h3 class="story-reader-title">${esc(story.title)}</h3>` : ''}
                    <div class="story-reader-text">${storyProseHtml(story.text, { title: story.title })}</div>
                    ${facts.length > 0 || story.note ? `<div class="story-reader-extra">
                        ${facts.length > 0 ? `<div class="menu-section-header">${esc(s.facts)}</div>
                            <ul class="story-reader-facts">${facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
                        ${story.note ? `<p class="story-reader-note">${esc(story.note)}</p>` : ''}
                    </div>` : ''}
                </div>
                <div class="buttons">
                    ${approveUrl ? `<button type="button" class="link-button story-approve" id="person-story-approve">${esc(strings.research.approveStory)}</button>` : ''}
                    <button type="button" class="secondary" id="person-story-close" data-dismiss>${esc(strings.buttons.close)}</button>
                    ${editable ? `<button type="button" class="primary" id="person-story-edit">${esc(s.edit)}</button>` : ''}
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const close = (): void => this.closePersonStoryDialog();
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        (overlay.querySelector('#person-story-close-x') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#person-story-close') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#person-story-edit') as HTMLButtonElement | null)?.addEventListener('click', () => this.editPersonStory(personId));
        (overlay.querySelector('#person-story-compare') as HTMLButtonElement | null)?.addEventListener('click', () => this.showStoryCompare({ personId }));
        (overlay.querySelector('#person-story-approve') as HTMLButtonElement | null)?.addEventListener('click', () => {
            if (approveUrl) this.launchResearchLink(approveUrl);
        });
        // Focus the text body (not a control), so arrows / PgDn scroll it —
        // after the skeleton has wrapped the body (moving a node drops focus).
        normalizeModal(overlay.querySelector('.modal') as HTMLElement);
        (overlay.querySelector('#person-story-body') as HTMLElement).focus({ preventScroll: true });
    },

    closePersonStoryDialog(): void {
        document.getElementById(STORY_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== STORY_ID);
    },

    /** "Edit" in the reader: the person dialog, scrolled to the story, cursor in the text. */
    editPersonStory(personId: PersonId): void {
        this.closePersonStoryDialog();
        this.clearDialogStack();
        this.pushDialog('person-modal');
        this.showEditPersonModal(personId);
        const section = document.getElementById('pm-story-section');
        const scroller = section?.closest('.modal-content') as HTMLElement | null;
        if (section && scroller) {
            const top = section.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
            scroller.scrollTop = Math.max(0, top - 12);
        }
        (document.getElementById('input-story') as HTMLTextAreaElement | null)?.focus({ preventScroll: true });
    },
});
