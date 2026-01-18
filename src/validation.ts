/**
 * Tree Validation Module
 * Smart heuristics to detect genealogical inconsistencies and data errors
 */

import { StromData, Person, Partnership, PersonId, PartnershipId } from './types.js';

// ==================== ISSUE TYPES ====================

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
    id: string;
    severity: IssueSeverity;
    type: string;
    message: string;
    personIds?: PersonId[];
    partnershipIds?: PartnershipId[];
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
        partnershipIds?: PartnershipId[]
    ) => {
        issues.push({
            id: `issue_${++issueId}`,
            severity,
            type,
            message,
            personIds,
            partnershipIds
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

// ==================== HELPERS ====================

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
