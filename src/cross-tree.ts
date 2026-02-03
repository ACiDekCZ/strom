/**
 * Cross-Tree Links Module
 * Detects matching persons across different trees and enables cross-tree navigation
 */

import { PersonId, Person, StromData, TreeId } from './types.js';
import { quickMatchScore } from './merge/matching.js';

// ==================== TYPES ====================

export interface CrossTreeMatch {
    treeId: TreeId;
    treeName: string;
    personId: PersonId;
    personName: string;
    confidence: number;  // 0-100
}

// ==================== CACHE ====================

// In-memory cache: key = `${treeId}:${personId}`, value = matches in other trees
const matchCache = new Map<string, CrossTreeMatch[]>();

// Track current navigation index for cycling through matches
const navigationIndex = new Map<string, number>();

/**
 * Invalidate entire cache
 * Call when any tree data changes
 */
export function invalidateCache(): void {
    matchCache.clear();
    navigationIndex.clear();
}

/**
 * Invalidate cache for a specific tree
 * Call when only that tree's data changes
 */
export function invalidateCacheForTree(treeId: TreeId): void {
    // Remove all entries that involve this tree
    for (const key of matchCache.keys()) {
        if (key.startsWith(`${treeId}:`)) {
            matchCache.delete(key);
        }
    }
    // Also remove entries where this tree appears as a match target
    for (const [key, matches] of matchCache.entries()) {
        const filtered = matches.filter(m => m.treeId !== treeId);
        if (filtered.length !== matches.length) {
            if (filtered.length === 0) {
                matchCache.delete(key);
            } else {
                matchCache.set(key, filtered);
            }
        }
    }
    navigationIndex.clear();
}

// ==================== MAIN FUNCTIONS ====================

/**
 * Find cross-tree matches for a person
 * Returns list of matches in other trees (excluding current tree)
 */
export function findCrossTreeMatches(
    currentTreeId: TreeId,
    person: Person,
    allTrees: Map<TreeId, { name: string; data: StromData }>
): CrossTreeMatch[] {
    // Skip placeholders
    if (person.isPlaceholder) return [];

    // Check cache
    const cacheKey = `${currentTreeId}:${person.id}`;
    const cached = matchCache.get(cacheKey);
    if (cached !== undefined) {
        return cached;
    }

    const matches: CrossTreeMatch[] = [];
    const MATCH_THRESHOLD = 50;

    // Search in all other trees
    for (const [treeId, tree] of allTrees.entries()) {
        // Skip current tree
        if (treeId === currentTreeId) continue;

        // Search persons in this tree
        for (const otherPerson of Object.values(tree.data.persons)) {
            // Skip placeholders
            if (otherPerson.isPlaceholder) continue;

            const score = quickMatchScore(person, otherPerson);

            if (score >= MATCH_THRESHOLD) {
                const personName = `${otherPerson.firstName} ${otherPerson.lastName}`.trim();
                const birthYear = otherPerson.birthDate?.split('-')[0];

                matches.push({
                    treeId,
                    treeName: tree.name,
                    personId: otherPerson.id,
                    personName: birthYear ? `${personName} (*${birthYear})` : personName,
                    confidence: score
                });
            }
        }
    }

    // Sort by confidence (highest first)
    matches.sort((a, b) => b.confidence - a.confidence);

    // Cache result
    matchCache.set(cacheKey, matches);

    return matches;
}

/**
 * Get the next match in the cycle for navigation
 * Returns the match to navigate to, or null if no matches
 */
export function getNextMatch(
    currentTreeId: TreeId,
    personId: PersonId,
    matches: CrossTreeMatch[]
): CrossTreeMatch | null {
    if (matches.length === 0) return null;

    const navKey = `${currentTreeId}:${personId}`;
    const currentIndex = navigationIndex.get(navKey) ?? -1;
    const nextIndex = (currentIndex + 1) % matches.length;

    navigationIndex.set(navKey, nextIndex);

    return matches[nextIndex];
}

/**
 * Reset navigation index (call when switching trees)
 */
export function resetNavigationIndex(): void {
    navigationIndex.clear();
}

/**
 * Get count of matches for a person (for badge display)
 */
export function getMatchCount(
    currentTreeId: TreeId,
    person: Person,
    allTrees: Map<TreeId, { name: string; data: StromData }>
): number {
    const matches = findCrossTreeMatches(currentTreeId, person, allTrees);
    return matches.length;
}
