/**
 * How well a person is documented, in three steps the card shows at a glance:
 *   none    — nothing about them is cited;
 *   partial — something is cited, but not the key facts;
 *   full    — the birth (or baptism) is cited and, when the person has a
 *             death in the data (date, place, a death / burial event), so is
 *             the death (or burial).
 * The birth is documented by a citation of the birth fields (birthSourceIds,
 * GEDCOM BIRT.SOUR) or of a birth / baptism event, the death likewise; a
 * source on the person as a whole (a name, a residence…) documents neither. Pure; placeholders have
 * no level. Tree health's "Where evidence is missing" counts with the same
 * rules (src/stats.ts).
 */

import { Partnership, Person, PersonId, StromData, personSourceIds, partnershipSourceIds } from './types.js';

export type EvidenceLevel = 'none' | 'partial' | 'full';

/** Everything the card, its tooltip and the Evidence mode read about one person. */
export interface PersonEvidence {
    level: EvidenceLevel;
    /** Distinct sources cited on the person, their events and their unions. */
    sources: number;
    /** The person has a birth: a date, a place or a baptism. */
    hasBirth: boolean;
    birthCited: boolean;
    /** The person has a death: a date, a place, or a death / burial event. */
    hasDeath: boolean;
    deathCited: boolean;
}

const BIRTH_EVENTS = new Set(['birth', 'baptism']);
const DEATH_EVENTS = new Set(['death', 'burial', 'cremation']);

const cited = (x: { sourceIds?: string[] } | undefined): boolean => (x?.sourceIds?.length ?? 0) > 0;

/** Each person's unions (built once per pass over a tree). */
export function unionsByPerson(data: StromData): Map<string, Partnership[]> {
    const out = new Map<string, Partnership[]>();
    for (const u of Object.values(data.partnerships ?? {})) {
        for (const pid of [u.person1Id, u.person2Id]) {
            const list = out.get(pid);
            if (list) list.push(u);
            else out.set(pid, [u]);
        }
    }
    return out;
}

/** The person's evidence (null for a placeholder). Pass `unions` when evaluating many people. */
export function personEvidence(
    p: Person,
    data: StromData,
    unions: Map<string, Partnership[]> = unionsByPerson(data),
): PersonEvidence | null {
    if (p.isPlaceholder) return null;
    const events = p.events ?? [];
    const personUnions = unions.get(p.id) ?? [];
    const sources = new Set<string>(personSourceIds(p));
    for (const x of events) for (const s of x.sourceIds ?? []) sources.add(s);
    for (const u of personUnions) for (const s of partnershipSourceIds(u)) sources.add(s);

    const birthEvents = events.filter(e => BIRTH_EVENTS.has(e.type));
    const hasBirth = !!p.birthDate || !!p.birthPlace?.trim() || birthEvents.length > 0;
    const birthCited = (p.birthSourceIds?.length ?? 0) > 0 || birthEvents.some(cited);

    const deathEvents = events.filter(e => DEATH_EVENTS.has(e.type));
    const hasDeath = !!p.deathDate || !!p.deathPlace?.trim() || deathEvents.length > 0;
    const deathCited = (p.deathSourceIds?.length ?? 0) > 0 || deathEvents.some(cited);

    const level: EvidenceLevel = sources.size === 0 ? 'none'
        : birthCited && (!hasDeath || deathCited) ? 'full'
        : 'partial';
    return { level, sources: sources.size, hasBirth, birthCited, hasDeath, deathCited };
}

/** The person's level (null for a placeholder). */
export function evidenceLevel(p: Person, data: StromData): EvidenceLevel | null {
    return personEvidence(p, data)?.level ?? null;
}

/** Whether anything in the tree cites a source (no source anywhere: the card shows no level). */
export function treeHasAnySource(data: StromData): boolean {
    for (const p of Object.values(data.persons)) {
        if (p.isPlaceholder) continue;
        if (personSourceIds(p).length > 0 || (p.events ?? []).some(cited)) return true;
    }
    return Object.values(data.partnerships ?? {}).some(u => partnershipSourceIds(u).length > 0);
}

/** Every real person's level, for the Evidence mode's counts. */
export function evidenceLevels(data: StromData): Map<PersonId, EvidenceLevel> {
    const unions = unionsByPerson(data);
    const out = new Map<PersonId, EvidenceLevel>();
    for (const p of Object.values(data.persons)) {
        const ev = personEvidence(p, data, unions);
        if (ev) out.set(p.id, ev.level);
    }
    return out;
}
