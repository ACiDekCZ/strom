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
