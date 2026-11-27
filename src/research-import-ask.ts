/**
 * "Did this come from a family tree?" (1127, `waiting.import`): a send of the
 * app that added many people the research holds as written by a person. The
 * research's preview of what its answer would change (`GET <token>/waiting/
 * W-S-I…/preview`, nothing written) and the answer (`POST <token>/waiting/
 * W-S-I…` `{do: import | own}`): `import` marks the facts still as sent and
 * not confirmed as from a family tree (○○), `own` keeps them as written by
 * hand and the question never comes again. Pure but for the two requests.
 *
 * Through the research's bridge, without a terminal and without an agent: no
 * mark (CLAUDE.md, RESEARCH_LINK_MARKS).
 */

import { isImportAskId, importAskDay, waitingImportSamples, type LiveWaiting, type WaitingImportSample } from './research-link.js';
import { researchBridgeWrite, type BridgeWriteResult, type DirectionWriteRefused } from './research-directions-write.js';

/** The answer: from a family tree (import), or written by hand (own). */
export type ImportAskDo = 'import' | 'own';

/** What the answer "import" would change, as the research works it out now. */
export interface ImportAskPreview {
    input: string;
    day: string;
    persons: number;
    /** Facts that go from ✓ to ○○, and of how many people. */
    change: { values: number; persons: number };
    /** Facts that stay ✓, and why: edited since the send, confirmed, an earlier value, another origin. */
    stay: { values: number; changed: number; confirmed: number; was: number; other: number };
    samples: WaitingImportSample[];
}

/** The written answer, as the research says it. */
export interface ImportAskWritten {
    answer: ImportAskDo;
    /** import: the facts now ○○ and of how many people (absent: not said). */
    values?: number;
    persons?: number;
    /** import: the research made a backup first. */
    backup?: true;
}

const count = (v: unknown): number | null =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10_000_000 ? v : null;

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** The research's preview, checked (untrusted input); null when it is not one (no counts of what changes). */
export function sanitizeImportAskPreview(value: unknown): ImportAskPreview | null {
    const r = asRecord(value);
    const c = asRecord(r?.change);
    const st = asRecord(r?.stay);
    const values = count(c?.values);
    const changed = count(c?.persons);
    if (!r || !c || values === null || changed === null) return null;
    const part = (k: string): number => count(st?.[k]) ?? 0;
    const parts = { changed: part('changed'), confirmed: part('confirmed'), was: part('was'), other: part('other') };
    const stayValues = count(st?.values) ?? parts.changed + parts.confirmed + parts.was + parts.other;
    return {
        input: typeof r.input === 'string' && /^I\d{1,9}$/.test(r.input) ? r.input : '',
        day: importAskDay(r.day),
        persons: count(r.persons) ?? 0,
        change: { values, persons: changed },
        stay: { values: stayValues, ...parts },
        samples: waitingImportSamples(r.samples),
    };
}

/** The research's answer to a written answer, checked; null when it is not one. */
export function sanitizeImportAskWritten(r: Record<string, unknown>, asked: ImportAskDo): ImportAskWritten | null {
    const answer = r.answer === 'import' || r.answer === 'own' ? r.answer : asked;
    if (answer !== asked) return null;
    const values = count(r.values);
    const persons = count(r.persons);
    return {
        answer,
        ...(answer === 'import' && values !== null ? { values } : {}),
        ...(answer === 'import' && persons !== null ? { persons } : {}),
        ...(answer === 'import' && r.backup === true ? { backup: true as const } : {}),
    };
}

const notSent = (): DirectionWriteRefused => ({ ok: false, code: 'invalid', status: 0, errorCode: '', retryAfter: null, reason: '' });

/** What the answer "import" would change (`GET waiting/W-S-I…/preview`; 404 `waiting.none`: it no longer waits). */
export function readImportAskPreview(base: string, id: string): Promise<BridgeWriteResult<{ preview: ImportAskPreview }>> {
    if (!isImportAskId(id)) return Promise.resolve(notSent());
    return researchBridgeWrite(base, 'GET', `waiting/${id}/preview`, undefined, r => {
        const preview = sanitizeImportAskPreview(r);
        return preview ? { preview } : null;
    });
}

/** The answer (`POST waiting/W-S-I…` `{do}`); 404 `waiting.none`: answered elsewhere or no longer waits. */
export function answerImportAsk(base: string, id: string, what: ImportAskDo): Promise<BridgeWriteResult<{ written: ImportAskWritten }>> {
    if (!isImportAskId(id) || (what !== 'import' && what !== 'own')) return Promise.resolve(notSent());
    return researchBridgeWrite(base, 'POST', `waiting/${id}`, { do: what }, r => {
        const written = sanitizeImportAskWritten(r, what);
        return written ? { written } : null;
    });
}

/** The texts of the question (strings.live.importAsk). */
export interface ImportAskTexts {
    busy: (seconds: number | null) => string;
    down: string;
    notSaved: string;
    notSavedSaid: (t: string) => string;
}

/**
 * How a read or an answer ended, as the item shows it: done, gone (404 `waiting.none`: answered elsewhere or no
 * longer waiting — the item goes and a toast says why), or refused with its sentence and whether Try again helps.
 */
export type ImportAskOutcome<T> =
    | { ok: true; value: T }
    | { ok: false; gone: true }
    | { ok: false; gone?: false; text: string; retry: boolean; tone: 'warn' | 'danger' };

/** A refusal as its outcome: 404 gone; 503 busy with when to try again; a research that does not answer; its own words. */
export function importAskOutcomeOf(r: DirectionWriteRefused, T: ImportAskTexts): ImportAskOutcome<never> {
    if (r.code === 'none') return { ok: false, gone: true };
    const text = r.code === 'busy' ? T.busy(r.retryAfter)
        : r.code === 'network' ? T.down
            : r.code === 'held' && r.held?.said ? r.held.said
                : r.reason ? T.notSavedSaid(r.reason) : T.notSaved;
    return { ok: false, text, retry: r.code === 'busy' || r.code === 'network' || r.code === 'failed', tone: r.code === 'busy' ? 'warn' : 'danger' };
}

/** An outcome as the overview's own window got it from the main window (null: not one); `value` checked by `read`. */
export function readImportAskOutcome<T>(v: unknown, read: (x: unknown) => T | null): ImportAskOutcome<T> | null {
    const o = asRecord(v);
    if (!o) return null;
    if (o.ok === true) {
        const value = read(o.value);
        return value === null ? null : { ok: true, value };
    }
    if (o.ok !== false) return null;
    if (o.gone === true) return { ok: false, gone: true };
    if (typeof o.text !== 'string') return null;
    return { ok: false, text: o.text.slice(0, 400), retry: o.retry === true, tone: o.tone === 'warn' ? 'warn' : 'danger' };
}

/** A written answer as the overview's own window got it (null: not one). */
export function readImportAskWritten(v: unknown): ImportAskWritten | null {
    const o = asRecord(v);
    if (!o || (o.answer !== 'import' && o.answer !== 'own')) return null;
    return sanitizeImportAskWritten(o, o.answer);
}

/** The reasons facts stay ✓, those not zero, in their order. */
export function importAskStayParts(stay: ImportAskPreview['stay']): { key: 'changed' | 'confirmed' | 'was' | 'other'; n: number }[] {
    return (['changed', 'confirmed', 'was', 'other'] as const).map(key => ({ key, n: stay[key] })).filter(p => p.n > 0);
}

/** The question's row in a list (the overview, the small panel): who it is about, in one line ("142 people: A, B, C"). */
export function importAskWho(w: Pick<LiveWaiting, 'importAsk'>, count: (n: number) => string): string {
    const a = w.importAsk;
    if (!a) return '';
    const names = a.samples.map(p => p.name).join(', ');
    return names ? `${count(a.persons)}: ${names}` : count(a.persons);
}
