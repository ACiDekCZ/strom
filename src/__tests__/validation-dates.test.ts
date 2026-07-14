/**
 * Extended tree validation: date consistency (events vs lifespan, weddings vs
 * partners' lives, posthumous children, lifespans) and source/attachment
 * integrity. All checks must be CERTAIN — approximate dates (~, <, >) or
 * year-only precision must not produce false positives.
 */

import { describe, it, expect } from 'vitest';
import { validateTreeData } from '../validation.js';
import {
    StromData, Person, Partnership, PersonId, PartnershipId, Gender, LifeEvent, Attachment,
} from '../types.js';

interface POpts {
    birthDate?: string; deathDate?: string; gender?: Gender; events?: LifeEvent[];
    parentIds?: string[]; childIds?: string[]; partnerships?: string[];
    sourceIds?: string[]; attachments?: Attachment[];
    parentRelTypes?: Record<string, 'biological' | 'adoptive' | 'step' | 'foster'>;
}
function person(id: string, o: POpts = {}): Person {
    return {
        id: id as PersonId, firstName: id, lastName: 'X', gender: o.gender ?? 'male',
        isPlaceholder: false,
        parentIds: (o.parentIds ?? []) as PersonId[],
        childIds: (o.childIds ?? []) as PersonId[],
        partnerships: (o.partnerships ?? []) as PartnershipId[],
        ...(o.birthDate ? { birthDate: o.birthDate } : {}),
        ...(o.deathDate ? { deathDate: o.deathDate } : {}),
        ...(o.events ? { events: o.events } : {}),
        ...(o.sourceIds ? { sourceIds: o.sourceIds } : {}),
        ...(o.attachments ? { attachments: o.attachments } : {}),
        ...(o.parentRelTypes ? { parentRelTypes: o.parentRelTypes as Person['parentRelTypes'] } : {}),
    };
}
function union(id: string, p1: string, p2: string, startDate?: string, childIds: string[] = []): Partnership {
    return {
        id: id as PartnershipId, person1Id: p1 as PersonId, person2Id: p2 as PersonId,
        childIds: childIds as PersonId[], status: 'married',
        ...(startDate ? { startDate } : {}),
    };
}
function data(persons: Person[], partnerships: Partnership[] = [], sources?: StromData['sources']): StromData {
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: Object.fromEntries(partnerships.map(u => [u.id, u])) as StromData['partnerships'],
        ...(sources ? { sources } : {}),
    };
}
const types = (d: StromData) => validateTreeData(d).issues.map(i => i.type);

describe('date consistency', () => {
    it('flags death before birth as an error', () => {
        const d = data([person('a', { birthDate: '1900', deathDate: '1890' })]);
        expect(types(d)).toContain('deathBeforeBirth');
    });

    it('does not flag approximate dates that could overlap', () => {
        const d = data([person('a', { birthDate: '~1900', deathDate: '1899' })]);
        expect(types(d)).not.toContain('deathBeforeBirth');
    });

    it('flags an implausible lifespan', () => {
        const d = data([person('a', { birthDate: '1700', deathDate: '1850' })]);
        expect(types(d)).toContain('implausibleLifespan');
    });

    it('flags an event before birth (baptism) and after death', () => {
        const d = data([person('a', {
            birthDate: '1850', deathDate: '1900',
            events: [
                { id: 'e1', type: 'baptism', date: '1840' },
                { id: 'e2', type: 'occupation', date: '1910' },
            ],
        })]);
        const t = types(d);
        expect(t).toContain('eventBeforeBirth');
        expect(t).toContain('eventAfterDeath');
    });

    it('does not flag a burial after death', () => {
        const d = data([person('a', {
            birthDate: '1850', deathDate: '1900',
            events: [{ id: 'e1', type: 'burial', date: '1900-06' }],
        })]);
        expect(types(d)).not.toContain('eventAfterDeath');
    });

    it('flags a wedding outside the partners\' lives and a child marriage', () => {
        const groom = person('g', { birthDate: '1800', deathDate: '1850', partnerships: ['u1', 'u2'] });
        const bride = person('b', { gender: 'female', birthDate: '1845', partnerships: ['u1'] });
        const late = person('l', { gender: 'female', birthDate: '1810', partnerships: ['u2'] });
        const d = data(
            [groom, bride, late],
            [union('u1', 'g', 'b', '1855'), union('u2', 'g', 'l', '1790')]
        );
        const t = types(d);
        expect(t).toContain('weddingAfterDeath');   // groom died 1850, wedding 1855
        expect(t).toContain('childMarriage');       // bride was certainly under 14 in 1855
        expect(t).toContain('weddingBeforeBirth');  // groom born 1800, wedding 1790
    });

    it('flags a child born after the mother\'s death and long after the father\'s', () => {
        const mother = person('m', { gender: 'female', deathDate: '1880', childIds: ['c'] });
        const father = person('f', { deathDate: '1878', childIds: ['c'] });
        const child = person('c', { birthDate: '1885', parentIds: ['m', 'f'] });
        const t = types(data([mother, father, child]));
        expect(t).toContain('childAfterMotherDeath');
        expect(t).toContain('childAfterFatherDeath');
    });

    it('does not apply posthumous-birth checks to adoptive parents', () => {
        const adoptive = person('m', { gender: 'female', deathDate: '1880', childIds: ['c'] });
        const child = person('c', { birthDate: '1885', parentIds: ['m'], parentRelTypes: { m: 'adoptive' } });
        expect(types(data([adoptive, child]))).not.toContain('childAfterMotherDeath');
    });

    it('reports an extreme partner age gap as info', () => {
        const a = person('a', { birthDate: '1800', partnerships: ['u1'] });
        const b = person('b', { gender: 'female', birthDate: '1845', partnerships: ['u1'] });
        const result = validateTreeData(data([a, b], [union('u1', 'a', 'b')]));
        const issue = result.issues.find(i => i.type === 'partnerAgeGap');
        expect(issue?.severity).toBe('info');
    });

    it('a clean historical family produces none of the new issues', () => {
        const h = person('h', { birthDate: '1820-03-02', deathDate: '1890-11-20', partnerships: ['u1'], childIds: ['c'] });
        const w = person('w', { gender: 'female', birthDate: '1825', deathDate: '<1900', partnerships: ['u1'], childIds: ['c'] });
        const c = person('c', { birthDate: '1850', parentIds: ['h', 'w'], events: [{ id: 'e', type: 'baptism', date: '1850-04' }] });
        const t = types(data([h, w, c], [union('u1', 'h', 'w', '1845', ['c'])]));
        for (const bad of ['deathBeforeBirth', 'implausibleLifespan', 'eventBeforeBirth', 'eventAfterDeath',
            'weddingBeforeBirth', 'weddingAfterDeath', 'childMarriage',
            'childAfterMotherDeath', 'childAfterFatherDeath', 'partnerAgeGap']) {
            expect(t).not.toContain(bad);
        }
    });
});

describe('source and attachment integrity', () => {
    const src = { s1: { id: 's1', title: 'Parish register' } };

    it('flags citations to missing sources on person, event and attachment', () => {
        const att: Attachment = {
            id: 'at1', name: 'scan.jpg', mimeType: 'image/jpeg',
            dataUrl: 'data:image/jpeg;base64,QUJDREVGR0hJSktMTU5PUFFSUw==', sizeBytes: 20, sourceId: 'gone',
        };
        const d = data([person('a', {
            sourceIds: ['s1', 'missing'],
            events: [{ id: 'e1', type: 'baptism', sourceIds: ['also-missing'] }],
            attachments: [att],
        })], [], src);
        const hits = validateTreeData(d).issues.filter(i => i.type === 'citationMissingSource');
        expect(hits).toHaveLength(3);
    });

    it('flags an attachment without usable data', () => {
        const att: Attachment = { id: 'at1', name: 'broken.pdf', mimeType: 'application/pdf', dataUrl: '', sizeBytes: 0 };
        const d = data([person('a', { attachments: [att] })]);
        expect(types(d)).toContain('attachmentNoData');
    });

    it('accepts valid citations and attachments', () => {
        const att: Attachment = {
            id: 'at1', name: 'scan.jpg', mimeType: 'image/jpeg',
            dataUrl: 'data:image/jpeg;base64,QUJDREVGR0hJSktMTU5PUFFSUw==', sizeBytes: 20, sourceId: 's1',
        };
        const d = data([person('a', { sourceIds: ['s1'], attachments: [att] })], [], src);
        const t = types(d);
        expect(t).not.toContain('citationMissingSource');
        expect(t).not.toContain('attachmentNoData');
    });
});
