/**
 * Read-only looks at one person from the person menu: "Show sources" (every
 * source cited on the person, their events and marriages, plus a quick
 * "Cite a source") and "Show story" (the narrative set as prose). Both are
 * info dialogs built per open; editing stays in the person dialog.
 */

import { DataManager } from '../data.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { PersonId, Source } from '../types.js';
import { yearOf } from '../dates.js';
import { sortLifeEvents } from '../events.js';
import { storyProseHtml } from '../book.js';
import { uiModule } from './module.js';
import { normalizeModal } from './modal-skeleton.js';
import { eventTypeLabel } from './person-events.js';
import { CitationContext, sourceMeta, qualityLabel, sourceThumbHtml, hydrateThumbs } from './sources.js';

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
    return [p.firstName, p.lastName].filter(Boolean).join(' ') || '?';
}

/** "Jan Novák · 1865–1932" (the years only when known). */
function personSubtitle(personId: PersonId): string {
    const p = DataManager.getPerson(personId);
    const born = yearOf(p?.birthDate);
    const died = yearOf(p?.deathDate);
    const years = born !== null || died !== null ? `${born ?? ''}–${died ?? ''}` : '';
    return [fullName(personId), years].filter(Boolean).join(' · ');
}

/** One row of the sources dialog: a source and the citation it comes from. */
interface SourceRow {
    source: Source;
    ctx: CitationContext;
    /** What the citation supports, for event / marriage rows. */
    context?: string;
}

interface SourceGroups {
    person: SourceRow[];
    events: SourceRow[];
    unions: SourceRow[];
}

/** The person's citations grouped as the dialog shows them (each source once per group). */
function personSourceGroups(personId: PersonId): SourceGroups {
    const data = DataManager.getData();
    const catalog = data.sources ?? {};
    const person = data.persons[personId];
    const groups: SourceGroups = { person: [], events: [], unions: [] };
    if (!person) return groups;
    const add = (list: SourceRow[], ids: string[] | undefined, ctx: CitationContext, context?: string) => {
        for (const id of ids ?? []) {
            const source = catalog[id];
            if (!source || list.some(r => r.source.id === id)) continue;
            list.push({ source, ctx, context });
        }
    };
    add(groups.person, person.sourceIds, { personId });
    for (const ev of sortLifeEvents(person.events ?? [])) {
        const year = yearOf(ev.date);
        add(groups.events, ev.sourceIds, { personId, eventId: ev.id },
            [eventTypeLabel(ev), year !== null ? String(year) : ''].filter(Boolean).join(' · '));
    }
    for (const u of Object.values(data.partnerships)) {
        if (u.person1Id !== personId && u.person2Id !== personId) continue;
        add(groups.unions, u.sourceIds, { partnershipId: u.id },
            strings.sources.citedPartnership(fullName(u.person1Id), fullName(u.person2Id)));
    }
    return groups;
}

export const personSourcesMethods = uiModule({
    /** Distinct sources cited on the person, their events and their marriages. */
    personSourceCount(personId: PersonId): number {
        const g = personSourceGroups(personId);
        return new Set([...g.person, ...g.events, ...g.unions].map(r => r.source.id)).size;
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
                    <button type="button" class="secondary" id="person-sources-close" data-dismiss>${esc(strings.buttons.close)}</button>
                    <button type="button" class="primary" id="person-sources-cite">${esc(strings.sources.cite)}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const close = (): void => this.closePersonSourcesDialog();
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        (overlay.querySelector('#person-sources-close-x') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#person-sources-close') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#person-sources-cite') as HTMLButtonElement).onclick = () => this.showSourcePickerForPersonId(personId);
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
        const groups = personSourceGroups(personId);
        const total = this.personSourceCount(personId);

        const subtitle = document.getElementById('person-sources-subtitle');
        if (subtitle) subtitle.textContent = total > 0 ? `${personSubtitle(personId)} · ${total}` : personSubtitle(personId);
        const cite = document.getElementById('person-sources-cite');
        if (cite) cite.hidden = !this.canCiteOnPerson(personId);

        // Rows cited since the last draw get a short highlight.
        const before = this.personSourcesShown;
        const fresh = (id: string): boolean => before !== null && !before.has(id);
        this.personSourcesShown = new Set(groups.person.map(r => r.source.id));

        if (total === 0) {
            list.innerHTML = `<p class="person-sources-empty">${esc(s.empty)}</p>`;
            return;
        }
        const row = (r: SourceRow, i: number, key: string): string => {
            const meta = r.context ?? sourceMeta(r.source);
            const q = r.context ? '' : qualityLabel(r.source.quality);
            const cls = key === 'person' && fresh(r.source.id) ? 'person-source-row is-new' : 'person-source-row';
            return `
                <button type="button" class="${cls}" data-group="${key}" data-row="${i}">
                    ${sourceThumbHtml(r.source, 'picker')}
                    <span class="person-source-text">
                        <span class="person-source-title">${esc(r.source.title)}</span>
                        ${meta || q ? `<span class="person-source-meta">${esc(meta)}${q ? ` <span class="source-quality-tag">${esc(q)}</span>` : ''}</span>` : ''}
                    </span>
                </button>`;
        };
        const onlyPerson = groups.events.length === 0 && groups.unions.length === 0;
        const section = (key: keyof SourceGroups, title: string): string => {
            const rows = groups[key];
            if (rows.length === 0) return '';
            const head = key === 'person' && onlyPerson ? '' : `<div class="menu-section-header person-sources-group">${esc(title)}</div>`;
            return `${head}${rows.map((r, i) => row(r, i, key)).join('')}`;
        };
        list.innerHTML = section('person', s.groupPerson) + section('events', s.groupEvents) + section('unions', s.groupUnions);
        list.querySelectorAll<HTMLElement>('.person-source-row').forEach(btn => {
            btn.addEventListener('click', () => {
                const r = groups[btn.dataset.group as keyof SourceGroups]?.[Number(btn.dataset.row)];
                if (r) this.showSourceViewer(r.source.id, r.ctx);
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

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = STORY_ID;
        overlay.innerHTML = `
            <div class="modal modal--md story-reader" role="dialog" data-dialog-kind="info" aria-modal="true" aria-labelledby="person-story-heading">
                <div class="modal-header">
                    <div class="audit-log-heading">
                        <h2 id="person-story-heading">${esc(s.readerTitle)}</h2>
                        <div class="audit-log-subtitle">${esc(personSubtitle(personId))}${story.status === 'draft'
                            ? ` <span class="story-draft-tag">${esc(s.statusDraft)}</span>` : ''}</div>
                    </div>
                    <button type="button" class="close-btn" id="person-story-close-x" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                <div class="story-reader-body" id="person-story-body" tabindex="-1" lang="${getCurrentLanguage()}">
                    ${story.title ? `<h3 class="story-reader-title">${esc(story.title)}</h3>` : ''}
                    <div class="story-reader-text">${storyProseHtml(story.text)}</div>
                    ${facts.length > 0 || story.note ? `<div class="story-reader-extra">
                        ${facts.length > 0 ? `<div class="menu-section-header">${esc(s.facts)}</div>
                            <ul class="story-reader-facts">${facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
                        ${story.note ? `<p class="story-reader-note">${esc(story.note)}</p>` : ''}
                    </div>` : ''}
                </div>
                <div class="buttons">
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
