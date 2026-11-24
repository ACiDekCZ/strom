/**
 * The devices of the research's sends in words (spec 094 K2.4): a conflict
 * between two sends named by the device each edit came from, and a send or a
 * line of the research's history from another browser marked "from …".
 * Every word here is read after "from" (a language's case follows it). A
 * device's name is never translated; without a name its id's first 8
 * characters stand in, this browser is "this browser", and a send that
 * named no device is "an earlier / the later send". Pure.
 */

import { strings } from './strings.js';
import { isThisDevice } from './device-client.js';
import type { ConflictSideDevice, ConflictSides } from './research-device.js';

/** Whether an id is this browser's (injected by tests). */
export type ThisDevice = (id: string) => boolean;

/** Characters of an id shown when a device has no name (as the research shows it). */
const ID_SHOWN = 8;

/** A device after "from": this browser, its name, or its id's first characters; '' when none is said. */
export function deviceWords(d: ConflictSideDevice | null | undefined, thisDevice: ThisDevice = isThisDevice): string {
    if (!d?.id) return '';
    if (thisDevice(d.id)) return strings.conflict.device.thisBrowser;
    return d.name || d.id.slice(0, ID_SHOWN);
}

/**
 * A send or a history line from another browser: that browser's words ('' for
 * this browser, or when the send named none — then nothing is added).
 */
export function otherDeviceWords(client: ConflictSideDevice | null | undefined, thisDevice: ThisDevice = isThisDevice): string {
    if (!client?.id || thisDevice(client.id)) return '';
    return deviceWords(client, thisDevice);
}

/** A conflict's two edits by device, per side: `user` the later send, `research` the earlier one whose value stands. */
export interface ConflictDeviceWords {
    user: string;
    research: string;
}

/**
 * The two sides of a conflict between two sends in words (null: not such a
 * conflict, or none known here — shown as before). A side that named no device
 * is the earlier / the later send; two sides that would read the same (both
 * this browser, or one device twice) are told apart by their order.
 */
export function conflictDeviceWords(sides: ConflictSides | null | undefined, thisDevice: ThisDevice = isThisDevice): ConflictDeviceWords | null {
    if (!sides) return null;
    const d = strings.conflict.device;
    const user = deviceWords(sides.later, thisDevice) || d.later;
    const research = deviceWords(sides.earlier, thisDevice) || d.earlier;
    return user === research ? { user: d.later, research: d.earlier } : { user, research };
}

/** "edit from {earlier} × edit from {later}" (the research's order: the value standing there first). */
export function conflictDevicePair(words: ConflictDeviceWords): string {
    return strings.conflict.pair(words.research, words.user);
}

/** The same pair as a sentence of its own ("Edit from {earlier} × edit from {later}."). */
export function conflictDevicePairLine(words: ConflictDeviceWords): string {
    return strings.conflict.pairLine(words.research, words.user);
}

/**
 * The one pair said for several conflicts (a write's note): only when every one
 * of them is between the same two devices; null otherwise.
 */
export function sharedConflictWords(all: readonly (ConflictDeviceWords | null)[]): ConflictDeviceWords | null {
    if (all.length === 0 || all.some(w => !w)) return null;
    const first = all[0]!;
    return all.every(w => w!.user === first.user && w!.research === first.research) ? first : null;
}
