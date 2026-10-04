/**
 * "Another page of the same book": what of a source's reference and note
 * belongs to the book (kept for the new page) and what to its own entry
 * (its page, the date the entry was recorded — left out).
 */

const MONTHS = 'JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC';

/** A page at the end of a reference: ", s. 112", "p. 12–13", "fol. 4v", "Seite 7". */
const PAGE_AT_END = /^(.*?)([,;]?\s*)(s\.|str\.|pp?\.|seite|page|fol\.|folio|f\.)\s*\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?\s*$/iu;

/** A line that is only a date, maybe after a short label: "Zapsáno: 20 MAR 1825", "Recorded 1825-03-20". */
const DATE_LINE = new RegExp(String.raw`^\s*[\p{L} ]{0,24}:?\s*(?:(?:\d{1,2}\s+)?(?:${MONTHS})\s+\d{3,4}|\d{1,2}\.\s*\d{1,2}\.\s*\d{3,4}|\d{4}-\d{2}-\d{2})\s*$`, 'iu');

/**
 * The book of a reference without its page, ready for the next page to be
 * typed ("Voss, Ministerialbok 1820–1835, s. 112" → "Voss, Ministerialbok
 * 1820–1835, s. "). '' when it is only a page or no page is recognized.
 */
export function bookReference(reference: string): string {
    const m = PAGE_AT_END.exec(reference.trim());
    if (!m || !m[1].trim()) return '';
    return `${m[1]}${m[2] || ', '}${m[3]} `;
}

/** A note line that is the recording date of an entry (not of the book). */
export function entryDateLine(line: string): boolean {
    return DATE_LINE.test(line);
}
