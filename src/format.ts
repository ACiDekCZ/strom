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
    const date = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'numeric', year: 'numeric' }).format(ts);
    return `${date} ${time}`;
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
