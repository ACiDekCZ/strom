/**
 * The card's children tab (hiddenRelativesTabs): "▸ children" while any
 * child is out of view, "▾ children" (childrenShown) while the view shows the
 * person's children in place; "?" stand-ins never count.
 */

import { describe, it, expect } from 'vitest';
import { hiddenRelativesTabs, hiddenChildIds, newlyShownChildIds, childrenDrawnElsewhere, siblingOrderMark, childrenShownClosing, siblingsTabState, newlyShownSiblingIds, siblingGroups, unionChildIdSet, hiddenPartnerIds, childrenByUnion, childrenComeWithPartners, otherFamilyChildrenElsewhere, HiddenRelativesTab } from '../marriage-order.js';
import { tabsForm, tabGlyph, tabLabel, tabKindClass, branchTabRestHtml } from '../union-order-measure.js';
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
