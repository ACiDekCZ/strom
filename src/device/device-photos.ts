/**
 * Photos of a batch kept on a device of the home network (spec 094 P3 §5):
 * a batch not handed over yet stays in the device's queue (IndexedDB, the
 * store kept over an unpairing) with its files, its person and note, one per
 * tree, until it reaches the research or is discarded. Saving them to the
 * device and discarding them are offered where the device says what waits
 * on it (the Connection sheet, the "Waiting on this device" list).
 */

import { deviceQueue } from './device-store';
import { buildZip, type ZipEntry } from '../zip';

/** One photo (or file) of a batch kept on the device. */
export interface DevicePhoto {
    /** Its key within the batch (stays the same while it is kept). */
    id: string;
    /** The file itself (a File keeps its name and type in IndexedDB). */
    blob: Blob;
    name: string;
    type: string;
    size: number;
}

/** A batch kept on the device for a tree. */
export interface DeviceBatchDraft {
    treeId: string;
    name: string;
    personId: string;
    /** The person's name and years as the research's search gave them (a phone's Research screen: no tree to name it). */
    personName?: string;
    personSpan?: string;
    note: string;
    photos: DevicePhoto[];
    /** When it was handed over (it waits for the computer to take files of a device): absent while it is chosen. */
    handedAt?: string;
}

const PREFIX = 'batch:';

function parsePhoto(v: unknown): DevicePhoto | null {
    const r = v && typeof v === 'object' ? v as Record<string, unknown> : null;
    if (!r || typeof r.id !== 'string' || !(typeof Blob !== 'undefined' && r.blob instanceof Blob)) return null;
    return {
        id: r.id, blob: r.blob,
        name: typeof r.name === 'string' && r.name ? r.name : 'photo',
        type: typeof r.type === 'string' ? r.type : '',
        size: r.blob.size,
    };
}

/** A kept batch read back (anything that does not hold is left out). */
export function parseDeviceDraft(v: unknown): DeviceBatchDraft | null {
    const r = v && typeof v === 'object' ? v as Record<string, unknown> : null;
    if (!r || typeof r.treeId !== 'string' || !r.treeId || !Array.isArray(r.photos)) return null;
    const photos = r.photos.map(parsePhoto).filter((p): p is DevicePhoto => !!p);
    return {
        treeId: r.treeId,
        name: typeof r.name === 'string' ? r.name : '',
        personId: typeof r.personId === 'string' ? r.personId : '',
        ...(typeof r.personName === 'string' && r.personName ? { personName: r.personName.slice(0, 200) } : {}),
        ...(typeof r.personSpan === 'string' && r.personSpan ? { personSpan: r.personSpan.slice(0, 60) } : {}),
        note: typeof r.note === 'string' ? r.note : '',
        photos,
        ...(typeof r.handedAt === 'string' ? { handedAt: r.handedAt } : {}),
    };
}

/** The batch kept for a tree, or null. */
export async function loadDeviceDraft(treeId: string): Promise<DeviceBatchDraft | null> {
    try { return parseDeviceDraft(await deviceQueue.get(PREFIX + treeId)); } catch { return null; }
}

/** The batch kept (an empty one is dropped). */
export async function saveDeviceDraft(draft: DeviceBatchDraft): Promise<void> {
    try {
        if (draft.photos.length === 0) await deviceQueue.delete(PREFIX + draft.treeId);
        else await deviceQueue.put(PREFIX + draft.treeId, { ...draft, photos: draft.photos.map(p => ({ ...p })) });
    } catch { /* no storage: the batch lives as long as the page */ }
}

/** The batch of a tree gone (it reached the research, or was discarded). */
export async function dropDeviceDraft(treeId: string): Promise<void> {
    try { await deviceQueue.delete(PREFIX + treeId); } catch { /* none */ }
}

/** Every batch kept on the device (all trees). */
export async function deviceDrafts(): Promise<DeviceBatchDraft[]> {
    let ids: string[] = [];
    try { ids = (await deviceQueue.ids()).filter(id => id.startsWith(PREFIX)); } catch { return []; }
    const out: DeviceBatchDraft[] = [];
    for (const id of ids) {
        try {
            const d = parseDeviceDraft(await deviceQueue.get(id));
            if (d && d.photos.length) out.push(d);
        } catch { /* skipped */ }
    }
    return out;
}

/** How many photos wait on the device. */
export async function devicePhotoCount(): Promise<number> {
    return (await deviceDrafts()).reduce((n, d) => n + d.photos.length, 0);
}

/** Every photo waiting on the device forgotten (Discard…): how many went. */
export async function discardDevicePhotos(): Promise<number> {
    const drafts = await deviceDrafts();
    for (const d of drafts) await dropDeviceDraft(d.treeId);
    return drafts.reduce((n, d) => n + d.photos.length, 0);
}

/** A name unique among `taken` (a second "IMG_0001.jpg" becomes "IMG_0001 (2).jpg"). */
export function uniqueName(name: string, taken: Set<string>): string {
    if (!taken.has(name)) { taken.add(name); return name; }
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 2; ; i++) {
        const next = `${stem} (${i})${ext}`;
        if (!taken.has(next)) { taken.add(next); return next; }
    }
}

/**
 * What "Save photos to the device" downloads: one photo as it is, more as
 * one ZIP (each name once). Null when nothing waits.
 */
export async function devicePhotosFile(): Promise<{ name: string; blob: Blob } | null> {
    const photos = (await deviceDrafts()).flatMap(d => d.photos);
    if (photos.length === 0) return null;
    if (photos.length === 1) return { name: photos[0].name, blob: photos[0].blob };
    const taken = new Set<string>();
    const entries: ZipEntry[] = [];
    for (const p of photos) entries.push({ path: uniqueName(p.name, taken), data: new Uint8Array(await p.blob.arrayBuffer()) });
    return { name: 'strom-photos.zip', blob: new Blob([buildZip(entries)], { type: 'application/zip' }) };
}
