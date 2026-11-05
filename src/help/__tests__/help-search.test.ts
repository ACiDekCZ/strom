import { beforeAll, describe, expect, it } from 'vitest';
import { convertHelp } from '../help-convert.js';
import {
    buildHelpIndex, foldHelpText, helpHighlight, helpSnippet, helpTermLabel, isHelpNumber, searchHelp,
    HELP_RULE_LIMIT, HELP_TERM_LIMIT, type HelpSearchIndex,
} from '../help-search.js';
import type { HelpBundle, HelpLangData } from '../help-types.js';
import { readHelpSources, VENDOR_DIR, vendorPin } from './help-sources.js';

let bundle: HelpBundle;
let cs: HelpSearchIndex;
let de: HelpSearchIndex;

beforeAll(() => {
    bundle = convertHelp(readHelpSources(VENDOR_DIR), vendorPin());
    cs = buildHelpIndex(bundle.langs.cs);
    de = buildHelpIndex(bundle.langs.de);
});

const plain = (segs: { t: string }[] | null): string => (segs ?? []).map(s => s.t).join('');
const marked = (segs: { t: string; m?: boolean }[] | null): string[] => (segs ?? []).filter(s => s.m).map(s => s.t);

describe('help search: folding', () => {
    it('drops diacritics and letter case, Polish ł as l', () => {
        expect(foldHelpText('Místo Čeká ŘÍJEN')).toBe('misto ceka rijen');
        expect(foldHelpText('Źródło łódź')).toBe('zrodlo lodz');
        expect(foldHelpText('Größe')).toBe('große');
    });

    it('tells a number from a word', () => {
        for (const q of ['R4.3', 'r4', ' a2 ', 'S1.4.2']) expect(isHelpNumber(q)).toBe(true);
        for (const q of ['R', 'R4.', 'místo', 'x4.3', '4.3']) expect(isHelpNumber(q)).toBe(false);
    });

    it('marks matches in the original text, whatever its accents', () => {
        const segs = helpHighlight('Místo nemá polohu, MISTO ano', 'misto');
        expect(marked(segs)).toEqual(['Místo', 'MISTO']);
        expect(plain(segs)).toBe('Místo nemá polohu, MISTO ano');
    });

    it('cuts a snippet around the first match at spaces, with ellipses', () => {
        const before = 'slovo '.repeat(20);
        const after = ' konec'.repeat(30);
        const text = `${before}Hledané${after}`;
        const segs = helpSnippet(text, 'hledane');
        const s = plain(segs);
        expect(s.startsWith('…slovo')).toBe(true);
        expect(s.endsWith('konec…')).toBe(true);
        expect(marked(segs)).toEqual(['Hledané']);
        // About 48 characters before the match and 80 after (cut at a word).
        const [head, tail] = s.split('Hledané');
        expect(head.length).toBeLessThanOrEqual(1 + 48);
        expect(tail.length).toBeLessThanOrEqual(80 + 1);
        expect(helpSnippet('krátký text', 'krat')).toEqual([{ t: 'krát', m: true }, { t: 'ký text' }]);
        expect(helpSnippet('nic', 'xyz')).toBeNull();
    });

    it('leaves the interface keys out of a term, words in brackets stay', () => {
        expect(helpTermLabel('Čas na jeden úkol (terminal, `run.minutes`)')).toBe('Čas na jeden úkol');
        expect(helpTermLabel('Čeká na odpověď (ui.wait.sent.title, app waitingPhaseSent)')).toBe('Čeká na odpověď');
        expect(helpTermLabel('Waiting for a reply (terminal) · Awaiting a reply (app)'))
            .toBe('Waiting for a reply (terminal) · Awaiting a reply (app)');
        expect(helpTermLabel('Načtení rodokmenu (GEDCOM)')).toBe('Načtení rodokmenu (GEDCOM)');
    });
});

describe('help search: the embedded help', () => {
    it('indexes every chapter and rule of the help by its number', () => {
        const chapters = bundle.langs.cs.chapters.length;
        expect(cs.rules.filter(r => r.level === 1)).toHaveLength(chapters);
        expect(cs.byId.get('r2.4')?.title).toBeTruthy();
        expect(cs.byId.get('r2.4')?.chapter.id).toBe('R2');
        expect(cs.byId.get('r2.4')?.text.length).toBeGreaterThan(20);
        expect(cs.terms.length).toBe(bundle.langs.cs.terms.length);
    });

    it('a number that exists: go there, its rules listed', () => {
        const r = searchHelp(cs, 'r4.3');
        expect(r.isNumber).toBe(true);
        expect(r.number?.id).toBe('R4.3');
        expect(r.terms).toEqual([]);
        expect(r.rules[0].rule.id).toBe('R4.3');
        expect(r.rules.every(h => h.rule.id === 'R4.3' || h.rule.id.startsWith('R4.3.'))).toBe(true);
        expect(searchHelp(cs, 'R7').number?.level).toBe(1);
    });

    it('a number that does not exist: a number without a place', () => {
        const r = searchHelp(cs, 'R9.14');
        expect(r.isNumber).toBe(true);
        expect(r.number).toBeNull();
        expect(r.rules).toEqual([]);
    });

    it('a word: terms first (at most 3), then rules with the title match first, in the order of the help', () => {
        const r = searchHelp(cs, 'misto');
        expect(r.isNumber).toBe(false);
        expect(r.terms.length).toBeGreaterThan(0);
        expect(r.terms.length).toBeLessThanOrEqual(HELP_TERM_LIMIT);
        expect(r.rules.length).toBeGreaterThan(0);
        expect(r.rules.length).toBeLessThanOrEqual(HELP_RULE_LIMIT);
        const titled = r.rules.map(h => foldHelpText(h.rule.title).includes('misto'));
        const firstUntitled = titled.indexOf(false);
        if (firstUntitled >= 0) expect(titled.slice(firstUntitled).every(t => !t)).toBe(true);
        // Order of the help within the title matches.
        const order = cs.rules.map(x => x.id);
        const idx = r.rules.filter((_, i) => titled[i]).map(h => order.indexOf(h.rule.id));
        expect([...idx].sort((a, b) => a - b)).toEqual(idx);
        // A match in the text only has a snippet with the match marked.
        const textHit = r.rules.find((_, i) => !titled[i]);
        if (textHit) expect(marked(textHit.snippet).map(foldHelpText)).toContain('misto');
    });

    it('finds German words without their umlauts', () => {
        const r = searchHelp(de, 'widerspruche');
        expect(r.rules.length + r.terms.length).toBeGreaterThan(0);
    });

    it('under two characters: nothing; nothing found: empty', () => {
        expect(searchHelp(cs, 'm')).toMatchObject({ terms: [], rules: [], number: null });
        expect(searchHelp(cs, 'qqxyzzy')).toMatchObject({ terms: [], rules: [], number: null, isNumber: false });
    });

    it('an empty help has an empty index', () => {
        const none: HelpLangData = { parts: [], chapters: [], terms: [] };
        expect(searchHelp(buildHelpIndex(none), 'misto').rules).toEqual([]);
    });
});
