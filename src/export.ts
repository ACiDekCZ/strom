/**
 * AppExporter - Export the entire app as a standalone HTML file
 */

import { TreeManager } from './tree-manager.js';
import { UI } from './ui.js';
import { strings } from './strings.js';
import { TreeId, StromData, EmbeddedDataEnvelope, APP_VERSION, generateExportId } from './types.js';
import { encrypt, EncryptedData } from './crypto.js';

class AppExporterClass {
    /**
     * Check if we're running from a built version (strom.html with inlined JS)
     * vs dev server (index.html with external bundle.js)
     */
    private isBuiltVersion(): boolean {
        // Check if script is inlined (no external bundle.js reference)
        const scripts = document.querySelectorAll('script[src="dist/bundle.js"]');
        return scripts.length === 0;
    }

    /**
     * Clean dynamic UI state from HTML before export
     * Removes active classes only from specific UI elements (modals, menus, dropdowns)
     * Does NOT remove from: merge-step, merge-tab (they need active as default state)
     */
    private cleanDynamicState(html: string): string {
        const elementsToClean = ['modal-overlay', 'mobile-menu', 'tree-switcher-dropdown'];

        let result = html;
        for (const element of elementsToClean) {
            const regex = new RegExp(`(class="[^"]*\\b${element}\\b[^"]*)"`, 'g');
            result = result.replace(regex, (match) => {
                return match
                    .replace(/\bactive\b/g, '')
                    .replace(/\s+/g, ' ')
                    .replace(/" $/, '"')
                    .replace(/=" /g, '="');
            });
        }

        // Hide context menu
        result = result.replace(/(class="context-menu[^"]*")([^>]*?)>/g, '$1 style="display:none">');

        return result;
    }

    /**
     * Get clean HTML for export (only works from built version)
     */
    private getExportHtml(): string {
        return this.cleanDynamicState(document.documentElement.outerHTML);
    }

    /**
     * Export the app with specific or current tree data embedded
     * The exported HTML will work standalone without any server
     * @param treeId Optional tree ID to export (defaults to active tree)
     * @param password Optional password to encrypt the exported data
     */
    async exportApp(treeId?: TreeId, password?: string | null): Promise<void> {
        // Export only works from built version (strom.html)
        if (!this.isBuiltVersion()) {
            UI.showAlert(strings.export.devModeNotSupported, 'warning');
            return;
        }

        try {
            // Determine which tree to export
            const targetTreeId = treeId || UI.getExportTargetTreeId() || TreeManager.getActiveTreeId();
            if (!targetTreeId) {
                UI.showAlert(strings.export.failed, 'error');
                return;
            }

            // Get clean HTML (with inline JavaScript)
            const html = this.getExportHtml();

            // Get data for the specified tree
            const data = TreeManager.getTreeData(targetTreeId);
            if (!data) {
                UI.showAlert(strings.export.failed, 'error');
                return;
            }

            // Get tree metadata
            const treeMetadata = TreeManager.getTreeMetadata(targetTreeId);
            const treeName = treeMetadata?.name || 'Family Tree';

            // Generate export ID
            const exportId = generateExportId();

            // Prepare data for embedding (optionally encrypted)
            let embedDataContent: StromData | EncryptedData = data;
            if (password) {
                embedDataContent = await encrypt(JSON.stringify(data), password);
            }

            // Create envelope with metadata
            const envelope: EmbeddedDataEnvelope = {
                exportId,
                exportedAt: new Date().toISOString(),
                appVersion: APP_VERSION,
                treeName,
                data: embedDataContent
            };

            // Track last export ID in the source tree
            TreeManager.setLastExportId(targetTreeId, exportId);

            // Create embedded data script
            const dataScript = `<script>window.STROM_EMBEDDED_DATA = ${JSON.stringify(envelope)};<\/script>`;

            // Insert data before </head>
            let exportedHtml = html.replace('</head>', `${dataScript}\n</head>`);

            // Get tree name for filename
            const safeName = treeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            const filename = `strom-${safeName || 'family-tree'}.html`;

            // Download
            this.downloadHtml(exportedHtml, filename);
        } catch (error) {
            console.error('Export failed:', error);
            UI.showAlert(strings.export.failed, 'error');
        }
    }

    /**
     * Export all trees as a single standalone HTML app
     * @param password Optional password to encrypt the exported data
     */
    async exportAllAsApp(password?: string | null): Promise<void> {
        // Export only works from built version (strom.html)
        if (!this.isBuiltVersion()) {
            UI.showAlert(strings.export.devModeNotSupported, 'warning');
            return;
        }

        try {
            // Get clean HTML (with inline JavaScript)
            const html = this.getExportHtml();

            // Collect all trees data (including isHidden flag)
            const trees = TreeManager.getTrees();
            const allTreesData: Record<string, { name: string; data: StromData; isHidden?: boolean }> = {};

            for (const tree of trees) {
                const data = TreeManager.getTreeData(tree.id);
                if (data) {
                    allTreesData[tree.id] = {
                        name: tree.name,
                        data,
                        // Include isHidden flag if set
                        ...(tree.isHidden ? { isHidden: true } : {})
                    };
                }
            }

            // Use active tree as the primary embedded data
            const activeTreeId = TreeManager.getActiveTreeId();
            const activeData = activeTreeId ? TreeManager.getTreeData(activeTreeId) : null;
            const activeTreeMeta = activeTreeId ? TreeManager.getTreeMetadata(activeTreeId) : null;

            // Generate export ID for the main tree
            const exportId = generateExportId();

            // Prepare data for embedding (optionally encrypted)
            let embedActiveDataContent: StromData | EncryptedData | null = activeData;
            let embedAllTrees: Record<string, { name: string; data: StromData; isHidden?: boolean }> | EncryptedData = allTreesData;

            if (password) {
                if (activeData) {
                    embedActiveDataContent = await encrypt(JSON.stringify(activeData), password);
                }
                embedAllTrees = await encrypt(JSON.stringify(allTreesData), password);
            }

            // Create envelope for the active tree
            const envelope: EmbeddedDataEnvelope | null = activeData ? {
                exportId,
                exportedAt: new Date().toISOString(),
                appVersion: APP_VERSION,
                treeName: activeTreeMeta?.name || 'All Trees',
                data: embedActiveDataContent!
            } : null;

            // Create embedded data script (with active tree data as envelope)
            const dataScript = `<script>window.STROM_EMBEDDED_DATA = ${JSON.stringify(envelope)};window.STROM_ALL_TREES = ${JSON.stringify(embedAllTrees)};<\/script>`;

            // Insert data before </head>
            let exportedHtml = html.replace('</head>', `${dataScript}\n</head>`);

            // Download with "all-trees" filename
            this.downloadHtml(exportedHtml, 'strom-all-trees.html');
        } catch (error) {
            console.error('Export all failed:', error);
            UI.showAlert(strings.export.failed, 'error');
        }
    }

    /**
     * Export focused (visible) data as standalone HTML app
     * Used by UI for "Export Focus as App" feature
     * @param focusedData The focused/visible data to export
     * @param filename The filename for the export
     * @param password Optional password to encrypt the exported data
     */
    async exportFocusAsApp(focusedData: StromData, filename: string, password?: string | null): Promise<void> {
        // Export only works from built version (strom.html)
        if (!this.isBuiltVersion()) {
            UI.showAlert(strings.export.devModeNotSupported, 'warning');
            return;
        }

        try {
            // Get clean HTML (with inline JavaScript)
            const html = this.getExportHtml();

            // Generate export ID for focused export
            const exportId = generateExportId();

            // Prepare data for embedding (optionally encrypted)
            let embedDataContent: StromData | EncryptedData = focusedData;
            if (password) {
                embedDataContent = await encrypt(JSON.stringify(focusedData), password);
            }

            // Create envelope with metadata
            const envelope: EmbeddedDataEnvelope = {
                exportId,
                exportedAt: new Date().toISOString(),
                appVersion: APP_VERSION,
                treeName: 'Focused Export',
                data: embedDataContent
            };

            // Create embedded data script with focused data
            const dataScript = `<script>window.STROM_EMBEDDED_DATA = ${JSON.stringify(envelope)};<\/script>`;

            // Insert data before </head>
            const exportedHtml = html.replace('</head>', `${dataScript}\n</head>`);

            // Download
            this.downloadHtml(exportedHtml, filename);
        } catch (error) {
            console.error('Export focus as app failed:', error);
            UI.showAlert(strings.export.failed, 'error');
        }
    }

    /**
     * Helper to download HTML content as a file
     */
    private downloadHtml(html: string, filename: string): void {
        const blob = new Blob([html], { type: 'text/html' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);

        // Mark as exported for embedded mode unsaved changes tracking
        UI.markExported();
    }
}

export const AppExporter = new AppExporterClass();
