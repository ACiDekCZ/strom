import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { convertHelp, embedHelp, HelpConvertError, parseSince, describedVersions } from '../help-convert.js';
import { HELP_LANGS, type HelpBlock, type HelpChapter, type HelpLang } from '../help-types.js';
import { readHelpSources, VENDOR_DIR, vendorPin } from './help-sources.js';

// --- a small made-up strom-doc in four languages -------------------------------------

const WORDS: Record<HelpLang, {
    controls: string; since: string; research: string; part: string; describes: string; sinceText: string;
}> = {
    cs: { controls: 'Ovládání', since: 'Platí od', research: 'Výzkum', part: 'Výzkum', describes: 'Popisuje výzkum 1.25.2 a aplikaci Strom 3.21.2.', sinceText: 'výzkum 1.27.0' },
    en: { controls: 'Controls', since: 'Since', research: 'Research', part: 'The research', describes: 'Describes the research 1.25.2 and the Strom app 3.21.2.', sinceText: 'research 1.27.0' },
    de: { controls: 'Bedienung', since: 'Gilt seit', research: 'Forschung', part: 'Forschung', describes: 'Beschrieben werden die Forschung 1.25.2 und die Strom-App 3.21.2.', sinceText: 'Forschung 1.27.0' },
    pl: { controls: 'Obsługa', since: 'Obowiązuje od', research: 'Badanie', part: 'Badanie', describes: 'Opisuje badanie 1.25.2 i aplikację Strom 3.21.2.', sinceText: 'badanie 1.27.0' },
};

function chapterR1(lang: HelpLang, extra = ''): string {
    const w = WORDS[lang];
    return [
        '<a id="R1"></a>',
        `# R1 ${w.research} ${lang}`,
        '',
        `Intro ${lang}, see [R1.1](#R1.1). ${w.describes}`,
        'Changes carry their number.',
        '',
        'More intro.',
        '',
        '<a id="R1.1"></a>',
        `## R1.1 Rule one ${lang}`,
        '',
        'Text with **bold**, *italic*, `strom run`, [R1.1.1](#R1.1.1), [chapter](A1-app.md),',
        '[a rule](A1-app.md#A1.1), [web](https://stromapp.info/doc/), [bad](javascript:alert(1)),',
        '[plain](http://example.org), [index](../REJSTRIK.md), [term](../REJSTRIK.md#a-term), bare R1.1.1,',
        '<span style="color:red" onclick="x()">tagged</span> and a placeholder `<n>`.',
        '',
        '- an item',
        '  that goes on',
        '  - a nested item',
        `- **${w.controls}:** menu **Do it**, \`strom do\``,
        `- **${w.since}:** ${w.sinceText}. Details from 1.28.0.`,
        '',
        '<!-- zdroj: research:src/secret.ts:1 -->',
        '',
        '> **Note:** a quoted note',
        '> on two lines.',
        '',
        '| Head A | Head **B** |',
        '|---|---|',
        '| cell `a\\|b` | [R1](#R1) |',
        '',
        '1. first',
        '2. second',
        '',
        '<a id="R1.1.1"></a>',
        `### R1.1.1 Detail ${lang}`,
        '',
        'Detail text.',
        '',
        `- **${w.since}:** something else 1.2.0`,
        extra,
    ].join('\n');
}

function chapterA1(lang: HelpLang): string {
    return ['<a id="A1"></a>', `# A1 App ${lang}`, '', `App intro ${lang}.`, '', '<a id="A1.1"></a>', `## A1.1 App rule ${lang}`, '', 'Text.'].join('\n');
}

function readme(lang: HelpLang): string {
    return [
        `# How ${lang}`, '', 'Intro.', '',
        `## R ${WORDS[lang].part}`, '', `- [R1 ${WORDS[lang].research}](R1-research.md): what the research does`, '',
        '## A The app', '', '- [A1 App](A1-app.md): what the app does', '',
        'Licence: [CC BY 4.0](../LICENSE).',
    ].join('\n');
}

const INDEX = [
    '# Rejstřík', '',
    '<a id="a-term"></a>', '### Pojem', '',
    '| Jazyk | Termín | Definice |', '|---|---|---|',
    '| cs | Pojem (terminál, `run.minutes`) | Definice **cs**. |',
    '| en | Term | Definition en. |',
    '| de | Begriff | Definition de. |',
    '| pl | Pojęcie | Definicja pl. |', '',
    '- **Genealogicky:** nothing',
    '- **Čísla:** [R1.1](cs/R1-research.md#R1.1), A1,',
    '  R1.1.1, `R9.9` in code',
].join('\n');

function mini(change: (files: Record<string, string>) => void = () => {}): Record<string, string> {
    const files: Record<string, string> = { 'REJSTRIK.md': INDEX };
    for (const lang of HELP_LANGS) {
        files[`${lang}/README.md`] = readme(lang);
        files[`${lang}/R1-research.md`] = chapterR1(lang);
        files[`${lang}/A1-app.md`] = chapterA1(lang);
    }
    change(files);
    return files;
}

const chapter = (lang: HelpLang, id: string, files = mini()): HelpChapter =>
    convertHelp(files, 'sha').langs[lang].chapters.find(c => c.id === id)!;

function flatBlocks(blocks: HelpBlock[]): HelpBlock[] {
    return blocks.flatMap(b => (b.k === 'quote' ? [b, ...flatBlocks(b.blocks)] : [b]));
}

// --- conversion ---------------------------------------------------------------------

describe('help conversion: chapters and headings', () => {
    it('orders parts A · R · S and the chapters by part, with titles and contents lines', () => {
        const cs = convertHelp(mini(), 'sha').langs.cs;
        expect(cs.parts).toEqual([{ id: 'A', title: 'The app' }, { id: 'R', title: 'Výzkum' }]);
        expect(cs.chapters.map(c => [c.id, c.part, c.title, c.desc])).toEqual([
            ['A1', 'A', 'App cs', 'what the app does'],
            ['R1', 'R', 'Výzkum cs', 'what the research does'],
        ]);
    });

    it('takes the first paragraph as the intro and keeps the rest of the intro as blocks', () => {
        const r1 = chapter('en', 'R1');
        expect(r1.intro).toBe('Intro en, see R1.1. Describes the research 1.25.2 and the Strom app 3.21.2. Changes carry their number.');
        expect(r1.introC).toContainEqual({ ref: 'R1.1', t: 'R1.1' });
        expect(r1.blocks[0]).toEqual({ k: 'p', c: ['More intro.'] });
    });

    it('turns numbered headings into h blocks by the depth of the number; anchors and comments are gone', () => {
        const r1 = chapter('cs', 'R1');
        const heads = r1.blocks.filter(b => b.k === 'h');
        expect(heads).toEqual([
            { k: 'h', level: 2, id: 'R1.1', title: 'Rule one cs', since: { research: '1.27.0' } },
            { k: 'h', level: 3, id: 'R1.1.1', title: 'Detail cs' },
        ]);
        const json = JSON.stringify(r1);
        expect(json).not.toContain('<a id');
        expect(json).not.toContain('secret');
        expect(json).not.toContain('zdroj');
    });

    it('reads the described versions of the intros (the highest of all chapters)', () => {
        const b = convertHelp(mini(f => {
            f['cs/A1-app.md'] = f['cs/A1-app.md'].replace('App intro cs.', 'Popisuje aplikaci Strom 3.23.0 (a výzkum 1.27.0).');
        }), 'sha');
        expect(b.describes).toEqual({ app: '3.23.0', research: '1.27.0' });
        expect(b.docVersion).toBe('sha');
        expect(describedVersions('Describes the research 1.25.2 and 1.26.0 (reading does not change).')).toEqual({ research: '1.26.0' });
        expect(describedVersions('Beschrieben wird die App 3.21.2.')).toEqual({ app: '3.21.2' });
    });
});

describe('help conversion: Controls / Since', () => {
    it.each(HELP_LANGS)('makes the %s Controls and Since lines a meta block, the rest of the list stays', lang => {
        const blocks = chapter(lang, 'R1').blocks;
        const i = blocks.findIndex(b => b.k === 'meta');
        expect(blocks[i - 1]).toEqual({
            k: 'ul', items: [['an item that goes on']], sub: [{ k: 'ul', items: [['a nested item']] }],
        });
        expect(blocks[i]).toEqual({
            k: 'meta', items: [
                { label: WORDS[lang].controls, c: ['menu ', { b: 'Do it' }, ', ', { code: 'strom do' }] },
                { label: WORDS[lang].since, c: [`${WORDS[lang].sinceText}. Details from 1.28.0.`], since: true },
            ],
        });
    });

    it('gives a heading no since when its Since line is not understood', () => {
        const detail = chapter('pl', 'R1').blocks.find(b => b.k === 'h' && b.id === 'R1.1.1');
        expect(detail).toEqual({ k: 'h', level: 3, id: 'R1.1.1', title: 'Detail pl' });
    });

    it.each([
        ['výzkum 1.27.0', { research: '1.27.0' }],
        ['aplikace 3.24.0', { app: '3.24.0' }],
        ['aplikace 3.11.0 s výzkumem 1.14.0', { app: '3.11.0', research: '1.14.0' }],
        ['výzkum 1.12.0, aplikace 3.9.0', { research: '1.12.0', app: '3.9.0' }],
        ['výzkum 1.27.0, aplikace Strom 3.23.0', { research: '1.27.0', app: '3.23.0' }],
        ['aplikace 3.11.0 (výzkum 1.14.0)', { app: '3.11.0', research: '1.14.0' }],
        ['výzkum 1.0.0. Místa od 1.26.0.', { research: '1.0.0' }],
        ['výzkum 1.0.0 (klíče 1, 7–10). Klíč 6 od 1.1.0', { research: '1.0.0' }],
        ['výzkum 1.0.0 (--max, --until), --loop od 1.2.0', { research: '1.0.0' }],
        ['výzkum 1.24.0 (regiony), výzkum 1.25.0 (návrh)', { research: '1.24.0' }],
        ['research 1.27.0', { research: '1.27.0' }],
        ['app 3.11.0 with research 1.14.0', { app: '3.11.0', research: '1.14.0' }],
        ['research 1.27.0, Strom app 3.23.0', { research: '1.27.0', app: '3.23.0' }],
        ['app 3.11.0 (research 1.14.0)', { app: '3.11.0', research: '1.14.0' }],
        ['Forschung 1.27.0', { research: '1.27.0' }],
        ['App 3.11.0 mit Forschung 1.14.0', { app: '3.11.0', research: '1.14.0' }],
        ['Forschung 1.12.0, Strom-App 3.9.0', { research: '1.12.0', app: '3.9.0' }],
        ['App 3.24.0', { app: '3.24.0' }],
        ['badanie 1.27.0', { research: '1.27.0' }],
        ['aplikacja 3.11.0 z badaniem 1.14.0', { app: '3.11.0', research: '1.14.0' }],
        ['badanie 1.12.0, aplikacja Strom 3.9.0', { research: '1.12.0', app: '3.9.0' }],
        ['aplikacja 3.11.0 (badanie 1.14.0)', { app: '3.11.0', research: '1.14.0' }],
    ])('reads the since of "%s"', (text, since) => {
        expect(parseSince(text)).toEqual(since);
    });

    it.each([
        'výchozí osoba aplikace 1.0.0; volba pohledu aplikace 3.21.0',
        'aplikace 3.9.0 nebo dřív (značky do 3.19.0)',
        'timeline app 1.5.0; the row of history app 3.19.0',
        'sometime',
        '',
    ])('leaves "%s" without a since', text => {
        expect(parseSince(text)).toBeNull();
    });
});

describe('help conversion: inline text and links', () => {
    const para = (lang: HelpLang = 'cs') => {
        const blocks = chapter(lang, 'R1').blocks;
        const i = blocks.findIndex(b => b.k === 'h' && b.id === 'R1.1');
        return (blocks[i + 1] as { c: unknown[] }).c;
    };

    it('keeps bold, italic and code, links to numbers become refs, https links urls', () => {
        expect(para()).toEqual([
            'Text with ', { b: 'bold' }, ', ', { i: 'italic' }, ', ', { code: 'strom run' }, ', ',
            { ref: 'R1.1.1', t: 'R1.1.1' }, ', ', { ref: 'A1', t: 'chapter' }, ', ', { ref: 'A1.1', t: 'a rule' }, ', ',
            { url: 'https://stromapp.info/doc/', t: 'web' }, ', bad, plain, ',
            { ref: 'index', t: 'index' }, ', ', { ref: 'index#a-term', t: 'term' }, ', bare R1.1.1, tagged and a placeholder ',
            { code: '<n>' }, '.',
        ]);
    });

    it('passes no HTML, styles or handlers on', () => {
        const json = JSON.stringify(convertHelp(mini(), 'sha'));
        expect(json).not.toMatch(/<span|style=|onclick|javascript:|http:\/\//);
    });

    it('reads tables (an escaped pipe stays in its cell) and block quotes', () => {
        const blocks = flatBlocks(chapter('cs', 'R1').blocks);
        expect(blocks.find(b => b.k === 'table')).toEqual({
            k: 'table', head: ['Head A', 'Head B'], rows: [[[ 'cell ', { code: 'a|b' }], [{ ref: 'R1', t: 'R1' }]]],
        });
        expect(blocks.find(b => b.k === 'quote')).toEqual({
            k: 'quote', blocks: [{ k: 'p', c: [{ b: 'Note:' }, ' a quoted note on two lines.'] }],
        });
        expect(blocks.find(b => b.k === 'ol')).toEqual({ k: 'ol', items: [['first'], ['second']] });
    });
});

describe('help conversion: failures', () => {
    it('fails on a link to a number the language does not have, naming file, language and number', () => {
        const files = mini(f => { f['de/R1-research.md'] += '\n\nSee [R1.9](#R1.9).'; });
        expect(() => convertHelp(files, 'sha')).toThrow(HelpConvertError);
        expect(() => convertHelp(files, 'sha')).toThrow('de/R1-research.md: a link leads to R1.9, which the de text does not have');
    });

    it('fails on a link to a chapter file of a missing chapter', () => {
        const files = mini(f => { f['en/A1-app.md'] += '\n\nSee [S1](S1-phone.md).'; });
        expect(() => convertHelp(files, 'sha')).toThrow('en/A1-app.md: a link leads to S1, which the en text does not have');
    });

    it('fails when a language lacks a chapter another language has', () => {
        const files = mini(f => { delete f['pl/A1-app.md']; });
        expect(() => convertHelp(files, 'sha')).toThrow('pl has no chapter A1');
    });

    it('fails when the index refers to a number that is not there', () => {
        const files = mini(f => { f['REJSTRIK.md'] += ', R4.4'; });
        expect(() => convertHelp(files, 'sha')).toThrow('the term "a-term" leads to R4.4');
    });

    it('fails on a link to a term the index does not have', () => {
        const files = mini(f => { f['cs/A1-app.md'] += '\n\n[x](../REJSTRIK.md#no-such)'; });
        expect(() => convertHelp(files, 'sha')).toThrow('#no-such');
    });
});

describe('help conversion: the index of terms', () => {
    it('gives each language its term, definition and the numbers of "Čísla"', () => {
        const b = convertHelp(mini(), 'sha');
        expect(b.langs.cs.terms).toEqual([
            { id: 'a-term', term: 'Pojem (terminál, run.minutes)', def: 'Definice cs.', refs: ['R1.1', 'A1', 'R1.1.1'] },
        ]);
        expect(b.langs.pl.terms[0]).toEqual({ id: 'a-term', term: 'Pojęcie', def: 'Definicja pl.', refs: ['R1.1', 'A1', 'R1.1.1'] });
    });
});

// --- the pinned strom-doc ---------------------------------------------------------------

describe('help conversion: vendor/strom-doc', () => {
    const files = readHelpSources(VENDOR_DIR);
    const bundle = convertHelp(files, vendorPin());

    it('is the commit package.json pins', () => {
        const pkg = JSON.parse(readFileSync(join(VENDOR_DIR, '..', '..', 'package.json'), 'utf-8'));
        expect(pkg.stromDoc).toMatch(/^[0-9a-f]{40}$/);
        expect(vendorPin()).toBe(pkg.stromDoc);
        expect(bundle.docVersion).toBe(pkg.stromDoc);
    });

    it('has in every language exactly the written numbers of CISLA.md, every "platí" one among them', () => {
        const rows = readFileSync(join(VENDOR_DIR, 'CISLA.md'), 'utf-8').split('\n')
            .filter(l => /^\|\s*[ARS]\d/.test(l))
            .map(l => l.split('|').map(c => c.trim()));
        const written = rows.filter(r => r[4] !== 'plán').map(r => r[1]).sort();
        const valid = rows.filter(r => r[4] === 'platí').map(r => r[1]);
        expect(valid.length).toBeGreaterThan(200);
        for (const lang of HELP_LANGS) {
            const ids: string[] = [];
            for (const c of bundle.langs[lang].chapters) {
                ids.push(c.id);
                for (const b of flatBlocks(c.blocks)) if (b.k === 'h') ids.push(b.id);
            }
            expect(ids.slice().sort(), lang).toEqual(written);
            for (const n of valid) expect(ids, `${lang} ${n}`).toContain(n);
        }
    });

    it('has the parts, the index and the same since per rule in all languages', () => {
        const sinceOf = (lang: HelpLang) => Object.fromEntries(bundle.langs[lang].chapters.flatMap(c =>
            c.blocks.filter(b => b.k === 'h').map(b => [b.id, (b as { since?: unknown }).since ?? null])));
        for (const lang of HELP_LANGS) {
            const d = bundle.langs[lang];
            expect(d.parts.map(p => p.id)).toEqual(['A', 'R', 'S']);
            expect(d.terms.length).toBeGreaterThan(50);
            expect(d.chapters.every(c => c.title && c.desc && c.intro)).toBe(true);
            expect(sinceOf(lang)).toEqual(sinceOf('cs'));
        }
        expect(bundle.describes.app).toMatch(/^\d+\.\d+\.\d+$/);
        expect(bundle.describes.research).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('survives deflate → base64 → inflate unchanged', () => {
        const embedded = embedHelp(bundle, d => deflateRawSync(d, { level: 9 }));
        expect(embedded.docVersion).toBe(bundle.docVersion);
        expect(embedded.describes).toEqual(bundle.describes);
        for (const lang of HELP_LANGS) {
            const json = inflateRawSync(Buffer.from(embedded.langs[lang]!, 'base64')).toString('utf-8');
            expect(json).toBe(JSON.stringify(bundle.langs[lang]));
        }
    });
});
