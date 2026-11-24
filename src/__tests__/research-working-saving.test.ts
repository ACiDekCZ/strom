/**
 * The agent's own browser saves a book's images (`working[].saving`): read only with the feature
 * `working.saving`, a book's id and two whole counts with `saved` not above `of`, anything else dropped;
 * the row's words "agent saving images (k of n)" in four languages. Invented data.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { setLanguage, strings, type Language } from '../strings.js';
import { sanitizeSaving, sanitizeWorking, sanitizeLiveStatus, WORKING_SAVING_FEATURE } from '../research-link.js';

const UUID = '7d5e2a4c-1b3f-4e6a-9c8d-0f1e2d3c4b5a';
const ROW = { who: 'agent', task: 'Matrika Nové Hradiště 1784–1830', session: 'N0141' };

describe('working[].saving', () => {
    it('valid: a book and two whole counts, saved up to of (of may grow from 0)', () => {
        expect(sanitizeSaving({ recordset: 'B0007', saved: 3, of: 5 })).toEqual({ recordset: 'B0007', saved: 3, of: 5 });
        expect(sanitizeSaving({ recordset: 'B0007', saved: 0, of: 1 })).toEqual({ recordset: 'B0007', saved: 0, of: 1 });
        expect(sanitizeSaving({ recordset: 'B0007', saved: 2, of: 2 })).toEqual({ recordset: 'B0007', saved: 2, of: 2 });
        expect(sanitizeSaving({ recordset: 'B0007', saved: 0, of: 0 })).toEqual({ recordset: 'B0007', saved: 0, of: 0 });
    });

    it('invalid: dropped whole', () => {
        for (const bad of [
            null, 'B0007', [], { saved: 1, of: 2 },
            { recordset: 'T0007', saved: 1, of: 2 }, { recordset: 7, saved: 1, of: 2 }, { recordset: '', saved: 1, of: 2 },
            { recordset: 'B0007', saved: -1, of: 2 }, { recordset: 'B0007', saved: 1.5, of: 2 }, { recordset: 'B0007', saved: '1', of: 2 },
            { recordset: 'B0007', saved: 1 }, { recordset: 'B0007', saved: 1, of: NaN }, { recordset: 'B0007', saved: 1, of: Infinity },
        ]) expect(sanitizeSaving(bad), JSON.stringify(bad)).toBeNull();
    });

    it('saved above of: dropped', () => {
        expect(sanitizeSaving({ recordset: 'B0007', saved: 6, of: 5 })).toBeNull();
        const [w] = sanitizeWorking([{ ...ROW, saving: { recordset: 'B0007', saved: 6, of: 5 } }], false, undefined, true);
        expect(w).not.toHaveProperty('saving');
        expect(w.task).toBe(ROW.task);
    });

    it('read with the feature only; without it (or without the field) the row as before', () => {
        const rows = [{ ...ROW, saving: { recordset: 'B0007', saved: 3, of: 5 } }, ROW];
        const [a, b] = sanitizeWorking(rows, false, undefined, true);
        expect(a.saving).toEqual({ recordset: 'B0007', saved: 3, of: 5 });
        expect(b).not.toHaveProperty('saving');
        for (const w of sanitizeWorking(rows)) expect(w).not.toHaveProperty('saving');
        const old = sanitizeLiveStatus({ tree: { id: UUID, name: 'T' }, working: rows, features: ['working.helps'] })!;
        expect(old.working[0]).not.toHaveProperty('saving');
        const now = sanitizeLiveStatus({ tree: { id: UUID, name: 'T' }, working: rows, features: [WORKING_SAVING_FEATURE] })!;
        expect(now.working[0].saving).toEqual({ recordset: 'B0007', saved: 3, of: 5 });
        expect(now.working[1]).not.toHaveProperty('saving');
    });
});

describe('the row\'s words, in four languages', () => {
    afterEach(() => setLanguage('en'));
    const cases: Array<[Language, string]> = [
        ['en', 'agent saving images (3 of 5)'],
        ['cs', 'agent ukládá snímky (3 z 5)'],
        ['de', 'Agent speichert Aufnahmen (3 von 5)'],
        ['pl', 'agent zapisuje skany (3 z 5)'],
    ];
    for (const [lang, text] of cases) {
        it(lang, () => {
            setLanguage(lang);
            expect(strings.live.workingSaving(3, 5)).toBe(text);
        });
    }
});
