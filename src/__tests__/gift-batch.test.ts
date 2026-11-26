import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDemoTree } from '../demo-tree.js';
import type { PersonId, StromData } from '../types.js';
import { defaultGiftSettings } from '../gift-memory.js';
import { giftDefaultLetter } from '../gift-guide.js';
import {
    giftBatchActive, giftBatchItems, giftBatchRows, giftBatchRowSettings, giftBatchSalutation, giftMergeOwn, giftOwnDiff, giftOwnParts,
    type GiftBatchPlan,
} from '../gift-batch.js';

const P = (key: string) => `demo_${key}` as PersonId;
const NOW = new Date('2026-12-10T10:00:00Z');

/** The demo tree (Berg family) and a fictional person alone in it. */
function tree(): StromData {
    const d = getDemoTree();
    const id = P('zora');
    d.persons[id] = { id, firstName: 'Zora', lastName: 'Varnholt', gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], birthDate: '1960' };
    return d;
}

describe('giving a family tree to each person of a list (spec 093 §7 [53, 54])', () => {
    let data: StromData;
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        data = tree();
    });
    afterEach(() => vi.useRealTimers());

    const common = () => defaultGiftSettings([P('daniel')], giftDefaultLetter(data, [P('daniel')], 'en', 'Eva', NOW));

    it('joins partners of the list into one row (the order of the list kept), on request only', () => {
        const ids = [P('emma'), P('daniel'), P('zora'), P('julia'), P('daniel')];
        const rows = giftBatchRows(data, ids, true);
        expect(rows.map(r => r.recipients)).toEqual([[P('emma')], [P('daniel'), P('julia')], [P('zora')]]);
        expect(rows[1].key).toBe([P('daniel'), P('julia')].sort().join('+'));
        expect(rows.map(r => r.lone)).toEqual([false, false, true]);

        const single = giftBatchRows(data, ids, false);
        expect(single.map(r => r.recipients)).toEqual([[P('emma')], [P('daniel')], [P('zora')], [P('julia')]]);
    });

    it('leaves out the removed rows and the people alone in the tree', () => {
        const rows = giftBatchRows(data, [P('emma'), P('daniel'), P('zora')], true);
        const removed = new Set([rows[0].key]);
        expect(giftBatchActive({ rows, removed }).map(r => r.recipients)).toEqual([[P('daniel')]]);
    });

    it('keeps only what one row changes and merges it over the common settings', () => {
        const c = common();
        const edited = giftMergeOwn(c, undefined, [P('emma')], 'Dear Emma');
        expect(giftOwnDiff(c, edited)).toBeNull();

        edited.cut = { ...edited.cut, depth: 'all' };
        edited.parts = { ...edited.parts, book: false };
        edited.letter = { ...edited.letter, motif: 'xmas', salutation: 'Grandma' };
        edited.fileName = 'mine.zip';
        const own = giftOwnDiff(c, edited)!;
        expect(own).toEqual({ cut: { depth: 'all' }, parts: { book: false }, letter: { motif: 'xmas' } });
        expect(giftOwnParts(own)).toEqual(['cut', 'parts', 'letter']);

        const merged = giftMergeOwn(c, own, [P('emma')], 'Grandma');
        expect(merged.cut.depth).toBe('all');
        expect(merged.cut.recipients).toEqual([P('emma')]);
        expect(merged.parts.book).toBe(false);
        expect(merged.parts.app).toBe(c.parts.app);
        expect(merged.letter.motif).toBe('xmas');
        expect(merged.letter.salutation).toBe('Grandma');
        expect(merged.fileName).toBeUndefined();
        // The common settings stay as they were.
        expect(c.cut.depth).not.toBe('all');
        expect(c.letter.motif).toBe('none');
    });

    it('K6.5: a row\'s own set of the other living is kept and merged; the common one carries both sets', () => {
        const c = common();
        expect(c.privacy.othersSensitive).toEqual({ birthDates: true, photos: true, addresses: false, contacts: false, notes: false, religion: false, sources: false });
        const edited = giftMergeOwn(c, undefined, [P('emma')], 'Dear Emma');
        edited.privacy = { ...edited.privacy, others: 'full', othersSensitive: { ...edited.privacy.othersSensitive, sources: true } };
        const own = giftOwnDiff(c, edited)!;
        expect(own).toEqual({ privacy: { others: 'full', othersSensitive: { ...c.privacy.othersSensitive, sources: true } } });
        expect(giftOwnParts(own)).toEqual(['privacy']);
        const merged = giftMergeOwn(c, own, [P('emma')], 'Dear Emma');
        expect(merged.privacy.othersSensitive.sources).toBe(true);
        expect(merged.privacy.sensitive).toEqual(c.privacy.sensitive);
        // The common one keeps its own sets.
        const otherCommon = { ...c, privacy: { ...c.privacy, othersSensitive: { ...c.privacy.othersSensitive, photos: false } } };
        expect(giftMergeOwn(otherCommon, undefined, [P('emma')], '').privacy.othersSensitive.photos).toBe(false);
        expect(c.privacy.othersSensitive.sources).toBe(false);
    });

    it('makes one item per package: its recipients, its salutation, its own settings', () => {
        const c = common();
        const rows = giftBatchRows(data, [P('emma'), P('daniel'), P('julia'), P('zora')], true);
        const plan: GiftBatchPlan = {
            rows, removed: new Set(),
            own: new Map([[rows[0].key, { parts: { book: false } }]]),
            salutations: new Map([[rows[1].key, 'Dear both']]),
        };
        const items = giftBatchItems(data, plan, c);
        expect(items.map(i => i.settings.cut.recipients)).toEqual([[P('emma')], [P('daniel'), P('julia')]]);
        expect(items[0].settings.parts.book).toBe(false);
        expect(items[1].settings.parts.book).toBe(c.parts.book);
        expect(items[1].settings.letter.salutation).toBe('Dear both');
        expect(items[0].settings.letter.salutation).toBe(giftBatchSalutation(data, plan, c, rows[0]));
        expect(items[0].settings.letter.salutation).toContain('Emma');
        // The letter is resolved: the template for each cut.
        expect(items[0].settings.letter.message.trim().length).toBeGreaterThan(0);
        expect(giftBatchRowSettings(data, plan, c, rows[1]).cut.recipients).toEqual([P('daniel'), P('julia')]);
    });
});
