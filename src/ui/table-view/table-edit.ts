/**
 * Table view (T54 F8): a cell edited in place, without the DOM.
 *
 * Only a cell that stands for one fact of the tree is edited there: the
 * first name (T54 G10), a surname, the sex and the reference number (chosen / typed), the date and
 * the place of a birth, a baptism, a death, a burial, the cause of death and
 * the age at death as recorded, an occupation (while the person has at most
 * one), and a union's own facts (the Unions table, a union's sub-row, a
 * person's row with one union): its type (chosen from the union form's
 * types), the wedding's date, place and each partner's recorded age, the
 * divorce's date and place (T54 G3). An empty cell there adds the fact the
 * way the union form adds it. A union without a wedding (partners, T54 G5)
 * has no wedding cell to edit. Computed cells, checks, the research,
 * citations, counts and relations are not: a double click there still opens
 * Edit….
 *
 * In the Events table a person's own event (not a birth, a death or a
 * wedding: those are the People and Unions tables' cells) has its date and
 * place edited in place; a shared event's row (spec 085) writes every copy,
 * a row guessed from identical copies of older data is not edited there.
 *
 * `editChangeOf` reads the field as the person dialog reads it (the same
 * `normalizeDateInput`, a place and a text trimmed) and says what changes:
 * the person's field, the first baptism or burial (its other fields and
 * citations kept; added when there is none), the occupation as the dialog's
 * quick field writes it, or the union. An empty field clears only that fact;
 * an unreadable date or a person left without any name saves nothing.
 */

import type { Gender, LifeEvent, PartnershipId, PartnershipStatus, PartnershipUpdates, Person, PersonId, StromData } from '../../types.js';
import { GENDERS } from '../../types.js';
import { formatDateForInput, normalizeDateInput } from '../../dates.js';
import { strings } from '../../strings.js';
import { unionPartners, unionWithoutWedding, type ColumnDef } from './table-columns.js';
import type { RowType, TableContext } from './table-model.js';
import type { GridLine } from './table-subrows.js';

/** The fact a cell edits. */
export type EditField =
    | 'firstName' | 'lastName' | 'marriedSurname'
    | 'birthDate' | 'birthPlace' | 'deathDate' | 'deathPlace'
    | 'baptismDate' | 'baptismPlace' | 'burialDate' | 'burialPlace'
    | 'occupation' | 'gender' | 'refn' | 'deathCause' | 'deathAge'
    | 'marriageDate' | 'marriagePlace' | 'marriageAge' | 'divorceDate' | 'divorcePlace' | 'unionStatus'
    | 'eventDate' | 'eventPlace';

/** The field's kind: a date is read as the dialog reads it, a place offers the tree's places, a choice offers its values. */
export type EditInput = 'text' | 'date' | 'place' | 'select';

export interface EditTarget {
    field: EditField;
    input: EditInput;
    /** The person whose fact it is (a union's fact: null). */
    personId: PersonId | null;
    /** The union whose fact it is (a person's fact: null). */
    unionId: PartnershipId | null;
    /** A recorded age at the wedding: whose it is. */
    agePersonId?: PersonId;
    /** An Events table's life event: which of the person's events (a shared one: the first copy). */
    eventId?: string;
}

/** The People table's columns that edit a fact of the person. */
const PERSON_FIELDS: Readonly<Record<string, EditField | ((p: Person) => EditField)>> = {
    firstName: 'firstName',
    // "Surname" shows the married surname when there is one, else the birth surname: it edits what it shows.
    surname: p => (p.marriedSurname?.trim() ? 'marriedSurname' : 'lastName'),
    birthSurname: 'lastName',
    marriedSurname: 'marriedSurname',
    bDate: 'birthDate', bPlace: 'birthPlace',
    bapDate: 'baptismDate', bapPlace: 'baptismPlace',
    dDate: 'deathDate', dPlace: 'deathPlace',
    burDate: 'burialDate', burPlace: 'burialPlace',
    occ: 'occupation',
    gender: 'gender', refn: 'refn',
    dCause: 'deathCause', dAgeRec: 'deathAge',
};

/** A union's columns (People: union-scoped; Unions); a recorded age names whose it is below. */
const UNION_FIELDS: Readonly<Record<string, EditField>> = {
    wDate: 'marriageDate', wPlace: 'marriagePlace',
    wAgeRec: 'marriageAge', pAgeRec: 'marriageAge', rec1: 'marriageAge', rec2: 'marriageAge',
    divDate: 'divorceDate', divPlace: 'divorcePlace',
    uStatus: 'unionStatus',
};

/** The wedding's facts: not edited in a union without a wedding (T54 G5). */
const WEDDING_FIELDS: ReadonlySet<EditField> = new Set(['marriageDate', 'marriagePlace', 'marriageAge']);

const DATE_FIELDS: ReadonlySet<EditField> = new Set(['birthDate', 'deathDate', 'baptismDate', 'burialDate', 'marriageDate', 'divorceDate', 'eventDate']);
const PLACE_FIELDS: ReadonlySet<EditField> = new Set(['birthPlace', 'deathPlace', 'baptismPlace', 'burialPlace', 'marriagePlace', 'divorcePlace', 'eventPlace']);
const SELECT_FIELDS: ReadonlySet<EditField> = new Set(['gender', 'unionStatus']);

/** The union form's types, in its order (relationships panel). */
const UNION_STATUSES: readonly PartnershipStatus[] = ['married', 'partners', 'divorced', 'separated'];

function inputOf(field: EditField): EditInput {
    return DATE_FIELDS.has(field) ? 'date' : PLACE_FIELDS.has(field) ? 'place' : SELECT_FIELDS.has(field) ? 'select' : 'text';
}

/** A choice's values with their words, in the person dialog's and the union form's order; null: not a choice. */
export function editOptionsOf(t: EditTarget): { value: string; label: string }[] | null {
    if (t.field === 'gender') return GENDERS.map(g => ({ value: g, label: strings.gender[g] }));
    if (t.field === 'unionStatus') return UNION_STATUSES.map(v => ({ value: v, label: strings.partnershipStatus[v] }));
    return null;
}

/** The person's occupations with a value (the cell lists them; the dialog's quick field edits the newest). */
function occupations(p: Person): LifeEvent[] {
    return (p.events ?? []).filter(e => e.type === 'occupation' && e.note?.trim());
}

const lifeEventOf = (p: Person, t: EditTarget): LifeEvent | undefined => (t.eventId ? (p.events ?? []).find(e => e.id === t.eventId) : undefined);

const firstEvent = (p: Person, type: 'baptism' | 'burial'): LifeEvent | undefined => (p.events ?? []).find(e => e.type === type);

/**
 * The fact a cell edits; null: the cell is not edited in place. `ctx` puts
 * the Unions table's partners in the order its columns show them (Partner 1:
 * the home person's blood relative); without it, the row's own order.
 */
export function editTargetOf(type: RowType, line: GridLine, col: ColumnDef, ctx?: TableContext): EditTarget | null {
    if (line.kind === 'more') return null;
    const row = line.row;
    if (type === 'unions') {
        const field = UNION_FIELDS[col.id];
        if (row.kind !== 'union' || !field || (field === 'marriageAge' && col.id !== 'rec1' && col.id !== 'rec2')) return null;
        if (WEDDING_FIELDS.has(field) && unionWithoutWedding(row.union)) return null;
        const t: EditTarget = { field, input: inputOf(field), personId: null, unionId: row.id };
        if (field !== 'marriageAge') return t;
        const { p1, p2 } = ctx ? unionPartners(ctx, row) : row;
        const who = col.id === 'rec1' ? p1 : p2;
        return who ? { ...t, agePersonId: who.id } : null;
    }
    if (type === 'events') {
        if (row.kind !== 'event' || row.source !== 'life' || !row.refs.length) return null;
        // Copies matched by their content only (older data) are not one event: each is edited in its dialog.
        if (row.refs.length > 1 && !row.shareId) return null;
        const field: EditField | null = col.id === 'evDate' ? 'eventDate' : col.id === 'evPlace' ? 'eventPlace' : null;
        if (!field) return null;
        const ref = row.refs[0];
        return { field, input: inputOf(field), personId: ref.personId, unionId: null, eventId: ref.eventId };
    }
    if (type !== 'persons' || row.kind !== 'person') return null;
    const unionField = col.unionScoped ? UNION_FIELDS[col.id] : undefined;
    if (unionField) {
        if (unionField === 'marriageAge' && col.id !== 'wAgeRec' && col.id !== 'pAgeRec') return null;
        // A sub-row is its union; a person's row only when the person has that one union.
        const union = line.kind === 'sub' ? row.unions[line.union] : row.unions.length === 1 && line.union === 0 ? row.unions[0] : undefined;
        if (!union || (WEDDING_FIELDS.has(unionField) && unionWithoutWedding(union))) return null;
        const t: EditTarget = { field: unionField, input: inputOf(unionField), personId: null, unionId: union.id };
        if (unionField !== 'marriageAge') return t;
        const agePersonId = col.id === 'wAgeRec' ? row.id : union.person1Id === row.id ? union.person2Id : union.person1Id;
        return { ...t, agePersonId };
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
        if (!u) return '';
        switch (t.field) {
            case 'marriageDate': return u.startDate ?? '';
            case 'marriagePlace': return u.startPlace ?? '';
            case 'marriageAge': return (t.agePersonId ? u.ages?.[t.agePersonId] : undefined) ?? '';
            case 'divorceDate': return u.endDate ?? '';
            case 'divorcePlace': return u.endPlace ?? '';
            case 'unionStatus': return u.status || 'married';
            default: return '';
        }
    }
    const p = t.personId ? data.persons[t.personId] : undefined;
    if (!p) return '';
    switch (t.field) {
        case 'firstName': return p.firstName ?? '';
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
        case 'gender': return p.gender || 'unknown';
        case 'refn': return p.refn ?? '';
        case 'deathCause': return p.deathCause ?? '';
        case 'deathAge': return p.deathAge ?? '';
        case 'eventDate': return lifeEventOf(p, t)?.date ?? '';
        case 'eventPlace': return lifeEventOf(p, t)?.place ?? '';
        default: return '';
    }
}

/** The field's text when the editor opens: a date in the form the dialog shows it (15.5.1880), a choice its value, else the stored text. */
export function editValueOf(data: StromData, t: EditTarget): string {
    const v = storedOf(data, t);
    return t.input === 'date' ? formatDateForInput(v || undefined) : v.trim();
}

/** What a save changes, through the same calls as the person dialog and the relationships panel. */
export type EditChange =
    | { kind: 'person'; personId: PersonId; updates: Partial<Person> }
    | { kind: 'event'; personId: PersonId; type: 'baptism' | 'burial'; eventId: string | null; updates: Partial<Omit<LifeEvent, 'id'>> }
    | { kind: 'occupation'; personId: PersonId; value: string }
    /** An Events table's life event: one common field, written to every copy of a shared event. */
    | { kind: 'lifeEvent'; personId: PersonId; eventId: string; field: 'date' | 'place'; value: string | undefined }
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
    // A choice takes one of its values only.
    if (t.input === 'select' && !editOptionsOf(t)?.some(o => o.value === value)) return { ok: true, change: null };
    if (value === storedOf(data, t).trim()) return { ok: true, change: null };

    if (t.unionId) {
        // As the union form writes them: an empty cell adds the fact, an emptied one clears it alone.
        let updates: PartnershipUpdates;
        switch (t.field) {
            case 'marriageDate': updates = { startDate: value }; break;
            case 'marriagePlace': updates = { startPlace: value }; break;
            case 'marriageAge':
                if (!t.agePersonId) return { ok: true, change: null };
                updates = { ages: { [t.agePersonId]: value } }; break;
            case 'divorceDate': updates = { endDate: value }; break;
            case 'divorcePlace': updates = { endPlace: value }; break;
            case 'unionStatus': updates = { status: value as PartnershipStatus }; break;
            default: return { ok: true, change: null };
        }
        return { ok: true, change: { kind: 'union', unionId: t.unionId, updates } };
    }
    const p = t.personId ? data.persons[t.personId] : undefined;
    if (!p) return { ok: true, change: null };
    const personId = p.id;
    switch (t.field) {
        case 'firstName':
            // As the dialog: a person keeps a first name or a surname (a placeholder may have none).
            if (!value && !p.lastName?.trim() && !p.isPlaceholder) return { ok: false, error: 'name' };
            return { ok: true, change: { kind: 'person', personId, updates: { firstName: value } } };
        case 'lastName':
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
        case 'gender': return { ok: true, change: { kind: 'person', personId, updates: { gender: value as Gender } } };
        case 'refn': return { ok: true, change: { kind: 'person', personId, updates: { refn: value } } };
        case 'deathCause': return { ok: true, change: { kind: 'person', personId, updates: { deathCause: value } } };
        case 'deathAge': return { ok: true, change: { kind: 'person', personId, updates: { deathAge: value } } };
        case 'eventDate': case 'eventPlace':
            if (!t.eventId || !lifeEventOf(p, t)) return { ok: true, change: null };
            return { ok: true, change: { kind: 'lifeEvent', personId, eventId: t.eventId, field: t.field === 'eventDate' ? 'date' : 'place', value: value || undefined } };
        default: return { ok: true, change: null };
    }
}
