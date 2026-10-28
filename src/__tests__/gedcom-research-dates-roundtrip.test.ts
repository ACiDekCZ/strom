/**
 * The research's file → the app → the file sent back: a date or an age the
 * user did not touch goes back exactly as it came. The research compares the
 * values as written; any other form of the same date ("BET … AND …" for a
 * "FROM … TO …", ABT for CAL, "2m 26d" for "0y 2m 26d") reads to it as the
 * user's edit and turns into a conflict, a new lead or a "removed" fact.
 *
 * The family (Lhoták of Čapkov) and its places are invented.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { StromData, Person } from '../types.js';
import { formatFlexDate, parseFlexDate, normalizeDateInput, displayYear, dateSortKey, ageReached } from '../dates.js';
import { applyLivingPrivacy } from '../privacy.js';

const GED = `0 HEAD
1 CHAR UTF-8
0 @S0001@ SOUR
1 TITL Matrika Čapkov 1860–1890
1 REFN S0001
0 @I1@ INDI
1 NAME Matěj /Lhoták/
1 SEX M
1 REFN P0001
1 BIRT
2 DATE CAL 1838
2 PLAC Čapkov
1 OCCU chalupník
2 DATE FROM 1862 TO 1880
2 PLAC Čapkov
1 RESI
2 DATE FROM 22 MAR 1871 TO 22 MAR 1882
2 PLAC Čapkov
2 ADDR čp. 14
1 RESI
2 DATE FROM APR 1882
2 PLAC Horní Lhotka
2 ADDR čp. 3
1 RESI
2 DATE TO 1861
2 PLAC Dolní Bříza
1 DEAT
2 DATE BET 1890 AND 1892
2 PLAC Horní Lhotka
2 AGE 53y
1 FAMS @F0001@
0 @I2@ INDI
1 NAME Barbora /Lhotáková/
1 SEX F
1 REFN P0002
1 BIRT
2 DATE EST 1842
1 DEAT
2 DATE AFT 1895
1 FAMS @F0001@
0 @I3@ INDI
1 NAME Josef /Lhoták/
1 SEX M
1 REFN P0003
1 BIRT
2 DATE 3 JAN 1872
2 PLAC Čapkov
2 ADDR čp. 14
1 DEAT
2 DATE 29 MAR 1872
2 PLAC Čapkov
2 AGE 0y 2m 26d
1 FAMC @F0001@
0 @I4@ INDI
1 NAME Anna /Lhotáková/
1 SEX F
1 REFN P0004
1 BIRT
2 DATE ABT 1866
1 BAPM
2 DATE BEF 1867
1 DEAT
2 DATE 1699/00
2 AGE 1y 0m 5d
1 FAMC @F0001@
0 @F0001@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 CHIL @I4@
1 MARR
2 DATE EST 1864
2 PLAC Čapkov
2 HUSB
3 AGE 26y
2 WIFE
3 AGE 22y 0m
0 TRLR
`;

const RESEARCH = { id: '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10' };

function load(ged: string): StromData {
    const parsed = parseGedcom(ged);
    return convertToStrom(parsed).data;
}

function send(data: StromData): string {
    return exportToGedcom(data, 'Lhotákovi', { research: RESEARCH }).content;
}

/** Each record's DATE, AGE and ADDR lines, with the fact they are under: "P0001 RESI DATE FROM 1862 TO 1880". */
function factLines(ged: string): string[] {
    const out: string[] = [];
    for (const rec of ged.split(/\r?\n(?=0 )/)) {
        const lines = rec.split(/\r?\n/).map(l => /^(\d) (\S+)(?: (.*))?$/.exec(l.trim())).filter(m => !!m);
        if (!/^@[IF]/.test(lines[0]?.[2] ?? '')) continue;
        const key = lines[0]![3] === 'FAM' ? 'FAM' : lines.find(m => m[1] === '1' && m[2] === 'REFN')?.[3] ?? '?';
        let fact = '';
        let sub = '';
        for (const [, level, tag, value = ''] of lines) {
            if (level === '1') { fact = tag; continue; }
            if (level === '2') sub = tag;
            if (['DATE', 'AGE', 'ADDR'].includes(tag) && (level === '2' || (level === '3' && tag === 'AGE'))) {
                out.push(`${key} ${fact}${level === '3' ? ` ${sub}` : ''} ${tag} ${value}`);
            }
        }
    }
    return out.sort();
}

const byRefn = (data: StromData, refn: string): Person =>
    Object.values(data.persons).find(p => p.refn === refn)!;

describe('the research\'s dates and ages go back unchanged', () => {
    it('a file read and sent back gives every DATE, AGE and ADDR as it came', () => {
        expect(factLines(send(load(GED)))).toEqual(factLines(GED));
    });

    it('a second round gives the same file', () => {
        const once = send(load(GED));
        expect(factLines(send(load(once)))).toEqual(factLines(GED));
    });

    it('keeps a period apart from a range, both sides and one side', () => {
        const data = load(GED);
        const matej = byRefn(data, 'P0001');
        const resi = (matej.events ?? []).filter(e => e.type === 'residence').map(e => e.date);
        expect(resi).toEqual(expect.arrayContaining(['1871-03-22/1882-03-22', '1882-04/', '/1861']));
        expect(matej.deathDate).toBe('1890..1892');
    });

    it('a date the user changed goes out in the app\'s form', () => {
        const data = load(GED);
        const barbora = byRefn(data, 'P0002');
        expect(barbora.birthDate).toBe('~1842');
        expect(send(data)).toContain('2 DATE EST 1842');
        barbora.birthDate = '~1843';
        const ged = send(data);
        expect(ged).toContain('2 DATE ABT 1843');
        expect(ged).not.toContain('EST 1842');
    });

    it('a value written in two forms in one record keeps neither', () => {
        const ged = GED.replace('1 BAPM\n2 DATE BEF 1867', '1 BAPM\n2 DATE CAL 1866');
        const anna = byRefn(load(ged), 'P0004');
        // ABT 1866 (birth) and CAL 1866 (baptism) are both '~1866': no single form to give back.
        expect(anna.gedcomDates?.['~1866']).toBeUndefined();
    });

    it('a living person under privacy keeps no date through gedcomDates', () => {
        const ged = GED.replace('0 TRLR', '0 @I5@ INDI\n1 NAME Eva /Lhotáková/\n1 SEX F\n1 REFN P0005\n1 BIRT\n2 DATE EST 1990\n0 TRLR');
        const data = load(ged);
        const eva = byRefn(data, 'P0005');
        expect(eva.gedcomDates).toEqual({ '~1990': 'EST 1990' });
        const shared = applyLivingPrivacy(data, 'anonymous');
        expect(shared.persons[eva.id]).toBeDefined();
        expect(shared.persons[eva.id].gedcomDates).toBeUndefined();
        expect(send(shared)).not.toContain('1990');
    });
});

describe('periods in the app', () => {
    it('reads, writes and shows a period as from–to in cs, en, de', () => {
        const v = '1871-03-22/1882-03-22';
        expect(parseFlexDate(v)).toMatchObject({ year: 1871, end: { year: 1882 }, period: true });
        expect(formatFlexDate(v, 'cs')).toBe('od 22. 3. 1871 do 22. 3. 1882');
        expect(formatFlexDate(v, 'en')).toBe('from 22 Mar 1871 to 22 Mar 1882');
        expect(formatFlexDate(v, 'de')).toBe('von 22.3.1871 bis 22.3.1882');
        expect(formatFlexDate('1882-04/', 'cs')).toBe('od 4/1882');
        expect(formatFlexDate('/1861', 'de')).toBe('bis 1861');
        expect(formatFlexDate('/1861', 'en')).toBe('to 1861');
        expect(formatFlexDate('1882/', 'de')).toBe('ab 1882');
        expect(formatFlexDate('1890..1892', 'cs')).toBe('mezi 1890 a 1892');
    });

    it('the edit field gives a period back unchanged; words make one too', () => {
        for (const v of ['1871-03-22/1882-03-22', '1882-04/', '/1861']) expect(normalizeDateInput(v, 'cs')).toBe(v);
        expect(normalizeDateInput('od 22.3.1871 do 22.3.1882', 'cs')).toBe('1871-03-22/1882-03-22');
        expect(normalizeDateInput('from 1871 to 1882', 'en')).toBe('1871/1882');
        expect(normalizeDateInput('von 1871 bis 1882', 'de')).toBe('1871/1882');
        // A slash date is still a month and a year; a period side must be a whole canonical date.
        expect(normalizeDateInput('5/1880', 'cs')).toBe('1880-05');
        expect(normalizeDateInput('1871/1882..1890', 'cs')).toBeNull();
        expect(parseFlexDate('1871/1882/1890')).toBeNull();
        expect(parseFlexDate('/')).toBeNull();
    });

    it('years, order and ages read a period like the range and bounds before', () => {
        expect(displayYear('1871/1882')).toBe('1871–1882');
        expect(displayYear('1871/')).toBe('>1871');
        expect(displayYear('/1861')).toBe('<1861');
        expect(dateSortKey('/1861')).toBe('1861');
        expect(dateSortKey('1871/1882')).toBe('1871/1882');
        expect(ageReached('1838', '1871/1882')).toEqual({ kind: 'span', years: 32, max: 44 });
    });
});
