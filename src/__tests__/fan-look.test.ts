import { describe, it, expect } from 'vitest';
import {
    FAN_LOOK_DEFAULT, FanLook, FanLookState, FanLookStore, PosterLook, fanLookFrom, fanStylePreviewSvg, parseFanLook, readFanLookDefault, sameFanLook,
} from '../fan-look.js';
import { FAN_STORAGE_KEYS, FAN_LOOK_SESSION_KEY } from '../storage-keys.js';
import { FAN_STYLES } from '../fan-colors.js';
import { applyViewStateBeforeDraw, captureViewState, parseViewState, ViewStateSource, ViewStateTarget } from '../windows/view-window-state.js';

/** A store of strings in memory (localStorage / sessionStorage). */
function memStore(init: Record<string, string> = {}): FanLookStore & { map: Map<string, string> } {
    const map = new Map(Object.entries(init));
    return {
        map,
        getItem: k => map.get(k) ?? null,
        setItem: (k, v) => { map.set(k, v); },
        removeItem: k => { map.delete(k); },
    };
}

const PASTEL: FanLook = { style: 'pastel', rodScope: 'all', content: 'years', portraits: false };

describe('fan look (spec 118 §10)', () => {
    it('sameFanLook compares the four choices', () => {
        expect(sameFanLook(FAN_LOOK_DEFAULT, { ...FAN_LOOK_DEFAULT })).toBe(true);
        expect(sameFanLook(FAN_LOOK_DEFAULT, { ...FAN_LOOK_DEFAULT, style: 'mono' })).toBe(false);
        expect(sameFanLook(FAN_LOOK_DEFAULT, { ...FAN_LOOK_DEFAULT, rodScope: 'main' })).toBe(false);
        expect(sameFanLook(FAN_LOOK_DEFAULT, { ...FAN_LOOK_DEFAULT, content: 'places' })).toBe(false);
        expect(sameFanLook(FAN_LOOK_DEFAULT, { ...FAN_LOOK_DEFAULT, portraits: true })).toBe(false);
    });

    it('parseFanLook takes each valid field; an invalid one (or JSON that does not parse) is the default', () => {
        expect(parseFanLook(JSON.stringify({ style: 'antique', rodScope: 'main', content: 'names', portraits: true })))
            .toEqual({ style: 'antique', rodScope: 'main', content: 'names', portraits: true });
        expect(parseFanLook(JSON.stringify({ style: 'neon', rodScope: 'some', content: 'all', portraits: 'yes' }))).toEqual(FAN_LOOK_DEFAULT);
        expect(parseFanLook(JSON.stringify({ style: 'mono', content: 42 }))).toEqual({ ...FAN_LOOK_DEFAULT, style: 'mono' });
        expect(parseFanLook('{not json')).toEqual(FAN_LOOK_DEFAULT);
        expect(parseFanLook('[1,2]')).toEqual(FAN_LOOK_DEFAULT);
        expect(parseFanLook(null)).toEqual(FAN_LOOK_DEFAULT);
        // Another fallback (the default of this device) fills the gaps.
        expect(parseFanLook('{"content":"places"}', PASTEL)).toEqual({ ...PASTEL, content: 'places' });
        // The device keeps portraits as '1' / '0'.
        expect(fanLookFrom({ portraits: '1' }).portraits).toBe(true);
        expect(fanLookFrom({ portraits: '0' }, { ...FAN_LOOK_DEFAULT, portraits: true }).portraits).toBe(false);
    });

    it('the default is read from the four keys of the device, each invalid one the first start\'s', () => {
        const local = memStore({
            [FAN_STORAGE_KEYS.style]: 'antique', [FAN_STORAGE_KEYS.rodScope]: 'main',
            [FAN_STORAGE_KEYS.content]: 'nonsense', [FAN_STORAGE_KEYS.portraits]: '1',
        });
        expect(readFanLookDefault(local)).toEqual({ style: 'antique', rodScope: 'main', content: 'years', portraits: true });
        expect(readFanLookDefault(null)).toEqual(FAN_LOOK_DEFAULT);
    });

    it('the panel changes the current look in the session only, while it differs from the default', () => {
        const local = memStore(), session = memStore();
        const st = new FanLookState({ local: () => local, session: () => session });
        expect(st.look()).toEqual(FAN_LOOK_DEFAULT);
        expect(st.differs()).toBe(false);
        expect(st.set({ style: 'pastel' })).toBe(true);
        expect(st.set({ style: 'pastel' })).toBe(false);
        expect(st.differs()).toBe(true);
        expect(local.map.size).toBe(0);
        expect(JSON.parse(session.map.get(FAN_LOOK_SESSION_KEY)!)).toEqual(PASTEL);
        // A reload of the tab: the session's look again.
        expect(new FanLookState({ local: () => local, session: () => session }).look()).toEqual(PASTEL);
        // A new start (an empty session): the default.
        expect(new FanLookState({ local: () => local, session: () => memStore() }).look()).toEqual(FAN_LOOK_DEFAULT);
        // Back to default: nothing kept in the session.
        expect(st.resetToDefault()).toBe(true);
        expect(st.look()).toEqual(FAN_LOOK_DEFAULT);
        expect(session.map.has(FAN_LOOK_SESSION_KEY)).toBe(false);
    });

    it('an invalid value from the panel is ignored', () => {
        const st = new FanLookState({ local: () => memStore(), session: () => memStore() });
        expect(st.set({ style: 'neon', content: 'places' })).toBe(true);
        expect(st.look()).toEqual({ ...FAN_LOOK_DEFAULT, content: 'places' });
    });

    it('a new default moves the current look only when it was the default', () => {
        const local = memStore(), session = memStore();
        const st = new FanLookState({ local: () => local, session: () => session });
        // Equal to the default: it follows.
        expect(st.setDefault({ ...FAN_LOOK_DEFAULT, style: 'antique' })).toBe(true);
        expect(st.look().style).toBe('antique');
        expect(local.map.get(FAN_STORAGE_KEYS.style)).toBe('antique');
        expect(local.map.get(FAN_STORAGE_KEYS.portraits)).toBe('0');
        expect(session.map.has(FAN_LOOK_SESSION_KEY)).toBe(false);
        // Changed in the panel: it stays.
        st.set({ content: 'names' });
        expect(st.setDefault({ ...st.defaults(), style: 'mono' })).toBe(true);
        expect(st.look()).toEqual({ style: 'antique', rodScope: 'all', content: 'names', portraits: false });
        expect(st.defaults().style).toBe('mono');
        expect(JSON.parse(session.map.get(FAN_LOOK_SESSION_KEY)!).content).toBe('names');
    });

    it('"Save as default" writes the device and the look no longer differs', () => {
        const local = memStore(), session = memStore();
        const st = new FanLookState({ local: () => local, session: () => session });
        st.set({ style: 'mono', rodScope: 'main', portraits: true });
        expect(st.saveAsDefault()).toBe(true);
        expect(st.differs()).toBe(false);
        expect(readFanLookDefault(local)).toEqual({ style: 'mono', rodScope: 'main', content: 'years', portraits: true });
        expect(session.map.has(FAN_LOOK_SESSION_KEY)).toBe(false);
        // The next start begins with it.
        expect(new FanLookState({ local: () => local, session: () => memStore() }).look()).toEqual(st.defaults());
    });

    it('a window without a session (a satellite) keeps its look in its memory', () => {
        const local = memStore();
        const st = new FanLookState({ local: () => local, session: () => null });
        st.set({ style: 'pastel' });
        expect(st.look().style).toBe('pastel');
        expect(local.map.size).toBe(0);
    });

    it('the style preview: a half fan of three rings with a light and a dark fill per sector', () => {
        for (const style of FAN_STYLES) {
            const svg = fanStylePreviewSvg(style);
            expect(svg.match(/<path /g)?.length).toBe(1 + 2 + 4 + 8);
            expect(svg).toMatch(/--l:#[0-9a-f]{6};--d:#[0-9a-f]{6}/);
        }
        expect(fanStylePreviewSvg('color')).not.toBe(fanStylePreviewSvg('mono'));
    });

    it('a new window of the fan takes the main window\'s current look over (spec 079, 118 §10)', () => {
        const look: FanLook = { style: 'antique', rodScope: 'main', content: 'places', portraits: true };
        const src = {
            viewMode: () => 'fan', focus: () => null, tableFocus: () => null, windowSelected: () => null,
            depthUp: () => 2, depthDown: () => 1, chartZoom: () => null, fullFamilies: () => false,
            fan: () => ({ generations: 5, descGenerations: 3, shape: 'half', colorMode: 'rod', ...look }),
            map: () => ({ scope: 'view' as const, center: null, zoom: 1, kinds: [], time: { on: false, year: 0 } }),
        } satisfies ViewStateSource;
        const sent = JSON.parse(JSON.stringify(captureViewState('fan', src)));
        const state = parseViewState('fan', sent)!;
        let got: unknown = null;
        const target = { setFan: (f: unknown) => { got = f; } } as unknown as ViewStateTarget;
        applyViewStateBeforeDraw(state, { ...target, hasPerson: () => false });
        expect(got).toEqual({ generations: 5, descGenerations: 3, shape: 'half', colorMode: 'rod', ...look });
        // An older main window without the look: the window keeps its own.
        const old = parseViewState('fan', { ...sent, style: undefined, rodScope: undefined, content: undefined, portraits: undefined })!;
        applyViewStateBeforeDraw(old, { ...target, hasPerson: () => false });
        expect(got).toEqual({ generations: 5, descGenerations: 3, shape: 'half', colorMode: 'rod' });
    });

    it('the poster dialog\'s look: prefilled from the screen, changed for the output only, "As on screen" returns it (§10)', () => {
        const local = memStore({ [FAN_STORAGE_KEYS.style]: 'color' });
        const session = memStore();
        const state = new FanLookState({ local: () => local, session: () => session });
        const before = { local: new Map(local.map), session: new Map(session.map) };
        const poster = new PosterLook(() => state.look());
        expect(poster.look()).toEqual(FAN_LOOK_DEFAULT);
        expect(poster.own()).toBeNull();

        expect(poster.set({ style: 'antique' })).toBe(true);
        expect(poster.set({ rodScope: 'main', portraits: true })).toBe(true);
        expect(poster.set({ style: 'antique' })).toBe(false);
        expect(poster.set({ content: 'nonsense' })).toBe(false);
        expect(poster.look()).toEqual({ style: 'antique', rodScope: 'main', content: 'years', portraits: true });
        expect(poster.own()).not.toBeNull();
        // The screen, the session and the default stay as they were.
        expect(state.look()).toEqual(FAN_LOOK_DEFAULT);
        expect(state.defaults()).toEqual(FAN_LOOK_DEFAULT);
        expect(state.differs()).toBe(false);
        expect(local.map).toEqual(before.local);
        expect(session.map).toEqual(before.session);

        // Back to the screen's choices one by one: as on screen again (null).
        poster.set({ style: 'color', rodScope: 'all', portraits: false });
        expect(poster.own()).toBeNull();

        // "As on screen" (and a new opening) follows the screen as it is then.
        poster.set({ style: 'mono' });
        state.set({ style: 'pastel' });
        poster.reset();
        expect(poster.own()).toBeNull();
        expect(poster.look()).toEqual(PASTEL);
    });

    it('Settings change the default: the screen follows only while it showed the default (§10)', () => {
        const local = memStore();
        const session = memStore();
        const state = new FanLookState({ local: () => local, session: () => session });
        expect(state.setDefault({ style: 'pastel' })).toBe(true);
        expect(local.map.get(FAN_STORAGE_KEYS.style)).toBe('pastel');
        expect(state.look()).toEqual(PASTEL);
        // Changed in the panel: a later default leaves the current look as it is.
        state.set({ style: 'mono' });
        expect(state.setDefault({ content: 'names' })).toBe(true);
        expect(local.map.get(FAN_STORAGE_KEYS.content)).toBe('names');
        expect(state.look()).toEqual({ ...PASTEL, style: 'mono' });
        expect(state.differs()).toBe(true);
    });
});
