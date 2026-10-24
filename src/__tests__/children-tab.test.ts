/**
 * The card's children tab (hiddenRelativesTabs): "▸ children" while any
 * child is out of view, "▾ children" (childrenShown) while the view shows the
 * person's children in place; "?" stand-ins never count.
 */

import { describe, it, expect } from 'vitest';
import { hiddenRelativesTabs, hiddenChildIds, newlyShownChildIds, childrenDrawnElsewhere, siblingOrderMark, childrenShownClosing, siblingsTabState, newlyShownSiblingIds, siblingGroups, unionChildIdSet, hiddenPartnerIds, childrenByUnion, childrenComeWithPartners, otherFamilyChildrenElsewhere, HiddenRelativesTab } from '../marriage-order.js';
import { tabsForm, tabGlyph, tabLabel, tabKindClass, branchTabRestHtml, bubbleOpensBelow, bubblePlacement, besideTop, bubbleBox, touchBubbleBox, touchBubbleBounds, touchBubbleSide, BUBBLE_WINDOW_MARGIN, BUBBLE_LOW_WINDOW_NAMES, bubbleNameCounts, bubbleNamesToFit, BUBBLE_MAX_NAMES } from '../union-order-measure.js';
import { branchTabKind, branchTabsInOrder } from '../marriage-order.js';
import { childIdsShownInPlace } from '../layout/pipeline/1-select-subgraph.js';
import { PersonId, PartnershipId, Person, StromData, DEFAULT_LAYOUT_CONFIG } from '../types.js';
import { runLayoutPipeline } from '../layout/pipeline/index.js';
import { loadFixture } from '../layout/__tests__/helpers/loadFixture.js';

function tree(): StromData {
    const d = { persons: {}, partnerships: {} } as unknown as StromData;
    const add = (id: string, gender: 'male' | 'female', isPlaceholder = false): PersonId => {
        d.persons[id as PersonId] = {
            id: id as PersonId, firstName: id, lastName: 'X', gender, isPlaceholder,
            partnerships: [], parentIds: [], childIds: [],
        } as Person;
        return id as PersonId;
    };
    const fam = (id: string, a: PersonId, b: PersonId, kids: PersonId[]): void => {
        d.partnerships[id as PartnershipId] = { id: id as PartnershipId, person1Id: a, person2Id: b, childIds: kids, status: 'married' };
        for (const p of [a, b]) { d.persons[p].partnerships.push(id as PartnershipId); d.persons[p].childIds.push(...kids); }
        for (const k of kids) d.persons[k].parentIds.push(a, b);
    };
    const gf = add('gf', 'male'), gm = add('gm', 'female');
    const father = add('father', 'male'), aunt = add('aunt', 'female'), uncle = add('uncle', 'male');
    fam('u1', gf, gm, [father, aunt, uncle]);
    const q = add('q', 'female', true), stand = add('stand_child', 'male', true);
    fam('u2', uncle, q, [stand]);
    return d;
}

describe('children tab', () => {
    const d = tree();
    const P = (id: string) => id as PersonId;
    const kids = new Set([P('father'), P('aunt'), P('uncle')]);

    it('shows while any child is out of view (the direct line\'s parent with the father in view)', () => {
        const inView = (id: PersonId) => ['gf', 'gm', 'father'].includes(id);
        expect(hiddenRelativesTabs(d, P('gf'), inView, kids)).toEqual(['children']);
        expect(hiddenChildIds(d, P('gf'), inView)).toEqual([P('aunt'), P('uncle')]);
    });

    it('none while every child is in view', () => {
        const inView = (id: PersonId) => ['gf', 'gm', 'father', 'aunt', 'uncle'].includes(id);
        expect(hiddenRelativesTabs(d, P('gf'), inView, kids)).toEqual([]);
    });

    it('the shown state while the view shows the children in place, whatever is in view', () => {
        const inView = (id: PersonId) => ['gf', 'gm', 'father', 'aunt', 'uncle'].includes(id);
        expect(hiddenRelativesTabs(d, P('gf'), inView, kids, new Set([P('gf')]))).toEqual(['childrenShown']);
        expect(hiddenRelativesTabs(d, P('gm'), inView, kids, new Set([P('gf')]))).toEqual([]);
    });

    it('a "?" stand-in child never counts', () => {
        const inView = (id: PersonId) => ['gf', 'gm', 'uncle'].includes(id);
        expect(hiddenChildIds(d, P('uncle'), inView)).toEqual([]);
        expect(hiddenRelativesTabs(d, P('uncle'), inView, kids)).not.toContain('children');
    });

    it('the shown state names only the children the click brought into view, never ones drawn before', () => {
        // The father stood in view before; the aunt and the uncle came with the click
        const before = new Set([P('father')]);
        const after = (id: PersonId) => ['gf', 'gm', 'father', 'aunt', 'uncle'].includes(id);
        expect(newlyShownChildIds(d, P('gf'), after, before)).toEqual([P('aunt'), P('uncle')]);
        // A click that drew nothing new names nobody
        const same = (id: PersonId) => ['gf', 'gm', 'father'].includes(id);
        expect(newlyShownChildIds(d, P('gf'), same, before)).toEqual([]);
        // "?" stand-ins never count
        expect(newlyShownChildIds(d, P('uncle'), () => true, new Set())).toEqual([]);
    });

    it('no tab for a person whose children a click drew none of (the safety net)', () => {
        const inView = (id: PersonId) => ['gf', 'gm', 'father'].includes(id);
        expect(hiddenRelativesTabs(d, P('gf'), inView, kids, new Set(), new Set([P('gf')]))).toEqual([]);
        // Another person keeps theirs
        expect(hiddenRelativesTabs(d, P('gm'), inView, kids, new Set(), new Set([P('gf')]))).toEqual(['children']);
    });

    it('a child linked without a union (its only parent a "?" stand-in) is never promised: the layout never draws it below', () => {
        // comprehensive's "Unknown Parent": one child by a parent link alone, no family
        const t = tree();
        const unknown = 'unknown' as PersonId, child = 'loose_child' as PersonId;
        t.persons[unknown] = { id: unknown, firstName: 'Unknown', lastName: 'Parent', gender: 'male', isPlaceholder: true, partnerships: [], parentIds: [], childIds: [child] } as Person;
        t.persons[child] = { id: child, firstName: 'Loose', lastName: 'X', gender: 'female', partnerships: [], parentIds: [unknown], childIds: [] } as unknown as Person;
        const inView = (id: PersonId) => id === unknown;
        expect(hiddenChildIds(t, unknown, inView)).toEqual([]);
        expect(hiddenRelativesTabs(t, unknown, inView, kids)).toEqual([]);
        expect(childIdsShownInPlace(t, unknown)).toEqual([]);
        // A union's children are what a click shows, union by union
        expect(childIdsShownInPlace(t, P('gf'))).toEqual([P('father'), P('aunt'), P('uncle')]);
    });

    it('keeps the order parents, siblings, children; parents and siblings out of view are one "◎ family" (§4)', () => {
        const inView = (id: PersonId) => id === 'uncle';
        // uncle: parents and siblings out of view; his only child is a stand-in
        expect(hiddenRelativesTabs(d, P('uncle'), inView, kids)).toEqual(['family']);
        expect(hiddenRelativesTabs(d, P('uncle'), inView, kids, new Set([P('uncle')]))).toEqual(['family', 'childrenShown']);
        // A sibling in view: the parents' tab alone
        const withAunt = (id: PersonId) => id === 'uncle' || id === 'aunt';
        expect(hiddenRelativesTabs(d, P('uncle'), withAunt, kids)).not.toContain('family');
    });

    it('parents folded away for children shown in place keep their own dashed tab beside the siblings', () => {
        const inView = (id: PersonId) => id === 'uncle';
        const folded = { parentsFolded: (id: PersonId) => id === 'uncle' };
        expect(hiddenRelativesTabs(d, P('uncle'), inView, kids, new Set(), new Set(), folded)).toEqual(['parentsFolded', 'siblings']);
    });
});

/**
 * The father's family with a half sibling through each parent: the
 * grandfather's second wife (half_gf) and the grandmother's second husband
 * (half_gm), besides the full siblings aunt and uncle.
 */
function halfTree(): StromData {
    const d = tree();
    const add = (id: string, gender: 'male' | 'female'): PersonId => {
        d.persons[id as PersonId] = {
            id: id as PersonId, firstName: id, lastName: 'X', gender, isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [],
        } as Person;
        return id as PersonId;
    };
    const fam = (id: string, a: PersonId, b: PersonId, kids: PersonId[]): void => {
        d.partnerships[id as PartnershipId] = { id: id as PartnershipId, person1Id: a, person2Id: b, childIds: kids, status: 'married' };
        for (const p of [a, b]) { d.persons[p].partnerships.push(id as PartnershipId); d.persons[p].childIds.push(...kids); }
        for (const k of kids) d.persons[k].parentIds.push(a, b);
    };
    const sw = add('second_wife', 'female'), sh = add('second_husband', 'male');
    fam('u3', 'gf' as PersonId, sw, [add('half_gf', 'female')]);
    fam('u4', sh, 'gm' as PersonId, [add('half_gm', 'male')]);
    return d;
}

describe('siblings tab in place (a parent in view)', () => {
    const P = (id: string) => id as PersonId;
    const d = halfTree();
    const kids = unionChildIdSet(d);
    const view = (...ids: string[]) => (id: PersonId) => ids.includes(id);

    it('"▸ siblings": the children of both parents in view, of every marriage, in one step', () => {
        const inView = view('gf', 'gm', 'father');
        const tab = siblingsTabState(d, P('father'), inView, kids);
        expect(tab).toEqual({ kind: 'siblingsHere', parents: [P('gf'), P('gm')], promised: [P('aunt'), P('uncle'), P('half_gf'), P('half_gm')] });
        expect(hiddenRelativesTabs(d, P('father'), inView, kids)).toEqual(['siblingsHere']);
    });

    it('without a parent in view the parents and siblings are one focus tab on the person (◎ family)', () => {
        expect(hiddenRelativesTabs(d, P('father'), view('father'), kids)).toEqual(['family']);
    });

    it('"▾ siblings" after the step, and after the parents\' own "▸ children" too', () => {
        const after = view('gf', 'gm', 'father', 'aunt', 'uncle', 'half_gf', 'half_gm');
        const visibleBefore = (q: PersonId) => (['gf', 'gm'].includes(q) ? new Set([P('father')]) : undefined);
        const both = new Set([P('gf'), P('gm')]);
        expect(hiddenRelativesTabs(d, P('father'), after, kids, both, new Set(), { visibleBefore })).toEqual(['siblingsShown']);
        expect(newlyShownSiblingIds(d, P('father'), after, both, visibleBefore)).toEqual([P('aunt'), P('uncle'), P('half_gf'), P('half_gm')]);
        // The grandfather's "▸ children" alone: the grandmother still has a child out of view
        const gfOnly = view('gf', 'gm', 'father', 'aunt', 'uncle', 'half_gf');
        expect(siblingsTabState(d, P('father'), gfOnly, kids, new Set([P('gf')]), new Set(), { visibleBefore }))
            .toEqual({ kind: 'siblingsHere', parents: [P('gm')], promised: [P('half_gm')] });
        // Without half siblings of the grandmother the tab turns to "▾ siblings"
        const t = tree();
        expect(siblingsTabState(t, P('father'), view('gf', 'gm', 'father', 'aunt', 'uncle'), unionChildIdSet(t), new Set([P('gf')]), new Set(), { visibleBefore })?.kind)
            .toBe('siblingsShown');
    });

    it('no tab while a sibling stood in view before (the focus\'s and its parents\' siblings, unchanged)', () => {
        const inView = view('gf', 'gm', 'father', 'aunt');
        expect(siblingsTabState(d, P('father'), inView, kids)).toBeNull();
        // Drawn before the grandfather's own click as well: still no tab
        const visibleBefore = (q: PersonId) => (q === 'gf' ? new Set([P('father'), P('aunt')]) : undefined);
        expect(siblingsTabState(d, P('father'), inView, kids, new Set([P('gf')]), new Set(), { visibleBefore })).toBeNull();
    });

    it('a sibling drawn elsewhere (no parent line to it) is never promised and keeps the tab', () => {
        const inView = view('gf', 'gm', 'father', 'aunt');
        const tab = siblingsTabState(d, P('father'), inView, kids, new Set(), new Set(), { hangsOnLine: id => id !== 'aunt' });
        expect(tab?.kind).toBe('siblingsHere');
        expect(tab?.promised).toEqual([P('uncle'), P('half_gf'), P('half_gm')]);
    });

    it('a parent whose click drew none (the safety net) is left out of the step', () => {
        const tab = siblingsTabState(d, P('father'), view('gf', 'gm', 'father'), kids, new Set(), new Set([P('gm')]));
        expect(tab).toEqual({ kind: 'siblingsHere', parents: [P('gf')], promised: [P('aunt'), P('uncle'), P('half_gf')] });
    });

    it('the bubble\'s groups: the full siblings, then each parent\'s other marriage', () => {
        const ids = [P('aunt'), P('uncle'), P('half_gf'), P('half_gm')];
        expect(siblingGroups(d, P('father'), ids)).toEqual([
            { full: true, parentId: null, partnerId: null, ids: [P('aunt'), P('uncle')] },
            { full: false, parentId: P('gf'), partnerId: P('second_wife'), ids: [P('half_gf')] },
            { full: false, parentId: P('gm'), partnerId: P('second_husband'), ids: [P('half_gm')] },
        ]);
        // Full siblings alone: one group (the bubble shows no group line then)
        expect(siblingGroups(d, P('father'), [P('aunt')])).toHaveLength(1);
    });
});

describe('children drawn elsewhere', () => {
    const P = (id: string) => id as PersonId;

    it('a daughter who stands as the wife in another branch: in view, no line to her, never promised again', () => {
        const d = tree();
        // The aunt married into another branch and is drawn there as a wife
        const inView = (id: PersonId) => ['gf', 'gm', 'father', 'aunt'].includes(id);
        const onLine = (id: PersonId) => id === 'father';
        expect(childrenDrawnElsewhere(d, P('gf'), inView, onLine)).toEqual([P('aunt')]);
        expect(hiddenChildIds(d, P('gf'), inView)).toEqual([P('uncle')]);
        // A click brings the uncle; the aunt stood in view before and is not named as shown
        const before = new Set([P('father'), P('aunt')]);
        const after = (id: PersonId) => ['gf', 'gm', 'father', 'aunt', 'uncle'].includes(id);
        expect(newlyShownChildIds(d, P('gf'), after, before)).toEqual([P('uncle')]);
    });

    it('none while every child in view hangs on the line; children out of view are not elsewhere', () => {
        const d = tree();
        const inView = (id: PersonId) => ['gf', 'gm', 'father'].includes(id);
        expect(childrenDrawnElsewhere(d, P('gf'), inView, id => id === 'father')).toEqual([]);
    });

    it('a "?" stand-in child is never named', () => {
        const d = tree();
        expect(childrenDrawnElsewhere(d, P('uncle'), () => true, () => false)).toEqual([]);
    });

    it('the laid-out view: the mother\'s sister drawn as the wife of the father\'s brother, before and after the click', () => {
        // edge-children-elsewhere (invented): Ilse, the grandmother's daughter, married the father's brother
        const data = loadFixture('edge-children-elsewhere');
        const run = (shown: PersonId[]) => runLayoutPipeline({
            data, focusPersonId: P('focus'), config: DEFAULT_LAYOUT_CONFIG, ancestorDepth: 3, descendantDepth: 2,
            includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true,
            displayPolicy: { mode: 'expanded', autoExpand: true }, ...(shown.length ? { expandChildrenOf: shown } : {}),
        });
        const elsewhereOf = (r: ReturnType<typeof run>, pid: PersonId) => {
            const drops = new Set(r.connections.flatMap(c => c.drops.map(d => d.personId)));
            return childrenDrawnElsewhere(data, pid, id => r.positions.has(id), id => drops.has(id));
        };
        const before = run([]);
        expect(elsewhereOf(before, P('v_mo'))).toEqual([P('aunt')]);
        // The tab promises only the half-brother out of view
        expect(hiddenChildIds(data, P('v_mo'), id => before.positions.has(id))).toEqual([P('half_v')]);
        const visible = new Set(data.persons[P('v_mo')].childIds.filter(id => before.positions.has(id)));
        const after = run([P('v_mo')]);
        expect(after.positions.has(P('half_v'))).toBe(true);
        expect(newlyShownChildIds(data, P('v_mo'), id => after.positions.has(id), visible)).toEqual([P('half_v')]);
        expect(elsewhereOf(after, P('v_mo'))).toEqual([P('aunt')]);
    });
});

describe('sibling order pill', () => {
    const P = (id: string) => id as PersonId;
    const shown = new Set([P('gf')]);
    // The father (direct line) stood in view before the click
    const before = (pid: PersonId) => pid === 'gf' ? new Set([P('father')]) : undefined;
    const dated = (dates: Record<string, string | undefined>): StromData => {
        const d = tree();
        for (const [id, date] of Object.entries(dates)) d.persons[P(id)].birthDate = date;
        return d;
    };
    const at = (xs: Record<string, number>) => new Map(Object.entries(xs).map(([id, x]) => [P(id), { x }]));

    it('the direct line out of its birth place: "n of total"', () => {
        // Born second of three, drawn at the left end
        const d = dated({ father: '1950-05-01', aunt: '1948-01-01', uncle: '1952-01-01' });
        const pos = at({ father: 0, aunt: 200, uncle: 400 });
        expect(siblingOrderMark(d, P('father'), pos, shown, before)).toEqual({ n: 2, total: 3 });
        // The siblings carry no pill
        expect(siblingOrderMark(d, P('aunt'), pos, shown, before)).toBeNull();
    });

    it('no pill where birth would put the direct line', () => {
        const d = dated({ father: '1946-05-01', aunt: '1948-01-01', uncle: '1952-01-01' });
        expect(siblingOrderMark(d, P('father'), at({ father: 0, aunt: 200, uncle: 400 }), shown, before)).toBeNull();
        // The youngest at the right end
        const y = dated({ father: '1960-05-01', aunt: '1948-01-01', uncle: '1952-01-01' });
        expect(siblingOrderMark(y, P('father'), at({ aunt: 0, uncle: 200, father: 400 }), shown, before)).toBeNull();
    });

    it('siblings born the same day share the places: no pill on any of them', () => {
        const d = dated({ father: '1950-05-01', aunt: '1950-05-01', uncle: '1952-01-01' });
        expect(siblingOrderMark(d, P('father'), at({ father: 0, aunt: 200, uncle: 400 }), shown, before)).toBeNull();
        expect(siblingOrderMark(d, P('father'), at({ aunt: 0, father: 200, uncle: 400 }), shown, before)).toBeNull();
        // A twin pair born after the uncle, the father drawn first
        const t = dated({ father: '1955-05-01', aunt: '1955-05-01', uncle: '1952-01-01' });
        expect(siblingOrderMark(t, P('father'), at({ father: 0, uncle: 200, aunt: 400 }), shown, before)).toEqual({ n: 2, total: 3 });
    });

    it('no pill without a birth date (the person\'s or a sibling\'s)', () => {
        const pos = at({ father: 0, aunt: 200, uncle: 400 });
        expect(siblingOrderMark(dated({ father: undefined, aunt: '1948', uncle: '1952' }), P('father'), pos, shown, before)).toBeNull();
        expect(siblingOrderMark(dated({ father: '1950', aunt: undefined, uncle: '1952' }), P('father'), pos, shown, before)).toBeNull();
    });

    it('a sister drawn elsewhere in the tree (a wife in another branch) stands in no row: she neither counts nor gets a pill', () => {
        const d = dated({ father: '1950-05-01', aunt: '1948-01-01', uncle: '1952-01-01' });
        // The aunt stands far right as the wife in another branch, no line from her parents
        const pos = at({ father: 0, uncle: 200, aunt: 900 });
        const onLine = (id: PersonId) => id !== 'aunt';
        const shownBefore = (pid: PersonId) => pid === 'gf' ? new Set([P('father'), P('aunt')]) : undefined;
        expect(siblingOrderMark(d, P('father'), pos, shown, shownBefore, onLine)).toBeNull();
        expect(siblingOrderMark(d, P('aunt'), pos, shown, shownBefore, onLine)).toBeNull();
        // Counted as standing in the row, the father would be out of his birth place
        expect(siblingOrderMark(d, P('father'), pos, shown, shownBefore)).toEqual({ n: 2, total: 3 });
    });

    it('no pill while the parent does not show the children in place', () => {
        const d = dated({ father: '1950-05-01', aunt: '1948-01-01', uncle: '1952-01-01' });
        const pos = at({ father: 0, aunt: 200, uncle: 400 });
        expect(siblingOrderMark(d, P('father'), pos, new Set(), before)).toBeNull();
        // Only the siblings out of view count: a family of one in view has no order
        expect(siblingOrderMark(d, P('father'), at({ father: 0 }), shown, before)).toBeNull();
    });
});

describe('closing shown children', () => {
    const P = (id: string) => id as PersonId;

    it('closing an ancestor closes the expansions of the descendants it brought into view', () => {
        const brought: Record<string, PersonId[]> = { gf: [P('aunt'), P('uncle')], uncle: [P('cousin')], cousin: [P('cousin_kid')] };
        const broughtIn = (id: PersonId) => brought[id] ? new Set(brought[id]) : undefined;
        const shownIds = [P('gf'), P('uncle'), P('cousin'), P('other')];
        expect([...childrenShownClosing([P('gf')], shownIds, broughtIn)].sort()).toEqual(['cousin', 'gf', 'uncle']);
        // Closing a descendant leaves the ancestor open
        expect([...childrenShownClosing([P('uncle')], shownIds, broughtIn)].sort()).toEqual(['cousin', 'uncle']);
        // A person not showing children closes nothing
        expect([...childrenShownClosing([P('aunt')], shownIds, broughtIn)]).toEqual([]);
    });
});

describe('tabsForm (§3: words, a letter each, the glyphs alone)', () => {
    // The default card: 188px wide, both corner insets 13px
    const room = 188 - 2 * 13;

    it('three tabs never fit with their words: a glyph and a letter each', () => {
        expect(tabsForm(['parents', 'siblings', 'children'], room)).toBe('short');
    });

    it('where even the letters do not fit: the glyphs alone', () => {
        expect(tabsForm(['parents', 'siblings', 'children'], 90)).toBe('glyph');
    });

    it('two tabs and one keep their words', () => {
        expect(tabsForm(['parents', 'siblings'], room)).toBe('full');
        expect(tabsForm(['children'], 20)).toBe('full');
        expect(tabsForm([], room)).toBe('full');
    });
});

describe('the kinds of the tabs (§2: in place, focus, jump)', () => {
    it('the glyph says what a click does, not the relation', () => {
        expect(['parents', 'family', 'siblings'].map(t => tabGlyph(t as never))).toEqual(['◎', '◎', '◎']);
        expect(['siblingsHere', 'children', 'parentsFolded'].map(t => tabGlyph(t as never))).toEqual(['▸', '▸', '▸']);
        expect(['siblingsShown', 'childrenShown'].map(t => tabGlyph(t as never))).toEqual(['▾', '▾']);
        expect(['linkParents', 'linkChild', 'linkChildren'].map(t => tabGlyph(t as never))).toEqual(['↗', '↗', '↗']);
        expect(tabKindClass('family')).toBe('kind-focus');
        expect(tabKindClass('childrenShown')).toBe('kind-place');
        expect(tabKindClass('linkChild')).toBe('kind-jump');
        expect(branchTabKind('parentsFolded')).toBe('place');
    });

    it('a focus tab has no letter: its ◎ says it (one focus tab a card)', () => {
        expect(branchTabRestHtml('family')).not.toContain('pill-short');
        expect(branchTabRestHtml('family')).toMatch(/^<span class="pill-glyph">◎<\/span><span class="pill-text">/);
        expect(branchTabRestHtml('children')).toContain('pill-short');
        expect(tabLabel('family')).not.toBe(tabLabel('parents'));
    });

    it('the tabs stand in the order of the generations, a line link at its relation', () => {
        expect(branchTabsInOrder(['children', 'siblings'], ['linkParents'])).toEqual(['linkParents', 'siblings', 'children']);
        expect(branchTabsInOrder(['family', 'childrenShown'], ['linkChildren'])).toEqual(['family', 'childrenShown', 'linkChildren']);
        expect(branchTabsInOrder(['parentsFolded', 'siblingsShown'], [])).toEqual(['parentsFolded', 'siblingsShown']);
    });
});

describe('an ancestor at the edge of the depth (§4: parents and siblings in place)', () => {
    const P = (id: string) => id as PersonId;
    const d = halfTree();
    const kids = unionChildIdSet(d);
    const view = (...ids: string[]) => (id: PersonId) => ids.includes(id);
    const edge = { atDepthEdge: (id: PersonId) => id === P('father') };

    it('"▸ parents" and "▸ siblings" in place instead of "◎ family"', () => {
        expect(hiddenRelativesTabs(d, P('father'), view('father'), kids, new Set(), new Set(), edge)).toEqual(['parentsHere', 'siblingsHere']);
        const tab = siblingsTabState(d, P('father'), view('father'), kids, new Set(), new Set(), edge);
        expect(tab).toEqual({ kind: 'siblingsHere', parents: [P('gf'), P('gm')], promised: [P('aunt'), P('uncle'), P('half_gf'), P('half_gm')], beyondDepth: true });
        expect(branchTabKind('parentsHere')).toBe('place');
        expect(tabGlyph('parentsHere')).toBe('▸');
        expect(tabLabel('parentsHere')).toBe(tabLabel('parents'));
    });

    it('"▾ parents" while its click shows them; the siblings tab is then the one of a parent in view', () => {
        const ctx = { ...edge, parentsShown: (id: PersonId) => id === P('father') };
        expect(hiddenRelativesTabs(d, P('father'), view('gf', 'gm', 'father'), kids, new Set(), new Set(), ctx)).toEqual(['parentsShown', 'siblingsHere']);
        expect(tabGlyph('parentsShown')).toBe('▾');
        expect(branchTabKind('parentsShown')).toBe('place');
    });

    it('after "▸ siblings" (parents and their children, one step): "▾ siblings" alone', () => {
        const all = view('gf', 'gm', 'father', 'aunt', 'uncle', 'half_gf', 'half_gm');
        const visibleBefore = (q: PersonId) => (['gf', 'gm'].includes(q) ? new Set([P('father')]) : undefined);
        const ctx = { ...edge, visibleBefore, parentsShown: () => false };
        expect(hiddenRelativesTabs(d, P('father'), all, kids, new Set([P('gf'), P('gm')]), new Set(), ctx)).toEqual(['siblingsShown']);
    });

    it('a person whose parents are out of view for another reason keeps the focus tab', () => {
        expect(hiddenRelativesTabs(d, P('father'), view('father'), kids, new Set(), new Set(), { atDepthEdge: () => false })).toEqual(['family']);
        // folded away for children shown: the dashed tab, not the edge's
        expect(hiddenRelativesTabs(d, P('father'), view('father'), kids, new Set(), new Set(), { ...edge, parentsFolded: () => true })[0]).toBe('parentsFolded');
    });
});

/**
 * Other families (§5): the ⌂ pill is gone. Children of another marriage are
 * promised by "▸ children" (named by marriage when they come from more than
 * one), a family whose children all stand elsewhere gets "children ↗", and
 * the "▸ ∞" pill promises the partners of unions without children.
 */
describe('other families and partners (§5)', () => {
    function family(): StromData {
        const d = { persons: {}, partnerships: {} } as unknown as StromData;
        const add = (id: string, gender: 'male' | 'female', isPlaceholder = false): PersonId => {
            d.persons[id as PersonId] = {
                id: id as PersonId, firstName: id, lastName: 'X', gender, isPlaceholder,
                partnerships: [], parentIds: [], childIds: [],
            } as Person;
            return id as PersonId;
        };
        const fam = (id: string, a: PersonId, b: PersonId, kids: PersonId[], startDate?: string): void => {
            d.partnerships[id as PartnershipId] = { id: id as PartnershipId, person1Id: a, person2Id: b, childIds: kids, status: 'married', ...(startDate ? { startDate } : {}) };
            for (const p of [a, b]) { d.persons[p].partnerships.push(id as PartnershipId); d.persons[p].childIds.push(...kids); }
            for (const k of kids) d.persons[k].parentIds.push(a, b);
        };
        // Karl: 2nd marriage Berta (1890, children b1 b2), 1st marriage Anna (1880, child a1),
        // a childless 3rd with Cilka, a childless "?" union
        const k = add('karl', 'male'), anna = add('anna', 'female'), berta = add('berta', 'female'), cilka = add('cilka', 'female');
        const a1 = add('a1', 'male'), b1 = add('b1', 'female'), b2 = add('b2', 'male'), q = add('q', 'female', true);
        fam('u_berta', k, berta, [b1, b2], '1890');
        fam('u_anna', k, anna, [a1], '1880');
        fam('u_cilka', k, cilka, [], '1900');
        fam('u_q', k, q, []);
        return d;
    }
    const d = family();
    const P = (id: string) => id as PersonId;
    const kids = unionChildIdSet(d);
    const view = (...ids: string[]) => (id: PersonId) => ids.includes(id);

    it('hiddenRelativesTabs never returns the former families tab', () => {
        for (const inView of [view('karl'), view('karl', 'anna'), view('karl', 'berta', 'b1', 'b2'), view('karl', 'a1')]) {
            const tabs: readonly HiddenRelativesTab[] = hiddenRelativesTabs(d, P('karl'), inView, kids);
            expect(tabs as readonly string[]).not.toContain('families');
        }
        // The children of a marriage whose partner is out of view are promised by "▸ children"
        expect(hiddenRelativesTabs(d, P('karl'), view('karl', 'berta', 'b1', 'b2'), kids)).toEqual(['children']);
        expect(hiddenChildIds(d, P('karl'), view('karl', 'berta', 'b1', 'b2'))).toEqual([P('a1')]);
    });

    it('"▸ ∞" promises the partners of unions without children out of view, a childless "?" union too', () => {
        expect(hiddenPartnerIds(d, P('karl'), view('karl'))).toEqual([P('cilka'), P('q')]);
        expect(hiddenPartnerIds(d, P('karl'), view('karl', 'cilka'))).toEqual([P('q')]);
        // a partner with children is not counted (the children tab brings them)
        expect(hiddenPartnerIds(d, P('karl'), view('karl'))).not.toContain(P('anna'));
    });

    it('the children by marriage, in the order of the marriages, numbered as the pill numbers them', () => {
        const groups = childrenByUnion(d, P('karl'), [P('b1'), P('b2'), P('a1')]);
        expect(groups.map(g => [g.number, g.partnerId, g.ids])).toEqual([[1, P('anna'), [P('a1')]], [2, P('berta'), [P('b1'), P('b2')]]]);
        // one marriage: one group (the bubble then names no group)
        expect(childrenByUnion(d, P('karl'), [P('b2')])).toHaveLength(1);
    });

    it('the bubble says the partners come along when one of them is out of view', () => {
        expect(childrenComeWithPartners(d, P('karl'), [P('a1')], view('karl', 'berta'))).toBe(true);
        expect(childrenComeWithPartners(d, P('karl'), [P('b1')], view('karl', 'berta'))).toBe(false);
    });

    it('"children ↗" for a family whose children all stand elsewhere, not for one with a child out of view', () => {
        // Anna out of view, a1 drawn elsewhere (no line from this family)
        expect(otherFamilyChildrenElsewhere(d, P('karl'), view('karl', 'a1'), () => false)).toEqual([P('a1')]);
        // Berta out of view, b1 elsewhere, b2 out of view: the children tab, no jump
        expect(otherFamilyChildrenElsewhere(d, P('karl'), view('karl', 'anna', 'b1'), () => false)).toEqual([]);
        // a child on a line of a drawn family is not elsewhere
        expect(otherFamilyChildrenElsewhere(d, P('karl'), view('karl', 'a1'), id => id === P('a1'))).toEqual([]);
        // the partner in view: the family is drawn
        expect(otherFamilyChildrenElsewhere(d, P('karl'), view('karl', 'anna', 'a1'), () => false)).toEqual([]);
    });
});

describe('where a tab\'s bubble opens', () => {
    // a tab 18 px high; the tree from 100 (under the bars) to 800
    const tab = (top: number) => ({ top, bottom: top + 18 });

    it('above the tab while the bubble fits under the bars, with its arrow', () => {
        expect(bubbleOpensBelow(tab(400), 200, 100, 800)).toBe(false);
        expect(bubbleOpensBelow(tab(312), 200, 100, 800)).toBe(false);
    });

    it('below the tab when the room above is too small and the room below larger', () => {
        // a tall bubble (siblings by group) over a card near the top: it would go under the bars
        expect(bubbleOpensBelow(tab(311), 200, 100, 800)).toBe(true);
        expect(bubbleOpensBelow(tab(150), 300, 100, 800)).toBe(true);
    });

    it('stays above when the room below is no larger (it shows the more of itself there)', () => {
        expect(bubbleOpensBelow(tab(500), 600, 100, 800)).toBe(false);
        expect(bubbleOpensBelow(tab(441), 600, 100, 800)).toBe(false);
    });
});

describe('a tab\'s bubble beside the card', () => {
    // the tree from 100 (under the bars) to 800, 0 to 1200 wide; a card 188 × 64 with its tab on the top edge
    const room = { top: 100, bottom: 800, left: 0, right: 1200 };
    const cardAt = (left: number, top: number) => ({ left, right: left + 188, top });
    const tabOn = (top: number) => ({ top: top - 9, bottom: top + 9 });
    const bubble = { width: 240, height: 300 };

    it('above the tab while it fits there, whatever the sides', () => {
        expect(bubblePlacement(tabOn(500), cardAt(500, 500), bubble, room)).toBe('above');
    });

    it('too little room above: beside the card, on the right where it fits, else on the left', () => {
        expect(bubblePlacement(tabOn(150), cardAt(500, 150), bubble, room)).toBe('right');
        // the card's right edge at 1000: 1000 + 10 + 240 > 1200
        expect(bubblePlacement(tabOn(150), cardAt(812, 150), bubble, room)).toBe('left');
        // exactly to the edge still fits
        expect(bubblePlacement(tabOn(150), cardAt(1200 - 250 - 188, 150), bubble, room)).toBe('right');
    });

    it('below the tab only when it fits on neither side (and the room below is larger)', () => {
        const narrow = { ...room, right: 600 };
        // 188-wide card in the middle of a 600-wide tree: 240 + 10 fits neither left of 206 nor right of 394
        expect(bubblePlacement(tabOn(150), cardAt(206, 150), bubble, narrow)).toBe('below');
        // taller than the whole tree: nowhere whole, below where the room is larger
        expect(bubblePlacement(tabOn(150), cardAt(500, 150), { width: 240, height: 701 }, room)).toBe('below');
        // a card partly under the bars: not beside it
        expect(bubblePlacement(tabOn(95), cardAt(500, 95), bubble, room)).toBe('below');
    });

    it('a low screen: whole neither above, below nor beside at the card\'s top: beside the card, moved up', () => {
        // a phone held sideways: the tree from 44 to 390, the tab 216 under the bars, a bubble 292 tall
        const low = { top: 44, bottom: 390, left: 76, right: 844 };
        const tall = { width: 247, height: 292 };
        expect(bubblePlacement(tabOn(260), cardAt(300, 260), tall, low)).toBe('right');
        expect(bubblePlacement(tabOn(260), cardAt(560, 260), tall, low)).toBe('left');
        // as low as it fits whole: its bottom 4 px over the tree's bottom
        expect(besideTop(260, 292, low)).toBe(94);
        // at the card's top where it fits there, never above the bars
        expect(besideTop(60, 292, low)).toBe(60);
        expect(besideTop(20, 292, low)).toBe(44);
        // fits on no side: stays above (more room there than below)
        expect(bubblePlacement(tabOn(260), cardAt(400, 260), { width: 400, height: 292 }, low)).toBe('above');
    });
});

describe('a tab\'s bubble by touch (round 3 §22)', () => {
    const room = { top: 100, bottom: 800, left: 0, right: 1200 };
    const cardAt = (left: number, top: number) => ({ left, right: left + 188, top });
    const tabOn = (top: number) => ({ top: top - 9, bottom: top + 9 });
    const bubble = { width: 240, height: 300 };

    it('below the tab, never beside the card, even where a mouse would open it above or beside', () => {
        // a mouse: above (room above), beside (little room above)
        expect(bubblePlacement(tabOn(450), cardAt(500, 450), bubble, room)).toBe('above');
        expect(bubblePlacement(tabOn(150), cardAt(500, 150), bubble, room)).toBe('right');
        expect(bubblePlacement(tabOn(450), cardAt(500, 450), bubble, room, { touch: true })).toBe('below');
        expect(bubblePlacement(tabOn(150), cardAt(500, 150), bubble, room, { touch: true })).toBe('below');
    });

    it('always below (round 4 §30): also where only the room above would hold it, or none', () => {
        expect(bubblePlacement(tabOn(700), cardAt(500, 700), bubble, room, { touch: true })).toBe('below');
        const tall = { width: 240, height: 650 };
        expect(bubblePlacement(tabOn(400), cardAt(500, 400), tall, room, { touch: true })).toBe('below');
    });
});

describe('a bubble\'s box by touch (round 4 §30, round 5 §33, §34: below the tab, else above it, never over the bars or the bottom navigation)', () => {
    const sideways = { width: 844, height: 390 };
    const phone = { width: 390, height: 844 };
    const tab = (left: number, top: number) => ({ left, right: left + 60, top, bottom: top + 18 });
    const m = BUBBLE_WINDOW_MARGIN;
    const bounds = (barsBottom: number, viewport = sideways) => touchBubbleBounds(barsBottom, viewport, null);

    it('the bounds: under the bars, 8 px in from the window\'s sides and over its bottom without a navigation', () => {
        expect(bounds(44)).toEqual({ top: 44, bottom: 390 - m, left: m, right: 844 - m });
    });

    it('the bounds: 8 px over the bottom navigation\'s top edge (its safe area in its box), never over it (§34)', () => {
        // 390 × 844: the bar 56 px high, 34 px of safe area under it
        expect(touchBubbleBounds(56, phone, { left: 0, top: 754, right: 390, bottom: 844 })).toEqual({ top: 56, bottom: 754 - m, left: m, right: 390 - m });
        // 1024 × 768 by touch: the same bar
        expect(touchBubbleBounds(56, { width: 1024, height: 768 }, { left: 0, top: 712, right: 1024, bottom: 768 }).bottom).toBe(712 - m);
        // a phone held sideways: the navigation on the left side, the bubble right of it, down to the window's bottom
        expect(touchBubbleBounds(44, sideways, { left: 0, top: 0, right: 76, bottom: 390 })).toEqual({ top: 44, bottom: 390 - m, left: 76 + m, right: 844 - m });
    });

    it('below the tab where it fits there whole, its arrow on the tab (§33: 1)', () => {
        expect(touchBubbleSide(tab(500, 100), 200, 90, bounds(44))).toEqual({ side: 'below', room: 390 - m - 126 });
        expect(touchBubbleBox('below', tab(500, 190), { width: 240, height: 150 }, bounds(44))).toEqual({ left: 410, top: 216, arrow: 120, maxHeight: 390 - 216 - m });
    });

    it('above the tab where it fits only there whole, its bottom 8 px over the tab, the arrow on it (§33: 2)', () => {
        // 160 px: 148 below the tab, 230 above it (down from 8 px under the bar)
        expect(touchBubbleSide(tab(500, 290), 160, 90, bounds(44))).toEqual({ side: 'above', room: 290 - 8 - 44 - m });
        const box = touchBubbleBox('above', tab(500, 290), { width: 240, height: 160 }, bounds(44));
        expect(box).toEqual({ left: 410, top: 290 - 8 - 160, arrow: 120, maxHeight: 290 - 8 - 44 - m });
        // the bubble may cover its card (a tab on the card's bottom edge), never the bar: room only from 8 px under it
        expect(touchBubbleSide(tab(500, 120), 100, 90, bounds(44)).side).toBe('below');
    });

    it('whole on neither side: the side with more room, as tall as that, one name at least (§33: 3)', () => {
        // 300 px: 148 below, 230 above
        expect(touchBubbleSide(tab(500, 290), 300, 90, bounds(44))).toEqual({ side: 'above', room: 230 });
        const above = touchBubbleBox('above', tab(500, 290), { width: 240, height: 230 }, bounds(44));
        expect(above.top).toBe(44 + m);
        expect(above.top + above.maxHeight).toBe(290 - 8);
        // more room below: below; the same room: below
        expect(touchBubbleSide(tab(500, 150), 300, 90, bounds(44))).toEqual({ side: 'below', room: 390 - m - 176 });
        expect(touchBubbleSide(tab(500, 208), 400, 90, bounds(44))).toEqual({ side: 'below', room: 148 });
    });

    it('not even one name fits on either side: no bubble, the person\'s menu (§38)', () => {
        // a window 160 px high, the bar 44 px: 108 px at most on a side
        const low = touchBubbleBounds(44, { width: 844, height: 160 }, null);
        expect(touchBubbleSide(tab(500, 80), 300, 120, low).side).toBe('menu');
        expect(touchBubbleSide(tab(500, 80), 300, 40, low).side).toBe('below');
    });

    it('never over the bottom navigation: its room ends 8 px over the bar, whole above the tab where that bar takes the room below (§34)', () => {
        const b = touchBubbleBounds(56, phone, { left: 0, top: 754, right: 390, bottom: 844 });
        // the tab 60 px over the bar: 26 px below, the bubble above the tab
        const t = { left: 150, right: 210, top: 694, bottom: 712 };
        expect(touchBubbleSide(t, 200, 90, b)).toEqual({ side: 'above', room: 694 - 8 - 56 - m });
        // below a tab higher up: down to 8 px over the bar
        expect(touchBubbleBox('below', { left: 150, right: 210, top: 300, bottom: 318 }, { width: 240, height: 500 }, b).maxHeight).toBe(754 - m - 326);
    });

    it('pushed in sideways to 8 px from the window\'s edges or right of the navigation on the left, the arrow kept on the tab', () => {
        const r = touchBubbleBox('below', tab(760, 190), { width: 240, height: 100 }, bounds(44));
        expect(r.left).toBe(844 - m - 240);
        expect(r.arrow).toBe(790 - r.left);
        expect(touchBubbleBox('below', tab(-20, 190), { width: 240, height: 100 }, bounds(44)).left).toBe(m);
        const rail = touchBubbleBounds(44, sideways, { left: 0, top: 0, right: 76, bottom: 390 });
        const at = touchBubbleBox('above', tab(90, 290), { width: 240, height: 100 }, rail);
        expect(at.left).toBe(76 + m);
        expect(at.arrow).toBe(120 - at.left);
    });

    it('never over the top bar: a tab under it has the bubble start at the bar\'s bottom, away from the tab, without its arrow', () => {
        const under = touchBubbleBox('below', tab(500, 30), { width: 240, height: 100 }, bounds(52));
        expect(under.top).toBe(56);
        expect(under.noArrow).toBeUndefined();
        // the tab's bottom 2 px under the bar: the bubble 8 px under the tab still
        expect(touchBubbleBox('below', tab(500, 36), { width: 240, height: 100 }, bounds(52)).top).toBe(62);
        const hidden = touchBubbleBox('below', tab(500, 10), { width: 240, height: 100 }, bounds(52));
        expect(hidden.top).toBe(52);
        expect(hidden.noArrow).toBe(true);
        expect(hidden.maxHeight).toBe(390 - 52 - m);
        // no room above a tab under the bar
        expect(touchBubbleSide(tab(500, 10), 400, 90, bounds(52)).side).toBe('below');
    });

    it('never moved over its own tab (round 4\'s move up at the window\'s bottom is gone): a tab at the bottom has it above', () => {
        // the tab's bottom edge 4 px over the window's: no room below, the bubble above with its arrow
        const t = tab(500, 368);
        const { side } = touchBubbleSide(t, 150, 90, bounds(44));
        expect(side).toBe('above');
        const box = touchBubbleBox('above', t, { width: 240, height: 150 }, bounds(44));
        expect(box.top + 150).toBe(368 - 8);
        expect(box.noArrow).toBeUndefined();
    });
});

describe('a low window by touch lists 4 names at most (round 4 §30)', () => {
    it('in proportion, one a group at least, then fewer while it does not fit', () => {
        const sizes = [9, 3];
        const start = bubbleNameCounts(sizes, BUBBLE_LOW_WINDOW_NAMES).map((n, i) => Math.min(n, bubbleNameCounts(sizes)[i]));
        expect(start).toEqual([3, 1]);
        expect(bubbleNamesToFit(sizes, start, () => true)).toEqual([3, 1]);
        expect(bubbleNamesToFit(sizes, start, c => c[0] + c[1] <= 2)).toEqual([1, 1]);
    });

    it('by touch fewer down to one name in all, never none (round 5 §38): the first group keeps it', () => {
        const sizes = [9, 3];
        expect(bubbleNamesToFit(sizes, [3, 1], c => c[0] + c[1] <= 1, 1)).toEqual([1, 0]);
        expect(bubbleNamesToFit(sizes, [3, 1], () => false, 1)).toEqual([1, 0]);
        expect(bubbleNamesToFit([2, 1, 1], [2, 1, 1], c => c[0] + c[1] + c[2] <= 2, 1)).toEqual([1, 1, 0]);
        // a mouse keeps one a group
        expect(bubbleNamesToFit(sizes, [3, 1], () => false)).toEqual([1, 1]);
    });
});

describe('a bubble\'s box on the screen (round 3 §24: whole in the window, 8 px from its edges)', () => {
    const vp = { width: 1200, height: 900 };
    const room = { top: 100, bottom: 892 };
    const tab = (left: number, top: number) => ({ left, right: left + 60, top, bottom: top + 18 });
    const card = (left: number, top: number) => ({ left, right: left + 188, top });
    const m = BUBBLE_WINDOW_MARGIN;

    it('above and below: centred on the tab, 8 px from it, the arrow at the tab\'s middle', () => {
        const above = bubbleBox('above', tab(500, 500), card(470, 509), { width: 240, height: 200 }, room, vp);
        expect(above).toEqual({ left: 410, top: 292, arrow: 120 });
        const below = bubbleBox('below', tab(500, 500), card(470, 509), { width: 240, height: 200 }, room, vp);
        expect(below).toEqual({ left: 410, top: 526, arrow: 120 });
    });

    it('beside the card: its top at the card\'s top, 10 px from the card', () => {
        const right = bubbleBox('right', tab(500, 300), card(470, 309), { width: 240, height: 200 }, room, vp);
        expect(right).toEqual({ left: 668, top: 309, arrow: 0 });
        const left = bubbleBox('left', tab(500, 300), card(470, 309), { width: 240, height: 200 }, room, vp);
        expect(left).toEqual({ left: 220, top: 309, arrow: 0 });
    });

    it('never past the window: pushed in to 8 px from each edge, the arrow kept on the tab', () => {
        // a tab near the right edge: the bubble pushed left, the arrow moves right with the tab
        const r = bubbleBox('above', tab(1150, 500), card(1100, 509), { width: 240, height: 200 }, room, vp);
        expect(r.left).toBe(vp.width - m - 240);
        expect(r.arrow).toBe(1180 - r.left);
        // a tab at the left edge: the arrow stays 12 px inside the bubble's corner
        const l = bubbleBox('above', tab(0, 500), card(0, 509), { width: 240, height: 200 }, room, vp);
        expect(l.left).toBe(m);
        expect(l.arrow).toBe(22);
        expect(bubbleBox('above', tab(-80, 500), card(-80, 509), { width: 240, height: 200 }, room, vp).arrow).toBe(12);
        // below a tab near the bottom: moved up until whole, 8 px over the bottom
        const b = bubbleBox('below', tab(500, 800), card(470, 809), { width: 240, height: 300 }, room, vp);
        expect(b.top).toBe(vp.height - m - 300);
        // above a tab near the top: moved down to 8 px under the top
        expect(bubbleBox('above', tab(500, 60), card(470, 69), { width: 240, height: 300 }, room, vp).top).toBe(m);
        // beside a card at the right edge: pushed back into the window
        expect(bubbleBox('right', tab(1100, 300), card(1000, 309), { width: 240, height: 200 }, room, vp).left).toBe(vp.width - m - 240);
    });

    it('moved over its own tab to stay whole in the window: no arrow; an arrow wherever it stays clear of the tab', () => {
        // a phone held sideways, by touch: a bubble 231 tall below a tab in the middle, moved up over the tab
        const low = { top: 44, bottom: 382 };
        const sideways = { width: 844, height: 390 };
        const over = bubbleBox('below', tab(500, 190), card(470, 199), { width: 240, height: 231 }, low, sideways);
        expect(over.top).toBe(390 - m - 231);
        expect(over.noArrow).toBe(true);
        // above a tab near the top, moved down over it
        expect(bubbleBox('above', tab(500, 60), card(470, 69), { width: 240, height: 300 }, room, vp).noArrow).toBe(true);
        // moved up, but still below the tab: the arrow stays
        const up = bubbleBox('below', tab(500, 30), card(470, 39), { width: 240, height: 330 }, low, sideways);
        expect(up.top).toBe(390 - m - 330);
        expect(up.noArrow).toBeUndefined();
        // in its place, and beside the card: the arrow stays
        expect(bubbleBox('below', tab(500, 500), card(470, 509), { width: 240, height: 200 }, room, vp).noArrow).toBeUndefined();
        expect(bubbleBox('right', tab(320, 251), card(300, 260), { width: 247, height: 292 }, low, sideways).noArrow).toBeUndefined();
    });

    it('beside the card moved up: the arrow stays at the card\'s top', () => {
        // a phone held sideways: room 44 to 382, a bubble 292 tall beside a card at 260
        const low = { top: 44, bottom: 382 };
        const box = bubbleBox('right', tab(320, 251), card(300, 260), { width: 247, height: 292 }, low, { width: 844, height: 390 });
        expect(box.top).toBe(besideTop(260, 292, low));
        expect(box.top + 292).toBeLessThanOrEqual(390 - m);
        expect(box.arrow).toBe(260 - box.top);
    });
});

describe('the names in a tab\'s bubble', () => {
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

    it('all of them up to the maximum (8): no "and n more"', () => {
        expect(BUBBLE_MAX_NAMES).toBe(8);
        expect(bubbleNameCounts([3, 5])).toEqual([3, 5]);
        expect(bubbleNameCounts([8])).toEqual([8]);
        expect(bubbleNameCounts([2, 0, 1])).toEqual([2, 0, 1]);
    });

    it('above it 8 in all, each group in proportion to its size', () => {
        expect(bubbleNameCounts([12])).toEqual([8]);
        expect(bubbleNameCounts([10, 10])).toEqual([4, 4]);
        expect(bubbleNameCounts([12, 4])).toEqual([6, 2]);
        expect(bubbleNameCounts([9, 0, 3])).toEqual([6, 0, 2]);
        for (const sizes of [[5, 4], [7, 2, 1], [20, 1, 1, 1], [3, 3, 3], [1, 1, 1, 1, 1, 1, 1, 1, 1]]) {
            const out = bubbleNameCounts(sizes);
            expect(sum(out), String(sizes)).toBe(8);
            out.forEach((n, i) => expect(n, String(sizes)).toBeLessThanOrEqual(sizes[i]));
        }
    });

    it('every group with names keeps one at least', () => {
        expect(bubbleNameCounts([20, 1, 1])).toEqual([6, 1, 1]);
        expect(bubbleNameCounts([30, 1, 0, 2])).toEqual([6, 1, 0, 1]);
        const out = bubbleNameCounts([40, 1, 1, 1, 1, 1, 1]);
        expect(out.slice(1).every(n => n === 1)).toBe(true);
        expect(sum(out)).toBe(8);
    });

    it('more groups than places: the first eight one name each', () => {
        expect(bubbleNameCounts([2, 2, 2, 2, 2, 2, 2, 2, 2, 2])).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 0, 0]);
    });

    describe('fewer in a low window (round 3 §17, §25)', () => {
        // a bubble: header, "and n more", what a click does (130 px), 29 px a name
        const heightOf = (counts: number[]) => 130 + 29 * sum(counts);
        const fitting = (room: number) => (counts: number[]) => heightOf(counts) <= room;

        it('a large window: the names it lists at most, unchanged', () => {
            expect(bubbleNamesToFit([12], [8], fitting(884))).toEqual([8]);
            expect(bubbleNamesToFit([12, 4], [6, 2], fitting(884))).toEqual([6, 2]);
            expect(bubbleNamesToFit([3, 2], [3, 2], fitting(884))).toEqual([3, 2]);
        });

        it('as many names as the window\'s height lets the bubble have', () => {
            // 374 px (390 less 8 above and below): 8 names (362) fit; 340 px: 7 (333); 300 px: 5 (275)
            expect(bubbleNamesToFit([12], [8], fitting(374))).toEqual([8]);
            expect(bubbleNamesToFit([12], [8], fitting(340))).toEqual([7]);
            expect(bubbleNamesToFit([12], [8], fitting(300))).toEqual([5]);
            for (let room = 160; room <= 400; room += 7) {
                const out = bubbleNamesToFit([12], [8], fitting(room));
                expect(heightOf(out), String(room)).toBeLessThanOrEqual(room);
                if (out[0] < 8) expect(heightOf([out[0] + 1]), String(room)).toBeGreaterThan(room);
            }
        });

        it('each group in proportion, one name a group at least', () => {
            expect(bubbleNamesToFit([12, 4], [6, 2], fitting(130 + 29 * 4))).toEqual([3, 1]);
            expect(bubbleNamesToFit([12, 4], [6, 2], fitting(130 + 29 * 2))).toEqual([1, 1]);
            expect(bubbleNamesToFit([20, 1, 1], [6, 1, 1], fitting(130 + 29 * 5))).toEqual([3, 1, 1]);
            // all names listed (no "and n more" before): fewer, in proportion
            expect(bubbleNamesToFit([4, 4], [4, 4], fitting(130 + 29 * 6))).toEqual([3, 3]);
            expect(bubbleNamesToFit([2, 0, 1], [2, 0, 1], fitting(130 + 29 * 2))).toEqual([1, 0, 1]);
        });

        it('never more of a group than the bubble lists at most', () => {
            for (let n = 2; n <= 8; n++) {
                const out = bubbleNamesToFit([9, 3, 1], bubbleNameCounts([9, 3, 1]), fitting(130 + 29 * n));
                out.forEach((c, i) => expect(c).toBeLessThanOrEqual(bubbleNameCounts([9, 3, 1])[i]));
                expect(out.every(c => c >= 1)).toBe(true);
            }
        });

        it('not even one name a group fits: that least (the window cuts the bubble)', () => {
            expect(bubbleNamesToFit([12, 4], [6, 2], fitting(100))).toEqual([1, 1]);
            expect(bubbleNamesToFit([12], [8], () => false)).toEqual([1]);
        });
    });
});
