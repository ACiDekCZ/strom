/**
 * The places of the app with a help mark ("?") and the number of
 * "How Strom works" each one opens. One table: a new place is one row here
 * plus helpMark() in its heading. Every number must exist in the embedded
 * help in all four languages (src/help/__tests__/help-topics.test.ts).
 */

export const HELP_TOPICS = {
    queue: 'R2.4',           // Overview → Queue (appendQueueSection), small panel → Up next
    places: 'R4.5',          // the Places window (showWaitingPlaces, #waiting-places-title)
    placesManager: 'R4.4',   // the places manager (showPlacesManager)
    conflicts: 'R5.3',       // the conflicts panel (openResearchConflictPanel, #prc-panel-title)
    personConflicts: 'R5.6', // the person dialog, section Conflicts (#person-research-title → section)
    waiting: 'R6.4',         // Overview → Awaiting action (appendOverviewWaiting), small panel (appendWaitingSection)
    now: 'R7',               // Overview → Now (appendOverviewNow), small panel Now
    nowPaused: 'R7.6',       // the same heading while some working[].paused
    imagesHeld: 'A3.8',      // Sources → the line under the filter "Image only in the research" (renderResearchImagesBulk)
    readDocument: 'R8.8',    // the Read a document window (renderReadDialog, #read-title)
    hypotheses: 'R10.3.2',   // What the research knows of a person, section Hypotheses (showPersonResearchDialog)
    mapLookup: 'A6.5.2',     // the preview "Look up N places not on the map in the research" (placesBulkHtml, look)
    following: 'S4.1.3',     // the follow legend "What the highlights mean" (renderFollowLegend, open)
    // Fields of a form: "?" right after the field's label (label[data-help], installFieldHelpMarks; 061)
    nameVariants: 'A4.7',    // Edit person → Other spellings of the name
    eventParticipants: 'A5.5', // the event editor → Godparents & witnesses (a couple's event: Witnesses and others)
    story: 'A7.8',           // Edit person → The story
} as const;

export type HelpTopic = keyof typeof HELP_TOPICS;
