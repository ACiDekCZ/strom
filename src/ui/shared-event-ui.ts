/**
 * The event editor's "Shared with" section (spec 085 §1, §3): the persons a
 * person's event is shared with, each with a role and an age; the banner
 * "Shared by N people"; the person picker (family first, then the whole
 * tree, a new person last); the type list locked to shareable types while
 * others share the event; the footer's Delete ▾ for a shared event; and the
 * save as one undo step whose Undo pill names what happened.
 *
 * The draft logic is pure (src/shared-event-editor.ts); every write goes
 * through DataManager's shared-event methods (src/data.ts), so a satellite
 * window sends them to the main window like any other edit (spec 079).
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { LifeEvent, LifeEventType, PersonId, Person, Gender } from '../types.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { SELECTABLE_EVENT_TYPES, eventIsShareable } from '../events.js';
import { formatFlexDate, normalizeDateInput, yearOf, formatDateForInput } from '../dates.js';
import { sharedEventMarkSvg } from '../icons.js';
import { shownName } from '../person-name.js';
import { findRelationship } from '../kinship.js';
import { filterAndSort } from '../person-picker.js';
import {
    sharedWith, shareDivergence, ownSameEvent, SameEventFields, SharedEventCommon, SharedEventCommonField, SharedEventOwn,
} from '../shared-events.js';
import { editorDivergence } from '../shared-divergence.js';
import {
    SharedDraft, sharedDraftFor, orderDraftRows, addToDraft, takeFromDraft, sharedEditFrom,
    draftChangesPersons, sharedEventTitle, sharedSaveMessage, familyCandidates, FamilyCandidate,
} from '../shared-event-editor.js';
import { uiModule } from './module.js';
import { renderAgeCheck, ageBirthDate } from './event-details-ui.js';

/** HTML-escape a user string for safe innerHTML insertion. */
function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** From this many other persons on, only the first SHOWN rows stand until "Show N more" (spec 085 §8b). */
const LARGE_HOUSEHOLD = 7;
const SHOWN = 5;

const val = (id: string): string => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';

/** "* 1882" for a person with a birth year. */
function bornYear(p: Person | null | undefined): string {
    const y = yearOf(p?.birthDate);
    return y !== null ? `* ${y}` : '';
}

/** The editor's input of a common field (the amber frame of a differing copy, 4g). */
const DIFF_INPUT: Partial<Record<SharedEventCommonField, string>> = {
    type: 'input-event-type', customLabel: 'input-event-custom-label', date: 'input-event-date',
    place: 'input-event-place', address: 'input-event-address', note: 'input-event-note',
};

/** The person picker's state while it is open. */
interface SharedPickerState {
    chosen: PersonId[];
    query: string;
    /** The inline "create a new person" form is open. */
    creating: boolean;
}

export const sharedEventMethods = uiModule({
    /**
     * Open the event editor for an event of a given person, from anywhere
     * (spec 085 §2: a "together with" line in another life, the table). The
     * person modal opens on `viewerId` underneath (the editor's subtitle
     * says whose side it was opened from), then the editor.
     */
    openEventEditorFor(viewerId: PersonId, eventId: string): void {
        if (!DataManager.getPerson(viewerId)?.events?.some(e => e.id === eventId)) return;
        const open = document.getElementById('person-modal')?.classList.contains('active');
        if (!open || this.currentId !== viewerId) {
            this.clearDialogStack();
            this.pushDialog('person-modal');
            this.showEditPersonModal(viewerId);
        }
        this.showEditEventModal(eventId);
    },

    /** Set up the section for an event being opened (null: a new event, or a couple's event when `couple`). */
    sharedEventInit(event: LifeEvent | null, couple = false): void {
        this.closeSharedMenus();
        this.sharedShowAll = false;
        this.sharedDraft = null;
        if (!couple && this.currentId) {
            const data = DataManager.getData();
            const draft = sharedDraftFor(data, this.currentId, event);
            if (event?.shareId) orderDraftRows(draft, sharedWith(DataManager.getSharedEventIndex(), this.currentId, event.id));
            this.sharedDraft = draft;
        }
        this.renderEventEditorSubtitle(couple);
        this.renderSharedSection();
    },

    /** "Jan Novák · * 1882" under the title of a person's event: whose side the editor was opened from (spec 085 §1a). */
    renderEventEditorSubtitle(couple: boolean): void {
        if (couple) return;   // setCoupleEditorMode names the couple
        const subtitle = document.getElementById('event-editor-subtitle');
        const person = this.currentId ? DataManager.getPerson(this.currentId) : null;
        if (!subtitle || !person) return;
        subtitle.textContent = [shownName(person), bornYear(person)].filter(Boolean).join(' · ');
        subtitle.hidden = false;
    },

    /** Whether the section is offered: a person's own event, not read-only, of a shareable type. */
    sharedSectionOffered(): boolean {
        if (!this.sharedDraft || !this.currentId || this.coupleEventPartnershipId) return false;
        if (DataManager.isPersonLocked(this.currentId)) return false;
        return eventIsShareable(val('input-event-type'));
    },

    /** Redraw everything the draft shows: the section, the banner, the age badge, the type list, the footer. */
    renderSharedSection(): void {
        const section = document.getElementById('event-shared-section');
        const draft = this.sharedDraft;
        const offered = this.sharedSectionOffered();
        const rows = offered && draft ? draft.rows : [];
        const shared = rows.length > 0;
        const e = strings.events;

        // The banner: everyone the edit applies to, the person opened from included.
        const banner = document.getElementById('event-shared-banner');
        if (banner) {
            banner.hidden = !shared;
            const text = banner.querySelector('.shared-banner-text');
            if (text) text.textContent = e.sharedBanner(rows.length + 1);
        }
        // "only Jan" by the age: the age above is this person's own.
        const own = document.getElementById('event-age-own');
        const person = this.currentId ? DataManager.getPerson(this.currentId) : null;
        if (own) {
            own.hidden = !shared;
            own.textContent = e.sharedAgeOwn(person?.firstName?.trim() || (person ? shownName(person) : ''));
        }
        document.getElementById('event-editor-modal')?.classList.toggle('is-shared-event', shared);
        const partHint = document.getElementById('event-participants-own-hint');
        if (partHint) partHint.hidden = !offered;
        this.lockSharedEventTypes(shared ? rows.length : 0);
        this.renderSharedDeleteButton();
        this.renderSharedDiff();

        if (!section) return;
        if (!offered || !draft) {
            section.hidden = true;
            section.innerHTML = '';
            return;
        }
        section.hidden = false;
        if (!shared) {
            // 1b: one quiet line, no sentence, no rule.
            section.className = 'shared-with shared-with--empty';
            section.innerHTML = `<span class="sw-label" id="event-shared-label">${esc(e.sharedWith)}</span>`
                + `<button type="button" class="link-button sw-add-link" aria-describedby="event-shared-label">+ ${esc(e.sharedAdd)}</button>`;
            section.querySelector('.sw-add-link')?.addEventListener('click', () => this.showSharedPicker());
            return;
        }
        section.className = 'shared-with';
        const large = rows.length >= LARGE_HOUSEHOLD;
        const shown = large && !this.sharedShowAll ? rows.slice(0, SHOWN) : rows;
        const typeShareable = val('input-event-type');
        const hint = typeShareable === 'custom' || typeShareable === 'naturalization' ? e.sharedWithHintOwn : e.sharedWithHint;
        section.innerHTML = `
            <h3 class="sw-title" id="event-shared-title">${esc(e.sharedWith)} <span class="sw-count">· ${rows.length}</span></h3>
            <p class="sw-hint">${esc(hint)}</p>
            <div class="sw-cols" aria-hidden="true"><span>${esc(e.sharedColPerson)}</span><span>${esc(e.sharedColRole)}</span><span class="sw-col-age">${esc(e.sharedColAge)}</span><span></span></div>
            <div class="sw-rows" role="list" aria-labelledby="event-shared-title">${shown.map(r => this.sharedRowHtml(r.personId, r.role, r.age)).join('')}</div>
            ${large ? `<button type="button" class="link-button sw-more-link">${esc(this.sharedShowAll ? e.sharedShowLess : e.sharedShowMore(rows.length - SHOWN))}</button>` : ''}
            <button type="button" class="secondary sw-add">+ ${esc(e.sharedAdd)}</button>`;
        this.wireSharedRows(section);
    },

    /**
     * The amber bar under the banner (4g) when the stored copies of the open
     * event differ: who differs and in what, Compare (the Unify dialog over
     * the editor); each input of a field in which this person's copy differs
     * from the others gets an amber frame. Saving does not overwrite the
     * difference (only changed fields are written), it stays until Unify or
     * Separate.
     */
    renderSharedDiff(): void {
        const bar = document.getElementById('event-shared-diff');
        const modal = document.getElementById('event-editor-modal');
        modal?.querySelectorAll('.is-shared-diff').forEach(el => el.classList.remove('is-shared-diff'));
        if (!bar) return;
        const viewer = this.currentId;
        const eventId = this.editingEventId;
        const stored = viewer && eventId && !this.coupleEventPartnershipId
            ? DataManager.getPerson(viewer)?.events?.find(e => e.id === eventId) ?? null : null;
        const data = DataManager.getData();
        const d = stored?.shareId ? shareDivergence(data, stored.shareId) : null;
        if (!d || !viewer || !eventId) {
            bar.hidden = true;
            delete bar.dataset.share;
            return;
        }
        const { text, fields } = editorDivergence(data, d, { personId: viewer, eventId });
        const msg = bar.querySelector('.shared-diff-msg');
        if (msg) msg.textContent = text;
        const link = bar.querySelector<HTMLElement>('.shared-diff-link');
        if (link) link.hidden = DataManager.isReadOnly() || d.copies.some(c => DataManager.isPersonLocked(c.personId));
        bar.dataset.share = d.shareId;
        bar.hidden = false;
        for (const f of fields) {
            const id = DIFF_INPUT[f];
            if (id) document.getElementById(id)?.classList.add('is-shared-diff');
        }
    },

    /** Compare in the amber bar: the Unify dialog over the editor, the editor brought up to date after. */
    compareSharedFromEditor(): void {
        const shareId = document.getElementById('event-shared-diff')?.dataset.share;
        const viewer = this.currentId;
        const eventId = this.editingEventId;
        if (!shareId || !viewer || !eventId) return;
        const dirty = this.hasEventEditorChanges();
        const framed = [...document.querySelectorAll<HTMLElement>('#event-editor-modal .is-shared-diff')].map(el => el.id);
        this.showSharedUnify(shareId, viewer, () => this.afterSharedUnifyInEditor(viewer, eventId, dirty, framed));
    },

    /**
     * After Unify or Separate from the editor: untouched, the editor opens
     * the stored event again; with unsaved changes, only the inputs that were
     * framed take the stored value (the rest stays as typed).
     */
    afterSharedUnifyInEditor(viewer: PersonId, eventId: string, dirty: boolean, framed: readonly string[]): void {
        this.renderEventsList();
        this.renderPersonLifeline(viewer);
        const open = document.getElementById('event-editor-modal')?.classList.contains('active');
        if (!open || this.currentId !== viewer || this.editingEventId !== eventId) return;
        const stored = DataManager.getPerson(viewer)?.events?.find(e => e.id === eventId);
        if (!stored) {
            this.forceCloseEventEditor();
            return;
        }
        if (!dirty) {
            if (this.dialogStack[this.dialogStack.length - 1] === 'event-editor-modal') this.dialogStack.pop();
            this.showEditEventModal(eventId);
            return;
        }
        const values: Record<string, string> = {
            'input-event-type': stored.type, 'input-event-custom-label': stored.customLabel ?? '',
            'input-event-date': formatDateForInput(stored.date), 'input-event-place': stored.place ?? '',
            'input-event-address': stored.address ?? '', 'input-event-note': stored.note ?? '',
        };
        for (const id of framed) {
            const input = document.getElementById(id) as HTMLInputElement | null;
            if (input && id in values) input.value = values[id];
        }
        if (!stored.shareId) this.sharedEventInit(stored);
        else this.renderSharedDiff();
    },

    /** The role cell: the list (household member / other role…) or, for a role of its own, a text field with ▾ back to the list. */
    sharedRoleCellHtml(name: string, role: string, custom: boolean): string {
        const e = strings.events;
        return `<div class="sw-role">${custom
            ? `<span class="sw-role-text"><input type="text" class="sw-role-input" value="${esc(role)}" placeholder="${esc(e.sharedRolePlaceholder)}" aria-label="${esc(e.sharedRowRole(name))}" autocomplete="off">`
                + `<button type="button" class="sw-role-back" aria-label="${esc(e.sharedRoleBack)}">▾</button></span>`
            : `<select class="sw-role-select" aria-label="${esc(e.sharedRowRole(name))}">`
                + `<option value="">${esc(e.sharedRoleDefault)}</option><option value="other">${esc(e.sharedRoleOther)}</option></select>`}</div>`;
    },

    /** One person's row: name (opens the person), role, age, ⋯. */
    sharedRowHtml(personId: PersonId, role: string, age: string): string {
        const e = strings.events;
        const p = DataManager.getPerson(personId);
        const name = p ? shownName(p) : '?';
        return `<div class="sw-row" role="listitem" data-pid="${esc(personId)}">
            <div class="sw-name"><button type="button" class="link-button sw-person">${esc(name)}</button>${bornYear(p) ? ` <span class="sw-year">${esc(bornYear(p))}</span>` : ''}</div>
            ${this.sharedRoleCellHtml(name, role, !!role.trim())}
            <div class="sw-age"><input type="text" class="sw-age-input" inputmode="numeric" value="${esc(age)}" aria-label="${esc(e.sharedRowAge(name))}" autocomplete="off"></div>
            <div class="sw-menu-cell"><button type="button" class="sw-menu-btn" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(e.sharedRowMenu(name))}">⋯</button></div>
            <div class="sw-warn age-check" hidden></div>
        </div>`;
    },

    /** Handlers of the rows (ids come from data: data attributes, never inline JS). */
    wireSharedRows(section: HTMLElement): void {
        const draft = this.sharedDraft;
        if (!draft) return;
        section.querySelectorAll<HTMLElement>('.sw-row').forEach(rowEl => {
            const row = draft.rows.find(r => r.personId === rowEl.dataset.pid);
            if (!row) return;
            rowEl.querySelector('.sw-person')?.addEventListener('click', () => this.sharedOpenPerson(row.personId));
            this.wireSharedRole(rowEl, row);
            const age = rowEl.querySelector<HTMLInputElement>('.sw-age-input');
            age?.addEventListener('input', () => { row.age = age.value; this.updateSharedAgeCheck(rowEl); });
            this.updateSharedAgeCheck(rowEl);
            const menuBtn = rowEl.querySelector<HTMLButtonElement>('.sw-menu-btn');
            menuBtn?.addEventListener('click', () => this.openSharedRowMenu(row.personId, menuBtn));
        });
        section.querySelector('.sw-more-link')?.addEventListener('click', () => {
            this.sharedShowAll = !this.sharedShowAll;
            this.renderSharedSection();
            document.querySelector<HTMLElement>('#event-shared-section .sw-more-link')?.focus();
        });
        section.querySelector('.sw-add')?.addEventListener('click', () => this.showSharedPicker());
    },

    /**
     * The role cell's handlers (1e): "Other role…" turns the list into a
     * text field, focused; typing keeps the role; ▾ goes back to the list
     * (household member).
     */
    wireSharedRole(rowEl: HTMLElement, row: { role: string; personId: PersonId }): void {
        const swap = (custom: boolean) => {
            const cell = rowEl.querySelector<HTMLElement>('.sw-role');
            const p = DataManager.getPerson(row.personId);
            const tmp = document.createElement('div');
            tmp.innerHTML = this.sharedRoleCellHtml(p ? shownName(p) : '?', '', custom);
            const fresh = tmp.firstElementChild as HTMLElement | null;
            if (!cell || !fresh) return;
            cell.replaceWith(fresh);
            this.wireSharedRole(rowEl, row);
            fresh.querySelector<HTMLElement>(custom ? '.sw-role-input' : '.sw-role-select')?.focus();
        };
        const select = rowEl.querySelector<HTMLSelectElement>('.sw-role-select');
        select?.addEventListener('change', () => { if (select.value === 'other') swap(true); });
        const input = rowEl.querySelector<HTMLInputElement>('.sw-role-input');
        input?.addEventListener('input', () => { row.role = input.value; });
        rowEl.querySelector('.sw-role-back')?.addEventListener('click', () => { row.role = ''; swap(false); });
    },

    /** A row's age against the person's birth, the same check as the editor's own age; shown only when it differs. */
    updateSharedAgeCheck(rowEl: HTMLElement): void {
        const warn = rowEl.querySelector<HTMLElement>('.sw-warn');
        const pid = rowEl.dataset.pid as PersonId | undefined;
        if (!warn || !pid) return;
        const date = normalizeDateInput(val('input-event-date'));
        const age = rowEl.querySelector<HTMLInputElement>('.sw-age-input')?.value ?? '';
        renderAgeCheck(warn, age, ageBirthDate(DataManager.getPerson(pid)), date || undefined);
        const differs = warn.classList.contains('age-check--warn');
        warn.hidden = !differs;
        rowEl.classList.toggle('sw-row--warn', differs);
    },

    /** Every row's age check again (the event's date changed). */
    updateSharedAgeChecks(): void {
        document.querySelectorAll<HTMLElement>('#event-shared-section .sw-row').forEach(r => this.updateSharedAgeCheck(r));
    },

    /**
     * 1h: while others share the event, the type list offers only the types
     * that can be shared; the rest stand under "One person only", greyed.
     * (A native select at every width: its disabled group says it to a screen
     * reader and a keyboard as it is.)
     */
    lockSharedEventTypes(others: number): void {
        const select = document.getElementById('input-event-type') as HTMLSelectElement | null;
        if (!select || this.coupleEventPartnershipId) return;
        const locked = others > 0;
        if ((select.dataset.sharedLock ?? '') === (locked ? String(others) : '')) return;
        const value = select.value;
        const e = strings.events;
        const opt = (t: LifeEventType, disabled = false) =>
            `<option value="${t}"${disabled ? ' disabled' : ''}>${esc(e.types[t])}</option>`;
        if (locked) {
            const shareable = SELECTABLE_EVENT_TYPES.filter(t => eventIsShareable(t));
            const rest = SELECTABLE_EVENT_TYPES.filter(t => !eventIsShareable(t));
            select.innerHTML = shareable.map(t => opt(t)).join('')
                + `<optgroup label="${esc(e.sharedTypeLocked)}">${rest.map(t => opt(t, true)).join('')}</optgroup>`;
            select.dataset.sharedLock = String(others);
        } else {
            select.innerHTML = SELECTABLE_EVENT_TYPES.map(t => opt(t)).join('');
            delete select.dataset.sharedLock;
        }
        select.value = value;
        const hint = document.getElementById('event-type-lock-hint');
        if (hint) {
            hint.textContent = locked ? e.sharedTypeLockedHint(others) : '';
            hint.classList.toggle('is-locked', locked);
            if (!locked) hint.hidden = true;
        }
        if (!select.dataset.sharedLockWired) {
            select.dataset.sharedLockWired = '1';
            const show = (on: boolean) => {
                const h = document.getElementById('event-type-lock-hint');
                if (h) h.hidden = !(on && h.classList.contains('is-locked'));
            };
            select.addEventListener('focus', () => show(true));
            select.addEventListener('blur', () => show(false));
        }
    },

    /** The footer: Delete ▾ for a shared event of a person (as stored); otherwise as before. */
    renderSharedDeleteButton(): void {
        const btn = document.getElementById('btn-delete-shared');
        if (!btn) return;
        const draft = this.sharedDraft;
        const on = !!draft && !!this.editingEventId && !this.coupleEventPartnershipId
            && draft.originalOthers.length > 0 && !!this.currentId && !DataManager.isPersonLocked(this.currentId);
        btn.hidden = !on;
    },

    /** The draft as a string for the editor's "unsaved changes" check. */
    sharedEditorState(): string {
        const d = this.sharedDraft;
        if (!d) return '';
        return JSON.stringify([d.rows.map(r => [r.personId, r.role.trim(), r.age.trim(), r.added]), d.removed, d.separated]);
    },

    // ==================== MENUS ====================

    /** Close an open row or Delete menu; true when one was open (Escape then closes only it). */
    closeSharedMenus(): boolean {
        const menu = document.getElementById('shared-event-menu');
        if (!menu) return false;
        const owner = this.sharedMenuOwner;
        menu.remove();
        this.sharedMenuOwner = null;
        window.removeEventListener('resize', this.sharedMenuCloser);
        document.querySelector('#event-editor-modal .modal-content')?.removeEventListener('scroll', this.sharedMenuCloser);
        document.removeEventListener('pointerdown', this.sharedMenuOutside, true);
        if (owner) { owner.setAttribute('aria-expanded', 'false'); }
        return true;
    },

    /**
     * Open a menu by a button: items of { label, hint?, danger?, run }, with a
     * divider before an item marked `divide`. Fixed over the dialog (it may
     * run over the footer); on a phone it spans the row (or the footer).
     * Arrows move, Enter/Space choose, Escape and Tab close.
     */
    openSharedMenu(anchor: HTMLElement, items: { label: string; hint?: string; danger?: boolean; divide?: boolean; run: () => void }[],
        opts: { above?: boolean; width: number; spanEl?: HTMLElement | null; title?: string }): void {
        const wasMine = this.sharedMenuOwner === anchor;
        this.closeSharedMenus();
        if (wasMine) return;
        const modal = anchor.closest<HTMLElement>('.modal');
        if (!modal) return;
        const menu = document.createElement('div');
        menu.id = 'shared-event-menu';
        menu.className = 'sw-menu';
        menu.setAttribute('role', 'menu');
        menu.innerHTML = (opts.title ? `<div class="sw-menu-title" aria-hidden="true">${esc(opts.title)}</div>` : '')
            + items.map((it, i) => `${it.divide ? '<div class="sw-menu-sep" role="separator"></div>' : ''}`
                + `<button type="button" role="menuitem" class="sw-menu-item${it.danger ? ' sw-menu-item--danger' : ''}" data-i="${i}" tabindex="-1">`
                + `<span class="sw-menu-label">${esc(it.label)}</span>${it.hint ? `<span class="sw-menu-hint">${esc(it.hint)}</span>` : ''}</button>`).join('');
        modal.appendChild(menu);
        const buttons = [...menu.querySelectorAll<HTMLButtonElement>('.sw-menu-item')];
        buttons.forEach(b => b.addEventListener('click', () => {
            const it = items[Number(b.dataset.i)];
            this.closeSharedMenus();
            anchor.focus();
            it?.run();
        }));
        menu.addEventListener('keydown', (ev: KeyboardEvent) => {
            const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                ev.preventDefault();
                const n = buttons.length;
                buttons[(i + (ev.key === 'ArrowDown' ? 1 : n - 1) + n) % n]?.focus();
            } else if (ev.key === 'Home' || ev.key === 'End') {
                ev.preventDefault();
                buttons[ev.key === 'Home' ? 0 : buttons.length - 1]?.focus();
            } else if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                this.closeSharedMenus();
                anchor.focus();
            } else if (ev.key === 'Tab') {
                this.closeSharedMenus();
            }
        });
        // Place it: under the button (right edges aligned), or above it; a phone spans the given element.
        const r = anchor.getBoundingClientRect();
        const phone = window.matchMedia('(max-width: 640px)').matches;
        const span = phone ? (opts.spanEl ?? null) : null;
        if (span) {
            const s = span.getBoundingClientRect();
            menu.style.left = `${Math.max(8, s.left)}px`;
            menu.style.width = `${Math.min(s.width, window.innerWidth - 16)}px`;
        } else {
            const width = Math.min(opts.width, window.innerWidth - 16);
            menu.style.width = `${width}px`;
            menu.style.left = `${Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))}px`;
        }
        const h = menu.offsetHeight;
        const below = window.innerHeight - r.bottom - 8;
        if (opts.above || (below < h && r.top > below)) {
            menu.style.bottom = `${window.innerHeight - r.top + 6}px`;
            menu.style.maxHeight = `${Math.max(120, r.top - 14)}px`;
        } else {
            menu.style.top = `${r.bottom + 4}px`;
            menu.style.maxHeight = `${Math.max(120, below - 4)}px`;
        }
        this.sharedMenuOwner = anchor;
        this.sharedMenuAnchorTop = r.top;
        anchor.setAttribute('aria-expanded', 'true');
        window.addEventListener('resize', this.sharedMenuCloser);
        document.querySelector('#event-editor-modal .modal-content')?.addEventListener('scroll', this.sharedMenuCloser, { passive: true });
        document.addEventListener('pointerdown', this.sharedMenuOutside, true);
        buttons[0]?.focus({ preventScroll: true });
    },

    /** A row's ⋯ (3a): open the person, separate, remove. */
    openSharedRowMenu(personId: PersonId, anchor: HTMLElement): void {
        const e = strings.events;
        const p = DataManager.getPerson(personId);
        this.openSharedMenu(anchor, [
            { label: e.sharedOpenPerson, run: () => this.sharedOpenPerson(personId) },
            { label: e.sharedSeparate, hint: e.sharedSeparateHint, run: () => this.sharedTakeOut(personId, true) },
            { label: e.sharedRemove, hint: e.sharedRemoveHint, danger: true, run: () => this.sharedTakeOut(personId, false) },
        ], { width: 300, spanEl: anchor.closest<HTMLElement>('.sw-row'), title: p ? shownName(p) : undefined });
    },

    /** The footer's Delete ▾ of a shared event (3b): this person only, separate this person, for all. */
    openSharedDeleteMenu(): void {
        const btn = document.getElementById('btn-delete-shared');
        const draft = this.sharedDraft;
        if (!btn || !draft) return;
        const e = strings.events;
        const others = draft.originalOthers.length;
        this.openSharedMenu(btn, [
            { label: e.sharedDeleteSelf, hint: e.sharedDeleteSelfHint(others), run: () => this.sharedDeleteSelf() },
            { label: e.sharedSeparateSelf, hint: e.sharedSeparateHint, run: () => this.sharedSeparateSelf() },
            { label: e.sharedDeleteAll(others + 1), danger: true, divide: true, run: () => { void this.sharedDeleteAll(); } },
        ], { above: true, width: 320, spanEl: btn.closest<HTMLElement>('.buttons') });
    },

    /** Take a person out of the draft (saved with the rest, one Undo). */
    sharedTakeOut(personId: PersonId, separate: boolean): void {
        const draft = this.sharedDraft;
        if (!draft) return;
        const rows = [...document.querySelectorAll<HTMLElement>('#event-shared-section .sw-row')];
        const at = rows.findIndex(r => r.dataset.pid === personId);
        takeFromDraft(draft, personId, separate);
        this.renderSharedSection();
        // Focus stays in the list: the next row's ⋯, else "Add a person".
        const next = document.querySelectorAll<HTMLElement>('#event-shared-section .sw-menu-btn')[Math.max(0, at)]
            ?? document.querySelector<HTMLElement>('#event-shared-section .sw-add, #event-shared-section .sw-add-link');
        next?.focus();
    },

    /** "Open person": leave the editor (asking about unsaved edits) for that person's card. */
    sharedOpenPerson(personId: PersonId): void {
        const go = () => { this.forceCloseEventEditor(); this.openLifelinePerson(personId); };
        if (this.hasEventEditorChanges()) {
            this.showUnsavedEditorDialog(strings.events.unsavedMessage,
                () => { if (this.saveEventFromModal() !== false) this.openLifelinePerson(personId); },
                go);
            return;
        }
        go();
    },

    // ==================== FOOTER ACTIONS (3b, 3c) ====================

    /** The event's name in messages ("Census 1921"), from the editor's fields. */
    sharedTitleFromForm(): string {
        const type = (val('input-event-type') || 'custom') as LifeEventType;
        const date = normalizeDateInput(val('input-event-date')) || undefined;
        return sharedEventTitle({ type, customLabel: val('input-event-custom-label'), date }, strings.events.types[type]);
    },

    /** The event's name in messages, as stored. */
    sharedTitleOf(ev: LifeEvent): string {
        return sharedEventTitle(ev, strings.events.types[ev.type]);
    },

    /** Delete only this person's copy; the others keep the event. */
    sharedDeleteSelf(): void {
        const pid = this.currentId;
        const eventId = this.editingEventId;
        const ev = pid && eventId ? DataManager.getPerson(pid)?.events?.find(x => x.id === eventId) : null;
        if (!pid || !eventId || !ev) return;
        const others = sharedWith(DataManager.getSharedEventIndex(), pid, eventId).length;
        const done = DataManager.runBatch(strings.events.sharedDeletedSelf(this.sharedTitleOf(ev), others),
            () => DataManager.removeFromShared(pid, eventId));
        if (!done) return;
        this.afterSharedEventChange(pid);
    },

    /** Separate this person: their copy keeps the edits typed so far and leaves the share. */
    sharedSeparateSelf(): void {
        const pid = this.currentId;
        const eventId = this.editingEventId;
        const person = pid ? DataManager.getPerson(pid) : null;
        if (!pid || !eventId || !person) return;
        const payload = this.eventPayloadFromForm(true);
        if (!payload) return;
        const done = DataManager.runBatch(strings.events.sharedSeparated(shownName(person)),
            () => DataManager.separateFromShared(pid, eventId, payload));
        if (!done) return;
        this.afterSharedEventChange(pid);
    },

    /** Delete the event for everyone, after a confirmation naming them (3c). */
    async sharedDeleteAll(): Promise<void> {
        const pid = this.currentId;
        const eventId = this.editingEventId;
        const ev = pid && eventId ? DataManager.getPerson(pid)?.events?.find(x => x.id === eventId) : null;
        if (!pid || !eventId || !ev?.shareId) return;
        const shareId = ev.shareId;
        const ids = [pid, ...sharedWith(DataManager.getSharedEventIndex(), pid, eventId)];
        const names = ids.map(id => DataManager.getPerson(id)).filter((p): p is Person => !!p).map(p => shownName(p));
        const e = strings.events;
        const title = this.sharedTitleOf(ev);
        const ok = await this.showConfirm(e.sharedDeleteAllLead, e.sharedDeleteAllTitle(title, ids.length), {
            confirmLabel: e.sharedDeleteAllGo(ids.length), variant: 'danger',
            list: { items: names, after: e.undoHint },
            note: this.researchArchiveDeleteNote(),
        });
        if (!ok) return;
        const n = DataManager.runBatch(e.sharedDeletedAll(title, ids.length), () => DataManager.deleteSharedForAll(shareId));
        if (!n) return;
        this.afterSharedEventChange(pid);
    },

    /** Close the editor and redraw the person's events after a shared change. */
    afterSharedEventChange(personId: PersonId): void {
        this.forceCloseEventEditor();
        this.renderEventsList();
        this.renderPersonLifeline(personId);
        this.refreshQuickFieldsFromEvents();
    },

    /**
     * Save through DataManager.saveSharedEvent when the event is (or becomes)
     * shared, as one undo step whose pill says what happened (1i, 3f).
     * False: not a shared save (the caller saves as before); null: refused.
     */
    saveSharedFromModal(payload: Omit<LifeEvent, 'id'>, participants: LifeEvent['participants']): boolean | null {
        const draft = this.sharedDraft;
        const viewer = this.currentId;
        if (!draft || !viewer || this.coupleEventPartnershipId) return false;
        const stored = this.editingEventId
            ? DataManager.getPerson(viewer)?.events?.find(e => e.id === this.editingEventId) ?? null : null;
        const offered = this.sharedSectionOffered();
        const rowsCount = offered ? draft.rows.length : 0;
        if (!stored?.shareId && (rowsCount === 0 || !offered) && !draftChangesPersons(draft)) return false;
        if (!offered && !stored?.shareId) return false;

        const common: SharedEventCommon = {
            type: payload.type,
            customLabel: payload.type === 'custom' ? payload.customLabel : undefined,
            date: payload.date || undefined,
            place: payload.place || undefined,
            address: payload.address || undefined,
            note: payload.note || undefined,
        };
        const viewerOwn: SharedEventOwn = {
            age: payload.age || undefined,
            cause: payload.cause || undefined,
            participants: participants ?? [],
        };
        // Only what was changed: a differing copy keeps its value (4g).
        const edit = sharedEditFrom(draft, common, viewerOwn, stored);
        const after = [viewer, ...draft.rows.map(r => r.personId)];
        const msg = sharedSaveMessage(draft, after);
        const title = sharedEventTitle({ type: payload.type, customLabel: payload.customLabel, date: payload.date }, strings.events.types[payload.type]);
        const e = strings.events;
        const nameOf = (id: PersonId) => { const p = DataManager.getPerson(id); return p ? shownName(p) : ''; };
        const text = msg.kind === 'onlyOne' ? e.sharedOnlyOne(title, nameOf(msg.personId))
            : msg.kind === 'nowN' ? e.sharedNowN(title, msg.count)
            : msg.kind === 'separated' ? e.sharedSeparated(nameOf(msg.personId))
            : e.sharedSaved(title, msg.count);
        // All or nothing: a refused save of a new event leaves no ordinary event behind.
        const eventId = this.editingEventId;
        let saved: { shareId: string | null; attached: PersonId[] } | null = null;
        const ok = DataManager.runBatch(text, () => {
            saved = eventId
                ? DataManager.saveSharedEvent(viewer, eventId, edit)
                : DataManager.addSharedEvent(viewer, payload, edit)?.result ?? null;
            return !!saved;
        });
        if (!ok) {
            this.showAlert(e.sharedSaveRefused, 'warning');
            return null;
        }
        // Records joined with other common fields (a source, a note…): Unify, never overwritten silently (K1.6 a).
        const done = saved as { shareId: string | null; attached: PersonId[] } | null;
        if (done?.shareId && done.attached.length > 0 && shareDivergence(DataManager.getData(), done.shareId)) {
            this.sharedUnifyAfterSave = { shareId: done.shareId, viewerId: viewer };
        }
        return true;
    },

    /** After the editor closed: the Unify dialog for records a save joined that differ (sharedUnifyAfterSave). */
    offerSharedUnifyAfterSave(): void {
        const pending = this.sharedUnifyAfterSave;
        this.sharedUnifyAfterSave = null;
        if (!pending) return;
        this.showSharedUnify(pending.shareId, pending.viewerId, () => {
            this.renderEventsList();
            this.renderPersonLifeline(pending.viewerId);
        });
    },

    /** The event as the editor's form has it now: what a person's own record must match to be joined (ownSameEvent). */
    sharedFormSameFields(): SameEventFields {
        const type = (val('input-event-type') || 'custom') as LifeEventType;
        return {
            type,
            customLabel: type === 'custom' ? val('input-event-custom-label').trim() || undefined : undefined,
            date: normalizeDateInput(val('input-event-date')) || undefined,
            place: val('input-event-place').trim() || undefined,
            address: val('input-event-address').trim() || undefined,
        };
    },

    // ==================== PERSON PICKER (1c, 1d, 1k) ====================

    /** Open "Add a person": the family first (alive on the date), then the whole tree by search. */
    showSharedPicker(): void {
        if (!this.sharedDraft) return;
        this.closeSharedMenus();
        const modal = document.getElementById('shared-picker-modal');
        if (!modal) return;
        this.sharedPicker = { chosen: [], query: '', creating: false };
        const e = strings.events;
        const type = (val('input-event-type') || 'custom') as LifeEventType;
        const date = normalizeDateInput(val('input-event-date')) || undefined;
        const sub = document.getElementById('shared-picker-sub');
        if (sub) {
            const label = type === 'custom' && val('input-event-custom-label').trim() ? val('input-event-custom-label').trim() : e.types[type];
            sub.textContent = [label, formatFlexDate(date)].filter(Boolean).join(' · ');
        }
        const title = document.getElementById('shared-picker-title');
        if (title) title.textContent = e.sharedAdd;
        const search = document.getElementById('shared-picker-search') as HTMLInputElement | null;
        if (search) {
            search.value = '';
            search.oninput = () => {
                if (!this.sharedPicker) return;
                this.sharedPicker.query = search.value;
                this.renderSharedPicker();
            };
        }
        modal.onclick = (ev) => { if (ev.target === modal) this.closeSharedPicker(); };
        this.pushDialog('shared-picker-modal');
        modal.classList.add('active');
        this.renderSharedPicker();
        search?.focus();
    },

    /** Draw the picker's list: the family (or the search's results), a new person when nothing matches. */
    renderSharedPicker(): void {
        const st = this.sharedPicker;
        const draft = this.sharedDraft;
        const list = document.getElementById('shared-picker-list');
        if (!st || !draft || !list || !this.currentId) return;
        const pp = strings.personPicker;
        const data = DataManager.getData();
        const lang = getCurrentLanguage();
        const inShare = new Set<PersonId>([draft.viewerId, ...draft.rows.map(r => r.personId)]);
        const date = normalizeDateInput(val('input-event-date')) || undefined;
        const q = st.query.trim();
        const sameAs = this.sharedFormSameFields();

        const row = (p: Person, line: string): string => {
            const already = inShare.has(p.id);
            const on = st.chosen.includes(p.id);
            // K1.6 a: their own record of this event joins on save, no new copy.
            const joins = already ? null : ownSameEvent(p, sameAs);
            return `<label class="spk-row${already ? ' is-already' : ''}" data-pid="${esc(p.id)}">
                <input type="checkbox" class="spk-check"${on ? ' checked' : ''}${already ? ' disabled' : ''}>
                <span class="spk-text"><span class="spk-name">${esc(shownName(p))}</span>`
                + `<span class="spk-line">${esc(already ? pp.alreadyShared : line)}</span>`
                + (joins ? `<span class="spk-line spk-joins">${esc(pp.joinsOwnRecord(this.sharedTitleOf(joins)))}</span>` : '')
                + '</span></label>';
        };
        const kinWord = (c: FamilyCandidate): string => findRelationship(data, this.currentId!, c.personId)?.term[lang] ?? '';
        let html = '';
        if (!q) {
            const fam = familyCandidates(data, this.currentId, date);
            const dateShown = formatFlexDate(date);
            html += `<div class="spk-group" role="group" aria-labelledby="spk-family-head">
                <div class="spk-head" id="spk-family-head">${esc(pp.family)}${dateShown ? ` <span class="spk-head-sub">· ${esc(pp.familyAlive(dateShown))}</span>` : ''}</div>`
                + fam.alive.map(c => {
                    const p = data.persons[c.personId];
                    return row(p, [kinWord(c), bornYear(p)].filter(Boolean).join(' · '));
                }).join('') + '</div>';
            if (fam.hidden.length > 0) {
                const names = fam.hidden.slice(0, 3).map(c => {
                    const p = data.persons[c.personId];
                    const died = yearOf(p.deathDate);
                    return died !== null ? `${shownName(p)} († ${died})` : shownName(p);
                });
                if (fam.hidden.length > 3) names.push('…');
                html += `<p class="spk-hidden">${esc(pp.familyHidden(fam.hidden.length, names.join(', ')))}</p>`;
            }
        } else {
            const hits = filterAndSort(q, DataManager.getAllPersons().filter(p => !p.isPlaceholder), data).slice(0, 50);
            if (hits.length > 0) {
                html += hits.map(p => row(p, [findRelationship(data, this.currentId!, p.id)?.term[lang] ?? '', bornYear(p)].filter(Boolean).join(' · '))).join('');
            } else {
                html += `<p class="spk-empty">${esc(pp.noResults)}</p>`
                    + `<button type="button" class="spk-create-row">+ ${esc(pp.createNamed(q))}</button>`
                    + `<p class="spk-note">${esc(pp.noteHint)}</p>`;
            }
        }
        if (st.creating) html += this.sharedCreateFormHtml(q);
        list.innerHTML = html;
        list.querySelectorAll<HTMLElement>('.spk-row').forEach(el => {
            const box = el.querySelector<HTMLInputElement>('.spk-check');
            box?.addEventListener('change', () => {
                const pid = el.dataset.pid as PersonId;
                st.chosen = box.checked ? [...st.chosen.filter(x => x !== pid), pid] : st.chosen.filter(x => x !== pid);
                this.updateSharedPickerFooter();
            });
        });
        list.querySelector('.spk-create-row')?.addEventListener('click', () => this.openSharedCreate());
        this.wireSharedCreateForm();
        this.updateSharedPickerFooter();
    },

    /** "Add (n)" counts the ticked persons. */
    updateSharedPickerFooter(): void {
        const st = this.sharedPicker;
        const add = document.getElementById('shared-picker-add') as HTMLButtonElement | null;
        if (!st || !add) return;
        add.textContent = strings.personPicker.addN(st.chosen.length);
        add.disabled = st.chosen.length === 0;
    },

    /** The inline form of a new person (the person dialog itself is open underneath). */
    sharedCreateFormHtml(q: string): string {
        const words = q.trim().split(/\s+/).filter(Boolean);
        const last = words.length > 1 ? words[words.length - 1] : '';
        const first = words.length > 1 ? words.slice(0, -1).join(' ') : (words[0] ?? '');
        const fw = strings.familyWizard;
        const g = strings.gender;
        return `<div class="spk-create" role="group" aria-label="${esc(strings.personPicker.createPerson)}">
            <div class="spk-create-fields">
                <label class="spk-field"><span>${esc(fw.firstName)}</span><input type="text" id="spk-new-first" value="${esc(first)}" autocomplete="off"></label>
                <label class="spk-field"><span>${esc(fw.lastName)}</span><input type="text" id="spk-new-last" value="${esc(last)}" autocomplete="off"></label>
                <label class="spk-field spk-field--sex"><span>${esc(strings.labels.gender)}</span><select id="spk-new-gender">
                    <option value="male">${esc(g.male)}</option><option value="female">${esc(g.female)}</option><option value="unknown">${esc(g.unknown)}</option></select></label>
            </div>
            <button type="button" class="primary spk-create-go">${esc(strings.personPicker.createAdd)}</button>
        </div>`;
    },

    /** Open the new-person form (from the footer link or the "create …" row). */
    openSharedCreate(): void {
        const st = this.sharedPicker;
        if (!st) return;
        st.creating = true;
        this.renderSharedPicker();
        document.getElementById('spk-new-first')?.focus();
    },

    wireSharedCreateForm(): void {
        document.querySelector('#shared-picker-list .spk-create-go')?.addEventListener('click', () => this.sharedCreatePerson());
    },

    /** Create the person (its own undo step) and add them to the draft. */
    sharedCreatePerson(): void {
        const first = val('spk-new-first').trim();
        const last = val('spk-new-last').trim();
        const gender = (val('spk-new-gender') || 'unknown') as Gender;
        if (!first && !last) { document.getElementById('spk-new-first')?.focus(); return; }
        const person = DataManager.createPerson({ firstName: first, lastName: last, gender });
        const st = this.sharedPicker;
        if (st) st.chosen = [...st.chosen, person.id];
        this.confirmSharedPicker();
    },

    /** "Add (n)": the ticked persons go to the end of the rows. */
    confirmSharedPicker(): void {
        const st = this.sharedPicker;
        const draft = this.sharedDraft;
        if (!st || !draft) { this.closeSharedPicker(); return; }
        const sameAs = this.sharedFormSameFields();
        const joining = new Map<PersonId, LifeEvent>();
        for (const pid of st.chosen) {
            const own = ownSameEvent(DataManager.getPerson(pid), sameAs);
            if (own) joining.set(pid, own);
        }
        addToDraft(draft, st.chosen, joining);
        // A new household larger than the fold shows everyone just added.
        if (draft.rows.length >= LARGE_HOUSEHOLD && st.chosen.length > 0) this.sharedShowAll = true;
        this.closeSharedPicker();
        this.renderSharedSection();
        document.querySelector<HTMLElement>('#event-shared-section .sw-add, #event-shared-section .sw-add-link')?.focus();
    },

    closeSharedPicker(): void {
        const modal = document.getElementById('shared-picker-modal');
        modal?.classList.remove('active');
        if (modal) modal.onclick = null;
        if (this.dialogStack[this.dialogStack.length - 1] === 'shared-picker-modal') this.dialogStack.pop();
        this.sharedPicker = null;
    },
});
