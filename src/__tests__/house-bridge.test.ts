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
    houseWriteReply, sanitizeHouseResearch, sendHouseMaterial,
} from '../house-bridge.js';
import { sanitizeLiveHouses, sanitizeLiveStatus } from '../research-link.js';

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
    holders: [{ id: 'h1', name: 'Ignác Kvitelka', person: 'P0002', from: '1858', to: '1890', how: 'marriage', certainty: 'high', sources: ['S0043'], origin: 'research', at: '2026-11-26' }],
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
    materials: [{ id: 'I0007', kind: 'memory', text: 'Babička vyprávěla o studni za stodolou.', witness: 'Zdislava Kvitelková', at: '2026-11-26' }],
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
        expect(sanitizeLiveHouses(raw)).toEqual({ on: false, rev: REV, counts: { done: 1, running: 0, queued: 1, waiting: 0, held: 0 } });
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
        expect(h.materials[0]).toMatchObject({ id: 'I0007', kind: 'memory', witness: 'Zdislava Kvitelková' });
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
        expect(houseMaterialBody({ house: 'belokamen|16', memory: { text: ' Studna za stodolou ', witness: 'Zdislava', witnessConsent: false } }))
            .toEqual({ house: 'belokamen|16', memory: { text: 'Studna za stodolou', witnessConsent: false } });
        expect(houseMaterialBody({ house: 'belokamen|16' })).toBeNull();
        replies.push({ status: 200, body: { house: MILL, materials: [{ id: 'I0007', kind: 'memory' }], head: 'a'.repeat(40), parent: 'b'.repeat(40) } });
        const res = await sendHouseMaterial(BASE, { house: 'belokamen|16', memory: { text: 'Studna', witness: 'Zdislava', witnessConsent: true }, name: 'U Prouzalů' }, ['house', 'house.material']);
        expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({
            house: 'belokamen|16', memory: { text: 'Studna', witness: 'Zdislava', witnessConsent: true }, name: 'U Prouzalů',
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
