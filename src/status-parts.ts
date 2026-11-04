/**
 * The light status of a research's bridge (research 1.26.0, feature
 * `status.parts`): `/status?…&parts=1` leaves its heavy parts out and says a
 * rev for each instead; a part is read on its own (`GET <token>/status/<part>`)
 * only when its rev differs from the one kept here. The status put together
 * has the shape of the full `/status`, so it is sanitized as ever. A bridge
 * without the feature is asked for the full status, as before.
 */

/** The feature of a bridge that answers the light status and its parts. */
export const STATUS_PARTS_FEATURE = 'status.parts';

/** The heavy parts and the fields of the full `/status` each one carries. */
export const STATUS_PARTS: Readonly<Record<string, readonly string[]>> = {
    waiting: ['waiting'],
    queue: ['queue', 'queueMore', 'queueCounts'],
    offLine: ['offLine'],
    researches: ['researches'],
};

/** A rev is only compared (research: 16 hex); anything plain and short is taken. */
const REV = /^[\w.:-]{1,128}$/;

interface KeptPart { rev: string; fields: Record<string, unknown> }

/** Per bridge address (its token: a new one starts empty): the parts read and their revs. */
const kept = new Map<string, Map<string, KeptPart>>();
/** Bridge addresses whose last full or light status named `status.parts`. */
const capable = new Set<string>();

/** The bridge's address (`…/<token>`) of a `/status` URL. */
export function statusBase(statusUrl: string): string {
    return statusUrl.replace(/\/status(\?.*)?$/, '');
}

/** The URL to ask: with `parts=1` for a bridge known to answer it, else as given. */
export function statusAskUrl(statusUrl: string): string {
    if (!capable.has(statusBase(statusUrl))) return statusUrl;
    return `${statusUrl}${statusUrl.includes('?') ? '&' : '?'}parts=1`;
}

/** Forget what was kept of a bridge (another address, the tests). */
export function forgetStatusParts(base?: string): void {
    if (base === undefined) { kept.clear(); capable.clear(); return; }
    kept.delete(base);
    capable.delete(base);
}

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** What one part's answer carries: its rev and its fields (a part the research lacks: none). */
function partOf(name: string, value: unknown): KeptPart | null {
    const r = record(value);
    if (!r || r.part !== name || typeof r.rev !== 'string' || !REV.test(r.rev)) return null;
    const fields: Record<string, unknown> = {};
    for (const f of STATUS_PARTS[name]) if (f in r) fields[f] = r[f];
    return { rev: r.rev, fields };
}

/**
 * The status as the full `/status` would say it, from what the bridge answered
 * at `statusUrl`: a full status as it is; a light one (`parts`) with each heavy
 * part taken from the copy kept here when its rev is the same, else read by
 * `readPart` (all at once). A part that cannot be read keeps its older copy;
 * with none kept, the error goes to the caller (the ask failed).
 */
export async function completeStatus(statusUrl: string, raw: unknown,
    readPart: (url: string) => Promise<unknown>): Promise<unknown> {
    const r = record(raw);
    if (!r) return raw;
    const base = statusBase(statusUrl);
    const features = Array.isArray(r.features) ? r.features : null;
    if (features?.includes(STATUS_PARTS_FEATURE)) capable.add(base);
    else if (features) capable.delete(base);
    const parts = record(r.parts);
    if (!parts) return raw;
    const out: Record<string, unknown> = { ...r };
    delete out.parts;
    const mine = kept.get(base) ?? new Map<string, KeptPart>();
    kept.set(base, mine);
    await Promise.all(Object.keys(STATUS_PARTS).map(async (name) => {
        const rev = parts[name];
        if (typeof rev !== 'string' || !REV.test(rev)) return;
        let part = mine.get(name);
        if (part?.rev !== rev) {
            try {
                const read = partOf(name, await readPart(`${base}/status/${name}`));
                if (!read) throw new Error(`status part ${name}: unreadable`);
                mine.set(name, read);
                part = read;
            } catch (err) {
                if (!part) throw err;
            }
        }
        Object.assign(out, part.fields);
    }));
    return out;
}
