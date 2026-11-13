/**
 * A shared event in the life of each of its persons (spec 085 §2): the
 * "with …" line under an event (1, 3 and 4+ other persons, the same given
 * name twice, the ages, privacy in every mode, nobody left), the family
 * book's "Family together" events (all on the page or not). Invented data.
 */
import { describe, it, expect } from 'vitest';
import {
    familyTogetherEvents, sharedIndexOf, sharedNames, sharedWithLine, sharedWithLineHtml, SHARED_LINE_MAX,
} from '../shared-with-line.js';
import { buildSharedEventIndex } from '../shared-events.js';
import { applyLivingPrivacy, PrivacyMode } from '../privacy.js';
import { LifeEvent, Person, PersonId, StromData, STROM_DATA_VERSION, toPersonId } from '../types.js';

const SHARE = 'sh_census1921';

function person(id: string, firstName: string, lastName: string, birthDate: string, ev?: Partial<LifeEvent>): Person {
    return {
        id: toPersonId(id), firstName, lastName, gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
        birthDate, deathDate: Number(birthDate) < 1950 ? '1990' : undefined,
        events: ev ? [{ id: `ev_${id}`, type: 'census', date: '1921-02-15', place: 'Dolní Smyšlenice', address: 'č. 14', shareId: SHARE, ...ev }] : [],
    };
}

/** A household at the census of 1921: `members` with their ages, the first one is the viewer. */
function household(members: [string, string, string, string][]): StromData {
    const persons: Record<string, Person> = {};
    for (const [id, given, birth, age] of members) persons[id] = person(id, given, 'Hurdálek', birth, { age });
    return { version: STROM_DATA_VERSION, persons: persons as StromData['persons'], partnerships: {} };
}

const KVIDO: [string, string, string, string] = ['p_kvido', 'Kvido', '1879', '42'];
const RADEGUNDA: [string, string, string, string] = ['p_radegunda', 'Radegunda', '1883', '38'];
const BOHUCHVAL: [string, string, string, string] = ['p_bohuchval', 'Bohuchval', '1906', '15'];
const ZBYHNEV: [string, string, string, string] = ['p_zbyhnev', 'Zbyhněv', '1910', '11'];
const VLASTIMIR: [string, string, string, string] = ['p_vlastimir', 'Vlastimír', '1914', '7'];

function lineOf(data: StromData, viewer: string, opts: { fullNames?: boolean; hidden?: (id: PersonId) => boolean } = {}) {
    const ev = data.persons[toPersonId(viewer)].events![0];
    return sharedWithLine(ev, toPersonId(viewer), { data, index: buildSharedEventIndex(data), ...opts });
}

describe('sharedWithLine', () => {
    it('names the one other person with the age in their copy', () => {
        const line = lineOf(household([KVIDO, RADEGUNDA]), 'p_kvido')!;
        expect(line.names).toEqual([{ personId: 'p_radegunda', text: 'Radegunda', full: 'Radegunda Hurdálek', age: '38' }]);
        expect(line.more).toBe(0);
        expect(line.ownAge).toBe('42');
        expect(line.shareId).toBe(SHARE);
    });

    it('names all of three other persons by their given names', () => {
        const line = lineOf(household([KVIDO, RADEGUNDA, BOHUCHVAL, ZBYHNEV]), 'p_kvido')!;
        expect(SHARED_LINE_MAX).toBe(3);
        expect(line.names.map(n => n.text)).toEqual(['Radegunda', 'Bohuchval', 'Zbyhněv']);
        expect(line.names.map(n => n.age)).toEqual(['38', '15', '11']);
        expect(line.more).toBe(0);
    });

    it('names the first two of four and more, counting the rest', () => {
        const line = lineOf(household([KVIDO, RADEGUNDA, BOHUCHVAL, ZBYHNEV, VLASTIMIR]), 'p_kvido')!;
        expect(line.names.map(n => n.text)).toEqual(['Radegunda', 'Bohuchval']);
        expect(line.more).toBe(2);
        const html = sharedWithLineHtml(line, {
            lead: 'with', more: n => `and ${n} more`, esc: t => t, nameHtml: n => `<b>${n.text}</b>`,
        });
        expect(html).toContain('with <b>Radegunda</b>, <b>Bohuchval</b> <span class="shared-line-more">and 2 more</span>');
        expect(html).toContain('shared-line-mark');
        expect(sharedWithLineHtml(line, { lead: 'with', more: () => '', esc: t => t, nameHtml: n => n.text, mark: false }))
            .not.toContain('shared-line-mark');
    });

    it('writes the whole names of persons with the same given name, and of all in print', () => {
        const data = household([KVIDO, RADEGUNDA, ['p_kvido2', 'Kvido', '1908', '13']]);
        data.persons[toPersonId('p_kvido2')].lastName = 'Mlčoch';
        const line = lineOf(data, 'p_radegunda')!;
        expect(line.names.map(n => n.text)).toEqual(['Kvido Hurdálek', 'Kvido Mlčoch']);
        expect(lineOf(household([KVIDO, RADEGUNDA]), 'p_kvido', { fullNames: true })!.names[0].text).toBe('Radegunda Hurdálek');
        expect(sharedNames(data, [toPersonId('p_kvido'), toPersonId('p_radegunda')]).map(n => n.text)).toEqual(['Kvido', 'Radegunda']);
    });

    it('is null for an event of one person and when nobody is left to name', () => {
        const data = household([KVIDO, RADEGUNDA]);
        const alone = { ...data.persons[toPersonId('p_kvido')].events![0], shareId: undefined };
        expect(sharedWithLine(alone, toPersonId('p_kvido'), { data, index: buildSharedEventIndex(data) })).toBeNull();
        expect(lineOf(data, 'p_kvido', { hidden: id => id === 'p_radegunda' })).toBeNull();
    });

    describe('privacy (§2i): a living person is never named', () => {
        // Bořivoj, born 1990, is alive: a test of the filter only.
        const data = household([KVIDO, RADEGUNDA, ['p_living', 'Bořivoj', '1990', '1']]);
        const modes: PrivacyMode[] = ['initials', 'anonymous', 'minimal'];
        for (const mode of modes) {
            it(`${mode}: the living person is left out of the line, not replaced`, () => {
                const prot = applyLivingPrivacy(data, mode, 2026);
                const ev = prot.persons[toPersonId('p_kvido')].events![0];
                const line = sharedWithLine(ev, toPersonId('p_kvido'), { data: prot, index: sharedIndexOf(prot) })!;
                expect(line.names.map(n => n.personId)).toEqual(['p_radegunda']);
                expect(line.more).toBe(0);
            });
        }
        it('full: everybody is named', () => {
            const prot = applyLivingPrivacy(data, 'full', 2026);
            const ev = prot.persons[toPersonId('p_kvido')].events![0];
            const line = sharedWithLine(ev, toPersonId('p_kvido'), { data: prot, index: sharedIndexOf(prot) })!;
            expect(line.names.map(n => n.text)).toEqual(['Radegunda', 'Bořivoj']);
        });
        it('only living others: no line at all', () => {
            const two = household([KVIDO, ['p_living', 'Bořivoj', '1990', '1']]);
            const prot = applyLivingPrivacy(two, 'initials', 2026);
            const ev = prot.persons[toPersonId('p_kvido')].events![0];
            expect(sharedWithLine(ev, toPersonId('p_kvido'), { data: prot, index: sharedIndexOf(prot) })).toBeNull();
        });
    });

    it('keeps the index of a frozen tree with it', () => {
        const data = household([KVIDO, RADEGUNDA]);
        expect(sharedIndexOf(data)).toBe(sharedIndexOf(data));
    });
});

describe('familyTogetherEvents (§2h)', () => {
    const data = household([KVIDO, RADEGUNDA, BOHUCHVAL, ZBYHNEV]);
    const ids = (...xs: string[]) => xs.map(toPersonId);

    it('lists an event whose persons are all on the page, once, with everybody and their ages', () => {
        const out = familyTogetherEvents(data, sharedIndexOf(data), ids('p_kvido', 'p_radegunda', 'p_bohuchval', 'p_zbyhnev'));
        expect(out).toHaveLength(1);
        expect(out[0].shareId).toBe(SHARE);
        expect(out[0].event.date).toBe('1921-02-15');
        expect(out[0].persons.map(p => `${p.text} ${p.age}`)).toEqual(['Kvido 42', 'Radegunda 38', 'Bohuchval 15', 'Zbyhněv 11']);
    });

    it('leaves out an event with a person who is not on the page', () => {
        expect(familyTogetherEvents(data, sharedIndexOf(data), ids('p_kvido', 'p_radegunda', 'p_bohuchval'))).toEqual([]);
    });

    it('counts only the persons the reader may see', () => {
        const out = familyTogetherEvents(data, sharedIndexOf(data), ids('p_kvido', 'p_radegunda', 'p_bohuchval'),
            { hidden: id => id === 'p_zbyhnev' });
        expect(out[0].persons.map(p => p.personId)).toEqual(['p_kvido', 'p_radegunda', 'p_bohuchval']);
    });
});
