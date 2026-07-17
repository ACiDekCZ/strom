/**
 * Merge Import - Validation Module
 * Validates JSON and GEDCOM files before import
 */

import {
    PersonId,
    PartnershipId,
    StromData,
    STROM_DATA_VERSION
} from '../types.js';
import { migrateData } from '../data.js';
import { ValidationResult } from './types.js';

// ==================== JSON VALIDATION ====================

/**
 * Validate JSON import content.
 *
 * Structural validation (errors + warnings) lives here; the imported tree
 * itself is built by migrateData — the single whitelist-guarded whole-carrier
 * that normalizes old data AND carries every field. This function must NEVER
 * hand-build the result again: doing so is what silently dropped photos, notes,
 * events, sources, attachments and every tree-level registry on import (it
 * even corrupted the app's own export→import roundtrip). See the import
 * section of src/__tests__/whitelist-guard.test.ts, which locks this shut.
 */
export function validateJsonImport(content: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Parse JSON
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        errors.push('parseError');
        return { valid: false, errors, warnings };
    }

    // 2. Check basic structure
    if (!parsed || typeof parsed !== 'object') {
        errors.push('invalidStructure');
        return { valid: false, errors, warnings };
    }
    const root = parsed as Record<string, unknown>;

    // 2b. Check version
    const importedVersion = typeof root.version === 'number' ? root.version : 0;
    if (importedVersion === 0) {
        warnings.push('noVersion');
    } else if (importedVersion < STROM_DATA_VERSION) {
        warnings.push(`olderVersion:${importedVersion}:${STROM_DATA_VERSION}`);
    } else if (importedVersion > STROM_DATA_VERSION) {
        warnings.push(`newerVersion:${importedVersion}:${STROM_DATA_VERSION}`);
    }

    // Check for persons and partnerships objects
    if (!root.persons || typeof root.persons !== 'object') {
        errors.push('missingPersons');
    }
    if (!root.partnerships || typeof root.partnerships !== 'object') {
        // Partnerships can be empty, just add warning (migrateData defaults it)
        warnings.push('missingPartnerships');
    }

    if (errors.length > 0) {
        return { valid: false, errors, warnings };
    }

    // 3. Validate persons — required fields only (errors). The tree is carried
    // wholesale by migrateData below; reference repair happens after that.
    for (const [id, person] of Object.entries(root.persons as Record<string, unknown>)) {
        const p = person as Record<string, unknown>;
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
    }

    // 4. Validate partnerships — required fields only (errors).
    const partnershipsRaw = (root.partnerships && typeof root.partnerships === 'object')
        ? root.partnerships as Record<string, unknown>
        : {};
    for (const [id, partnership] of Object.entries(partnershipsRaw)) {
        const p = partnership as Record<string, unknown>;
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
    }

    if (errors.length > 0) {
        return { valid: false, errors, warnings };
    }

    // 5. Structurally sound: carry the WHOLE tree through the whitelist-guarded
    // whole-carrier so nothing is dropped, then repair any dangling references
    // it faithfully carried (a hand-built copier used to drop these silently).
    const data = migrateData(parsed);
    warnings.push(...cleanDanglingReferences(data));

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        data
    };
}

/**
 * Repair references pointing at persons or partnerships not present in the
 * imported tree. migrateData carries the tree wholesale (the whole point — no
 * field dropped), which means it also faithfully carries any dangling link the
 * file contained. Left in place these would make validateTreeData reject the
 * freshly imported tree with orphan-ref errors, so we drop them here and report
 * each as a warning — the behavior the import validator has always had, now
 * applied to the complete tree rather than a whitelisted skeleton of it.
 */
function cleanDanglingReferences(data: StromData): string[] {
    const warnings: string[] = [];
    const personIds = new Set<string>(Object.keys(data.persons));

    // A partnership whose partner is missing cannot stand — drop the whole
    // partnership first, so the per-person cleanup below also strips its id.
    for (const [id, partnership] of Object.entries(data.partnerships)) {
        const has1 = personIds.has(partnership.person1Id);
        const has2 = personIds.has(partnership.person2Id);
        if (!has1) warnings.push(`invalidPerson1Ref:${id}:${partnership.person1Id}`);
        if (!has2) warnings.push(`invalidPerson2Ref:${id}:${partnership.person2Id}`);
        if (!has1 || !has2) delete data.partnerships[id as PartnershipId];
    }
    const partnershipIds = new Set<string>(Object.keys(data.partnerships));

    for (const [id, person] of Object.entries(data.persons)) {
        for (const parentId of person.parentIds) {
            if (!personIds.has(parentId)) warnings.push(`invalidParentRef:${id}:${parentId}`);
        }
        person.parentIds = person.parentIds.filter(pid => personIds.has(pid));

        for (const childId of person.childIds) {
            if (!personIds.has(childId)) warnings.push(`invalidChildRef:${id}:${childId}`);
        }
        person.childIds = person.childIds.filter(cid => personIds.has(cid));

        for (const partnershipId of person.partnerships) {
            if (!partnershipIds.has(partnershipId)) warnings.push(`invalidPartnershipRef:${id}:${partnershipId}`);
        }
        person.partnerships = person.partnerships.filter(pid => partnershipIds.has(pid));

        // Per-parent relationship types are keyed by a parent id — an entry for
        // a parent that no longer exists would outlive its parent.
        if (person.parentRelTypes) {
            for (const parentId of Object.keys(person.parentRelTypes)) {
                if (!personIds.has(parentId)) delete person.parentRelTypes[parentId as PersonId];
            }
        }

        // Event participants (godparent, witness…) may link to a person in the
        // tree. If that person is gone, keep the written name but drop the dead
        // link — validateTreeData treats a dangling participant as an error.
        for (const event of person.events ?? []) {
            for (const part of event.participants ?? []) {
                if (part.personId && !personIds.has(part.personId)) {
                    warnings.push(`invalidParticipantRef:${id}:${part.personId}`);
                    delete part.personId;
                }
            }
        }
    }

    // Partnership childIds referencing a person that no longer exists.
    for (const [id, partnership] of Object.entries(data.partnerships)) {
        for (const childId of partnership.childIds) {
            if (!personIds.has(childId)) warnings.push(`invalidPartnershipChildRef:${id}:${childId}`);
        }
        partnership.childIds = partnership.childIds.filter(cid => personIds.has(cid));
    }

    return warnings;
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
        case 'invalidParticipantRef':
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
