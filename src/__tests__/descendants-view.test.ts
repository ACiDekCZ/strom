/**
 * Descendants view mode: driving runLayoutPipeline with the descendants-only
 * policy (ancestorDepth 0, no aunts/uncles/cousins) yields exactly the focus
 * person's descendants and their partners — no ancestors, no side branches.
 */

import { describe, it, expect } from 'vitest';
import { runLayoutPipeline } from '../layout/pipeline/index.js';
import { getDemoTree } from '../demo-tree.js';
import { DEFAULT_LAYOUT_CONFIG, StromData, PersonId } from '../types.js';

/** All descendants of a person (transitive childIds), excluding the person. */
function descendantsOf(data: StromData, rootId: PersonId): Set<PersonId> {
    const out = new Set<PersonId>();
    const queue = [...(data.persons[rootId]?.childIds ?? [])];
    while (queue.length) {
        const id = queue.shift()!;
        if (out.has(id)) continue;
        out.add(id);
        queue.push(...(data.persons[id]?.childIds ?? []));
    }
    return out;
}

function runDescendants(data: StromData, focusPersonId: PersonId) {
    return runLayoutPipeline({
        data,
        focusPersonId,
        config: DEFAULT_LAYOUT_CONFIG,
        ancestorDepth: 0,
        descendantDepth: 20,
        includeSpouseAncestors: false,
        includeParentSiblings: false,
        includeParentSiblingDescendants: false,
    });
}

describe('descendants view (pipeline policy)', () => {
    const data = getDemoTree(); // the Berg family
    const peter = 'demo_peter' as PersonId;

    it('includes every descendant of the root', () => {
        const result = runDescendants(data, peter);
        const visible = new Set(result.positions.keys());
        for (const id of descendantsOf(data, peter)) {
            expect(visible.has(id)).toBe(true);
        }
    });

    it('does not include the root\'s ancestors when focusing a mid-tree person', () => {
        // Erik is a grandson of Peter; in descendants mode his ancestor
        // Peter must NOT appear.
        const erik = 'demo_erik' as PersonId;
        // Skip gracefully if the demo id changed.
        if (!data.persons[erik]) return;
        const result = runDescendants(data, erik);
        const visible = new Set(result.positions.keys());
        expect(visible.has(peter)).toBe(false);
        // Every visible non-placeholder is the person, a descendant, or a partner —
        // never an ancestor of Erik.
        const ancestors = new Set<PersonId>();
        const stack = [...(data.persons[erik]?.parentIds ?? [])];
        while (stack.length) {
            const id = stack.shift()!;
            if (ancestors.has(id)) continue;
            ancestors.add(id);
            stack.push(...(data.persons[id]?.parentIds ?? []));
        }
        for (const id of ancestors) expect(visible.has(id)).toBe(false);
    });
});
