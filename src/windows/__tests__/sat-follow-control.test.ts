/**
 * The satellite header's "Selection" control (spec 110 §1, §4, §6, §7): its
 * closed parts by the header's width, the main window's group of its menu
 * (greyed while off here or without the main window, a note while the main
 * window follows the agent) and its aria-label in whole words. The value of
 * Focus is the card's own Focus.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { getStringsForLang, setLanguage } from '../../strings.js';
import {
    followControlParts, followSendGroupState, followControlAria, sendModeName, followModeName,
    type FollowControlState,
} from '../sat-header.js';

const table = (over: Partial<FollowControlState> = {}): FollowControlState => ({ recv: 'mark', send: 'focus', agent: false, mainClosed: false, ...over });

describe('the closed control by the header width', () => {
    it('"Selection:" and both directions from 1280 px, both from 1100 px, the sent direction alone beside the tabs below it', () => {
        expect(followControlParts(1440, table())).toEqual({ label: true, recv: true, send: true, text: true });
        expect(followControlParts(1280, table())).toEqual({ label: true, recv: true, send: true, text: true });
        expect(followControlParts(1279, table())).toEqual({ label: false, recv: true, send: true, text: true });
        expect(followControlParts(1100, table())).toEqual({ label: false, recv: true, send: true, text: true });
        expect(followControlParts(1099, table())).toEqual({ label: false, recv: false, send: true, text: true });
        expect(followControlParts(960, table())).toEqual({ label: false, recv: false, send: true, text: true });
    });

    it('below the view tabs (< 960 px) both directions again; a phone keeps the sent direction\'s icon alone', () => {
        expect(followControlParts(959, table())).toEqual({ label: false, recv: true, send: true, text: true });
        expect(followControlParts(800, table())).toEqual({ label: false, recv: true, send: true, text: true });
        expect(followControlParts(641, table())).toEqual({ label: false, recv: true, send: true, text: true });
        expect(followControlParts(640, table())).toEqual({ label: false, recv: false, send: true, text: false });
        expect(followControlParts(390, table({ send: 'mark' }))).toEqual({ label: false, recv: false, send: true, text: false });
    });

    it('off is "⊘ off" at every width (with "Selection:" from 1280 px); a view without the main window\'s choice says its own direction alone', () => {
        for (const w of [1440, 1024, 960, 800]) {
            expect(followControlParts(w, table({ recv: 'off' }))).toEqual({ label: w >= 1280, recv: true, send: false, text: true });
        }
        expect(followControlParts(390, table({ recv: 'off' }))).toEqual({ label: false, recv: true, send: false, text: false });
        const family = table({ recv: 'switch', send: null });
        expect(followControlParts(1024, family)).toEqual({ label: false, recv: true, send: false, text: true });
        expect(followControlParts(1440, family)).toEqual({ label: true, recv: true, send: false, text: true });
    });
});

describe('the main window\'s group of the menu', () => {
    it('greyed while off here (the choice kept) or without the main window; a note while the main window follows the agent', () => {
        expect(followSendGroupState(table())).toEqual({ disabled: false, note: null });
        expect(followSendGroupState(table({ recv: 'off' }))).toEqual({ disabled: true, note: 'off' });
        expect(followSendGroupState(table({ mainClosed: true }))).toEqual({ disabled: true, note: 'no-main' });
        expect(followSendGroupState(table({ agent: true }))).toEqual({ disabled: false, note: 'agent' });
        expect(followSendGroupState(table({ recv: 'off', agent: true }))).toEqual({ disabled: true, note: 'off' });
    });
});

describe('the words', () => {
    afterEach(() => setLanguage('en'));

    it('Focus is the card\'s own Focus in every language, lower case as the other values', () => {
        for (const lang of ['en', 'cs', 'de', 'pl'] as const) {
            setLanguage(lang);
            const focus = getStringsForLang(lang).contextMenu.focus;
            expect(sendModeName('focus')).toBe(focus.charAt(0).toLocaleLowerCase() + focus.slice(1));
        }
        setLanguage('cs');
        expect(sendModeName('focus')).toBe('zaměřit');
        setLanguage('de');
        expect(sendModeName('focus')).toBe('fokussieren');
    });

    it('the aria-label says both directions in whole words, the agent, off, and a view\'s own direction alone', () => {
        setLanguage('en');
        expect(followControlAria(table())).toBe('Person selection between windows. From other windows: mark only. To the main window: focus.');
        expect(followControlAria(table({ agent: true }))).toBe('Person selection between windows. From other windows: mark only. To the main window: focus (agent).');
        expect(followControlAria(table({ recv: 'off' }))).toBe('Person selection between windows: off.');
        expect(followControlAria(table({ recv: 'switch', send: null }))).toBe('Person selection between windows. From other windows: switch.');
        setLanguage('de');
        expect(followControlAria(table({ agent: true }))).toBe('Personenauswahl zwischen Fenstern. Aus anderen Fenstern: nur markieren. Ins Hauptfenster: fokussieren (Agent).');
        expect(followModeName('off')).toBe('aus');
    });

    it('no text addresses the reader', () => {
        // German "sie" (them) is fine; the polite "Sie" / "Ihr" and "du" are not.
        const addressing = { en: /\b(you|your)\b/i, cs: /(^|\s)(vy|váš|vaše|vás|ty|tvůj)(\s|$|[.,])/i, de: /\b(Sie|Ihr|Ihre|du|dein)\b/, pl: /(^|\s)(ty|twój|pan|pani)(\s|$|[.,])/i } as const;
        for (const lang of ['en', 'cs', 'de', 'pl'] as const) {
            const all = Object.values(getStringsForLang(lang).satFollow)
                .map(v => (typeof v === 'function' ? (v as (...a: string[]) => string)('x', 'y') : v)).join(' ');
            expect(all).not.toMatch(addressing[lang]);
        }
    });
});
