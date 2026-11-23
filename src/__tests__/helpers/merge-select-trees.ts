/**
 * Small invented trees for step 3 of the import guide (spec 134 §5, §6):
 * the tree "Modřínovi" and an import of the Jilm family, with the persons
 * both know joined by hand (no matching), so every test says exactly who
 * is joined and who is new.
 */

import { MergeState } from '../../merge/types.js';
import { Gender, Partnership, PartnershipId, Person, PersonId, StromData } from '../../types.js';
import { WizardChoices, PlanSource } from '../../merge/plan.js';

const MALE = ['Ostromír', 'Mezislav', 'Prostivoj', 'Lutobor', 'Slavibor', 'Bezprym', 'Dobromil', 'Ratiboj', 'Spytihněv', 'Jaroboj', 'Nedabyl'];
const FEMALE = ['Unislava', 'Prkoslava', 'Svatoslava', 'Zdeslava', 'Hněvslava', 'Vojtíra'];

export class Family {
    readonly data: StromData = { persons: {}, partnerships: {} };
    private n = 0;
    constructor(private readonly prefix: string) {}

    person(gender: Gender, lastName: string, year: number | null, o: Partial<Person> = {}): Person {
        const i = ++this.n;
        const id = `${this.prefix}${i}` as PersonId;
        const names = gender === 'female' ? FEMALE : MALE;
        const p: Person = {
            id, gender, isPlaceholder: false, firstName: names[i % names.length],
            lastName: gender === 'female' && lastName && !lastName.endsWith('á') ? `${lastName}ová` : lastName,
            partnerships: [], parentIds: [], childIds: [],
            ...(year !== null ? { birthDate: String(year) } : {}),
            ...o,
        };
        this.data.persons[id] = p;
        return p;
    }
    couple(a: Person, b: Person): Partnership {
        const id = `${this.prefix}u${++this.n}` as PartnershipId;
        const u: Partnership = { id, person1Id: a.id, person2Id: b.id, childIds: [], status: 'married' };
        this.data.partnerships[id] = u;
        a.partnerships.push(id);
        b.partnerships.push(id);
        return u;
    }
    /** A child of the couple, or of one parent alone. */
    child(of: Partnership | Person, c: Person): Person {
        const parents = 'person1Id' in of ? [of.person1Id, of.person2Id] : [of.id];
        if ('person1Id' in of) of.childIds.push(c.id);
        for (const pid of parents) {
            c.parentIds.push(pid);
            this.data.persons[pid].childIds.push(c.id);
        }
        return c;
    }
    /**
     * Descendants below a couple: `kids` children each generation, each child
     * married (to a Modřín spouse) and with children of their own while
     * `depth` lasts. Returns every person made (spouses included).
     */
    branch(u: Partnership, year: number, kids: number, depth: number): Person[] {
        const made: Person[] = [];
        const father = this.data.persons[u.person1Id];
        for (let i = 0; i < kids; i++) {
            const g: Gender = i % 2 ? 'female' : 'male';
            const c = this.child(u, this.person(g, father.lastName, year + 25 + i));
            made.push(c);
            if (depth > 0) {
                const s = this.person(g === 'male' ? 'female' : 'male', 'Modřín', year + 26);
                made.push(s);
                const cu = g === 'male' ? this.couple(c, s) : this.couple(s, c);
                made.push(...this.branch(cu, year + 25, kids, depth - 1));
            }
        }
        return made;
    }
}

/** A comparison with these joined pairs (import id → tree id) and nobody else matched. */
export function stateOf(target: StromData, source: StromData, pairs: ReadonlyArray<[PersonId, PersonId]>): MergeState {
    const joined = new Set(pairs.map(([s]) => s));
    return {
        existingData: target,
        incomingData: source,
        matches: [],
        unmatchedExisting: [],
        unmatchedIncoming: (Object.keys(source.persons) as PersonId[]).filter(id => !joined.has(id) && !source.persons[id].isPlaceholder),
        decisions: new Map(pairs.map(([s, t]) => [s, { type: 'manual_match' as const, targetId: t }])),
        conflictResolutions: new Map(),
        partnershipResolutions: new Map(),
        phase: 'reviewing',
    };
}

const SOURCE: PlanSource = { kind: 'ged', label: 'rodokmen-jilmovi.ged', persons: 0 };

export function addChoices(over: Partial<WizardChoices> = {}): WizardChoices {
    return {
        mode: 'add', targetTreeId: 'tree-modřín' as WizardChoices['targetTreeId'], scope: 'a', swapped: false,
        source: SOURCE, targetName: 'Modřínovi', targetFingerprint: 'fp-target', planId: 'mp-select', createdAt: '2026-05-04T10:00:00.000Z',
        ...over,
    };
}
