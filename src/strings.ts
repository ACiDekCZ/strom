/**
 * UI Strings - Multi-language support
 */

export type Language = 'en' | 'cs';

export const SUPPORTED_LANGUAGES: { code: Language; name: string }[] = [
    { code: 'en', name: 'English' },
    { code: 'cs', name: 'Čeština' }
];

// Type definition for strings structure
type StringsType = typeof stringsEN;

const stringsEN = {
    // Toolbar
    toolbar: {
        title: 'Strom',
        addPerson: '+ Add Person',
        export: 'Export ▾',
        import: 'Import ▾',
        newTree: 'New Tree'
    },

    // Menu dialogs
    menu: {
        export: 'Export',
        import: 'Import',
        exportJson: 'Export JSON',
        exportJsonDesc: 'Download data as JSON file',
        exportFocus: 'Export Focus',
        exportFocusDesc: 'Download focused subset',
        exportApp: 'Export App',
        exportAppDesc: 'Download standalone HTML',
        importJson: 'Import JSON',
        importJsonDesc: 'Load data from JSON file',
        importGedcom: 'Import GEDCOM',
        importGedcomDesc: 'Load family tree from GEDCOM file',
        exportGedcom: 'Export GEDCOM',
        exportGedcomDesc: 'Download as GEDCOM file',
        newTree: 'New Tree',
        newTreeDesc: 'Start a new empty family tree'
    },

    // Export Focus dialog
    exportFocus: {
        jsonDesc: 'Focused family as JSON file',
        appDesc: 'Standalone HTML with focused family'
    },

    // Mobile menu
    mobileMenu: {
        addPerson: '+ Add Person',
        export: 'Export',
        import: 'Import',
        newTree: 'New Tree'
    },

    // Empty state
    emptyState: {
        title: 'Welcome to Strom',
        subtitle: 'Start building your family tree',
        addFirst: 'Add First Person',
        importFromFile: 'Import from File'
    },

    // Zoom controls
    zoomControls: {
        zoomIn: 'Zoom In',
        zoomOut: 'Zoom Out',
        reset: 'Reset View',
        fitToScreen: 'Fit to Screen'
    },

    // Labels
    labels: {
        firstName: 'First Name',
        lastName: 'Last Name',
        gender: 'Gender',
        selectPerson: 'Select Person',
        birthDate: 'Birth Date',
        birthPlace: 'Birth Place',
        deathDate: 'Death Date',
        deathPlace: 'Death Place',
        maidenName: 'Maiden Name',
        // Partnership dates - used based on status
        startDateMarried: 'Wedding Date',
        startDatePartners: 'Relationship Start',
        startPlace: 'Place',
        endDateMarried: 'Divorce Date',
        endDatePartners: 'Relationship End',
        note: 'Note',
        moreInfo: 'More Info',
        partner: 'Partner',
        isPrimary: 'Primary relationship'
    },

    // Placeholders
    placeholders: {
        firstName: 'First name',
        lastName: 'Last name',
        maidenName: 'Maiden name'
    },

    // Context menu
    contextMenu: {
        edit: 'Edit',
        focus: 'Focus',
        addParent: 'Add Parent',
        addPartner: 'Add Partner',
        addChild: 'Add Child',
        addSibling: 'Add Sibling',
        delete: 'Delete'
    },

    // Person modal
    personModal: {
        addTitle: 'Add Person',
        editTitle: 'Edit Person',
        completeTitle: 'Complete Person',
        enterName: 'Please enter first name or last name',
        unsavedMessage: 'You have unsaved changes in person details.',
    },

    // Relation modal
    relationModal: {
        addParent: 'Add Parent',
        addPartner: 'Add Partner',
        addChild: 'Add Child',
        addSibling: 'Add Sibling',
        linkExisting: 'Link Existing Person',
        linkExistingTitle: 'Link existing person',
        linkAsParent: 'Link as Parent',
        linkAsPartner: 'Link as Partner',
        linkAsChild: 'Link as Child',
        linkAsSibling: 'Link as Sibling',
        createNewTitle: 'Create new person',
        selectPerson: '-- Select --',
        enterName: 'Please enter first name or last name',
        selectPersonError: 'Please select a person',
        linkButton: 'Link'
    },

    // Child confirmation
    childConfirm: {
        title: 'Add Child',
        message: (name: string, partnerName: string) =>
            `<strong>${name}</strong> has a partner (<strong>${partnerName}</strong>).`,
        addToBoth: 'Add child to both parents',
        addToOne: (name: string) => `Add child only to ${name}`
    },

    // Delete confirmation
    deleteConfirm: {
        message: (name: string, birthYear?: string) =>
            birthYear ? `Delete "${name}" (*${birthYear})?` : `Delete "${name}"?`
    },

    // Confirmation modal
    confirmation: {
        title: 'Confirm'
    },

    // Relationships panel
    relationships: {
        title: (name: string) => `Relationships: ${name}`,
        parents: 'Parents',
        partners: 'Partners',
        children: 'Children',
        siblings: 'Siblings',
        addParent: '+ Add Parent',
        addPartner: '+ Add Partner',
        addChild: '+ Add Child',
        addSibling: '+ Add Sibling',
        remove: 'Remove',
        noRelationships: 'No relationships yet',
        unsavedTitle: 'Unsaved Changes',
        unsavedMessage: 'You have unsaved changes in relationship settings.',
        unsavedSave: 'Save & Close',
        unsavedDiscard: 'Discard Changes',
        unsavedStay: 'Stay',
        orphanConfirm: (name: string) => `"${name}" has no remaining relationships. Delete this person?`,
        orphanDelete: 'Delete',
        orphanKeep: 'Keep'
    },

    // Buttons
    buttons: {
        save: 'Save',
        cancel: 'Cancel',
        close: 'Close',
        add: 'Add',
        continue: 'Continue',
        delete: 'Delete',
        manageRelationships: 'Manage Relationships',
        ok: 'OK',
        yes: 'Yes',
        no: 'No',
        importComplete: 'Import complete',
        exportComplete: 'Export complete'
    },

    // Custom dialogs
    dialog: {
        info: 'Information',
        warning: 'Warning',
        error: 'Error',
        confirm: 'Confirm'
    },

    // Gender
    gender: {
        male: 'Male',
        female: 'Female'
    },

    // Partnership status
    partnershipStatus: {
        married: 'Married',
        partners: 'Partners',
        divorced: 'Divorced',
        separated: 'Separated'
    },

    // Export
    export: {
        failed: 'Export failed. Please try again.',
        devModeNotSupported: 'Export App is only available from the built version (strom.html). Run "npm run build" first.'
    },

    // Focus mode
    focus: {
        focusedOn: 'Focused on',
        showAll: 'Show All',
        generationsUp: 'Generations up',
        generationsDown: 'Generations down',
        exportFocus: 'Export Focus',
        hiddenPartners: (count: number) => `+${count} partner${count > 1 ? 's' : ''} (click to focus)`,
        hiddenFamilies: (count: number) => `${count} other famil${count > 1 ? 'ies' : 'y'} with children (click to focus)`,
        personCount: (visible: number, total: number) => `${visible} of ${total} persons`
    },

    // Branch tabs (family context navigation)
    branchTabs: {
        viewParents: 'View as child (show parents)',
        viewSiblings: 'Show siblings',
        viewFamily: 'View as parent (show own family)'
    },

    // Search
    search: {
        placeholder: 'Search person...',
        noResults: 'No results',
        multipleResults: 'Multiple results found',
        selectPerson: 'Select person'
    },

    // Person picker
    personPicker: {
        placeholder: 'Search person...',
        noResults: 'No matching persons'
    },

    // Errors
    errors: {
        parseStoredData: 'Failed to parse stored data',
        invalidJson: 'Invalid JSON file'
    },

    // Partner selection dialog
    partnerSelection: {
        title: 'Select Partner',
        description: (name: string) => `Show relationship branch for ${name}:`
    },

    // About dialog
    about: {
        title: 'About Strom',
        version: 'Version',
        description: 'Family tree in browser or single HTML. Data stays with you.',
        createdBy: 'Created by',
        license: 'License',
        licenseType: 'MPL-2.0 / Commercial',
        author: 'Author',
        authorName: 'Milan Víšek',
        website: 'Website',
        websiteUrl: 'https://stromapp.info',
        close: 'Close',
        currentData: 'Current Data',
        stats: {
            treeName: 'Tree',
            trees: 'trees',
            persons: 'Persons',
            families: 'Families',
            men: 'Men',
            women: 'Women',
            generations: 'Generations',
            oldest: 'Oldest'
        }
    },

    // GEDCOM import
    gedcom: {
        resultTitle: 'GEDCOM Conversion',
        persons: 'Persons',
        partnerships: 'Partnerships',
        skipped: 'Skipped (empty)',
        saveAsJson: 'Save as JSON',
        saveAsJsonDesc: 'Download converted data as JSON file',
        importAsNew: 'Import as New Tree',
        importAsNewDesc: 'Replace current tree with imported data',
        mergeExisting: 'Merge with Existing',
        mergeExistingDesc: 'Smart merge into current tree',
        insertToTree: 'Insert into Tree',
        insertToTreeDesc: 'Load converted data into current tree',
        parseError: 'Failed to parse GEDCOM file'
    },

    // Save current data dialog
    saveCurrent: {
        title: 'Save Current Data?',
        message: 'You have existing data. Would you like to save it before continuing?',
        exportJson: 'Export JSON',
        exportApp: 'Export App',
        continueWithout: 'Continue Without Saving'
    },

    // Validation messages
    validation: {
        parseError: 'Error reading file',
        invalidStructure: 'Invalid file structure',
        missingPersons: 'Missing persons data',
        missingPartnerships: 'Missing partnerships data',
        missingField: 'Missing required field',
        invalidReference: 'Invalid reference in data',
        missingGedcomHeader: 'Missing GEDCOM header',
        noIndividuals: 'No individuals found in file',
        fileTooShort: 'File is too short or empty',
        invalidLine: 'Invalid line format',
        unknownError: 'Unknown error',
        continueWithWarnings: 'Continue with warnings',
        validationFailed: 'Validation failed',
        warnings: 'Warnings',
        errors: 'Errors',
        noVersion: 'File has no version info (older format)',
        olderVersion: 'File is from older version',
        newerVersion: 'File is from newer version (may have compatibility issues)',
        // Version mismatch dialogs
        newerDataTitle: 'Newer Data Version Detected',
        newerDataInStorage: 'Your stored data was created with a newer version of the application.',
        newerDataInImport: 'This file was created with a newer version of the application.',
        newerDataWarning: 'Opening with this older version may cause data loss or errors.',
        newerDataSolution: 'Recommended: Export your data as JSON and import it in the newer version.',
        exportAndExit: 'Export JSON & Close',
        getNewerVersion: 'Please use a newer version of the application to open this file.',
        yourVersion: 'Your app version',
        dataVersion: 'Data version',
        viewOnlyAllowed: 'You can view this data, but importing is disabled to prevent data loss.',
        viewOnly: 'View only (read-only)',
        importBlocked: 'Import blocked',
        importBlockedNewer: 'Cannot import: This file requires a newer version of the application.',
        jsonNewerVersion: 'This JSON file was created with a newer version (v%d). Your app supports version %d.'
    },

    // Merge import
    merge: {
        title: 'Merge Data',
        analyzing: 'Analyzing persons...',
        matches: 'Matches',
        conflicts: 'Conflicts',
        newPersons: 'New Persons',
        tabAll: 'All',
        highConfidence: 'High',
        mediumConfidence: 'Medium',
        lowConfidence: 'Low',
        unmatched: 'Unmatched',
        confirm: 'Confirm',
        reject: 'Reject',
        changeMatch: 'Change',
        manualMatch: 'Match to existing',
        reanalyze: 'Re-analyze',
        execute: 'Execute Merge',
        keepExisting: 'Keep existing',
        useImport: 'Use from import',
        complete: 'Merge complete',
        failed: 'Merge failed',
        switchToNewTree: 'Switch to the new tree?',
        stats: (merged: number, added: number) =>
            `${merged} persons merged, ${added} new persons added`,
        noItems: 'No items to display',
        newPerson: 'New',
        selectExisting: '-- Select existing person --',
        selectExistingError: 'Please select a person',
        importCount: 'Import',
        existingCount: 'Existing',
        statsMatches: 'Matches',
        statsConflicts: 'Conflicts',
        statsNew: 'New',
        mergeInto: 'Merge into existing tree',

        // Workflow
        wizardTitle: 'Merge Data',
        wizardExplanation: 'Review how imported persons match with existing data. Green = confirmed match, Yellow = needs review, Blue = new person.',
        stepReview: 'Review matches',
        stepResolve: 'Resolve conflicts',
        stepExecute: 'Execute merge',

        // Close confirmation
        closeConfirmTitle: 'Close Merge?',
        closeConfirmMessage: 'You have unsaved merge progress.',
        closeDiscard: 'Discard changes',
        closeSave: 'Save for later',
        closeCancel: 'Continue merging',

        // Pending merges
        pendingMerges: 'Pending Merges',
        pendingMergeFound: 'You have a pending merge session',
        resume: 'Resume',
        discard: 'Discard',
        savedAt: 'Saved',
        progress: 'Progress',
        reviewedCount: (reviewed: number, total: number) =>
            `${reviewed}/${total} reviewed`,

        // Tooltips
        highConfidenceTooltip: 'Strong match: names, dates, and relationships align',
        mediumConfidenceTooltip: 'Likely match: partial data match or family connection - please verify',
        lowConfidenceTooltip: 'Possible match: limited data agreement - careful review needed',
        newPersonTooltip: 'Will be added as new person',

        // Match reasons (shown in UI)
        matchReasons: {
            exact_name_gender_birthdate: 'Exact name and birth date',
            name_gender_birthyear: 'Name and birth year',
            name_gender_parents: 'Name and matching parents',
            name_similarity_relationships: 'Similar name with family context',
            first_name_match: 'First name match (different surname)',
            first_name_birthyear: 'First name and birth year',
            lastname_birthyear: 'Last name and birth year',
            partner_of_matched: 'Partner of matched person',
            child_of_matched: 'Child of matched person',
            parent_of_matched: 'Parent of matched person',
            partner_similarity: 'Similar partner names',
            manual: 'Manual match'
        },

        // Resolve conflicts button
        resolveConflicts: 'Resolve',

        // New tree name prompt
        newTreeNamePrompt: 'Enter name for the merged tree:',

        // Tree preview labels
        existingTree: 'Existing Tree',
        incomingTree: 'Incoming Data',

        // Pending merge in tree manager
        pendingMergeLabel: 'Pending merge',
        pendingMergeInto: (source: string, target: string) => `${source} → ${target}`,
        pendingMergeFrom: (source: string) => `from ${source}`,
        pendingMergeConflicts: (count: number) => `${count} conflicts`
    },

    // Person merge (duplicate resolution)
    personMerge: {
        title: 'Merge Persons',
        keepPerson: 'Keep',
        mergeWith: 'Merge with',
        selectPerson: 'Select person to merge with...',
        fieldConflicts: 'Field conflicts',
        partnershipConflicts: 'Partnership conflicts',
        keepValue: 'Keep',
        useOther: 'Use from other',
        mergePartnership: 'Merge partnerships',
        keepBoth: 'Keep both partnerships',
        noConflicts: 'No conflicts - data will be combined',
        confirmMerge: 'Merge persons',
        mergeComplete: 'Persons merged successfully',
        samePersonError: 'Cannot merge person with itself',
        willBeDeleted: 'will be deleted',
        relationshipsTransferred: 'Relationships will be transferred'
    },

    // Settings
    settings: {
        title: 'Settings',
        theme: 'Theme',
        themeSystem: 'System (follows OS)',
        themeLight: 'Light',
        themeDark: 'Dark',
        language: 'Language',
        languageSystem: 'System (browser language)',
        close: 'Close'
    },

    // Tree Manager
    treeManager: {
        defaultTreeName: 'My Family Tree',
        newTree: 'New Tree',
        manageTreesTitle: 'Manage Trees',
        treeSwitcher: 'Tree',
        rename: 'Rename',
        duplicate: 'Duplicate',
        duplicateTitle: 'Duplicate Tree',
        newTreeNameLabel: 'New tree name',
        mergeInto: 'Merge into...',
        delete: 'Delete',
        export: 'Export',
        newTreePlaceholder: 'Tree name',
        confirmDelete: (name: string) => `Delete tree "${name}"? This cannot be undone.`,
        duplicateSuffix: '(copy)',
        storageUsage: 'Storage Usage',
        storageOf: 'of',
        migrationComplete: 'Data migrated to new format',
        selectTargetTree: 'Select target tree',
        mergeSourceTree: 'Merge tree',
        mergeIntoTree: 'into',
        startMerge: 'Start Merge',
        importTreeName: 'Imported Tree',
        importAsNewTree: 'Import as New Tree',
        treeNameLabel: 'Tree name',
        persons: 'persons',
        families: 'families',
        // Stats dialog
        stats: 'Statistics',
        statsTitle: 'Tree Statistics',
        statsPeople: 'People',
        statsTotal: 'Total',
        statsMales: 'Males',
        statsFemales: 'Females',
        statsLiving: 'Living',
        statsDeceased: 'Deceased',
        statsFamilies: 'Families',
        statsPartnerships: 'Partnerships',
        statsAvgChildren: 'Avg. children',
        statsMaxChildren: 'Max children',
        statsDates: 'Dates',
        statsOldestBirth: 'Oldest birth',
        statsNewestBirth: 'Newest birth',
        statsDateRange: 'Date range',
        statsGenerations: 'Generations',
        statsData: 'Data Completeness',
        statsWithBirthDate: 'With birth date',
        statsWithDeathDate: 'With death date',
        statsWithBirthPlace: 'With birth place',
        statsSize: 'Storage',
        statsTreeSize: 'Tree size',
        // Anniversaries
        statsAnniversaries: 'Upcoming Anniversaries',
        statsAnniversariesNone: 'No anniversaries in the next 30 days',
        statsToday: 'Today',
        statsThisWeek: 'This week',
        statsThisMonth: 'This month',
        statsBirthday: 'birthday',
        statsBirthAnniversary: 'would be',
        statsWeddingAnniversary: 'wedding anniversary',
        statsMemorial: 'memorial',
        statsYears: 'years',
        // Validation
        validate: 'Validate',
        validateDesc: 'Check tree for errors',
        validationTitle: 'Tree Validation',
        validationPassed: 'No issues found',
        validationErrors: 'errors',
        validationWarnings: 'warnings',
        validationInfos: 'info',
        validationIssuesFound: 'issues found',
        // Tree validation messages
        valCycle: 'Ancestor cycle detected',
        valSelfPartnership: 'Self-partnership',
        valDuplicatePartnership: 'Duplicate partnership',
        valMissingChildRef: 'Parent missing child reference',
        valMissingParentRef: 'Child missing parent reference',
        valMissingPartnershipRef: 'Person missing partnership reference',
        valPartnershipChildMismatch: 'Partnership child mismatch',
        valOrphanedRef: 'Reference to non-existent record',
        valTooManyParents: 'More than 2 parents',
        valParentYoungerThanChild: 'Parent younger than child',
        valParentTooYoung: 'Parent very young at birth',
        valParentTooOld: 'Parent very old at birth',
        valGenerationConflict: 'Person at multiple generations',
        valPartnerIsParent: 'Partner is also parent',
        valPartnerIsChild: 'Partner is also child',
        valSiblingIsParent: 'Sibling is also parent',
        valSiblingIsChild: 'Sibling is also child',
        // Default person dialog
        defaultPerson: 'Default Person',
        defaultPersonDesc: 'When opening this tree, focus on:',
        defaultPersonFirstPerson: 'First person',
        defaultPersonLastFocused: 'Last focused',
        defaultPersonSpecific: 'Specific person:',
        // Default tree dialog
        defaultTree: 'Default Tree',
        defaultTreeDesc: 'When opening app, load:',
        defaultTreeFirstTree: 'First tree',
        defaultTreeLastFocused: 'Last focused',
        defaultTreeSpecific: 'Specific tree:',
        // New Tree Menu
        newTreeMenu: 'New Tree',
        emptyTree: 'Empty Tree',
        emptyTreeDesc: 'Start with a blank family tree',
        fromJson: 'From JSON',
        fromJsonDesc: 'Import from JSON file',
        fromGedcom: 'From GEDCOM',
        fromGedcomDesc: 'Import from GEDCOM file',
        fromHtml: 'From HTML File',
        fromHtmlDesc: 'Import from exported Strom HTML file',
        htmlNoData: 'No embedded data found in HTML file',
        fromFocus: 'From Current View',
        fromFocusDesc: 'Copy visible persons into a new separate tree',
        noFocusedData: 'No focused data to create tree from',
        // Export All
        exportAll: 'Export All Trees',
        exportAllJson: 'Export as JSON',
        exportAllJsonDesc: 'All trees in one JSON file',
        exportAllApp: 'Export as App',
        exportAllAppDesc: 'Standalone HTML with all trees'
    },

    // View Mode (embedded data)
    viewMode: {
        banner: 'View mode (read-only)',
        bannerDetail: 'To edit, import data to storage first.',
        importButton: 'Import to storage',
        existingTitle: 'Tree Already Exists',
        existingMessage: 'A tree from this export is already in your storage.',
        viewStored: 'View stored version',
        viewEmbedded: 'View embedded version',
        updateStored: 'Update storage',
        importTitle: 'Import Tree',
        importMessage: 'Import this tree to your local storage to enable editing?',
        createNew: 'Import to storage',
        createCopy: 'Create copy',
        importSuccess: 'Tree imported successfully',
        importAllSuccess: (count: number) => `${count} tree${count !== 1 ? 's' : ''} imported successfully`,
        updateSuccess: 'Storage updated successfully'
    },

    // Encryption
    encryption: {
        enable: 'Encrypt data',
        warning: 'If you forget the password, your data cannot be recovered.',
        setPassword: 'Set Password',
        confirmPassword: 'Confirm Password',
        enterPassword: 'Enter Password',
        wrongPassword: 'Incorrect password',
        exportPassword: 'Export encryption',
        exportPasswordHint: 'Set a password to encrypt the file, or export without encryption.',
        exportWithPassword: 'Export encrypted',
        exportWithoutPassword: 'Export without encryption',
        passwordMismatch: 'Passwords do not match',
        minLength: 'Password must be at least 6 characters',
        encryptionEnabled: 'Encryption enabled',
        encryptionDisabled: 'Encryption disabled',
        unlockData: 'Unlock Data',
        decryptionFailed: 'Failed to decrypt data',
        changePassword: 'Change Password',
        currentPassword: 'Current Password',
        newPassword: 'New Password',
        passwordChanged: 'Password changed successfully',
        optional: '(optional)',
        dataEncrypted: 'Data is encrypted',
        enterPasswordToView: 'Enter password to view'
    },

    // Tree Preview
    treePreview: {
        title: 'Tree Preview',
        close: 'Close',
        focusedOn: 'Focused on',
        clickToFocus: 'Click a person to focus on them',
        compare: 'Compare Trees',
        preview: 'Preview',
        comparePersons: 'Compare'
    },

    // Embedded Mode (local HTML file)
    embeddedMode: {
        banner: 'Standalone file version',
        bannerDetail: 'Data is stored separately from the online version.',
        goOnline: 'Online version',
        exportJson: 'Export JSON',
        exportJsonDesc: 'For import into online version',
        saveFile: 'Save File',
        saveFileTitle: 'Download file with current data',
        unsavedWarning: 'You have unsaved changes. Use "Save File" to keep them.',
        infoTitle: 'About Standalone Version',
        infoText1: 'This is a standalone HTML file that works without internet. Your changes are saved to this browser\'s local storage.',
        infoText2: 'Important: The online version (stromapp.info) and this file version each use their own separate storage. Data is not synchronized between them.',
        infoHow: 'To switch to online version:',
        infoOption1: 'Go to stromapp.info and import this HTML file directly (Tree Manager → New Tree → From HTML)',
        infoOption2: 'Or click "Export JSON" above, then import the JSON file at stromapp.info'
    }
};

const stringsCZ: StringsType = {
    // Toolbar
    toolbar: {
        title: 'Strom',
        addPerson: '+ Přidat osobu',
        export: 'Export ▾',
        import: 'Import ▾',
        newTree: 'Nový strom'
    },

    // Menu dialogs
    menu: {
        export: 'Export',
        import: 'Import',
        exportJson: 'Export JSON',
        exportJsonDesc: 'Stáhnout data jako JSON soubor',
        exportFocus: 'Export výběru',
        exportFocusDesc: 'Stáhnout zobrazený výběr',
        exportApp: 'Export aplikace',
        exportAppDesc: 'Stáhnout jako samostatný HTML soubor',
        importJson: 'Import JSON',
        importJsonDesc: 'Načíst data z JSON souboru',
        importGedcom: 'Import GEDCOM',
        importGedcomDesc: 'Načíst rodokmen z GEDCOM souboru',
        exportGedcom: 'Export GEDCOM',
        exportGedcomDesc: 'Stáhnout jako GEDCOM soubor',
        newTree: 'Nový strom',
        newTreeDesc: 'Začít nový prázdný rodokmen'
    },

    // Export Focus dialog
    exportFocus: {
        jsonDesc: 'Zobrazená rodina jako JSON',
        appDesc: 'Samostatný HTML se zobraznou rodinou'
    },

    // Mobile menu
    mobileMenu: {
        addPerson: '+ Přidat osobu',
        export: 'Export',
        import: 'Import',
        newTree: 'Nový strom'
    },

    // Empty state
    emptyState: {
        title: 'Vítejte ve Stromu',
        subtitle: 'Začněte tvořit svůj rodokmen',
        addFirst: 'Přidat první osobu',
        importFromFile: 'Importovat ze souboru'
    },

    // Zoom controls
    zoomControls: {
        zoomIn: 'Přiblížit',
        zoomOut: 'Oddálit',
        reset: 'Obnovit pohled',
        fitToScreen: 'Zobrazit vše'
    },

    // Labels
    labels: {
        firstName: 'Jméno',
        lastName: 'Příjmení',
        gender: 'Pohlaví',
        selectPerson: 'Vybrat osobu',
        birthDate: 'Datum narození',
        birthPlace: 'Místo narození',
        deathDate: 'Datum úmrtí',
        deathPlace: 'Místo úmrtí',
        maidenName: 'Rodné příjmení',
        // Partnership dates - used based on status
        startDateMarried: 'Datum sňatku',
        startDatePartners: 'Začátek vztahu',
        startPlace: 'Místo',
        endDateMarried: 'Datum rozvodu',
        endDatePartners: 'Konec vztahu',
        note: 'Poznámka',
        moreInfo: 'Více informací',
        partner: 'Partner',
        isPrimary: 'Hlavní vztah'
    },

    // Placeholders
    placeholders: {
        firstName: 'Jméno',
        lastName: 'Příjmení',
        maidenName: 'Rodné příjmení'
    },

    // Context menu
    contextMenu: {
        edit: 'Upravit',
        focus: 'Zaměřit',
        addParent: 'Přidat rodiče',
        addPartner: 'Přidat partnera',
        addChild: 'Přidat dítě',
        addSibling: 'Přidat sourozence',
        delete: 'Smazat'
    },

    // Person modal
    personModal: {
        addTitle: 'Přidat osobu',
        editTitle: 'Upravit osobu',
        completeTitle: 'Doplnit osobu',
        enterName: 'Zadejte prosím jméno nebo příjmení',
        unsavedMessage: 'Máte neuložené změny v údajích osoby.',
    },

    // Relation modal
    relationModal: {
        addParent: 'Přidat rodiče',
        addPartner: 'Přidat partnera',
        addChild: 'Přidat dítě',
        addSibling: 'Přidat sourozence',
        linkExisting: 'Propojit existující osobu',
        linkExistingTitle: 'Propojit existující osobu',
        linkAsParent: 'Propojit jako rodiče',
        linkAsPartner: 'Propojit jako partnera',
        linkAsChild: 'Propojit jako dítě',
        linkAsSibling: 'Propojit jako sourozence',
        createNewTitle: 'Vytvořit novou osobu',
        selectPerson: '-- Vyberte --',
        enterName: 'Zadejte prosím jméno nebo příjmení',
        selectPersonError: 'Vyberte prosím osobu',
        linkButton: 'Propojit'
    },

    // Child confirmation
    childConfirm: {
        title: 'Přidat dítě',
        message: (name: string, partnerName: string) =>
            `<strong>${name}</strong> má partnera (<strong>${partnerName}</strong>).`,
        addToBoth: 'Přidat dítě oběma rodičům',
        addToOne: (name: string) => `Přidat dítě pouze k ${name}`
    },

    // Delete confirmation
    deleteConfirm: {
        message: (name: string, birthYear?: string) =>
            birthYear ? `Smazat "${name}" (*${birthYear})?` : `Smazat "${name}"?`
    },

    // Confirmation modal
    confirmation: {
        title: 'Potvrdit'
    },

    // Relationships panel
    relationships: {
        title: (name: string) => `Vztahy: ${name}`,
        parents: 'Rodiče',
        partners: 'Partneři',
        children: 'Děti',
        siblings: 'Sourozenci',
        addParent: '+ Přidat rodiče',
        addPartner: '+ Přidat partnera',
        addChild: '+ Přidat dítě',
        addSibling: '+ Přidat sourozence',
        remove: 'Odebrat',
        noRelationships: 'Zatím žádné vztahy',
        unsavedTitle: 'Neuložené změny',
        unsavedMessage: 'Máte neuložené změny v nastavení vztahů.',
        unsavedSave: 'Uložit a zavřít',
        unsavedDiscard: 'Zahodit změny',
        unsavedStay: 'Zůstat',
        orphanConfirm: (name: string) => `"${name}" nemá žádné zbývající vztahy. Smazat tuto osobu?`,
        orphanDelete: 'Smazat',
        orphanKeep: 'Ponechat'
    },

    // Buttons
    buttons: {
        save: 'Uložit',
        cancel: 'Zrušit',
        close: 'Zavřít',
        add: 'Přidat',
        continue: 'Pokračovat',
        delete: 'Smazat',
        manageRelationships: 'Spravovat vztahy',
        ok: 'OK',
        yes: 'Ano',
        no: 'Ne',
        importComplete: 'Import dokončen',
        exportComplete: 'Export dokončen'
    },

    // Custom dialogs
    dialog: {
        info: 'Informace',
        warning: 'Upozornění',
        error: 'Chyba',
        confirm: 'Potvrdit'
    },

    // Gender
    gender: {
        male: 'Muž',
        female: 'Žena'
    },

    // Partnership status
    partnershipStatus: {
        married: 'Manželství',
        partners: 'Partneři',
        divorced: 'Rozvedení',
        separated: 'Odloučení'
    },

    // Export
    export: {
        failed: 'Export selhal. Zkuste to prosím znovu.',
        devModeNotSupported: 'Export aplikace je dostupný pouze ze sestaveného souboru (strom.html). Spusťte nejprve "npm run build".'
    },

    // Focus mode
    focus: {
        focusedOn: 'Zaměřeno na',
        showAll: 'Zobrazit vše',
        generationsUp: 'Generací nahoru',
        generationsDown: 'Generací dolů',
        exportFocus: 'Exportovat výběr',
        hiddenPartners: (count: number) => `+${count} partner${count > 1 ? 'ů' : ''} (klikněte pro zaměření)`,
        hiddenFamilies: (count: number) => `${count} další rodin${count > 1 ? 'y' : 'a'} s dětmi (klikněte pro zaměření)`,
        personCount: (visible: number, total: number) => `${visible} z ${total} osob`
    },

    // Branch tabs (family context navigation)
    branchTabs: {
        viewParents: 'Zobrazit jako dítě (ukázat rodiče)',
        viewSiblings: 'Ukázat sourozence',
        viewFamily: 'Zobrazit jako rodiče (ukázat vlastní rodinu)'
    },

    // Search
    search: {
        placeholder: 'Hledat osobu...',
        noResults: 'Nic nenalezeno',
        multipleResults: 'Nalezeno více výsledků',
        selectPerson: 'Vyberte osobu'
    },

    // Person picker
    personPicker: {
        placeholder: 'Hledat osobu...',
        noResults: 'Žádné odpovídající osoby'
    },

    // Errors
    errors: {
        parseStoredData: 'Nepodařilo se načíst uložená data',
        invalidJson: 'Neplatný JSON soubor'
    },

    // Partner selection dialog
    partnerSelection: {
        title: 'Vybrat partnera',
        description: (name: string) => `Zobrazit větev vztahů pro ${name}:`
    },

    // About dialog
    about: {
        title: 'O aplikaci Strom',
        version: 'Verze',
        description: 'Rodokmen v prohlížeči nebo v jednom HTML. Data zůstávají u vás.',
        createdBy: 'Vytvořil',
        license: 'Licence',
        licenseType: 'MPL-2.0 / Komerční',
        author: 'Autor',
        authorName: 'Milan Víšek',
        website: 'Webové stránky',
        websiteUrl: 'https://stromapp.info',
        close: 'Zavřít',
        currentData: 'Aktuální data',
        stats: {
            treeName: 'Strom',
            trees: 'stromů',
            persons: 'Osob',
            families: 'Rodin',
            men: 'Mužů',
            women: 'Žen',
            generations: 'Generací',
            oldest: 'Nejstarší'
        }
    },

    // GEDCOM import
    gedcom: {
        resultTitle: 'Konverze GEDCOM',
        persons: 'Osob',
        partnerships: 'Vztahů',
        skipped: 'Přeskočeno (prázdné)',
        saveAsJson: 'Uložit jako JSON',
        saveAsJsonDesc: 'Stáhnout převedená data jako JSON soubor',
        importAsNew: 'Importovat jako nový strom',
        importAsNewDesc: 'Nahradit aktuální strom importovanými daty',
        mergeExisting: 'Sloučit s existujícím',
        mergeExistingDesc: 'Inteligentní sloučení do aktuálního stromu',
        insertToTree: 'Vložit do stromu',
        insertToTreeDesc: 'Načíst převedená data do aktuálního stromu',
        parseError: 'Nepodařilo se zpracovat GEDCOM soubor'
    },

    // Save current data dialog
    saveCurrent: {
        title: 'Uložit aktuální data?',
        message: 'Máte existující data. Chcete je uložit před pokračováním?',
        exportJson: 'Exportovat JSON',
        exportApp: 'Exportovat aplikaci',
        continueWithout: 'Pokračovat bez uložení'
    },

    // Validation messages
    validation: {
        parseError: 'Chyba při čtení souboru',
        invalidStructure: 'Neplatná struktura souboru',
        missingPersons: 'Chybí data osob',
        missingPartnerships: 'Chybí data vztahů',
        missingField: 'Chybí povinné pole',
        invalidReference: 'Neplatný odkaz v datech',
        missingGedcomHeader: 'Chybí GEDCOM hlavička',
        noIndividuals: 'V souboru nebyly nalezeny žádné osoby',
        fileTooShort: 'Soubor je příliš krátký nebo prázdný',
        invalidLine: 'Neplatný formát řádku',
        unknownError: 'Neznámá chyba',
        continueWithWarnings: 'Pokračovat s varováními',
        validationFailed: 'Validace selhala',
        warnings: 'Varování',
        errors: 'Chyby',
        noVersion: 'Soubor nemá informaci o verzi (starší formát)',
        olderVersion: 'Soubor je ze starší verze',
        newerVersion: 'Soubor je z novější verze (možné problémy s kompatibilitou)',
        // Version mismatch dialogs
        newerDataTitle: 'Detekována novější verze dat',
        newerDataInStorage: 'Vaše uložená data byla vytvořena novější verzí aplikace.',
        newerDataInImport: 'Tento soubor byl vytvořen novější verzí aplikace.',
        newerDataWarning: 'Otevření ve starší verzi může způsobit ztrátu dat nebo chyby.',
        newerDataSolution: 'Doporučení: Exportujte data jako JSON a importujte je v novější verzi.',
        exportAndExit: 'Exportovat JSON a zavřít',
        getNewerVersion: 'Pro otevření tohoto souboru použijte novější verzi aplikace.',
        yourVersion: 'Vaše verze aplikace',
        dataVersion: 'Verze dat',
        viewOnlyAllowed: 'Data můžete prohlížet, ale import je zakázán kvůli prevenci ztráty dat.',
        viewOnly: 'Pouze prohlížet (jen pro čtení)',
        importBlocked: 'Import zablokován',
        importBlockedNewer: 'Nelze importovat: Tento soubor vyžaduje novější verzi aplikace.',
        jsonNewerVersion: 'Tento JSON soubor byl vytvořen novější verzí (v%d). Vaše aplikace podporuje verzi %d.'
    },

    // Merge import
    merge: {
        title: 'Sloučit data',
        analyzing: 'Analyzuji osoby...',
        matches: 'Shody',
        conflicts: 'Konflikty',
        newPersons: 'Nové osoby',
        tabAll: 'Vše',
        highConfidence: 'Vysoká',
        mediumConfidence: 'Střední',
        lowConfidence: 'Nízká',
        unmatched: 'Bez shody',
        confirm: 'Potvrdit',
        reject: 'Odmítnout',
        changeMatch: 'Změnit',
        manualMatch: 'Přiřadit k existující',
        reanalyze: 'Znovu analyzovat',
        execute: 'Provést sloučení',
        keepExisting: 'Ponechat stávající',
        useImport: 'Použít z importu',
        complete: 'Sloučení dokončeno',
        failed: 'Sloučení selhalo',
        switchToNewTree: 'Přepnout na nový strom?',
        stats: (merged: number, added: number) =>
            `${merged} osob sloučeno, ${added} nových osob přidáno`,
        noItems: 'Žádné položky k zobrazení',
        newPerson: 'Nová',
        selectExisting: '-- Vyberte existující osobu --',
        selectExistingError: 'Vyberte prosím osobu',
        importCount: 'Import',
        existingCount: 'Stávající',
        statsMatches: 'Shody',
        statsConflicts: 'Konflikty',
        statsNew: 'Nové',
        mergeInto: 'Sloučit do existujícího stromu',

        // Workflow
        wizardTitle: 'Sloučení dat',
        wizardExplanation: 'Zkontrolujte, jak importované osoby odpovídají existujícím datům. Zelená = potvrzená shoda, Žlutá = vyžaduje kontrolu, Modrá = nová osoba.',
        stepReview: 'Zkontrolovat shody',
        stepResolve: 'Vyřešit konflikty',
        stepExecute: 'Provést sloučení',

        // Close confirmation
        closeConfirmTitle: 'Zavřít sloučení?',
        closeConfirmMessage: 'Máte neuložený postup sloučení.',
        closeDiscard: 'Zahodit změny',
        closeSave: 'Uložit na později',
        closeCancel: 'Pokračovat ve slučování',

        // Pending merges
        pendingMerges: 'Nedokončená sloučení',
        pendingMergeFound: 'Máte nedokončené sloučení',
        resume: 'Pokračovat',
        discard: 'Zahodit',
        savedAt: 'Uloženo',
        progress: 'Postup',
        reviewedCount: (reviewed: number, total: number) =>
            `${reviewed}/${total} zkontrolováno`,

        // Tooltips
        highConfidenceTooltip: 'Silná shoda: jména, data a vztahy souhlasí',
        mediumConfidenceTooltip: 'Pravděpodobná shoda: částečná data nebo rodinná souvislost - ověřte',
        lowConfidenceTooltip: 'Možná shoda: omezená shoda dat - pečlivě zkontrolujte',
        newPersonTooltip: 'Bude přidána jako nová osoba',

        // Match reasons (shown in UI)
        matchReasons: {
            exact_name_gender_birthdate: 'Přesné jméno a datum narození',
            name_gender_birthyear: 'Jméno a rok narození',
            name_gender_parents: 'Jméno a shodní rodiče',
            name_similarity_relationships: 'Podobné jméno s rodinným kontextem',
            first_name_match: 'Shoda křestního jména (jiné příjmení)',
            first_name_birthyear: 'Křestní jméno a rok narození',
            lastname_birthyear: 'Příjmení a rok narození',
            partner_of_matched: 'Partner spárované osoby',
            child_of_matched: 'Dítě spárované osoby',
            parent_of_matched: 'Rodič spárované osoby',
            partner_similarity: 'Podobná jména partnerů',
            manual: 'Ruční přiřazení'
        },

        // Resolve conflicts button
        resolveConflicts: 'Vyřešit',

        // New tree name prompt
        newTreeNamePrompt: 'Zadejte název pro sloučený strom:',

        // Tree preview labels
        existingTree: 'Stávající strom',
        incomingTree: 'Příchozí data',

        // Pending merge in tree manager
        pendingMergeLabel: 'Rozpracované sloučení',
        pendingMergeInto: (source: string, target: string) => `${source} → ${target}`,
        pendingMergeFrom: (source: string) => `z ${source}`,
        pendingMergeConflicts: (count: number) => `${count} konfliktů`
    },

    // Person merge (duplicate resolution)
    personMerge: {
        title: 'Sloučit osoby',
        keepPerson: 'Ponechat',
        mergeWith: 'Sloučit s',
        selectPerson: 'Vyberte osobu ke sloučení...',
        fieldConflicts: 'Konflikty v údajích',
        partnershipConflicts: 'Konflikty v partnerstvích',
        keepValue: 'Ponechat',
        useOther: 'Použít z druhé',
        mergePartnership: 'Sloučit partnerství',
        keepBoth: 'Ponechat obě partnerství',
        noConflicts: 'Žádné konflikty - data budou spojena',
        confirmMerge: 'Sloučit osoby',
        mergeComplete: 'Osoby byly sloučeny',
        samePersonError: 'Nelze sloučit osobu samu se sebou',
        willBeDeleted: 'bude smazána',
        relationshipsTransferred: 'Vztahy budou přeneseny'
    },

    // Settings
    settings: {
        title: 'Nastavení',
        theme: 'Vzhled',
        themeSystem: 'Systémový (podle OS)',
        themeLight: 'Světlý',
        themeDark: 'Tmavý',
        language: 'Jazyk',
        languageSystem: 'Systémový (podle prohlížeče)',
        close: 'Zavřít'
    },

    // Tree Manager
    treeManager: {
        defaultTreeName: 'Můj rodokmen',
        newTree: 'Nový strom',
        manageTreesTitle: 'Správa stromů',
        treeSwitcher: 'Strom',
        rename: 'Přejmenovat',
        duplicate: 'Duplikovat',
        duplicateTitle: 'Duplikovat strom',
        newTreeNameLabel: 'Název nového stromu',
        mergeInto: 'Sloučit do...',
        delete: 'Smazat',
        export: 'Exportovat',
        newTreePlaceholder: 'Název stromu',
        confirmDelete: (name: string) => `Smazat strom "${name}"? Toto nelze vrátit zpět.`,
        duplicateSuffix: '(kopie)',
        storageUsage: 'Využití úložiště',
        storageOf: 'z',
        migrationComplete: 'Data byla migrována do nového formátu',
        selectTargetTree: 'Vyberte cílový strom',
        mergeSourceTree: 'Sloučit strom',
        mergeIntoTree: 'do',
        startMerge: 'Zahájit sloučení',
        importTreeName: 'Importovaný strom',
        importAsNewTree: 'Importovat jako nový strom',
        treeNameLabel: 'Název stromu',
        persons: 'osob',
        families: 'rodin',
        // Stats dialog
        stats: 'Statistika',
        statsTitle: 'Statistika stromu',
        statsPeople: 'Osoby',
        statsTotal: 'Celkem',
        statsMales: 'Muži',
        statsFemales: 'Ženy',
        statsLiving: 'Žijící',
        statsDeceased: 'Zesnulí',
        statsFamilies: 'Rodiny',
        statsPartnerships: 'Partnerství',
        statsAvgChildren: 'Průměr dětí',
        statsMaxChildren: 'Max dětí',
        statsDates: 'Data',
        statsOldestBirth: 'Nejstarší narození',
        statsNewestBirth: 'Nejmladší narození',
        statsDateRange: 'Rozsah dat',
        statsGenerations: 'Generací',
        statsData: 'Úplnost dat',
        statsWithBirthDate: 'S datem narození',
        statsWithDeathDate: 'S datem úmrtí',
        statsWithBirthPlace: 'S místem narození',
        statsSize: 'Úložiště',
        statsTreeSize: 'Velikost stromu',
        // Anniversaries
        statsAnniversaries: 'Blížící se výročí',
        statsAnniversariesNone: 'Žádná výročí v příštích 30 dnech',
        statsToday: 'Dnes',
        statsThisWeek: 'Tento týden',
        statsThisMonth: 'Tento měsíc',
        statsBirthday: 'narozeniny',
        statsBirthAnniversary: 'nedožitých',
        statsWeddingAnniversary: 'výročí svatby',
        statsMemorial: 'výročí úmrtí',
        statsYears: 'let',
        // Validation
        validate: 'Validovat',
        validateDesc: 'Zkontrolovat strom na chyby',
        validationTitle: 'Validace stromu',
        validationPassed: 'Žádné problémy nenalezeny',
        validationErrors: 'chyby',
        validationWarnings: 'varování',
        validationInfos: 'info',
        validationIssuesFound: 'nalezených problémů',
        // Tree validation messages
        valCycle: 'Zjištěn cyklus předků',
        valSelfPartnership: 'Partnerství sama se sebou',
        valDuplicatePartnership: 'Duplicitní partnerství',
        valMissingChildRef: 'Rodič nemá odkaz na dítě',
        valMissingParentRef: 'Dítě nemá odkaz na rodiče',
        valMissingPartnershipRef: 'Osoba nemá odkaz na partnerství',
        valPartnershipChildMismatch: 'Neshoda dítěte v partnerství',
        valOrphanedRef: 'Odkaz na neexistující záznam',
        valTooManyParents: 'Více než 2 rodiče',
        valParentYoungerThanChild: 'Rodič mladší než dítě',
        valParentTooYoung: 'Rodič velmi mladý při narození',
        valParentTooOld: 'Rodič velmi starý při narození',
        valGenerationConflict: 'Osoba ve více generacích',
        valPartnerIsParent: 'Partner je také rodič',
        valPartnerIsChild: 'Partner je také dítě',
        valSiblingIsParent: 'Sourozenec je také rodič',
        valSiblingIsChild: 'Sourozenec je také dítě',
        // Default person dialog
        defaultPerson: 'Výchozí osoba',
        defaultPersonDesc: 'Při otevření tohoto stromu zaměřit na:',
        defaultPersonFirstPerson: 'První osoba',
        defaultPersonLastFocused: 'Naposledy zobrazená',
        defaultPersonSpecific: 'Konkrétní osoba:',
        // Default tree dialog
        defaultTree: 'Výchozí strom',
        defaultTreeDesc: 'Při spuštění aplikace načíst:',
        defaultTreeFirstTree: 'První strom',
        defaultTreeLastFocused: 'Naposledy zobrazený',
        defaultTreeSpecific: 'Konkrétní strom:',
        // New Tree Menu
        newTreeMenu: 'Nový strom',
        emptyTree: 'Prázdný strom',
        emptyTreeDesc: 'Začít s prázdným rodokmenem',
        fromJson: 'Z JSON',
        fromJsonDesc: 'Importovat z JSON souboru',
        fromGedcom: 'Z GEDCOM',
        fromGedcomDesc: 'Importovat z GEDCOM souboru',
        fromHtml: 'Ze Strom HTML',
        fromHtmlDesc: 'Importovat z exportovaného HTML souboru',
        htmlNoData: 'V HTML souboru nebyla nalezena žádná data',
        fromFocus: 'Z aktuálního pohledu',
        fromFocusDesc: 'Zkopírovat viditelné osoby do nového stromu',
        noFocusedData: 'Žádná data k vytvoření stromu',
        // Export All
        exportAll: 'Exportovat všechny stromy',
        exportAllJson: 'Exportovat jako JSON',
        exportAllJsonDesc: 'Všechny stromy v jednom JSON souboru',
        exportAllApp: 'Exportovat jako aplikaci',
        exportAllAppDesc: 'Samostatný HTML se všemi stromy'
    },

    // View Mode (embedded data)
    viewMode: {
        banner: 'Režim prohlížení (pouze pro čtení)',
        bannerDetail: 'Pro editaci nejprve importujte data do úložiště.',
        importButton: 'Importovat do úložiště',
        existingTitle: 'Strom již existuje',
        existingMessage: 'Strom z tohoto exportu již máte v úložišti.',
        viewStored: 'Zobrazit uloženou verzi',
        viewEmbedded: 'Zobrazit vloženou verzi',
        updateStored: 'Aktualizovat úložiště',
        importTitle: 'Importovat strom',
        importMessage: 'Importovat tento strom do úložiště pro možnost editace?',
        createNew: 'Importovat do úložiště',
        createCopy: 'Vytvořit kopii',
        importSuccess: 'Strom byl úspěšně importován',
        importAllSuccess: (count: number) => `${count} strom${count === 1 ? '' : count < 5 ? 'y' : 'ů'} bylo úspěšně importováno`,
        updateSuccess: 'Úložiště bylo aktualizováno'
    },

    // Encryption
    encryption: {
        enable: 'Šifrovat data',
        warning: 'Pokud zapomenete heslo, vaše data nelze obnovit.',
        setPassword: 'Nastavit heslo',
        confirmPassword: 'Potvrdit heslo',
        enterPassword: 'Zadejte heslo',
        wrongPassword: 'Nesprávné heslo',
        exportPassword: 'Šifrování exportu',
        exportPasswordHint: 'Zadej heslo pro šifrování souboru, nebo exportuj bez šifrování.',
        exportWithPassword: 'Exportovat šifrovaně',
        exportWithoutPassword: 'Exportovat bez šifrování',
        passwordMismatch: 'Hesla se neshodují',
        minLength: 'Heslo musí mít alespoň 6 znaků',
        encryptionEnabled: 'Šifrování zapnuto',
        encryptionDisabled: 'Šifrování vypnuto',
        unlockData: 'Odemknout data',
        decryptionFailed: 'Nepodařilo se dešifrovat data',
        changePassword: 'Změnit heslo',
        currentPassword: 'Aktuální heslo',
        newPassword: 'Nové heslo',
        passwordChanged: 'Heslo úspěšně změněno',
        optional: '(volitelné)',
        dataEncrypted: 'Data jsou šifrována',
        enterPasswordToView: 'Zadejte heslo pro zobrazení'
    },

    // Tree Preview
    treePreview: {
        title: 'Náhled stromu',
        close: 'Zavřít',
        focusedOn: 'Fokus na',
        clickToFocus: 'Klikněte na osobu pro změnu fokusu',
        compare: 'Porovnat stromy',
        preview: 'Náhled',
        comparePersons: 'Porovnat'
    },

    // Embedded Mode (local HTML file)
    embeddedMode: {
        banner: 'Souborová verze',
        bannerDetail: 'Data jsou oddělená od online verze.',
        goOnline: 'Online verze',
        exportJson: 'Exportovat JSON',
        exportJsonDesc: 'Pro import do online verze',
        saveFile: 'Uložit soubor',
        saveFileTitle: 'Stáhnout soubor s aktuálními daty',
        unsavedWarning: 'Máte neuložené změny. Použijte "Uložit soubor" pro jejich zachování.',
        infoTitle: 'O souborové verzi',
        infoText1: 'Toto je samostatný HTML soubor, který funguje i bez internetu. Vaše změny se ukládají do lokálního úložiště tohoto prohlížeče.',
        infoText2: 'Důležité: Online verze (stromapp.info) a tato souborová verze mají každá své vlastní oddělené úložiště. Data se mezi nimi nesynchronizují.',
        infoHow: 'Přechod na online verzi:',
        infoOption1: 'Otevřete stromapp.info a importujte tento HTML soubor (Správce stromů → Nový strom → Ze Strom HTML)',
        infoOption2: 'Nebo klikněte na "Exportovat JSON" výše a JSON soubor importujte na stromapp.info'
    }
};

// Language dictionary
const languagePacks: Record<Language, StringsType> = {
    en: stringsEN,
    cs: stringsCZ
};

// Current active strings (mutable)
export let strings: StringsType = stringsEN;

// Current language
let currentLanguage: Language = 'en';

/**
 * Get current language
 */
export function getCurrentLanguage(): Language {
    return currentLanguage;
}

/**
 * Set language and update strings
 */
export function setLanguage(lang: Language): void {
    if (languagePacks[lang]) {
        currentLanguage = lang;
        strings = languagePacks[lang];
    }
}

/**
 * Detect browser language and return matching supported language
 */
export function detectBrowserLanguage(): Language {
    const browserLang = navigator.language.split('-')[0].toLowerCase();
    if (browserLang === 'cs' || browserLang === 'sk') {
        return 'cs';
    }
    return 'en';
}

/**
 * Initialize language from setting or browser
 */
export function initLanguage(savedLang: Language | 'system'): void {
    if (savedLang === 'system') {
        setLanguage(detectBrowserLanguage());
    } else {
        setLanguage(savedLang);
    }
}
