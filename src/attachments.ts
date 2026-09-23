/**
 * Person attachments: inline documents (register scans, certificates, letters).
 * Images are downscaled to a bounded JPEG (aspect-preserving, unlike the square
 * avatar crop in photo.ts); PDFs are kept as-is up to a size cap. Payloads live
 * inline so they travel with the single-file export.
 */

import { StromData } from './types.js';
import { dataUrlByteSize, stripPhotos } from './photo.js';

/** Longest edge (px) an attached image is downscaled to. */
export const ATTACHMENT_MAX_SIDE = 1600;
/** JPEG quality for compressed image attachments. */
export const ATTACHMENT_QUALITY = 0.8;
/** Largest PDF accepted (bytes). Larger PDFs are rejected. */
export const MAX_PDF_BYTES = 2 * 1024 * 1024;
/** Total attachment volume beyond which the UI warns about email size. */
export const ATTACHMENT_WARN_BYTES = 10 * 1024 * 1024;

export const ATTACHMENT_IMAGE_TYPES = ['image/jpeg', 'image/png'];

/**
 * Compress a user-selected image into an aspect-preserving JPEG data URL whose
 * longest side is at most ATTACHMENT_MAX_SIDE. Browser-only (needs canvas +
 * createImageBitmap).
 */
export async function compressImageAttachment(file: File): Promise<string> {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
        const scale = Math.min(1, ATTACHMENT_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        ctx.drawImage(bitmap, 0, 0, width, height);
        return canvas.toDataURL('image/jpeg', ATTACHMENT_QUALITY);
    } finally {
        bitmap.close();
    }
}

/** Read a file as a data URL (used for PDFs, kept verbatim). */
export function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

/**
 * Decode a non-image attachment into a Blob that is safe to open in a new tab.
 * Attachments arrive in foreign files, and a blob URL shares the app's origin:
 * opening e.g. `data:text/html` as-is would run its scripts with access to all
 * trees. Only PDFs are opened, and the blob type is always forced to
 * application/pdf regardless of what the data URL claims. Returns null for
 * anything else (or an undecodable payload).
 */
export function pdfBlobFromDataUrl(dataUrl: string, mimeType: string): Blob | null {
    const header = /^data:([^;,]*)(;[^,]*)?,/i.exec(dataUrl);
    if (!header) return null;
    const declared = header[1].trim().toLowerCase();
    if (declared !== 'application/pdf' || mimeType.toLowerCase() !== 'application/pdf') return null;
    if (!/;base64$/i.test(header[2] ?? '')) return null;
    try {
        const bin = atob(dataUrl.slice(header[0].length));
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: 'application/pdf' });
    } catch {
        return null;
    }
}

/** Total bytes of all attachment payloads in a tree. */
export function totalAttachmentBytes(data: StromData): number {
    let total = 0;
    for (const person of Object.values(data.persons)) {
        for (const att of person.attachments ?? []) total += att.sizeBytes || dataUrlByteSize(att.dataUrl);
    }
    return total;
}

/** Deep copy of `data` with every attachment removed. Does not mutate original. */
export function stripAttachments(data: StromData): StromData {
    const copy = structuredClone(data);
    for (const person of Object.values(copy.persons)) {
        delete person.attachments;
    }
    return copy;
}

/** Deep copy with all media (photos AND attachments) removed, for lean exports. */
export function stripMedia(data: StromData): StromData {
    const copy = stripPhotos(data);
    for (const person of Object.values(copy.persons)) {
        delete person.attachments;
    }
    return copy;
}
