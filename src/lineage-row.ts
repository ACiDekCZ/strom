/**
 * The "Family line" row of the person card and the person page (spec 1031
 * §3): the value as text pieces and lineage names, in the page's language.
 * What the row says comes from `personRodRow` (src/lineage.ts); this module
 * only words it.
 */

import { LineageIndex, PersonRodRow, RodId, personRodRow } from './lineage.js';
import { PersonId } from './types.js';
import { Language, getStringsForLang } from './strings.js';
import type { PrivacyMode } from './privacy.js';

/** A piece of the row: joining text, or a lineage's name (a link where links are drawn). */
export type RodRowPart = { text: string } | { rodId: RodId; label: string };

export interface RodRowValue {
    row: PersonRodRow;
    /** The row's label: "Rod" / "Family line" / "Stammlinie". */
    label: string;
    parts: RodRowPart[];
}

/** A template with {rod} or {rods} filled by lineage names (a list joined by commas). */
function fill(template: string, ids: readonly RodId[], labels: ReadonlyMap<RodId, string>): RodRowPart[] {
    const m = /\{rods?\}/.exec(template);
    if (!m) return [{ text: template }];
    const out: RodRowPart[] = [];
    const before = template.slice(0, m.index);
    const after = template.slice(m.index + m[0].length);
    if (before) out.push({ text: before });
    ids.forEach((id, i) => {
        if (i > 0) out.push({ text: ', ' });
        out.push({ rodId: id, label: labels.get(id) ?? '' });
    });
    if (after) out.push({ text: after });
    return out;
}

/** The value of a person's row in a language, or null when the person has no row. */
export function personRodRowValue(
    index: LineageIndex, labels: ReadonlyMap<RodId, string>, personId: PersonId, lang: Language,
): RodRowValue | null {
    const row = personRodRow(index, personId);
    if (!row) return null;
    const S = getStringsForLang(lang).lineage;
    const gender = index.data.persons[personId]?.gender ?? 'unknown';
    const parts: RodRowPart[] = [];
    if (row.kind === 'member') {
        parts.push({ rodId: row.rodId, label: labels.get(row.rodId) ?? '' });
        if (row.marriedInto.length) {
            parts.push({ text: ' ' }, ...fill(S.row.marriedInto(gender, row.marriedInto.length), row.marriedInto, labels));
        }
    } else {
        parts.push(...fill(S.row.spouseIn(gender), [row.rodId], labels));
        if (row.birthRodId) parts.push({ text: ' ' }, ...fill(S.row.bornInto, [row.birthRodId], labels));
    }
    return { row, label: S.label, parts };
}

/** The row as plain text (a saved file, print, a tooltip). */
export function rodRowText(parts: readonly RodRowPart[]): string {
    return parts.map(p => ('text' in p ? p.text : p.label)).join('');
}

/**
 * Is the row drawn for a person under a privacy of living people (§3.4)? A
 * lineage's name is a surname: full data and "surname only" keep it, initials
 * and hidden names would give away more than they show. The dead always.
 */
export function rodRowShown(privacy: PrivacyMode, living: boolean): boolean {
    return !living || privacy === 'full' || privacy === 'minimal';
}
