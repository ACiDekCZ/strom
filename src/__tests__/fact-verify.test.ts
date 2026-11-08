/**
 * Confirmation and re-verification of facts (spec 065, data version 16):
 * the hand confirmation lasts while the value does, the research's state is
 * read per fact, the migration only cleans, the reliability step follows,
 * and neither the content fingerprint nor the sync diff counts them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migrateData, DataManager } from '../data.js';
import { StromData, Person, Partnership, PersonId, PartnershipId, TreeId, toPersonId, toPartnershipId, STROM_DATA_VERSION } from '../types.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { strings } from '../strings.js';
import {
    factConfirmation, factValueSignature, factVerifyInfo, factVerifyReaders, pendingFacts, factSourceIds,
    sanitizeResearchVerify, parseConfirmedDay, parseVerifyPending, parseCheckedResult, parseReaders,
    parsePendingPosition, researchFactRef,
} from '../verify.js';
import { factReliability } from '../reliability.js';
import { contentFingerprint } from '../research-link.js';
import { diffByPerson, diffOther } from '../research-changes.js';
import { applyLivingPrivacy } from '../privacy.js';

const Z = toPersonId('p_zbyhnev');
const B = toPersonId('p_borislava');
const U = toPartnershipId('u_zb');

function tree(): StromData {
    const persons = {
        [Z]: { id: Z, firstName: 'Zbyhněv', lastName: 'Lanýžek', gender: 'male', birthDate: '1850-01-01', birthPlace: 'Kvasilov',
            deathDate: '1910', isDeceased: true, birthSourceIds: ['s1'],
            partnerships: [U], parentIds: [], childIds: [],
            events: [{ id: 'ev_bap', type: 'baptism', date: '1850-01-03', place: 'Kvasilov', sourceIds: ['s1'] }] },
        [B]: { id: B, firstName: 'Bořislava', lastName: 'Hvězdoňová', gender: 'female', birthDate: '2001-04-04',
            partnerships: [U], parentIds: [], childIds: [] },
    } as unknown as Record<PersonId, Person>;
    const partnerships: Record<PartnershipId, Partnership> = {
        [U]: { id: U, person1Id: Z, person2Id: B, childIds: [], status: 'married', startDate: '1875-05-02', startPlace: 'Úlehle' },
    };
    return { persons, partnerships, sources: { s1: { id: 's1', title: 'Matrika N 1850' } } as unknown as StromData['sources'] };
}

const OPTS = { researchTree: false, originFeature: false };
const RESEARCH = { researchTree: true, originFeature: true };

describe('data version 16', () => {
    it('is 16', () => {
        expect(STROM_DATA_VERSION).toBe(16);
    });

    it('a v15 tree loads unchanged (nothing is added)', () => {
        const d = migrateData(tree());
        expect(d.persons[Z].confirmed).toBeUndefined();
        expect(d.persons[Z].researchVerify).toBeUndefined();
        expect(d.partnerships[U].confirmed).toBeUndefined();
    });

    it('keeps valid confirmations and verification states, drops the rest', () => {
        const raw = tree() as unknown as { persons: Record<string, Record<string, unknown>>; partnerships: Record<string, Record<string, unknown>> };
        raw.persons[Z].confirmed = {
            birth: { at: '2026-11-08', value: 'x' },
            death: { at: 'yesterday' },                 // not a day
            'event:ev_gone': { at: '2026-11-08' },      // no such fact
            name: 'yes',                                // not an entry
        };
        raw.persons[Z].researchVerify = {
            birth: { pending: 'asked', checked: { result: 'kept', why: ' stays ', date: '2026-11-01', readers: 2 } },
            death: { pending: 'soon', confirmed: '2026-13' },
            'event:ev_bap': { checked: { result: 'proven', why: 'not for proven', readers: 0 } },
        };
        raw.partnerships[U].confirmed = { marriage: { at: '2026-11-07', value: 'v' } };
        raw.partnerships[U].researchVerify = 'broken';
        const d = migrateData(raw);
        expect(d.persons[Z].confirmed).toEqual({ birth: { at: '2026-11-08', value: 'x' } });
        expect(d.persons[Z].researchVerify).toEqual({
            birth: { pending: 'asked', checked: { result: 'kept', why: 'stays', date: '2026-11-01', readers: 2 } },
            'event:ev_bap': { checked: { result: 'proven' } },
        });
        expect(d.partnerships[U].confirmed).toEqual({ marriage: { at: '2026-11-07', value: 'v' } });
        expect(d.partnerships[U].researchVerify).toBeUndefined();
    });
});

describe('a hand confirmation lasts while the value does', () => {
    it('signature: the parts in order, empty without a value', () => {
        const d = tree();
        expect(factValueSignature(d.persons[Z], 'birth')).toBe('1850-01-01\u001fKvasilov');
        expect(factValueSignature(d.persons[Z], 'name')).toBe('Zbyhněv\u001fLanýžek');
        expect(factValueSignature(d.persons[Z], 'event:ev_bap')).toBe('1850-01-03\u001fKvasilov');
        expect(factValueSignature(d.partnerships[U], 'marriage')).toBe('1875-05-02\u001fÚlehle');
        expect(factValueSignature(d.partnerships[U], 'divorce')).toBe('');
    });

    it('a changed value ends it; the same value again restores it', () => {
        const z = tree().persons[Z];
        z.confirmed = { birth: { at: '2026-11-08', value: factValueSignature(z, 'birth') } };
        expect(factConfirmation(z, 'birth')).toEqual({ at: '2026-11-08', value: '1850-01-01\u001fKvasilov' });
        z.birthPlace = 'Kvasilov u Brna';
        expect(factConfirmation(z, 'birth')).toBeNull();
        expect(factVerifyInfo(z, 'birth')).toEqual({});
        z.birthPlace = 'Kvasilov';
        expect(factVerifyInfo(z, 'birth')).toEqual({ confirmed: '2026-11-08', confirmedBy: 'app' });
    });

    it('one with no stored value holds while the fact has any', () => {
        const z = tree().persons[Z];
        z.confirmed = { birth: { at: '2026-11-08' } };
        expect(factConfirmation(z, 'birth')).not.toBeNull();
        z.birthDate = undefined; z.birthPlace = undefined;
        expect(factConfirmation(z, 'birth')).toBeNull();
    });
});

describe('the research state of a fact (factVerifyInfo)', () => {
    it('reads confirmed, pending and the last check; the app confirmation wins', () => {
        const z = tree().persons[Z];
        z.researchVerify = {
            birth: { confirmed: '2026-10-01', checked: { result: 'proven', date: '2026-09-30', readers: 2 } },
            death: { pending: 'images' },
        };
        expect(factVerifyInfo(z, 'birth')).toEqual({
            confirmed: '2026-10-01', confirmedBy: 'research', checked: { result: 'proven', date: '2026-09-30', readers: 2 },
        });
        expect(factVerifyInfo(z, 'death')).toEqual({ pending: 'images' });
        expect(pendingFacts(z)).toEqual(['death']);
        expect(factVerifyReaders(z, 'birth')).toBe(2);
        z.confirmed = { birth: { at: '2026-11-08', value: factValueSignature(z, 'birth') } };
        expect(factVerifyInfo(z, 'birth').confirmedBy).toBe('app');
        expect(factVerifyInfo(z, 'birth').confirmed).toBe('2026-11-08');
    });

    it('readers only from a proven check', () => {
        const z = tree().persons[Z];
        z.researchVerify = { birth: { checked: { result: 'kept', why: 'Two records disagree', readers: 2 } } };
        expect(factVerifyReaders(z, 'birth')).toBeUndefined();
    });

    it('the sources of a fact: its own list and the research origin', () => {
        const d = tree();
        expect(factSourceIds(d.persons[Z], 'birth')).toEqual(['s1']);
        expect(factSourceIds(d.persons[Z], 'death')).toEqual([]);
        expect(factSourceIds(d.persons[Z], 'event:ev_bap')).toEqual(['s1']);
        d.persons[Z].researchOrigins = { death: { kind: 'research', sourceIds: ['s1'] } };
        expect(factSourceIds(d.persons[Z], 'death')).toEqual(['s1']);
    });

    it('parses the GEDCOM values', () => {
        expect(parseConfirmedDay(' 2026-11-08 ')).toBe('2026-11-08');
        expect(parseConfirmedDay('8 NOV 2026')).toBeNull();
        expect(parseVerifyPending('permission')).toBe('permission');
        expect(parseVerifyPending('later')).toBeNull();
        expect(parseCheckedResult('KEPT')).toBe('kept');
        expect(parseCheckedResult('maybe')).toBeNull();
        expect(parseReaders('2')).toBe(2);
        expect(parseReaders('0')).toBeNull();
        expect(parseReaders('two')).toBeNull();
        expect(sanitizeResearchVerify({})).toBeNull();
        expect(parsePendingPosition(' 3 ')).toBe(3);
        expect(parsePendingPosition('0')).toBeNull();
        expect(parsePendingPosition('first')).toBeNull();
        expect(researchFactRef(' E0012 ')).toBe('E0012');
        expect(researchFactRef('P0012')).toBeNull();
    });

    it('keeps the id alone, and a place only while the agent is to take the fact', () => {
        expect(sanitizeResearchVerify({ eid: 'E7' })).toEqual({ eid: 'E7' });
        expect(sanitizeResearchVerify({ eid: 'F7' })).toBeNull();
        expect(sanitizeResearchVerify({ pending: 'wait', position: 2 })).toEqual({ pending: 'wait', position: 2 });
        expect(sanitizeResearchVerify({ pending: 'images', position: 2 })).toEqual({ pending: 'images' });
        expect(sanitizeResearchVerify({ pending: 'asked', position: 1.5 })).toEqual({ pending: 'asked' });
        expect(sanitizeResearchVerify({ position: 2 })).toBeNull();
    });
});

describe('reliability step from the confirmation (confirmedByHuman)', () => {
    it('a tree without the research: a hand confirmation is the person step', () => {
        const z = tree().persons[Z];
        expect(factReliability({}, z, 'birth', OPTS)).toBeNull();
        z.confirmed = { birth: { at: '2026-11-08', value: factValueSignature(z, 'birth') } };
        expect(factReliability({}, z, 'birth', OPTS)?.step).toBe('human');
        z.birthDate = '1850-01-02';
        expect(factReliability({}, z, 'birth', OPTS)).toBeNull();
    });

    it('the research tree: its confirmation is human, a proven check gives the readers', () => {
        const z = tree().persons[Z];
        z.birthStatus = 'probable';
        expect(factReliability({}, z, 'birth', RESEARCH)?.step).toBe('probable');
        z.researchVerify = { birth: { confirmed: '2026-10-01' } };
        expect(factReliability({}, z, 'birth', RESEARCH)?.step).toBe('human');
        z.researchVerify = { birth: { checked: { result: 'proven', readers: 2 } } };
        z.birthStatus = 'proven';
        expect(factReliability({}, z, 'birth', RESEARCH)).toMatchObject({ step: 'proven', dots: 2 });
    });

    it('a couple fact likewise', () => {
        const u = tree().partnerships[U];
        u.confirmed = { marriage: { at: '2026-11-08', value: factValueSignature(u, 'marriage') } };
        expect(factReliability({}, u, 'marriage', OPTS)?.step).toBe('human');
    });

    it('a caller evidence still counts, and undefined fields do not override', () => {
        const z = tree().persons[Z];
        z.confirmed = { birth: { at: '2026-11-08', value: factValueSignature(z, 'birth') } };
        const opts = { ...OPTS, evidence: () => ({ confirmedByHuman: undefined, noSource: true }) };
        expect(factReliability({}, z, 'birth', opts)?.step).toBe('human');
        expect(factReliability({}, z, 'death', opts)?.step).toBe('none');
    });
});

describe('neither the fingerprint nor the sync diff counts them', () => {
    it('confirming a fact leaves the tree in step with the research', () => {
        const d = tree();
        const before = contentFingerprint(d);
        d.persons[Z].confirmed = { birth: { at: '2026-11-08', value: 'x' } };
        d.persons[Z].researchVerify = { death: { pending: 'wait' } };
        d.partnerships[U].confirmed = { marriage: { at: '2026-11-08' } };
        d.partnerships[U].researchVerify = { marriage: { confirmed: '2026-11-08' } };
        expect(contentFingerprint(d)).toBe(before);
    });

    it('the person changes against the base list nothing', () => {
        const base = tree();
        const now = tree();
        now.persons[Z].confirmed = { birth: { at: '2026-11-08', value: 'x' } };
        now.persons[Z].researchVerify = { death: { pending: 'wait' } };
        expect(diffByPerson(base, now)).toEqual([]);
        expect(diffOther(base, now)).toEqual(diffOther(base, tree()));
    });
});

describe('privacy: a confirmation does not carry a hidden value', () => {
    it('a living person loses the confirmations of what was hidden', () => {
        const d = tree();
        const b = d.persons[B];
        // Unmarried: a wedding in 1875 would date her as long dead.
        d.partnerships = {};
        d.persons[Z].partnerships = [];
        b.partnerships = [];
        b.confirmed = { birth: { at: '2026-11-08', value: factValueSignature(b, 'birth') } };
        b.researchVerify = { birth: { checked: { result: 'kept', why: 'born 2001-04-04 per the register' } } };
        const out = applyLivingPrivacy(d, 'anonymous', 2026);
        expect(out.persons[B].confirmed).toBeUndefined();
        expect(out.persons[B].researchVerify).toBeUndefined();
        expect(out.persons[B].birthDate).toBeUndefined();
    });
});

describe('DataManager: "Verified from the scan" and taking it back', () => {
    const TREE = 'verify-test' as TreeId;
    let audit: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
        audit = vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
        const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
        dm.data = tree();
        dm.currentTreeId = TREE;
        dm.viewMode = false;
        dm.pendingBefore = null;
        UndoManager.setActiveTree(null);
        UndoManager.setActiveTree(TREE);
    });

    it('confirms a person fact with the day and its value, undo takes it away', () => {
        expect(DataManager.confirmFact({ personId: Z }, 'birth', '2026-11-08')).toBe(true);
        const z = DataManager.getPerson(Z)!;
        expect(z.confirmed).toEqual({ birth: { at: '2026-11-08', value: '1850-01-01\u001fKvasilov' } });
        expect(factReliability({}, z, 'birth', OPTS)?.step).toBe('human');
        expect(audit).toHaveBeenCalledWith(TREE, 'fact.confirm', strings.auditLog.confirmedFact('Zbyhněv Lanýžek (*1850)'));
        DataManager.undo();
        expect(DataManager.getPerson(Z)!.confirmed).toBeUndefined();
        DataManager.redo();
        expect(DataManager.getPerson(Z)!.confirmed?.birth?.at).toBe('2026-11-08');
    });

    it('confirms a couple fact; take back removes it with undo', () => {
        expect(DataManager.confirmFact({ partnershipId: U }, 'marriage', '2026-11-08')).toBe(true);
        expect(DataManager.getPartnership(U)!.confirmed?.marriage?.value).toBe('1875-05-02\u001fÚlehle');
        expect(DataManager.unconfirmFact({ partnershipId: U }, 'marriage')).toBe(true);
        expect(DataManager.getPartnership(U)!.confirmed).toBeUndefined();
        expect(audit).toHaveBeenLastCalledWith(TREE, 'fact.unconfirm', strings.auditLog.unconfirmedFact('Zbyhněv Lanýžek (*1850) & Bořislava Hvězdoňová (*2001)'));
        DataManager.undo();
        expect(DataManager.getPartnership(U)!.confirmed?.marriage?.at).toBe('2026-11-08');
    });

    it('refuses a fact with no value, an unknown fact, a bad day, nothing to take back', () => {
        expect(DataManager.confirmFact({ personId: Z }, 'divorce', '2026-11-08')).toBe(false);
        expect(DataManager.confirmFact({ partnershipId: U }, 'divorce', '2026-11-08')).toBe(false);
        expect(DataManager.confirmFact({ personId: B }, 'death', '2026-11-08')).toBe(false);
        expect(DataManager.confirmFact({ personId: Z }, 'birth', '8. 11. 2026')).toBe(false);
        expect(DataManager.unconfirmFact({ personId: Z }, 'birth')).toBe(false);
        expect(DataManager.confirmFact({ personId: Z }, 'event:ev_bap', '2026-11-08')).toBe(true);
        expect(DataManager.confirmFact({ personId: Z }, 'event:ev_bap', '2026-11-08')).toBe(false);   // already so
    });

    it('an edit of the value ends the confirmation; confirming again takes the new value', () => {
        DataManager.confirmFact({ personId: Z }, 'birth', '2026-11-08');
        DataManager.updatePerson(Z, { birthDate: '1850-01-02' });
        expect(factVerifyInfo(DataManager.getPerson(Z)!, 'birth')).toEqual({});
        expect(DataManager.confirmFact({ personId: Z }, 'birth', '2026-11-08')).toBe(true);
        expect(factVerifyInfo(DataManager.getPerson(Z)!, 'birth').confirmed).toBe('2026-11-08');
    });

    it('a locked person is not confirmed', () => {
        (DataManager as unknown as { data: StromData }).data.persons[Z].isLocked = true;
        expect(DataManager.confirmFact({ personId: Z }, 'birth', '2026-11-08')).toBe(false);
    });
});
