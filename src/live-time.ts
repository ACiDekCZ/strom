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

function sameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

