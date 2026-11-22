/**
 * The source viewer's citation bar and the toasts of a fact's citations
 * (spec 095 §2, §3): the bar's state at every case of the table (the first
 * with its reason, another, the main one, the only one, a research without
 * the main citation, locked, just removed), the removal toasts (3a–3f, the
 * long sentence once in a window for a tree) and a mutation's own toast
 * beside the history's entry. Invented data.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DataManager, MutationToast } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { CiteBarGates, citeBar, citeBarHtml, citeMainToast, resetUnciteWarned, unciteToast } from '../citation-bar.js';
import { setLanguage, strings } from '../strings.js';
import { Person, Source, StromData, TreeId } from '../types.js';
import { toPartnershipId, toPersonId } from '../ids.js';

const TREE = 'citation-bar-tree' as TreeId;
const P = toPersonId('p_dobroslav');
const Q = toPersonId('p_ludmila');
const U = toPartnershipId('u_dobroslav_ludmila');

const src = (id: string, extra: Partial<Source> = {}): Source => ({ id, title: `Register ${id}`, ...extra });

function tree(): StromData {
    const person = (id: typeof P, firstName: string, extra: Partial<Person> = {}): Person => ({
        id, firstName, lastName: 'Zderadil', gender: id === P ? 'male' : 'female', isPlaceholder: false,
        partnerships: [U], parentIds: [], childIds: [], ...extra,
    });
    return {
        persons: {
            [P]: person(P, 'Dobroslav', {
                birthDate: '1851-03-02',
                // The list's order: the census, the death record, the birth record.
                birthSourceIds: ['census', 'deaths', 'births'],
                deathSourceIds: ['deaths'],
                events: [{ id: 'ev_c1', type: 'census', date: '1880', sourceIds: ['census', 'copy'], shareId: 'SHC1' }],
                sourceIds: ['census'],
            }),
            [Q]: person(Q, 'Velemíra', {
                events: [{ id: 'ev_c2', type: 'census', date: '1880', sourceIds: ['census', 'copy'], shareId: 'SHC1' }],
            }),
        },
        partnerships: {
            [U]: { id: U, person1Id: P, person2Id: Q, childIds: [], status: 'married', startDate: '1876', sourceIds: ['copy', 'index'] },
        },
        sources: {
            census: src('census', { quality: 2, events: ['CENS'] }),
            births: src('births', { quality: 3, events: ['BIRT'], recordDate: '1851-03-05' }),
            deaths: src('deaths', { quality: 3, events: ['DEAT'] }),
            copy: src('copy', { quality: 1 }),
            index: src('index', { quality: 2 }),
        },
    };
}

const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
const OPEN: CiteBarGates = { mainOffered: true, removeNotTaken: false, editable: true };
const BIRTH = { personId: P, fact: 'birth' as const };

beforeEach(() => {
    vi.restoreAllMocks();
    setLanguage('en');
    vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
    dm.data = tree();
    dm.currentTreeId = TREE;
    dm.viewMode = false;
    dm.pendingBefore = null;
    UndoManager.setActiveTree(null);
    UndoManager.setActiveTree(TREE);
    resetUnciteWarned();
});

afterEach(() => {
    DataManager.onMutationCommitted = null;
    setLanguage('en');
});

describe('citeBar: the states of §2', () => {
    it('the first: its place and why it is first (the birth record, an original); Mark as main and Remove', () => {
        const bar = citeBar(dm.data, BIRTH, 'births', OPEN)!;
        expect(bar.state).toBe('first');
        expect(bar.what).toBe('Birth · Dobroslav Zderadil');
        expect(bar.pos).toBe('Citation 1 of 3 · first because: the birth record, original');
        expect(bar).toMatchObject({ setMain: true, clearMain: false, remove: true, note: false });
    });

    it('the first because it is an original (step 3), the highest reliability (step 4), or nothing said (step 5)', () => {
        expect(citeBar(dm.data, { personId: P, eventId: 'ev_c1' }, 'census', OPEN)!.pos)
            .toBe('Citation 1 of 2 · first because: highest reliability');
        dm.data.sources!.copy.quality = 2;
        expect(citeBar(dm.data, { personId: P, eventId: 'ev_c1' }, 'census', OPEN)!.pos).toBe('Citation 1 of 2');
        dm.data.sources!.census.quality = 3;
        delete dm.data.sources!.census.events;
        expect(citeBar(dm.data, { personId: P, eventId: 'ev_c1' }, 'census', OPEN)!.pos)
            .toBe('Citation 1 of 2 · first because: original');
    });

    it('another in the order: only its place', () => {
        const bar = citeBar(dm.data, BIRTH, 'census', OPEN)!;
        expect(bar.state).toBe('next');
        expect(bar.pos).toBe('Citation 3 of 3');
        expect(bar.setMain).toBe(true);
    });

    it('the main citation: "Main citation for the birth", Unmark main; the markup with ★ and the accent class', () => {
        dm.data.persons[P].citationMain = { birthSourceIds: 'census' };
        const bar = citeBar(dm.data, BIRTH, 'census', OPEN)!;
        expect(bar.state).toBe('main');
        expect(bar.pos).toBe('Main citation for the birth');
        expect(bar).toMatchObject({ setMain: false, clearMain: true, remove: true });
        const html = citeBarHtml(bar);
        expect(html).toContain('viewer-cite is-main');
        expect(html).toContain('★︎ </span>Main citation for the birth');
        expect(html).toContain('data-cite-act="clear"');
        expect(html).not.toContain('data-cite-act="set"');
        // The record now second, by the order alone.
        expect(citeBar(dm.data, BIRTH, 'births', OPEN)!.pos).toBe('Citation 2 of 3');
    });

    it('the only citation: "The only citation for the death", Remove alone', () => {
        const bar = citeBar(dm.data, { personId: P, fact: 'death' }, 'deaths', OPEN)!;
        expect(bar.state).toBe('only');
        expect(bar.pos).toBe('The only citation for the death');
        expect(bar).toMatchObject({ setMain: false, clearMain: false, remove: true });
        expect(citeBarHtml(bar)).not.toContain('viewer-cite-main');
    });

    it('a research without citations.main: no Mark, no ★, no "main" reason; the note without citations.remove', () => {
        dm.data.persons[P].citationMain = { birthSourceIds: 'census' };
        const gates: CiteBarGates = { mainOffered: false, removeNotTaken: true, editable: true };
        const bar = citeBar(dm.data, BIRTH, 'census', gates)!;
        // The stored main citation still stands first (as the chips), without a word of it.
        expect(bar.state).toBe('first');
        expect(bar.pos).toBe('Citation 1 of 3');
        expect(bar).toMatchObject({ setMain: false, clearMain: false, remove: true, note: true });
        const html = citeBarHtml(bar);
        expect(html).not.toContain('★');
        expect(html).toContain('<p class="viewer-cite-note">The research does not take removals yet.</p>');
    });

    it('locked or read-only: the place and ★, no buttons, no note', () => {
        dm.data.persons[P].citationMain = { birthSourceIds: 'census' };
        const bar = citeBar(dm.data, BIRTH, 'census', { mainOffered: true, removeNotTaken: true, editable: false })!;
        expect(bar.state).toBe('main');
        expect(bar).toMatchObject({ setMain: false, clearMain: false, remove: false, note: false });
        const html = citeBarHtml(bar);
        expect(html).toContain('★');
        expect(html).not.toContain('viewer-cite-acts');
    });

    it('just removed: "Unlinked from the birth", no buttons, the text focusable; not cited and not removed: no bar', () => {
        dm.data.persons[P].birthSourceIds = ['census', 'deaths'];
        expect(citeBar(dm.data, BIRTH, 'births', OPEN)).toBeNull();
        const bar = citeBar(dm.data, BIRTH, 'births', OPEN, true)!;
        expect(bar.state).toBe('gone');
        expect(bar.pos).toBe('Unlinked from the birth · the source stays in the catalog');
        expect(bar).toMatchObject({ setMain: false, clearMain: false, remove: false, note: false });
        const html = citeBarHtml(bar);
        expect(html).toContain('is-gone');
        expect(html).toContain('tabindex="-1"');
    });

    it('a person\'s own citations are not a fact: no bar; a wedding and a couple\'s event are', () => {
        expect(citeBar(dm.data, { personId: P }, 'census', OPEN)).toBeNull();
        expect(citeBar(dm.data, { partnershipId: U }, 'index', OPEN)!.what).toBe('Marriage · Dobroslav Zderadil & Velemíra Zderadil');
        expect(citeBar(dm.data, { partnershipId: U }, 'index', OPEN)!.pos).toBe('Citation 1 of 2 · first because: highest reliability');
    });

    it('in Czech, German and Polish: the fact in its form', () => {
        dm.data.persons[P].citationMain = { birthSourceIds: 'census' };
        setLanguage('cs');
        expect(citeBar(dm.data, BIRTH, 'census', OPEN)!.pos).toBe('Hlavní citace u narození');
        expect(citeBar(dm.data, BIRTH, 'births', OPEN)!.pos).toBe('Citace 2 ze 3');
        // "z" or "ze" as the count is read.
        expect([5, 12, 21].map(n => strings.sources.citePos(1, n))).toEqual(['Citace 1 z 5', 'Citace 1 ze 12', 'Citace 1 ze 21']);
        expect(citeBar(dm.data, { personId: P, eventId: 'ev_c1' }, 'census', OPEN)!.what).toBe('Sčítání lidu · Dobroslav Zderadil');
        setLanguage('de');
        expect(citeBar(dm.data, BIRTH, 'census', OPEN)!.pos).toBe('Hauptzitat (Geburt)');
        delete dm.data.persons[P].citationMain;
        expect(citeBar(dm.data, BIRTH, 'births', OPEN)!.pos).toBe('Zitat 1 von 3 · steht zuerst: Eintrag (Geburt), Original');
        setLanguage('pl');
        expect(citeBar(dm.data, BIRTH, 'births', OPEN)!.pos).toBe('Cytat 1 z 3 · jest pierwszy: zapis urodzenia, oryginał');
    });
});

describe('the toasts of §2 and §3', () => {
    it('3a a citation removed, 3b the main one, 3c a shared event\'s, 3f a research that takes it: no tail', () => {
        expect(unciteToast({ fact: 'birth', title: 'Register deaths' }))
            .toEqual({ text: 'Citation removed from the birth: Register deaths · the source stays' });
        expect(unciteToast({ fact: 'birth', title: 'Census 1880', wasMain: true }).text)
            .toBe('Citation removed from the birth, no longer main: Census 1880 · the source stays');
        expect(unciteToast({ fact: 'census', title: 'Census 1880', persons: 3 }).text)
            .toBe('Citation removed from the census for all 3 people: Census 1880 · the source stays');
        expect(unciteToast({ fact: 'birth', title: 'X', notTaken: false, treeId: TREE })).toEqual({ text: 'Citation removed from the birth: X · the source stays' });
    });

    it('3d / 3e an older research: the long sentence once in the window for a tree, then the short tail', () => {
        const first = unciteToast({ fact: 'birth', title: 'X', notTaken: true, treeId: TREE });
        expect(first).toEqual({
            text: 'Citation removed from the birth: X · the source stays',
            note: 'The research will not take this removal; the citation comes back when its version is loaded.',
        });
        const next = unciteToast({ fact: 'death', title: 'Y', notTaken: true, treeId: TREE });
        expect(next).toEqual({ text: 'Citation removed from the death: Y · the source stays · not taken by the research' });
        // Another tree is told once as well.
        expect(unciteToast({ fact: 'birth', title: 'X', notTaken: true, treeId: 'other' as TreeId }).note).toBeTruthy();
        // A new window: told again.
        resetUnciteWarned();
        expect(unciteToast({ fact: 'birth', title: 'X', notTaken: true, treeId: TREE }).note).toBeTruthy();
    });

    it('in Czech: the toasts of the specification', () => {
        setLanguage('cs');
        expect(unciteToast({ fact: 'sčítání lidu', title: 'Sčítání 1880', persons: 3 }).text)
            .toBe('Citace odebrána od sčítání lidu u všech 3 osob: Sčítání 1880 · pramen zůstává');
        expect(unciteToast({ fact: 'narození', title: 'Sčítání 1880', wasMain: true }).text)
            .toBe('Citace odebrána od narození, hlavní zrušena: Sčítání 1880 · pramen zůstává');
        expect(citeMainToast('narození', 'Sčítání 1880').text).toBe('Hlavní citace u narození: Sčítání 1880');
        expect(citeMainToast('narození', null).text).toBe('Hlavní citace u narození zrušena, pořadí řídí automatika');
        setLanguage('de');
        expect(unciteToast({ fact: 'Geburt', title: 'X', wasMain: true }).text).toBe('Zitat entfernt (Geburt), kein Hauptzitat mehr: X · die Quelle bleibt');
    });

    it('a mutation\'s own toast goes beside the history\'s entry: the entry keeps its noun', () => {
        const seen: { description: string; toast?: MutationToast }[] = [];
        DataManager.onMutationCommitted = (description, toast) => seen.push({ description, toast });
        expect(DataManager.setCitationMain(BIRTH, 'census', citeMainToast('birth', 'Register census'))).toBe(true);
        expect(DataManager.uncitePerson(P, 'deaths', 'birth', unciteToast({ fact: 'birth', title: 'Register deaths' }))).toBe(true);
        expect(DataManager.uncitePerson(P, 'census')).toBe(true);
        expect(seen).toEqual([
            { description: 'main citation for birth – Dobroslav Zderadil (*1851)', toast: { text: 'Main citation for the birth: Register census' } },
            { description: expect.stringContaining('Dobroslav Zderadil'), toast: { text: 'Citation removed from the birth: Register deaths · the source stays' } },
            { description: expect.stringContaining('Dobroslav Zderadil'), toast: undefined },
        ]);
        expect(DataManager.lastUndoDescription()).toBe(seen[2].description);
    });

    it('removing the main citation with its toast: one undo step puts it back in its place with the mark', () => {
        DataManager.setCitationMain(BIRTH, 'deaths');
        expect(DataManager.uncitePerson(P, 'deaths', 'birth', unciteToast({ fact: 'birth', title: 'R', wasMain: true }))).toBe(true);
        expect(dm.data.persons[P].birthSourceIds).toEqual(['census', 'births']);
        expect(dm.data.persons[P].citationMain).toBeUndefined();
        DataManager.undo();
        expect(dm.data.persons[P].birthSourceIds).toEqual(['census', 'deaths', 'births']);
        expect(dm.data.persons[P].citationMain).toEqual({ birthSourceIds: 'deaths' });
    });

    it('a shared event\'s reach: every copy citing the source; none when it is not cited', () => {
        expect(DataManager.unciteEventReach(P, 'ev_c1', 'copy')).toBe(2);
        expect(DataManager.unciteEventReach(P, 'ev_c1', 'births')).toBe(0);
        dm.data.persons[Q].events![0].sourceIds = ['census'];
        expect(DataManager.unciteEventReach(P, 'ev_c1', 'copy')).toBe(1);
    });
});
