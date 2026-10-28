/**
 * The GEDCOM keyword form a record wrote a date in (Person / Partnership
 * `gedcomDates`, keyed by the date it was read as): one line of a GEDCOM 5.5.1
 * date the app's own form would write differently. Only such a value, and only
 * for the date it reads as, is ever written back as it was.
 */

import { parseGedcomDate } from './gedcom-date-read.js';

/** A GEDCOM 5.5.1 date in its keyword form ('§' is a day, month and year, a dual year "1699/00" too). */
const GEDCOM_DATE_FORM = new RegExp('^(?:(?:(?:ABT|CAL|EST|BEF|AFT|INT|TO) )?§|FROM §(?: TO §)?|BET § AND §)$'
    .replace(/§/g, '(?:\\d{1,2} )?(?:(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) )?\\d{3,4}(?:/\\d{2})?'));

/** Whether a value is a date form that may be written as a GEDCOM DATE line. */
export function isGedcomDateForm(value: unknown): value is string {
    return typeof value === 'string' && GEDCOM_DATE_FORM.test(value);
}

/**
 * Whether a value is a date form of this very date: the import's reader turns
 * it back into the same value ('ABT 1850' and 'CAL 1850' for '~1850', never
 * 'ABT 1999' for '1850'). Anything else would put a date in the file the app
 * does not show.
 */
export function isGedcomDateFormOf(date: string, value: unknown): value is string {
    return isGedcomDateForm(value) && parseGedcomDate(value) === date;
}

/**
 * The kept date forms of loaded data, without anything that is not a form of
 * its own date (a crafted or broken file may carry anything there), or
 * undefined.
 */
export function sanitizeGedcomDates(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const kept = Object.entries(value as Record<string, unknown>)
        .filter((entry): entry is [string, string] => entry[0] !== '' && isGedcomDateFormOf(entry[0], entry[1]));
    return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}
