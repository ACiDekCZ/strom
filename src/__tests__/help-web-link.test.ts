/**
 * The help's link to a chapter on the web follows the site's addresses:
 * English without a language prefix, the other languages with theirs in front
 * (https://stromapp.info/cs/doc/R4/); the old /doc/<lang>/ form is only a redirect.
 */
import { describe, it, expect } from 'vitest';
import { helpWebLink } from '../ui/help-ui.js';

describe('helpWebLink', () => {
    it('English has no prefix', () => {
        expect(helpWebLink('en', 'R4', null)).toBe('https://stromapp.info/doc/R4/');
        expect(helpWebLink('en', 'R4', 'R4.2')).toBe('https://stromapp.info/doc/R4/#R4.2');
    });
    it('the other languages lead with theirs', () => {
        expect(helpWebLink('cs', 'R4', null)).toBe('https://stromapp.info/cs/doc/R4/');
        expect(helpWebLink('de', 'A1', 'A1.1')).toBe('https://stromapp.info/de/doc/A1/#A1.1');
        expect(helpWebLink('pl', 'S2', 'S2.3')).toBe('https://stromapp.info/pl/doc/S2/#S2.3');
    });
});
