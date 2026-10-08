/**
 * The "Export all" reminder in the menus: only while not backed up (never,
 * or 21 days since the last export of all trees), at most once a day (the
 * first menu opening of a day shows it), and a click rests it for 21 days.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { exportReminderDue, noteExportReminderShown, noteExportAll, EXPORT_REMINDER_MS } from '../research-device.js';

function memoryStorage(): Storage {
    const store = new Map<string, string>();
    return {
        get length() { return store.size; },
        clear: () => store.clear(),
        getItem: (k: string) => store.get(k) ?? null,
        key: (i: number) => [...store.keys()][i] ?? null,
        removeItem: (k: string) => { store.delete(k); },
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
    };
}

const DAY = 24 * 60 * 60 * 1000;
/** 8 Oct 2026, 09:00 local time. */
const MORNING = new Date(2026, 9, 8, 9, 0).getTime();

describe('the export reminder', () => {
    beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
    afterEach(() => vi.unstubAllGlobals());

    it('never exported: due, then not again the same day, again the next day', () => {
        expect(exportReminderDue(MORNING)).toBe(true);
        noteExportReminderShown(false, MORNING);
        expect(exportReminderDue(MORNING + 60_000)).toBe(false);
        expect(exportReminderDue(new Date(2026, 9, 8, 23, 59).getTime())).toBe(false);
        expect(exportReminderDue(new Date(2026, 9, 9, 0, 1).getTime())).toBe(true);
    });

    it('not limited to three showings: shown on every day while not backed up', () => {
        for (let d = 0; d < 10; d++) {
            const at = MORNING + d * DAY;
            expect(exportReminderDue(at)).toBe(true);
            noteExportReminderShown(false, at);
            expect(exportReminderDue(at + 3_600_000)).toBe(false);
        }
    });

    it('backed up within 21 days: not due', () => {
        noteExportAll(MORNING);
        expect(exportReminderDue(MORNING + 20 * DAY)).toBe(false);
        expect(exportReminderDue(MORNING + EXPORT_REMINDER_MS)).toBe(true);
    });

    it('a click rests it for 21 days', () => {
        noteExportReminderShown(true, MORNING);
        expect(exportReminderDue(MORNING + DAY)).toBe(false);
        expect(exportReminderDue(MORNING + 20 * DAY)).toBe(false);
        expect(exportReminderDue(MORNING + EXPORT_REMINDER_MS + DAY)).toBe(true);
    });
});
