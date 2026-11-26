import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { StreamEvent } from '../device/device-crypto';
import type { DeviceConnection } from '../device/device-connection';

const fetchCalls: { path: string; tree?: string }[] = [];
let answers: Record<string, { status: number; body: unknown }> = {};
const eventListeners = new Set<(e: StreamEvent) => void>();
const connListeners = new Set<(c: DeviceConnection) => void>();
let connNow: DeviceConnection | null = null;

vi.mock('../device/gateway-client', () => ({
    deviceFetch: vi.fn(async (path: string, init: { tree?: string } = {}) => {
        fetchCalls.push({ path, tree: init.tree });
        const key = path.split('?')[0];
        const a = answers[key];
        if (!a) return new Response('{"code":"not-found"}', { status: 404 });
        return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body), { status: a.status });
    }),
}));
vi.mock('../device/device-connection', () => ({
    deviceConnection: () => connNow,
    onDeviceEvent: (cb: (e: StreamEvent) => void) => { eventListeners.add(cb); return () => eventListeners.delete(cb); },
    onDeviceConnection: (cb: (c: DeviceConnection) => void) => { connListeners.add(cb); return () => connListeners.delete(cb); },
}));

import {
    sanitizeGlance, sanitizeFinds, sanitizePeopleHits, sanitizeResearchState, deviceResearchFeatures, findsPath, peopleQueryOk,
    searchPeople, readGlance, readFinds, readDeviceResearch, heldResearchState, keepResearchState, watchDeviceResearch,
    PEOPLE_SEARCH_MAX, type DeviceResearchState,
} from '../device/device-research-data';
import {
    setDeviceKv, memoryKv, savePairing, forgetPairing, deviceQueue, saveLastView, loadLastView,
    saveResearchState, loadResearchState, markFindsSeen, findsSeenAt,
} from '../device/device-store';

const TREE = 'pychavkovi';

function fakeLocalStorage(): Storage {
    const m = new Map<string, string>();
    return {
        get length() { return m.size; },
        clear: () => m.clear(),
        getItem: k => m.get(k) ?? null,
        key: i => [...m.keys()][i] ?? null,
        removeItem: k => { m.delete(k); },
        setItem: (k, v) => { m.set(k, String(v)); },
    };
}

async function paired(): Promise<void> {
    await savePairing({
        deviceId: 'dv_abcdefghijklmnop', key: new Uint8Array(32).fill(7), name: 'iPhone · Safari', kind: 'phone',
        computer: { name: 'Pracovna.local', label: 'Pracovna' }, trees: [{ id: TREE, name: 'Pýchavkovi z Mlýnků' }],
        origin: 'http://192.168.1.20:47800', pairedAt: '2026-11-25T10:00:00.000Z',
    });
}

/** A glance as the bridge gives it (core/glance.ts), fictional data. */
const GLANCE = {
    head: 'abc123',
    headAt: '2026-11-25T09:58:00Z',
    tree: { id: TREE, name: 'Pýchavkovi z Mlýnků', lang: 'cs', state: 'research', persons: 412, families: 130, ged: { bytes: 801234, head: 'abc123' } },
    day: { persons: 3, sources: 2, saves: 41, since: '2026-11-24T10:00:00Z' },
    now: [{ since: '2026-11-25T09:00:00Z', line: 'G0002', way: 'up', task: { id: 'T0042', text: 'Najít křest Vojtěcha Pýchavky' }, person: 'P12', run: 'run-7f3a', agent: 'secret-model' }],
    runs: [{ id: 'run-7f3a', line: 'G0002', way: 'up', since: '2026-11-25T08:59:00Z', state: 'working', task: 'T0042' }],
    lines: [
        { id: 'G0002', n: 1, name: 'Předkové Vojtěcha', direction: 'ancestors', way: 'up', state: 'active', tasks: 4, waiting: 1, working: true, since: '2026-11-20T08:00:00Z', focus: 'P12' },
        { id: 'G0003', n: 2, name: 'Mlýnek\u0000 v Lhotce', direction: 'descendants', way: 'down', state: 'paused', tasks: 0, waiting: 0, working: false, since: '2026-11-21T08:00:00Z', reason: 'čeká na archiv' },
    ],
    waiting: {
        n: 3,
        items: [
            { id: 'T0050', kind: 'task', section: 'archive', phase: 'todo', what: 'Vyfotit matriku', at: '2026-11-25T08:00:00Z', group: { key: 'arch', name: 'Archiv Mlýnky', kind: 'archive', url: 'javascript:alert(1)' }, person: 'P12', do: ['answer', 'sent', 'launch-agent'] },
            { id: 'H0007', kind: 'hypothesis', section: 'decide', phase: 'todo', what: 'Kdo je otec', at: '2026-11-25T07:00:00Z', group: { key: 'h', name: 'Hypotézy', kind: 'hyp', url: 'https://example.org/x' },
                hypothesis: { variants: [{ label: 'A', claim: 'Jan' }, { label: 'B', claim: 'Josef' }], proposal: { variant: 'A', decision: 'podle matriky' } }, do: ['decide'] },
            { kind: 'task', what: 'no id' },
        ],
    },
    people: { P12: { name: 'Vojtěch Pýchavka', span: '1801–1860' }, 'not-a-person': { name: 'x' } },
    extra: { anything: true },
};

const FINDS = {
    since: '2026-11-24T10:00:00Z',
    groups: [
        { key: 'a1b2c3d4e5f6', kind: 'person', title: 'Anna Pýchavková (1830–1890)', name: 'Anna Pýchavková', span: '1830–1890', person: 'P40', at: '2026-11-25T09:00:00Z',
            lines: [
                { kind: 'person', text: '', at: '2026-11-25T09:00:00Z' },
                { kind: 'fact', text: 'Narození: 3. 4. 1830, Mlýnky', at: '2026-11-25T08:50:00Z', fact: { kind: 'BIRT', name: 'Narození', what: '3. 4. 1830, Mlýnky' } },
                { kind: 'child', text: 'Josef', at: '2026-11-25T08:40:00Z', span: '1855–1900', person: 'P41' },
                { kind: 'telepathy', text: 'unknown kind', at: '2026-11-25T08:30:00Z' },
            ] },
        { key: 'f00d', kind: 'sources', at: '2026-11-25T07:00:00Z', lines: [{ kind: 'source', text: 'Matrika Mlýnky 1820–1850', at: '2026-11-25T07:00:00Z' }] },
        { key: 'bad', kind: 'weird', at: '2026-11-25T07:00:00Z', lines: [{ kind: 'source', text: 'x', at: '2026-11-25T07:00:00Z' }] },
        { key: 'empty', kind: 'family', title: 'Rodina', at: '2026-11-25T07:00:00Z', lines: [] },
    ],
    cut: 2,
    earlier: '2026-11-10T10:00:00Z',
};

beforeEach(() => {
    vi.stubGlobal('localStorage', fakeLocalStorage());
    setDeviceKv(memoryKv());
    fetchCalls.length = 0;
    answers = {};
    eventListeners.clear();
    connListeners.clear();
    connNow = null;
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    setDeviceKv(null);
});

describe('device research data: features', () => {
    it('reads glance, people.search, finds and finds.person from the status', () => {
        expect(deviceResearchFeatures({ features: ['glance', 'people.search', 'finds', 'finds.person'] }))
            .toEqual({ glance: true, peopleSearch: true, finds: true, findsPerson: true });
        expect(deviceResearchFeatures(['finds.person'])).toEqual({ glance: false, peopleSearch: false, finds: false, findsPerson: false });
        expect(deviceResearchFeatures(null)).toEqual({ glance: false, peopleSearch: false, finds: false, findsPerson: false });
        expect(deviceResearchFeatures({ features: 'glance' }).glance).toBe(false);
    });
});

describe('device research data: cleaning', () => {
    it('keeps a glance and drops what it does not know', () => {
        const g = sanitizeGlance(GLANCE)!;
        expect(g.tree).toEqual({ id: TREE, name: 'Pýchavkovi z Mlýnků', lang: 'cs', state: 'research', persons: 412, families: 130, ged: { bytes: 801234, head: 'abc123' } });
        expect(g.day).toEqual({ persons: 3, sources: 2, saves: 41, since: '2026-11-24T10:00:00Z' });
        expect(g.now).toEqual([{ since: '2026-11-25T09:00:00Z', line: 'G0002', way: 'up', task: { id: 'T0042', text: 'Najít křest Vojtěcha Pýchavky' }, person: 'P12', run: 'run-7f3a' }]);
        expect(g.runs[0]).toEqual({ id: 'run-7f3a', line: 'G0002', way: 'up', since: '2026-11-25T08:59:00Z', state: 'working', task: 'T0042' });
        expect(g.lines.map(l => l.name)).toEqual(['Předkové Vojtěcha', 'Mlýnek v Lhotce']);
        expect(g.lines[1]).toMatchObject({ state: 'paused', reason: 'čeká na archiv', working: false });
        expect(g.waiting.n).toBe(3);
        expect(g.waiting.items).toHaveLength(2);
        expect(g.waiting.items[0].do).toEqual(['answer', 'sent']);
        expect(g.waiting.items[0].group.url).toBeUndefined();
        expect(g.waiting.items[1].group.url).toBe('https://example.org/x');
        expect(g.waiting.items[1].hypothesis).toEqual({ variants: [{ label: 'A', claim: 'Jan' }, { label: 'B', claim: 'Josef' }], proposal: { variant: 'A', decision: 'podle matriky' } });
        expect(g.people).toEqual({ P12: { name: 'Vojtěch Pýchavka', span: '1801–1860' } });
        expect(JSON.stringify(g)).not.toContain('secret-model');
        expect(JSON.stringify(g)).not.toContain('extra');
    });

    it('a locked glance says the tree and the code alone; nonsense is null', () => {
        const g = sanitizeGlance({ tree: { id: TREE, name: 'X', lang: 'en' }, locked: { code: 'tree.newer' }, now: [{ since: 'x' }] })!;
        expect(g.locked).toEqual({ code: 'tree.newer' });
        expect(g.now).toEqual([]);
        expect(sanitizeGlance(null)).toBeNull();
        expect(sanitizeGlance('glance')).toBeNull();
        expect(sanitizeGlance([GLANCE])).toBeNull();
        expect(sanitizeGlance({ now: [] })).toBeNull();
    });

    it('never throws on odd fields', () => {
        const odd = { tree: { id: 5, persons: -3, families: 'many' }, now: 'x', runs: [null, 3, { id: '' }], lines: [{ id: 'G1', n: NaN }], waiting: { n: 'x', items: [{ id: 'T1', do: 'answer', retry: { can: 'yes' } }] }, people: [] };
        const g = sanitizeGlance(odd)!;
        expect(g.tree).toMatchObject({ id: '', persons: 0, families: 0 });
        expect(g.now).toEqual([]);
        expect(g.runs).toEqual([]);
        expect(g.lines).toEqual([expect.objectContaining({ id: 'G1', n: 0, name: 'G1' })]);
        expect(g.waiting.items[0].do).toEqual([]);
        expect(g.waiting.items[0].retry).toBeUndefined();
    });

    it('keeps finds with persons by ID and drops unknown kinds and empty groups', () => {
        const f = sanitizeFinds(FINDS)!;
        expect(f.since).toBe('2026-11-24T10:00:00Z');
        expect(f.cut).toBe(2);
        expect(f.earlier).toBe('2026-11-10T10:00:00Z');
        expect(f.groups.map(g => g.key)).toEqual(['a1b2c3d4e5f6', 'f00d']);
        // A family's marriage place (K3.13) is kept; nothing else carries one.
        const one = (kind: string) => sanitizeFinds({ groups: [{ key: 'k', kind, title: 'Pýchavka a Mlýnková', place: 'Sloup', lines: [{ kind: 'family', text: '', at: '2026-11-25T06:00:00Z' }] }] })!.groups[0];
        expect(one('family').place).toBe('Sloup');
        expect(one('person').place).toBeUndefined();
        const person = f.groups[0];
        expect(person.person).toBe('P40');
        expect(person.lines.map(l => l.kind)).toEqual(['person', 'fact', 'child']);
        expect(person.lines[1].fact).toEqual({ kind: 'BIRT', name: 'Narození', what: '3. 4. 1830, Mlýnky' });
        expect(person.lines[2]).toMatchObject({ span: '1855–1900', person: 'P41' });
        expect(sanitizeFinds({ since: 'x' })).toBeNull();
        expect(sanitizeFinds({ groups: [] })).toEqual({ since: '', groups: [] });
    });

    it('keeps at most 8 people found, by valid IDs only', () => {
        const many = Array.from({ length: 12 }, (_, i) => ({ id: `P${i + 1}`, name: `Pýchavka ${i + 1}`, span: '1800–1850', place: 'Mlýnky', birth: 'x' }));
        const hits = sanitizePeopleHits({ people: [{ id: 'F1', name: 'family' }, { id: 'P1', name: 'dup' }, ...many] });
        expect(hits).toHaveLength(PEOPLE_SEARCH_MAX);
        expect(hits[0]).toEqual({ id: 'P1', name: 'dup' });
        expect(hits[1]).toEqual({ id: 'P2', name: 'Pýchavka 2', span: '1800–1850', place: 'Mlýnky' });
        expect(sanitizePeopleHits('nobody')).toEqual([]);
        expect(sanitizePeopleHits([{ id: 'P5' }])).toEqual([{ id: 'P5', name: 'P5' }]);
    });

    it('a kept state is cleaned again when read back', () => {
        const s = sanitizeResearchState({ at: '2026-11-25T10:00:00Z', glance: GLANCE, finds: FINDS })!;
        expect(s.glance?.tree.id).toBe(TREE);
        expect(s.finds?.groups).toHaveLength(2);
        expect(sanitizeResearchState({ at: 'never', glance: GLANCE })).toBeNull();
        expect(sanitizeResearchState({ at: '2026-11-25T10:00:00Z', glance: null, finds: null })).toBeNull();
        expect(sanitizeResearchState(undefined)).toBeNull();
    });
});

describe('device research data: reading through the gateway', () => {
    it('asks glance, finds (since, lang) and people of the tree', async () => {
        answers = { glance: { status: 200, body: GLANCE }, finds: { status: 200, body: FINDS }, people: { status: 200, body: { people: [{ id: 'P12', name: 'Vojtěch Pýchavka' }] } } };
        expect((await readGlance(TREE))?.tree.persons).toBe(412);
        expect((await readFinds(TREE, { since: '2026-11-24T10:00:00Z', lang: 'cs' }))?.groups).toHaveLength(2);
        expect(await searchPeople(TREE, ' Pýcha ')).toEqual([{ id: 'P12', name: 'Vojtěch Pýchavka' }]);
        expect(fetchCalls).toEqual([
            { path: 'glance', tree: TREE },
            { path: 'finds?since=2026-11-24T10%3A00%3A00Z&lang=cs', tree: TREE },
            { path: 'people?q=P%C3%BDcha', tree: TREE },
        ]);
    });

    it('a short query asks nothing; an older research answers null', async () => {
        expect(peopleQueryOk('P')).toBe(false);
        expect(peopleQueryOk('Pý')).toBe(true);
        expect(await searchPeople(TREE, 'P ')).toEqual([]);
        expect(fetchCalls).toEqual([]);
        expect(await readGlance(TREE)).toBeNull();
        answers = { glance: { status: 200, body: '{broken' } };
        expect(await readGlance(TREE)).toBeNull();
    });

    it('the finds path leaves out what is not valid', () => {
        expect(findsPath()).toBe('finds');
        expect(findsPath({ since: 'yesterday', lang: 'c s' })).toBe('finds');
        expect(findsPath({ lang: 'de' })).toBe('finds?lang=de');
    });

    it('reads and keeps the state; finds since they were last seen', async () => {
        await markFindsSeen(TREE, '2026-11-24T12:00:00.000Z');
        answers = { glance: { status: 200, body: GLANCE }, finds: { status: 200, body: FINDS } };
        const features = deviceResearchFeatures(['glance', 'finds', 'finds.person']);
        const s = await readDeviceResearch(TREE, { features, lang: 'cs', now: () => new Date('2026-11-25T10:00:00Z') });
        expect(s.at).toBe('2026-11-25T10:00:00.000Z');
        expect(fetchCalls.map(c => c.path)).toEqual(['glance', 'finds?since=2026-11-24T12%3A00%3A00.000Z&lang=cs']);
        expect(await heldResearchState(TREE)).toEqual(s);

        // the finds not answered now: the held ones stay
        answers = { glance: { status: 200, body: { ...GLANCE, head: 'def456' } } };
        const again = await readDeviceResearch(TREE, { features, findsSince: null, now: () => new Date('2026-11-25T11:00:00Z') });
        expect(fetchCalls[fetchCalls.length - 1].path).toBe('finds');
        expect(again.glance?.head).toBe('def456');
        expect(again.finds).toEqual(s.finds);

        // a research without the feature: no finds at all
        const none = await readDeviceResearch(TREE, { features: deviceResearchFeatures(['glance']), now: () => new Date('2026-11-25T12:00:00Z') });
        expect(none.finds).toBeNull();
    });

    it('a failing connection throws (the held state is shown meanwhile)', async () => {
        const { deviceFetch } = await import('../device/gateway-client');
        vi.mocked(deviceFetch).mockRejectedValueOnce(new Error('gateway: timeout'));
        await expect(readGlance(TREE)).rejects.toThrow('timeout');
    });
});

describe('device research data: the last state and seen finds on the device', () => {
    const STATE: DeviceResearchState = { at: '2026-11-25T10:00:00.000Z', glance: sanitizeGlance(GLANCE), finds: sanitizeFinds(FINDS) };

    it('keeps the state per tree', async () => {
        expect(await heldResearchState(TREE)).toBeNull();
        await keepResearchState(TREE, STATE);
        expect(await heldResearchState(TREE)).toEqual(STATE);
        expect(await heldResearchState('another')).toBeNull();
        await saveResearchState('another', { at: 'x' });
        expect(await loadResearchState('another')).toEqual({ at: 'x' });
        expect(await heldResearchState('another')).toBeNull();
    });

    it('finds seen: kept per tree, never moved back, invalid times ignored', async () => {
        expect(await findsSeenAt(TREE)).toBeNull();
        await markFindsSeen(TREE, '2026-11-25T10:00:00.000Z');
        expect(await findsSeenAt(TREE)).toBe('2026-11-25T10:00:00.000Z');
        await markFindsSeen(TREE, '2026-11-25T09:00:00.000Z');
        expect(await findsSeenAt(TREE)).toBe('2026-11-25T10:00:00.000Z');
        await markFindsSeen(TREE, 'later');
        expect(await findsSeenAt(TREE)).toBe('2026-11-25T10:00:00.000Z');
        await markFindsSeen(TREE, '2026-11-25T11:00:00.000Z');
        expect(await findsSeenAt(TREE)).toBe('2026-11-25T11:00:00.000Z');
        expect(await findsSeenAt('another')).toBeNull();
    });

    it('an unpairing forgets the state and the seen finds; the queue stays', async () => {
        await paired();
        await keepResearchState(TREE, STATE);
        await markFindsSeen(TREE, '2026-11-25T10:00:00.000Z');
        await saveLastView(TREE, { people: 3 });
        await deviceQueue.put('photo:1', { kind: 'photo', name: 'matrika.jpg' });
        await forgetPairing();
        expect(await heldResearchState(TREE)).toBeNull();
        expect(await loadResearchState(TREE)).toBeUndefined();
        expect(await findsSeenAt(TREE)).toBeNull();
        expect(await loadLastView(TREE)).toBeUndefined();
        expect(await deviceQueue.get('photo:1')).toEqual({ kind: 'photo', name: 'matrika.jpg' });
    });
});

describe('device research data: live events', () => {
    const emit = (event: string): void => { for (const cb of [...eventListeners]) cb({ event, data: null }); };
    const conn = (state: DeviceConnection['state']): void => {
        connNow = { state, reason: null, since: Date.now() };
        for (const cb of [...connListeners]) cb(connNow);
    };

    it('a burst of changes reads once, then no sooner than the gap; other trees and events are not its', async () => {
        await paired();
        vi.useFakeTimers();
        connNow = { state: 'connected', reason: null, since: 0 };
        const calls: string[] = [];
        const off = watchDeviceResearch(TREE, why => calls.push(why), { delayMs: 400, minGapMs: 3000 });
        emit('change');
        emit('working');
        emit('change');
        emit('quality');
        vi.advanceTimersByTime(399);
        expect(calls).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(calls).toEqual(['change']);
        emit('working');
        vi.advanceTimersByTime(1000);
        expect(calls).toEqual(['change']);
        vi.advanceTimersByTime(2000);
        expect(calls).toEqual(['change', 'working']);

        // the connection lost and back: read again
        conn('unreachable');
        conn('connected');
        vi.advanceTimersByTime(3000);
        expect(calls).toEqual(['change', 'working', 'back']);

        off();
        emit('change');
        vi.advanceTimersByTime(5000);
        expect(calls).toHaveLength(3);
        expect(eventListeners.size).toBe(0);
        expect(connListeners.size).toBe(0);
    });

    it('a tree not chosen on the device is not told', async () => {
        await paired();
        vi.useFakeTimers();
        const calls: string[] = [];
        const off = watchDeviceResearch('another-tree', why => calls.push(why));
        emit('change');
        vi.advanceTimersByTime(5000);
        expect(calls).toEqual([]);
        off();
    });
});

describe('device research texts', () => {
    it('counts in each language', async () => {
        const { getStringsForLang } = await import('../strings');
        const cs = getStringsForLang('cs').deviceResearch;
        const en = getStringsForLang('en').deviceResearch;
        const de = getStringsForLang('de').deviceResearch;
        const pl = getStringsForLang('pl').deviceResearch;
        expect([1, 2, 5].map(n => cs.queueFailed(n))).toEqual(['1 fotka se neodeslala', '2 fotky se neodeslaly', '5 fotek se neodeslalo']);
        expect(cs.nowTitleLines(3)).toBe('Teď · 3 linie');
        expect(cs.findsNew(3)).toBe('3 nové ↓');
        expect(cs.dayLine(5, 1, 41)).toBe('Za 24 h: 5 osob · 1 pramen · 41 uložení');
        expect(en.queueFailed(1)).toBe('1 photo was not sent');
        expect(en.queueFailed(2)).toBe('2 photos were not sent');
        expect(en.treeNotYet(12400)).toBe('12,400 people · downloaded when opened');
        expect(de.queueOffline(1)).toBe('1 Foto · wartet auf Verbindung');
        expect(de.queueOffline(4)).toBe('4 Fotos · warten auf Verbindung');
        expect(pl.nowTitleLines(5)).toBe('Teraz · 5 linii');
        expect(pl.lineMeta(3)).toBe('3 zadania');
        expect(pl.waitingSent('10:05', 5)).toBe('Wysłano 10:05 · 5 zdjęć');
    });
});
