/**
 * Copies of a shared event that went apart (spec 085 §4, 4b–4g): the event
 * editor's save keeps a difference it did not touch, Unify and Separate are
 * each one undo step, the Unify dialog's and the editor bar's content, and
 * the Events table's cells that carry the finding. Invented data.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../snapshots.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../snapshots.js')>()),
    createSnapshot: vi.fn(async () => undefined),
}));

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { setLanguage } from '../strings.js';
import { validateTreeData } from '../validation.js';
import { findDivergentShares, shareCopiesOf, shareDivergence, type SharedEventCommon } from '../shared-events.js';
import { sharedDraftFor, sharedEditFrom } from '../shared-event-editor.js';
import { divergentPersons, editorDivergence, unifyDefaults, unifyModel, unifyValues } from '../shared-divergence.js';
import { buildTableModel } from '../ui/table-view/table-model.js';
import { buildCheckIndex, issueTargets } from '../ui/table-view/table-checks.js';
import { STROM_DATA_VERSION, toPersonId, type LifeEvent, type Person, type PersonId, type StromData, type TreeId } from '../types.js';

const TREE = 'shared-unify' as TreeId;
const HOSTIVIT = toPersonId('p_hostivit');
const BORIVOJA = toPersonId('p_borivoja');
const ZBYHNEV = toPersonId('p_zbyhnev');
const SHARE = 'sh_census1910';

function person(id: PersonId, firstName: string, lastName: string, gender: 'male' | 'female', events: LifeEvent[]): Person {
    return { id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], events };
}

/** A census of three; Zbyhněv's copy has another date (and, with `more`, another place and note too). */
function tree(more = false): StromData {
    const census = { type: 'census' as const, shareId: SHARE, date: '1910-12-31', place: 'Horní Kotlinov' };
    const odd = more ? { date: '1911-01-02', place: 'Dolní Kotlinov', note: 'Opis' } : { date: '1911-01-02' };
    return {
        version: STROM_DATA_VERSION,
        persons: {
            [HOSTIVIT]: person(HOSTIVIT, 'Hostivít', 'Šmidlovský', 'male', [{ id: 'c_h', ...census, age: '40' }]),
            [BORIVOJA]: person(BORIVOJA, 'Bořivoja', 'Šmidlovská', 'female', [{ id: 'c_b', ...census, age: '36' }]),
            [ZBYHNEV]: person(ZBYHNEV, 'Zbyhněv', 'Šmidlovský', 'male', [{ id: 'c_z', ...census, ...odd, age: '11', shareRole: 'son' }]),
        },
        partnerships: {},
    } as StromData;
}

function reset(data: StromData = tree()): void {
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

const eventOf = (id: PersonId): LifeEvent => DataManager.getData().persons[id]!.events![0];
const divergence = () => shareDivergence(DataManager.getData(), SHARE);

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T10:30:00Z'));
    setLanguage('en');
});
afterAll(() => {
    vi.useRealTimers();
});

describe('the event editor saves only what was changed (4g)', () => {
    it('a changed note reaches every copy, a differing date it did not touch stays', () => {
        reset();
        const stored = eventOf(HOSTIVIT);
        const draft = sharedDraftFor(DataManager.getData(), HOSTIVIT, stored);
        // The editor's form sends every common field, the note changed.
        const form: SharedEventCommon = { type: 'census', date: '1910-12-31', place: 'Horní Kotlinov', note: 'Soupis domu 12' };
        const res = DataManager.saveSharedEvent(HOSTIVIT, 'c_h', sharedEditFrom(draft, form, { age: '40' }, stored));
        expect(res).not.toBeNull();
        expect(shareCopiesOf(DataManager.getData(), SHARE).map(c => c.event.note)).toEqual(['Soupis domu 12', 'Soupis domu 12', 'Soupis domu 12']);
        expect(eventOf(ZBYHNEV).date).toBe('1911-01-02');
        expect(divergence()?.fields.map(f => f.field)).toEqual(['date']);
    });

    it('a field changed in the editor still goes to every copy', () => {
        reset();
        const stored = eventOf(ZBYHNEV);
        const draft = sharedDraftFor(DataManager.getData(), ZBYHNEV, stored);
        const form: SharedEventCommon = { type: 'census', date: '1910-12-31', place: 'Horní Kotlinov' };
        DataManager.saveSharedEvent(ZBYHNEV, 'c_z', sharedEditFrom(draft, form, { age: '11' }, stored));
        expect(shareCopiesOf(DataManager.getData(), SHARE).map(c => c.event.date)).toEqual(['1910-12-31', '1910-12-31', '1910-12-31']);
        expect(divergence()).toBeNull();
    });
});

describe('Unify and Separate', () => {
    it('Unify writes the choice to every copy as one undo step; the own fields stay', () => {
        reset();
        const d = divergence()!;
        const n = DataManager.runBatch('Unify', () => DataManager.unifySharedCopies(SHARE, unifyValues(d, unifyDefaults(d, ZBYHNEV))));
        expect(n).toBe(3);
        expect(findDivergentShares(DataManager.getData())).toEqual([]);
        expect(eventOf(ZBYHNEV).date).toBe('1910-12-31');
        expect(eventOf(ZBYHNEV).age).toBe('11');
        DataManager.undo();
        expect(eventOf(ZBYHNEV).date).toBe('1911-01-02');
        expect(divergence()?.fields.map(f => f.field)).toEqual(['date']);
    });

    it('Separate takes the differing copy out of the share, the rest stays shared; one undo brings it back', () => {
        reset();
        const d = divergence()!;
        expect(divergentPersons(d)).toEqual([ZBYHNEV]);
        const n = DataManager.runBatch('Separate', () => DataManager.separateCopies(SHARE, divergentPersons(d)));
        expect(n).toBe(1);
        expect(eventOf(ZBYHNEV).shareId).toBeUndefined();
        expect(eventOf(ZBYHNEV).date).toBe('1911-01-02');
        expect(shareCopiesOf(DataManager.getData(), SHARE).map(c => c.personId)).toEqual([HOSTIVIT, BORIVOJA]);
        expect(divergence()).toBeNull();
        DataManager.undo();
        expect(eventOf(ZBYHNEV).shareId).toBe(SHARE);
    });
});

describe('the Unify dialog and the editor bar', () => {
    it('one differing field: its values with whose they are, no "Take everything from"', () => {
        const data = tree();
        const m = unifyModel(data, shareDivergence(data, SHARE)!, 'en');
        expect(m.fields.map(f => f.field)).toEqual(['date']);
        expect(m.fields[0].options.map(o => o.personIds)).toEqual([[HOSTIVIT, BORIVOJA], [ZBYHNEV]]);
        expect(m.fields[0].options[1].names).toBe('Zbyhněv Šmidlovský');
        expect(m.takeAll).toBeNull();
        expect(m.separatePersons).toEqual([ZBYHNEV]);
        expect(m.persons).toBe(3);
    });

    it('three differing fields offer "Take everything from" each person', () => {
        const data = tree(true);
        const m = unifyModel(data, shareDivergence(data, SHARE)!, 'en');
        expect(m.fields.map(f => f.field).sort()).toEqual(['date', 'note', 'place']);
        expect(m.takeAll?.map(p => p.personId)).toEqual([HOSTIVIT, BORIVOJA, ZBYHNEV]);
    });

    it('the bar names the differing copy and frames only the fields the opened copy differs in', () => {
        const data = tree();
        const d = shareDivergence(data, SHARE)!;
        const fromMajority = editorDivergence(data, d, { personId: HOSTIVIT, eventId: 'c_h' }, 'en');
        expect(fromMajority.text).toContain('Zbyhněv Šmidlovský');
        expect(fromMajority.fields).toEqual([]);
        expect(editorDivergence(data, d, { personId: ZBYHNEV, eventId: 'c_z' }, 'en').fields).toEqual(['date']);
    });
});

describe('the Events table (4b)', () => {
    it('the finding marks the differing copy\'s cells of the differing fields only', () => {
        const data = tree(true);
        const issue = validateTreeData(data).issues.find(i => i.type === 'sharedCopiesDiffer')!;
        expect(issue.shareId).toBe(SHARE);
        const cols = issueTargets(issue, data).map(t => `${t.id}|${t.col}`).sort();
        expect(cols).toEqual([`l:${ZBYHNEV}:c_z|evDate`, `l:${ZBYHNEV}:c_z|evPlace`, `l:${ZBYHNEV}:c_z|evValue`]);

        const index = buildCheckIndex(data, [issue]);
        const m = buildTableModel(data, { rev: 1, homeId: HOSTIVIT, lang: 'en', year: 2026, reliability: { researchTree: false, originFeature: false } });
        const row = [...m.eventRows.values()].find(r => r.source === 'life' && r.refs.length === 3)!;
        expect(row).toBeTruthy();
        for (const col of ['evDate', 'evPlace', 'evValue']) {
            expect(index.cellAll(row, col, null).map(f => f.issue.type)).toEqual(['sharedCopiesDiffer']);
        }
        expect(index.cellAll(row, 'evType', null)).toEqual([]);
        expect(index.cellAll(row, 'evSource', null)).toEqual([]);
    });

    it('copies alike: no finding, no cell', () => {
        const data = tree();
        data.persons[ZBYHNEV]!.events![0].date = '1910-12-31';
        expect(validateTreeData(data).issues.some(i => i.type === 'sharedCopiesDiffer')).toBe(false);
    });
});
