/**
 * The showcase file `strom-showcase` (spec 143): a made-up family with its
 * research, one file per language (`strom-ukazka-<lang>.json`). The app opens
 * it from `?demo=<lang>` (downloaded from the same origin) or as a file
 * (Open, drop). It is told by its header (`kind`), never by its name; the
 * header comes first in the file, so its first few kB say what it is.
 *
 * Shape (format 1):
 *   { kind, format, lang, exportId, sampleVersion, appVersion, researchVersion,
 *     asOf, name, family, sizeBytes,
 *     tree: { format: 'ged', text },            // the research's GEDCOM
 *     research: { id, status, log, material, queue } | null }
 *
 * This module only reads the shape; opening the tree is the UI's work.
 */

import { compareAppVersions, isAppVersion } from './app-version.js';
import type { SampleLang, TreeSampleMark } from './types.js';

/** The header's fixed kind. */
export const SHOWCASE_KIND = 'strom-showcase';

/** The newest format this app reads; a higher one asks for a newer app. */
export const SHOWCASE_FORMAT = 1;

/** The languages a showcase is made in. */
export const SHOWCASE_LANGS: readonly SampleLang[] = ['cs', 'en', 'de', 'pl'];

export type ShowcaseLang = SampleLang;

/** The file's header: what the app reads before it decides anything. */
export interface ShowcaseHeader {
    kind: typeof SHOWCASE_KIND;
    format: number;
    /** The language of the showcase's data; the UI's language does not change by it. */
    lang: ShowcaseLang;
    /** Fixed per language ("showcase-cs"), the same across versions: a second opening only switches. */
    exportId: string;
    /** The showcase's version (an app version, "3.33.0"): a newer one offers an update. */
    sampleVersion: string;
    /** The app's tag the file was built from (informative). */
    appVersion?: string;
    /** The research's tag the file was built from (informative). */
    researchVersion?: string;
    /** ISO time every time in the file is as of. */
    asOf: string;
    /** The tree's default name ("Ukázka – rod Horáků"); empty when the file has none. */
    name: string;
    /** The family's surname ("Horák"); empty when the file has none. */
    family: string;
    /** The size of the whole file in bytes (download progress, storage room); undefined when not said. */
    sizeBytes?: number;
}

/** The research's snapshot (format 1: four bodies of its bridge, each null when the file has none). */
export interface ShowcaseResearch {
    /** The research's UUID: the `_STROM_TREE` of the tree's GEDCOM. */
    id: string;
    status: Record<string, unknown> | null;
    log: Record<string, unknown> | null;
    material: Record<string, unknown> | null;
    queue: Record<string, unknown> | null;
}

/** A whole showcase file. */
export interface ShowcaseFile {
    header: ShowcaseHeader;
    tree: { format: 'ged'; text: string };
    research: ShowcaseResearch | null;
}

/**
 * Why a value is not a showcase the app opens:
 * - `notShowcase`: no showcase header at all (another .json goes on as a backup or tree);
 * - `newerFormat`: a showcase of a newer format (the app updates itself);
 * - `broken`: says it is a showcase, but its header or body is damaged.
 */
export type ShowcaseRejection = 'broken' | 'newerFormat' | 'notShowcase';

export type ShowcaseHeaderResult = { ok: true; header: ShowcaseHeader } | { ok: false; kind: ShowcaseRejection };
export type ShowcaseFileResult = { ok: true; file: ShowcaseFile } | { ok: false; kind: ShowcaseRejection };

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isLang(value: unknown): value is ShowcaseLang {
    return typeof value === 'string' && (SHOWCASE_LANGS as readonly string[]).includes(value);
}

function text(value: unknown, max: number): string | null {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    return v && v.length <= max ? v : null;
}

/** The value says it is a showcase (its `kind`), whether or not the rest of it can be read. */
export function isShowcaseFile(parsed: unknown): boolean {
    return isRecord(parsed) && parsed.kind === SHOWCASE_KIND;
}

/**
 * The first bytes of a file (its first ~4 kB as text) say it is a showcase:
 * its header comes first. For a drop before the file is read whole; the
 * whole file is still checked by parseShowcaseHeader.
 */
export function looksLikeShowcaseText(prefix: string): boolean {
    return /^\s*\{\s*"kind"\s*:\s*"strom-showcase"/.test(prefix.charCodeAt(0) === 0xfeff ? prefix.slice(1) : prefix);
}

/** Read a showcase's header from the parsed JSON (the whole file, or only its header). */
export function parseShowcaseHeader(obj: unknown): ShowcaseHeaderResult {
    if (!isShowcaseFile(obj)) return { ok: false, kind: 'notShowcase' };
    const o = obj as Record<string, unknown>;
    const format = o.format;
    if (typeof format !== 'number' || !Number.isInteger(format) || format < 1) return { ok: false, kind: 'broken' };
    if (format > SHOWCASE_FORMAT) return { ok: false, kind: 'newerFormat' };
    const exportId = text(o.exportId, 200);
    const sampleVersion = text(o.sampleVersion, 60);
    const asOf = text(o.asOf, 40);
    if (!isLang(o.lang) || !exportId || !sampleVersion || !isAppVersion(sampleVersion) || !asOf || !Number.isFinite(Date.parse(asOf))) {
        return { ok: false, kind: 'broken' };
    }
    const optional = (value: unknown) => (typeof value === 'string' && isAppVersion(value) ? value.trim() : undefined);
    const size = o.sizeBytes;
    const header: ShowcaseHeader = {
        kind: SHOWCASE_KIND,
        format,
        lang: o.lang,
        exportId,
        sampleVersion,
        asOf,
        name: text(o.name, 200) ?? '',
        family: text(o.family, 100) ?? '',
    };
    const appVersion = optional(o.appVersion);
    if (appVersion) header.appVersion = appVersion;
    const researchVersion = optional(o.researchVersion);
    if (researchVersion) header.researchVersion = researchVersion;
    if (typeof size === 'number' && Number.isFinite(size) && size > 0) header.sizeBytes = Math.round(size);
    return { ok: true, header };
}

/**
 * Read a whole showcase file: its header, its tree (a GEDCOM text) and its
 * research's snapshot (each part null when missing; a part of a wrong shape
 * makes the file broken).
 */
export function parseShowcaseFile(obj: unknown): ShowcaseFileResult {
    const head = parseShowcaseHeader(obj);
    if (!head.ok) return head;
    const o = obj as Record<string, unknown>;
    const tree = o.tree;
    if (!isRecord(tree) || tree.format !== 'ged' || typeof tree.text !== 'string' || !/^\s*0\s+HEAD\b/.test(tree.text.replace(/^﻿/, ''))) {
        return { ok: false, kind: 'broken' };
    }
    let research: ShowcaseResearch | null = null;
    if (o.research !== undefined && o.research !== null) {
        if (!isRecord(o.research)) return { ok: false, kind: 'broken' };
        const r = o.research;
        const id = text(r.id, 64);
        if (!id) return { ok: false, kind: 'broken' };
        const part = (value: unknown): Record<string, unknown> | null | undefined =>
            value === undefined || value === null ? null : isRecord(value) ? value : undefined;
        const status = part(r.status), log = part(r.log), material = part(r.material), queue = part(r.queue);
        if (status === undefined || log === undefined || material === undefined || queue === undefined) return { ok: false, kind: 'broken' };
        research = { id: id.toLowerCase(), status, log, material, queue };
    }
    return { ok: true, file: { header: head.header, tree: { format: 'ged', text: tree.text }, research } };
}

/**
 * Order of two showcase versions (semver, pre-releases too: 3.33.0-beta.2 <
 * 3.33.0): negative when `a` is older, 0 when the same, positive when newer.
 * A value that is no version is older than any version.
 */
export function compareSampleVersion(a: string, b: string): number {
    const va = isAppVersion(a), vb = isAppVersion(b);
    if (!va || !vb) return va === vb ? 0 : va ? 1 : -1;
    return compareAppVersions(a, b);
}

/** What a showcase tree keeps of its header (TreeManager.markSampleTree). */
export function sampleMarkOf(header: ShowcaseHeader): TreeSampleMark {
    return { exportId: header.exportId, lang: header.lang, sampleVersion: header.sampleVersion, asOf: header.asOf };
}
