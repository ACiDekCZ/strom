/**
 * Context menu shown when clicking a person card, plus the shared per-person
 * action model (also used by the bottom sheet — see bottom-sheet.ts).
 * The action LIST and the DISPATCH are shared; only the markup differs.
 * Split from the original UIClass; see src/ui/module.ts for the pattern.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import { PersonId, RelationType } from '../types.js';
import { uiModule } from './module.js';
import { isCoarsePointer } from './bottom-sheet.js';
import { isTabletOrMobile } from '../breakpoints.js';
import { fitFlyout, FLYOUT_MARGIN } from './flyout.js';

/** One entry in the person action menu (context menu / bottom sheet). */
export interface PersonMenuAction {
    action: string;
    label: string;
    danger?: boolean;
    /** Render a divider before this item (starts a new group). */
    divider?: boolean;
    /** Quiet right-aligned detail (the number of sources). */
    meta?: string;
    /** Accessible name when the visible label and meta read badly together. */
    ariaLabel?: string;
    /** A section heading rendered before this item (not clickable). */
    header?: string;
    /** "ai": the AI label (the action starts a paid agent). */
    badge?: 'ai';
    /** Continues outside the app (↗). */
    external?: boolean;
    /** A small warm label at the end ("1 conflict"). */
    tag?: string;
    /** It is already so (quiet look, a green word at the end: "already running"). */
    state?: string;
    /** A small line under the label ("Paused · restart"). */
    note?: string;
    /** Opens a second level (desktop flyout, bottom-sheet page). */
    submenu?: PersonMenuAction[];
    /** A grid of buttons instead of a row (the "Add" group). */
    chips?: PersonMenuAction[];
}

/**
 * A second level of the person menu, or what stands in for it: nothing for
 * no items, the item itself for one (a submenu of one is not worth the
 * click), else a row that opens them — carrying the tag of "What the
 * research knows", so the count does not hide behind the chevron.
 */
export function submenuRow(action: string, label: string, items: PersonMenuAction[]): PersonMenuAction[] {
    if (items.length === 0) return [];
    if (items.length === 1) return [{ ...items[0], divider: false, header: undefined }];
    const tag = items.find(i => i.action === 'research-knows')?.tag;
    return [{ action, label, submenu: items, tag, ariaLabel: tag ? `${label}, ${tag}` : undefined }];
}

/** A group of rows: a divider before the first. */
function group(items: PersonMenuAction[]): PersonMenuAction[] {
    return items.map((a, i) => (i === 0 ? { ...a, divider: true } : a));
}

/** Label (+ the quiet right-aligned meta, AI label, ↗) of a person menu item, escaped. */
export function menuItemBody(a: PersonMenuAction): string {
    const e = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const tail = (a.meta ? `<span class="menu-item-meta" aria-hidden="true">${e(a.meta)}</span>` : '')
        + (a.tag ? `<span class="menu-item-tag" aria-hidden="true">${e(a.tag)}</span>` : '')
        + (a.badge === 'ai'
            ? `<span class="research-ai-badge menu-item-badge" title="${e(strings.research.aiCostHint)}" aria-hidden="true">${e(strings.research.aiBadge)}</span>`
            : '')
        + (a.state ? `<span class="menu-item-state">${e(a.state)}</span>` : '')
        + (a.external ? '<span class="menu-item-ext" aria-hidden="true">↗</span>' : '')
        + (a.submenu ? '<span class="menu-item-chev" aria-hidden="true">›</span>' : '');
    const label = a.note ? `${e(a.label)}<span class="menu-item-note">${e(a.note)}</span>` : e(a.label);
    return tail || a.note ? `<span class="menu-item-label">${label}</span>${tail}` : label;
}

/** ` aria-label="…"` when the item carries one. */
export function menuItemAria(a: PersonMenuAction): string {
    return a.ariaLabel ? ` aria-label="${a.ariaLabel.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"` : '';
}

export const contextMenuMethods = uiModule({
    /**
     * The per-person actions, depending on view/lock state. Both the desktop
     * context menu and the bottom sheet build their markup from this.
     * Groups: the person itself (focus / edit / sources / story / descendants)
     * → "Add" (a grid of buttons) → kinship and archives → "Research ›" and
     * "More ›" (lock, merge, delete) — about ten rows on the first level.
     */
    getPersonMenuActions(personId: PersonId): PersonMenuAction[] {
        const person = DataManager.getPerson(personId);
        if (!person) return [];
        const c = strings.contextMenu;
        // Read-only: an embedded file's view mode or locked local data.
        const isViewMode = DataManager.isReadOnly();
        const isPersonLocked = DataManager.isPersonLocked(personId);
        const isTreeLocked = DataManager.isTreeLocked();

        // Looking at the person's sources and story without opening the edit
        // form. Read-only / locked: only when there is something to show; in
        // normal mode "Sources" always (its dialog is the quick way to cite).
        const sourceCount = this.personSourceCount(personId);
        const hasStory = !!person.story?.text?.trim();
        const readItems = (always: boolean): PersonMenuAction[] => {
            const out: PersonMenuAction[] = [];
            if (always || sourceCount > 0) {
                out.push({
                    action: 'sources', label: c.showSources,
                    meta: sourceCount > 0 ? String(sourceCount) : undefined,
                    ariaLabel: sourceCount > 0 ? strings.personSources.countSr(sourceCount) : undefined,
                });
            }
            if (hasStory) out.push({ action: 'story', label: c.showStory });
            return out;
        };

        // "Research ›": what the research knows, then its actions — on every
        // variant of the menu (nothing there changes the app).
        const knows = this.personResearchKnows(personId);
        const researchActions = this.personResearchActions(personId);
        // Files about the person, to the research (right after what it knows).
        const material: PersonMenuAction[] = !isViewMode && this.materialAvailable()
            ? [{ action: 'research-material', label: strings.material.send }] : [];
        const head = [...(knows ? [knows] : []), ...material];
        const research = submenuRow('research', strings.research.personSection, [
            ...head,
            ...researchActions.map((a, i) => (i === 0 && head.length ? { ...a, divider: true } : a)),
        ]);

        if (isViewMode) {
            return [
                { action: 'focus', label: c.focus },
                ...readItems(false),
                ...group([
                    { action: 'relationship', label: c.relationship },
                    { action: 'archives', label: c.archives },
                ]),
                ...group(research),
            ];
        }
        if (isPersonLocked) {
            return [
                { action: 'focus', label: c.focus },
                // Read-only look at the record (the edit form in its locked mode).
                { action: 'view', label: c.view },
                ...readItems(false),
                ...group([
                    ...research,
                    ...(isTreeLocked ? [] : [{ action: 'toggle-lock', label: strings.lock.unlockPerson }]),
                ]),
            ];
        }
        const chip = (action: string, label: string, ariaLabel: string): PersonMenuAction => ({ action, label, ariaLabel });
        return [
            { action: 'focus', label: c.focus },
            { action: 'edit', label: c.edit },
            ...readItems(true),
            { action: 'descendants', label: c.showDescendants },
            {
                action: 'add', label: c.addSection, header: c.addSection, divider: true, chips: [
                    ...(DataManager.parentSlotFree(person.id) ? [chip('parent', c.chipParent, c.addParent)] : []),
                    chip('partner', c.chipPartner, c.addPartner),
                    chip('child', c.chipChild, c.addChild),
                    chip('sibling', c.chipSibling, c.addSibling),
                    chip('add-family', c.chipFamily, strings.familyWizard.menu),
                ],
            },
            ...group([
                { action: 'relationship', label: c.relationship },
                { action: 'archives', label: c.archives },
            ]),
            ...group([
                ...research,
                ...submenuRow('more', c.more, [
                    { action: 'toggle-lock', label: strings.lock.lockPerson },
                    { action: 'merge', label: `${strings.personMerge.mergeWith}...` },
                    { action: 'delete', label: c.delete, danger: true, divider: true },
                ]),
            ]),
        ];
    },

    /** Run a person menu action (shared by context menu + bottom sheet). */
    runPersonMenuAction(personId: PersonId, action: string): void {
        switch (action) {
            case 'edit':
            case 'view':
                this.clearDialogStack();
                this.pushDialog('person-modal');
                this.showEditPersonModal(personId);
                break;
            case 'focus':
                // "Focus" always returns to the family view so the user is not
                // stranded inside the descendants chart. Mode first (no render),
                // then the single setFocus render.
                if (TreeRenderer.getViewMode() === 'descendants') {
                    TreeRenderer.presetViewMode('family');
                }
                TreeRenderer.setFocus(personId);
                break;
            case 'sources':
                this.clearDialogStack();
                this.pushDialog('person-sources-modal');
                this.showPersonSourcesDialog(personId);
                break;
            case 'story':
                this.clearDialogStack();
                this.pushDialog('person-story-modal');
                this.showPersonStoryDialog(personId);
                break;
            case 'descendants':
                // Set the mode first (no render), then let setFocus do the
                // single render — it fits the descendants chart afterwards.
                TreeRenderer.presetViewMode('descendants');
                TreeRenderer.setFocus(personId);
                break;
            case 'relationship':
                this.showRelationshipCalculator(personId);
                break;
            case 'archives':
                this.showArchiveSearch(personId);
                break;
            case 'parent':
            case 'partner':
            case 'child':
            case 'sibling':
                this.clearDialogStack();
                this.pushDialog('relation-modal');
                this.addRelation(personId, action as RelationType);
                break;
            case 'add-family':
                this.showFamilyWizard(personId);
                break;
            case 'toggle-lock': {
                const p = DataManager.getPerson(personId);
                if (p) {
                    DataManager.updatePerson(personId, { isLocked: !p.isLocked });
                    TreeRenderer.render();
                }
                break;
            }
            case 'merge':
                this.clearDialogStack();
                this.pushDialog('person-merge-modal');
                this.showPersonMergeDialog(personId);
                break;
            case 'delete':
                this.confirmDelete(personId);
                break;
            case 'signal-waiting':
            case 'signal-conflict':
            case 'signal-agent':
                this.openCardSignal(personId, action.slice('signal-'.length));
                break;
            case 'research-knows':
                this.clearDialogStack();
                this.showPersonResearchDialog(personId);
                break;
            case 'research-material':
                this.clearDialogStack();
                this.showMaterialDialog({ personId });
                break;
            case 'research-review':
            case 'research-ancestors':
            case 'research-descendants':
            case 'research-ask':
                this.runPersonResearchAction(personId, action);
                break;
        }
    },

    /**
     * Markup of person menu rows for the desktop menu and its flyouts: plain
     * rows, the "Add" grid, and rows that open a flyout (data-submenu = the
     * row's index in `items`).
     */
    contextMenuItemsHtml(items: PersonMenuAction[]): string {
        return items.map((a, i) => {
            const divider = a.divider ? '<div class="context-menu-divider"></div>' : '';
            const header = a.header ? `<div class="menu-section-header" role="presentation">${this.escapeHtml(a.header)}</div>` : '';
            if (a.chips) {
                return `${divider}${header}<div class="menu-chip-grid" role="group" aria-label="${this.escapeHtml(a.label)}">`
                    + a.chips.map(ch => `<button type="button" class="context-menu-item menu-chip" role="menuitem" tabindex="-1" data-action="${ch.action}"${menuItemAria(ch)}>${this.escapeHtml(ch.label)}</button>`).join('')
                    + '</div>';
            }
            if (a.submenu) {
                return `${divider}${header}<div class="context-menu-item menu-submenu-row" role="menuitem" tabindex="-1" aria-haspopup="menu" aria-expanded="false" data-submenu="${i}" data-menu="${a.action}"${menuItemAria(a)}>${menuItemBody(a)}</div>`;
            }
            // NB: keep the class value out of the attribute as a whole variable —
            // interpolating a `${... ? ... : ...}` directly inside class="context-menu…"
            // confuses the self-export HTML cleaner's regex once minified.
            const cls = a.danger ? 'context-menu-item danger' : 'context-menu-item';
            return `${divider}${header}<div class="${cls}" role="menuitem" tabindex="-1" data-action="${a.action}"${menuItemAria(a)}>${menuItemBody(a)}</div>`;
        }).join('');
    },

    showContextMenu(personId: PersonId, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        // Touch devices and the bottom-navigation regime (≤ 1024px): the person
        // menu opens as a bottom sheet (same action list), like the "More" menu.
        // A floating menu there collided with the bottom bar and the FAB.
        if (isCoarsePointer() || isTabletOrMobile()) {
            this.hideContextMenu();
            this.showPersonBottomSheet(personId);
            return;
        }

        this.hideContextMenu();
        const actions = this.getPersonMenuActions(personId);
        if (actions.length === 0) return;

        const menu = document.createElement('div');
        menu.className = 'context-menu person-menu';
        menu.setAttribute('role', 'menu');
        // Header names the person the menu acts on (serif, per the Letopis design).
        const person = DataManager.getPerson(personId);
        const personName = person ? `${person.firstName} ${person.lastName}`.trim() : '';
        const header = personName
            ? `<div class="context-menu-header">${this.escapeHtml(personName)}</div>`
            : '';
        // Items are text-only here (the mobile bottom sheet keeps the glyphs).
        menu.innerHTML = header + this.personSignalsMenuHtml(personId, false, 'context-menu-item') + this.contextMenuItemsHtml(actions);

        // Position menu near click (adjusted after DOM insert)
        const rect = (event.target as HTMLElement).closest('.person-card')?.getBoundingClientRect();
        menu.style.left = `${rect ? rect.right + 10 : event.clientX}px`;
        menu.style.top = `${rect ? rect.top : event.clientY}px`;

        const run = (item: HTMLElement): void => {
            const action = item.dataset.action;
            this.hideContextMenu();
            if (action) this.runPersonMenuAction(personId, action);
        };
        menu.querySelectorAll<HTMLElement>('.context-menu-item[data-action]').forEach(item => {
            item.addEventListener('click', () => run(item));
        });

        // Rows with a second level ("Research ›", "More ›"): a flyout beside
        // the menu, like "Tree:" in the ⋯ menu — on hover (after a moment),
        // click, Enter or →; ← or Esc closes it again.
        let hoverTimer: ReturnType<typeof setTimeout> | null = null;
        const clearHover = (): void => { if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; } };
        const openSubmenu = (row: HTMLElement, focusFirst: boolean): void => {
            clearHover();
            const items = actions[Number(row.dataset.submenu)]?.submenu;
            if (!items) return;
            if (row.classList.contains('submenu-open') && this.contextSubmenu) {
                if (focusFirst) this.contextSubmenu.querySelector<HTMLElement>('.context-menu-item')?.focus();
                return;
            }
            this.closeContextSubmenu();
            const sub = document.createElement('div');
            sub.className = 'context-menu context-submenu';
            sub.setAttribute('role', 'menu');
            sub.setAttribute('aria-label', row.textContent?.replace('›', '').trim() ?? '');
            sub.innerHTML = this.contextMenuItemsHtml(items);
            sub.querySelectorAll<HTMLElement>('.context-menu-item[data-action]').forEach(item => {
                item.addEventListener('click', () => run(item));
            });
            sub.addEventListener('mouseenter', clearHover);
            sub.addEventListener('keydown', (e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'Escape') return;
                // Only the flyout closes; the menu stays (a second Esc closes it).
                e.preventDefault();
                e.stopPropagation();
                this.closeContextSubmenu();
                row.focus();
            });
            row.classList.add('submenu-open');
            row.setAttribute('aria-expanded', 'true');
            document.body.appendChild(sub);
            this.contextSubmenu = sub;
            // Beside the menu (left of it when the right has no room), level
            // with the row, fitted into the window.
            const menuRect = menu.getBoundingClientRect();
            const rowRect = row.getBoundingClientRect();
            const width = sub.offsetWidth;
            const left = menuRect.right + 4 + width <= window.innerWidth - FLYOUT_MARGIN
                ? menuRect.right + 4 : Math.max(FLYOUT_MARGIN, menuRect.left - 4 - width);
            const top = rowRect.top - 8;
            const { shift, maxHeight } = fitFlyout(top, sub.offsetHeight, window.innerHeight);
            sub.style.maxHeight = `${maxHeight}px`;
            sub.style.left = `${left}px`;
            sub.style.top = `${Math.max(FLYOUT_MARGIN, top - shift)}px`;
            if (focusFirst) sub.querySelector<HTMLElement>('.context-menu-item')?.focus();
        };
        menu.querySelectorAll<HTMLElement>('.context-menu-item').forEach(item => {
            const isRow = item.dataset.submenu !== undefined;
            item.addEventListener('mouseenter', () => {
                clearHover();
                if (isRow) {
                    if (!item.classList.contains('submenu-open')) hoverTimer = setTimeout(() => openSubmenu(item, false), 150);
                } else if (this.contextSubmenu) {
                    hoverTimer = setTimeout(() => this.closeContextSubmenu(), 150);
                }
            });
            if (!isRow) return;
            item.addEventListener('click', () => openSubmenu(item, true));
            item.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openSubmenu(item, true);
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    this.closeContextSubmenu();
                }
            });
        });

        document.body.appendChild(menu);
        this.contextMenu = menu;

        // The menu lives between the toolbar's bottom edge and the window's
        // bottom edge (8px margins) — it never covers the toolbar; a list
        // taller than that space scrolls. Set synchronously so the menu is
        // never painted over the toolbar, then refine the horizontal side.
        const EDGE = 8;
        const toolbarBottom = document.querySelector('.toolbar')?.getBoundingClientRect().bottom ?? 0;
        const minTop = Math.max(EDGE, toolbarBottom + EDGE);
        const maxHeight = Math.max(120, window.innerHeight - EDGE - minTop);
        menu.style.maxHeight = `${maxHeight}px`;
        const place = () => {
            // Layout size, not getBoundingClientRect(): the open animation
            // scales the menu, which would under-report its height.
            const width = menu.offsetWidth;
            const height = menu.offsetHeight;
            const viewportWidth = window.innerWidth;
            const padding = 10;

            let newLeft = parseFloat(menu.style.left);
            let newTop = parseFloat(menu.style.top);

            if (newLeft + width > viewportWidth - padding) {
                newLeft = rect ? rect.left - width - 10 : viewportWidth - width - padding;
            }
            if (newLeft < padding) newLeft = padding;
            const maxTop = window.innerHeight - EDGE - height;
            if (newTop > maxTop) newTop = maxTop;
            if (newTop < minTop) newTop = minTop;

            menu.style.left = `${newLeft}px`;
            menu.style.top = `${newTop}px`;
        };
        place();
        requestAnimationFrame(place);

        // Close menu when clicking/touching outside
        this.contextMenuCloseHandler = (e: Event) => {
            const target = e.target as Node;
            if (this.contextMenu && this.contextMenu.contains(target)) return;
            if (this.contextSubmenu && this.contextSubmenu.contains(target)) return;
            if ((target as Element).closest?.('.person-card')) return;
            this.hideContextMenu();
        };
        setTimeout(() => {
            document.addEventListener('mousedown', this.contextMenuCloseHandler!, true);
            document.addEventListener('touchstart', this.contextMenuCloseHandler!, true);
        }, 10);
    },

    /** Close the person menu's open flyout (the menu stays). False when none was open. */
    closeContextSubmenu(): boolean {
        if (!this.contextSubmenu) return false;
        this.contextSubmenu.remove();
        this.contextSubmenu = null;
        this.contextMenu?.querySelectorAll('.menu-submenu-row.submenu-open').forEach(row => {
            row.classList.remove('submenu-open');
            row.setAttribute('aria-expanded', 'false');
        });
        return true;
    },

    hideContextMenu(): void {
        this.closeContextSubmenu();
        if (this.contextMenuCloseHandler) {
            document.removeEventListener('mousedown', this.contextMenuCloseHandler, true);
            document.removeEventListener('touchstart', this.contextMenuCloseHandler, true);
            this.contextMenuCloseHandler = null;
        }
        if (this.contextMenu) {
            this.contextMenu.remove();
            this.contextMenu = null;
        }
    },
});
