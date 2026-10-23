/**
 * What the research's status says about the tree (`tree.kind`, `tree.state`,
 * `seal`, `notDownloaded`, each read only with its capability in `features`),
 * kept per browser, and the writes it holds back until something there is
 * settled (409 `seal.foreign` / `tree.not-downloaded`, 507 `disk.full`): the
 * state of the tree, never a send again by itself (spec 017 U7).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sanitizeLiveStatus, statusAgentless, researchSchemeUrl, sanitizeResearchLinks } from '../research-link.js';
import { writeHeldOfRefusal, writeHeldOfCode, writeHeldOfStatus, writeHeldSettled, joinSaid, isWriteHeldCode } from '../research-write-held.js';
import { researchSyncState, researchSyncWantsAttention, ResearchSyncInput } from '../research-sync.js';
import { noteResearchBridgeStatus, researchTreeOfStatus, storedResearchBridge } from '../research-device.js';
import { researchTreeState } from '../research-others.js';
import { materialErrorOf, materialErrorAction, materialErrorText } from '../materials.js';
import { readFailure } from '../research-read.js';
import { waitingSentReply } from '../research-waiting-write.js';
import { ResearchLink, ResearchSend } from '../types.js';

const RID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
const ALL = ['tree.kind', 'tree.state', 'seal.foreign', 'tree.notDownloaded', 'disk.full'];
const SEAL_SAID = '„Fíškovi“ byl zapečetěn na jiném počítači: nic se nezapsalo — až se převezme na tomto (terminál: strom seal adopt, nebo menu strom), pošlete znovu';

function status(extra: Record<string, unknown> = {}, tree: Record<string, unknown> = {}) {
    return sanitizeLiveStatus({ tree: { id: RID, name: 'Fíškovi', ...tree }, head: 'h1', ...extra })!;
}

function memoryStorage(): Storage {
    const store = new Map<string, string>();
    return {
        get length() { return store.size; },
        clear: () => store.clear(),
        getItem: (k: string) => store.get(k) ?? null,
        key: (i: number) => [...store.keys()][i] ?? null,
        removeItem: (k: string) => { store.delete(k); },
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
    };
}

describe('/status: what the tree is, its seal, files not downloaded', () => {
    it('read with their capabilities', () => {
        const s = status({ features: ALL, seal: 'elsewhere', notDownloaded: 3 }, { kind: 'archive', state: 'waiting' });
        expect(s.treeKind).toBe('archive');
        expect(s.treeState).toBe('waiting');
        expect(s.seal).toBe('elsewhere');
        expect(s.notDownloaded).toBe(3);
        expect(status({ features: ALL, seal: 'here', notDownloaded: 0 }, { kind: 'research', state: 'research' }))
            .toMatchObject({ treeKind: 'research', treeState: 'research', seal: 'here', notDownloaded: 0 });
    });

    it('without the capability: nothing of it (an older research behaves as today)', () => {
        const s = status({ seal: 'elsewhere', notDownloaded: 3 }, { kind: 'archive', state: 'waiting' });
        expect(s.treeKind).toBeUndefined();
        expect(s.treeState).toBeUndefined();
        expect(s.seal).toBeUndefined();
        expect(s.notDownloaded).toBeUndefined();
        // Each field by its own capability.
        const k = status({ features: ['tree.kind'], seal: 'elsewhere' }, { kind: 'archive', state: 'waiting' });
        expect(k.treeKind).toBe('archive');
        expect(k.treeState).toBeUndefined();
        expect(k.seal).toBeUndefined();
    });

    it('untrusted: unknown values and bad counts are dropped', () => {
        const s = status({ features: ALL, seal: 'ELSEWHERE', notDownloaded: -2 }, { kind: 'agent', state: 'sleeping' });
        expect(s.treeKind).toBeUndefined();
        expect(s.treeState).toBeUndefined();
        expect(s.seal).toBeUndefined();
        expect(s.notDownloaded).toBeUndefined();
        expect(status({ features: ALL, notDownloaded: '5', seal: 1 }).notDownloaded).toBeUndefined();
        expect(status({ features: ALL, notDownloaded: Infinity }).notDownloaded).toBeUndefined();
        // A tree given as its bare id (the send bridge): nothing said about it.
        expect(sanitizeLiveStatus({ tree: RID, features: ALL })!.treeKind).toBeUndefined();
    });

    it('a research waiting for its agent is an archive by its kind; without the kind, accepts decides as before', () => {
        expect(statusAgentless(status({ features: ['tree.kind'] }, { kind: 'archive' }))).toBe(true);
        // The kind outweighs accepts (a research waiting for its agent with no agentHere said).
        expect(statusAgentless(status({ features: ['tree.kind'], accepts: { mode: 'research', sync: { auto: 'write' } } }, { kind: 'archive' }))).toBe(true);
        expect(statusAgentless(status({ features: ['tree.kind'], accepts: { mode: 'research', agentHere: false } }, { kind: 'research' }))).toBe(false);
        expect(statusAgentless(status({ accepts: { mode: 'research', agentHere: false } }, { kind: 'research' }))).toBe(true);
        expect(statusAgentless(status({ accepts: { mode: 'archive' } }))).toBe(true);
        expect(statusAgentless(status({ accepts: { mode: 'research' } }, { kind: 'archive' }))).toBe(false);
    });

    it('another tree in the switcher: idle as an archive by its kind', () => {
        const working = [{ who: 'agent', since: '2026-10-20T10:00:00Z', task: 'T0001' }];
        const answer = (extra: Record<string, unknown>, tree: Record<string, unknown>) =>
            ({ result: 'up' as const, status: status({ working, ...extra }, tree), at: 0 });
        expect(researchTreeState(answer({ features: ['tree.kind'] }, { kind: 'archive' }))?.kind).toBe('idle');
        expect(researchTreeState(answer({}, { kind: 'archive' }))?.lines).toBe(1);
    });

    it('the seal link: strom-research://seal?tree=<id>', () => {
        expect(sanitizeResearchLinks(['seal', 'open'])).toEqual(['seal', 'open']);
        expect(researchSchemeUrl('seal', { tree: RID })).toBe(`strom-research://seal?tree=${RID}`);
        expect(researchSchemeUrl('seal', { tree: RID }, 'strom-research-beta')).toBe(`strom-research-beta://seal?tree=${RID}`);
        expect(researchSchemeUrl('seal', { tree: 'not an id' })).toBeNull();
    });
});

describe('kept per browser (the switcher label when the research is not running)', () => {
    beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
    afterEach(() => vi.unstubAllGlobals());

    it('a whole status replaces it; a note without one keeps it', () => {
        const s = status({ features: ALL }, { kind: 'archive', state: 'waiting' });
        noteResearchBridgeStatus(RID, s.accepts, s.head, researchTreeOfStatus(s));
        expect(storedResearchBridge(RID)?.tree).toEqual({ kind: 'archive', state: 'waiting' });
        noteResearchBridgeStatus(RID, null, 'h2');
        expect(storedResearchBridge(RID)?.tree).toEqual({ kind: 'archive', state: 'waiting' });
        // A status that no longer says it (the research went back to an older version): forgotten.
        noteResearchBridgeStatus(RID, null, 'h3', researchTreeOfStatus(status({}, { kind: 'archive' })));
        expect(storedResearchBridge(RID)?.tree).toBeUndefined();
    });

    it('an entry stored before (no tree) reads as before; a bad one is dropped', () => {
        localStorage.setItem(`strom-research-bridge:${RID}`, JSON.stringify({ accepts: { mode: 'research', agentHere: false } }));
        const old = storedResearchBridge(RID)!;
        expect(old.tree).toBeUndefined();
        expect(old.accepts?.agentHere).toBe(false);
        localStorage.setItem(`strom-research-bridge:${RID}`, JSON.stringify({ tree: { kind: 'agent', state: 7 } }));
        expect(storedResearchBridge(RID)?.tree).toBeUndefined();
    });
});

describe('a write held back by the research', () => {
    it('by its code, only from a bridge that names the capability', () => {
        expect(writeHeldOfRefusal('seal.foreign', SEAL_SAID, ['seal.foreign'])).toEqual({ kind: 'seal', said: SEAL_SAID });
        expect(writeHeldOfRefusal('tree.not-downloaded', 'Ještě se stahuje.', ['tree.notDownloaded'], { n: 4, first: 'media/a.jpg' }))
            .toEqual({ kind: 'cloud', said: 'Ještě se stahuje.', n: 4 });
        expect(writeHeldOfRefusal('disk.full', 'Disk je plný.', ['disk.full'])).toEqual({ kind: 'disk', said: 'Disk je plný.' });
        // Without the capability: an ordinary refusal.
        expect(writeHeldOfRefusal('seal.foreign', SEAL_SAID, null)).toBeNull();
        expect(writeHeldOfRefusal('seal.foreign', SEAL_SAID, ['disk.full'])).toBeNull();
        expect(writeHeldOfRefusal('tree.no-ids', 'x', ALL)).toBeNull();
        // Whatever was announced, for a write that would otherwise go again by itself.
        expect(writeHeldOfCode('disk.full', 'Disk je plný.')).toEqual({ kind: 'disk', said: 'Disk je plný.' });
        expect(isWriteHeldCode('seal.foreign')).toBe(true);
        expect(isWriteHeldCode('toString')).toBe(false);
    });

    it('untrusted: the sentence cleaned and capped, a bad count dropped', () => {
        const held = writeHeldOfRefusal('tree.not-downloaded', `a\u0000b\n${'x'.repeat(1000)}`, ALL, { n: -1 })!;
        expect(held.said.startsWith('a b x')).toBe(true);
        expect(held.said.length).toBe(400);
        expect(held.n).toBeUndefined();
        expect(writeHeldOfRefusal('seal.foreign', 42, ALL)).toEqual({ kind: 'seal', said: '' });
    });

    it('said ahead by the status: sealed elsewhere, files not downloaded', () => {
        expect(writeHeldOfStatus(status({ features: ALL, seal: 'elsewhere' }))).toEqual({ kind: 'seal', said: '' });
        expect(writeHeldOfStatus(status({ features: ALL, notDownloaded: 2 }))).toEqual({ kind: 'cloud', said: '', n: 2 });
        expect(writeHeldOfStatus(status({ features: ALL, seal: 'here', notDownloaded: 0 }))).toBeNull();
        // An older research saying it without the capability: writes go as before.
        expect(writeHeldOfStatus(status({ seal: 'elsewhere', notDownloaded: 2 }))).toBeNull();
        expect(writeHeldOfStatus(null)).toBeNull();
    });

    it('a refused write settled by the status: only said outright, by a bridge with the capability', () => {
        const seal = { kind: 'seal' as const, said: 'x' };
        const cloud = { kind: 'cloud' as const, said: 'x', n: 2 };
        expect(writeHeldSettled(seal, status({ features: ALL, seal: 'here' }))).toBe(true);
        expect(writeHeldSettled(seal, status({ features: ALL, seal: 'elsewhere' }))).toBe(false);
        expect(writeHeldSettled(seal, status({ features: ALL }))).toBe(false);
        expect(writeHeldSettled(seal, status({ seal: 'here' }))).toBe(false);
        expect(writeHeldSettled(cloud, status({ features: ALL, notDownloaded: 0 }))).toBe(true);
        expect(writeHeldSettled(cloud, status({ features: ALL, notDownloaded: 1 }))).toBe(false);
        expect(writeHeldSettled(cloud, status({ features: ALL }))).toBe(false);
        expect(writeHeldSettled({ kind: 'disk', said: 'x' }, status({ features: ALL, seal: 'here', notDownloaded: 0 }))).toBe(false);
        expect(writeHeldSettled(seal, null)).toBe(false);
    });

    it('two sentences as one', () => {
        expect(joinSaid('Nic se nezapsalo', 'Úpravy čekají.')).toBe('Nic se nezapsalo. Úpravy čekají.');
        expect(joinSaid('Nothing was written.', 'Kept.')).toBe('Nothing was written. Kept.');
        expect(joinSaid('', 'Kept.')).toBe('Kept.');
    });

    it('materials, readings and the waiting list: the research\'s sentence, never a busy research tried again', () => {
        const m = materialErrorOf(409, { error: SEAL_SAID, code: 'seal.foreign', params: { set: 'strom seal adopt' } });
        expect(m.kind).toBe('held');
        expect(materialErrorAction(m)).toBeNull();
        expect(materialErrorText(m, false)).toBe(SEAL_SAID);
        expect(materialErrorOf(507, { error: 'No room.', code: 'disk.full' }).kind).toBe('held');
        // Another 409: busy as before.
        expect(materialErrorOf(409, { error: 'x', code: 'other' }).kind).toBe('busy');
        const r = readFailure(409, { error: 'Not downloaded yet.', code: 'tree.not-downloaded', params: { n: 2 } });
        expect(r.kind).toBe('held');
        expect(r.held).toEqual({ kind: 'cloud', said: 'Not downloaded yet.', n: 2 });
        const w = waitingSentReply(507, { error: 'No room.', text: 'Full.', code: 'disk.full' });
        expect(w.ok).toBe(false);
        expect(!w.ok && w.code).toBe('held');
        expect(!w.ok && w.held?.said).toBe('No room.');
    });
});

describe('the state of the tree while writes are held', () => {
    const link = (extra: Partial<ResearchLink> = {}): ResearchLink =>
        ({ id: RID, fingerprint: 'base', syncedAt: '2026-10-02T10:00:00Z', head: 'aaaaaaa', ...extra });
    const sent = (extra: Partial<ResearchSend> = {}): ResearchSend =>
        ({ fingerprint: 'fp-sent', at: '2026-10-02T14:32:00Z', changes: 6, head: 'aaaaaaa', state: 'written', ...extra });
    const input = (extra: Partial<ResearchSyncInput> = {}): ResearchSyncInput => ({
        link: link(), capable: true, shown: true, matchesBase: false, current: 'fp-now', bridgeUp: true, safari: false, remoteHead: 'aaaaaaa', ...extra,
    });
    const refused = { reason: SEAL_SAID, at: '2026-10-23T10:00:00Z', held: { kind: 'seal' as const, said: SEAL_SAID } };

    it('a send refused so: its own state with the sentence, by hand and sending by itself alike', () => {
        for (const auto of [false, true]) {
            const st = researchSyncState(input({ link: link({ refused }), auto }));
            expect(st.kind).toBe('writeHeld');
            expect(st.held).toEqual(refused.held);
            expect(st.ahead).toBeUndefined();
        }
        expect(researchSyncWantsAttention('writeHeld')).toBe(true);
        // A plain refusal stays as it was.
        expect(researchSyncState(input({ link: link({ refused: { reason: '', at: refused.at } }) })).kind).toBe('refused');
        // Changes the last send left unwritten do not hide it.
        expect(researchSyncState(input({ link: link({ refused, sent: sent() }), notWritten: true })).kind).toBe('writeHeld');
    });

    it('said ahead by the status, before anything is sent', () => {
        const held = { kind: 'seal' as const, said: '' };
        const st = researchSyncState(input({ held, auto: true }));
        expect(st.kind).toBe('writeHeld');
        expect(st.ahead).toBe(true);
        expect(researchSyncState(input({ held: { kind: 'cloud', said: '', n: 3 } })).held?.n).toBe(3);
        // Nothing to send and a newer version to load: loading comes first (it is not a write).
        expect(researchSyncState(input({ held, matchesBase: true, remoteHead: 'bbbbbbb' })).kind).toBe('newer');
        // In step: still said (the next edit would wait).
        expect(researchSyncState(input({ held, matchesBase: true })).kind).toBe('writeHeld');
        // Only loading: nothing goes anyway.
        expect(researchSyncState(input({ held, sendOff: true })).kind).not.toBe('writeHeld');
        // A send on its way stays that.
        expect(researchSyncState(input({ held, sending: true, auto: true })).kind).toBe('sending');
    });
});
