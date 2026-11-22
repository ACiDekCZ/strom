/**
 * A person's e-mail is a contact, not a residence (spec 134 K0.10, data v26):
 * the rule for a GEDCOM RESI, and the move of an older tree's e-mails into
 * the people's contact at every load — once, nothing a person wrote changed.
 * Invented data.
 */
import { describe, it, expect } from 'vitest';
import { migrateData } from '../data.js';
import { isContactAddressLabel, isContactResidence, isEmptyResidence, cleanEmails, emailsFromInput, addEmails } from '../person-contact.js';
import type { LifeEvent, Person, PersonId, StromData } from '../types.js';
import { NOTED_TAG } from '../import-origin.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { mergePersonData } from '../merge/executor.js';
import { exportToGedcom } from '../ged-exporter.js';
import { CONTACT_FEATURE, keepContacts, NO_MEDIA_FEATURES, researchMediaOut } from '../research-link.js';

const H = 'p_hromoslav' as PersonId;

function tree(person: Partial<Person>, more: Partial<StromData> = {}): StromData {
    return {
        version: 25,
        persons: { [H]: { id: H, firstName: 'Hromoslav', lastName: 'Ozubec', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...person } },
        partnerships: {},
        ...more,
    } as StromData;
}

const resi = (fields: Partial<LifeEvent>): LifeEvent => ({ id: 'ev1', type: 'residence', ...fields });
const load = (data: StromData): StromData => migrateData(structuredClone(data));
const hrom = (data: StromData): Person => data.persons[H];

describe('the rule: a RESI of a contact alone is no residence', () => {
    it('an e-mail alone, or with an empty address or the label "Email" as its part', () => {
        expect(isContactResidence({ emails: ['hromoslav@example.org'] })).toBe(true);
        expect(isContactResidence({ address: 'Email' })).toBe(true);
        expect(isContactResidence({ address: '  ', emails: ['hromoslav@example.org'] })).toBe(true);
    });

    it('anything of a residence keeps it one', () => {
        const email = { emails: ['hromoslav@example.org'] };
        for (const own of [{ date: '1921' }, { place: 'Křemenná' }, { address: 'čp. 12' }, { note: 'u mlýna' }, { sources: 1 }, { files: 1 },
            { participants: 1 }, { other: true }, { cause: 'x' }, { age: '40' }]) {
            expect(isContactResidence({ ...email, ...own })).toBe(false);
        }
    });

    it('the addresses kept: trimmed, one token each, none twice whatever the case', () => {
        expect(cleanEmails([' hromoslav@example.org ', 'HROMOSLAV@example.org', 'a b@example.org', 7, ''])).toEqual(['hromoslav@example.org']);
        expect(cleanEmails([])).toBeUndefined();
        expect(emailsFromInput('hromoslav@example.org, h.ozubec@example.org;  hromoslav@example.org')).toEqual(['hromoslav@example.org', 'h.ozubec@example.org']);
        const p = { emails: ['hromoslav@example.org'] } as Person;
        expect(addEmails(p, ['Hromoslav@example.org'])).toBe(false);
        expect(addEmails(p, ['h.ozubec@example.org'])).toBe(true);
        expect(p.emails).toEqual(['hromoslav@example.org', 'h.ozubec@example.org']);
    });
});

describe('an older tree: its e-mails move into the contact at every load', () => {
    it('(a) a residence an import made of RESI / EMAIL is the contact, no residence left', () => {
        const data = load(tree({ events: [resi({ note: 'E-mail: hromoslav@example.org', gedcomEmails: ['hromoslav@example.org'] })] }));
        expect(hrom(data).emails).toEqual(['hromoslav@example.org']);
        expect(hrom(data).events).toBeUndefined();
    });

    it('(a) in German too, with two addresses', () => {
        const data = load(tree({ events: [resi({ note: 'E-Mail: hromoslav@example.org\nE-Mail: h.ozubec@example.org', gedcomEmails: ['hromoslav@example.org', 'h.ozubec@example.org'] })] }));
        expect(hrom(data).emails).toEqual(['hromoslav@example.org', 'h.ozubec@example.org']);
        expect(hrom(data).events).toBeUndefined();
    });

    it('(a) a residence with a place and a note of its own stays; only the e-mail line leaves its note', () => {
        const data = load(tree({ events: [resi({ place: 'Křemenná', note: 'u mlýna\nE-mail: hromoslav@example.org', gedcomEmails: ['hromoslav@example.org'] })] }));
        expect(hrom(data).emails).toEqual(['hromoslav@example.org']);
        // Where the file wrote it stays known, for "Back to {prog}".
        expect(hrom(data).events).toEqual([{ id: 'ev1', type: 'residence', place: 'Křemenná', note: 'u mlýna', gedcomEmails: ['hromoslav@example.org'] }]);
    });

    it('(a) a line written over by hand stays in the note', () => {
        const data = load(tree({ events: [resi({ note: 'E-mail: hromoslav@example.cz', gedcomEmails: ['hromoslav@example.org'] })] }));
        expect(hrom(data).emails).toBeUndefined();
        expect(hrom(data).events).toHaveLength(1);
    });

    it('(b) one back from the research (no record of the EMAIL), also with the word of a lead', () => {
        const plain = load(tree({ events: [resi({ note: 'E-mail: hromoslav@example.org' })] }));
        expect(hrom(plain).emails).toEqual(['hromoslav@example.org']);
        expect(hrom(plain).events).toBeUndefined();
        const lead = load(tree({ events: [resi({ note: 'Lead\nE-mail: hromoslav@example.org', status: 'lead' })] }));
        expect(hrom(lead).emails).toEqual(['hromoslav@example.org']);
        expect(hrom(lead).events).toBeUndefined();
    });

    it('(b) a residence with anything else is left as it is', () => {
        for (const ev of [
            resi({ note: 'E-mail: hromoslav@example.org\npsal z Mechové' }),
            resi({ note: 'E-mail: hromoslav@example.org', place: 'Mechová' }),
            resi({ note: 'E-mail: hromoslav@example.org', sourceIds: ['s1'] }),
            resi({ note: 'E-mail: hromoslav@example.org', status: 'proven' }),
        ]) {
            const data = load(tree({ events: [ev] }));
            expect(hrom(data).emails).toBeUndefined();
            expect(hrom(data).events).toEqual([ev]);
        }
    });

    it('a residence confirmed by hand, or with a file, stays', () => {
        const confirmed = load(tree({ events: [resi({ note: 'E-mail: hromoslav@example.org' })], confirmed: { 'event:ev1': { at: '2026-11-01' } } as Person['confirmed'] }));
        expect(hrom(confirmed).events).toHaveLength(1);
        const withFile = load(tree({ events: [resi({ note: 'E-mail: hromoslav@example.org', gedcomEmails: ['hromoslav@example.org'] })] }, {
            media: { m1: { id: 'm1', name: 'dopis.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AA==', sizeBytes: 1, places: [{ personId: H, eventId: 'ev1' }] } },
        }));
        expect(hrom(withFile).emails).toEqual(['hromoslav@example.org']);
        expect(hrom(withFile).events).toEqual([{ id: 'ev1', type: 'residence', gedcomEmails: ['hromoslav@example.org'] }]);
    });

    it('no address twice: one the contact has already, a second load changes nothing', () => {
        const data = load(tree({ emails: ['Hromoslav@example.org'], events: [resi({ note: 'E-mail: hromoslav@example.org', gedcomEmails: ['hromoslav@example.org'] })] }));
        expect(hrom(data).emails).toEqual(['Hromoslav@example.org']);
        expect(hrom(data).events).toBeUndefined();
        expect(load(data)).toEqual(data);
    });

    it('(c) an empty residence is only not shown: it stays in the tree', () => {
        const data = load(tree({ events: [resi({})] }));
        expect(hrom(data).events).toEqual([{ id: 'ev1', type: 'residence' }]);
        expect(isEmptyResidence(hrom(data).events![0])).toBe(true);
        expect(isEmptyResidence(hrom(data).events![0], true)).toBe(false);
        expect(isEmptyResidence(resi({ place: 'Mechová' }))).toBe(false);
        expect(isEmptyResidence({ id: 'e', type: 'occupation' })).toBe(false);
    });

    it('`1 EMAIL` under the person: its line of the note as the import wrote it moves, one written by hand stays', () => {
        const extra = { from: 'I1', lines: [`1 ${NOTED_TAG}`, '2 _TEXT E-mail: libuna@example.org', '2 EMAIL libuna@@example.org'] };
        const data = load(tree({ notes: 'E-mail: libuna@example.org\nVčelařila.', gedcomExtra: [extra] },
            { imports: [{ id: 'I1', at: '2026-11-08', file: 'family.ged', encoding: 'utf-8' }] as StromData['imports'] }));
        expect(hrom(data).emails).toEqual(['libuna@example.org']);
        expect(hrom(data).notes).toBe('Včelařila.');
        expect(hrom(data).gedcomExtra).toEqual([extra]);
        const byHand = load(tree({ notes: 'E-mail: libuna@example.org' }));
        expect(hrom(byHand).emails).toBeUndefined();
        expect(hrom(byHand).notes).toBe('E-mail: libuna@example.org');
    });

    it('a stored contact keeps only valid addresses', () => {
        const data = load(tree({ emails: ['hromoslav@example.org', 'not one', 'hromoslav@example.org'] as string[] }));
        expect(hrom(data).emails).toEqual(['hromoslav@example.org']);
        expect(hrom(load(tree({ emails: 'x' as unknown as string[] }))).emails).toBeUndefined();
    });
});

/** A MyHeritage-shaped file of one person with these lines under the person. */
function myHeritage(lines: string[]): Person {
    const ged = ['0 HEAD', '1 SOUR MYHERITAGE', '2 NAME MyHeritage Family Tree Builder', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Hromoslav /Ozubec/', '1 SEX M', '1 BIRT', '2 DATE 1880', ...lines, '0 TRLR'].join('\n');
    return Object.values(migrateData(convertToStrom(parseGedcom(ged)).data).persons)[0];
}

describe('import: an e-mail of the file is the person\'s contact', () => {
    it('RESI / EMAIL: the contact, no residence, nothing in a note', () => {
        const p = myHeritage(['1 RESI', '2 EMAIL hromoslav@@example.org']);
        expect(p.emails).toEqual(['hromoslav@example.org']);
        expect(p.events?.some(e => e.type === 'residence')).toBeFalsy();
        expect(p.notes).toBeUndefined();
    });

    it('RESI with ADDR / ADR1 "Email" and the EMAIL: the contact; the label alone: nothing at all', () => {
        const both = myHeritage(['1 RESI', '2 ADDR', '3 ADR1 Email', '2 EMAIL hromoslav@@example.org']);
        expect(both.emails).toEqual(['hromoslav@example.org']);
        expect(both.events?.some(e => e.type === 'residence')).toBeFalsy();
        const label = myHeritage(['1 RESI', '2 ADDR', '3 ADR1 Email']);
        expect(label.emails).toBeUndefined();
        expect(label.events?.some(e => e.type === 'residence')).toBeFalsy();
    });

    it('a residence with a place and an e-mail stays a residence; the e-mail is the contact, not its note', () => {
        const p = myHeritage(['1 RESI', '2 PLAC Křemenná', '2 EMAIL hromoslav@@example.org']);
        expect(p.emails).toEqual(['hromoslav@example.org']);
        const resi = p.events!.find(e => e.type === 'residence')!;
        expect(resi.place).toBe('Křemenná');
        expect(resi.note).toBeUndefined();
        expect(resi.gedcomEmails).toEqual(['hromoslav@example.org']);
    });

    it('`1 EMAIL` under the person, and the same address twice: one contact', () => {
        const p = myHeritage(['1 EMAIL hromoslav@@example.org', '1 RESI', '2 EMAIL hromoslav@@example.org']);
        expect(p.emails).toEqual(['hromoslav@example.org']);
        expect(p.notes).toBeUndefined();
    });

    it('an address part "Telefon" / "Phone" is a label, never a house, also under a residence with a place', () => {
        expect(isContactAddressLabel('Telefon')).toBe(true);
        expect(isContactAddressLabel(' TELEFÓN ')).toBe(true);
        expect(isContactAddressLabel('Tel.')).toBe(true);
        expect(isContactAddressLabel('Mechová 7')).toBe(false);
        const p = myHeritage(['1 RESI', '2 PLAC Křemenná', '2 ADDR', '3 ADR1 Phone', '2 EMAIL hromoslav@@example.org']);
        expect(p.events!.find(e => e.type === 'residence')!.address).toBeUndefined();
        expect(myHeritage(['1 RESI', '2 ADDR', '3 ADR1 Phone']).events?.some(e => e.type === 'residence')).toBeFalsy();
    });

    it('a RESI of a date or a source stays a residence', () => {
        expect(myHeritage(['1 RESI', '2 DATE 1921', '2 EMAIL hromoslav@@example.org']).events?.some(e => e.type === 'residence')).toBe(true);
    });
});

describe('merging two people joins their contacts', () => {
    it('each address once; "only empty details" keeps the contact the person has', () => {
        const a = { emails: ['hromoslav@example.org'] } as Person;
        mergePersonData(a, { emails: ['HROMOSLAV@example.org', 'h.ozubec@example.org'] } as Person, []);
        expect(a.emails).toEqual(['hromoslav@example.org', 'h.ozubec@example.org']);
        const b = { emails: ['hromoslav@example.org'] } as Person;
        mergePersonData(b, { emails: ['h.ozubec@example.org'] } as Person, [], undefined, undefined, { notesOnlyWhenEmpty: true });
        expect(b.emails).toEqual(['hromoslav@example.org']);
        const c = {} as Person;
        mergePersonData(c, { emails: ['h.ozubec@example.org'] } as Person, [], undefined, undefined, { notesOnlyWhenEmpty: true });
        expect(c.emails).toEqual(['h.ozubec@example.org']);
    });
});

describe('the research and the contact (person.contact)', () => {
    const withRefn = (emails?: string[]): StromData => tree({ refn: '7', ...(emails ? { emails } : {}) });

    it('a file for the research carries the contact only to one that keeps it', () => {
        const data = load(withRefn(['hromoslav@example.org']));
        const link = { id: 'r-test' };
        const without = exportToGedcom(data, 'Ozubec', { research: link, ...researchMediaOut({ features: ['media.app'] }) }).content;
        expect(without).not.toContain('hromoslav@');
        const unknown = exportToGedcom(data, 'Ozubec', { research: link, ...NO_MEDIA_FEATURES }).content;
        expect(unknown).not.toContain('hromoslav@');
        const keeps = exportToGedcom(data, 'Ozubec', { research: link, ...researchMediaOut({ features: [CONTACT_FEATURE] }) }).content;
        expect(keeps).toContain('1 RESI\n2 EMAIL hromoslav@@example.org\n');
    });

    it('a version of a research without the feature: each person keeps the contact the app had (none included)', () => {
        const previous = load(withRefn(['hromoslav@example.org']));
        const next = load(withRefn());
        expect(hrom(keepContacts(next, previous, ['media.app'])).emails).toEqual(['hromoslav@example.org']);
        expect(hrom(keepContacts(next, previous, null)).emails).toEqual(['hromoslav@example.org']);
        expect(next.persons[H].emails).toBeUndefined();
        // Taken off in the app, brought back by an older research's residence note: stays off.
        const back = load(withRefn(['h.ozubec@example.org']));
        expect(hrom(keepContacts(back, load(withRefn()), null)).emails).toBeUndefined();
        // The same id with no REFN on either side.
        expect(hrom(keepContacts(load(tree({})), load(tree({ emails: ['hromoslav@example.org'] })), null)).emails).toEqual(['hromoslav@example.org']);
    });

    it('a research with the feature decides; nothing to carry returns the version itself', () => {
        const previous = load(withRefn(['hromoslav@example.org']));
        const next = load(withRefn(['h.ozubec@example.org']));
        expect(keepContacts(next, previous, [CONTACT_FEATURE])).toBe(next);
        const same = load(withRefn(['hromoslav@example.org']));
        expect(keepContacts(same, previous, null)).toBe(same);
    });
});
