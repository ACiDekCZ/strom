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
} as const;

export type HelpTopic = keyof typeof HELP_TOPICS;
