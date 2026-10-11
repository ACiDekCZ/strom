/**
 * About: the Czech users' group on Facebook is offered only in the Czech UI,
 * as a plain link opening in a new tab; English and German get no link.
 */
import { describe, it, expect } from 'vitest';
import { aboutUsersGroupLink } from '../about-links.js';

describe("About: the users' group link", () => {
    it('is offered in Czech with the exact URL, a new tab and noopener', () => {
        const link = aboutUsersGroupLink('cs');
        expect(link).not.toBeNull();
        expect(link!.href).toBe('https://www.facebook.com/groups/stromapp');
        expect(link!.label).toBe('Skupina uživatelů na Facebooku ↗');
        expect(link!.target).toBe('_blank');
        expect(link!.rel).toMatch(/\bnoopener\b/);
        expect(link!.rel).toMatch(/\bnoreferrer\b/);
    });

    it('is not offered in English or German', () => {
        expect(aboutUsersGroupLink('en')).toBeNull();
        expect(aboutUsersGroupLink('de')).toBeNull();
    });
});
