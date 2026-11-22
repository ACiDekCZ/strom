import { test, expect } from '@playwright/test';
import { openApp, importJsonAsNewTree } from './helpers.js';

/**
 * The import guide's frame (spec 134 §1): a GEDCOM file merged into the open
 * tree opens the six steps; the counts come from the plan and add up to the
 * file's people; Esc with decisions asks Discard / Save for later / Continue.
 * The families Modřín (the tree) and Jilm (the file) are invented.
 */
test('a GEDCOM file opens the six-step guide; Esc after the comparison asks with three buttons', async ({ page }) => {
    await openApp(page);
    await importJsonAsNewTree(page, 'e2e/fixtures/modrinovi.json', 'Modřínovi');

    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/rodokmen-jilmovi.ged');
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    await result.locator('#gedcom-merge-btn').click();

    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(wizard.locator('#merge-route')).toContainText('Modřínovi');

    // Six steps, the first one current, none of the others a button yet.
    const steps = wizard.locator('#merge-progress .merge-step');
    await expect(steps).toHaveCount(6);
    await expect(wizard.locator('#merge-progress [aria-current="step"]')).toHaveAttribute('data-step', '1');
    await expect(wizard.locator('#merge-progress button.merge-step')).toHaveCount(0);
    await expect(wizard.locator('#merge-step-body .merge-step-title')).toBeFocused();

    // Before the comparison: Cancel, no Back, the primary compares.
    await expect(wizard.locator('#merge-cancel')).toBeVisible();
    await expect(wizard.locator('#merge-back')).toBeHidden();
    await expect(wizard.locator('#merge-next')).toContainText('Modřínovi');
    await wizard.locator('#merge-next').click();

    // Step 2: step 1 is done (a button), the four counts add up to the file's 4 people.
    await expect(wizard.locator('#merge-progress [aria-current="step"]')).toHaveAttribute('data-step', '2');
    await expect(wizard.locator('#merge-progress button.merge-step[data-step="1"]')).toBeVisible();
    const counts = await wizard.locator('#merge-counts .merge-stat .merge-stat-value').allTextContents();
    expect(counts).toHaveLength(4);
    expect(counts.map(Number).reduce((a, b) => a + b, 0)).toBe(4);
    await expect(wizard.locator('#merge-match-list')).toContainText('Kvido');
    await expect(wizard.locator('#merge-back')).toBeVisible();
    await expect(wizard.locator('#merge-save-later')).toBeVisible();

    // A decision, then Esc: the 1b question with its three buttons.
    await wizard.locator('#merge-match-list .merge-item').filter({ hasText: 'Kvido' }).locator('.merge-btn-confirm').click();
    await page.keyboard.press('Escape');
    const ask = page.locator('#merge-close-confirm');
    await expect(ask).toBeVisible();
    await expect(ask.locator('button')).toHaveCount(3);
    await expect(ask.locator('.merge-close-message')).toContainText('1');
});
