/**
 * Fan chart model (pure): ahnentafel numbering, father/mother slot
 * assignment, empty-slot inclusion rule, generation capping and the SVG
 * builder's structural output.
 */

import { describe, it, expect, vi } from 'vitest';
import { StorageManager } from '../storage.js';
import { expandImageText } from '../image-expand.js';
import {
    buildFanModel, buildFanSvg, buildFanPosterSvg, fanPosterGeometry, FanModel, FOCUS_R, RING_W, ancestorRingRadii,
    fanPortraitPeople, fanPrintPortraitMinPx, FAN_PORTRAIT_MIN_PX, FAN_PORTRAIT_MIN_MM,
} from '../fan-chart.js';
import { FAN_PALETTES, fanLineColor, fanPalette } from '../fan-colors.js';
import { estimateFanMeasure as estimate, fanScreenSizes } from '../fan-labels.js';
import { StromData, Person, PersonId, Gender, Partnership, PartnershipId } from '../types.js';
import { calibrationWorkload, machineFactor, normalizedMs, measureAgainstBudget, budgetReport } from './helpers/perf-budget.js';
import type { FanPortrait } from '../fan-chart.js';

function person(id: string, gender: Gender = 'male', parentIds: string[] = [], o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: id, lastName: 'X', gender, isPlaceholder: false,
        parentIds: parentIds as PersonId[], childIds: [], partnerships: [],
        ...o,
    };
}
function data(persons: Person[]): StromData {
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: {},
    };
}
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const svgOpts = { esc, editable: true, addParentLabel: 'Add parent' };

describe('buildFanModel', () => {
    it('assigns ahnentafel numbers: father 2n (left), mother 2n+1 (right)', () => {
        const d = data([
            person('f', 'male', ['pgf', 'pgm']),
            person('m', 'female', ['mgf', 'mgm']),
            person('me', 'male', ['f', 'm']),
            person('pgf'), person('pgm', 'female'),
            person('mgf'), person('mgm', 'female'),
        ]);
        const model = buildFanModel(d, 'me' as PersonId, 3)!;
        const at = (n: number) => model.sectors.find(s => s.ahnentafel === n)?.person?.id;
        expect(at(2)).toBe('f');
        expect(at(3)).toBe('m');
        expect(at(4)).toBe('pgf');
        expect(at(5)).toBe('pgm');
        expect(at(6)).toBe('mgf');
        expect(at(7)).toBe('mgm');
        expect(model.maxKnownGen).toBe(2);
        // Father sits leftmost in his ring.
        const father = model.sectors.find(s => s.ahnentafel === 2)!;
        expect(father.indexInGen).toBe(0);
    });

    it('includes empty slots only directly above a known person', () => {
        const d = data([
            person('f', 'male'),           // father with no parents
            person('me', 'male', ['f']),   // mother unknown entirely
        ]);
        const model = buildFanModel(d, 'me' as PersonId, 3)!;
        // Ring 1: father (known) + mother slot (empty, child = me).
        const ring1 = model.sectors.filter(s => s.generation === 1);
        expect(ring1).toHaveLength(2);
        expect(ring1.find(s => s.ahnentafel === 3)?.person).toBeNull();
        expect(ring1.find(s => s.ahnentafel === 3)?.childId).toBe('me');
        // Ring 2: only the father's two empty slots (mother is unknown → her
        // parents' slots are not rendered at all).
        const ring2 = model.sectors.filter(s => s.generation === 2);
        expect(ring2).toHaveLength(2);
        expect(ring2.every(s => s.person === null && s.childId === 'f')).toBe(true);
        // Ring 3: nothing (no known person in ring 2).
        expect(model.sectors.filter(s => s.generation === 3)).toHaveLength(0);
    });

    it('falls back to declaration order when genders do not disambiguate', () => {
        const d = data([
            person('a', 'male'), person('b', 'male'),
            person('me', 'female', ['a', 'b']),
        ]);
        const model = buildFanModel(d, 'me' as PersonId, 1)!;
        expect(model.sectors.find(s => s.ahnentafel === 2)?.person?.id).toBe('a');
        expect(model.sectors.find(s => s.ahnentafel === 3)?.person?.id).toBe('b');
    });

    it('a single female parent goes to the mother slot', () => {
        const d = data([person('m', 'female'), person('me', 'male', ['m'])]);
        const model = buildFanModel(d, 'me' as PersonId, 1)!;
        expect(model.sectors.find(s => s.ahnentafel === 2)?.person).toBeNull();
        expect(model.sectors.find(s => s.ahnentafel === 3)?.person?.id).toBe('m');
    });

    it('keeps generations in the 1–10 range (whole rings) and returns null for a missing focus', () => {
        const d = data([person('me')]);
        expect(buildFanModel(d, 'nobody' as PersonId, 5)).toBeNull();
        expect(buildFanModel(d, 'me' as PersonId, 99)!.generations).toBe(10);
        expect(buildFanModel(d, 'me' as PersonId, 0)!.generations).toBe(1);
        expect(buildFanModel(d, 'me' as PersonId, -3)!.generations).toBe(1);
        expect(buildFanModel(d, 'me' as PersonId, 4.7)!.generations).toBe(4);
        expect(buildFanModel(d, 'me' as PersonId, { generations: 10, shape: 'full' })!.generations).toBe(10);
        expect(buildFanModel(d, 'me' as PersonId, { generations: 5, shape: 'two', descGenerations: 9 })!.descGenerations).toBe(5);
        expect(buildFanModel(d, 'me' as PersonId, { generations: 5, shape: 'half', descGenerations: 3 })!.descGenerations).toBe(0);
    });
});

describe('buildFanSvg', () => {
    const family = data([
        person('f', 'male', [], { birthDate: '1900', deathDate: '1970' }),
        person('m', 'female'),
        person('me', 'male', ['f', 'm'], { birthDate: '1930' }),
    ]);

    it('renders focus disc, person sectors and empty slots with data attributes', () => {
        const model = buildFanModel(family, 'me' as PersonId, 2)!;
        const svg = buildFanSvg(model, svgOpts);
        expect(svg).toContain('data-fan-person="me"');
        expect(svg).toContain('data-fan-person="f"');
        expect(svg).toContain('data-fan-person="m"');
        expect(svg).toContain('data-fan-add="f"');   // f's unknown parents
        expect(svg).toContain('1900–1970');
        expect(svg.startsWith('<svg')).toBe(true);
    });

    it('omits empty slots when not editable (view mode)', () => {
        const model = buildFanModel(family, 'me' as PersonId, 2)!;
        const svg = buildFanSvg(model, { ...svgOpts, editable: false });
        expect(svg).not.toContain('data-fan-add');
        expect(svg).toContain('data-fan-person="f"');
    });

    it('splits a long radial name into given names and surname lines before shortening it', () => {
        const d = data([
            person('me', 'male', ['f', 'm']),
            person('f', 'male', ['gf', 'gm']),
            person('m', 'female'),
            person('gf', 'male', ['ggf'], {}),
            person('gm', 'female'),
            person('ggf', 'male', [], { firstName: 'Johannes Jacobus', lastName: 'Laroulek' }),
        ]);
        const model = buildFanModel(d, 'me' as PersonId, 4)!;
        const svg = buildFanSvg(model, { ...svgOpts, ppu: 1.4, measure: estimate });
        expect(svg).toContain('>Johannes Jacobus<');
        expect(svg).toContain('>Laroulek<');
        expect(svg).not.toContain('Johannes Jaco…');
    });

    it('fits a long name of a parent along the arc whole, shrinking the font a little', () => {
        const d = data([
            person('me', 'male', ['f', 'm']),
            person('f', 'male', [], { firstName: 'Maximilián Bartoloměj', lastName: 'Kratochvílovský' }),
            person('m', 'female'),
        ]);
        const model = buildFanModel(d, 'me' as PersonId, 3)!;
        const svg = buildFanSvg(model, { ...svgOpts, ppu: 1.2, measure: estimate });
        expect(svg).toContain('<textPath');
        expect(svg).toContain('Maximilián Bartoloměj Kratochvílovský');
    });

    it('"Hide others" (098 §11b): the sectors of the others empty dashed outlines in their places, the focus as always', () => {
        const d = data([
            person('me', 'male', ['f', 'm']),
            person('f', 'male', ['ff', 'fm'], { birthDate: '1900', deathDate: '1970' }),
            person('m', 'female', ['mf'], { birthDate: '1905', deathDate: '1980' }),
            person('ff', 'male'), person('fm', 'female'), person('mf', 'male'),
        ]);
        const model = buildFanModel(d, 'me' as PersonId, 3)!;
        const all = buildFanSvg(model, { ...svgOpts, ppu: 3, measure: estimate });
        const kept = buildFanSvg(model, { ...svgOpts, ppu: 3, measure: estimate, keepOnly: new Set(['m', 'mf'] as PersonId[]) });
        // The mother's side as before (same shape), the father's side empty outlines without people.
        const pathOf = (svg: string, key: string) => new RegExp(`data-fan-key="${key}"[^>]*>(?:<[^>]+>)*?<path class="fan-fill[^"]*" d="([^"]+)"`).exec(svg)?.[1];
        expect(pathOf(kept, 'a3')).toBe(pathOf(all, 'a3'));
        expect(pathOf(kept, 'a6')).toBe(pathOf(all, 'a6'));
        expect(kept).toContain('data-fan-person="me"');
        expect(kept).toContain('data-fan-person="m"');
        expect(kept).not.toContain('data-fan-person="f"');
        expect(kept).not.toContain('data-fan-person="ff"');
        expect(kept).not.toContain('1900–1970');
        const off = [...kept.matchAll(/<g class="fan-sector fan-sector--off" data-fan-off="(a\d+)" aria-hidden="true" pointer-events="none"><path class="fan-empty-edge" d="([^"]+)"/g)];
        expect(off.map(m => m[1]).sort()).toEqual(['a2', 'a4', 'a5', 'a8', 'a9', 'a10', 'a11'].sort());
        // The outline stands where the father's sector stood.
        expect(off.find(m => m[1] === 'a2')![2]).toBe(pathOf(all, 'a2'));
        // No "+" over a hidden person; the kept mother's missing parent keeps it.
        expect(kept).not.toContain('data-fan-add="f"');
        expect(kept).not.toContain('data-fan-add="ff"');
        expect(kept).toContain('data-fan-add="m"');
        // Not editable: the outlines still get their colour.
        expect(buildFanSvg(model, { ...svgOpts, editable: false, keepOnly: new Set(['m'] as PersonId[]) })).toContain('.fan-empty-edge{stroke:');
    });

    it('escapes person names', () => {
        const d = data([person('me', 'male', [], { firstName: '<Evil & "Q"' })]);
        const model = buildFanModel(d, 'me' as PersonId, 4)!;
        const svg = buildFanSvg(model, svgOpts);
        expect(svg).toContain('&lt;Evil &amp;');
        expect(svg).not.toContain('<Evil');
    });
});

describe('buildFanPosterSvg', () => {
    const fam = () => data([
        person('f', 'male', ['pgf']),
        person('m', 'female'),
        person('me', 'male', ['f', 'm']),
        person('pgf'),
    ]);

    it('wraps the fan in a self-contained poster with a white background', () => {
        const model = buildFanModel(fam(), 'me' as PersonId, 4)!;
        const svg = buildFanPosterSvg(model, svgOpts, {});
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
        // Poster root carries xmlns + font (the on-canvas fan relies on page CSS).
        expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
        expect(svg).toContain('font-family=');
        // White background rect.
        expect(svg).toContain('fill="#ffffff"');
        // Nested fan SVG is present and given an explicit viewport.
        expect(svg).toMatch(/<svg class="fan-svg"[^>]*width="/);
    });

    it('embeds explicit print colours (no CSS variables needed)', () => {
        const model = buildFanModel(fam(), 'me' as PersonId, 4)!;
        const svg = buildFanPosterSvg(model, svgOpts, {});
        expect(svg).toContain('<style>');
        expect(svg).toContain(`{fill:${FAN_PALETTES.print.male}}`);
        expect(svg).toContain(`{fill:${FAN_PALETTES.print.female}}`);
        // No unresolved theme variables, no dark-theme rules in the standalone poster.
        expect(svg).not.toContain('var(--');
        expect(svg).not.toContain('data-theme');
    });

    it('draws the shared footer (tree name · view label · date)', () => {
        const model = buildFanModel(fam(), 'me' as PersonId, 4)!;
        const svg = buildFanPosterSvg(model, svgOpts, {
            treeName: 'My Family', viewLabel: 'Fan — ancestors of me, 4 generations', dateLabel: '1. 1. 2026',
        });
        expect(svg).toContain('My Family');
        expect(svg).toContain('Fan — ancestors of me, 4 generations');
        expect(svg).toContain('1. 1. 2026');
    });

    it('is never editable — no "+" add-parent affordances in the poster', () => {
        // fam() leaves several empty ancestor slots (would be "+" in edit mode).
        const model = buildFanModel(fam(), 'me' as PersonId, 4)!;
        const svg = buildFanPosterSvg(model, { ...svgOpts, editable: true }, {});
        expect(svg).not.toContain('data-fan-add');
        expect(svg).not.toContain('fan-plus');
    });
});

describe('fanPosterGeometry (tile skipping)', () => {
    const model = () => buildFanModel(data([
        person('me', 'male', ['f']), person('f', 'male'),
    ]), 'me' as PersonId, 5)!;

    it('reports a poster larger than the bare fan (padding + footer)', () => {
        const noFooter = fanPosterGeometry(model(), {});
        const withFooter = fanPosterGeometry(model(), { treeName: 'T' });
        expect(withFooter.height).toBeGreaterThan(noFooter.height);
        expect(withFooter.width).toBe(noFooter.width);
    });

    it('keeps the fan and skips a far bottom-right corner tile', () => {
        const g = fanPosterGeometry(model(), { treeName: 'T' });
        // A tile at the top of the arc, under the title, has content.
        expect(g.hasContent(g.width / 2 - 20, 120, 40, 40)).toBe(true);
        // The extreme bottom-right corner is outside the semicircle → empty.
        expect(g.hasContent(g.width - 20, g.height - 60, 20, 15)).toBe(false);
        // The footer strip at the bottom-left is content, though.
        expect(g.hasContent(g.width * 0.05, g.height - 10, 30, 8)).toBe(true);
    });
});

// ==================== spec 029: shapes, ten rings, pedigree collapse, descendants ====================

const SURNAMES = ['Laroulek', 'Pospíchal', 'Zrzavý', 'Lobkovec', 'Ostružník', 'Kvítek'];

/** A complete pedigree: person `a{n}` at Kekulé number n, every slot known up to `gens` rings. */
function pedigree(gens: number): StromData {
    const persons: Person[] = [];
    for (let n = 1; n < 2 ** (gens + 1); n++) {
        const g = Math.floor(Math.log2(n));
        const born = 2000 - 27 * g;
        persons.push(person(`a${n}`, n === 1 || n % 2 === 0 ? 'male' : 'female',
            n < 2 ** gens ? [`a${2 * n}`, `a${2 * n + 1}`] : [],
            { firstName: n % 2 === 0 ? 'Bohumil' : 'Anna', lastName: SURNAMES[n % SURNAMES.length], birthDate: String(born), deathDate: String(born + 60) }));
    }
    return data(persons);
}

function union(id: string, a: string, b: string, childIds: string[], o: Partial<Partnership> = {}): Partnership {
    return { id: id as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId, childIds: childIds as PersonId[], status: 'married', ...o };
}

function withUnions(persons: Person[], unions: Partnership[]): StromData {
    const d = data(persons);
    for (const u of unions) {
        d.partnerships[u.id] = u;
        for (const pid of [u.person1Id, u.person2Id]) d.persons[pid]?.partnerships.push(u.id);
        for (const c of u.childIds) {
            for (const pid of [u.person1Id, u.person2Id]) {
                const p = d.persons[pid];
                if (p && !p.childIds.includes(c)) p.childIds.push(c);
                const ch = d.persons[c];
                if (p && ch && !ch.parentIds.includes(pid)) ch.parentIds.push(pid);
            }
        }
    }
    return d;
}

const sectorOf = (m: FanModel, n: number) => m.sectors.find(s => s.ahnentafel === n)!;
const ringSpan = (m: FanModel, g: number) => m.sectors.filter(s => s.generation === g).reduce((a, s) => a + (s.hi - s.lo), 0);

describe('fan shapes (spec 029 §0.3)', () => {
    const d = pedigree(3);

    it('half circle: the father fills the left quarter, rings narrow outward, bounds end under the focus', () => {
        const m = buildFanModel(d, 'a1' as PersonId, { generations: 3, shape: 'half' })!;
        expect([sectorOf(m, 2).lo, sectorOf(m, 2).hi]).toEqual([90, 180]);
        expect([sectorOf(m, 3).lo, sectorOf(m, 3).hi]).toEqual([0, 90]);
        expect(sectorOf(m, 4).hi - sectorOf(m, 4).lo).toBe(45);
        expect([sectorOf(m, 2).r1, sectorOf(m, 2).r2]).toEqual([FOCUS_R, FOCUS_R + RING_W[0]]);
        expect(m.R).toBe(ancestorRingRadii(3)[1]);
        expect(m.bounds).toEqual({ x: -m.R - 10, y: -m.R - 10, w: 2 * m.R + 20, h: m.R + FOCUS_R + 20 });
        expect(m.desc).toHaveLength(0);
    });

    it('full circle: the father takes the left half (90°–270°), the mother the right, square bounds', () => {
        const m = buildFanModel(d, 'a1' as PersonId, { generations: 3, shape: 'full' })!;
        expect([sectorOf(m, 2).lo, sectorOf(m, 2).hi]).toEqual([90, 270]);
        expect([sectorOf(m, 3).lo, sectorOf(m, 3).hi]).toEqual([-90, 90]);
        // The father's father sits lower left, his mother upper left.
        expect([sectorOf(m, 4).lo, sectorOf(m, 4).hi]).toEqual([180, 270]);
        expect([sectorOf(m, 5).lo, sectorOf(m, 5).hi]).toEqual([90, 180]);
        for (const g of [1, 2, 3]) expect(ringSpan(m, g)).toBeCloseTo(360);
        expect(m.bounds.w).toBe(m.bounds.h);
    });

    it('two-way: ancestors as the half circle, descendants in the lower half', () => {
        const fam = withUnions([
            person('me', 'male'), person('w', 'female'), person('c', 'female', [], { birthDate: '1950' }),
        ], [union('u1', 'me', 'w', ['c'])]);
        const m = buildFanModel(fam, 'me' as PersonId, { generations: 3, shape: 'two', descGenerations: 2 })!;
        expect(m.desc.length).toBeGreaterThan(0);
        for (const s of m.desc) {
            expect(s.lo).toBeGreaterThanOrEqual(180);
            expect(s.hi).toBeLessThanOrEqual(360);
        }
        const partner = m.desc.find(s => s.kind === 'partner')!;
        expect([partner.r1, partner.r2]).toEqual([FOCUS_R, FOCUS_R + 12]);
        const child = m.desc.find(s => s.kind === 'desc')!;
        expect([child.r1, child.r2]).toEqual([FOCUS_R + 12, FOCUS_R + 12 + 70]);
        expect(m.Rd).toBe(FOCUS_R + 12 + 70);
        expect(m.bounds.y + m.bounds.h).toBe(Math.max(m.Rd, FOCUS_R) + 10);
    });
});

describe('labels of wide short sectors on a phone (1101)', () => {
    // Three children share the lower half: 60° each in the first descendant ring.
    const fam = () => withUnions([
        person('me', 'male'), person('w', 'female'),
        ...['c1', 'c2', 'c3'].map((id, i) => person(id, 'female', [], { firstName: 'Kristýna', lastName: 'Novotná', birthDate: String(1950 + i) })),
    ], [union('u1', 'me', 'w', ['c1', 'c2', 'c3'])]);

    it('a 60° child sector at the phone\'s zoomed-out scale still carries the name, along its arc', () => {
        const m = buildFanModel(fam(), 'me' as PersonId, { generations: 3, shape: 'two', descGenerations: 2 })!;
        const c3 = m.desc.find(s => s.person?.id === 'c3')!;
        expect(c3.hi - c3.lo).toBeCloseTo(60);
        const svg = buildFanSvg(m, { ...svgOpts, editable: false, ppu: 0.67, measure: estimate, sizes: fanScreenSizes(true) });
        for (const id of ['c1', 'c2', 'c3']) {
            const g = svg.match(new RegExp(`<g class="fan-sector female fan-desc"[^>]*data-fan-person="${id}"[^]*?</g>`))![0];
            expect(g).toContain('class="fan-name"');
            expect(g).toMatch(/>Kristýna</);
        }
    });

    it('the focus disc keeps the given name where only a cut surname would fit', () => {
        const d = withUnions([
            person('me', 'male', [], { firstName: 'Johann', lastName: 'Oberwaldenburger-Kreuzfeldt' }), person('w', 'female'),
            person('c1', 'female'),
        ], [union('u1', 'me', 'w', ['c1'])]);
        const m = buildFanModel(d, 'me' as PersonId, { generations: 3, shape: 'two', descGenerations: 2 })!;
        const svg = buildFanSvg(m, { ...svgOpts, editable: false, ppu: 0.45, measure: estimate, sizes: fanScreenSizes(true) });
        const disc = svg.match(/<g class="fan-focus[^]*?<\/g>/)![0];
        expect(disc).toMatch(/>Johann</);
        expect(disc).not.toContain('…');
    });

    it('a long given name in the focus disc stays inside the disc on a phone, whole in the title (P1b, 3.30.0)', () => {
        const d = withUnions([
            person('me', 'male', [], { firstName: 'Wendelin Bonifatius', lastName: 'Haselbrunner-Quellenstein' }), person('w', 'female'),
            person('c1', 'female'),
        ], [union('u1', 'me', 'w', ['c1'])]);
        for (const [shape, ppu] of [['half', 0.45], ['two', 0.45], ['half', 0.35]] as const) {
            const m = buildFanModel(d, 'me' as PersonId, { generations: 3, shape, descGenerations: 2 })!;
            const svg = buildFanSvg(m, { ...svgOpts, editable: false, ppu, measure: estimate, sizes: fanScreenSizes(true) });
            const disc = svg.match(/<g class="fan-focus[^]*?<\/g>/)![0];
            const rows = [...disc.matchAll(/<text[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].map(x => ({ fs: Number(x[1]) * ppu, text: x[2] }));
            expect(rows.length, `${shape} @${ppu}`).toBeGreaterThan(0);
            // The disc's text box: 1.7 radii less 6 px, as the ladder measures it.
            for (const r of rows) expect(estimate(r.text, r.fs, true), `${shape} @${ppu}: "${r.text}"`).toBeLessThanOrEqual(56 * 1.7 * ppu - 6);
            expect(rows[0].text).toMatch(/^Wen/);
            // A cut word ends the text (no second cut row).
            expect(rows.filter(r => r.text.endsWith('…')).length).toBeLessThanOrEqual(1);
            if (rows.length > 1) expect(rows[0].text.endsWith('…')).toBe(false);
            expect(disc).toMatch(/<title>[^<]*Wendelin Bonifatius Haselbrunner-Quellenstein/);
        }
    });

    it('a sector whose own box holds the name keeps that direction', () => {
        const m = buildFanModel(fam(), 'me' as PersonId, { generations: 3, shape: 'two', descGenerations: 2 })!;
        const before = buildFanSvg(m, { ...svgOpts, editable: false, ppu: 3, measure: estimate });
        // At three times the scale the radial box is enough: no text along the arc in the children's ring.
        const c2 = before.match(/<g class="fan-sector female fan-desc"[^>]*data-fan-person="c2"[^]*?<\/g>/)![0];
        expect(c2).toContain('class="fan-name"');
        expect(c2).not.toContain('<textPath');
    });
});

describe('ten rings', () => {
    it('draws all 2 046 ancestors of a complete pedigree, each ring closing its half circle', () => {
        const m = buildFanModel(pedigree(10), 'a1' as PersonId, { generations: 10, shape: 'half' })!;
        expect(m.sectors).toHaveLength(2046);
        expect(m.sectors.filter(s => s.generation === 10)).toHaveLength(1024);
        expect(m.maxKnownGen).toBe(10);
        for (let g = 1; g <= 10; g++) expect(ringSpan(m, g)).toBeCloseTo(180);
        expect(m.R).toBe(FOCUS_R + RING_W.reduce((a, w) => a + w, 0));
        // Father's line on the left: the father's father's … father is the leftmost sector of ring 10.
        expect(sectorOf(m, 1024).hi).toBe(180);
    });

    it('builds and draws ten rings of a full circle within the time budget (scaled by the machine speed)', () => {
        const d = pedigree(10);
        const CALIBRATION_ROUNDS = 4;
        const REFERENCE_MS = 22; // 4 of the 16 rounds measured at 88 ms on the reference machine
        const BUDGET_MS = 250;
        const run = () => buildFanSvg(buildFanModel(d, 'a1' as PersonId, { generations: 10, shape: 'full' })!, {
            esc, editable: false, addParentLabel: '', ppu: 1.5, measure: estimate,
        });
        run();
        let best = Infinity, measured = 0, cal = 0;
        for (let i = 0; i < 4; i++) {
            const c0 = performance.now();
            calibrationWorkload(CALIBRATION_ROUNDS);
            const calMs = performance.now() - c0;
            const t0 = performance.now();
            const svg = run();
            const ms = performance.now() - t0;
            expect(svg.length).toBeGreaterThan(0);
            const n = normalizedMs(ms, calMs, REFERENCE_MS);
            if (n < best) { best = n; measured = ms; cal = calMs; }
        }
        console.log(`[fan perf] 10 rings full: ${best.toFixed(1)} ms normalized (${measured.toFixed(1)} ms, machine ×${machineFactor(cal, REFERENCE_MS).toFixed(2)})`);
        expect(best).toBeLessThan(BUDGET_MS);
    }, 30_000);
});

describe('pedigree collapse (spec 029 §7)', () => {
    // The father's mother (5) and the mother's father (6) are siblings: their parents
    // x and y appear as 10/11 and again as 12/13; x's father would be 20 and 24.
    const d = data([
        person('me', 'male', ['f', 'm']),
        person('f', 'male', ['g1', 'g2']), person('m', 'female', ['g3', 'g4']),
        person('g1'), person('g2', 'female', ['x', 'y']), person('g3', 'male', ['x', 'y']), person('g4', 'female'),
        person('x', 'male', ['xx']), person('y', 'female', [], { firstName: 'Anna', lastName: 'Pospíchalová', birthDate: '1781', deathDate: '1840' }),
        person('xx', 'male'),
    ]);

    it('marks the second occurrence with the first Kekulé number and does not expand it', () => {
        const m = buildFanModel(d, 'me' as PersonId, 6)!;
        expect(sectorOf(m, 10).person?.id).toBe('x');
        expect(sectorOf(m, 10).repeatOf).toBeUndefined();
        expect(sectorOf(m, 12).repeatOf).toBe(10);
        expect(sectorOf(m, 13).repeatOf).toBe(11);
        expect(sectorOf(m, 20).person?.id).toBe('xx');
        // Nothing above the repeats — not even empty "+" slots.
        for (const n of [24, 25, 26, 27, 48, 49]) expect(m.sectors.find(s => s.ahnentafel === n)).toBeUndefined();
        const svg = buildFanSvg(m, { ...svgOpts, editable: true, ppu: 2, measure: estimate });
        expect(svg).not.toContain('data-fan-ahnentafel="24"');
    });

    it('hatches a repeat, starts its text with ↻ and says where it was first', () => {
        const m = buildFanModel(d, 'me' as PersonId, 4)!;
        const svg = buildFanSvg(m, { ...svgOpts, ppu: 3, measure: estimate });
        const g = svg.match(/<g class="fan-sector female fan-repeat"[^>]*data-fan-ahnentafel="13"[^]*?<\/g>/)![0];
        expect(g).toContain('data-fan-repeat-of="a11"');
        expect(g).toContain('class="fan-hatch"');
        expect(g).toContain('>↻ ');
        expect(g).toContain('<title>#13 · Anna Pospíchalová (1781–1840) · Repeats, first as no. 11</title>');
    });
});

describe('descendants (two-way, spec 029 §2.3)', () => {
    // me ⚭ w1 (1950): c1 (1951, three children with p1), c2 (1953, a childless marriage);
    // me ⚭ w2 (1960): no children; c3 (1965): no other parent recorded.
    const fam = () => withUnions([
        person('me', 'male'), person('w1', 'female'), person('w2', 'female'), person('p1', 'female'), person('p2', 'female'),
        person('c1', 'male', [], { birthDate: '1951' }), person('c2', 'female', [], { birthDate: '1953' }),
        person('c3', 'male', [], { birthDate: '1965' }),
        person('k1', 'male', [], { birthDate: '1980' }), person('k2', 'female', [], { birthDate: '1982' }), person('k3', 'male', [], { birthDate: '1984' }),
    ], [
        union('u2', 'me', 'w2', [], { startDate: '1960' }),
        union('u1', 'me', 'w1', ['c2', 'c1'], { startDate: '1950' }),
        union('u3', 'c1', 'p1', ['k1', 'k2', 'k3']),
        union('u4', 'c2', 'p2', []),
    ]);
    const extra = (d: StromData) => {
        d.persons['c3' as PersonId].parentIds.push('me' as PersonId);
        d.persons['me' as PersonId].childIds.push('c3' as PersonId);
        return d;
    };

    it('sizes each descendant by the leaves under it, unions in marriage order, children by birth', () => {
        const m = buildFanModel(extra(fam()), 'me' as PersonId, { generations: 3, shape: 'two', descGenerations: 3 })!;
        const at = (id: string, kind = 'desc') => m.desc.find(s => s.person?.id === id && s.kind === kind)!;
        // Leaves: c1 → 3 grandchildren, c2 → 1, the childless w2 union → 1, c3 → 1: six parts of 180°.
        expect(at('w1', 'partner').lo).toBeCloseTo(180);
        expect(at('w1', 'partner').hi).toBeCloseTo(300);
        expect(at('c1').hi - at('c1').lo).toBeCloseTo(90);
        expect(at('c1').lo).toBeLessThan(at('c2').lo); // born first, although listed second
        expect(at('w2', 'partner').lo).toBeCloseTo(300);
        expect(at('w2', 'partner').hi).toBeCloseTo(330);
        // The grandchildren under c1, with c1's partner as a band, in birth order.
        expect(['k1', 'k2', 'k3'].map(id => at(id).lo)).toEqual([...['k1', 'k2', 'k3'].map(id => at(id).lo)].sort((a, b) => a - b));
        expect(at('p1', 'partner').depth).toBe(2);
        // A childless marriage further down is not drawn.
        expect(m.desc.find(s => s.person?.id === 'p2')).toBeUndefined();
        expect(m.descDepth).toBe(2);
    });

    it('draws a child without a recorded other parent beside an unknown, hatched, untappable partner band', () => {
        const m = buildFanModel(extra(fam()), 'me' as PersonId, { generations: 3, shape: 'two', descGenerations: 2 })!;
        const unknown = m.desc.find(s => s.kind === 'partner' && !s.person)!;
        expect(unknown.lo).toBeCloseTo(330);
        expect(unknown.hi).toBeCloseTo(360);
        const svg = buildFanSvg(m, { ...svgOpts, ppu: 2, measure: estimate });
        const g = svg.match(/<g class="fan-sector unknown fan-partner fan-unknown-partner"[^]*?<\/g>/)![0];
        expect(g).not.toContain('data-fan-person');
        expect(g).toContain('class="fan-hatch"');
        expect(g).toContain('<title>Unknown partner</title>');
        expect(svg).toContain('data-fan-kind="desc"');
        expect(svg).toContain('data-fan-kind="partner"');
    });

    it('limits the depth: one generation shows the children only', () => {
        const m = buildFanModel(extra(fam()), 'me' as PersonId, { generations: 3, shape: 'two', descGenerations: 1 })!;
        expect(m.desc.filter(s => s.kind === 'desc').map(s => s.person!.id)).toEqual(['c1', 'c2', 'c3']);
        expect(m.desc.find(s => s.person?.id === 'p1')).toBeUndefined();
        expect(m.descDepth).toBe(1);
    });

    it('a descendant met twice (cousins marrying) is drawn once in full, then as a repeat', () => {
        const d = withUnions([
            person('me', 'male'), person('w', 'female'),
            person('a', 'male', [], { birthDate: '1950' }), person('b', 'female', [], { birthDate: '1952' }),
            person('pa', 'female'), person('pb', 'male'),
            person('ga', 'male', [], { birthDate: '1975' }), person('gb', 'female', [], { birthDate: '1977' }),
            person('gg', 'female', [], { birthDate: '2000' }),
        ], [
            union('u0', 'me', 'w', ['a', 'b']),
            union('ua', 'a', 'pa', ['ga']), union('ub', 'pb', 'b', ['gb']),
            union('ug', 'ga', 'gb', ['gg']),
        ]);
        const m = buildFanModel(d, 'me' as PersonId, { generations: 3, shape: 'two', descGenerations: 4 })!;
        expect(m.desc.filter(s => s.person?.id === 'gg')).toHaveLength(1);
        const gbAsChild = m.desc.find(s => s.person?.id === 'gb' && s.kind === 'desc')!;
        const gbAsPartner = m.desc.find(s => s.person?.id === 'gb' && s.kind === 'partner')!;
        expect(gbAsPartner.repeatOfKey).toBeUndefined();
        expect(gbAsChild.repeatOfKey).toBe(gbAsPartner.key);
    });
});

describe('buildFanSvg (spec 029)', () => {
    const fam = () => data([
        person('me', 'male', ['f', 'm'], { birthDate: '1990' }),
        person('f', 'male', [], { firstName: 'Bohumil', lastName: 'Kvítek', birthDate: '1960', deathDate: '2020' }),
        person('m', 'female', [], { firstName: 'Anna', lastName: 'Ostružníková', marriedSurname: 'Kvítková', birthDate: '1962' }),
    ]);

    it('marks every sector with key, kind and person, the focus too', () => {
        const svg = buildFanSvg(buildFanModel(fam(), 'me' as PersonId, 3)!, { ...svgOpts, measure: estimate });
        expect(svg).toMatch(/<svg class="fan-svg" id="[^"]+"[^>]*data-fan-shape="half"/);
        expect(svg).toContain('data-fan-key="a2" data-fan-kind="anc" data-fan-ahnentafel="2" data-fan-person="f"');
        expect(svg).toContain('data-fan-key="f" data-fan-kind="focus" data-fan-person="me"');
        expect(svg).toContain('vector-effect="non-scaling-stroke"');
    });

    it('shows a protected living person as "Living person" without dates, in the label and the title', () => {
        const isLiving = (p: Person) => !p.deathDate;
        const svg = buildFanSvg(buildFanModel(fam(), 'me' as PersonId, 3)!, { ...svgOpts, ppu: 3, measure: estimate, protect: isLiving });
        expect(svg).toContain('<title>#3 · Living person</title>');
        expect(svg).not.toContain('Kvítková');
        expect(svg).not.toContain('1962');
        expect(svg).toContain('Bohumil Kvítek');
    });

    it('shows the married surname, the birth surname in the title and where it fits (setting "both")', () => {
        const svg = buildFanSvg(buildFanModel(fam(), 'me' as PersonId, 3)!, { ...svgOpts, ppu: 3, measure: estimate });
        expect(svg).toContain('#3 · Anna Kvítková (née Ostružníková) (* 1962)');
        expect(svg).toContain('>née Ostružníková<');
        const small = buildFanSvg(buildFanModel(fam(), 'me' as PersonId, 3)!, { ...svgOpts, ppu: 0.6, measure: estimate });
        expect(small).not.toContain('>née Ostružníková<');
    });

    it('links sectors to pages when asked (saved HTML)', () => {
        const svg = buildFanSvg(buildFanModel(fam(), 'me' as PersonId, 3)!, {
            ...svgOpts, editable: false, measure: estimate, linkFor: id => (id === 'f' ? 'f.html' : null),
        });
        expect(svg).toContain('<a href="f.html"><g class="fan-sector male"');
        expect(svg.match(/<a /g)).toHaveLength(1);
    });

    it('labels only the sectors in the viewport, but draws and titles all of them', () => {
        const m = buildFanModel(pedigree(6), 'a1' as PersonId, 6)!;
        const all = buildFanSvg(m, { ...svgOpts, editable: false, ppu: 3, measure: estimate });
        // The far left of the fan only (the father's side).
        const left = buildFanSvg(m, { ...svgOpts, editable: false, ppu: 3, measure: estimate, viewport: { x: m.bounds.x, y: -60, w: 120, h: 80 } });
        const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
        expect(count(left, /class="fan-fill/g)).toBe(count(all, /class="fan-fill/g));
        expect(count(left, /<title>/g)).toBe(count(all, /<title>/g));
        expect(count(left, /class="fan-name"/g)).toBeLessThan(count(all, /class="fan-name"/g) / 3);
        expect(left).toContain('viewBox="');
        // The mother's sector (right half) has no text in the left viewport.
        const mother = left.match(/data-fan-ahnentafel="3"[^]*?<\/g>/)![0];
        expect(mother).not.toContain('<text');
    });

    it('shows more text after zooming in (K1.4)', () => {
        const m = buildFanModel(pedigree(8), 'a1' as PersonId, 8)!;
        const names = (ppu: number) => (buildFanSvg(m, { ...svgOpts, editable: false, ppu, measure: estimate }).match(/class="fan-name"/g) ?? []).length;
        const years = (ppu: number) => (buildFanSvg(m, { ...svgOpts, editable: false, ppu, measure: estimate }).match(/class="fan-years"/g) ?? []).length;
        expect(names(1)).toBeLessThan(names(4));
        expect(years(1)).toBeLessThan(years(4));
        // Font sizes in fan units shrink with the scale: the text does not grow with the zoom.
        const fs = (ppu: number) => Number(buildFanSvg(m, { ...svgOpts, editable: false, ppu, measure: estimate }).match(/class="fan-name" font-size="([\d.]+)"/)![1]);
        expect(fs(4)).toBeLessThan(fs(1));
    });

    it('colours by grandparent lines and follows the dark theme on screen', () => {
        const m = buildFanModel(pedigree(3), 'a1' as PersonId, 3)!;
        const svg = buildFanSvg(m, { ...svgOpts, colorMode: 'line', measure: estimate, uid: 'tfan' });
        for (let line = 0; line < 4; line++) {
            expect(svg).toContain(`{fill:${fanLineColor(line, 2, 'light')}}`);
            expect(svg).toContain(`{fill:${fanLineColor(line, 2, 'dark')}}`);
        }
        expect(svg).toContain('[data-theme="dark"] #tfan .fan-name{fill:#e8e3d6}');
        expect(svg).toContain('<pattern id="tfanh"');
    });
});

describe('fan poster (spec 029 §9)', () => {
    const fam = () => withUnions([
        person('me', 'female', ['f', 'm'], { firstName: 'Tereza', lastName: 'Zrzavá' }),
        person('f', 'male', ['ff', 'fm']), person('m', 'female'), person('ff', 'male'), person('fm', 'female'),
        person('h', 'male'), person('c', 'male', [], { birthDate: '2010' }),
    ], [union('u1', 'me', 'h', ['c'])]);

    it('titles the poster with the name and what is shown, for all three shapes', () => {
        const half = buildFanPosterSvg(buildFanModel(fam(), 'me' as PersonId, { generations: 7, shape: 'half' })!, { ...svgOpts, colorMode: 'line', measure: estimate }, {});
        expect(half).toContain('>Tereza Zrzavá · ancestors<');
        expect(half).toContain('>7 generations · half circle · coloured by lines<');
        expect(half).toContain("father's father");
        const full = buildFanPosterSvg(buildFanModel(fam(), 'me' as PersonId, { generations: 4, shape: 'full' })!, { ...svgOpts, measure: estimate }, {});
        expect(full).toContain('>4 generations · full circle · coloured by sex<');
        expect(full).toContain('data-fan-shape="full"');
        const two = buildFanPosterSvg(buildFanModel(fam(), 'me' as PersonId, { generations: 5, shape: 'two', descGenerations: 3 })!, { ...svgOpts, measure: estimate }, {});
        expect(two).toContain('>Tereza Zrzavá · ancestors and descendants<');
        expect(two).toContain('>5 generations of ancestors, 3 of descendants · two-way · coloured by sex<');
        expect(two).toContain('data-fan-kind="desc"');
    });

    it('adds "↻ repeats" to the legend when a person repeats', () => {
        const d = data([
            person('me', 'male', ['f', 'm']), person('f', 'male', ['x']), person('m', 'female', ['x']), person('x', 'male'),
        ]);
        const svg = buildFanPosterSvg(buildFanModel(d, 'me' as PersonId, 4)!, { ...svgOpts, measure: estimate }, {});
        expect(svg).toContain('↻ repeats (pedigree collapse)');
        expect(svg).toContain('class="fan-hatch"');
    });

    it('knows the shape when skipping empty tiles (conservatively)', () => {
        const opts = { measure: estimate };
        const at = (shape: 'half' | 'full' | 'two') => {
            const m = buildFanModel(fam(), 'me' as PersonId, { generations: 5, shape, descGenerations: 2 })!;
            const g = fanPosterGeometry(m, { treeName: 'T' }, opts);
            // The fan centre in poster px: under the header, at the model's origin.
            const svg = buildFanPosterSvg(m, { ...svgOpts, ...opts }, { treeName: 'T' });
            const [, fx, fy, fw] = svg.match(/<svg class="fan-svg" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/)!.map(Number);
            const s = fw / m.bounds.w;
            return { m, g, cx: fx - m.bounds.x * s, cy: fy - m.bounds.y * s, s };
        };
        {
            const { m, g, cx, cy, s } = at('half');
            expect(g.hasContent(cx - 5, cy - m.R * s + 5, 10, 10)).toBe(true);   // top of the arc
            expect(g.hasContent(cx - 5, cy - 5, 10, 10)).toBe(true);             // the focus
            expect(g.hasContent(cx + m.R * s - 30, cy + 20, 20, 20)).toBe(false); // below the right end
        }
        {
            const { m, g, cx, cy, s } = at('full');
            expect(g.hasContent(cx - 5, cy + m.R * s - 15, 10, 10)).toBe(true);  // bottom of the circle
            const c = m.R * s * 0.8;
            expect(g.hasContent(cx + c, cy + c, 10, 10)).toBe(false);            // the lower right corner
        }
        {
            const { m, g, cx, cy, s } = at('two');
            expect(g.hasContent(cx - 5, cy + m.Rd * s - 15, 10, 10)).toBe(true); // the descendants
            expect(g.hasContent(cx - 5, cy + m.Rd * s + 25, 10, 10)).toBe(false); // below them
            expect(g.hasContent(cx + m.R * s - 30, cy + m.Rd * s + 5, 20, 20)).toBe(false);
        }
    });
});

describe('styles of the drawing (spec 118 §4)', () => {
    const d = data([
        person('me', 'male', ['f', 'm']),
        person('f', 'male', ['ff', 'fm']), person('m', 'female', ['mf', 'mm']),
        person('ff'), person('fm', 'female'), person('mf'), person('mm', 'female'),
    ]);
    const model = buildFanModel(d, 'me' as PersonId, 4)!;
    const draw = (o: Record<string, unknown> = {}) => buildFanSvg(model, { ...svgOpts, uid: 'st', measure: estimate, ...o });

    it('draws the default as the colour style: the screen palettes, the sans face, no patterns', () => {
        for (const mode of ['gender', 'line', 'rod'] as const) {
            const svg = draw({ colorMode: mode });
            expect(draw({ colorMode: mode, style: 'color' })).toBe(svg);
            expect(svg).toContain('data-fan-style="color"');
            expect(svg).toContain(`font-family="'Instrument Sans'`);
            expect(svg).not.toContain('<pattern id="stp-');
            expect(svg).not.toContain('fan-pat');
            expect(svg).toContain(`#st .fan-years,#st .fan-kekule{fill:${FAN_PALETTES.light.text}}`);
        }
    });

    it('draws the antique style in Strom Serif with its own palettes', () => {
        const svg = draw({ style: 'antique' });
        expect(svg).toContain('data-fan-style="antique"');
        expect(svg).toContain(`font-family="'Strom Serif', Georgia, serif"`);
        expect(svg).toContain(`fill:${fanPalette('light', 'antique').male}`);
        expect(svg).toContain(`fill:${fanPalette('dark', 'antique').female}`);
    });

    it('black and white: the patterns once each in <defs> (at most 8), a halo for the names, the outline in the text colour', () => {
        const gender = draw({ style: 'mono' });
        expect(gender.match(/<pattern id="stp-/g)).toEqual(['<pattern id="stp-']);
        expect(gender).toContain('fill="url(#stp-dot)"');
        expect(gender).toContain('paint-order:stroke');
        expect(gender).toContain(`#st .fan-pat-ink{stroke:${fanPalette('light', 'mono').text}`);
        const rod = draw({ style: 'mono', colorMode: 'rod' });
        const pats = rod.match(/<pattern id="stp-[a-z0-9]+"/g) ?? [];
        expect(pats.length).toBeGreaterThan(0);
        expect(pats.length).toBeLessThanOrEqual(8);
        expect(new Set(pats).size).toBe(pats.length);
        const hl = buildFanSvg(model, {
            ...svgOpts, uid: 'st', measure: estimate, style: 'mono', embedStyles: true, theme: 'light',
            highlight: { rodId: 'r' as never, hit: new Set(['f' as PersonId]) },
        });
        expect(hl).toContain(`.fan-hl-edge{fill:none;stroke:${fanPalette('light', 'mono').text}`);
    });

    it('the poster takes the style: the print palette, pattern swatches in the legend, the antique face', () => {
        const mono = buildFanPosterSvg(model, { ...svgOpts, measure: estimate, style: 'mono' }, {});
        expect(mono).toContain('fanposter-lp-dot');
        const antique = buildFanPosterSvg(model, { ...svgOpts, measure: estimate, style: 'antique' }, {});
        expect(antique).toContain(`class="fan-poster-legend" font-family="'Strom Serif', Georgia, serif"`);
    });
});

// ==================== spec 118 §5, §6: content of the sectors and portraits ====================

describe('content of the sectors (spec 118 §5)', () => {
    const placed = (gens: number) => {
        const d = pedigree(gens);
        for (const p of Object.values(d.persons)) {
            p.birthDate = `${p.birthDate}-11-22`;
            p.birthPlace = 'Kessenau, okres Dolní Lhota';
            p.deathPlace = 'Tálov';
        }
        return d;
    };

    it("the default drawing is the 'years' drawing, unchanged", () => {
        const m = buildFanModel(placed(4), 'a1' as PersonId, { generations: 4, shape: 'two', descGenerations: 2 })!;
        const o = { ...svgOpts, uid: 'cy', measure: estimate, ppu: 2 };
        expect(buildFanSvg(m, { ...o, content: 'years' })).toBe(buildFanSvg(m, o));
        expect(buildFanSvg(m, o)).not.toContain('Kessenau');
    });

    it("'places' writes dates and places in the inner rings and the centre; 'names' no dates at all", () => {
        const m = buildFanModel(placed(4), 'a1' as PersonId, { generations: 4, shape: 'half' })!;
        const o = { ...svgOpts, uid: 'cp', measure: estimate, ppu: 3 };
        const places = buildFanSvg(m, { ...o, content: 'places' });
        const parent = places.match(/<g class="fan-sector[^"]*" data-fan-key="a2"[^]*?<\/g>/)![0];
        expect(parent).toContain('Kessenau');
        expect(parent).toContain('Tálov');
        const focus = places.match(/<g class="fan-focus[^]*?<\/g>/)![0];
        expect(focus).toContain('Kessenau');
        const names = buildFanSvg(m, { ...o, content: 'names' });
        expect(names).not.toContain('class="fan-years"');
        // One pixel more for the names (13 → 14 px in the parents' ring at this scale).
        const fs = (svg: string, key: string) => Number(svg.match(new RegExp(`data-fan-key="${key}"[^]*?class="fan-name" font-size="([0-9.]+)"`))![1]) * 3;
        expect(fs(names, 'a2')).toBeCloseTo(fs(buildFanSvg(m, o), 'a2') + 1, 1);
    });

    it('the poster writes the places too', () => {
        const m = buildFanModel(placed(3), 'a1' as PersonId, { generations: 3, shape: 'half' })!;
        expect(buildFanPosterSvg(m, { ...svgOpts, measure: estimate, content: 'places' }, {})).toContain('Kessenau');
        expect(buildFanPosterSvg(m, { ...svgOpts, measure: estimate }, {})).not.toContain('Kessenau');
    });

    it('ten rings of a full circle with dates and places within the time budget (scaled by the machine speed)', () => {
        const d = placed(10);
        const CALIBRATION_ROUNDS = 4;
        const REFERENCE_MS = 22; // as the ten-ring test above
        const BUDGET_MS = 250;
        const run = () => buildFanSvg(buildFanModel(d, 'a1' as PersonId, { generations: 10, shape: 'full' })!, {
            esc, editable: false, addParentLabel: '', ppu: 1.5, measure: estimate, content: 'places',
        });
        expect(run()).toContain('Kessenau');
        const m = measureAgainstBudget(run, { budgetMs: BUDGET_MS, calibrationRounds: CALIBRATION_ROUNDS, referenceMs: REFERENCE_MS, maxPairs: 6 });
        console.log(budgetReport('fan 10 rings full, places', m, BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(BUDGET_MS);
    }, 30_000);
});

describe('portraits (spec 118 §6)', () => {
    const PHOTO = 'data:image/png;base64,iVBORw0KGgo=';
    const withPhotos = (gens: number) => {
        const d = pedigree(gens);
        for (const p of Object.values(d.persons)) p.photo = PHOTO;
        return d;
    };
    const photoOf = (p: Person): FanPortrait | null => (p.photo ? { href: p.photo } : null);
    const sectorOf2 = (svg: string, key: string) => svg.match(new RegExp(`<g class="fan-(?:sector|focus)[^"]*" data-fan-key="${key}"[^]*?</g>(?=<g class="fan-|<a |</svg>|<g class="fan-hl)`))?.[0] ?? '';
    const images = (svg: string) => (svg.match(/<image /g) ?? []).length;

    it('any ring, as far as a portrait is large enough at the zoom (K2.8): zooming in shows more, zooming out hides them', () => {
        const m = buildFanModel(withPhotos(5), 'a1' as PersonId, { generations: 5, shape: 'half' })!;
        const at = (ppu: number) => buildFanSvg(m, { ...svgOpts, uid: 'pt', measure: estimate, ppu, portrait: photoOf });
        const near = at(2);
        // Every ring up to the fifth: 1 + 2 + 4 + 8 + 16 + 32.
        expect(images(near)).toBe(63);
        for (const key of ['f', 'a2', 'a3', 'a7', 'a8', 'a15', 'a16', 'a31', 'a32', 'a63']) expect(sectorOf2(near, key), key).toContain('<image ');
        // Round: clipped by a circle, the photo's ring in the surface colour.
        expect(near).toContain('clip-path="url(#ptc0)"');
        expect(near).toContain('preserveAspectRatio="xMidYMid slice"');
        expect(near).toMatch(/\.fan-photo-ring\{stroke:/);
        // At the whole fan's scale the outer rings are too small: no portrait there, the inner rings keep theirs.
        const far = at(1);
        for (const key of ['a32', 'a47', 'a63']) expect(sectorOf2(far, key), key).not.toContain('<image ');
        for (const key of ['f', 'a2', 'a3', 'a4']) expect(sectorOf2(far, key), key).toContain('<image ');
        // More zoom never fewer portraits.
        const counts = [0.4, 0.7, 1, 1.5, 2, 4].map(ppu => images(at(ppu)));
        for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
        expect(counts[0]).toBeLessThan(counts[counts.length - 1]);
    });

    it('a portrait of at least FAN_PORTRAIT_MIN_PX (32 px) across; portraitMinPx changes it', () => {
        expect(FAN_PORTRAIT_MIN_PX).toBe(32);
        const m = buildFanModel(withPhotos(5), 'a1' as PersonId, { generations: 5, shape: 'half' })!;
        const draw = (o: { ppu: number; portraitMinPx?: number }) => buildFanSvg(m, { ...svgOpts, uid: 'pm', measure: estimate, portrait: photoOf, ...o });
        const diam = (svg: string) => [...svg.matchAll(/<circle class="fan-photo-ring" cx="[-0-9.]+" cy="[-0-9.]+" r="([0-9.]+)"/g)].map(x => 2 * Number(x[1]));
        for (const ppu of [0.6, 1, 1.4, 2]) {
            for (const d of diam(draw({ ppu }))) expect(d * ppu).toBeGreaterThanOrEqual(FAN_PORTRAIT_MIN_PX - 1e-6);
        }
        // The fifth ring's portraits are about 46 px at this scale: a 50 px threshold leaves them out, the fourth ring keeps its own.
        const strict = draw({ ppu: 2, portraitMinPx: 50 });
        for (const key of ['a32', 'a63']) expect(sectorOf2(strict, key), key).not.toContain('<image ');
        for (const key of ['a16', 'a31']) expect(sectorOf2(strict, key), key).toContain('<image ');
        for (const d of diam(strict)) expect(d * 2).toBeGreaterThanOrEqual(50 - 1e-6);
    });

    it('the photos asked for only of the sectors in view that would show one (spec 116: the loads stay small)', () => {
        const m = buildFanModel(withPhotos(6), 'a1' as PersonId, { generations: 6, shape: 'half' })!;
        const asked: string[] = [];
        const drawn: string[] = [];
        // Zoomed into the father's father's side (upper left, ring 3–4), 8× the whole fan's scale.
        const [x, y] = [-260, -200];
        const svg = buildFanSvg(m, {
            ...svgOpts, uid: 'pv', measure: estimate, ppu: 8, viewport: { x, y, w: 120, h: 90 },
            portrait: p => { asked.push(p.id); return photoOf(p); },
            onPortrait: p => { drawn.push(p.id); },
        });
        expect(asked.length).toBeGreaterThan(0);
        expect(asked.length).toBeLessThan(20);
        // The mother's side (right) is out of view: never asked.
        for (const id of asked.filter(x => x !== 'a1')) expect(m.sectors.find(s => s.person?.id === id)!.lo, id).toBeGreaterThanOrEqual(90);
        // Every portrait drawn is told, once.
        expect(drawn.length).toBe(images(svg));
        expect(new Set(drawn).size).toBe(drawn.length);
    });

    it('the photo rules only where a portrait is drawn: without one the drawing (and the person page) stays as it was', () => {
        const m = buildFanModel(withPhotos(5), 'a1' as PersonId, { generations: 5, shape: 'half' })!;
        expect(buildFanSvg(m, { ...svgOpts, uid: 'pn', measure: estimate, ppu: 2 })).not.toContain('fan-photo');
        expect(buildFanSvg(m, { ...svgOpts, uid: 'pn', measure: estimate, ppu: 2, portrait: () => null })).not.toContain('fan-photo');
    });

    it('a pooled image\'s reference: the placeholder with its id, filled on screen (spec 135)', () => {
        const id = 'p:' + 'ab'.repeat(20);
        const d = withPhotos(2);
        for (const p of Object.values(d.persons)) p.photo = '\u0000sm:' + id;
        const m = buildFanModel(d, 'a1' as PersonId, { generations: 2, shape: 'half' })!;
        const svg = buildFanSvg(m, { ...svgOpts, uid: 'pr', measure: estimate, ppu: 2, portrait: photoOf });
        expect(images(svg)).toBe(7);
        expect((svg.match(new RegExp(`<image href="data:image/gif;base64,[^"]+" data-pool-ref="${id}" x="-?[0-9.]+" y="-?[0-9.]+"`, 'g')) ?? []).length).toBe(7);
        expect(svg).not.toContain('\u0000');
    });

    it('the poster (file, print, preview) takes the pooled images whole: no placeholder, the pool\'s data URL (spec 135 D5a)', async () => {
        const id = 'p:' + 'ab'.repeat(20);
        const bytes = new Uint8Array(1200).map((_, i) => (i * 11) & 0xFF);
        const url = 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64');
        const getMany = vi.spyOn(StorageManager, 'getMany').mockImplementation(async (_s: string, keys: string[]) =>
            new Map(keys.map(k => [k, k === id ? { head: 'data:image/jpeg;base64,', bytes: bytes.slice().buffer } : null])) as never);
        try {
            const d = withPhotos(2);
            for (const p of Object.values(d.persons)) p.photo = '\u0000sm:' + id;
            const m = buildFanModel(d, 'a1' as PersonId, { generations: 2, shape: 'half' })!;
            const svg = buildFanSvg(m, { ...svgOpts, uid: 'pp', measure: estimate, ppu: 2, portrait: (p: Person) => photoOf(p) });
            const { data: out, missing } = await expandImageText(svg);
            expect(missing).toBe(0);
            expect(out).not.toContain('data-pool-ref');
            expect(out).not.toContain('data:image/gif');
            expect((out.match(new RegExp(`<image href="${url.replace(/[+/]/g, c => '\\' + c)}" x="-?[0-9.]+"`, 'g')) ?? []).length).toBe(7);
            expect(getMany).toHaveBeenCalledTimes(1);
        } finally {
            getMany.mockRestore();
        }
    });

    it('two-way (K2.7): the descendants and the partners in their band too, as far as they are large enough', () => {
        const d = withPhotos(3);
        d.persons['w1' as PersonId] = person('w1', 'female', [], { firstName: 'Ida', lastName: 'Quernova', photo: PHOTO, birthDate: '2001' });
        d.persons['k1' as PersonId] = person('k1', 'male', [], { firstName: 'Kamil', lastName: 'Belmudr', photo: PHOTO, birthDate: '2025' });
        d.persons['g1' as PersonId] = person('g1', 'female', [], { firstName: 'Lea', lastName: 'Belmudrova', photo: PHOTO, birthDate: '2050' });
        d.persons['w2' as PersonId] = person('w2', 'female', [], { firstName: 'Eva', lastName: 'Tollgrist', photo: PHOTO, birthDate: '2026' });
        const fam = withUnions(Object.values(d.persons), [union('u1', 'a1', 'w1', ['k1']), union('u2', 'k1', 'w2', ['g1'])]);
        const m = buildFanModel(fam, 'a1' as PersonId, { generations: 3, shape: 'two', descGenerations: 2 })!;
        const keyOf = (id: string, kind: string) => m.desc.find(s => s.person?.id === id && s.kind === kind)!.key;
        const draw = (ppu: number) => buildFanSvg(m, { ...svgOpts, uid: 'pw', measure: estimate, ppu, portrait: photoOf });
        const near = draw(8);
        for (const [id, kind] of [['k1', 'desc'], ['g1', 'desc'], ['w1', 'partner'], ['w2', 'partner']]) {
            expect(sectorOf2(near, keyOf(id, kind)), `${id} ${kind}`).toContain('<image ');
        }
        // The partner's band keeps its name beside the photo.
        expect(sectorOf2(near, keyOf('w1', 'partner'))).toMatch(/<textPath[^>]*>[^<]*(Ida|Quernova)/);
        // At the whole fan's scale the thin band has no room for a photo; the children's ring has.
        const far = draw(2);
        expect(sectorOf2(far, keyOf('w1', 'partner'))).not.toContain('<image ');
        expect(sectorOf2(far, keyOf('k1', 'desc'))).toContain('<image ');
        const plain = (svg: string) => sectorOf2(svg, keyOf('w1', 'partner')).replace(/pwr\d+/g, 'pwr');
        expect(plain(far)).toBe(plain(buildFanSvg(m, { ...svgOpts, uid: 'pw', measure: estimate, ppu: 2 })));
        // The fan's people with a possible portrait: the descendants and the partners among them.
        const ids = fanPortraitPeople(m).map(p => p.id);
        for (const id of ['a1', 'a2', 'a15', 'k1', 'g1', 'w1', 'w2']) expect(ids, id).toContain(id);
        expect(fanPortraitPeople(m, p => p.id === 'k1').map(p => p.id)).not.toContain('k1');
    });

    it('none for a protected living person, none without a photo: the sector as without portraits', () => {
        const d = withPhotos(3);
        delete d.persons['a3' as PersonId].photo;
        const m = buildFanModel(d, 'a1' as PersonId, { generations: 3, shape: 'half' })!;
        const o = { ...svgOpts, uid: 'pp', measure: estimate, ppu: 2, protect: (p: Person) => p.id === 'a2' || p.id === 'a1' };
        const asked: string[] = [];
        const svg = buildFanSvg(m, { ...o, portrait: p => { asked.push(p.id); return photoOf(p); } });
        const plain = buildFanSvg(m, o);
        expect(asked).not.toContain('a2');
        expect(asked).not.toContain('a1');
        for (const key of ['f', 'a2', 'a3']) expect(sectorOf2(svg, key), key).toBe(sectorOf2(plain, key));
        expect(sectorOf2(svg, 'a4')).toContain('<image ');
        // Portraits on, nobody with a photo: the very drawing without them.
        const none = buildFanSvg(m, { ...o, portrait: () => null });
        expect(none).toBe(plain);
    });

    it('the text comes first: no portrait at a small scale', () => {
        const m = buildFanModel(withPhotos(3), 'a1' as PersonId, { generations: 3, shape: 'half' })!;
        const o = { ...svgOpts, uid: 'ps', measure: estimate, ppu: 0.4 };
        expect(buildFanSvg(m, { ...o, portrait: photoOf })).toBe(buildFanSvg(m, o));
    });

    it('the text comes first in every ring (K2.8): a portrait never changes what a sector says, a long name keeps its sector without one', () => {
        // Long names as in the finding of 1124 ("Kristina Johann Jarnwick 1879–1947" → "Jarnwick").
        const d = withPhotos(7);
        for (const p of Object.values(d.persons)) {
            const n = Number(p.id.slice(1));
            if (n >= 8 && n % 3 === 0) { p.firstName = p.gender === 'male' ? 'Bartolomej Johann' : 'Kristina Johann'; p.lastName = 'Jarnwick'; }
        }
        d.persons['w1' as PersonId] = person('w1', 'female', [], { firstName: 'Ida', lastName: 'Quernova', photo: PHOTO, birthDate: '2001' });
        d.persons['k1' as PersonId] = person('k1', 'male', [], { firstName: 'Kristian Johann', lastName: 'Oberwaldenfeldt', photo: PHOTO, birthDate: '2024' });
        const fam = withUnions(Object.values(d.persons), [union('u1', 'a1', 'w1', ['k1'])]);
        const m = buildFanModel(fam, 'a1' as PersonId, { generations: 7, shape: 'two', descGenerations: 1 })!;
        // The sectors (the focus disc has its own room for the photo above its text).
        const keys = [...m.sectors.filter(s => s.person).map(s => s.key), ...m.desc.filter(s => s.person).map(s => s.key)];
        const text = (g: string) => [...g.matchAll(/>([^<>]+)</g)].map(x => x[1]).filter(t => !/^\s*$/.test(t)).join(' ')
            .replace(/#\d+ · .*$/, '').replace(/\s+/g, ' ').replace(/\s*–\s*/g, '–').replace(/-\s+/g, '-').trim();
        let portraits = 0;
        const changed: string[] = [];
        for (const ppu of [1, 1.5, 2, 3, 4, 6, 8]) {
            const o = { ...svgOpts, uid: 'pt', measure: estimate, ppu };
            const on = buildFanSvg(m, { ...o, portrait: photoOf });
            const off = buildFanSvg(m, o);
            for (const key of keys) {
                const a = sectorOf2(on, key);
                if (a.includes('<image ')) portraits++;
                if (text(a) !== text(sectorOf2(off, key))) changed.push(`${key} @${ppu}: ${text(sectorOf2(off, key))} → ${text(a)}`);
            }
        }
        expect(changed).toEqual([]);
        // Portraits are still drawn where the text keeps beside them.
        expect(portraits).toBeGreaterThan(20);
        // a9 (Kristina Johann Jarnwick) in the fourth ring next to the narrow fifth: no portrait where its text would be shortened.
        const o = { ...svgOpts, uid: 'pt', measure: estimate, ppu: 2 };
        expect(text(sectorOf2(buildFanSvg(m, { ...o, portrait: photoOf }), 'a9'))).toBe(text(sectorOf2(buildFanSvg(m, o), 'a9')));
    });

    it('a portrait moves the text outward, past itself', () => {
        const m = buildFanModel(withPhotos(3), 'a1' as PersonId, { generations: 3, shape: 'half' })!;
        const svg = buildFanSvg(m, { ...svgOpts, uid: 'po', measure: estimate, ppu: 2, portrait: photoOf });
        // The father's sector (90°–180°, along the arc at 135°): the photo's centre nearer the focus than the text's rail.
        const g = sectorOf2(svg, 'a2');
        const [cx, cy, r] = g.match(/<circle class="fan-photo-ring" cx="([-0-9.]+)" cy="([-0-9.]+)" r="([0-9.]+)"/)!.slice(1).map(Number);
        const rPhoto = Math.hypot(cx, cy);
        const [r1, r2] = ancestorRingRadii(1);
        expect(rPhoto - r).toBeGreaterThanOrEqual(r1);
        expect(rPhoto).toBeLessThan((r1 + r2) / 2);
        // Every row of its text runs on a rail outside the photo.
        const ids = [...g.matchAll(/<textPath href="#(por\d+)"/g)].map(x => x[1]);
        expect(ids.length).toBeGreaterThan(0);
        for (const id of ids) {
            const rail = Number(svg.match(new RegExp(`<path id="${id}" d="M[-0-9.]+ [-0-9.]+A([0-9.]+)`))![1]);
            expect(rail).toBeGreaterThan(rPhoto + r);
            expect(rail).toBeLessThan(r2);
        }
    });

    it('the antique style sepia, black and white grey, colour as it is', () => {
        const m = buildFanModel(withPhotos(2), 'a1' as PersonId, { generations: 2, shape: 'half' })!;
        const draw = (style: 'color' | 'pastel' | 'antique' | 'mono') => buildFanSvg(m, { ...svgOpts, uid: 'pf', measure: estimate, ppu: 2, portrait: photoOf, style });
        expect(draw('antique')).toContain('<filter id="pfsepia"');
        expect(draw('antique')).toContain('filter="url(#pfsepia)"');
        expect(draw('mono')).toContain('<filter id="pfgrey"');
        expect(draw('mono')).toContain('type="saturate" values="0"');
        expect(draw('color')).not.toContain('<filter');
        expect(draw('pastel')).not.toContain('<filter');
    });

    it('a large tree zoomed in: hundreds of portraits within the time budget of a redraw (scaled by the machine speed)', () => {
        // Nine rings of a full circle, everyone with a photo (1023 people), at 3× the whole fan's scale and over it all.
        const m = buildFanModel(withPhotos(9), 'a1' as PersonId, { generations: 9, shape: 'full' })!;
        const CALIBRATION_ROUNDS = 4;
        const REFERENCE_MS = 22; // as the ten-ring tests
        const BUDGET_MS = 250;
        const run = () => buildFanSvg(m, { esc, editable: false, addParentLabel: '', ppu: 3, measure: estimate, portrait: photoOf });
        expect(images(run())).toBeGreaterThan(200);
        const r = measureAgainstBudget(run, { budgetMs: BUDGET_MS, calibrationRounds: CALIBRATION_ROUNDS, referenceMs: REFERENCE_MS, maxPairs: 6 });
        console.log(budgetReport('fan 9 rings full, portraits', r, BUDGET_MS));
        if (r.judged) expect(r.ms).toBeLessThan(BUDGET_MS);
    }, 30_000);

    it('the view\'s own print: 7 mm on the landscape sheet, never under the screen\'s 32 px', () => {
        // A half fan of 5 rings is 868 units wide: 277 mm across, 0.319 mm a unit; 7 mm = 21.9 units.
        const m = buildFanModel(withPhotos(5), 'a1' as PersonId, { generations: 5, shape: 'half' })!;
        const mmPerUnit = Math.min(277 / m.bounds.w, 161.5 / m.bounds.h);
        expect(fanPrintPortraitMinPx(m.bounds, 2)).toBeCloseTo(Math.max(32, 7 / mmPerUnit * 2), 5);
        expect(fanPrintPortraitMinPx(m.bounds, 2)).toBeGreaterThan(32);
        // A tiny scale: the screen's own threshold still holds.
        expect(fanPrintPortraitMinPx(m.bounds, 0.5)).toBe(32);
        // Each printed portrait at least 7 mm.
        const svg = buildFanSvg(m, { ...svgOpts, uid: 'pq', measure: estimate, ppu: 2, portrait: photoOf, portraitMinPx: fanPrintPortraitMinPx(m.bounds, 2) });
        const rs = [...svg.matchAll(/<circle class="fan-photo-ring" cx="[-0-9.]+" cy="[-0-9.]+" r="([0-9.]+)"/g)].map(x => Number(x[1]));
        expect(rs.length).toBeGreaterThan(0);
        for (const r of rs) expect(2 * r * mmPerUnit).toBeGreaterThanOrEqual(7 - 1e-6);
    });

    it('a photo on its way: initials on grey under the veil, an older photo under it', () => {
        const m = buildFanModel(withPhotos(2), 'a1' as PersonId, { generations: 2, shape: 'half' })!;
        const svg = buildFanSvg(m, {
            ...svgOpts, uid: 'pl', measure: estimate, ppu: 2,
            portrait: p => p.id === 'a2' ? { loading: true, initials: 'BL' } : p.id === 'a3' ? { loading: true, initials: 'AK', href: PHOTO } : null,
        });
        const a2 = sectorOf2(svg, 'a2');
        expect(a2).toContain('data-img-state="loading"');
        expect(a2).toContain('class="fan-photo-wait"');
        expect(a2).toContain('>BL</text>');
        expect(a2).toContain('class="fan-photo-veil"');
        expect(a2).not.toContain('<image ');
        const a3 = sectorOf2(svg, 'a3');
        expect(a3).toContain('data-img-state="refresh"');
        expect(a3).toContain('<image ');
        expect(a3).toContain('class="fan-photo-veil"');
    });

    it('the poster takes the portraits (no veil: outputs wait for the photos), each at least 7 mm on paper', () => {
        const m = buildFanModel(withPhotos(5), 'a1' as PersonId, { generations: 5, shape: 'half' })!;
        const poster = buildFanPosterSvg(m, { ...svgOpts, measure: estimate, portrait: photoOf, style: 'antique' }, {});
        // Beyond the rings 1–2 (K2.8): the third and fourth rings have room on paper too.
        expect(images(poster)).toBeGreaterThan(7);
        expect(poster).not.toContain('fan-photo-veil"');
        expect(poster).toContain('filter="url(#fanpostersepia)"');
        expect(buildFanPosterSvg(m, { ...svgOpts, measure: estimate }, {})).not.toContain('<image ');
        // Every photo at least FAN_PORTRAIT_MIN_MM across: the fan's units × the poster's scale × mm per px.
        const scale = Number(poster.match(/<svg class="fan-svg" x="[-0-9.]+" y="[-0-9.]+" width="([0-9.]+)"/)![1]) / m.bounds.w;
        for (const mmPerPx of [0.26, 0.5]) {
            const out = buildFanPosterSvg(m, { ...svgOpts, measure: estimate, portrait: photoOf, mmPerPx }, {});
            const rs = [...out.matchAll(/<circle class="fan-photo-ring" cx="[-0-9.]+" cy="[-0-9.]+" r="([0-9.]+)"/g)].map(x => Number(x[1]));
            expect(rs.length).toBeGreaterThan(0);
            for (const r of rs) expect(2 * r * scale * mmPerPx).toBeGreaterThanOrEqual(FAN_PORTRAIT_MIN_MM - 1e-6);
        }
        // A larger print (0.5 mm per px): 7 mm are fewer px, so the outer rings get theirs too.
        const coarse = buildFanPosterSvg(m, { ...svgOpts, measure: estimate, portrait: photoOf, mmPerPx: 0.5 }, {});
        expect(images(coarse)).toBeGreaterThan(images(poster));
    });
});
