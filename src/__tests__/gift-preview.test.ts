import { describe, it, expect } from 'vitest';
import { getDemoTree } from '../demo-tree.js';
import type { Gender, Person, PersonId, StromData } from '../types.js';
import { giftBranchCandidates, giftCutIds, type GiftCut, type GiftDepth } from '../gift-tree.js';
import {
    GIFT_PREVIEW_CARD, giftBranchAdds, giftBranchHasStub, giftPreviewModel,
    type GiftPreviewModel, type GiftPreviewStub,
} from '../gift-preview-model.js';
import { strings } from '../strings.js';

const P = (key: string) => `demo_${key}` as PersonId;

function addPerson(data: StromData, key: string, firstName: string, lastName: string, gender: Gender, opts: Partial<Person> = {}): PersonId {
    const id = P(key);
    data.persons[id] = { id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...opts };
    return id;
}

/** The demo tree with a daughter for Eva and Jonas (a first cousin of Daniel): Eva's family has someone to add. */
function tree(): StromData {
    const d = getDemoTree();
    const liv = addPerson(d, 'liv', 'Liv', 'Holm', 'female', { birthDate: '1990-03-02' });
    for (const p of [P('eva'), P('jonas')]) { d.persons[p].childIds.push(liv); d.persons[liv].parentIds.push(p); }
    d.partnerships[d.persons[P('eva')].partnerships[0]].childIds.push(liv);
    return d;
}

const label = (s: GiftPreviewStub): string =>
    s.kind === 'family' ? `+${s.count}` : s.kind === 'generations' ? `gen ${s.generations} (${s.count})` : `side ${s.surname} (${s.count})`;

function model(data: StromData, cut: GiftCut, extra: { collapseFrom?: number; expanded?: Set<string> } = {}): { m: GiftPreviewModel; ids: Set<PersonId> } {
    const ids = giftCutIds(data, cut);
    const m = giftPreviewModel({
        data, ids, recipients: cut.recipients, branches: giftBranchCandidates(data, cut), stubLabel: label, ...extra,
    });
    return { m, ids };
}

const cutOf = (depth: GiftDepth, branches: Record<string, boolean> = {}, recipients = [P('daniel')]): GiftCut =>
    ({ recipients, depth, branches: branches as Record<PersonId, boolean> });

/** Card and stub boxes that overlap (none expected). */
function overlaps(m: GiftPreviewModel): string[] {
    const boxes = [
        ...m.cards.map(c => ({ n: c.id as string, x: c.x, y: c.y, w: GIFT_PREVIEW_CARD.w, h: GIFT_PREVIEW_CARD.h })),
        ...m.stubs.map(s => ({ n: s.stub.key, x: s.x, y: s.y, w: s.w, h: s.h })),
    ];
    const out: string[] = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.push(`${a.n} × ${b.n}`);
    }
    return out;
}

describe('gift preview model (spec 093 §3)', () => {
    it('draws every person of the cut once, the recipient marked, nothing overlapping', () => {
        const data = tree();
        for (const depth of [0, 1, 2, 'all'] as GiftDepth[]) {
            const { m, ids } = model(data, cutOf(depth));
            const drawn = m.cards.map(c => c.id);
            expect(new Set(drawn).size).toBe(drawn.length);
            expect(new Set(drawn)).toEqual(ids);
            expect(m.cards.filter(c => c.recipient).map(c => c.id)).toEqual([P('daniel')]);
            expect(overlaps(m)).toEqual([]);
            expect(m.folded).toBe(false);
        }
    });

    it('puts parents in the row above their children, each child reached by a line from above', () => {
        const data = tree();
        const { m } = model(data, cutOf('all'));
        const at = new Map(m.cards.map(c => [c.id, c]));
        const daniel = at.get(P('daniel'))!, martin = at.get(P('martin'))!;
        expect(martin.y).toBeLessThan(daniel.y);
        // A vertical drop ends at the top of Daniel's card, at its middle.
        const cx = daniel.x + GIFT_PREVIEW_CARD.w / 2;
        expect(m.lines.some(([x1, , x2, y2]) => x1 === cx && x2 === cx && y2 === daniel.y)).toBe(true);
    });

    it('shows a "+ family (n)" stub for a sibling of an ancestor whose family is out, n = the people it adds', () => {
        const data = tree();
        const cut = cutOf(2, { [P('eva')]: false });
        const eva = giftBranchCandidates(data, cut).find(b => b.siblingId === P('eva'))!;
        expect(eva.included).toBe(false);
        expect(giftBranchHasStub(eva)).toBe(true);
        const { m, ids } = model(data, cut);
        const stub = m.stubs.find(s => s.stub.kind === 'family' && s.stub.personId === P('eva'))!;
        expect(stub.stub.count).toBe(giftBranchAdds(eva));
        expect(stub.label).toBe(`+${giftBranchAdds(eva)}`);
        expect(ids.has(P('liv'))).toBe(false);
        // Under Eva's card, not drawn over anyone.
        const card = m.cards.find(c => c.id === P('eva'))!;
        expect(stub.y).toBeGreaterThan(card.y);
        expect(overlaps(m)).toEqual([]);
        // With the family in, no stub and Liv is drawn.
        const back = model(data, cutOf(2)).m;
        expect(back.stubs.some(s => s.stub.kind === 'family' && s.stub.personId === P('eva'))).toBe(false);
        expect(back.cards.some(c => c.id === P('liv'))).toBe(true);
    });

    it('folds the far ancestors into stubs above the limit; the counts add up; a click unfolds', () => {
        const data = tree();
        const cut = cutOf('all');
        const { m, ids } = model(data, cut, { collapseFrom: 8 });
        expect(m.folded).toBe(true);
        const folded = m.stubs.filter(s => s.stub.kind !== 'family');
        expect(folded.length).toBeGreaterThan(0);
        // Everyone is either a card or counted in exactly one stub.
        const hidden = folded.reduce((n, s) => n + s.stub.count, 0);
        expect(m.cards.length + hidden).toBe(ids.size);
        expect(m.cards.length).toBeLessThan(ids.size);
        // The main line keeps three ancestor generations: Daniel, Martin, Thomas, David are drawn.
        for (const k of ['daniel', 'martin', 'thomas', 'david']) expect(m.cards.some(c => c.id === P(k))).toBe(true);
        const main = folded.find(s => s.stub.kind === 'generations')!;
        expect(main.label).toMatch(/^gen \d+ \(\d+\)$/);
        expect(overlaps(m)).toEqual([]);
        // Unfolding every stub draws everyone.
        let expanded = new Set<string>();
        let cur = m;
        for (let i = 0; i < 10 && cur.stubs.some(s => s.stub.kind !== 'family'); i++) {
            expanded = new Set([...expanded, ...cur.stubs.filter(s => s.stub.kind !== 'family').map(s => s.stub.key)]);
            cur = model(data, cut, { collapseFrom: 8, expanded }).m;
        }
        expect(cur.cards.length).toBe(ids.size);
        expect(overlaps(cur)).toEqual([]);
    });

    it('does not fold under the limit (60 people)', () => {
        const { m } = model(tree(), cutOf('all'));
        expect(m.stubs.filter(s => s.stub.kind !== 'family')).toEqual([]);
    });

    it('draws a couple of recipients side by side with their children under them', () => {
        const data = tree();
        const cut = cutOf(2, {}, [P('daniel'), P('julia')]);
        const { m, ids } = model(data, cut);
        expect(new Set(m.cards.map(c => c.id))).toEqual(ids);
        const d = m.cards.find(c => c.id === P('daniel'))!, j = m.cards.find(c => c.id === P('julia'))!;
        expect(d.y).toBe(j.y);
        expect(Math.abs(d.x - j.x)).toBeLessThan(GIFT_PREVIEW_CARD.w * 2);
        expect(m.cards.filter(c => c.recipient)).toHaveLength(2);
        expect(overlaps(m)).toEqual([]);
    });

    it('stub texts in the four languages', () => {
        const T = strings.giftTree.cut;
        expect(T.stubFamily(3)).toMatch(/^\+ \S+ \(3\)$/);
        expect(T.stubGenerations(2, 8)).toContain('(8)');
        expect(T.stubGenerations(2, 8).startsWith('▲')).toBe(true);
        expect(T.stubSide('Lind', 12)).toContain('Lind');
        expect(T.stubSide('', 12)).toContain('(12)');
    });
});
