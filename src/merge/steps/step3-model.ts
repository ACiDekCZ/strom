/**
 * Step 3's list (spec 134 §5) over the data alone: the new people as rows
 * with what the list shows and filters on, their grouping by family (rod)
 * or by the tree's person they link through, and the rows drawn for the
 * groups open. No DOM; the step and its tests share it.
 */

import type { Person, PersonId, StromData } from '../../types.js';
import type { MergePlan } from '../plan.js';
import { strings, getCurrentLanguage } from '../../strings.js';
import { yearOf } from '../../dates.js';
import { surnameKey } from '../../surnames.js';
import type { KinshipTerm } from '../../kinship.js';
import { displayName, familyName, type NewConnection } from '../plan-select.js';

export type S3GroupBy = 'rod' | 'via';

export interface S3Filters {
    /** Name, year or place. */
    query: string;
    /** A family's key (surnameKey of its name); '' for any. */
    surname: string;
    yearFrom: number | null;
    yearTo: number | null;
    place: string;
    withSource: boolean;
    /** Only the people others link to the tree through. */
    linking: boolean;
    living: boolean;
}

export const NO_FILTERS: S3Filters = {
    query: '', surname: '', yearFrom: null, yearTo: null, place: '', withSource: false, linking: false, living: false,
};

/** A new person as step 3's list shows it. */
export interface S3Person {
    id: PersonId;
    name: string;
    /** The family's name ('' for none) and its key ('-' for none). */
    family: string;
    rod: string;
    born: number | null;
    died: number | null;
    places: string[];
    living: boolean;
    hasSource: boolean;
    linking: boolean;
    conn?: NewConnection;
}

export interface S3Group {
    key: string;
    title: string;
    ids: PersonId[];
    /** The import's joined person the nearest of the group links through, and that person in the tree. */
    viaSource?: PersonId;
    via?: PersonId;
    /** "Others (n surnames)": how many surnames the group gathers. */
    surnames?: number;
}

export type S3Row =
    | { kind: 'group'; group: S3Group; open: boolean }
    | { kind: 'person'; id: PersonId; group: string };

/** Above this many families, the small ones (fewer than 3 people) go together under "Others". */
export const MAX_RODS = 12;
const SMALL_ROD = 3;
export const OTHERS_KEY = '~others';

/** Lower case without accents, for the search. */
export function fold(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** The people every other person's way to the tree goes through (not its ends). */
export function linkingPeople(conns: ReadonlyMap<PersonId, NewConnection>): Set<PersonId> {
    const out = new Set<PersonId>();
    for (const c of conns.values()) for (const id of c.path.slice(1, -1)) out.add(id);
    return out;
}

function hasSource(p: Person): boolean {
    if (p.sourceIds?.length || p.birthSourceIds?.length || p.deathSourceIds?.length) return true;
    return (p.events ?? []).some(e => !!e.sourceIds?.length);
}

/** The rows' people, in the order the list shows them (born first, then by name). */
export function step3People(
    source: StromData, ids: readonly PersonId[], living: ReadonlySet<PersonId>,
    conns: ReadonlyMap<PersonId, NewConnection>, linking: ReadonlySet<PersonId>,
): S3Person[] {
    const out: S3Person[] = [];
    for (const id of ids) {
        const p = source.persons[id];
        if (!p) continue;
        const family = familyName(source, p);
        out.push({
            id, name: displayName(p) || '?', family, rod: surnameKey(family) || '-',
            born: yearOf(p.birthDate), died: yearOf(p.deathDate),
            places: [p.birthPlace, p.deathPlace].filter((x): x is string => !!x && !!x.trim()),
            living: living.has(id), hasSource: hasSource(p), linking: linking.has(id), conn: conns.get(id),
        });
    }
    const lang = getCurrentLanguage();
    return out.sort((a, b) => (a.born ?? 9999) - (b.born ?? 9999) || a.name.localeCompare(b.name, lang));
}

/** "1842–1910", "* 1842", "† 1910" or ''. */
export function yearsText(p: Pick<S3Person, 'born' | 'died'>): string {
    if (p.born !== null && p.died !== null) return `${p.born}–${p.died}`;
    if (p.born !== null) return `* ${p.born}`;
    if (p.died !== null) return `† ${p.died}`;
    return '';
}

export function hasFilters(f: S3Filters): boolean {
    return !!(f.query.trim() || f.surname || f.yearFrom !== null || f.yearTo !== null || f.place.trim() || f.withSource || f.linking || f.living);
}

/** Whether a person passes the search and the filters. */
export function matchesFilters(p: S3Person, f: S3Filters): boolean {
    if (f.surname && p.rod !== f.surname) return false;
    if (f.withSource && !p.hasSource) return false;
    if (f.linking && !p.linking) return false;
    if (f.living && !p.living) return false;
    if (f.yearFrom !== null || f.yearTo !== null) {
        const from = f.yearFrom ?? -Infinity;
        const to = f.yearTo ?? Infinity;
        const years = [p.born, p.died].filter((y): y is number => y !== null);
        if (!years.some(y => y >= from && y <= to)) return false;
    }
    if (f.place.trim()) {
        const want = fold(f.place.trim());
        if (!p.places.some(pl => fold(pl).includes(want))) return false;
    }
    const q = fold(f.query.trim());
    if (q) {
        const words = q.split(/\s+/);
        const hay = fold([p.name, yearsText(p), ...p.places].join(' '));
        if (!words.every(w => hay.includes(w))) return false;
    }
    return true;
}

/** The families among the people, largest first: [key, name, count]. */
export function rodsOf(people: readonly S3Person[]): Array<{ key: string; name: string; count: number }> {
    const m = new Map<string, { key: string; name: string; count: number }>();
    for (const p of people) {
        const e = m.get(p.rod) ?? m.set(p.rod, { key: p.rod, name: p.family, count: 0 }).get(p.rod)!;
        e.count++;
    }
    const lang = getCurrentLanguage();
    return [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, lang));
}

/**
 * The groups of the list: by family (the largest first; above MAX_RODS
 * families the ones with fewer than 3 people together under "Others"), or
 * by the tree's person the people link through.
 */
export function groupPeople(people: readonly S3Person[], by: S3GroupBy, tree: StromData, source: StromData): S3Group[] {
    const t = strings.mergeWizard;
    const nearest = (ids: PersonId[], index: Map<PersonId, S3Person>): Pick<S3Group, 'viaSource' | 'via'> => {
        let best: NewConnection | undefined;
        for (const id of ids) {
            const c = index.get(id)?.conn;
            if (c && (!best || c.steps < best.steps)) best = c;
        }
        return best ? { viaSource: best.viaSource, via: best.via } : {};
    };
    const index = new Map(people.map(p => [p.id, p]));
    if (by === 'via') {
        const m = new Map<string, S3Group>();
        for (const p of people) {
            const key = p.conn ? `v:${p.conn.viaSource}` : 'v:-';
            let g = m.get(key);
            if (!g) {
                const treePerson = p.conn ? tree.persons[p.conn.via] : undefined;
                const title = p.conn ? (displayName(treePerson) || displayName(source.persons[p.conn.viaSource]) || '?') : t.s3NoLink;
                m.set(key, g = { key, title, ids: [], viaSource: p.conn?.viaSource, via: p.conn?.via });
            }
            g.ids.push(p.id);
        }
        return [...m.values()].sort((a, b) => b.ids.length - a.ids.length);
    }
    const rods = rodsOf(people);
    const many = rods.length > MAX_RODS;
    const groups: S3Group[] = [];
    const others: S3Group = { key: OTHERS_KEY, title: '', ids: [], surnames: 0 };
    const byRod = new Map<string, PersonId[]>();
    for (const p of people) (byRod.get(p.rod) ?? byRod.set(p.rod, []).get(p.rod)!).push(p.id);
    for (const r of rods) {
        const ids = byRod.get(r.key)!;
        if (many && r.count < SMALL_ROD) { others.ids.push(...ids); others.surnames!++; continue; }
        groups.push({ key: `r:${r.key}`, title: r.name || t.s3NoSurname, ids, ...nearest(ids, index) });
    }
    if (others.ids.length) {
        others.title = t.s3Others(others.surnames!);
        Object.assign(others, nearest(others.ids, index));
        const order = new Map(people.map((p, i) => [p.id, i]));
        others.ids.sort((a, b) => order.get(a)! - order.get(b)!);
        groups.push(others);
    }
    return groups;
}

/** The rows drawn: each group's header, and its people when open. */
export function listRows(groups: readonly S3Group[], isOpen: (key: string) => boolean): S3Row[] {
    const rows: S3Row[] = [];
    for (const g of groups) {
        const open = isOpen(g.key);
        rows.push({ kind: 'group', group: g, open });
        if (open) for (const id of g.ids) rows.push({ kind: 'person', id, group: g.key });
    }
    return rows;
}

/** A group's checkbox: all ticked, none, or some. */
export function triState(ids: readonly PersonId[], ticked: ReadonlySet<PersonId>): 'all' | 'none' | 'some' {
    let n = 0;
    for (const id of ids) if (ticked.has(id)) n++;
    return n === 0 ? 'none' : n === ids.length ? 'all' : 'some';
}

/** Where a person links: "father of Josef Jilm" (the next person on its way), '' with no way. */
export function relationText(source: StromData, conn: NewConnection | undefined, term: KinshipTerm | null): string {
    if (!conn) return '';
    const t = strings.mergeWizard;
    const next = displayName(source.persons[conn.next]) || '?';
    const lang = getCurrentLanguage();
    const word = term ? ((lang === 'cs' || lang === 'de' || lang === 'pl') ? term[lang] : term.en) : '';
    return word ? t.s3Rel(word, next) : t.s3RelPlain(next);
}

/**
 * "a of n new selected", from the plan: n = the new people (added, left out
 * in step 3, as living, with a branch or a group, still to decide in a
 * group), a = those the plan adds or still asks about in a group.
 */
export function selectionCounts(plan: MergePlan): { selected: number; of: number } {
    let selected = 0;
    let of = 0;
    for (const it of plan.items) {
        if (it.kind === 'person-add') { of++; if (it.on) selected++; }
        else if (it.kind === 'group-pending') { of++; selected++; }
        else if (it.kind === 'skip' && it.reason !== 'step2' && it.reason !== 'scope') of++;
    }
    return { selected, of };
}
