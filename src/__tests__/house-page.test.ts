/**
 * The house page (spec 030 §3, K3.1, K3.2, K7.1): only the sections with
 * content, the origin tags of the timeline, holders and residents as tables,
 * and the saved file (mode 'file') without the facts of people of the last
 * ~100 years, the living's own name and the sensitive event (K1.4a, K3.3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonId, StromData } from '../types.js';
import type { HouseResearch } from '../house-bridge.js';
import { collectHouses, type TreeHouse } from '../houses.js';
import {
    buildHousePage, buildHousePageDocument, housePageFileName, housePageSections, houseTreeRows, mapHtml,
} from '../house-page.js';
import { HOUSE_ID, HOUSE_NOW, LIVING_NAME, OLD_HOUSE_ID, SENSITIVE_TEXT, houseResearch, houseTree } from './helpers/house-book-fixture.js';

const houseOf = (data: StromData, id: string): TreeHouse => collectHouses(data).find(h => h.id === id)!;
const opts = { lang: 'en' as const, now: HOUSE_NOW };

/** The research's result with a source record, an import, a conjecture, a renumbering, questions and materials. */
function fullResearch(): HouseResearch {
    const r = houseResearch();
    r.timeline.push(
        { id: 'e20', kind: 'other', date: '1871', text: 'Nový krov podle pamětníků', origin: 'import', sources: [] },
        { id: 'e21', kind: 'other', date: '1810', text: 'Snad starší chalupa na místě', certainty: 'guess', sources: [] },
    );
    r.numbers = [
        { id: 'n1', number: '16', from: '1836', sources: [{ source: 'S0001', page: 'f. 12' }] },
        { id: 'n2', number: '9', to: '1835', proposed: true, sources: [] },
    ];
    r.unknown = [{ id: 'u1', text: 'Kdo dům držel 1912–1913?', question: 'Q0001' }];
    r.passed = [{ id: 'p1', what: 'Indikační skica 1840', found: false, at: '2026-10-02' }];
    r.archiveOnly = [{ id: 'a1', archive: 'Oblastní archiv Brodek', fond: 'Velkostatek Brodek', what: 'Gruntovní kniha 1790' }];
    r.materials = [{ id: 'm1', kind: 'memory', title: 'Vzpomínka na kůlnu', witness: 'Kvido Stranný', text: 'Kůlna stála za domem.', at: '2026-11-01' }];
    r.look = { text: 'Zděné přízemní stavení se dvěma okny do návsi.', images: [] };
    return r;
}

function dataWithSources(): StromData {
    const data = houseTree();
    data.sources = {
        s1: { id: 's1', title: 'Matrika Bělokamen 1820–1860', refn: 'S0001' },
        s3: { id: 's3', title: 'Pozemková kniha Bělokamen', refn: 'S0003', url: 'https://example.org/pk' },
    } as unknown as StromData['sources'];
    return data;
}

describe('house page — app', () => {
    it('shows the sections with content, in order, and leaves out the empty ones', () => {
        const data = dataWithSources();
        const html = buildHousePage(data, houseOf(data, HOUSE_ID), fullResearch(), 'app', opts);
        const keys = housePageSections(html, 'en').map(s => s.key);
        expect(keys).toEqual(['sum', 'numbers', 'timeline', 'people', 'look', 'map', 'unknown', 'passed', 'sources']);
        // The map of the point placed by hand (§4); no tree-only residents beside the research's.
        expect(html).toContain('id="hp-sec-map"');
        expect(html).not.toContain('id="hp-sec-treeResidents"');
        expect(html).toContain('told by Kvido Stranný');
        expect(mapHtml({ mode: 'app', lang: 'en', house: houseOf(data, HOUSE_ID), research: null, location: null, layers: [] })).toBe('');
    });

    it('the empty research leaves only the header, the numbers and the tree', () => {
        const data = houseTree();
        const r = houseResearch();
        Object.assign(r, { holders: [], residents: [], timeline: [], location: undefined });
        const html = buildHousePage(data, houseOf(data, HOUSE_ID), r, 'app', { ...opts, research: true, state: 'queued' });
        const keys = housePageSections(html, 'en').map(s => s.key);
        expect(keys).toEqual(['sum', 'numbers', 'timeline', 'treeResidents', 'map']);
        expect(html).toContain('The house history is in the research queue');
        expect(html).not.toContain('id="hp-sec-people"');
        expect(html).not.toContain('id="hp-sec-sources"');
    });

    it('tags the timeline by origin: research, own research, conjecture, the tree untagged', () => {
        const data = dataWithSources();
        const html = buildHousePage(data, houseOf(data, HOUSE_ID), fullResearch(), 'app', opts);
        const row = (text: string): string => {
            const at = html.indexOf(text);
            const start = html.lastIndexOf('<div class="hp-tl-r', at);
            return html.slice(start, html.indexOf('</div></div>', at));
        };
        expect(row('Stavení postaveno')).toContain('hp-otag--res');
        expect(row('Stavení postaveno')).toContain('Matrika Bělokamen 1820–1860');
        expect(row('Nový krov')).toContain('hp-otag--own');
        expect(row('Nový krov')).toContain('from own research');
        expect(row('Snad starší chalupa')).toContain('hp-otag--guess');
        expect(row('Snad starší chalupa')).not.toContain('hp-otag--res');
        // A tree's record: no origin tag; the married-in wife's wedding carries her tag.
        const tree = html.slice(html.indexOf('hp-tl-r--tree'));
        expect(tree.slice(0, tree.indexOf('</div></div>'))).not.toContain('hp-otag--res');
        expect(html).toContain('hp-otag--mar');
        // The app marks the sensitive event, with its reveal.
        expect(row(SENSITIVE_TEXT)).toContain('hidden in outputs');
    });

    it('holders and residents are tables, with a gap "not known" and a stranger outside the tree', () => {
        const data = dataWithSources();
        const html = buildHousePage(data, houseOf(data, HOUSE_ID), fullResearch(), 'app', opts);
        expect((html.match(/<table class="hp-table">/g) ?? []).length).toBe(2);
        expect(html).toContain('<th>How the house was acquired</th>');
        expect(html).toContain('inheritance');
        expect(html).toContain('not known');
        expect(html).toContain('Kvido Stranný <span class="hp-ext-rl">· outside the tree');
        expect(html).toContain('A resident is not the same as an owner.');
        // A holder of the tree is a link to the person.
        expect(html).toContain('data-person-id="svatobor"');
    });

    it('the proposal of a renumbering carries Confirm and Not the same house only when it may be confirmed', () => {
        const data = dataWithSources();
        const house = houseOf(data, HOUSE_ID);
        const off = buildHousePage(data, house, fullResearch(), 'app', opts);
        expect(off).toContain('hp-num--prop');
        expect(off).not.toContain('data-hp-act="renumber"');
        const on = buildHousePage(data, house, fullResearch(), 'app', { ...opts, app: { canConfirm: true } });
        expect(on).toContain('data-hp-act="renumber" data-number="n2"');
        expect(on).toContain('data-hp-act="not-same" data-number="n2"');
        expect(on).toContain('čp.\u00a09');
    });

    it('in brief: one family N years, the numbers, the generations, the oldest record (K3.2)', () => {
        const data = houseTree();
        const house = houseOf(data, HOUSE_ID);
        const html = buildHousePage(data, house, null, 'app', opts);
        const sum = html.slice(html.indexOf('id="hp-sec-sum"'), html.indexOf('</section>', html.indexOf('id="hp-sec-sum"')));
        expect(sum).toContain('generations');
        expect(sum).toContain('oldest record');
        expect(sum).toContain(`>${Math.min(...house.facts.map(f => f.year ?? 9999))}<`);
        if (house.familyYears) expect(sum).toContain('one family');
    });

    it('a tree without a research: the tree residents and the quiet sentence', () => {
        const data = houseTree();
        const html = buildHousePage(data, houseOf(data, HOUSE_ID), null, 'app', opts);
        expect(html).toContain('id="hp-sec-treeResidents"');
        expect(html).toContain('This page is built from the records in the tree.');
        const research = buildHousePage(data, houseOf(data, HOUSE_ID), null, 'app', { ...opts, research: true });
        expect(research).toContain('There is no history from sources yet');
    });

    it('the tree rows join a wedding of both partners into one', () => {
        const data = houseTree();
        const house = houseOf(data, HOUSE_ID);
        const rows = houseTreeRows(house, house.facts, data, 'en');
        const wedding = rows.find(r => r.kind === 'marriage' && r.year === 1878)!;
        expect(wedding.persons.sort()).toEqual(['hostivit', 'kunhuta']);
        expect(wedding.marriedIn).toBe('f');
    });

    it('the timeline says nothing twice: birth and baptism, a person\'s or a couple\'s residences of one year (fictional names)', () => {
        const data = houseTree();
        const at = { place: 'Bělokamen', address: 'čp. 16' };
        const P = data.persons as Record<string, StromData['persons'][PersonId]>;
        // Svatobor born 1820 and baptized the same year: one row, "born".
        P.svatobor.events = [{ id: 'e-svat-chr', type: 'baptism', ...at, date: '1820-03-03' },
            // Three residences of one year (his son's baptisms say "the house of the child"): one row.
            { id: 'e-svat-r1', type: 'residence', ...at, date: '1855' }, { id: 'e-svat-r2', type: 'residence', ...at, date: '1855-08-01' }];
        // His wife's residence that year joins it: "residence Svatobor and Radegunda", as a wedding.
        P.radegunda.events = [{ id: 'e-rade-r', type: 'residence', ...at, date: '1855' }];
        // Their son's residence of that year is his own row.
        P.hostivit.events = [{ id: 'e-host-r', type: 'residence', ...at, date: '1855' },
            // A baptism of another year than the birth stays a row of its own.
            { id: 'e-host-chr', type: 'baptism', ...at, date: '1851-01-02' }];
        // A daughter baptized at the house, born elsewhere: "baptized".
        P.ctiboja = {
            id: 'ctiboja' as PersonId, firstName: 'Ctiboja', lastName: 'Prouzalová', gender: 'female', isPlaceholder: false,
            parentIds: ['hostivit', 'kunhuta'] as PersonId[], childIds: [], partnerships: [],
            events: [{ id: 'e-cti-chr', type: 'baptism', ...at, date: '1881' }],
        };
        const house = houseOf(data, HOUSE_ID);
        const rows = houseTreeRows(house, house.facts, data, 'en');
        const of = (kind: string, year: number) => rows.filter(r => r.kind === kind && r.year === year).map(r => `${r.label}: ${[...r.persons].sort().join(' ')}`);
        expect(of('birth', 1820)).toEqual(['born: svatobor']);
        expect(of('birth', 1850)).toEqual(['born: hostivit']);
        expect(of('birth', 1851)).toEqual(['baptized: hostivit']);
        expect(of('birth', 1881)).toEqual(['baptized: ctiboja']);
        expect(of('residence', 1855).sort()).toEqual(['residence: hostivit', 'residence: radegunda svatobor']);
        // Deaths and the wedding as before.
        expect(of('death', 1890)).toEqual(['died: svatobor']);
        expect(of('marriage', 1878)).toEqual(['marriage: hostivit kunhuta']);
        // In Czech, the daughter's baptism by her sex.
        const cs = houseTreeRows(house, house.facts, data, 'cs');
        expect(cs.find(r => r.persons.includes('ctiboja' as PersonId))!.label).toBe('pokřtěna');
        // The page shows it so.
        const html = buildHousePage(data, house, null, 'app', opts);
        expect(html.match(/Born <[^>]*>[^<]*Svatobor/g) ?? []).toHaveLength(1);
    });

    it('all four languages build', () => {
        const data = dataWithSources();
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
            const html = buildHousePage(data, houseOf(data, HOUSE_ID), fullResearch(), 'app', { ...opts, lang });
            expect(html).toContain('class="pp hp"');
            expect(housePageSections(html, lang).length).toBeGreaterThan(5);
        }
    });
});

describe('house page — the saved file (K7.1, K3.3)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(HOUSE_NOW);
    });
    afterEach(() => vi.useRealTimers());

    it('leaves out people of the last ~100 years, the living name, the sensitive event, actions and the hidden line', () => {
        const data = dataWithSources();
        const file = buildHousePageDocument(data, houseOf(data, HOUSE_ID), fullResearch(), opts);
        const doc = file.slice(file.indexOf('<body'));
        expect(file).not.toContain(LIVING_NAME);
        expect(file).not.toContain(SENSITIVE_TEXT);
        expect(doc).not.toContain(SENSITIVE_TEXT);
        // The facts of the last ~100 years: Vratislav's birth (1925) and death (2001), the residence of 2015.
        for (const year of ['1925', '2001', '2015', '1948', '1962', '1951']) expect(doc, year).not.toContain(year);
        // Nor by a sum: one family's years stop at the last record the file shows (1820–1920).
        expect(doc).not.toContain('195 years');
        expect(doc).toContain('100 years');
        // Today's owner and a stranger of the last ~100 years are not named by years.
        expect(doc).not.toMatch(/Kvido Stranný[^<]*<\/span><\/span><\/td><td class="hp-y">from 1951/);
        // No actions and no line about what is hidden.
        expect(doc).not.toContain('data-hp-act');
        expect(doc).not.toContain('hp-out');
        expect(doc).not.toContain('hidden in outputs');
        // A witness of a material is not named in the file.
        expect(doc).not.toContain('Kvido Stranný · ');
        expect(doc).not.toContain('told by');
        // The house of living people keeps no name after the farm.
        expect(doc).not.toContain('U Prouzalů');
        // Old facts stay.
        expect(doc).toContain('Stavení postaveno po rozdělení gruntu');
        expect(doc).toContain('Svatobor');
    });

    it('is self-contained: no script source, no stylesheet link, no frame; a remote image only of a picture under a free licence (T8)', () => {
        const data = dataWithSources();
        const r = fullResearch();
        r.look = { text: 'Stavení', images: [{ url: 'https://example.org/dum.jpg', license: 'CC BY 4.0', credit: 'Archiv Brodek' },
            { url: 'https://example.org/bez-licence.jpg', credit: 'Bez licence' }, { url: 'javascript:alert(1)', license: 'CC0' }] };
        const doc = buildHousePageDocument(data, houseOf(data, HOUSE_ID), r, opts);
        expect(doc.startsWith('<!doctype html>')).toBe(true);
        expect(doc).not.toMatch(/<script[^>]+src=/i);
        // No handler on the page's elements (no onerror on a picture): the inline scripts are the page's own.
        const article = doc.slice(doc.indexOf('<article'), doc.lastIndexOf('</article>'));
        expect(article).not.toMatch(/\son[a-z]+=/i);
        expect(doc).not.toMatch(/<iframe|<object|<embed/i);
        expect(doc).not.toMatch(/<link[^>]+stylesheet/);
        expect(doc).not.toMatch(/@import|url\(\s*["']?https?:/i);
        // The only network address the file loads: the licensed picture, without the referrer.
        expect([...doc.matchAll(/<img[^>]+src="(https?:[^"]+)"/g)].map(m => m[1])).toEqual(['https://example.org/dum.jpg']);
        expect(doc).toContain('<img class="hp-img hp-img--web" src="https://example.org/dum.jpg" alt="" loading="lazy" referrerpolicy="no-referrer">');
        expect(doc).not.toContain('bez-licence.jpg');
        expect(doc).not.toContain('javascript:');
        expect(doc).toContain('CC BY 4.0');
        expect(doc).toContain('class="pp-toc"');
    });

    it('a house of the 19th century only keeps its name and full history', () => {
        const data = houseTree();
        const doc = buildHousePageDocument(data, houseOf(data, OLD_HOUSE_ID), null, opts);
        expect(doc).toContain('1795');
        expect(doc).toContain('Drahobud');
        expect(buildHousePage(data, houseOf(data, OLD_HOUSE_ID), null, 'file', opts)).toContain('Na Mlýnku');
    });

    it('names the file after the town and the house', () => {
        const data = houseTree();
        expect(housePageFileName(houseOf(data, HOUSE_ID))).toBe('belokamen-cp-16.html');
    });
});

describe('house page — the building (spec 145 T1)', () => {
    const TOWN = { id: 'A0002', place: { id: 'L0001', name: 'Bělokamen' }, text: '', passed: [], manual: [], archiveOnly: [], maps: [], unknown: [] };
    const section = (html: string): string => {
        const at = html.indexOf('id="hp-sec-look"');
        return at < 0 ? '' : html.slice(at, html.indexOf('</section>', at));
    };
    const count = (html: string, text: string): number => html.split(text).length - 1;

    /** The full look: its text, a picture of the house, the town's pictures and field names, the check: a source. */
    function fullLook(): HouseResearch {
        const r = fullResearch();
        r.look = {
            text: 'Zděné přízemní stavení se dvěma okny do návsi.', certainty: 'probable', origin: 'research',
            images: [{ url: 'https://example.org/dum.jpg', license: 'CC BY 4.0', credit: 'Archiv Brodek' }],
        };
        r.lookCheck = { next: 'source', text: 'pozemková kniha popisuje stavení podrobněji', task: 'T0002', at: '2026-11-27', origin: 'research' };
        r.lookTask = true;
        r.state = 'queued';
        r.town = {
            ...TOWN,
            pictures: [{ id: 'i1', url: 'https://commons.example.org/naves.jpg', license: 'CC BY-SA 4.0', credit: 'Jan Brodský', shows: 'Náves od kaple, 1912' }],
            fieldNames: [
                { id: 'f1', name: 'Na Skále', kind: 'samota' },
                { id: 'f2', name: 'Prouzalův mlýn', kind: 'mlýn', house: '16', url: 'https://example.org/mlyn' },
            ],
        };
        return r;
    }

    it('the full look: text with its tag, the house\'s picture, the town\'s pictures under their heading, field names, still researched', () => {
        const data = dataWithSources();
        const html = buildHousePage(data, houseOf(data, HOUSE_ID), fullLook(), 'app', { ...opts, look: true });
        const look = section(html);
        expect(look).toContain('Zděné přízemní stavení');
        expect(look).toMatch(/hp-look">[^<]*<span class="hp-otag hp-otag--guess">probable</);
        expect(look).toContain('<img class="hp-img" src="https://example.org/dum.jpg"');
        // The town's pictures: what they show, author and licence, a link out, a lazy picture with no referrer.
        expect(look).toContain('<h3 class="hp-h3">Pictures of the town</h3>');
        expect(look).toMatch(/<img class="hp-img" src="https:\/\/commons\.example\.org\/naves\.jpg" alt="Náves od kaple, 1912" loading="lazy" referrerpolicy="no-referrer">/);
        expect(look).toContain('Jan Brodský · CC BY-SA 4.0 · <a href="https://commons.example.org/naves.jpg" target="_blank" rel="noopener noreferrer">commons.example.org ↗</a>');
        // The field names: this house's first and marked, its number, a link where there is one.
        expect(look).toContain('<h3 class="hp-h3">Field names</h3>');
        expect(look.indexOf('Prouzalův mlýn')).toBeLessThan(look.indexOf('Na Skále'));
        expect(look).toMatch(/hp-fn--this"><span class="hp-fn"><a href="https:\/\/example\.org\/mlyn"[^>]*>Prouzalův mlýn ↗<\/a><\/span><span class="hp-ql-s">mlýn · at no\. 16</);
        // The check: still researched, its task in the queue; no "not known".
        expect(look).toContain('The look of the house is still being researched: pozemková kniha popisuje stavení podrobněji. Its task is in the research queue.');
        expect(look).not.toContain('not known');
        expect(look).not.toContain('house-attach');
    });

    it('the task of the look done: no more "still researched"', () => {
        const data = dataWithSources();
        const r = fullLook();
        r.state = 'done';
        const look = section(buildHousePage(data, houseOf(data, HOUSE_ID), r, 'app', { ...opts, look: true }));
        expect(look).toContain('Zděné přízemní stavení');
        expect(look).not.toContain('still being researched');
    });

    it('none: only the one item of what is not known (not the check\'s text), once on the page, Attach material… and the steps by hand', () => {
        const data = dataWithSources();
        const r = fullResearch();
        r.look = undefined;
        r.lookCheck = { next: 'none', text: 'žádný volný obrázek ani popis', at: '2026-11-27', origin: 'research' };
        r.unknown.push({ id: 'u9', text: 'podoba: víc automaticky nejde – žádný volný obrázek ani popis', question: null, about: 'look' });
        r.manual = [{ id: 'o1', what: 'Indikační skica k. ú. Bělokamen, list 2', url: 'https://archiv.example.org/skica', why: 'stáhnout a přiložit k domu' }];
        const attach = '<button type="button" class="hp-mini house-attach">Attach material…</button>';
        const html = buildHousePage(data, houseOf(data, HOUSE_ID), r, 'app', { ...opts, look: true, app: { lookAttachHtml: attach } });
        const look = section(html);
        expect(count(html, 'podoba: víc automaticky nejde')).toBe(1);
        expect(look).toContain('podoba: víc automaticky nejde');
        expect(look).not.toContain('What the house looked like is not known.');
        expect(count(look, 'žádný volný obrázek ani popis')).toBe(1);
        // The other unknown stays in What is not known.
        expect(html.slice(html.indexOf('id="hp-sec-unknown"'))).toContain('Kdo dům držel 1912–1913?');
        expect(look).toContain(attach);
        expect(look).toContain('<a href="https://archiv.example.org/skica" target="_blank" rel="noopener noreferrer">Indikační skica k. ú. Bělokamen, list 2 ↗</a>');
        expect(look).toContain('stáhnout a přiložit k domu');
    });

    it('a researched house without a look: the general sentence with house.look; nothing without it, nothing without a research', () => {
        const data = dataWithSources();
        const r = fullResearch();
        r.look = undefined;
        const attach = '<button type="button" class="hp-mini house-attach">Attach material…</button>';
        const look = section(buildHousePage(data, houseOf(data, HOUSE_ID), r, 'app', { ...opts, look: true, app: { lookAttachHtml: attach } }));
        expect(look).toContain('<p class="hp-note hp-look-unk">What the house looked like is not known.</p>');
        expect(look).toContain(attach);
        // Without the feature the section stays out; a house still at work says nothing either.
        expect(section(buildHousePage(data, houseOf(data, HOUSE_ID), r, 'app', { ...opts, app: { lookAttachHtml: attach } }))).toBe('');
        expect(section(buildHousePage(data, houseOf(data, HOUSE_ID), { ...r, state: 'running' }, 'app', { ...opts, look: true }))).toBe('');
        expect(section(buildHousePage(data, houseOf(data, HOUSE_ID), null, 'app', { ...opts, look: true }))).toBe('');
        // An older research's look shows without the feature.
        expect(section(buildHousePage(data, houseOf(data, HOUSE_ID), fullResearch(), 'app', opts))).toContain('Zděné přízemní stavení');
    });

    it('the saved file: pictures from the web by default with their captions, no buttons, no names of people (T8)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(HOUSE_NOW);
        try {
            const data = dataWithSources();
            const look = section(buildHousePageDocument(data, houseOf(data, HOUSE_ID), fullLook(), { ...opts, look: true }));
            expect(look).toContain('<img class="hp-img hp-img--web" src="https://example.org/dum.jpg" alt=""');
            expect(look).toContain('<img class="hp-img hp-img--web" src="https://commons.example.org/naves.jpg" alt=""');
            expect(look).toContain('hp-figs--img');
            // The caption and the link stay beside the picture (without the network they say what it is).
            expect(look).toContain('Archiv Brodek · CC BY 4.0');
            expect(look).toContain('commons.example.org ↗');
            expect(look).not.toContain('<button');
            // The same with webPhotos true.
            expect(section(buildHousePageDocument(data, houseOf(data, HOUSE_ID), fullLook(), { ...opts, look: true, webPhotos: true }))).toBe(look);
        } finally {
            vi.useRealTimers();
        }
    });

    it('the saved file with Link only: links instead of pictures, no buttons, no names of people', () => {
        vi.useFakeTimers();
        vi.setSystemTime(HOUSE_NOW);
        try {
            const data = dataWithSources();
            const r = fullLook();
            const doc = buildHousePageDocument(data, houseOf(data, HOUSE_ID), r, { ...opts, look: true, webPhotos: false, app: { lookAttachHtml: '<button class="house-attach">x</button>' } });
            const look = section(doc);
            expect(look).toContain('Pictures of the town');
            expect(look).toContain('Náves od kaple, 1912');
            expect(look).toContain('commons.example.org ↗');
            expect(look).toContain('Prouzalův mlýn');
            expect(doc).not.toMatch(/<img[^>]+src="https?:/);
            expect(look).not.toContain('hp-figs--img');
            expect(look).toContain('Archiv Brodek · CC BY 4.0');
            expect(look).not.toContain('<button');
            expect(doc).not.toContain(LIVING_NAME);
            // The not known state in the file: its sentence, no button.
            const none = fullResearch();
            none.look = undefined;
            const noneLook = section(buildHousePageDocument(data, houseOf(data, HOUSE_ID), none, { ...opts, look: true }));
            expect(noneLook).toContain('What the house looked like is not known.');
            expect(noneLook).not.toContain('<button');
        } finally {
            vi.useRealTimers();
        }
    });

    it('all four languages name the pictures and field names of the town', () => {
        const data = dataWithSources();
        const want = { cs: ['Obrázky obce', 'Pomístní jména', 'u čp. 16'], en: ['Pictures of the town', 'Field names', 'at no. 16'],
            de: ['Bilder des Ortes', 'Flurnamen', 'bei Nr. 16'], pl: ['Obrazy miejscowości', 'Nazwy terenowe', 'przy nr 16'] } as const;
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
            const look = section(buildHousePage(data, houseOf(data, HOUSE_ID), fullLook(), 'app', { ...opts, lang, look: true }));
            for (const w of want[lang]) expect(look, `${lang}: ${w}`).toContain(w);
        }
    });
});
