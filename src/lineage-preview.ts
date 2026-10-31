/**
 * The sentences of a lineage change's preview (package 1031 §2.2, "What will
 * change"): `previewOverride` (src/lineage.ts) says what a change does, this
 * puts it into words of the UI language. Names always in the nominative, as
 * the person is written; a person's year in brackets when the line knows it.
 */

import type { PreviewLine } from './lineage.js';
import type { Person, PersonId, StromData } from './types.js';
import { strings, getCurrentLanguage, joinAnd } from './strings.js';

/** How many names a list of people spells out before "and N more". */
export const PREVIEW_NAMES_SHOWN = 3;

/**
 * The preview's sentences, one per line. `nameOf` gives a person's name as
 * the app shows it (the UI passes shownName).
 */
export function lineagePreviewTexts(lines: readonly PreviewLine[], data: StromData, nameOf: (p: Person) => string): string[] {
    const t = strings.lineage.preview;
    const lang = getCurrentLanguage();
    const name = (id: PersonId): string => {
        const p = data.persons[id];
        return p ? nameOf(p) : '?';
    };
    const who = (id: PersonId, year: number | null): string => year != null ? `${name(id)} (${year})` : name(id);
    const names = (ids: readonly PersonId[]): string => {
        const shown = ids.slice(0, ids.length > PREVIEW_NAMES_SHOWN + 1 ? PREVIEW_NAMES_SHOWN : ids.length).map(name);
        const rest = ids.length - shown.length;
        return joinAnd(lang, rest > 0 ? [...shown, t.more(rest)] : shown);
    };
    const out: string[] = [];
    for (const line of lines) {
        switch (line.kind) {
            case 'startsWith': out.push(t.startsWith(who(line.personId, line.year), line.members, line.spouses)); break;
            case 'toSmall': out.push(t.toSmall(names(line.personIds), line.personIds.length)); break;
            case 'becomeRod': out.push(t.becomeRod(names(line.personIds), line.personIds.length, line.label)); break;
            case 'ownLine': out.push(t.ownLine(who(line.personId, line.year), line.label, line.members, line.spouses)); break;
            case 'wholeTreeKeeps': out.push(t.wholeTreeKeeps); break;
            case 'newRod': out.push(t.newRod(line.label, who(line.personId, line.year), line.members, line.spouses)); break;
            case 'splitMoves': out.push(t.splitMoves(name(line.personId), data.persons[line.personId]?.gender ?? 'unknown', line.label, line.members, line.spouses)); break;
            case 'merge': out.push(t.merge(line.label, line.otherLabel, line.members, line.otherMembers)); break;
            case 'staySeparate': out.push(t.staySeparate); break;
            case 'formWholeTree': out.push(t.formWholeTree); break;
            case 'splitByForm': {
                const from = line.year != null ? `${name(line.personId)}, ${line.year}` : name(line.personId);
                out.push(t.splitByForm(line.label, line.before, line.after, line.newLabel, from, line.members));
                break;
            }
            case 'groupGone': out.push(t.groupGone(line.forms.join(' · '))); break;
            case 'linkedByRelation': out.push(t.linkedByRelation); break;
            case 'restored': out.push(t.restored(line.label, line.members, line.spouses)); break;
            case 'noChange': out.push(t.noChange); break;
        }
    }
    return out;
}
