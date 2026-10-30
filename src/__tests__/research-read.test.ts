/**
 * "Read a document" (spec 013): what the bridge says about reading is checked
 * and cleaned, its refusals map to the app's states, the files a reading
 * takes. Invented data only (Novák, Lhota).
 */

import { describe, it, expect } from 'vitest';
import {
    sanitizeReadAccepts, sanitizeReads, sanitizeLiveRead, sanitizeReadResult, readFailure, retryAfter,
    readFileRefusals, readFileMime, readFileKind, readPageImageUrl, readDocYear, readUsualMinutes, readRunning, readSlow, cleanBlock,
    readEndsToAnnounce, readSuperseded, LiveRead, ReadMemo, ReadState,
} from '../research-read.js';
import { sanitizeLiveStatus, sanitizeAccepts } from '../research-link.js';

const ID = 'D20261019153012-a1b2';
const SHA = 'a'.repeat(64);

describe('accepts.read', () => {
    it('takes a ready reader with its limits', () => {
        expect(sanitizeReadAccepts({
            ready: true, why: null, readers: 2, types: ['image/jpeg', 'image/png', 'application/pdf'], max: 52428800, pages: 10, langs: ['cs', 'de', 'en'],
        })).toEqual({ ready: true, why: '', resets: '', readers: 2, types: ['image/jpeg', 'image/png', 'application/pdf'], max: 52428800, pages: 10, langs: ['cs', 'de', 'en'] });
    });

    it('says why not, with when a limit ends', () => {
        const a = sanitizeReadAccepts({ ready: false, why: 'limit', resets: '2026-10-20T15:00:00Z', readers: 1, types: [], max: 1 });
        expect(a).toMatchObject({ ready: false, why: 'limit', resets: '2026-10-20T15:00:00Z', readers: 1, types: ['image/jpeg', 'image/png'] });
        expect(sanitizeReadAccepts({ ready: false, why: '<b>x</b>' })?.why).toBe('other');
        expect(sanitizeReadAccepts({ ready: false })?.why).toBe('other');
    });

    it('drops bad values, keeps sane defaults', () => {
        const a = sanitizeReadAccepts({ ready: 'yes', readers: 7, types: ['image/jpeg', 'nonsense', 3], max: -1, pages: 1000, langs: ['cs', 'x y'] })!;
        expect(a.ready).toBe(false);
        expect(a.readers).toBe(1);
        expect(a.types).toEqual(['image/jpeg']);
        expect(a.max).toBe(50 * 1024 * 1024);
        expect(a.pages).toBe(50);
        expect(a.langs).toEqual(['cs']);
        expect(sanitizeReadAccepts(null)).toBeNull();
        expect(sanitizeReadAccepts([1])).toBeNull();
    });

    it('takes how long a reading usually takes, only when ready', () => {
        const base = { readers: 1, types: ['image/jpeg'], max: 1000, pages: 3 };
        expect(sanitizeReadAccepts({ ...base, ready: true, expectSecs: 240 })?.expectSecs).toBe(240);
        expect(sanitizeReadAccepts({ ...base, ready: true, expectSecs: 61.7 })?.expectSecs).toBe(61);
        // An older research says nothing: no field, as before.
        expect(sanitizeReadAccepts({ ...base, ready: true })).not.toHaveProperty('expectSecs');
        expect(sanitizeReadAccepts({ ...base, ready: false, why: 'limit', expectSecs: 240 })).not.toHaveProperty('expectSecs');
        for (const bad of [0, -5, '240', null, Infinity]) {
            expect(sanitizeReadAccepts({ ...base, ready: true, expectSecs: bad })).not.toHaveProperty('expectSecs');
        }
        expect(sanitizeReadAccepts({ ...base, ready: true, expectSecs: 10 ** 9 })?.expectSecs).toBe(86_400);
    });

    it('stays in /status only with read.now among the features', () => {
        const read = { ready: true, readers: 1, types: ['image/jpeg'], max: 1000, pages: 3 };
        const status = (features: string[]) => sanitizeLiveStatus({ tree: { id: '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77', name: 'Novákovi' }, head: 'abc1234', features, accepts: { read } });
        expect(status(['read.now'])?.accepts?.read?.ready).toBe(true);
        expect(status([])?.accepts?.read).toBeUndefined();
        // An archive never reads.
        expect(sanitizeAccepts({ mode: 'archive', read })?.read).toBeUndefined();
    });
});

describe('/status.reads', () => {
    const entry = { id: ID, state: 'reading', version: 1, at: '2026-10-19T15:30:12Z', since: '2026-10-19T15:30:20Z', files: 2, pages: 2, readers: 2, done: 1, entries: 3, name: 'křest Lhota.jpg', person: 'P0001', from: 'app' };

    it('takes an entry', () => {
        expect(sanitizeLiveRead(entry)).toEqual({ ...entry });
    });

    it('drops bad ids and states, caps done at readers', () => {
        expect(sanitizeLiveRead({ ...entry, id: 'D1' })).toBeNull();
        expect(sanitizeLiveRead({ ...entry, state: 'eaten' })).toBeNull();
        expect(sanitizeLiveRead({ ...entry, readers: 1, done: 5 })?.done).toBe(1);
        expect(sanitizeLiveRead({ ...entry, person: 'Novák', from: 'elsewhere' })).toMatchObject({ person: '', from: 'app' });
        expect(sanitizeLiveRead({ ...entry, from: 'research' })?.from).toBe('research');
    });

    it('a list without duplicates; only with read.now', () => {
        expect(sanitizeReads([entry, entry, { id: 'x' }])?.map(r => r.id)).toEqual([ID]);
        expect(sanitizeReads('no')).toBeNull();
        const s = (features: string[]) => sanitizeLiveStatus({ tree: { id: '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77', name: 'N' }, head: 'abc1234', features, reads: [entry] });
        expect(s(['read.now'])?.reads?.length).toBe(1);
        expect(s([])?.reads).toBeUndefined();
    });

    it('how long it takes, only while it runs', () => {
        expect(sanitizeLiveRead({ ...entry, expectSecs: 480 })?.expectSecs).toBe(480);
        expect(sanitizeLiveRead({ ...entry, state: 'queued', expectSecs: 240 })?.expectSecs).toBe(240);
        expect(sanitizeLiveRead({ ...entry, state: 'done', expectSecs: 240 })).not.toHaveProperty('expectSecs');
        expect(sanitizeLiveRead({ ...entry, expectSecs: 'soon' })).not.toHaveProperty('expectSecs');
    });

    it('which states still run', () => {
        expect(['queued', 'reading', 'checking'].every(x => readRunning(x as never))).toBe(true);
        expect(['done', 'unreadable', 'failed', 'cancelled'].some(x => readRunning(x as never))).toBe(false);
    });
});

describe('the notice when a reading ends', () => {
    const OLD = 'D20261019153012-a1b2';
    const NEW = 'D20261020091500-c3d4';
    const DOC = `${'a'.repeat(64)},${'b'.repeat(64)}`;
    const read = (id: string, state: ReadState, at: string, extra: Partial<LiveRead> = {}): LiveRead => ({
        id, state, version: 1, at, since: at, files: 1, pages: 1, readers: 1, done: 1, entries: 1, name: 'rodny-list.jpg', person: '', from: 'app', ...extra,
    });
    const memo = (id: string, extra: Partial<ReadMemo> = {}): ReadMemo => ({ id, opened: false, announced: false, doc: DOC, ...extra });
    const map = (...reads: LiveRead[]) => new Map(reads.map(r => [r.id, r]));
    const none = new Map<string, LiveRead>();
    const ids = (out: { announce: LiveRead[] }) => out.announce.map(r => r.id);

    it('a start with readings announced before: no notice', () => {
        const reads = map(read(OLD, 'unreadable', '2026-10-19T15:30:12Z'), read(NEW, 'done', '2026-10-20T09:15:00Z'));
        const out = readEndsToAnnounce(reads, none, [memo(NEW, { announced: true }), memo(OLD, { announced: true })]);
        expect(out).toEqual({ announce: [], settle: [], rearm: [] });
    });

    it('a start with readings opened before: no notice', () => {
        const reads = map(read(OLD, 'unreadable', '2026-10-19T15:30:12Z'), read(NEW, 'done', '2026-10-20T09:15:00Z'));
        expect(ids(readEndsToAnnounce(reads, none, [memo(NEW, { opened: true }), memo(OLD, { opened: true })]))).toEqual([]);
    });

    it('unreadable, then read again as another reading, both ended with the app closed: only the newer says it, the older is settled', () => {
        const reads = map(read(OLD, 'unreadable', '2026-10-19T15:30:12Z'), read(NEW, 'done', '2026-10-20T09:15:00Z'));
        const memos = [memo(NEW), memo(OLD)];
        const out = readEndsToAnnounce(reads, none, memos);
        expect(ids(out)).toEqual([NEW]);
        expect(out.settle).toEqual([OLD]);
        // Remembered: the next start (a restart, a reload) says nothing.
        const after = memos.map(m => ({ ...m, announced: true }));
        expect(ids(readEndsToAnnounce(reads, none, after))).toEqual([]);
    });

    it('the same document without its pages known: the first file and page count tell it', () => {
        const reads = map(read(OLD, 'unreadable', '2026-10-19T15:30:12Z'), read(NEW, 'done', '2026-10-20T09:15:00Z'));
        expect(ids(readEndsToAnnounce(reads, none, [memo(NEW, { doc: '' }), memo(OLD, { doc: '' })]))).toEqual([NEW]);
        // Other pages: another document, each says its own end.
        const other = readEndsToAnnounce(reads, none, [memo(NEW), memo(OLD, { doc: 'c'.repeat(64) })]);
        expect(ids(other).sort()).toEqual([OLD, NEW]);
    });

    it('a newer reading cancelled leaves the older one its word', () => {
        const reads = map(read(OLD, 'done', '2026-10-19T15:30:12Z'), read(NEW, 'cancelled', '2026-10-20T09:15:00Z'));
        const r = reads.get(OLD)!;
        expect(readSuperseded(r, reads, [memo(NEW), memo(OLD)])).toBe(false);
        expect(readSuperseded(reads.get(OLD)!, map(r, read(NEW, 'done', '2026-10-20T09:15:00Z')), [memo(NEW), memo(OLD)])).toBe(true);
    });

    it('ending while the app follows it: one notice; the next status none', () => {
        const running = map(read(NEW, 'reading', '2026-10-20T09:15:00Z', { done: 0 }));
        const ended = map(read(NEW, 'done', '2026-10-20T09:15:00Z'));
        const memos = [memo(NEW)];
        expect(ids(readEndsToAnnounce(running, none, memos))).toEqual([]);
        expect(ids(readEndsToAnnounce(ended, running, memos))).toEqual([NEW]);
        expect(ids(readEndsToAnnounce(ended, ended, memos))).toEqual([]);
        expect(ids(readEndsToAnnounce(ended, none, [memo(NEW, { announced: true })]))).toEqual([]);
    });

    it('not the app’s readings, nor the one the dialog shows', () => {
        const running = map(read(NEW, 'reading', '2026-10-20T09:15:00Z'));
        const ended = map(read(NEW, 'done', '2026-10-20T09:15:00Z'));
        expect(ids(readEndsToAnnounce(ended, running, []))).toEqual([]);
        expect(ids(readEndsToAnnounce(ended, running, [memo(NEW)], NEW))).toEqual([]);
    });

    it('a reading remembered as announced but seen running is due its notice again', () => {
        const running = map(read(NEW, 'checking', '2026-10-20T09:15:00Z'));
        expect(readEndsToAnnounce(running, none, [memo(NEW, { announced: true })]).rearm).toEqual([NEW]);
        expect(readEndsToAnnounce(running, none, [memo(NEW)]).rearm).toEqual([]);
    });
});

describe('GET read/<id>', () => {
    const full = {
        id: ID, state: 'done', lang: 'cs',
        doc: { kind: 'register.baptism', language: ['la'], script: 'kurrent', date: '3. 4. 1846', legible: 'yes', why: null },
        readers: { asked: 2, ran: 2, agree: 'differ' },
        pages: [{ n: 1, file: 'I0042', sha: SHA, name: 'lhota.jpg', page: 1, w: 3024, h: 4032, image: `read/${ID}/page/1.jpg` }],
        entries: [{
            id: 'e1', page: 1, region: [0.05, 0.31, 0.9, 0.22],
            transcript: 'Joannes[?] filius legitimus\nAntonii Nowak [...] Lhota',
            variants: [{ at: 'Joannes[?]', other: 'Josephus' }],
            translation: 'Jan, manželský syn …',
            glossary: [{ term: 'filius legitimus', meaning: 'manželský syn', kind: 'term' }, { term: 'p.', meaning: 'patrini', kind: 'abbr' }],
            persons: [
                { ref: 'p1', role: 'child', roleText: 'pokřtěný', given: 'Jan', surname: 'Novák', written: 'Joannes Nowak', sex: 'M', age: null, occupation: null, residence: 'Lhota č. 12', uncertain: ['given'], region: [0.06, 0.33, 0.2, 0.03], match: [{ person: 'P0012', why: 'jméno, otec', score: 0.82 }] },
                { ref: 'p2', role: 'father', given: 'Antonín', surname: 'Novák', written: 'Antonii Nowak', sex: 'M' },
            ],
            events: [{ type: 'BAPM', date: { text: '3. 4. 1846', gedcom: '3 APR 1846' }, place: { text: 'Lhota', known: 'PL0007' }, persons: [{ ref: 'p1', role: 'principal' }, { ref: 'p9', role: 'godparent' }], region: [0.05, 0.31, 0.9, 0.05] }],
            relations: [{ type: 'parent', parent: 'p2', child: 'p1' }, { type: 'spouse', a: 'p2', b: 'p7' }],
        }],
        context: 'Zápis křtu podle tridentského formuláře.',
        cost: { amount: 0.42, currency: 'USD', partial: false },
        version: 2,
    };

    it('takes the whole result', () => {
        const r = sanitizeReadResult(full)!;
        expect(r.id).toBe(ID);
        expect(r.doc).toEqual({ kind: 'register.baptism', language: ['la'], script: 'kurrent', date: '3. 4. 1846', legible: 'yes', why: null });
        expect(r.readers).toEqual({ asked: 2, ran: 2, agree: 'differ' });
        expect(r.pages[0]).toEqual({ n: 1, file: 'I0042', sha: SHA, name: 'lhota.jpg', page: 1, w: 3024, h: 4032, image: `read/${ID}/page/1.jpg` });
        const e = r.entries[0];
        expect(e.transcript).toBe('Joannes[?] filius legitimus\nAntonii Nowak [...] Lhota');
        expect(e.variants).toEqual([{ at: 'Joannes[?]', other: 'Josephus' }]);
        // What differs (research 2026-10) is kept; a field that is no text is left out.
        const withField = sanitizeReadResult({ ...full, entries: [{ ...full.entries[0], variants: [{ field: 'p2.role', at: 'father', other: 'witness' }, { field: 7, at: 'a', other: 'b' }] }] })!;
        expect(withField.entries[0].variants).toEqual([{ at: 'father', other: 'witness', field: 'p2.role' }, { at: 'a', other: 'b' }]);
        expect(e.glossary.map(g => g.kind)).toEqual(['term', 'abbr']);
        expect(e.persons[0]).toMatchObject({ ref: 'p1', role: 'child', roleText: 'pokřtěný', sex: 'M', age: '', uncertain: ['given'], match: [{ person: 'P0012', score: 0.82 }] });
        expect(e.persons[1].region).toBeNull();
        // A person not in the entry is dropped from events and relations.
        expect(e.events[0].persons.map(p => p.ref)).toEqual(['p1']);
        expect(e.events[0].place).toEqual({ text: 'Lhota', known: 'PL0007' });
        expect(e.relations).toEqual([{ type: 'parent', parent: 'p2', child: 'p1' }]);
        expect(r.context).toBe('Zápis křtu podle tridentského formuláře.');
        expect(r.cost).toEqual({ amount: 0.42, currency: 'USD', partial: false });
        expect(r.version).toBe(2);
    });

    it('cleans what is not the contract', () => {
        const r = sanitizeReadResult({
            ...full,
            doc: { kind: 'spaceship', legible: 'no', why: 'smudge' },
            readers: { asked: 9, ran: 9, agree: 'maybe' },
            pages: [{ n: 1, image: 'http://evil.example/x.jpg' }, { image: `read/${ID}/page/../../token` }],
            entries: [{ transcript: 'a\u0000b', persons: [{ ref: 'p1', role: 'king', match: [{ person: 'Novák' }] }, { role: 'child' }], events: [{ type: 'bapm' }] }],
            cost: { amount: -1, currency: 'USD' },
        })!;
        expect(r.doc).toMatchObject({ kind: 'other', legible: 'no', why: 'other' });
        expect(r.readers).toEqual({ asked: 1, ran: 1, agree: null });
        expect(r.pages.map(p => p.image)).toEqual(['', '']);
        expect(r.entries[0]).toMatchObject({ id: 'e1', page: 1, transcript: 'a b', events: [] });
        expect(r.entries[0].persons).toHaveLength(1);
        expect(r.entries[0].persons[0]).toMatchObject({ role: 'other', match: [] });
        expect(r.cost).toBeNull();
        expect(sanitizeReadResult({ id: 'nope', state: 'done' })).toBeNull();
    });

    it('an unreadable document: no entries, the reason', () => {
        const r = sanitizeReadResult({ id: ID, state: 'unreadable', doc: { kind: 'other', legible: 'no', why: 'glare' }, entries: [] })!;
        expect(r.doc.why).toBe('glare');
        expect(r.entries).toEqual([]);
    });

    it('page image at the bridge, the year of a date', () => {
        expect(readPageImageUrl('http://127.0.0.1:5998/tok', { image: `read/${ID}/page/1.jpg` })).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:5998/tok/read/${ID}/page/1\\.jpg\\?app=`));
        expect(readPageImageUrl('http://127.0.0.1:5998/tok', { image: '' })).toBe('');
        expect(readDocYear('3. 4. 1846')).toBe('1846');
        expect(readDocYear('um 1790/91')).toBe('1790');
        expect(readDocYear('bez data')).toBe('');
    });

    it('a block keeps line breaks, drops control characters', () => {
        expect(cleanBlock('a\r\nb\u0007c\n\n\n\nd  e')).toBe('a\nb c\n\nd e');
    });
});

describe('refusals → the app states', () => {
    it('no answer: down', () => {
        expect(readFailure(0, null).kind).toBe('down');
        expect(readFailure(404, null).kind).toBe('down');
    });

    it('not ready, with why and when', () => {
        const f = readFailure(503, { error: 'x', code: 'read.not-ready', params: { why: 'limit', resets: '2026-10-20T15:00:00Z' } }, '60');
        expect(f).toMatchObject({ kind: 'not-ready', why: 'limit', resets: '2026-10-20T15:00:00Z', retryAfterMs: 60_000 });
    });

    it('limits of the queue, hour, day, with Retry-After', () => {
        expect(readFailure(429, { code: 'read.limit', params: { per: 'queue' } }, '60')).toMatchObject({ kind: 'limit', per: 'queue', retryAfterMs: 60_000 });
        expect(readFailure(429, { code: 'read.limit', params: { per: 'hour', most: 20 } }, '1200')).toMatchObject({ kind: 'limit', per: 'hour', most: 20, retryAfterMs: 1_200_000 });
        expect(readFailure(429, { code: 'read.limit', params: { per: 'day', most: 60 } })).toMatchObject({ kind: 'limit', per: 'day', retryAfterMs: 60_000 });
    });

    it('each code its state', () => {
        const kind = (status: number, code: string, params?: object) => readFailure(status, { error: 'English words', code, params }).kind;
        expect(kind(503, 'research.busy')).toBe('research-busy');
        expect(kind(409, 'read.busy')).toBe('read-busy');
        expect(kind(415, 'read.type')).toBe('type');
        expect(kind(415, 'read.heic')).toBe('convert');
        expect(kind(415, 'read.pdf-render')).toBe('convert');
        expect(kind(413, 'read.pages')).toBe('pages');
        expect(kind(413, 'read.large')).toBe('large');
        expect(kind(404, 'read.no-file')).toBe('no-file');
        expect(kind(410, 'read.no-file')).toBe('no-file');
        expect(kind(404, 'read.no-person')).toBe('no-person');
        expect(kind(404, 'read.none')).toBe('none');
        expect(kind(410, 'read.page-gone')).toBe('no-page');
        expect(kind(423, 'locked')).toBe('locked');
        expect(kind(403, 'app.only')).toBe('refused');
        expect(kind(400, 'read.lang')).toBe('refused');
        expect(kind(500, 'read.failed')).toBe('failed');
        expect(kind(502, 'weird')).toBe('failed');
    });

    it('carries the file of a type or size refusal', () => {
        expect(readFailure(415, { code: 'read.type', params: { sha: SHA, mime: 'image/tiff' } })).toMatchObject({ kind: 'type', sha: SHA, mime: 'image/tiff' });
        expect(readFailure(413, { code: 'read.large', params: { sha: SHA, mb: 62 } })).toMatchObject({ kind: 'large', sha: SHA, mb: 62 });
    });

    it('Retry-After in seconds or as a date', () => {
        expect(retryAfter('5')).toBe(5000);
        expect(retryAfter(null)).toBe(0);
        expect(retryAfter('Tue, 20 Oct 2026 15:00:10 GMT', Date.parse('Tue, 20 Oct 2026 15:00:00 GMT'))).toBe(10_000);
    });
});

describe('the files a reading takes', () => {
    const accepts = { types: ['image/jpeg', 'image/png', 'application/pdf'], max: 50 * 1024 * 1024, pages: 2 };

    it('a kind it does not read, a file too big, pages beyond the count', () => {
        const r = readFileRefusals([
            { name: 'a.jpg', type: 'image/jpeg', size: 1000 },
            { name: 'b.tif', type: 'image/tiff', size: 1000 },
            { name: 'c.png', type: 'image/png', size: 60 * 1024 * 1024 },
            { name: 'd.pdf', type: '', size: 1000 },
            { name: 'e.jpg', type: 'image/jpeg', size: 1000 },
        ], accepts);
        expect(r).toEqual([null, { kind: 'type', type: 'TIFF' }, { kind: 'size', mb: 60, maxMb: 50 }, null, { kind: 'pages', pages: 2 }]);
    });

    it('the kind from the name when the browser does not say', () => {
        expect(readFileMime({ name: 'IMG_1.HEIC', type: '' })).toBe('image/heic');
        expect(readFileKind({ name: 'scan.pdf', type: 'application/pdf' })).toBe('PDF');
        expect(readFileKind({ name: 'x.odt', type: '' })).toBe('ODT');
    });

    it('usual time: 3 minutes for one reader, 4 for two', () => {
        expect(readUsualMinutes(1)).toBe(3);
        expect(readUsualMinutes(2)).toBe(4);
    });

    it('a slow reader: its own time, and the several-minutes line from 120 s', () => {
        expect(readUsualMinutes(1, 60)).toBe(3);
        expect(readUsualMinutes(1, 240)).toBe(4);
        expect(readUsualMinutes(2, 241)).toBe(5);
        expect(readSlow(undefined)).toBe(false);
        expect(readSlow(60)).toBe(false);
        expect(readSlow(119)).toBe(false);
        expect(readSlow(120)).toBe(true);
        expect(readSlow(240)).toBe(true);
    });
});
