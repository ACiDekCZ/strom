/**
 * A deterministic synthetic family tree for performance tests: founder couples
 * around 1650, then generation after generation of children who marry either
 * someone of their own generation in the tree (so deep pedigrees collapse, as
 * real village trees do) or an in-law from outside. Dates of varying precision
 * (full, year only, approximate), infant deaths, recorded ages, sources on
 * people, births, baptisms and unions, a few adoptive ties and placeholder
 * partners. Invented names only; the same seed gives the same tree.
 */

import {
    StromData, Person, PersonId, PartnershipId, Partnership, toPersonId, toPartnershipId,
} from '../../types.js';

export interface SyntheticOptions {
    /** Stop after this many persons (default 5000). */
    persons?: number;
    /** Founder couples of generation 0 (default 90). */
    founders?: number;
    seed?: number;
}

export interface SyntheticTree {
    data: StromData;
    /** A person of the youngest complete generation with both parents in the tree. */
    rootId: PersonId;
    /** Generations generated (0 = founders). */
    generations: number;
}

const FIRST_M = ['Adam', 'Bořek', 'Ctibor', 'Dalibor', 'Erik', 'Filip', 'Hynek', 'Ivo', 'Lumír', 'Radim'];
const FIRST_F = ['Alena', 'Blanka', 'Cecílie', 'Dana', 'Edita', 'Hedvika', 'Ilona', 'Jarmila', 'Libuše', 'Radka'];
const SURNAMES = ['Testák', 'Vzorník', 'Pokusný', 'Smyšlený', 'Ukázka', 'Fiktivní', 'Modelář', 'Příkladný'];

export function syntheticTree(opts: SyntheticOptions = {}): SyntheticTree {
    const N = opts.persons ?? 5000;
    let seed = opts.seed ?? 20261017;
    const r = (): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };
    const pick = <T>(list: T[]): T => list[Math.floor(r() * list.length)];
    const pad = (n: number): string => String(n).padStart(2, '0');

    const persons: Record<PersonId, Person> = {};
    const partnerships: Record<PartnershipId, Partnership> = {};
    const sources = Object.fromEntries(['s1', 's2', 's3', 's4', 's5'].map(id => [id, { id, title: `Register ${id}` }]));
    let pid = 0, uid = 0, eid = 0;
    const birthYear = new Map<PersonId, number>();

    const date = (year: number): string | undefined => {
        const x = r();
        if (x < 0.5) return `${year}-${pad(1 + Math.floor(r() * 12))}-${pad(1 + Math.floor(r() * 28))}`;
        if (x < 0.75) return `${year}`;
        if (x < 0.85) return `~${year}`;
        return undefined;
    };

    const make = (gender: 'male' | 'female', year: number, surname: string, extra: Partial<Person> = {}): Person => {
        const id = toPersonId(`p${++pid}`);
        const p: Person = {
            id, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
            firstName: pick(gender === 'male' ? FIRST_M : FIRST_F), lastName: surname, ...extra,
        };
        birthYear.set(id, year);
        if (p.isPlaceholder) { persons[id] = p; return p; }
        p.birthDate = date(year);
        if (r() < 0.6) p.birthPlace = `Ves ${Math.floor(r() * 120)}`;
        if (r() < 0.4) p.sourceIds = [pick(Object.keys(sources))];
        if (r() < 0.3) p.birthSourceIds = [pick(Object.keys(sources))];
        if (r() < 0.25) {
            p.events = [{ id: `e${++eid}`, type: 'baptism', date: `${year}`, place: r() < 0.5 ? 'Fara' : undefined,
                sourceIds: r() < 0.5 ? [pick(Object.keys(sources))] : undefined }];
        }
        const infant = r() < 0.18;
        const age = infant ? Math.floor(r() * 5) : 15 + Math.floor(r() * 80);
        const died = year + age;
        if (died < 2020) {
            const x = r();
            if (x < 0.65) p.deathDate = date(died) ?? `${died}`;
            else if (x < 0.72) p.deathAge = infant && age === 0 ? 'kojenec' : `${age} let`;
            if (r() < 0.4) p.deathPlace = `Ves ${Math.floor(r() * 120)}`;
            if (r() < 0.15) p.deathCause = pick(['souchotiny', 'vodnatelnost', 'sešlost věkem']);
        }
        if (r() < 0.02) p.question = 'Kdy přesně zemřel(a)?';
        persons[id] = p;
        return p;
    };

    const marry = (a: Person, b: Person, year: number): Partnership => {
        const id = toPartnershipId(`u${++uid}`);
        const u: Partnership = {
            id, person1Id: a.id, person2Id: b.id, childIds: [], status: 'married',
            ...(r() < 0.5 ? { startDate: `${year}` } : {}),
            ...(r() < 0.1 ? { sourceIds: [pick(Object.keys(sources))] } : {}),
        };
        partnerships[id] = u;
        a.partnerships.push(id);
        b.partnerships.push(id);
        return u;
    };

    const outsider = (gender: 'male' | 'female', year: number): Person =>
        r() < 0.03
            ? make(gender, year, '', { isPlaceholder: true, firstName: '' })
            : make(gender, year, pick(SURNAMES));

    // Generation 0: founder couples.
    type Couple = { u: Partnership; year: number; surname: string };
    let couples: Couple[] = [];
    for (let i = 0; i < (opts.founders ?? 90); i++) {
        const year = 1640 + Math.floor(r() * 20);
        const surname = pick(SURNAMES);
        const h = make('male', year, surname);
        const w = make('female', year + Math.floor(r() * 5), pick(SURNAMES));
        couples.push({ u: marry(h, w, year + 22), year, surname });
    }

    let generation = 0;
    let lastComplete: Person[] = [];
    while (pid < N && couples.length > 0) {
        const children: Person[] = [];
        for (const c of couples) {
            const kids = Math.floor(r() * 5); // 0..4
            for (let k = 0; k < kids && pid < N; k++) {
                const gender = r() < 0.5 ? 'male' : 'female';
                const child = make(gender, c.year + 25 + k * 2, c.surname);
                for (const parentId of [c.u.person1Id, c.u.person2Id]) {
                    child.parentIds.push(parentId);
                    persons[parentId].childIds.push(child.id);
                    if (r() < 0.01) child.parentRelTypes = { ...child.parentRelTypes, [parentId]: 'adoptive' };
                }
                c.u.childIds.push(child.id);
                children.push(child);
            }
        }
        if (pid >= N) break;
        generation++;
        lastComplete = children;

        // Marriages: within the generation (cousins included, siblings never) or with an outsider.
        const next: Couple[] = [];
        const married = new Set<PersonId>();
        const siblings = (a: Person, b: Person): boolean => a.parentIds.some(x => b.parentIds.includes(x));
        for (const p of children) {
            if (married.has(p.id) || pid >= N) continue;
            married.add(p.id);
            if (r() < 0.12) continue; // stays single
            const year = birthYear.get(p.id)!;
            let spouse: Person | undefined;
            if (r() < 0.75) {
                for (let tries = 0; tries < 8 && !spouse; tries++) {
                    const q = children[Math.floor(r() * children.length)];
                    if (!married.has(q.id) && q.gender !== p.gender && !siblings(p, q)) spouse = q;
                }
                if (spouse) married.add(spouse.id);
            }
            spouse ??= outsider(p.gender === 'male' ? 'female' : 'male', year + Math.floor(r() * 4) - 2);
            const [h, w] = p.gender === 'male' ? [p, spouse] : [spouse, p];
            next.push({ u: marry(h, w, year + 22), year, surname: h.lastName || p.lastName });
        }
        couples = next;
    }

    const root = lastComplete.find(p => p.parentIds.every(x => !persons[x].isPlaceholder) && p.parentIds.length === 2)
        ?? lastComplete[0];
    return {
        data: { persons, partnerships, sources } as StromData,
        rootId: root.id,
        generations: generation,
    };
}
