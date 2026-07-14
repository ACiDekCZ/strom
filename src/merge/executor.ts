/**
 * Merge Import - Executor Module
 * Executes the merge operation based on user decisions
 */

import {
    PersonId,
    PartnershipId,
    Person,
    ParentChildRelType,
    Partnership,
    StromData,
    generatePersonId,
    generatePartnershipId
} from '../types.js';
import {
    MergeState,
    MergeResult,
    IdMapping,
    FieldConflict
} from './types.js';
import { StorageManager } from '../storage.js';

// ==================== BACKUP ====================

/**
 * Create backup of existing data before merge
 */
export async function createMergeBackup(data: StromData): Promise<string> {
    const key = `backup-${Date.now()}`;
    await StorageManager.set('merge', key, data);
    return key;
}

/**
 * Restore data from backup
 */
export async function restoreFromBackup(key: string): Promise<StromData | null> {
    return StorageManager.get<StromData>('merge', key);
}

/**
 * Delete backup
 */
export async function deleteBackup(key: string): Promise<void> {
    await StorageManager.delete('merge', key);
}

// ==================== ID MAPPING ====================

/**
 * Build ID mapping for merge
 * - Confirmed matches: use existing ID
 * - Rejected/unmatched: generate new ID
 * - Partnerships: always new ID
 */
/**
 * UNDECIDED matches auto-confirm only when the score clears the same bar the
 * UI shows as pre-confirmed (✓, score >= 50). Anything weaker without an
 * explicit user decision is treated as REJECTED — a duplicate person is
 * recoverable (person merge exists), a silent wrong merge is not.
 */
export const AUTO_CONFIRM_SCORE = 50;

export function isEffectivelyConfirmed(state: MergeState, match: { incomingId: PersonId; score: number }): boolean {
    const decision = state.decisions.get(match.incomingId);
    if (decision) return decision.type === 'confirm';
    return match.score >= AUTO_CONFIRM_SCORE;
}

export function buildIdMapping(state: MergeState): IdMapping {
    const personMapping = new Map<PersonId, PersonId>();
    const partnershipMapping = new Map<PartnershipId, PartnershipId>();

    // Process matches
    for (const match of state.matches) {
        const decision = state.decisions.get(match.incomingId);

        if (isEffectivelyConfirmed(state, match)) {
            // Confirmed (explicitly, or by a strong score): use existing ID
            personMapping.set(match.incomingId, match.existingId);
        } else if (decision?.type === 'manual_match') {
            // Manual match: use target ID
            personMapping.set(match.incomingId, decision.targetId);
        } else {
            // Rejected: generate new ID
            personMapping.set(match.incomingId, generatePersonId());
        }
    }

    // Process unmatched incoming persons
    for (const incomingId of state.unmatchedIncoming) {
        // Check if manually matched
        const decision = state.decisions.get(incomingId);
        if (decision?.type === 'manual_match') {
            personMapping.set(incomingId, decision.targetId);
        } else {
            // Generate new ID
            personMapping.set(incomingId, generatePersonId());
        }
    }

    // Also map placeholders that might be needed
    for (const id of Object.keys(state.incomingData.persons)) {
        const personId = id as PersonId;
        if (!personMapping.has(personId)) {
            personMapping.set(personId, generatePersonId());
        }
    }

    // Map all partnerships to new IDs
    for (const id of Object.keys(state.incomingData.partnerships)) {
        partnershipMapping.set(id as PartnershipId, generatePartnershipId());
    }

    return {
        persons: personMapping,
        partnerships: partnershipMapping
    };
}

// ==================== MERGE EXECUTION ====================

/**
 * Execute the merge operation
 */
export async function executeMerge(state: MergeState): Promise<MergeResult> {
    try {
        // Create backup
        const backupKey = await createMergeBackup(state.existingData);

        // Build ID mapping
        const mapping = buildIdMapping(state);

        // Clone existing data
        const mergedData = deepCloneStromData(state.existingData);

        // Union the source catalogs (ids are unique per tree). Incoming persons'
        // sourceIds keep resolving because their catalog entries come along.
        if (state.incomingData.sources) {
            mergedData.sources = { ...(mergedData.sources ?? {}), ...structuredClone(state.incomingData.sources) };
        }

        // Clear focus settings - new tree should start fresh
        delete mergedData.lastFocusPersonId;
        delete mergedData.lastFocusDepthUp;
        delete mergedData.lastFocusDepthDown;
        delete mergedData.defaultPersonId;

        let mergedCount = 0;
        let addedCount = 0;

        // Process confirmed matches - merge person data
        for (const match of state.matches) {
            const decision = state.decisions.get(match.incomingId);

            if (isEffectivelyConfirmed(state, match)) {
                const existingPerson = mergedData.persons[match.existingId];
                if (existingPerson) {
                    // Merge data according to conflict resolutions
                    mergePersonData(existingPerson, match.incomingPerson, match.conflicts, mapping.persons);
                    mergedCount++;
                }
            } else if (decision?.type === 'manual_match') {
                const existingPerson = mergedData.persons[decision.targetId];
                if (existingPerson) {
                    mergePersonData(existingPerson, match.incomingPerson, match.conflicts, mapping.persons);
                    mergedCount++;
                }
            }
            // Rejected matches are added as new persons below
        }

        // Add rejected matches and unmatched persons as new
        const toAdd: PersonId[] = [
            ...state.matches
                .filter(m => {
                    const decision = state.decisions.get(m.incomingId);
                    return decision?.type === 'reject';
                })
                .map(m => m.incomingId),
            ...state.unmatchedIncoming.filter(id => {
                const decision = state.decisions.get(id);
                return decision?.type !== 'manual_match';
            })
        ];

        for (const incomingId of toAdd) {
            const incoming = state.incomingData.persons[incomingId];
            if (!incoming) continue;

            const newId = mapping.persons.get(incomingId)!;

            // Create new person with remapped IDs
            const newPerson: Person = {
                ...incoming,
                id: newId,
                partnerships: incoming.partnerships
                    .map(pid => mapping.partnerships.get(pid))
                    .filter((pid): pid is PartnershipId => pid !== undefined),
                parentIds: incoming.parentIds
                    .map(pid => mapping.persons.get(pid))
                    .filter((pid): pid is PersonId => pid !== undefined),
                childIds: incoming.childIds
                    .map(cid => mapping.persons.get(cid))
                    .filter((cid): cid is PersonId => cid !== undefined)
            };
            // parentRelTypes is keyed by parent id — remap the keys too
            // (the plain spread above would carry the incoming tree's ids)
            const remappedRel = incoming.parentRelTypes
                ? remapParentRelTypes(incoming.parentRelTypes, mapping.persons)
                : undefined;
            if (remappedRel) newPerson.parentRelTypes = remappedRel;
            else delete newPerson.parentRelTypes;

            mergedData.persons[newId] = newPerson;
            addedCount++;
        }

        // Also add placeholders that are referenced
        for (const [incomingId, person] of Object.entries(state.incomingData.persons)) {
            const pid = incomingId as PersonId;
            if (person.isPlaceholder && !mergedData.persons[mapping.persons.get(pid)!]) {
                const newId = mapping.persons.get(pid)!;

                // Check if this placeholder is referenced by any person we're adding
                const isReferenced = toAdd.some(addedId => {
                    const addedPerson = state.incomingData.persons[addedId];
                    return addedPerson?.parentIds.includes(pid);
                });

                if (isReferenced) {
                    const newPerson: Person = {
                        ...person,
                        id: newId,
                        partnerships: person.partnerships
                            .map(pship => mapping.partnerships.get(pship))
                            .filter((pship): pship is PartnershipId => pship !== undefined),
                        parentIds: person.parentIds
                            .map(parentId => mapping.persons.get(parentId))
                            .filter((parentId): parentId is PersonId => parentId !== undefined),
                        childIds: person.childIds
                            .map(childId => mapping.persons.get(childId))
                            .filter((childId): childId is PersonId => childId !== undefined)
                    };
                    const remappedPhRel = person.parentRelTypes
                        ? remapParentRelTypes(person.parentRelTypes, mapping.persons)
                        : undefined;
                    if (remappedPhRel) newPerson.parentRelTypes = remappedPhRel;
                    else delete newPerson.parentRelTypes;
                    mergedData.persons[newId] = newPerson;
                }
            }
        }

        // Process partnerships
        for (const [incomingPshipId, partnership] of Object.entries(state.incomingData.partnerships)) {
            const pshipId = incomingPshipId as PartnershipId;

            const person1Id = mapping.persons.get(partnership.person1Id);
            const person2Id = mapping.persons.get(partnership.person2Id);

            if (!person1Id || !person2Id) continue;
            if (!mergedData.persons[person1Id] || !mergedData.persons[person2Id]) continue;

            // Check if partnership already exists between these persons
            const existingPartnership = findExistingPartnership(mergedData, person1Id, person2Id);

            if (existingPartnership) {
                // Merge partnership data
                mergePartnershipData(existingPartnership, partnership);
            } else {
                // Create new partnership with remapped IDs
                const newPshipId = mapping.partnerships.get(pshipId)!;
                const newPartnership: Partnership = {
                    ...partnership,
                    id: newPshipId,
                    person1Id,
                    person2Id,
                    childIds: partnership.childIds
                        .map(cid => mapping.persons.get(cid))
                        .filter((cid): cid is PersonId => cid !== undefined)
                };

                mergedData.partnerships[newPshipId] = newPartnership;

                // Update persons' partnerships arrays
                const p1 = mergedData.persons[person1Id];
                const p2 = mergedData.persons[person2Id];
                if (p1 && !p1.partnerships.includes(newPshipId)) {
                    p1.partnerships.push(newPshipId);
                }
                if (p2 && !p2.partnerships.includes(newPshipId)) {
                    p2.partnerships.push(newPshipId);
                }
            }
        }

        // Update parent-child relationships for merged persons
        updateRelationships(mergedData, state, mapping);

        // Validate result
        const validationErrors = validateMergedData(mergedData);
        if (validationErrors.length > 0) {
            console.warn('Merge validation warnings:', validationErrors);
        }

        return {
            success: true,
            mergedData,
            stats: {
                merged: mergedCount,
                added: addedCount,
                partnerships: Object.keys(mergedData.partnerships).length
            },
            backupKey
        };

    } catch (error) {
        console.error('Merge execution failed:', error);
        return {
            success: false,
            mergedData: state.existingData,
            stats: { merged: 0, added: 0, partnerships: 0 },
            errors: [String(error)]
        };
    }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Remap parentRelTypes keys (parent ids) through an id mapping. Keys whose
 * parent did not come along are dropped. Returns undefined when empty.
 */
function remapParentRelTypes(
    rel: Record<PersonId, ParentChildRelType>,
    idMap: Map<PersonId, PersonId>
): Record<PersonId, ParentChildRelType> | undefined {
    const out: Record<PersonId, ParentChildRelType> = {};
    for (const [pid, type] of Object.entries(rel)) {
        const mapped = idMap.get(pid as PersonId);
        if (mapped) out[mapped] = type;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Deep clone StromData
 */
function deepCloneStromData(data: StromData): StromData {
    const clonedPersons: Record<PersonId, Person> = {};
    const clonedPartnerships: Record<PartnershipId, Partnership> = {};

    for (const [id, person] of Object.entries(data.persons)) {
        clonedPersons[id as PersonId] = {
            ...person,
            partnerships: [...person.partnerships],
            parentIds: [...person.parentIds],
            childIds: [...person.childIds],
            ...(person.events ? { events: person.events.map(e => ({ ...e, ...(e.sourceIds ? { sourceIds: [...e.sourceIds] } : {}) })) } : {}),
            ...(person.sourceIds ? { sourceIds: [...person.sourceIds] } : {}),
            ...(person.attachments ? { attachments: person.attachments.map(a => ({ ...a })) } : {}),
            ...(person.parentRelTypes ? { parentRelTypes: { ...person.parentRelTypes } } : {})
        };
    }

    for (const [id, partnership] of Object.entries(data.partnerships)) {
        clonedPartnerships[id as PartnershipId] = {
            ...partnership,
            childIds: [...partnership.childIds]
        };
    }

    const cloned: StromData = { persons: clonedPersons, partnerships: clonedPartnerships };
    if (data.sources) cloned.sources = structuredClone(data.sources);
    return cloned;
}

/**
 * Merge person data according to conflict resolutions
 */
export function mergePersonData(
    existing: Person,
    incoming: Person,
    conflicts: FieldConflict[],
    personIdMap?: Map<PersonId, PersonId>
): void {
    // Merge non-conflicting data (fill in missing values)
    if (!existing.birthDate && incoming.birthDate) {
        existing.birthDate = incoming.birthDate;
    }
    if (!existing.birthPlace && incoming.birthPlace) {
        existing.birthPlace = incoming.birthPlace;
    }
    if (!existing.deathDate && incoming.deathDate) {
        existing.deathDate = incoming.deathDate;
    }
    if (!existing.deathPlace && incoming.deathPlace) {
        existing.deathPlace = incoming.deathPlace;
    }

    // Apply conflict resolutions
    for (const conflict of conflicts) {
        if (conflict.resolution === 'use_incoming') {
            switch (conflict.field) {
                case 'firstName':
                    existing.firstName = incoming.firstName;
                    break;
                case 'lastName':
                    existing.lastName = incoming.lastName;
                    break;
                case 'birthDate':
                    existing.birthDate = incoming.birthDate;
                    break;
                case 'birthPlace':
                    existing.birthPlace = incoming.birthPlace;
                    break;
                case 'deathDate':
                    existing.deathDate = incoming.deathDate;
                    break;
                case 'deathPlace':
                    existing.deathPlace = incoming.deathPlace;
                    break;
                case 'gender':
                    existing.gender = incoming.gender;
                    break;
            }
        }
        // 'keep_existing' - do nothing
    }

    // Merge life events: union by id, keeping the existing event on id clash.
    if (incoming.events && incoming.events.length > 0) {
        if (!existing.events) existing.events = [];
        const seen = new Set(existing.events.map(e => e.id));
        for (const event of incoming.events) {
            if (!seen.has(event.id)) {
                existing.events.push({ ...event, ...(event.sourceIds ? { sourceIds: [...event.sourceIds] } : {}) });
                seen.add(event.id);
            }
        }
    }

    // Merge source citations: union of source ids.
    if (incoming.sourceIds && incoming.sourceIds.length > 0) {
        const merged = new Set([...(existing.sourceIds ?? []), ...incoming.sourceIds]);
        existing.sourceIds = [...merged];
    }

    // Merge parent relationship types: keys are parent ids from the INCOMING
    // tree — remap them; the existing person's own value wins on clash.
    if (incoming.parentRelTypes) {
        const remapped = personIdMap
            ? remapParentRelTypes(incoming.parentRelTypes, personIdMap)
            : { ...incoming.parentRelTypes };
        if (remapped) {
            if (!existing.parentRelTypes) existing.parentRelTypes = {};
            for (const [pid, type] of Object.entries(remapped)) {
                if (!(pid in existing.parentRelTypes)) {
                    existing.parentRelTypes[pid as PersonId] = type;
                }
            }
        }
    }

    // Merge attachments: union by id, keeping the existing one on id clash.
    if (incoming.attachments && incoming.attachments.length > 0) {
        if (!existing.attachments) existing.attachments = [];
        const seenAtt = new Set(existing.attachments.map(a => a.id));
        for (const att of incoming.attachments) {
            if (!seenAtt.has(att.id)) {
                existing.attachments.push({ ...att });
                seenAtt.add(att.id);
            }
        }
    }

    // Update placeholder status
    if (existing.isPlaceholder && !incoming.isPlaceholder) {
        existing.isPlaceholder = false;
    }
}

/**
 * Find existing partnership between two persons
 */
function findExistingPartnership(
    data: StromData,
    person1Id: PersonId,
    person2Id: PersonId
): Partnership | null {
    for (const partnership of Object.values(data.partnerships)) {
        if ((partnership.person1Id === person1Id && partnership.person2Id === person2Id) ||
            (partnership.person1Id === person2Id && partnership.person2Id === person1Id)) {
            return partnership;
        }
    }
    return null;
}

/**
 * Merge partnership data
 */
function mergePartnershipData(existing: Partnership, incoming: Partnership): void {
    // Fill in missing values
    if (!existing.startDate && incoming.startDate) {
        existing.startDate = incoming.startDate;
    }
    if (!existing.startPlace && incoming.startPlace) {
        existing.startPlace = incoming.startPlace;
    }
    if (!existing.endDate && incoming.endDate) {
        existing.endDate = incoming.endDate;
    }
    if (!existing.note && incoming.note) {
        existing.note = incoming.note;
    }
}

/**
 * Update parent-child relationships after merge
 */
function updateRelationships(
    mergedData: StromData,
    _state: MergeState,
    _mapping: IdMapping
): void {
    // For each person that was added, ensure relationships are properly set
    for (const person of Object.values(mergedData.persons)) {
        // Update parent relationships
        for (const parentId of person.parentIds) {
            const parent = mergedData.persons[parentId];
            if (parent && !parent.childIds.includes(person.id)) {
                parent.childIds.push(person.id);
            }
        }

        // Update child relationships
        for (const childId of person.childIds) {
            const child = mergedData.persons[childId];
            if (child && !child.parentIds.includes(person.id) && child.parentIds.length < 2) {
                child.parentIds.push(person.id);
            }
        }
    }

    // Update partnership child relationships
    for (const partnership of Object.values(mergedData.partnerships)) {
        for (const childId of partnership.childIds) {
            const child = mergedData.persons[childId];
            if (!child) continue;

            // Ensure child has both parents
            if (!child.parentIds.includes(partnership.person1Id) && child.parentIds.length < 2) {
                child.parentIds.push(partnership.person1Id);
            }
            if (!child.parentIds.includes(partnership.person2Id) && child.parentIds.length < 2) {
                child.parentIds.push(partnership.person2Id);
            }
        }
    }

    // Limit to max 2 parents per person
    for (const person of Object.values(mergedData.persons)) {
        if (person.parentIds.length > 2) {
            console.warn(`Person ${person.id} has more than 2 parents, truncating`);
            person.parentIds = person.parentIds.slice(0, 2);
        }
    }
}

/**
 * Validate merged data
 */
function validateMergedData(data: StromData): string[] {
    const errors: string[] = [];
    const personIds = new Set(Object.keys(data.persons));

    // Check person references
    for (const person of Object.values(data.persons)) {
        for (const parentId of person.parentIds) {
            if (!personIds.has(parentId)) {
                errors.push(`Invalid parent reference: ${person.id} -> ${parentId}`);
            }
        }
        for (const childId of person.childIds) {
            if (!personIds.has(childId)) {
                errors.push(`Invalid child reference: ${person.id} -> ${childId}`);
            }
        }
    }

    // Check partnership references
    for (const partnership of Object.values(data.partnerships)) {
        if (!personIds.has(partnership.person1Id)) {
            errors.push(`Invalid partnership person1: ${partnership.id} -> ${partnership.person1Id}`);
        }
        if (!personIds.has(partnership.person2Id)) {
            errors.push(`Invalid partnership person2: ${partnership.id} -> ${partnership.person2Id}`);
        }
        for (const childId of partnership.childIds) {
            if (!personIds.has(childId)) {
                errors.push(`Invalid partnership child: ${partnership.id} -> ${childId}`);
            }
        }
    }

    // Check for circular parent relationships
    for (const person of Object.values(data.persons)) {
        const visited = new Set<PersonId>();
        const queue = [...person.parentIds];

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (current === person.id) {
                errors.push(`Circular parent relationship detected for: ${person.id}`);
                break;
            }
            if (visited.has(current)) continue;
            visited.add(current);

            const parent = data.persons[current];
            if (parent) {
                queue.push(...parent.parentIds);
            }
        }
    }

    return errors;
}
