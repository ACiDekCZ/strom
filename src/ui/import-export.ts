/**
 * import export UI methods. Extracted from the original UIClass;
 * see src/ui/module.ts for the composition pattern.
 */

import { runTreeSwitch } from './tree-switch-busy.js';
import { activatedElement, busyLocal, busyStep, busyToast, clearBusyMessage, isBusy, runBusy, runHeavy, showBusyMessage } from './busy.js';
import { runInParts } from './in-parts.js';
import { canvasBusy } from './canvas-busy.js';
import { holdLeave } from './busy-leave.js';
import { openFilePicker, takePickOrigin, readPickedFile, FileUnreadableError, looksLikeGedcom, paintBeforeParse, fileReadStep } from './file-pick.js';
import type { FollowSwitchFrom } from './research-follow-ui.js';
import { allMedia } from '../media.js';
import type { PrivacyMode, ContentOptions } from '../privacy.js';
import { noteExportAll } from '../research-device.js';
import { DataManager, auditPersonName, storedTreeForExport } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { sanitizeResearchField } from '../research-link.js';
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
import { strings } from '../strings.js';
import { extractSubtree } from '../subtree.js';
import { findComponents } from '../components.js';
import { compressPhoto, dataUrlByteSize } from '../photo.js';
import { compressImageAttachment, readFileAsDataUrl, countImages, stripMedia } from '../attachments.js';
import { getDemoTree, DEMO_FOCUS } from '../demo-tree.js';
import { demoImageMaker } from '../demo-images.js';
import {
    parseGedcomSteps, convertToStromSteps, decodeGedcomBytes, GedcomConversionResult, GedcomEncoding, GEDCOM_ENCODING_CHOICES,
    gedcomSampleNames, GedcomImportOrigin,
} from '../ged-parser.js';
import { createSha256 } from '../sha256.js';
import { localIsoDay } from '../import-origin.js';
import { attachGedcomMediaFile, gedcomMediaAttachedText, GedcomMediaAttached, GedcomMediaTarget } from '../ged-media-attach.js';
import { importProgramName } from '../import-next.js';

/**
 * What an import brought, for the steps after it (spec 066). `gedcom`: from a
 * GEDCOM file; `path`: a new tree, inserted into the current (empty) tree, or
 * merged into a new tree; `importId`: the file's import record in the tree;
 * `added` / `updated`: people a merge added and merged into existing ones.
 */
export interface AfterImportOptions {
    gedcom?: boolean;
    path?: 'new' | 'insert' | 'merge';
    importId?: string;
    added?: number;
    updated?: number;
}
import {
    validateJsonImport,
    ValidationResult,
    MergerUI, mergeAnalysisLong,
    getCurrentMergeInfo,
    listMergeSessionsInfo,
    deleteMergeSession,
    renameMergeSession
} from '../merge/index.js';
import { PersonPicker } from '../person-picker.js';
import { AppExporter } from '../export.js';
import { SettingsManager } from '../settings.js';
import { ThemeMode, LanguageSetting, AppMode, AuditLog } from '../types.js';
import { CryptoSession, isEncrypted, encrypt, decrypt, EncryptedData, classifyCryptoError, CryptoFailure } from '../crypto.js';
import { cryptoErrorText, cryptoFailureText, resetPasswordError } from '../crypto-errors.js';
import { validateTreeData, ValidationResult as TreeValidationResult, ValidationIssue } from '../validation.js';
import * as CrossTree from '../cross-tree.js';
import { AuditLogManager } from '../audit-log.js';
import { uiModule } from './module.js';
import { safeFileName } from '../filenames.js';
import { isMultiTreeBackup, readEmbeddedHtml, readWindowAssignment, BackupTrees, BackupTreeEntry } from '../backup-formats.js';
import { viewLinksPayload } from '../view-links.js';
import type { PersonList } from '../types.js';
import { listDisplayName, listKind } from '../person-lists.js';
import { listKindIcon } from './list-kind-icon.js';

/** A list the export dialog's list scope offers (spec 084 §12): one with people. */
interface ExportableList { list: PersonList; count: number }

/** The active tree's lists with people, by name. */
function exportableLists(): ExportableList[] {
    return DataManager.getPersonLists()
        .map(list => ({ list, count: DataManager.getPersonListIds(list.id).length }))
        .filter(l => l.count > 0)
        .sort((a, b) => listDisplayName(a.list).localeCompare(listDisplayName(b.list)));
}

/**
 * §8 C52/C53: a GEDCOM text read and converted in parts, the page let go every 40 ms; `people` hears the people
 * found so far ("Loading family.ged… 2,400 people").
 */
async function readGedcomInParts(text: string, importOrigin: GedcomImportOrigin, people: (n: number) => void): Promise<GedcomConversionResult> {
    const parsed = await runInParts(parseGedcomSteps(text), { onStep: s => people(s.people) });
    people(parsed.individuals.size);
    return runInParts(convertToStromSteps(parsed, { importOrigin }), { onStep: s => people(s.people) });
}

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

        // The link-file tile says what linking does (no path in a menu); the save
        // shortcut follows only with a pointer that hovers (⌘S on a Mac).
        const linkDesc = document.getElementById('export-link-file-desc');
        if (linkDesc) {
            const hover = typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches;
            linkDesc.textContent = hover
                ? strings.exportMenu.linkFileDescKey(this.shortcutHint('save'))
                : strings.exportMenu.linkFileDesc;
        }

        // Handle dialog stack for ESC navigation
        this.clearDialogStack();
        if (parentDialogId) {
            this.pushDialog(parentDialogId);
            this.closeDialogById(parentDialogId);
        }
        this.pushDialog('export-modal');

        this.renderExportScope();
        document.getElementById('export-modal')?.classList.add('active');
    },

    /**
     * The export dialog's "Whole tree · Current view only (N people) · List
     * of people" switch (remembered). The view exists for the active tree
     * only, and only when it shows anyone (the fan / timeline views lay out
     * no people); the list scope (spec 084 §12) only when the active tree has
     * a list with people, its list chosen below the switch. In the view and
     * list scopes the formats that cannot export them are disabled.
     */
    renderExportScope(): void {
        const modal = document.getElementById('export-modal');
        if (!modal) return;
        const isActive = this.exportTargetTreeId === TreeManager.getActiveTreeId();
        const count = isActive ? TreeRenderer.getVisiblePersonIds().size : 0;
        const lists = isActive ? exportableLists() : [];
        let scope = SettingsManager.getExportScope();
        if (scope === 'view' && count === 0) scope = 'tree';
        const listId = SettingsManager.getExportListId();
        const list = lists.find(l => l.list.id === listId) ?? null;
        // A remembered list that is gone (another tree, deleted, empty): the whole tree.
        if (scope === 'list' && !list) scope = 'tree';
        modal.classList.toggle('scope-view', scope === 'view');
        modal.classList.toggle('scope-list', scope === 'list');
        const viewBtn = document.getElementById('export-scope-view') as HTMLButtonElement | null;
        if (viewBtn) {
            viewBtn.textContent = strings.exportMenu.scopeView(count);
            viewBtn.disabled = count === 0;
        }
        const listBtn = document.getElementById('export-scope-list') as HTMLButtonElement | null;
        if (listBtn) listBtn.hidden = lists.length === 0;
        modal.querySelectorAll<HTMLButtonElement>('.export-scope .segment-btn').forEach(btn => {
            const on = btn.dataset.scope === scope;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-checked', String(on));
        });
        this.renderExportListPick(scope === 'list' ? lists : [], list?.list.id ?? null);
        modal.querySelectorAll<HTMLButtonElement>('.menu-options .menu-option').forEach(option => {
            const viewOk = option.hasAttribute('data-view-ok');
            const listOk = option.hasAttribute('data-list-ok');
            if (viewOk && listOk) return;
            const text = option.querySelector('.option-text');
            let note = text?.querySelector('.option-scope-note');
            if (text && !note) {
                note = document.createElement('span');
                note.className = 'option-desc option-scope-note';
                text.appendChild(note);
            }
            if (note) note.textContent = strings.exportMenu.scopeWholeOnly;
            option.disabled = (scope === 'view' && !viewOk) || (scope === 'list' && !listOk);
        });
        // The view's people without anyone seen only through a link shown in the view.
        this.renderViewLinksNote(document.getElementById('export-scope'), isActive && scope === 'view');
    },

    /** The list choice under the switch (spec 084 §12): the kind's icon, "name · N people"; hidden outside the list scope. */
    renderExportListPick(lists: ExportableList[], chosen: string | null): void {
        const box = document.getElementById('export-list-pick');
        const select = document.getElementById('export-list-select') as HTMLSelectElement | null;
        if (!box || !select) return;
        box.hidden = !lists.length;
        if (!lists.length) return;
        select.replaceChildren(...lists.map(l => {
            const o = document.createElement('option');
            o.value = l.list.id;
            o.textContent = `${listDisplayName(l.list)} · ${strings.lists.persons(l.count)}`;
            return o;
        }));
        const on = lists.find(l => l.list.id === chosen) ?? lists[0];
        select.value = on.list.id;
        const icon = document.getElementById('export-list-kind');
        if (icon) icon.innerHTML = listKindIcon(listKind(on.list), 16);
    },

    setExportScope(scope: 'tree' | 'view' | 'list'): void {
        // The list scope starts on the remembered list, else the first one.
        if (scope === 'list') {
            const lists = exportableLists();
            if (!lists.length) return;
            const id = SettingsManager.getExportListId();
            if (!lists.some(l => l.list.id === id)) SettingsManager.setExportListId(lists[0].list.id);
        }
        SettingsManager.setExportScope(scope);
        this.renderExportScope();
    },

    /** The list of the list scope (spec 084 §12), remembered. */
    setExportList(id: string): void {
        if (!exportableLists().some(l => l.list.id === id)) return;
        SettingsManager.setExportListId(id);
        SettingsManager.setExportScope('list');
        this.renderExportScope();
    },

    /**
     * The export dialog opened on a list (⋯ of a list › Export › GEDCOM…,
     * spec 084 §12): the list scope with the list chosen.
     */
    showExportDialogForList(listId: string): void {
        if (!exportableLists().some(l => l.list.id === listId)) return;
        SettingsManager.setExportListId(listId);
        SettingsManager.setExportScope('list');
        this.showExportDialog();
    },

    /**
     * The list the export dialog exports now (its list scope), with its
     * people in the list's order; null: the whole tree or the view.
     */
    exportScopeList(): { list: PersonList; ids: PersonId[] } | null {
        const modal = document.getElementById('export-modal');
        if (!modal?.classList.contains('active') || !modal.classList.contains('scope-list')) return null;
        const id = SettingsManager.getExportListId();
        const list = id ? DataManager.getPersonList(id) : undefined;
        if (!list) return null;
        const ids = DataManager.getPersonListIds(list.id).filter(pid => !!DataManager.getData().persons[pid]);
        return ids.length ? { list, ids } : null;
    },

    /** The export dialog's JSON backup: the whole tree, only the people the view shows, or the list's (spec 084 §12). */
    exportBackupFromDialog(): void {
        const scoped = this.exportScopeList();
        if (scoped) {
            void this.exportPersonListJSON(scoped.list, scoped.ids);
        } else if (document.getElementById('export-modal')?.classList.contains('scope-view')) {
            void this.exportFocusedJSON();
        } else {
            void this.exportTargetTreeJSON();
        }
    },

    /** The JSON backup of a list's people (the tree's data narrowed to them, spec 084 §12). */
    async exportPersonListJSON(list: PersonList, ids: PersonId[]): Promise<void> {
        this.closeExportDialog();
        const treeName = TreeManager.getTreeMetadata(TreeManager.getActiveTreeId() as TreeId)?.name;
        const file = `${safeFileName(treeName, 'family-tree')}-${safeFileName(listDisplayName(list), 'list')}.json`;
        this.showExportPasswordDialog(async (password: string | null) => {
            await DataManager.exportFocusedJSON(new Set(ids), password, this.readExportPrivacyMode(), this.readExportContentOptions(), file);
            return file;
        }, false, { format: 'json' });
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
            return await DataManager.exportTreeJSON(treeId, password, this.readExportPrivacyMode(), this.readExportContentOptions());
        }, false, quick ? { quick: { hint: strings.fileCopy.quickHint(name) } } : { format: 'json', treeId });
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
        }, false, { defaultPrivacy: 'initials', format: 'html', treeId });
    },

    /**
     * Export target tree as GEDCOM file
     */
    async exportTargetTreeGedcom(opts: { preset?: 'back' } = {}): Promise<void> {
        // `preset: 'back'` ("Back to {prog}: export with sources…" of the What next card,
        // spec 066 §4) opens the dialog with "Back to {prog}" chosen.
        const treeId = this.getExportTargetTreeId();
        if (!treeId) {
            this.closeExportDialog();
            return;
        }
        // The dialog's list scope (spec 084 §12): the list's people and the families between them.
        const scoped = this.exportScopeList();
        this.closeExportDialog();

        // GEDCOM cannot be encrypted, so show the export dialog in passwordless
        // mode to pick the living-privacy level and what content (photos,
        // attachments — embedded as base64) goes into the file.
        this.showExportPasswordDialog(async () => {
            const { exportToGedcom } = await import('../ged-exporter.js');
            const { applyLivingPrivacy } = await import('../privacy.js');
            const stored = await storedTreeForExport(treeId);
            const metadata = TreeManager.getTreeMetadata(treeId);
            if (!stored) return;
            const data: StromData = scoped ? { version: stored.version, ...extractSubtree(stored, new Set(scoped.ids)) } : stored;

            const { isFaithfulExport } = await import('../research-link.js');
            const { resolveContentOptions } = await import('../privacy.js');
            // "Back to {prog}" gives Full data and its own content (read through the dialog).
            const privacy = this.readExportPrivacyMode();
            const content = this.readExportContentOptions();
            const researchNote = this.exportGedcomResearchNote();
            // Every privacy choice keeps the deceased's sources and citations (spec 066 §4).
            const filtered = applyLivingPrivacy(data, privacy, undefined, { keepDeceasedSources: true });
            // A faithful export of a research tree names the research and its version.
            const research = metadata?.research && isFaithfulExport(privacy, resolveContentOptions(content))
                ? { id: metadata.research.id, head: metadata.research.head, appTree: treeId, transcripts: this.researchTranscriptsLink(metadata.research).transcripts } : undefined;
            const backTo = this.exportGedcomBackTo(data);
            // A research tree's citations in the research's order when it orders them (spec 095); a main citation always marked.
            const { citationFileOrder } = await import('../citation-gates.js');
            const result = exportToGedcom(filtered, metadata?.name, {
                content, research, origins: true, confirmations: true, researchNote, backTo, citationFileOrder: citationFileOrder(treeId),
            });

            // Download file
            const blob = new Blob([result.content], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = scoped
                ? `${safeFileName(metadata?.name, 'family-tree')}-${safeFileName(listDisplayName(scoped.list), 'list')}.ged`
                : `${safeFileName(metadata?.name, 'family-tree')}.ged`;
            a.click();
            URL.revokeObjectURL(url);
            // The file carries the photos and attachments only when the content kept them (embedded).
            if (privacy === 'full' && !scoped) TreeManager.noteFileCopy([treeId], content.photos && content.attachments ? { [treeId]: filtered } : undefined);
            return a.download;
        }, false, { defaultPrivacy: 'initials', passwordless: true, content: true, format: 'gedcom', treeId, gedcomPurpose: opts.preset === 'back' ? 'back' : 'share' });
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
            const data = await storedTreeForExport(treeId);
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
            return a.download;
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
        }, true, { defaultPrivacy: 'full', format: 'html', allTrees: true });
    },

    /**
     * Export the people the view shows as JSON (the export dialog's JSON
     * backup in the "Current view only" scope).
     */
    async exportFocusedJSON(): Promise<void> {
        this.closeExportDialog();

        this.showExportPasswordDialog(async (password: string | null) => {
            const visibleIds = TreeRenderer.getVisiblePersonIds();
            await DataManager.exportFocusedJSON(visibleIds, password, this.readExportPrivacyMode(), this.readExportContentOptions());
            return 'family-tree-focus.json';
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
        this.showImportTreeDialog(subtree, suggested, false, true);
    },

    /**
     * Import… (the tree switcher): a file becomes a NEW tree — JSON, open a
     * file (File System Access) or GEDCOM. No earlier intent (the tree
     * manager's, the empty state's) may leak into it.
     */
    showImportDialog(): void {
        this.importFromTreeManager = false;
        this.importToCurrentTree = false;
        document.getElementById('import-modal')?.classList.add('active');
    },

    closeImportDialog(): void {
        document.getElementById('import-modal')?.classList.remove('active');
    },

    // ---- GEDCOM IMPORT ----
    handleGedcomFile(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        // The element that opened the system dialog carries the reading (9a); a file handed in otherwise has none.
        const origin = takePickOrigin(input);
        if (!file) return;

        // Snapshot the import intent NOW: manager / empty-state paths set their
        // flag right before triggering this input; the plain "Import GEDCOM"
        // menu triggers it with no flag set, so stale flags from an earlier
        // import must not leak in. Re-apply the snapshot when the async read
        // resolves (input.value reset below would otherwise not matter).
        const fromManager = this.importFromTreeManager;
        const toCurrent = this.importToCurrentTree;
        // Reset input so same file can be re-imported
        input.value = '';

        void (async () => {
            const got = await readPickedFile(origin, file, async ctl => {
                // Raw bytes, not readAsText: the file's own HEAD > CHAR (or, for
                // ANSI, its bytes) decides the encoding; the summary offers another.
                const buffer = await file.arrayBuffer();
                const decoding = decodeGedcomBytes(buffer);
                // Not a GEDCOM at all: said at the element, never an empty tree made of it (9a).
                if (!looksLikeGedcom(decoding.text)) throw new FileUnreadableError();
                const sha = createSha256();
                sha.update(new Uint8Array(buffer));
                // The import's record (file, hash, day) is read by gedcomImportOrigin during the conversion.
                this.gedcomFileInfo = { name: file.name, sha: sha.digestHex(), at: localIsoDay() };
                // §8 C52: read in parts, the page let go between them, the people found so far in the state.
                const result = await readGedcomInParts(decoding.text, this.gedcomImportOrigin(decoding.encoding), ctl.people);
                ctl.people(result.stats.totalPersons);
                return { buffer, decoding, info: this.gedcomFileInfo, result };
            }, () => { this.importFromTreeManager = fromManager; this.importToCurrentTree = toCurrent; openFilePicker(input, origin); });
            if (!got) return;
            this.gedcomFileInfo = got.info;
            this.gedcomResult = got.result;
            this.gedcomRawBuffer = got.buffer;
            this.gedcomDecoding = got.decoding;
            this.gedcomImportImages = null;
            this.importFromTreeManager = fromManager;
            this.importToCurrentTree = toCurrent;
            this.leavePickDialog();
            this.showGedcomResultDialog();
        })();
    },

    /**
     * The menu dialog a file was picked from (Import, New tree, Import from a
     * file) stays open while the system dialog is open and the file is read
     * (9a: a choice called off leaves it as it was, an unreadable file is said
     * there); it goes once the file is read, as its opening did before.
     */
    leavePickDialog(): void {
        const active = (id: string): boolean => !!document.getElementById(id)?.classList.contains('active');
        if (active('import-modal')) this.closeImportDialog();
        if (active('import-file-modal')) this.closeImportFileDialog();
        if (active('new-tree-menu-modal')) {
            // Into the import, the tree manager stays the dialog to come back to.
            document.getElementById('new-tree-menu-modal')?.classList.remove('active');
            if (this.dialogStack[this.dialogStack.length - 1] === 'new-tree-menu-modal') this.dialogStack.pop();
        }
    },

    /** One of the import inputs opened for the element of this click (the dialog it is in stays, 9a). */
    pickImportFile(inputId: 'file-input' | 'gedcom-input' | 'html-input'): void {
        openFilePicker(document.getElementById(inputId) as HTMLInputElement | null);
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
        // after a media attach keeps the choice already made. Only images
        // that are in the data: the files a GEDCOM merely names come in by
        // the media row below, and before that there is nothing to leave out
        // ("≈ 0.0 MB").
        if (this.gedcomImportImages === null) this.gedcomImportImages = SettingsManager.isImportImages();
        const imagesRow = document.getElementById('gedcom-images-row');
        const hasImages = images.photos + images.attachments + images.excerpts > 0;
        if (imagesRow) imagesRow.style.display = hasImages ? '' : 'none';
        const imagesCheck = document.getElementById('gedcom-import-images') as HTMLInputElement | null;
        if (imagesCheck) imagesCheck.checked = this.gedcomImportImages;
        const sizeEl = document.getElementById('gedcom-images-size');
        if (sizeEl) sizeEl.textContent = strings.importImages.size((images.bytes / (1024 * 1024)).toFixed(1));
        this.applyGedcomImagesChoice();

        // What exactly was skipped (previously a dead counter — always 0).
        const detailEl = document.getElementById('gedcom-stat-detail');
        if (detailEl) {
            const stats = this.gedcomResult.stats;
            // What was not carried over: what the number means, before the list it names.
            const lost = stats.droppedTagSummary
                ? [strings.gedcom.unsupportedHint, `${strings.gedcom.skippedTags}: ${stats.droppedTagSummary}`] : [];
            // Another program's own tags, kept for the way back (spec 066 G8):
            // a line of their own after what was not carried over, never in
            // the "Unsupported" count.
            const keptFrom = this.gedcomResult.data.imports?.find(r => r.id === this.gedcomResult?.importId);
            const kept = stats.keptTags > 0 && keptFrom
                ? [strings.gedcom.keptTags(importProgramName(keptFrom), stats.keptTags, stats.keptTagSummary)] : [];
            const people = [
                ...(stats.unknownSexPersons > 0 ? [strings.gedcom.unknownSex(stats.unknownSexPersons)] : []),
                ...(stats.otherFamilyLinks > 0 ? [strings.gedcom.otherFamilyLinks(stats.otherFamilyLinks)] : []),
                ...(stats.joinedFamilies > 0
                    ? [strings.gedcom.joinedFamilies(stats.joinedFamilies, keptFrom ? importProgramName(keptFrom) : undefined)] : []),
                // Another program's shared events made into the app's (spec 085 7b).
                ...(stats.sharedConverted > 0
                    ? [strings.gedcom.sharedConverted(keptFrom ? importProgramName(keptFrom) : stats.sharedProgram,
                        stats.sharedConverted, stats.sharedConvertedPersons)] : []),
            ];
            // Nothing lost and nothing to say about people: said out loud —
            // silence reads as "who knows what got lost".
            const all = lost.length === 0 && people.length === 0 && stats.unsupportedTags === 0 ? [strings.gedcom.allImported] : [];
            const parts = lost.length > 0 ? [...lost, ...kept, ...people] : [...all, ...people, ...kept];
            // One line each: the people of unknown sex were imported, and next to
            // "Skipped records" on the same line they read as skipped people.
            detailEl.replaceChildren(...parts.map(text => {
                const line = document.createElement('span');
                line.className = 'gedcom-stat-line';
                line.textContent = text;
                return line;
            }));
            detailEl.style.display = parts.length > 0 ? '' : 'none';
        }

        this.renderGedcomEncoding();

        // External media (photos exported as a separate folder by platforms):
        // offer bulk attach BEFORE the data is inserted anywhere.
        const mediaRow = document.getElementById('gedcom-media-row');
        const mediaText = document.getElementById('gedcom-media-text');
        const pending = this.gedcomResult.externalMedia.length;
        if (mediaRow) mediaRow.style.display = pending > 0 && this.gedcomImportImages !== false ? '' : 'none';
        // Couples' photos among them (spec 107): the sentence says how many are whose.
        const onCouples = this.gedcomResult.externalMedia.filter(r => r.partnershipId).length;
        if (mediaText && pending > 0) {
            mediaText.textContent = onCouples > 0
                ? strings.gedcom.externalMediaSplit(pending, pending - onCouples, onCouples)
                : strings.gedcom.externalMedia(pending);
        }
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
    /** "Attach media files…": the system's dialog with nothing shown, the button only guarded (§9). */
    pickGedcomMedia(): void {
        openFilePicker(document.getElementById('gedcom-media-input') as HTMLInputElement | null);
    },

    async attachGedcomMedia(files: FileList | null): Promise<void> {
        // The button that opened the dialog carries the attaching (each image compressed): "Loading <name>… k of n".
        const origin = takePickOrigin(document.getElementById('gedcom-media-input') as HTMLInputElement | null);
        if (!this.gedcomResult || !files || files.length === 0) return;
        const byName = new Map<string, File>();
        for (const f of Array.from(files)) byName.set(f.name.toLowerCase(), f);

        const refs = this.gedcomResult.externalMedia;
        const total = refs.length;
        const became = new Map<GedcomMediaAttached, number>();
        const remaining: typeof refs = [];

        const attachAll = async (step: (text: string) => void): Promise<void> => {
            const todo = refs.filter(r => byName.has(r.fileName.toLowerCase())).length;
            let k = 0;
            for (const ref of refs) {
                const file = byName.get(ref.fileName.toLowerCase());
                if (file) step(`${strings.busy.loadingFile(file.name)} ${strings.busy.kOfN(++k, todo)}`);
                const kind = file ? await this.attachFileToGedcomRef(ref, file) : null;
                if (!kind) {
                    remaining.push(ref);
                    continue;
                }
                became.set(kind, (became.get(kind) ?? 0) + 1);
            }
        };
        if (origin) await runBusy(origin, ctl => attachAll(t => ctl.step(t)), { label: strings.busy.generic, kind: 'local' });
        else await attachAll(() => undefined);
        const matched = [...became.values()].reduce((a, b) => a + b, 0);
        // Fix attachment sizes from data URLs (compression changed them).
        for (const att of allMedia(this.gedcomResult.data)) {
            if (!att.sizeBytes && !att.originalOnly) att.sizeBytes = dataUrlByteSize(att.dataUrl);
        }

        this.gedcomResult.externalMedia = remaining;
        // Files brought in by hand are images wanted in this import.
        if (matched > 0) this.gedcomImportImages = true;
        this.showToast(matched > 0
            ? gedcomMediaAttachedText(became, total)
            : strings.gedcom.mediaNoMatch);
        this.showGedcomResultDialog();   // refresh tiles + media row
    },

    /** Attach one picked/downloaded file to the person or couple of a media ref (what it became, or null). */
    async attachFileToGedcomRef(ref: GedcomMediaTarget, file: File): Promise<GedcomMediaAttached | null> {
        if (!this.gedcomResult) return null;
        return attachGedcomMediaFile(this.gedcomResult.data, ref, file, {
            portrait: compressPhoto, image: compressImageAttachment, raw: readFileAsDataUrl,
        });
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
        if (btn && isBusy(btn)) return;
        let ok = 0;
        const became = new Map<GedcomMediaAttached, number>();
        const succeeded = new Set<(typeof refs)[number]>();
        // The button's working state (§2): "Downloading photos… k/n" as its words; its own label again at the end.
        const downloadAll = async (step: (text: string) => void): Promise<void> => {
            let done = 0;
            for (const ref of urlRefs) {
                step(strings.gedcom.downloading(++done, urlRefs.length));
                try {
                    const resp = await fetch(ref.filePath);
                    if (!resp.ok) continue;
                    const blob = await resp.blob();
                    const type = blob.type || 'image/jpeg';
                    const file = new File([blob], ref.fileName, { type });
                    const kind = await this.attachFileToGedcomRef(ref, file);
                    if (kind) {
                        succeeded.add(ref);
                        became.set(kind, (became.get(kind) ?? 0) + 1);
                        ok++;
                    }
                } catch { /* expired link, offline, CORS — ref stays offered */ }
            }
        };
        if (btn && btn.isConnected) {
            await runBusy(btn, ctl => downloadAll(t => ctl.step(t)),
                { label: strings.gedcom.downloading(1, urlRefs.length), kind: 'local' });
        } else {
            await downloadAll(() => undefined);
        }

        this.gedcomResult.externalMedia = refs.filter(r => !succeeded.has(r));
        // The photos go into the import, not yet into the tree: no "Undo" of an earlier change rides in this message.
        this.dismissUndoToast();
        if (ok > 0) this.gedcomImportImages = true;
        this.showToast(ok > 0
            ? gedcomMediaAttachedText(became, urlRefs.length)
            : strings.gedcom.mediaDownloadFailed(urlRefs.length));
        this.showGedcomResultDialog();
    },

    /**
     * The text-encoding row of the GEDCOM summary: shown when the file has
     * non-ASCII text in a single-byte or guessed encoding (ANSI, no CHAR,
     * ANSEL …), with a sample of names and a menu of other encodings.
     */
    renderGedcomEncoding(): void {
        const row = document.getElementById('gedcom-encoding-row');
        const d = this.gedcomDecoding;
        if (!row) return;
        const unicode = d?.encoding === 'utf-8' || d?.encoding === 'utf-16le' || d?.encoding === 'utf-16be';
        const show = !!d && !!this.gedcomResult && d.nonAscii && (d.how === 'chosen' || !unicode);
        row.style.display = show ? '' : 'none';
        if (!show || !d || !this.gedcomResult) return;

        const select = document.getElementById('gedcom-encoding-select') as HTMLSelectElement | null;
        if (select) {
            const choices = GEDCOM_ENCODING_CHOICES.includes(d.encoding)
                ? GEDCOM_ENCODING_CHOICES : [d.encoding, ...GEDCOM_ENCODING_CHOICES];
            select.replaceChildren(...choices.map(enc => {
                const option = document.createElement('option');
                option.value = enc;
                option.textContent = strings.gedcom.encodingNames[enc] ?? enc.toUpperCase();
                return option;
            }));
            select.value = d.encoding;
        }
        const how = document.getElementById('gedcom-encoding-how');
        if (how) {
            const said = d.how === 'chosen' ? strings.gedcom.encodingChosen
                : d.how === 'content' ? strings.gedcom.encodingGuessed(d.declared)
                    : strings.gedcom.encodingDeclared;
            how.textContent = `${said} ${strings.gedcom.encodingHint}`;
        }
        const names = document.getElementById('gedcom-encoding-names');
        if (names) names.textContent = gedcomSampleNames(this.gedcomResult.data).join(' · ');
    },

    /** Re-read the GEDCOM file of the summary in another encoding and show the summary again. */
    async setGedcomEncoding(encoding: string): Promise<void> {
        const buffer = this.gedcomRawBuffer;
        if (!buffer || !(GEDCOM_ENCODING_CHOICES as readonly string[]).includes(encoding)) return;
        const select = document.getElementById('gedcom-encoding-select') as HTMLSelectElement | null;
        // One reading at a time: a choice made meanwhile goes back to the one being read.
        if (select?.getAttribute('aria-busy') === 'true') {
            select.value = this.gedcomEncodingReading ?? select.value;
            return;
        }
        // C53, §8: the file read again in parts; the select locked (its focus kept) with the step under it
        // ("Loading family.ged… 2,400 people", seen after 120 ms).
        const name = this.gedcomFileInfo?.name ?? '';
        if (select) clearBusyMessage(select);
        const step = select ? busyStep(select, fileReadStep(name)) : null;
        select?.setAttribute('aria-busy', 'true');
        select?.setAttribute('aria-disabled', 'true');
        this.gedcomEncodingReading = encoding;
        let ok = false;
        try {
            const decoding = decodeGedcomBytes(buffer, encoding as GedcomEncoding);
            // The import record says which encoding the file was read in: this one now.
            const result = await readGedcomInParts(decoding.text, this.gedcomImportOrigin(decoding.encoding),
                n => step?.set(fileReadStep(name, n)));
            if (this.gedcomRawBuffer === buffer) {
                this.gedcomDecoding = decoding;
                this.gedcomResult = result;
                ok = true;
            }
        } catch (error) {
            console.error('GEDCOM parse error:', error);
            step?.clear();
            if (select) showBusyMessage(select, { ok: false, kind: 'error', text: strings.busy.fileUnreadable });
            else this.showAlert(strings.gedcom.parseError, 'error');
        } finally {
            step?.clear();
            select?.removeAttribute('aria-busy');
            select?.removeAttribute('aria-disabled');
            this.gedcomEncodingReading = null;
        }
        if (ok) this.showGedcomResultDialog();
    },

    /** The origin of the GEDCOM file in the result dialog, read in `encoding` (its import record). */
    gedcomImportOrigin(encoding: string): GedcomImportOrigin {
        const info = this.gedcomFileInfo;
        return {
            at: info?.at ?? localIsoDay(),
            ...(info?.name ? { file: info.name } : {}),
            encoding,
            ...(info?.sha ? { sha: info.sha } : {}),
        };
    },

    closeGedcomResultDialog(): void {
        document.getElementById('gedcom-result-modal')?.classList.remove('active');
        this.gedcomRawBuffer = null;
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

    /**
     * Dim the image tiles and hide the external-media offer when images stay
     * out — while the checkbox is there to bring them back (with no image in
     * the data yet, the offer itself is the choice).
     */
    applyGedcomImagesChoice(): void {
        const result = this.gedcomResult;
        const images = result ? countImages(result.data) : null;
        const off = this.gedcomImportImages === false
            && !!images && images.photos + images.attachments + images.excerpts > 0;
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
        this.gedcomRawBuffer = null;
        const importId = this.gedcomResult.importId;

        // Check if importing directly to current tree (from empty state)
        if (this.importToCurrentTree) {
            this.importToCurrentTree = false;
            // Close gedcom result dialog
            document.getElementById('gedcom-result-modal')?.classList.remove('active');
            this.clearDialogStack();
            // Back up the current state before overwriting it (as a JSON file does).
            void DataManager.snapshotNow('pre-import');
            // Load data directly into current tree
            DataManager.loadStromData(this.gedcomDataForImport());
            // §8: the imported tree laid out under the canvas overlay (a large file: "Calculating the layout…").
            void canvasBusy(() => TreeRenderer.renderAsync());
            this.gedcomResult = null;
            const treeId = DataManager.getCurrentTreeId();
            // A file from another program gets the "What next" card in place of the toast.
            if (!importId || !treeId) this.showToast(strings.buttons.importComplete);
            if (treeId) void this.afterImport(treeId, { gedcom: true, path: 'insert', ...(importId ? { importId } : {}) });
            return;
        }

        // Save flag before close (which resets it)
        const fromManager = this.importFromTreeManager;

        // Close gedcom result but don't return to parent yet
        document.getElementById('gedcom-result-modal')?.classList.remove('active');
        this.dialogStack.pop(); // Remove gedcom-result-modal

        // Show import tree dialog with parent preserved
        this.showImportTreeDialog(this.gedcomDataForImport(), strings.treeManager.importTreeName, fromManager);
        this.pendingGedcomImport = importId ? { importId } : {};
        this.gedcomResult = null;
    },

    /**
     * Merge GEDCOM data with existing tree
     */
    async mergeGedcomWithExisting(): Promise<void> {
        const result = this.gedcomResult;
        if (!result) return;
        const incoming = this.gedcomDataForImport();
        // §8: the matching runs under the working state of the choice, its words at once for large trees.
        await runHeavy(activatedElement(), () => {
            if (this.gedcomResult !== result) return;
            MergerUI.startMerge(incoming, undefined, false,
                { gedcom: true, ...(result.importId ? { importId: result.importId } : {}) });
            this.gedcomResult = null;
            this.closeGedcomResultDialog();
        }, { label: strings.merge.analyzing, atOnce: mergeAnalysisLong(DataManager.getData(), incoming) });
    },

    // ---- JSON IMPORT WITH VALIDATION ----
    /**
     * Handle JSON file import with validation
     */
    handleJsonFile(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        const origin = takePickOrigin(input);
        if (!file) return;
        // Reset input
        input.value = '';
        void this.readJsonImportFile(file, origin, () => { openFilePicker(input, origin); });
    },

    /**
     * A chosen JSON file read as its element's working state (9a): a file that
     * is not JSON is said there with "Choose another file", the rest goes on
     * as an import of its text.
     */
    async readJsonImportFile(file: File, origin: HTMLElement | null, again: () => void): Promise<void> {
        // A stale handle from an earlier (failed/cancelled) "open from
        // file" must never get attached to THIS unrelated import — Ctrl+S
        // would then silently overwrite the wrong file on disk.
        await this.readJsonImportText(file.name, () => file.text(), file.size, origin, again,
            () => { this.pendingOpenFileHandle = null; });
    },

    /** See readJsonImportFile; `before` runs once the text is read, before the import. */
    async readJsonImportText(name: string, read: () => Promise<string>, size: number, origin: HTMLElement | null,
        again: () => void, before?: () => void): Promise<void> {
        const got = await readPickedFile(origin, { name }, async ctl => {
            const text = await read();
            await paintBeforeParse(size);
            let parsed: unknown;
            try {
                parsed = JSON.parse(text);
            } catch {
                throw new FileUnreadableError();
            }
            if (!parsed || typeof parsed !== 'object') throw new FileUnreadableError();
            const persons = (parsed as { persons?: unknown }).persons;
            if (persons && typeof persons === 'object') ctl.people(Object.keys(persons).length);
            return { text, parsed };
        }, again);
        if (!got) return;
        before?.();
        this.leavePickDialog();
        await this.importJsonString(got.text, got.parsed);
    },

    /**
     * Validate and import a JSON string through the same path as a file upload
     * (encrypted → password prompt, invalid → dialog, warnings → confirm). Shared
     * by the file-input upload and the File System Access "open from file" flow.
     */
    async importJsonString(content: string, parsedAlready?: unknown): Promise<void> {
        let parsed: unknown = parsedAlready;
        if (parsedAlready === undefined) {
            try {
                parsed = JSON.parse(content);
            } catch {
                this.showValidationDialog({ valid: false, errors: ['validation.invalidJson'], warnings: [] });
                return;
            }
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
        // A faithful export of a research tree names its research: the tree
        // made from it is tied again (sending changes back works from here).
        this.pendingImportResearch = sanitizeResearchField((parsed as { research?: unknown } | null)?.research);

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
            const loadedId = DataManager.getCurrentTreeId();
            if (loadedId) this.restoreImportResearch(loadedId);
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

        // Clear fields but keep modal behind tree manager (outside a
        // secure context the notice shows at once)
        input.value = '';
        resetPasswordError(error);

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

        let decrypted: string;
        try {
            const { decrypt } = await import('../crypto.js');
            decrypted = await decrypt(this.pendingEncryptedImport, password);
        } catch (err) {
            // Wrong password (or another failure, said as what it is):
            // show the error and keep the dialog open (GitHub #13)
            if (error) {
                error.textContent = cryptoErrorText(err);
                error.style.display = 'block';
            }
            // Clear input for retry
            const input = document.getElementById('password-prompt-input') as HTMLInputElement;
            if (input) {
                input.value = '';
                input.focus();
            }
            return;
        }

        // Success - close dialog and reset flag
        document.getElementById('password-prompt-modal')?.classList.remove('active');
        this.passwordPromptCallbackManagesDialog = false;
        this.pendingEncryptedImport = null;

        // Same routing as a plain file (single tree or "Export all" backup)
        await this.importJsonString(decrypted);
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
        // The dialog stays while the file is chosen and read (9a); it goes once the file is read.
        this.pickImportFile('file-input');
    },

    /**
     * Import GEDCOM directly to current tree (from empty state)
     */
    importGedcomToCurrentTree(): void {
        this.importToCurrentTree = true;
        this.pickImportFile('gedcom-input');
    },

    /**
     * Start JSON import from tree manager
     * Sets up dialog stack for proper navigation
     */
    startJsonImportFromManager(): void {
        this.importFromTreeManager = true;
        // The New tree menu stays while the file is chosen and read (9a); leavePickDialog
        // then closes it and keeps the tree manager in the stack.
        this.pickImportFile('file-input');
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
        this.pickImportFile('gedcom-input');
    },

    startGedcomImportFromManager(): void {
        this.importFromTreeManager = true;
        this.pickImportFile('gedcom-input');
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
        // The menu stays open while the file is chosen (9a): nothing to come back to.
        if (document.getElementById('new-tree-menu-modal')?.classList.contains('active')) return;
        this.importFromTreeManager = false;
        this.showNewTreeMenu();
    },

    /**
     * Start HTML import from tree manager
     */
    startHtmlImportFromManager(): void {
        this.importFromTreeManager = true;
        this.pickImportFile('html-input');
    },

    /**
     * Import HTML directly to current tree (from empty state)
     */
    importHtmlToCurrentTree(): void {
        this.importToCurrentTree = true;
        this.pickImportFile('html-input');
    },

    /**
     * Handle HTML file import
     */
    handleHtmlFile(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        const origin = takePickOrigin(input);
        if (!file) return;
        input.value = '';

        void (async () => {
            const got = await readPickedFile(origin, file, async () => {
                const htmlContent = await file.text();
                const envelope = this.extractEnvelopeFromHtml(htmlContent);
                const content = readEmbeddedHtml(htmlContent);
                // Not a Strom file with data in it: said at the element (9a).
                if (!envelope && !content.envelope?.data && !content.allTrees) throw new FileUnreadableError();
                return { htmlContent, envelope };
            }, () => { openFilePicker(input, origin); });
            if (!got) return;
            this.leavePickDialog();
            // Collaboration: a file replying to one of my shared trees gets the
            // merge offer instead of the plain import flow.
            if (got.envelope && this.handleImportedShareEnvelope(got.envelope)) return;
            await this.importHtmlContent(got.htmlContent);
        })();
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
                } catch (err) {
                    return classifyCryptoError(err);
                }
                await this.continueHtmlImport(trees, single ?? (envData as StromData | undefined) ?? null);
                return 'ok';
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
     * 'ok', or why it failed (the prompt stays open for a retry).
     */
    promptFilePassword(tryPassword: (password: string) => Promise<'ok' | CryptoFailure>): void {
        const modal = document.getElementById('password-prompt-modal');
        const input = document.getElementById('password-prompt-input') as HTMLInputElement;
        const error = document.getElementById('password-prompt-error');
        if (!modal || !input) return;

        input.value = '';
        resetPasswordError(error);
        this.pendingEncryptedData = null;
        this.passwordPromptOnCancel = null;
        this.passwordPromptCallback = async (password: string) => {
            // Close BEFORE continuing: the import flow opens its own dialogs.
            modal.classList.remove('active');
            const result = await tryPassword(password);
            if (result === 'ok') {
                this.passwordPromptCallbackManagesDialog = false;
                return;
            }
            modal.classList.add('active');
            if (error) {
                // Wrong password only when AES-GCM refused it (GitHub #13).
                error.textContent = cryptoFailureText(result);
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
        const valid: Array<{ name: string; data: StromData; isHidden?: boolean; auditLog?: AuditLog; viewLinks?: unknown }> = [];
        let skipped = 0;
        for (const entry of Object.values(trees)) {
            const result = validateJsonImport(JSON.stringify(entry.data));
            if (result.valid && result.data) {
                valid.push({ name: entry.name, data: result.data, isHidden: entry.isHidden, auditLog: entry.auditLog, viewLinks: entry.viewLinks });
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
        // The question's dialog is gone: the writing of every tree as a progress toast past 120 ms (§1).
        const release = holdLeave('import');
        let ids: Awaited<ReturnType<typeof DataManager.importTreesAsNew>>;
        try {
            ids = await busyToast(strings.busy.importing, () => DataManager.importTreesAsNew(valid));
        } finally {
            release();
        }

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

    // ---- IMPORT AS NEW TREE ----
    /**
     * Show import tree dialog (for creating new tree from import). `fromView`:
     * the people of the view (a tree from the view) — the dialog says when
     * links shown only in the view are left out.
     */
    showImportTreeDialog(data: StromData, suggestedName: string, fromTreeManager: boolean = false, fromView = false): void {
        const modal = document.getElementById('import-tree-modal');
        const nameInput = document.getElementById('import-tree-name') as HTMLInputElement;
        const personsEl = document.getElementById('import-tree-persons');
        const partnershipsEl = document.getElementById('import-tree-partnerships');

        if (!modal || !nameInput || !personsEl || !partnershipsEl) return;

        this.importTreeData = data;
        this.importFromTreeManager = fromTreeManager;
        // Set again by a GEDCOM import right after this.
        this.pendingGedcomImport = null;

        // Handle dialog stack - if from tree manager, it's already in stack
        if (fromTreeManager) {
            this.pushDialog('import-tree-modal');
        }

        nameInput.value = suggestedName;
        // People, not the "?" stand-ins (as the tree's own count).
        personsEl.textContent = String(Object.values(data.persons).filter(p => p && !p.isPlaceholder).length);
        partnershipsEl.textContent = String(Object.keys(data.partnerships).length);
        // A tree from the view: nobody seen only through a link shown in the view.
        this.renderViewLinksNote(modal.querySelector('.import-tree-stats'), fromView);

        modal.classList.add('active');
        nameInput.focus();
        nameInput.select();
    },

    /**
     * Close import tree dialog
     */
    /**
     * Tie the tree made from a JSON file to the research the file names: it
     * receives the research's updates when no other tree does, else it is a
     * copy (still offered when sending changes back).
     */
    restoreImportResearch(treeId: TreeId): void {
        const research = this.pendingImportResearch;
        this.pendingImportResearch = null;
        if (!research) return;
        const holder = TreeManager.findTreeByResearchId(research.id);
        TreeManager.setResearchLink(treeId, {
            id: research.id,
            // Unknown since the research sent it (the file may hold edits made
            // elsewhere): counts as changed — it can be sent, an update asks.
            fingerprint: '',
            syncedAt: new Date().toISOString(),
            ...(research.head ? { head: research.head } : {}),
            ...(holder && holder.id !== treeId ? { copy: true } : {}),
        }, { agentless: this.researchAgentlessFor(research.id) });
    },

    closeImportTreeDialog(): void {
        document.getElementById('import-tree-modal')?.classList.remove('active');
        this.importTreeData = null;
        this.pendingImportResearch = null;
        this.pendingGedcomImport = null;
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

        const gedcomImport = this.pendingGedcomImport;
        // The dialog's Import carries the writing (§1); Enter in the name has it too.
        const btn = activatedElement() ?? document.querySelector<HTMLElement>('#import-tree-modal .buttons .primary');
        const data = this.importTreeData;
        const newTreeId = await busyLocal(btn, strings.busy.importing, () => DataManager.importAsNewTree(data, name),
            () => ({ ok: false, kind: 'error', text: strings.busy.failed, retry: () => { void this.confirmImportTree(); } }));
        if (!newTreeId) return;
        this.restoreImportResearch(newTreeId);

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
        void this.afterImport(newTreeId, gedcomImport
            ? { gedcom: true, path: 'new', ...(gedcomImport.importId ? { importId: gedcomImport.importId } : {}) }
            : {});
    },

    /**
     * The two questions worth asking about a file somebody just imported, one
     * after the other so they do not pile up on top of each other.
     */
    async afterImport(treeId: TreeId, options: AfterImportOptions = {}): Promise<void> {
        this.lastImport = { treeId, ...options };
        // A file from another program (spec 066 §1): the "What next" card on
        // every path, once per import, instead of the two questions below.
        if (options.gedcom && this.offerImportNextCard(treeId, options)) return;
        // Merging asks its own question about new issues.
        if (options.path === 'merge') return;
        await this.offerPostImportValidation(treeId);
        await this.offerPostImportSplit(treeId);
        // A tree of a research: its places not on the map, once the research here takes them (spec 034 U5 point 7).
        if (TreeManager.getTreeMetadata(treeId)?.research) this.armPlacesOffer(treeId);
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
     * Load the bundled sample tree (src/demo-tree.ts, its pictures drawn now)
     * as a new tree, focus the emigrant Johan and show a hint toast.
     */
    async loadDemoTree(): Promise<void> {
        // Read-only viewers (and locked data) must not create trees
        if (DataManager.isReadOnly()) return;
        const el = activatedElement();
        this.closeMobileMenu();
        this.closeNewTreeMenu();
        // Leaving the open tree as a switch does (waiting buttons 2f): its changes sent (when they go by
        // themselves) first, Cancel meanwhile, no sample after 15 s; the following of its research ended
        // once the sample is open. A second click meanwhile makes no second sample.
        await runTreeSwitch(el, 'demo', {
            before: (o) => this.researchFollowBeforeSwitch(null, o),
            go: (from) => this.openDemoTree(from),
            retry: () => { void this.loadDemoTree(); },
        });
    },

    /** The sample tree made and opened (after the open tree's changes went). */
    async openDemoTree(from: FollowSwitchFrom): Promise<void> {
        const data = getDemoTree(demoImageMaker());
        const focusId = DEMO_FOCUS;
        // The Register card shows what the sample holds (each event with its date and
        // place) — unless the user already chose a card type; the Custom fields stay as they are.
        if (!SettingsManager.hasCardDensity()) SettingsManager.setCardDensity('register');

        const newTreeId = await DataManager.importAsNewTree(data, strings.demo.treeName);
        // The sample is never sent to a research nor tied to one.
        TreeManager.markDemoTree(newTreeId);
        this.researchFollowLeft(from.open);

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
            return await this.downloadAllTreesJson(password, includeAuditLog, this.readExportPrivacyMode(), this.readExportContentOptions());
        }, !quick, quick
            ? { quick: { hint: strings.fileCopy.quickHintAll(TreeManager.getTrees().length) } }
            : { format: 'all', allTrees: true });
    },

    /** Every tree into one JSON file (the "Export all" backup). Returns the file name. */
    async downloadAllTreesJson(password: string | null, includeAuditLog: boolean, privacyMode: PrivacyMode, content: ContentOptions): Promise<string> {
        const { applyLivingPrivacy, applyContentOptions } = await import('../privacy.js');
        const trees = TreeManager.getTrees();
        const allData: Record<string, BackupTreeEntry> = {};

        for (const tree of trees) {
            const data = await storedTreeForExport(tree.id);
            if (data) {
                let treeExport = applyLivingPrivacy(data, privacyMode);
                treeExport = applyContentOptions(treeExport, content);
                const entry: BackupTreeEntry = {
                    name: tree.name,
                    data: treeExport
                };
                if (includeAuditLog) {
                    const log = await AuditLogManager.exportForTree(tree.id);
                    if (log) entry.auditLog = log;
                }
                // The backup carries the tree's view links (a device setting), no copy of the tree does.
                const viewLinks = viewLinksPayload(tree.id);
                if (viewLinks) entry.viewLinks = viewLinks;
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
        if (privacyMode === 'full') {
            TreeManager.noteFileCopy(Object.keys(allData) as TreeId[],
                Object.fromEntries(Object.entries(allData).map(([id, t]) => [id, t.data])));
            // A full backup of every tree: the "Export all" reminder rests (Backups, ⋯ → Research).
            noteExportAll();
        }
        return fileName;
    },
});
