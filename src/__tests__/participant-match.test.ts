/**
 * A godparent or a witness recorded by name who is probably in the tree
 * (spec 085 §6, K1.4): who is a candidate (the same name folded, alive at
 * the event and at least 12 years old, not a person of the event, not
 * rejected), the year and house shown with them, the leads of the Data
 * quality check, and linking or rejecting through DataManager with the name
 * kept. Fictional data (the Mrákota and Pšeničný families of Zvonov).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    findParticipantMatches, buildPersonNameIndex, matchMeta, nameLinkLeads, rejectedNameLinks, couldAttend,
} from '../participant-match.js';
import { validateTreeData } from '../validation.js';
import { buildSharedEventIndex, MARRIAGE_EVENT_ID } from '../shared-events.js';
import { derivedParticipations } from '../derived-participations.js';
import { StromData, Person, PersonId, PartnershipId, Gender } from '../types.js';
import type { TreeId } from '../types.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { syntheticTree } from './helpers/synthetic-tree.js';
import { budgetReport, measureAgainstBudget } from './helpers/perf-budget.js';

function p(id: string, first: string, last: string, gender: Gender, extra: Partial<Person> = {}): Person {
    return { id: id as PersonId, firstName: first, lastName: last, gender, isPlaceholder: false, parentIds: [], childIds: [], partnerships: [], ...extra } as Person;
}
const pid = (x: string) => x as PersonId;

/**
 * Hostivít Mrákota the elder (1850–1920, Zvonov č. 9) and his son of the same
 * name (born 1880); a third Hostivít born 1885 was eleven at the baptism of
 * 1896; a fourth died in 1890. Jaromila Zvonková married Mrákotová (1870).
 * Bolemír Pšeničný's baptism of 1896 names "Hostivit Mrakota" (no
 * diacritics) and "Jaromila Mrákotová"; the wedding of Dobrohost Ořešník and
 * Radmila Pšeničná (1899) names the witness "Hostivít Mrákota".
 */
function tree(): StromData {
    const persons: StromData['persons'] = {};
    const add = (x: Person) => { persons[x.id] = x; };
    add(p('h1', 'Hostivít', 'Mrákota', 'male', { birthDate: '1850-03-01', deathDate: '1920', birthPlace: 'Zvonov', birthAddress: 'č. 9' }));
    add(p('h2', 'Hostivít', 'Mrákota', 'male', {
        birthDate: '1880-05-10', birthPlace: 'Zvonov', birthAddress: 'č. 9',
        events: [{ id: 'res', type: 'residence', date: '1895', place: 'Zvonov', address: 'Zvonov č. 14' }],
    }));
    add(p('h3', 'Hostivít', 'Mrákota', 'male', { birthDate: '1885-06-01' }));
    add(p('h4', 'Hostivít', 'Mrákota', 'male', { birthDate: '1840', deathDate: '1890-02-01' }));
    add(p('jz', 'Jaromila', 'Zvonková', 'female', { birthDate: '1870', marriedSurname: 'Mrákotová' }));
    add(p('bp', 'Bolemír', 'Pšeničný', 'male', {
        birthDate: '1896-04-02',
        events: [{ id: 'bap', type: 'baptism', date: '1896-04-03', place: 'Zvonov', participants: [
            { id: 'g1', role: 'godparent', name: 'Hostivit Mrakota' },
            { id: 'g2', role: 'godparent', name: 'Jaromila Mrákotová' },
            { id: 'g3', role: 'officiant', name: 'Hostivít Mrákota' },
        ] }],
    }));
    add(p('do', 'Dobrohost', 'Ořešník', 'male', { birthDate: '1870', partnerships: ['u1' as PartnershipId] }));
    add(p('rp', 'Radmila', 'Pšeničná', 'female', { birthDate: '1875', partnerships: ['u1' as PartnershipId] }));
    return {
        persons,
        partnerships: {
            u1: {
                id: 'u1' as PartnershipId, person1Id: pid('do'), person2Id: pid('rp'), status: 'married', childIds: [],
                startDate: '1899-06-10', startPlace: 'Zvonov',
                participants: [{ id: 'w1', role: 'witness', name: 'Hostivít Mrákota, sedlák č. 9' }],
            },
        },
    } as StromData;
}

const ids = (list: { personId: PersonId }[]) => list.map(m => m.personId);

describe('findParticipantMatches', () => {
    it('a father and his son of the same name are two candidates, the eldest first, diacritics folded', () => {
        const d = tree();
        const m = findParticipantMatches(d, 'Hostivit Mrakota', { date: '1896-04-03', subjects: [pid('bp')] });
        expect(ids(m)).toEqual(['h1', 'h2']);
        expect(m[0]).toEqual({ personId: 'h1', birthYear: 1850, house: 'Zvonov č. 9' });
        // The residence nearest to 1896 gives the son's house.
        expect(m[1]).toEqual({ personId: 'h2', birthYear: 1880, house: 'Zvonov č. 14' });
        expect(matchMeta(m[0])).toBe('* 1850, Zvonov č. 9');
        expect(matchMeta(m[1], ' · ')).toBe('* 1880 · Zvonov č. 14');
    });

    it('age 12: eleven at the date is out, twelve is in', () => {
        const d = tree();
        // Hostivít born 1885-06-01: eleven on 1896-04-03, twelve on 1897-06-01.
        expect(couldAttend(d.persons[pid('h3')], '1896-04-03')).toBe(false);
        expect(couldAttend(d.persons[pid('h3')], '1897-06-01')).toBe(true);
        expect(couldAttend(d.persons[pid('h3')], '1897-05-31')).toBe(false);
        // A year alone: possibly twelve already.
        expect(couldAttend(d.persons[pid('h3')], '1897')).toBe(true);
        expect(ids(findParticipantMatches(d, 'Hostivít Mrákota', { date: '1897-06-02' }))).toEqual(['h1', 'h2', 'h3']);
    });

    it('a person dead before the date is out; one who died later or with no date of death is in', () => {
        const d = tree();
        expect(couldAttend(d.persons[pid('h4')], '1896-04-03')).toBe(false);
        expect(couldAttend(d.persons[pid('h4')], '1889-12-31')).toBe(true);
        expect(ids(findParticipantMatches(d, 'Hostivít Mrákota', { date: '1889-06-01' }))).toEqual(['h4', 'h1']);
    });

    it('an event without a date rules nobody out by age', () => {
        const d = tree();
        expect(ids(findParticipantMatches(d, 'Hostivít Mrákota', {}))).toEqual(['h4', 'h1', 'h2', 'h3']);
    });

    it('never the person of the event, never one rejected, never a given name alone', () => {
        const d = tree();
        expect(ids(findParticipantMatches(d, 'Hostivít Mrákota', { date: '1896', subjects: [pid('h1')] }))).toEqual(['h2']);
        expect(ids(findParticipantMatches(d, 'Hostivít Mrákota', { date: '1896', exclude: [pid('h2')] }))).toEqual(['h1']);
        expect(findParticipantMatches(d, 'Hostivít', { date: '1896' })).toEqual([]);
        expect(findParticipantMatches(d, 'Bořivoj Mrákota', { date: '1896' })).toEqual([]);
    });

    it('a married surname finds the woman; what the register adds after the name is left out', () => {
        const d = tree();
        expect(ids(findParticipantMatches(d, 'Jaromila Mrákotová', { date: '1896' }))).toEqual(['jz']);
        expect(ids(findParticipantMatches(d, 'Hostivít Mrákota, sedlák č. 9', { date: '1899-06-10' }))).toEqual(['h1', 'h2', 'h3']);
    });
});

describe('name-link leads (Data quality)', () => {
    it('one lead per godparent or witness by name with candidates; the priest is no lead', () => {
        const d = tree();
        const leads = nameLinkLeads(d);
        expect(leads.map(l => [l.ref.participantId, ids(l.candidates)])).toEqual([
            ['g1', ['h1', 'h2']],
            ['g2', ['jz']],
            ['w1', ['h1', 'h2', 'h3']],
        ]);
        expect(leads[2].ref).toEqual({ partnershipId: 'u1', eventId: MARRIAGE_EVENT_ID, participantId: 'w1' });
        expect(leads[2].subjects).toEqual(['do', 'rp']);
        const found = validateTreeData(d).issues.filter(i => i.type === 'nameLink');
        expect(found.map(i => [i.severity, i.subject, i.participant?.participantId])).toEqual([
            ['info', 'Hostivit Mrakota', 'g1'], ['info', 'Jaromila Mrákotová', 'g2'], ['info', 'Hostivít Mrákota, sedlák č. 9', 'w1'],
        ]);
    });

    it('rejected candidates are not offered again and an offer with none left is not counted', () => {
        const d = tree();
        const g2 = d.persons[pid('bp')].events![0].participants![1];
        g2.linkRejected = [pid('jz')];
        const g1 = d.persons[pid('bp')].events![0].participants![0];
        g1.linkRejected = [pid('h1')];
        const leads = nameLinkLeads(d);
        expect(leads.map(l => [l.ref.participantId, ids(l.candidates)])).toEqual([['g1', ['h2']], ['w1', ['h1', 'h2', 'h3']]]);
        expect(rejectedNameLinks(d)).toBe(2);
        expect(validateTreeData(d).issues.filter(i => i.type === 'nameLink')).toHaveLength(2);
    });

    it('a shared event is one lead with all its persons', () => {
        const d = tree();
        const census = (id: string) => ({ id, type: 'census' as const, date: '1900', place: 'Zvonov', shareId: 'SHZV2',
            participants: [{ id: 'c1', role: 'witness' as const, name: 'Jaromila Mrákotová' }] });
        d.persons[pid('do')].events = [census('cen1')];
        d.persons[pid('rp')].events = [census('cen2')];
        const leads = nameLinkLeads(d).filter(l => l.shareId);
        expect(leads).toHaveLength(1);
        expect(leads[0].subjects).toEqual(['do', 'rp']);
    });
});

describe('linking and rejecting (DataManager)', () => {
    const TREE = 'participant-match-tree' as TreeId;

    beforeEach(() => {
        vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
        vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
        const dm = DataManager as unknown as {
            data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null;
        };
        dm.data = tree();
        dm.currentTreeId = TREE;
        dm.viewMode = false;
        dm.pendingBefore = null;
        UndoManager.setActiveTree(null);
        UndoManager.setActiveTree(TREE);
    });

    it('Link sets the person and keeps the name, the derived row appears, one undo step', () => {
        const ref = { ownerPersonId: pid('bp'), eventId: 'bap', participantId: 'g1' };
        expect(DataManager.linkNamedParticipant(ref, pid('h2'))).toBe(true);
        const part = () => DataManager.getData().persons[pid('bp')].events![0].participants![0];
        expect(part()).toMatchObject({ personId: 'h2', name: 'Hostivit Mrakota' });
        const data = DataManager.getData();
        expect(derivedParticipations(data, buildSharedEventIndex(data), pid('h2')).map(r => [r.role, r.eventId])).toEqual([['godparent', 'bap']]);
        // Linked: no lead any more.
        expect(nameLinkLeads(data).map(l => l.ref.participantId)).toEqual(['g2', 'w1']);
        DataManager.undo();
        expect(part().personId).toBeUndefined();
    });

    it('a rejection is kept and its candidates are not offered again; a wedding witness too', () => {
        const ref = { partnershipId: 'u1' as PartnershipId, eventId: MARRIAGE_EVENT_ID, participantId: 'w1' };
        expect(DataManager.rejectNamedParticipant(ref, [pid('h1'), pid('h2'), pid('h3')])).toBe(true);
        expect(DataManager.getData().partnerships['u1' as PartnershipId].participants![0].linkRejected).toEqual(['h1', 'h2', 'h3']);
        expect(nameLinkLeads(DataManager.getData()).map(l => l.ref.participantId)).toEqual(['g1', 'g2']);
        // The same again changes nothing.
        expect(DataManager.rejectNamedParticipant(ref, [pid('h1')])).toBe(false);
        // The witnesses' editor keeps the rejections when it saves.
        const kept = DataManager.getData().partnerships['u1' as PartnershipId].participants!.map(x => ({ ...x }));
        DataManager.setPartnershipParticipants('u1' as PartnershipId, kept.map(x => ({ ...x, note: 'soused' })));
        expect(DataManager.getData().partnerships['u1' as PartnershipId].participants![0].linkRejected).toEqual(['h1', 'h2', 'h3']);
    });

    it('a shared event takes the link on every copy', () => {
        const census = (id: string) => ({ id, type: 'census' as const, date: '1900', place: 'Zvonov', shareId: 'SHZV2',
            participants: [{ id: 'c1', role: 'witness' as const, name: 'Jaromila Mrákotová' }] });
        const data = DataManager.getData();
        data.persons[pid('do')].events = [census('cen1')];
        data.persons[pid('rp')].events = [census('cen2')];
        expect(DataManager.linkNamedParticipant({ ownerPersonId: pid('do'), eventId: 'cen1', participantId: 'c1' }, pid('jz'))).toBe(true);
        expect(DataManager.getData().persons[pid('rp')].events![0].participants![0]).toMatchObject({ personId: 'jz', name: 'Jaromila Mrákotová' });
    });
});

describe('performance', () => {
    it('the leads of a 4 200-person tree stay within the budget', () => {
        const { data } = syntheticTree({ persons: 4200 });
        // Every fifth person's baptism names two godparents by the names of other persons of the tree.
        const people = Object.values(data.persons).filter(x => !x.isPlaceholder);
        people.forEach((x, i) => {
            if (i % 5) return;
            const a = people[(i * 7 + 3) % people.length];
            const b = people[(i * 11 + 5) % people.length];
            (x.events ??= []).push({ id: `bap${i}`, type: 'baptism', date: x.birthDate, participants: [
                { id: `p${i}a`, role: 'godparent', name: `${a.firstName} ${a.lastName}` },
                { id: `p${i}b`, role: 'godparent', name: `${b.firstName} ${b.lastName}` },
            ] });
        });
        expect(nameLinkLeads(data).length).toBeGreaterThan(0);
        const BUDGET_MS = 300;
        const m = measureAgainstBudget(() => nameLinkLeads(data, buildPersonNameIndex(data)), {
            budgetMs: BUDGET_MS, calibrationRounds: 8, referenceMs: 44, minPairs: 3, maxPairs: 8, maxWallMs: 20_000,
        });
        console.log(budgetReport('nameLinkLeads 4200 people', m, BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(BUDGET_MS);
    }, 60_000);
});
