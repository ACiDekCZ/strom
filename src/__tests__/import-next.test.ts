import { describe, it, expect } from 'vitest';
import {
    importNextResearchState, importNextRows, importNextDue, markImportNextClosed,
    importProgramLabel, importProgramName, importDateText, peopleWithImportedFacts,
    importNextVerifyAvailable, IMPORT_NEXT_VERIFY_FEATURES,
} from '../import-next.js';
import { getStringsForLang } from '../strings.js';
import type { ImportRecord, StromData } from '../types.js';

const rec = (over: Partial<ImportRecord> = {}): ImportRecord =>
    ({ id: 'I1', program: 'Family Tree Maker', version: '24.0', fileDate: '12 MAR 2024', at: '2026-11-08T10:00:00.000Z', ...over });

describe('"What next" card: the research row', () => {
    it('no research on a phone or tablet, whatever the tree', () => {
        expect(importNextResearchState({ onComputer: false, linked: true, canAdopt: true })).toBe('none');
    });
    it('a research\'s tree is linked; one the research can take over is "have"; else none', () => {
        expect(importNextResearchState({ onComputer: true, linked: true, canAdopt: false })).toBe('linked');
        expect(importNextResearchState({ onComputer: true, linked: false, canAdopt: true })).toBe('have');
        expect(importNextResearchState({ onComputer: true, linked: false, canAdopt: false })).toBe('none');
    });
});

describe('"What next" card: rows', () => {
    it('the data check always, the split only for 2+ families, the research last', () => {
        expect(importNextRows({ findings: 0, families: 1, research: 'none', verify: false }).map(r => r.kind))
            .toEqual(['check', 'research']);
        expect(importNextRows({ findings: 3, families: 2, research: 'have', verify: false }))
            .toEqual([{ kind: 'check', findings: 3 }, { kind: 'split', families: 2 }, { kind: 'research', state: 'have', verify: false }]);
    });
    it('the fact check (065) only for a linked tree whose bridge offers it', () => {
        expect(importNextRows({ findings: 0, families: 0, research: 'have', verify: true })[1]).toMatchObject({ verify: false });
        expect(importNextRows({ findings: 0, families: 0, research: 'linked', verify: true })[1]).toMatchObject({ verify: true });
    });
    it('offered by a bridge that names the bulk verification (verify.bulk)', () => {
        expect(IMPORT_NEXT_VERIFY_FEATURES).toEqual(['verify.bulk']);
        expect(importNextVerifyAvailable(['places', 'verify', 'readPerson'])).toBe(false);
        expect(importNextVerifyAvailable(['places', 'verify', 'verify.bulk'])).toBe(true);
        expect(importNextVerifyAvailable(null)).toBe(false);
    });
});

describe('"What next" card: once per import', () => {
    it('due while the record is there and not closed; closing is remembered on the record', () => {
        const data: Pick<StromData, 'imports'> = { imports: [rec()] };
        expect(importNextDue(data, 'I1')).toBe(true);
        expect(importNextDue(data, 'I2')).toBe(false);
        expect(importNextDue(data, undefined)).toBe(false);
        expect(importNextDue({}, 'I1')).toBe(false);
        expect(markImportNextClosed(data, 'I1')).toBe(true);
        expect(data.imports![0].nextCardClosed).toBe(true);
        expect(importNextDue(data, 'I1')).toBe(false);
        expect(markImportNextClosed(data, 'I1')).toBe(false);
        expect(markImportNextClosed(data, 'I9')).toBe(false);
    });
});

describe('"What next" card: the origin line', () => {
    it('the program with its version, once; the file name or GEDCOM when the header names none', () => {
        expect(importProgramLabel(rec())).toBe('Family Tree Maker 24.0');
        expect(importProgramLabel(rec({ program: 'Gramps 5.2', version: '5.2' }))).toBe('Gramps 5.2');
        expect(importProgramLabel(rec({ version: undefined }))).toBe('Family Tree Maker');
        expect(importProgramLabel(rec({ program: '', file: 'rodina.ged' }))).toBe('rodina.ged');
        expect(importProgramLabel(rec({ program: '' }))).toBe('GEDCOM');
        expect(importProgramName(rec())).toBe('Family Tree Maker');
    });
    it('the file date in the app\'s way of writing dates, else the day of the import', () => {
        expect(importDateText(rec(), 'en')).toBe('12 Mar 2024');
        expect(importDateText(rec(), 'de')).toBe('12.3.2024');
        expect(importDateText(rec({ fileDate: undefined }), 'en')).toBe('8 Nov 2026');
        expect(importDateText(rec({ fileDate: 'sometime' }), 'en')).toBe('sometime');
    });
    it('counts the people with a fact still as the file gave it', () => {
        const persons = {
            a: { id: 'a', firstName: 'Vendelin', birthDate: '1850', importedValues: { birthDate: { from: 'I1', value: '1850' } } },
            b: { id: 'b', firstName: 'Kunhuta', birthDate: '1853', importedValues: { birthDate: { from: 'I1', value: '1852' } } },
            c: { id: 'c', firstName: 'Kvido' },
        } as unknown as StromData['persons'];
        expect(peopleWithImportedFacts({ persons })).toBe(1);
    });
});

describe('"What next" card: texts', () => {
    it('Czech and Polish plurals of the counts', () => {
        const cs = getStringsForLang('cs').importNext;
        expect(cs.checkFound(1)).toBe('Našla 1 věc k prohlédnutí. Nic se samo neopravuje.');
        expect(cs.origin('X', 'D', 1)).toContain('1 osoba');
        expect(cs.origin('X', 'D', 3)).toContain('3 osoby');
        expect(cs.origin('X', 'D', 5)).toContain('5 osob');
        const pl = getStringsForLang('pl').importNext;
        expect(pl.origin('X', 'D', 2)).toContain('2 osoby');
        expect(pl.origin('X', 'D', 5)).toContain('5 osób');
    });
    it('every language names the back way with the program', () => {
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
            expect(getStringsForLang(lang).importNext.backLink('Gramps')).toContain('Gramps');
        }
    });
});
