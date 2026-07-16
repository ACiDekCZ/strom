/**
 * Timeline chart SVG builder: the on-screen 'screen' output (CSS classes +
 * foreignObject labels) and the self-contained 'poster' output (embedded light
 * colours, plain-text labels, shared footer, full time range and every row).
 */

import { describe, it, expect } from 'vitest';
import { computeTimelineModel } from '../timeline.js';
import { buildTimelineSvg, buildTimelinePosterSvg, timelinePosterGeometry } from '../timeline-chart.js';
import { StromData, PersonId, PartnershipId, Person, Partnership, Gender, LifeEvent } from '../types.js';

interface POpts {
    birthDate?: string; deathDate?: string; events?: LifeEvent[]; partnerships?: string[]; isPlaceholder?: boolean;
}
function person(id: string, first: string, gender: Gender, o: POpts = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: 'X', gender, isPlaceholder: o.isPlaceholder ?? false,
        parentIds: [], childIds: [], partnerships: (o.partnerships ?? []) as PartnershipId[],
        ...(o.birthDate ? { birthDate: o.birthDate } : {}),
        ...(o.deathDate ? { deathDate: o.deathDate } : {}),
        ...(o.events ? { events: o.events } : {}),
    };
}
function data(persons: Person[], partnerships: Partnership[] = []): StromData {
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: Object.fromEntries(partnerships.map(u => [u.id, u])) as StromData['partnerships'],
    };
}
const ids = (d: StromData) => Object.keys(d.persons);
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TODAY = 2026;

const fam = () => data([
    person('a', 'Old', 'male', { birthDate: '1883', deathDate: '1947' }),
    person('b', 'Young', 'female', { birthDate: '1902', deathDate: '1975' }),
    person('c', 'Alive', 'male', { birthDate: '1990' }),
]);

describe('buildTimelineSvg (screen mode)', () => {
    it('renders a life-bar per row with the person id and CSS classes', () => {
        const d = fam();
        const model = computeTimelineModel(d, ids(d), TODAY);
        const svg = buildTimelineSvg(model, { esc, width: 800, rowH: 30, labelW: 160, mode: 'screen' });
        expect(svg.startsWith('<svg class="timeline-svg"')).toBe(true);
        expect(svg).toContain('data-person-id="a"');
        expect(svg).toContain('data-person-id="b"');
        expect(svg).toContain('data-person-id="c"');
        // Bar rectangles carry the on-screen class; the name uses foreignObject.
        expect(svg).toContain('class="tl-bar-rect"');
        expect(svg).toContain('<foreignObject');
        expect(svg).toContain('class="tl-name"');
        // Screen mode relies on the page stylesheet — no embedded <style>.
        expect(svg).not.toContain('<style>');
    });

    it('marks the focused row and dims non-matching search rows', () => {
        const d = fam();
        const model = computeTimelineModel(d, ids(d), TODAY);
        const svg = buildTimelineSvg(model, {
            esc, width: 800, rowH: 30, labelW: 160, mode: 'screen',
            focusId: 'b' as PersonId, highlightIds: new Set(['c']),
        });
        expect(svg).toContain('class="timeline-bar focused search-dim" data-person-id="b"');
        expect(svg).toContain('class="timeline-bar search-hit" data-person-id="c"');
    });
});

describe('buildTimelinePosterSvg', () => {
    it('wraps a self-contained poster with a white background and no CSS vars', () => {
        const d = fam();
        const model = computeTimelineModel(d, ids(d), TODAY);
        const svg = buildTimelinePosterSvg(model, { esc }, {});
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
        expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
        expect(svg).toContain('font-family=');
        expect(svg).toContain('fill="#ffffff"');            // white canvas
        expect(svg).toMatch(/<svg class="timeline-svg"[^>]*width="/); // nested viewport
        expect(svg).not.toContain('var(--');                // fully self-contained
    });

    it('embeds explicit light-theme colours and draws names as plain text', () => {
        const d = fam();
        const model = computeTimelineModel(d, ids(d), TODAY);
        const svg = buildTimelinePosterSvg(model, { esc }, {});
        expect(svg).toContain('<style>');
        expect(svg).toContain('.tl-grid{stroke:#e2e2e2');
        expect(svg).toContain('.tl-name-txt{fill:#222');
        // Poster labels are <text>, never <foreignObject> (canvas-safe PNG).
        expect(svg).not.toContain('<foreignObject');
        expect(svg).toContain('class="tl-name-txt"');
    });

    it('draws every row and the full time range (not the screen viewport)', () => {
        const d = fam();
        const model = computeTimelineModel(d, ids(d), TODAY);
        const svg = buildTimelinePosterSvg(model, { esc }, {});
        // All three people appear.
        for (const id of ['a', 'b', 'c']) expect(svg).toContain(`data-person-id="${id}"`);
        // Axis ticks span the whole decade-rounded range (1880 … 2030).
        expect(svg).toContain('>1880<');
        expect(svg).toContain('>2020<');
    });

    it('draws the shared footer (tree name · view label · date)', () => {
        const d = fam();
        const model = computeTimelineModel(d, ids(d), TODAY);
        const svg = buildTimelinePosterSvg(model, { esc }, {
            treeName: 'My Family', viewLabel: "Timeline — Old X's view", dateLabel: '1. 1. 2026',
        });
        expect(svg).toContain('My Family');
        expect(svg).toContain("Timeline — Old X's view");
        expect(svg).toContain('1. 1. 2026');
    });

    it('gives the nested timeline exactly one width/height (valid XML for <img>)', () => {
        // Regression: the poster embeds buildTimelineSvg (which already emits
        // width/height) as a nested <svg>. Re-adding width/height duplicated the
        // attributes → fatal XML error → the SVG never decoded as an <img>, so
        // every tiled print sheet and the PNG rasterised blank.
        const d = fam();
        const model = computeTimelineModel(d, ids(d), TODAY);
        const svg = buildTimelinePosterSvg(model, { esc }, { treeName: 'F' });
        const nested = svg.match(/<svg class="timeline-svg"[^>]*>/);
        expect(nested).not.toBeNull();
        const tag = nested![0];
        expect((tag.match(/\bwidth=/g) ?? []).length).toBe(1);
        expect((tag.match(/\bheight=/g) ?? []).length).toBe(1);
        // And the nested viewport equals the geometry's inner size (1:1 mapping).
        const g = timelinePosterGeometry(model, true);
        expect(tag).toContain(`width="${g.innerW}"`);
        expect(tag).toContain(`height="${g.innerH}"`);
        expect(tag).toContain(`x="`);
        expect(tag).toContain(`y="`);
    });

    it('applies the caller-escaped, privacy-style names it is given', () => {
        // The poster names come straight from the model rows — feeding a
        // reduced-name person yields a reduced name, and no full name leaks.
        const d = data([person('p', 'A.', 'female', { birthDate: '1990' })]);
        const model = computeTimelineModel(d, ids(d), TODAY);
        const svg = buildTimelinePosterSvg(model, { esc }, {});
        expect(svg).toContain('A.');
    });
});

describe('timelinePosterGeometry (tile skipping)', () => {
    it('reports a wide-and-short poster larger than the bare timeline', () => {
        const d = fam();
        const model = computeTimelineModel(d, ids(d), TODAY);
        const noFooter = timelinePosterGeometry(model, false);
        const withFooter = timelinePosterGeometry(model, true);
        expect(withFooter.height).toBeGreaterThan(noFooter.height);
        expect(withFooter.width).toBe(noFooter.width);
        expect(withFooter.width).toBeGreaterThan(withFooter.innerH); // wide and short
    });

    it('keeps the dense row band and the footer, skips far padding corners', () => {
        const d = fam();
        const model = computeTimelineModel(d, ids(d), TODAY);
        const g = timelinePosterGeometry(model, true);
        // A tile over the middle of the row band has content.
        expect(g.hasContent(g.width / 2 - 20, g.height / 2 - 20, 40, 40)).toBe(true);
        // The footer strip at the bottom-left is content.
        expect(g.hasContent(20, g.height - 10, 30, 8)).toBe(true);
        // The extreme top-right padding corner (outside the band) is empty.
        expect(g.hasContent(g.width - 10, 2, 8, 8)).toBe(false);
    });
});
