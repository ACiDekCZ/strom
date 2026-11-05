/** Letters with a stroke that NFD does not split, and their base letter (1102). */
const STROKED_BASE: Record<string, string> = { 'Ł': 'L', 'Ø': 'O', 'Đ': 'D' };

/**
 * The index letter of a text that starts with a letter (§3.5): Czech "Ch" is a
 * letter of its own (after H); a letter the language does not tell from its
 * base letter goes with it (Á with A in Czech, Ä with A in German), one that
 * it does stays apart (Č, Ř, Š in Czech; Ł in Polish).
 */
export function letterAtStart(t: string, lang: string): string {
    if (lang === 'cs' && /^ch/i.test(t)) return 'Ch';
    const ch = Array.from(t.normalize('NFC'))[0].toLocaleUpperCase(lang);
    const stroked = STROKED_BASE[ch];
    if (stroked) return lang === 'pl' && ch === 'Ł' ? ch : stroked;
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
    return base && base !== ch && new Intl.Collator(lang, { sensitivity: 'base' }).compare(ch, base) === 0 ? base : ch;
}
