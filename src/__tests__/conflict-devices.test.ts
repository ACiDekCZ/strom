import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../strings.js';
import {
    conflictDevicePair, conflictDevicePairLine, conflictDeviceWords, deviceWords, otherDeviceWords, sendSourceWords, sharedConflictWords,
    shortDeviceName,
} from '../conflict-devices.js';

/** The devices of the research's sends in words (spec 094 K2.4): this browser, a name, an id, a send's words. */

const OWN = 'own-browser-0001';
const thisOne = (id: string) => id === OWN;
const EDGE = { id: 'e1d2c3b4a5f6-edge', name: 'Edge · Windows' };
const NAMELESS = { id: '9f8e7d6c5b4a3210' };

afterEach(() => setLanguage('en'));

describe('deviceWords', () => {
    it('names this browser, a device by its name, a nameless one by its id\'s first 8 characters', () => {
        expect(deviceWords({ id: OWN, name: 'Chrome · Mac' }, thisOne)).toBe('this browser');
        expect(deviceWords(EDGE, thisOne)).toBe('Edge · Windows');
        expect(deviceWords(NAMELESS, thisOne)).toBe('9f8e7d6c');
        expect(deviceWords({}, thisOne)).toBe('');
        expect(deviceWords(null, thisOne)).toBe('');
    });

    it('reads after "from" in every language; a device\'s name is never translated', () => {
        setLanguage('cs');
        expect(deviceWords({ id: OWN }, thisOne)).toBe('tohoto prohlížeče');
        expect(deviceWords(EDGE, thisOne)).toBe('Edge · Windows');
        setLanguage('de');
        expect(deviceWords({ id: OWN }, thisOne)).toBe('diesem Browser');
        setLanguage('pl');
        expect(deviceWords({ id: OWN }, thisOne)).toBe('tej przeglądarki');
    });
});

describe('otherDeviceWords', () => {
    it('says only another browser: this one and a send without a device add nothing', () => {
        expect(otherDeviceWords(EDGE, thisOne)).toBe('Edge · Windows');
        expect(otherDeviceWords(NAMELESS, thisOne)).toBe('9f8e7d6c');
        expect(otherDeviceWords({ id: OWN, name: 'Chrome · Mac' }, thisOne)).toBe('');
        expect(otherDeviceWords(undefined, thisOne)).toBe('');
    });
});

describe('conflictDeviceWords', () => {
    it('the later send (the app\'s side) and the earlier one (the research\'s), each by its device', () => {
        const w = conflictDeviceWords({ later: { id: OWN, name: 'Chrome · Mac' }, earlier: EDGE }, thisOne)!;
        expect(w).toEqual({ user: 'this browser', research: 'Edge · Windows' });
        expect(conflictDevicePair(w)).toBe('edit from Edge · Windows × edit from this browser');
        expect(conflictDevicePairLine(w)).toBe('Edit from Edge · Windows × edit from this browser.');
    });

    it('a side whose send named no device is the earlier / the later send', () => {
        expect(conflictDeviceWords({ later: {}, earlier: EDGE }, thisOne)).toEqual({ user: 'the later send', research: 'Edge · Windows' });
        expect(conflictDeviceWords({ later: { id: OWN }, earlier: {} }, thisOne)).toEqual({ user: 'this browser', research: 'an earlier send' });
        expect(conflictDeviceWords({ later: {}, earlier: {} }, thisOne)).toEqual({ user: 'the later send', research: 'an earlier send' });
    });

    it('two sides that would read the same are told apart by their order', () => {
        expect(conflictDeviceWords({ later: { id: OWN }, earlier: { id: OWN } }, thisOne)).toEqual({ user: 'the later send', research: 'an earlier send' });
        expect(conflictDeviceWords({ later: EDGE, earlier: { ...EDGE } }, thisOne)).toEqual({ user: 'the later send', research: 'an earlier send' });
    });

    it('none known: null (the sides read as before)', () => {
        expect(conflictDeviceWords(null, thisOne)).toBeNull();
        expect(conflictDeviceWords(undefined, thisOne)).toBeNull();
    });

    it('in Czech, German and Polish as the research words it', () => {
        const sides = { later: { id: OWN }, earlier: EDGE };
        setLanguage('cs');
        expect(conflictDevicePair(conflictDeviceWords(sides, thisOne)!)).toBe('úprava z Edge · Windows × úprava z tohoto prohlížeče');
        expect(conflictDevicePair(conflictDeviceWords({ later: {}, earlier: {} }, thisOne)!)).toBe('úprava z dřívějšího poslání × úprava z pozdějšího poslání');
        setLanguage('de');
        expect(conflictDevicePair(conflictDeviceWords(sides, thisOne)!)).toBe('Änderung von Edge · Windows × Änderung von diesem Browser');
        setLanguage('pl');
        expect(conflictDevicePair(conflictDeviceWords(sides, thisOne)!)).toBe('zmiana z Edge · Windows × zmiana z tej przeglądarki');
    });
});

describe('sharedConflictWords', () => {
    const a = { user: 'this browser', research: 'Edge · Windows' };
    it('one pair for several conflicts only when all are between the same two devices', () => {
        expect(sharedConflictWords([a, { ...a }])).toEqual(a);
        expect(sharedConflictWords([a, { user: 'this browser', research: 'Firefox · Linux' }])).toBeNull();
        expect(sharedConflictWords([a, null])).toBeNull();
        expect(sharedConflictWords([])).toBeNull();
    });
});

describe('sendSourceWords (spec 094 §9: a line\'s source where the research has the devices\' gateway)', () => {
    const PHONE = { id: 'dv_7f3a9c21e0b4', name: 'iPhone · Safari' };

    it('names a device by its name (its id\'s first 8 characters without one), the computer by its name, the agent', () => {
        expect(sendSourceWords(PHONE, false, '', thisOne)).toBe('from iPhone · Safari');
        expect(sendSourceWords({ id: 'dv_7f3a9c21e0b4' }, false, '', thisOne)).toBe('from dv_7f3a9');
        expect(sendSourceWords(EDGE, false, 'Pracovna', thisOne)).toBe('from computer Pracovna');
        expect(sendSourceWords(undefined, true, 'Pracovna', thisOne)).toBe('agent');
        expect(sendSourceWords(undefined, false, 'Pracovna', thisOne)).toBe('');
    });

    it('on the computer (its name not known there) another browser as before, this browser nothing', () => {
        expect(sendSourceWords(EDGE, false, '', thisOne)).toBe('from Edge · Windows');
        expect(sendSourceWords({ id: OWN }, false, '', thisOne)).toBe('');
    });

    it('in Czech, German and Polish', () => {
        setLanguage('cs');
        expect(sendSourceWords(PHONE, false, '', thisOne)).toBe('ze zařízení iPhone · Safari');
        expect(sendSourceWords(EDGE, false, 'Pracovna', thisOne)).toBe('z počítače Pracovna');
        setLanguage('de');
        expect(sendSourceWords(PHONE, false, '', thisOne)).toBe('von iPhone · Safari');
        expect(sendSourceWords(EDGE, false, 'Pracovna', thisOne)).toBe('vom Computer Pracovna');
        setLanguage('pl');
        expect(sendSourceWords(EDGE, false, 'Pracovna', thisOne)).toBe('z komputera Pracovna');
    });

    it('a device\'s short name is the first part of its name', () => {
        expect(shortDeviceName('iPhone · Safari')).toBe('iPhone');
        expect(shortDeviceName('Pracovna')).toBe('Pracovna');
        expect(shortDeviceName(' · Safari')).toBe(' · Safari');
    });
});
