/**
 * Polish texts found on the 3.21.1 screenshots (1103): a family's name after
 * "rodziny" declines, and a cited fact's dash follows the language.
 */

import { describe, it, expect } from 'vitest';
import { getStringsForLang } from '../strings.js';
import { familyGenitivePl } from '../strings-pl/helpers.js';
import { checkFindingText } from '../places-dialog.js';

describe('a family after "rodziny"', () => {
    it('declines the Polish adjectival surnames, the women\'s form too', () => {
        expect(familyGenitivePl('Jaworski')).toBe('Jaworskich');
        expect(familyGenitivePl('Jaworska')).toBe('Jaworskich');
        expect(familyGenitivePl('Nowicki')).toBe('Nowickich');
        expect(familyGenitivePl('Zawadzki')).toBe('Zawadzkich');
        expect(familyGenitivePl('JAWORSKI')).toBe('JAWORSKICH');
    });

    it('leaves any other surname as written', () => {
        for (const s of ['Nowak', 'Krawczyk', 'Kubica', 'Lhoták', 'Brodský', 'Ski']) expect(familyGenitivePl(s)).toBe(s);
    });

    it('the place check says it in each language', () => {
        const f = { kind: 'far' as const, km: 74, family: 'Jaworski', years: [1890, 1931] as [number, number] };
        expect(checkFindingText(f, 'pl')).toBe('Leży 74 km od innych miejsc rodziny Jaworskich w latach 1890–1931.');
        expect(checkFindingText(f, 'cs')).toContain('rodiny Jaworski');
        expect(checkFindingText(f, 'de')).toContain('Familie Jaworski');
        expect(checkFindingText(f, 'en')).toContain('the Jaworski family');
    });
});

describe('a cited fact: person and fact joined by the language\'s dash', () => {
    it('en an em dash, cs/de/pl an en dash', () => {
        expect(getStringsForLang('en').sources.citedFact('Jan Smith', 'Baptism (1931)')).toBe('Jan Smith — Baptism (1931)');
        for (const lang of ['cs', 'de', 'pl'] as const) {
            expect(getStringsForLang(lang).sources.citedFact('Zofia Jaworska', 'Chrzest (1931)')).toBe('Zofia Jaworska – Chrzest (1931)');
            expect(getStringsForLang(lang).partnerEvents.cited('Ślub', 'A & B')).toBe('A & B – Ślub');
        }
    });
});

describe('the help mark of "Awaiting action" (1105)', () => {
    it('pl names the section as the overview\'s heading does', () => {
        const pl = getStringsForLang('pl');
        expect(pl.help.topics.waiting).toBe(pl.research.waiting);
        expect(pl.help.topics.waiting).toBe('Czeka na załatwienie');
    });

    it('every language names the section as the overview\'s heading does', () => {
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
            const t = getStringsForLang(lang);
            expect(t.help.topics.waiting, lang).toBe(t.research.waiting);
        }
        expect(getStringsForLang('en').help.topics.waiting).toBe('Awaiting action');
        expect(getStringsForLang('de').help.topics.waiting).toBe('Wartet auf Bearbeitung');
    });
});

describe('the Table names the research as the rest of the app does (spec 073)', () => {
    /** Every text of a branch of strings, the functions called with sample arguments. */
    const textsOf = (v: unknown, out: string[] = []): string[] => {
        if (typeof v === 'string') out.push(v);
        else if (typeof v === 'function') {
            try { textsOf((v as (...a: unknown[]) => unknown)(2, 'X', 'Y', 'Z'), out); } catch { /* a text that wants other arguments */ }
        } else if (v && typeof v === 'object') for (const x of Object.values(v)) textsOf(x, out);
        return out;
    };

    it('pl: "Badanie" in the singular, "Czeka na załatwienie" as the overview\'s heading', () => {
        const pl = getStringsForLang('pl');
        const t = pl.table;
        expect(t.group.research).toBe('Badanie');
        expect(t.res.block).toBe('Badanie');
        expect(t.res.view.research).toBe('Badanie');
        expect(t.views.research).toBe('Badanie');
        expect(t.col.rSum).toBe('Badanie');
        expect(t.col.rWait).toBe(pl.research.waiting);
        expect(t.chip.rWait).toBe(pl.research.waiting);
        expect(t.res.bub.waitTitle(3)).toBe(`${pl.research.waiting} · 3`);
        const plural = textsOf(t).filter(x => /Badania\b|badań|badaniach|badaniami|Czeka na decyzję|czekają/u.test(x));
        expect(plural).toEqual([]);
    });
});
