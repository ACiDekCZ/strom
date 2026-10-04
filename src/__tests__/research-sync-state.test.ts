/**
 * Where a research tree stands with its research (src/research-sync.ts), what
 * the bridge says about it (`accepts`, `inbox`), the header lines of a send and
 * the weight of the user's transcripts (`_STROM_VERIFIED`, `_STROM_READ`).
 */

import { describe, it, expect } from 'vitest';
import {
    researchSyncState, researchSyncWantsAttention, pendingSendFate, verifiedOffer, isOlderSource,
    researchReadSource, sourceReadingHash, unverifiedOlderSources, ResearchSyncInput, conflictTakeovers,
    heldConflicts, researchKeepsTakenBack, latestUndone,
} from '../research-sync.js';
import { sanitizeAccepts, sanitizeInbox, sanitizeLiveStatus, researchHeaderLines, stabilizeIds, sanitizeSyncReply } from '../research-link.js';
import { ResearchLink, ResearchSend, Source, StromData, STROM_DATA_VERSION } from '../types.js';
import { exportToGedcom } from '../ged-exporter.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';

const RID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';

function link(extra: Partial<ResearchLink> = {}): ResearchLink {
    return { id: RID, fingerprint: 'base', syncedAt: '2026-10-02T10:00:00Z', head: 'aaaaaaa', ...extra };
}

function sent(extra: Partial<ResearchSend> = {}): ResearchSend {
    return { fingerprint: 'fp-sent', at: '2026-10-02T14:32:00Z', changes: 6, head: 'aaaaaaa', state: 'pending', ...extra };
}

function input(extra: Partial<ResearchSyncInput> = {}): ResearchSyncInput {
    return {
        link: link(), capable: true, shown: true, matchesBase: true, current: 'fp-now',
        bridgeUp: true, safari: false, remoteHead: 'aaaaaaa', ...extra,
    };
}

describe('the state of a research tree', () => {
    it('none: no research, an older research (no accepts), a phone', () => {
        expect(researchSyncState(input({ link: undefined })).kind).toBe('none');
        expect(researchSyncState(input({ capable: false })).kind).toBe('none');
        expect(researchSyncState(input({ shown: false })).kind).toBe('none');
    });

    it('in sync / newer / bridge down', () => {
        expect(researchSyncState(input()).kind).toBe('inSync');
        expect(researchSyncState(input({ remoteHead: 'bbbbbbb' })).kind).toBe('newer');
        expect(researchSyncState(input({ bridgeUp: false })).kind).toBe('bridgeDown');
        // A newer version seen before the bridge went (or got stuck): it cannot be loaded now, only that is said.
        expect(researchSyncState(input({ remoteHead: 'bbbbbbb', bridgeUp: false })).kind).toBe('bridgeDown');
    });

    it('the research\'s own write of this tree\'s send is not "newer"; moving past it is (loaded only when asked)', () => {
        const own = link({ sent: sent({ state: 'written', replyHead: 'ccccccc', ownBase: true }) });
        expect(researchSyncState(input({ link: own, matchesBase: false, current: 'fp-sent', remoteHead: 'ccccccc', ownHead: 'ccccccc' })).kind).toBe('inSync');
        expect(researchSyncState(input({ link: own, matchesBase: false, current: 'fp-sent', remoteHead: 'ddddddd', ownHead: 'ccccccc' })).kind).toBe('newer');
        // Edited since: unsent, not "unsent and newer".
        expect(researchSyncState(input({ link: own, matchesBase: false, current: 'fp-later', remoteHead: 'ccccccc', ownHead: 'ccccccc' })).kind).toBe('unsent');
        // A write that left a conflict: its version holds the research's value there — the conflict, not in sync.
        const conflicted = link({ sent: sent({ state: 'written', replyHead: 'ccccccc', ownBase: true, conflicts: 1 }) });
        expect(researchSyncState(input({ link: conflicted, matchesBase: false, current: 'fp-sent', remoteHead: 'ccccccc', ownHead: 'ccccccc' })).kind).toBe('writtenConflicts');
    });

    it('unsent, with the bridge down, together with a newer version', () => {
        expect(researchSyncState(input({ matchesBase: false })).kind).toBe('unsent');
        expect(researchSyncState(input({ matchesBase: false, bridgeUp: false })).kind).toBe('unsentBridgeDown');
        expect(researchSyncState(input({ matchesBase: false, remoteHead: 'bbbbbbb' })).kind).toBe('unsentAndNewer');
        // The bridge down: nothing to send to — the changes simply wait.
        expect(researchSyncState(input({ matchesBase: false, remoteHead: 'bbbbbbb', bridgeUp: false })).kind).toBe('unsentBridgeDown');
    });

    it('sent and waiting; "send, then load"; edits after the send are unsent again', () => {
        const pending = link({ sent: sent() });
        expect(researchSyncState(input({ link: pending, matchesBase: false, current: 'fp-sent' })).kind).toBe('sentPending');
        const thenLoad = link({ sent: sent({ thenLoad: true }) });
        expect(researchSyncState(input({ link: thenLoad, matchesBase: false, current: 'fp-sent' })).kind).toBe('waitThenLoad');
        expect(researchSyncState(input({ link: pending, matchesBase: false, current: 'fp-edited' })).kind).toBe('unsent');
    });

    it('written: in sync (or the newer version to load)', () => {
        const written = link({ sent: sent({ state: 'written' }) });
        expect(researchSyncState(input({ link: written, matchesBase: false, current: 'fp-sent' })).kind).toBe('inSync');
        expect(researchSyncState(input({ link: written, matchesBase: false, current: 'fp-sent', remoteHead: 'bbbbbbb' })).kind).toBe('newer');
    });

    it('rejected comes before refused, refused before unsent', () => {
        const rejected = link({ sent: sent({ state: 'discarded' }), refused: { reason: 'locked', at: '' } });
        expect(researchSyncState(input({ link: rejected, matchesBase: false, current: 'fp-other' })).kind).toBe('rejected');
        const refused = link({ refused: { reason: 'locked', at: '' } });
        const state = researchSyncState(input({ link: refused, matchesBase: false }));
        expect(state).toEqual({ kind: 'refused', core: 'refused', reason: 'locked' });
    });

    it('Safari: its own block whatever else is true', () => {
        expect(researchSyncState(input({ safari: true, matchesBase: false })).kind).toBe('safari');
    });

    it('a copy another window saved over: the reload before anything else (never a send)', () => {
        expect(researchSyncState(input({ stale: true, matchesBase: false, remoteHead: 'bbbbbbb' })).kind).toBe('stale');
        expect(researchSyncState(input({ stale: true, auto: true, matchesBase: false })).kind).toBe('stale');
        const rejected = link({ sent: sent({ state: 'discarded' }) });
        expect(researchSyncState(input({ stale: true, link: rejected, switched: true })).kind).toBe('stale');
    });

    it('the dot asks for the user only where there is something to do', () => {
        const lit = ['unsentBridgeDown', 'newer', 'unsentAndNewer', 'refused', 'rejected', 'autoPaused', 'autoBridgeDown', 'switched', 'stale'];
        // Sent by hand, "unsent" has the Send button in the toolbar (its ⋯ dot only where the button is not: CSS).
        const quiet = ['unsent', 'inSync', 'written', 'sentPending', 'waitThenLoad', 'bridgeDown', 'safari', 'none',
            'autoWaiting', 'sending', 'offerAuto', 'autoIntro'];
        for (const k of lit) expect(researchSyncWantsAttention(k as never)).toBe(true);
        for (const k of quiet) expect(researchSyncWantsAttention(k as never)).toBe(false);
    });
});

describe('sending by itself, the archive, one-time notices', () => {
    const auto = (extra: Partial<ResearchSyncInput> = {}) => input({ auto: true, matchesBase: false, ...extra });

    it('changes waiting quietly while the quiet time runs, the bridge up or not', () => {
        expect(researchSyncState(auto()).kind).toBe('autoWaiting');
        expect(researchSyncState(auto({ bridgeUp: false })).kind).toBe('autoWaiting');
        // Sent by hand the same tree asks for the Send button.
        expect(researchSyncState(input({ matchesBase: false })).kind).toBe('unsent');
    });

    it('"not running" only once the quiet time ran out without a bridge', () => {
        expect(researchSyncState(auto({ bridgeUp: false, autoDue: true })).kind).toBe('autoBridgeDown');
        // The bridge back: about to go, still quiet.
        expect(researchSyncState(auto({ bridgeUp: true, autoDue: true })).kind).toBe('autoWaiting');
    });

    it('sending; a send the research is still writing (202) or an archive is never "waiting for you"', () => {
        expect(researchSyncState(auto({ sending: true })).kind).toBe('sending');
        const writing = link({ sent: sent({ writing: true }) });
        expect(researchSyncState(input({ auto: true, link: writing, matchesBase: false, current: 'fp-sent' })).kind).toBe('sending');
        const pending = link({ sent: sent() });
        expect(researchSyncState(input({ auto: true, archive: true, link: pending, matchesBase: false, current: 'fp-sent' })).kind).toBe('sending');
        expect(researchSyncState(input({ auto: true, link: pending, matchesBase: false, current: 'fp-sent' })).kind).toBe('sentPending');
        // Sent by hand, the Send button shows the send (unsent stays the state).
        expect(researchSyncState(input({ matchesBase: false, sending: true })).kind).toBe('unsent');
    });

    it('written: the last write, after the new version loaded too', () => {
        const w = { at: '2026-10-02T14:32:00Z', changes: 6, conflicts: 0 };
        expect(researchSyncState(input({ auto: true, written: w })).kind).toBe('written');
        expect(researchSyncState(input({ auto: true, written: w, bridgeUp: false })).kind).toBe('bridgeDown');
        expect(researchSyncState(input({ auto: true })).kind).toBe('inSync');
    });

    it('a written send taken back in the research: its own warning, unchanged it is not sent again', () => {
        const undone = link({ fingerprint: '', sent: sent({ state: 'undone' }) });
        expect(researchSyncState(input({ auto: true, link: undone, matchesBase: false, current: 'fp-sent' })).kind).toBe('rejected');
        // Edited since: still waits for the user (a copy would write the send taken back again, finding 43),
        // the research's version newer or not.
        expect(researchSyncState(input({ auto: true, link: undone, matchesBase: false, current: 'fp-edited' })).kind).toBe('rejected');
        expect(researchSyncState(input({ auto: true, link: undone, matchesBase: false, current: 'fp-edited', remoteHead: 'bbbbbbb' })).kind).toBe('rejected');
        expect(researchSyncState(input({ link: undone, matchesBase: false, current: 'fp-edited', remoteHead: 'bbbbbbb' })).kind).toBe('rejected');
        expect(researchSyncWantsAttention('rejected')).toBe(true);
    });

    it('refused by itself: paused until sent again; discarded: unchanged it stays discarded', () => {
        const refused = link({ refused: { reason: 'locked', at: '' } });
        expect(researchSyncState(auto({ link: refused }))).toEqual({ kind: 'autoPaused', core: 'autoPaused', reason: 'locked' });
        const discarded = link({ sent: sent({ state: 'discarded' }) });
        expect(researchSyncState(input({ auto: true, link: discarded, matchesBase: false, current: 'fp-sent' })).kind).toBe('rejected');
    });

    it('a switch of mode is said beside a state of the sends (never in its place); alone, it is the block', () => {
        const st = researchSyncState(auto({ remoteHead: 'bbbbbbb', switched: true }));
        expect(st.kind).toBe('unsentAndNewer');
        expect(st.switchedNote).toBe(true);
        const undone = link({ fingerprint: '', sent: sent({ state: 'undone' }) });
        expect(researchSyncState(input({ auto: true, link: undone, matchesBase: false, current: 'fp-edited', switched: true })).kind).toBe('rejected');
        expect(researchSyncState(input({ switched: true })).kind).toBe('switched');
    });

    it('the offer to send by itself: due after a few sends by hand, until answered; never when sending by itself or not at all', () => {
        expect(researchSyncState(input({ offerDue: true })).kind).toBe('offerAuto');
        expect(researchSyncState(input({ archive: true, offerDue: true })).kind).toBe('offerAuto');
        expect(researchSyncState(input({ offerDue: false })).kind).toBe('inSync');
        expect(researchSyncState(input({ auto: true, offerDue: true })).kind).toBe('inSync');
        // Only loading: never offered; the quiet "not sent" line stands in the place of the state (the toolbar keeps in sync).
        expect(researchSyncState(input({ sendOff: true, offerDue: true }))).toMatchObject({ kind: 'off', core: 'inSync' });
        // Something to do comes first.
        expect(researchSyncState(input({ offerDue: true, remoteHead: 'bbbbbbb' })).kind).toBe('newer');
    });

    it('data protection over the state of the sends: not written, piled up, loaded, only loading — the toolbar keeps its state', () => {
        const written = link({ sent: sent({ state: 'written' }) });
        // Not written: before unsent and newer, until the next send; not over a send on its way or a stale copy.
        expect(researchSyncState(input({ link: written, notWritten: true }))).toMatchObject({ kind: 'notWritten', core: 'inSync' });
        expect(researchSyncState(input({ link: written, notWritten: true, matchesBase: false, current: 'fp-new' }))).toMatchObject({ kind: 'notWritten', core: 'unsent' });
        expect(researchSyncState(input({ link: written, notWritten: true, remoteHead: 'bbbbbbb' })).kind).toBe('notWritten');
        expect(researchSyncState(input({ link: written, notWritten: true, sending: true })).kind).toBe('sending');
        expect(researchSyncState(input({ link: written, notWritten: true, stale: true })).kind).toBe('stale');
        expect(researchSyncState(input({ notWritten: true })).kind).toBe('inSync');
        // Piled up out of only loading: in place of "not sent", the toolbar still has its Send.
        expect(researchSyncState(input({ piled: true, matchesBase: false, current: 'fp-new' }))).toMatchObject({ kind: 'piled', core: 'unsent' });
        expect(researchSyncState(input({ piled: true })).kind).toBe('inSync');
        // Loaded within the hour: over in sync and the offer, never over something to do.
        expect(researchSyncState(input({ loaded: true })).kind).toBe('loaded');
        expect(researchSyncState(input({ loaded: true, offerDue: true })).kind).toBe('loaded');
        expect(researchSyncState(input({ loaded: true, remoteHead: 'bbbbbbb' })).kind).toBe('newer');
        // Only loading: a real state of the research outranks the quiet line.
        expect(researchSyncState(input({ sendOff: true, remoteHead: 'bbbbbbb' })).kind).toBe('newer');
        expect(researchSyncState(input({ sendOff: true, matchesBase: false, current: 'fp-new' })).kind).toBe('off');
    });

    it('the first start of sending by itself as a block (no toolbar mark at this width)', () => {
        const st = researchSyncState(input({ auto: true, introDue: true }));
        expect(st.kind).toBe('autoIntro');
        expect(st.core).toBe('inSync');
        expect(researchSyncState(input({ introDue: true })).kind).toBe('inSync');
        expect(researchSyncState(auto({ introDue: true })).kind).toBe('autoWaiting');
    });
});

describe('what became of a send', () => {
    const inbox = (sentFp: string, tree = 'tree_1') => ({ trees: [{ tree, at: '', changes: 6, sent: sentFp }], material: 0 });
    const state = (f: ReturnType<typeof pendingSendFate>) => f?.state ?? null;

    it('its own record in sends: pending / written / discarded with the user\'s words / nothing new', () => {
        const rec = (extra: Record<string, unknown>) => ({ intake: 'R1', at: '2026-10-02T14:32:05Z', changes: 6, tree: 'tree_1', sent: 'fp-sent', decidedAt: '', reason: '', state: 'pending', ...extra });
        const s = sent({ intake: 'R1' });
        const ask = (sends: unknown[]) => pendingSendFate(s, 'tree_1', RID, { inbox: null, head: 'aaaaaaa', lastIntake: null, sends: sends as never });
        expect(state(ask([rec({})]))).toBe('pending');
        expect(ask([rec({ state: 'written', decidedAt: '2026-10-02T15:00:00Z' })])).toEqual({ state: 'written', at: '2026-10-02T15:00:00Z', reason: '', nothing: false });
        expect(ask([rec({ state: 'discarded', decidedAt: '2026-10-02T15:10:00Z', reason: 'zkouška' })]))
            .toEqual({ state: 'discarded', at: '2026-10-02T15:10:00Z', reason: 'zkouška', nothing: false });
        expect(ask([rec({ state: 'nothing' })])?.nothing).toBe(true);
        // Replaced by a newer send of this tree: that one tells.
        expect(state(ask([rec({ state: 'replaced' }), rec({ intake: 'R2', at: '2026-10-02T14:40:00Z', state: 'written' })]))).toBe('written');
        // Written with conflicts still open; taken back afterwards still counts as written here (the undo is noticed on its own).
        const withConflicts = ask([rec({ state: 'written', conflicts: 1, conflictPersons: ['P0012'] })]);
        expect(withConflicts).toMatchObject({ state: 'written', conflicts: 1, conflictPersons: ['P0012'] });
        expect(state(ask([rec({ state: 'undone', decidedAt: '2026-10-03T09:00:00Z' })]))).toBe('written');
        // Not in the list (older than it keeps): the inbox decides, as before.
        expect(ask([rec({ intake: 'R9' })])).toBeNull();
    });

    it('several windows: a write inherited through "replaced", a send the research could not write, its tries', () => {
        const rec = (extra: Record<string, unknown>) => ({ intake: 'R1', at: '2026-10-02T14:32:05Z', changes: 6, tree: 'tree_1', sent: 'fp-sent', decidedAt: '', reason: '', state: 'pending', ...extra });
        const s = sent({ intake: 'R1' });
        const ask = (sends: unknown[]) => pendingSendFate(s, 'tree_1', RID, { inbox: null, head: 'aaaaaaa', lastIntake: null, sends: sends as never });
        // Replaced by another window's send of the same app tree (another state): written, but not ours.
        expect(ask([rec({ state: 'replaced' }), rec({ intake: 'R2', at: '2026-10-02T14:40:00Z', state: 'written', sent: 'fp-other' })]))
            .toMatchObject({ state: 'written', inherited: true });
        // The newer send carried the same state (this window sent it again): ours.
        expect(ask([rec({ state: 'replaced' }), rec({ intake: 'R2', at: '2026-10-02T14:40:00Z', state: 'written' })])?.inherited).toBeUndefined();
        // Written as it was: never inherited.
        expect(ask([rec({ state: 'written' })])?.inherited).toBeUndefined();
        // Failed: closed like a discard, with the research's reason, and said to be a failure.
        expect(ask([rec({ state: 'failed', reason: 'disk full', decidedAt: '2026-10-03T09:00:00Z' })]))
            .toMatchObject({ state: 'discarded', reason: 'disk full', failed: true });
        // Pending with tries: the research tries again by itself; without: maybe stuck.
        expect(ask([rec({ tries: 2 })])).toMatchObject({ state: 'pending', tries: 2 });
        expect(ask([rec({})])?.tries ?? null).toBeNull();
    });

    it('still in the inbox (named by the app tree, or by the research for an unnamed send)', () => {
        expect(state(pendingSendFate(sent(), 'tree_1', RID, { inbox: inbox('fp-sent'), head: 'aaaaaaa', lastIntake: null }))).toBe('pending');
        expect(state(pendingSendFate(sent(), 'tree_1', RID, { inbox: inbox('fp-sent', RID), head: 'aaaaaaa', lastIntake: null }))).toBe('pending');
        // Another copy's send with the same fingerprint is not ours.
        expect(state(pendingSendFate(sent(), 'tree_1', RID, { inbox: inbox('fp-sent', 'tree_2'), head: 'aaaaaaa', lastIntake: null }))).toBe('discarded');
    });

    it('written: an intake as new as the send; discarded: gone without one', () => {
        const empty = { trees: [], material: 0 };
        expect(state(pendingSendFate(sent(), 'tree_1', RID, { inbox: empty, head: 'bbbbbbb', lastIntake: { id: 'I0042', at: '2026-10-02T14:40:00Z' } }))).toBe('written');
        expect(state(pendingSendFate(sent(), 'tree_1', RID, { inbox: empty, head: 'aaaaaaa', lastIntake: { id: 'I0041', at: '2026-10-01T09:00:00Z' } }))).toBe('discarded');
        expect(state(pendingSendFate(sent(), 'tree_1', RID, { inbox: empty, head: 'aaaaaaa', lastIntake: null }))).toBe('discarded');
    });

    it('an older research without an inbox: unknown', () => {
        expect(pendingSendFate(sent(), 'tree_1', RID, { inbox: null, head: 'bbbbbbb', lastIntake: null })).toBeNull();
    });
});

describe('what the bridge says', () => {
    it('accepts: the gate the other way round; null from an older research', () => {
        expect(sanitizeAccepts(undefined)).toBeNull();
        expect(sanitizeAccepts({ sync: { auto: 'additions' }, sources: true, verified: true, media: null }))
            .toEqual({ syncAuto: 'additions', sources: true, verified: true, media: false, mediaMaxBytes: null, mediaRegion: false, mediaTypes: null, mediaBatch: null, mediaEstimate: null, mode: 'agent', review: false });
        expect(sanitizeAccepts({ sync: { auto: 'everything' }, sources: 'yes' }))
            .toEqual({ syncAuto: 'off', sources: false, verified: false, media: false, mediaMaxBytes: null, mediaRegion: false, mediaTypes: null, mediaBatch: null, mediaEstimate: null, mode: 'agent', review: true });
    });

    it('accepts: how a send is written and the mode (Strom Research with the immediate write)', () => {
        expect(sanitizeAccepts({ mode: 'research', sync: { auto: 'write' } })).toMatchObject({ syncAuto: 'write', mode: 'agent', review: false });
        expect(sanitizeAccepts({ mode: 'archive', sync: { auto: 'mirror' } })).toMatchObject({ syncAuto: 'mirror', mode: 'archive', review: false });
        // "off": every send waits in the inbox (sync.review on, and every research before the immediate write).
        expect(sanitizeAccepts({ mode: 'research', sync: { auto: 'off' } })).toMatchObject({ mode: 'agent', review: true });
        expect(sanitizeAccepts({ mode: 'robot' })?.mode).toBe('agent');
    });

    it('inbox: clean entries only', () => {
        const inbox = sanitizeInbox({
            trees: [
                { tree: 'tree_1700000000000_ab12c', at: '2026-10-02T14:32:05Z', changes: 6, sent: 'v2-1k3f-abc-def' },
                { tree: '<script>', at: 'x', changes: -1, sent: 'bad value!' },
                { tree: RID, at: 'nope', changes: 'many' },
            ],
            material: 2,
        });
        expect(inbox?.trees).toEqual([
            { tree: 'tree_1700000000000_ab12c', at: '2026-10-02T14:32:05Z', changes: 6, sent: 'v2-1k3f-abc-def' },
            { tree: RID, at: '', changes: null, sent: '' },
        ]);
        expect(inbox?.material).toBe(2);
        expect(sanitizeInbox('x')).toBeNull();
    });

    it('sends: known states only, the reason as plain text', () => {
        const sends = sanitizeLiveStatus({ tree: RID, sends: [
            { intake: 'R20261002143205123-a1b2', at: '2026-10-02T14:32:05Z', state: 'discarded', changes: 6, tree: 'tree_1', sent: 'v2-x', decidedAt: '2026-10-02T15:10:00Z', reason: 'zkouška\u0000' },
            { intake: 'R3', state: 'written', conflicts: [{ id: 'X0003', person: 'P0012', fact: 'BIRT' }, { id: 'X0004', family: 'F0007', person: 'P0013' }] },
            { intake: 'R4', state: 'undone', decidedAt: '2026-10-03T09:00:00Z' },
            { intake: 'R2', state: 'exploded' },
            { intake: 'bad mark', state: 'written' },
        ] })?.sends;
        expect(sends).toEqual([{ intake: 'R20261002143205123-a1b2', at: '2026-10-02T14:32:05Z', state: 'discarded', changes: 6, tries: null,
            tree: 'tree_1', sent: 'v2-x', decidedAt: '2026-10-02T15:10:00Z', reason: 'zkouška', conflicts: null, conflictPersons: [] },
            { intake: 'R3', at: '', state: 'written', changes: null, tries: null, tree: '', sent: '', decidedAt: '', reason: '', conflicts: 2, conflictPersons: ['P0012', 'P0013'] },
            { intake: 'R4', at: '', state: 'undone', changes: null, tries: null, tree: '', sent: '', decidedAt: '2026-10-03T09:00:00Z', reason: '', conflicts: null, conflictPersons: [] }]);
        expect(sanitizeLiveStatus({ tree: RID })?.sends).toBeNull();
    });

    it('the status carries both; an older status has neither', () => {
        expect(sanitizeLiveStatus({ tree: RID })?.accepts).toBeNull();
        const status = sanitizeLiveStatus({ tree: RID, accepts: { sources: true }, inbox: { trees: [] } });
        expect(status?.accepts?.sources).toBe(true);
        expect(status?.inbox).toEqual({ trees: [], material: 0 });
    });
});

describe('the header of a send', () => {
    it('names the app tree, the transcripts and the state sent', () => {
        const lines = researchHeaderLines({ id: RID, head: 'aaaaaaa', appTree: 'tree_1700000000000_ab12c', transcripts: 'evidence', sent: 'v2-1k3f-abc-def' });
        expect(lines).toEqual([
            `1 _STROM_TREE ${RID}`, '1 _STROM_HEAD aaaaaaa', '1 _STROM_APP_TREE tree_1700000000000_ab12c',
            '1 _STROM_TRANSCRIPTS evidence', '1 _STROM_SENT v2-1k3f-abc-def', '1 _STROM_SEX_U Y',
        ]);
    });

    it('leaves out what does not fit the research\'s rules', () => {
        const lines = researchHeaderLines({ id: RID, appTree: 'tree with spaces', sent: 'x'.repeat(65) });
        expect(lines).toEqual([`1 _STROM_TREE ${RID}`, '1 _STROM_SEX_U Y']);
    });
});

describe('lead or evidence: the user\'s transcripts', () => {
    const src = (extra: Partial<Source> = {}): Source => ({ id: 's1', title: 'Křestní matrika Čáslav', transcript: 'Anna, dcera Josefa', reference: 'fol. 112', ...extra });

    it('lead: the checkbox for every source of the user\'s with a transcript', () => {
        expect(verifiedOffer(src(), link(), true)).toBe('checkbox');
        expect(verifiedOffer(src({ transcript: '' }), link(), true)).toBe('none');
        expect(verifiedOffer(src(), link(), false)).toBe('none');
        expect(verifiedOffer(src(), undefined, true)).toBe('none');
    });

    it('evidence: older sources keep the checkbox until they change; new ones are covered by the tree', () => {
        const older = { s1: sourceReadingHash(src()) };
        const l = link({ transcripts: 'evidence', olderSources: older });
        expect(isOlderSource(src(), l)).toBe(true);
        expect(verifiedOffer(src(), l, true)).toBe('checkbox');
        expect(verifiedOffer(src({ transcript: 'Anna, dcera Josefa Víška' }), l, true)).toBe('byTree');
        expect(verifiedOffer(src({ id: 's2' }), l, true)).toBe('byTree');
        // Already ticked: shown (it can be unticked).
        expect(verifiedOffer(src({ id: 's2', transcriptVerified: true }), l, true)).toBe('checkbox');
    });

    it('the research\'s own reading: no checkbox', () => {
        expect(researchReadSource(src({ readBy: 'research' }), link())).toBe(true);
        expect(researchReadSource(src({ readBy: 'user', refn: 'S0042' }), link())).toBe(false);
        expect(researchReadSource(src({ refn: 'S0042' }), link())).toBe(true);
        // Numbered by the research but sent from here: the user's reading.
        expect(researchReadSource(src({ refn: 'S0042' }), link({ sentSources: { s1: 'x' } }))).toBe(false);
        expect(verifiedOffer(src({ readBy: 'both' }), link(), true)).toBe('none');
    });

    it('the older unverified sources the dialog links to', () => {
        const data = { version: STROM_DATA_VERSION, persons: {}, partnerships: {}, sources: {
            s1: src(), s2: src({ id: 's2', transcriptVerified: true }), s3: src({ id: 's3' }),
        } } as unknown as StromData;
        const l = link({ transcripts: 'evidence', olderSources: { s1: sourceReadingHash(src()), s2: sourceReadingHash(src({ id: 's2' })) } });
        expect(unverifiedOlderSources(data, l).map(s => s.id)).toEqual(['s1']);
        expect(unverifiedOlderSources(data, link())).toEqual([]);
    });
});

describe('GEDCOM: _STROM_VERIFIED and _STROM_READ', () => {
    const data = (extra: Partial<Source>): StromData => ({
        version: STROM_DATA_VERSION, persons: {}, partnerships: {},
        sources: { s1: { id: 's1', title: 'Křestní matrika Čáslav', transcript: 'Anna, dcera Josefa', ...extra } },
    } as unknown as StromData);

    it('a verified transcript goes out and comes back', () => {
        const ged = exportToGedcom(data({ transcriptVerified: true }), 'T').content;
        expect(ged).toMatch(/1 TEXT Anna, dcera Josefa\r?\n1 _STROM_VERIFIED Y/);
        const back = Object.values(convertToStrom(parseGedcom(ged)).data.sources ?? {})[0];
        expect(back.transcriptVerified).toBe(true);
    });

    it('no transcript, nothing verified', () => {
        const ged = exportToGedcom(data({ transcript: undefined, transcriptVerified: true }), 'T').content;
        expect(ged).not.toContain('_STROM_VERIFIED');
    });

    it('who read the entry, from a research file (only the three values)', () => {
        const ged = (who: string) => ['0 HEAD', '1 CHAR UTF-8', '0 @S1@ SOUR', '1 TITL Oddací matrika', '1 TEXT znění', `1 _STROM_READ ${who}`, '0 TRLR'].join('\n');
        const readBy = (who: string) => Object.values(convertToStrom(parseGedcom(ged(who))).data.sources ?? {})[0].readBy;
        expect(readBy('both')).toBe('both');
        expect(readBy('research')).toBe('research');
        expect(readBy('somebody')).toBeUndefined();
    });
});

describe('an entry made in the app comes back with the research\'s number', () => {
    it('keeps its id (title, archive, page and wording match)', () => {
        const previous = { version: STROM_DATA_VERSION, persons: {}, partnerships: {},
            sources: { s_app: { id: 's_app', title: 'Matrika', reference: 'fol. 3', transcript: 'Jan' } } } as unknown as StromData;
        const next = { version: STROM_DATA_VERSION, persons: {}, partnerships: {},
            sources: { s_new: { id: 's_new', title: 'Matrika', reference: 'fol. 3', transcript: 'Jan', refn: 'S0042' } } } as unknown as StromData;
        const stable = stabilizeIds(next, previous);
        expect(Object.keys(stable.sources ?? {})).toEqual(['s_app']);
        expect(stable.sources?.s_app.refn).toBe('S0042');
    });
});

describe('a write that left conflicts (finding 40)', () => {
    it('its version newer: the conflicts to decide, not "a newer version"; it wants attention', () => {
        const st = researchSyncState(input({ link: link({ sent: sent({ state: 'written', conflicts: 1 }) }), remoteHead: 'bbbbbbb' }));
        expect(st.kind).toBe('writtenConflicts');
        expect(researchSyncWantsAttention(st.kind)).toBe(true);
    });
    it('without conflicts: newer as before', () => {
        expect(researchSyncState(input({ link: link({ sent: sent({ state: 'written' }) }), remoteHead: 'bbbbbbb' })).kind).toBe('newer');
    });
});

describe('the bridge says its mode (or not)', () => {
    it('modeSaid only when the bridge names a mode', () => {
        expect(sanitizeAccepts({ mode: 'archive' })).toMatchObject({ mode: 'archive', modeSaid: true });
        expect(sanitizeAccepts({ mode: 'research' })).toMatchObject({ mode: 'agent', modeSaid: true });
        expect(sanitizeAccepts({ sources: true })?.modeSaid).toBeUndefined();
    });
});

describe('conflictTakeovers (finding 37)', () => {
    const person = (id: string, first: string, extra: Record<string, unknown> = {}) =>
        ({ id, firstName: first, lastName: 'Nováková', gender: 'female', partnerships: [], childIds: [], ...extra });
    const tree = (persons: Record<string, unknown>) => ({ version: STROM_DATA_VERSION, persons, partnerships: {} }) as unknown as StromData;
    const open = { research: { conflicts: [{ id: 'X0001', fact: 'NAME', status: 'open', values: [{ value: 'Marie' }, { value: 'Marianna' }] }] } };
    it('an open conflict over a value the user has: taken over', () => {
        expect(conflictTakeovers(tree({ p1: person('p1', 'Marianna') }), tree({ p1: person('p1', 'Marie', open) }))).toEqual(['p1']);
    });
    it('the same value, a value the research adds, or the conflict decided: none', () => {
        expect(conflictTakeovers(tree({ p1: person('p1', 'Marianna') }), tree({ p1: person('p1', 'Marianna', open) }))).toEqual([]);
        expect(conflictTakeovers(tree({ p1: person('p1', 'Marianna') }), tree({ p1: person('p1', 'Marianna', { ...open, birthDate: '1880' }) }))).toEqual([]);
        const decided = { research: { conflicts: [{ ...open.research.conflicts[0], status: 'decided' }] } };
        expect(conflictTakeovers(tree({ p1: person('p1', 'Marianna') }), tree({ p1: person('p1', 'Marie', decided) }))).toEqual([]);
    });
    it('no conflict there: the research may change it (written as sent)', () => {
        expect(conflictTakeovers(tree({ p1: person('p1', 'Marianna') }), tree({ p1: person('p1', 'Marie') }))).toEqual([]);
    });
});

describe('the research\'s conflicts from a version not loaded (finding 40)', () => {
    const person = (id: string, first: string, extra: Record<string, unknown> = {}) =>
        ({ id, firstName: first, lastName: 'Nováková', gender: 'female', partnerships: [], childIds: [], ...extra });
    const tree = (persons: Record<string, unknown>) => ({ version: STROM_DATA_VERSION, persons, partnerships: {} }) as unknown as StromData;
    const conflict = (user: string) => ({ research: { conflicts: [{ id: 'X0001', fact: 'NAME', status: 'open', values: [{ value: 'Marie' }, { value: user }] }] } });

    it('the conflict with the user\'s newer value is read, and whose values that version would take over', () => {
        const app = tree({ p1: person('p1', 'Marietta', conflict('Marianna')), p2: person('p2', 'Jan') });
        const research = tree({ p1: person('p1', 'Marie', conflict('Marietta')), p2: person('p2', 'Jan') });
        const held = heldConflicts(app, research, 'c1c1', 'c2c2');
        expect(held).toMatchObject({ base: 'c1c1', head: 'c2c2', takeovers: ['p1'] });
        expect(held.persons.p1[0].values.map(v => v.value)).toEqual(['Marie', 'Marietta']);
        expect(held.persons.p2).toBeUndefined();
    });

    it('the same conflicts as the tree has: nothing kept; one decided there: kept', () => {
        const same = tree({ p1: person('p1', 'Marie', conflict('Marianna')) });
        expect(heldConflicts(same, same, 'a', 'b')).toMatchObject({ persons: {}, takeovers: [] });
        const decided = tree({ p1: person('p1', 'Marie', { research: { conflicts: [{ ...conflict('Marianna').research.conflicts[0], status: 'decided' }] } }) });
        expect(heldConflicts(same, decided, 'a', 'b').persons.p1[0].status).toBe('decided');
    });

    it('a later send without a conflict: the written conflict stays the state while that version holds it', () => {
        const written = link({ sent: sent({ state: 'written', closedAt: '2026-10-02T14:33:00Z', conflicts: 0 }) });
        const base = { link: written, matchesBase: false, current: 'fp-sent', remoteHead: 'bbbbbbb' };
        expect(researchSyncState(input(base)).kind).toBe('newer');
        expect(researchSyncState(input({ ...base, heldConflicts: true })).kind).toBe('writtenConflicts');
    });
});

describe('a research that leaves out what a send taken back brought (finding 43)', () => {
    it('Strom Research 1.12.0-rc.19 and later', () => {
        expect(researchKeepsTakenBack('1.12.0-rc.18')).toBe(false);
        expect(researchKeepsTakenBack('1.12.0-rc.19')).toBe(true);
        expect(researchKeepsTakenBack('1.12.0')).toBe(true);
        expect(researchKeepsTakenBack('1.12.1')).toBe(true);
        expect(researchKeepsTakenBack('1.13.0-rc.1')).toBe(true);
        expect(researchKeepsTakenBack('1.11.4')).toBe(false);
        expect(researchKeepsTakenBack('')).toBe(false);
    });
    it('by the bridge\'s features first (rc.20), its version only without them', () => {
        expect(researchKeepsTakenBack('1.12.0-rc.18', ['sync.again', 'sync.takenBack'])).toBe(true);
        expect(researchKeepsTakenBack('1.12.0', ['sync.again'])).toBe(false);
        expect(researchKeepsTakenBack('1.12.0-rc.19', null)).toBe(true);
        expect(sanitizeLiveStatus({ tree: { id: RID }, features: ['sync.again', 'sync.takenBack', 42, '<x>'] })?.features).toEqual(['sync.again', 'sync.takenBack']);
        expect(sanitizeLiveStatus({ tree: { id: RID } })?.features).toBeNull();
    });
    it('the reply says how many changes it left out', () => {
        expect(sanitizeSyncReply({ ok: true, takenBack: 2, undoneSince: ['R1'] })).toMatchObject({ takenBack: 2, undoneSince: ['R1'] });
        expect(sanitizeSyncReply({ ok: true }).takenBack).toBeNull();
    });
});

describe('the send taken back a reply names (finding B)', () => {
    const rec = (intake: string, at: string, state: string) => ({ intake, at, state, changes: 1, tries: null, tree: '', sent: '', decidedAt: '', reason: '', conflicts: null, conflictPersons: [] }) as never;
    it('the latest by the research\'s records, whatever the order; marks it does not list count as older', () => {
        const sends = [rec('R1', '2026-10-04T05:50:00Z', 'undone'), rec('R2', '2026-10-04T05:55:00Z', 'undone'), rec('R3', '2026-10-04T05:57:00Z', 'undone')];
        expect(latestUndone(['R3', 'R1', 'R2'], sends)).toBe('R3');
        expect(latestUndone(['R2', 'R1'], sends)).toBe('R2');
        expect(latestUndone(['R9', 'R1'], sends)).toBe('R1');
        expect(latestUndone(['R8', 'R9'], sends)).toBe('R9');
        expect(latestUndone(['R1', 'R2'], null)).toBe('R2');
        expect(latestUndone([], sends)).toBe('');
    });
    it('a send written again since (`again`) is not taken back any more', () => {
        const sends = [rec('R1', '2026-10-04T05:50:00Z', 'undone'), { ...(rec('R2', '2026-10-04T05:55:00Z', 'undone') as object), again: 'R4' } as never];
        expect(latestUndone(['R1', 'R2'], sends)).toBe('R1');
        expect(latestUndone(['R2'], sends)).toBe('');
        expect(sanitizeLiveStatus({ tree: { id: RID }, sends: [{ intake: 'R2', state: 'undone', again: 'R4' }] })?.sends?.[0].again).toBe('R4');
        expect(sanitizeLiveStatus({ tree: { id: RID }, sends: [{ intake: 'R2', state: 'undone', resent: true }] })?.sends?.[0].again).toBe('yes');
    });
});

describe('the numbers a send got (ids, rc.26)', () => {
    it('kept on people and sources without a number, never over one; the answer read', async () => {
        const { applySyncIds, sanitizeSyncReply } = await import('../research-link.js');
        const data = { version: STROM_DATA_VERSION, persons: {
            a: { id: 'a', firstName: 'Petr', lastName: 'V', gender: 'male', partnerships: [], parentIds: [], childIds: [] },
            b: { id: 'b', firstName: 'Jan', lastName: 'V', gender: 'male', refn: 'P0003', partnerships: [], parentIds: [], childIds: [] },
        }, partnerships: {}, sources: { s: { id: 's', title: 'Matrika' } } } as unknown as StromData;
        const xrefs = { persons: new Map([['a', '@I1@'], ['b', '@I2@']]), sources: new Map([['s', '@S1@']]) };
        const reply = sanitizeSyncReply({ ok: true, ids: { persons: { '@I1@': 'P0099', '@I2@': 'P0100', '@bad': 'P1' }, sources: { '@S1@': 'S0007' } } });
        const out = applySyncIds(data, xrefs, reply.ids!);
        expect(out.changed).toBe(2);
        expect(out.data.persons['a' as never].refn).toBe('P0099');
        expect(out.data.persons['b' as never].refn).toBe('P0003');
        expect(out.data.sources!.s.refn).toBe('S0007');
        expect(applySyncIds(out.data, xrefs, reply.ids!).changed).toBe(0);
    });
});
