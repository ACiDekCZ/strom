/**
 * The family book dialog's presets (1031 §4.9): Custom keeps its own values,
 * the hint line's states, and the memory of Custom (with the entry from
 * before Custom kept values of its own). Pure.
 */

import { describe, it, expect } from 'vitest';
import { BookOptions, applyBookPreset, defaultBookOptions } from '../book-options.js';
import {
    BookPresetState, choosePreset, initialPresetState, presetValuesChanged, presetValuesOf,
} from '../book-preset.js';
import { bookOptionsFromMemory, loadBookMemory, parseBookMemory, saveBookMemory } from '../book-memory.js';

function fakeStorage(init: Record<string, string> = {}) {
    const map = new Map(Object.entries(init));
    return {
        map,
        getItem: (k: string): string | null => map.has(k) ? map.get(k)! : null,
        setItem: (k: string, v: string): void => { map.set(k, v); },
    };
}

const base = (): BookOptions => ({ ...defaultBookOptions('en'), privacy: 'full', lang: 'de', title: 'Own title', selection: { kind: 'rods', rods: [] } });
const fresh = (): { state: BookPresetState; options: BookOptions } => {
    const options = base();
    return { state: initialPresetState(options, null), options };
};
const change = (state: BookPresetState, options: BookOptions, patch: Partial<BookOptions>) => {
    const next = { ...options, ...patch };
    return { state: presetValuesChanged(state, options, next), options: next };
};
const withoutPart = (o: BookOptions, k: keyof BookOptions['parts']): Partial<BookOptions> => ({ parts: { ...o.parts, [k]: false } });

describe('book presets: Custom keeps its own values (§4.9)', () => {
    it('opening without memory: For the family, no Custom values yet, no hint', () => {
        const { state } = fresh();
        expect(state).toEqual({ preset: 'family', custom: null, hint: null, origin: 'family' });
    });

    it('Custom the first time takes the values on screen; they stay, the hint names the preset it started from', () => {
        const { state, options } = fresh();
        const r = choosePreset(state, options, 'custom');
        expect(r.options).toEqual(options);
        expect(r.state).toEqual({ preset: 'custom', custom: presetValuesOf(options), hint: 'first', origin: 'family' });
        // A click on Custom again changes nothing.
        expect(choosePreset(r.state, r.options, 'custom')).toEqual(r);
    });

    it('Custom, a part off, For the family, Custom again: the part is off again; the preset never clears Custom', () => {
        let { state, options } = fresh();
        ({ state, options } = choosePreset(state, options, 'custom'));
        ({ state, options } = change(state, options, withoutPart(options, 'history')));
        expect(state.hint).toBe('first');
        expect(state.custom!.parts.history).toBe(false);
        ({ state, options } = choosePreset(state, options, 'family'));
        expect(options.parts.history).toBe(true);
        expect(state).toMatchObject({ preset: 'family', hint: null });
        expect(state.custom!.parts.history).toBe(false);
        ({ state, options } = choosePreset(state, options, 'custom'));
        expect(options.parts.history).toBe(false);
        expect(state).toMatchObject({ preset: 'custom', hint: 'saved' });
    });

    it('a change on a preset: Custom with the preset plus the change, the old Custom replaced, hint auto', () => {
        let { state, options } = fresh();
        ({ state, options } = choosePreset(state, options, 'custom'));
        ({ state, options } = change(state, options, { detail: 'brief' }));
        ({ state, options } = choosePreset(state, options, 'research'));
        expect(options).toMatchObject({ detail: 'all', notes: true, research: true });
        ({ state, options } = change(state, options, withoutPart(options, 'index')));
        expect(state).toEqual({
            preset: 'custom', hint: 'auto', origin: 'research',
            custom: { ...presetValuesOf(applyBookPreset(base(), 'research')), parts: { ...options.parts, index: false } },
        });
        expect(options).toMatchObject({ detail: 'all', notes: true, research: true });
        // Further changes on Custom: its values follow, the hint stays.
        ({ state, options } = change(state, options, { notes: false }));
        expect(state).toMatchObject({ preset: 'custom', hint: 'auto', origin: 'research' });
        expect(state.custom!.notes).toBe(false);
        // Choosing what is already chosen is no change.
        expect(change(state, options, { detail: options.detail }).state).toBe(state);
    });

    it('Custom is kept even when equal to a preset; the selection, privacy, language and title are never touched', () => {
        let { state, options } = fresh();
        ({ state, options } = change(state, options, { notes: true }));
        ({ state, options } = change(state, options, { notes: false }));
        expect(state).toMatchObject({ preset: 'custom', hint: 'auto' });
        expect(state.custom).toEqual(presetValuesOf(base()));
        for (const p of ['research', 'family', 'custom'] as const) {
            ({ state, options } = choosePreset(state, options, p));
            expect(options).toMatchObject({ privacy: 'full', lang: 'de', title: 'Own title', selection: { kind: 'rods', rods: [] } });
        }
        expect(state).toMatchObject({ preset: 'custom', hint: 'saved' });
    });

    it('opening with Custom remembered: its values on screen and the hint "from last time"', () => {
        const options = { ...base(), detail: 'brief' as const };
        expect(initialPresetState(options, { preset: 'custom', custom: presetValuesOf(options) }))
            .toEqual({ preset: 'custom', custom: presetValuesOf(options), hint: 'saved', origin: 'family' });
        // A fixed preset remembered with Custom's values kept aside.
        const custom = presetValuesOf({ ...base(), detail: 'brief' });
        expect(initialPresetState(base(), { preset: 'family', custom })).toEqual({ preset: 'family', custom, hint: null, origin: 'family' });
        // A fixed preset whose values are not on screen (a book's options being changed): Custom with those values.
        expect(initialPresetState(options, { preset: 'family', custom: null })).toMatchObject({ preset: 'custom', hint: 'saved', custom: presetValuesOf(options) });
    });
});

describe('book presets: the memory (§4.8)', () => {
    it('remembers the preset chosen and Custom\'s values, also when they equal a preset; a reopening gets them back', () => {
        const s = fakeStorage();
        let { state, options } = fresh();
        ({ state, options } = choosePreset(state, options, 'custom'));
        saveBookMemory(s, 't', options, { preset: state.preset, custom: state.custom });
        const m = loadBookMemory(s, 't')!;
        expect(m.preset).toBe('custom');
        expect(m.custom).toEqual(presetValuesOf(base()));
        const reopened = bookOptionsFromMemory('en', m, { kind: 'tree' });
        expect(initialPresetState(reopened, m)).toMatchObject({ preset: 'custom', hint: 'saved' });

        // Back on For the family: Custom stays stored; a later save without Custom's values keeps them.
        ({ state, options } = change(state, options, withoutPart(options, 'tree')));
        ({ state, options } = choosePreset(state, options, 'family'));
        saveBookMemory(s, 't', options, { preset: state.preset, custom: state.custom });
        saveBookMemory(s, 't', options);
        const m2 = loadBookMemory(s, 't')!;
        expect(m2.preset).toBe('family');
        expect(m2.custom!.parts.tree).toBe(false);
        const again = initialPresetState(bookOptionsFromMemory('en', m2, { kind: 'tree' }), m2);
        expect(again).toMatchObject({ preset: 'family', hint: null });
        expect(choosePreset(again, bookOptionsFromMemory('en', m2, { kind: 'tree' }), 'custom').options.parts.tree).toBe(false);
    });

    it('an entry from before Custom kept its own values: Custom is filled from the stored detail, switches and parts', () => {
        const old = parseBookMemory(JSON.stringify({ preset: 'custom', detail: 'all', notes: false, research: true, parts: { index: false }, privacy: 'full', lang: 'en' }))!;
        expect(old.custom).toEqual({
            detail: 'all', notes: false, research: true,
            parts: { ...defaultBookOptions('en').parts, index: false },
        });
        const options = bookOptionsFromMemory('en', old, { kind: 'tree' });
        expect(presetValuesOf(options)).toEqual(old.custom);
        // A fixed preset from before: no Custom yet.
        expect(parseBookMemory(JSON.stringify({ preset: 'family', detail: 'normal' }))!.custom).toBeUndefined();
        // Custom stored as null, or damaged: no Custom values.
        expect(parseBookMemory(JSON.stringify({ preset: 'family', custom: null }))!.custom).toBeNull();
        expect(parseBookMemory(JSON.stringify({ preset: 'family', custom: { detail: 'huge', notes: true, research: true } }))!.custom).toBeUndefined();
        // Stored Custom: the families always in, a missing part ticked.
        const c = parseBookMemory(JSON.stringify({ preset: 'research', custom: { detail: 'brief', notes: true, research: false, parts: { families: false, toc: false } } }))!.custom!;
        expect(c).toEqual({ detail: 'brief', notes: true, research: false, parts: { ...defaultBookOptions('en').parts, toc: false } });
    });
});
