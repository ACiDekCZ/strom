/**
 * The source viewer after a newer reading (spec 059 §2, §3) and the research's setting "Task from a new reading"
 * (§4): every state of the source's row with its shape, sentence and links; the choices and their marks; the
 * agent's proposal with its places, its answers and Undo; the settings group and the bridge write. Without the
 * research's feature or fields nothing new is said (the viewer as before). Invented data only (Vlk, Doubrava).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    sourceRowHtml, sourceRowKind, sourceRowChoices, proposalHtml, proposalPlaces, proposalActions, readIdDate, readStateShortDate, readStateLongDate,
    type SourceRowInput, type ProposalInput,
} from '../ui/read-source-state-view.js';
import { readTaskSettingHtml } from '../ui/read-task-setting-view.js';
import { postBridgeReadTask, readTaskSettingReply } from '../history-bridge.js';
import { readAgainSaid, sanitizeReadSourceState, type ReadSourceState } from '../research-read-task.js';
import { sanitizeLiveStatus, researchLinkMark } from '../research-link.js';
import { researchActionLabel, researchBridgeAgentLabel } from '../ui/research-open-mark.js';
import { strings } from '../strings.js';

const t = strings.read;
const ts = strings.treeSettings;
const ID = 'D20261107093000-ab12';
const st = (over: Partial<ReadSourceState> = {}): ReadSourceState => ({ read: ID, state: 'unchecked', ...over });
const row = (over: Partial<SourceRowInput> = {}): string => sourceRowHtml({
    state: st(), date: '7 Nov', counts: { major: 2, unsure: 1 }, confirmed: false, phone: false, bridgeUp: true, canOpenTask: true, open: false, ...over,
});
const stateOf = (html: string): string => /data-state="([a-z]+)"/.exec(html)?.[1] ?? '';
const iconOf = (html: string): string => /viewer-read-state-icon is-([a-z]+)/.exec(html)?.[1] ?? '';

describe('the date of a newer reading', () => {
    it('from the reading\'s id, said short and long per language', () => {
        const at = readIdDate(ID)!;
        expect(at.getDate()).toBe(7);
        expect(readStateShortDate(at, 'cs')).toBe('7. 11.');
        expect(readStateShortDate(at, 'de')).toBe('7. 11.');
        expect(readStateShortDate(at, 'pl')).toBe('7.11.');
        expect(readStateShortDate(at, 'en')).toBe('7 Nov');
        expect(readStateLongDate(at, 'cs')).toBe('7. 11. 2026');
        expect(readStateLongDate(at, 'en')).toBe('7 Nov 2026');
        expect(readIdDate('x')).toBeNull();
    });
});

describe('§2 the source\'s row: each state of the research', () => {
    it('not checked: dashed ?, the counted sentence, Decide ▸ · Result ›, framed and bold', () => {
        const h = row();
        expect(stateOf(h)).toBe('unchecked');
        expect(iconOf(h)).toBe('open');
        expect(h).toContain('viewer-read-state is-open');
        expect(h).toContain(t.sUnchecked('7 Nov', 2));
        expect(h).toContain(t.sDecide);
        expect(h).toContain('data-read-again-open="' + ID + '"');
        expect(h.indexOf(t.sDecide)).toBeLessThan(h.indexOf(t.againResultLink));
        expect(h).not.toContain('viewer-read-state-opts');
        // Counts not known yet: the sentence without them.
        expect(row({ counts: null })).toContain(t.sUncheckedAny('7 Nov'));
    });

    it('saved: square ✓, Result › · Give to the agent… ▸; quiet', () => {
        const h = row({ state: st({ state: 'saved' }) });
        expect(stateOf(h)).toBe('saved');
        expect(iconOf(h)).toBe('save');
        expect(h).not.toContain('is-open"');
        expect(h).toContain(t.sSaved('7 Nov'));
        expect(h.indexOf(t.againResultLink)).toBeLessThan(h.indexOf(t.sGiveAgent));
        // A confirmed transcript saved: the agent never takes it, nothing to give.
        expect(row({ state: st({ state: 'saved' }), confirmed: true })).not.toContain(t.sGiveAgent);
    });

    it('a task: queued, a conversation, closed, for a person; Open task with the terminal mark', () => {
        const queued = row({ state: st({ state: 'task', task: 'T0417', taskFor: 'agent', taskOpen: true, taskQueued: true }) });
        expect(stateOf(queued)).toBe('queued');
        expect(iconOf(queued)).toBe('task');
        expect(queued).toContain(t.sTaskQueued('7 Nov', 'T0417'));
        expect(queued).toContain(researchActionLabel(t.openTaskN('T0417'), researchLinkMark('task')));
        const chat = row({ state: st({ state: 'task', task: 'T0417', taskFor: 'agent', taskOpen: true }) });
        expect(stateOf(chat)).toBe('chat');
        expect(chat).toContain(t.sTaskChat('7 Nov', 'T0417'));
        const done = row({ state: st({ state: 'task', task: 'T0417', taskFor: 'agent' }) });
        expect(stateOf(done)).toBe('done');
        expect(iconOf(done)).toBe('done');
        expect(done).toContain(t.sTaskDone('7 Nov', 'T0417'));
        expect(done).not.toContain('data-read-state="task"');
        const person = row({ state: st({ state: 'task', task: 'T0417', taskFor: 'person', taskOpen: true }), confirmed: true });
        expect(stateOf(person)).toBe('person');
        expect(person).toContain(t.sTaskPerson('7 Nov', 'T0417'));
        expect(person).toContain('data-task="T0417"');
        // Without the research's terminal link no Open task.
        expect(row({ state: st({ state: 'task', task: 'T0417', taskOpen: true }), canOpenTask: false })).not.toContain('data-read-state="task"');
    });

    it('only minor details, only uncertain places: a dash, Result › alone', () => {
        const minor = row({ state: st({ state: 'saved', minorOnly: true }) });
        expect(stateOf(minor)).toBe('minor');
        expect(iconOf(minor)).toBe('none');
        expect(minor).toContain(t.sMinor('7 Nov'));
        expect(minor).not.toContain(t.sGiveAgent);
        const unsure = row({ state: st({ state: 'saved', unsureOnly: true }) });
        expect(stateOf(unsure)).toBe('unsure');
        expect(unsure).toContain(t.sUnsure('7 Nov', 1));
        expect(row({ state: st({ state: 'saved', unsureOnly: true }), counts: null })).toContain(t.sUnsureAny('7 Nov'));
    });

    it('the kinds as the research says them', () => {
        expect(sourceRowKind({ state: 'unchecked' })).toBe('unchecked');
        expect(sourceRowKind({ state: 'saved' })).toBe('saved');
        expect(sourceRowKind({ state: 'task', taskOpen: true, taskQueued: true })).toBe('queued');
        expect(sourceRowKind({ state: 'task' })).toBe('done');
    });
});

describe('§2 the choices', () => {
    it('not confirmed: Check now (AI + terminal), Queue (AI), Just save (no mark), with its note', () => {
        const h = row({ open: true });
        expect(h).toContain('aria-expanded="true"');
        expect(h).toContain(researchActionLabel(t.tNow, researchLinkMark('task', { taskDo: 'chat' })));
        expect(h).toContain(researchBridgeAgentLabel(t.tQueue));
        expect(h).toContain(`data-read-how="save">${t.tSave}</button>`);
        expect(h).toContain(t.sNoteUn);
        expect(h).not.toContain('data-read-how="review"');
    });

    it('confirmed: Set aside for review and Just save; saved: Check now and Queue', () => {
        const conf = row({ open: true, confirmed: true });
        expect(conf).toContain('data-read-how="review"');
        expect(conf).not.toContain('data-read-how="now"');
        expect(conf).toContain(t.sNoteConf);
        const saved = row({ open: true, state: st({ state: 'saved' }) });
        expect(saved).toContain('data-read-how="now"');
        expect(saved).toContain('data-read-how="queue"');
        expect(saved).not.toContain('data-read-how="save"');
        expect(saved).toContain(t.sNoteSaved);
        expect(sourceRowChoices('done', false)).toBeNull();
    });

    it('a choice on its way: a spinner at it, the others off; a failure under the choices, which stay', () => {
        const busy = row({ act: { how: 'save', busy: true } });
        expect(busy).toContain('read-task-spin');
        expect(busy).toContain(t.tBusySave);
        expect((busy.match(/data-read-how="[a-z]+" disabled/g) ?? []).length).toBe(3);
        expect(row({ act: { how: 'now', busy: true } })).toContain(t.tBusy);
        const failed = row({ act: { how: 'now', busy: false, failed: true } });
        expect(failed).toContain(t.tFail);
        expect(failed).toContain('data-read-how="now"');
    });

    it('nothing left to decide (decided meanwhile): its sentence instead of the failure, until the research\'s state comes', () => {
        const settled = row({ act: { how: 'queue', busy: false, settled: true } });
        expect(settled).toContain(t.tSettled);
        expect(settled).not.toContain(t.tFail);
    });

    it('a phone: the state, and where deciding works instead of the links; no bridge: no choices', () => {
        const phone = row({ phone: true, open: true });
        expect(stateOf(phone)).toBe('unchecked');
        expect(phone).toContain(t.sPhone);
        expect(phone).not.toContain(t.sDecide);
        expect(phone).not.toContain('data-read-how');
        const down = row({ bridgeUp: false, open: true });
        expect(down).not.toContain(t.sDecide);
        expect(down).not.toContain('data-read-again-open');
        expect(down).toContain(t.sUnchecked('7 Nov', 2));
    });
});

describe('§2 the uncertain places handed over (spec 059 K8.2, read.sourceTask.unsure)', () => {
    const unsureRow = (over: Partial<SourceRowInput> = {}): string =>
        row({ state: st({ state: 'saved', unsureOnly: true, unsureOffer: true }), counts: { major: 0, unsure: 6 }, unsure: true, ...over });

    it('"only uncertain places" with the offer: Give to the agent… ▸ opens the same choice as the dialog (the AI badge alone)', () => {
        const closed = unsureRow();
        expect(stateOf(closed)).toBe('unsure');
        expect(closed).toContain(t.sUnsure('7 Nov', 6));
        expect(closed).toContain(t.sGiveAgent);
        expect(closed).toContain('aria-expanded="false"');
        expect(closed).not.toContain('data-read-how');
        const open = unsureRow({ open: true });
        expect(open).toContain(`data-read-how="queue" data-read-unsure="true">${researchBridgeAgentLabel(t.tUnsureQueue)}</button>`);
        expect((open.match(/data-read-how=/g) ?? []).length).toBe(1);
        expect(open).not.toContain('research-open-mark');
        expect(open).toContain(t.tUnsureQueueSub);
    });

    it('a confirmed transcript: Set aside for review… with "Set aside for review" for a person, no mark', () => {
        const open = unsureRow({ open: true, confirmed: true });
        expect(open).toContain(t.sReviewGive);
        expect(open).toContain(`data-read-how="review" data-read-unsure="true">${t.tReview}</button>`);
        expect(open).not.toContain('research-ai-badge');
        expect(open).toContain(t.tUnsureReviewSub);
    });

    it('offered by unsureOffer whatever the state: saved, or a task done; never without the offer, on a phone or with the bridge down', () => {
        const done = row({ state: st({ state: 'task', task: 'T0417', taskFor: 'agent', taskOpen: false, unsureOffer: true }), unsure: true, open: true });
        expect(stateOf(done)).toBe('done');
        expect(done).toContain('data-read-unsure="true"');
        // A saved reading whose sure places a person kept earlier: the uncertain places alone, not Check now / Queue.
        const saved = row({ state: st({ state: 'saved', unsureOffer: true }), unsure: true, open: true });
        expect((saved.match(/data-read-how=/g) ?? []).length).toBe(1);
        expect(saved).toContain('data-read-unsure="true"');
        // The caller passes `unsure` only with the feature and the offer.
        const without = row({ state: st({ state: 'saved', unsureOnly: true, unsureOffer: true }), open: true });
        expect(without).not.toContain('data-read-how');
        expect(without).not.toContain(t.sGiveAgent);
        expect(unsureRow({ phone: true, open: true })).not.toContain('data-read-how');
        expect(unsureRow({ bridgeUp: false, open: true })).not.toContain('data-read-how');
        expect(sourceRowChoices('unsure', false)).toBeNull();
        expect(sourceRowChoices('unsure', false, true)!.choices).toEqual([{ how: 'queue', label: t.tUnsureQueue, unsure: true }]);
    });

    it('on its way, failed, and the research\'s answers: sure changes came, nothing to propose, a wording turned down', () => {
        const busy = unsureRow({ act: { how: 'queue', unsure: true, busy: true } });
        expect(busy).toContain('aria-busy="true"');
        expect(busy).toContain(t.tBusy);
        expect(unsureRow({ act: { how: 'queue', unsure: true, busy: false, failed: true } })).toContain(t.tFail);
        const sure = unsureRow({ act: { how: 'queue', unsure: true, busy: false, answer: 'sure' } });
        expect(sure).toContain(t.tUnsureSure);
        expect(sure).not.toContain(t.tFail);
        for (const [answer, text] of [['noproposal', t.tNoProposal], ['declined', t.tDeclined]] as const) {
            const h = unsureRow({ confirmed: true, act: { how: 'review', unsure: true, busy: false, answer } });
            expect(h).toContain(text);
            expect(h).not.toContain('data-read-how');
            expect(h).not.toContain(t.tFail);
        }
    });
});

describe('the research\'s status: nothing said without the feature', () => {
    const raw = { features: ['read.sourceTask'], readAgain: { S0042: { read: ID, state: 'unchecked' } } };
    it('readAgain read only with read.sourceTask', () => {
        expect(readAgainSaid(raw.readAgain, raw.features)).toEqual({ S0042: { read: ID, state: 'unchecked' } });
        expect(readAgainSaid(raw.readAgain, ['read.source'])).toBeUndefined();
        expect(readAgainSaid(undefined, raw.features)).toBeUndefined();
    });

    it('the bridge\'s status carries it, or leaves it out (an older research: the viewer as before)', () => {
        const base = { ok: true, research: 'r1', name: 'X', head: 'a'.repeat(40) };
        const on = sanitizeLiveStatus({ ...base, ...raw });
        const off = sanitizeLiveStatus({ ...base, features: ['read.source'], readAgain: raw.readAgain });
        expect(on?.readAgain?.S0042?.state).toBe('unchecked');
        expect(off).not.toBeNull();
        expect(off?.readAgain).toBeUndefined();
    });
});

describe('§3 the agent\'s proposal', () => {
    const TRANSCRIPT = 'Joannes Vlk filius\nJosephi in Dubrava N. 7';
    const proposal = { text: 'Joannes Vlk filius\nJosephi in Doubrava N. 7', by: 'agent · opus · high', task: 'T0417', at: '2026-11-08T10:00:00Z' };
    const block = (over: Partial<ProposalInput> = {}): string => proposalHtml({
        proposal, transcript: TRANSCRIPT, lang: 'en', actions: 'bridge', undo: true, canOpenTask: true, whole: false, done: '', ...over,
    });

    it('no proposal field: none', () => {
        expect(sanitizeReadSourceState({ read: ID, state: 'task', task: 'T0417' })).not.toHaveProperty('proposal');
    });

    it('its places counted against the confirmed transcript, one word around', () => {
        const places = proposalPlaces(TRANSCRIPT, proposal);
        expect(places).toHaveLength(1);
        expect(places[0]).toMatchObject({ line: 1, before: 'in', old: 'Dubrava', new: 'Doubrava', after: 'N.' });
        const h = block();
        expect(h).toContain(t.pTitle);
        expect(h).toContain('agent · opus · high');
        expect(h).toContain(researchActionLabel(t.pFrom('T0417'), researchLinkMark('task')));
        expect(h).toContain('8 Nov 2026');
        expect(h).toContain(`${t.ln} 2`);
        expect(h).toContain('read-mk-chg');
        // The places as the research lists them (the design's shape).
        expect(proposalPlaces(TRANSCRIPT, { ...proposal, places: [{ at: '', old: 'Dubrava', new: 'Doubrava', kind: 'spelling' }] })[0])
            .toMatchObject({ line: 1, before: 'in', after: 'N.' });
    });

    it('Accept and Keep with the same weight, no mark; the whole text side by side on request', () => {
        const h = block();
        expect(h).toContain(`<button type="button" class="secondary" data-proposal-take="proposal">${t.pAccept}</button>`);
        expect(h).toContain(`<button type="button" class="secondary" data-proposal-take="keep">${t.pKeep}</button>`);
        expect(h).toContain(t.pNote);
        expect(h).not.toContain('viewer-proposal-cols');
        const whole = block({ whole: true });
        expect(whole).toContain(t.pOld);
        expect(whole).toContain(t.pNew);
        expect(whole).toContain('aria-expanded="true"');
    });

    it('an answer on its way, a failure; after it the research\'s answer and Undo (only with its feature)', () => {
        const busy = block({ act: { take: 'proposal', busy: true } });
        expect(busy).toContain('read-task-spin');
        expect(busy).toMatch(/data-proposal-take="keep" disabled/);
        expect(block({ act: { take: 'keep', busy: false, failed: true } })).toContain(t.pFail);
        const accepted = block({ done: 'proposal' });
        expect(accepted).toContain(t.pAccepted);
        expect(accepted).toContain(t.pAccepted2);
        expect(accepted).toContain('is-done');
        expect(accepted).toContain('data-proposal-take="undo"');
        expect(accepted).not.toContain(t.pAccept);
        const kept = block({ done: 'keep' });
        expect(kept).toContain(t.pKept);
        expect(kept).toContain(t.pKept2);
        expect(block({ done: 'keep', undo: false })).not.toContain('data-proposal-take="undo"');
    });

    it('the proposal moved on meanwhile: the current state is shown with its sentence, not the failure', () => {
        const stale = block({ act: { take: 'proposal', busy: false, stale: true } });
        expect(stale).toContain(t.pStale);
        expect(stale).not.toContain(t.pFail);
        expect(stale).toContain('data-proposal-take="proposal"');
        expect(block({ done: 'proposal', act: { take: 'undo', busy: false, stale: true } })).toContain(t.pStale);
    });

    it('the features: Accept / Keep only with sources.proposal (bridge up), Undo only with sources.proposal.undo', () => {
        expect(proposalActions(['read.sourceTask'], false, true)).toEqual({ actions: 'none', undo: false });
        expect(proposalActions(['read.sourceTask', 'sources.proposal'], false, true)).toEqual({ actions: 'bridge', undo: false });
        expect(proposalActions(['sources.proposal', 'sources.proposal.undo'], false, true)).toEqual({ actions: 'bridge', undo: true });
        expect(proposalActions(['sources.proposal', 'sources.proposal.undo'], false, false)).toMatchObject({ actions: 'none' });
        expect(proposalActions(['sources.proposal'], true, false)).toMatchObject({ actions: 'phone' });
        const off = block(proposalActions(['read.sourceTask'], false, true));
        expect(off).not.toContain('data-proposal-take');
        expect(block({ ...proposalActions(['sources.proposal'], false, true), done: 'proposal' })).not.toContain('data-proposal-take="undo"');
        expect(block({ ...proposalActions(['sources.proposal', 'sources.proposal.undo'], false, true), done: 'proposal' })).toContain('data-proposal-take="undo"');
    });

    it('a phone: the block and its places, no answers, where it works', () => {
        const h = block({ actions: 'phone', canOpenTask: false });
        expect(h).toContain(t.sPhone);
        expect(h).not.toContain('data-proposal-take');
        expect(h).toContain('read-mk-chg');
        expect(block({ actions: 'none' })).not.toContain('data-proposal-take');
    });
});

describe('§4 "Task from a new reading" in the research\'s settings', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('a folded group with the value beside its title; three choices, Ask the default', () => {
        const h = readTaskSettingHtml({ value: 'never', open: false, up: true });
        expect(h).not.toMatch(/<details[^>]* open/);
        expect(h).toContain(ts.readGroup);
        expect(h).toContain(ts.readTaskSum(ts.readTaskNever));
        expect((h.match(/name="research-read-task"/g) ?? []).length).toBe(3);
        expect(h).toMatch(/value="never" checked/);
        expect(h).toContain(ts.default);
        expect(h).not.toContain('disabled');
        expect(readTaskSettingHtml({ value: 'ask', open: true, up: true })).toMatch(/<details[^>]* open/);
    });

    it('saving, confirmed, the bridge down', () => {
        const busy = readTaskSettingHtml({ value: 'always', open: true, up: true, note: { kind: 'busy' } });
        expect(busy).toContain(ts.rtBusy);
        expect((busy.match(/ disabled/g) ?? []).length).toBe(3);
        expect(readTaskSettingHtml({ value: 'always', open: true, up: true, note: { kind: 'ok' } })).toContain(ts.rtOk);
        const down = readTaskSettingHtml({ value: 'ask', open: true, up: false, note: { kind: 'text', text: strings.history.storiesBridgeDown } });
        expect(down).toContain('is-down');
        expect(down).toContain(strings.history.storiesBridgeDown.replace(/'/g, '&#39;'));
        expect((down.match(/ disabled/g) ?? []).length).toBe(3);
    });

    it('the bridge\'s answers typed', () => {
        expect(readTaskSettingReply(200, { ok: true, sourceTask: 'never' }, [])).toEqual({ ok: true, value: 'never' });
        expect(readTaskSettingReply(200, {}, [])).toEqual({ ok: true });
        expect(readTaskSettingReply(409, { code: 'sourceTask.archive', error: 'An archive.' }, [])).toMatchObject({ ok: false, code: 'archive', reason: 'An archive.' });
        expect(readTaskSettingReply(400, { code: 'sourceTask.invalid' }, [])).toMatchObject({ ok: false, code: 'invalid' });
        expect(readTaskSettingReply(503, { code: 'research.busy' }, [])).toMatchObject({ ok: false, code: 'busy' });
        expect(readTaskSettingReply(500, {}, [])).toMatchObject({ ok: false, code: 'unknown' });
    });

    it('the write: its path and body; no answer is the network', async () => {
        const f = vi.fn(async () => new Response(JSON.stringify({ ok: true, sourceTask: 'always' }), { status: 200 }));
        vi.stubGlobal('fetch', f);
        const res = await postBridgeReadTask('http://127.0.0.1:1/tok', 'always', ['read.sourceTask'], { tree: 'r1' });
        expect(res).toEqual({ ok: true, value: 'always' });
        const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
        expect(url.split('?')[0]).toBe('http://127.0.0.1:1/tok/sourceTask');
        expect(JSON.parse(String(init.body))).toEqual({ sourceTask: 'always' });
        vi.unstubAllGlobals();
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down'); }));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await postBridgeReadTask('http://127.0.0.1:1/tok', 'ask', [], { tree: 'r1' })).toMatchObject({ ok: false, code: 'network' });
    });
});
