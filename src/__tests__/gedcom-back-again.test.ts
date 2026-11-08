/**
 * Strom's "Back to {program}" file read into Strom again and sent back once
 * more gives the same file (spec 066): import → "Back to" → import of that
 * file → "Back to". The file has the structures MyHeritage Family Tree Builder
 * writes (fictional people, test/fixtures/gedcom/myheritage-ftb.ged).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { applyLivingPrivacy, CONTENT_PRESETS } from '../privacy.js';
import { StromData } from '../types.js';

const FILE = readFileSync(join(process.cwd(), 'test', 'fixtures', 'gedcom', 'myheritage-ftb.ged'), 'utf-8');

const load = (text: string, file: string): StromData =>
    migrateData(convertToStrom(parseGedcom(text), { importOrigin: { at: '2026-11-08', file, encoding: 'utf-8' } }).data);

const backTo = (data: StromData): string =>
    exportToGedcom(applyLivingPrivacy(data, 'full', 2026, { keepDeceasedSources: true }), 'Ozubec',
        { content: CONTENT_PRESETS.back, origins: true, backTo: data.imports![0].id }).content;

/** The file without the date of the export in its header. */
const undated = (ged: string): string => ged.replace(/^(0 HEAD\n(?:[1-9].*\n)*?)1 DATE [^\n]*\n/, '$1');

/** The level-1 blocks of a tag, each as its lines joined. */
function blocks(ged: string, head: RegExp): string[] {
    const out: string[] = [];
    let cur: string[] | null = null;
    for (const line of ged.split('\n')) {
        if (/^[01] /.test(line)) {
            if (cur) out.push(cur.join('\n'));
            cur = head.test(line) ? [line] : null;
        } else if (cur) cur.push(line);
    }
    if (cur) out.push(cur.join('\n'));
    return out;
}

describe('"Back to" read again (066)', () => {
    const first = backTo(load(FILE, 'myheritage-ftb.ged'));
    const again = load(first, 'myheritage-ftb-back.ged');
    const second = backTo(again);

    it('keeps the other program\'s picture links, with _DATE and its own lines', () => {
        const links = blocks(first, /^1 OBJE$/);
        expect(links).toHaveLength(3);
        expect(links.join('\n')).toContain('2 _PHOTO_RIN MH:P1');
        expect(links.join('\n')).toContain('2 _DATE 12 MAY 1905');
        expect(blocks(second, /^1 OBJE$/)).toEqual(links);
        // The file read again is Strom's own: no second import of it.
        expect(again.imports).toHaveLength(1);
    });

    it('the second "Back to" is the first, byte for byte but the export date', () => {
        expect(undated(second)).toBe(undated(first));
    });
});

describe('A citation\'s own lines Strom does not read (066)', () => {
    const tree = load(FILE, 'myheritage-ftb.ged');
    const back = backTo(tree);

    it('"Back to" writes QUAY, DATA > TEXT and EVEN > ROLE under the citation without a PAGE', () => {
        expect(back).toContain([
            '1 SOUR @S2@',
            '2 DATA',
            '3 TEXT Libuna Šťovíková, born in Mechovka, daughter of the smith',
            '4 CONC  of Mechovka, married in Ozubcov',
            '2 QUAY 3',
            '2 EVEN BIRT',
            '3 ROLE CHIL',
        ].join('\n'));
    });

    it('…and under a citation with its PAGE, the entry\'s date beside its text', () => {
        expect(back).toContain([
            '2 SOUR @S1@',
            '3 PAGE fol. 12',
            '3 DATA',
            '4 DATE 4 MAR 1880',
            '4 TEXT Hromoslav, son of the miller',
            '3 QUAY 3',
            '3 EVEN BIRT',
            '4 ROLE CHIL',
        ].join('\n'));
        // A page cited without them gets none of them.
        expect(back).toMatch(/3 PAGE fol\. 88\n3 DATA\n4 DATE 10 JAN 1950\n3 QUAY 2\n2 _STROM_IMPORT/);
        expect(back).not.toContain('_STROM_CITE');
    });

    it('Strom\'s own export leaves them out, as another program\'s own tags', () => {
        const own = exportToGedcom(tree, 'Ozubec').content;
        expect(own).not.toContain('ROLE CHIL');
        expect(own).not.toContain('son of the miller');
        expect(own).not.toContain('_STROM_CITE');
    });
});


describe('What the import wrote into a note goes back as the other program wrote it (066)', () => {
    const tree = load(FILE, 'myheritage-ftb.ged');
    const back = backTo(tree);
    const again = load(back, 'myheritage-ftb-back.ged');
    const second = backTo(again);
    const byXref = (xref: string) => Object.values(tree.persons).find(p => p.originalIds?.some(e => e.xref === xref))!;

    it('"Back to" writes NCHI, PUBL and an event\'s NOTE in their place, not as lines of the record\'s note', () => {
        expect(back).toMatch(/\n1 NCHI 3\n/);
        expect(back).toContain('1 BIRT\n2 NOTE Born at the mill, says the family.\n');
        // Under the event Strom writes with its date and place.
        expect(back).toMatch(/1 BIRT\n2 DATE 1910\n2 PLAC Ozubcov\n2 NOTE A twin, the other died young\.\n/);
        expect(back).toMatch(/1 MARR\n2 DATE 1905\n[^]*?2 NOTE Married in the old chapel,\n3 CONT the banns read three times\.\n2 _STROM_IMPORT/);
        expect(back).toContain('1 TITL Parish register Ozubcov\n1 AUTH Ozubcov parish office\n1 PUBL Ozubcov 1880\n');
        expect(back).not.toMatch(/Number of children|Publication:|Birth:|1 NOTE Married|_STROM_NOTED/);
    });

    it('the tree and Strom\'s own export keep them as lines of the note', () => {
        expect(byXref('I1').notes).toContain('Number of children: 3');
        expect(byXref('I3').notes).toContain('Born at the mill, says the family.');
        const own = exportToGedcom(tree, 'Ozubec').content;
        expect(own).toContain('1 NOTE Number of children: 3');
        expect(own).toContain('Publication: Ozubcov 1880');
        expect(own).toContain('1 NOTE Married in the old chapel,');
        expect(own).not.toMatch(/\n1 NCHI|\n1 PUBL|_STROM_NOTED/);
    });

    it('the file read again has each once, and the next "Back to" equals the first', () => {
        const i1 = Object.values(again.persons).find(p => p.originalIds?.some(e => e.xref === 'I1'))!;
        expect(i1.notes?.match(/Number of children/g)).toHaveLength(1);
        expect(undated(second)).toBe(undated(back));
    });

    it('a line of the note changed in the tree stays in the note, its structure is not written', () => {
        const edited = structuredClone(tree);
        const i1 = Object.values(edited.persons).find(p => p.originalIds?.some(e => e.xref === 'I1'))!;
        i1.notes = i1.notes!.replace('Number of children: 3', 'Number of children: 4');
        const out = backTo(edited);
        expect(out).toContain('Number of children: 4');
        expect(out).not.toMatch(/\n1 NCHI/);
        // The other structures still go back.
        expect(out).toContain('1 BIRT\n2 NOTE Born at the mill, says the family.\n');
    });
});

describe('A level-1 citation of a person and of a family with a bare EVEN (066 N3)', () => {
    const file = [
        '0 HEAD', '1 SOUR MYHERITAGE', '2 NAME MyHeritage Family Tree Builder', '2 VERS 5.5.1',
        '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Drnohor /Klepetec/', '1 SEX M', '1 FAMS @F1@',
        '1 SOUR @S1@', '2 QUAY 3', '2 DATA', '3 TEXT Drnohor, son of the cooper', '4 CONC  of Zvonečkov', '2 EVEN', '3 ROLE CHIL',
        '0 @I2@ INDI', '1 NAME Mrkvoslava /Klepetcová/', '1 SEX F', '1 FAMS @F1@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@',
        '1 SOUR @S1@', '2 QUAY 2', '2 DATA', '3 TEXT The couple named in the banns', '2 EVEN', '3 ROLE HUSB',
        '0 @S1@ SOUR', '1 TITL Register Zvonečkov',
        '0 TRLR', '',
    ].join('\n');
    const back = backTo(load(file, 'klepetec.ged'));

    it('"Back to" keeps QUAY, DATA > TEXT (with CONC) and the bare EVEN > ROLE of both', () => {
        expect(back).toContain('1 SOUR @S1@\n2 DATA\n3 TEXT Drnohor, son of the cooper\n4 CONC  of Zvonečkov\n2 QUAY 3\n2 EVEN\n3 ROLE CHIL\n');
        expect(back).toContain('1 SOUR @S1@\n2 DATA\n3 TEXT The couple named in the banns\n2 QUAY 2\n2 EVEN\n3 ROLE HUSB\n');
    });
});
