import { describe, it, expect } from 'vitest';
import {
    deviceStartEnd, deviceStartScreen, deviceTreeToOpen, deviceTreeRow, homeHowSystem, homeLineDue, homeAddressHere,
} from '../device/device-start';
import { codePairs, type DeviceCode } from '../device/device-mode';

const pairCode: DeviceCode = { kind: 'pair', id: 'p1', secret: 's' };
const homeCode: DeviceCode = { kind: 'home', id: 'h1', secret: 's' };
const trees = [
    { id: 'pychavkovi', name: 'Pýchavkovi z Mlýnků' },
    { id: 'hrotkovi', name: 'Hrotkovi z Hrotova' },
];

describe('device start (spec 094 §2)', () => {
    it('ends in the tree once paired, whatever the code did', () => {
        expect(deviceStartEnd({ hello: true, code: pairCode, paired: true, standalone: false })).toBe('tree');
        expect(deviceStartEnd({ hello: false, code: null, paired: true, standalone: true })).toBe('tree');
    });

    it('a code that paired nothing: one screen; an icon\'s code or an icon with nothing: not paired', () => {
        expect(deviceStartEnd({ hello: true, code: pairCode, paired: false, standalone: false })).toBe('codeBad');
        expect(deviceStartEnd({ hello: true, code: { ...pairCode, kind: 'move' }, paired: false, standalone: false })).toBe('codeBad');
        expect(deviceStartEnd({ hello: true, code: homeCode, paired: false, standalone: true })).toBe('homeUnpaired');
        expect(deviceStartEnd({ hello: true, code: null, paired: false, standalone: true })).toBe('homeUnpaired');
    });

    it('the plain page without a gateway or without anything to pair', () => {
        expect(deviceStartEnd({ hello: false, code: pairCode, paired: false, standalone: false })).toBe('none');
        expect(deviceStartEnd({ hello: true, code: null, paired: false, standalone: false })).toBe('none');
    });

    it('draws the start screen only for a code or an unpaired icon', () => {
        expect(deviceStartScreen({ code: pairCode, paired: false, standalone: false })).toBe(true);
        expect(deviceStartScreen({ code: null, paired: false, standalone: true })).toBe(true);
        expect(deviceStartScreen({ code: null, paired: true, standalone: true })).toBe(false);
        expect(deviceStartScreen({ code: null, paired: true, standalone: false })).toBe(false);
    });

    it('an icon\'s code pairs only an origin with nothing paired; the QR code always', () => {
        expect(codePairs(homeCode, false)).toBe(true);
        expect(codePairs(homeCode, true)).toBe(false);
        expect(codePairs(pairCode, true)).toBe(true);
    });

    it('chooses a tree only among several with none chosen', () => {
        expect(deviceTreeToOpen([trees[0]], null)).toBe('pychavkovi');
        expect(deviceTreeToOpen(trees, null)).toBeNull();
        expect(deviceTreeToOpen(trees, 'hrotkovi')).toBe('hrotkovi');
        expect(deviceTreeToOpen(trees, 'gone')).toBeNull();
    });

    it('reads a tree\'s row from its status', () => {
        expect(deviceTreeRow({ persons: 412, working: [{ id: 'a' }], waiting: [] })).toEqual({ persons: 412, working: true, waiting: 0 });
        expect(deviceTreeRow({ tree: { persons: 186 }, working: [], waiting: [{}, {}, {}] })).toEqual({ persons: 186, working: false, waiting: 3 });
        expect(deviceTreeRow(null)).toEqual({ persons: null, working: false, waiting: 0 });
        expect(deviceTreeRow({ persons: -1, waiting: 'x' })).toEqual({ persons: null, working: false, waiting: 0 });
    });

    it('says "How" by system', () => {
        expect(homeHowSystem({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Safari/604.1' })).toBe('ios');
        expect(homeHowSystem({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15', maxTouchPoints: 5 })).toBe('ios');
        expect(homeHowSystem({ userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/131.0 Mobile Safari/537.36' })).toBe('android');
        expect(homeHowSystem({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0' })).toBe('computer');
    });

    it('shows the quiet line once, never in the icon', () => {
        expect(homeLineDue({ hidden: false, standalone: false })).toBe(true);
        expect(homeLineDue({ hidden: true, standalone: false })).toBe(false);
        expect(homeLineDue({ hidden: false, standalone: true })).toBe(false);
    });

    it('takes the icon\'s address only of this origin and with a home code', () => {
        const origin = 'http://192.168.1.24:47800';
        expect(homeAddressHere(`${origin}/#home.AbC_12.sEcReT-9`, origin)).toBe('/#home.AbC_12.sEcReT-9');
        expect(homeAddressHere('http://10.0.0.9:47800/#home.a.b', origin)).toBeNull();
        expect(homeAddressHere(`${origin}/#pair.a.b`, origin)).toBeNull();
        expect(homeAddressHere(42, origin)).toBeNull();
    });
});
