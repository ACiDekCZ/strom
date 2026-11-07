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

/**
 * An entry's own part of a reference, at the start of a part between commas: "6. zápis", "zápis č. 6", "entry 6",
 * "6th entry", "3. Eintrag", "Eintrag Nr. 3", "wpis 2", "2. wpis", "akt nr 12" (with what follows in that part,
 * a date in brackets, "května").
 */
const ENTRY_PART = /^(?:\d+\.\s*(?:zápis|záznam|eintrag|wpis)|\d+(?:st|nd|rd|th)\s+entry|(?:zápis|záznam|entry|eintrag|wpis|akt)\s*(?:(?:č|no|nr)\.?\s*)?\d+)(?![\p{L}\d])/iu;

/** A part that is only a date, maybe in brackets: "21. 2. 1755", "(21./22. 2. 1755)", "21 Feb 1755", "21.02.1755". */
const DATE_PART = /^\(?\s*(?:\d{1,2}\.?\s*(?:[/–-]\s*\d{1,2}\.?\s*)?(?:\d{1,2}\.?|\p{L}{3,10}\.?)\s*\d{3,4}|\d{4}-\d{2}-\d{2})\s*\)?$/u;

/** A reference cut at its commas and semicolons outside brackets: each part with the separator before it ('' the first). */
function referenceParts(reference: string): { sep: string; text: string }[] {
    const out: { sep: string; text: string }[] = [];
    let depth = 0, from = 0, sep = '';
    for (let i = 0; i < reference.length; i++) {
        const c = reference[i];
        if (c === '(' || c === '[') depth++;
        else if ((c === ')' || c === ']') && depth > 0) depth--;
        else if ((c === ',' || c === ';') && depth === 0) {
            out.push({ sep, text: reference.slice(from, i).trim() });
            sep = c;
            from = i + 1;
        }
    }
    out.push({ sep, text: reference.slice(from).trim() });
    return out;
}

/**
 * "Another entry from the same book": the reference without the entry's own part ("kn. 704, sn. 88, str. 169,
 * 6. zápis (21./22. 2. 1755)" → "kn. 704, sn. 88, str. 169"), so the new source does not carry another entry's
 * number and date. `whole`: no entry's part recognized (or nothing of the book would stay) — the reference as it is,
 * to be checked by hand.
 */
export function sameBookReference(reference: string): { reference: string; whole: boolean } {
    const ref = reference.normalize('NFC').trim();
    const parts = referenceParts(ref);
    const at = parts.findIndex(p => ENTRY_PART.test(p.text));
    if (at < 0) return { reference: ref, whole: true };
    const drop = new Set([at]);
    // The entry's date as a part of its own right after it.
    if (at + 1 < parts.length && DATE_PART.test(parts[at + 1].text)) drop.add(at + 1);
    const kept = parts.filter((p, i) => !drop.has(i) && p.text);
    if (!kept.length) return { reference: ref, whole: true };
    const text = kept.map((p, i) => i === 0 ? p.text : `${p.sep} ${p.text}`).join('');
    return { reference: text, whole: false };
}
