/**
 * A couple's story (Partnership.story) counts as a story of both partners:
 * the card's fold and its state, and the order the reader tells them in.
 * Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { personStoryState } from '../card-signals.js';
import { coupleStories } from '../story-text.js';
import { Partnership, Person, PersonId, Story, StromData } from '../types.js';

function tree(own: Story | undefined, couples: (Story | undefined)[]): { data: StromData; anna: Person; karel: Person } {
    const anna = { id: 'anna', firstName: 'Anna', lastName: 'Horká', gender: 'female', parentIds: [], childIds: [], partnerships: [] as string[], story: own } as unknown as Person;
    const karel = { id: 'karel', firstName: 'Karel', lastName: 'Horký', gender: 'male', parentIds: [], childIds: [], partnerships: [] as string[] } as unknown as Person;
    const persons: Record<string, Person> = { anna, karel };
    const partnerships: Record<string, Partnership> = {};
    couples.forEach((story, i) => {
        const other = i === 0 ? karel : ({ ...karel, id: `p${i}`, partnerships: [] } as unknown as Person);
        persons[other.id] = other;
        const u = { id: `u${i}`, person1Id: other.id as PersonId, person2Id: anna.id, childIds: [], story } as unknown as Partnership;
        partnerships[u.id] = u;
        anna.partnerships.push(u.id);
        other.partnerships.push(u.id);
    });
    return { data: { persons, partnerships } as unknown as StromData, anna, karel };
}

const final = (text: string, draft?: string): Story => ({ text, status: 'final', ...(draft ? { draft: { text: draft } } : {}) }) as Story;
const draft = (text: string): Story => ({ text, status: 'draft' }) as Story;

describe('personStoryState', () => {
    it('only a couple\'s story: both partners carry it', () => {
        const { data, anna, karel } = tree(undefined, [final('Svatba v Lysé.')]);
        expect(personStoryState(anna, data)).toEqual({ story: 'final', storyNew: false });
        expect(personStoryState(karel, data)).toEqual({ story: 'final', storyNew: false });
    });

    it('a couple\'s draft is a draft; its waiting new version counts', () => {
        expect(personStoryState(...pick(tree(undefined, [draft('Návrh.')])))).toEqual({ story: 'draft', storyNew: false });
        expect(personStoryState(...pick(tree(undefined, [final('Svatba.', 'Svatba v květnu.')])))).toEqual({ story: 'final', storyNew: true });
    });

    it('approved when any couple\'s story is', () => {
        expect(personStoryState(...pick(tree(undefined, [draft('Návrh.'), final('Druhá svatba.')])))).toEqual({ story: 'final', storyNew: false });
    });

    it('the person\'s own story decides the state; a couple\'s new version still counts', () => {
        expect(personStoryState(...pick(tree(draft('Vlastní.'), [final('Svatba.')])))).toEqual({ story: 'draft', storyNew: false });
        expect(personStoryState(...pick(tree(final('Vlastní.'), [draft('Návrh.')])))).toEqual({ story: 'final', storyNew: false });
        expect(personStoryState(...pick(tree(final('Vlastní.'), [final('Svatba.', 'Nová.')])))).toEqual({ story: 'final', storyNew: true });
    });

    it('nothing written: no story (an empty couple text neither)', () => {
        expect(personStoryState(...pick(tree(undefined, [undefined, { text: '  ' } as Story])))).toEqual({ story: null, storyNew: false });
    });
});

describe('coupleStories', () => {
    it('the person\'s couples with a story, in the person\'s order', () => {
        const { data, anna } = tree(undefined, [final('První.'), undefined, final('Třetí.')]);
        expect(coupleStories(data, anna).map(u => u.id)).toEqual(['u0', 'u2']);
    });
});

function pick(t: { data: StromData; anna: Person }): [Person, StromData] {
    return [t.anna, t.data];
}
