/**
 * A crowded map of places (1102): a cluster's pill shows how many places it
 * holds, their numbers are in its tooltip and accessible name; a single place
 * keeps its number; pills never cover another pill or a point, and labels
 * never cover a pill or a point. Fictional data: the family pages' sample tree
 * with Josef Fíšek moving through made-up hamlets.
 */

import { describe, it, expect } from 'vitest';
import {
    collectRodPlacePoints, planPlacesMap, placesMapHtml, rodPlacePointSize, settleClusters, chainClusters,
    clusterHalfWidth, clusterLabel, labelWidthPx, labelYears, pointRect, labelRect, PX_TO_UNIT, type MapPlan, type Rect,
} from '../person-page-map.js';
import { getStringsForLang } from '../strings.js';
import { PERSON_PAGE_MAP_CSS } from '../person-page-viz-css.js';
import type { PersonId, PlaceGeo } from '../types.js';
import { crowdedMapFixture, CROWDED_HAMLETS, NEAR_GROUP_A, NEAR_GROUP_B } from './helpers/crowded-map-fixture.js';

function crowded() {
    const { data } = crowdedMapFixture();
    const points = collectRodPlacePoints(data, Object.keys(data.persons) as PersonId[]);
    const geo: Record<string, PlaceGeo> = {};
    for (const p of points) { const g = data.places?.[p.placeKey]; if (g) geo[p.placeKey] = g; }
    const size = (key: string) => rodPlacePointSize(points.find(p => p.placeKey === key)?.personIds.length ?? 1);
    return { points, geo, size };
}

const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Per box the pills, the lone points and the labels as the plan places them (view units). */
function boxes(plan: MapPlan, mode: 'd' | 'p', size: (key: string) => number) {
    const u = PX_TO_UNIT[mode];
    const S = getStringsForLang('cs');
    const pills = plan.clusters![mode].map(c => ({ c, r: pointRect({ x: c.x, y: c.y, w: 0, hw: clusterHalfWidth(c) }, u) }));
    const lone = plan.places.filter(p => p.x !== undefined && p.cl?.[mode] === undefined);
    const points = lone.map(p => ({ p, r: pointRect({ x: p.x!, y: p.y!, w: 0, hw: size(p.placeKey) / 2, hh: size(p.placeKey) / 2 }, u) }));
    const labels: { name: string; r: Rect }[] = [];
    for (const { c } of pills) {
        if (c.side === 'hide') continue;
        const lab = clusterLabel(c, S);
        labels.push({ name: lab.name, r: labelRect({ x: c.x, y: c.y, w: labelWidthPx(lab.name, mode === 'd' ? lab.years : ''), hw: clusterHalfWidth(c) }, c.side, u) });
    }
    for (const p of lone) {
        const side = p.side![mode];
        if (side === 'hide') continue;
        const h = size(p.placeKey) / 2;
        labels.push({ name: p.name, r: labelRect({ x: p.x!, y: p.y!, w: labelWidthPx(p.name, labelYears(p.points)[mode]), hw: h, hh: h }, side, u) });
    }
    return { pills, points, labels };
}

describe('a crowded map of places (1102)', () => {
    it('a cluster\'s pill shows the count; the numbers are in its tooltip and accessible name; a single place keeps its number', () => {
        const { points, geo, size } = crowded();
        const plan = planPlacesMap(points, geo, { kidPlaces: false, lang: 'cs', pointPx: size });
        expect(plan.state).toBe('map');
        for (const mode of ['d', 'p'] as const) {
            const big = plan.clusters![mode].find(c => c.members.some(m => m.name === CROWDED_HAMLETS[0]))!;
            expect(big.members.length).toBeGreaterThanOrEqual(40);
            expect(big.text).toBe(`${big.members.length} míst`);
            expect(big.nums).toMatch(/^\d+–\d+/);
        }
        const html = placesMapHtml(points, geo, { lang: 'cs', mode: 'file', kidPlaces: false, group: { title: '', size, row: () => '' } });
        const pills = [...html.matchAll(/<button type="button" class="pp-map-pt pp-map-cl[^"]*"[^>]*>[^<]*<\/button>/g)].map(m => m[0]);
        expect(pills.length).toBeGreaterThanOrEqual(3);
        for (const b of pills) {
            const text = b.match(/>([^<]*)<\/button>/)![1];
            // The pill: "46 míst", never the list of numbers.
            expect(text).toMatch(/^\d+ míst[ao]?$/);
            expect(text).not.toMatch(/–|,/);
            const title = b.match(/title="([^"]*)"/)![1];
            expect(title).toMatch(/^Místa \d+(–\d+)?(, \d+(–\d+)?)*$/);
            expect(b).toContain(`aria-label="${title}: `);
        }
        expect(html).toMatch(/aria-label="Místa 5–50: [^"]*" title="Místa 5–50">46 míst<\/button>/);
        // The far village alone: its number on its point.
        expect(html).toMatch(/class="pp-map-pt sp-map-sz" style="[^"]*" data-pp-map-place="[^"]*" aria-label="56 Vranní Lhota">56<\/button>/);
    });

    it('two near clusters stay apart; no pill covers another pill or a point, no label covers a pill, a point or a label', () => {
        const { points, geo, size } = crowded();
        const plan = planPlacesMap(points, geo, { kidPlaces: false, lang: 'cs', pointPx: size });
        for (const mode of ['d', 'p'] as const) {
            const { pills, points: pts, labels } = boxes(plan, mode, size);
            const a = pills.find(x => x.c.members.some(m => m.name === NEAR_GROUP_A[0]))!;
            const b = pills.find(x => x.c.members.some(m => m.name === NEAR_GROUP_B[0]))!;
            expect(a.c, mode).not.toBe(b.c);
            expect(a.c.members.map(m => m.name).sort(), mode).toEqual([...NEAR_GROUP_A].sort());
            expect(b.c.members.map(m => m.name).sort(), mode).toEqual([...NEAR_GROUP_B].sort());
            expect(hit(a.r, b.r), mode).toBe(false);
            const marks = [...pills.map(x => x.r), ...pts.map(x => x.r)];
            for (let i = 0; i < pills.length; i++) {
                for (let j = 0; j < marks.length; j++) if (j !== i) expect(hit(pills[i].r, marks[j]), `${mode} pill ${pills[i].c.text} × ${j}`).toBe(false);
            }
            for (let i = 0; i < labels.length; i++) {
                for (const m of marks) expect(hit(labels[i].r, m), `${mode} label ${labels[i].name}`).toBe(false);
                for (let j = i + 1; j < labels.length; j++) expect(hit(labels[i].r, labels[j].r), `${mode} ${labels[i].name} × ${labels[j].name}`).toBe(false);
            }
        }
    });

    it('settleClusters: a pill takes in a point or a pill it would touch; lone points of 22 px 26 px apart stay; bigger ones that touch join', () => {
        const u = 1;
        const p = (x: number, y: number) => ({ x, y });
        // A pill of two at x 0 (half width 30) and a lone point 35 px off: it would touch the pill.
        const a = p(-5, 0), b = p(5, 0), c = p(35, 0), far = p(200, 0);
        expect(settleClusters([a, b, c, far], [[a, b]], () => 30, u)).toEqual([[a, b, c]]);
        // Two pills side by side whose boxes touch: one cluster, the points in their order.
        const d = p(50, 2), e = p(60, 2);
        expect(settleClusters([a, b, d, e], [[a, b], [d, e]], () => 30, u)).toEqual([[a, b, d, e]]);
        // One pill above the other, 30 px apart (22 px high + 2): apart.
        const f = p(-5, 30), g = p(5, 30);
        expect(settleClusters([a, b, f, g], [[a, b], [g, f]], () => 30, u)).toEqual([[a, b], [f, g]]);
        // Lone 22 px points 26 px apart never become a cluster; 40 px points 30 px apart do.
        const h = p(0, 0), i = p(18.4, 18.4);
        expect(settleClusters([h, i], [], () => 30, u)).toEqual([]);
        expect(settleClusters([h, i], [], () => 30, u, () => 20)).toEqual([[h, i]]);
        // Clusters as chained: nothing to settle.
        expect(settleClusters([h, far], chainClusters([h, far], 26), () => 11, u)).toEqual([]);
    });

    it('the count and the numbers in three languages; the pill centres its text and grows with it', () => {
        const want = { cs: ['2 místa', '5 míst', 'Místa 1–2, 4'], en: ['2 places', '5 places', 'Places 1–2, 4'], de: ['2 Orte', '5 Orte', 'Orte 1–2, 4'] };
        for (const lang of ['cs', 'en', 'de'] as const) {
            const M = getStringsForLang(lang).personPage.map;
            expect([M.clusterCount(2), M.clusterCount(5), M.clusterNums('1–2, 4')]).toEqual(want[lang]);
        }
        const rule = PERSON_PAGE_MAP_CSS.match(/\n\.pp-map-cl \{[^}]*\}/)![0];
        for (const decl of ['display: inline-flex', 'align-items: center', 'justify-content: center', 'box-sizing: border-box', 'height: auto', 'min-height: 22px']) {
            expect(rule).toContain(decl);
        }
        // A family line's bigger point moves the label above or below it off its edge.
        expect(PERSON_PAGE_MAP_CSS).toContain('.pp-map-lb { --hw: 11px; --hh: 11px;');
        expect(PERSON_PAGE_MAP_CSS).toContain('.lb-p-b { transform: translate(calc(-1 * var(--hw)), calc(var(--hh) + 2px)); }');
    });
});
