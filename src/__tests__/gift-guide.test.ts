import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDemoTree } from '../demo-tree.js';
import type { PersonId, StromData } from '../types.js';
import { defaultGiftPrivacy } from '../gift-tree.js';
import { giftPersonKey, loadGiftMemory } from '../gift-memory.js';
import {
    GIFT_GUIDE_STEPS, giftCanProceed, giftFullSet, giftGoTo, giftGuideStart, giftHasFamily, giftLivingModel,
    giftRemember, giftSuggestedPartner, giftSummary, giftToggleFull, type GiftMode, type GiftState,
    giftCoverPreviewHtml, giftResolvedLetter, giftResolvedSettings,
} from '../gift-guide.js';

const P = (key: string) => `demo_${key}` as PersonId;
const NOW = new Date('2026-12-10T10:00:00Z');
const LATER = new Date('2026-12-20T15:00:00Z');
const TREE = 'tree_gift';

function memStorage() {
    const map = new Map<string, string>();
    return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
}

/** The demo tree (Berg family) and a fictional person alone in it. */
function tree(): StromData {
    const d = getDemoTree();
    const id = P('zora');
    d.persons[id] = { id, firstName: 'Zora', lastName: 'Varnholt', gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], birthDate: '1960' };
    return d;
}

describe('the gift guide (spec 093 §2, §4, §9)', () => {
    let data: StromData;
    let storage: ReturnType<typeof memStorage>;
    const start = (mode: GiftMode, recipients: Array<PersonId | null>, now = NOW): GiftState =>
        giftGuideStart({ data, treeId: TREE, mode, recipients, lang: 'en', signature: 'Eva', now, storage });

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        data = tree();
        storage = memStorage();
    });
    afterEach(() => { vi.useRealTimers(); });

    it('defaults: step 1, nothing done, nothing remembered, the default cut, protection and letter', () => {
        const g = start('single', [P('daniel')]);
        expect(g.step).toBe(1);
        expect([...g.done]).toEqual([]);
        expect(g.memory).toBeNull();
        expect(g.settings.cut).toEqual({ recipients: [P('daniel')], depth: 2, branches: {} });
        expect(g.settings.privacy).toEqual(defaultGiftPrivacy());
        expect(g.settings.parts).toEqual({ app: true, pages: true, book: true, fan: true, gedcom: true });
        expect(g.settings.photos).toBe(true);
        expect(g.settings.letter).toMatchObject({ lang: 'en', motif: 'none', message: '', signature: 'Eva', date: '2026-12-10' });
        expect(giftCanProceed(g, data)).toBe(true);
    });

    it('jumping between steps: forward marks the steps before as done, back keeps them, the ends hold', () => {
        const g = start('single', [P('daniel')]);
        giftGoTo(g, 4);
        expect(g.step).toBe(4);
        expect([...g.done].sort()).toEqual([1, 2, 3]);
        giftGoTo(g, 2);
        expect(g.step).toBe(2);
        expect([...g.done].sort()).toEqual([1, 2, 3]);
        // "Straight to preview": every step before the last accepted.
        giftGoTo(g, 99);
        expect(g.step).toBe(GIFT_GUIDE_STEPS);
        expect([...g.done].sort()).toEqual([1, 2, 3, 4, 5]);
        giftGoTo(g, 0);
        expect(g.step).toBe(1);
    });

    it('closing remembers the settings for the person (no package made, so no date for the menu)', () => {
        const g = start('single', [P('daniel')]);
        g.settings.privacy = { ...g.settings.privacy, others: 'anonymous' };
        const persons = giftSummary(data, g.settings, NOW).persons;
        const saved = giftRemember(g, persons, NOW, { storage });
        expect(saved).not.toBeNull();
        const memory = loadGiftMemory(TREE, giftPersonKey([P('daniel')]), storage);
        expect(memory?.lastAt).toBe(NOW.toISOString());
        expect(memory?.madeAt).toBeUndefined();
        expect(memory?.cutSize).toBe(persons);
        expect(memory?.settings.privacy.others).toBe('anonymous');
        // Someone else starts from the defaults.
        expect(start('single', [P('martin')]).memory).toBeNull();
    });

    it('a second opening starts from last time: every step done, the letter dated today', () => {
        const first = start('single', [P('daniel')]);
        first.settings.cut = { ...first.settings.cut, depth: 0 };
        first.settings.letter = { ...first.settings.letter, motif: 'xmas', message: 'Merry Christmas' };
        giftRemember(first, 30, NOW, { storage, made: true });
        const again = start('single', [P('daniel')], LATER);
        expect(again.memory?.madeAt).toBe(NOW.toISOString());
        expect(again.step).toBe(1);
        expect([...again.done].sort()).toEqual([1, 2, 3, 4, 5, 6]);
        expect(again.settings.cut.depth).toBe(0);
        expect(again.settings.letter).toMatchObject({ motif: 'xmas', message: 'Merry Christmas', date: '2026-12-20' });
        // Remembering again keeps the day the package was made.
        giftRemember(again, 30, LATER, { storage });
        expect(loadGiftMemory(TREE, giftPersonKey([P('daniel')]), storage)?.madeAt).toBe(NOW.toISOString());
    });

    it('a couple without the second person cannot go on and is not remembered', () => {
        expect(giftSuggestedPartner(data, P('daniel'))).toBe(P('julia'));
        const g = start('pair', [P('daniel'), null]);
        expect(giftCanProceed(g, data)).toBe(false);
        expect(giftRemember(g, 0, NOW, { storage })).toBeNull();
        expect(storage.map.size).toBe(0);
        expect(giftCanProceed(start('pair', [P('daniel'), P('daniel')]), data)).toBe(false);
        const pair = start('pair', [P('daniel'), P('julia')]);
        expect(giftCanProceed(pair, data)).toBe(true);
        expect(pair.settings.cut.recipients).toEqual([P('daniel'), P('julia')]);
        // The couple's settings are their own, whatever the order.
        giftRemember(pair, 30, NOW, { storage });
        expect(start('pair', [P('julia'), P('daniel')]).memory).not.toBeNull();
        expect(start('single', [P('daniel')]).memory).toBeNull();
    });

    it('a person alone in the tree: nothing to give', () => {
        expect(giftHasFamily(data, P('zora'))).toBe(false);
        expect(giftCanProceed(start('single', [P('zora')]), data)).toBe(false);
        expect(giftCanProceed(start('single', [null]), data)).toBe(false);
    });

    it('"in full": the household always, an exception added and taken back; under full the tick still picks the set (K6.5)', () => {
        const g = start('single', [P('daniel')]);
        const s = g.settings;
        const model = giftLivingModel(data, s, 'en', NOW.getFullYear(), p => `${p.firstName} ${p.lastName}`);
        const household = model.rows.filter(r => r.household).map(r => r.id);
        const other = model.rows.find(r => !r.household);
        expect(model.rows[0]).toMatchObject({ id: P('daniel'), recipient: true, household: true });
        expect(household).toContain(P('julia'));
        expect(other).toBeDefined();
        expect(giftFullSet(model, s)).toEqual(new Set(household));
        giftToggleFull(s, other!.id, true);
        expect(giftFullSet(model, s).has(other!.id)).toBe(true);
        expect(s.privacy.fullIds).toEqual([other!.id]);
        giftToggleFull(s, other!.id, false);
        expect(giftFullSet(model, s).has(other!.id)).toBe(false);
        // The household's box is locked: taking it off changes nothing.
        giftToggleFull(s, P('julia'), false);
        expect(giftFullSet(model, s).has(P('julia'))).toBe(true);
        // Under 'full' the others are named but keep the other living's set: only the household and the ticked are "in full".
        s.privacy = { ...s.privacy, others: 'full' };
        expect(giftFullSet(model, s)).toEqual(new Set(household));
        giftToggleFull(s, other!.id, true);
        expect(giftFullSet(model, s).has(other!.id)).toBe(true);
        expect(giftFullSet(model, s).size).toBe(household.length + 1);
    });

    it('resolves an empty message to the template and previews the cover page without making the package', () => {
        const g = start('single', [P('daniel')]);
        expect(g.settings.letter.message).toBe('');
        const letter = giftResolvedLetter(data, g.settings);
        expect(letter.message.length).toBeGreaterThan(20);
        // A message of its own stays as written.
        g.settings.letter = { ...g.settings.letter, message: 'Hello [name]' };
        expect(giftResolvedSettings(data, g.settings).letter.message).toBe('Hello [name]');
        g.settings.letter = { ...g.settings.letter, message: '' };
        const html = giftCoverPreviewHtml(data, g.settings, { treeName: 'Berg', now: NOW });
        expect(html).toContain('Daniel');
        expect(html).not.toContain('<script');
        // The template's first words are on the page (the letter resolved).
        const lastLine = letter.message.trim().split('\n').pop() ?? '';
        expect(html).toContain(lastLine.split(/\s+/).slice(0, 3).join(' '));
    });
});
