/**
 * Polish toast after a single file is sent to the research: a person's name
 * or a source's title after "dla" stays undeclined, so it goes behind
 * "osoby" / "źródła" (never "dla Karel Testovec").
 */

import { describe, it, expect } from 'vitest';
import { getStringsForLang } from '../strings.js';

describe('pl: sent to the research, waits in Materials', () => {
    const m = getStringsForLang('pl').material;

    it('a person: "dla osoby <name>", the name never right after "dla"', () => {
        const text = m.sentWaitToast(1, 'Karel Testovec');
        expect(text).toContain('1 plik dla osoby Karel Testovec.');
        expect(text).not.toMatch(/dla Karel/);
    });

    it('a source: "dla źródła „<title>”"', () => {
        const text = m.sentWaitToast(2, 'Matrika Lhota 1850', true);
        expect(text).toContain('2 pliki dla źródła „Matrika Lhota 1850”.');
        expect(text).not.toContain('dla osoby');
    });
});
