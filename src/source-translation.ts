/**
 * The translation of a source's transcript, as the research writes it into the
 * source's note: a paragraph that opens with its label on a line of its own
 * ("Translation:", in the research tree's language), the translated text on the
 * lines after it. The research writes it as the note's last section, so the
 * translation runs to the end of the note (its own blank lines included).
 *
 * Recognised at display time only: the stored note stays exactly as it is
 * (the note editor shows it raw, exports and round trips are unchanged).
 */

/** The research's GEDCOM labels of the section (en, cs, de, pl; other research languages write the English one). */
export const SOURCE_TRANSLATION_LABELS = ['Translation', 'Překlad', 'Übersetzung', 'Tłumaczenie'] as const;

const HEADER = new RegExp(`(^|\\n[ \\t]*\\n)(?:${SOURCE_TRANSLATION_LABELS.join('|')}):\\n`);

export interface SourceNoteParts {
    /** The note without the translation section (the whole note when there is none). */
    note: string;
    /** The translated text; undefined when the note carries no translation section. */
    translation?: string;
}

/** Split a source's note into the translation section and the rest. */
export function splitSourceTranslation(note: string | undefined): SourceNoteParts {
    const raw = note ?? '';
    const text = raw.replace(/\r\n?/g, '\n').normalize('NFC');
    const m = HEADER.exec(text);
    if (!m) return { note: raw };
    const translation = text.slice(m.index + m[0].length).replace(/^\n+/, '').trimEnd();
    if (!translation.trim()) return { note: raw };
    return { note: text.slice(0, m.index).trimEnd(), translation };
}

/** The translation of a source's transcript, if its note carries one. */
export function sourceTranslation(note: string | undefined): string | undefined {
    return splitSourceTranslation(note).translation;
}
