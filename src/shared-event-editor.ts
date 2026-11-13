/**
 * The event editor's "Shared with" section (spec 085 §1, §3), its pure part:
 * the draft of persons an event is shared with, the edit it saves
 * (DataManager.saveSharedEvent), the family offered in the person picker,
 * the event's short name in messages, and which message a save shows.
 *
 * The UI is src/ui/shared-event-ui.ts; the model is src/shared-events.ts.
 */

import { StromData, PersonId, LifeEvent, Person } from './types.js';
import { SharedEventCommon, SharedEventEdit, SharedEventOwn, SharedEventCommonField, applyEventFields, commonFieldKey } from './shared-events.js';
import { yearOf } from './dates.js';

/** One other person of the event in the editor. */
export interface SharedDraftRow {
    personId: PersonId;
    /** Their role in the event (`shareRole`): empty = household member. */
    role: string;
    /** Their age as recorded in the event (their own `age`). */
    age: string;
    /** Added in this editing, no copy yet. */
    added: boolean;
}

/** The persons of an edited event besides the one whose life it is opened from. */
export interface SharedDraft {
    viewerId: PersonId;
    rows: SharedDraftRow[];
    /** The persons who had a copy when the editor opened (the viewer left out). */
    originalOthers: PersonId[];
    /** Taken out with "Remove from the event" (their copy is deleted on save). */
    removed: PersonId[];
    /** Taken out with "Separate" (their copy stays, without the share). */
    separated: PersonId[];
}

/** The draft of an event as stored: the other copies' persons with their role and age. */
export function sharedDraftFor(data: StromData, viewerId: PersonId, event: LifeEvent | null): SharedDraft {
    const rows: SharedDraftRow[] = [];
    if (event?.shareId) {
        const seen = new Set<PersonId>([viewerId]);
        for (const pid of Object.keys(data.persons) as PersonId[]) {
            if (seen.has(pid)) continue;
            const copy = data.persons[pid]?.events?.find(e => e.shareId === event.shareId);
            if (!copy) continue;
            seen.add(pid);
            rows.push({ personId: pid, role: copy.shareRole ?? '', age: copy.age ?? '', added: false });
        }
    }
    return {
        viewerId, rows,
        originalOthers: rows.map(r => r.personId),
        removed: [], separated: [],
    };
}

/** Put the draft's rows in a given order of persons (the index's order of the share); the rest keep theirs after. */
export function orderDraftRows(draft: SharedDraft, order: readonly PersonId[]): void {
    const rank = new Map(order.map((pid, i) => [pid, i]));
    draft.rows.sort((a, b) => (rank.get(a.personId) ?? Infinity) - (rank.get(b.personId) ?? Infinity));
}

/**
 * Add persons to the draft (each once; one taken out in this editing comes
 * back with its values). `joining`: a person's own record of the same event
 * (ownSameEvent, spec 085 K1.6 a) that the save joins instead of a new copy;
 * the row starts with its age and role.
 */
export function addToDraft(draft: SharedDraft, personIds: readonly PersonId[], joining?: ReadonlyMap<PersonId, LifeEvent>): PersonId[] {
    const added: PersonId[] = [];
    for (const pid of personIds) {
        if (pid === draft.viewerId || draft.rows.some(r => r.personId === pid)) continue;
        const wasOriginal = draft.originalOthers.includes(pid);
        draft.removed = draft.removed.filter(p => p !== pid);
        draft.separated = draft.separated.filter(p => p !== pid);
        const own = wasOriginal ? undefined : joining?.get(pid);
        draft.rows.push({ personId: pid, role: own?.shareRole ?? '', age: own?.age ?? '', added: !wasOriginal });
        added.push(pid);
    }
    return added;
}

/** Take a person out of the draft: `separate` keeps their copy, otherwise it is deleted. */
export function takeFromDraft(draft: SharedDraft, personId: PersonId, separate: boolean): void {
    const row = draft.rows.find(r => r.personId === personId);
    if (!row) return;
    draft.rows = draft.rows.filter(r => r !== row);
    if (!draft.originalOthers.includes(personId)) return;   // added in this editing: simply gone
    if (separate) draft.separated.push(personId);
    else draft.removed.push(personId);
}

/**
 * The common fields the editor changed against the stored copy (spec 085
 * 4g): a field left as the copy has it is not written, so a value another
 * copy has otherwise stays until Unify or Separate.
 */
export function changedCommonFields(stored: LifeEvent, common: SharedEventCommon): SharedEventCommon {
    const after: LifeEvent = structuredClone(stored);
    applyEventFields(after, common);
    const out: SharedEventCommon = {};
    for (const key of Object.keys(common) as SharedEventCommonField[]) {
        if (commonFieldKey(after, key) !== commonFieldKey(stored, key)) (out as Record<string, unknown>)[key] = common[key];
    }
    return out;
}

/**
 * The edit DataManager.saveSharedEvent gets: common fields, each person's
 * own, who is added, removed, separated. With the `stored` copy of an event
 * shared already, only the common fields changed against it (changedCommonFields).
 */
export function sharedEditFrom(draft: SharedDraft, common: SharedEventCommon, viewerOwn: SharedEventOwn, stored?: LifeEvent | null): SharedEventEdit {
    if (stored?.shareId) common = changedCommonFields(stored, common);
    const own = new Map<PersonId, SharedEventOwn>();
    own.set(draft.viewerId, viewerOwn);
    for (const row of draft.rows) {
        own.set(row.personId, {
            age: row.age.trim() || undefined,
            shareRole: row.role.trim() || undefined,
        });
    }
    return {
        common, own,
        add: draft.rows.filter(r => r.added).map(r => r.personId),
        remove: [...draft.removed],
        separate: [...draft.separated],
    };
}

/** Whether the draft changes who the event is shared with. */
export function draftChangesPersons(draft: SharedDraft): boolean {
    return draft.removed.length > 0 || draft.separated.length > 0 || draft.rows.some(r => r.added);
}

/** The draft as one comparable string (the editor's "unsaved changes" question). */
export function draftState(draft: SharedDraft): string {
    return JSON.stringify([draft.rows.map(r => [r.personId, r.role.trim(), r.age.trim(), r.added]),
        draft.removed, draft.separated]);
}

/** Longest custom label a message carries before it is cut. */
export const SHARED_TITLE_MAX = 40;

/** An event's name in messages: the type and year ("Census 1921"), or a custom event's label (cut to 40 characters). */
export function sharedEventTitle(ev: Pick<LifeEvent, 'type' | 'customLabel' | 'date'>, typeName: string): string {
    if (ev.type === 'custom' && ev.customLabel?.trim()) {
        const label = ev.customLabel.trim();
        return label.length > SHARED_TITLE_MAX ? `${label.slice(0, SHARED_TITLE_MAX - 1).trimEnd()}…` : label;
    }
    const year = yearOf(ev.date);
    return year !== null ? `${typeName} ${year}` : typeName;
}

/** Which message a shared save shows (spec 085 §1i). */
export type SharedSaveMessage =
    | { kind: 'onlyOne'; personId: PersonId }
    | { kind: 'saved'; count: number }
    | { kind: 'nowN'; count: number }
    | { kind: 'separated'; personId: PersonId };

/**
 * The message after a save: one person left → "now only for …"; persons
 * added → "saved for N people"; persons removed → "now shared by N"; one
 * person separated alone → "the copy for … is now separate"; else "saved
 * for N people". `count` is the persons holding a copy after the save.
 */
export function sharedSaveMessage(draft: SharedDraft, personIds: readonly PersonId[]): SharedSaveMessage {
    const count = personIds.length;
    const changed = draftChangesPersons(draft);
    if (changed && count <= 1) return { kind: 'onlyOne', personId: personIds[0] ?? draft.viewerId };
    if (draft.rows.some(r => r.added)) return { kind: 'saved', count };
    if (draft.removed.length > 0) return { kind: 'nowN', count };
    if (draft.separated.length === 1) return { kind: 'separated', personId: draft.separated[0] };
    return { kind: 'saved', count };
}

/** A family member offered in the person picker. */
export interface FamilyCandidate {
    personId: PersonId;
    /** Spouse/partner, child, parent, sibling. */
    kin: 'partner' | 'child' | 'parent' | 'sibling';
}

/** The family a picker offers first: partners, children, parents, siblings; those not alive on the date apart. */
export interface FamilyCandidates {
    alive: FamilyCandidate[];
    /** Not alive on the event's date (only with a date; a year is compared when either date is partial). */
    hidden: FamilyCandidate[];
}

/**
 * Whether a person lived on a date, by years: born after the year or dead
 * before it is "not alive"; a missing date (or none of the event) counts as
 * alive. The same year counts as alive (a partial date cannot tell).
 */
export function aliveInYear(person: Pick<Person, 'birthDate' | 'deathDate'>, year: number | null): boolean {
    if (year === null) return true;
    const born = yearOf(person.birthDate);
    const died = yearOf(person.deathDate);
    if (born !== null && born > year) return false;
    if (died !== null && died < year) return false;
    return true;
}

/** The viewer's family for the picker: partners, children, parents, siblings, in that order, each once. */
export function familyCandidates(data: StromData, viewerId: PersonId, eventDate: string | undefined): FamilyCandidates {
    const viewer = data.persons[viewerId];
    const out: FamilyCandidates = { alive: [], hidden: [] };
    if (!viewer) return out;
    const seen = new Set<PersonId>([viewerId]);
    const year = yearOf(eventDate);
    const push = (pid: PersonId | undefined, kin: FamilyCandidate['kin']) => {
        if (!pid || seen.has(pid)) return;
        const p = data.persons[pid];
        if (!p || p.isPlaceholder) return;
        seen.add(pid);
        (aliveInYear(p, year) ? out.alive : out.hidden).push({ personId: pid, kin });
    };
    for (const uid of viewer.partnerships ?? []) {
        const u = data.partnerships[uid];
        if (u) push(u.person1Id === viewerId ? u.person2Id : u.person1Id, 'partner');
    }
    for (const cid of viewer.childIds ?? []) push(cid, 'child');
    for (const pid of viewer.parentIds ?? []) push(pid, 'parent');
    for (const pid of viewer.parentIds ?? []) {
        for (const sid of data.persons[pid]?.childIds ?? []) push(sid, 'sibling');
    }
    return out;
}

/** Lines of the delete-person confirmation: at most `max` shared events, then "…" (spec 085 §3d). */
export function sharedDeleteLines(items: readonly string[], max = 5): string[] {
    return items.length > max ? [...items.slice(0, max), '…'] : [...items];
}
