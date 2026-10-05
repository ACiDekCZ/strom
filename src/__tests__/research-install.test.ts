/**
 * Installing Strom Research from the app, the pure half: the system, the
 * line with the token, the install record and where it stands. Invented data.
 */

import { describe, it, expect } from 'vitest';
import {
    installTreeName,
    detectInstallOs, installLine, npmLines, legacyInstallLine, legacyNpmLines, installFromValue, INSTALL_LINE_STROM_FROM, installAppUrl, sanitizeInstallRecord, newInstallRecord, installPhase,
    readInstallRecord, writeInstallRecord, clearInstallRecord, INSTALL_KEY, INSTALL_TTL_MS, INSTALL_LONG_MS,
} from '../research-install.js';
import { TreeId } from '../types.js';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd'; // 42 characters

describe('the line\'s one variable, STROM_FROM (research 1.12.1+)', () => {
    const T = 'A'.repeat(43);
    const FILE = `strom-prenos-${T.slice(0, 8)}.json`;
    const BETA = 'https://beta.stromapp.info/run/';
    const LONG = 'Velmi dlouhý název rodiny Víšků z Čáslavi a okolí, Novákovi\'s větev a další příbuzní';
    const value = (line: string): string => line.match(/STROM_FROM[ =]'((?:[^']|'')*)'/)![1].replace(/''/g, "'");

    it('is on, and its value always has six fields: 1|token|browser|file|app|name', () => {
        expect(INSTALL_LINE_STROM_FROM).toBe(true);
        expect(installFromValue(T, null, '')).toBe(`1|${T}||||`);
        expect(installFromValue(T, BETA, 'Víškovi', { browser: 'edge', file: FILE })).toBe(`1|${T}|edge|AAAAAAAA|beta|Víškovi`);
        expect(installFromValue(T, 'http://localhost:8765/run/', '', { browser: 'mobile' })).toBe(`1|${T}|mobile||http://localhost:8765/run/|`);
        // Nothing but the known values goes in.
        expect(installFromValue(T, null, '', { browser: 'evil|x' as never, file: '../x.json' })).toBe(`1|${T}||||`);
    });

    it('Win + R: everything but the name always fits 259; only the name is shortened', () => {
        for (const url of [null, BETA, 'http://localhost:8765/run/']) {
            for (const extra of [{}, { browser: 'edge' as const }, { browser: 'chromium' as const, file: FILE }]) {
                const line = installLine('win', T, url, LONG, extra);
                expect(line.length).toBeLessThanOrEqual(259);
                const v = value(line);
                expect(v.startsWith(`1|${T}|${extra.browser ?? ''}|${'file' in extra ? 'AAAAAAAA' : ''}|${url === BETA ? 'beta' : url ?? ''}|`)).toBe(true);
                // The name: a beginning of it, at least 3 characters here.
                const name = v.split('|').slice(5).join('|');
                expect(name.length).toBeGreaterThanOrEqual(3);
                expect(LONG.startsWith(name)).toBe(true);
            }
        }
        expect(installLine('win', T, null, 'Víškovi', { browser: 'edge' })).toBe(
            `powershell -ExecutionPolicy Bypass -c "si env:STROM_FROM '1|${T}|edge|||Víškovi'; irm https://github.com/ACiDekCZ/strom-research/releases/latest/download/install.ps1 | iex"`);
    });

    it('a name with |, \' and diacritics: | becomes a space, \' is quoted for each shell, letters stay', () => {
        const win = installLine('win', T, null, "Novákovi's | Žďár", {});
        expect(win).toContain("si env:STROM_FROM '1|" + T + "||||Novákovi''s Žďár'; irm");
        expect(win).not.toMatch(/[$`]/);
        expect(value(win)).toBe(`1|${T}||||Novákovi's Žďár`);
        expect(installLine('mac', T, BETA, "Novákovi's", { browser: 'safari', file: FILE }))
            .toBe(`curl -fsSL https://github.com/ACiDekCZ/strom-research/releases/latest/download/install.sh | STROM_FROM='1|${T}|safari|AAAAAAAA|beta|Novákovi'\\''s' sh`);
        expect(npmLines('win', T, null, "O'Brien", { browser: 'edge' })).toEqual(['npm i -g strom-research', `$env:STROM_FROM='1|${T}|edge|||O''Brien'; strom-research`]);
        expect(npmLines('linux', T, BETA)[1]).toBe(`STROM_FROM='1|${T}|||beta|' strom-research`);
    });
});

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
        expect(legacyInstallLine('mac', TOKEN)).toBe(`curl -fsSL https://github.com/ACiDekCZ/strom-research/releases/latest/download/install.sh | STROM_FROM_APP=${TOKEN} sh`);
        expect(legacyInstallLine('linux', TOKEN)).toBe(legacyInstallLine('mac', TOKEN));
        const win = legacyInstallLine('win', TOKEN);
        expect(win).toBe(`powershell -ExecutionPolicy Bypass -c "si env:STROM_FROM_APP '${TOKEN}'; irm https://github.com/ACiDekCZ/strom-research/releases/latest/download/install.ps1 | iex"`);
        expect(win.length).toBeLessThanOrEqual(259);
        // No `$`: pasted into an open PowerShell instead of Win + R, nothing in the "…" is expanded before the inner one runs.
        expect(legacyInstallLine('win', TOKEN, 'https://beta.stromapp.info/run/', "Novákovi's", { browser: 'edge', file: 'strom-prenos-AbCdEfGh.json' })).not.toMatch(/[$`]/);
        expect(legacyNpmLines('mac', TOKEN)).toEqual(['npm i -g strom-research', `STROM_FROM_APP=${TOKEN} strom-research`]);
        expect(legacyNpmLines('win', TOKEN)[1]).toBe(`$env:STROM_FROM_APP='${TOKEN}'; strom-research`);
    });

    it('names this app in the line when it is not the public one (the beta, a copy on this computer)', () => {
        expect(installAppUrl('https://stromapp.info/run/')).toBeNull();
        expect(installAppUrl('https://stromapp.info/run/?research=install#x')).toBeNull();
        expect(installAppUrl('https://beta.stromapp.info/run/')).toBe('https://beta.stromapp.info/run/');
        expect(installAppUrl('http://localhost:8765/strom.html?x=1')).toBe('http://localhost:8765/strom.html');
        expect(installAppUrl('http://127.0.0.1:5173/run/index.html')).toBe('http://127.0.0.1:5173/run/index.html');
        expect(installAppUrl('https://evil.example/run/')).toBeNull();
        expect(installAppUrl('file:///Users/jan/strom.html')).toBeNull();
        expect(installAppUrl('http://localhost:8765/a b.html')).toBeNull();
        const beta = 'https://beta.stromapp.info/run/';
        expect(legacyInstallLine('mac', TOKEN, beta)).toBe(`curl -fsSL https://github.com/ACiDekCZ/strom-research/releases/latest/download/install.sh | STROM_FROM_APP=${TOKEN} STROM_APP_URL=${beta} sh`);
        const win = legacyInstallLine('win', TOKEN, beta);
        expect(win).toBe(`powershell -ExecutionPolicy Bypass -c "si env:STROM_FROM_APP '${TOKEN}'; si env:STROM_APP_URL '${beta}'; irm https://github.com/ACiDekCZ/strom-research/releases/latest/download/install.ps1 | iex"`);
        expect(win.length).toBeLessThanOrEqual(259);
        expect(legacyNpmLines('mac', TOKEN, beta)[1]).toBe(`STROM_FROM_APP=${TOKEN} STROM_APP_URL=${beta} strom-research`);
        expect(legacyNpmLines('win', TOKEN, beta)[1]).toBe(`$env:STROM_FROM_APP='${TOKEN}'; $env:STROM_APP_URL='${beta}'; strom-research`);
    });

    it('names the tree for the research (STROM_FROM_APP_NAME), safe for the shell', () => {
        const T = 'a'.repeat(32);
        expect(legacyInstallLine('mac', T, null, 'Test Win')).toContain(`STROM_FROM_APP=${T} STROM_FROM_APP_NAME='Test Win' sh`);
        expect(legacyInstallLine('win', T, null, "Novákovi's")).toContain("si env:STROM_FROM_APP_NAME 'Novákovi''s'; irm");
        expect(legacyInstallLine('linux', T, null, "Novákovi's")).toContain("STROM_FROM_APP_NAME='Novákovi'\\''s' sh");
        expect(legacyNpmLines('win', T, null, 'Víškovi')[1]).toContain("$env:STROM_FROM_APP_NAME='Víškovi'; strom-research");
        // A name from a foreign file never brings shell syntax along.
        expect(installTreeName('$(rm -rf ~)"`x`; Víškovi')).toBe('(rm -rf ) x Víškovi');
        expect(installTreeName('  a\n\tb  ')).toBe('a b');
        expect(installTreeName('x'.repeat(200))).toHaveLength(80);
        expect(legacyInstallLine('mac', T, null, '')).not.toContain('STROM_FROM_APP_NAME');
        // Win + R: shortened to fit, or left out.
        const long = legacyInstallLine('win', 'a'.repeat(43), 'https://beta.stromapp.info/run/', 'Velmi dlouhý název rodiny Víšků z Čáslavi a okolí');
        expect(long.length).toBeLessThanOrEqual(259);
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
