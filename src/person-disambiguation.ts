/**
 * The quiet line under a person in a list of search results that tells who
 * it is (1128: two people of the same name without years looked the same).
 *
 * A row gets the line when it has no years, or when another row of the same
 * result has the same shown name. The line is one detail from what the tree
 * knows, tried in this order: the parents ("daughter of …"), a partner
 * ("⚭ …"), the birthplace, last residence or occupation, and last the
 * generation counted from the focus. In a group of the same name it is the
 * first detail no other row of the group has the same; else the first known.
 * The details are the ones the tree shows already (names as the rows show
 * them, the card's occupation), nothing new.
 */

import { Person, PersonId, StromData } from './types.js';
import { strings } from './strings.js';
import { titlesShown, surnameDisplay } from './person-name.js';
import { distinguishFeatures, partnerNames, rowKey } from './picker-distinguish.js';
import { cardOccupation } from './card-fields.js';

/** The four details in the order they are tried: parents, partner, place (or occupation), generation (null = unknown). */
export type HintFeatures = [string | null, string | null, string | null, string | null];

export interface PersonHintOptions {
    /** The row shows years after the name (a row with years and a name of its own needs no line). */
    hasYears: (person: Person) => boolean;
    /** The person generations are counted from (the focus, generation 0 of the tree); null: none. */
    rootId: PersonId | null;
}

/**
 * Generations counted from `rootId` over the tree's links: a parent one up
 * (−1), a child one down (+1), a partner the same. The nearest way wins;
 * people with no way to the root are left out.
 */
export function generationsFrom(data: StromData, rootId: PersonId): Map<PersonId, number> {
    const gen = new Map<PersonId, number>();
    if (!data.persons[rootId]) return gen;
    gen.set(rootId, 0);
    const queue: PersonId[] = [rootId];
    for (let i = 0; i < queue.length; i++) {
        const id = queue[i];
        const p = data.persons[id];
        const g = gen.get(id)!;
        const visit = (next: PersonId, ng: number): void => {
            if (gen.has(next) || !data.persons[next]) return;
            gen.set(next, ng);
            queue.push(next);
        };
        for (const pid of p.parentIds ?? []) visit(pid, g - 1);
        for (const cid of p.childIds ?? []) visit(cid, g + 1);
        for (const uid of p.partnerships ?? []) {
            const u = data.partnerships?.[uid];
            if (u) visit(u.person1Id === id ? u.person2Id : u.person1Id, g);
        }
    }
    return gen;
}

/** The line chosen from a row's details against the other rows of its group (empty for a row alone). */
export function hintLine(own: HintFeatures, others: readonly HintFeatures[]): string | null {
    if (others.length) {
        const apart = own.find((v, i) => v !== null && others.every(o => o[i] !== v));
        if (apart) return apart;
    }
    return own.find((v): v is string => v !== null) ?? (others.length ? strings.personPicker.distNone : null);
}

/**
 * The lines of one result, by person: only the rows that need one (no years,
 * or a name another row has too) and have something to say.
 */
export function personHints(result: readonly Person[], data: StromData, opts: PersonHintOptions): Map<PersonId, string> {
    const show = titlesShown();
    const display = surnameDisplay();
    const groups = new Map<string, Person[]>();
    for (const p of result) {
        const key = rowKey(p, false, show, display);
        const g = groups.get(key);
        if (g) g.push(p);
        else groups.set(key, [p]);
    }
    let gens: Map<PersonId, number> | null = null;
    const generation = (p: Person): string | null => {
        if (!opts.rootId) return null;
        gens ??= generationsFrom(data, opts.rootId);
        const g = gens.get(p.id);
        return g === undefined ? null : strings.personPicker.distGeneration(g);
    };
    const out = new Map<PersonId, string>();
    for (const group of groups.values()) {
        const repeated = group.length >= 2;
        const rows = repeated ? group : group.filter(p => !opts.hasYears(p));
        if (!rows.length) continue;
        // A partner the other rows of the group do not have is the one named.
        const partnersOf = group.map(p => partnerNames(p, data, show, display));
        const rowsWith = new Map<string, number>();
        partnersOf.forEach(names => names.forEach(n => rowsWith.set(n, (rowsWith.get(n) ?? 0) + 1)));
        const features = group.map((p, i): HintFeatures => {
            const own = partnersOf[i];
            const othersHavePartner = (name: string): boolean => (rowsWith.get(name) ?? 0) - (own.includes(name) ? 1 : 0) > 0;
            const [, partner, parents, place] = distinguishFeatures(p, data, { showBirthYear: true, othersHavePartner, show, display });
            const job = place ? null : cardOccupation(p);
            return [parents, partner, place ?? (job ? strings.personPicker.distJob(job) : null), generation(p)];
        });
        for (const p of rows) {
            const i = group.indexOf(p);
            const line = hintLine(features[i], repeated ? features.filter((_, j) => j !== i) : []);
            if (line) out.set(p.id, line);
        }
    }
    return out;
}
