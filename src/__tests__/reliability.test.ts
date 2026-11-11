import { describe, it, expect } from 'vitest';
import {
    RELIABILITY_ORDER, reliabilityStep, weakestStep, sameStep, factReliability, personOriginSummary, cardReliability,
    cardStatus, CardStatusOptions, partnershipReliability, reliabilityOptionsOf, treeCarriesResearchOrigin, wasAccepted, ReliabilityInput, ReliabilityStep, ReliabilityOptions,
} from '../reliability.js';
import { factCitations } from '../import-origin.js';
import type { ImportRecord, Partnership, Person, PersonId, StromData } from '../types.js';

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

    it('all changed or no record: no mark', () => {
        const changed = person({ birthDate: '1852', importedValues: { birthDate: { from: 'I1', value: '1851-02-02' } } });
        expect(factReliability(data, changed, 'birth', PLAIN)).toBeNull();
        const noRecord = person({ birthDate: '1851', importedValues: { birthDate: { from: 'I9', value: '1851' } } });
        expect(factReliability(data, noRecord, 'birth', PLAIN)).toBeNull();
        expect(factReliability({}, noRecord, 'birth', PLAIN)).toBeNull();
    });

    it('a status a file of the research gave stays, with the import "from family tree" behind it', () => {
        const statusOnly = person({ birthDate: '1851', birthStatus: 'proven' });
        expect(factReliability(data, statusOnly, 'birth', PLAIN)).toEqual({ step: 'proven', dots: 1, fromParts: [], changedParts: [] });
        const leadFromFile = person({ birthDate: '1851', birthStatus: 'lead', importedValues: { birthDate: { from: 'I1', value: '1851' } } });
        expect(factReliability(data, leadFromFile, 'birth', PLAIN)).toMatchObject({ step: 'import', importRecord: I1 });
        const leadChanged = person({ birthDate: '1852', birthStatus: 'lead', importedValues: { birthDate: { from: 'I1', value: '1851' } } });
        expect(factReliability(data, leadChanged, 'birth', PLAIN)).toMatchObject({ step: 'lead', fromParts: [] });
    });

    it('a research tree whose bridge has no origin: its status and the import, its origins not read', () => {
        const p = person({ birthDate: '1851', birthStatus: 'proven', importedValues: { birthDate: { from: 'I1', value: '1851' } },
            researchOrigins: { birth: { kind: 'user' }, death: { kind: 'import', importId: 'I1' } }, deathDate: '1910' });
        expect(factReliability(data, p, 'birth', RESEARCH_OLD)).toMatchObject({ step: 'proven', fromImport: true, importRecord: I1 });
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

    it('a value of the user\'s own family tree (origin user, no earlier value): the family tree\'s, never ✓ (1109, A)', () => {
        const fromTree = person({ birthDate: '1851', researchOrigins: { name: { kind: 'user' }, birth: { kind: 'user' } } });
        expect(factReliability(data, fromTree, 'birth', RESEARCH)).toEqual({ step: 'import', fromParts: [], changedParts: [] });
        expect(factReliability(data, fromTree, 'name', RESEARCH)).toMatchObject({ step: 'import' });
        // Its status says more: that step; a confirmation stays ✓.
        const proven = person({ birthDate: '1851', birthStatus: 'proven', researchOrigins: { birth: { kind: 'user' } } });
        expect(factReliability(data, proven, 'birth', RESEARCH)).toMatchObject({ step: 'proven', dots: 1 });
        const lead = person({ birthDate: '1851', birthStatus: 'lead', researchOrigins: { birth: { kind: 'user' } } });
        expect(factReliability(data, lead, 'birth', RESEARCH)).toMatchObject({ step: 'import' });
        expect(factReliability(data, fromTree, 'birth', { ...RESEARCH, evidence: () => ({ confirmedByHuman: true }) }))
            .toMatchObject({ step: 'human' });
        const p = person({ birthDate: '1851', researchOrigins: { name: { kind: 'user' }, birth: { kind: 'user' } } });
        const t = { persons: { p1: p }, partnerships: {}, imports: [], sources: {} } as unknown as StromData;
        expect(cardStatus(t, p, { ...RESEARCH, treeHasSources: false })?.cls).toBe('cs-import');
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

describe('cardStatus: the one mark of a tree card (spec 066 P4 §1, table 1b)', () => {
    // The cited entries and their QUAY (Source.quality): s1 an original (3), s2 a copy with primary
    // information (2), s0 a family tree (0), sA an authored work (1), sX a citation without a QUAY.
    const SOURCES = {
        s1: { id: 's1', title: 'Křty Lhota 1851', quality: 3 }, s2: { id: 's2', title: 'Opis', quality: 2 },
        s0: { id: 's0', title: 'Rodokmen', quality: 0 }, sA: { id: 'sA', title: 'Kronika', quality: 1 },
        sX: { id: 'sX', title: 'Bez QUAY' },
    };
    const tree = (imports: ImportRecord[], ...persons: Person[]): StromData => ({
        persons: Object.fromEntries(persons.map(p => [p.id, p])), partnerships: {}, imports, sources: SOURCES,
    }) as unknown as StromData;
    const fromFile = (extra: Partial<Person> = {}): Person => {
        const base = person({ birthDate: '1851', ...extra });
        base.importedValues = {
            firstName: { from: 'I1', value: 'Hostivít' }, lastName: { from: 'I1', value: 'Šmudlák' }, gender: { from: 'I1', value: 'male' },
            birthDate: { from: 'I1', value: '1851' },
        };
        return base;
    };
    const opts = (extra: Partial<CardStatusOptions> = {}): CardStatusOptions => ({ ...PLAIN, treeHasSources: false, ...extra });
    const cls = (data: StromData, p: Person, o: CardStatusOptions) => cardStatus(data, p, o)?.cls ?? null;

    it('a person\'s confirmation on every fact: ✓', () => {
        const p = person({ birthDate: '1851', researchOrigins: { name: { kind: 'research' }, birth: { kind: 'research' } } });
        expect(cls(tree([I1], p), p, opts({ ...RESEARCH, evidence: () => ({ confirmedByHuman: true }) }))).toBe('cs-human');
        // The person's change of an imported value (the earlier value kept): ✓ too.
        const changed = person({ birthDate: '1851', researchOrigins: { name: { kind: 'user', was: { value: 'x' } }, birth: { kind: 'user', was: { value: 'x' } } } });
        expect(cls(tree([I1], changed), changed, opts(RESEARCH))).toBe('cs-human');
    });

    it('a person\'s confirmation everywhere stays ✓ beside citations', () => {
        const p = person({ birthDate: '1851', birthSourceIds: ['s1'], researchOrigins: { name: { kind: 'user', was: { value: 'x' } }, birth: { kind: 'user', was: { value: 'x' } } } });
        expect(cls(tree([I1], p), p, opts({ ...RESEARCH, treeHasSources: true }))).toBe('cs-human');
    });

    it('proven everywhere: ●● with one reader as with two (the readers stay in the words, K5.1)', () => {
        const p = person({ birthDate: '1851', birthStatus: 'proven', researchOrigins: { name: { kind: 'research' } } });
        const proven = (readers: number) => ({ ...RESEARCH, evidence: () => ({ readers }) });
        expect(cls(tree([I1], p), p, opts(proven(2)))).toBe('cs-p2');
        expect(cardStatus(tree([I1], p), p, opts(proven(1))))
            .toMatchObject({ cls: 'cs-p2', source: 'step', step: { step: 'proven', dots: 1 }, facts: ['name', 'birth'] });
        const plain = person({ birthDate: '1851', deathDate: '1910', birthStatus: 'proven', deathStatus: 'proven' });
        expect(cls(tree([I1], plain), plain, opts(proven(1)))).toBe('cs-p2');
    });

    it('K5.1: a probable birth read from the register, a proven death and a cited name without a step: ●○', () => {
        const p = person({
            birthDate: '1851', birthStatus: 'probable', birthSourceIds: ['s1'],
            deathDate: '1910', deathStatus: 'proven', sourceIds: ['s1'],
            researchOrigins: { name: { kind: 'research' } },
        });
        const s = cardStatus(tree([I1], p), p, opts({ ...RESEARCH, treeHasSources: true }));
        expect(s).toMatchObject({ cls: 'cs-p1', source: 'step', step: { step: 'probable' }, facts: ['birth'] });
        // Only a possible birth read from a copy with primary information (QUAY 2): its step stays for the words.
        const birthOnly = person({ birthDate: '1851', birthStatus: 'possible', birthSourceIds: ['s2'], researchOrigins: { name: { kind: 'research' } } });
        expect(cardStatus(tree([I1], birthOnly), birthOnly, opts(RESEARCH)))
            .toMatchObject({ cls: 'cs-p1', step: { step: 'possible' }, facts: ['birth'] });
        // The record the research changed the fact by is a citation too.
        const bySrc = person({ birthDate: '1851', birthStatus: 'probable',
            researchOrigins: { name: { kind: 'research' }, birth: { kind: 'research', sourceIds: ['s1'] } } });
        expect(cls(tree([I1], bySrc), bySrc, opts(RESEARCH))).toBe('cs-p1');
    });

    it('K5.1: a proven birth and death beside a cited name without a step: ●● (a fact without a step does not count)', () => {
        const p = person({
            birthDate: '1851', birthStatus: 'proven', birthSourceIds: ['s1'],
            deathDate: '1910', deathStatus: 'proven', deathSourceIds: ['s1'], sourceIds: ['s1'],
            researchOrigins: { name: { kind: 'research' } },
        });
        expect(cardStatus(tree([I1], p), p, opts({ ...RESEARCH, treeHasSources: true })))
            .toMatchObject({ cls: 'cs-p2', source: 'step', step: { step: 'proven' }, facts: ['birth', 'death'] });
        // An uncited name without a step does not count either.
        const bare = person({ birthDate: '1851', birthStatus: 'proven', deathDate: '1910', deathStatus: 'proven' });
        expect(cls(tree([I1], bare), bare, opts(RESEARCH))).toBe('cs-p2');
    });

    it('K5.1: "read from a source" is a citation of QUAY 2 or 3; a family tree, an authored work or no QUAY is only a trace', () => {
        const birth = (sid: string) => person({ birthDate: '1851', birthStatus: 'probable', birthSourceIds: [sid] });
        const of = (sid: string) => { const p = birth(sid); return cls(tree([I1], p), p, opts({ ...RESEARCH, treeHasSources: true })); };
        expect(['s1', 's2', 's0', 'sA', 'sX', 'missing'].map(of)).toEqual(['cs-p1', 'cs-p1', 'cs-res', 'cs-res', 'cs-res', 'cs-res']);
        // A baptism event's citation counts for the birth.
        const baptised = person({ birthDate: '1851', birthStatus: 'possible',
            events: [{ id: 'b1', type: 'baptism', date: '1851', sourceIds: ['s1'] }] } as unknown as Partial<Person>);
        expect(cls(tree([I1], baptised), baptised, opts(RESEARCH))).toBe('cs-p1');
    });

    it('K5.1: name, birth and death without a step: the other facts decide', () => {
        const residence = (status: string, sid: string) => ({ id: 'r1', type: 'residence', place: 'Lhota 12', status, sourceIds: [sid] });
        const lead = { id: 'o1', type: 'occupation', value: 'mlynář', status: 'lead' };
        const at = (events: unknown[], extra: Partial<Person> = {}) => {
            const p = person({ events, ...extra } as unknown as Partial<Person>);
            return cardStatus(tree([I1], p), p, opts({ ...RESEARCH, treeHasSources: true }));
        };
        // Known from a record (a residence probable from the original register): ●○, no fact of the card named.
        expect(at([residence('probable', 's1'), lead])).toMatchObject({ cls: 'cs-p1', source: 'step', facts: [] });
        expect(at([residence('proven', 's2')])?.cls).toBe('cs-p1');
        // Only leads: ○; a residence from an authored work or a family tree is only a trace too.
        expect(at([lead])).toMatchObject({ cls: 'cs-res', facts: [] });
        expect(at([residence('probable', 'sA')])?.cls).toBe('cs-res');
        expect(at([residence('possible', 's0')])?.cls).toBe('cs-res');
        // Nothing: the dotted frame; a citation without a step anywhere: only a trace.
        expect(at([])?.cls).toBe('cs-none');
        expect(at([], { sourceIds: ['s1'] })?.cls).toBe('cs-res');
        // A name and a birth date without a step do not hide the other facts.
        expect(at([residence('probable', 's1')], { birthDate: '1851', sourceIds: ['s1'] })?.cls).toBe('cs-p1');
    });

    it('spec 077: the QUAY of the citation at the fact decides, not its source\'s default', () => {
        // One census entry (an original, QUAY 3): the occupation read first hand, the birth from the age (QUAY 2 of its own).
        const census = { id: 'sC', title: 'Census Bludovec 1857', quality: 3 };
        const at = (p: Person) => ({ ...tree([I1], p), sources: { ...SOURCES, sC: census } }) as unknown as StromData;
        const birth = (own: number | null) => person({ birthDate: '1821', birthStatus: 'probable', birthSourceIds: ['sC'],
            citationQuay: { birthSourceIds: { sC: own } } } as unknown as Partial<Person>);
        const of = (p: Person) => cls(at(p), p, opts({ ...RESEARCH, treeHasSources: true }));
        // BIRT QUAY 2 (a copy with primary information): still read from a source, ●○.
        expect(of(birth(2))).toBe('cs-p1');
        // The same entry cited at the birth with QUAY 1 or none: only a trace (○), although the entry is an original.
        expect(of(birth(1))).toBe('cs-res');
        expect(of(birth(null))).toBe('cs-res');
        // The other way round: an entry of QUAY 1 whose citation at a baptism says 3.
        const copy = { ...census, quality: 1 };
        const baptised = person({ birthDate: '1821', birthStatus: 'possible', events: [{ id: 'b1', type: 'baptism', date: '1821',
            sourceIds: ['sC'], citationQuay: { sourceIds: { sC: 3 } } }] } as unknown as Partial<Person>);
        const data = { ...at(baptised), sources: { sC: copy } } as unknown as StromData;
        expect(cls(data, baptised, opts(RESEARCH))).toBe('cs-p1');
        // The record the research changed the birth by, cited at the birth with QUAY 1: its citation says, not the entry's 3.
        const bySrc = person({ birthDate: '1821', birthStatus: 'probable', birthSourceIds: ['sC'],
            citationQuay: { birthSourceIds: { sC: 1 } },
            researchOrigins: { name: { kind: 'research' }, birth: { kind: 'research', sourceIds: ['sC'] } } } as unknown as Partial<Person>);
        expect(of(bySrc)).toBe('cs-res');
        // The occupation (OCCU QUAY 3 at an entry of QUAY 1) makes a person without other steps known: ●○.
        const occu = person({ events: [{ id: 'o1', type: 'occupation', value: 'chalupník', status: 'probable',
            sourceIds: ['sC'], citationQuay: { sourceIds: { sC: 3 } } }] } as unknown as Partial<Person>);
        expect(cls({ ...at(occu), sources: { sC: copy } } as unknown as StromData, occu, opts({ ...RESEARCH, treeHasSources: true })))
            .toBe('cs-p1');
        const occuCopy = person({ events: [{ id: 'o1', type: 'occupation', value: 'chalupník', status: 'probable', sourceIds: ['sC'] }] } as unknown as Partial<Person>);
        expect(cls({ ...at(occuCopy), sources: { sC: copy } } as unknown as StromData, occuCopy, opts({ ...RESEARCH, treeHasSources: true })))
            .toBe('cs-res');
        // A couple's wedding cited with its own QUAY 3 at an entry of QUAY 1.
        const spouse = person({ partnerships: ['u1'] } as unknown as Partial<Person>);
        const wed = { ...tree([I1], spouse), sources: { sC: copy } } as unknown as StromData;
        wed.partnerships = { u1: { id: 'u1', person1Id: 'p1', person2Id: 'p2', startDate: '1850', startStatus: 'probable',
            sourceIds: ['sC'], citationQuay: { sourceIds: { sC: 3 } } } } as unknown as StromData['partnerships'];
        expect(cls(wed, spouse, opts(RESEARCH))).toBe('cs-p1');
    });

    it('K5.1: a wedding probable from the original register makes the person known (the couple\'s facts count)', () => {
        const p = person({ partnerships: ['u1'] } as unknown as Partial<Person>);
        const data = tree([I1], p);
        data.partnerships = { u1: { id: 'u1', person1Id: 'p1', person2Id: 'p2', startDate: '1875', startStatus: 'probable', sourceIds: ['s1'] } } as unknown as StromData['partnerships'];
        expect(cardStatus(data, p, opts(RESEARCH))).toMatchObject({ cls: 'cs-p1', facts: [] });
        (data.partnerships as Record<string, Partnership>).u1.sourceIds = ['s0'];
        expect(cls(data, p, opts(RESEARCH))).toBe('cs-res');
    });

    it('K5.1: only the facts the person has count', () => {
        const p = person({ birthDate: '1851', birthStatus: 'probable', birthSourceIds: ['s1'], deathStatus: 'lead' });
        expect(cardStatus(tree([I1], p), p, opts(RESEARCH))).toMatchObject({ cls: 'cs-p1', facts: ['birth'] });
    });

    it('probable, possible and a lead without a citation: one empty dot', () => {
        for (const birthStatus of ['probable', 'possible', 'lead'] as const) {
            const p = person({ birthDate: '1851', birthStatus, sourceIds: ['s1'], researchOrigins: { name: { kind: 'research' } } });
            const s = cardStatus(tree([I1], p), p, opts(RESEARCH));
            expect(s).toMatchObject({ cls: 'cs-res', source: 'step', step: { step: birthStatus }, facts: ['birth'] });
        }
        // A lead read from a source is still only a trace.
        const lead = person({ birthDate: '1851', birthStatus: 'lead', birthSourceIds: ['s1'], sourceIds: ['s1'] });
        expect(cls(tree([I1], lead), lead, opts(RESEARCH))).toBe('cs-res');
    });

    it('from a family tree file: ○○, the facts that share the step named', () => {
        const p = fromFile();
        expect(cardStatus(tree([I1], p), p, opts())).toMatchObject({ cls: 'cs-import', source: 'step', facts: ['name', 'birth'] });
    });

    it('the import wins over citations (Milan, 8 Nov), the evidence still carried', () => {
        const p = fromFile({ birthSourceIds: ['s1'] });
        const s = cardStatus(tree([I1], p), p, opts({ treeHasSources: true }));
        expect(s).toMatchObject({ cls: 'cs-import', source: 'step', evidence: { level: 'full' } });
    });

    it('a tree of the app\'s own with sources: ●● full, ●○ partial, a dotted frame for none', () => {
        const full = person({ id: 'p1' as PersonId, birthDate: '1851', birthSourceIds: ['s1'] });
        const partial = person({ id: 'p2' as PersonId, birthDate: '1851', deathDate: '1910', birthSourceIds: ['s1'] });
        const none = person({ id: 'p3' as PersonId, birthDate: '1851' });
        const data = tree([], full, partial, none);
        expect(cardStatus(data, full, opts({ treeHasSources: true }))).toMatchObject({ cls: 'cs-p2', source: 'evidence', facts: [] });
        expect(cls(data, partial, opts({ treeHasSources: true }))).toBe('cs-p1');
        expect(cls(data, none, opts({ treeHasSources: true }))).toBe('cs-none');
    });

    it('a person without a step in a tree from a file: not the citations as a whole (K5.1)', () => {
        const p = person({ birthDate: '1851', birthSourceIds: ['s1'], sourceIds: ['s1'] });
        expect(cardStatus(tree([I1], p), p, opts({ treeHasSources: true }))).toMatchObject({ cls: 'cs-res', source: 'step', facts: [] });
        const bare = person({ birthDate: '1851' });
        expect(cardStatus(tree([I1], bare), bare, opts())).toMatchObject({ cls: 'cs-none', source: 'step', facts: [] });
    });

    it('the import ○○ is weaker than a proven fact beside it', () => {
        const f = fromFile({ deathDate: '1910', deathStatus: 'proven' });
        expect(cardStatus(tree([I1], f), f, opts())).toMatchObject({ cls: 'cs-import', facts: ['name', 'birth'] });
    });

    it('nothing: a tree with no sources and no origin, a placeholder, the switch off', () => {
        const p = person({ birthDate: '1851' });
        expect(cls(tree([], p), p, opts())).toBeNull();
        const ph = fromFile({ isPlaceholder: true } as Partial<Person>);
        expect(cls(tree([I1], ph), ph, opts({ treeHasSources: true }))).toBeNull();
        const f = fromFile();
        expect(cls(tree([I1], f), f, opts({ status: false }))).toBeNull();
    });
});

describe('factCitations', () => {
    const sources = {
        s1: { id: 's1', title: 'Křestní matrika Lhotka 1850' },
        s2: { id: 's2', title: 'Pohřební kniha Lhotka' },
        s3: { id: 's3', title: 'Oddací matrika Lhotka' },
        s4: { id: 's4', title: 'Sčítání lidu 1880' },
    } as unknown as StromData['sources'];
    const data = { sources } as Pick<StromData, 'sources'>;
    const titles = (rows: { source: { title: string } }[]) => rows.map(r => r.source.title);

    it('the name: the person\'s own citations', () => {
        const rows = factCitations(data, person({ sourceIds: ['s1'] }), 'name');
        expect(titles(rows)).toEqual(['Křestní matrika Lhotka 1850']);
        expect(rows[0].ctx).toEqual({ personId: 'p1' });
    });

    it('the birth: its field, then a baptism event, a source once', () => {
        const p = person({
            birthSourceIds: ['s1'],
            events: [{ id: 'e1', type: 'baptism', sourceIds: ['s4', 's1'] }, { id: 'e2', type: 'residence', sourceIds: ['s2'] }],
        } as Partial<Person>);
        const rows = factCitations(data, p, 'birth');
        expect(titles(rows)).toEqual(['Křestní matrika Lhotka 1850', 'Sčítání lidu 1880']);
        expect(rows.map(r => r.ctx)).toEqual([{ personId: 'p1', fact: 'birth' }, { personId: 'p1', eventId: 'e1' }]);
    });

    it('each citation with its QUAY: its own, else its source\'s (spec 077)', () => {
        const census = { sC: { id: 'sC', title: 'Census Bludovec 1857', quality: 3 }, s1: { id: 's1', title: 'Křestní matrika Lhotka 1850' } };
        const p = person({
            birthSourceIds: ['sC', 's1'], citationQuay: { birthSourceIds: { sC: 2 } },
            events: [{ id: 'o1', type: 'occupation', sourceIds: ['sC'] }, { id: 'b1', type: 'baptism', sourceIds: ['s1'], citationQuay: { sourceIds: { s1: null } } }],
        } as unknown as Partial<Person>);
        const d = { sources: census } as unknown as Pick<StromData, 'sources'>;
        expect(factCitations(d, p, 'birth').map(r => [r.source.id, r.quality])).toEqual([['sC', 2], ['s1', undefined]]);
        expect(factCitations(d, p, 'event:o1').map(r => r.quality)).toEqual([3]);
    });

    it('the death: a burial event counts', () => {
        const p = person({ events: [{ id: 'e3', type: 'burial', sourceIds: ['s2'] }] } as Partial<Person>);
        const rows = factCitations(data, p, 'death');
        expect(titles(rows)).toEqual(['Pohřební kniha Lhotka']);
        expect(rows[0].ctx).toEqual({ personId: 'p1', eventId: 'e3' });
    });

    it('an event: its own citations', () => {
        const p = person({ events: [{ id: 'e4', type: 'residence', sourceIds: ['s4'] }] } as Partial<Person>);
        const rows = factCitations(data, p, 'event:e4');
        expect(titles(rows)).toEqual(['Sčítání lidu 1880']);
        expect(rows[0].ctx).toEqual({ personId: 'p1', eventId: 'e4' });
        expect(factCitations(data, p, 'event:nope')).toEqual([]);
    });

    it('a marriage: the couple\'s citations; a couple event its own', () => {
        const u = {
            id: 'u1', person1Id: 'p1', person2Id: 'p2', childIds: [], status: 'married', sourceIds: ['s3'],
            events: [{ id: 'c1', type: 'banns', sourceIds: ['s4'] }],
        } as unknown as Partnership;
        const rows = factCitations(data, u, 'marriage');
        expect(titles(rows)).toEqual(['Oddací matrika Lhotka']);
        expect(rows[0].ctx).toEqual({ partnershipId: 'u1' });
        expect(factCitations(data, u, 'event:c1')[0].ctx).toEqual({ partnershipId: 'u1', eventId: 'c1' });
    });

    it('a cited id the tree no longer has is skipped', () => {
        expect(titles(factCitations(data, person({ sourceIds: ['gone', 's2'] }), 'name'))).toEqual(['Pohřební kniha Lhotka']);
    });
});

describe('the mark of a research tree does not wait for its bridge (1109)', () => {
    // A research tree stored from a research that shows the origin (every fact and name carries
    // `_STROM_ORIGIN`), its birth a lead with an original cited: the bridge answering, not answered
    // yet after the page loads, or not running at all gives the same mark.
    const SOURCES = { s1: { id: 's1', title: 'Křty Lhota 1851', quality: 3 } };
    const lead = person({
        birthDate: '1851', birthStatus: 'lead', birthSourceIds: ['s1'], sourceIds: ['s1'],
        researchOrigins: { name: { kind: 'research' }, birth: { kind: 'research' } },
    });
    const data = {
        persons: { p1: lead }, partnerships: {}, imports: [], sources: SOURCES,
    } as unknown as StromData;
    const statusOf = (o: ReliabilityOptions) => cardStatus(data, lead, { ...o, treeHasSources: true });

    it('the tree\'s data say the research showed the origin', () => {
        expect(treeCarriesResearchOrigin(data)).toBe(true);
        expect(treeCarriesResearchOrigin({ persons: { p1: person() }, partnerships: {} } as unknown as StromData)).toBe(false);
        const ps = { id: 'u1', researchOrigins: { marriage: { kind: 'research' } } } as unknown as Partnership;
        expect(treeCarriesResearchOrigin({ persons: {}, partnerships: { u1: ps } } as unknown as StromData)).toBe(true);
    });

    it('the same card mark with the bridge and without it', () => {
        const live = statusOf(reliabilityOptionsOf(data, true, true));
        expect(live).toMatchObject({ cls: 'cs-res', source: 'step', facts: ['birth'] });
        expect(statusOf(reliabilityOptionsOf(data, false, true))).toEqual(live);
        // Before: the bridge not answered fell to the citations (●●), the very mark that flipped.
        expect(statusOf(RESEARCH_OLD)?.cls).toBe('cs-p2');
    });

    it('the same person card summary with the bridge and without it', () => {
        expect(personOriginSummary(data, lead, reliabilityOptionsOf(data, false, true)))
            .toEqual(personOriginSummary(data, lead, reliabilityOptionsOf(data, true, true)));
    });

    it('a research tree without the origin in its data, or the app\'s own tree, keeps the old options', () => {
        const old = { persons: { p1: person({ birthStatus: 'lead' }) }, partnerships: {} } as unknown as StromData;
        expect(reliabilityOptionsOf(old, false, true)).toEqual(RESEARCH_OLD);
        expect(reliabilityOptionsOf(data, false, false)).toEqual(PLAIN);
        expect(reliabilityOptionsOf(old, true, false)).toEqual(RESEARCH);
    });
});
