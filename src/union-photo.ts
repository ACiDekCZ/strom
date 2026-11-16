/**
 * The couple's photo (spec 107 §6–§8): the partners in the order of the
 * card (the husband, or the first partner of a same-sex couple, on the left)
 * and the caption that names them. No DOM here: the person page, the family
 * pages and the Family book use it as the app does.
 */

import type { Partnership, Person, StromData } from './types.js';
import { strings, type StringsType } from './strings.js';
import { givenNameOf } from './shared-with-line.js';
import { shownNameOrEmpty } from './person-name.js';

/** Both partners of a union as the card shows them (left, right); an unknown one is null. */
export function unionPartnersInOrder(data: Pick<StromData, 'persons'>, union: Pick<Partnership, 'person1Id' | 'person2Id'>): [Person | null, Person | null] {
    const p1 = data.persons[union.person1Id] ?? null;
    const p2 = data.persons[union.person2Id] ?? null;
    if (p1 && p2 && p1.gender !== p2.gender && p2.gender === 'male') return [p2, p1];
    return [p1, p2];
}

/** A partner's name in the caption: the given name, else the whole shown name. */
function captionName(person: Person, S: StringsType): string {
    return givenNameOf(person) || shownNameOrEmpty(person) || S.addChild.unknownPerson;
}

/** "Oskar and Ilsa · couple's photo" (the partners in the card's order); `S`: a page's own language. */
export function unionPhotoCaption(data: Pick<StromData, 'persons'>, union: Pick<Partnership, 'person1Id' | 'person2Id'>, S: StringsType = strings): string {
    const [a, b] = unionPartnersInOrder(data, union);
    const names = [a, b].filter((p): p is Person => !!p).map(p => captionName(p, S));
    const r = S.relationships;
    if (names.length === 2) return r.unionPhotoCaption(names[0], names[1]);
    return r.unionPhotoCaptionOne(names[0] ?? S.addChild.unknownPerson);
}
