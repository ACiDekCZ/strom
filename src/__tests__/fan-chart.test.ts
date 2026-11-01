/**
 * Fan chart model (pure): ahnentafel numbering, father/mother slot
 * assignment, empty-slot inclusion rule, generation capping and the SVG
 * builder's structural output.
 */

import { describe, it, expect } from 'vitest';
import {
    buildFanModel, buildFanSvg, buildFanPosterSvg, fanPosterGeometry, FanModel, FOCUS_R, RING_W, ancestorRingRadii,
} from '../fan-chart.js';
import { FAN_PALETTES, fanLineColor } from '../fan-colors.js';
import { estimateFanMeasure as estimate, fanScreenSizes } from '../fan-labels.js';
import { StromData, Person, PersonId, Gender, Partnership, PartnershipId } from '../types.js';
import { calibrationWorkload, machineFactor, normalizedMs } from './helpers/perf-budget.js';

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
        const noFooter = fanPosterGeometry(model(), false);
        const withFooter = fanPosterGeometry(model(), true);
        expect(withFooter.height).toBeGreaterThan(noFooter.height);
        expect(withFooter.width).toBe(noFooter.width);
    });

    it('keeps the fan and skips a far bottom-right corner tile', () => {
        const g = fanPosterGeometry(model(), true);
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
            const g = fanPosterGeometry(m, true, opts);
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
