import { describe, it, expect } from 'vitest';
import {
    deviceStartEnd, deviceStartScreen, deviceTreeToOpen, deviceTreeRename, deviceTreeRow, deviceTreeChoices, homeHowSystem, homeLineDue, homeAddressHere,
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

describe('deviceTreeRename', () => {
    const defaults = ['Research', 'Výzkum', 'Forschung'];
    it('a tree opened under the default name (its file names nothing) takes the pairing\'s name', () => {
        expect(deviceTreeRename('Research', 'Pýchavkovi z Mlýnků', defaults)).toBe('Pýchavkovi z Mlýnků');
        expect(deviceTreeRename('Forschung', 'Pýchavkovi z Mlýnků', defaults)).toBe('Pýchavkovi z Mlýnků');
        expect(deviceTreeRename('', 'Pýchavkovi z Mlýnků', defaults)).toBe('Pýchavkovi z Mlýnků');
    });
    it('a name of its own, the same name or no name in the pairing: kept', () => {
        expect(deviceTreeRename('Hrotkovi', 'Pýchavkovi z Mlýnků', defaults)).toBeNull();
        expect(deviceTreeRename('Research', 'Research', defaults)).toBeNull();
        expect(deviceTreeRename('Research', undefined, defaults)).toBeNull();
        expect(deviceTreeRename('Research', '  ', defaults)).toBeNull();
    });
});

describe('deviceTreeChoices (the switcher\'s Research trees, 3.7)', () => {
    const paired = [
        { id: 'pychavkovi', name: 'Pýchavkovi z Mlýnků' },
        { id: 'hrotkovi', name: 'Hrotkovi z Hrotova' },
        { id: 'matrika', name: 'Mlýnky – farní matrika', archive: true },
    ];

    it('every tree of the pairing, those held here tied to their local tree, the open one marked', () => {
        const held = [
            { id: 'local-empty', name: 'My tree', persons: 0 },
            { id: 'local-p', name: 'Pýchavkovi', researchId: 'pychavkovi', persons: 3 },
        ];
        const rows = deviceTreeChoices(paired, held, { currentId: 'local-p' });
        expect(rows.map(r => [r.researchId, r.localId, r.current, r.archive])).toEqual([
            ['pychavkovi', 'local-p', true, false],
            ['hrotkovi', null, false, false],
            ['matrika', null, false, true],
        ]);
    });

    it('the open tree named by the research\'s status (tree.name), the others by the pairing', () => {
        const held = [
            { id: 'local-p', name: 'Research', researchId: 'pychavkovi', persons: 3 },
            { id: 'local-h', name: 'Hrotkovi (old)', researchId: 'hrotkovi', persons: 3 },
        ];
        const rows = deviceTreeChoices(paired, held, { currentId: 'local-p', statusName: 'Pýchavkovi z Mlýnků a Horní Lhoty' });
        expect(rows.map(r => r.name)).toEqual(['Pýchavkovi z Mlýnků a Horní Lhoty', 'Hrotkovi z Hrotova', 'Mlýnky – farní matrika']);
        // no status name: the pairing's
        expect(deviceTreeChoices(paired, held, { currentId: 'local-p', statusName: '  ' })[0].name).toBe('Pýchavkovi z Mlýnků');
    });

    it('a tree held here the pairing does not offer stays in reach (its edits never lost); an empty tree of its own does not', () => {
        const held = [
            { id: 'local-empty', name: 'My tree', persons: 0 },
            { id: 'local-gone', name: 'Bedlovi', researchId: 'gone', persons: 12 },
            { id: 'local-own', name: 'Own notes', persons: 4 },
        ];
        const rows = deviceTreeChoices(paired.slice(0, 1), held, { currentId: null });
        expect(rows.map(r => [r.researchId, r.localId, r.name])).toEqual([
            ['pychavkovi', null, 'Pýchavkovi z Mlýnků'],
            [null, 'local-gone', 'Bedlovi'],
            [null, 'local-own', 'Own notes'],
        ]);
        // the open tree always, even an empty one
        expect(deviceTreeChoices([], held, { currentId: 'local-empty' }).map(r => [r.localId, r.current])).toContainEqual(['local-empty', true]);
    });

    it('an id of any shape (opaque, up to 200 characters), each once', () => {
        const long = 'x'.repeat(200);
        const rows = deviceTreeChoices([{ id: long, name: 'A' }, { id: long, name: 'A again' }, { id: 'tree 7/β', name: 'B' }],
            [{ id: 'l', name: 'B', researchId: 'tree 7/β', persons: 1 }], { currentId: 'l' });
        expect(rows.map(r => [r.researchId, r.localId, r.current])).toEqual([[long, null, false], ['tree 7/β', 'l', true]]);
    });
});
