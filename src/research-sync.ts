/**
 * Where a research tree stands with its research (Strom Research 1.12+):
 * in sync, changes the research does not have, sent and waiting in its inbox,
 * a newer version there, the bridge not running, a send refused or discarded.
 * Pure: the UI feeds it what it knows and shows the one state that matters most.
 */

import { ResearchLink, ResearchSend, Source, StromData, Person, PersonId, ResearchConflict } from './types.js';
import { ResearchInbox, LiveIntake, ResearchSendRecord } from './research-link.js';
import { ResearchHeldConflicts, trimHeldConflicts } from './research-device.js';

/**
 * A send the research wrote vouches for its version (that version holds
 * everything the send carried) only when something was written and no
 * conflict was left: then the version may replace the tree without asking.
 * "Nothing written" may mean the research reads the copy's values as removed
 * there (a send taken back since, finding 35); a conflict keeps the research's
 * value in place of the user's (finding 29) — loading those over the tree
 * would drop the user's values without a word.
 */
export function researchSendVouches(sent: ResearchSend | undefined): boolean {
    return !!sent && sent.state === 'written' && sent.changes !== 0 && !((sent.conflicts ?? 0) > 0);
}

export type ResearchSyncKind =
    | 'none' | 'inSync' | 'written' | 'unsent' | 'sentPending' | 'newer' | 'unsentAndNewer' | 'waitThenLoad'
    | 'bridgeDown' | 'unsentBridgeDown' | 'refused' | 'rejected' | 'safari'
    // Another window of this browser saved the tree since this one read it:
    | 'stale'
    // Sending by itself (ResearchLink.sendMode 'auto', the default):
    | 'autoWaiting' | 'sending' | 'autoBridgeDown' | 'autoPaused'
    // One-time notices:
    | 'switched' | 'offerAuto' | 'autoIntro'
    // Written, with conflicts left, and the research's version (their values in those places) not loaded:
    | 'writtenConflicts';

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
    /** Another window saved the tree since this one read it: nothing of it may be sent. */
    stale?: boolean;
    /** Changes go by themselves (sendMode 'auto'). */
    auto?: boolean;
    /** The research is an archive (no agent). */
    archive?: boolean;
    /** A send of this tree is on its way. */
    sending?: boolean;
    /** The quiet time ran out and the bridge was not there to take the changes. */
    autoDue?: boolean;
    /** The last send the research wrote (it outlives loading the new version). */
    written?: { at: string; changes: number | null; conflicts: number } | null;
    /** The research's version, read but not loaded, would take over values where conflicts are open (finding 40). */
    heldConflicts?: boolean;
    /** The research switched between agent and archive since the user last saw it. */
    switched?: boolean;
    /** The one-time offer to send by itself was not answered yet. */
    offerUnseen?: boolean;
    /** "Changes now go by themselves" is due as a block (no toolbar mark at this width). */
    introDue?: boolean;
}

export interface ResearchSyncState {
    kind: ResearchSyncKind;
    /** The state without the one-time notices (what the toolbar mark shows). */
    core: ResearchSyncKind;
    /** The send shown (sentPending / waitThenLoad / rejected / sending). */
    sent?: ResearchSend;
    /** Why the bridge refused (refused / autoPaused). */
    reason?: string;
}

/** The one state to show, by priority (see ZADANI_DEV_archiv-a-automatika 1.2). */
export function researchSyncState(input: ResearchSyncInput): ResearchSyncState {
    const { link } = input;
    if (!link || !input.capable || !input.shown) return { kind: 'none', core: 'none' };
    const notice = (core: ResearchSyncState): ResearchSyncState => {
        if (input.switched) return { ...core, kind: 'switched' };
        return core;
    };
    // Safari never reaches the bridge: nothing goes by itself and nothing can be sent.
    if (input.safari) return notice({ kind: 'safari', core: 'safari' });
    // A stale copy is never sent: before anything else, the reload that brings it up to date.
    if (input.stale) return { kind: 'stale', core: 'stale' };
    const auto = !!input.auto;
    const sent = link.sent;
    const st = (kind: ResearchSyncKind, extra: Partial<ResearchSyncState> = {}): ResearchSyncState =>
        notice({ kind, core: kind, ...extra });
    // What the research does not have: changed since its version and not the state sent.
    const unsent = !input.matchesBase && input.current !== sent?.fingerprint;
    const newer = !!input.remoteHead && !!link.head && input.remoteHead !== link.head;
    // A send the research took back waits for the user before anything else goes: a copy sent now
    // would carry what was taken back and write it there again (finding 43).
    if (sent?.state === 'undone') return st('rejected', { sent });
    if (unsent && newer && input.bridgeUp) return st('unsentAndNewer');
    if (sent?.state === 'discarded') return st('rejected', { sent });
    if (link.refused) return st(auto ? 'autoPaused' : 'refused', { reason: link.refused.reason });
    if (unsent && auto && input.autoDue && !input.bridgeUp && !input.sending) return st('autoBridgeDown');
    if (unsent && !auto) return st(input.bridgeUp ? 'unsent' : 'unsentBridgeDown');
    // The research writing a send (a 202, an archive) is "sending", never "waiting for you".
    if (input.sending || (sent?.state === 'pending' && (sent.writing || input.archive))) return st('sending', sent ? { sent } : {});
    if (unsent) return st('autoWaiting');
    if (sent?.state === 'pending' && sent.thenLoad) return st('waitThenLoad', { sent });
    if (sent?.state === 'pending') return st('sentPending', { sent });
    // Its version holds the research's values where the conflicts are: not "a newer version" to load,
    // the conflicts to decide (finding 40); loading it stays possible, asked.
    // Also after a later send that left none: the version still holds them (finding 40).
    if (newer && ((sent?.state === 'written' && (sent.conflicts ?? 0) > 0) || input.heldConflicts)) return st('writtenConflicts', sent ? { sent } : {});
    if (newer) return st('newer');
    const quiet: ResearchSyncState = !input.bridgeUp
        ? { kind: 'bridgeDown', core: 'bridgeDown' }
        : input.written ? { kind: 'written', core: 'written' } : { kind: 'inSync', core: 'inSync' };
    if (input.switched) return { ...quiet, kind: 'switched' };
    if (input.archive && !auto && input.offerUnseen) return { ...quiet, kind: 'offerAuto' };
    if (auto && input.introDue) return { ...quiet, kind: 'autoIntro' };
    return quiet;
}

/** States that light the dot on ⋯ (the user has something to do). */
export function researchSyncWantsAttention(kind: ResearchSyncKind): boolean {
    return kind === 'unsentBridgeDown' || kind === 'newer' || kind === 'unsentAndNewer'
        || kind === 'refused' || kind === 'rejected' || kind === 'autoPaused' || kind === 'autoBridgeDown'
        || kind === 'switched' || kind === 'stale' || kind === 'writtenConflicts';
}

/** A changes-not-sent state (the ⋯ label and the data window say so). */
export function researchSyncUnsent(kind: ResearchSyncKind): boolean {
    return kind === 'unsent' || kind === 'unsentBridgeDown' || kind === 'unsentAndNewer' || kind === 'autoBridgeDown';
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
    /** Conflicts the write left, still open (null: not said), and whom they are about (research refs). */
    conflicts?: number | null;
    conflictPersons?: string[];
    /** Discarded because the research could not write it (`failed`). */
    failed?: boolean;
    /** Written as a newer send of this tree that replaced this one (not this window's state). */
    inherited?: boolean;
    /** Still pending: the research's tries so far (busy, it tries again by itself); null: none said. */
    tries?: number | null;
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
        let hops = 0;
        // Replaced by a newer send of this tree: that one tells.
        for (let hop = 0; rec?.state === 'replaced' && hop < 5; hop++) {
            hops++;
            const from: ResearchSendRecord = rec;
            rec = status.sends
                .filter(r => ours(r.tree) && r.intake !== from.intake && r.at >= from.at)
                .sort((a, b) => (a.at < b.at ? 1 : -1))[0];
        }
        if (rec) {
            if (rec.state === 'pending' || rec.state === 'replaced') return { ...fate('pending'), tries: rec.tries };
            // Another send of this tree (another window) stands for this one: not our state.
            const inherited = hops > 0 && rec.sent !== sent.fingerprint ? { inherited: true } : {};
            // Taken back afterwards: written first (the undo is noticed on its own, see the UI).
            if (rec.state === 'written' || rec.state === 'undone') {
                return { ...fate('written', rec.decidedAt), conflicts: rec.conflicts, conflictPersons: rec.conflictPersons, ...inherited };
            }
            if (rec.state === 'nothing') return { ...fate('written', rec.decidedAt, '', true), ...inherited };
            if (rec.state === 'failed') return { ...fate('discarded', rec.decidedAt, rec.reason), failed: true };
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

/** The user's values a conflict can be about: the name, sex, birth and death. */
const CONFLICT_FIELDS: (keyof Person)[] = ['firstName', 'lastName', 'gender', 'birthDate', 'birthPlace', 'deathDate', 'deathPlace'];

/**
 * People whose value in the app the research's version would replace while a
 * conflict about them is still open there (finding 37): the version keeps the
 * research's value in that place, the user's stands only in the app. Such a
 * version is never taken without asking. `incoming` carries the app's ids
 * (stabilizeIds). Only values the app has: one the research adds is no
 * takeover.
 */
export function conflictTakeovers(previous: StromData, incoming: StromData): PersonId[] {
    const out: PersonId[] = [];
    for (const p of Object.values(incoming.persons ?? {})) {
        if (!p?.research?.conflicts?.some(c => c.status === 'open')) continue;
        const before = previous.persons?.[p.id];
        if (!before) continue;
        const replaced = CONFLICT_FIELDS.some(f => {
            const had = before[f];
            if (had === undefined || had === null || had === '') return false;
            return JSON.stringify(had) !== JSON.stringify(p[f] ?? null);
        });
        if (replaced) out.push(p.id);
    }
    return out;
}

/**
 * The research's conflicts as a version it did not load has them (finding 40):
 * per person, the research's list where it differs from the tree's (a conflict
 * that took the user's newer value, one decided there, a new one), and whose
 * values that version would take over. `incoming` carries the app's ids.
 */
export function heldConflicts(previous: StromData, incoming: StromData, base: string, head: string): ResearchHeldConflicts {
    const persons: Record<string, ResearchConflict[]> = {};
    for (const p of Object.values(incoming.persons ?? {})) {
        const before = p ? previous.persons?.[p.id] : undefined;
        if (!p || !before) continue;
        const theirs = p.research?.conflicts ?? [];
        const ours = before.research?.conflicts ?? [];
        if (theirs.length === 0 && ours.length === 0) continue;
        if (JSON.stringify(theirs) !== JSON.stringify(ours)) persons[p.id] = theirs;
    }
    return trimHeldConflicts({ base, head, persons, takeovers: conflictTakeovers(previous, incoming) });
}

/**
 * The research leaves out of a copy what a send taken back since its base
 * brought (`takenBack`): edits after an undo may go by themselves. Its bridge
 * says so in `features` (1.12.0-rc.20); without them, by its version
 * (1.12.0-rc.19). An older bridge would write the send taken back again
 * (finding 43), so there nothing goes until the user decides.
 */
export function researchKeepsTakenBack(version: string, features?: readonly string[] | null): boolean {
    if (features) return features.includes('sync.takenBack');
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?/.exec(version.trim());
    if (!m) return false;
    const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const rc = m[4] === undefined ? Infinity : Number(m[4]);
    if (major !== 1) return major > 1;
    if (minor !== 12) return minor > 12;
    if (patch > 0) return true;
    return rc >= 19;
}

/**
 * Which send a reply's `undoneSince` names for "Send again": the latest of
 * them not written again since (`again` in the research's records); the list may name every send taken back after the
 * copy's base, in any order, never simply its last mark (finding B). Marks the
 * status does not list (it keeps only its last sends) count as older and still
 * taken back. Without the research's records, its last mark. '' = none.
 */
export function latestUndone(undoneSince: readonly string[], sends: readonly ResearchSendRecord[] | null | undefined): string {
    if (undoneSince.length === 0) return '';
    if (!sends) return undoneSince[undoneSince.length - 1];
    const rec = (intake: string) => sends.find(r => r.intake === intake);
    // The reply is now; the status may be older than the undo: only a send written again (`again`) is left out.
    const open = undoneSince.filter(x => !rec(x)?.again);
    if (open.length === 0) return '';
    const time = (intake: string): number => {
        const t = Date.parse(rec(intake)?.at ?? '');
        return Number.isFinite(t) ? t : -Infinity;
    };
    if (open.every(x => time(x) === -Infinity)) return open[open.length - 1];
    return open.reduce((best, x) => (time(x) > time(best) ? x : best));
}
