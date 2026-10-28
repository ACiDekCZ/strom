/**
 * The GEDCOM keyword form a record wrote a date in (Person / Partnership
 * `gedcomDates`): one line of a GEDCOM 5.5.1 date the app's own form would
 * write differently. Only such a value is ever written back as it was.
 */

/** A GEDCOM 5.5.1 date in its keyword form ('§' is a day, month and year, a dual year "1699/00" too). */
const GEDCOM_DATE_FORM = new RegExp('^(?:(?:(?:ABT|CAL|EST|BEF|AFT|INT|TO) )?§|FROM §(?: TO §)?|BET § AND §)$'
    .replace(/§/g, '(?:\\d{1,2} )?(?:(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) )?\\d{3,4}(?:/\\d{2})?'));

/** Whether a value is a date form that may be written as a GEDCOM DATE line. */
export function isGedcomDateForm(value: unknown): value is string {
    return typeof value === 'string' && GEDCOM_DATE_FORM.test(value);
}

/**
 * The kept date forms of loaded data, without anything that is not one
 * (a crafted or broken file may carry anything there), or undefined.
 */
export function sanitizeGedcomDates(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const kept = Object.entries(value as Record<string, unknown>)
        .filter((entry): entry is [string, string] => entry[0] !== '' && isGedcomDateForm(entry[1]));
    return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}
