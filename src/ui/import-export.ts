/**
 * import export UI methods. Extracted from the original UIClass;
 * see src/ui/module.ts for the composition pattern.
 */

import type { PrivacyMode, ContentOptions } from '../privacy.js';
import { DataManager, auditPersonName } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { TreePreview, TreeCompare } from '../tree-preview.js';
import {
    Person,
    PersonId,
    PartnershipId,
    PartnershipStatus,
    Gender,
    RelationType,
    RelationContext,
    StromData,
    TreeId,
    LAST_FOCUSED,
    LastFocusedMarker,
    EmbeddedDataEnvelope
} from '../types.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { extractSubtree } from '../subtree.js';
import { findComponents } from '../components.js';
import { compressPhoto, dataUrlByteSize } from '../photo.js';
import { compressImageAttachment, readFileAsDataUrl, MAX_PDF_BYTES, countImages, stripMedia } from '../attachments.js';
import { getDemoTree, getDemoFocus } from '../demo-trees.js';
import { parseGedcom, convertToStrom, decodeGedcomFile, GedcomConversionResult } from '../ged-parser.js';
import {
    validateJsonImport,
    ValidationResult,
    MergerUI,
    getCurrentMergeInfo,
    listMergeSessionsInfo,
    deleteMergeSession,
    renameMergeSession
} from '../merge/index.js';
import { PersonPicker } from '../person-picker.js';
import { AppExporter } from '../export.js';
import { SettingsManager } from '../settings.js';
import { ThemeMode, LanguageSetting, AppMode, AuditLog } from '../types.js';
import { CryptoSession, isEncrypted, encrypt, decrypt, EncryptedData } from '../crypto.js';
import { validateTreeData, ValidationResult as TreeValidationResult, ValidationIssue } from '../validation.js';
import * as CrossTree from '../cross-tree.js';
import { AuditLogManager } from '../audit-log.js';
import { uiModule } from './module.js';
import { safeFileName } from '../filenames.js';
import { isMultiTreeBackup, readEmbeddedHtml, readWindowAssignment, BackupTrees } from '../backup-formats.js';

export const importExportMethods = uiModule({
    // ---- EXPORT/IMPORT DIALOGS ----
    showExportDialog(treeId?: TreeId, parentDialogId?: string): void {
        this.exportTargetTreeId = treeId || TreeManager.getActiveTreeId();
        const isActiveTree = this.exportTargetTreeId === TreeManager.getActiveTreeId();

        // The dialog opened for the ACTIVE tree may offer both view-scoped and
        // whole-tree actions; opened for a NON-ACTIVE tree it must offer ONLY
        // whole-tree actions that provably operate on THAT tree. A single class
        // on the modal drives the CSS gating of every `.active-tree-only` tile
        // (Share, Save-to-file, Unlink, Export this view, Make a tree from this
        // view, Poster, Book — all read the active tree / active view).
        const modal = document.getElementById('export-modal');
        modal?.classList.toggle('non-active-tree', !isActiveTree);

        // Name the target tree in the title so it is unambiguous which tree the
        // whole-tree actions will operate on (textContent, never innerHTML).
        const nameSpan = document.getElementById('export-modal-tree-name');
        if (nameSpan) {
            const name = this.exportTargetTreeId
                ? TreeManager.getTreeMetadata(this.exportTargetTreeId)?.name || ''
                : '';
            nameSpan.textContent = name ? `: ${name}` : '';
        }

        // Handle dialog stack for ESC navigation
        this.clearDialogStack();
        if (parentDialogId) {
            this.pushDialog(parentDialogId);
            this.closeDialogById(parentDialogId);
        }
        this.pushDialog('export-modal');

        document.getElementById('export-modal')?.classList.add('active');
    },

    /**
     * Show export dialog from Tree Manager (uses dialog stack for ESC to return)
     */
    showExportDialogFromManager(treeId: TreeId): void {
        this.showExportDialog(treeId, 'tree-manager-modal');
    },

    closeExportDialog(): void {
        document.getElementById('export-modal')?.classList.remove('active');
        this.exportTargetTreeId = null;
        this.returnToParentDialog();
    },

    /**
     * Get the current export target tree ID
     */
    getExportTargetTreeId(): TreeId | null {
        return this.exportTargetTreeId || TreeManager.getActiveTreeId();
    },

    /**
     * Export target tree as JSON
     * Shows password dialog for optional encryption
     */
    async exportTargetTreeJSON(quick = false): Promise<void> {
        const treeId = this.getExportTargetTreeId();
        if (!treeId) {
            this.closeExportDialog();
            return;
        }

        this.closeExportDialog();

        const name = TreeManager.getTreeMetadata(treeId)?.name ?? '';
        this.showExportPasswordDialog(async (password: string | null) => {
            await DataManager.exportTreeJSON(treeId, password, this.readExportPrivacyMode(), this.readExportContentOptions());
        }, false, quick ? { quick: { hint: strings.fileCopy.quickHint(name) } } : { format: 'json' });
    },

    /**
     * Export target tree as standalone App
     * Shows password dialog for optional encryption
     */
    async exportTargetTreeApp(): Promise<void> {
        const treeId = this.getExportTargetTreeId();
        if (!treeId) {
            this.closeExportDialog();
            return;
        }

        this.closeExportDialog();

        // Show export password dialog
        this.showExportPasswordDialog(async (password: string | null) => {
            const { AppExporter } = await import('../export.js');
            await AppExporter.exportApp(treeId, password, this.readExportPrivacyMode(), this.readExportContentOptions());
        }, false, { defaultPrivacy: 'initials', format: 'html' });
    },

    /**
     * Export target tree as GEDCOM file
     */
    async exportTargetTreeGedcom(): Promise<void> {
        const treeId = this.getExportTargetTreeId();
        if (!treeId) {
            this.closeExportDialog();
            return;
        }
        this.closeExportDialog();

        // GEDCOM cannot be encrypted, so show the export dialog in passwordless
        // mode to pick the living-privacy level and what content (photos,
        // attachments — embedded as base64) goes into the file.
        this.showExportPasswordDialog(async () => {
            const { exportToGedcom } = await import('../ged-exporter.js');
            const { applyLivingPrivacy } = await import('../privacy.js');
            const data = await TreeManager.getTreeData(treeId);
            const metadata = TreeManager.getTreeMetadata(treeId);
            if (!data) return;

            const filtered = applyLivingPrivacy(data, this.readExportPrivacyMode());
            const result = exportToGedcom(filtered, metadata?.name, { content: this.readExportContentOptions() });

            // Download file
            const blob = new Blob([result.content], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${safeFileName(metadata?.name, 'family-tree')}.ged`;
            a.click();
            URL.revokeObjectURL(url);
            if (this.readExportPrivacyMode() === 'full') TreeManager.noteFileCopy([treeId]);
        }, false, { defaultPrivacy: 'initials', passwordless: true, content: true, format: 'gedcom' });
    },

    /**
     * Export target tree as a CSV person table (passwordless; the privacy
     * picker still applies so living people can be reduced/hidden).
     */
    async exportTargetTreeCsv(): Promise<void> {
        const treeId = this.getExportTargetTreeId();
        if (!treeId) {
            this.closeExportDialog();
            return;
        }
        this.closeExportDialog();

        this.showExportPasswordDialog(async () => {
            const { buildPersonsCsv } = await import('../csv-export.js');
            const { applyLivingPrivacy } = await import('../privacy.js');
            const data = await TreeManager.getTreeData(treeId);
            const metadata = TreeManager.getTreeMetadata(treeId);
            if (!data) return;

            const filtered = applyLivingPrivacy(data, this.readExportPrivacyMode());
            const csv = buildPersonsCsv(filtered);
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${safeFileName(metadata?.name, 'family-tree')}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        }, false, { defaultPrivacy: 'full', passwordless: true, format: 'csv' });
    },

    /**
     * Export current tree as App (from Save Current dialog)
     * Shows password dialog for optional encryption
     */
    async exportCurrentTreeApp(): Promise<void> {
        this.closeSaveCurrentDialog();

        this.showExportPasswordDialog(async (password: string | null) => {
            const { AppExporter } = await import('../export.js');
            await AppExporter.exportApp(undefined, password, this.readExportPrivacyMode(), this.readExportContentOptions());
        }, false, { defaultPrivacy: 'initials', format: 'html' });
    },

    /**
     * Export all trees as App (from Export All dialog)
     * Shows password dialog for optional encryption
     */
    async exportAllTreesApp(): Promise<void> {
        this.closeExportAllDialog();

        this.showExportPasswordDialog(async (password: string | null) => {
            const includeAuditLog = (document.getElementById('export-audit-log-toggle') as HTMLInputElement)?.checked || false;
            const { AppExporter } = await import('../export.js');
            await AppExporter.exportAllAsApp(password, includeAuditLog, this.readExportPrivacyMode(), this.readExportContentOptions());
        // A full backup: every tree, unfiltered (like the JSON "Export all").
        }, true, { defaultPrivacy: 'full', format: 'html' });
    },

    /**
     * Export focused data as JSON (from main export dialog)
     */
    async exportFocusedJSON(): Promise<void> {
        this.closeExportDialog();

        this.showExportPasswordDialog(async (password: string | null) => {
            const visibleIds = TreeRenderer.getVisiblePersonIds();
            await DataManager.exportFocusedJSON(visibleIds, password, this.readExportPrivacyMode(), this.readExportContentOptions());
        }, false, { format: 'json' });
    },

    /**
     * "Make a tree from this view": copy exactly the persons currently shown
     * (focus + depth, or the descendants view) into a new, separate tree. A
     * WYSIWYG cut — the naming dialog then creates and switches to it.
     */
    makeTreeFromCurrentView(): void {
        if (DataManager.isReadOnly()) return;
        const visibleIds = TreeRenderer.getVisiblePersonIds();
        // The fan/timeline views don't populate the layout positions; this is
        // a family/descendants-view action.
        if (visibleIds.size < 2) {
            this.showToast(strings.gedcom.viewCutTooSmall);
            return;
        }
        const subtree = extractSubtree(DataManager.getData(), visibleIds);
        const focus = TreeRenderer.getFocusPersonId();
        const focusPerson = focus ? DataManager.getPerson(focus) : null;
        const base = focusPerson ? `${focusPerson.firstName} ${focusPerson.lastName}`.trim() : '';
        const suggested = base ? strings.gedcom.viewCutName(base) : strings.treeManager.importTreeName;

        this.closeExportDialog();
        this.importFromTreeManager = false;
        this.importToCurrentTree = false;
        this.showImportTreeDialog(subtree, suggested);
    },

    showImportDialog(): void {
        document.getElementById('import-modal')?.classList.add('active');
    },

    closeImportDialog(): void {
        document.getElementById('import-modal')?.classList.remove('active');
    },

    // ---- GEDCOM IMPORT ----
    handleGedcomFile(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;

        // Snapshot the import intent NOW: manager / empty-state paths set their
        // flag right before triggering this input; the plain "Import GEDCOM"
        // menu triggers it with no flag set, so stale flags from an earlier
        // import must not leak in. Re-apply the snapshot when the async read
        // resolves (input.value reset below would otherwise not matter).
        const fromManager = this.importFromTreeManager;
        const toCurrent = this.importToCurrentTree;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                // Raw bytes, not readAsText: the file's own HEAD > CHAR decides
                // the encoding (ANSEL files were silently mangled as UTF-8).
                const content = decodeGedcomFile(e.target?.result as ArrayBuffer);
                const gedcom = parseGedcom(content);
                this.gedcomResult = convertToStrom(gedcom);
                this.gedcomImportImages = null;
                this.importFromTreeManager = fromManager;
                this.importToCurrentTree = toCurrent;
                this.showGedcomResultDialog();
            } catch (error) {
                this.showAlert(strings.gedcom.parseError, 'error');
                console.error('GEDCOM parse error:', error);
            }
        };
        reader.readAsArrayBuffer(file);

        // Reset input so same file can be re-imported
        input.value = '';
    },

    showGedcomResultDialog(): void {
        if (!this.gedcomResult) return;

        const modal = document.getElementById('gedcom-result-modal');
        if (!modal) return;

        // Handle dialog stack - if from tree manager, keep it in stack.
        // The dialog re-renders itself after media attach/download — never
        // push a DUPLICATE stack entry then, or closing pops a stale copy
        // and resurrects this dialog over the next one.
        const alreadyOnStack = this.dialogStack[this.dialogStack.length - 1] === 'gedcom-result-modal';
        if (!alreadyOnStack && (this.importFromTreeManager || this.importToCurrentTree)) {
            this.pushDialog('gedcom-result-modal');
        }

        // Update stats
        const personsEl = document.getElementById('gedcom-stat-persons');
        const partnershipsEl = document.getElementById('gedcom-stat-partnerships');
        const placeholdersEl = document.getElementById('gedcom-stat-placeholders');
        const unsupportedEl = document.getElementById('gedcom-stat-unsupported');

        if (personsEl) personsEl.textContent = String(this.gedcomResult.stats.totalPersons);
        if (partnershipsEl) partnershipsEl.textContent = String(this.gedcomResult.stats.totalPartnerships);
        if (placeholdersEl) placeholdersEl.textContent = String(this.gedcomResult.stats.placeholderPersons);
        if (unsupportedEl) unsupportedEl.textContent = String(this.gedcomResult.stats.unsupportedTags);

        // Trust-building breakdown: the migrating user must see at a glance
        // that photos/documents/sources/events survived. Zero tiles hide.
        const persons = Object.values(this.gedcomResult.data.persons);
        const images = countImages(this.gedcomResult.data);
        const richStats: Array<[string, number]> = [
            ['photos', images.photos],
            ['documents', images.attachments],
            ['excerpts', images.excerpts],
            ['sources', Object.keys(this.gedcomResult.data.sources ?? {}).length],
            ['events', persons.reduce((n, p) => n + (p.events?.length ?? 0), 0)],
        ];
        for (const [key, count] of richStats) {
            const el = document.getElementById(`gedcom-stat-${key}`);
            const item = document.getElementById(`gedcom-stat-${key}-item`);
            if (el) el.textContent = String(count);
            if (item) item.style.display = count > 0 ? '' : 'none';
        }

        // Images in the file: offer to leave them out (pre-set from the
        // setting; the choice applies to this import only). The re-render
        // after a media attach keeps the choice already made.
        if (this.gedcomImportImages === null) this.gedcomImportImages = SettingsManager.isImportImages();
        const imagesRow = document.getElementById('gedcom-images-row');
        const hasImages = images.photos + images.attachments + images.excerpts > 0
            || this.gedcomResult.externalMedia.length > 0;
        if (imagesRow) imagesRow.style.display = hasImages ? '' : 'none';
        const imagesCheck = document.getElementById('gedcom-import-images') as HTMLInputElement | null;
        if (imagesCheck) imagesCheck.checked = this.gedcomImportImages;
        const sizeEl = document.getElementById('gedcom-images-size');
        if (sizeEl) sizeEl.textContent = strings.importImages.size((images.bytes / (1024 * 1024)).toFixed(1));
        this.applyGedcomImagesChoice();

        // What exactly was skipped (previously a dead counter — always 0).
        const detailEl = document.getElementById('gedcom-stat-detail');
        if (detailEl) {
            const parts: string[] = [];
            if (this.gedcomResult.stats.droppedTagSummary) {
                parts.push(`${strings.gedcom.skippedTags}: ${this.gedcomResult.stats.droppedTagSummary}`);
            }
            if (this.gedcomResult.stats.unknownSexPersons > 0) {
                parts.push(strings.gedcom.unknownSex(this.gedcomResult.stats.unknownSexPersons));
            }
            if (this.gedcomResult.stats.otherFamilyLinks > 0) {
                parts.push(strings.gedcom.otherFamilyLinks(this.gedcomResult.stats.otherFamilyLinks));
            }
            if (parts.length === 0 && this.gedcomResult.stats.unsupportedTags === 0) {
                // Say it out loud — silence reads as "who knows what got lost".
                parts.push(strings.gedcom.allImported);
            }
            detailEl.textContent = parts.join(' · ');
            detailEl.style.display = parts.length > 0 ? '' : 'none';
        }

        // External media (photos exported as a separate folder by platforms):
        // offer bulk attach BEFORE the data is inserted anywhere.
        const mediaRow = document.getElementById('gedcom-media-row');
        const mediaText = document.getElementById('gedcom-media-text');
        const pending = this.gedcomResult.externalMedia.length;
        if (mediaRow) mediaRow.style.display = pending > 0 && this.gedcomImportImages !== false ? '' : 'none';
        if (mediaText && pending > 0) mediaText.textContent = strings.gedcom.externalMedia(pending);
        // Platform exports (MyHeritage) reference photos by URL — offer a
        // direct download (their CDN allows cross-origin GET).
        const downloadBtn = document.getElementById('gedcom-media-download');
        const urlRefs = this.gedcomResult.externalMedia.filter(r => r.isUrl).length;
        if (downloadBtn) downloadBtn.style.display = urlRefs > 0 ? '' : 'none';

        // Show/hide buttons based on context
        const newTreeBtn = document.getElementById('gedcom-new-tree-btn');
        const mergeBtn = document.getElementById('gedcom-merge-btn');
        const saveJsonBtn = document.getElementById('gedcom-save-json-btn');
        const insertBtn = document.getElementById('gedcom-insert-btn');

        if (this.importToCurrentTree) {
            // Importing to current tree (from empty state) - show only "Insert into tree"
            if (newTreeBtn) newTreeBtn.style.display = 'none';
            if (mergeBtn) mergeBtn.style.display = 'none';
            if (saveJsonBtn) saveJsonBtn.style.display = 'none';
            if (insertBtn) insertBtn.style.display = '';
        } else if (this.importFromTreeManager) {
            // From tree manager "New Tree" - only "Import as New Tree" and "Save as JSON"
            // Merge is available via tree manager's "Merge into..." action
            if (newTreeBtn) newTreeBtn.style.display = '';
            if (mergeBtn) mergeBtn.style.display = 'none';
            if (saveJsonBtn) saveJsonBtn.style.display = '';
            if (insertBtn) insertBtn.style.display = 'none';
        } else {
            // Normal import - show standard options
            if (newTreeBtn) newTreeBtn.style.display = '';
            if (mergeBtn) mergeBtn.style.display = '';
            if (saveJsonBtn) saveJsonBtn.style.display = '';
            if (insertBtn) insertBtn.style.display = 'none';
        }

        modal.classList.add('active');
    },

    /**
     * Bulk-attach user-picked files to the freshly converted GEDCOM data by
     * matching file names against the OBJE FILE references. Images become the
     * person's photo (first one) or image attachments; PDFs become documents.
     * Mutates the in-memory conversion result — every import path (new tree /
     * merge / insert) then carries the media along.
     */
    async attachGedcomMedia(files: FileList | null): Promise<void> {
        if (!this.gedcomResult || !files || files.length === 0) return;
        const byName = new Map<string, File>();
        for (const f of Array.from(files)) byName.set(f.name.toLowerCase(), f);

        const refs = this.gedcomResult.externalMedia;
        const total = refs.length;
        let matched = 0;
        const remaining: typeof refs = [];

        for (const ref of refs) {
            const file = byName.get(ref.fileName.toLowerCase());
            if (!file || !(await this.attachFileToGedcomRef(ref, file))) {
                remaining.push(ref);
                continue;
            }
            matched++;
        }
        // Fix attachment sizes from data URLs (compression changed them).
        for (const person of Object.values(this.gedcomResult.data.persons)) {
            for (const att of person.attachments ?? []) {
                if (!att.sizeBytes) att.sizeBytes = dataUrlByteSize(att.dataUrl);
            }
        }

        this.gedcomResult.externalMedia = remaining;
        this.showToast(matched > 0
            ? strings.gedcom.mediaAttached(matched, total)
            : strings.gedcom.mediaNoMatch);
        this.showGedcomResultDialog();   // refresh tiles + media row
    },

    /** Attach one picked/downloaded file to the person of a media ref. */
    async attachFileToGedcomRef(ref: { personId: PersonId; title?: string }, file: File): Promise<boolean> {
        const person = this.gedcomResult?.data.persons[ref.personId];
        if (!person) return false;
        try {
            if (file.type.startsWith('image/')) {
                if (!person.photo) {
                    person.photo = await compressPhoto(file);
                    person.photoOriginalName = file.name;
                } else {
                    (person.attachments ??= []).push({
                        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                        name: ref.title || file.name,
                        mimeType: 'image/jpeg',
                        dataUrl: await compressImageAttachment(file),
                        sizeBytes: 0,
                    });
                }
            } else if (file.type === 'application/pdf' && file.size <= MAX_PDF_BYTES) {
                (person.attachments ??= []).push({
                    id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                    name: ref.title || file.name,
                    mimeType: 'application/pdf',
                    dataUrl: await readFileAsDataUrl(file),
                    sizeBytes: file.size,
                });
            } else {
                return false;
            }
            return true;
        } catch {
            return false;
        }
    },

    /**
     * Download URL-referenced media (MyHeritage exports photos as time-limited
     * CDN links with permissive CORS) and attach them like picked files.
     */
    async downloadGedcomMedia(): Promise<void> {
        if (!this.gedcomResult) return;
        const refs = this.gedcomResult.externalMedia;
        const urlRefs = refs.filter(r => r.isUrl);
        if (urlRefs.length === 0) return;

        const btn = document.getElementById('gedcom-media-download') as HTMLButtonElement | null;
        if (btn) btn.disabled = true;
        let done = 0, ok = 0;
        const succeeded = new Set<(typeof refs)[number]>();
        for (const ref of urlRefs) {
            done++;
            if (btn) btn.textContent = strings.gedcom.downloading(done, urlRefs.length);
            try {
                const resp = await fetch(ref.filePath);
                if (!resp.ok) continue;
                const blob = await resp.blob();
                const type = blob.type || 'image/jpeg';
                const file = new File([blob], ref.fileName, { type });
                if (await this.attachFileToGedcomRef(ref, file)) {
                    succeeded.add(ref);
                    ok++;
                }
            } catch { /* expired link, offline, CORS — ref stays offered */ }
        }
        if (btn) btn.disabled = false;

        this.gedcomResult.externalMedia = refs.filter(r => !succeeded.has(r));
        this.showToast(ok > 0
            ? strings.gedcom.mediaAttached(ok, urlRefs.length)
            : strings.gedcom.mediaNoMatch);
        this.showGedcomResultDialog();
    },

    closeGedcomResultDialog(): void {
        document.getElementById('gedcom-result-modal')?.classList.remove('active');
        if (this.importFromTreeManager) {
            this.returnToParentDialog();
            this.importFromTreeManager = false;
        }
    },

    /** The images checkbox of the GEDCOM result: this import only, not the setting. */
    setGedcomImportImages(checked: boolean): void {
        this.gedcomImportImages = checked;
        this.applyGedcomImagesChoice();
    },

    /** Dim the image tiles and hide the external-media offer when images stay out. */
    applyGedcomImagesChoice(): void {
        const off = this.gedcomImportImages === false;
        for (const key of ['photos', 'documents', 'excerpts']) {
            document.getElementById(`gedcom-stat-${key}-item`)?.classList.toggle('muted', off);
        }
        const mediaRow = document.getElementById('gedcom-media-row');
        if (mediaRow && this.gedcomResult) {
            mediaRow.style.display = !off && this.gedcomResult.externalMedia.length > 0 ? '' : 'none';
        }
    },

    /** The converted data as it should be imported (images stripped when unchecked). */
    gedcomDataForImport(): StromData {
        const data = this.gedcomResult!.data;
        return this.gedcomImportImages === false ? stripMedia(data) : data;
    },

    downloadGedcomAsJson(): void {
        if (!this.gedcomResult) return;

        const dataStr = JSON.stringify(this.gedcomDataForImport(), null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'family-tree.json';
        a.click();
        URL.revokeObjectURL(a.href);

        this.closeGedcomResultDialog();
    },

    importGedcomAsNewTree(): void {
        if (!this.gedcomResult) return;

        // Check if importing directly to current tree (from empty state)
        if (this.importToCurrentTree) {
            this.importToCurrentTree = false;
            // Close gedcom result dialog
            document.getElementById('gedcom-result-modal')?.classList.remove('active');
            this.clearDialogStack();
            // Load data directly into current tree
            DataManager.loadStromData(this.gedcomDataForImport());
            TreeRenderer.render();
            this.showToast(strings.buttons.importComplete);
            this.gedcomResult = null;
            return;
        }

        // Save flag before close (which resets it)
        const fromManager = this.importFromTreeManager;

        // Close gedcom result but don't return to parent yet
        document.getElementById('gedcom-result-modal')?.classList.remove('active');
        this.dialogStack.pop(); // Remove gedcom-result-modal

        // Show import tree dialog with parent preserved
        this.showImportTreeDialog(this.gedcomDataForImport(), strings.treeManager.importTreeName, fromManager);
        this.gedcomResult = null;
    },

    /**
     * Merge GEDCOM data with existing tree
     */
    mergeGedcomWithExisting(): void {
        if (!this.gedcomResult) return;

        // Start merge process
        MergerUI.startMerge(this.gedcomDataForImport());
        this.gedcomResult = null;
        this.closeGedcomResultDialog();
    },

    // ---- JSON IMPORT WITH VALIDATION ----
    /**
     * Handle JSON file import with validation
     */
    handleJsonFile(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            // A stale handle from an earlier (failed/cancelled) "open from
            // file" must never get attached to THIS unrelated import — Ctrl+S
            // would then silently overwrite the wrong file on disk.
            this.pendingOpenFileHandle = null;
            void this.importJsonString(e.target?.result as string);
        };
        reader.readAsText(file);

        // Reset input
        input.value = '';
    },

    /**
     * Validate and import a JSON string through the same path as a file upload
     * (encrypted → password prompt, invalid → dialog, warnings → confirm). Shared
     * by the file-input upload and the File System Access "open from file" flow.
     */
    async importJsonString(content: string): Promise<void> {
        let parsed: unknown;
        try {
            parsed = JSON.parse(content);
        } catch {
            this.showValidationDialog({ valid: false, errors: ['validation.invalidJson'], warnings: [] });
            return;
        }

        // A change packet (collaboration diff) is reconstructed against a local
        // baseline and handed to the merge preview — not a full-tree import.
        const { isChangePacket } = await import('../share-diff.js');
        if (isChangePacket(parsed)) {
            await this.importChangePacket(parsed);
            return;
        }

        const { isEncrypted } = await import('../crypto.js');
        if (isEncrypted(parsed)) {
            this.handleEncryptedJsonImport(parsed);
            return;
        }

        // "Export all" backup ({ treeId: { name, data } }) — restore every
        // tree instead of rejecting the file (review V5).
        if (isMultiTreeBackup(parsed)) {
            await this.importMultiTreeBackup(parsed);
            return;
        }

        const result = validateJsonImport(content);
        if (!result.valid) {
            this.showValidationDialog(result);
            return;
        }
        const data = result.data!;
        const images = countImages(data);
        const withImages = (include: boolean) => this.processJsonImport(include ? data : stripMedia(data));
        if (result.warnings.length > 0) {
            // The dialog is shown anyway: it carries the images checkbox too.
            this.showValidationDialog(result, withImages,
                images.photos + images.attachments + images.excerpts > 0 ? images.bytes : undefined);
        } else {
            withImages(SettingsManager.isImportImages());
        }
    },

    processJsonImport(data: StromData): void {
        // Check if importing directly to current tree (from empty state)
        if (this.importToCurrentTree) {
            this.importToCurrentTree = false;
            this.closeImportDialog();
            // Back up the current state before overwriting it.
            void DataManager.snapshotNow('pre-import');
            // Load data directly into current tree
            DataManager.loadStromData(data);
            TreeRenderer.render();
            this.showToast(strings.buttons.importComplete);
            // "Open from file" into the current (empty) tree: the picked file
            // belongs to this tree now.
            const currentId = DataManager.getCurrentTreeId();
            if (currentId) void this.attachPendingFileHandle(currentId);
            return;
        }

        // Always import as new tree
        const fromManager = this.importFromTreeManager;
        this.closeImportDialog();
        this.showImportTreeDialog(data, strings.treeManager.importTreeName, fromManager);
    },

    /**
     * Handle encrypted JSON import - show password prompt with retry
     */
    handleEncryptedJsonImport(encryptedData: EncryptedData): void {
        this.pendingEncryptedImport = encryptedData;
        this.showEncryptedImportPrompt();
    },

    /**
     * Show password prompt for encrypted import
     */
    showEncryptedImportPrompt(): void {
        const modal = document.getElementById('password-prompt-modal');
        const input = document.getElementById('password-prompt-input') as HTMLInputElement;
        const error = document.getElementById('password-prompt-error');

        if (!modal || !input) return;

        // Clear fields but keep modal behind tree manager
        input.value = '';
        if (error) {
            error.style.display = 'none';
            error.textContent = '';
        }

        // Set callback for this specific import - callback manages dialog
        this.passwordPromptCallback = async (password: string) => {
            await this.tryDecryptImport(password);
        };
        this.passwordPromptCallbackManagesDialog = true;

        modal.classList.add('active');
        input.focus();
    },

    /**
     * Try to decrypt and import with given password
     */
    async tryDecryptImport(password: string): Promise<void> {
        if (!this.pendingEncryptedImport) return;

        const error = document.getElementById('password-prompt-error');

        try {
            const { decrypt } = await import('../crypto.js');
            const decrypted = await decrypt(this.pendingEncryptedImport, password);

            // Success - close dialog and reset flag
            document.getElementById('password-prompt-modal')?.classList.remove('active');
            this.passwordPromptCallbackManagesDialog = false;
            this.pendingEncryptedImport = null;

            // Same routing as a plain file (single tree or "Export all" backup)
            await this.importJsonString(decrypted);
        } catch {
            // Wrong password - show error and keep dialog open
            if (error) {
                error.textContent = strings.encryption.wrongPassword;
                error.style.display = 'block';
            }
            // Clear input for retry
            const input = document.getElementById('password-prompt-input') as HTMLInputElement;
            if (input) {
                input.value = '';
                input.focus();
            }
        }
    },

    // ---- SAVE CURRENT DATA DIALOG ----
    showSaveCurrentDialog(onContinue: () => void): void {
        const modal = document.getElementById('save-current-modal');
        const continueBtn = document.getElementById('save-current-continue-btn');
        if (!modal || !continueBtn) return;

        this.saveCurrentCallback = onContinue;

        continueBtn.onclick = () => {
            this.closeSaveCurrentDialog();
            if (this.saveCurrentCallback) {
                this.saveCurrentCallback();
                this.saveCurrentCallback = null;
            }
        };

        modal.classList.add('active');
    },

    closeSaveCurrentDialog(): void {
        document.getElementById('save-current-modal')?.classList.remove('active');
        this.saveCurrentCallback = null;
    },

    // ---- IMPORT FILE DIALOG (EMPTY STATE) ----
    /**
     * Show import file dialog for empty state
     */
    showImportFileDialog(): void {
        // Importing into the current tree edits it: never into locked data.
        if (DataManager.isReadOnly()) return;
        this.clearDialogStack();
        this.pushDialog('import-file-modal');
        document.getElementById('import-file-modal')?.classList.add('active');
    },

    /**
     * Close import file dialog
     */
    closeImportFileDialog(): void {
        document.getElementById('import-file-modal')?.classList.remove('active');
        this.clearDialogStack();
    },

    /**
     * Import JSON directly to current tree (from empty state)
     */
    importJsonToCurrentTree(): void {
        this.importToCurrentTree = true;
        this.closeImportFileDialog();
        document.getElementById('file-input')?.click();
    },

    /**
     * Import GEDCOM directly to current tree (from empty state)
     */
    importGedcomToCurrentTree(): void {
        this.importToCurrentTree = true;
        this.closeImportFileDialog();
        document.getElementById('gedcom-input')?.click();
    },

    /**
     * Start JSON import from tree manager
     * Sets up dialog stack for proper navigation
     */
    startJsonImportFromManager(): void {
        this.importFromTreeManager = true;
        // Close new-tree-menu but keep tree-manager in stack
        document.getElementById('new-tree-menu-modal')?.classList.remove('active');
        this.dialogStack.pop(); // Remove new-tree-menu, keep tree-manager
        // Trigger file input
        document.getElementById('file-input')?.click();
    },

    /**
     * Start GEDCOM import from tree manager
     * Sets up dialog stack for proper navigation
     */
    /** Plain "Import GEDCOM" (main import menu): a fresh, standalone import
     *  — clear any stale manager/current-tree intent from a previous import. */
    startGedcomImportPlain(): void {
        this.importFromTreeManager = false;
        this.importToCurrentTree = false;
        document.getElementById('gedcom-input')?.click();
    },

    startGedcomImportFromManager(): void {
        this.importFromTreeManager = true;
        // Close new-tree-menu but keep tree-manager in stack
        document.getElementById('new-tree-menu-modal')?.classList.remove('active');
        this.dialogStack.pop(); // Remove new-tree-menu, keep tree-manager
        // Trigger file input
        document.getElementById('gedcom-input')?.click();
    },

    /**
     * The OS file picker closed without a file being chosen. An import started
     * from the tree manager closed its dialogs before opening the picker, so
     * cancelling used to strand the user with everything gone — go back to the
     * New Tree menu the click came from (Escape there leads to the manager,
     * as always).
     */
    handleImportFileCancel(): void {
        if (!this.importFromTreeManager) return;
        this.importFromTreeManager = false;
        this.showNewTreeMenu();
    },

    /**
     * Start HTML import from tree manager
     */
    startHtmlImportFromManager(): void {
        this.importFromTreeManager = true;
        document.getElementById('new-tree-menu-modal')?.classList.remove('active');
        this.dialogStack.pop();
        document.getElementById('html-input')?.click();
    },

    /**
     * Import HTML directly to current tree (from empty state)
     */
    importHtmlToCurrentTree(): void {
        this.importToCurrentTree = true;
        this.closeImportFileDialog();
        document.getElementById('html-input')?.click();
    },

    /**
     * Handle HTML file import
     */
    handleHtmlFile(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const htmlContent = e.target?.result as string;

            // Collaboration: a file replying to one of my shared trees gets the
            // merge offer instead of the plain import flow.
            const envelope = this.extractEnvelopeFromHtml(htmlContent);
            if (envelope && this.handleImportedShareEnvelope(envelope)) {
                input.value = '';
                return;
            }

            void this.importHtmlContent(htmlContent);
        };
        reader.readAsText(file);
        input.value = '';
    },

    /**
     * Extract the full embedded envelope (single-tree exports) from Strom HTML.
     * Takes the LAST match: files re-exported from an embedded copy by older
     * builds may carry a stale first envelope (the runtime uses the last one).
     */
    extractEnvelopeFromHtml(html: string): EmbeddedDataEnvelope | null {
        // Balanced scan, not a lazy regex: an "Export all" file puts a second
        // assignment into the same script tag (review V5).
        const value = readWindowAssignment(html, 'STROM_EMBEDDED_DATA');
        return value && typeof value === 'object' ? value as EmbeddedDataEnvelope : null;
    },

    /**
     * Import an exported Strom HTML file: an "Export all" file restores every
     * tree, a single-tree file goes through the regular JSON import flow.
     * Encrypted files ask for the FILE password (decrypted with a key of
     * their own — the local session is untouched).
     */
    async importHtmlContent(html: string): Promise<void> {
        const content = readEmbeddedHtml(html);
        const envData = content.envelope?.data;
        const allEnc = content.allTrees && isEncrypted(content.allTrees) ? content.allTrees : null;
        const envEnc = isEncrypted(envData) ? envData : null;

        if (allEnc || envEnc) {
            this.promptFilePassword(async (password) => {
                let trees: BackupTrees | null = null;
                let single: StromData | null = null;
                try {
                    if (allEnc) {
                        const parsed = JSON.parse(await decrypt(allEnc, password));
                        if (isMultiTreeBackup(parsed)) trees = parsed;
                    }
                    if (envEnc) single = JSON.parse(await decrypt(envEnc, password)) as StromData;
                } catch {
                    return false;
                }
                await this.continueHtmlImport(trees, single ?? (envData as StromData | undefined) ?? null);
                return true;
            });
            return;
        }

        const trees = content.allTrees && !isEncrypted(content.allTrees) ? content.allTrees : null;
        await this.continueHtmlImport(trees, (envData as StromData | undefined) ?? null);
    },

    /** Second half of importHtmlContent, with plain (decrypted) payloads. */
    async continueHtmlImport(trees: BackupTrees | null, single: StromData | null): Promise<void> {
        if (trees && Object.keys(trees).length > 1) {
            await this.importMultiTreeBackup(trees);
            return;
        }
        const data = single ?? (trees ? Object.values(trees)[0]?.data ?? null : null);
        if (!data || typeof data !== 'object') {
            this.showAlert(strings.treeManager.htmlNoData, 'warning');
            return;
        }
        // Use the same flow as JSON import
        await this.importJsonString(JSON.stringify(data));
    },

    /**
     * Ask for a file's password in the shared prompt. `tryPassword` resolves
     * false on a wrong password (the prompt stays open for a retry).
     */
    promptFilePassword(tryPassword: (password: string) => Promise<boolean>): void {
        const modal = document.getElementById('password-prompt-modal');
        const input = document.getElementById('password-prompt-input') as HTMLInputElement;
        const error = document.getElementById('password-prompt-error');
        if (!modal || !input) return;

        input.value = '';
        if (error) {
            error.style.display = 'none';
            error.textContent = '';
        }
        this.pendingEncryptedData = null;
        this.passwordPromptOnCancel = null;
        this.passwordPromptCallback = async (password: string) => {
            // Close BEFORE continuing: the import flow opens its own dialogs.
            modal.classList.remove('active');
            const ok = await tryPassword(password);
            if (ok) {
                this.passwordPromptCallbackManagesDialog = false;
                return;
            }
            modal.classList.add('active');
            if (error) {
                error.textContent = strings.encryption.wrongPassword;
                error.style.display = 'block';
            }
            input.value = '';
            input.focus();
        };
        this.passwordPromptCallbackManagesDialog = true;
        modal.classList.add('active');
        input.focus();
    },

    /**
     * Restore an "Export all" backup (JSON or HTML): validate every tree,
     * confirm, then import all of them as NEW trees (review V5).
     */
    async importMultiTreeBackup(trees: BackupTrees): Promise<void> {
        const valid: Array<{ name: string; data: StromData; isHidden?: boolean; auditLog?: AuditLog }> = [];
        let skipped = 0;
        for (const entry of Object.values(trees)) {
            const result = validateJsonImport(JSON.stringify(entry.data));
            if (result.valid && result.data) {
                valid.push({ name: entry.name, data: result.data, isHidden: entry.isHidden, auditLog: entry.auditLog });
            } else {
                skipped++;
            }
        }
        if (valid.length === 0) {
            this.showAlert(strings.storageSafety.backupEmpty, 'warning');
            return;
        }
        const ok = await this.showConfirm(
            strings.storageSafety.backupContains(valid.length),
            strings.storageSafety.backupTitle,
            { ok: strings.storageSafety.backupImportAll, cancel: strings.buttons.cancel }
        );
        if (!ok) return;
        if (!await this.ensureLocalUnlocked()) return;

        this.importToCurrentTree = false;
        this.importFromTreeManager = false;
        this.closeImportDialog();
        const ids = await DataManager.importTreesAsNew(valid);

        this.updateTreeSwitcher();
        this.updateTreeManagerList();
        TreeRenderer.render();
        TreeRenderer.resetFocusHistory();
        this.refreshSearch();
        const current = DataManager.getCurrentTreeId();
        if (current) this.updateUrlTreeParam(current);
        this.showToast(strings.storageSafety.backupImported(ids.length));
        if (skipped > 0) this.showToast(strings.storageSafety.backupSkipped(skipped), 5000);
    },

    /**
     * Extract embedded data from Strom HTML file
     */
    extractDataFromHtml(html: string): StromData | null {
        // Single-tree envelope first; else the first tree of an "Export all"
        // bundle. Encrypted payloads return null (importHtmlContent prompts).
        const content = readEmbeddedHtml(html);
        const envData = content.envelope?.data;
        if (envData && typeof envData === 'object' && !isEncrypted(envData)) {
            return envData as StromData;
        }
        if (content.allTrees && !isEncrypted(content.allTrees)) {
            const first = Object.values(content.allTrees)[0];
            if (first?.data) return first.data;
        }
        return null;
    },

    // ---- IMPORT AS NEW TREE ----
    /**
     * Show import tree dialog (for creating new tree from import)
     */
    showImportTreeDialog(data: StromData, suggestedName: string, fromTreeManager: boolean = false): void {
        const modal = document.getElementById('import-tree-modal');
        const nameInput = document.getElementById('import-tree-name') as HTMLInputElement;
        const personsEl = document.getElementById('import-tree-persons');
        const partnershipsEl = document.getElementById('import-tree-partnerships');

        if (!modal || !nameInput || !personsEl || !partnershipsEl) return;

        this.importTreeData = data;
        this.importFromTreeManager = fromTreeManager;

        // Handle dialog stack - if from tree manager, it's already in stack
        if (fromTreeManager) {
            this.pushDialog('import-tree-modal');
        }

        nameInput.value = suggestedName;
        personsEl.textContent = String(Object.keys(data.persons).length);
        partnershipsEl.textContent = String(Object.keys(data.partnerships).length);

        modal.classList.add('active');
        nameInput.focus();
        nameInput.select();
    },

    /**
     * Close import tree dialog
     */
    closeImportTreeDialog(): void {
        document.getElementById('import-tree-modal')?.classList.remove('active');
        this.importTreeData = null;
        if (this.importFromTreeManager) {
            this.returnToParentDialog();
            this.importFromTreeManager = false;
        }
    },

    /**
     * Confirm import as new tree
     */
    async confirmImportTree(): Promise<void> {
        if (!this.importTreeData) return;

        const nameInput = document.getElementById('import-tree-name') as HTMLInputElement;
        const name = nameInput?.value.trim() || strings.treeManager.importTreeName;

        const newTreeId = await DataManager.importAsNewTree(this.importTreeData, name);

        this.closeImportTreeDialog();
        this.updateTreeSwitcher();
        this.updateTreeManagerList();
        TreeRenderer.render();
        TreeRenderer.resetFocusHistory();
        this.refreshSearch();
        // Update URL to reflect new tree
        this.updateUrlTreeParam(newTreeId);
        // If this import came from "open from file", attach that handle now.
        void this.attachPendingFileHandle(newTreeId);
        // M6: post-import health check — offer to review any data issues.
        void this.afterImport(newTreeId);
    },

    /**
     * The two questions worth asking about a file somebody just imported, one
     * after the other so they do not pile up on top of each other.
     */
    async afterImport(treeId: TreeId): Promise<void> {
        await this.offerPostImportValidation(treeId);
        await this.offerPostImportSplit(treeId);
    },

    /**
     * A file that holds families with nothing between them is usually somebody's
     * whole account exported at once. This is the moment they think about it —
     * the split has been reachable from the tree manager all along, and nobody
     * goes looking for a thing they do not know they need.
     *
     * Only real families count. A tree of 222 people plus four strays is not
     * "five families": nobody wants a tree containing one unconnected person,
     * they want to link them — which is what the tree statistics say instead.
     */
    async offerPostImportSplit(treeId: TreeId): Promise<void> {
        const families = findComponents(DataManager.getData()).filter(c => c.count >= 2);
        if (families.length < 2) return;
        const split = await this.showConfirm(
            strings.split.postImport(families.length),
            strings.split.postImportTitle,
            { ok: strings.split.menu, cancel: strings.buttons.close }
        );
        if (split) await this.showSplitDialog(treeId, undefined);
    },

    /**
     * After importing a tree, quietly validate it and — only if something looks
     * off — offer to open the validation report. Shows care for the data and
     * gives a free aha-moment; silent when the data is clean.
     */
    async offerPostImportValidation(treeId: TreeId): Promise<void> {
        const data = DataManager.getData();
        const result = validateTreeData(data);
        const notable = result.stats.errors + result.stats.warnings;
        if (notable === 0) return;
        const review = await this.showConfirm(
            strings.treeManager.postImportCheck(notable),
            strings.treeManager.postImportCheckTitle,
            { ok: strings.treeManager.postImportReview, cancel: strings.buttons.close }
        );
        if (review) await this.showTreeValidationDialog(treeId);
    },

    /**
     * Load a bundled demo tree (Přemyslids in Czech, House of Tudor otherwise)
     * as a new tree, focus an interesting person and show a hint toast.
     */
    async loadDemoTree(): Promise<void> {
        // Read-only viewers (and locked data) must not create trees
        if (DataManager.isReadOnly()) return;
        this.closeMobileMenu();
        this.closeNewTreeMenu();
        const lang = getCurrentLanguage() === 'cs' ? 'cs' : 'en';
        const data = getDemoTree(lang);
        const focusId = getDemoFocus(lang);

        const newTreeId = await DataManager.importAsNewTree(data, strings.demo.treeName);

        this.updateTreeSwitcher();
        this.updateTreeManagerList();
        TreeRenderer.setFocus(focusId);
        TreeRenderer.resetFocusHistory();
        this.refreshSearch();
        this.updateUrlTreeParam(newTreeId);
        this.showToast(strings.demo.hint);
        // Offer the interactive tour once (non-blocking).
        this.offerTourAfterDemo();
    },

    // ---- EXPORT ALL DIALOG ----
    /**
     * Show export all dialog
     */
    showExportAllDialog(): void {
        // Handle dialog stack for ESC navigation
        this.clearDialogStack();
        this.pushDialog('tree-manager-modal');
        this.closeDialogById('tree-manager-modal');
        this.pushDialog('export-all-modal');

        document.getElementById('export-all-modal')?.classList.add('active');
    },

    /**
     * Close export all dialog
     */
    closeExportAllDialog(): void {
        document.getElementById('export-all-modal')?.classList.remove('active');
        this.returnToParentDialog();
    },

    /**
     * Export all trees as single JSON file
     * Shows password dialog for optional encryption
     */
    async exportAllAsJson(quick = false): Promise<void> {
        this.closeExportAllDialog();

        this.showExportPasswordDialog(async (password: string | null) => {
            const includeAuditLog = (document.getElementById('export-audit-log-toggle') as HTMLInputElement)?.checked || false;
            await this.downloadAllTreesJson(password, includeAuditLog, this.readExportPrivacyMode(), this.readExportContentOptions());
        }, !quick, quick
            ? { quick: { hint: strings.fileCopy.quickHintAll(TreeManager.getTrees().length) } }
            : { format: 'all' });
    },

    /** Every tree into one JSON file (the "Export all" backup). Returns the file name. */
    async downloadAllTreesJson(password: string | null, includeAuditLog: boolean, privacyMode: PrivacyMode, content: ContentOptions): Promise<string> {
        const { applyLivingPrivacy, applyContentOptions } = await import('../privacy.js');
        const trees = TreeManager.getTrees();
        const allData: Record<string, { name: string; data: StromData; auditLog?: AuditLog }> = {};

        for (const tree of trees) {
            const data = await TreeManager.getTreeData(tree.id);
            if (data) {
                let treeExport = applyLivingPrivacy(data, privacyMode);
                treeExport = applyContentOptions(treeExport, content);
                const entry: { name: string; data: StromData; auditLog?: AuditLog } = {
                    name: tree.name,
                    data: treeExport
                };
                if (includeAuditLog) {
                    const log = await AuditLogManager.exportForTree(tree.id);
                    if (log) entry.auditLog = log;
                }
                allData[tree.id] = entry;
            }
        }

        let dataStr: string;
        if (password) {
            const { encrypt } = await import('../crypto.js');
            const encrypted = await encrypt(JSON.stringify(allData), password);
            dataStr = JSON.stringify(encrypted, null, 2);
        } else {
            dataStr = JSON.stringify(allData, null, 2);
        }

        const fileName = 'strom-all-trees.json';
        const blob = new Blob([dataStr], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);
        if (privacyMode === 'full') TreeManager.noteFileCopy(Object.keys(allData) as TreeId[]);
        return fileName;
    },
});
