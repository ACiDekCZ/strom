/**
 * Strom - id helpers: branded id casts and id generators.
 */

import type { PartnershipId, PersonId, TreeId } from './types.js';

/** Helper to create a PersonId from string */
export function toPersonId(id: string): PersonId {
    return id as PersonId;
}

/** Helper to create a PartnershipId from string */
export function toPartnershipId(id: string): PartnershipId {
    return id as PartnershipId;
}

let idSeq = 0;

/**
 * The end of a generated id: a counter of this page, then randomness. The
 * counter makes ids made within one millisecond unique (a GEDCOM import makes
 * thousands at once, and 5 random characters alone collided: a person lost);
 * the randomness keeps two windows apart.
 */
export function uniqueIdSuffix(): string {
    idSeq = (idSeq + 1) % 1679616;
    return `${idSeq.toString(36).padStart(4, '0')}${Math.random().toString(36).slice(2, 7)}`;
}

/** Generate unique PersonId */
export function generatePersonId(): PersonId {
    return `p_${Date.now()}_${uniqueIdSuffix()}` as PersonId;
}

/** Generate unique PartnershipId */
export function generatePartnershipId(): PartnershipId {
    return `u_${Date.now()}_${uniqueIdSuffix()}` as PartnershipId;
}

/** Generate unique LifeEvent id */
export function generateLifeEventId(): string {
    return `ev_${Date.now()}_${uniqueIdSuffix()}`;
}

/** Generate unique EventParticipant id */
export function generateParticipantId(): string {
    return `pt_${Date.now()}_${uniqueIdSuffix()}`;
}

/** Generate unique Source id */
export function generateSourceId(): string {
    return `src_${Date.now()}_${uniqueIdSuffix()}`;
}

/** Generate unique SourceExcerpt id */
export function generateExcerptId(): string {
    return `exc_${Date.now()}_${uniqueIdSuffix()}`;
}

/** Generate unique Attachment id */
export function generateAttachmentId(): string {
    return `att_${Date.now()}_${uniqueIdSuffix()}`;
}

/** Generate unique export ID */
export function generateExportId(): string {
    return `exp_${Date.now()}_${uniqueIdSuffix()}`;
}

/** Helper to create a TreeId from string */
export function toTreeId(id: string): TreeId {
    return id as TreeId;
}

/** Generate unique TreeId */
export function generateTreeId(): TreeId {
    return `tree_${Date.now()}_${uniqueIdSuffix()}` as TreeId;
}
