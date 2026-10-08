/**
 * Marriage-order pill (T13, N18/N19): one pill per union and per card, and
 * where it sits on the card (src/marriage-order.ts placeUnionOrderPill).
 *
 * The geometry harness lays out every person of the fixtures with partner
 * chains (and invented trees: a widow whose two husbands have hidden parents
 * and siblings, a man married three times to women married twice, a widow
 * who married a widower) as focus, in the standard and the expanded view, at
 * every card density, with the tab and pill words of cs, en and de, and checks
 * that no pill covers a hidden-relatives tab, leaves its card's width (into a
 * neighbouring card), covers the middle of the top edge or touches a line.
 * Invented data.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import {
    unionOrderBadges, placeUnionOrderPill, hiddenRelativesTabs, unionChildIdSet, viewLineSegments, segmentsNearCard,
    PillSegment, EDGE_INSET, EDGE_ROW_Y, ABOVE_ROW_Y, PILL_HEIGHT, CENTRE_CLEAR,
} from '../marriage-order.js';
import { measureUnionOrderPill, measureTabRows, rowKey } from '../union-order-measure.js';
import { StromLayoutEngine, computeLayout } from '../layout/index.js';
import { loadFixture } from '../layout/__tests__/helpers/loadFixture.js';
import { setLanguage, strings, Language } from '../strings.js';
import { StromData, Person, PersonId, PartnershipId, Partnership, DEFAULT_LAYOUT_CONFIG, LayoutConfig } from '../types.js';

const P = (id: string) => id as PersonId;

/** A tiny tree builder: persons and unions (with children), data order as written. */
function tree() {
    const persons: Record<string, Person> = {};
    const partnerships: Record<string, Partnership> = {};
    const person = (id: string, gender: 'male' | 'female', birthDate?: string) => {
        persons[id] = { id: P(id), firstName: id, lastName: 'Test', gender, isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], ...(birthDate ? { birthDate } : {}) };
    };
    const union = (id: string, a: string, b: string, startDate: string | undefined, kids: string[] = []) => {
        partnerships[id] = { id: id as PartnershipId, person1Id: P(a), person2Id: P(b), childIds: kids.map(P),
            status: 'married', ...(startDate ? { startDate } : {}) };
        persons[a].partnerships.push(id as PartnershipId);
        persons[b].partnerships.push(id as PartnershipId);
        for (const k of kids) {
            persons[k].parentIds.push(P(a), P(b));
            persons[a].childIds.push(P(k));
            persons[b].childIds.push(P(k));
        }
    };
    /** Parents and two siblings for a person (the tabs "parents" and "siblings" when they are out of view). */
    const kin = (id: string) => {
        const g = persons[id].gender;
        person(`${id}_f`, 'male'); person(`${id}_m`, 'female');
        person(`${id}_s1`, g === 'male' ? 'female' : 'male', '1801'); person(`${id}_s2`, 'male', '1803');
        union(`${id}_pu`, `${id}_f`, `${id}_m`, '1800', [id, `${id}_s1`, `${id}_s2`]);
    };
    const data = () => ({ persons, partnerships } as unknown as StromData);
    return { person, union, kin, data };
}

/** Barbora married twice; both husbands have parents and siblings in the data. */
function widow(): StromData {
    const t = tree();
    t.person('Barbora', 'female', '1825'); t.person('Ondrej', 'male', '1818'); t.person('Pavel', 'male', '1820');
    t.kin('Barbora'); t.kin('Ondrej'); t.kin('Pavel');
    t.person('c1', 'male', '1846'); t.person('c2', 'female', '1852');
    t.union('w2', 'Pavel', 'Barbora', '1850', ['c2']);
    t.union('w1', 'Ondrej', 'Barbora', '1845', ['c1']);
    return t.data();
}

/** Jiri married Anna, Berta and Cecilie; each of them married once more. */
function chain(): StromData {
    const t = tree();
    t.person('Jiri', 'male', '1850');
    t.kin('Jiri');
    const wives = [['Anna', 'Daniel', '1874', '1879'], ['Berta', 'Emil', '1876', '1884'], ['Cecilie', 'Frantisek', '1878', '1882']];
    for (const [w, h, d1, d2] of wives) {
        t.person(w, 'female', '1852'); t.person(h, 'male', '1848');
        t.kin(w);
        t.person(`${w}_k1`, 'male', String(+d1 + 1)); t.person(`${w}_k2`, 'female', String(+d2 + 1));
        t.union(`u_${w}_J`, 'Jiri', w, d2, [`${w}_k2`]);
        t.union(`u_${w}_${h}`, h, w, d1, [`${w}_k1`]);
    }
    return t.data();
}

/** Ludmila married Tomas, then the widower Karel, who married Rozalie after her. */
function widowWidower(): StromData {
    const t = tree();
    t.person('Ludmila', 'female', '1860'); t.person('Tomas', 'male', '1855');
    t.person('Karel', 'male', '1852'); t.person('Rozalie', 'female', '1865');
    t.kin('Ludmila'); t.kin('Karel');
    t.person('k1', 'male', '1881'); t.person('k2', 'female', '1886'); t.person('k3', 'male', '1895');
    t.union('l1', 'Tomas', 'Ludmila', '1880', ['k1']);
    t.union('lk', 'Karel', 'Ludmila', '1885', ['k2']);
    t.union('kr', 'Karel', 'Rozalie', '1894', ['k3']);
    return t.data();
}

const DENSITIES: Array<{ name: string; config: Pick<LayoutConfig, 'cardWidth' | 'cardHeight'> }> = [
    { name: 'compact', config: { cardWidth: 150, cardHeight: 44 } },
    { name: 'normal', config: { cardWidth: 188, cardHeight: 64 } },
    { name: 'detailed', config: { cardWidth: 200, cardHeight: 100 } },
    { name: 'custom-200', config: { cardWidth: 200, cardHeight: 107 } },
    { name: 'custom-320', config: { cardWidth: 320, cardHeight: 107 } },
];

function layOut(data: StromData, focus: PersonId, config: LayoutConfig, expanded: boolean, descendants = false) {
    return computeLayout(new StromLayoutEngine(), {
        data, focusPersonId: focus, config,
        policy: { ancestorDepth: descendants ? 0 : 2, descendantDepth: 2, includeAuntsUncles: !descendants, includeCousins: !descendants },
        displayPolicy: { mode: expanded ? 'expanded' : 'standard', autoExpand: expanded, expandLineageOnly: false },
    });
}

const overlaps = (a: [number, number, number, number], b: [number, number, number, number]) =>
    a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** An axis-parallel segment through the inside of a rectangle [x0, y0, x1, y1]. */
const crosses = (s: PillSegment, r: [number, number, number, number]) =>
    Math.max(s.x1, s.x2) > r[0] && Math.min(s.x1, s.x2) < r[2] && Math.max(s.y1, s.y2) > r[1] && Math.min(s.y1, s.y2) < r[3];

const stats = { views: 0, pills: 0, above: 0, edge: 0, besideTabs: 0 };

afterAll(() => setLanguage('en'));

describe('one pill per union and per card (N19)', () => {
    it('a widow who married a widower: the union gets one pill, counted for the focus', () => {
        const data = widowWidower();
        const r = layOut(data, P('Ludmila'), { ...DEFAULT_LAYOUT_CONFIG }, true);
        const badges = unionOrderBadges(data, r, data, P('Ludmila'));
        const lk = [...badges.values()].filter(b => b.partnershipId === 'lk');
        expect(lk).toHaveLength(1);
        // Ludmila's 2nd marriage, on Karel's card.
        expect(lk[0]).toMatchObject({ personId: 'Karel', towardId: 'Ludmila', number: 2 });
        // Karel's union with Rozalie is counted for Karel (Rozalie has one union).
        expect(badges.get(P('Rozalie'))).toMatchObject({ towardId: 'Karel', number: 2 });
        expect(badges.has(P('Ludmila'))).toBe(false);
        // Focus on Karel: the same union now counts his marriages, on her card.
        const rk = layOut(data, P('Karel'), { ...DEFAULT_LAYOUT_CONFIG }, true);
        const bk = unionOrderBadges(data, rk, data, P('Karel'));
        expect([...bk.values()].filter(b => b.partnershipId === 'lk')).toEqual([
            expect.objectContaining({ personId: 'Ludmila', towardId: 'Karel', number: 1 })]);
    });

    it('without the focus in the union, the one with more unions in view counts, else the union\'s first person', () => {
        const data = chain();
        const r = layOut(data, P('Jiri'), { ...DEFAULT_LAYOUT_CONFIG }, true);
        // Focus on a child: Jiri has three unions in view, each wife two.
        const badges = unionOrderBadges(data, r, data, P('Anna_k2'));
        for (const w of ['Anna', 'Berta', 'Cecilie']) {
            if (!r.positions.has(P(w))) continue;
            expect(badges.get(P(w))).toMatchObject({ towardId: 'Jiri', partnershipId: `u_${w}_J` });
        }
        expect(badges.has(P('Jiri'))).toBe(false);
        // A tie (two unions each) and no focus in it: the union's first person.
        const positions = new Map([['A', 0], ['B', 200], ['C', 400], ['D', 600]].map(([id, x]) => [P(id as string), { x: x as number, y: 0 }]));
        const t = tree();
        t.person('A', 'female'); t.person('B', 'male'); t.person('C', 'female'); t.person('D', 'male');
        t.union('ab', 'A', 'B', '1880'); t.union('bc', 'B', 'C', '1890'); t.union('cd', 'C', 'D', '1900');
        const lines = (['ab', 'bc', 'cd'] as const).map(id => {
            const u = t.data().partnerships[id as PartnershipId];
            return { person1Id: u.person1Id, person2Id: u.person2Id, partnershipId: id as PartnershipId };
        });
        const tie = unionOrderBadges(t.data(), { positions, spouseLines: lines });
        const bc = [...tie.values()].filter(b => b.partnershipId === 'bc');
        expect(bc).toHaveLength(1);
        expect(bc[0]).toMatchObject({ towardId: 'B', personId: 'C', number: 2 });
    });

    it('a card asked for two pills keeps one; the other union counts the card\'s own marriages on the partner\'s card', () => {
        // P has two unions (A, B); A and B have three each: both unions would
        // count A's / B's marriages on P's card.
        const t = tree();
        for (const id of ['P', 'A1', 'A2', 'B1', 'B2']) t.person(id, 'female');
        t.person('A', 'male'); t.person('B', 'male');
        t.union('pa', 'A', 'P', '1880'); t.union('pb', 'B', 'P', '1890');
        t.union('a1', 'A', 'A1', '1870'); t.union('a2', 'A', 'A2', '1875');
        t.union('b1', 'B', 'B1', '1871'); t.union('b2', 'B', 'B2', '1876');
        const data = t.data();
        const order = ['A1', 'A2', 'A', 'P', 'B', 'B1', 'B2'];
        const positions = new Map(order.map((id, i) => [P(id), { x: i * 220, y: 0 }]));
        const spouseLines = Object.values(data.partnerships).map(u => ({ person1Id: u.person1Id, person2Id: u.person2Id, partnershipId: u.id }));
        const badges = unionOrderBadges(data, { positions, spouseLines });
        const unions = [...badges.values()].map(b => b.partnershipId);
        expect(new Set(unions).size).toBe(unions.length);
        expect(badges.get(P('P'))).toMatchObject({ partnershipId: 'pa', towardId: 'A', number: 3 });
        expect(badges.get(P('B'))).toMatchObject({ partnershipId: 'pb', towardId: 'P', number: 2 });
        expect(unions.sort()).toEqual(['a1', 'a2', 'b1', 'b2', 'pa', 'pb']);
    });
});

describe('where the pill sits (N18)', () => {
    const base = { leftTabs: 0, leftInset: 13, rightInset: 13 };

    it('beside the tabs on the edge when it fits in its half, the corner when there are none', () => {
        expect(placeUnionOrderPill({ ...base, cardWidth: 188, side: 'left', pillWidth: 58, rightTabs: 50 }))
            .toEqual({ x: 13, y: EDGE_ROW_Y, row: 'edge', clear: true });
        const right = placeUnionOrderPill({ ...base, cardWidth: 320, side: 'right', pillWidth: 58, rightTabs: 50 });
        expect(right).toEqual({ x: 320 - 13 - 50 - 4 - 58, y: EDGE_ROW_Y, row: 'edge', clear: true });
    });

    it('above the tabs, in its half and within the card, when the tabs leave no room (the widow on a normal card)', () => {
        // "◂ parents" + "◆ siblings" take 135px of the right corner of 188.
        const p = placeUnionOrderPill({ ...base, cardWidth: 188, side: 'right', pillWidth: 58, rightTabs: 135 });
        expect(p.row).toBe('above');
        expect(p.y).toBe(ABOVE_ROW_Y);
        expect(p.y + PILL_HEIGHT).toBeLessThan(EDGE_ROW_Y);
        expect(p.x).toBeGreaterThanOrEqual(94 + CENTRE_CLEAR);
        expect(p.x + 58).toBeLessThanOrEqual(188);
        // The left pill when the right tabs reach past the middle.
        const l = placeUnionOrderPill({ ...base, cardWidth: 188, side: 'left', pillWidth: 58, rightTabs: 135 });
        expect(l).toMatchObject({ x: 13, row: 'above' });
    });

    it('on the compact card a pill wider than its half moves above, toward the corner, off the middle', () => {
        const p = placeUnionOrderPill({ ...base, cardWidth: 150, side: 'left', pillWidth: 64, rightTabs: 0 });
        expect(p.row).toBe('above');
        expect(p.x + 64).toBeLessThanOrEqual(75 - CENTRE_CLEAR);
        expect(p.x).toBeGreaterThanOrEqual(0);
    });

    it('steps aside from a line in the way', () => {
        // A bus 2 lanes low runs over the card's top at y −24.
        const segments = [{ x1: -50, y1: -24, x2: 20, y2: -24 }];
        const p = placeUnionOrderPill({ ...base, cardWidth: 188, side: 'left', pillWidth: 58, rightTabs: 135, segments });
        expect(p.row).toBe('above');
        expect(p.clear).toBe(true);
        expect(p.x).toBeGreaterThan(20);
        expect(p.x + 58).toBeLessThanOrEqual(94 - CENTRE_CLEAR);
    });
});

// ---------------------------------------------------------------------------
// The geometry harness
// ---------------------------------------------------------------------------

const FIXTURES = [
    'comprehensive', 'devel-demo', 'edge-marriage-cascade', 'edge-remarriage-web', 'edge-unknown-chains',
    'etalon-ancestor-chain', 'etalon-merged-chain', 'etalon-multi-partners', 't2_build_model_unions', 'real-large',
].filter(f => existsSync(join(process.cwd(), 'test', `${f}.json`)));

const TREES: Array<[string, () => StromData]> = [
    ['widow', widow], ['chain', chain], ['widow-widower', widowWidower],
    ...FIXTURES.map(f => [f, () => loadFixture(f)] as [string, () => StromData]),
];
const LANGS: Language[] = ['cs', 'en', 'de'];

describe('geometry harness: pills against tabs, cards and lines', () => {
    for (const [treeName, make] of TREES) {
        it(`${treeName}: every focus × standard/expanded/descendants × every density × cs/en/de`, () => {
            const data = make();
            const unionKids = unionChildIdSet(data);
            const ids = Object.keys(data.persons).map(P).filter(id => !data.persons[id].isPlaceholder);
            const failures: string[] = [];
            for (const density of DENSITIES) {
                const config: LayoutConfig = { ...DEFAULT_LAYOUT_CONFIG, ...density.config };
                const W = config.cardWidth, H = config.cardHeight;
                for (const view of ['standard', 'expanded', 'descendants'] as const) {
                    for (const focus of ids) {
                        const r = layOut(data, focus, config, view !== 'standard', view === 'descendants');
                        const badges = unionOrderBadges(data, r, data, focus);
                        stats.views++;
                        if (badges.size === 0) continue;
                        const unions = [...badges.values()].map(b => b.partnershipId);
                        if (new Set(unions).size !== unions.length) failures.push(`${density.name}/${view}/${focus}: a union with two pills`);
                        const segments = viewLineSegments(r);
                        for (const lang of LANGS) {
                            setLanguage(lang);
                            for (const [id, b] of badges) {
                                const pos = r.positions.get(id)!;
                                const tabs = view === 'descendants' ? [] : hiddenRelativesTabs(data, id, x => r.positions.has(x), unionKids);
                                const tabsW = measureTabRows([tabs]).get(rowKey(tabs))!;
                                const pillW = measureUnionOrderPill(strings.focus.unionOrdinal(b.number), b.year).width;
                                const border = id === focus ? 2 : 1;
                                const inset = border + EDGE_INSET;
                                const slot = placeUnionOrderPill({
                                    cardWidth: W, side: b.side, pillWidth: pillW, leftTabs: 0, rightTabs: tabsW,
                                    leftInset: inset, rightInset: inset, segments: segmentsNearCard(segments, pos.x, pos.y, W),
                                });
                                stats.pills++;
                                if (slot.row === 'above') stats.above++; else stats.edge++;
                                if (slot.row === 'edge' && tabsW > 0 && b.side === 'right') stats.besideTabs++;
                                const tag = `${density.name}/${view}/${lang} focus ${focus}: pill of ${id} (${b.side}, ${pillW.toFixed(1)}px, tabs ${tabsW.toFixed(1)})`;
                                const rect: [number, number, number, number] = [pos.x + slot.x, pos.y + slot.y, pos.x + slot.x + pillW, pos.y + slot.y + PILL_HEIGHT];
                                if (!slot.clear) failures.push(`${tag}: no place clear of the lines`);
                                // Within its card's width.
                                if (rect[0] < pos.x - 0.01 || rect[2] > pos.x + W + 0.01) failures.push(`${tag}: leaves the card's width`);
                                // Never over a tab.
                                if (tabsW > 0) {
                                    const tabRect: [number, number, number, number] = [pos.x + W - inset - tabsW, pos.y + EDGE_ROW_Y, pos.x + W - inset, pos.y + EDGE_ROW_Y + PILL_HEIGHT];
                                    if (overlaps(rect, tabRect)) failures.push(`${tag}: covers a tab`);
                                }
                                // The middle of the top edge stays free.
                                if (rect[0] < pos.x + W / 2 + 2 && rect[2] > pos.x + W / 2 - 2) failures.push(`${tag}: covers the middle of the top edge`);
                                // No other card.
                                for (const [oid, o] of r.positions) {
                                    if (oid === id) continue;
                                    if (overlaps(rect, [o.x, o.y, o.x + W, o.y + H])) failures.push(`${tag}: reaches the card of ${oid}`);
                                }
                                // No line.
                                for (const s of segments) if (crosses(s, rect)) failures.push(`${tag}: a line runs under it [${s.x1},${s.y1} → ${s.x2},${s.y2}]`);
                            }
                        }
                    }
                }
            }
            expect(failures.slice(0, 10)).toEqual([]);
        }, 300_000);
    }

    it('checked views with pills on the edge, beside the tabs and above them', () => {
        // eslint-disable-next-line no-console
        console.log(`marriage-order harness: ${stats.views} views, ${stats.pills} pill placements (${stats.edge} on the edge, ${stats.besideTabs} beside tabs, ${stats.above} above the tabs)`);
        expect(stats.views).toBeGreaterThan(1000);
        expect(stats.above).toBeGreaterThan(0);
        expect(stats.besideTabs).toBeGreaterThan(0);
    });
});
