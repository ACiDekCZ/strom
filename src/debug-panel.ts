/**
 * Debug Panel - DOM Statistics Display
 *
 * Shows layout pipeline debug information in a floating panel.
 */

import {
    DebugSnapshot,
    DebugOptions
} from './layout/pipeline/debug-types.js';
import { BranchModel } from './layout/pipeline/types.js';
import { LayoutConfig } from './types.js';

/**
 * Debug panel class for displaying layout pipeline statistics.
 */
export class DebugPanel {
    private element: HTMLElement | null = null;
    private isVisible = false;

    /**
     * Create or get the debug panel element.
     */
    private ensureElement(): HTMLElement {
        if (this.element) return this.element;

        this.element = document.createElement('div');
        this.element.className = 'debug-panel';
        this.element.innerHTML = `
            <div class="debug-panel-header">
                <span class="debug-panel-title">Layout Debug</span>
                <button class="debug-panel-close">&times;</button>
            </div>
            <div class="debug-panel-content"></div>
        `;

        // Close button handler
        const closeBtn = this.element.querySelector('.debug-panel-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hide());
        }

        document.body.appendChild(this.element);
        return this.element;
    }

    /**
     * Show the debug panel.
     */
    show(): void {
        const el = this.ensureElement();
        el.style.display = 'block';
        this.isVisible = true;
    }

    /**
     * Hide the debug panel.
     */
    hide(): void {
        if (this.element) {
            this.element.style.display = 'none';
        }
        this.isVisible = false;
    }

    /**
     * Toggle panel visibility.
     */
    toggle(): void {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    /**
     * Update the panel with snapshot data.
     */
    update(snapshot: DebugSnapshot, options: DebugOptions, config: LayoutConfig): void {
        const el = this.ensureElement();
        const content = el.querySelector('.debug-panel-content');
        if (!content) return;

        const html = this.renderContent(snapshot, options, config);
        content.innerHTML = html;

        this.show();
    }

    /**
     * Render panel content HTML.
     */
    private renderContent(snapshot: DebugSnapshot, options: DebugOptions, _config: LayoutConfig): string {
        const parts: string[] = [];

        // Pipeline step section
        parts.push(`
            <div class="debug-section">
                <div class="debug-section-title">Pipeline Step</div>
                <div class="debug-step-badge">
                    Step ${snapshot.step}/${options.step}: ${snapshot.stepName}
                </div>
            </div>
        `);

        // Counts section (only if we have model data)
        if (snapshot.model || snapshot.genModel) {
            const personCount = snapshot.model?.persons.size ?? 0;
            const unionCount = snapshot.model?.unions.size ?? 0;
            const edgeCount = snapshot.model?.edges.length ?? 0;
            const genCount = snapshot.genModel
                ? (snapshot.genModel.maxGen - snapshot.genModel.minGen + 1)
                : 0;

            parts.push(`
                <div class="debug-section">
                    <div class="debug-section-title">Counts</div>
                    <div class="debug-badges-row">
                        <div class="debug-count-badge">
                            <span class="debug-count-value">${personCount}</span>
                            <span class="debug-count-label">Pers.</span>
                        </div>
                        <div class="debug-count-badge">
                            <span class="debug-count-value">${unionCount}</span>
                            <span class="debug-count-label">Unio.</span>
                        </div>
                        <div class="debug-count-badge">
                            <span class="debug-count-value">${edgeCount}</span>
                            <span class="debug-count-label">Edges</span>
                        </div>
                        <div class="debug-count-badge">
                            <span class="debug-count-value">${genCount}</span>
                            <span class="debug-count-label">Gens</span>
                        </div>
                    </div>
                </div>
            `);
        }

        // Constraint solver section (only for step 6+)
        if (snapshot.constrained) {
            const iterations = snapshot.constrained.iterations;
            const maxViolation = snapshot.constrained.finalMaxViolation.toFixed(1);

            parts.push(`
                <div class="debug-section">
                    <div class="debug-section-title">Constraint Solver</div>
                    <div class="debug-solver-stats">
                        Iterations: <strong>${iterations}</strong> &nbsp; Max: <strong>${maxViolation}px</strong>
                    </div>
                </div>
            `);
        }

        // Branch info section (only for step 4+)
        if (snapshot.measured) {
            const bm = snapshot.measured as BranchModel;
            if (bm.branches && bm.branches.size > 0) {
                const topLevel = bm.topLevelBranchIds?.length ?? 0;
                const total = bm.branches.size;

                parts.push(`
                    <div class="debug-section">
                        <div class="debug-section-title">Branches</div>
                        <div class="debug-solver-stats">
                            Top-level: <strong>${topLevel}</strong> &nbsp; Total: <strong>${total}</strong>
                        </div>
                    </div>
                `);
            }
        }

        // Validation section (only for step 5+)
        if (snapshot.validation) {
            const v = snapshot.validation;
            const statusClass = v.allPassed ? 'pass' : 'fail';
            const statusText = v.allPassed ? 'PASS' : 'FAIL';

            parts.push(`
                <div class="debug-section">
                    <div class="debug-section-title">
                        Validation
                        <span class="debug-validation-status ${statusClass}">${statusText}</span>
                    </div>
                    <div class="debug-badges-row">
                        <div class="debug-validation-badge ${v.boxOverlapCount > 0 ? 'error' : ''}">
                            <span class="debug-count-value">${v.boxOverlapCount}</span>
                            <span class="debug-count-label">Box</span>
                        </div>
                        <div class="debug-validation-badge ${v.spanOverlapCount > 0 ? 'error' : ''}">
                            <span class="debug-count-value">${v.spanOverlapCount}</span>
                            <span class="debug-count-label">Span</span>
                        </div>
                        <div class="debug-validation-badge ${v.edgeCrossingCount > 0 ? 'error' : ''}">
                            <span class="debug-count-value">${v.edgeCrossingCount}</span>
                            <span class="debug-count-label">Cross</span>
                        </div>
                    </div>
                </div>
            `);

            // Centering errors (top 10)
            if (v.centeringErrors.length > 0) {
                const topErrors = v.centeringErrors.slice(0, 10);
                const errorRows = topErrors.map((e, i) =>
                    `<div class="debug-error-row">
                        <span class="debug-error-num">${i + 1}.</span>
                        <span class="debug-error-id">${this.truncateId(e.unionId)}</span>
                        <span class="debug-error-value">${e.errorPx.toFixed(1)}px</span>
                    </div>`
                ).join('');

                parts.push(`
                    <div class="debug-section">
                        <div class="debug-section-title">
                            Top ${topErrors.length} Centering Errors
                        </div>
                        <div class="debug-errors-list">
                            ${errorRows}
                        </div>
                    </div>
                `);
            }
        }

        return parts.join('');
    }

    /**
     * Truncate a union ID for display.
     */
    private truncateId(id: string): string {
        if (id.length <= 12) return id;
        return id.slice(0, 10) + '...';
    }

    /**
     * Destroy the panel and clean up.
     */
    destroy(): void {
        if (this.element) {
            this.element.remove();
            this.element = null;
        }
        this.isVisible = false;
    }
}

// Singleton instance
export const debugPanel = new DebugPanel();
