/**
 * A census as a person's own event (spec 053 K1.1): offered in the person's
 * event list, with age and house behind the quiet link, written to GEDCOM as
 * `1 CENS` under INDI and read back from it without loss — a plain file, the
 * research's file and "Back to {prog}". A census under FAM stays the couple's.
 * Invented data.
 */
import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom, GedcomImportOrigin } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { SELECTABLE_EVENT_TYPES } from '../events.js';
import { offeredDetails } from '../ui/event-details-ui.js';
import { applyLivingPrivacy, CONTENT_PRESETS } from '../privacy.js';
import { migrateData } from '../data.js';
import { strings, setLanguage, Language } from '../strings.js';
import { LifeEvent, Person, StromData } from '../types.js';

const ORIGIN: GedcomImportOrigin = { at: '2026-11-13', file: 'family.ged', encoding: 'utf-8' };

const importGed = (ged: string, origin?: GedcomImportOrigin): StromData =>
    convertToStrom(parseGedcom(ged), origin ? { importOrigin: origin } : {}).data;

const byName = (data: StromData, first: string): Person =>
    Object.values(data.persons).find(p => p.firstName === first)!;

const censuses = (p: Person): LifeEvent[] => (p.events ?? []).filter(e => e.type === 'census');

/** One record's lines, by its xref. */
function record(ged: string, head: string): string[] {
    const lines = ged.split('\n');
    const start = lines.indexOf(head);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = lines.findIndex((l, i) => i > start && l.startsWith('0 '));
    return lines.slice(start, end);
}

/** The lines of the person's census, up to the next level-1 line. */
function censusLines(lines: string[]): string[] {
    const start = lines.findIndex(l => /^1 CENS\b/.test(l));
    expect(start).toBeGreaterThanOrEqual(0);
    const end = lines.findIndex((l, i) => i > start && l.startsWith('1 '));
    return lines.slice(start, end < 0 ? undefined : end);
}

const FILE = `0 HEAD
1 SOUR OTHERPROG
2 NAME Other Genealogy Program
2 VERS 7.2
1 CHAR UTF-8
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Bertolf /Quendrik/
1 SEX M
1 BIRT
2 DATE 1840
1 DEAT
2 DATE 1912
1 CENS
2 DATE 31 DEC 1880
2 PLAC Hollowmere
2 ADDR Mill Lane 12
2 AGE 40y
2 NOTE Head of the household, miller.
2 SOUR @S1@
3 PAGE fol. 23, line 4
1 FAMS @F1@
0 @I2@ INDI
1 NAME Wilmara /Quendrik/
1 SEX F
1 BIRT
2 DATE 1845
1 DEAT
2 DATE 1920
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1866
1 CENS
2 DATE 1890
2 PLAC Hollowmere
0 @S1@ SOUR
1 TITL Census Hollowmere 1880
0 TRLR
`;

describe('the census in the person\'s event list', () => {
    it('is offered, after the residence', () => {
        expect(SELECTABLE_EVENT_TYPES).toContain('census');
        expect(SELECTABLE_EVENT_TYPES.indexOf('census')).toBe(SELECTABLE_EVENT_TYPES.indexOf('residence') + 1);
    });

    it('offers the age and the house behind the quiet link', () => {
        expect(offeredDetails('census')).toEqual(['age', 'address']);
    });

    it('has a name in every language of the app', () => {
        const names: Record<string, string> = {};
        for (const lang of ['en', 'cs', 'de', 'pl'] as Language[]) {
            setLanguage(lang);
            names[lang] = strings.events.types.census;
        }
        setLanguage('en');
        expect(names).toEqual({ en: 'Census', cs: 'Sčítání lidu', de: 'Volkszählung', pl: 'Spis ludności' });
    });
});

describe('a census under INDI in GEDCOM', () => {
    it('is read as the person\'s census with its date, place, house, age, note and citation', () => {
        const data = importGed(FILE);
        const [census] = censuses(byName(data, 'Bertolf'));
        expect(census).toMatchObject({
            date: '1880-12-31', place: 'Hollowmere', address: 'Mill Lane 12', age: '40 years',
            note: 'Head of the household, miller.',
        });
        expect(census.customLabel).toBeUndefined();
        expect(census.sourceIds).toHaveLength(1);
        expect(data.sources?.[census.sourceIds![0]]?.title).toBe('Census Hollowmere 1880');
    });

    it('leaves the couple\'s census the couple\'s', () => {
        const data = importGed(FILE);
        expect(censuses(byName(data, 'Wilmara'))).toEqual([]);
        expect((byName(data, 'Bertolf').events ?? []).filter(e => e.type === 'census')).toHaveLength(1);
        const union = Object.values(data.partnerships)[0];
        expect(union.events?.map(e => e.type)).toEqual(['census']);
    });

    it('goes out as 1 CENS under the person and comes back the same (a plain export)', () => {
        const once = importGed(FILE);
        const ged = exportToGedcom(once).content;
        const lines = censusLines(record(ged, ged.split('\n').find(l => /^0 @I\d+@ INDI$/.test(l))!));
        expect(lines[0]).toBe('1 CENS');
        expect(lines).toContain('2 DATE 31 DEC 1880');
        expect(lines).toContain('2 PLAC Hollowmere');
        expect(lines).toContain('2 ADDR Mill Lane 12');
        expect(lines).toContain('2 AGE 40y');
        expect(lines.some(l => /^2 SOUR @S\d+@$/.test(l))).toBe(true);
        expect(ged).not.toMatch(/^2 TYPE (Census|Sčítání lidu)$/m);
        const twice = importGed(ged);
        const strip = (e: LifeEvent) => ({ ...e, id: '', sourceIds: e.sourceIds?.length });
        expect(censuses(byName(twice, 'Bertolf')).map(strip)).toEqual(censuses(byName(once, 'Bertolf')).map(strip));
        expect(Object.values(twice.partnerships)[0].events?.map(e => e.type)).toEqual(['census']);
    });

    it('goes "Back to {prog}" as the program wrote it', () => {
        const data = migrateData(importGed(FILE, ORIGIN));
        const out = applyLivingPrivacy(data, 'full', 2026, { keepDeceasedSources: true });
        const ged = exportToGedcom(out, 'Quendrik', { content: CONTENT_PRESETS.back, origins: true, backTo: data.imports![0].id }).content;
        const lines = censusLines(record(ged, '0 @I1@ INDI'));
        expect(lines.slice(0, 3)).toEqual(['1 CENS', '2 DATE 31 DEC 1880', '2 PLAC Hollowmere']);
        expect(lines).toEqual(expect.arrayContaining(['2 ADDR Mill Lane 12', '2 AGE 40y']));
        expect(lines).toContain('2 NOTE Head of the household, miller.');
        expect(lines).toContain('3 PAGE fol. 23, line 4');
        expect(record(ged, '0 @F1@ FAM')).toContain('1 CENS');
    });

    it('keeps a value on the tag\'s line and drops a bare Y', () => {
        const ged = FILE.replace('1 CENS\n2 DATE 31 DEC 1880', '1 CENS Listed with the mill\n2 DATE 31 DEC 1880')
            .replace('1 DEAT\n2 DATE 1920', '1 DEAT\n2 DATE 1920\n1 CENS Y\n2 DATE 1900');
        const data = importGed(ged);
        expect(censuses(byName(data, 'Bertolf'))[0].note).toBe('Listed with the mill\nHead of the household, miller.');
        expect(censuses(byName(data, 'Wilmara'))).toMatchObject([{ date: '1900' }]);
        expect(censuses(byName(data, 'Wilmara'))[0].note).toBeUndefined();
    });

    it('is read from the research\'s file with its status', () => {
        const research = `0 HEAD
1 SOUR STROM_RESEARCH
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Bertolf /Quendrik/
1 SEX M
1 CENS
2 DATE 1880
2 PLAC Hollowmere
2 _STROM_STATUS probable
0 TRLR
`;
        const data = importGed(research);
        expect(censuses(byName(data, 'Bertolf'))).toMatchObject([{ date: '1880', place: 'Hollowmere', status: 'probable' }]);
        const back = exportToGedcom(data).content;
        expect(censusLines(back.split('\n'))).toEqual(expect.arrayContaining(['1 CENS', '2 DATE 1880', '2 PLAC Hollowmere', '2 _STROM_STATUS probable']));
    });
});

describe('the privacy of the living', () => {
    it('drops a living person\'s census like their other events', () => {
        const data: StromData = {
            version: 11,
            persons: {
                a: {
                    id: 'a', firstName: 'Ferrin', lastName: 'Quendrik', gender: 'male', birthDate: '1990', isPlaceholder: false,
                    events: [{ id: 'e1', type: 'census', date: '2021', place: 'Hollowmere', address: 'Mill Lane 12' }],
                    partnerships: [], parentIds: [], childIds: [],
                },
                d: {
                    id: 'd', firstName: 'Bertolf', lastName: 'Quendrik', gender: 'male', birthDate: '1840', deathDate: '1912', isPlaceholder: false,
                    events: [{ id: 'e2', type: 'census', date: '1880', place: 'Hollowmere' }],
                    partnerships: [], parentIds: [], childIds: [],
                },
            },
            partnerships: {},
        } as unknown as StromData;
        const out = applyLivingPrivacy(data, 'initials', 2026);
        expect(out.persons['a' as never].events).toBeUndefined();
        expect(out.persons['d' as never].events?.map(e => e.type)).toEqual(['census']);
        const ged = exportToGedcom(out).content;
        expect((ged.match(/^1 CENS$/gm) ?? []).length).toBe(1);
    });
});
