/**
 * UI - User interface logic and modals
 * Handles context menus, relation dialogs, and form interactions
 */

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
    LastFocusedMarker
} from '../types.js';
import { strings } from '../strings.js';
import { parseGedcom, convertToStrom, GedcomConversionResult } from '../ged-parser.js';
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

// Extracted method modules (composed onto UIClass at the bottom of this file).
import { contextMenuMethods } from './context-menu.js';
import { bottomSheetMethods } from './bottom-sheet.js';

import { personModalMethods } from './person-modal.js';
import { personEventsMethods } from './person-events.js';
import { sourcesMethods } from './sources.js';
import { attachmentsMethods } from './attachments-ui.js';
import { duplicateSuggestMethods } from './duplicate-suggest.js';
import { relationModalMethods } from './relation-modal.js';
import { dialogsMethods } from './dialogs.js';
import { relationshipsPanelMethods } from './relationships-panel.js';
import { searchMethods } from './search.js';
import { importExportMethods } from './import-export.js';
import { mergeUiMethods } from './merge-ui.js';
import { encryptionUiMethods } from './encryption-ui.js';
import { treeStatsMethods } from './tree-stats.js';
import { treeManagementMethods } from './tree-management.js';
import { miscMethods } from './misc.js';
import { appModeMethods } from './app-mode.js';
import { kinshipUiMethods } from './kinship-ui.js';
import { archivesUiMethods } from './archives-ui.js';
import { exportImageMethods } from './export-image-ui.js';
import { bookUiMethods } from './book-ui.js';
import { snapshotsUiMethods } from './snapshots-ui.js';
import { minimapMethods, MinimapTransform, WorldBox } from './minimap.js';
import { anniversariesUiMethods } from './anniversaries-ui.js';
import { familyWizardMethods } from './family-wizard.js';
import { pwaUiMethods } from './pwa-ui.js';

export class UIClass {
    currentId: PersonId | null = null;
    relationContext: RelationContext | null = null;
    contextMenu: HTMLElement | null = null;
    contextMenuCloseHandler: ((e: Event) => void) | null = null;
    bottomSheet: HTMLElement | null = null;
    linkMode = false;
    gedcomResult: GedcomConversionResult | null = null;
    saveCurrentCallback: (() => void) | null = null;
    relationPicker: PersonPicker | null = null;
    toolbarSearchPicker: PersonPicker | null = null;

    // Tree management state
    renameTreeId: TreeId | null = null;
    duplicateTreeId: TreeId | null = null;
    mergeSourceTreeId: TreeId | null = null;
    mergeTargetTreeId: TreeId | null = null;
    importTreeData: StromData | null = null;
    exportTargetTreeId: TreeId | null = null;
    defaultPersonTreeId: TreeId | null = null;
    snapshotsTreeId: TreeId | null = null;
    defaultPersonPicker: PersonPicker | null = null;

    // Encryption state
    passwordPromptCallback: ((password: string) => void) | null = null;
    passwordPromptCallbackManagesDialog: boolean = false;  // If true, callback handles dialog close
    exportPasswordCallback: ((password: string | null) => void) | null = null;
    pendingEncryptedData: EncryptedData | null = null;
    pendingEncryptedImport: EncryptedData | null = null;

    // Dialog stack for ESC navigation (child -> parent)
    dialogStack: string[] = [];

    // Embedded mode state
    appMode: AppMode = 'pwa';
    lastExportTime: number = Date.now();
    lastChangeTime: number = 0;

    // Track if import is coming from tree manager
    importFromTreeManager: boolean = false;

    // Person modal: snapshot of original values for unsaved changes detection
    personModalSnapshot: {
        firstName: string; lastName: string; gender: string;
        birthDate: string; birthPlace: string; deathDate: string; deathPlace: string;
        notes: string;
    } | null = null;

    // Debounce timer for the live search filter/highlight.
    searchFilterTimer: ReturnType<typeof setTimeout> | null = null;

    // Life-events editor state: the event being edited, or null when adding.
    editingEventId: string | null = null;

    // Sources/citations state.
    editingSourceId: string | null = null;
    /** What a citation applies to (person, or a specific event on that person). */
    citationContext: { personId: PersonId; eventId?: string } | null = null;
    /** When the source editor was opened from the picker, cite the new source. */
    citeSourceAfterCreate = false;

    // Relationships panel state
    relationshipsPanelPersonId: PersonId | null = null;
    returnToEditPersonId: PersonId | null = null;  // Track if we should return to edit dialog
    // Pending changes for relationships (not saved until user clicks Save)
    pendingPartnershipChanges: Map<PartnershipId, {
        status?: PartnershipStatus;
        startDate?: string;
        startPlace?: string;
        endDate?: string;
        note?: string;
        isPrimary?: boolean;
    }> = new Map();

    // Custom dialog promise resolver
    dialogResolve: ((value: boolean) => void) | null = null;

    // Person merge (duplicate resolution) state
    personMergeKeepId: PersonId | null = null;
    personMergePicker: PersonPicker | null = null;
    personMergeOtherId: PersonId | null = null;
    personMergeFieldResolutions: Map<string, 'keep' | 'other'> = new Map();
    personMergePartnershipResolutions: Map<PartnershipId, 'merge' | 'keep_both'> = new Map();

    // Import-as-new-tree flag
    importToCurrentTree: boolean = false;

    // Relationship calculator picker
    kinshipPicker: PersonPicker | null = null;

    // Family wizard: the anchor person the new family is added around.
    wizardAnchorId: PersonId | null = null;

    // Minimap state (world→minimap transform, current world box, drag + throttle)
    minimapTransform: MinimapTransform | null = null;
    minimapBox: WorldBox | null = null;
    minimapDragging = false;
    minimapViewportTimer: ReturnType<typeof setTimeout> | null = null;
}

// ---- Module composition ----
// Each extracted module contributes its method types to the UIClass interface
// (declaration merging, one `extends` per module) and its implementations to
// the prototype. The runtime object stays a single UIClass instance, so `this`
// binding is unchanged.
type ContextMenuMethods = typeof contextMenuMethods;
export interface UIClass extends ContextMenuMethods {}
Object.assign(UIClass.prototype, contextMenuMethods);

type BottomSheetMethods = typeof bottomSheetMethods;
export interface UIClass extends BottomSheetMethods {}
Object.assign(UIClass.prototype, bottomSheetMethods);

type PersonModalMethods = typeof personModalMethods;
export interface UIClass extends PersonModalMethods {}
Object.assign(UIClass.prototype, personModalMethods);

type PersonEventsMethods = typeof personEventsMethods;
export interface UIClass extends PersonEventsMethods {}
Object.assign(UIClass.prototype, personEventsMethods);

type SourcesMethods = typeof sourcesMethods;
export interface UIClass extends SourcesMethods {}
Object.assign(UIClass.prototype, sourcesMethods);

type AttachmentsMethods = typeof attachmentsMethods;
export interface UIClass extends AttachmentsMethods {}
Object.assign(UIClass.prototype, attachmentsMethods);

type DuplicateSuggestMethods = typeof duplicateSuggestMethods;
export interface UIClass extends DuplicateSuggestMethods {}
Object.assign(UIClass.prototype, duplicateSuggestMethods);

type RelationModalMethods = typeof relationModalMethods;
export interface UIClass extends RelationModalMethods {}
Object.assign(UIClass.prototype, relationModalMethods);

type DialogsMethods = typeof dialogsMethods;
export interface UIClass extends DialogsMethods {}
Object.assign(UIClass.prototype, dialogsMethods);

type RelationshipsPanelMethods = typeof relationshipsPanelMethods;
export interface UIClass extends RelationshipsPanelMethods {}
Object.assign(UIClass.prototype, relationshipsPanelMethods);

type SearchMethods = typeof searchMethods;
export interface UIClass extends SearchMethods {}
Object.assign(UIClass.prototype, searchMethods);

type ImportExportMethods = typeof importExportMethods;
export interface UIClass extends ImportExportMethods {}
Object.assign(UIClass.prototype, importExportMethods);

type MergeUiMethods = typeof mergeUiMethods;
export interface UIClass extends MergeUiMethods {}
Object.assign(UIClass.prototype, mergeUiMethods);

type EncryptionUiMethods = typeof encryptionUiMethods;
export interface UIClass extends EncryptionUiMethods {}
Object.assign(UIClass.prototype, encryptionUiMethods);

type TreeStatsMethods = typeof treeStatsMethods;
export interface UIClass extends TreeStatsMethods {}
Object.assign(UIClass.prototype, treeStatsMethods);

type TreeManagementMethods = typeof treeManagementMethods;
export interface UIClass extends TreeManagementMethods {}
Object.assign(UIClass.prototype, treeManagementMethods);

type MiscMethods = typeof miscMethods;
export interface UIClass extends MiscMethods {}
Object.assign(UIClass.prototype, miscMethods);

type AppModeMethods = typeof appModeMethods;
export interface UIClass extends AppModeMethods {}
Object.assign(UIClass.prototype, appModeMethods);

type KinshipUiMethods = typeof kinshipUiMethods;
export interface UIClass extends KinshipUiMethods {}
Object.assign(UIClass.prototype, kinshipUiMethods);

type ArchivesUiMethods = typeof archivesUiMethods;
export interface UIClass extends ArchivesUiMethods {}
Object.assign(UIClass.prototype, archivesUiMethods);

type ExportImageMethods = typeof exportImageMethods;
export interface UIClass extends ExportImageMethods {}
Object.assign(UIClass.prototype, exportImageMethods);

type BookUiMethods = typeof bookUiMethods;
export interface UIClass extends BookUiMethods {}
Object.assign(UIClass.prototype, bookUiMethods);

type SnapshotsUiMethods = typeof snapshotsUiMethods;
export interface UIClass extends SnapshotsUiMethods {}
Object.assign(UIClass.prototype, snapshotsUiMethods);

type MinimapMethods = typeof minimapMethods;
export interface UIClass extends MinimapMethods {}
Object.assign(UIClass.prototype, minimapMethods);

type AnniversariesUiMethods = typeof anniversariesUiMethods;
export interface UIClass extends AnniversariesUiMethods {}
Object.assign(UIClass.prototype, anniversariesUiMethods);

type FamilyWizardMethods = typeof familyWizardMethods;
export interface UIClass extends FamilyWizardMethods {}
Object.assign(UIClass.prototype, familyWizardMethods);

type PwaUiMethods = typeof pwaUiMethods;
export interface UIClass extends PwaUiMethods {}
Object.assign(UIClass.prototype, pwaUiMethods);

export const UI = new UIClass();
