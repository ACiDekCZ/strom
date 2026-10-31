/**
 * A tree of family lines for the tree overview's "Family lines" section:
 * three lines over the small threshold that marry into each other, two
 * small families and wives without recorded parents. Invented names only.
 *
 *   Brandvold (Ekeby, from ~1702)   nine generations, living members
 *   Tallqvist (Västerby, from 1745) a daughter marries a Brandvold
 *   Hollberg  (Rydsjö, from 1690)   a daughter marries the Brandvold founder
 *   Ostrander, Kvarnby              two and three people
 */

type P = Record<string, unknown>;

export interface RodsTree {
    persons: Record<string, P>;
    partnerships: Record<string, P>;
    defaultPersonId: string;
}

export function rodsTree(opts: { long?: boolean } = {}): RodsTree {
    const persons: Record<string, P> = {};
    const partnerships: Record<string, P> = {};
    const brandvold = opts.long ? 'Brandvold-Ekhammarsson Lindenau' : 'Brandvold';
    const add = (id: string, firstName: string, lastName: string, gender: 'male' | 'female', extra: P = {}): void => {
        persons[id] = {
            id, firstName, lastName, gender, isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], ...extra,
        };
    };
    const union = (uid: string, a: string, b: string, children: string[]): void => {
        partnerships[uid] = { id: uid, person1Id: a, person2Id: b, childIds: children, status: 'married' };
        (persons[a].partnerships as string[]).push(uid);
        (persons[b].partnerships as string[]).push(uid);
        for (const c of children) {
            for (const p of [a, b]) {
                (persons[c].parentIds as string[]).push(p);
                (persons[p].childIds as string[]).push(c);
            }
        }
    };

    // Hollberg: Rydsjö, a daughter (Signe) marries the Brandvold founder.
    add('h1', 'Gudmund', 'Hollberg', 'male', { birthDate: '1690', deathDate: '1750', birthPlace: 'Rydsjö' });
    add('h1w', 'Brita', 'Fagerholm', 'female', { birthDate: '1695' });
    add('h2', 'Lars', 'Hollberg', 'male', { birthDate: '1712', birthPlace: 'Rydsjö' });
    add('h3', 'Signe', 'Hollberg', 'female', { birthDate: '1715', deathDate: '1780', birthPlace: 'Rydsjö' });
    add('h2w', 'Elsa', 'Rydbeck', 'female', { birthDate: '1716' });
    add('h4', 'Mats', 'Hollberg', 'male', { birthDate: '1740', birthPlace: 'Rydsjö' });
    add('h5', 'Anna', 'Hollberg', 'female', { birthDate: '1743', birthPlace: 'Rydsjö' });
    union('hu1', 'h1', 'h1w', ['h2', 'h3']);
    union('hu2', 'h2', 'h2w', ['h4', 'h5']);

    // Tallqvist: Västerby, a daughter (Ingrid) marries a Brandvold.
    add('t1', 'Henrik', 'Tallqvist', 'male', { birthDate: '1745', deathDate: '1810', birthPlace: 'Västerby' });
    add('t1w', 'Kerstin', 'Sjöquist', 'female', { birthDate: '1748' });
    add('t2', 'Petter', 'Tallqvist', 'male', { birthDate: '1768', birthPlace: 'Västerby' });
    add('t3', 'Ingrid', 'Tallqvist', 'female', { birthDate: '1770', deathDate: '1835', birthPlace: 'Västerby' });
    add('t4', 'Jonas', 'Tallqvist', 'male', { birthDate: '1772', birthPlace: 'Västerby' });
    add('t2w', 'Maria', 'Torvalla', 'female', { birthDate: '1771' });
    add('t5', 'August', 'Tallqvist', 'male', { birthDate: '1795', deathDate: '1860', birthPlace: 'Västerby' });
    union('tu1', 't1', 't1w', ['t2', 't3', 't4']);
    union('tu2', 't2', 't2w', ['t5']);

    // Brandvold: Ekeby, six generations down to living members.
    add('b1', 'Arvid', brandvold, 'male', { birthDate: '~1702', deathDate: '1771', birthPlace: 'Ekeby' });
    union('bu1', 'b1', 'h3', []);
    add('b2', 'Nils', brandvold, 'male', { birthDate: '1735', deathDate: '1800', birthPlace: 'Ekeby' });
    add('b3', 'Per', brandvold, 'male', { birthDate: '1737', birthPlace: 'Ekeby' });
    add('b4', 'Karin', brandvold, 'female', { birthDate: '1744', birthPlace: 'Ekeby' });
    for (const c of ['b2', 'b3', 'b4']) {
        (partnerships.bu1.childIds as string[]).push(c);
        for (const p of ['b1', 'h3']) {
            (persons[c].parentIds as string[]).push(p);
            (persons[p].childIds as string[]).push(c);
        }
    }
    // Karin marries into the Tallqvist line.
    union('xu1', 't4', 'b4', []);
    add('b2w', 'Maja', 'Hasselgren', 'female', { birthDate: '1738' });
    add('b5', 'Olof', brandvold, 'male', { birthDate: '1765', deathDate: '1830', birthPlace: 'Ekeby' });
    add('b6', 'Erik', brandvold, 'male', { birthDate: '1767', birthPlace: 'Ekeby' });
    add('b7', 'Lisa', brandvold, 'female', { birthDate: '1769', birthPlace: 'Ekeby' });
    union('bu2', 'b2', 'b2w', ['b5', 'b6', 'b7']);
    add('b8', 'Johan', brandvold, 'male', { birthDate: '1795', deathDate: '1860', birthPlace: 'Ekeby' });
    add('b9', 'Sven', brandvold, 'male', { birthDate: '1797', birthPlace: 'Ekeby' });
    union('bu3', 'b5', 't3', ['b8', 'b9']);
    add('b8w', 'Hedda', 'Vinterlund', 'female', { birthDate: '1800' });
    add('b10', 'Gustaf', brandvold, 'male', { birthDate: '1825', deathDate: '1890', birthPlace: 'Ekeby' });
    add('b11', 'Emma', brandvold, 'female', { birthDate: '1828', birthPlace: 'Ekeby' });
    union('bu4', 'b8', 'b8w', ['b10', 'b11']);
    add('b10w', 'Asta', 'Ekhammar', 'female', { birthDate: '1830' });
    add('b12', 'Viktor', brandvold, 'male', { birthDate: '1860', deathDate: '1931', birthPlace: 'Ekeby' });
    union('bu5', 'b10', 'b10w', ['b12']);
    add('b12w', 'Dagny', 'Ostrander', 'female', { birthDate: '1864' });
    add('b13', 'Axel', brandvold, 'male', { birthDate: '1888', deathDate: '1960', birthPlace: 'Ekeby' });
    union('bu6', 'b12', 'b12w', ['b13']);
    add('b13w', 'Rut', 'Hasselgren', 'female', { birthDate: '1892' });
    add('b14', 'Karl', brandvold, 'male', { birthDate: '1922', deathDate: '1999', birthPlace: 'Ekeby' });
    union('bu7', 'b13', 'b13w', ['b14']);
    add('b14w', 'Ester', 'Fagerholm', 'female', { birthDate: '1925' });
    add('b15', 'Lena', brandvold, 'female', { birthDate: '1955', birthPlace: 'Ekeby' });
    add('b16', 'Mikael', brandvold, 'male', { birthDate: '1958', birthPlace: 'Ekeby' });
    union('bu8', 'b14', 'b14w', ['b15', 'b16']);

    // Ostrander: Dagny's father and brother (a small family of three).
    add('o1', 'Anton', 'Ostrander', 'male', { birthDate: '1835' });
    add('o1w', 'Stina', 'Kvarnby', 'female', { birthDate: '1838' });
    add('o2', 'Albin', 'Ostrander', 'male', { birthDate: '1866' });
    union('ou1', 'o1', 'o1w', ['b12w', 'o2']);
    // Kvarnby: Stina's father (a small family of two).
    add('k1', 'Olle', 'Kvarnby', 'male', { birthDate: '1810' });
    add('k1w', 'Greta', 'Lindenau', 'female', { birthDate: '1812' });
    union('ku1', 'k1', 'k1w', ['o1w']);

    return { persons, partnerships, defaultPersonId: 'b16' };
}

/** Part of a tree: only the given people, their links and unions among themselves. */
export function subTree(tree: RodsTree, ids: string[], focus: string): RodsTree {
    const keep = new Set(ids);
    const persons: Record<string, P> = {};
    const partnerships: Record<string, P> = {};
    for (const [uid, u] of Object.entries(tree.partnerships)) {
        if (keep.has(u.person1Id as string) && keep.has(u.person2Id as string)) {
            partnerships[uid] = { ...u, childIds: (u.childIds as string[]).filter(c => keep.has(c)) };
        }
    }
    for (const id of ids) {
        const p = tree.persons[id];
        persons[id] = {
            ...p,
            parentIds: (p.parentIds as string[]).filter(x => keep.has(x)),
            childIds: (p.childIds as string[]).filter(x => keep.has(x)),
            partnerships: (p.partnerships as string[]).filter(x => partnerships[x]),
        };
    }
    return { persons, partnerships, defaultPersonId: focus };
}
