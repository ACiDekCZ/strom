/**
 * Linked in the view only, laid out: the drawn links enter the layout as a
 * derived copy of the data (src/layout/pipeline/view-layer.ts) — the tree's
 * data never change — and every person and line of the result says whether
 * it is a ghost (a shown family) or virtual (only in the view). Which links a
 * view draws (viewLinksToDraw): only Family and Descendants, the feature
 * available, the main switch on, records drawn and on. The fan, timeline,
 * statistics and counts read the tree's data and never see them; the outputs
 * lay out with includeView: false. Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { runLayoutPipeline, buildViewLayer } from '../layout/pipeline/index.js';
import type { PipelineInput, LayoutResult } from '../layout/pipeline/index.js';
import { ViewLink, ViewLinkChoice, viewLinksToDraw, VIEW_LINK_VIEWS, viewLinkIsland, viewLinkContext } from '../view-links.js';
import { maxGenerationsWithSiblings, maxGenerations } from '../focus-depth.js';
import { computeFamilyStats, computeCompleteness } from '../stats.js';
import { assignGenerations } from '../generations.js';
import { buildFanModel } from '../fan-chart.js';
import { computeTimelineModel } from '../timeline.js';
import { buildFamilyBook } from '../book.js';
import { normalizeSingleParents } from '../single-parent.js';
import { DEFAULT_LAYOUT_CONFIG, Person, PersonId, StromData } from '../types.js';
import { loadHypothesisLinksTree } from './helpers/hypothesis-links-fixture.js';

const { data: TREE, id } = loadHypothesisLinksTree();
const KAREL = id('P0001'), VACLAV = id('P0010'), ROZALIE = id('P0011'), ANTONIN = id('P0012'), LUDMILA = id('P0013');
const JAKUB = id('P0125'), MARIE = id('P0126'), JOSEF = id('P0127'), TOMAS = id('P0128'), ANNA = id('P0129');
const JAN = id('P0130'), MARTIN = id('P0140'), VOJTECH = id('P0150');

const B: ViewLinkChoice = { hypo: 'H0022', variant: 'B', kind: 'child', anchorId: VACLAV, islandIds: [JAKUB, MARIE] };
const C: ViewLinkChoice = { hypo: 'H0022', variant: 'C', kind: 'child', anchorId: VACLAV, islandIds: [JAN] };
const PARTNER: ViewLinkChoice = { hypo: 'H0024', variant: 'A', kind: 'partners', anchorId: ROZALIE, islandIds: [MARTIN] };
const CHAIN: ViewLinkChoice = { hypo: 'H0030', variant: 'A', kind: 'child', anchorId: TOMAS, islandIds: [VOJTECH] };
const ANTONIN_A: ViewLinkChoice = { hypo: 'H0028', variant: 'A', kind: 'child', anchorId: ANTONIN, islandIds: [JAKUB, MARIE] };

const link = (c: ViewLinkChoice, addedAt = 1, over: Partial<ViewLink> = {}): ViewLink => ({ ...c, on: true, addedAt, ...over });

function layout(data: StromData, focus: PersonId, extra: Partial<PipelineInput> = {}): LayoutResult {
    return runLayoutPipeline({
        data, focusPersonId: focus, config: DEFAULT_LAYOUT_CONFIG,
        ancestorDepth: 8, descendantDepth: 8,
        includeSpouseAncestors: true, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy: { mode: 'standard', autoExpand: true },
        ...extra,
    });
}

const spouseLine = (r: LayoutResult, a: PersonId, b: PersonId) =>
    r.spouseLines.find(s => (s.person1Id === a && s.person2Id === b) || (s.person1Id === b && s.person2Id === a));
const dropTo = (r: LayoutResult, child: PersonId) => {
    for (const c of r.connections) {
        const d = c.drops.find(x => x.personId === child);
        if (d) return { conn: c, drop: d };
    }
    return null;
};

/** Václav with a real mother whose family has a "?" father (the shape the app keeps). */
function withRealMother(sibling = false): { data: StromData; mother: PersonId; stand: PersonId; sib?: PersonId } {
    const d = structuredClone(TREE);
    const mother = 'real_mother' as PersonId;
    d.persons[mother] = { id: mother, firstName: 'Barbora', lastName: 'Horáková', gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [VACLAV] } as Person;
    d.persons[VACLAV].parentIds.push(mother);
    normalizeSingleParents(d);
    const family = Object.values(d.partnerships).find(u => u.childIds.includes(VACLAV))!;
    const stand = family.person1Id === mother ? family.person2Id : family.person1Id;
    if (!sibling) return { data: d, mother, stand };
    const sib = 'real_sibling' as PersonId;
    d.persons[sib] = { id: sib, firstName: 'Anežka', lastName: 'Horáková', gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [mother, stand], childIds: [], birthDate: '1820' } as Person;
    family.childIds.push(sib);
    d.persons[mother].childIds.push(sib);
    d.persons[stand].childIds.push(sib);
    return { data: d, mother, stand, sib };
}

describe('the derived data the layout sees', () => {
    it('nothing to apply: no layer', () => {
        expect(buildViewLayer(TREE, [])).toBeNull();
        expect(buildViewLayer(TREE, undefined)).toBeNull();
        expect(buildViewLayer(TREE, [link({ ...B, islandIds: ['gone' as PersonId] })])).toBeNull();
    });

    it('two shown parents: the anchor joins their family; the tree\'s data stay as they were', () => {
        const before = structuredClone(TREE);
        const layer = buildViewLayer(TREE, [link(B)])!;
        expect(TREE).toEqual(before);
        const v = layer.data.persons[VACLAV];
        expect(v.parentIds).toEqual([JAKUB, MARIE]);
        const family = Object.values(layer.data.partnerships).find(u => u.childIds.includes(JOSEF))!;
        expect(family.childIds).toContain(VACLAV);
        expect(layer.data.persons[JAKUB].childIds).toContain(VACLAV);
        // Only what the link touches is copied.
        expect(layer.data.persons[KAREL]).toBe(TREE.persons[KAREL]);
        expect(TREE.persons[VACLAV].parentIds).toEqual([]);
    });

    it('one shown parent alone: a family with a "?" stand-in, as every single parent has', () => {
        const layer = buildViewLayer(TREE, [link(C)])!;
        const v = layer.data.persons[VACLAV];
        expect(v.parentIds).toContain(JAN);
        const stand = v.parentIds.find(p => p !== JAN)!;
        expect(layer.data.persons[stand]).toMatchObject({ isPlaceholder: true, firstName: '?', gender: 'female' });
        expect(TREE.persons[stand]).toBeUndefined();
        expect(layer.ghostOf.get(stand)?.hypo).toBe('H0022');
    });

    it('a real mother and a "?" father: the shown father takes the "?" place', () => {
        const { data, mother, stand } = withRealMother();
        const before = structuredClone(data);
        const layer = buildViewLayer(data, [link(C)])!;
        expect(data).toEqual(before);
        expect(layer.data.persons[VACLAV].parentIds.sort()).toEqual([JAN, mother].sort());
        expect(layer.data.persons[stand]).toBeUndefined();
        const family = Object.values(layer.data.partnerships).find(u => u.childIds.includes(VACLAV))!;
        expect([family.person1Id, family.person2Id].sort()).toEqual([JAN, mother].sort());
    });

    it('a sibling in the "?" family stays there; the anchor moves into a family of the two', () => {
        const { data, mother, stand, sib } = withRealMother(true);
        const layer = buildViewLayer(data, [link(C)])!;
        const vFamily = Object.values(layer.data.partnerships).find(u => u.childIds.includes(VACLAV))!;
        expect([vFamily.person1Id, vFamily.person2Id].sort()).toEqual([JAN, mother].sort());
        const sFamily = Object.values(layer.data.partnerships).find(u => u.childIds.includes(sib!))!;
        expect([sFamily.person1Id, sFamily.person2Id].sort()).toEqual([mother, stand].sort());
        expect(sFamily.childIds).not.toContain(VACLAV);
        expect(layer.data.persons[stand].childIds).toEqual([sib]);
    });

    it('partners: a partnership of the anchor and the shown partner', () => {
        const layer = buildViewLayer(TREE, [link(PARTNER)])!;
        const u = Object.values(layer.data.partnerships).find(x => [x.person1Id, x.person2Id].includes(MARTIN))!;
        expect([u.person1Id, u.person2Id].sort()).toEqual([ROZALIE, MARTIN].sort());
        expect(layer.data.persons[ROZALIE].partnerships).toContain(u.id);
        expect(TREE.partnerships[u.id]).toBeUndefined();
    });

    it('one family, one place: a later link showing the same family is skipped', () => {
        const layer = buildViewLayer(TREE, [link(B, 1), link(ANTONIN_A, 2)])!;
        expect(layer.links.map(l => l.hypo)).toEqual(['H0022']);
        expect(layer.data.persons[ANTONIN].parentIds).toEqual(TREE.persons[ANTONIN].parentIds);
    });
});

describe('ghost and virtual flags', () => {
    it('H0022 B, focus Karel: the five of the family are ghosts, the line to Václav is virtual', () => {
        const r = layout(TREE, KAREL, { viewLinks: [link(B)] });
        expect([...r.viewLayer!.ghostIds].sort()).toEqual([JAKUB, MARIE, JOSEF, TOMAS, ANNA].sort());
        expect(new Set(viewLinkIsland(TREE, B))).toEqual(new Set([JAKUB, MARIE, JOSEF, TOMAS, ANNA]));
        const toVaclav = dropTo(r, VACLAV)!;
        expect(toVaclav.drop.view).toBe('virtual');
        expect(toVaclav.conn.view).toBe('ghost');
        expect(dropTo(r, JOSEF)!.drop.view).toBe('ghost');
        expect(dropTo(r, JAKUB)!.conn.view).toBe('ghost');
        expect(spouseLine(r, JAKUB, MARIE)!.view).toBe('ghost');
        expect(spouseLine(r, TOMAS, ANNA)!.view).toBe('ghost');
        // The tree's own people and lines carry no flag.
        expect(spouseLine(r, VACLAV, ROZALIE)!.view).toBeUndefined();
        expect(spouseLine(r, ANTONIN, LUDMILA)!.view).toBeUndefined();
        expect(dropTo(r, KAREL)!.drop.view).toBeUndefined();
        expect(dropTo(r, KAREL)!.conn.view).toBeUndefined();
        expect(dropTo(r, ROZALIE)!.conn.view).toBeUndefined();
        for (const pid of [KAREL, VACLAV, ROZALIE, ANTONIN, LUDMILA]) expect(r.viewLayer!.ghostIds.has(pid)).toBe(false);
        expect(r.viewLayer!.ghostOf.get(JOSEF)?.variant).toBe('B');
    });

    it('H0022 C: one parent alone, the whole line is virtual, no "?" card', () => {
        const r = layout(TREE, KAREL, { viewLinks: [link(C)] });
        expect([...r.viewLayer!.ghostIds]).toEqual([JAN]);
        const toVaclav = dropTo(r, VACLAV)!;
        expect(toVaclav.conn.view).toBe('virtual');
        expect(toVaclav.drop.view).toBe('virtual');
        for (const pid of r.positions.keys()) expect(TREE.persons[pid], `${pid} is a person of the tree`).toBeDefined();
    });

    it('a partner: the partner line is virtual, the partner a ghost', () => {
        const r = layout(TREE, ROZALIE, { viewLinks: [link(PARTNER)] });
        expect(spouseLine(r, ROZALIE, MARTIN)!.view).toBe('virtual');
        expect(spouseLine(r, VACLAV, ROZALIE)!.view).toBeUndefined();
        expect([...r.viewLayer!.ghostIds]).toEqual([MARTIN]);
    });

    it('a chained link: the family it hangs on and its own are ghosts, each link line virtual', () => {
        const r = layout(TREE, KAREL, { viewLinks: [link(B, 1), link(CHAIN, 2)] });
        expect(r.viewLayer!.ghostIds.has(VOJTECH)).toBe(true);
        expect(r.viewLayer!.ghostOf.get(VOJTECH)?.hypo).toBe('H0030');
        expect(dropTo(r, TOMAS)!.drop.view).toBe('virtual');
        expect(dropTo(r, TOMAS)!.conn.view).toBe('virtual');
        expect(dropTo(r, VACLAV)!.drop.view).toBe('virtual');
    });

    it('a real mother with the shown father: their partner line is virtual, the mother no ghost', () => {
        const { data, mother } = withRealMother();
        const r = layout(data, VACLAV, { viewLinks: [link(C)] });
        expect(spouseLine(r, JAN, mother)!.view).toBe('virtual');
        expect(dropTo(r, VACLAV)!.drop.view).toBe('virtual');
        expect(r.viewLayer!.ghostIds.has(mother)).toBe(false);
        expect(r.viewLayer!.ghostIds.has(JAN)).toBe(true);
    });

    it('the sibling left in the "?" family keeps its plain line', () => {
        const { data, sib } = withRealMother(true);
        const r = layout(data, VACLAV, { viewLinks: [link(C)] });
        expect(dropTo(r, VACLAV)!.drop.view).toBe('virtual');
        expect(dropTo(r, sib!)!.drop.view).toBeUndefined();
        expect(dropTo(r, sib!)!.conn.view).toBeUndefined();
    });

    it('the Descendants view of a shown parent reaches the tree through the link', () => {
        const r = layout(TREE, JAKUB, {
            viewLinks: [link(B)], ancestorDepth: 0, includeParentSiblings: false, includeParentSiblingDescendants: false,
        });
        for (const pid of [JOSEF, VACLAV, KAREL]) expect(r.positions.has(pid), pid).toBe(true);
        expect(dropTo(r, VACLAV)!.drop.view).toBe('virtual');
        expect(r.viewLayer!.ghostIds.has(KAREL)).toBe(false);
        expect(r.viewLayer!.ghostIds.has(JAKUB)).toBe(true);
    });
});

describe('the switch of the outputs: includeView', () => {
    it('includeView: false lays out the tree as it is', () => {
        const plain = layout(TREE, KAREL);
        const off = layout(TREE, KAREL, { viewLinks: [link(B)], includeView: false });
        expect(off.viewLayer).toBeUndefined();
        expect([...off.positions]).toEqual([...plain.positions]);
        expect(off.connections).toEqual(plain.connections);
        expect(off.spouseLines).toEqual(plain.spouseLines);
        for (const pid of [JAKUB, MARIE, JOSEF]) expect(off.positions.has(pid)).toBe(false);
    });

    it('no links given: no layer, no flag anywhere', () => {
        const r = layout(TREE, KAREL, { viewLinks: [] });
        expect(r.viewLayer).toBeUndefined();
        expect(r.connections.every(c => !c.view && c.drops.every(d => !d.view))).toBe(true);
        expect(r.spouseLines.every(s => !s.view)).toBe(true);
    });
});

describe('which links a view draws', () => {
    const opts = (over: Partial<Parameters<typeof viewLinksToDraw>[1]> = {}) => ({
        viewMode: 'family', links: [link(B)], master: true, bridge: null, ...over,
    });

    it('Family and Descendants draw them', () => {
        expect(VIEW_LINK_VIEWS).toEqual(['family', 'descendants']);
        expect(viewLinksToDraw(TREE, opts()).map(l => l.hypo)).toEqual(['H0022']);
        expect(viewLinksToDraw(TREE, opts({ viewMode: 'descendants' })).map(l => l.hypo)).toEqual(['H0022']);
    });

    it('the fan, the timeline and the map draw nothing', () => {
        for (const viewMode of ['fan', 'timeline', 'map']) expect(viewLinksToDraw(TREE, opts({ viewMode }))).toEqual([]);
    });

    it('main switch off, a record off, or nothing chosen: nothing', () => {
        expect(viewLinksToDraw(TREE, opts({ master: false }))).toEqual([]);
        expect(viewLinksToDraw(TREE, opts({ links: [link(B, 1, { on: false })] }))).toEqual([]);
        expect(viewLinksToDraw(TREE, opts({ links: [] }))).toEqual([]);
    });

    it('a record no longer valid draws nothing (Václav got real parents)', () => {
        const data = structuredClone(TREE);
        data.persons[VACLAV].parentIds.push(ANTONIN);
        data.persons[ANTONIN].childIds.push(VACLAV);
        expect(viewLinksToDraw(data, opts())).toEqual([]);
    });

    it('a chained link only with the family it hangs on', () => {
        expect(viewLinksToDraw(TREE, opts({ links: [link(CHAIN, 2)] }))).toEqual([]);
        expect(viewLinksToDraw(TREE, opts({ links: [link(B, 1), link(CHAIN, 2)] })).map(l => l.hypo)).toEqual(['H0022', 'H0030']);
    });

    it('the feature not available: nothing (data without the variants\' links; a live bridge without hypothesis.links)', () => {
        const bare = structuredClone(TREE);
        for (const p of Object.values(bare.persons)) {
            delete p.research;
        }
        expect(viewLinksToDraw(bare, opts())).toEqual([]);
        expect(viewLinksToDraw(TREE, opts({ bridge: { features: ['family.alone'] } }))).toEqual([]);
        expect(viewLinksToDraw(TREE, opts({ bridge: { features: ['hypothesis.links'] } })).map(l => l.hypo)).toEqual(['H0022']);
    });
});

describe('what never sees the view links', () => {
    const shown = [link(B, 1), link(PARTNER, 2), link(CHAIN, 3)];

    it('counts of people and generations, statistics, fan, timeline and the book are the same with links shown', () => {
        const data = structuredClone(TREE);
        const before = {
            people: Object.keys(data.persons).length,
            generations: [...assignGenerations(data)],
            stats: computeFamilyStats(data),
            completeness: computeCompleteness(data),
            fan: buildFanModel(data, KAREL, 6)!.sectors.map(s => s.person?.id ?? null),
            timeline: computeTimelineModel(data, Object.keys(data.persons), 2026),
            book: buildFamilyBook(data, { lang: 'en', privacyMode: 'full', dateLabel: 'x' }),
        };
        // Lay the view out with the links, in both views that draw them.
        layout(data, KAREL, { viewLinks: shown });
        layout(data, JAKUB, { viewLinks: shown, ancestorDepth: 0, includeParentSiblings: false, includeParentSiblingDescendants: false });
        expect(Object.keys(data.persons).length).toBe(before.people);
        expect([...assignGenerations(data)]).toEqual(before.generations);
        expect(computeFamilyStats(data)).toEqual(before.stats);
        expect(computeCompleteness(data)).toEqual(before.completeness);
        expect(buildFanModel(data, KAREL, 6)!.sectors.map(s => s.person?.id ?? null)).toEqual(before.fan);
        expect(computeTimelineModel(data, Object.keys(data.persons), 2026)).toEqual(before.timeline);
        expect(buildFamilyBook(data, { lang: 'en', privacyMode: 'full', dateLabel: 'x' })).toBe(before.book);
        // The fan of Karel knows no shown family.
        expect(before.fan).not.toContain(JAKUB);
        expect(data).toEqual(TREE);
    });

    it('the focus depth counts the links in (it is the view), the tree\'s depth does not', () => {
        expect(maxGenerationsWithSiblings(TREE, KAREL).up).toBe(2);
        const viewData = buildViewLayer(TREE, shown)!.data;
        expect(maxGenerationsWithSiblings(viewData, KAREL).up).toBe(4);
        expect(maxGenerations(viewData, JAKUB).down).toBe(2);
        expect(maxGenerations(TREE, JAKUB).down).toBe(1);
    });

    it('the layer\'s people are the island people of the tree\'s data', () => {
        const ctx = viewLinkContext(TREE);
        const r = layout(TREE, KAREL, { viewLinks: shown });
        const island = new Set([...viewLinkIsland(TREE, B, ctx), ...viewLinkIsland(TREE, PARTNER, ctx), ...viewLinkIsland(TREE, CHAIN, ctx)]);
        for (const pid of r.viewLayer!.ghostIds) expect(island.has(pid)).toBe(true);
    });
});
