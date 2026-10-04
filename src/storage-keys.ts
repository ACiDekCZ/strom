/** Keys of records kept beside others in a store (src/storage.ts). */

/** The research base of a stored tree: in 'trees' beside it (one transaction with it), under this key. */
export function researchBaseKey(treeId: string): string {
    return `researchBase:${treeId}`;
}
