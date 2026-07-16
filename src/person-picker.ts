/**
 * PersonPicker - Smart person selection component
 * Replaces plain <select> elements with searchable dropdown
 */

import { Person, PersonId } from './types.js';
import { strings } from './strings.js';
import { DataManager } from './data.js';

/**
 * Normalize text for search - removes diacritics and converts to lowercase
 */
function normalizeText(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');  // Remove diacritics
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
function calculateMatchScore(person: Person, query: string): number {
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

    // Birth year match
    const birthYear = person.birthDate?.split('-')[0] || '';
    if (birthYear && birthYear.includes(query)) return 30;

    return 0;  // No match
}

/**
 * Filter and sort persons based on search query
 */
function filterAndSort(query: string, persons: Person[]): Person[] {
    const normalized = normalizeText(query.trim());

    if (!normalized) {
        // Empty query - return all sorted alphabetically
        return [...persons].sort(sortByName);
    }

    // Score and filter matching persons
    return persons
        .map(p => ({
            person: p,
            score: calculateMatchScore(p, normalized)
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

export interface PersonPickerOptions {
    containerId: string;
    onSelect: (personId: PersonId) => void;
    filter?: (person: Person) => boolean;
    placeholder?: string;
    showBirthYear?: boolean;
    persons?: Person[];
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
        this.container.appendChild(this.input);

        // Toggle button
        this.toggleBtn = document.createElement('button');
        this.toggleBtn.type = 'button';
        this.toggleBtn.className = 'person-picker-toggle';
        this.toggleBtn.innerHTML = '&#9662;';  // Down arrow
        this.container.appendChild(this.toggleBtn);

        // Dropdown
        this.dropdown = document.createElement('div');
        this.dropdown.className = 'person-picker-dropdown';
        this.container.appendChild(this.dropdown);

        // Event listeners
        this.input.addEventListener('input', () => this.handleInput());
        this.input.addEventListener('focus', () => this.show());
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
                this.navigateList(1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.navigateList(-1);
                break;
            case 'Enter':
                e.preventDefault();
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
                this.hide();
                break;
        }
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

    /**
     * Render dropdown items
     */
    private renderDropdown(): void {
        const query = this.input.value.trim();
        this.filteredPersons = filterAndSort(query, this.allPersons);
        this.selectedIndex = -1;
        this.displayedCount = BATCH_SIZE;

        if (this.filteredPersons.length === 0) {
            this.dropdown.innerHTML = `
                <div class="person-picker-empty">${strings.personPicker.noResults}</div>
            `;
            return;
        }

        this.renderItems();
        this.attachScrollListener();
    }

    /**
     * Render currently visible items
     */
    private renderItems(): void {
        const itemsToShow = this.filteredPersons.slice(0, this.displayedCount);
        const hasMore = this.displayedCount < this.filteredPersons.length;

        this.dropdown.innerHTML = itemsToShow
            .map((person, index) => this.renderItem(person, index))
            .join('') + (hasMore ? '<div class="person-picker-loading">...</div>' : '');

        // Attach click listeners
        this.dropdown.querySelectorAll('.person-picker-item').forEach(item => {
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
        this.dropdown.onscroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = this.dropdown;
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
     * Render a single item
     */
    private renderItem(person: Person, index: number): string {
        const name = this.formatPersonName(person);
        const birthYear = this.options.showBirthYear && person.birthDate
            ? `<span class="birth-year">(*${person.birthDate.split('-')[0]})</span>`
            : '';

        return `
            <div class="person-picker-item${index === this.selectedIndex ? ' selected' : ''}"
                 data-id="${person.id}">
                ${this.escapeHtml(name)} ${birthYear}
            </div>
        `;
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
        this.container.innerHTML = '';
    }
}
