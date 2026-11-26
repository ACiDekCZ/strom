/**
 * The house page (spec 030 §3, K3.1, K3.2, K7.1): only the sections with
 * content, the origin tags of the timeline, holders and residents as tables,
 * and the saved file (mode 'file') without the facts of people of the last
 * ~100 years, the living's own name and the sensitive event (K1.4a, K3.3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StromData } from '../types.js';
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
        expect(on).toContain('čp. 9');
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

    it('is self-contained: no script source, no remote image, no stylesheet link', () => {
        const data = dataWithSources();
        const r = fullResearch();
        r.look = { text: 'Stavení', images: [{ url: 'https://example.org/dum.jpg', license: 'CC BY 4.0', credit: 'Archiv Brodek' }] };
        const doc = buildHousePageDocument(data, houseOf(data, HOUSE_ID), r, opts);
        expect(doc.startsWith('<!doctype html>')).toBe(true);
        expect(doc).not.toMatch(/<script[^>]+src=/);
        expect(doc).not.toMatch(/<img[^>]+src="https?:/);
        expect(doc).not.toMatch(/<link[^>]+stylesheet/);
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
