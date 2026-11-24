/**
 * Locale-aware formatting of times and sizes for lists (backups, trees).
 *
 * Pure functions: the language and "now" are parameters so they can be unit
 * tested; callers pass getCurrentLanguage() and Date.now().
 */

import type { Language } from './strings.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ts: number): number {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/** "14:36" / "2:36 PM" — hours and minutes, no seconds. */
function timeOfDay(ts: number, lang: Language): string {
    return new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' }).format(ts);
}

/** "today" / "yesterday" in the UI language, capital-free. */
function relativeDay(offset: 0 | -1, lang: Language): string {
    try {
        return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(offset, 'day');
    } catch {
        const words: Record<Language, [string, string]> = {
            en: ['today', 'yesterday'],
            cs: ['dnes', 'včera'],
            de: ['heute', 'gestern'],
            pl: ['dzisiaj', 'wczoraj'],
        };
        return words[lang][offset === 0 ? 0 : 1];
    }
}

/**
 * When something was saved, as a person would say it: "today 14:36",
 * "yesterday 9:10", older ones "20. 7. 2026 14:36" (the language's own
 * numeric date). No seconds.
 */
export function formatRelativeDateTime(ts: number, lang: Language, now: number = Date.now()): string {
    const time = timeOfDay(ts, lang);
    const diffDays = Math.round((startOfDay(now) - startOfDay(ts)) / DAY_MS);
    if (diffDays === 0) return `${relativeDay(0, lang)} ${time}`;
    if (diffDays === 1) return `${relativeDay(-1, lang)} ${time}`;
    return formatDateTime(ts, lang);
}

/**
 * A day with its year and the time, in the language's own numeric date:
 * "22. 11. 2026 15:41" (cs), "22.11.2026 15:41" (de), "11/22/2026 3:41 PM"
 * (en). No seconds.
 */
export function formatDateTime(ts: number, lang: Language): string {
    const date = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'numeric', year: 'numeric' }).format(ts);
    return `${date} ${timeOfDay(ts, lang)}`;
}

/** Sizes below this are not worth showing next to a backup or a tree. */
export const SIZE_SHOWN_FROM = 1024 * 1024;

/**
 * A file size worth telling the user about: '' below 1 MB, otherwise rounded
 * megabytes with the language's decimal mark ("1,4 MB", "12 MB").
 */
export function formatFileSize(bytes: number, lang: Language): string {
    if (!(bytes >= SIZE_SHOWN_FROM)) return '';
    const mb = bytes / (1024 * 1024);
    const digits = mb < 10 ? 1 : 0;
    const num = new Intl.NumberFormat(lang, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(mb);
    return `${num} MB`;
}

/**
 * A tree's size, always told (Manage trees row, spec 139 §7.2): whole
 * kilobytes below 1 MB ("240 kB"), otherwise as formatFileSize ("1,4 MB").
 */
export function formatTreeSize(bytes: number, lang: Language): string {
    if (bytes >= SIZE_SHOWN_FROM) return formatFileSize(bytes, lang);
    const kb = Math.max(1, Math.round((Number.isFinite(bytes) ? Math.max(0, bytes) : 0) / 1024));
    return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 0 }).format(kb)} kB`;
}

/**
 * A day and time this year, short, as the language writes it (spec 075 §5:
 * when a split was done): "11. 11. 14:20" (cs), "11 Nov, 14:20" (en),
 * "11. 11., 14:20" (de), "11.11, 14:20" (pl). Local time, no year, no seconds.
 */
export function formatShortDateTime(ts: number, lang: Language): string {
    const d = new Date(ts);
    const day = d.getDate();
    const month = d.getMonth() + 1;
    const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    switch (lang) {
        case 'cs': return `${day}. ${month}. ${time}`;
        case 'de': return `${day}. ${month}., ${time}`;
        case 'pl': return `${day}.${month}, ${time}`;
        default: {
            const mon = new Intl.DateTimeFormat('en', { month: 'short' }).format(d);
            return `${day} ${mon}, ${time}`;
        }
    }
}
