/**
 * Finding the separate families inside one tree (N3).
 *
 * A tree file often holds several families that have nothing to do with each
 * other — usually because everything got imported into one tree. In graph terms
 * they are disconnected components of the kinship graph: no chain of
 * parent/child/partner links leads from one to another.
 *
 * That makes splitting them mechanical and lossless: no person can belong to two
 * components, so nothing has to be duplicated or decided. Splitting a CONNECTED
 * tree (your family and your wife's, joined by your marriage) is a different
 * problem — someone would have to be duplicated — and is deliberately not done
 * here; "make a tree from this view" covers that case, where the user sees
 * exactly what they are cutting.
 *
 * The detection is worth having on its own: it tells you a tree holds four
 * unrelated families, or that someone is linked to nobody at all.
 */

import { StromData, Person, PersonId } from './types.js';
import { yearOf } from './dates.js';

/** One family: a set of people no link connects to anyone outside it. */
export interface TreeComponent {
    personIds: PersonId[];
    /** Real people (placeholders excluded) — what the user would call the size. */
    count: number;
    /** Most common surnames, most frequent first — how a family is recognised. */
    surnames: string[];
    /** The earliest-born person, for telling two Novák families apart. */
    oldest?: { name: string; year: number };
}

/** Everyone linked to `start`, walked over parent/child/partner edges. */
function walkFrom(start: PersonId, data: StromData, seen: Set<PersonId>): PersonId[] {
    const group: PersonId[] = [];
    const queue: PersonId[] = [start];
    seen.add(start);

    while (queue.length > 0) {
        const id = queue.pop()!;
        const person = data.persons[id];
        if (!person) continue;
        group.push(id);

        const neighbours: PersonId[] = [...person.parentIds, ...person.childIds];
        // A partnership is an edge too: a childless married couple is ONE family,
        // not two people who happen to share a file.
        for (const unionId of person.partnerships) {
            const union = data.partnerships[unionId];
            if (!union) continue;
            neighbours.push(union.person1Id, union.person2Id);
            neighbours.push(...union.childIds);
        }

        for (const next of neighbours) {
            if (next && !seen.has(next) && data.persons[next]) {
                seen.add(next);
                queue.push(next);
            }
        }
    }
    return group;
}

/** Describe a group the way a person would recognise it. */
function describe(personIds: PersonId[], data: StromData): TreeComponent {
    const people = personIds.map(id => data.persons[id]).filter((p): p is Person => !!p);
    const real = people.filter(p => !p.isPlaceholder);

    const bySurname = new Map<string, number>();
    for (const p of real) {
        const name = p.lastName?.trim();
        if (name) bySurname.set(name, (bySurname.get(name) ?? 0) + 1);
    }
    const surnames = [...bySurname.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name]) => name)
        .slice(0, 3);

    let oldest: TreeComponent['oldest'];
    for (const p of real) {
        const year = yearOf(p.birthDate);
        if (year === null) continue;
        if (!oldest || year < oldest.year) {
            oldest = { name: `${p.firstName} ${p.lastName}`.trim(), year };
        }
    }

    return { personIds, count: real.length, surnames, oldest };
}

/**
 * The families in this tree, biggest first. One component means the tree is
 * a single family and there is nothing to split.
 */
export function findComponents(data: StromData): TreeComponent[] {
    const seen = new Set<PersonId>();
    const components: TreeComponent[] = [];

    for (const id of Object.keys(data.persons) as PersonId[]) {
        if (seen.has(id)) continue;
        components.push(describe(walkFrom(id, data, seen), data));
    }

    // Biggest first: the main family is what people look for, and the one-person
    // strays at the bottom are usually the surprise.
    return components.sort((a, b) => b.count - a.count
        || (a.surnames[0] ?? '').localeCompare(b.surnames[0] ?? ''));
}

/** A name to suggest for a component's own tree ("Novák family"). */
export function componentName(component: TreeComponent, template: (surname: string) => string,
    fallback: string): string {
    return component.surnames[0] ? template(component.surnames[0]) : fallback;
}
