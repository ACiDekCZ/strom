/**
 * What a new window of a view takes over from the main window (spec 079 §1):
 * the person in the centre, the generations, the person selected; the
 * chart's zoom and middle (only from the same chart), the fan's rings and
 * shape, the map's frame, kinds and time layer. Read, sent as JSON, checked
 * and applied once before (and after) the window's first drawing.
 */

import { describe, it, expect } from 'vitest';
import {
    applyViewStateAfterDraw, applyViewStateBeforeDraw, captureViewState, chooseWindowStart, parseMainFocus, parseViewState,
    readStoredWindowState, storedWindowStateJson, windowStateKey,
    type ViewStateSource, type ViewStateTarget, type ViewWindowState,
} from '../view-window-state.js';
import type { PersonId } from '../../types.js';

const P = (id: string) => id as PersonId;

function source(over: Partial<ViewStateSource> = {}): ViewStateSource {
    return {
        viewMode: () => 'family',
        focus: () => P('p1'),
        tableFocus: () => null,
        windowSelected: () => null,
        depthUp: () => 3,
        depthDown: () => 2,
        chartZoom: () => ({ scale: 0.6, x: 420, y: -80 }),
        fullFamilies: () => true,
        fan: () => ({ generations: 6, descGenerations: 2, shape: 'two', colorMode: 'line' }),
        map: () => ({ scope: 'tree', center: { lat: 49.2, lon: 16.6 }, zoom: 9, kinds: ['birth', 'death'], time: { on: true, year: 1880 } }),
        ...over,
    };
}

/** A target that writes down what was asked of it. */
function target(persons: string[] = ['p1', 'p2']): { t: ViewStateTarget; calls: string[] } {
    const calls: string[] = [];
    const t: ViewStateTarget = {
        hasPerson: (id) => persons.includes(id),
        setFocus: (id, up, down) => calls.push(`focus ${id} ${up}/${down}`),
        setWindowSelected: (id) => calls.push(`selected ${id}`),
        setFullFamilies: (on) => calls.push(`full ${on}`),
        setFan: (f) => calls.push(`fan ${f.generations} ${f.descGenerations} ${f.shape} ${f.colorMode}`),
        setMap: (m) => calls.push(`map ${m.scope} ${m.center?.lat},${m.center?.lon} z${m.zoom} ${m.kinds.join('+')} ${m.time.on ? m.time.year : 'off'}`),
        restoreZoom: (z) => calls.push(`zoom ${z.scale} ${z.x},${z.y}`),
        centerView: () => calls.push('center'),
    };
    return { t, calls };
}

/** Through the channel and back (the state goes as JSON). */
const viaChannel = (kind: Parameters<typeof parseViewState>[0], s: ViewWindowState | undefined) => parseViewState(kind, JSON.parse(JSON.stringify(s)));

describe('reading the main window\'s state', () => {
    it('Family from Family: the person, the generations and the zoom with the middle of the view', () => {
        expect(captureViewState('family', source())).toEqual({
            view: 'family', focus: 'p1', selected: 'p1', depthUp: 3, depthDown: 2,
            zoom: { scale: 0.6, x: 420, y: -80 }, fullFamilies: true,
        });
    });

    it('the zoom only from the same chart; from the Table its active row\'s person, no zoom', () => {
        expect((captureViewState('descendants', source()) as { zoom: unknown }).zoom).toBeNull();
        expect((captureViewState('descendants', source({ viewMode: () => 'descendants' })) as { zoom: unknown }).zoom).toEqual({ scale: 0.6, x: 420, y: -80 });
        const fromTable = captureViewState('family', source({ viewMode: () => 'table', tableFocus: () => P('p2') }));
        expect(fromTable).toMatchObject({ focus: 'p2', selected: 'p2', zoom: null });
        // No active row: the focus.
        expect(captureViewState('family', source({ viewMode: () => 'table' }))).toMatchObject({ focus: 'p1' });
    });

    it('the person another window selected stays the selected one', () => {
        expect(captureViewState('timeline', source({ windowSelected: () => P('p2') }))).toEqual({
            view: 'timeline', focus: 'p1', selected: 'p2', depthUp: 3, depthDown: 2,
        });
    });

    it('the fan\'s rings and shape, the map\'s frame, kinds and time layer; nothing for the Table', () => {
        expect(captureViewState('fan', source())).toMatchObject({ view: 'fan', generations: 6, descGenerations: 2, shape: 'two', colorMode: 'line' });
        expect(captureViewState('map', source())).toMatchObject({
            view: 'map', scope: 'tree', center: { lat: 49.2, lon: 16.6 }, zoom: 9, kinds: ['birth', 'death'], time: { on: true, year: 1880 },
        });
        expect(captureViewState('table', source())).toBeUndefined();
        expect(captureViewState('overview', source())).toBeUndefined();
    });
});

describe('the state as it comes over the channel', () => {
    it('comes through whole for every view', () => {
        for (const kind of ['family', 'descendants', 'timeline', 'fan', 'map'] as const) {
            const s = captureViewState(kind, source({ viewMode: () => kind }));
            expect(viaChannel(kind, s)).toEqual(s);
        }
    });

    it('a map not framed yet stays unframed', () => {
        const s = captureViewState('map', source({ map: () => ({ scope: 'view', center: null, zoom: 5, kinds: [], time: { on: false, year: 0 } }) }));
        expect(viaChannel('map', s)).toMatchObject({ center: null, zoom: 5, scope: 'view' });
    });

    it('another view\'s state, a broken one or none: the window opens on its own', () => {
        expect(parseViewState('map', captureViewState('family', source()))).toBeNull();
        expect(parseViewState('family', null)).toBeNull();
        expect(parseViewState('family', { view: 'family', focus: 'p1' })).toBeNull();
        expect(parseViewState('fan', { view: 'fan', focus: 'p1', depthUp: 3, depthDown: 3 })).toBeNull();
        expect(parseViewState('table', { view: 'table' })).toBeNull();
        // A zoom that is no zoom is left out.
        expect(parseViewState('family', { view: 'family', focus: 'p1', depthUp: 1, depthDown: 1, zoom: { scale: 0, x: 1, y: 1 } }))
            .toMatchObject({ zoom: null, focus: 'p1' });
    });
});

describe('applying it in the new window', () => {
    it('before the drawing: the person and generations, a selection that is not the focus, the view\'s own settings', () => {
        const { t, calls } = target();
        applyViewStateBeforeDraw(captureViewState('descendants', source({ windowSelected: () => P('p2') }))!, t);
        expect(calls).toEqual(['focus p1 3/2', 'selected p2', 'full true']);

        const fan = target();
        applyViewStateBeforeDraw(captureViewState('fan', source())!, fan.t);
        expect(fan.calls).toEqual(['focus p1 3/2', 'fan 6 2 two line']);

        const map = target();
        applyViewStateBeforeDraw(captureViewState('map', source())!, map.t);
        expect(map.calls).toEqual(['focus p1 3/2', 'map tree 49.2,16.6 z9 birth+death 1880']);
    });

    it('a person the window\'s tree does not have: its default person stays', () => {
        const { t, calls } = target(['p9']);
        applyViewStateBeforeDraw(captureViewState('timeline', source({ windowSelected: () => P('p2') }))!, t);
        expect(calls).toEqual([]);
    });

    it('after the drawing: the charts take the zoom and middle or centre themselves; the other views frame themselves', () => {
        const fam = target();
        applyViewStateAfterDraw(captureViewState('family', source())!, 'family', fam.t);
        expect(fam.calls).toEqual(['zoom 0.6 420,-80']);

        const noZoom = target();
        applyViewStateAfterDraw(captureViewState('descendants', source())!, 'descendants', noZoom.t);
        expect(noZoom.calls).toEqual(['center']);

        const reload = target();
        applyViewStateAfterDraw(null, 'family', reload.t);
        expect(reload.calls).toEqual(['center']);

        const map = target();
        applyViewStateAfterDraw(captureViewState('map', source())!, 'map', map.t);
        expect(map.calls).toEqual([]);
    });
});

describe('a satellite\'s own state over its reload', () => {
    it('kept per window under its own key, read back for the view of its address only', () => {
        expect(windowStateKey('ab12cd34')).toBe('strom.win.state.ab12cd34');
        const state = captureViewState('family', source({ focus: () => P('p2') }));
        const json = storedWindowStateJson('tree-1', 'family', state);
        expect(json).not.toBeNull();
        const back = readStoredWindowState(json, 'family');
        expect(back).toEqual({ tree: 'tree-1', kind: 'family', state: JSON.parse(JSON.stringify(state)) });
        // Read as the window's state, as the main window's would be: the same person, generations and zoom.
        expect(parseViewState('family', back!.state)).toEqual(state);
        // Another view in the address (switched, not reloaded since): not this one's.
        expect(readStoredWindowState(json, 'map')).toBeNull();
        // The Table's own state is kept the same way.
        expect(readStoredWindowState(storedWindowStateJson('tree-1', 'table', { rowType: 'persons' }), 'table')).toEqual({ tree: 'tree-1', kind: 'table', state: { rowType: 'persons' } });
    });

    it('nothing kept without a tree or a state; nothing read from a broken record', () => {
        expect(storedWindowStateJson(null, 'family', captureViewState('family', source()))).toBeNull();
        expect(storedWindowStateJson('tree-1', 'overview', undefined)).toBeNull();
        expect(readStoredWindowState(null, 'family')).toBeNull();
        expect(readStoredWindowState('{not json', 'family')).toBeNull();
        expect(readStoredWindowState('{"kind":"family","state":{}}', 'family')).toBeNull();
        expect(readStoredWindowState('{"tree":"t","kind":"family"}', 'family')).toBeNull();
    });
});

describe('the start of a tree in a satellite', () => {
    const has = (...ids: string[]) => (id: PersonId) => ids.includes(id);
    const main = { personId: P('p7'), depthUp: 2, depthDown: 1 };

    it('its own state, when the tree still has its person (the main window\'s person not needed)', () => {
        const state = captureViewState('family', source())!;
        expect(chooseWindowStart(state, main, has('p1', 'p7'))).toEqual({ state, focus: null });
    });

    it('a state whose person is gone counts as none: the main window\'s person', () => {
        const state = captureViewState('family', source())!;
        expect(chooseWindowStart(state, main, has('p7'))).toEqual({ state: null, focus: main });
    });

    it('no state (a reload without one, another tree): the main window\'s person, never the first person', () => {
        expect(chooseWindowStart(null, main, has('p7'))).toEqual({ state: null, focus: main });
        // A state without a person (the main window had none): its settings, the main window's person.
        const fan = captureViewState('fan', source({ focus: () => null }))!;
        expect(chooseWindowStart(fan, main, has('p7'))).toEqual({ state: fan, focus: main });
    });

    it('neither: the tree\'s default person (nothing to apply)', () => {
        expect(chooseWindowStart(null, null, has('p1'))).toEqual({ state: null, focus: null });
        expect(chooseWindowStart(null, main, has('p1'))).toEqual({ state: null, focus: null });
    });

    it('the main window\'s person as it comes over the channel', () => {
        expect(parseMainFocus({ personId: 'p7', depthUp: 2.6, depthDown: -1 })).toEqual({ personId: 'p7', depthUp: 2, depthDown: 0 });
        expect(parseMainFocus(null)).toBeNull();
        expect(parseMainFocus({ personId: '', depthUp: 1, depthDown: 1 })).toBeNull();
        expect(parseMainFocus({ personId: 'p7', depthUp: 'x', depthDown: 1 })).toBeNull();
    });
});
