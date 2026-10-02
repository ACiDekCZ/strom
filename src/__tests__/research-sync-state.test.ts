/**
 * Where a research tree stands with its research (src/research-sync.ts), what
 * the bridge says about it (`accepts`, `inbox`), the header lines of a send and
 * the weight of the user's transcripts (`_STROM_VERIFIED`, `_STROM_READ`).
 */

import { describe, it, expect } from 'vitest';
import {
    researchSyncState, researchSyncWantsAttention, pendingSendFate, verifiedOffer, isOlderSource,
    researchReadSource, sourceReadingHash, unverifiedOlderSources, ResearchSyncInput,
} from '../research-sync.js';
import { sanitizeAccepts, sanitizeInbox, sanitizeLiveStatus, researchHeaderLines, stabilizeIds } from '../research-link.js';
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

    it('the dot asks for the user only where there is something to do', () => {
        const lit = ['unsentBridgeDown', 'newer', 'unsentAndNewer', 'refused', 'rejected', 'autoPaused', 'autoBridgeDown', 'switched'];
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

    it('refused by itself: paused until sent again; discarded: unchanged it stays discarded', () => {
        const refused = link({ refused: { reason: 'locked', at: '' } });
        expect(researchSyncState(auto({ link: refused }))).toEqual({ kind: 'autoPaused', core: 'autoPaused', reason: 'locked' });
        const discarded = link({ sent: sent({ state: 'discarded' }) });
        expect(researchSyncState(input({ auto: true, link: discarded, matchesBase: false, current: 'fp-sent' })).kind).toBe('rejected');
    });

    it('a switch of mode comes first, the toolbar keeps the real state', () => {
        const st = researchSyncState(auto({ remoteHead: 'bbbbbbb', switched: true }));
        expect(st.kind).toBe('switched');
        expect(st.core).toBe('unsentAndNewer');
        expect(researchSyncState(input({ switched: true })).kind).toBe('switched');
    });

    it('the offer to send by itself: an archive sent by hand, until answered', () => {
        expect(researchSyncState(input({ archive: true, offerUnseen: true })).kind).toBe('offerAuto');
        expect(researchSyncState(input({ archive: true, offerUnseen: false })).kind).toBe('inSync');
        expect(researchSyncState(input({ archive: true, auto: true, offerUnseen: true })).kind).toBe('inSync');
        expect(researchSyncState(input({ offerUnseen: true })).kind).toBe('inSync');
        // Something to do comes first.
        expect(researchSyncState(input({ archive: true, offerUnseen: true, remoteHead: 'bbbbbbb' })).kind).toBe('newer');
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
        // Not in the list (older than it keeps): the inbox decides, as before.
        expect(ask([rec({ intake: 'R9' })])).toBeNull();
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
            .toEqual({ syncAuto: 'additions', sources: true, verified: true, media: false, mode: 'agent', review: false });
        expect(sanitizeAccepts({ sync: { auto: 'everything' }, sources: 'yes' }))
            .toEqual({ syncAuto: 'off', sources: false, verified: false, media: false, mode: 'agent', review: true });
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
            { intake: 'R2', state: 'exploded' },
            { intake: 'bad mark', state: 'written' },
        ] })?.sends;
        expect(sends).toEqual([{ intake: 'R20261002143205123-a1b2', at: '2026-10-02T14:32:05Z', state: 'discarded', changes: 6,
            tree: 'tree_1', sent: 'v2-x', decidedAt: '2026-10-02T15:10:00Z', reason: 'zkouška', conflicts: null }]);
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
            '1 _STROM_TRANSCRIPTS evidence', '1 _STROM_SENT v2-1k3f-abc-def',
        ]);
    });

    it('leaves out what does not fit the research\'s rules', () => {
        const lines = researchHeaderLines({ id: RID, appTree: 'tree with spaces', sent: 'x'.repeat(65) });
        expect(lines).toEqual([`1 _STROM_TREE ${RID}`]);
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
