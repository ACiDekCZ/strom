/**
 * A source record cited at several pages, or at one page with another QUAY
 * or date, becomes a source of its own per citation when read (spec 066
 * K3.1). Such a source has no REFN and gets a new id at every reading: loading
 * the very same research file again must still show no citation as changed,
 * and a tree stored before those sources existed (its citations on the
 * record itself) neither.
 */
import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { stabilizeIds, contentFingerprint } from '../research-link.js';
import { diffValues } from '../research-changes.js';
import type { StromData, Person, Source } from '../types.js';

interface Opts {
    /** The page of Ole's occupation citation. */
    occuPage?: string;
    /** Ole's residence cites the register too. */
    residenceCited?: boolean;
    /** The page of Ole's birth citation (the record's first citation: its page kept on the record). */
    birthPage?: string;
}

function researchGed(opts: Opts = {}): string {
    const lines = [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 VERS 1.4.0', '2 NAME Strom Research', '1 DATE 9 NOV 2026',
        '1 CHAR UTF-8',
        '0 @P0001@ INDI', '1 NAME Ole /Brekke/', '1 SEX M', '1 REFN P0001',
        '1 BIRT', '2 DATE 1850', '2 SOUR @S0001@', `3 PAGE ${opts.birthPage ?? 'fol. 12'}`, '3 QUAY 3',
        // The same page, another QUAY: a source of its own.
        '1 OCCU sedlák', '2 SOUR @S0001@', `3 PAGE ${opts.occuPage ?? 'fol. 12'}`, '3 QUAY 1',
        '1 RESI', '2 PLAC Tovik', ...(opts.residenceCited ? ['2 SOUR @S0001@', '3 PAGE fol. 40', '3 QUAY 2'] : []),
        '1 SOUR @S0001@', '2 PAGE fol. 40', '2 DATA', '3 DATE 2 MAR 1850', '2 QUAY 2',
        '0 @P0002@ INDI', '1 NAME Kari /Brekke/', '1 SEX F', '1 REFN P0002',
        '1 DEAT', '2 DATE 1901', '2 SOUR @S0002@', '3 PAGE s. 7', '3 QUAY 3',
        '1 SOUR @S0002@', '2 PAGE s. 8', '2 QUAY 2',
        '0 @S0001@ SOUR', '1 TITL Matrika Tovik 1840–1860', '1 REFN S0001', '1 PUBL Hallingdal archive',
        '0 @S0002@ SOUR', '1 TITL Matrika Tovik 1880–1910', '1 REFN S0002', '1 PUBL Hallingdal archive',
        '0 TRLR',
    ];
    return lines.join('\n');
}

const read = (ged: string): StromData => convertToStrom(parseGedcom(ged)).data;
const byRefn = (d: StromData, refn: string): Person => Object.values(d.persons).find(p => p.refn === refn)!;
const unnumbered = (d: StromData): Source[] => Object.values(d.sources ?? {}).filter(s => !s.refn);
const citationRows = (here: StromData, there: StromData) => diffValues(here, there).rows.filter(r => r.field === 'citation');

describe('sources of their own per citation across readings', () => {
    it('the same file read twice: the same ids, no citation row, the same fingerprint', () => {
        const first = read(researchGed());
        // The fixture really makes sources of their own (another QUAY, another page, another date).
        expect(unnumbered(first).length).toBeGreaterThanOrEqual(3);
        const again = stabilizeIds(read(researchGed()), first);
        expect(Object.keys(again.sources ?? {}).sort()).toEqual(Object.keys(first.sources ?? {}).sort());
        expect(citationRows(first, again)).toEqual([]);
        expect(diffValues(first, again).addedFacts).toBe(0);
        expect(contentFingerprint(again)).toBe(contentFingerprint(first));
        // Loaded again and again: no orphan sources pile up.
        const third = stabilizeIds(read(researchGed()), again);
        expect(Object.keys(third.sources ?? {}).length).toBe(Object.keys(first.sources ?? {}).length);
    });

    it('another page cited is still a row, with the pages named', () => {
        const first = read(researchGed());
        const next = stabilizeIds(read(researchGed({ occuPage: 'fol. 13' })), first);
        const rows = citationRows(first, next);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ field: 'citation', of: 'occupation',
            here: 'Matrika Tovik 1840–1860 · fol. 12', there: 'Matrika Tovik 1840–1860 · fol. 13' });
    });

    it('another page at the record\'s first citation (kept on the record, the same id) is a row, nothing added (1109 N1)', () => {
        const first = read(researchGed());
        const moved = stabilizeIds(read(researchGed({ birthPage: 'fol. 13' })), first);
        const rows = citationRows(first, moved);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ of: 'birth' });
        expect(rows[0].here).toContain('fol. 12');
        expect(rows[0].there).toContain('fol. 13');
        expect(diffValues(first, moved).rows).toHaveLength(1);
        expect(diffValues(first, moved).addedFacts).toBe(0);
    });

    it('a citation taken away is still a row; it coming back is none', () => {
        const withRes = read(researchGed({ residenceCited: true }));
        const without = stabilizeIds(read(researchGed()), withRes);
        expect(citationRows(withRes, without)).toEqual([
            expect.objectContaining({ field: 'citation', of: 'residence', here: 'Matrika Tovik 1840–1860 · fol. 40', there: '' }),
        ]);
        const back = stabilizeIds(read(researchGed({ residenceCited: true })), without);
        expect(citationRows(without, back)).toEqual([]);
    });

    it('a tree stored before (its citations on the record itself) shows no citation row', () => {
        const fresh = read(researchGed());
        // As an earlier version stored it: a citation of the record's page with another QUAY or date
        // on the record itself (only another page had a source of its own).
        const recordOf = new Map<string, string>();
        const records = Object.values(fresh.sources ?? {}).filter(s => s.refn);
        for (const s of unnumbered(fresh)) {
            const record = records.find(r => r.title === s.title)!;
            if (record.reference === s.reference) recordOf.set(s.id, record.id);
        }
        expect(recordOf.size).toBeGreaterThanOrEqual(1);
        const old = structuredClone(fresh);
        for (const id of recordOf.keys()) delete old.sources![id];
        const onRecord = (ids: string[] | undefined) => ids?.map(id => recordOf.get(id) ?? id);
        for (const p of Object.values(old.persons)) {
            p.sourceIds = onRecord(p.sourceIds);
            p.birthSourceIds = onRecord(p.birthSourceIds);
            p.deathSourceIds = onRecord(p.deathSourceIds);
            for (const e of p.events ?? []) e.sourceIds = onRecord(e.sourceIds);
        }
        expect(byRefn(old, 'P0001').events?.find(e => e.type === 'occupation')?.sourceIds).toEqual([records[0].id]);
        const next = stabilizeIds(read(researchGed()), old);
        expect(citationRows(old, next)).toEqual([]);
    });

    it('two unnumbered sources that say the same are never joined into one id', () => {
        const first = read(researchGed());
        const twin = unnumbered(first)[0];
        const doubled = structuredClone(first);
        doubled.sources![`${twin.id}x`] = { ...twin, id: `${twin.id}x` };
        const next = read(researchGed());
        const out = stabilizeIds(next, doubled);
        // The copy matching both stays as read; nothing points at either old id.
        const ids = new Set(Object.keys(out.sources ?? {}));
        expect(ids.has(twin.id)).toBe(false);
        expect(ids.has(`${twin.id}x`)).toBe(false);
    });

    it('an event that says the same keeps its id, its facts with it; a changed one keeps its new id', () => {
        const person = (events: object[], origins: object) => ({ id: 'p1', firstName: 'Ole', lastName: 'Brekke', gender: 'male', isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], refn: 'P0001', events, researchOrigins: origins });
        const tree = (p: object, witnesses: object[]) => ({ version: 12, persons: { p1: p },
            partnerships: { u1: { id: 'u1', person1Id: 'p1', person2Id: 'p1', childIds: [], status: 'married', participants: witnesses } } } as unknown as StromData);
        const prev = tree(person([
            { id: 'ev_a', type: 'occupation', note: 'sedlák', participants: [{ id: 'pt_a', role: 'witness', name: 'Nils' }] },
            { id: 'ev_b', type: 'residence', place: 'Tovik' },
        ], { 'event:ev_a': { by: 'X' }, 'event:ev_b': { by: 'Y' } }), [{ id: 'pt_w', role: 'witness', name: 'Per' }]);
        const next = tree(person([
            { id: 'ev_1', type: 'occupation', note: 'sedlák', participants: [{ id: 'pt_1', role: 'witness', name: 'Nils' }] },
            { id: 'ev_2', type: 'residence', place: 'Hallingdal' },
        ], { 'event:ev_1': { by: 'X' }, 'event:ev_2.place': { by: 'Y' } }), [{ id: 'pt_2', role: 'witness', name: 'Per' }]);
        const out = stabilizeIds(next, prev);
        const p = out.persons['p1' as never] as unknown as { events: { id: string; participants?: { id: string }[] }[]; researchOrigins: Record<string, unknown> };
        expect(p.events.map(e => e.id)).toEqual(['ev_a', 'ev_2']);
        expect(p.events[0].participants?.[0].id).toBe('pt_a');
        expect(Object.keys(p.researchOrigins).sort()).toEqual(['event:ev_2.place', 'event:ev_a']);
        expect((out.partnerships['u1' as never] as unknown as { participants: { id: string }[] }).participants[0].id).toBe('pt_w');
    });
});
