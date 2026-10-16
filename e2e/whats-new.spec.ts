import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, waitForPersist, PACKAGE_VERSION } from './helpers.js';

/**
 * "What's new" after an update: at the first start of a new version the
 * dialog shows the points of this version from the changelog (embedded in the
 * build) once; "Don't show next time" turns it off for later updates and
 * Settings turns it back on. A new user's first start shows nothing.
 */

const SEEN_KEY = 'strom-whats-new-seen';
/** The first look comes 1.2 s after the first render; this is well past it. */
const PAST_FIRST_CHECK_MS = 2500;
const OLDER = '3.0.0';

const dialog = (page: Page) => page.locator('#release-notes-modal');
const seen = (page: Page) => page.evaluate((k) => localStorage.getItem(k), SEEN_KEY);
const setSeen = (page: Page, v: string | null) => page.evaluate(([k, value]) => {
    if (value === null) localStorage.removeItem(k as string);
    else localStorage.setItem(k as string, value);
}, [SEEN_KEY, v] as const);

async function reload(page: Page): Promise<void> {
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
}

/** A first start (nothing shown, the version stored), then a tree with a person in it. */
async function existingUser(page: Page): Promise<void> {
    await openApp(page, { whatsNew: true });
    await createFirstPerson(page, 'Jan', 'Novak');
    await waitForPersist(page, 'Jan');
}

test('a new version shows What\'s new once; the next start does not', { tag: '@smoke' }, async ({ page }) => {
    await existingUser(page);
    await setSeen(page, OLDER);
    await reload(page);

    const d = dialog(page);
    await expect(d).toBeVisible();
    await expect(d.getByRole('heading', { name: 'What\'s new' })).toBeVisible();
    await expect(d).toContainText(`Strom ${PACKAGE_VERSION}`);
    await expect(d.locator('.release-notes-list li').first()).toBeVisible();
    // The italic "in preparation" note of the section is not shown.
    await expect(d).not.toContainText('in preparation');
    // Markdown bold is a <strong>, never raw asterisks.
    await expect(d.locator('.release-notes-list strong').first()).toBeVisible();
    await expect(d).not.toContainText('**');
    // The whole changelog on GitHub in a new tab (the About link's address).
    const full = d.getByRole('link', { name: 'All changes ↗' });
    await expect(full).toHaveAttribute('href', /^https:\/\/github\.com\/ACiDekCZ\/strom\/blob\/(beta|main)\/CHANGELOG\.md#\d+$/);
    await expect(full).toHaveAttribute('target', '_blank');
    await expect(full).toHaveAttribute('rel', /noopener/);
    // The close button has focus; Escape closes and records the version.
    await expect(d.locator('.release-notes-close')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(d).toHaveCount(0);
    expect(await seen(page)).toBe(PACKAGE_VERSION);

    await reload(page);
    await page.waitForTimeout(PAST_FIRST_CHECK_MS);
    await expect(d).toHaveCount(0);
});

test('"Don\'t show next time" keeps it away after later updates; Settings turns it back on', async ({ page }) => {
    await existingUser(page);
    await setSeen(page, OLDER);
    await reload(page);

    const d = dialog(page);
    await expect(d).toBeVisible();
    await d.getByLabel('Don\'t show next time').check();
    await d.locator('.release-notes-close').click();
    await expect(d).toHaveCount(0);
    expect(await seen(page)).toBe(PACKAGE_VERSION);

    // The next update: nothing.
    await setSeen(page, OLDER);
    await reload(page);
    await page.waitForTimeout(PAST_FIRST_CHECK_MS);
    await expect(d).toHaveCount(0);

    // Settings → Language and appearance says it is off; turned on, the next update shows it again.
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const toggle = page.locator('#whats-new-after-update-toggle');
    await expect(toggle).not.toBeChecked();
    await expect(page.locator('#settings-modal')).toContainText('What\'s new after an update');
    await toggle.check();
    await page.keyboard.press('Escape');
    await setSeen(page, OLDER);
    await reload(page);
    await expect(d).toBeVisible();
});

test('a first start with no trees shows nothing and stores the version', async ({ page }) => {
    await openApp(page, { whatsNew: true });
    await expect(page.locator('#empty-state')).toBeVisible();
    await page.waitForTimeout(PAST_FIRST_CHECK_MS);
    await expect(dialog(page)).toHaveCount(0);
    expect(await seen(page)).toBe(PACKAGE_VERSION);
});

test('an existing user from a version before the dialog (trees, no stored version) gets it', async ({ page }) => {
    await existingUser(page);
    await setSeen(page, null);
    await reload(page);
    await expect(dialog(page)).toBeVisible();
});

test('it waits while something is in the way (the "new version available" toast) and comes once the app is free', async ({ page }) => {
    await existingUser(page);
    await setSeen(page, OLDER);
    // The update toast is on screen from the start.
    await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => {
            const toast = document.createElement('div');
            toast.className = 'pwa-update';
            document.body.appendChild(toast);
        });
    });
    await reload(page);
    await page.waitForTimeout(PAST_FIRST_CHECK_MS);
    await expect(dialog(page)).toHaveCount(0);
    expect(await seen(page)).toBe(OLDER);

    await page.evaluate(() => document.querySelector('.pwa-update')?.remove());
    await expect(dialog(page)).toBeVisible();
    // A click beside the dialog closes it too, and counts as seen.
    await page.mouse.click(5, 5);
    await expect(dialog(page)).toHaveCount(0);
    expect(await seen(page)).toBe(PACKAGE_VERSION);
});

for (const { locale, title, dontShow, close, full } of [
    { locale: 'cs-CZ', title: 'Co je nového', dontShow: 'Příště nezobrazovat', close: 'Zavřít', full: 'Všechny změny ↗' },
    { locale: 'de-DE', title: 'Was ist neu', dontShow: 'Nächstes Mal nicht anzeigen', close: 'Schließen', full: 'Alle Änderungen ↗' },
]) {
    test.describe(`What's new (${locale})`, () => {
        test.use({ locale });
        test(`the dialog speaks the UI language and reads its changelog (${locale})`, async ({ page }) => {
            await openApp(page, { whatsNew: true });
            await page.evaluate(() => window.Strom.DataManager.createPerson({ firstName: 'Jan', lastName: 'Novak', gender: 'male' }));
            await waitForPersist(page, 'Jan');
            await setSeen(page, OLDER);
            await reload(page);
            const d = dialog(page);
            await expect(d.getByRole('heading', { name: title })).toBeVisible();
            await expect(d.getByLabel(dontShow)).toBeVisible();
            await expect(d.locator('.release-notes-close')).toHaveText(close);
            const file = locale === 'cs-CZ' ? 'CHANGELOG.cs.md' : 'CHANGELOG.de.md';
            await expect(d.getByRole('link', { name: full })).toHaveAttribute('href', new RegExp(`/${file.replace(/\./g, '\\.')}#\\d+$`));
            // The note in preparation (cs "připravuje", de "Vorbereitung") is not shown.
            await expect(d).not.toContainText(locale === 'cs-CZ' ? 'připravuje' : 'Vorbereitung');
            await expect(d.locator('.release-notes-list li').first()).toBeVisible();
        });
    });
}
