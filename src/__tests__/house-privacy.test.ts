/**
 * A house in outputs (spec 030 §10, K1.4, K1.4a), with "now" fixed at 20 Nov
 * 2026: a person of 1850 in full, a person of 1950 by name and role only, the
 * living without a name, the sensitive event hidden until revealed, the
 * location only of a house without people of the last ~100 years, a stranger
 * of today never; and what an export under privacy keeps of the houses.
 */
import { describe, expect, it } from 'vitest';
import { collectHouses, type TreeHouse } from '../houses.js';
import { houseOutputFilter, housePrivacyContext } from '../house-privacy.js';
import { applyLivingPrivacy, isRecentPerson, inferBirthUpperBounds } from '../privacy.js';
import type { PersonId, StromData } from '../types.js';
import { HOUSE_ID, HOUSE_NOW, OLD_HOUSE_ID, houseResearch, houseTree } from './helpers/house-book-fixture.js';

const houseOf = (data: StromData, id: string): TreeHouse => collectHouses(data).find(h => h.id === id)!;
const pid = (id: string) => id as PersonId;

describe('houseOutputFilter', () => {
    const data = houseTree();
    const house = houseOf(data, HOUSE_ID);
    const out = houseOutputFilter(house, houseResearch(), data, HOUSE_NOW);
    const of = (id: string) => out.persons.find(p => p.personId === pid(id))!;

    it('a person of 1850 is shown in full; one of 1950 by name and role only; the living as living', () => {
        expect(of('hostivit')).toEqual({ personId: 'hostivit', living: false, recent: false });
        expect(of('lubor')).toEqual({ personId: 'lubor', living: false, recent: true });
        expect(of('bohuslava')).toEqual({ personId: 'bohuslava', living: true, recent: true });
        // The facts of people of the last ~100 years are left out, the older ones stay.
        const facts = new Set(out.facts.map(f => f.personId));
        expect(facts.has(pid('hostivit'))).toBe(true);
        expect(facts.has(pid('svatobor'))).toBe(true);
        expect(facts.has(pid('lubor'))).toBe(false);
        expect(facts.has(pid('vratislav'))).toBe(false);
        expect(facts.has(pid('bohuslava'))).toBe(false);
        expect(out.hidden.facts).toBeGreaterThan(0);
    });

    it('holders: owned only with a source, the last ~100 years without years, a stranger of today never', () => {
        const byId = new Map(out.holders.map(h => [h.item.id, h]));
        expect(byId.get('h1')).toMatchObject({ personId: 'svatobor', owned: true, noYears: false });
        // No source shows the holding: "lived in the house".
        expect(byId.get('h2')).toMatchObject({ personId: 'hostivit', owned: false, noYears: false });
        expect(byId.get('h3')).toMatchObject({ personId: 'lubor', owned: true, noYears: true });
        expect(byId.has('h4')).toBe(false);
        const res = new Map(out.residents.map(r => [r.item.id, r]));
        expect(res.get('r1')).toMatchObject({ personId: null, noYears: false });
        expect(res.get('r2')).toMatchObject({ personId: 'bohuslava', living: true, noYears: true });
    });

    it('the sensitive event and the events of the last ~100 years are hidden; undated and older ones stay', () => {
        expect(out.timeline.map(e => e.id)).toEqual(['e1', 'e2', 'e11']);
        expect(out.sensitiveHidden).toEqual(['e9']);
        expect(out.hidden.events).toBe(2);
    });

    it('a revealed sensitive event is shown', () => {
        const revealed: StromData = { ...data, houses: { ...data.houses, [HOUSE_ID]: { ...data.houses![HOUSE_ID], revealInOutputs: ['e9'] } } };
        const r = houseOutputFilter(houseOf(revealed, HOUSE_ID), houseResearch(), revealed, HOUSE_NOW);
        expect(r.timeline.map(e => e.id)).toEqual(['e1', 'e2', 'e9', 'e11']);
        expect(r.sensitiveHidden).toEqual([]);
        expect(r.hidden.events).toBe(1);
    });

    it('location: none for a house with people of the last ~100 years, kept for a house of the 19th century', () => {
        expect(out.location).toBeNull();
        expect(out.hidden.location).toBe(true);
        const old = houseOutputFilter(houseOf(data, OLD_HOUSE_ID), null, data, HOUSE_NOW);
        expect(old.location).toEqual({ lat: 49.6, lng: 15.3 });
        expect(old.hidden.location).toBe(false);
        expect(old.persons.every(p => !p.recent && !p.living)).toBe(true);
    });

    it('"now" comes from the caller: a hundred years later Lubor is history', () => {
        const later = new Date(2056, 5, 1, 12);
        const r = houseOutputFilter(house, houseResearch(), data, later);
        expect(r.persons.find(p => p.personId === pid('lubor'))!.recent).toBe(false);
        expect(r.holders.find(h => h.item.id === 'h3')!.noYears).toBe(false);
    });

    it('without the research: the tree\'s people and facts only, the location of the person\'s word judged the same', () => {
        const r = houseOutputFilter(house, null, data, HOUSE_NOW);
        expect(r.timeline).toEqual([]);
        expect(r.holders).toEqual([]);
        expect(r.location).toBeNull();
    });

    it('one context serves every house of an output', () => {
        const ctx = housePrivacyContext(data, HOUSE_NOW);
        expect(ctx.personOfRef('P0003')).toBe('lubor');
        expect(ctx.personOfRef('P9999')).toBeNull();
        expect(houseOutputFilter(house, houseResearch(), data, HOUSE_NOW, ctx)).toEqual(out);
    });
});

describe('isRecentPerson', () => {
    it('judges by the person\'s own records and the living', () => {
        const data = houseTree();
        const bounds = inferBirthUpperBounds(data);
        const recent = (id: string) => isRecentPerson(data, data.persons[pid(id)]!, 2026, bounds);
        expect(recent('svatobor')).toBe(false);
        expect(recent('kunhuta')).toBe(false);
        expect(recent('lubor')).toBe(true);
        // Her own record is 1970, her husband's wedding 1920: recent by her death.
        expect(recent('belomira')).toBe(true);
        expect(recent('bohuslava')).toBe(true);
    });
});

describe('houses in an export under privacy (spec 030 §10)', () => {
    it('a house of people of the last ~100 years loses its location and name; a house of the 19th century keeps them', () => {
        const data = houseTree();
        for (const mode of ['initials', 'anonymous', 'minimal'] as const) {
            const out = applyLivingPrivacy(data, mode, 2026);
            expect(out.houses?.[HOUSE_ID]).toBeUndefined();
            expect(out.houses?.[OLD_HOUSE_ID]).toEqual({ name: 'Na Mlýnku', location: { lat: 49.6, lng: 15.3, how: 'confirmed' } });
        }
        // Full data without a gift's choices: the tree as it is.
        expect(applyLivingPrivacy(data, 'full', 2026).houses?.[HOUSE_ID]?.location).toBeDefined();
    });

    it('what joins houses and tells them apart stays', () => {
        const data = houseTree();
        data.houses![HOUSE_ID] = { ...data.houses![HOUSE_ID], merged: ['belokamen|9'], revealInOutputs: ['e9'] };
        const out = applyLivingPrivacy(data, 'initials', 2026);
        expect(out.houses?.[HOUSE_ID]).toEqual({ merged: ['belokamen|9'], revealInOutputs: ['e9'] });
    });

    it('a house joined to a protected one without a fact of its own loses its name and location too', () => {
        const data = houseTree();
        data.houses!['belokamen|9'] = { name: 'U Starého', location: { lat: 49.9, lng: 15.9, how: 'confirmed' }, merged: ['belokamen|5'] };
        data.houses!['belokamen|5'] = { name: 'Na Vršku' };
        data.houses![HOUSE_ID] = { ...data.houses![HOUSE_ID], merged: ['belokamen|9'] };
        // Told apart: another house, its own word stays.
        data.houses!['belokamen|7'] = { name: 'U Lípy', merged: [HOUSE_ID], split: [HOUSE_ID] };
        for (const mode of ['initials', 'anonymous', 'minimal'] as const) {
            const out = applyLivingPrivacy(data, mode, 2026);
            expect(out.houses?.['belokamen|9']).toEqual({ merged: ['belokamen|5'] });
            expect(out.houses?.['belokamen|5']).toBeUndefined();
            expect(out.houses?.['belokamen|7']?.name).toBe('U Lípy');
            expect(out.houses?.[OLD_HOUSE_ID]?.name).toBe('Na Mlýnku');
        }
    });
});
