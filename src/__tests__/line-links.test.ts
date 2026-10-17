/**
 * Line links: a parent-child line the layout left out (step 7,
 * LayoutResult.omittedEdges) becomes a tab on the child's card ("parents ↗")
 * and on the parents' cards ("child ↗" / "children ↗"), and a static label
 * under those cards in the image export ("parents: …").
 */

import { describe, it, expect, afterEach } from 'vitest';
import { lineLinksOf, lineLinkTabs } from '../marriage-order.js';
import { tabLabel, branchTabRestHtml, measureTabRows, rowKey } from '../union-order-measure.js';
import { buildTreeSvg, lineLinkLabel, PosterLayout } from '../export-image.js';
import { setLanguage, strings } from '../strings.js';
import { OmittedEdge, UnionId } from '../layout/pipeline/types.js';
import { Person, PersonId, PartnershipId, Position, StromData } from '../types.js';

const P = (id: string) => id as PersonId;
const edge = (unionId: string, childId: string, parentIds: string[]): OmittedEdge =>
    ({ unionId: unionId as UnionId, childId: P(childId), parentIds: parentIds.map(P) });

afterEach(() => setLanguage('en'));

describe('the line links of the cards', () => {
    it('the child links to its parents, each parent to its children (one tab for several)', () => {
        const links = lineLinksOf([
            edge('u1', 'kid1', ['dad', 'mum']),
            edge('u1', 'kid2', ['dad', 'mum']),
            edge('u2', 'dad', ['grandpa']),
        ]);
        expect(links.get(P('kid1'))).toEqual({ parentIds: ['dad', 'mum'], childIds: [] });
        expect(links.get(P('mum'))).toEqual({ parentIds: [], childIds: ['kid1', 'kid2'] });
        // A child of one left-out line and parent of another: both tabs
        expect(links.get(P('dad'))).toEqual({ parentIds: ['grandpa'], childIds: ['kid1', 'kid2'] });
        expect(lineLinkTabs(links.get(P('dad')))).toEqual(['linkParents', 'linkChildren']);
        expect(lineLinkTabs(links.get(P('grandpa')))).toEqual(['linkChild']);
        expect(lineLinkTabs(links.get(P('kid1')))).toEqual(['linkParents']);
        expect(lineLinkTabs(undefined)).toEqual([]);
    });

    it('a line without a shown parent links nothing', () => {
        expect(lineLinksOf([edge('u1', 'kid', [])]).size).toBe(0);
    });
});

describe('the tab words (cs/en/de, impersonal)', () => {
    const cases: Array<['en' | 'cs' | 'de', string[]]> = [
        ['en', ['parents ↗', 'child ↗', 'children ↗']],
        ['cs', ['rodiče ↗', 'dítě ↗', 'děti ↗']],
        ['de', ['Eltern ↗', 'Kind ↗', 'Kinder ↗']],
    ];
    it.each(cases)('%s', (lang, words) => {
        setLanguage(lang);
        expect(['linkParents', 'linkChild', 'linkChildren'].map(k => tabLabel(k as never))).toEqual(words);
        // The resting tab: the branch tab's glyph and word
        expect(branchTabRestHtml('linkParents')).toBe(`<span class="pill-glyph">◂</span><span class="pill-text">${words[0]}</span>`);
        expect(branchTabRestHtml('linkChild')).toContain('<span class="pill-glyph">▸</span>');
        const tips = [strings.focus.linkParentsTooltip, strings.focus.linkChildTooltip, strings.focus.linkChildrenTooltip];
        for (const tip of tips) expect(tip).not.toMatch(/\b(you|your|vy|váš|vaše|Sie|Ihr|du)\b/i);
    });

    it('a row of tabs is measured with the line links in it', () => {
        const hidden = measureTabRows([['parents']]).get(rowKey(['parents']))!;
        const both = measureTabRows([['parents', 'linkChild']]).get(rowKey(['parents', 'linkChild']))!;
        expect(both).toBeGreaterThan(hidden + 20);
        expect(rowKey(['linkChild'])).not.toBe(rowKey(['children']));
    });
});

describe('the image export labels the cards of a left-out line', () => {
    const person = (id: string, firstName: string): Person => ({
        id: P(id), firstName, lastName: 'Novák', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
    });
    const data: StromData = {
        persons: { dad: person('dad', 'Jan'), kid: person('kid', 'Petr') } as StromData['persons'],
        partnerships: {} as Record<PartnershipId, never>,
    };
    const layout = (omitted: OmittedEdge[]): PosterLayout => ({
        positions: new Map<PersonId, Position>([[P('dad'), { x: 0, y: 0 }], [P('kid'), { x: 600, y: 300 }]]),
        connections: [], spouseLines: [], omittedEdges: omitted,
    });

    it('a static label naming the other end, without the arrow', () => {
        setLanguage('cs');
        const svg = buildTreeSvg(data, layout([edge('u1', 'kid', ['dad'])]));
        expect(svg).toContain('<g class="line-link-pills">');
        expect(svg).toContain('>rodiče: Jan Novák<');
        expect(svg).toContain('>dítě: Petr Novák<');
        expect(svg).not.toContain('↗');
    });

    it('no left-out line, no label', () => {
        expect(buildTreeSvg(data, layout([]))).not.toContain('line-link-pill');
    });

    it('a long label is shortened with "…" to the card', () => {
        const label = lineLinkLabel('linkChildren', ['Bartoloměj Novák', 'Maximilián Novák', 'Kristýna Nováková'], 130);
        expect(label.endsWith('…')).toBe(true);
        expect(label.startsWith('children: Bartolom')).toBe(true);
        expect(label.length).toBeLessThan(24);
    });
});
