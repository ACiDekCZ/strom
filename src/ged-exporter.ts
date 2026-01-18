/**
 * GEDCOM Exporter - Export family tree to GEDCOM 5.5.1 format
 * Standard genealogy interchange format for Ancestry, FamilySearch, Gramps, etc.
 */

import { StromData, Person, Partnership, PersonId, PartnershipId } from './types.js';

export interface GedcomExportResult {
    content: string;
    stats: {
        individuals: number;
        families: number;
    };
}

/** GEDCOM month names (uppercase) */
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * Format ISO date (YYYY-MM-DD) to GEDCOM format (D MON YYYY)
 * Handles partial dates (year only, year-month)
 */
function formatGedcomDate(isoDate: string | undefined): string | null {
    if (!isoDate) return null;

    const parts = isoDate.split('-');
    if (parts.length === 0) return null;

    const year = parts[0];
    if (!year || year.length !== 4) return null;

    // Year only
    if (parts.length === 1 || (parts[1] === '01' && parts[2] === '01' && parts.length === 3)) {
        // Check if it's really just a year (common pattern: 1942-01-01 for "just 1942")
        // We'll assume if month is 01 and day is 01, it might be a year-only date
        // But we can't be 100% sure, so we'll output full date to be safe
    }

    const month = parts[1] ? parseInt(parts[1], 10) : null;
    const day = parts[2] ? parseInt(parts[2], 10) : null;

    if (month && day) {
        // Full date: D MON YYYY
        return `${day} ${MONTHS[month - 1]} ${year}`;
    } else if (month) {
        // Year and month: MON YYYY
        return `${MONTHS[month - 1]} ${year}`;
    } else {
        // Year only: YYYY
        return year;
    }
}

/**
 * Format name to GEDCOM format: FirstName /LastName/
 */
function formatGedcomName(firstName: string, lastName: string): string {
    const first = firstName || '';
    const last = lastName || '';

    // Skip placeholder names
    if (first === '?' && !last) {
        return '? /Unknown/';
    }

    return `${first} /${last}/`;
}

/**
 * Escape special characters in GEDCOM text
 */
function escapeGedcomText(text: string): string {
    // GEDCOM doesn't have many escape sequences, but we should handle @ signs
    return text.replace(/@/g, '@@');
}

/**
 * Export StromData to GEDCOM 5.5.1 format
 */
export function exportToGedcom(data: StromData, treeName?: string): GedcomExportResult {
    const lines: string[] = [];

    // Create ID mappings (PersonId -> @I1@, PartnershipId -> @F1@)
    const personIdMap = new Map<PersonId, string>();
    const partnershipIdMap = new Map<PartnershipId, string>();

    let personCounter = 1;
    let familyCounter = 1;

    // Map all persons to GEDCOM IDs
    for (const personId of Object.keys(data.persons) as PersonId[]) {
        personIdMap.set(personId, `@I${personCounter}@`);
        personCounter++;
    }

    // Map all partnerships to GEDCOM IDs
    for (const partnershipId of Object.keys(data.partnerships) as PartnershipId[]) {
        partnershipIdMap.set(partnershipId, `@F${familyCounter}@`);
        familyCounter++;
    }

    // Get current date for header
    const now = new Date();
    const headerDate = `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;

    // ==================== HEADER ====================
    lines.push('0 HEAD');
    lines.push('1 SOUR STROM');
    lines.push('2 VERS 1.0');
    lines.push('2 NAME Strom Family Tree');
    lines.push('1 DEST ANSTFILE');
    lines.push(`1 DATE ${headerDate}`);
    lines.push('1 SUBM @SUBM1@');
    lines.push('1 GEDC');
    lines.push('2 VERS 5.5.1');
    lines.push('2 FORM LINEAGE-LINKED');
    lines.push('1 CHAR UTF-8');

    // ==================== SUBMITTER ====================
    lines.push('0 @SUBM1@ SUBM');
    lines.push(`1 NAME ${escapeGedcomText(treeName || 'Strom User')}`);

    // ==================== INDIVIDUALS ====================
    for (const [personId, person] of Object.entries(data.persons) as [PersonId, Person][]) {
        const gedcomId = personIdMap.get(personId);
        if (!gedcomId) continue;

        // Skip placeholder persons with no meaningful data
        if (person.isPlaceholder && person.firstName === '?' && !person.lastName) {
            continue;
        }

        lines.push(`0 ${gedcomId} INDI`);

        // Name
        const name = formatGedcomName(person.firstName, person.lastName);
        lines.push(`1 NAME ${escapeGedcomText(name)}`);

        // Sex
        lines.push(`1 SEX ${person.gender === 'male' ? 'M' : 'F'}`);

        // Birth
        if (person.birthDate || person.birthPlace) {
            lines.push('1 BIRT');
            if (person.birthDate) {
                const date = formatGedcomDate(person.birthDate);
                if (date) lines.push(`2 DATE ${date}`);
            }
            if (person.birthPlace) {
                lines.push(`2 PLAC ${escapeGedcomText(person.birthPlace)}`);
            }
        }

        // Death
        if (person.deathDate || person.deathPlace) {
            lines.push('1 DEAT');
            if (person.deathDate) {
                const date = formatGedcomDate(person.deathDate);
                if (date) lines.push(`2 DATE ${date}`);
            }
            if (person.deathPlace) {
                lines.push(`2 PLAC ${escapeGedcomText(person.deathPlace)}`);
            }
        }

        // Family as spouse (FAMS) - partnerships where this person is a partner
        for (const partnershipId of person.partnerships) {
            const famId = partnershipIdMap.get(partnershipId);
            if (famId) {
                lines.push(`1 FAMS ${famId}`);
            }
        }

        // Family as child (FAMC) - find partnerships where this person is a child
        for (const [partnershipId, partnership] of Object.entries(data.partnerships) as [PartnershipId, Partnership][]) {
            if (partnership.childIds.includes(personId)) {
                const famId = partnershipIdMap.get(partnershipId);
                if (famId) {
                    lines.push(`1 FAMC ${famId}`);
                }
            }
        }
    }

    // ==================== FAMILIES ====================
    for (const [partnershipId, partnership] of Object.entries(data.partnerships) as [PartnershipId, Partnership][]) {
        const gedcomId = partnershipIdMap.get(partnershipId);
        if (!gedcomId) continue;

        const person1 = data.persons[partnership.person1Id];
        const person2 = data.persons[partnership.person2Id];

        // Skip if both persons are placeholders
        if (person1?.isPlaceholder && person2?.isPlaceholder) {
            continue;
        }

        lines.push(`0 ${gedcomId} FAM`);

        // Determine HUSB/WIFE based on gender
        // GEDCOM 5.5.1 uses HUSB for male, WIFE for female
        // For same-sex couples, we use HUSB for first person, WIFE for second
        if (person1 && personIdMap.has(partnership.person1Id)) {
            const role = person1.gender === 'male' ? 'HUSB' : 'WIFE';
            lines.push(`1 ${role} ${personIdMap.get(partnership.person1Id)}`);
        }
        if (person2 && personIdMap.has(partnership.person2Id)) {
            const role = person2.gender === 'male' ? 'HUSB' : 'WIFE';
            // Avoid duplicate HUSB or WIFE tags for same-sex couples
            const person1Role = person1?.gender === 'male' ? 'HUSB' : 'WIFE';
            const role2 = role === person1Role ? (role === 'HUSB' ? 'WIFE' : 'HUSB') : role;
            lines.push(`1 ${role2} ${personIdMap.get(partnership.person2Id)}`);
        }

        // Children
        for (const childId of partnership.childIds) {
            const childGedcomId = personIdMap.get(childId);
            if (childGedcomId) {
                lines.push(`1 CHIL ${childGedcomId}`);
            }
        }

        // Marriage event (for married or divorced status)
        if (partnership.status === 'married' || partnership.status === 'divorced' ||
            partnership.startDate || partnership.startPlace) {
            lines.push('1 MARR');
            if (partnership.startDate) {
                const date = formatGedcomDate(partnership.startDate);
                if (date) lines.push(`2 DATE ${date}`);
            }
            if (partnership.startPlace) {
                lines.push(`2 PLAC ${escapeGedcomText(partnership.startPlace)}`);
            }
        }

        // Divorce event
        if (partnership.status === 'divorced' || partnership.endDate) {
            lines.push('1 DIV');
            if (partnership.endDate) {
                const date = formatGedcomDate(partnership.endDate);
                if (date) lines.push(`2 DATE ${date}`);
            }
        }

        // Note
        if (partnership.note) {
            lines.push(`1 NOTE ${escapeGedcomText(partnership.note)}`);
        }
    }

    // ==================== TRAILER ====================
    lines.push('0 TRLR');

    return {
        content: lines.join('\n'),
        stats: {
            individuals: personIdMap.size,
            families: partnershipIdMap.size
        }
    };
}
