/**
 * A couple's story (Partnership.story) counts as a story of both partners:
 * the card's fold and its state, and the order the reader tells them in.
 * Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { personStoryState, stateStripesHtml, storySignalInLine, storySignalText } from '../card-signals.js';
import { strings } from '../strings.js';
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

const final = (text: string, draft?: string, title?: string): Story => ({ text, status: 'final', ...(title ? { title } : {}), ...(draft ? { draft: { text: draft } } : {}) }) as Story;
const draft = (text: string): Story => ({ text, status: 'draft' }) as Story;

describe('personStoryState', () => {
    it('only a couple\'s story: both partners carry it', () => {
        const { data, anna, karel } = tree(undefined, [final('Svatba v Lysé.')]);
        expect(personStoryState(anna, data)).toEqual({ kind: 'couple', final: true, title: '', storyNew: false });
        expect(personStoryState(karel, data)).toEqual({ kind: 'couple', final: true, title: '', storyNew: false });
    });

    it('a couple\'s draft is a draft; its waiting new version counts', () => {
        expect(personStoryState(...pick(tree(undefined, [draft('Návrh.')])))).toEqual({ kind: 'couple', final: false, title: '', storyNew: false });
        expect(personStoryState(...pick(tree(undefined, [final('Svatba.', 'Svatba v květnu.')])))).toEqual({ kind: 'couple', final: true, title: '', storyNew: true });
    });

    it('approved when any couple\'s story is', () => {
        expect(personStoryState(...pick(tree(undefined, [draft('Návrh.'), final('Druhá svatba.', undefined, 'Druhá')])))).toEqual({ kind: 'couple', final: true, title: 'Druhá', storyNew: false });
    });

    it('the person\'s own story decides the state; a couple\'s new version still counts', () => {
        expect(personStoryState(...pick(tree(draft('Vlastní.'), [final('Svatba.')])))).toEqual({ kind: 'own', final: false, title: '', storyNew: false });
        expect(personStoryState(...pick(tree(final('Vlastní.', undefined, 'Mládí'), [draft('Návrh.')])))).toEqual({ kind: 'own', final: true, title: 'Mládí', storyNew: false });
        expect(personStoryState(...pick(tree(final('Vlastní.'), [final('Svatba.', 'Nová.')])))).toEqual({ kind: 'own', final: true, title: '', storyNew: true });
    });

    it('nothing written: no story (an empty couple text neither)', () => {
        expect(personStoryState(...pick(tree(undefined, [undefined, { text: '  ' } as Story])))).toBeNull();
    });
});

describe('the corner and its words (spec 027 §5.6)', () => {
    const words = strings.card.story;

    it('own story: a full corner; a couple\'s alone: a hollow one; a draft is pale', () => {
        expect(stateStripesHtml(null, { kind: 'own', final: true })).toBe('<span class="card-story" aria-hidden="true"></span>');
        expect(stateStripesHtml(null, { kind: 'couple', final: true })).toBe('<span class="card-story couple" aria-hidden="true"></span>');
        expect(stateStripesHtml(null, { kind: 'couple', final: false })).toBe('<span class="card-story draft couple" aria-hidden="true"></span>');
    });

    it('the hollow corner keeps the own story\'s corner colour, never --accent (round 2, point 11)', () => {
        const css = readFileSync(join(__dirname, '../../index.html'), 'utf8');
        // Every rule that sets the corner colour: none may take --accent.
        const sets = css.split('\n').filter(line => /--fold\s*:/.test(line));
        expect(sets.length).toBeGreaterThan(0);
        for (const line of sets) expect(line).not.toMatch(/--fold\s*:\s*var\(--accent/);
        expect(css).toMatch(/\.card-story \{\s*--fold: var\(--story-fold\)/);
    });

    it('a tinted chapter sits on the --card-bg-2 surface: light, dark, print, and the saved file\'s tokens (round 2, point 10)', async () => {
        const css = readFileSync(join(__dirname, '../../index.html'), 'utf8');
        expect(css).toMatch(/--card-bg-2:\s*#f6f1e6/);
        expect(css).toMatch(/--card-bg-2:\s*#26241f/);
        const tint = css.split('\n').findIndex(l => l.includes('.story-reader-ch--tint {'));
        expect(css.split('\n').slice(tint, tint + 4).join('\n')).toContain('background: var(--card-bg-2)');
        const { PERSON_PAGE_LIGHT_TOKENS, PERSON_PAGE_CSS } = await import('../person-page-css.js');
        expect(PERSON_PAGE_LIGHT_TOKENS).toContain('--card-bg-2: #f6f1e6');
        expect(PERSON_PAGE_CSS).toMatch(/\.pp-couple-story--tint \{[^}]*background: var\(--card-bg-2\)/);
        expect(PERSON_PAGE_CSS).toMatch(/\.pp-couple-story--tint \{[^}]*background: transparent[^}]*border: 1px solid var\(--border\)/);
    });

    it('the chapter chips fade at the edge where they are cut off on a phone (round 2, c)', () => {
        const css = readFileSync(join(__dirname, '../../index.html'), 'utf8');
        for (const cls of ['.story-chips--more-end {', '.story-chips--more-start {', '.story-chips--more-start.story-chips--more-end {']) {
            const at = css.indexOf(cls);
            expect(at).toBeGreaterThan(0);
            expect(css.slice(at, at + 300)).toContain('mask-image: linear-gradient(90deg');
        }
        const ui = readFileSync(join(__dirname, '../ui/person-sources-ui.ts'), 'utf8');
        expect(ui).toContain("classList.toggle('story-chips--more-end'");
        expect(ui).toContain("classList.toggle('story-chips--more-start'");
    });

    it('says whose story it is, its title, a draft and a new version', () => {
        expect(storySignalText({ kind: 'own', final: true, title: 'Mládí', storyNew: false }, words)).toBe(words.own('Mládí'));
        expect(storySignalText({ kind: 'couple', final: true, title: '', storyNew: false }, words)).toBe(words.couple(''));
        expect(storySignalText({ kind: 'couple', final: false, title: 'Svatba', storyNew: false }, words)).toBe(words.draft(words.couple('Svatba')));
        expect(storySignalText({ kind: 'own', final: true, title: '', storyNew: true }, words)).toBe(words.nv(words.own('')));
    });

    it('runs on in lower case inside the status line, except German nouns keep their capital', () => {
        expect(storySignalInLine('Story of the marriage: Second union', 'en')).toBe('story of the marriage: Second union');
        expect(storySignalInLine('Vyprávění manželství: Druhý svazek', 'cs')).toBe('vyprávění manželství: Druhý svazek');
        expect(storySignalInLine('Geschichte der Ehe: Zweite Ehe', 'de')).toBe('Geschichte der Ehe: Zweite Ehe');
    });
});

describe('coupleStories', () => {
    it('the person\'s couples with a story, in the person\'s order', () => {
        const { data, anna } = tree(undefined, [final('První.'), undefined, final('Třetí.')]);
        expect(coupleStories(data, anna).map(u => u.id)).toEqual(['u0', 'u2']);
    });

    it('in the order of the marriages: by wedding year, undated ones last', () => {
        const { data, anna } = tree(undefined, [final('První.'), final('Druhá.'), final('Třetí.')]);
        const u = data.partnerships as Record<string, Partnership>;
        u.u0.startDate = undefined;
        u.u1.startDate = '1910';
        u.u2.startDate = '1890';
        expect(coupleStories(data, anna).map(u => u.id)).toEqual(['u2', 'u1', 'u0']);
    });
});

function pick(t: { data: StromData; anna: Person }): [Person, StromData] {
    return [t.anna, t.data];
}
