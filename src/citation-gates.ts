/**
 * What a tree may do with its citations (spec 095 hlavní citace): marking a
 * main citation, removing a citation, and whose order its citations take.
 * A tree without a research decides by itself; a tree of a research by what
 * the research's bridge says it takes (`/status.features`), as it says it
 * now or said it last in this page — an older research does not take a main
 * citation, and the app does not offer one there.
 */

import { TreeId, ResearchLink } from './types.js';
import { TreeManager } from './tree-manager.js';
import { setCitationFileOrderLookup } from './citation-order.js';

/** The research keeps a fact's main citation (`_STROM_MAIN`) and takes it from the app. */
export const CITATIONS_MAIN_FEATURE = 'citations.main';
/** The research takes a citation removed in the app (it does not put it back on the next update). */
export const CITATIONS_REMOVE_FEATURE = 'citations.remove';
/** The research orders a fact's citations itself (the file's order is its order). */
export const CITATIONS_ORDER_FEATURE = 'citations.order';

/** The features a research's bridge says (now, else last in this page); null: not known. */
export type ResearchFeaturesLookup = (researchId: string) => readonly string[] | null | undefined;

let featuresOf: ResearchFeaturesLookup = () => null;

/** Set by the research UI (research-sync-ui.ts) where the bridges' statuses are kept. */
export function setCitationFeaturesLookup(lookup: ResearchFeaturesLookup): void {
    featuresOf = lookup;
}

function linkOf(treeId: TreeId | null | undefined): ResearchLink | undefined {
    return treeId ? TreeManager.getTreeMetadata(treeId)?.research : undefined;
}

/** Whether the research of a link takes a feature (a link's research not asked yet: no). */
export function researchTakes(link: ResearchLink | undefined, feature: string, lookup: ResearchFeaturesLookup = featuresOf): boolean {
    if (!link?.id) return false;
    return !!lookup(link.id)?.includes(feature);
}

/** A main citation may be marked: the tree has no research, or its research keeps one. */
export function citationMainOffered(treeId: TreeId | null | undefined): boolean {
    const link = linkOf(treeId);
    return !link || researchTakes(link, CITATIONS_MAIN_FEATURE);
}

/** The tree's research takes a citation removed in the app (a tree without a research: nothing to take it). */
export function citationRemoveTaken(treeId: TreeId | null | undefined): boolean {
    return researchTakes(linkOf(treeId), CITATIONS_REMOVE_FEATURE);
}

/** The tree's citations keep the file's order (its research orders them): only the main citation goes first. */
export function citationFileOrder(treeId: TreeId | null | undefined): boolean {
    return researchTakes(linkOf(treeId), CITATIONS_ORDER_FEATURE);
}

/** The tree shown: a main citation may be marked there, so a marked one is shown with its ★ (spec 095 R6). */
export function citationMainShown(): boolean {
    return citationMainOffered(TreeManager.getActiveTreeId());
}

// The pages and the bubbles order a fact's citations by the tree shown.
setCitationFileOrderLookup(() => citationFileOrder(TreeManager.getActiveTreeId()));

/** How a fact's citations go to a research (GedcomExportOptions citationMain / citationFileOrder). */
export interface ResearchCitationsOut {
    citationMain: boolean;
    citationFileOrder: boolean;
}

/** A research that has said nothing: neither the main citation nor the list's order. */
export const NO_CITATION_FEATURES: ResearchCitationsOut = { citationMain: false, citationFileOrder: false };

/**
 * How a tree's citations go in the file a research's bridge gets (its
 * `/status.features`, not reached: none): the main citation only to a
 * research that keeps it (an older one would read the mark as nothing and
 * the next load would lose it), the list's own order to one that orders
 * citations itself.
 */
export function researchCitationsOut(status: { features: readonly string[] | null } | null | undefined): ResearchCitationsOut {
    const features = status?.features ?? [];
    return { citationMain: features.includes(CITATIONS_MAIN_FEATURE), citationFileOrder: features.includes(CITATIONS_ORDER_FEATURE) };
}
