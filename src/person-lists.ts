/**
 * Lists of people (spec 084): who is in a list, in which order, what it says
 * of its people, and the changes a list allows. The one interface for "the
 * people of a list" — the lists dialog, the Table's scope, the slideshow and
 * the exports all ask `listPersonIds`.
 *
 * A fixed list holds its people (`personIds`); an automatic one is worked out
 * from its rule each time: a family line, ancestors or descendants (blood
 * members only, Q2), a research line (as the Table's line chip), a Table
 * filter (persons, or both partners of the unions) or "added in the last
 * n days". Placeholders and people no longer in the tree are never in a list.
 *
 * Results are cached per lineage index (one per data revision): a list is
 * evaluated once per revision, however many places ask.
 */

import type { Gender, Person, PersonId, PersonList, PersonListRule, PersonListSort, StromData } from './types.js';
import { buildLineages, rodLabels, selection, type LineageIndex, type RodId } from './lineage.js';
import { assignGenerations } from './generations.js';
import { parseFlexDate } from './dates.js';
import { personEvidence, unionsByPerson } from './evidence-level.js';
import { shownName } from './person-name.js';
import { getCurrentLanguage, strings, type Language } from './strings.js';
import { personLineRole, researchLinesOf } from './ui/table-view/table-research.js';
import { buildTableModel, rowsOf, type TableModel } from './ui/table-view/table-model.js';
import { filterRows, sortRows, type FilterItem, type TableFilter } from './ui/table-view/table-filter.js';
import { ADDED30_DAYS, addedTime, personListsOf } from './person-lists-data.js';

export * from './person-lists-data.js';

/** What a list's evaluation may need beyond the tree. */
export interface ListEnv {
    /** The home person (the Table's blood relatives and partner order); none = the Table's default. */
    homeId?: PersonId | null;
    /** The UI language (name order); default the current one. */
    lang?: Language;
    /** Now in ms (the "added" rule); default Date.now(). */
    now?: number;
    /** The Table's model when the caller has one (a tableFilter rule then filters exactly what the Table shows). */
    tableModel?: TableModel;
}

/** The kind a list shows (icon, badge): a fixed checklist is a work list. */
export type ListKind = 'fixed' | 'auto' | 'work';

export function listKind(list: PersonList): ListKind {
    return list.dynamic ? 'auto' : list.checklist ? 'work' : 'fixed';
}

/** A list's shown name: the ready-made one follows its period until renamed. */
export function listDisplayName(list: PersonList): string {
    if (list.name) return list.name;
    if (list.builtin === 'added30') {
        const days = list.rule?.kind === 'added' ? list.rule.days : ADDED30_DAYS;
        return days === ADDED30_DAYS ? strings.lists.builtin.added30 : strings.lists.rule.added(days);
    }
    return '';
}

// ---------------------------------------------------------------------------
// Per-index caches
// ---------------------------------------------------------------------------

interface IndexCache {
    lists: Map<string, PersonId[]>;
    generations?: Map<string, number>;
    unions?: ReturnType<typeof unionsByPerson>;
    tableModels: Map<string, TableModel>;
    lines?: ReturnType<typeof researchLinesOf>;
}

const caches = new WeakMap<LineageIndex, IndexCache>();

function cacheOf(index: LineageIndex): IndexCache {
    let c = caches.get(index);
    if (!c) { c = { lists: new Map(), tableModels: new Map() }; caches.set(index, c); }
    return c;
}

const indexByData = new WeakMap<StromData, LineageIndex>();

/** The lineage index of a tree object (cached by identity; DataManager.getLineageIndex caches by revision). */
export function lineageIndexOf(data: StromData): LineageIndex {
    let idx = indexByData.get(data);
    if (!idx) { idx = buildLineages(data); indexByData.set(data, idx); }
    return idx;
}

const DAY_MS = 86_400_000;

function real(data: StromData, id: string): Person | null {
    const p = data.persons[id as PersonId];
    return p && !p.isPlaceholder ? p : null;
}

function tableModelOf(index: LineageIndex, env: ListEnv): TableModel {
    if (env.tableModel && env.tableModel.data === index.data) return env.tableModel;
    const lang = env.lang ?? getCurrentLanguage();
    const key = `${env.homeId ?? ''}|${lang}`;
    const c = cacheOf(index);
    let m = c.tableModels.get(key);
    if (!m) { m = buildTableModel(index.data, { rev: 0, homeId: env.homeId ?? null, lang }); c.tableModels.set(key, m); }
    return m;
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

/** The people a rule finds, in its own order (no placeholders, no duplicates). */
export function rulePersonIds(index: LineageIndex, rule: PersonListRule, env: ListEnv = {}): PersonId[] {
    const data = index.data;
    const out: PersonId[] = [];
    const seen = new Set<string>();
    const push = (id: string): void => {
        if (seen.has(id) || !real(data, id)) return;
        seen.add(id);
        out.push(id as PersonId);
    };
    switch (rule.kind) {
        case 'rods':
            for (const id of selection(index, { kind: 'rods', rodIds: rule.rodIds as RodId[] }).memberIds) push(id);
            break;
        case 'ancestors':
        case 'descendants':
            if (!data.persons[rule.personId]) break;
            for (const id of selection(index, { kind: rule.kind, personId: rule.personId, generations: rule.generations }).memberIds) push(id);
            break;
        case 'line': {
            const lines = cacheOf(index).lines ??= researchLinesOf(data);
            if (lines.source === 'none') break;
            for (const p of Object.values(data.persons)) {
                if (!p || p.isPlaceholder) continue;
                const role = personLineRole(lines, p);
                if (role?.kind === 'line' && role.line.id === rule.directionId) push(p.id);
            }
            break;
        }
        case 'tableFilter': {
            const model = tableModelOf(index, env);
            const type = rule.rowType;
            const filter: TableFilter = { op: 'and', items: rule.filter.items as unknown as FilterItem[] };
            const { rows } = filterRows(model, type, rowsOf(model, type), filter);
            const sorted = rule.sort.length
                ? sortRows(model, type, rows, rule.sort.map(s => ({ col: s.col, dir: s.dir === -1 ? 'desc' as const : 'asc' as const })))
                : rows;
            for (const row of sorted) {
                if (row.kind === 'person') push(row.id);
                else if (row.kind === 'union') { if (row.p1) push(row.p1.id); if (row.p2) push(row.p2.id); }
            }
            break;
        }
        case 'added': {
            const from = startOfDay(env.now ?? Date.now()) - (rule.days - 1) * DAY_MS;
            for (const p of Object.values(data.persons)) {
                if (!p || p.isPlaceholder || !p.addedAt) continue;
                const t = addedTime(p.addedAt);
                if (Number.isFinite(t) && t >= from) push(p.id);
            }
            break;
        }
    }
    return out;
}

/** Local midnight of the day of `ms` ("the last 30 days" counts today as the first). */
function startOfDay(ms: number): number {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/** Why a rule finds nothing any more (spec 084 §7): its person, family line or research line is gone; null when it still works. */
export function ruleBroken(index: LineageIndex, rule: PersonListRule | undefined): { kind: 'person'; name: string } | { kind: 'rod' } | { kind: 'line' } | null {
    if (!rule) return null;
    switch (rule.kind) {
        case 'ancestors':
        case 'descendants':
            return index.data.persons[rule.personId] ? null : { kind: 'person', name: rule.personName ?? '?' };
        case 'rods':
            return rule.rodIds.some(id => index.rods.has(id as RodId)) ? null : { kind: 'rod' };
        case 'line': {
            const lines = cacheOf(index).lines ??= researchLinesOf(index.data);
            return lines.lines.some(l => l.id === rule.directionId) ? null : { kind: 'line' };
        }
        default:
            return null;
    }
}

/** A rule in words ("Ancestors of Anna Nováková, up to 4 generations"). `filterLabel` words a Table filter. */
export function ruleLabel(rule: PersonListRule, index?: LineageIndex, filterLabel?: (rule: Extract<PersonListRule, { kind: 'tableFilter' }>) => string): string {
    const t = strings.lists.rule;
    const data = index?.data;
    switch (rule.kind) {
        case 'ancestors':
        case 'descendants': {
            const p = data?.persons[rule.personId];
            const name = p ? shownName(p) : rule.personName ?? '?';
            return rule.kind === 'ancestors' ? t.anc(name, rule.generations) : t.des(name, rule.generations);
        }
        case 'rods': {
            const labels = index ? rodLabels(index) : null;
            const names = rule.rodIds.map(id => labels?.get(id as RodId) ?? '').filter(Boolean);
            return t.rod(names.length ? names.join(', ') : '?');
        }
        case 'line': {
            const line = data ? (index ? (cacheOf(index).lines ??= researchLinesOf(data)) : researchLinesOf(data)).lines.find(l => l.id === rule.directionId) : undefined;
            return t.line(line ? `${line.id} ${line.name}` : rule.lineName ?? rule.directionId);
        }
        case 'tableFilter': {
            const f = filterLabel ? filterLabel(rule) : String(rule.filter.items.length);
            return rule.rowType === 'unions' ? t.unions(f) : t.filter(f);
        }
        case 'added':
            return t.added(rule.days);
    }
}

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

function birthKey(p: Person | null): number {
    const d = parseFlexDate(p?.birthDate);
    return d ? d.year * 10000 + (d.month ?? 0) * 100 + (d.day ?? 0) : Number.POSITIVE_INFINITY;
}

function byId(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** Generations from the rule's person (ancestors up, descendants down), over the rule's members only. */
function ruleGenerations(index: LineageIndex, rule: Extract<PersonListRule, { kind: 'ancestors' | 'descendants' }>, members: ReadonlySet<string>): Map<string, number> {
    const data = index.data;
    const out = new Map<string, number>([[rule.personId, 0]]);
    let frontier: string[] = [rule.personId];
    for (let d = 1; frontier.length; d++) {
        const next: string[] = [];
        for (const id of frontier) {
            const p = data.persons[id as PersonId];
            if (!p) continue;
            const step = rule.kind === 'ancestors' ? p.parentIds ?? [] : p.childIds ?? [];
            for (const x of step) {
                if (out.has(x) || !members.has(x)) continue;
                out.set(x, d);
                next.push(x);
            }
        }
        frontier = next;
    }
    return out;
}

/** The generation shown beside a person of the list (the rule's for ancestors / descendants, else the Table's). */
export function listGenerations(index: LineageIndex, list: PersonList, ids: readonly PersonId[]): Map<string, number> {
    const rule = list.rule;
    if (rule && (rule.kind === 'ancestors' || rule.kind === 'descendants')) return ruleGenerations(index, rule, new Set(ids));
    const c = cacheOf(index);
    return c.generations ??= assignGenerations(index.data);
}

/** `ids` in the order `sort` gives (manual: as given). */
export function sortListIds(index: LineageIndex, list: PersonList, ids: readonly PersonId[], sort: PersonListSort = list.sort, env: ListEnv = {}): PersonId[] {
    const data = index.data;
    const old = (a: PersonId, b: PersonId): number => (birthKey(data.persons[a]) - birthKey(data.persons[b])) || byId(a, b);
    switch (sort) {
        case 'manual':
            return ids.slice();
        case 'old':
            return ids.slice().sort(old);
        case 'gen': {
            const gens = listGenerations(index, list, ids);
            const g = (id: string): number => gens.get(id) ?? Number.POSITIVE_INFINITY;
            return ids.slice().sort((a, b) => (g(a) - g(b)) || old(a, b));
        }
        case 'name': {
            const collator = new Intl.Collator(env.lang ?? getCurrentLanguage(), { sensitivity: 'base' });
            const nameOf = (id: PersonId): [string, string] => [data.persons[id]?.lastName ?? '', data.persons[id]?.firstName ?? ''];
            return ids.slice().sort((a, b) => {
                const [la, fa] = nameOf(a);
                const [lb, fb] = nameOf(b);
                return collator.compare(la, lb) || collator.compare(fa, fb) || old(a, b);
            });
        }
        case 'added': {
            const at = (id: PersonId): number => {
                const t = addedTime(data.persons[id]?.addedAt);
                return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
            };
            return ids.slice().sort((a, b) => (at(b) - at(a)) || old(a, b));
        }
    }
}

// ---------------------------------------------------------------------------
// The people of a list
// ---------------------------------------------------------------------------

function signature(list: PersonList, env: ListEnv): string {
    const day = list.rule?.kind === 'added' ? startOfDay(env.now ?? Date.now()) : 0;
    const table = list.rule?.kind === 'tableFilter' && list.dynamic ? `${env.homeId ?? ''}|${env.lang ?? getCurrentLanguage()}` : '';
    const lang = list.sort === 'name' ? env.lang ?? getCurrentLanguage() : '';
    return JSON.stringify([list.id, list.updated, list.sort, list.dynamic, list.rule ?? null, list.personIds ?? null, day, table, lang]);
}

/**
 * The people of a list in the list's order: a fixed list's people still in
 * the tree, an automatic list's from its rule; no placeholders. Cached per
 * index (one per data revision).
 */
export function listPersonIds(index: LineageIndex, list: PersonList, env: ListEnv = {}): PersonId[] {
    const c = cacheOf(index);
    const key = signature(list, env);
    const hit = c.lists.get(key);
    if (hit) return hit;
    const data = index.data;
    let ids: PersonId[];
    if (list.dynamic && list.rule) ids = rulePersonIds(index, list.rule, env);
    else ids = (list.personIds ?? []).filter(id => !!real(data, id));
    const out = sortListIds(index, list, ids, list.sort, env);
    c.lists.set(key, out);
    return out;
}

/** How many people a list has. */
export function listCount(index: LineageIndex, list: PersonList, env: ListEnv = {}): number {
    return listPersonIds(index, list, env).length;
}

/** What the lists dialog says of a list's people (§2, K8.2). */
export interface ListSummary {
    persons: number;
    /** The earliest and latest birth year (null: no one has one). */
    birthMin: number | null;
    birthMax: number | null;
    withPhoto: number;
    withCitation: number;
    withStory: number;
    /** People without any citation (the clickable tile). */
    noCite: number;
    /** A checklist's people not yet done (absent for other lists). */
    left?: number;
}

export function listSummary(index: LineageIndex, list: PersonList, env: ListEnv = {}): ListSummary {
    const data = index.data;
    const ids = listPersonIds(index, list, env);
    const c = cacheOf(index);
    const unions = c.unions ??= unionsByPerson(data);
    const done = new Set(list.done ?? []);
    const s: ListSummary = { persons: ids.length, birthMin: null, birthMax: null, withPhoto: 0, withCitation: 0, withStory: 0, noCite: 0 };
    let left = 0;
    for (const id of ids) {
        const p = data.persons[id];
        if (!p) continue;
        const y = parseFlexDate(p.birthDate)?.year;
        if (typeof y === 'number') {
            if (s.birthMin === null || y < s.birthMin) s.birthMin = y;
            if (s.birthMax === null || y > s.birthMax) s.birthMax = y;
        }
        if (p.photo) s.withPhoto++;
        if ((personEvidence(p, data, unions)?.sources ?? 0) > 0) s.withCitation++; else s.noCite++;
        if (p.story?.text?.trim()) s.withStory++;
        if (!done.has(id)) left++;
    }
    if (list.checklist && !list.dynamic) s.left = left;
    return s;
}

/** The lists a person is in (the person menu, the toast on delete). */
export function listsOfPerson(index: LineageIndex, id: PersonId, env: ListEnv = {}): PersonList[] {
    return personListsOf(index.data).filter(l => listPersonIds(index, l, env).includes(id));
}

// ---------------------------------------------------------------------------
// Changes of one list (pure: each returns a new list; DataManager stores it)
// ---------------------------------------------------------------------------

function touched(list: PersonList, now: string): PersonList {
    return { ...list, updated: now };
}

/** People added by hand to a fixed list: at the end of its manual order, no longer "taken out". */
export function withPersonsAdded(list: PersonList, ids: readonly PersonId[], now: string): PersonList {
    if (list.dynamic) return list;
    const personIds = [...(list.personIds ?? [])];
    const have = new Set(personIds);
    for (const id of ids) if (!have.has(id)) { have.add(id); personIds.push(id); }
    const next = touched({ ...list, personIds }, now);
    const removed = (list.removed ?? []).filter(id => !ids.includes(id));
    if (removed.length) next.removed = removed; else delete next.removed;
    return next;
}

/** People taken out of a fixed list: "Add from the rule" does not bring them back; they are no longer done. */
export function withPersonsRemoved(list: PersonList, ids: readonly PersonId[], now: string): PersonList {
    if (list.dynamic) return list;
    const drop = new Set<string>(ids);
    const next = touched({ ...list, personIds: (list.personIds ?? []).filter(id => !drop.has(id)) }, now);
    if (list.rule) {
        const removed = [...(list.removed ?? [])];
        for (const id of ids) if (!removed.includes(id) && list.personIds?.includes(id)) removed.push(id);
        if (removed.length) next.removed = removed;
    }
    const done = (list.done ?? []).filter(id => !drop.has(id));
    if (done.length) next.done = done; else delete next.done;
    return next;
}

/** "Add from the rule" (§7): the rule's people not in the list and not taken out, at the end in the list's order. */
export function withRuleFilled(index: LineageIndex, list: PersonList, now: string, env: ListEnv = {}): { list: PersonList; added: number } {
    if (list.dynamic || !list.rule) return { list, added: 0 };
    const have = new Set<string>([...(list.personIds ?? []), ...(list.removed ?? [])]);
    const fresh = rulePersonIds(index, list.rule, env).filter(id => !have.has(id));
    if (!fresh.length) return { list, added: 0 };
    const ordered = sortListIds(index, list, fresh, list.sort === 'manual' ? 'old' : list.sort, env);
    return { list: touched({ ...list, personIds: [...(list.personIds ?? []), ...ordered] }, now), added: ordered.length };
}

/** A person moved in a fixed list's manual order by `delta` places (clamped). */
export function withPersonMoved(list: PersonList, id: PersonId, delta: number, now: string): PersonList {
    if (list.dynamic || !list.personIds) return list;
    const from = list.personIds.indexOf(id);
    if (from < 0 || !delta) return list;
    const to = Math.max(0, Math.min(list.personIds.length - 1, from + delta));
    if (to === from) return list;
    const personIds = list.personIds.slice();
    personIds.splice(from, 1);
    personIds.splice(to, 0, id);
    return touched({ ...list, personIds }, now);
}

/** A new manual order (drag and drop): `ids` first, in that order, the rest after them as they were. */
export function withManualOrder(list: PersonList, ids: readonly PersonId[], now: string): PersonList {
    if (list.dynamic) return list;
    const have = new Set(list.personIds ?? []);
    const first = ids.filter(id => have.has(id));
    const rest = (list.personIds ?? []).filter(id => !first.includes(id));
    return touched({ ...list, personIds: [...first, ...rest], sort: 'manual' }, now);
}

/** Another order (an automatic list has no manual order); the manual order is kept for a return to it. */
export function withSort(list: PersonList, sort: PersonListSort, now: string): PersonList {
    if (list.sort === sort || (list.dynamic && sort === 'manual')) return list;
    return touched({ ...list, sort }, now);
}

/** "Freeze" (§7): fixed with the people it has now, in its order now; the rule stays as its origin. */
export function withFrozen(index: LineageIndex, list: PersonList, now: string, env: ListEnv = {}): PersonList {
    if (!list.dynamic) return list;
    const personIds = listPersonIds(index, list, env).slice();
    const next = touched({ ...list, dynamic: false, personIds, name: listDisplayName(list) }, now);
    return next;
}

/** "Tick off done" on or off (a fixed list only); off keeps what is done for the next time. */
export function withChecklist(list: PersonList, on: boolean, now: string): PersonList {
    if (list.dynamic || !!list.checklist === on) return list;
    const next = touched({ ...list }, now);
    if (on) next.checklist = true; else delete next.checklist;
    return next;
}

/** A person ticked off or back (a checklist only). */
export function withDoneToggled(list: PersonList, id: PersonId, now: string, done?: boolean): PersonList {
    if (!list.checklist || list.dynamic) return list;
    const set = new Set(list.done ?? []);
    const want = done ?? !set.has(id);
    if (want === set.has(id)) return list;
    if (want) set.add(id); else set.delete(id);
    const next = touched({ ...list }, now);
    const order = (list.personIds ?? []).filter(x => set.has(x));
    if (order.length) next.done = order; else delete next.done;
    return next;
}

/** The person words of a toast: the shown name and gender (cs: přidán / přidána). */
export function personToastName(data: StromData, id: PersonId): { name: string; gender: Gender | undefined } {
    const p = data.persons[id];
    return { name: p ? shownName(p) : '?', gender: p?.gender };
}
