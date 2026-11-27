/**
 * The research's work on houses in the queue and "Awaiting action" (spec 030 §14): a task of a house says its
 * house in words and leads to its page, a takeover says so, a town's frame says its town; a question of a house
 * is found by its row; the queue's `house` key is read only with the kind `house`.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { houseOfQuestion, houseTaskView, type HouseTaskContext } from '../house-tasks.js';
import { HouseResearchCache, clearHouseCaches, houseCache, requestHouse, sanitizeHouseResearch, sanitizeHouseRow, type HouseListRow } from '../house-bridge.js';
import { sanitizeQueue } from '../research-link.js';
import { getStringsForLang, setLanguage } from '../strings.js';
import type { TreeHouse } from '../houses.js';

afterEach(() => setLanguage('cs'));

const summary = { events: 0, holders: 0, residents: 0, unknown: 0, materials: 0, passed: 0 };
const row = (over: Record<string, unknown>): HouseListRow => sanitizeHouseRow({
    key: 'belokamen|16', place: { key: 'belokamen', id: 'L0001', name: 'Bělokamen' }, house: '16', persons: 3, state: 'queued', summary, ...over,
})!;
const tree16 = { id: 'belokamen|16', ref: { town: 'Bělokamen', house: 'čp. 16' }, text: 'čp. 16', townKey: 'belokamen' } as unknown as TreeHouse;
const ctx = (rows: HouseListRow[], towns: Record<string, string> = {}): HouseTaskContext => ({
    rows,
    treeHouse: key => (key === 'belokamen|16' ? tree16 : null),
    townOfTask: t => towns[t] ?? null,
});

describe('houseTaskView', () => {
    it('is none for a task of another kind', () => {
        expect(houseTaskView({ id: 'T0001', text: 'Matriky', taskKind: 'records' }, ctx([]))).toBeNull();
        expect(houseTaskView({ id: 'T0001', text: 'x' }, ctx([]))).toBeNull();
    });

    it('a house\'s task: its number as the tree writes it and its town, leading to the tree\'s house', () => {
        setLanguage('cs');
        const v = houseTaskView({ id: 'T0004', text: 'History of the house Bělokamen 16', taskKind: 'house', house: 'belokamen|16' },
            ctx([row({ task: 'T0004', work: 'house' })]));
        expect(v).toEqual({ text: 'Historie domu čp. 16, Bělokamen', house: 'belokamen|16' });
        setLanguage('en');
        expect(houseTaskView({ id: 'T0004', text: 'x', taskKind: 'house', house: 'belokamen|16' }, ctx([]))!.text)
            .toBe('House history čp. 16, Bělokamen');
    });

    it('a house only the research knows: its number and town from its row, no link', () => {
        setLanguage('cs');
        const v = houseTaskView({ id: 'T0007', text: 'x', taskKind: 'house', house: 'mlynkovice|3' },
            ctx([row({ key: 'mlynkovice|3', house: '3', place: { key: 'mlynkovice', name: 'Mlýnkovice' }, task: 'T0007' })]));
        expect(v).toEqual({ text: 'Historie domu 3, Mlýnkovice' });
    });

    it('the takeover of an own research says so', () => {
        setLanguage('cs');
        const v = houseTaskView({ id: 'T0009', text: 'x', taskKind: 'house', house: 'belokamen|16' },
            ctx([row({ task: 'T0009', work: 'takeover' })]));
        expect(v).toEqual({ text: 'Převzít rešerši domu čp. 16', house: 'belokamen|16' });
    });

    it('the house\'s look (spec 145 T1) keeps the research\'s own name, leading to the house', () => {
        setLanguage('cs');
        const v = houseTaskView({ id: 'T0011', text: 'Podoba domu Bělokamen 16', taskKind: 'house', house: 'belokamen|16' },
            ctx([row({ task: 'T0011', work: 'house', look: true })]));
        expect(v).toEqual({ text: 'Podoba domu Bělokamen 16', house: 'belokamen|16' });
    });

    it('a town\'s frame: its town when known (the frame met), else the research\'s own text', () => {
        setLanguage('cs');
        expect(houseTaskView({ id: 'T0003', text: 'History of the houses of Bělokamen', taskKind: 'house' }, ctx([], { T0003: 'Bělokamen' })))
            .toEqual({ text: 'Kostra obce Bělokamen pro domy', town: 'Bělokamen' });
        expect(houseTaskView({ id: 'T0003', text: 'History of the houses of Bělokamen', taskKind: 'house' }, ctx([])))
            .toEqual({ text: 'History of the houses of Bělokamen' });
    });

    it('the texts in every language', () => {
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
            const I = getStringsForLang(lang).houses.integration;
            expect(I.taskHouse('čp. 16', 'Bělokamen')).toContain('čp. 16');
            expect(I.taskSkeleton('Bělokamen')).toContain('Bělokamen');
            expect(I.taskImport('čp. 16')).toContain('čp. 16');
            expect(getStringsForLang(lang).live.taskKinds.house).toBe({ cs: 'Domy', en: 'Houses', de: 'Häuser', pl: 'Domy' }[lang]);
        }
    });
});

describe('houseOfQuestion', () => {
    it('the row whose question, or whose waiting task, is the item', () => {
        const q = row({ state: 'waiting', task: 'T0005', question: { id: 'T0005', text: 'Je čp. 9 tentýž dům jako čp. 16?' } });
        const other = row({ key: 'belokamen|4', house: '4', state: 'waiting', task: 'T0006' });
        expect(houseOfQuestion('T0005', [q, other])?.key).toBe('belokamen|16');
        expect(houseOfQuestion('T0006', [q, other])?.key).toBe('belokamen|4');
        expect(houseOfQuestion('T0099', [q, other])).toBeNull();
        expect(houseOfQuestion('T0001', [row({ task: 'T0001', state: 'queued' })])).toBeNull();
    });
});

describe('the queue\'s house and the frames\' towns', () => {
    it('reads a task\'s house key only with the kind house', () => {
        const [a, b, c, d] = sanitizeQueue([
            { id: 'T0004', text: 'Dům', state: 'next', taskKind: 'house', house: 'belokamen|16' },
            { id: 'T0003', text: 'Kostra', state: 'next', taskKind: 'house' },
            { id: 'T0005', text: 'Matriky', state: 'next', taskKind: 'records', house: 'belokamen|16' },
            { id: 'T0006', text: 'Zlý klíč', state: 'next', taskKind: 'house', house: 'no-bar' },
        ]);
        expect(a!.house).toBe('belokamen|16');
        expect(b!.house).toBeUndefined();
        expect(c!.house).toBeUndefined();
        expect(d!.house).toBeUndefined();
    });

    it('a house read with its town\'s frame names the frame\'s task; a request\'s answer too', () => {
        const h = sanitizeHouseResearch({
            key: 'belokamen|16', place: { key: 'belokamen', id: 'L0001', name: 'Bělokamen' }, house: '16', persons: [], state: 'queued',
            town: { place: { id: 'L0001', name: 'Bělokamen' }, text: '', passed: [], manual: [], archiveOnly: [], maps: [], unknown: [], task: 'T0003', state: 'queued' },
        });
        expect(h?.town?.task).toBe('T0003');
        const cache = new HouseResearchCache();
        cache.put(h!);
        expect(cache.townTasks.get('T0003')).toBe('Bělokamen');
        cache.clear();
        expect(cache.townTasks.size).toBe(0);
    });

    it('a request\'s answer with the town\'s frame names the frame\'s task by the town', async () => {
        const body = JSON.stringify({
            ok: true, state: 'queued', task: 'T0004', town: 'T0003', head: 'a', parent: 'b',
            house: { key: 'belokamen|16', place: { key: 'belokamen', name: 'Bělokamen' }, house: '16', persons: 1, state: 'queued', summary },
        });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
        try {
            const base = 'http://127.0.0.1:9/t-house-tasks';
            const reply = await requestHouse(base, 'belokamen|16', [], ['house', 'house.request'], { tree: 'R1' });
            expect(reply.ok && reply.town).toBe('T0003');
            expect(houseCache(base).townTasks.get('T0003')).toBe('Bělokamen');
        } finally {
            vi.unstubAllGlobals();
            clearHouseCaches();
        }
    });
});
