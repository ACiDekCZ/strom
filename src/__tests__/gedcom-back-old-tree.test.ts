/**
 * "Back to {program}" of a tree loaded by an older build (3.26.0-beta.1) after
 * the same file is merged into it again: the same as a fresh import gives
 * (spec 066). The tree is test/fixtures/gedcom/myheritage-ftb.3.26.0-beta.1.json,
 * made by that build's import of myheritage-ftb.ged (fictional people).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { applyLivingPrivacy, CONTENT_PRESETS } from '../privacy.js';
import { StorageManager } from '../storage.js';
import { createMergeState } from '../merge/matching.js';
import { executeMerge } from '../merge/executor.js';
import { StromData } from '../types.js';

const dir = join(process.cwd(), 'test', 'fixtures', 'gedcom');
const FILE = readFileSync(join(dir, 'myheritage-ftb.ged'), 'utf-8');
const OLD_TREE = readFileSync(join(dir, 'myheritage-ftb.3.26.0-beta.1.json'), 'utf-8');

const load = (text: string, at: string): StromData =>
    migrateData(convertToStrom(parseGedcom(text), { importOrigin: { at, file: 'myheritage-ftb.ged', encoding: 'utf-8' } }).data);

const backTo = (data: StromData): string =>
    exportToGedcom(applyLivingPrivacy(data, 'full', 2026, { keepDeceasedSources: true }), 'Ozubec',
        { content: CONTENT_PRESETS.back, origins: true, backTo: data.imports![0].id }).content;

/**
 * The records of a GEDCOM file without the header, in xref order, without
 * Strom's own import bookkeeping (`_STROM_IMPORT` / `_STROM_XID` blocks: the
 * merge records its second load of the file there).
 */
function records(ged: string): string[] {
    const out: string[] = [];
    let skipBelow = -1;
    for (const line of ged.split(/\r?\n/)) {
        const level = Number(line.split(' ')[0]);
        if (skipBelow >= 0 && level > skipBelow) continue;
        skipBelow = -1;
        if (/^\d+ _STROM_(?:IMPORT|XID)\b/.test(line)) { skipBelow = level; continue; }
        if (level === 0) out.push(line);
        else if (out.length) out[out.length - 1] += '\n' + line;
    }
    return out.filter(r => /^0 @(?!SUBM)/.test(r)).sort();
}

const count = (ged: string, re: RegExp): number => ged.split('\n').filter(l => re.test(l)).length;

describe('Merging the same file into a tree of 3.26.0-beta.1 (066)', () => {
    beforeEach(() => { vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('"Back to" equals the fresh import\'s: no made-up MARR, every _UPD, the families of one parent', async () => {
        const old = migrateData(JSON.parse(OLD_TREE) as StromData);
        const fresh = backTo(load(FILE, '2026-11-08'));
        // What the old build gave: wedding lines the file never wrote, families missing.
        const before = backTo(old);
        expect(count(before, /^1 MARR$/)).toBeGreaterThan(count(fresh, /^1 MARR$/));
        expect(count(before, /^0 @F\d+@ FAM/)).toBeLessThan(count(fresh, /^0 @F\d+@ FAM/));

        const result = await executeMerge(createMergeState(old, load(FILE, '2026-11-09')));
        expect(result.success).toBe(true);
        const merged = backTo(result.mergedData!);
        expect(count(merged, /^1 MARR$/)).toBe(count(fresh, /^1 MARR$/));
        expect(count(merged, /^1 _UPD /)).toBe(count(fresh, /^1 _UPD /));
        expect(merged).toContain('0 @F6@ FAM');
        expect(merged).toMatch(/1 FAMC @F5@\n2 PEDI adopted/);
        expect(records(merged)).toEqual(records(fresh));
    });

    it('the same file merged into a tree of this build changes nothing of "Back to"', async () => {
        const tree = load(FILE, '2026-11-08');
        const fresh = backTo(tree);
        const result = await executeMerge(createMergeState(tree, load(FILE, '2026-11-09')));
        expect(records(backTo(result.mergedData!))).toEqual(records(fresh));
    });
});
