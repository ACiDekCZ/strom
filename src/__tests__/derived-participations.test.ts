/**
 * A person's part at another's event in their own life (spec 085 §5): the
 * derived rows from the index of linked participants, their headings by role
 * and sex, one row for a shared event, the privacy of the living, a row gone
 * once the part is kept as an own record, and the person page's life and
 * summary. Fictional data (the Pšeničný family of Zvonov).
 */

import { describe, it, expect } from 'vitest';
import { derivedParticipations, derivedRoleLabel, derivedRoleWord, hasOwnRecordOf } from '../derived-participations.js';
import { buildSharedEventIndex, MARRIAGE_EVENT_ID } from '../shared-events.js';
import { preparePersonPageData, buildPersonPageBody, PERSON_PAGE_ALL_GROUPS, PersonPageOptions } from '../person-page.js';
import { getStringsForLang } from '../strings.js';
import { StromData, Person, PersonId, PartnershipId, Gender } from '../types.js';

const cs = getStringsForLang('cs');
const en = getStringsForLang('en');
const de = getStringsForLang('de');
const pl = getStringsForLang('pl');

function p(id: string, first: string, last: string, gender: Gender, extra: Partial<Person> = {}): Person {
    return { id: id as PersonId, firstName: first, lastName: last, gender, isPlaceholder: false, parentIds: [], childIds: [], partnerships: [], ...extra } as Person;
}
const pid = (x: string) => x as PersonId;

/**
 * Hostivít Mrákota stood godfather at Bolemír's baptism, witnessed the
 * wedding of Dobrohost and Radmila and their banns; Jaromila Zvonková was
 * godmother and the midwife; both are named on a shared census of Bolemír
 * and Radmila (the informant); Zbyhněv is a godfather recorded by name only.
 */
function tree(): StromData {
    const persons: StromData['persons'] = {};
    const add = (x: Person) => { persons[x.id] = x; };
    add(p('hm', 'Hostivít', 'Mrákota', 'male', { birthDate: '1850', deathDate: '1920' }));
    add(p('jz', 'Jaromila', 'Zvonková', 'female', { birthDate: '1855', deathDate: '1925' }));
    add(p('bp', 'Bolemír', 'Pšeničný', 'male', {
        birthDate: '1890-04-02', deathDate: '1950',
        events: [
            { id: 'bap', type: 'baptism', date: '1890-04-03', place: 'Zvonov', sourceIds: ['s1'], participants: [
                { id: 'g1', role: 'godparent', name: 'Hostivít Mrákota', personId: pid('hm') },
                { id: 'g2', role: 'godparent', personId: pid('jz') },
                { id: 'g3', role: 'other', note: 'Porodní bába', personId: pid('jz') },
                { id: 'g4', role: 'godparent', name: 'Zbyhněv Ořešník' },
            ] },
            { id: 'cen1', type: 'census', date: '1900', place: 'Zvonov', shareId: 'SHZV1', participants: [
                { id: 'i1', role: 'other', note: 'Oznamovatel', personId: pid('hm') },
            ] },
        ],
    }));
    add(p('do', 'Dobrohost', 'Ořešník', 'male', { birthDate: '1865', deathDate: '1930', partnerships: ['u1' as PartnershipId] }));
    add(p('rp', 'Radmila', 'Pšeničná', 'female', {
        birthDate: '1868', deathDate: '1940', partnerships: ['u1' as PartnershipId],
        events: [
            { id: 'cen2', type: 'census', date: '1900', place: 'Zvonov', shareId: 'SHZV1', participants: [
                { id: 'i1', role: 'other', note: 'Oznamovatel', personId: pid('hm') },
            ] },
        ],
    }));
    return {
        persons,
        partnerships: {
            u1: {
                id: 'u1' as PartnershipId, person1Id: pid('do'), person2Id: pid('rp'), status: 'married', childIds: [],
                startDate: '1888-06-10', startPlace: 'Zvonov',
                participants: [{ id: 'w1', role: 'witness', personId: pid('hm') }, { id: 'w2', role: 'officiant', personId: pid('jz') }],
                events: [{ id: 'ban', type: 'banns', date: '1888-05-20', participants: [{ id: 'w3', role: 'witness', personId: pid('hm') }] }],
            },
        },
        sources: { s1: { id: 's1', title: 'Matrika Zvonov' } },
    } as StromData;
}

const rows = (d: StromData, who: string, opts = {}) => derivedParticipations(d, buildSharedEventIndex(d), pid(who), opts);

describe('derived rows', () => {
    it('every linked role makes a row, in the order of the dates; a name alone makes none', () => {
        const d = tree();
        const hm = rows(d, 'hm');
        expect(hm.map(r => [r.role, r.eventType, r.eventId])).toEqual([
            ['witness', 'banns', 'ban'],
            ['witness', 'marriage', MARRIAGE_EVENT_ID],
            ['godparent', 'baptism', 'bap'],
            ['other', 'census', 'cen1'],
        ]);
        expect(hm[1].subjects).toEqual([pid('do'), pid('rp')]);
        expect(hm[2]).toMatchObject({ ownerPersonId: 'bp', date: '1890-04-03', place: 'Zvonov', subjects: ['bp'] });
        // Both roles of Jaromila at the baptism, and the wedding she officiated.
        const jz = rows(d, 'jz');
        expect(jz.map(r => [r.role, r.extra ?? null, r.eventType])).toEqual([
            ['officiant', null, 'marriage'],
            ['godparent', null, 'baptism'],
            ['other', 'midwife', 'baptism'],
        ]);
        expect(rows(d, 'bp')).toEqual([]);
    });

    it('the headings by role and sex', () => {
        const d = tree();
        const label = (who: string, g: Gender, S = cs) => rows(d, who).map(r => derivedRoleLabel(r, g, S));
        expect(label('hm', 'male')).toEqual(['Svědek · ohlášky:', 'Svědek · sňatek:', 'Kmotr · křest:', 'Oznamovatel · sčítání lidu:']);
        expect(label('jz', 'female')).toEqual(['Oddávající · sňatek:', 'Kmotra · křest:', 'Porodní bába · křest:']);
        expect(label('hm', 'male', en)).toEqual(['Witness · banns:', 'Witness · marriage:', 'Godfather · baptism:', 'Informant · census:']);
        expect(label('jz', 'female', de)).toEqual(['Amtsperson · Heirat:', 'Patin · Taufe:', 'Hebamme · Taufe:']);
        // A woman witness, a role with a note of its own.
        expect(derivedRoleLabel({ role: 'witness', eventType: 'marriage', partnershipId: 'u1' as PartnershipId }, 'female', cs)).toBe('Svědkyně · sňatek:');
        expect(derivedRoleLabel({ role: 'other', note: 'kostelník, z Lhoty', eventType: 'baptism' }, 'male', cs)).toBe('kostelník · křest:');
        expect(derivedRoleWord({ role: 'godparent' }, 'female', cs)).toBe('kmotra');
        expect(derivedRoleWord({ role: 'other', extra: 'midwife' }, 'female', cs)).toBe('porodní bába');
    });

    it('a woman informant, officiant, godmother and witness have the feminine form; an unknown sex the first one', () => {
        const informantDeath = { role: 'other' as const, extra: 'informant' as const, eventType: 'death' };
        const informantCustom = { role: 'other' as const, extra: 'informant' as const, eventType: 'custom', customLabel: 'Death record' };
        const officiant = { role: 'officiant' as const, eventType: 'marriage', partnershipId: 'u1' as PartnershipId };
        const officiantBaptism = { role: 'officiant' as const, eventType: 'baptism' };
        const godparent = { role: 'godparent' as const, eventType: 'baptism' };
        const witness = { role: 'witness' as const, eventType: 'marriage', partnershipId: 'u1' as PartnershipId };
        const midwife = { role: 'other' as const, extra: 'midwife' as const, eventType: 'baptism' };
        const all = [informantDeath, informantCustom, officiant, officiantBaptism, godparent, witness, midwife];
        const labels = (g: Gender | undefined, S: typeof cs) => all.map(d => derivedRoleLabel(d, g, S));
        const words = (g: Gender | undefined, S: typeof cs) => all.map(d => derivedRoleWord(d, g, S));
        expect(labels('female', cs)).toEqual(['Oznamovatelka · úmrtí:', 'Oznamovatelka · Death record:', 'Oddávající · sňatek:',
            'Oddávající / křtící · křest:', 'Kmotra · křest:', 'Svědkyně · sňatek:', 'Porodní bába · křest:']);
        expect(labels('male', cs)).toEqual(['Oznamovatel · úmrtí:', 'Oznamovatel · Death record:', 'Oddávající · sňatek:',
            'Oddávající / křtící · křest:', 'Kmotr · křest:', 'Svědek · sňatek:', 'Porodní bába · křest:']);
        expect(labels('female', de)).toEqual(['Anzeigende · Tod:', 'Anzeigende · Death record:', 'Amtsperson · Heirat:',
            'Amtsperson · Taufe:', 'Patin · Taufe:', 'Trauzeugin · Heirat:', 'Hebamme · Taufe:']);
        expect(labels('male', de)).toEqual(['Anzeigender · Tod:', 'Anzeigender · Death record:', 'Amtsperson · Heirat:',
            'Amtsperson · Taufe:', 'Pate · Taufe:', 'Trauzeuge · Heirat:', 'Hebamme · Taufe:']);
        expect(labels('female', pl)).toEqual(['Zgłaszająca · zgon:', 'Zgłaszająca · Death record:', 'Udzielająca ślubu · ślub:',
            'Celebrantka · chrzest:', 'Chrzestna · chrzest:', 'Świadek · ślub:', 'Akuszerka · chrzest:']);
        expect(labels('male', pl)).toEqual(['Zgłaszający · zgon:', 'Zgłaszający · Death record:', 'Udzielający ślubu · ślub:',
            'Celebrans · chrzest:', 'Chrzestny · chrzest:', 'Świadek · ślub:', 'Akuszerka · chrzest:']);
        // English: godfather / godmother; the other role nouns have one form for both.
        expect(labels('female', en)).toEqual(['Informant · death:', 'Informant · Death record:', 'Officiant · marriage:',
            'Officiant · baptism:', 'Godmother · baptism:', 'Witness · marriage:', 'Midwife · baptism:']);
        expect(labels('male', en)).toEqual(['Informant · death:', 'Informant · Death record:', 'Officiant · marriage:',
            'Officiant · baptism:', 'Godfather · baptism:', 'Witness · marriage:', 'Midwife · baptism:']);
        expect(words('female', en)[4]).toBe('godmother');
        expect(derivedRoleLabel({ ...godparent, eventType: 'custom', customLabel: 'Confirmation' }, 'female', en)).toBe('Godmother · Confirmation:');
        // The summary's role word follows the same choice.
        expect(words('female', cs)).toEqual(['oznamovatelka', 'oznamovatelka', 'oddávající / křtící', 'oddávající / křtící', 'kmotra', 'svědkyně', 'porodní bába']);
        expect(words('female', de)).toEqual(['Anzeigende', 'Anzeigende', 'Amtsperson', 'Amtsperson', 'Patin', 'Zeugin', 'Hebamme']);
        expect(words('female', pl)).toEqual(['zgłaszająca', 'zgłaszająca', 'celebrantka', 'celebrantka', 'chrzestna', 'świadek', 'akuszerka']);
        expect(words('male', pl)).toEqual(['zgłaszający', 'zgłaszający', 'celebrans', 'celebrans', 'chrzestny', 'świadek', 'akuszerka']);
        // An unknown sex keeps the first form, in every language; English names a godparent of unknown sex "godparent".
        for (const S of [cs, de, pl]) {
            expect(labels('unknown', S)).toEqual(labels('male', S));
            expect(labels(undefined, S)).toEqual(labels('male', S));
            expect(words('unknown', S)).toEqual(words('male', S));
        }
        const enUnknown = labels('male', en).map((l, i) => i === 4 ? 'Godparent · baptism:' : l);
        expect(labels('unknown', en)).toEqual(enUnknown);
        expect(labels(undefined, en)).toEqual(enUnknown);
        expect(words('unknown', en)[4]).toBe('godparent');
        expect(derivedRoleLabel({ ...godparent, eventType: 'custom', customLabel: 'Confirmation' }, 'unknown', en)).toBe('Godparent · Confirmation:');
    });

    it('a shared event gives one row with all its persons', () => {
        const census = rows(tree(), 'hm').filter(r => r.eventType === 'census');
        expect(census).toHaveLength(1);
        expect([...census[0].subjects].sort()).toEqual(['bp', 'rp']);
    });

    it('no row of a living person\'s event when they are hidden', () => {
        const d = tree();
        const hidden = (x: PersonId) => x === 'bp';
        // The baptism and the census are Bolemír's; the wedding is not.
        expect(rows(d, 'hm', { hidden }).map(r => r.eventType)).toEqual(['banns', 'marriage']);
    });

    it('the row goes once the part is kept as an own record', () => {
        const d = tree();
        d.persons[pid('hm')].events = [{
            id: 'own1', type: 'godparent', date: '1890-04-03', place: 'Zvonov', sourceIds: ['s1'],
            roleAt: { role: 'godparent', personId: pid('bp'), eventType: 'baptism', eventId: 'bap' },
        }];
        expect(hasOwnRecordOf(d.persons[pid('hm')], { ownerPersonId: pid('bp'), eventId: 'bap' })).toBe(true);
        expect(rows(d, 'hm').map(r => r.eventType)).toEqual(['banns', 'marriage', 'census']);
        // A wedding witness's own record of the wedding.
        d.persons[pid('hm')].events!.push({
            id: 'own2', type: 'weddingWitness', roleAt: { role: 'witness', partnershipId: 'u1' as PartnershipId, eventType: 'marriage', eventId: MARRIAGE_EVENT_ID },
        });
        expect(rows(d, 'hm').map(r => r.eventType)).toEqual(['banns', 'census']);
    });
});

describe('the person page', () => {
    const opts = (o: Partial<PersonPageOptions> = {}): PersonPageOptions => ({
        personId: pid('hm'), lang: 'cs', mode: 'app', links: 'app', groups: { ...PERSON_PAGE_ALL_GROUPS },
        privacy: 'full', toggles: { history: true, childEvents: true }, research: true, now: new Date('2026-10-29T12:00:00Z'), ...o,
    });
    const body = (d: StromData, o: Partial<PersonPageOptions> = {}) => buildPersonPageBody(preparePersonPageData(d, opts(o)), opts(o));

    it('the life has the derived rows, opening the event in the app; the summary names every role', () => {
        const html = body(tree());
        expect(html).toMatch(/<button type="button" class="pp-part-open" data-pp-action="derived-event" data-pp-event="bap" data-pp-owner="bp"[^>]*>Kmotr · křest:<\/button>/);
        expect(html).toContain('data-pp-union="u1"');
        expect(html).toContain('pp-row--part');
        expect(html).toContain('<dt>Kmotr a svědek u</dt>');
        expect(html).toContain('· kmotr · křest 1890');
        expect(html).toContain('· svědek · sňatek 1888');
    });

    it('in a file the role is plain text; a living person\'s event is not drawn', () => {
        const d = tree();
        delete d.persons[pid('bp')].deathDate;
        d.persons[pid('bp')].birthDate = '1990-04-02';
        // His events tell his age too.
        for (const ev of d.persons[pid('bp')].events!) ev.date = '1990-04-03';
        const html = body(d, { mode: 'file', links: 'plain', privacy: 'initials' });
        expect(html).not.toContain('data-pp-action="derived-event"');
        expect(html).not.toContain('Bolemír');
        expect(html).toContain('<span class="pp-part-role">Svědek · sňatek:</span>');
    });
});
