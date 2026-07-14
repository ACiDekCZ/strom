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
            ...(person.events ? { events: person.events.map((e, i) => ({ ...e, id: `E${i}`, ...(e.sourceIds ? { sourceIds: mapSrc(e.sourceIds) } : {}) })) } : {}),
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
        const ged = GED([
            '0 @I1@ INDI', '1 NAME Jan /Novak/', '1 SEX M',
            '1 TITL Count of Nowhere', '1 NICK Honza', '1 TITL Duke',
            '0 @N1@ NOTE some floating note',
        ].join('\n'));
        const r = conv(ged);
        expect(r.stats.unsupportedTags).toBe(4);
        expect(r.stats.droppedTagSummary).toContain('TITL ×2');
        expect(r.stats.droppedTagSummary).toContain('NICK ×1');
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

    it('external OBJE file paths are counted as dropped, not imported', () => {
        const ged = GED([
            '0 @I1@ INDI', '1 NAME Jan /Novak/', '1 SEX M',
            '1 OBJE', '2 FORM jpeg', '2 FILE C:\\photos\\jan.jpg',
        ].join('\n'));
        const r = conv(ged);
        expect(Object.values(r.data.persons)[0].attachments).toBeUndefined();
        expect(r.stats.droppedTagSummary).toContain('OBJE (external file)');
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
