/**
 * The research's tree as its bridge gives it (`GET <bridge>/tree.ged`).
 *
 * A large research takes a while to build its file. A bridge with the feature
 * `ged.stale` (Strom Research 1.30.0) answers `tree.ged?stale=1` at once with
 * the last file it built, though the research changed since:
 * `X-Strom-Head` the commit the file was written from (= `1 _STROM_HEAD`),
 * `X-Strom-Stale: 1` and `X-Strom-Head-Now` the research's commit now. It
 * builds the newer file meanwhile and tells it by the event `change`.
 *
 * The state the app then has is the FILE's head, never the research's head now:
 * a send (`/sync`) builds on it, and claiming a state the tree does not hold
 * would make the research read the edit against the wrong version.
 *
 * The bridge may not let the browser read its headers (a cross-origin answer
 * without `Access-Control-Expose-Headers`): the file's own `_STROM_HEAD` then
 * says its head, and a head other than the research's status says it is older.
 */

import { isResearchHead, parseLoopbackUrl, researchFamilyRef, researchPersonRef } from './research-link.js';
import type { ResearchLink, StromData } from './types.js';

/** The bridge answers `tree.ged?stale=1` with the last file it built (Strom Research 1.30.0). */
export const GED_STALE_FEATURE = 'ged.stale';

/**
 * How long a tree is waited for: the first build of a large research takes
 * a minute or more (the bridge builds on, a later ask gets it at once).
 */
export const TREE_GED_TIMEOUT_MS = 120_000;

/** Whether the bridge gives its last built tree at once (`ged.stale` in its features). */
export function bridgeGivesStale(features: readonly string[] | null | undefined): boolean {
    return !!features?.includes(GED_STALE_FEATURE);
}

/** The address that asks for the last built tree (`stale=1`), the rest of the address kept. */
export function staleTreeUrl(ged: string): string {
    const url = parseLoopbackUrl(ged);
    if (!url) return ged;
    url.searchParams.set('stale', '1');
    return url.toString();
}

/** What the answer's headers say of the file (null / false: not said, or not readable here). */
export interface TreeReplyHeads {
    /** `X-Strom-Head`: the commit the file was written from. */
    head: string | null;
    /** `X-Strom-Stale: 1`: the research changed since the file was built. */
    stale: boolean;
    /** `X-Strom-Head-Now`: the research's commit now. */
    headNow: string | null;
}

/** The heads of an answer of `tree.ged` (`get`: a header by name, e.g. `res.headers.get`). */
export function treeReplyHeads(get: (name: string) => string | null): TreeReplyHeads {
    const read = (name: string): string | null => {
        try {
            return get(name);
        } catch {
            return null;
        }
    };
    return {
        head: isResearchHead(read('X-Strom-Head')),
        stale: (read('X-Strom-Stale') ?? '').trim() === '1',
        headNow: isResearchHead(read('X-Strom-Head-Now')),
    };
}

/** The state a loaded tree stands on, and whether a newer one is being built. */
export interface TreeFileState {
    /** The head the tree holds: the file's (its header, else `_STROM_HEAD`), else the status's. */
    head: string;
    /** The research has moved on beyond this file: a newer one is being built. */
    preparing: boolean;
    /** The research's head now (the newer version to wait for; '' when not known). */
    headNow: string;
}

/**
 * The state of a tree loaded with `stale=1`. `fileHead`: its `1 _STROM_HEAD`;
 * `statusHead`: the research's head in its status asked just before.
 * Older without the bridge saying so: only when its headers could not be read
 * (the file then shows its head, the status the research's now).
 */
export function treeFileState(reply: TreeReplyHeads, fileHead: string | null, statusHead: string): TreeFileState {
    const head = reply.head ?? fileHead ?? statusHead;
    const headNow = reply.headNow ?? statusHead;
    const said = reply.head !== null;
    const differs = !!fileHead && !!headNow && fileHead.toLowerCase() !== headNow.toLowerCase();
    const preparing = said ? reply.stale : differs;
    return { head, preparing, headNow: preparing ? headNow : '' };
}

// ==================== THE FILE A TREE ALREADY HOLDS (`ged.etag`) ====================
//
// A bridge with `ged.etag` (Strom Research 1.30.0) sends `ETag` with
// `tree.ged` (its head and the file's variant, the app's version included). The
// app keeps it with the tree loaded from that file and asks again with
// `If-None-Match`: `304` (no body) means the bridge would send the very file
// the tree was loaded from, so nothing is downloaded or parsed. A file sent
// without `ETag` (built before all its image crops were ready) is never kept
// as a finished state. Without the feature no `If-None-Match` goes (it is not
// a simple header: an older bridge would get a preflight it never asked for).

/** The bridge sends `ETag` with `tree.ged` and answers `If-None-Match` with 304 (Strom Research 1.30.0). */
export const GED_ETAG_FEATURE = 'ged.etag';

/** Whether the bridge answers a tree it would send again with 304 (`ged.etag` in its features). */
export function bridgeGivesEtag(features: readonly string[] | null | undefined): boolean {
    return !!features?.includes(GED_ETAG_FEATURE);
}

/** An entity tag as HTTP writes it (`"…"` or `W/"…"`), kept verbatim; anything else is no tag. */
export function readTreeEtag(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const tag = value.trim();
    return /^(W\/)?"[\x21\x23-\x7e]{1,200}"$/.test(tag) ? tag : null;
}

/** The `ETag` of an answer of `tree.ged` (`get`: a header by name; null when absent or not readable here). */
export function treeReplyEtag(get: (name: string) => string | null): string | null {
    try {
        return readTreeEtag(get('ETag'));
    } catch {
        return null;
    }
}

/**
 * The tag to ask with (`If-None-Match`) for the tree tied by `link`, or null
 * when the tree is not exactly the file the tag names: a copy, no tag, a
 * base moved since the load (another load, a send's new head, an undo), the
 * tree changed since (`fingerprint`: the stored tree's now, in the link's
 * format), or images taken otherwise than the setting says now.
 */
export function storedTreeEtag(
    link: Pick<ResearchLink, 'fingerprint' | 'head' | 'copy' | 'treeEtag'> | null | undefined,
    fingerprint: string | null,
    images: boolean,
): string | null {
    const kept = link?.treeEtag;
    if (!link || link.copy || !kept || !readTreeEtag(kept.tag)) return null;
    if (!link.fingerprint || kept.fingerprint !== link.fingerprint || kept.head !== (link.head ?? '')) return null;
    if (fingerprint !== link.fingerprint || kept.images !== images) return null;
    return kept.tag;
}

/**
 * The partners of each couple of the research a tree holds, by the family's
 * id in the research (Partnership.researchId): the research ids (REFN) of
 * the first partner, then the second. What `researchFamilyPartners` reads
 * from the file, for a tree not downloaded again (a 304).
 */
export function treeFamilyPartners(data: Pick<StromData, 'persons' | 'partnerships'>): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const ps of Object.values(data.partnerships ?? {})) {
        const key = researchFamilyRef(ps?.researchId);
        if (!key || out.has(key)) continue;
        const partners = [ps.person1Id, ps.person2Id]
            .map(id => researchPersonRef(data.persons?.[id]?.refn))
            .filter((r): r is string => !!r);
        if (partners.length) out.set(key, partners);
    }
    return out;
}
