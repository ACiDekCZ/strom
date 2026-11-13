/**
 * A part at another's event recorded as an own event (spec 085 §6, K2.2):
 * the prefill of a godparent or wedding witness event from the baptism or
 * the wedding (the date, the place, the same sources with their quality,
 * roleAt naming the event), the payload the editor saves with it and its
 * toast, nothing created before Save, and the derived row gone once the own
 * record is there. Invented data (the Pšeničný family of Zvonov).
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
import { MARRIAGE_EVENT_ID } from '../shared-events.js';
import { ownRecordPrefill, ownRecordType, derivedParticipations, type OwnRecordPrefill } from '../derived-participations.js';
import { derivedRowsMethods } from '../ui/derived-rows-ui.js';
import { STROM_DATA_VERSION, toPersonId, type LifeEvent, type PartnershipId, type Person, type PersonId, type StromData, type TreeId } from '../types.js';

const TREE = 'record-own-part' as TreeId;
const HM = toPersonId('p_hm');
const BP = toPersonId('p_bp');
const DO = toPersonId('p_do');
const RP = toPersonId('p_rp');
const U1 = 'u1' as PartnershipId;

function person(id: PersonId, firstName: string, lastName: string, gender: 'male' | 'female', extra: Partial<Person> = {}): Person {
    return { id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra };
}

/**
 * Hostivít stood godfather at Bolemír's baptism (cited from two registers,
 * one of them gone from the tree) and witnessed the wedding of Dobrohost and
 * Radmila (cited from the marriage register) and their banns.
 */
function tree(): StromData {
    return {
        version: STROM_DATA_VERSION,
        persons: {
            [HM]: person(HM, 'Hostivít', 'Mrákota', 'male', { birthDate: '1850', deathDate: '1920' }),
            [BP]: person(BP, 'Bolemír', 'Pšeničný', 'male', {
                birthDate: '1890-04-02', deathDate: '1950',
                events: [{
                    id: 'bap', type: 'baptism', date: '1890-04-03', place: 'Zvonov', sourceIds: ['s1', 's2', 'gone'],
                    citationQuay: { sourceIds: { s1: 3, s2: 1, gone: 2 } },
                    participants: [{ id: 'g1', role: 'godparent', name: 'Hostivít Mrákota', personId: HM }],
                }],
            }),
            [DO]: person(DO, 'Dobrohost', 'Ořešník', 'male', { birthDate: '1865', deathDate: '1930', partnerships: [U1] }),
            [RP]: person(RP, 'Radmila', 'Pšeničná', 'female', { birthDate: '1868', deathDate: '1940', partnerships: [U1] }),
        },
        partnerships: {
            [U1]: {
                id: U1, person1Id: DO, person2Id: RP, status: 'married', childIds: [], startDate: '1888-06-10', startPlace: 'Zvonov',
                sourceIds: ['s3'], citationQuay: { sourceIds: { s3: 2 } },
                participants: [{ id: 'w1', role: 'witness', personId: HM }],
                events: [{ id: 'ban', type: 'banns', date: '1888-05-20', participants: [{ id: 'w2', role: 'witness', personId: HM }] }],
            },
        },
        sources: {
            s1: { id: 's1', title: 'Matrika N Zvonov 1880–1895', page: 'fol. 12' },
            s2: { id: 's2', title: 'Duplikát matriky Zvonov' },
            s3: { id: 's3', title: 'Matrika O Zvonov 1870–1900' },
        },
    } as unknown as StromData;
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

/** The editor's save of a new own record: the form's fields plus recordOwnPayload (UI.saveEventFromModal's path). */
function payloadOf(draft: OwnRecordPrefill | null, editingEventId: string | null = null): { payload: Omit<LifeEvent, 'id'>; toast: string | null } {
    const payload: Omit<LifeEvent, 'id'> = { type: draft?.type ?? 'custom', ...(draft?.date ? { date: draft.date } : {}), ...(draft?.place ? { place: draft.place } : {}) };
    const ctx = { recordOwnDraft: draft, editingEventId, currentId: HM };
    const toast = (derivedRowsMethods.recordOwnPayload as (this: unknown, p: Omit<LifeEvent, 'id'>) => string | null).call(ctx, payload);
    return { payload, toast };
}

const baptismPart = { role: 'godparent' as const, ownerPersonId: BP, eventId: 'bap' };
const weddingPart = { role: 'witness' as const, partnershipId: U1, eventId: MARRIAGE_EVENT_ID };

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T10:30:00Z'));
    setLanguage('en');
});
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => reset());

describe('the prefill of an own record', () => {
    it('a godparent at a baptism: its date and place, the same sources with their quality, roleAt naming the baptism', () => {
        expect(ownRecordPrefill(DataManager.getData(), baptismPart)).toEqual({
            type: 'godparent', date: '1890-04-03', place: 'Zvonov',
            sourceIds: ['s1', 's2'], citationQuay: { sourceIds: { s1: 3, s2: 1 } },
            roleAt: { role: 'godparent', personId: BP, eventType: 'baptism', eventId: 'bap' },
        });
    });

    it('a witness at the wedding: the wedding\'s date, place and sources, roleAt naming the couple', () => {
        expect(ownRecordPrefill(DataManager.getData(), weddingPart)).toEqual({
            type: 'weddingWitness', date: '1888-06-10', place: 'Zvonov',
            sourceIds: ['s3'], citationQuay: { sourceIds: { s3: 2 } },
            roleAt: { role: 'witness', partnershipId: U1, eventType: 'marriage', eventId: MARRIAGE_EVENT_ID },
        });
    });

    it('no own type for a witness at the banns or a midwife; none for an event that is gone', () => {
        expect(ownRecordType({ role: 'witness', partnershipId: U1, eventId: 'ban' })).toBeNull();
        expect(ownRecordType({ role: 'other', extra: 'midwife', eventId: 'bap' })).toBeNull();
        expect(ownRecordPrefill(DataManager.getData(), { ...baptismPart, eventId: 'nope' })).toBeNull();
    });
});

describe('the save of an own record', () => {
    it('the payload carries roleAt and copies of the citations; the toast names the type and the person', () => {
        const draft = ownRecordPrefill(DataManager.getData(), baptismPart)!;
        const { payload, toast } = payloadOf(draft);
        expect(payload).toEqual({
            type: 'godparent', date: '1890-04-03', place: 'Zvonov',
            roleAt: { role: 'godparent', personId: BP, eventType: 'baptism', eventId: 'bap' },
            sourceIds: ['s1', 's2'], citationQuay: { sourceIds: { s1: 3, s2: 1 } },
        });
        expect(toast).toBe('Godparent: saved for Hostivít Mrákota.');
        // Copies: the saved event's lists are not the draft's (nor the baptism's).
        expect(payload.sourceIds).not.toBe(draft.sourceIds);
        expect(payload.citationQuay!.sourceIds).not.toBe(draft.citationQuay!.sourceIds);
        expect(payload.roleAt).not.toBe(draft.roleAt);
    });

    it('saved, the derived row of the baptism goes and the baptism keeps its own citations', () => {
        const before = () => derivedParticipations(DataManager.getData(), DataManager.getSharedEventIndex(), HM).map(r => r.eventType);
        expect(before()).toEqual(['banns', 'marriage', 'baptism']);
        const { payload } = payloadOf(ownRecordPrefill(DataManager.getData(), baptismPart));
        const saved = DataManager.addLifeEvent(HM, payload)!;
        expect(DataManager.getPerson(HM)!.events).toEqual([{ ...payload, id: saved.id }]);
        expect(before()).toEqual(['banns', 'marriage']);
        // The wedding too.
        DataManager.addLifeEvent(HM, payloadOf(ownRecordPrefill(DataManager.getData(), weddingPart)).payload);
        expect(before()).toEqual(['banns']);
        const bap = DataManager.getPerson(BP)!.events![0];
        expect(bap.sourceIds).toEqual(['s1', 's2', 'gone']);
        expect(bap.citationQuay).toEqual({ sourceIds: { s1: 3, s2: 1, gone: 2 } });
    });

    it('nothing is created before Save: the prefill and a source removed from it leave the tree as it was', () => {
        const json = JSON.stringify(DataManager.getData());
        const draft = ownRecordPrefill(DataManager.getData(), baptismPart)!;
        draft.sourceIds = draft.sourceIds!.filter(id => id !== 's1');
        delete draft.citationQuay!.sourceIds!.s1;
        expect(JSON.stringify(DataManager.getData())).toBe(json);
        expect(DataManager.getPerson(HM)!.events ?? []).toEqual([]);
    });

    it('an existing event being edited or no draft: no own-record fields and no toast', () => {
        const draft = ownRecordPrefill(DataManager.getData(), baptismPart);
        const edited = payloadOf(draft, 'ev_x');
        expect(edited.toast).toBeNull();
        expect(edited.payload.roleAt).toBeUndefined();
        const none = payloadOf(null);
        expect(none.toast).toBeNull();
        expect(none.payload).toEqual({ type: 'custom' });
    });
});
