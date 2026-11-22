/**
 * Siblings shown in place (from childrenShownFull.test.ts, which holds the
 * rest of the harness and its description), every fixture, every mode. A
 * file of its own so the sweep runs beside the others.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { loadFixture } from './helpers/loadFixture.js';
import { runLayoutPipeline } from '../pipeline/index.js';
import { assertNoNodeOverlap, assertValidPositions } from './helpers/assertions.js';
import { auditGeometry } from './helpers/geometryAudit.js';
import { auditBands, syntheticPersonHeights } from './helpers/bandAudit.js';
import { PersonId, LayoutConfig, StromData } from '../../types.js';
import { DEFAULT_LAYOUT_CONFIG } from '../../layout-config.js';
import { normalizeSingleParents } from '../../single-parent.js';
import { hiddenRelativesTabs, hiddenChildIds, newlyShownChildIds, siblingsTabState, newlyShownSiblingIds, unionChildIdSet } from '../../marriage-order.js';
import { DEPTHS, MODES, FIXTURES, layout, plan, foreignBetweenChildren, stemToSpan } from './helpers/childrenShown.js';

/**
 * Siblings shown in place (§1 of the siblings round): the card's "▸ siblings"
 * with a parent in view is one step that shows the children of the parents
 * in view (expandChildrenOf: [father, mother]). For every card the renderer
 * offers it on (siblingsTabState, with the drawn lines of the view), the
 * strict checks hold, every promised sibling is drawn, nothing drawn before
 * leaves, the siblings named after the click are exactly the promised ones,
 * and the tab turns to "▾ siblings".
 */
describe('Siblings shown in place: both parents in one step', () => {
    for (const fixture of FIXTURES) {
        for (const mode of MODES) {
            it(`${fixture} [${mode.name}]`, () => {
                const data = loadFixture(fixture);
                const standIns = (Object.keys(data.persons) as PersonId[]).filter(id => data.persons[id].isPlaceholder);
                normalizeSingleParents(data);
                const before = JSON.stringify(data);
                const ids = (Object.keys(data.persons) as PersonId[]).filter(id => !data.persons[id].isPlaceholder);
                const foci = [...ids, ...standIns.filter(id => data.persons[id])];
                const config: LayoutConfig = mode.heights
                    ? { ...DEFAULT_LAYOUT_CONFIG, spouseLineY: 25, personHeights: syntheticPersonHeights(ids) }
                    : DEFAULT_LAYOUT_CONFIG;
                const unionKids = unionChildIdSet(data);
                const failures: string[] = [];
                let checked = 0;
                for (const depth of DEPTHS) for (const focus of foci) {
                    const base = layout(data, focus, config, depth, mode.autoExpand);
                    const inBase = (id: PersonId) => base.positions.has(id);
                    const drops = new Set(base.connections.flatMap(c => c.drops.map(d => d.personId)));
                    for (const pid of base.positions.keys()) {
                        if (!data.persons[pid]) continue;
                        const tab = siblingsTabState(data, pid, inBase, unionKids, new Set(), new Set(), { hangsOnLine: id => drops.has(id) });
                        if (tab?.kind !== 'siblingsHere') continue;
                        checked++;
                        const parents = tab.parents;
                        const visibleBefore = new Map(parents.map(q => [q, new Set(data.persons[q].childIds.filter(inBase))] as const));
                        const r = plan(data, focus, config, depth, mode.autoExpand, parents).result;
                        const where = `${focus} d${depth} shows the siblings of ${pid} (${parents.join('+')})`;
                        try { assertValidPositions(r.positions); } catch (e) { failures.push(`${where} Positions: ${(e as Error).message.split('\n')[0]}`); }
                        try { assertNoNodeOverlap(r.positions, config.cardWidth, config.cardHeight); } catch (e) { failures.push(`${where} Overlap: ${(e as Error).message.split('\n')[0]}`); }
                        if (!r.diagnostics.validationPassed) for (const err of r.diagnostics.errors.slice(0, 3)) failures.push(`${where} Validation: ${err}`);
                        for (const v of auditGeometry(r, config).slice(0, 3)) failures.push(`${where} Geometry: [${v.type}] ${v.detail}`);
                        if (mode.heights) for (const v of auditBands(r, config).slice(0, 3)) failures.push(`${where} Bands: ${v}`);
                        if (!r.positions.has(pid)) failures.push(`${where}: the person left the view`);
                        for (const q of parents) if (!r.positions.has(q)) failures.push(`${where}: the parent ${q} left the view`);
                        const missing = tab.promised.filter(c => !r.positions.has(c));
                        if (missing.length) failures.push(`${where}: siblings not drawn ${missing.join(',')}`);
                        const inR = (id: PersonId) => r.positions.has(id);
                        const named = newlyShownSiblingIds(data, pid, inR, new Set(parents), q => visibleBefore.get(q));
                        if ([...named].sort().join(',') !== [...tab.promised].sort().join(',')) failures.push(`${where}: shown ${named.join(',')} for promised ${tab.promised.join(',')}`);
                        for (const [q, seen] of visibleBefore) {
                            const lost = [...seen].filter(c => !inR(c));
                            if (lost.length) failures.push(`${where}: children of ${q} left the view ${lost.join(',')}`);
                            const apart = foreignBetweenChildren(data, q, r.positions);
                            if (apart.length) failures.push(`${where}: not beside each other, ${apart.slice(0, 3).join('; ')}`);
                        }
                        // The tab turns to "▾ siblings" (the same rule on the new view)
                        const rDrops = new Set(r.connections.flatMap(c => c.drops.map(d => d.personId)));
                        const after = siblingsTabState(data, pid, inR, unionKids, new Set(parents), new Set(),
                            { visibleBefore: q => visibleBefore.get(q), hangsOnLine: id => rDrops.has(id) });
                        if (after?.kind !== 'siblingsShown') failures.push(`${where}: the tab after the click is ${after?.kind ?? 'none'}`);
                    }
                }
                expect(failures.slice(0, 20), `${fixture} [${mode.name}], ${failures.length} failures of ${checked}`).toEqual([]);
                expect(JSON.stringify(data)).toBe(before);
            }, 600_000);
        }
    }
});
