import { describe, it, expect } from 'vitest';
import type { PersonId } from '../types.js';
import { defaultGiftSettings, giftMemoryKey, giftPersonKey, loadGiftMemory, parseGiftMemory, saveGiftMemory } from '../gift-memory.js';
import { defaultGiftOthersSensitive, defaultGiftPrivacy, type GiftLetter, type GiftMemory } from '../gift-tree.js';

const P = (s: string) => s as PersonId;

function memStorage() {
    const map = new Map<string, string>();
    return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
}

const LETTER: GiftLetter = { lang: 'cs', motif: 'xmas', salutation: 'Danieli', message: 'Milý [oslovení], …', signature: 'Eva', date: '2026-12-24' };

describe('gift memory', () => {
    it('defaults: depth 2, default protection, every part, photos, the given letter', () => {
        const s = defaultGiftSettings([P('a')], LETTER);
        expect(s.cut).toEqual({ recipients: ['a'], depth: 2, branches: {} });
        expect(s.privacy).toEqual(defaultGiftPrivacy());
        expect(s.privacy.others).toBe('initials');
        expect(s.privacy.sensitive).toEqual({ birthDates: true, addresses: true, contacts: false, photos: true, notes: false, religion: true, sources: true });
        expect(s.privacy.dead).toEqual({ causes: true, notes: true, sources: true });
        expect(s.parts).toEqual({ app: true, pages: true, book: true, fan: true, gedcom: true });
        expect(s.photos).toBe(true);
        expect(s.letter).toEqual(LETTER);
        expect(s.letter).not.toBe(LETTER);
    });

    it('a couple\'s key does not depend on the order', () => {
        expect(giftPersonKey([P('p2'), P('p1')])).toBe(giftPersonKey([P('p1'), P('p2')]));
        expect(giftPersonKey([P('p1')])).toBe('p1');
        expect(giftMemoryKey('t1')).toBe('strom.gift.t1');
    });

    it('save and load per person and couple in one tree entry', () => {
        const st = memStorage();
        const a: GiftMemory = { lastAt: '2026-12-24T10:00:00Z', settings: defaultGiftSettings([P('a')], LETTER), cutSize: 84 };
        a.settings.cut.depth = 'all';
        a.settings.cut.branches = { [P('x')]: false };
        a.settings.privacy.fullIds = [P('y')];
        a.settings.parts.gedcom = false;
        a.settings.fileName = 'Rodokmen – Daniel';
        const couple: GiftMemory = { lastAt: '2026-12-20T10:00:00Z', settings: defaultGiftSettings([P('c'), P('b')], LETTER), cutSize: 12 };
        saveGiftMemory('t1', giftPersonKey([P('a')]), a, st);
        saveGiftMemory('t1', giftPersonKey([P('c'), P('b')]), couple, st);
        expect([...st.map.keys()]).toEqual(['strom.gift.t1']);
        expect(loadGiftMemory('t1', 'a', st)).toEqual(a);
        const back = loadGiftMemory('t1', giftPersonKey([P('b'), P('c')]), st)!;
        expect(back.cutSize).toBe(12);
        expect(back.settings.cut.recipients).toEqual(['b', 'c']);
        expect(loadGiftMemory('t2', 'a', st)).toBeNull();
        expect(loadGiftMemory('t1', 'zz', st)).toBeNull();
    });

    it('a damaged entry falls back field by field; garbage is nothing', () => {
        const st = memStorage();
        st.setItem('strom.gift.t1', JSON.stringify({
            a: { lastAt: '2026-01-01', cutSize: 'x', settings: { cut: { depth: 7, branches: { q: 'yes', r: true } }, privacy: { others: 'nope', sensitive: { contacts: true } }, parts: { app: false }, letter: { lang: 'xx' } } },
            b: 42,
        }));
        const a = loadGiftMemory('t1', 'a', st)!;
        expect(a.cutSize).toBe(0);
        expect(a.settings.cut).toEqual({ recipients: ['a'], depth: 2, branches: { r: true } });
        expect(a.settings.privacy.others).toBe('initials');
        expect(a.settings.privacy.sensitive.contacts).toBe(true);
        expect(a.settings.privacy.sensitive.birthDates).toBe(true);
        expect(a.settings.parts).toEqual({ app: false, pages: true, book: true, fan: true, gedcom: true });
        expect(a.settings.letter.lang).toBe('en');
        expect(loadGiftMemory('t1', 'b', st)).toBeNull();
        st.setItem('strom.gift.t1', '{not json');
        expect(loadGiftMemory('t1', 'a', st)).toBeNull();
        expect(parseGiftMemory(null, [])).toBeNull();
    });

    it('K6.5: an entry with one set keeps it for those shown in full; the other living take the defaults', () => {
        const st = memStorage();
        const oldSet = { birthDates: false, addresses: false, contacts: true, photos: true, notes: true, religion: false, sources: false };
        st.setItem('strom.gift.t1', JSON.stringify({
            a: { lastAt: '2026-11-01', cutSize: 12, settings: { privacy: { others: 'full', fullIds: ['x'], sensitive: oldSet, dead: { causes: false } } } },
        }));
        const p = loadGiftMemory('t1', 'a', st)!.settings.privacy;
        expect(p.others).toBe('full');
        expect(p.fullIds).toEqual(['x']);
        expect(p.sensitive).toEqual(oldSet);
        expect(p.othersSensitive).toEqual(defaultGiftOthersSensitive());
        expect(p.othersSensitive).toEqual({ birthDates: true, photos: true, addresses: false, contacts: false, notes: false, religion: false, sources: false });
        expect(p.dead).toEqual({ causes: false, notes: true, sources: true });
    });

    it('K6.5: both sets saved and loaded again', () => {
        const st = memStorage();
        const privacy = defaultGiftPrivacy();
        privacy.others = 'full';
        privacy.othersSensitive = { ...privacy.othersSensitive, sources: true, photos: false };
        const memory: GiftMemory = {
            lastAt: '2026-11-26T10:00:00.000Z', cutSize: 5,
            settings: { ...defaultGiftSettings([P('a')], LETTER), privacy },
        };
        saveGiftMemory('t1', 'a', memory, st);
        const back = loadGiftMemory('t1', 'a', st)!.settings.privacy;
        expect(back.othersSensitive).toEqual(privacy.othersSensitive);
        expect(back.sensitive).toEqual(defaultGiftPrivacy().sensitive);
    });

    it('storage errors are swallowed', () => {
        const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
        expect(loadGiftMemory('t1', 'a', broken)).toBeNull();
        expect(() => saveGiftMemory('t1', 'a', { lastAt: 'x', settings: defaultGiftSettings([P('a')], LETTER), cutSize: 1 }, broken)).not.toThrow();
        expect(loadGiftMemory('t1', 'a', null)).toBeNull();
    });
});
