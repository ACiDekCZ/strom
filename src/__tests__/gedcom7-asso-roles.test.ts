/**
 * GEDCOM 7 godparents and witnesses (B-N4): the role is an enumeration
 * under the ASSO (`3 ROLE GODP`, `WITN`, `CLERGY`, `OFFICIATOR`), another
 * role keeps its word in the note (`OTHER` with its `PHRASE`, `NGHBR`…), and
 * someone with no record of their own is `ASSO @VOID@` with the name in its
 * `PHRASE` (FamilySearch's maximal70 / voidptr style). Read as the roles the
 * app has, a name as a participant recorded by name; written back as 5.5.1
 * (`_WITN` + `RELA`), read again the same. Invented data.
 */
import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { strings } from '../strings.js';
import type { EventParticipant, Person, StromData } from '../types.js';

const GED7 = [
    '0 HEAD', '1 GEDC', '2 VERS 7.0',
    '0 @I1@ INDI', '1 NAME Bořivoj /Křemenáček/', '1 SEX M', '1 FAMC @F1@',
    '1 BAPM', '2 DATE 3 APR 1896', '2 PLAC Horní Bludovec',
    '2 ASSO @I2@', '3 ROLE GODP',
    '2 ASSO @VOID@', '3 PHRASE Vratislavka Ořechovská', '3 ROLE GODP',
    '2 ASSO @VOID@', '3 PHRASE Radhošť Hřebenáč', '3 ROLE WITN',
    '2 ASSO @I3@', '3 ROLE CLERGY',
    '2 ASSO @VOID@', '3 PHRASE Hostivít Jeřabinka', '3 ROLE OFFICIATOR',
    '2 ASSO @VOID@', '3 PHRASE Drahobyl Zvonokrt', '3 ROLE OTHER', '4 PHRASE porodní bába',
    '2 ASSO @I4@', '3 ROLE NGHBR',
    '2 ASSO @VOID@', '3 ROLE GODP',
    '0 @I2@ INDI', '1 NAME Zbyhoň /Pšenkovec/', '1 SEX M',
    '0 @I3@ INDI', '1 NAME Radhošť /Dubolist/', '1 SEX M',
    '0 @I4@ INDI', '1 NAME Drahobyl /Hřebenáč/', '1 SEX M',
    '1 ASSO @VOID@', '2 PHRASE Hostivít Zvonokrt', '2 ROLE FRIEND',
    '0 @I5@ INDI', '1 NAME Hostivít /Křemenáček/', '1 SEX M', '1 FAMS @F1@',
    '0 @I6@ INDI', '1 NAME Vratislavka /Jeřabinka/', '1 SEX F', '1 FAMS @F1@',
    '0 @F1@ FAM', '1 HUSB @I5@', '1 WIFE @I6@', '1 CHIL @I1@',
    '1 MARR', '2 DATE 1894', '2 ASSO @VOID@', '3 PHRASE Zbyhoň Dubolist', '3 ROLE WITN',
    '0 TRLR',
].join('\n');

const load = (text: string): StromData => convertToStrom(parseGedcom(text)).data;
const person = (d: StromData, first: string, last: string): Person =>
    Object.values(d.persons).find(p => p.firstName === first && p.lastName === last)!;
/** Each participant as role, who (the linked person's name or the name written) and note. */
const who = (d: StromData, parts: EventParticipant[] | undefined): string[][] => (parts ?? []).map(p => {
    const linked = p.personId ? d.persons[p.personId] : undefined;
    return [p.role, linked ? `@${linked.firstName} ${linked.lastName}` : p.name ?? '', p.note ?? ''];
});
const baptism = (d: StromData) => person(d, 'Bořivoj', 'Křemenáček').events!.find(e => e.type === 'baptism')!;

describe('GEDCOM 7 ASSO roles and a person with no record (B-N4)', () => {
    it('reads GODP, WITN, CLERGY, OFFICIATOR as roles; another role in the note; @VOID@ with its PHRASE by name', () => {
        const d = load(GED7);
        expect(who(d, baptism(d).participants)).toEqual([
            ['godparent', '@Zbyhoň Pšenkovec', ''],
            ['godparent', 'Vratislavka Ořechovská', ''],
            ['witness', 'Radhošť Hřebenáč', ''],
            ['officiant', '@Radhošť Dubolist', ''],
            ['officiant', 'Hostivít Jeřabinka', ''],
            ['other', 'Drahobyl Zvonokrt', 'porodní bába'],
            ['other', '@Drahobyl Hřebenáč', strings.gedcomNotes.assoRoles.NGHBR],
        ]);
        // The wedding's witness written by name only.
        const union = Object.values(d.partnerships)[0];
        expect(who(d, union.participants)).toEqual([['witness', 'Zbyhoň Dubolist', '']]);
        // A person's association with someone of no record stays as a line of the note.
        expect(person(d, 'Drahobyl', 'Hřebenáč').notes).toBe(
            strings.gedcomNotes.association('Hostivít Zvonokrt', strings.gedcomNotes.assoRoles.FRIEND));
    });

    it('a godparent by name goes out as _WITN with RELA and is read back with the role', () => {
        const d = load(GED7);
        const out = exportToGedcom(d, 'Křemenáček', {}).content;
        expect(out).toContain('2 _WITN Vratislavka Ořechovská\n3 RELA Godparent');
        const again = load(out);
        expect(who(again, baptism(again).participants)).toEqual(who(d, baptism(d).participants));
        expect(who(again, Object.values(again.partnerships)[0].participants)).toEqual([['witness', 'Zbyhoň Dubolist', '']]);
    });

    it('a 5.5.1 RELA is read as before', () => {
        const d = load(GED7.replace('3 ROLE GODP', '3 RELA Kmotr'));
        expect(who(d, baptism(d).participants)[0]).toEqual(['godparent', '@Zbyhoň Pšenkovec', '']);
    });
});
