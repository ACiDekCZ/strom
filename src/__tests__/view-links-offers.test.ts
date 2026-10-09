/**
 * Linked in the view only, what the actions offer: each variant of a
 * hypothesis with what it would show, the people it brings, whether it is
 * only text and whether it is shown now; the `named` edge's hypothesis and
 * the number of its options. Invented data (research-hypothesis-links.ged).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { loadHypothesisLinksTree } from './helpers/hypothesis-links-fixture.js';
import { ViewLink, shownViewLink, showViewLink, viewLinkOffers, unlinkViewLink } from '../view-links.js';
import { edgeNamedHypothesis, edgeNamedOptions, edgeView } from '../research-edge.js';
import { setLanguage } from '../strings.js';

afterEach(() => setLanguage('en'));

describe('viewLinkOffers', () => {
    it('offers every variant of H0022 in the file order: A nothing to draw, B the family of five, C Jan alone', () => {
        const { data, id } = loadHypothesisLinksTree();
        const offers = viewLinkOffers(data, [], true, 'H0022');
        expect(offers.map(o => o.variant)).toEqual(['A', 'B', 'C']);
        const [a, b, c] = offers;
        expect(a).toMatchObject({ choice: null, state: null, people: 0, textOnly: false, shown: false });
        expect(a.title).toMatch(/^narozen 1818 v Habrech/);
        expect(b.choice).toEqual({ hypo: 'H0022', variant: 'B', kind: 'child', anchorId: id('P0010'), islandIds: [id('P0125'), id('P0126')] });
        expect(b).toMatchObject({ state: { state: 'draw' }, people: 5, textOnly: false, shown: false });
        expect(c.choice).toEqual({ hypo: 'H0022', variant: 'C', kind: 'child', anchorId: id('P0010'), islandIds: [id('P0130')] });
        expect(c).toMatchObject({ state: { state: 'draw' }, people: 1 });
    });

    it('a variant naming people only as text (same, siblings) is text only', () => {
        const { data } = loadHypothesisLinksTree();
        const offers = viewLinkOffers(data, [], true, 'H0025');
        expect(offers.map(o => [o.variant, o.choice, o.textOnly])).toEqual([['A', null, true], ['B', null, true]]);
    });

    it('a decided or abandoned hypothesis offers nothing that could be shown', () => {
        const { data } = loadHypothesisLinksTree();
        // H0026 decided for B: its link is real now.
        expect(viewLinkOffers(data, [], true, 'H0026').find(o => o.variant === 'B')?.state).toEqual({ state: 'real' });
        // H0027 abandoned, its parent not in the file: nothing to draw.
        expect(viewLinkOffers(data, [], true, 'H0027')[0]).toMatchObject({ choice: null, state: null });
        expect(viewLinkOffers(data, [], true, 'H9999')).toEqual([]);
    });

    it('marks the version shown now; switched off or with the main switch off nothing is shown', () => {
        const { data } = loadHypothesisLinksTree();
        const b = viewLinkOffers(data, [], true, 'H0022')[1].choice!;
        const links = showViewLink(data, [], b, 10).links;
        expect(viewLinkOffers(data, links, true, 'H0022').map(o => o.shown)).toEqual([false, true, false]);
        expect(shownViewLink(links, true, 'H0022')).toMatchObject({ variant: 'B', on: true });
        expect(viewLinkOffers(data, links, false, 'H0022').some(o => o.shown)).toBe(false);
        expect(shownViewLink(links, false, 'H0022')).toBeNull();
        const off = unlinkViewLink(data, links, 'H0022').links;
        expect(viewLinkOffers(data, off, true, 'H0022').some(o => o.shown)).toBe(false);
        expect(shownViewLink(off, true, 'H0022')).toBeNull();
        expect(shownViewLink(links as ViewLink[], true, 'H0028')).toBeNull();
    });

    it('showing C after B rewrites the one record of the hypothesis', () => {
        const { data } = loadHypothesisLinksTree();
        const [, b, c] = viewLinkOffers(data, [], true, 'H0022');
        const afterB = showViewLink(data, [], b.choice!, 1).links;
        const afterC = showViewLink(data, afterB, c.choice!, 2).links;
        expect(afterC).toHaveLength(1);
        expect(afterC[0]).toMatchObject({ variant: 'C', on: true });
        expect(viewLinkOffers(data, afterC, true, 'H0022').map(o => o.shown)).toEqual([false, false, true]);
    });
});

describe('the named edge', () => {
    it('stands on H0022 and has its three options; without a hypothesis the variants the edge names', () => {
        const { data, id } = loadHypothesisLinksTree();
        const vaclav = data.persons[id('P0010')];
        expect(edgeNamedHypothesis(vaclav)?.id).toBe('H0022');
        expect(edgeNamedOptions(vaclav)).toBe(3);
        const view = edgeView(vaclav.research!.edge!, 'all', {}, edgeNamedOptions(vaclav))!;
        expect(view).toMatchObject({ named: true, shape: 'open', tone: 'yours', label: 'named · 3 options' });
        expect(view.endText).toBe('Parents named, not linked');
        // "To decide" shows it too (decide).
        expect(edgeView(vaclav.research!.edge!, 'mine', {}, 3)).toMatchObject({ named: true, label: 'named · 3 options' });
        setLanguage('cs');
        expect(edgeView(vaclav.research!.edge!, 'all', {}, 3)!.label).toBe('jmenováni · 3 možnosti');
        setLanguage('de');
        expect(edgeView(vaclav.research!.edge!, 'all', {}, 3)!.label).toBe('genannt · 3 Möglichkeiten');
        setLanguage('en');

        const bare = { research: { ...vaclav.research!, hypotheses: [] } };
        expect(edgeNamedHypothesis(bare)).toBeNull();
        expect(edgeNamedOptions(bare)).toBe(2);
        // Another end: not named.
        const other = { research: { ...vaclav.research!, edge: { ...vaclav.research!.edge!, end: 'unsearched' } } };
        expect(edgeNamedHypothesis(other)).toBeNull();
        expect(edgeView(other.research.edge, 'all', {}, 3)).toMatchObject({ named: false, label: 'not searched' });
    });
});
