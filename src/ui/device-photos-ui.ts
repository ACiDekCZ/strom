/**
 * The photos waiting on a device of the home network (spec 094 P3 §5, §7;
 * 3.6, 7.5): "Save photos to the device" downloads them (one photo as it is,
 * more as one ZIP) and "Discard…" forgets them once confirmed. Both serve the
 * disconnect confirmation of the Connection and the "Waiting on this device"
 * list. Nothing else removes them: an unpairing keeps the queue.
 */

import { strings } from '../strings.js';
import { uiModule } from './module.js';
import { devicePhotoCount, devicePhotosFile, discardDevicePhotos } from '../device/device-photos.js';
import { setDevicePhotoSaver } from './device-conn-ui.js';

/** Hands a file to the browser's download (the object URL freed after a while). */
function download(name: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * "Save photos to the device": every photo waiting on the device downloaded,
 * one as it is, more as one ZIP. False when nothing waits. The photos stay.
 */
export async function saveDevicePhotos(): Promise<boolean> {
    const file = await devicePhotosFile();
    if (!file) return false;
    download(file.name, file.blob);
    return true;
}

setDevicePhotoSaver(async () => { await saveDevicePhotos(); });

export const devicePhotosMethods = uiModule({
    /**
     * "Discard…": asks first (how many photos, cannot be undone), then every
     * photo waiting on the device is forgotten. How many went (0: kept).
     * The list of what waits (spec 094 §7) asks once for its edits too:
     * `edits` counted in the question, `note` a sentence after it, `then`
     * what goes besides the photos once it is confirmed.
     */
    async askDiscardDevicePhotos(opts: { edits?: number; note?: string; then?: () => Promise<void> } = {}): Promise<number> {
        const n = await devicePhotoCount();
        const m = opts.edits ?? 0;
        if (n + m === 0) return 0;
        const b = strings.batch;
        const text = m > 0 || opts.note ? `${strings.device.discardText(n, m)}${opts.note ? ` ${opts.note}` : ''}` : b.discardDeviceText(n, 0);
        const asked = this.showConfirm(text, b.discardDeviceAsk, {
            confirmLabel: b.discardDeviceOk, cancel: strings.buttons.cancel, variant: 'danger',
        });
        // asked from a sheet from below as well (the Connection, the waiting list on a phone): above it
        document.getElementById('confirmation-modal')?.classList.add('over-sheet');
        if (!await asked) return 0;
        // A batch of them still going stops first: it would keep what it had not sent again.
        this.batchDiscardDeviceRun();
        const gone = await discardDevicePhotos();
        await opts.then?.();
        return gone + m;
    },
});
