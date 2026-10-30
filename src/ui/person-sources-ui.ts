/**
 * Read-only looks at one person from the person menu: "Sources" (every
 * source cited on the person, their events and marriages, plus a quick
 * "Cite a source") and "Story" (the narrative set as prose). Both are
 * info dialogs built per open; editing stays in the person dialog.
 */

import { researchOpenLabel } from './research-open-mark.js';
import { DataManager } from '../data.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { PartnershipId, PersonId, Source, Story } from '../types.js';
import { yearOf } from '../dates.js';
import { personSourceRows as personSourceRowsOf, PersonSourceRow } from '../person-sources.js';
import { storyProseHtml, coupleStories, coupleStoryYears, coupleChipNames } from '../story-text.js';
import { personInitials } from '../initials.js';
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

/**
 * The story reader's chapter chips (spec 027 §5.3): a click scrolls the body
 * to the chapter; the chip of the chapter being read is marked as it scrolls.
 */
function wireStoryChips(overlay: HTMLElement): void {
    const chips = [...overlay.querySelectorAll<HTMLButtonElement>('.story-chip')];
    const scroller = overlay.querySelector<HTMLElement>('.modal-content') ?? overlay.querySelector<HTMLElement>('#person-story-body');
    const mark = (id: string): void => {
        for (const chip of chips) {
            if (chip.dataset.chapter === id) {
                chip.setAttribute('aria-current', 'true');
                chip.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
            } else chip.removeAttribute('aria-current');
        }
    };
    // A row that scrolls sideways (a phone) fades at the edge where chips are cut off.
    const row = overlay.querySelector<HTMLElement>('.story-chips');
    const edges = (): void => {
        if (!row) return;
        const max = row.scrollWidth - row.clientWidth;
        row.classList.toggle('story-chips--more-end', max > 1 && row.scrollLeft < max - 1);
        row.classList.toggle('story-chips--more-start', max > 1 && row.scrollLeft > 1);
    };
    if (row) {
        row.addEventListener('scroll', edges, { passive: true });
        if (typeof ResizeObserver !== 'undefined') new ResizeObserver(edges).observe(row);
        edges();
    }
    for (const chip of chips) {
        chip.addEventListener('click', () => {
            const target = overlay.querySelector<HTMLElement>(`#${chip.dataset.chapter}`);
            if (!target) return;
            const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            target.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
            mark(chip.dataset.chapter!);
        });
    }
    if (typeof IntersectionObserver === 'undefined' || !scroller) return;
    // The topmost chapter crossing the upper part of the body is the one being read.
    const visible = new Set<string>();
    const order = chips.map(c => c.dataset.chapter!);
    const io = new IntersectionObserver(entries => {
        for (const e of entries) {
            if (e.isIntersecting) visible.add(e.target.id); else visible.delete(e.target.id);
        }
        const first = order.find(id => visible.has(id));
        if (first) mark(first);
    }, { root: scroller, rootMargin: '0px 0px -60% 0px' });
    for (const id of order) {
        const el = overlay.querySelector(`#${id}`);
        if (el) io.observe(el);
    }
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
                    <button type="button" class="link-button" id="person-sources-find" hidden>${researchOpenLabel(strings.research.findSource)}</button>
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
        if (!person) return;
        const own = person.story?.text?.trim() ? person.story : undefined;
        // The stories of the person's marriages, each under the person's own (as on the person page).
        const couples = coupleStories(DataManager.getData(), person);
        if (!own && !couples.length) return;
        const s = strings.story;
        const P = strings.personPage.story;
        const locked = DataManager.isReadOnly() || DataManager.isPersonLocked(personId);
        const editable = !!own && !locked;
        // A couple's story is edited in the research: said only in a tree linked to one.
        const inResearch = !locked && this.activeResearchId() !== null;
        // From two chapters: chips to move between them, the couples' chapters on a tinted surface.
        const many = (own ? 1 : 0) + couples.length >= 2;
        // A research draft can be approved there (the label changes with the next version).
        const approveUrl = own ? this.storyApproveUrl(personId) : null;
        // An approved story with a new version waiting: say so and offer the comparison.
        const waiting = own ? storyWithDraft({ personId }) : null;
        const nvBanner = (story: Story, attrs: string): string =>
            `<div class="story-nv-banner"><span>${esc(s.nvReader(draftDate(story)))}</span><button type="button" class="story-nv-compare" ${attrs}>${esc(s.compare)}</button></div>`;
        const extraHtml = (story: Story): string => {
            const facts = (story.facts ?? []).filter(f => f.trim());
            if (!facts.length && !story.note) return '';
            return `<div class="story-reader-extra">
                ${facts.length > 0 ? `<div class="menu-section-header">${esc(s.facts)}</div>
                    <ul class="story-reader-facts">${facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
                ${story.note ? `<p class="story-reader-note">${esc(story.note)}</p>` : ''}
            </div>`;
        };
        const stateTag = (story: Story, nv: boolean): string => nv
            ? ` <span class="story-nv-tag">${esc(s.nvBadge)}</span>`
            : story.status === 'draft' ? ` <span class="story-draft-tag">${esc(s.statusDraft)}</span>` : '';
        const approveBtn = (attrs: string): string =>
            `<button type="button" class="secondary story-approve" ${attrs}>${researchOpenLabel(strings.research.approveStory)}</button>`;
        const self = shownName(person);
        const chips: { id: string; label: string }[] = [];

        let ownHtml = '';
        if (own) {
            chips.push({ id: 'person-story-ch-own', label: self });
            // The heading: the story's title (the person's name when chapters follow).
            const title = own.title?.trim() || (many ? self : '');
            const tag = stateTag(own, !!waiting);
            const actions = (editable ? `<button type="button" class="secondary" id="person-story-edit">${esc(s.edit)}</button>` : '')
                + (approveUrl ? approveBtn('id="person-story-approve"') : '');
            const headText = title ? `<h3 class="story-reader-title">${esc(title)}${tag}</h3>`
                : tag ? `<p class="story-ch-tags">${tag.trim()}</p>` : '';
            ownHtml = `<section class="story-reader-own story-reader-ch" id="person-story-ch-own">
                    ${headText || actions ? `<div class="story-ch-head"><div class="story-ch-headtext">${headText}</div>${actions ? `<div class="story-ch-actions">${actions}</div>` : ''}</div>` : ''}
                    ${waiting ? nvBanner(waiting, 'id="person-story-compare"') : ''}
                    <div class="story-reader-text">${storyProseHtml(own.text, { title: own.title })}</div>
                    ${extraHtml(own)}
                </section>`;
        }

        const couplesHtml = couples.map(u => {
            const st = u.story!;
            const partner = DataManager.getPerson(u.person1Id === personId ? u.person2Id : u.person1Id);
            const real = partner && !partner.isPlaceholder ? partner : undefined;
            const pair = real ? s.couple(self, shownName(real)) : self;
            const label = st.title?.trim() || pair;
            const nv = storyWithDraft({ partnershipId: u.id });
            const chId = `person-story-ch-${u.id.replace(/[^\w-]/g, '_')}`;
            const year = yearOf(u.startDate);
            // "Jan a Rozálie · 1883": both first names in the nominative; the full names when the first names match.
            const [chipA, chipB] = coupleChipNames(person, real, shownName);
            chips.push({ id: chId, label: P.chip(chipA, chipB, year !== null ? String(year) : '') });
            // Approving a couple's draft in the research (spec 027 §5.3): the research finds the family by both partners.
            const coupleApprove = this.coupleStoryApproveUrl(u.id);
            const mono = many ? `<span class="story-ch-mono" aria-hidden="true"><span>${esc(personInitials(person.firstName, person.lastName) || '?')}</span>`
                + (real ? `<span>${esc(personInitials(real.firstName, real.lastName) || '?')}</span>` : '') + `</span>` : '';
            return `<section class="story-reader-couple story-reader-ch${many ? ' story-reader-ch--tint' : ''}" id="${chId}" data-partnership-id="${esc(u.id)}">
                    <div class="story-ch-head">
                        ${mono}
                        <div class="story-ch-headtext">
                            <p class="story-ch-kicker">${esc(P.couple(coupleStoryYears(DataManager.getData(), u, P.until)))}</p>
                            <h3 class="story-reader-title story-reader-couple-title">${esc(label)}${stateTag(st, !!nv)}</h3>
                            ${st.title?.trim() ? `<p class="story-ch-pair">${esc(pair)}</p>` : ''}
                            ${inResearch ? `<p class="story-ch-note">${esc(P.editInResearch)}</p>` : ''}
                        </div>
                        ${coupleApprove ? `<div class="story-ch-actions">${approveBtn(`data-approve-partnership="${esc(u.id)}"`)}</div>` : ''}
                    </div>
                    ${nv ? nvBanner(nv, `data-partnership-id="${esc(u.id)}"`) : ''}
                    <div class="story-reader-text">${storyProseHtml(st.text, { title: st.title })}</div>
                    ${extraHtml(st)}
                </section>`;
        }).join('');

        const chipsHtml = many ? `<nav class="story-chips" aria-label="${esc(P.chipsLabel)}">${chips.map((ch, i) =>
            `<button type="button" class="story-chip" data-chapter="${ch.id}"${i === 0 ? ' aria-current="true"' : ''}>${esc(ch.label)}</button>`).join('')}</nav>` : '';

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = STORY_ID;
        overlay.innerHTML = `
            <div class="modal modal--md story-reader${many ? ' story-reader--chapters' : ''}" role="dialog" data-dialog-kind="info" aria-modal="true" aria-labelledby="person-story-heading">
                <div class="modal-header">
                    <div class="audit-log-heading">
                        <h2 id="person-story-heading">${esc(own ? s.readerTitle : P.titleCouple)}</h2>
                        <div class="audit-log-subtitle">${esc(personSubtitle(personId))}</div>
                        ${chipsHtml}
                    </div>
                    <button type="button" class="close-btn" id="person-story-close-x" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                <div class="story-reader-body" id="person-story-body" tabindex="-1" lang="${getCurrentLanguage()}">
                    ${ownHtml}
                    ${couplesHtml}
                </div>
                <div class="buttons">
                    <button type="button" class="secondary" id="person-story-close" data-dismiss>${esc(strings.buttons.close)}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const close = (): void => this.closePersonStoryDialog();
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        (overlay.querySelector('#person-story-close-x') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#person-story-close') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#person-story-edit') as HTMLButtonElement | null)?.addEventListener('click', () => this.editPersonStory(personId));
        (overlay.querySelector('#person-story-compare') as HTMLButtonElement | null)?.addEventListener('click', () => this.showStoryCompare({ personId }));
        overlay.querySelectorAll<HTMLButtonElement>('.story-reader-couple .story-nv-compare').forEach(btn => {
            btn.addEventListener('click', () => this.showStoryCompare({ partnershipId: btn.dataset.partnershipId as PartnershipId }));
        });
        (overlay.querySelector('#person-story-approve') as HTMLButtonElement | null)?.addEventListener('click', () => {
            if (approveUrl) this.launchResearchLink(approveUrl);
        });
        overlay.querySelectorAll<HTMLButtonElement>('[data-approve-partnership]').forEach(btn => {
            btn.addEventListener('click', () => {
                const url = this.coupleStoryApproveUrl(btn.dataset.approvePartnership as PartnershipId);
                if (url) this.launchResearchLink(url);
            });
        });
        // Focus the text body (not a control), so arrows / PgDn scroll it —
        // after the skeleton has wrapped the body (moving a node drops focus).
        normalizeModal(overlay.querySelector('.modal') as HTMLElement);
        if (many) wireStoryChips(overlay);
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
