/**
 * Context menu shown when clicking a person card, plus the shared per-person
 * action model (also used by the mobile bottom sheet — see bottom-sheet.ts).
 * The action LIST and the DISPATCH are shared; only the markup differs.
 * Split from the original UIClass; see src/ui/module.ts for the pattern.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import { PersonId, RelationType } from '../types.js';
import { uiModule } from './module.js';
import { isCoarsePointer } from './bottom-sheet.js';

/** One entry in the person action menu (context menu / bottom sheet). */
export interface PersonMenuAction {
    action: string;
    icon: string;
    label: string;
    danger?: boolean;
    /** Render a divider before this item. */
    divider?: boolean;
}

export const contextMenuMethods = uiModule({
    /**
     * The per-person actions, depending on view/lock state. Both the desktop
     * context menu and the mobile bottom sheet build their markup from this.
     */
    getPersonMenuActions(personId: PersonId): PersonMenuAction[] {
        const person = DataManager.getPerson(personId);
        if (!person) return [];
        const isViewMode = DataManager.isViewMode();
        const isPersonLocked = DataManager.isPersonLocked(personId);
        const isTreeLocked = DataManager.isTreeLocked();

        if (isViewMode) {
            return [
                { action: 'focus', icon: '\u{1F3AF}', label: strings.contextMenu.focus },
                { action: 'relationship', icon: '\u{1F91D}', label: strings.contextMenu.relationship },
                { action: 'archives', icon: '\u{1F4DA}', label: strings.contextMenu.archives },
            ];
        }
        if (isPersonLocked) {
            const items: PersonMenuAction[] = [
                { action: 'focus', icon: '\u{1F3AF}', label: strings.contextMenu.focus },
            ];
            if (!isTreeLocked) {
                items.push({ action: 'toggle-lock', icon: '\u{1F513}', label: strings.lock.unlockPerson, divider: true });
            }
            return items;
        }
        const items: PersonMenuAction[] = [
            { action: 'edit', icon: '\u{270E}', label: strings.contextMenu.edit },
            { action: 'focus', icon: '\u{1F3AF}', label: strings.contextMenu.focus },
            { action: 'descendants', icon: '\u{1F333}', label: strings.contextMenu.showDescendants },
            { action: 'relationship', icon: '\u{1F91D}', label: strings.contextMenu.relationship },
            { action: 'archives', icon: '\u{1F4DA}', label: strings.contextMenu.archives },
        ];
        if (person.parentIds.length < 2) {
            items.push({ action: 'parent', icon: '↑', label: strings.contextMenu.addParent, divider: true });
        }
        items.push({ action: 'partner', icon: '↔', label: strings.contextMenu.addPartner, divider: person.parentIds.length >= 2 });
        items.push({ action: 'child', icon: '↓', label: strings.contextMenu.addChild });
        items.push({ action: 'sibling', icon: '↔', label: strings.contextMenu.addSibling });
        items.push({ action: 'add-family', icon: '\u{1F46A}', label: strings.familyWizard.menu });
        items.push({ action: 'toggle-lock', icon: '\u{1F512}', label: strings.lock.lockPerson, divider: true });
        items.push({ action: 'merge', icon: '\u{1F517}', label: `${strings.personMerge.mergeWith}...` });
        items.push({ action: 'delete', icon: '\u{1F5D1}', label: strings.contextMenu.delete, danger: true });
        return items;
    },

    /** Run a person menu action (shared by context menu + bottom sheet). */
    runPersonMenuAction(personId: PersonId, action: string): void {
        switch (action) {
            case 'edit':
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

        // Touch devices: the first tap opens the person menu directly, same as
        // a desktop click — but as the mobile bottom sheet (same action list).
        if (isCoarsePointer()) {
            this.hideContextMenu();
            this.showPersonBottomSheet(personId);
            return;
        }

        this.hideContextMenu();
        const actions = this.getPersonMenuActions(personId);
        if (actions.length === 0) return;

        const menu = document.createElement('div');
        menu.className = 'context-menu';
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
            return `${divider}<div class="${cls}" data-action="${a.action}">${a.label}</div>`;
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

        // Adjust position to keep menu on screen
        requestAnimationFrame(() => {
            const menuRect = menu.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const padding = 10;

            let newLeft = parseFloat(menu.style.left);
            let newTop = parseFloat(menu.style.top);

            if (menuRect.right > viewportWidth - padding) {
                newLeft = rect ? rect.left - menuRect.width - 10 : viewportWidth - menuRect.width - padding;
            }
            if (newLeft < padding) newLeft = padding;
            if (menuRect.bottom > viewportHeight - padding) newTop = viewportHeight - menuRect.height - padding;
            if (newTop < padding) newTop = padding;

            menu.style.left = `${newLeft}px`;
            menu.style.top = `${newTop}px`;
        });

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
