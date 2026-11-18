/**
 * "Follow selection" modes of a satellite (spec 079 K2.1): the default from
 * the view, the stored choice, switch only where the centre can move.
 */

import { describe, it, expect } from 'vitest';
import { defaultFollowMode, effectiveFollowMode, followChoiceToStore, followModesFor, getSendMode, getSendModeChoice, parseFollowChoice, parseSendMode, sendModeAvailable, sendModeKey, setSendMode, viewRecenters } from '../follow-mode.js';

describe('follow mode', () => {
    it('switch in Family, Descendants and the Fan; mark in the Timeline, the Map, the Table and the overview', () => {
        expect(['family', 'descendants', 'fan'].map(k => defaultFollowMode(k as never))).toEqual(['switch', 'switch', 'switch']);
        expect(['timeline', 'map', 'table', 'overview'].map(k => defaultFollowMode(k as never))).toEqual(['mark', 'mark', 'mark', 'mark']);
        expect(viewRecenters('book')).toBe(false);
    });

    it('the header offers switch only where the centre can move', () => {
        expect(followModesFor('fan')).toEqual(['switch', 'mark', 'off']);
        expect(followModesFor('map')).toEqual(['mark', 'off']);
    });

    it('a stored choice, the old on/off values, anything else none', () => {
        expect(['switch', 'mark', 'off', '0', '1', '', null, 'x'].map(parseFollowChoice)).toEqual(['switch', 'mark', 'off', 'off', null, null, null, null]);
    });

    it('the choice wins over the default; switch where the centre cannot move only marks', () => {
        expect(effectiveFollowMode(null, 'descendants')).toBe('switch');
        expect(effectiveFollowMode('mark', 'descendants')).toBe('mark');
        expect(effectiveFollowMode('off', 'table')).toBe('off');
        expect(effectiveFollowMode('switch', 'timeline')).toBe('mark');
    });

    it('the view\'s default is not stored as a choice', () => {
        expect(followChoiceToStore('switch', 'family')).toBe('');
        expect(followChoiceToStore('mark', 'family')).toBe('mark');
        expect(followChoiceToStore('mark', 'map')).toBe('');
        expect(followChoiceToStore('off', 'map')).toBe('off');
    });
});

describe('send mode (spec 110 §1)', () => {
    const store = () => {
        const m = new Map<string, string>();
        return { m, s: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } } };
    };

    it('offered in the Table, the Timeline and the Map; not in the charts', () => {
        expect(['table', 'timeline', 'map'].map(sendModeAvailable)).toEqual([true, true, true]);
        expect(['family', 'descendants', 'fan', 'overview'].map(sendModeAvailable)).toEqual([false, false, false, false]);
    });

    it('mark until focus is chosen; kept per window; a view without it marks only', () => {
        const { m, s } = store();
        expect(getSendModeChoice('w1', s)).toBe('mark');
        setSendMode('w1', 'focus', s);
        expect(m.get(sendModeKey('w1'))).toBe('focus');
        expect(getSendModeChoice('w1', s)).toBe('focus');
        expect(getSendModeChoice('w2', s)).toBe('mark');
        expect(getSendMode('w1', 'table', s)).toBe('focus');
        expect(getSendMode('w1', 'fan', s)).toBe('mark');
        setSendMode('w1', 'mark', s);
        expect(m.get(sendModeKey('w1'))).toBe('');
        expect(parseSendMode('anything')).toBe('mark');
        // No storage (a private window that throws): the default.
        expect(getSendModeChoice('w1', { getItem: () => { throw new Error('no'); }, setItem: () => {} })).toBe('mark');
    });
});
