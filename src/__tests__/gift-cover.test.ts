/**
 * "Give a family tree" (spec 093 §6, K6.4): the cover page "Start here.html"
 * and the cover letter's templates. The page in the letter's language with
 * no script, relative links to the parts that are in the package only, the
 * Christmas motif (band, twig, ornament) only with the motif, a couple, the
 * footer's sentence about shortened details only when the protection
 * shortens anything, no hidden detail of a living person; the templates by
 * language, gender and couple, the salutation put in, the message escaped.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDemoTree } from '../demo-tree.js';
import type { PersonId, StromData } from '../types.js';
import {
    defaultGiftParts, defaultGiftPrivacy, giftProtectedData, giftShortensLiving,
    type GiftCut, type GiftLang, type GiftLetter, type GiftParts, type GiftPrivacy,
} from '../gift-tree.js';
import { buildGiftPackage, giftMessage, type GiftCoverFile, type GiftCoverInfo } from '../gift-package.js';
import { buildGiftCover, giftDefaultSalutation, giftFacts, giftLetterTemplate } from '../gift-cover.js';
import { getStringsForLang } from '../strings.js';
import { blobBytes, zipFiles } from './helpers/zip-read.js';

const P = (key: string) => `demo_${key}` as PersonId;
const NOW = new Date(2026, 11, 20, 14, 0, 0);
const EMAIL = 'eva.test@example.invalid';
const ADDRESS = 'Elm Street 12';
const LANGS: GiftLang[] = ['cs', 'en', 'de', 'pl'];

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); });

/** The demo tree (Berg family) with invented sensitive details of the living. */
function sensitiveTree(): StromData {
    const d = getDemoTree();
    for (const key of ['eva', 'nora', 'julia']) {
        const p = d.persons[P(key)];
        p.emails = [EMAIL];
        p.notes = `E-mail: ${EMAIL}`;
        p.birthAddress = ADDRESS;
    }
    return d;
}

const cutOf = (...keys: string[]): GiftCut => ({ recipients: keys.map(P), depth: 2, branches: {} });

const FILES: Record<GiftLang, GiftCoverFile[]> = Object.fromEntries(LANGS.map(lang => {
    const F = getStringsForLang(lang).giftTree.files;
    return [lang, [
        { part: 'app', path: F.app, bytes: 5_100_000 },
        { part: 'pages', path: `${F.pages}/index.html`, bytes: 9_000 },
        { part: 'book', path: F.book, bytes: 400_000 },
        { part: 'fan', path: `${F.fan}.svg`, bytes: 90_000 },
        { part: 'gedcom', path: `${F.gedcomFolder}/${F.gedcom}`, bytes: 30_000 },
    ]];
})) as Record<GiftLang, GiftCoverFile[]>;

function letterOf(lang: GiftLang, motif: GiftLetter['motif'] = 'none', message = 'A short note.'): GiftLetter {
    return { lang, motif, salutation: 'Daniel', message, signature: 'Grandma', date: '2026-12-24' };
}

function coverOf(opts: {
    lang?: GiftLang; keys?: string[]; motif?: GiftLetter['motif']; message?: string;
    parts?: Partial<GiftParts>; privacy?: GiftPrivacy; photos?: boolean;
} = {}): string {
    const lang = opts.lang ?? 'en';
    const keys = opts.keys ?? ['daniel'];
    const cut = cutOf(...keys);
    const privacy = opts.privacy ?? defaultGiftPrivacy();
    const source = sensitiveTree();
    const data = giftProtectedData(source, cut, privacy, { photos: opts.photos ?? true, currentYear: 2026 });
    const parts = { ...defaultGiftParts(), ...(opts.parts ?? {}) };
    const info: GiftCoverInfo = {
        lang, recipients: cut.recipients, names: keys.map(k => `${data.persons[P(k)].firstName} ${data.persons[P(k)].lastName}`),
        parts, files: FILES[lang].filter(f => parts[f.part]), letter: letterOf(lang, opts.motif, opts.message),
        treeName: 'Berg', persons: 0, photos: opts.photos ?? true, folder: getStringsForLang(lang).giftTree.files.folder('Daniel Berg'),
        now: NOW, shortened: giftShortensLiving(source, cut, privacy, 2026),
    };
    return buildGiftCover(data, info);
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map(m => m[1]);

describe('the cover page (§6)', () => {
    it('in the letter\'s language, without a script, with relative links to every part', () => {
        for (const lang of LANGS) {
            const C = getStringsForLang(lang).giftTree.cover;
            const html = coverOf({ lang });
            expect(html).toContain(`<html lang="${lang}">`);
            expect(html).not.toMatch(/<script/i);
            expect(html).not.toMatch(/\son[a-z]+=/i);
            for (const text of [C.whatH, C.numbersH, C.parts.app.t, C.parts.pages.t, C.parts.book.t, C.parts.gedcom.t, C.unzip, C.chartH]) {
                expect(html).toContain(text.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;'));
            }
            const links = hrefs(html);
            expect(links).toHaveLength(5);
            for (const href of links) expect(href).not.toMatch(/^(?:[a-z]+:|\/)/i);
            expect(links).toContain(FILES[lang][0].path.split('/').map(encodeURIComponent).join('/'));
            expect(html).toContain(C.created(lang === 'en' ? '20 Dec 2026' : lang === 'cs' ? '20. 12. 2026' : '20.12.2026'));
        }
        // The Czech page: the stats from the cut, the oldest ancestor and the generations.
        const cs = coverOf({ lang: 'cs' });
        expect(cs).toContain('<strong>28</strong> osob');
        expect(cs).toContain('Peter Berg, kolem 1798, Voss');
        expect(cs).toContain('předci až do roku 1798');
        expect(cs).toContain('Voss → Minneapolis → Seattle');
    });

    it('links only to the parts in the package; the app card first and framed', () => {
        const html = coverOf({ parts: { pages: false, book: false, fan: false } });
        const links = hrefs(html);
        expect(links).toEqual([encodeURIComponent('Family tree (app).html'), ['For other programs', 'Family tree.ged'].map(encodeURIComponent).join('/')]);
        expect(html).toMatch(/<a class="sp-card gl-card gl-main" href="Family%20tree%20\(app\)\.html">/);
        expect(html).not.toContain('Family book');
        expect(html).not.toContain('class="gl-fan"');
        // The printed list names the same parts.
        expect(html.match(/class="sp-toc-row"/g)).toHaveLength(3);
    });

    it('the Christmas motif adds the band, the twig and the ornament; without it none', () => {
        const xmas = coverOf({ lang: 'cs', motif: 'xmas' });
        expect(xmas).toContain('class="gl-page gl-xmas"');
        expect(xmas).toContain('<div class="gl-band"');
        // The band sits in the header, so it grows with a long name or the numbers on two lines.
        expect(xmas).toContain('<header class="sp-head gl-head"><div class="gl-band"');
        expect(xmas).toContain('<svg class="gl-twig"');
        expect(xmas).toContain('class="gl-orn"');
        expect(xmas).toContain('Vánoce 2026 · Rodokmen');
        const page = coverOf({ lang: 'cs' });
        const plain = page.slice(page.indexOf('<body>'));
        expect(plain).not.toContain('gl-xmas');
        expect(plain).not.toContain('<div class="gl-band"');
        expect(plain).not.toContain('gl-twig');
        expect(plain).not.toContain('class="gl-orn"');
        expect(plain).toContain('<span class="sp-kicker">Rodokmen</span>');
    });

    it('a couple: both names, a fan card for each, no birth line of one of them', () => {
        const F = getStringsForLang('en').giftTree.files;
        const lang: GiftLang = 'en';
        const cut = cutOf('daniel', 'julia');
        const data = giftProtectedData(sensitiveTree(), cut, defaultGiftPrivacy(), { photos: true, currentYear: 2026 });
        const html = buildGiftCover(data, {
            lang, recipients: cut.recipients, names: ['Daniel Berg', 'Julia Novak'], parts: defaultGiftParts(),
            files: [
                { part: 'app', path: F.app, bytes: 1000 },
                { part: 'fan', path: `${F.fanOf('Daniel Berg')}.svg`, bytes: 1000 },
                { part: 'fan', path: `${F.fanOf('Julia Novak')}.svg`, bytes: 1000 },
            ],
            letter: letterOf(lang), treeName: 'Berg', persons: 0, photos: true, folder: 'Family tree – Daniel Berg and Julia Novak', now: NOW,
        });
        expect(html).toContain('<h1 class="sp-h1">Daniel Berg and Julia Novak</h1>');
        expect(html.match(/class="gl-fan"/g)).toHaveLength(2);
        expect(html).toContain('Ancestor fan – Julia Novak');
        expect(html).not.toContain('* 1972');
    });

    it('a single recipient: the birth year and place under the name', () => {
        expect(coverOf()).toContain('* 1972, Seattle · ancestors back to 1798');
    });

    it('the footer says details are shortened only when the protection shortens something', () => {
        for (const lang of LANGS) {
            const C = getStringsForLang(lang).giftTree.cover;
            expect(coverOf({ lang })).toContain(C.shortened);
            const open: GiftPrivacy = {
                ...defaultGiftPrivacy(), others: 'full',
                sensitive: { birthDates: true, addresses: true, contacts: true, photos: true, notes: true, religion: true, sources: true },
            };
            expect(coverOf({ lang, privacy: open })).not.toContain(C.shortened);
        }
    });

    it('K6.4: no hidden detail of a living person on the page', () => {
        for (const lang of LANGS) {
            for (const motif of ['none', 'xmas'] as const) {
                const html = coverOf({ lang, motif, keys: ['daniel'] });
                expect(html).not.toContain(EMAIL);
                expect(html).not.toContain(ADDRESS);
            }
        }
        // A living person outside the household is never named in full (initials by default).
        const html = coverOf({ lang: 'en' });
        expect(html).not.toContain('Jonas Holm');
    });

    it('the message keeps its line breaks and shows markup as text', () => {
        const html = coverOf({ message: '[name],\n\n<script>alert(1)</script> & "quotes"' });
        expect(html).not.toMatch(/<script/i);
        expect(html).toContain('<div class="gl-msg-t">Daniel,\n\n&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;</div>');
        expect(html).toContain('<p class="gl-sig"><b>Grandma</b>24 Dec 2026</p>');
    });

    it('a portrait only when photos passed the protection', () => {
        const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
        const source = sensitiveTree();
        source.persons[P('daniel')].photo = PNG;
        const cut = cutOf('daniel');
        const base: Omit<GiftCoverInfo, 'photos'> = {
            lang: 'en', recipients: cut.recipients, names: ['Daniel Berg'], parts: defaultGiftParts(), files: [],
            letter: letterOf('en'), treeName: 'Berg', persons: 0, folder: 'x', now: NOW,
        };
        const withPhotos = giftProtectedData(source, cut, defaultGiftPrivacy(), { photos: true, currentYear: 2026 });
        expect(buildGiftCover(withPhotos, { ...base, photos: true })).toContain('<img class="gl-av"');
        const without = giftProtectedData(source, cut, defaultGiftPrivacy(), { photos: false, currentYear: 2026 });
        expect(buildGiftCover(without, { ...base, photos: false })).not.toContain('<img');
    });

    it('the package holds the real cover page as its last entry', async () => {
        const settings = {
            cut: cutOf('daniel'), privacy: defaultGiftPrivacy(),
            parts: { ...defaultGiftParts(), pages: false, book: false, fan: false },
            photos: false, letter: letterOf('cs', 'xmas', '[oslovení], hezké svátky.'),
        };
        const r = await buildGiftPackage({
            data: sensitiveTree(), settings, treeName: 'Berg',
            env: { now: NOW, app: async () => new Blob(['<html></html>']) },
        });
        const files = zipFiles(await blobBytes(r.blob));
        const start = new TextDecoder().decode(files.get(`${r.folder}/Začít zde.html`)!);
        expect(start).toContain('<html lang="cs">');
        expect(start).not.toMatch(/<script/i);
        expect(start).toContain('Daniel, hezké svátky.');
        expect(start).toContain(getStringsForLang('cs').giftTree.cover.shortened);
        expect(hrefs(start)).toEqual([encodeURIComponent('Rodokmen (aplikace).html'), ['Pro jiné programy', 'Rodokmen.ged'].map(encodeURIComponent).join('/')]);
        expect(start).not.toContain(EMAIL);
    });
});

describe('the facts of the cut', () => {
    it('the oldest ancestor, the lineages, the places and the generations from the data given', () => {
        const data = giftProtectedData(sensitiveTree(), cutOf('daniel'), defaultGiftPrivacy(), { photos: false, currentYear: 2026 });
        const f = giftFacts(data, [P('daniel')], 'en', NOW);
        expect(f.oldest).toMatchObject({ id: P('peter'), year: 1798, approx: true, place: 'Voss' });
        expect(f.rods[0]).toBe('Berg');
        expect(f.places.slice(0, 2)).toEqual(['Voss', 'Bergen']);
        expect(f.years).toBe(2026 - 1798);
        expect(f.byGeneration.reduce((a, b) => a + b, 0)).toBe(f.persons);
        expect(f.oldestRecord).toEqual({ label: 'Birth', name: 'Johan Berg', place: 'Voss', year: 1825 });
    });
});

describe('the letter\'s templates (§6)', () => {
    const greeting: Record<GiftLang, { male: string; female: string; couple: string }> = {
        cs: { male: 'Pro: [oslovení]\n\n', female: 'Pro: [oslovení]\n\n', couple: 'Pro: [oslovení]\n\n' },
        en: { male: 'Dear [name],', female: 'Dear [name],', couple: 'Dear [name],' },
        de: { male: 'Lieber [Name],', female: 'Liebe [Name],', couple: 'Liebe [Name],' },
        pl: { male: 'Dla: [imię]\n\n', female: 'Dla: [imię]\n\n', couple: 'Dla: [imię]\n\n' },
    };
    const closing: Record<GiftLang, string> = { cs: 'Krásné Vánoce!', en: 'Merry Christmas!', de: 'Frohe Weihnachten!', pl: 'Wesołych Świąt!' };
    const plural: Record<GiftLang, string> = { cs: 'vaše předky', en: 'your ancestors', de: 'eure Vorfahren', pl: 'waszych przodków' };
    const single: Record<GiftLang, string> = { cs: 'tvé předky', en: 'your ancestors', de: 'deine Vorfahren', pl: 'twoich przodków' };

    it('greets by gender, a couple in the plural; the motif closes; the figures of the cut', () => {
        const tree = getDemoTree();
        for (const lang of LANGS) {
            const date = '2026-12-24';
            const daniel = giftLetterTemplate(tree, cutOf('daniel'), { lang, motif: 'none', date });
            const nora = giftLetterTemplate(tree, cutOf('nora'), { lang, motif: 'xmas', date });
            const couple = giftLetterTemplate(tree, cutOf('daniel', 'julia'), { lang, motif: 'xmas', date });
            expect(daniel.startsWith(greeting[lang].male)).toBe(true);
            expect(nora.startsWith(greeting[lang].female)).toBe(true);
            expect(couple.startsWith(greeting[lang].couple)).toBe(true);
            expect(daniel).toContain(single[lang]);
            expect(couple).toContain(plural[lang]);
            expect(daniel).not.toContain(closing[lang]);
            expect(nora.endsWith(closing[lang])).toBe(true);
            expect(daniel).toContain('Peter Berg');
            expect(daniel).toContain('1798');
            expect(daniel).toContain('Voss');
            expect(daniel).toContain('28');
            expect(daniel).toContain('228');
        }
    });

    it('the salutation goes in for every language\'s placeholder', () => {
        for (const lang of LANGS) {
            const message = giftLetterTemplate(getDemoTree(), cutOf('daniel'), { lang, motif: 'none', date: '2026-12-24' });
            const out = giftMessage({ message, salutation: 'Danieli' });
            expect(out).toMatch(/^\S+ Danieli[,\n]/);
            expect(out).not.toMatch(/\[(?:oslovení|name|Name|imię)\]/);
        }
    });

    it('the default salutation (the first name as it is) never stands in a vocative greeting in cs and pl', () => {
        // The app declines no names: "Milý Daniel," / "Drogi Daniel," would be wrong,
        // so the greeting there is a label ("Pro: Daniel") the nominative fits.
        const tree = getDemoTree();
        const expected: Partial<Record<GiftLang, string>> = { cs: 'Pro: Daniel\n\nPosílám', pl: 'Dla: Daniel\n\nPrzesyłam' };
        for (const lang of ['cs', 'pl'] as const) {
            for (const motif of ['none', 'xmas'] as const) {
                const message = giftLetterTemplate(tree, cutOf('daniel'), { lang, motif, date: '2026-12-24' });
                const out = giftMessage({ message, salutation: giftDefaultSalutation(tree.persons[P('daniel')], lang) });
                expect(out).not.toMatch(/\b(?:Milý|Milá|Milí|Drogi|Droga|Drodzy) Daniel/);
                if (motif === 'none') expect(out.startsWith(expected[lang]!)).toBe(true);
            }
        }
    });

    it('a living oldest ancestor is not named', () => {
        // Daniel without parents: Adam's ancestors are his living parents only.
        const tree = getDemoTree();
        delete tree.partnerships['demo_u_martin_sarah' as keyof typeof tree.partnerships];
        tree.persons[P('daniel')].parentIds = [];
        for (const key of ['martin', 'sarah']) {
            const p = tree.persons[P(key)];
            p.childIds = [];
            p.partnerships = p.partnerships.filter(u => u !== 'demo_u_martin_sarah');
        }
        const text = giftLetterTemplate(tree, cutOf('adam'), { lang: 'en', motif: 'none', date: '2026-12-24' });
        expect(text).toContain('your ancestors');
        expect(text).not.toContain('Daniel Berg');
        expect(text).not.toContain('Julia Novak');
        expect(text).not.toContain('The oldest of them');
    });

    it('the default salutation is the first name; a couple joined by the language', () => {
        const tree = getDemoTree();
        expect(giftDefaultSalutation(tree.persons[P('daniel')], 'cs')).toBe('Daniel');
        expect(giftDefaultSalutation([tree.persons[P('daniel')], tree.persons[P('julia')]], 'de')).toBe('Daniel und Julia');
        expect(giftDefaultSalutation([tree.persons[P('daniel')], tree.persons[P('julia')]], 'pl')).toBe('Daniel i Julia');
    });
});
