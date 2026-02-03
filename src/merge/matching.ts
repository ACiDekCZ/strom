/**
 * Merge Import - Matching Module
 * Smart algorithms for matching persons between existing and incoming data
 */

import { PersonId, Person, Partnership, StromData } from '../types.js';
import {
    PersonMatch,
    MatchConfidence,
    MatchReason,
    FieldConflict,
    MergeState,
    MergeStats
} from './types.js';

// ==================== NAME NORMALIZATION ====================

/**
 * Normalize text for comparison
 * Removes diacritics, converts to lowercase, trims
 */
export function normalizeName(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')  // Remove diacritics
        .replace(/[^a-z0-9\s]/g, '')      // Remove special characters
        .trim()
        .replace(/\s+/g, ' ');            // Normalize spaces
}

/**
 * Calculate string similarity using Levenshtein distance
 * Returns value between 0 (no match) and 1 (exact match)
 */
export function stringSimilarity(a: string, b: string): number {
    const normalizedA = normalizeName(a);
    const normalizedB = normalizeName(b);

    if (normalizedA === normalizedB) return 1;
    if (normalizedA.length === 0 || normalizedB.length === 0) return 0;

    const distance = levenshteinDistance(normalizedA, normalizedB);
    const maxLength = Math.max(normalizedA.length, normalizedB.length);

    return 1 - distance / maxLength;
}

/**
 * Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

// ==================== DATE HELPERS ====================

/**
 * Extract year from date string (YYYY-MM-DD or similar)
 */
function extractYear(dateStr: string | undefined): number | null {
    if (!dateStr) return null;
    const match = dateStr.match(/(\d{4})/);
    return match ? parseInt(match[1]) : null;
}

/**
 * Check if two dates match exactly (YYYY-MM-DD)
 */
function datesMatch(date1: string | undefined, date2: string | undefined): boolean {
    if (!date1 || !date2) return false;
    return date1 === date2;
}

/**
 * Check if two birth years match
 */
function yearsMatch(date1: string | undefined, date2: string | undefined): boolean {
    const year1 = extractYear(date1);
    const year2 = extractYear(date2);
    if (year1 === null || year2 === null) return false;
    return year1 === year2;
}

/**
 * Check if years are close (within tolerance)
 */
function yearsClose(date1: string | undefined, date2: string | undefined, tolerance: number = 2): boolean {
    const year1 = extractYear(date1);
    const year2 = extractYear(date2);
    if (year1 === null || year2 === null) return false;
    return Math.abs(year1 - year2) <= tolerance;
}

/**
 * Check if first names match considering middle names
 * Handles first word match and any word match for multi-part names
 */
function firstNamesMatch(name1: string, name2: string): { exact: boolean; firstWord: boolean; anyWord: boolean; prefix: boolean; matchedWord?: string } {
    const n1 = normalizeName(name1);
    const n2 = normalizeName(name2);

    // Exact match
    if (n1 === n2) {
        return { exact: true, firstWord: true, anyWord: true, prefix: true };
    }

    // Split into words
    const words1 = n1.split(' ').filter(w => w.length > 0);
    const words2 = n2.split(' ').filter(w => w.length > 0);

    // First word match
    const firstWord = words1[0] === words2[0];

    // Any word match - check if any word from name1 matches any word from name2
    let anyWord = false;
    let matchedWord: string | undefined;
    for (const w1 of words1) {
        for (const w2 of words2) {
            if (w1 === w2 && w1.length >= 2) { // At least 2 chars to avoid matching initials
                anyWord = true;
                matchedWord = w1;
                break;
            }
        }
        if (anyWord) break;
    }

    // Prefix match (one name starts with the other)
    const prefix = n1.startsWith(n2) || n2.startsWith(n1);

    return { exact: false, firstWord, anyWord, prefix, matchedWord };
}

/**
 * Check if last names are similar (handles typos and spelling variations)
 */
function lastNamesSimilar(name1: string, name2: string): { exact: boolean; similar: boolean; similarity: number } {
    const n1 = normalizeName(name1);
    const n2 = normalizeName(name2);

    if (n1 === n2) {
        return { exact: true, similar: true, similarity: 1.0 };
    }

    const similarity = stringSimilarity(name1, name2);

    // Consider similar if one is prefix of other or high similarity
    const isPrefix = n1.startsWith(n2) || n2.startsWith(n1);
    const similar = similarity >= 0.7 || isPrefix;

    return { exact: false, similar, similarity };
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Get partners of a person from data
 */
function getPartners(person: Person, data: StromData): Person[] {
    const partners: Person[] = [];
    for (const partnershipId of person.partnerships) {
        const partnership = data.partnerships[partnershipId];
        if (partnership) {
            const partnerId = partnership.person1Id === person.id
                ? partnership.person2Id
                : partnership.person1Id;
            const partner = data.persons[partnerId];
            if (partner) partners.push(partner);
        }
    }
    return partners;
}

/**
 * Get children of a person from data
 */
function getChildren(person: Person, data: StromData): Person[] {
    const children: Person[] = [];
    for (const childId of person.childIds) {
        const child = data.persons[childId];
        if (child) children.push(child);
    }
    return children;
}

/**
 * Get parents of a person from data
 */
function getParents(person: Person, data: StromData): Person[] {
    const parents: Person[] = [];
    for (const parentId of person.parentIds) {
        const parent = data.persons[parentId];
        if (parent) parents.push(parent);
    }
    return parents;
}

// ==================== MATCHING ALGORITHM ====================

/**
 * Match candidate with detailed scoring info
 */
interface MatchCandidate {
    existingId: PersonId;
    score: number;
    reasons: MatchReason[];
    bonusFromRelations: number;
}

/**
 * Find matches between incoming persons and existing persons
 * Uses multiple strategies for smart matching
 */
export function findMatches(
    existingData: StromData,
    incomingData: StromData
): PersonMatch[] {
    const matches: PersonMatch[] = [];
    const usedExisting = new Set<PersonId>();
    const usedIncoming = new Set<PersonId>();

    // Phase 1: Find direct matches (high confidence first)
    const directMatches = findDirectMatches(existingData, incomingData, usedExisting, usedIncoming);
    matches.push(...directMatches);

    // Phase 2: Propagate from confirmed matches (partner/family suggestions)
    const propagatedMatches = propagateFromMatches(
        existingData, incomingData, matches, usedExisting, usedIncoming
    );
    matches.push(...propagatedMatches);

    // Phase 3: Find remaining matches with lower threshold
    const remainingMatches = findRemainingMatches(
        existingData, incomingData, usedExisting, usedIncoming
    );
    matches.push(...remainingMatches);

    // Sort by confidence and score
    matches.sort((a, b) => {
        const confOrder = { high: 0, medium: 1, low: 2 };
        const confDiff = confOrder[a.confidence] - confOrder[b.confidence];
        if (confDiff !== 0) return confDiff;
        return b.score - a.score;
    });

    return matches;
}

/**
 * Phase 1: Find direct matches using multiple strategies
 */
function findDirectMatches(
    existingData: StromData,
    incomingData: StromData,
    usedExisting: Set<PersonId>,
    usedIncoming: Set<PersonId>
): PersonMatch[] {
    const matches: PersonMatch[] = [];

    // Process each incoming person
    for (const incoming of Object.values(incomingData.persons)) {
        if (incoming.isPlaceholder) continue;
        if (usedIncoming.has(incoming.id)) continue;

        const candidates: MatchCandidate[] = [];

        // Find potential candidates
        for (const existing of Object.values(existingData.persons)) {
            if (existing.isPlaceholder) continue;
            if (usedExisting.has(existing.id)) continue;

            const result = calculateMatchScore(existing, incoming, existingData, incomingData);

            if (result.score >= 35) { // Lower threshold to catch more candidates
                candidates.push({
                    existingId: existing.id,
                    score: result.score,
                    reasons: result.reasons,
                    bonusFromRelations: 0
                });
            }
        }

        // Sort by score (highest first)
        candidates.sort((a, b) => b.score - a.score);

        // Take best candidate if score is high enough
        if (candidates.length > 0) {
            const best = candidates[0];

            // Only accept if score is reasonable
            if (best.score >= 35) {
                const existingPerson = existingData.persons[best.existingId];
                const confidence = scoreToConfidence(best.score);
                const conflicts = detectConflicts(existingPerson, incoming);

                matches.push({
                    existingId: best.existingId,
                    incomingId: incoming.id,
                    confidence,
                    reasons: best.reasons,
                    score: best.score,
                    existingPerson,
                    incomingPerson: incoming,
                    conflicts
                });

                usedExisting.add(best.existingId);
                usedIncoming.add(incoming.id);
            }
        }
    }

    return matches;
}

/**
 * Phase 2: Propagate matches from confirmed ones
 * If A matches A', check if A's partner B matches A's partner B'
 */
function propagateFromMatches(
    existingData: StromData,
    incomingData: StromData,
    confirmedMatches: PersonMatch[],
    usedExisting: Set<PersonId>,
    usedIncoming: Set<PersonId>
): PersonMatch[] {
    const propagated: PersonMatch[] = [];

    for (const match of confirmedMatches) {
        // Only propagate from high/medium confidence matches
        if (match.confidence === 'low') continue;

        // Get partners of matched persons
        const existingPartners = getPartners(match.existingPerson, existingData);
        const incomingPartners = getPartners(match.incomingPerson, incomingData);

        // Try to match partners
        for (const incomingPartner of incomingPartners) {
            if (usedIncoming.has(incomingPartner.id)) continue;
            if (incomingPartner.isPlaceholder) continue;

            for (const existingPartner of existingPartners) {
                if (usedExisting.has(existingPartner.id)) continue;
                if (existingPartner.isPlaceholder) continue;

                // Calculate base score
                const baseResult = calculateMatchScore(
                    existingPartner, incomingPartner, existingData, incomingData
                );

                // Add bonus for being partner of matched person
                const partnerBonus = 20;
                const totalScore = Math.min(baseResult.score + partnerBonus, 100);

                // Accept with lower threshold due to relationship context
                if (totalScore >= 30 || baseResult.score >= 25) {
                    const confidence = scoreToConfidence(totalScore);
                    const conflicts = detectConflicts(existingPartner, incomingPartner);
                    const reasons = [...baseResult.reasons];
                    if (!reasons.includes('partner_of_matched')) {
                        reasons.push('partner_of_matched');
                    }

                    propagated.push({
                        existingId: existingPartner.id,
                        incomingId: incomingPartner.id,
                        confidence,
                        reasons,
                        score: totalScore,
                        existingPerson: existingPartner,
                        incomingPerson: incomingPartner,
                        conflicts
                    });

                    usedExisting.add(existingPartner.id);
                    usedIncoming.add(incomingPartner.id);
                    break; // Only one partner match per incoming partner
                }
            }
        }

        // Get children and try to match them
        const existingChildren = getChildren(match.existingPerson, existingData);
        const incomingChildren = getChildren(match.incomingPerson, incomingData);

        for (const incomingChild of incomingChildren) {
            if (usedIncoming.has(incomingChild.id)) continue;
            if (incomingChild.isPlaceholder) continue;

            for (const existingChild of existingChildren) {
                if (usedExisting.has(existingChild.id)) continue;
                if (existingChild.isPlaceholder) continue;

                const baseResult = calculateMatchScore(
                    existingChild, incomingChild, existingData, incomingData
                );

                // Add bonus for being child of matched person
                const childBonus = 15;
                const totalScore = Math.min(baseResult.score + childBonus, 100);

                if (totalScore >= 30 || baseResult.score >= 25) {
                    const confidence = scoreToConfidence(totalScore);
                    const conflicts = detectConflicts(existingChild, incomingChild);
                    const reasons = [...baseResult.reasons];
                    if (!reasons.includes('child_of_matched')) {
                        reasons.push('child_of_matched');
                    }

                    propagated.push({
                        existingId: existingChild.id,
                        incomingId: incomingChild.id,
                        confidence,
                        reasons,
                        score: totalScore,
                        existingPerson: existingChild,
                        incomingPerson: incomingChild,
                        conflicts
                    });

                    usedExisting.add(existingChild.id);
                    usedIncoming.add(incomingChild.id);
                    break;
                }
            }
        }

        // Get parents and try to match them
        const existingParents = getParents(match.existingPerson, existingData);
        const incomingParents = getParents(match.incomingPerson, incomingData);

        for (const incomingParent of incomingParents) {
            if (usedIncoming.has(incomingParent.id)) continue;
            if (incomingParent.isPlaceholder) continue;

            for (const existingParent of existingParents) {
                if (usedExisting.has(existingParent.id)) continue;
                if (existingParent.isPlaceholder) continue;

                // Gender must match for parents
                if (existingParent.gender !== incomingParent.gender) continue;

                const baseResult = calculateMatchScore(
                    existingParent, incomingParent, existingData, incomingData
                );

                // Add bonus for being parent of matched person
                const parentBonus = 15;
                const totalScore = Math.min(baseResult.score + parentBonus, 100);

                if (totalScore >= 30 || baseResult.score >= 25) {
                    const confidence = scoreToConfidence(totalScore);
                    const conflicts = detectConflicts(existingParent, incomingParent);
                    const reasons = [...baseResult.reasons];
                    if (!reasons.includes('parent_of_matched')) {
                        reasons.push('parent_of_matched');
                    }

                    propagated.push({
                        existingId: existingParent.id,
                        incomingId: incomingParent.id,
                        confidence,
                        reasons,
                        score: totalScore,
                        existingPerson: existingParent,
                        incomingPerson: incomingParent,
                        conflicts
                    });

                    usedExisting.add(existingParent.id);
                    usedIncoming.add(incomingParent.id);
                    break;
                }
            }
        }
    }

    return propagated;
}

/**
 * Phase 3: Find remaining matches with more relaxed criteria
 */
function findRemainingMatches(
    existingData: StromData,
    incomingData: StromData,
    usedExisting: Set<PersonId>,
    usedIncoming: Set<PersonId>
): PersonMatch[] {
    const matches: PersonMatch[] = [];

    for (const incoming of Object.values(incomingData.persons)) {
        if (incoming.isPlaceholder) continue;
        if (usedIncoming.has(incoming.id)) continue;

        const candidates: MatchCandidate[] = [];

        for (const existing of Object.values(existingData.persons)) {
            if (existing.isPlaceholder) continue;
            if (usedExisting.has(existing.id)) continue;

            // Try relaxed matching
            const result = calculateRelaxedMatchScore(existing, incoming);

            if (result.score >= 25) {
                candidates.push({
                    existingId: existing.id,
                    score: result.score,
                    reasons: result.reasons,
                    bonusFromRelations: 0
                });
            }
        }

        candidates.sort((a, b) => b.score - a.score);

        if (candidates.length > 0 && candidates[0].score >= 25) {
            const best = candidates[0];
            const existingPerson = existingData.persons[best.existingId];
            const confidence = scoreToConfidence(best.score);
            const conflicts = detectConflicts(existingPerson, incoming);

            matches.push({
                existingId: best.existingId,
                incomingId: incoming.id,
                confidence,
                reasons: best.reasons,
                score: best.score,
                existingPerson,
                incomingPerson: incoming,
                conflicts
            });

            usedExisting.add(best.existingId);
            usedIncoming.add(incoming.id);
        }
    }

    return matches;
}

/**
 * Convert score to confidence level
 */
function scoreToConfidence(score: number): MatchConfidence {
    if (score >= 85) return 'high';
    if (score >= 55) return 'medium';
    return 'low';
}

/**
 * Calculate match score between two persons
 * Uses multiple matching strategies
 */
function calculateMatchScore(
    existing: Person,
    incoming: Person,
    existingData: StromData,
    incomingData: StromData
): { score: number; reasons: MatchReason[] } {
    let score = 0;
    const reasons: MatchReason[] = [];

    // Gender must match
    if (existing.gender !== incoming.gender) {
        return { score: 0, reasons: [] };
    }

    // Analyze first names (handles middle names, multi-part names)
    const firstNameMatch = firstNamesMatch(existing.firstName, incoming.firstName);
    const firstNameSimilarity = stringSimilarity(existing.firstName, incoming.firstName);

    // Analyze last names (handles typos and spelling variations)
    const lastNameMatch = lastNamesSimilar(existing.lastName, incoming.lastName);

    // Full name similarity for traditional matching
    const fullNameSimilarity = (firstNameSimilarity + lastNameMatch.similarity) / 2;

    // Calculate name score with improved strategies
    if (fullNameSimilarity >= 0.95) {
        score += 40;
        reasons.push('exact_name_gender_birthdate');
    } else if (fullNameSimilarity >= 0.85) {
        score += 32;
    } else if (fullNameSimilarity >= 0.7) {
        score += 22;
    } else if (firstNameMatch.firstWord && lastNameMatch.similar) {
        // First word of first name matches AND last names similar
        score += 28;
        reasons.push('first_name_match');
    } else if (firstNameMatch.anyWord && lastNameMatch.similar) {
        // Any word in first name matches AND last names similar
        score += 26;
        reasons.push('first_name_match');
    } else if (firstNameMatch.exact && lastNameMatch.similarity >= 0.5) {
        // First name exact but last name differs - could be married name
        score += 18;
        reasons.push('first_name_match');
    } else if (firstNameMatch.firstWord && lastNameMatch.similarity >= 0.5) {
        // First word matches, last name somewhat similar
        score += 16;
        reasons.push('first_name_match');
    } else if (firstNameMatch.anyWord && lastNameMatch.similarity >= 0.5) {
        // Any word matches, last name somewhat similar
        score += 14;
        reasons.push('first_name_match');
    } else if (firstNameSimilarity >= 0.85 && lastNameMatch.similarity >= 0.6) {
        score += 15;
    } else if (firstNameMatch.exact || firstNameMatch.firstWord) {
        // Only first name matches - still a candidate with other evidence
        score += 10;
    } else if (firstNameMatch.anyWord) {
        // Any word in first name matches - weaker but still candidate
        score += 8;
    } else if (firstNameMatch.prefix && lastNameMatch.similar) {
        // Prefix match on first name + similar last name
        score += 12;
    } else {
        // Names too different
        return { score: 0, reasons: [] };
    }

    // Birth date matching
    if (datesMatch(existing.birthDate, incoming.birthDate)) {
        score += 35;
        if (!reasons.includes('exact_name_gender_birthdate')) {
            reasons.push('exact_name_gender_birthdate');
        }
    } else if (yearsMatch(existing.birthDate, incoming.birthDate)) {
        score += 22;
        reasons.push('name_gender_birthyear');
    } else if (yearsClose(existing.birthDate, incoming.birthDate, 2)) {
        // Birth year within 2 years - could be uncertainty in records
        score += 12;
    }

    // Death date matching
    if (datesMatch(existing.deathDate, incoming.deathDate)) {
        score += 12;
    } else if (yearsMatch(existing.deathDate, incoming.deathDate)) {
        score += 6;
    }

    // Birth place matching
    if (existing.birthPlace && incoming.birthPlace) {
        const placeSimilarity = stringSimilarity(existing.birthPlace, incoming.birthPlace);
        if (placeSimilarity >= 0.9) {
            score += 12;
        } else if (placeSimilarity >= 0.7) {
            score += 6;
        }
    }

    // Parent matching bonus
    const parentScore = calculateParentMatchScore(existing, incoming, existingData, incomingData);
    if (parentScore > 0) {
        score += parentScore;
        reasons.push('name_gender_parents');
    }

    // Partner matching bonus (if partners have similar names)
    const partnerScore = calculatePartnerMatchScore(existing, incoming, existingData, incomingData);
    if (partnerScore > 0) {
        score += partnerScore;
        if (!reasons.includes('partner_similarity')) {
            reasons.push('partner_similarity');
        }
    }

    // Ensure we have at least one reason
    if (score >= 30 && reasons.length === 0) {
        reasons.push('name_similarity_relationships');
    }

    return { score: Math.min(score, 100), reasons };
}

/**
 * Relaxed matching for remaining unmatched persons
 * Used when normal matching fails
 */
function calculateRelaxedMatchScore(
    existing: Person,
    incoming: Person
): { score: number; reasons: MatchReason[] } {
    const reasons: MatchReason[] = [];

    // Gender must still match
    if (existing.gender !== incoming.gender) {
        return { score: 0, reasons: [] };
    }

    // Use improved name matching
    const firstNameMatch = firstNamesMatch(existing.firstName, incoming.firstName);
    const lastNameMatch = lastNamesSimilar(existing.lastName, incoming.lastName);
    const firstNameSimilarity = stringSimilarity(existing.firstName, incoming.firstName);
    const lastNameSimilarity = stringSimilarity(existing.lastName, incoming.lastName);

    let score = 0;

    // First word of first name + similar last name + birth year = strong candidate
    if (firstNameMatch.firstWord && lastNameMatch.similar && yearsMatch(existing.birthDate, incoming.birthDate)) {
        score = 55;
        reasons.push('first_name_birthyear');
    }
    // Any word match + similar last name + birth year (close)
    else if (firstNameMatch.anyWord && lastNameMatch.similar && yearsClose(existing.birthDate, incoming.birthDate, 5)) {
        score = 52;
        reasons.push('first_name_birthyear');
    }
    // First name exact + birth year match = strong candidate
    else if (firstNameMatch.exact && yearsMatch(existing.birthDate, incoming.birthDate)) {
        score = 45;
        reasons.push('first_name_birthyear');
    }
    // Any word match + similar last name + same birth year
    else if (firstNameMatch.anyWord && lastNameMatch.similar && yearsMatch(existing.birthDate, incoming.birthDate)) {
        score = 48;
        reasons.push('first_name_birthyear');
    }
    // First word match + birth year
    else if (firstNameMatch.firstWord && yearsMatch(existing.birthDate, incoming.birthDate)) {
        score = 42;
        reasons.push('first_name_birthyear');
    }
    // Any word match + birth year
    else if (firstNameMatch.anyWord && yearsMatch(existing.birthDate, incoming.birthDate)) {
        score = 40;
        reasons.push('first_name_birthyear');
    }
    // First name exact + close birth year
    else if (firstNameMatch.exact && yearsClose(existing.birthDate, incoming.birthDate, 3)) {
        score = 35;
        reasons.push('first_name_birthyear');
    }
    // First word match + close birth year
    else if (firstNameMatch.firstWord && yearsClose(existing.birthDate, incoming.birthDate, 3)) {
        score = 33;
        reasons.push('first_name_birthyear');
    }
    // Any word match + close birth year
    else if (firstNameMatch.anyWord && yearsClose(existing.birthDate, incoming.birthDate, 5)) {
        score = 32;
        reasons.push('first_name_birthyear');
    }
    // First name similar + exact birth date
    else if (firstNameSimilarity >= 0.8 && datesMatch(existing.birthDate, incoming.birthDate)) {
        score = 40;
        reasons.push('name_gender_birthyear');
    }
    // Last name similar + birth year (could be sibling or relative)
    else if (lastNameMatch.similarity >= 0.85 && yearsMatch(existing.birthDate, incoming.birthDate)) {
        score = 32;
        reasons.push('lastname_birthyear');
    }
    // Any name similarity (>50%) + exact birth year + gender = weak candidate
    else if ((firstNameSimilarity >= 0.5 || lastNameSimilarity >= 0.5) && yearsMatch(existing.birthDate, incoming.birthDate)) {
        score = 30;
        reasons.push('name_gender_birthyear');
    }
    // Close birth year (within 5 years) + any word match in name
    else if (yearsClose(existing.birthDate, incoming.birthDate, 5) && firstNameMatch.anyWord) {
        score = 28;
        reasons.push('name_gender_birthyear');
    }
    // Same birth year + some name similarity - very weak, but offer for review
    else if (yearsClose(existing.birthDate, incoming.birthDate, 1) && (firstNameSimilarity >= 0.4 || lastNameSimilarity >= 0.6)) {
        score = 25;
        reasons.push('name_gender_birthyear');
    }

    return { score, reasons };
}

/**
 * Calculate parent match score
 */
function calculateParentMatchScore(
    existing: Person,
    incoming: Person,
    existingData: StromData,
    incomingData: StromData
): number {
    if (existing.parentIds.length === 0 || incoming.parentIds.length === 0) {
        return 0;
    }

    let matchingParents = 0;

    for (const existingParentId of existing.parentIds) {
        const existingParent = existingData.persons[existingParentId];
        if (!existingParent) continue;

        for (const incomingParentId of incoming.parentIds) {
            const incomingParent = incomingData.persons[incomingParentId];
            if (!incomingParent) continue;

            // Gender must match for parents
            if (existingParent.gender !== incomingParent.gender) continue;

            // Check if parents match by name
            const firstNameSim = stringSimilarity(existingParent.firstName, incomingParent.firstName);
            const lastNameSim = stringSimilarity(existingParent.lastName, incomingParent.lastName);

            // Accept if first name is similar (last name may differ for women)
            if (firstNameSim >= 0.85 && (lastNameSim >= 0.7 || firstNameSim >= 0.95)) {
                matchingParents++;
                break;
            }
        }
    }

    // Score based on matching parents
    if (matchingParents >= 2) return 18;
    if (matchingParents >= 1) return 10;
    return 0;
}

/**
 * Calculate partner match score
 * If both persons have partners with similar names, it's a good sign
 */
function calculatePartnerMatchScore(
    existing: Person,
    incoming: Person,
    existingData: StromData,
    incomingData: StromData
): number {
    const existingPartners = getPartners(existing, existingData);
    const incomingPartners = getPartners(incoming, incomingData);

    if (existingPartners.length === 0 || incomingPartners.length === 0) {
        return 0;
    }

    let bestPartnerScore = 0;

    for (const existingPartner of existingPartners) {
        for (const incomingPartner of incomingPartners) {
            // Gender must match
            if (existingPartner.gender !== incomingPartner.gender) continue;

            const firstNameSim = stringSimilarity(existingPartner.firstName, incomingPartner.firstName);
            const lastNameSim = stringSimilarity(existingPartner.lastName, incomingPartner.lastName);

            // Partner has similar name
            if (firstNameSim >= 0.85) {
                let partnerScore = 8;
                if (lastNameSim >= 0.85) partnerScore = 12;
                if (yearsMatch(existingPartner.birthDate, incomingPartner.birthDate)) {
                    partnerScore += 5;
                }
                bestPartnerScore = Math.max(bestPartnerScore, partnerScore);
            }
        }
    }

    return bestPartnerScore;
}

// ==================== CONFLICT DETECTION ====================

/**
 * Detect conflicting fields between two persons
 */
export function detectConflicts(existing: Person, incoming: Person): FieldConflict[] {
    const conflicts: FieldConflict[] = [];
    const fieldsToCheck: (keyof Person)[] = [
        'firstName',
        'lastName',
        'birthDate',
        'birthPlace',
        'deathDate',
        'deathPlace'
    ];

    for (const field of fieldsToCheck) {
        const existingValue = existing[field] as string | undefined;
        const incomingValue = incoming[field] as string | undefined;

        // Skip if both are empty
        if (!existingValue && !incomingValue) continue;

        // Conflict if both have values and they differ
        if (existingValue && incomingValue && existingValue !== incomingValue) {
            conflicts.push({
                field,
                existingValue,
                incomingValue,
                resolution: 'keep_existing' // Default
            });
        }
        // Not a conflict if only one has value (can be merged)
    }

    return conflicts;
}

// ==================== CROSS-TREE MATCHING ====================

/**
 * Quick match score for cross-tree comparison
 * Simplified version without relationship propagation (faster)
 * Returns score 0-100, threshold 50+ = match
 */
export function quickMatchScore(p1: Person, p2: Person): number {
    // Gender must match
    if (p1.gender !== p2.gender) return 0;

    const firstNameSim = stringSimilarity(p1.firstName, p2.firstName);
    const lastNameSim = stringSimilarity(p1.lastName, p2.lastName);
    const nameSim = (firstNameSim + lastNameSim) / 2;

    // Names too different - no match
    if (nameSim < 0.7) return 0;

    // Base score from name similarity
    let score = nameSim >= 0.9 ? 45 : nameSim >= 0.8 ? 35 : 25;

    // Birth date bonus
    if (datesMatch(p1.birthDate, p2.birthDate)) {
        score += 40;
    } else if (yearsMatch(p1.birthDate, p2.birthDate)) {
        score += 25;
    } else if (yearsClose(p1.birthDate, p2.birthDate, 3)) {
        score += 10;
    }

    // Death date bonus
    if (datesMatch(p1.deathDate, p2.deathDate)) {
        score += 10;
    } else if (yearsMatch(p1.deathDate, p2.deathDate)) {
        score += 5;
    }

    return Math.min(score, 100);
}

// ==================== MERGE STATE HELPERS ====================

/**
 * Create initial merge state from data
 */
export function createMergeState(
    existingData: StromData,
    incomingData: StromData
): MergeState {
    const matches = findMatches(existingData, incomingData);

    // Find unmatched persons
    const matchedExisting = new Set(matches.map(m => m.existingId));
    const matchedIncoming = new Set(matches.map(m => m.incomingId));

    const unmatchedExisting = Object.keys(existingData.persons)
        .filter(id => !matchedExisting.has(id as PersonId))
        .map(id => id as PersonId);

    const unmatchedIncoming = Object.keys(incomingData.persons)
        .filter(id => !matchedIncoming.has(id as PersonId))
        .filter(id => !incomingData.persons[id as PersonId].isPlaceholder) // Skip placeholders
        .map(id => id as PersonId);

    return {
        existingData,
        incomingData,
        matches,
        unmatchedExisting,
        unmatchedIncoming,
        decisions: new Map(),
        conflictResolutions: new Map(),
        phase: 'analyzing'
    };
}

/**
 * Calculate merge statistics
 */
export function calculateMergeStats(state: MergeState): MergeStats {
    const highConfidence = state.matches.filter(m => m.confidence === 'high').length;
    const mediumConfidence = state.matches.filter(m => m.confidence === 'medium').length;
    const lowConfidence = state.matches.filter(m => m.confidence === 'low').length;
    const withConflicts = state.matches.filter(m => m.conflicts.length > 0).length;

    return {
        total: Object.keys(state.incomingData.persons).length,
        matched: state.matches.length,
        highConfidence,
        mediumConfidence,
        lowConfidence,
        unmatched: state.unmatchedIncoming.length,
        withConflicts
    };
}

/**
 * Update match decision
 */
export function updateMatchDecision(
    state: MergeState,
    incomingId: PersonId,
    decision: 'confirm' | 'reject' | { type: 'manual_match'; targetId: PersonId }
): void {
    if (typeof decision === 'string') {
        state.decisions.set(incomingId, { type: decision });
    } else {
        state.decisions.set(incomingId, decision);
    }
}

/**
 * Update conflict resolution
 */
export function updateConflictResolution(
    state: MergeState,
    incomingId: PersonId,
    field: keyof Person,
    resolution: 'keep_existing' | 'use_incoming'
): void {
    const match = state.matches.find(m => m.incomingId === incomingId);
    if (!match) return;

    const conflict = match.conflicts.find(c => c.field === field);
    if (conflict) {
        conflict.resolution = resolution;
    }

    // Store updated conflicts
    state.conflictResolutions.set(incomingId, match.conflicts);
}

/**
 * Re-analyze matches after user changes
 * Preserves manual matches and propagates from them
 */
export function reanalyzeMatches(state: MergeState): void {
    // Get rejected and confirmed matches
    const rejectedIncoming = new Set<PersonId>();
    const manualMatches: PersonMatch[] = [];
    const confirmedMatches: PersonMatch[] = [];

    for (const [incomingId, decision] of state.decisions) {
        if (decision.type === 'reject') {
            rejectedIncoming.add(incomingId);
        } else if (decision.type === 'manual_match') {
            const incoming = state.incomingData.persons[incomingId];
            const existing = state.existingData.persons[decision.targetId];
            if (incoming && existing) {
                manualMatches.push({
                    existingId: decision.targetId,
                    incomingId,
                    confidence: 'high',
                    reasons: ['manual'],
                    score: 100,
                    existingPerson: existing,
                    incomingPerson: incoming,
                    conflicts: detectConflicts(existing, incoming)
                });
            }
        } else if (decision.type === 'confirm') {
            const match = state.matches.find(m => m.incomingId === incomingId);
            if (match) {
                confirmedMatches.push(match);
            }
        }
    }

    // Track used persons
    const usedExisting = new Set<PersonId>(manualMatches.map(m => m.existingId));
    const usedIncoming = new Set<PersonId>(manualMatches.map(m => m.incomingId));

    // Add confirmed matches
    for (const match of confirmedMatches) {
        if (!usedExisting.has(match.existingId) && !usedIncoming.has(match.incomingId)) {
            usedExisting.add(match.existingId);
            usedIncoming.add(match.incomingId);
        }
    }

    // Add rejected to used incoming
    for (const id of rejectedIncoming) {
        usedIncoming.add(id);
    }

    // Find new automatic matches
    const autoMatches = findMatches(state.existingData, state.incomingData)
        .filter(m => !rejectedIncoming.has(m.incomingId))
        .filter(m => !usedExisting.has(m.existingId))
        .filter(m => !usedIncoming.has(m.incomingId));

    // Combine all matches
    const allMatches = [...manualMatches, ...confirmedMatches, ...autoMatches];

    // Deduplicate by incoming ID
    const seenIncoming = new Set<PersonId>();
    const uniqueMatches: PersonMatch[] = [];
    for (const match of allMatches) {
        if (!seenIncoming.has(match.incomingId)) {
            seenIncoming.add(match.incomingId);
            uniqueMatches.push(match);
        }
    }

    // Update state
    state.matches = uniqueMatches;

    // Recalculate unmatched
    const matchedIncoming = new Set(uniqueMatches.map(m => m.incomingId));
    state.unmatchedIncoming = Object.keys(state.incomingData.persons)
        .filter(id => !matchedIncoming.has(id as PersonId))
        .filter(id => !rejectedIncoming.has(id as PersonId))
        .filter(id => !state.incomingData.persons[id as PersonId].isPlaceholder)
        .map(id => id as PersonId);
}
