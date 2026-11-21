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

describe('sent to the research or saved in the archive, for a source', () => {
    it('pl: a source is "dla źródła „<title>”", a person "dla osoby <name>"', () => {
        const m = getStringsForLang('pl').material;
        expect(m.sentToast(1, 'Matrika Lhota 1850', true)).toContain('1 plik dla źródła „Matrika Lhota 1850”.');
        expect(m.savedArchiveToast(2, 'Matrika Lhota 1850', true)).toContain('2 pliki dla źródła „Matrika Lhota 1850”.');
        expect(m.sentToast(1, 'Karel Testovec')).toContain('1 plik dla osoby Karel Testovec.');
        expect(m.savedArchiveToast(1, 'Karel Testovec')).toContain('1 plik dla osoby Karel Testovec.');
    });

    it('cs: a source is "k prameni „<title>“", never "k osobě"', () => {
        const m = getStringsForLang('cs').material;
        const sent = m.sentToast(1, 'Matrika Lhota 1850', true);
        const saved = m.savedArchiveToast(3, 'Matrika Lhota 1850', true);
        expect(sent).toContain('1 soubor k prameni „Matrika Lhota 1850“.');
        expect(saved).toContain('3 soubory k prameni „Matrika Lhota 1850“.');
        expect(sent + saved).not.toContain('k osobě');
        expect(m.sentToast(1, 'Karel Testovec')).toContain('k osobě Karel Testovec.');
    });
});

describe('pl: one verb for the agent going through files', () => {
    it('the action is "Uporządkuj agentem…", so what waits is "nieuporządkowane", never "posortuje"/"nieposortowane"', () => {
        const pl = getStringsForLang('pl');
        const texts = [JSON.stringify(pl.batch), JSON.stringify(pl.material), JSON.stringify(pl.materials),
            pl.material.sentWaitToast(1, 'Karel Testovec'), pl.material.sentWaitToast(2, 'Karel Testovec'),
            pl.batch.sortedLine('Paczka', 1, 2)].join('\n');
        expect(pl.materials.agentSort.sort).toBe('Uporządkuj agentem…');
        expect(texts).not.toMatch(/posortu|posortow|nieposortow|Agent sortuje/);
        expect(texts).toContain('nieuporządkowane');
    });
});
