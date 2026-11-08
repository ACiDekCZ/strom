/**
 * Joining two free-text notes during a tree merge.
 *
 * A note is a list of parts separated by a line holding only "---" (the
 * separator a merge writes between the two sides). Merging adds only the
 * parts of the incoming note the existing one does not already say, so
 * merging the same file again never grows a note.
 */

/** The separator written between the parts of a merged note. */
export const NOTE_PART_SEPARATOR = '\n---\n';

/** Whitespace-insensitive form of a note part: trimmed, every run of spaces and line breaks one space. */
function normalizePart(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

/** The non-empty parts of a note, split on separator lines. */
function splitParts(note: string): string[] {
    return note
        .replace(/\r\n?/g, '\n')
        .split(/\n[ \t]*---[ \t]*\n/)
        .filter(part => normalizePart(part) !== '');
}

/**
 * Whether `needle` is said in `haystack` as whole words (both normalized):
 * "Farmer." inside "Born 1850. Farmer." is, "1" inside "1850" is not.
 */
function says(haystack: string, needle: string): boolean {
    return needle !== '' && ` ${haystack} `.includes(` ${needle} `);
}

/**
 * The merged note: the existing note plus the incoming parts it does not
 * already contain (whitespace ignored). An incoming part that contains a
 * whole existing part replaces it in place — the shorter text is in it, so
 * nothing is lost and nothing is said twice. Returns the existing note
 * unchanged (same string) when the incoming one adds nothing.
 */
export function mergeNoteText(existing: string | undefined, incoming: string | undefined): string | undefined {
    if (!incoming || normalizePart(incoming) === '') return existing;
    if (!existing || normalizePart(existing) === '') return incoming;

    const parts = splitParts(existing);
    let changed = false;
    for (const part of splitParts(incoming)) {
        const norm = normalizePart(part);
        const whole = normalizePart(parts.join(' '));
        if (says(whole, norm)) continue;
        // Existing parts the incoming one contains: the first is replaced
        // by it, the others are dropped (their text is in it as well).
        const contained = parts
            .map((p, i) => ({ i, norm: normalizePart(p) }))
            .filter(p => says(norm, p.norm))
            .map(p => p.i);
        if (contained.length > 0) {
            parts[contained[0]] = part;
            for (const i of contained.slice(1).reverse()) parts.splice(i, 1);
        } else {
            parts.push(part);
        }
        changed = true;
    }
    if (!changed) return existing;
    return parts.map(p => p.replace(/^\n+|\n+$/g, '')).join(NOTE_PART_SEPARATOR);
}
