/**
 * Findings of the tree check marked "not an error" ("two different people"
 * for a possible duplicate) — spec 021 K1.5, ZADANI_DEV §2. Pure functions:
 * the shape kept in StromData.qualityDismissed, which findings it hides, the
 * summary sentence the validation dialog and the Tree overview share, and the
 * bodies and replies of the bridge's `/quality` (src/quality-bridge.ts).
 *
 * Also the shape of StromData.surnameRejections (spec 021 §4.4): kept,
 * exported and read here, decided in the surnames dialog.
 */

import { QualityDismissal, SurnameRejection, StromData, Person } from './types.js';
import { ValidationIssue, ValidationResult, qualityFinding, qualityFindingKey, validationCounts } from './validation.js';

/** The research's P… of a person (as research-link's researchPersonRef; not imported: research-link uses this module). */
function researchPersonRef(refn: unknown): string | null {
    return typeof refn === 'string' && /^P\d{1,7}$/.test(refn.trim()) ? refn.trim() : null;
}

/** The bridge takes "not an error" marks (`POST <token>/quality/dismiss`). */
export const QUALITY_DISMISS_FEATURE = 'quality.dismiss';
/** The bridge tells its marks (`GET <token>/quality`, `/status.quality.rev`, event `quality`). */
export const QUALITY_READ_FEATURE = 'quality.read';

/** The research keeps at most this many people in one mark and this long a subject. */
const MAX_PERSONS = 20;
const MAX_SUBJECT = 200;

const SYNC_STATES: ReadonlySet<string> = new Set(['sent', 'queued', 'app']);

function cleanSubject(v: unknown): string | undefined {
    if (typeof v !== 'string') return undefined;
    const s = v.normalize('NFC').trim().slice(0, MAX_SUBJECT);
    return s || undefined;
}

/** The key of a mark (or a finding): the same as qualityFindingKey. */
export function dismissalKey(d: Pick<QualityDismissal, 'kind' | 'persons' | 'subject'>): string {
    return qualityFindingKey(d);
}

/**
 * The marks as stored (a file or an older save may carry anything): a mark
 * needs a kind and one or more people; the people sorted and unique, one mark
 * per key (the last one wins: it is the newest), the order kept.
 */
export function sanitizeQualityDismissed(raw: unknown): QualityDismissal[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const byKey = new Map<string, QualityDismissal>();
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const r = item as Record<string, unknown>;
        const kind = typeof r.kind === 'string' ? r.kind.trim() : '';
        if (!kind || !Array.isArray(r.persons)) continue;
        const persons = [...new Set(r.persons.filter((p): p is string => typeof p === 'string' && p.trim() !== ''))].sort();
        if (persons.length === 0) continue;
        const d: QualityDismissal = {
            kind,
            persons,
            at: typeof r.at === 'string' && r.at ? r.at : new Date(0).toISOString(),
        };
        const subject = cleanSubject(r.subject);
        if (subject) d.subject = subject;
        if (typeof r.sync === 'string' && SYNC_STATES.has(r.sync)) d.sync = r.sync as QualityDismissal['sync'];
        if (r.by === 'research') d.by = 'research';
        const key = dismissalKey(d);
        byKey.delete(key);
        byKey.set(key, d);
    }
    return [...byKey.values()];
}

/** The forms of a rejected suggestion: trimmed, NFC, unique, two or more. */
function cleanForms(raw: unknown): string[] | null {
    if (!Array.isArray(raw)) return null;
    const seen = new Set<string>();
    const forms: string[] = [];
    for (const f of raw) {
        if (typeof f !== 'string') continue;
        const s = f.normalize('NFC').trim();
        if (!s || seen.has(s.toLowerCase())) continue;
        seen.add(s.toLowerCase());
        forms.push(s);
    }
    return forms.length >= 2 ? forms : null;
}

/** One string for a rejection's forms, order and case aside. */
export function surnameRejectionKey(forms: readonly string[]): string {
    return JSON.stringify(forms.map(f => f.normalize('NFC').trim().toLowerCase()).sort());
}

/** The rejections as stored: two or more forms each, one per set of forms (the last wins). */
export function sanitizeSurnameRejections(raw: unknown): SurnameRejection[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const byKey = new Map<string, SurnameRejection>();
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const r = item as Record<string, unknown>;
        const forms = cleanForms(r.forms);
        if (!forms) continue;
        const rej: SurnameRejection = { forms };
        if (typeof r.id === 'string' && r.id.trim()) rej.id = r.id.trim();
        if (typeof r.at === 'string' && r.at) rej.at = r.at;
        if (r.by === 'research') rej.by = 'research';
        const key = surnameRejectionKey(forms);
        byKey.delete(key);
        byKey.set(key, rej);
    }
    return [...byKey.values()];
}

/** The keys of the tree's marks, to look findings up. */
export function dismissedKeys(data: Pick<StromData, 'qualityDismissed'>): Set<string> {
    return new Set((data.qualityDismissed ?? []).map(dismissalKey));
}

/** Is this finding marked "not an error" in the tree? */
export function isDismissed(issue: ValidationIssue, keys: ReadonlySet<string>): boolean {
    return keys.size > 0 && keys.has(qualityFindingKey(qualityFinding(issue)));
}

/** The findings that are still reported: those marked "not an error" left out. */
export function visibleIssues(issues: readonly ValidationIssue[], data: Pick<StromData, 'qualityDismissed'>): ValidationIssue[] {
    const keys = dismissedKeys(data);
    return keys.size === 0 ? [...issues] : issues.filter(i => !isDismissed(i, keys));
}

/**
 * The result of the tree check as shown: findings marked "not an error" left
 * out, the counts made again from the rest (the dialog, the Tree overview and
 * its focus line all count the same).
 */
export function visibleValidation(result: ValidationResult, data: Pick<StromData, 'qualityDismissed'>): ValidationResult {
    if (!data.qualityDismissed?.length) return result;
    const issues = visibleIssues(result.issues, data);
    const { errors, warnings, traces } = validationCounts(issues);
    return { valid: errors === 0, issues, stats: { errors, warnings, infos: traces } };
}

/** The summary sentence's parts (ZADANI_DEV §1.1); `null` = nothing found (the tick). */
export type SummaryKind = 'errors' | 'noErrors' | 'leadsOnly' | null;

export function summaryKind(c: { errors: number; warnings: number; traces: number }): SummaryKind {
    if (c.errors > 0) return 'errors';
    if (c.warnings > 0) return 'noErrors';
    if (c.traces > 0) return 'leadsOnly';
    return null;
}

/** A new mark for a finding (people sorted, subject as the research keeps it). */
export function dismissalFor(issue: ValidationIssue, at: string = new Date().toISOString()): QualityDismissal {
    const f = qualityFinding(issue);
    const d: QualityDismissal = { kind: f.kind, persons: f.persons, at };
    const subject = cleanSubject(f.subject);
    if (subject) d.subject = subject;
    return d;
}

// ==================== The bridge's /quality ====================

/** A mark as the research names it: its people by the research's P… numbers. */
export interface ResearchQualityMark {
    kind: string;
    persons: string[];
    subject?: string;
    at?: string;
    by?: 'app' | 'research';
}

/** The research's P… of a person (its REFN), or null when the person has none. */
export function researchRefOf(person: Pick<Person, 'refn'> | undefined): string | null {
    return researchPersonRef(person?.refn);
}

/**
 * The body of `POST <token>/quality/dismiss` for a mark of this tree, or null
 * when one of its people has no REFN of the research (the mark stays in the
 * app only — it is sent only when ALL its people have one).
 */
export function dismissBody(
    d: Pick<QualityDismissal, 'kind' | 'persons' | 'subject'>,
    persons: Readonly<Record<string, Pick<Person, 'refn'> | undefined>>,
    undo = false,
): { kind: string; persons: string[]; subject?: string; do?: 'undo' } | null {
    if (d.persons.length === 0 || d.persons.length > MAX_PERSONS) return null;
    const refs: string[] = [];
    for (const id of d.persons) {
        const ref = researchRefOf(persons[id]);
        if (!ref) return null;
        refs.push(ref);
    }
    refs.sort();
    return {
        kind: d.kind,
        persons: refs,
        ...(d.subject ? { subject: d.subject } : {}),
        ...(undo ? { do: 'undo' as const } : {}),
    };
}

/** The key of a mark by the research's P… numbers (what the research and the device remember). */
export function researchMarkKey(m: Pick<ResearchQualityMark, 'kind' | 'persons' | 'subject'>): string {
    return qualityFindingKey({ kind: m.kind, persons: [...m.persons].sort(), subject: cleanSubject(m.subject) });
}

/** `GET <token>/quality`'s reply, or null when it is not one. */
export function parseQualityReply(raw: unknown): { rev: string; dismissed: ResearchQualityMark[] } | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (!Array.isArray(r.dismissed)) return null;
    const dismissed: ResearchQualityMark[] = [];
    for (const item of r.dismissed) {
        if (!item || typeof item !== 'object') continue;
        const m = item as Record<string, unknown>;
        if (typeof m.kind !== 'string' || !m.kind.trim() || !Array.isArray(m.persons)) continue;
        const persons = m.persons.filter((p): p is string => typeof p === 'string' && researchPersonRef(p) !== null).map(p => p.trim());
        if (persons.length === 0 || persons.length !== m.persons.length) continue;
        const mark: ResearchQualityMark = { kind: m.kind.trim(), persons: [...new Set(persons)].sort() };
        const subject = cleanSubject(m.subject);
        if (subject) mark.subject = subject;
        if (typeof m.at === 'string' && m.at) mark.at = m.at;
        if (m.by === 'research' || m.by === 'app') mark.by = m.by;
        dismissed.push(mark);
    }
    return { rev: typeof r.rev === 'string' ? r.rev : '', dismissed };
}

/**
 * The research's marks in the tree's terms: each P… to this tree's person, a
 * mark naming someone the tree does not have left out.
 */
export function marksInTree(
    marks: readonly ResearchQualityMark[],
    persons: Readonly<Record<string, Pick<Person, 'refn'> | undefined>>,
): Array<{ key: string; researchKey: string; mark: ResearchQualityMark; persons: string[] }> {
    const byRef = new Map<string, string>();
    for (const [id, p] of Object.entries(persons)) {
        const ref = researchRefOf(p);
        if (ref && !byRef.has(ref)) byRef.set(ref, id);
    }
    const out: Array<{ key: string; researchKey: string; mark: ResearchQualityMark; persons: string[] }> = [];
    for (const mark of marks) {
        const ids = mark.persons.map(r => byRef.get(r));
        if (ids.some(id => !id)) continue;
        const sorted = [...new Set(ids as string[])].sort();
        out.push({
            key: dismissalKey({ kind: mark.kind, persons: sorted, subject: mark.subject }),
            researchKey: researchMarkKey(mark),
            mark,
            persons: sorted,
        });
    }
    return out;
}

/**
 * The tree's marks after the research told its own (`GET /quality`, three
 * states — the way the history's hidden items are taken over):
 * - `acked`: the research's keys this device last knew the research to hold
 *   (its own confirmed sends and what it last read);
 * - a mark the research holds that the tree lacks and the device did not know
 *   → added (marked elsewhere: in the research, on another device);
 * - a tree mark the device knew the research to hold that the research no
 *   longer holds → removed (taken back in the research);
 * - a tree mark the research holds → `sync: 'sent'` (and `by` taken over);
 * everything else stays as it is (not sent yet, in the app only).
 * Returns null when nothing changes.
 */
export function mergeResearchMarks(
    current: readonly QualityDismissal[],
    research: ReturnType<typeof marksInTree>,
    acked: ReadonlySet<string>,
    persons: Readonly<Record<string, Pick<Person, 'refn'> | undefined>>,
): QualityDismissal[] | null {
    const researchByKey = new Map(research.map(r => [r.key, r]));
    let changed = false;
    const next: QualityDismissal[] = [];
    for (const d of current) {
        const key = dismissalKey(d);
        const inResearch = researchByKey.get(key);
        if (inResearch) {
            const by = inResearch.mark.by === 'research' ? 'research' as const : undefined;
            if (d.sync !== 'sent' || d.by !== by) {
                const upd: QualityDismissal = { ...d, sync: 'sent' };
                if (by) upd.by = by; else delete upd.by;
                next.push(upd);
                changed = true;
            } else {
                next.push(d);
            }
            continue;
        }
        const body = dismissBody(d, persons);
        if (body && acked.has(researchMarkKey(body))) {
            changed = true; // taken back in the research
            continue;
        }
        next.push(d);
    }
    const have = new Set(next.map(dismissalKey));
    for (const r of research) {
        if (have.has(r.key) || acked.has(r.researchKey)) continue;
        // Known before and gone from the tree: taken back here, the undo is on its way.
        const d: QualityDismissal = {
            kind: r.mark.kind,
            persons: r.persons,
            at: r.mark.at ?? new Date().toISOString(),
            sync: 'sent',
        };
        if (r.mark.subject) d.subject = r.mark.subject;
        if (r.mark.by === 'research') d.by = 'research';
        next.push(d);
        have.add(r.key);
        changed = true;
    }
    return changed ? next : null;
}

/**
 * The tree's own decisions carried over a new version from the research
 * (like carryOverMedia): the "not an error" marks always (the research's
 * GEDCOM does not carry them); the spelling groups and the rejected
 * suggestions only when the research's file says nothing of them (no
 * marker: an older research) — with a marker the research's word is the
 * tree's (it merged them in three states already).
 */
export function carryOverTreeDecisions(next: StromData, previous: StromData | null | undefined): StromData {
    if (!previous) {
        if (next.surnameVariants && next.surnameVariants.length === 0) delete next.surnameVariants;
        if (next.surnameRejections && next.surnameRejections.length === 0) delete next.surnameRejections;
        return next;
    }
    if (previous.qualityDismissed?.length && !next.qualityDismissed?.length) {
        next.qualityDismissed = previous.qualityDismissed.map(d => ({ ...d, persons: [...d.persons] }));
    }
    if (next.surnameVariants === undefined && previous.surnameVariants?.length) {
        next.surnameVariants = previous.surnameVariants.map(g => [...g]);
    } else if (next.surnameVariants && next.surnameVariants.length === 0) {
        delete next.surnameVariants;
    }
    const rejections = withRejectionDetails(next.surnameRejections, previous.surnameRejections);
    if (rejections?.length) next.surnameRejections = rejections;
    else delete next.surnameRejections;
    return next;
}

/**
 * The rejected suggestions of a new version: none told (`next` undefined, no
 * marker) keeps the tree's; a list told (even empty, the research's "none")
 * is taken, each rejection with the id and date the tree has for the same
 * forms (the GEDCOM carries only the forms). Returns `next` itself when
 * nothing changes.
 */
export function withRejectionDetails(
    next: readonly SurnameRejection[] | undefined,
    previous: readonly SurnameRejection[] | undefined,
): SurnameRejection[] | undefined {
    if (next === undefined) {
        return previous?.length ? previous.map(r => ({ ...r, forms: [...r.forms] })) : undefined;
    }
    if (!previous?.length || next.length === 0) return next as SurnameRejection[];
    const known = new Map(previous.map(r => [surnameRejectionKey(r.forms), r]));
    let changed = false;
    const out = next.map(r => {
        const had = known.get(surnameRejectionKey(r.forms));
        if (!had || (r.id && r.at)) return r;
        const merged: SurnameRejection = { ...r, forms: [...r.forms] };
        if (!merged.id && had.id) merged.id = had.id;
        if (!merged.at && had.at) merged.at = had.at;
        if (!merged.by && had.by) merged.by = had.by;
        if (merged.id === r.id && merged.at === r.at && merged.by === r.by) return r;
        changed = true;
        return merged;
    });
    return changed ? out : next as SurnameRejection[];
}

/**
 * The marks of a tree whose people are all in `kept` (a subtree or a part of
 * the tree taken out as its own tree).
 */
export function dismissalsWithin(list: readonly QualityDismissal[] | undefined, kept: (id: string) => boolean): QualityDismissal[] | undefined {
    if (!list?.length) return undefined;
    const out = list.filter(d => d.persons.every(kept)).map(d => {
        const copy: QualityDismissal = { ...d, persons: [...d.persons] };
        delete copy.sync;
        return copy;
    });
    return out.length ? out : undefined;
}
