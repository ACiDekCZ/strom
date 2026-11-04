/**
 * The agent's browser as the research says it (`/status.browser`, spec 048
 * §11): the "Browser" row beside the agent (the ready dialog, Research for
 * this tree) and the note at items waiting for images from an archive the
 * agent reaches only through the browser. Pure: what to say and which links
 * belong to it; the UI draws it.
 */

import { strings } from './strings.js';
import type { BrowserArchive, BrowserInfo, LiveWaiting } from './research-link.js';
import { researchArchiveHost } from './research-link.js';
import { waitingForImages } from './research-waiting.js';

/** Most archives without permission listed by name in the row; the rest are counted. */
export const BROWSER_LIST_MAX = 3;
/** An agent's name longer than this is shortened ("…"), whole in its title. */
export const AGENT_NAME_MAX = 40;

/** An agent's name as shown: at most 40 characters, then "…". */
export function shortAgentName(name: string): string {
    return name.length > AGENT_NAME_MAX ? `${name.slice(0, AGENT_NAME_MAX - 1).trimEnd()}…` : name;
}

export type BrowserRowKind = 'ready' | 'readyShort' | 'readyPermit' | 'noExt' | 'otherAgent';

/** An archive without permission in the row's list. */
export interface BrowserRowArchive {
    host: string;
    /** Its name (the research's title, else the host). */
    name: string;
    /** "name · host", for its title. */
    full: string;
}

/** The "Browser" row: its sentence, the dot, the list and the links (each only where it belongs). */
export interface BrowserRow {
    kind: BrowserRowKind;
    text: string;
    /** A filled dot (connected) or an empty one. */
    on: boolean;
    /** "Claude in Chrome ↗" to the extension's page (a computer only). */
    extUrl?: string;
    /** Archives without permission: the first three by name. */
    unpermitted: BrowserRowArchive[];
    /** Names of the rest ("and N more", their names in its title). */
    more: string[];
    /** "Permission…" at each archive (a computer with the research's links). */
    permitLinks: boolean;
    /** "The extension and permissions are set up on a computer." (a phone, where a link would be). */
    phoneHint: boolean;
}

export interface BrowserRowContext {
    /** The agent's name, when said. */
    agent?: string;
    /** The research waits for its agent (none chosen): nothing is said of a browser. */
    agentAway?: boolean;
    /** A phone: no links. */
    phone: boolean;
    /** The research's links on this computer (`archive`). */
    links: boolean;
}

/** An archive's name in the row's list: the research's title, else its host. */
function rowArchive(a: BrowserArchive): BrowserRowArchive {
    const name = a.title || a.host;
    return { host: a.host, name, full: name === a.host ? a.host : `${name} · ${a.host}` };
}

/**
 * The row, or null where there is none: an old bridge, an archive (no
 * `browser`), a research waiting for its agent, a missing extension or an
 * agent without a browser with no archive that needs one.
 */
export function browserRow(info: BrowserInfo | null | undefined, ctx: BrowserRowContext): BrowserRow | null {
    if (!info || ctx.agentAway) return null;
    const b = strings.research.browser;
    const base = { unpermitted: [], more: [], permitLinks: false, phoneHint: false };
    if (info.state === 'ready') {
        if (info.archives.length === 0) return { ...base, kind: 'readyShort', text: b.readyShort, on: true };
        const without = info.archives.filter(a => !a.permitted).map(rowArchive);
        if (without.length === 0) return { ...base, kind: 'ready', text: b.ready, on: true };
        return {
            kind: 'readyPermit', text: b.readyPermit, on: true,
            unpermitted: without.slice(0, BROWSER_LIST_MAX),
            more: without.slice(BROWSER_LIST_MAX).map(a => a.name),
            permitLinks: !ctx.phone && ctx.links,
            phoneHint: ctx.phone,
        };
    }
    if (info.archives.length === 0) return null;
    if (info.state === 'no-extension') {
        return { ...base, kind: 'noExt', text: b.noExt, on: false, ...(info.url && !ctx.phone ? { extUrl: info.url } : {}), phoneHint: ctx.phone && !!info.url };
    }
    // An agent whose browser the research does not watch: named (a research without a named agent says nothing).
    if (!ctx.agent) return null;
    return { ...base, kind: 'otherAgent', text: b.otherAgent(shortAgentName(ctx.agent)), on: false };
}

/** A web address's host ("archive.example.org"), lowercased; null when not an address. */
function hostOf(url: string | undefined): string | null {
    if (!url) return null;
    try {
        return researchArchiveHost(new URL(url).hostname);
    } catch { return null; }
}

/** Two hosts are the same archive (a leading "www." aside). */
function sameHost(a: string, b: string): boolean {
    const strip = (h: string): string => h.replace(/^www\./, '');
    return strip(a) === strip(b);
}

/** The browser archive of an item by its own address or its group's. */
function directArchive(info: BrowserInfo, w: LiveWaiting): BrowserArchive | null {
    const hosts = [hostOf(w.url), hostOf(w.group?.url)].filter((h): h is string => !!h);
    for (const h of hosts) {
        const a = info.archives.find(x => sameHost(x.host, h));
        if (a) return a;
    }
    return null;
}

/**
 * The browser archive an item waiting for images is done at: the host of its
 * address or its group's, or another item of its group that names it (two
 * websites of one institution are one group).
 */
export function browserArchiveOf(info: BrowserInfo, w: LiveWaiting, all: readonly LiveWaiting[] = []): BrowserArchive | null {
    const own = directArchive(info, w);
    if (own) return own;
    const key = w.group?.key;
    if (!key) return null;
    for (const other of all) {
        if (other === w || other.group?.key !== key) continue;
        const a = directArchive(info, other);
        if (a) return a;
    }
    return null;
}

/** The archive's name in the note: its title without a trailing "(…)", else the group's name, else its host. */
export function browserArchiveName(a: BrowserArchive, w?: LiveWaiting): string {
    const title = (a.title ?? '').replace(/\s*\([^()]*\)\s*$/, '').trim();
    return title || w?.group?.name || a.host;
}

export type BrowserNoteKind = 'agent' | 'noExt' | 'permit';

/** The note at an item (or a group) waiting for images from a browser-only archive. */
export interface BrowserNote {
    kind: BrowserNoteKind;
    text: string;
    /** The archive it is about, and its name. */
    host: string;
    name: string;
    /** "Claude in Chrome ↗" (a computer only). */
    extUrl?: string;
    /** "Permission…" for this host (a computer with the research's links). */
    permitHost?: string;
}

export interface BrowserNoteContext {
    phone: boolean;
    links: boolean;
    agentAway?: boolean;
}

/** The note for one item waiting for images, or null (permitted, not a browser archive, an old bridge…). */
export function browserNote(info: BrowserInfo | null | undefined, w: LiveWaiting, all: readonly LiveWaiting[], ctx: BrowserNoteContext): BrowserNote | null {
    if (!info || ctx.agentAway || !waitingForImages(w)) return null;
    const a = browserArchiveOf(info, w, all);
    if (!a) return null;
    const b = strings.research.browser;
    const name = browserArchiveName(a, w);
    if (info.state === 'agent-without-browser') return { kind: 'agent', text: b.waitAgent, host: a.host, name };
    if (info.state === 'no-extension') {
        return { kind: 'noExt', text: ctx.phone ? b.waitNoExtPhone : b.waitNoExt, host: a.host, name, ...(info.url && !ctx.phone ? { extUrl: info.url } : {}) };
    }
    if (a.permitted) return null;
    return { kind: 'permit', text: ctx.phone ? b.waitPermitPhone(name) : b.waitPermit(name), host: a.host, name, ...(!ctx.phone && ctx.links ? { permitHost: a.host } : {}) };
}

/**
 * The note said once in a group's heading: when at least two of the group's
 * items waiting for images are done at one browser archive; null otherwise
 * (then each item says it in its detail).
 */
export function browserGroupNote(info: BrowserInfo | null | undefined, items: readonly LiveWaiting[], all: readonly LiveWaiting[], ctx: BrowserNoteContext): BrowserNote | null {
    if (!info) return null;
    const byHost = new Map<string, { note: BrowserNote; n: number }>();
    for (const w of items) {
        const note = browserNote(info, w, all, ctx);
        if (!note) continue;
        const seen = byHost.get(note.host);
        if (seen) seen.n++;
        else byHost.set(note.host, { note, n: 1 });
    }
    for (const { note, n } of byHost.values()) if (n >= 2) return note;
    return null;
}
