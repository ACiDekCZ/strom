/**
 * Times in the live research panel. The backups' "today 14:36" read as
 * "since today 14:36" there, and every row said "today …": the panel wants
 * how fresh a change is — "just now", "5 min ago", "14:36", an older date.
 */

/**
 * `justNow` (under a minute) / "N min ago" / "14:36" (today) / "24. 9. 14:36"
 * (older). `justNow` comes from strings (research.justNow).
 */
export function formatLiveTime(ts: number, now: number, lang: string, justNow: string): string {
    const diff = now - ts;
    if (diff < 60_000) return justNow;
    if (diff < 3_600_000) {
        const minutes = Math.floor(diff / 60_000);
        return new Intl.RelativeTimeFormat(lang, { numeric: 'always', style: 'short' }).format(-minutes, 'minute');
    }
    return formatLiveClock(ts, now, lang);
}

/** "14:36" today, else the day and the time ("24. 9. 14:36"). */
export function formatLiveClock(ts: number, now: number, lang: string): string {
    const d = new Date(ts);
    const time = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(d);
    if (sameDay(d, new Date(now))) return time;
    const day = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'numeric' }).format(d);
    return `${day} ${time}`;
}

/**
 * Since when an item has waited (spec 083 §5): `justNow` / "25 min ago"
 * within the hour, "12:07" today, `yesterday`, the day ("12. 11.") this
 * year, the day with its year before. Only the day for older ones: their
 * hour would be noise.
 */
export function formatWaitingSince(ts: number, now: number, lang: string, words: { justNow: string; yesterday: string }): string {
    if (now - ts < 3_600_000) return formatLiveTime(ts, now, lang, words.justNow);
    const d = new Date(ts);
    const today = new Date(now);
    if (sameDay(d, today)) return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(d);
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (sameDay(d, yesterday)) return words.yesterday;
    return new Intl.DateTimeFormat(lang, d.getFullYear() === today.getFullYear()
        ? { day: 'numeric', month: 'numeric' }
        : { day: 'numeric', month: 'numeric', year: 'numeric' }).format(d);
}

function sameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

