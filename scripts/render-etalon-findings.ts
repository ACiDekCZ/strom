/**
 * Render SVGs for representative etalon layout findings into
 * docs/etalon-findings/. One SVG per documented finding in ETALON_FINDINGS.md.
 *
 * Not part of the build/test flow — a documentation helper. Run with:
 *   npx tsx scripts/render-etalon-findings.ts
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { loadFixture } from '../src/layout/__tests__/helpers/loadFixture.js';
import { generateSvg } from '../src/layout/__tests__/helpers/generateSvg.js';
import { runLayoutPipeline } from '../src/layout/pipeline/index.js';
import { PersonId, DEFAULT_LAYOUT_CONFIG } from '../src/types.js';

interface Finding {
    fixture: string;
    focus: string;
    mode: 'standard' | 'expanded';
    out: string;
}

const FINDINGS: Finding[] = [
    { fixture: 'etalon-ancestors-binary5', focus: 'eB_F', mode: 'standard', out: 'B-ancestors-binary5' },
    { fixture: 'etalon-cousin-marriage', focus: 'eH_d2_cc1', mode: 'standard', out: 'H-cousin-2nd-degree' },
    { fixture: 'etalon-double-inlaw', focus: 'eI_bro1', mode: 'standard', out: 'I-double-inlaw' },
    { fixture: 'etalon-inlaw-loop', focus: 'eJ_focus', mode: 'standard', out: 'J-inlaw-loop' },
    { fixture: 'etalon-merged-chain', focus: 'eF_p2', mode: 'expanded', out: 'F-merged-chain' },
    { fixture: 'etalon-inlaw-column', focus: 'eK_focus', mode: 'standard', out: 'K-inlaw-column-known-knot' },
    { fixture: 'etalon-stress-all', focus: 'eNI_k1b', mode: 'standard', out: 'N-stress-bridge' },
];

const outDir = join(process.cwd(), 'docs', 'etalon-findings');

for (const f of FINDINGS) {
    const data = loadFixture(f.fixture);
    const result = runLayoutPipeline({
        data,
        focusPersonId: f.focus as PersonId,
        config: DEFAULT_LAYOUT_CONFIG,
        ancestorDepth: 5,
        descendantDepth: 5,
        includeSpouseAncestors: true,
        includeParentSiblings: true,
        includeParentSiblingDescendants: true,
        displayPolicy: { mode: 'standard', autoExpand: f.mode === 'expanded' },
    });
    const svg = generateSvg(result, data);
    const path = join(outDir, `${f.out}.svg`);
    writeFileSync(path, svg + '\n', 'utf-8');
    console.log(`${f.out}.svg  (${f.fixture} / ${f.focus} / ${f.mode})`);
}
