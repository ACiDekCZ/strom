/**
 * Holds of tasks and archives in words (spec 127 K3.1): who holds a task and
 * till when, which archive a run waits for, who uses a queued task's
 * archive. Only what the bridge said under `task.holds` / `archive.holds`;
 * times in the local clock (HH:MM, with the day when not today).
 */

import { strings, getCurrentLanguage } from './strings.js';
import { formatLiveClock } from './live-time.js';
import type { LiveQueueItem, LiveWorker, QueueArchiveHeld, QueueHeldBy, WorkHold } from './research-link.js';

/** An ISO time in the local clock ('' = not a time). */
function clock(iso: string | undefined, now: number, lang: string): string {
    const ts = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(ts) ? formatLiveClock(ts, now, lang) : '';
}

/** "last sign 14:31", only when it differs from "since" ('' otherwise). */
function lastSign(since: string, beat: string | undefined, now: number, lang: string): string {
    const last = clock(beat, now, lang);
    return last && last !== since ? last : '';
}

/** "free by 15:01 at the latest", or "free when it ends" (a live process holds it). */
function freeText(until: string | undefined, now: number, lang: string): string {
    const t = clock(until, now, lang);
    return t ? strings.live.holdFreeBy(t) : strings.live.holdFreeEnds;
}

/**
 * The sentence of a queued task another session holds: "The task is held by
 * Claude Code (session N0040, line …) since 14:05, last sign 14:31; free by
 * 15:01 at the latest." `line`: the task's line in words ('' = none).
 */
export function heldByText(h: QueueHeldBy, line: string, now = Date.now(), lang: string = getCurrentLanguage()): string {
    const L = strings.live;
    const since = clock(h.since, now, lang);
    const about = [L.holdSession(h.session), line ? L.holdLine(line) : ''].filter(Boolean).join(', ');
    return L.heldByTask(h.who, about, since, lastSign(since, h.beat, now, lang), freeText(h.until, now, lang));
}

/** The sentence of a queued task whose archive another session uses now (or other work waits for it longer). */
export function archiveHeldText(a: QueueArchiveHeld, now = Date.now(), lang: string = getCurrentLanguage()): string {
    const L = strings.live;
    const until = clock(a.until, now, lang);
    if (a.by === 'waiting') return L.archiveHeldWaiting(a.site, until);
    const holder = a.by === 'fetch' ? L.archiveHolderFetch
        : a.own ? (a.session ? L.archiveHolderSession(a.session) : L.archiveHolderOwn)
            : L.archiveHolderOther;
    const since = clock(a.since, now, lang);
    const last = since ? lastSign(since, a.beat, now, lang) : '';
    const times = since ? [L.holdSince(since), last ? L.holdLast(last) : ''].filter(Boolean).join(', ') : '';
    return L.archiveHeld(a.site, holder, times, L.holdFreeBy(until));
}

/** A queued task's hold in words ('' = none said): who holds it, else who uses its archive. */
export function queueHoldText(q: Pick<LiveQueueItem, 'heldBy' | 'archiveHeld'>, line: string, now = Date.now(),
    lang: string = getCurrentLanguage()): string {
    if (q.heldBy) return heldByText(q.heldBy, line, now, lang);
    return q.archiveHeld ? archiveHeldText(q.archiveHeld, now, lang) : '';
}

/**
 * What a row at work adds of its hold, after its "since": "last sign 14:31;
 * free by 15:01 at the latest" ('' = no hold, or nothing beyond its since).
 * A live process holding it (no `until`) needs no "free when it ends": the
 * row itself says it works.
 */
export function workingHoldText(hold: WorkHold | undefined, now = Date.now(), lang: string = getCurrentLanguage()): string {
    if (!hold) return '';
    const L = strings.live;
    const last = lastSign(clock(hold.since, now, lang), hold.beat, now, lang);
    const until = clock(hold.until, now, lang);
    return [last ? L.holdLast(last) : '', until ? L.holdFreeBy(until) : ''].filter(Boolean).join('; ');
}

/** A run waiting for an archive: "waiting for the archive … (at most until 14:40)" ('' = it does not wait for one). */
export function waitsText(w: Pick<LiveWorker, 'waits'>, now = Date.now(), lang: string = getCurrentLanguage()): string {
    return w.waits ? strings.live.waitsArchive(w.waits.archive, clock(w.waits.until, now, lang)) : '';
}
