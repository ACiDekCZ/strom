/**
 * Merge Import - Matching Module
 * Smart algorithms for matching persons between existing and incoming data
 */

import { parseFlexDate, yearOf } from '../dates.js';
import { PersonId, Person, Partnership, StromData, gendersCompatible } from '../types.js';
import { sameSurname, withSurnameRules } from '../surnames.js';
import { detectPartnershipConflicts, AUTO_CONFIRM_SCORE } from './executor.js';
import { idEvidence, sameFileRecord, strongIdIndex } from './id-match.js';
import {
    PersonMatch,
    MatchConfidence,
    MatchReason,
    FieldConflict,
    MergeState,
    MergeStats
} from './types.js';

// ==================== ONE MATCHING PASS ====================

/**
 * What one matching pass (findMatches, findSimilarPersons) works out once.
 * A pass compares every incoming person with every person of the tree, so
 * the same names, surname pairs and dates come up again and again; each
 * answer here is a pure function of its strings (and of a tree that does not
 * change during the pass), so remembering it changes no result.
 */
interface MatchPass {
    normalized: Map<string, string>;
    similarity: Map<string, Map<string, number>>;
    firstNames: Map<string, Map<string, FirstNamesResult>>;
    lastNames: Map<string, Map<string, LastNameResult>>;
    sameSurname: Map<StromData, Map<string, Map<string, boolean>>>;
    /** bestLastNameMatch by tree, file and the two persons' surname signatures. */
    bestLastNames: Map<StromData, Map<StromData, Map<string, Map<string, LastNameResult>>>>;
    signatures: WeakMap<object, string>;
    /** firstNameMayQuickMatch by the two normalized first names. */
    firstNameBound: Map<string, Map<string, boolean>>;
}

let matchPass: MatchPass | null = null;

/** The answer for (a, b) in a two-level memo, computed once. */
function memo2<V>(table: Map<string, Map<string, V>>, a: string, b: string, compute: () => V): V {
    let row = table.get(a);
    if (!row) table.set(a, row = new Map());
    let value = row.get(b);
    if (value === undefined && !row.has(b)) {
        value = compute();
        row.set(b, value);
    }
    return value as V;
}

/**
 * Run `fn` as one matching pass over these trees (see MatchPass); passes do
 * not nest (inside a pass `fn` simply runs in it). The trees must not change
 * while it runs. Cross-tree matching ("Also in" on the cards) runs its card
 * loop in one pass over the current tree and every other tree.
 */
export function inMatchPass<T>(trees: StromData[], fn: () => T): T {
    if (matchPass) return fn();
    matchPass = { normalized: new Map(), similarity: new Map(), firstNames: new Map(), lastNames: new Map(), sameSurname: new Map(), bestLastNames: new Map(), signatures: new WeakMap(), firstNameBound: new Map() };
    try {
        const run = trees.reduceRight<() => T>((inner, data) => () => withSurnameRules(data, inner), fn);
        return run();
    } finally {
        matchPass = null;
    }
}

/** sameSurname, remembered for the pass. */
function sameSurnameIn(a: string, b: string, data: StromData): boolean {
    if (!matchPass) return sameSurname(a, b, data);
    let table = matchPass.sameSurname.get(data);
    if (!table) matchPass.sameSurname.set(data, table = new Map());
    return memo2(table, a, b, () => sameSurname(a, b, data));
}

// ==================== NAME NORMALIZATION ====================

/**
 * Letters that carry no combining mark in Unicode, so NFD leaves them intact
 * although a reader of Latin script treats them as a plain letter with an
 * accent (Łukasz = Lukasz, Straße = Strasse). Folded explicitly.
 */
const LETTER_FOLDS: Record<string, string> = {
    'ł': 'l', 'ß': 'ss', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'đ': 'd', 'ð': 'd',
    'þ': 'th', 'ħ': 'h', 'ı': 'i', 'ŀ': 'l', 'ŧ': 't', 'ĸ': 'k', 'ŋ': 'n',
};

/**
 * Normalize text for comparison
 * Removes diacritics, converts to lowercase, trims. Letters and digits of
 * EVERY script survive (Cyrillic, Greek, CJK …) — only punctuation and marks
 * are dropped. A name made only of punctuation normalizes to '' and means
 * "no name": callers must treat '' as unknown, never as equal to another ''.
 */
export function normalizeName(text: string): string {
    const cache = matchPass?.normalized;
    if (!cache) return normalizeNameNow(text);
    let out = cache.get(text);
    if (out === undefined) cache.set(text, out = normalizeNameNow(text));
    return out;
}

function normalizeNameNow(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')                           // Remove diacritics
        .replace(/[łßøæœđðþħıŀŧĸŋ]/g, ch => LETTER_FOLDS[ch] ?? ch)
        .replace(/[^\p{L}\p{N}\s]/gu, '')                // Remove special characters
        .trim()
        .replace(/\s+/g, ' ');                             // Normalize spaces
}

/**
 * Calculate string similarity using Levenshtein distance
 * Returns value between 0 (no match) and 1 (exact match)
 */
export function stringSimilarity(a: string, b: string): number {
    if (matchPass) return memo2(matchPass.similarity, a, b, () => stringSimilarityNow(a, b));
    return stringSimilarityNow(a, b);
}

function stringSimilarityNow(a: string, b: string): number {
    return normalizedSimilarity(normalizeName(a), normalizeName(b));
}

/** stringSimilarity of two names already normalized (normalizeName). */
function normalizedSimilarity(normalizedA: string, normalizedB: string): number {
    // No name is not a name: two blanks (or two names in a script the
    // normalizer cannot read) must never count as the same name.
    if (normalizedA.length === 0 || normalizedB.length === 0) return 0;
    if (normalizedA === normalizedB) return 1;

    const distance = levenshteinDistance(normalizedA, normalizedB);
    const maxLength = Math.max(normalizedA.length, normalizedB.length);

    return 1 - distance / maxLength;
}

/**
 * Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
    // Two rows of the matrix (row i of b against every prefix of a) are enough.
    let previous: number[] = [];
    for (let j = 0; j <= a.length; j++) previous[j] = j;

    for (let i = 1; i <= b.length; i++) {
        const current: number[] = [i];
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                current[j] = previous[j - 1];
            } else {
                current[j] = Math.min(
                    previous[j - 1] + 1,   // substitution
                    current[j - 1] + 1,    // insertion
                    previous[j] + 1        // deletion
                );
            }
        }
        previous = current;
    }

    return previous[a.length];
}

// ==================== DATE HELPERS ====================

/**
 * Extract year from date string (YYYY-MM-DD or similar)
 */
function extractYear(dateStr: string | undefined): number | null {
    if (!dateStr) return null;
    const y = yearOf(dateStr);   // flex-aware ('~1880', '<1905-06' …)
    if (y !== null) return y;
    const match = dateStr.match(/(\d{4})/);
    return match ? parseInt(match[1]) : null;
}

/**
 * Two dates match "exactly" when their known components agree, ignoring the
 * flex qualifier: '~1880-05-15' vs '1880-05-15' is the same day recorded with
 * different certainty (GEDCOM imports are full of ABT dates). Unparseable
 * values fall back to string equality.
 */
function datesMatch(date1: string | undefined, date2: string | undefined): boolean {
    if (!date1 || !date2) return false;
    const a = parseFlexDate(date1);
    const b = parseFlexDate(date2);
    if (!a || !b) return date1 === date2;
    return a.year === b.year && a.month === b.month && a.day === b.day;
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
type FirstNamesResult = { exact: boolean; firstWord: boolean; anyWord: boolean; prefix: boolean; matchedWord?: string };

function firstNamesMatch(name1: string, name2: string): FirstNamesResult {
    if (matchPass) return memo2(matchPass.firstNames, name1, name2, () => firstNamesMatchNow(name1, name2));
    return firstNamesMatchNow(name1, name2);
}

function firstNamesMatchNow(name1: string, name2: string): FirstNamesResult {
    const n1 = normalizeName(name1);
    const n2 = normalizeName(name2);

    // A missing name matches nothing
    if (!n1 || !n2) {
        return { exact: false, firstWord: false, anyWord: false, prefix: false };
    }

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

/** The written-name fields matching reads. */
type SurnameFields = { lastName: string; marriedSurname?: string; nameVariants?: string[] };

/**
 * What is actually written for this person: their surname, their surname
 * after marriage (another program may keep that one as THE surname) and
 * their own spellings.
 */
function writtenSurnames(person: SurnameFields): string[] {
    return [person.lastName, person.marriedSurname ?? '', ...(person.nameVariants ?? [])].filter(Boolean);
}

/** The surname fields bestLastNameMatch reads, as one key. */
function surnameSignature(person: SurnameFields): string {
    const cache = matchPass?.signatures;
    let key = cache?.get(person);
    if (key === undefined) {
        key = JSON.stringify([person.lastName, person.marriedSurname ?? null, person.nameVariants ?? null]);
        cache?.set(person, key);
    }
    return key;
}

/** The best match across every written form of both names. */
function bestLastNameMatch(
    existing: SurnameFields,
    incoming: SurnameFields,
    existingData?: StromData,
    incomingData?: StromData,
): LastNameResult {
    if (!matchPass || !existingData || !incomingData) return bestLastNameMatchNow(existing, incoming, existingData, incomingData);
    let byIncomingData = matchPass.bestLastNames.get(existingData);
    if (!byIncomingData) matchPass.bestLastNames.set(existingData, byIncomingData = new Map());
    let table = byIncomingData.get(incomingData);
    if (!table) byIncomingData.set(incomingData, table = new Map());
    return memo2(table, surnameSignature(existing), surnameSignature(incoming),
        () => bestLastNameMatchNow(existing, incoming, existingData, incomingData));
}

function bestLastNameMatchNow(
    existing: SurnameFields,
    incoming: SurnameFields,
    existingData?: StromData,
    incomingData?: StromData,
): LastNameResult {
    // A rule (Fíšek/Fíšková) or a group the user entered is not a similarity
    // question — it is an answer, so it does not go near the fuzzy comparison.
    // Both the birth surname and the one after marriage are asked.
    const surnames = (p: SurnameFields): string[] => [p.lastName, p.marriedSurname ?? ''].filter(Boolean);
    const rulesSay = (data?: StromData): boolean =>
        !!data && (sameSurnameIn(existing.lastName, incoming.lastName, data)
            || surnames(existing).some(a => surnames(incoming).some(b => sameSurnameIn(a, b, data))));
    if (rulesSay(existingData) || rulesSay(incomingData)) {
        return { exact: true, similar: true, similarity: 1.0 };
    }

    // Otherwise compare what is WRITTEN — never the generated forms. Every Czech
    // surname has an -ová form and they all rhyme: feeding those to the fuzzy
    // matcher made Fíšková/Svobodová look 0.33 alike where Fíšek/Svoboda are
    // 0, which was enough to push two unrelated families over the threshold.
    let best = lastNamesSimilar(existing.lastName, incoming.lastName);
    for (const a of writtenSurnames(existing)) {
        for (const b of writtenSurnames(incoming)) {
            const match = lastNamesSimilar(a, b);
            if (match.similarity > best.similarity || (match.exact && !best.exact)) best = match;
        }
    }
    return best;
}

/**
 * Check if last names are similar (handles typos and spelling variations)
 */
type LastNameResult = { exact: boolean; similar: boolean; similarity: number };

function lastNamesSimilar(name1: string, name2: string): LastNameResult {
    if (matchPass) return memo2(matchPass.lastNames, name1, name2, () => lastNamesSimilarNow(name1, name2));
    return lastNamesSimilarNow(name1, name2);
}

function lastNamesSimilarNow(name1: string, name2: string): LastNameResult {
    const n1 = normalizeName(name1);
    const n2 = normalizeName(name2);

    // A missing surname is unknown, not equal to another missing one
    if (!n1 || !n2) {
        return { exact: false, similar: false, similarity: 0 };
    }

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
}

/** A pair's score; `cap` bounds it with any bonus added later (only offered, never auto-confirmed). */
interface ScoreResult {
    score: number;
    reasons: MatchReason[];
    cap?: number;
    /** A shared strong id the names, sex and birth years agree with: the same person. */
    idConfirmed?: boolean;
}

/** A strong id both files give the person (`_UID`, `_FSFTID`…) that the rest agrees with: the same person. */
const ID_MATCH_SCORE = 100;
/** A shared strong id the rest does not agree with: at least a candidate to look at, nothing more. */
const ID_CANDIDATE_SCORE = 60;
/** The most two birth (else baptism) years may differ for a shared strong id to confirm a match. */
const ID_MAX_YEAR_GAP = 3;
/** The same xref or RIN in files of one program: a contribution to a name match. */
const WEAK_ID_BONUS = 25;

/** The highest score of a match that is only offered (below the auto-confirm bar). */
function offerOnlyCap(): number {
    return AUTO_CONFIRM_SCORE - 1;
}

/** The year a person was born, else baptized; null when neither is known. */
function birthOrBaptismYear(person: Person): number | null {
    const born = yearOf(person.birthDate);
    if (born !== null) return born;
    const baptism = person.events?.find(e => e.type === 'baptism' && e.date);
    return baptism ? yearOf(baptism.date) : null;
}

/** A shared strong id that is only a hint: offered with its reason, below the auto-confirm bar. */
function idCandidate(score: number, reasons: MatchReason[]): ScoreResult {
    const cap = offerOnlyCap();
    const out: MatchReason[] = reasons.includes('id') ? [...reasons] : ['id', ...reasons];
    return { score: Math.min(Math.max(score, ID_CANDIDATE_SCORE), cap), reasons: out, cap };
}

/** A base score plus a relationship bonus, within 100 and the base's cap. */
function withBonus(base: ScoreResult, bonus: number): number {
    return Math.min(base.score + bonus, base.cap ?? 100);
}

/**
 * Find matches between incoming persons and existing persons
 * Uses multiple strategies for smart matching
 */
export function findMatches(
    existingData: StromData,
    incomingData: StromData
): PersonMatch[] {
    return inMatchPass([existingData, incomingData], () => findMatchesInPass(existingData, incomingData));
}

function findMatchesInPass(
    existingData: StromData,
    incomingData: StromData
): PersonMatch[] {
    const matches: PersonMatch[] = [];
    const usedExisting = new Set<PersonId>();
    const usedIncoming = new Set<PersonId>();

    // Phase 1: Find direct matches (high confidence first)
    const directMatches = findDirectMatches(existingData, incomingData, usedExisting, usedIncoming);
    matches.push(...directMatches);

    // Phase 2: Propagate from confirmed matches (partner/family suggestions).
    // Runs to a FIXPOINT: a freshly propagated match seeds the next round, so
    // a chain grandparent->parent->child resolves even when only the first
    // link matched directly. Bounded by persons count (each round must claim
    // at least one new incoming person via usedIncoming).
    let seeds = matches;
    const maxRounds = Object.keys(incomingData.persons).length;
    for (let round = 0; round < maxRounds; round++) {
        const propagatedMatches = propagateFromMatches(
            existingData, incomingData, seeds, usedExisting, usedIncoming
        );
        if (propagatedMatches.length === 0) break;
        matches.push(...propagatedMatches);
        seeds = propagatedMatches;
    }

    // Phase 2b: persons whose given name is unknown ('?' or empty) have no
    // name to match by. One is proposed through a matched relative instead —
    // always for review, and it seeds only further persons of unknown name.
    const unknownBlocked = new Set<PersonId>();
    let unknownSeeds = matches;
    for (let round = 0; round < maxRounds; round++) {
        const found = matchUnknownNamedRelatives(
            existingData, incomingData, unknownSeeds, usedExisting, usedIncoming, unknownBlocked, matches
        );
        if (found.length === 0) break;
        matches.push(...found);
        unknownSeeds = found;
    }

    // Phase 2c: the "?" a file's family of one named parent got for the other
    // parent pairs with the "?" of that very family record in the tree.
    matches.push(...matchFamilyRecordStandIns(existingData, incomingData, matches, usedExisting, usedIncoming));

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
 * A family record of a file names one parent; the import stands a "?" in for
 * the other (no ids: the file has no record of it). Merging the same file
 * again, that "?" is the "?" the tree has in the same family record (same
 * program, same xref) of the person the named parent merged into.
 */
function matchFamilyRecordStandIns(
    existingData: StromData,
    incomingData: StromData,
    matches: readonly PersonMatch[],
    usedExisting: Set<PersonId>,
    usedIncoming: Set<PersonId>
): PersonMatch[] {
    const target = new Map<PersonId, PersonId>();
    for (const m of matches) if (m.score >= AUTO_CONFIRM_SCORE) target.set(m.incomingId, m.existingId);
    const standIn = (p: Person | undefined): p is Person => !!p?.isPlaceholder && !p.originalIds?.length;
    const found: PersonMatch[] = [];
    for (const incomingUnion of Object.values(incomingData.partnerships)) {
        if (!incomingUnion.originalIds?.length) continue;
        for (const [named, other] of [[incomingUnion.person1Id, incomingUnion.person2Id], [incomingUnion.person2Id, incomingUnion.person1Id]]) {
            const incoming = incomingData.persons[other];
            const existingNamed = target.get(named);
            if (!existingNamed || !standIn(incoming) || usedIncoming.has(incoming.id)) continue;
            const existingUnion = (existingData.persons[existingNamed]?.partnerships ?? [])
                .map(id => existingData.partnerships[id])
                .find(u => !!u && sameFileRecord(u, incomingUnion, existingData, incomingData));
            if (!existingUnion) continue;
            const existingOther = existingUnion.person1Id === existingNamed ? existingUnion.person2Id : existingUnion.person1Id;
            const existing = existingData.persons[existingOther];
            if (!standIn(existing) || usedExisting.has(existing.id) || !gendersCompatible(existing.gender, incoming.gender)) continue;
            found.push({
                existingId: existing.id,
                incomingId: incoming.id,
                confidence: scoreToConfidence(ID_MATCH_SCORE),
                reasons: ['id'],
                score: ID_MATCH_SCORE,
                existingPerson: existing,
                incomingPerson: incoming,
                conflicts: detectConflicts(existing, incoming)
            });
            usedExisting.add(existing.id);
            usedIncoming.add(incoming.id);
        }
    }
    return found;
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

    // A strong id both files give a person decides first: a name match of
    // another incoming person must not take the existing person it names.
    // A nameless record of the file (a MyHeritage spouse known by its ids alone,
    // read as a "?") pairs only with such a record of the same id: the same
    // file merged again, its couples then are the same couples (P-c, spec 066).
    // Only the tree's persons sharing a strong id with the record can pass the
    // id check below: the index finds them, in the tree's order.
    const existingPersons = Object.values(existingData.persons);
    const incomingPersons = Object.values(incomingData.persons);
    const idIndex = strongIdIndex(existingPersons, existingData);
    for (const incoming of incomingPersons) {
        if (!incoming.originalIds?.length) continue;
        if (usedIncoming.has(incoming.id)) continue;
        for (const at of idIndex.sharing(incoming, incomingData)) {
            const existing = existingPersons[at];
            if (!!existing.isPlaceholder !== !!incoming.isPlaceholder || usedExisting.has(existing.id)) continue;
            if (!gendersCompatible(existing.gender, incoming.gender)) continue;
            if (!idEvidence(existing, incoming, existingData, incomingData).same) continue;
            // (No name to compare for a nameless one: its strong id is all the file says of it.)
            if (!incoming.isPlaceholder && !calculateMatchScore(existing, incoming, existingData, incomingData).idConfirmed) continue;
            matches.push({
                existingId: existing.id,
                incomingId: incoming.id,
                confidence: scoreToConfidence(ID_MATCH_SCORE),
                reasons: ['id'],
                score: ID_MATCH_SCORE,
                existingPerson: existing,
                incomingPerson: incoming,
                conflicts: detectConflicts(existing, incoming)
            });
            usedExisting.add(existing.id);
            usedIncoming.add(incoming.id);
            break;
        }
    }

    // Process each incoming person
    for (const incoming of incomingPersons) {
        if (incoming.isPlaceholder) continue;
        if (usedIncoming.has(incoming.id)) continue;

        const candidates: MatchCandidate[] = [];

        // Find potential candidates
        for (const existing of existingPersons) {
            if (existing.isPlaceholder) continue;
            if (usedExisting.has(existing.id)) continue;

            const result = calculateMatchScore(existing, incoming, existingData, incomingData);

            if (result.score >= 35) { // Lower threshold to catch more candidates
                candidates.push({
                    existingId: existing.id,
                    score: result.score,
                    reasons: result.reasons
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
                const totalScore = withBonus(baseResult, partnerBonus);

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
                const totalScore = withBonus(baseResult, childBonus);

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
                if (!gendersCompatible(existingParent.gender, incomingParent.gender)) continue;

                const baseResult = calculateMatchScore(
                    existingParent, incomingParent, existingData, incomingData
                );

                // Add bonus for being parent of matched person
                const parentBonus = 15;
                const totalScore = withBonus(baseResult, parentBonus);

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

/** A person whose given name is unknown: '?', empty or punctuation only. */
function hasUnknownGivenName(person: Person): boolean {
    return normalizeName(person.firstName) === '';
}

/**
 * Two records the file knows by the surname alone (a MyHeritage spouse
 * written `/Novák/`): their names agree as far as they go, so a strong id
 * they share can confirm them (the same file merged again).
 */
function sameSurnameOnly(existing: Person, incoming: Person, surnameSimilarity: number): boolean {
    return hasUnknownGivenName(existing) && hasUnknownGivenName(incoming)
        && normalizeName(existing.lastName) !== '' && surnameSimilarity >= 0.95;
}

/**
 * The score of a match found through a relative of a person of unknown given
 * name: below the auto-confirm bar, so the wizard always asks for a look, and
 * below the 50 a name match with its context usually reaches, so it sorts
 * after those.
 */
const UNKNOWN_NAME_MATCH_SCORE = 45;

/** The relations a person of unknown given name is paired through. */
const UNKNOWN_NAME_RELATIONS: Array<{
    relatives: (person: Person, data: StromData) => Person[];
    reason: MatchReason;
}> = [
    { relatives: getPartners, reason: 'partner_of_matched' },
    { relatives: getChildren, reason: 'child_of_matched' },
    { relatives: getParents, reason: 'parent_of_matched' },
];

/**
 * Phase 2b: a person of unknown given name ("1 NAME /Nováková/" — MyHeritage
 * writes a wife known only by her surname this way) is the person in the tree
 * who stands in the same relation (partner, child or parent) to the matched
 * counterpart of a matched relative, when there is exactly one such person in
 * the tree of the same sex and surname (birth or after marriage) with an
 * unknown given name, no conflicting dates, and exactly one such person on the
 * incoming side too. Anything ambiguous on any path, or a tree person already
 * taken, leaves the person unmatched (`blocked` remembers that across rounds).
 *
 * Siblings nothing tells apart (`1 NAME /Legge/` four times in one family,
 * nothing else): as many in the tree as in the file, each of them the same
 * as each on the other side, pair by their place among the parent's children
 * when their matched parents are the same (the same file merged again, or
 * one more of its program). Without that, they stay unmatched.
 *
 * Such a match is always 'medium' with a score below AUTO_CONFIRM_SCORE: a
 * surname alone never confirms itself. Every match found by name or by
 * propagation is a seed, an uncertain one too: what comes of it is for review
 * just like the seed (the relaxed phase 3 runs later and seeds nothing). A
 * match found here seeds only this phase again, never the name-based
 * propagation.
 */
function matchUnknownNamedRelatives(
    existingData: StromData,
    incomingData: StromData,
    seeds: PersonMatch[],
    usedExisting: Set<PersonId>,
    usedIncoming: Set<PersonId>,
    blocked: Set<PersonId>,
    matched: readonly PersonMatch[] = seeds
): PersonMatch[] {
    const proposals = new Map<PersonId, { existing: Person; incoming: Person; reason: MatchReason }>();
    const matchedTo = new Map<PersonId, PersonId>(matched.map(m => [m.incomingId, m.existingId] as const));
    /** The incoming child's parents (but a "?") are the existing child's, through the matches so far. */
    const sameParents = (existing: Person, incoming: Person): boolean => {
        const named = (ids: readonly PersonId[], data: StromData): PersonId[] =>
            ids.filter(id => !!data.persons[id] && !data.persons[id].isPlaceholder);
        const theirs = named(existing.parentIds, existingData);
        const ours = named(incoming.parentIds, incomingData);
        return ours.length > 0 && ours.length === theirs.length && ours.every(id => theirs.includes(matchedTo.get(id) as PersonId));
    };
    /**
     * The existing sibling an incoming one is by place among the parent's children, when
     * `candidates` (≥ 2) and the incoming ones like them are as many, none told apart.
     */
    const byPlace = (incoming: Person, candidates: Person[], incomingRelatives: Person[]): Person | undefined => {
        if (candidates.length < 2) return undefined;
        const twins = incomingRelatives.filter(i => samePerson(candidates[0], i));
        if (twins.length !== candidates.length || !twins.includes(incoming)) return undefined;
        if (!twins.every(t => candidates.every(c => samePerson(c, t)))) return undefined;
        if (!twins.every((t, k) => sameParents(candidates[k], t))) return undefined;
        return candidates[twins.indexOf(incoming)];
    };

    const samePerson = (existing: Person, incoming: Person): boolean =>
        existing.gender === incoming.gender
        && bestLastNameMatch(existing, incoming, existingData, incomingData).exact
        && compareEventDates(existing.birthDate, incoming.birthDate) !== 'conflict'
        && compareEventDates(existing.deathDate, incoming.deathDate) !== 'conflict';
    const unknownNamed = (people: Person[]): Person[] =>
        people.filter(p => !p.isPlaceholder && hasUnknownGivenName(p));

    for (const seed of seeds) {
        for (const relation of UNKNOWN_NAME_RELATIONS) {
            const incomingRelatives = unknownNamed(relation.relatives(seed.incomingPerson, incomingData));
            if (incomingRelatives.length === 0) continue;
            const existingRelatives = unknownNamed(relation.relatives(seed.existingPerson, existingData));

            for (const incoming of incomingRelatives) {
                if (usedIncoming.has(incoming.id) || blocked.has(incoming.id)) continue;
                const candidates = existingRelatives.filter(e => samePerson(e, incoming));
                const placed = relation.reason === 'child_of_matched' ? byPlace(incoming, candidates, incomingRelatives) : undefined;
                const existing = placed ?? (candidates.length === 1 ? candidates[0] : undefined);
                const earlier = proposals.get(incoming.id);
                if (!existing
                    || usedExisting.has(existing.id)
                    || (!placed && incomingRelatives.filter(i => samePerson(existing, i)).length !== 1)
                    || (earlier && earlier.existing.id !== existing.id)) {
                    blocked.add(incoming.id);
                    proposals.delete(incoming.id);
                    continue;
                }
                if (!earlier) proposals.set(incoming.id, { existing, incoming, reason: relation.reason });
            }
        }
    }

    // One tree person proposed for two incoming persons: neither is certain.
    const proposedFor = new Map<PersonId, number>();
    for (const { existing } of proposals.values()) {
        proposedFor.set(existing.id, (proposedFor.get(existing.id) ?? 0) + 1);
    }

    const found: PersonMatch[] = [];
    for (const { existing, incoming, reason } of proposals.values()) {
        if (proposedFor.get(existing.id)! > 1) {
            blocked.add(incoming.id);
            continue;
        }
        found.push({
            existingId: existing.id,
            incomingId: incoming.id,
            confidence: 'medium',
            reasons: ['unknown_name_relative', reason],
            score: UNKNOWN_NAME_MATCH_SCORE,
            existingPerson: existing,
            incomingPerson: incoming,
            conflicts: detectConflicts(existing, incoming)
        });
        usedExisting.add(existing.id);
        usedIncoming.add(incoming.id);
    }
    return found;
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
    const existingPersons = Object.values(existingData.persons);

    for (const incoming of Object.values(incomingData.persons)) {
        if (incoming.isPlaceholder) continue;
        if (usedIncoming.has(incoming.id)) continue;

        const candidates: MatchCandidate[] = [];

        for (const existing of existingPersons) {
            if (existing.isPlaceholder) continue;
            if (usedExisting.has(existing.id)) continue;

            // Try relaxed matching
            const result = calculateRelaxedMatchScore(existing, incoming);

            if (result.score >= 25) {
                candidates.push({
                    existingId: existing.id,
                    score: result.score,
                    reasons: result.reasons
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
): ScoreResult {
    let score = 0;
    const reasons: MatchReason[] = [];

    // The ids the loaded files gave both records. A shared strong id is the
    // same person only when the names are alike, the sex is not a man and a
    // woman, the birth years (when both are known) are at most 3 apart and
    // no global id (_FSFTID, AFN, EXID) differs; otherwise it is a candidate
    // to look at. A global id that differs keeps a name match below the
    // auto-confirm bar.
    const ids = idEvidence(existing, incoming, existingData, incomingData);

    // Gender must match
    if (!gendersCompatible(existing.gender, incoming.gender)) {
        return ids.same ? idCandidate(0, []) : { score: 0, reasons: [] };
    }

    // Analyze first names (handles middle names, multi-part names)
    const firstNameMatch = firstNamesMatch(existing.firstName, incoming.firstName);
    const firstNameSimilarity = stringSimilarity(existing.firstName, incoming.firstName);

    // Analyze last names (handles typos and spelling variations). Recorded name
    // variants count as this person's surname too: a family written Fischek in
    // one register and Fíšek in another is one family, and without this the
    // merge sees two — exactly when merging matters most.
    const lastNameMatch = bestLastNameMatch(existing, incoming, existingData, incomingData);

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
    } else if (!(ids.same && sameSurnameOnly(existing, incoming, lastNameMatch.similarity))) {
        // Names too different
        return ids.same ? idCandidate(0, []) : { score: 0, reasons: [] };
    }

    // Birth date matching
    if (datesMatch(existing.birthDate, incoming.birthDate)) {
        score += 35;
        // A (near-)exact full name plus an identical full birth date is as
        // certain as person matching gets — day-precision collisions between
        // different people with the same name are vanishingly rare. Promote
        // straight to the high-confidence band (name 40 + date 35 = 75 would
        // otherwise land in 'medium' and demand a manual look every time).
        if (fullNameSimilarity >= 0.95 && existing.birthDate!.length >= 10) {
            score = Math.max(score, 85);
        }
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

    // The same xref or RIN in files of one program: only on top of a name
    // match (the names passed above), never on its own.
    if (ids.weak) {
        score += WEAK_ID_BONUS;
        reasons.unshift('id');
    }

    // Ensure we have at least one reason
    if (score >= 30 && reasons.length === 0) {
        reasons.push('name_similarity_relationships');
    }

    if (ids.same) {
        const y1 = birthOrBaptismYear(existing);
        const y2 = birthOrBaptismYear(incoming);
        const yearsAgree = y1 === null || y2 === null || Math.abs(y1 - y2) <= ID_MAX_YEAR_GAP;
        if (yearsAgree && !ids.globalDiffers) return { score: ID_MATCH_SCORE, reasons: ['id'], idConfirmed: true };
        return idCandidate(score, reasons);
    }
    if (ids.globalDiffers) {
        const cap = offerOnlyCap();
        return { score: Math.min(score, cap), reasons, cap };
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
    if (!gendersCompatible(existing.gender, incoming.gender)) {
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
    const matchingParents = countMatchingParents(existing, incoming, existingData, incomingData, false);
    // Score based on matching parents
    if (matchingParents >= 2) return 18;
    if (matchingParents >= 1) return 10;
    return 0;
}

/**
 * How many parents of the two persons are the same people, compared by name
 * (the persons come from different data sets, so ids say nothing). With
 * `checkYears`, parents whose known birth years lie more than 5 years apart
 * are different people even when the names agree.
 */
function countMatchingParents(
    existing: Person,
    incoming: Person,
    existingData: StromData,
    incomingData: StromData,
    checkYears: boolean
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
            if (!gendersCompatible(existingParent.gender, incomingParent.gender)) continue;

            // Check if parents match by name
            const firstNameSim = stringSimilarity(existingParent.firstName, incomingParent.firstName);
            const lastNameSim = stringSimilarity(existingParent.lastName, incomingParent.lastName);

            // Accept if first name is similar (last name may differ for women)
            if (firstNameSim >= 0.85 && (lastNameSim >= 0.7 || firstNameSim >= 0.95)) {
                if (checkYears) {
                    const y1 = extractYear(existingParent.birthDate);
                    const y2 = extractYear(incomingParent.birthDate);
                    if (y1 !== null && y2 !== null && Math.abs(y1 - y2) > 5) continue;
                }
                matchingParents++;
                break;
            }
        }
    }

    return matchingParents;
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
            if (!gendersCompatible(existingPartner.gender, incomingPartner.gender)) continue;

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
/**
 * Suggest which side of a conflict is objectively MORE INFORMATIVE, so the
 * default resolution is not a blind keep-existing:
 * - dates: same year, but one side has more precision (day > month > year) or
 *   no ~/</> qualifier — prefer it; contradicting components stay for a human;
 * - names/places: one normalized value contains the other ("Praha" vs
 *   "Praha, Žižkov") — prefer the more complete one.
 * Anything genuinely contradictory keeps the existing value with no opinion.
 */
export function suggestResolution(
    field: keyof Person,
    existingValue: string,
    incomingValue: string
): { resolution: 'keep_existing' | 'use_incoming'; reason?: FieldConflict['suggestedReason'] } {
    if (field === 'birthDate' || field === 'deathDate') {
        const a = parseFlexDate(existingValue);
        const b = parseFlexDate(incomingValue);
        if (a && b && a.year === b.year) {
            const contradicts =
                (a.month !== undefined && b.month !== undefined && a.month !== b.month) ||
                (a.day !== undefined && b.day !== undefined && a.day !== b.day);
            if (!contradicts) {
                const rank = (d: NonNullable<ReturnType<typeof parseFlexDate>>) =>
                    (d.day !== undefined ? 3 : d.month !== undefined ? 2 : 1) * 2
                    + (d.qualifier === '' ? 1 : 0);
                if (rank(b) > rank(a)) return { resolution: 'use_incoming', reason: 'more_precise_date' };
                if (rank(a) > rank(b)) return { resolution: 'keep_existing', reason: 'more_precise_date' };
            }
        }
        return { resolution: 'keep_existing' };
    }
    if (field === 'gender') return { resolution: 'keep_existing' };   // never auto-flip
    if (field === 'photo') return { resolution: 'keep_existing' };    // two portraits — a human decides, no opinion

    const na = normalizeName(existingValue);
    const nb = normalizeName(incomingValue);
    if (na && nb && na !== nb) {
        if (nb.includes(na)) return { resolution: 'use_incoming', reason: 'more_complete' };
        if (na.includes(nb)) return { resolution: 'keep_existing', reason: 'more_complete' };
    }
    return { resolution: 'keep_existing' };
}

export function detectConflicts(existing: Person, incoming: Person): FieldConflict[] {
    const conflicts: FieldConflict[] = [];
    const fieldsToCheck: (keyof Person)[] = [
        'firstName',
        'lastName',
        'gender',
        'birthDate',
        'birthPlace',
        'deathDate',
        'deathPlace',
        // The surname after marriage: a gap is filled (mergePersonData), two
        // different ones are a choice like the birth surname, never a silent keep.
        'marriedSurname',
        // Two different portraits cannot both be kept on one person — offer the
        // choice instead of silently keeping one. The conflict dialog renders a
        // thumbnail for this field, never the data URL as text.
        'photo'
    ];

    for (const field of fieldsToCheck) {
        const existingValue = existing[field] as string | undefined;
        const incomingValue = incoming[field] as string | undefined;

        // Skip if both are empty
        if (!existingValue && !incomingValue) continue;
        // An unknown sex is no value: the known one fills it (mergePersonData), no conflict.
        if (field === 'gender' && (existingValue === 'unknown' || incomingValue === 'unknown')) continue;

        // Conflict if both have values and they differ
        if (existingValue && incomingValue && existingValue !== incomingValue) {
            const suggestion = suggestResolution(field, existingValue, incomingValue);
            conflicts.push({
                field,
                existingValue,
                incomingValue,
                resolution: suggestion.resolution,
                ...(suggestion.reason ? { suggestedReason: suggestion.reason } : {})
            });
        }
        // Not a conflict if only one has value (can be merged)
    }

    return conflicts;
}

// ==================== CROSS-TREE MATCHING ====================

/** What a quick (cross-tree) match was found by, in display order. */
export type QuickMatchReason = 'name' | 'birth' | 'death' | 'parents' | 'partner';

export interface QuickMatchResult {
    score: number;
    reasons: QuickMatchReason[];
}

const NO_QUICK_MATCH: QuickMatchResult = { score: 0, reasons: [] };

/** Years further apart than this on plain or "about" dates mean two people. */
const QUICK_MAX_YEAR_GAP = 5;

/**
 * How two recorded dates of one event compare:
 * - 'conflict': they cannot be the same event — both are plain dates known to
 *   the month and their known components differ (twin-named siblings born a
 *   year or a few months apart), or plain/"about" years lie more than
 *   QUICK_MAX_YEAR_GAP apart;
 * - 'day' / 'month' / 'year': they agree to that precision;
 * - 'near': the years differ by one (a recording slip or a sibling);
 * - 'none': nothing to say (a date missing, or years 2–5 apart, or
 *   before/after/range dates that cannot be compared).
 */
export function compareEventDates(
    d1: string | undefined,
    d2: string | undefined
): 'conflict' | 'day' | 'month' | 'year' | 'near' | 'none' {
    if (!d1 || !d2) return 'none';
    const a = parseFlexDate(d1);
    const b = parseFlexDate(d2);
    if (a && b && !a.end && !b.end) {
        const plain = a.qualifier === '' && b.qualifier === '';
        if (plain && a.month !== undefined && b.month !== undefined) {
            const sameDay = a.day === undefined || b.day === undefined || a.day === b.day;
            if (a.year !== b.year || a.month !== b.month || !sameDay) return 'conflict';
            return a.day !== undefined && b.day !== undefined ? 'day' : 'month';
        }
        const comparable = (a.qualifier === '' || a.qualifier === '~') && (b.qualifier === '' || b.qualifier === '~');
        if (comparable && Math.abs(a.year - b.year) > QUICK_MAX_YEAR_GAP) return 'conflict';
        if (a.year === b.year) {
            if (a.month !== undefined && a.month === b.month) {
                return a.day !== undefined && a.day === b.day ? 'day' : 'month';
            }
            return 'year';
        }
        return Math.abs(a.year - b.year) === 1 ? 'near' : 'none';
    }
    if (datesMatch(d1, d2)) return 'day';
    if (yearsMatch(d1, d2)) return 'year';
    return yearsClose(d1, d2, 1) ? 'near' : 'none';
}

/**
 * Both birth dates give a plain year (exact, to any precision; not "about",
 * before/after or a range) and the years differ.
 */
function birthYearsDiffer(d1: string | undefined, d2: string | undefined): boolean {
    const a = parseFlexDate(d1);
    const b = parseFlexDate(d2);
    if (!a || !b || a.end || b.end || a.qualifier !== '' || b.qualifier !== '') return false;
    return a.year !== b.year;
}

/**
 * Quick match for cross-tree comparison ("Also in" on a card): the persons
 * come from different trees, so relatives are compared by name, never by id.
 * Returns a score 0-100 (50+ = match) and what the match was found by.
 *
 * - The name is required and carries the base (45 for a near-identical name).
 * - Birth: the same day +40, month +30, year +25; a year apart +3 only, so a
 *   name and a neighbouring year alone never pass (two sisters of one name).
 *   Precise dates that disagree, or years far apart, rule the match out.
 * - Death: the same day +10, the same year/month +3; a disagreeing date rules
 *   the match out as for birth.
 * - Parents of the same names: one +10, both +18, but never when plain birth
 *   years differ (namesake siblings share parents); partners as in full
 *   merge, and a partner of the same name may outweigh a year apart.
 */
export function quickMatch(p1: Person, p2: Person, data1?: StromData, data2?: StromData): QuickMatchResult {
    // Gender must match
    if (!gendersCompatible(p1.gender, p2.gender)) return NO_QUICK_MATCH;

    // A name is required: two unnamed people share an empty string (similarity
    // 1.0) and would otherwise match on a coincidental birth year alone.
    if (!`${p1.firstName}${p1.lastName}`.trim() || !`${p2.firstName}${p2.lastName}`.trim()) return NO_QUICK_MATCH;

    const firstNameSim = stringSimilarity(p1.firstName, p2.firstName);
    // The same rule/group answer full matching uses (Fíšek/Fíšková is one
    // family), so cross-tree suggestions agree with the merge matcher.
    const rulesSay = (data?: StromData): boolean =>
        !!data && sameSurnameIn(p1.lastName, p2.lastName, data);
    const lastNameSim = rulesSay(data1) || rulesSay(data2)
        ? 1.0
        : stringSimilarity(p1.lastName, p2.lastName);
    const nameSim = (firstNameSim + lastNameSim) / 2;

    // Names too different - no match
    if (nameSim < QUICK_NAME_MIN) return NO_QUICK_MATCH;

    const birth = compareEventDates(p1.birthDate, p2.birthDate);
    const death = compareEventDates(p1.deathDate, p2.deathDate);
    if (birth === 'conflict' || death === 'conflict') return NO_QUICK_MATCH;

    const reasons: QuickMatchReason[] = ['name'];
    // Base score from name similarity
    let score = nameSim >= 0.9 ? 45 : nameSim >= 0.8 ? 35 : 25;

    const birthPoints = { day: 40, month: 30, year: 25, near: 3, none: 0 }[birth];
    score += birthPoints;
    if (birth === 'day' || birth === 'month' || birth === 'year') reasons.push('birth');

    if (death === 'day') score += 10;
    else if (death === 'month' || death === 'year') score += 3;
    if (death === 'day' || death === 'month' || death === 'year') reasons.push('death');

    if (data1 && data2) {
        // Namesake siblings share their parents (a child named after an
        // earlier one who died): the same parents never make up for plain
        // birth years that differ. The same partner still can.
        const parents = birthYearsDiffer(p1.birthDate, p2.birthDate)
            ? 0
            : countMatchingParents(p1, p2, data1, data2, true);
        if (parents > 0) {
            score += parents >= 2 ? 18 : 10;
            reasons.push('parents');
        }
        const partner = calculatePartnerMatchScore(p1, p2, data1, data2);
        if (partner > 0) {
            score += partner;
            reasons.push('partner');
        }
    }

    return { score: Math.min(score, 100), reasons };
}

/** The least name similarity ((first + last) / 2) quickMatch takes. */
const QUICK_NAME_MIN = 0.7;

/**
 * Whether two persons of these first names (both normalized, normalizeName)
 * can pass quickMatch's name test at all: even with the surnames the same
 * (similarity 1) the first names must carry the rest. Exact, never a guess:
 * the test is the very expression quickMatch computes, with the surname's
 * part at its most (floating-point addition is monotone, so a smaller part
 * never gives more), and the similarity (1 - distance / longer length)
 * falls as the edit distance grows, so it is the same as the distance
 * staying within the largest one that still passes — which a distance
 * computation may stop at as soon as it is exceeded. Lets cross-tree
 * matching skip whole groups of people by their first name.
 */
export function firstNameMayQuickMatch(normalizedA: string, normalizedB: string): boolean {
    if (matchPass) return memo2(matchPass.firstNameBound, normalizedA, normalizedB, () => firstNameMayQuickMatchNow(normalizedA, normalizedB));
    return firstNameMayQuickMatchNow(normalizedA, normalizedB);
}

function firstNameMayQuickMatchNow(normalizedA: string, normalizedB: string): boolean {
    const passes = (firstSim: number): boolean => (firstSim + 1.0) / 2 >= QUICK_NAME_MIN;
    // As normalizedSimilarity: no name is 0, the same name 1.
    if (normalizedA.length === 0 || normalizedB.length === 0) return passes(0);
    if (normalizedA === normalizedB) return passes(1);
    const maxLength = Math.max(normalizedA.length, normalizedB.length);
    // The largest distance whose similarity, computed as normalizedSimilarity does, still passes.
    let allowed = 0;
    while (allowed < maxLength && passes(1 - (allowed + 1) / maxLength)) allowed++;
    if (!passes(1 - allowed / maxLength)) return false;
    // The distance is at least the difference of the lengths.
    if (Math.abs(normalizedA.length - normalizedB.length) > allowed) return false;
    return levenshteinWithin(normalizedA, normalizedB, allowed);
}

/** Two rows of levenshteinWithin's matrix, kept between calls. */
let withinRows = new Int32Array(64);

/**
 * levenshteinDistance(a, b) <= limit, the same matrix row by row, stopping
 * once a whole row exceeds the limit (the distance is at least a row's least
 * value: every edit path crosses each row and no step costs less than 0).
 */
function levenshteinWithin(a: string, b: string, limit: number): boolean {
    const width = a.length + 1;
    if (withinRows.length < 2 * width) withinRows = new Int32Array(2 * width);
    const rows = withinRows;
    let previous = 0;
    let current = width;
    for (let j = 0; j < width; j++) rows[j] = j;
    for (let i = 1; i <= b.length; i++) {
        rows[current] = i;
        let least = i;
        const ch = b.charCodeAt(i - 1);
        for (let j = 1; j < width; j++) {
            const value = ch === a.charCodeAt(j - 1)
                ? rows[previous + j - 1]
                : Math.min(rows[previous + j - 1], rows[current + j - 1], rows[previous + j]) + 1;
            rows[current + j] = value;
            if (value < least) least = value;
        }
        if (least > limit) return false;
        const done = previous;
        previous = current;
        current = done;
    }
    return rows[previous + width - 1] <= limit;
}

/** The score part of quickMatch (0-100, threshold 50+ = match). */
export function quickMatchScore(p1: Person, p2: Person, data1?: StromData, data2?: StromData): number {
    return quickMatch(p1, p2, data1, data2).score;
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
        partnershipResolutions: new Map(),
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
    const conflictingUnions = new Set(detectPartnershipConflicts(state).map(c => c.incomingPartnershipId));
    let partnershipConflictsResolved = 0;
    for (const id of conflictingUnions) {
        if (state.partnershipResolutions?.has(id)) partnershipConflictsResolved++;
    }

    // How many incoming persons the user chose to skip (independent of updateOnly).
    let skipped = 0;
    for (const decision of state.decisions.values()) {
        if (decision.type === 'skip') skipped++;
    }

    // Truthful "will add N new persons" count. updateOnly adds nothing; per-match
    // skip and manual matches never add. An unmatched person with no decision is
    // added as new; a rejected match ("not the same person") is added as new.
    let willAdd = 0;
    if (!state.updateOnly) {
        for (const id of state.unmatchedIncoming) {
            const decision = state.decisions.get(id);
            // A rejected match lands here after reanalyzeMatches: still added.
            if (!decision || decision.type === 'reject') willAdd++;
        }
        for (const match of state.matches) {
            if (state.decisions.get(match.incomingId)?.type === 'reject') willAdd++;
        }
    }

    return {
        total: Object.keys(state.incomingData.persons).length,
        matched: state.matches.length,
        highConfidence,
        mediumConfidence,
        lowConfidence,
        unmatched: state.unmatchedIncoming.length,
        withConflicts,
        partnershipConflicts: conflictingUnions.size,
        partnershipConflictsResolved,
        willAdd,
        skipped
    };
}

/**
 * Update match decision
 */
export function updateMatchDecision(
    state: MergeState,
    incomingId: PersonId,
    decision: 'confirm' | 'reject' | 'skip' | { type: 'manual_match'; targetId: PersonId }
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
    // A rejected person ("not the same person") stays in unmatchedIncoming:
    // it is added as new, exactly like any other person without a match.
    state.unmatchedIncoming = Object.keys(state.incomingData.persons)
        .filter(id => !matchedIncoming.has(id as PersonId))
        .filter(id => !state.incomingData.persons[id as PersonId].isPlaceholder)
        .map(id => id as PersonId);
}

// ==================== DUPLICATE SUGGESTIONS ====================

/** A draft person being entered, matched against existing persons. */
export interface SimilarPersonDraft {
    firstName: string;
    lastName: string;
    gender: import('../types.js').Gender;
    birthDate?: string;
}

export interface SimilarPersonResult {
    person: Person;
    score: number;
}

/**
 * Minimum match score (0-100) for a person to be suggested as a possible
 * duplicate. Same threshold the merge engine uses to accept a candidate, so
 * suggestion and merge share one notion of "similar enough".
 */
export const SIMILAR_PERSON_THRESHOLD = 35;

/**
 * Find existing persons similar to a draft being entered (duplicate hint).
 * Reuses the merge scoring so there is a single source of truth. Returns
 * matches at/above SIMILAR_PERSON_THRESHOLD, highest score first.
 */
export function findSimilarPersons(
    data: StromData,
    draft: SimilarPersonDraft,
    excludeId?: PersonId
): SimilarPersonResult[] {
    if (!draft.firstName.trim() && !draft.lastName.trim()) return [];

    // Synthetic person so we can reuse calculateMatchScore unchanged.
    const incoming: Person = {
        id: '__draft__' as PersonId,
        firstName: draft.firstName,
        lastName: draft.lastName,
        gender: draft.gender,
        isPlaceholder: false,
        partnerships: [],
        parentIds: [],
        childIds: [],
        ...(draft.birthDate ? { birthDate: draft.birthDate } : {}),
    };

    const results: SimilarPersonResult[] = [];
    inMatchPass([data], () => {
        for (const person of Object.values(data.persons)) {
            if (person.id === excludeId || person.isPlaceholder) continue;
            const { score } = calculateMatchScore(person, incoming, data, data);
            if (score >= SIMILAR_PERSON_THRESHOLD) results.push({ person, score });
        }
    });
    results.sort((a, b) => b.score - a.score);
    return results;
}
