/**
 * Life-event helpers. birth/death are represented by the first-class
 * birthDate/deathDate fields and are NOT selectable here; they are only shown
 * read-only in the UI, synthesized from those fields.
 */

import { LifeEvent, LifeEventType } from './types.js';
import { yearOf } from './dates.js';

/**
 * Event types a user can add (birth/death excluded — they are first-class),
 * in the order a life runs rather than alphabetically.
 */
export const SELECTABLE_EVENT_TYPES: LifeEventType[] = [
    'baptism', 'confirmation', 'firstCommunion', 'barMitzvah', 'batMitzvah',
    'education', 'occupation', 'ordination', 'residence', 'military',
    'emigration', 'immigration', 'naturalization',
    'religion', 'nationality', 'title', 'adoption',
    'will', 'probate', 'burial', 'cremation', 'custom',
];

/**
 * Event types whose VALUE rides on the GEDCOM tag's own line rather than in a
 * subordinate structure: `1 OCCU blacksmith`, `1 RELI Lutheran`. For these the
 * event's note is not a remark about the fact — it IS the fact, which is why
 * the form labels the field with the fact's own name and why the event row and
 * the life timeline show it instead of leaving the line saying only "Occupation".
 */
const VALUE_ON_TAG_EVENT_TYPES = new Set<LifeEventType>([
    'occupation', 'religion', 'title', 'nationality',
]);

/** Whether this event's note carries the fact itself (see the set above). */
export function eventValueIsOnTag(type: LifeEventType): boolean {
    return VALUE_ON_TAG_EVENT_TYPES.has(type);
}

/**
 * Event types where a register names people besides the subject.
 *
 * Parish books record witnesses for the sacramental and legal acts —
 * godparents at a baptism, witnesses at a wedding, the people who attended a
 * burial or reported a death. Nobody ever witnessed a change of address or a
 * change of trade, so offering the field on residence, occupation, schooling
 * or emigration only adds a control that is never filled in.
 *
 * 'custom' stays in: it carries whatever the user (or the GEDCOM importer,
 * which files stray godparents under a "Birth record" event) puts there.
 */
const PARTICIPANT_EVENT_TYPES = new Set<LifeEventType>([
    'birth', 'death', 'baptism', 'burial', 'custom',
    // The rest of the sacraments and rites name a sponsor the same way a
    // baptism names godparents…
    'confirmation', 'firstCommunion', 'barMitzvah', 'batMitzvah', 'ordination',
    // …and a legal act names the people who witnessed it.
    'adoption', 'naturalization', 'will', 'probate', 'cremation',
]);

/**
 * Whether to offer the godparents/witnesses field for an event.
 *
 * An event that already names someone always shows them — hiding recorded
 * data because the type does not usually carry it would lose it silently on
 * the next save.
 */
export function eventTakesParticipants(type: LifeEventType, hasParticipants = false): boolean {
    return hasParticipants || PARTICIPANT_EVENT_TYPES.has(type);
}

/**
 * The most recent of the given events: the newest DATED one; an undated event
 * only when none has a date (sortLifeEvents puts undated events last, which
 * would make any undated entry "the latest").
 */
export function newestLifeEvent(events: LifeEvent[]): LifeEvent | null {
    if (events.length === 0) return null;
    const sorted = sortLifeEvents(events);
    const dated = sorted.filter(e => yearOf(e.date) !== null);
    return dated.length > 0 ? dated[dated.length - 1] : sorted[sorted.length - 1];
}

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
