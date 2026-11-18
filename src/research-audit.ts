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

// ==================== THE FIX'S PREVIEW (§2.3) ====================

/**
 * One change of the fix, as the research's preview says it
 * (`GET <token>/waiting/<T…>/fix` → `fix.changes`): a task to wait for
 * images of a book by their numbers (`images` as text: "57–58", "14"), or
 * for a book's images (numbers not known), a task split off (`waits`: by its
 * images, by its book, or still as text when the research does not know the
 * book), or the images' folder made.
 */
export type AuditChange =
    | { op: 'wait-images'; task: string; book: string; title: string; images: string; folder: string }
    | { op: 'wait-book'; task: string; book: string; title: string; folder: string }
    | { op: 'split'; from: string; book: string; title: string; images: string; folder: string; waits: 'images' | 'book' | 'text' }
    | { op: 'folder'; task: string; book: string; folder: string };

/** The research's preview of the fix of a task's finding. */
export interface AuditPreview {
    /** The task ("T0412"). */
    task: string;
    /** How much the fix does (the research's word; an unknown one: none). */
    can: AuditFix;
    /** Sent back with the fix (`expect`): the research writes only while the finding is the same. */
    stamp: string;
    changes: AuditChange[];
    /** The findings' codes no change takes away ("book-unknown"). */
    left: string[];
    /** The books the findings name that the research does not know (`findings[].unknown`), in their order. */
    unknown: string[];
}

/** Most changes, codes and books kept from one preview. */
const MAX_PREVIEW_ITEMS = 40;
/** Longest title, folder or images text kept. */
const MAX_PREVIEW_TEXT = 300;

/** A text of the research, on one line (control characters and runs of spaces flattened), cut at `max`; '' when none. */
function previewText(value: unknown, max = MAX_PREVIEW_TEXT): string {
    if (typeof value !== 'string') return '';
    // eslint-disable-next-line no-control-regex
    const flat = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

const taskRef = (v: unknown): string => (typeof v === 'string' && /^T\d{1,7}$/.test(v.trim()) ? v.trim() : '');
const bookRef = (v: unknown): string => (typeof v === 'string' && /^B\d{1,7}$/.test(v.trim()) ? v.trim() : '');

/** Images' numbers as a person reads them: a hyphen between two numbers is a dash ("57-58" → "57–58"). */
function imagesText(value: unknown): string {
    return previewText(value, 120).replace(/(\d)\s*-\s*(?=\d)/g, '$1–');
}

function previewChange(value: unknown): AuditChange | null {
    const c = asRecord(value);
    if (!c) return null;
    const book = bookRef(c.book);
    const title = previewText(c.title) || book;
    const folder = previewText(c.folder);
    if (c.op === 'wait-images' || c.op === 'wait-book') {
        const task = taskRef(c.task);
        if (!task || !title) return null;
        if (c.op === 'wait-book') return { op: 'wait-book', task, book, title, folder };
        const images = imagesText(c.images);
        return images ? { op: 'wait-images', task, book, title, images, folder } : { op: 'wait-book', task, book, title, folder };
    }
    if (c.op === 'split') {
        if (!title) return null;
        const waits = c.waits === 'images' || c.waits === 'book' ? c.waits : 'text';
        return { op: 'split', from: taskRef(c.from), book, title, images: imagesText(c.images), folder, waits };
    }
    if (c.op === 'folder') {
        const task = taskRef(c.task);
        return task && folder ? { op: 'folder', task, book, folder } : null;
    }
    return null;
}

/**
 * The research's answer to the fix's preview (`{task, at, findings, fix:
 * {can, stamp, changes, left}, kept, fixed}`), typed. Untrusted input: a
 * change of an unknown kind is left out; null when the answer is not a
 * preview at all (no task, no stamp). `fixed` is not read (an Undo later
 * than the toast is the terminal's).
 */
export function sanitizeAuditPreview(body: unknown): AuditPreview | null {
    const r = asRecord(body);
    const fix = asRecord(r?.fix);
    const task = taskRef(r?.task);
    const stamp = typeof fix?.stamp === 'string' ? fix.stamp.trim() : '';
    if (!r || !fix || !task || !/^[\x21-\x7e]{1,120}$/.test(stamp)) return null;
    const changes: AuditChange[] = [];
    for (const c of Array.isArray(fix.changes) ? fix.changes.slice(0, MAX_PREVIEW_ITEMS) : []) {
        const change = previewChange(c);
        if (change) changes.push(change);
    }
    const left: string[] = [];
    for (const k of Array.isArray(fix.left) ? fix.left.slice(0, MAX_PREVIEW_ITEMS) : []) {
        if (typeof k === 'string' && /^[a-z][a-z0-9-]{0,40}$/.test(k) && !left.includes(k)) left.push(k);
    }
    const unknown: string[] = [];
    for (const f of Array.isArray(r.findings) ? r.findings.slice(0, MAX_PREVIEW_ITEMS) : []) {
        const books = asRecord(f)?.unknown;
        for (const b of Array.isArray(books) ? books.slice(0, MAX_PREVIEW_ITEMS) : []) {
            const name = previewText(b);
            if (name && !unknown.includes(name)) unknown.push(name);
        }
    }
    const can: AuditFix = fix.can === 'whole' || fix.can === 'part' ? fix.can : 'none';
    return { task, can, stamp, changes, left, unknown };
}

/** Images' numbers name several images: a range or a list ("57–58", "3, 7"), not one ("14"). */
export function auditImagesSeveral(images: string): boolean {
    return /[-–—,]/.test(images);
}

/** The sentences a preview is made of (strings.live.waitingAudit). */
export interface AuditPreviewTexts {
    auditThisTask: string;
    auditWaitImages: (images: string, book: string) => string;
    auditWaitImage: (n: string, book: string) => string;
    auditWaitBook: (book: string) => string;
    auditFolder: (folder: string) => string;
    auditFolderCreate: (folder: string) => string;
    auditNewTask: string;
    auditSplit: (book: string, images: string | null, several: boolean) => string;
    auditSplitUnknown: string;
    auditLeftUnknown: (book: string) => string;
    auditLeftUnknownNoAgent: (book: string) => string;
}

/** A change of the preview, said: who changes, what, and the line under it. */
export interface AuditChangeLine {
    /** A change of a task (→) or a task split off (+). */
    kind: 'change' | 'new';
    /** "This task", another task's title, or "New task" (a tag: the new task has no number yet). */
    lead: string;
    text: string;
    /** The line under it: the images' folder, or that the new task keeps waiting as text. */
    sub?: { text: string; folder: boolean };
}

/**
 * The preview's changes in sentences (§2.3, D1, D3): this task (or another
 * task the fix touches, by its title — `titleOf`, none: its number) waits
 * for images by their numbers, for a book's images, or gets its folder; a
 * task split off for an image, images or a book, said with its book's
 * title (none: its id), and whether the research knows the book.
 */
export function auditChangeLines(p: AuditPreview, titleOf: (task: string) => string | null, t: AuditPreviewTexts): AuditChangeLine[] {
    const who = (task: string): string => (task === p.task ? t.auditThisTask : titleOf(task) || task);
    return p.changes.map((c): AuditChangeLine => {
        if (c.op === 'wait-images') {
            const text = auditImagesSeveral(c.images) ? t.auditWaitImages(c.images, c.title) : t.auditWaitImage(c.images, c.title);
            return { kind: 'change', lead: who(c.task), text, ...(c.folder ? { sub: { text: t.auditFolder(c.folder), folder: true } } : {}) };
        }
        if (c.op === 'wait-book') {
            return { kind: 'change', lead: who(c.task), text: t.auditWaitBook(c.title), ...(c.folder ? { sub: { text: t.auditFolder(c.folder), folder: true } } : {}) };
        }
        if (c.op === 'folder') return { kind: 'change', lead: who(c.task), text: t.auditFolderCreate(c.folder) };
        const text = t.auditSplit(c.title, c.images || null, auditImagesSeveral(c.images));
        const sub = c.waits === 'text' ? { text: t.auditSplitUnknown, folder: false }
            : c.folder ? { text: t.auditFolder(c.folder), folder: true } : undefined;
        return { kind: 'new', lead: t.auditNewTask, text, ...(sub ? { sub } : {}) };
    });
}

/**
 * What the fix leaves (§2.3 "What remains"): a book the research does not
 * know, one line per such book (the agent adds it, when the item has one);
 * another code says nothing (the research sends no text for it).
 */
export function auditLeftLines(p: AuditPreview, hasAgent: boolean, t: AuditPreviewTexts): string[] {
    if (!p.left.includes('book-unknown')) return [];
    return p.unknown.map(book => (hasAgent ? t.auditLeftUnknown(book) : t.auditLeftUnknownNoAgent(book)));
}

/**
 * Why the preview or the fix was refused, as the preview says it (§2.6):
 * the task changed meanwhile (Reload), the finding gone (the row goes, a
 * toast), the research writing (try again), locked or its disk full (Fix
 * disabled), anything else (the bridge's general sentence).
 */
export type AuditFixError = 'changed' | 'gone' | 'busy' | 'locked' | 'disk' | 'other';

export function auditFixError(r: { code: string; held?: { kind: string } | null }): AuditFixError {
    switch (r.code) {
        case 'changed':
        case 'audit-changed': return 'changed';
        case 'none':
        case 'audit-none': return 'gone';
        case 'busy': return 'busy';
        case 'locked': return 'locked';
        case 'full': return 'disk';
        case 'held': return r.held?.kind === 'disk' ? 'disk' : 'other';
        default: return 'other';
    }
}

/**
 * A preview handed over by the app's main window (the overview's own
 * window, spec 079 K3), typed again: read as the research's answer would be.
 */
export function asAuditPreview(value: unknown): AuditPreview | null {
    const p = asRecord(value);
    if (!p) return null;
    return sanitizeAuditPreview({
        task: p.task, findings: [{ unknown: p.unknown }],
        fix: { can: p.can, stamp: p.stamp, changes: p.changes, left: p.left },
    });
}
