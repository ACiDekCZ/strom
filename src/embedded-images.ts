/**
 * The images of a large saved app outside its data script (1127). A page's
 * inline script is one string to the browser, and a string has a limit
 * (about 512 million characters in Chrome): a tree whose photos weigh more
 * than about 400 MB written whole into `window.STROM_EMBEDDED_DATA = …`
 * makes a file whose script never runs — the app opens empty. From
 * SPLIT_IMAGES_FROM characters of images on, the data script holds each
 * image as a reference (`"\u0000si:<n>"`, n the image's place) and the
 * images follow in scripts of their own, a few megabytes each:
 *
 *   <script>window.STROM_EMBEDDED_IMAGES=(window.STROM_EMBEDDED_IMAGES||[]).concat([…]);</script>
 *
 * The app puts them back before it reads its data (restoreWindowImages), an
 * import of such a file before it reads the envelope (readHtmlImages). A
 * smaller file is written as before, byte for byte.
 *
 * The scripts start `window.STROM_EMBEDDED_`, as the data script does: the
 * app's copy of its own page for a new export drops them (export.ts
 * stripEmbeddedDataScripts).
 */

/** An image's reference in the data script (the value of a string). */
export const EMBEDDED_IMAGE_REF = '\u0000si:';

/** From this many characters of images on, a saved app has them outside its data script. */
export const SPLIT_IMAGES_FROM = 128 * 1024 * 1024;

/** Characters of images per image script. */
export const IMAGE_SCRIPT_CHARS = 16 * 1024 * 1024;

/** IMAGE_SCRIPT_CHARS (tests may set it: `__STROM_IMAGE_SCRIPT_CHARS`). */
export function imageScriptChars(): number {
    const set = (globalThis as { __STROM_IMAGE_SCRIPT_CHARS?: unknown }).__STROM_IMAGE_SCRIPT_CHARS;
    return typeof set === 'number' ? set : IMAGE_SCRIPT_CHARS;
}

/** The opening of an image script; its images follow as JSON strings, comma-separated. */
export const IMAGE_SCRIPT_OPEN = '<script>window.STROM_EMBEDDED_IMAGES=(window.STROM_EMBEDDED_IMAGES||[]).concat([';
export const IMAGE_SCRIPT_CLOSE = ']);<\/script>\n';

/** Whether a saved app with `chars` characters of images has them outside its data script (tests may set it: `__STROM_SPLIT_IMAGES_FROM`). */
export function splitsImages(chars: number): boolean {
    const set = (globalThis as { __STROM_SPLIT_IMAGES_FROM?: unknown }).__STROM_SPLIT_IMAGES_FROM;
    return chars >= (typeof set === 'number' ? set : SPLIT_IMAGES_FROM);
}

/** The image's place `n` as the data script's JSON writes it. */
export function imageRefJson(n: number): string {
    return `"\\u0000si:${n}"`;
}

function placeOf(v: string, count: number): number {
    if (v.length > 16 || !v.startsWith(EMBEDDED_IMAGE_REF)) return -1;
    const s = v.slice(EMBEDDED_IMAGE_REF.length);
    if (!/^\d+$/.test(s)) return -1;
    const n = Number(s);
    return n < count ? n : -1;
}

/** Put the images back in `value` where it holds their references (in place); how many were put. */
export function restoreImages(value: unknown, images: readonly string[]): number {
    let n = 0;
    const visit = (holder: Record<string, unknown> | unknown[], key: string | number): void => {
        const v = (holder as Record<string | number, unknown>)[key];
        if (typeof v === 'string') {
            const at = placeOf(v, images.length);
            if (at >= 0) {
                (holder as Record<string | number, unknown>)[key] = images[at];
                n++;
            }
        } else if (v && typeof v === 'object') {
            walk(v);
        }
    };
    const walk = (o: object): void => {
        if (Array.isArray(o)) {
            for (let i = 0; i < o.length; i++) visit(o, i);
        } else {
            for (const k of Object.keys(o)) visit(o as Record<string, unknown>, k);
        }
    };
    if (value && typeof value === 'object') walk(value);
    return n;
}

type EmbeddedWindow = {
    STROM_EMBEDDED_DATA?: unknown;
    STROM_ALL_TREES?: unknown;
    STROM_EMBEDDED_IMAGES?: unknown;
};

/**
 * The page's images put back into its embedded data (before it is read);
 * their scripts and the list let go of. Nothing without images outside.
 */
export function restoreWindowImages(): void {
    if (typeof window === 'undefined') return;
    const w = window as unknown as EmbeddedWindow;
    const images = w.STROM_EMBEDDED_IMAGES;
    if (!Array.isArray(images)) return;
    restoreImages(w.STROM_EMBEDDED_DATA, images as string[]);
    restoreImages(w.STROM_ALL_TREES, images as string[]);
    delete w.STROM_EMBEDDED_IMAGES;
    if (typeof document !== 'undefined') {
        document.querySelectorAll('script').forEach(s => {
            if (s.textContent?.startsWith('window.STROM_EMBEDDED_IMAGES=')) s.remove();
        });
    }
}

/** The images of an exported page's text, in their order (none: an empty list). */
export function readHtmlImages(html: string): string[] {
    const images: string[] = [];
    let from = 0;
    for (;;) {
        const at = html.indexOf(IMAGE_SCRIPT_OPEN, from);
        if (at < 0) break;
        const start = at + IMAGE_SCRIPT_OPEN.length;
        const end = html.indexOf(IMAGE_SCRIPT_CLOSE, start);
        if (end < 0) break;
        let part: unknown = null;
        try {
            part = JSON.parse(`[${html.slice(start, end)}]`);
        } catch {
            // Not an image script (the app's own code names its opening): look on.
            from = start;
            continue;
        }
        if (Array.isArray(part)) for (const s of part) images.push(typeof s === 'string' ? s : '');
        from = end + IMAGE_SCRIPT_CLOSE.length;
    }
    return images;
}
