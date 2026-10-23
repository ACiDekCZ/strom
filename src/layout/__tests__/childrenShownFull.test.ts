/**
 * Children shown in place (PipelineInput.expandChildrenOf, the card's
 * children tab): for every fixture, every person as focus, the standard and
 * expanded modes, cards of one height and of their own heights, every drawn
 * person with a child out of view gets their children shown in place. The
 * strict checks of allPersonsFull.test.ts hold (valid positions, no card
 * overlap, the built-in validation, the geometry audit; bands with own
 * heights), no tolerance widened, and the person's children are drawn.
 *
 * Children the layout cannot draw are the known limits of partner chains
 * that run through several people (a marriage cascade, a remarriage web, a
 * merged chain, the stepfather's other family beside the mother's): the
 * selection holds them, the chain layout leaves them out, as it does
 * whenever those chains meet. KNOWN_UNDRAWN lists them, so a new
 * case fails.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { loadFixture } from './helpers/loadFixture.js';
import { runLayoutPipeline } from '../pipeline/index.js';
import { assertNoNodeOverlap, assertValidPositions } from './helpers/assertions.js';
import { auditGeometry } from './helpers/geometryAudit.js';
import { auditBands, syntheticPersonHeights } from './helpers/bandAudit.js';
import { PersonId, LayoutConfig, DEFAULT_LAYOUT_CONFIG, StromData } from '../../types.js';
import { normalizeSingleParents } from '../../single-parent.js';

const DEPTHS = [2, 4, 8];

const MODES = [
    { name: 'standard', heights: false, autoExpand: false },
    { name: 'expanded', heights: false, autoExpand: true },
    { name: 'standard-v3', heights: true, autoExpand: false },
    { name: 'expanded-v3', heights: true, autoExpand: true },
];

/** `fixture focus mode(expanded|standard) shown-person: undrawn children` */
const KNOWN_UNDRAWN = new Set([
    'edge-marriage-cascade b expanded d: k_de',
    'edge-marriage-cascade c expanded d: k_de',
    'edge-marriage-cascade d expanded c: k_bc',
    'edge-marriage-cascade e expanded c: k_bc',
    'edge-marriage-cascade k_bc expanded d: k_de',
    'edge-marriage-cascade k_cd expanded b: k_ab',
    'edge-marriage-cascade k_de expanded c: k_bc',
    'edge-remarriage-web adam expanded bea: k_cb1,k_eb1',
    'edge-remarriage-web bea expanded adam: k_ad1',
    'edge-remarriage-web cyril expanded adam: k_ad1',
    'edge-remarriage-web dana expanded bea: k_cb1,k_eb1',
    'edge-remarriage-web emil expanded adam: k_ad1',
    'edge-remarriage-web k_ad1 expanded bea: k_cb1,k_eb1',
    'edge-remarriage-web k_cb1 expanded adam: k_ad1',
    'edge-remarriage-web k_eb1 expanded adam: k_ad1',
    'etalon-ancestor-chain eG_half_mat expanded eG_father: eG_half_pat',
    'etalon-merged-chain eF_p2 expanded eF_p4: eF_k3',
    'etalon-merged-chain eF_p4 expanded eF_p2: eF_k0',
    'etalon-merged-chain eF_k2 expanded eF_p2: eF_k0',
    'etalon-merged-chain eF_k3 expanded eF_p3: eF_k1',
]);

const FIXTURES = readdirSync(join(process.cwd(), 'test'))
    .filter(n => /^(comprehensive|edge-.*|etalon-.*|real-large)\.json$/.test(n))
    .map(n => n.replace(/\.json$/, ''))
    .filter(f => existsSync(join(process.cwd(), 'test', `${f}.json`)))
    .sort();

function layout(data: StromData, focus: PersonId, config: LayoutConfig, depth: number, autoExpand: boolean, shown: PersonId[] = []) {
    return runLayoutPipeline({
        data, focusPersonId: focus, config, ancestorDepth: depth, descendantDepth: depth,
        includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy: { mode: autoExpand ? 'expanded' : 'standard', autoExpand },
        ...(shown.length ? { expandChildrenOf: shown } : {}),
    });
}

describe('Children shown in place: full pipeline invariants', () => {
    for (const fixture of FIXTURES) {
        for (const mode of MODES) {
            it(`${fixture} [${mode.name}]`, () => {
                const data = loadFixture(fixture);
                normalizeSingleParents(data);
                const before = JSON.stringify(data);
                const ids = (Object.keys(data.persons) as PersonId[]).filter(id => !data.persons[id].isPlaceholder);
                const config: LayoutConfig = mode.heights
                    ? { ...DEFAULT_LAYOUT_CONFIG, spouseLineY: 25, personHeights: syntheticPersonHeights(ids) }
                    : DEFAULT_LAYOUT_CONFIG;
                const failures: string[] = [];
                const undrawn = new Set<string>();
                for (const depth of DEPTHS) for (const focus of ids) {
                    const base = layout(data, focus, config, depth, mode.autoExpand);
                    for (const pid of base.positions.keys()) {
                        const person = data.persons[pid];
                        if (!person || person.isPlaceholder) continue;
                        const kids = person.childIds.filter(c => data.persons[c] && !data.persons[c].isPlaceholder);
                        if (!kids.some(c => !base.positions.has(c))) continue;
                        const r = layout(data, focus, config, depth, mode.autoExpand, [pid]);
                        const where = `${focus} d${depth} shows ${pid}`;
                        try { assertValidPositions(r.positions); } catch (e) { failures.push(`${where} Positions: ${(e as Error).message.split('\n')[0]}`); }
                        try { assertNoNodeOverlap(r.positions, config.cardWidth, config.cardHeight); } catch (e) { failures.push(`${where} Overlap: ${(e as Error).message.split('\n')[0]}`); }
                        if (!r.diagnostics.validationPassed) for (const err of r.diagnostics.errors.slice(0, 3)) failures.push(`${where} Validation: ${err}`);
                        for (const v of auditGeometry(r, config).slice(0, 3)) failures.push(`${where} Geometry: [${v.type}] ${v.detail}`);
                        if (mode.heights) for (const v of auditBands(r, config).slice(0, 3)) failures.push(`${where} Bands: ${v}`);
                        // The person stays drawn; their children are drawn
                        if (!r.positions.has(pid)) failures.push(`${where}: the person left the view`);
                        const missing = kids.filter(c => !r.positions.has(c));
                        if (missing.length) {
                            const key = `${fixture} ${focus} ${mode.autoExpand ? 'expanded' : 'standard'} ${pid}: ${missing.join(',')}`;
                            if (KNOWN_UNDRAWN.has(key)) undrawn.add(key);
                            else failures.push(`${where}: children not drawn ${missing.join(',')}`);
                        }
                    }
                }
                expect(failures.slice(0, 20), `${fixture} [${mode.name}], ${failures.length} failures`).toEqual([]);
                // Showing children never changes the tree's data
                expect(JSON.stringify(data)).toBe(before);
            }, 600_000);
        }
    }
});

describe('Children shown in place: selection and hiding again', () => {
    const data = loadFixture('comprehensive');
    const P = (id: string) => id as PersonId;

    it('a grandfather shows his children (the father\'s siblings) and hides them again to the same layout', () => {
        // Focus a grandchild: the grandparents' other children stand two rows up
        const focus = P('grandchild_1');
        const base = layout(data, focus, DEFAULT_LAYOUT_CONFIG, 6, true);
        const gf = P('gp_h_h');
        const hidden = data.persons[gf].childIds.filter(c => !base.positions.has(c));
        expect(hidden.length).toBeGreaterThan(0);
        const shown = layout(data, focus, DEFAULT_LAYOUT_CONFIG, 6, true, [gf]);
        for (const c of data.persons[gf].childIds) expect(shown.positions.has(c), c).toBe(true);
        // The children's own partners and descendants stay out
        for (const c of hidden) {
            for (const gc of data.persons[c].childIds) if (!base.positions.has(gc)) expect(shown.positions.has(gc), gc).toBe(false);
        }
        expect(auditGeometry(shown, DEFAULT_LAYOUT_CONFIG)).toEqual([]);
        // Hiding: the same input as before, the same layout
        const again = layout(data, focus, DEFAULT_LAYOUT_CONFIG, 6, true, []);
        expect(JSON.stringify([...again.positions])).toBe(JSON.stringify([...base.positions]));
    });

    it('a father with two families in the standard mode shows the children of both, each under its own union', () => {
        const focus = P('focus');
        const base = layout(data, focus, DEFAULT_LAYOUT_CONFIG, 6, false);
        expect(base.positions.has(P('halfsibling_1'))).toBe(false);
        const shown = layout(data, focus, DEFAULT_LAYOUT_CONFIG, 6, false, [P('father')]);
        expect(shown.positions.has(P('halfsibling_1'))).toBe(true);
        expect(shown.positions.has(P('stepmother'))).toBe(true);
        // The half-sibling hangs on the father's union with the stepmother
        const conn = shown.connections.find(c => c.drops.some(d => d.personId === P('halfsibling_1')));
        expect(conn).toBeDefined();
        const union = Object.values(data.partnerships).find(u => u.childIds.includes(P('halfsibling_1')))!;
        expect([union.person1Id, union.person2Id].sort()).toEqual([P('father'), P('stepmother')].sort());
        expect(auditGeometry(shown, DEFAULT_LAYOUT_CONFIG)).toEqual([]);
    });

    it('a person out of the view is skipped', () => {
        const focus = P('focus');
        const base = layout(data, focus, DEFAULT_LAYOUT_CONFIG, 1, true);
        const far = (Object.keys(data.persons) as PersonId[]).find(id => !base.positions.has(id) && data.persons[id].childIds.length > 0)!;
        const shown = layout(data, focus, DEFAULT_LAYOUT_CONFIG, 1, true, [far]);
        expect(JSON.stringify([...shown.positions])).toBe(JSON.stringify([...base.positions]));
    });
});
