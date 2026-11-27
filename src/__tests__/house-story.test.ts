/**
 * The story of a house (spec 145 T4): `story` of `GET /houses/<ref>` read as the research sends it, `POST /houses/story`
 * and its refusals, the feature `house.story`, the link `story?house=A…`, What waits with a house's story, and what an
 * output may show of it (houseStoryForOutput).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearHouseCaches, houseCache, houseFeature, houseStoryReply, requestHouseStory, sanitizeHouseResearch, sanitizeHouseStory,
} from '../house-bridge.js';
import { HOUSE_FEATURES, researchLinkActionOf, researchSchemeUrl, researchUrlMark, sanitizeWaiting } from '../research-link.js';
import { waitingSection, waitingTaskActions } from '../research-waiting.js';

const BASE = 'http://127.0.0.1:4711/t0k3n';
const TREE = '5f0c8a3e-1d2b-4c6a-9e7f-0a1b2c3d4e5f';
const HEAD = '42e1c19b019afbcc0c2028b2967c0885883e60b3';
const PARENT = '8504262900d7b214dd09b7462c9100002e585917';
const F = ['house', 'house.material', 'house.story'];

const VERSION = {
    title: 'Mlýn u potoka', text: 'Mlýn stál u potoka.\n\nRoku 1781 ho postavil Dobromil Kvitelka.', facts: ['e1', 'h1'],
    sources: ['S0001'], at: '2026-11-26T10:00:00Z', people: [{ id: 'P0002', died: true }],
};
const HOUSE = { id: 'A0001', key: 'belokamen|16', place: { key: 'belokamen', id: 'L0001', name: 'Bělokamen' }, house: '16', persons: [], state: 'done' };

describe('story of GET /houses/<ref>', () => {
    it('reads a draft: text with its paragraphs, facts, sources, day, people', () => {
        const s = sanitizeHouseStory({ status: 'draft', ...VERSION, task: { id: 'T0009', state: 'done' }, extra: 1 });
        expect(s).toEqual({
            status: 'draft', title: 'Mlýn u potoka', text: 'Mlýn stál u potoka.\n\nRoku 1781 ho postavil Dobromil Kvitelka.',
            facts: ['e1', 'h1'], sources: [{ source: 'S0001' }], at: '2026-11-26', people: [{ id: 'P0002', died: true }],
            task: { id: 'T0009', state: 'done' },
        });
    });

    it('reads an approved story, and a new version beside it', () => {
        const fin = sanitizeHouseStory({ status: 'final', ...VERSION });
        expect(fin).toMatchObject({ status: 'final', text: VERSION.text });
        expect(fin).not.toHaveProperty('draft');
        const both = sanitizeHouseStory({ status: 'final', ...VERSION, draft: { ...VERSION, text: 'Nová verze.', people: [] } });
        expect(both?.status === 'final' && both.draft).toMatchObject({ text: 'Nová verze.', people: [] });
        // A draft never carries a draft of its own.
        expect(sanitizeHouseStory({ status: 'draft', ...VERSION, draft: VERSION })).not.toHaveProperty('draft');
    });

    it('no text yet: its task (status null), else nothing', () => {
        expect(sanitizeHouseStory({ status: null, task: { id: 'T0010', state: 'open' } })).toEqual({ status: null, task: { id: 'T0010', state: 'open' } });
        expect(sanitizeHouseStory({ status: null })).toBeUndefined();
        expect(sanitizeHouseStory({ status: null, task: { id: 'T0010', state: 'Bad State!' } })).toBeUndefined();
    });

    it('nonsense says nothing, or only the task; a missing story none', () => {
        expect(sanitizeHouseStory('story')).toBeUndefined();
        expect(sanitizeHouseStory({ status: 'printed', ...VERSION })).toBeUndefined();
        expect(sanitizeHouseStory({ status: 'final', text: '   ', facts: [] })).toBeUndefined();
        expect(sanitizeHouseStory({ status: 'draft', text: 7, task: { id: 'T0011', state: 'doing' } })).toEqual({ status: null, task: { id: 'T0011', state: 'doing' } });
        const s = sanitizeHouseStory({ status: 'final', text: 'Text\u0007 s\r\nřádky', facts: 'e1', people: [{ id: 'bad id!' }, { id: 'P0003' }] });
        expect(s).toMatchObject({ text: 'Text s\nřádky', facts: [], sources: [], people: [{ id: 'P0003', died: false }] });
        expect(sanitizeHouseResearch(HOUSE)).not.toHaveProperty('story');
        expect(sanitizeHouseResearch({ ...HOUSE, story: { status: 'draft', ...VERSION } })?.story).toMatchObject({ status: 'draft' });
    });
});

describe('the feature house.story', () => {
    it('is one of the houses\' features; an older research without it has none', () => {
        expect(HOUSE_FEATURES).toContain('house.story');
        expect(houseFeature(F, 'house.story')).toBe(true);
        expect(houseFeature(['house', 'house.chat'], 'house.story')).toBe(false);
    });
});

describe('POST /houses/story', () => {
    type Reply = { status: number; body: unknown };
    let replies: Reply[];
    let calls: { url: string; init?: RequestInit }[];
    beforeEach(() => {
        clearHouseCaches();
        replies = [];
        calls = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            calls.push({ url, init });
            const r = replies.shift();
            if (!r) throw new TypeError('network');
            return new Response(JSON.stringify(r.body), { status: r.status });
        }));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('puts the task on top: made true or false, the house of the reply kept', async () => {
        const house = { ...HOUSE, story: { status: null, task: { id: 'T0012', state: 'open' } }, rev: 'f247ecdcdd1b5980' };
        replies.push({ status: 200, body: { house, task: 'T0012', made: true, head: HEAD, parent: PARENT } });
        const r = await requestHouseStory(BASE, 'belokamen|16', F);
        expect(calls[0]!.url.startsWith(`${BASE}/houses/story`)).toBe(true);
        expect(calls[0]!.init?.method).toBe('POST');
        expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ house: 'belokamen|16' });
        expect(r).toMatchObject({ ok: true, task: 'T0012', made: true, head: HEAD, parent: PARENT });
        expect(r.ok && r.house?.story).toEqual({ status: null, task: { id: 'T0012', state: 'open' } });
        expect(houseCache(BASE).get('A0001')?.story).toMatchObject({ status: null });

        replies.push({ status: 200, body: { house, task: 'T0012', made: false, head: HEAD, parent: PARENT } });
        expect(await requestHouseStory(BASE, 'A0001', F)).toMatchObject({ ok: true, made: false });
        expect(JSON.parse(calls[1]!.init!.body as string)).toEqual({ house: 'A0001' });
    });

    it('asks nothing without the feature or with a wrong house', async () => {
        expect(await requestHouseStory(BASE, 'belokamen|16', ['house'])).toMatchObject({ ok: false, code: 'invalid' });
        expect(await requestHouseStory(BASE, 'bad house', F)).toMatchObject({ ok: false, code: 'invalid' });
        expect(calls).toHaveLength(0);
    });

    it('maps the refusals; no answer is network', async () => {
        expect(houseStoryReply(404, { error: 'house.unknown', code: 'house.unknown' }, F)).toMatchObject({ ok: false, code: 'unknown-house' });
        expect(houseStoryReply(400, { error: 'house.body', code: 'house.body', reasonCode: 'house.story.none' }, F)).toMatchObject({ code: 'none' });
        expect(houseStoryReply(400, { error: 'house.body', code: 'house.body' }, F)).toMatchObject({ code: 'invalid' });
        expect(houseStoryReply(409, { error: 'house.archive', code: 'house.archive', reasonCode: 'archive' }, F)).toMatchObject({ code: 'archive' });
        expect(houseStoryReply(423, { error: 'locked', code: 'locked' }, F)).toMatchObject({ code: 'locked' });
        expect(houseStoryReply(503, { error: 'research.busy', code: 'research.busy' }, F)).toMatchObject({ code: 'busy' });
        expect(houseStoryReply(507, { error: 'disk.full', code: 'disk.full' }, F)).toMatchObject({ code: 'full' });
        expect(houseStoryReply(500, { error: 'house.failed', code: 'house.failed' }, F)).toMatchObject({ ok: false, code: 'unknown' });
        expect(await requestHouseStory(BASE, 'belokamen|16', F)).toMatchObject({ ok: false, code: 'network' });
    });
});

describe('the link story?house=', () => {
    it('approves or keeps a house\'s story by its record, marked as a person\'s story is', () => {
        const fin = researchSchemeUrl('story', { tree: TREE, house: 'A0001', storyDo: 'final' });
        expect(fin).toBe(`strom-research://story?tree=${TREE}&house=A0001&do=final`);
        expect(researchSchemeUrl('story', { tree: TREE, house: 'a0001', storyDo: 'keep' })).toBe(`strom-research://story?tree=${TREE}&house=A0001&do=keep`);
        expect(researchLinkActionOf(fin!)).toMatchObject({ link: 'story', params: { house: 'A0001' } });
        expect(researchUrlMark(fin!)).toBe(researchUrlMark(`strom-research://story?tree=${TREE}&person=P0001&do=final`));
    });

    it('refuses a person beside the house and a wrong id', () => {
        expect(researchSchemeUrl('story', { tree: TREE, house: 'A0001', person: 'P0001' as never, storyDo: 'final' })).toBeNull();
        expect(researchSchemeUrl('story', { tree: TREE, house: 'belokamen|16', storyDo: 'final' })).toBeNull();
        expect(researchSchemeUrl('story', { tree: TREE, house: 'A0001', storyDo: 'burn' as never })).toBeNull();
    });
});

describe('What waits: a house\'s story', () => {
    const item = { id: 'A0001', what: 'Vyprávění o domě čp. 16 čeká na schválení', on: '', at: '2026-11-26', kind: 'story', section: 'decide', phase: 'todo', actions: [], house: 'belokamen|16' };

    it('is a house\'s story, no person, a decision with no task links', () => {
        const [w] = sanitizeWaiting([item], true);
        expect(w).toMatchObject({ id: 'A0001', kind: 'houseStory', house: 'belokamen|16' });
        expect(w).not.toHaveProperty('person');
        expect(waitingSection({ ...w!, section: undefined })).toBe('decide');
        expect(waitingTaskActions(w!)).toBeNull();
    });

    it('a person\'s story stays a person\'s; a story with neither is no house\'s', () => {
        const [p] = sanitizeWaiting([{ ...item, id: 'P0001', person: 'P0001', house: undefined }], true);
        expect(p).toMatchObject({ kind: 'story', person: 'P0001' });
        expect(p).not.toHaveProperty('house');
        const [n] = sanitizeWaiting([{ ...item, house: undefined }], true);
        expect(n?.kind).not.toBe('houseStory');
        const [bad] = sanitizeWaiting([{ ...item, id: 'T0001' }], true);
        expect(bad?.kind).not.toBe('houseStory');
    });
});
