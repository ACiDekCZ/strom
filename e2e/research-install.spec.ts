import { test, expect, Page, Browser } from '@playwright/test';
import fs from 'fs';
import { openApp, card, createFirstPerson, addRelation, waitForPersist } from './helpers.js';

/**
 * Installing Strom Research from the app: "What it is" → the line for this
 * computer's system (with the tree's token, valid 24 h) → waiting until the
 * research opens the app with ?adopt=; then the hand-over and "The research
 * is ready". Nothing is stored and nothing is asked of the network until the
 * Install step. Invented data.
 */

const BRIDGE = 'http://127.0.0.1:5993/0123456789abcdef0123456789abcdef';
const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
const cors = { 'access-control-allow-origin': '*' };
const TOKEN_IN_LINE = /STROM_FROM_APP='?([A-Za-z0-9_-]{22,43})/;

const dialog = (page: Page) => page.locator('#research-info-modal');
/** This copy's address as the line names it (origin + path, no query). */
const appUrlOf = (page: Page): string => { const u = new URL(page.url()); return `${u.origin}${u.pathname}`; };
const installRecord = (page: Page) => page.evaluate(() => {
    const t = localStorage.getItem('strom-install');
    return t ? JSON.parse(t) as { token: string; treeId: string | null; os: string; createdAt: string; expiresAt: string } : null;
});

/** Pretend to be a Mac, Windows or Linux browser (Client Hints platform). */
async function asPlatform(page: Page, platform: string): Promise<void> {
    await page.addInitScript((p) => {
        Object.defineProperty(navigator, 'userAgentData', {
            configurable: true,
            get: () => ({ platform: p, brands: [{ brand: 'Chromium', version: '140' }], mobile: false }),
        });
    }, platform);
}

/** A tree with Jan, the install dialog on its Install step. */
async function toInstallStep(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showResearchInstall());
    await expect(dialog(page).locator('.research-install-dialog')).toHaveAttribute('data-step', 'what');
    await dialog(page).locator('[data-act="install"]').click();
    await expect(dialog(page).locator('.research-install-dialog')).toHaveAttribute('data-step', 'install');
}

const SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const FIREFOX_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:143.0) Gecko/20100101 Firefox/143.0';

/** Pretend to be a browser without Client Hints (Safari, Firefox). */
async function asBrowser(page: Page, ua: string): Promise<void> {
    await page.addInitScript((u) => {
        Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => u });
        Object.defineProperty(navigator, 'userAgentData', { configurable: true, get: () => undefined });
    }, ua);
}

/** strom-research:// links the app hands over, kept instead of opened. */
async function catchLinks(page: Page): Promise<void> {
    await page.evaluate(() => {
        const launched: string[] = [];
        (window as unknown as { __launched: string[] }).__launched = launched;
        window.Strom.UI.handOverResearchLink = (url: string) => { launched.push(url); };
    });
}
const launched = (page: Page) => page.evaluate(() => (window as unknown as { __launched: string[] }).__launched);

/**
 * The other browser on the computer: the research opens it with ?adopt= and
 * holds the transfer file. Imports it, hands it over; the research gets the tree.
 */
async function handOverInChrome(browser: Browser, token: string, file: string): Promise<void> {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const other = await ctx.newPage();
    const posted: string[] = [];
    await other.route(`${BRIDGE}/**`, async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*' } });
        if (path.endsWith('/adopt') && req.method() === 'GET') {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ token, name: 'My Family Tree', transfer: true }) });
        }
        if (path.endsWith('/transfer')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: file });
        if (path.endsWith('/adopt') && req.method() === 'POST') {
            posted.push(req.postData() ?? '');
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ tree: UUID, head: 'abc1234' }) });
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await openApp(other);
    await other.evaluate((b) => window.Strom.UI.openExternalRequest(new URLSearchParams({ adopt: b })), BRIDGE);
    const adopt = other.locator('#research-adopt-modal');
    await expect(adopt.locator('.research-adopt-moved')).toHaveText('Move The tree came from Safari. After the hand-over, work goes on here.');
    await adopt.locator('#research-adopt-confirm').click();
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toContain('1 NAME Jan /Novak/');
    await expect(other.locator('.install-ready-moved')).toHaveText('A copy of the tree stayed in Safari. Once everything here is right, it can be removed there.');
    await ctx.close();
}

async function setup(page: Page, platform = 'macOS'): Promise<void> {
    await page.setViewportSize({ width: 1280, height: 900 });
    await asPlatform(page, platform);
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
}

test.describe('installing the research from the app', () => {
    test('nothing is stored or asked before the Install step; there the token holds 24 h', async ({ page }) => {
        const outside: string[] = [];
        page.on('request', r => { if (/127\.0\.0\.1|localhost:\d+\/(?!strom)/.test(r.url())) outside.push(r.url()); });
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showResearchInstall());
        const d = dialog(page);
        await expect(d.locator('h2')).toHaveText('Strom Research');
        await expect(d.locator('.install-step')).toHaveText(['What it is', 'Install', 'Waiting']);
        await expect(d.locator('.install-intro')).toContainText('takes the tree');
        await expect(d.locator('.install-card-archive')).toContainText('Free');
        await expect(d.locator('.install-card-agent')).toContainText('Recommended · uses an AI subscription');
        // The agent first: recommended and the default; the archive free, without AI.
        await expect(d.locator('.install-card').first()).toHaveClass(/install-card-agent/);
        await d.locator('[data-dismiss]').click();
        await expect(d).toHaveCount(0);
        expect(await installRecord(page)).toBeNull();
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.researchAdoptToken)).toBeUndefined();

        await toInstallStep(page);
        const rec = (await installRecord(page))!;
        expect(rec.os).toBe('mac');
        expect(Date.parse(rec.expiresAt) - Date.parse(rec.createdAt)).toBe(24 * 60 * 60 * 1000);
        // The tree waits to be taken over by the same token.
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.researchAdoptToken?.token)).toBe(rec.token);
        const line = await d.locator('.install-line').first().getAttribute('data-line');
        // A copy of the app other than stromapp.info (here the test server): the line names it.
        const app = appUrlOf(page);
        expect(line).toBe(`curl -fsSL https://github.com/ACiDekCZ/strom-research/releases/latest/download/install.sh | STROM_FROM_APP=${rec.token} STROM_FROM_APP_NAME='My Family Tree' STROM_FROM_BROWSER=chromium STROM_APP_URL=${app} sh`);
        await expect(d.locator('.install-line .install-token').first()).toHaveText(rec.token);
        // Opened again while it holds: the same token.
        await d.locator('[data-act="back"]').click();
        await d.locator('[data-act="install"]').click();
        expect((await installRecord(page))!.token).toBe(rec.token);
        expect(outside).toEqual([]);
    });

    test('the step pills are inset like the title and the text (not on the dialog\'s edge)', async ({ page }) => {
        await setup(page);
        for (const width of [1280, 450]) {
            await page.setViewportSize({ width, height: 900 });
            await page.evaluate(() => window.Strom.UI.showResearchInstall());
            const left = (sel: string) => dialog(page).locator(sel).first().evaluate(e => Math.round(e.getBoundingClientRect().left));
            const pill = await dialog(page).locator('.install-step').first().evaluate(e => Math.round(e.getBoundingClientRect().left));
            expect(Math.abs(pill - await left('#research-install-title')), `at ${width} px`).toBeLessThanOrEqual(1);
            expect(Math.abs(pill - await left('.install-intro')), `at ${width} px`).toBeLessThanOrEqual(1);
            await page.evaluate(() => window.Strom.UI.closeResearchInstall());
        }
    });

    test('the system is recognised; the switch changes the line and the steps; macOS warns about Apple\'s tools', async ({ page }) => {
        await setup(page, 'Windows');
        await toInstallStep(page);
        const d = dialog(page);
        await expect(d.locator('.install-detected')).toHaveText('Detected: Windows');
        await expect(d.locator('.install-os-btn.active')).toHaveText('Windows');
        const token = (await installRecord(page))!.token;
        expect(await d.locator('.install-line').first().getAttribute('data-line'))
            .toBe(`powershell -ExecutionPolicy Bypass -c "$env:STROM_FROM_APP='${token}'; $env:STROM_APP_URL='${appUrlOf(page)}'; irm https://github.com/ACiDekCZ/strom-research/releases/latest/download/install.ps1 | iex"`);
        // (With this copy's address the tree's name no longer fits Win + R, nor the browser: left out, the
        // research suggests a name and picks a browser. The public app's line has room for both.)
        expect((await d.locator('.install-line').first().getAttribute('data-line'))!.length).toBeLessThanOrEqual(259);
        await expect(d.locator('.install-howto li').first()).toContainText('Win + R');
        await expect(d.locator('.install-apple')).toHaveCount(0);

        await d.locator('.install-os-btn[data-os="linux"]').click();
        await expect(d.locator('.install-howto li').first()).toContainText('Ctrl + Alt + T');
        expect(await d.locator('.install-line').first().getAttribute('data-line')).toContain(`STROM_FROM_APP=${token} STROM_FROM_APP_NAME='My Family Tree' STROM_FROM_BROWSER=chromium STROM_APP_URL=${appUrlOf(page)} sh`);
        await d.locator('.install-os-btn[data-os="mac"]').click();
        await expect(d.locator('.install-apple')).toContainText('Command Line Tools');
        expect((await installRecord(page))!.os).toBe('mac');
        // The same token for every system.
        expect((await installRecord(page))!.token).toBe(token);

        // npm folded away; open, it carries the same token.
        await expect(d.locator('details.install-other')).not.toHaveAttribute('open', '');
        await d.locator('details.install-other summary').click();
        expect(await d.locator('.install-npm').getAttribute('data-line')).toBe(`npm i -g strom-research\nSTROM_FROM_APP=${token} STROM_FROM_APP_NAME='My Family Tree' STROM_FROM_BROWSER=chromium STROM_APP_URL=${appUrlOf(page)} strom-research`);
    });

    test('Copy puts the exact line on the clipboard; "Copied" holds until the system changes', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await setup(page);
        await toInstallStep(page);
        const d = dialog(page);
        await d.locator('[data-act="copy"]').click();
        await expect(d.locator('[data-act="copy"]')).toHaveText('✓ Copied');
        await expect(d.locator('.install-after')).toContainText('Now paste the line');
        const line = await d.locator('.install-line').first().getAttribute('data-line');
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(line);
        await d.locator('.install-os-btn[data-os="linux"]').click();
        await expect(d.locator('[data-act="copy"]')).toHaveText('Copy');
    });

    test('a clipboard that fails: the line is selected and the toast says so', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('no')) } });
        });
        await toInstallStep(page);
        await dialog(page).locator('[data-act="copy"]').click();
        await expect(page.locator('.toast')).toContainText('Copying failed');
        expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain('STROM_FROM_APP=');
    });

    test('waiting: no request to the computer for 5 minutes; after 15 the longer text; after 24 h expired, the menu as before', async ({ page }) => {
        await page.clock.install();
        const local: string[] = [];
        page.on('request', r => { if (r.url().includes('127.0.0.1')) local.push(r.url()); });
        await setup(page);
        await toInstallStep(page);
        const d = dialog(page);
        await d.locator('[data-act="pasted"]').click();
        await expect(d.locator('.install-wait')).toHaveAttribute('data-phase', 'waiting');
        await expect(d.locator('.install-wait-title')).toHaveText('Waiting for the research to respond…');
        await expect(d.locator('.install-note')).toContainText('Allow access to devices on your local network');
        await page.clock.fastForward(5 * 60 * 1000);
        expect(local).toEqual([]);
        await page.clock.fastForward(11 * 60 * 1000);
        await expect(d.locator('.install-wait')).toHaveAttribute('data-phase', 'long');
        await expect(d.locator('.install-wait-title')).toHaveText('Waiting for the installation to finish');
        await expect(d.locator('.install-foot-note')).toContainText('Started');

        // Closed: the menu item finishes the installation, without a dot or a toast.
        await d.locator('[data-dismiss]').click();
        await page.locator('.actions-menu-btn').click();
        await expect(page.locator('#research-menu-row .research-menu-label')).toHaveText('Finish installing the research…');
        await page.locator('#research-menu-row').click();
        await expect(d.locator('.install-wait')).toHaveAttribute('data-phase', 'long');

        await page.clock.fastForward(24 * 60 * 60 * 1000);
        await expect(d.locator('.install-wait')).toHaveAttribute('data-phase', 'expired');
        await expect(d.locator('.install-wait-title')).toHaveText('The command has expired');
        await d.locator('[data-dismiss]').click();
        await page.locator('.actions-menu-btn').click();
        await expect(page.locator('#research-menu-row .research-menu-label')).toHaveText('Ancestor research');
        expect(local).toEqual([]);
    });

    test('opened again after a reload: "Finish installing…" opens the waiting step; nothing reminds by itself', async ({ page }) => {
        await setup(page);
        await toInstallStep(page);
        await dialog(page).locator('[data-act="pasted"]').click();
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await expect(page.locator('.toast')).toHaveCount(0);
        await expect(dialog(page)).toHaveCount(0);
        await page.locator('.actions-menu-btn').click();
        await expect(page.locator('#research-menu-row .research-menu-label')).toHaveText('Finish installing the research…');
        await expect(page.locator('#research-menu-row .research-new-badge')).toBeHidden();
        await page.locator('#research-menu-row').click();
        await expect(dialog(page).locator('.research-install-dialog')).toHaveAttribute('data-step', 'wait');
        await expect(dialog(page).locator('.install-wait')).toHaveAttribute('data-phase', 'long');
    });

    test('its tree tied to a research some other way (a research already installed): no "Finish installing…" any more, the record gone', async ({ page }) => {
        await setup(page);
        await toInstallStep(page);
        await dialog(page).locator('[data-act="pasted"]').click();
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        // The tree went to a research without the install's token (opened from a research already here).
        await page.evaluate(() => {
            const id = window.Strom.DataManager.getCurrentTreeId();
            window.Strom.TreeManager.setResearchLink(id, { id: '3233420f-b95e-41d3-baf5-60fb5b1ca3e6', fingerprint: '', syncedAt: new Date().toISOString() } as never);
        });
        await page.locator('.actions-menu-btn').click();
        await expect(page.locator('#research-menu-row .research-menu-label')).not.toHaveText('Finish installing the research…');
        expect(await page.evaluate(() => localStorage.getItem('strom-install'))).toBeNull();
    });

    test('?adopt= with the install token: the hand-over, then "The research is ready"; another tab closes its dialog', async ({ page }) => {
        await setup(page);
        await toInstallStep(page);
        await dialog(page).locator('[data-act="pasted"]').click();
        const token = (await installRecord(page))!.token;

        // A second tab still waiting.
        const other = await page.context().newPage();
        await other.setViewportSize({ width: 1280, height: 900 });
        await openApp(other);
        await other.evaluate(() => window.Strom.UI.showResearchInstall());
        await expect(dialog(other).locator('.research-install-dialog')).toHaveAttribute('data-step', 'wait');

        const posted: string[] = [];
        const versions: string[] = [];
        await page.route(`${BRIDGE}/**`, async (route) => {
            const req = route.request();
            const path = new URL(req.url()).pathname;
            versions.push(new URL(req.url()).searchParams.get('app') ?? '');
            if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*' } });
            if (path.endsWith('/adopt') && req.method() === 'GET') {
                return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ token, name: 'Novákovi' }) });
            }
            if (path.endsWith('/adopt') && req.method() === 'POST') {
                posted.push(req.postData() ?? '');
                return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ tree: UUID, head: 'abc1234' }) });
            }
            if (path.endsWith('/status')) {
                return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
                    body: JSON.stringify({ tree: { id: UUID, name: 'Novákovi', lang: 'cs' }, path: '/Users/jan/Strom/Novakovi', accepts: { mode: 'archive' } }) });
            }
            return route.fulfill({ status: 404, headers: cors, body: '' });
        });
        await page.evaluate((b) => window.Strom.UI.openExternalRequest(new URLSearchParams({ adopt: b })), BRIDGE);
        const adopt = page.locator('#research-adopt-modal');
        await expect(adopt.locator('h2')).toHaveText('Hand over the tree to the research?');
        await expect(adopt.locator('.audit-log-subtitle')).toContainText('1 person → new research “Novákovi”');
        await adopt.locator('#research-adopt-confirm').click();

        const ready = page.locator('#research-ready-modal');
        await expect(ready.locator('h2')).toContainText('The research is ready');
        await expect(ready.locator('.install-ready-path')).toHaveText('/Users/jan/Strom/Novakovi');
        await expect(ready).toContainText('full quality');
        // An archive: no row for an agent.
        await expect(ready).not.toContainText('Agent');
        expect(posted[0]).toContain('1 NAME Jan /Novak/');
        // Every request names the app's version (the research decides what to send by it).
        expect(versions.length).toBeGreaterThan(1);
        const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version as string;
        expect(new Set(versions)).toEqual(new Set([version]));
        expect(await installRecord(page)).toBeNull();
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.id)).toBe(UUID);
        // Connected at once: the bridge that took the tree is remembered for the research.
        const remembered = await page.evaluate((id) => localStorage.getItem(`strom-research-bridge:${id}`), UUID);
        expect(JSON.parse(remembered ?? '{}').base).toBe(BRIDGE);
        await ready.getByRole('button', { name: 'Done' }).click();
        await expect(ready).toHaveCount(0);

        // The other tab heard it: its dialog closes with a word.
        await expect(dialog(other)).toHaveCount(0);
        await expect(other.locator('.toast')).toContainText('The research responded in a new tab.');
        await other.close();
    });

    test('a waiting tab without BroadcastChannel hears it too (the record removed)', async ({ page }) => {
        await setup(page);
        await toInstallStep(page);
        await dialog(page).locator('[data-act="pasted"]').click();
        const other = await page.context().newPage();
        await other.addInitScript(() => { delete (window as unknown as { BroadcastChannel?: unknown }).BroadcastChannel; });
        await other.setViewportSize({ width: 1280, height: 900 });
        await openApp(other);
        await other.evaluate(() => window.Strom.UI.showResearchInstall());
        await expect(dialog(other).locator('.research-install-dialog')).toHaveAttribute('data-step', 'wait');
        // The tab the research opened finishes the installation.
        await page.evaluate(() => window.Strom.UI.finishResearchInstall('x'));
        await expect(dialog(other)).toHaveCount(0);
        await expect(other.locator('.toast')).toContainText('The research responded in a new tab.');
        await other.close();
    });

    test('Safari: the tree moves to another browser — said first, downloaded with its mark, the line names the file, the tree gets its banner', async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'userAgent', {
                configurable: true,
                get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
            });
            Object.defineProperty(navigator, 'userAgentData', { configurable: true, get: () => undefined });
        });
        await setup(page);
        await toInstallStep(page);
        const d = dialog(page);
        await expect(d.locator('.install-transfer-head')).toHaveText(/Moving the tree\s*Safari → another browser/);
        await expect(d.locator('.install-transfer')).toContainText("Safari can't connect to the research");
        await expect(d.locator('.install-transfer')).toContainText('the tree “My Family Tree” therefore moves to another browser');
        // No line before the tree is downloaded.
        await expect(d.locator('.install-line')).toHaveCount(0);
        await expect(d.locator('.install-line-later')).toHaveText('The line appears once the tree is downloaded.');
        await expect(d.locator('[data-act="pasted"]')).toBeDisabled();
        // The line's place has the line's height: the dialog does not jump at the download.
        expect((await d.locator('.install-line-later').boundingBox())!.height).toBeGreaterThanOrEqual(38);
        const token = (await installRecord(page))!.token;
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            d.locator('[data-act="transfer-download"]').click(),
        ]);
        const file = `strom-prenos-${token.slice(0, 8)}.json`;
        expect(download.suggestedFilename()).toBe(file);
        const text = await (await import('node:fs')).promises.readFile(await download.path(), 'utf8');
        expect(text.startsWith(`{"stromTransfer":{"v":1,"token":"${token}","from":"safari","tree":"My Family Tree","persons":1,`)).toBe(true);
        expect(Object.values(JSON.parse(text).persons as Record<string, { firstName: string }>).map(p => p.firstName)).toContain('Jan');
        await expect(d.locator('.install-transfer-done')).toHaveText('✓ Downloaded');
        await expect(d.locator('.install-transfer-file')).toHaveText(file);
        await expect(d.locator('.install-transfer')).toHaveClass(/install-transfer-downloaded/);
        await expect(d.locator('[data-act="pasted"]')).toBeEnabled();
        expect(await d.locator('.install-line').first().getAttribute('data-line'))
            .toContain(`STROM_FROM_APP=${token} STROM_FROM_APP_NAME='My Family Tree' STROM_FROM_BROWSER=safari STROM_FROM_FILE=${file} STROM_APP_URL=`);
        expect((await installRecord(page))!.file).toBe(file);
        // The tree says it is moving; "The move did not happen" takes the banner away.
        const banner = page.locator('#research-transfer-banner');
        await expect(banner).toContainText('“My Family Tree” is moving to another browser for the research');
        await d.locator('[data-act="pasted"]').click();
        await expect(d).toContainText('It asks which browser the tree moves to');
        await page.evaluate(() => window.Strom.UI.closeResearchInstall());
        await banner.locator('.research-transfer-undo').click();
        await expect(banner).toHaveCount(0);
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.researchTransfer)).toBeUndefined();
    });

    test('desktop Safari: the welcome and "Data elsewhere" say the research needs Chrome or Edge; "Continue here" holds; not on an iPad, not in Chrome', async ({ page }) => {
        const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
        await page.addInitScript((ua) => {
            Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua });
            Object.defineProperty(navigator, 'userAgentData', { configurable: true, get: () => undefined });
            Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => Number(localStorage.getItem('test-touch') ?? 0) });
        }, SAFARI);
        await page.setViewportSize({ width: 1280, height: 900 });
        await openApp(page);
        const welcome = page.locator('#empty-state .browser-notice');
        await expect(welcome).toContainText("Ancestor research planned? Safari can't connect to the research. Best to start straight in Chrome or Edge, or to install the research first");
        // On a Mac Chrome may be missing: its download is offered (Windows has Edge).
        await expect(welcome.locator('[data-browser-notice="chrome"]')).toHaveText('Download Chrome ↗');
        // "Install the research" opens the installation.
        await welcome.locator('[data-browser-notice="install"]').click();
        await expect(dialog(page).locator('.research-install-dialog')).toHaveAttribute('data-step', 'what');
        await page.evaluate(() => window.Strom.UI.closeResearchInstall());
        await page.evaluate(() => window.Strom.UI.showImportFileDialog());
        await expect(page.locator('#import-file-modal .browser-notice')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.closeImportFileDialog());
        // The research offer says it too (no "Continue here" there).
        await page.evaluate(() => window.Strom.UI.showResearchInstall());
        await expect(dialog(page).locator('.browser-notice [data-browser-notice="copy"]')).toBeVisible();
        await expect(dialog(page).locator('.browser-notice [data-browser-notice="stay"]')).toHaveCount(0);
        await expect(dialog(page).locator('.browser-notice [data-browser-notice="install"]')).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.closeResearchInstall());
        await welcome.locator('[data-browser-notice="stay"]').click();
        await expect(page.locator('.browser-notice')).toHaveCount(0);
        await page.reload();
        await expect(page.locator('#empty-state')).toBeVisible();
        await expect(page.locator('.browser-notice')).toHaveCount(0);
        // An iPad (asks for the desktop site as a Mac, but has touch): never.
        await page.evaluate(() => { localStorage.removeItem('strom-browser-notice'); localStorage.setItem('test-touch', '5'); });
        await page.reload();
        await expect(page.locator('#empty-state')).toBeVisible();
        await expect(page.locator('.browser-notice')).toHaveCount(0);
    });

    test('Safari: "I already have it" sends the tree as a file first, and the link names it; "Start research" leads there too', async ({ page }) => {
        await asBrowser(page, SAFARI_UA);
        await setup(page);
        await catchLinks(page);
        // An installed research cannot be reached from Safari: the Install step, its file.
        await page.evaluate(() => window.Strom.UI.startResearchAdopt(window.Strom.DataManager.getCurrentTreeId()!));
        await expect(dialog(page).locator('.research-install-dialog')).toHaveAttribute('data-step', 'install');
        expect(await launched(page)).toEqual([]);
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            dialog(page).locator('[data-act="have"]').click(),
        ]);
        const token = (await installRecord(page))!.token;
        const file = `strom-prenos-${token.slice(0, 8)}.json`;
        expect(download.suggestedFilename()).toBe(file);
        await expect.poll(() => launched(page)).toEqual([`strom-research://new?app=${token}&browser=safari&file=${file}`]);
        await expect(dialog(page).locator('.research-install-dialog')).toHaveAttribute('data-step', 'wait');
    });

    test('an encrypted tree moves too: said in amber, the file is plain JSON, the other browser imports and hands it over', async ({ page, browser }) => {
        await asBrowser(page, SAFARI_UA);
        await setup(page);
        await waitForPersist(page, 'Jan');
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const settings = page.locator('#settings-modal');
        await settings.locator('#encryption-toggle').check();
        const setupPwd = page.locator('#password-setup-modal');
        await setupPwd.locator('#password-setup-input').fill('Tajne-heslo-42');
        await setupPwd.locator('#password-setup-confirm').fill('Tajne-heslo-42');
        await setupPwd.getByRole('button', { name: 'Save' }).click();
        await expect(settings.locator('#encryption-status')).toHaveText('Encryption enabled');
        await page.reload();
        const prompt = page.locator('#password-prompt-modal');
        await prompt.locator('#password-prompt-input').fill('Tajne-heslo-42');
        await prompt.locator('#password-prompt-input').press('Enter');
        await expect(card(page, 'Jan')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.closeBrowserNoticeFloat());
        await toInstallStep(page);
        const d = dialog(page);
        await expect(d.locator('.install-transfer .install-warn')).toHaveText('The file for the move is not encrypted, like any JSON export.');
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            d.locator('[data-act="transfer-download"]').click(),
        ]);
        const token = (await installRecord(page))!.token;
        const text = await fs.promises.readFile(await download.path(), 'utf8');
        expect(JSON.parse(text).stromTransfer.token).toBe(token);
        expect(Object.values(JSON.parse(text).persons as Record<string, { firstName: string }>).map(p => p.firstName)).toContain('Jan');
        await handOverInChrome(browser, token, text);
    });

    test('the copy a move left behind asks at its opening: keep it for now (banner, one reminder), the move did not happen, remove it', async ({ page }) => {
        await asBrowser(page, SAFARI_UA);
        await setup(page);
        await waitForPersist(page, 'Jan');
        const mark = () => page.evaluate(() => window.Strom.TreeManager.setResearchTransfer(window.Strom.TreeManager.getActiveTreeId()!, { at: '2026-10-05T18:00:00.000Z' }));
        await mark();
        await page.reload();
        const q = page.locator('#research-old-copy-modal');
        const banner = page.locator('#research-transfer-banner');
        await expect(q.locator('h2')).toHaveText('This tree is now in another browser');
        await expect(q).toContainText('The tree “My Family Tree” moved to another browser for the research on');
        await expect(q).toContainText('this copy is older, and changes in it do not reach the research');
        await expect(banner).toHaveCount(0);
        // Keep it for now: the banner; the first edit reminds, once.
        await q.locator('[data-act="keep"]').click();
        await expect(q).toHaveCount(0);
        await expect(banner).toContainText('“My Family Tree” is moving to another browser for the research.');
        const reminder = page.locator('.toast', { hasText: 'This is an older copy of “My Family Tree”' });
        await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
        await expect(reminder).toBeVisible();
        await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
        await addRelation(page, 'Jan', 'child', 'Pavel', 'Novak');
        await expect(card(page, 'Pavel')).toBeVisible();
        await expect(reminder).toHaveCount(0);
        // The next opening asks again; Escape = keep it for now.
        await waitForPersist(page, 'Pavel');
        await page.reload();
        await expect(q).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(q).toHaveCount(0);
        await expect(banner).toBeVisible();
        // A click outside the question = keep it for now.
        await page.reload();
        await expect(q).toBeVisible();
        await expect(q.locator('[data-act="keep"]')).toBeFocused();
        await q.click({ position: { x: 5, y: 5 } });
        await expect(q).toHaveCount(0);
        await expect(banner).toBeVisible();
        // The move did not happen: the mark goes, nothing else.
        await page.reload();
        await q.locator('[data-act="not-done"]').click();
        await expect(q).toHaveCount(0);
        await expect(banner).toHaveCount(0);
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.researchTransfer)).toBeUndefined();
        // Remove this copy: only once confirmed; the only tree gone, the welcome screen says where to start.
        await mark();
        await page.reload();
        await q.locator('[data-act="remove"]').click();
        const confirm = page.locator('.modal-overlay.active').filter({ hasText: 'The tree stays in the other browser and in the research. Here it is removed.' });
        await expect(confirm).toContainText('Remove this copy?');
        await confirm.getByRole('button', { name: 'Remove this copy' }).click();
        await expect(page.locator('.toast')).toContainText('The copy of “My Family Tree” was removed.');
        await expect(page.locator('#empty-state')).toBeVisible();
        await expect(page.locator('#empty-state .browser-notice')).toBeVisible();
        expect(await page.evaluate(() => Object.keys(window.Strom.DataManager.getData().persons).length)).toBe(0);
    });

    test('Safari: the first person brings the notice over the tree once (Mac: with Chrome\'s download); never after "Continue here"', async ({ page }) => {
        await asBrowser(page, SAFARI_UA);
        await setup(page);
        const float = page.locator('#browser-notice-float');
        await expect(float).toContainText("Safari can't connect to the research.");
        await expect(float.locator('[data-browser-notice="install"]')).toBeVisible();
        await expect(float.locator('[data-browser-notice="chrome"]')).toBeVisible();
        await float.locator('.browser-notice-close').click();
        await expect(float).toHaveCount(0);
        expect(await page.evaluate(() => localStorage.getItem('strom-browser-notice-tree'))).toBe('1');
        await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
        await expect(float).toHaveCount(0);
    });

    test('Safari after "Continue here": no notice over a new tree\'s first person', async ({ page }) => {
        await asBrowser(page, SAFARI_UA);
        await page.addInitScript(() => localStorage.setItem('strom-browser-notice', 'here'));
        await setup(page);
        await expect(card(page, 'Jan')).toBeVisible();
        await expect(page.locator('.browser-notice')).toHaveCount(0);
    });

    test('Firefox reaches the research: no notice, no move — the line names Firefox', async ({ page }) => {
        await asBrowser(page, FIREFOX_UA);
        await page.setViewportSize({ width: 1280, height: 900 });
        await openApp(page);
        await expect(page.locator('#empty-state')).toBeVisible();
        await expect(page.locator('.browser-notice')).toHaveCount(0);
        await createFirstPerson(page, 'Jan', 'Novak');
        await expect(page.locator('#browser-notice-float')).toHaveCount(0);
        await toInstallStep(page);
        await expect(dialog(page).locator('.install-transfer')).toHaveCount(0);
        expect(await dialog(page).locator('.install-line').first().getAttribute('data-line')).toContain('STROM_FROM_BROWSER=firefox ');
    });

    test('a private window in Safari: said once at the start, nothing blocked; the storage status says so and suggests Chrome or Edge', async ({ page }) => {
        await asBrowser(page, SAFARI_UA);
        await page.addInitScript(() => {
            const storage = navigator.storage as StorageManager & { getDirectory: () => Promise<unknown> };
            storage.getDirectory = () => Promise.reject(Object.assign(new Error('The operation failed for an unknown transient reason (e.g. out of memory).'), { name: 'UnknownError' }));
        });
        await page.setViewportSize({ width: 1280, height: 900 });
        await openApp(page);
        const notice = page.locator('.toast', { hasText: 'Private window: the trees disappear when it closes.' });
        await expect(notice).toBeVisible();
        await createFirstPerson(page, 'Jan', 'Novak');
        await page.evaluate(() => window.Strom.UI.closeBrowserNoticeFloat());
        await page.evaluate(() => window.Strom.UI.showStorageStatusDialog());
        const status = page.locator('#storage-status-modal');
        await expect(status).toContainText('This is a private window: the browser clears the trees when it closes.');
        await expect(status).toContainText("For ancestor research, Chrome or Edge is better. Safari can't connect to the research.");
        await page.evaluate(() => window.Strom.UI.closeStorageStatusDialog());
        // Once per window.
        await waitForPersist(page, 'Jan');
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await expect(notice).toHaveCount(0);
        // The move works from it as from any Safari window.
        await toInstallStep(page);
        await expect(dialog(page).locator('[data-act="transfer-download"]')).toBeVisible();
    });

    test('Brave: blocked access to this computer is told with Brave\'s own setting', async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'brave', { configurable: true, get: () => ({ isBrave: () => Promise.resolve(true) }) });
            const query = navigator.permissions.query.bind(navigator.permissions);
            navigator.permissions.query = ((d: { name: string }) => d.name === 'localhost-access'
                ? Promise.resolve({ state: 'denied', onchange: null } as unknown as PermissionStatus)
                : ['loopback-network', 'local-network-access', 'local-network'].includes(d.name)
                    ? Promise.reject(new TypeError(`unknown permission ${d.name}`))
                    : query(d as PermissionDescriptor)) as Permissions['query'];
        });
        await page.setViewportSize({ width: 1280, height: 900 });
        await openApp(page);
        void page.evaluate(() => { void window.Strom.UI.showResearchConnectFailed(new TypeError('Failed to fetch')); });
        const failed = page.locator('#research-connect-failed .research-connect-failed');
        await expect(failed).toHaveAttribute('data-reason', 'denied');
        await expect(failed).toContainText("the browser didn't let Strom connect to it");
        await expect(failed.locator('.connect-how')).toContainText('find Localhost access');
    });

    test('Chrome: no browser notice on the welcome screen', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await openApp(page);
        await expect(page.locator('#empty-state')).toBeVisible();
        await expect(page.locator('.browser-notice')).toHaveCount(0);
    });

    for (const [name, width, height] of [['phone', 360, 780], ['tablet', 768, 1024], ['desktop', 1440, 900]] as const) {
        test(`fits a ${name} without scrolling sideways`, async ({ page }) => {
            await page.setViewportSize({ width, height });
            await asPlatform(page, 'macOS');
            await openApp(page);
            await createFirstPerson(page, 'Jan', 'Novak');
            await page.evaluate(() => window.Strom.UI.showResearchInstall('install'));
            await expect(dialog(page).locator('.install-line').first()).toBeVisible();
            const overflow = await page.evaluate(() => {
                const modal = document.querySelector('#research-info-modal .modal') as HTMLElement;
                const r = modal.getBoundingClientRect();
                return { doc: document.documentElement.scrollWidth - window.innerWidth, left: r.left, right: r.right - window.innerWidth };
            });
            expect(overflow.doc).toBeLessThanOrEqual(0);
            expect(overflow.left).toBeGreaterThanOrEqual(0);
            expect(overflow.right).toBeLessThanOrEqual(0);
        });
    }
});

test.describe('installing the research from a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the old copy\'s question at 360 px: the answers stacked, the primary on top, the removal last, 44 px each', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 780 });
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await waitForPersist(page, 'Jan');
        await page.evaluate(() => window.Strom.TreeManager.setResearchTransfer(window.Strom.TreeManager.getActiveTreeId()!, { at: '2026-10-05T18:00:00.000Z', mobile: true }));
        await page.reload();
        const q = page.locator('#research-old-copy-modal');
        await expect(q.locator('h2')).toHaveText('This tree is now on a computer');
        const boxes = await Promise.all(['keep', 'not-done', 'remove'].map(a => q.locator(`[data-act="${a}"]`).boundingBox()));
        expect(boxes[0]!.y).toBeLessThan(boxes[1]!.y);
        expect(boxes[1]!.y).toBeLessThan(boxes[2]!.y);
        for (const b of boxes) expect(b!.height).toBeGreaterThanOrEqual(44);
    });

    test('the tree goes to the computer as a file: downloaded, then the line for the computer\'s terminal (its system picked here)', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await page.evaluate(() => window.Strom.UI.showResearchInstall());
        const d = dialog(page);
        await expect(d.locator('.research-install-touch')).toBeVisible();
        await expect(d.locator('.install-mobile-box')).toContainText('the tree “My Family Tree” is here. It goes over as a file');
        await expect(d.locator('.install-line')).toHaveCount(0);
        await expect(d.locator('.install-send-link')).toHaveCount(0);
        expect(await installRecord(page)).toBeNull();
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            d.locator('[data-act="transfer-download"]').click(),
        ]);
        const record = (await installRecord(page))!;
        const file = `strom-prenos-${record.token.slice(0, 8)}.json`;
        expect(download.suggestedFilename()).toBe(file);
        const text = await fs.promises.readFile(await download.path(), 'utf8');
        expect(text.startsWith(`{"stromTransfer":{"v":1,"token":"${record.token}","from":"mobile","tree":"My Family Tree","persons":1,`)).toBe(true);
        await expect(d.locator('.install-transfer-done')).toHaveText('✓ Downloaded');
        await expect(d.locator('.install-mobile-line-label')).toHaveText('The line for the computer’s terminal:');
        await d.locator('.install-os-btn[data-os="mac"]').click();
        expect(await d.locator('.install-line').getAttribute('data-line')).toContain(`STROM_FROM_BROWSER=mobile STROM_FROM_FILE=${file} `);
        // Windows: the file always (the browser may not fit Win + R's 259 characters).
        await d.locator('.install-os-btn[data-os="win"]').click();
        expect(await d.locator('.install-line').getAttribute('data-line')).toContain(`$env:STROM_FROM_FILE='${file}'; `);
        // The tree left on the phone says where it is going.
        await expect(page.locator('#research-transfer-banner')).toContainText('“My Family Tree” is moving to a computer for the research.');
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.researchTransfer?.mobile)).toBe(true);
    });
});
