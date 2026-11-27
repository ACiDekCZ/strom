/**
 * A sensitive event of a house in the Houses window (spec 030 §10, K1.4a):
 * only when the research sent `sensitive`, each one "hidden in outputs" with
 * "Show in outputs" until a person reveals it (then "Hide in outputs"), no
 * link in a tree that cannot be changed, and the sentence of what outputs
 * leave out of the house.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { houseSensitiveHtml, withRevealed } from '../ui/house-state-ui.js';
import { collectHouses } from '../houses.js';
import { setLanguage } from '../strings.js';
import { HOUSE_ID, HOUSE_NOW, SENSITIVE_TEXT, houseResearch, houseTree } from './helpers/house-book-fixture.js';

afterEach(() => setLanguage('cs'));

const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const house = (data = houseTree()) => collectHouses(data).find(h => h.id === HOUSE_ID)!;

describe('houseSensitiveHtml', () => {
    it('nothing without the research or without its sensitive events', () => {
        setLanguage('cs');
        const data = houseTree();
        expect(houseSensitiveHtml(house(data), null, data, HOUSE_NOW, { lang: 'cs', readOnly: false })).toBe('');
        expect(houseSensitiveHtml(house(data), { ...houseResearch(), sensitive: [] }, data, HOUSE_NOW, { lang: 'cs', readOnly: false })).toBe('');
    });

    it('hidden: the quiet "hidden in outputs", "Show in outputs" and the sentence of what outputs leave out', () => {
        setLanguage('cs');
        const data = houseTree();
        const html = houseSensitiveHtml(house(data), houseResearch(), data, HOUSE_NOW, { lang: 'cs', readOnly: false });
        expect(text(html)).toBe(`Ve výstupech (HTML, kniha) se 2 události a poloha domu neukazují (lidé posledních ~100 let). 1948 · ${SENSITIVE_TEXT} skryto ve výstupech Ukázat ve výstupech`);
        expect(html).toContain('data-event="e9" data-reveal="show"');
    });

    it('revealed: "Hide in outputs", the sentence counts one event fewer', () => {
        setLanguage('en');
        const data = houseTree();
        data.houses![HOUSE_ID].revealInOutputs = ['e9'];
        const html = houseSensitiveHtml(house(data), houseResearch(), data, HOUSE_NOW, { lang: 'en', readOnly: false });
        expect(text(html)).toBe(`In outputs (HTML, book) 1 event and the house location are not shown (people of the last ~100 years). 1948 · ${SENSITIVE_TEXT} Hide in outputs`);
        expect(html).toContain('data-reveal="hide"');
    });

    it('a tree that cannot be changed: the state without the link', () => {
        setLanguage('cs');
        const data = houseTree();
        const html = houseSensitiveHtml(house(data), houseResearch(), data, HOUSE_NOW, { lang: 'cs', readOnly: true });
        expect(html).toContain('skryto ve výstupech');
        expect(html).not.toContain('house-reveal');
    });
});

describe('withRevealed', () => {
    it('adds and removes one event, keeping the others', () => {
        expect(withRevealed(undefined, 'e9', true)).toEqual(['e9']);
        expect(withRevealed(['e3', 'e9'], 'e9', false)).toEqual(['e3']);
        expect(withRevealed(['e9'], 'e9', true)).toEqual(['e9']);
    });
});
