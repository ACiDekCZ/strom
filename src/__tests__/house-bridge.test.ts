/**
 * The bridge client of house histories (spec 030): `/status.houses`, the list
 * read again only on a new `rev`, one house's result kept by its key (and
 * moved when the key changes under the same id), material and a person's
 * word, and the errors of the writes. Fixtures in the shape of the research's
 * sample (docs of 030), with a fictional village Bělokamen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    batchDoneHouse, clearHouseCaches, confirmHouse, fetchHouse, fetchHouses, houseCache, houseFeature, houseMaterialBody, houseStatus,
    houseRequestWith, houseWriteReply, moveHouseToTop, requestHouse, sanitizeHouseResearch, sanitizeHouseRow, sendHouseMaterial, setHousesAuto,
} from '../house-bridge.js';
import { houseChatLink, houseSearchLink, researchLinkActionOf, researchUrlMark, sanitizeLiveHouses, sanitizeLiveStatus } from '../research-link.js';

const BASE = 'http://127.0.0.1:4711/t0k3n';
const REV = 'f247ecdcdd1b5980';

const MILL_ROW = {
    id: 'A0001', key: 'belokamen|16', place: { key: 'belokamen', id: 'L0001', name: 'Bělokamen' }, house: '16', name: 'U Prouzalů',
    persons: 2, years: { from: 1821, to: 1852 }, state: 'done', at: '2026-11-26', task: 'T0002', work: 'house',
    summary: { events: 5, holders: 2, residents: 2, unknown: 2, materials: 1, passed: 3 },
};
const QUEUED_ROW = {
    id: 'A0003', key: 'hvozdnice|5', place: { key: 'hvozdnice', id: 'L0002', name: 'Hvozdnice' }, house: '5',
    persons: 1, years: { from: 1880, to: 1880 }, state: 'queued', task: 'T0004', work: 'house',
    summary: { events: 0, holders: 0, residents: 0, unknown: 0, materials: 0, passed: 0 },
};
const LIST = { rev: REV, houses: [MILL_ROW, QUEUED_ROW, { id: 'bad id!', key: 'x' }] };

const MILL = {
    ...MILL_ROW, nameBy: 'research', persons: ['P0001', 'P0002'],
    numbers: [
        { id: 'n1', number: '9', from: '1770', to: '1838', certainty: 'probable', proposed: true,
          text: 'Stejná rodina pod čp. 9 (1779) a čp. 16 (1841)', sources: ['S0040'] },
        { id: 'n2', number: '16', from: '1838', certainty: 'high', sources: [{ source: 'S0041', page: 'fol. 3' }] },
    ],
    location: { certainty: 'medium', how: 'old-map', lat: 49.6118, lon: 15.2251, origin: 'research',
        sources: [{ url: 'https://example.org/stabilni-katastr/belokamen' }], confirmed: null },
    timeline: [
        { id: 'e1', kind: 'built', at: '2026-11-26', certainty: 'high', date: '1781', origin: 'research',
          sources: [{ page: 'fol. 3', source: 'S0001' }], text: 'Vystavěno stavení na návsi' },
        { id: 'e2', kind: 'fire', at: '2026-11-26', certainty: 'medium', date: '1868-05', origin: 'research',
          sources: [{ url: 'https://kronika.example.org/belokamen#1868' }], text: 'Požár obce' },
        { id: 'e9', kind: 'transfer', date: '1951', origin: 'import', material: 'M3', text: 'Převod na družstvo', sources: [] },
        { id: 'e10', kind: 'meteor', text: 'Neznámý druh', sources: [] },
    ],
    holders: [{ id: 'h1', name: 'Dobromil Kvitelka', person: 'P0002', from: '1858', to: '1890', how: 'marriage', certainty: 'high', sources: ['S0043'], origin: 'research', at: '2026-11-26' }],
    residents: [{ id: 'r1', name: 'Radegunda Prouzalová', from: '1862', to: '1865', role: 'servant', sources: [{ page: 'fol. 12', source: 'S0002' }], origin: 'research' }],
    maps: [
        { id: 'm1', kind: 'cadastre', manual: true, sheet: 'list 2', url: 'https://example.org/stabilni-katastr/belokamen', origin: 'research' },
        { id: 'm2', kind: 'ortho', layer: 'cz-ortho', origin: 'research' },
        { id: 'm3', kind: 'evil', url: 'javascript:alert(1)' },
    ],
    passed: [
        { id: 'p1', at: '2026-11-26', found: true, origin: 'research', source: 'S0001', what: 'Pozemková kniha 1780–1880' },
        { id: 'p3', at: '2026-11-26', origin: 'import', url: 'https://kronika.example.org/belokamen', what: 'Kronika obce' },
    ],
    manual: [{ id: 'o1', what: 'Indikační skica', url: 'https://archiv.example.org/skica/123', why: 'Web nedovoluje čtení agentem' }],
    unknown: [{ id: 'u1', text: 'Kdo držel dům 1856–1858?', question: null }, { id: 'u2', text: 'Je čp. 9 tentýž dům?', question: 'T0005' }],
    archiveOnly: [{ id: 'a1', archive: 'Okresní archiv Bělokamen (smyšlený)', fond: 'Okresní soud', signature: 'kn. 12', what: 'pozemková kniha' }],
    materials: [{ id: 'I0007', kind: 'memory', text: 'Babička vyprávěla o studni za stodolou.', witness: 'Dobroslava Kvitelková', at: '2026-11-26' }],
    sensitive: ['e9', 'e99'],
    recent: { people: true, events: ['e9'] },
    town: { id: 'A0002', text: 'Fara Hvozdnice, katastrální území Bělokamen.', passed: [], manual: [], archiveOnly: [], maps: [], unknown: [] },
    rev: REV,
};

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
        return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status });
    }));
});
afterEach(() => vi.unstubAllGlobals());

describe('state', () => {
    it('reads /status.houses only with the feature', () => {
        const raw = { on: false, rev: REV, counts: { done: 1, running: 0, queued: 1, waiting: 0, held: 0 }, auto: { houses: 0 } };
        expect(sanitizeLiveHouses(raw)).toEqual({
            on: false, rev: REV, counts: { done: 1, running: 0, queued: 1, waiting: 0, held: 0 }, auto: { houses: 0, towns: 0 },
        });
        expect(sanitizeLiveHouses({ on: 'yes', rev: REV })).toBeNull();
        const status = sanitizeLiveStatus({ researchId: 'r1', features: ['house', 'house.material'], houses: raw });
        expect(houseStatus(status)?.rev).toBe(REV);
        expect(houseFeature(status?.features, 'house.material')).toBe(true);
        expect(houseFeature(status?.features, 'house.import')).toBe(false);
        const without = sanitizeLiveStatus({ researchId: 'r1', features: [], houses: raw });
        expect(houseStatus(without)).toBeNull();
    });
});

describe('reads', () => {
    it('reads the list once per rev, dropping rows it cannot show', async () => {
        replies.push({ status: 200, body: LIST });
        const first = await fetchHouses(BASE, { rev: REV });
        expect(first.ok && first.houses.map(h => h.key)).toEqual(['belokamen|16', 'hvozdnice|5']);
        expect(first.ok && first.cached).toBe(false);
        expect(calls[0]!.url.startsWith(`${BASE}/houses`)).toBe(true);
        const again = await fetchHouses(BASE, { rev: REV });
        expect(again.ok && again.cached).toBe(true);
        expect(calls).toHaveLength(1);
        replies.push({ status: 200, body: { ...LIST, rev: 'aaaa1111' } });
        const fresh = await fetchHouses(BASE, { rev: 'aaaa1111' });
        expect(fresh.ok && fresh.cached).toBe(false);
        expect(calls).toHaveLength(2);
    });

    it('reads a row\'s numbers as the research sends them: objects with their years and certainty', () => {
        const row = sanitizeHouseRow({
            ...MILL_ROW,
            numbers: [
                { number: '9', from: '1770', to: '1838', certainty: 'probable' },
                { number: '16', from: '1838', certainty: 'high' },
                { number: '' }, { from: '1900' }, 'čp. 4',
            ],
        });
        expect(row?.numbers).toEqual([
            { number: '9', from: '1770', to: '1838', certainty: 'probable' },
            { number: '16', from: '1838', certainty: 'high' },
            { number: 'čp. 4' },
        ]);
    });

    it('reads one house whole: ids, a proposal, memory material, sensitive items of its timeline only, no recent', async () => {
        replies.push({ status: 200, body: MILL });
        const res = await fetchHouse(BASE, 'belokamen|16');
        expect(calls[0]!.url.startsWith(`${BASE}/houses/belokamen%7C16`)).toBe(true);
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        const h = res.house;
        expect(h.numbers[0]).toMatchObject({ id: 'n1', number: '9', proposed: true, sources: [{ source: 'S0040' }] });
        expect(h.numbers[1]).toMatchObject({ id: 'n2', certainty: 'high', sources: [{ source: 'S0041', page: 'fol. 3' }] });
        expect(h.numbers[1]!.proposed).toBeUndefined();
        expect(h.timeline.map(e => [e.id, e.kind])).toEqual([['e1', 'built'], ['e2', 'fire'], ['e9', 'transfer'], ['e10', 'other']]);
        expect(h.timeline[2]).toMatchObject({ origin: 'import', material: 'M3' });
        expect(h.maps.map(m => m.id)).toEqual(['m1', 'm2']);
        expect(h.manual).toEqual([{ id: 'o1', what: 'Indikační skica', url: 'https://archiv.example.org/skica/123', why: 'Web nedovoluje čtení agentem' }]);
        expect(h.unknown[1]).toEqual({ id: 'u2', text: 'Je čp. 9 tentýž dům?', question: 'T0005' });
        expect(h.materials[0]).toMatchObject({ id: 'I0007', kind: 'memory', witness: 'Dobroslava Kvitelková' });
        expect(h.passed[1]!.found).toBeUndefined();
        expect(h.sensitive).toEqual(['e9']);
        expect('recent' in h).toBe(false);
        expect(h.location).toMatchObject({ lat: 49.6118, lon: 15.2251, confirmed: null });
        expect(h.town?.id).toBe('A0002');
        expect(houseCache(BASE).get('belokamen|16')).toBe(h);
        expect(houseCache(BASE).get('A0001')).toBe(h);
    });

    it('a house only of the tree\'s facts comes with state none', () => {
        const h = sanitizeHouseResearch({ ...QUEUED_ROW, state: 'none', task: undefined, persons: ['P0003'] });
        expect(h?.state).toBe('none');
        expect(h?.timeline).toEqual([]);
    });

    it('moves a result to the new key when the key changes under the same id', async () => {
        replies.push({ status: 200, body: MILL });
        await fetchHouse(BASE, 'belokamen|16');
        replies.push({ status: 200, body: { rev: 'bbbb2222', houses: [{ ...MILL_ROW, key: 'belokamen u brodku|16' }] } });
        await fetchHouses(BASE, { rev: 'bbbb2222' });
        const cache = houseCache(BASE);
        expect(cache.get('belokamen|16')).toBeUndefined();
        expect(cache.get('belokamen u brodku|16')?.id).toBe('A0001');
        expect(cache.get('A0001')?.key).toBe('belokamen u brodku|16');
    });

    it('tells the failures apart', async () => {
        replies.push({ status: 404, body: { error: 'house.unknown', code: 'house.unknown' } });
        expect(await fetchHouse(BASE, 'belokamen|99')).toEqual({ ok: false, code: 'unknown-house', status: 404 });
        replies.push({ status: 200, body: 'not json' });
        expect(await fetchHouses(BASE)).toEqual({ ok: false, code: 'invalid', status: 200 });
        expect(await fetchHouses(BASE)).toEqual({ ok: false, code: 'network', status: 0 });
    });
});

describe('writes', () => {
    it('sends a memory with its witness only with consent, and keeps the house of the reply', async () => {
        expect(houseMaterialBody({ house: 'belokamen|16', memory: { text: ' Studna za stodolou ', witness: 'Dobroslava', witnessConsent: false } }))
            .toEqual({ house: 'belokamen|16', memory: { text: 'Studna za stodolou', witnessConsent: false } });
        expect(houseMaterialBody({ house: 'belokamen|16' })).toBeNull();
        replies.push({ status: 200, body: { house: MILL, materials: [{ id: 'I0007', kind: 'memory' }], head: 'a'.repeat(40), parent: 'b'.repeat(40) } });
        const res = await sendHouseMaterial(BASE, { house: 'belokamen|16', memory: { text: 'Studna', witness: 'Dobroslava', witnessConsent: true }, name: 'U Prouzalů' }, ['house', 'house.material']);
        expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({
            house: 'belokamen|16', memory: { text: 'Studna', witness: 'Dobroslava', witnessConsent: true }, name: 'U Prouzalů',
        });
        expect(calls[0]!.url.startsWith(`${BASE}/houses/material`)).toBe(true);
        expect(res.ok && res.materials).toEqual(['I0007']);
        expect(res.ok && res.house?.key).toBe('belokamen|16');
        expect(houseCache(BASE).get('A0001')?.name).toBe('U Prouzalů');
    });

    it('confirms a renumbering: the whole house comes back', async () => {
        replies.push({ status: 200, body: { house: { ...MILL, numbers: [{ ...MILL.numbers[0], proposed: undefined, confirmed: '2026-11-26' }] } } });
        const res = await confirmHouse(BASE, { house: 'belokamen|16', what: 'renumber', id: 'n1' }, ['house', 'house.confirm']);
        expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ house: 'belokamen|16', what: 'renumber', id: 'n1' });
        expect(res.ok && res.house?.numbers[0]).toMatchObject({ id: 'n1', confirmed: '2026-11-26' });
    });

    it('maps the errors like the other bridge writes', () => {
        const f = ['house', 'house.confirm'];
        expect(houseWriteReply(400, { error: 'house.body', code: 'house.body' }, f)).toMatchObject({ ok: false, code: 'invalid' });
        expect(houseWriteReply(400, { error: 'house.body', code: 'house.body', reasonCode: 'house.town' }, f)).toMatchObject({ code: 'town' });
        expect(houseWriteReply(404, { error: 'house.unknown', code: 'house.unknown' }, f)).toMatchObject({ code: 'unknown-house' });
        expect(houseWriteReply(409, { error: 'house.archive', code: 'house.archive', text: 'Archiv jen ke čtení.' }, f))
            .toMatchObject({ code: 'archive', reason: 'Archiv jen ke čtení.' });
        expect(houseWriteReply(423, { error: 'locked', code: 'locked' }, f)).toMatchObject({ code: 'locked' });
        expect(houseWriteReply(503, { error: 'research.busy', code: 'research.busy' }, f)).toMatchObject({ code: 'busy' });
        expect(houseWriteReply(500, {}, f)).toMatchObject({ code: 'unknown' });
    });

    it('says no answer as network, never throws', async () => {
        expect(await confirmHouse(BASE, { house: 'belokamen|16', what: 'location', lat: 49.6, lon: 15.2 }, ['house.confirm']))
            .toMatchObject({ ok: false, code: 'network' });
    });

    it('a batch of files to a house carries the house only with house.material', () => {
        expect(batchDoneHouse('belokamen|16', ['house', 'house.material'])).toEqual({ house: 'belokamen|16' });
        expect(batchDoneHouse('belokamen|16', ['house'])).toEqual({});
        expect(batchDoneHouse(undefined, ['house.material'])).toEqual({});
    });
});

// ==================== PART 2 (§4.5): the setting, a request, layers ====================

const TREE = '5f0c8a3e-1d2b-4c6a-9e7f-0a1b2c3d4e5f';
const HEAD = '42e1c19b019afbcc0c2028b2967c0885883e60b3';
const PARENT = '8504262900d7b214dd09b7462c9100002e585917';
const F2 = ['house', 'house.material', 'house.confirm', 'house.import', 'house.auto', 'house.request'];
const ORTHO = {
    id: 'cz-ortho', kind: 'ortho', label: 'Ortofoto (dnes)', type: 'wms', url: 'https://example.org/ortofoto/wms', layers: '0',
    format: 'image/jpeg', attribution: '© Zeměměřický úřad (smyšlený)', license: 'CC BY 4.0', bbox: [11.885448, 48.196887, 19.164528, 51.393486],
};
const ORTHO_1950 = {
    id: 'cz-ortho-1950', kind: 'ortho-1950', label: 'Letecké snímky 50. let', type: 'wms', url: 'https://example.org/historicka/wms',
    layers: 'orto', format: 'image/jpeg', crs: 'EPSG:5514', attribution: '© Agentura (smyšlená)', license: 'CC BY 4.0',
    bbox: [12.09, 48.55, 18.86, 51.06],
};
const STATUS_HOUSES = {
    on: false, rev: REV, counts: { done: 2, running: 1, queued: 4, waiting: 0, held: 3 },
    auto: { houses: 7, towns: 3 },
    estimate: { houses: 7, towns: 3, minutes: 270, usd: 11.2, measured: true, perHouse: { minutes: 30, usd: 1.2 }, perTown: { minutes: 20, usd: 0.9 } },
    layers: [ORTHO, ORTHO_1950, { ...ORTHO, id: 'bad', url: 'http://example.org/wms' }, { ...ORTHO, id: 'no-license', license: '' }],
};

describe('part 2: /status.houses', () => {
    it('reads auto, the estimate and the layers (S-JTSK kept as crs), drops a layer it cannot show', () => {
        const h = sanitizeLiveHouses(STATUS_HOUSES)!;
        expect(h.auto).toEqual({ houses: 7, towns: 3 });
        expect(h.estimate).toEqual(STATUS_HOUSES.estimate);
        expect(h.layers!.map(l => l.id)).toEqual(['cz-ortho', 'cz-ortho-1950']);
        expect(h.layers![1]).toMatchObject({ crs: 'EPSG:5514', attribution: '© Agentura (smyšlená)', license: 'CC BY 4.0' });
        expect(h.layers![0]!.crs).toBeUndefined();
        expect(h.counts.held).toBe(3);
    });

    it('keeps no price before it is measured: time alone', () => {
        const h = sanitizeLiveHouses({
            ...STATUS_HOUSES,
            estimate: { houses: 1, towns: 1, minutes: 50, usd: 3, measured: false, perHouse: { minutes: 30, usd: 1 }, perTown: { minutes: 20 } },
        })!;
        expect(h.estimate).toEqual({ houses: 1, towns: 1, minutes: 50, measured: false, perHouse: { minutes: 30 }, perTown: { minutes: 20 } });
    });

    it('reads the look of the houses (spec 145 T1): true, false, or not said', () => {
        const base = { on: true, rev: REV, counts: { done: 0, running: 0, queued: 0, waiting: 0, held: 0 } };
        expect(sanitizeLiveHouses({ ...base, look: true })!.look).toBe(true);
        expect(sanitizeLiveHouses({ ...base, look: false })!.look).toBe(false);
        expect(sanitizeLiveHouses(base)!).not.toHaveProperty('look');
        expect(sanitizeLiveHouses({ ...base, look: 'yes' })!).not.toHaveProperty('look');
        expect(houseFeature(['house', 'house.look', 'house.chat'], 'house.look')).toBe(true);
    });

    it('an archive or a research waiting for its agent: exactly on, rev and counts — nothing more', () => {
        const h = sanitizeLiveHouses({ on: false, rev: REV, counts: { done: 0, running: 0, queued: 0, waiting: 0, held: 0 } })!;
        expect(h).toEqual({ on: false, rev: REV, counts: { done: 0, running: 0, queued: 0, waiting: 0, held: 0 } });
    });

    it('an older bridge without house.* says nothing of houses, and no error', () => {
        expect(houseStatus(sanitizeLiveStatus({ researchId: 'r1', features: ['census'], houses: STATUS_HOUSES }))).toBeNull();
        expect(houseFeature(['house', 'house.material'], 'house.auto')).toBe(false);
        expect(houseFeature(['house', 'house.material'], 'house.request')).toBe(false);
        expect(houseFeature(F2, 'house.auto')).toBe(true);
    });
});

describe('part 2: the setting (POST /houses {on})', () => {
    it('switches on at once and gives the state the research keeps now', async () => {
        replies.push({ status: 200, body: { houses: { ...STATUS_HOUSES, on: true, counts: { ...STATUS_HOUSES.counts, held: 0 } }, head: HEAD, parent: PARENT } });
        const r = await setHousesAuto(BASE, true, F2);
        expect(calls[0]!.url.startsWith(`${BASE}/houses`)).toBe(true);
        expect(calls[0]!.url.startsWith(`${BASE}/houses/`)).toBe(false);
        expect(calls[0]!.init!.method).toBe('POST');
        expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ on: true });
        expect(r).toMatchObject({ ok: true, head: HEAD, parent: PARENT });
        expect(r.ok && r.houses?.on).toBe(true);
    });

    it('refuses like census records: archive, locked, busy, full, failed with its sentence', async () => {
        const cases: [number, unknown, string][] = [
            [409, { error: 'house.archive', code: 'house.archive' }, 'archive'],
            [423, { error: 'locked', code: 'locked' }, 'locked'],
            [503, { error: 'research.busy', code: 'research.busy' }, 'busy'],
            [507, { error: 'disk.full', code: 'disk.full' }, 'full'],
            [400, { error: 'house.body', code: 'house.body' }, 'invalid'],
            [500, { error: 'house.failed', code: 'house.failed', text: 'Zápis se nepovedl.' }, 'unknown'],
        ];
        for (const [status, body, code] of cases) {
            replies.push({ status, body });
            expect(await setHousesAuto(BASE, false, F2)).toMatchObject({ ok: false, code });
        }
        replies.push({ status: 500, body: { error: 'house.failed', code: 'house.failed', text: 'Zápis se nepovedl.' } });
        expect(await setHousesAuto(BASE, false, F2)).toMatchObject({ reason: 'Zápis se nepovedl.' });
        expect(await setHousesAuto(BASE, true, F2)).toMatchObject({ ok: false, code: 'network' });
    });
});

describe('part 2: a request of a house', () => {
    const CHECK = { tree: TREE };

    it('builds the terminal link with the house and at most two more (AI + terminal mark)', () => {
        const link = houseSearchLink(TREE, 'belokamen|16', ['belokamen|4', 'belokamen|9'])!;
        expect(link).toBe(`strom-research://house?tree=${TREE}&house=belokamen%7C16&do=search&with=belokamen%7C4,belokamen%7C9`);
        expect(researchUrlMark(link)).toBe('agent');
        expect(researchLinkActionOf(link)).toEqual({
            link: 'house', params: { house: 'belokamen|16', houseDo: 'search', houseWith: ['belokamen|4', 'belokamen|9'] },
        });
        expect(houseSearchLink(TREE, 'zálesí u brodku|3')).toBe(`strom-research://house?tree=${TREE}&house=z%C3%A1les%C3%AD%20u%20brodku%7C3&do=search`);
        expect(houseSearchLink(TREE, 'belokamen|16', ['belokamen|4', 'belokamen|9', 'belokamen|2'])).toBeNull();
        expect(houseSearchLink(TREE, 'belokamen|16', ['belokamen|16'])).toBeNull();
        expect(houseSearchLink(TREE, 'belokamen')).toBeNull();
        expect(houseSearchLink(TREE, 'belokamen|16,17')).toBeNull();
        expect(houseSearchLink('not a tree', 'belokamen|16')).toBeNull();
    });

    it('reads a chat link back as its action (spec 145 T2), a chat with `with` is no link of ours', () => {
        const link = houseChatLink(TREE, 'belokamen|16')!;
        expect(researchLinkActionOf(link)).toEqual({ link: 'house', params: { house: 'belokamen|16', houseDo: 'chat' } });
        expect(researchLinkActionOf(`${link}&with=belokamen%7C4`)).toBeNull();
    });

    it('sends with at most two more houses, without the house itself or a repeat', async () => {
        expect(houseRequestWith('belokamen|16', ['belokamen|16', 'belokamen|4', 'belokamen|4', 'nonsense', 'belokamen|9', 'belokamen|2']))
            .toEqual(['belokamen|4', 'belokamen|9']);
        replies.push({ status: 403, body: { error: 'house.link', code: 'house.link', text: 'Potvrzení v terminálu.' } });
        await requestHouse(BASE, 'belokamen|16', ['belokamen|4', 'belokamen|9', 'belokamen|2'], F2, CHECK);
        expect(calls[0]!.url.startsWith(`${BASE}/houses/request`)).toBe(true);
        expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ house: 'belokamen|16', with: ['belokamen|4', 'belokamen|9'] });
    });

    it('the setting off: 403 house.link gives the link and this request\'s estimate; no task', async () => {
        const own = houseSearchLink(TREE, 'belokamen|16', ['belokamen|4'])!;
        replies.push({
            status: 403,
            body: {
                error: 'house.link', code: 'house.link', text: 'Odhad a potvrzení v terminálu výzkumu.', link: own,
                estimate: { minutes: 80, measured: false, perHouse: { minutes: 30 }, perTown: { minutes: 20 } },
            },
        });
        const r = await requestHouse(BASE, 'belokamen|16', ['belokamen|4'], F2, CHECK);
        expect(r).toEqual({
            ok: false, code: 'link', status: 403, reason: 'Odhad a potvrzení v terminálu výzkumu.', bridgeCode: 'house.link', link: own,
            estimate: { minutes: 80, measured: false, perHouse: { minutes: 30 }, perTown: { minutes: 20 } },
        });
        // A link the app would not build is replaced by its own.
        replies.push({ status: 403, body: { error: 'house.link', code: 'house.link', link: 'https://example.org/elsewhere' } });
        const other = await requestHouse(BASE, 'belokamen|16', ['belokamen|4'], F2, CHECK);
        expect(other.ok === false && other.code === 'link' && other.link).toBe(own);
        expect(other.ok === false && other.code === 'link' && other.estimate).toBeNull();
    });

    it('the setting on: 200 queued with the house row, its task and the town\'s frame task', async () => {
        replies.push({
            status: 200,
            body: {
                house: { ...QUEUED_ROW, key: 'belokamen|16', place: { key: 'belokamen', id: 'L0001', name: 'Bělokamen' }, house: '16' },
                task: 'T0002', state: 'queued', town: 'T0001', head: HEAD, parent: PARENT,
            },
        });
        const r = await requestHouse(BASE, 'belokamen|16', [], F2, CHECK);
        expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ house: 'belokamen|16' });
        expect(r).toMatchObject({ ok: true, state: 'queued', task: 'T0002', town: 'T0001', head: HEAD, parent: PARENT });
        expect(r.ok && r.house?.key).toBe('belokamen|16');
    });

    it('moves a waiting house to the top as a request of the house alone', async () => {
        replies.push({ status: 200, body: { house: QUEUED_ROW, task: 'T0004', state: 'queued', head: HEAD, parent: PARENT } });
        const r = await moveHouseToTop(BASE, 'brodek|5', F2, CHECK);
        expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ house: 'brodek|5' });
        expect(r).toMatchObject({ ok: true, task: 'T0004' });
    });

    it('refusals: another town 400, unknown house 404, archive 409, busy 503; a bad key is not sent', async () => {
        replies.push({ status: 400, body: { error: 'house.body', code: 'house.body' } });
        expect(await requestHouse(BASE, 'belokamen|16', ['brodek|5'], F2, CHECK)).toMatchObject({ ok: false, code: 'invalid' });
        replies.push({ status: 404, body: { error: 'house.unknown', code: 'house.unknown' } });
        expect(await requestHouse(BASE, 'belokamen|99', [], F2, CHECK)).toMatchObject({ ok: false, code: 'unknown-house' });
        replies.push({ status: 409, body: { error: 'house.archive', code: 'house.archive' } });
        expect(await requestHouse(BASE, 'belokamen|16', [], F2, CHECK)).toMatchObject({ ok: false, code: 'archive' });
        replies.push({ status: 503, body: { error: 'research.busy', code: 'research.busy' } });
        expect(await requestHouse(BASE, 'belokamen|16', [], F2, CHECK)).toMatchObject({ ok: false, code: 'busy' });
        const sent = calls.length;
        expect(await requestHouse(BASE, 'no key', [], F2, CHECK)).toMatchObject({ ok: false, code: 'invalid', status: 0 });
        expect(calls.length).toBe(sent);
    });
});

describe('part 2: a house\'s result', () => {
    it('reads the town\'s frame with its place and the day it was done, a map on a layer, the houses joined as the same', () => {
        const h = sanitizeHouseResearch({
            house: {
                ...MILL,
                maps: [
                    { id: 'm1', kind: 'cadastre', manual: true, sheet: 'list 2', url: 'https://example.org/stabilni-katastr/belokamen' },
                    { id: 'm2', kind: 'ortho', layer: 'cz-ortho', origin: 'research' },
                ],
                town: {
                    id: 'A0002', place: { id: 'L0001', name: 'Bělokamen' }, text: 'Fara Brodek, katastrální území Bělokamen.',
                    passed: [], manual: [], archiveOnly: [], maps: [], unknown: [], done: '2026-11-26', task: 'T0001', state: 'done',
                },
                same: [{ id: 'A0009', key: 'belokamen|9' }, { id: 'x y', key: 'belokamen|8' }],
            },
        })!;
        expect(h.maps[1]).toEqual({ id: 'm2', kind: 'ortho', layer: 'cz-ortho', origin: 'research' });
        expect(h.town).toMatchObject({ id: 'A0002', place: { id: 'L0001', name: 'Bělokamen' }, done: '2026-11-26', task: 'T0001', state: 'done' });
        expect(h.same).toEqual([{ id: 'A0009', key: 'belokamen|9' }]);
        // The sample of the research: a town's frame without a place.
        expect(sanitizeHouseResearch({ house: MILL })!.town).toMatchObject({ id: 'A0002' });
    });
});

describe('spec 145 T1: the look of a house', () => {
    const TOWN = { id: 'A0002', place: { id: 'L0001', name: 'Bělokamen' }, passed: [], manual: [], archiveOnly: [], maps: [], unknown: [] };

    it('reads the check of the look, the town\'s pictures with their licence and its field names', () => {
        const h = sanitizeHouseResearch({
            ...MILL, work: 'house', look: { text: 'Zděné stavení', certainty: 'medium', origin: 'research', images: [] },
            lookCheck: { next: 'source', text: 'pramen popisuje stavení podrobněji', task: 'T0002', at: '2026-11-27T10:00:00Z', origin: 'research' },
            unknown: [{ id: 'u1', text: 'podoba: víc automaticky nejde', question: null, about: 'look' }, { id: 'u2', text: 'Kdo?', about: 'other' }],
            passed: [{ id: 'p1', what: 'prošlo: matriky, pozemková kniha', checklist: true }, { id: 'p2', what: 'Kronika', checklist: 'yes' }],
            town: {
                ...TOWN,
                pictures: [
                    { id: 'i1', url: 'https://commons.example.org/naves.jpg', license: 'CC BY-SA 4.0', credit: 'Jan Brodský', shows: 'náves s čp. 16', origin: 'research' },
                    { id: 'i2', url: 'https://commons.example.org/bez.jpg', shows: 'bez licence' },
                    { id: 'i3', url: 'javascript:alert(1)', license: 'CC0', shows: 'špatná adresa' },
                    { id: 'i4', url: 'https://commons.example.org/x.jpg', license: 'CC0' },
                ],
                fieldNames: [
                    { id: 'f1', name: 'Prouzalův mlýn', kind: 'mlýn', lat: 49.61, lon: 15.22, house: '16', url: 'https://example.org/mlyn', source: 'S0041', origin: 'research' },
                    { id: 'f2', name: 'Na Skále', lat: 200, lon: 15 },
                    { id: 'f3', kind: 'samota' },
                ],
            },
        })!;
        expect(h.look).toEqual({ text: 'Zděné stavení', certainty: 'medium', origin: 'research', images: [] });
        expect(h.lookTask).toBeUndefined();
        expect(h.lookCheck).toEqual({ next: 'source', text: 'pramen popisuje stavení podrobněji', task: 'T0002', at: '2026-11-27T10:00:00Z', origin: 'research' });
        expect(h.unknown).toEqual([
            { id: 'u1', text: 'podoba: víc automaticky nejde', question: null, about: 'look' },
            { id: 'u2', text: 'Kdo?', question: null },
        ]);
        expect(h.passed).toEqual([{ id: 'p1', what: 'prošlo: matriky, pozemková kniha', checklist: true }, { id: 'p2', what: 'Kronika' }]);
        // A picture without its licence, its web address or what it shows is left out.
        expect(h.town!.pictures).toEqual([
            { id: 'i1', url: 'https://commons.example.org/naves.jpg', license: 'CC BY-SA 4.0', credit: 'Jan Brodský', shows: 'náves s čp. 16', origin: 'research' },
        ]);
        // A field name keeps a point only when it is one; without a name it is left out.
        expect(h.town!.fieldNames).toEqual([
            { id: 'f1', name: 'Prouzalův mlýn', kind: 'mlýn', lat: 49.61, lon: 15.22, house: '16', url: 'https://example.org/mlyn', source: 'S0041', origin: 'research' },
            { id: 'f2', name: 'Na Skále' },
        ]);
    });

    it('an unknown next or a check without its text is none; empty or missing lists are none', () => {
        const h = sanitizeHouseResearch({ ...MILL, lookCheck: { next: 'later', text: 'x' }, town: { ...TOWN, pictures: [], fieldNames: 'no' } })!;
        expect(h.lookCheck).toBeUndefined();
        expect(sanitizeHouseResearch({ ...MILL, lookCheck: { next: 'none' } })!.lookCheck).toBeUndefined();
        expect(h.town).not.toHaveProperty('pictures');
        expect(h.town).not.toHaveProperty('fieldNames');
        // A research that does not know the look loses nothing.
        const old = sanitizeHouseResearch({ ...MILL, town: TOWN })!;
        expect(old).not.toHaveProperty('lookCheck');
        expect(old).not.toHaveProperty('lookTask');
        expect(old.town).toMatchObject({ id: 'A0002' });
    });

    it('the task of the look: work house with look true in the row and in the detail', () => {
        expect(sanitizeHouseRow({ ...QUEUED_ROW, work: 'house', look: true })).toMatchObject({ work: 'house', look: true });
        expect(sanitizeHouseRow({ ...QUEUED_ROW, work: 'house', look: 'yes' })).not.toHaveProperty('look');
        expect(sanitizeHouseRow({ ...QUEUED_ROW, work: 'town', look: true })).not.toHaveProperty('look');
        expect(sanitizeHouseRow(QUEUED_ROW)).not.toHaveProperty('look');
        const h = sanitizeHouseResearch({ ...MILL, state: 'queued', work: 'house', look: true })!;
        expect(h).toMatchObject({ work: 'house', lookTask: true });
        // `look: true` is the task's flag, not a look.
        expect(h.look).toBeUndefined();
    });
});
