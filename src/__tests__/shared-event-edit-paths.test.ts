/**
 * A shared event (spec 085 §4) edited from anywhere: every path that writes
 * a person's event — the Events table's cell, the person dialog's quick
 * residence, a citation from the research, the People table's baptism and
 * burial cells — goes through `updateLifeEvent` or `updateSharedCommonField`,
 * so a common field reaches every copy and an own field one copy. Invented data.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../snapshots.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../snapshots.js')>()),
    createSnapshot: vi.fn(async () => undefined),
}));

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { setLanguage } from '../strings.js';
import { shareCopiesOf } from '../shared-events.js';
import { buildTableModel, type TableModel } from '../ui/table-view/table-model.js';
import { columnById } from '../ui/table-view/table-columns.js';
import { editChangeOf, editTargetOf, editValueOf, type EditTarget } from '../ui/table-view/table-edit.js';
import type { GridLine } from '../ui/table-view/table-subrows.js';
import { STROM_DATA_VERSION, toPersonId, type Person, type PersonId, type StromData, type TreeId } from '../types.js';

const TREE = 'shared-edit-paths' as TreeId;
const OTAKAR = toPersonId('p_otakar');
const LUDMILA = toPersonId('p_ludmila');
const VRATISLAV = toPersonId('p_vratislav');
const SOUSED = toPersonId('p_soused');

function person(id: PersonId, firstName: string, lastName: string, gender: 'male' | 'female', extra: Partial<Person> = {}): Person {
    return { id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra };
}

/**
 * A census of three (one share) with each one's age, and a neighbour's and
 * Otakar's residence written alike without a share id (older data).
 */
function tree(): StromData {
    const census = { type: 'census' as const, date: '1910-12-31', place: 'Horní Kotlinov', shareId: 'sh_census1910', sourceIds: ['s1'] };
    const residence = { type: 'residence' as const, date: '1890', place: 'Mokrá Lhotka', sourceIds: ['s1'] };
    return {
        version: STROM_DATA_VERSION,
        persons: {
            [OTAKAR]: person(OTAKAR, 'Otakar', 'Šmidlovský', 'male', { birthDate: '1870',
                events: [{ id: 'c_o', ...census, age: '40' }, { id: 'r_o', ...residence }] }),
            [LUDMILA]: person(LUDMILA, 'Ludmila', 'Šmidlovská', 'female', { birthDate: '1874', events: [{ id: 'c_l', ...census, age: '36' }] }),
            [VRATISLAV]: person(VRATISLAV, 'Vratislav', 'Šmidlovský', 'male', { birthDate: '1899', events: [{ id: 'c_v', ...census, age: '11', shareRole: 'son' }] }),
            [SOUSED]: person(SOUSED, 'Hostivít', 'Cvrčkal', 'male', { birthDate: '1868', events: [{ id: 'r_s', ...residence }] }),
        },
        partnerships: {},
        sources: { s1: { id: 's1', title: 'Soupis obyvatel 1910' } },
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

const copies = () => shareCopiesOf(DataManager.getData(), 'sh_census1910');
const field = (key: 'date' | 'place' | 'age' | 'note') => copies().map(c => c.event[key]);

const build = (): TableModel =>
    buildTableModel(DataManager.getData(), { rev: 1, homeId: OTAKAR, lang: 'en', year: 2026, reliability: { researchTree: false, originFeature: false } });
const lineOf = (m: TableModel, id: string): GridLine => ({ kind: 'row', row: m.eventRows.get(id)!, union: null, n: 0, expanded: null });
const target = (m: TableModel, id: string, colId: string): EditTarget | null => editTargetOf('events', lineOf(m, id), columnById('events', colId)!);

/** The Events table's save of a cell (UI.tableSaveCell's branch for a person's event). */
function saveCell(t: EditTarget, text: string): number {
    const res = editChangeOf(DataManager.getData(), t, text, 'en');
    if (!res.ok || !res.change || res.change.kind !== 'lifeEvent') return 0;
    const c = res.change;
    return DataManager.updateSharedCommonField(c.personId, c.eventId, c.field, c.value);
}

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T10:30:00Z'));
    setLanguage('en');
});
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => reset());

describe('the Events table cell of a shared event', () => {
    it('the date and the place are edited in place and written to every copy, in one undo step', () => {
        const m = build();
        const row = m.eventRows.get('l:p_ludmila:c_l')!;
        expect(row.shareId).toBe('sh_census1910');
        const t = target(m, 'l:p_ludmila:c_l', 'evDate');
        expect(t).toMatchObject({ field: 'eventDate', input: 'date', personId: OTAKAR, eventId: 'c_o' });
        expect(editValueOf(DataManager.getData(), t!)).not.toBe('');
        expect(saveCell(t!, '1910-12-30')).toBe(3);
        expect(field('date')).toEqual(['1910-12-30', '1910-12-30', '1910-12-30']);
        // Each one's age is their own.
        expect(field('age')).toEqual(['40', '36', '11']);

        expect(saveCell(target(build(), 'l:p_otakar:c_o', 'evPlace')!, 'Dolní Kotlinov')).toBe(3);
        expect(field('place')).toEqual(['Dolní Kotlinov', 'Dolní Kotlinov', 'Dolní Kotlinov']);

        DataManager.undo();
        expect(field('place')).toEqual(['Horní Kotlinov', 'Horní Kotlinov', 'Horní Kotlinov']);
        expect(field('date')).toEqual(['1910-12-30', '1910-12-30', '1910-12-30']);
    });

    it('an emptied place clears it at every copy; an unreadable date saves nothing', () => {
        expect(saveCell(target(build(), 'l:p_otakar:c_o', 'evPlace')!, '')).toBe(3);
        expect(field('place')).toEqual([undefined, undefined, undefined]);
        expect(editChangeOf(DataManager.getData(), target(build(), 'l:p_otakar:c_o', 'evDate')!, 'not a date', 'en')).toEqual({ ok: false, error: 'date' });
    });

    it('a locked person among the copies refuses the write', () => {
        vi.spyOn(DataManager, 'isPersonLocked').mockImplementation(id => id === VRATISLAV);
        expect(saveCell(target(build(), 'l:p_otakar:c_o', 'evDate')!, '1911')).toBe(0);
        expect(field('date')).toEqual(['1910-12-31', '1910-12-31', '1910-12-31']);
    });

    it('a row of copies matched by content only (no share id) is not edited in place; other columns are not either', () => {
        const m = build();
        const guessed = m.eventRows.get('l:p_otakar:r_o')!;
        expect(guessed.shareId).toBeUndefined();
        expect(guessed.refs).toHaveLength(2);
        expect(target(m, 'l:p_otakar:r_o', 'evDate')).toBeNull();
        expect(target(m, 'l:p_otakar:c_o', 'evWho')).toBeNull();
        expect(target(m, 'l:p_otakar:c_o', 'evSource')).toBeNull();
    });
});

describe('the other edit paths (updateLifeEvent)', () => {
    it('a common field goes to every copy, an own field to one copy, in one undo step', () => {
        expect(DataManager.updateLifeEvent(LUDMILA, 'c_l', { date: '1911', age: '37', note: 'house no. 7' })).toBe(true);
        expect(field('date')).toEqual(['1911', '1911', '1911']);
        expect(field('note')).toEqual(['house no. 7', 'house no. 7', 'house no. 7']);
        expect(field('age')).toEqual(['40', '37', '11']);
        DataManager.undo();
        expect(field('date')).toEqual(['1910-12-31', '1910-12-31', '1910-12-31']);
        expect(field('age')).toEqual(['40', '36', '11']);
    });

    it('the quick residence of the person dialog: a shared residence changes at both persons', () => {
        const d = DataManager.getData();
        d.persons[OTAKAR].events!.push({ id: 'q_o', type: 'residence', place: 'Zbraslavice', shareId: 'sh_res' });
        d.persons[LUDMILA].events!.push({ id: 'q_l', type: 'residence', place: 'Zbraslavice', shareId: 'sh_res' });
        // syncQuickEvent writes the newest residence through updateLifeEvent.
        expect(DataManager.updateLifeEvent(LUDMILA, 'q_l', { place: 'Bludov' })).toBe(true);
        expect(shareCopiesOf(DataManager.getData(), 'sh_res').map(c => c.event.place)).toEqual(['Bludov', 'Bludov']);
        // Cleared there: only that person's copy goes, the last one is no longer shared.
        DataManager.removeLifeEvent(LUDMILA, 'q_l');
        const left = DataManager.getData().persons[OTAKAR].events!.find(e => e.id === 'q_o')!;
        expect(left.place).toBe('Bludov');
        expect(left.shareId).toBeUndefined();
    });

    it('a type of one person only is refused for a shared copy; an event not shared is written alone', () => {
        expect(DataManager.updateLifeEvent(OTAKAR, 'c_o', { type: 'baptism' })).toBe(false);
        expect(field('date')).toEqual(['1910-12-31', '1910-12-31', '1910-12-31']);
        expect(DataManager.updateLifeEvent(OTAKAR, 'r_o', { place: 'Suchá Lhotka' })).toBe(true);
        expect(DataManager.getData().persons[SOUSED].events![0].place).toBe('Mokrá Lhotka');
    });
});
