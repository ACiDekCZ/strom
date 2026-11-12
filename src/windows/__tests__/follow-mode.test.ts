/**
 * "Follow selection" modes of a satellite (spec 079 K2.1): the default from
 * the view, the stored choice, switch only where the centre can move.
 */

import { describe, it, expect } from 'vitest';
import { defaultFollowMode, effectiveFollowMode, followChoiceToStore, followModesFor, parseFollowChoice, viewRecenters } from '../follow-mode.js';

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
