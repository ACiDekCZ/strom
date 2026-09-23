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

/**
 * Tree-data cache for matching: loading (and possibly decrypting) EVERY
 * tree's full data on EVERY render was the single biggest render cost with
 * multiple trees open. Entries are keyed by the tree's lastModifiedAt, so a
 * save in any tree naturally refreshes just that entry.
 */
const treeDataCache = new Map<string, { stamp: string; name: string; data: import('./types.js').StromData }>();

/**
 * Invalidate entire cache
 * Call when any tree data changes
 */
export function invalidateCache(): void {
    matchCache.clear();
    treeDataCache.clear();
}

/**
 * Invalidate cache for a specific tree
 * Call when only that tree's data changes.
 *
 * Every cached result can be stale, not just this tree's own: a person added
 * or renamed here may now match someone in ANY other tree, and filtering this
 * tree out of the other trees' cached lists would drop valid matches instead
 * of adding new ones. So all match results go; only the other trees' loaded
 * data (keyed by their own lastModifiedAt) is kept.
 */
export function invalidateCacheForTree(treeId: TreeId): void {
    matchCache.clear();
    treeDataCache.delete(treeId);
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
    const currentData = allTrees.get(currentTreeId)?.data;

    // Search in all other trees
    for (const [treeId, tree] of allTrees.entries()) {
        // Skip current tree
        if (treeId === currentTreeId) continue;

        // Search persons in this tree
        for (const otherPerson of Object.values(tree.data.persons)) {
            // Skip placeholders
            if (otherPerson.isPlaceholder) continue;

            const score = quickMatchScore(person, otherPerson, currentData, tree.data);

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

/**
 * All visible trees' data for cross-tree matching, served from the cache
 * (refreshed per tree when its lastModifiedAt changes).
 */
export async function getTreesDataForMatching(
    treeManager: {
        getVisibleTrees(): Array<{ id: TreeId; name: string; lastModifiedAt: string }>;
        getTreeData(id: TreeId): Promise<import('./types.js').StromData | null>;
    }
): Promise<Map<TreeId, { name: string; data: import('./types.js').StromData }> | null> {
    const trees = treeManager.getVisibleTrees();
    if (trees.length < 2) return null;

    const result = new Map<TreeId, { name: string; data: import('./types.js').StromData }>();
    for (const meta of trees) {
        const cached = treeDataCache.get(meta.id);
        if (cached && cached.stamp === meta.lastModifiedAt) {
            result.set(meta.id, { name: cached.name, data: cached.data });
            continue;
        }
        const data = await treeManager.getTreeData(meta.id);
        if (!data) continue;
        treeDataCache.set(meta.id, { stamp: meta.lastModifiedAt, name: meta.name, data });
        result.set(meta.id, { name: meta.name, data });
    }
    return result;
}
