/**
 * Why the research's bridge did nothing with a request about facts (spec 065:
 * /verify, /verify/bulk, /verify/stop, /facts/confirm), said in the app's
 * language — never the bridge's own sentence.
 */

import { strings } from './strings.js';

/**
 * A refusal said in the app's words: nothing to verify, the research busy or
 * held by another session, else that it could not start. Never the bridge's
 * own sentence (`reason`, English and for the details only).
 */
export function verifyRefusalText(code: string): string {
    const v = strings.verify;
    if (code === 'verify.nothing') return v.nothing;
    if (code === 'busy') return v.busy;
    if (code === 'locked') return v.locked;
    return refusalReason(code) ?? v.failed;
}

/** What the research's refusal of a request about a fact says, in the app's words (null: no answer, or none known). */
function refusalReason(code: string): string | null {
    const v = strings.verify;
    if (code === 'verify.archive') return v.whyArchive;
    if (code === 'verify.retracted' || code === 'factconfirm.retracted') return v.whyRetracted;
    if (code === 'verify.unknown' || code === 'factconfirm.unknown') return v.whyGone;
    if (code === 'factconfirm.merged') return v.whyMerged;
    if (code === 'unsupported') return v.whyOld;
    if (code === 'verify.invalid' || code === 'factconfirm.invalid' || code === 'invalid' || code === 'unknown') return v.whyRefused;
    return null;
}

/** Why "Confirm against the scan" (or its undo) changed nothing in the research, in the app's language (never the bridge's own sentence). */
export function confirmRefusalText(code: string): string {
    const v = strings.verify;
    if (code === 'confirm.changed') return v.confirmChanged;
    if (code === 'busy') return v.confirmBusy;
    if (code === 'locked') return v.confirmLocked;
    return refusalReason(code) ?? v.confirmFailed;
}
