/**
 * GEDCOM round-trip tests.
 *
 * import -> export -> import must return identical data (IDs normalized), and
 * export -> import -> export must return identical GEDCOM (volatile header
 * lines stripped). Fixtures are inline strings — no real family data.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { validateTreeData } from '../validation.js';
import { StromData, PersonId, PartnershipId } from '../types.js';

function importGed(ged: string): StromData {
    return convertToStrom(parseGedcom(ged)).data;
}

function exportGed(data: StromData): string {
    return exportToGedcom(data).content;
}

/**
 * Re-key persons and partnerships to positional IDs (P0, P1, U0, …) so two
 * imports of the same tree compare equal despite random generated IDs. Relies
 * on the parser/exporter preserving record order across the round-trip.
 */
function normalize(data: StromData): StromData {
    const pIds = Object.keys(data.persons) as PersonId[];
    const uIds = Object.keys(data.partnerships) as PartnershipId[];
    const sIds = Object.keys(data.sources ?? {});
    const p = new Map(pIds.map((id, i) => [id, `P${i}` as PersonId]));
    const u = new Map(uIds.map((id, i) => [id, `U${i}` as PartnershipId]));
    // Source ids are generated fresh on every import — re-key positionally.
    const s = new Map(sIds.map((id, i) => [id, `S${i}`]));
    const mapSrc = (ids?: string[]) => ids?.map(x => s.get(x)!);

    const persons: StromData['persons'] = {};
    for (const id of pIds) {
        const person = data.persons[id];
        persons[p.get(id)!] = {
            ...person,
            id: p.get(id)!,
            partnerships: person.partnerships.map(x => u.get(x)!),
            parentIds: person.parentIds.map(x => p.get(x)!),
            childIds: person.childIds.map(x => p.get(x)!),
            // Event ids are generated fresh on every import — re-key positionally.
            // So are participant ids, and their personId links need the person map.
            ...(person.events ? { events: person.events.map((e, i) => ({
                ...e,
                id: `E${i}`,
                ...(e.sourceIds ? { sourceIds: mapSrc(e.sourceIds) } : {}),
                ...(e.participants ? { participants: e.participants.map((pt, j) => ({
                    ...pt,
                    id: `PT${i}_${j}`,
                    ...(pt.personId ? { personId: p.get(pt.personId)! } : {}),
                })) } : {}),
            })) } : {}),
            ...(person.sourceIds ? { sourceIds: mapSrc(person.sourceIds) } : {}),
            // parentRelTypes is keyed by parent PersonId — re-key the keys too.
            ...(person.parentRelTypes ? {
                parentRelTypes: Object.fromEntries(
                    Object.entries(person.parentRelTypes).map(([pid, t]) => [p.get(pid as PersonId)!, t])
                ),
            } : {}),
        };
    }
    const partnerships: StromData['partnerships'] = {};
    for (const id of uIds) {
        const part = data.partnerships[id];
        partnerships[u.get(id)!] = {
            ...part,
            id: u.get(id)!,
            person1Id: p.get(part.person1Id)!,
            person2Id: p.get(part.person2Id)!,
            childIds: part.childIds.map(x => p.get(x)!),
            ...(part.sourceIds ? { sourceIds: mapSrc(part.sourceIds) } : {}),
            // Witness ids are generated fresh on every import, like event ones.
            ...(part.participants ? { participants: part.participants.map((pt, j) => ({
                ...pt,
                id: `WT${j}`,
                ...(pt.personId ? { personId: p.get(pt.personId)! } : {}),
            })) } : {}),
        };
    }
    const result: StromData = { persons, partnerships };
    if (data.sources) {
        result.sources = {};
        for (const id of sIds) result.sources[s.get(id)!] = { ...data.sources![id], id: s.get(id)! };
    }
    return result;
}

/** Drop lines that legitimately vary (the generated header date). */
function stripVolatile(ged: string): string {
    return ged.split('\n').filter(l => !l.startsWith('1 DATE ')).join('\n');
}

const FIXTURES: Record<string, string> = {
    'full family': [
        '0 HEAD', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Jan /Novak/', '1 SEX M',
        '1 BIRT', '2 DATE 3 JUN 1900', '2 PLAC Praha',
        '1 DEAT', '2 DATE 1970', '2 PLAC Brno',
        '1 NOTE Founder of the family',
        '0 @I2@ INDI', '1 NAME Marie /Novakova/', '1 SEX F', '1 BIRT', '2 DATE 1905',
        '0 @I3@ INDI', '1 NAME Petr /Novak/', '1 SEX M', '1 BIRT', '2 DATE 1930',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@',
        '1 MARR', '2 DATE 1925', '2 PLAC Brno', '1 NOTE Married in a small church',
        '0 TRLR',
    ].join('\n'),

    'single parent': [
        '0 HEAD', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Anna /Svobodova/', '1 SEX F',
        '0 @I2@ INDI', '1 NAME Josef /Svoboda/', '1 SEX M',
        '0 @I3@ INDI', '1 NAME Eva /Svobodova/', '1 SEX F',
        '0 @F1@ FAM', '1 WIFE @I1@', '1 CHIL @I2@', '1 CHIL @I3@',
        '0 TRLR',
    ].join('\n'),

    'divorce': [
        '0 HEAD', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Karel /Dvorak/', '1 SEX M',
        '0 @I2@ INDI', '1 NAME Jana /Dvorakova/', '1 SEX F',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@',
        '1 MARR', '2 DATE 1950', '1 DIV', '2 DATE 1960',
        '0 TRLR',
    ].join('\n'),

    'multiple marriages': [
        '0 HEAD', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Adam /Kral/', '1 SEX M',
        '0 @I2@ INDI', '1 NAME Bela /Kralova/', '1 SEX F',
        '0 @I3@ INDI', '1 NAME Dana /Kralova/', '1 SEX F',
        '0 @I4@ INDI', '1 NAME Cyril /Kral/', '1 SEX M',
        '0 @I5@ INDI', '1 NAME Emil /Kral/', '1 SEX M',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I4@', '1 MARR', '2 DATE 1940',
        '0 @F2@ FAM', '1 HUSB @I1@', '1 WIFE @I3@', '1 CHIL @I5@', '1 MARR', '2 DATE 1955',
        '0 TRLR',
    ].join('\n'),

    'czech diacritics': [
        '0 HEAD', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Bohuslav /Příliš/', '1 SEX M', '1 BIRT', '2 PLAC Žďár nad Sázavou',
        '1 NOTE Přezdívka: Žluťoučký kůň',
        '0 @I2@ INDI', '1 NAME Růžena /Přílišová/', '1 SEX F',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@',
        '0 TRLR',
    ].join('\n'),

    'partial dates': [
        '0 HEAD', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Old /Ancestor/', '1 SEX M', '1 BIRT', '2 DATE ABT 1780',
        '1 DEAT', '2 DATE BEF 1850',
        '0 @I2@ INDI', '1 NAME Year /Only/', '1 SEX F', '1 BIRT', '2 DATE 1800',
        '0 @I3@ INDI', '1 NAME Month /Known/', '1 SEX M', '1 BIRT', '2 DATE MAR 1820',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@', '1 MARR', '2 DATE AFT 1799',
        '0 TRLR',
    ].join('\n'),

    'life events': [
        '0 HEAD', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Emil /Vesely/', '1 SEX M',
        '1 BIRT', '2 DATE 1900',
        '1 BAPM', '2 DATE 15 JAN 1900', '2 PLAC Praha',
        '1 OCCU Blacksmith', '2 DATE 1925',
        '1 RESI', '2 PLAC Kladno',
        '1 EMIG', '2 DATE 1930', '2 PLAC Hamburg',
        '1 EDUC', '2 NOTE Studied at Charles University',
        '1 BURI', '2 DATE 1975', '2 PLAC Kladno',
        '0 @I2@ INDI', '1 NAME Ida /Vesela/', '1 SEX F', '1 IMMI', '2 DATE 1931',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@',
        '0 TRLR',
    ].join('\n'),

    'adoptive pedigree': [
        '0 HEAD', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Otec /Rodic/', '1 SEX M',
        '0 @I2@ INDI', '1 NAME Matka /Rodic/', '1 SEX F',
        '0 @I3@ INDI', '1 NAME Adopt /Rodic/', '1 SEX M', '1 FAMC @F1@', '2 PEDI adopted',
        '0 @I4@ INDI', '1 NAME Pest /Rodic/', '1 SEX F', '1 FAMC @F1@', '2 PEDI foster',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@', '1 CHIL @I4@',
        '0 TRLR',
    ].join('\n'),

    'sources': [
        '0 HEAD', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Josef /Novak/', '1 SEX M',
        '1 BIRT', '2 DATE 1880',
        '1 SOUR @S1@',
        '1 BAPM', '2 DATE 1880', '2 SOUR @S2@',
        '0 @I2@ INDI', '1 NAME Marie /Novakova/', '1 SEX F', '1 SOUR @S1@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@',
        '0 @S1@ SOUR', '1 TITL Census of 1880', '1 REPO National Archive', '1 PAGE fol. 12',
        '0 @S2@ SOUR', '1 TITL Parish baptism register', '1 WWW https://example.org/reg',
        '0 TRLR',
    ].join('\n'),

    'nameless individual': [
        '0 HEAD', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Known /Person/', '1 SEX M',
        '0 @I2@ INDI', '1 SEX F',
        '0 @I3@ INDI', '1 NAME Child /Person/', '1 SEX M',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@',
        '0 TRLR',
    ].join('\n'),
};

describe('GEDCOM round-trip', () => {
    for (const [name, ged] of Object.entries(FIXTURES)) {
        it(`data is stable across import->export->import: ${name}`, () => {
            const data1 = importGed(ged);
            const data2 = importGed(exportGed(data1));
            expect(normalize(data2)).toEqual(normalize(data1));
        });

        it(`GEDCOM is stable across export->import->export: ${name}`, () => {
            const data1 = importGed(ged);
            const ged2 = exportGed(data1);
            const ged3 = exportGed(importGed(ged2));
            expect(stripVolatile(ged3)).toEqual(stripVolatile(ged2));
        });
    }

    it('imports single-parent families with a placeholder partner (no drop)', () => {
        const result = convertToStrom(parseGedcom(FIXTURES['single parent']));
        const persons = Object.values(result.data.persons);
        // 3 real + 1 placeholder partner
        expect(persons.filter(p => !p.isPlaceholder)).toHaveLength(3);
        expect(persons.filter(p => p.isPlaceholder)).toHaveLength(1);
        // the two children are linked to a partnership
        expect(Object.keys(result.data.partnerships)).toHaveLength(1);
        const part = Object.values(result.data.partnerships)[0];
        expect(part.childIds).toHaveLength(2);
    });

    it('keeps nameless individuals as placeholders instead of skipping them', () => {
        const result = convertToStrom(parseGedcom(FIXTURES['nameless individual']));
        expect(result.stats.placeholderPersons).toBe(1);
        expect(Object.keys(result.data.persons)).toHaveLength(3);
        // the family stays intact: father + placeholder mother + child
        const part = Object.values(result.data.partnerships)[0];
        expect(part.childIds).toHaveLength(1);
    });

    it('preserves Czech diacritics through a round-trip', () => {
        const data = importGed(FIXTURES['czech diacritics']);
        const father = Object.values(data.persons).find(p => p.firstName === 'Bohuslav');
        expect(father?.lastName).toBe('Příliš');
        expect(father?.birthPlace).toBe('Žďár nad Sázavou');
        expect(father?.notes).toBe('Přezdívka: Žluťoučký kůň');
    });

    it('preserves partial-date qualifiers', () => {
        const data = importGed(FIXTURES['partial dates']);
        const byName = (n: string) => Object.values(data.persons).find(p => p.firstName === n);
        expect(byName('Old')?.birthDate).toBe('~1780');
        expect(byName('Old')?.deathDate).toBe('<1850');
        expect(byName('Year')?.birthDate).toBe('1800');
        expect(byName('Month')?.birthDate).toBe('1820-03');
    });

    it('round-trips marriage place and notes into partnership fields', () => {
        const data = importGed(FIXTURES['full family']);
        const part = Object.values(data.partnerships)[0];
        expect(part.startDate).toBe('1925');
        expect(part.startPlace).toBe('Brno');
        expect(part.note).toBe('Married in a small church');
    });

    it('maps FAMC PEDI to parent relationship types (adopted/foster)', () => {
        const data = importGed(FIXTURES['adoptive pedigree']);
        const byName = (n: string) => Object.values(data.persons).find(p => p.firstName === n);
        const adopt = byName('Adopt');
        const foster = byName('Pest');
        expect(adopt?.parentRelTypes && Object.values(adopt.parentRelTypes)).toEqual(['adoptive', 'adoptive']);
        expect(foster?.parentRelTypes && Object.values(foster.parentRelTypes)).toEqual(['foster', 'foster']);
    });
});

describe('GEDCOM fidelity fixes (audit 2026-07)', () => {
    const GED = (body: string) => `0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n${body}\n0 TRLR`;
    const conv = (ged: string) => convertToStrom(parseGedcom(ged));

    it('a bare DIV (divorce without a date) survives the round-trip', () => {
        const ged = GED([
            '0 @I1@ INDI', '1 NAME Jan /Novak/', '1 SEX M', '1 FAMS @F1@',
            '0 @I2@ INDI', '1 NAME Eva /Novakova/', '1 SEX F', '1 FAMS @F1@',
            '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 MARR', '1 DIV',
        ].join('\n'));
        const first = conv(ged);
        const u1 = Object.values(first.data.partnerships)[0];
        expect(u1.status).toBe('divorced');
        expect(u1.endDate).toBeUndefined();
        // Export → re-import keeps divorced.
        const again = conv(exportToGedcom(first.data).content);
        expect(Object.values(again.data.partnerships)[0].status).toBe('divorced');
    });

    it('counts and summarizes dropped tags (dead counter fixed)', () => {
        // TITL stood in here once and DSCR after it; both are carried now, so
        // the counter is exercised with tags we genuinely keep out — a nickname
        // the model has no place for, and one of the file's own record numbers.
        const ged = GED([
            '0 @I1@ INDI', '1 NAME Jan /Novak/', '1 SEX M',
            '1 NICK Honza', '1 RFN 12345', '1 NICK Jenda',
            '0 @N1@ NOTE some floating note',
        ].join('\n'));
        const r = conv(ged);
        // The shared NOTE record is read now (pointers resolve to it), so it
        // is not unsupported — and its text must never reach the summary.
        expect(r.stats.unsupportedTags).toBe(3);
        expect(r.stats.droppedTagSummary).not.toContain('floating');
        expect(r.stats.droppedTagSummary).toContain('NICK ×2');
        expect(r.stats.droppedTagSummary).toContain('RFN ×1');
    });

    it('infers gender from the family role for SEX U, and counts it', () => {
        const ged = GED([
            '0 @I1@ INDI', '1 NAME Alex /Smith/', '1 SEX U', '1 FAMS @F1@',
            '0 @I2@ INDI', '1 NAME Kim /Smith/', '1 FAMS @F1@',
            '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@',
        ].join('\n'));
        const r = conv(ged);
        const persons = Object.values(r.data.persons);
        expect(persons.find(p => p.firstName === 'Alex')?.gender).toBe('male');   // HUSB
        expect(persons.find(p => p.firstName === 'Kim')?.gender).toBe('female');  // WIFE
        expect(r.stats.unknownSexPersons).toBe(2);
    });

    it('multi-line event notes survive the round-trip (level-3 CONT)', () => {
        const ged = GED([
            '0 @I1@ INDI', '1 NAME Jan /Novak/', '1 SEX M',
            '1 RESI', '2 PLAC Praha', '2 NOTE First line', '3 CONT Second line',
        ].join('\n'));
        const first = conv(ged);
        const ev = Object.values(first.data.persons)[0].events?.[0];
        expect(ev?.note).toBe('First line\nSecond line');
        const again = conv(exportToGedcom(first.data).content);
        expect(Object.values(again.data.persons)[0].events?.[0]?.note).toBe('First line\nSecond line');
    });

    it('wraps long notes with CONC on export (255-char physical line limit)', () => {
        const long = 'word '.repeat(120).trim();   // ~600 chars
        const ged = GED(['0 @I1@ INDI', '1 NAME Jan /Novak/', '1 SEX M'].join('\n'));
        const r = conv(ged);
        const person = Object.values(r.data.persons)[0];
        person.notes = long;
        const out = exportToGedcom(r.data).content;
        for (const line of out.split('\n')) {
            expect(line.length).toBeLessThanOrEqual(255);
        }
        expect(out).toContain('CONC');
        // And it round-trips byte-identically.
        const again = conv(out);
        expect(Object.values(again.data.persons)[0].notes).toBe(long);
    });
});

describe('GEDCOM media (OBJE) and standard sources', () => {
    const GED = (body: string) => `0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n${body}\n0 TRLR`;
    const conv = (ged: string) => convertToStrom(parseGedcom(ged));
    const PNG = 'data:image/png;base64,' + 'QUJDREVGRw=='.repeat(40);

    it('photo and attachment round-trip through OBJE data URLs', () => {
        const ged = GED(['0 @I1@ INDI', '1 NAME Jan /Novak/', '1 SEX M'].join('\n'));
        const r = conv(ged);
        const person = Object.values(r.data.persons)[0];
        person.photo = PNG;
        person.photoOriginalName = 'grandpa.png';
        person.attachments = [{
            id: 'att1', name: 'oddaci-list.pdf', mimeType: 'application/pdf',
            dataUrl: 'data:application/pdf;base64,' + 'UERGREFUQQ=='.repeat(60),
            sizeBytes: 480,
        }];
        const out = exportToGedcom(r.data).content;
        for (const line of out.split('\n')) expect(line.length).toBeLessThanOrEqual(255);

        const again = conv(out);
        const p2 = Object.values(again.data.persons)[0];
        expect(p2.photo).toBe(PNG);
        expect(p2.photoOriginalName).toBe('grandpa.png');
        expect(p2.attachments).toHaveLength(1);
        expect(p2.attachments![0].name).toBe('oddaci-list.pdf');
        expect(p2.attachments![0].mimeType).toBe('application/pdf');
        expect(p2.attachments![0].dataUrl).toBe(person.attachments[0].dataUrl);
    });

    it('external OBJE file paths are collected for bulk media attachment', () => {
        const ged = GED([
            '0 @I1@ INDI', '1 NAME Jan /Novak/', '1 SEX M',
            '1 OBJE', '2 FORM jpeg', '2 FILE C:\\photos\\jan.jpg',
        ].join('\n'));
        const r = conv(ged);
        expect(Object.values(r.data.persons)[0].attachments).toBeUndefined();
        // External refs are no longer dropped: they are collected so the
        // import summary can offer bulk media attachment (M3).
        expect(r.externalMedia).toHaveLength(1);
        expect(r.externalMedia[0].fileName).toBe('jan.jpg');   // basename, Windows path
        expect(r.externalMedia[0].filePath).toBe('C:\\photos\\jan.jpg');
    });

    it('repositories export as @R@ records and resolve back on import', () => {
        const ged = GED([
            '0 @I1@ INDI', '1 NAME Jan /Novak/', '1 SEX M', '1 SOUR @S1@',
            '0 @S1@ SOUR', '1 TITL Matrika narozených', '1 PAGE fol. 12',
        ].join('\n'));
        const r = conv(ged);
        const src = Object.values(r.data.sources!)[0];
        src.repository = 'SOA Litoměřice';
        const out = exportToGedcom(r.data).content;
        expect(out).toMatch(/0 @R1@ REPO\n1 NAME SOA Litoměřice/);
        expect(out).toContain('1 REPO @R1@');
        expect(out).toMatch(/1 SOUR @S1@\n2 PAGE fol\. 12/);   // citation carries the page

        const again = conv(out);
        const src2 = Object.values(again.data.sources!)[0];
        expect(src2.repository).toBe('SOA Litoměřice');
        expect(src2.reference).toBe('fol. 12');
    });

    it('citation-level PAGE fills the source reference on import (other tools)', () => {
        const ged = GED([
            '0 @I1@ INDI', '1 NAME Jan /Novak/', '1 SEX M',
            '1 SOUR @S1@', '2 PAGE p. 44',
            '0 @S1@ SOUR', '1 TITL Parish register',
        ].join('\n'));
        const r = conv(ged);
        expect(Object.values(r.data.sources!)[0].reference).toBe('p. 44');
    });
});

describe('data honesty batch (K1/K4/K6)', () => {
    const GED = [
        '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @S1@ SOUR', '1 TITL Oddaci matrika Decin', '1 QUAY 3',
        '0 @I1@ INDI', '1 NAME Jan /Novak/', '1 SEX M',
        '1 BIRT', '2 DATE BET 1880 AND 1885',
        '1 RESI', '2 DATE FROM 1902 TO 1910',
        '0 @I2@ INDI', '1 NAME Marie /Novakova/', '1 SEX F',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@',
        '1 MARR', '2 DATE 5 MAY 1903',
        '1 SOUR @S1@', '2 PAGE fol. 12',
        '0 TRLR',
    ].join('\n');

    it('K1: family SOUR citation lands on the partnership and round-trips', () => {
        const data = importGed(GED);
        const partnership = Object.values(data.partnerships)[0];
        expect(partnership.sourceIds).toHaveLength(1);
        const src = data.sources![partnership.sourceIds![0]];
        expect(src.title).toBe('Oddaci matrika Decin');
        expect(src.reference).toBe('fol. 12');   // citation PAGE preserved

        const again = importGed(exportGed(data));
        const p2 = Object.values(again.partnerships)[0];
        expect(p2.sourceIds).toHaveLength(1);
        expect(again.sources![p2.sourceIds![0]].title).toBe('Oddaci matrika Decin');
    });

    it('K4: BET/AND and FROM/TO import as ranges and re-export as BET/AND', () => {
        const data = importGed(GED);
        const jan = Object.values(data.persons).find(p => p.firstName === 'Jan')!;
        expect(jan.birthDate).toBe('1880..1885');
        const resi = jan.events!.find(e => e.type === 'residence')!;
        expect(resi.date).toBe('1902..1910');

        const ged2 = exportGed(data);
        expect(ged2).toContain('DATE BET 1880 AND 1885');
        expect(ged2).toContain('DATE BET 1902 AND 1910');
    });

    it('K4: one-sided periods degrade to qualifiers', () => {
        const ged = GED.replace('2 DATE FROM 1902 TO 1910', '2 DATE FROM 1902');
        const jan = Object.values(importGed(ged).persons).find(p => p.firstName === 'Jan')!;
        expect(jan.events!.find(e => e.type === 'residence')!.date).toBe('>1902');
    });

    it('K6: QUAY survives the round-trip (record and citation)', () => {
        const data = importGed(GED);
        const src = Object.values(data.sources!)[0];
        expect(src.quality).toBe(3);

        const ged2 = exportGed(data);
        expect(ged2).toMatch(/QUAY 3/);
        const again = importGed(ged2);
        expect(Object.values(again.sources!)[0].quality).toBe(3);
    });

    it('K6: citation-level QUAY is picked up when the record has none', () => {
        const ged = GED.replace('1 QUAY 3\n', '').replace('2 PAGE fol. 12', '2 PAGE fol. 12\n2 QUAY 2');
        const data = importGed(ged);
        expect(Object.values(data.sources!)[0].quality).toBe(2);
    });
});

describe('MyHeritage export quirks (M1, real-export shapes)', () => {
    const MH = [
        '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8', '1 SOUR MYHERITAGE',
        '0 @I1@ INDI',
        '1 _UPD 14 JAN 2026 06:59:33 GMT -0500',
        '1 NAME Emil /Tester/', '2 GIVN Emil', '2 SURN Tester',
        '1 SEX M',
        '1 BIRT', '2 DATE 3 JUN 1942', '2 PLAC First Place',
        '1 BIRT', '2 DATE 3 JUN 1942', '2 PLAC Second Place',
        '1 DEAT Y',
        '1 RIN MH:I1', '1 _UID F8DB4F74-XXXX',
        '1 OBJE', '2 FORM jpg', '2 FILE https://cdn.example.com/x/500022_crop.jpg?sig=1', '2 _PHOTO_RIN MH:P2',
        '1 OBJE', '2 FORM jpg', '2 FILE https://cdn.example.com/x/500022_main.jpg?sig=1', '2 _PERSONALPHOTO Y', '2 _PHOTO_RIN MH:P1',
        '0 @I2@ INDI', '1 NAME Jana /Testerova/', '1 SEX F',
        '1 RESI', '2 EMAIL jana@@example.com',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@',
        '1 MARR', '2 DATE 5 MAY 1965',
        '1 ENGA', '2 DATE 1 JAN 1964',
        '0 TRLR',
    ].join('\n');

    it('duplicate BIRT: first wins, the alternative survives as a labelled custom event', () => {
        const emil = Object.values(importGed(MH).persons).find(p => p.firstName === 'Emil')!;
        expect(emil.birthPlace).toBe('First Place');
        const alt = emil.events!.find(e => e.place === 'Second Place')!;
        // NOT a 'birth' event: validation reserves birth/death for the date
        // fields and would flag them as an error.
        expect(alt.type).toBe('custom');
        expect(alt.customLabel).toMatch(/alternative/i);
    });

    it('an imported MyHeritage tree does not validate with self-inflicted errors', () => {
        const data = importGed(MH);
        const birthDeathEvents = Object.values(data.persons)
            .flatMap(p => p.events ?? [])
            .filter(e => e.type === 'birth' || e.type === 'death');
        expect(birthDeathEvents).toHaveLength(0);
        const result = validateTreeData(data);
        expect(result.issues.filter(i => i.type === 'event-birth-death')).toHaveLength(0);
        expect(result.issues.filter(i => i.type === 'event-no-label')).toHaveLength(0);
    });

    it("bare 'DEAT Y' marks the person deceased", () => {
        const emil = Object.values(importGed(MH).persons).find(p => p.firstName === 'Emil')!;
        expect(emil.deathDate).toBeUndefined();
        expect(emil.isDeceased).toBe(true);
    });

    it('bookkeeping tags (_UPD/RIN/_UID) are not counted as unsupported', () => {
        const r = convertToStrom(parseGedcom(MH));
        expect(r.stats.droppedTagSummary).not.toMatch(/_UPD|RIN|_UID/);
    });

    it('RESI e-mail lands in the event note with @@ unescaped', () => {
        const jana = Object.values(importGed(MH).persons).find(p => p.firstName === 'Jana')!;
        expect(jana.events!.find(e => e.type === 'residence')!.note).toBe('E-mail: jana@example.com');
    });

    it('ENGA becomes a partnership note', () => {
        const u = Object.values(importGed(MH).partnerships)[0];
        expect(u.note).toContain('Engagement: 1964-01-01');
    });

    it('URL media refs: primary portrait first, url flag set, query stripped from name', () => {
        const r = convertToStrom(parseGedcom(MH));
        expect(r.externalMedia).toHaveLength(2);
        expect(r.externalMedia[0].fileName).toBe('500022_main.jpg');   // _PERSONALPHOTO first
        expect(r.externalMedia[0].primary).toBe(true);
        expect(r.externalMedia[0].isUrl).toBe(true);
    });
});

describe('REFN reference numbers (K12)', () => {
    it('imports 1 REFN and round-trips it', () => {
        const ged = [
            '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
            '0 @I1@ INDI', '1 NAME Jan /Novak/', '1 SEX M', '1 REFN box-12/1880',
            '0 TRLR',
        ].join('\n');
        const data = importGed(ged);
        const jan = Object.values(data.persons)[0];
        expect(jan.refn).toBe('box-12/1880');

        const out = exportGed(data);
        expect(out).toContain('1 REFN box-12/1880');
        expect(Object.values(importGed(out).persons)[0].refn).toBe('box-12/1880');
    });

    it('REFN is not counted as an unsupported tag', () => {
        const ged = [
            '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
            '0 @I1@ INDI', '1 NAME Jan /Novak/', '1 REFN X1', '0 TRLR',
        ].join('\n');
        expect(convertToStrom(parseGedcom(ged)).stats.droppedTagSummary).not.toMatch(/REFN/);
    });
});


describe('godparents and witnesses survive the round-trip (K2)', () => {
    /**
     * The two cases that matter: a godparent who IS in the tree (ASSO points at
     * their record) and one who is not (_WITN carries just the name). The second
     * is the common one — a godparent is usually a neighbour.
     */
    const GED = `0 HEAD
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Jan /Novak/
1 SEX M
1 BAPM
2 DATE 15 MAY 1880
2 PLAC Kolin
2 ASSO @I2@
3 RELA Godparent
2 _WITN Marie Dvorakova
3 RELA Godparent
3 NOTE soused, kovar
2 _WITN Josef Kratky
3 RELA Witness
0 @I2@ INDI
1 NAME Frantisek /Novak/
1 SEX M
0 TRLR`;

    it('reads a linked godparent, a named one, and their roles', () => {
        const data = importGed(GED);
        const jan = Object.values(data.persons).find(p => p.firstName === 'Jan')!;
        const frantisek = Object.values(data.persons).find(p => p.firstName === 'Frantisek')!;
        const parts = jan.events?.[0].participants ?? [];

        expect(parts).toHaveLength(3);
        // In the tree: linked, no free-text name needed.
        expect(parts[0]).toMatchObject({ role: 'godparent', personId: frantisek.id });
        expect(parts[0].name).toBeUndefined();
        // Not in the tree: the name as written, plus what the register said.
        expect(parts[1]).toMatchObject({ role: 'godparent', name: 'Marie Dvorakova', note: 'soused, kovar' });
        expect(parts[2]).toMatchObject({ role: 'witness', name: 'Josef Kratky' });
    });

    it('writes them back out again', () => {
        const ged = exportGed(importGed(GED));
        expect(ged).toContain('2 ASSO @I2@');
        expect(ged).toMatch(/2 ASSO @I2@\n3 RELA Godparent/);
        expect(ged).toMatch(/2 _WITN Marie Dvorakova\n3 RELA Godparent\n3 NOTE soused, kovar/);
        expect(ged).toMatch(/2 _WITN Josef Kratky\n3 RELA Witness/);
    });

    it('survives import → export → import unchanged', () => {
        const once = importGed(GED);
        const twice = importGed(exportGed(once));
        expect(normalize(twice)).toEqual(normalize(once));
    });

    it('understands however another program spells the role', () => {
        const foreign = GED
            .replace('3 RELA Godparent\n2 _WITN Marie', '3 RELA godmother\n2 _WITN Marie')
            .replace('3 RELA Witness', '3 RELA Svědek');
        const data = importGed(foreign);
        const parts = Object.values(data.persons).find(p => p.firstName === 'Jan')!.events![0].participants!;
        expect(parts[0].role).toBe('godparent');
        expect(parts[2].role).toBe('witness');
    });

    it('keeps the role when ASSO points at nobody, rather than dropping the person', () => {
        const dangling = GED.replace('2 ASSO @I2@', '2 ASSO @I99@');
        const parts = Object.values(importGed(dangling).persons)
            .find(p => p.firstName === 'Jan')!.events![0].participants!;
        // No link and no name → nothing to show, so that one goes; the rest stay.
        expect(parts).toHaveLength(2);
        expect(parts.map(p => p.name)).toEqual(['Marie Dvorakova', 'Josef Kratky']);
    });
});


describe('name variants survive the round-trip (K3)', () => {
    /**
     * GEDCOM allows several NAME lines: the first is the primary one, the rest
     * are other spellings. The parser used to overwrite, so the primary name was
     * silently replaced by whatever variant came last in the file.
     */
    const GED = `0 HEAD
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Josef /Visek/
1 NAME Wischek
1 NAME u Kovare
1 SEX M
0 TRLR`;

    it('keeps the first name as the name, and the rest as variants', () => {
        const person = Object.values(importGed(GED).persons)[0];
        expect(person.firstName).toBe('Josef');
        expect(person.lastName).toBe('Visek');       // NOT overwritten by the last NAME
        expect(person.nameVariants).toEqual(['Wischek', 'u Kovare']);
    });

    it('writes them back as further NAME lines', () => {
        const ged = exportGed(importGed(GED));
        expect(ged).toMatch(/1 NAME Josef \/Visek\/\n1 NAME Wischek\n1 NAME u Kovare/);
    });

    it('survives import → export → import unchanged', () => {
        const once = importGed(GED);
        expect(normalize(importGed(exportGed(once)))).toEqual(normalize(once));
    });
});

describe('register-harvest tags: CHR, EVEN+TYPE, CENS', () => {
    const GED = `0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Jan /Novák/
1 SEX M
1 CHR
2 DATE 12 MAY 1850
2 PLAC Lipany
1 EVEN
2 TYPE Rychtář
2 DATE 1888
2 PLAC Lipany
1 CENS
2 DATE 1869
2 PLAC Lipany 12
0 TRLR
`;

    it('imports CHR as baptism, EVEN+TYPE and CENS as labelled custom events', () => {
        const data = importGed(GED);
        const person = Object.values(data.persons)[0];
        const byType = (t: string) => (person.events ?? []).filter(e => e.type === t);
        expect(byType('baptism')).toHaveLength(1);
        expect(byType('baptism')[0].place).toBe('Lipany');
        const custom = byType('custom');
        expect(custom.map(e => e.customLabel).sort()).toEqual(['Census', 'Rychtář']);
        const rychtar = custom.find(e => e.customLabel === 'Rychtář')!;
        expect(rychtar.date).toBe('1888');
        expect(rychtar.place).toBe('Lipany');
    });

    it('custom events survive the full import → export → import round-trip', () => {
        const once = importGed(GED);
        const twice = importGed(exportGed(once));
        expect(normalize(twice)).toEqual(normalize(once));
        // …and the exported GEDCOM carries the generic tag with its label.
        const ged = exportGed(once);
        expect(ged).toContain('1 EVEN');
        expect(ged).toContain('2 TYPE Rychtář');
    });
});

describe('RELI: denomination as an event of its own', () => {
    /**
     * A denomination is not a fixed property of a person: a conversion is a
     * dated act with a place and a record behind it, which is why it is an
     * event rather than a field. GEDCOM puts the denomination on the tag's own
     * line, the way it does for OCCU.
     */
    const GED = `0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Jan /Novák/
1 SEX M
1 RELI Evangelík augsburského vyznání
2 DATE 12 MAY 1889
2 PLAC Lučice
1 BIRT
2 DATE 5 MAY 1863
2 PLAC Lučice
2 RELI Římskokatolické
0 TRLR
`;

    it('reads RELI as a religion event carrying the denomination', () => {
        const data = importGed(GED);
        const person = Object.values(data.persons)[0];
        const rel = (person.events ?? []).find(e => e.type === 'religion')!;
        expect(rel.note).toBe('Evangelík augsburského vyznání');
        expect(rel.date).toBe('1889-05-12');
        expect(rel.place).toBe('Lučice');
    });

    it('keeps a denomination written INSIDE a birth block as a labelled note', () => {
        // That one is what the register wrote at the baptism, not the person's
        // own RELI attribute — promoting it to an event would invent a
        // conversion that never happened. Before this it vanished without even
        // being counted as an unsupported tag.
        const person = Object.values(importGed(GED).persons)[0];
        expect(person.notes).toContain('Římskokatolické');
    });

    it('nothing is reported as unsupported, and it survives the round-trip', () => {
        const result = convertToStrom(parseGedcom(GED));
        expect(result.stats.droppedTagSummary).toBeFalsy();

        const once = importGed(GED);
        const ged = exportGed(once);
        expect(ged).toContain('1 RELI Evangelík augsburského vyznání');
        expect(normalize(importGed(ged))).toEqual(normalize(once));
    });
});

describe('the standard events a register actually keeps', () => {
    /**
     * An audit of GEDCOM 5.5.1 against the parser found thirty INDI tags going
     * straight to the floor. These are the ones a parish book (or the office
     * that followed it) really writes: the rest of the sacraments, the legal
     * acts, and the two attributes that describe the person rather than
     * something they did.
     */
    const GED = `0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Jan /Novák/
1 SEX M
1 CONF
2 DATE 3 JUN 1875
2 PLAC Litomyšl
1 FCOM
2 DATE 1873
1 BARM
2 DATE 1876
1 BASM
2 DATE 1877
1 ORDN
2 DATE 1888
1 ADOP
2 DATE 1866
1 NATU
2 DATE 1910
1 WILL
2 DATE 1930
1 PROB
2 DATE 1932
1 CREM
2 DATE 1932
1 TITL MUDr.
1 NATI Rakousko-Uhersko
0 TRLR
`;

    it('reads every one of them, and reports nothing as unsupported', () => {
        const result = convertToStrom(parseGedcom(GED));
        expect(result.stats.droppedTagSummary).toBeFalsy();

        const person = Object.values(result.data.persons)[0];
        const byType = new Map((person.events ?? []).map(e => [e.type, e]));
        expect([...byType.keys()].sort()).toEqual([
            'adoption', 'barMitzvah', 'batMitzvah', 'confirmation', 'cremation',
            'firstCommunion', 'naturalization', 'nationality', 'ordination',
            'probate', 'title', 'will',
        ].sort());
        expect(byType.get('confirmation')!.date).toBe('1875-06-03');
        expect(byType.get('confirmation')!.place).toBe('Litomyšl');
    });

    it('keeps an attribute\'s value, which rides on the tag line', () => {
        // `1 TITL MUDr.` — the value is the fact, the way `1 OCCU` works. Read
        // as a subordinate structure it would import as an empty event.
        const person = Object.values(importGed(GED).persons)[0];
        const byType = new Map((person.events ?? []).map(e => [e.type, e]));
        expect(byType.get('title')!.note).toBe('MUDr.');
        expect(byType.get('nationality')!.note).toBe('Rakousko-Uhersko');
    });

    it('writes them back under their own tags, not as generic events', () => {
        const ged = exportGed(importGed(GED));
        for (const tag of ['CONF', 'FCOM', 'BARM', 'BASM', 'ORDN', 'ADOP',
            'NATU', 'WILL', 'PROB', 'CREM']) {
            expect(ged, tag).toContain(`1 ${tag}`);
        }
        expect(ged).toContain('1 TITL MUDr.');
        expect(ged).toContain('1 NATI Rakousko-Uhersko');
        expect(ged).not.toContain('1 EVEN');
    });

    it('survives the round-trip', () => {
        const once = importGed(GED);
        expect(normalize(importGed(exportGed(once)))).toEqual(normalize(once));
    });

    it('folds the alias tags into the sacrament they are', () => {
        // CHRA is the adult form of a christening and GRAD is schooling
        // reaching its end; neither needs a type of its own, and dropping them
        // would lose a dated fact.
        const aliased = `0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME A /B/\n`
            + `1 CHRA\n2 DATE 1900\n1 GRAD\n2 DATE 1885\n0 TRLR\n`;
        const result = convertToStrom(parseGedcom(aliased));
        expect(result.stats.droppedTagSummary).toBeFalsy();
        const types = (Object.values(result.data.persons)[0].events ?? []).map(e => e.type);
        expect(types.sort()).toEqual(['baptism', 'education']);
    });
});

describe('standard facts with no field of their own are kept as notes', () => {
    /**
     * Giving each of these a field or an event would mean carrying a subsystem
     * for facts that turn up once in a hundred files; dropping them means a
     * GEDCOM from another program arrives quietly poorer than it left. A
     * labelled line in the note keeps everything and costs nothing.
     */
    const GED = `0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Jan /Novák/
1 SEX M
1 FAMS @F1@
1 PROP Grunt čp. 22 v Lučici
1 CAST sedlák
1 RETI
2 DATE 1925
2 PLAC Lučice
1 FACT
2 TYPE Vojenská hodnost
2 NOTE desátník
1 NOTE Volná poznámka ze souboru.
0 @I2@ INDI
1 NAME Marie /Nová/
1 SEX F
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 3 MAY 1886
1 MARB
2 DATE 18 APR 1886
2 PLAC Lučice
1 ANUL
0 TRLR
`;

    it('reports none of them as unsupported', () => {
        expect(convertToStrom(parseGedcom(GED)).stats.droppedTagSummary).toBeFalsy();
    });

    it('labels each fact and keeps its value, date and place', () => {
        const data = importGed(GED);
        const jan = Object.values(data.persons).find(p => p.firstName === 'Jan')!;
        expect(jan.notes).toContain('Grunt čp. 22 v Lučici');
        expect(jan.notes).toContain('sedlák');
        // A dated fact keeps both halves.
        expect(jan.notes).toMatch(/1925.*Lučice/);
        // TYPE names what a generic FACT is about; a NOTE under it joins in.
        expect(jan.notes).toContain('Vojenská hodnost');
        expect(jan.notes).toContain('desátník');
        // The file's own free-text note is not displaced by any of it.
        expect(jan.notes).toContain('Volná poznámka ze souboru.');
    });

    it('puts what was recorded about the couple on the couple', () => {
        const union = Object.values(importGed(GED).partnerships)[0];
        expect(union.note).toMatch(/18|4/);          // the banns date, formatted
        expect(union.note).toContain('Lučice');
        // A fact with nothing but its own tag still earns its line: the
        // register said it happened, and that is the fact.
        expect(union.note!.split('\n').some(l => l.trim().length > 0
            && !l.includes('Lučice'))).toBe(true);
    });

    it('leaves the platform bookkeeping alone', () => {
        // ANCI/DESI/RFN/AFN/RESN belong to the program that wrote the file, not
        // to anything a register said — they stay reported, not folded in.
        const ged = `0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME A /B/\n`
            + `1 RFN 12345\n1 RESN confidential\n0 TRLR\n`;
        const result = convertToStrom(parseGedcom(ged));
        expect(result.stats.droppedTagSummary).toContain('RFN');
        expect(Object.values(result.data.persons)[0].notes ?? '').not.toContain('12345');
    });
});

describe('register entries: what hangs under BIRT, DEAT and MARR', () => {
    // The shape an AI-transcribed parish register produces: the citation, the
    // note and the godparents sit INSIDE the birth/death/marriage block, not
    // on the person. Reading only DATE and PLAC lost all of it silently — in
    // one real 121-person file: 117 citations, 75 witnesses and 29 notes.
    const GED = `0 HEAD
1 CHAR UTF-8
0 @S1@ SOUR
1 TITL Matrika narozených Lipany 1840-1870
1 REPO SOA Praha
0 @S2@ SOUR
1 TITL Matrika oddaných Lipany
0 @I1@ INDI
1 NAME Jan /Novák/
1 SEX M
1 BIRT
2 DATE 12 MAY 1850
2 PLAC Lipany
2 SOUR @S1@
3 PAGE sign. LIP-N5, fol. 123
2 NOTE Zapsán jako Johann.
2 _WITN Josef Dvořák, sedlák z Lipan
3 RELA godparent
1 CHR
2 DATE 14 MAY 1850
2 PLAC Lipany
1 DEAT
2 DATE 3 FEB 1910
2 SOUR @S1@
2 NOTE Příčina: zápal plic.
1 NOTE První poznámka.
1 NOTE Druhá poznámka.
1 FAMS @F1@
0 @I2@ INDI
1 NAME Marie /Nováková/
1 SEX F
1 BIRT
2 DATE 1 JAN 1855
2 _WITN Anna Kmotrová
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 5 SEP 1875
2 PLAC Lipany
2 SOUR @S2@
3 PAGE sign. LIP-O2, fol. 12
2 NOTE Ohlášky třikrát.
0 TRLR
`;

    it('keeps the citation of the birth and death entry on the person', () => {
        const data = importGed(GED);
        const jan = Object.values(data.persons).find(p => p.firstName === 'Jan')!;
        expect(jan.sourceIds).toHaveLength(2);
        const titles = jan.sourceIds!.map(id => data.sources![id].title);
        expect(titles).toEqual(['Matrika narozených Lipany 1840-1870', 'Matrika narozených Lipany 1840-1870']);
        // The PAGE under the citation becomes the source reference.
        expect(data.sources![jan.sourceIds![0]].reference).toBe('sign. LIP-N5, fol. 123');
    });

    it('keeps the witnesses named at the wedding', () => {
        const ged = GED.replace('2 NOTE Ohlášky třikrát.',
            '2 NOTE Ohlášky třikrát.\n2 _WITN Václav Sedlák, soused\n2 _WITN Anna Kmotrová');
        const data = importGed(ged);
        const union = Object.values(data.partnerships)[0];
        expect(union.participants!.map(p => p.name))
            .toEqual(['Václav Sedlák, soused', 'Anna Kmotrová']);
        // _WITN says what they were, so that is the role they get.
        expect(union.participants!.every(p => p.role === 'witness')).toBe(true);
        // …and they are written back under MARR, not lost on export.
        const out = exportGed(data);
        expect(out).toMatch(/2 _WITN Václav Sedlák, soused\n3 RELA Witness/);
        expect(normalize(importGed(out))).toEqual(normalize(data));
    });

    it('keeps the marriage record citation and note on the partnership', () => {
        const data = importGed(GED);
        const union = Object.values(data.partnerships)[0];
        expect(union.sourceIds).toHaveLength(1);
        expect(data.sources![union.sourceIds![0]].title).toBe('Matrika oddaných Lipany');
        expect(union.note).toContain('Ohlášky třikrát.');
    });

    it('keeps notes written under BIRT/DEAT, labelled by the fact', () => {
        const data = importGed(GED);
        const jan = Object.values(data.persons).find(p => p.firstName === 'Jan')!;
        expect(jan.notes).toContain('Birth: Zapsán jako Johann.');
        expect(jan.notes).toContain('Death: Příčina: zápal plic.');
    });

    it('keeps every 1 NOTE, not just the last one', () => {
        const data = importGed(GED);
        const jan = Object.values(data.persons).find(p => p.firstName === 'Jan')!;
        expect(jan.notes).toContain('První poznámka.');
        expect(jan.notes).toContain('Druhá poznámka.');
    });

    it('moves a godparent named under BIRT onto the baptism', () => {
        const data = importGed(GED);
        const jan = Object.values(data.persons).find(p => p.firstName === 'Jan')!;
        const baptism = jan.events!.find(e => e.type === 'baptism')!;
        expect(baptism.participants).toHaveLength(1);
        expect(baptism.participants![0].name).toBe('Josef Dvořák, sedlák z Lipan');
        expect(baptism.participants![0].role).toBe('godparent');
        // No entry event was invented: the file already had the baptism.
        expect(jan.events!.filter(e => e.type === 'custom')).toHaveLength(0);
    });

    it('gives a witness an entry event when the file records no baptism', () => {
        const data = importGed(GED);
        const marie = Object.values(data.persons).find(p => p.firstName === 'Marie')!;
        const entry = marie.events!.find(e => e.customLabel === 'Birth record')!;
        expect(entry.date).toBe('1855-01-01');
        expect(entry.participants!.map(p => p.name)).toEqual(['Anna Kmotrová']);
    });

    it('survives the full import → export → import round-trip', () => {
        const once = importGed(GED);
        const twice = importGed(exportGed(once));
        expect(normalize(twice)).toEqual(normalize(once));
    });
});

describe('_STORY: the narrative written about a person or a couple', () => {
    /**
     * The contract the register-research tooling writes (see the _STORY block
     * it emits): TYPE/TITL/STAT/TEXT/DATA/NOTE, with the text glued back by
     * pure concatenation — CONC continues the same line, CONT is a real break.
     * Confusing the two would reflow the prose a little on every pass.
     */
    const GED = `0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 NAME František /Krepčík/
1 SEX M
1 _STORY
2 TYPE vypraveni
2 TITL Nemanželský syn z čp. 22
2 STAT navrh
2 TEXT Když se 5. května 1863 narodil v lučickém stavení čp. 22 chlapec, nechal farář rubriku pro ot
3 CONC ce prázdnou.
3 CONT
3 CONT V matrikách je nejdřív **nádeník**, později **domkář**.
2 DATA BIRT 5 MAY 1863 [K-04]
2 DATA CHR 7 MAY 1863 [K-04]
2 NOTE Sestaveno z doložených faktů. Není pramen.
0 @I2@ INDI
1 NAME Anna /Kadeřábková/
1 SEX F
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 2 AUG 1886
1 _STORY
2 TYPE vypraveni
2 STAT hotovo
2 TEXT Vzali se v srpnu 1886.
0 TRLR
`;

    it('reads the block: title, state, facts, caveat', () => {
        const data = importGed(GED);
        const frantisek = Object.values(data.persons).find(p => p.firstName === 'František')!;
        const story = frantisek.story!;
        expect(story.kind).toBe('vypraveni');
        expect(story.title).toBe('Nemanželský syn z čp. 22');
        expect(story.status).toBe('draft');
        expect(story.facts).toEqual(['BIRT 5 MAY 1863 [K-04]', 'CHR 7 MAY 1863 [K-04]']);
        expect(story.note).toContain('Není pramen');
    });

    it('glues the text the way the contract says: CONC joins, CONT breaks', () => {
        const story = Object.values(importGed(GED).persons)
            .find(p => p.firstName === 'František')!.story!;
        expect(story.text).toBe(
            'Když se 5. května 1863 narodil v lučickém stavení čp. 22 chlapec, nechal farář rubriku pro otce prázdnou.'
            + '\n\nV matrikách je nejdřív **nádeník**, později **domkář**.');
        // Two paragraphs, and the markdown emphasis is left for the book.
        expect(story.text.split('\n\n')).toHaveLength(2);
    });

    it('reads a story on a family too', () => {
        const union = Object.values(importGed(GED).partnerships)[0];
        expect(union.story?.text).toBe('Vzali se v srpnu 1886.');
        expect(union.story?.status).toBe('final');
    });

    it('writes it back and survives import → export → import unchanged', () => {
        const once = importGed(GED);
        const ged = exportGed(once);
        expect(ged).toContain('1 _STORY');
        expect(ged).toContain('2 TYPE vypraveni');
        expect(ged).toContain('2 STAT navrh');
        expect(ged).toContain('2 DATA BIRT 5 MAY 1863 [K-04]');
        expect(normalize(importGed(ged))).toEqual(normalize(once));
    });

    it('keeps every physical line inside the 255-BYTE limit, diacritics and all', () => {
        // 1200 Czech characters in one paragraph — roughly 2000 bytes in UTF-8.
        const long = 'Příliš žluťoučký kůň úpěl ďábelské ódy. '.repeat(30).trim();
        const data = importGed(GED);
        const person = Object.values(data.persons).find(p => p.firstName === 'František')!;
        person.story = { text: long, facts: ['x'.repeat(400)] };

        const ged = exportGed(data);
        const enc = new TextEncoder();
        for (const line of ged.split('\n')) {
            expect(enc.encode(line).length).toBeLessThanOrEqual(255);
        }
        // Split mid-word, never next to a space: no value is padded, so a
        // trimming reader cannot swallow one and run two words together.
        for (const line of ged.split('\n')) {
            const m = /^\d+ (?:@[^@]+@ )?(_?[A-Za-z0-9]+)(?: (.*))?$/.exec(line);
            if (m?.[2]) expect(m[2]).toBe(m[2].trim());
        }
        // And it comes back character for character.
        const back = Object.values(importGed(ged).persons).find(p => p.firstName === 'František')!;
        expect(back.story!.text).toBe(long);
        expect(back.story!.facts).toEqual(['x'.repeat(400)]);
    });

    it('is idempotent: exporting what was imported changes nothing', () => {
        const ged1 = exportGed(importGed(GED));
        const ged2 = exportGed(importGed(ged1));
        expect(stripVolatile(ged2)).toBe(stripVolatile(ged1));
    });

    it('a story without text is no story at all', () => {
        const empty = GED.replace(/2 TEXT [^\n]*\n(3 CON[TC][^\n]*\n)*/, '');
        const frantisek = Object.values(importGed(empty).persons).find(p => p.firstName === 'František')!;
        expect(frantisek.story).toBeUndefined();
    });
});
