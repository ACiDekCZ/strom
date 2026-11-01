/**
 * The family book dialog's presets (1031 §4.7, §4.9): For the family, For
 * researchers and Custom, a choice of its own.
 *
 * Custom keeps its own values (detail, notes, researcher data, parts): the
 * first click on Custom takes the values on screen, a later click brings the
 * saved ones back, and choosing a preset again never clears them. A change of
 * the detail, a part, the notes or the researcher data while a preset is
 * chosen lands in Custom and becomes its values. The selection, privacy, the
 * book's language and the title are not part of a preset.
 *
 * The hint line says what happened: `first` (Custom starts from the preset),
 * `saved` (the custom values from before), `auto` (a change switched to
 * Custom). Pure.
 */

import { BOOK_PART_KEYS, BookDetail, BookOptions, BookParts, BookPreset, applyBookPreset, bookPresetOf } from './book-options.js';

/** What a preset sets: the rest of the options stays. */
export interface BookPresetValues {
    detail: BookDetail;
    notes: boolean;
    research: boolean;
    parts: BookParts;
}

/** The two fixed presets. */
export type BookFixedPreset = Exclude<BookPreset, 'custom'>;

export type BookPresetHint = 'first' | 'saved' | 'auto';

export interface BookPresetState {
    preset: BookPreset;
    /** Custom's own values, or null before Custom is first chosen. */
    custom: BookPresetValues | null;
    /** The hint line under the presets: only while Custom is chosen. */
    hint: BookPresetHint | null;
    /** The preset Custom started from (the hints `first` and `auto` name it). */
    origin: BookFixedPreset;
}

export function presetValuesOf(options: Pick<BookOptions, 'detail' | 'notes' | 'research' | 'parts'>): BookPresetValues {
    return { detail: options.detail, notes: options.notes, research: options.research, parts: { ...options.parts } };
}

/** The options with the values put in (a copy; everything else unchanged). */
export function withPresetValues(options: BookOptions, values: BookPresetValues): BookOptions {
    return { ...options, detail: values.detail, notes: values.notes, research: values.research, parts: { ...values.parts, families: true } };
}

export function samePresetValues(a: BookPresetValues, b: BookPresetValues): boolean {
    return a.detail === b.detail && a.notes === b.notes && a.research === b.research
        && BOOK_PART_KEYS.every(k => !!a.parts[k] === !!b.parts[k]);
}

/**
 * The state on opening the dialog: the remembered preset and Custom's values.
 * While Custom is chosen its values are the ones on screen (an old entry
 * without `custom` included) and the hint says they are from before. A fixed
 * preset whose values are not on screen (the options of a book being
 * changed) is Custom.
 */
export function initialPresetState(
    options: BookOptions,
    memory: { preset?: BookPreset; custom?: BookPresetValues | null } | null,
): BookPresetState {
    let preset = memory?.preset ?? bookPresetOf(options);
    if (preset !== 'custom' && bookPresetOf(options) !== preset) preset = 'custom';
    if (preset === 'custom') return { preset, custom: presetValuesOf(options), hint: 'saved', origin: 'family' };
    return { preset, custom: memory?.custom ? clone(memory.custom) : null, hint: null, origin: preset };
}

/**
 * A click on a preset: the new state and the options. Custom the first time
 * takes the values on screen (they stay), later brings its saved values back;
 * a click on the preset already chosen changes nothing. A fixed preset puts
 * its values in and keeps Custom's.
 */
export function choosePreset(state: BookPresetState, options: BookOptions, preset: BookPreset): { state: BookPresetState; options: BookOptions } {
    if (preset === state.preset) return { state, options };
    if (preset === 'custom') {
        const from = state.preset as BookFixedPreset;
        if (state.custom) return { state: { ...state, preset, hint: 'saved', origin: from }, options: withPresetValues(options, state.custom) };
        return { state: { preset, custom: presetValuesOf(options), hint: 'first', origin: from }, options };
    }
    return { state: { ...state, preset, hint: null, origin: preset }, options: applyBookPreset(options, preset) };
}

/**
 * The detail, a part, the notes or the researcher data changed (`options` as
 * they are now). On a preset: Custom with these values (the old ones are
 * replaced), the hint says the change switched; on Custom: its values follow,
 * the hint stays. Nothing changed → the same state.
 */
export function presetValuesChanged(state: BookPresetState, before: BookOptions, options: BookOptions): BookPresetState {
    const values = presetValuesOf(options);
    if (samePresetValues(presetValuesOf(before), values)) return state;
    if (state.preset === 'custom') return { ...state, custom: values };
    return { preset: 'custom', custom: values, hint: 'auto', origin: state.preset };
}

function clone(v: BookPresetValues): BookPresetValues {
    return { ...v, parts: { ...v.parts } };
}
