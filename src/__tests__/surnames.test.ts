/**
 * Surnames that mean the same family (src/surnames.ts).
 *
 * The rule under test: a group is an equivalence written down ONCE for the tree.
 * Your great-grandfather is recorded Fyšek and you are Fíšek — neither spelling
 * is the variant of the other, and a search for either must find both, whichever
 * way round they happen to be entered.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    surnameKey, surnameForms, sameSurname, addSurnameGroup, removeSurnameGroup, surnamesInTree,
    masculineForm, feminineForm, czechRulesApply, feminineFormIn, masculineFormIn, genderRulesApply,
} from '../surnames.js';
import { setLanguage } from '../strings.js';
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
        expect(surnameKey('Fíšek')).toBe(surnameKey('FISEK'));
        expect(surnameKey('  Fyšek ')).toBe('fysek');
    });

    it('keeps genuinely different spellings apart', () => {
        expect(surnameKey('Fíšek')).not.toBe(surnameKey('Fyšek'));
        expect(surnameKey('Fíšek')).not.toBe(surnameKey('Fischek'));
    });
});

describe('sameSurname', () => {
    const data = tree([['Fíšek', 'Fyšek', 'Fischek']]);

    it('matches any two spellings in the group, both ways round', () => {
        expect(sameSurname('Fíšek', 'Fyšek', data)).toBe(true);
        expect(sameSurname('Fyšek', 'Fíšek', data)).toBe(true);
        expect(sameSurname('Fischek', 'Fyšek', data)).toBe(true);
    });

    it('still matches a name with itself when no group mentions it', () => {
        expect(sameSurname('Svoboda', 'Svoboda', tree())).toBe(true);
        expect(sameSurname('Svoboda', 'svoboda', tree())).toBe(true);
    });

    it('does not make unrelated families the same', () => {
        expect(sameSurname('Fíšek', 'Svoboda', data)).toBe(false);
    });

    it('has nothing to say about an empty name', () => {
        expect(sameSurname('', 'Fíšek', data)).toBe(false);
    });
});

describe('surnameForms', () => {
    const data = tree([['Fíšek', 'Fyšek', 'Fischek']]);

    it('gives every spelling, the person’s own first', () => {
        // The other gender rides along too, so searching either reaches the family.
        expect(surnameForms('Fyšek', data)).toEqual(['Fyšek', 'Fyšková', 'Fíšek', 'Fischek']);
    });

    it('gives back a surname nobody grouped, plus its other gender', () => {
        expect(surnameForms('Svoboda', data)).toEqual(['Svoboda', 'Svobodová']);
    });
});

describe('addSurnameGroup', () => {
    it('writes the group down once', () => {
        expect(addSurnameGroup(tree(), ['Fíšek', 'Fyšek'])).toEqual([['Fíšek', 'Fyšek']]);
    });

    it('merges into a group it overlaps rather than making a rival one', () => {
        // {Fyšek, Fischek} exists; adding {Fíšek, Fyšek} must end with one group
        // of three — otherwise Fíšek and Fischek stay strangers though both are Fyšek.
        const data = tree([['Fyšek', 'Fischek']]);
        const groups = addSurnameGroup(data, ['Fíšek', 'Fyšek']);
        expect(groups).toHaveLength(1);
        expect([...groups[0]].sort()).toEqual(['Fyšek', 'Fíšek', 'Fischek'].sort());
    });

    it('leaves other families alone', () => {
        const data = tree([['Svoboda', 'Swoboda']]);
        const groups = addSurnameGroup(data, ['Fíšek', 'Fyšek']);
        expect(groups).toHaveLength(2);
    });

    it('refuses a group of one — there is nothing to equate', () => {
        expect(addSurnameGroup(tree(), ['Fíšek'])).toEqual([]);
        expect(addSurnameGroup(tree(), ['Fíšek', '  '])).toEqual([]);
    });

    it('does not list the same spelling twice', () => {
        const groups = addSurnameGroup(tree(), ['Fíšek', 'Fíšek', 'Fyšek']);
        expect(groups[0]).toHaveLength(2);
    });
});

describe('removeSurnameGroup', () => {
    it('drops the group of whichever spelling you name', () => {
        const data = tree([['Fíšek', 'Fyšek'], ['Svoboda', 'Swoboda']]);
        const groups = removeSurnameGroup(data, 'Fyšek');
        expect(groups).toEqual([['Svoboda', 'Swoboda']]);
    });
});

describe('surnamesInTree', () => {
    it('lists the surnames in use, commonest first', () => {
        const data = tree(undefined, [
            person('a', 'Jan', 'Fíšek'), person('b', 'Petr', 'Fíšek'),
            person('c', 'Josef', 'Svoboda'),
        ]);
        expect(surnamesInTree(data)).toEqual([
            { surname: 'Fíšek', count: 2 },
            { surname: 'Svoboda', count: 1 },
        ]);
    });

    it('counts spellings separately — telling them apart is the point', () => {
        const data = tree(undefined, [person('a', 'Jan', 'Fíšek'), person('b', 'Josef', 'Fyšek')]);
        expect(surnamesInTree(data)).toHaveLength(2);
    });

    it('ignores placeholders and the nameless', () => {
        const data = tree(undefined, [
            person('a', 'Jan', 'Fíšek'), person('b', '?', 'Fíšek', true), person('c', 'Kdo', ''),
        ]);
        expect(surnamesInTree(data)).toEqual([{ surname: 'Fíšek', count: 1 }]);
    });
});

describe('masculine and feminine are one family (P1, found by testing a real tree)', () => {
    const empty = tree();

    // A Czech user's tree can be entirely ASCII (an old GEDCOM export), so the
    // rules key off the UI language too — that is the gate exercised here.
    beforeAll(() => setLanguage('cs'));
    afterAll(() => setLanguage('en'));

    it('sees through the vowel that drops — the case that was broken', () => {
        // Measured on a real tree: "Fíšek" found 14 men and none of the 10
        // women, because the "e" disappears when the name is made feminine.
        expect(sameSurname('Fíšek', 'Fíšková', empty)).toBe(true);
        expect(sameSurname('Fíšková', 'Fíšek', empty)).toBe(true);
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
        expect(sameSurname('Krevčíková', 'Krejčíková', empty)).toBe(false);
        expect(sameSurname('Horáková', 'Nováková', empty)).toBe(false);
        expect(sameSurname('Fíšková', 'Vaňková', empty)).toBe(false);
        expect(sameSurname('Novák', 'Horáková', empty)).toBe(false);
    });

    it('leaves names outside Czech alone', () => {
        expect(sameSurname('Tudor', 'Boleyn', empty)).toBe(false);
        expect(sameSurname('Schaffer', 'Seeman', empty)).toBe(false);
        expect(masculineForm('Tudor')).toBeNull();
        expect(masculineForm('Boleyn')).toBeNull();
    });

    it('reaches a woman through a grouped spelling of the man’s name', () => {
        // Fyšek is grouped with Fíšek, so Fyšek must find Fíšková too.
        const data = tree([['Fíšek', 'Fyšek']]);
        expect(sameSurname('Fyšek', 'Fíšková', data)).toBe(true);
    });

    it('offers the masculine form among a woman’s search terms', () => {
        expect(surnameForms('Fíšková', empty)).toContain('Fíšek');
    });

    it('works the other way too, or the two searches disagree', () => {
        // Measured: "Fíšek" reached all 24 and "Fíšková" only the 10 women —
        // an inconsistency nobody could explain to themselves.
        expect(surnameForms('Fíšek', empty)).toContain('Fíšková');
        expect(feminineForm('Fíšek')).toBe('Fíšková');
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

    it('refuses a stem too short to be one — Nová is an adjective, not N-ová', () => {
        // "Na" is a real Korean surname; gluing it to Nová once auto-confirmed
        // a merge of two different women.
        expect(sameSurname('Nová', 'Na', empty)).toBe(false);
        expect(sameSurname('Nová', 'N', empty)).toBe(false);
        expect(sameSurname('Sová', 'Sa', empty)).toBe(false);
        // The adjective pair still works, through the -á rule.
        expect(sameSurname('Nová', 'Nový', empty)).toBe(true);
    });

    it('reads the registers’ capitals and old ASCII exports', () => {
        expect(sameSurname('NOVOTNÁ', 'NOVOTNÝ', empty)).toBe(true);
        expect(sameSurname('Novakova', 'Novak', empty)).toBe(true);   // stripped -ová
        expect(sameSurname('Nováková', 'NOVAK', empty)).toBe(true);
        // Stripped adjectives are NOT touched: Ticha is indistinguishable
        // from a noun like Kalina once the diacritic is gone.
        expect(sameSurname('Ticha', 'Tichy', empty)).toBe(false);
        expect(sameSurname('Kalina', 'Kaliny', empty)).toBe(false);
    });

    it('handles adjectives beyond -ná/-lá: Tichá, Mokrá, Hrubá', () => {
        expect(sameSurname('Tichá', 'Tichý', empty)).toBe(true);
        expect(sameSurname('Mokrá', 'Mokrý', empty)).toBe(true);
        expect(sameSurname('Hrubá', 'Hrubý', empty)).toBe(true);
        // …and both search directions agree (the original P1 complaint).
        expect(surnameForms('Tichá', empty)).toContain('Tichý');
        expect(surnameForms('Tichý', empty)).toContain('Tichá');
    });
});

describe('the rules know where they apply (gating)', () => {
    // These run with the UI in English — the gate has to come from the data.
    it('leaves a tree with no Czech in it completely alone', () => {
        // Bulgarian/Russian: -ova belongs to -ov (Ivanova ↔ Ivanov). Joining
        // Ivanova to Ivan would silently merge two different people.
        expect(czechRulesApply(tree())).toBe(false);
        expect(sameSurname('Ivanova', 'Ivan', tree())).toBe(false);
        expect(sameSurname('Doe', 'Doeová', tree())).toBe(false);
        expect(surnameForms('Smith', tree())).toEqual(['Smith']);
    });

    it('turns on when the data itself is Czech', () => {
        const data = tree(undefined, [person('a', 'Jan', 'Fíšek')]);
        expect(czechRulesApply(data)).toBe(true);
        expect(sameSurname('Fíšek', 'Fíšková', data)).toBe(true);
    });

    it('a Czech group entered by the user is Czech enough', () => {
        const data = tree([['Fíšek', 'Fischek']]);
        expect(czechRulesApply(data)).toBe(true);
    });

    it('user groups are facts and hold with the rules off', () => {
        const data = tree([['Smith', 'Smythe']]);
        expect(czechRulesApply(data)).toBe(false);
        expect(sameSurname('Smith', 'Smythe', data)).toBe(true);
    });

    it('notices a Czech person added after the first look', () => {
        const data = tree(undefined, [person('a', 'John', 'Smith')]);
        expect(czechRulesApply(data)).toBe(false);
        data.persons[toPersonId('b')] = person('b', 'Jan', 'Fíšek');
        expect(czechRulesApply(data)).toBe(true);
    });
});

describe('Polish adjectival surnames pair the Polish way, never the Czech one', () => {
    // A Polish tree: Polish letters only — "ó" (Wróblewska, Mróz) is no Czech sign.
    const polish = (): StromData => tree([['Jaworski', 'Jaworsky', 'Jaworskij']], [
        person('a', 'Józef', 'Jaworski'), person('b', 'Zofia', 'Jaworska'), person('c', 'Ewa', 'Wróblewska'),
        person('d', 'Jan', 'Mróz'), person('e', 'Anna', 'Kmieć'),
    ]);

    it('a tree of Polish surnames is no Czech one, though they write ó', () => {
        expect(czechRulesApply(polish())).toBe(false);
    });

    it('Jaworski ↔ Jaworska, Nowicki ↔ Nowicka, Zawadzki ↔ Zawadzka', () => {
        const data = polish();
        expect(sameSurname('Jaworski', 'Jaworska', data)).toBe(true);
        expect(sameSurname('Nowicka', 'Nowicki', data)).toBe(true);
        expect(sameSurname('Zawadzki', 'Zawadzka', data)).toBe(true);
        expect(feminineFormIn('Jaworski', data)).toBe('Jaworska');
        expect(masculineFormIn('Wróblewska', data)).toBe('Wróblewski');
        expect(feminineFormIn('Jaworska', data)).toBeNull();
        expect(genderRulesApply('Jaworski', data)).toBe(true);
    });

    it('no Czech feminine form on a Polish tree: no Jaworskiová, Jaworsková, Krawczyková', () => {
        const data = polish();
        const forms = [...surnameForms('Jaworski', data), ...surnameForms('Jaworska', data), ...surnameForms('Krawczyk', data)];
        expect(forms.filter(f => /ov[áa]$/i.test(f))).toEqual([]);
        expect(surnameForms('Jaworska', data)).toEqual(expect.arrayContaining(['Jaworska', 'Jaworski', 'Jaworsky', 'Jaworskij']));
        expect(surnameForms('Krawczyk', data)).toEqual(['Krawczyk']);
        expect(feminineFormIn('Jaworsky', data)).toBeNull();
    });

    it('the men\'s -ski is Polish on a Czech tree too; the Czech names there keep their rules', () => {
        const data = tree(undefined, [person('a', 'Jan', 'Fíšek'), person('b', 'Józef', 'Jaworski')]);
        expect(czechRulesApply(data)).toBe(true);
        expect(feminineForm('Jaworski')).toBe('Jaworska');
        expect(sameSurname('Jaworski', 'Jaworska', data)).toBe(true);
        expect(surnameForms('Jaworski', data)).not.toContain('Jaworskiová');
        expect(sameSurname('Fíšek', 'Fíšková', data)).toBe(true);
        // An ASCII export of a Czech name ending -ska (Liska of Liška) keeps the Czech rules on a Czech tree.
        expect(feminineFormIn('Liska', data)).toBe('Lisková');
        expect(masculineFormIn('Liska', data)).toBeNull();
        // The Czech -ský/-ská stay Czech.
        expect(feminineForm('Brodský')).toBe('Brodská');
        expect(masculineForm('Brodská')).toBe('Brodský');
    });

    describe('in the Czech UI', () => {
        beforeAll(() => setLanguage('cs'));
        afterAll(() => setLanguage('en'));

        it('a Polish tree keeps the Polish rules: no Jaworsková, Nowaková, Wróblewsková, Mrózová', () => {
            const data = tree(undefined, [
                person('a', 'Józef', 'Jaworski'), person('b', 'Zofia', 'Jaworska'), person('c', 'Ewa', 'Wróblewska'),
                person('d', 'Jan', 'Mróz'), person('e', 'Piotr', 'Nowak'), person('f', 'Anna', 'Kmieć'),
            ]);
            expect(czechRulesApply(data)).toBe(false);
            const forms = ['Jaworska', 'Jaworski', 'Nowak', 'Wróblewska', 'Mróz'].flatMap(n => surnameForms(n, data));
            expect(forms.filter(f => /ov[áa]$/i.test(f))).toEqual([]);
            expect(feminineFormIn('Jaworska', data)).toBeNull();
            expect(masculineFormIn('Jaworska', data)).toBe('Jaworski');
            expect(masculineFormIn('Wróblewska', data)).toBe('Wróblewski');
            expect(feminineFormIn('Nowak', data)).toBeNull();
            expect(sameSurname('Jaworski', 'Jaworska', data)).toBe(true);
        });

        it('a Czech tree with a Polish family: Jaworska pairs with its Jaworski, the Czech names keep their rules', () => {
            const data = tree(undefined, [
                person('a', 'Jan', 'Fíšek'), person('b', 'Marie', 'Nováková'), person('c', 'Josef', 'Dvořák'),
                person('d', 'Józef', 'Jaworski'), person('e', 'Zofia', 'Jaworska'),
            ]);
            expect(czechRulesApply(data)).toBe(true);
            expect(surnameForms('Jaworska', data)).not.toContain('Jaworsková');
            expect(masculineFormIn('Jaworska', data)).toBe('Jaworski');
            expect(sameSurname('Fíšek', 'Fíšková', data)).toBe(true);
            // Without its men's form the ASCII -ska stays a Czech name (Liska of Liška).
            expect(feminineFormIn('Liska', data)).toBe('Lisková');
        });

        it('an ASCII export of a Czech tree with a Polish in-law stays Czech', () => {
            const data = tree(undefined, [
                person('a', 'Jan', 'Hrusek'), person('b', 'Marie', 'Hruskova'), person('c', 'Anna', 'Ptackova'),
                person('d', 'Jan', 'Kowalski'),
            ]);
            expect(czechRulesApply(data)).toBe(true);
            expect(sameSurname('Hrusek', 'Hruskova', data)).toBe(true);
        });
    });

    it('a Polish tree with one Czech in-law keeps the Polish rules in another UI language too', () => {
        const data = tree(undefined, [
            person('a', 'Józef', 'Jaworski'), person('b', 'Piotr', 'Nowicki'), person('c', 'Jan', 'Mróz'),
            person('d', 'Marie', 'Nováková'),
        ]);
        expect(czechRulesApply(data)).toBe(false);
        expect(surnameForms('Nowak', data)).toEqual(['Nowak']);
    });

    it('too short a stem is no Polish adjective', () => {
        expect(feminineForm('Wski')).not.toBe('Wska');
        expect(masculineFormIn('Ska', tree())).toBeNull();
    });
});
