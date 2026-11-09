/**
 * The re-verification tags under a fact in GEDCOM (spec 065):
 * `_STROM_CONFIRMED`, `_STROM_VERIFY`, `_STROM_CHECKED` (+ `3 DATE`, `_WHY`,
 * `_READERS`). The research's file gives its state per fact without touching
 * the fact itself; the app's own export writes a confirmation and reads it
 * back; another program's file and what goes to the research carry none.
 */
import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { StromData, Person, Partnership } from '../types.js';
import {
    factVerifyInfo, factValueSignature, factResearchEid, factPendingPosition, personResearchRef, familyResearchRef,
    confirmationEdits, handedConfirmations,
} from '../verify.js';
import { migrateData } from '../data.js';
import { contentFingerprint } from '../research-link.js';

const RESEARCH_FILE = `0 HEAD
1 SOUR STROM_RESEARCH
2 VERS 1.30.0
2 NAME Strom Research
1 DATE 8 NOV 2026
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Hromoslav /Ozubec/
1 SEX M
2 _STROM_CONFIRMED 2026-10-02
1 BIRT
2 DATE 3 MAR 1850
2 _STROM_CONFIRMED 2026-11-08
2 PLAC Kvasilov
1 CHR
2 DATE 5 MAR 1850
2 _STROM_CHECKED kept
3 DATE 1 NOV 2026
3 _WHY The register gives the day of baptism only;
4 CONC  the birth day is inferred.
4 CONT Second line.
2 PLAC Kvasilov
1 DEAT
2 DATE 1910
2 _STROM_VERIFY asked
1 BURI
2 DATE 12 JAN 1910
2 _STROM_CHECKED proven
3 DATE 2 NOV 2026
3 _READERS 2
1 FAMS @F1@
0 @I2@ INDI
1 NAME Libuna /Šťovíková/
1 SEX F
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 2 MAY 1875
2 _STROM_VERIFY permission
2 PLAC Úlehle
0 TRLR
`;

function load(text: string): StromData {
    return convertToStrom(parseGedcom(text)).data;
}

function person(data: StromData, first: string): Person {
    return Object.values(data.persons).find(p => p.firstName === first)!;
}

function couple(data: StromData): Partnership {
    return Object.values(data.partnerships)[0];
}

function eventFact(p: Person, type: string): string {
    return `event:${p.events!.find(e => e.type === type)!.id}`;
}

describe("the research's file", () => {
    const data = load(RESEARCH_FILE);
    const h = person(data, 'Hromoslav');

    it('gives each fact its state', () => {
        // Each confirmation with the value it holds for (a change here ends it).
        expect(h.researchVerify?.birth).toEqual({ confirmed: '2026-11-08', value: factValueSignature(h, 'birth') });
        expect(factValueSignature(h, 'birth')).toBe('1850-03-03\u001fKvasilov');
        expect(h.researchVerify?.sex).toEqual({ confirmed: '2026-10-02', value: 'male' });
        expect(h.researchVerify?.death).toEqual({ pending: 'asked' });
        expect(h.researchVerify?.[eventFact(h, 'baptism')]).toEqual({
            checked: {
                result: 'kept', date: '2026-11-01',
                why: 'The register gives the day of baptism only; the birth day is inferred.\nSecond line.',
            },
        });
        expect(h.researchVerify?.[eventFact(h, 'burial')]).toEqual({ checked: { result: 'proven', date: '2026-11-02', readers: 2 } });
        expect(couple(data).researchVerify).toEqual({ marriage: { pending: 'permission' } });
        // Not a confirmation of the app's own.
        expect(h.confirmed).toBeUndefined();
    });

    it('leaves the facts as they are (a 3 DATE under the check is not the fact date)', () => {
        expect(h.birthDate).toBe('1850-03-03');
        expect(h.birthPlace).toBe('Kvasilov');
        const bap = h.events!.find(e => e.type === 'baptism')!;
        expect(bap.date).toBe('1850-03-05');
        expect(bap.place).toBe('Kvasilov');
        expect(bap.note).toBeUndefined();
        expect(h.events!.find(e => e.type === 'burial')!.date).toBe('1910-01-12');
        expect(couple(data).startDate).toBe('1875-05-02');
        expect(couple(data).startPlace).toBe('Úlehle');
    });

    it('counts none of the tags as unsupported', () => {
        const result = convertToStrom(parseGedcom(RESEARCH_FILE));
        expect(result.stats.droppedTagSummary).not.toMatch(/_STROM_(CONFIRMED|VERIFY|CHECKED)|_WHY|_READERS/);
    });

    it('the tree is the one without the tags, apart from the state (sync sees no change)', () => {
        const plain = load(RESEARCH_FILE.split('\n').filter(l => !/_STROM_(CONFIRMED|VERIFY|CHECKED)|^3 |^4 /.test(l)).join('\n'));
        // Ids are made fresh on every load: compare by the shape with them named in order.
        const shape = (d: StromData): string => {
            const ids = new Map<string, string>();
            const json = JSON.stringify({ persons: d.persons, partnerships: d.partnerships }, (k, v) => (k === 'researchVerify' ? undefined : v));
            return json.replace(/"(p|u|ev|ce|i|f)_[A-Za-z0-9_]+"/g, m => { if (!ids.has(m)) ids.set(m, `"#${ids.size}"`); return ids.get(m)!; });
        };
        expect(shape(data)).toBe(shape(plain));
        expect(contentFingerprint(data)).toBe(contentFingerprint(JSON.parse(JSON.stringify(data, (k, v) => (k === 'researchVerify' ? undefined : v)))));
    });

    it('a family written twice keeps the first record', () => {
        const twice = RESEARCH_FILE.replace('0 TRLR', `0 @F2@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 2 MAY 1875
2 _STROM_VERIFY wait
0 TRLR`);
        const d = load(twice);
        const marriages = Object.values(d.partnerships).map(ps => ps.researchVerify?.marriage?.pending);
        expect(marriages).toContain('permission');
    });

    it('drops what is not valid', () => {
        const odd = RESEARCH_FILE
            .replace('2 _STROM_VERIFY asked', '2 _STROM_VERIFY someday')
            .replace('3 _READERS 2', '3 _READERS many')
            .replace('2 _STROM_CONFIRMED 2026-11-08', '2 _STROM_CONFIRMED whenever');
        const d = load(odd);
        const p = person(d, 'Hromoslav');
        expect(p.researchVerify?.death).toBeUndefined();
        expect(p.researchVerify?.birth).toBeUndefined();
        expect(p.researchVerify?.[eventFact(p, 'burial')]).toEqual({ checked: { result: 'proven', date: '2026-11-02' } });
    });
});

describe("a fact the research's file writes twice (records it joined)", () => {
    const head = RESEARCH_FILE.slice(0, RESEARCH_FILE.indexOf('0 @I1@ INDI'));
    const file = (fam: string, indi = ''): string => `${head}0 @I1@ INDI
1 NAME Hromoslav /Ozubec/
1 SEX M
${indi}1 FAMS @F1@
0 @I2@ INDI
1 NAME Libuna /Šťovíková/
1 SEX F
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
${fam}0 TRLR
`;
    /** The family's lines of the file going to the research, without the partners. */
    const sentFamily = (d: StromData): string[] => {
        const ged = exportToGedcom(d, 'Ozubec', { research: { id: 'r1', head: 'abc' } } as never).content;
        const block = ged.split(/\r?\n(?=0 )/).find(b => /^0 @F\d+@ FAM/.test(b))!;
        return block.split(/\r?\n/).slice(1).filter(l => !/^1 (HUSB|WIFE) /.test(l));
    };

    it("two weddings: the re-verification, id and origin are the first's, whose date and place the couple has", () => {
        const d = load(file(`1 MARR
2 _STROM_EID E0066
2 DATE 1 APR 1911
2 PLAC Drnkalov
2 _STROM_CONFIRMED 2026-11-01
2 _STROM_ORIGIN import R1
1 MARR
2 _STROM_EID E0068
2 DATE 4 JUL 1914
2 PLAC Hrbolcov
2 _STROM_VERIFY asked
3 _POS 2
2 _STROM_ORIGIN user
`));
        const c = couple(d);
        expect([c.startDate, c.startPlace]).toEqual(['1911-04-01', 'Drnkalov']);
        expect(c.researchVerify?.marriage).toEqual({ confirmed: '2026-11-01', value: factValueSignature(c, 'marriage'), eid: 'E0066' });
        expect(factResearchEid(c, 'marriage')).toBe('E0066');
        expect(c.researchOrigins?.marriage?.kind).toBe('import');
    });

    it('the first wedding without a date: the couple has none of the second (date, place, age), and it goes back as it was', () => {
        const d = load(file(`1 MARR
2 _STROM_EID E0073
2 PLAC Hrbolcov
2 _STROM_STATUS lead
1 MARR
2 _STROM_EID E0074
2 DATE 12 MAY 1920
2 PLAC Drnkalov
2 HUSB
3 AGE 30y
2 _STROM_STATUS proven
2 _STROM_CHECKED kept
3 DATE 1 NOV 2026
`));
        const c = couple(d);
        expect(c.status).toBe('married');
        expect([c.startDate, c.startPlace, c.startStatus]).toEqual([undefined, 'Hrbolcov', 'lead']);
        expect(c.ages).toBeUndefined();
        expect(c.note).toBeUndefined();
        expect(c.researchVerify?.marriage).toEqual({ eid: 'E0073' });
        // The first goes back as the research has it, with its id; the second is
        // the research's own (a further wedding missing from the file is the shape
        // of the app's union there), never mixed into the first.
        expect(sentFamily(d)).toEqual(['1 MARR', '2 PLAC Hrbolcov', '2 _STROM_STATUS lead', '2 _STROM_EID E0073']);
    });

    it('two divorces: the divorce is the first one, with its id', () => {
        const d = load(file(`1 MARR
2 DATE 1900
1 DIV
2 _STROM_EID E0010
2 DATE 1905
2 PLAC Drnkalov
1 DIV
2 _STROM_EID E0011
2 DATE 1906
2 PLAC Hrbolcov
2 _STROM_VERIFY asked
`));
        const c = couple(d);
        expect([c.status, c.endDate, c.endPlace]).toEqual(['divorced', '1905', 'Drnkalov']);
        expect(c.researchVerify?.divorce).toEqual({ eid: 'E0010' });
        expect(sentFamily(d)).toEqual(['1 MARR', '2 DATE 1900', '1 DIV', '2 DATE 1905', '2 PLAC Drnkalov', '2 _STROM_EID E0010']);
    });

    it('a person with two births: the birth is the first, the other an event with its own id', () => {
        const d = load(file('', `1 BIRT
2 _STROM_EID E0001
2 DATE 1850
2 PLAC Kvasilov
1 BIRT
2 _STROM_EID E0002
2 DATE 1851
2 PLAC Úlehle
2 _STROM_VERIFY asked
`));
        const h = person(d, 'Hromoslav');
        expect([h.birthDate, h.birthPlace]).toEqual(['1850', 'Kvasilov']);
        expect(h.researchVerify?.birth).toEqual({ eid: 'E0001' });
        const alt = h.events!.find(e => e.date === '1851')!;
        expect(h.researchVerify?.[`event:${alt.id}`]).toEqual({ pending: 'asked', eid: 'E0002' });
    });

    it('an empty wedding ahead of the dated one (MyHeritage): the wedding is the dated one, its date, place, id and state, and it goes back so', () => {
        const d = load(file(`1 MARR Y
2 _STROM_EID E0080
1 MARR
2 _STROM_EID E0081
2 DATE 12 MAY 1920
2 PLAC Drnkalov
2 _STROM_CONFIRMED 2026-11-02
`));
        const c = couple(d);
        expect([c.status, c.startDate, c.startPlace]).toEqual(['married', '1920-05-12', 'Drnkalov']);
        expect(c.researchVerify?.marriage).toEqual({ confirmed: '2026-11-02', value: factValueSignature(c, 'marriage'), eid: 'E0081' });
        expect(sentFamily(d)).toEqual(['1 MARR', '2 DATE 12 MAY 1920', '2 PLAC Drnkalov', '2 _STROM_CONFIRMED 2026-11-02', '2 _STROM_EID E0081']);
    });

    it('an empty divorce ahead of the dated one: the divorce is the dated one', () => {
        const d = load(file(`1 MARR
2 DATE 1900
1 DIV Y
2 _STROM_EID E0090
1 DIV
2 _STROM_EID E0091
2 DATE 1905
2 PLAC Hrbolcov
`));
        const c = couple(d);
        expect([c.status, c.endDate, c.endPlace]).toEqual(['divorced', '1905', 'Hrbolcov']);
        expect(c.researchVerify?.divorce).toEqual({ eid: 'E0091' });
    });

    it("another program's file (MyHeritage): an empty wedding ahead of the dated one gives the couple the date and the place", () => {
        const other = file(`1 MARR
1 MARR
2 DATE 12 MAY 1920
2 PLAC Drnkalov
`).replace('1 SOUR STROM_RESEARCH', '1 SOUR MYHERITAGE').replace('2 NAME Strom Research', '2 NAME MyHeritage Family Tree Builder');
        const c = couple(load(other));
        expect([c.status, c.startDate, c.startPlace]).toEqual(['married', '1920-05-12', 'Drnkalov']);
    });

    it("another program's file keeps reading a second wedding's date where the first has none", () => {
        const other = file(`1 MARR
2 PLAC Hrbolcov
1 MARR
2 DATE 12 MAY 1920
`).replace('1 SOUR STROM_RESEARCH', '1 SOUR OTHERPROG').replace('2 NAME Strom Research', '2 NAME Other');
        expect(couple(load(other)).startDate).toBe('1920-05-12');
    });
});

describe("another program's file", () => {
    it('reads none of it', () => {
        const foreign = RESEARCH_FILE.replace('1 SOUR STROM_RESEARCH\n2 VERS 1.30.0\n2 NAME Strom Research', '1 SOUR FTM\n2 VERS 24');
        const d = load(foreign);
        const p = person(d, 'Hromoslav');
        expect(p.researchVerify).toBeUndefined();
        expect(p.confirmed).toBeUndefined();
        expect(p.birthDate).toBe('1850-03-03');
    });
});

describe("the app's own GEDCOM export", () => {
    function confirmedTree(): StromData {
        const d = load(RESEARCH_FILE.replace('1 SOUR STROM_RESEARCH\n2 VERS 1.30.0\n2 NAME Strom Research', '1 SOUR STROM\n2 VERS 3.26.0'));
        const p = person(d, 'Hromoslav');
        p.confirmed = { death: { at: '2026-11-07', value: factValueSignature(p, 'death') } };
        const ps = couple(d);
        ps.confirmed = { marriage: { at: '2026-11-06', value: factValueSignature(ps, 'marriage') } };
        return d;
    }

    it('writes the confirmation under the fact and reads it back as the tree’s own', () => {
        const d = confirmedTree();
        const ged = exportToGedcom(d, 'Ozubec', { origins: true, confirmations: true }).content;
        expect(ged).toMatch(/1 DEAT[^]*?2 _STROM_CONFIRMED 2026-11-07/);
        expect(ged).toMatch(/1 MARR[^]*?2 _STROM_CONFIRMED 2026-11-06/);
        expect(ged).not.toMatch(/_STROM_VERIFY|_STROM_CHECKED/);
        const back = load(ged);
        const p = person(back, 'Hromoslav');
        expect(factVerifyInfo(p, 'death')).toEqual({ confirmed: '2026-11-07', confirmedBy: 'app' });
        expect(factVerifyInfo(couple(back), 'marriage')).toEqual({ confirmed: '2026-11-06', confirmedBy: 'app' });
        expect(p.researchVerify).toBeUndefined();
        // A second round trip gives the same file.
        expect(exportToGedcom(back, 'Ozubec', { origins: true, confirmations: true }).content
            .replace(/^1 DATE .*$/m, '')).toBe(ged.replace(/^1 DATE .*$/m, ''));
    });

    it('a confirmation no longer valid is not written', () => {
        const d = confirmedTree();
        person(d, 'Hromoslav').deathDate = '1911';
        const ged = exportToGedcom(d, 'Ozubec', { origins: true, confirmations: true }).content;
        expect(ged).not.toMatch(/1 DEAT[^]*?2 _STROM_CONFIRMED 2026-11-07/);
    });

    it('none in a file "Back to {prog}" or without the option', () => {
        const d = confirmedTree();
        d.imports = [{ id: 'R1', file: 'ozubec.ged', program: 'FTM', at: '2026-11-01' } as never];
        expect(exportToGedcom(d, 'Ozubec', { origins: true, confirmations: true, backTo: 'R1' }).content).not.toContain('_STROM_CONFIRMED');
        expect(exportToGedcom(d, 'Ozubec', { confirmations: false }).content).not.toContain('_STROM_CONFIRMED');
    });
});

describe('confirmations handed over to the research (read against _STROM_HEAD)', () => {
    const LINK = { id: 'r1', head: 'a'.repeat(40) };
    /** What the research's file gave: SEX, BIRT, BURI and MARR confirmed there. */
    const CONFIRMED_FILE = RESEARCH_FILE
        .replace('1 BURI\n2 DATE 12 JAN 1910', '1 BURI\n2 DATE 12 JAN 1910\n2 _STROM_CONFIRMED 2026-10-03')
        .replace('2 _STROM_VERIFY permission', '2 _STROM_CONFIRMED 2026-10-04');

    /** The `_STROM_CONFIRMED` days of a GEDCOM, by "<given name or FAM>/<fact tag>". */
    function confirmedIn(ged: string): Record<string, string> {
        const out: Record<string, string> = {};
        let rec = '';
        let fact = '';
        for (const line of ged.split('\n')) {
            const m = /^(\d) (\S+)(?: (.*))?$/.exec(line);
            if (!m) continue;
            const [, level, tag, value = ''] = m;
            if (level === '0') rec = / FAM$/.test(line) ? 'FAM' : '';
            else if (level === '1') {
                fact = tag;
                if (tag === 'NAME' && !rec) rec = value.split(' ')[0];
            } else if (level === '2' && tag === '_STROM_CONFIRMED') out[`${rec}/${fact}`] = value;
        }
        return out;
    }

    /** What goes to the research (the sync's export: the research's header, no other option). */
    const send = (d: StromData): string => exportToGedcom(d, 'Ozubec', { research: LINK }).content;

    it("a round trip gives back the research's confirmations as they were: no change", () => {
        const d = load(CONFIRMED_FILE);
        const given = { 'Hromoslav/SEX': '2026-10-02', 'Hromoslav/BIRT': '2026-11-08', 'Hromoslav/BURI': '2026-10-03', 'FAM/MARR': '2026-10-04' };
        expect(confirmedIn(CONFIRMED_FILE)).toEqual(given);
        expect(confirmedIn(send(d))).toEqual(given);
        for (const h of [...Object.values(d.persons), ...Object.values(d.partnerships)]) expect(confirmationEdits(h)).toEqual({});
        // The research's own state is not a change of the tree.
        expect(contentFingerprint(d)).toBe(contentFingerprint(JSON.parse(JSON.stringify(d, (k, v) => (k === 'researchVerify' || k === 'researchId' ? undefined : v)))));
        // What goes to the research, read again as its file, has the same confirmations.
        const again = load(send(d).replace(/^1 SOUR STROM\n2 VERS .*$/m, '1 SOUR STROM_RESEARCH\n2 VERS 1.30.0\n2 NAME Strom Research'));
        expect(Object.values(handedConfirmations(person(again, 'Hromoslav'))).sort())
            .toEqual(Object.values(handedConfirmations(person(d, 'Hromoslav'))).sort());
        expect(confirmedIn(send(again))).toEqual(given);
    });

    it('a fact confirmed here adds its tag (a change); taking it back removes it again', () => {
        const d = load(CONFIRMED_FILE);
        const fp = contentFingerprint(d);
        const h = person(d, 'Hromoslav');
        h.confirmed = { death: { at: '2026-11-08', value: factValueSignature(h, 'death') } };
        expect(confirmedIn(send(d))['Hromoslav/DEAT']).toBe('2026-11-08');
        expect(contentFingerprint(d)).not.toBe(fp);
        delete h.confirmed;
        expect(confirmedIn(send(d))['Hromoslav/DEAT']).toBeUndefined();
        expect(contentFingerprint(d)).toBe(fp);
    });

    it("the research's confirmation taken back here leaves its tag out (a change)", () => {
        const d = load(CONFIRMED_FILE);
        const fp = contentFingerprint(d);
        const h = person(d, 'Hromoslav');
        h.confirmed = { birth: { at: '2026-11-08', withdrawn: true } };
        couple(d).confirmed = { marriage: { at: '2026-10-04', withdrawn: true } };
        const sent = confirmedIn(send(d));
        expect(sent).toEqual({ 'Hromoslav/SEX': '2026-10-02', 'Hromoslav/BURI': '2026-10-03' });
        expect(confirmationEdits(h)).toEqual({ birth: '' });
        expect(contentFingerprint(d)).not.toBe(fp);
    });

    it('a tree confirmed in the app alone hands each confirmation over (adoption: no head)', () => {
        const d = load(RESEARCH_FILE.replace('1 SOUR STROM_RESEARCH\n2 VERS 1.30.0\n2 NAME Strom Research', '1 SOUR STROM\n2 VERS 3.26.0'));
        const h = person(d, 'Hromoslav');
        expect(h.confirmed).toEqual({
            sex: { at: '2026-10-02', value: factValueSignature(h, 'sex') },
            birth: { at: '2026-11-08', value: factValueSignature(h, 'birth') },
        });
        // The adoption's export (no research header, no other option).
        expect(confirmedIn(exportToGedcom(d, 'Ozubec', {}).content)).toEqual({ 'Hromoslav/SEX': '2026-10-02', 'Hromoslav/BIRT': '2026-11-08' });
    });
});

describe('the ids /verify names for a person and a family', () => {
    const WITH_REFN = RESEARCH_FILE
        .replace('1 NAME Hromoslav /Ozubec/', '1 NAME Hromoslav /Ozubec/\n1 REFN P0012\n2 TYPE strom-research')
        .replace(/@F1@/g, '@F0003@');

    it("a research tree keeps the person's REFN and the family's record", () => {
        const d = load(WITH_REFN);
        expect(personResearchRef(person(d, 'Hromoslav'))).toBe('P0012');
        expect(personResearchRef(person(d, 'Libuna'))).toBeNull();
        expect(couple(d).researchId).toBe('F0003');
        expect(familyResearchRef(couple(d))).toBe('F0003');
    });

    it('a file of the app or of another program gives a couple none', () => {
        const own = load(WITH_REFN.replace('1 SOUR STROM_RESEARCH\n2 VERS 1.30.0\n2 NAME Strom Research', '1 SOUR STROM\n2 VERS 3.26.0'));
        expect(couple(own).researchId).toBeUndefined();
        const foreign = load(WITH_REFN.replace('1 SOUR STROM_RESEARCH\n2 VERS 1.30.0\n2 NAME Strom Research', '1 SOUR FTM\n2 VERS 24'));
        expect(familyResearchRef(couple(foreign))).toBeNull();
    });

    it('is neither sent back nor a change, and a stored one stays only when valid', () => {
        const d = load(WITH_REFN);
        const without = JSON.parse(JSON.stringify(d, (k, v) => (k === 'researchId' ? undefined : v))) as StromData;
        expect(contentFingerprint(d)).toBe(contentFingerprint(without));
        const ged = exportToGedcom(d, 'Ozubec', { research: { id: 'r1', head: 'abc' } } as never).content;
        expect(ged).not.toContain('F0003');
        const stored = JSON.parse(JSON.stringify(d)) as StromData;
        expect(familyResearchRef(couple(migrateData(stored)))).toBe('F0003');
        couple(stored).researchId = 'P0012';
        expect(couple(migrateData(stored)).researchId).toBeUndefined();
    });
});

describe("the fact's id in the research and its place in the queue", () => {
    const WITH_IDS = RESEARCH_FILE
        .replace('1 BIRT\n2 DATE 3 MAR 1850', '1 BIRT\n2 DATE 3 MAR 1850\n2 _STROM_EID E0012')
        .replace('1 DEAT\n2 DATE 1910\n2 _STROM_VERIFY asked', '1 DEAT\n2 DATE 1910\n2 _STROM_VERIFY asked\n3 _POS 3\n2 _STROM_EID E0013')
        .replace('2 _STROM_VERIFY permission', '2 _STROM_VERIFY permission\n3 _POS 1\n2 _STROM_EID E0020')
        .replace('1 CHR\n', '1 CHR\n2 _STROM_EID E0014\n');

    it('keeps the id per fact and the place of a fact its agent is to take', () => {
        const d = load(WITH_IDS);
        const h = person(d, 'Hromoslav');
        expect(factResearchEid(h, 'birth')).toBe('E0012');
        expect(factResearchEid(h, 'death')).toBe('E0013');
        expect(factResearchEid(h, eventFact(h, 'baptism'))).toBe('E0014');
        expect(factResearchEid(couple(d), 'marriage')).toBe('E0020');
        expect(factResearchEid(h, 'sex')).toBeNull();
        expect(factPendingPosition(h, 'death')).toBe(3);
        expect(h.researchVerify?.death).toEqual({ pending: 'asked', position: 3, eid: 'E0013' });
        // Waiting for a person: no place in the agent's queue.
        expect(factPendingPosition(couple(d), 'marriage')).toBeNull();
        expect(couple(d).researchVerify?.marriage).toEqual({ pending: 'permission', eid: 'E0020' });
        // The birth keeps both its confirmation and its id.
        expect(h.researchVerify?.birth).toEqual({ confirmed: '2026-11-08', value: factValueSignature(h, 'birth'), eid: 'E0012' });
    });

    it('counts neither tag as unsupported and changes no fact', () => {
        const result = convertToStrom(parseGedcom(WITH_IDS));
        expect(result.stats.droppedTagSummary).not.toMatch(/_STROM_EID|_POS/);
        const h = person(result.data, 'Hromoslav');
        expect(h.deathDate).toBe('1910');
        expect(h.events!.find(e => e.type === 'baptism')!.date).toBe('1850-03-05');
    });

    it('drops an id or a place that is not valid', () => {
        const d = load(WITH_IDS.replace('_STROM_EID E0012', '_STROM_EID P0012').replace('3 _POS 3', '3 _POS first'));
        const h = person(d, 'Hromoslav');
        expect(factResearchEid(h, 'birth')).toBeNull();
        expect(factPendingPosition(h, 'death')).toBeNull();
        expect(h.researchVerify?.death).toEqual({ pending: 'asked', eid: 'E0013' });
    });

    it('the id goes back to the research under its fact (it takes a confirmation back only there), the place never; neither is a change', () => {
        const d = load(WITH_IDS);
        // The same tree without the ids and places (ids of records are fresh on every load).
        const plain = JSON.parse(JSON.stringify(d, (k, v) => (k === 'eid' || k === 'position' ? undefined : v))) as StromData;
        expect(contentFingerprint(d)).toBe(contentFingerprint(plain));
        const ged = exportToGedcom(d, 'Ozubec', { research: { id: 'r1', head: 'abc' } } as never).content;
        expect(ged).not.toMatch(/_POS/);
        const idsOf = (text: string): Record<string, string> => {
            const out: Record<string, string> = {};
            let fact = '';
            for (const line of text.split(/\r?\n/)) {
                if (/^1 /.test(line)) fact = line.split(' ')[1];
                const m = /^2 _STROM_EID (\S+)$/.exec(line);
                if (m) out[m[1]] = fact;
            }
            return out;
        };
        expect(idsOf(ged)).toEqual({ E0012: 'BIRT', E0013: 'DEAT', E0014: 'BAPM', E0020: 'MARR' });
        // Only the research's file: the id is that research's, the app's own
        // file may reach another one; "Back to {prog}" never.
        const own = exportToGedcom(d, 'Ozubec', { origins: true, confirmations: true }).content;
        expect(own).not.toMatch(/_STROM_EID|_POS/);
        const back = exportToGedcom(d, 'Ozubec', { backTo: 'PAF' } as never).content;
        expect(back).not.toMatch(/_STROM_EID|_POS/);
    });

    it('a fact taken back here goes to the research without its confirmation but with its id: the take-back reaches it', () => {
        const d = load(WITH_IDS);
        const h = person(d, 'Hromoslav');
        expect(h.researchVerify?.birth?.confirmed).toBe('2026-11-08');
        // Taken back here as DataManager.unconfirmFact does it.
        h.confirmed = { birth: { at: '2026-11-08', withdrawn: true } };
        const ged = exportToGedcom(d, 'Ozubec', { research: { id: 'r1', head: 'abc' } } as never).content;
        const birth = ged.split(/\r?\n(?=1 )/).find(b => b.startsWith('1 BIRT') && b.includes('E0012'))!;
        expect(birth).toMatch(/^2 _STROM_EID E0012$/m);
        expect(birth).not.toMatch(/_STROM_CONFIRMED/);
    });
});
