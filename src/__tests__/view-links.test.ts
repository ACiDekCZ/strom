/**
 * Linked in the view only: the records of what the user showed (a device
 * setting of the tree), their rules (one record per hypothesis, one place per
 * family, chained links), what each is against the data now (draw / real /
 * invalid with its reason), what can be shown, and when the feature shows at
 * all. Nothing of it touches the tree's data or any export. Invented data only
 * (e2e/fixtures/research-hypothesis-links.ged).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    ViewLink, ViewLinkChoice, sanitizeViewLinks, loadViewLinks, saveViewLinks, isViewLinksMaster, setViewLinksMaster,
    forgetViewLinks, viewLinksPayload, restoreViewLinks, viewLinksKey, viewLinksMasterKey, VIEW_LINK_KEY_PREFIXES,
    researchHypotheses, isOpenHypothesis, viewLinkContext, viewLinkIsland, resolveViewLink, resolveViewLinks,
    activeViewLinks, viewLinkDependents, showViewLink, unlinkViewLink, setViewLinkOn, removeViewLinks,
    viewLinkCandidates, hasViewLinkData, viewLinksAvailable, HYPOTHESIS_LINKS_FEATURE,
    viewLinksTreeOfKey, viewLinkCounts, orderViewLinkRows, newlyInvalidViewLinks,
} from '../view-links.js';
import { strings, setLanguage } from '../strings.js';
import { buildTransferJson, readTransferJson, TransferMark } from '../research-transfer.js';
import { exportToGedcom } from '../ged-exporter.js';
import { buildPersonsCsv } from '../csv-export.js';
import { Person, PersonId, StromData, PartnershipId } from '../types.js';
import { loadHypothesisLinksTree, HYPOTHESIS_LINKS_GED } from './helpers/hypothesis-links-fixture.js';

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

const { data: TREE, id } = loadHypothesisLinksTree();
const VACLAV = id('P0010'), ROZALIE = id('P0011'), KAREL = id('P0001'), ANTONIN = id('P0012'), LUDMILA = id('P0013');
const JAKUB = id('P0125'), MARIE = id('P0126'), JOSEF = id('P0127'), TOMAS = id('P0128'), ANNA = id('P0129');
const JAN = id('P0130'), MARTIN = id('P0140'), VOJTECH = id('P0150');

const B: ViewLinkChoice = { hypo: 'H0022', variant: 'B', kind: 'child', anchorId: VACLAV, islandIds: [JAKUB, MARIE] };
const C: ViewLinkChoice = { hypo: 'H0022', variant: 'C', kind: 'child', anchorId: VACLAV, islandIds: [JAN] };
const ANTONIN_A: ViewLinkChoice = { hypo: 'H0028', variant: 'A', kind: 'child', anchorId: ANTONIN, islandIds: [JAKUB, MARIE] };
const TOMAS_A: ViewLinkChoice = { hypo: 'H0030', variant: 'A', kind: 'child', anchorId: TOMAS, islandIds: [VOJTECH] };
const PARTNER: ViewLinkChoice = { hypo: 'H0024', variant: 'A', kind: 'partners', anchorId: ROZALIE, islandIds: [MARTIN] };

const link = (c: ViewLinkChoice, over: Partial<ViewLink> = {}): ViewLink => ({ ...c, on: true, addedAt: 1, ...over });
const state = (data: StromData, l: ViewLink) => resolveViewLink(data, l, viewLinkContext(data));

/** A copy of the tree changed by `edit`. */
function changed(edit: (d: StromData) => void): StromData {
    const d = structuredClone(TREE);
    edit(d);
    return d;
}

/** Make `child` a real child of `parents` (a couple of them when two). */
function addParents(d: StromData, child: PersonId, parents: PersonId[]): void {
    d.persons[child].parentIds.push(...parents);
    for (const p of parents) d.persons[p].childIds.push(child);
    if (parents.length === 2) {
        const existing = Object.values(d.partnerships).find(u => parents.includes(u.person1Id) && parents.includes(u.person2Id));
        if (existing) existing.childIds.push(child);
    }
}

function addPerson(d: StromData, pid: string, over: Partial<Person>): PersonId {
    d.persons[pid as PersonId] = { id: pid as PersonId, firstName: 'X', lastName: 'Y', gender: 'male', partnerships: [], parentIds: [], childIds: [], ...over } as Person;
    return pid as PersonId;
}

function addCouple(d: StromData, a: PersonId, b: PersonId): void {
    const uid = `u_test_${a}_${b}` as PartnershipId;
    d.partnerships[uid] = { id: uid, person1Id: a, person2Id: b, childIds: [] } as never;
    d.persons[a].partnerships.push(uid);
    d.persons[b].partnerships.push(uid);
}

describe('the records on the device', () => {
    beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
    afterEach(() => vi.unstubAllGlobals());

    it('keep a tree\'s records and main switch under its own keys', () => {
        expect(loadViewLinks('t1')).toEqual([]);
        expect(isViewLinksMaster('t1')).toBe(true);
        saveViewLinks('t1', [link(B)]);
        setViewLinksMaster('t1', false);
        expect(localStorage.getItem('strom-view-links:t1')).toBe(JSON.stringify([link(B)]));
        expect(localStorage.getItem('strom-view-links-master:t1')).toBe('false');
        expect(viewLinksKey('t1')).toBe('strom-view-links:t1');
        expect(viewLinksMasterKey('t1')).toBe('strom-view-links-master:t1');
        expect(VIEW_LINK_KEY_PREFIXES).toEqual(['strom-view-links:', 'strom-view-links-master:']);
        expect(loadViewLinks('t1')).toEqual([link(B)]);
        expect(isViewLinksMaster('t1')).toBe(false);
        expect(loadViewLinks('t2')).toEqual([]);
        // the main switch on and no records: nothing stored
        setViewLinksMaster('t1', true);
        saveViewLinks('t1', []);
        expect(localStorage.length).toBe(0);
    });

    it('a deleted tree takes its keys along', () => {
        saveViewLinks('t1', [link(B)]);
        setViewLinksMaster('t1', false);
        saveViewLinks('t2', [link(C)]);
        forgetViewLinks('t1');
        expect(localStorage.getItem('strom-view-links:t1')).toBeNull();
        expect(localStorage.getItem('strom-view-links-master:t1')).toBeNull();
        expect(loadViewLinks('t2')).toEqual([link(C)]);
    });

    it('stored garbage reads as nothing, invalid records go, one record per hypothesis (the latest)', () => {
        localStorage.setItem('strom-view-links:t1', '{not json');
        expect(loadViewLinks('t1')).toEqual([]);
        const clean = sanitizeViewLinks([
            link(B, { addedAt: 5 }),
            link(C, { addedAt: 9 }),
            { ...link(B), hypo: 'X1' },
            { ...link(B), variant: 'b' },
            { ...link(B), kind: 'same' },
            { ...link(B), anchorId: '' },
            { ...link(B), islandIds: [] },
            { ...link(B), islandIds: [JAKUB, MARIE, JOSEF] },
            { ...link(PARTNER), islandIds: [MARTIN, JAN] },
            { ...link(B), islandIds: [VACLAV] },
            { ...link(PARTNER), on: 'yes', addedAt: -3 },
            null, 'x', 42,
        ]);
        expect(clean).toEqual([link(C, { addedAt: 9 }), link(PARTNER, { on: false, addedAt: 0 })]);
        expect(sanitizeViewLinks({ links: [] })).toEqual([]);
    });

    it('a backup and a moved tree carry them; restoring sets them for the new tree', () => {
        expect(viewLinksPayload('t1')).toBeNull();
        saveViewLinks('t1', [link(B), link(PARTNER, { on: false })]);
        expect(viewLinksPayload('t1')).toEqual({ links: [link(B), link(PARTNER, { on: false })] });
        setViewLinksMaster('t1', false);
        const payload = viewLinksPayload('t1');
        expect(payload).toEqual({ links: [link(B), link(PARTNER, { on: false })], master: false });
        restoreViewLinks('t9', JSON.parse(JSON.stringify(payload)));
        expect(loadViewLinks('t9')).toEqual(payload!.links);
        expect(isViewLinksMaster('t9')).toBe(false);
        // untrusted input: nothing valid, nothing stored
        restoreViewLinks('t8', { links: [{ hypo: 'nope' }], master: 'no' });
        restoreViewLinks('t8', 'garbage');
        expect(localStorage.getItem('strom-view-links:t8')).toBeNull();
        expect(isViewLinksMaster('t8')).toBe(true);
        // only the main switch off travels too
        saveViewLinks('t1', []);
        expect(viewLinksPayload('t1')).toEqual({ links: [], master: false });
    });

    it('the transfer file carries them after the tree; the research\'s head stays the mark', () => {
        const mark: TransferMark = { v: 1, token: 'abcdefghijklmnopqrstuvwxyz012345', from: 'safari', tree: 'Horákovi', persons: 14, at: '2026-10-09T08:00:00Z' };
        const payload = { links: [link(B)] };
        const text = buildTransferJson(mark, TREE, payload);
        expect(text.startsWith('{"stromTransfer":')).toBe(true);
        expect(text.endsWith(`"stromViewLinks":${JSON.stringify(payload)}}`)).toBe(true);
        const back = readTransferJson(text, mark.token)!;
        expect(back.viewLinks).toEqual(payload);
        expect(JSON.parse(back.json)).toEqual(JSON.parse(JSON.stringify(TREE)));
        // none: the file as before
        const plain = readTransferJson(buildTransferJson(mark, TREE), mark.token)!;
        expect(plain.viewLinks).toBeUndefined();
        expect(buildTransferJson(mark, TREE, null)).toBe(buildTransferJson(mark, TREE));
    });
});

describe('the research in the data', () => {
    it('the hypotheses by id, open or not', () => {
        const all = researchHypotheses(TREE);
        expect([...all.keys()].sort()).toEqual(['H0022', 'H0024', 'H0025', 'H0026', 'H0027', 'H0028', 'H0030']);
        expect(isOpenHypothesis(all.get('H0022')!)).toBe(true);
        expect(isOpenHypothesis(all.get('H0026')!)).toBe(false);
        expect(isOpenHypothesis(all.get('H0027')!)).toBe(false);
        expect(isOpenHypothesis({ title: 'x' })).toBe(true);
        expect(isOpenHypothesis({ title: 'x', status: 'paused' })).toBe(true);
    });

    it('the family a link shows: everyone joined to its people by real links', () => {
        expect(viewLinkIsland(TREE, B).sort()).toEqual([JAKUB, MARIE, JOSEF, TOMAS, ANNA].sort());
        expect(viewLinkIsland(TREE, C)).toEqual([JAN]);
        expect(viewLinkIsland(TREE, TOMAS_A)).toEqual([VOJTECH]);
    });

    it('what can be shown: open hypotheses, child and partners links, each with its state now', () => {
        const all = viewLinkCandidates(TREE);
        const key = (c: { hypo: string; variant: string }) => `${c.hypo} ${c.variant}`;
        expect(all.map(key).sort()).toEqual(['H0022 B', 'H0022 C', 'H0024 A', 'H0028 A', 'H0030 A']);
        expect(all.find(c => key(c) === 'H0022 B')).toEqual({ ...B, state: 'draw' });
        expect(all.find(c => key(c) === 'H0022 C')).toEqual({ ...C, state: 'draw' });
        // partners: the island side is the one whose island names the hypothesis
        expect(all.find(c => key(c) === 'H0024 A')).toEqual({ ...PARTNER, state: 'draw' });
        expect(all.find(c => key(c) === 'H0028 A')).toEqual({ ...ANTONIN_A, state: 'draw' });
        expect(all.find(c => key(c) === 'H0030 A')).toEqual({ ...TOMAS_A, state: 'draw' });
    });
});

describe('resolving a record against the data (every row of the table)', () => {
    it('draw: the variant links the same people and the family is still outside the tree', () => {
        expect(state(TREE, link(B))).toEqual({ state: 'draw' });
        expect(state(TREE, link(C))).toEqual({ state: 'draw' });
        expect(state(TREE, link(PARTNER))).toEqual({ state: 'draw' });
        // the same couple named as parents of no family (_PAR) instead of _FAM: still the same people
        const par = HYPOTHESIS_LINKS_GED.split('4 _PERS @P0010@\n4 _FAM @F0042@').join('4 _PERS @P0010@\n4 _PAR @P0126@\n4 _PAR @P0125@');
        const other = loadHypothesisLinksTree(par);
        expect(state(other.data, link({ ...B, anchorId: other.id('P0010'), islandIds: [other.id('P0125'), other.id('P0126')] }))).toEqual({ state: 'draw' });
    });

    it('real: the tree has the link — made by hand, or decided for the variant', () => {
        const byHand = changed(d => addParents(d, VACLAV, [JAKUB, MARIE]));
        expect(state(byHand, link(B))).toEqual({ state: 'real' });
        const partners = changed(d => addCouple(d, ROZALIE, MARTIN));
        expect(state(partners, link(PARTNER))).toEqual({ state: 'real' });
        // H0026 is decided for B and Rozálie's parents are real
        const decided: ViewLinkChoice = { hypo: 'H0026', variant: 'B', kind: 'child', anchorId: ROZALIE, islandIds: [ANTONIN, LUDMILA] };
        expect(state(TREE, link(decided))).toEqual({ state: 'real' });
    });

    it('decidedOther, cancelled, gone', () => {
        expect(state(TREE, link({ hypo: 'H0026', variant: 'A', kind: 'child', anchorId: ROZALIE, islandIds: [JAN] })))
            .toEqual({ state: 'invalid', reason: 'decidedOther' });
        const decidedForC = changed(d => {
            for (const p of Object.values(d.persons)) for (const h of p.research?.hypotheses ?? []) {
                if (h.id === 'H0022') { h.status = 'decided'; h.chosen = 'C'; }
            }
        });
        expect(state(decidedForC, link(B))).toEqual({ state: 'invalid', reason: 'decidedOther' });
        // decided for this variant, the tree not updated yet: still drawn
        expect(state(decidedForC, link(C))).toEqual({ state: 'draw' });
        expect(state(TREE, link({ hypo: 'H0027', variant: 'A', kind: 'child', anchorId: KAREL, islandIds: [JAN] })))
            .toEqual({ state: 'invalid', reason: 'cancelled' });
        expect(state(TREE, link({ ...B, hypo: 'H0099' }))).toEqual({ state: 'invalid', reason: 'gone' });
        const without = changed(d => { for (const p of Object.values(d.persons)) if (p.research) delete p.research.hypotheses; });
        expect(state(without, link(B))).toEqual({ state: 'invalid', reason: 'gone' });
    });

    it('noLink: the variant has no link (any more), or not to these people', () => {
        expect(state(TREE, link({ ...B, variant: 'A' }))).toEqual({ state: 'invalid', reason: 'noLink' });
        expect(state(TREE, link({ ...B, variant: 'D' }))).toEqual({ state: 'invalid', reason: 'noLink' });
        expect(state(TREE, link({ ...B, islandIds: [JAN] }))).toEqual({ state: 'invalid', reason: 'noLink' });
        expect(state(TREE, link({ ...PARTNER, kind: 'child' }))).toEqual({ state: 'invalid', reason: 'noLink' });
    });

    it('personGone: the child or a shown person is no longer in the tree', () => {
        expect(state(TREE, link({ ...B, anchorId: 'p_gone' as PersonId }))).toEqual({ state: 'invalid', reason: 'personGone' });
        const noMarie = changed(d => { delete d.persons[MARIE]; });
        expect(state(noMarie, link(B))).toEqual({ state: 'invalid', reason: 'personGone' });
    });

    it('joined: the family is in the tree another way', () => {
        // Anna of the island marries Antonín of the tree
        const joined = changed(d => addCouple(d, ANTONIN, ANNA));
        expect(state(joined, link(B))).toEqual({ state: 'invalid', reason: 'joined' });
        expect(state(joined, link(C))).toEqual({ state: 'draw' });
    });

    it('hasParents: a real parent in a role a shown parent takes ("?" stand-ins do not count)', () => {
        const father = changed(d => addParents(d, VACLAV, [addPerson(d, 'p_seb', { firstName: 'Šebestián', gender: 'male' })]));
        expect(state(father, link(B))).toEqual({ state: 'invalid', reason: 'hasParents' });
        expect(state(father, link(C))).toEqual({ state: 'invalid', reason: 'hasParents' });
        const mother = changed(d => addParents(d, VACLAV, [addPerson(d, 'p_mat', { firstName: 'Kateřina', gender: 'female' })]));
        expect(state(mother, link(B))).toEqual({ state: 'invalid', reason: 'hasParents' });
        // Jan alone takes the father's place: beside a real mother he can be shown
        expect(state(mother, link(C))).toEqual({ state: 'draw' });
        const unknown = changed(d => addParents(d, VACLAV, [addPerson(d, 'p_unk', { firstName: 'Alex', gender: 'unknown' })]));
        expect(state(unknown, link(C))).toEqual({ state: 'invalid', reason: 'hasParents' });
        const standIn = changed(d => addParents(d, VACLAV, [addPerson(d, 'p_q', { firstName: '?', isPlaceholder: true })]));
        expect(state(standIn, link(B))).toEqual({ state: 'draw' });
    });

    it('an invalid record is never removed: the data coming back draw it again', () => {
        const links = [link(B)];
        const gone = changed(d => { for (const p of Object.values(d.persons)) if (p.research) delete p.research.hypotheses; });
        expect(resolveViewLinks(gone, links)).toEqual([{ link: links[0], state: 'invalid', reason: 'gone' }]);
        expect(links).toEqual([link(B)]);
        expect(resolveViewLinks(TREE, links)).toEqual([{ link: links[0], state: 'draw' }]);
    });
});

describe('the list and keeping in step', () => {
    it('another window\'s storage change: the tree whose view links it is (any other key: null; storage cleared: every tree)', () => {
        expect(viewLinksTreeOfKey(viewLinksKey('t1'))).toBe('t1');
        expect(viewLinksTreeOfKey(viewLinksMasterKey('t-2'))).toBe('t-2');
        expect(viewLinksTreeOfKey('strom-settings')).toBeNull();
        expect(viewLinksTreeOfKey('strom-view-linksX')).toBeNull();
        expect(viewLinksTreeOfKey(null)).toBe('');
    });

    it('counts: drawable rows switched on (n) of the drawable ones (m), and the invalid ones', () => {
        const resolved = resolveViewLinks(TREE, [
            link(B), link(PARTNER, { on: false, addedAt: 2 }),
            link({ hypo: 'H0026', variant: 'B', kind: 'child', anchorId: ROZALIE, islandIds: [ANTONIN, LUDMILA] }, { addedAt: 3 }),
            link({ hypo: 'H0027', variant: 'A', kind: 'child', anchorId: KAREL, islandIds: [JAN] }, { addedAt: 4 }),
        ]);
        expect(viewLinkCounts(resolved)).toEqual({ on: 1, drawable: 2, invalid: 1 });
        expect(viewLinkCounts([])).toEqual({ on: 0, drawable: 0, invalid: 0 });
    });

    it('order: drawable by place in the view (top down, left to right; not drawn after, by time), then real, then invalid', () => {
        const real = link({ hypo: 'H0026', variant: 'B', kind: 'child', anchorId: ROZALIE, islandIds: [ANTONIN, LUDMILA] }, { addedAt: 1 });
        const bad = link({ hypo: 'H0027', variant: 'A', kind: 'child', anchorId: KAREL, islandIds: [JAN] }, { addedAt: 2 });
        const tomas = link(TOMAS_A, { addedAt: 3 });
        const partner = link(PARTNER, { addedAt: 4 });
        const b = link(B, { addedAt: 5 });
        const resolved = resolveViewLinks(TREE, [real, bad, tomas, partner, b]);
        const places = new Map<PersonId, { x: number; y: number }>([[VACLAV, { x: 300, y: 200 }], [ROZALIE, { x: 100, y: 200 }]]);
        expect(orderViewLinkRows(resolved, id => places.get(id)).map(r => r.link.hypo)).toEqual(['H0024', 'H0022', 'H0030', 'H0026', 'H0027']);
        places.set(VACLAV, { x: 300, y: 100 });
        expect(orderViewLinkRows(resolved, id => places.get(id)).map(r => r.link.hypo)).toEqual(['H0022', 'H0024', 'H0030', 'H0026', 'H0027']);
        // Nothing drawn: by the time chosen.
        expect(orderViewLinkRows(resolved, () => undefined).map(r => r.link.hypo)).toEqual(['H0030', 'H0024', 'H0022', 'H0026', 'H0027']);
        expect(resolved.map(r => r.link.hypo)).toEqual(['H0026', 'H0027', 'H0030', 'H0024', 'H0022']);
    });

    it('after a load: the records invalid now that held before (drawn or real), each with its reason', () => {
        const decidedForA = changed(d => {
            for (const p of Object.values(d.persons)) for (const h of p.research?.hypotheses ?? []) {
                if (h.id === 'H0022') { h.status = 'decided'; h.chosen = 'A'; }
            }
        });
        const bad = link({ hypo: 'H0027', variant: 'A', kind: 'child', anchorId: KAREL, islandIds: [JAN] }, { addedAt: 3 });
        const links = [link(B), link(PARTNER, { addedAt: 2 }), bad];
        const fresh = newlyInvalidViewLinks(TREE, decidedForA, links);
        expect(fresh.map(r => [r.link.hypo, r.reason])).toEqual([['H0022', 'decidedOther']]);
        // Back to the state before: nothing newly invalid; the same load again: nothing new either.
        expect(newlyInvalidViewLinks(decidedForA, TREE, links)).toEqual([]);
        expect(newlyInvalidViewLinks(decidedForA, decidedForA, links)).toEqual([]);
        expect(newlyInvalidViewLinks(TREE, decidedForA, [])).toEqual([]);
    });

    it('the list\'s count line in Czech: "1 zapnuté z 5", "2 zapnutá ze 3", "5 zapnutých ze 7", "z 10", "ze 12"', () => {
        setLanguage('cs');
        try {
            const c = strings.viewLinks.masterCount;
            expect(c(1, 5)).toBe('1 zapnuté z 5');
            expect(c(2, 3)).toBe('2 zapnutá ze 3');
            expect(c(5, 7)).toBe('5 zapnutých ze 7');
            expect(c(0, 1)).toBe('0 zapnutých z 1');
            expect(c(4, 10)).toBe('4 zapnutá z 10');
            expect(c(3, 12)).toBe('3 zapnutá ze 12');
            expect(c(3, 25)).toBe('3 zapnutá ze 25');
            expect(c(3, 58)).toBe('3 zapnutá z 58');
            expect(c(3, 100)).toBe('3 zapnutá ze 100');
            expect(strings.viewLinks.invalidAfterLoad(2)).toBe('2 připojení jen v zobrazení už neplatí');
        } finally {
            setLanguage('en');
        }
        expect(strings.viewLinks.masterCount(2, 3)).toBe('2 of 3 on');
        expect(strings.viewLinks.invalidAfterLoad(1)).toBe('1 view-only link is no longer valid');
        expect(strings.viewLinks.invalidAfterLoad(2)).toBe('2 view-only links are no longer valid');
    });
});

describe('what the tree draws', () => {
    it('drawn, switched on, the main switch on', () => {
        const links = [link(B), link(PARTNER, { on: false, addedAt: 2 })];
        const resolved = resolveViewLinks(TREE, links);
        expect(activeViewLinks(TREE, resolved, true)).toEqual([links[0]]);
        expect(activeViewLinks(TREE, resolved, false)).toEqual([]);
        const invalid = resolveViewLinks(TREE, [link({ ...B, variant: 'A' })]);
        expect(activeViewLinks(TREE, invalid, true)).toEqual([]);
    });

    it('a chained link draws only while the family it hangs on is drawn', () => {
        const chained = [link(TOMAS_A, { addedAt: 1 }), link(B, { addedAt: 2 })];
        // in the order chosen, the chained one even chosen first
        expect(activeViewLinks(TREE, resolveViewLinks(TREE, chained), true)).toEqual(chained);
        const parentOff = [link(TOMAS_A), link(B, { on: false })];
        expect(activeViewLinks(TREE, resolveViewLinks(TREE, parentOff), true)).toEqual([]);
        // Tomáš lies off the tree: alone, his link reaches nothing
        expect(activeViewLinks(TREE, resolveViewLinks(TREE, [link(TOMAS_A)]), true)).toEqual([]);
    });
});

describe('choosing', () => {
    it('showing another variant of a hypothesis rewrites its one record', () => {
        const first = showViewLink(TREE, [], B, 100);
        expect(first).toEqual({ links: [link(B, { addedAt: 100 })], removed: [], disconnected: [] });
        const second = showViewLink(TREE, [link(PARTNER, { addedAt: 50 }), ...first.links], C, 200);
        expect(second.links).toEqual([link(PARTNER, { addedAt: 50 }), link(C, { addedAt: 200 })]);
        expect(second.removed).toEqual([]);
    });

    it('one family, one place: another hypothesis showing it takes its record away', () => {
        const before = [link(B, { addedAt: 1 }), link(PARTNER, { addedAt: 2 })];
        const moved = showViewLink(TREE, before, ANTONIN_A, 300);
        expect(moved.links).toEqual([link(PARTNER, { addedAt: 2 }), link(ANTONIN_A, { addedAt: 300 })]);
        expect(moved.removed).toEqual([before[0]]);
        expect(moved.disconnected).toEqual([]);
        // an off record holding the family goes the same way
        expect(showViewLink(TREE, [link(B, { on: false })], ANTONIN_A, 300).removed).toEqual([link(B, { on: false })]);
    });

    it('chained: the dependents of a record, and unlinking switches them off too', () => {
        const links = [link(B, { addedAt: 1 }), link(TOMAS_A, { addedAt: 2 }), link(PARTNER, { addedAt: 3 })];
        expect(viewLinkDependents(TREE, links, 'H0022')).toEqual([links[1]]);
        expect(viewLinkDependents(TREE, links, 'H0024')).toEqual([]);
        expect(viewLinkDependents(TREE, links, 'H0030')).toEqual([]);
        expect(viewLinkDependents(TREE, links, 'H0099')).toEqual([]);
        // an off dependent needs no question
        expect(viewLinkDependents(TREE, [links[0], { ...links[1], on: false }], 'H0022')).toEqual([]);
        const unlinked = unlinkViewLink(TREE, links, 'H0022');
        expect(unlinked.links).toEqual([{ ...links[0], on: false }, { ...links[1], on: false }, links[2]]);
        expect(unlinked.disconnected).toEqual([{ ...links[1], on: false }]);
        expect(unlinked.removed).toEqual([]);
        expect(unlinkViewLink(TREE, links, 'H0024')).toEqual({ links: [links[0], links[1], { ...links[2], on: false }], removed: [], disconnected: [] });
    });

    it('the family moved elsewhere keeps what hangs inside it; switching to another variant does not', () => {
        const links = [link(B, { addedAt: 1 }), link(TOMAS_A, { addedAt: 2 })];
        const moved = showViewLink(TREE, links, ANTONIN_A, 300);
        expect(moved.removed).toEqual([links[0]]);
        expect(moved.disconnected).toEqual([]);
        expect(moved.links).toEqual([links[1], link(ANTONIN_A, { addedAt: 300 })]);
        const other = showViewLink(TREE, links, C, 300);
        expect(other.links).toEqual([link(C, { addedAt: 300 }), { ...links[1], on: false }]);
        expect(other.disconnected).toEqual([{ ...links[1], on: false }]);
    });

    it('a switch: on again is a new choice, off unlinks; removing switches off what hung on it', () => {
        const links = [link(B, { on: false, addedAt: 1 }), link(ANTONIN_A, { addedAt: 2 })];
        const on = setViewLinkOn(TREE, links, 'H0022', true, 400);
        expect(on.links).toEqual([link(B, { addedAt: 400 })]);
        expect(on.removed).toEqual([links[1]]);
        expect(setViewLinkOn(TREE, links, 'H0028', false, 400).links).toEqual([links[0], { ...links[1], on: false }]);
        expect(setViewLinkOn(TREE, links, 'H0099', true, 400)).toEqual({ links, removed: [], disconnected: [] });
        const chain = [link(B, { addedAt: 1 }), link(TOMAS_A, { addedAt: 2 })];
        const removed = removeViewLinks(TREE, chain, ['H0022']);
        expect(removed).toEqual({ links: [{ ...chain[1], on: false }], removed: [chain[0]], disconnected: [{ ...chain[1], on: false }] });
        expect(removeViewLinks(TREE, chain, ['H0022', 'H0030']).links).toEqual([]);
    });

    it('nothing changes the input records', () => {
        const links = [link(B, { addedAt: 1 }), link(TOMAS_A, { addedAt: 2 })];
        const copy = structuredClone(links);
        showViewLink(TREE, links, ANTONIN_A, 5);
        showViewLink(TREE, links, C, 5);
        unlinkViewLink(TREE, links, 'H0022');
        setViewLinkOn(TREE, links, 'H0030', false);
        removeViewLinks(TREE, links, ['H0022']);
        expect(links).toEqual(copy);
    });
});

describe('when the feature shows', () => {
    it('a tree whose data say what a variant would connect; a live bridge must say hypothesis.links too', () => {
        expect(hasViewLinkData(TREE)).toBe(true);
        expect(viewLinksAvailable(TREE)).toBe(true);
        expect(viewLinksAvailable(TREE, null)).toBe(true);
        expect(viewLinksAvailable(TREE, { features: ['person.titles', HYPOTHESIS_LINKS_FEATURE] })).toBe(true);
        expect(viewLinksAvailable(TREE, { features: ['person.titles'] })).toBe(false);
        expect(viewLinksAvailable(TREE, { features: null })).toBe(false);
        expect(HYPOTHESIS_LINKS_FEATURE).toBe('hypothesis.links');
    });

    it('variants with links, or a join naming its variant — nothing else', () => {
        const noVariants = changed(d => { for (const p of Object.values(d.persons)) for (const h of p.research?.hypotheses ?? []) delete h.variants; });
        // the joins at the edge and on the islands still name their variants
        expect(hasViewLinkData(noVariants)).toBe(true);
        const bare = changed(d => {
            for (const p of Object.values(d.persons)) {
                for (const h of p.research?.hypotheses ?? []) for (const v of h.variants ?? []) v.links = [];
                for (const h of p.research?.edge?.hypos ?? []) delete h.variants;
                for (const h of p.research?.island?.hypos ?? []) delete h.variants;
            }
        });
        // variants as text and joins without a variant (today's research): no feature
        expect(hasViewLinkData(bare)).toBe(false);
        expect(viewLinksAvailable(bare, { features: [HYPOTHESIS_LINKS_FEATURE] })).toBe(false);
        const onlyEdge = changed(d => {
            for (const p of Object.values(d.persons)) {
                if (p.research) delete p.research.hypotheses;
                for (const h of p.research?.island?.hypos ?? []) delete h.variants;
            }
        });
        expect(hasViewLinkData(onlyEdge)).toBe(true);
        expect(hasViewLinkData(null)).toBe(false);
        expect(hasViewLinkData({ persons: {}, partnerships: {} })).toBe(false);
    });
});

describe('never a change of the tree', () => {
    beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
    afterEach(() => vi.unstubAllGlobals());

    it('no function touches the data', () => {
        const data = structuredClone(TREE);
        const before = JSON.stringify(data);
        const ctx = viewLinkContext(data);
        const links = [link(B), link(TOMAS_A, { addedAt: 2 }), link(PARTNER, { addedAt: 3 })];
        resolveViewLinks(data, links, ctx);
        activeViewLinks(data, resolveViewLinks(data, links, ctx), true, ctx);
        viewLinkCandidates(data, ctx);
        viewLinkIsland(data, B, ctx);
        showViewLink(data, links, ANTONIN_A, 1, ctx);
        unlinkViewLink(data, links, 'H0022', ctx);
        removeViewLinks(data, links, ['H0022'], ctx);
        hasViewLinkData(data);
        expect(JSON.stringify(data)).toBe(before);
    });

    it('GEDCOM, JSON and CSV exports are the same byte for byte with records shown', () => {
        const ged = () => exportToGedcom(TREE, 'Horákovi', { research: { id: '7d3f2a10-4b6c-4e8a-9f21-5c0d8e3b1a77' } }).content.replace(/^1 DATE .*\n(2 TIME .*\n)?/m, '');
        const outputs = () => [ged(), JSON.stringify(TREE), buildPersonsCsv(TREE)];
        const without = outputs();
        saveViewLinks('t1', showViewLink(TREE, [], B, 1).links);
        saveViewLinks('t1', showViewLink(TREE, loadViewLinks('t1'), PARTNER, 2).links);
        expect(loadViewLinks('t1')).toHaveLength(2);
        expect(outputs()).toEqual(without);
        expect(without[0]).not.toMatch(/H0022|_VAR|_LINK|view-links|stromViewLinks/);
        expect(without[1]).not.toMatch(/stromViewLinks|"on":true|addedAt/);
    });
});
