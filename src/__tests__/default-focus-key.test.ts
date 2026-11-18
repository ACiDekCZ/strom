import { describe, it, expect } from 'vitest';
import { defaultFocusKey, type DefaultFocusKeyEvent } from '../ui/default-focus.js';

/** The shortcut of "Focus default person" (spec 111 §6). */
const press = (o: Partial<DefaultFocusKeyEvent>): DefaultFocusKeyEvent => ({
    key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o,
});

describe('defaultFocusKey', () => {
    it('H and h, with Shift or Caps Lock too', () => {
        for (const mac of [true, false]) {
            expect(defaultFocusKey(press({ key: 'h', code: 'KeyH' }), mac, false)).toBe('h');
            expect(defaultFocusKey(press({ key: 'H', code: 'KeyH', shiftKey: true }), mac, false)).toBe('h');
            expect(defaultFocusKey(press({ key: 'H', code: 'KeyH' }), mac, false)).toBe('h');
        }
    });

    it('not with Ctrl, ⌘ or Alt, not while composing, not in a text field', () => {
        expect(defaultFocusKey(press({ key: 'h', ctrlKey: true }), false, false)).toBeNull();
        expect(defaultFocusKey(press({ key: 'h', metaKey: true }), true, false)).toBeNull();
        expect(defaultFocusKey(press({ key: 'h', altKey: true }), false, false)).toBeNull();
        expect(defaultFocusKey(press({ key: 'h', isComposing: true }), false, false)).toBeNull();
        expect(defaultFocusKey(press({ key: 'h' }), false, true)).toBeNull();
        expect(defaultFocusKey(press({ key: 'j' }), false, false)).toBeNull();
    });

    it('⌘1 on a Mac, Ctrl+1 elsewhere, by the key\'s place: a Czech keyboard\'s "+" on it counts', () => {
        expect(defaultFocusKey(press({ key: '1', code: 'Digit1', metaKey: true }), true, false)).toBe('mod1');
        expect(defaultFocusKey(press({ key: '+', code: 'Digit1', metaKey: true }), true, false)).toBe('mod1');
        expect(defaultFocusKey(press({ key: '1', code: 'Digit1', ctrlKey: true }), false, false)).toBe('mod1');
        expect(defaultFocusKey(press({ key: '+', code: 'Digit1', ctrlKey: true }), false, false)).toBe('mod1');
        // From a text field too.
        expect(defaultFocusKey(press({ key: '1', code: 'Digit1', ctrlKey: true }), false, true)).toBe('mod1');
    });

    it('not the other platform\'s modifier, not with Shift or Alt, not the number pad, not the bare 1', () => {
        expect(defaultFocusKey(press({ key: '1', code: 'Digit1', ctrlKey: true }), true, false)).toBeNull();
        expect(defaultFocusKey(press({ key: '1', code: 'Digit1', metaKey: true }), false, false)).toBeNull();
        expect(defaultFocusKey(press({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }), false, false)).toBeNull();
        expect(defaultFocusKey(press({ key: '1', code: 'Digit1', ctrlKey: true, altKey: true }), false, false)).toBeNull();
        expect(defaultFocusKey(press({ key: '1', code: 'Numpad1', ctrlKey: true }), false, false)).toBeNull();
        expect(defaultFocusKey(press({ key: '+', code: 'Digit1' }), false, false)).toBeNull();
    });
});
