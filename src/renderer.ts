/**
 * TreeRenderer - Rendering of family tree
 * Uses layout module for position computation, handles SVG rendering
 */

import { DataManager } from './data.js';
import { UI } from './ui.js';
import { ZoomPan } from './zoom.js';
import { strings } from './strings.js';
import {
    Person,
    PersonId,
    Position,
    DEFAULT_LAYOUT_CONFIG,
    TreeId,
    StromData
} from './types.js';
import { TreeManager } from './tree-manager.js';
import * as CrossTree from './cross-tree.js';
import {
    computeLayout,
    StromLayoutEngine,
    LayoutRequest,
    Connection,
    SpouseLine,
    runLayoutPipelineWithDebug,
    DebugOptions,
    DebugSnapshot,
    LayoutDebugContext
} from './layout/index.js';
import { renderDebugOverlay, clearDebugOverlay } from './debug-overlay.js';
import { debugPanel } from './debug-panel.js';

class TreeRendererClass {
    private config = DEFAULT_LAYOUT_CONFIG;
    private positions = new Map<PersonId, Position>();

    // Connections for line rendering from layout engine
    private connections: Connection[] = [];

    // Spouse lines from layout engine (only adjacent partners)
    private spouseLines: SpouseLine[] = [];

    // Focus mode state
    private focusPersonId: PersonId | null = null;
    private focusDepthUp: number = 3;
    private focusDepthDown: number = 3;

    // Debug overlay for visual verification of anchor points
    private debugOverlay: boolean = false;

    // Debug mode options (from URL params)
    private debugOptions: DebugOptions | null = null;
    private currentDebugSnapshot: DebugSnapshot | null = null;

    /**
     * Set debug options for pipeline visualization.
     */
    setDebugOptions(options: DebugOptions): void {
        this.debugOptions = options;
    }

    render(): void {
        const canvas = document.getElementById('tree-canvas');
        const svg = document.getElementById('tree-lines') as SVGSVGElement | null;
        const empty = document.getElementById('empty-state');

        if (!canvas || !svg) return;

        // Clear previous render
        canvas.querySelectorAll('.person-card').forEach(c => c.remove());
        svg.innerHTML = '';
        this.positions.clear();
        this.connections = [];

        const persons = DataManager.getAllPersons();
        if (persons.length === 0) {
            if (empty) empty.style.display = 'block';
            this.focusPersonId = null;
            this.updateFocusUI();
            return;
        }
        if (empty) empty.style.display = 'none';

        // Ensure we have a valid focus person (exists in current tree)
        if (!this.focusPersonId || !DataManager.getPerson(this.focusPersonId)) {
            this.focusPersonId = this.findDefaultFocusPerson();
            if (!this.focusPersonId) return;
        }

        // Compute layout using the new layout engine
        const request: LayoutRequest = {
            data: DataManager.getData(),
            focusPersonId: this.focusPersonId,
            policy: {
                ancestorDepth: this.focusDepthUp,
                descendantDepth: this.focusDepthDown,
                includeAuntsUncles: true,
                includeCousins: true
            },
            config: this.config
        };

        let result;

        // Use debug pipeline if debug mode is enabled
        if (this.debugOptions?.enabled) {
            const debugResult = runLayoutPipelineWithDebug(
                {
                    data: request.data,
                    focusPersonId: request.focusPersonId,
                    config: request.config,
                    ancestorDepth: request.policy.ancestorDepth,
                    descendantDepth: request.policy.descendantDepth,
                    includeSpouseAncestors: false,
                    includeParentSiblings: request.policy.includeAuntsUncles,
                    includeParentSiblingDescendants: request.policy.includeCousins
                },
                this.debugOptions
            );

            result = debugResult.result;

            // Store current snapshot (last one for the target step)
            this.currentDebugSnapshot = debugResult.snapshots[debugResult.snapshots.length - 1] || null;

            // Set global debug context for DevTools inspection
            const debugContext: LayoutDebugContext = {
                query: {
                    debug: this.debugOptions.enabled,
                    step: this.debugOptions.step
                },
                snapshots: debugResult.snapshots,
                result: debugResult.result
            };
            window.__LAYOUT_DEBUG__ = debugContext;
        } else {
            const engine = new StromLayoutEngine();
            result = computeLayout(engine, request);
            this.currentDebugSnapshot = null;
        }

        // Apply layout result
        this.positions = result.positions;
        this.connections = result.connections;
        this.spouseLines = result.spouseLines;

        this.renderCards(canvas);
        this.renderLines(svg);
        this.updateSVGSize(svg);

        // Update focus UI (shows panel with focused person name, generation controls)
        this.updateFocusUI();
    }

    // ============= Focus Mode Methods =============

    /**
     * Find a default focus person when none is set.
     * Uses getStartupFocus which handles the defaultPersonId setting
     * Fallback: first person in data
     */
    private findDefaultFocusPerson(): PersonId | null {
        const persons = DataManager.getAllPersons();
        if (persons.length === 0) return null;

        // Use getStartupFocus to respect the tree's defaultPersonId setting
        const startupFocus = DataManager.getStartupFocus();
        if (startupFocus) {
            return startupFocus.personId;
        }

        // Fallback to first person
        return persons[0].id;
    }

    /**
     * Restore focus from tree data based on default person setting
     * Called during initialization and after tree switch to restore user's position
     */
    restoreFromSession(): void {
        const persons = DataManager.getAllPersons();

        if (persons.length === 0) {
            this.focusPersonId = null;
            return;
        }

        // Get startup focus based on tree's defaultPersonId setting
        const startupFocus = DataManager.getStartupFocus();

        if (startupFocus) {
            // Use the specified person (and optionally saved depths)
            this.focusPersonId = startupFocus.personId;
            if (startupFocus.depthUp !== undefined) {
                this.focusDepthUp = startupFocus.depthUp;
            } else {
                const maxGen = DataManager.getMaxGenerationsWithSiblings(this.focusPersonId);
                this.focusDepthUp = maxGen.up;
            }
            if (startupFocus.depthDown !== undefined) {
                this.focusDepthDown = startupFocus.depthDown;
            } else {
                const maxGen = DataManager.getMaxGenerationsWithSiblings(this.focusPersonId);
                this.focusDepthDown = maxGen.down;
            }
        } else {
            // Fall back to first person
            this.focusPersonId = this.findDefaultFocusPerson();
            if (this.focusPersonId) {
                const maxGen = DataManager.getMaxGenerationsWithSiblings(this.focusPersonId);
                this.focusDepthUp = maxGen.up;
                this.focusDepthDown = maxGen.down;
            }
        }
    }

    // Public Focus Mode API
    setFocus(personId: PersonId | null, saveToData = true): void {
        // Always have a focus person
        // If null is passed, find a default person
        if (!personId) {
            personId = this.findDefaultFocusPerson();
        }

        this.focusPersonId = personId;

        // Set default depth to max available when focusing on a new person
        if (personId) {
            const maxGen = DataManager.getMaxGenerationsWithSiblings(personId);
            this.focusDepthUp = maxGen.up;
            this.focusDepthDown = maxGen.down;

            // Save to tree data if setting is LAST_FOCUSED (this DOES export)
            if (saveToData) {
                DataManager.saveLastFocus(personId, this.focusDepthUp, this.focusDepthDown);
            }
        }

        this.render();
        this.updateFocusUI();
        // Center view on focused person
        if (personId) {
            ZoomPan.centerOnPerson(personId);
        }
    }

    setFocusDepth(up: number, down: number): void {
        this.focusDepthUp = up;
        this.focusDepthDown = down;

        // Save to tree data if setting is LAST_FOCUSED (this DOES export)
        if (this.focusPersonId) {
            DataManager.saveLastFocus(this.focusPersonId, up, down);
            this.render();
        }
    }

    isFocusMode(): boolean {
        // Always in focus mode
        return true;
    }

    getFocusPersonId(): PersonId | null {
        return this.focusPersonId;
    }

    private updateFocusUI(): void {
        const focusControls = document.getElementById('focus-controls');
        const focusName = document.getElementById('focus-name');
        const focusCount = document.getElementById('focus-person-count');
        const depthUpSelect = document.getElementById('focus-depth-up') as HTMLSelectElement | null;
        const depthDownSelect = document.getElementById('focus-depth-down') as HTMLSelectElement | null;

        // Toolbar focus elements (for tablet landscape)
        const toolbarFocusName = document.getElementById('toolbar-focus-name');
        const toolbarFocusCount = document.getElementById('toolbar-focus-count');
        const toolbarDepthUp = document.getElementById('toolbar-depth-up') as HTMLSelectElement | null;
        const toolbarDepthDown = document.getElementById('toolbar-depth-down') as HTMLSelectElement | null;

        if (!focusControls) return;

        // Get toolbar-focus element for tablet view
        const toolbarFocus = document.querySelector('.toolbar-focus') as HTMLElement | null;

        // Hide everything if there are no persons in the tree
        const totalCount = DataManager.getAllPersons().length;
        if (totalCount === 0) {
            focusControls.style.display = 'none';
            if (toolbarFocus) toolbarFocus.style.display = 'none';
            if (toolbarFocusName) toolbarFocusName.textContent = '';
            if (toolbarFocusCount) toolbarFocusCount.textContent = '';
            return;
        }

        // Show toolbar-focus if it was hidden (and we have persons)
        if (toolbarFocus) toolbarFocus.style.display = '';

        if (this.focusPersonId) {
            const person = DataManager.getPerson(this.focusPersonId);
            const displayName = person ? (`${person.firstName} ${person.lastName}`.trim() || '?') : '?';

            // Update floating focus controls
            if (focusName) {
                focusName.textContent = displayName;
            }
            // Update toolbar focus (tablet)
            if (toolbarFocusName) {
                toolbarFocusName.textContent = displayName;
            }

            // Update person count (visible / total)
            const visibleCount = this.positions.size;
            const countText = strings.focus.personCount(visibleCount, totalCount);

            if (focusCount) {
                focusCount.textContent = countText;
            }
            if (toolbarFocusCount) {
                toolbarFocusCount.textContent = countText;
            }

            // Update generation select options based on available data
            const maxGen = DataManager.getMaxGenerationsWithSiblings(this.focusPersonId);
            this.updateGenerationSelect(depthUpSelect, maxGen.up, this.focusDepthUp);
            this.updateGenerationSelect(depthDownSelect, maxGen.down, this.focusDepthDown);
            // Also update toolbar selects
            this.updateGenerationSelect(toolbarDepthUp, maxGen.up, this.focusDepthUp);
            this.updateGenerationSelect(toolbarDepthDown, maxGen.down, this.focusDepthDown);

            focusControls.style.display = 'flex';
        } else {
            focusControls.style.display = 'none';
            // Clear toolbar focus display when no focus person
            if (toolbarFocusName) toolbarFocusName.textContent = '';
            if (toolbarFocusCount) toolbarFocusCount.textContent = '';
        }
    }

    /**
     * Update a generation select element with options from 1 to maxValue.
     */
    private updateGenerationSelect(select: HTMLSelectElement | null, maxValue: number, currentValue: number): void {
        if (!select) return;

        // Clear existing options
        select.innerHTML = '';

        // Add options from 1 to maxValue
        for (let i = 1; i <= maxValue; i++) {
            const option = document.createElement('option');
            option.value = String(i);
            option.textContent = String(i);
            select.appendChild(option);
        }

        // Set current value (clamped to available range)
        const clampedValue = Math.min(currentValue, maxValue);
        select.value = String(clampedValue);

        // Update internal state if clamped
        if (select.id === 'focus-depth-up' && clampedValue !== this.focusDepthUp) {
            this.focusDepthUp = clampedValue;
        } else if (select.id === 'focus-depth-down' && clampedValue !== this.focusDepthDown) {
            this.focusDepthDown = clampedValue;
        }
    }

    exportFocusedData(): void {
        if (!this.focusPersonId) return;

        // Use positions map which reflects what's actually rendered
        // (layout algorithm determines visibility via selectFocusSubgraph)
        const visibleIds = new Set(this.positions.keys());

        DataManager.exportFocusedJSON(visibleIds);
    }

    /**
     * Get focused data as StromData object (for creating new tree from focus)
     */
    getFocusedData(): import('./types.js').StromData | null {
        if (!this.focusPersonId || this.positions.size === 0) return null;

        const visibleIds = new Set(this.positions.keys());
        const data = DataManager.getData();

        // Filter persons - only visible ones
        const filteredPersons: Record<PersonId, import('./types.js').Person> = {} as Record<PersonId, import('./types.js').Person>;
        for (const id of visibleIds) {
            const person = data.persons[id];
            if (person) {
                filteredPersons[id] = person;
            }
        }

        // Filter partnerships - only those where BOTH partners are visible
        const filteredPartnerships: Record<import('./types.js').PartnershipId, import('./types.js').Partnership> = {} as Record<import('./types.js').PartnershipId, import('./types.js').Partnership>;
        for (const [id, partnership] of Object.entries(data.partnerships)) {
            if (visibleIds.has(partnership.person1Id) && visibleIds.has(partnership.person2Id)) {
                filteredPartnerships[id as import('./types.js').PartnershipId] = partnership;
            }
        }

        return {
            persons: filteredPersons,
            partnerships: filteredPartnerships
        };
    }

    /**
     * Get partners of a person that are not currently visible (hidden in focus mode)
     */
    getHiddenPartners(personId: PersonId): Person[] {
        const allPartners = DataManager.getAllPartners(personId);
        return allPartners.filter(p => !this.positions.has(p.id));
    }

    /**
     * Get partners with children that are not currently visible (hidden families)
     */
    getHiddenFamilyPartners(personId: PersonId): Person[] {
        const partnerships = DataManager.getPartnerships(personId);
        const hiddenFamilyPartners: Person[] = [];

        for (const partnership of partnerships) {
            // Only consider partnerships with children
            if (partnership.childIds.length === 0) continue;

            const partnerId = partnership.person1Id === personId
                ? partnership.person2Id
                : partnership.person1Id;

            // Only if partner is not visible
            if (!this.positions.has(partnerId)) {
                const partner = DataManager.getPerson(partnerId);
                if (partner) {
                    hiddenFamilyPartners.push(partner);
                }
            }
        }

        return hiddenFamilyPartners;
    }

    /**
     * Compute set of persons who are presumed deceased:
     * - Has death date, OR
     * - Birth year is more than 120 years ago, OR
     * - Is an ancestor of someone who is presumed deceased
     */
    private computePresumedDeceased(): Set<PersonId> {
        const presumedDeceased = new Set<PersonId>();
        const currentYear = new Date().getFullYear();
        const MAX_AGE = 120;

        // First pass: mark persons with death date or age > 120
        for (const person of DataManager.getAllPersons()) {
            if (person.deathDate) {
                presumedDeceased.add(person.id);
            } else if (person.birthDate) {
                const birthYear = parseInt(person.birthDate.split('-')[0], 10);
                if (!isNaN(birthYear) && (currentYear - birthYear) > MAX_AGE) {
                    presumedDeceased.add(person.id);
                }
            }
        }

        // Second pass: mark all ancestors of presumed deceased
        const markAncestors = (personId: PersonId) => {
            const person = DataManager.getPerson(personId);
            if (!person) return;

            for (const parentId of person.parentIds) {
                if (!presumedDeceased.has(parentId)) {
                    presumedDeceased.add(parentId);
                    markAncestors(parentId);
                }
            }
        };

        // Copy initial set to iterate (can't modify while iterating)
        const initialDeceased = Array.from(presumedDeceased);
        for (const personId of initialDeceased) {
            markAncestors(personId);
        }

        return presumedDeceased;
    }

    /**
     * Get all trees for cross-tree matching
     * Returns a Map of treeId -> { name, data }
     * Only available when not in view mode and there are multiple visible trees
     */
    private getAllTreesForCrossTreeMatching(): Map<TreeId, { name: string; data: StromData }> | null {
        // Don't do cross-tree matching in view mode
        if (DataManager.isViewMode()) return null;

        // Use getVisibleTrees() to exclude hidden trees
        const trees = TreeManager.getVisibleTrees();
        // Only show cross-tree links if there are multiple visible trees
        if (trees.length < 2) return null;

        const result = new Map<TreeId, { name: string; data: StromData }>();

        for (const treeMeta of trees) {
            const data = TreeManager.getTreeData(treeMeta.id);
            if (data) {
                result.set(treeMeta.id, { name: treeMeta.name, data });
            }
        }

        return result;
    }

    private renderCards(canvas: HTMLElement): void {
        // Pre-compute presumed deceased set
        const presumedDeceased = this.computePresumedDeceased();

        // Get all trees for cross-tree matching (only if not in view mode)
        const allTrees = this.getAllTreesForCrossTreeMatching();
        const currentTreeId = DataManager.getCurrentTreeId();

        for (const [id, pos] of this.positions) {
            const person = DataManager.getPerson(id);
            if (!person) continue;

            const card = document.createElement('div');
            let classes = 'person-card';
            if (person.isPlaceholder) {
                classes += ' placeholder';
            } else {
                classes += ' ' + person.gender;
            }
            // Add focused class if this is the focus person
            if (this.focusPersonId && id === this.focusPersonId) {
                classes += ' focused';
            }
            card.className = classes;
            card.style.left = pos.x + 'px';
            card.style.top = pos.y + 'px';
            card.dataset.id = id;

            card.onclick = (e) => {
                const target = e.target as HTMLElement;
                if (target.classList.contains('add-btn') || target.classList.contains('branch-tab')) return;
                UI.showContextMenu(id, e);
            };

            const displayName = person.firstName || '?';
            const isDeceased = presumedDeceased.has(id);

            // Always display person's own lastName (maiden name for women)
            const displaySurname = person.lastName;

            // Format birth date - both full date and year only
            let birthYear = '';
            let birthFull = '';
            if (person.birthDate) {
                const parts = person.birthDate.split('-');
                birthYear = parts[0];
                if (parts.length === 3 && parts[1] !== '00' && parts[2] !== '00') {
                    // Full date available - format according to locale
                    const date = new Date(person.birthDate);
                    birthFull = date.toLocaleDateString();
                }
            }

            // Check for hidden partners (partners not in the visible/rendered set)
            let hiddenPartnersCount = 0;
            const allPartners = DataManager.getAllPartners(id);
            for (const partner of allPartners) {
                if (!this.positions.has(partner.id)) {
                    hiddenPartnersCount++;
                }
            }

            // Check for hidden families (partnerships with children where partner is not visible)
            // This indicates step-family situations that aren't shown in current view
            let hiddenFamiliesCount = 0;
            const partnerships = DataManager.getPartnerships(id);
            for (const partnership of partnerships) {
                const partnerId = partnership.person1Id === id ? partnership.person2Id : partnership.person1Id;
                // Count if: partner not visible AND partnership has children
                if (!this.positions.has(partnerId) && partnership.childIds.length > 0) {
                    hiddenFamiliesCount++;
                }
            }

            // Check if parents are currently visible
            const hasParents = person.parentIds.length > 0;
            const parentsVisible = hasParents &&
                person.parentIds.some(pid => this.positions.has(pid));

            // Check if children are currently visible
            const hasChildren = person.childIds.length > 0;
            const childrenVisible = hasChildren &&
                person.childIds.some(cid => this.positions.has(cid));

            // Check if siblings are currently visible
            const siblings = DataManager.getSiblings(id);
            const hasSiblings = siblings.length > 0;
            const siblingsVisible = hasSiblings &&
                siblings.some(s => this.positions.has(s.id));

            // Show branch tab if has hidden parents, children, or siblings
            const hasHiddenParents = hasParents && !parentsVisible;
            const hasHiddenChildren = hasChildren && !childrenVisible;
            const hasHiddenSiblings = hasSiblings && !siblingsVisible;

            let html = '';

            // Add branch tabs - separate button for each direction (displayed side by side)
            if (hasHiddenParents || hasHiddenChildren || hasHiddenSiblings) {
                html += `<div class="branch-tabs">`;
                if (hasHiddenParents) {
                    html += `<button class="branch-tab" data-action="focus-person" title="${strings.branchTabs.viewParents}">▲</button>`;
                }
                if (hasHiddenSiblings) {
                    html += `<button class="branch-tab" data-action="focus-person" title="${strings.branchTabs.viewSiblings}">◆</button>`;
                }
                if (hasHiddenChildren) {
                    html += `<button class="branch-tab" data-action="focus-person" title="${strings.branchTabs.viewFamily}">▼</button>`;
                }
                html += `</div>`;
            }

            // Add hidden relationship indicators (above card on left, mirror of branch tabs)
            if (hiddenPartnersCount > 0 || hiddenFamiliesCount > 0) {
                html += `<div class="hidden-indicators">`;
                if (hiddenPartnersCount > 0) {
                    html += `<button class="hidden-partners-btn" data-action="focus" title="${strings.focus.hiddenPartners(hiddenPartnersCount)}">+${hiddenPartnersCount}</button>`;
                }
                if (hiddenFamiliesCount > 0) {
                    html += `<button class="hidden-families-btn" data-action="focus" title="${strings.focus.hiddenFamilies(hiddenFamiliesCount)}">👨‍👩‍👧</button>`;
                }
                html += `</div>`;
            }

            html += `
                <div class="name"><span class="name-text">${this.escapeHtml(displayName)}</span>${isDeceased ? '<span class="deceased-marker">†</span>' : ''}</div>
                <div class="surname">${this.escapeHtml(displaySurname)}</div>
                ${birthYear ? `<div class="birth-date"><span class="date-year">${birthYear}</span>${birthFull ? `<span class="date-full">${birthFull}</span>` : ''}</div>` : ''}
                <button class="rel-link-icon" data-action="relationships" title="${strings.buttons.manageRelationships}">&#128279;</button>
            `;

            // Add buttons based on context
            // Top: Add parent (if < 2 parents)
            if (person.parentIds.length < 2) {
                html += `<button class="add-btn top" data-action="parent" title="${strings.contextMenu.addParent}">+</button>`;
            }
            // Right: Add partner
            html += `<button class="add-btn right" data-action="partner" title="${strings.contextMenu.addPartner}">+</button>`;
            // Bottom: Add child
            html += `<button class="add-btn bottom" data-action="child" title="${strings.contextMenu.addChild}">+</button>`;
            // Left: Add sibling
            html += `<button class="add-btn left" data-action="sibling" title="${strings.contextMenu.addSibling}">+</button>`;

            // Add cross-tree badge if person exists in other trees
            let crossTreeMatches: CrossTree.CrossTreeMatch[] = [];
            if (allTrees && currentTreeId && !person.isPlaceholder) {
                crossTreeMatches = CrossTree.findCrossTreeMatches(currentTreeId, person, allTrees);
                if (crossTreeMatches.length > 0) {
                    const tooltipItems = crossTreeMatches.slice(0, 5).map(m =>
                        `<div class="cross-tree-tooltip-item">
                            <div class="cross-tree-tooltip-tree">${this.escapeHtml(m.treeName)}</div>
                            <div class="cross-tree-tooltip-person">${this.escapeHtml(m.personName)}</div>
                        </div>`
                    ).join('');
                    const moreCount = crossTreeMatches.length > 5 ? crossTreeMatches.length - 5 : 0;

                    html += `<div class="cross-tree-badge" data-person-id="${id}" title="${strings.crossTree.badgeTitle(crossTreeMatches.length)}">
                        +${crossTreeMatches.length}
                        <div class="cross-tree-tooltip">
                            <div class="cross-tree-tooltip-header">${strings.crossTree.tooltipHeader}</div>
                            ${tooltipItems}
                            ${moreCount > 0 ? `<div class="cross-tree-tooltip-item">...${moreCount} more</div>` : ''}
                            <div class="cross-tree-tooltip-hint">${strings.crossTree.clickToSwitch}</div>
                        </div>
                    </div>`;
                }
            }

            card.innerHTML = html;

            // Attach event listeners for branch tabs (may have multiple)
            const branchTabs = card.querySelectorAll('.branch-tab');
            branchTabs.forEach(tab => {
                tab.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // Focus on this person - will show them with their parents/children
                    this.setFocus(id);
                });
            });

            // Attach event listener for relationships icon
            const relIcon = card.querySelector('.rel-link-icon');
            if (relIcon) {
                relIcon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    UI.showRelationshipsPanel(id);
                });
            }

            // Attach event listener for hidden partners button (toggle to hidden partner)
            const hiddenPartnersBtn = card.querySelector('.hidden-partners-btn');
            if (hiddenPartnersBtn) {
                hiddenPartnersBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const hiddenPartners = this.getHiddenPartners(id);
                    if (hiddenPartners.length === 1) {
                        // Toggle: focus on the single hidden partner
                        this.setFocus(hiddenPartners[0].id);
                    } else if (hiddenPartners.length > 1) {
                        // Show selection dialog for multiple hidden partners
                        UI.showPartnerSelectionDialog(id, hiddenPartners);
                    }
                });
            }

            // Attach event listener for hidden families button (focus to show other families)
            const hiddenFamiliesBtn = card.querySelector('.hidden-families-btn');
            if (hiddenFamiliesBtn) {
                hiddenFamiliesBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const hiddenFamilyPartners = this.getHiddenFamilyPartners(id);
                    if (hiddenFamilyPartners.length === 1) {
                        // Single hidden family: focus on that partner
                        this.setFocus(hiddenFamilyPartners[0].id);
                    } else if (hiddenFamilyPartners.length > 1) {
                        // Multiple hidden families: show selection dialog
                        UI.showPartnerSelectionDialog(id, hiddenFamilyPartners);
                    }
                });
            }

            // Attach event listeners to add buttons
            card.querySelectorAll('.add-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = (btn as HTMLElement).dataset.action as 'parent' | 'child' | 'partner' | 'sibling';
                    UI.addRelation(id, action);
                });
            });

            // Attach event listener for cross-tree badge (cycle through trees)
            const crossTreeBadge = card.querySelector('.cross-tree-badge');
            if (crossTreeBadge && currentTreeId && crossTreeMatches.length > 0) {
                crossTreeBadge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const nextMatch = CrossTree.getNextMatch(currentTreeId, id, crossTreeMatches);
                    if (nextMatch) {
                        UI.switchToTreeAndFocus(nextMatch.treeId, nextMatch.personId);
                    }
                });
            }

            canvas.appendChild(card);
        }
    }

    private renderLines(svg: SVGSVGElement): void {
        // In debug mode with step < 7, don't render lines (only boxes)
        const skipLines = this.debugOptions?.enabled && this.debugOptions.step < 7;

        if (!skipLines) {
            // PHASE 1: Draw spouse lines from layout engine
            for (const spouseLine of this.spouseLines) {
                const partnership = spouseLine.partnershipId
                    ? DataManager.getPartnership(spouseLine.partnershipId)
                    : null;
                const lineStyle = partnership
                    ? this.getLineStyleForStatus(partnership.status)
                    : {};

                this.drawLine(svg, spouseLine.xMin, spouseLine.y, spouseLine.xMax, spouseLine.y, lineStyle);
            }

            // PHASE 2: Render cluster connections (simple lines, no jump detection)
            // Note: Single-parent children are handled by the layout engine via buildDescendantBlocksFallback
            this.renderClusterConnections(svg);
        }

        // Render debug overlay if enabled (after clearing lines)
        this.renderDebugOverlay(svg);

        // Render pipeline debug overlay if debug mode active
        this.renderPipelineDebugOverlay(svg);
    }

    /**
     * Render connections using bus routing (T-shape layout)
     * Uses pre-calculated connections from layout engine
     *
     * Structure: stem (vertical) → connector (horizontal, at connectorY) →
     *            junction (vertical, connectorY to branchY) → bus (at branchY) → drops
     */
    private renderClusterConnections(svg: SVGSVGElement): void {
        for (const conn of this.connections) {
            // Vertical stem from parent down to connectorY (= stemBottomY)
            this.drawLine(svg, conn.stemX, conn.stemTopY, conn.stemX, conn.connectorY);

            // Horizontal connector from stem to bus junction point (if stem outside bus range)
            if (conn.connectorFromX !== conn.connectorToX) {
                this.drawLine(svg, conn.connectorFromX, conn.connectorY, conn.connectorToX, conn.connectorY);

                // Vertical junction from connectorY to branchY (if connector on different lane)
                if (Math.abs(conn.connectorY - conn.branchY) > 0.5) {
                    this.drawLine(svg, conn.connectorToX, conn.connectorY, conn.connectorToX, conn.branchY);
                }
            } else {
                // Stem is within bus range - extend stem to branchY if needed
                if (Math.abs(conn.connectorY - conn.branchY) > 0.5) {
                    this.drawLine(svg, conn.stemX, conn.connectorY, conn.stemX, conn.branchY);
                }
            }

            // Horizontal bus (branch) - only over children
            this.drawLine(svg, conn.branchLeftX, conn.branchY, conn.branchRightX, conn.branchY);

            // Drops to each child - simple vertical lines from bus
            for (const drop of conn.drops) {
                this.drawLine(svg, drop.x, conn.branchY, drop.x, drop.bottomY);
            }
        }
    }

    /**
     * Toggle debug overlay for visual verification of anchor points and junctions
     */
    setDebugOverlay(enabled: boolean): void {
        this.debugOverlay = enabled;
        this.render();
    }

    /**
     * Render pipeline debug overlay with geometry visualization.
     */
    private renderPipelineDebugOverlay(svg: SVGSVGElement): void {
        if (!this.debugOptions?.enabled || !this.currentDebugSnapshot) {
            clearDebugOverlay(svg);
            debugPanel.hide();
            return;
        }

        const snapshot = this.currentDebugSnapshot;

        // Render SVG overlay if geometry is available
        if (snapshot.geometry) {
            renderDebugOverlay(svg, snapshot.geometry);
        }

        // Update debug panel
        debugPanel.update(snapshot, this.debugOptions, this.config);
    }

    /**
     * Render debug overlay showing anchor points on cards and junction points on connections
     */
    private renderDebugOverlay(svg: SVGSVGElement): void {
        if (!this.debugOverlay) return;

        const { cardWidth, cardHeight } = this.config;

        // Anchor points on cards
        for (const [_personId, pos] of this.positions) {
            // topCenter (green) - where connections from parents arrive
            this.drawDebugDot(svg, pos.x + cardWidth / 2, pos.y, '#00FF00');
            // bottomCenter (blue) - where connections to children depart
            this.drawDebugDot(svg, pos.x + cardWidth / 2, pos.y + cardHeight, '#0000FF');
            // leftCenter/rightCenter (yellow) - for spouse lines
            this.drawDebugDot(svg, pos.x, pos.y + cardHeight / 2, '#FFFF00');
            this.drawDebugDot(svg, pos.x + cardWidth, pos.y + cardHeight / 2, '#FFFF00');
        }

        // Spouse line centers (magenta) - where stems should start for couples
        for (const sl of this.spouseLines) {
            const centerX = (sl.xMin + sl.xMax) / 2;
            this.drawDebugDot(svg, centerX, sl.y, '#FF00FF', 5);
        }

        // Junction points on connections (red)
        for (const conn of this.connections) {
            // Stem-to-branch junction
            this.drawDebugDot(svg, conn.stemX, conn.branchY, '#FF0000', 4);
            // Branch-to-drop junctions
            for (const drop of conn.drops) {
                this.drawDebugDot(svg, drop.x, conn.branchY, '#FF0000', 4);
            }
        }
    }

    private drawDebugDot(svg: SVGSVGElement, x: number, y: number, color: string, radius: number = 3): void {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(x));
        circle.setAttribute('cy', String(y));
        circle.setAttribute('r', String(radius));
        circle.setAttribute('fill', color);
        circle.setAttribute('stroke', '#000');
        circle.setAttribute('stroke-width', '0.5');
        circle.setAttribute('opacity', '0.8');
        svg.appendChild(circle);
    }

    private getLineStyleForStatus(status: import('./types.js').PartnershipStatus): { dashArray?: string; color?: string } {
        switch (status) {
            case 'divorced':
                return { dashArray: '8,4', color: '#999' };
            case 'separated':
                return { dashArray: '4,4', color: '#999' };
            case 'partners':
                return { dashArray: '2,2' };
            case 'married':
            default:
                return {};
        }
    }

    private drawLine(svg: SVGSVGElement, x1: number, y1: number, x2: number, y2: number, style?: { dashArray?: string; color?: string }): void {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(x2));
        line.setAttribute('y2', String(y2));
        if (style?.dashArray) {
            line.setAttribute('stroke-dasharray', style.dashArray);
        }
        if (style?.color) {
            line.setAttribute('stroke', style.color);
        }
        svg.appendChild(line);
    }

    private updateSVGSize(svg: SVGSVGElement): void {
        let maxX = 500;
        let maxY = 500;

        for (const pos of this.positions.values()) {
            maxX = Math.max(maxX, pos.x + this.config.cardWidth + 100);
            maxY = Math.max(maxY, pos.y + this.config.cardHeight + 100);
        }

        svg.setAttribute('width', String(maxX));
        svg.setAttribute('height', String(maxY));
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    // Public getter for positions (used by export)
    getPositions(): Map<PersonId, Position> {
        return this.positions;
    }

    // Public getter for visible person IDs
    getVisiblePersonIds(): Set<PersonId> {
        return new Set(this.positions.keys());
    }
}

export const TreeRenderer = new TreeRendererClass();
