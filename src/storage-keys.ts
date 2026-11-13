/** Keys of records kept beside others in a store (src/storage.ts). */

/** The research base of a stored tree: in 'trees' beside it (one transaction with it), under this key. */
export function researchBaseKey(treeId: string): string {
    return `researchBase:${treeId}`;
}

/** The research's events of the time for a research tree (spec 020): in 'shareBaselines', keyed by the research's id. */
export function historyCacheKey(researchId: string): string {
    return `history:${researchId.toLowerCase()}`;
}

/** Hidings of those events waiting for the research's bridge: beside the cache. */
export function historyQueueKey(researchId: string): string {
    return `historyHide:${researchId.toLowerCase()}`;
}

/** A side record of the history layer (never a tree; an early beta kept them in 'trees'). */
export function isHistoryKey(key: string): boolean {
    return key.startsWith('history:') || key.startsWith('historyHide:');
}

/** What this device knows of a research's "not an error" marks (spec 021 §D): in 'shareBaselines', keyed by the research's id. */
export function qualityBridgeKey(researchId: string): string {
    return `quality:${researchId.toLowerCase()}`;
}

/** The research's last spelling suggestions on this device (spec 021 §4.2): in 'shareBaselines', keyed by the research's id. */
export function surnamesBridgeKey(researchId: string): string {
    return `surnames:${researchId.toLowerCase()}`;
}

/** Fan chart settings of this device (localStorage, spec 029 §0.5). */
export const FAN_STORAGE_KEYS = {
    /** Ancestor rings, 3–10 (older 4–8 values stay valid). */
    generations: 'strom-fan-generations',
    /** Descendant depth of the two-way fan, 1–5. */
    descGenerations: 'strom-fan-desc-generations',
    /** 'half' / 'full' / 'two'. */
    shape: 'strom-fan-shape',
    /** 'gender' / 'line' / 'rod'. */
    color: 'strom-fan-color',
    /** Legend card open: '1' / '0'. */
    legendOpen: 'strom-fan-legend-open',
} as const;

/** The tree view's folding of the minimap and the legend (localStorage, one choice for all trees on this device). */
export const TREE_UI_STORAGE_KEYS = {
    /** Minimap open: '1' / '0' (a phone held sideways without it: folded). */
    minimapOpen: 'strom-minimap-open',
    /** Tree legend open: '1' / '0' (a computer and a tablet; a phone never reads or writes it). */
    legendOpen: 'strom-tree-legend-open',
    /** JSON list of the legend's marks it has already shown open (the folded chip's dot names the others). */
    legendSeen: 'strom-tree-legend-seen',
} as const;

/** localStorage: the fingerprint the kept copy of the research's version stands for (written at once; the copy keeps its own). */
export const RESEARCH_COPY_FP_KEY = 'strom-research-base-fp:';
/** localStorage: the fingerprint of the kept copy before the last written send. */
export const RESEARCH_PREV_COPY_FP_KEY = 'strom-research-base-prev-fp:';
