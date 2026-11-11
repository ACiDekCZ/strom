/**
 * Cut a text to at most `max` UTF-16 units without tearing a character apart:
 * an emoji outside the BMP is a surrogate pair, and its first half alone is
 * sent as U+FFFD. A pair that does not fit is left out whole.
 */
export function clipText(text: string, max: number): string {
    if (text.length <= max) return text;
    const unit = text.charCodeAt(max - 1);
    return text.slice(0, unit >= 0xd800 && unit <= 0xdbff ? max - 1 : max);
}

type GraphemeSegmenter = { segment(text: string): Iterable<{ segment: string }> };
let segmenter: GraphemeSegmenter | null | undefined;

/** The text's characters as a person sees them (an accent, an emoji, a flag one each). */
export function graphemes(text: string): string[] {
    if (segmenter === undefined) {
        const S = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => GraphemeSegmenter }).Segmenter;
        segmenter = S ? new S(undefined, { granularity: 'grapheme' }) : null;
    }
    if (segmenter) return Array.from(segmenter.segment(text), g => g.segment);
    // Without Intl.Segmenter: code points, a combining mark or a joiner kept with the character before it.
    const out: string[] = [];
    for (const ch of text) {
        if (out.length && /^[\p{M}‍️]/u.test(ch)) out[out.length - 1] += ch;
        else if (out.length && out[out.length - 1]!.endsWith('‍')) out[out.length - 1] += ch;
        else out.push(ch);
    }
    return out;
}

/**
 * The text cut to at most `max` characters as a person sees them, its last
 * one "…" when it was longer; a character (an accent, an emoji, a flag, a CJK
 * ideograph) is never torn apart.
 */
export function clipWithEllipsis(text: string, max: number): string {
    const chars = graphemes(text);
    return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
}
