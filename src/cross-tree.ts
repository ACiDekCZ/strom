/**
 * Cross-Tree Links Module
 * Detects matching persons across different trees and enables cross-tree navigation
 */

import { PersonId, Person, StromData, TreeId } from './types.js';
import { quickMatch, QuickMatchReason } from './merge/matching.js';
import { shownNameOrEmpty } from './person-name.js';
import { strings } from './strings.js';

// ==================== TYPES ====================

export interface CrossTreeMatch {
    treeId: TreeId;
    treeName: string;
    personId: PersonId;
    personName: string;
    confidence: number;  // 0-100
    /** What the match was found by (name, birth, parents …), shown in the "Also in" bubble. */
    reasons: QuickMatchReason[];
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
 * What matching needs of a tree: persons and partnerships, without the heavy
 * parts — photos, attachments, narratives and the source catalog with its
 * excerpts. The cache holds every visible tree; with image-rich trees full
 * copies cost hundreds of MB for data matching never reads.
 */
function leanForMatching(data: import('./types.js').StromData): import('./types.js').StromData {
    const persons: import('./types.js').StromData['persons'] = {};
    for (const [id, p] of Object.entries(data.persons ?? {})) {
        const { photo, photoOriginalName, attachments, story, ...rest } = p;
        persons[id as keyof typeof persons] = rest;
    }
    return { persons, partnerships: data.partnerships ?? {} };
}

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

            const { score, reasons } = quickMatch(person, otherPerson, currentData, tree.data);

            if (score >= MATCH_THRESHOLD) {
                const personName = shownNameOrEmpty(otherPerson);
                const birthYear = otherPerson.birthDate?.split('-')[0];

                matches.push({
                    treeId,
                    treeName: tree.name,
                    personId: otherPerson.id,
                    personName: birthYear ? `${personName} (*${birthYear})` : personName,
                    confidence: score,
                    reasons
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

/** The short "Matched by: name, birth, parents" line for the "Also in" bubble and the chooser. */
export function matchReasonsText(match: CrossTreeMatch): string {
    const labels = strings.crossTree.matchReasons;
    return strings.crossTree.matchedBy(match.reasons.map(r => labels[r]).join(', '));
}

/**
 * Get count of the other trees a person is found in (for badge display):
 * trees, not matches (one tree may hold the same person twice).
 */
export function getMatchCount(
    currentTreeId: TreeId,
    person: Person,
    allTrees: Map<TreeId, { name: string; data: StromData }>
): number {
    return crossTreeCount(findCrossTreeMatches(currentTreeId, person, allTrees));
}

/** The matches of one other tree, in the order they were found. */
export interface CrossTreeGroup {
    treeId: TreeId;
    treeName: string;
    matches: CrossTreeMatch[];
}

/**
 * The matches by tree: the tree's name once, its people under it (another
 * tree may hold the same person twice, e.g. under the married and the birth
 * name). The order of the trees is the order of their first match.
 */
export function groupCrossTreeMatches(matches: readonly CrossTreeMatch[]): CrossTreeGroup[] {
    const groups = new Map<TreeId, CrossTreeGroup>();
    for (const m of matches) {
        const g = groups.get(m.treeId);
        if (g) g.matches.push(m);
        else groups.set(m.treeId, { treeId: m.treeId, treeName: m.treeName, matches: [m] });
    }
    return [...groups.values()];
}

/** How many other trees the matches come from (the number on the ⇄ pill). */
export function crossTreeCount(matches: readonly CrossTreeMatch[]): number {
    return new Set(matches.map(m => m.treeId)).size;
}

/** The trees shown in the ⇄ bubble before "… N more". */
const BUBBLE_TREES = 5;

/**
 * The ⇄ pill's bubble: "Found in N other trees", then per tree its name
 * once, its people with what they were matched by, and for a tree with more
 * of them "In the tree X 2 matches – perhaps one person twice".
 */
export function crossTreeBubbleHtml(matches: readonly CrossTreeMatch[], esc: (s: string) => string): string {
    const groups = groupCrossTreeMatches(matches);
    const items = groups.slice(0, BUBBLE_TREES).map(g =>
        `<div class="cross-tree-tooltip-item">
            <div class="cross-tree-tooltip-tree">${esc(g.treeName)}</div>
            ${g.matches.map(m => `<div class="cross-tree-tooltip-person">${esc(m.personName)}</div>
            <div class="cross-tree-tooltip-reason">${esc(matchReasonsText(m))}</div>`).join('')}
            ${g.matches.length > 1 ? `<div class="cross-tree-tooltip-twice">${esc(strings.crossTree.sameTreeTwice(g.treeName, g.matches.length))}</div>` : ''}
        </div>`).join('');
    const more = groups.length > BUBBLE_TREES ? groups.length - BUBBLE_TREES : 0;
    return `<div class="cross-tree-tooltip-header">${esc(strings.crossTree.badgeTitle(groups.length))}</div>
        ${items}
        ${more > 0 ? `<div class="cross-tree-tooltip-item">${esc(strings.crossTree.moreMatches(more))}</div>` : ''}`;
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
        const full = await treeManager.getTreeData(meta.id);
        if (!full) continue;
        const data = leanForMatching(full);
        treeDataCache.set(meta.id, { stamp: meta.lastModifiedAt, name: meta.name, data });
        result.set(meta.id, { name: meta.name, data });
    }
    return result;
}
