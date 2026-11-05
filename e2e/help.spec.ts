import { test, expect, Page } from '@playwright/test';
import { openApp } from './helpers.js';

/**
 * "How Strom works" (1105): the help embedded in the app file opens from the
 * Actions menu, from About and from More on a phone; contents A · R · S, a
 * chapter with a jump to a rule, the search, the glossary, Back (also the
 * system one), Escape and no network at all.
 */

const help = (page: Page) => page.locator('.help-modal');
const main = (page: Page) => page.locator('.help-main');

async function openFromMenu(page: Page): Promise<void> {
    await page.locator('.actions-menu-btn').click();
    await page.locator('#actions-help-row').click();
    await expect(help(page)).toBeVisible();
}

async function search(page: Page, q: string): Promise<void> {
    await page.locator('.help-search-input').fill(q);
}

test.describe('How Strom works on a computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the Actions menu opens it right above Settings: contents A · R · S, the field ready, Esc closes @smoke', async ({ page }) => {
        await openApp(page);
        await page.locator('.actions-menu-btn').click();
        const row = page.locator('#actions-help-row');
        await expect(row).toHaveText('How Strom works');
        const order = await page.locator('#actions-menu-dropdown').evaluate(menu =>
            [...menu.children].map(el => el.id).filter(id => ['actions-settings-divider', 'actions-help-row', 'actions-settings-row'].includes(id)));
        expect(order).toEqual(['actions-settings-divider', 'actions-help-row', 'actions-settings-row']);
        await row.click();
        await expect(help(page)).toBeVisible();
        await expect(help(page)).toHaveAttribute('aria-label', 'How Strom works');
        await expect(page.locator('#actions-menu-dropdown')).not.toHaveClass(/active/);
        await expect(page.locator('.help-part-id')).toHaveText(['A', 'R', 'S']);
        await expect(page.locator('.help-ch[data-chapter="R2"]')).toBeVisible();
        await expect(page.locator('.help-docver')).toContainText(/Describes the Strom app \d+\.\d+\.\d+ and research \d+\.\d+\.\d+\./);
        await expect(page.locator('.help-search-input')).toBeFocused();
        // Licence and source at the end of the contents.
        await expect(page.locator('.help-home-end a[href="https://creativecommons.org/licenses/by/4.0/"]')).toHaveText('CC BY 4.0 ↗');
        await expect(page.locator('.help-home-end a[href="https://github.com/ACiDekCZ/strom-doc"]')).toHaveAttribute('target', '_blank');
        await page.keyboard.press('Escape');
        await expect(page.locator('.help-overlay')).toHaveCount(0);
    });

    test('About offers it under its description: one click closes About and opens the help', async ({ page }) => {
        await openApp(page);
        await page.locator('.app-logo').click();
        const about = page.locator('#about-modal');
        const button = about.locator('.about-help');
        await expect(button).toContainText('How Strom works');
        await expect(button).toContainText('What the app and research base their decisions on');
        await button.click();
        await expect(about).not.toHaveClass(/active/);
        await expect(help(page)).toBeVisible();
    });

    test('a chapter: its rules on the left, a link inside goes there, Back returns to the same place', async ({ page }) => {
        await openApp(page);
        await openFromMenu(page);
        await page.locator('.help-ch[data-chapter="R2"]').click();
        await expect(page.locator('.help-h1')).toContainText('R2');
        await expect(page.locator('.help-side')).toBeVisible();
        await expect(page.locator('.help-side-ch[aria-current="page"]')).toContainText('R2');
        await expect(page.locator('.help-toc')).toBeHidden();
        await expect(page.locator('.help-web')).toHaveAttribute('href', /^https:\/\/stromapp\.info\/doc\/en\/R2\//);
        // Down to a link to another number, remember where the reader was.
        const link = page.locator('.help-article a.help-ref').filter({ hasNot: page.locator('[href="#index"]') }).last();
        await link.scrollIntoViewIfNeeded();
        const before = await main(page).evaluate(el => el.scrollTop);
        expect(before).toBeGreaterThan(0);
        const target = (await link.getAttribute('href'))!.slice(1);
        await link.click();
        await expect(page.locator('.help-back')).toBeVisible();
        if (target.includes('.')) await expect(page.locator(`.help-rule[data-rule="${target}"]`)).toHaveClass(/is-target/);
        await page.locator('.help-back').click();
        await expect(page.locator('.help-h1')).toContainText('R2');
        await expect.poll(() => main(page).evaluate(el => el.scrollTop)).toBe(before);
        // Copy link: the short address, then "Copied" for a moment.
        const copy = page.locator('.help-rule[data-rule="R2.1"] .help-copy');
        await expect(copy).toHaveAttribute('title', 'https://stromapp.info/doc/R2.1');
        await copy.click();
        await expect(copy).toContainText('Copied');
    });

    test('search: a number and Enter jump to the rule; a word lists terms and rules with the match marked; nothing found says so', async ({ page }) => {
        await openApp(page);
        await openFromMenu(page);
        await search(page, 'r2.4');
        await expect(page.locator('.help-num-hit')).toContainText('R2.4');
        await page.locator('.help-search-input').press('Enter');
        await expect(page.locator('.help-h1')).toContainText('R2');
        const rule = page.locator('.help-rule[data-rule="R2.4"]');
        await expect(rule).toHaveClass(/is-target/);
        await expect(rule.locator('.help-rule-title')).toBeFocused();
        await expect(rule).toBeInViewport();
        // The highlight goes after a moment.
        await expect(rule).not.toHaveClass(/is-target/, { timeout: 5000 });

        await search(page, 'conflict');
        await expect(page.locator('.help-results')).toBeVisible();
        await expect(page.locator('.help-group-title').last()).toContainText(/Rules · \d+/);
        await expect(page.locator('.help-results mark').first()).toBeVisible();
        expect((await page.locator('.help-results mark').first().textContent())!.toLowerCase()).toContain('conflict');

        await search(page, 'qqxyzzy');
        await expect(page.locator('.help-none-title')).toHaveText('Nothing found for “qqxyzzy”.');
        await page.locator('.help-none .help-index-link').click();
        await expect(page.locator('.help-index .help-h1')).toHaveText('Glossary');
        await expect(page.locator('.help-letter').first()).toBeVisible();
        await expect(page.locator('.help-term').first().locator('.help-chip').first()).toBeVisible();
    });

    test('an unknown number shows the contents with a note; Escape clears the field first, then closes the help alone', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await expect(page.locator('#settings-modal')).toHaveClass(/active/);
        await page.evaluate(() => window.Strom.UI.showHelp('R9.14'));
        await expect(help(page)).toBeVisible();
        await expect(page.locator('.help-notice')).toHaveText('Rule R9.14 is not in the help. Here are the contents.');
        await expect(page.locator('.help-notice')).toHaveAttribute('role', 'status');
        // Above the Settings dialog.
        const z = await page.locator('.help-overlay').evaluate(el => Number(getComputedStyle(el).zIndex));
        expect(z).toBeGreaterThan(1500);
        await search(page, 'pla');
        await page.locator('.help-search-input').press('Escape');
        await expect(page.locator('.help-search-input')).toHaveValue('');
        await expect(help(page)).toBeVisible();
        await page.locator('.help-search-input').press('Escape');
        await expect(page.locator('.help-overlay')).toHaveCount(0);
        await expect(page.locator('#settings-modal')).toHaveClass(/active/);
    });

    test('closing returns the keyboard to what opened it', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => {
            const b = document.createElement('button');
            b.id = 'help-opener-probe';
            b.textContent = '?';
            document.body.appendChild(b);
            b.focus();
            window.Strom.UI.showHelp('R2.4', b);
        });
        await expect(page.locator('.help-rule[data-rule="R2.4"]')).toHaveClass(/is-target/);
        await page.locator('.help-close').click();
        await expect(page.locator('.help-overlay')).toHaveCount(0);
        await expect(page.locator('#help-opener-probe')).toBeFocused();
    });

    test('works offline: opening it asks the network for nothing', async ({ page, context }) => {
        await openApp(page);
        const requests: string[] = [];
        page.on('request', r => requests.push(r.url()));
        await context.setOffline(true);
        await openFromMenu(page);
        await page.locator('.help-ch[data-chapter="A1"]').click();
        await expect(page.locator('.help-h1')).toContainText('A1');
        await page.locator('.help-side-home').click();
        await expect(page.locator('.help-home')).toBeVisible();
        expect(requests).toEqual([]);
        await context.setOffline(false);
    });

    test('the system Back goes back inside the help, then closes it', async ({ page }) => {
        await openApp(page);
        await openFromMenu(page);
        await page.locator('.help-ch[data-chapter="R4"]').click();
        await expect(page.locator('.help-h1')).toContainText('R4');
        await page.goBack();
        await expect(page.locator('.help-home')).toBeVisible();
        await expect(help(page)).toBeVisible();
        await page.goBack();
        await expect(page.locator('.help-overlay')).toHaveCount(0);
        await expect(page.locator('.toolbar')).toBeVisible();
    });
});

test.describe('How Strom works on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('More offers it between Settings and About; it fills the screen, the search field leads the contents @smoke', async ({ page }) => {
        await openApp(page);
        await page.getByRole('button', { name: 'Try a sample tree' }).click();
        await expect(page.locator('.person-card').first()).toBeVisible();
        await page.locator('#bb-view-more').tap();
        const tiles = page.locator('.bottom-sheet-pair:has(#sheet-help) .bottom-sheet-item');
        await expect(tiles).toHaveText(['Settings', 'How Strom works', 'About']);
        await page.locator('#sheet-help').tap();
        await expect(help(page)).toBeVisible();
        await expect(page.locator('.bottom-sheet-menu')).toHaveCount(0);
        const box = (await help(page).boundingBox())!;
        expect(box.width).toBe(390);
        expect(box.height).toBe(844);
        await expect(page.locator('.help-home-search')).toBeVisible();
        await expect(page.locator('.help-search')).toBeHidden();
        await page.locator('.help-ch[data-chapter="R2"]').tap();
        await expect(page.locator('.help-back')).toBeVisible();
        await expect(page.locator('.help-side')).toBeHidden();
        await page.locator('.help-toc-toggle').tap();
        await page.locator('.help-toc-row', { hasText: 'R2.4' }).first().tap();
        await expect(page.locator('.help-rule[data-rule="R2.4"]')).toHaveClass(/is-target/);
        await page.locator('.help-close').tap();
        await expect(page.locator('.help-overlay')).toHaveCount(0);
    });
});

test.describe('How Strom works in German: nothing overflows', () => {
    test.use({ locale: 'de-DE' });

    for (const width of [390, 1440]) {
        test(`${width} wide: contents, a long chapter, the search and the glossary stay within the window`, async ({ page }) => {
            await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
            await openApp(page);
            await page.evaluate(() => window.Strom.UI.showHelp());
            await expect(help(page)).toHaveAttribute('aria-label', 'So funktioniert Strom');
            const fits = () => page.evaluate(() => {
                const out: string[] = [];
                for (const el of document.querySelectorAll<HTMLElement>('.help-modal, .help-main, .help-col, .help-header')) {
                    if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.className} ${el.scrollWidth}>${el.clientWidth}`);
                }
                return out;
            });
            expect(await fits()).toEqual([]);
            for (const target of ['S1', 'R9', 'A5', 'index']) {
                await page.evaluate(t => window.Strom.UI.showHelp(t), target);
                await expect(target === 'index' ? page.locator('.help-index') : page.locator('.help-h1')).toBeVisible();
                expect(await fits()).toEqual([]);
            }
            await page.evaluate(() => window.Strom.UI.showHelp());
            if (width < 600) await page.locator('.help-home-search').click();
            await search(page, 'Widerspruch');
            await expect(page.locator('.help-rule-hit').first()).toBeVisible();
            expect(await fits()).toEqual([]);
        });
    }
});
