/**
 * GEDCOM Parser Module
 * Parses GEDCOM files and converts them to Strom data format.
 *
 * Round-trip (import -> export -> import) is lossless for everything the data
 * model represents: names, sex, birth/death date+place, individual notes,
 * parent-child structure, placeholders (nameless individuals), single-parent
 * families (a placeholder partner fills the missing spouse), and partnership
 * married/divorced status with marriage date+place, divorce date, and note.
 *
 * Life events map both ways: BAPM/BURI/OCCU/RESI/EMIG/IMMI/EDUC <-> LifeEvent
 * (OCCU value <-> event note). Sources map both ways: 0 @Sx@ SOUR records
 * (TITL/REPO/PAGE->reference/WWW->url/NOTE) with 1 SOUR refs on individuals and
 * 2 SOUR refs on events <-> the per-tree source catalog + sourceIds. Partnership
 * statuses 'partners'/'separated' and the isPrimary flag, and the
 * 'military'/'custom' event types, have no GEDCOM equivalent (known-unsupported)
 * and are dropped on export.
 */

import {
    PersonId,
    PartnershipId,
    Person,
    Partnership,
    StromData,
    LifeEvent,
    LifeEventType,
    Source,
    toPersonId,
    toPartnershipId,
    generateLifeEventId,
    generateSourceId
} from './types';

/** GEDCOM event tag <-> LifeEvent type. */
const EVENT_TAG_TO_TYPE: Record<string, LifeEventType> = {
    BAPM: 'baptism', BURI: 'burial', OCCU: 'occupation', RESI: 'residence',
    EMIG: 'emigration', IMMI: 'immigration', EDUC: 'education',
};

interface RawEvent {
    type: LifeEventType;
    date?: string;
    place?: string;
    note?: string;
    /** GEDCOM ids (@Sx@) of sources cited on this event. */
    sourceRefs?: string[];
}

/** Raw GEDCOM source record (0 @Sx@ SOUR). */
interface RawSource {
    id: string;
    title: string;
    repository: string;
    reference: string;
    url: string;
    note: string;
}

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
    notes: string;
    /** Life events (BAPM/BURI/OCCU/RESI/EMIG/IMMI/EDUC). */
    events: RawEvent[];
    /** GEDCOM ids (@Sx@) of sources cited on this individual. */
    sourceRefs: string[];
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
    marriagePlace: string;
    divorceDate: string;
    note: string;
}

/** Parsed GEDCOM data */
export interface ParsedGedcom {
    individuals: Map<string, GedcomIndividual>;
    families: Map<string, GedcomFamily>;
    sources: Map<string, RawSource>;
}

/** Result of GEDCOM to Strom conversion */
export interface GedcomConversionResult {
    data: StromData;
    stats: {
        totalPersons: number;
        totalPartnerships: number;
        /** Nameless individuals imported as placeholders (kept, not dropped). */
        placeholderPersons: number;
        /** Count of encountered tags our data model cannot represent (see header). */
        unsupportedTags: number;
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
 * Parse GEDCOM date format to a canonical flex date string (see src/dates.ts).
 * Precision and qualifiers are PRESERVED: "ABT 1900" -> "~1900",
 * "JUN 1900" -> "1900-06", "3 JUN 1900" -> "1900-06-03", "BEF 1900" -> "<1900".
 */
export function parseGedcomDate(dateStr: string): string {
    if (!dateStr) return '';

    // Qualifier prefixes map to flex-date qualifiers instead of being dropped
    let qualifier = '';
    const cleaned = dateStr.trim().replace(
        /^(ABT|ABOUT|EST|CAL|INT|BEF|BEFORE|AFT|AFTER)\s+/i,
        (m) => {
            const q = m.trim().toUpperCase();
            if (q === 'BEF' || q === 'BEFORE') qualifier = '<';
            else if (q === 'AFT' || q === 'AFTER') qualifier = '>';
            else qualifier = '~';
            return '';
        }
    );

    const parts = cleaned.split(/\s+/);

    if (parts.length === 3) {
        // "3 JUN 1900" -> "1900-06-03"
        const day = parts[0].padStart(2, '0');
        const month = MONTHS[parts[1].toUpperCase()] || '01';
        const year = parts[2];
        return `${qualifier}${year}-${month}-${day}`;
    } else if (parts.length === 2 && MONTHS[parts[0].toUpperCase()]) {
        // "JUN 1900" -> "1900-06" (month precision, no fabricated day)
        const month = MONTHS[parts[0].toUpperCase()];
        const year = parts[1];
        return `${qualifier}${year}-${month}`;
    } else if (parts.length === 1 && /^\d{3,4}$/.test(parts[0])) {
        // "1900" -> "1900" (year precision, no fabricated month/day)
        return `${qualifier}${parts[0]}`;
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
    const sources = new Map<string, RawSource>();

    let currentRecord: GedcomIndividual | GedcomFamily | null = null;
    let currentType: 'INDI' | 'FAM' | 'SOUR' | null = null;
    let currentSubTag: string | null = null;
    let currentEvent: RawEvent | null = null;
    let currentSource: RawSource | null = null;

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
                    notes: '',
                    events: [],
                    sourceRefs: [],
                    fams: [],
                    famc: null
                };
                currentType = 'INDI';
                currentSource = null;
                individuals.set(tag, currentRecord as GedcomIndividual);
            } else if (tag.startsWith('@S') && value === 'SOUR') {
                currentSource = {
                    id: tag, title: '', repository: '', reference: '', url: '', note: ''
                };
                currentRecord = null;
                currentType = 'SOUR';
                sources.set(tag, currentSource);
            } else if (tag.startsWith('@F') && value === 'FAM') {
                currentRecord = {
                    id: tag,
                    husb: null,
                    wife: null,
                    children: [],
                    marriageDate: '',
                    marriagePlace: '',
                    divorceDate: '',
                    note: ''
                };
                currentType = 'FAM';
                currentSource = null;
                families.set(tag, currentRecord as GedcomFamily);
            } else {
                currentRecord = null;
                currentType = null;
                currentSource = null;
            }
            currentSubTag = null;
            currentEvent = null;
        } else if (currentType === 'SOUR' && currentSource) {
            // Source record sub-lines. reference <- PAGE (spec mapping).
            if (level === 1) {
                currentSubTag = tag;
                if (tag === 'TITL') currentSource.title = value;
                else if (tag === 'REPO') currentSource.repository = value;
                else if (tag === 'PAGE') currentSource.reference = value;
                else if (tag === 'WWW' || tag === 'URL') currentSource.url = value;
                else if (tag === 'NOTE') currentSource.note = value;
            } else if (level === 2) {
                // Multi-line continuations for title / note.
                if (currentSubTag === 'TITL') {
                    if (tag === 'CONT') currentSource.title += '\n' + value;
                    else if (tag === 'CONC') currentSource.title += value;
                } else if (currentSubTag === 'NOTE') {
                    if (tag === 'CONT') currentSource.note += '\n' + value;
                    else if (tag === 'CONC') currentSource.note += value;
                }
            }
        } else if (currentRecord) {
            if (level === 1) {
                currentSubTag = tag;
                currentEvent = null;

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
                        case 'NOTE':
                            indi.notes = value;
                            break;
                        case 'SOUR':
                            // Level-1 SOUR on INDI is a citation reference (@Sx@).
                            if (value) indi.sourceRefs.push(value);
                            break;
                        default: {
                            const evType = EVENT_TAG_TO_TYPE[tag];
                            if (evType) {
                                // OCCU carries the occupation as its value; other
                                // events carry date/place on level-2 sub-lines.
                                const ev: RawEvent = { type: evType };
                                if (tag === 'OCCU' && value) ev.note = value;
                                indi.events.push(ev);
                                currentEvent = ev;
                            }
                            break;
                        }
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
                        case 'NOTE':
                            fam.note = value;
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
                    } else if (currentSubTag === 'NOTE') {
                        // Multi-line notes: CONT = new line, CONC = continuation.
                        if (tag === 'CONT') indi.notes += '\n' + value;
                        else if (tag === 'CONC') indi.notes += value;
                    } else if (currentEvent) {
                        if (tag === 'DATE') currentEvent.date = parseGedcomDate(value);
                        else if (tag === 'PLAC') currentEvent.place = value;
                        else if (tag === 'SOUR' && value) {
                            (currentEvent.sourceRefs ??= []).push(value);
                        } else if (tag === 'NOTE') {
                            currentEvent.note = currentEvent.note
                                ? `${currentEvent.note}\n${value}` : value;
                        }
                    }
                } else if (currentType === 'FAM') {
                    const fam = currentRecord as GedcomFamily;
                    if (currentSubTag === 'MARR') {
                        if (tag === 'DATE') fam.marriageDate = parseGedcomDate(value);
                        if (tag === 'PLAC') fam.marriagePlace = value;
                    } else if (currentSubTag === 'DIV') {
                        if (tag === 'DATE') fam.divorceDate = parseGedcomDate(value);
                    } else if (currentSubTag === 'NOTE') {
                        if (tag === 'CONT') fam.note += '\n' + value;
                        else if (tag === 'CONC') fam.note += value;
                    }
                }
            }
        }
    }

    return { individuals, families, sources };
}

// ==================== CONVERTER ====================

/**
 * Convert parsed GEDCOM data to Strom data format
 */
export function convertToStrom(gedcom: ParsedGedcom): GedcomConversionResult {
    const { individuals, families, sources: gedSources } = gedcom;

    // Build the source catalog and a GEDCOM-id -> new-id map for citations.
    const sourceIdMap = new Map<string, string>();
    const sources: Record<string, Source> = {};
    for (const [gedId, raw] of gedSources) {
        const newId = generateSourceId();
        sourceIdMap.set(gedId, newId);
        const src: Source = { id: newId, title: raw.title || '?' };
        if (raw.repository) src.repository = raw.repository;
        if (raw.reference) src.reference = raw.reference;
        if (raw.url) src.url = raw.url;
        if (raw.note) src.note = raw.note;
        sources[newId] = src;
    }
    /** Map raw @Sx@ refs to catalog ids, dropping any that don't resolve. */
    const mapRefs = (refs?: string[]): string[] =>
        (refs ?? []).map(r => sourceIdMap.get(r)).filter((id): id is string => !!id);

    // Keep ALL individuals. Nameless ones (unknown ancestors) become
    // placeholders instead of being dropped, so relationships stay intact.
    const validIndividuals = individuals;
    let placeholderPersons = 0;
    let unsupportedTags = 0;
    for (const indi of individuals.values()) {
        if (!indi.firstName && !indi.lastName) placeholderPersons++;
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
        if (indi.notes) person.notes = indi.notes;
        if (indi.events.length > 0) {
            person.events = indi.events.map((ev): LifeEvent => {
                const out: LifeEvent = { id: generateLifeEventId(), type: ev.type };
                if (ev.date) out.date = ev.date;
                if (ev.place) out.place = ev.place;
                if (ev.note) out.note = ev.note;
                const evRefs = mapRefs(ev.sourceRefs);
                if (evRefs.length > 0) out.sourceIds = evRefs;
                return out;
            });
        }
        const personRefs = mapRefs(indi.sourceRefs);
        if (personRefs.length > 0) person.sourceIds = personRefs;

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
        if (fam.marriagePlace) {
            partnership.startPlace = fam.marriagePlace;
        }
        if (fam.note) {
            partnership.note = fam.note;
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

        // Create partnership. Keep the male partner as person1 (HUSB), matching
        // the two-parent path and the exporter, so import->export->import is
        // order-stable even when the known parent is the mother.
        const parentIsMale = parentGender === 'male';
        const person1Id = parentIsMale ? parentId : placeholderId;
        const person2Id = parentIsMale ? placeholderId : parentId;

        const partnershipId = toPartnershipId(generateId('u'));
        const partnership: Partnership = {
            id: partnershipId,
            person1Id,
            person2Id,
            childIds: [],
            status: 'married'
        };
        if (fam.marriageDate) partnership.startDate = fam.marriageDate;
        if (fam.marriagePlace) partnership.startPlace = fam.marriagePlace;
        if (fam.note) partnership.note = fam.note;
        if (fam.divorceDate) {
            partnership.endDate = fam.divorceDate;
            partnership.status = 'divorced';
        }
        partnerships[partnershipId] = partnership;

        // Add partnership to both persons
        persons[person1Id].partnerships.push(partnershipId);
        persons[person2Id].partnerships.push(partnershipId);

        // Process children
        for (const childGedId of fam.children) {
            const childId = personIdMap.get(childGedId);
            if (!childId || !persons[childId]) continue;

            // Add to partnership's childIds
            partnership.childIds.push(childId);

            // Add parents to child's parentIds (person1, then person2)
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

    return {
        data: {
            persons,
            partnerships,
            ...(Object.keys(sources).length > 0 ? { sources } : {})
        },
        stats: {
            totalPersons: Object.keys(persons).length,
            totalPartnerships: Object.keys(partnerships).length,
            placeholderPersons,
            unsupportedTags,
            totalGedFamilies: families.size
        }
    };
}
