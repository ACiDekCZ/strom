/**
 * The research's confirmation of a fact (`2 _STROM_CONFIRMED`, spec 065)
 * holds while the fact keeps the value the research's file gave it with, as
 * the app's own hand confirmation does: a change of the value here ends it
 * (no ✓, no `human` step, the scan offered again, not handed to the research
 * in its file), the value changed back restores it. A tree stored before the
 * value was kept gets it once when read: from the kept copy of the research's
 * version, else the current value (N1 of 1109).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../research-copy.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../research-copy.js')>()),
    loadResearchCopy: vi.fn(async () => null),
}));

import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData, DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { loadResearchCopy } from '../research-copy.js';
import { StromData, Person, Partnership, PersonId, PartnershipId, TreeId, toPersonId, toPartnershipId } from '../types.js';
import {
    factVerifyInfo, factValueSignature, handedConfirmations, confirmationEdits, researchConfirmation,
    fillResearchConfirmedValues, hasUnvaluedResearchConfirmations,
} from '../verify.js';
import { factReliability } from '../reliability.js';
import { factOffer } from '../verify-ui-model.js';
import { contentFingerprint } from '../research-link.js';
import { diffByPerson } from '../research-changes.js';

const Z = toPersonId('p_zbyhnev');
const B = toPersonId('p_borislava');
const U = toPartnershipId('u_zb');

/** A research tree: Zbyhněv's birth, baptism and the couple's marriage confirmed in the research. */
function tree(withValues = true): StromData {
    const persons = {
        [Z]: { id: Z, firstName: 'Zbyhněv', lastName: 'Lanýžek', gender: 'male', birthDate: '1850-01-01', birthPlace: 'Kvasilov',
            birthStatus: 'probable', partnerships: [U], parentIds: [], childIds: [],
            events: [{ id: 'ev_bap', type: 'baptism', date: '1850-01-03', place: 'Kvasilov' }] },
        [B]: { id: B, firstName: 'Bořislava', lastName: 'Hvězdoňová', gender: 'female', partnerships: [U], parentIds: [], childIds: [] },
    } as unknown as Record<PersonId, Person>;
    const partnerships: Record<PartnershipId, Partnership> = {
        [U]: { id: U, person1Id: Z, person2Id: B, childIds: [], status: 'married', startDate: '1875-05-02', startPlace: 'Úlehle' },
    };
    const d: StromData = { persons, partnerships };
    const z = d.persons[Z];
    const u = d.partnerships[U];
    const v = (h: Person | Partnership, fact: string) => (withValues ? { value: factValueSignature(h, fact) } : {});
    z.researchVerify = {
        birth: { confirmed: '2026-10-01', eid: 'E1', ...v(z, 'birth') },
        'event:ev_bap': { confirmed: '2026-10-03', eid: 'E2', ...v(z, 'event:ev_bap') },
    };
    u.researchVerify = { marriage: { confirmed: '2026-10-02', eid: 'E3', ...v(u, 'marriage') } };
    return d;
}

const OPTS = { researchTree: false, originFeature: false };
const BRIDGE = { features: ['verify', 'facts.confirm'] };

/** The offer of the fact's tip as the page builds it (verify-ui verifyFactView). */
function offerOf(h: Person | Partnership, fact: string) {
    const step = factReliability({}, h, fact, OPTS)?.step ?? null;
    return factOffer(h, fact, { step, research: BRIDGE, researchTree: true, cited: false, info: factVerifyInfo(h, fact), editable: true });
}

describe("a change of the value ends the research's confirmation", () => {
    it("a person's birth: no confirmation, not handed over, not human; the scan again; back to the value restores it", () => {
        const z = tree().persons[Z];
        expect(factVerifyInfo(z, 'birth')).toEqual({ confirmed: '2026-10-01', confirmedBy: 'research' });
        expect(factReliability({}, z, 'birth', OPTS)?.step).toBe('human');
        expect(offerOf(z, 'birth')).toMatchObject({ undo: true, scan: false, undoViaBridge: true });

        z.birthDate = '1852';
        expect(researchConfirmation(z, 'birth')).toBeNull();
        expect(factVerifyInfo(z, 'birth')).toEqual({});
        expect(handedConfirmations(z)).toEqual({ 'event:ev_bap': '2026-10-03' });
        // Goes to the research without its _STROM_CONFIRMED (read there against _STROM_HEAD).
        expect(confirmationEdits(z)).toEqual({ birth: '' });
        expect(factReliability({}, z, 'birth', OPTS)?.step).toBe('probable');
        expect(offerOf(z, 'birth')).toMatchObject({ undo: false, scan: true, scanViaBridge: true });

        z.birthDate = '1850-01-01';
        expect(factVerifyInfo(z, 'birth')).toEqual({ confirmed: '2026-10-01', confirmedBy: 'research' });
        expect(confirmationEdits(z)).toEqual({});
    });

    it('a place changed is a changed value too', () => {
        const z = tree().persons[Z];
        z.birthPlace = 'Kvasilov u Brna';
        expect(factVerifyInfo(z, 'birth').confirmed).toBeUndefined();
    });

    it("a couple's marriage", () => {
        const u = tree().partnerships[U];
        u.startDate = '1876-05-02';
        expect(factVerifyInfo(u, 'marriage')).toEqual({});
        expect(handedConfirmations(u)).toEqual({});
        expect(confirmationEdits(u)).toEqual({ marriage: '' });
        u.startDate = '1875-05-02';
        expect(factVerifyInfo(u, 'marriage').confirmedBy).toBe('research');
    });

    it('a life event', () => {
        const z = tree().persons[Z];
        z.events![0].date = '1850-01-04';
        expect(factVerifyInfo(z, 'event:ev_bap')).toEqual({});
        expect(handedConfirmations(z)).toEqual({ birth: '2026-10-01' });
    });

    it('the stored value survives storing and loading', () => {
        const back = migrateData(JSON.parse(JSON.stringify(tree())));
        expect(back.persons[Z].researchVerify?.birth?.value).toBe('1850-01-01\u001fKvasilov');
        back.persons[Z].birthDate = '1852';
        const again = migrateData(JSON.parse(JSON.stringify(back)));
        expect(factVerifyInfo(again.persons[Z], 'birth')).toEqual({});
    });

    it('the changes since the research: the birth, no further "other" for the confirmation it ended', () => {
        const base = tree();
        const now = tree();
        now.persons[Z].birthDate = '1852';
        expect(diffByPerson(base, now).map(c => [c.personId, c.kinds])).toEqual([[Z, ['birth']]]);
        // A tree in step stays in step.
        expect(contentFingerprint(tree())).toBe(contentFingerprint(tree(false)));
    });
});

describe('a tree stored before the value was kept', () => {
    it('is told by an entry with a confirmation and no value', () => {
        expect(hasUnvaluedResearchConfirmations(tree())).toBe(false);
        expect(hasUnvaluedResearchConfirmations(tree(false))).toBe(true);
    });

    it("the kept copy of the research's version gives the value: a fact changed since is not confirmed", () => {
        const base = tree(false);
        const d = tree(false);
        d.persons[Z].birthDate = '1852';
        d.partnerships[U].startPlace = 'Hrbolcov';
        expect(fillResearchConfirmedValues(d, base)).toBe(true);
        expect(d.persons[Z].researchVerify?.birth?.value).toBe('1850-01-01\u001fKvasilov');
        expect(factVerifyInfo(d.persons[Z], 'birth')).toEqual({});
        expect(factVerifyInfo(d.partnerships[U], 'marriage')).toEqual({});
        // Unchanged since: still confirmed.
        expect(factVerifyInfo(d.persons[Z], 'event:ev_bap').confirmedBy).toBe('research');
        expect(fillResearchConfirmedValues(d, base)).toBe(false);
    });

    it('without a copy: the current value (taken as unchanged), also on migrateData', () => {
        const d = tree(false);
        d.persons[Z].birthDate = '1852';
        const back = migrateData(JSON.parse(JSON.stringify(d)));
        expect(back.persons[Z].researchVerify?.birth?.value).toBe('1852\u001fKvasilov');
        expect(factVerifyInfo(back.persons[Z], 'birth').confirmedBy).toBe('research');
        back.persons[Z].birthDate = '1853';
        expect(factVerifyInfo(back.persons[Z], 'birth')).toEqual({});
    });

    describe('TreeManager.readTreeData', () => {
        const TREE = 'legacy-verify' as TreeId;
        let saved: StromData[];
        beforeEach(() => {
            saved = [];
            vi.spyOn(TreeManager, 'saveTreeData').mockImplementation((_id, data) => { saved.push(JSON.parse(JSON.stringify(data))); });
        });
        afterEach(() => { vi.restoreAllMocks(); });

        const stored = (): StromData => {
            const d = tree(false);
            d.persons[Z].birthDate = '1852';
            return d;
        };
        const read = async (data: StromData): Promise<StromData> => {
            vi.spyOn(TreeManager as unknown as { readTreeRecord: () => Promise<unknown> }, 'readTreeRecord')
                .mockResolvedValue({ status: 'ok', data });
            const result = await TreeManager.readTreeData(TREE);
            if (result.status !== 'ok') throw new Error(result.status);
            return result.data;
        };

        it("fills from the research's copy and saves the tree once", async () => {
            vi.mocked(loadResearchCopy).mockResolvedValueOnce(tree(false));
            const data = await read(stored());
            expect(loadResearchCopy).toHaveBeenCalledWith(TREE);
            expect(factVerifyInfo(data.persons[Z], 'birth')).toEqual({});
            expect(saved).toHaveLength(1);
            expect(saved[0].persons[Z].researchVerify?.birth?.value).toBe('1850-01-01\u001fKvasilov');
            // Read again (stored with the values): nothing more to do.
            vi.mocked(loadResearchCopy).mockClear();
            await read(saved[0]);
            expect(loadResearchCopy).not.toHaveBeenCalled();
            expect(saved).toHaveLength(1);
        });

        it('without a copy: the current value', async () => {
            vi.mocked(loadResearchCopy).mockResolvedValueOnce(null);
            const data = await read(stored());
            expect(factVerifyInfo(data.persons[Z], 'birth').confirmedBy).toBe('research');
            expect(saved[0].persons[Z].researchVerify?.birth?.value).toBe('1852\u001fKvasilov');
        });
    });
});

describe("the research's file", () => {
    const FILE = `0 HEAD
1 SOUR STROM_RESEARCH
2 VERS 1.30.0
2 NAME Strom Research
1 DATE 8 NOV 2026
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Hromoslav /Ozubec/
1 SEX M
1 BIRT
2 DATE 3 MAR 1850
2 PLAC Kvasilov
2 _STROM_CONFIRMED 2026-11-08
2 _STROM_EID E0012
1 BAPM
2 DATE 5 MAR 1850
2 _STROM_CONFIRMED 2026-11-07
2 _STROM_EID E0013
1 FAMS @F1@
0 @I2@ INDI
1 NAME Libuna /Šťovíková/
1 SEX F
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 2 MAY 1875
2 _STROM_CONFIRMED 2026-11-06
2 _STROM_EID E0020
0 TRLR
`;
    const load = (): StromData => convertToStrom(parseGedcom(FILE)).data;
    const hromoslav = (d: StromData): Person => Object.values(d.persons).find(p => p.firstName === 'Hromoslav')!;
    /** The lines of the fact with research id `eid` in what goes to the research. */
    const sentFact = (d: StromData, eid: string): string => {
        const ged = exportToGedcom(d, 'Ozubec', { research: { id: 'r1', head: 'abc' } } as never).content;
        return ged.split(/\r?\n(?=1 )/).find(b => b.includes(`2 _STROM_EID ${eid}`))!;
    };

    it('keeps the value each confirmation was given with', () => {
        const d = load();
        const h = hromoslav(d);
        expect(h.researchVerify?.birth?.value).toBe('1850-03-03\u001fKvasilov');
        const bap = h.events!.find(e => e.type === 'baptism')!;
        expect(h.researchVerify?.[`event:${bap.id}`]?.value).toBe(factValueSignature(h, `event:${bap.id}`));
        expect(Object.values(d.partnerships)[0].researchVerify?.marriage?.value).toBe('1875-05-02\u001f');
    });

    it('a fact changed here goes to the research without its _STROM_CONFIRMED, the others with theirs', () => {
        const d = load();
        expect(sentFact(d, 'E0012')).toMatch(/^2 _STROM_CONFIRMED 2026-11-08$/m);
        const h = hromoslav(d);
        h.birthDate = '1852';
        Object.values(d.partnerships)[0].startDate = '1876';
        expect(sentFact(d, 'E0012')).toMatch(/^2 DATE 1852$/m);
        expect(sentFact(d, 'E0012')).not.toMatch(/_STROM_CONFIRMED/);
        expect(sentFact(d, 'E0020')).not.toMatch(/_STROM_CONFIRMED/);
        expect(sentFact(d, 'E0013')).toMatch(/^2 _STROM_CONFIRMED 2026-11-07$/m);
        // The app's own GEDCOM file neither.
        const own = exportToGedcom(d, 'Ozubec', { origins: true, confirmations: true }).content;
        expect(own).not.toMatch(/1 BIRT[^]*?2 _STROM_CONFIRMED 2026-11-08/);
    });
});

describe('DataManager', () => {
    const TREE = 'research-confirm-value' as TreeId;
    beforeEach(() => {
        vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
        vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
        const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
        dm.data = tree();
        dm.currentTreeId = TREE;
        dm.viewMode = false;
        dm.pendingBefore = null;
        UndoManager.setActiveTree(null);
        UndoManager.setActiveTree(TREE);
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it('an edit of the value ends the confirmation, undo brings it back; one ended is not taken back', () => {
        DataManager.updatePerson(Z, { birthDate: '1852' });
        expect(factVerifyInfo(DataManager.getPerson(Z)!, 'birth')).toEqual({});
        expect(DataManager.unconfirmFact({ personId: Z }, 'birth')).toBe(false);
        expect(DataManager.getPerson(Z)!.confirmed).toBeUndefined();
        DataManager.undo();
        expect(factVerifyInfo(DataManager.getPerson(Z)!, 'birth').confirmedBy).toBe('research');
        // While valid it is taken back as before.
        expect(DataManager.unconfirmFact({ personId: Z }, 'birth')).toBe(true);
        expect(DataManager.getPerson(Z)!.confirmed).toEqual({ birth: { at: '2026-10-01', withdrawn: true } });
    });

    it("confirming the new value by hand is the app's own", () => {
        DataManager.updatePerson(Z, { birthDate: '1852' });
        expect(DataManager.confirmFact({ personId: Z }, 'birth', '2026-11-09')).toBe(true);
        expect(factVerifyInfo(DataManager.getPerson(Z)!, 'birth')).toEqual({ confirmed: '2026-11-09', confirmedBy: 'app' });
    });
});
