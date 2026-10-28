/**
 * Data quality of the tree (spec 021 K1.1–K1.4): which recurring godparents
 * are leads, how godparents are compared by name, possible duplicates with a
 * stand-in birth year, events that come after a death by their nature, and
 * the grouping of the findings into Problems and Traces.
 *
 * The family is made up (the Lhoták family of Lhotka).
 */

import { describe, it, expect } from 'vitest';
import {
    validateTreeData, groupValidationIssues, validationCounts, issueCategory,
    qualityFinding, qualityFindingKey, birthYears, AFTER_DEATH_EVENT_TYPES, ValidationIssue,
} from '../validation.js';
import { godparentLeads, participantName, attendsByOffice, siblingGroupCount } from '../godparents.js';
import {
    StromData, Person, PersonId, PartnershipId, Gender, LifeEvent, EventParticipant,
} from '../types.js';

interface POpts {
    birthDate?: string; deathDate?: string; deathAge?: string; gender?: Gender;
    events?: LifeEvent[]; parentIds?: string[]; childIds?: string[];
}

function person(id: string, firstName: string, lastName: string, o: POpts = {}): Person {
    return {
        id: id as PersonId, firstName, lastName, gender: o.gender ?? 'male',
        isPlaceholder: false,
        parentIds: (o.parentIds ?? []) as PersonId[],
        childIds: (o.childIds ?? []) as PersonId[],
        partnerships: [] as PartnershipId[],
        ...(o.birthDate ? { birthDate: o.birthDate } : {}),
        ...(o.deathDate ? { deathDate: o.deathDate } : {}),
        ...(o.deathAge ? { deathAge: o.deathAge } : {}),
        ...(o.events ? { events: o.events } : {}),
    };
}

const tree = (...people: Person[]): StromData => ({
    persons: Object.fromEntries(people.map(p => [p.id, p])) as Record<PersonId, Person>,
    partnerships: {},
});

/** A baptism with the given participants (godparents unless said otherwise). */
function baptism(date: string, ...parts: Partial<EventParticipant>[]): LifeEvent {
    return {
        id: `ev_${Math.random().toString(36).slice(2)}`, type: 'baptism', date,
        participants: parts.map((x, i) => ({ id: `pt_${i}`, role: 'godparent' as const, ...x })),
    };
}

/** Children of one couple (they share both parents). */
function siblings(parentA: Person, parentB: Person, ...children: Person[]): void {
    for (const c of children) {
        c.parentIds = [parentA.id, parentB.id];
        parentA.childIds.push(c.id);
        parentB.childIds.push(c.id);
    }
}

const issuesOf = (d: StromData, type: string): ValidationIssue[] =>
    validateTreeData(d).issues.filter(i => i.type === type);

// ==================== K1.1 ====================

describe('recurring godparents: who is a lead (K1.1)', () => {
    /** Two unrelated families of Lhotka, each with one baptised child. */
    function twoFamilies(part: Partial<EventParticipant>, part2: Partial<EventParticipant> = part): StromData {
        return tree(
            person('a', 'Jan', 'Lhoták', { events: [baptism('1850', part)] }),
            person('b', 'Josef', 'Hrubeš', { events: [baptism('1852', part2)] }),
        );
    }

    it('a godparent in two unrelated families stays a lead', () => {
        const d = twoFamilies({ name: 'Václav Kubát' });
        expect(godparentLeads(d).map(l => l.name)).toEqual(['Václav Kubát']);
        expect(issuesOf(d, 'recurringGodparent')).toHaveLength(1);
        expect(issuesOf(d, 'recurringGodparent')[0].severity).toBe('info');
    });

    it('the officiating priest is not a lead, however often he baptised', () => {
        const d = twoFamilies({ role: 'officiant', name: 'Antonín Kříž' });
        expect(godparentLeads(d)).toEqual([]);
        expect(issuesOf(d, 'recurringGodparent')).toEqual([]);
    });

    it('a priest written as a witness (older entries) is not a lead either', () => {
        const d = twoFamilies({ role: 'witness', name: 'P. Antonín Kříž, kaplan' });
        expect(godparentLeads(d)).toEqual([]);
        const d2 = twoFamilies({ role: 'other', name: 'Antonín Kříž', note: 'farář v Lhotce' });
        expect(godparentLeads(d2)).toEqual([]);
    });

    it('the midwife is not a lead: the research role in the note, or her title in the name', () => {
        expect(godparentLeads(twoFamilies({ role: 'other', name: 'Marie Lhotáková', note: 'Midwife — z Lhotky' }))).toEqual([]);
        expect(godparentLeads(twoFamilies({ role: 'witness', name: 'Marie Lhotáková z Lhotky čp. 3, zkoušená porodní bába' }))).toEqual([]);
    });

    it('a godparent only of one couple’s children is the custom, not a lead', () => {
        const otec = person('f', 'Josef', 'Lhoták');
        const matka = person('m', 'Anna', 'Lhotáková', { gender: 'female' });
        const kids = [
            person('c1', 'Jan', 'Lhoták', { events: [baptism('1850', { name: 'Václav Kubát' })] }),
            person('c2', 'Marie', 'Lhotáková', { gender: 'female', events: [baptism('1852', { name: 'Václav Kubát' })] }),
            person('c3', 'Petr', 'Lhoták', { events: [baptism('1855', { name: 'Václav Kubát' })] }),
        ];
        siblings(otec, matka, ...kids);
        const d = tree(otec, matka, ...kids);
        expect(godparentLeads(d)).toEqual([]);
        expect(issuesOf(d, 'recurringGodparent')).toEqual([]);
    });

    it('half-siblings are one family too; a child of another family makes it a lead again', () => {
        const otec = person('f', 'Josef', 'Lhoták');
        const prvni = person('m1', 'Anna', 'Lhotáková', { gender: 'female' });
        const druha = person('m2', 'Marie', 'Lhotáková', { gender: 'female' });
        const c1 = person('c1', 'Jan', 'Lhoták', { events: [baptism('1850', { name: 'Václav Kubát' })] });
        const c2 = person('c2', 'Petr', 'Lhoták', { events: [baptism('1860', { name: 'Václav Kubát' })] });
        siblings(otec, prvni, c1);
        siblings(otec, druha, c2);
        expect(godparentLeads(tree(otec, prvni, druha, c1, c2))).toEqual([]);

        const soused = person('s', 'Karel', 'Hrubeš', { events: [baptism('1861', { name: 'Václav Kubát' })] });
        expect(godparentLeads(tree(otec, prvni, druha, c1, c2, soused)).map(l => l.name)).toEqual(['Václav Kubát']);
    });

    it('counts families by shared parents', () => {
        const otec = person('f', 'Josef', 'Lhoták');
        const matka = person('m', 'Anna', 'Lhotáková', { gender: 'female' });
        const a = person('a', 'Jan', 'Lhoták');
        const b = person('b', 'Petr', 'Lhoták');
        const c = person('c', 'Karel', 'Hrubeš');
        siblings(otec, matka, a, b);
        const d = tree(otec, matka, a, b, c);
        expect(siblingGroupCount([a.id, b.id], d)).toBe(1);
        expect(siblingGroupCount([a.id, b.id, c.id], d)).toBe(2);
        expect(siblingGroupCount([c.id, otec.id], d)).toBe(2);   // no parents: each their own
    });

    it('attendsByOffice: a godparent stays one even when the note says priest', () => {
        expect(attendsByOffice({ id: 'x', role: 'officiant', name: 'Antonín Kříž' })).toBe(true);
        expect(attendsByOffice({ id: 'x', role: 'godparent', name: 'Antonín Kříž', note: 'farář' })).toBe(false);
        expect(attendsByOffice({ id: 'x', role: 'witness', name: 'Václav Kubát, sedlák z Lhotky' })).toBe(false);
        expect(attendsByOffice({ id: 'x', role: 'other', name: 'Marie Kubátová', note: 'Hebamme' })).toBe(true);
    });
});

// ==================== K1.2 ====================

describe('godparents compared by the name alone (K1.2)', () => {
    it('the estate, the village and the house number do not split one godparent in two', () => {
        const d = tree(
            person('a', 'Jan', 'Lhoták', { events: [baptism('1850', { name: 'Václav Kubát, sedlák z Lhotky čp. 12' })] }),
            person('b', 'Josef', 'Hrubeš', { events: [baptism('1852', { name: 'Václav Kubát', note: 'sedlák, Lhotka č. 12' })] }),
            person('c', 'Karel', 'Novotný', { events: [baptism('1853', { name: 'Václav Kubát z Lhotky' })] }),
        );
        const leads = godparentLeads(d);
        expect(leads).toHaveLength(1);
        expect(leads[0].count).toBe(3);
        // The name shown and kept as the finding's subject is the name alone.
        expect(leads[0].name).toBe('Václav Kubát');
        expect(issuesOf(d, 'recurringGodparent')[0].subject).toBe('Václav Kubát');
    });

    it('a lone given name names nobody: two "Anna, his wife" are not one woman', () => {
        const d = tree(
            person('a', 'Jan', 'Lhoták', { events: [baptism('1850', { name: 'Anna, jeho manželka' })] }),
            person('b', 'Josef', 'Hrubeš', { events: [baptism('1852', { name: 'Anna, jeho manželka' })] }),
        );
        expect(godparentLeads(d)).toEqual([]);
    });

    it('participantName reads the name out of what the register wrote', () => {
        const read = (s: string) => participantName(s);
        expect(read('Václav Kubát, sedlák z Lhotky čp. 12')).toMatchObject({ name: 'Václav Kubát', key: 'vaclav kubat' });
        expect(read('Václav Kubát z Lhotky čp. 12').name).toBe('Václav Kubát');
        expect(read('Václav Kubát ze Lhotky').name).toBe('Václav Kubát');
        expect(read('Marie Kubátová roz. Lhotáková').name).toBe('Marie Kubátová');
        expect(read('Marie Kubátová, manželka Václava Kubáta').name).toBe('Marie Kubátová');
        expect(read('Václav Kubát[?]').key).toBe('vaclav kubat');
        expect(read('Václav Kubát(?)').key).toBe('vaclav kubat');
        expect(read('Václav Ku[bát]').key).toBe('vaclav kubat');
        expect(read('kmotr Václav Kubát').name).toBe('Václav Kubát');
        expect(read('P. Antonín Kříž, kaplan')).toMatchObject({ name: 'Antonín Kříž', rest: 'kaplan' });
        expect(read('Karl von Berg, Bauer').name).toBe('Karl von Berg');
        expect(read('Anna uxor Josefa Lhotáka').key).toBeNull();
        expect(read('Anna, jeho manželka').key).toBeNull();
        expect(read('václav kubát, sedlák').key).toBe('vaclav kubat');
        // Diacritics and case do not matter.
        expect(read('VACLAV KUBAT').key).toBe(read('Václav Kubát').key);
    });
});

// ==================== K1.3 ====================

describe('possible duplicates with a stand-in birth year (K1.3)', () => {
    it('a baptism stands in for the birth: born 1850 and baptised 1850 is a pair', () => {
        const d = tree(
            person('a', 'Jan', 'Lhoták', { birthDate: '1850-03-02' }),
            person('b', 'Jan', 'Lhoták', { events: [baptism('1850-03-04')] }),
        );
        const dup = issuesOf(d, 'possibleDuplicate');
        expect(dup).toHaveLength(1);
        expect(dup[0].detail).toBe('* 1850 / ~ 1850');
    });

    it('two baptisms twenty years apart are two people, though neither has a birth date', () => {
        const d = tree(
            person('a', 'Jan', 'Lhoták', { events: [baptism('1850')] }),
            person('b', 'Jan', 'Lhoták', { events: [baptism('1870')] }),
        );
        expect(issuesOf(d, 'possibleDuplicate')).toEqual([]);
    });

    it('the death and the age at it stand in when there is no birth or baptism', () => {
        const born = person('a', 'Jan', 'Lhoták', { birthDate: '1820' });
        const near = person('b', 'Jan', 'Lhoták', { deathDate: '1890', deathAge: '70 let' });
        expect(issuesOf(tree(born, near), 'possibleDuplicate')).toHaveLength(1);
        const far = person('c', 'Jan', 'Lhoták', { deathDate: '1890', deathAge: '40 let' });
        expect(issuesOf(tree(born, far), 'possibleDuplicate')).toEqual([]);
        // The burial and its age, when there is no death date.
        const buried: LifeEvent = { id: 'bu', type: 'burial', date: '1891', age: '71' };
        expect(birthYears(person('d', 'Jan', 'Lhoták', { events: [buried] }))).toMatchObject({ min: 1819, max: 1820, from: 'death' });
    });

    it('a dated person and one with no year at all are never paired', () => {
        const d = tree(
            person('a', 'Jan', 'Lhoták', { birthDate: '1850' }),
            person('b', 'Jan', 'Lhoták'),
        );
        expect(issuesOf(d, 'possibleDuplicate')).toEqual([]);
    });

    it('two with no year at all and the same name are still a pair', () => {
        const d = tree(person('a', 'Jan', 'Lhoták'), person('b', 'Jan', 'Lhoták'));
        expect(issuesOf(d, 'possibleDuplicate')).toHaveLength(1);
    });

    it('a parent and the child of the same name are two people', () => {
        const otec = person('f', 'Jan', 'Lhoták', { childIds: ['s'] });
        const syn = person('s', 'Jan', 'Lhoták', { parentIds: ['f'] });
        expect(issuesOf(tree(otec, syn), 'possibleDuplicate')).toEqual([]);
    });

    it('a second child given the name of the one who died is not a duplicate', () => {
        const otec = person('f', 'Josef', 'Lhoták');
        const matka = person('m', 'Anna', 'Lhotáková', { gender: 'female' });
        const prvni = person('c1', 'Jan', 'Lhoták', { deathDate: '1851-02', events: [baptism('1850-11')] });
        const druhy = person('c2', 'Jan', 'Lhoták', { events: [baptism('1852-01')] });
        siblings(otec, matka, prvni, druhy);
        expect(issuesOf(tree(otec, matka, prvni, druhy), 'possibleDuplicate')).toEqual([]);
    });

    it('siblings of the same name and year with no death known stay a pair (one child entered twice)', () => {
        const otec = person('f', 'Josef', 'Lhoták');
        const matka = person('m', 'Anna', 'Lhotáková', { gender: 'female' });
        const a = person('c1', 'Jan', 'Lhoták', { events: [baptism('1850-11')] });
        const b = person('c2', 'Jan', 'Lhoták', { birthDate: '1850-11-02' });
        siblings(otec, matka, a, b);
        expect(issuesOf(tree(otec, matka, a, b), 'possibleDuplicate')).toHaveLength(1);
    });

    it('two births compare by the exact year, as before', () => {
        const d = tree(
            person('a', 'Jan', 'Lhoták', { birthDate: '1850' }),
            person('b', 'Jan', 'Lhoták', { birthDate: '1851' }),
        );
        expect(issuesOf(d, 'possibleDuplicate')).toEqual([]);
    });
});

// ==================== after death ====================

describe('events that come after a death by their nature', () => {
    const at = (type: LifeEvent['type'], date: string): LifeEvent => ({ id: `e_${type}`, type, date });

    it('burial, cremation, probate and the will are not reported; other events are', () => {
        const d = tree(person('a', 'Jan', 'Lhoták', {
            birthDate: '1800', deathDate: '1860',
            events: [at('burial', '1861'), at('cremation', '1861'), at('probate', '1862'), at('will', '1863'), at('residence', '1865')],
        }));
        const after = issuesOf(d, 'eventAfterDeath');
        expect(after).toHaveLength(1);
        expect(after[0].detail).toContain('residence');
        expect([...AFTER_DEATH_EVENT_TYPES].sort()).toEqual(['burial', 'cremation', 'probate', 'will']);
    });

    it('the finding carries the earliest year of the event, the subject the research keys it by', () => {
        const d = tree(person('a', 'Jan', 'Lhoták', {
            birthDate: '1800', deathDate: '1850', events: [at('residence', '1860..1862')],
        }));
        const [issue] = issuesOf(d, 'eventAfterDeath');
        expect(issue.year).toBe(1860);
        expect(qualityFinding(issue)).toEqual({ kind: 'eventAfterDeath', persons: ['a'], subject: '1860' });
    });
});

// ==================== K1.4 grouping ====================

describe('Problems and Traces (K1.4)', () => {
    const issue = (id: string, severity: ValidationIssue['severity'], type: string, personIds: string[] = [], extra: Partial<ValidationIssue> = {}): ValidationIssue =>
        ({ id, severity, type, message: type, personIds: personIds as PersonId[], ...extra });

    it('errors and warnings are problems, the rest traces', () => {
        expect(issueCategory({ severity: 'error' })).toBe('problem');
        expect(issueCategory({ severity: 'warning' })).toBe('problem');
        expect(issueCategory({ severity: 'info' })).toBe('trace');
    });

    it('groups by type: error groups first, then warnings, larger first, then by title; traces after', () => {
        const issues = [
            issue('1', 'info', 'possibleDuplicate'),
            issue('2', 'warning', 'eventAfterDeath'),
            issue('3', 'info', 'recurringGodparent'),
            issue('4', 'info', 'recurringGodparent'),
            issue('5', 'error', 'deathBeforeBirth'),
            issue('6', 'warning', 'childMarriage'),
            issue('7', 'warning', 'childMarriage'),
            issue('8', 'info', 'placeSpelling'),
        ];
        const sections = groupValidationIssues(issues, t => t);
        expect(sections.map(s => [s.category, s.count])).toEqual([['problem', 4], ['trace', 4]]);
        expect(sections[0].groups.map(g => g.type)).toEqual(['deathBeforeBirth', 'childMarriage', 'eventAfterDeath']);
        expect(sections[1].groups.map(g => g.type)).toEqual(['recurringGodparent', 'placeSpelling', 'possibleDuplicate']);
        expect(sections[0].groups.map(g => g.expanded)).toEqual([true, false, false]);
        expect(sections[1].groups.every(g => !g.expanded && g.category === 'trace')).toBe(true);
        // Findings keep their order inside a group.
        expect(sections[1].groups[0].issues.map(i => i.id)).toEqual(['3', '4']);
    });

    it('a section with nothing in it is left out; a group takes its worst severity', () => {
        const only = groupValidationIssues([issue('1', 'info', 'placeSpelling')], t => t);
        expect(only.map(s => s.category)).toEqual(['trace']);
        const mixed = groupValidationIssues([issue('1', 'warning', 'x'), issue('2', 'error', 'x')], t => t);
        expect(mixed[0].groups[0]).toMatchObject({ severity: 'error', expanded: true });
        expect(groupValidationIssues([])).toEqual([]);
    });

    it('counts errors, warnings and traces for the summary', () => {
        expect(validationCounts([issue('1', 'error', 'a'), issue('2', 'warning', 'b'), issue('3', 'info', 'c'), issue('4', 'info', 'c')]))
            .toEqual({ errors: 1, warnings: 1, traces: 2 });
    });

    it('a finding is named by type, sorted people and subject; a duplicate has no subject', () => {
        const g1 = qualityFinding(issue('1', 'info', 'recurringGodparent', ['b', 'a'], { subject: ' Václav Kubát ' }));
        expect(g1).toEqual({ kind: 'recurringGodparent', persons: ['a', 'b'], subject: 'Václav Kubát' });
        const dup = qualityFinding(issue('2', 'info', 'possibleDuplicate', ['b', 'a'], { detail: '* 1850' }));
        expect(dup).toEqual({ kind: 'possibleDuplicate', persons: ['a', 'b'] });
        expect(qualityFindingKey(dup)).toBe(qualityFindingKey({ kind: 'possibleDuplicate', persons: ['b', 'a'] }));
        // NFD and NFC spellings of one name are one key.
        const nfd = qualityFinding(issue('3', 'info', 'recurringGodparent', ['a', 'b'], { subject: 'Václav Kubát'.normalize('NFD') }));
        expect(qualityFindingKey(nfd)).toBe(qualityFindingKey(g1));
    });
});
