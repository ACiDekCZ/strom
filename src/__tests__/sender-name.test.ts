/**
 * The remembered sender name: a fallback placeholder that older builds
 * stored as if typed ("Příbuzný", "A relative", "Ein Verwandter",
 * "Ein Familienmitglied") reads as no name, so the share dialog leaves the
 * field empty and the file names "someone from the family". A real name
 * stays as typed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SettingsManager } from '../settings.js';

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

describe('remembered sender name', () => {
    beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
    afterEach(() => {
        SettingsManager.setSenderName('');
        vi.unstubAllGlobals();
    });

    it.each(['Příbuzný', 'A relative', 'Ein Verwandter', 'Ein Familienmitglied'])(
        'former placeholder %s reads as empty', (placeholder) => {
            SettingsManager.setSenderName(placeholder);
            expect(SettingsManager.getSenderName()).toBe('');
        });

    it('a typed name is kept', () => {
        SettingsManager.setSenderName('  Jana Nováková ');
        expect(SettingsManager.getSenderName()).toBe('Jana Nováková');
    });
});
