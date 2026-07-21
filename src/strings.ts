/**
 * UI Strings - Multi-language support
 */

export type Language = 'en' | 'cs' | 'de';

export const SUPPORTED_LANGUAGES: { code: Language; name: string }[] = [
    { code: 'en', name: 'English' },
    { code: 'cs', name: 'Čeština' },
    { code: 'de', name: 'Deutsch' }
];

// Type definition for strings structure
type StringsType = typeof stringsEN;

const stringsEN = {
    // Toolbar
    toolbar: {
        title: 'Strom',
        // The "+" affordance is drawn by the button markup (glyph span), so the
        // label itself carries no leading plus — avoids a double plus.
        addPerson: 'Add Person',
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
        exportFocus: 'Export this view',
        exportSelection: 'Export',
        poster: 'Poster…',
        makeTree: 'Make a tree',
        makeTreeFromView: 'Make a tree from this view',
        makeTreeFromViewDesc: 'Create a new tree in the app from the shown people',
        splitFamilies: 'Split into families…',
        splitFamiliesHint: 'Cut one connected tree into a tree per family — by surname lines, or by branches.',
        mergeViewInto: 'Merge into…',
        actions: 'Actions',
        treeActions: 'Tree:',
        sectionCurrentView: 'Current view',
        sectionTree: 'Tree',
        sectionEdits: 'Edits',
        sectionView: 'View',
        sectionApp: 'App',
        exportFocusDesc: 'Download the shown people as a JSON file',
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

    // Mobile menu
    mobileMenu: {
        addPerson: 'Add Person',
        export: 'Export',
        import: 'Import',
        newTree: 'New Tree',
        more: 'More'
    },

    // Empty state
    emptyState: {
        title: 'Welcome to Strom',
        subtitle: 'Start building your family tree',
        addFirst: 'Add First Person',
        importFromFile: 'I have data elsewhere (GEDCOM from MyHeritage, Ancestry…)',
        youCard: 'you?'
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
        toolbarPrint: 'Print',
        toolbarClose: 'Close',
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
        delete: 'Delete',
        deleteConfirm: (what: string) => `Delete this backup? The tree itself is not touched.${what ? `\n\n${what}` : ''}`,
        deleted: 'Backup deleted',
        inBrowser: 'Backups live in this browser, not in your tree file — they never make it bigger, and they are gone if you clear the browser or move to another computer. Export the tree for a backup you can keep.',
        menu: 'Backups',
        title: 'Backup history',
        empty: 'No backups yet',
        createNow: 'Create backup now',
        restore: 'Restore',
        download: 'Download',
        restored: 'Backup restored',
        created: 'Backup created',
        restoreConfirm: (what: string) => `Restore this backup? It overwrites the current tree — the current state is saved as a backup first.${what ? `\n\n${what}` : ''}`,
        total: (count: number, size: string) => `${count} backups · ${size}`,
        colDate: 'Date',
        colReason: 'Reason',
        colPersons: 'People',
        persons: (count: number) => count === 1 ? '1 person' : `${count} people`,
        colSize: 'Size',
        reasons: {
            auto: 'Automatic',
            manual: 'Manual',
            'pre-import': 'Before import',
            'pre-merge': 'Before merge',
        },
    },

    split: {
        postImportTitle: 'Several families in one file',
        postImport: (count: number) =>
            `The file you imported holds ${count} families that nothing connects — no parent, child or marriage leads from one to another. Each could be a tree of its own.`,
        unrelated: (count: number) => `Holds ${count} families that nothing connects`,
        unrelatedHint: 'Split them in Manage trees → ⋯ → Separate disconnected parts.',
        menu: 'Separate disconnected parts…',
        menuHint: 'Trees for islands nothing connects — no parent, child or marriage between them.',
        title: 'Disconnected parts of this tree',
        intro: 'This tree holds families that nothing connects — no parent, child or marriage leads from one to another. Each can become a tree of its own.',
        single: 'Everyone in this tree is connected — there is one family here, so there is nothing to split.',
        familyName: (surname: string) => `${surname} family`,
        persons: (count: number) => count === 1 ? '1 person' : `${count} people`,
        oldest: (name: string, year: number) => `oldest ${name} (${year})`,
        noSurname: 'no surname',
        alone: 'Linked to nobody',
        selected: (count: number) => `Split off ${count}`,
        keepsOriginal: 'The original tree stays as it is — delete it yourself once you are happy with the split.',
        done: (count: number) => `${count} trees created. The original is untouched.`,
    },
    splitFamilies: {
        title: 'Split into families',
        intro: 'The families this tree contains. Choose what counts as one family below; the same tree then always splits the same way — the person you were looking at just decides which family is listed first and how the connections read. Every person ends up in exactly one tree.',
        // The two ways to cut (SplitMode): surname lines vs. in-law branches.
        modeLabel: 'What counts as one family',
        modeSurname: 'Surname lines',
        modeLineage: 'Branches',
        modeSurnameHint: 'One family = one surname line: children belong to the parent whose surname they carry, from the founder down to the last bearer. A spouse with no family of their own in this tree stays with their partner.',
        modeLineageHint: 'One family = a branch the way the tree grew: the main line with everyone who married into it, and each in-law branch hanging off it.',
        modePerspective: 'One person\'s view',
        modePerspectiveHint: 'The base tree is the chosen person\'s own line: direct ancestors, their blood siblings, own siblings and all descendants. Sibling families you keep stay in it; the rest split into neighbouring trees. Unlike the other two cuts, this one depends on the chosen people.',
        perspDepthLabel: 'Keep sibling families down to',
        perspDepthCousins: 'first cousins (parents\' siblings)',
        perspDepthSecond: 'second cousins (grandparents\' siblings)',
        perspDepthNone: 'no one (direct line only)',
        perspBasesLabel: 'Base trees from the view of',
        perspAddPerson: 'Add a person…',
        perspCutsLabel: (n: number) => `Cuts at siblings (${n})`,
        perspCutHint: 'Ticked = that sibling stays alone in the base tree and their family becomes a neighbouring tree. Untick to keep the family in the base tree.',
        oneFamilyInMode: 'Seen this way, the whole tree is one family — nothing to split.',
        familyName: (name: string) => `${name} family`,
        focusHere: 'Selected person',
        connectsTo: (name: string) => `connected through ${name}`,
        persons: (count: number) => count === 1 ? '1 person' : `${count} people`,
        // "3 people", "1 person + 8 unknown" — real people counted plainly, the
        // unknown (placeholder) relatives stated separately so a family that is
        // mostly unknowns never reads as a big family.
        unknown: (count: number) => `${count} unknown`,
        personsWithUnknown: (real: number, unknown: number) => {
            const r = real === 1 ? '1 person' : `${real} people`;
            return unknown > 0 ? `${r} + ${unknown} unknown` : r;
        },
        namePlaceholder: 'Tree name',
        preview: 'Preview',
        summary: (trees: number, real: number, unknown: number) =>
            `${trees} trees · ${real} people${unknown > 0 ? ` + ${unknown} unknown` : ''} · 100% covered`,
        create: (count: number) => count === 1 ? 'Create 1 tree' : `Create ${count} trees`,
        cancel: 'Cancel',
        keepsOriginal: 'The original tree is left exactly as it is. The new trees stay linked across their shared people — delete any you do not want in Manage trees.',
        done: (count: number) => count === 1 ? '1 tree created' : `${count} trees created`,
        tooSmall: 'This tree holds only one family — there is nothing to split.',
        // Person-picker step (splitting a tree that is not the one on screen — no
        // live focus, so the user names the person whose family to list first).
    },

    advanced: {
        settingLabel: 'Advanced fields',
        settingHint: 'Show sources, attachments, reference numbers, name spellings and open questions on a person. Off by default — a person you already filled one in for always shows it.',
    },

    surnames: {
        menu: 'Surname spellings',
        title: 'Surname spellings',
        intro: 'Before about 1900 the registers spell a family differently from one entry to the next. Say once that spellings mean the same family and search and merging find them all — however each person happens to be written, including people you add later.',
        groupsTitle: 'Linked spellings',
        none: 'No spellings linked yet.',
        addTitle: 'Link spellings',
        addHint: 'Pick the spellings that mean one family.',
        inTree: (count: number) => count === 1 ? '1 person' : `${count} people`,
        notInTree: 'not in the tree',
        addOther: 'Other spelling…',
        link: 'Link them',
        unlink: 'Unlink',
        linked: 'Spellings linked.',
    },

    events: {
        occupationLabel: 'Occupation / trade',
        occupationHint: 'The trade itself — "blacksmith", not "worked in Kladno as a blacksmith". It goes out as the occupation in GEDCOM.',
        participants: 'Godparents & witnesses',
        participantsHint: 'Who else the record names. A godparent who keeps turning up is usually a relative.',
        addParticipant: '+ Add',
        participantName: 'Name as written',
        participantNote: 'Detail (trade, "neighbour"…)',
        participantLink: 'Link to someone in the tree',
        participantUnlink: 'Not this person',
        participantInTree: 'in the tree',
        participantNameRequired: 'Give a name, or link someone from the tree.',
        roles: {
            godparent: 'Godparent',
            witness: 'Witness',
            officiant: 'Officiant',
            other: 'Present',
        },
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
        deleteConfirm: (what: string) => `Delete this event?\n\n${what}`,
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
        citePartnership: 'Cite source (marriage record…)',
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
        deleteConfirm: (title: string, n: number) =>
            n > 0
                ? `Delete this source? It is cited in ${n} place(s); those citations will be removed.\n\n${title}`
                : `Delete this source?\n\n${title}`,
    },

    // Attachments
    attachments: {
        title: 'Attachments',
        add: 'Add attachment',
        empty: 'No attachments yet',
        delete: 'Delete',
        deleteConfirm: (what: string) => `Delete this attachment?\n\n${what}`,
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

    // Sticky generation labels
    genLabels: {
        settingLabel: 'Generation labels',
        settingHint: 'Pin generation names to the left edge of the canvas',
    },

    // Branch colour coding
    branchColors: {
        settingLabel: 'Branch colours',
        legendLabel: 'Tree legend',
        legendHint: 'Show the legend over the tree (gender rings, branch colours)',
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
        step2: 'Hovering a card reveals quick-add buttons: parent above, partner on the right, child below. The chain-link tab on the top edge manages partnerships and parents; adding a sibling lives in the card menu.',
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
        largestFamily: 'Largest family',
        childrenCount: (n: number) => n === 1 ? '1 child' : `${n} children`,
        months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    },

    // Anniversaries + "on this day"
    anniversaries: {
        deathHint: 'Also show yearly death anniversaries',
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
        deathAnniversary: (name: string, years: number) => `${name} — ${years} years since death`,
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
        nameVariants: 'Other spellings of the name',
        nameVariantsHint: 'How the registers actually write it (Wischek, Vissek), an alias, or the farm the family was known by. Separate with commas. Search and merge find the person under any of them. Applies to this person only — surname spellings shared by the whole family belong in Manage trees → Surname spellings.',
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
        photoRotateLeft: 'Rotate left',
        photoRotateRight: 'Rotate right',
        maidenName: 'Maiden Name',
        refn: 'Reference number',
        question: 'Open question',
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
        alsoWritten: 'also written',
        age: 'Age',
        born: 'Born',
        died: 'Died',
        notes: 'Notes',
        // Age in parentheses on the death line of the hover card.
        yearsOld: (age: number) => `(${age} ${age === 1 ? 'year' : 'years'})`,
        // Child count on the relationship line of the hover card.
        childrenCount: (n: number) => `${n} ${n === 1 ? 'child' : 'children'}`,
        // Footer of the hover card: the real desktop gesture (click opens the menu).
        gestureHint: 'Click to open the menu',
    },

    // Placeholders
    placeholders: {
        nameVariants: 'Wischek, Vissek, u Kováře',
        firstName: 'First name',
        lastName: 'Last name',
        maidenName: 'Maiden name',
        refn: 'e.g. archive box 12, or an id from another program',
        question: 'e.g. does anyone know her birth date?',
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
        map: 'Map',
        toggle: 'Family / descendants view',
        back: 'Back to family view',
        badgeLabel: 'Descendants:',
        badgeCount: (count: number) => count === 1 ? '1 person' : `${count} people`,
        bloodOnly: {
            label: 'Blood only',
            short: 'Blood',
            hint: 'Show partners and step-families too',
        },
        fullFamilies: {
            label: 'Whole families',
            short: 'Families',
            hint: 'Show only blood descendants',
        },
        settingLabel: 'Descendants view',
        settingHint: "Show partners' whole families by default (their other unions and step-children, de-emphasized)",
    },

    // Fan chart (ancestor semicircle)
    map: {
        fit: 'Fit all places',
        zoomIn: 'Zoom in',
        zoomOut: 'Zoom out',
        scopeView: 'This view',
        scopeTree: 'Whole tree',
        noPlaces: 'None of the people shown have a place filled in yet.',
        noPlacesAtAll: 'This tree has no places filled in yet.',
        offline: 'No internet, so the map picture cannot load. The coordinates you already have stay in your tree.',
        missing: (shown: number, missing: number) =>
            shown > 0
                ? `${strings.map.placeCount(shown)} on the map, ${missing} without coordinates.`
                : `${strings.map.placeCount(missing)} with no coordinates yet.`,
        lookUp: (count: number) => `Look up ${strings.map.placeCount(count)}`,
        placeCount: (count: number) => `${count} ${count === 1 ? 'place' : 'places'}`,
        managePlaces: 'Places',
        allPlaced: (count: number) => `${strings.map.placeCount(count)} on the map.`,
        placesTitle: 'Places',
        placesIntro: 'Rename a place to fix it everywhere in the tree at once. To put one on the map, search under a name the map knows — the nearest town usually works. Only the coordinates are attached; the place keeps the name your family wrote.',
        nameLabel: 'Place name, as used in the tree',
        rename: 'Rename',
        renamed: (count: number) => `Renamed in ${count} ${count === 1 ? 'place' : 'places'}.`,
        notOnMap: 'Not on the map yet',
        findOnMap: 'Find on the map',
        changePin: 'Change',
        removePin: 'Remove',
        cleanOrphans: (count: number) => `Clean orphaned places (${count})`,
        cleanOrphansConfirm: (count: number) =>
            `Remove saved coordinates for ${count} ${count === 1 ? 'place' : 'places'} nobody in this tree uses any more? Nothing your family wrote is touched — only the leftover map pins go. This can be undone.`,
        cleanOrphansDone: (count: number) => `Removed ${count} orphaned ${count === 1 ? 'place' : 'places'}.`,
        wrongSpot: 'Wrong spot? Fix this place',
        usedBy: (count: number) => count === 1 ? '1 person' : `${count} people`,
        search: 'Search',
        searchLabel: 'Search for this place under another name',
        searching: 'Searching…',
        noCandidates: 'Nothing found. Try the nearest town, or add the country.',
        matched: (label: string) => label ? `Matched to ${label}` : 'Matched',
        geocodingProgress: (done: number, total: number, place: string) =>
            `Looking up places… ${done}/${total} (${place})`,
        done: (found: number) => `${strings.map.placeCount(found)} placed on the map.`,
        doneWithMisses: (found: number, missed: number) =>
            `${strings.map.placeCount(found)} placed. ${missed} could not be found — check the spelling, or add the country.`,
        consentTitle: 'Look up coordinates online?',
        consentBody: (count: number, service: string) =>
            `To draw the map, ${count} place ${count === 1 ? 'name' : 'names'} (for example "Prague") will be sent to ${service}. `
            + 'Nothing else leaves the app — no names, dates or relations of your family. '
            + 'The coordinates are saved into your tree, so each place is looked up only once and the map works offline afterwards.',
        consentConfirm: 'Look them up',
        settingLabel: 'Look up places online',
        settingHint: 'Allows the map to send place names to a geocoding service. Coordinates already found stay in your tree.',
        tilesNotice: 'The map background is drawn from openstreetmap.org — loading it tells that server which area you are viewing, nothing more. Your family data stays in the app.',
        tilesNoticeOk: 'Show the map',
        timeMode: 'Migration over time',
        timeModeEmpty: 'Add dates (birth, death, events) to trace the family’s migration over time.',
        timePlay: 'Play',
        timePause: 'Pause',
        timeYear: 'Year',
        timeUndated: (n: number) =>
            `${n} ${n === 1 ? 'place' : 'places'} without a date ${n === 1 ? 'is' : 'are'} not shown on the timeline.`,
    },

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

    // Tree health dashboard (R4)
    treeHealth: {
        menu: 'Tree health',
        title: (name: string) => `Tree health: ${name}`,
        empty: 'This tree has no people yet.',
        // Validation summary block
        sectionValidation: 'Consistency',
        allGood: 'No inconsistencies found',
        countErrors: (n: number) => `${n} ${n === 1 ? 'error' : 'errors'}`,
        countWarnings: (n: number) => `${n} ${n === 1 ? 'warning' : 'warnings'}`,
        countInfos: (n: number) => `${n} ${n === 1 ? 'note' : 'notes'}`,
        topIssues: 'Top issues',
        moreIssues: (n: number) => `and ${n} more…`,
        // Completeness block
        sectionCompleteness: 'Data completeness',
        completenessHint: 'Share of people with each fact recorded.',
        fieldBirthDate: 'Birth date',
        fieldBirthPlace: 'Birth place',
        fieldDeathDate: 'Death date',
        fieldPhoto: 'Photo',
        // Structure block
        sectionStructure: 'Structure',
        statPeople: 'People',
        statUnions: 'Unions',
        statGenerations: 'Generations',
        statIslands: 'Separate families',
        islandsOne: 'All people are connected into one family.',
        islandsMany: (n: number) => `This tree holds ${n} separate families with no link between them.`,
        islandItem: (surname: string, count: number) => `${surname} — ${count} ${count === 1 ? 'person' : 'people'}`,
        islandUnnamed: 'Unnamed family',
        islandsSplitHint: 'Use “Split into families” below to give each its own tree.',
        // Quick actions
        sectionActions: 'Quick actions',
        actionValidate: 'Validation details',
        actionCleanPlaces: (n: number) => n > 0 ? `Clean orphan places (${n})` : 'Clean orphan places',
        actionSplit: 'Split into families',
        // Actions that change data act on the active tree; disabled otherwise.
        switchFirst: 'Switch to this tree first',
    },

    // Person modal
    personModal: {
        birthEstimate: (year: number) => `Born no later than ~${year} (from other dates)`,
        birthEstimateApply: 'use',
        addTitle: 'Add Person',
        editTitle: 'Edit Person',
        completeTitle: 'Complete Person',
        enterName: 'Please enter first name or last name',
        unsavedMessage: 'You have unsaved changes in person details.',
        invalidDate: 'Invalid date. Use e.g. 5/15/1880, 5/1880, 1880 or "about 1880".',
        photoError: 'Could not process the image.',
        // Header + section labels (Letopis redesign)
        newPersonName: 'New person',
        sectionBasic: 'Basic info',
        sectionBirth: 'Birth',
        sectionRelations: 'Relationships',
        sectionDeathEvents: 'Death and other events',
        sectionSources: 'Sources and attachments',
        sectionPhotoNotes: 'Photo and notes',
        // Life timeline (R2) — read-only mini-timeline of the person's life
        sectionLifeline: 'Life timeline',
        lifelineBorn: 'Born',
        lifelineDied: 'Died',
        lifelineMarried: (name: string) => `Married ${name}`,
        lifelineMarriedUnknown: 'Married',
        lifelineChild: (name: string) => `Child born: ${name}`,
        lifelineChildUnknown: 'Child born',
        lifelineWith: (names: string) => `with ${names}`,
        dateHint: '5/15/1880 · 5/1880 · 1880 · about 1880',
        deletePerson: 'Delete person…',
        // Live summaries shown next to each section header
        sumParents: 'parents',
        sumPartners: (n: number) => n === 1 ? '1 partner' : `${n} partners`,
        sumChildren: (n: number) => n === 1 ? '1 child' : `${n} children`,
        sumEvents: (n: number) => n === 1 ? '1 event' : `${n} events`,
        sumDeceased: 'deceased',
        sumCitations: (n: number) => n === 1 ? '1 citation' : `${n} citations`,
        sumScans: (n: number) => n === 1 ? '1 scan' : `${n} scans`,
        sumPhoto: 'photo',
        sumNote: 'note',
        sumNone: 'empty',
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
    card: {
        // Short one-word labels for the hover add-tab pills.
        addTabParent: 'parent',
        addTabPartner: 'partner',
        addTabChild: 'child',
        // Chain-link edge tab (manage partnerships/parents) expanded label.
        relTab: 'relations',
        // Lowercase inline word for the detailed card's "years · age" meta row.
        ageWord: 'age',
    },
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
        back: 'Back to previous person (Alt+←)',
        forward: 'Forward (Alt+→)',
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
        // Short labels inside the card branch-tab pills (glyph + text).
        branchTabParents: 'parents',
        branchTabSiblings: 'siblings',
        branchTabChildren: 'family',
        personCount: (visible: number, total: number) => `${visible} of ${total} persons`
    },

    // Generation guide labels (small-caps rules on the canvas, relative to focus)
    generationLabels: {
        grandparents: 'GRANDPARENTS',
        parents: 'PARENTS',
        focus: 'FOCUS GENERATION',
        children: 'CHILDREN',
        grandchildren: 'GRANDCHILDREN',
        generationN: (offset: number) => `GENERATION ${offset > 0 ? '+' : '−'}${Math.abs(offset)}`,
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
        selectPerson: 'Select person',
        shortcutHint: '/',
        shortcutAria: 'Press / to search',
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
        importAsNew: 'Import as a new tree',
        importAsNewDesc: 'Add as a separate tree (your current tree stays)',
        mergeExisting: 'Merge with Existing',
        mergeExistingDesc: 'Smart merge into current tree',
        insertToTree: 'Insert into Tree',
        insertToTreeDesc: 'Load converted data into current tree',
        parseError: 'Failed to parse GEDCOM file',
        skippedTags: 'Skipped records',
        unknownSex: (n: number) => `${n} person${n === 1 ? '' : 's'} with unknown sex (gender inferred from family role)`,
        otherFamilyLinks: (n: number) =>
            `${n} ${n === 1 ? 'child was' : 'children were'} recorded in more than one family `
            + `(e.g. adopted); shown with the birth family, the rest noted on the person`,
        photos: 'Photos',
        documents: 'Documents',
        sources: 'Sources',
        events: 'Events',
        notes: 'Notes',
        allImported: 'Everything in the file was imported.',
        viewCutTooSmall: 'Show more people (family or descendants view) before making a tree from the view.',
        viewCutName: (name: string) => `${name} — selection`,
        externalMedia: (n: number) => `The file references ${n} external media file${n === 1 ? '' : 's'} (platforms export photos as a separate folder/zip — unpack it first).`,
        attachMedia: 'Attach media files…',
        downloadMedia: 'Download photos from the internet',
        downloading: (done: number, total: number) => `Downloading photos… ${done}/${total}`,
        mediaAttached: (matched: number, total: number) => `Attached ${matched} of ${total} referenced files.`,
        mediaNoMatch: 'None of the selected files match the referenced names.',
    },

    // Notes the GEDCOM importer writes into the data itself (persisted). Built
    // in the app's CURRENT language at import time — English source above.
    gedcomNotes: {
        altBirth: 'Birth (alternative record)',
        altDeath: 'Death (alternative record)',
        remarriage: (divorced: string, married: string) => `Divorced ${divorced}, married again ${married}`,
        remarriageNoDate: (married: string) => `Divorced, married again ${married}`,
        engagement: (date: string) => `Engagement: ${date}`,
        association: (name: string, label: string) => `Association: ${name} (${label})`,
        email: (value: string) => `E-mail: ${value}`,
        adoptedChild: 'adopted child',
        fosterChild: 'foster child',
        child: 'child',
        parentAnd: ' and ',
        alsoRecorded: (kind: string, parents: string) => `Also recorded as ${kind} of ${parents}.`,
        alsoRecordedNoParents: (kind: string) => `Also recorded as ${kind} in another family.`,
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
        skip: 'Skip',
        unskip: 'Un-skip',
        skipped: 'Skipped',
        skipTooltip: 'Don\'t bring this person at all — neither merged nor added (unlike Reject, which imports them as a new person).',
        statsSkipped: 'Skipped',
        skippedCount: (n: number) => `${n} skipped`,
        changeMatch: 'Change',
        manualMatch: 'Match to existing',
        reanalyze: 'Re-analyze',
        execute: 'Execute Merge',
        // "Update existing only" mode (Primitive 1)
        updateOnlyLabel: 'Only update existing people (don\'t add new)',
        updateOnlyHint: 'Enrich matched people from the import, but add no new persons.',
        // "Merge this view into…" action (Primitive 3)
        mergeViewInto: 'Merge this view into…',
        mergeViewDescription: 'Merge the currently shown people into:',
        mergeViewSourceLabel: 'Current view',
        mergeViewEmpty: 'Nothing to merge — the current view is empty.',
        mergeViewNoTarget: 'No other tree to merge into.',
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

        // Photo conflict (two different portraits — shown as thumbnails in the dialog)
        photoConflict: 'two different photos',

        // Validation around the merge (non-blocking)
        preValidationWarning: (existing: number, incoming: number) =>
            `Existing tree has ${existing} issue${existing === 1 ? '' : 's'}, incoming ${incoming} — merging will carry them over.`,
        preValidationHint: 'You can fix them first via validation.',
        newIssuesTitle: 'Merge introduced new issues',
        newIssues: (n: number) =>
            `Merge introduced ${n} new issue${n === 1 ? '' : 's'} — open validation?`,

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
        statsDateRange: 'Date range',
        statsGenerations: 'Generations',
        statsYearSpan: 'Years covered',
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
        validateDesc: 'Check tree for errors',
        validationTitle: 'Tree Validation',
        postImportCheckTitle: 'Data check',
        postImportCheck: (n: number) => `We checked the imported data and found ${n} thing${n === 1 ? '' : 's'} worth a look. Review them?`,
        postImportReview: 'Review',
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
        valPossibleDuplicate: 'Possible duplicate person (same name and birth year)',
        valPlaceSpelling: 'One place written several ways',
        valRecurringGodparent: 'A godparent who keeps turning up — often a relative',
        valRecurringGodparentDetail: (name: string, events: number, people: number, whose: string) =>
            `${name} — at ${events} events of ${people} people · ${whose}`,
        valRecurringGodparentByName: 'matched by name',
        valOrphanedParticipantRef: 'Event participant links to a person who no longer exists',
        valOrphanedParticipantDetail: (person: string, event: string, who: string) =>
            `${person} · ${event}: ${who}`,
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
        // Short label for the "Tree: {name}" submenu, where the header already
        // names the tree (no need to repeat the noun).
        hide: 'Hide',
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
        changesHint: 'This sends only your additions. Send the file back to whoever shared the tree with you.',
        packetSaved: 'Change file saved',
        noChanges: 'Nothing has changed since the last share',
        baselineMissing: 'The baseline for these changes is missing — ask for the whole file instead',
        treeNotFound: 'No matching tree for these changes — ask the sender for the whole file instead',
        // Recipient preview of an opened change packet.
        previewTitle: (sender: string) => `${sender} sent you changes`,
        previewIntro: (tree: string) => tree ? `These additions update your tree “${tree}”.` : 'These additions update your tree.',
        accept: 'Accept changes',
        reviewDetail: 'Review in detail',
        newPeople: (n: number) => `${n} new ${n === 1 ? 'person' : 'people'}`,
        updatedPeople: (n: number) => `${n} updated`,
        media: (n: number) => `${n} ${n === 1 ? 'photo or file' : 'photos or files'}`,
        placesChip: (n: number) => `${n} ${n === 1 ? 'place' : 'places'}`,
        surnameGroups: (n: number) => `${n} surname ${n === 1 ? 'link' : 'links'}`,
        removed: (n: number) => `${n} removed`,
        sectionNew: 'New people',
        sectionUpdated: 'Updated people',
        fieldOther: 'other details',
        changedFields: (fields: string) => `changed: ${fields}`,
        andMore: (n: number) => `+${n} more`,
        applied: (added: number, updated: number) => `Applied — ${added} added, ${updated} updated`,
        alreadyApplied: 'These changes are already in your tree — nothing to apply.',
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
        linkCardTitle: 'Shared link card — this person belongs to a neighbouring family; their own spouse and children live there.',
        bigFamilyHint: 'A large family — the preview starts at its head; click people to move around.',
        title: 'Tree Preview',
        close: 'Close',
        focusedOn: 'Focused on',
        clickToFocus: 'Click a person to focus on them',
        compare: 'Compare Trees',
        preview: 'Preview',
        comparePersons: 'Compare'
    },

    // Cross-tree links
    slideshow: {
        menu: 'Slideshow (TV mode)',
        menuDesc: 'A hands-off flight through the tree — for the family screen',
        needMore: 'Show more people before starting the slideshow.',
        runsInFamily: 'Slideshow runs in the Family view',
        hint: 'Space = pause · ← → = move · Esc = exit',
        paused: 'Paused',
    },

    cardDensity: {
        settingLabel: 'Card detail',
        compact: 'Compact — names only',
        normal: 'Normal — names and years',
        detailed: 'Detailed — + place and age',
    },

    fanChart: {
        settingLabel: 'Fan chart',
        kekuleHint: 'Show Kekulé (ancestor) numbers',
    },

    crossTree: {
        badgeTitle: (count: number) => `Found in ${count} other tree${count !== 1 ? 's' : ''}`,
        settingLabel: 'Cross-tree connections',
        settingHint: 'Show a badge when a person also appears in another tree',
        tooltipHeader: 'Also in:',
        clickToSwitch: 'Click to switch',
        chooserHeader: 'Open in tree…'
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
        today: 'Today',
        yesterday: 'Yesterday',
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
        // Change packet accepted (collaboration)
        appliedChanges: (sender: string) => `Applied changes from ${sender}`,
        // Split into families
        splitFamilies: (trees: number, persons: number) => `Split into ${trees} family trees (${persons} people)`,
        // Auto-repair
        repairedIssue: (desc: string) => `Auto-repair: ${desc}`,
        restoredBackup: 'Restored a backup',
        // Life events
        addedEvent: (name: string) => `Added event to ${name}`,
        updatedEvent: (name: string) => `Updated event of ${name}`,
        removedEvent: (name: string) => `Removed event from ${name}`,
        cleanedOrphanPlaces: (count: number) => `Cleaned ${count} orphaned ${count === 1 ? 'place' : 'places'}`,
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
        geocodePlaces: (count: number) => `looking up ${count} places`,
        clearPlaceGeo: 'removing a place from the map',
        cleanOrphanPlaces: (count: number) => `cleaning ${count} orphaned ${count === 1 ? 'place' : 'places'}`,
        renamePlace: (name: string) => `renaming a place to ${name}`,
        addSurnameGroup: (names: string) => `linking the spellings ${names}`,
        removeSurnameGroup: (name: string) => `unlinking the spellings of ${name}`,
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
        applyChanges: (sender: string) => `applying changes from ${sender}`,
        undone: (desc: string) => `Undone: ${desc}`,
        redone: (desc: string) => `Redone: ${desc}`,
        nothingToUndo: 'Nothing to undo',
        nothingToRedo: 'Nothing to redo'
    },

    // Undo / redo entries in the ⋯ actions menu (labels carry the last change).
    actions: {
        undoLabel: (desc: string) => `Undo: ${desc}`,
        undoDisabled: 'Undo',
        redo: 'Redo',
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
        stripPhotos: 'Export without photos & attachments',
        // Granular export content (R8)
        contentLabel: 'Content',
        contentTooltip: 'Choose what travels with the file. The tree structure and names are always kept.',
        contentEstimate: (size: string) => `Estimated size: ${size}`,
        presetComplete: 'Complete archive',
        presetSmall: 'Small file to send',
        presetSkeleton: 'Bare skeleton',
        contentPhotos: 'Photos',
        contentAttachments: 'Attachments & documents',
        contentNotes: 'Notes',
        contentSources: 'Sources & citations'
    },

    // Poster export (SVG / PNG / tiled PDF)
    poster: {
        menu: 'Export poster',
        title: 'Export as poster',
        description: 'Export the current view as a vector, image, or printable multi-page poster.',
        printsView: 'Prints the current view:',
        viewFamily: (name: string, up: number, down: number) => `Family — from ${name} (depth ${up}/${down})`,
        viewDescendants: (name: string) => `Descendants of ${name}`,
        viewFan: (name: string, gens: number) => `Fan — ancestors of ${name}, ${gens} generations`,
        viewTimeline: (name: string) => `Timeline — ${name}'s view`,
        viewMapBlocked: 'The map is not printable as a poster — switch to a tree view to print.',
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
        // The "+" affordance is drawn by the button markup (glyph span), so the
        // label itself carries no leading plus — avoids a double plus.
        addPerson: 'Přidat osobu',
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
        exportFocus: 'Export aktuálního pohledu',
        exportSelection: 'Export',
        poster: 'Plakát…',
        makeTree: 'Vytvořit strom',
        makeTreeFromView: 'Vytvořit strom z aktuálního pohledu',
        makeTreeFromViewDesc: 'Ze zobrazených osob vytvořit nový strom přímo v aplikaci',
        splitFamilies: 'Rozdělit na rodiny…',
        splitFamiliesHint: 'Rozřeže jeden spojený strom na strom pro každou rodinu — podle rodů (příjmení), nebo podle větví.',
        mergeViewInto: 'Sloučit do…',
        actions: 'Akce',
        treeActions: 'Strom:',
        sectionCurrentView: 'Aktuální pohled',
        sectionTree: 'Strom',
        sectionEdits: 'Úpravy',
        sectionView: 'Pohled',
        sectionApp: 'Aplikace',
        exportFocusDesc: 'Stáhnout zobrazené osoby jako JSON soubor',
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

    // Mobile menu
    mobileMenu: {
        addPerson: 'Přidat osobu',
        export: 'Export',
        import: 'Import',
        newTree: 'Nový strom',
        more: 'Více'
    },

    // Empty state
    emptyState: {
        title: 'Vítejte ve Stromu',
        subtitle: 'Začněte tvořit svůj rodokmen',
        addFirst: 'Přidat první osobu',
        importFromFile: 'Mám data jinde (GEDCOM z MyHeritage, Ancestry…)',
        youCard: 'vy?'
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
        toolbarPrint: 'Tisk',
        toolbarClose: 'Zavřít',
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
        delete: 'Smazat',
        deleteConfirm: (what: string) => `Smazat tuto zálohu? Samotného stromu se to nedotkne.${what ? `\n\n${what}` : ''}`,
        deleted: 'Záloha smazána',
        inBrowser: 'Zálohy žijí v tomto prohlížeči, ne ve tvém souboru se stromem — nezvětšují ho, ale zmizí s vymazáním dat prohlížeče nebo na jiném počítači. Zálohu, kterou si opravdu odložíš, uděláš exportem stromu.',
        menu: 'Zálohy',
        title: 'Historie záloh',
        empty: 'Zatím žádné zálohy',
        createNow: 'Vytvořit zálohu teď',
        restore: 'Obnovit',
        download: 'Stáhnout',
        restored: 'Záloha obnovena',
        created: 'Záloha vytvořena',
        restoreConfirm: (what: string) => `Obnovit tuto zálohu? Přepíše aktuální strom — aktuální stav se před obnovou uloží jako záloha.${what ? `\n\n${what}` : ''}`,
        total: (count: number, size: string) => `${count} záloh · ${size}`,
        colDate: 'Datum',
        colReason: 'Důvod',
        colPersons: 'Osob',
        persons: (count: number) => count === 1 ? '1 osoba' : (count < 5 ? `${count} osoby` : `${count} osob`),
        colSize: 'Velikost',
        reasons: {
            auto: 'Automatická',
            manual: 'Ruční',
            'pre-import': 'Před importem',
            'pre-merge': 'Před sloučením',
        },
    },

    split: {
        postImportTitle: 'Víc rodin v jednom souboru',
        postImport: (count: number) =>
            `Naimportovaný soubor obsahuje ${count} ${count >= 5 ? 'rodin' : 'rodiny'}, které nic nespojuje — nevede mezi nimi žádný rodič, dítě ani sňatek. Z každé může být samostatný strom.`,
        unrelated: (count: number) => `Obsahuje ${count} ${count >= 5 ? 'rodin' : 'rodiny'}, které nic nespojuje`,
        unrelatedHint: 'Rozdělit je můžete ve Správě stromů → ⋯ → Oddělit nespojené části.',
        menu: 'Oddělit nespojené části…',
        menuHint: 'Stromy z ostrovů, které nic nespojuje — nevede mezi nimi rodič, dítě ani sňatek.',
        title: 'Nespojené části tohoto stromu',
        intro: 'V tomto stromu jsou rodiny, které nic nespojuje — nevede mezi nimi žádný rodič, dítě ani sňatek. Z každé může být samostatný strom.',
        single: 'Všichni v tomto stromu jsou propojení — je tu jedna rodina, takže není co rozdělovat.',
        familyName: (surname: string) => `Rod ${surname}`,
        persons: (count: number) => count === 1 ? '1 osoba' : (count < 5 ? `${count} osoby` : `${count} osob`),
        oldest: (name: string, year: number) => `nejstarší ${name} (${year})`,
        noSurname: 'bez příjmení',
        alone: 'Není napojen na nikoho',
        selected: (count: number) => `Vyčlenit ${count}`,
        keepsOriginal: 'Původní strom zůstává, jak je — smažte si ho sami, až budete s rozdělením spokojení.',
        done: (count: number) => `Vytvořeno ${count} stromů. Původní je nedotčený.`,
    },
    splitFamilies: {
        title: 'Rozdělit na rodiny',
        intro: 'Rodiny, které tento strom obsahuje. Níže zvolte, co se počítá jako jedna rodina; stejný strom se pak vždy rozdělí stejně — osoba, kterou máte zobrazenou, jen určí, která rodina je první a odkud se čtou napojení. Každá osoba skončí právě v jednom stromu.',
        // Dva způsoby řezu (SplitMode): rody podle příjmení vs. připojené větve.
        modeLabel: 'Co je jedna rodina',
        modeSurname: 'Rody podle příjmení',
        modeLineage: 'Větve stromu',
        modeSurnameHint: 'Jedna rodina = jeden rod: děti patří k rodiči, jehož příjmení nesou, od zakladatele po posledního nositele. Přivdaná či přiženěná osoba bez vlastní rodiny v tomto stromu zůstává u partnera.',
        modeLineageHint: 'Jedna rodina = větev, jak strom rostl: hlavní linie se všemi přivdanými a přiženěnými, a každá připojená větev zvlášť.',
        modePerspective: 'Z pohledu osoby',
        modePerspectiveHint: 'Základní strom je linie zvolené osoby: přímí předci, jejich pokrevní sourozenci, vlastní sourozenci a všichni potomci. Rodiny sourozenců, které si necháš, zůstanou v něm; ostatní se odříznou do vedlejších stromů. Na rozdíl od ostatních dvou řezů tenhle závisí na zvolených osobách.',
        perspDepthLabel: 'Rodiny sourozenců nechat po',
        perspDepthCousins: 'bratrance (sourozenci rodičů)',
        perspDepthSecond: 'druhé bratrance (sourozenci prarodičů)',
        perspDepthNone: 'nikoho (jen přímá linie)',
        perspBasesLabel: 'Základní stromy z pohledu',
        perspAddPerson: 'Přidat osobu…',
        perspCutsLabel: (n: number) => `Řezy na sourozencích (${n})`,
        perspCutHint: 'Zaškrtnuto = sourozenec zůstane v základním stromu sám a jeho rodina bude vedlejší strom. Odškrtnutím rodinu necháš v základním stromu.',
        oneFamilyInMode: 'Při tomto pohledu je celý strom jedna rodina — není co rozdělovat.',
        familyName: (name: string) => `Rodina ${name}`,
        focusHere: 'Zvolená osoba',
        connectsTo: (name: string) => `napojeno přes ${name}`,
        persons: (count: number) => count === 1 ? '1 osoba' : (count < 5 ? `${count} osoby` : `${count} osob`),
        // „3 osoby", „1 osoba + 8 neznámých" — skutečné osoby zvlášť, neznámí
        // (placeholder) příbuzní zvlášť, ať rodina plná neznámých nevypadá velká.
        unknown: (count: number) => count === 1 ? '1 neznámá' : (count < 5 ? `${count} neznámé` : `${count} neznámých`),
        personsWithUnknown: (real: number, unknown: number) => {
            const r = real === 1 ? '1 osoba' : (real < 5 ? `${real} osoby` : `${real} osob`);
            const u = unknown === 1 ? '1 neznámá' : (unknown < 5 ? `${unknown} neznámé` : `${unknown} neznámých`);
            return unknown > 0 ? `${r} + ${u}` : r;
        },
        namePlaceholder: 'Název stromu',
        preview: 'Náhled',
        summary: (trees: number, real: number, unknown: number) => {
            const u = unknown === 1 ? '1 neznámá' : (unknown < 5 ? `${unknown} neznámé` : `${unknown} neznámých`);
            return `${trees} ${trees < 5 ? 'stromy' : 'stromů'} · ${real} osob${unknown > 0 ? ` + ${u}` : ''} · pokrytí 100 %`;
        },
        create: (count: number) => count === 1 ? 'Vytvořit 1 strom' : `Vytvořit ${count} ${count < 5 ? 'stromy' : 'stromů'}`,
        cancel: 'Zrušit',
        keepsOriginal: 'Původní strom zůstává přesně tak, jak je. Nové stromy zůstávají propojené přes společné osoby — nechtěné smažte ve Správě stromů.',
        done: (count: number) => count === 1 ? 'Vytvořen 1 strom' : `Vytvořeno ${count} ${count < 5 ? 'stromy' : 'stromů'}`,
        tooSmall: 'Tento strom obsahuje jen jednu rodinu — není co rozdělovat.',
        // Výběr osoby (dělíme strom, který není zobrazený — bez živého pohledu
        // uživatel zvolí osobu, jejíž rodina se vypíše první).
    },

    advanced: {
        settingLabel: 'Pokročilá pole',
        settingHint: 'Zobrazit u osoby prameny, přílohy, referenční číslo, další tvary jména a otevřené otázky. Výchozí je vypnuto — u osoby, kde už něco z toho vyplněné máte, se pole ukáže vždy.',
    },

    surnames: {
        menu: 'Tvary příjmení',
        title: 'Tvary příjmení',
        intro: 'Do zhruba roku 1900 píší matriky rod pokaždé jinak. Řekněte jednou, že tvary znamenají tentýž rod, a hledání i slučování je najdou všechny — ať je kdo zapsaný jakkoli, včetně lidí, které přidáte později.',
        groupsTitle: 'Propojené tvary',
        none: 'Zatím nic propojeného.',
        addTitle: 'Propojit tvary',
        addHint: 'Vyberte tvary, které znamenají jeden rod.',
        inTree: (count: number) => count === 1 ? '1 osoba' : (count < 5 ? `${count} osoby` : `${count} osob`),
        notInTree: 've stromu není',
        addOther: 'Jiný tvar…',
        link: 'Propojit',
        unlink: 'Zrušit propojení',
        linked: 'Tvary propojeny.',
    },

    events: {
        occupationLabel: 'Povolání / řemeslo',
        occupationHint: 'Jen to řemeslo — „kovář“, ne „pracoval v Kladně jako kovář“. Odchází to jako povolání v GEDCOMu.',
        participants: 'Kmotři a svědci',
        participantsHint: 'Koho ještě zápis jmenuje. Kmotr, který se opakuje, bývá příbuzný.',
        addParticipant: '+ Přidat',
        participantName: 'Jméno, jak je zapsáno',
        participantNote: 'Bližší určení (řemeslo, „soused“…)',
        participantLink: 'Propojit s osobou ve stromu',
        participantUnlink: 'Přece jen ne tato osoba',
        participantInTree: 've stromu',
        participantNameRequired: 'Zadejte jméno, nebo vyberte osobu ze stromu.',
        roles: {
            godparent: 'Kmotr / kmotra',
            witness: 'Svědek',
            officiant: 'Oddávající / křtící',
            other: 'Přítomen',
        },
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
        deleteConfirm: (what: string) => `Smazat tuto událost?\n\n${what}`,
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
        citePartnership: 'Citovat pramen (oddací matrika…)',
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
        deleteConfirm: (title: string, n: number) =>
            n > 0
                ? `Smazat tento pramen? Je citován na ${n} místech; citace budou odebrány.\n\n${title}`
                : `Smazat tento pramen?\n\n${title}`,
    },

    // Attachments
    attachments: {
        title: 'Přílohy',
        add: 'Přidat přílohu',
        empty: 'Zatím žádné přílohy',
        delete: 'Smazat',
        deleteConfirm: (what: string) => `Smazat tuto přílohu?\n\n${what}`,
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

    // Sticky generation labels
    genLabels: {
        settingLabel: 'Popisky generací',
        settingHint: 'Připnout názvy generací k levému okraji plátna',
    },

    // Branch colour coding
    branchColors: {
        settingLabel: 'Barvy větví',
        legendLabel: 'Legenda stromu',
        legendHint: 'Zobrazovat legendu nad stromem (prstence pohlaví, barvy větví)',
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
        step2: 'Po najetí na kartu se objeví tlačítka rychlého přidání: nahoře rodič, vpravo partner, dole dítě. Ouško s řetízkem na horní hraně spravuje partnerství a rodiče; přidání sourozence najdete v nabídce karty.',
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
        largestFamily: 'Největší rodina',
        childrenCount: (n: number) => n === 1 ? '1 dítě' : n < 5 ? `${n} děti` : `${n} dětí`,
        months: ['Led', 'Úno', 'Bře', 'Dub', 'Kvě', 'Čer', 'Čvc', 'Srp', 'Zář', 'Říj', 'Lis', 'Pro'],
    },

    // Anniversaries + "on this day"
    anniversaries: {
        deathHint: 'Zobrazovat i výroční dny úmrtí',
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
        deathAnniversary: (name: string, years: number) => `${name} — výročí úmrtí (${years} let)`,
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
        nameVariants: 'Další tvary jména',
        nameVariantsHint: 'Jak to píší matriky (Wischek, Vissek), alias, nebo jméno po chalupě. Oddělte čárkami. Hledání i slučování pak osobu najdou pod kterýmkoli z nich. Platí jen pro tuto osobu — tvary příjmení společné celé rodině patří do Správa stromů → Tvary příjmení.',
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
        photoRotateLeft: 'Otočit vlevo',
        photoRotateRight: 'Otočit vpravo',
        maidenName: 'Rodné příjmení',
        refn: 'Referenční číslo',
        question: 'Otevřená otázka',
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
        alsoWritten: 'psáno také',
        age: 'Věk',
        born: 'Narozen/a',
        died: 'Zemřel/a',
        notes: 'Poznámky',
        // Age in parentheses on the death line of the hover card.
        yearsOld: (age: number) => `(${age} ${age === 1 ? 'rok' : age >= 2 && age <= 4 ? 'roky' : 'let'})`,
        // Child count on the relationship line of the hover card.
        childrenCount: (n: number) => `${n} ${n === 1 ? 'dítě' : n >= 2 && n <= 4 ? 'děti' : 'dětí'}`,
        // Footer of the hover card: the real desktop gesture (click opens the menu).
        gestureHint: 'Klik otevře nabídku',
    },

    // Placeholders
    placeholders: {
        nameVariants: 'Wischek, Vissek, u Kováře',
        firstName: 'Jméno',
        lastName: 'Příjmení',
        maidenName: 'Rodné příjmení',
        refn: 'např. archivní karton 12 nebo id z jiného programu',
        question: 'např. neví někdo, kdy se narodila?',
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
        map: 'Mapa',
        toggle: 'Pohled rodina / potomci',
        back: 'Zpět na rodinný pohled',
        badgeLabel: 'Potomci:',
        badgeCount: (count: number) => {
            if (count === 1) return '1 osoba';
            if (count >= 2 && count <= 4) return `${count} osoby`;
            return `${count} osob`;
        },
        bloodOnly: {
            label: 'Jen pokrevní',
            short: 'Pokrevní',
            hint: 'Zobrazit i partnery a nevlastní rodiny',
        },
        fullFamilies: {
            label: 'Úplné rodiny',
            short: 'Rodiny',
            hint: 'Zobrazit jen pokrevní potomky',
        },
        settingLabel: 'Pohled Potomci',
        settingHint: 'Výchozí zobrazení celých rodin partnerů (jejich další svazky a nevlastní děti, znevýrazněně)',
    },

    // Fan chart (ancestor semicircle)
    map: {
        fit: 'Zobrazit všechna místa',
        zoomIn: 'Přiblížit',
        zoomOut: 'Oddálit',
        scopeView: 'Tento pohled',
        scopeTree: 'Celý strom',
        noPlaces: 'Žádná ze zobrazených osob zatím nemá vyplněné místo.',
        noPlacesAtAll: 'Tento strom zatím nemá vyplněná žádná místa.',
        offline: 'Bez internetu se mapový podklad nenačte. Už dohledané souřadnice zůstávají ve vašem stromu.',
        missing: (shown: number, missing: number) =>
            shown > 0
                ? `${strings.map.placeCount(shown)} na mapě, ${missing} bez souřadnic.`
                : `${strings.map.placeCount(missing)} zatím bez souřadnic.`,
        lookUp: (count: number) => `Dohledat ${strings.map.placeCount(count)}`,
        placeCount: (count: number) =>
            `${count} ${count === 1 ? 'místo' : (count < 5 ? 'místa' : 'míst')}`,
        managePlaces: 'Místa',
        allPlaced: (count: number) => `${strings.map.placeCount(count)} na mapě.`,
        placesTitle: 'Místa',
        placesIntro: 'Přejmenováním opravíte místo všude ve stromu naráz. Na mapu ho dostanete tak, že ho najdete pod názvem, který mapa zná — obvykle stačí nejbližší město. Připojí se jen souřadnice, místo si ponechá název, jak ho píše vaše rodina.',
        nameLabel: 'Název místa, jak je ve stromu',
        rename: 'Přejmenovat',
        renamed: (count: number) => `Přejmenováno na ${count} ${count === 1 ? 'místě' : 'místech'}.`,
        notOnMap: 'Zatím není na mapě',
        findOnMap: 'Najít na mapě',
        changePin: 'Změnit',
        removePin: 'Odebrat',
        cleanOrphans: (count: number) => `Vyčistit osiřelá místa (${count})`,
        cleanOrphansConfirm: (count: number) =>
            `Odebrat uložené souřadnice ${count} ${count === 1 ? 'místa' : count < 5 ? 'míst' : 'míst'}, která už nikdo ve stromu nepoužívá? Nic, co vaše rodina napsala, se nemění — zmizí jen zbylé špendlíky na mapě. Lze vrátit zpět.`,
        cleanOrphansDone: (count: number) => `Odebráno ${count} ${count === 1 ? 'osiřelé místo' : count < 5 ? 'osiřelá místa' : 'osiřelých míst'}.`,
        wrongSpot: 'Špatné místo? Opravit',
        usedBy: (count: number) => count === 1 ? '1 osoba' : (count < 5 ? `${count} osoby` : `${count} osob`),
        search: 'Hledat',
        searchLabel: 'Najít toto místo pod jiným názvem',
        searching: 'Hledám…',
        noCandidates: 'Nic nenalezeno. Zkuste nejbližší město nebo doplňte zemi.',
        matched: (label: string) => label ? `Napárováno na ${label}` : 'Napárováno',
        geocodingProgress: (done: number, total: number, place: string) =>
            `Dohledávám místa… ${done}/${total} (${place})`,
        done: (found: number) => `Na mapě je ${strings.map.placeCount(found)}.`,
        doneWithMisses: (found: number, missed: number) =>
            `Na mapě je ${strings.map.placeCount(found)}. ${missed} se nepodařilo najít — zkuste opravit zápis nebo doplnit zemi.`,
        consentTitle: 'Dohledat souřadnice online?',
        consentBody: (count: number, service: string) =>
            `Pro vykreslení mapy se do služby ${service} odešle ${count} ${count === 1 ? 'název místa' : (count < 5 ? 'názvy míst' : 'názvů míst')} (například „Praha“). `
            + 'Nic jiného aplikaci neopustí — žádná jména, data ani vztahy vaší rodiny. '
            + 'Souřadnice se uloží do vašeho stromu, takže se každé místo dohledává jen jednou a mapa pak funguje i offline.',
        consentConfirm: 'Dohledat',
        settingLabel: 'Dohledávat místa online',
        settingHint: 'Umožní mapě odesílat názvy míst do geokódovací služby. Už dohledané souřadnice zůstávají ve vašem stromu.',
        tilesNotice: 'Podklad mapy se načítá z openstreetmap.org — načtení tomuto serveru prozradí jen to, jakou oblast si prohlížíte, nic víc. Data vaší rodiny zůstávají v aplikaci.',
        tilesNoticeOk: 'Zobrazit mapu',
        timeMode: 'Migrace v čase',
        timeModeEmpty: 'Doplňte data (narození, úmrtí, události) a uvidíte stěhování rodu v čase.',
        timePlay: 'Přehrát',
        timePause: 'Pozastavit',
        timeYear: 'Rok',
        timeUndated: (n: number) =>
            `${n} ${n === 1 ? 'místo' : n < 5 ? 'místa' : 'míst'} bez data se na časové ose ${n === 1 ? 'nezobrazuje' : 'nezobrazují'}.`,
    },

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

    // Přehled zdraví stromu (R4)
    treeHealth: {
        menu: 'Zdraví stromu',
        title: (name: string) => `Zdraví stromu: ${name}`,
        empty: 'Tento strom zatím nemá žádné osoby.',
        // Blok validace
        sectionValidation: 'Konzistence',
        allGood: 'Nenalezeny žádné nesrovnalosti',
        countErrors: (n: number) => `${n} ${n === 1 ? 'chyba' : (n < 5 ? 'chyby' : 'chyb')}`,
        countWarnings: (n: number) => `${n} ${n === 1 ? 'varování' : 'varování'}`,
        countInfos: (n: number) => `${n} ${n === 1 ? 'poznámka' : (n < 5 ? 'poznámky' : 'poznámek')}`,
        topIssues: 'Nejdůležitější nálezy',
        moreIssues: (n: number) => `a další ${n}…`,
        // Blok úplnosti
        sectionCompleteness: 'Úplnost dat',
        completenessHint: 'Podíl osob, které mají daný údaj vyplněný.',
        fieldBirthDate: 'Datum narození',
        fieldBirthPlace: 'Místo narození',
        fieldDeathDate: 'Datum úmrtí',
        fieldPhoto: 'Fotografie',
        // Blok struktury
        sectionStructure: 'Struktura',
        statPeople: 'Osoby',
        statUnions: 'Svazky',
        statGenerations: 'Generace',
        statIslands: 'Nesouvislé rodiny',
        islandsOne: 'Všechny osoby jsou propojeny do jedné rodiny.',
        islandsMany: (n: number) => `Tento strom obsahuje ${n} nesouvislých rodin bez vzájemné vazby.`,
        islandItem: (surname: string, count: number) => `${surname} — ${count} ${count === 1 ? 'osoba' : (count < 5 ? 'osoby' : 'osob')}`,
        islandUnnamed: 'Bezejmenná rodina',
        islandsSplitHint: 'Tlačítkem „Rozdělit na rodiny“ níže dáte každé vlastní strom.',
        // Rychlé akce
        sectionActions: 'Rychlé akce',
        actionValidate: 'Detaily validace',
        actionCleanPlaces: (n: number) => n > 0 ? `Vyčistit osiřelá místa (${n})` : 'Vyčistit osiřelá místa',
        actionSplit: 'Rozdělit na rodiny',
        // Akce měnící data pracují s aktivním stromem; jinak jsou zakázané.
        switchFirst: 'Nejprve na tento strom přepněte',
    },

    // Person modal
    personModal: {
        birthEstimate: (year: number) => `Narozen(a) nejpozději ~${year} (odvozeno z ostatních dat)`,
        birthEstimateApply: 'použít',
        addTitle: 'Přidat osobu',
        editTitle: 'Upravit osobu',
        completeTitle: 'Doplnit osobu',
        enterName: 'Zadejte prosím jméno nebo příjmení',
        unsavedMessage: 'Máte neuložené změny v údajích osoby.',
        invalidDate: 'Neplatné datum. Použijte např. 15.5.1880, 5/1880, 1880 nebo „kolem 1880".',
        photoError: 'Obrázek se nepodařilo zpracovat.',
        // Header + section labels (Letopis redesign)
        newPersonName: 'Nová osoba',
        sectionBasic: 'Základní údaje',
        sectionBirth: 'Narození',
        sectionRelations: 'Vztahy',
        sectionDeathEvents: 'Úmrtí a další události',
        sectionSources: 'Prameny a přílohy',
        sectionPhotoNotes: 'Fotografie a poznámky',
        // Časová osa života (R2) — jen pro čtení, mini-osa života osoby
        sectionLifeline: 'Časová osa života',
        lifelineBorn: 'Narození',
        lifelineDied: 'Úmrtí',
        lifelineMarried: (name: string) => `Sňatek — ${name}`,
        lifelineMarriedUnknown: 'Sňatek',
        lifelineChild: (name: string) => `Narození dítěte: ${name}`,
        lifelineChildUnknown: 'Narození dítěte',
        lifelineWith: (names: string) => `s ${names}`,
        dateHint: '15.5.1880 · 5/1880 · 1880 · kolem 1880',
        deletePerson: 'Smazat osobu…',
        // Live summaries shown next to each section header
        sumParents: 'rodiče',
        sumPartners: (n: number) => n === 1 ? '1 partner' : (n < 5 ? `${n} partneři` : `${n} partnerů`),
        sumChildren: (n: number) => n === 1 ? '1 dítě' : (n < 5 ? `${n} děti` : `${n} dětí`),
        sumEvents: (n: number) => n === 1 ? '1 událost' : (n < 5 ? `${n} události` : `${n} událostí`),
        sumDeceased: 'zemřel(a)',
        sumCitations: (n: number) => n === 1 ? '1 citace' : (n < 5 ? `${n} citace` : `${n} citací`),
        sumScans: (n: number) => n === 1 ? '1 sken' : (n < 5 ? `${n} skeny` : `${n} skenů`),
        sumPhoto: 'fotografie',
        sumNote: 'poznámka',
        sumNone: 'prázdné',
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
    card: {
        // Short one-word labels for the hover add-tab pills.
        addTabParent: 'rodič',
        addTabPartner: 'partner',
        addTabChild: 'dítě',
        // Chain-link edge tab (manage partnerships/parents) expanded label.
        relTab: 'vztahy',
        // Lowercase inline word for the detailed card's "years · age" meta row.
        ageWord: 'věk',
    },
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
        back: 'Zpět na předchozí osobu (Alt+←)',
        forward: 'Vpřed (Alt+→)',
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
        // Short labels inside the card branch-tab pills (glyph + text).
        branchTabParents: 'rodiče',
        branchTabSiblings: 'sourozenci',
        branchTabChildren: 'rodina',
        personCount: (visible: number, total: number) => `${visible} z ${total} osob`
    },

    // Generation guide labels (small-caps rules on the canvas, relative to focus)
    generationLabels: {
        grandparents: 'PRARODIČE',
        parents: 'RODIČE',
        focus: 'ZAMĚŘENÁ GENERACE',
        children: 'DĚTI',
        grandchildren: 'VNOUČATA',
        generationN: (offset: number) => `GENERACE ${offset > 0 ? '+' : '−'}${Math.abs(offset)}`,
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
        selectPerson: 'Vyberte osobu',
        shortcutHint: '/',
        shortcutAria: 'Stiskněte / pro hledání',
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
        importAsNewDesc: 'Přidat jako samostatný strom (aktuální zůstane)',
        mergeExisting: 'Sloučit s existujícím',
        mergeExistingDesc: 'Inteligentní sloučení do aktuálního stromu',
        insertToTree: 'Vložit do stromu',
        insertToTreeDesc: 'Načíst převedená data do aktuálního stromu',
        parseError: 'Nepodařilo se zpracovat GEDCOM soubor',
        skippedTags: 'Přeskočené záznamy',
        unknownSex: (n: number) => `${n} ${n === 1 ? 'osoba' : n < 5 ? 'osoby' : 'osob'} s neznámým pohlavím (odvozeno z role v rodině)`,
        otherFamilyLinks: (n: number) =>
            `${n} ${n === 1 ? 'dítě je zapsáno' : n < 5 ? 'děti jsou zapsány' : 'dětí je zapsáno'} ve více rodinách `
            + `(např. adopce); zobrazeno u rodné rodiny, zbytek zapsán v poznámce osoby`,
        photos: 'Fotografie',
        documents: 'Dokumenty',
        sources: 'Prameny',
        events: 'Události',
        notes: 'Poznámky',
        allImported: 'Vše ze souboru bylo naimportováno.',
        viewCutTooSmall: 'Nejdřív zobrazte více osob (pohled Rodina nebo Potomci), pak z pohledu vytvořte strom.',
        viewCutName: (name: string) => `${name} — výřez`,
        externalMedia: (n: number) => `Soubor odkazuje na ${n} externích souborů médií (platformy exportují fotky zvlášť jako složku/zip — nejdřív jej rozbalte).`,
        attachMedia: 'Napojit soubory médií…',
        downloadMedia: 'Stáhnout fotky z internetu',
        downloading: (done: number, total: number) => `Stahuji fotky… ${done}/${total}`,
        mediaAttached: (matched: number, total: number) => `Napojeno ${matched} z ${total} odkazovaných souborů.`,
        mediaNoMatch: 'Žádný z vybraných souborů neodpovídá odkazovaným názvům.',
    },

    // Poznámky, které importér GEDCOM zapisuje přímo do dat (uloží se). Sestaveny
    // v AKTUÁLNÍM jazyce aplikace v okamžiku importu.
    gedcomNotes: {
        altBirth: 'Narození (alternativní záznam)',
        altDeath: 'Úmrtí (alternativní záznam)',
        remarriage: (divorced: string, married: string) => `Rozvod ${divorced}, nový sňatek ${married}`,
        remarriageNoDate: (married: string) => `Rozvod, nový sňatek ${married}`,
        engagement: (date: string) => `Zásnuby: ${date}`,
        association: (name: string, label: string) => `Vztah: ${name} (${label})`,
        email: (value: string) => `E-mail: ${value}`,
        adoptedChild: 'osvojené dítě',
        fosterChild: 'dítě v pěstounské péči',
        child: 'dítě',
        parentAnd: ' a ',
        alsoRecorded: (kind: string, parents: string) => `Rovněž zapsáno jako ${kind} rodičů ${parents}.`,
        alsoRecordedNoParents: (kind: string) => `Rovněž zapsáno jako ${kind} v jiné rodině.`,
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
        skip: 'Přeskočit',
        unskip: 'Zrušit přeskočení',
        skipped: 'Přeskočeno',
        skipTooltip: 'Tuto osobu vůbec nepřinášet — ani sloučit, ani přidat (na rozdíl od Odmítnout, které ji naimportuje jako novou osobu).',
        statsSkipped: 'Přeskočeno',
        skippedCount: (n: number) => `${n} přeskočeno`,
        changeMatch: 'Změnit',
        manualMatch: 'Přiřadit k existující',
        reanalyze: 'Znovu analyzovat',
        execute: 'Provést sloučení',
        // Režim „jen doplnit existující“ (Primitive 1)
        updateOnlyLabel: 'Jen doplnit existující osoby (nepřidávat nové)',
        updateOnlyHint: 'Doplní spárované osoby z importu, ale nepřidá žádné nové osoby.',
        // Akce „Sloučit tento pohled do…“ (Primitive 3)
        mergeViewInto: 'Sloučit tento pohled do…',
        mergeViewDescription: 'Sloučit aktuálně zobrazené osoby do:',
        mergeViewSourceLabel: 'Aktuální pohled',
        mergeViewEmpty: 'Není co sloučit — aktuální pohled je prázdný.',
        mergeViewNoTarget: 'Není jiný strom, do kterého sloučit.',
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

        // Photo conflict (dvě různé fotografie — v dialogu zobrazeny jako náhledy)
        photoConflict: 'dvě různé fotografie',

        // Validace kolem sloučení (neblokující)
        preValidationWarning: (existing: number, incoming: number) =>
            `Stávající strom má ${existing} ${existing === 1 ? 'problém' : existing < 5 ? 'problémy' : 'problémů'}, příchozí ${incoming} — sloučením se přenesou dál.`,
        preValidationHint: 'Můžete je nejdřív opravit přes validaci.',
        newIssuesTitle: 'Sloučení přineslo nové problémy',
        newIssues: (n: number) =>
            `Sloučení přineslo ${n} ${n === 1 ? 'nový problém' : n < 5 ? 'nové problémy' : 'nových problémů'} — otevřít validaci?`,

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
        statsDateRange: 'Rozsah dat',
        statsGenerations: 'Generací',
        statsYearSpan: 'Rozpětí let',
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
        validateDesc: 'Zkontrolovat strom na chyby',
        validationTitle: 'Validace stromu',
        postImportCheckTitle: 'Kontrola dat',
        postImportCheck: (n: number) => `Zkontrolovali jsme naimportovaná data a našli ${n} ${n === 1 ? 'věc k prohlédnutí' : n < 5 ? 'věci k prohlédnutí' : 'věcí k prohlédnutí'}. Zobrazit?`,
        postImportReview: 'Zobrazit',
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
        valPossibleDuplicate: 'Možná duplicitní osoba (stejné jméno a rok narození)',
        valPlaceSpelling: 'Jedno místo zapsané víckrát jinak',
        valRecurringGodparent: 'Kmotr, který se opakuje — bývá to příbuzný',
        valRecurringGodparentDetail: (name: string, events: number, people: number, whose: string) =>
            `${name} — u ${events} událostí ${people} osob · ${whose}`,
        valRecurringGodparentByName: 'shoda podle jména',
        valOrphanedParticipantRef: 'Účastník události odkazuje na osobu, která už neexistuje',
        valOrphanedParticipantDetail: (person: string, event: string, who: string) =>
            `${person} · ${event}: ${who}`,
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
        // Short label for the "Strom: {name}" submenu, where the header already
        // names the tree (no need to repeat the noun).
        hide: 'Skrýt',
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
        changesHint: 'Pošle jen tvoje doplnění. Soubor pošli zpět tomu, kdo ti strom sdílel.',
        packetSaved: 'Soubor se změnami uložen',
        noChanges: 'Od posledního sdílení se nic nezměnilo',
        baselineMissing: 'Chybí baseline pro tyto změny — vyžádej si radši celý soubor',
        treeNotFound: 'Žádný odpovídající strom pro tyto změny — vyžádej si od odesílatele celý soubor',
        // Náhled otevřeného souboru se změnami u příjemce.
        previewTitle: (sender: string) => `${sender} ti poslal(a) změny`,
        previewIntro: (tree: string) => tree ? `Tato doplnění upraví tvůj strom „${tree}“.` : 'Tato doplnění upraví tvůj strom.',
        accept: 'Přijmout změny',
        reviewDetail: 'Prohlédnout podrobně',
        newPeople: (n: number) => `${n} ${n === 1 ? 'nová osoba' : (n >= 2 && n <= 4 ? 'nové osoby' : 'nových osob')}`,
        updatedPeople: (n: number) => `${n} upraveno`,
        media: (n: number) => `${n} ${n === 1 ? 'fotka nebo soubor' : (n >= 2 && n <= 4 ? 'fotky nebo soubory' : 'fotek nebo souborů')}`,
        placesChip: (n: number) => `${n} ${n === 1 ? 'místo' : (n >= 2 && n <= 4 ? 'místa' : 'míst')}`,
        surnameGroups: (n: number) => `${n} ${n === 1 ? 'propojení příjmení' : 'propojení příjmení'}`,
        removed: (n: number) => `${n} odebráno`,
        sectionNew: 'Nové osoby',
        sectionUpdated: 'Upravené osoby',
        fieldOther: 'další údaje',
        changedFields: (fields: string) => `změněno: ${fields}`,
        andMore: (n: number) => `+${n} dalších`,
        applied: (added: number, updated: number) => `Přijato — ${added} přidáno, ${updated} upraveno`,
        alreadyApplied: 'Tyto změny už ve tvém stromu jsou — není co přijmout.',
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
        linkCardTitle: 'Sdílená spojovací karta — tato osoba patří do sousední rodiny; její partner a děti jsou tam.',
        bigFamilyHint: 'Velká rodina — náhled začíná u její hlavy; klikáním na osoby se posouváte.',
        title: 'Náhled stromu',
        close: 'Zavřít',
        focusedOn: 'Fokus na',
        clickToFocus: 'Klikněte na osobu pro změnu fokusu',
        compare: 'Porovnat stromy',
        preview: 'Náhled',
        comparePersons: 'Porovnat'
    },

    // Cross-tree links
    slideshow: {
        menu: 'Průlet stromem (TV režim)',
        menuDesc: 'Automatický průlet rodokmenem — pro promítání rodině',
        needMore: 'Nejdřív zobrazte více osob, pak spusťte průlet.',
        runsInFamily: 'Průlet běží v pohledu Rodina',
        hint: 'Mezerník = pauza · ← → = posun · Esc = konec',
        paused: 'Pozastaveno',
    },

    cardDensity: {
        settingLabel: 'Detail karet',
        compact: 'Kompaktní — jen jména',
        normal: 'Normální — jména a roky',
        detailed: 'Podrobné — + místo a věk',
    },

    fanChart: {
        settingLabel: 'Vějíř',
        kekuleHint: 'Zobrazit Kekulého (ahnentafel) čísla předků',
    },

    crossTree: {
        badgeTitle: (count: number) => `Nalezeno v ${count} ${count === 1 ? 'jiném stromu' : count < 5 ? 'jiných stromech' : 'jiných stromech'}`,
        settingLabel: 'Propojení mezi stromy',
        settingHint: 'Zobrazit odznak, když se osoba vyskytuje i v jiném stromu',
        tooltipHeader: 'Také v:',
        clickToSwitch: 'Kliknutím přepnout',
        chooserHeader: 'Otevřít ve stromu…'
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
        today: 'Dnes',
        yesterday: 'Včera',
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
        appliedChanges: (sender: string) => `Přijaty změny od ${sender}`,
        // Split into families
        splitFamilies: (trees: number, persons: number) => `Rozděleno na ${trees} rodinné stromy (${persons} osob)`,
        // Auto-repair
        repairedIssue: (desc: string) => `Automatická oprava: ${desc}`,
        restoredBackup: 'Obnovena záloha',
        // Life events
        addedEvent: (name: string) => `Přidána událost k ${name}`,
        updatedEvent: (name: string) => `Upravena událost u ${name}`,
        removedEvent: (name: string) => `Odebrána událost u ${name}`,
        cleanedOrphanPlaces: (count: number) => `Vyčištěno ${count} ${count === 1 ? 'osiřelé místo' : count < 5 ? 'osiřelá místa' : 'osiřelých míst'}`,
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
        geocodePlaces: (count: number) => `dohledání ${count} míst`,
        clearPlaceGeo: 'odebrání místa z mapy',
        cleanOrphanPlaces: (count: number) => `vyčištění ${count} ${count === 1 ? 'osiřelého místa' : count < 5 ? 'osiřelých míst' : 'osiřelých míst'}`,
        renamePlace: (name: string) => `přejmenování místa na ${name}`,
        addSurnameGroup: (names: string) => `propojení tvarů ${names}`,
        removeSurnameGroup: (name: string) => `zrušení propojení tvarů ${name}`,
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
        applyChanges: (sender: string) => `přijetí změn od ${sender}`,
        undone: (desc: string) => `Vráceno: ${desc}`,
        redone: (desc: string) => `Znovu provedeno: ${desc}`,
        nothingToUndo: 'Není co vrátit',
        nothingToRedo: 'Není co zopakovat'
    },

    // Undo / redo entries in the ⋯ actions menu (labels carry the last change).
    actions: {
        undoLabel: (desc: string) => `Zpět: ${desc}`,
        undoDisabled: 'Zpět',
        redo: 'Znovu',
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
        stripPhotos: 'Exportovat bez fotek a příloh',
        // Granular export content (R8)
        contentLabel: 'Obsah',
        contentTooltip: 'Vyber, co se uloží do souboru. Struktura stromu a jména zůstanou vždy zachována.',
        contentEstimate: (size: string) => `Odhadovaná velikost: ${size}`,
        presetComplete: 'Kompletní archiv',
        presetSmall: 'Malý soubor k odeslání',
        presetSkeleton: 'Jen kostra',
        contentPhotos: 'Fotky',
        contentAttachments: 'Přílohy a dokumenty',
        contentNotes: 'Poznámky',
        contentSources: 'Zdroje a citace'
    },

    // Poster export (SVG / PNG / tiled PDF)
    poster: {
        menu: 'Export plakátu',
        title: 'Export jako plakát',
        description: 'Exportuj aktuální zobrazení jako vektor, obrázek nebo tisknutelný plakát na více stran.',
        printsView: 'Vytiskne aktuální zobrazení:',
        viewFamily: (name: string, up: number, down: number) => `Rodina — od ${name} (hloubka ${up}/${down})`,
        viewDescendants: (name: string) => `Potomci osoby ${name}`,
        viewFan: (name: string, gens: number) => `Vějíř — předci osoby ${name}, generací: ${gens}`,
        viewTimeline: (name: string) => `Časová osa — pohled osoby ${name}`,
        viewMapBlocked: 'Mapa se jako plakát tisknout nedá — pro tisk přepni na stromové zobrazení.',
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

const stringsDE: StringsType = {
    // Toolbar
    toolbar: {
        title: 'Strom',
        addPerson: 'Person hinzufügen',
        export: 'Export ▾',
        import: 'Import ▾',
        newTree: 'Neuer Stammbaum'
    },

    // Menu dialogs
    menu: {
        export: 'Export',
        import: 'Import',
        exportJson: 'JSON exportieren',
        exportJsonDesc: 'Daten als JSON-Datei herunterladen',
        exportFocus: 'Diese Ansicht exportieren',
        exportSelection: 'Export',
        poster: 'Poster…',
        makeTree: 'Stammbaum erstellen',
        makeTreeFromView: 'Stammbaum aus dieser Ansicht erstellen',
        makeTreeFromViewDesc: 'Aus den angezeigten Personen einen neuen Stammbaum in der App erstellen',
        splitFamilies: 'In Familien aufteilen…',
        splitFamiliesHint: 'Teilt einen zusammenhängenden Stammbaum in einen Stammbaum je Familie — nach Namenslinien oder nach Zweigen.',
        mergeViewInto: 'Zusammenführen mit…',
        actions: 'Aktionen',
        treeActions: 'Stammbaum:',
        sectionCurrentView: 'Aktuelle Ansicht',
        sectionTree: 'Stammbaum',
        sectionEdits: 'Änderungen',
        sectionView: 'Ansicht',
        sectionApp: 'App',
        exportFocusDesc: 'Die angezeigten Personen als JSON-Datei herunterladen',
        exportApp: 'App exportieren',
        exportAppDesc: 'Eigenständige HTML-Datei herunterladen',
        importJson: 'JSON importieren',
        importJsonDesc: 'Daten aus JSON-Datei laden',
        importGedcom: 'GEDCOM importieren',
        importGedcomDesc: 'Stammbaum aus GEDCOM-Datei laden',
        exportGedcom: 'GEDCOM exportieren',
        exportGedcomDesc: 'Als GEDCOM-Datei herunterladen',
        newTree: 'Neuer Stammbaum',
        newTreeDesc: 'Einen neuen, leeren Stammbaum beginnen'
    },

    // Mobile menu
    mobileMenu: {
        addPerson: 'Person hinzufügen',
        export: 'Export',
        import: 'Import',
        newTree: 'Neuer Stammbaum',
        more: 'Mehr'
    },

    // Empty state
    emptyState: {
        title: 'Willkommen bei Strom',
        subtitle: 'Beginnen Sie mit Ihrem Stammbaum',
        addFirst: 'Erste Person hinzufügen',
        importFromFile: 'Ich habe Daten woanders (GEDCOM von MyHeritage, Ancestry…)',
        youCard: 'Sie?'
    },

    demo: {
        tryDemo: 'Beispiel-Stammbaum ausprobieren',
        tryDemoDesc: 'Erkunden Sie einen fertigen historischen Stammbaum',
        treeName: 'Beispiel: Haus Tudor',
        hint: 'Klicken Sie auf eine Karte, um Aktionen zu sehen. Es ist ein ganz normaler Stammbaum — Sie können ihn in der Stammbaum-Verwaltung löschen.'
    },

    // Family book
    book: {
        menu: 'Familienbuch',
        menuDesc: 'Druckbares Buch: Kapitel nach Familien, Fotos, Quellen und ein Personenregister',
        toolbarPrint: 'Drucken',
        toolbarClose: 'Schließen',
        title: 'Familienbuch',
        dialogTitle: 'Familienbuch',
        subtitle: 'Das Buch der Familie',
        families: 'Familien',
        children: 'Kinder',
        index: 'Personenregister',
        tree: 'Stammbaum',
        treeHint: 'Ein vollständiger, gut lesbarer Stammbaum liegt als eigenes Poster bei (Export → Poster).',
        sources: 'Quellen',
        chapterShort: 'Kap.',
        born: '*',
        died: '†',
        persons: 'Personen',
        generations: 'Generationen',
        generate: 'Buch öffnen',
        optName: 'Titel',
        optMaxGen: 'Max. Generationen (optional)',
        compiled: (date: string) => `erstellt ${date}`,
        empty: 'Der Stammbaum ist leer.',
    },

    // Versioned backups
    snapshots: {
        delete: 'Löschen',
        deleteConfirm: (what: string) => `Diese Sicherung löschen? Der Stammbaum selbst bleibt unberührt.${what ? `\n\n${what}` : ''}`,
        deleted: 'Sicherung gelöscht',
        inBrowser: 'Sicherungen leben in diesem Browser, nicht in Ihrer Stammbaum-Datei — sie vergrößern sie nie und sind weg, wenn Sie die Browserdaten löschen oder an einen anderen Computer wechseln. Exportieren Sie den Stammbaum für eine Sicherung, die Sie behalten können.',
        menu: 'Sicherungen',
        title: 'Sicherungsverlauf',
        empty: 'Noch keine Sicherungen',
        createNow: 'Jetzt Sicherung erstellen',
        restore: 'Wiederherstellen',
        download: 'Herunterladen',
        restored: 'Sicherung wiederhergestellt',
        created: 'Sicherung erstellt',
        restoreConfirm: (what: string) => `Diese Sicherung wiederherstellen? Sie überschreibt den aktuellen Stammbaum — der aktuelle Stand wird zuvor als Sicherung gespeichert.${what ? `\n\n${what}` : ''}`,
        total: (count: number, size: string) => `${count} Sicherungen · ${size}`,
        colDate: 'Datum',
        colReason: 'Grund',
        colPersons: 'Personen',
        persons: (count: number) => count === 1 ? '1 Person' : `${count} Personen`,
        colSize: 'Größe',
        reasons: {
            auto: 'Automatisch',
            manual: 'Manuell',
            'pre-import': 'Vor dem Import',
            'pre-merge': 'Vor dem Zusammenführen',
        },
    },

    split: {
        postImportTitle: 'Mehrere Familien in einer Datei',
        postImport: (count: number) =>
            `Die importierte Datei enthält ${count} Familien, die nichts verbindet — kein Elternteil, kein Kind und keine Ehe führt von einer zur anderen. Aus jeder könnte ein eigener Stammbaum werden.`,
        unrelated: (count: number) => `Enthält ${count} Familien, die nichts verbindet`,
        unrelatedHint: 'Teilen Sie sie unter Stammbäume verwalten → ⋯ → Nicht verbundene Teile trennen.',
        menu: 'Nicht verbundene Teile trennen…',
        menuHint: 'Stammbäume für Inseln, die nichts verbindet — kein Elternteil, kein Kind und keine Ehe zwischen ihnen.',
        title: 'Nicht verbundene Teile dieses Stammbaums',
        intro: 'Dieser Stammbaum enthält Familien, die nichts verbindet — kein Elternteil, kein Kind und keine Ehe führt von einer zur anderen. Aus jeder kann ein eigener Stammbaum werden.',
        single: 'Alle in diesem Stammbaum sind verbunden — es gibt hier nur eine Familie, also gibt es nichts zu teilen.',
        familyName: (surname: string) => `Familie ${surname}`,
        persons: (count: number) => count === 1 ? '1 Person' : `${count} Personen`,
        oldest: (name: string, year: number) => `älteste(r) ${name} (${year})`,
        noSurname: 'ohne Nachname',
        alone: 'Mit niemandem verbunden',
        selected: (count: number) => `${count} abtrennen`,
        keepsOriginal: 'Der ursprüngliche Stammbaum bleibt, wie er ist — löschen Sie ihn selbst, sobald Sie mit der Aufteilung zufrieden sind.',
        done: (count: number) => `${count} Stammbäume erstellt. Der ursprüngliche bleibt unberührt.`,
    },
    splitFamilies: {
        title: 'In Familien aufteilen',
        intro: 'Die Familien, die dieser Stammbaum enthält. Wählen Sie unten, was als eine Familie zählt; derselbe Stammbaum wird dann immer gleich aufgeteilt — die Person, die Sie gerade betrachtet haben, bestimmt nur, welche Familie zuerst aufgeführt wird und wie sich die Verbindungen lesen. Jede Person landet in genau einem Stammbaum.',
        modeLabel: 'Was als eine Familie zählt',
        modeSurname: 'Namenslinien',
        modeLineage: 'Zweige',
        modeSurnameHint: 'Eine Familie = eine Namenslinie: Kinder gehören zu dem Elternteil, dessen Nachnamen sie tragen, vom Stammvater bis zum letzten Träger. Ein/e angeheiratete Ehepartner/in ohne eigene Familie in diesem Stammbaum bleibt bei seinem/ihrem Partner.',
        modeLineageHint: 'Eine Familie = ein Zweig, so wie der Stammbaum gewachsen ist: die Hauptlinie mit allen Eingeheirateten und jeder abzweigende angeheiratete Zweig.',
        modePerspective: 'Sicht einer Person',
        modePerspectiveHint: 'Der Basis-Stammbaum ist die eigene Linie der gewählten Person: direkte Vorfahren, deren leibliche Geschwister, eigene Geschwister und alle Nachkommen. Geschwisterfamilien, die Sie behalten, bleiben darin; der Rest teilt sich in benachbarte Stammbäume auf. Anders als die beiden anderen Schnitte hängt dieser von den gewählten Personen ab.',
        perspDepthLabel: 'Geschwisterfamilien behalten bis zu',
        perspDepthCousins: 'Cousins ersten Grades (Geschwister der Eltern)',
        perspDepthSecond: 'Cousins zweiten Grades (Geschwister der Großeltern)',
        perspDepthNone: 'niemandem (nur direkte Linie)',
        perspBasesLabel: 'Basis-Stammbäume aus Sicht von',
        perspAddPerson: 'Person hinzufügen…',
        perspCutsLabel: (n: number) => `Schnitte bei Geschwistern (${n})`,
        perspCutHint: 'Angehakt = dieses Geschwister bleibt allein im Basis-Stammbaum und seine Familie wird ein benachbarter Stammbaum. Haken entfernen, um die Familie im Basis-Stammbaum zu behalten.',
        oneFamilyInMode: 'So gesehen ist der ganze Stammbaum eine Familie — nichts zu teilen.',
        familyName: (name: string) => `Familie ${name}`,
        focusHere: 'Gewählte Person',
        connectsTo: (name: string) => `verbunden über ${name}`,
        persons: (count: number) => count === 1 ? '1 Person' : `${count} Personen`,
        unknown: (count: number) => `${count} unbekannt`,
        personsWithUnknown: (real: number, unknown: number) => {
            const r = real === 1 ? '1 Person' : `${real} Personen`;
            return unknown > 0 ? `${r} + ${unknown} unbekannt` : r;
        },
        namePlaceholder: 'Stammbaum-Name',
        preview: 'Vorschau',
        summary: (trees: number, real: number, unknown: number) =>
            `${trees} Stammbäume · ${real} Personen${unknown > 0 ? ` + ${unknown} unbekannt` : ''} · 100 % abgedeckt`,
        create: (count: number) => count === 1 ? '1 Stammbaum erstellen' : `${count} Stammbäume erstellen`,
        cancel: 'Abbrechen',
        keepsOriginal: 'Der ursprüngliche Stammbaum bleibt genau so, wie er ist. Die neuen Stammbäume bleiben über ihre gemeinsamen Personen verbunden — löschen Sie unerwünschte unter Stammbäume verwalten.',
        done: (count: number) => count === 1 ? '1 Stammbaum erstellt' : `${count} Stammbäume erstellt`,
        tooSmall: 'Dieser Stammbaum enthält nur eine Familie — es gibt nichts zu teilen.',
    },

    advanced: {
        settingLabel: 'Erweiterte Felder',
        settingHint: 'Zeigt Quellen, Anhänge, Referenznummern, Namensschreibweisen und offene Fragen zu einer Person. Standardmäßig aus — eine Person, für die Sie bereits etwas ausgefüllt haben, zeigt es immer.',
    },

    surnames: {
        menu: 'Namensschreibweisen',
        title: 'Namensschreibweisen',
        intro: 'Vor etwa 1900 schreiben die Kirchenbücher eine Familie von Eintrag zu Eintrag unterschiedlich. Sagen Sie einmal, dass Schreibweisen dieselbe Familie meinen, und Suche und Zusammenführen finden sie alle — egal wie eine Person geschrieben ist, auch Personen, die Sie später hinzufügen.',
        groupsTitle: 'Verknüpfte Schreibweisen',
        none: 'Noch keine Schreibweisen verknüpft.',
        addTitle: 'Schreibweisen verknüpfen',
        addHint: 'Wählen Sie die Schreibweisen, die eine Familie meinen.',
        inTree: (count: number) => count === 1 ? '1 Person' : `${count} Personen`,
        notInTree: 'nicht im Stammbaum',
        addOther: 'Andere Schreibweise…',
        link: 'Verknüpfen',
        unlink: 'Verknüpfung lösen',
        linked: 'Schreibweisen verknüpft.',
    },

    events: {
        occupationLabel: 'Beruf / Gewerbe',
        occupationHint: 'Nur das Gewerbe selbst — „Schmied", nicht „arbeitete in Kladno als Schmied". Es wird als Beruf in GEDCOM ausgegeben.',
        participants: 'Paten & Zeugen',
        participantsHint: 'Wen der Eintrag sonst noch nennt. Ein Pate, der immer wieder auftaucht, ist meist ein Verwandter.',
        addParticipant: '+ Hinzufügen',
        participantName: 'Name wie geschrieben',
        participantNote: 'Detail (Gewerbe, „Nachbar"…)',
        participantLink: 'Mit jemandem im Stammbaum verknüpfen',
        participantUnlink: 'Nicht diese Person',
        participantInTree: 'im Stammbaum',
        participantNameRequired: 'Geben Sie einen Namen an oder verknüpfen Sie jemanden aus dem Stammbaum.',
        roles: {
            godparent: 'Pate/Patin',
            witness: 'Zeuge',
            officiant: 'Amtsperson',
            other: 'Anwesend',
        },
        title: 'Ereignisse',
        add: 'Ereignis hinzufügen',
        addTitle: 'Ereignis hinzufügen',
        editTitle: 'Ereignis bearbeiten',
        empty: 'Noch keine Ereignisse',
        edit: 'Bearbeiten',
        delete: 'Löschen',
        type: 'Typ',
        date: 'Datum',
        place: 'Ort',
        note: 'Notiz',
        customLabel: 'Bezeichnung',
        customLabelRequired: 'Geben Sie eine Bezeichnung für das eigene Ereignis ein',
        deleteConfirm: (what: string) => `Dieses Ereignis löschen?\n\n${what}`,
        types: {
            birth: 'Geburt',
            death: 'Tod',
            baptism: 'Taufe',
            burial: 'Beerdigung',
            occupation: 'Beruf',
            residence: 'Wohnort',
            military: 'Militärdienst',
            emigration: 'Auswanderung',
            immigration: 'Einwanderung',
            education: 'Ausbildung',
            custom: 'Eigenes'
        }
    },

    // Sources / citations
    sources: {
        menu: 'Quellen',
        title: 'Quellen',
        add: 'Quelle hinzufügen',
        addTitle: 'Quelle hinzufügen',
        editTitle: 'Quelle bearbeiten',
        empty: 'Noch keine Quellen',
        sectionTitle: 'Quellen',
        cite: 'Quelle zitieren',
        citePartnership: 'Quelle zitieren (Trauungseintrag…)',
        pickTitle: 'Quelle zitieren',
        searchPlaceholder: 'Quellen durchsuchen…',
        createNew: 'Neue Quelle…',
        emptyPicker: 'Keine Quellen — legen Sie eine an',
        edit: 'Bearbeiten',
        delete: 'Löschen',
        remove: 'Zitat entfernen',
        fieldTitle: 'Titel',
        fieldRepository: 'Archiv / Einrichtung',
        fieldReference: 'Signatur / Fundstelle',
        fieldUrl: 'URL',
        fieldNote: 'Notiz',
        titleRequired: 'Geben Sie einen Quellentitel ein',
        citations: (n: number) => `${n}×`,
        deleteConfirm: (title: string, n: number) =>
            n > 0
                ? `Diese Quelle löschen? Sie ist an ${n} Stelle(n) zitiert; diese Zitate werden entfernt.\n\n${title}`
                : `Diese Quelle löschen?\n\n${title}`,
    },

    // Attachments
    attachments: {
        title: 'Anhänge',
        add: 'Anhang hinzufügen',
        empty: 'Noch keine Anhänge',
        delete: 'Löschen',
        deleteConfirm: (what: string) => `Diesen Anhang löschen?\n\n${what}`,
        notePlaceholder: 'Notiz (optional)',
        total: (count: number, size: string) => `${count} ${count === 1 ? 'Anhang' : 'Anhänge'}, insgesamt ${size}`,
        pdfTooLarge: 'PDF ist zu groß (max. 2 MB).',
        unsupportedType: 'Nicht unterstützter Dateityp. Verwenden Sie JPG, PNG oder PDF.',
        readError: 'Die Datei konnte nicht gelesen werden.',
    },

    // Duplicate suggestions
    duplicates: {
        title: 'Ähnliche Personen existieren bereits:',
        goToPerson: 'Zur Person',
        useExisting: 'Vorhandene verwenden',
        parentsLabel: (names: string) => `Eltern: ${names}`,
        settingLabel: 'Duplikat-Vorschläge',
        settingHint: 'Beim Anlegen einer neuen Person ähnliche vorhandene vorschlagen',
    },

    // Overview minimap
    minimap: {
        title: 'Übersichts-Minikarte',
        settingLabel: 'Minikarte',
        settingHint: 'Eine Übersichts-Minikarte für große Stammbäume anzeigen',
    },

    // Sticky generation labels
    genLabels: {
        settingLabel: 'Generationsbeschriftungen',
        settingHint: 'Generationsnamen am linken Rand der Arbeitsfläche anheften',
    },

    // Branch colour coding
    branchColors: {
        settingLabel: 'Zweigfarben',
        legendLabel: 'Stammbaum-Legende',
        legendHint: 'Die Legende über dem Stammbaum anzeigen (Geschlechtsringe, Zweigfarben)',
        settingHint: 'Karten nach Zweig relativ zur Fokusperson einfärben',
        legendPaternal: 'Väterlich',
        legendMaternal: 'Mütterlich',
        legendDescendant: 'Nachkommen',
    },

    // Interactive tour
    tour: {
        menu: 'Rundgang starten',
        offer: 'Neu hier? Machen Sie einen kurzen Rundgang.',
        offerYes: 'Rundgang starten',
        next: 'Weiter',
        skip: 'Überspringen',
        done: 'Fertig',
        step1: 'Das ist eine Personenkarte. Klicken Sie darauf, um Aktionen zu öffnen — bearbeiten, Verwandte hinzufügen, fokussieren oder löschen.',
        step2: 'Wenn Sie mit der Maus über eine Karte fahren, erscheinen Schnell-Hinzufügen-Schaltflächen: oben ein Elternteil, rechts ein Partner, unten ein Kind. Der Kettenglied-Reiter an der oberen Kante verwaltet Partnerschaften und Eltern; das Hinzufügen eines Geschwisters finden Sie im Kartenmenü.',
        step3: 'Personen fügen Sie auch hier hinzu: eine einzelne Person oder eine ganze Familie auf einmal mit dem Familien-Assistenten.',
        step4: 'Das Fokus-Panel zeigt, auf wen der Stammbaum zentriert ist. Mit den Pfeilen ändern Sie, wie viele Generationen an Vorfahren und Nachkommen sichtbar sind.',
        step5: 'Ansichten wechseln: Familie, Nachkommen, Zeitleiste oder der Ahnen-Fächer.',
        step6: 'Zoom- und Verschiebe-Steuerung — Sie können die Arbeitsfläche auch mit der Maus ziehen und mit dem Mausrad zoomen; 0 setzt die Ansicht zurück.',
        step7: 'Suchen Sie jemanden nach Namen und filtern Sie mit dem Trichter nach Nachname, Ort, Geburtsjahren, Geschlecht oder Lebendstatus.',
        step8: 'Stammbäume, Export und Teilen finden Sie hier. Strom exportiert sich als eine einzige, in sich geschlossene Datei, die Sie einem Verwandten per E-Mail schicken können.',
    },

    // Visual family statistics (tree-stats dialog)
    stats: {
        section: 'Familienstatistik',
        topMaleNames: 'Häufigste männliche Namen',
        topFemaleNames: 'Häufigste weibliche Namen',
        lifespanByGen: 'Durchschnittliche Lebensdauer nach Generation',
        childrenByGen: 'Kinder pro Paar nach Generation',
        birthsByMonth: 'Geburten nach Monat',
        oldest: 'Person mit dem längsten Leben',
        longestMarriage: 'Längste Ehe',
        years: 'J.',
        generation: (n: number) => `Gen. ${n}`,
        sampleN: (n: number) => `n = ${n}`,
        notEnough: 'Noch nicht genug Daten',
        largestFamily: 'Größte Familie',
        childrenCount: (n: number) => n === 1 ? '1 Kind' : `${n} Kinder`,
        months: ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'],
    },

    // Anniversaries + "on this day"
    anniversaries: {
        deathHint: 'Auch jährliche Todestage anzeigen',
        menu: 'Jahrestage',
        title: 'Bevorstehende Jahrestage',
        empty: 'Keine Jahrestage in den nächsten 30 Tagen',
        today: 'heute',
        tomorrow: 'morgen',
        inDays: (n: number) => `in ${n} Tagen`,
        yearsAgo: (n: number) => `vor ${n} ${n === 1 ? 'Jahr' : 'Jahren'}`,
        birthday: (name: string, years: number) => `${name} wird ${years}`,
        wedding: (a: string, b: string, years: number) => `${a} & ${b} — ${years} Jahre verheiratet`,
        birthMilestone: (name: string, years: number) => `${name} — ${years} Jahre seit der Geburt`,
        deathMilestone: (name: string, years: number) => `${name} — ${years} Jahre seit dem Tod`,
        deathAnniversary: (name: string, years: number) => `${name} — ${years} Jahre seit dem Tod`,
        otdTitle: 'An diesem Tag',
        otdBirth: (name: string, ago: string, _female: boolean) => `${ago} wurde ${name} geboren`,
        otdDeath: (name: string, ago: string, _female: boolean) => `${ago} starb ${name}`,
        otdWedding: (a: string, b: string, ago: string) => `${ago} heirateten ${a} & ${b}`,
        settingLabel: 'An diesem Tag',
        settingHint: 'Beim Öffnen eines Stammbaums eine tägliche „An diesem Tag"-Erinnerung anzeigen',
    },

    // Family wizard (add a whole family at once)
    familyWizard: {
        menu: 'Familie hinzufügen…',
        title: 'Familie hinzufügen',
        settingLabel: 'Schaltfläche „Familie hinzufügen"',
        settingHint: 'Eine Schaltfläche „Familie hinzufügen" in der Symbolleiste anzeigen',
        aroundName: (name: string) => `Rund um ${name}`,
        roles: { father: 'Vater', mother: 'Mutter', partner: 'Partner', sibling: 'Geschwister', child: 'Kind' },
        firstName: 'Vorname',
        lastName: 'Nachname',
        year: 'Geburtsjahr',
        weddingYear: 'Hochzeitsjahr',
        addSibling: '+ Geschwister',
        addChild: '+ Kind',
        remove: 'Entfernen',
        save: 'Familie hinzufügen',
        maybe: (name: string) => `Ähnlich: ${name}`,
        useExisting: 'Vorhandene verwenden',
        linked: 'Mit vorhandener verknüpft',
        added: (n: number) => n === 1 ? '1 Person hinzugefügt' : `${n} Personen hinzugefügt`,
        continuePrompt: 'Mit dem Rest der Familie fortfahren?',
        continueYes: 'Familie hinzufügen',
    },

    // Progressive web app (offline + updates)
    pwa: {
        offline: 'Offline',
        updateReady: 'Eine neue Version ist verfügbar.',
        refresh: 'Aktualisieren',
    },

    // File System Access (work over a file on disk)
    fileAccess: {
        saveToFile: 'In Datei speichern…',
        saveToFileDesc: 'Diesen Stammbaum mit einer Datei auf der Festplatte verknüpfen — dann genügt Strg+S zum Speichern',
        openFromFile: 'Aus Datei öffnen…',
        openFromFileDesc: 'Eine JSON-Datei öffnen und verknüpft halten, damit Änderungen zurück in sie gespeichert werden',
        save: 'Speichern',
        unlink: 'Datei trennen',
        indicator: 'Mit einer Datei verknüpft',
        linkedTo: (name: string) => `Verknüpft mit ${name}`,
        saved: (name: string) => `In ${name} gespeichert`,
        linked: (name: string) => `Verknüpft mit ${name}`,
        unlinked: 'Datei getrennt',
        saveFailed: 'Speichern in die Datei nicht möglich',
        permissionDenied: 'Der Dateizugriff wurde verweigert — die Verknüpfung wurde entfernt',
        lockedRefuse: 'Entsperren Sie die Verschlüsselung, bevor Sie in eine Datei speichern',
    },

    // CSV export (spreadsheet person table)
    csv: {
        menuTitle: 'CSV exportieren',
        menuDesc: 'Personentabelle für Excel / Google Sheets',
        firstName: 'Vorname', lastName: 'Nachname', gender: 'Geschlecht',
        birthDate: 'Geboren', birthPlace: 'Geburtsort',
        deathDate: 'Gestorben', deathPlace: 'Sterbeort',
        father: 'Vater', mother: 'Mutter', partners: 'Partner', notes: 'Notizen',
    },

    // Zoom controls
    zoomControls: {
        zoomIn: 'Vergrößern',
        zoomOut: 'Verkleinern',
        reset: 'Ansicht zurücksetzen',
        fitToScreen: 'An Bildschirm anpassen',
        settingLabel: 'Schwebende Schaltflächen',
        settingHint: 'Die schwebenden Zoom-Schaltflächen über dem Stammbaum anzeigen',
    },

    // Labels
    labels: {
        nameVariants: 'Andere Schreibweisen des Namens',
        nameVariantsHint: 'Wie die Kirchenbücher ihn tatsächlich schreiben (Wischek, Vissek), ein Beiname oder der Hof, unter dem die Familie bekannt war. Mit Kommas trennen. Suche und Zusammenführen finden die Person unter jedem davon. Gilt nur für diese Person — Namensschreibweisen, die die ganze Familie teilt, gehören unter Stammbäume verwalten → Namensschreibweisen.',
        firstName: 'Vorname',
        lastName: 'Nachname',
        gender: 'Geschlecht',
        selectPerson: 'Person auswählen',
        birthDate: 'Geburtsdatum',
        birthPlace: 'Geburtsort',
        deathDate: 'Sterbedatum',
        deathPlace: 'Sterbeort',
        deceased: 'Verstorben',
        photo: 'Foto',
        photoChoose: 'Foto auswählen',
        photoRemove: 'Entfernen',
        photoRotateLeft: 'Nach links drehen',
        photoRotateRight: 'Nach rechts drehen',
        maidenName: 'Geburtsname',
        refn: 'Referenznummer',
        question: 'Offene Frage',
        startDateMarried: 'Hochzeitsdatum',
        startDatePartners: 'Beginn der Beziehung',
        startPlace: 'Ort',
        endDateMarried: 'Scheidungsdatum',
        endDatePartners: 'Ende der Beziehung',
        note: 'Notiz',
        notes: 'Notizen',
        moreInfo: 'Weitere Infos',
        partner: 'Partner',
        isPrimary: 'Hauptbeziehung'
    },

    // Tooltip
    tooltip: {
        alsoWritten: 'auch geschrieben',
        age: 'Alter',
        born: 'Geboren',
        died: 'Gestorben',
        notes: 'Notizen',
        yearsOld: (age: number) => `(${age} ${age === 1 ? 'Jahr' : 'Jahre'})`,
        childrenCount: (n: number) => `${n} ${n === 1 ? 'Kind' : 'Kinder'}`,
        gestureHint: 'Klicken, um das Menü zu öffnen',
    },

    // Placeholders
    placeholders: {
        nameVariants: 'Wischek, Vissek, beim Schmied',
        firstName: 'Vorname',
        lastName: 'Nachname',
        maidenName: 'Geburtsname',
        refn: 'z. B. Archivkasten 12 oder eine ID aus einem anderen Programm',
        question: 'z. B. Kennt jemand ihr Geburtsdatum?',
        flexDate: '15.5.1880 · 5.1880 · 1880 · um 1880'
    },

    // Archive search
    archives: {
        title: 'In Archiven suchen',
        internationalSection: 'International',
        czechSection: 'Tschechische Kirchenbücher (matriky)',
        familySearchHint: 'Vorausgefüllte Datensatzsuche (Name, Jahre, Ort)',
        suggestedFor: 'Vorgeschlagen für',
        allPortals: 'Alle tschechischen Regionalarchive',
        disclaimer: 'Externe Seiten öffnen sich in einem neuen Tab. Vorschläge beruhen auf Ortsnamen und können ungenau sein.',
    },

    // Relationship calculator
    kinship: {
        title: 'Verwandtschaft',
        fromLabel: 'Ausgangsperson',
        pickLabel: 'Wählen Sie die zweite Person:',
        isOf: 'ist, bezogen auf',
        noRelation: 'Keine Verwandtschaft gefunden (innerhalb des erfassten Stammbaums).',
        highlight: 'Im Stammbaum hervorheben',
        close: 'Schließen',
    },

    // Context menu
    contextMenu: {
        edit: 'Bearbeiten',
        focus: 'Fokussieren',
        showDescendants: 'Nachkommen anzeigen',
        relationship: 'Verwandtschaft finden…',
        archives: 'In Archiven suchen…',
        addParent: 'Elternteil hinzufügen',
        addPartner: 'Partner hinzufügen',
        addChild: 'Kind hinzufügen',
        addSibling: 'Geschwister hinzufügen',
        delete: 'Löschen'
    },

    // Family / descendants view switch
    viewModeSwitch: {
        family: 'Familie',
        descendants: 'Nachkommen',
        timeline: 'Zeitleiste',
        fan: 'Fächer',
        map: 'Karte',
        toggle: 'Familien-/Nachkommenansicht',
        back: 'Zurück zur Familienansicht',
        badgeLabel: 'Nachkommen:',
        badgeCount: (count: number) => count === 1 ? '1 Person' : `${count} Personen`,
        bloodOnly: {
            label: 'Nur Blutsverwandte',
            short: 'Blut',
            hint: 'Auch Partner und Stieffamilien anzeigen',
        },
        fullFamilies: {
            label: 'Ganze Familien',
            short: 'Familien',
            hint: 'Nur leibliche Nachkommen anzeigen',
        },
        settingLabel: 'Nachkommenansicht',
        settingHint: 'Standardmäßig die ganzen Familien der Partner anzeigen (ihre anderen Verbindungen und Stiefkinder, abgeschwächt)',
    },

    // Fan chart (ancestor semicircle)
    map: {
        fit: 'Alle Orte einpassen',
        zoomIn: 'Vergrößern',
        zoomOut: 'Verkleinern',
        scopeView: 'Diese Ansicht',
        scopeTree: 'Ganzer Stammbaum',
        noPlaces: 'Für keine der angezeigten Personen ist bisher ein Ort eingetragen.',
        noPlacesAtAll: 'Für diesen Stammbaum sind bisher keine Orte eingetragen.',
        offline: 'Kein Internet, daher kann das Kartenbild nicht geladen werden. Die bereits vorhandenen Koordinaten bleiben in Ihrem Stammbaum.',
        missing: (shown: number, missing: number) =>
            shown > 0
                ? `${strings.map.placeCount(shown)} auf der Karte, ${missing} ohne Koordinaten.`
                : `${strings.map.placeCount(missing)} noch ohne Koordinaten.`,
        lookUp: (count: number) => `${strings.map.placeCount(count)} nachschlagen`,
        placeCount: (count: number) => `${count} ${count === 1 ? 'Ort' : 'Orte'}`,
        managePlaces: 'Orte',
        allPlaced: (count: number) => `${strings.map.placeCount(count)} auf der Karte.`,
        placesTitle: 'Orte',
        placesIntro: 'Benennen Sie einen Ort um, um ihn im ganzen Stammbaum auf einmal zu korrigieren. Um einen auf die Karte zu bringen, suchen Sie unter einem Namen, den die Karte kennt — die nächstgelegene Stadt funktioniert meist. Nur die Koordinaten werden angehängt; der Ort behält den Namen, den Ihre Familie geschrieben hat.',
        nameLabel: 'Ortsname, wie im Stammbaum verwendet',
        rename: 'Umbenennen',
        renamed: (count: number) => `An ${count} ${count === 1 ? 'Stelle' : 'Stellen'} umbenannt.`,
        notOnMap: 'Noch nicht auf der Karte',
        findOnMap: 'Auf der Karte finden',
        changePin: 'Ändern',
        removePin: 'Entfernen',
        cleanOrphans: (count: number) => `Verwaiste Orte bereinigen (${count})`,
        cleanOrphansConfirm: (count: number) =>
            `Gespeicherte Koordinaten für ${count} ${count === 1 ? 'Ort' : 'Orte'} entfernen, die niemand in diesem Stammbaum mehr verwendet? Nichts, was Ihre Familie geschrieben hat, wird angetastet — nur die übrig gebliebenen Kartenmarkierungen verschwinden. Das lässt sich rückgängig machen.`,
        cleanOrphansDone: (count: number) => `${count} verwaiste ${count === 1 ? 'Ort' : 'Orte'} entfernt.`,
        wrongSpot: 'Falsche Stelle? Diesen Ort korrigieren',
        usedBy: (count: number) => count === 1 ? '1 Person' : `${count} Personen`,
        search: 'Suchen',
        searchLabel: 'Diesen Ort unter einem anderen Namen suchen',
        searching: 'Suche läuft…',
        noCandidates: 'Nichts gefunden. Versuchen Sie die nächstgelegene Stadt oder fügen Sie das Land hinzu.',
        matched: (label: string) => label ? `Zugeordnet zu ${label}` : 'Zugeordnet',
        geocodingProgress: (done: number, total: number, place: string) =>
            `Orte werden nachgeschlagen… ${done}/${total} (${place})`,
        done: (found: number) => `${strings.map.placeCount(found)} auf der Karte platziert.`,
        doneWithMisses: (found: number, missed: number) =>
            `${strings.map.placeCount(found)} platziert. ${missed} konnten nicht gefunden werden — prüfen Sie die Schreibweise oder fügen Sie das Land hinzu.`,
        consentTitle: 'Koordinaten online nachschlagen?',
        consentBody: (count: number, service: string) =>
            `Um die Karte zu zeichnen, ${count === 1 ? 'wird 1 Ortsname' : `werden ${count} Ortsnamen`} (zum Beispiel „Prag") an ${service} gesendet. `
            + 'Sonst verlässt nichts die App — keine Namen, Daten oder Verwandtschaften Ihrer Familie. '
            + 'Die Koordinaten werden in Ihren Stammbaum gespeichert, sodass jeder Ort nur einmal nachgeschlagen wird und die Karte danach offline funktioniert.',
        consentConfirm: 'Nachschlagen',
        settingLabel: 'Orte online nachschlagen',
        settingHint: 'Erlaubt der Karte, Ortsnamen an einen Geocoding-Dienst zu senden. Bereits gefundene Koordinaten bleiben in Ihrem Stammbaum.',
        tilesNotice: 'Der Kartenhintergrund stammt von openstreetmap.org — beim Laden erfährt dieser Server, welchen Bereich Sie betrachten, mehr nicht. Ihre Familiendaten bleiben in der App.',
        tilesNoticeOk: 'Karte anzeigen',
        timeMode: 'Wanderung über die Zeit',
        timeModeEmpty: 'Fügen Sie Daten (Geburt, Tod, Ereignisse) hinzu, um die Wanderung der Familie über die Zeit zu verfolgen.',
        timePlay: 'Abspielen',
        timePause: 'Pause',
        timeYear: 'Jahr',
        timeUndated: (n: number) =>
            `${n} ${n === 1 ? 'Ort' : 'Orte'} ohne Datum ${n === 1 ? 'wird' : 'werden'} auf der Zeitleiste nicht angezeigt.`,
    },

    fan: {
        generations: 'Generationen',
    },

    // Timeline view
    timeline: {
        segment: 'Zeitleiste',
        wedding: 'Heirat',
        empty: 'Keine Personen mit bekanntem Geburtsjahr',
        omitted: (n: number) => `${n} ${n === 1 ? 'Person' : 'Personen'} ohne Geburtsjahr nicht angezeigt`,
    },

    // Tree health dashboard (R4)
    treeHealth: {
        menu: 'Stammbaum-Gesundheit',
        title: (name: string) => `Stammbaum-Gesundheit: ${name}`,
        empty: 'Dieser Stammbaum hat noch keine Personen.',
        sectionValidation: 'Konsistenz',
        allGood: 'Keine Ungereimtheiten gefunden',
        countErrors: (n: number) => `${n} Fehler`,
        countWarnings: (n: number) => `${n} ${n === 1 ? 'Warnung' : 'Warnungen'}`,
        countInfos: (n: number) => `${n} ${n === 1 ? 'Hinweis' : 'Hinweise'}`,
        topIssues: 'Wichtigste Probleme',
        moreIssues: (n: number) => `und ${n} weitere…`,
        sectionCompleteness: 'Datenvollständigkeit',
        completenessHint: 'Anteil der Personen mit dem jeweils erfassten Fakt.',
        fieldBirthDate: 'Geburtsdatum',
        fieldBirthPlace: 'Geburtsort',
        fieldDeathDate: 'Sterbedatum',
        fieldPhoto: 'Foto',
        sectionStructure: 'Struktur',
        statPeople: 'Personen',
        statUnions: 'Verbindungen',
        statGenerations: 'Generationen',
        statIslands: 'Getrennte Familien',
        islandsOne: 'Alle Personen sind zu einer Familie verbunden.',
        islandsMany: (n: number) => `Dieser Stammbaum enthält ${n} getrennte Familien ohne Verbindung zueinander.`,
        islandItem: (surname: string, count: number) => `${surname} — ${count} ${count === 1 ? 'Person' : 'Personen'}`,
        islandUnnamed: 'Unbenannte Familie',
        islandsSplitHint: 'Verwenden Sie unten „In Familien aufteilen", um jeder einen eigenen Stammbaum zu geben.',
        sectionActions: 'Schnellaktionen',
        actionValidate: 'Prüfungsdetails',
        actionCleanPlaces: (n: number) => n > 0 ? `Verwaiste Orte bereinigen (${n})` : 'Verwaiste Orte bereinigen',
        actionSplit: 'In Familien aufteilen',
        switchFirst: 'Wechseln Sie zuerst zu diesem Stammbaum',
    },

    // Person modal
    personModal: {
        birthEstimate: (year: number) => `Geboren spätestens ~${year} (aus anderen Daten)`,
        birthEstimateApply: 'übernehmen',
        addTitle: 'Person hinzufügen',
        editTitle: 'Person bearbeiten',
        completeTitle: 'Person vervollständigen',
        enterName: 'Bitte geben Sie einen Vor- oder Nachnamen ein',
        unsavedMessage: 'Sie haben ungespeicherte Änderungen in den Personendetails.',
        invalidDate: 'Ungültiges Datum. Verwenden Sie z. B. 15.5.1880, 5.1880, 1880 oder „um 1880".',
        photoError: 'Das Bild konnte nicht verarbeitet werden.',
        newPersonName: 'Neue Person',
        sectionBasic: 'Grunddaten',
        sectionBirth: 'Geburt',
        sectionRelations: 'Beziehungen',
        sectionDeathEvents: 'Tod und weitere Ereignisse',
        sectionSources: 'Quellen und Anhänge',
        sectionPhotoNotes: 'Foto und Notizen',
        sectionLifeline: 'Lebenslauf',
        lifelineBorn: 'Geboren',
        lifelineDied: 'Gestorben',
        lifelineMarried: (name: string) => `Heirat mit ${name}`,
        lifelineMarriedUnknown: 'Verheiratet',
        lifelineChild: (name: string) => `Kind geboren: ${name}`,
        lifelineChildUnknown: 'Kind geboren',
        lifelineWith: (names: string) => `mit ${names}`,
        dateHint: '15.5.1880 · 5.1880 · 1880 · um 1880',
        deletePerson: 'Person löschen…',
        sumParents: 'Eltern',
        sumPartners: (n: number) => n === 1 ? '1 Partner' : `${n} Partner`,
        sumChildren: (n: number) => n === 1 ? '1 Kind' : `${n} Kinder`,
        sumEvents: (n: number) => n === 1 ? '1 Ereignis' : `${n} Ereignisse`,
        sumDeceased: 'verstorben',
        sumCitations: (n: number) => n === 1 ? '1 Zitat' : `${n} Zitate`,
        sumScans: (n: number) => n === 1 ? '1 Scan' : `${n} Scans`,
        sumPhoto: 'Foto',
        sumNote: 'Notiz',
        sumNone: 'leer',
    },

    // Relation modal
    relationModal: {
        addParent: 'Elternteil hinzufügen',
        addPartner: 'Partner hinzufügen',
        addChild: 'Kind hinzufügen',
        addSibling: 'Geschwister hinzufügen',
        linkExisting: 'Vorhandene Person verknüpfen',
        linkExistingTitle: 'Vorhandene Person verknüpfen',
        linkAsParent: 'Als Elternteil verknüpfen',
        linkAsPartner: 'Als Partner verknüpfen',
        linkAsChild: 'Als Kind verknüpfen',
        linkAsSibling: 'Als Geschwister verknüpfen',
        createNewTitle: 'Neue Person anlegen',
        selectPerson: '-- Auswählen --',
        enterName: 'Bitte geben Sie einen Vor- oder Nachnamen ein',
        selectPersonError: 'Bitte wählen Sie eine Person',
        linkButton: 'Verknüpfen'
    },

    // Child confirmation
    childConfirm: {
        title: 'Kind hinzufügen',
        message: (name: string, partnerName: string) =>
            `<strong>${name}</strong> hat einen Partner (<strong>${partnerName}</strong>).`,
        addToBoth: 'Kind zu beiden Eltern hinzufügen',
        addToOne: (name: string) => `Kind nur zu ${name} hinzufügen`
    },

    // Delete confirmation
    deleteConfirm: {
        message: (name: string, birthYear?: string) =>
            birthYear ? `„${name}" (*${birthYear}) löschen?` : `„${name}" löschen?`
    },

    // Confirmation modal
    confirmation: {
        title: 'Bestätigen'
    },

    // Relationships panel
    relationships: {
        title: (name: string) => `Beziehungen: ${name}`,
        parents: 'Eltern',
        partners: 'Partner',
        children: 'Kinder',
        siblings: 'Geschwister',
        addParent: '+ Elternteil hinzufügen',
        addPartner: '+ Partner hinzufügen',
        addChild: '+ Kind hinzufügen',
        addSibling: '+ Geschwister hinzufügen',
        remove: 'Entfernen',
        noRelationships: 'Noch keine Beziehungen',
        unsavedTitle: 'Ungespeicherte Änderungen',
        unsavedMessage: 'Sie haben ungespeicherte Änderungen in den Beziehungseinstellungen.',
        unsavedSave: 'Speichern & schließen',
        unsavedDiscard: 'Änderungen verwerfen',
        unsavedStay: 'Bleiben',
        orphanConfirm: (name: string) => `„${name}" hat keine verbleibenden Beziehungen. Diese Person löschen?`,
        orphanDelete: 'Löschen',
        orphanKeep: 'Behalten'
    },

    // Buttons
    card: {
        addTabParent: 'Elternteil',
        addTabPartner: 'Partner',
        addTabChild: 'Kind',
        relTab: 'Beziehungen',
        ageWord: 'Alter',
    },
    buttons: {
        save: 'Speichern',
        cancel: 'Abbrechen',
        close: 'Schließen',
        add: 'Hinzufügen',
        continue: 'Weiter',
        delete: 'Löschen',
        manageRelationships: 'Beziehungen verwalten',
        ok: 'OK',
        yes: 'Ja',
        no: 'Nein',
        importComplete: 'Import abgeschlossen',
        exportComplete: 'Export abgeschlossen'
    },

    // Custom dialogs
    dialog: {
        info: 'Information',
        warning: 'Warnung',
        error: 'Fehler',
        confirm: 'Bestätigen'
    },

    // Gender
    gender: {
        male: 'Männlich',
        female: 'Weiblich'
    },

    // Partnership status
    partnershipStatus: {
        married: 'Verheiratet',
        partners: 'Partner',
        divorced: 'Geschieden',
        separated: 'Getrennt'
    },

    // Parent→child relationship type
    parentRelType: {
        biological: 'Leiblich',
        adoptive: 'Adoptiv',
        step: 'Stief',
        foster: 'Pflege',
    },

    // Export
    export: {
        failed: 'Export fehlgeschlagen. Bitte versuchen Sie es erneut.',
        devModeNotSupported: 'App exportieren ist nur aus der gebauten Version (strom.html) verfügbar. Führen Sie zuerst „npm run build" aus.'
    },

    // Focus mode
    focus: {
        focusedOn: 'Fokussiert auf',
        back: 'Zurück zur vorherigen Person (Alt+←)',
        forward: 'Vorwärts (Alt+→)',
        showAll: 'Alle anzeigen',
        generationsUp: 'Generationen nach oben',
        generationsDown: 'Generationen nach unten',
        exportFocus: 'Fokus exportieren',
        hiddenPartners: (count: number) => `+${count} Partner (zum Fokussieren klicken)`,
        hiddenFamilies: (count: number) => `${count} weitere ${count > 1 ? 'Familien' : 'Familie'} mit Kindern (zum Fokussieren klicken)`,
        hiddenPartnersTooltip: 'Andere Partner',
        hiddenFamiliesTooltip: 'Andere Familien',
        collapsePartners: 'Erweiterte Partner einklappen',
        collapsePartnersLabel: '−',
        hiddenSiblingsTooltip: 'Geschwister',
        hiddenParentsTooltip: 'Eltern',
        hiddenChildrenTooltip: 'Kinder',
        branchTabParents: 'Eltern',
        branchTabSiblings: 'Geschwister',
        branchTabChildren: 'Familie',
        personCount: (visible: number, total: number) => `${visible} von ${total} Personen`
    },

    // Generation guide labels (small-caps rules on the canvas, relative to focus)
    generationLabels: {
        grandparents: 'GROSSELTERN',
        parents: 'ELTERN',
        focus: 'FOKUSGENERATION',
        children: 'KINDER',
        grandchildren: 'ENKELKINDER',
        generationN: (offset: number) => `GENERATION ${offset > 0 ? '+' : '−'}${Math.abs(offset)}`,
    },

    // Branch tabs (family context navigation)
    branchTabs: {
        viewParents: 'Als Kind ansehen (Eltern zeigen)',
        viewSiblings: 'Geschwister anzeigen',
        viewFamily: 'Als Elternteil ansehen (eigene Familie zeigen)'
    },

    // Search
    search: {
        placeholder: 'Person suchen...',
        noResults: 'Keine Ergebnisse',
        multipleResults: 'Mehrere Ergebnisse gefunden',
        selectPerson: 'Person auswählen',
        shortcutHint: '/',
        shortcutAria: 'Drücken Sie /, um zu suchen',
    },

    // Search filters
    searchFilters: {
        toggle: 'Filter',
        lastName: 'Nachname',
        place: 'Ort',
        yearFrom: 'Jahr von',
        yearTo: 'Jahr bis',
        anyGender: 'Beliebiges Geschlecht',
        anyStatus: 'Lebend oder verstorben',
        living: 'Nur Lebende',
        deceased: 'Nur Verstorbene',
        clear: 'Zurücksetzen',
        resultCount: (n: number) => `${n} ${n === 1 ? 'Ergebnis' : 'Ergebnisse'}`,
    },

    // Person picker
    personPicker: {
        placeholder: 'Person suchen...',
        noResults: 'Keine passenden Personen'
    },

    // Errors
    errors: {
        saveFailed: 'Speichern fehlgeschlagen — Ihre letzten Änderungen wurden möglicherweise nicht gespeichert! Schaffen Sie Speicherplatz oder entsperren Sie die Verschlüsselung und bearbeiten Sie es erneut.',
        parseStoredData: 'Gespeicherte Daten konnten nicht gelesen werden',
        invalidJson: 'Ungültige JSON-Datei'
    },

    // Partner selection dialog
    partnerSelection: {
        title: 'Partner auswählen',
        description: (name: string) => `Beziehungszweig für ${name} anzeigen:`
    },

    // Add child - parent selection
    addChild: {
        selectParent: 'Anderen Elternteil auswählen',
        selectParentDesc: (name: string) => `${name} hat mehrere Partner. Wählen Sie den anderen Elternteil:`,
        newPlaceholder: 'Neue Person (unbekannt)',
        unknownPerson: 'Unbekannte Person'
    },

    // About dialog
    // Small UI tooltips wired via data-i18n-title
    uiTips: {
        centerOnFocus: 'Auf die fokussierte Person zentrieren',
        showStats: 'Stammbaum-Statistik anzeigen',
        embeddedInfo: 'Info',
    },

    about: {
        title: 'Über Strom',
        version: 'Version',
        description: 'Stammbaum im Browser oder als einzelne HTML-Datei. Die Daten bleiben bei Ihnen.',
        createdBy: 'Erstellt von',
        license: 'Lizenz',
        licenseType: 'MPL-2.0 / Kommerziell',
        author: 'Autor',
        authorName: 'Milan Víšek',
        website: 'Website',
        websiteUrl: 'https://stromapp.info',
        close: 'Schließen',
        currentData: 'Aktuelle Daten',
        stats: {
            treeName: 'Stammbaum',
            trees: 'Stammbäume',
            persons: 'Personen',
            families: 'Familien',
            men: 'Männer',
            women: 'Frauen',
            generations: 'Generationen',
            oldest: 'Älteste'
        }
    },

    // GEDCOM import
    gedcom: {
        resultTitle: 'GEDCOM-Umwandlung',
        persons: 'Personen',
        partnerships: 'Partnerschaften',
        placeholders: 'Platzhalter',
        unsupported: 'Nicht unterstützt',
        saveAsJson: 'Als JSON speichern',
        saveAsJsonDesc: 'Umgewandelte Daten als JSON-Datei herunterladen',
        importAsNew: 'Als neuen Stammbaum importieren',
        importAsNewDesc: 'Als eigenen Stammbaum hinzufügen (Ihr aktueller Stammbaum bleibt)',
        mergeExisting: 'Mit Vorhandenem zusammenführen',
        mergeExistingDesc: 'Intelligentes Zusammenführen in den aktuellen Stammbaum',
        insertToTree: 'In Stammbaum einfügen',
        insertToTreeDesc: 'Umgewandelte Daten in den aktuellen Stammbaum laden',
        parseError: 'GEDCOM-Datei konnte nicht gelesen werden',
        skippedTags: 'Übersprungene Einträge',
        unknownSex: (n: number) => `${n} ${n === 1 ? 'Person' : 'Personen'} mit unbekanntem Geschlecht (Geschlecht aus der Familienrolle abgeleitet)`,
        otherFamilyLinks: (n: number) =>
            `${n} ${n === 1 ? 'Kind wurde' : 'Kinder wurden'} in mehr als einer Familie erfasst `
            + `(z. B. adoptiert); mit der Geburtsfamilie angezeigt, der Rest bei der Person vermerkt`,
        photos: 'Fotos',
        documents: 'Dokumente',
        sources: 'Quellen',
        events: 'Ereignisse',
        notes: 'Notizen',
        allImported: 'Alles in der Datei wurde importiert.',
        viewCutTooSmall: 'Zeigen Sie mehr Personen an (Familien- oder Nachkommenansicht), bevor Sie aus der Ansicht einen Stammbaum erstellen.',
        viewCutName: (name: string) => `${name} — Auswahl`,
        externalMedia: (n: number) => `Die Datei verweist auf ${n} ${n === 1 ? 'externe Mediendatei' : 'externe Mediendateien'} (Plattformen exportieren Fotos als eigenen Ordner/ZIP — entpacken Sie ihn zuerst).`,
        attachMedia: 'Mediendateien anhängen…',
        downloadMedia: 'Fotos aus dem Internet herunterladen',
        downloading: (done: number, total: number) => `Fotos werden heruntergeladen… ${done}/${total}`,
        mediaAttached: (matched: number, total: number) => `${matched} von ${total} referenzierten Dateien angehängt.`,
        mediaNoMatch: 'Keine der ausgewählten Dateien passt zu den referenzierten Namen.',
    },

    // Notes the GEDCOM importer writes into the data itself (persisted).
    gedcomNotes: {
        altBirth: 'Geburt (alternativer Eintrag)',
        altDeath: 'Tod (alternativer Eintrag)',
        remarriage: (divorced: string, married: string) => `Geschieden ${divorced}, erneut geheiratet ${married}`,
        remarriageNoDate: (married: string) => `Geschieden, erneut geheiratet ${married}`,
        engagement: (date: string) => `Verlobung: ${date}`,
        association: (name: string, label: string) => `Verknüpfung: ${name} (${label})`,
        email: (value: string) => `E-Mail: ${value}`,
        adoptedChild: 'adoptiertes Kind',
        fosterChild: 'Pflegekind',
        child: 'Kind',
        parentAnd: ' und ',
        alsoRecorded: (kind: string, parents: string) => `Auch erfasst als ${kind} von ${parents}.`,
        alsoRecordedNoParents: (kind: string) => `Auch als ${kind} in einer anderen Familie erfasst.`,
    },

    // Save current data dialog
    saveCurrent: {
        title: 'Aktuelle Daten speichern?',
        message: 'Sie haben vorhandene Daten. Möchten Sie sie speichern, bevor Sie fortfahren?',
        exportJson: 'JSON exportieren',
        exportApp: 'App exportieren',
        continueWithout: 'Ohne Speichern fortfahren'
    },

    // Validation messages
    validation: {
        parseError: 'Fehler beim Lesen der Datei',
        invalidStructure: 'Ungültige Dateistruktur',
        missingPersons: 'Personendaten fehlen',
        missingPartnerships: 'Partnerschaftsdaten fehlen',
        missingField: 'Pflichtfeld fehlt',
        invalidReference: 'Ungültiger Verweis in den Daten',
        missingGedcomHeader: 'GEDCOM-Kopf fehlt',
        noIndividuals: 'Keine Personen in der Datei gefunden',
        fileTooShort: 'Datei ist zu kurz oder leer',
        invalidLine: 'Ungültiges Zeilenformat',
        unknownError: 'Unbekannter Fehler',
        continueWithWarnings: 'Mit Warnungen fortfahren',
        validationFailed: 'Prüfung fehlgeschlagen',
        warnings: 'Warnungen',
        errors: 'Fehler',
        noVersion: 'Datei ohne Versionsangabe (älteres Format)',
        olderVersion: 'Datei stammt aus einer älteren Version',
        newerVersion: 'Datei stammt aus einer neueren Version (mögliche Kompatibilitätsprobleme)',
        newerDataTitle: 'Neuere Datenversion erkannt',
        newerDataInStorage: 'Ihre gespeicherten Daten wurden mit einer neueren Version der Anwendung erstellt.',
        newerDataInImport: 'Diese Datei wurde mit einer neueren Version der Anwendung erstellt.',
        newerDataWarning: 'Das Öffnen mit dieser älteren Version kann zu Datenverlust oder Fehlern führen.',
        newerDataSolution: 'Empfohlen: Exportieren Sie Ihre Daten als JSON und importieren Sie sie in der neueren Version.',
        exportAndExit: 'JSON exportieren & schließen',
        getNewerVersion: 'Bitte verwenden Sie eine neuere Version der Anwendung, um diese Datei zu öffnen.',
        yourVersion: 'Ihre App-Version',
        dataVersion: 'Datenversion',
        viewOnlyAllowed: 'Sie können diese Daten ansehen, aber der Import ist deaktiviert, um Datenverlust zu verhindern.',
        viewOnly: 'Nur ansehen (schreibgeschützt)',
        importBlocked: 'Import blockiert',
        importBlockedNewer: 'Import nicht möglich: Diese Datei benötigt eine neuere Version der Anwendung.',
        jsonNewerVersion: 'Diese JSON-Datei wurde mit einer neueren Version (v%d) erstellt. Ihre App unterstützt Version %d.'
    },

    // Merge import
    merge: {
        title: 'Daten zusammenführen',
        analyzing: 'Personen werden analysiert...',
        matches: 'Übereinstimmungen',
        conflicts: 'Konflikte',
        newPersons: 'Neue Personen',
        tabAll: 'Alle',
        highConfidence: 'Hoch',
        mediumConfidence: 'Mittel',
        lowConfidence: 'Niedrig',
        unmatched: 'Ohne Übereinstimmung',
        confirm: 'Bestätigen',
        reject: 'Ablehnen',
        skip: 'Überspringen',
        unskip: 'Nicht überspringen',
        skipped: 'Übersprungen',
        skipTooltip: 'Diese Person gar nicht übernehmen — weder zusammenführen noch hinzufügen (anders als Ablehnen, das sie als neue Person importiert).',
        statsSkipped: 'Übersprungen',
        skippedCount: (n: number) => `${n} übersprungen`,
        changeMatch: 'Ändern',
        manualMatch: 'Mit Vorhandener abgleichen',
        reanalyze: 'Neu analysieren',
        execute: 'Zusammenführen ausführen',
        updateOnlyLabel: 'Nur vorhandene Personen aktualisieren (keine neuen hinzufügen)',
        updateOnlyHint: 'Abgeglichene Personen aus dem Import anreichern, aber keine neuen Personen hinzufügen.',
        mergeViewInto: 'Diese Ansicht zusammenführen mit…',
        mergeViewDescription: 'Die aktuell angezeigten Personen zusammenführen mit:',
        mergeViewSourceLabel: 'Aktuelle Ansicht',
        mergeViewEmpty: 'Nichts zusammenzuführen — die aktuelle Ansicht ist leer.',
        mergeViewNoTarget: 'Kein anderer Stammbaum zum Zusammenführen.',
        keepExisting: 'Vorhandenes behalten',
        useImport: 'Aus dem Import übernehmen',
        complete: 'Zusammenführen abgeschlossen',
        failed: 'Zusammenführen fehlgeschlagen',
        switchToNewTree: 'Zum neuen Stammbaum wechseln?',
        stats: (merged: number, added: number) =>
            `${merged} Personen zusammengeführt, ${added} neue Personen hinzugefügt`,
        noItems: 'Keine Einträge zum Anzeigen',
        newPerson: 'Neu',
        selectExisting: '-- Vorhandene Person auswählen --',
        selectExistingError: 'Bitte wählen Sie eine Person',
        importCount: 'Import',
        existingCount: 'Vorhanden',
        statsMatches: 'Übereinstimmungen',
        statsConflicts: 'Konflikte',
        statsNew: 'Neu',
        mergeInto: 'In vorhandenen Stammbaum zusammenführen',

        wizardTitle: 'Daten zusammenführen',
        wizardExplanation: 'Prüfen Sie, wie importierte Personen mit vorhandenen Daten übereinstimmen. Grün = bestätigte Übereinstimmung, Gelb = zu prüfen, Blau = neue Person.',
        stepReview: 'Übereinstimmungen prüfen',
        stepResolve: 'Konflikte lösen',
        stepExecute: 'Zusammenführen ausführen',

        closeConfirmTitle: 'Zusammenführen schließen?',
        closeConfirmMessage: 'Sie haben ungespeicherten Fortschritt beim Zusammenführen.',
        closeDiscard: 'Änderungen verwerfen',
        closeSave: 'Für später speichern',
        closeCancel: 'Weiter zusammenführen',

        pendingMerges: 'Ausstehende Zusammenführungen',
        pendingMergeFound: 'Sie haben eine ausstehende Zusammenführungssitzung',
        resume: 'Fortsetzen',
        discard: 'Verwerfen',
        savedAt: 'Gespeichert',
        progress: 'Fortschritt',
        reviewedCount: (reviewed: number, total: number) =>
            `${reviewed}/${total} geprüft`,

        highConfidenceTooltip: 'Starke Übereinstimmung: Namen, Daten und Beziehungen passen zusammen',
        mediumConfidenceTooltip: 'Wahrscheinliche Übereinstimmung: teilweise Datenübereinstimmung oder Familienverbindung — bitte prüfen',
        lowConfidenceTooltip: 'Mögliche Übereinstimmung: geringe Datenübereinstimmung — sorgfältige Prüfung nötig',
        newPersonTooltip: 'Wird als neue Person hinzugefügt',

        matchReasons: {
            exact_name_gender_birthdate: 'Exakter Name und Geburtsdatum',
            name_gender_birthyear: 'Name und Geburtsjahr',
            name_gender_parents: 'Name und übereinstimmende Eltern',
            name_similarity_relationships: 'Ähnlicher Name mit Familienkontext',
            first_name_match: 'Vorname stimmt überein (anderer Nachname)',
            first_name_birthyear: 'Vorname und Geburtsjahr',
            lastname_birthyear: 'Nachname und Geburtsjahr',
            partner_of_matched: 'Partner einer abgeglichenen Person',
            child_of_matched: 'Kind einer abgeglichenen Person',
            parent_of_matched: 'Elternteil einer abgeglichenen Person',
            partner_similarity: 'Ähnliche Partnernamen',
            manual: 'Manueller Abgleich'
        },

        resolveConflicts: 'Lösen',

        newTreeNamePrompt: 'Geben Sie einen Namen für den zusammengeführten Stammbaum ein:',
        pendingGate: (n: number) => `${n} unsichere ${n === 1 ? 'Übereinstimmung' : 'Übereinstimmungen'} noch offen — diese Personen werden als GETRENNTE Personen importiert (Sie können sie später zusammenführen). Fortfahren?`,
        suggestedPrecise: 'vorgeschlagen — genaueres Datum',
        suggestedComplete: 'vorgeschlagen — vollständigerer Wert',

        photoConflict: 'zwei verschiedene Fotos',

        preValidationWarning: (existing: number, incoming: number) =>
            `Der vorhandene Stammbaum hat ${existing} ${existing === 1 ? 'Problem' : 'Probleme'}, der neue ${incoming} — beim Zusammenführen werden sie übernommen.`,
        preValidationHint: 'Sie können sie zuerst über die Prüfung beheben.',
        newIssuesTitle: 'Zusammenführen hat neue Probleme verursacht',
        newIssues: (n: number) =>
            `Zusammenführen hat ${n} ${n === 1 ? 'neues Problem' : 'neue Probleme'} verursacht — Prüfung öffnen?`,

        incomingPerson: 'Neue Person:',

        existingTree: 'Vorhandener Stammbaum',
        incomingTree: 'Neue Daten',

        pendingMergeLabel: 'Ausstehende Zusammenführung',
        pendingMergeInto: (source: string, target: string) => `${source} → ${target}`,
        pendingMergeFrom: (source: string) => `aus ${source}`,
        pendingMergeConflicts: (count: number) => `${count} Konflikte`
    },

    // Person merge (duplicate resolution)
    personMerge: {
        title: 'Personen zusammenführen',
        keepPerson: 'Behalten',
        mergeWith: 'Zusammenführen mit',
        selectPerson: 'Person zum Zusammenführen auswählen...',
        fieldConflicts: 'Feldkonflikte',
        partnershipConflicts: 'Partnerschaftskonflikte',
        keepValue: 'Behalten',
        useOther: 'Vom anderen übernehmen',
        mergePartnership: 'Partnerschaften zusammenführen',
        keepBoth: 'Beide Partnerschaften behalten',
        noConflicts: 'Keine Konflikte — die Daten werden kombiniert',
        confirmMerge: 'Personen zusammenführen',
        mergeComplete: 'Personen erfolgreich zusammengeführt',
        samePersonError: 'Eine Person kann nicht mit sich selbst zusammengeführt werden',
        willBeDeleted: 'wird gelöscht',
        relationshipsTransferred: 'Beziehungen werden übertragen'
    },

    // Settings
    settings: {
        title: 'Einstellungen',
        theme: 'Erscheinungsbild',
        themeSystem: 'System (folgt dem Betriebssystem)',
        themeLight: 'Hell',
        themeDark: 'Dunkel',
        language: 'Sprache',
        languageSystem: 'System (Browsersprache)',
        close: 'Schließen'
    },

    // Tree Manager
    treeManager: {
        defaultTreeName: 'Mein Stammbaum',
        newTree: 'Neuer Stammbaum',
        manageTreesTitle: 'Stammbäume verwalten',
        treeSwitcher: 'Stammbaum',
        open: 'Öffnen',
        moreActions: 'Weitere Aktionen',
        searchTrees: 'Stammbäume durchsuchen…',
        pendingSection: 'Unfertige Zusammenführungen',
        cannotHideLastVisible: 'Der letzte sichtbare Stammbaum kann nicht ausgeblendet werden — blenden Sie zuerst einen anderen ein.',
        activeBadge: 'Aktiv',
        lockedBadge: 'Gesperrt',
        hiddenBadge: 'Ausgeblendet',
        rename: 'Umbenennen',
        duplicate: 'Duplizieren',
        duplicateTitle: 'Stammbaum duplizieren',
        newTreeNameLabel: 'Neuer Stammbaum-Name',
        mergeInto: 'Zusammenführen mit...',
        delete: 'Löschen',
        export: 'Export',
        newTreePlaceholder: 'Stammbaum-Name',
        confirmDelete: (name: string) => `Stammbaum „${name}" löschen? Das kann nicht rückgängig gemacht werden.`,
        duplicateSuffix: '(Kopie)',
        selectTargetTree: 'Zielstammbaum auswählen',
        mergeSourceTree: 'Stammbaum zusammenführen',
        mergeIntoTree: 'in',
        startMerge: 'Zusammenführen starten',
        importTreeName: 'Importierter Stammbaum',
        importAsNewTree: 'Als neuen Stammbaum importieren',
        treeNameLabel: 'Stammbaum-Name',
        persons: 'Personen',
        families: 'Familien',
        stats: 'Statistik',
        statsTitle: 'Stammbaum-Statistik',
        statsPeople: 'Personen',
        statsTotal: 'Gesamt',
        statsMales: 'Männer',
        statsFemales: 'Frauen',
        statsLiving: 'Lebend',
        statsDeceased: 'Verstorben',
        statsFamilies: 'Familien',
        statsPartnerships: 'Partnerschaften',
        statsAvgChildren: 'Durchschn. Kinder',
        statsDateRange: 'Zeitraum',
        statsGenerations: 'Generationen',
        statsYearSpan: 'Abgedeckte Jahre',
        statsData: 'Datenvollständigkeit',
        statsWithBirthDate: 'Mit Geburtsdatum',
        statsWithDeathDate: 'Mit Sterbedatum',
        statsWithBirthPlace: 'Mit Geburtsort',
        statsPhotos: 'Fotos',
        statsEvents: 'Ereignisse',
        statsSources: 'Quellen',
        statsSourceCoverage: 'Quellenabdeckung',
        statsAttachments: 'Anhänge',
        statsMediaWarning: 'Über 10 MB an Medien — die Datei könnte für den E-Mail-Versand zu groß sein',
        statsSize: 'Speicher',
        statsTreeSize: 'Stammbaumgröße',
        statsAnniversaries: 'Bevorstehende Jahrestage',
        statsAnniversariesNone: 'Keine Jahrestage in den nächsten 30 Tagen',
        statsToday: 'Heute',
        statsThisWeek: 'Diese Woche',
        statsThisMonth: 'Diesen Monat',
        statsBirthday: 'Geburtstag',
        statsBirthAnniversary: 'wäre',
        statsWeddingAnniversary: 'Hochzeitstag',
        statsMemorial: 'Gedenktag',
        statsYears: 'Jahre',
        validateDesc: 'Stammbaum auf Fehler prüfen',
        validationTitle: 'Stammbaum-Prüfung',
        postImportCheckTitle: 'Datenprüfung',
        postImportCheck: (n: number) => `Wir haben die importierten Daten geprüft und ${n} ${n === 1 ? 'Sache' : 'Sachen'} gefunden, die einen Blick wert ${n === 1 ? 'ist' : 'sind'}. Ansehen?`,
        postImportReview: 'Ansehen',
        validationPassed: 'Keine Probleme gefunden',
        validationErrors: 'Fehler',
        validationWarnings: 'Warnungen',
        validationInfos: 'Infos',
        validationIssuesFound: 'Probleme gefunden',
        valCycle: 'Vorfahrenzyklus erkannt',
        valSelfPartnership: 'Partnerschaft mit sich selbst',
        valDuplicatePartnership: 'Doppelte Partnerschaft',
        valMissingChildRef: 'Elternteil fehlt Kindverweis',
        valMissingParentRef: 'Kind fehlt Elternverweis',
        valMissingPartnershipRef: 'Person fehlt Partnerschaftsverweis',
        valPartnershipChildMismatch: 'Partnerschaft-Kind-Abweichung',
        valOrphanedRef: 'Verweis auf nicht vorhandenen Datensatz',
        valTooManyParents: 'Mehr als 2 Eltern',
        valParentYoungerThanChild: 'Elternteil jünger als Kind',
        valParentTooYoung: 'Elternteil bei Geburt sehr jung',
        valParentTooOld: 'Elternteil bei Geburt sehr alt',
        valGenerationConflict: 'Person in mehreren Generationen',
        valPartnerIsParent: 'Partner ist auch Elternteil',
        valPartnerIsChild: 'Partner ist auch Kind',
        valSiblingIsParent: 'Geschwister ist auch Elternteil',
        valSiblingIsChild: 'Geschwister ist auch Kind',
        valEventBirthDeath: 'Geburt/Tod als Lebensereignis erfasst (gehört in die Datumsfelder)',
        valEventNoLabel: 'Eigenes Ereignis hat keine Bezeichnung',
        valEventBadDate: 'Ereignis hat ein ungültiges Datum',
        valDeathBeforeBirth: 'Sterbedatum liegt vor dem Geburtsdatum',
        valImplausibleLifespan: 'Unplausibel lange Lebensdauer',
        valEventBeforeBirth: 'Ereignis vor der Geburt datiert',
        valEventAfterDeath: 'Ereignis nach dem Tod datiert',
        valWeddingBeforeBirth: 'Hochzeit vor der Geburt eines Partners datiert',
        valWeddingAfterDeath: 'Hochzeit nach dem Tod eines Partners datiert',
        valChildMarriage: 'Als Kind verheiratet',
        valChildAfterMotherDeath: 'Kind nach dem Tod der Mutter geboren',
        valChildAfterFatherDeath: 'Kind lange nach dem Tod des Vaters geboren',
        valCitationMissingSource: 'Zitat verweist auf eine fehlende Quelle',
        valAttachmentNoData: 'Anhang hat keine verwendbaren Daten',
        valPartnerAgeGap: 'Extremer Altersunterschied zwischen Partnern',
        valPossibleDuplicate: 'Mögliche doppelte Person (gleicher Name und Geburtsjahr)',
        valPlaceSpelling: 'Ein Ort auf mehrere Arten geschrieben',
        valRecurringGodparent: 'Ein Pate, der immer wieder auftaucht — oft ein Verwandter',
        valRecurringGodparentDetail: (name: string, events: number, people: number, whose: string) =>
            `${name} — bei ${events} Ereignissen von ${people} Personen · ${whose}`,
        valRecurringGodparentByName: 'nach Namen abgeglichen',
        valOrphanedParticipantRef: 'Ereignisbeteiligter verweist auf eine nicht mehr vorhandene Person',
        valOrphanedParticipantDetail: (person: string, event: string, who: string) =>
            `${person} · ${event}: ${who}`,
        valFix: 'Beheben',
        valFixAll: 'Alle beheben',
        valFixed: (count: number) => `${count} ${count === 1 ? 'Problem' : 'Probleme'} behoben`,
        defaultPerson: 'Standardperson',
        defaultPersonDesc: 'Beim Öffnen dieses Stammbaums fokussieren auf:',
        defaultPersonFirstPerson: 'Erste Person',
        defaultPersonLastFocused: 'Zuletzt fokussiert',
        defaultPersonSpecific: 'Bestimmte Person:',
        defaultTree: 'Standard-Stammbaum',
        defaultTreeDesc: 'Beim Öffnen der App laden:',
        defaultTreeFirstTree: 'Erster Stammbaum',
        defaultTreeLastFocused: 'Zuletzt fokussiert',
        defaultTreeSpecific: 'Bestimmter Stammbaum:',
        newTreeMenu: 'Neuer Stammbaum',
        emptyTree: 'Leerer Stammbaum',
        emptyTreeDesc: 'Mit einem leeren Stammbaum beginnen',
        fromJson: 'Aus JSON',
        fromJsonDesc: 'Aus JSON-Datei importieren',
        fromGedcom: 'Aus GEDCOM',
        fromGedcomDesc: 'Aus GEDCOM-Datei importieren',
        fromHtml: 'Aus HTML-Datei',
        fromHtmlDesc: 'Aus exportierter Strom-HTML-Datei importieren',
        htmlNoData: 'Keine eingebetteten Daten in der HTML-Datei gefunden',
        fromFocus: 'Aus aktueller Ansicht',
        fromFocusDesc: 'Sichtbare Personen in einen neuen, eigenen Stammbaum kopieren',
        noFocusedData: 'Keine fokussierten Daten, um einen Stammbaum zu erstellen',
        exportAll: 'Alle Stammbäume exportieren',
        exportAllJson: 'Als JSON exportieren',
        exportAllJsonDesc: 'Alle Stammbäume in einer JSON-Datei',
        exportAllApp: 'Als App exportieren',
        exportAllAppDesc: 'Eigenständige HTML-Datei mit allen Stammbäumen',
        showTree: 'Stammbaum einblenden',
        hideTree: 'Stammbaum ausblenden',
        hide: 'Ausblenden',
        showTreeHint: 'Stammbaum einblenden',
        hideTreeHint: 'Stammbaum ausblenden',
        hiddenLabel: '(ausgeblendet)'
    },

    // Collaboration: send to a relative
    share: {
        menuItem: '📩 An einen Verwandten senden',
        menuDesc: 'Eine Datei per E-Mail — er öffnet sie, ergänzt, was er weiß, und schickt sie zurück',
        passwordLabel: 'Passwort (optional)',
        dialogTitle: 'An einen Verwandten senden',
        dialogIntro: 'Erstellt eine einzelne Datei, die Sie per E-Mail versenden können. Der Empfänger öffnet sie einfach — keine Installation, kein Konto.',
        scopeLabel: 'Was gesendet wird',
        scopeWhole: 'Der ganze Stammbaum',
        scopeBranch: 'Die aktuelle Ansicht (sichtbarer Zweig)',
        senderNameLabel: 'Ihr Name (dem Empfänger angezeigt)',
        messageLabel: 'Nachricht für den Empfänger',
        messagePlaceholder: 'Hallo! Könntest du ergänzen, was du über deinen Zweig weißt?',
        createFile: 'Datei zum Senden erstellen',
        welcomeTitle: (sender: string) => `${sender} hat Ihnen einen Stammbaum geschickt`,
        welcomeCounts: (tree: string, persons: number) => `„${tree}" · ${persons} Personen`,
        welcomeView: 'Nur umsehen',
        welcomeEdit: 'Ergänzen, was ich weiß',
        collabBar: (sender: string) => `Sie ergänzen einen Stammbaum für ${sender}.`,
        collabSend: 'Die Datei zurücksenden',
        collabHide: 'Ausblenden',
        collabBadgeTitle: 'Zusammenarbeit läuft',
        replyTitle: (sender: string) => `${sender} hat Ihren Stammbaum zurückgeschickt`,
        replyIntro: (tree: string) => `Diese Datei antwortet auf Ihren geteilten Stammbaum „${tree}". Ihre Ergänzungen einfügen?`,
        replyMerge: 'Prüfen und zusammenführen',
        replyView: 'Erst nur ansehen',
        replyImport: 'Als neuen Stammbaum importieren',
        unknownSender: 'Ein Verwandter'
    },

    // Change packets (send only changes)
    shareDiff: {
        scopeChanges: 'Nur die Änderungen seit dem letzten Teilen',
        changesHint: 'Dies sendet nur Ihre Ergänzungen. Schicken Sie die Datei an denjenigen zurück, der den Stammbaum mit Ihnen geteilt hat.',
        packetSaved: 'Änderungsdatei gespeichert',
        noChanges: 'Seit dem letzten Teilen hat sich nichts geändert',
        baselineMissing: 'Die Ausgangsbasis für diese Änderungen fehlt — bitten Sie stattdessen um die ganze Datei',
        treeNotFound: 'Kein passender Stammbaum für diese Änderungen — bitten Sie den Absender stattdessen um die ganze Datei',
        previewTitle: (sender: string) => `${sender} hat Ihnen Änderungen geschickt`,
        previewIntro: (tree: string) => tree ? `Diese Ergänzungen aktualisieren Ihren Stammbaum „${tree}".` : 'Diese Ergänzungen aktualisieren Ihren Stammbaum.',
        accept: 'Änderungen übernehmen',
        reviewDetail: 'Im Detail prüfen',
        newPeople: (n: number) => `${n} neue ${n === 1 ? 'Person' : 'Personen'}`,
        updatedPeople: (n: number) => `${n} aktualisiert`,
        media: (n: number) => `${n} ${n === 1 ? 'Foto oder Datei' : 'Fotos oder Dateien'}`,
        placesChip: (n: number) => `${n} ${n === 1 ? 'Ort' : 'Orte'}`,
        surnameGroups: (n: number) => `${n} ${n === 1 ? 'Namensverknüpfung' : 'Namensverknüpfungen'}`,
        removed: (n: number) => `${n} entfernt`,
        sectionNew: 'Neue Personen',
        sectionUpdated: 'Aktualisierte Personen',
        fieldOther: 'weitere Details',
        changedFields: (fields: string) => `geändert: ${fields}`,
        andMore: (n: number) => `+${n} weitere`,
        applied: (added: number, updated: number) => `Übernommen — ${added} hinzugefügt, ${updated} aktualisiert`,
        alreadyApplied: 'Diese Änderungen sind bereits in Ihrem Stammbaum — nichts zu übernehmen.',
    },

    // View Mode (embedded data)
    viewMode: {
        banner: 'Ansichtsmodus (schreibgeschützt)',
        bannerDetail: 'Wählen Sie, wie es weitergeht:',
        goOnline: 'Zu stromapp.info gehen',
        goOnlineHint: 'Empfohlen',
        stayOffline: 'Bei dieser Datei bleiben',
        importButton: 'In den Speicher importieren',
        existingTitle: 'Stammbaum existiert bereits',
        existingMessage: 'Ein Stammbaum aus diesem Export ist bereits in Ihrem Speicher.',
        viewStored: 'Gespeicherte Version ansehen',
        viewEmbedded: 'Eingebettete Version ansehen',
        updateStored: 'Speicher aktualisieren',
        importTitle: 'Stammbaum importieren',
        importMessage: 'Diesen Stammbaum in Ihren lokalen Speicher importieren, um die Bearbeitung zu ermöglichen?',
        createNew: 'In den Speicher importieren',
        createCopy: 'Kopie erstellen',
        importSuccess: 'Stammbaum erfolgreich importiert',
        importAllSuccess: (count: number) => `${count} ${count === 1 ? 'Stammbaum' : 'Stammbäume'} erfolgreich importiert`,
        updateSuccess: 'Speicher erfolgreich aktualisiert'
    },

    // Encryption
    encryption: {
        enable: 'Daten verschlüsseln',
        warning: 'Wenn Sie das Passwort vergessen, können Ihre Daten nicht wiederhergestellt werden.',
        setPassword: 'Passwort festlegen',
        confirmPassword: 'Passwort bestätigen',
        enterPassword: 'Passwort eingeben',
        wrongPassword: 'Falsches Passwort',
        exportPassword: 'Export-Verschlüsselung',
        exportPasswordHint: 'Legen Sie ein Passwort fest, um die Datei zu verschlüsseln, oder exportieren Sie ohne Verschlüsselung.',
        exportWithPassword: 'Verschlüsselt exportieren',
        exportWithoutPassword: 'Ohne Verschlüsselung exportieren',
        passwordMismatch: 'Passwörter stimmen nicht überein',
        minLength: 'Das Passwort muss mindestens 6 Zeichen lang sein',
        encryptionEnabled: 'Verschlüsselung aktiviert',
        encryptionDisabled: 'Verschlüsselung deaktiviert',
        unlockData: 'Daten entsperren',
        decryptionFailed: 'Daten konnten nicht entschlüsselt werden',
        changePassword: 'Passwort ändern',
        currentPassword: 'Aktuelles Passwort',
        newPassword: 'Neues Passwort',
        passwordChanged: 'Passwort erfolgreich geändert',
        optional: '(optional)',
        dataEncrypted: 'Daten sind verschlüsselt',
        enterPasswordToView: 'Passwort eingeben, um anzusehen'
    },

    // Tree Preview
    treePreview: {
        linkCardTitle: 'Verknüpfungskarte — diese Person gehört zu einer benachbarten Familie; ihr eigener Ehepartner und ihre Kinder leben dort.',
        bigFamilyHint: 'Eine große Familie — die Vorschau beginnt beim Oberhaupt; klicken Sie auf Personen, um sich zu bewegen.',
        title: 'Stammbaum-Vorschau',
        close: 'Schließen',
        focusedOn: 'Fokussiert auf',
        clickToFocus: 'Klicken Sie auf eine Person, um sie zu fokussieren',
        compare: 'Stammbäume vergleichen',
        preview: 'Vorschau',
        comparePersons: 'Vergleichen'
    },

    // Cross-tree links
    slideshow: {
        menu: 'Diashow (TV-Modus)',
        menuDesc: 'Ein automatischer Flug durch den Stammbaum — für den Familienbildschirm',
        needMore: 'Zeigen Sie mehr Personen an, bevor Sie die Diashow starten.',
        runsInFamily: 'Die Diashow läuft in der Familienansicht',
        hint: 'Leertaste = Pause · ← → = bewegen · Esc = beenden',
        paused: 'Pausiert',
    },

    cardDensity: {
        settingLabel: 'Kartendetail',
        compact: 'Kompakt — nur Namen',
        normal: 'Normal — Namen und Jahre',
        detailed: 'Detailliert — + Ort und Alter',
    },

    fanChart: {
        settingLabel: 'Fächerdiagramm',
        kekuleHint: 'Kekulé-(Ahnen-)Nummern anzeigen',
    },

    crossTree: {
        badgeTitle: (count: number) => `In ${count} ${count === 1 ? 'weiterem Stammbaum' : 'weiteren Stammbäumen'} gefunden`,
        settingLabel: 'Stammbaum-übergreifende Verbindungen',
        settingHint: 'Ein Abzeichen anzeigen, wenn eine Person auch in einem anderen Stammbaum vorkommt',
        tooltipHeader: 'Auch in:',
        clickToSwitch: 'Zum Wechseln klicken',
        chooserHeader: 'In Stammbaum öffnen…'
    },

    // Embedded Mode (local HTML file)
    embeddedMode: {
        banner: 'Eigenständige Datei',
        bannerDetail: 'Diese Datei hat ihren eigenen, getrennten Datenspeicher.',
        goOnline: 'stromapp.info',
        exportJson: 'JSON exportieren',
        exportJsonDesc: 'Für den Import in die Online-Version',
        saveFile: 'Datei speichern',
        saveFileTitle: 'Datei mit aktuellen Daten herunterladen',
        unsavedWarning: 'Sie haben ungespeicherte Änderungen. Verwenden Sie „Datei speichern", um sie zu behalten.',
        infoTitle: 'Über diese Datei',
        infoText1: 'Dies ist eine eigenständige HTML-Datei. Ihre Daten werden im Speicher dieses Browsers gespeichert.',
        infoText2: 'Die Web-App auf stromapp.info hat ihren eigenen, getrennten Speicher. Die Daten werden NICHT zwischen ihnen synchronisiert.',
        infoHow: 'Ihre Möglichkeiten:',
        infoStayOffline: 'Diese Datei weiter verwenden',
        infoStayOfflineDesc: 'Ihre Daten bleiben in diesem Browser. Verwenden Sie „Datei speichern", um eine Kopie mit Ihren Änderungen herunterzuladen.',
        infoGoOnline: 'Zu stromapp.info wechseln',
        infoGoOnlineDesc: 'Verwenden Sie stattdessen die Web-App. Sie müssen diese Datei dort importieren, um Ihre Daten zu übertragen.'
    },

    // Import from offline version (intro text in new tree menu)
    importFromOffline: {
        description: 'Willkommen bei stromapp.info! Um mit Ihren Daten fortzufahren, importieren Sie die Datei, die Sie verwendet haben.'
    },

    // Lock
    lock: {
        lockPerson: 'Sperren',
        unlockPerson: 'Entsperren',
        lockTree: 'Stammbaum sperren',
        unlockTree: 'Stammbaum entsperren',
        lockedTooltip: 'Gesperrt'
    },

    // Audit Log
    auditLog: {
        title: 'Änderungsverlauf',
        empty: 'Noch keine Einträge erfasst.',
        clear: 'Verlauf löschen',
        clearConfirm: 'Den gesamten Änderungsverlauf löschen? Das kann nicht rückgängig gemacht werden.',
        entries: (count: number) => `${count} ${count === 1 ? 'Eintrag' : 'Einträge'}`,
        today: 'Heute',
        yesterday: 'Gestern',
        enableSetting: 'Änderungsverlauf',
        enabled: 'Änderungsverlauf aktiviert',
        disabled: 'Änderungsverlauf deaktiviert',
        viewLog: 'Änderungsverlauf',
        exportInclude: 'Änderungsverlauf einschließen',
        exportTxt: 'TXT exportieren',
        createdPerson: (name: string) => `Person angelegt: ${name}`,
        createdPlaceholder: (gender: string) => `Platzhalter angelegt (${gender})`,
        updatedPerson: (name: string, fields: string) => `${name} aktualisiert: ${fields}`,
        deletedPerson: (name: string) => `Person gelöscht: ${name}`,
        createdPartnership: (p1: string, p2: string, status: string) => `Partnerschaft angelegt: ${p1} & ${p2} (${status})`,
        updatedPartnership: (p1: string, p2: string) => `Partnerschaft aktualisiert: ${p1} & ${p2}`,
        removedPartnership: (p1: string, p2: string) => `Partnerschaft entfernt: ${p1} & ${p2}`,
        addedParentChild: (parent: string, child: string) => `Eltern-Kind hinzugefügt: ${parent} → ${child}`,
        addedFamily: (name: string, count: number) => `Familie rund um ${name} hinzugefügt (${count} neu)`,
        removedParentChild: (parent: string, child: string) => `Eltern-Kind entfernt: ${parent} → ${child}`,
        mergedPersons: (removed: string, kept: string, details: string) => `Personen zusammengeführt: ${removed} → ${kept}${details ? ' (' + details + ')' : ''}`,
        clearedData: (persons: number, partnerships: number) => `Daten gelöscht: ${persons} Personen, ${partnerships} Partnerschaften`,
        loadedData: (persons: number, partnerships: number) => `Daten geladen: ${persons} Personen, ${partnerships} Partnerschaften`,
        addedChild: (parent: string, child: string) => `Kind hinzugefügt: ${parent} → ${child}`,
        addedParent: (parent: string, child: string) => `Elternteil hinzugefügt: ${parent} → ${child}`,
        addedSibling: (person: string, sibling: string) => `Geschwister hinzugefügt: ${person} + ${sibling}`,
        addedPartner: (person: string, partner: string) => `Partner hinzugefügt: ${person} & ${partner}`,
        treeMerge: (merged: number, added: number, source: string) => `Stammbaum-Zusammenführung aus „${source}": ${merged} zusammengeführt, ${added} hinzugefügt`,
        appliedChanges: (sender: string) => `Änderungen von ${sender} übernommen`,
        splitFamilies: (trees: number, persons: number) => `In ${trees} Familienstammbäume aufgeteilt (${persons} Personen)`,
        repairedIssue: (desc: string) => `Automatische Reparatur: ${desc}`,
        restoredBackup: 'Eine Sicherung wiederhergestellt',
        addedEvent: (name: string) => `Ereignis zu ${name} hinzugefügt`,
        updatedEvent: (name: string) => `Ereignis von ${name} aktualisiert`,
        removedEvent: (name: string) => `Ereignis von ${name} entfernt`,
        cleanedOrphanPlaces: (count: number) => `${count} verwaiste ${count === 1 ? 'Ort' : 'Orte'} bereinigt`,
        addedSource: (title: string) => `Quelle „${title}" hinzugefügt`,
        updatedSource: (title: string) => `Quelle „${title}" aktualisiert`,
        removedSource: (title: string) => `Quelle „${title}" entfernt`,
        citedSource: (name: string) => `Quelle bei ${name} zitiert`,
        uncitedSource: (name: string) => `Zitat von ${name} entfernt`,
        addedAttachment: (name: string) => `Anhang zu ${name} hinzugefügt`,
        removedAttachment: (name: string) => `Anhang von ${name} entfernt`,
        updatedAttachment: (name: string) => `Anhang von ${name} aktualisiert`,
        setParentRelType: (parent: string, child: string) => `Beziehungstyp ${parent} → ${child} festgelegt`,
        undoAction: (desc: string) => `Rückgängig: ${desc}`,
        redoAction: (desc: string) => `Wiederholen: ${desc}`
    },

    // Undo / redo
    undo: {
        undo: 'Rückgängig',
        redo: 'Wiederholen',
        addPerson: (name: string) => `${name} hinzufügen`,
        editPerson: (name: string) => `${name} bearbeiten`,
        clearedData: 'alle Daten löschen',
        geocodePlaces: (count: number) => `${count} Orte nachschlagen`,
        clearPlaceGeo: 'einen Ort von der Karte entfernen',
        cleanOrphanPlaces: (count: number) => `${count} verwaiste ${count === 1 ? 'Ort' : 'Orte'} bereinigen`,
        renamePlace: (name: string) => `einen Ort in ${name} umbenennen`,
        addSurnameGroup: (names: string) => `die Schreibweisen ${names} verknüpfen`,
        removeSurnameGroup: (name: string) => `die Verknüpfung der Schreibweisen von ${name} lösen`,
        loadedData: 'Daten importieren',
        repairedIssue: 'eine Prüfungsreparatur',
        deletePerson: (name: string) => `${name} löschen`,
        addPartnership: (a: string, b: string) => `Partnerschaft ${a} & ${b}`,
        editPartnership: (a: string, b: string) => `Partnerschaft ${a} & ${b} bearbeiten`,
        removePartnership: (a: string, b: string) => `Partnerschaft ${a} & ${b} entfernen`,
        addRelation: (parent: string, child: string) => `Verknüpfung ${parent} → ${child}`,
        removeRelation: (parent: string, child: string) => `Verknüpfung ${parent} → ${child} lösen`,
        addFamily: (name: string) => `Familie rund um ${name} hinzufügen`,
        mergePersons: (name: string) => `Zusammenführen zu ${name}`,
        addEvent: (name: string) => `Ereignis von ${name}`,
        editEvent: (name: string) => `Ereignis von ${name} bearbeiten`,
        removeEvent: (name: string) => `Ereignis von ${name} entfernen`,
        restoreBackup: 'Sicherung wiederherstellen',
        addSource: (title: string) => `Quelle „${title}"`,
        editSource: (title: string) => `Quelle „${title}" bearbeiten`,
        removeSource: (title: string) => `Quelle „${title}" entfernen`,
        cite: (name: string) => `Zitat bei ${name}`,
        uncite: (name: string) => `Zitat von ${name} entfernen`,
        addAttachment: (name: string) => `Anhang von ${name}`,
        removeAttachment: (name: string) => `Anhang von ${name} entfernen`,
        editAttachment: (name: string) => `Anhang von ${name} bearbeiten`,
        setParentRelType: (child: string) => `Beziehungstyp von ${child}`,
        applyChanges: (sender: string) => `Änderungen von ${sender} übernehmen`,
        undone: (desc: string) => `Rückgängig gemacht: ${desc}`,
        redone: (desc: string) => `Wiederholt: ${desc}`,
        nothingToUndo: 'Nichts rückgängig zu machen',
        nothingToRedo: 'Nichts zu wiederholen'
    },

    // Undo / redo entries in the ⋯ actions menu (labels carry the last change).
    actions: {
        undoLabel: (desc: string) => `Rückgängig: ${desc}`,
        undoDisabled: 'Rückgängig',
        redo: 'Wiederholen',
    },

    // Living-person privacy filter for exports
    privacy: {
        livingPerson: 'Lebende Person',
        label: 'Privatsphäre lebender Personen',
        tooltip: 'Details von Personen verbergen, die wahrscheinlich noch leben, wenn der Stammbaum Ihre Familie verlässt. Die Struktur bleibt erhalten.',
        modeFull: 'Vollständige Daten',
        modeInitials: 'Initialen + Geburtsjahr',
        modeAnonymous: 'Namen verbergen',
        modeMinimal: 'Nur Nachname behalten',
        stripPhotos: 'Ohne Fotos & Anhänge exportieren',
        contentLabel: 'Inhalt',
        contentTooltip: 'Wählen Sie, was mit der Datei mitgeht. Struktur und Namen des Stammbaums bleiben immer erhalten.',
        contentEstimate: (size: string) => `Geschätzte Größe: ${size}`,
        presetComplete: 'Vollständiges Archiv',
        presetSmall: 'Kleine Datei zum Senden',
        presetSkeleton: 'Nacktes Gerüst',
        contentPhotos: 'Fotos',
        contentAttachments: 'Anhänge & Dokumente',
        contentNotes: 'Notizen',
        contentSources: 'Quellen & Zitate'
    },

    // Poster export (SVG / PNG / tiled PDF)
    poster: {
        menu: 'Poster exportieren',
        title: 'Als Poster exportieren',
        description: 'Exportieren Sie die aktuelle Ansicht als Vektor, Bild oder druckbares mehrseitiges Poster.',
        printsView: 'Druckt die aktuelle Ansicht:',
        viewFamily: (name: string, up: number, down: number) => `Familie — ab ${name} (Tiefe ${up}/${down})`,
        viewDescendants: (name: string) => `Nachkommen von ${name}`,
        viewFan: (name: string, gens: number) => `Fächer — Vorfahren von ${name}, ${gens} Generationen`,
        viewTimeline: (name: string) => `Zeitleiste — Ansicht von ${name}`,
        viewMapBlocked: 'Die Karte lässt sich nicht als Poster drucken — wechseln Sie für den Druck in eine Stammbaumansicht.',
        svg: 'SVG (Vektor)',
        svgDesc: 'Skalierbarer Vektor, öffnet sich im Browser oder in Inkscape',
        png: 'PNG (Bild)',
        pngDesc: 'Rasterbild in hoher Auflösung',
        pdf: 'Druck / PDF (gekachelt)',
        pdfDesc: 'Über mehrere Seiten drucken mit Klebemarken',
        format: 'Papierformat',
        orientation: 'Ausrichtung',
        portrait: 'Hochformat',
        landscape: 'Querformat',
        empty: 'Nichts zu exportieren — öffnen Sie zuerst einen Stammbaum.',
        pngScaledDown: 'Das Bild wurde verkleinert, um in die Größenbeschränkung zu passen.',
        pngError: 'Das Bild konnte nicht erstellt werden.',
        pageLabel: (row: number, col: number) => `Zeile ${row} · Spalte ${col}`,
        guideOption: 'Eine erste Seite mit Zusammenbau-Anleitung hinzufügen',
        guideTitle: 'Zusammenbau-Anleitung',
        guideInfo: (pages: number, rows: number, cols: number, overlap: number) =>
            `${pages} Blätter (${rows} × ${cols}), ${overlap} mm Überlappung — nach dem Raster unten zusammenkleben.`,
        emptySheet: 'leer — nicht gedruckt'
    }
};

// Language dictionary
const languagePacks: Record<Language, StringsType> = {
    en: stringsEN,
    cs: stringsCZ,
    de: stringsDE
};

/** Get the full string pack for a specific language (used by the family book). */
export function getStringsForLang(lang: Language): StringsType {
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
    if (browserLang === 'de') {
        return 'de';
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
