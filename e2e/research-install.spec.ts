import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import { openApp, card, createFirstPerson } from './helpers.js';

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
        await expect(d.locator('.install-transfer')).toContainText("Safari can't connect to the research");
        await expect(d.locator('.install-transfer')).toContainText('the tree “My Family Tree” therefore moves to another browser');
        // No line before the tree is downloaded.
        await expect(d.locator('.install-line')).toHaveCount(0);
        await expect(d.locator('.install-line-later')).toHaveText('The line appears once the tree is downloaded.');
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
        await expect(welcome).toContainText('Ancestor research planned? The family is better entered straight in Chrome or Edge.');
        await page.evaluate(() => window.Strom.UI.showImportFileDialog());
        await expect(page.locator('#import-file-modal .browser-notice')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.closeImportFileDialog());
        // The research offer says it too (no "Continue here" there).
        await page.evaluate(() => window.Strom.UI.showResearchInstall());
        await expect(dialog(page).locator('.browser-notice [data-browser-notice="copy"]')).toBeVisible();
        await expect(dialog(page).locator('.browser-notice [data-browser-notice="stay"]')).toHaveCount(0);
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
