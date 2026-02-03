/**
 * GEDCOM Parser Module
 * Parses GEDCOM files and converts them to Strom data format
 */

import {
    PersonId,
    PartnershipId,
    Person,
    Partnership,
    StromData,
    toPersonId,
    toPartnershipId
} from './types';

// ==================== TYPES ====================

/** Raw GEDCOM individual record */
interface GedcomIndividual {
    id: string;
    name: string;
    firstName: string;
    lastName: string;
    sex: string;
    birthDate: string;
    birthPlace: string;
    deathDate: string;
    deathPlace: string;
    fams: string[];  // Families as spouse
    famc: string | null;  // Family as child
}

/** Raw GEDCOM family record */
interface GedcomFamily {
    id: string;
    husb: string | null;
    wife: string | null;
    children: string[];
    marriageDate: string;
    divorceDate: string;
}

/** Parsed GEDCOM data */
export interface ParsedGedcom {
    individuals: Map<string, GedcomIndividual>;
    families: Map<string, GedcomFamily>;
}

/** Result of GEDCOM to Strom conversion */
export interface GedcomConversionResult {
    data: StromData;
    stats: {
        totalPersons: number;
        totalPartnerships: number;
        skippedPersons: number;
        totalGedFamilies: number;
    };
}

// ==================== CONSTANTS ====================

const MONTHS: Record<string, string> = {
    'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04',
    'MAY': '05', 'JUN': '06', 'JUL': '07', 'AUG': '08',
    'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Parse GEDCOM date format to ISO date string
 * Handles: "3 JUN 1900", "JUN 1900", "1900", "ABT 1900", "BEF 1900", etc.
 */
export function parseGedcomDate(dateStr: string): string {
    if (!dateStr) return '';

    // Remove approximate/before/after prefixes
    const cleaned = dateStr.trim()
        .replace(/^(ABT|ABOUT|BEF|BEFORE|AFT|AFTER|EST|CAL|INT)\s+/i, '');

    const parts = cleaned.split(/\s+/);

    if (parts.length === 3) {
        // "3 JUN 1900" -> "1900-06-03"
        const day = parts[0].padStart(2, '0');
        const month = MONTHS[parts[1].toUpperCase()] || '01';
        const year = parts[2];
        return `${year}-${month}-${day}`;
    } else if (parts.length === 2) {
        // "JUN 1900" -> "1900-06-01"
        const month = MONTHS[parts[0].toUpperCase()] || '01';
        const year = parts[1];
        return `${year}-${month}-01`;
    } else if (parts.length === 1 && /^\d{4}$/.test(parts[0])) {
        // "1900" -> "1900-01-01"
        return `${parts[0]}-01-01`;
    }
    return '';
}

/**
 * Parse GEDCOM name format to first/last name
 * Handles: "John /Surname/", "/Surname/", "FirstName"
 */
export function parseName(nameStr: string): { firstName: string; lastName: string } {
    // Try to match "Given /Surname/" pattern
    const match = nameStr.match(/^(.*?)\/(.*)\/$/);
    if (match) {
        return {
            firstName: match[1].trim(),
            lastName: match[2].trim()
        };
    }
    // Fallback: no surname delimiter - split by whitespace
    const cleaned = nameStr.replace(/\//g, '').trim();
    const parts = cleaned.split(/\s+/).filter(p => p);
    return {
        firstName: parts[0] || '',
        lastName: parts.slice(1).join(' ') || ''
    };
}

/**
 * Generate unique ID with prefix
 */
function generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ==================== MAIN PARSER ====================

/**
 * Parse GEDCOM file content into structured data
 */
export function parseGedcom(content: string): ParsedGedcom {
    // Strip BOM (Byte Order Mark) if present
    if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
    }

    const lines = content.split(/\r?\n/);
    const individuals = new Map<string, GedcomIndividual>();
    const families = new Map<string, GedcomFamily>();

    let currentRecord: GedcomIndividual | GedcomFamily | null = null;
    let currentType: 'INDI' | 'FAM' | null = null;
    let currentSubTag: string | null = null;

    for (const line of lines) {
        const match = line.match(/^(\d+)\s+(@\w+@|\w+)\s*(.*)?$/);
        if (!match) continue;

        const level = parseInt(match[1]);
        const tag = match[2];
        const value = (match[3] || '').trim();

        if (level === 0) {
            // New record
            if (tag.startsWith('@I') && value === 'INDI') {
                currentRecord = {
                    id: tag,
                    name: '',
                    firstName: '',
                    lastName: '',
                    sex: '',
                    birthDate: '',
                    birthPlace: '',
                    deathDate: '',
                    deathPlace: '',
                    fams: [],
                    famc: null
                };
                currentType = 'INDI';
                individuals.set(tag, currentRecord as GedcomIndividual);
            } else if (tag.startsWith('@F') && value === 'FAM') {
                currentRecord = {
                    id: tag,
                    husb: null,
                    wife: null,
                    children: [],
                    marriageDate: '',
                    divorceDate: ''
                };
                currentType = 'FAM';
                families.set(tag, currentRecord as GedcomFamily);
            } else {
                currentRecord = null;
                currentType = null;
            }
            currentSubTag = null;
        } else if (currentRecord) {
            if (level === 1) {
                currentSubTag = tag;

                if (currentType === 'INDI') {
                    const indi = currentRecord as GedcomIndividual;
                    switch (tag) {
                        case 'NAME': {
                            const parsed = parseName(value);
                            indi.name = value;
                            indi.firstName = parsed.firstName;
                            indi.lastName = parsed.lastName;
                            break;
                        }
                        case 'SEX':
                            indi.sex = value;
                            break;
                        case 'FAMS':
                            indi.fams.push(value);
                            break;
                        case 'FAMC':
                            indi.famc = value;
                            break;
                    }
                } else if (currentType === 'FAM') {
                    const fam = currentRecord as GedcomFamily;
                    switch (tag) {
                        case 'HUSB':
                            fam.husb = value;
                            break;
                        case 'WIFE':
                            fam.wife = value;
                            break;
                        case 'CHIL':
                            fam.children.push(value);
                            break;
                    }
                }
            } else if (level === 2) {
                if (currentType === 'INDI') {
                    const indi = currentRecord as GedcomIndividual;
                    if (currentSubTag === 'BIRT') {
                        if (tag === 'DATE') indi.birthDate = parseGedcomDate(value);
                        if (tag === 'PLAC') indi.birthPlace = value;
                    } else if (currentSubTag === 'DEAT') {
                        if (tag === 'DATE') indi.deathDate = parseGedcomDate(value);
                        if (tag === 'PLAC') indi.deathPlace = value;
                    }
                } else if (currentType === 'FAM') {
                    const fam = currentRecord as GedcomFamily;
                    if (currentSubTag === 'MARR') {
                        if (tag === 'DATE') fam.marriageDate = parseGedcomDate(value);
                    } else if (currentSubTag === 'DIV') {
                        if (tag === 'DATE') fam.divorceDate = parseGedcomDate(value);
                    }
                }
            }
        }
    }

    return { individuals, families };
}

// ==================== CONVERTER ====================

/**
 * Convert parsed GEDCOM data to Strom data format
 */
export function convertToStrom(gedcom: ParsedGedcom): GedcomConversionResult {
    const { individuals, families } = gedcom;

    // Filter out persons with empty names (unknown ancestors)
    const validIndividuals = new Map<string, GedcomIndividual>();
    const skippedIds = new Set<string>();

    for (const [gedId, indi] of individuals) {
        // Skip if both firstName and lastName are empty
        if (!indi.firstName && !indi.lastName) {
            skippedIds.add(gedId);
            continue;
        }
        validIndividuals.set(gedId, indi);
    }

    // Create ID mappings (only for valid individuals)
    const personIdMap = new Map<string, PersonId>();
    const partnershipIdMap = new Map<string, PartnershipId>();

    // Generate new IDs
    for (const [gedId] of validIndividuals) {
        personIdMap.set(gedId, toPersonId(generateId('p')));
    }
    for (const [gedId] of families) {
        partnershipIdMap.set(gedId, toPartnershipId(generateId('u')));
    }

    // Create persons
    const persons: Record<PersonId, Person> = {};
    for (const [gedId, indi] of validIndividuals) {
        const personId = personIdMap.get(gedId)!;
        const person: Person = {
            id: personId,
            firstName: indi.firstName || '?',
            lastName: indi.lastName || '',
            gender: indi.sex === 'M' ? 'male' : 'female',
            isPlaceholder: !indi.firstName || indi.firstName === '?' || indi.firstName === '//',
            partnerships: [],
            parentIds: [],
            childIds: []
        };

        // Add extended info if present
        if (indi.birthDate) person.birthDate = indi.birthDate;
        if (indi.birthPlace) person.birthPlace = indi.birthPlace;
        if (indi.deathDate) person.deathDate = indi.deathDate;
        if (indi.deathPlace) person.deathPlace = indi.deathPlace;

        persons[personId] = person;
    }

    // Create partnerships and link relationships
    const partnerships: Record<PartnershipId, Partnership> = {};
    for (const [gedFamId, fam] of families) {
        const partnershipId = partnershipIdMap.get(gedFamId)!;

        // Skip families without both spouses
        if (!fam.husb || !fam.wife) continue;

        const person1Id = personIdMap.get(fam.husb);
        const person2Id = personIdMap.get(fam.wife);

        if (!person1Id || !person2Id) continue;

        // Create partnership
        const partnership: Partnership = {
            id: partnershipId,
            person1Id: person1Id,
            person2Id: person2Id,
            childIds: [],
            status: 'married'
        };

        if (fam.marriageDate) {
            partnership.startDate = fam.marriageDate;
        }

        if (fam.divorceDate) {
            partnership.endDate = fam.divorceDate;
            partnership.status = 'divorced';
        }

        partnerships[partnershipId] = partnership;

        // Add partnership to both persons
        if (persons[person1Id]) {
            persons[person1Id].partnerships.push(partnershipId);
        }
        if (persons[person2Id]) {
            persons[person2Id].partnerships.push(partnershipId);
        }

        // Process children
        for (const childGedId of fam.children) {
            const childId = personIdMap.get(childGedId);
            if (!childId || !persons[childId]) continue;

            // Add to partnership's childIds
            partnerships[partnershipId].childIds.push(childId);

            // Add parents to child's parentIds
            if (!persons[childId].parentIds.includes(person1Id)) {
                persons[childId].parentIds.push(person1Id);
            }
            if (!persons[childId].parentIds.includes(person2Id)) {
                persons[childId].parentIds.push(person2Id);
            }

            // Add child to parents' childIds
            if (!persons[person1Id].childIds.includes(childId)) {
                persons[person1Id].childIds.push(childId);
            }
            if (!persons[person2Id].childIds.includes(childId)) {
                persons[person2Id].childIds.push(childId);
            }
        }
    }

    // Handle single-parent families (only HUSB or only WIFE)
    // Create placeholder for the missing parent + partnership so layout engine can render children
    for (const [, fam] of families) {
        // Skip if already processed (both spouses)
        if (fam.husb && fam.wife) continue;
        if (fam.children.length === 0) continue;

        const parentGedId = fam.husb || fam.wife;
        if (!parentGedId) continue;

        const parentId = personIdMap.get(parentGedId);
        if (!parentId || !persons[parentId]) continue;

        // Create placeholder for the missing parent (opposite gender)
        const placeholderId = toPersonId(generateId('p'));
        const parentGender = persons[parentId].gender;
        const placeholderGender = parentGender === 'male' ? 'female' : 'male';
        const placeholder: Person = {
            id: placeholderId,
            firstName: '?',
            lastName: '',
            gender: placeholderGender,
            parentIds: [],
            childIds: [],
            partnerships: [],
            isPlaceholder: true
        };
        persons[placeholderId] = placeholder;

        // Create partnership between parent and placeholder
        const partnershipId = toPartnershipId(generateId('u'));
        const partnership: Partnership = {
            id: partnershipId,
            person1Id: parentId,
            person2Id: placeholderId,
            childIds: [],
            status: 'married'
        };
        partnerships[partnershipId] = partnership;

        // Add partnership to both persons
        persons[parentId].partnerships.push(partnershipId);
        placeholder.partnerships.push(partnershipId);

        // Process children
        for (const childGedId of fam.children) {
            const childId = personIdMap.get(childGedId);
            if (!childId || !persons[childId]) continue;

            // Add to partnership's childIds
            partnership.childIds.push(childId);

            // Add parents to child's parentIds
            if (!persons[childId].parentIds.includes(parentId)) {
                persons[childId].parentIds.push(parentId);
            }
            if (!persons[childId].parentIds.includes(placeholderId)) {
                persons[childId].parentIds.push(placeholderId);
            }

            // Add child to parents' childIds
            if (!persons[parentId].childIds.includes(childId)) {
                persons[parentId].childIds.push(childId);
            }
            placeholder.childIds.push(childId);
        }
    }

    return {
        data: {
            persons,
            partnerships
        },
        stats: {
            totalPersons: Object.keys(persons).length,
            totalPartnerships: Object.keys(partnerships).length,
            skippedPersons: skippedIds.size,
            totalGedFamilies: families.size
        }
    };
}
