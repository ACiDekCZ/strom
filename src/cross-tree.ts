/**
 * Cross-Tree Links Module
 * Detects matching persons across different trees and enables cross-tree navigation
 */

import { PersonId, Person, StromData, TreeId } from './types.js';
import { quickMatch, QuickMatchReason, inMatchPass, normalizeName, firstNameMayQuickMatch } from './merge/matching.js';
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
 * What a card is matched against in one other tree, worked out once per
 * tree data (kept by tree id with the data it was made of, so a tree read
 * anew, or invalidated, gets a new one). A card used to run quickMatch on
 * every person of every other tree; quickMatch never passes two people whose
 * first names are too far apart (firstNameMayQuickMatch), so the people are
 * grouped by their normalized first name and only the groups a card's first
 * name may match are compared, in the tree's own order.
 */
interface TreeMatchIndex {
    /** The tree's people that are matched (no placeholders), in the tree's order. */
    persons: Person[];
    /** Normalized first name → the positions (in `persons`, ascending) of the people of that name. */
    groups: Map<string, number[]>;
    /** A card's normalized first name → the positions of the people it may match, ascending. */
    candidates: Map<string, number[]>;
}

const indexCache = new Map<TreeId, { data: StromData; index: TreeMatchIndex }>();

function matchIndexOf(treeId: TreeId, data: StromData): TreeMatchIndex {
    const cached = indexCache.get(treeId);
    if (cached && cached.data === data) return cached.index;
    const persons: Person[] = [];
    const groups = new Map<string, number[]>();
    for (const p of Object.values(data.persons)) {
        if (p.isPlaceholder) continue;
        const at = persons.length;
        persons.push(p);
        // No first name: never similar enough to pass (stringSimilarity of '' is 0).
        const first = normalizeName(p.firstName ?? '');
        if (!first) continue;
        const group = groups.get(first);
        if (group) group.push(at);
        else groups.set(first, [at]);
    }
    const index: TreeMatchIndex = { persons, groups, candidates: new Map() };
    indexCache.set(treeId, { data, index });
    return index;
}

/** The positions of the people a card of this (normalized) first name may match, ascending. */
function candidatesOf(index: TreeMatchIndex, first: string): number[] {
    let out = index.candidates.get(first);
    if (out) return out;
    out = [];
    let groups = 0;
    for (const [name, at] of index.groups) {
        if (!firstNameMayQuickMatch(first, name)) continue;
        for (const i of at) out.push(i);
        groups++;
    }
    // Several groups interleave: back to the tree's order.
    if (groups > 1) out.sort((a, b) => a - b);
    index.candidates.set(first, out);
    return out;
}

/**
 * Invalidate entire cache
 * Call when any tree data changes
 */
export function invalidateCache(): void {
    matchCache.clear();
    treeDataCache.clear();
    indexCache.clear();
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
    indexCache.delete(treeId);
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
    const cached = matchCache.get(`${currentTreeId}:${person.id}`);
    if (cached !== undefined) {
        return cached;
    }
    return inCrossTreePass(currentTreeId, allTrees, () => matchPerson(currentTreeId, person, allTrees));
}

/**
 * Work out (and cache) the matches of these persons in one matching pass:
 * the cards of a render ask one after another, and a pass per card would
 * work out every tree's surname rules again for each.
 */
export function prepareCrossTreeMatches(
    currentTreeId: TreeId,
    persons: Iterable<Person>,
    allTrees: Map<TreeId, { name: string; data: StromData }>
): void {
    const todo: Person[] = [];
    for (const p of persons) {
        if (!p.isPlaceholder && !matchCache.has(`${currentTreeId}:${p.id}`)) todo.push(p);
    }
    if (todo.length === 0) return;
    inCrossTreePass(currentTreeId, allTrees, () => {
        for (const p of todo) matchPerson(currentTreeId, p, allTrees);
    });
}

/** One matching pass over the current tree and every other tree (see inMatchPass). */
function inCrossTreePass<T>(currentTreeId: TreeId, allTrees: Map<TreeId, { name: string; data: StromData }>, fn: () => T): T {
    const current = allTrees.get(currentTreeId)?.data;
    const trees = [...(current ? [current] : []), ...[...allTrees].filter(([id]) => id !== currentTreeId).map(([, t]) => t.data)];
    return inMatchPass(trees, fn);
}

/** The matches of one person (not a placeholder), cached. */
function matchPerson(
    currentTreeId: TreeId,
    person: Person,
    allTrees: Map<TreeId, { name: string; data: StromData }>
): CrossTreeMatch[] {
    const matches: CrossTreeMatch[] = [];
    const MATCH_THRESHOLD = 50;
    const currentData = allTrees.get(currentTreeId)?.data;
    const first = normalizeName(person.firstName ?? '');

    // Search in all other trees (a person without a first name matches no one)
    for (const [treeId, tree] of first ? allTrees.entries() : []) {
        // Skip current tree
        if (treeId === currentTreeId) continue;

        // Only the people whose first name may match (placeholders are not in the index)
        const index = matchIndexOf(treeId, tree.data);
        for (const at of candidatesOf(index, first)) {
            const otherPerson = index.persons[at];
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
    matchCache.set(`${currentTreeId}:${person.id}`, matches);

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
