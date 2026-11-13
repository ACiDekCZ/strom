/**
 * keepEventShares (spec 085 §7, ZADANI_VYZKUM §8): an older research (no
 * `event.share` in its features) drops `_STROM_SHARE` and `_STROM_ROLE`
 * under an event and gives the events back without them; the app takes the
 * marks from the previous state, event by event, only where the match is
 * unique. Invented data.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { keepEventShares, stabilizeIds, EVENT_SHARE_FEATURE } from '../research-link.js';
import { buildSharedEventIndex } from '../shared-events.js';
import { LifeEvent, Person, PersonId, StromData } from '../types.js';

const pp = (data: StromData, id: string): Person => data.persons[id as PersonId];

function person(id: string, refn: string, firstName: string, lastName: string, gender: 'male' | 'female', extra: Partial<Person> = {}): Person {
    return {
        id, refn, firstName, lastName, gender, isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...extra,
    } as unknown as Person;
}

/** A household of three in the 1921 census, a godfather at the daughter's baptism and a witness at the wedding. */
function householdTree(): StromData {
    const census = (id: string, age: string, extra: Partial<LifeEvent> = {}): LifeEvent => ({
        id, type: 'census', date: '1921-02-15', place: 'Medvezin', age,
        sourceIds: ['s1'], shareId: 'SH7K2QX', ...extra,
    });
    return {
        version: 20,
        persons: {
            p_f: person('p_f', 'P0001', 'Hvozdimír', 'Ostrozub', 'male', {
                partnerships: ['u1'], childIds: ['p_d'],
                events: [census('e_f', '42 years'), { id: 'e_f_res', type: 'residence', date: '1925', place: 'Lipolesy', shareId: 'Res25' }],
            } as Partial<Person>),
            p_m: person('p_m', 'P0002', 'Zbyhněva', 'Ostrozubová', 'female', {
                partnerships: ['u1'], childIds: ['p_d'],
                events: [census('e_m', '38 years', { shareRole: 'Head of the farm' }), { id: 'e_m_res', type: 'residence', date: '1925', place: 'Lipolesy', shareId: 'Res25' }],
            } as Partial<Person>),
            p_d: person('p_d', 'P0003', 'Vratislava', 'Ostrozubová', 'female', {
                parentIds: ['p_f', 'p_m'],
                events: [
                    census('e_d', '10 years', { shareRole: 'daughter' }),
                    { id: 'e_bap', type: 'baptism', date: '1910-03-14', place: 'Medvezin' },
                ],
            } as Partial<Person>),
            p_g: person('p_g', 'P0004', 'Pelhan', 'Bezruk', 'male', {
                events: [
                    {
                        id: 'e_gp', type: 'godparent', date: '1910-03-14', place: 'Medvezin',
                        roleAt: { role: 'godparent', personId: 'p_d', eventType: 'baptism', eventId: 'e_bap' },
                    },
                    {
                        id: 'e_ww', type: 'weddingWitness', date: '1908-06-20', place: 'Lipolesy',
                        roleAt: { role: 'witness', partnershipId: 'u1', eventType: 'marriage', eventId: 'marriage' },
                    },
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

/** What a research before `event.share` gives back: the tree's GEDCOM without the lines it does not keep. */
function olderResearch(ged: string, edit: (lines: string[]) => string[] = l => l): StromData {
    const lines = ged.split(/\r?\n/);
    const kept: string[] = [];
    let skipBelow = -1;
    for (const line of lines) {
        const level = Number(line.split(' ')[0]);
        if (skipBelow >= 0 && level > skipBelow) continue;
        skipBelow = -1;
        if (/^\d+ _STROM_(SHARE|ROLE)\b/.test(line)) { skipBelow = level; continue; }
        kept.push(line);
    }
    return convertToStrom(parseGedcom(edit(kept).join('\n'))).data;
}

const byRefn = (d: StromData, refn: string): Person => Object.values(d.persons).find(p => p.refn === refn)!;
const eventOf = (d: StromData, refn: string, type: string, date?: string): LifeEvent =>
    byRefn(d, refn).events!.find(e => e.type === type && (date === undefined || e.date === date))!;

describe('keepEventShares: an older research (no event.share)', () => {
    it('the research gives the events back without marks; the app keeps the shares, the roles and the godparent events', () => {
        const previous = householdTree();
        const ged = exportToGedcom(previous, 'T').content;
        expect(ged).toContain('_STROM_SHARE SH7K2QX');
        const next = olderResearch(ged);
        // The research dropped them: the census is three ordinary events, the godparent a custom event.
        expect(eventOf(next, 'P0001', 'census').shareId).toBeUndefined();
        expect(eventOf(next, 'P0004', 'godparent')).toBeUndefined();
        for (const features of [null, undefined, [], ['sync.ids', 'person.titles']]) {
            const out = keepEventShares(next, previous, features);
            expect(out).not.toBe(next);
            for (const refn of ['P0001', 'P0002', 'P0003']) expect(eventOf(out, refn, 'census').shareId).toBe('SH7K2QX');
            expect(eventOf(out, 'P0002', 'census').shareRole).toBe('Head of the farm');
            expect(eventOf(out, 'P0003', 'census').shareRole).toBe('daughter');
            expect(eventOf(out, 'P0001', 'census').shareRole).toBeUndefined();
            expect(eventOf(out, 'P0001', 'residence').shareId).toBe('Res25');
            // The godparent's own event points at the daughter of the update and her baptism there.
            const gp = eventOf(out, 'P0004', 'godparent');
            expect(gp.customLabel).toBeUndefined();
            expect(gp.roleAt).toEqual({
                role: 'godparent', personId: byRefn(out, 'P0003').id, eventType: 'baptism',
                eventId: eventOf(out, 'P0003', 'baptism').id,
            });
            const ww = eventOf(out, 'P0004', 'weddingWitness');
            expect(ww.roleAt).toMatchObject({ role: 'witness', eventType: 'marriage', eventId: 'marriage' });
            expect(out.partnerships[ww.roleAt!.partnershipId!]).toBeDefined();
        }
        // Neither input changed.
        expect(eventOf(next, 'P0001', 'census').shareId).toBeUndefined();
        expect(eventOf(previous, 'P0001', 'census').shareId).toBe('SH7K2QX');
    });

    it('after the ids are carried over the tree is the previous one: the same events, ids and links', () => {
        const previous = householdTree();
        const out = stabilizeIds(keepEventShares(olderResearch(exportToGedcom(previous, 'T').content), previous, null), previous);
        expect(pp(out, 'p_d').events!.find(e => e.type === 'census')).toMatchObject({ id: 'e_d', shareId: 'SH7K2QX', shareRole: 'daughter' });
        expect(pp(out, 'p_g').events!.find(e => e.type === 'godparent')).toMatchObject({
            id: 'e_gp', roleAt: { role: 'godparent', personId: 'p_d', eventType: 'baptism', eventId: 'e_bap' },
        });
        expect(pp(out, 'p_g').events!.find(e => e.type === 'weddingWitness')!.roleAt).toEqual({
            role: 'witness', partnershipId: 'u1', eventType: 'marriage', eventId: 'marriage',
        });
        const index = buildSharedEventIndex(out);
        expect(index.shares.get('SH7K2QX')?.map(c => c.personId).sort()).toEqual(['p_d', 'p_f', 'p_m']);
        // Three rounds leave it as it was.
        let data = out;
        for (let round = 0; round < 3; round++) {
            data = stabilizeIds(keepEventShares(olderResearch(exportToGedcom(data, 'T').content), data, []), data);
        }
        expect(buildSharedEventIndex(data).shares.get('SH7K2QX')?.length).toBe(3);
        expect(pp(data, 'p_g').events!.find(e => e.type === 'godparent')!.roleAt?.personId).toBe('p_d');
    });

    it('a copy the research changed (another date) loses the mark; the others stay joined', () => {
        const previous = householdTree();
        const ged = exportToGedcom(previous, 'T').content;
        // The research corrected the daughter's census date only.
        const next = olderResearch(ged, lines => {
            const at = lines.findIndex(l => l === '1 NAME Vratislava /Ostrozubová/');
            const date = lines.findIndex((l, i) => i > at && l === '2 DATE 15 FEB 1921');
            return lines.map((l, i) => (i === date ? '2 DATE 16 FEB 1921' : l));
        });
        const out = keepEventShares(next, previous, null);
        expect(eventOf(out, 'P0003', 'census').date).toBe('1921-02-16');
        expect(eventOf(out, 'P0003', 'census').shareId).toBeUndefined();
        expect(eventOf(out, 'P0003', 'census').shareRole).toBeUndefined();
        expect(eventOf(out, 'P0001', 'census').shareId).toBe('SH7K2QX');
        expect(eventOf(out, 'P0002', 'census').shareId).toBe('SH7K2QX');
    });

    it('a share only one copy comes back to is none (the other changed there)', () => {
        const previous = householdTree();
        const next = olderResearch(exportToGedcom(previous, 'T').content, lines => lines.map((l, i) => (i === lines.indexOf('2 DATE 1925') ? '2 DATE 1926' : l)));
        const out = keepEventShares(next, previous, null);
        const residences = ['P0001', 'P0002'].map(r => byRefn(out, r).events!.find(e => e.type === 'residence')!);
        expect(residences.map(e => e.date).sort()).toEqual(['1925', '1926']);
        expect(residences.every(e => e.shareId === undefined)).toBe(true);
        // The census stays shared.
        expect(eventOf(out, 'P0001', 'census').shareId).toBe('SH7K2QX');
    });

    it('an event that is not unique on either side keeps no mark', () => {
        const previous = householdTree();
        const next = olderResearch(exportToGedcom(previous, 'T').content);
        // The research holds the father's census twice.
        const father = byRefn(next, 'P0001');
        father.events!.push({ ...eventOf(next, 'P0001', 'census'), id: 'ev_twice' });
        const out = keepEventShares(next, previous, null);
        expect(byRefn(out, 'P0001').events!.filter(e => e.type === 'census').every(e => !e.shareId)).toBe(true);
        expect(eventOf(out, 'P0002', 'census').shareId).toBe('SH7K2QX');
        // Two equal events in the previous state: neither is matched.
        const twice = householdTree();
        pp(twice, 'p_m').events!.push({ ...pp(twice, 'p_m').events![0], id: 'e_m2' });
        const out2 = keepEventShares(olderResearch(exportToGedcom(householdTree(), 'T').content), twice, null);
        expect(eventOf(out2, 'P0002', 'census').shareId).toBeUndefined();
        expect(eventOf(out2, 'P0001', 'census').shareId).toBe('SH7K2QX');
    });
});

describe('keepEventShares: a research with event.share', () => {
    it('its marks are the research\'s: the version comes back as it is', () => {
        const previous = householdTree();
        const ged = exportToGedcom(previous, 'T').content;
        // The research separated the daughter's copy (its mark is gone there), the rest it holds.
        const lines = ged.split('\n');
        const at = lines.findIndex(l => l === '1 NAME Vratislava /Ostrozubová/');
        const mark = lines.findIndex((l, i) => i > at && l === '2 _STROM_SHARE SH7K2QX');
        const next = convertToStrom(parseGedcom(lines.filter((_l, i) => i !== mark && i !== mark + 1).join('\n'))).data;
        expect(eventOf(next, 'P0001', 'census').shareId).toBe('SH7K2QX');
        const out = keepEventShares(next, previous, [EVENT_SHARE_FEATURE]);
        expect(out).toBe(next);
        expect(eventOf(out, 'P0003', 'census').shareId).toBeUndefined();
    });

    it('a version with no mark at all never got them (the tree went there while the research was older): they stay', () => {
        const previous = householdTree();
        const next = olderResearch(exportToGedcom(previous, 'T').content);
        const out = keepEventShares(next, previous, ['sync.ids', EVENT_SHARE_FEATURE]);
        expect(eventOf(out, 'P0001', 'census').shareId).toBe('SH7K2QX');
        expect(eventOf(out, 'P0004', 'godparent').roleAt?.role).toBe('godparent');
    });

    it('a tree without marks is left as it is', () => {
        const plain = householdTree();
        for (const p of Object.values(plain.persons)) {
            p.events = (p.events ?? []).filter(e => !e.roleAt).map(({ shareId: _s, shareRole: _r, ...e }) => e as LifeEvent);
        }
        const next = olderResearch(exportToGedcom(plain, 'T').content);
        expect(keepEventShares(next, plain, null)).toBe(next);
    });
});
