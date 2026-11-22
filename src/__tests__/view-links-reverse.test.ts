/**
 * Linked in the view only, the other way round: a hypothesis says a person
 * off the tree is the child of a family in it. The child's family (partner,
 * children: its whole group) is shown under the parents as one more child —
 * a `parent` link (anchor: a parent in the tree). Its shape and state, the
 * list's counts (a row switched on that the tree cannot draw is not counted
 * as shown), a record kept in the older shape, the layout and the
 * relationship the view makes. Invented data only
 * (e2e/fixtures/research-hypothesis-reverse.ged).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    ViewLink, ViewLinkChoice, activeViewLinks, loadViewLinks, migrateViewLinks, resolveViewLink, resolveViewLinks,
    sanitizeViewLinks, saveViewLinks, showViewLink, viewLinkCandidates, viewLinkChildOf, viewLinkContext, viewLinkCounts,
    viewLinkHolder, viewLinkIsland, viewLinkTreeSide, viewLinksKey, viewLinksToDraw,
} from '../view-links.js';
import { buildViewLayer, runLayoutPipeline } from '../layout/pipeline/index.js';
import { viewOnlyRelationship } from '../view-link-kinship.js';
import { Person, PersonId, StromData } from '../types.js';
import { DEFAULT_LAYOUT_CONFIG } from '../layout-config.js';
import { loadHypothesisLinksTree } from './helpers/hypothesis-links-fixture.js';

const REVERSE_GED = readFileSync(new URL('../../e2e/fixtures/research-hypothesis-reverse.ged', import.meta.url), 'utf8');
const { data: TREE, id } = loadHypothesisLinksTree(REVERSE_GED);
const PAVEL = id('P0001'), VERA = id('P0002'), BOHUMIL = id('P0010'), HEDVIKA = id('P0011');
const ONDREJ = id('P0200'), LIBUSE = id('P0201'), ZDENEK = id('P0202');

const A: ViewLinkChoice = { hypo: 'H0048', variant: 'A', kind: 'parent', anchorId: BOHUMIL, coParentId: HEDVIKA, islandIds: [ONDREJ] };
const B: ViewLinkChoice = { hypo: 'H0048', variant: 'B', kind: 'parent', anchorId: BOHUMIL, islandIds: [ONDREJ] };
/** The record of variant A as the app kept it before the child's family could be shown under parents in the tree. */
const OLD_A: ViewLink = { hypo: 'H0048', variant: 'A', kind: 'child', anchorId: ONDREJ, islandIds: [BOHUMIL, HEDVIKA], on: true, addedAt: 7 };

const link = (c: ViewLinkChoice, over: Partial<ViewLink> = {}): ViewLink => ({ ...c, on: true, addedAt: 1, ...over });
const state = (data: StromData, l: ViewLink) => resolveViewLink(data, l, viewLinkContext(data));

function changed(edit: (d: StromData) => void): StromData {
    const d = structuredClone(TREE);
    edit(d);
    return d;
}

function addPerson(d: StromData, pid: string, over: Partial<Person>): PersonId {
    d.persons[pid as PersonId] = { id: pid as PersonId, firstName: 'X', lastName: 'Y', gender: 'male', partnerships: [], parentIds: [], childIds: [], ...over } as Person;
    return pid as PersonId;
}

function memoryStorage(): Storage {
    const store = new Map<string, string>();
    return {
        get length() { return store.size; },
        clear: () => store.clear(),
        getItem: (k: string) => store.get(k) ?? null,
        key: (i: number) => [...store.keys()][i] ?? null,
        removeItem: (k: string) => { store.delete(k); },
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
    };
}

describe('the shape: who is off the tree decides the direction', () => {
    it('a child off the tree, both parents in it: the child\'s family under the parents (anchor the father, the mother beside)', () => {
        const offers = viewLinkCandidates(TREE).filter(c => c.hypo === 'H0048');
        expect(offers.map(({ state: _s, ...c }) => c)).toEqual([A, B]);
        expect(offers.every(c => c.state === 'draw')).toBe(true);
        expect(viewLinkTreeSide(A)).toEqual([BOHUMIL, HEDVIKA]);
        expect(viewLinkChildOf(A)).toEqual({ child: ONDREJ, parents: [BOHUMIL, HEDVIKA] });
        expect(viewLinkChildOf(OLD_A)).toEqual({ child: ONDREJ, parents: [BOHUMIL, HEDVIKA] });
    });

    it('the family shown is the child\'s whole group: Ondřej, his partner and his son', () => {
        expect(viewLinkIsland(TREE, A).sort()).toEqual([ONDREJ, LIBUSE, ZDENEK].sort());
    });

    it('the hypothesis opens at the child (the research holds it there)', () => {
        expect(viewLinkHolder(TREE, A)).toBe(ONDREJ);
    });

    it('a record of the new kind survives storage, a broken second parent drops it', () => {
        expect(sanitizeViewLinks([link(A)])).toEqual([link(A)]);
        expect(sanitizeViewLinks([{ ...link(A), coParentId: ONDREJ }])).toEqual([]);
        expect(sanitizeViewLinks([{ ...link(A), coParentId: BOHUMIL }])).toEqual([]);
        expect(sanitizeViewLinks([{ ...link(B), islandIds: [ONDREJ, LIBUSE] }])).toEqual([]);
    });
});

describe('the state of a `parent` link', () => {
    it('drawn while the child is off the tree', () => {
        expect(state(TREE, link(A))).toEqual({ state: 'draw' });
        expect(state(TREE, link(B))).toEqual({ state: 'draw' });
    });

    it('real once the parents have the child (linked by hand)', () => {
        const data = changed(d => {
            const fam = Object.values(d.partnerships).find(u => u.childIds.includes(PAVEL))!;
            fam.childIds.push(ONDREJ);
            d.persons[ONDREJ].parentIds.push(BOHUMIL, HEDVIKA);
            d.persons[BOHUMIL].childIds.push(ONDREJ);
            d.persons[HEDVIKA].childIds.push(ONDREJ);
        });
        expect(state(data, link(A))).toEqual({ state: 'real' });
    });

    it('the child\'s family joined to the tree another way: already in the tree, nothing drawn twice', () => {
        const data = changed(d => {
            // Ondřej's son Zdeněk is Věra's child in the tree's data: the family is linked already.
            d.persons[ZDENEK].parentIds.push(VERA);
            d.persons[VERA].childIds.push(ZDENEK);
        });
        expect(state(data, link(A))).toEqual({ state: 'invalid', reason: 'joined' });
        expect(viewLinksToDraw(data, { viewMode: 'family', links: [link(A)], master: true })).toEqual([]);
    });

    it('the child has a real father of its own: no second father is shown', () => {
        const data = changed(d => {
            const f = addPerson(d, 'p_other_father', { firstName: 'Jiný', lastName: 'Otec', gender: 'male', childIds: [ONDREJ] });
            d.persons[ONDREJ].parentIds.push(f);
        });
        expect(state(data, link(A))).toEqual({ state: 'invalid', reason: 'hasParents' });
    });

    it('a person gone: the second parent counts too', () => {
        const data = changed(d => { delete d.persons[HEDVIKA]; });
        expect(state(data, link(A))).toEqual({ state: 'invalid', reason: 'personGone' });
    });
});

describe('what the tree draws and what the list counts', () => {
    it('a `parent` link is drawn: its anchor is in the tree', () => {
        const resolved = resolveViewLinks(TREE, [link(A)]);
        const drawn = activeViewLinks(TREE, resolved, true);
        expect(drawn).toHaveLength(1);
        expect(viewLinkCounts(resolved, drawn)).toEqual({ on: 1, drawable: 1, invalid: 0, unreached: 0 });
    });

    it('a chained link whose family it hangs on is not shown: drawable and on, but nothing in the tree leads to it — not counted as shown', () => {
        const { data, id: hid } = loadHypothesisLinksTree();
        const chained: ViewLink = { hypo: 'H0030', variant: 'A', kind: 'child', anchorId: hid('P0128'), islandIds: [hid('P0150')], on: true, addedAt: 2 };
        const resolved = resolveViewLinks(data, [chained]);
        expect(resolved[0].state).toBe('draw');
        const drawn = activeViewLinks(data, resolved, true);
        expect(drawn).toEqual([]);
        expect(viewLinkCounts(resolved, drawn)).toEqual({ on: 0, drawable: 1, invalid: 0, unreached: 1 });
        // Without what the tree draws, the old count stays (switched on = on).
        expect(viewLinkCounts(resolved).on).toBe(1);
    });

    it('the old record read without the tree\'s data (no migration): its variant no longer has that shape, never counted as shown', () => {
        const resolved = resolveViewLinks(TREE, [OLD_A]);
        expect(resolved[0]).toMatchObject({ state: 'invalid', reason: 'noLink' });
        expect(viewLinkCounts(resolved, activeViewLinks(TREE, resolved, true)).on).toBe(0);
    });

    it('showing variant B over A rewrites the one record of the hypothesis', () => {
        const change = showViewLink(TREE, [link(A)], B, 5);
        expect(change.links).toEqual([{ ...B, on: true, addedAt: 5 }]);
        expect(change.removed).toEqual([]);
    });
});

describe('a record kept in the older shape', () => {
    it('becomes the `parent` record of the same people, its switch and time kept', () => {
        const out = migrateViewLinks(TREE, [OLD_A]);
        expect(out).toEqual([{ ...A, on: true, addedAt: 7 }]);
        expect(resolveViewLinks(TREE, out)[0].state).toBe('draw');
        expect(activeViewLinks(TREE, resolveViewLinks(TREE, out), true)).toHaveLength(1);
    });

    it('a switched-off old record stays off', () => {
        expect(migrateViewLinks(TREE, [{ ...OLD_A, on: false }])[0]).toEqual({ ...A, on: false, addedAt: 7 });
    });

    it('records that already have their shape: the same array, untouched', () => {
        const links = [link(A)];
        expect(migrateViewLinks(TREE, links)).toBe(links);
        const { data: other, id: otherId } = loadHypothesisLinksTree();
        const b: ViewLink = { hypo: 'H0022', variant: 'B', kind: 'child', anchorId: otherId('P0010'), islandIds: [otherId('P0125'), otherId('P0126')], on: true, addedAt: 1 };
        const chained: ViewLink = { hypo: 'H0030', variant: 'A', kind: 'child', anchorId: otherId('P0128'), islandIds: [otherId('P0150')], on: true, addedAt: 2 };
        const kept = [b, chained];
        expect(migrateViewLinks(other, kept)).toBe(kept);
    });

    it('a variant that no longer says so: kept as it was (it resolves as no longer valid, nothing is lost)', () => {
        const data = changed(d => {
            for (const p of Object.values(d.persons)) for (const h of p.research?.hypotheses ?? []) {
                for (const v of h.variants ?? []) v.links = [];
            }
        });
        expect(migrateViewLinks(data, [OLD_A])).toEqual([OLD_A]);
        expect(state(data, OLD_A)).toEqual({ state: 'invalid', reason: 'noLink' });
    });

    describe('in storage', () => {
        let store: Storage;
        beforeEach(() => {
            store = memoryStorage();
            vi.stubGlobal('localStorage', store);
        });
        afterEach(() => vi.unstubAllGlobals());

        it('read with the tree\'s data: brought to the new shape and kept so', () => {
            store.setItem(viewLinksKey('t1'), JSON.stringify([OLD_A]));
            expect(loadViewLinks('t1')).toEqual([OLD_A]);
            expect(loadViewLinks('t1', TREE)).toEqual([{ ...A, on: true, addedAt: 7 }]);
            expect(JSON.parse(store.getItem(viewLinksKey('t1'))!)).toEqual([{ ...A, on: true, addedAt: 7 }]);
        });

        it('nothing to change: storage is not written', () => {
            saveViewLinks('t1', [link(A)]);
            const spy = vi.spyOn(store, 'setItem');
            loadViewLinks('t1', TREE);
            expect(spy).not.toHaveBeenCalled();
        });
    });
});

describe('laid out', () => {
    const layout = (data: StromData, focus: PersonId, links: ViewLink[]) => runLayoutPipeline({
        data, focusPersonId: focus, config: DEFAULT_LAYOUT_CONFIG,
        ancestorDepth: 8, descendantDepth: 8,
        includeSpouseAncestors: true, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy: { mode: 'standard', autoExpand: true },
        viewLinks: links,
    });

    it('the derived data: Ondřej one more child of the couple, his family ghosts, the tree\'s data untouched', () => {
        const before = JSON.stringify(TREE);
        const layer = buildViewLayer(TREE, [link(A)])!;
        const fam = Object.values(layer.data.partnerships).find(u => u.childIds.includes(PAVEL))!;
        expect(fam.childIds).toContain(ONDREJ);
        expect(layer.data.persons[ONDREJ].parentIds.sort()).toEqual([BOHUMIL, HEDVIKA].sort());
        expect([...layer.ghostOf.keys()].sort()).toEqual([ONDREJ, LIBUSE, ZDENEK].sort());
        expect(layer.childAnchors.get(ONDREJ)?.hypo).toBe('H0048');
        expect(JSON.stringify(TREE)).toBe(before);
    });

    it('one parent (variant B): a family of Bohumil and a "?" stand-in, never Hedvika\'s', () => {
        const layer = buildViewLayer(TREE, [link(B)])!;
        const fam = Object.values(layer.data.partnerships).find(u => u.childIds.includes(ONDREJ))!;
        expect([fam.person1Id, fam.person2Id]).toContain(BOHUMIL);
        expect([fam.person1Id, fam.person2Id]).not.toContain(HEDVIKA);
        const other = fam.person1Id === BOHUMIL ? fam.person2Id : fam.person1Id;
        expect(layer.data.persons[other].isPlaceholder).toBe(true);
    });

    it('focus Pavel: Ondřej stands beside his siblings under the parents, his drop is virtual, his family ghosts', () => {
        const r = layout(TREE, PAVEL, [link(A)]);
        const pos = (pid: PersonId) => r.positions.get(pid);
        expect(pos(ONDREJ)).toBeDefined();
        expect(pos(ONDREJ)!.y).toBe(pos(PAVEL)!.y);
        expect(pos(LIBUSE)).toBeDefined();
        const conn = r.connections.find(c => c.drops.some(d => d.personId === ONDREJ))!;
        expect(conn.drops.find(d => d.personId === ONDREJ)!.view).toBe('virtual');
        // The parents' own line to Pavel and Věra stays theirs.
        expect(conn.view).toBeUndefined();
        expect(conn.drops.find(d => d.personId === PAVEL)!.view).toBeUndefined();
        expect([...r.viewLayer!.ghostIds]).toEqual(expect.arrayContaining([ONDREJ, LIBUSE]));
        expect(r.viewLayer!.ghostIds.has(BOHUMIL)).toBe(false);
        expect(r.viewLayer!.ghostIds.has(PAVEL)).toBe(false);
    });

    it('the old record drawn through the Family view once migrated (viewLinksToDraw reads the records given)', () => {
        expect(viewLinksToDraw(TREE, { viewMode: 'family', links: [OLD_A], master: true })).toEqual([]);
        expect(viewLinksToDraw(TREE, { viewMode: 'family', links: migrateViewLinks(TREE, [OLD_A]), master: true })).toHaveLength(1);
        expect(viewLinksToDraw(TREE, { viewMode: 'fan', links: [link(A)], master: true })).toEqual([]);
    });
});

describe('the relationship the view makes', () => {
    it('Pavel and Zdeněk: only through H0048 A — nephew in the view, no real connection', () => {
        const rel = viewOnlyRelationship(TREE, [link(A)], PAVEL, ZDENEK);
        expect(rel).not.toBeNull();
        expect(rel!.via.map(l => l.hypo)).toEqual(['H0048']);
        expect(viewOnlyRelationship(TREE, [link(A)], PAVEL, VERA)).toBeNull();
    });
});
