/**
 * The preview of "Verify facts" names each fact the research's dry run sends
 * by its GEDCOM tag in words, in every language — never the bare tag ("OCCU").
 */
import { describe, it, expect, afterEach } from 'vitest';
import { verifyKindName } from '../ui/verify-ui.js';
import { setLanguage, strings } from '../strings.js';

const TAGS = [
    'BIRT', 'CHR', 'BAPM', 'DEAT', 'BURI', 'CREM', 'MARR', 'DIV', 'ENGA', 'MARB', 'CENS', 'ANUL',
    'OCCU', 'RESI', 'EDUC', 'GRAD', 'RELI', 'EMIG', 'IMMI', 'CONF', 'FCOM', 'ORDN', 'NATU', 'NATI', 'TITL',
    'ADOP', 'WILL', 'PROB', 'NAME', 'NPFX', 'NSFX', 'SEX', 'EVEN', 'FACT', '_MILT',
];

describe('verifyKindName', () => {
    afterEach(() => setLanguage('en'));

    it('names each tag in words, in cs, en, de and pl', () => {
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
            setLanguage(lang);
            for (const tag of TAGS) {
                const name = verifyKindName(tag);
                expect(name, `${lang} ${tag}`).toBeTruthy();
                expect(name, `${lang} ${tag}`).not.toBe(tag);
                expect(name, `${lang} ${tag}`).not.toMatch(/^_?[A-Z]{3,5}$/);
            }
        }
    });

    it('as the app names the facts elsewhere', () => {
        setLanguage('en');
        expect(verifyKindName('OCCU')).toBe('Occupation');
        expect(verifyKindName('RESI')).toBe('Residence');
        expect(verifyKindName('BIRT')).toBe('Birth');
        expect(verifyKindName('CHR')).toBe('Christening');
        expect(verifyKindName('MARR')).toBe('Marriage');
        expect(verifyKindName('NAME')).toBe('Name');
        expect(verifyKindName('SEX')).toBe('Gender');
        expect(verifyKindName('DIV')).toBe('Divorce');
        expect(verifyKindName('EVEN')).toBe('Other fact');
        setLanguage('cs');
        expect(verifyKindName('OCCU')).toBe('Povolání');
        setLanguage('de');
        expect(verifyKindName('OCCU')).toBe('Beruf');
        setLanguage('pl');
        expect(verifyKindName('OCCU')).toBe('Zawód');
    });

    it('the name (066 K6.3) and what a fact is verified together with, in cs, en, de and pl', () => {
        const names = { cs: 'Jméno', en: 'Name', de: 'Name', pl: 'Imię' } as const;
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
            setLanguage(lang);
            expect(verifyKindName('NAME'), lang).toBe(names[lang]);
            for (const kind of ['BIRT', 'BAPM', 'CHR', 'NAME']) expect(strings.verify.together[kind], `${lang} ${kind}`).toBeTruthy();
        }
        setLanguage('cs');
        expect(strings.verify.together.BIRT).toBe('Ověří se spolu s narozením.');
        expect(strings.verify.together.NAME).toBe('Ověří se spolu se jménem.');
        setLanguage('en');
        expect(strings.verify.together.BAPM).toBe('Verified together with the baptism.');
    });
});
