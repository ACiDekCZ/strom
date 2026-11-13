/**
 * Copies of a shared event that went apart (spec 085 §4, 4b–4g), without
 * the DOM: which copies differ from the rest, the finding's sentence, the
 * Unify dialog's choices (the majority value; on a tie the value of the
 * person it was opened from), "take everything from" a person, and the
 * values a choice writes. Built on `findDivergentShares`; the age, the role,
 * the research's status and the verification are never compared.
 */

import type { LifeEvent, PersonId, StromData } from './types.js';
import type { ShareCopyRef, ShareDivergence, ShareFieldDivergence, SharedEventCommon, SharedEventCommonField } from './shared-events.js';
import { SHARED_EVENT_COMMON_FIELDS } from './shared-events.js';
import { formatFlexDate } from './dates.js';
import { shownNameOrEmpty } from './person-name.js';
import { sharedEventTitle } from './shared-event-editor.js';
import { getStringsForLang, strings, type StringsType } from './strings.js';

type Lang = 'cs' | 'en' | 'de' | 'pl';

/** The texts of a language; the UI's when none is given. */
const S = (lang?: Lang): StringsType => (lang ? getStringsForLang(lang) : strings);

/** A copy's key in sets: person and event. */
const refKey = (r: ShareCopyRef): string => `${r.personId}\u0000${r.eventId}`;

/** The copies that are not on the leading value of some field (the most copies; the first on a tie). */
export function divergentCopies(d: ShareDivergence): ShareCopyRef[] {
    const off = new Set<string>();
    for (const f of d.fields) for (const v of f.values.slice(1)) for (const c of v.copies) off.add(refKey(c));
    return d.copies.filter(c => off.has(refKey(c)));
}

/** The fields a copy differs from the leading value in. */
export function fieldsOfCopy(d: ShareDivergence, copy: ShareCopyRef): ShareFieldDivergence[] {
    const k = refKey(copy);
    return d.fields.filter(f => !f.values[0].copies.some(c => refKey(c) === k));
}

/** The index of the value a copy of `personId` has in a field; -1: no copy of that person. */
function valueOfPerson(f: ShareFieldDivergence, personId: PersonId | null | undefined): number {
    if (!personId) return -1;
    return f.values.findIndex(v => v.copies.some(c => c.personId === personId));
}

/**
 * The Unify dialog's choice per field (4d): the value most copies have; on a
 * tie at the top, the value of the person the dialog was opened from when it
 * is one of the tied, else the first of them.
 */
export function unifyDefaults(d: ShareDivergence, openerId?: PersonId | null): Map<SharedEventCommonField, number> {
    const out = new Map<SharedEventCommonField, number>();
    for (const f of d.fields) {
        const top = f.values[0].copies.length;
        const tied = f.values.map((v, i) => (v.copies.length === top ? i : -1)).filter(i => i >= 0);
        const mine = valueOfPerson(f, openerId);
        out.set(f.field, tied.length > 1 && tied.includes(mine) ? mine : 0);
    }
    return out;
}

/** "Take everything from" a person (4f): each field's value that person's copy has (a field they lack keeps `current`). */
export function takeAllFrom(d: ShareDivergence, personId: PersonId, current: ReadonlyMap<SharedEventCommonField, number>): Map<SharedEventCommonField, number> {
    const out = new Map(current);
    for (const f of d.fields) {
        const i = valueOfPerson(f, personId);
        if (i >= 0) out.set(f.field, i);
    }
    return out;
}

/** The common fields a choice writes to every copy (every differing field named, an empty value as undefined). */
export function unifyValues(d: ShareDivergence, choice: ReadonlyMap<SharedEventCommonField, number>): SharedEventCommon {
    const out: Record<string, unknown> = {};
    for (const f of d.fields) {
        const v = f.values[choice.get(f.field) ?? 0] ?? f.values[0];
        out[f.field] = v.value === undefined || v.value === null ? undefined : structuredClone(v.value);
    }
    return out as SharedEventCommon;
}

/** The common fields in which every copy agrees (the dialog's "Same: …" line). */
export function sameFields(d: ShareDivergence): SharedEventCommonField[] {
    const differ = new Set(d.fields.map(f => f.field));
    // A label only matters for a custom event; quality only with sources.
    return SHARED_EVENT_COMMON_FIELDS.filter(f => !differ.has(f) && f !== 'customLabel' && f !== 'citationQuay');
}

/** The leading copy's event (the dialog's and the finding's title). */
export function leadEvent(data: StromData, d: ShareDivergence): LifeEvent | null {
    for (const c of d.copies) {
        const ev = data.persons[c.personId]?.events?.find(e => e.id === c.eventId);
        if (ev) return ev;
    }
    return null;
}

/** An event's title in messages ("Census 1921"; a custom event's label). */
export function divergenceTitle(data: StromData, d: ShareDivergence, lang?: Lang): string {
    const s = S(lang);
    const ev = leadEvent(data, d);
    if (!ev) return '';
    // The title from the leading values: a differing date or type shows the majority's.
    const lead = { type: ev.type, customLabel: ev.customLabel, date: ev.date };
    for (const f of d.fields) {
        if (f.field === 'type' || f.field === 'customLabel' || f.field === 'date') (lead as Record<string, unknown>)[f.field] = f.values[0].value;
    }
    return sharedEventTitle(lead, s.events.types[lead.type] ?? lead.type);
}

/** A field's value as the dialog and the finding show it; `(empty)` for none. */
export function fieldValueText(data: StromData, field: SharedEventCommonField, value: unknown, lang?: Lang): string {
    const s = S(lang);
    const empty = s.validation.unifyEmpty;
    switch (field) {
        case 'type': return typeof value === 'string' ? (s.events.types[value as LifeEvent['type']] ?? value) : empty;
        case 'date': return typeof value === 'string' && value.trim() ? formatFlexDate(value, lang) : empty;
        case 'sourceIds': {
            const ids = Array.isArray(value) ? [...new Set(value as string[])] : [];
            const titles = ids.map(id => data.sources?.[id]?.title?.trim() || data.sources?.[id]?.reference?.trim() || id);
            return titles.length ? titles.join(', ') : empty;
        }
        case 'citationQuay': {
            const q = (value as { sourceIds?: Record<string, number | null> } | undefined)?.sourceIds ?? {};
            const parts = Object.entries(q).map(([id, n]) => `${data.sources?.[id]?.title?.trim() || id}: ${n === null ? '–' : n}`);
            return parts.length ? parts.join(', ') : empty;
        }
        default: return typeof value === 'string' && value.trim() ? value.trim() : empty;
    }
}

/** The fields' words joined ("date, place"). */
export function fieldLabels(fields: readonly SharedEventCommonField[], lang?: Lang): string {
    const s = S(lang);
    return fields.map(f => s.validation.sharedFields[f]).join(', ');
}

/**
 * The finding's sentence (4c): one copy differing → "Census 1921 ·
 * Bohuchval Hurdálek: date differs (16 Feb 1921; others 15 Feb 1921).",
 * several → "Census 1921 · 2 copies differ: date, place."
 */
export function divergenceSentence(data: StromData, d: ShareDivergence, lang?: Lang): string {
    const s = S(lang);
    const title = divergenceTitle(data, d, lang);
    const off = divergentCopies(d);
    if (off.length === 1) {
        const copy = off[0];
        const fields = fieldsOfCopy(d, copy);
        const k = refKey(copy);
        const val = fields.map(f => fieldValueText(data, f.field, f.values.find(v => v.copies.some(c => refKey(c) === k))?.value, lang)).join(' · ');
        const other = fields.map(f => fieldValueText(data, f.field, f.values[0].value, lang)).join(' · ');
        const person = data.persons[copy.personId];
        return s.validation.sharedDiffersOne(title, person ? shownNameOrEmpty(person) : '', fieldLabels(fields.map(f => f.field), lang), val, other);
    }
    return s.validation.sharedDiffersMany(title, off.length, fieldLabels(d.fields.map(f => f.field), lang));
}

/** The persons of the differing copies, each once (the finding's people). */
export function divergentPersons(d: ShareDivergence): PersonId[] {
    return [...new Set(divergentCopies(d).map(c => c.personId))];
}

/** A field's word as a label at the start of a line ("Date"). */
function capital(text: string, lang?: Lang): string {
    return text ? text.charAt(0).toLocaleUpperCase(lang ?? undefined) + text.slice(1) : text;
}

/** The persons of some copies, each once, in their order. */
function personsOf(copies: readonly ShareCopyRef[]): PersonId[] {
    return [...new Set(copies.map(c => c.personId))];
}

/** Persons' shown names joined ("Kvido Hurdálek, Radegunda Hurdálková"). */
function namesOf(data: StromData, ids: readonly PersonId[]): string {
    return ids.map(id => { const p = data.persons[id]; return p ? shownNameOrEmpty(p) || id : id; }).join(', ');
}

/** One value a field can be unified to: its text and the persons whose copy has it. */
export interface UnifyOption {
    /** The value's index in the field's `values` (the choice). */
    index: number;
    text: string;
    personIds: PersonId[];
    names: string;
}

/** One field of the Unify dialog. */
export interface UnifyField {
    field: SharedEventCommonField;
    label: string;
    options: UnifyOption[];
}

/** The Unify dialog's content (4d–4f) without the DOM. */
export interface UnifyModel {
    title: string;
    lead: string;
    fields: UnifyField[];
    /** "Same: … Age, research status and verification …" under the fields. */
    same: string;
    /** "Take everything from:" (from three differing fields on): the persons to pick; null below that. */
    takeAll: { personId: PersonId; name: string }[] | null;
    /** The persons whose copies differ: "Separate the differing copy/copies (n)" takes theirs out. */
    separatePersons: PersonId[];
    separateLabel: string;
    /** The persons holding a copy (the Unify button's count). */
    persons: number;
    goLabel: string;
}

/** From this many differing fields on, the dialog offers "Take everything from" (4e). */
export const UNIFY_TAKE_ALL_FROM = 3;

/** The Unify dialog's content for a share whose copies differ. */
export function unifyModel(data: StromData, d: ShareDivergence, lang?: Lang): UnifyModel {
    const s = S(lang);
    const v = s.validation;
    const persons = personsOf(d.copies);
    const off = divergentPersons(d);
    const fields: UnifyField[] = d.fields.map(f => ({
        field: f.field,
        label: capital(v.sharedFields[f.field], lang),
        options: f.values.map((value, index) => {
            const ids = personsOf(value.copies);
            return { index, text: fieldValueText(data, f.field, value.value, lang), personIds: ids, names: namesOf(data, ids) };
        }),
    }));
    const same = sameFields(d);
    return {
        title: v.unifyTitle(divergenceTitle(data, d, lang)),
        lead: v.unifyLead(persons.length, off.length),
        fields,
        same: v.unifySame(same.length ? fieldLabels(same, lang) : '–'),
        takeAll: d.fields.length >= UNIFY_TAKE_ALL_FROM ? persons.map(id => ({ personId: id, name: namesOf(data, [id]) })) : null,
        separatePersons: off,
        separateLabel: off.length === 1 ? v.separateCopy : v.separateCopies(off.length),
        persons: persons.length,
        goLabel: v.unifyGo(persons.length),
    };
}

/**
 * The event editor's amber bar (4g) for the copy `viewer` opened: "Copy
 * differs: Zbyhněv Hurdálek (date 16 Feb 1921)." for one differing copy,
 * "Copies differ: …" with the names and the fields for several; `fields`
 * are those in which the viewer's own copy is not on the leading value
 * (their inputs get the amber frame).
 */
export function editorDivergence(data: StromData, d: ShareDivergence, viewer: ShareCopyRef, lang?: Lang): { text: string; fields: SharedEventCommonField[] } {
    const s = S(lang);
    const off = divergentCopies(d);
    let name: string;
    let what: string;
    if (off.length === 1) {
        const k = refKey(off[0]);
        name = namesOf(data, [off[0].personId]);
        what = fieldsOfCopy(d, off[0])
            .map(f => `${s.validation.sharedFields[f.field]} ${fieldValueText(data, f.field, f.values.find(x => x.copies.some(c => refKey(c) === k))?.value, lang)}`)
            .join(', ');
    } else {
        name = namesOf(data, personsOf(off));
        what = fieldLabels(d.fields.map(f => f.field), lang);
    }
    return { text: s.events.sharedDiffers(name, what), fields: fieldsOfCopy(d, viewer).map(f => f.field) };
}
