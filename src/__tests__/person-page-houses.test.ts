/**
 * A person's houses (spec 030 §12): the person page's addresses lead to the
 * house (a button in the window, an anchor only to a house page in the set,
 * text otherwise), the Places section's row "Houses" with the years there,
 * and the Timeline's tooltip names the house (the poster does not).
 */
import { describe, expect, it } from 'vitest';
import type { PersonId, StromData } from '../types.js';
import { buildPersonPageBody, preparePersonPageData, PERSON_PAGE_ALL_GROUPS, type PersonPageOptions } from '../person-page.js';
import { personHouses, treeHouseIndex, houseOfAddress } from '../person-houses.js';
import { computeTimelineModel } from '../timeline.js';
import { HOUSE_ID, HOUSE_NOW, houseTree } from './helpers/house-book-fixture.js';

const pid = (s: string): PersonId => s as PersonId;

const opts = (o: Partial<PersonPageOptions> = {}): PersonPageOptions => ({
    personId: pid('hostivit'), lang: 'en', mode: 'app', links: 'app', groups: { ...PERSON_PAGE_ALL_GROUPS },
    privacy: 'full', toggles: { history: true, childEvents: true }, research: false, now: HOUSE_NOW, ...o,
});
const body = (d: StromData, o: Partial<PersonPageOptions> = {}): string => buildPersonPageBody(preparePersonPageData(d, opts(o)), opts(o));

describe('person houses', () => {
    it('finds the house of an address and the years a person had facts there', () => {
        const index = treeHouseIndex(houseTree());
        expect(houseOfAddress(index, 'Bělokamen', 'čp. 16')).toBe(HOUSE_ID);
        expect(houseOfAddress(index, 'Bělokamen', 'čp. 99')).toBeNull();
        expect(houseOfAddress(index, undefined, 'čp. 16')).toBeNull();
        expect(personHouses(index, pid('hostivit'))).toEqual([{ id: HOUSE_ID, town: 'Bělokamen', text: 'čp. 16', from: 1850, to: 1912 }]);
        // Born in one house, died in the other: both, by the first year there.
        expect(personHouses(index, pid('radegunda')).map(h => h.id)).toEqual(['mlynkovice|3', HOUSE_ID]);
    });
});

describe('the person page — houses', () => {
    it('window: the address is a button to the house, the Places row lists the houses with the years', () => {
        const html = body(houseTree(), { personId: pid('radegunda') });
        expect(html).toContain(`data-pp-house="${HOUSE_ID}"`);
        expect(html).toMatch(/<button type="button" class="pp-link pp-house-link" data-pp-house="belokamen\|16" title="House čp. 16">čp. 16<\/button>/);
        expect(html).toContain('<span class="pp-houses-k">Houses</span>');
        expect(html).toMatch(/Mlýnkovice <button[^>]*data-pp-house="mlynkovice\|3"[^>]*>House čp. 3 ›<\/button> <span class="pp-house-y">1824<\/span>/);
        expect(html).toMatch(/data-pp-house="belokamen\|16"[^>]*>House čp. 16 ›<\/button> <span class="pp-house-y">1891<\/span>/);
    });

    it('a person without a house has no row', () => {
        const data = houseTree();
        const p = data.persons[pid('drahobud')]!;
        delete p.birthAddress;
        delete p.deathAddress;
        const html = body(data, { personId: pid('drahobud') });
        expect(html).not.toContain('pp-houses');
    });

    it('saved file outside a set: the address and the row stay text', () => {
        const html = body(houseTree(), { mode: 'file', links: 'plain' });
        expect(html).not.toContain('data-pp-house');
        expect(html).not.toContain('pp-house-link');
        expect(html).toContain('Bělokamen čp. 16');
        // Without a link no "›".
        expect(html).not.toContain('House čp. 16 ›');
    });

    it('a set: an anchor only to a house with a page in the set', () => {
        const set = (houseSlug: Map<string, string>): Partial<PersonPageOptions> => ({
            mode: 'file', links: { mode: 'set', personSlug: new Map(), houseSlug },
        });
        const withPage = body(houseTree(), set(new Map([[HOUSE_ID, 'dum-belokamen-cp-16']])));
        expect(withPage).toContain('href="#dum-belokamen-cp-16"');
        expect(withPage).toContain('House čp. 16 ›');
        const without = body(houseTree(), set(new Map()));
        expect(without).not.toContain('pp-house-link');
    });
});

describe('the Timeline — houses', () => {
    it('an event names its house only when asked for (the app), never on the poster', () => {
        const data = houseTree();
        const ids = ['hostivit', 'kunhuta'];
        const withHouses = computeTimelineModel(data, ids, 2026, { houses: true });
        const wedding = withHouses.rows.find(r => r.personId === 'hostivit')!.events.find(e => e.type === 'wedding')!;
        expect(wedding.house).toBe('čp. 16');
        const plain = computeTimelineModel(data, ids, 2026);
        expect(plain.rows.flatMap(r => r.events).some(e => e.house)).toBe(false);
    });
});
