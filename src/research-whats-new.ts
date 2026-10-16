/**
 * "What's new" of Strom Research in the app — the pure, testable half: the
 * bridge's answer to `GET <base>/whats-new?lang=…` checked and cleaned, the
 * decision whether to ask it, and its points as blocks of the "What's new"
 * dialog. The DOM half lives in src/ui/release-notes-ui.ts.
 *
 * The research's version seen here is one per computer (browser storage):
 * one install of the research serves every tree linked to it.
 */

import { sanitizeUpdate } from './research-link.js';
import { compareAppVersions, isAppVersion } from './app-version.js';
import { ChangelogLanguage, NotesBlock, parseInline } from './release-notes.js';

/** `/status.features`: the bridge answers `GET /whats-new`. */
export const WHATS_NEW_FEATURE = 'whats.new';

/** The research's changelog on GitHub: the only address a link of its section may lead to. */
export const RESEARCH_CHANGELOG_PREFIX = 'https://github.com/ACiDekCZ/strom-research/';

/** At most this many points are taken, each cut to this length. */
export const MAX_RESEARCH_POINTS = 20;
export const MAX_RESEARCH_POINT_LENGTH = 1000;
const MAX_URL_LENGTH = 500;

/** The bridge's answer to `/whats-new`, checked and cleaned. */
export interface ResearchWhatsNew {
    version: string;
    lang: ChangelogLanguage;
    /** Its changelog at the version's section; null when the bridge named no allowed address. */
    url: string | null;
    /** The section's top-level points, inline markdown (bold, italic, code); may be empty. */
    points: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** A link only into the research's own repository on GitHub, else null. */
export function researchChangelogUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const raw = value.trim();
    if (!raw.startsWith(RESEARCH_CHANGELOG_PREFIX) || raw.length > MAX_URL_LENGTH) return null;
    try {
        const url = new URL(raw);
        return url.href.startsWith(RESEARCH_CHANGELOG_PREFIX) ? url.href : null;
    } catch {
        return null;
    }
}

/** `GET /whats-new`. Untrusted: anything that is not an answer of that shape is null. */
export function sanitizeResearchWhatsNew(value: unknown): ResearchWhatsNew | null {
    const r = asRecord(value);
    if (!r) return null;
    const version = sanitizeUpdate({ version: r.version })?.version;
    if (!version || !Array.isArray(r.points)) return null;
    const points: string[] = [];
    for (const point of r.points) {
        if (points.length >= MAX_RESEARCH_POINTS) break;
        if (typeof point !== 'string') continue;
        const text = point.replace(/\s+/g, ' ').trim().slice(0, MAX_RESEARCH_POINT_LENGTH).trim();
        if (text !== '') points.push(text);
    }
    const lang = r.lang === 'cs' || r.lang === 'de' || r.lang === 'en' ? r.lang : 'en';
    return { version, lang, url: researchChangelogUrl(r.url), points };
}

/** Everything the decision to ask the bridge looks at. */
export interface ResearchWhatsNewContext {
    /** The research's version last recorded as seen on this computer (null: never). */
    seenVersion: string | null;
    /** The version the bridge just said (`/status.version`). */
    bridgeVersion: string;
    /** The bridge said it answers `/whats-new`. */
    hasFeature: boolean;
    /** The setting "What's new after an update" is on. */
    enabled: boolean;
    /**
     * The app already had a tree linked to a research (or knew a research's
     * bridge) when this page started: a user of the research meeting the
     * bridge's version for the first time here, not a link made just now.
     */
    linkedAtStart?: boolean;
}

/**
 * - `remember`: record the bridge's version as seen, ask nothing (the first
 *   link on this computer made in this page, a version not newer, an older
 *   bridge, the setting off);
 * - `ask`: a newer version than seen, or none seen yet by a research linked
 *   before this page started — ask the bridge for its points;
 * - `skip`: nothing to do (the same version, or no usable version).
 */
export type ResearchWhatsNewDecision = 'remember' | 'ask' | 'skip';

export function decideResearchWhatsNew(ctx: ResearchWhatsNewContext): ResearchWhatsNewDecision {
    const current = ctx.bridgeVersion.trim();
    if (!isAppVersion(current)) return 'skip';
    const seen = ctx.seenVersion?.trim() ?? '';
    if (seen === current) return 'skip';
    // Nothing (or nothing readable) stored: a link made in this page is the first
    // one here, not an update; a research linked before has news to tell.
    if (!isAppVersion(seen)) return ctx.linkedAtStart && ctx.enabled && ctx.hasFeature ? 'ask' : 'remember';
    // Back from a beta to a release, or the same: nothing to tell.
    if (compareAppVersions(current, seen) <= 0) return 'remember';
    if (!ctx.enabled || !ctx.hasFeature) return 'remember';
    return 'ask';
}

/** The points as bullet blocks of the dialog (inline markdown only, never HTML). */
export function researchNotesBlocks(points: readonly string[]): NotesBlock[] {
    return points.map(point => ({ kind: 'item' as const, inline: parseInline(point) }));
}
