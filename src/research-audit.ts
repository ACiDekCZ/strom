/**
 * The audit of a waiting task (spec 109, K1.4–K1.6): what the research found
 * wrong in how the task's waiting is recorded (images written only as text,
 * several books in one task, a book the research does not know, a missing
 * folder for the images), as `/status waiting` says it at the item
 * (`audit: {kinds, fix, stamp}`, only from a research that announces
 * `tasks.audit`). The app shows the finding beside the item and offers to fix
 * it, to talk it over with the agent, or to leave it as it is; the research
 * decides and writes everything. Pure: no DOM, no bridge.
 */

/** The bridge feature that sends `audit` at waiting tasks and takes its writes (`fix`, `unfix`, `keep`, `unkeep`). */
export const TASKS_AUDIT_FEATURE = 'tasks.audit';

/** The findings this app can explain; any other code shows only the finding's heading. */
export const AUDIT_KINDS = ['images-as-text', 'several-books', 'book-unknown', 'folder-missing'] as const;
export type AuditKind = typeof AUDIT_KINDS[number];

/** How much of the finding the research can fix itself: all, a part (the rest is said), nothing. */
export type AuditFix = 'whole' | 'part' | 'none';

export interface WaitingAudit {
    /** The findings' codes as the research sends them (unknown ones kept: the row then shows its heading only). */
    kinds: string[];
    /** An unknown value is 'none' (Fix is not offered). */
    fix: AuditFix;
    /** "T…@<updated>": sent back with `fix` and `keep`, so the research knows the finding still holds. */
    stamp: string;
}

/** Most finding codes kept from one item. */
const MAX_AUDIT_KINDS = 10;

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** `audit` of a waiting item. Untrusted input: null when it is not a well-formed finding. */
export function sanitizeWaitingAudit(value: unknown): WaitingAudit | null {
    const r = asRecord(value);
    if (!r || !Array.isArray(r.kinds)) return null;
    const kinds: string[] = [];
    for (const k of r.kinds) {
        if (typeof k !== 'string' || !/^[a-z][a-z0-9-]{0,40}$/.test(k) || kinds.includes(k)) continue;
        kinds.push(k);
        if (kinds.length >= MAX_AUDIT_KINDS) break;
    }
    const stamp = typeof r.stamp === 'string' ? r.stamp.trim() : '';
    if (kinds.length === 0 || !/^[\x21-\x7e]{1,120}$/.test(stamp)) return null;
    const fix: AuditFix = r.fix === 'whole' || r.fix === 'part' ? r.fix : 'none';
    return { kinds, fix, stamp };
}

/** The codes of `kinds` this app explains, in their own order. */
export function knownAuditKinds(kinds: readonly string[]): AuditKind[] {
    return AUDIT_KINDS.filter(k => kinds.includes(k));
}

/** The sentences the explanation is made of (strings.live.waitingAudit). */
export interface AuditExplainTexts {
    auditKindText: string;
    auditKindBooks: string;
    auditKindBooksUnknown: string;
    auditKindUnknown: string;
    auditKindFolder: string;
    auditAgentAdds: string;
}

/**
 * What the finding means, in sentences (each at most once, in this order):
 * images written only as text; several books (one of them unknown to the
 * research, when it says so); a book the research does not know (alone);
 * the folder for the images missing; and, when the research cannot fix it
 * but has an agent (`hasAgent`: the item offers `chat`), that the agent adds
 * the book. Only unknown codes: '' (the row shows its heading alone).
 */
export function auditExplain(kinds: readonly string[], fix: AuditFix, hasAgent: boolean, t: AuditExplainTexts): string {
    const has = (k: AuditKind): boolean => kinds.includes(k);
    const out: string[] = [];
    if (has('images-as-text')) out.push(t.auditKindText);
    if (has('several-books')) out.push(t.auditKindBooks + (has('book-unknown') ? t.auditKindBooksUnknown : '.'));
    else if (has('book-unknown')) out.push(t.auditKindUnknown);
    if (has('folder-missing')) out.push(t.auditKindFolder);
    if (out.length > 0 && fix === 'none' && hasAgent) out.push(t.auditAgentAdds);
    return out.join(' ');
}
