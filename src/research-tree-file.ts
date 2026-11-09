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

import { isResearchHead, parseLoopbackUrl } from './research-link.js';

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
