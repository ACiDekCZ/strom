/**
 * The person dialog's portrait as a value of its own (spec 116, PLAN I2):
 * the dialog never takes the portrait from what its preview shows. A photo
 * still coming from the research shows there as "loading" (or the stored
 * one under a veil), and one that comes while the dialog is open goes into
 * the preview; Save writes the portrait only when it was changed in the
 * dialog (another photo, a new crop, Remove), so a photo on its way is
 * neither emptied nor overwritten with the older one. A change made in the
 * dialog wins: on Save the field leaves the evidence (no photo comes over
 * it any more); Cancel keeps waiting for it.
 */

import { imageLoads, type FieldKey } from '../image-loads.js';
import { imgStateOf, type ImgState } from './image-slot.js';

export interface PhotoModel {
    /** The portrait the dialog holds (a data URL), or none. */
    value: string | undefined;
    /** Changed in the dialog (chosen, cropped, removed): only then does Save write it. */
    touched: boolean;
    /** The field in the evidence of images on their way (null: a person not saved yet). */
    key: FieldKey | null;
}

/** The evidence key of a person's portrait. */
export function personPhotoKey(personId: string): FieldKey {
    return `person:${personId}:photo`;
}

/** The model of a dialog opened on `personId` (null: a new person) whose portrait is `photo` now. */
export function openPhotoModel(personId: string | null, photo: string | undefined): PhotoModel {
    return { value: photo || undefined, touched: false, key: personId ? personPhotoKey(personId) : null };
}

/** A portrait put in the dialog (from the editor), or none (Remove). */
export function setModelPhoto(model: PhotoModel, value: string | undefined): void {
    model.value = value || undefined;
    model.touched = true;
}

/**
 * How the dialog shows its portrait: as the evidence says while it was not
 * changed in the dialog ('loading', 'refresh', 'failed'), else 'none' (the
 * dialog's own value, as always). A photo that came is 'none' too.
 */
export function photoModelState(model: PhotoModel): ImgState {
    if (model.touched || !model.key) return 'none';
    const state = imgStateOf(model.key, !!model.value);
    return state === 'loaded' ? 'none' : state;
}

/**
 * Images came (`keys`) while the dialog is open: an untouched portrait takes
 * the one the person holds now (`current`). True when the preview is to show
 * it; a portrait changed in the dialog stays as it is.
 */
export function photoArrived(model: PhotoModel, keys: readonly FieldKey[], current: string | undefined): boolean {
    if (model.touched || !model.key || !keys.includes(model.key)) return false;
    const next = current || undefined;
    if (next === model.value) return false;
    model.value = next;
    return true;
}

/** The person's data changed under the open dialog (a research's version): an untouched portrait follows it. */
export function photoFollowsData(model: PhotoModel, current: string | undefined): boolean {
    if (model.touched) return false;
    const next = current || undefined;
    if (next === model.value) return false;
    model.value = next;
    return true;
}

/** What Save writes of the portrait: it only when it was changed in the dialog (none: '' removes it). */
export function photoSaveFields(model: PhotoModel): { photo?: string } {
    return model.touched ? { photo: model.value ?? '' } : {};
}

/** After Save: a portrait changed in the dialog is no longer waited for (the person's choice wins). */
export function photoSaved(model: PhotoModel): void {
    if (model.touched && model.key) imageLoads.drop(model.key);
}

/** Does the dialog hold a change of the portrait (against `stored`, the portrait when it opened)? */
export function photoChanged(model: PhotoModel, stored: string): boolean {
    return model.touched && (model.value ?? '') !== stored;
}

/** May the crop be edited now: a portrait there, not one still on its way (refresh: the older one under the veil). */
export function canRecropPhoto(model: PhotoModel): boolean {
    if (!model.value) return false;
    const state = photoModelState(model);
    return state !== 'loading' && state !== 'refresh';
}
