/**
 * Life-event helpers. birth/death are represented by the first-class
 * birthDate/deathDate fields and are NOT selectable here; they are only shown
 * read-only in the UI, synthesized from those fields.
 */

import { CoupleEvent, CoupleEventType, LifeEvent, LifeEventType } from './types.js';
import { dateSortKey, yearOf } from './dates.js';
import { strings } from './strings.js';

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

// ==================== COUPLE EVENTS ====================

/** The groups of the couple event editor's type list, in the order a marriage runs. */
export type CoupleEventGroup = 'before' | 'during' | 'end' | 'other';
export const COUPLE_EVENT_GROUPS: readonly { group: CoupleEventGroup; types: readonly CoupleEventType[] }[] = [
    { group: 'before', types: ['engagement', 'banns', 'marriageLicence', 'marriageContract', 'marriageSettlement'] },
    { group: 'during', types: ['residence', 'census'] },
    { group: 'end', types: ['divorceFiled', 'annulment'] },
    { group: 'other', types: ['custom'] },
];

/** Every couple event type, in the editor's order (also the tie-break of sorting). */
export const COUPLE_EVENT_TYPES: readonly CoupleEventType[] = COUPLE_EVENT_GROUPS.flatMap(g => g.types);

/** What a couple's event is called: its own label when custom, else the type's name. */
export function coupleEventLabel(event: Pick<CoupleEvent, 'type' | 'customLabel'>): string {
    if (event.type === 'custom' && event.customLabel?.trim()) return event.customLabel.trim();
    return strings.partnerEvents.types[event.type];
}

/** The GEDCOM tag under FAM each type is written as ('custom' rides on EVEN + TYPE). */
export const COUPLE_EVENT_TAG: Readonly<Record<CoupleEventType, string>> = {
    engagement: 'ENGA', banns: 'MARB', marriageLicence: 'MARL', marriageContract: 'MARC',
    marriageSettlement: 'MARS', residence: 'RESI', census: 'CENS',
    divorceFiled: 'DIVF', annulment: 'ANUL', custom: 'EVEN',
};

/** The couple event type a FAM tag reads as, or null. */
export function coupleEventTypeOfTag(tag: string): CoupleEventType | null {
    for (const type of COUPLE_EVENT_TYPES) if (COUPLE_EVENT_TAG[type] === tag) return type;
    return null;
}

export function isCoupleEventType(value: unknown): value is CoupleEventType {
    return typeof value === 'string' && (COUPLE_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Which details a couple event offers behind the quiet link (a filled one
 * shows whatever the type): a cause only where something ended, each
 * partner's age where a record states it (banns, a census), a house always.
 */
export function coupleEventDetails(type: CoupleEventType): ('cause' | 'ages' | 'address')[] {
    switch (type) {
        case 'custom': return ['cause', 'ages', 'address'];
        case 'divorceFiled':
        case 'annulment': return ['cause', 'address'];
        case 'banns':
        case 'census': return ['ages', 'address'];
        default: return ['address'];
    }
}

/**
 * Chronological order: by the start of the date, equal dates in the order of
 * the type list, undated events last in the order they were written down.
 */
export function sortCoupleEvents(events: readonly CoupleEvent[]): CoupleEvent[] {
    const order = (e: CoupleEvent) => COUPLE_EVENT_TYPES.indexOf(e.type);
    return events
        .map((event, index) => ({ event, index }))
        .sort((a, b) => {
            const ka = dateSortKey(a.event.date);
            const kb = dateSortKey(b.event.date);
            if (!ka || !kb) return !ka && !kb ? a.index - b.index : (ka ? -1 : 1);
            if (ka !== kb) return ka < kb ? -1 : 1;
            return order(a.event) - order(b.event) || a.index - b.index;
        })
        .map(x => x.event);
}
