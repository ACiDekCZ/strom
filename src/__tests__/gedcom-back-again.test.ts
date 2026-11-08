/**
 * Strom's "Back to {program}" file read into Strom again and sent back once
 * more gives the same file (spec 066): import → "Back to" → import of that
 * file → "Back to". The file has the structures MyHeritage Family Tree Builder
 * writes (fictional people, test/fixtures/gedcom/myheritage-ftb.ged).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { applyLivingPrivacy, CONTENT_PRESETS } from '../privacy.js';
import { StromData } from '../types.js';

const FILE = readFileSync(join(process.cwd(), 'test', 'fixtures', 'gedcom', 'myheritage-ftb.ged'), 'utf-8');

const load = (text: string, file: string): StromData =>
    migrateData(convertToStrom(parseGedcom(text), { importOrigin: { at: '2026-11-08', file, encoding: 'utf-8' } }).data);

const backTo = (data: StromData): string =>
    exportToGedcom(applyLivingPrivacy(data, 'full', 2026, { keepDeceasedSources: true }), 'Ozubec',
        { content: CONTENT_PRESETS.back, origins: true, backTo: data.imports![0].id }).content;

/** The file without the date of the export in its header. */
const undated = (ged: string): string => ged.replace(/^(0 HEAD\n(?:[1-9].*\n)*?)1 DATE [^\n]*\n/, '$1');

/** The level-1 blocks of a tag, each as its lines joined. */
function blocks(ged: string, head: RegExp): string[] {
    const out: string[] = [];
    let cur: string[] | null = null;
    for (const line of ged.split('\n')) {
        if (/^[01] /.test(line)) {
            if (cur) out.push(cur.join('\n'));
            cur = head.test(line) ? [line] : null;
        } else if (cur) cur.push(line);
    }
    if (cur) out.push(cur.join('\n'));
    return out;
}

describe('"Back to" read again (066)', () => {
    const first = backTo(load(FILE, 'myheritage-ftb.ged'));
    const again = load(first, 'myheritage-ftb-back.ged');
    const second = backTo(again);

    it('keeps the other program\'s picture links, with _DATE and its own lines', () => {
        const links = blocks(first, /^1 OBJE$/);
        expect(links).toHaveLength(3);
        expect(links.join('\n')).toContain('2 _PHOTO_RIN MH:P1');
        expect(links.join('\n')).toContain('2 _DATE 12 MAY 1905');
        expect(blocks(second, /^1 OBJE$/)).toEqual(links);
        // The file read again is Strom's own: no second import of it.
        expect(again.imports).toHaveLength(1);
    });

    it('the second "Back to" is the first, byte for byte but the export date', () => {
        expect(undated(second)).toBe(undated(first));
    });
});
