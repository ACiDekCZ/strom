import { describe, it, expect } from 'vitest';
import {
    RELIABILITY_ORDER, reliabilityStep, weakestStep, sameStep, factReliability, personOriginSummary, cardReliability,
    partnershipReliability, wasAccepted, ReliabilityInput, ReliabilityStep, ReliabilityOptions,
} from '../reliability.js';
import type { ImportRecord, Partnership, Person, StromData } from '../types.js';

const RESEARCH: ReliabilityOptions = { researchTree: true, originFeature: true };
const RESEARCH_OLD: ReliabilityOptions = { researchTree: true, originFeature: false };
const PLAIN: ReliabilityOptions = { researchTree: false, originFeature: false };

const I1: ImportRecord = { id: 'I1', program: 'Rodokmenar', fileDate: '12 MAR 2024', at: '2026-10-01' };
const R1: ImportRecord = { id: 'R1', program: 'Rodokmenar', at: '2026-11-01' };

const person = (extra: Partial<Person> = {}): Person => ({
    id: 'p1', firstName: 'Hostivít', lastName: 'Šmudlák', gender: 'male',
    parentIds: [], childIds: [], partnerships: [], ...extra,
}) as unknown as Person;

describe('reliabilityStep', () => {
    const cases: [string, ReliabilityInput, ReliabilityStep | null][] = [
        ['nothing known', {}, null],
        ['confirmed by a person', { confirmedByHuman: true }, { step: 'human' }],
        ['the person\'s origin (a revert, an accepted proposal)', { origin: 'user' }, { step: 'human' }],
        ['the person\'s origin beats a status', { origin: 'user', status: 'lead' }, { step: 'human' }],
        ['confirmed, the value also the file\'s', { confirmedByHuman: true, origin: 'import' }, { step: 'human', fromImport: true }],
        ['proven, readers not said', { status: 'proven' }, { step: 'proven', dots: 1 }],
        ['proven by two readers', { status: 'proven', readers: 2 }, { step: 'proven', dots: 2 }],
        ['proven by three readers: two dots', { readers: 3 }, { step: 'proven', dots: 2 }],
        ['one reader without a status', { readers: 1 }, { step: 'proven', dots: 1 }],
        ['proven, from the import', { status: 'proven', origin: 'import' }, { step: 'proven', dots: 1, fromImport: true }],
        ['probable', { status: 'probable' }, { step: 'probable' }],
        ['possible from the import', { status: 'possible', origin: 'import' }, { step: 'possible', fromImport: true }],
        ['from the import, no status', { origin: 'import' }, { step: 'import' }],
        ['from the import, a lead', { origin: 'import', status: 'lead' }, { step: 'import' }],
        ['from the import, changed since', { origin: 'import', valueFromImport: false }, null],
        ['changed since, a lead', { origin: 'import', valueFromImport: false, status: 'lead' }, { step: 'lead' }],
        ['a tree without the research: the file\'s value', { valueFromImport: true }, { step: 'import' }],
        ['the research\'s value: the file\'s value says nothing', { origin: 'research', valueFromImport: true }, null],
        ['the research\'s lead', { origin: 'research', status: 'lead' }, { step: 'lead' }],
        ['a lead', { status: 'lead' }, { step: 'lead' }],
        ['no source', { noSource: true }, { step: 'none' }],
        ['a lead before no source', { status: 'lead', noSource: true }, { step: 'lead' }],
        ['the import before no source', { origin: 'import', noSource: true }, { step: 'import' }],
        ['readers not a number', { readers: Number.NaN }, null],
    ];
    for (const [label, input, out] of cases) {
        it(label, () => expect(reliabilityStep(input)).toEqual(out));
    }
});

describe('weakestStep', () => {
    it('follows the table, proven by one reader weaker than by two', () => {
        expect(RELIABILITY_ORDER).toEqual(['human', 'proven', 'probable', 'possible', 'import', 'lead', 'none']);
        expect(weakestStep([{ step: 'human' }, { step: 'import' }, { step: 'proven', dots: 2 }])).toEqual({ step: 'import' });
        expect(weakestStep([{ step: 'proven', dots: 2 }, { step: 'proven', dots: 1 }])).toEqual({ step: 'proven', dots: 1 });
        expect(weakestStep([{ step: 'lead' }, { step: 'none' }])).toEqual({ step: 'none' });
        expect(weakestStep([null, { step: 'human' }, undefined])).toEqual({ step: 'human' });
        expect(weakestStep([null, null])).toBeNull();
        expect(weakestStep([])).toBeNull();
    });

    it('sameStep compares the step and the dots', () => {
        expect(sameStep({ step: 'import' }, { step: 'import', fromImport: true })).toBe(true);
        expect(sameStep({ step: 'proven', dots: 1 }, { step: 'proven' })).toBe(true);
        expect(sameStep({ step: 'proven', dots: 1 }, { step: 'proven', dots: 2 })).toBe(false);
        expect(sameStep(null, null)).toBe(true);
        expect(sameStep(null, { step: 'lead' })).toBe(false);
    });
});

describe('factReliability without the research', () => {
    const data: Pick<StromData, 'imports'> = { imports: [I1] };

    it('the file\'s value with its record: from family tree', () => {
        const p = person({ birthDate: '1851-02-02', birthPlace: 'Bramborov', importedValues: {
            birthDate: { from: 'I1', value: '1851-02-02' }, birthPlace: { from: 'I1', value: 'Bramborov' },
        } });
        expect(factReliability(data, p, 'birth', PLAIN)).toEqual({ step: 'import', importRecord: I1, fromParts: ['DATE', 'PLAC'], changedParts: [] });
    });

    it('partly changed in the app: from family tree, with the changed part', () => {
        const p = person({ birthDate: '1851-02-03', birthPlace: 'Bramborov', importedValues: {
            birthDate: { from: 'I1', value: '1851-02-02' }, birthPlace: { from: 'I1', value: 'Bramborov' },
        } });
        expect(factReliability(data, p, 'birth', PLAIN)).toMatchObject({ step: 'import', fromParts: ['PLAC'], changedParts: ['DATE'] });
    });

    it('all changed, no record, or a research status: no mark', () => {
        const changed = person({ birthDate: '1852', importedValues: { birthDate: { from: 'I1', value: '1851-02-02' } } });
        expect(factReliability(data, changed, 'birth', PLAIN)).toBeNull();
        const noRecord = person({ birthDate: '1851', importedValues: { birthDate: { from: 'I9', value: '1851' } } });
        expect(factReliability(data, noRecord, 'birth', PLAIN)).toBeNull();
        expect(factReliability({}, noRecord, 'birth', PLAIN)).toBeNull();
        const statusOnly = person({ birthDate: '1851', birthStatus: 'proven' });
        expect(factReliability(data, statusOnly, 'birth', PLAIN)).toBeNull();
    });

    it('a research tree whose bridge has no origin: only the import step, its origins not read', () => {
        const p = person({ birthDate: '1851', birthStatus: 'proven', importedValues: { birthDate: { from: 'I1', value: '1851' } },
            researchOrigins: { birth: { kind: 'user' }, death: { kind: 'import', importId: 'I1' } }, deathDate: '1910' });
        expect(factReliability(data, p, 'birth', RESEARCH_OLD)).toMatchObject({ step: 'import' });
        expect(factReliability(data, p, 'death', RESEARCH_OLD)).toBeNull();
    });
});

describe('factReliability in the research\'s tree with origin', () => {
    const data: Pick<StromData, 'imports'> = { imports: [I1, R1] };

    it('from the import as the research says it, with its record and parts', () => {
        const p = person({ birthDate: '1851', birthPlace: 'Bramborov',
            researchOrigins: { birth: { kind: 'import', importId: 'I1', parts: ['PLAC'] } } });
        expect(factReliability(data, p, 'birth', RESEARCH)).toEqual({ step: 'import', importRecord: I1, fromParts: ['PLAC'], changedParts: ['DATE'] });
    });

    it('proven by a record that changed it: the earlier value and the record', () => {
        const was = { value: '1850', importId: 'I1', parts: ['DATE' as const], ref: 'E0001' };
        const p = person({ birthDate: '1851', birthStatus: 'proven',
            researchOrigins: { birth: { kind: 'research', was, sourceIds: ['s1'] } } });
        expect(factReliability(data, p, 'birth', RESEARCH)).toEqual({ step: 'proven', dots: 1, fromParts: [], changedParts: [], was, sourceIds: ['s1'] });
    });

    it('an accepted proposal: the person\'s, the earlier value kept', () => {
        const was = { value: '1850', importId: 'I1' };
        const p = person({ birthDate: '1851', researchOrigins: { birth: { kind: 'user', was } } });
        expect(factReliability(data, p, 'birth', RESEARCH)).toMatchObject({ step: 'human', was, accepted: true });
        expect(wasAccepted({ kind: 'research', was })).toBe(false);
        expect(wasAccepted({ kind: 'user' })).toBe(false);
        expect(wasAccepted(undefined)).toBe(false);
    });

    it('the research\'s own value: its status alone; nothing without one', () => {
        const p = person({ birthDate: '1851', birthStatus: 'probable', deathDate: '1910',
            importedValues: { deathDate: { from: 'I1', value: '1910' } } });
        expect(factReliability(data, p, 'birth', RESEARCH)).toMatchObject({ step: 'probable' });
        // The app's mark says nothing where the research says the value is its own.
        expect(factReliability(data, p, 'death', RESEARCH)).toBeNull();
    });

    it('an import the tree has no record of: no mark', () => {
        const p = person({ birthDate: '1851', researchOrigins: { birth: { kind: 'import', importId: 'I7' } } });
        expect(factReliability(data, p, 'birth', RESEARCH)).toBeNull();
    });

    it('the evidence of 065, when given', () => {
        const p = person({ birthDate: '1851', birthStatus: 'proven' });
        const opts = { ...RESEARCH, evidence: () => ({ readers: 2 }) };
        expect(factReliability(data, p, 'birth', opts)).toMatchObject({ step: 'proven', dots: 2 });
    });

    it('a person\'s event and a couple\'s wedding', () => {
        const p = person({ events: [{ id: 'e1', type: 'occupation', note: 'mlynář', status: 'lead' }] as never,
            researchOrigins: { 'event:e1': { kind: 'import', importId: 'R1' } } });
        expect(factReliability(data, p, 'event:e1', RESEARCH)).toMatchObject({ step: 'import', importRecord: R1, fromParts: ['VAL'] });
        const ps = { id: 'u1', person1Id: 'p1', person2Id: 'p2', childIds: [], status: 'married', startDate: '1875', startStatus: 'possible',
            researchOrigins: { marriage: { kind: 'import', importId: 'I1', parts: ['DATE'] } } } as unknown as Partnership;
        expect(factReliability(data, ps, 'marriage', RESEARCH)).toMatchObject({ step: 'possible', fromImport: true, importRecord: I1 });
        expect(partnershipReliability(data, ps, RESEARCH).map(r => r.fact)).toEqual(['marriage']);
    });
});

describe('personOriginSummary and the card mark', () => {
    const data: Pick<StromData, 'imports'> = { imports: [I1] };
    const fromFile = (extra: Partial<Person> = {}): Person => {
        const base = person({ birthDate: '1851', deathDate: '1910', ...extra });
        base.importedValues = {
            firstName: { from: 'I1', value: 'Hostivít' }, lastName: { from: 'I1', value: 'Šmudlák' }, gender: { from: 'I1', value: 'male' },
            birthDate: { from: 'I1', value: '1851' }, deathDate: { from: 'I1', value: '1910' },
        };
        return base;
    };

    it('everything from the file: one mark in the row', () => {
        const s = personOriginSummary(data, fromFile(), PLAIN);
        expect(s.allSameStep).toEqual({ step: 'import' });
        expect(s.importRecord).toBe(I1);
        expect(s.facts.map(f => f.fact)).toEqual(['name', 'sex', 'birth', 'death']);
    });

    it('a fact changed in the app: mixed, the row still names the import', () => {
        const s = personOriginSummary(data, fromFile({ deathDate: '1911' }), PLAIN);
        expect(s.allSameStep).toBeUndefined();
        expect(s.importRecord).toBe(I1);
        expect(s.facts.map(f => f.fact)).toEqual(['name', 'sex', 'birth']);
    });

    it('nothing from a file: no row, no marks', () => {
        const s = personOriginSummary(data, person({ birthDate: '1851' }), PLAIN);
        expect(s).toEqual({ facts: [] });
    });

    it('the same other step everywhere (research): one mark, no import row', () => {
        const p = person({ birthDate: '1851', birthStatus: 'proven', researchOrigins: { name: { kind: 'research' } } });
        const opts = { ...RESEARCH, evidence: () => ({ readers: 2 }) };
        const s = personOriginSummary(data, p, opts);
        expect(s.allSameStep).toEqual({ step: 'proven', dots: 2 });
        expect(s.importRecord).toBeUndefined();
    });

    it('carries the kind of an open conflict on the fact', () => {
        const p = fromFile({ research: { conflicts: [
            { id: 'X1', fact: 'BIRT', status: 'open', values: [], kind: 'import' },
            { id: 'X2', fact: 'DEAT', status: 'decided', values: [], kind: 'user' },
        ] } } as never);
        const s = personOriginSummary(data, p, PLAIN);
        expect(s.facts.find(f => f.fact === 'birth')?.conflictKind).toBe('import');
        expect(s.facts.find(f => f.fact === 'death')?.conflictKind).toBeUndefined();
    });

    it('the card: the weakest of name, birth and death', () => {
        const data2: Pick<StromData, 'imports'> = { imports: [I1] };
        const p = fromFile({ birthStatus: 'proven', researchOrigins: {
            name: { kind: 'user' }, birth: { kind: 'research' }, death: { kind: 'import', importId: 'I1' },
        } });
        expect(cardReliability(data2, p, RESEARCH)).toMatchObject({ step: 'import' });
        expect(cardReliability(data2, person(), RESEARCH)).toBeNull();
        expect(cardReliability(data2, fromFile(), PLAIN)).toMatchObject({ step: 'import' });
    });
});
