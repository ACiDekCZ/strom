/**
 * The godparent who keeps turning up (P2).
 *
 * Recording who stood at a baptism is only half of it. The half that matters is
 * the pattern: a godparent at one child's baptism is a neighbour, but the same
 * name at three baptisms in one family is almost always a relative — and that is
 * a lead a genealogist follows. It is the reason godparents are worth storing as
 * data instead of a sentence in a note, and until now the app stored them and
 * said nothing.
 *
 * Names are compared the way the register wrote them, folded for case and
 * diacritics. A linked person counts under their own identity, so two spellings
 * of a linked godparent still count as one person.
 */

import { StromData, Person, PersonId } from './types.js';

/** Someone who appears as a participant more than once. */
export interface RecurringParticipant {
    /** Their name as shown: from the linked person, or as written. */
    name: string;
    /** Linked person, when the participant was linked to one. */
    personId?: PersonId;
    /** How many events they appear at. */
    count: number;
    /** Whose events: the people whose baptisms/weddings they attended. */
    subjects: { id: PersonId; name: string }[];
    /** Are they already related to those people? Then it is no news. */
    alreadyRelated: boolean;
}

/** How many appearances make a pattern worth mentioning. */
export const RECURRING_THRESHOLD = 2;

const fold = (t: string): string =>
    t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const fullName = (p: Person): string => `${p.firstName} ${p.lastName}`.trim();

/** Everyone this person is linked to by blood or marriage — one step out. */
function relativesOf(id: PersonId, data: StromData): Set<PersonId> {
    const person = data.persons[id];
    if (!person) return new Set();
    const out = new Set<PersonId>([...person.parentIds, ...person.childIds]);
    for (const unionId of person.partnerships) {
        const union = data.partnerships[unionId];
        if (!union) continue;
        out.add(union.person1Id);
        out.add(union.person2Id);
        union.childIds.forEach(c => out.add(c));
    }
    out.delete(id);
    return out;
}

/**
 * Participants who appear at more than one event, most frequent first.
 *
 * `alreadyRelated` marks the ones who are no surprise — a grandmother standing
 * at her grandchildren's baptisms is not a lead. What is left is the interesting
 * part: a name that keeps appearing and has no place in the tree yet.
 */
export function recurringParticipants(data: StromData): RecurringParticipant[] {
    const seen = new Map<string, RecurringParticipant>();

    for (const subject of Object.values(data.persons)) {
        for (const event of subject.events ?? []) {
            for (const part of event.participants ?? []) {
                const linked = part.personId ? data.persons[part.personId] : undefined;
                const name = linked ? fullName(linked) : (part.name ?? '').trim();
                if (!name) continue;
                // Linked people count under their id, so two spellings of the
                // same linked godparent are still one person.
                const key = part.personId ?? `name:${fold(name)}`;

                const entry = seen.get(key) ?? {
                    name,
                    ...(part.personId ? { personId: part.personId } : {}),
                    count: 0,
                    subjects: [],
                    alreadyRelated: false,
                };
                entry.count++;
                if (!entry.subjects.some(s => s.id === subject.id)) {
                    entry.subjects.push({ id: subject.id, name: fullName(subject) });
                }
                seen.set(key, entry);
            }
        }
    }

    const out: RecurringParticipant[] = [];
    for (const entry of seen.values()) {
        if (entry.count < RECURRING_THRESHOLD) continue;
        if (entry.personId) {
            const related = relativesOf(entry.personId, data);
            entry.alreadyRelated = entry.subjects.every(s => related.has(s.id));
        }
        out.push(entry);
    }
    return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** The ones worth telling someone about: recurring, and not already family. */
export function godparentLeads(data: StromData): RecurringParticipant[] {
    return recurringParticipants(data).filter(p => !p.alreadyRelated);
}
