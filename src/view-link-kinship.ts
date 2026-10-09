/**
 * "Find relationship" with links "linked in the view only" on screen: the
 * calculator counts the tree's real links only. When those connect nothing
 * but the view's links would, it says so apart ("No real connection found."
 * + "View only: grandfather (H0022 B)") — never as if it were real. Pure.
 */

import { findRelationship, KinshipResult } from './kinship.js';
import { buildViewLayer } from './layout/pipeline/view-layer.js';
import type { PersonId, StromData } from './types.js';
import type { ViewLink } from './view-links.js';

export interface ViewOnlyRelationship {
    /** The relationship as the view shows it. */
    relation: KinshipResult;
    /** The view links its path goes through (in the order chosen). */
    via: ViewLink[];
}

/** One step of a path crosses a view link: anchor and one of its island people, either way. */
function crosses(link: ViewLink, a: PersonId, b: PersonId): boolean {
    return (a === link.anchorId && link.islandIds.includes(b)) || (b === link.anchorId && link.islandIds.includes(a));
}

/**
 * The relationship of `b` to `a` that only the view's links make: null when
 * the real links already connect them (that answer stands alone), when no
 * link is shown, or when even the view does not connect them.
 */
export function viewOnlyRelationship(data: StromData, links: readonly ViewLink[], a: PersonId, b: PersonId): ViewOnlyRelationship | null {
    if (links.length === 0 || findRelationship(data, a, b)) return null;
    const layer = buildViewLayer(data, links);
    if (!layer) return null;
    const relation = findRelationship(layer.data, a, b);
    if (!relation) return null;
    const via = links.filter(l => relation.path.some((id, i) => i + 1 < relation.path.length && crosses(l, id, relation.path[i + 1])));
    // A path through two shown parents' own family (siblings under them) touches no anchor step: name every link then.
    return { relation, via: via.length > 0 ? via : [...links] };
}
