/**
 * A conflict's value as the research's batch can leave it: the label of the
 * batch's source still in front of the claim ("@s: 59 years at death 1883",
 * GEDCOM "2 VAL @@s:59 …"), with no source attached. The label names nothing
 * the app knows (it lives only in the batch that wrote it), so it goes and the
 * claim is shown as said; its source stays "–" until the research sends one.
 */
const BATCH_LABEL = /^@{1,2}[\p{L}\p{N}_-]{1,40}@?\s*:\s*(?=\S)/u;

/** The claim without a batch label left in front of it (anything else stays as written). */
export function researchClaimValue(value: string): string {
    return value.replace(BATCH_LABEL, '');
}
