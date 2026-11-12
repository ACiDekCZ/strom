/**
 * Links that reach a window which does not handle them itself (spec 079 §5):
 * another tab opened with `?person=` / `?live=` / … while the main window is
 * open, or a launch of the installed app that reaches a satellite. The window
 * passes the link on (`link` message, once); the main window opens it the way
 * its own start opens an address.
 *
 * Pure apart from what `LinkOpenerDeps` does: which parameters make a link,
 * what the tab's address keeps, and the order the main window handles them.
 */

import { parseDeepLink, deepLinkTreeMatches, type DeepLink } from '../deep-link.js';

/** The parameters that ask the main window for something (person, search, the research's requests). */
export const LINK_PARAMS = ['person', 'show', 'search', 'live', 'send', 'import-url', 'adopt', 'open'] as const;
/** The parameters that say which tree a link means (passed along with a link, never alone). */
export const LINK_CONTEXT_PARAMS = ['tree', 'research'] as const;

/** What another window passes on: an address (`?…`) and/or files of a launch. */
export interface ForwardedLink {
    search?: string;
    files?: unknown[];
}

/**
 * The link an address carries for the main window (`?person=…&tree=…`), or
 * null when it asks for nothing (a plain address, or only a tree: the tab
 * then says the app is open elsewhere and nothing is passed on).
 */
export function linkToForward(search: string): string | null {
    const params = new URLSearchParams(search);
    if (!LINK_PARAMS.some(k => params.has(k))) return null;
    const out = new URLSearchParams();
    for (const key of [...LINK_PARAMS, ...LINK_CONTEXT_PARAMS]) {
        for (const value of params.getAll(key)) out.append(key, value);
    }
    return `?${out.toString()}`;
}

/** The address without the link and its tree (what a tab keeps once the link went on). */
export function addressWithoutLink(href: string): string {
    const url = new URL(href);
    for (const key of [...LINK_PARAMS, ...LINK_CONTEXT_PARAMS]) url.searchParams.delete(key);
    return url.toString();
}

/** A tree as the main window knows it. */
export interface LinkTree {
    id: string;
    researchId?: string | null;
}

/** What the main window does with a link (the handlers its own start uses). */
export interface LinkOpenerDeps {
    /** The tree open now. */
    currentTree(): LinkTree | null;
    /** The tree the address names (`tree` / `research`: TreeManager.getTreeFromUrl). */
    pickTree(params: URLSearchParams): LinkTree | null;
    /** Open another tree, as the tree switcher does. */
    switchTree(treeId: string): Promise<void>;
    /** `?send=` / `?live=` / `?import-url=` / `?adopt=`: whether the request was one (UI.openExternalRequest). */
    externalRequest(params: URLSearchParams): boolean;
    /** `?search=` (as handleUrlSearchParam at start). */
    search(query: string): void;
    /** `?person=` / `?show=waiting` (UI.openDeepLink). */
    deepLink(link: DeepLink, treeMatches: boolean): Promise<void>;
    /** A file of a launch (a FileSystemFileHandle). */
    openFile(handle: unknown): void;
}

/**
 * Open a link another window passed on, in the order of the app's start: the
 * research's requests (they open their own tree), else the tree the link
 * names, the search, the person or "Waiting for you"; then a launch's files.
 */
export async function openForwardedLink(link: ForwardedLink, deps: LinkOpenerDeps): Promise<void> {
    if (link.search) {
        const params = new URLSearchParams(link.search);
        const external = deps.externalRequest(params);
        let picked: LinkTree | null = null;
        if (!external) {
            picked = deps.pickTree(params);
            const current = deps.currentTree();
            if (picked && picked.id !== current?.id) await deps.switchTree(picked.id);
        }
        const query = params.get('search');
        if (query) deps.search(query);
        const deepLink = parseDeepLink(params);
        if (deepLink && !external) {
            await deps.deepLink(deepLink, deepLinkTreeMatches(params, deps.currentTree(), picked));
        }
    }
    for (const handle of link.files ?? []) deps.openFile(handle);
}
