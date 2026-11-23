/**
 * The words of a run (spec 126 U10) shared by Now and the choice of the run followed (§7): its name,
 * what a waiting run waits for and why an ended one ended, in the app's words.
 */

import { strings, getCurrentLanguage } from './strings.js';
import { formatLiveClock } from './live-time.js';
import type { LiveDirection, RunEndedWhy } from './research-link.js';
import type { LiveRun } from './research-runs.js';

/** A run's name: the direction's ("Kubíčkovi z Dolní Lhoty"), the general run's "Whole queue". */
export function runName(r: Pick<LiveRun, 'kind' | 'research' | 'id'>, researches: readonly LiveDirection[]): string {
    return r.kind === 'queue' ? strings.live.runWhole : researches.find(d => d.id === r.research)?.name ?? r.research ?? r.id;
}

/** A clock time of an ISO moment ("14:00"; '' when not said or not readable). */
function clock(iso: string | undefined): string {
    const ts = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(ts) ? formatLiveClock(ts, Date.now(), getCurrentLanguage()) : '';
}

/**
 * Under the state tile's "3 agents working" (spec 126 U10 §3): how many of the runs wait — "1 waiting for the limit
 * until 14:00" when all of them wait for the limit, else "2 waiting" (an archive, the browser, a download count too:
 * before, a run waiting for the archive was counted as working with nothing said); null when none waits.
 */
export function runsWaitingText(runs: readonly Pick<LiveRun, 'state' | 'wait'>[]): string | null {
    const L = strings.live;
    const waits = runs.filter(r => r.state === 'waiting');
    if (waits.length === 0) return null;
    if (waits.some(r => r.wait?.for !== 'limit')) return L.stateAgentsWaitingAny(waits.length);
    const ends = waits.map(r => Date.parse(r.wait?.until ?? '')).filter(Number.isFinite);
    const until = ends.length > 0 ? formatLiveClock(Math.min(...ends), Date.now(), getCurrentLanguage()) : '';
    return until ? L.stateAgentsWaiting(waits.length, until) : L.stateAgentsWaitingNoTime(waits.length);
}

/** What a waiting run waits for, until when ("waiting for the subscription limit until 14:00"). */
export function runWaitText(run: Pick<LiveRun, 'wait'>): string {
    const L = strings.live;
    const t = clock(run.wait?.until);
    const why = run.wait?.for ?? 'other';
    return why === 'limit' ? (t ? L.runStateLimit(t) : L.runStateLimitNoTime)
        : why === 'archive' ? (t ? L.runStateArchive(t) : L.runStateArchiveNoTime)
        : why === 'browser' ? L.runStateBrowser
        : why === 'download' ? L.runStateDownload
        : t ? L.runStateWaitingUntil(t) : L.runStateWaiting;
}

/**
 * A direction's own run as its row and detail say it: a run that waits says
 * what for and until when, as Now does ("Claude · waiting for the archive
 * until 14:00"); null: it works (the row says "Agent at work").
 */
export function lineRunWaitLine(run: Pick<LiveRun, 'state' | 'wait'> | null | undefined, agent: string): string | null {
    if (run?.state !== 'waiting') return null;
    const wait = runWaitText(run);
    return agent ? `${agent} · ${wait}` : wait;
}

/**
 * Why a run ended, as a quiet line under "ended at …": only the subscription limit and an error are
 * said; a run done, stopped by hand, held by the gate, out of time, gone to an archive, or an end not
 * said gets none ('').
 */
export function runEndedText(why: RunEndedWhy | undefined): string {
    return why === 'limit' ? strings.live.runEndedLimit : why === 'error' ? strings.live.runEndedError : '';
}
