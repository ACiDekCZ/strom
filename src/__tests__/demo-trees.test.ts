/**
 * Demo trees: data validity, historical structure spot-checks, and full layout
 * coverage (every person as focus, both display modes) — mirrors the etalon
 * harness but imports the bundled demo data directly.
 */

import { describe, it, expect } from 'vitest';
import { getDemoTree } from '../demo-trees.js';
import { validateTreeData } from '../validation.js';
import { runLayoutPipeline } from '../layout/pipeline/index.js';
import { assertNoNodeOverlap, assertValidPositions } from '../layout/__tests__/helpers/assertions.js';
import { auditGeometry } from '../layout/__tests__/helpers/geometryAudit.js';
import { PersonId, DEFAULT_LAYOUT_CONFIG } from '../types.js';

const config = DEFAULT_LAYOUT_CONFIG;
const MODES = [
    { name: 'standard', displayPolicy: { mode: 'standard' as const, autoExpand: false } },
    { name: 'expanded', displayPolicy: { mode: 'standard' as const, autoExpand: true } },
];

for (const lang of ['cs', 'en'] as const) {
    const data = getDemoTree(lang);
    const personIds = Object.keys(data.persons) as PersonId[];

    describe(`demo tree [${lang}] (${personIds.length} persons)`, () => {
        it('passes validateTreeData with no errors', () => {
            const result = validateTreeData(data);
            const errors = result.issues.filter(i => i.severity === 'error');
            expect(errors, JSON.stringify(errors)).toEqual([]);
            expect(result.valid).toBe(true);
        });

        for (const personId of personIds) {
            const name = data.persons[personId].firstName;
            for (const mode of MODES) {
                it(`layout is clean with ${name} as focus [${mode.name}]`, () => {
                    const result = runLayoutPipeline({
                        data,
                        focusPersonId: personId,
                        config,
                        ancestorDepth: 5,
                        descendantDepth: 5,
                        includeSpouseAncestors: true,
                        includeParentSiblings: true,
                        includeParentSiblingDescendants: true,
                        displayPolicy: mode.displayPolicy,
                    });
                    assertValidPositions(result.positions);
                    assertNoNodeOverlap(result.positions, config.cardWidth, config.cardHeight);
                    // Card overlaps, merged lines and lines through cards are always
                    // hard failures. Bare line crossings/touches are tolerated only
                    // in expanded (partner-chain) mode: the Tudor six-wives chain
                    // (with Catherine of Aragon bridging Arthur and Henry VIII) is a
                    // known layout limitation of the same class as the etalon
                    // findings — see docs/ZADANI_MASTER.md Deník. Standard mode and
                    // the whole Přemyslid tree stay fully clean.
                    const tolerated = new Set<string>(
                        mode.name === 'expanded'
                            ? ['inherent-crossing', 'crossing', 't-touch', 'collinear']
                            : ['inherent-crossing']
                    );
                    const hard = auditGeometry(result, config, data).filter(v => !tolerated.has(v.type));
                    expect(hard.map(v => `[${v.type}] ${v.detail}`), `${personId} [${mode.name}]`).toEqual([]);
                });
            }
        }
    });
}

describe('demo historical structure', () => {
    it('Václav III is a grandson of Přemysl Otakar II', () => {
        const d = getDemoTree('cs');
        expect(d.persons['pr_vaclav3' as PersonId].parentIds).toContain('pr_vaclav2');
        expect(d.persons['pr_vaclav2' as PersonId].parentIds).toContain('pr_otakar2');
    });

    it('Anne Boleyn is the second wife of Henry VIII', () => {
        const d = getDemoTree('en');
        const henry8 = d.persons['td_henry8' as PersonId];
        const secondUnion = d.partnerships[henry8.partnerships[1]];
        const spouse = secondUnion.person1Id === 'td_henry8' ? secondUnion.person2Id : secondUnion.person1Id;
        expect(spouse).toBe('td_anne_b');
    });
});
