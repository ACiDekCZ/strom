import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, seedSetting, personModal, card, cardAction } from './helpers.js';

/**
 * U01: a sex the records do not give. The person dialog offers Male | Female
 * | Unknown; a new person starts as the relation says (father male, mother
 * female, a partner the opposite of a known sex) and as Unknown elsewhere; a
 * person of unknown sex wears the --unknown ring (card, dialog avatar,
 * poster), the legend explains it only while such a person is in view, and
 * GEDCOM keeps it as SEX U there and back. Invented data only.
 */

const UNKNOWN_LIGHT = 'rgb(133, 125, 108)';  // #857d6c
const UNKNOWN_DARK = 'rgb(163, 154, 136)';   // #a39a88

/** Jan (male) in focus with his child Robin (unknown): Robin's ring is not the focus ring. */
async function janAndRobin(page: Page): Promise<void> {
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const jan = dm.createPerson({ firstName: 'Jan', lastName: 'Zkoušek', gender: 'male' });
        const robin = dm.createPerson({ firstName: 'Robin', lastName: 'Zkoušek', gender: 'unknown' });
        dm.addParentChild(jan.id, robin.id);
        dm.ensureSingleParentFamilies();
        window.Strom.TreeRenderer.setFocus(jan.id);
        window.Strom.TreeRenderer.render();
    });
    await expect(card(page, 'Robin')).toBeVisible();
}

/** Open the add-person dialog from the empty state (or the toolbar). */
async function openAddPerson(page: Page): Promise<void> {
    const addFirst = page.locator('#empty-state .empty-state-actions button').first();
    if (await addFirst.isVisible().catch(() => false)) await addFirst.click();
    else await page.getByRole('button', { name: 'Add person' }).first().click();
    await expect(personModal(page)).toBeVisible();
}

async function activeSex(page: Page): Promise<string | null> {
    return personModal(page).locator('#gender-segment .segment-btn.active').getAttribute('data-gender');
}

/** The relation dialog's starting sex for `action` from `name`, then closed. */
async function relationDefault(page: Page, name: string, action: 'parent' | 'partner' | 'child' | 'sibling'): Promise<string> {
    await cardAction(page, name, action);
    const modal = page.locator('#relation-modal');
    await expect(modal).toBeVisible();
    const value = await modal.locator('#rel-gender').inputValue();
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    return value;
}

test('the dialog offers Male | Female | Unknown; a new person starts Unknown and keeps it: the ring, the dialog avatar and the legend (@smoke)', async ({ page }) => {
    await seedSetting(page, 'branchLegend', true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await openAddPerson(page);
    const segment = personModal(page).locator('#gender-segment .segment-btn');
    await expect(segment).toHaveText(['Male', 'Female', 'Unknown']);
    expect(await activeSex(page)).toBe('unknown');
    await expect(personModal(page).locator('#pm-avatar')).toHaveClass(/\bunknown\b/);
    await personModal(page).locator('#input-firstname').fill('Robin');
    await personModal(page).getByRole('button', { name: 'Save' }).click();
    await expect(personModal(page)).toBeHidden();

    const robin = card(page, 'Robin');
    await expect(robin).toHaveClass(/\bunknown\b/);
    await expect(page.locator('#legend-unknown')).toBeVisible();
    await expect(page.locator('#legend-unknown')).toHaveText('Unknown');
    await expect(page.locator('#legend-unknown .legend-ring-unknown')).toHaveCSS('border-top-color', UNKNOWN_LIGHT);
    expect(await page.evaluate(() => Object.values(window.Strom.DataManager.getData().persons)[0].gender)).toBe('unknown');

    // The edit dialog shows the same: the avatar ring of the token.
    await robin.click();
    await page.locator('.context-menu [data-action="edit"], .bottom-sheet-person [data-action="edit"]').filter({ visible: true }).click();
    await expect(personModal(page)).toBeVisible();
    expect(await activeSex(page)).toBe('unknown');
    await expect(personModal(page).locator('#pm-avatar')).toHaveCSS('box-shadow', `${UNKNOWN_LIGHT} 0px 0px 0px 2px`);
    // Male chosen: the legend item goes (nobody of unknown sex in view).
    await personModal(page).locator('#gender-segment .segment-btn[data-gender="male"]').click();
    await personModal(page).getByRole('button', { name: 'Save' }).click();
    await expect(robin).toHaveClass(/\bmale\b/);
    await expect(page.locator('#legend-unknown')).toBeHidden();
});

test('the card ring of an unknown sex is the --unknown token (light theme)', async ({ page }) => {
    await openApp(page);
    await janAndRobin(page);
    await expect(card(page, 'Robin').locator('.card-avatar')).toHaveCSS('border-top-color', UNKNOWN_LIGHT);
});

test('the ring of an unknown sex in the dark theme is the dark token', async ({ page }) => {
    await seedSetting(page, 'theme', 'dark');
    await openApp(page);
    await janAndRobin(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(card(page, 'Robin').locator('.card-avatar')).toHaveCSS('border-top-color', UNKNOWN_DARK);
});

test('a new relative starts as the relation says: father male, partner the opposite, child and sibling unknown', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await janAndRobin(page);
    expect(await relationDefault(page, 'Jan', 'parent')).toBe('male');
    expect(await relationDefault(page, 'Jan', 'partner')).toBe('female');
    expect(await relationDefault(page, 'Jan', 'child')).toBe('unknown');
    expect(await relationDefault(page, 'Jan', 'sibling')).toBe('unknown');
    // A partner of a person of unknown sex: unknown too (nothing to be opposite to).
    expect(await relationDefault(page, 'Robin', 'partner')).toBe('unknown');

    // The father added, the mother starts female (the other parent's opposite).
    await cardAction(page, 'Jan', 'parent');
    const modal = page.locator('#relation-modal');
    await modal.locator('#rel-firstname').fill('Otec');
    await modal.locator('#rel-submit-btn').click();
    await expect(modal).toBeHidden();
    expect(await relationDefault(page, 'Jan', 'parent')).toBe('female');
});

test('the poster draws the ring of an unknown sex in its colour', async ({ page }) => {
    await openApp(page);
    await janAndRobin(page);
    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#poster-modal .menu-option', { hasText: 'SVG' }).click(),
    ]);
    const svg = readFileSync(await download.path(), 'utf-8');
    expect(svg).toContain('stroke="#857d6c"');
    expect(svg).not.toContain('stroke="#a1706e"');
});

test('GEDCOM: SEX U imports as Unknown (no guess from the role) and exports as SEX U', async ({ page }, testInfo) => {
    await openApp(page);
    const ged = ['0 HEAD', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Alex /Zkoušek/', '1 SEX U', '1 FAMS @F1@',
        '0 @I2@ INDI', '1 NAME Eva /Zkoušková/', '1 SEX F', '1 FAMS @F1@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '0 TRLR', ''].join('\n');
    const path = testInfo.outputPath('sex-u.ged');
    const { writeFileSync } = await import('fs');
    writeFileSync(path, ged);
    await page.locator('#gedcom-input').setInputFiles(path);
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    await result.locator('#gedcom-new-tree-btn').click();
    const importDialog = page.locator('#import-tree-modal');
    await expect(importDialog).toBeVisible();
    await importDialog.getByRole('button', { name: 'Import' }).click();
    await expect(importDialog).toBeHidden();
    await expect(card(page, 'Alex')).toHaveClass(/\bunknown\b/);
    // The woman stands right, the person of unknown sex on the free side (left).
    const x = (name: string) => card(page, name).evaluate(el => el.getBoundingClientRect().left);
    expect(await x('Alex')).toBeLessThan(await x('Eva'));

    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.evaluate(() => window.Strom.UI.exportTargetTreeGedcom());
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    await pwd.locator('#export-privacy-mode').selectOption('full');
    const [download] = await Promise.all([page.waitForEvent('download'), pwd.locator('#export-submit-btn').click()]);
    const out = readFileSync(await download.path(), 'utf-8');
    expect(out).toMatch(/1 NAME Alex \/Zkoušek\/\n(?:[2-9] .*\n)*1 SEX U/);
});

test('phone 360: the sex segment spans the dialog, three buttons a thumb high', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openApp(page);
    await openAddPerson(page);
    const seg = personModal(page).locator('#gender-segment');
    await expect(seg).toBeVisible();
    const group = personModal(page).locator('#gender-segment').locator('xpath=..');
    const [segBox, groupBox] = [await seg.boundingBox(), await group.boundingBox()];
    expect(Math.abs(segBox!.width - groupBox!.width)).toBeLessThanOrEqual(1);
    const boxes = await seg.locator('.segment-btn').evaluateAll(els => els.map(e => e.getBoundingClientRect()).map(r => ({ w: r.width, h: r.height })));
    expect(boxes).toHaveLength(3);
    for (const b of boxes) expect(b.h).toBeGreaterThanOrEqual(44);
    expect(Math.max(...boxes.map(b => b.w)) - Math.min(...boxes.map(b => b.w))).toBeLessThanOrEqual(1);
    // No horizontal scroll in the dialog.
    expect(await personModal(page).locator('.modal').first().evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});
