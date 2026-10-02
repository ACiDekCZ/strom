/**
 * Where a research tree stands with its research (Strom Research 1.12+):
 * in sync, changes the research does not have, sent and waiting in its inbox,
 * a newer version there, the bridge not running, a send refused or discarded.
 * Pure: the UI feeds it what it knows and shows the one state that matters most.
 */

import { ResearchLink, ResearchSend, Source, StromData } from './types.js';
import { ResearchInbox, LiveIntake, ResearchSendRecord } from './research-link.js';

export type ResearchSyncKind =
    | 'none' | 'inSync' | 'unsent' | 'sentPending' | 'newer' | 'unsentAndNewer' | 'waitThenLoad'
    | 'bridgeDown' | 'unsentBridgeDown' | 'refused' | 'rejected' | 'safari';

export interface ResearchSyncInput {
    /** The tree's tie to its research (none: not a research tree). */
    link: ResearchLink | undefined;
    /** The research said at least once what it takes (`accepts`): the new behaviour is on. */
    capable: boolean;
    /** The research row is offered here (a computer, links not switched off). */
    shown: boolean;
    /** The tree equals what the research last gave it (fingerprint like link.fingerprint). */
    matchesBase: boolean;
    /** The tree's content fingerprint now (format of a send). */
    current: string;
    /** The bridge answered lately. */
    bridgeUp: boolean;
    /** Safari: it never reaches the bridge. */
    safari: boolean;
    /** The research's head as last seen ('' = unknown). */
    remoteHead: string;
}

export interface ResearchSyncState {
    kind: ResearchSyncKind;
    /** The send shown (sentPending / waitThenLoad / rejected). */
    sent?: ResearchSend;
    /** Why the bridge refused (refused). */
    reason?: string;
}

/** The one state to show, by priority (see ZADANI_DEV_app-vstup-dat 1.1). */
export function researchSyncState(input: ResearchSyncInput): ResearchSyncState {
    const { link } = input;
    if (!link || !input.capable || !input.shown) return { kind: 'none' };
    if (input.safari) return { kind: 'safari' };
    const sent = link.sent;
    // What the research does not have: changed since its version and not the state sent.
    const unsent = !input.matchesBase && input.current !== sent?.fingerprint;
    const newer = !!input.remoteHead && !!link.head && input.remoteHead !== link.head;
    if (unsent && newer && input.bridgeUp) return { kind: 'unsentAndNewer' };
    if (sent?.state === 'discarded') return { kind: 'rejected', sent };
    if (link.refused) return { kind: 'refused', reason: link.refused.reason };
    if (unsent) return { kind: input.bridgeUp ? 'unsent' : 'unsentBridgeDown' };
    if (sent?.state === 'pending' && sent.thenLoad) return { kind: 'waitThenLoad', sent };
    if (sent?.state === 'pending') return { kind: 'sentPending', sent };
    if (newer) return { kind: 'newer' };
    if (!input.bridgeUp) return { kind: 'bridgeDown' };
    return { kind: 'inSync' };
}

/** States that light the dot on ⋯ (the user has something to do). */
export function researchSyncWantsAttention(kind: ResearchSyncKind): boolean {
    return kind === 'unsent' || kind === 'unsentBridgeDown' || kind === 'newer'
        || kind === 'unsentAndNewer' || kind === 'refused' || kind === 'rejected';
}

/** A changes-not-sent state (the ⋯ label and the data window say so). */
export function researchSyncUnsent(kind: ResearchSyncKind): boolean {
    return kind === 'unsent' || kind === 'unsentBridgeDown' || kind === 'unsentAndNewer';
}

/** "Send, then load" waits at most this long. */
export const THEN_LOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** A send closes this much before the research's intake time still counts as written by it (clock skew). */
const INTAKE_SKEW_MS = 5000;

/** What became of a pending send (see pendingSendFate). */
export interface SendFate {
    state: 'pending' | 'written' | 'discarded';
    /** When the user decided in the research ('' = unknown). */
    at: string;
    /** The user's words when discarding. */
    reason: string;
    /** "Nothing new": the research already had it all (0 changes). */
    nothing: boolean;
}

/**
 * What became of a pending send, from the research's status. Its own record
 * first (`sends`, found by the mark the /sync reply gave; a send replaced by a
 * newer one of the same app tree follows that one); without it, the inbox: still
 * there, written (an intake as new as the send, or the head moved without any
 * intake said), or discarded. Null: unknown (an older research).
 */
export function pendingSendFate(
    sent: ResearchSend,
    appTreeId: string,
    researchId: string,
    status: { inbox: ResearchInbox | null; head: string; lastIntake: LiveIntake | null; sends?: ResearchSendRecord[] | null }
): SendFate | null {
    const fate = (state: SendFate['state'], at = '', reason = '', nothing = false): SendFate => ({ state, at, reason, nothing });
    const ours = (tree: string): boolean => tree === appTreeId || tree === researchId;
    if (status.sends && sent.intake) {
        let rec = status.sends.find(r => r.intake === sent.intake);
        // Replaced by a newer send of this tree: that one tells.
        for (let hop = 0; rec?.state === 'replaced' && hop < 5; hop++) {
            const from: ResearchSendRecord = rec;
            rec = status.sends
                .filter(r => ours(r.tree) && r.intake !== from.intake && r.at >= from.at)
                .sort((a, b) => (a.at < b.at ? 1 : -1))[0];
        }
        if (rec) {
            if (rec.state === 'pending' || rec.state === 'replaced') return fate('pending');
            if (rec.state === 'written') return fate('written', rec.decidedAt);
            if (rec.state === 'nothing') return fate('written', rec.decidedAt, '', true);
            return fate('discarded', rec.decidedAt, rec.reason);
        }
    }
    if (!status.inbox) return null;
    // The research keeps one send per app tree (`_STROM_APP_TREE`); an entry
    // keyed by the research's id comes from a send that did not name the tree.
    const waiting = status.inbox.trees.some(t => t.sent === sent.fingerprint && ours(t.tree));
    if (waiting) return fate('pending');
    const sentAt = Date.parse(sent.at);
    const intakeAt = status.lastIntake ? Date.parse(status.lastIntake.at) : NaN;
    if (Number.isFinite(intakeAt) && Number.isFinite(sentAt) && intakeAt >= sentAt - INTAKE_SKEW_MS) return fate('written', status.lastIntake!.at);
    if (!status.lastIntake && sent.head && status.head && status.head !== sent.head) return fate('written');
    return fate('discarded');
}

// ==================== TRANSCRIPTS: LEAD OR EVIDENCE ====================

/** FNV-1a 32-bit. */
function fnv(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return (h >>> 0).toString(36);
}

/** What a reading of the entry consists of: its wording and its page. */
export function sourceReadingHash(src: Source): string {
    return fnv(`${(src.transcript ?? '').trim()}\u0000${(src.reference ?? '').trim()}`);
}

/** Every source with a transcript, by id → reading hash (what a send carries). */
export function sourceReadings(data: StromData): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [id, src] of Object.entries(data.sources ?? {})) {
        if (src?.transcript?.trim()) out[id] = sourceReadingHash(src);
    }
    return out;
}

/**
 * The research read this entry itself (its transcript is the research's):
 * the user's change is a second reading there, and "Transcription verified"
 * is not offered. Its own word when it says (`readBy`); otherwise an entry
 * with the research's number that the app never sent.
 */
export function researchReadSource(src: Source, link: ResearchLink | undefined): boolean {
    if (src.readBy === 'research' || src.readBy === 'both') return true;
    if (src.readBy === 'user') return false;
    if (!src.refn || !/^S\d+$/.test(src.refn)) return false;
    return !(link?.sentSources?.[src.id] || link?.olderSources?.[src.id]);
}

/** A source sent before the tree switched to evidence, unchanged since: the switch does not reach it. */
export function isOlderSource(src: Source, link: ResearchLink | undefined): boolean {
    if (link?.transcripts !== 'evidence') return false;
    const then = link.olderSources?.[src.id];
    return !!then && then === sourceReadingHash(src);
}

/** How the source editor offers "Transcription verified". */
export type VerifiedOffer =
    | 'none'        // not a research tree / no transcript / the research's own reading
    | 'checkbox'    // lead: always; evidence: an older source (or one already ticked)
    | 'byTree';     // evidence and a new or changed source: the tree setting covers it

export function verifiedOffer(src: Source, link: ResearchLink | undefined, capable: boolean): VerifiedOffer {
    if (!link || !capable || !src.transcript?.trim()) return 'none';
    if (researchReadSource(src, link)) return 'none';
    if (src.transcriptVerified) return 'checkbox';
    if (link.transcripts !== 'evidence') return 'checkbox';
    return isOlderSource(src, link) ? 'checkbox' : 'byTree';
}

/** Older sources with a transcript not yet verified (the link in Research for this tree). */
export function unverifiedOlderSources(data: StromData, link: ResearchLink | undefined): Source[] {
    if (link?.transcripts !== 'evidence') return [];
    return Object.values(data.sources ?? {}).filter(src =>
        !!src?.transcript?.trim() && !src.transcriptVerified && isOlderSource(src, link) && !researchReadSource(src, link));
}
