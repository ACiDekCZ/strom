/**
 * Tree Validation Module
 * Smart heuristics to detect genealogical inconsistencies and data errors
 */

import { StromData, Person, Partnership, PersonId, PartnershipId } from './types.js';
import { parseFlexDate, FlexDate } from './dates.js';

// ==================== ISSUE TYPES ====================

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
    id: string;
    severity: IssueSeverity;
    type: string;
    message: string;
    personIds?: PersonId[];
    partnershipIds?: PartnershipId[];
    /** Language-neutral specifics (years, labels) shown under the localized message. */
    detail?: string;
}

export interface ValidationResult {
    valid: boolean;
    issues: ValidationIssue[];
    stats: {
        errors: number;
        warnings: number;
        infos: number;
    };
}

// ==================== VALIDATION FUNCTIONS ====================

/**
 * Run all validation checks on tree data
 */
export function validateTreeData(data: StromData): ValidationResult {
    const issues: ValidationIssue[] = [];
    let issueId = 0;

    const addIssue = (
        severity: IssueSeverity,
        type: string,
        message: string,
        personIds?: PersonId[],
        partnershipIds?: PartnershipId[],
        detail?: string
    ) => {
        issues.push({
            id: `issue_${++issueId}`,
            severity,
            type,
            message,
            personIds,
            partnershipIds,
            ...(detail ? { detail } : {})
        });
    };

    // Run all checks
    checkCycles(data, addIssue);
    checkSelfPartnerships(data, addIssue);
    checkDuplicatePartnerships(data, addIssue);
    checkBidirectionalReferences(data, addIssue);
    checkPartnershipConsistency(data, addIssue);
    checkOrphanedReferences(data, addIssue);
    checkParentCount(data, addIssue);
    checkAgePlausibility(data, addIssue);
    checkGenerationConsistency(data, addIssue);
    checkCrossbranchAnomalies(data, addIssue);
    checkLifeEvents(data, addIssue);
    checkDateConsistency(data, addIssue);
    checkSourceIntegrity(data, addIssue);
    checkPossibleDuplicates(data, addIssue);

    const stats = {
        errors: issues.filter(i => i.severity === 'error').length,
        warnings: issues.filter(i => i.severity === 'warning').length,
        infos: issues.filter(i => i.severity === 'info').length
    };

    return {
        valid: stats.errors === 0,
        issues,
        stats
    };
}

// ==================== CHECK: CYCLES ====================

/**
 * Detect ancestor cycles (person is their own ancestor)
 */
function checkLifeEvents(
    data: StromData,
    addIssue: (s: IssueSeverity, t: string, m: string, p?: PersonId[], pp?: PartnershipId[]) => void
): void {
    for (const person of Object.values(data.persons)) {
        if (!person.events) continue;
        const name = `${person.firstName} ${person.lastName}`.trim() || person.id;
        for (const ev of person.events) {
            if (ev.type === 'birth' || ev.type === 'death') {
                addIssue('error', 'event-birth-death',
                    `${name}: birth/death belong to the dedicated date fields, not the events list`, [person.id]);
            }
            if (ev.type === 'custom' && !ev.customLabel?.trim()) {
                addIssue('warning', 'event-no-label', `${name}: a custom event has no label`, [person.id]);
            }
            if (ev.date && !parseFlexDate(ev.date)) {
                addIssue('warning', 'event-bad-date', `${name}: an event has an invalid date "${ev.date}"`, [person.id]);
            }
        }
    }
}

function checkCycles(
    data: StromData,
    addIssue: (s: IssueSeverity, t: string, m: string, p?: PersonId[], pp?: PartnershipId[]) => void
): void {
    for (const personId of Object.keys(data.persons) as PersonId[]) {
        const visited = new Set<PersonId>();
        const path: PersonId[] = [];

        if (hasCycle(personId, data, visited, path)) {
            const cycleStart = path.indexOf(personId);
            const cyclePath = path.slice(cycleStart);
            const names = cyclePath.map(id => getPersonName(data.persons[id])).join(' → ');

            addIssue(
                'error',
                'cycle',
                `Cycle detected: ${names} → ${getPersonName(data.persons[personId])}`,
                cyclePath
            );
            break; // Report only first cycle found
        }
    }
}

function hasCycle(
    personId: PersonId,
    data: StromData,
    visited: Set<PersonId>,
    path: PersonId[]
): boolean {
    if (path.includes(personId)) {
        return true;
    }
    if (visited.has(personId)) {
        return false;
    }

    visited.add(personId);
    path.push(personId);

    const person = data.persons[personId];
    if (person) {
        for (const parentId of person.parentIds) {
            if (hasCycle(parentId, data, visited, path)) {
                return true;
            }
        }
    }

    path.pop();
    return false;
}

// ==================== CHECK: SELF-PARTNERSHIPS ====================

/**
 * Detect partnerships where a person is partnered with themselves
 */
function checkSelfPartnerships(
    data: StromData,
    addIssue: (s: IssueSeverity, t: string, m: string, p?: PersonId[], pp?: PartnershipId[]) => void
): void {
    for (const [partnershipId, partnership] of Object.entries(data.partnerships) as [PartnershipId, Partnership][]) {
        if (partnership.person1Id === partnership.person2Id) {
            const person = data.persons[partnership.person1Id];
            addIssue(
                'error',
                'selfPartnership',
                `Self-partnership: ${getPersonName(person)}`,
                [partnership.person1Id],
                [partnershipId]
            );
        }
    }
}

// ==================== CHECK: DUPLICATE PARTNERSHIPS ====================

/**
 * Detect duplicate partnerships between same two people
 */
function checkDuplicatePartnerships(
    data: StromData,
    addIssue: (s: IssueSeverity, t: string, m: string, p?: PersonId[], pp?: PartnershipId[]) => void
): void {
    const seen = new Map<string, PartnershipId>();

    for (const [partnershipId, partnership] of Object.entries(data.partnerships) as [PartnershipId, Partnership][]) {
        // Create canonical key (sorted IDs)
        const key = [partnership.person1Id, partnership.person2Id].sort().join('|');

        if (seen.has(key)) {
            const existingId = seen.get(key)!;
            const p1 = data.persons[partnership.person1Id];
            const p2 = data.persons[partnership.person2Id];
            addIssue(
                'warning',
                'duplicatePartnership',
                `Duplicate partnership: ${getPersonName(p1)} & ${getPersonName(p2)}`,
                [partnership.person1Id, partnership.person2Id],
                [existingId, partnershipId]
            );
        } else {
            seen.set(key, partnershipId);
        }
    }
}

// ==================== CHECK: BIDIRECTIONAL REFERENCES ====================

/**
 * Check parent-child references are bidirectional
 */
function checkBidirectionalReferences(
    data: StromData,
    addIssue: (s: IssueSeverity, t: string, m: string, p?: PersonId[], pp?: PartnershipId[]) => void
): void {
    for (const [personId, person] of Object.entries(data.persons) as [PersonId, Person][]) {
        // Check each parent
        for (const parentId of person.parentIds) {
            const parent = data.persons[parentId];
            if (parent && !parent.childIds.includes(personId)) {
                addIssue(
                    'error',
                    'missingChildRef',
                    `${getPersonName(person)} has ${getPersonName(parent)} as parent, but parent doesn't list them as child`,
                    [personId, parentId]
                );
            }
        }

        // Check each child
        for (const childId of person.childIds) {
            const child = data.persons[childId];
            if (child && !child.parentIds.includes(personId)) {
                addIssue(
                    'error',
                    'missingParentRef',
                    `${getPersonName(person)} has ${getPersonName(child)} as child, but child doesn't list them as parent`,
                    [personId, childId]
                );
            }
        }
    }
}

// ==================== CHECK: PARTNERSHIP CONSISTENCY ====================

/**
 * Check partnership members have the partnership in their list
 */
function checkPartnershipConsistency(
    data: StromData,
    addIssue: (s: IssueSeverity, t: string, m: string, p?: PersonId[], pp?: PartnershipId[]) => void
): void {
    for (const [partnershipId, partnership] of Object.entries(data.partnerships) as [PartnershipId, Partnership][]) {
        const p1 = data.persons[partnership.person1Id];
        const p2 = data.persons[partnership.person2Id];

        if (p1 && !p1.partnerships.includes(partnershipId)) {
            addIssue(
                'error',
                'missingPartnershipRef',
                `${getPersonName(p1)} doesn't have partnership in their list`,
                [partnership.person1Id],
                [partnershipId]
            );
        }

        if (p2 && !p2.partnerships.includes(partnershipId)) {
            addIssue(
                'error',
                'missingPartnershipRef',
                `${getPersonName(p2)} doesn't have partnership in their list`,
                [partnership.person2Id],
                [partnershipId]
            );
        }

        // Check children in partnership
        for (const childId of partnership.childIds) {
            const child = data.persons[childId];
            if (child) {
                const hasParent1 = child.parentIds.includes(partnership.person1Id);
                const hasParent2 = child.parentIds.includes(partnership.person2Id);
                if (!hasParent1 || !hasParent2) {
                    addIssue(
                        'error',
                        'partnershipChildMismatch',
                        `${getPersonName(child)} is in partnership children but doesn't have both parents in parentIds`,
                        [childId, partnership.person1Id, partnership.person2Id],
                        [partnershipId]
                    );
                }
            }
        }
    }
}

// ==================== CHECK: ORPHANED REFERENCES ====================

/**
 * Check for references to non-existent persons or partnerships
 */
function checkOrphanedReferences(
    data: StromData,
    addIssue: (s: IssueSeverity, t: string, m: string, p?: PersonId[], pp?: PartnershipId[]) => void
): void {
    const personIds = new Set(Object.keys(data.persons) as PersonId[]);
    const partnershipIds = new Set(Object.keys(data.partnerships) as PartnershipId[]);

    for (const [personId, person] of Object.entries(data.persons) as [PersonId, Person][]) {
        // Check parentIds
        for (const parentId of person.parentIds) {
            if (!personIds.has(parentId)) {
                addIssue(
                    'error',
                    'orphanedParentRef',
                    `${getPersonName(person)} references non-existent parent: ${parentId}`,
                    [personId]
                );
            }
        }

        // Check childIds
        for (const childId of person.childIds) {
            if (!personIds.has(childId)) {
                addIssue(
                    'error',
                    'orphanedChildRef',
                    `${getPersonName(person)} references non-existent child: ${childId}`,
                    [personId]
                );
            }
        }

        // Check partnerships
        for (const partnershipId of person.partnerships) {
            if (!partnershipIds.has(partnershipId)) {
                addIssue(
                    'error',
                    'orphanedPartnershipRef',
                    `${getPersonName(person)} references non-existent partnership: ${partnershipId}`,
                    [personId]
                );
            }
        }
    }

    for (const [partnershipId, partnership] of Object.entries(data.partnerships) as [PartnershipId, Partnership][]) {
        if (!personIds.has(partnership.person1Id)) {
            addIssue(
                'error',
                'orphanedPartnerRef',
                `Partnership ${partnershipId} references non-existent person1: ${partnership.person1Id}`,
                undefined,
                [partnershipId]
            );
        }
        if (!personIds.has(partnership.person2Id)) {
            addIssue(
                'error',
                'orphanedPartnerRef',
                `Partnership ${partnershipId} references non-existent person2: ${partnership.person2Id}`,
                undefined,
                [partnershipId]
            );
        }
        for (const childId of partnership.childIds) {
            if (!personIds.has(childId)) {
                addIssue(
                    'error',
                    'orphanedPartnershipChildRef',
                    `Partnership ${partnershipId} references non-existent child: ${childId}`,
                    undefined,
                    [partnershipId]
                );
            }
        }
    }
}

// ==================== CHECK: PARENT COUNT ====================

/**
 * Check that no person has more than 2 parents
 */
function checkParentCount(
    data: StromData,
    addIssue: (s: IssueSeverity, t: string, m: string, p?: PersonId[], pp?: PartnershipId[]) => void
): void {
    for (const [personId, person] of Object.entries(data.persons) as [PersonId, Person][]) {
        if (person.parentIds.length > 2) {
            const parentNames = person.parentIds.map(id => getPersonName(data.persons[id])).join(', ');
            addIssue(
                'error',
                'tooManyParents',
                `${getPersonName(person)} has ${person.parentIds.length} parents: ${parentNames}`,
                [personId, ...person.parentIds]
            );
        }
    }
}

// ==================== CHECK: AGE PLAUSIBILITY ====================

/**
 * Check birth dates for plausibility (parent should be older than child)
 */
function checkAgePlausibility(
    data: StromData,
    addIssue: (s: IssueSeverity, t: string, m: string, p?: PersonId[], pp?: PartnershipId[]) => void
): void {
    const MIN_PARENT_AGE = 12; // Minimum age to be a parent
    const MAX_PARENT_AGE = 80; // Maximum plausible age to have a child

    for (const [personId, person] of Object.entries(data.persons) as [PersonId, Person][]) {
        const childBirth = parseYear(person.birthDate);
        if (childBirth === null) continue;

        for (const parentId of person.parentIds) {
            const parent = data.persons[parentId];
            if (!parent) continue;

            const parentBirth = parseYear(parent.birthDate);
            if (parentBirth === null) continue;

            const ageAtBirth = childBirth - parentBirth;

            if (ageAtBirth < 0) {
                addIssue(
                    'error',
                    'parentYoungerThanChild',
                    `${getPersonName(parent)} (${parentBirth}) is younger than their child ${getPersonName(person)} (${childBirth})`,
                    [parentId, personId]
                );
            } else if (ageAtBirth < MIN_PARENT_AGE) {
                addIssue(
                    'warning',
                    'parentTooYoung',
                    `${getPersonName(parent)} was only ${ageAtBirth} when ${getPersonName(person)} was born`,
                    [parentId, personId]
                );
            } else if (ageAtBirth > MAX_PARENT_AGE) {
                addIssue(
                    'warning',
                    'parentTooOld',
                    `${getPersonName(parent)} was ${ageAtBirth} when ${getPersonName(person)} was born`,
                    [parentId, personId]
                );
            }
        }
    }
}

// ==================== CHECK: GENERATION CONSISTENCY ====================

/**
 * Check that a person doesn't appear at multiple generations
 * This catches cases where someone is incorrectly linked as both ancestor and descendant
 */
function checkGenerationConsistency(
    data: StromData,
    addIssue: (s: IssueSeverity, t: string, m: string, p?: PersonId[], pp?: PartnershipId[]) => void
): void {
    // Build generation map from each person's perspective
    const personIds = Object.keys(data.persons) as PersonId[];
    if (personIds.length === 0) return;

    // Pick a reference person (first with parents or first overall)
    let refPerson = personIds.find(id => data.persons[id].parentIds.length > 0) || personIds[0];

    // Calculate generations from reference person
    const generations = new Map<PersonId, number>();
    const queue: Array<{ id: PersonId; gen: number }> = [{ id: refPerson, gen: 0 }];
    const visited = new Set<PersonId>();

    while (queue.length > 0) {
        const { id, gen } = queue.shift()!;
        if (visited.has(id)) {
            // Check if generation is different
            const existingGen = generations.get(id);
            if (existingGen !== undefined && existingGen !== gen) {
                const person = data.persons[id];
                addIssue(
                    'error',
                    'generationConflict',
                    `${getPersonName(person)} appears at multiple generations (${existingGen} and ${gen}) - possible incorrect link`,
                    [id]
                );
            }
            continue;
        }

        visited.add(id);
        generations.set(id, gen);

        const person = data.persons[id];
        if (!person) continue;

        // Parents are one generation up
        for (const parentId of person.parentIds) {
            queue.push({ id: parentId, gen: gen - 1 });
        }

        // Children are one generation down
        for (const childId of person.childIds) {
            queue.push({ id: childId, gen: gen + 1 });
        }

        // Partners are same generation
        for (const partnershipId of person.partnerships) {
            const partnership = data.partnerships[partnershipId];
            if (partnership) {
                const partnerId = partnership.person1Id === id ? partnership.person2Id : partnership.person1Id;
                queue.push({ id: partnerId, gen: gen });
            }
        }
    }
}

// ==================== CHECK: CROSS-BRANCH ANOMALIES ====================

/**
 * Detect unusual cross-branch connections that might indicate errors
 * - Person who is both parent and partner of another
 * - Sibling who is also a parent/child
 */
function checkCrossbranchAnomalies(
    data: StromData,
    addIssue: (s: IssueSeverity, t: string, m: string, p?: PersonId[], pp?: PartnershipId[]) => void
): void {
    for (const [personId, person] of Object.entries(data.persons) as [PersonId, Person][]) {
        // Get all partners
        const partnerIds = new Set<PersonId>();
        for (const partnershipId of person.partnerships) {
            const partnership = data.partnerships[partnershipId];
            if (partnership) {
                const partnerId = partnership.person1Id === personId
                    ? partnership.person2Id
                    : partnership.person1Id;
                partnerIds.add(partnerId);
            }
        }

        // Check if any partner is also a parent or child
        for (const partnerId of partnerIds) {
            if (person.parentIds.includes(partnerId)) {
                const partner = data.persons[partnerId];
                addIssue(
                    'error',
                    'partnerIsParent',
                    `${getPersonName(person)} has ${getPersonName(partner)} as both partner and parent`,
                    [personId, partnerId]
                );
            }
            if (person.childIds.includes(partnerId)) {
                const partner = data.persons[partnerId];
                addIssue(
                    'error',
                    'partnerIsChild',
                    `${getPersonName(person)} has ${getPersonName(partner)} as both partner and child`,
                    [personId, partnerId]
                );
            }
        }

        // Get siblings (people with same parents)
        const siblings = new Set<PersonId>();
        for (const parentId of person.parentIds) {
            const parent = data.persons[parentId];
            if (parent) {
                for (const siblingId of parent.childIds) {
                    if (siblingId !== personId) {
                        siblings.add(siblingId);
                    }
                }
            }
        }

        // Check if any sibling is also a parent or child
        for (const siblingId of siblings) {
            if (person.parentIds.includes(siblingId)) {
                const sibling = data.persons[siblingId];
                addIssue(
                    'error',
                    'siblingIsParent',
                    `${getPersonName(person)} has ${getPersonName(sibling)} as both sibling and parent`,
                    [personId, siblingId]
                );
            }
            if (person.childIds.includes(siblingId)) {
                const sibling = data.persons[siblingId];
                addIssue(
                    'error',
                    'siblingIsChild',
                    `${getPersonName(person)} has ${getPersonName(sibling)} as both sibling and child`,
                    [personId, siblingId]
                );
            }
        }
    }
}

// ==================== CHECK: DATE CONSISTENCY ====================

type AddIssue = (
    s: IssueSeverity, t: string, m: string,
    p?: PersonId[], pp?: PartnershipId[], detail?: string
) => void;

/**
 * Month-scale interval [min,max] a flex date can cover, including slack for
 * its qualifier (~ about, < before, > after) and missing month precision.
 * All certainty comparisons work on these intervals so approximate dates
 * never produce false positives.
 */
function monthRange(d: FlexDate): { min: number; max: number } {
    let min = d.year * 12 + ((d.month ?? 1) - 1);
    let max = d.year * 12 + ((d.month ?? 12) - 1);
    if (d.qualifier === '~') { min -= 24; max += 24; }
    if (d.qualifier === '<') min -= 240;
    if (d.qualifier === '>') max += 240;
    return { min, max };
}

/** True when `a` is CERTAINLY at least `gapMonths` before `b`, even reading both dates as loosely as their precision allows. */
function certainlyBefore(a: FlexDate | null, b: FlexDate | null, gapMonths = 0): boolean {
    if (!a || !b) return false;
    return monthRange(a).max + gapMonths < monthRange(b).min;
}

/**
 * Checks over dated facts: events vs the person's lifespan, weddings vs both
 * partners' lifespans (incl. child marriages), children born after a parent's
 * death, death before birth, implausible lifespans and extreme partner age
 * gaps. Only CERTAIN violations are reported (see monthRange).
 */
function checkDateConsistency(data: StromData, addIssue: AddIssue): void {
    const MAX_LIFESPAN_YEARS = 115;
    const CHILD_MARRIAGE_YEARS = 14;
    const PARTNER_AGE_GAP_YEARS = 40;
    const POSTHUMOUS_FATHER_MONTHS = 10; // conception before death + gestation

    for (const [personId, person] of Object.entries(data.persons) as [PersonId, Person][]) {
        const name = getPersonName(person);
        const birth = parseFlexDate(person.birthDate);
        const death = parseFlexDate(person.deathDate);

        if (certainlyBefore(death, birth)) {
            addIssue('error', 'deathBeforeBirth', `${name}: death date is before birth date`,
                [personId], undefined, `† ${person.deathDate} < * ${person.birthDate}`);
        } else if (birth && death) {
            const certainYears = (monthRange(death).min - monthRange(birth).max) / 12;
            if (certainYears > MAX_LIFESPAN_YEARS) {
                addIssue('warning', 'implausibleLifespan', `${name}: lifespan over ${MAX_LIFESPAN_YEARS} years`,
                    [personId], undefined, `* ${person.birthDate} – † ${person.deathDate}`);
            }
        }

        for (const ev of person.events ?? []) {
            const evDate = parseFlexDate(ev.date);
            if (!evDate) continue;
            const label = ev.type === 'custom' ? (ev.customLabel?.trim() || 'custom') : ev.type;
            if (certainlyBefore(evDate, birth)) {
                addIssue('warning', 'eventBeforeBirth', `${name}: event dated before birth`,
                    [personId], undefined, `${label} ${ev.date} < * ${person.birthDate}`);
            }
            // Burial is naturally after death; everything else is suspicious.
            if (ev.type !== 'burial' && certainlyBefore(death, evDate)) {
                addIssue('warning', 'eventAfterDeath', `${name}: event dated after death`,
                    [personId], undefined, `${label} ${ev.date} > † ${person.deathDate}`);
            }
        }

        // Child born after a parent's death (biological parents only —
        // adoptive/step/foster links have no biological timing constraint).
        if (birth) {
            for (const parentId of person.parentIds) {
                const parent = data.persons[parentId];
                if (!parent || !parent.deathDate) continue;
                const relType = person.parentRelTypes?.[parentId] ?? 'biological';
                if (relType !== 'biological') continue;
                const parentDeath = parseFlexDate(parent.deathDate);
                if (parent.gender === 'female') {
                    // One month of slack for death in childbirth.
                    if (certainlyBefore(parentDeath, birth, 1)) {
                        addIssue('error', 'childAfterMotherDeath',
                            `${name}: born after the death of mother ${getPersonName(parent)}`,
                            [personId, parentId], undefined, `* ${person.birthDate} > † ${parent.deathDate}`);
                    }
                } else if (certainlyBefore(parentDeath, birth, POSTHUMOUS_FATHER_MONTHS)) {
                    addIssue('warning', 'childAfterFatherDeath',
                        `${name}: born more than ${POSTHUMOUS_FATHER_MONTHS} months after the death of father ${getPersonName(parent)}`,
                        [personId, parentId], undefined, `* ${person.birthDate} > † ${parent.deathDate}`);
                }
            }
        }
    }

    for (const [partnershipId, partnership] of Object.entries(data.partnerships) as [PartnershipId, Partnership][]) {
        const p1 = data.persons[partnership.person1Id];
        const p2 = data.persons[partnership.person2Id];
        const wedding = parseFlexDate(partnership.startDate);

        if (wedding) {
            for (const p of [p1, p2]) {
                if (!p) continue;
                const birth = parseFlexDate(p.birthDate);
                const death = parseFlexDate(p.deathDate);
                if (certainlyBefore(wedding, birth)) {
                    addIssue('error', 'weddingBeforeBirth',
                        `${getPersonName(p)}: wedding dated before birth`,
                        [p.id], [partnershipId], `⚭ ${partnership.startDate} < * ${p.birthDate}`);
                } else if (birth) {
                    const maxAgeYears = (monthRange(wedding).max - monthRange(birth).min) / 12;
                    if (maxAgeYears < CHILD_MARRIAGE_YEARS) {
                        addIssue('warning', 'childMarriage',
                            `${getPersonName(p)}: married before the age of ${CHILD_MARRIAGE_YEARS}`,
                            [p.id], [partnershipId], `⚭ ${partnership.startDate}, * ${p.birthDate}`);
                    }
                }
                if (certainlyBefore(death, wedding)) {
                    addIssue('warning', 'weddingAfterDeath',
                        `${getPersonName(p)}: wedding dated after death`,
                        [p.id], [partnershipId], `⚭ ${partnership.startDate} > † ${p.deathDate}`);
                }
            }
        }

        // Extreme age difference between partners (informational).
        const b1 = p1 ? parseFlexDate(p1.birthDate) : null;
        const b2 = p2 ? parseFlexDate(p2.birthDate) : null;
        if (b1 && b2) {
            const r1 = monthRange(b1), r2 = monthRange(b2);
            const certainGapYears = Math.max(r1.min - r2.max, r2.min - r1.max) / 12;
            if (certainGapYears >= PARTNER_AGE_GAP_YEARS) {
                addIssue('info', 'partnerAgeGap',
                    `${getPersonName(p1)} & ${getPersonName(p2)}: over ${PARTNER_AGE_GAP_YEARS} years apart`,
                    [partnership.person1Id, partnership.person2Id], [partnershipId],
                    `* ${p1!.birthDate} / * ${p2!.birthDate}`);
            }
        }
    }
}

// ==================== CHECK: SOURCE & ATTACHMENT INTEGRITY ====================

/**
 * Citations must point to sources that exist in the per-tree catalog, and
 * attachments must actually carry data (a broken import/merge can leave both).
 */
function checkSourceIntegrity(data: StromData, addIssue: AddIssue): void {
    const sourceIds = new Set(Object.keys(data.sources ?? {}));
    const missing = (ids?: string[]) => (ids ?? []).filter(id => !sourceIds.has(id));

    for (const partnership of Object.values(data.partnerships)) {
        for (const id of missing(partnership.sourceIds)) {
            addIssue('warning', 'citationMissingSource',
                `partnership citation points to a source that no longer exists`,
                [partnership.person1Id, partnership.person2Id], undefined, id);
        }
    }

    for (const [personId, person] of Object.entries(data.persons) as [PersonId, Person][]) {
        const name = getPersonName(person);

        for (const id of missing(person.sourceIds)) {
            addIssue('warning', 'citationMissingSource',
                `${name}: citation points to a source that no longer exists`,
                [personId], undefined, id);
        }
        for (const ev of person.events ?? []) {
            const label = ev.type === 'custom' ? (ev.customLabel?.trim() || 'custom') : ev.type;
            for (const id of missing(ev.sourceIds)) {
                addIssue('warning', 'citationMissingSource',
                    `${name}: event citation points to a source that no longer exists`,
                    [personId], undefined, `${label}: ${id}`);
            }
        }
        for (const att of person.attachments ?? []) {
            if (att.sourceId && !sourceIds.has(att.sourceId)) {
                addIssue('warning', 'citationMissingSource',
                    `${name}: attachment links a source that no longer exists`,
                    [personId], undefined, att.name);
            }
            if (!att.dataUrl || !att.dataUrl.startsWith('data:') || att.dataUrl.length < 32) {
                addIssue('warning', 'attachmentNoData',
                    `${name}: attachment "${att.name}" has no usable data`,
                    [personId], undefined, att.name);
            }
        }
    }
}

// ==================== HELPERS ====================

/**
 * Flag likely-accidental DUPLICATE persons within one tree: same gender, very
 * similar name and the same birth year (or, without any birth date, an exact
 * normalized name). Info-level — it never blocks; it just surfaces pairs the
 * user may want to merge. Bucketed by birth year / normalized name so it stays
 * linear-ish instead of comparing every pair.
 */
function checkPossibleDuplicates(
    data: StromData,
    addIssue: (s: IssueSeverity, t: string, m: string, p?: PersonId[], pp?: PartnershipId[], d?: string) => void
): void {
    const norm = (s: string): string => s.trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const persons = Object.values(data.persons).filter(p => !p.isPlaceholder);

    // Bucket key: birth year when known, else "noyear". Only compare within a
    // bucket (same year => plausible dup; different year => almost never).
    const buckets = new Map<string, Person[]>();
    for (const p of persons) {
        const name = `${p.firstName}${p.lastName}`.trim();
        if (!name) continue;                       // unnamed people never flagged
        const year = parseYear(p.birthDate);
        const key = year !== null ? `y${year}` : `n:${norm(p.firstName)}|${norm(p.lastName)}`;
        (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(p);
    }

    const reported = new Set<string>();
    for (const group of buckets.values()) {
        if (group.length < 2) continue;
        for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
                const a = group[i], b = group[j];
                if (a.gender !== b.gender) continue;
                const firstEq = norm(a.firstName) === norm(b.firstName);
                const lastEq = norm(a.lastName) === norm(b.lastName);
                // Require the surname to match and the given name to match or be
                // empty on one side (initials / partial records).
                const givenOk = firstEq || !norm(a.firstName) || !norm(b.firstName);
                if (!lastEq || !givenOk) continue;
                const pairKey = [a.id, b.id].sort().join('|');
                if (reported.has(pairKey)) continue;
                reported.add(pairKey);
                const yr = parseYear(a.birthDate);
                addIssue('info', 'possibleDuplicate',
                    `${getPersonName(a)} and ${getPersonName(b)} look like the same person`,
                    [a.id, b.id], undefined, yr !== null ? `* ${yr}` : undefined);
            }
        }
    }
}

function getPersonName(person: Person | undefined): string {
    if (!person) return '(unknown)';
    return `${person.firstName} ${person.lastName}`.trim() || '(unnamed)';
}

function parseYear(dateStr: string | undefined): number | null {
    if (!dateStr) return null;

    // Try to extract year from various formats
    // "1985", "1985-03-15", "15.3.1985", "March 1985", etc.
    const match = dateStr.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
    return match ? parseInt(match[1], 10) : null;
}
