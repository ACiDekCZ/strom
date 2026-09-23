import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson } from './helpers.js';

/** Group titles and row titles of the export dialog, in DOM order (visible only). */
async function exportMenuStructure(page: Page): Promise<{ group: string; rows: string[] }[]> {
    return page.locator('#export-modal .menu-group').evaluateAll((groups) =>
        groups
            .filter((g) => (g as HTMLElement).offsetParent !== null)
            .map((g) => ({
                group: (g.querySelector('.menu-group-title') as HTMLElement).innerText.trim(),
                rows: Array.from(g.querySelectorAll<HTMLElement>('.menu-option'))
                    .filter((o) => o.offsetParent !== null)
                    .map((o) => (o.querySelector('.option-title') as HTMLElement).innerText.trim()),
            })));
}

test('export menu: groups in order with result-named rows (EN, CS, DE)', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await expect(page.locator('#export-modal')).toBeVisible();
    const en = await exportMenuStructure(page);
    // "Link to a file on disk…" exists only where the File System Access API
    // does; the rest of the structure is fixed.
    const save = en[1].rows.filter((r) => r !== 'Link to a file on disk…');
    expect(en.map((g) => g.group.toLowerCase())).toEqual([
        'share', 'save and back up', 'print and image', 'for other programs', 'only the people shown',
    ]);
    expect(en[0].rows).toEqual(['Send to a relative']);
    expect(save).toEqual(['App with your data (HTML)', 'Data backup (JSON)']);
    expect(en[2].rows).toEqual(['Poster', 'Family book']);
    expect(en[3].rows).toEqual(['GEDCOM', 'Person table (CSV)']);
    expect(en[4].rows).toEqual(['Save selection as JSON', 'New tree from selection']);

    // Every row explains format/destination in its description.
    const descs = await page.locator('#export-modal .menu-option:visible .option-desc').allInnerTexts();
    expect(descs.length).toBeGreaterThanOrEqual(9);
    for (const d of descs) expect(d.trim().length).toBeGreaterThan(0);

    // Rows have no fill and no frame; the view-scoped group is set apart.
    const row = page.locator('#export-modal .menu-option').first();
    expect(await row.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('0px');
    expect(await row.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    const sel = page.locator('#export-modal .menu-group-secondary');
    expect(await sel.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px');
    await page.evaluate(() => window.Strom.UI.closeExportDialog());

    await page.evaluate(() => window.Strom.UI.setLanguage('cs'));
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    const cs = await exportMenuStructure(page);
    expect(cs.map((g) => g.group.toLowerCase())).toEqual([
        'sdílet', 'uložit a zálohovat', 'tisk a obraz', 'pro jiné programy', 'jen zobrazené osoby',
    ]);
    expect(cs[2].rows).toEqual(['Plakát', 'Kniha rodu']);
    expect(cs[4].rows).toEqual(['Uložit výběr jako JSON', 'Vytvořit z výběru nový strom']);
    await page.evaluate(() => window.Strom.UI.closeExportDialog());

    await page.evaluate(() => window.Strom.UI.setLanguage('de'));
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    const de = await exportMenuStructure(page);
    expect(de.map((g) => g.group.toLowerCase())).toEqual([
        'teilen', 'speichern und sichern', 'druck und bild', 'für andere programme', 'nur angezeigte personen',
    ]);
    expect(de[3].rows).toEqual(['GEDCOM', 'Personentabelle (CSV)']);
});

test('export menu for a non-active tree hides whole view-scoped groups', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    const other = await page.evaluate(() => {
        const active = window.Strom.TreeManager.getActiveTreeId();
        const id = window.Strom.TreeManager.createTree('Second');
        window.Strom.TreeManager.setActiveTree(active);
        return id;
    });
    await page.evaluate((id) => window.Strom.UI.showExportDialog(id), other);
    const groups = await exportMenuStructure(page);
    expect(groups.map((g) => g.group.toLowerCase())).toEqual(['save and back up', 'for other programs']);
});

test.describe('grouped settings', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('shows at least two whole groups without scrolling; rows carry no frame', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const settings = page.locator('#settings-modal');
        await expect(settings).toBeVisible();

        const titles = await settings.locator('.settings-group-title').allInnerTexts();
        expect(titles.map((t) => t.toLowerCase())).toEqual([
            'tree view', 'notifications', 'person card', 'data and privacy', 'language and appearance',
        ]);
        // No per-option heading repeating the row text any more.
        await expect(settings.locator('.settings-label')).toHaveCount(0);

        const fullyVisible = await settings.evaluate((modal) => {
            const box = modal.querySelector('.modal') as HTMLElement;
            const scroller = (box.querySelector(':scope > .modal-content') as HTMLElement | null) ?? box;
            const view = scroller.getBoundingClientRect();
            return Array.from(modal.querySelectorAll('.settings-group')).filter((g) => {
                const r = g.getBoundingClientRect();
                return r.top >= view.top - 0.5 && r.bottom <= view.bottom + 0.5
                    && r.bottom <= window.innerHeight;
            }).length;
        });
        expect(fullyVisible).toBeGreaterThanOrEqual(2);

        // No .settings-checkbox anywhere has its own frame.
        const framed = await page.locator('.settings-checkbox').evaluateAll((els) =>
            els.filter((el) => {
                const cs = getComputedStyle(el);
                return ['Top', 'Right', 'Bottom', 'Left'].some((s) =>
                    parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) > 0
                    && cs.getPropertyValue(`border-${s.toLowerCase()}-style`) !== 'none'
                    && !(s === 'Top' && el.matches('.settings-row + .settings-row')));
            }).length);
        expect(framed).toBe(0);

        // Switch sits on the right of the text, never wrapped under it.
        const row = settings.locator('label.settings-row', { has: page.locator('#minimap-toggle') });
        const rowBox = (await row.boundingBox())!;
        const sw = (await settings.locator('#minimap-toggle').boundingBox())!;
        const text = (await row.locator('.settings-text').boundingBox())!;
        expect(sw.x).toBeGreaterThan(text.x + text.width - 1);
        expect(sw.x + sw.width).toBeGreaterThan(rowBox.x + rowBox.width - 20);
    });

    test('death anniversaries is indented under "On this day" and disabled while it is off', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const settings = page.locator('#settings-modal');
        const parent = settings.locator('#on-this-day-toggle');
        const child = settings.locator('#death-anniversaries-toggle');

        const parentRow = settings.locator('label.settings-row', { has: page.locator('#on-this-day-toggle') });
        const childRow = settings.locator('label.settings-row', { has: page.locator('#death-anniversaries-toggle') });
        const pText = (await parentRow.locator('.settings-text').boundingBox())!;
        const cText = (await childRow.locator('.settings-text').boundingBox())!;
        expect(cText.x - pText.x).toBeGreaterThanOrEqual(28);

        if (!(await parent.isChecked())) await parent.check();
        await expect(child).toBeEnabled();
        await parent.uncheck();
        await expect(child).toBeDisabled();
        await expect(childRow).toHaveClass(/is-disabled/);
        // Re-opening keeps the dependency in sync with the stored setting.
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await expect(child).toBeDisabled();
        await parent.check();
        await expect(child).toBeEnabled();
    });
});
