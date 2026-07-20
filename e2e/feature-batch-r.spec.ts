import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, createFirstPerson, card } from './helpers.js';

/**
 * Focused coverage for the July-2026 feature batch:
 *   R1 — descendants poster export
 *   R2 — life timeline section in the person modal
 *   R3 — visible desktop Undo/Redo toolbar buttons
 *   R4 — tree-health dashboard
 */

/** Load the built-in sample tree (House of Tudor) from the empty state. */
async function loadSample(page: Page): Promise<void> {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('#empty-state')).toBeHidden();
    await expect(card(page, 'Henry VIII')).toBeVisible();
}

// ==================== R1: descendants poster ====================

test('R1: the descendants view exports a non-empty poster SVG with a card per visible person', async ({ page }) => {
    await loadSample(page);

    // Focus a person with descendants and switch to the Descendants view.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const henry = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Henry VIII');
        if (henry) window.Strom.TreeRenderer.setFocus(henry.id);
        window.Strom.UI.setDisplayViewMode('descendants');
    });
    await expect.poll(() => page.locator('.person-card').count()).toBeGreaterThan(1);

    const positionCount = await page.evaluate(
        () => window.Strom.TreeRenderer.getPosterLayout().positions.size);

    // Export the current (descendants) view as an SVG poster and read it back.
    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(() => window.Strom.UI.exportPosterSvg());
    const download = await downloadPromise;
    const svg = readFileSync(await download.path(), 'utf-8');

    // Non-empty, and one card rect (Letopis card fill) per laid-out person.
    expect(svg.length).toBeGreaterThan(200);
    expect(svg).toContain('<svg');
    const cardCount = (svg.match(/fill="#fffdf8"/g) || []).length;
    expect(cardCount).toBe(positionCount);
    // Connections are drawn (parent→child stems) — the poster is not just cards.
    expect(svg).toContain('<g class="connections">');
    expect((svg.match(/<line /g) || []).length).toBeGreaterThan(0);
});

// ==================== R2: person life timeline ====================

test('R2: the life timeline renders chronological rows for a rich person', async ({ page }) => {
    await loadSample(page);

    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const henry = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Henry VIII');
        if (henry) window.Strom.UI.showEditPersonModal(henry.id);
    });

    const section = page.locator('#pm-lifeline-section');
    await expect(section).toBeVisible();
    const rows = section.locator('.pm-lifeline-row');
    await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(2);

    // Years are non-decreasing (chronological order).
    const years = await section.locator('.pm-lifeline-year').allInnerTexts();
    const nums = years.map(y => parseInt(y, 10));
    for (let i = 1; i < nums.length; i++) {
        expect(nums[i]).toBeGreaterThanOrEqual(nums[i - 1]);
    }

    // The section collapses on click.
    await page.locator('#pm-lifeline-head').click();
    await expect(section).toHaveClass(/collapsed/);
});

test('R2: the life timeline hides for a sparse person (fewer than two dated points)', async ({ page }) => {
    await openApp(page);
    // A single birth date is one dated point — below the threshold.
    await createFirstPerson(page, 'Solo', 'Novak', { birthDate: '1900' });
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const solo = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Solo');
        if (solo) window.Strom.UI.showEditPersonModal(solo.id);
    });
    await expect(page.locator('#person-modal')).toBeVisible();
    await expect(page.locator('#pm-lifeline-section')).toBeHidden();
});

// ==================== R3: desktop Undo/Redo buttons ====================

test('R3: the desktop toolbar Undo/Redo buttons follow the can-undo/redo flow', async ({ page }) => {
    await openApp(page);
    const undoBtn = page.locator('#toolbar-undo-btn');
    const redoBtn = page.locator('#toolbar-redo-btn');
    await expect(undoBtn).toBeVisible();

    // Nothing done yet → both disabled.
    await expect(undoBtn).toBeDisabled();
    await expect(redoBtn).toBeDisabled();

    // A mutation enables Undo (Redo still disabled).
    await createFirstPerson(page, 'Jan', 'Novak');
    await expect(card(page, 'Jan')).toBeVisible();
    await expect(undoBtn).toBeEnabled();
    await expect(redoBtn).toBeDisabled();
    // Tooltip carries the platform shortcut.
    await expect(undoBtn).toHaveAttribute('title', /Ctrl\+Z|⌘Z/);

    // Clicking Undo reverts and flips the states.
    await undoBtn.click();
    await expect(card(page, 'Jan')).toBeHidden();
    await expect(undoBtn).toBeDisabled();
    await expect(redoBtn).toBeEnabled();

    // Redo brings the person back.
    await redoBtn.click();
    await expect(card(page, 'Jan')).toBeVisible();
    await expect(undoBtn).toBeEnabled();
});

// ==================== R4: tree-health dashboard ====================

test('R4: the tree-health dashboard opens with all four blocks', async ({ page }) => {
    await loadSample(page);

    await page.evaluate(() => {
        const id = window.Strom.DataManager.getCurrentTreeId();
        if (id) window.Strom.UI.showTreeHealthDialog(id);
    });

    const modal = page.locator('#tree-health-modal');
    await expect(modal).toHaveClass(/active/);

    // Four composed blocks: validation, completeness, structure, actions.
    await expect(modal.locator('.health-block')).toHaveCount(4);
    // Completeness renders four bars (birth date/place, death date, photo).
    await expect(modal.locator('.health-bar-row')).toHaveCount(4);
    // Structure renders four stat tiles (people/unions/generations/islands).
    await expect(modal.locator('.health-tile')).toHaveCount(4);
    // Quick actions row: validate, clean places, split.
    await expect(modal.locator('.health-action')).toHaveCount(3);

    // The people tile counts the real persons in the sample.
    const peopleTile = modal.locator('.health-tile').first().locator('.health-tile-num');
    expect(parseInt(await peopleTile.innerText(), 10)).toBeGreaterThan(3);
});
