/**
 * Step D of the research sync: godparents, witnesses and the citations of
 * facts go to Strom Research in the GEDCOM the app sends (`researchGedcom` =
 * exportToGedcom with the research header) and come back from its tree.ged.
 * The research reads them back from exactly these lines: ASSO / _WITN with
 * RELA and NOTE under each fact of a person and a couple, 1 SOUR on INDI,
 * 2 SOUR under each fact and under MARR. Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { strings } from '../strings.js';
import { StromData, Person, PersonId, Partnership, PartnershipId, EventParticipant, LifeEvent } from '../types.js';

/** A tree.ged as the research serves it: REFNs, a baptism with godparents, a wedding with witnesses, a death with an informant. */
const TREE_GED = `0 HEAD
1 SOUR STROM-RESEARCH
1 CHAR UTF-8
1 _STROM_TREE 7d3f0c2e-1111-4222-8333-944455556666
1 _STROM_HEAD 0123456789abcdef0123456789abcdef01234567
0 @S0001@ SOUR
1 TITL Křestní matrika Čáslav 1885–1895
1 PAGE fol. 112
0 @S0002@ SOUR
1 TITL Oddací matrika Čáslav 1880–1900
1 PAGE fol. 41
0 @P0001@ INDI
1 NAME Josef /Víšek/
2 SOUR @S0002@
1 SEX M
1 REFN P0001
1 BAPM
2 DATE 4 MAR 1860
2 _WITN Marie Dvořáková
3 RELA Godparent
3 NOTE soused
2 ASSO @P0003@
3 RELA Witness
2 SOUR @S0001@
1 DEAT
2 DATE 1 JAN 1930
2 _WITN Karel Novák
3 RELA Informant
1 FAMS @F0001@
0 @P0002@ INDI
1 NAME Anna /Novotná/
1 SEX F
1 REFN P0002
1 FAMS @F0001@
0 @P0003@ INDI
1 NAME Václav /Dvořák/
1 SEX M
1 REFN P0003
0 @F0001@ FAM
1 HUSB @P0001@
1 WIFE @P0002@
1 REFN F0001
1 MARR
2 DATE 12 FEB 1885
2 PLAC Čáslav
2 ASSO @P0003@
3 RELA Witness
2 _WITN Jan Kratochvíl
3 RELA Witness
2 SOUR @S0002@
0 TRLR`;

const RESEARCH = {
    id: '7d3f0c2e-1111-4222-8333-944455556666',
    head: '0123456789abcdef0123456789abcdef01234567',
    appTree: 'tree_1_abc',
};

function importGed(text: string): StromData {
    return convertToStrom(parseGedcom(text)).data;
}

/** What the app sends to the research's /sync. */
function sendGed(data: StromData): string {
    return exportToGedcom(data, 'Víškovi', { research: RESEARCH }).content;
}

const byName = (data: StromData, first: string): Person =>
    Object.values(data.persons).find(p => p.firstName === first)!;
const union = (data: StromData): Partnership => Object.values(data.partnerships)[0];
const ofType = (p: Person, type: LifeEvent['type']): LifeEvent => p.events!.find(e => e.type === type)!;
/** Death is a field: its informant lives on the "Death record" event the import makes (the research reads it back as the death's). */
const deathRecord = (p: Person): LifeEvent => p.events!.find(e => e.customLabel === strings.gedcomNotes.deathRecord)!;
/** A participant as the research compares it: role, who (name or person) and note. */
function who(data: StromData, parts: EventParticipant[] | undefined): string[] {
    return (parts ?? []).map(pt => {
        const name = pt.personId ? `${data.persons[pt.personId].firstName} ${data.persons[pt.personId].lastName}` : pt.name;
        return `${pt.role}:${name}${pt.note ? ` (${pt.note})` : ''}`;
    }).sort();
}

/** The block of lines under one level-1 fact of one record (until the next level-1 line). */
function factBlock(ged: string, recordName: string, fact: string): string {
    const lines = ged.split('\n');
    const start = lines.findIndex((l, i) => l === `1 NAME ${recordName}` || (l.startsWith('0 ') && lines[i + 1] === `1 NAME ${recordName}`));
    expect(start).toBeGreaterThanOrEqual(0);
    let i = start + 1;
    while (i < lines.length && !lines[i].startsWith('0 ') && lines[i] !== `1 ${fact}`) i++;
    expect(lines[i]).toBe(`1 ${fact}`);
    const out = [lines[i]];
    for (i++; i < lines.length && !/^[01] /.test(lines[i]); i++) out.push(lines[i]);
    return out.join('\n');
}

/** Same, for the first FAM record. */
function marriageBlock(ged: string): string {
    const lines = ged.split('\n');
    let i = lines.findIndex(l => / FAM$/.test(l));
    while (i < lines.length && lines[i] !== '1 MARR') i++;
    const out = [lines[i]];
    for (i++; i < lines.length && !/^[01] /.test(lines[i]); i++) out.push(lines[i]);
    return out.join('\n');
}

/** The xref the sent file gives a person (ASSO points at it). */
function xrefOf(ged: string, recordName: string): string {
    const lines = ged.split('\n');
    const i = lines.indexOf(`1 NAME ${recordName}`);
    return /^0 (@[^@]+@) INDI$/.exec(lines[i - 1])![1];
}

describe('research sync: godparents, witnesses and citations (step D)', () => {
    const data = importGed(TREE_GED);

    it('reads the research tree.ged: participants on facts of a person and of the couple', () => {
        const josef = byName(data, 'Josef');
        expect(who(data, ofType(josef, 'baptism').participants))
            .toEqual(['godparent:Marie Dvořáková (soused)', 'witness:Václav Dvořák']);
        // A role the app has no name for keeps the research's word in the note.
        expect(who(data, deathRecord(josef).participants)).toEqual(['other:Karel Novák (Informant)']);
        expect(who(data, union(data).participants)).toEqual(['witness:Jan Kratochvíl', 'witness:Václav Dvořák']);
    });

    it('sends an unchanged tree back with the same participants and citations the research reads', () => {
        const ged = sendGed(data);
        const bapm = factBlock(ged, 'Josef /Víšek/', 'BAPM');
        expect(bapm).toContain('2 _WITN Marie Dvořáková\n3 RELA Godparent\n3 NOTE soused');
        expect(bapm).toContain(`2 ASSO ${xrefOf(ged, 'Václav /Dvořák/')}\n3 RELA Witness`);
        expect(bapm).toMatch(/2 SOUR @S\d+@/);
        // Informant goes out as "was there" with the word, which the research reads as the role.
        expect(factBlock(ged, 'Josef /Víšek/', 'EVEN')).toContain(
            `2 TYPE ${strings.gedcomNotes.deathRecord}\n2 DATE 1 JAN 1930\n2 _WITN Karel Novák\n3 RELA Present\n3 NOTE Informant`);
        const marr = marriageBlock(ged);
        expect(marr).toContain(`2 ASSO ${xrefOf(ged, 'Václav /Dvořák/')}\n3 RELA Witness`);
        expect(marr).toContain('2 _WITN Jan Kratochvíl\n3 RELA Witness');
        expect(marr).toMatch(/2 SOUR @S\d+@/);
        // The record citing the name comes back as a source of the person, on INDI.
        expect(ged).toMatch(/1 NAME Josef \/Víšek\/[\s\S]*?\n1 SOUR @S\d+@/);
        // ... and a second import changes nothing (no edit the research would see).
        const again = importGed(ged);
        const j = byName(again, 'Josef');
        expect(who(again, ofType(j, 'baptism').participants)).toEqual(who(data, ofType(byName(data, 'Josef'), 'baptism').participants));
        expect(who(again, deathRecord(j).participants)).toEqual(['other:Karel Novák (Informant)']);
        expect(who(again, union(again).participants)).toEqual(who(data, union(data).participants));
        expect(sendGed(again)).toBe(ged);
    });

    it('sends what the user did: a godparent added, a name linked, a role changed, one removed', () => {
        const d = structuredClone(data);
        const josef = byName(d, 'Josef');
        const vaclav = byName(d, 'Václav');
        const bapm = ofType(josef, 'baptism');
        // Added a godparent by name.
        bapm.participants!.push({ id: 'pt_new', role: 'godparent', name: 'Rozálie Víšková', note: 'teta' });
        // Linked the godmother's name to a person of the tree.
        const marie = bapm.participants!.find(p => p.name === 'Marie Dvořáková')!;
        const anna = byName(d, 'Anna');
        delete marie.name;
        marie.personId = anna.id;
        // Changed the witness's role to godparent.
        bapm.participants!.find(p => p.personId === vaclav.id)!.role = 'godparent';
        // Removed the informant.
        deathRecord(josef).participants = [];

        const ged = sendGed(d);
        const block = factBlock(ged, 'Josef /Víšek/', 'BAPM');
        expect(block).toContain('2 _WITN Rozálie Víšková\n3 RELA Godparent\n3 NOTE teta');
        expect(block).toContain(`2 ASSO ${xrefOf(ged, 'Anna /Novotná/')}\n3 RELA Godparent\n3 NOTE soused`);
        expect(block).toContain(`2 ASSO ${xrefOf(ged, 'Václav /Dvořák/')}\n3 RELA Godparent`);
        expect(block).not.toContain('Marie Dvořáková');
        expect(factBlock(ged, 'Josef /Víšek/', 'EVEN')).not.toMatch(/_WITN|ASSO/);
        // The REFNs the research pairs by stay on every record.
        expect(ged).toContain('1 REFN P0001');
        expect(ged).toContain('1 REFN P0003');
    });

    it('sends a person source and a new couple with every fact, its citations and its witnesses', () => {
        const d = structuredClone(data);
        const vaclav = byName(d, 'Václav');
        const s1 = Object.values(d.sources!).find(s => s.title.startsWith('Křestní'))!;
        const s2 = Object.values(d.sources!).find(s => s.title.startsWith('Oddací'))!;
        vaclav.sourceIds = [s1.id];
        // A new partner (no REFN) and a couple the research does not know.
        const ludmila: Person = {
            id: 'p_new_ludmila' as PersonId, firstName: 'Ludmila', lastName: 'Horká', gender: 'female',
            isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
        };
        const couple: Partnership = {
            id: 'u_new' as PartnershipId, person1Id: vaclav.id, person2Id: ludmila.id, childIds: [],
            status: 'married', startDate: '1890-06-10', startPlace: 'Kutná Hora',
            sourceIds: [s2.id],
            participants: [{ id: 'pt_w', role: 'witness', name: 'Tomáš Horký', note: 'bratr nevěsty' }],
            events: [{ id: 'ev_resi', type: 'residence', date: '1891', place: 'Čáslav', sourceIds: [s1.id],
                participants: [{ id: 'pt_r', role: 'other', name: 'Jan Kratochvíl', note: 'Informant' }] }],
        } as Partnership;
        d.persons[ludmila.id] = ludmila;
        ludmila.partnerships.push(couple.id);
        vaclav.partnerships.push(couple.id);
        d.partnerships[couple.id] = couple;

        const ged = sendGed(d);
        // The person's source on INDI.
        const vaclavRecord = ged.split('\n0 ').find(r => r.includes('1 NAME Václav /Dvořák/'))!;
        expect(vaclavRecord).toMatch(/\n1 SOUR @S\d+@/);
        // The new couple: wedding with its witness and citation, the residence with its own.
        const fam = ged.split('\n0 ').find(r => / FAM\n/.test(r) && r.includes(`1 HUSB ${xrefOf(ged, 'Václav /Dvořák/')}`))!;
        expect(fam).toContain('1 MARR\n2 DATE 10 JUN 1890');
        expect(fam).toMatch(/1 MARR[\s\S]*2 _WITN Tomáš Horký\n3 RELA Witness\n3 NOTE bratr nevěsty[\s\S]*2 SOUR @S\d+@/);
        expect(fam).toMatch(/1 RESI[\s\S]*2 _WITN Jan Kratochvíl\n3 RELA Present\n3 NOTE Informant[\s\S]*2 SOUR @S\d+@/);
        expect(fam).not.toContain('REFN');

        // And it reads back the same.
        const again = importGed(ged);
        const u = Object.values(again.partnerships).find(p => again.persons[p.person2Id]?.firstName === 'Ludmila'
            || again.persons[p.person1Id]?.firstName === 'Ludmila')!;
        expect(who(again, u.participants)).toEqual(['witness:Tomáš Horký (bratr nevěsty)']);
        expect(u.sourceIds).toHaveLength(1);
        expect(who(again, u.events![0].participants)).toEqual(['other:Jan Kratochvíl (Informant)']);
        expect(u.events![0].sourceIds).toHaveLength(1);
        expect(byName(again, 'Václav').sourceIds).toHaveLength(1);
    });
});
