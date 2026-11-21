/**
 * What the "Verify facts" UI decides without the page (spec 065, kolo 3):
 * every row of table 10z as the tree knows the fact (`factOffer`), the
 * research's id of the fact, the name and sex of a research tree, and the
 * small helpers of the preview, the bulk dialog and the toast.
 */
import { describe, it, expect } from 'vitest';
import type { Partnership, Person, ResearchFactVerify } from '../types.js';
import type { FactVerifyInfo } from '../verify.js';
import type { VerifyResearch } from '../verify-offer.js';
import {
    FactOfferInput, bulkScopeOptions, factOffer, personVerifyAskCount, personVerifyCounts, queuedToastDue, verifyCostSplit, verifyFactKind,
    verifyRecordText, verifyTogetherKind,
} from '../verify-ui-model.js';

const FULL: VerifyResearch = { features: ['verify', 'verify.bulk', 'facts.confirm'] };
const CONFIRM_ONLY: VerifyResearch = { features: ['facts.confirm'] };
const OLD: VerifyResearch = { features: ['origin'] };

function person(verify: Record<string, ResearchFactVerify> = {}, extra: Partial<Person> = {}): Person {
    return {
        id: 'p1', firstName: 'Bonifác', lastName: 'Kvapilík', gender: 'male', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], birthDate: '1850-02-03', deathDate: '1912',
        events: [
            { id: 'e1', type: 'baptism', date: '1850-02-05' },
            { id: 'e2', type: 'burial', date: '1912' },
            { id: 'e3', type: 'occupation', note: 'rolník' },
        ],
        researchVerify: verify,
        ...extra,
    } as unknown as Person;
}

function couple(verify: Record<string, ResearchFactVerify> = {}): Partnership {
    return {
        id: 'u1', person1Id: 'p1', person2Id: 'p2', childIds: [], status: 'married', startDate: '1874',
        researchVerify: verify,
    } as unknown as Partnership;
}

/** Every fact of the person with its research id. */
const EIDS: Record<string, ResearchFactVerify> = {
    birth: { eid: 'E0001' }, death: { eid: 'E0002' }, 'event:e1': { eid: 'E0003' }, 'event:e2': { eid: 'E0004' },
    'event:e3': { eid: 'E0005' }, name: { eid: 'E0006' }, sex: { eid: 'E0007' },
};

const input = (o: Partial<FactOfferInput> = {}): FactOfferInput => ({
    step: 'probable', research: FULL, researchTree: true, cited: true, info: {} as FactVerifyInfo, editable: true, ...o,
});

describe('verifyFactKind: the facts the research verifies', () => {
    it('the name, birth, death, a baptism, a burial and a couple\'s marriage; nothing else', () => {
        const p = person();
        expect(verifyFactKind(p, 'birth')).toBe('BIRT');
        expect(verifyFactKind(p, 'death')).toBe('DEAT');
        expect(verifyFactKind(p, 'event:e1')).toBe('BAPM');
        expect(verifyFactKind(p, 'event:e2')).toBe('BURI');
        expect(verifyFactKind(p, 'event:e3')).toBeNull();
        expect(verifyFactKind(p, 'event:missing')).toBeNull();
        expect(verifyFactKind(p, 'name')).toBe('NAME');
        expect(verifyFactKind(p, 'sex')).toBeNull();
        expect(verifyFactKind(couple(), 'marriage')).toBe('MARR');
        expect(verifyFactKind(couple(), 'divorce')).toBeNull();
    });
});

describe('factOffer: table 10z as the tree knows the fact', () => {
    const p = person(EIDS);

    it('row 1: confirmed — only "Undo", through the research when it confirmed it', () => {
        // The app's own confirmation: undone here.
        let o = factOffer(p, 'birth', input({ step: 'human', info: { confirmed: '2026-11-08', confirmedBy: 'app' } }));
        expect(o).toMatchObject({ verify: false, scan: false, undo: true, undoViaBridge: false, row: 'confirmed' });
        // The research's: through the bridge (facts.confirm), by the fact's id.
        o = factOffer(p, 'birth', input({ step: 'human', info: { confirmed: '2026-11-08', confirmedBy: 'research' } }));
        expect(o).toMatchObject({ verify: false, scan: false, undo: true, undoViaBridge: true, eid: 'E0001', row: 'confirmed' });
        // A research without facts.confirm cannot take it back.
        o = factOffer(p, 'birth', input({ step: 'human', research: OLD, info: { confirmed: '2026-11-08', confirmedBy: 'research' } }));
        expect(o.undo).toBe(false);
        // Without the fact's id nothing names it to the research.
        o = factOffer(person(), 'birth', input({ step: 'human', info: { confirmed: '2026-11-08', confirmedBy: 'research' } }));
        expect(o.undo).toBe(false);
        // The app's own confirmation in a tree that cannot be changed: no undo.
        o = factOffer(p, 'birth', input({ step: 'human', editable: false, info: { confirmed: '2026-11-08', confirmedBy: 'app' } }));
        expect(o.undo).toBe(false);
    });

    it('row 2: proven with the research — the scan through the bridge, no Verify', () => {
        const o = factOffer(p, 'birth', input({ step: 'proven' }));
        expect(o).toMatchObject({ verify: false, scan: true, scanViaBridge: true, undo: false, row: null });
        expect(o.cost).toBeUndefined();
    });

    it('row 3: probable / possible — Verify (low when cited, higher without), the scan, the reason', () => {
        for (const step of ['probable', 'possible'] as const) {
            expect(factOffer(p, 'birth', input({ step }))).toMatchObject({ verify: true, cost: 'low', scan: true, scanViaBridge: true, row: null });
            expect(factOffer(p, 'birth', input({ step, cited: false }))).toMatchObject({ verify: true, cost: 'high' });
            expect(factOffer(p, 'birth', input({ step, info: { checked: { result: 'kept', why: 'Only the year in the register' } } })))
                .toMatchObject({ verify: true, row: 'reason' });
        }
    });

    it('row 4: lead — Verify (higher), the scan, the reason when said', () => {
        expect(factOffer(p, 'death', input({ step: 'lead' }))).toMatchObject({ verify: true, cost: 'high', scan: true, row: null });
        expect(factOffer(p, 'death', input({ step: 'lead', info: { checked: { result: 'kept', why: 'Not found' } } })))
            .toMatchObject({ row: 'reason' });
    });

    it('row 5: from the family tree — Verify (low with its citation, higher without), the scan, cited or not', () => {
        expect(factOffer(p, 'event:e1', input({ step: 'import' }))).toMatchObject({ verify: true, cost: 'low', scan: true, row: 'importCited' });
        expect(factOffer(p, 'event:e1', input({ step: 'import', cited: false }))).toMatchObject({ verify: true, cost: 'high', row: 'importUncited' });
    });

    it('a fact without a source (no citation, no record the research read): no "Confirm against the scan"', () => {
        for (const step of ['proven', 'probable', 'possible', 'lead', 'import'] as const) {
            expect(factOffer(p, 'birth', input({ step, cited: false }))).toMatchObject({ scan: false, scanViaBridge: false });
        }
        expect(factOffer(p, 'birth', input({ step: 'probable', cited: false, source: true }))).toMatchObject({ scan: true, scanViaBridge: true });
    });

    it('row 6: no source — Verify (higher), no scan', () => {
        expect(factOffer(p, 'event:e2', input({ step: 'none', cited: false }))).toMatchObject({ verify: true, cost: 'high', scan: false, row: null });
    });

    it('row 7: waiting — from the research\'s file or started here: no Verify, the scan, the waiting row', () => {
        expect(factOffer(p, 'birth', input({ info: { pending: 'asked' } }))).toMatchObject({ verify: false, scan: true, row: 'pending' });
        expect(factOffer(p, 'birth', input({ localPending: true }))).toMatchObject({ verify: false, scan: true, row: 'pending' });
        // Its place in the file (3 _POS 4, queued by the research): "Verify first"; started here or without its id: none (1109).
        const queued = person({ ...EIDS, birth: { eid: 'E0001', pending: 'wait', position: 4 } });
        expect(factOffer(queued, 'birth', input({ info: { pending: 'wait' } })).prioritize).toBe(true);
        expect(factOffer(queued, 'birth', input({ info: { pending: 'wait' }, localPending: true })).prioritize).toBeUndefined();
        expect(factOffer(person({ birth: { pending: 'wait', position: 4 } }), 'birth', input({ info: { pending: 'wait' } })).prioritize).toBeUndefined();
    });

    it('row 8: a research without 065 — no Verify; the scan only with facts.confirm', () => {
        for (const step of ['proven', 'probable', 'possible', 'lead', 'import'] as const) {
            expect(factOffer(p, 'birth', input({ step, research: OLD }))).toMatchObject({ verify: false, scan: false, row: null });
            expect(factOffer(p, 'birth', input({ step, research: CONFIRM_ONLY }))).toMatchObject({ verify: false, scan: true, scanViaBridge: true, row: null });
        }
    });

    it('a research tree whose bridge does not run (offline, Milan 16. 11.): the scan and Undo are the app\'s own, by the fact\'s id', () => {
        const OFFLINE: VerifyResearch = { features: [], offline: true };
        for (const step of ['proven', 'probable', 'possible', 'lead', 'import'] as const) {
            expect(factOffer(p, 'birth', input({ step, research: OFFLINE })))
                .toMatchObject({ verify: false, scan: true, scanViaBridge: false, row: null });
        }
        // Waiting: the scan as well, no "Verify first".
        expect(factOffer(p, 'birth', input({ research: OFFLINE, info: { pending: 'wait' } })))
            .toMatchObject({ verify: false, scan: true, scanViaBridge: false, row: 'pending' });
        // The research's confirmation is taken back here (handed over without its `_STROM_CONFIRMED`); the app's own too.
        expect(factOffer(p, 'birth', input({ step: 'human', research: OFFLINE, info: { confirmed: '2026-10-01', confirmedBy: 'research' } })))
            .toMatchObject({ undo: true, undoViaBridge: false, row: 'confirmed' });
        expect(factOffer(p, 'birth', input({ step: 'human', research: OFFLINE, info: { confirmed: '2026-10-01', confirmedBy: 'app' } })))
            .toMatchObject({ undo: true, undoViaBridge: false });
        // A fact the research does not name (no id): nothing it would read; a tree that cannot be changed: nothing.
        expect(factOffer(person(), 'birth', input({ research: OFFLINE }))).toMatchObject({ scan: false });
        expect(factOffer(person(), 'birth', input({ step: 'human', research: OFFLINE, info: { confirmed: '2026-10-01', confirmedBy: 'research' } })).undo).toBe(false);
        expect(factOffer(p, 'birth', input({ research: OFFLINE, editable: false })).scan).toBe(false);
        expect(factOffer(p, 'birth', input({ step: 'human', research: OFFLINE, editable: false, info: { confirmed: '2026-10-01', confirmedBy: 'research' } })).undo).toBe(false);
        // The sex of a research tree: never. The name by its id (066 K6.3): the app's own as well; without its id never.
        expect(factOffer(p, 'sex', input({ research: OFFLINE })).scan).toBe(false);
        expect(factOffer(person({ name: { eid: 'P0001.N' } }), 'name', input({ research: OFFLINE }))).toMatchObject({ scan: true, scanViaBridge: false });
        expect(factOffer(person(), 'name', input({ research: OFFLINE })).scan).toBe(false);
        // A bridge that answers without facts.confirm (an older research) still offers none.
        expect(factOffer(p, 'birth', input({ research: OLD })).scan).toBe(false);
    });

    it('row 9: no research — the app\'s own scan when cited (a tree that can be changed), and the research row', () => {
        const plain = person();
        for (const step of ['proven', 'probable', 'possible', 'lead', 'import'] as const) {
            const o = factOffer(plain, 'birth', input({ step, research: null, researchTree: false }));
            expect(o).toMatchObject({ verify: false, scan: true, scanViaBridge: false, row: 'noResearch' });
            expect(factOffer(plain, 'birth', input({ step, research: null, researchTree: false, cited: false })))
                .toMatchObject({ scan: false, row: 'noResearch' });
            expect(factOffer(plain, 'birth', input({ step, research: null, researchTree: false, editable: false }))).toMatchObject({ scan: false });
        }
    });

    it('row 10: the person — the count of facts to verify and of those waiting', () => {
        const offers = [
            factOffer(p, 'birth', input()),
            factOffer(p, 'death', input({ step: 'proven' })),
            factOffer(p, 'event:e1', input({ step: 'import', cited: false })),
            factOffer(p, 'event:e2', input({ localPending: true })),
            factOffer(p, 'event:e3', input()),
        ];
        expect(personVerifyCounts(offers)).toEqual({ verify: 2, pending: 1 });
    });

    it('"Verify facts · N": the five main events the research holds (a proven one too), not one confirmed or waiting, no occupation or residence, not the name or sex (Milan 16. 11.)', () => {
        const fact = (f: string, o: Partial<FactOfferInput> = {}) => ({ fact: f, kind: verifyFactKind(p, f), offer: factOffer(p, f, input(o)), step: o.step ?? 'probable' });
        const facts = [
            fact('birth'),
            fact('death', { step: 'proven' }),
            fact('event:e1', { step: 'human', info: { confirmedBy: 'research' } as FactVerifyInfo }),
            fact('event:e2', { localPending: true }),
            fact('event:e3', { step: null }),
            fact('name'),
            fact('sex'),
        ];
        // The birth and the proven death; the occupation (the research holds it) only by "Verify" at the fact.
        expect(personVerifyAskCount(facts)).toBe(2);
        // A residence the research holds: not counted either.
        expect(personVerifyAskCount([...facts, { fact: 'event:r1', kind: null, offer: { verify: false, row: null, eid: 'E0009' }, step: 'lead' }])).toBe(2);
        // A couple's marriage is one of the five.
        const u = couple({ marriage: { eid: 'E0010' } });
        expect(personVerifyAskCount([...facts, { fact: 'marriage', kind: verifyFactKind(u, 'marriage'), offer: factOffer(u, 'marriage', input()), step: 'probable' }])).toBe(3);
        // Nothing offers "Verify": no item, whatever the research would take.
        expect(personVerifyAskCount(facts.filter(f => f.fact !== 'birth'))).toBe(0);
        // A fact without the research's id is none of its facts.
        const noIds = person();
        expect(personVerifyAskCount([{ fact: 'birth', kind: 'BIRT', offer: factOffer(noIds, 'birth', input()), step: 'probable' }])).toBe(0);
    });
});

describe('factOffer: the fact\'s research id and kind', () => {
    it('no "Verify" without the fact\'s id; the scan is then the app\'s own', () => {
        const o = factOffer(person(), 'birth', input());
        expect(o.eid).toBeNull();
        expect(o.verify).toBe(false);
        expect(o.cost).toBeUndefined();
        expect(o).toMatchObject({ scan: true, scanViaBridge: false });
        // ... and none where the tree cannot be changed.
        expect(factOffer(person(), 'birth', input({ editable: false })).scan).toBe(false);
    });

    it('an id that is not one of the research\'s counts as none', () => {
        const o = factOffer(person({ birth: { eid: 'X12' } }), 'birth', input());
        expect(o.eid).toBeNull();
        expect(o.verify).toBe(false);
    });

    it('a fact the research does not verify (an occupation) gets no "Verify", but the scan', () => {
        const o = factOffer(person(EIDS), 'event:e3', input());
        expect(o).toMatchObject({ eid: 'E0005', verify: false, scan: true, scanViaBridge: true });
    });

    it('a couple\'s marriage by its id; its divorce is not verified', () => {
        const u = couple({ marriage: { eid: 'E0100' }, divorce: { eid: 'E0101' } });
        expect(factOffer(u, 'marriage', input())).toMatchObject({ eid: 'E0100', verify: true, cost: 'low', scanViaBridge: true });
        expect(factOffer(u, 'divorce', input()).verify).toBe(false);
    });
});

describe('factOffer: the name and the sex', () => {
    it('in a research tree: neither verified nor confirmed', () => {
        for (const fact of ['name', 'sex']) {
            const o = factOffer(person(EIDS), fact, input({ step: 'import' }));
            expect(o).toMatchObject({ verify: false, scan: false });
            expect(o.cost).toBeUndefined();
        }
    });

    it('in a tree of the app\'s own: the app\'s own confirmation, no Verify', () => {
        for (const fact of ['name', 'sex']) {
            const o = factOffer(person(), fact, input({ step: 'import', research: null, researchTree: false }));
            expect(o).toMatchObject({ verify: false, scan: true, scanViaBridge: false, row: 'noResearch' });
        }
    });
});

describe('the preview and the bulk dialog', () => {
    it('verifyCostSplit: read is low, search is higher', () => {
        expect(verifyCostSplit([])).toEqual({ low: 0, high: 0 });
        expect(verifyCostSplit([{ how: 'read' }, { how: 'search' }, { how: 'read' }])).toEqual({ low: 2, high: 1 });
    });

    it('verifyRecordText: the title, with its page when said', () => {
        expect(verifyRecordText(undefined)).toBe('');
        expect(verifyRecordText({ source: 'S0042', title: 'Matrika N Horní Bříza' })).toBe('Matrika N Horní Bříza');
        expect(verifyRecordText({ source: 'S0042', title: 'Matrika N Horní Bříza', page: 'fol. 12' })).toBe('Matrika N Horní Bříza, fol. 12');
    });

    it('bulkScopeOptions: the line, the lineage, the whole tree (only those named by the research\'s ids)', () => {
        expect(bulkScopeOptions({
            line: { id: 'G3', name: 'Kvapilíkovi' }, lineage: { founderRef: 'P0001', surname: 'Kvapilík' },
        })).toEqual([
            { scope: 'line', of: 'G3', name: 'Kvapilíkovi' },
            { scope: 'lineage', of: 'P0001', name: 'Kvapilík' },
            { scope: 'tree' },
        ]);
        expect(bulkScopeOptions({ line: { id: 'x', name: 'n' }, lineage: { founderRef: null, surname: 'Kvapilík' } })).toEqual([{ scope: 'tree' }]);
        expect(bulkScopeOptions({})).toEqual([{ scope: 'tree' }]);
    });

    it('queuedToastDue: once per run of the research, while facts wait', () => {
        const fix = { at: '2026-11-08T22:41:07.123Z' };
        expect(queuedToastDue(fix, 12, null)).toBe(true);
        expect(queuedToastDue(fix, 12, fix.at)).toBe(false);
        expect(queuedToastDue(fix, 0, null)).toBe(false);
        expect(queuedToastDue(undefined, 12, null)).toBe(false);
        expect(queuedToastDue({ at: '' }, 12, null)).toBe(false);
    });
});

describe('the name with a research that takes names (066 K6.3)', () => {
    /** A research with `name-status`: it verifies and confirms a name by its id. */
    const NAMES: VerifyResearch = { features: [...FULL.features, 'name-status'] };
    const NAMED: Record<string, ResearchFactVerify> = { name: { eid: 'P0012.N' }, birth: { eid: 'E0001' }, death: { eid: 'E0002' } };

    it('a research without `name-status`: nothing at the name, as before (its id names nothing)', () => {
        const o = factOffer(person(NAMED), 'name', input({ step: 'import' }));
        expect(o).toMatchObject({ verify: false, scan: false, eid: null });
        expect(o.cost).toBeUndefined();
    });

    it('with `name-status` and the id: "Verify" from the family tree, probable, possible, a lead, no source — not proven, not confirmed', () => {
        const p = person(NAMED);
        for (const step of ['import', 'probable', 'possible', 'lead'] as const) {
            expect(factOffer(p, 'name', input({ step, research: NAMES })), step).toMatchObject({ verify: true, eid: 'P0012.N', scan: true, scanViaBridge: true });
        }
        expect(factOffer(p, 'name', input({ step: 'none', research: NAMES, cited: false })))
            .toMatchObject({ verify: true, cost: 'high', scan: false });
        expect(factOffer(p, 'name', input({ step: 'proven', research: NAMES })).verify).toBe(false);
        expect(factOffer(p, 'name', input({ step: 'human', research: NAMES, info: { confirmed: '2026-11-21', confirmedBy: 'research' } })))
            .toMatchObject({ verify: false, scan: false, undo: true, undoViaBridge: true, eid: 'P0012.N' });
        // The sex stays as it was.
        expect(factOffer(person({ ...NAMED, sex: { eid: 'E0007' } }), 'sex', input({ step: 'import', research: NAMES })))
            .toMatchObject({ verify: false, scan: false });
    });

    it('without the name\'s id: no "Verify"; the scan is the app\'s own', () => {
        const o = factOffer(person(), 'name', input({ step: 'probable', research: NAMES }));
        expect(o).toMatchObject({ eid: null, verify: false, scan: true, scanViaBridge: false });
    });

    it('its bridge not running: with the id the app\'s own scan, no "Verify"; without the id nothing', () => {
        const offline: VerifyResearch = { features: [], offline: true };
        expect(factOffer(person(NAMED), 'name', input({ step: 'import', research: offline })))
            .toMatchObject({ verify: false, scan: true, scanViaBridge: false, eid: 'P0012.N' });
        expect(factOffer(person(), 'name', input({ step: 'import', research: offline }))).toMatchObject({ verify: false, scan: false });
        // A tree that cannot be changed here: no scan without the bridge.
        expect(factOffer(person(NAMED), 'name', input({ step: 'import', research: offline, editable: false })).scan).toBe(false);
    });

    it('"Confirm against the scan" (§3): with a record and `facts.confirm` through the bridge by the id; without a record none', () => {
        const p = person(NAMED);
        expect(factOffer(p, 'name', input({ step: 'probable', research: NAMES })))
            .toMatchObject({ scan: true, scanViaBridge: true, eid: 'P0012.N' });
        // The record the research read the name from (no citation of the name itself).
        expect(factOffer(p, 'name', input({ step: 'probable', research: NAMES, cited: false, source: true })).scan).toBe(true);
        expect(factOffer(p, 'name', input({ step: 'import', research: NAMES, cited: false, source: false })).scan).toBe(false);
        // Through the bridge, a tree that cannot be changed here is confirmed too (the research writes it).
        expect(factOffer(p, 'name', input({ step: 'probable', research: NAMES, editable: false })))
            .toMatchObject({ scan: true, scanViaBridge: true });
        // A research without `facts.confirm`: no scan.
        expect(factOffer(p, 'name', input({ step: 'probable', research: { features: ['verify', 'name-status'] } })).scan).toBe(false);
    });

    it('"Verify facts (N)": the name with its id counts, without its id or from an older research it does not', () => {
        const fact = (p: Person, f: string, research: VerifyResearch, step: 'probable' | 'proven' = 'probable') =>
            ({ fact: f, kind: verifyFactKind(p, f), offer: factOffer(p, f, input({ step, research })), step });
        const p = person(NAMED);
        const base = [fact(p, 'birth', NAMES, 'proven'), fact(p, 'death', NAMES)];
        expect(personVerifyAskCount(base)).toBe(2);
        expect(personVerifyAskCount([...base, fact(p, 'name', NAMES)])).toBe(3);
        expect(personVerifyAskCount([...base, fact(person({ birth: { eid: 'E0001' } }), 'name', NAMES)])).toBe(2);
        expect(personVerifyAskCount([fact(p, 'birth', FULL, 'proven'), fact(p, 'death', FULL), fact(p, 'name', FULL)])).toBe(2);
    });
});

describe('verifyTogetherKind: what the preview says a fact goes with (066 K6.3)', () => {
    const NAME = { fact: 'P0012.N', kind: 'NAME' };
    it('by `with`: the name with the birth, the baptism, the christening, and the birth with the name', () => {
        expect(verifyTogetherKind([{ ...NAME, with: 'E0034' }, { fact: 'E0034', kind: 'BIRT', with: 'P0012.N' }], 'P0012.N')).toBe('BIRT');
        expect(verifyTogetherKind([{ ...NAME, with: 'E0035' }, { fact: 'E0035', kind: 'BAPM' }], 'P0012.N')).toBe('BAPM');
        expect(verifyTogetherKind([{ ...NAME, with: 'E0036' }, { fact: 'E0036', kind: 'CHR' }], 'P0012.N')).toBe('CHR');
        expect(verifyTogetherKind([{ fact: 'E0034', kind: 'BIRT', with: 'P0012.N' }, { ...NAME, with: 'E0034' }], 'E0034')).toBe('NAME');
    });

    it('without `with`: a name beside a birth or baptism of the same answer', () => {
        expect(verifyTogetherKind([NAME, { fact: 'E0034', kind: 'BIRT' }], 'P0012.N')).toBe('BIRT');
        expect(verifyTogetherKind([{ fact: 'E0035', kind: 'BAPM' }, NAME], 'E0035')).toBe('NAME');
    });

    it('nothing else: the name alone, a death beside it, `with` naming a fact not in the answer, a fact not in the answer', () => {
        expect(verifyTogetherKind([NAME], 'P0012.N')).toBeNull();
        expect(verifyTogetherKind([NAME, { fact: 'E0040', kind: 'DEAT' }], 'P0012.N')).toBeNull();
        expect(verifyTogetherKind([{ ...NAME, with: 'E0099' }], 'P0012.N')).toBeNull();
        expect(verifyTogetherKind([{ fact: 'E0034', kind: 'BIRT' }, { fact: 'E0035', kind: 'BAPM' }], 'E0034')).toBeNull();
        expect(verifyTogetherKind([NAME, { fact: 'E0034', kind: 'BIRT' }], 'E0777')).toBeNull();
    });
});

describe('table 6.1: the name in each kind of tree (066 K6.3 §6)', () => {
    const NAMES: VerifyResearch = { features: [...FULL.features, 'name-status'] };
    const OFFLINE_NOW: VerifyResearch = { features: [], offline: true };
    const NAMED: Record<string, ResearchFactVerify> = { name: { eid: 'P0012.N' }, birth: { eid: 'E0001' } };
    const BY_APP = { confirmed: '2026-11-21', confirmedBy: 'app' } as FactVerifyInfo;
    const BY_RESEARCH = { confirmed: '2026-11-21', confirmedBy: 'research' } as FactVerifyInfo;
    type Tree = { research: VerifyResearch | null; researchTree: boolean; editable: boolean; verify: Record<string, ResearchFactVerify> };
    const trees: Record<string, Tree> = {
        'without a research': { research: null, researchTree: false, editable: true, verify: {} },
        'an older research (no name-status)': { research: FULL, researchTree: true, editable: true, verify: NAMED },
        'a new research, its bridge running': { research: NAMES, researchTree: true, editable: true, verify: NAMED },
        'a new research, its bridge not running': { research: OFFLINE_NOW, researchTree: true, editable: true, verify: NAMED },
        'read only (an exported page, the book)': { research: null, researchTree: false, editable: false, verify: {} },
    };
    /** Verify, the scan (and whether through the bridge), Undo of the app's own and of the research's confirmation. */
    const row = (t: Tree) => {
        const p = person(t.verify);
        const at = (o: Partial<FactOfferInput>) => factOffer(p, 'name', input({ research: t.research, researchTree: t.researchTree, editable: t.editable, ...o }));
        const open = at({ step: 'import' });
        const app = at({ step: 'human', info: BY_APP });
        const research = at({ step: 'human', info: BY_RESEARCH });
        return {
            verify: open.verify, scan: open.scan, scanViaBridge: open.scanViaBridge, aside: open.row === 'noResearch',
            undoApp: app.undo, undoResearch: research.undo, undoViaBridge: research.undo && research.undoViaBridge,
        };
    };
    const expected: Record<string, ReturnType<typeof row>> = {
        // The app's own confirmation where the tree can be changed; the sentence with the way to the research.
        'without a research': { verify: false, scan: true, scanViaBridge: false, aside: true, undoApp: true, undoResearch: false, undoViaBridge: false },
        // Only an earlier confirmation of the app's own is taken back.
        'an older research (no name-status)': { verify: false, scan: false, scanViaBridge: false, aside: false, undoApp: true, undoResearch: false, undoViaBridge: false },
        'a new research, its bridge running': { verify: true, scan: true, scanViaBridge: true, aside: false, undoApp: true, undoResearch: true, undoViaBridge: true },
        // The name with its id: the app's own confirmation, handed over with the tree; the research's as at a birth.
        'a new research, its bridge not running': { verify: false, scan: true, scanViaBridge: false, aside: false, undoApp: true, undoResearch: true, undoViaBridge: false },
        'read only (an exported page, the book)': { verify: false, scan: false, scanViaBridge: false, aside: true, undoApp: false, undoResearch: false, undoViaBridge: false },
    };
    for (const [name, t] of Object.entries(trees)) {
        it(name, () => { expect(row(t)).toEqual(expected[name]); });
    }

    it('the name is offered as the birth is, in every kind of tree (Verify, the scan, Undo)', () => {
        for (const t of Object.values(trees)) {
            if (t.researchTree && !t.research?.features.includes('name-status') && !t.research?.offline) continue;
            const p = person(t.verify);
            for (const o of [{ step: 'import' as const }, { step: 'human' as const, info: BY_APP }, { step: 'human' as const, info: BY_RESEARCH }]) {
                const opts = input({ research: t.research, researchTree: t.researchTree, editable: t.editable, ...o });
                const { verify, scan, undo, scanViaBridge, undoViaBridge } = factOffer(p, 'birth', opts);
                expect(factOffer(p, 'name', opts)).toMatchObject({ verify, scan, undo, scanViaBridge, undoViaBridge });
            }
        }
    });

    it('without a research the name has a kind, so its tip says the research would verify it (§6.1, question 7)', () => {
        expect(verifyFactKind(person(), 'name')).toBe('NAME');
        expect(factOffer(person(), 'name', input({ step: 'import', research: null, researchTree: false })).row).toBe('noResearch');
    });
});
