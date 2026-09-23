/**
 * Strom Research in the app (3.0): the website address (one builder, language
 * parameter for cs/de only) and the pure gating of the menu item, the "New"
 * marker and the one-time "What's new in 3.0" card.
 */

import { describe, it, expect } from 'vitest';
import { researchSiteUrl, RESEARCH_SITE_URL } from '../research-link.js';
import {
    ResearchPromoContext,
    WhatsNewContext,
    NEW_MARKER_DAYS,
    isPromoAvailable,
    isMenuItemVisible,
    isNewMarkerExpired,
    isNewMarkerActive,
    decideWhatsNewCard,
} from '../research-promo.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-23T12:00:00Z');

const base: ResearchPromoContext = { embedded: false, viewMode: false, locked: false, researchTree: false, cliOpen: false };
const card: WhatsNewContext = { ...base, treeReady: true, emptyTree: false, busy: false, tourActive: false };

describe('researchSiteUrl', () => {
    it('adds ?lang= for Czech and German only', () => {
        expect(researchSiteUrl('cs')).toBe('https://stromapp.info/research/?lang=cs');
        expect(researchSiteUrl('de')).toBe('https://stromapp.info/research/?lang=de');
    });

    it('English (and anything else) gets the bare address, no referrer tag', () => {
        expect(researchSiteUrl('en')).toBe(RESEARCH_SITE_URL);
        expect(researchSiteUrl('fr')).toBe('https://stromapp.info/research/');
        expect(researchSiteUrl('')).toBe(RESEARCH_SITE_URL);
        expect(researchSiteUrl('cs')).not.toContain('from=');
    });
});

describe('menu item availability', () => {
    it('is offered in the regular app', () => {
        expect(isPromoAvailable(base)).toBe(true);
        expect(isMenuItemVisible(base)).toBe(true);
    });

    it('never in an exported file or view mode; not behind a lock', () => {
        expect(isPromoAvailable({ ...base, embedded: true })).toBe(false);
        expect(isPromoAvailable({ ...base, viewMode: true })).toBe(false);
        expect(isMenuItemVisible({ ...base, locked: true })).toBe(false);
    });

    it('stays for a research tree and for an open from the command line', () => {
        expect(isMenuItemVisible({ ...base, researchTree: true })).toBe(true);
        expect(isMenuItemVisible({ ...base, cliOpen: true })).toBe(true);
    });
});

describe('"New" marker', () => {
    it('is lit for a fresh browser and while within 30 days', () => {
        expect(isNewMarkerActive({}, base, NOW)).toBe(true);
        const firstSeen = new Date(NOW.getTime() - (NEW_MARKER_DAYS - 1) * DAY).toISOString();
        expect(isNewMarkerActive({ researchNewFirstSeen: firstSeen }, base, NOW)).toBe(true);
    });

    it('goes out 30 days after it was first shown', () => {
        const firstSeen = new Date(NOW.getTime() - NEW_MARKER_DAYS * DAY).toISOString();
        expect(isNewMarkerExpired({ researchNewFirstSeen: firstSeen }, NOW)).toBe(true);
        expect(isNewMarkerActive({ researchNewFirstSeen: firstSeen }, base, NOW)).toBe(false);
    });

    it('a broken date never hides it', () => {
        expect(isNewMarkerExpired({ researchNewFirstSeen: 'not a date' }, NOW)).toBe(false);
        expect(isNewMarkerExpired({}, NOW)).toBe(false);
    });

    it('goes out for good once dismissed', () => {
        expect(isNewMarkerActive({ researchNewDismissed: true }, base, NOW)).toBe(false);
    });

    it('is off for a research tree, locked data, view mode and exports — on for a command-line open', () => {
        expect(isNewMarkerActive({}, { ...base, researchTree: true }, NOW)).toBe(false);
        expect(isNewMarkerActive({}, { ...base, locked: true }, NOW)).toBe(false);
        expect(isNewMarkerActive({}, { ...base, viewMode: true }, NOW)).toBe(false);
        expect(isNewMarkerActive({}, { ...base, embedded: true }, NOW)).toBe(false);
        expect(isNewMarkerActive({}, { ...base, cliOpen: true }, NOW)).toBe(true);
    });
});

describe('"What\'s new in 3.0" card', () => {
    it('shows once for an existing tree on the first 3.0 start', () => {
        expect(decideWhatsNewCard({}, card)).toBe('show');
        expect(decideWhatsNewCard({ whatsNew30Shown: true }, card)).toBe('wait');
    });

    it('a new user on the welcome screen is marked as shown instead', () => {
        expect(decideWhatsNewCard({}, { ...card, emptyTree: true })).toBe('mark-shown');
    });

    it('shows even after "New" went out (the card and the marker are separate)', () => {
        expect(decideWhatsNewCard({ researchNewDismissed: true }, card)).toBe('show');
    });

    it('waits — without being used up — while something is in the way', () => {
        for (const ctx of [
            { ...card, treeReady: false },
            { ...card, busy: true },
            { ...card, tourActive: true },
            { ...card, locked: true },
            { ...card, cliOpen: true },
            { ...card, researchTree: true },
        ]) {
            expect(decideWhatsNewCard({}, ctx)).toBe('wait');
        }
    });

    it('never in view mode or an exported file — not even marked', () => {
        expect(decideWhatsNewCard({}, { ...card, viewMode: true })).toBe('wait');
        expect(decideWhatsNewCard({}, { ...card, embedded: true })).toBe('wait');
        expect(decideWhatsNewCard({}, { ...card, embedded: true, emptyTree: true })).toBe('wait');
    });
});
