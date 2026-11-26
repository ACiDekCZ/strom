/**
 * The book reads the research's results of its houses itself (spec 030 §8,
 * K7.3): the list of houses, then each house the research has a task for, a
 * few at a time; the houses done mark the Houses chapter's; any failure leaves
 * the house (or the whole book) to the tree, without an error.
 */
import { describe, expect, it } from 'vitest';
import type { HouseId } from '../types.js';
import { collectHouses } from '../houses.js';
import type { HouseListRow, HouseResearch } from '../house-bridge.js';
import { loadBookHouseResearch, type BookHouseReads } from '../book-house-research.js';
import { buildFamilyBook } from '../book.js';
import { defaultBookOptions } from '../book-options.js';
import { HOUSE_ID, HOUSE_NOW, houseResearch, houseTree } from './helpers/house-book-fixture.js';

const row = (key: string, state: HouseListRow['state']): HouseListRow => ({
    key: key as HouseId, place: { name: 'Bělokamen', key: 'belokamen' }, house: 'čp. 16', state, persons: 1, summary: {},
} as unknown as HouseListRow);

/** Reads that answer from a table, count the reads at once and fail where asked. */
function fakeReads(rows: HouseListRow[], fail: { list?: boolean; house?: Set<string>; throws?: boolean } = {}) {
    const stats = { list: 0, houses: [] as string[], running: 0, most: 0 };
    const reads: BookHouseReads = {
        list: async () => {
            stats.list++;
            if (fail.throws) throw new Error('network');
            return fail.list ? { ok: false } : { ok: true, houses: rows };
        },
        house: async (_base, key) => {
            stats.houses.push(key);
            stats.running++;
            stats.most = Math.max(stats.most, stats.running);
            await new Promise(r => setTimeout(r, 1));
            stats.running--;
            if (fail.house?.has(key)) throw new Error('timeout');
            return { ok: true, house: { ...houseResearch(), key: key as HouseId } as HouseResearch };
        },
    };
    return { reads, stats };
}

describe('the book reads the research\'s results of its houses', () => {
    it('the list, then each house with a task; the done ones are the chapter\'s; nothing for a house the research does not know', async () => {
        const houses = collectHouses(houseTree());
        const { reads, stats } = fakeReads([row(HOUSE_ID, 'done'), row('jinde|9', 'running')]);
        const got = await loadBookHouseResearch('http://bridge', houses, reads);
        expect(stats.list).toBe(1);
        expect(stats.houses).toEqual([HOUSE_ID]);
        expect([...got.research.keys()]).toEqual([HOUSE_ID]);
        expect([...got.finished]).toEqual([HOUSE_ID]);
    });

    it('no house in the book: nothing is read', async () => {
        const { reads, stats } = fakeReads([row(HOUSE_ID, 'done')]);
        await loadBookHouseResearch('http://bridge', [], reads);
        expect(stats.list).toBe(0);
    });

    it('a few at a time', async () => {
        const base = collectHouses(houseTree())[0];
        const houses = Array.from({ length: 10 }, (_, i) => ({ ...base, id: `belokamen|${100 + i}` as HouseId, numbers: [] }));
        const { reads, stats } = fakeReads(houses.map(h => row(h.id, 'waiting')));
        const got = await loadBookHouseResearch('http://bridge', houses, reads, 3);
        expect(stats.houses).toHaveLength(10);
        expect(stats.most).toBe(3);
        expect(got.research.size).toBe(10);
        expect(got.finished.size).toBe(0);
    });

    it('a failure: the house, or every house, without the research, never an error', async () => {
        const houses = collectHouses(houseTree());
        for (const fail of [{ list: true }, { throws: true }, { house: new Set([HOUSE_ID]) }]) {
            const { reads } = fakeReads([row(HOUSE_ID, 'done')], fail);
            const got = await loadBookHouseResearch('http://bridge', houses, reads);
            expect(got.research.size).toBe(0);
        }
        // The book is then built from the tree.
        const opts = { ...defaultBookOptions('cs'), parts: { ...defaultBookOptions('cs').parts, houses: true } };
        const html = buildFamilyBook(houseTree(), opts, { dateLabel: 'x', now: HOUSE_NOW, houseResearch: () => null });
        expect(html).toContain('id="book-houses"');
        expect(html).not.toContain('Stavení postaveno po rozdělení gruntu');
    });
});
