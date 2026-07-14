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

    demo: {
        tryDemo: 'Try a sample tree',
        tryDemoDesc: 'Explore a ready-made historical family tree',
        treeName: 'Sample: House of Tudor',
        hint: 'Click a card to see actions. This is an ordinary tree — you can delete it in the tree manager.'
    },

    // Family book
    book: {
        menu: 'Family book',
        menuDesc: 'Printable book: chapters by family, photos, sources and a person index',
        title: 'Family Book',
        dialogTitle: 'Family book',
        subtitle: 'The book of the family',
        families: 'Families',
        children: 'Children',
        index: 'Person Index',
        tree: 'Family tree',
        treeHint: 'A full, legible tree is available as a separate poster (Export → Poster).',
        sources: 'Sources',
        chapterShort: 'ch.',
        born: 'b.',
        died: 'd.',
        persons: 'persons',
        generations: 'generations',
        generate: 'Open book',
        optName: 'Title',
        optMaxGen: 'Max generations (optional)',
        compiled: (date: string) => `compiled ${date}`,
        empty: 'The tree is empty.',
    },

    // Versioned backups
    snapshots: {
        menu: 'Backups',
        title: 'Backup history',
        empty: 'No backups yet',
        createNow: 'Create backup now',
        restore: 'Restore',
        download: 'Download',
        restored: 'Backup restored',
        created: 'Backup created',
        restoreConfirm: 'Restore this backup? It overwrites the current tree — the current state is saved as a backup first.',
        total: (count: number, size: string) => `${count} backups · ${size}`,
        colDate: 'Date',
        colReason: 'Reason',
        colPersons: 'People',
        colSize: 'Size',
        reasons: {
            auto: 'Automatic',
            manual: 'Manual',
            'pre-import': 'Before import',
            'pre-merge': 'Before merge',
        },
    },

    events: {
        title: 'Events',
        add: 'Add event',
        addTitle: 'Add event',
        editTitle: 'Edit event',
        empty: 'No events yet',
        edit: 'Edit',
        delete: 'Delete',
        type: 'Type',
        date: 'Date',
        place: 'Place',
        note: 'Note',
        customLabel: 'Label',
        customLabelRequired: 'Enter a label for the custom event',
        deleteConfirm: 'Delete this event?',
        types: {
            birth: 'Birth',
            death: 'Death',
            baptism: 'Baptism',
            burial: 'Burial',
            occupation: 'Occupation',
            residence: 'Residence',
            military: 'Military service',
            emigration: 'Emigration',
            immigration: 'Immigration',
            education: 'Education',
            custom: 'Custom'
        }
    },

    // Sources / citations
    sources: {
        menu: 'Sources',
        title: 'Sources',
        add: 'Add source',
        addTitle: 'Add source',
        editTitle: 'Edit source',
        empty: 'No sources yet',
        sectionTitle: 'Sources',
        cite: 'Cite a source',
        pickTitle: 'Cite a source',
        searchPlaceholder: 'Search sources…',
        createNew: 'New source…',
        emptyPicker: 'No sources — create one',
        edit: 'Edit',
        delete: 'Delete',
        remove: 'Remove citation',
        fieldTitle: 'Title',
        fieldRepository: 'Repository',
        fieldReference: 'Reference',
        fieldUrl: 'URL',
        fieldNote: 'Note',
        titleRequired: 'Enter a source title',
        citations: (n: number) => `${n}×`,
        deleteConfirm: (n: number) =>
            n > 0 ? `Delete this source? It is cited in ${n} place(s); those citations will be removed.` : 'Delete this source?',
    },

    // Attachments
    attachments: {
        title: 'Attachments',
        add: 'Add attachment',
        empty: 'No attachments yet',
        delete: 'Delete',
        deleteConfirm: 'Delete this attachment?',
        notePlaceholder: 'Note (optional)',
        total: (count: number, size: string) => `${count} attachment(s), ${size} total`,
        pdfTooLarge: 'PDF is too large (max 2 MB).',
        unsupportedType: 'Unsupported file type. Use JPG, PNG or PDF.',
        readError: 'Could not read the file.',
    },

    // Duplicate suggestions
    duplicates: {
        title: 'Similar persons already exist:',
        goToPerson: 'Go to person',
        useExisting: 'Use existing',
        parentsLabel: (names: string) => `parents: ${names}`,
        settingLabel: 'Duplicate suggestions',
        settingHint: 'Suggest existing similar persons while entering a new one',
    },

    // Overview minimap
    minimap: {
        title: 'Overview minimap',
        settingLabel: 'Minimap',
        settingHint: 'Show an overview minimap for large trees',
    },

    // Branch colour coding
    branchColors: {
        settingLabel: 'Branch colours',
        legendLabel: 'Colour legend',
        legendHint: 'Show the branch-colour legend over the tree',
        settingHint: 'Colour cards by branch relative to the focus person',
        legendPaternal: 'Paternal',
        legendMaternal: 'Maternal',
        legendDescendant: 'Descendants',
    },

    // Interactive tour
    tour: {
        menu: 'Take a tour',
        offer: 'New here? Take a quick tour.',
        offerYes: 'Start tour',
        next: 'Next',
        skip: 'Skip',
        done: 'Done',
        step1: 'This is a person card. Click it to open actions — edit, add relatives, focus or delete.',
        step2: 'Hovering a card reveals quick-add buttons: parent above, partner and sibling on the sides, child below. The 🔗 icon manages partnerships and parents.',
        step3: 'Add people here too: one person, or a whole family at once with the family wizard.',
        step4: 'The focus panel shows who the tree centres on. The arrows change how many generations of ancestors and descendants are visible.',
        step5: 'Switch views: Family, Descendants, Timeline or the ancestor Fan.',
        step6: 'Zoom and pan controls — you can also drag the canvas and zoom with the mouse wheel; 0 resets the view.',
        step7: 'Search for anyone by name, and use the funnel to filter by surname, place, birth years, gender or living status.',
        step8: 'Trees, export and sharing live here. Strom exports as a single self-contained file you can email to a relative.',
    },

    // Visual family statistics (tree-stats dialog)
    stats: {
        section: 'Family statistics',
        topMaleNames: 'Most common male names',
        topFemaleNames: 'Most common female names',
        lifespanByGen: 'Average lifespan by generation',
        childrenByGen: 'Children per couple by generation',
        birthsByMonth: 'Births by month',
        oldest: 'Longest-lived person',
        longestMarriage: 'Longest marriage',
        years: 'yrs',
        generation: (n: number) => `Gen ${n}`,
        sampleN: (n: number) => `n = ${n}`,
        notEnough: 'Not enough data yet',
        months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    },

    // Anniversaries + "on this day"
    anniversaries: {
        menu: 'Anniversaries',
        title: 'Upcoming anniversaries',
        empty: 'No anniversaries in the next 30 days',
        today: 'today',
        tomorrow: 'tomorrow',
        inDays: (n: number) => `in ${n} days`,
        yearsAgo: (n: number) => `${n} ${n === 1 ? 'year' : 'years'} ago`,
        birthday: (name: string, years: number) => `${name} turns ${years}`,
        wedding: (a: string, b: string, years: number) => `${a} & ${b} — ${years} years married`,
        birthMilestone: (name: string, years: number) => `${name} — ${years} years since birth`,
        deathMilestone: (name: string, years: number) => `${name} — ${years} years since death`,
        otdTitle: 'On this day',
        otdBirth: (name: string, ago: string, _female: boolean) => `${ago}, ${name} was born`,
        otdDeath: (name: string, ago: string, _female: boolean) => `${ago}, ${name} died`,
        otdWedding: (a: string, b: string, ago: string) => `${ago}, ${a} & ${b} were married`,
        settingLabel: 'On this day',
        settingHint: 'Show a daily "on this day" reminder when opening a tree',
    },

    // Family wizard (add a whole family at once)
    familyWizard: {
        menu: 'Add family…',
        title: 'Add family',
        settingLabel: 'Add-family button',
        settingHint: 'Show an "Add family" button in the toolbar',
        aroundName: (name: string) => `Around ${name}`,
        roles: { father: 'Father', mother: 'Mother', partner: 'Partner', sibling: 'Sibling', child: 'Child' },
        firstName: 'First name',
        lastName: 'Last name',
        year: 'Birth year',
        weddingYear: 'Wedding year',
        addSibling: '+ Sibling',
        addChild: '+ Child',
        remove: 'Remove',
        save: 'Add family',
        maybe: (name: string) => `Similar: ${name}`,
        useExisting: 'Use existing',
        linked: 'Linked to existing',
        added: (n: number) => n === 1 ? '1 person added' : `${n} people added`,
        continuePrompt: 'Continue with the rest of the family?',
        continueYes: 'Add family',
    },

    // Progressive web app (offline + updates)
    pwa: {
        offline: 'Offline',
        updateReady: 'A new version is available.',
        refresh: 'Refresh',
    },

    // File System Access (work over a file on disk)
    fileAccess: {
        saveToFile: 'Save to file…',
        saveToFileDesc: 'Link this tree to a file on disk — then just press Ctrl+S to save into it',
        openFromFile: 'Open from file…',
        openFromFileDesc: 'Open a JSON file and keep it linked, so changes save back into it',
        save: 'Save',
        unlink: 'Detach file',
        indicator: 'Linked to a file',
        linkedTo: (name: string) => `Linked to ${name}`,
        saved: (name: string) => `Saved to ${name}`,
        linked: (name: string) => `Linked to ${name}`,
        unlinked: 'File detached',
        saveFailed: 'Could not save to the file',
        permissionDenied: 'File access was denied — the link was removed',
        lockedRefuse: 'Unlock encryption before saving to a file',
    },

    // CSV export (spreadsheet person table)
    csv: {
        menuTitle: 'Export CSV',
        menuDesc: 'Person table for Excel / Google Sheets',
        firstName: 'First name', lastName: 'Last name', gender: 'Gender',
        birthDate: 'Born', birthPlace: 'Birth place',
        deathDate: 'Died', deathPlace: 'Death place',
        father: 'Father', mother: 'Mother', partners: 'Partners', notes: 'Notes',
    },

    // Zoom controls
    zoomControls: {
        zoomIn: 'Zoom In',
        zoomOut: 'Zoom Out',
        reset: 'Reset View',
        fitToScreen: 'Fit to Screen',
        settingLabel: 'Floating buttons',
        settingHint: 'Show the floating zoom buttons over the tree',
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
        deceased: 'Deceased',
        photo: 'Photo',
        photoChoose: 'Choose photo',
        photoRemove: 'Remove',
        maidenName: 'Maiden Name',
        // Partnership dates - used based on status
        startDateMarried: 'Wedding Date',
        startDatePartners: 'Relationship Start',
        startPlace: 'Place',
        endDateMarried: 'Divorce Date',
        endDatePartners: 'Relationship End',
        note: 'Note',
        notes: 'Notes',
        moreInfo: 'More Info',
        partner: 'Partner',
        isPrimary: 'Primary relationship'
    },

    // Tooltip
    tooltip: {
        age: 'Age',
        born: 'Born',
        died: 'Died',
        notes: 'Notes'
    },

    // Placeholders
    placeholders: {
        firstName: 'First name',
        lastName: 'Last name',
        maidenName: 'Maiden name',
        flexDate: '5/15/1880 · 5/1880 · 1880 · about 1880'
    },

    // Archive search
    archives: {
        title: 'Search in archives',
        internationalSection: 'International',
        czechSection: 'Czech registers (matriky)',
        familySearchHint: 'Prefilled record search (name, years, place)',
        suggestedFor: 'Suggested for',
        allPortals: 'All Czech regional archives',
        disclaimer: 'External sites open in a new tab. Suggestions are based on place names and may not be accurate.',
    },

    // Relationship calculator
    kinship: {
        title: 'Relationship',
        fromLabel: 'From person',
        pickLabel: 'Select the second person:',
        isOf: 'is, relative to',
        noRelation: 'No relationship found (within the tracked tree).',
        highlight: 'Highlight in tree',
        close: 'Close',
    },

    // Context menu
    contextMenu: {
        edit: 'Edit',
        focus: 'Focus',
        showDescendants: 'Show descendants',
        relationship: 'Find relationship…',
        archives: 'Search in archives…',
        addParent: 'Add Parent',
        addPartner: 'Add Partner',
        addChild: 'Add Child',
        addSibling: 'Add Sibling',
        delete: 'Delete'
    },

    // Family / descendants view switch
    viewModeSwitch: {
        family: 'Family',
        descendants: 'Descendants',
        timeline: 'Timeline',
        fan: 'Fan',
        toggle: 'Family / descendants view',
        back: 'Back to family view',
        badge: (name: string, count: number) => `Descendants: ${name} (${count})`,
        fullFamilies: "Show partners' whole families (step-children)",
        settingLabel: 'Descendants view',
        settingHint: "Show partners' whole families by default (their other unions and step-children, de-emphasized)",
    },

    // Fan chart (ancestor semicircle)
    fan: {
        generations: 'Generations',
    },

    // Timeline view
    timeline: {
        segment: 'Timeline',
        wedding: 'Marriage',
        empty: 'No people with a known birth year',
        omitted: (n: number) => `${n} ${n === 1 ? 'person' : 'people'} without a birth year not shown`,
    },

    // Person modal
    personModal: {
        addTitle: 'Add Person',
        editTitle: 'Edit Person',
        completeTitle: 'Complete Person',
        enterName: 'Please enter first name or last name',
        unsavedMessage: 'You have unsaved changes in person details.',
        invalidDate: 'Invalid date. Use e.g. 5/15/1880, 5/1880, 1880 or "about 1880".',
        photoError: 'Could not process the image.',
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

    // Parent→child relationship type
    parentRelType: {
        biological: 'Biological',
        adoptive: 'Adoptive',
        step: 'Step',
        foster: 'Foster',
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
        hiddenPartnersTooltip: 'Other partners',
        hiddenFamiliesTooltip: 'Other families',
        collapsePartners: 'Collapse expanded partners',
        collapsePartnersLabel: '−',
        hiddenSiblingsTooltip: 'Siblings',
        hiddenParentsTooltip: 'Parents',
        hiddenChildrenTooltip: 'Children',
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

    // Search filters
    searchFilters: {
        toggle: 'Filters',
        lastName: 'Last name',
        place: 'Place',
        yearFrom: 'Year from',
        yearTo: 'Year to',
        anyGender: 'Any gender',
        anyStatus: 'Living or deceased',
        living: 'Living only',
        deceased: 'Deceased only',
        clear: 'Clear',
        resultCount: (n: number) => `${n} result(s)`,
    },

    // Person picker
    personPicker: {
        placeholder: 'Search person...',
        noResults: 'No matching persons'
    },

    // Errors
    errors: {
        saveFailed: 'Saving failed — your latest changes may not be stored! Free up space or unlock encryption, then edit again.',
        parseStoredData: 'Failed to parse stored data',
        invalidJson: 'Invalid JSON file'
    },

    // Partner selection dialog
    partnerSelection: {
        title: 'Select Partner',
        description: (name: string) => `Show relationship branch for ${name}:`
    },

    // Add child - parent selection
    addChild: {
        selectParent: 'Select the other parent',
        selectParentDesc: (name: string) => `${name} has multiple partners. Select the other parent:`,
        newPlaceholder: 'New person (unknown)',
        unknownPerson: 'Unknown person'
    },

    // About dialog
    // Small UI tooltips wired via data-i18n-title
    uiTips: {
        centerOnFocus: 'Center on the focused person',
        showStats: 'Show tree statistics',
        embeddedInfo: 'Info',
    },

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
        placeholders: 'Placeholders',
        unsupported: 'Unsupported',
        saveAsJson: 'Save as JSON',
        saveAsJsonDesc: 'Download converted data as JSON file',
        importAsNew: 'Import as New Tree',
        importAsNewDesc: 'Replace current tree with imported data',
        mergeExisting: 'Merge with Existing',
        mergeExistingDesc: 'Smart merge into current tree',
        insertToTree: 'Insert into Tree',
        insertToTreeDesc: 'Load converted data into current tree',
        parseError: 'Failed to parse GEDCOM file',
        skippedTags: 'Skipped records',
        unknownSex: (n: number) => `${n} person${n === 1 ? '' : 's'} with unknown sex (gender inferred from family role)`,
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
        pendingGate: (n: number) => `${n} uncertain match${n === 1 ? '' : 'es'} left undecided — those people will be imported as SEPARATE persons (you can merge them later). Continue?`,
        suggestedPrecise: 'suggested — more precise date',
        suggestedComplete: 'suggested — more complete value',

        // Manual match dialog
        incomingPerson: 'Incoming person:',

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
        open: 'Open',
        moreActions: 'More actions',
        searchTrees: 'Search trees…',
        pendingSection: 'Unfinished merges',
        cannotHideLastVisible: 'The last visible tree cannot be hidden — unhide another tree first.',
        activeBadge: 'Active',
        lockedBadge: 'Locked',
        hiddenBadge: 'Hidden',
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
        statsPhotos: 'Photos',
        statsEvents: 'Events',
        statsSources: 'Sources',
        statsSourceCoverage: 'Source coverage',
        statsAttachments: 'Attachments',
        statsMediaWarning: 'Over 10 MB of media — the file may be too big to email',
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
        valEventBirthDeath: 'Birth/death recorded as a life event (belongs to the date fields)',
        valEventNoLabel: 'Custom event has no label',
        valEventBadDate: 'Event has an invalid date',
        valDeathBeforeBirth: 'Death date is before birth date',
        valImplausibleLifespan: 'Implausibly long lifespan',
        valEventBeforeBirth: 'Event dated before birth',
        valEventAfterDeath: 'Event dated after death',
        valWeddingBeforeBirth: 'Wedding dated before a partner\'s birth',
        valWeddingAfterDeath: 'Wedding dated after a partner\'s death',
        valChildMarriage: 'Married as a child',
        valChildAfterMotherDeath: 'Child born after the mother\'s death',
        valChildAfterFatherDeath: 'Child born long after the father\'s death',
        valCitationMissingSource: 'Citation points to a missing source',
        valAttachmentNoData: 'Attachment has no usable data',
        valPartnerAgeGap: 'Extreme age difference between partners',
        valFix: 'Fix',
        valFixAll: 'Fix all',
        valFixed: (count: number) => `Fixed ${count} issue${count !== 1 ? 's' : ''}`,
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
        exportAllAppDesc: 'Standalone HTML with all trees',
        // Tree visibility
        showTree: 'Show tree',
        hideTree: 'Hide tree',
        showTreeHint: 'Show tree',
        hideTreeHint: 'Hide tree',
        hiddenLabel: '(hidden)'
    },

    // Collaboration: send to a relative
    share: {
        menuItem: '📩 Send to a relative',
        menuDesc: 'One file by e-mail — they open it, add what they know, and send it back',
        passwordLabel: 'Password (optional)',
        dialogTitle: 'Send to a relative',
        dialogIntro: 'Creates a single file you can e-mail. The recipient just opens it — no installation, no account.',
        scopeLabel: 'What to send',
        scopeWhole: 'The whole tree',
        scopeBranch: 'The current view (visible branch)',
        senderNameLabel: 'Your name (shown to the recipient)',
        messageLabel: 'Message for the recipient',
        messagePlaceholder: 'Hi! Could you fill in what you know about your branch?',
        createFile: 'Create file to send',
        welcomeTitle: (sender: string) => `${sender} sent you a family tree`,
        welcomeCounts: (tree: string, persons: number) => `“${tree}” · ${persons} people`,
        welcomeView: 'Just look around',
        welcomeEdit: 'Add what I know',
        collabBar: (sender: string) => `You are filling in a tree for ${sender}.`,
        collabSend: 'Send the file back',
        collabHide: 'Hide',
        collabBadgeTitle: 'Collaboration in progress',
        replyTitle: (sender: string) => `${sender} returned your tree`,
        replyIntro: (tree: string) => `This file replies to your shared tree “${tree}”. Merge their additions into it?`,
        replyMerge: 'Review and merge',
        replyView: 'Just look first',
        replyImport: 'Import as a new tree',
        unknownSender: 'A relative'
    },

    // Change packets (send only changes)
    shareDiff: {
        scopeChanges: 'Only the changes since the last share',
        packetSaved: 'Change file saved',
        noChanges: 'Nothing has changed since the last share',
        baselineMissing: 'The baseline for these changes is missing — ask for the whole file instead',
        treeNotFound: 'No matching tree for these changes — ask the sender for the whole file instead',
    },

    // View Mode (embedded data)
    viewMode: {
        banner: 'View mode (read-only)',
        bannerDetail: 'Choose how to continue:',
        goOnline: 'Go to stromapp.info',
        goOnlineHint: 'Recommended',
        stayOffline: 'Stay with this file',
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

    // Cross-tree links
    crossTree: {
        badgeTitle: (count: number) => `Found in ${count} other tree${count !== 1 ? 's' : ''}`,
        tooltipHeader: 'Also in:',
        clickToSwitch: 'Click to switch'
    },

    // Embedded Mode (local HTML file)
    embeddedMode: {
        banner: 'Standalone file',
        bannerDetail: 'This file has its own separate data storage.',
        goOnline: 'stromapp.info',
        exportJson: 'Export JSON',
        exportJsonDesc: 'For import into online version',
        saveFile: 'Save File',
        saveFileTitle: 'Download file with current data',
        unsavedWarning: 'You have unsaved changes. Use "Save File" to keep them.',
        infoTitle: 'About This File',
        infoText1: 'This is a standalone HTML file. Your data is saved in this browser\'s storage.',
        infoText2: 'The web app at stromapp.info has its own separate storage. Data is NOT synchronized between them.',
        infoHow: 'Your options:',
        infoStayOffline: 'Keep using this file',
        infoStayOfflineDesc: 'Your data stays in this browser. Use "Save File" to download a copy with your changes.',
        infoGoOnline: 'Switch to stromapp.info',
        infoGoOnlineDesc: 'Use the web app instead. You\'ll need to import this file there to transfer your data.'
    },

    // Import from offline version (intro text in new tree menu)
    importFromOffline: {
        description: 'Welcome to stromapp.info! To continue with your data, import the file you were using.'
    },

    // Lock
    lock: {
        lockPerson: 'Lock',
        unlockPerson: 'Unlock',
        lockTree: 'Lock tree',
        unlockTree: 'Unlock tree',
        lockedTooltip: 'Locked'
    },

    // Audit Log
    auditLog: {
        title: 'Change History',
        empty: 'No entries recorded yet.',
        clear: 'Clear History',
        clearConfirm: 'Clear the entire change history? This cannot be undone.',
        entries: (count: number) => `${count} ${count === 1 ? 'entry' : 'entries'}`,
        enableSetting: 'Change history',
        enabled: 'Change history enabled',
        disabled: 'Change history disabled',
        viewLog: 'Change History',
        exportInclude: 'Include change history',
        exportTxt: 'Export TXT',
        // Action descriptions
        createdPerson: (name: string) => `Created person: ${name}`,
        createdPlaceholder: (gender: string) => `Created placeholder (${gender})`,
        updatedPerson: (name: string, fields: string) => `Updated ${name}: ${fields}`,
        deletedPerson: (name: string) => `Deleted person: ${name}`,
        createdPartnership: (p1: string, p2: string, status: string) => `Created partnership: ${p1} & ${p2} (${status})`,
        updatedPartnership: (p1: string, p2: string) => `Updated partnership: ${p1} & ${p2}`,
        removedPartnership: (p1: string, p2: string) => `Removed partnership: ${p1} & ${p2}`,
        addedParentChild: (parent: string, child: string) => `Added parent-child: ${parent} → ${child}`,
        addedFamily: (name: string, count: number) => `Added family around ${name} (${count} new)`,
        removedParentChild: (parent: string, child: string) => `Removed parent-child: ${parent} → ${child}`,
        mergedPersons: (removed: string, kept: string, details: string) => `Merged persons: ${removed} → ${kept}${details ? ' (' + details + ')' : ''}`,
        clearedData: (persons: number, partnerships: number) => `Cleared data: ${persons} persons, ${partnerships} partnerships`,
        loadedData: (persons: number, partnerships: number) => `Loaded data: ${persons} persons, ${partnerships} partnerships`,
        // Batch summaries
        addedChild: (parent: string, child: string) => `Added child: ${parent} → ${child}`,
        addedParent: (parent: string, child: string) => `Added parent: ${parent} → ${child}`,
        addedSibling: (person: string, sibling: string) => `Added sibling: ${person} + ${sibling}`,
        addedPartner: (person: string, partner: string) => `Added partner: ${person} & ${partner}`,
        // Tree merge
        treeMerge: (merged: number, added: number, source: string) => `Tree merge from "${source}": ${merged} merged, ${added} added`,
        // Auto-repair
        repairedIssue: (desc: string) => `Auto-repair: ${desc}`,
        restoredBackup: 'Restored a backup',
        // Life events
        addedEvent: (name: string) => `Added event to ${name}`,
        updatedEvent: (name: string) => `Updated event of ${name}`,
        removedEvent: (name: string) => `Removed event from ${name}`,
        addedSource: (title: string) => `Added source "${title}"`,
        updatedSource: (title: string) => `Updated source "${title}"`,
        removedSource: (title: string) => `Removed source "${title}"`,
        citedSource: (name: string) => `Cited a source on ${name}`,
        uncitedSource: (name: string) => `Removed a citation from ${name}`,
        addedAttachment: (name: string) => `Added attachment to ${name}`,
        removedAttachment: (name: string) => `Removed attachment from ${name}`,
        updatedAttachment: (name: string) => `Updated attachment of ${name}`,
        setParentRelType: (parent: string, child: string) => `Set relationship type ${parent} → ${child}`,
        // Undo / redo
        undoAction: (desc: string) => `Undo: ${desc}`,
        redoAction: (desc: string) => `Redo: ${desc}`
    },

    // Undo / redo
    undo: {
        undo: 'Undo',
        redo: 'Redo',
        addPerson: (name: string) => `adding ${name}`,
        editPerson: (name: string) => `editing ${name}`,
        clearedData: 'clearing all data',
        loadedData: 'importing data',
        repairedIssue: 'a validation repair',
        deletePerson: (name: string) => `deleting ${name}`,
        addPartnership: (a: string, b: string) => `partnership ${a} & ${b}`,
        editPartnership: (a: string, b: string) => `editing partnership ${a} & ${b}`,
        removePartnership: (a: string, b: string) => `removing partnership ${a} & ${b}`,
        addRelation: (parent: string, child: string) => `link ${parent} → ${child}`,
        removeRelation: (parent: string, child: string) => `unlink ${parent} → ${child}`,
        addFamily: (name: string) => `adding family around ${name}`,
        mergePersons: (name: string) => `merge into ${name}`,
        addEvent: (name: string) => `event of ${name}`,
        editEvent: (name: string) => `editing event of ${name}`,
        removeEvent: (name: string) => `removing event of ${name}`,
        restoreBackup: 'restoring backup',
        addSource: (title: string) => `source "${title}"`,
        editSource: (title: string) => `editing source "${title}"`,
        removeSource: (title: string) => `removing source "${title}"`,
        cite: (name: string) => `citation on ${name}`,
        uncite: (name: string) => `removing citation from ${name}`,
        addAttachment: (name: string) => `attachment of ${name}`,
        removeAttachment: (name: string) => `removing attachment from ${name}`,
        editAttachment: (name: string) => `editing attachment of ${name}`,
        setParentRelType: (child: string) => `relationship type of ${child}`,
        undone: (desc: string) => `Undone: ${desc}`,
        redone: (desc: string) => `Redone: ${desc}`,
        nothingToUndo: 'Nothing to undo',
        nothingToRedo: 'Nothing to redo'
    },

    // Living-person privacy filter for exports
    privacy: {
        livingPerson: 'Living person',
        label: 'Privacy of living persons',
        tooltip: 'Hide details of people who are probably still alive when the tree leaves your family. The structure stays intact.',
        modeFull: 'Full data',
        modeInitials: 'Initials + birth year',
        modeAnonymous: 'Hide names',
        modeMinimal: 'Keep surname only',
        stripPhotos: 'Export without photos & attachments'
    },

    // Poster export (SVG / PNG / tiled PDF)
    poster: {
        menu: 'Export poster',
        title: 'Export as poster',
        description: 'Export the current tree as a vector, image, or printable multi-page poster.',
        svg: 'SVG (vector)',
        svgDesc: 'Scalable vector, opens in a browser or Inkscape',
        png: 'PNG (image)',
        pngDesc: 'High-resolution raster image',
        pdf: 'Print / PDF (tiled)',
        pdfDesc: 'Print across multiple pages with glue marks',
        format: 'Paper size',
        orientation: 'Orientation',
        portrait: 'Portrait',
        landscape: 'Landscape',
        empty: 'Nothing to export — open a tree first.',
        pngScaledDown: 'The image was scaled down to fit the size limit.',
        pngError: 'Could not create the image.',
        pageLabel: (row: number, col: number) => `row ${row} · col ${col}`,
        guideOption: 'Add an assembly-guide first page',
        guideTitle: 'Assembly guide',
        guideInfo: (pages: number, rows: number, cols: number, overlap: number) =>
            `${pages} sheets (${rows} × ${cols}), ${overlap} mm overlap — glue by the grid below.`,
        emptySheet: 'empty — not printed'
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

    demo: {
        tryDemo: 'Vyzkoušet ukázkový strom',
        tryDemoDesc: 'Prohlédni si hotový historický rodokmen',
        treeName: 'Ukázka: Přemyslovci',
        hint: 'Klikni na kartu pro akce. Je to běžný strom — můžeš ho smazat ve správci stromů.'
    },

    // Family book
    book: {
        menu: 'Kniha rodu',
        menuDesc: 'Tisknutelná kniha: kapitoly po rodinách, fotky, prameny a rejstřík osob',
        title: 'Kniha rodu',
        dialogTitle: 'Kniha rodu',
        subtitle: 'Kniha rodu',
        families: 'Rodiny',
        children: 'Děti',
        index: 'Rejstřík osob',
        tree: 'Rodokmen',
        treeHint: 'Úplný strom v čitelné velikosti je přiložen jako samostatný plakát (Export → Plakát).',
        sources: 'Prameny',
        chapterShort: 'kap.',
        born: 'nar.',
        died: 'zem.',
        persons: 'osob',
        generations: 'generací',
        generate: 'Otevřít knihu',
        optName: 'Název',
        optMaxGen: 'Max generací (nepovinné)',
        compiled: (date: string) => `sestaveno ${date}`,
        empty: 'Strom je prázdný.',
    },

    // Versioned backups
    snapshots: {
        menu: 'Zálohy',
        title: 'Historie záloh',
        empty: 'Zatím žádné zálohy',
        createNow: 'Vytvořit zálohu teď',
        restore: 'Obnovit',
        download: 'Stáhnout',
        restored: 'Záloha obnovena',
        created: 'Záloha vytvořena',
        restoreConfirm: 'Obnovit tuto zálohu? Přepíše aktuální strom — aktuální stav se před obnovou uloží jako záloha.',
        total: (count: number, size: string) => `${count} záloh · ${size}`,
        colDate: 'Datum',
        colReason: 'Důvod',
        colPersons: 'Osob',
        colSize: 'Velikost',
        reasons: {
            auto: 'Automatická',
            manual: 'Ruční',
            'pre-import': 'Před importem',
            'pre-merge': 'Před sloučením',
        },
    },

    events: {
        title: 'Události',
        add: 'Přidat událost',
        addTitle: 'Přidat událost',
        editTitle: 'Upravit událost',
        empty: 'Zatím žádné události',
        edit: 'Upravit',
        delete: 'Smazat',
        type: 'Typ',
        date: 'Datum',
        place: 'Místo',
        note: 'Poznámka',
        customLabel: 'Popis',
        customLabelRequired: 'Zadejte popis vlastní události',
        deleteConfirm: 'Smazat tuto událost?',
        types: {
            birth: 'Narození',
            death: 'Úmrtí',
            baptism: 'Křest',
            burial: 'Pohřeb',
            occupation: 'Povolání',
            residence: 'Bydliště',
            military: 'Vojenská služba',
            emigration: 'Emigrace',
            immigration: 'Imigrace',
            education: 'Vzdělání',
            custom: 'Vlastní'
        }
    },

    // Sources / citations
    sources: {
        menu: 'Prameny',
        title: 'Prameny',
        add: 'Přidat pramen',
        addTitle: 'Přidat pramen',
        editTitle: 'Upravit pramen',
        empty: 'Zatím žádné prameny',
        sectionTitle: 'Prameny',
        cite: 'Citovat pramen',
        pickTitle: 'Citovat pramen',
        searchPlaceholder: 'Hledat prameny…',
        createNew: 'Nový pramen…',
        emptyPicker: 'Žádné prameny — vytvořte pramen',
        edit: 'Upravit',
        delete: 'Smazat',
        remove: 'Odebrat citaci',
        fieldTitle: 'Název',
        fieldRepository: 'Archiv / instituce',
        fieldReference: 'Signatura / strana',
        fieldUrl: 'URL',
        fieldNote: 'Poznámka',
        titleRequired: 'Zadejte název pramene',
        citations: (n: number) => `${n}×`,
        deleteConfirm: (n: number) =>
            n > 0 ? `Smazat tento pramen? Je citován na ${n} místech; citace budou odebrány.` : 'Smazat tento pramen?',
    },

    // Attachments
    attachments: {
        title: 'Přílohy',
        add: 'Přidat přílohu',
        empty: 'Zatím žádné přílohy',
        delete: 'Smazat',
        deleteConfirm: 'Smazat tuto přílohu?',
        notePlaceholder: 'Poznámka (nepovinné)',
        total: (count: number, size: string) => `${count} příloh, celkem ${size}`,
        pdfTooLarge: 'PDF je příliš velké (max 2 MB).',
        unsupportedType: 'Nepodporovaný typ souboru. Použijte JPG, PNG nebo PDF.',
        readError: 'Soubor se nepodařilo načíst.',
    },

    // Duplicate suggestions
    duplicates: {
        title: 'Podobné osoby už existují:',
        goToPerson: 'Přejít na osobu',
        useExisting: 'Použít existující',
        parentsLabel: (names: string) => `rodiče: ${names}`,
        settingLabel: 'Našeptávání duplicit',
        settingHint: 'Při zadávání nové osoby nabízet podobné existující',
    },

    // Overview minimap
    minimap: {
        title: 'Přehledová minimapa',
        settingLabel: 'Minimapa',
        settingHint: 'Zobrazovat přehledovou minimapu u velkých stromů',
    },

    // Branch colour coding
    branchColors: {
        settingLabel: 'Barvy větví',
        legendLabel: 'Legenda barev',
        legendHint: 'Zobrazovat legendu barev větví nad stromem',
        settingHint: 'Obarvit karty podle větve vzhledem k fokus osobě',
        legendPaternal: 'Otcovská',
        legendMaternal: 'Mateřská',
        legendDescendant: 'Potomci',
    },

    // Interactive tour
    tour: {
        menu: 'Spustit průvodce',
        offer: 'Poprvé tady? Projděte si rychlého průvodce.',
        offerYes: 'Spustit průvodce',
        next: 'Další',
        skip: 'Přeskočit',
        done: 'Hotovo',
        step1: 'Tohle je karta osoby. Klikněte na ni pro akce — upravit, přidat příbuzné, zaměřit nebo smazat.',
        step2: 'Po najetí na kartu se objeví tlačítka rychlého přidání: nahoře rodič, po stranách partner a sourozenec, dole dítě. Ikona 🔗 spravuje partnerství a rodiče.',
        step3: 'Osoby přidáte i tady: jednu, nebo celou rodinu najednou průvodcem rodiny.',
        step4: 'Panel fokusu ukazuje, na koho je strom zaměřený. Šipkami měníte, kolik generací předků a potomků je vidět.',
        step5: 'Přepínejte pohledy: Rodina, Potomci, Časová osa nebo Vějíř předků.',
        step6: 'Ovládání přiblížení a posunu — plátno jde také táhnout myší a přibližovat kolečkem; 0 vrátí výchozí pohled.',
        step7: 'Vyhledejte kohokoli podle jména a trychtýřem filtrujte podle příjmení, místa, let narození, pohlaví nebo žijící/zemřelí.',
        step8: 'Stromy, export a sdílení jsou tady. Strom se exportuje jako jeden samostatný soubor, který pošlete příbuznému.',
    },

    // Visual family statistics (tree-stats dialog)
    stats: {
        section: 'Statistiky rodu',
        topMaleNames: 'Nejčastější mužská jména',
        topFemaleNames: 'Nejčastější ženská jména',
        lifespanByGen: 'Průměrné dožití podle generací',
        childrenByGen: 'Počet dětí na pár podle generací',
        birthsByMonth: 'Narození podle měsíců',
        oldest: 'Nejdéle žijící osoba',
        longestMarriage: 'Nejdelší manželství',
        years: 'let',
        generation: (n: number) => `Gen. ${n}`,
        sampleN: (n: number) => `n = ${n}`,
        notEnough: 'Zatím málo dat',
        months: ['Led', 'Úno', 'Bře', 'Dub', 'Kvě', 'Čer', 'Čvc', 'Srp', 'Zář', 'Říj', 'Lis', 'Pro'],
    },

    // Anniversaries + "on this day"
    anniversaries: {
        menu: 'Výročí',
        title: 'Nadcházející výročí',
        empty: 'Žádná výročí v příštích 30 dnech',
        today: 'dnes',
        tomorrow: 'zítra',
        inDays: (n: number) => `za ${n} ${n < 5 ? 'dny' : 'dní'}`,
        yearsAgo: (n: number) => n === 1 ? 'před 1 rokem' : `před ${n} lety`,
        birthday: (name: string, years: number) => `${name} slaví ${years}. narozeniny`,
        wedding: (a: string, b: string, years: number) => `${a} a ${b} — ${years}. výročí svatby`,
        birthMilestone: (name: string, years: number) => `${name} — ${years} let od narození`,
        deathMilestone: (name: string, years: number) => `${name} — ${years} let od úmrtí`,
        otdTitle: 'V tento den',
        otdBirth: (name: string, ago: string, female: boolean) => `${ago} se narodil${female ? 'a' : ''} ${name}`,
        otdDeath: (name: string, ago: string, female: boolean) => `${ago} zemřel${female ? 'a' : ''} ${name}`,
        otdWedding: (a: string, b: string, ago: string) => `${ago} se vzali ${a} a ${b}`,
        settingLabel: 'V tento den',
        settingHint: 'Při otevření stromu ukázat denní připomínku „v tento den"',
    },

    // Family wizard (add a whole family at once)
    familyWizard: {
        menu: 'Přidat rodinu…',
        title: 'Přidat rodinu',
        settingLabel: 'Tlačítko Přidat rodinu',
        settingHint: 'Zobrazovat v liště tlačítko „Přidat rodinu"',
        aroundName: (name: string) => `Kolem osoby ${name}`,
        roles: { father: 'Otec', mother: 'Matka', partner: 'Partner', sibling: 'Sourozenec', child: 'Dítě' },
        firstName: 'Jméno',
        lastName: 'Příjmení',
        year: 'Rok narození',
        weddingYear: 'Rok svatby',
        addSibling: '+ Sourozenec',
        addChild: '+ Dítě',
        remove: 'Odebrat',
        save: 'Přidat rodinu',
        maybe: (name: string) => `Podobná osoba: ${name}`,
        useExisting: 'Použít existující',
        linked: 'Napojeno na existující',
        added: (n: number) => n === 1 ? 'Přidána 1 osoba' : `Přidáno ${n} ${n < 5 ? 'osoby' : 'osob'}`,
        continuePrompt: 'Pokračovat zbytkem rodiny?',
        continueYes: 'Přidat rodinu',
    },

    // Progressive web app (offline + updates)
    pwa: {
        offline: 'Offline',
        updateReady: 'Je k dispozici nová verze.',
        refresh: 'Obnovit',
    },

    // File System Access (práce nad souborem na disku)
    fileAccess: {
        saveToFile: 'Uložit do souboru…',
        saveToFileDesc: 'Propojí strom se souborem na disku — pak stačí ukládat klávesou Ctrl+S',
        openFromFile: 'Otevřít ze souboru…',
        openFromFileDesc: 'Otevře JSON soubor a nechá ho propojený, změny se ukládají zpět do něj',
        save: 'Uložit',
        unlink: 'Odpojit soubor',
        indicator: 'Propojeno se souborem',
        linkedTo: (name: string) => `Propojeno se souborem ${name}`,
        saved: (name: string) => `Uloženo do ${name}`,
        linked: (name: string) => `Propojeno se souborem ${name}`,
        unlinked: 'Soubor odpojen',
        saveFailed: 'Nepodařilo se uložit do souboru',
        permissionDenied: 'Přístup k souboru byl odepřen — propojení zrušeno',
        lockedRefuse: 'Před uložením do souboru odemkni šifrování',
    },

    // CSV export (spreadsheet person table)
    csv: {
        menuTitle: 'Export CSV',
        menuDesc: 'Tabulka osob pro Excel / Google Sheets',
        firstName: 'Jméno', lastName: 'Příjmení', gender: 'Pohlaví',
        birthDate: 'Narození', birthPlace: 'Místo narození',
        deathDate: 'Úmrtí', deathPlace: 'Místo úmrtí',
        father: 'Otec', mother: 'Matka', partners: 'Partneři', notes: 'Poznámky',
    },

    // Zoom controls
    zoomControls: {
        zoomIn: 'Přiblížit',
        zoomOut: 'Oddálit',
        reset: 'Obnovit pohled',
        fitToScreen: 'Zobrazit vše',
        settingLabel: 'Plovoucí tlačítka',
        settingHint: 'Zobrazovat plovoucí tlačítka přiblížení nad stromem',
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
        deceased: 'Zemřel/a',
        photo: 'Fotka',
        photoChoose: 'Vybrat fotku',
        photoRemove: 'Odebrat',
        maidenName: 'Rodné příjmení',
        // Partnership dates - used based on status
        startDateMarried: 'Datum sňatku',
        startDatePartners: 'Začátek vztahu',
        startPlace: 'Místo',
        endDateMarried: 'Datum rozvodu',
        endDatePartners: 'Konec vztahu',
        note: 'Poznámka',
        notes: 'Poznámky',
        moreInfo: 'Více informací',
        partner: 'Partner',
        isPrimary: 'Hlavní vztah'
    },

    // Tooltip
    tooltip: {
        age: 'Věk',
        born: 'Narozen/a',
        died: 'Zemřel/a',
        notes: 'Poznámky'
    },

    // Placeholders
    placeholders: {
        firstName: 'Jméno',
        lastName: 'Příjmení',
        maidenName: 'Rodné příjmení',
        flexDate: '15.5.1880 · 5/1880 · 1880 · kolem 1880'
    },

    // Archive search
    archives: {
        title: 'Hledat v archivech',
        internationalSection: 'Mezinárodní',
        czechSection: 'České matriky',
        familySearchHint: 'Předvyplněné hledání záznamů (jméno, roky, místo)',
        suggestedFor: 'Doporučeno pro',
        allPortals: 'Všechny oblastní archivy ČR',
        disclaimer: 'Externí weby se otevřou v nové záložce. Doporučení vychází z názvů míst a nemusí být přesné.',
    },

    // Relationship calculator
    kinship: {
        title: 'Příbuzenský vztah',
        fromLabel: 'Výchozí osoba',
        pickLabel: 'Vyberte druhou osobu:',
        isOf: 'je vůči osobě',
        noRelation: 'Žádný vztah nenalezen (v rámci evidovaného stromu).',
        highlight: 'Zvýraznit ve stromu',
        close: 'Zavřít',
    },

    // Context menu
    contextMenu: {
        edit: 'Upravit',
        focus: 'Zaměřit',
        showDescendants: 'Zobrazit potomky',
        relationship: 'Zjistit vztah…',
        archives: 'Hledat v archivech…',
        addParent: 'Přidat rodiče',
        addPartner: 'Přidat partnera',
        addChild: 'Přidat dítě',
        addSibling: 'Přidat sourozence',
        delete: 'Smazat'
    },

    // Family / descendants view switch
    viewModeSwitch: {
        family: 'Rodina',
        descendants: 'Potomci',
        timeline: 'Časová osa',
        fan: 'Vějíř',
        toggle: 'Pohled rodina / potomci',
        back: 'Zpět na rodinný pohled',
        badge: (name: string, count: number) => `Potomci: ${name} (${count})`,
        fullFamilies: 'Zobrazit celé rodiny partnerů (nevlastní děti)',
        settingLabel: 'Pohled Potomci',
        settingHint: 'Výchozí zobrazení celých rodin partnerů (jejich další svazky a nevlastní děti, znevýrazněně)',
    },

    // Fan chart (ancestor semicircle)
    fan: {
        generations: 'Generace',
    },

    // Timeline view
    timeline: {
        segment: 'Časová osa',
        wedding: 'Sňatek',
        empty: 'Žádné osoby se známým rokem narození',
        omitted: (n: number) => `${n} ${n === 1 ? 'osoba' : (n < 5 ? 'osoby' : 'osob')} bez roku narození není zobrazena`,
    },

    // Person modal
    personModal: {
        addTitle: 'Přidat osobu',
        editTitle: 'Upravit osobu',
        completeTitle: 'Doplnit osobu',
        enterName: 'Zadejte prosím jméno nebo příjmení',
        unsavedMessage: 'Máte neuložené změny v údajích osoby.',
        invalidDate: 'Neplatné datum. Použijte např. 15.5.1880, 5/1880, 1880 nebo „kolem 1880".',
        photoError: 'Obrázek se nepodařilo zpracovat.',
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

    // Parent→child relationship type
    parentRelType: {
        biological: 'Biologický',
        adoptive: 'Adoptivní',
        step: 'Nevlastní',
        foster: 'Pěstounský',
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
        hiddenPartnersTooltip: 'Další partneři',
        hiddenFamiliesTooltip: 'Další rodiny',
        collapsePartners: 'Sbalit rozbalené partnery',
        collapsePartnersLabel: '−',
        hiddenSiblingsTooltip: 'Sourozenci',
        hiddenParentsTooltip: 'Rodiče',
        hiddenChildrenTooltip: 'Děti',
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

    // Search filters
    searchFilters: {
        toggle: 'Filtry',
        lastName: 'Příjmení',
        place: 'Místo',
        yearFrom: 'Rok od',
        yearTo: 'Rok do',
        anyGender: 'Libovolné pohlaví',
        anyStatus: 'Žijící i zemřelí',
        living: 'Jen žijící',
        deceased: 'Jen zemřelí',
        clear: 'Vymazat',
        resultCount: (n: number) => `${n} výsledků`,
    },

    // Person picker
    personPicker: {
        placeholder: 'Hledat osobu...',
        noResults: 'Žádné odpovídající osoby'
    },

    // Errors
    errors: {
        saveFailed: 'Uložení selhalo — poslední změny nemusí být zapsané! Uvolni místo nebo odemkni šifrování a uprav znovu.',
        parseStoredData: 'Nepodařilo se načíst uložená data',
        invalidJson: 'Neplatný JSON soubor'
    },

    // Partner selection dialog
    partnerSelection: {
        title: 'Vybrat partnera',
        description: (name: string) => `Zobrazit větev vztahů pro ${name}:`
    },

    // Add child - parent selection
    addChild: {
        selectParent: 'Vyberte druhého rodiče',
        selectParentDesc: (name: string) => `${name} má více partnerů. Vyberte druhého rodiče:`,
        newPlaceholder: 'Nová osoba (neznámá)',
        unknownPerson: 'Neznámá osoba'
    },

    // About dialog
    // Small UI tooltips wired via data-i18n-title
    uiTips: {
        centerOnFocus: 'Vycentrovat na zaměřenou osobu',
        showStats: 'Zobrazit statistiku stromu',
        embeddedInfo: 'Informace',
    },

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
        placeholders: 'Zástupné',
        unsupported: 'Nepodporováno',
        saveAsJson: 'Uložit jako JSON',
        saveAsJsonDesc: 'Stáhnout převedená data jako JSON soubor',
        importAsNew: 'Importovat jako nový strom',
        importAsNewDesc: 'Nahradit aktuální strom importovanými daty',
        mergeExisting: 'Sloučit s existujícím',
        mergeExistingDesc: 'Inteligentní sloučení do aktuálního stromu',
        insertToTree: 'Vložit do stromu',
        insertToTreeDesc: 'Načíst převedená data do aktuálního stromu',
        parseError: 'Nepodařilo se zpracovat GEDCOM soubor',
        skippedTags: 'Přeskočené záznamy',
        unknownSex: (n: number) => `${n} ${n === 1 ? 'osoba' : n < 5 ? 'osoby' : 'osob'} s neznámým pohlavím (odvozeno z role v rodině)`,
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
        pendingGate: (n: number) => `${n} ${n === 1 ? 'nejistá shoda zůstala nerozhodnutá' : n < 5 ? 'nejisté shody zůstaly nerozhodnuté' : 'nejistých shod zůstalo nerozhodnutých'} — tito lidé se naimportují jako SAMOSTATNÉ osoby (sloučit je můžeš i později). Pokračovat?`,
        suggestedPrecise: 'navrženo — přesnější datum',
        suggestedComplete: 'navrženo — úplnější hodnota',

        // Manual match dialog
        incomingPerson: 'Příchozí osoba:',

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
        open: 'Otevřít',
        moreActions: 'Další akce',
        searchTrees: 'Hledat strom…',
        pendingSection: 'Rozpracovaná sloučení',
        cannotHideLastVisible: 'Poslední viditelný strom nejde skrýt — nejdřív zobraz jiný strom.',
        activeBadge: 'Aktivní',
        lockedBadge: 'Zamčený',
        hiddenBadge: 'Skrytý',
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
        statsPhotos: 'Fotky',
        statsEvents: 'Události',
        statsSources: 'Prameny',
        statsSourceCoverage: 'Pokrytí prameny',
        statsAttachments: 'Přílohy',
        statsMediaWarning: 'Přes 10 MB médií — soubor už nemusí projít e-mailem',
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
        valEventBirthDeath: 'Narození/úmrtí zadané jako životní událost (patří do datumových polí)',
        valEventNoLabel: 'Vlastní událost nemá název',
        valEventBadDate: 'Událost má neplatné datum',
        valDeathBeforeBirth: 'Datum úmrtí je před narozením',
        valImplausibleLifespan: 'Nepravděpodobně dlouhý život',
        valEventBeforeBirth: 'Událost datovaná před narozením',
        valEventAfterDeath: 'Událost datovaná po úmrtí',
        valWeddingBeforeBirth: 'Svatba datovaná před narozením partnera',
        valWeddingAfterDeath: 'Svatba datovaná po úmrtí partnera',
        valChildMarriage: 'Sňatek v dětském věku',
        valChildAfterMotherDeath: 'Dítě narozené po smrti matky',
        valChildAfterFatherDeath: 'Dítě narozené dlouho po smrti otce',
        valCitationMissingSource: 'Citace odkazuje na neexistující pramen',
        valAttachmentNoData: 'Příloha nemá použitelná data',
        valPartnerAgeGap: 'Extrémní věkový rozdíl partnerů',
        valFix: 'Opravit',
        valFixAll: 'Opravit vše',
        valFixed: (count: number) => `Opraveno ${count} ${count === 1 ? 'problém' : count < 5 ? 'problémy' : 'problémů'}`,
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
        exportAllAppDesc: 'Samostatný HTML se všemi stromy',
        // Tree visibility
        showTree: 'Zobrazovat strom',
        hideTree: 'Nezobrazovat strom',
        showTreeHint: 'Zobrazit strom',
        hideTreeHint: 'Skrýt strom',
        hiddenLabel: '(skrytý)'
    },

    // Collaboration: send to a relative
    share: {
        menuItem: '📩 Poslat příbuznému',
        menuDesc: 'Jeden soubor e-mailem — příjemce ho otevře, doplní a pošle zpět',
        passwordLabel: 'Heslo (volitelné)',
        dialogTitle: 'Poslat příbuznému',
        dialogIntro: 'Vytvoří jeden soubor, který pošleš e-mailem. Příjemce ho jen otevře — bez instalace a bez účtu.',
        scopeLabel: 'Co poslat',
        scopeWhole: 'Celý strom',
        scopeBranch: 'Aktuální pohled (viditelná větev)',
        senderNameLabel: 'Tvoje jméno (uvidí ho příjemce)',
        messageLabel: 'Vzkaz pro příjemce',
        messagePlaceholder: 'Ahoj! Doplníš prosím, co víš o vaší větvi?',
        createFile: 'Vytvořit soubor k poslání',
        welcomeTitle: (sender: string) => `${sender} ti poslal(a) rodinný strom`,
        welcomeCounts: (tree: string, persons: number) => `„${tree}“ · ${persons} osob`,
        welcomeView: 'Jen se podívat',
        welcomeEdit: 'Doplnit, co vím',
        collabBar: (sender: string) => `Doplňuješ strom pro: ${sender}.`,
        collabSend: 'Poslat soubor zpět',
        collabHide: 'Skrýt',
        collabBadgeTitle: 'Probíhá spolupráce',
        replyTitle: (sender: string) => `${sender} vrací tvůj strom`,
        replyIntro: (tree: string) => `Tento soubor odpovídá na tvůj sdílený strom „${tree}“. Sloučit doplněné údaje?`,
        replyMerge: 'Prohlédnout a sloučit',
        replyView: 'Nejdřív se podívat',
        replyImport: 'Importovat jako nový strom',
        unknownSender: 'Příbuzný'
    },

    // Change packets (send only changes)
    shareDiff: {
        scopeChanges: 'Jen změny od posledního sdílení',
        packetSaved: 'Soubor se změnami uložen',
        noChanges: 'Od posledního sdílení se nic nezměnilo',
        baselineMissing: 'Chybí baseline pro tyto změny — vyžádej si radši celý soubor',
        treeNotFound: 'Žádný odpovídající strom pro tyto změny — vyžádej si od odesílatele celý soubor',
    },

    // View Mode (embedded data)
    viewMode: {
        banner: 'Režim prohlížení (pouze pro čtení)',
        bannerDetail: 'Vyberte jak pokračovat:',
        goOnline: 'Přejít na stromapp.info',
        goOnlineHint: 'Doporučeno',
        stayOffline: 'Zůstat s tímto souborem',
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

    // Cross-tree links
    crossTree: {
        badgeTitle: (count: number) => `Nalezeno v ${count} ${count === 1 ? 'jiném stromu' : count < 5 ? 'jiných stromech' : 'jiných stromech'}`,
        tooltipHeader: 'Také v:',
        clickToSwitch: 'Kliknutím přepnout'
    },

    // Embedded Mode (local HTML file)
    embeddedMode: {
        banner: 'Samostatný soubor',
        bannerDetail: 'Tento soubor má vlastní oddělené úložiště dat.',
        goOnline: 'stromapp.info',
        exportJson: 'Exportovat JSON',
        exportJsonDesc: 'Pro import do webové aplikace',
        saveFile: 'Uložit soubor',
        saveFileTitle: 'Stáhnout soubor s aktuálními daty',
        unsavedWarning: 'Máte neuložené změny. Použijte "Uložit soubor" pro jejich zachování.',
        infoTitle: 'O tomto souboru',
        infoText1: 'Toto je samostatný HTML soubor. Vaše data se ukládají do úložiště tohoto prohlížeče.',
        infoText2: 'Webová aplikace na stromapp.info má vlastní oddělené úložiště. Data se mezi nimi NESYNCHRONIZUJÍ.',
        infoHow: 'Vaše možnosti:',
        infoStayOffline: 'Pokračovat s tímto souborem',
        infoStayOfflineDesc: 'Vaše data zůstávají v tomto prohlížeči. Použijte "Uložit soubor" pro stažení kopie se změnami.',
        infoGoOnline: 'Přejít na stromapp.info',
        infoGoOnlineDesc: 'Používat webovou aplikaci. Pro přenos dat budete muset tento soubor importovat.'
    },

    // Import from offline version (intro text in new tree menu)
    importFromOffline: {
        description: 'Vítejte na stromapp.info! Pro pokračování s vašimi daty importujte soubor, se kterým jste pracovali.'
    },

    // Lock
    lock: {
        lockPerson: 'Zamknout',
        unlockPerson: 'Odemknout',
        lockTree: 'Zamknout strom',
        unlockTree: 'Odemknout strom',
        lockedTooltip: 'Zamčeno'
    },

    // Audit Log
    auditLog: {
        title: 'Historie změn',
        empty: 'Zatím žádné záznamy.',
        clear: 'Vyčistit historii',
        clearConfirm: 'Vyčistit celou historii změn? Toto nelze vrátit zpět.',
        entries: (count: number) => `${count} ${count === 1 ? 'záznam' : count < 5 ? 'záznamy' : 'záznamů'}`,
        enableSetting: 'Historie změn',
        enabled: 'Historie změn zapnuta',
        disabled: 'Historie změn vypnuta',
        viewLog: 'Historie změn',
        exportInclude: 'Zahrnout historii změn',
        exportTxt: 'Export TXT',
        // Action descriptions
        createdPerson: (name: string) => `Vytvořena osoba: ${name}`,
        createdPlaceholder: (gender: string) => `Vytvořen zástupce (${gender})`,
        updatedPerson: (name: string, fields: string) => `Aktualizace ${name}: ${fields}`,
        deletedPerson: (name: string) => `Smazána osoba: ${name}`,
        createdPartnership: (p1: string, p2: string, status: string) => `Vytvořen vztah: ${p1} & ${p2} (${status})`,
        updatedPartnership: (p1: string, p2: string) => `Aktualizován vztah: ${p1} & ${p2}`,
        removedPartnership: (p1: string, p2: string) => `Odebrán vztah: ${p1} & ${p2}`,
        addedParentChild: (parent: string, child: string) => `Přidán rodič-dítě: ${parent} → ${child}`,
        addedFamily: (name: string, count: number) => `Přidána rodina kolem ${name} (${count} nových)`,
        removedParentChild: (parent: string, child: string) => `Odebrán rodič-dítě: ${parent} → ${child}`,
        mergedPersons: (removed: string, kept: string, details: string) => `Sloučeny osoby: ${removed} → ${kept}${details ? ' (' + details + ')' : ''}`,
        clearedData: (persons: number, partnerships: number) => `Vymazána data: ${persons} osob, ${partnerships} vztahů`,
        loadedData: (persons: number, partnerships: number) => `Načtena data: ${persons} osob, ${partnerships} vztahů`,
        // Batch summaries
        addedChild: (parent: string, child: string) => `Přidáno dítě: ${parent} → ${child}`,
        addedParent: (parent: string, child: string) => `Přidán rodič: ${parent} → ${child}`,
        addedSibling: (person: string, sibling: string) => `Přidán sourozenec: ${person} + ${sibling}`,
        addedPartner: (person: string, partner: string) => `Přidán partner: ${person} & ${partner}`,
        // Tree merge
        treeMerge: (merged: number, added: number, source: string) => `Sloučení stromů z "${source}": ${merged} sloučeno, ${added} přidáno`,
        // Auto-repair
        repairedIssue: (desc: string) => `Automatická oprava: ${desc}`,
        restoredBackup: 'Obnovena záloha',
        // Life events
        addedEvent: (name: string) => `Přidána událost k ${name}`,
        updatedEvent: (name: string) => `Upravena událost u ${name}`,
        removedEvent: (name: string) => `Odebrána událost u ${name}`,
        addedSource: (title: string) => `Přidán pramen „${title}"`,
        updatedSource: (title: string) => `Upraven pramen „${title}"`,
        removedSource: (title: string) => `Odebrán pramen „${title}"`,
        citedSource: (name: string) => `Přidána citace u ${name}`,
        uncitedSource: (name: string) => `Odebrána citace u ${name}`,
        addedAttachment: (name: string) => `Přidána příloha k ${name}`,
        removedAttachment: (name: string) => `Odebrána příloha u ${name}`,
        updatedAttachment: (name: string) => `Upravena příloha u ${name}`,
        setParentRelType: (parent: string, child: string) => `Nastaven typ vztahu ${parent} → ${child}`,
        // Undo / redo
        undoAction: (desc: string) => `Zpět: ${desc}`,
        redoAction: (desc: string) => `Znovu: ${desc}`
    },

    // Undo / redo
    undo: {
        undo: 'Zpět',
        redo: 'Znovu',
        addPerson: (name: string) => `přidání osoby ${name}`,
        editPerson: (name: string) => `úprava osoby ${name}`,
        clearedData: 'smazání všech dat',
        loadedData: 'import dat',
        repairedIssue: 'oprava z validace',
        deletePerson: (name: string) => `smazání osoby ${name}`,
        addPartnership: (a: string, b: string) => `partnerství ${a} & ${b}`,
        editPartnership: (a: string, b: string) => `úprava partnerství ${a} & ${b}`,
        removePartnership: (a: string, b: string) => `odebrání partnerství ${a} & ${b}`,
        addRelation: (parent: string, child: string) => `propojení ${parent} → ${child}`,
        removeRelation: (parent: string, child: string) => `zrušení vazby ${parent} → ${child}`,
        addFamily: (name: string) => `přidání rodiny kolem ${name}`,
        mergePersons: (name: string) => `sloučení do ${name}`,
        addEvent: (name: string) => `událost u ${name}`,
        editEvent: (name: string) => `úprava události u ${name}`,
        removeEvent: (name: string) => `odebrání události u ${name}`,
        restoreBackup: 'obnovení zálohy',
        addSource: (title: string) => `pramen „${title}"`,
        editSource: (title: string) => `úprava pramene „${title}"`,
        removeSource: (title: string) => `odebrání pramene „${title}"`,
        cite: (name: string) => `citace u ${name}`,
        uncite: (name: string) => `odebrání citace u ${name}`,
        addAttachment: (name: string) => `příloha u ${name}`,
        removeAttachment: (name: string) => `odebrání přílohy u ${name}`,
        editAttachment: (name: string) => `úprava přílohy u ${name}`,
        setParentRelType: (child: string) => `typ vztahu u ${child}`,
        undone: (desc: string) => `Vráceno: ${desc}`,
        redone: (desc: string) => `Znovu provedeno: ${desc}`,
        nothingToUndo: 'Není co vrátit',
        nothingToRedo: 'Není co zopakovat'
    },

    // Living-person privacy filter for exports
    privacy: {
        livingPerson: 'Žijící osoba',
        label: 'Soukromí žijících osob',
        tooltip: 'Skryje údaje o osobách, které pravděpodobně žijí, když strom opouští rodinu. Struktura zůstane zachována.',
        modeFull: 'Plná data',
        modeInitials: 'Iniciály + rok narození',
        modeAnonymous: 'Skrýt jména',
        modeMinimal: 'Ponechat jen příjmení',
        stripPhotos: 'Exportovat bez fotek a příloh'
    },

    // Poster export (SVG / PNG / tiled PDF)
    poster: {
        menu: 'Export plakátu',
        title: 'Export jako plakát',
        description: 'Exportuj aktuální strom jako vektor, obrázek nebo tisknutelný plakát na více stran.',
        svg: 'SVG (vektor)',
        svgDesc: 'Škálovatelný vektor, otevře se v prohlížeči nebo Inkscape',
        png: 'PNG (obrázek)',
        pngDesc: 'Rastrový obrázek ve vysokém rozlišení',
        pdf: 'Tisk / PDF (dlaždice)',
        pdfDesc: 'Tisk na více stran se značkami pro slepení',
        format: 'Formát papíru',
        orientation: 'Orientace',
        portrait: 'Na výšku',
        landscape: 'Na šířku',
        empty: 'Není co exportovat — nejdřív otevři strom.',
        pngScaledDown: 'Obrázek byl zmenšen kvůli limitu velikosti.',
        pngError: 'Obrázek se nepodařilo vytvořit.',
        pageLabel: (row: number, col: number) => `řádek ${row} · sloupec ${col}`,
        guideOption: 'Přidat úvodní stranu s návodem na slepení',
        guideTitle: 'Návod na slepení',
        guideInfo: (pages: number, rows: number, cols: number, overlap: number) =>
            `${pages} listů (${rows} × ${cols}), přesah ${overlap} mm — slepte podle mřížky níže.`,
        emptySheet: 'prázdný — netiskne se'
    }
};

// Language dictionary
const languagePacks: Record<Language, StringsType> = {
    en: stringsEN,
    cs: stringsCZ
};

/** Get the full string pack for a specific language (used by the family book). */
export function getStringsForLang(lang: 'cs' | 'en'): StringsType {
    return languagePacks[lang];
}

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
