/**
 * The sources a story rests on (Strom Research 1.26: `2 SOUR @S…@` under
 * _STORY, `3 SOUR` under _DRAFT): read into Story.sources, written back the
 * same way, kept by the tree's own changes, and the research's bare source
 * codes in a story's text named by their title. Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { applyLivingPrivacy, stripSources } from '../privacy.js';
import { nameSourceCodes, rewriteStorySources, storyBasisDetailsHtml, storyBasisHead, storyBasisShown, storyBasisSourceIds, storyBasisWords, storyFactText, storySourceIds } from '../story-sources.js';
import { storyCompareHtml } from '../story-compare.js';
import { getStringsForLang } from '../strings.js';
import { Person, StromData } from '../types.js';

const TREE = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';

const GED = `0 HEAD
1 CHAR UTF-8
1 SOUR STROM_RESEARCH
1 _STROM_TREE ${TREE}
1 _STROM_ASOF 2026-11-03
0 @I1@ INDI
1 NAME Ondřej /Ořechový/
1 SEX M
1 REFN P0001
2 TYPE strom-research
1 BAPM
2 DATE 1850
2 SOUR @S1@
1 FAMS @F1@
1 _STORY
2 TYPE vypraveni
2 TITL Mlynář z Lískové
2 STAT hotovo
2 TEXT Ondřej byl mlynář. Roku 1905 prý hořelo [S0002].
2 DATA BAPM 1850 Lísková [S0001]
2 DATA EVEN NOV 1905 Lísková [S0002]
2 SOUR @S1@
2 SOUR @S2@
2 SOUR @S3@
2 NOTE Vyprávění, ne pramen.
2 _DRAFT
3 TEXT Ondřej byl mlynář. Roku 1905 hořelo, říkají Hasiči v Lískové.
3 DATA BAPM 1850 Lísková [S0001]
3 SOUR @S1@
3 SOUR @S2@
3 _AT 2026-11-03
0 @I2@ INDI
1 NAME Bohumila /Ořechová/
1 SEX F
1 REFN P0002
2 TYPE strom-research
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 _STORY
2 TYPE vypraveni
2 STAT hotovo
2 TEXT Svatba byla roku 1875 (S0003).
2 SOUR @S3@
0 @S1@ SOUR
1 TITL Křest Ondřeje 1850
1 REFN S0001
0 @S2@ SOUR
1 TITL Hasiči v Lískové
1 REFN S0002
1 WWW https://obec.example.org/hasici
0 @S3@ SOUR
1 TITL Kronika Lískové
1 REFN S0003
0 TRLR
`;

const load = (text = GED): StromData => convertToStrom(parseGedcom(text)).data;
const ondrej = (d: StromData): Person => Object.values(d.persons).find(p => p.refn === 'P0001')!;
const titles = (d: StromData, ids: readonly string[] | undefined): string[] => (ids ?? []).map(id => d.sources?.[id]?.title ?? `missing ${id}`);
/** The lines of each _STORY block of a file, the SOUR pointers by their source's title. */
function storyBlocks(ged: string): string[][] {
    const lines = ged.split(/\r?\n/);
    const titleOf = new Map<string, string>();
    for (let i = 0; i < lines.length; i++) {
        const m = /^0 (@[^@]+@) SOUR$/.exec(lines[i]);
        if (m) titleOf.set(m[1], /^1 TITL (.*)$/.exec(lines[i + 1] ?? '')?.[1] ?? '');
    }
    const out: string[][] = [];
    for (let i = 0; i < lines.length; i++) {
        if (!/^1 _STORY$/.test(lines[i])) continue;
        const block: string[] = [];
        for (let k = i + 1; k < lines.length && !/^[01] /.test(lines[k]); k++) {
            const sour = /^(\d) SOUR (@[^@]+@)$/.exec(lines[k]);
            block.push(sour ? `${sour[1]} SOUR ${titleOf.get(sour[2])}` : lines[k]);
        }
        out.push(block);
    }
    return out;
}

describe('reading the sources of a story', () => {
    it('a person\'s story and its new version, a couple\'s story: each source of the file a source of the app', () => {
        const d = load();
        const s = ondrej(d).story!;
        expect(titles(d, s.sources)).toEqual(['Křest Ondřeje 1850', 'Hasiči v Lískové', 'Kronika Lískové']);
        expect(titles(d, s.draft?.sources)).toEqual(['Křest Ondřeje 1850', 'Hasiči v Lískové']);
        // The rest of the story as before.
        expect(s.facts).toEqual(['BAPM 1850 Lísková [S0001]', 'EVEN NOV 1905 Lísková [S0002]']);
        expect(s.note).toBe('Vyprávění, ne pramen.');
        const u = Object.values(d.partnerships)[0]!;
        expect(titles(d, u.story?.sources)).toEqual(['Kronika Lískové']);
        // The address of a source (WWW on the record).
        expect(Object.values(d.sources!).find(x => x.refn === 'S0002')?.url).toBe('https://obec.example.org/hasici');
    });

    it('a story without SOUR has no sources field; a pointer to no record is left out, a text source is a source as anywhere in the file', () => {
        const d = load(GED.replace(/^2 SOUR @S\d@\n/gm, '').replace(/^3 SOUR @S\d@\n/gm, ''));
        expect(ondrej(d).story).not.toHaveProperty('sources');
        expect(ondrej(d).story?.draft).not.toHaveProperty('sources');
        const odd = load(GED.replace('2 SOUR @S3@\n2 NOTE', '2 SOUR @S9@\n2 SOUR Kronika bez záznamu\n2 NOTE'));
        expect(titles(odd, ondrej(odd).story?.sources)).toEqual(['Křest Ondřeje 1850', 'Hasiči v Lískové', 'Kronika bez záznamu']);
    });
});

describe('writing them back', () => {
    it('import → export → import: the same SOUR lines under _STORY, the same sources', () => {
        const d = load();
        const first = exportToGedcom(d, 'Ořechovi').content;
        const blocks = storyBlocks(first);
        expect(blocks[0]).toEqual(expect.arrayContaining(['2 SOUR Křest Ondřeje 1850', '2 SOUR Hasiči v Lískové', '2 SOUR Kronika Lískové']));
        // The sources after the facts, before the caveat (as the research writes them).
        const at = (l: string) => blocks[0].indexOf(l);
        expect(at('2 SOUR Křest Ondřeje 1850')).toBeGreaterThan(at('2 DATA EVEN NOV 1905 Lísková [S0002]'));
        expect(at('2 SOUR Kronika Lískové')).toBeLessThan(at('2 NOTE Vyprávění, ne pramen.'));
        expect(blocks.some(b => b.includes('2 SOUR Kronika Lískové') && b.includes('2 TEXT Svatba byla roku 1875 (S0003).'))).toBe(true);
        const again = load(first);
        expect(titles(again, ondrej(again).story?.sources)).toEqual(['Křest Ondřeje 1850', 'Hasiči v Lískové', 'Kronika Lískové']);
        expect(storyBlocks(exportToGedcom(again, 'Ořechovi').content)).toEqual(blocks);
    });

    it('a source the tree no longer has is not written', () => {
        const d = load();
        ondrej(d).story!.sources = [...ondrej(d).story!.sources!, 'gone'];
        expect(storyBlocks(exportToGedcom(d, 'Ořechovi').content)[0].filter(l => l.startsWith('2 SOUR'))).toHaveLength(3);
    });
});

describe('the tree keeps them right', () => {
    it('removing or merging a source rewrites the story and its new version', () => {
        const d = load();
        const s = ondrej(d).story!;
        const [a, b, c] = s.sources!;
        rewriteStorySources(s, ids => ids.filter(id => id !== b));
        expect(s.sources).toEqual([a, c]);
        expect(s.draft?.sources).toEqual([a]);
        rewriteStorySources(s, ids => ids.map(id => (id === c ? a : id)));
        expect(s.sources).toEqual([a]);
        rewriteStorySources(s, () => []);
        expect(s).not.toHaveProperty('sources');
        expect(s.draft).not.toHaveProperty('sources');
    });

    it('a copy without sources has none in its stories; a copy of the dead keeps a source only a story cites', () => {
        const d = load();
        const bare = stripSources(d);
        expect(ondrej(bare).story).not.toHaveProperty('sources');
        // Kronika Lískové is cited by the stories alone (no fact of the tree cites it).
        const kept = applyLivingPrivacy(d, 'initials', 2026, { keepDeceasedSources: true });
        expect(Object.values(kept.sources ?? {}).map(x => x.title)).toContain('Kronika Lískové');
        expect(storySourceIds(ondrej(kept).story)).toEqual(expect.arrayContaining(ondrej(d).story!.sources!));
    });
});

describe('naming the research\'s source codes', () => {
    const d = load();
    it('a code the tree has a source for reads as its title; one it has not stays as it was', () => {
        expect(nameSourceCodes('Roku 1905 prý hořelo [S0002].', d.sources)).toBe('Roku 1905 prý hořelo (Hasiči v Lískové).');
        expect(nameSourceCodes('Svatba (S0003).', d.sources)).toBe('Svatba (Kronika Lískové).');
        expect(nameSourceCodes('Oba [S0001, S0003]', d.sources)).toBe('Oba (Křest Ondřeje 1850; Kronika Lískové)');
        expect(nameSourceCodes('Neznámý [S0164] a půl [S0001, S0164]', d.sources)).toBe('Neznámý [S0164] a půl [S0001, S0164]');
        // Brackets that do not match, a code glued to a word: untouched.
        expect(nameSourceCodes('[S0001) a xS0001', d.sources)).toBe('[S0001) a xS0001');
        expect(nameSourceCodes('Bez pramenů [S0001]', undefined)).toBe('Bez pramenů [S0001]');
    });
});

describe('the section "What the text is based on" (1104)', () => {
    const d = load();
    const s = ondrej(d).story!;
    const S = getStringsForLang('cs');
    const W = storyBasisWords(S);
    const read = (f: string) => storyFactText(f, S, 'cs');

    it('the sources once: the pointers, then the sources the facts cite by code; a code the tree has no source for is left out', () => {
        expect(titles(d, storyBasisSourceIds(d.sources, s))).toEqual(['Křest Ondřeje 1850', 'Hasiči v Lískové', 'Kronika Lískové']);
        // An older file: no pointers, the facts' codes alone.
        expect(titles(d, storyBasisSourceIds(d.sources, { facts: ['BAPM 1850 Lísková [S0002, S0099]', 'EVEN 1905 [S0002]'] })))
            .toEqual(['Hasiči v Lískové']);
        expect(storyBasisSourceIds(d.sources, undefined)).toEqual([]);
    });

    it('a fact line reads as words, never as GEDCOM: the event named, the date of the language, the codes gone', () => {
        expect(read('DEAT 25 SEP 1857 Lhota [S0027]')).toBe('Úmrtí 25. 9. 1857, Lhota');
        expect(read('BAPM 1850 Lísková [S0001]')).toBe('Křest 1850, Lísková');
        expect(read('DEAT BET 24 SEP 1888 AND 7 NOV 1892 Lhota [S0001, S0002]')).toBe('Úmrtí mezi 24. 9. 1888 a 7. 11. 1892, Lhota');
        expect(read('MARR 28 MAY 1839 Lhota [S0027]')).toBe('Sňatek 28. 5. 1839, Lhota');
        expect(read('OCCU Lhota podruh [S0006]')).toBe('Povolání: Lhota podruh');
        expect(read('BIRT 5 MAY 1863 [K-04]')).toBe('Narození 5. 5. 1863 [K-04]');
        // A tag of no name of its own goes; the line goes on with its date.
        expect(read('EVEN 22 FEB 1886 [S0007]')).toBe('22. 2. 1886');
        // Another program's own words keep their words.
        expect(read('krest 1865, Lipany')).toBe('krest 1865, Lipany');
        expect(storyFactText('RESI FROM 22 MAR 1871 TO 22 MAR 1882 Lhota čp. 5 [S0001]', getStringsForLang('de'), 'de'))
            .toBe('Wohnort von 22.3.1871 bis 22.3.1882, Lhota čp. 5');
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
            for (const line of ['BIRT 17 MAR 1812 Lhota [S0027, S1000]', 'RESI ABT 1850 Lhota', 'CHR 3 OCT 1886 Lhota [S1022]', 'MARB 1839 [S0001]']) {
                expect(storyFactText(line, getStringsForLang(lang), lang)).not.toMatch(/\b(BIRT|RESI|CHR|MARB|MAR|OCT|ABT)\b|\[S\d/);
            }
        }
    });

    it('the facts readable and each once, the caveat; the heading counts the sources', () => {
        const b = storyBasisShown(d.sources, { ...s, facts: [...s.facts!, 'BAPM 1850 Lísková [S0001]'] }, read);
        expect(b.facts).toEqual(['Křest 1850, Lísková', read('EVEN NOV 1905 Lísková [S0002]')]);
        expect(b.facts[1]).not.toMatch(/EVEN|NOV/);
        expect(b.note).toBe('Vyprávění, ne pramen.');
        expect(storyBasisHead(b, W)).toBe('Z čeho text vychází (3)');
        expect(storyBasisHead({ sources: [], facts: ['x'], note: '' }, W)).toBe('Z čeho text vychází');
    });

    it('one <details>, folded: the sources (a web address a link to a new window with ↗), the facts, the caveat; nothing to show: nothing', () => {
        const html = storyBasisDetailsHtml(storyBasisShown(d.sources, s, read), W, { cls: 'x' });
        expect(html).toMatch(/^<details class="x"><summary class="x-sum"><span>Z čeho text vychází \(3\)<\/span>/);
        expect(html).not.toContain(' open');
        expect(html.match(/<details/g)).toHaveLength(1);
        expect(html).toContain('<p class="x-h">Prameny</p>');
        expect(html).toContain('<li>Křest Ondřeje 1850</li>');
        expect(html).toContain('<a href="https://obec.example.org/hasici" rel="noopener noreferrer" target="_blank">Hasiči v Lískové ↗</a>');
        expect(html).toContain('<p class="x-h">Fakta</p>');
        expect(html).toContain('<li>Křest 1850, Lísková</li>');
        expect(html).toContain('<p class="x-note">Poznámka autora: Vyprávění, ne pramen.</p>');
        // Each source once: the facts' codes cite sources the pointers already name.
        expect(html.match(/Hasiči v Lískové/g)).toHaveLength(1);
        expect(html).not.toMatch(/BAPM|EVEN|\[S0/);
        expect(storyBasisDetailsHtml({ sources: [], facts: [], note: '' }, W, { cls: 'x' })).toBe('');
        // An address that is no web address is no link.
        const bad: StromData['sources'] = { z: { id: 'z', title: 'Zlý', url: 'javascript:alert(1)' } };
        expect(storyBasisDetailsHtml(storyBasisShown(bad, { sources: ['z'] }, read), W, { cls: 'x' })).not.toContain('href');
    });

    it('the comparison of versions: the same section in each panel; Changes says what the new version adds or leaves out, readable', () => {
        const L = S.story;
        const html = storyCompareHtml({ approved: s, draft: s.draft! }, L, {
            idPrefix: 't', prose: t => `<p>${t}</p>`, name: t => nameSourceCodes(t, d.sources),
            basis: { shown: v => storyBasisShown(d.sources, v, read), words: W },
        });
        expect(html).toContain(`<div class="sc-label">${W.head}</div>`);
        expect(html).toMatch(/sc-line--del"><span class="sc-mark" aria-hidden="true">−<\/span><del[^>]*>Kronika Lískové<\/del>/);
        // The approved text's code named in its panel.
        expect(html).toContain('hořelo (Hasiči v Lískové).');
        expect(html.match(/<details class="sc-basis"/g)).toHaveLength(2);
        expect(html).not.toMatch(/BAPM|EVEN/);
        // Without the section: no facts at all, never raw.
        const bare = storyCompareHtml({ approved: s, draft: s.draft! }, L, { idPrefix: 't', prose: t => `<p>${t}</p>` });
        expect(bare).not.toMatch(/BAPM|EVEN|sc-basis/);
    });
});
