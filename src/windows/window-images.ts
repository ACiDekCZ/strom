/**
 * The images of the tree a satellite gets (portraits, couples' photos,
 * attachments, record excerpts: data URLs, most of a big tree's size) do not
 * travel in the `tree`/`patch` messages when the satellite can reach the main
 * window: each such string goes as a short reference, and the satellite puts
 * the main window's own string back in its place. The windows of the app share
 * one JavaScript heap (a window opened by another, same origin), so the image
 * is then held once, not once more in every window and again for every
 * change of the tree (out of memory with the Research overview open while a
 * research was followed).
 *
 * A window that cannot reach the main window (a second tab, an older
 * version) says nothing about it in its hello and gets the images as before.
 */

/** Strings this long or longer that start with `data:` go as a reference. */
export const IMAGE_REF_MIN_LENGTH = 1024;

/** What stands in for an image in the data sent ("\u0000" never occurs in the tree's JSON text). */
export const IMAGE_REF_PREFIX = '\u0000strom-image:';

/** How long an image no longer in the tree stays available (messages on their way, a held patch). */
export const IMAGE_KEEP_MS = 60_000;

/** The name the main window publishes its images under (read by satellites through `opener`). */
export const IMAGE_SOURCE_KEY = '__stromWindowImages';

/** Look up an image by its reference number (undefined: not known). */
export type ImageLookup = (id: number) => string | undefined;

function isImage(value: string): boolean {
    return value.length >= IMAGE_REF_MIN_LENGTH && value.startsWith('data:');
}

/** The main window's images by reference number, while they are in the tree (or were a while ago). */
export class WindowImageStore {
    private readonly ids = new Map<string, number>();
    private readonly byId = new Map<number, { value: string; usedAt: number }>();
    private next = 1;

    constructor(private readonly now: () => number = () => Date.now()) {}

    /**
     * Replace every image in `data` (a copy made for sending: its objects are
     * changed in place) by its reference. The same image (same content) keeps
     * its number across changes of the tree.
     */
    replaceImages<T>(data: T): T {
        const at = this.now();
        const visit = (value: unknown): unknown => {
            if (typeof value === 'string') {
                if (!isImage(value)) return value;
                let id = this.ids.get(value);
                if (id === undefined) {
                    id = this.next++;
                    this.ids.set(value, id);
                }
                // The tree's own string (a new version of the research brings new ones of the same content).
                this.byId.set(id, { value, usedAt: at });
                return IMAGE_REF_PREFIX + id;
            }
            if (!value || typeof value !== 'object') return value;
            if (Array.isArray(value)) {
                for (let i = 0; i < value.length; i++) value[i] = visit(value[i]);
                return value;
            }
            const obj = value as Record<string, unknown>;
            for (const key of Object.keys(obj)) obj[key] = visit(obj[key]);
            return obj;
        };
        const out = visit(data) as T;
        for (const [id, e] of this.byId) {
            if (at - e.usedAt <= IMAGE_KEEP_MS) continue;
            this.byId.delete(id);
            this.ids.delete(e.value);
        }
        return out;
    }

    get(id: number): string | undefined {
        return this.byId.get(id)?.value;
    }

    /** How many images it holds (tests). */
    get size(): number {
        return this.byId.size;
    }
}

/**
 * Put the images back in place of their references (in place). False when
 * one is not known: the data is then not complete and must not be used.
 */
export function restoreImages(data: unknown, lookup: ImageLookup): boolean {
    let ok = true;
    const visit = (value: unknown): unknown => {
        if (typeof value === 'string') {
            if (!value.startsWith(IMAGE_REF_PREFIX)) return value;
            const image = lookup(Number(value.slice(IMAGE_REF_PREFIX.length)));
            if (image === undefined) { ok = false; return value; }
            return image;
        }
        if (!value || typeof value !== 'object') return value;
        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) value[i] = visit(value[i]);
            return value;
        }
        const obj = value as Record<string, unknown>;
        for (const key of Object.keys(obj)) obj[key] = visit(obj[key]);
        return obj;
    };
    visit(data);
    return ok;
}

/** The main window publishes its images for the satellites it (or they) opened. */
export function publishImageSource(store: WindowImageStore, target: object | undefined = typeof window !== 'undefined' ? window : undefined): void {
    if (!target) return;
    try {
        Object.defineProperty(target, IMAGE_SOURCE_KEY, { value: (id: number) => store.get(id), configurable: true });
    } catch { /* not published: the satellites get the images in the data */ }
}

interface OpenerChain { opener?: unknown }

/**
 * The main window's images as this window can reach them: through the window
 * that opened it, or the one that opened that (a satellite opened by
 * another). Null when none can be reached (a second tab, a window of another
 * origin, a main window that closed).
 */
export function findImageSource(self: OpenerChain | undefined = typeof window !== 'undefined' ? window : undefined): ImageLookup | null {
    let w: unknown = self?.opener;
    for (let depth = 0; depth < 8 && w; depth++) {
        try {
            const win = w as OpenerChain & { closed?: boolean } & Record<string, unknown>;
            if (win.closed) return null;
            if (typeof win[IMAGE_SOURCE_KEY] === 'function') {
                // Read at every look-up: after the main window's reload its new page publishes its own.
                return (id: number) => {
                    try {
                        if (win.closed) return undefined;
                        const source = win[IMAGE_SOURCE_KEY];
                        const v = typeof source === 'function' ? (source as ImageLookup)(id) : undefined;
                        return typeof v === 'string' ? v : undefined;
                    } catch { return undefined; }
                };
            }
            w = win.opener;
        } catch { return null; }
    }
    return null;
}
