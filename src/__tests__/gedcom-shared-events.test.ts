/**
 * Shared events and a person's own godparent or witness event in GEDCOM
 * (spec 085 §7): `2 _STROM_SHARE <id>` + `3 _ROLE` on each copy and
 * `2 _STROM_ROLE` + `3 _STROM_AT` + `4 TYPE` written and read back, the
 * research's form of the lines, "Back to {prog}", the privacy modes and the
 * JSON that goes to the research. Invented data.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom, GedcomImportOrigin } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { applyLivingPrivacy, CONTENT_PRESETS } from '../privacy.js';
import { buildTransferJson } from '../research-transfer.js';
import { LifeEvent, Person, StromData } from '../types.js';
import { strings } from '../strings.js';

const NOW = 2026;

function person(id: string, firstName: string, lastName: string, gender: 'male' | 'female', extra: Partial<Person> = {}): Person {
    return {
        id, firstName, lastName, gender, isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...extra,
    } as unknown as Person;
}

/** A household of three in the 1921 census, a godfather and a witness at the wedding. */
function householdTree(): StromData {
    const census = (id: string, age: string, extra: Partial<LifeEvent> = {}): LifeEvent => ({
        id, type: 'census', date: '1921-02-15', place: 'Medvezin', address: 'No. 14', age,
        sourceIds: ['s1'], citationQuay: { sourceIds: { s1: 3 } }, shareId: 'SH7K2QX', ...extra,
    });
    return {
        version: 20,
        persons: {
            p_f: person('p_f', 'Hvozdimír', 'Ostrozub', 'male', {
                birthDate: '1879', deathDate: '1950', partnerships: ['u1'], childIds: ['p_d'],
                events: [census('e_f', '42y')],
            } as Partial<Person>),
            p_m: person('p_m', 'Zbyhněva', 'Ostrozubová', 'female', {
                birthDate: '1883', deathDate: '1960', partnerships: ['u1'], childIds: ['p_d'],
                events: [census('e_m', '38y', { shareRole: 'Head of the farm' })],
            } as Partial<Person>),
            p_d: person('p_d', 'Vratislava', 'Ostrozubová', 'female', {
                birthDate: '1910-03-01', deathDate: '1990', parentIds: ['p_f', 'p_m'],
                events: [
                    census('e_d', '10y', { shareRole: 'daughter' }),
                    { id: 'e_bap', type: 'baptism', date: '1910-03-14', place: 'Medvezin' },
                ],
            } as Partial<Person>),
            p_g: person('p_g', 'Pelhan', 'Bezruk', 'male', {
                birthDate: '1880', deathDate: '1945',
                events: [
                    {
                        id: 'e_gp', type: 'godparent', date: '1910-03-14', place: 'Medvezin',
                        roleAt: { role: 'godparent', personId: 'p_d', eventType: 'baptism', eventId: 'e_bap' },
                    },
                    {
                        id: 'e_ww', type: 'weddingWitness', date: '1908-06-20', place: 'Lipolesy',
                        roleAt: { role: 'witness', partnershipId: 'u1', eventType: 'marriage', eventId: 'marriage' },
                    },
                    // A copy whose others are not in the tree: an ordinary event in the file.
                    { id: 'e_lone', type: 'residence', date: '1930', place: 'Lipolesy', shareId: 'Lone1' },
                ],
            } as Partial<Person>),
        },
        partnerships: {
            u1: {
                id: 'u1', person1Id: 'p_f', person2Id: 'p_m', status: 'married',
                startDate: '1908-06-20', startPlace: 'Lipolesy', childIds: ['p_d'],
            },
        },
        sources: { s1: { id: 's1', title: 'Census 1921, Medvezin' } },
    } as unknown as StromData;
}

/** The lines of one INDI record (`0 @Ix@ INDI` up to the next level-0 line). */
function record(ged: string, name: string): string[] {
    const lines = ged.split(/\r?\n/);
    const at = lines.findIndex((l, i) => l.startsWith('1 NAME ' + name) && lines[i - 1]?.endsWith(' INDI'));
    expect(at).toBeGreaterThan(0);
    const end = lines.findIndex((l, i) => i > at && l.startsWith('0 '));
    return lines.slice(at - 1, end);
}

/** The lines of the record's first `1 <tag>` event. */
function eventLines(rec: string[], tag: string): string[] {
    const at = rec.findIndex(l => l === `1 ${tag}`);
    expect(at).toBeGreaterThan(0);
    const end = rec.findIndex((l, i) => i > at && l.startsWith('1 '));
    return rec.slice(at, end < 0 ? undefined : end);
}

function xrefOf(ged: string, name: string): string {
    return record(ged, name)[0].split(' ')[1];
}

const reimport = (ged: string, origin?: GedcomImportOrigin) =>
    convertToStrom(parseGedcom(ged), origin ? { importOrigin: origin } : {});

describe('GEDCOM export of shared events (spec 085 §7)', () => {
    it('writes the share id and the role after AGE and before the citation, on every copy', () => {
        const ged = exportToGedcom(householdTree(), 'Ostrozub').content;
        const father = eventLines(record(ged, 'Hvozdimír /Ostrozub/'), 'CENS');
        // After the event's own fields (the app writes AGE, then ADDR), before its citation.
        const age = Math.max(father.indexOf('2 AGE 42y'), father.findIndex(l => l.startsWith('2 ADDR')));
        expect(father.indexOf('2 AGE 42y')).toBeGreaterThan(0);
        expect(father[age + 1]).toBe('2 _STROM_SHARE SH7K2QX');
        expect(father[age + 2]).toMatch(/^2 SOUR @\w+@$/);
        expect(father.filter(l => l.includes('_STROM_SHARE') || l.includes('_ROLE'))).toEqual(['2 _STROM_SHARE SH7K2QX']);
        const mother = eventLines(record(ged, 'Zbyhněva /Ostrozubová/'), 'CENS');
        const share = mother.indexOf('2 _STROM_SHARE SH7K2QX');
        expect(mother[share - 1]).toMatch(/^2 (AGE 38y|ADDR No\. 14)$/);
        expect(mother[share + 1]).toBe('3 _ROLE Head of the farm');
        expect(mother[share + 2]).toMatch(/^2 SOUR @/);
        expect(mother).toContain('3 QUAY 3');
        const daughter = eventLines(record(ged, 'Vratislava /Ostrozubová/'), 'CENS');
        expect(daughter).toContain('3 _ROLE daughter');
    });

    it('leaves out the mark of a copy alone in the file', () => {
        const ged = exportToGedcom(householdTree(), 'Ostrozub').content;
        const resi = eventLines(record(ged, 'Pelhan /Bezruk/'), 'RESI');
        expect(resi.some(l => l.includes('_STROM_SHARE'))).toBe(false);
        expect(ged).not.toContain('Lone1');
    });

    it('writes a godparent and a wedding witness as EVEN with the role and whose event it was', () => {
        const ged = exportToGedcom(householdTree(), 'Ostrozub').content;
        const rec = record(ged, 'Pelhan /Bezruk/');
        const role = rec.indexOf('2 _STROM_ROLE godparent');
        expect(rec.slice(role, role + 3)).toEqual([
            '2 _STROM_ROLE godparent',
            `3 _STROM_AT ${xrefOf(ged, 'Vratislava /Ostrozubová/')}`,
            '4 TYPE BAPM',
        ]);
        const start = rec.slice(0, role).lastIndexOf('1 EVEN');
        expect(rec[start + 1]).toBe(`2 TYPE ${strings.events.types.godparent}`);
        expect(rec.slice(start + 1, role).every(l => !l.startsWith('1 '))).toBe(true);
        const at = rec.indexOf('2 _STROM_ROLE witness');
        expect(rec.slice(at, at + 3)).toEqual(['2 _STROM_ROLE witness', expect.stringMatching(/^3 _STROM_AT @F\w+@$/), '4 TYPE MARR']);
        expect(rec.slice(0, at).reverse().find(l => l.startsWith('1 '))).toBe('1 EVEN');
    });

    it('leaves out _STROM_AT when whose event it was is not in the file', () => {
        const data = householdTree();
        delete data.persons['p_d' as keyof typeof data.persons];
        for (const id of ['p_f', 'p_m']) data.persons[id as keyof typeof data.persons].childIds = [];
        data.partnerships['u1' as keyof typeof data.partnerships].childIds = [];
        const ged = exportToGedcom(data, 'Ostrozub').content;
        const rec = record(ged, 'Pelhan /Bezruk/');
        const at = rec.indexOf('2 _STROM_ROLE godparent');
        expect(at).toBeGreaterThan(0);
        expect(rec[at + 1]).not.toMatch(/_STROM_AT/);
        expect(rec[at + 1]).not.toBe('4 TYPE BAPM');
    });
});

describe('GEDCOM round trip of shared events (spec 085 §7)', () => {
    it('gives back the copies with their share, roles, ages, sources and quality, and the godparent events', () => {
        const back = reimport(exportToGedcom(householdTree(), 'Ostrozub').content).data;
        const byName = (first: string) => Object.values(back.persons).find(p => p.firstName === first)!;
        const copies = ['Hvozdimír', 'Zbyhněva', 'Vratislava'].map(n => byName(n).events!.find(e => e.type === 'census')!);
        expect(copies.map(c => c.shareId)).toEqual(['SH7K2QX', 'SH7K2QX', 'SH7K2QX']);
        expect(copies.map(c => c.shareRole)).toEqual([undefined, 'Head of the farm', 'daughter']);
        expect(copies.map(c => parseInt(c.age ?? ''))).toEqual([42, 38, 10]);
        for (const c of copies) {
            expect(c.date).toBe('1921-02-15');
            expect(c.place).toBe('Medvezin');
            expect(c.sourceIds).toHaveLength(1);
            // QUAY 3 of every citation: the source's own quality, or the citation's.
            expect(c.citationQuay?.sourceIds?.[c.sourceIds![0]] ?? back.sources?.[c.sourceIds![0]]?.quality).toBe(3);
        }

        const pelhan = byName('Pelhan');
        const daughter = byName('Vratislava');
        const gp = pelhan.events!.find(e => e.type === 'godparent')!;
        expect(gp.customLabel).toBeUndefined();
        const baptism = daughter.events!.find(e => e.type === 'baptism');
        expect(gp.roleAt).toEqual({ role: 'godparent', personId: daughter.id, eventType: 'baptism', ...(baptism ? { eventId: baptism.id } : {}) });
        const ww = pelhan.events!.find(e => e.type === 'weddingWitness')!;
        const union = Object.values(back.partnerships)[0];
        expect(ww.roleAt).toEqual({ role: 'witness', partnershipId: union.id, eventType: 'marriage', eventId: 'marriage' });
        // The lone copy is an ordinary event again.
        expect(pelhan.events!.find(e => e.type === 'residence')!.shareId).toBeUndefined();
    });

    it('writes the same marks for "Back to {prog}" and reads them again', () => {
        const origin: GedcomImportOrigin = { at: '2026-11-08', file: 'family.ged', encoding: 'utf-8' };
        const first = reimport(exportToGedcom(householdTree(), 'Ostrozub').content.replace('1 SOUR STROM', '1 SOUR FTM_OTHER\n1 _X STROM'), origin).data;
        expect(first.imports?.length).toBe(1);
        const ged = exportToGedcom(first, 'Ostrozub', { content: CONTENT_PRESETS.back, backTo: first.imports![0].id }).content;
        expect(ged.match(/^2 _STROM_SHARE SH7K2QX$/gm)).toHaveLength(3);
        expect(ged).toContain('3 _ROLE Head of the farm');
        expect(ged).toContain('2 _STROM_ROLE godparent');
        expect(ged).toMatch(/3 _STROM_AT @I\w+@\n4 TYPE BAPM/);
        const again = reimport(ged).data;
        const shared = Object.values(again.persons).flatMap(p => p.events ?? []).filter(e => e.shareId === 'SH7K2QX');
        expect(shared).toHaveLength(3);
    });
});

describe('GEDCOM import of the research\'s form (spec 085 §7)', () => {
    const RESEARCH = `0 HEAD
1 SOUR STROM_RESEARCH
1 CHAR UTF-8
0 @S0021@ SOUR
1 TITL Census 1921
0 @I0003@ INDI
1 NAME Hvozdimír /Ostrozub/
1 SEX M
1 CENS
2 DATE 15 FEB 1921
2 PLAC Medvezin
2 ADDR No. 14
2 AGE 42y
2 _STROM_SHARE SH7K2QX
2 SOUR @S0021@
3 PAGE No. 14
0 @I0004@ INDI
1 NAME Zbyhněva /Ostrozubová/
1 SEX F
1 CENS
2 DATE 15 FEB 1921
2 PLAC Medvezin
2 ADDR No. 14
2 AGE 38y
2 _STROM_SHARE SH7K2QX
3 ROLE maid
4 CONC  of the farm
2 SOUR @S0021@
3 PAGE No. 14
1 RESI
2 DATE 1925
2 _STROM_SHARE bad-id!
1 BAPM
2 DATE 1884
2 _STROM_SHARE SH7K2QX
0 @I0007@ INDI
1 NAME Pelhan /Bezruk/
1 SEX M
1 EVEN
2 TYPE Kmotrovství
2 DATE 14 MAR 1909
2 _STROM_ROLE godparent
3 _STROM_AT @I0004@
4 TYPE BAPM
1 EVEN
2 TYPE Svědek
2 _STROM_ROLE witness
3 _STROM_AT @F0001@
4 TYPE MARR
1 EVEN
2 TYPE Svědectví
2 _STROM_ROLE witness
3 _STROM_AT @I0003@
4 TYPE CENS
1 EVEN
2 TYPE Porod
2 _STROM_ROLE midwife
0 @F0001@ FAM
1 HUSB @I0003@
1 WIFE @I0004@
1 MARR
2 DATE 1908
0 TRLR
`;

    it('reads the share with ROLE (and its CONC), the citation after it, and no mark from an invalid id or a type never shared', () => {
        const { data } = reimport(RESEARCH);
        const p = (first: string) => Object.values(data.persons).find(x => x.firstName === first)!;
        const h = p('Hvozdimír').events!.find(e => e.type === 'census')!;
        const z = p('Zbyhněva').events!.find(e => e.type === 'census')!;
        expect(h.shareId).toBe('SH7K2QX');
        expect(z.shareId).toBe('SH7K2QX');
        expect(h.shareRole).toBeUndefined();
        expect(z.shareRole).toBe('maid of the farm');
        expect(z.address).toBe('No. 14');
        expect(parseInt(z.age ?? '')).toBe(38);
        expect(z.sourceIds).toHaveLength(1);
        expect(p('Zbyhněva').events!.find(e => e.type === 'residence')!.shareId).toBeUndefined();
        expect(p('Zbyhněva').events!.find(e => e.type === 'baptism')?.shareId).toBeUndefined();
    });

    it('reads _STROM_ROLE into roleAt: godparent and a wedding witness as their types, any other as a custom event', () => {
        const { data } = reimport(RESEARCH);
        const p = (first: string) => Object.values(data.persons).find(x => x.firstName === first)!;
        const events = p('Pelhan').events!;
        expect(events.map(e => e.type)).toEqual(['godparent', 'weddingWitness', 'custom', 'custom']);
        expect(events[0].roleAt).toMatchObject({ role: 'godparent', personId: p('Zbyhněva').id, eventType: 'baptism' });
        expect(events[0].customLabel).toBeUndefined();
        const union = Object.values(data.partnerships)[0];
        expect(events[1].roleAt).toEqual({ role: 'witness', partnershipId: union.id, eventType: 'marriage', eventId: 'marriage' });
        const census = p('Hvozdimír').events!.find(e => e.type === 'census')!;
        expect(events[2].roleAt).toEqual({ role: 'witness', personId: p('Hvozdimír').id, eventType: 'census', eventId: census.id });
        expect(events[2].customLabel).toBe('Svědectví');
        expect(events[3].roleAt).toEqual({ role: 'other', eventType: '' });
    });

    it('does not count the marks as dropped tags', () => {
        const { stats } = reimport(RESEARCH);
        const dropped = JSON.stringify(stats);
        expect(dropped).not.toContain('_STROM_SHARE');
        expect(dropped).not.toContain('_STROM_ROLE');
        expect(dropped).not.toContain('_STROM_AT');
    });
});

describe('GEDCOM privacy with a living member of a shared event (spec 085 §7)', () => {
    /** A deceased couple and their living son share a residence; the son's godfather is deceased. */
    function livingTree(): StromData {
        const resi = (id: string, extra: Partial<LifeEvent> = {}): LifeEvent => ({
            id, type: 'residence', date: '1995', place: 'Lipolesy', address: 'Secretlane 7', shareId: 'RS42abc', ...extra,
        });
        return {
            version: 20,
            persons: {
                p_f: person('p_f', 'Hvozdimír', 'Ostrozub', 'male', {
                    birthDate: '1930', deathDate: '2000', partnerships: ['u1'], childIds: ['p_s'], events: [resi('r_f')],
                } as Partial<Person>),
                p_m: person('p_m', 'Zbyhněva', 'Ostrozubová', 'female', {
                    birthDate: '1932', deathDate: '2005', partnerships: ['u1'], childIds: ['p_s'], events: [resi('r_m')],
                } as Partial<Person>),
                p_s: person('p_s', 'Mstiboj', 'Ostrozub', 'male', {
                    birthDate: '1970-05-05', parentIds: ['p_f', 'p_m'],
                    events: [resi('r_s', { shareRole: 'Hiddenrole son' }), { id: 'e_bap', type: 'baptism', date: '1970-05-20' }],
                } as Partial<Person>),
                p_g: person('p_g', 'Pelhan', 'Bezruk', 'male', {
                    birthDate: '1920', deathDate: '1999',
                    events: [
                        { id: 'e_gp', type: 'godparent', date: '1970-05-20', roleAt: { role: 'godparent', personId: 'p_s', eventType: 'baptism', eventId: 'e_bap' } },
                        { id: 'r_g', type: 'census', date: '1991', place: 'Lipolesy', shareId: 'CS99xyz' },
                    ],
                } as Partial<Person>),
            },
            partnerships: {
                u1: { id: 'u1', person1Id: 'p_f', person2Id: 'p_m', status: 'married', startDate: '1960', childIds: ['p_s'] },
            },
        } as unknown as StromData;
    }
    // The living son's census copy goes with his events: Pelhan's is alone.
    const withLivingCensus = (): StromData => {
        const d = livingTree();
        d.persons['p_s' as keyof typeof d.persons].events!.push({ id: 'c_s', type: 'census', date: '1991', place: 'Lipolesy', shareId: 'CS99xyz' });
        return d;
    };

    it('writes everything in full', () => {
        const ged = exportToGedcom(applyLivingPrivacy(withLivingCensus(), 'full', NOW), 'Ostrozub').content;
        expect(ged.match(/_STROM_SHARE RS42abc/g)).toHaveLength(3);
        expect(ged).toContain('3 _ROLE Hiddenrole son');
        expect(ged).toMatch(/3 _STROM_AT @I\w+@\n4 TYPE BAPM/);
        expect(ged.match(/_STROM_SHARE CS99xyz/g)).toHaveLength(2);
    });

    for (const mode of ['initials', 'anonymous'] as const) {
        it(`reveals nothing of the living member with ${mode}`, () => {
            const data = applyLivingPrivacy(withLivingCensus(), mode, NOW);
            const ged = exportToGedcom(data, 'Ostrozub').content;
            expect(ged).not.toContain('Hiddenrole');
            // The deceased parents' copies still make one event; the son has none.
            expect(ged.match(/_STROM_SHARE RS42abc/g)).toHaveLength(2);
            const son = data.persons['p_s' as keyof typeof data.persons];
            expect(son.events ?? []).toEqual([]);
            // The godfather keeps his role, not whose baptism it was.
            expect(ged).toContain('2 _STROM_ROLE godparent');
            expect(ged).not.toContain('_STROM_AT');
            expect(ged).not.toContain('4 TYPE BAPM');
            const gp = data.persons['p_g' as keyof typeof data.persons].events!.find(e => e.type === 'godparent')!;
            expect(gp.roleAt).toEqual({ role: 'godparent', eventType: 'baptism' });
            // The census Pelhan shared only with the living son is his own event now.
            expect(ged).not.toContain('CS99xyz');
            expect(data.persons['p_g' as keyof typeof data.persons].events!.find(e => e.type === 'census')!.shareId).toBeUndefined();
        });
    }

    it('drops whose wedding it was when a partner is living', () => {
        const d = livingTree();
        const son = d.persons['p_s' as keyof typeof d.persons];
        son.partnerships = ['u2'] as never;
        d.persons['p_w' as keyof typeof d.persons] = person('p_w', 'Vratislava', 'Bezruková', 'female', { birthDate: '1972', partnerships: ['u2'] as never } as Partial<Person>);
        d.partnerships['u2' as keyof typeof d.partnerships] = { id: 'u2', person1Id: 'p_s', person2Id: 'p_w', status: 'married', startDate: '1995', childIds: [] } as never;
        d.persons['p_g' as keyof typeof d.persons].events!.push({ id: 'e_ww', type: 'weddingWitness', date: '1995', roleAt: { role: 'witness', partnershipId: 'u2' as never, eventType: 'marriage', eventId: 'marriage' } });
        const data = applyLivingPrivacy(d, 'initials', NOW);
        const ww = data.persons['p_g' as keyof typeof data.persons].events!.find(e => e.type === 'weddingWitness')!;
        expect(ww.roleAt).toEqual({ role: 'witness', eventType: 'marriage' });
        expect(exportToGedcom(data, 'Ostrozub').content).not.toContain('4 TYPE MARR');
    });
});

describe('JSON for the research (spec 085 §7)', () => {
    it('carries shareId, shareRole and roleAt as stored', () => {
        const json = JSON.parse(buildTransferJson({ v: 1, token: 'tok', from: 'chrome', tree: 'Ostrozub', people: 4 } as never, householdTree()));
        const m = json.persons.p_m.events[0];
        expect(m.shareId).toBe('SH7K2QX');
        expect(m.shareRole).toBe('Head of the farm');
        expect(json.persons.p_g.events[0].roleAt).toEqual({ role: 'godparent', personId: 'p_d', eventType: 'baptism', eventId: 'e_bap' });
        expect(json.persons.p_g.events[1].roleAt).toEqual({ role: 'witness', partnershipId: 'u1', eventType: 'marriage', eventId: 'marriage' });
    });
});
