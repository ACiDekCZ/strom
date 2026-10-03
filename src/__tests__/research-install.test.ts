/**
 * Installing Strom Research from the app, the pure half: the system, the
 * line with the token, the install record and where it stands. Invented data.
 */

import { describe, it, expect } from 'vitest';
import {
    detectInstallOs, installLine, npmLines, sanitizeInstallRecord, newInstallRecord, installPhase,
    readInstallRecord, writeInstallRecord, clearInstallRecord, INSTALL_KEY, INSTALL_TTL_MS, INSTALL_LONG_MS,
} from '../research-install.js';
import { TreeId } from '../types.js';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd'; // 42 characters

describe('installing the research from the app', () => {
    it('tells the system from the platform hint, else the User-Agent; unknown is a Mac', () => {
        expect(detectInstallOs('Windows', '')).toBe('win');
        expect(detectInstallOs('macOS', 'Mozilla/5.0 (X11; Linux x86_64)')).toBe('mac');
        expect(detectInstallOs('Linux', '')).toBe('linux');
        expect(detectInstallOs('Chrome OS', '')).toBe('linux');
        expect(detectInstallOs(undefined, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('win');
        expect(detectInstallOs(undefined, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)')).toBe('mac');
        expect(detectInstallOs(undefined, 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)')).toBe('linux');
        expect(detectInstallOs('', 'Darwin something')).toBe('mac');
    });

    it('builds the research\'s lines with the token (Windows fits Win + R)', () => {
        expect(installLine('mac', TOKEN)).toBe(`curl -fsSL https://github.com/ACiDekCZ/strom-research/releases/latest/download/install.sh | STROM_FROM_APP=${TOKEN} sh`);
        expect(installLine('linux', TOKEN)).toBe(installLine('mac', TOKEN));
        const win = installLine('win', TOKEN);
        expect(win).toBe(`powershell -ExecutionPolicy Bypass -c "$env:STROM_FROM_APP='${TOKEN}'; irm https://github.com/ACiDekCZ/strom-research/releases/latest/download/install.ps1 | iex"`);
        expect(win.length).toBeLessThanOrEqual(259);
        expect(npmLines('mac', TOKEN)).toEqual(['npm i -g strom-research', `STROM_FROM_APP=${TOKEN} strom-research`]);
        expect(npmLines('win', TOKEN)[1]).toBe(`$env:STROM_FROM_APP='${TOKEN}'; strom-research`);
    });

    it('keeps the record 24 h: waiting, long after 15 minutes, then expired', () => {
        const now = Date.parse('2026-10-03T10:00:00Z');
        const rec = newInstallRecord(TOKEN, 'tree_1' as TreeId, 'mac', now);
        expect(Date.parse(rec.expiresAt) - Date.parse(rec.createdAt)).toBe(INSTALL_TTL_MS);
        expect(installPhase(null, now)).toBe('none');
        expect(installPhase(rec, now)).toBe('waiting');
        expect(installPhase(rec, now + INSTALL_LONG_MS)).toBe('long');
        expect(installPhase(rec, now + INSTALL_TTL_MS)).toBe('expired');
    });

    it('reads only a record it wrote (a bad token, system or date is none)', () => {
        const rec = newInstallRecord(TOKEN, null, 'win');
        expect(sanitizeInstallRecord(JSON.parse(JSON.stringify(rec)))).toEqual(rec);
        expect(sanitizeInstallRecord({ ...rec, token: 'short' })).toBeNull();
        expect(sanitizeInstallRecord({ ...rec, token: `${TOKEN}<script>` })).toBeNull();
        expect(sanitizeInstallRecord({ ...rec, os: 'amiga' })).toBeNull();
        expect(sanitizeInstallRecord({ ...rec, createdAt: 'yesterday' })).toBeNull();
        expect(sanitizeInstallRecord('x')).toBeNull();

        const store = new Map<string, string>();
        const storage = {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
        };
        writeInstallRecord(rec, storage);
        expect(store.has(INSTALL_KEY)).toBe(true);
        expect(readInstallRecord(storage)).toEqual(rec);
        clearInstallRecord(storage);
        expect(readInstallRecord(storage)).toBeNull();
        store.set(INSTALL_KEY, '{broken');
        expect(readInstallRecord(storage)).toBeNull();
        expect(readInstallRecord(null)).toBeNull();
    });
});
