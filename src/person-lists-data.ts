/**
 * Lists of people as the tree stores them (spec 084, data version 22):
 * reading them back from any stored or imported tree, keeping them right when
 * people are deleted or merged, narrowing them for a part of the tree, and
 * the date a person came into the tree (Person.addedAt). No DOM, no lineage,
 * no strings: the data layer, the subtree export, the research link and the
 * importers use it. Evaluating a list (who is in it) is src/person-lists.ts.
 */

import type {
    CustomRule, PersonId, PersonList, PersonListOrigin, PersonListRule, PersonListSort, RuleCond, RuleCondName, RuleGroup,
    RuleHasWhat, RuleNearEvent, RuleNode, RuleParamsMap, RulePeriod, RuleYears, StromData,
} from './types.js';

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

/**
 * Whether a list is worked out each time (automatic): a custom rule by its
 * `auto` (spec 136 D3; such a list is stored with `dynamic: false` for older
 * apps), else by `dynamic`.
 */
export function listIsAuto(list: PersonList): boolean {
    return list.custom ? list.custom.auto === true : !!list.dynamic;
}

// ---------------------------------------------------------------------------
// Custom rules (spec 136): read back as the app can use them
// ---------------------------------------------------------------------------

/** The deepest a custom rule may nest (the root = 1). */
const CUSTOM_MAX_DEPTH = 3;

const HAS_WHAT: readonly RuleHasWhat[] = [
    'birthDate', 'birthPlace', 'deathDate', 'deathPlace', 'photo', 'source',
    'parents', 'partner', 'children', 'story', 'note', 'material', 'conflict', 'openTask',
];
const NEAR_EVENTS: readonly RuleNearEvent[] = ['birth', 'death', 'marriage', 'residence'];

function str(v: unknown): string {
    return typeof v === 'string' ? v : '';
}

function int(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined;
}

function depth(v: unknown): number | 'all' | undefined {
    if (v === 'all') return 'all';
    const n = int(v);
    return n !== undefined && n >= 0 ? n : undefined;
}

function years(raw: Record<string, unknown>): RuleYears {
    const y: RuleYears = {};
    const from = int(raw.from);
    const to = int(raw.to);
    if (from !== undefined) y.from = from;
    if (to !== undefined) y.to = to;
    return y;
}

function period(raw: Record<string, unknown>): RulePeriod | null {
    if (raw.hours === 24) return { hours: 24 };
    const days = int(raw.days);
    if (days !== undefined && days >= 1) return { days };
    if (typeof raw.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.since)) return { since: raw.since };
    return null;
}

function strings(v: unknown): string[] {
    return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x !== ''))] : [];
}

/**
 * The parameters of one condition as the app can use them, or null when the
 * condition is unknown or its parameters cannot be read. A parameter still
 * "to fill in" (an empty person, place, list…) is kept: the condition then
 * counts as empty (incomplete or missing, §11).
 */
function sanitizeCondParams(c: RuleCondName, raw: Record<string, unknown>): RuleParamsMap[RuleCondName] | null {
    switch (c) {
        case 'family': {
            const up = depth(raw.up);
            const down = depth(raw.down);
            const via = raw.via === 'father' || raw.via === 'mother' ? raw.via : 'both';
            const width = raw.width === 'siblings' || raw.width === 'cousins' ? raw.width : 'line';
            const spouses = raw.spouses === 'spouses' || raw.spouses === 'families' ? raw.spouses : 'none';
            if (up === undefined || down === undefined) return null;
            const p: RuleParamsMap['family'] = { personId: str(raw.personId) as PersonId, personName: str(raw.personName), up, via, down, width, spouses };
            const cousins = depth(raw.cousins);
            if (width === 'cousins' && cousins !== undefined) p.cousins = cousins;
            return p;
        }
        case 'ancestors':
        case 'descendants': {
            const p: RuleParamsMap['ancestors'] = { personId: str(raw.personId) as PersonId, personName: str(raw.personName) };
            const g = generations(raw.generations);
            if (g !== undefined) p.generations = g;
            return p;
        }
        case 'rod': return { rodIds: strings(raw.rodIds), rodName: str(raw.rodName) };
        case 'line': return { directionId: str(raw.directionId), lineName: str(raw.lineName) };
        case 'list': return { listId: str(raw.listId), listName: str(raw.listName) };
        case 'born': case 'died': case 'married': case 'livedIn': case 'deathAge': return years(raw);
        case 'alive': return raw.value === 'living' || raw.value === 'deceased' ? { value: raw.value } : null;
        case 'near': {
            const km = typeof raw.km === 'number' && Number.isFinite(raw.km) && raw.km >= 0 ? raw.km : 0;
            const events = strings(raw.events).filter((e): e is RuleNearEvent => (NEAR_EVENTS as readonly string[]).includes(e));
            const p: RuleParamsMap['near'] = { placeKey: str(raw.placeKey), placeName: str(raw.placeName), events, km };
            if (raw.below === true) p.below = true;
            return p;
        }
        case 'gender': return raw.value === 'male' || raw.value === 'female' || raw.value === 'unknown' ? { value: raw.value } : null;
        case 'occupation': {
            const values = Array.isArray(raw.values) ? raw.values.filter((x): x is string => typeof x === 'string' && x !== '') : [];
            const labels = Array.isArray(raw.labels) ? raw.labels.map(x => str(x)) : [];
            return { values, labels: values.map((v, i) => labels[i] || v) };
        }
        case 'has': {
            const what = HAS_WHAT.includes(raw.what as RuleHasWhat) ? raw.what as RuleHasWhat : null;
            return what ? { have: raw.have !== false, what } : null;
        }
        case 'count': {
            const what = raw.what === 'children' || raw.what === 'marriages' || raw.what === 'sources' ? raw.what : null;
            const n = int(raw.n);
            return what && n !== undefined && n >= 0 ? { what, cmp: raw.cmp === 'max' ? 'max' : 'min', n } : null;
        }
        case 'text': {
            const where = raw.where === 'story' || raw.where === 'note' ? raw.where : 'both';
            return { query: str(raw.query), where };
        }
        case 'added':
        case 'changed': return period(raw);
        case 'tableFilter': {
            const rule = sanitizePersonListRule({ ...raw, kind: 'tableFilter' });
            if (!rule || rule.kind !== 'tableFilter') return null;
            return { viewName: str(raw.viewName), rowType: rule.rowType, filter: rule.filter, sort: rule.sort };
        }
    }
}

const COND_NAMES: ReadonlySet<string> = new Set<RuleCondName>([
    'family', 'ancestors', 'descendants', 'rod', 'line', 'list', 'born', 'died', 'married', 'livedIn', 'deathAge', 'alive',
    'near', 'gender', 'occupation', 'has', 'count', 'text', 'added', 'changed', 'tableFilter',
]);

function sanitizeNode(raw: unknown, level: number): RuleNode | null {
    if (!isObject(raw)) return null;
    if (raw.t === 'group') {
        if (level > CUSTOM_MAX_DEPTH || !Array.isArray(raw.items)) return null;
        const items: RuleNode[] = [];
        for (const r of raw.items) {
            const n = sanitizeNode(r, level + 1);
            if (!n) return null;
            items.push(n);
        }
        const g: RuleGroup = { t: 'group', op: raw.op === 'any' ? 'any' : 'all', items };
        if (raw.not === true) g.not = true;
        return g;
    }
    if (raw.t !== 'cond' || typeof raw.c !== 'string' || !COND_NAMES.has(raw.c) || !isObject(raw.p)) return null;
    const c = raw.c as RuleCondName;
    const p = sanitizeCondParams(c, raw.p);
    if (!p) return null;
    const cond = { t: 'cond', c, p } as RuleCond;
    if (raw.not === true) cond.not = true;
    return cond;
}

/**
 * A stored custom rule as the app can use it, or null: version 1, the root a
 * group, at most 3 levels, every condition one the app knows with readable
 * parameters. A rule the app cannot read whole is not used at all (the list
 * stays fixed with its stored people) rather than used in part.
 */
export function sanitizeCustomRule(raw: unknown): (CustomRule & { auto: boolean }) | null {
    if (!isObject(raw) || raw.v !== 1) return null;
    const root = sanitizeNode(raw.root, 1);
    if (!root || root.t !== 'group') return null;
    return { v: 1, root, auto: raw.auto === true };
}

/** A stored origin of a list (spec 136 K1.10), or null. */
export function sanitizeListOrigin(raw: unknown): PersonListOrigin | null {
    if (!isObject(raw) || typeof raw.at !== 'string') return null;
    if (raw.by === 'template' && typeof raw.template === 'string' && raw.template) {
        return { by: 'template', template: raw.template, name: str(raw.name), at: raw.at };
    }
    if (raw.by === 'agent') {
        const agent = optName(raw.agent);
        return agent ? { by: 'agent', at: raw.at, agent } : { by: 'agent', at: raw.at };
    }
    return null;
}

/** One stored list as the app can use it, or null (an automatic list without a usable rule is no list). */
export function sanitizePersonList(raw: unknown): PersonList | null {
    if (!isObject(raw)) return null;
    const { id } = raw;
    if (typeof id !== 'string' || !id) return null;
    const builtin = raw.builtin === 'added30' ? 'added30' as const : undefined;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name && !builtin) return null;
    // A custom rule (spec 136 D3) replaces the one-condition rule; it is stored with dynamic: false and its last people.
    const custom = raw.custom === undefined ? null : sanitizeCustomRule(raw.custom);
    const rule = custom || raw.rule === undefined ? null : sanitizePersonListRule(raw.rule);
    const dynamic = !custom && raw.dynamic === true && !!rule;
    if (!custom && raw.dynamic === true && !rule) return null;
    const auto = dynamic || !!custom?.auto;
    const sort = PERSON_LIST_SORTS.includes(raw.sort as PersonListSort) ? raw.sort as PersonListSort : 'old';
    const list: PersonList = {
        id, name, dynamic,
        // A manual order belongs to a fixed list only.
        sort: auto && sort === 'manual' ? 'old' : sort,
        updated: typeof raw.updated === 'string' ? raw.updated : '',
    };
    if (rule) list.rule = rule;
    if (custom) list.custom = custom;
    if (!dynamic) {
        // A kept-up-to-date custom list keeps its last people too: what an older app shows.
        list.personIds = ids(raw.personIds);
        const removed = ids(raw.removed);
        if (removed.length && !auto) list.removed = removed;
    }
    if (raw.checklist === true && !auto) list.checklist = true;
    const done = ids(raw.done);
    if (done.length) list.done = done;
    if (builtin) list.builtin = builtin;
    const origin = raw.origin === undefined ? null : sanitizeListOrigin(raw.origin);
    if (origin) list.origin = origin;
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

/** A custom rule with the conditions naming `removeId` naming `keepId` (a merge), or null when none names it. */
export function customWithPersonMerged(root: RuleGroup, removeId: PersonId, keepId: PersonId): RuleGroup | null {
    let changed = false;
    const walk = (node: RuleNode): RuleNode => {
        if (node.t === 'group') return { ...node, items: node.items.map(walk) };
        if ((node.c === 'family' || node.c === 'ancestors' || node.c === 'descendants') && node.p.personId === removeId) {
            changed = true;
            return { ...node, p: { ...node.p, personId: keepId } } as RuleCond;
        }
        return node;
    };
    const out = walk(root) as RuleGroup;
    return changed ? out : null;
}

/**
 * Two people merged into `keepId` (spec 084 §7): the removed person's place
 * passes to the kept one; with both in a list the earlier position stays; the
 * result is done when either was, taken out only when both were. A rule's
 * person follows too (a custom rule's every condition naming the person).
 * Mutates `data.personLists`.
 */
export function onPersonsMerged(data: StromData, keepId: PersonId, removeId: PersonId): void {
    if (!data.personLists?.length || keepId === removeId) return;
    data.personLists = data.personLists.map(l => {
        const customRoot = l.custom ? customWithPersonMerged(l.custom.root, removeId, keepId) : null;
        const touches = l.personIds?.includes(removeId) || l.removed?.includes(removeId) || l.done?.includes(removeId)
            || ((l.rule?.kind === 'ancestors' || l.rule?.kind === 'descendants') && l.rule.personId === removeId)
            || !!customRoot;
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
        if (customRoot && l.custom) next.custom = { ...l.custom, root: customRoot };
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
        if (!l.dynamic && !l.custom?.auto && !personIds.length) continue;
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

function sameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false;
        return true;
    }
    if (Array.isArray(b)) return false;
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    let na = 0;
    for (const k in ra) {
        if (ra[k] === undefined) continue;
        na++;
        if (!sameValue(ra[k], rb[k])) return false;
    }
    let nb = 0;
    for (const k in rb) if (rb[k] !== undefined) nb++;
    return na === nb;
}

/** Two states of a person the same but for the time of the last change. */
function samePerson(a: object, b: object): boolean {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    let na = 0;
    for (const k in ra) {
        if (k === 'changedAt' || ra[k] === undefined) continue;
        na++;
        if (!sameValue(ra[k], rb[k])) return false;
    }
    let nb = 0;
    for (const k in rb) if (k !== 'changedAt' && rb[k] !== undefined) nb++;
    return na === nb;
}

/**
 * Writes `at` as Person.changedAt (spec 136 D4) of every person of `after`
 * who was in `before` and differs from it there (their data, events,
 * citations, parents) or whose union changed (both partners). People new in
 * `after` get none (their time is addedAt); placeholders get none. Returns
 * how many were stamped; mutates `after`.
 */
export function stampChangedAt(before: StromData, after: StromData, at: string): number {
    const hit = new Set<PersonId>();
    for (const [id, p] of Object.entries(after.persons ?? {})) {
        const old = before.persons?.[id as PersonId];
        if (!p || !old || p.isPlaceholder || p === old) continue;
        if (!samePerson(old, p)) hit.add(id as PersonId);
    }
    const unions = new Set([...Object.keys(before.partnerships ?? {}), ...Object.keys(after.partnerships ?? {})]);
    for (const id of unions) {
        const a = before.partnerships?.[id as keyof StromData['partnerships']];
        const b = after.partnerships?.[id as keyof StromData['partnerships']];
        if (a === b || (a && b && sameValue(a, b))) continue;
        for (const u of [a, b]) if (u) { hit.add(u.person1Id); hit.add(u.person2Id); }
    }
    let n = 0;
    for (const id of hit) {
        const p = after.persons?.[id];
        if (!p || p.isPlaceholder || !before.persons?.[id]) continue;
        p.changedAt = at;
        n++;
    }
    return n;
}

/**
 * A step that puts people back as they were in an `earlier` state (the undo
 * of a merge, with its backup "Before merge"), after stampChangedAt(current,
 * next): each person the step stamped who is again as in `earlier` (all but
 * the time, their unions too) gets back the time of their last change of
 * `earlier` (none when it had none), as the Undo button gives it back.
 * Returns how many; mutates `next`.
 */
export function restoreChangedAt(next: StromData, current: StromData, earlier: StromData): number {
    const sameUnion = (id: string): boolean => {
        const a = next.partnerships?.[id as keyof StromData['partnerships']];
        const b = earlier.partnerships?.[id as keyof StromData['partnerships']];
        return a === b || (!!a && !!b && sameValue(a, b));
    };
    let n = 0;
    for (const [id, p] of Object.entries(next.persons ?? {})) {
        const now = current.persons?.[id as PersonId];
        const was = earlier.persons?.[id as PersonId];
        if (!p || !now || !was || p.isPlaceholder || p.changedAt === now.changedAt || !samePerson(was, p)) continue;
        if (![...p.partnerships ?? [], ...was.partnerships ?? []].every(sameUnion)) continue;
        if (was.changedAt) p.changedAt = was.changedAt; else delete p.changedAt;
        n++;
    }
    return n;
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
 * (the research's GEDCOM has no place for them; custom rules and origins
 * with them, spec 136) and so are the date a person came into the tree and
 * the date of their last change; a person new to the tree gets the research's own date
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
        // The last change (spec 136 D4) is the tree's own too: the research's GEDCOM does not carry it.
        const changed = p.changedAt ?? old?.changedAt;
        if (at === p.addedAt && changed === p.changedAt) continue;
        persons ??= { ...next.persons };
        const copy = { ...p };
        if (at) copy.addedAt = at; else delete copy.addedAt;
        if (changed) copy.changedAt = changed;
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
