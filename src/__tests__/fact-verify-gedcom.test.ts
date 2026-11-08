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
import { factVerifyInfo, factValueSignature, factResearchEid, factPendingPosition } from '../verify.js';
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
        expect(h.researchVerify?.birth).toEqual({ confirmed: '2026-11-08' });
        expect(h.researchVerify?.sex).toEqual({ confirmed: '2026-10-02' });
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

    it('nothing without the option (what goes to the research, another export)', () => {
        const d = confirmedTree();
        const ged = exportToGedcom(d, 'Ozubec', { research: { id: 'r1', head: 'abc' } } as never).content;
        expect(ged).not.toContain('_STROM_CONFIRMED');
        expect(exportToGedcom(d, 'Ozubec', {}).content).not.toContain('_STROM_CONFIRMED');
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
        expect(h.researchVerify?.birth).toEqual({ confirmed: '2026-11-08', eid: 'E0012' });
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

    it('is neither sent back nor a change', () => {
        const d = load(WITH_IDS);
        // The same tree without the ids and places (ids of records are fresh on every load).
        const plain = JSON.parse(JSON.stringify(d, (k, v) => (k === 'eid' || k === 'position' ? undefined : v))) as StromData;
        expect(contentFingerprint(d)).toBe(contentFingerprint(plain));
        const ged = exportToGedcom(d, 'Ozubec', { research: { id: 'r1', head: 'abc' } } as never).content;
        expect(ged).not.toMatch(/_STROM_EID|_POS/);
        const own = exportToGedcom(d, 'Ozubec', { origins: true, confirmations: true }).content;
        expect(own).not.toMatch(/_STROM_EID|_POS/);
    });
});
