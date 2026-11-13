/**
 * The event editor's "Shared with" logic (spec 085 §1, §3): the draft of
 * persons, the edit it saves through DataManager.saveSharedEvent, the
 * message a save shows, the family the picker offers, the delete-person
 * lines, the share-aware citation, and the counted texts. Invented data.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../snapshots.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../snapshots.js')>()),
    createSnapshot: vi.fn(async () => undefined),
}));

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import {
    sharedDraftFor, addToDraft, takeFromDraft, sharedEditFrom, draftChangesPersons, sharedEventTitle,
    sharedSaveMessage, familyCandidates, aliveInYear, sharedDeleteLines, orderDraftRows,
} from '../shared-event-editor.js';
import { sharedWith } from '../shared-events.js';
import { StromData, Person, PersonId, TreeId, LifeEvent, STROM_DATA_VERSION, toPersonId, toPartnershipId } from '../types.js';
import { getStringsForLang } from '../strings.js';

const TREE = 'shared-editor' as TreeId;
const SUDIVOJ = toPersonId('p_sudivoj');
const RADEGUNDA = toPersonId('p_radegunda');
const BOHUCHVAL = toPersonId('p_bohuchval');
const ZBYHNEV = toPersonId('p_zbyhnev');
const DRAHOMIL = toPersonId('p_drahomil');
const EUFROZINA = toPersonId('p_eufrozina');
const UNION = toPartnershipId('u_sudivoj_radegunda');

function person(id: PersonId, firstName: string, lastName: string, gender: 'male' | 'female', extra: Partial<Person> = {}): Person {
    return { id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra };
}

/**
 * Sudivoj's household in 1921: Radegunda, two sons; Drahomil his father died
 * in 1914, Eufrozína his sister; Sudivoj has the census alone, a source cited.
 */
function household(): StromData {
    return {
        version: STROM_DATA_VERSION,
        persons: {
            [SUDIVOJ]: person(SUDIVOJ, 'Sudivoj', 'Hurdálek', 'male', { birthDate: '1879', partnerships: [UNION],
                childIds: [BOHUCHVAL, ZBYHNEV], parentIds: [DRAHOMIL],
                events: [{ id: 'ev_1', type: 'census', date: '1921-02-15', place: 'Dolní Smyšlenice', age: '42', sourceIds: ['s1'] }] }),
            [RADEGUNDA]: person(RADEGUNDA, 'Radegunda', 'Hurdálková', 'female', { birthDate: '1883', partnerships: [UNION], childIds: [BOHUCHVAL, ZBYHNEV] }),
            [BOHUCHVAL]: person(BOHUCHVAL, 'Bohuchval', 'Hurdálek', 'male', { birthDate: '1906', parentIds: [SUDIVOJ, RADEGUNDA] }),
            [ZBYHNEV]: person(ZBYHNEV, 'Zbyhněv', 'Hurdálek', 'male', { birthDate: '1910', parentIds: [SUDIVOJ, RADEGUNDA] }),
            [DRAHOMIL]: person(DRAHOMIL, 'Drahomil', 'Hurdálek', 'male', { birthDate: '1850', deathDate: '1914-03-02', childIds: [SUDIVOJ, EUFROZINA] }),
            [EUFROZINA]: person(EUFROZINA, 'Eufrozína', 'Hurdálková', 'female', { birthDate: '1925', parentIds: [DRAHOMIL] }),
        },
        partnerships: {
            [UNION]: { id: UNION, person1Id: SUDIVOJ, person2Id: RADEGUNDA, childIds: [BOHUCHVAL, ZBYHNEV], status: 'married' },
        },
        sources: {
            s1: { id: 's1', title: 'Census 1921, Dolní Smyšlenice' },
            s2: { id: 's2', title: 'Parish book, Dolní Smyšlenice' },
        },
    };
}

function reset(data: StromData = household()): void {
    vi.restoreAllMocks();
    vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
    const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
    dm.data = data;
    dm.currentTreeId = TREE;
    dm.viewMode = false;
    dm.pendingBefore = null;
    UndoManager.setActiveTree(null);
    UndoManager.setActiveTree(TREE);
}

const eventsOf = (pid: PersonId): LifeEvent[] => DataManager.getData().persons[pid]?.events ?? [];
const censusOf = (pid: PersonId): LifeEvent | undefined => eventsOf(pid).find(e => e.type === 'census');

beforeEach(() => reset());

describe('the draft of persons', () => {
    it('adds three persons to a census: one save, four copies, the sources at every copy, each its own age and role', () => {
        const ev = censusOf(SUDIVOJ)!;
        const draft = sharedDraftFor(DataManager.getData(), SUDIVOJ, ev);
        expect(draft.rows).toEqual([]);
        expect(addToDraft(draft, [RADEGUNDA, BOHUCHVAL, ZBYHNEV, RADEGUNDA, SUDIVOJ])).toEqual([RADEGUNDA, BOHUCHVAL, ZBYHNEV]);
        draft.rows[0].age = '38';
        draft.rows[2].role = 'lodger';
        expect(draftChangesPersons(draft)).toBe(true);
        const edit = sharedEditFrom(draft, { date: '1921-02-15', place: 'Dolní Smyšlenice' }, { age: '42' });
        expect(edit.add).toEqual([RADEGUNDA, BOHUCHVAL, ZBYHNEV]);
        expect(edit.own?.get(RADEGUNDA)).toEqual({ age: '38', shareRole: undefined });
        expect(edit.own?.get(ZBYHNEV)).toEqual({ age: undefined, shareRole: 'lodger' });

        const res = DataManager.saveSharedEvent(SUDIVOJ, 'ev_1', edit)!;
        expect(res.personIds).toEqual([SUDIVOJ, RADEGUNDA, BOHUCHVAL, ZBYHNEV]);
        for (const pid of res.personIds) {
            expect(censusOf(pid)?.shareId).toBe(res.shareId);
            expect(censusOf(pid)?.sourceIds).toEqual(['s1']);
            expect(censusOf(pid)?.place).toBe('Dolní Smyšlenice');
        }
        expect(censusOf(RADEGUNDA)?.age).toBe('38');
        expect(censusOf(ZBYHNEV)?.shareRole).toBe('lodger');
        expect(censusOf(BOHUCHVAL)?.shareRole).toBeUndefined();

        // Opened again from Sudivoj: the rows in the order of the share.
        const again = sharedDraftFor(DataManager.getData(), SUDIVOJ, censusOf(SUDIVOJ)!);
        orderDraftRows(again, sharedWith(DataManager.getSharedEventIndex(), SUDIVOJ, 'ev_1'));
        expect(again.rows.map(r => r.personId)).toEqual([RADEGUNDA, BOHUCHVAL, ZBYHNEV]);
        expect(again.rows.map(r => r.age)).toEqual(['38', '', '']);
        expect(again.originalOthers).toEqual([RADEGUNDA, BOHUCHVAL, ZBYHNEV]);

        // One undo step takes the whole save back.
        DataManager.undo();
        expect(censusOf(SUDIVOJ)?.shareId).toBeUndefined();
        for (const pid of [RADEGUNDA, BOHUCHVAL, ZBYHNEV]) expect(censusOf(pid)).toBeUndefined();
    });

    it('removes one and separates another: the removed copy is gone, the separated keeps its values from before', () => {
        const ev = censusOf(SUDIVOJ)!;
        const draft = sharedDraftFor(DataManager.getData(), SUDIVOJ, ev);
        addToDraft(draft, [RADEGUNDA, BOHUCHVAL, ZBYHNEV]);
        DataManager.saveSharedEvent(SUDIVOJ, 'ev_1', sharedEditFrom(draft, {}, {}));

        const open = sharedDraftFor(DataManager.getData(), SUDIVOJ, censusOf(SUDIVOJ)!);
        takeFromDraft(open, BOHUCHVAL, false);
        takeFromDraft(open, ZBYHNEV, true);
        expect(open.removed).toEqual([BOHUCHVAL]);
        expect(open.separated).toEqual([ZBYHNEV]);
        const res = DataManager.saveSharedEvent(SUDIVOJ, 'ev_1', sharedEditFrom(open, { place: 'Horní Smyšlenice' }, {}))!;
        expect(res.personIds).toEqual([SUDIVOJ, RADEGUNDA]);
        expect(censusOf(BOHUCHVAL)).toBeUndefined();
        expect(censusOf(ZBYHNEV)?.shareId).toBeUndefined();
        expect(censusOf(ZBYHNEV)?.place).toBe('Dolní Smyšlenice');
        expect(censusOf(RADEGUNDA)?.place).toBe('Horní Smyšlenice');
        expect(sharedSaveMessage(open, res.personIds)).toEqual({ kind: 'nowN', count: 2 });
    });

    it('a person added and taken out again in one editing leaves no trace', () => {
        const draft = sharedDraftFor(DataManager.getData(), SUDIVOJ, censusOf(SUDIVOJ)!);
        addToDraft(draft, [RADEGUNDA]);
        takeFromDraft(draft, RADEGUNDA, false);
        expect(draft.rows).toEqual([]);
        expect(draft.removed).toEqual([]);
        expect(draftChangesPersons(draft)).toBe(false);
    });

    it('the last other person removed: an ordinary event again, "now only for …"', () => {
        const draft = sharedDraftFor(DataManager.getData(), SUDIVOJ, censusOf(SUDIVOJ)!);
        addToDraft(draft, [RADEGUNDA]);
        DataManager.saveSharedEvent(SUDIVOJ, 'ev_1', sharedEditFrom(draft, {}, {}));
        const open = sharedDraftFor(DataManager.getData(), SUDIVOJ, censusOf(SUDIVOJ)!);
        takeFromDraft(open, RADEGUNDA, false);
        const res = DataManager.saveSharedEvent(SUDIVOJ, 'ev_1', sharedEditFrom(open, {}, {}))!;
        expect(res.shareId).toBeNull();
        expect(censusOf(SUDIVOJ)?.shareId).toBeUndefined();
        expect(sharedSaveMessage(open, res.personIds)).toEqual({ kind: 'onlyOne', personId: SUDIVOJ });
    });
});

describe('the message after a save', () => {
    const base = () => sharedDraftFor(DataManager.getData(), SUDIVOJ, censusOf(SUDIVOJ)!);
    it('persons added: saved for N; one separated alone: separate; nothing about persons: saved', () => {
        const added = base();
        addToDraft(added, [RADEGUNDA, BOHUCHVAL]);
        expect(sharedSaveMessage(added, [SUDIVOJ, RADEGUNDA, BOHUCHVAL])).toEqual({ kind: 'saved', count: 3 });
        const sep = { ...base(), originalOthers: [RADEGUNDA, BOHUCHVAL], rows: [{ personId: RADEGUNDA, role: '', age: '', added: false }] };
        takeFromDraft(sep, RADEGUNDA, true);
        sep.rows = [{ personId: BOHUCHVAL, role: '', age: '', added: false }];
        expect(sharedSaveMessage(sep, [SUDIVOJ, BOHUCHVAL])).toEqual({ kind: 'separated', personId: RADEGUNDA });
        const plain = { ...base(), originalOthers: [RADEGUNDA], rows: [{ personId: RADEGUNDA, role: '', age: '', added: false }] };
        expect(sharedSaveMessage(plain, [SUDIVOJ, RADEGUNDA])).toEqual({ kind: 'saved', count: 2 });
    });

    it('names the event by type and year, a custom event by its label cut to 40 characters', () => {
        expect(sharedEventTitle({ type: 'census', date: '1921-02-15' }, 'Sčítání')).toBe('Sčítání 1921');
        expect(sharedEventTitle({ type: 'census' }, 'Census')).toBe('Census');
        const long = 'Zápis do domovské matriky obce Dolní Smyšlenice a okolí';
        const cut = sharedEventTitle({ type: 'custom', customLabel: long }, 'Custom');
        expect(cut.length).toBe(40);
        expect(cut.endsWith('…')).toBe(true);
        expect(sharedEventTitle({ type: 'custom', customLabel: 'Pouť' }, 'Custom')).toBe('Pouť');
    });
});

describe('the family the picker offers', () => {
    it('partners, children, parents, siblings; those not alive on the date apart', () => {
        const fam = familyCandidates(DataManager.getData(), SUDIVOJ, '1921-02-15');
        expect(fam.alive.map(c => [c.personId, c.kin])).toEqual([
            [RADEGUNDA, 'partner'], [BOHUCHVAL, 'child'], [ZBYHNEV, 'child'],
        ]);
        // The father died in 1914, the sister was born in 1925.
        expect(fam.hidden.map(c => c.personId)).toEqual([DRAHOMIL, EUFROZINA]);
    });

    it('no date of the event: no filter', () => {
        const fam = familyCandidates(DataManager.getData(), SUDIVOJ, undefined);
        expect(fam.hidden).toEqual([]);
        expect(fam.alive.map(c => c.personId)).toEqual([RADEGUNDA, BOHUCHVAL, ZBYHNEV, DRAHOMIL, EUFROZINA]);
    });

    it('a partial date compares the year; the same year counts as alive', () => {
        expect(aliveInYear({ deathDate: '1921-01-02' }, 1921)).toBe(true);
        expect(aliveInYear({ deathDate: '1920' }, 1921)).toBe(false);
        expect(aliveInYear({ birthDate: '1922' }, 1921)).toBe(false);
        expect(aliveInYear({}, 1921)).toBe(true);
    });
});

describe('the delete-person confirmation', () => {
    it('lists at most five shared events, then "…"', () => {
        expect(sharedDeleteLines(['a', 'b'])).toEqual(['a', 'b']);
        expect(sharedDeleteLines(['1', '2', '3', '4', '5', '6', '7'])).toEqual(['1', '2', '3', '4', '5', '…']);
    });
});

describe('a citation of a shared event', () => {
    it('goes to every copy and comes off every copy, one undo step each', () => {
        const draft = sharedDraftFor(DataManager.getData(), SUDIVOJ, censusOf(SUDIVOJ)!);
        addToDraft(draft, [RADEGUNDA, BOHUCHVAL]);
        DataManager.saveSharedEvent(SUDIVOJ, 'ev_1', sharedEditFrom(draft, {}, {}));
        expect(DataManager.citeEvent(RADEGUNDA, censusOf(RADEGUNDA)!.id, 's2')).toBe(true);
        for (const pid of [SUDIVOJ, RADEGUNDA, BOHUCHVAL]) expect(censusOf(pid)?.sourceIds).toEqual(['s1', 's2']);
        expect(DataManager.unciteEvent(SUDIVOJ, 'ev_1', 's1')).toBe(true);
        for (const pid of [SUDIVOJ, RADEGUNDA, BOHUCHVAL]) expect(censusOf(pid)?.sourceIds).toEqual(['s2']);
        DataManager.undo();
        for (const pid of [SUDIVOJ, RADEGUNDA, BOHUCHVAL]) expect(censusOf(pid)?.sourceIds).toEqual(['s1', 's2']);
    });
});

describe('the quality of a citation of a shared event', () => {
    it('goes to every copy citing the source in one undo step', () => {
        const draft = sharedDraftFor(DataManager.getData(), SUDIVOJ, censusOf(SUDIVOJ)!);
        addToDraft(draft, [RADEGUNDA, BOHUCHVAL]);
        DataManager.saveSharedEvent(SUDIVOJ, 'ev_1', sharedEditFrom(draft, {}, {}));
        expect(DataManager.setEventCitationQuality(RADEGUNDA, censusOf(RADEGUNDA)!.id, 's1', 3)).toBe(true);
        for (const pid of [SUDIVOJ, RADEGUNDA, BOHUCHVAL]) expect(censusOf(pid)?.citationQuay).toEqual({ sourceIds: { s1: 3 } });
        DataManager.undo();
        for (const pid of [SUDIVOJ, RADEGUNDA, BOHUCHVAL]) expect(censusOf(pid)?.citationQuay).toBeUndefined();
        // A source the event does not cite: nothing to set.
        expect(DataManager.setEventCitationQuality(SUDIVOJ, 'ev_1', 's2', 1)).toBe(false);
    });

    it('an ordinary event keeps it to itself', () => {
        expect(DataManager.setEventCitationQuality(SUDIVOJ, 'ev_1', 's1', 2)).toBe(true);
        expect(censusOf(SUDIVOJ)?.citationQuay).toEqual({ sourceIds: { s1: 2 } });
        expect(censusOf(RADEGUNDA)).toBeUndefined();
    });
});

describe('a new event saved shared', () => {
    const payload = { type: 'residence', date: '1930', place: 'Horní Smyšlenice' } as const;

    it('the event and every copy in one undo step', () => {
        const before = eventsOf(SUDIVOJ).length;
        const draft = sharedDraftFor(DataManager.getData(), SUDIVOJ, null);
        addToDraft(draft, [RADEGUNDA, BOHUCHVAL]);
        const res = DataManager.addSharedEvent(SUDIVOJ, payload, sharedEditFrom(draft, {}, {}))!;
        expect(res.result.personIds).toEqual([SUDIVOJ, RADEGUNDA, BOHUCHVAL]);
        for (const pid of res.result.personIds) {
            const copy = eventsOf(pid).find(e => e.type === 'residence');
            expect(copy?.shareId).toBe(res.result.shareId);
            expect(copy?.place).toBe('Horní Smyšlenice');
        }
        DataManager.undo();
        expect(eventsOf(SUDIVOJ).length).toBe(before);
        for (const pid of [RADEGUNDA, BOHUCHVAL]) expect(eventsOf(pid)).toEqual([]);
    });

    it('refused: nothing is saved, not even an ordinary event, and no undo step', () => {
        const data = household();
        data.persons[BOHUCHVAL].isLocked = true;
        reset(data);
        const before = JSON.stringify(DataManager.getData());
        const draft = sharedDraftFor(DataManager.getData(), SUDIVOJ, null);
        addToDraft(draft, [RADEGUNDA, BOHUCHVAL]);
        expect(DataManager.addSharedEvent(SUDIVOJ, payload, sharedEditFrom(draft, {}, {}))).toBeNull();
        expect(JSON.stringify(DataManager.getData())).toBe(before);
        expect(DataManager.canUndo()).toBe(false);

        // A type of one person (a baptism) with others: refused the same way.
        const baptism = DataManager.addSharedEvent(SUDIVOJ, { type: 'baptism', date: '1879' }, sharedEditFrom(draft, {}, {}));
        expect(baptism).toBeNull();
        expect(JSON.stringify(DataManager.getData())).toBe(before);
    });
});

describe('the counted texts', () => {
    it('Czech and Polish count persons in their forms', () => {
        const cs = getStringsForLang('cs');
        expect(cs.events.sharedSaved('Sčítání 1921', 4)).toBe('Sčítání 1921: uloženo u 4 osob.');
        expect(cs.events.sharedNowN('Sčítání 1921', 2)).toBe('Sčítání 1921: teď u 2 osob.');
        expect(cs.events.sharedBanner(5)).toBe('Společná událost 5 osob – úprava platí pro všechny');
        expect(cs.events.sharedDeleteAll(3)).toBe('Smazat u všech 3 osob…');
        expect(cs.events.sharedDeletedSelf('Sčítání 1921', 1)).toBe('Sčítání 1921: smazáno u této osoby, u 1 další zůstává.');
        expect(cs.events.sharedDeletedSelf('Sčítání 1921', 3)).toBe('Sčítání 1921: smazáno u této osoby, u 3 dalších zůstává.');
        expect(cs.personPicker.familyHidden(1, 'Drahomil Hurdálek († 1914)')).toBe('Bez 1 osoby, která k datu události nežila: Drahomil Hurdálek († 1914).');
        expect(cs.personPicker.familyHidden(2, 'a, b')).toBe('Bez 2 osob, které k datu události nežily: a, b.');

        const pl = getStringsForLang('pl');
        expect(pl.events.sharedSaved('Spis 1921', 4)).toBe('Spis 1921: zapisano u 4 osób.');
        expect(pl.events.sharedSaved('Spis 1921', 22)).toBe('Spis 1921: zapisano u 22 osób.');
        expect(pl.events.sharedDeletedSelf('Spis 1921', 1)).toBe('Spis 1921: usunięto u tej osoby, u 1 pozostałej zostaje.');
        expect(pl.events.sharedBanner(3)).toBe('Wspólne wydarzenie 3 osób – zmiany dotyczą wszystkich');
    });

    it('English and German say one person and people', () => {
        const en = getStringsForLang('en');
        expect(en.events.sharedSaved('Census 1921', 4)).toBe('Census 1921: saved for 4 people.');
        expect(en.events.sharedDeletedSelf('Census 1921', 1)).toBe('Census 1921: deleted for this person, stays for 1 other.');
        const de = getStringsForLang('de');
        expect(de.events.sharedDeletedAll('Volkszählung 1921', 4)).toBe('Volkszählung 1921: bei 4 Personen gelöscht.');
        expect(de.events.sharedTypeLockedHint(3)).toContain('(3)');
    });
});
