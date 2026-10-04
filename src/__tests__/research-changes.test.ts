/**
 * Changes per person (A2): what the user changed since the research's last
 * version, told person by person. Invented data.
 */

import { describe, it, expect } from 'vitest';
import { diffByPerson, baseCopy } from '../research-changes.js';
import { StromData, Person, PersonId, PartnershipId } from '../types.js';

const person = (id: string, first: string, extra: Partial<Person> = {}): Person => ({
    id: id as PersonId, firstName: first, lastName: 'Víšek', gender: 'male', isPlaceholder: false,
    partnerships: [], parentIds: [], childIds: [], ...extra,
});

function tree(): StromData {
    return {
        persons: {
            p1: person('p1', 'Josef', { birthDate: '1860', events: [{ id: 'e1', type: 'baptism', date: '1860-03-04' }], partnerships: ['u1' as PartnershipId] }),
            p2: person('p2', 'Anna', { gender: 'female', partnerships: ['u1' as PartnershipId] }),
            p3: person('p3', 'Jan', { photo: 'data:image/jpeg;base64,' + 'A'.repeat(400) }),
        },
        partnerships: { u1: { id: 'u1' as PartnershipId, person1Id: 'p1' as PersonId, person2Id: 'p2' as PersonId, childIds: [], status: 'married', startDate: '1885' } },
        sources: { s1: { id: 's1', title: 'Matrika' } },
    } as StromData;
}

describe('changes per person since the research\'s version', () => {
    it('nothing changed: nothing to tell (the research\'s own fields do not count)', () => {
        const base = baseCopy(tree());
        const cur = tree();
        cur.persons['p1' as PersonId].birthStatus = 'lead';
        cur.persons['p1' as PersonId].research = { conflicts: [] } as never;
        expect(diffByPerson(base, cur)).toEqual([]);
    });

    it('tells the birth, a godparent, a citation, an attachment, the name', () => {
        const base = baseCopy(tree());
        const cur = tree();
        const josef = cur.persons['p1' as PersonId];
        josef.birthPlace = 'Čáslav';
        josef.events![0].participants = [{ id: 'g1', role: 'godparent', name: 'Marie Dvořáková' }];
        josef.birthSourceIds = ['s1'];
        josef.attachments = [{ id: 'a1', name: 'scan.jpg', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AAAA', sizeBytes: 3 }];
        cur.persons['p3' as PersonId].firstName = 'Jan Nepomuk';
        const changes = diffByPerson(base, cur);
        expect(changes.map(c => c.name)).toEqual(['Jan Nepomuk Víšek', 'Josef Víšek']);
        expect(changes.find(c => c.personId === 'p1')!.kinds).toEqual(['birth', 'godparent', 'citation', 'attachment']);
        expect(changes.find(c => c.personId === 'p3')!.kinds).toEqual(['name']);
    });

    it('a changed sex is told as such, not as "other details"', () => {
        const base = baseCopy(tree());
        const cur = tree();
        cur.persons['p3' as PersonId].gender = 'female';
        expect(diffByPerson(base, cur).find(c => c.personId === 'p3')!.kinds).toEqual(['gender']);
    });

    it('a "?" given a name: a new person for the research, its children told as having a parent there', () => {
        const withStandIn = (): StromData => {
            const t = tree();
            t.persons['q' as PersonId] = person('q', '?', { isPlaceholder: true, lastName: '', partnerships: ['u2' as PartnershipId], childIds: ['e' as PersonId] });
            t.persons['e' as PersonId] = person('e', 'Eva', { gender: 'female', parentIds: ['p3' as PersonId, 'q' as PersonId] });
            t.persons['p3' as PersonId].partnerships = ['u2' as PartnershipId];
            t.persons['p3' as PersonId].childIds = ['e' as PersonId];
            t.partnerships['u2' as PartnershipId] = { id: 'u2' as PartnershipId, person1Id: 'p3' as PersonId, person2Id: 'q' as PersonId, childIds: ['e' as PersonId], status: 'married' };
            return t;
        };
        const base = baseCopy(withStandIn());
        const cur = withStandIn();
        cur.persons['q' as PersonId] = { ...cur.persons['q' as PersonId], firstName: 'Zbyněk', lastName: 'Pokorný', isPlaceholder: false };
        const changes = diffByPerson(base, cur);
        expect(changes.find(c => c.personId === 'q')!.kinds).toEqual(['added']);
        expect(changes.find(c => c.personId === 'e')!.kinds).toEqual(['parents']);
    });

    it('a wedding and its witnesses are told at both partners; a new and a deleted person', () => {
        const base = baseCopy(tree());
        const cur = tree();
        cur.partnerships['u1' as PartnershipId].startPlace = 'Čáslav';
        cur.partnerships['u1' as PartnershipId].participants = [{ id: 'w1', role: 'witness', name: 'Václav' }];
        cur.persons['p4' as PersonId] = person('p4', 'Karel');
        delete cur.persons['p3' as PersonId];
        const changes = diffByPerson(base, cur);
        expect(changes.find(c => c.personId === 'p1')!.kinds).toEqual(['marriage', 'witness']);
        expect(changes.find(c => c.personId === 'p2')!.kinds).toEqual(['marriage', 'witness']);
        expect(changes.find(c => c.personId === 'p4')!.kinds).toEqual(['added']);
        expect(changes.find(c => c.personId === 'p3')).toMatchObject({ kinds: ['deleted'], deleted: true, name: 'Jan Víšek' });
    });

    it('a photo is compared by its size, not kept in the base', () => {
        const base = baseCopy(tree());
        expect(JSON.stringify(base)).not.toContain('AAAAAAAA');
        const cur = tree();
        cur.persons['p3' as PersonId].photo = 'data:image/jpeg;base64,' + 'B'.repeat(500);
        expect(diffByPerson(base, cur).find(c => c.personId === 'p3')!.kinds).toEqual(['other']);
        expect(diffByPerson(base, tree())).toEqual([]);
    });

    it('a changed source is told at the people citing it', () => {
        const t = tree();
        t.persons['p2' as PersonId].sourceIds = ['s1'];
        const base = baseCopy(t);
        const cur = JSON.parse(JSON.stringify(t)) as StromData;
        cur.sources!.s1.transcript = 'Anna, dcera…';
        expect(diffByPerson(base, cur)).toEqual([{ personId: 'p2', name: 'Anna Víšek', kinds: ['source'] }]);
    });
});
