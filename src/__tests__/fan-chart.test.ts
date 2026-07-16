/**
 * Fan chart model (pure): ahnentafel numbering, father/mother slot
 * assignment, empty-slot inclusion rule, generation capping and the SVG
 * builder's structural output.
 */

import { describe, it, expect } from 'vitest';
import { buildFanModel, buildFanSvg, buildFanPosterSvg, fanPosterGeometry } from '../fan-chart.js';
import { StromData, Person, PersonId, Gender } from '../types.js';

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

    it('caps generations to the 4–8 range and returns null for a missing focus', () => {
        const d = data([person('me')]);
        expect(buildFanModel(d, 'nobody' as PersonId, 5)).toBeNull();
        const model = buildFanModel(d, 'me' as PersonId, 99)!;
        expect(model.generations).toBe(8);
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

    it('wraps long radial names onto separate lines instead of ellipsizing', () => {
        const d = data([
            person('me', 'male', ['f', 'm']),
            person('f', 'male', ['gf', 'gm']),
            person('m', 'female'),
            person('gf', 'male', ['ggf'], {}),
            person('gm', 'female'),
            // gen 3 (radial text): a long multi-word name must word-wrap, not truncate
            person('ggf', 'male', [], { firstName: 'Johannes Jacobus', lastName: 'Paroulek' }),
        ]);
        const model = buildFanModel(d, 'me' as PersonId, 4)!;
        const svg = buildFanSvg(model, svgOpts);
        expect(svg).toContain('>Johannes<');
        expect(svg).toContain('>Jacobus<');
        expect(svg).toContain('>Paroulek<');
        expect(svg).not.toContain('Johannes Jaco…');
    });

    it('shrinks curved-rail font for long gen-1/2 names before truncating', () => {
        const d = data([
            person('me', 'male', ['f', 'm']),
            person('f', 'male', [], { firstName: 'Maximilián Bartoloměj', lastName: 'Kratochvílovský' }),
            person('m', 'female'),
        ]);
        const model = buildFanModel(d, 'me' as PersonId, 3)!;
        const svg = buildFanSvg(model, svgOpts);
        // The long name gets an inline shrunk font-size and stays whole.
        expect(svg).toMatch(/fan-name g1" style="font-size:[\d.]+px"/);
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

    it('embeds explicit light-theme colours (no CSS variables needed)', () => {
        const model = buildFanModel(fam(), 'me' as PersonId, 4)!;
        const svg = buildFanPosterSvg(model, svgOpts, {});
        expect(svg).toContain('<style>');
        expect(svg).toContain('.fan-sector.male path{fill:#e3f2fd}');
        expect(svg).toContain('.fan-sector.female path{fill:#fce4ec}');
        // No unresolved theme variables leak into the standalone poster.
        expect(svg).not.toContain('var(--male)');
        expect(svg).not.toContain('var(--text');
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

    it('keeps the fan centre and skips a far bottom-right corner tile', () => {
        const g = fanPosterGeometry(model(), true);
        // A tile over the fan centre (top-middle of the poster) has content.
        expect(g.hasContent(g.width / 2 - 20, 20, 40, 40)).toBe(true);
        // The extreme bottom-right corner is outside the semicircle → empty.
        expect(g.hasContent(g.width - 20, g.height - 60, 20, 15)).toBe(false);
        // The footer strip at the bottom-left is content, though.
        expect(g.hasContent(g.width * 0.05, g.height - 10, 30, 8)).toBe(true);
    });
});
