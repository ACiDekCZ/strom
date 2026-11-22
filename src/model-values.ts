/**
 * Strom - runtime values and helpers of the data model (enumerations,
 * citation lists, guards). The types themselves live in src/types.ts.
 */

import type { BranchMarker, EmbeddedDataEnvelope, EventParticipant, FactStatus, Gender, ParticipantRole, Partnership, PartnershipCitationField, Person, PersonCitationField, PrimaryName, SurnameDisplay, ViewMode } from './types.js';

export const BRANCH_MARKERS: readonly BranchMarker[] = ['arc', 'tag', 'stripe', 'corner', 'none'];

/** Every value of Gender, in the order the person dialog offers them. */
export const GENDERS: readonly Gender[] = ['male', 'female', 'unknown'];

/** True for a value of Gender (data from a file, a form, an older app). */
export function isGender(value: unknown): value is Gender {
    return value === 'male' || value === 'female' || value === 'unknown';
}

/** The other sex of a couple: male ↔ female; unknown stays unknown. */
export function oppositeGender(gender: Gender | undefined): Gender {
    return gender === 'male' ? 'female' : gender === 'female' ? 'male' : 'unknown';
}

/**
 * Two persons who may be the same one as far as their sex goes: the same
 * sex, or either of them unknown (merge, duplicate matching).
 */
export function gendersCompatible(a: Gender | undefined, b: Gender | undefined): boolean {
    return a === b || a === 'unknown' || b === 'unknown' || a === undefined || b === undefined;
}

/**
 * The two sides of a couple, left (the father's / husband's side) and right:
 * a man on the left, a woman on the right, a person of unknown sex on the
 * side the other one leaves free; two of one sex, or two unknown, keep the
 * order they are given in.
 */
export function coupleSides<T extends { gender?: Gender }>(a: T, b: T): [T, T] {
    if (a.gender === 'male' && b.gender !== 'male') return [a, b];
    if (b.gender === 'male' && a.gender !== 'male') return [b, a];
    if (b.gender === 'female' && a.gender !== 'female') return [a, b];
    if (a.gender === 'female' && b.gender !== 'female') return [b, a];
    return [a, b];
}

/**
 * A person's (first two) parents in the father's and the mother's slot, by
 * the rule of coupleSides; one parent alone stands in the father's slot
 * unless she is a woman.
 */
export function parentSlots<T extends { gender?: Gender }>(parents: readonly T[]): [T | null, T | null] {
    if (parents.length === 0) return [null, null];
    if (parents.length === 1) return parents[0].gender === 'female' ? [null, parents[0]] : [parents[0], null];
    return coupleSides(parents[0], parents[1]);
}

/** Every participant role, in the order the editor offers them. */
export const PARTICIPANT_ROLES: readonly ParticipantRole[] = ['godparent', 'witness', 'officiant', 'other'];

export const FACT_STATUSES: readonly FactStatus[] = ['lead', 'possible', 'probable', 'proven'];

/** The status a `_STROM_STATUS` value names, or undefined for one the app does not know. */
export function parseFactStatus(value: string | undefined): FactStatus | undefined {
    const v = value?.trim().toLowerCase();
    return (FACT_STATUSES as readonly string[]).includes(v ?? '') ? v as FactStatus : undefined;
}

/** The UI offers at most this many excerpts per source (an entry across a page break). */
export const MAX_EXCERPTS_UI = 2;

/** A conflict's mark of review: a source it stood on was deleted (spec 117 §8; any other word reads as a plain "to review"). */
export const CONFLICT_REVIEW_SOURCE_RETRACTED = 'source.retracted';

/** Special marker value for "last focused" default setting */
export const LAST_FOCUSED = "__last_focused__" as const;

/** A person's citation lists: the person as a whole, the birth, the death. */
export const PERSON_CITATION_FIELDS = ['sourceIds', 'birthSourceIds', 'deathSourceIds'] as const;

/** Every source a person's own citations name (the person, the birth, the death), once each. */
export function personSourceIds(p: Pick<Person, PersonCitationField>): string[] {
    return [...new Set(PERSON_CITATION_FIELDS.flatMap(f => p[f] ?? []))];
}

/** A couple's citation lists: the union itself (the wedding), the divorce. */
export const PARTNERSHIP_CITATION_FIELDS = ['sourceIds', 'divorceSourceIds'] as const;

/** Every source a couple's citations name (the union itself, the divorce and each of its events), once each. */
export function partnershipSourceIds(u: Partial<Pick<Partnership, PartnershipCitationField | 'events'>>): string[] {
    return [...new Set([...PARTNERSHIP_CITATION_FIELDS.flatMap(f => u[f] ?? []), ...(u.events ?? []).flatMap(e => e.sourceIds ?? [])])];
}

/** Everyone a couple's records name: the wedding witnesses and the people at each of its events. */
export function partnershipParticipants(u: Pick<Partnership, 'participants' | 'events'>): EventParticipant[] {
    return [...(u.participants ?? []), ...(u.events ?? []).flatMap(e => e.participants ?? [])];
}

/** Views drawn by something other than the layout pipeline (own containers). */
export const STANDALONE_VIEWS: readonly ViewMode[] = ['timeline', 'fan', 'map', 'table'];

/** PWA hostname for mode detection */
export const PWA_HOSTNAME = 'stromapp.info';

/** Pre-release test site: the beta PWA on its own origin (own storage) */
export const BETA_HOSTNAME = 'beta.stromapp.info';

/** Check if object is an embedded data envelope */
export function isEmbeddedEnvelope(obj: unknown): obj is EmbeddedDataEnvelope {
    return obj !== null &&
        typeof obj === 'object' &&
        'exportId' in obj &&
        'data' in obj &&
        'appVersion' in obj;
}

export const SETTINGS_KEY = 'strom-settings';

/** Whether a value is a valid Person.primaryName. */
export function isPrimaryName(v: unknown): v is PrimaryName {
    return v === 'birth' || v === 'married';
}

/**
 * Which surname a person kept by a merge goes by (Person.primaryName): the
 * choice travels with the married surname the kept person ends up with.
 * `keptMarriedBefore` is the kept person's married surname before the merge.
 * When it stayed, her own choice stays, and without one the other person's
 * comes along if its married surname is the same; when the other person's
 * married surname replaced it (filled a gap or won a conflict), the other's
 * choice comes along, her own one stays without it. Never one without a
 * married surname.
 */
export function mergedPrimaryName(
    kept: Pick<Person, 'marriedSurname' | 'primaryName'>,
    other: Pick<Person, 'marriedSurname' | 'primaryName'>,
    keptMarriedBefore: string | undefined,
): PrimaryName | undefined {
    const married = kept.marriedSurname?.trim();
    if (!married) return undefined;
    const own = isPrimaryName(kept.primaryName) ? kept.primaryName : undefined;
    const theirs = isPrimaryName(other.primaryName) && other.marriedSurname?.trim() === married ? other.primaryName : undefined;
    if (keptMarriedBefore?.trim() === married) return own ?? theirs;
    return theirs ?? own;
}

export const SURNAME_DISPLAYS: readonly SurnameDisplay[] = ['birth', 'both', 'married'];
