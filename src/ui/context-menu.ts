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
import { isToolbarCompact } from '../breakpoints.js';

/** One entry in the person action menu (context menu / bottom sheet). */
export interface PersonMenuAction {
    action: string;
    label: string;
    danger?: boolean;
    /** Render a divider before this item (starts a new group). */
    divider?: boolean;
}

export const contextMenuMethods = uiModule({
    /**
     * The per-person actions, depending on view/lock state. Both the desktop
     * context menu and the bottom sheet build their markup from this.
     * Groups: the person itself (edit / focus / descendants) → add relatives →
     * everything else (kinship, archives, lock, merge, delete).
     */
    getPersonMenuActions(personId: PersonId): PersonMenuAction[] {
        const person = DataManager.getPerson(personId);
        if (!person) return [];
        // Read-only: an embedded file's view mode or locked local data.
        const isViewMode = DataManager.isReadOnly();
        const isPersonLocked = DataManager.isPersonLocked(personId);
        const isTreeLocked = DataManager.isTreeLocked();

        if (isViewMode) {
            return [
                { action: 'focus', label: strings.contextMenu.focus },
                { action: 'relationship', label: strings.contextMenu.relationship, divider: true },
                { action: 'archives', label: strings.contextMenu.archives },
            ];
        }
        if (isPersonLocked) {
            const items: PersonMenuAction[] = [
                // Read-only look at the record (the edit form in its locked mode).
                { action: 'view', label: strings.contextMenu.view },
                { action: 'focus', label: strings.contextMenu.focus },
            ];
            if (!isTreeLocked) {
                items.push({ action: 'toggle-lock', label: strings.lock.unlockPerson, divider: true });
            }
            return items;
        }
        const items: PersonMenuAction[] = [
            { action: 'edit', label: strings.contextMenu.edit },
            { action: 'focus', label: strings.contextMenu.focus },
            { action: 'descendants', label: strings.contextMenu.showDescendants },
        ];
        // Add… group
        if (person.parentIds.length < 2) {
            items.push({ action: 'parent', label: strings.contextMenu.addParent, divider: true });
        }
        items.push({ action: 'partner', label: strings.contextMenu.addPartner, divider: person.parentIds.length >= 2 });
        items.push({ action: 'child', label: strings.contextMenu.addChild });
        items.push({ action: 'sibling', label: strings.contextMenu.addSibling });
        items.push({ action: 'add-family', label: strings.familyWizard.menu });
        // Everything else
        items.push({ action: 'relationship', label: strings.contextMenu.relationship, divider: true });
        items.push({ action: 'archives', label: strings.contextMenu.archives });
        items.push({ action: 'toggle-lock', label: strings.lock.lockPerson });
        items.push({ action: 'merge', label: `${strings.personMerge.mergeWith}...` });
        items.push({ action: 'delete', label: strings.contextMenu.delete, danger: true });
        return items;
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
        }
    },

    showContextMenu(personId: PersonId, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        // Touch devices and the bottom-navigation regime (≤ 1024px): the person
        // menu opens as a bottom sheet (same action list), like the "More" menu.
        // A floating menu there collided with the bottom bar and the FAB.
        if (isCoarsePointer() || isToolbarCompact()) {
            this.hideContextMenu();
            this.showPersonBottomSheet(personId);
            return;
        }

        this.hideContextMenu();
        const actions = this.getPersonMenuActions(personId);
        if (actions.length === 0) return;

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.setAttribute('role', 'menu');
        // Header names the person the menu acts on (serif, per the Letopis design).
        const person = DataManager.getPerson(personId);
        const personName = person ? `${person.firstName} ${person.lastName}`.trim() : '';
        const header = personName
            ? `<div class="context-menu-header">${this.escapeHtml(personName)}</div>`
            : '';
        // NB: keep the class value out of the attribute as a whole variable —
        // interpolating a `${... ? ... : ...}` directly inside class="context-menu…"
        // confuses the self-export HTML cleaner's regex once minified.
        // Items are text-only here (the mobile bottom sheet keeps the glyphs).
        menu.innerHTML = header + actions.map(a => {
            const cls = a.danger ? 'context-menu-item danger' : 'context-menu-item';
            const divider = a.divider ? '<div class="context-menu-divider"></div>' : '';
            return `${divider}<div class="${cls}" role="menuitem" tabindex="-1" data-action="${a.action}">${a.label}</div>`;
        }).join('');

        // Position menu near click (adjusted after DOM insert)
        const rect = (event.target as HTMLElement).closest('.person-card')?.getBoundingClientRect();
        menu.style.left = `${rect ? rect.right + 10 : event.clientX}px`;
        menu.style.top = `${rect ? rect.top : event.clientY}px`;

        menu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = (item as HTMLElement).dataset.action;
                this.hideContextMenu();
                if (action) this.runPersonMenuAction(personId, action);
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
            if ((target as Element).closest?.('.person-card')) return;
            this.hideContextMenu();
        };
        setTimeout(() => {
            document.addEventListener('mousedown', this.contextMenuCloseHandler!, true);
            document.addEventListener('touchstart', this.contextMenuCloseHandler!, true);
        }, 10);
    },

    hideContextMenu(): void {
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
