/**
 * Life-event helpers. birth/death are represented by the first-class
 * birthDate/deathDate fields and are NOT selectable here; they are only shown
 * read-only in the UI, synthesized from those fields.
 */

import { LifeEvent, LifeEventType } from './types.js';
import { yearOf } from './dates.js';

/** Event types a user can add (birth/death excluded — they are first-class). */
export const SELECTABLE_EVENT_TYPES: LifeEventType[] = [
    'baptism', 'occupation', 'residence', 'military',
    'emigration', 'immigration', 'education', 'burial', 'custom',
];

/**
 * Chronological order by year (flex-date aware). Undated events sort last;
 * ties break by id for a stable order.
 */
export function sortLifeEvents(events: LifeEvent[]): LifeEvent[] {
    return [...events].sort((a, b) => {
        const ya = yearOf(a.date);
        const yb = yearOf(b.date);
        if (ya === null && yb === null) return a.id.localeCompare(b.id);
        if (ya === null) return 1;
        if (yb === null) return -1;
        if (ya !== yb) return ya - yb;
        return a.id.localeCompare(b.id);
    });
}
