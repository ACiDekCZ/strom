/**
 * Reading what each variant of a hypothesis would connect (Strom Research,
 * docs: the research's answer of 9 Oct 2026): 2 STAT, 2 _CHOSEN, 2 _VAR with
 * its claim, links and sources under 1 _STROM_HYPO; 3 _VAR after the joins at
 * the edge and on the islands; the edge end `named`. Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { edgeNamed, edgeShape, edgeView } from '../research-edge.js';
import { stripResearchWork } from '../privacy.js';
import { StromData } from '../types.js';
import { HYPOTHESIS_LINKS_GED, loadHypothesisLinksTree } from './helpers/hypothesis-links-fixture.js';

const hypo = (data: StromData, personId: string, id: string) =>
    data.persons[personId as never].research?.hypotheses?.find(h => h.id === id);

describe('hypothesis variants from a research file', () => {
    it('reads the status, the choice and every variant with its claim, links and sources', () => {
        const { data, id } = loadHypothesisLinksTree();
        const h = hypo(data, id('P0010'), 'H0022')!;
        expect(h.status).toBe('open');
        expect(h.chosen).toBeUndefined();
        expect(h.variants?.map(v => v.id)).toEqual(['A', 'B', 'C']);
        const [a, b, c] = h.variants!;
        expect(a).toMatchObject({ id: 'A', title: 'narozen 1818 v Habrech čp. 68, syn Šebestiána(?)', links: [] });
        // a claim folded over CONC lines (the research never cuts beside a space)
        expect(b.title).toBe('syn Jakuba Horáka a Marie Pokorné (sňatek S0001), jak je jmenuje oddací zápis ženicha z roku 1857 v Lhotě; '
            + 'křest v Lhotě 1818 chybí, rodiče žili v Lhotě čp. 12 od roku 1815 podle sčítání a pozemkové knihy, otec byl podle zápisu domkář');
        // _FAM: the family's partners, as the research's person numbers
        expect(b.links).toEqual([{ kind: 'child', child: 'P0010', parents: ['P0125', 'P0126'], family: true }]);
        // _PAR: parents of no family together (here one)
        expect(c.links).toEqual([{ kind: 'child', child: 'P0010', parents: ['P0130'] }]);
        const titles = (ids: string[] | undefined) => (ids ?? []).map(s => data.sources![s].title);
        expect(titles(a.sourceIds)).toEqual(['Křestní matrika Habry 1810–1830']);
        expect(titles(b.sourceIds)).toEqual(['Oddací matrika Lhota 1850–1870', 'Křestní matrika Lhota 1810–1830']);
        expect(c.sourceIds).toBeUndefined();
        // the same hypothesis on every person it concerns
        expect(hypo(data, id('P0125'), 'H0022')).toEqual(h);
        expect(hypo(data, id('P0130'), 'H0022')).toEqual(h);
    });

    it('reads partners, same and siblings, a decided hypothesis with its choice and an abandoned one', () => {
        const { data, id } = loadHypothesisLinksTree();
        expect(hypo(data, id('P0011'), 'H0024')!.variants).toEqual([
            { id: 'A', title: 'vdova po Martinu Novotném', links: [{ kind: 'partners', persons: ['P0011', 'P0140'] }] },
            { id: 'B', title: 'svobodná', links: [] },
        ]);
        expect(hypo(data, id('P0001'), 'H0025')!.variants!.map(v => v.links)).toEqual([
            [{ kind: 'same', persons: ['P0001', 'P0141'] }],
            [{ kind: 'siblings', persons: ['P0001', 'P0141'] }],
        ]);
        const decided = hypo(data, id('P0011'), 'H0026')!;
        expect(decided).toMatchObject({ status: 'decided', chosen: 'B' });
        expect(decided.variants![1].links).toEqual([{ kind: 'child', child: 'P0011', parents: ['P0012', 'P0013'], family: true }]);
        // a link to a record not in the file goes; the variant stays
        const abandoned = hypo(data, id('P0001'), 'H0027')!;
        expect(abandoned.status).toBe('abandoned');
        expect(abandoned.variants).toEqual([{ id: 'A', title: 'syn Jana z Podhradí', links: [] }]);
    });

    it('reads the variants of the joins at the edge and on the islands, and the named end', () => {
        const { data, id } = loadHypothesisLinksTree();
        const edge = data.persons[id('P0010')].research!.edge!;
        expect(edge.hypos).toEqual([{ id: 'H0022', join: 'P0130', island: 5, held: 0, tests: [], variants: ['B', 'C'] }]);
        expect(data.persons[id('P0125')].research!.island).toEqual({ size: 5, hypos: [
            { id: 'H0022', join: 'P0010', variants: ['B'] }, { id: 'H0028', join: 'P0012', variants: ['A'] },
        ], held: 0 });
        expect(data.persons[id('P0130')].research!.island!.hypos).toEqual([{ id: 'H0022', join: 'P0010', variants: ['C'] }]);
        expect(data.persons[id('P0141')].research!.island!.hypos).toEqual([{ id: 'H0025', join: 'P0001', variants: ['A', 'B'] }]);
        expect(edge.end).toBe('named');
        expect(edgeNamed(edge)).toBe(true);
        expect(edgeNamed({ ...edge, missing: 'proof' })).toBe(false);
        expect(edgeNamed({ ...edge, end: 'unsearched' })).toBe(false);
        expect(edgeShape('named')).toBe('open');
        expect(edgeView(edge, 'mine')).toMatchObject({ kind: 'stub', shape: 'open', tone: 'yours' });
    });

    it('a copy that leaves the app keeps which variants would join', () => {
        const { data, id } = loadHypothesisLinksTree();
        const copy = stripResearchWork(structuredClone(data));
        expect(copy.persons[id('P0010')].research!.edge!.hypos[0].variants).toEqual(['B', 'C']);
        expect(copy.persons[id('P0010')].research!.hypotheses).toEqual(data.persons[id('P0010')].research!.hypotheses);
    });

    it('keeps only what it can trust: letters, kinds, pointers into the file, enough people', () => {
        const ged = `0 HEAD
1 SOUR STROM_RESEARCH
1 CHAR UTF-8
0 @S1@ SOUR
1 TITL Matrika
1 REFN S0001
0 @P1@ INDI
1 NAME Jan /Malý/
1 SEX M
1 REFN P0001
1 _STROM_HYPO H0001
2 TITL Čí syn byl Jan?
2 STAT OPEN
2 _CHOSEN A
2 _VAR A
3 TITL bez rodičů
3 _LINK child
4 _PERS @P1@
3 _LINK child
4 _PERS @P1@
4 _PAR @P1@
3 _LINK cousins
4 _PERS @P1@
4 _PERS @P2@
3 _LINK partners
4 _PERS @P1@
3 _LINK partners
4 _PERS @P1@
4 _PERS @P2@
4 _PERS @P3@
3 _LINK same
4 _PERS @P1@
4 _PERS @P9@
3 _LINK child
4 _PERS @P1@
4 _FAM @F9@
3 _LINK child
4 _PERS @P1@
4 _PAR @P2@
4 _PAR @P3@
4 _PAR @P4@
3 _LINK child
4 _PERS @P1@
4 _PAR @P2@
4 _PAR @P2@
3 SOUR @S1@
3 SOUR @S9@
3 SOUR text without pointer
2 _VAR A
3 TITL a second A
2 _VAR b
3 TITL a lower-case letter
2 _VAR
3 TITL no letter
2 _VAR B
3 _LINK siblings
4 _PERS @P1@
4 _PERS @P2@
4 _PERS @P3@
3 _LINK child
4 _PERS @P1@
4 _PAR @P5@
1 _STROM_EDGE parents
2 _END named
2 _HYPO H0001
3 _JOIN P0002
3 _VAR B
3 _VAR B
3 _VAR x
0 @P2@ INDI
1 NAME Petr /Malý/
1 SEX M
1 REFN P0002
0 @P3@ INDI
1 NAME Eva /Malá/
1 SEX F
1 REFN P0003
0 @P4@ INDI
1 NAME Iva /Malá/
1 SEX F
1 REFN P0004
0 @P5@ INDI
1 NAME Bez /Čísla/
0 TRLR
`;
        const data = convertToStrom(parseGedcom(ged)).data;
        const jan = Object.values(data.persons).find(p => p.refn === 'P0001')!;
        const h = jan.research!.hypotheses![0];
        // the status as a word in lower case; a choice only on a decided one
        expect(h.status).toBe('open');
        expect(h.chosen).toBeUndefined();
        expect(h.variants!.map(v => v.id)).toEqual(['A', 'B']);
        const [a, b] = h.variants!;
        expect(a.title).toBe('bez rodičů');
        expect(a.links).toEqual([{ kind: 'child', child: 'P0001', parents: ['P0002'] }]);
        // a pointer to no record goes; a source written as text is one like everywhere in GEDCOM
        expect(a.sourceIds!.map(s => data.sources![s].title)).toEqual(['Matrika', 'text without pointer']);
        // siblings take any number of people; a parent without the research's number goes with its link
        expect(b.links).toEqual([{ kind: 'siblings', persons: ['P0001', 'P0002', 'P0003'] }]);
        expect(jan.research!.edge!.hypos[0].variants).toEqual(['B']);
    });

    it('a GEDCOM that is not the research\'s keeps none of it', () => {
        const foreign = HYPOTHESIS_LINKS_GED.replace('1 SOUR STROM_RESEARCH', '1 SOUR OTHER');
        const data = convertToStrom(parseGedcom(foreign)).data;
        expect(Object.values(data.persons).every(p => !p.research)).toBe(true);
    });
});
