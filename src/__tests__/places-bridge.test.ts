import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    sanitizeBridgePlaces, sanitizeBridgePlace, placesReadReply, fetchBridgePlaces,
    placesIdentifyBody, placesIdentifyReply, postPlacesIdentify, placesAnswerBody, placesAnswerReply, postPlacesAnswer,
    placesUndoReply, postPlacesUndo, placesWriteRefusal, placesResearchAccess, canResearchPlaces, placeCheckFlag,
    PLACES_IDENTIFY_FEATURE, PLACES_ANSWER_FEATURE, PLACES_UNDO_FEATURE, PLACES_BRIDGE_LIMITS,
} from '../places-bridge.js';
import { researchSchemeUrl } from '../research-link.js';
import { placeKey } from '../places.js';

const TREE = '0b6f5e1c-2d3a-4b5c-8d9e-0f1a2b3c4d5e';
const BASE = 'http://127.0.0.1:7781/t0ken';
const ALL = [PLACES_IDENTIFY_FEATURE, PLACES_ANSWER_FEATURE, PLACES_UNDO_FEATURE];

const reply = {
    rev: 'r7',
    places: {
        L0012: {
            name: 'Horní Lhota',
            names: [{ name: 'Ober Lhota', lang: 'de', to: 1945 }, { name: 'H. Lhota' }],
            country: 'CZ', district: 'Lhotov', parish: 'Jinov',
            coords: { lat: 49.61, lon: 15.23 },
            state: 'identified', by: 'research', at: '2026-11-03T10:12:00Z',
            why: 'Fara Jinov, okres Lhotov.', source: { title: 'Místopis', url: 'https://example.org/m' },
            verified: '2026-11-03', forms: ['Horní Lhota', 'H. Lhota č. 5', 42], facts: 12, persons: 7,
        },
        L0013: { name: 'Lhotínek', state: 'unlocated', unlocated: 'zaniklá ves', needs: 'zápis z fary' },
        L0014: { name: 'Lhotov', state: 'conflict', waiting: 'L0014', current: { lat: 50.1, lon: 14.2, label: 'Lhotov, okres Jinov' }, parent: 'L9999' },
        L0015: { name: 'Jinov', state: 'identified' },
        bad: { name: 'Lhota' },
        L0016: { names: [] },
    },
    forms: {
        'Horní Lhota': { place: 'L0012' },
        'Łotów': { state: 'queued' },
        'Lhota u Jinova': {},
        'Ghost': { place: 'L0999' },
    },
    queue: { queued: 3, running: 1, batches: 1, estimate: { minutes: [5, 12], usd: [0.4, 1.1] } },
    counts: { offMap: 9, placed: 31, proposed: 2, unlocated: 1 },
};

afterEach(() => vi.unstubAllGlobals());

describe('places bridge: GET /places', () => {
    it('sanitizes the reply: records, forms keyed by placeKey, queue and counts', () => {
        const p = sanitizeBridgePlaces(reply)!;
        expect(p.rev).toBe('r7');
        expect(Object.keys(p.places).sort()).toEqual(['L0012', 'L0013', 'L0014', 'L0015']);
        const l12 = p.places.L0012!;
        expect(l12.names.map(n => n.name)).toEqual(['Horní Lhota', 'Ober Lhota', 'H. Lhota']);
        expect(l12).toMatchObject({ state: 'identified', by: 'research', district: 'Lhotov', country: 'CZ', parish: 'Jinov', facts: 12, persons: 7, verified: '2026-11-03' });
        expect(l12.forms).toEqual(['Horní Lhota', 'H. Lhota č. 5']);
        expect(p.places.L0013).toMatchObject({ state: 'unlocated', unlocated: 'zaniklá ves', needs: 'zápis z fary' });
        // A parent the reply does not have is dropped; the conflict's current location kept.
        expect(p.places.L0014!.parent).toBeUndefined();
        expect(p.places.L0014!.current).toEqual({ lat: 50.1, lon: 14.2, label: 'Lhotov, okres Jinov' });
        expect(p.places.L0014!.waiting).toBe('L0014');
        // "identified" without a location is not identified.
        expect(p.places.L0015!.state).toBeUndefined();
        expect(p.forms['Łotów']).toEqual({ state: 'queued' });
        expect(p.forms['Lhota u Jinova']).toEqual({});
        expect(p.forms.Ghost).toEqual({});
        expect(p.formsByKey[placeKey('Horní Lhota')]).toEqual({ place: 'L0012' });
        expect(p.formsByKey[placeKey('H. Lhota č. 5')]).toEqual({ place: 'L0012' });
        expect(p.formsByKey[placeKey('Łotów')]).toEqual({ state: 'queued' });
        expect(p.queue).toEqual({ queued: 3, running: 1, batches: 1, estimate: { minutes: [5, 12], usd: [0.4, 1.1] } });
        expect(p.counts).toEqual({ offMap: 9, placed: 31, proposed: 2, unlocated: 1 });
    });

    it('refuses what is not a reply and keeps the asked rev', () => {
        expect(sanitizeBridgePlaces(null)).toBeNull();
        expect(sanitizeBridgePlaces({ places: [] })).toBeNull();
        expect(sanitizeBridgePlaces({ places: {} }, 'r1')!.rev).toBe('r1');
        expect(sanitizeBridgePlace({ name: 'Lhota' }, 'X1')).toBeUndefined();
        expect(sanitizeBridgePlace({ name: 'x'.repeat(500) }, 'L1')).toBeUndefined();
    });

    it('types the read reply', () => {
        expect(placesReadReply(200, JSON.stringify(reply))).toMatchObject({ ok: true });
        expect(placesReadReply(200, 'nope')).toMatchObject({ ok: false, code: 'invalid' });
        expect(placesReadReply(404, '{}')).toMatchObject({ ok: false, code: 'refused', status: 404 });
        expect(placesReadReply(503, '{}', '30')).toMatchObject({ ok: false, code: 'busy', retryAfter: 30 });
        expect(placesReadReply(200, '\u0000too-big')).toMatchObject({ ok: false, code: 'too-big' });
        expect(placesReadReply(200, 'x'.repeat(PLACES_BRIDGE_LIMITS.bytes + 1))).toMatchObject({ ok: false, code: 'too-big' });
    });

    it('reads over the network and says when nothing answers', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify(reply), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const res = await fetchBridgePlaces(BASE, { rev: 'r6' });
        expect(res.ok).toBe(true);
        expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain(`${BASE}/places`);
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down'); }));
        expect(await fetchBridgePlaces(BASE)).toMatchObject({ ok: false, code: 'network' });
    });
});

describe('places bridge: POST /places/identify', () => {
    it('builds bodies: valid items once, all only with its own values, flags only for sent forms', () => {
        expect(placesIdentifyBody({ do: 'queue', forms: ['Lhota', 'Lhota', ' '], places: ['L0012', 'bad'] }))
            .toEqual({ do: 'queue', forms: ['Lhota'], places: ['L0012'] });
        expect(placesIdentifyBody({ do: 'queue', all: 'offmap' })).toEqual({ do: 'queue', all: 'offmap' });
        expect(placesIdentifyBody({ do: 'queue', all: 'placed', check: true })).toEqual({ do: 'queue', all: 'placed', check: true });
        expect(placesIdentifyBody({ do: 'cancel', all: 'queued' })).toEqual({ do: 'cancel', all: 'queued' });
        expect(placesIdentifyBody({ do: 'cancel', all: 'offmap' as never })).toBeNull();
        expect(placesIdentifyBody({ do: 'queue', forms: [] })).toBeNull();
        expect(placesIdentifyBody({ do: 'queue', forms: ['Lhota', 'Jinov'], check: true, flags: { Lhota: 'far', Lhotov: 'district', Jinov: 'bogus' as never } }))
            .toEqual({ do: 'queue', forms: ['Lhota', 'Jinov'], check: true, flags: { Lhota: 'far' } });
        const many = Array.from({ length: PLACES_BRIDGE_LIMITS.request + 10 }, (_, i) => `Lhota ${i}`);
        expect((placesIdentifyBody({ do: 'queue', forms: many })!.forms as string[]).length).toBe(PLACES_BRIDGE_LIMITS.request);
    });

    it('maps the app check to its flag', () => {
        expect(placeCheckFlag([{ kind: 'multi' }])).toBe('choices');
        expect(placeCheckFlag([{ kind: 'far', km: 80, family: 'Lhota', years: [1800, 1850] }, { kind: 'multi' }])).toBe('far');
        expect(placeCheckFlag([])).toBeUndefined();
    });

    it('types the reply and its refusals', () => {
        expect(placesIdentifyReply(200, {
            ok: true, queued: 2, skipped: [{ form: 'Jinov', why: 'manual' }, { form: 'Lhota', why: 'bogus' }], queue: { queued: 5, running: 0 },
        }, ALL)).toEqual({ ok: true, queued: 2, skipped: [{ form: 'Jinov', why: 'manual' }], queue: { queued: 5, running: 0 } });
        expect(placesIdentifyReply(200, { ok: true, queued: 0, cancelled: 3, skipped: [] }, ALL)).toMatchObject({ ok: true, cancelled: 3 });
        expect(placesIdentifyReply(400, { code: 'places.body', error: 'bad' }, ALL)).toMatchObject({ ok: false, code: 'invalid', bridgeCode: 'places.body' });
        expect(placesIdentifyReply(409, { code: 'places.archive', text: 'Archiv.' }, ALL)).toMatchObject({ ok: false, code: 'archive', reason: 'Archiv.' });
        expect(placesIdentifyReply(423, {}, ALL)).toMatchObject({ ok: false, code: 'locked' });
        expect(placesIdentifyReply(503, { code: 'research.busy' }, ALL, '12')).toMatchObject({ ok: false, code: 'busy', retryAfter: 12 });
        expect(placesIdentifyReply(500, {}, ALL)).toMatchObject({ ok: false, code: 'unknown' });
    });

    it('takes only its own places link from a 403', () => {
        const own = researchSchemeUrl('places', { tree: TREE, placesDo: 'run' })!;
        const one = researchSchemeUrl('places', { tree: TREE, placesDo: 'run', place: 'L0012' })!;
        const check = { tree: TREE, places: ['L0012'] };
        expect(placesWriteRefusal(403, { code: 'places.link', link: one }, ALL, null, check)).toMatchObject({ code: 'link', link: one });
        expect(placesWriteRefusal(403, { code: 'places.link', link: 'https://evil.example/' }, ALL, null, check)).toMatchObject({ code: 'link', link: own });
        expect(placesWriteRefusal(403, { code: 'places.link', params: { link: own } }, ALL, null, check)).toMatchObject({ link: own });
        expect(placesWriteRefusal(403, { code: 'places.link' }, ALL).link).toBeUndefined();
    });

    it('sends only with the feature and only a valid body', async () => {
        const fetchMock = vi.fn(async (_u: unknown, _i?: RequestInit) => new Response(JSON.stringify({ ok: true, queued: 1, skipped: [] }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        expect(await postPlacesIdentify(BASE, { do: 'queue', forms: ['Lhota'] }, [])).toMatchObject({ ok: false, code: 'unsupported' });
        expect(await postPlacesIdentify(BASE, { do: 'queue', forms: [] }, ALL)).toMatchObject({ ok: false, code: 'invalid' });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await postPlacesIdentify(BASE, { do: 'queue', forms: ['Lhota'] }, ALL)).toMatchObject({ ok: true, queued: 1 });
        const [url, init] = fetchMock.mock.calls[0]!;
        expect(String(url)).toContain(`${BASE}/places/identify`);
        expect(init!.method).toBe('POST');
        expect(JSON.parse(String(init!.body))).toEqual({ do: 'queue', forms: ['Lhota'] });
        expect((init!.headers as Record<string, string>)['Content-Type']).toContain('text/plain');
    });
});

describe('places bridge: answer and undo', () => {
    it('builds answer bodies', () => {
        expect(placesAnswerBody({ place: 'L0012', take: 'c2' })).toEqual({ place: 'L0012', take: 'c2' });
        expect(placesAnswerBody({ place: 'L0012', take: 'c4' as never })).toBeNull();
        expect(placesAnswerBody({ place: 'T12', take: 'yes' })).toBeNull();
        expect(placesAnswerBody({ places: ['L1', 'L1', 'x'], take: 'first', dry: true })).toEqual({ places: ['L1'], take: 'first', dry: true });
        expect(placesAnswerBody({ places: ['L1'], take: 'keep' })).toEqual({ places: ['L1'], take: 'keep' });
        expect(placesAnswerBody({ places: [], take: 'keep' })).toBeNull();
    });

    it('types one, dry and bulk replies', () => {
        const one = placesAnswerReply(200, { ok: true, place: { id: 'L0012', name: 'Horní Lhota', state: 'identified', by: 'person', coords: { lat: 49.6, lon: 15.2 } }, undo: 'u-17', head: 'abcdef1', parent: '1234567' },
            { place: 'L0012', take: 'c1' }, ALL);
        expect(one).toMatchObject({ ok: true, kind: 'one', undo: 'u-17', head: 'abcdef1', parent: '1234567', place: { id: 'L0012', state: 'identified', by: 'person' } });
        expect(placesAnswerReply(200, { places: 4, facts: 19 }, { places: ['L1'], take: 'first', dry: true }, ALL))
            .toEqual({ ok: true, kind: 'dry', places: 4, facts: 19 });
        expect(placesAnswerReply(200, { ok: true, done: ['L1', 'L2', 'bad'], skipped: [{ place: 'L3', why: 'changed' }], undo: 'u-18' }, { places: ['L1', 'L2', 'L3'], take: 'keep' }, ALL))
            .toMatchObject({ ok: true, kind: 'bulk', done: ['L1', 'L2'], skipped: [{ place: 'L3', why: 'changed' }], undo: 'u-18' });
        const changed = placesAnswerReply(409, { code: 'places.changed', place: { id: 'L0012', name: 'Horní Lhota', state: 'queued' } }, { place: 'L0012', take: 'c1' }, ALL);
        expect(changed).toMatchObject({ ok: false, code: 'changed', place: { id: 'L0012', state: 'queued' } });
    });

    it('types undo replies', () => {
        expect(placesUndoReply(200, { ok: true, head: 'abcdef1' }, ALL)).toEqual({ ok: true, head: 'abcdef1', parent: '' });
        expect(placesUndoReply(409, { code: 'places.undo.later' }, ALL)).toMatchObject({ ok: false, code: 'later' });
    });

    it('sends answers and undo only with their features', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        expect(await postPlacesAnswer(BASE, { place: 'L1', take: 'c1' }, [PLACES_IDENTIFY_FEATURE])).toMatchObject({ code: 'unsupported' });
        expect(await postPlacesUndo(BASE, { undo: 'u-1' }, [PLACES_ANSWER_FEATURE])).toMatchObject({ code: 'unsupported' });
        expect(await postPlacesUndo(BASE, { undo: 'bad id!' }, ALL)).toMatchObject({ code: 'invalid' });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await postPlacesUndo(BASE, { undo: 'u-1' }, ALL)).toMatchObject({ ok: true });
        expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/places/undo');
    });
});

describe('who may ask the research', () => {
    const env = { hasResearch: true, bridgeLocal: true, features: [PLACES_IDENTIFY_FEATURE], phoneLayout: false };
    it('goes only with the research, its bridge here, the feature and no phone', () => {
        expect(placesResearchAccess(env)).toBe('ok');
        expect(canResearchPlaces(env)).toBe(true);
        expect(placesResearchAccess({ ...env, hasResearch: false })).toBe('none');
        expect(placesResearchAccess({ ...env, phoneLayout: true })).toBe('phone');
        expect(placesResearchAccess({ ...env, bridgeLocal: false })).toBe('elsewhere');
        expect(placesResearchAccess({ ...env, features: ['history.read'] })).toBe('old');
        expect(placesResearchAccess({ ...env, features: null })).toBe('old');
        expect(canResearchPlaces({ ...env, phoneLayout: true })).toBe(false);
    });
});
