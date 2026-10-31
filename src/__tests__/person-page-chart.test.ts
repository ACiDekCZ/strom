/**
 * Life at a glance (spec 025 §2): when the chart is drawn, the periods
 * (youth, marriages, widowhood, divorce), places lived, marks, the partners'
 * and children's lines, uncertain dates and open ends, history, the two
 * width sets of a file, anchors and living protection.
 * Pure, fictional data (Jan Fíšek of Čapkov).
 */

import { describe, it, expect } from 'vitest';
import { lifeChartInput, lifeChartHtml, chartAnchorId, chartHistAnchorId, chartSet, CHART_WIDE, CHART_NARROW, historyGlyphs, historyLabelLanes, historyTouchHalves, barsOver, residenceLabel } from '../person-page-chart.js';
import { PERSON_PAGE_CHART_CSS } from '../person-page-viz-css.js';
import { historyKindSvg } from '../history-symbols.js';
import type { ChartHistory } from '../person-page-chart.js';
import { computePersonLifeline } from '../timeline.js';
import { getStringsForLang } from '../strings.js';
import type { LifelineHistoryItem } from '../history.js';
import type { StromData, PersonId, PartnershipId, Person, Gender, Partnership } from '../types.js';

function p(id: string, first: string, last: string, gender: Gender, extra: Partial<Person> = {}): Person {
    return { id: id as PersonId, firstName: first, lastName: last, gender, isPlaceholder: false, parentIds: [], childIds: [], partnerships: [], ...extra } as Person;
}
function u(id: string, a: string, b: string, extra: Partial<Partnership> = {}): Partnership {
    return { id: id as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId, childIds: [], status: 'married', ...extra } as Partnership;
}

const JAN = 'jan' as PersonId;
const NOW = 2026.8;

function tree(): StromData {
    const persons: StromData['persons'] = {};
    const add = (x: Person) => { persons[x.id] = x; };
    add(p('jan', 'Jan', 'Fíšek', 'male', {
        birthDate: '1860-03-12', birthPlace: 'Čapkov', deathDate: '1920-02-01', deathPlace: 'Kolín',
        childIds: ['anezka', 'vaclav', 'eva'] as PersonId[], partnerships: ['u1', 'u2'] as PartnershipId[],
        events: [
            { id: 'e1', type: 'military', date: '1880-10-01', place: 'Praha' },
            { id: 'e2', type: 'residence', date: '1890-04-01', place: 'Kolín' },
        ],
    }));
    add(p('roza', 'Rozálie', 'Fíšková', 'female', { birthDate: '1862-01-01', deathDate: '1900-06-01', partnerships: ['u1'] as PartnershipId[] }));
    add(p('marie', 'Marie', 'Fíšková', 'female', { birthDate: '1870-01-01', deathDate: '1944-05-01', partnerships: ['u2'] as PartnershipId[] }));
    add(p('anezka', 'Anežka', 'Fíšková', 'female', { birthDate: '1885-02-01', deathDate: '1886-08-01', parentIds: ['jan', 'roza'] as PersonId[] }));
    add(p('vaclav', 'Václav', 'Fíšek', 'male', { birthDate: '1887-03-01', deathDate: '1968-01-01', parentIds: ['jan', 'roza'] as PersonId[] }));
    add(p('eva', 'Eva', 'Fíšková', 'female', { birthDate: '1907-03-01', isDeceased: false, parentIds: ['jan', 'marie'] as PersonId[] }));
    return {
        version: 11, persons,
        partnerships: {
            u1: u('u1', 'jan', 'roza', { startDate: '1883-05-01', startPlace: 'Lhotka', childIds: ['anezka', 'vaclav'] as PersonId[] }),
            u2: u('u2', 'jan', 'marie', { startDate: '1905-06-01', startPlace: 'Kolín', childIds: ['eva'] as PersonId[] }),
        } as StromData['partnerships'],
    };
}

describe('lifeChartInput', () => {
    it('periods: youth, a marriage, widowhood, the next marriage', () => {
        const input = lifeChartInput(tree(), JAN, { now: NOW })!;
        expect(input.periods.map(x => `${x.kind}:${x.name ?? ''}:${Math.floor(x.from)}-${Math.floor(x.to)}`)).toEqual([
            'youth::1860-1883', 'marriage:Rozálie:1883-1900', 'widowed::1900-1905', 'marriage:Marie:1905-1920',
        ]);
        expect(input.endKind).toBe('death');
    });

    it('a divorce: the gap after it is "after divorce"', () => {
        const t = tree();
        t.partnerships['u1' as PartnershipId].endDate = '1895-01-01';
        t.partnerships['u1' as PartnershipId].status = 'divorced';
        const input = lifeChartInput(t, JAN, { now: NOW })!;
        expect(input.periods.find(x => x.kind === 'divorced')).toBeDefined();
        expect(input.marks.some(m => m.kind === 'divorce')).toBe(true);
    });

    it('no marriage: one bar of the whole life', () => {
        const t = tree();
        t.persons[JAN].partnerships = [];
        const input = lifeChartInput(t, JAN, { now: NOW })!;
        expect(input.periods.map(x => x.kind)).toEqual(['life']);
        expect(lifeChartHtml(input, { lang: 'cs', mode: 'file' })).toContain('pp-ch-p--life');
    });

    it('a marriage without a date: a neutral life bar, no marriage period, a line from the first common child (round 2, point 4)', () => {
        const t = tree();
        delete t.partnerships['u1' as PartnershipId].startDate;
        delete t.partnerships['u2' as PartnershipId].startDate;
        const input = lifeChartInput(t, JAN, { now: NOW })!;
        expect(input.periods.map(x => x.kind)).toEqual(['life']);
        expect(input.periodsUnknown).toBe(true);
        expect(input.marks.some(m => m.kind === 'marriage')).toBe(false);
        // Partner lines start at the first common child's point and fade in there.
        const roza = input.lines.find(l => l.kind === 'partner' && l.name === 'Rozálie')!;
        expect(Math.floor(roza.from)).toBe(1885);
        expect(roza.fadeStart).toBe(true);
        const html = lifeChartHtml(input, { lang: 'cs', mode: 'file' });
        expect(html).toContain('pp-ch-p--life');
        expect(html).not.toContain('pp-ch-p--youth');
        expect(html).toContain('pp-ch-ln--fs');
        // The legend names the neutral bar as a life whose periods are unknown.
        expect(html.slice(html.indexOf('pp-chart-legend'))).toContain('život (období neznámá)');
        expect(lifeChartHtml(input, { lang: 'en', mode: 'file' })).toContain('life (periods unknown)');
    });

    it('one marriage dated, an earlier one not: life before, then the dated marriage (round 2, point 4)', () => {
        const t = tree();
        delete t.partnerships['u1' as PartnershipId].startDate;
        const input = lifeChartInput(t, JAN, { now: NOW })!;
        // The undated union's first child (1885) precedes the dated marriage (1905): the start is "life", not "youth".
        expect(input.periods[0].kind).toBe('life');
        expect(input.periods.some(x => x.kind === 'marriage' && x.name === 'Marie')).toBe(true);
        expect(input.periods.some(x => x.name === 'Rozálie')).toBe(false);
    });

    it('a marriage without a date and without children: no partner line at all', () => {
        const t = tree();
        delete t.partnerships['u1' as PartnershipId].startDate;
        t.partnerships['u1' as PartnershipId].childIds = [];
        t.persons['anezka' as PersonId].parentIds = ['jan'] as PersonId[];
        t.persons['vaclav' as PersonId].parentIds = ['jan'] as PersonId[];
        const input = lifeChartInput(t, JAN, { now: NOW })!;
        expect(input.lines.some(l => l.kind === 'partner' && l.name === 'Rozálie')).toBe(false);
        expect(input.lines.some(l => l.kind === 'partner' && l.name === 'Marie')).toBe(true);
    });

    it('places lived: runs of one place up to the next place', () => {
        const input = lifeChartInput(tree(), JAN, { now: NOW })!;
        expect(input.residence.map(r => r.place)).toEqual(['Čapkov', 'Praha', 'Lhotka', 'Kolín']);
        // Each run ends where the next begins; the last one at the end of the bar.
        for (let i = 0; i + 1 < input.residence.length; i++) expect(input.residence[i].to).toBe(input.residence[i + 1].from);
        expect(input.residence[input.residence.length - 1].to).toBe(input.barEnd);
    });

    it('lines: partners in the order of marriages, then children by birth; a child who died young', () => {
        const input = lifeChartInput(tree(), JAN, { now: NOW })!;
        expect(input.lines.map(l => `${l.kind}:${l.name}`)).toEqual(['partner:Rozálie', 'partner:Marie', 'child:Anežka', 'child:Václav', 'child:Eva']);
        expect(input.lines.find(l => l.name === 'Anežka')!.childAge).toBe(1);
        expect(input.lines.find(l => l.name === 'Václav')!.childAge).toBeUndefined();
    });

    it('drawn only from two dated points in different years', () => {
        const t = tree();
        const lone = p('x', 'Lone', 'One', 'male', { birthDate: '1900' });
        t.persons[lone.id] = lone;
        expect(lifeChartInput(t, lone.id, { now: NOW })).toBeNull();
        lone.deathDate = '1900-12-01';
        expect(lifeChartInput(t, lone.id, { now: NOW })).toBeNull();
        lone.deathDate = '1950';
        expect(lifeChartInput(t, lone.id, { now: NOW })).not.toBeNull();
    });

    it('protected file: no chart for a living person, no line for a living child', () => {
        expect(lifeChartInput(tree(), 'eva' as PersonId, { now: NOW, protect: true })).toBeNull();
        const input = lifeChartInput(tree(), JAN, { now: NOW, protect: true })!;
        expect(input.lines.some(l => l.name === 'Eva')).toBe(false);
        expect(lifeChartInput(tree(), JAN, { now: NOW })!.lines.some(l => l.name === 'Eva')).toBe(true);
        // A living partner (by the page's living set): the marriage stays as the family tree shows it
        // (initials, the year), with no line of the partner's life.
        const withSet = lifeChartInput(tree(), JAN, { now: NOW, protect: true, living: new Set(['marie', 'eva']) })!;
        expect(withSet.periods.some(x => x.name === 'Marie')).toBe(false);
        expect(withSet.periods.find(x => x.kind === 'marriage' && x.name === 'M. F.')).toBeDefined();
        expect(withSet.lines.some(l => l.kind === 'partner' && l.name.startsWith('M'))).toBe(false);
        const marks = withSet.marks.filter(m => m.kind === 'marriage');
        expect(marks.map(m => m.title)).toEqual(['Rozálie', 'M. F.']);
        expect(JSON.stringify(withSet)).not.toContain('Marie');
    });

    it('protected file: a remarriage to a living partner is no widowhood (finding 1, round 3)', () => {
        // The first wife dies in 1975, the second marriage (1974) is to a living woman, Jan dies in 2010.
        const t = tree();
        t.persons[JAN].deathDate = '2010-03-01';
        t.persons['roza' as PersonId].deathDate = '1975-06-01';
        t.partnerships['u1' as PartnershipId].startDate = '1950-05-01';
        t.partnerships['u2' as PartnershipId].startDate = '1974-06-01';
        t.persons['marie' as PersonId].isDeceased = false;
        delete t.persons['marie' as PersonId].deathDate;
        t.persons['marie' as PersonId].birthDate = '1950-01-01';
        const input = lifeChartInput(t, JAN, { now: NOW, protect: true })!;
        expect(input.periods.some(x => x.kind === 'widowed')).toBe(false);
        expect(input.periods.map(x => `${x.kind}:${x.name ?? ''}:${Math.floor(x.from)}-${Math.floor(x.to)}`)).toEqual([
            'youth::1860-1950', 'marriage:Rozálie:1950-1974', 'marriage:M. F.:1974-2010',
        ]);
        const html = lifeChartHtml(input, { lang: 'cs', mode: 'file' });
        expect(html).not.toContain('vdovec');
        expect(html).not.toContain('Marie');
        expect(html).not.toContain('1974-06');
    });

    it('protected file: a union with a living partner that ended has no length, only the ⚭ year (round 3, finding F)', () => {
        // Jan's second union (1905) is to a living woman and ended in 1911; Jan dies in 1920.
        const ended = (end: Partial<Partnership>): StromData => {
            const t = tree();
            t.persons['marie' as PersonId].isDeceased = false;
            delete t.persons['marie' as PersonId].deathDate;
            t.persons['marie' as PersonId].birthDate = '1888-01-01';
            Object.assign(t.partnerships['u2' as PartnershipId], end);
            return t;
        };
        const variants: Partial<Partnership>[] = [
            { status: 'separated', endDate: '1911-03-01' },
            { status: 'divorced', endDate: '1911-03-01' },
            { status: 'divorced' },
            { status: 'married', endDate: '1911-03-01' },
        ];
        for (const v of variants) {
            const input = lifeChartInput(ended(v), JAN, { now: NOW, protect: true, living: new Set(['marie', 'eva']) as Set<PersonId> })!;
            expect(input.periods.map(x => `${x.kind}:${x.name ?? ''}:${Math.floor(x.from)}-${Math.floor(x.to)}`)).toEqual([
                'youth::1860-1883', 'marriage:Rozálie:1883-1900', 'widowed::1900-1905', 'life::1905-1920',
            ]);
            expect(input.marks.filter(m => m.kind === 'marriage').map(m => `${m.title}:${m.year}`)).toEqual(['Rozálie:1883', 'M. F.:1905']);
            expect(input.marks.some(m => m.kind === 'divorce')).toBe(false);
            for (const lang of ['cs', 'en', 'de'] as const) {
                const html = lifeChartHtml(input, { lang, mode: 'file' });
                const L = getStringsForLang(lang).personPage.chart;
                expect(html).not.toContain(L.divorced);
                expect(html).not.toContain('1911');
                expect(html).not.toContain('Marie');
                expect(html).not.toContain(L.years(15));
            }
        }
        // Without protection the union keeps its length and the time after it.
        const full = lifeChartInput(ended(variants[0]), JAN, { now: NOW })!;
        expect(full.periods.map(x => `${x.kind}:${Math.floor(x.from)}-${Math.floor(x.to)}`)).toEqual([
            'youth:1860-1883', 'marriage:1883-1900', 'widowed:1900-1905', 'partnership:1905-1911', 'divorced:1911-1920',
        ]);
    });

    it('widowhood is claimed only when no other union can be in the gap', () => {
        // An undated union whose first child comes after the wife's death ends the widowhood there.
        const t = tree();
        delete t.partnerships['u2' as PartnershipId].startDate;
        t.persons['eva' as PersonId].birthDate = '1903-03-01';
        const input = lifeChartInput(t, JAN, { now: NOW })!;
        expect(input.periods.map(x => `${x.kind}:${Math.floor(x.from)}-${Math.floor(x.to)}`)).toEqual([
            'youth:1860-1883', 'marriage:1883-1900', 'widowed:1900-1903', 'life:1903-1920',
        ]);
        // An undated union with no known point at all: the time after the wife's death stays unknown.
        const t2 = tree();
        delete t2.partnerships['u2' as PartnershipId].startDate;
        t2.partnerships['u2' as PartnershipId].childIds = [];
        t2.persons['eva' as PersonId].parentIds = ['jan'] as PersonId[];
        const input2 = lifeChartInput(t2, JAN, { now: NOW })!;
        expect(input2.periods.some(x => x.kind === 'widowed')).toBe(false);
        expect(input2.periods[input2.periods.length - 1].kind).toBe('life');
    });

    it('uncertain dates: ~year and a range fade, a year alone does not (round 2, point 6)', () => {
        const t = tree();
        t.persons[JAN].birthDate = '~1860';
        t.persons[JAN].deathDate = '1920';
        const input = lifeChartInput(t, JAN, { now: NOW })!;
        expect(input.birth!.uncertain).toBe(true);
        expect(input.birth!.label).toBe('~1860');
        // A year alone is an exact year, not an uncertain one.
        expect(input.death!.uncertain).toBe(false);
        const html = lifeChartHtml(input, { lang: 'cs', mode: 'file' });
        expect(html).toContain('pp-ch-fade-s');
        expect(html).not.toContain('pp-ch-fade-e');
        expect(html).toContain('~1860');
        const yearOnly = tree();
        yearOnly.persons[JAN].birthDate = '1860';
        expect(lifeChartInput(yearOnly, JAN, { now: NOW })!.birth!.uncertain).toBe(false);
        expect(lifeChartHtml(lifeChartInput(yearOnly, JAN, { now: NOW }), { lang: 'cs', mode: 'file' })).not.toContain('pp-ch-fade');
        const range = tree();
        range.persons[JAN].birthDate = '1858..1860';
        expect(lifeChartInput(range, JAN, { now: NOW })!.birth!.uncertain).toBe(true);
        // An exact date does not fade.
        const exact = lifeChartHtml(lifeChartInput(tree(), JAN, { now: NOW }), { lang: 'cs', mode: 'file' });
        expect(exact).not.toContain('pp-ch-fade');
    });

    it('a death range: solid to its start, dashed to its end', () => {
        const t = tree();
        t.persons[JAN].deathDate = '1920..1925';
        const input = lifeChartInput(t, JAN, { now: NOW })!;
        expect(input.death!.to).toBeCloseTo(1925.9, 5);
        expect(input.end).toBeCloseTo(1925.9, 5);
        expect(lifeChartHtml(input, { lang: 'cs', mode: 'file' })).toContain('pp-ch-dash');
    });

    it('an unknown death: the bar fades after the last dated point, "after 1905 ?"', () => {
        const t = tree();
        delete t.persons[JAN].deathDate;
        t.persons[JAN].isDeceased = true;
        const input = lifeChartInput(t, JAN, { now: NOW })!;
        expect(input.endKind).toBe('unknown');
        const html = lifeChartHtml(input, { lang: 'cs', mode: 'file' });
        expect(html).toContain(`po ${input.lastYear} ?`);
        expect(html).toContain('pp-ch-fade-e');
        expect(lifeChartHtml(input, { lang: 'en', mode: 'file' })).toContain(`after ${input.lastYear} ?`);
    });

    it('an unknown death: an event\'s label at the last year gives way to "after 1871 ?" (no overlap)', () => {
        // A short life known from a birth and a residence of 1871 only (RESI with the year alone).
        const t = tree();
        const jan = t.persons[JAN];
        jan.birthDate = '1865-03-12';
        delete jan.deathDate;
        jan.isDeceased = true;
        jan.partnerships = [];
        jan.childIds = [];
        jan.events = [{ id: 'r', type: 'residence', date: '1871', place: 'Lhota' }];
        t.partnerships = {} as StromData['partnerships'];
        for (const lang of ['en', 'cs', 'de'] as const) {
            const html = lifeChartHtml(lifeChartInput(t, JAN, { now: NOW })!, { lang, mode: 'app' });
            const marks = html.slice(html.indexOf('pp-ch-marks'));
            const row = marks.slice(0, marks.indexOf('</div>'));
            const after = { en: 'after 1871 ?', cs: 'po 1871 ?', de: 'nach 1871 ?' }[lang];
            expect(row).toContain(after);
            // The residence keeps its mark and title; its label would sit under "after 1871 ?" and is left out.
            expect(row).toMatch(/pp-ch-mk--event[^>]*title="[^"]*1871"/);
            expect(row).not.toMatch(/<span class="pp-ch-ml">(residence|bydliště|Wohnort)<\/span>/);
        }
    });

    it('living: "today" in the window only, an open end in a file', () => {
        const t = tree();
        const eva = t.persons['eva' as PersonId];
        eva.events = [{ id: 'x', type: 'education', date: '1913-09-01', place: 'Kolín' }];
        const input = lifeChartInput(t, eva.id, { now: NOW })!;
        expect(input.endKind).toBe('living');
        expect(input.barEnd).toBeCloseTo(NOW, 5);
        expect(lifeChartHtml(input, { lang: 'cs', mode: 'app', width: 600 })).toContain('>dnes<');
        const file = lifeChartHtml(input, { lang: 'cs', mode: 'file' });
        expect(file).not.toContain('>dnes<');
        expect(file).toContain('pp-ch-fade-e');
    });
});

describe('lifeChartHtml', () => {
    const input = () => lifeChartInput(tree(), JAN, { now: NOW });

    it('a place lived names its place and years in its tooltip and accessible name, also where the band is too narrow for its name', () => {
        const S = getStringsForLang('en');
        for (const [w, narrow] of [[CHART_WIDE, false], [CHART_NARROW, true]] as const) {
            const set = chartSet(input()!, S, { lang: 'en', mode: 'file' }, w, narrow);
            const bands = [...set.matchAll(/<a class="pp-ch-res[^"]*"[^>]*title="([^"]*)" aria-label="([^"]*)">([^<]*)<\/a>/g)];
            expect(bands.map(b => b[1])).toEqual(['Čapkov 1860–1880', 'Praha 1880–1883', 'Lhotka 1883–1890', 'Kolín 1890–1920']);
            for (const b of bands) expect(b[2]).toBe(b[1]);
            // On a phone the short runs have no room for their name: the label still says it.
            if (narrow) expect(bands.some(b => b[3] === '')).toBe(true);
        }
        // Within one year, a single year; a run to the end of a life without a death, open.
        expect(residenceLabel({ from: 1916.2, to: 1916.9, place: 'Bristol' }, false)).toBe('Bristol 1916');
        expect(residenceLabel({ from: 1990.4, to: 2026.8, place: 'Bristol' }, true)).toBe('Bristol 1990–');
    });

    it('a file carries two sets, the window one for its width', () => {
        const file = lifeChartHtml(input(), { lang: 'cs', mode: 'file' });
        expect(file).toContain('pp-chart-set--wide');
        expect(file).toContain('pp-chart-set--narrow');
        const app = lifeChartHtml(input(), { lang: 'cs', mode: 'app', width: 600 });
        expect(app).toContain('pp-chart-set--one');
        expect(app).not.toContain('pp-chart-set--narrow');
        expect(lifeChartHtml(null, { lang: 'cs', mode: 'file' })).toBe('');
    });

    it('the last age label ("50 Jahre") ends at the chart\'s edge instead of past it', () => {
        const de = getStringsForLang('de');
        // Died at 50, eight months after the birthday: "50 Jahre" sits at the very end of the axis.
        const t = tree();
        t.persons[JAN].deathDate = '1910-11-03';
        const set = chartSet(lifeChartInput(t, JAN, { now: NOW })!, de, { lang: 'de', mode: 'file' }, CHART_WIDE, false);
        expect(set).toContain('<span class="pp-ch-age--e">50 Jahre</span>');
        expect(set).toContain('<span style="left:');
        // Died at 59: "50 Jahre" keeps its place under its year.
        const inside = chartSet(input()!, de, { lang: 'de', mode: 'file' }, CHART_WIDE, false);
        expect(inside).toContain('50 Jahre');
        expect(inside).not.toContain('pp-ch-age--e');
    });

    it('on a phone the age label under "90 Jahre" is left out instead of colliding with it', () => {
        const de = getStringsForLang('de');
        const t = tree();
        t.persons[JAN].deathDate = '1950-11-03';
        const set = chartSet(lifeChartInput(t, JAN, { now: NOW })!, de, { lang: 'de', mode: 'file' }, 358, true);
        const ages = set.match(/<div class="pp-ch-row pp-ch-ages"[^>]*>(.*?)<\/div>/)![1];
        expect(ages).toContain('<span class="pp-ch-age--e">90 Jahre</span>');
        expect(ages).not.toContain('>80<');
        expect(ages).toContain('>70<');
    });

    it('labels: long on a desktop, short on a phone', () => {
        const S = getStringsForLang('cs');
        const wide = chartSet(input()!, S, { lang: 'cs', mode: 'file' }, CHART_WIDE, false);
        const narrow = chartSet(input()!, S, { lang: 'cs', mode: 'file' }, CHART_NARROW, true);
        // A partner who outlived the axis: "Marie · † 1944 →" / "Marie →".
        expect(wide).toContain('Marie · † 1944 →');
        expect(narrow).toContain('Marie →');
        expect(narrow).not.toContain('† 1944 →');
        // A child who died young.
        expect(wide).toContain('Anežka · 1 rok');
        expect(wide).toContain('pp-ch-ln--short');
        // Marks: the military service keeps its label on a phone; the residence does not.
        expect(wide).toContain('>vojna<');
        expect(narrow).toContain('>vojna<');
        expect(wide).toContain('>bydliště<');
        expect(narrow).not.toContain('>bydliště<');
        // Period label with its length only on a desktop.
        expect(wide).toMatch(/Manželství · Rozálie · 17 let/);
        // The partner's name stands alone, never declined (round 2, point 8).
        expect(wide).not.toContain('Manželství s');
    });

    it('marks: * † ⚭ with anchors to the text timeline rows', () => {
        const html = lifeChartHtml(input(), { lang: 'cs', mode: 'file' });
        for (const g of ['>*<', '>†<', '>⚭<']) expect(html).toContain(g);
        const birth = computePersonLifeline(tree(), JAN).find(x => x.kind === 'birth')!;
        expect(html).toContain(`href="#${chartAnchorId(birth.sortKey)}" data-pp-osa="${chartAnchorId(birth.sortKey)}"`);
        expect(chartAnchorId(1860.001)).toBe('osa-1860-001');
        expect(chartAnchorId(1883.35)).toBe('osa-1883-350');
        expect(chartHistAnchorId('war:1866')).toBe('osa-h-war_1866');
    });

    it('children\'s lines can be switched off (class pp-ch-kid), partners stay', () => {
        const html = lifeChartHtml(input(), { lang: 'cs', mode: 'file' });
        expect((html.match(/pp-ch-line pp-ch-kid/g) ?? []).length).toBe(2 * 3);
        expect((html.match(/pp-ch-ln--partner/g) ?? []).length).toBe(2 * 2);
        expect(html).toContain('pp-ch-kid-lg');
    });

    it('legend: youth, marriage, widowhood, residence, wives, children', () => {
        const html = lifeChartHtml(input(), { lang: 'cs', mode: 'file' });
        const legend = html.slice(html.indexOf('pp-chart-legend'));
        for (const t of ['dětství a mládí', 'manželství', 'vdovství', 'bydliště', 'manželky', 'děti']) expect(legend).toContain(t);
        expect(lifeChartHtml(input(), { lang: 'en', mode: 'file' })).toContain('wives');
    });

    it('history: glyphs by scope, one glyph a year with kinds joined, bars for events of more years; none without research', () => {
        const item = (id: string, from: number, kind: string, scope: 'region' | 'place' | 'local', text: string, to?: number): LifelineHistoryItem =>
            ({ ev: { id, from, ...(to !== undefined ? { to } : {}), kind, scope, text: { cs: text } }, year: from, age: '', place: 'Čapkov', placeKey: 'capkov', text, textLang: 'cs' } as unknown as LifelineHistoryItem);
        const hist = [
            item('h1', 1866, 'war', 'region', 'Prusko-rakouská válka'),
            item('h2', 1866, 'epidemic', 'place', 'Cholera v Čapkově'),
            item('h3', 1914, 'war', 'region', 'První světová válka', 1918),
            item('h4', 1880, 'census', 'local', 'Sčítání lidu'),
        ];
        const html = lifeChartHtml(lifeChartInput(tree(), JAN, { now: NOW, history: hist }), { lang: 'cs', mode: 'file' });
        expect(html).toContain('pp-ch-hist');
        expect(html).toContain('válka, epidemie');
        expect(html).toContain('pp-ch-hm--place'); // the place's glyph leads in 1866 (▲ before ◇)
        // Round 3 §10 (G3): the kind's symbol (an SVG) in the origin's colour, the origin small under it; no ◇ ▲ ■ text.
        expect(html).toContain(`<span class="pp-ch-hg is-place" aria-hidden="true">${historyKindSvg('epidemic', 13)}</span><span class="pp-ch-ho is-place" aria-hidden="true"></span>`);
        expect(html).toContain(`<span class="pp-ch-hg is-local" aria-hidden="true">${historyKindSvg('census', 13)}</span><span class="pp-ch-ho is-local" aria-hidden="true"></span>`);
        expect(html).toContain(historyKindSvg('census', 12)); // the phone set
        expect(html).toContain('aria-label="1866: válka, epidemie"');
        expect(html).not.toMatch(/>[◇▲■]</);
        expect(html).toContain('pp-ch-hbar');
        expect(html).toContain(`href="#${chartHistAnchorId('h3')}"`);
        expect(lifeChartHtml(input(), { lang: 'cs', mode: 'file' })).not.toContain('pp-ch-hist');
    });

    it('history (round 3): glyphs closer than 16 px (14 on a phone) chain into one with the count, labels in two lines never overlap, bars on a line of their own', () => {
        const S = getStringsForLang('cs');
        const h = (id: string, from: number, scope: ChartHistory['scope'], kind = 'war', to?: number): ChartHistory =>
            ({ from, ...(to !== undefined ? { to } : {}), scope, kind, text: `Text ${id}`, anchor: `a-${id}` });
        const xpx = (y: number): number => (y - 1850) * 5; // 5 px a year
        // 1860, 1862, 1863 lie 10 and 5 px apart: one cluster of 3; 1880 stands alone; 1883 is 15 px from it.
        const items = [h('a', 1860, 'region'), h('b', 1862, 'local', 'census'), h('c', 1863, 'place', 'epidemic'),
            h('d', 1880, 'region'), h('e', 1883, 'region', 'flood'), h('bar', 1914, 'region', 'war', 1918)];
        const wide = historyGlyphs(items, S, xpx, 16);
        expect(wide.map(g => g.count)).toEqual([3, 2]);
        expect(wide[0]).toMatchObject({ cluster: true, label: '3 události', anchor: 'a-a', x: xpx(1860.5) });
        // The cluster: the first event's symbol and colour, the most specific origin under it (■ > ▲ > ◇).
        expect(wide[0]).toMatchObject({ kind: 'war', scope: 'region', origin: 'local', aria: '1860–1863: válka, sčítání, epidemie' });
        expect(wide[1]).toMatchObject({ kind: 'war', scope: 'region', origin: 'region' });
        expect(wide[0].title).toBe('1860 Text a; 1862 Text b; 1863 Text c');
        // On a phone 15 px is no longer "near".
        const narrow = historyGlyphs(items, S, xpx, 14);
        expect(narrow.map(g => g.count)).toEqual([3, 1, 1]);
        expect(narrow[1]).toMatchObject({ cluster: false, label: 'válka', anchor: 'a-d' });
        // The bar is no glyph.
        expect(wide.some(g => g.anchor === 'a-bar')).toBe(false);

        // Labels: two lines, at least 6 px free between neighbours on a line, none past the width; no room → left out.
        const many = [0, 10, 20, 30, 300].map(x => ({ x, label: 'epidemie, válka' }));
        const lanes = historyLabelLanes(many, 340);
        expect(lanes.map(l => l?.lane ?? null)).toEqual([0, 1, null, null, 0]);
        for (const lane of [0, 1]) {
            const on = lanes.filter((l): l is NonNullable<typeof l> => !!l && l.lane === lane).sort((a, b) => a.left - b.left);
            for (let i = 1; i < on.length; i++) expect(on[i].left).toBeGreaterThanOrEqual(on[i - 1].left + on[i - 1].width + 6);
            for (const l of on) expect(l.left + l.width).toBeLessThanOrEqual(340);
        }

        // In the chart: the cluster's badge and label, the left-out label's glyph keeps its title, the bar on its own line.
        const hist = [
            ...[1860, 1861, 1862].map((y, i) => ({ ev: { id: `c${i}`, from: y, kind: 'war', scope: 'region', text: { cs: `Válka ${y}` } }, year: y, age: '', place: 'Čapkov', placeKey: 'capkov', text: `Válka ${y}`, textLang: 'cs' })),
            { ev: { id: 'w', from: 1914, to: 1918, kind: 'war', scope: 'region', text: { cs: 'Velká válka' } }, year: 1914, age: '', place: 'Čapkov', placeKey: 'capkov', text: 'Velká válka', textLang: 'cs' },
        ] as unknown as LifelineHistoryItem[];
        const html = lifeChartHtml(lifeChartInput(tree(), JAN, { now: NOW, history: hist }), { lang: 'cs', mode: 'file' });
        expect(html).toContain('pp-ch-hm--c');
        expect(html).toMatch(/<span class="pp-ch-hn">3<\/span>/);
        expect(html).toContain('<span class="pp-ch-hl pp-ch-hl--c"');
        expect(html).toContain('3 události');
        expect(html).toContain('title="1860 Válka 1860; 1861 Válka 1861; 1862 Válka 1862"');
        expect(html).toMatch(/pp-ch-hist--n/); // the phone set: no labels there
        const narrowSet = html.slice(html.lastIndexOf('pp-ch-hist--n'));
        expect(narrowSet.slice(0, narrowSet.indexOf('</div>'))).not.toContain('pp-ch-hl');
    });

    it('history (round 4): on touch each glyph and cluster has a 44 x 44 px target, narrowed to half the gap so neighbours never overlap', () => {
        // 100 px apart: the full 22 px each side; 30 px apart: 15 px towards each other; 9 px: 4.5 px.
        expect(historyTouchHalves([0, 100, 130, 139])).toEqual([{}, { r: 15 }, { l: 15, r: 4.5 }, { l: 4.5 }]);
        const xs = [10, 40, 47, 200];
        const halves = historyTouchHalves(xs);
        for (let i = 1; i < xs.length; i++) {
            expect((halves[i - 1].r ?? 22) + (halves[i].l ?? 22)).toBeLessThanOrEqual(xs[i] - xs[i - 1]);
        }
        // In the chart: the narrowed sides as CSS variables on the glyph's link.
        const hist = [1860, 1864, 1900].map((y, i) => ({ ev: { id: `t${i}`, from: y, kind: 'war', scope: 'region', text: { cs: `Válka ${y}` } }, year: y, age: '', place: 'Čapkov', placeKey: 'capkov', text: `Válka ${y}`, textLang: 'cs' })) as unknown as LifelineHistoryItem[];
        const html = lifeChartHtml(lifeChartInput(tree(), JAN, { now: NOW, history: hist }), { lang: 'cs', mode: 'file' });
        expect(html).toMatch(/class="pp-ch-hm pp-ch-hm--region" href="#[^"]+" data-pp-osa="[^"]+" style="left:[\d.]+%;--tr:[\d.]+px"/);
        expect(html).toMatch(/class="pp-ch-hm pp-ch-hm--region" href="#[^"]+" data-pp-osa="[^"]+" style="left:[\d.]+%;--tl:[\d.]+px"/);
        // The target only on touch, from the variables, 44 px high around the 14 px glyph.
        const coarse = PERSON_PAGE_CHART_CSS.slice(PERSON_PAGE_CHART_CSS.lastIndexOf('@media (pointer: coarse)'));
        expect(coarse).toContain(".pp-ch-hm::before { content: ''; position: absolute; top: -15px; left: calc(-1 * var(--tl, 22px)); width: calc(var(--tl, 22px) + var(--tr, 22px)); height: 44px; }");
        expect(PERSON_PAGE_CHART_CSS.slice(0, PERSON_PAGE_CHART_CSS.lastIndexOf('@media (pointer: coarse)'))).not.toContain('.pp-ch-hm::before');
    });

    it('history (round 5, K5-38): a target reaches into the ages and the period names, but stops half way to a period bar over it', () => {
        expect(barsOver([[100, 200]], 150, 194)).toBe(true);
        expect(barsOver([[100, 200]], 200, 244)).toBe(false);
        expect(barsOver([], 0, 44)).toBe(false);
        // A war of 1866–1880 lies over the glyph of 1870, not over the one of 1900.
        const item = (id: string, from: number, to?: number) => ({ ev: { id, from, to, kind: 'war', scope: 'region', text: { cs: `Válka ${from}` } }, year: from, age: '', place: 'Čapkov', placeKey: 'capkov', text: `Válka ${from}`, textLang: 'cs' });
        const hist = [item('w', 1866, 1880), item('a', 1870), item('b', 1900)] as unknown as LifelineHistoryItem[];
        const html = lifeChartHtml(lifeChartInput(tree(), JAN, { now: NOW, history: hist }), { lang: 'cs', mode: 'file' });
        const marks = [...html.matchAll(/<a class="(pp-ch-hm [^"]*)"[^>]*title="([^"]*)"/g)].map(m => [m[2], m[1].includes('pp-ch-hm--ub')]);
        expect(marks.filter(m => m[0] === '1870 Válka 1870').length).toBeGreaterThan(0);
        expect(marks.filter(m => m[0] === '1870 Válka 1870').every(m => m[1])).toBe(true);
        expect(marks.filter(m => m[0] === '1900 Válka 1900').some(m => m[1])).toBe(false);
        const coarse = PERSON_PAGE_CHART_CSS.slice(PERSON_PAGE_CHART_CSS.lastIndexOf('@media (pointer: coarse)'));
        // From 6 px under the period bar's top to the glyph's 12 px: half way is 9 px, 3 px above the glyph.
        expect(coarse).toContain('.pp-ch-hm--ub::before { top: -3px; height: 32px; }');
        // The phone held sideways: the bar of life 14 px under the glyph, the target 7 px of it.
        expect(coarse).toMatch(/@media \(max-width: 1024px\) and \(max-height: 500px\) and \(orientation: landscape\) and \(pointer: coarse\) \{[^}]*\.pp-ch-hist--n \.pp-ch-hm::before \{ top: -15px; height: 36px; \}/);
    });

    it('escapes names', () => {
        const t = tree();
        t.persons['marie' as PersonId].firstName = '<b>M&M</b>';
        const html = lifeChartHtml(lifeChartInput(t, JAN, { now: NOW }), { lang: 'cs', mode: 'file' });
        expect(html).not.toContain('<b>M&M</b>');
        expect(html).toContain('&lt;b&gt;M&amp;M&lt;/b&gt;');
    });

    it('positions are percentages inside the chart', () => {
        const html = lifeChartHtml(input(), { lang: 'cs', mode: 'file' });
        const lefts = [...html.matchAll(/left:(-?[\d.]+)%/g)].map(m => parseFloat(m[1]));
        expect(lefts.length).toBeGreaterThan(20);
        // The bar's inner wrapper sits left of its box on purpose; everything else lies within 0–100 %.
        expect(lefts.filter(v => v >= 0).every(v => v <= 100)).toBe(true);
    });
});
