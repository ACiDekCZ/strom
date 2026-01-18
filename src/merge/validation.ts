/**
 * Merge Import - Validation Module
 * Validates JSON and GEDCOM files before import
 */

import {
    PersonId,
    PartnershipId,
    Person,
    Partnership,
    StromData,
    toPersonId,
    toPartnershipId,
    STROM_DATA_VERSION
} from '../types.js';
import { ValidationResult } from './types.js';

// ==================== JSON VALIDATION ====================

/**
 * Validate JSON import content
 * Checks structure, required fields, and references
 */
export function validateJsonImport(content: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let data: StromData | undefined;

    // 1. Parse JSON
    try {
        const parsed = JSON.parse(content);

        // 2. Check basic structure
        if (!parsed || typeof parsed !== 'object') {
            errors.push('invalidStructure');
            return { valid: false, errors, warnings };
        }

        // 2b. Check version
        const importedVersion = typeof parsed.version === 'number' ? parsed.version : 0;
        if (importedVersion === 0) {
            warnings.push('noVersion');
        } else if (importedVersion < STROM_DATA_VERSION) {
            warnings.push(`olderVersion:${importedVersion}:${STROM_DATA_VERSION}`);
        } else if (importedVersion > STROM_DATA_VERSION) {
            warnings.push(`newerVersion:${importedVersion}:${STROM_DATA_VERSION}`);
        }

        // Check for persons and partnerships objects
        if (!parsed.persons || typeof parsed.persons !== 'object') {
            errors.push('missingPersons');
        }
        if (!parsed.partnerships || typeof parsed.partnerships !== 'object') {
            // Partnerships can be empty, just add warning
            warnings.push('missingPartnerships');
            parsed.partnerships = {};
        }

        if (errors.length > 0) {
            return { valid: false, errors, warnings };
        }

        // 3. Validate persons
        const personIds = new Set<string>();
        const persons: Record<PersonId, Person> = {};

        for (const [id, person] of Object.entries(parsed.persons)) {
            const p = person as Record<string, unknown>;
            const personId = toPersonId(id);
            personIds.add(id);

            // Required fields
            if (!p.id || typeof p.id !== 'string') {
                errors.push(`missingPersonId:${id}`);
                continue;
            }
            if (p.id !== id) {
                warnings.push(`idMismatch:${id}`);
            }
            if (typeof p.firstName !== 'string') {
                errors.push(`missingFirstName:${id}`);
            }
            if (typeof p.lastName !== 'string') {
                errors.push(`missingLastName:${id}`);
            }
            if (p.gender !== 'male' && p.gender !== 'female') {
                errors.push(`invalidGender:${id}`);
            }

            // Build validated person
            persons[personId] = {
                id: personId,
                firstName: String(p.firstName ?? ''),
                lastName: String(p.lastName ?? ''),
                gender: p.gender === 'female' ? 'female' : 'male',
                isPlaceholder: Boolean(p.isPlaceholder),
                partnerships: Array.isArray(p.partnerships)
                    ? p.partnerships.map(pid => toPartnershipId(String(pid)))
                    : [],
                parentIds: Array.isArray(p.parentIds)
                    ? p.parentIds.map(pid => toPersonId(String(pid)))
                    : [],
                childIds: Array.isArray(p.childIds)
                    ? p.childIds.map(cid => toPersonId(String(cid)))
                    : [],
                birthDate: typeof p.birthDate === 'string' ? p.birthDate : undefined,
                birthPlace: typeof p.birthPlace === 'string' ? p.birthPlace : undefined,
                deathDate: typeof p.deathDate === 'string' ? p.deathDate : undefined,
                deathPlace: typeof p.deathPlace === 'string' ? p.deathPlace : undefined
            };
        }

        // 4. Validate partnerships
        const partnershipIds = new Set<string>();
        const partnerships: Record<PartnershipId, Partnership> = {};

        for (const [id, partnership] of Object.entries(parsed.partnerships)) {
            const p = partnership as Record<string, unknown>;
            const partnershipId = toPartnershipId(id);
            partnershipIds.add(id);

            // Required fields
            if (!p.id || typeof p.id !== 'string') {
                errors.push(`missingPartnershipId:${id}`);
                continue;
            }
            if (!p.person1Id || typeof p.person1Id !== 'string') {
                errors.push(`missingPerson1:${id}`);
                continue;
            }
            if (!p.person2Id || typeof p.person2Id !== 'string') {
                errors.push(`missingPerson2:${id}`);
                continue;
            }

            // Reference validation
            if (!personIds.has(String(p.person1Id))) {
                warnings.push(`invalidPerson1Ref:${id}:${p.person1Id}`);
            }
            if (!personIds.has(String(p.person2Id))) {
                warnings.push(`invalidPerson2Ref:${id}:${p.person2Id}`);
            }

            // Build validated partnership
            partnerships[partnershipId] = {
                id: partnershipId,
                person1Id: toPersonId(String(p.person1Id)),
                person2Id: toPersonId(String(p.person2Id)),
                childIds: Array.isArray(p.childIds)
                    ? p.childIds.map(cid => toPersonId(String(cid)))
                    : [],
                status: isValidPartnershipStatus(p.status) ? p.status : 'married',
                startDate: typeof p.startDate === 'string' ? p.startDate : undefined,
                startPlace: typeof p.startPlace === 'string' ? p.startPlace : undefined,
                endDate: typeof p.endDate === 'string' ? p.endDate : undefined,
                note: typeof p.note === 'string' ? p.note : undefined
            };
        }

        // 5. Validate references
        for (const person of Object.values(persons)) {
            // Check parentIds
            for (const parentId of person.parentIds) {
                if (!personIds.has(parentId)) {
                    warnings.push(`invalidParentRef:${person.id}:${parentId}`);
                }
            }
            // Check childIds
            for (const childId of person.childIds) {
                if (!personIds.has(childId)) {
                    warnings.push(`invalidChildRef:${person.id}:${childId}`);
                }
            }
            // Check partnerships
            for (const partnershipId of person.partnerships) {
                if (!partnershipIds.has(partnershipId)) {
                    warnings.push(`invalidPartnershipRef:${person.id}:${partnershipId}`);
                }
            }
        }

        // Validate partnership childIds
        for (const partnership of Object.values(partnerships)) {
            for (const childId of partnership.childIds) {
                if (!personIds.has(childId)) {
                    warnings.push(`invalidPartnershipChildRef:${partnership.id}:${childId}`);
                }
            }
        }

        data = { persons, partnerships };

    } catch (e) {
        errors.push('parseError');
        return { valid: false, errors, warnings };
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        data
    };
}

function isValidPartnershipStatus(status: unknown): status is 'married' | 'partners' | 'divorced' | 'separated' {
    return status === 'married' || status === 'partners' ||
           status === 'divorced' || status === 'separated';
}

// ==================== GEDCOM VALIDATION ====================

/**
 * Validate GEDCOM import content
 * Checks basic GEDCOM structure and format
 */
export function validateGedcomImport(content: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Strip BOM if present
    if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
    }

    const lines = content.split(/\r?\n/);

    // 1. Check for GEDCOM header
    let hasHeader = false;
    let hasTrailer = false;
    let lineCount = 0;
    let indiCount = 0;
    let famCount = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        lineCount++;

        // Check basic line format
        const match = trimmed.match(/^(\d+)\s+(@\w+@|\w+)\s*(.*)?$/);
        if (!match) {
            // Allow continuation lines (CONT, CONC)
            if (!trimmed.match(/^(\d+)\s+(CONT|CONC)\s/)) {
                warnings.push(`invalidLine:${lineCount}`);
            }
            continue;
        }

        const level = parseInt(match[1]);
        const tag = match[2];
        const value = match[3] || '';

        // Check for header
        if (level === 0 && tag === 'HEAD') {
            hasHeader = true;
        }
        // Check for trailer
        if (level === 0 && tag === 'TRLR') {
            hasTrailer = true;
        }
        // Count INDI records
        if (level === 0 && value === 'INDI') {
            indiCount++;
        }
        // Count FAM records
        if (level === 0 && value === 'FAM') {
            famCount++;
        }

        // Check level validity (should increment by max 1)
        if (level > 10) {
            warnings.push(`deepNesting:${lineCount}`);
        }
    }

    // Validation results
    if (!hasHeader) {
        errors.push('missingHeader');
    }
    if (!hasTrailer) {
        warnings.push('missingTrailer');
    }
    if (indiCount === 0) {
        errors.push('noIndividuals');
    }
    if (lineCount < 5) {
        errors.push('fileTooShort');
    }

    // Add info warnings
    if (famCount === 0 && indiCount > 0) {
        warnings.push('noFamilies');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

// ==================== ERROR MESSAGES ====================

/**
 * Get human-readable error message
 * Error keys are defined in strings.ts validation section
 */
export function getValidationErrorKey(error: string): string {
    // Extract error type from error code
    const [errorType] = error.split(':');

    switch (errorType) {
        case 'parseError':
            return 'validation.parseError';
        case 'invalidStructure':
            return 'validation.invalidStructure';
        case 'missingPersons':
            return 'validation.missingPersons';
        case 'missingPartnerships':
            return 'validation.missingPartnerships';
        case 'missingPersonId':
        case 'missingFirstName':
        case 'missingLastName':
        case 'invalidGender':
        case 'missingPartnershipId':
        case 'missingPerson1':
        case 'missingPerson2':
            return 'validation.missingField';
        case 'invalidParentRef':
        case 'invalidChildRef':
        case 'invalidPartnershipRef':
        case 'invalidPerson1Ref':
        case 'invalidPerson2Ref':
        case 'invalidPartnershipChildRef':
            return 'validation.invalidReference';
        case 'missingHeader':
            return 'validation.missingGedcomHeader';
        case 'noIndividuals':
            return 'validation.noIndividuals';
        case 'fileTooShort':
            return 'validation.fileTooShort';
        case 'invalidLine':
            return 'validation.invalidLine';
        case 'noVersion':
            return 'validation.noVersion';
        case 'olderVersion':
            return 'validation.olderVersion';
        case 'newerVersion':
            return 'validation.newerVersion';
        default:
            return 'validation.unknownError';
    }
}
