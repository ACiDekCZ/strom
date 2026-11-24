/**
 * PersonPicker - Smart person selection component
 * Replaces plain <select> elements with searchable dropdown
 */

import { Person, PersonId, StromData } from './types.js';
import { strings } from './strings.js';
import { DataManager } from './data.js';
import { normalizeSearchText as normalizeText, alternateNames, nameMatchesQuery } from './name-search.js';
import { detailMatch } from './search-filter.js';
import { displayYear } from './dates.js';
import { nameHtml, surnameDisplay, shownName, shownNameParts, shownSurnameIsBirth, titlesShown, birthNoteText } from './person-name.js';
import { surnameForms } from './surnames.js';
import { PickerDistinguisher } from './picker-distinguish.js';
import {
    directLineIds, effectiveScope, getSearchScope, narrowIds, offeredScopes, onSearchScope, setSearchScope, stepScope,
    SEARCH_SCOPES, type ScopeSets, type SearchScope,
} from './search-scope.js';
import { isPhoneBar } from './breakpoints.js';

/**
 * Where a picker's scope comes from (spec 137 §1.5): the person whose direct
 * line it narrows to and the people of the view behind it.
 */
export interface PickerScopeSource {
    /** The direct line's person; null = the segment Direct line is not offered. */
    refPersonId(): PersonId | null;
    /** 'main' = the tree's main person (Map, Table): the line under the segments says so. */
    refKind(): 'center' | 'main' | 'dialog';
    /** The view's people; null = no view behind the picker, or it shows the whole tree: In view is not offered. */
    viewPersonIds(): ReadonlySet<PersonId> | null;
    /** The view's name for "In view: Family · 24 people". */
    viewLabel(): string;
}

/** What a picker's scope head shows (renderScopeHead). */
interface ScopeHeadState {
    sets: ScopeSets;
    refPerson: Person | null;
    refKind: 'center' | 'main' | 'dialog';
    viewLabel: string;
    /** The rows after the narrowing. */
    count: number;
}

function escHtml(text: string): string {
    return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** "Jan Ostrožný (*1871)": the name and the birth year as the picker's rows give it. */
function refPlain(p: Person): string {
    const year = p.birthDate ? p.birthDate.split('-')[0] : '';
    return `${shownName(p)}${year ? ` (*${year})` : ''}`;
}

/** The same with the name in bold (HTML). */
function refHtml(p: Person): string {
    const year = p.birthDate ? p.birthDate.split('-')[0] : '';
    return `<b>${escHtml(shownName(p))}</b>${year ? ` (*${escHtml(year)})` : ''}`;
}

/** Keyboards (a fine pointer) get the shortcut in the segments' titles. */
function hasKeyboardHint(): boolean {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches;
}

/** The scope head's markup: the segments, the count and the line saying what the narrowing keeps. */
function buildScopeHead(): HTMLElement {
    const S = strings.searchScope;
    const head = document.createElement('div');
    head.className = 'person-picker-head';
    const label = (s: SearchScope) => s === 'tree' ? S.tree : s === 'line' ? S.line : S.view;
    head.innerHTML = `<div class="person-picker-head-row">`
        + `<div class="sel-seg person-picker-scope" role="radiogroup" aria-label="${escHtml(S.group)}">`
        + SEARCH_SCOPES.map(s => `<button type="button" class="sel-opt" data-sel-form="seg" role="radio" aria-checked="false" tabindex="-1" data-scope="${s}">${escHtml(label(s))}</button>`).join('')
        + `</div><span class="person-picker-count" aria-live="polite"></span></div>`
        + `<div class="person-picker-ref" hidden></div>`;
    return head;
}

/**
 * Draw a scope head's state (both pickers draw the same): the offered
 * segments (a scope not offered here is hidden), the one in effect checked,
 * the titles, the count and the line under the segments. The buttons stay
 * (no redraw), so the focus and the hover are kept.
 */
function renderScopeHead(head: HTMLElement, st: ScopeHeadState): void {
    const S = strings.searchScope;
    const scope = effectiveScope(getSearchScope(), st.sets);
    const offered = offeredScopes(st.sets);
    const keys = hasKeyboardHint() ? ` ${S.altKeys}` : '';
    head.querySelectorAll<HTMLButtonElement>('.person-picker-scope > [data-scope]').forEach(btn => {
        const s = btn.dataset.scope as SearchScope;
        btn.hidden = !offered.includes(s);
        btn.classList.toggle('is-last', s === offered[offered.length - 1]);
        btn.setAttribute('aria-checked', String(s === scope));
        btn.tabIndex = s === scope ? 0 : -1;
        const title = s === 'tree' ? S.treeTitle
            : s === 'line' ? (st.refPerson ? S.lineTitle(refPlain(st.refPerson)) : '')
            : S.viewTitle(st.sets.view?.size ?? 0);
        btn.title = title + keys;
    });
    const countText = strings.search.resultCount(st.count);
    const count = head.querySelector<HTMLElement>('.person-picker-count');
    if (count && count.textContent !== countText) count.textContent = countText;
    const ref = head.querySelector<HTMLElement>('.person-picker-ref');
    if (!ref) return;
    let html = '';
    if (scope === 'line' && st.refPerson) {
        html = st.refKind === 'main' ? S.lineRefMain(refHtml(st.refPerson)) : S.lineRef(refHtml(st.refPerson));
    } else if (scope === 'view' && st.sets.view) {
        html = S.viewRef(escHtml(st.viewLabel), st.sets.view.size);
    }
    // A phone has no room beside the segments: the count ends the line under them.
    if (isPhoneBar()) html = html ? `${html} · <b>${escHtml(countText)}</b>` : `<b>${escHtml(countText)}</b>`;
    ref.hidden = !html;
    if (ref.innerHTML !== html) ref.innerHTML = html;
}

/**
 * Wire a scope head: a press keeps the focus in the field (a blur would fold
 * the toolbar's search or close a dialog's list), a click chooses, ←/→ walk
 * the segments, Esc goes back to the field.
 */
function wireScopeHead(head: HTMLElement, input: HTMLInputElement, sets: () => ScopeSets): void {
    const keep = (e: Event) => { if ((e.target as HTMLElement).closest('.person-picker-head')) e.preventDefault(); };
    head.addEventListener('pointerdown', keep);
    head.addEventListener('mousedown', keep);
    head.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-scope]');
        if (!btn) return;
        e.stopPropagation();
        const keyboard = document.activeElement === btn;
        setSearchScope(btn.dataset.scope as SearchScope);
        // Chosen on the segment by the keyboard: it keeps the focus; by a click the field has it.
        if (!keyboard) input.focus();
    });
    head.addEventListener('keydown', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-scope]');
        if (!btn) return;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            const next = stepScope(getSearchScope(), sets(), e.key === 'ArrowLeft' ? -1 : 1);
            setSearchScope(next);
            head.querySelector<HTMLButtonElement>(`[data-scope="${next}"]`)?.focus();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            input.focus();
        }
    });
}

/**
 * Sort persons by name (lastName, firstName)
 */
function sortByName(a: Person, b: Person): number {
    const nameA = `${a.lastName} ${a.firstName}`.toLowerCase();
    const nameB = `${b.lastName} ${b.firstName}`.toLowerCase();
    return nameA.localeCompare(nameB);
}

/**
 * Calculate match score for a person against a query
 * Higher score = better match
 */
function calculateMatchScore(person: Person, query: string, data: StromData | null, details = false): number {
    const firstName = normalizeText(person.firstName);
    const lastName = normalizeText(person.lastName);
    const fullName = `${firstName} ${lastName}`;

    // Exact match at beginning = highest score
    if (firstName.startsWith(query)) return 100;
    if (lastName.startsWith(query)) return 90;
    if (fullName.startsWith(query)) return 85;

    // Match anywhere in name
    const firstNameIdx = firstName.indexOf(query);
    const lastNameIdx = lastName.indexOf(query);

    if (firstNameIdx >= 0) return 70 - firstNameIdx;  // Earlier position = higher score
    if (lastNameIdx >= 0) return 60 - lastNameIdx;

    // Other forms of the surname and the person's name variants: someone
    // searching "Fisek" must find "Fíšková", "Fischek" the alias.
    const alternates = alternateNames(person, data);
    if (alternates.some(n => n.startsWith(query))) return 55;
    if (alternates.some(n => n.includes(query))) return 45;
    // Multi-word query spread over first name and an alternate surname.
    if (query.includes(' ') && nameMatchesQuery(person, query, data)) return 40;

    // Birth year match
    const birthYear = person.birthDate?.split('-')[0] || '';
    if (birthYear && birthYear.includes(query)) return 30;

    // A cause of death or a house ("cholera", "čp. 13") — the toolbar search only.
    if (details && detailMatch(person, query, data)) return 20;

    return 0;  // No match
}

/**
 * Filter and sort persons based on search query
 */
export function filterAndSort(query: string, persons: Person[], data: StromData | null, details = false): Person[] {
    const normalized = normalizeText(query.trim());

    if (!normalized) {
        // Empty query - return all sorted alphabetically
        return [...persons].sort(sortByName);
    }

    // Score and filter matching persons
    return persons
        .map(p => ({
            person: p,
            score: calculateMatchScore(p, normalized, data, details)
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => {
            // Higher score first
            if (b.score !== a.score) return b.score - a.score;
            // Then alphabetically
            return sortByName(a.person, b.person);
        })
        .map(item => item.person);
}

/**
 * Found by the surname the shown name leaves out (Settings → "Surname
 * display", Person.primaryName), as a row under the name: "po sňatku
 * Nováková" when only the birth surname shows, "dříve Zástěrová" when the
 * person goes by the birth surname, "roz. Dvořáková" when only the married
 * one shows, the surname marked. '' when nothing is hidden, the name already
 * carries "(roz. …)", or no word of `query` matched only the hidden surname.
 */
export function hiddenSurnameMatchHtml(person: Person, query: string, data: StromData | null, display = surnameDisplay()): string {
    const married = person.marriedSurname?.trim();
    if (!married || person.isPlaceholder) return '';
    if (shownNameParts(person, '', titlesShown(), display).birthNote) return '';
    const words = normalizeText(query.trim()).split(' ').filter(Boolean);
    if (!words.length) return '';
    const formsOf = (surname: string): string[] =>
        (data ? surnameForms(surname, data) : [surname]).map(f => normalizeText(f)).filter(Boolean);
    const shownIsBirth = shownSurnameIsBirth(person, display);
    const hidden = shownIsBirth ? married : person.lastName ?? '';
    const shown = [normalizeText(person.firstName ?? ''), ...formsOf(shownIsBirth ? person.lastName ?? '' : married)];
    const hiddenForms = formsOf(hidden);
    const found = words.some(w => !shown.some(n => n.includes(w)) && hiddenForms.some(n => n.includes(w)));
    if (!found || !hidden.trim()) return '';
    const marked = `\u0000`;
    const label = !shownIsBirth ? strings.search.birth
        : person.primaryName === 'birth' && display !== 'birth' ? strings.search.former
        : strings.search.married;
    const [before, after = ''] = label(marked).split(marked);
    const esc = (text: string): string => text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    return `<div class="person-picker-match">${esc(before)}<mark>${esc(hidden.trim())}</mark>${esc(after)}</div>`;
}

/** The text of a small piece of the picker's own HTML (tags dropped, entities read). */
function htmlToText(html: string): string {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
        .trim();
}

export interface PersonPickerOptions {
    containerId: string;
    onSelect: (personId: PersonId) => void;
    filter?: (person: Person) => boolean;
    placeholder?: string;
    showBirthYear?: boolean;
    persons?: Person[];
    /** Tree the persons belong to (surname groups); defaults to the active tree. */
    data?: StromData;
    /** Also find people by a cause of death or a house, and say where it matched. */
    searchDetails?: boolean;
    /** Open the list as soon as the field gets focus (the toolbar search); otherwise on a click, typing or ArrowDown. */
    openOnFocus?: boolean;
    /**
     * A row's tag after the name and a link under it (the map's search: a
     * person outside the selection, "Show in the whole tree"); null: none.
     * The link closes the list and clears the field.
     */
    rowNote?: (person: Person) => { tag: string; action?: { label: string; run: (id: PersonId) => void } } | null;
    /** The search scope (spec 137): without it the picker has no scope head. */
    scope?: PickerScopeSource;
}

const BATCH_SIZE = 50;

export class PersonPicker {
    private options: PersonPickerOptions;
    private container: HTMLElement;
    private input: HTMLInputElement;
    private dropdown: HTMLElement;
    private toggleBtn: HTMLButtonElement;
    private selectedIndex: number = -1;
    private filteredPersons: Person[] = [];
    private allPersons: Person[] = [];
    private selectedPersonId: PersonId | null = null;
    private isOpen: boolean = false;
    private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
    private displayedCount: number = BATCH_SIZE;
    /** Lines telling apart the rows of the same name in the current result. */
    private distinguisher: PickerDistinguisher | null = null;
    /** The scrolled list of rows: the dropdown itself, or under the scope head (spec 137). */
    private list: HTMLElement;
    private head: HTMLElement | null = null;
    /** The narrowed scopes' people, worked out when the list opens (never while typing). */
    private scopeSets: ScopeSets | null = null;
    /** The matches in the whole tree before the narrowing. */
    private wholeCount = 0;
    private offScope: (() => void) | null = null;

    constructor(options: PersonPickerOptions) {
        this.options = {
            showBirthYear: true,
            placeholder: strings.personPicker.placeholder,
            ...options
        };

        const container = document.getElementById(options.containerId);
        if (!container) {
            throw new Error(`Container not found: ${options.containerId}`);
        }
        this.container = container;
        this.input = document.createElement('input');
        this.dropdown = document.createElement('div');
        this.list = this.dropdown;
        this.toggleBtn = document.createElement('button');

        this.init();
    }

    private init(): void {
        // Set persons - use provided list or get all from DataManager
        this.allPersons = this.options.persons || DataManager.getAllPersons();
        if (this.options.filter) {
            this.allPersons = this.allPersons.filter(this.options.filter);
        }

        // Build HTML structure
        this.container.innerHTML = '';
        this.container.className = 'person-picker';

        // Input
        this.input = document.createElement('input');
        this.input.type = 'text';
        this.input.className = 'person-picker-input';
        this.input.placeholder = this.options.placeholder || '';
        this.input.autocomplete = 'off';
        // A name search, not prose: no auto-capitals, corrections or spell
        // check (a phone keyboard rewrote the query while typing).
        this.input.setAttribute('autocapitalize', 'off');
        this.input.setAttribute('autocorrect', 'off');
        this.input.spellcheck = false;
        this.container.appendChild(this.input);

        // Toggle button
        this.toggleBtn = document.createElement('button');
        this.toggleBtn.type = 'button';
        this.toggleBtn.className = 'person-picker-toggle';
        this.toggleBtn.innerHTML = '&#9662;';  // Down arrow
        this.toggleBtn.setAttribute('aria-label', strings.personPicker.showList);
        this.container.appendChild(this.toggleBtn);

        // Dropdown
        this.dropdown = document.createElement('div');
        this.dropdown.className = 'person-picker-dropdown';
        this.list = this.dropdown;
        if (this.options.scope) {
            // The scope head stands, only the rows scroll (spec 137 §1.2).
            this.dropdown.classList.add('has-scope');
            this.dropdown.setAttribute('role', 'presentation');
            this.head = buildScopeHead();
            this.list = document.createElement('div');
            this.list.className = 'person-picker-list';
            this.dropdown.append(this.head, this.list);
            wireScopeHead(this.head, this.input, () => this.currentSets());
            // Tab from the last segment (or away by a click elsewhere): the list closes.
            this.dropdown.addEventListener('focusout', (e) => {
                const to = e.relatedTarget as Node | null;
                if (to && !this.container.contains(to)) this.hide();
            });
            this.offScope = onSearchScope(() => {
                if (!this.isOpen) return;
                this.computeScopeSets();
                this.renderDropdown();
            });
        }
        this.list.setAttribute('role', 'listbox');
        this.list.setAttribute('aria-label', this.options.placeholder || strings.personPicker.placeholder);
        this.container.appendChild(this.dropdown);

        // Event listeners
        this.input.addEventListener('input', () => this.handleInput());
        // Open on a deliberate gesture (click/tap, typing, ArrowDown), not on
        // focus alone: a dialog that focuses this field on opening would drop
        // the list over its own buttons.
        this.input.addEventListener('click', () => { if (!this.isOpen) this.show(); });
        if (this.options.openOnFocus) this.input.addEventListener('focus', () => this.show());
        this.input.addEventListener('keydown', (e) => this.handleKeydown(e));
        this.toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.isOpen) {
                this.hide();
            } else {
                this.show();
                this.input.focus();
            }
        });

        // Close on outside click. Keep the reference — destroy() must remove
        // it, or every picker instance leaks a document-level handler (and
        // retains its whole persons array) for the page lifetime.
        this.outsideClickHandler = (e: MouseEvent) => {
            if (!this.container.contains(e.target as Node)) {
                this.hide();
            }
        };
        document.addEventListener('click', this.outsideClickHandler);
    }

    /**
     * Update the list of persons (useful when persons change)
     */
    setPersons(persons: Person[]): void {
        this.allPersons = persons;
        if (this.options.filter) {
            this.allPersons = this.allPersons.filter(this.options.filter);
        }
        if (this.isOpen) {
            this.renderDropdown();
        }
    }

    /**
     * Show dropdown
     */
    show(): void {
        // The narrowed sets are worked out on opening, not on every keystroke (spec 137 §0.2).
        if (!this.isOpen || !this.scopeSets) this.computeScopeSets();
        this.isOpen = true;
        // Render first so the dropdown has content: its width is content-driven
        // (see positionDropdown), which requires the items to be in the DOM and
        // the dropdown to be visible before we can measure it.
        this.renderDropdown();
        this.dropdown.classList.add('active');
        this.positionDropdown();
    }

    /**
     * Position dropdown using fixed positioning.
     *
     * The dropdown sizes to its content (long names must not be squashed to the
     * width of a narrow search input, esp. on mobile where the toolbar search is
     * ~140px): min-width matches the input so it is never narrower than before,
     * width follows the content, and max-width is clamped to the viewport. The
     * left edge is then clamped so the dropdown never overflows the screen edge.
     */
    private positionDropdown(): void {
        const inputRect = this.input.getBoundingClientRect();
        const margin = 8;  // keep the dropdown off the very screen edge
        this.dropdown.style.top = `${inputRect.bottom + 4}px`;
        if (this.head && isPhoneBar()) {
            // A phone (spec 137 §5): the three 44px segments need the room — the
            // screen's width upright, sideways from the field's left edge, at most 440px.
            // 8px under the field: the 44px hit areas of the field's × and funnel reach below it.
            this.dropdown.style.top = `${inputRect.bottom + 8}px`;
            const upright = window.innerWidth <= 640;
            const left = upright ? margin : Math.max(margin, inputRect.left);
            const width = upright ? window.innerWidth - margin * 2 : Math.min(440, window.innerWidth - margin - left);
            this.dropdown.style.minWidth = '';
            this.dropdown.style.maxWidth = '';
            this.dropdown.style.width = `${width}px`;
            this.dropdown.style.left = `${left}px`;
            return;
        }
        this.dropdown.style.minWidth = `${inputRect.width}px`;
        this.dropdown.style.maxWidth = `${Math.max(inputRect.width, window.innerWidth - margin * 2)}px`;
        this.dropdown.style.width = 'max-content';

        // Measure the resolved width and clamp horizontally so the dropdown
        // stays fully on-screen (extend right from the input when there is room,
        // otherwise flip/clamp against the right edge).
        const dropdownWidth = this.dropdown.offsetWidth;
        let left = inputRect.left;
        if (left + dropdownWidth > window.innerWidth - margin) {
            left = window.innerWidth - margin - dropdownWidth;
        }
        if (left < margin) left = margin;
        this.dropdown.style.left = `${left}px`;
    }

    /**
     * Hide dropdown
     */
    hide(): void {
        this.isOpen = false;
        this.dropdown.classList.remove('active');
        this.selectedIndex = -1;
    }

    /**
     * Clear selection
     */
    clear(): void {
        this.input.value = '';
        this.selectedPersonId = null;
        this.selectedIndex = -1;
    }

    /**
     * Get selected person ID
     */
    getValue(): PersonId | null {
        return this.selectedPersonId;
    }

    /**
     * Set selected person
     */
    setValue(personId: PersonId): void {
        const person = this.allPersons.find(p => p.id === personId);
        if (person) {
            this.selectedPersonId = personId;
            this.input.value = this.formatPersonName(person);
        }
    }

    /**
     * Handle input changes
     */
    private handleInput(): void {
        this.selectedPersonId = null;  // Clear selection when typing
        this.show();
    }

    /**
     * Handle keyboard navigation
     */
    private handleKeydown(e: KeyboardEvent): void {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (!this.isOpen) { this.show(); break; }
                this.navigateList(1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.navigateList(-1);
                break;
            case 'Enter':
                e.preventDefault();
                // Nobody in the narrowed scope, matches in the whole tree: Enter searches there (spec 137 §3).
                if (this.isOpen && this.narrowedEmpty()) {
                    setSearchScope('tree');
                    break;
                }
                if (this.selectedIndex >= 0 && this.filteredPersons[this.selectedIndex]) {
                    this.selectPerson(this.filteredPersons[this.selectedIndex].id);
                } else if (this.filteredPersons.length > 0) {
                    this.selectPerson(this.filteredPersons[0].id);
                }
                break;
            case 'Escape':
                // If dropdown is open, close it and stop propagation
                // Otherwise, let ESC propagate to document handler for modal closing
                if (this.isOpen) {
                    this.hide();
                    e.stopPropagation();
                }
                break;
            case 'Tab':
                // Open with a scope head: Tab goes to the segment in effect (spec 137 §1.4).
                if (this.head && this.isOpen && !e.shiftKey) {
                    const seg = this.head.querySelector<HTMLButtonElement>('[data-scope][aria-checked="true"]');
                    if (seg) {
                        e.preventDefault();
                        seg.focus();
                        break;
                    }
                }
                this.hide();
                break;
            case 'ArrowLeft':
            case 'ArrowRight':
                // Alt+←/→: the previous or next offered scope, the focus staying in the field.
                if (this.head && this.isOpen && e.altKey && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    setSearchScope(stepScope(getSearchScope(), this.currentSets(), e.key === 'ArrowLeft' ? -1 : 1));
                }
                break;
        }
    }

    /** The narrowed scopes' people (both null before they are worked out or without a scope). */
    private currentSets(): ScopeSets {
        return this.scopeSets ?? { line: null, view: null };
    }

    /** Work out the people of the direct line and of the view (on opening, a change of the scope or of the view). */
    private computeScopeSets(): void {
        const src = this.options.scope;
        if (!src) { this.scopeSets = null; return; }
        const data = this.searchData();
        const ref = src.refPersonId();
        const person = ref && data ? data.persons[ref] : undefined;
        let revision: number | undefined;
        if (!this.options.data) {
            try { revision = DataManager.getRevision(); } catch { revision = undefined; }
        }
        const line = person && !person.isPlaceholder && data ? directLineIds(data, person.id, revision) : null;
        this.scopeSets = { line, view: src.viewPersonIds() };
    }

    /**
     * The view or the centre changed (spec 137 §2.5): an open list works out
     * its sets and draws anew; a closed one only forgets them.
     */
    refreshScope(): void {
        if (!this.options.scope) return;
        if (!this.isOpen) { this.scopeSets = null; return; }
        this.computeScopeSets();
        this.renderDropdown();
    }

    /** Nobody in the narrowed scope while the whole tree has matches. */
    private narrowedEmpty(): boolean {
        return !!this.head && this.filteredPersons.length === 0 && this.wholeCount > 0
            && effectiveScope(getSearchScope(), this.currentSets()) !== 'tree';
    }

    /**
     * Navigate through list items
     */
    private navigateList(direction: number): void {
        const maxIndex = this.filteredPersons.length - 1;
        if (maxIndex < 0) return;

        let newIndex = this.selectedIndex + direction;
        if (newIndex < 0) newIndex = maxIndex;
        if (newIndex > maxIndex) newIndex = 0;

        this.selectedIndex = newIndex;
        this.updateSelection();
    }

    /**
     * Update visual selection in dropdown
     */
    private updateSelection(): void {
        const items = this.dropdown.querySelectorAll('.person-picker-item');
        items.forEach((item, index) => {
            item.classList.toggle('selected', index === this.selectedIndex);
            item.setAttribute('aria-selected', String(index === this.selectedIndex));
            if (index === this.selectedIndex) {
                item.scrollIntoView({ block: 'nearest' });
            }
        });
    }

    /**
     * Select a person
     */
    private selectPerson(personId: PersonId): void {
        const person = this.allPersons.find(p => p.id === personId);
        if (!person) return;

        this.selectedPersonId = personId;
        this.input.value = this.formatPersonName(person);
        this.hide();
        this.options.onSelect(personId);
    }

    /** Tree data used to resolve other surname forms while searching. */
    private searchData(): StromData | null {
        if (this.options.data) return this.options.data;
        try {
            return DataManager.getData();
        } catch {
            return null;
        }
    }

    /**
     * Render dropdown items
     */
    private renderDropdown(): void {
        const query = this.input.value.trim();
        const data = this.searchData();
        const whole = filterAndSort(query, this.allPersons, data, !!this.options.searchDetails);
        this.wholeCount = whole.length;
        // The scope narrows the matches (a Set lookup per row): the direct line or the view.
        const narrow = this.head ? narrowIds(getSearchScope(), this.currentSets()) : null;
        this.filteredPersons = narrow ? whole.filter(p => narrow.has(p.id)) : whole;
        // Same names of the whole result are counted now; each row's line is worked out when it is drawn.
        this.distinguisher = new PickerDistinguisher(this.filteredPersons, data, !!this.options.showBirthYear,
            person => htmlToText(this.matchHtml(person)));
        this.selectedIndex = -1;
        this.displayedCount = BATCH_SIZE;
        this.renderHead();
        this.list.scrollTop = 0;

        if (this.narrowedEmpty()) {
            // Nobody here, someone in the whole tree (spec 137 §3): say so, with the way there.
            const S = strings.searchScope;
            const text = effectiveScope(getSearchScope(), this.currentSets()) === 'line' ? S.emptyLine(this.wholeCount) : S.emptyView(this.wholeCount);
            this.list.innerHTML = `<div class="person-picker-narrow-empty">${escHtml(text)}<br>`
                + `<button type="button" class="link-button person-picker-whole">${escHtml(S.searchWhole)}</button></div>`;
            const btn = this.list.querySelector<HTMLButtonElement>('.person-picker-whole');
            btn?.addEventListener('pointerdown', e => e.preventDefault());
            btn?.addEventListener('mousedown', e => e.preventDefault());
            btn?.addEventListener('click', (e) => {
                e.stopPropagation();
                setSearchScope('tree');
                this.input.focus();
            });
            return;
        }
        if (this.filteredPersons.length === 0) {
            this.list.innerHTML = `
                <div class="person-picker-empty">${strings.personPicker.noResults}</div>
            `;
            return;
        }

        this.renderItems();
        this.attachScrollListener();
    }

    /** The scope head's state now (renderScopeHead). */
    private renderHead(): void {
        const src = this.options.scope;
        if (!this.head || !src) return;
        const data = this.searchData();
        const ref = src.refPersonId();
        renderScopeHead(this.head, {
            sets: this.currentSets(),
            refPerson: ref && data ? data.persons[ref] ?? null : null,
            refKind: src.refKind(),
            viewLabel: src.viewLabel(),
            count: this.filteredPersons.length,
        });
    }

    /**
     * Render currently visible items
     */
    private renderItems(): void {
        const itemsToShow = this.filteredPersons.slice(0, this.displayedCount);
        const hasMore = this.displayedCount < this.filteredPersons.length;

        this.list.innerHTML = itemsToShow
            .map((person, index) => this.renderItem(person, index))
            .join('') + (hasMore ? '<div class="person-picker-loading">…</div>' : '');

        // Attach click listeners
        this.list.querySelectorAll<HTMLElement>('.person-picker-rowact').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.closest<HTMLElement>('.person-picker-item')?.dataset.id as PersonId | undefined;
                const person = id ? this.allPersons.find(p => p.id === id) : undefined;
                const run = person ? this.options.rowNote?.(person)?.action?.run : undefined;
                this.hide();
                this.clear();
                if (id && run) run(id);
            });
        });
        this.list.querySelectorAll('.person-picker-item').forEach(item => {
            item.addEventListener('click', () => {
                const personId = item.getAttribute('data-id') as PersonId;
                if (personId) {
                    this.selectPerson(personId);
                }
            });
        });
    }

    /**
     * Attach scroll listener for lazy loading
     */
    private attachScrollListener(): void {
        this.list.onscroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = this.list;
            // Load more when scrolled near bottom (within 50px)
            if (scrollTop + clientHeight >= scrollHeight - 50) {
                this.loadMore();
            }
        };
    }

    /**
     * Load more items
     */
    private loadMore(): void {
        if (this.displayedCount >= this.filteredPersons.length) return;

        this.displayedCount += BATCH_SIZE;
        this.renderItems();
    }

    /**
     * Render a single item: the name (with the birth year when shown) and,
     * under it, at most one quiet row — what tells it apart from rows of the
     * same name, what it was found by, or both on one row.
     */
    private renderItem(person: Person, index: number): string {
        // The list shows the name with its titles; the input keeps the bare
        // name (formatPersonName), which is what the search matches.
        const year = this.options.showBirthYear && person.birthDate ? person.birthDate.split('-')[0] : '';
        const birthYear = year ? `<span class="birth-year">(*${this.escapeHtml(year)})</span>` : '';
        const match = this.matchHtml(person);
        const dist = this.distinguisher?.line(person) ?? null;
        let below = match;
        let label = '';
        if (dist) {
            const inline = match
                ? ` · ${match.replace(/^<div class="person-picker-match">/, '<span class="person-picker-match">').replace(/<\/div>$/, '</span>')}`
                : '';
            below = `<div class="person-picker-dist">${this.escapeHtml(dist)}${inline}</div>`;
            const matchText = htmlToText(match);
            const parts = shownNameParts(person, '');
            const note = birthNoteText(parts.birthNote);
            const name = shownName(person) + (note ? ` (${note})` : '') + (year ? ` (*${year})` : '');
            label = `${name}, ${dist}${matchText ? ` · ${matchText}` : ''}`;
        }
        const selected = index === this.selectedIndex;
        const note = this.options.rowNote?.(person) ?? null;
        if (note && label) label = `${label} · ${note.tag}`;
        const labelAttrs = label
            ? ` aria-label="${this.escapeHtml(label)}" title="${this.escapeHtml(label)}"`
            : '';
        const tag = note ? ` <span class="tagx person-picker-tagx">${this.escapeHtml(note.tag)}</span>` : '';
        const act = note?.action
            ? `<button type="button" class="map-link person-picker-rowact">${this.escapeHtml(note.action.label)}</button>` : '';

        return `
            <div class="person-picker-item sel-opt${selected ? ' selected' : ''}${dist ? ' has-dist' : ''}${note ? ' has-note' : ''}" data-sel-form="row" role="option" aria-selected="${selected}"${labelAttrs}
                 data-id="${this.escapeHtml(person.id)}">
                <span class="person-picker-name"><span class="person-picker-nm">${nameHtml(person)}</span> ${birthYear}${tag}</span>${below}${act}
            </div>
        `;
    }

    /** The row's found-by line (a hidden surname, a cause or a house), '' for none. */
    private matchHtml(person: Person): string {
        return this.hiddenSurnameMatchHtml(person) + this.detailMatchHtml(person);
    }

    /** Found by the surname the shown name leaves out (hiddenSurnameMatchHtml). */
    private hiddenSurnameMatchHtml(person: Person): string {
        return hiddenSurnameMatchHtml(person, this.input.value, this.searchData());
    }

    /**
     * Found by a cause or a house rather than the name: say so under the name,
     * the matching words marked — "† 1866 Horní Lhota · cholera".
     */
    private detailMatchHtml(person: Person): string {
        if (!this.options.searchDetails) return '';
        const query = normalizeText(this.input.value.trim());
        if (!query || calculateMatchScore(person, query, this.searchData()) > 0) return '';
        const m = detailMatch(person, query, this.searchData());
        if (!m) return '';
        // A couple's event found by its name: the name is the marked part.
        const mark = m.label !== undefined
            ? (m.label === m.value ? '' : m.label)
            : m.type === 'death' ? '†' : m.type === 'birth' ? '*' : strings.events.types[m.type];
        const head = [mark, displayYear(m.date), m.place?.trim() === m.value ? '' : m.place?.trim() ?? '']
            .filter(Boolean).join(' ');
        return `<div class="person-picker-match">${this.escapeHtml(head)} · <mark>${this.escapeHtml(m.value)}</mark></div>`;
    }

    /**
     * Format person name for display
     */
    private formatPersonName(person: Person): string {
        return `${person.firstName} ${person.lastName}`.trim();
    }

    /**
     * Escape HTML
     */
    private escapeHtml(text: string): string {
        // Must also escape quotes: callers interpolate into HTML attributes.
        return (text || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /**
     * Focus the search input
     */
    focusInput(): void {
        this.input.focus();
    }

    /**
     * Destroy the picker
     */
    destroy(): void {
        if (this.outsideClickHandler) {
            document.removeEventListener('click', this.outsideClickHandler);
            this.outsideClickHandler = null;
        }
        this.offScope?.();
        this.offScope = null;
        this.container.innerHTML = '';
    }
}

/** The multi-person mode (assigning a file to several people): chips of the chosen, a search, a list with checkboxes. */
export interface MultiPersonPickerOptions {
    /** The host: by id, or the element itself (a dialog's rows written as markup). */
    containerId?: string;
    container?: HTMLElement;
    multi: true;
    persons?: Person[];
    data?: StromData;
    placeholder?: string;
    /** At most this many chosen (default 50). */
    max?: number;
    /** Why a person cannot be chosen (said under the name; null: they can). */
    blocked?: (person: Person) => string | null;
    /** Already there for everything asked: shown ticked and not changeable. */
    fixed?: (person: Person) => boolean;
    onChange?: (ids: PersonId[]) => void;
    /** Texts: the empty chips line, a chip's ×, the note at the limit, a fixed row's title. */
    noneLabel: string;
    removeLabel: (name: string) => string;
    maxLabel?: (max: number) => string;
    fixedLabel?: string;
    /**
     * The fixed people named above the list (each with `fixedLabel`, without
     * ×), in this order: the chips line never says "Nobody yet" beside them.
     */
    fixedChips?: PersonId[];
    /** Chosen at the start (in this order). */
    initial?: PersonId[];
    /** At most this many chips, then "+ N more" (moreLabel); default all. */
    chipsShown?: number;
    moreLabel?: (n: number) => string;
    /** The search scope (spec 137 §1.5): the same head as PersonPicker's above the list. */
    scope?: PickerScopeSource;
}

const MULTI_BATCH = 100;

export class MultiPersonPicker {
    private options: MultiPersonPickerOptions;
    private container: HTMLElement;
    private chips!: HTMLElement;
    private input!: HTMLInputElement;
    private list!: HTMLElement;
    private note!: HTMLElement;
    private allPersons: Person[];
    private filtered: Person[] = [];
    private shown = MULTI_BATCH;
    private chosen: PersonId[] = [];
    private head: HTMLElement | null = null;
    private scopeSets: ScopeSets = { line: null, view: null };
    private wholeCount = 0;
    private offScope: (() => void) | null = null;

    constructor(options: MultiPersonPickerOptions) {
        this.options = { max: 50, ...options };
        const container = options.container ?? (options.containerId ? document.getElementById(options.containerId) : null);
        if (!container) throw new Error(`Container not found: ${options.containerId ?? ''}`);
        this.container = container;
        this.allPersons = options.persons ?? DataManager.getAllPersons();
        const known = new Set(this.allPersons.map(p => p.id));
        this.chosen = (options.initial ?? []).filter((id, i, all) => known.has(id) && all.indexOf(id) === i);
        this.build();
    }

    private build(): void {
        this.container.innerHTML = '';
        this.container.className = 'person-picker person-picker--multi';
        this.chips = document.createElement('div');
        this.chips.className = 'ppm-chips';
        this.chips.setAttribute('aria-live', 'polite');
        this.input = document.createElement('input');
        this.input.type = 'search';
        this.input.className = 'person-picker-input ppm-search';
        this.input.placeholder = this.options.placeholder ?? strings.personPicker.placeholder;
        this.input.setAttribute('aria-label', this.input.placeholder);
        this.input.autocomplete = 'off';
        this.input.setAttribute('autocapitalize', 'off');
        this.input.setAttribute('autocorrect', 'off');
        this.input.spellcheck = false;
        this.list = document.createElement('div');
        this.list.className = 'ppm-list';
        this.list.setAttribute('role', 'group');
        this.note = document.createElement('div');
        this.note.className = 'ppm-note';
        this.note.hidden = true;
        this.container.append(this.chips, this.input, this.list, this.note);
        if (this.options.scope) {
            this.head = buildScopeHead();
            this.head.classList.add('ppm-head');
            this.container.insertBefore(this.head, this.list);
            wireScopeHead(this.head, this.input, () => this.scopeSets);
            this.computeScopeSets();
            this.offScope = onSearchScope(() => {
                // A picker whose dialog went without destroy() stops listening.
                if (!this.container.isConnected) { this.offScope?.(); this.offScope = null; return; }
                this.computeScopeSets();
                this.shown = MULTI_BATCH;
                this.renderList();
            });
            this.input.addEventListener('keydown', (e) => {
                if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.altKey && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    setSearchScope(stepScope(getSearchScope(), this.scopeSets, e.key === 'ArrowLeft' ? -1 : 1));
                } else if (e.key === 'Enter' && this.narrowedEmpty()) {
                    e.preventDefault();
                    setSearchScope('tree');
                }
            });
        }
        this.input.addEventListener('input', () => { this.shown = MULTI_BATCH; this.renderList(); });
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.list.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
            }
        });
        this.list.addEventListener('change', (e) => {
            const box = e.target as HTMLInputElement;
            const id = box.closest<HTMLElement>('[data-id]')?.dataset.id as PersonId | undefined;
            if (id) this.toggle(id, box.checked);
        });
        this.list.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            const boxes = Array.from(this.list.querySelectorAll<HTMLInputElement>('input:not(:disabled)'));
            const i = boxes.indexOf(document.activeElement as HTMLInputElement);
            if (i < 0) return;
            e.preventDefault();
            if (e.key === 'ArrowUp' && i === 0) { this.input.focus(); return; }
            boxes[Math.min(boxes.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
        });
        this.list.addEventListener('scroll', () => {
            const { scrollTop, scrollHeight, clientHeight } = this.list;
            if (scrollTop + clientHeight >= scrollHeight - 60 && this.shown < this.filtered.length) {
                this.shown += MULTI_BATCH;
                this.renderList(false);
            }
        });
        this.chips.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-remove]');
            if (btn) this.toggle(btn.dataset.remove as PersonId, false);
        });
        this.renderChips();
        this.renderList();
    }

    private searchData(): StromData | null {
        if (this.options.data) return this.options.data;
        try { return DataManager.getData(); } catch { return null; }
    }

    private esc(text: string): string {
        return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    private full(): boolean {
        return this.chosen.length >= (this.options.max ?? 50);
    }

    private toggle(id: PersonId, on: boolean): void {
        const person = this.allPersons.find(p => p.id === id);
        if (!person || this.options.blocked?.(person) || this.options.fixed?.(person)) return;
        const has = this.chosen.includes(id);
        if (on && !has && !this.full()) this.chosen.push(id);
        else if (!on && has) this.chosen = this.chosen.filter(x => x !== id);
        this.renderChips();
        this.renderList(false);
        this.options.onChange?.([...this.chosen]);
    }

    private renderChips(): void {
        const fixedChips = (this.options.fixedChips ?? []).flatMap(id => {
            const p = this.allPersons.find(x => x.id === id);
            if (!p) return [];
            const name = `${p.firstName} ${p.lastName}`.trim();
            const mark = this.options.fixedLabel ? `<span class="ppm-chip-mark">${this.esc(this.options.fixedLabel)}</span>` : '';
            return [`<span class="ppm-chip ppm-chip--fixed">${this.esc(name)}${mark}</span>`];
        }).join('');
        if (this.chosen.length === 0) {
            this.chips.innerHTML = fixedChips || `<span class="ppm-none">${this.esc(this.options.noneLabel)}</span>`;
            return;
        }
        const limit = this.options.chipsShown ?? Infinity;
        const shown = this.chosen.length > limit ? this.chosen.slice(0, limit) : this.chosen;
        const rest = this.chosen.length - shown.length;
        this.chips.innerHTML = fixedChips + shown.map(id => {
            const p = this.allPersons.find(x => x.id === id);
            const name = p ? `${p.firstName} ${p.lastName}`.trim() : id;
            return `<span class="ppm-chip">${this.esc(name)}<button type="button" class="ppm-chip-x" data-remove="${this.esc(id)}" aria-label="${this.esc(this.options.removeLabel(name))}">&times;</button></span>`;
        }).join('') + (rest > 0 && this.options.moreLabel ? `<span class="ppm-chip ppm-chip--more">${this.esc(this.options.moreLabel(rest))}</span>` : '');
    }

    /** The people of the direct line and of the view (spec 137 §0.2): on building and on a change of the scope. */
    private computeScopeSets(): void {
        const src = this.options.scope;
        if (!src) return;
        const data = this.searchData();
        const ref = src.refPersonId();
        const person = ref && data ? data.persons[ref] : undefined;
        let revision: number | undefined;
        if (!this.options.data) {
            try { revision = DataManager.getRevision(); } catch { revision = undefined; }
        }
        const line = person && !person.isPlaceholder && data ? directLineIds(data, person.id, revision) : null;
        this.scopeSets = { line, view: src.viewPersonIds() };
    }

    private narrowedEmpty(): boolean {
        return !!this.head && this.filtered.length === 0 && this.wholeCount > 0
            && effectiveScope(getSearchScope(), this.scopeSets) !== 'tree';
    }

    private renderList(refilter = true): void {
        if (refilter) {
            const whole = filterAndSort(this.input.value, this.allPersons, this.searchData());
            this.wholeCount = whole.length;
            const narrow = this.head ? narrowIds(getSearchScope(), this.scopeSets) : null;
            this.filtered = narrow ? whole.filter(p => narrow.has(p.id)) : whole;
        }
        const src = this.options.scope;
        if (this.head && src) {
            const data = this.searchData();
            const ref = src.refPersonId();
            renderScopeHead(this.head, {
                sets: this.scopeSets, refPerson: ref && data ? data.persons[ref] ?? null : null,
                refKind: src.refKind(), viewLabel: src.viewLabel(), count: this.filtered.length,
            });
        }
        const scroll = this.list.scrollTop;
        if (this.narrowedEmpty()) {
            const S = strings.searchScope;
            const text = effectiveScope(getSearchScope(), this.scopeSets) === 'line' ? S.emptyLine(this.wholeCount) : S.emptyView(this.wholeCount);
            this.list.innerHTML = `<div class="person-picker-narrow-empty">${this.esc(text)}<br>`
                + `<button type="button" class="link-button person-picker-whole">${this.esc(S.searchWhole)}</button></div>`;
            this.list.querySelector<HTMLButtonElement>('.person-picker-whole')?.addEventListener('click', () => {
                setSearchScope('tree');
                this.input.focus();
            });
        } else if (this.filtered.length === 0) {
            this.list.innerHTML = `<div class="person-picker-empty">${strings.personPicker.noResults}</div>`;
        } else {
            const full = this.full();
            this.list.innerHTML = this.filtered.slice(0, this.shown).map(p => {
                const why = this.options.blocked?.(p) ?? null;
                const fixed = !why && !!this.options.fixed?.(p);
                const on = fixed || this.chosen.includes(p.id);
                const off = !!why || fixed || (full && !on);
                const year = p.birthDate ? ` <span class="birth-year">(*${this.esc(p.birthDate.split('-')[0])})</span>` : '';
                const cls = `ppm-row${why ? ' is-blocked' : ''}${fixed ? ' is-fixed' : ''}`;
                const title = fixed && this.options.fixedLabel ? ` title="${this.esc(this.options.fixedLabel)}"` : '';
                return `<label class="${cls}" data-id="${this.esc(p.id)}"${title}>
                    <input type="checkbox" class="ppm-check"${on ? ' checked' : ''}${off ? ' disabled' : ''}>
                    <span class="ppm-text"><span class="ppm-name">${nameHtml(p)}${year}</span>${why ? `<span class="ppm-why">${this.esc(why)}</span>` : ''}</span>
                </label>`;
            }).join('');
        }
        this.list.scrollTop = scroll;
        const max = this.options.max ?? 50;
        this.note.hidden = !this.full() || !this.options.maxLabel;
        this.note.textContent = this.full() && this.options.maxLabel ? this.options.maxLabel(max) : '';
    }

    /** The chosen people (in the order chosen). */
    getValue(): PersonId[] {
        return [...this.chosen];
    }

    focusInput(): void {
        this.input.focus();
    }

    destroy(): void {
        this.offScope?.();
        this.offScope = null;
        this.container.innerHTML = '';
    }
}

/**
 * The path mode (Migration over time, spec 054 §1): choose the person the
 * ancestors' path runs to. A title with a close button, a search field and
 * at most `limit` rows — no list of everyone (a big tree has thousands); an
 * empty field shows the last focused person. Each row says how many
 * ancestors are on the map; a person with none is greyed out and cannot be
 * chosen. The counts are asked lazily, only for the rows shown (the caller
 * caches them by id).
 */
export interface PathPersonPickerOptions {
    mode: 'path';
    container: HTMLElement;
    persons?: Person[];
    data?: StromData;
    /** The person in the tree's focus ("Last focused" on an empty field). */
    recentId?: PersonId | null;
    /** The person chosen now (its row highlighted). */
    selectedId?: PersonId | null;
    /** Distinct ancestors on the map of a person (0 = cannot be chosen). */
    onMapCount: (id: PersonId) => number;
    onSelect: (id: PersonId) => void;
    onClose: () => void;
    /** At most this many found rows (default 30). */
    limit?: number;
}

export class PathPersonPicker {
    private options: PathPersonPickerOptions;
    private container: HTMLElement;
    private input!: HTMLInputElement;
    private list!: HTMLElement;
    private allPersons: Person[];
    private rows: { person: Person; count: number }[] = [];

    constructor(options: PathPersonPickerOptions) {
        this.options = { limit: 30, ...options };
        this.container = options.container;
        this.allPersons = (options.persons ?? DataManager.getAllPersons()).filter(p => !p.isPlaceholder);
        this.build();
    }

    private esc(text: string): string {
        return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    private searchData(): StromData | null {
        if (this.options.data) return this.options.data;
        try { return DataManager.getData(); } catch { return null; }
    }

    private build(): void {
        const m = strings.map;
        this.container.classList.add('path-picker');
        this.container.innerHTML = `
            <div class="path-picker-head">
                <div class="path-picker-title-row">
                    <span class="path-picker-title" id="path-picker-title">${this.esc(m.pathPickTitle)}</span>
                    <button type="button" class="path-picker-close" aria-label="${this.esc(strings.buttons.close)}" title="${this.esc(strings.buttons.close)}">&times;</button>
                </div>
                <label class="path-picker-field">
                    <span class="path-picker-glass" aria-hidden="true">⌕</span>
                    <input type="search" class="path-picker-input" placeholder="${this.esc(m.pathPickPlaceholder)}" aria-label="${this.esc(m.pathPickPlaceholder)}"
                           autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
                </label>
            </div>
            <div class="path-picker-body">
                <div class="path-picker-list" role="listbox" aria-labelledby="path-picker-title"></div>
                <div class="path-picker-foot">${this.esc(m.pathPickWholeTree)}</div>
            </div>`;
        this.input = this.container.querySelector('.path-picker-input') as HTMLInputElement;
        this.list = this.container.querySelector('.path-picker-list') as HTMLElement;
        this.container.querySelector('.path-picker-close')?.addEventListener('click', () => this.options.onClose());
        this.input.addEventListener('input', () => this.render());
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const first = this.rows.find(r => r.count > 0);
                if (first) this.options.onSelect(first.person.id);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.rowEls()[0]?.focus();
            }
        });
        this.container.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.options.onClose();
            }
        });
        this.list.addEventListener('click', (e) => {
            const row = (e.target as HTMLElement).closest<HTMLElement>('.path-picker-row');
            if (!row || row.getAttribute('aria-disabled') === 'true') return;
            this.options.onSelect(row.dataset.id as PersonId);
        });
        this.list.addEventListener('keydown', (e) => {
            const rows = this.rowEls();
            const i = rows.indexOf(document.activeElement as HTMLElement);
            if (i < 0) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (e.key === 'ArrowUp' && i === 0) { this.input.focus(); return; }
                rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
            }
        });
        this.render();
    }

    private rowEls(): HTMLElement[] {
        return Array.from(this.list.querySelectorAll<HTMLElement>('.path-picker-row'));
    }

    private render(): void {
        const m = strings.map;
        const query = this.input.value.trim();
        let found: Person[];
        if (query) {
            found = filterAndSort(query, this.allPersons, this.searchData()).slice(0, this.options.limit);
        } else {
            const recent = this.options.recentId ? this.allPersons.find(p => p.id === this.options.recentId) : undefined;
            found = recent ? [recent] : [];
        }
        this.rows = found.map(person => ({ person, count: this.options.onMapCount(person.id) }));
        const head = query ? `${m.pathPickFound} (${this.rows.length})` : m.pathPickRecent;
        const rowsHtml = this.rows.map(({ person, count }) => {
            const year = person.birthDate ? person.birthDate.split('-')[0] : '';
            const off = count === 0;
            const sub = [year ? `* ${year}` : '', off ? m.pathPickNone : m.pathPickOnMap(count)].filter(Boolean).join(' · ');
            const chosen = person.id === this.options.selectedId;
            return `<div class="path-picker-row sel-opt${off ? ' is-off' : ''}${chosen ? ' is-chosen' : ''}" data-sel-form="row" role="option" tabindex="${off ? -1 : 0}"
                        data-id="${this.esc(person.id)}" aria-selected="${chosen}" aria-disabled="${off}">
                    <span class="path-picker-name">${nameHtml(person)}</span>
                    <span class="path-picker-sub">${this.esc(sub)}</span>
                </div>`;
        }).join('');
        this.list.innerHTML = (this.rows.length || query ? `<div class="path-picker-group">${this.esc(head)}</div>` : '')
            + (rowsHtml || (query ? `<div class="person-picker-empty">${this.esc(strings.personPicker.noResults)}</div>` : ''));
        this.list.querySelectorAll<HTMLElement>('.path-picker-row').forEach(row => {
            row.addEventListener('keydown', (e) => {
                if ((e.key === 'Enter' || e.key === ' ') && row.getAttribute('aria-disabled') !== 'true') {
                    e.preventDefault();
                    this.options.onSelect(row.dataset.id as PersonId);
                }
            });
        });
    }

    focusInput(): void {
        this.input.focus();
    }

    destroy(): void {
        this.container.innerHTML = '';
        this.container.classList.remove('path-picker');
    }
}
