/**
 * Download file names.
 *
 * Tree names carry diacritics ("Rodina Fíšek", "Müller", "Łódź") and the
 * exports used to strip anything outside a-z0-9, which silently DELETED those
 * letters ("Fíšek" → "f-ek"). Every name therefore gets transliterated to
 * plain ASCII first and only then reduced to characters every file system and
 * download header accepts.
 */

/** Letters that carry no combining mark, so NFD alone cannot fold them. */
const STANDALONE: Record<string, string> = {
    'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'đ': 'd', 'ð': 'd',
    'þ': 'th', 'ł': 'l', 'ħ': 'h', 'ı': 'i', 'ŧ': 't', 'ŋ': 'n', 'ĸ': 'k',
};

/**
 * "Rodina Fíšek" → "rodina-fisek". Returns '' when nothing ASCII survives
 * (e.g. a purely Cyrillic or CJK name) — callers fall back to a default.
 */
export function asciiSlug(text: string): string {
    return text
        .toLowerCase()
        .replace(/[ßæœøđðþłħıŧŋĸ]/g, ch => STANDALONE[ch] ?? ch)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')   // drop the combining marks
        .replace(/[^a-z0-9]+/g, '-')       // everything else becomes a hyphen
        .replace(/^-+|-+$/g, '');
}

/**
 * File name stem for a downloaded export: `safeFileName(treeName, 'family-tree')`.
 */
export function safeFileName(name: string | null | undefined, fallback: string): string {
    return asciiSlug(name ?? '') || fallback;
}

/** Characters no file system takes in a name (Windows' list, '/' and '\' everywhere) and the control characters. */
const FORBIDDEN_IN_NAME = /[/\\:*?"<>|\u0000-\u001f\u007f]/g;

/**
 * A file or folder name that keeps its letters (spec 093 §5: names in the
 * letter's language, UTF-8 in the archive): `/ \ : * ? " < > |` and control
 * characters become a hyphen, runs of spaces one space, no leading or
 * trailing space or dot (Windows drops a trailing dot). `fallback` when
 * nothing is left.
 */
export function unicodeFileName(name: string | null | undefined, fallback: string): string {
    const out = (name ?? '')
        .normalize('NFC')
        .replace(FORBIDDEN_IN_NAME, '-')
        .replace(/\s+/g, ' ')
        .replace(/^[\s.]+|[\s.]+$/g, '');
    return out || fallback;
}
