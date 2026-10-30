/**
 * Living-person privacy filter tests.
 */

import { describe, it, expect } from 'vitest';
import { applyLivingPrivacy, isLivingPerson, inferBirthUpperBounds, presumedDeceasedSet } from '../privacy.js';
import { strings } from '../strings.js';
import { StromData, Person, PersonId, PartnershipId } from '../types.js';

const NOW = 2026;
const LIVING_LABEL = strings.privacy.livingPerson;

/** Access persons by plain string key (ids are branded PersonId). */
function P(data: StromData): Record<string, Person> {
    return data.persons as Record<string, Person>;
}

function person(id: string, over: Partial<Person> = {}): Person {
    return {
        id: id as PersonId,
        firstName: 'Jan',
        lastName: 'Novák',
        gender: 'male',
        isPlaceholder: false,
        partnerships: [],
        parentIds: [],
        childIds: [],
        ...over,
    };
}

function tree(...persons: Person[]): StromData {
    const map: StromData['persons'] = {};
    for (const p of persons) map[p.id] = p;
    return { persons: map, partnerships: {} as Record<PartnershipId, never> };
}

describe('isLivingPerson', () => {
    it('treats a death date as deceased', () => {
        expect(isLivingPerson(person('a', { deathDate: '1990' }), NOW)).toBe(false);
    });
    it('treats birth over 110 years ago (no death) as deceased', () => {
        expect(isLivingPerson(person('a', { birthDate: '1900' }), NOW)).toBe(false);
    });
    it('treats a recent birth as living', () => {
        expect(isLivingPerson(person('a', { birthDate: '1990' }), NOW)).toBe(true);
    });
    it('treats no dates as living (unknown, be safe)', () => {
        expect(isLivingPerson(person('a'), NOW)).toBe(true);
    });
    it('isDeceased:true overrides a recent birth', () => {
        expect(isLivingPerson(person('a', { birthDate: '1990', isDeceased: true }), NOW)).toBe(false);
    });
    it('isDeceased:false overrides an old birth', () => {
        expect(isLivingPerson(person('a', { birthDate: '1850', isDeceased: false }), NOW)).toBe(true);
    });
    it('respects flex-date qualifiers via yearOf', () => {
        expect(isLivingPerson(person('a', { birthDate: '~1990' }), NOW)).toBe(true);
        expect(isLivingPerson(person('a', { birthDate: '<1900' }), NOW)).toBe(false);
    });
});

describe('applyLivingPrivacy', () => {
    const living = person('living', {
        firstName: 'Jan', lastName: 'Novák', birthDate: '1990-05-01',
        birthPlace: 'Praha', notes: 'secret',
    });
    const deceased = person('dead', {
        firstName: 'Old', lastName: 'Ancestor', birthDate: '1900', deathDate: '1970',
        birthPlace: 'Brno', notes: 'history',
    });

    it('full mode is a deep copy that changes nothing', () => {
        const data = tree(living, deceased);
        const out = applyLivingPrivacy(data, 'full', NOW);
        expect(out).toEqual(data);
        expect(out).not.toBe(data);
        expect(P(out)['living']).not.toBe(P(data)['living']);
    });

    it('never mutates the original', () => {
        const data = tree(structuredClone(living));
        applyLivingPrivacy(data, 'anonymous', NOW);
        expect(P(data)['living'].firstName).toBe('Jan');
        expect(P(data)['living'].notes).toBe('secret');
    });

    it('initials mode reduces names, keeps birth year only, drops places/notes', () => {
        const out = applyLivingPrivacy(tree(living), 'initials', NOW);
        const p = P(out)['living'];
        expect(p.firstName).toBe('J.');
        expect(p.lastName).toBe('N.');
        expect(p.birthDate).toBe('1990');
        expect(p.birthPlace).toBeUndefined();
        expect(p.notes).toBeUndefined();
        expect(p.gender).toBe('male');
    });

    it('anonymous mode hides the name entirely but keeps gender', () => {
        const out = applyLivingPrivacy(tree(living), 'anonymous', NOW);
        const p = P(out)['living'];
        expect(p.firstName).toBe(LIVING_LABEL);
        expect(p.lastName).toBe('');
        expect(p.birthDate).toBeUndefined();
        expect(p.gender).toBe('male');
    });

    it('minimal mode keeps the surname', () => {
        const out = applyLivingPrivacy(tree(living), 'minimal', NOW);
        const p = P(out)['living'];
        expect(p.lastName).toBe('Novák');
        expect(p.firstName).toBe(LIVING_LABEL);
        expect(p.birthDate).toBeUndefined();
    });

    it('leaves deceased persons untouched', () => {
        const out = applyLivingPrivacy(tree(deceased), 'anonymous', NOW);
        expect(P(out)['dead']).toEqual(deceased);
    });

    it('leaves placeholders untouched', () => {
        const ph = person('ph', { firstName: '?', lastName: '', isPlaceholder: true });
        const out = applyLivingPrivacy(tree(ph), 'anonymous', NOW);
        expect(P(out)['ph'].firstName).toBe('?');
    });

    it('preserves structure (ids, relationships) in every mode', () => {
        const parent = person('parent', { childIds: ['child' as PersonId] });
        const child = person('child', { parentIds: ['parent' as PersonId], birthDate: '2010' });
        for (const mode of ['initials', 'anonymous', 'minimal'] as const) {
            const out = applyLivingPrivacy(tree(parent, child), mode, NOW);
            expect(Object.keys(out.persons).sort()).toEqual(['child', 'parent']);
            expect(P(out)['parent'].childIds).toEqual(['child']);
            expect(P(out)['child'].parentIds).toEqual(['parent']);
        }
    });
});

describe('keepDeceasedSources (person page, spec 025 K2.7)', () => {
    function withSources(): StromData {
        const data = tree(
            person('dead', {
                birthDate: '1900', deathDate: '1970', sourceIds: ['s-dead'], deathSourceIds: ['s-shared'],
                attachments: [{ id: 'a1', name: 'scan.jpg', mimeType: 'image/jpeg', dataUrl: 'data:,', sizeBytes: 1, sourceId: 's-att' }],
                events: [{ id: 'e1', type: 'burial', date: '1970', sourceIds: ['s-event'] }],
            }),
            person('living', {
                birthDate: '1990', sourceIds: ['s-living'], birthSourceIds: ['s-shared'],
                attachments: [{ id: 'a2', name: 'photo.jpg', mimeType: 'image/jpeg', dataUrl: 'data:,', sizeBytes: 1 }],
            }),
        );
        data.sources = Object.fromEntries(['s-dead', 's-shared', 's-att', 's-event', 's-living', 's-unused']
            .map(id => [id, { id, title: id }]));
        return data;
    }

    it('the deceased keep sources and attachments; the living lose them', () => {
        const out = applyLivingPrivacy(withSources(), 'initials', NOW, { keepDeceasedSources: true });
        expect(P(out)['dead'].sourceIds).toEqual(['s-dead']);
        expect(P(out)['dead'].deathSourceIds).toEqual(['s-shared']);
        expect(P(out)['dead'].attachments).toHaveLength(1);
        expect(P(out)['dead'].events?.[0].sourceIds).toEqual(['s-event']);
        expect(P(out)['living'].sourceIds).toBeUndefined();
        expect(P(out)['living'].birthSourceIds).toBeUndefined();
        expect(P(out)['living'].attachments).toBeUndefined();
        // Only the sources someone still cites stay in the catalog.
        expect(Object.keys(out.sources ?? {}).sort()).toEqual(['s-att', 's-dead', 's-event', 's-shared']);
    });

    it('a couple with a living partner loses its sources', () => {
        const data = withSources();
        P(data)['dead'].partnerships = ['u' as PartnershipId];
        P(data)['living'].partnerships = ['u' as PartnershipId];
        data.partnerships = { u: { id: 'u' as PartnershipId, person1Id: 'dead' as PersonId, person2Id: 'living' as PersonId, status: 'married', childIds: [], sourceIds: ['s-unused'] } } as StromData['partnerships'];
        const out = applyLivingPrivacy(data, 'initials', NOW, { keepDeceasedSources: true });
        expect(out.partnerships['u' as PartnershipId].sourceIds).toBeUndefined();
        expect(out.sources?.['s-unused']).toBeUndefined();
    });

    it('without it (book, tree export) every source and attachment goes, as before', () => {
        const out = applyLivingPrivacy(withSources(), 'initials', NOW);
        expect(out.sources).toBeUndefined();
        expect(P(out)['dead'].sourceIds).toBeUndefined();
        expect(P(out)['dead'].attachments).toBeUndefined();
        expect(P(out)['dead'].events?.[0].sourceIds).toBeUndefined();
    });
});

describe('inferBirthUpperBounds — indirect liveness evidence', () => {
    const uid = (s: string) => s as PartnershipId;
    const withUnions = (d: StromData, ...unions: Array<{ id: string; p1: string; p2: string; startDate?: string }>): StromData => {
        for (const u of unions) {
            (d.partnerships as Record<string, unknown>)[u.id] = {
                id: uid(u.id), person1Id: u.p1 as PersonId, person2Id: u.p2 as PersonId,
                childIds: [], status: 'married', ...(u.startDate ? { startDate: u.startDate } : {}),
            };
        }
        return d;
    };

    it('a dateless person with a child born long ago is deceased in exports', () => {
        const d = tree(
            person('old', { childIds: ['kid' as PersonId] }),
            person('kid', { parentIds: ['old' as PersonId], birthDate: '1880', deathDate: '1950' }),
        );
        const out = applyLivingPrivacy(d, 'initials', NOW);
        expect(P(out)['old'].firstName).toBe('Jan');   // full name kept — not living
    });

    it('the inference propagates up through dateless generations', () => {
        const d = tree(
            person('great', { childIds: ['mid' as PersonId] }),
            person('mid', { parentIds: ['great' as PersonId], childIds: ['leaf' as PersonId] }),   // no dates
            person('leaf', { parentIds: ['mid' as PersonId], birthDate: '1900' }),
        );
        const bounds = inferBirthUpperBounds(d);
        expect(bounds.get('mid')).toBe(1888);
        expect(bounds.get('great')).toBe(1876);
        const out = applyLivingPrivacy(d, 'initials', NOW);
        expect(P(out)['great'].firstName).toBe('Jan');
    });

    it('an old wedding marks both dateless partners deceased', () => {
        const d = withUnions(
            tree(
                person('h', { partnerships: [uid('u1')] }),
                person('w', { gender: 'female', partnerships: [uid('u1')] }),
            ),
            { id: 'u1', p1: 'h', p2: 'w', startDate: '1890' },
        );
        const out = applyLivingPrivacy(d, 'initials', NOW);
        expect(P(out)['h'].firstName).toBe('Jan');
        expect(P(out)['w'].firstName).toBe('Jan');
    });

    it('a recent child keeps the dateless parent living (initials)', () => {
        const d = tree(
            person('mum', { gender: 'female', childIds: ['kid' as PersonId] }),
            person('kid', { parentIds: ['mum' as PersonId], birthDate: '1990' }),
        );
        const out = applyLivingPrivacy(d, 'initials', NOW);
        expect(P(out)['mum'].firstName).toBe('J.');
        expect(P(out)['kid'].firstName).toBe('J.');
    });

    it('no evidence at all stays living (safe default)', () => {
        const out = applyLivingPrivacy(tree(person('mystery')), 'initials', NOW);
        expect(P(out)['mystery'].firstName).toBe('J.');
    });

    it('explicit isDeceased: false wins over indirect evidence', () => {
        const d = tree(
            person('tough', { isDeceased: false, childIds: ['kid' as PersonId] }),
            person('kid', { parentIds: ['tough' as PersonId], birthDate: '1900' }),
        );
        const out = applyLivingPrivacy(d, 'initials', NOW);
        expect(P(out)['tough'].firstName).toBe('J.');
    });

    it('survives a parent cycle in broken data', () => {
        const d = tree(
            person('a', { parentIds: ['b' as PersonId], childIds: ['b' as PersonId], birthDate: '1900' }),
            person('b', { parentIds: ['a' as PersonId], childIds: ['a' as PersonId] }),
        );
        expect(() => inferBirthUpperBounds(d)).not.toThrow();
    });
});

describe('narratives are the most personal text in the file', () => {
    const story = { text: 'Vyprávění o živém člověku.' };

    it('a living person keeps no story under any privacy mode', () => {
        for (const mode of ['initials', 'anonymous', 'minimal'] as const) {
            const out = applyLivingPrivacy(
                tree(person('living', { birthDate: '1990', story: structuredClone(story) })), mode, NOW);
            expect(P(out)['living'].story).toBeUndefined();
        }
    });

    it('a deceased person keeps theirs', () => {
        const out = applyLivingPrivacy(
            tree(person('dead', { birthDate: '1900', deathDate: '1970', story: structuredClone(story) })),
            'anonymous', NOW);
        expect(P(out)['dead'].story?.text).toBe(story.text);
    });

    it('a couple’s story goes as soon as either of them is living', () => {
        const data: StromData = {
            persons: {
                a: person('a', { birthDate: '1900', deathDate: '1970' }),
                b: person('b', { birthDate: '1990' }),
            } as StromData['persons'],
            partnerships: {
                u1: {
                    id: 'u1' as PartnershipId, person1Id: 'a' as PersonId, person2Id: 'b' as PersonId,
                    childIds: [], status: 'married', story: { text: 'Jejich příběh.' },
                },
            } as StromData['partnerships'],
        };
        const out = applyLivingPrivacy(data, 'anonymous', NOW);
        expect(Object.values(out.partnerships)[0].story).toBeUndefined();
    });
});

/**
 * T35: the † marker. A person with their own death or the Deceased switch,
 * or an age beyond 120 is †; a descendant's death alone never marks an
 * ancestor.
 */
describe('presumedDeceasedSet (T35)', () => {
    const tree = (persons: Person[]): StromData => ({
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: {} as StromData['partnerships'],
    });

    it('a parent born in 1937 of a child who died is not †', () => {
        const data = tree([
            person('mother', { birthDate: '1937', childIds: ['child' as PersonId] }),
            person('gm', { childIds: ['mother' as PersonId] }),
            person('child', { birthDate: '1960', deathDate: '2001', parentIds: ['mother' as PersonId] }),
        ]);
        P(data)['mother'].parentIds = ['gm' as PersonId];
        const set = presumedDeceasedSet(data, NOW);
        expect(set.has('child')).toBe(true);
        expect(set.has('mother')).toBe(false);
        // Her mother has no dates; born at the latest 1937 − 12 = 1925: not past 120.
        expect(set.has('gm')).toBe(false);
    });

    it('own death data, the Deceased switch and an age beyond 120 still mark', () => {
        const data = tree([
            person('dated', { birthDate: '1950', deathDate: '2000' }),
            person('switch', { birthDate: '1950', isDeceased: true }),
            person('old', { birthDate: '1890' }),
            person('young', { birthDate: '1990' }),
        ]);
        const set = presumedDeceasedSet(data, NOW);
        expect([...set].sort()).toEqual(['dated', 'old', 'switch']);
    });

    it('an ancestor without a birth year is † when a descendant’s birth puts them past 120', () => {
        const data = tree([
            person('ggp', { childIds: ['gp' as PersonId] }),
            person('gp', { parentIds: ['ggp' as PersonId], childIds: ['kid' as PersonId] }),
            person('kid', { birthDate: '1900', deathDate: '1980', parentIds: ['gp' as PersonId] }),
            person('alive', { isDeceased: false, childIds: ['kid2' as PersonId] }),
            person('kid2', { birthDate: '1880', parentIds: ['alive' as PersonId] }),
        ]);
        const set = presumedDeceasedSet(data, NOW);
        expect(set.has('gp')).toBe(true);     // born 1888 at the latest
        expect(set.has('ggp')).toBe(true);    // born 1876 at the latest
        expect(set.has('alive')).toBe(false); // marked as alive
    });
});
