import { test, expect, Page } from '@playwright/test';
import { openApp } from './helpers.js';

/**
 * A fact's citations in one order everywhere and the main citation's ★
 * (spec 095 §1): the chips under the birth in the person editor, the
 * status tip's sources, the person's sources dialog; at a phone, a tablet
 * and a desktop width, in German, and in the dark theme.
 */

interface Opts { main?: boolean; size?: { width: number; height: number }; lang?: string; dark?: boolean }

async function tree(page: Page, opts: Opts = {}): Promise<void> {
    if (opts.dark) await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize(opts.size ?? { width: 1440, height: 900 });
    await openApp(page);
    await page.evaluate(async ({ main, lang }) => {
        if (lang) window.Strom.UI.setLanguage(lang as never);
        window.Strom.SettingsManager.setAdvancedFields(true);
        await window.Strom.DataManager.importAsNewTree({
            persons: {
                r: {
                    id: 'r', firstName: 'Radim', lastName: 'Ostružník', gender: 'male', isPlaceholder: false,
                    partnerships: [], parentIds: [], childIds: [],
                    birthDate: '1871-03-04', birthPlace: 'Vrbovec', birthStatus: 'probable',
                    // The list's own order: the census, the death record, the birth record.
                    birthSourceIds: ['s1', 's3', 's2'],
                    ...(main ? { citationMain: { birthSourceIds: 's3' } } : {}),
                },
            },
            partnerships: {},
            sources: {
                s1: { id: 's1', title: 'Sčítání lidu Vrbovec 1880', quality: 2 },
                s2: { id: 's2', title: 'Matrika N Vrbovec 1860–1890', quality: 3, events: ['BIRT'], recordDate: '1871-03-06' },
                s3: { id: 's3', title: 'Matrika Z Vrbovec 1900–1930', quality: 3, events: ['DEAT'] },
            },
        } as never, 'Ostružník');
    }, { main: !!opts.main, lang: opts.lang });
}

const chipLabels = (page: Page) => page.locator('#birth-sources-group .source-chip .source-chip-label');

async function noSpill(page: Page, width: number): Promise<void> {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over).toBeLessThanOrEqual(0);
    const chips = page.locator('#birth-sources-group .source-chip');
    const boxes = [];
    for (let i = 0; i < await chips.count(); i++) boxes.push((await chips.nth(i).boundingBox())!);
    for (const b of boxes) expect(b.x + b.width).toBeLessThanOrEqual(width);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const apart = a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5;
        expect(apart).toBe(true);
    }
}

test.describe('main citation and the order of citations', () => {
    test('the birth\'s chips: the primary record first without a mark; a main citation first with ★', { tag: '@smoke' }, async ({ page }) => {
        await tree(page);
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('r' as never));
        // K1.1: the birth record (an original of its kind, written two days after), the other original, the census.
        await expect(chipLabels(page)).toHaveText(['Matrika N Vrbovec 1860–1890', 'Matrika Z Vrbovec 1900–1930', 'Sčítání lidu Vrbovec 1880']);
        await expect(page.locator('#birth-sources-group .source-chip-main')).toHaveCount(0);
        await expect(page.locator('#birth-sources-group .source-chip.is-main')).toHaveCount(0);
        // The stored list is never reordered.
        expect(await page.evaluate(() => window.Strom.DataManager.getPerson('r' as never)?.birthSourceIds)).toEqual(['s1', 's3', 's2']);

        await page.keyboard.press('Escape');
        await page.evaluate(() => window.Strom.DataManager.setCitationMain({ kind: 'person', personId: 'r', fact: 'birth' } as never, 's3'));
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('r' as never));
        await expect(chipLabels(page)).toHaveText(['Matrika Z Vrbovec 1900–1930', 'Matrika N Vrbovec 1860–1890', 'Sčítání lidu Vrbovec 1880']);
        const main = page.locator('#birth-sources-group .source-chip.is-main');
        await expect(main).toHaveCount(1);
        await expect(main.locator('.source-chip-main')).toHaveText('★︎');
        await expect(main.locator('.source-chip-open')).toHaveAttribute('aria-label', 'Matrika Z Vrbovec 1900–1930 – main citation, open');
    });

    test('the status tip: the sources in the same order, "★ main" at the main citation', async ({ page }) => {
        await tree(page, { main: true });
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('r' as never));
        const pill = page.locator('#events-list .event-row').filter({ hasText: 'Birth' }).locator('.fact-status').first();
        await pill.click();
        const tip = page.locator('#status-tip');
        await expect(tip).toBeVisible();
        await expect(tip.locator('.st-src .st-src-title')).toHaveText(['Matrika Z Vrbovec 1900–1930', 'Matrika N Vrbovec 1860–1890', 'Sčítání lidu Vrbovec 1880']);
        await expect(tip.locator('.st-src').first().locator('.st-src-main')).toHaveText('★︎ main');
        await expect(tip.locator('.st-src').first().locator('.st-src-main')).toHaveAttribute('aria-label', 'main citation');
        await expect(tip.locator('.st-src-main')).toHaveCount(1);
    });

    test('the person\'s sources: ★ after "birth" at the main citation\'s source only', async ({ page }) => {
        await tree(page, { main: true });
        await page.evaluate(() => window.Strom.UI.showPersonSourcesDialog('r' as never));
        const dialog = page.locator('#person-sources-modal');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.person-source-main')).toHaveCount(1);
        const row = dialog.locator('.person-source-main').locator("xpath=ancestor::*[contains(@class, 'person-source-row')][1]");
        await expect(row).toContainText('Matrika Z Vrbovec');
        await expect(dialog.locator('.person-source-main')).toHaveAttribute('aria-label', 'main citation');
    });

    for (const size of [{ width: 390, height: 844 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
        test(`the chips at ${size.width} px: nothing spills over or overlaps`, async ({ page }) => {
            await tree(page, { main: true, size });
            await page.evaluate(() => window.Strom.UI.showEditPersonModal('r' as never));
            await expect(page.locator('#birth-sources-group .source-chip.is-main')).toBeVisible();
            await noSpill(page, size.width);
        });
    }

    test('in German: the chip\'s and the tip\'s words', async ({ page }) => {
        await tree(page, { main: true, lang: 'de' });
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('r' as never));
        await expect(page.locator('#birth-sources-group .source-chip.is-main .source-chip-open'))
            .toHaveAttribute('aria-label', 'Matrika Z Vrbovec 1900–1930 – Hauptzitat, öffnen');
        await page.locator('#events-list .event-row .fact-status').first().click();
        await expect(page.locator('#status-tip .st-src-main')).toHaveText('★︎ Haupt');
    });

    test('dark theme: the ★ takes the dark accent', async ({ page }) => {
        await tree(page, { main: true, dark: true });
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('r' as never));
        const star = page.locator('#birth-sources-group .source-chip-main');
        await expect(star).toBeVisible();
        const [color, accent] = await star.evaluate(el => {
            const probe = document.createElement('span');
            probe.style.color = 'var(--accent)';
            el.parentElement!.appendChild(probe);
            const a = getComputedStyle(probe).color;
            probe.remove();
            return [getComputedStyle(el).color, a];
        });
        expect(color).toBe(accent);
        expect(accent).toBe('rgb(201, 141, 89)');
    });
});
