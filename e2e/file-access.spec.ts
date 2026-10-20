import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, card } from './helpers.js';

/**
 * File System Access. The real picker/permission UI cannot be driven headlessly,
 * so: (1) when the API is absent the controls stay hidden; (2) with a mocked
 * handle, saving writes the tree JSON and shows the link indicator, and Ctrl+S
 * saves again. Cross-reload persistence relies on real cloneable handles and is
 * not covered — see COVERAGE.
 */

test('controls are hidden when the API is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
        // Hide the API before the app detects support (delete is a no-op on the
        // real non-configurable global, so override the value).
        Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
        Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
    });
    await openApp(page);
    await createFirstPerson(page, 'Solo', 'Root');
    await expect(page.locator('body')).not.toHaveClass(/fsa-supported/);
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    // The FSA save option is present in the DOM but hidden by CSS.
    await expect(page.locator('.menu-option.fsa-only').first()).toBeHidden();
});

test('mocked handle: save writes JSON, shows the indicator, Ctrl+S re-saves', async ({ page }) => {
    await page.addInitScript(() => {
        // @ts-ignore
        window.__written = null;
        const handle = {
            name: 'family.json', kind: 'file',
            async createWritable() {
                return { async write(d: string) { (window as any).__written = d; }, async close() {} };
            },
            async getFile() { return new File([(window as any).__written || ''], 'family.json'); },
            async queryPermission() { return 'granted'; },
            async requestPermission() { return 'granted'; },
        };
        // @ts-ignore
        window.showSaveFilePicker = async () => handle;
        // @ts-ignore
        window.isSecureContext = true;
    });
    await openApp(page);
    await createFirstPerson(page, 'Zoe', 'Novak');
    await expect(card(page, 'Zoe')).toBeVisible();
    // Dismiss the "add family?" offer if it appears.
    await page.locator('.family-offer-close').click({ timeout: 1500 }).catch(() => {});

    // Attach + save to the mocked file.
    await page.evaluate(() => window.Strom.UI.attachSaveToFile());
    const written = await page.evaluate(() => (window as any).__written as string);
    expect(written).toContain('Zoe');
    await expect(page.locator('#file-link-indicator')).toBeVisible();

    // Change data, then Ctrl+S saves the new content into the same file.
    await createFirstPerson(page, 'Bea', 'Novak').catch(() => {});
    await page.locator('.family-offer-close').click({ timeout: 1500 }).catch(() => {});
    await page.keyboard.press('Control+s');
    await expect.poll(() => page.evaluate(() => (window as any).__written as string)).toContain('Bea');

    // Detach: indicator disappears and Ctrl+S no longer intercepts.
    await page.evaluate(() => window.Strom.UI.unlinkActiveTreeFile());
    await expect(page.locator('#file-link-indicator')).toBeHidden();
});

test.describe('the link-to-a-file tile names the save key only where a keyboard is the usual input', () => {
    const fsa = () => {
        // @ts-ignore
        window.showSaveFilePicker = async () => null;
        // @ts-ignore
        window.isSecureContext = true;
    };
    const desc = '#export-link-file-desc';

    test('a computer: Ctrl+S, on a Mac ⌘S, in German Strg+S', async ({ page }) => {
        await page.addInitScript(fsa);
        await openApp(page);
        await createFirstPerson(page, 'Solo', 'Root');
        await page.evaluate(() => window.Strom.UI.showExportDialog());
        await expect(page.locator(desc)).toBeVisible();
        await expect(page.locator(desc)).toHaveText('Keeps this tree in a .json file — then just press Ctrl+S to save into it');
        await page.evaluate(() => {
            window.Strom.UI.closeExportDialog();
            window.Strom.UI.setLanguage('de' as never);
            window.Strom.UI.showExportDialog();
        });
        await expect(page.locator(desc)).toHaveText('Der Stammbaum wird in einer .json-Datei gehalten — danach genügt Strg+S zum Speichern');
        await page.evaluate(() => {
            window.Strom.UI.closeExportDialog();
            Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' });
            Object.defineProperty(navigator, 'userAgentData', { configurable: true, get: () => undefined });
            window.Strom.UI.setLanguage('en' as never);
            window.Strom.UI.showExportDialog();
        });
        await expect(page.locator(desc)).toHaveText('Keeps this tree in a .json file — then just press ⌘S to save into it');
    });

    test.describe('touch', () => {
        test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        test('a phone: no key, Save does it', async ({ page }) => {
            await page.addInitScript(fsa);
            await openApp(page);
            await createFirstPerson(page, 'Solo', 'Root');
            await page.evaluate(() => window.Strom.UI.showExportDialog());
            await expect(page.locator(desc)).toBeVisible();
            await expect(page.locator(desc)).toHaveText('Keeps this tree in a .json file — Save then writes into it');
            await page.evaluate(() => {
                window.Strom.UI.closeExportDialog();
                window.Strom.UI.setLanguage('cs' as never);
                window.Strom.UI.showExportDialog();
            });
            await expect(page.locator(desc)).toHaveText('Strom se ukládá do souboru .json — pak stačí Uložit');
        });
    });
});
