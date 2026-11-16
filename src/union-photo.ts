/**
 * The couple's photo (spec 107 §6–§8): the partners in the order of the
 * card (the husband, or the first partner of a same-sex couple, on the left)
 * and the caption that names them. No DOM here: the person page, the family
 * pages and the Family book use it as the app does.
 */

import type { Partnership, Person, StromData } from './types.js';
import { strings } from './strings.js';
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
function captionName(person: Person): string {
    return givenNameOf(person) || shownNameOrEmpty(person) || strings.addChild.unknownPerson;
}

/** "Ilsa and Oskar · couple's photo" (the partners in the card's order). */
export function unionPhotoCaption(data: Pick<StromData, 'persons'>, union: Pick<Partnership, 'person1Id' | 'person2Id'>): string {
    const [a, b] = unionPartnersInOrder(data, union);
    const names = [a, b].filter((p): p is Person => !!p).map(captionName);
    const r = strings.relationships;
    if (names.length === 2) return r.unionPhotoCaption(names[0], names[1]);
    return r.unionPhotoCaptionOne(names[0] ?? strings.addChild.unknownPerson);
}
