/**
 * The research's numbers on a tree handed over to it (finding 23): its
 * `ids` answer by the xrefs of the file that went over; a copy without
 * them matched to the research's version by content; holdsResearchIds.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeAdoptReply, applyAdoptIds, researchIdsByContent, holdsResearchIds, sanitizeSyncReply } from '../research-link.js';
import { exportToGedcom } from '../ged-exporter.js';
import { StromData, PersonId } from '../types.js';

const UUID = '5b7e2c10-3a4d-4f61-8e2b-9c0d1e2f3a4b';

const person = (id: string, firstName: string, extra: Record<string, unknown> = {}) => ({
    id: id as PersonId, firstName, lastName: '', gender: 'male' as const, isPlaceholder: false,
    partnerships: [], parentIds: [], childIds: [], ...extra,
});

function tree(): StromData {
    return {
        version: 11,
        persons: { a: person('a', '1'), b: person('b', '2', { gender: 'female' }), c: person('c', '3'), q: person('q', '?', { isPlaceholder: true }) },
        partnerships: {},
        sources: { s: { id: 's', title: 'Matrika Chlumy' } },
    } as unknown as StromData;
}

describe('sanitizeAdoptReply: ids', () => {
    it('takes the research numbers by xref, drops anything else', () => {
        const r = sanitizeAdoptReply({ tree: UUID, head: 'abc1234', ids: {
            persons: { '@I1@': 'P0001', '@I2@': ' P0002 ', '@I3@': 'X1', 'I4': 'P0004', '__proto__': 'P0005', '@I6@': 7 },
            sources: { '@S1@': 'S0001', '@S2@': 'P0001' },
        } });
        expect(r?.ids).toEqual({ persons: { '@I1@': 'P0001', '@I2@': 'P0002' }, sources: { '@S1@': 'S0001' } });
        expect(Object.getPrototypeOf(r?.ids?.persons)).toBe(Object.prototype);
    });

    it('no ids (an older research), or none usable: null', () => {
        expect(sanitizeAdoptReply({ tree: UUID })?.ids).toBeNull();
        expect(sanitizeAdoptReply({ tree: UUID, ids: { persons: { x: 'y' } } })?.ids).toBeNull();
        expect(sanitizeAdoptReply({ ids: {} })).toBeNull();
    });
});

describe('applyAdoptIds', () => {
    it('numbers the people and sources by the xrefs the export gave them', () => {
        const data = tree();
        const exported = exportToGedcom(data, 'Test');
        const xa = exported.xrefs.persons.get('a')!;
        const xc = exported.xrefs.persons.get('c')!;
        const xs = exported.xrefs.sources.get('s')!;
        expect(exported.content).toContain(`0 ${xa} INDI`);
        const out = applyAdoptIds(data, exported.xrefs, { persons: { [xa]: 'P0001', [xc]: 'P0003' }, sources: { [xs]: 'S0001' } });
        expect(out.persons).toBe(2);
        expect(out.sources).toBe(1);
        expect(out.data.persons['a' as PersonId]).toMatchObject({ refn: 'P0001', refnType: 'strom-research' });
        expect(out.data.persons['b' as PersonId].refn).toBeUndefined();
        expect(out.data.sources!.s.refn).toBe('S0001');
        // The input stays as it was.
        expect(data.persons['a' as PersonId].refn).toBeUndefined();
        // The next export names them.
        expect(exportToGedcom(out.data, 'Test').content).toContain('1 REFN P0001\n2 TYPE strom-research');
    });
});

describe('researchIdsByContent', () => {
    const research = (): StromData => ({
        version: 11,
        persons: {
            r1: person('r1', '1', { refn: 'P0001' }), r2: person('r2', '2', { gender: 'female', refn: 'P0002' }),
            r3: person('r3', '3', { refn: 'P0003' }), r9: person('r9', 'Nový', { refn: 'P0009' }),
        },
        partnerships: {},
        sources: { x: { id: 'x', title: 'Matrika Chlumy', refn: 'S0001' } },
    } as unknown as StromData);

    it('matches the research version to what went over; numbers land on the current people, edits kept', () => {
        const handed = tree();
        const current = tree();
        current.persons['a' as PersonId] = { ...current.persons['a' as PersonId], firstName: 'jedna' };
        const out = researchIdsByContent(current, handed, research());
        expect(out.persons).toBe(3);
        expect(out.sources).toBe(1);
        expect(out.data.persons['a' as PersonId]).toMatchObject({ firstName: 'jedna', refn: 'P0001', refnType: 'strom-research' });
        expect(out.data.persons['c' as PersonId].refn).toBe('P0003');
        expect(out.data.persons['q' as PersonId].refn).toBeUndefined();
        expect(out.data.sources!.s.refn).toBe('S0001');
    });

    it('two people alike (same name, sex, dates): neither is guessed', () => {
        const handed = tree();
        handed.persons['c' as PersonId] = { ...handed.persons['c' as PersonId], firstName: '1' };
        const out = researchIdsByContent(handed, handed, research());
        expect(out.data.persons['a' as PersonId].refn).toBeUndefined();
        expect(out.data.persons['c' as PersonId].refn).toBeUndefined();
        expect(out.data.persons['b' as PersonId].refn).toBe('P0002');
    });

    it('finding 27: one-character and digit names, the sex written otherwise there, diacritics and case: still matched', () => {
        const handed = tree();
        const current = tree();
        current.persons['a' as PersonId] = { ...current.persons['a' as PersonId], firstName: 'jedna' };
        const theirs = research();
        // The research's version without the sex (the parser then guesses), another case and accents.
        theirs.persons['r1' as PersonId] = { ...theirs.persons['r1' as PersonId], gender: 'female' };
        theirs.persons['r3' as PersonId] = { ...theirs.persons['r3' as PersonId], gender: 'female' };
        handed.persons['b' as PersonId] = { ...handed.persons['b' as PersonId], firstName: 'Žofie  Nová' };
        theirs.persons['r2' as PersonId] = { ...theirs.persons['r2' as PersonId], firstName: 'zofie', lastName: 'nova' };
        const out = researchIdsByContent(current, handed, theirs);
        expect(out.persons).toBe(3);
        expect(out.data.persons['a' as PersonId]).toMatchObject({ firstName: 'jedna', refn: 'P0001' });
        expect(out.data.persons['b' as PersonId].refn).toBe('P0002');
        expect(out.data.persons['c' as PersonId].refn).toBe('P0003');
    });

    it('a looser round never pairs what a stricter one left ambiguous on either side', () => {
        const handed = tree();
        handed.persons['a' as PersonId] = { ...handed.persons['a' as PersonId], birthDate: '1900' };
        handed.persons['c' as PersonId] = { ...handed.persons['c' as PersonId], firstName: '1', birthDate: '1910' };
        const out = researchIdsByContent(handed, handed, research());
        // Two "1" here (born 1900 and 1910), one there without a date: the name alone is not unique here.
        expect(out.data.persons['a' as PersonId].refn).toBeUndefined();
        expect(out.data.persons['c' as PersonId].refn).toBeUndefined();
        expect(out.data.persons['b' as PersonId].refn).toBe('P0002');
    });

    it('a person with a number already keeps it', () => {
        const handed = tree();
        const current = tree();
        current.persons['b' as PersonId] = { ...current.persons['b' as PersonId], refn: 'A-12' };
        expect(researchIdsByContent(current, handed, research()).data.persons['b' as PersonId].refn).toBe('A-12');
    });
});

describe('holdsResearchIds', () => {
    it('false only for people none of whom has a research number', () => {
        const data = tree();
        expect(holdsResearchIds(data)).toBe(false);
        data.persons['b' as PersonId] = { ...data.persons['b' as PersonId], refn: 'P0002' };
        expect(holdsResearchIds(data)).toBe(true);
        expect(holdsResearchIds({ version: 11, persons: { q: person('q', '?', { isPlaceholder: true }) }, partnerships: {} } as unknown as StromData)).toBe(true);
    });
});

describe('sanitizeSyncReply: code', () => {
    it('a stable code passes, anything else is empty', () => {
        expect(sanitizeSyncReply({ error: 'x', code: 'tree.no-ids' }).code).toBe('tree.no-ids');
        expect(sanitizeSyncReply({ error: 'x', code: 'Tree No IDs!' }).code).toBe('');
        expect(sanitizeSyncReply(null).code).toBe('');
    });
});

describe('sanitizeSyncReply: notWritten', () => {
    it('keeps the name the research gives (child.gone, rc.41), as text', () => {
        const r = sanitizeSyncReply({ ok: true, notWritten: [{ kind: 'child.gone', person: 'P0008', name: 'Pavla Svobodová', why: 'report' }, { kind: 'x', person: 'bad' }] });
        expect(r.notWritten[0]).toMatchObject({ kind: 'child.gone', person: 'P0008', name: 'Pavla Svobodová', why: 'report' });
        expect(r.notWritten[1]).toMatchObject({ person: '', name: '' });
    });
});
