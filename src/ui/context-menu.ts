/**
 * Context menu shown when clicking a person card.
 * Split from the original UIClass; see src/ui/module.ts for the pattern.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import { PersonId, RelationType } from '../types.js';
import { uiModule } from './module.js';

export const contextMenuMethods = uiModule({
    showContextMenu(personId: PersonId, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        // Remove existing menu
        this.hideContextMenu();

        const person = DataManager.getPerson(personId);
        if (!person) return;

        // Check if in view mode (read-only)
        const isViewMode = DataManager.isViewMode();
        const isPersonLocked = DataManager.isPersonLocked(personId);
        const isTreeLocked = DataManager.isTreeLocked();

        // Create context menu - show only non-editing actions in view mode
        const menu = document.createElement('div');
        menu.className = 'context-menu';

        if (isViewMode) {
            // View mode: only Focus action
            menu.innerHTML = `
                <div class="context-menu-item" data-action="focus">
                    <span class="icon">&#127919;</span> ${strings.contextMenu.focus}
                </div>
                <div class="context-menu-item" data-action="relationship">
                    <span class="icon">&#129309;</span> ${strings.contextMenu.relationship}
                </div>
                <div class="context-menu-item" data-action="archives">
                    <span class="icon">&#128218;</span> ${strings.contextMenu.archives}
                </div>
            `;
        } else if (isPersonLocked) {
            // Locked person: Focus + optional unlock (if tree is not locked)
            menu.innerHTML = `
                <div class="context-menu-item" data-action="focus">
                    <span class="icon">&#127919;</span> ${strings.contextMenu.focus}
                </div>
                ${!isTreeLocked ? `
                <div class="context-menu-divider"></div>
                <div class="context-menu-item" data-action="toggle-lock">
                    <span class="icon">&#128275;</span> ${strings.lock.unlockPerson}
                </div>
                ` : ''}
            `;
        } else {
            // Normal mode: all actions + lock
            menu.innerHTML = `
                <div class="context-menu-item" data-action="edit">
                    <span class="icon">&#9998;</span> ${strings.contextMenu.edit}
                </div>
                <div class="context-menu-item" data-action="focus">
                    <span class="icon">&#127919;</span> ${strings.contextMenu.focus}
                </div>
                <div class="context-menu-item" data-action="relationship">
                    <span class="icon">&#129309;</span> ${strings.contextMenu.relationship}
                </div>
                <div class="context-menu-item" data-action="archives">
                    <span class="icon">&#128218;</span> ${strings.contextMenu.archives}
                </div>
                <div class="context-menu-divider"></div>
                ${person.parentIds.length < 2 ? `
                <div class="context-menu-item" data-action="parent">
                    <span class="icon">&uarr;</span> ${strings.contextMenu.addParent}
                </div>
                ` : ''}
                <div class="context-menu-item" data-action="partner">
                    <span class="icon">&harr;</span> ${strings.contextMenu.addPartner}
                </div>
                <div class="context-menu-item" data-action="child">
                    <span class="icon">&darr;</span> ${strings.contextMenu.addChild}
                </div>
                <div class="context-menu-item" data-action="sibling">
                    <span class="icon">&#8596;</span> ${strings.contextMenu.addSibling}
                </div>
                <div class="context-menu-divider"></div>
                <div class="context-menu-item" data-action="toggle-lock">
                    <span class="icon">&#128274;</span> ${strings.lock.lockPerson}
                </div>
                <div class="context-menu-item" data-action="merge">
                    <span class="icon">&#128279;</span> ${strings.personMerge.mergeWith}...
                </div>
                <div class="context-menu-item danger" data-action="delete">
                    <span class="icon">&#128465;</span> ${strings.contextMenu.delete}
                </div>
            `;
        }

        // Position menu near click (will be adjusted after DOM insert)
        const rect = (event.target as HTMLElement).closest('.person-card')?.getBoundingClientRect();
        let menuX = rect ? rect.right + 10 : event.clientX;
        let menuY = rect ? rect.top : event.clientY;
        menu.style.left = `${menuX}px`;
        menu.style.top = `${menuY}px`;

        // Add event listeners
        menu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = (item as HTMLElement).dataset.action;
                this.hideContextMenu();

                switch (action) {
                    case 'edit':
                        // Setup stack for ESC handling
                        this.clearDialogStack();
                        this.pushDialog('person-modal');
                        this.showEditPersonModal(personId);
                        break;
                    case 'focus':
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
                        // Setup stack for ESC handling
                        this.clearDialogStack();
                        this.pushDialog('relation-modal');
                        this.addRelation(personId, action as RelationType);
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
                        // Setup stack for ESC handling
                        this.clearDialogStack();
                        this.pushDialog('person-merge-modal');
                        this.showPersonMergeDialog(personId);
                        break;
                    case 'delete':
                        this.confirmDelete(personId);
                        break;
                }
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

            // Check right edge - if menu overflows, position to left of card or screen edge
            if (menuRect.right > viewportWidth - padding) {
                if (rect) {
                    newLeft = rect.left - menuRect.width - 10;
                } else {
                    newLeft = viewportWidth - menuRect.width - padding;
                }
            }

            // Check left edge - ensure menu doesn't go off left side
            if (newLeft < padding) {
                newLeft = padding;
            }

            // Check bottom edge
            if (menuRect.bottom > viewportHeight - padding) {
                newTop = viewportHeight - menuRect.height - padding;
            }

            // Check top edge
            if (newTop < padding) {
                newTop = padding;
            }

            menu.style.left = `${newLeft}px`;
            menu.style.top = `${newTop}px`;
        });

        // Close menu when clicking/touching outside
        this.contextMenuCloseHandler = (e: Event) => {
            const target = e.target as Node;
            // Don't close if clicking inside the menu
            if (this.contextMenu && this.contextMenu.contains(target)) return;
            // Don't close if clicking on a person card (will open new menu)
            if ((target as Element).closest?.('.person-card')) return;
            this.hideContextMenu();
        };

        setTimeout(() => {
            // Capture phase ensures we get the event before other handlers
            document.addEventListener('mousedown', this.contextMenuCloseHandler!, true);
            document.addEventListener('touchstart', this.contextMenuCloseHandler!, true);
        }, 10);
    },

    hideContextMenu(): void {
        // Remove event listeners
        if (this.contextMenuCloseHandler) {
            document.removeEventListener('mousedown', this.contextMenuCloseHandler, true);
            document.removeEventListener('touchstart', this.contextMenuCloseHandler, true);
            this.contextMenuCloseHandler = null;
        }
        // Remove menu element
        if (this.contextMenu) {
            this.contextMenu.remove();
            this.contextMenu = null;
        }
    },
});
