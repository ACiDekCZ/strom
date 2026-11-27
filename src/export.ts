/**
 * AppExporter - Export the entire app as a standalone HTML file
 */

import { TreeManager } from './tree-manager.js';
import { noteExportAll } from './research-device.js';
import { getUI } from './ui-ref.js';
import { strings } from './strings.js';
import { TreeId, StromData, EmbeddedDataEnvelope } from './types.js';
import { generateExportId } from './ids.js';
import { APP_VERSION } from './version.js';
import { encrypt, EncryptedData } from './crypto.js';
import { AuditLogManager } from './audit-log.js';
import { applyLivingPrivacy, applyContentOptions, ContentOptions, PrivacyMode } from './privacy.js';
import { safeFileName } from './filenames.js';
import { storedTreeWithRefs } from './data.js';
import { expandedData, poolRefSnapshot } from './image-expand.js';
import { scriptSafeJson, htmlFileWithImages, jsonFileWithImages, countPoolRefs } from './image-stream.js';
import type { Spool } from './spool.js';

/**
 * Clean dynamic UI state from HTML before export: drop 'active' from specific
 * UI elements (modals, menus, dropdowns) and hide the context menu.
 * Does NOT touch merge-step / merge-tab (they need active as default state).
 *
 * The cleanup must NEVER run over <script> contents — the inlined bundle can
 * legitimately contain these class names inside string literals (e.g. menu
 * markup templates), and rewriting them corrupts the exported app's code.
 * The HTML is therefore split on script blocks and only markup outside them
 * is cleaned. Exported for tests.
 */
export function cleanDynamicState(html: string): string {
    return html
        .split(/(<script[\s\S]*?<\/script>)/g)
        .map(part => part.startsWith('<script') ? part : cleanDynamicMarkup(part))
        .join('');
}

function cleanDynamicMarkup(html: string): string {
    const elementsToClean = ['modal-overlay', 'tree-switcher-dropdown'];

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
 * Containers the app fills at runtime with person data (tree cards and lines,
 * alternative views, person dialog sections, pickers, lists). They are empty
 * in the page template, so emptying them in the export clone is always safe.
 * Defense in depth: the export normally starts from the pristine template
 * captured at load; this list also covers a fallback to the live document.
 */
export const EXPORT_DYNAMIC_CONTAINER_IDS: readonly string[] = [
    // Tree view + alternative views
    'tree-canvas', 'tree-lines', 'gen-labels', 'timeline-container', 'map-container', 'table-container',
    'fan-chart', 'slideshow-caption', 'places-datalist',
    // Toolbar / focus / badges
    'current-tree-name', 'current-tree-conn', 'toolbar-search-picker', 'search-result-count', 'toolbar-focus-name',
    'toolbar-focus-count', 'focus-name', 'focus-person-count', 'actions-tree-name',
    'collab-bar-text', 'descendants-badge-text', 'otd-text', 'tree-switcher-dropdown',
    // Person dialog
    'pm-avatar', 'pm-name', 'modal-title', 'birthdate-estimate', 'duplicate-suggest-person',
    'pm-sum-relations', 'pm-lifeline-body', 'pm-sum-deathevents', 'events-list', 'pm-sum-sources',
    'person-sources-chips', 'attachments-list', 'attachments-total', 'pm-sum-story', 'story-facts',
    'pm-sum-photonotes', 'photo-preview', 'photo-size',
    // Event / source / relation dialogs and pickers
    'event-editor-title', 'event-participants-list', 'event-sources-chips', 'sources-list',
    'source-editor-title', 'participant-picker', 'source-picker-list', 'relation-title',
    'rel-other-parent-select', 'duplicate-suggest-relation', 'existing-person-picker',
    'confirm-title', 'confirm-message', 'confirm-options', 'relationships-title',
    'relationships-content', 'default-person-picker',
    // Lists and summaries
    'about-stats-row', 'about-stats-total-row', 'snapshots-list', 'anniversaries-list',
    'audit-log-list', 'export-modal-tree-name', 'existing-export-tree-name',
    // Wizards, merge and share dialogs
    'family-wizard-anchor', 'wiz-parents', 'wiz-partner', 'wiz-siblings', 'wiz-children',
    'merge-route', 'merge-progress', 'merge-counts', 'merge-step-body', 'merge-next-why',
    'merge-validation-banner', 'merge-manual-incoming',
    'merge-manual-picker', 'person-merge-keep', 'person-merge-picker', 'person-merge-other',
    'person-merge-delete-info', 'person-merge-field-conflicts', 'person-merge-partnership-list',
    'share-welcome-title', 'share-welcome-counts', 'share-reply-title',
    'share-reply-intro', 'share-packet-title', 'share-packet-intro', 'share-packet-body',
];

/** Template children of #tree-canvas the export keeps (emptied through their own entries above). */
const CANVAS_KEPT_CHILD_IDS: readonly string[] = ['tree-lines', 'gen-labels'];

/** Minimal element surface used by the export sanitizer (keeps it testable without a DOM). */
interface SanitizableElement {
    readonly id: string;
    readonly children: ArrayLike<SanitizableElement>;
    remove(): void;
    replaceChildren(): void;
}

/**
 * Empty every runtime-filled container in an export clone. The tree canvas
 * keeps its (emptied) #tree-lines SVG and #gen-labels layer, which the app
 * looks up by id. Exported for tests.
 */
export function sanitizeExportClone(root: { querySelector(selector: string): unknown }): void {
    for (const id of EXPORT_DYNAMIC_CONTAINER_IDS) {
        const el = root.querySelector('#' + id) as SanitizableElement | null;
        if (!el) continue;
        if (id === 'tree-canvas') {
            Array.from(el.children).forEach(c => { if (!CANVAS_KEPT_CHILD_IDS.includes(c.id)) c.remove(); });
        } else {
            el.replaceChildren();
        }
    }
}

/**
 * Drop embedded-data scripts from a document clone. DOM-based removal, NOT a
 * regex over the HTML: the bundle's own code contains the literal
 * '<script>window.STROM_EMBEDDED_DATA =' inside a template string, and a regex
 * sweep would eat the rest of the bundle.
 */
function stripEmbeddedDataScripts(root: HTMLElement): void {
    root.querySelectorAll('script').forEach(s => {
        const t = s.textContent?.trimStart() ?? '';
        if (t.startsWith('window.STROM_EMBEDDED_')) s.remove();
    });
}

/**
 * The page as parsed, before any rendering. The bundle script is the last
 * element of <body>, so at module evaluation the whole template is in the DOM
 * but nothing has been rendered yet. Embedded data is stripped right away so
 * the snapshot does not keep a second copy of a large tree in memory.
 */
let pristineTemplate: HTMLElement | null = null;
if (typeof document !== 'undefined' && document.documentElement) {
    pristineTemplate = document.documentElement.cloneNode(true) as HTMLElement;
    stripEmbeddedDataScripts(pristineTemplate);
}

/**
 * Serialize a value for embedding inside an inline <script>. '<' is escaped
 * so no string value can close the script element ('</script>') or open a
 * comment/CDATA; U+2028/U+2029 are escaped for pre-ES2019 parsers. The output
 * is still valid JSON, so readers can JSON.parse it unchanged.
 */
export function jsonForScript(value: unknown): string {
    return scriptSafeJson(JSON.stringify(value));
}

/**
 * A share baseline of the data a saved app carries (share-baselines.ts),
 * taken now and saved when the returned function is called — once the file
 * is written, so the two never hold the images at once (spec 135 D10c: the
 * export does not expand the tree; the baseline keeps its images whole, as
 * before, its JSON read from the pool a few images at a time). `spool`:
 * that JSON written to its file (a large tree, spool.ts), let go of once saved.
 */
function exportBaseline(treeId: TreeId, exportId: string, data: StromData, spool?: Spool | null): () => void {
    const kept: StromData | string = countPoolRefs(data) > 0 ? poolRefSnapshot(data) : JSON.stringify(data);
    return () => {
        void (async () => {
            const { saveBaselineJson } = await import('./share-baselines.js');
            // With its images read from the pool as a Blob: a tree whose images weigh gigabytes is never one text (1127).
            const json = typeof kept === 'string' ? kept : (await jsonFileWithImages(kept, { spool })).blob;
            try {
                await saveBaselineJson(treeId, exportId, json, Date.now());
            } finally {
                if (typeof json !== 'string') await spool?.drop(json);
            }
        })().catch(() => {});
    };
}

/**
 * Insert a script before </head>. The function form of replace() is required:
 * a string replacement would interpret "$'", "$&" etc. inside user data.
 */
export function injectBeforeHeadEnd(html: string, script: string): string {
    return html.replace('</head>', () => `${script}\n</head>`);
}

/** Collaboration fields carried into the export envelope ("send to a relative"). */
export interface ShareOptions {
    senderMessage?: string;
    senderName?: string;
    replyToExportId?: string;
}

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
     * Get clean HTML for export (only works from built version).
     * When exporting FROM an embedded copy (a relative re-shares the file),
     * the page snapshot already contains the ORIGINAL embedded-data script —
     * strip it, otherwise the file carries two envelopes and importers that
     * read the first one get stale data.
     */
    private getExportHtml(): string {
        // Start from the page as it was BEFORE anything rendered (captured at
        // bundle load); the live DOM carries the on-screen tree, open dialogs
        // and view contents of whatever tree is displayed, which must never
        // leak into an export of another (privacy-filtered, encrypted) tree.
        const clone = (pristineTemplate ?? document.documentElement).cloneNode(true) as HTMLElement;
        stripEmbeddedDataScripts(clone);
        sanitizeExportClone(clone);
        return cleanDynamicState(clone.outerHTML);
    }

    /**
     * Export the app with specific or current tree data embedded
     * The exported HTML will work standalone without any server
     * @param treeId Optional tree ID to export (defaults to active tree)
     * @param password Optional password to encrypt the exported data
     */
    async exportApp(treeId?: TreeId, password?: string | null, privacyMode: PrivacyMode = 'full', content: boolean | ContentOptions = false, share?: ShareOptions): Promise<void> {
        // Export only works from built version (strom.html)
        if (!this.isBuiltVersion()) {
            getUI().showAlert(strings.export.devModeNotSupported, 'warning');
            return;
        }

        try {
            // Determine which tree to export
            const targetTreeId = treeId || getUI().getExportTargetTreeId() || TreeManager.getActiveTreeId();
            if (!targetTreeId) {
                getUI().showAlert(strings.export.failed, 'error');
                return;
            }

            // Get clean HTML (with inline JavaScript)
            const html = this.getExportHtml();

            // Get data for the specified tree (privacy filter applied to a copy); its pooled images
            // stay references until the file is written (image-stream.ts).
            const rawData = await storedTreeWithRefs(targetTreeId);
            if (!rawData) {
                getUI().showAlert(strings.export.failed, 'error');
                return;
            }
            let data = applyLivingPrivacy(rawData, privacyMode);
            data = applyContentOptions(data, content);

            // Get tree metadata
            const treeMetadata = TreeManager.getTreeMetadata(targetTreeId);
            const treeName = treeMetadata?.name || 'Family Tree';

            // Generate export ID
            const exportId = generateExportId();

            // Prepare data for embedding (optionally encrypted: sealed whole, its images expanded)
            let embedDataContent: StromData | EncryptedData = data;
            if (password) {
                embedDataContent = await encrypt(JSON.stringify(await expandedData(data)), password);
            }

            // Create envelope with metadata
            const envelope: EmbeddedDataEnvelope = {
                exportId,
                exportedAt: new Date().toISOString(),
                appVersion: APP_VERSION,
                treeName,
                data: embedDataContent,
                ...(share?.senderMessage ? { senderMessage: share.senderMessage } : {}),
                ...(share?.senderName ? { senderName: share.senderName } : {}),
                ...(share?.replyToExportId ? { replyToExportId: share.replyToExportId } : {})
            };

            // Track last export ID in the source tree, and keep a local baseline
            // of exactly what was shared so a change packet can be reconstructed.
            TreeManager.setLastExportId(targetTreeId, exportId);
            const baseline = exportBaseline(targetTreeId, exportId, data);

            // The embedded data script inserted before </head>, its images read as the file is written.
            const file = await htmlFileWithImages(html, envelope, (e) => `<script>window.STROM_EMBEDDED_DATA = ${jsonForScript(e)};<\/script>`);

            // Get tree name for filename
            const filename = `strom-${safeFileName(treeName, 'family-tree')}.html`;

            // Download
            this.downloadHtml(file.blob, filename);
            if (privacyMode === 'full') TreeManager.noteFileCopy([targetTreeId], { [targetTreeId]: data });
            baseline();
        } catch (error) {
            console.error('Export failed:', error);
            getUI().showAlert(strings.export.failed, 'error');
        }
    }

    /**
     * Export all trees as a single standalone HTML app
     * @param password Optional password to encrypt the exported data
     * @param includeAuditLog Whether to include audit logs for all trees
     */
    async exportAllAsApp(password?: string | null, includeAuditLog = false, privacyMode: PrivacyMode = 'full', content: boolean | ContentOptions = false): Promise<void> {
        // Export only works from built version (strom.html)
        if (!this.isBuiltVersion()) {
            getUI().showAlert(strings.export.devModeNotSupported, 'warning');
            return;
        }

        try {
            // Get clean HTML (with inline JavaScript)
            const html = this.getExportHtml();

            // Collect all trees data (privacy filter applied to each copy)
            const trees = TreeManager.getTrees();
            const allTreesData: Record<string, { name: string; data: StromData; isHidden?: boolean }> = {};

            for (const tree of trees) {
                const data = await storedTreeWithRefs(tree.id);
                if (data) {
                    let treeExport = applyLivingPrivacy(data, privacyMode);
                    treeExport = applyContentOptions(treeExport, content);
                    allTreesData[tree.id] = {
                        name: tree.name,
                        data: treeExport,
                        // Include isHidden flag if set
                        ...(tree.isHidden ? { isHidden: true } : {})
                    };
                }
            }

            // Use active tree as the primary embedded data
            const activeTreeId = TreeManager.getActiveTreeId();
            const rawActiveData = activeTreeId ? await storedTreeWithRefs(activeTreeId) : null;
            let activeData = rawActiveData ? applyLivingPrivacy(rawActiveData, privacyMode) : null;
            if (activeData) activeData = applyContentOptions(activeData, content);
            const activeTreeMeta = activeTreeId ? TreeManager.getTreeMetadata(activeTreeId) : null;

            // Generate export ID for the main tree
            const exportId = generateExportId();

            // Prepare data for embedding (optionally encrypted)
            let embedActiveDataContent: StromData | EncryptedData | null = activeData;
            let embedAllTrees: Record<string, { name: string; data: StromData; isHidden?: boolean }> | EncryptedData = allTreesData;

            // Under a password every tree is sealed whole (its images expanded).
            if (password) {
                if (activeData) {
                    embedActiveDataContent = await encrypt(JSON.stringify(await expandedData(activeData)), password);
                }
                embedAllTrees = await encrypt(JSON.stringify(await expandedData(allTreesData)), password);
            }

            // Create envelope for the active tree
            const envelope: EmbeddedDataEnvelope | null = activeData ? {
                exportId,
                exportedAt: new Date().toISOString(),
                appVersion: APP_VERSION,
                treeName: activeTreeMeta?.name || 'All Trees',
                data: embedActiveDataContent!,
                ...(includeAuditLog && activeTreeId ? await (async () => {
                    const log = await AuditLogManager.exportForTree(activeTreeId);
                    return log ? { auditLog: log } : {};
                })() : {})
            } : null;

            // Embedded data script (with active tree data as envelope) inserted before </head>,
            // the images read as the file is written.
            const file = await htmlFileWithImages(html, { envelope, embedAllTrees }, (v) =>
                `<script>window.STROM_EMBEDDED_DATA = ${jsonForScript(v.envelope)};window.STROM_ALL_TREES = ${jsonForScript(v.embedAllTrees)};<\/script>`);

            // Download with "all-trees" filename
            this.downloadHtml(file.blob, 'strom-all-trees.html');
            if (privacyMode === 'full') {
                TreeManager.noteFileCopy(Object.keys(allTreesData) as TreeId[],
                    Object.fromEntries(Object.entries(allTreesData).map(([id, t]) => [id, t.data])));
                // A full backup of every tree: the "Export all" reminder rests.
                noteExportAll();
            }
        } catch (error) {
            console.error('Export all failed:', error);
            getUI().showAlert(strings.export.failed, 'error');
        }
    }

    /**
     * Export focused (visible) data as standalone HTML app
     * Used by UI for "Export Focus as App" feature
     * @param focusedData The focused/visible data to export
     * @param filename The filename for the export
     * @param password Optional password to encrypt the exported data
     */
    async exportFocusAsApp(focusedData: StromData, filename: string, password?: string | null, privacyMode: PrivacyMode = 'full', content: boolean | ContentOptions = false, share?: ShareOptions & { treeName?: string; trackTreeId?: TreeId }): Promise<void> {
        // Export only works from built version (strom.html)
        if (!this.isBuiltVersion()) {
            getUI().showAlert(strings.export.devModeNotSupported, 'warning');
            return;
        }

        try {
            // Get clean HTML (with inline JavaScript)
            const html = this.getExportHtml();

            // Generate export ID for focused export
            const exportId = generateExportId();

            // Prepare data for embedding (privacy filter, then optional encryption: sealed whole);
            // the pooled images stay references until the file is written.
            let filteredData = applyLivingPrivacy(focusedData, privacyMode);
            filteredData = applyContentOptions(filteredData, content);
            let embedDataContent: StromData | EncryptedData = filteredData;
            if (password) {
                embedDataContent = await encrypt(JSON.stringify(await expandedData(filteredData)), password);
            }

            // Create envelope with metadata
            const envelope: EmbeddedDataEnvelope = {
                exportId,
                exportedAt: new Date().toISOString(),
                appVersion: APP_VERSION,
                treeName: share?.treeName || 'Focused Export',
                data: embedDataContent,
                ...(share?.senderMessage ? { senderMessage: share.senderMessage } : {}),
                ...(share?.senderName ? { senderName: share.senderName } : {}),
                ...(share?.replyToExportId ? { replyToExportId: share.replyToExportId } : {})
            };

            // A shared branch must be traceable for the reply flow — track the
            // export id on the source tree like the full-tree export does, and
            // keep the shared (filtered) branch as a baseline so a "changes
            // only" reply from the recipient can be reconstructed here.
            let baseline: (() => void) | null = null;
            if (share?.trackTreeId) {
                TreeManager.setLastExportId(share.trackTreeId, exportId);
                baseline = exportBaseline(share.trackTreeId, exportId, filteredData);
            }

            // Embedded data script with focused data inserted before </head>, the images read as the file is written.
            const file = await htmlFileWithImages(html, envelope, (e) => `<script>window.STROM_EMBEDDED_DATA = ${jsonForScript(e)};<\/script>`);

            // Download
            this.downloadHtml(file.blob, filename);
            baseline?.();
        } catch (error) {
            console.error('Export focus as app failed:', error);
            getUI().showAlert(strings.export.failed, 'error');
        }
    }

    /**
     * The app with `data` embedded as a Blob, not downloaded (spec 093 §5, the
     * gift package): as exportFocusAsApp with a sender and a message (the
     * welcome on opening), but `data` is taken as it is — the package has
     * protected it already (D4), so no privacy mode or content choice runs
     * here. Opens on `data.defaultPersonId`. `trackTreeId` keeps the export id
     * and the baseline on the source tree (a reply can be read back). Throws
     * outside the built app (the dev server has no inlined bundle).
     * `spool`: the file written there (a large tree's, spool.ts).
     */
    async buildFocusAppBlob(data: StromData, opts: { treeName: string; senderName?: string; senderMessage?: string; trackTreeId?: TreeId; view?: EmbeddedDataEnvelope['view']; spool?: Spool | null }): Promise<Blob> {
        if (!this.isBuiltVersion()) throw new Error(strings.export.devModeNotSupported);
        const html = this.getExportHtml();
        const exportId = generateExportId();
        const envelope: EmbeddedDataEnvelope = {
            exportId,
            exportedAt: new Date().toISOString(),
            appVersion: APP_VERSION,
            treeName: opts.treeName || 'Family Tree',
            data,
            ...(opts.senderMessage ? { senderMessage: opts.senderMessage } : {}),
            ...(opts.senderName ? { senderName: opts.senderName } : {}),
            ...(opts.view ? { view: opts.view } : {}),
        };
        let baseline: (() => void) | null = null;
        if (opts.trackTreeId) {
            TreeManager.setLastExportId(opts.trackTreeId, exportId);
            baseline = exportBaseline(opts.trackTreeId, exportId, data, opts.spool);
        }
        const file = await htmlFileWithImages(html, envelope, (e) => `<script>window.STROM_EMBEDDED_DATA = ${jsonForScript(e)};<\/script>`, opts.spool);
        baseline?.();
        return file.blob;
    }

    /**
     * Helper to download HTML content as a file
     */
    private downloadHtml(html: string | Blob, filename: string): void {
        const blob = typeof html === 'string' ? new Blob([html], { type: 'text/html' }) : html;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);

        // Mark as exported for embedded mode unsaved changes tracking
        getUI().markExported();
    }
}

export const AppExporter = new AppExporterClass();
