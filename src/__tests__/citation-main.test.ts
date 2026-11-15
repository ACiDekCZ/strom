/**
 * The main citation of a fact (spec 095, data version 21): marking it,
 * taking it away and removing its citation are one undo step each; undo
 * puts back the list and the mark; a shared event's main citation is common
 * to its copies; removing, merging and remapping a source carry it along;
 * a tree of version 20 loads unchanged, a mark naming a source not cited
 * goes. Invented data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataManager, migrateData } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { remapCitations, unionCitations } from '../citation-quality.js';
import { sourceUsage } from '../ui/table-view/table-sources.js';
import { getStringsForLang } from '../strings.js';
import { Person, Source, StromData, TreeId, toPartnershipId, toPersonId } from '../types.js';

const TREE = 'citation-main-tree' as TreeId;
const P = toPersonId('p_zbyhnev');
const Q = toPersonId('p_radmila');
const U = toPartnershipId('u_zbyhnev_radmila');

const src = (id: string, extra: Partial<Source> = {}): Source => ({ id, title: `Register ${id}`, quality: 3, ...extra });

function person(id: typeof P, firstName: string, extra: Partial<Person> = {}): Person {
    return {
        id, firstName, lastName: 'Vlnka', gender: id === P ? 'male' : 'female', isPlaceholder: false,
        partnerships: [U], parentIds: [], childIds: [], ...extra,
    };
}

function tree(): StromData {
    return {
        persons: {
            [P]: person(P, 'Zbyhněv', {
                birthDate: '1821-03-02', birthSourceIds: ['census', 'births', 'deaths'],
                events: [{ id: 'ev_c1', type: 'census', date: '1857', sourceIds: ['census', 'births'], shareId: 'SHCENS1' }],
            }),
            [Q]: person(Q, 'Radmila', {
                events: [{ id: 'ev_c2', type: 'census', date: '1857', sourceIds: ['census', 'births'], shareId: 'SHCENS1' }],
            }),
        },
        partnerships: {
            [U]: {
                id: U, person1Id: P, person2Id: Q, childIds: [], status: 'married', startDate: '1846',
                sourceIds: ['marriages', 'census'], divorceSourceIds: ['deaths'],
                events: [{ id: 'ce_banns', type: 'banns', sourceIds: ['marriages', 'census'] }],
            },
        },
        sources: {
            census: src('census', { events: ['CENS'] }), births: src('births', { events: ['BIRT'] }),
            deaths: src('deaths', { events: ['DEAT'] }), marriages: src('marriages', { events: ['MARR'] }),
        },
    };
}

const dm = DataManager as unknown as {
    data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null;
};
const data = (): StromData => dm.data;
const zbyhnev = (): Person => data().persons[P];

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
    dm.data = tree();
    dm.currentTreeId = TREE;
    dm.viewMode = false;
    dm.pendingBefore = null;
    UndoManager.setActiveTree(null);
    UndoManager.setActiveTree(TREE);
});

describe('DataManager.setCitationMain', () => {
    it('marks, replaces and takes away the main citation of a birth, one undo step each, the list unchanged', () => {
        expect(DataManager.setCitationMain({ personId: P, fact: 'birth' }, 'deaths')).toBe(true);
        expect(zbyhnev().citationMain).toEqual({ birthSourceIds: 'deaths' });
        expect(DataManager.citationMainAt({ personId: P, fact: 'birth' })).toBe('deaths');
        expect(zbyhnev().birthSourceIds).toEqual(['census', 'births', 'deaths']);
        expect(DataManager.lastUndoDescription()).toBe('main citation for birth – Zbyhněv Vlnka (*1821)');

        expect(DataManager.setCitationMain({ personId: P, fact: 'birth' }, 'deaths')).toBe(false);
        expect(DataManager.setCitationMain({ personId: P, fact: 'birth' }, 'census')).toBe(true);
        expect(zbyhnev().citationMain).toEqual({ birthSourceIds: 'census' });

        expect(DataManager.setCitationMain({ personId: P, fact: 'birth' }, null)).toBe(true);
        expect('citationMain' in zbyhnev()).toBe(false);
        expect(DataManager.lastUndoDescription()).toBe('unmarking the main citation for birth – Zbyhněv Vlnka (*1821)');

        DataManager.undo();
        expect(zbyhnev().citationMain).toEqual({ birthSourceIds: 'census' });
        DataManager.undo();
        expect(zbyhnev().citationMain).toEqual({ birthSourceIds: 'deaths' });
        DataManager.undo();
        expect('citationMain' in zbyhnev()).toBe(false);
        expect(DataManager.canUndo()).toBe(false);
    });

    it('refuses a source not cited there, a person\'s own citations, a locked person', () => {
        expect(DataManager.setCitationMain({ personId: P, fact: 'birth' }, 'marriages')).toBe(false);
        expect(DataManager.setCitationMain({ personId: P }, 'census')).toBe(false);
        expect(DataManager.setCitationMain({ personId: P, fact: 'death' }, null)).toBe(false);
        zbyhnev().isLocked = true;
        expect(DataManager.setCitationMain({ personId: P, fact: 'birth' }, 'births')).toBe(false);
        expect(DataManager.canUndo()).toBe(false);
    });

    it('a couple\'s wedding, divorce and event', () => {
        expect(DataManager.setCitationMain({ partnershipId: U }, 'census')).toBe(true);
        expect(DataManager.lastUndoDescription()).toBe('main citation for marriage – Zbyhněv Vlnka (*1821) & Radmila Vlnka');
        expect(DataManager.setCitationMain({ partnershipId: U, fact: 'divorce' }, 'deaths')).toBe(true);
        expect(data().partnerships[U].citationMain).toEqual({ sourceIds: 'census', divorceSourceIds: 'deaths' });
        expect(DataManager.setCitationMain({ partnershipId: U, eventId: 'ce_banns' }, 'census')).toBe(true);
        expect(data().partnerships[U].events![0].citationMain).toEqual({ sourceIds: 'census' });
        expect(DataManager.lastUndoDescription()).toBe('main citation for banns – Zbyhněv Vlnka (*1821) & Radmila Vlnka');
    });

    it('a shared event\'s main citation is common to its copies', () => {
        expect(DataManager.setCitationMain({ personId: Q, eventId: 'ev_c2' }, 'births')).toBe(true);
        expect(zbyhnev().events![0].citationMain).toEqual({ sourceIds: 'births' });
        expect(data().persons[Q].events![0].citationMain).toEqual({ sourceIds: 'births' });
        // Removing the citation from the shared event clears the mark in every copy, in one step.
        expect(DataManager.unciteEvent(P, 'ev_c1', 'births')).toBe(true);
        expect('citationMain' in zbyhnev().events![0]).toBe(false);
        expect('citationMain' in data().persons[Q].events![0]).toBe(false);
        DataManager.undo();
        expect(zbyhnev().events![0].citationMain).toEqual({ sourceIds: 'births' });
        expect(data().persons[Q].events![0].citationMain).toEqual({ sourceIds: 'births' });
        expect(zbyhnev().events![0].sourceIds).toEqual(['census', 'births']);
    });
});

describe('the main citation follows its citation', () => {
    it('removing the main citation clears the mark in the same step; undo puts back the place and the mark', () => {
        DataManager.setCitationMain({ personId: P, fact: 'birth' }, 'births');
        expect(DataManager.uncitePerson(P, 'births', 'birth')).toBe(true);
        expect(zbyhnev().birthSourceIds).toEqual(['census', 'deaths']);
        expect('citationMain' in zbyhnev()).toBe(false);
        DataManager.undo();
        expect(zbyhnev().birthSourceIds).toEqual(['census', 'births', 'deaths']);
        expect(zbyhnev().citationMain).toEqual({ birthSourceIds: 'births' });
    });

    it('removing another citation keeps the mark', () => {
        DataManager.setCitationMain({ partnershipId: U }, 'census');
        expect(DataManager.uncitePartnership(U, 'marriages')).toBe(true);
        expect(data().partnerships[U].citationMain).toEqual({ sourceIds: 'census' });
        expect(DataManager.unciteCoupleEvent(U, 'ce_banns', 'marriages')).toBe(true);
        DataManager.setCitationMain({ partnershipId: U, eventId: 'ce_banns' }, 'census');
        expect(DataManager.unciteCoupleEvent(U, 'ce_banns', 'census')).toBe(true);
        expect(data().partnerships[U].events![0].citationMain).toBeUndefined();
    });

    it('an event edited without the source loses its mark', () => {
        DataManager.setCitationMain({ personId: P, eventId: 'ev_c1' }, 'births');
        expect(DataManager.updateLifeEvent(P, 'ev_c1', { sourceIds: ['census'] })).toBe(true);
        expect(zbyhnev().events![0].citationMain).toBeUndefined();
        expect(data().persons[Q].events![0].citationMain).toBeUndefined();
    });

    it('removing the source from the catalog clears the marks of its citations', () => {
        DataManager.setCitationMain({ personId: P, fact: 'birth' }, 'deaths');
        DataManager.setCitationMain({ partnershipId: U, fact: 'divorce' }, 'deaths');
        expect(DataManager.removeSource('deaths')).toBe(true);
        expect(zbyhnev().citationMain).toBeUndefined();
        expect(data().partnerships[U].citationMain).toBeUndefined();
        DataManager.undo();
        expect(zbyhnev().citationMain).toEqual({ birthSourceIds: 'deaths' });
    });

    it('a source joined into another: the mark names the entry it joined', () => {
        const d = tree();
        d.persons[P].citationMain = { birthSourceIds: 'deaths' };
        remapCitations(d, new Map([['deaths', 'births']]), d.sources);
        expect(d.persons[P].birthSourceIds).toEqual(['census', 'births']);
        expect(d.persons[P].citationMain).toEqual({ birthSourceIds: 'births' });
    });

    it('a merge keeps the mark of the side that has one; both: the kept side\'s', () => {
        const into = { birthSourceIds: ['census'], citationMain: undefined as { birthSourceIds?: string } | undefined };
        unionCitations(into, { birthSourceIds: ['births'], citationMain: { birthSourceIds: 'births' } }, 'birthSourceIds');
        expect(into).toEqual({ birthSourceIds: ['census', 'births'], citationMain: { birthSourceIds: 'births' } });
        const kept = { birthSourceIds: ['census'], citationMain: { birthSourceIds: 'census' } };
        unionCitations(kept, { birthSourceIds: ['births'], citationMain: { birthSourceIds: 'births' } }, 'birthSourceIds');
        expect(kept.citationMain).toEqual({ birthSourceIds: 'census' });
    });
});

describe('loading (data v21)', () => {
    it('a v20 tree loads unchanged', () => {
        const d = tree();
        for (const s of Object.values(d.sources!)) delete s.events;
        const v20 = { ...structuredClone(d), version: 20 };
        const loaded = migrateData(structuredClone(v20));
        expect(loaded.persons).toEqual(v20.persons);
        expect(loaded.partnerships).toEqual(v20.partnerships);
        expect(loaded.sources).toEqual(v20.sources);
    });

    it('a mark naming a source not cited there, a person\'s own list or not an id goes; events only as tags', () => {
        const d = tree() as StromData & { version: number };
        d.version = 21;
        d.persons[P].sourceIds = ['census'];
        (d.persons[P] as unknown as { citationMain: unknown }).citationMain = { birthSourceIds: 'marriages', sourceIds: 'census', deathSourceIds: 7 };
        d.persons[Q].events![0].citationMain = { sourceIds: 'births' };
        (d.sources!.census as unknown as { events: unknown }).events = ['CENS', 'cens', 3];
        (d.sources!.births as unknown as { events: unknown }).events = 'BIRT';
        const loaded = migrateData(d);
        expect('citationMain' in loaded.persons[P]).toBe(false);
        expect(loaded.persons[Q].events![0].citationMain).toEqual({ sourceIds: 'births' });
        expect(loaded.sources!.census.events).toEqual(['CENS']);
        expect('events' in loaded.sources!.births).toBe(false);
    });
});

describe('the undo texts in every language', () => {
    it('names the fact and the person', () => {
        const cs = getStringsForLang('cs');
        expect(cs.undo.citeMain(cs.events.typesOf.birth, 'Zbyhněv Vlnka')).toBe('hlavní citace u narození – Zbyhněv Vlnka');
        expect(cs.undo.citeMainClear(cs.events.typesOf.marriage, 'A & B')).toBe('zrušení hlavní citace u sňatku – A & B');
        const de = getStringsForLang('de');
        expect(de.undo.citeMain(de.events.typesOf.birth, 'C')).toBe('Hauptzitat (Geburt) – C');
        const pl = getStringsForLang('pl');
        expect(pl.undo.citeMainClear(pl.events.typesOf.death, 'C')).toBe('usunięcie cytatu głównego zgonu – C');
    });
});

describe('the Sources table after a removal (spec 095 M10)', () => {
    it('counts a removed citation\'s facts and people again; undo counts them back', () => {
        expect(sourceUsage(data()).get('deaths')).toEqual({ persons: 2, facts: 2 });
        DataManager.setCitationMain({ personId: P, fact: 'birth' }, 'deaths');
        expect(DataManager.uncitePerson(P, 'deaths', 'birth')).toBe(true);
        expect(sourceUsage(data()).get('deaths')).toEqual({ persons: 2, facts: 1 });
        expect(DataManager.uncitePartnership(U, 'deaths', 'divorce')).toBe(true);
        expect(sourceUsage(data()).get('deaths')).toBeUndefined();
        DataManager.undo();
        DataManager.undo();
        expect(sourceUsage(data()).get('deaths')).toEqual({ persons: 2, facts: 2 });
        expect(DataManager.citationMainAt({ personId: P, fact: 'birth' })).toBe('deaths');
    });
});
