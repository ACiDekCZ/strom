/**
 * The research's status of a name (spec 066 K6.3): `2 _STROM_STATUS` under
 * the primary NAME is the status of the fact `name` (Person.nameStatus),
 * under the NAME with TYPE married that gives the married surname
 * Person.marriedNameStatus; under another spelling it is not kept. Only the
 * research's or the app's own file is trusted with it. The app reads it,
 * shows it as the step of the name (pill, tree card's mark, origin row) and
 * sends it back as it came; it never works one out. Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import type { ImportRecord, Person, StromData } from '../types.js';
import {
    cardStatus, CardStatusOptions, factReliability, factStatusOf, personOriginSummary, ReliabilityOptions,
} from '../reliability.js';
import { personMarksLayout } from '../ui/fact-status.js';
import { NAME_STATUS_FEATURE, factConfirmMark, factResearchEid, factVerifyInfo, factValueSignature } from '../verify.js';

const RESEARCH_HEAD = `0 HEAD
1 SOUR STROM_RESEARCH
1 CHAR UTF-8
1 _STROM_TREE 7d3f0c2e-1111-4222-8333-944455556666
1 _STROM_HEAD 0123456789abcdef0123456789abcdef01234567`;

const PEOPLE = `0 @P0012@ INDI
1 NAME Hostivít /Šmudlák/
2 GIVN Hostivít
2 SURN Šmudlák
2 _STROM_STATUS probable
2 _STROM_EID P0012.N
1 NAME Hostiwít /Šmudlak/
2 _STROM_STATUS lead
1 SEX M
1 REFN P0012
1 BIRT
2 DATE 3 FEB 1824
2 PLAC Bramborov
2 _STROM_STATUS proven
1 FAMS @F0001@
0 @P0013@ INDI
1 NAME Zdeslava /Hrbolcová/
2 GIVN Zdeslava
2 SURN Hrbolcová
1 NAME Zdeslava /Šmudláková/
2 TYPE married
2 _STROM_STATUS possible
1 SEX F
1 REFN P0013
1 BIRT
2 DATE 9 NOV 1828
2 PLAC Hrbolcov
1 FAMS @F0001@
0 @P0014@ INDI
1 NAME Bonifác /Šmudlák/
2 _STROM_STATUS certain
1 SEX M
1 REFN P0014
1 FAMC @F0001@
0 @F0001@ FAM
1 HUSB @P0012@
1 WIFE @P0013@
1 CHIL @P0014@
0 TRLR`;

const RESEARCH_GED = `${RESEARCH_HEAD}\n${PEOPLE}`;
const FOREIGN_GED = `0 HEAD
1 SOUR MYHERITAGE
1 CHAR UTF-8
${PEOPLE}`;

const RESEARCH = {
    id: '7d3f0c2e-1111-4222-8333-944455556666',
    head: '0123456789abcdef0123456789abcdef01234567',
    appTree: 'tree_1_abc',
};

const importGed = (text: string): StromData => convertToStrom(parseGedcom(text)).data;
const sendGed = (data: StromData): string => exportToGedcom(data, 'Šmudlákovi', { research: RESEARCH }).content;
const saveGed = (data: StromData): string => exportToGedcom(data, 'Šmudlákovi').content;
const byName = (data: StromData, first: string): Person =>
    Object.values(data.persons).find(p => p.firstName === first)!;

/** The lines of a person's NAME blocks, keyed by the NAME line (level 1 and what stands under it). */
function nameBlocks(ged: string, first: string): string[][] {
    const lines = ged.split('\n');
    const out: string[][] = [];
    let inPerson = false;
    let block: string[] | null = null;
    for (const line of lines) {
        if (line.startsWith('0 ')) { inPerson = false; block = null; continue; }
        if (line.startsWith(`1 NAME ${first} `)) inPerson = true;
        if (!inPerson) continue;
        if (line.startsWith('1 ')) {
            block = line.startsWith('1 NAME ') ? [line] : null;
            if (block) out.push(block);
        } else if (block) block.push(line);
    }
    return out;
}

describe('the status of a name in the file (_STROM_STATUS under NAME)', () => {
    it('the primary name\'s is the name\'s, the married name\'s its own; another spelling\'s is not kept', () => {
        const data = importGed(RESEARCH_GED);
        const vaclav = byName(data, 'Hostivít');
        expect(vaclav.nameStatus).toBe('probable');
        expect(vaclav.marriedNameStatus).toBeUndefined();
        expect(vaclav.nameVariants).toEqual(['Hostiwít Šmudlak']);
        const anna = byName(data, 'Zdeslava');
        expect(anna.marriedSurname).toBe('Šmudláková');
        expect(anna.marriedNameStatus).toBe('possible');
        expect(anna.nameStatus).toBeUndefined();
        // A value the app does not know: nothing, and nothing in a note.
        const josef = byName(data, 'Bonifác');
        expect(josef.nameStatus).toBeUndefined();
        expect(josef.notes ?? '').not.toContain('certain');
    });

    it('another program\'s file is not trusted with it', () => {
        const data = importGed(FOREIGN_GED);
        expect(byName(data, 'Hostivít').nameStatus).toBeUndefined();
        expect(byName(data, 'Zdeslava').marriedNameStatus).toBeUndefined();
        expect(byName(data, 'Hostivít').firstName).toBe('Hostivít');
    });

    it('the status follows its name when a married name stands first', () => {
        const ged = `${RESEARCH_HEAD}
0 @P0020@ INDI
1 NAME Zdeslava /Šmudláková/
2 TYPE married
2 _STROM_STATUS proven
1 NAME Zdeslava /Bramborová/
2 TYPE birth
2 _STROM_STATUS probable
1 SEX F
0 TRLR`;
        const marie = byName(importGed(ged), 'Zdeslava');
        expect(marie.lastName).toBe('Bramborová');
        expect(marie.nameStatus).toBe('probable');
        expect(marie.marriedSurname).toBe('Šmudláková');
        expect(marie.marriedNameStatus).toBe('proven');
    });

    it('goes back under its own NAME as it came, to the research and in a saved file, with no change on the way', () => {
        const first = importGed(RESEARCH_GED);
        const sent = sendGed(first);
        const vaclav = nameBlocks(sent, 'Hostivít');
        expect(vaclav[0]).toContain('2 _STROM_STATUS probable');
        expect(vaclav.slice(1).flat()).not.toContain('2 _STROM_STATUS lead');
        const anna = nameBlocks(sent, 'Zdeslava');
        expect(anna[0].filter(l => l.includes('_STROM_STATUS'))).toEqual([]);
        expect(anna[1]).toEqual(expect.arrayContaining(['2 TYPE married', '2 _STROM_STATUS possible']));
        expect(sent).not.toContain('certain');
        const again = importGed(sent);
        expect(byName(again, 'Hostivít').nameStatus).toBe('probable');
        expect(byName(again, 'Zdeslava').marriedNameStatus).toBe('possible');
        // The name's id is the research's own: the app's file read back does not carry it (as an event's id).
        expect(sendGed(again)).toBe(sent.replace('2 _STROM_EID P0012.N\n', ''));
        // The app's own file keeps it too (read back as the app's).
        const saved = saveGed(first);
        expect(nameBlocks(saved, 'Hostivít')[0]).toContain('2 _STROM_STATUS probable');
        const back = importGed(saved);
        expect(byName(back, 'Hostivít').nameStatus).toBe('probable');
        expect(byName(back, 'Zdeslava').marriedNameStatus).toBe('possible');
    });

    it('an older app skips a sub-tag under NAME it does not know, and loses nothing of the name (R6)', () => {
        // What 3.31 did with _STROM_STATUS under NAME: a sub-tag it did not read.
        const ged = `${RESEARCH_HEAD}
0 @P0030@ INDI
1 NAME Hostivít /Šmudlák/
2 GIVN Hostivít
2 SURN Šmudlák
2 _STROM_FUTURE_MARK proven
3 _TXT 3f9a0c1d2e4b5a69
1 SEX M
1 BIRT
2 DATE 3 FEB 1824
0 TRLR`;
        const result = convertToStrom(parseGedcom(ged));
        const vaclav = byName(result.data, 'Hostivít');
        expect(vaclav.firstName).toBe('Hostivít');
        expect(vaclav.lastName).toBe('Šmudlák');
        expect(vaclav.birthDate).toBe('1824-02-03');
        expect(vaclav.nameStatus).toBeUndefined();
        expect(vaclav.notes ?? '').toBe('');
        expect(vaclav.nameVariants).toBeUndefined();
    });

    it('the bridge\'s word for it', () => {
        expect(NAME_STATUS_FEATURE).toBe('name-status');
    });
});

describe('the step of a name with a status (066 K6.3)', () => {
    const I1: ImportRecord = { id: 'I1', program: 'MyHeritage', fileDate: '12 MAR 2025', at: '2026-10-14' };
    const RESEARCH_OPTS: ReliabilityOptions = { researchTree: true, originFeature: true };
    const SOURCES = {
        sN: { id: 'sN', title: 'Matrika N Bramborov 1820–1840', quality: 3 },
        sZ: { id: 'sZ', title: 'Matrika Z Bramborov 1884–1899', quality: 3 },
    };
    const vaclav = (extra: Partial<Person> = {}): Person => ({
        id: 'p1', firstName: 'Hostivít', lastName: 'Šmudlák', gender: 'male',
        parentIds: [], childIds: [], partnerships: [],
        birthDate: '1824-02-03', deathDate: '1890-09-17',
        researchOrigins: {
            name: { kind: 'import', importId: 'I1' }, birth: { kind: 'import', importId: 'I1' }, death: { kind: 'import', importId: 'I1' },
        },
        ...extra,
    }) as unknown as Person;
    const tree = (p: Person): StromData => ({
        persons: { [p.id]: p }, partnerships: {}, imports: [I1], sources: SOURCES,
    }) as unknown as StromData;

    it('factStatusOf reads the name\'s status', () => {
        expect(factStatusOf(vaclav({ nameStatus: 'probable' }), 'name')).toBe('probable');
        expect(factStatusOf(vaclav(), 'name')).toBeUndefined();
        // The married name's is not the name's.
        expect(factStatusOf(vaclav({ marriedNameStatus: 'proven' }), 'name')).toBeUndefined();
    });

    it('each row of the table: from the family tree, probable, possible, proven, confirmed', () => {
        const step = (p: Person, opts: ReliabilityOptions = RESEARCH_OPTS) => {
            const r = factReliability(tree(p), p, 'name', opts);
            return r ? { step: r.step, dots: r.dots, fromImport: r.fromImport } : null;
        };
        expect(step(vaclav())).toEqual({ step: 'import', dots: undefined, fromImport: undefined });
        expect(step(vaclav({ nameStatus: 'lead' }))).toEqual({ step: 'import', dots: undefined, fromImport: undefined });
        expect(step(vaclav({ nameStatus: 'probable' }))).toEqual({ step: 'probable', dots: undefined, fromImport: true });
        expect(step(vaclav({ nameStatus: 'possible' }))).toEqual({ step: 'possible', dots: undefined, fromImport: true });
        expect(step(vaclav({ nameStatus: 'proven' }))).toEqual({ step: 'proven', dots: 1, fromImport: true });
        expect(step(vaclav({ nameStatus: 'proven' }), { ...RESEARCH_OPTS, evidence: () => ({ readers: 2 }) }))
            .toEqual({ step: 'proven', dots: 2, fromImport: true });
        expect(step(vaclav({ nameStatus: 'probable' }), { ...RESEARCH_OPTS, evidence: () => ({ confirmedByHuman: true }) }))
            .toEqual({ step: 'human', dots: undefined, fromImport: true });
        // The research's own name with a lead: a lead.
        expect(step(vaclav({ nameStatus: 'lead', researchOrigins: { name: { kind: 'research' } } })))
            .toEqual({ step: 'lead', dots: undefined, fromImport: undefined });
    });

    it('the tree card: Hostivít with a probable name read from the register beside a proven birth and death is ●○ by the name', () => {
        const p = vaclav({ nameStatus: 'probable', sourceIds: ['sN'], birthStatus: 'proven', deathStatus: 'proven', birthSourceIds: ['sN'], deathSourceIds: ['sZ'] });
        const opts: CardStatusOptions = { ...RESEARCH_OPTS, treeHasSources: true };
        expect(cardStatus(tree(p), p, opts)).toMatchObject({ cls: 'cs-p1', step: { step: 'probable' }, facts: ['name'] });
        // Proven: ●● by all three.
        const proven = vaclav({ nameStatus: 'proven', sourceIds: ['sN'], birthStatus: 'proven', deathStatus: 'proven' });
        expect(cardStatus(tree(proven), proven, opts)).toMatchObject({ cls: 'cs-p2', facts: ['name', 'birth', 'death'] });
        // No status (an older research): the name from the family tree holds the mark, as before.
        const old = vaclav({ sourceIds: ['sN'], birthStatus: 'proven', deathStatus: 'proven' });
        expect(cardStatus(tree(old), old, opts)).toMatchObject({ cls: 'cs-import', facts: ['name'] });
    });

    it('the origin row: history once no fact is from the family tree alone, "marked" while one is', () => {
        const row = (p: Person) => personMarksLayout(personOriginSummary(tree(p), p, RESEARCH_OPTS));
        const sex = { sex: { kind: 'research' as const } };
        const history = row(vaclav({ nameStatus: 'proven', birthStatus: 'proven', deathStatus: 'probable',
            researchOrigins: { ...vaclav().researchOrigins, ...sex } }));
        expect(history.atFacts).toBe(true);
        expect(history.row?.step).toBeUndefined();
        expect(history.row?.text).toBe('This person\'s facts came from MyHeritage (file 12 Mar 2025, loaded 14 Oct 2026); none is from the family tree alone any more.');
        // The death still from the family tree alone: the row as before.
        const mixed = row(vaclav({ nameStatus: 'probable', birthStatus: 'proven', researchOrigins: { ...vaclav().researchOrigins, ...sex } }));
        expect(mixed.atFacts).toBe(true);
        expect(mixed.row?.text).toMatch(/^Facts marked “from family tree” come from MyHeritage/);
    });
});

describe('the name\'s id and confirmation in the file (_STROM_EID under NAME, 066 K6.3)', () => {
    const NAMED_GED = `${RESEARCH_HEAD}
0 @P0012@ INDI
1 NAME Hostivít /Šmudlák/
2 GIVN Hostivít
2 SURN Šmudlák
2 _STROM_STATUS probable
2 _STROM_EID P0012.N
3 _TXT 3F9A0C1D2E4B5A69
2 _STROM_CONFIRMED 2026-11-21
1 NAME Hostiwít /Šmudlak/
2 _STROM_EID P0012.N2
1 SEX M
1 REFN P0012
1 BIRT
2 DATE 3 FEB 1824
2 _STROM_EID P0012.B
0 TRLR`;

    it('the primary name\'s id, its mark and confirmation are read; another name\'s id is not, a birth\'s only as "E…"', () => {
        const vaclav = byName(importGed(NAMED_GED), 'Hostivít');
        expect(factResearchEid(vaclav, 'name')).toBe('P0012.N');
        expect(vaclav.researchVerify?.name).toMatchObject({ eid: 'P0012.N', txt: '3f9a0c1d2e4b5a69', confirmed: '2026-11-21' });
        expect(factConfirmMark(vaclav, 'name')).toBe('3f9a0c1d2e4b5a69');
        expect(factVerifyInfo(vaclav, 'name')).toMatchObject({ confirmed: '2026-11-21', confirmedBy: 'research' });
        expect(vaclav.researchVerify?.birth).toBeUndefined();
        expect(JSON.stringify(vaclav.researchVerify)).not.toContain('P0012.N2');
        // A new given name: the mark no longer stands for what the name says.
        vaclav.firstName = 'Hostimil';
        expect(factConfirmMark(vaclav, 'name')).toBe('changed');
    });

    it('goes back under its NAME only to the research, and the round trip changes nothing', () => {
        const first = importGed(NAMED_GED);
        const sent = sendGed(first);
        expect(nameBlocks(sent, 'Hostivít')[0]).toEqual(expect.arrayContaining(['2 _STROM_EID P0012.N', '2 _STROM_CONFIRMED 2026-11-21']));
        expect(nameBlocks(sent, 'Hostivít')[1]).not.toContain('2 _STROM_EID P0012.N2');
        // Stored and loaded (migrateData), the tree sends the same.
        const again = migrateData(JSON.parse(JSON.stringify(first)));
        expect(factResearchEid(byName(again, 'Hostivít'), 'name')).toBe('P0012.N');
        expect(sendGed(again)).toBe(sent);
        // A saved file of the app's own: no id of the research.
        expect(saveGed(first)).not.toContain('_STROM_EID');
    });

    it('a tree without the research: the app\'s own confirmation of the name goes under NAME (`_STROM_CONFIRMED`)', () => {
        const data = importGed(FOREIGN_GED);
        const vaclav = byName(data, 'Hostivít');
        vaclav.confirmed = { name: { at: '2026-11-21', value: factValueSignature(vaclav, 'name') } };
        expect(nameBlocks(saveGed(data), 'Hostivít')[0]).toContain('2 _STROM_CONFIRMED 2026-11-21');
        const back = byName(importGed(saveGed(data)), 'Hostivít');
        expect(factVerifyInfo(back, 'name')).toMatchObject({ confirmed: '2026-11-21', confirmedBy: 'app' });
    });
});
