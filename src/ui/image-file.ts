/**
 * A tree's file (an attachment, a couple's photo) handed on as a file: saved
 * under its name, or a PDF opened in a new tab. Takes the file as tree data
 * holds it: a data URL, used as before, or a pooled image's reference
 * (image-src.ts: its bytes read from the pool as a Blob, no base64 on the
 * way, shown from an object URL let go a little later).
 */

import { isPoolRef } from '../image-ref.js';
import { imageBlob } from '../image-src.js';
import { imageMetaOf, headMime } from '../image-meta.js';
import { pdfBlobFromDataUrl } from '../attachments.js';

/** An object URL of a saved file is let go this long after its click (the save has started by then). */
export const SAVED_URL_LIFETIME_MS = 10_000;
/** An object URL of a PDF opened in a tab is let go this long after (the tab keeps its own reference). */
export const OPENED_PDF_LIFETIME_MS = 60_000;

function clickSave(href: string, name: string): void {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

/**
 * Save a tree's file under `name`: a data URL straight from a link, a pooled
 * image from an object URL of its bytes. False: nothing to save (a pooled
 * image the pool does not give).
 */
export async function saveImageValue(value: string, name: string): Promise<boolean> {
    if (!isPoolRef(value)) {
        clickSave(value, name);
        return true;
    }
    const blob = await imageBlob(value);
    if (!blob) return false;
    const url = URL.createObjectURL(blob);
    clickSave(url, name);
    setTimeout(() => URL.revokeObjectURL(url), SAVED_URL_LIFETIME_MS);
    return true;
}

/**
 * Make `a` a Download link of a tree's file: a data URL as its href (as
 * before: a middle click, a copy of the link work); a pooled image saved from
 * its bytes on the click.
 */
export function wireImageDownload(a: HTMLAnchorElement, value: string, name: string): void {
    a.download = name;
    if (!isPoolRef(value)) {
        a.href = value;
        return;
    }
    a.href = '#';
    a.addEventListener('click', (e) => {
        e.preventDefault();
        if (a.getAttribute('aria-busy') === 'true') return;
        a.setAttribute('aria-busy', 'true');
        void saveImageValue(value, name).finally(() => a.removeAttribute('aria-busy'));
    });
}

/**
 * Open a tree's PDF in a new tab (only a PDF, always as application/pdf).
 * A data URL as before; a pooled one's tab opens now, on the click (one
 * opened after the read may be blocked), and gets the PDF once it is read.
 * False: not a PDF to open (`failed` is not called then); a pooled one that
 * turns out not to be (none in the pool, another type) closes its tab and
 * calls `failed`.
 */
export function openPdfValue(value: string, mimeType: string, failed?: () => void, lifetimeMs = OPENED_PDF_LIFETIME_MS): boolean {
    if (!isPoolRef(value)) {
        const blob = pdfBlobFromDataUrl(value, mimeType);
        if (!blob) return false;
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), lifetimeMs);
        return true;
    }
    if (mimeType.toLowerCase() !== 'application/pdf') return false;
    const meta = imageMetaOf(value);
    if (meta && headMime(meta.head).toLowerCase() !== 'application/pdf') return false;
    const tab = window.open('', '_blank');
    void imageBlob(value).then((blob) => {
        if (!blob || blob.type !== 'application/pdf') {
            tab?.close();
            failed?.();
            return;
        }
        const url = URL.createObjectURL(blob);
        if (tab && !tab.closed) tab.location.href = url;
        else window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), lifetimeMs);
    }, () => {
        tab?.close();
        failed?.();
    });
    return true;
}
