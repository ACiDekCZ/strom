/**
 * An invented big family (about 3 000 people) for children and siblings at
 * once: the focus "z" with a wife and four children, every ancestor couple
 * up to six generations above with five children besides the one on the
 * line; each such child married, two children, each of them married with
 * two children of their own. Every third partner of a sibling had a marriage
 * before, with a child (a partner's other marriage the depth may hold), and
 * every fifth sibling stayed single. Deterministic; the names are invented.
 */

import type { StromData } from '../../types.js';

export function syntheticBigFamily(generations = 6): StromData {
    const persons: Record<string, Record<string, unknown>> = {};
    const partnerships: Record<string, Record<string, unknown>> = {};
    let serial = 0;
    const person = (id: string, gender: 'male' | 'female', parentIds: string[] = []): string => {
        serial++;
        persons[id] = {
            id, firstName: `Vrel${serial}`, lastName: 'Ostrakový', gender, isPlaceholder: false,
            partnerships: [], parentIds, childIds: [], birthDate: `${1990 - (serial % 300)}-01-01`,
        };
        return id;
    };
    const union = (id: string, a: string, b: string, childIds: string[]): void => {
        partnerships[id] = { id, person1Id: a, person2Id: b, childIds, status: 'married' };
        for (const p of [a, b]) {
            (persons[p].partnerships as string[]).push(id);
            (persons[p].childIds as string[]).push(...childIds);
        }
    };
    let partnerSerial = 0;
    /** A married person with `kids` children (each married with `grand` children when given). */
    const family = (id: string, gender: 'male' | 'female', kids: number, grand: number): void => {
        const sp = person(`${id}_s`, gender === 'male' ? 'female' : 'male');
        // Every third partner married before, with a child
        if (++partnerSerial % 3 === 0) {
            const ex = person(`${sp}_x`, gender);
            const exKid = person(`${sp}_xk`, 'female', [sp, ex]);
            union(`u_${sp}_x`, sp, ex, [exKid]);
        }
        const children: string[] = [];
        for (let i = 0; i < kids; i++) children.push(person(`${id}_c${i}`, i % 2 ? 'female' : 'male', gender === 'male' ? [id, sp] : [sp, id]));
        union(`u_${id}`, gender === 'male' ? id : sp, gender === 'male' ? sp : id, children);
        if (grand > 0) children.forEach((c, i) => family(c, i % 2 ? 'female' : 'male', grand, 0));
    };
    let siblingSerial = 0;
    const parentsOf = (child: string, prefix: string, gen: number): void => {
        const f = person(`${prefix}f`, 'male'), m = person(`${prefix}m`, 'female');
        persons[child].parentIds = [f, m];
        const kids = [child];
        for (let i = 0; i < 5; i++) {
            const k = person(`${prefix}k${i}`, i % 2 ? 'female' : 'male', [f, m]);
            kids.push(k);
            if (++siblingSerial % 5 !== 0) family(k, i % 2 ? 'female' : 'male', 2, 2);
        }
        union(`u_${prefix}`, f, m, kids);
        if (gen < generations) {
            parentsOf(f, `${prefix}f`, gen + 1);
            parentsOf(m, `${prefix}m`, gen + 1);
        }
    };
    person('z', 'male');
    family('z', 'male', 4, 0);
    parentsOf('z', 'a', 1);
    return { persons, partnerships } as unknown as StromData;
}
