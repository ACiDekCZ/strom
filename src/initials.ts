/**
 * Avatar monogram helper — the single source of truth for the two-letter
 * initials shown in round avatars (on-screen cards, the person modal header,
 * the printable family book and the SVG poster export).
 *
 * It takes the first letter of the first two "real" name words, skipping
 * nobiliary particles / prepositions ("of", "von", "van der", "de", "di"…)
 * and generational roman-numeral suffixes ("IV", "VII"…). The result is
 * uppercased. Language-neutral: the particle list covers a broad international
 * set so the app works the same for any culture.
 */

/**
 * Lowercase nobiliary particles and prepositions that should not become an
 * initial. Multi-word particles (e.g. "van der") are covered word-by-word.
 */
const NAME_PARTICLES = new Set<string>([
    'of', 'the',
    'von', 'van', 'der', 'den', 'ter', 'te',
    'de', 'del', 'della', 'di', 'da', 'do', 'dos', 'das', 'du',
    'la', 'le', 'lo', 'li',
    'af', 'av',
    'y', 'e',
    'bin', 'ibn', 'al', 'el',
    'san', 'santa', 'st', 'st.',
    'mac', 'mc', "o'",
]);

/** True when `token` is a roman-numeral generational suffix (I, IV, VII…). */
function isRomanNumeral(token: string): boolean {
    // Only uppercase, letter-only tokens qualify — this matches the genealogical
    // convention ("Henry VII") and avoids misreading ordinary words.
    if (token !== token.toUpperCase()) return false;
    return /^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(token) && token.length > 0;
}

/** True when `token` is a particle that should be skipped when picking initials. */
function isParticle(token: string): boolean {
    // Only treat a token as a particle when it is written in lowercase in the
    // original, so a legitimately capitalized surname is never dropped.
    return token === token.toLowerCase() && NAME_PARTICLES.has(token.toLowerCase());
}

/**
 * Compose the two-letter avatar monogram from a first and last name.
 * Returns an uppercased string of at most two letters (may be shorter for a
 * single-word name, or empty when there is no usable letter — callers apply
 * their own fallback, e.g. "?").
 */
export function personInitials(firstName?: string, lastName?: string): string {
    const words = `${firstName ?? ''} ${lastName ?? ''}`
        .split(/\s+/)
        .filter(w => w.length > 0 && !isParticle(w) && !isRomanNumeral(w));
    const letters = words
        .map(w => [...w][0] ?? '')
        .filter(ch => ch.length > 0)
        .slice(0, 2);
    return letters.join('').toUpperCase();
}
