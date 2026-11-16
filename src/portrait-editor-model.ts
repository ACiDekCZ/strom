/**
 * The portrait editor's steps and layout as pure functions (spec 107 §1, §7,
 * §9): what each step holds, which buttons the footer shows, what Done
 * returns, when Done keeps today's compressPhoto bytes, and where the frame
 * sits on the stage. No DOM, so it is unit-testable; the editor itself is
 * src/ui/portrait-editor.ts.
 */

import { PortraitCrop } from './types.js';
import {
    PortraitView, PHOTO_SIZE, portraitViewFromCrop, portraitCropFromView, clampPortraitView,
    defaultPortraitCrop, isDefaultPortraitCrop, portraitSourcePixels,
} from './photo.js';

/** Where a step stands: not yet left, left with Next / Done, or skipped. */
export type PortraitStepStatus = 'open' | 'done' | 'skipped';

/** The editor's working state of one step (one person's portrait). */
export interface PortraitStepState {
    view: PortraitView;
    status: PortraitStepStatus;
    /** The step has been shown (its frame is drawn dashed from the other step). */
    visited: boolean;
    /**
     * A couple's partner with a portrait: keep it (the default) or replace it
     * with a new crop. Null when the step offers no such choice.
     */
    keep: boolean | null;
}

/** What the editor was opened with, as far as the steps go. */
export interface PortraitStepsInput {
    steps: { initial?: PortraitCrop; current?: string }[];
    /** Portraits of a couple's partners (steps in the header, Skip, Keep / Replace). */
    couple: boolean;
}

/**
 * The opening crop of a couple's partner: the largest square in the left or
 * right half of the photo (the top or bottom half of an upright one), so
 * the two do not start on the same face. One partner alone: the centre.
 */
export function coupleHalfCrop(width: number, height: number, index: number, count: number): PortraitCrop {
    if (count < 2) return defaultPortraitCrop(width, height);
    const second = index > 0;
    if (height > width) {
        const side = Math.min(width, height / 2);
        const x = (width - side) / 2;
        const y = (second ? height / 2 : 0) + (height / 2 - side) / 2;
        return { region: { x: x / width, y: y / height, w: side / width, h: side / height } };
    }
    const side = Math.min(height, width / 2);
    const x = (second ? width / 2 : 0) + (width / 2 - side) / 2;
    const y = (height - side) / 2;
    return { region: { x: x / width, y: y / height, w: side / width, h: side / height } };
}

/** The steps' opening states over an original of `width` × `height`. */
export function initialPortraitSteps(input: PortraitStepsInput, width: number, height: number): PortraitStepState[] {
    const n = input.steps.length;
    return input.steps.map((step, i) => {
        const crop = step.initial ?? (input.couple ? coupleHalfCrop(width, height, i, n) : defaultPortraitCrop(width, height));
        return {
            view: clampPortraitView(portraitViewFromCrop(crop, width, height), width, height),
            status: 'open',
            visited: i === 0,
            keep: input.couple && step.current ? true : null,
        };
    });
}

/** The footer of a step: Skip shown or not, and whether the main button says Next or Done. */
export function portraitFooter(states: readonly PortraitStepState[], index: number, couple: boolean): { skip: boolean; primary: 'next' | 'done' } {
    const last = index >= states.length - 1;
    // Keep is the same as Skip there; a single step (also one known partner) has nothing to skip to.
    const skip = couple && states.length > 1 && states[index]?.keep === null;
    return { skip, primary: last ? 'done' : 'next' };
}

/** A step's crop on Done, or null when it was skipped or keeps today's portrait. */
export function portraitStepCrop(state: PortraitStepState, width: number, height: number): PortraitCrop | null {
    if (state.status === 'skipped' || state.keep === true) return null;
    return portraitCropFromView(state.view, width, height);
}

/** The step's view when it is left with Next or Done (it is then marked done). */
export function finishPortraitStep(states: PortraitStepState[], index: number): PortraitStepState[] {
    return states.map((s, i) => i === index ? { ...s, status: 'done' } : s);
}

/** Skip a step: it gives no portrait. */
export function skipPortraitStep(states: PortraitStepState[], index: number): PortraitStepState[] {
    return states.map((s, i) => i === index ? { ...s, status: 'skipped' } : s);
}

/** Whether the step counts as skipped in the header (skipped, or a portrait kept after leaving it). */
export function portraitStepShownSkipped(state: PortraitStepState): boolean {
    return state.status === 'skipped' || (state.status === 'done' && state.keep === true);
}

/**
 * Whether Done keeps today's bytes (K1.5): one step from a new file, nothing
 * moved (the opening square, upright, not straightened, not mirrored). The
 * portrait is then cut by compressPhoto from the file itself, exactly as
 * before the editor existed (also for a photo over WORK_MAX_SIDE).
 */
export function isIdentityPortrait(opts: { fromFile: boolean; squareOnly: boolean; stepCount: number },
    crop: PortraitCrop | null, width: number, height: number): boolean {
    if (!opts.fromFile || opts.squareOnly || opts.stepCount !== 1 || !crop) return false;
    return isDefaultPortraitCrop(crop, width, height);
}

/** Whether a crop covers so few original pixels that the portrait may be blurry (§10, `portrait.small`). */
export function isSmallPortrait(crop: PortraitCrop, width: number, height: number): boolean {
    return portraitSourcePixels(crop, width, height) < PHOTO_SIZE - 0.5;
}

/** The editor's layouts (§9): computer and tablet, phone, phone held sideways. */
export type PortraitLayout = 'wide' | 'phone' | 'land';

/** The frame's side and centre on a stage of `w` × `h` CSS pixels (`bar`: the zoom bar's height under the frame, wide only). */
export function portraitFrameGeometry(layout: PortraitLayout, w: number, h: number, bar = 56): { side: number; cx: number; cy: number } {
    if (layout === 'phone') {
        return { side: Math.max(60, Math.min(w - 32, h - 24)), cx: w / 2, cy: h / 2 };
    }
    if (layout === 'land') {
        return { side: Math.max(60, Math.min(h - 40, w - 40)), cx: w / 2, cy: h / 2 };
    }
    // A computer: the frame above the zoom bar, 120 px of photo on the sides, at most 460 px.
    const side = Math.max(60, Math.min(w - 120, h - bar - 56, 460));
    return { side, cx: w / 2, cy: (h - bar) / 2 + 4 };
}

/** The angle as the slider's value shows it: the language's decimal mark, a true minus, "°" (−2,5° / −2.5°). */
export function formatPortraitAngle(angle: number, lang: string): string {
    const v = Math.round(angle * 2) / 2;
    const text = new Intl.NumberFormat(lang, { maximumFractionDigits: 1, minimumFractionDigits: 0 }).format(Math.abs(v));
    return `${v < 0 ? '−' : ''}${text}°`;
}
