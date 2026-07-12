/**
 * Person photo handling: compress an uploaded image into a small square JPEG
 * data URL that can live inside the single-file export, and helpers for
 * stripping photos out of exported data.
 */

import { StromData } from './types.js';

/** Target avatar size in device-independent pixels. */
export const PHOTO_SIZE = 256;
/** JPEG quality for the compressed portrait. */
export const PHOTO_QUALITY = 0.8;

export interface CropRect {
    sx: number;
    sy: number;
    size: number;
}

/**
 * Cover-crop rectangle: the largest centered square that fits the source image,
 * so the whole target square is covered without distortion. Pure math (no DOM),
 * so it is unit-testable without a canvas.
 */
export function computeCoverCrop(srcWidth: number, srcHeight: number): CropRect {
    const size = Math.min(srcWidth, srcHeight);
    return {
        sx: Math.round((srcWidth - size) / 2),
        sy: Math.round((srcHeight - size) / 2),
        size,
    };
}

/**
 * Compress a user-selected image file into a square JPEG data URL.
 * Uses createImageBitmap with EXIF orientation applied, then a 256x256
 * cover-crop on a canvas. Browser-only (needs canvas + createImageBitmap).
 */
export async function compressPhoto(file: File): Promise<string> {
    // Respect EXIF orientation so phone photos are upright.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
        const crop = computeCoverCrop(bitmap.width, bitmap.height);
        const canvas = document.createElement('canvas');
        canvas.width = PHOTO_SIZE;
        canvas.height = PHOTO_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        ctx.drawImage(bitmap, crop.sx, crop.sy, crop.size, crop.size, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
        return canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
    } finally {
        bitmap.close();
    }
}

/** Approximate byte size of a data-URL string (base64 payload). */
export function dataUrlByteSize(dataUrl: string): number {
    const comma = dataUrl.indexOf(',');
    const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor(b64.length * 3 / 4) - padding);
}

/** Total bytes of all person photos in a tree. */
export function totalPhotoBytes(data: StromData): number {
    let total = 0;
    for (const person of Object.values(data.persons)) {
        if (person.photo) total += dataUrlByteSize(person.photo);
    }
    return total;
}

/**
 * Return a deep copy of `data` with every person photo removed (for
 * "export without photos"). Does not mutate the original.
 */
export function stripPhotos(data: StromData): StromData {
    const copy = structuredClone(data);
    for (const person of Object.values(copy.persons)) {
        delete person.photo;
        delete person.photoOriginalName;
    }
    return copy;
}
