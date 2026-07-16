/**
 * Surnames that mean the same family (src/surnames.ts).
 *
 * The rule under test: a group is an equivalence written down ONCE for the tree.
 * Your great-grandfather is recorded Vyšek and you are Víšek — neither spelling
 * is the variant of the other, and a search for either must find both, whichever
 * way round they happen to be entered.
 */

import { describe, it, expect } from 'vitest';
import {
    surnameKey, surnameForms, sameSurname, addSurnameGroup, removeSurnameGroup, surnamesInTree,
    masculineForm, feminineForm,
} from '../surnames.js';
import { StromData, Person, PersonId, toPersonId } from '../types.js';

const tree = (groups?: string[][], people: Person[] = []): StromData => ({
    persons: Object.fromEntries(people.map(p => [p.id, p])) as Record<PersonId, Person>,
    partnerships: {},
    ...(groups ? { surnameVariants: groups } : {}),
});

function person(id: string, firstName: string, lastName: string, placeholder = false): Person {
    return {
        id: toPersonId(id), firstName, lastName, gender: 'male',
        isPlaceholder: placeholder, partnerships: [], parentIds: [], childIds: [],
    };
}

describe('surnameKey', () => {
    it('ignores case and diacritics, the way search does', () => {
        expect(surnameKey('Víšek')).toBe(surnameKey('VISEK'));
        expect(surnameKey('  Vyšek ')).toBe('vysek');
    });

    it('keeps genuinely different spellings apart', () => {
        expect(surnameKey('Víšek')).not.toBe(surnameKey('Vyšek'));
        expect(surnameKey('Víšek')).not.toBe(surnameKey('Wischek'));
    });
});

describe('sameSurname', () => {
    const data = tree([['Víšek', 'Vyšek', 'Wischek']]);

    it('matches any two spellings in the group, both ways round', () => {
        expect(sameSurname('Víšek', 'Vyšek', data)).toBe(true);
        expect(sameSurname('Vyšek', 'Víšek', data)).toBe(true);
        expect(sameSurname('Wischek', 'Vyšek', data)).toBe(true);
    });

    it('still matches a name with itself when no group mentions it', () => {
        expect(sameSurname('Svoboda', 'Svoboda', tree())).toBe(true);
        expect(sameSurname('Svoboda', 'svoboda', tree())).toBe(true);
    });

    it('does not make unrelated families the same', () => {
        expect(sameSurname('Víšek', 'Svoboda', data)).toBe(false);
    });

    it('has nothing to say about an empty name', () => {
        expect(sameSurname('', 'Víšek', data)).toBe(false);
    });
});

describe('surnameForms', () => {
    const data = tree([['Víšek', 'Vyšek', 'Wischek']]);

    it('gives every spelling, the person’s own first', () => {
        // The other gender rides along too, so searching either reaches the family.
        expect(surnameForms('Vyšek', data)).toEqual(['Vyšek', 'Vyšková', 'Víšek', 'Wischek']);
    });

    it('gives back a surname nobody grouped, plus its other gender', () => {
        expect(surnameForms('Svoboda', data)).toEqual(['Svoboda', 'Svobodová']);
    });
});

describe('addSurnameGroup', () => {
    it('writes the group down once', () => {
        expect(addSurnameGroup(tree(), ['Víšek', 'Vyšek'])).toEqual([['Víšek', 'Vyšek']]);
    });

    it('merges into a group it overlaps rather than making a rival one', () => {
        // {Vyšek, Wischek} exists; adding {Víšek, Vyšek} must end with one group
        // of three — otherwise Víšek and Wischek stay strangers though both are Vyšek.
        const data = tree([['Vyšek', 'Wischek']]);
        const groups = addSurnameGroup(data, ['Víšek', 'Vyšek']);
        expect(groups).toHaveLength(1);
        expect([...groups[0]].sort()).toEqual(['Vyšek', 'Víšek', 'Wischek'].sort());
    });

    it('leaves other families alone', () => {
        const data = tree([['Svoboda', 'Swoboda']]);
        const groups = addSurnameGroup(data, ['Víšek', 'Vyšek']);
        expect(groups).toHaveLength(2);
    });

    it('refuses a group of one — there is nothing to equate', () => {
        expect(addSurnameGroup(tree(), ['Víšek'])).toEqual([]);
        expect(addSurnameGroup(tree(), ['Víšek', '  '])).toEqual([]);
    });

    it('does not list the same spelling twice', () => {
        const groups = addSurnameGroup(tree(), ['Víšek', 'Víšek', 'Vyšek']);
        expect(groups[0]).toHaveLength(2);
    });
});

describe('removeSurnameGroup', () => {
    it('drops the group of whichever spelling you name', () => {
        const data = tree([['Víšek', 'Vyšek'], ['Svoboda', 'Swoboda']]);
        const groups = removeSurnameGroup(data, 'Vyšek');
        expect(groups).toEqual([['Svoboda', 'Swoboda']]);
    });
});

describe('surnamesInTree', () => {
    it('lists the surnames in use, commonest first', () => {
        const data = tree(undefined, [
            person('a', 'Jan', 'Víšek'), person('b', 'Petr', 'Víšek'),
            person('c', 'Josef', 'Svoboda'),
        ]);
        expect(surnamesInTree(data)).toEqual([
            { surname: 'Víšek', count: 2 },
            { surname: 'Svoboda', count: 1 },
        ]);
    });

    it('counts spellings separately — telling them apart is the point', () => {
        const data = tree(undefined, [person('a', 'Jan', 'Víšek'), person('b', 'Josef', 'Vyšek')]);
        expect(surnamesInTree(data)).toHaveLength(2);
    });

    it('ignores placeholders and the nameless', () => {
        const data = tree(undefined, [
            person('a', 'Jan', 'Víšek'), person('b', '?', 'Víšek', true), person('c', 'Kdo', ''),
        ]);
        expect(surnamesInTree(data)).toEqual([{ surname: 'Víšek', count: 1 }]);
    });
});

describe('masculine and feminine are one family (P1, found by testing a real tree)', () => {
    const empty = tree();

    it('sees through the vowel that drops — the case that was broken', () => {
        // Measured on a real tree: "Víšek" found 14 men and none of the 10
        // women, because the "e" disappears when the name is made feminine.
        expect(sameSurname('Víšek', 'Víšková', empty)).toBe(true);
        expect(sameSurname('Víšková', 'Víšek', empty)).toBe(true);
        expect(sameSurname('Adamec', 'Adamcová', empty)).toBe(true);
        expect(sameSurname('Pavel', 'Pavlová', empty)).toBe(true);
    });

    it('handles the plain ones, which only ever worked by accident', () => {
        // "novakova".includes("novak") is true, so search stumbled onto these.
        expect(sameSurname('Novák', 'Nováková', empty)).toBe(true);
        expect(sameSurname('Horák', 'Horáková', empty)).toBe(true);
    });

    it('handles adjectival surnames, where the substring trick never worked', () => {
        expect(sameSurname('Brodský', 'Brodská', empty)).toBe(true);
        expect(sameSurname('Zelený', 'Zelená', empty)).toBe(true);
        expect(sameSurname('Roštejnský', 'Roštejnská', empty)).toBe(true);
    });

    it('does NOT join different families that merely look alike', () => {
        // These all scored >= 0.7 on string similarity in the real tree, which
        // is why suggesting groups from similarity was dropped.
        expect(sameSurname('Krepčíková', 'Krejčíková', empty)).toBe(false);
        expect(sameSurname('Horáková', 'Nováková', empty)).toBe(false);
        expect(sameSurname('Víšková', 'Vaňková', empty)).toBe(false);
        expect(sameSurname('Novák', 'Horáková', empty)).toBe(false);
    });

    it('leaves names outside Czech alone', () => {
        expect(sameSurname('Tudor', 'Boleyn', empty)).toBe(false);
        expect(sameSurname('Schaffer', 'Seeman', empty)).toBe(false);
        expect(masculineForm('Tudor')).toBeNull();
        expect(masculineForm('Boleyn')).toBeNull();
    });

    it('reaches a woman through a grouped spelling of the man’s name', () => {
        // Vyšek is grouped with Víšek, so Vyšek must find Víšková too.
        const data = tree([['Víšek', 'Vyšek']]);
        expect(sameSurname('Vyšek', 'Víšková', data)).toBe(true);
    });

    it('offers the masculine form among a woman’s search terms', () => {
        expect(surnameForms('Víšková', empty)).toContain('Víšek');
    });

    it('works the other way too, or the two searches disagree', () => {
        // Measured: "Víšek" reached all 24 and "Víšková" only the 10 women —
        // an inconsistency nobody could explain to themselves.
        expect(surnameForms('Víšek', empty)).toContain('Víšková');
        expect(feminineForm('Víšek')).toBe('Víšková');
        expect(feminineForm('Adamec')).toBe('Adamcová');
        expect(feminineForm('Pavel')).toBe('Pavlová');
        expect(feminineForm('Novák')).toBe('Nováková');
        expect(feminineForm('Brodský')).toBe('Brodská');
    });

    it('drops the -a rather than gluing an ending onto it', () => {
        // Svobodaová was what the first attempt produced; the test caught it.
        expect(feminineForm('Svoboda')).toBe('Svobodová');
        expect(feminineForm('Kopřiva')).toBe('Kopřivová');
        expect(feminineForm('Mika')).toBe('Miková');
        expect(sameSurname('Svoboda', 'Svobodová', empty)).toBe(true);
        expect(sameSurname('Kopřiva', 'Kopřivová', empty)).toBe(true);
    });

    it('leaves indeclinable surnames alone — Macků is Macků for everyone', () => {
        expect(feminineForm('Macků')).toBeNull();
        expect(feminineForm('Kočí')).toBeNull();
        expect(feminineForm('Nových')).toBeNull();
    });

    it('does not try to feminise what is feminine already, or foreign', () => {
        expect(feminineForm('Nováková')).toBeNull();
        expect(feminineForm('Brodská')).toBeNull();
        // A German name gets a Czech ending only in a Czech tree's search text,
        // never in a comparison that could join two families.
        expect(sameSurname('Schaffer', 'Seeman', empty)).toBe(false);
    });
});
