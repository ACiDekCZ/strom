import type { StromData } from '../src/types';

/**
 * A rich pair for step 2 of the import guide on a wider window (spec 134,
 * dotaz 10, 4f–4k): the tree's Hostivít Brslen 1838 of Vrbičany with two
 * parents, one partner, five children and five records, a namesake who died
 * as a child (a second candidate), and an import with the same family less
 * fully known (four children, one record), plus a few more pairs to fill the
 * list. The family Brslen, the family Svída and the places Vrbičany and
 * Dřínov are invented.
 */

type P = StromData['persons'][string];

function person(id: string, firstName: string, lastName: string, gender: 'male' | 'female', extra: Partial<P> = {}): P {
    return { id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra } as P;
}

const CHILDREN: Array<[string, string, 'male' | 'female', string, string]> = [
    ['teofil', 'Teofil', 'male', '1871', '1933'],
    ['kunigunda', 'Kunigunda', 'female', '1873', '1947'],
    ['zbynka', 'Zbyňka', 'female', '1876', '1877'],
    ['bonifac', 'Bonifác', 'male', '1879', '1950'],
    ['kvido', 'Kvido', 'male', '1882', '1940'],
];

/** The tree Brslenovi. */
export function brslenoviTree(): StromData {
    const persons: Record<string, P> = {
        t_bozetech: person('t_bozetech', 'Božetěch', 'Brslen', 'male', { birthDate: '1805', deathDate: '1870', partnerships: ['t_u0'], childIds: ['t_hostivit'] } as Partial<P>),
        t_eufrozina: person('t_eufrozina', 'Eufrozína', 'Brslenová', 'female', { birthDate: '1810', deathDate: '1880', partnerships: ['t_u0'], childIds: ['t_hostivit'] } as Partial<P>),
        t_hostivit: person('t_hostivit', 'Hostivít', 'Brslen', 'male', {
            birthDate: '1838-03-12', birthPlace: 'Vrbičany', deathDate: '1901-11-04', deathPlace: 'Vrbičany',
            parentIds: ['t_bozetech', 't_eufrozina'], partnerships: ['t_u1'], childIds: CHILDREN.map(c => `t_${c[0]}`),
            sourceIds: ['s1', 's2', 's3', 's4', 's5'],
        } as Partial<P>),
        t_florentyna: person('t_florentyna', 'Florentýna', 'Svídová', 'female', { birthDate: '1842', deathDate: '1913', partnerships: ['t_u1'], childIds: CHILDREN.map(c => `t_${c[0]}`) } as Partial<P>),
        // The namesake who died as a child: a second candidate of another time.
        t_hostivit2: person('t_hostivit2', 'Hostivít', 'Brslen', 'male', { birthDate: '1867', deathDate: '1868', birthPlace: 'Vrbičany' } as Partial<P>),
    };
    for (const [key, name, gender, born, died] of CHILDREN) {
        persons[`t_${key}`] = person(`t_${key}`, name, gender === 'male' ? 'Brslen' : 'Brslenová', gender,
            { birthDate: born, deathDate: died, parentIds: ['t_hostivit', 't_florentyna'] } as Partial<P>);
    }
    return {
        version: 26,
        persons,
        partnerships: {
            t_u0: { id: 't_u0', person1Id: 't_bozetech', person2Id: 't_eufrozina', childIds: ['t_hostivit'], status: 'married' },
            t_u1: { id: 't_u1', person1Id: 't_hostivit', person2Id: 't_florentyna', childIds: CHILDREN.map(c => `t_${c[0]}`), status: 'married', startDate: '1866', startPlace: 'Vrbičany' },
        },
        sources: {
            s1: { id: 's1', title: 'Matrika Vrbičany N 1838, fol. 12' },
            s2: { id: 's2', title: 'Matrika Vrbičany O 1866, fol. 41' },
            s3: { id: 's3', title: 'Sčítání lidu 1880, Vrbičany č. 14' },
            s4: { id: 's4', title: 'Matrika Vrbičany Z 1901, fol. 7' },
            s5: { id: 's5', title: 'Pozemková kniha Dřínov' },
        },
    } as unknown as StromData;
}

/** The import: the same family, Hostivít born 1839, four children, one record. */
export function brslenoviFile(): StromData {
    const kids = CHILDREN.filter(c => c[0] !== 'zbynka');
    const persons: Record<string, P> = {
        i_bozetech: person('i_bozetech', 'Božetěch', 'Brslen', 'male', { partnerships: ['i_u0'], childIds: ['i_hostivit'] } as Partial<P>),
        i_eufrozina: person('i_eufrozina', 'Eufrozína', 'Brslenová', 'female', { partnerships: ['i_u0'], childIds: ['i_hostivit'] } as Partial<P>),
        i_hostivit: person('i_hostivit', 'Hostivít', 'Brslen', 'male', {
            birthDate: '1839', birthPlace: 'Vrbičany', deathDate: '1901', deathPlace: 'Vrbičany',
            parentIds: ['i_bozetech', 'i_eufrozina'], partnerships: ['i_u1'], childIds: kids.map(c => `i_${c[0]}`), sourceIds: ['x1'],
        } as Partial<P>),
        i_florentyna: person('i_florentyna', 'Florentýna', 'Svídová', 'female', { partnerships: ['i_u1'], childIds: kids.map(c => `i_${c[0]}`) } as Partial<P>),
    };
    for (const [key, name, gender, born] of kids) {
        persons[`i_${key}`] = person(`i_${key}`, name, gender === 'male' ? 'Brslen' : 'Brslenová', gender,
            { birthDate: born, parentIds: ['i_hostivit', 'i_florentyna'] } as Partial<P>);
    }
    return {
        version: 26,
        persons,
        partnerships: {
            i_u0: { id: 'i_u0', person1Id: 'i_bozetech', person2Id: 'i_eufrozina', childIds: ['i_hostivit'], status: 'married' },
            i_u1: { id: 'i_u1', person1Id: 'i_hostivit', person2Id: 'i_florentyna', childIds: kids.map(c => `i_${c[0]}`), status: 'married', startDate: '1866' },
        },
        sources: { x1: { id: 'x1', title: 'Rodokmen z internetu (bez citace)' } },
    } as unknown as StromData;
}
