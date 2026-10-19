/**
 * A source written from a research's reading ("Read a document"): its marks
 * (`_STROM_READING`, `_STROM_ENTRY`, `_STROM_SHA`) go out in GEDCOM, come
 * back on import, and reach a research only when it says it takes them
 * (`read.sync`). The sync's answer about them (`readings`) is checked.
 */

import { describe, it, expect } from 'vitest';
import { Source, StromData, STROM_DATA_VERSION } from '../types.js';
import { exportToGedcom } from '../ged-exporter.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { researchSendsReadings, sanitizeSyncReply } from '../research-link.js';

const READ = 'D20261019153012-a1b2';
const SHA = 'a'.repeat(64);
const PNG_1PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

function data(extra: Partial<Source>): StromData {
    return {
        version: STROM_DATA_VERSION, persons: {}, partnerships: {},
        sources: { s1: { id: 's1', title: 'Křest, Lhota 1846', transcript: 'Joannes filius legitimus\nAntonii Novák, Lhota', ...extra } },
    } as unknown as StromData;
}

function back(ged: string): Source {
    return Object.values(convertToStrom(parseGedcom(ged)).data.sources ?? {})[0];
}

describe('GEDCOM: a source from a reading', () => {
    it('the reading, its entry and the page go out and come back', () => {
        const ged = exportToGedcom(data({ reading: READ, readingEntry: 'e1', readingSha: SHA }), 'T').content;
        expect(ged).toMatch(new RegExp(`1 _STROM_READING ${READ}\\r?\\n2 _STROM_ENTRY e1\\r?\\n1 _STROM_SHA ${SHA}`));
        const src = back(ged);
        expect(src.reading).toBe(READ);
        expect(src.readingEntry).toBe('e1');
        expect(src.readingSha).toBe(SHA);
        // The transcription unchanged (its lines kept).
        expect(src.transcript).toBe('Joannes filius legitimus\nAntonii Novák, Lhota');
    });

    it('an excerpt naming the page: no second _STROM_SHA on the record', () => {
        const ged = exportToGedcom(data({
            reading: READ, readingEntry: 'e1', readingSha: SHA,
            excerpts: [{ id: 'x1', dataUrl: PNG_1PX, width: 1, height: 1, sizeBytes: 100, originalSha: SHA }],
        }), 'T').content;
        expect(ged).not.toMatch(/^1 _STROM_SHA/m);
        expect(ged).toMatch(new RegExp(`^2 _STROM_SHA ${SHA}`, 'm'));
        const src = back(ged);
        expect(src.reading).toBe(READ);
        expect(src.excerpts?.[0].originalSha).toBe(SHA);
    });

    it('left out when the research does not take readings', () => {
        const ged = exportToGedcom(data({ reading: READ, readingEntry: 'e1', readingSha: SHA }), 'T', { readings: false }).content;
        expect(ged).not.toContain('_STROM_READING');
        expect(ged).not.toContain('_STROM_ENTRY');
        expect(ged).not.toMatch(/^1 _STROM_SHA/m);
        expect(back(ged).reading).toBeUndefined();
    });

    it('a malformed id is neither written nor read', () => {
        const ged = exportToGedcom(data({ reading: 'D123', readingEntry: 'e1' }), 'T').content;
        expect(ged).not.toContain('_STROM_READING');
        const forged = '0 HEAD\n1 CHAR UTF-8\n0 @S1@ SOUR\n1 TITL X\n1 _STROM_READING ../etc\n2 _STROM_ENTRY e1\n0 TRLR\n';
        const src = back(forged);
        expect(src.reading).toBeUndefined();
        expect(src.readingEntry).toBeUndefined();
    });

    it('the gate: only a research with read.sync', () => {
        expect(researchSendsReadings({ features: ['read.now', 'read.sync'] })).toBe(true);
        expect(researchSendsReadings({ features: ['read.now'] })).toBe(false);
        expect(researchSendsReadings({ features: null })).toBe(false);
        expect(researchSendsReadings(null)).toBe(false);
    });
});

describe('the sync answer: readings', () => {
    it('kept, checked, codes as said', () => {
        const r = sanitizeSyncReply({
            ok: true, changes: 3,
            readings: [
                { source: '@X9@', read: READ, ok: true, entry: 'e1' },
                { source: '@X10@', read: READ, ok: true, entry: 'e2', edited: true },
                { source: '@X11@', read: READ, ok: false, code: 'reading.sha' },
                { source: '<script>', read: 'nope', ok: false },
                'junk',
            ],
        });
        expect(r.readings).toEqual([
            { source: '@X9@', read: READ, ok: true, entry: 'e1', edited: false, code: '' },
            { source: '@X10@', read: READ, ok: true, entry: 'e2', edited: true, code: '' },
            { source: '@X11@', read: READ, ok: false, entry: '', edited: false, code: 'reading.sha' },
        ]);
        expect(sanitizeSyncReply(null).readings).toEqual([]);
        expect(sanitizeSyncReply({ ok: true }).readings).toEqual([]);
    });
});
