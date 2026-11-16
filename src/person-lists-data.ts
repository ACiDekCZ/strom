/**
 * Lists of people as the tree stores them (spec 084, data version 22):
 * reading them back from any stored or imported tree, keeping them right when
 * people are deleted or merged, narrowing them for a part of the tree, and
 * the date a person came into the tree (Person.addedAt). No DOM, no lineage,
 * no strings: the data layer, the subtree export, the research link and the
 * importers use it. Evaluating a list (who is in it) is src/person-lists.ts.
 */

import type { PersonId, PersonList, PersonListRule, PersonListSort, StromData } from './types.js';

/** The id of the ready-made "Added in the last 30 days" (spec 084 §8, Q3). */
export const ADDED30_ID = 'added30';
export const ADDED30_DAYS = 30;

export const PERSON_LIST_SORTS: readonly PersonListSort[] = ['old', 'gen', 'name', 'added', 'manual'];

function isObject(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

function ids(v: unknown): PersonId[] {
    if (!Array.isArray(v)) return [];
    const seen = new Set<string>();
    const out: PersonId[] = [];
    for (const x of v) {
        if (typeof x !== 'string' || !x || seen.has(x)) continue;
        seen.add(x);
        out.push(x as PersonId);
    }
    return out;
}

function generations(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : undefined;
}

function optName(v: unknown): string | undefined {
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** One stored rule as the app can use it, or null. */
export function sanitizePersonListRule(raw: unknown): PersonListRule | null {
    if (!isObject(raw)) return null;
    switch (raw.kind) {
        case 'rods': {
            const rodIds = Array.isArray(raw.rodIds) ? raw.rodIds.filter((x): x is string => typeof x === 'string' && x !== '') : [];
            return rodIds.length ? { kind: 'rods', rodIds: [...new Set(rodIds)] } : null;
        }
        case 'ancestors':
        case 'descendants': {
            if (typeof raw.personId !== 'string' || !raw.personId) return null;
            const rule: Extract<PersonListRule, { kind: 'ancestors' | 'descendants' }> = { kind: raw.kind, personId: raw.personId as PersonId };
            const g = generations(raw.generations);
            if (g !== undefined) rule.generations = g;
            const n = optName(raw.personName);
            if (n) rule.personName = n;
            return rule;
        }
        case 'line': {
            if (typeof raw.directionId !== 'string' || !raw.directionId) return null;
            const n = optName(raw.lineName);
            return n ? { kind: 'line', directionId: raw.directionId, lineName: n } : { kind: 'line', directionId: raw.directionId };
        }
        case 'tableFilter': {
            if (raw.rowType !== 'persons' && raw.rowType !== 'unions') return null;
            const filterRaw = isObject(raw.filter) ? raw.filter : {};
            const items = (Array.isArray(filterRaw.items) ? filterRaw.items : []).filter(isObject).map(i => ({ ...i }));
            const sort = (Array.isArray(raw.sort) ? raw.sort : [])
                .filter(isObject)
                .filter(s => typeof s.col === 'string' && s.col !== '')
                .map(s => ({ col: s.col as string, dir: (s.dir === -1 ? -1 : 1) as 1 | -1 }));
            return { kind: 'tableFilter', rowType: raw.rowType, filter: { op: 'and', items }, sort };
        }
        case 'added': {
            const days = typeof raw.days === 'number' && Number.isFinite(raw.days) && raw.days >= 1 ? Math.floor(raw.days) : null;
            return days ? { kind: 'added', days } : null;
        }
        default:
            return null;
    }
}

/** One stored list as the app can use it, or null (an automatic list without a usable rule is no list). */
export function sanitizePersonList(raw: unknown): PersonList | null {
    if (!isObject(raw)) return null;
    const { id } = raw;
    if (typeof id !== 'string' || !id) return null;
    const builtin = raw.builtin === 'added30' ? 'added30' as const : undefined;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name && !builtin) return null;
    const rule = raw.rule === undefined ? null : sanitizePersonListRule(raw.rule);
    const dynamic = raw.dynamic === true && !!rule;
    if (raw.dynamic === true && !rule) return null;
    const sort = PERSON_LIST_SORTS.includes(raw.sort as PersonListSort) ? raw.sort as PersonListSort : 'old';
    const list: PersonList = {
        id, name, dynamic,
        // A manual order belongs to a fixed list only.
        sort: dynamic && sort === 'manual' ? 'old' : sort,
        updated: typeof raw.updated === 'string' ? raw.updated : '',
    };
    if (rule) list.rule = rule;
    if (!dynamic) {
        list.personIds = ids(raw.personIds);
        const removed = ids(raw.removed);
        if (removed.length) list.removed = removed;
    }
    if (raw.checklist === true && !dynamic) list.checklist = true;
    const done = ids(raw.done);
    if (done.length) list.done = done;
    if (builtin) list.builtin = builtin;
    return list;
}

/** The stored lists as the app can use them (one per id and per built-in, the first wins); undefined when none. */
export function sanitizePersonLists(raw: unknown): PersonList[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const seen = new Set<string>();
    const out: PersonList[] = [];
    for (const r of raw) {
        const l = sanitizePersonList(r);
        if (!l || seen.has(l.id) || (l.builtin && seen.has(`builtin:${l.builtin}`))) continue;
        seen.add(l.id);
        if (l.builtin) seen.add(`builtin:${l.builtin}`);
        out.push(l);
    }
    return out.length ? out : undefined;
}

/** The deleted ready-made lists; undefined when none. */
export function sanitizePersonListsDropped(raw: unknown): 'added30'[] | undefined {
    return Array.isArray(raw) && raw.includes('added30') ? ['added30'] : undefined;
}

/** A stored ISO time of Person.addedAt, or undefined. */
export function sanitizeAddedAt(raw: unknown): string | undefined {
    return typeof raw === 'string' && raw.length >= 10 && !Number.isNaN(Date.parse(raw)) ? raw : undefined;
}

// ---------------------------------------------------------------------------
// The ready-made list
// ---------------------------------------------------------------------------

/** The ready-made "Added in the last 30 days" as it is before anything changes it (not stored). */
export function builtinAdded30(): PersonList {
    return { id: ADDED30_ID, name: '', dynamic: true, rule: { kind: 'added', days: ADDED30_DAYS }, sort: 'added', builtin: 'added30', updated: '' };
}

/**
 * The tree's lists: the stored ones, and the ready-made "Added in the last
 * 30 days" while it is neither stored (changed) nor deleted (spec 084 Q3:
 * also for a new tree and after an import, never again once deleted).
 */
export function personListsOf(data: Pick<StromData, 'personLists' | 'personListsDropped'>): PersonList[] {
    const stored = data.personLists ?? [];
    if (stored.some(l => l.builtin === 'added30') || data.personListsDropped?.includes('added30')) return stored;
    return [builtinAdded30(), ...stored];
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** A list's name as compared for uniqueness: without diacritics, case and extra spaces. */
export function foldListName(name: string): string {
    return name.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();
}

/** Whether another list (not `exceptId`) has this name; `shownName` gives a list's shown name (the ready-made one has none stored). */
export function isListNameTaken(lists: readonly PersonList[], name: string, exceptId?: string, shownName: (l: PersonList) => string = l => l.name): boolean {
    const f = foldListName(name);
    return !!f && lists.some(l => l.id !== exceptId && foldListName(shownName(l)) === f);
}

/** The name itself when free, else "{name} (2)" with the next free number (spec 084 §6). */
export function suggestListName(lists: readonly PersonList[], name: string, exceptId?: string, shownName: (l: PersonList) => string = l => l.name): string {
    const base = name.trim();
    if (!isListNameTaken(lists, base, exceptId, shownName)) return base;
    const stem = base.replace(/\s*\(\d+\)$/, '');
    for (let k = 2; ; k++) {
        const candidate = `${stem} (${k})`;
        if (!isListNameTaken(lists, candidate, exceptId, shownName)) return candidate;
    }
}

/** A new list id not used by the tree. */
export function newPersonListId(lists: readonly PersonList[]): string {
    const used = new Set(lists.map(l => l.id));
    for (;;) {
        const id = `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        if (!used.has(id)) return id;
    }
}

// ---------------------------------------------------------------------------
// Keeping lists right when people go
// ---------------------------------------------------------------------------

function without(arr: PersonId[] | undefined, id: PersonId): PersonId[] | undefined {
    if (!arr?.includes(id)) return arr;
    const out = arr.filter(x => x !== id);
    return out.length ? out : undefined;
}

/**
 * A deleted person leaves every list (its people, the taken out, the done).
 * Returns how many lists had the person among their people (for the toast
 * "also removed from k lists"). Mutates `data.personLists`.
 */
export function onPersonDeleted(data: StromData, id: PersonId): number {
    let k = 0;
    if (!data.personLists?.length) return 0;
    data.personLists = data.personLists.map(l => {
        const inPeople = !!l.personIds?.includes(id);
        const inOther = inPeople || !!l.removed?.includes(id) || !!l.done?.includes(id);
        if (!inOther) return l;
        if (inPeople) k++;
        const next: PersonList = { ...l };
        if (l.personIds) next.personIds = l.personIds.filter(x => x !== id);
        const removed = without(l.removed, id);
        if (removed) next.removed = removed; else delete next.removed;
        const done = without(l.done, id);
        if (done) next.done = done; else delete next.done;
        return next;
    });
    return k;
}

/**
 * Two people merged into `keepId` (spec 084 §7): the removed person's place
 * passes to the kept one; with both in a list the earlier position stays; the
 * result is done when either was, taken out only when both were. A rule's
 * person follows too. Mutates `data.personLists`.
 */
export function onPersonsMerged(data: StromData, keepId: PersonId, removeId: PersonId): void {
    if (!data.personLists?.length || keepId === removeId) return;
    data.personLists = data.personLists.map(l => {
        const touches = l.personIds?.includes(removeId) || l.removed?.includes(removeId) || l.done?.includes(removeId)
            || ((l.rule?.kind === 'ancestors' || l.rule?.kind === 'descendants') && l.rule.personId === removeId);
        if (!touches) return l;
        const next: PersonList = { ...l };
        if (l.personIds) {
            const out: PersonId[] = [];
            for (const x of l.personIds) {
                const y = x === removeId ? keepId : x;
                if (!out.includes(y)) out.push(y);
            }
            next.personIds = out;
        }
        const wasRemoved = (x: PersonId) => !!l.removed?.includes(x);
        if (l.removed) {
            const both = wasRemoved(keepId) && wasRemoved(removeId);
            const r = l.removed.filter(x => x !== removeId && (x !== keepId || both));
            if (r.length) next.removed = r; else delete next.removed;
        }
        if (l.done) {
            const d: PersonId[] = [];
            for (const x of l.done) {
                const y = x === removeId ? keepId : x;
                if (!d.includes(y)) d.push(y);
            }
            next.done = d;
        }
        if ((l.rule?.kind === 'ancestors' || l.rule?.kind === 'descendants') && l.rule.personId === removeId) {
            next.rule = { ...l.rule, personId: keepId };
        }
        return next;
    });
}

/**
 * The lists for a part of the tree (a subtree export, spec 084 §7): a fixed
 * list keeps the people of the part (none left = no list), its taken-out and
 * done narrow the same way; an automatic list stays as it is (its rule works
 * on whatever the part has).
 */
export function subsetForSubtree(lists: readonly PersonList[] | undefined, keep: ReadonlySet<string>): PersonList[] | undefined {
    if (!lists?.length) return undefined;
    const out: PersonList[] = [];
    for (const l of lists) {
        const next: PersonList = structuredClone(l);
        if (l.done) {
            const done = l.done.filter(id => keep.has(id));
            if (done.length) next.done = done; else delete next.done;
        }
        // No one left behind stays in the list's own data (an automatic list's kept order or removed people too).
        const removed = (l.removed ?? []).filter(id => keep.has(id));
        if (removed.length) next.removed = removed; else delete next.removed;
        const personIds = (l.personIds ?? []).filter(id => keep.has(id));
        if (!l.dynamic && !personIds.length) continue;
        if (personIds.length) next.personIds = personIds; else delete next.personIds;
        out.push(next);
    }
    return out.length ? out : undefined;
}

// ---------------------------------------------------------------------------
// When a person came into the tree
// ---------------------------------------------------------------------------

/**
 * Writes `at` as Person.addedAt of the given people (all when `only` is
 * absent) that have none; placeholders get none. Returns `data` (mutated).
 */
export function stampAddedAt(data: StromData, at: string, only?: Iterable<string>): StromData {
    const pick = only ? [...only] : Object.keys(data.persons);
    for (const id of pick) {
        const p = data.persons[id as PersonId];
        if (!p || p.isPlaceholder || p.addedAt) continue;
        p.addedAt = at;
    }
    return data;
}

/**
 * An addedAt value in ms: a full ISO time as it is, a bare day (a GEDCOM
 * import's) as that day's local midnight; NaN when it is no time.
 */
export function addedTime(v: string | undefined): number {
    if (!v) return NaN;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : Date.parse(v);
}

/** The earlier of two addedAt values (a merge keeps the earlier one); undefined when neither. */
export function earlierAddedAt(a: string | undefined, b: string | undefined): string | undefined {
    if (!a) return b;
    if (!b) return a;
    return addedTime(a) <= addedTime(b) ? a : b;
}

/**
 * A version the research sends (spec 084 §8): the lists are the tree's own
 * (the research's GEDCOM has no place for them) and so is the date a person
 * came into the tree; a person new to the tree gets the research's own date
 * (`research.added`) or `now`. `next` must already carry the previous ids
 * (stabilizeIds). Returns a new object; `next` is not changed.
 */
export function keepPersonListData(next: StromData, previous: StromData, now: string): StromData {
    const out: StromData = { ...next };
    if (!next.personLists?.length && previous.personLists?.length) out.personLists = structuredClone(previous.personLists);
    if (!next.personListsDropped?.length && previous.personListsDropped?.length) out.personListsDropped = [...previous.personListsDropped];
    let persons: StromData['persons'] | null = null;
    for (const [id, p] of Object.entries(next.persons ?? {})) {
        if (!p || p.isPlaceholder) continue;
        const old = previous.persons?.[id as PersonId];
        // A person the tree had keeps its own date (none = earlier); a new one gets the research's or now.
        const at = old ? old.addedAt : p.addedAt ?? sanitizeAddedAt(p.research?.added) ?? now;
        if (at === p.addedAt) continue;
        persons ??= { ...next.persons };
        const copy = { ...p };
        if (at) copy.addedAt = at; else delete copy.addedAt;
        persons[id as PersonId] = copy;
    }
    if (persons) out.persons = persons;
    return out;
}

/** A whole tree the research brings as a new tree: every person gets the research's date or `now`. Mutates `data`. */
export function stampResearchTree(data: StromData, now: string): StromData {
    for (const p of Object.values(data.persons ?? {})) {
        if (!p || p.isPlaceholder || p.addedAt) continue;
        p.addedAt = sanitizeAddedAt(p.research?.added) ?? now;
    }
    return data;
}
