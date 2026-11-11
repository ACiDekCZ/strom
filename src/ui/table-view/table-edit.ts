/**
 * Table view (T54 F8): a cell edited in place, without the DOM.
 *
 * Only a cell that stands for one fact of the tree is edited there: a
 * surname, the date and the place of a birth, a baptism, a death, a burial,
 * an occupation (while the person has at most one), and a wedding's date and
 * place (the Unions table, a union's sub-row, a person's row with one union).
 * Computed cells, checks, the research, citations, counts and relations are
 * not: a double click there still opens Edit….
 *
 * `editChangeOf` reads the field as the person dialog reads it (the same
 * `normalizeDateInput`, a place and a text trimmed) and says what changes:
 * the person's field, the first baptism or burial (its other fields and
 * citations kept; added when there is none), the occupation as the dialog's
 * quick field writes it, or the union. An empty field clears only that fact;
 * an unreadable date or a person left without any name saves nothing.
 */

import type { LifeEvent, PartnershipId, PartnershipUpdates, Person, PersonId, StromData } from '../../types.js';
import { formatDateForInput, normalizeDateInput } from '../../dates.js';
import type { ColumnDef } from './table-columns.js';
import type { RowType } from './table-model.js';
import type { GridLine } from './table-subrows.js';

/** The fact a cell edits. */
export type EditField =
    | 'lastName' | 'marriedSurname'
    | 'birthDate' | 'birthPlace' | 'deathDate' | 'deathPlace'
    | 'baptismDate' | 'baptismPlace' | 'burialDate' | 'burialPlace'
    | 'occupation' | 'marriageDate' | 'marriagePlace';

/** The field's kind: a date is read as the dialog reads it, a place offers the tree's places. */
export type EditInput = 'text' | 'date' | 'place';

export interface EditTarget {
    field: EditField;
    input: EditInput;
    /** The person whose fact it is (a union's fact: null). */
    personId: PersonId | null;
    /** The union whose fact it is (a person's fact: null). */
    unionId: PartnershipId | null;
}

/** The People table's columns that edit a fact of the person. */
const PERSON_FIELDS: Readonly<Record<string, EditField | ((p: Person) => EditField)>> = {
    // "Surname" shows the married surname when there is one, else the birth surname: it edits what it shows.
    surname: p => (p.marriedSurname?.trim() ? 'marriedSurname' : 'lastName'),
    birthSurname: 'lastName',
    marriedSurname: 'marriedSurname',
    bDate: 'birthDate', bPlace: 'birthPlace',
    bapDate: 'baptismDate', bapPlace: 'baptismPlace',
    dDate: 'deathDate', dPlace: 'deathPlace',
    burDate: 'burialDate', burPlace: 'burialPlace',
    occ: 'occupation',
};

/** The wedding's columns (People: union-scoped; Unions). */
const UNION_FIELDS: Readonly<Record<string, EditField>> = { wDate: 'marriageDate', wPlace: 'marriagePlace' };

const DATE_FIELDS: ReadonlySet<EditField> = new Set(['birthDate', 'deathDate', 'baptismDate', 'burialDate', 'marriageDate']);
const PLACE_FIELDS: ReadonlySet<EditField> = new Set(['birthPlace', 'deathPlace', 'baptismPlace', 'burialPlace', 'marriagePlace']);

function inputOf(field: EditField): EditInput {
    return DATE_FIELDS.has(field) ? 'date' : PLACE_FIELDS.has(field) ? 'place' : 'text';
}

/** The person's occupations with a value (the cell lists them; the dialog's quick field edits the newest). */
function occupations(p: Person): LifeEvent[] {
    return (p.events ?? []).filter(e => e.type === 'occupation' && e.note?.trim());
}

const firstEvent = (p: Person, type: 'baptism' | 'burial'): LifeEvent | undefined => (p.events ?? []).find(e => e.type === type);

/** The fact a cell edits; null: the cell is not edited in place. */
export function editTargetOf(type: RowType, line: GridLine, col: ColumnDef): EditTarget | null {
    if (line.kind === 'more') return null;
    const row = line.row;
    if (type === 'unions') {
        const field = UNION_FIELDS[col.id];
        return row.kind === 'union' && field ? { field, input: inputOf(field), personId: null, unionId: row.id } : null;
    }
    if (type !== 'persons' || row.kind !== 'person') return null;
    const unionField = col.unionScoped ? UNION_FIELDS[col.id] : undefined;
    if (unionField) {
        // A sub-row is its union; a person's row only when the person has that one union.
        const union = line.kind === 'sub' ? row.unions[line.union] : row.unions.length === 1 && line.union === 0 ? row.unions[0] : undefined;
        return union ? { field: unionField, input: inputOf(unionField), personId: null, unionId: union.id } : null;
    }
    if (line.kind === 'sub' || col.unionScoped) return null;
    const pick = PERSON_FIELDS[col.id];
    if (!pick) return null;
    const field = typeof pick === 'function' ? pick(row.person) : pick;
    // Several occupations are a history: one cell cannot say which of them it edits.
    if (field === 'occupation' && occupations(row.person).length > 1) return null;
    return { field, input: inputOf(field), personId: row.id, unionId: null };
}

/** The stored value of a target's fact (a date as canonical text); '' for none. */
function storedOf(data: StromData, t: EditTarget): string {
    if (t.unionId) {
        const u = data.partnerships[t.unionId];
        return (t.field === 'marriageDate' ? u?.startDate : u?.startPlace) ?? '';
    }
    const p = t.personId ? data.persons[t.personId] : undefined;
    if (!p) return '';
    switch (t.field) {
        case 'lastName': return p.lastName ?? '';
        case 'marriedSurname': return p.marriedSurname ?? '';
        case 'birthDate': return p.birthDate ?? '';
        case 'birthPlace': return p.birthPlace ?? '';
        case 'deathDate': return p.deathDate ?? '';
        case 'deathPlace': return p.deathPlace ?? '';
        case 'baptismDate': return firstEvent(p, 'baptism')?.date ?? '';
        case 'baptismPlace': return firstEvent(p, 'baptism')?.place ?? '';
        case 'burialDate': return firstEvent(p, 'burial')?.date ?? '';
        case 'burialPlace': return firstEvent(p, 'burial')?.place ?? '';
        case 'occupation': return occupations(p)[0]?.note ?? '';
        default: return '';
    }
}

/** The field's text when the editor opens: a date in the form the dialog shows it (15.5.1880), else the stored text. */
export function editValueOf(data: StromData, t: EditTarget): string {
    const v = storedOf(data, t);
    return t.input === 'date' ? formatDateForInput(v || undefined) : v.trim();
}

/** What a save changes, through the same calls as the person dialog and the relationships panel. */
export type EditChange =
    | { kind: 'person'; personId: PersonId; updates: Partial<Person> }
    | { kind: 'event'; personId: PersonId; type: 'baptism' | 'burial'; eventId: string | null; updates: Partial<Omit<LifeEvent, 'id'>> }
    | { kind: 'occupation'; personId: PersonId; value: string }
    | { kind: 'union'; unionId: PartnershipId; updates: PartnershipUpdates };

/** A save: the change (null: nothing changed), or what stops it. */
export type EditResult = { ok: true; change: EditChange | null } | { ok: false; error: 'date' | 'name' };

/**
 * The field's text as a change of the tree. A date is read by
 * `normalizeDateInput` (`lang`: the UI language when left out), unreadable
 * → `date`; a place and a text are trimmed. The same value as stored: no change.
 */
export function editChangeOf(data: StromData, t: EditTarget, text: string, lang?: 'cs' | 'en' | 'de' | 'pl'): EditResult {
    let value: string;
    if (t.input === 'date') {
        const read = normalizeDateInput(text, lang);
        if (read === null) return { ok: false, error: 'date' };
        value = read;
    } else value = text.trim();
    if (value === storedOf(data, t).trim()) return { ok: true, change: null };

    if (t.unionId) {
        const updates: PartnershipUpdates = t.field === 'marriageDate' ? { startDate: value } : { startPlace: value };
        return { ok: true, change: { kind: 'union', unionId: t.unionId, updates } };
    }
    const p = t.personId ? data.persons[t.personId] : undefined;
    if (!p) return { ok: true, change: null };
    const personId = p.id;
    switch (t.field) {
        case 'lastName':
            // As the dialog: a person keeps a first name or a surname (a placeholder may have none).
            if (!value && !p.firstName?.trim() && !p.isPlaceholder) return { ok: false, error: 'name' };
            return { ok: true, change: { kind: 'person', personId, updates: { lastName: value } } };
        case 'marriedSurname':
            return { ok: true, change: { kind: 'person', personId, updates: { marriedSurname: value } } };
        case 'birthDate': return { ok: true, change: { kind: 'person', personId, updates: { birthDate: value } } };
        case 'birthPlace': return { ok: true, change: { kind: 'person', personId, updates: { birthPlace: value } } };
        case 'deathDate':
            // As the dialog: a death date says the person died, so the explicit "deceased" goes with it.
            return { ok: true, change: { kind: 'person', personId, updates: value ? { deathDate: value, isDeceased: undefined } : { deathDate: value } } };
        case 'deathPlace': return { ok: true, change: { kind: 'person', personId, updates: { deathPlace: value } } };
        case 'baptismDate': case 'baptismPlace': case 'burialDate': case 'burialPlace': {
            const type = t.field.startsWith('baptism') ? 'baptism' : 'burial';
            const key = t.field.endsWith('Date') ? 'date' : 'place';
            const ev = firstEvent(p, type);
            // No event yet: an empty field adds none; else the event is added with this one fact.
            if (!ev) return { ok: true, change: value ? { kind: 'event', personId, type, eventId: null, updates: { type, [key]: value } } : null };
            // The event stays (its other fields, citations, participants); an emptied fact goes from it.
            return { ok: true, change: { kind: 'event', personId, type, eventId: ev.id, updates: { [key]: value || undefined } } };
        }
        case 'occupation': return { ok: true, change: { kind: 'occupation', personId, value } };
        default: return { ok: true, change: null };
    }
}
