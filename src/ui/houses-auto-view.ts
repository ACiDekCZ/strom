/**
 * "House history" in "Research for this tree" (spec 030 §6, K6.1): the texts
 * of the row from `/status.houses` — the estimate while off (`auto` and
 * `estimate`: the price only once measured, else the time alone), the
 * question before switching on, the summary while on. Plain data in, text out.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import type { LiveHouseCounts, LiveHouses } from '../research-link.js';

/** The agent's work as the row says it: minutes up to 90 (by 5), else whole hours. */
export function houseWorkDuration(minutes: number): string {
    const a = strings.houses.auto;
    if (minutes < 90) return a.durMinutes(Math.max(5, Math.ceil(minutes / 5) * 5));
    return a.durHours(Math.round(minutes / 60));
}

/** A price in USD as the current language writes it: one decimal under 10, else whole; null without one. */
export function houseUsd(usd: number | undefined): string | null {
    if (usd === undefined || !Number.isFinite(usd) || usd <= 0) return null;
    const digits = usd < 10 ? 1 : 0;
    try {
        return new Intl.NumberFormat(getCurrentLanguage(), { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(usd);
    } catch {
        return usd.toFixed(digits);
    }
}

/** What the setting would give the agent, when the tree's data give at least one house (`auto`, `estimate`). */
function given(h: LiveHouses | null | undefined): { n: number; t: number; dur: string; usd: string | null } | null {
    if (!h?.auto || !h.estimate || h.auto.houses <= 0) return null;
    const e = h.estimate;
    return { n: h.auto.houses, t: h.auto.towns, dur: houseWorkDuration(e.minutes), usd: e.measured ? houseUsd(e.usd) : null };
}

/** The estimate line under the row while off; null when the tree gives no house (nothing to say). */
export function housesAutoEstimate(h: LiveHouses | null | undefined): string | null {
    const g = given(h);
    return g ? strings.houses.auto.estimate(g.n, g.t, g.dur, g.usd) : null;
}

/** The question's text before switching on: the estimate when there is one. */
export function housesAutoConfirmOn(h: LiveHouses | null | undefined): string {
    const g = given(h);
    return g ? strings.houses.auto.confirmOn(g.n, g.t, g.dur, g.usd) : strings.houses.auto.confirmOnNone;
}

/** The summary while on: the house tasks (done, being researched, queued — waiting ones count as queued). */
export function housesAutoSummary(c: LiveHouseCounts): string {
    const queued = c.queued + c.waiting;
    return strings.houses.auto.onSummary(c.done + c.running + queued, c.done, c.running, queued);
}
