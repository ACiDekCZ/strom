/**
 * Spec 048 U6, the core: an item waiting for images, a website or a check —
 * its actions by what the research offers and the bridge takes (a new
 * research, an older one without `waiting.answer` / `accepts.media.taskImages`
 * / `images` in actions, no actions at all, a phone), the state of its images,
 * files given their numbers, the answer and an image through the bridge with
 * every answer typed, the answer's draft, and the texts' plural forms.
 * Invented books, archives and hosts only.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { LiveWaiting, sanitizeAccepts, sanitizeWaiting, sanitizeWaitingInbox, researchLinkMark } from '../research-link.js';
import {
    IMAGES_ORDER, WaitActionView, assignImages, imageNumberOfName, imageRanges, imageSlotOptions, imagesArrived, imagesState, inboxNumbers,
    parseImageRanges, splitWaitingActions, taskImageProblem, waitingActions, waitingGroupMissing, waitingTaskActions,
} from '../research-waiting.js';
import {
    NO_WAITING_WRITES, WAITING_ANSWER_FEATURE, WaitingWrites, answerWaiting, clearWaitingDraft, readWaitingDraft, taskImageMime, taskImageReply,
    uploadTaskImage, waitingAnswerReply, waitingAnswerText, waitingDraftKey, waitingFileReply, waitingWrites, writeWaitingDraft,
} from '../research-waiting-write.js';
import { strings, setLanguage, type Language } from '../strings.js';

const BASE = 'http://127.0.0.1:47321/0123456789abcdef';
const HEAD = 'c'.repeat(40);
const AT = '2026-11-02T08:00:00Z';
const ARCHIVE = { key: 'archive:zemsky-archiv-vzorov', name: 'Zemský archiv ve Vzorově', kind: 'archive', url: 'https://digi.archiv-vzorov.example/' };

const items = (raw: Record<string, unknown>[]): LiveWaiting[] => sanitizeWaiting(raw, true);
const imagesItem = (extra: Record<string, unknown> = {}) => ({
    id: 'T0412', what: 'Rodný zápis, fara Dolní Vzorov', at: AT, kind: 'images', section: 'images', group: ARCHIVE,
    url: 'https://digi.archiv-vzorov.example/kniha/4-12',
    inbox: { dir: '/x/inbox/T0412', folder: 'T0412', have: 1, want: 2, missing: [58], book: 'Matrika N Dolní Vzorov 1890–1905', images: '57–58', recordset: 'B0012', lying: 0 },
    actions: ['answer', 'images', 'folder', 'chat'], ...extra,
});
const webItem = (extra: Record<string, unknown> = {}) => ({
    id: 'T0420', what: 'Kde jsou matriky fary Horní Vzorov před 1850?', at: AT, kind: 'web', section: 'web', group: ARCHIVE,
    url: 'https://digi.archiv-vzorov.example/', actions: ['answer', 'chat'], ...extra,
});
const checkItem = (extra: Record<string, unknown> = {}) => ({
    id: 'T0425', what: 'Funguje badatelna archivu Vzorov?', at: AT, kind: 'check', section: 'decide', url: 'https://badatelna.vzorov.example/',
    actions: ['answer', 'chat'], ...extra,
});

const NEW: WaitingWrites = { ...NO_WAITING_WRITES, answer: true, images: true };
const ctx = (over: Partial<Parameters<typeof waitingActions>[1]> = {}) => ({ writes: NEW, links: true, phone: false, ...over });
const keys = (list: WaitActionView[] | null) => list?.map(a => `${a.key}:${a.via}${a.ai ? '+ai' : ''}`) ?? null;

describe('what the status says (research 1.27)', () => {
    it('accepts.media.taskImages and waiting.answer only when announced exactly', () => {
        expect(sanitizeAccepts({ media: { taskImages: true } })?.mediaTaskImages).toBe(true);
        for (const v of ['true', 1, {}, false, undefined]) expect(sanitizeAccepts({ media: { taskImages: v } })).not.toHaveProperty('mediaTaskImages');
        expect(waitingWrites({ features: [WAITING_ANSWER_FEATURE], accepts: sanitizeAccepts({ media: { task: true, taskImages: true } }) }))
            .toEqual({ sent: false, note: false, file: true, answer: true, images: true });
        expect(waitingWrites({ features: ['waiting.sent'], accepts: sanitizeAccepts({ media: { task: true } }) })).toMatchObject({ answer: false, images: false });
    });

    it('an item\'s inbox with the book, the missing numbers and an unknown count; the action images kept', () => {
        const [w] = items([imagesItem()]);
        expect(w.inbox).toEqual({ dir: '/x/inbox/T0412', folder: 'T0412', have: 1, want: 2, missing: [58], book: 'Matrika N Dolní Vzorov 1890–1905', images: '57–58', recordset: 'B0012', lying: 0 });
        expect(w.actions).toEqual(['answer', 'folder', 'images', 'chat']);
        // Unknown count: no want (or 0); missing sorted, each once, invalid numbers dropped, at most 50.
        expect(sanitizeWaitingInbox({ dir: 'd', have: 2 })).toEqual({ dir: 'd', have: 2 });
        expect(sanitizeWaitingInbox({ have: 0, want: 0 })).toEqual({ dir: '', have: 0 });
        expect(sanitizeWaitingInbox({ have: 0, want: 3, missing: [60, 58, 58, 0, -1, 2.5, '59', 1_000_000, 59] })?.missing).toEqual([58, 59, 60]);
        expect(sanitizeWaitingInbox({ have: 0, want: 80, missing: Array.from({ length: 80 }, (_, i) => i + 1) })?.missing).toHaveLength(50);
        expect(sanitizeWaitingInbox({ have: 1, book: 'x'.repeat(300), recordset: 'X12', lying: -2 })).toEqual({ dir: '', have: 1, book: 'x'.repeat(119) + '…' });
        // Without a count of what is there it is none.
        expect(sanitizeWaitingInbox({ want: 2 })).toBeNull();
        expect(sanitizeWaitingInbox('x')).toBeNull();
    });

    it('a group of an archive with its website (http/https only)', () => {
        expect(items([imagesItem()])[0].group).toEqual(ARCHIVE);
        expect(items([imagesItem({ group: { ...ARCHIVE, url: 'javascript:alert(1)' } })])[0].group).toEqual({ key: ARCHIVE.key, name: ARCHIVE.name, kind: 'archive' });
    });

    it('the old task-link actions never carry images (it goes through the bridge)', () => {
        expect(waitingTaskActions(items([imagesItem()])[0])).toEqual(['chat', 'answer', 'folder']);
    });
});

describe('an item\'s actions (§1, §5, §9)', () => {
    it('images of a book, a new research: Add images · Open website · Answer · Discuss · Open folder', () => {
        const [w] = items([imagesItem()]);
        expect(keys(waitingActions(w, ctx()))).toEqual(['images:bridge', 'web:web', 'answer:bridge', 'chat:terminal+ai', 'folder:terminal']);
        // A website with one book is the same.
        const [web] = items([webItem({ inbox: { dir: '', have: 2 }, actions: ['answer', 'images', 'folder', 'chat'] })]);
        expect(keys(waitingActions(web, ctx()))).toEqual(['images:bridge', 'web:web', 'answer:bridge', 'chat:terminal+ai', 'folder:terminal']);
        // Variant B: one order array.
        expect(keys(waitingActions(w, ctx({ order: ['web', 'images', 'answer', 'chat', 'folder'] })))?.slice(0, 2)).toEqual(['web:web', 'images:bridge']);
        expect(IMAGES_ORDER).toEqual(['images', 'web', 'answer', 'chat', 'folder']);
    });

    it('a website without a book and a check: the answer leads; a check is answered in the terminal', () => {
        expect(keys(waitingActions(items([webItem()])[0], ctx()))).toEqual(['answer:bridge', 'web:web', 'chat:terminal+ai']);
        expect(keys(waitingActions(items([checkItem()])[0], ctx()))).toEqual(['answer:terminal', 'web:web', 'chat:terminal+ai']);
    });

    it('the marks agree with the research links\' map (terminal, agent + terminal)', () => {
        expect(researchLinkMark('task', { taskDo: 'folder' })).toBe('terminal');
        expect(researchLinkMark('task', { taskDo: 'chat' })).toBe('agent');
        expect(researchLinkMark('task')).toBe('terminal');
    });

    it('an older bridge (no waiting.answer, no taskImages): today\'s actions, the website leads images', () => {
        const old = { writes: NO_WAITING_WRITES, links: true, phone: false };
        // An older research names no `images` action either.
        const [w] = items([imagesItem({ actions: ['answer', 'folder', 'chat'], inbox: { dir: '/x', have: 1, want: 2 } })]);
        expect(keys(waitingActions(w, old))).toEqual(['web:web', 'answer:terminal', 'chat:terminal+ai', 'folder:terminal']);
        // taskImages announced but the item does not offer images (no shared folder): none.
        expect(keys(waitingActions(w, ctx()))).toEqual(['web:web', 'answer:bridge', 'chat:terminal+ai', 'folder:terminal']);
        // images offered but the bridge does not take them: none.
        expect(keys(waitingActions(items([imagesItem()])[0], { ...old, writes: { ...NO_WAITING_WRITES, answer: true } }))?.[0]).toBe('web:web');
    });

    it('no actions named at all: the answer by the task link and the website', () => {
        const [w] = items([imagesItem({ actions: undefined })]);
        expect(keys(waitingActions(w, { writes: NO_WAITING_WRITES, links: true, phone: false }))).toEqual(['web:web', 'answer:terminal']);
        // No task links here (another browser, a sandbox): only the website.
        expect(keys(waitingActions(w, { writes: NO_WAITING_WRITES, links: false, phone: false }))).toEqual(['web:web']);
        // An empty list offers nothing but the website.
        expect(keys(waitingActions(items([imagesItem({ actions: [] })])[0], ctx()))).toEqual(['web:web']);
    });

    it('a phone: only what goes through the bridge, and the website', () => {
        const [w] = items([imagesItem()]);
        expect(keys(waitingActions(w, ctx({ phone: true })))).toEqual(['web:web', 'answer:bridge']);
        expect(keys(waitingActions(w, { writes: NO_WAITING_WRITES, links: true, phone: true }))).toEqual(['web:web']);
        expect(keys(waitingActions(items([checkItem()])[0], ctx({ phone: true })))).toEqual(['web:web']);
    });

    it('other kinds keep their actions (null); a bad task id offers only the website', () => {
        for (const kind of ['letter', 'family', 'other', 'takeover']) {
            expect(waitingActions(items([{ id: 'T0001', what: 'x', kind, actions: ['answer'] }])[0], ctx())).toBeNull();
        }
        expect(keys(waitingActions(items([webItem({ id: 'X12' })])[0], ctx()))).toEqual(['web:web']);
    });

    it('main + 2 beside it (3 when wide), the rest under More; a phone main + 1 and nothing more', () => {
        const list = waitingActions(items([imagesItem()])[0], ctx())!;
        expect(keys(splitWaitingActions(list, { phone: false }).shown)).toEqual(['images:bridge', 'web:web', 'answer:bridge']);
        expect(keys(splitWaitingActions(list, { phone: false }).more)).toEqual(['chat:terminal+ai', 'folder:terminal']);
        expect(splitWaitingActions(list, { phone: false, wide: true }).more).toHaveLength(1);
        expect(splitWaitingActions(list, { phone: true })).toEqual({ shown: list.slice(0, 2), more: [] });
    });
});

describe('the state of the images (§4)', () => {
    it('full: the numbers asked for, saved and missing', () => {
        const s = imagesState(items([imagesItem()])[0]);
        expect(s).toMatchObject({ have: 1, want: 2, missing: [58], book: 'Matrika N Dolní Vzorov 1890–1905', detail: 'full', wanted: [57, 58], saved: [57] });
    });

    it('an older research: have/want only; unknown count; no inbox or another kind: none', () => {
        expect(imagesState(items([imagesItem({ inbox: { dir: '', have: 1, want: 2 } })])[0])).toEqual({ have: 1, want: 2, detail: 'old' });
        expect(imagesState(items([webItem({ inbox: { have: 2, book: 'Matrika Z' } })])[0])).toEqual({ have: 2, book: 'Matrika Z', detail: 'unknown' });
        expect(imagesState(items([webItem()])[0])).toBeNull();
        expect(imagesState(items([{ id: 'T0001', what: 'x', kind: 'letter', inbox: { have: 1, want: 2 } }])[0])).toBeNull();
    });

    it('the numbers from the text, checked against the count; nothing saved: the missing are all', () => {
        expect(parseImageRanges('57–58, 60')).toEqual([57, 58, 60]);
        expect(parseImageRanges('112')).toEqual([112]);
        expect(parseImageRanges('5-3')).toBeNull();
        expect(parseImageRanges('1–5000')).toBeNull();
        expect(parseImageRanges('')).toBeNull();
        expect(imageRanges([60, 57, 58, 58])).toBe('57–58, 60');
        expect(inboxNumbers({ dir: '', have: 0, want: 2, missing: [57, 58] })).toEqual({ wanted: [57, 58], saved: [] });
        // The text does not match the count: only what is missing is known.
        expect(inboxNumbers({ dir: '', have: 1, want: 3, missing: [58], images: '57–58' })).toEqual({ wanted: [58], saved: [] });
        expect(inboxNumbers({ dir: '', have: 1 })).toBeNull();
    });

    it('what arrived meanwhile; a place\'s missing images together', () => {
        const before = imagesState(items([imagesItem({ inbox: { have: 0, want: 2, missing: [57, 58] } })])[0]);
        const now = imagesState(items([imagesItem()])[0]);
        expect(imagesArrived(before, now)).toEqual([57]);
        expect(imagesArrived(now, now)).toEqual([]);
        const list = items([imagesItem(), imagesItem({ id: 'T0415', inbox: { have: 0, want: 1, missing: [112] } }), webItem()]);
        expect(waitingGroupMissing(list)).toBe(2);
        expect(waitingGroupMissing(items([imagesItem({ inbox: { have: 1, want: 2 } })]))).toBeNull();
    });
});

describe('files given their numbers (§3)', () => {
    const f = (name: string, size = 1000) => ({ name, size });

    it('the number of the name: its last group of digits, without leading zeros', () => {
        expect(imageNumberOfName('DA_4-12_0058.tif')).toBe(58);
        expect(imageNumberOfName('IMG_0057.JPG')).toBe(57);
        expect(imageNumberOfName('kniha-00057.jpg')).toBe(57);
        expect(imageNumberOfName('scan.jpg')).toBeNull();
        expect(imageNumberOfName('Snímek 20261104.png')).toBeNull();
        expect(imageNumberOfName('0000.jpg')).toBeNull();
    });

    it('by name when asked for and free; the rest in order only when the counts match', () => {
        const r = assignImages([f('DA_4-12_0058.tif'), f('IMG_4472.jpg')], [57, 58, 59], []);
        expect(r.files.map(a => [a.num, a.how])).toEqual([[58, 'name'], [null, null]]);
        expect(r).toMatchObject({ needAssign: 1, needDecide: 0, sendable: 2 });
        // Two files, two missing: in order by name.
        const o = assignImages([f('b.jpg'), f('a.jpg')], [57, 58], []);
        expect(o.files.map(a => [a.num, a.how])).toEqual([[58, 'order'], [57, 'order']]);
        expect(o.needAssign).toBe(0);
    });

    it('a number the task does not ask for: none, said', () => {
        const r = assignImages([f('DA_4-12_0059.jpg'), f('DA_4-12_0058.tif')], [57, 58], [57]);
        expect(r.files[0]).toMatchObject({ num: null, how: null, nameNum: 59, unwanted: true });
        expect(r.files[1]).toMatchObject({ num: 58, how: 'name', unwanted: false });
    });

    it('a saved number found by itself: Replace or Keep; chosen by hand: replace it', () => {
        const r = assignImages([f('DA_0057.jpg')], [57, 58], [57]);
        expect(r.files[0]).toMatchObject({ num: 57, how: 'name', replace: 'ask' });
        expect(r.needDecide).toBe(1);
        const hand = assignImages([f('DA_0057.jpg')], [57, 58], [57], { chosen: [57] });
        expect(hand.files[0]).toMatchObject({ num: 57, how: 'hand', replace: 'yes' });
        expect(hand.needDecide).toBe(0);
        // Chosen by hand first; the name's number then is taken.
        const two = assignImages([f('x_0058.jpg'), f('y.jpg')], [57, 58], [], { chosen: [undefined, 58] });
        expect(two.files.map(a => [a.num, a.how])).toEqual([[57, 'order'], [58, 'hand']]);
    });

    it('the same number twice: the first by name, the other without', () => {
        const r = assignImages([f('b_0058.jpg'), f('a_0058.jpg')], [57, 58, 59], []);
        expect(r.files.map(a => [a.num, a.how])).toEqual([[null, null], [58, 'name']]);
    });

    it('unknown count: every file without a number, nothing waits', () => {
        const r = assignImages([f('IMG_5010.jpg'), f('IMG_5011.jpg')], null, []);
        expect(r.files.every(a => a.num === null && a.how === 'unknown')).toBe(true);
        expect(r).toMatchObject({ needAssign: 0, needDecide: 0, sendable: 2 });
    });

    it('a lone PDF and more missing: without a number (the research spreads the pages)', () => {
        const r = assignImages([f('matrika.pdf')], [57, 58], []);
        expect(r.files[0]).toMatchObject({ num: null, how: 'pdf' });
        expect(r.needAssign).toBe(0);
        // One missing: in order.
        expect(assignImages([f('matrika.pdf')], [57, 58], [57]).files[0]).toMatchObject({ num: 58, how: 'order' });
    });

    it('checked before: a kind not taken, too large — left out of the numbers, not sent', () => {
        const r = assignImages([f('poznamky.docx'), f('DA_0058.tif', 600), f('DA_0057.jpg', 400)], [57, 58], [], { maxBytes: 500 });
        expect(r.files.map(a => a.problem ?? null)).toEqual(['format', 'size', null]);
        expect(r.files[2]).toMatchObject({ num: 57, how: 'name' });
        expect(r.sendable).toBe(1);
        expect(taskImageProblem({ name: 'a.HEIC', size: 1 }, 10)).toBeNull();
        expect(taskImageProblem({ name: 'a', size: 1 }, 10)).toBe('format');
    });

    it('the choices of a file: every number asked for, saved, at another file', () => {
        const r = assignImages([f('DA_0058.jpg'), f('x.jpg')], [57, 58, 59], [57]);
        expect(imageSlotOptions(r, 1, [57, 58, 59], [57])).toEqual([{ n: 57, saved: true }, { n: 58, saved: false, takenBy: 0 }, { n: 59, saved: false }]);
    });
});

describe('the bridge\'s answers, typed', () => {
    it('an answer: 200 the task back; every refusal by its code', () => {
        expect(waitingAnswerReply(200, { task: 'T0420', state: 'open', head: HEAD, parent: HEAD })).toEqual({ ok: true, task: 'T0420', head: HEAD, parent: HEAD });
        expect(waitingAnswerReply(404, { code: 'waiting.none', id: 'T0420' })).toMatchObject({ ok: false, code: 'none', status: 404 });
        expect(waitingAnswerReply(409, { code: 'waiting.changed', id: 'T0420', at: '2026-11-03T10:00:00Z' }))
            .toMatchObject({ ok: false, code: 'changed', at: '2026-11-03T10:00:00Z' });
        expect(waitingAnswerReply(409, { code: 'waiting.no-answer', id: 'T0425', kind: 'check' })).toMatchObject({ ok: false, code: 'no-answer' });
        expect(waitingAnswerReply(400, { code: 'waiting.bad-body' })).toMatchObject({ code: 'bad-body' });
        expect(waitingAnswerReply(403, { code: 'app.only' })).toMatchObject({ code: 'app-only' });
        expect(waitingAnswerReply(423, { code: 'locked' })).toMatchObject({ code: 'locked' });
        expect(waitingAnswerReply(503, { code: 'research.busy' }, '30')).toMatchObject({ code: 'busy', retryAfter: 30 });
        expect(waitingAnswerReply(507, { code: 'media.full' })).toMatchObject({ code: 'full' });
        expect(waitingAnswerReply(500, { code: 'waiting.failed' })).toMatchObject({ code: 'failed' });
        expect(waitingAnswerReply(200, 'x')).toMatchObject({ ok: false });
    });

    it('an image: 200 with its numbers, the inbox and woken; every refusal by its code', () => {
        expect(taskImageReply(200, {
            task: 'T0412', recordset: 'B0012', image: 58, images: [58], by: 'name', added: ['M0101'], same: false, replaced: [], aside: [],
            woken: false, back: [], inbox: { have: 1, want: 2, missing: [57] }, state: 'waiting', head: HEAD, parent: HEAD,
        })).toEqual({
            ok: true, task: 'T0412', image: 58, images: [58], by: 'name', same: false, woken: false,
            inbox: { dir: '', have: 1, want: 2, missing: [57] }, added: ['M0101'], replaced: [], head: HEAD, parent: HEAD,
        });
        expect(taskImageReply(200, { task: 'T0412', images: [57, 58, 59], woken: true, same: true, by: 'x' }))
            .toMatchObject({ image: 57, images: [57, 58, 59], woken: true, same: true, by: null, inbox: null });
        const refused: [number, Record<string, unknown>, Record<string, unknown>][] = [
            [409, { code: 'waiting.image-exists', image: 57, task: 'T0412' }, { code: 'image-exists', image: 57 }],
            [409, { code: 'waiting.image-unwanted', want: [58, 57], task: 'T0412' }, { code: 'image-unwanted', want: [57, 58] }],
            [409, { code: 'waiting.image-unknown', missing: [58, 59], task: 'T0412' }, { code: 'image-unknown', missing: [58, 59] }],
            [415, { code: 'waiting.pdf' }, { code: 'pdf' }],
            [415, { code: 'media.type' }, { code: 'type' }],
            [413, { code: 'media.large' }, { code: 'too-large' }],
            [507, { code: 'media.full' }, { code: 'full' }],
            [409, { code: 'waiting.none', id: 'T0412' }, { code: 'none' }],
            [409, { code: 'waiting.no-file', id: 'T0425' }, { code: 'no-file' }],
            [409, { code: 'waiting.no-images' }, { code: 'no-images' }],
            [400, { code: 'media.bad-header', header: 'X-Strom-Image' }, { code: 'bad-body' }],
            [503, { code: 'research.busy' }, { code: 'busy' }],
            [423, { code: 'locked' }, { code: 'locked' }],
            [500, { code: 'media.failed' }, { code: 'failed' }],
        ];
        for (const [status, body, want] of refused) expect(taskImageReply(status, body)).toMatchObject({ ok: false, status, ...want });
        // An image-exists without a valid number keeps none.
        expect(taskImageReply(409, { code: 'waiting.image-exists', image: 'x' })).not.toHaveProperty('image');
    });

    it('the same as an image taken already (409 waiting.image-same): its id, place and number, cleaned', () => {
        expect(taskImageReply(409, {
            error: 'the same', code: 'waiting.image-same', image: 10, same: 'M0042', as: 'B0012:9', sameRecordset: 'B0012', sameImage: 9, task: 'T0412',
        })).toEqual({
            ok: false, code: 'image-same', status: 409, retryAfter: null, reason: 'the same',
            image: 10, same: 'M0042', as: 'B0012:9', sameRecordset: 'B0012', sameImage: 9,
        });
        // A number as text is taken; a malformed id, book or number is left out; the place is one line, capped.
        expect(taskImageReply(409, { code: 'waiting.image-same', same: 'M0042', sameImage: '9' })).toMatchObject({ code: 'image-same', sameImage: 9 });
        const bad = taskImageReply(409, { code: 'waiting.image-same', image: 'x', same: '<b>M1</b>', sameRecordset: 'X1', sameImage: 0, as: `B1:9\n${'x'.repeat(200)}` });
        expect(bad).toMatchObject({ ok: false, code: 'image-same' });
        for (const k of ['image', 'same', 'sameRecordset', 'sameImage']) expect(bad).not.toHaveProperty(k);
        expect(bad.ok === false && bad.as).toMatch(/^B1:9 x+…$/);
        expect(bad.ok === false && bad.as?.length).toBe(80);
    });

    it('the older file answer keeps its codes; the new ones are not "unknown" any more', () => {
        expect(waitingFileReply(409, { code: 'waiting.image-unknown', missing: [3] })).toMatchObject({ code: 'image-unknown', missing: [3] });
        expect(waitingFileReply(409, { code: 'something.else' })).toMatchObject({ code: 'unknown' });
    });
});

describe('the requests', () => {
    let calls: { url: string; init: RequestInit }[] = [];
    const answer = (status: number, body: unknown) => {
        calls = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
            calls.push({ url, init });
            return new Response(JSON.stringify(body), { status });
        }));
    };
    afterEach(() => vi.unstubAllGlobals());

    it('an answer: POST <token>/waiting/<T…> {do: answer, text, expect}, the text NFC and trimmed', async () => {
        answer(200, { task: 'T0420', state: 'open', head: HEAD });
        expect(await answerWaiting(BASE, 'T0420', { text: '  Matriky jsou ve fondu Velkostatek Vzorov.\n', expect: AT }))
            .toEqual({ ok: true, task: 'T0420', head: HEAD });
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toMatch(/\/waiting\/T0420\?app=/);
        expect(calls[0].init).toMatchObject({ method: 'POST', mode: 'cors', credentials: 'omit' });
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ do: 'answer', text: 'Matriky jsou ve fondu Velkostatek Vzorov.', expect: AT });
        answer(200, { task: 'T0420' });
        await answerWaiting(BASE, 'T0420', { text: 'Café' });
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ do: 'answer', text: 'Café' });
    });

    it('an answer not sent: empty, too long, a wrong task', async () => {
        answer(200, {});
        expect(await answerWaiting(BASE, 'T0420', { text: '   ' })).toMatchObject({ ok: false, code: 'invalid' });
        expect(await answerWaiting(BASE, 'T0420', { text: 'x'.repeat(4001) })).toMatchObject({ ok: false, code: 'invalid' });
        expect(await answerWaiting(BASE, 'P0001', { text: 'x' })).toMatchObject({ ok: false, code: 'invalid' });
        expect(calls).toHaveLength(0);
        expect(waitingAnswerText('x'.repeat(4000))).toHaveLength(4000);
        expect(waitingAnswerText('a\u0000b')).toBe('ab');
    });

    it('an answer the bridge refuses: changed with the item\'s at now; no answer: network', async () => {
        answer(409, { code: 'waiting.changed', id: 'T0420', at: '2026-11-03T10:00:00Z' });
        expect(await answerWaiting(BASE, 'T0420', { text: 'x', expect: AT })).toMatchObject({ ok: false, code: 'changed', at: '2026-11-03T10:00:00Z' });
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
        expect(await answerWaiting(BASE, 'T0420', { text: 'x' })).toMatchObject({ ok: false, code: 'network' });
    });

    it('an image: PUT <token>/media/<sha256> with the task, number, replace and name', async () => {
        answer(200, { task: 'T0412', image: 58, images: [58], by: 'image', woken: true, inbox: { have: 2, want: 2, missing: [] } });
        const file = new File(['II*\u0000 snímek'], 'DA_4-12_0058.tif');
        const progress: number[] = [];
        const r = await uploadTaskImage(BASE, 'T0412', file, { image: 58, replace: true, onProgress: s => progress.push(s) });
        expect(r).toMatchObject({ ok: true, image: 58, woken: true, inbox: { have: 2, want: 2, missing: [] } });
        expect(calls[0].url).toMatch(/\/media\/[0-9a-f]{64}\?app=/);
        expect(calls[0].init).toMatchObject({ method: 'PUT', mode: 'cors', credentials: 'omit' });
        const headers = calls[0].init.headers as Record<string, string>;
        expect(headers).toMatchObject({
            'X-Strom-Task': 'T0412', 'X-Strom-Image': '58', 'X-Strom-Replace': '1', 'X-Strom-Name': 'DA_4-12_0058.tif', 'Content-Type': 'image/tiff',
        });
        expect(calls[0].init.body).toBe(file);
        expect(progress[progress.length - 1]).toBe(file.size);
        // No number, no replace: neither header.
        answer(200, { task: 'T0412' });
        await uploadTaskImage(BASE, 'T0412', file);
        const h2 = calls[0].init.headers as Record<string, string>;
        expect(h2['X-Strom-Image']).toBeUndefined();
        expect(h2['X-Strom-Replace']).toBeUndefined();
    });

    it('an image not sent: too large, a wrong number or task', async () => {
        answer(200, {});
        const file = new File(['x'.repeat(100)], 'a.jpg', { type: 'image/jpeg' });
        expect(await uploadTaskImage(BASE, 'T0412', file, { maxBytes: 10 })).toMatchObject({ ok: false, code: 'too-large' });
        expect(await uploadTaskImage(BASE, 'T0412', file, { image: 0 })).toMatchObject({ ok: false, code: 'invalid' });
        expect(await uploadTaskImage(BASE, 'T0412', file, { image: 1_000_000 })).toMatchObject({ ok: false, code: 'invalid' });
        expect(await uploadTaskImage(BASE, 'P0001', file)).toMatchObject({ ok: false, code: 'invalid' });
        expect(calls).toHaveLength(0);
        expect(taskImageMime({ type: '', name: 'a.HEIC' })).toBe('image/heic');
        expect(taskImageMime({ type: '', name: 'a.xyz' })).toBe('application/octet-stream');
    });

    it('with XMLHttpRequest: its upload progress said, the answer read', async () => {
        const sent: { headers: Record<string, string>; body: unknown }[] = [];
        class FakeXhr {
            upload: { onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null } = { onprogress: null };
            status = 0; responseText = ''; timeout = 0; withCredentials = true;
            onload: (() => void) | null = null; onerror: (() => void) | null = null; ontimeout: (() => void) | null = null; onabort: (() => void) | null = null;
            private h: Record<string, string> = {};
            open(): void { /* no-op */ }
            setRequestHeader(k: string, v: string): void { this.h[k] = v; }
            getResponseHeader(): string | null { return null; }
            send(body: unknown): void {
                sent.push({ headers: this.h, body });
                this.upload.onprogress?.({ loaded: 3, total: 6, lengthComputable: true });
                this.upload.onprogress?.({ loaded: 6, total: 6, lengthComputable: true });
                this.status = 409;
                this.responseText = JSON.stringify({ code: 'waiting.image-unwanted', want: [57, 58] });
                setTimeout(() => this.onload?.(), 0);
            }
        }
        vi.stubGlobal('XMLHttpRequest', FakeXhr);
        const progress: [number, number][] = [];
        const r = await uploadTaskImage(BASE, 'T0412', new File(['abcdef'], 'IMG_0059.jpg', { type: 'image/jpeg' }), { image: 59, onProgress: (s, t) => progress.push([s, t]) });
        expect(r).toMatchObject({ ok: false, code: 'image-unwanted', want: [57, 58] });
        expect(progress).toEqual([[3, 6], [6, 6]]);
        expect(sent[0].headers['X-Strom-Image']).toBe('59');
    });
});

describe('the answer\'s draft (on this device)', () => {
    const store = () => {
        const m = new Map<string, string>();
        return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, m };
    };

    it('kept per tree and task, blank drops it, cleared after the answer', () => {
        const s = store();
        expect(waitingDraftKey('tree-1', 'T0420')).toBe('strom.waiting.draft.tree-1.T0420');
        expect(waitingDraftKey('tree-1', 'x')).toBeNull();
        writeWaitingDraft('tree-1', 'T0420', 'Matriky jsou', s);
        expect(readWaitingDraft('tree-1', 'T0420', s)).toBe('Matriky jsou');
        expect(readWaitingDraft('tree-2', 'T0420', s)).toBe('');
        writeWaitingDraft('tree-1', 'T0420', '  ', s);
        expect(s.m.size).toBe(0);
        writeWaitingDraft('tree-1', 'T0420', 'x', s);
        clearWaitingDraft('tree-1', 'T0420', s);
        expect(s.m.size).toBe(0);
    });

    it('storage refused or not there: nothing kept, nothing thrown', () => {
        const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } };
        expect(() => writeWaitingDraft('t', 'T0420', 'x', broken)).not.toThrow();
        expect(readWaitingDraft('t', 'T0420', broken)).toBe('');
        expect(readWaitingDraft('t', 'T0420', null)).toBe('');
    });
});

describe('the texts (§10): plural forms, "z" / "ze"', () => {
    afterEach(() => setLanguage('en'));
    const T = (lang: Language) => {
        setLanguage(lang);
        return strings.live.waitingTask;
    };

    it('cs: 1 / 2–4 / 5+, "ze" before 2, 3, 4, 7', () => {
        const t = T('cs');
        expect(t.imagesShort(1, 2)).toBe('1 ze 2 snímků');
        expect(t.imagesShort(0, 1)).toBe('0 z 1 snímku');
        expect(t.imagesShort(3, 5)).toBe('3 z 5 snímků');
        expect(t.imagesShort(3, 7)).toBe('3 ze 7 snímků');
        expect(t.imagesState(1, 2, '58', 1)).toBe('Uloženo 1 ze 2 snímků – chybí snímek 58.');
        expect(t.imagesNone('112', 1)).toBe('Zatím žádný snímek – chybí snímek 112.');
        expect(t.imagesNeeded('57–58', 2)).toBe('snímky 57–58');
        expect(t.imagesStateOld(1, 2)).toBe('Uloženo 1 ze 2 snímků.');
        expect(t.imagesUnknown(2)).toBe('Uloženo 2 snímky');
        expect(t.imagesUnknown(5)).toBe('Uloženo 5 snímků');
        expect(t.groupMissing(2)).toBe('2 snímky chybí');
        expect(t.groupMissing(5)).toBe('5 snímků chybí');
        expect(t.sendImages(1)).toBe('Odeslat 1 snímek');
        expect(t.sendImages(2)).toBe('Odeslat 2 snímky');
        expect(t.sendingN(1)).toBe('Posílá se 1 soubor…');
        expect(t.sendingN(3)).toBe('Posílají se 3 soubory…');
        expect(t.needAssign(1)).toBe('U 1 souboru chybí číslo snímku.');
        expect(t.sendingProgress(16, 38)).toBe('posílá se · 16 ze 38 MB');
        expect(t.justArrived('57', 1)).toBe('přibyl snímek 57');
    });

    it('pl: 1 / 2–4 (not 12–14) / 5+', () => {
        const t = T('pl');
        expect(t.imagesShort(1, 2)).toBe('1 z 2 skanów');
        expect(t.imagesUnknown(2)).toBe('Zapisano 2 skany');
        expect(t.imagesUnknown(12)).toBe('Zapisano 12 skanów');
        expect(t.imagesUnknown(22)).toBe('Zapisano 22 skany');
        expect(t.sendImages(5)).toBe('Wyślij 5 skanów');
        expect(t.groupMissing(2)).toBe('brak 2 skanów');
    });

    it('en, de', () => {
        expect(T('en').imagesState(1, 2, '58', 1)).toBe('1 of 2 images saved – image 58 missing.');
        expect(T('en').sendImages(1)).toBe('Send 1 image');
        expect(T('de').imagesState(1, 2, '58', 1)).toBe('1 von 2 Bildern gespeichert – es fehlt Bild 58.');
        expect(T('de').groupMissing(2)).toBe('2 Bilder fehlen');
    });

    it('a file the same as an image taken already, in four languages (its number and id when said)', () => {
        expect(T('en').sameAs(9, 'M0042')).toBe('Same as image 9 (M0042) – not added.');
        expect(T('en').sameAs(null, 'M0042')).toBe('Same as an image already saved (M0042) – not added.');
        expect(T('en').sameAs(null, '')).toBe('Same as an image already saved – not added.');
        expect(T('cs').sameAs(9, 'M0042')).toBe('Stejný jako snímek 9 (M0042) – nepřidáno.');
        expect(T('cs').sameAs(null, 'M0042')).toBe('Stejný jako už uložený snímek (M0042) – nepřidáno.');
        expect(T('de').sameAs(9, 'M0042')).toBe('Identisch mit Bild 9 (M0042) – nicht hinzugefügt.');
        expect(T('pl').sameAs(9, 'M0042')).toBe('Identyczny ze skanem 9 (M0042) – nie dodano.');
        expect(T('pl').sameAs(9, '')).toBe('Identyczny ze skanem 9 – nie dodano.');
    });

    it('a file the research had under that number already (200 same: true), in four languages', () => {
        expect(T('en').alreadySaved('112', 1)).toBe('Already saved as image 112.');
        expect(T('en').alreadySaved('3–5', 3)).toBe('Already saved as images 3–5.');
        expect(T('en').alreadySaved(null, 0)).toBe('Already saved.');
        expect(T('cs').alreadySaved('112', 1)).toBe('Už bylo uloženo jako snímek 112.');
        expect(T('cs').alreadySaved(null, 0)).toBe('Už bylo uloženo.');
        expect(T('de').alreadySaved('112', 1)).toBe('Bereits als Bild 112 gespeichert.');
        expect(T('pl').alreadySaved('112', 1)).toBe('Już zapisano jako skan 112.');
        for (const lang of ['en', 'cs', 'de', 'pl'] as const) expect(T(lang).alreadySaved('1', 1)).not.toMatch(/✓|\b(you|your|vy|váš|Sie|Ihr)\b/i);
    });
});
