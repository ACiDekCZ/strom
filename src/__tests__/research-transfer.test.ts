/**
 * Moving a tree to the browser the research opens, the pure half: which
 * browser the app runs in, what the line and the link tell the research, the
 * transfer file. Invented data.
 */

import { describe, it, expect } from 'vitest';
import {
    detectAppBrowser, needsTransfer, appBrowserName, transferFileName, isTransferFileName,
    buildTransferJson, readTransferJson, TRANSFER_KEY,
} from '../research-transfer.js';
import { legacyInstallLine, legacyNpmLines, sanitizeInstallRecord, newInstallRecord } from '../research-install.js';
import { researchNewUrl, sanitizeAdoptOffer } from '../research-link.js';
import { STROM_DATA_VERSION, StromData, PersonId } from '../types.js';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
const BETA = 'https://beta.stromapp.info/run/';
const UA = {
    chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
    opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/124.0.0.0',
    firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
    safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
};

describe('the browser the app runs in', () => {
    it('tells Chrome, Edge, Opera, Brave, Firefox, Safari and other Chromium browsers apart', () => {
        expect(detectAppBrowser(UA.chrome, ['Chromium', 'Google Chrome', 'Not.A/Brand'])).toBe('chrome');
        expect(detectAppBrowser(UA.chrome, undefined)).toBe('chrome');
        expect(detectAppBrowser(UA.edge, ['Chromium', 'Microsoft Edge'])).toBe('edge');
        expect(detectAppBrowser(UA.edge, undefined)).toBe('edge');
        expect(detectAppBrowser(UA.opera, ['Chromium', 'Opera'])).toBe('opera');
        expect(detectAppBrowser(UA.chrome, ['Chromium', 'Brave'], true)).toBe('brave');
        expect(detectAppBrowser(UA.firefox, undefined)).toBe('firefox');
        expect(detectAppBrowser(UA.safari, undefined)).toBe('safari');
        // Vivaldi, Arc: Chromium without a brand of their own.
        expect(detectAppBrowser(UA.chrome, ['Chromium', 'Not_A Brand'])).toBe('chromium');
        expect(detectAppBrowser('Lynx/2.9', undefined)).toBe('other');
    });

    it('moves the tree by a file from every browser that does not reach the research; names browsers in a sentence', () => {
        // Safari, anything unknown, a phone; Firefox reaches it (proven by the research 1.12.1).
        for (const b of ['safari', 'other', 'mobile'] as const) expect(needsTransfer(b)).toBe(true);
        for (const b of ['chrome', 'edge', 'brave', 'opera', 'chromium', 'firefox'] as const) expect(needsTransfer(b)).toBe(false);
        expect(appBrowserName('edge')).toBe('Edge');
        expect(appBrowserName('other')).toBe('');
        expect(appBrowserName('mobile')).toBe('');
    });

    it('takes WebKit browsers that are not Safari (Orion, DuckDuckGo) for Safari: they move the tree too', () => {
        const orion = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 Orion/0.99';
        const ddg = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 Ddg/18.0';
        expect(detectAppBrowser(orion, undefined)).toBe('safari');
        expect(detectAppBrowser(ddg, undefined)).toBe('safari');
        expect(needsTransfer(detectAppBrowser(ddg, undefined))).toBe(true);
        // A Chromium whose brands name neither Chromium nor Chrome: unknown, so it moves the tree.
        expect(needsTransfer(detectAppBrowser(UA.chrome, ['Some Browser']))).toBe(true);
    });
});

describe('what the line and the link tell the research', () => {
    it('names the browser (STROM_FROM_BROWSER) and the file (STROM_FROM_FILE) in every line', () => {
        const file = transferFileName(TOKEN);
        expect(file).toBe('strom-prenos-AbCdEfGh.json');
        expect(legacyInstallLine('mac', TOKEN, null, '', { browser: 'safari', file }))
            .toBe(`curl -fsSL https://github.com/ACiDekCZ/strom-research/releases/latest/download/install.sh | STROM_FROM_APP=${TOKEN} STROM_FROM_BROWSER=safari STROM_FROM_FILE=${file} sh`);
        expect(legacyInstallLine('linux', TOKEN, null, 'Víškovi', { browser: 'firefox' }))
            .toContain(`STROM_FROM_APP_NAME='Víškovi' STROM_FROM_BROWSER=firefox sh`);
        expect(legacyInstallLine('win', TOKEN, null, '', { browser: 'edge' }))
            .toContain(`si env:STROM_FROM_APP '${TOKEN}'; si env:STROM_FROM_BROWSER 'edge'; irm`);
        expect(legacyNpmLines('mac', TOKEN, BETA, '', { browser: 'chrome' })[1]).toBe(`STROM_FROM_APP=${TOKEN} STROM_FROM_BROWSER=chrome STROM_APP_URL=${BETA} strom-research`);
        expect(legacyNpmLines('win', TOKEN, null, '', { browser: 'edge' })[1]).toBe(`$env:STROM_FROM_APP='${TOKEN}'; $env:STROM_FROM_BROWSER='edge'; strom-research`);
        // Nothing but the known values goes into a shell line.
        expect(legacyInstallLine('mac', TOKEN, null, '', { browser: 'evil;rm' as never, file: '../x.json' })).not.toMatch(/STROM_FROM_(BROWSER|FILE)/);
    });

    it('fits Win + R: the name shortened first, then the browser left out (the beta line)', () => {
        const name = 'Velmi dlouhý název rodiny Víšků z Čáslavi a okolí';
        const prod = legacyInstallLine('win', TOKEN, null, name, { browser: 'firefox' });
        expect(prod.length).toBeLessThanOrEqual(259);
        expect(prod).toContain("si env:STROM_FROM_BROWSER 'firefox'; ");
        const beta = legacyInstallLine('win', TOKEN, BETA, name, { browser: 'firefox' });
        expect(beta.length).toBeLessThanOrEqual(259);
        expect(beta).not.toContain('STROM_FROM_APP_NAME');
        expect(beta).not.toContain('STROM_FROM_BROWSER');
    });

    it('fits Win + R with a real token and a file: on another copy the address goes, the file carries it (TransferMark.app)', () => {
        const token = 'A'.repeat(43);
        const file = transferFileName(token);
        const beta = legacyInstallLine('win', token, BETA, 'Moje rodina', { browser: 'mobile', file });
        expect(beta.length).toBeLessThanOrEqual(259);
        expect(beta).toContain(`si env:STROM_FROM_FILE '${file}'; `);
        expect(beta).not.toContain('STROM_APP_URL');
        // Without a file the address stays (nothing else would carry it), and on the public app nothing changes.
        expect(legacyInstallLine('win', token, BETA, 'Moje rodina', { browser: 'edge' })).toContain(`si env:STROM_APP_URL '${BETA}'; `);
        expect(legacyInstallLine('win', token, null, '', { browser: 'mobile', file })).toContain(`si env:STROM_FROM_FILE '${file}'; `);
        // Terminal lines have no limit: everything stays.
        expect(legacyInstallLine('mac', token, BETA, 'Moje rodina', { browser: 'mobile', file })).toContain(`STROM_APP_URL=${BETA} `);
    });

    it('carries the browser and the file on strom-research://new', () => {
        expect(researchNewUrl(TOKEN, 'edge')).toBe(`strom-research://new?app=${TOKEN}&browser=edge`);
        expect(researchNewUrl(TOKEN, 'safari', 'strom-prenos-AbCdEfGh.json')).toBe(`strom-research://new?app=${TOKEN}&browser=safari&file=strom-prenos-AbCdEfGh.json`);
        expect(researchNewUrl(TOKEN, 'Ev&il', '../x.json')).toBe(`strom-research://new?app=${TOKEN}`);
    });

    it('keeps the downloaded file in the install record; reads the research\'s transfer and until', () => {
        const rec = { ...newInstallRecord(TOKEN, null, 'mac'), file: 'strom-prenos-AbCdEfGh.json' };
        expect(sanitizeInstallRecord(rec)?.file).toBe('strom-prenos-AbCdEfGh.json');
        expect(sanitizeInstallRecord({ ...rec, file: '/etc/passwd' })?.file).toBeUndefined();
        expect(isTransferFileName('strom-prenos-AbCdEfGh.json')).toBe(true);
        expect(isTransferFileName('strom-prenos-AbCdEfGh.json; x')).toBe(false);
        const offer = sanitizeAdoptOffer({ token: TOKEN, name: 'Novákovi', transfer: true, until: '2026-10-05T19:00:00.000Z' });
        expect(offer).toMatchObject({ transfer: true, until: '2026-10-05T19:00:00.000Z' });
        expect(sanitizeAdoptOffer({ token: TOKEN, transfer: 'yes', until: 'soon' })).toMatchObject({ transfer: false, until: null });
    });
});

describe('the transfer file', () => {
    const data: StromData = {
        version: STROM_DATA_VERSION,
        persons: { p1: { id: 'p1' as PersonId, firstName: 'Jan', lastName: 'Novák', gender: 'male', parentIds: [], childIds: [], partnerships: [] } } as unknown as StromData['persons'],
        partnerships: {},
    };
    const mark = { v: 1 as const, token: TOKEN, from: 'safari' as const, tree: 'Novákovi', persons: 1, at: '2026-10-05T18:00:00.000Z' };

    it('puts the mark first, then the tree as a full JSON export', () => {
        const text = buildTransferJson(mark, data);
        expect(text.startsWith(`{"${TRANSFER_KEY}":{"v":1,"token":"${TOKEN}"`)).toBe(true);
        const back = readTransferJson(text, TOKEN);
        expect(back?.mark).toEqual(mark);
        expect(JSON.parse(back!.json)).toEqual(data);
    });

    it('reads only a file for this token, with a mark it knows', () => {
        const text = buildTransferJson(mark, data);
        expect(readTransferJson(text, 'Zz' + TOKEN.slice(2))).toBeNull();
        expect(readTransferJson('not json', TOKEN)).toBeNull();
        expect(readTransferJson(JSON.stringify(data), TOKEN)).toBeNull();
        expect(readTransferJson(JSON.stringify({ [TRANSFER_KEY]: { ...mark, v: 2 }, ...data }), TOKEN)).toBeNull();
        const odd = readTransferJson(JSON.stringify({ [TRANSFER_KEY]: { ...mark, from: 'netscape', persons: -3 }, ...data }), TOKEN);
        expect(odd?.mark).toMatchObject({ from: 'other', persons: 0 });
        // From a phone or tablet: said as such on the computer.
        expect(readTransferJson(buildTransferJson({ ...mark, from: 'mobile' }, data), TOKEN)?.mark.from).toBe('mobile');
    });
});
