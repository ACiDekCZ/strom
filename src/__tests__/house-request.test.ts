/**
 * Asking the research for a house's history (spec 030 §2, K2.1a): the action of a house by its research state
 * and the setting, its mark, the houses going with a request and the dialog's estimate.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage, strings } from '../strings.js';
import type { TreeHouse } from '../houses.js';
import { sanitizeLiveHouses } from '../research-link.js';
import {
    houseActionMark, houseActionOf, houseNeighbours, houseNeighboursChosen, houseRequestCostText, houseRequestEstimate,
    houseRequestRefusal, placeHouseMeta, townFamilyHouses, type HouseActionGate,
} from '../ui/house-request-ui.js';
import { eventDetailLineHtml } from '../ui/event-details-ui.js';

afterEach(() => setLanguage('en'));

const OFF: HouseActionGate = { on: false, request: true, terminal: true };
const ON: HouseActionGate = { on: true, request: true, terminal: true };

const house = (number: string, init: Partial<TreeHouse> = {}): TreeHouse => ({
    id: `belokamen|${number}`, ref: { town: 'Bělokamen', house: `čp. ${number}` }, townKey: 'belokamen', text: `čp. ${number}`,
    numbers: [], facts: [], surnames: [], generations: 1, persons: 1, personIds: [], marriedIn: [], overThreshold: false, ...init,
} as TreeHouse);

describe('A house\'s action by its state and the setting', () => {
    it('none / postponed: ask through the terminal while off, move to the top while on', () => {
        expect(houseActionOf(null, OFF)).toBe('request');
        expect(houseActionOf({ state: 'none' }, OFF)).toBe('request');
        expect(houseActionOf({ state: 'held' }, OFF)).toBe('request');
        expect(houseActionOf(null, ON)).toBe('top');
        expect(houseActionOf({ state: 'held' }, ON)).toBe('top');
    });

    it('queued: to the top only while on; done: ask again; running, waiting, taken over: nothing', () => {
        expect(houseActionOf({ state: 'queued' }, ON)).toBe('top');
        expect(houseActionOf({ state: 'queued' }, OFF)).toBeNull();
        expect(houseActionOf({ state: 'done', at: '2027-03-12' }, OFF)).toBe('again');
        expect(houseActionOf({ state: 'done' }, ON)).toBe('again');
        expect(houseActionOf({ state: 'running' }, ON)).toBeNull();
        expect(houseActionOf({ state: 'waiting', question: { id: 'T1' } }, OFF)).toBeNull();
        expect(houseActionOf({ state: 'queued', work: 'takeover' }, ON)).toBeNull();
    });

    it('nothing without `house.request`; without a terminal here only what goes over the bridge', () => {
        expect(houseActionOf(null, { ...OFF, request: false })).toBeNull();
        expect(houseActionOf(null, { ...ON, request: false })).toBeNull();
        expect(houseActionOf(null, { ...OFF, terminal: false })).toBeNull();
        expect(houseActionOf({ state: 'done' }, { ...OFF, terminal: false })).toBeNull();
        expect(houseActionOf(null, { ...ON, terminal: false })).toBe('top');
    });

    it('marks: the terminal\'s ask is the agent\'s (AI + terminal), over the bridge none', () => {
        expect(houseActionMark('request', false)).toBe('agent');
        expect(houseActionMark('again', false)).toBe('agent');
        expect(houseActionMark('again', true)).toBe('none');
        expect(houseActionMark('request', true)).toBe('none');
        expect(houseActionMark('top', false)).toBe('none');
    });
});

describe('The houses going with a request', () => {
    const own = house('16', { overThreshold: true, numbers: [{ house: 'čp. 9', source: 'user' } as never] });
    const all = [
        own,
        house('9'),
        house('4', { overThreshold: true }),
        house('31', { overThreshold: true }),
        house('12', { overThreshold: true }),
        house('7'),
        house('3', { townKey: 'zalesi', id: 'zalesi|3', overThreshold: true }),
    ];

    it('only the same town, not the house nor a number joined into it, not one the research is at; with history first', () => {
        const rows: Record<string, { state: 'queued' | 'done'; key: string }> = {
            'belokamen|12': { state: 'queued', key: 'belokamen|12' },
            'belokamen|31': { state: 'done', key: 'belokamen|31' },
        };
        const list = houseNeighbours(own, all, h => rows[h.id] ?? null);
        expect(list.map(n => n.id)).toEqual(['belokamen|4', 'belokamen|31', 'belokamen|7']);
        expect(list.find(n => n.id === 'belokamen|31')?.key).toBe('belokamen|31');
    });

    it('chosen at first: those with history, at most two', () => {
        const list = houseNeighbours(own, all, () => null);
        expect(houseNeighboursChosen(list)).toEqual(['belokamen|4', 'belokamen|31']);
        expect(houseNeighboursChosen(houseNeighbours(house('7'), [house('7'), house('5')], () => null))).toEqual([]);
    });
});

describe('The request\'s estimate', () => {
    const measured = sanitizeLiveHouses({
        on: false, rev: 'r1', counts: { done: 0, running: 0, queued: 0, waiting: 0, held: 0 },
        estimate: { minutes: 0, measured: true, perHouse: { minutes: 30, usd: 1.2 }, perTown: { minutes: 20, usd: 0.9 } },
    })!.estimate;

    it('per house and the town\'s frame when it has none; the price only once measured', () => {
        expect(houseRequestEstimate(measured, 3, false)).toEqual({ minutes: 110, usd: 1.2 * 3 + 0.9 });
        expect(houseRequestEstimate(measured, 1, true)).toEqual({ minutes: 30, usd: 1.2 });
        expect(houseRequestEstimate(measured ? { ...measured, measured: false } : undefined, 1, false)).toEqual({ minutes: 50, usd: null });
        // Without the research's estimate: its defaults (30 min a house, 20 min a town).
        expect(houseRequestEstimate(undefined, 2, false)).toEqual({ minutes: 80, usd: null });
    });

    it('the price, the time and "at most 3" stay whole on a line break (cs/en/de/pl)', () => {
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
            setLanguage(lang);
            expect(strings.houses.req.max).toMatch(/\S\u00a03$/);
            expect(houseRequestCostText({ minutes: 50, usd: 2.1 })).toMatch(/50\u00a0(min|Min\.) \(≈\u00a02[.,]1\u00a0USD\)/);
        }
    });

    it('the sentence in cs and en', () => {
        setLanguage('cs');
        expect(houseRequestCostText({ minutes: 50, usd: null })).toBe('Jedno sezení výzkumu, zhruba 50\u00a0min. Čerpá předplatné AI agenta výzkumu.');
        setLanguage('en');
        expect(houseRequestCostText({ minutes: 110, usd: 4.5 })).toBe('One research session, about 2\u00a0h (≈\u00a04.5\u00a0USD). Uses the research agent’s AI subscription.');
    });

    it('a refusal says the bridge\'s words, else the usual sentence', () => {
        expect(houseRequestRefusal({ ok: false, code: 'invalid', status: 400, reason: 'Another town.', bridgeCode: 'house.body' }, () => '')).toBe('Another town.');
        expect(houseRequestRefusal({ ok: false, code: 'busy', status: 503, reason: '', bridgeCode: 'research.busy' }, () => '')).not.toBe('');
    });
});

describe('A town\'s family houses and an event\'s house (§5)', () => {
    const all = [
        house('16', { overThreshold: true }),
        house('9'),
        house('4'),
        house('3', { townKey: 'zalesi', id: 'zalesi|3', overThreshold: true }),
    ];

    it('the town\'s houses with history and those the research knows, only where the tree\'s people lived', () => {
        expect(townFamilyHouses(all, 'belokamen', h => h.id === 'belokamen|4').map(h => h.id)).toEqual(['belokamen|16', 'belokamen|4']);
        expect(townFamilyHouses(all, 'brodek', () => true)).toEqual([]);
    });

    it('a house\'s line: name, years, surnames', () => {
        expect(placeHouseMeta({ name: 'U Prouzalů', period: { from: 1780, to: 1902 }, surnames: ['Prouzal', 'Kvitelka'] }))
            .toBe('U Prouzalů · 1780–1902 · Prouzal → Kvitelka');
        expect(placeHouseMeta({ period: { from: 1850, to: 1850 }, surnames: [] })).toBe('1850');
    });

    it('an event\'s address drawn as the link to its house, the rest escaped', () => {
        setLanguage('en');
        const line = eventDetailLineHtml({ cause: 'a <fever>', address: 'čp. 16' }, false,
            a => a === 'čp. 16' ? '<button class="pm-house-link">čp. 16</button>' : null);
        expect(line).toBe('a &lt;fever&gt; · <button class="pm-house-link">čp. 16</button>');
        expect(eventDetailLineHtml({ address: 'Brodek & co' }, false, () => null)).toBe('Brodek &amp; co');
        expect(eventDetailLineHtml(undefined)).toBe('');
    });
});
