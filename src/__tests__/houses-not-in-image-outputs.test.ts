/**
 * Spec 030 §12/§13 "no": the gift tree and the image export (the poster)
 * never show houses — their sources neither collect the tree's houses nor
 * ask the Timeline for them. Static: the privacy layer's protectHouses calls
 * collectHouses inside every output, so a runtime spy cannot tell them apart.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (file: string): string => readFileSync(join(__dirname, '..', file), 'utf8');

describe('no houses in the gift tree and the image export', () => {
    it.each(['gift-tree.ts', 'export-image.ts', 'ui/export-image-ui.ts'])('%s collects no houses', file => {
        const code = src(file);
        expect(code).not.toMatch(/\bcollectHouses\b|\btreeHouseIndex\b|\bhouseOutputs\b|\bprotectedHouse(?:Outputs|Index)\b/);
        expect(code).not.toMatch(/from '\.{1,2}\/(?:house-events|person-houses)\.js'/);
    });

    it('the poster asks the Timeline for no houses', () => {
        const code = src('ui/export-image-ui.ts');
        expect(code).toContain('computeTimelineModel(');
        expect(code).not.toMatch(/houses:\s*true/);
    });
});
