/**
 * A poster's SVG drawn to a PNG on a canvas (the Poster dialog, the gift
 * package's fan): twice its size within the canvas limit, else the scales
 * posterPngScales gives, each tried in turn (a canvas the browser cannot
 * make draws nothing and gives "data:,"). Browser only.
 */

import { posterPngScales } from '../export-image.js';
import { dataUrlBytes } from '../zip.js';

function svgDataUrl(svg: string): string {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function loadedImage(src: string, widthPx: number, heightPx: number): Promise<HTMLImageElement> {
    const img = new Image();
    img.width = widthPx;
    img.height = heightPx;
    return new Promise<HTMLImageElement>((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('SVG image load failed'));
        img.src = src;
    });
}

/**
 * The PNG as a data URL and the scale it was drawn at; null when the poster
 * is too large for a readable PNG or no canvas could hold it. Throws when the
 * SVG does not load as an image.
 */
export async function svgToPngDataUrl(svg: string, widthPx: number, heightPx: number): Promise<{ dataUrl: string; scale: number } | null> {
    const scales = posterPngScales(widthPx, heightPx);
    if (scales.length === 0) return null;
    const img = await loadedImage(svgDataUrl(svg), widthPx, heightPx);
    for (const s of scales) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(widthPx * s));
        canvas.height = Math.max(1, Math.floor(heightPx * s));
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL('image/png');
        // Freed at once: the next try (or the file) needs the memory.
        canvas.width = canvas.height = 0;
        if (url.startsWith('data:image/png')) return { dataUrl: url, scale: s };
    }
    return null;
}

/** The PNG as a Blob (the gift package's "Ancestor fan.png"); null as svgToPngDataUrl. */
export async function svgToPngBlob(svg: string, widthPx: number, heightPx: number): Promise<Blob | null> {
    const png = await svgToPngDataUrl(svg, widthPx, heightPx);
    const bytes = png ? dataUrlBytes(png.dataUrl) : null;
    return bytes ? new Blob([bytes.bytes as BlobPart], { type: 'image/png' }) : null;
}

/**
 * An SVG held as a Blob (the gift package's fan with its portraits whole,
 * 1127) drawn to a PNG Blob as svgToPngDataUrl draws it: the SVG read by the
 * image from the Blob's address and the canvas written by toBlob, so neither
 * the SVG nor the PNG is ever text in the page's memory. Null as there.
 */
export async function svgBlobToPngBlob(svg: Blob, widthPx: number, heightPx: number): Promise<Blob | null> {
    const scales = posterPngScales(widthPx, heightPx);
    if (scales.length === 0) return null;
    const url = URL.createObjectURL(svg.type ? svg : new Blob([svg], { type: 'image/svg+xml' }));
    try {
        const img = await loadedImage(url, widthPx, heightPx);
        for (const s of scales) {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.floor(widthPx * s));
            canvas.height = Math.max(1, Math.floor(heightPx * s));
            const ctx = canvas.getContext('2d');
            if (!ctx) continue;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
            // Freed at once: the next try (or the file) needs the memory.
            canvas.width = canvas.height = 0;
            if (png && png.size > 0) return png;
        }
        return null;
    } finally {
        URL.revokeObjectURL(url);
    }
}
