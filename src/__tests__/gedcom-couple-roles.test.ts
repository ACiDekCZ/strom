/**
 * A family's partners as other programs write them (U01): two WIFE or two
 * HUSB (a couple of one sex), and HUSB / WIFE pointing at persons of unknown
 * sex (SEX U or none). Both partners stay a couple with their children and
 * keep the sex the file gives (never one guessed from the role); their sides
 * follow the app's couple rule (coupleSides). Invented data.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { coupleSides, StromData, Person } from '../types.js';

function ged(indis: [string, string, string | null][], fam: string[]): string {
    return [
        '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        ...indis.flatMap(([id, name, sex]) => [`0 @${id}@ INDI`, `1 NAME ${name}`, ...(sex ? [`1 SEX ${sex}`] : [])]),
        '0 @F1@ FAM', ...fam,
        '0 TRLR',
    ].join('\n');
}

const load = (text: string): StromData => convertToStrom(parseGedcom(text)).data;
const byName = (data: StromData, first: string): Person => Object.values(data.persons).find(p => p.firstName === first)!;

/** The one couple: its partners (person1, person2 by name), their sexes, the children's names and parents. */
function couple(data: StromData) {
    const unions = Object.values(data.partnerships);
    expect(unions).toHaveLength(1);
    const u = unions[0];
    const p1 = data.persons[u.person1Id], p2 = data.persons[u.person2Id];
    const children = u.childIds.map(id => data.persons[id]);
    return {
        partners: [p1.firstName, p2.firstName], sexes: [p1.gender, p2.gender],
        children: children.map(c => c.firstName).sort(),
        parentsOfChildren: children.map(c => c.parentIds.map(id => data.persons[id].firstName).sort()),
        sides: coupleSides(p1, p2).map(p => p.firstName),
        persons: Object.values(data.persons).filter(p => !p.isPlaceholder).length,
    };
}

describe('a family with two WIFE or two HUSB (U01)', () => {
    it('two WIFE: both women stay a couple with both children', () => {
        const data = load(ged([['I1', 'Eva /Malá/', 'F'], ['I2', 'Jana /Velká/', 'F'], ['C1', 'Petr /Malý/', 'M'], ['C2', 'Lucie /Malá/', 'F']],
            ['1 WIFE @I1@', '1 WIFE @I2@', '1 CHIL @C1@', '1 CHIL @C2@', '1 MARR', '2 DATE 2015']));
        const c = couple(data);
        expect(c.partners).toEqual(['Eva', 'Jana']);
        expect(c.sexes).toEqual(['female', 'female']);
        expect(c.children).toEqual(['Lucie', 'Petr']);
        expect(c.parentsOfChildren).toEqual([['Eva', 'Jana'], ['Eva', 'Jana']]);
        expect(c.persons).toBe(4);
        expect(Object.values(data.partnerships)[0].startDate).toBe('2015');
        expect(byName(data, 'Eva').partnerships).toHaveLength(1);
        expect(byName(data, 'Jana').partnerships).toHaveLength(1);
    });

    it('two HUSB: both men stay a couple with the child', () => {
        const data = load(ged([['I1', 'Karel /Vlk/', 'M'], ['I2', 'Josef /Kos/', 'M'], ['C1', 'Ota /Vlk/', 'M']],
            ['1 HUSB @I1@', '1 HUSB @I2@', '1 CHIL @C1@']));
        const c = couple(data);
        expect(c.partners).toEqual(['Karel', 'Josef']);
        expect(c.sexes).toEqual(['male', 'male']);
        expect(c.children).toEqual(['Ota']);
        expect(c.parentsOfChildren).toEqual([['Josef', 'Karel']]);
        expect(c.persons).toBe(3);
    });

    it('the same person twice (HUSB and HUSB of one id) is one partner, no couple with itself', () => {
        const data = load(ged([['I1', 'Karel /Vlk/', 'M'], ['C1', 'Ota /Vlk/', 'M']], ['1 HUSB @I1@', '1 HUSB @I1@', '1 CHIL @C1@']));
        const ota = byName(data, 'Ota');
        expect(ota.parentIds.map(id => data.persons[id].firstName).filter(n => n !== '?')).toEqual(['Karel']);
        for (const u of Object.values(data.partnerships)) expect(u.person1Id).not.toBe(u.person2Id);
    });

    it('a third partner line is left out and counted, the first two stay', () => {
        const text = ged([['I1', 'Eva /Malá/', 'F'], ['I2', 'Jana /Velká/', 'F'], ['I3', 'Iva /Nová/', 'F'], ['C1', 'Petr /Malý/', 'M']],
            ['1 WIFE @I1@', '1 WIFE @I2@', '1 WIFE @I3@', '1 CHIL @C1@']);
        expect(parseGedcom(text).droppedTags.get('WIFE')).toBe(1);
        expect(couple(load(text)).partners).toEqual(['Eva', 'Jana']);
    });

    it('two WIFE written back: one HUSB and one WIFE line (two of one sex keep their order), read again the same', () => {
        const data = load(ged([['I1', 'Eva /Malá/', 'F'], ['I2', 'Jana /Velká/', 'F'], ['C1', 'Petr /Malý/', 'M']],
            ['1 WIFE @I1@', '1 WIFE @I2@', '1 CHIL @C1@']));
        const again = load(exportToGedcom(data).content);
        expect(couple(again)).toEqual(couple(data));
    });
});

describe('HUSB / WIFE of unknown sex (U01)', () => {
    it('SEX U in both roles: both unknown (no sex from the role), a couple with the child, in the file\'s order', () => {
        const data = load(ged([['I1', 'Alex /Novák/', 'U'], ['I2', 'Kim /Nováková/', 'U'], ['C1', 'Jiří /Novák/', 'M']],
            ['1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @C1@']));
        const c = couple(data);
        expect(c.sexes).toEqual(['unknown', 'unknown']);
        expect(c.sides).toEqual(['Alex', 'Kim']);
        expect(c.children).toEqual(['Jiří']);
        expect(c.parentsOfChildren).toEqual([['Alex', 'Kim']]);
    });

    it('no SEX at all: unknown, kept as a couple with the child', () => {
        const data = load(ged([['I1', 'Alex /Novák/', null], ['I2', 'Kim /Nováková/', null], ['C1', 'Jiří /Novák/', null]],
            ['1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @C1@']));
        const c = couple(data);
        expect(c.sexes).toEqual(['unknown', 'unknown']);
        expect(c.children).toEqual(['Jiří']);
        expect(byName(data, 'Jiří').gender).toBe('unknown');
    });

    it('a WIFE of unknown sex beside a woman as HUSB: the woman on the right, the unknown on the free left side', () => {
        const data = load(ged([['I1', 'Eva /Malá/', 'F'], ['I2', 'Kim /Malá/', 'U'], ['C1', 'Petr /Malý/', 'M']],
            ['1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @C1@']));
        const c = couple(data);
        expect(c.sexes.sort()).toEqual(['female', 'unknown']);
        expect(c.sides).toEqual(['Kim', 'Eva']);
        expect(c.parentsOfChildren).toEqual([['Eva', 'Kim']]);
    });

    it('a HUSB of unknown sex beside a man as WIFE: the man on the left', () => {
        const data = load(ged([['I1', 'Kim /Vlk/', 'U'], ['I2', 'Karel /Vlk/', 'M'], ['C1', 'Ota /Vlk/', 'M']],
            ['1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @C1@']));
        const c = couple(data);
        expect(c.sides).toEqual(['Karel', 'Kim']);
        expect(c.parentsOfChildren).toEqual([['Karel', 'Kim']]);
    });

    it('two WIFE of unknown sex: both kept, both unknown', () => {
        const data = load(ged([['I1', 'Alex /Malá/', 'U'], ['I2', 'Kim /Malá/', 'U'], ['C1', 'Petr /Malý/', 'M']],
            ['1 WIFE @I1@', '1 WIFE @I2@', '1 CHIL @C1@']));
        const c = couple(data);
        expect(c.partners).toEqual(['Alex', 'Kim']);
        expect(c.sexes).toEqual(['unknown', 'unknown']);
        expect(c.parentsOfChildren).toEqual([['Alex', 'Kim']]);
    });
});
