import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card, focusViaSearch } from './helpers.js';

function canvasTransform(page: Page): Promise<string> {
    return page.locator('#tree-canvas').evaluate((el) => (el as HTMLElement).style.transform);
}

/** Current zoom scale (zoom is animated, so assertions must poll this). */
function scale(page: Page): Promise<number> {
    return page.evaluate(() => window.Strom.ZoomPan.getScale());
}

/** Wait until the zoom animation stops (two identical reads ~100ms apart). */
function waitZoomSettled(page: Page): Promise<unknown> {
    return page.waitForFunction(() => new Promise<boolean>((resolve) => {
        const a = window.Strom.ZoomPan.getScale();
        setTimeout(() => resolve(window.Strom.ZoomPan.getScale() === a), 100);
    }));
}

test('keyboard: Ctrl+F focuses search, +/0 zoom, Esc closes a modal', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    // Ctrl+F focuses the toolbar search input.
    const searchInput = page.locator('#toolbar-search-picker .person-picker-input');
    await page.keyboard.press('Control+f');
    await expect(searchInput).toBeFocused();

    // Blur the input so single-key zoom shortcuts are active (they are ignored
    // while a text field holds focus). Click an empty corner so the click does
    // not land on the centred card (which would open the context menu).
    await searchInput.blur();
    await page.locator('#tree-container').click({ position: { x: 8, y: 8 } });
    await expect(searchInput).not.toBeFocused();
    const base = await scale(page);
    await page.keyboard.press('+');
    await expect.poll(() => scale(page)).toBeGreaterThan(base);
    // reset() does not cancel the in-flight zoom animation, so wait for it to
    // fully settle before pressing 0, otherwise the animation clobbers the reset.
    await waitZoomSettled(page);
    await expect(searchInput).not.toBeFocused();
    await page.keyboard.press('0'); // reset to scale 1
    await expect.poll(() => scale(page)).toBe(1);

    // Esc closes an open modal.
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    await expect(page.locator('#person-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#person-modal')).toBeHidden();
});

test('zoom controls and mouse wheel change the zoom level', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    const base = await scale(page);
    await page.locator('.zoom-controls button').first().click(); // zoom in
    await expect.poll(() => scale(page)).toBeGreaterThan(base);

    // Mouse wheel over the canvas also changes the zoom.
    const afterButton = await scale(page);
    await page.locator('#tree-container').hover();
    await page.mouse.wheel(0, -200);
    await expect.poll(() => scale(page)).not.toBe(afterButton);
});

test('dragging the canvas pans the tree', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    const before = await canvasTransform(page);
    const box = await page.locator('#tree-container').boundingBox();
    if (!box) throw new Error('no tree container');
    // Drag from an empty area of the canvas.
    await page.mouse.move(box.x + box.width - 40, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 160, box.y + 160, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => canvasTransform(page)).not.toBe(before);
});

test('the canvas is a compositor layer only while it moves, and pans in whole pixels (sharp cards) (T01)', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    const willChange = () => page.locator('#tree-canvas').evaluate((el) => getComputedStyle(el).willChange);

    // At rest: no layer hint (a kept layer is scaled, not redrawn — blurry cards).
    await expect.poll(willChange).toBe('auto');

    // Dragging: the hint is on while the mouse is down and moving, off after.
    const box = (await page.locator('#tree-container').boundingBox())!;
    await page.mouse.move(box.x + box.width - 40, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 120, box.y + 120, { steps: 4 });
    expect(await willChange()).toBe('transform');
    await page.mouse.up();
    expect(await willChange()).toBe('auto');

    // Wheel zoom has no end event: on while wheeling, off once it is quiet.
    const whileWheeling = await page.evaluate(([x, y]) => {
        const container = document.getElementById('tree-container')!;
        container.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: x, clientY: y, bubbles: true, cancelable: true }));
        return getComputedStyle(document.getElementById('tree-canvas')!).willChange;
    }, [box.x + box.width - 40, box.y + 40]);
    expect(whileWheeling).toBe('transform');
    await expect.poll(willChange).toBe('auto');

    // A fractional pan is written as whole pixels.
    await page.evaluate(() => window.Strom.ZoomPan.centerOnWorldPoint(100.37, 50.61));
    const t = await canvasTransform(page);
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(t);
    expect(m, t).not.toBeNull();
    expect(Number.isInteger(Number(m![1])) && Number.isInteger(Number(m![2])), t).toBe(true);
});

test('expanded mode: a multi-marriage person shows all partners inline', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('#empty-state')).toBeHidden();

    // Erik married twice; focusing him lays out both wives inline.
    await focusViaSearch(page, 'Erik');
    await expect(card(page, 'Laura')).toBeVisible();
    await expect(card(page, 'Rosa')).toBeVisible();
    // More than a single couple is on screen.
    expect(await page.locator('.person-card').count()).toBeGreaterThan(4);

    // Refocusing another person re-lays-out the tree around the new focus.
    await focusViaSearch(page, 'Sofia');
    await expect(card(page, 'Sofia')).toHaveClass(/focused/);
});

test('Escape closes dialogs that are not on the dialog stack (book, sources)', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => window.Strom.UI.showBookDialog());
    await expect(page.locator('#book-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#book-modal')).toBeHidden();

    await page.evaluate(() => window.Strom.UI.showSourcesDialog());
    await expect(page.locator('#sources-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#sources-modal')).toBeHidden();
    // Nothing resurrected.
    await expect(page.locator('.modal-overlay.active')).toHaveCount(0);
});

test.describe('mobile', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the filter sheet keeps the zoom buttons (under its backdrop) and its own foot in view', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await expect(page.locator('.zoom-controls')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.toggleSearchFilters());
        await expect(page.locator('.zoom-controls')).toBeVisible();
        await expect(page.locator('#search-filters .search-filters-sheet-foot button').last()).toBeInViewport();
        await page.keyboard.press('Escape');   // closes the panel first
        await expect(page.locator('#search-filters')).toBeHidden();
        await expect(page.locator('.zoom-controls')).toBeVisible();
    });
});

test('focus back/forward buttons walk history in both directions', async ({ page }) => {
    await openApp(page);
    // The sample tree has anniversaries; an "on this day" card would cover the buttons on those dates.
    await page.evaluate(() => window.Strom.SettingsManager.setOnThisDay(false));
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    const back = page.locator('#focus-back-btn');
    const fwd = page.locator('#focus-forward-btn');
    await expect(back).toBeHidden();
    await expect(fwd).toBeHidden();

    const focusName = () => page.evaluate(() =>
        window.Strom.DataManager.getPerson(window.Strom.TreeRenderer.getFocusPersonId())?.firstName ?? null);

    // Johan → Peter → (directly) Maria.
    await focusViaSearch(page, 'Peter');
    await expect(back).toBeVisible();
    await expect(fwd).toBeHidden();               // no forward yet
    await page.evaluate(() => {
        const p = window.Strom.DataManager.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Maria');
        if (p) window.Strom.TreeRenderer.setFocus(p.id);
    });
    await expect.poll(focusName).toBe('Maria');

    // Back to Peter: forward becomes available.
    await back.click();
    await expect.poll(focusName).toBe('Peter');
    await expect(fwd).toBeVisible();
    // Forward returns to Maria.
    await fwd.click();
    await expect.poll(focusName).toBe('Maria');
    await expect(fwd).toBeHidden();               // at the tip again

    // A NEW navigation after going back clears forward.
    await back.click();                            // → Peter
    await expect(fwd).toBeVisible();
    await focusViaSearch(page, 'Johan');       // new branch
    await expect(fwd).toBeHidden();
});



test('the very first navigation counts the default focus (back works after one step)', async ({ page }) => {
    await openApp(page);
    // The sample tree has anniversaries; an "on this day" card would cover the buttons on those dates.
    await page.evaluate(() => window.Strom.SettingsManager.setOnThisDay(false));
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    // Fresh tree: no history yet.
    await expect(page.locator('#focus-back-btn')).toBeHidden();
    const defaultFocus = await page.evaluate(() =>
        window.Strom.DataManager.getPerson(window.Strom.TreeRenderer.getFocusPersonId())?.firstName);

    // ONE navigation must already enable back (the default must be counted).
    await focusViaSearch(page, 'Peter');
    await expect(page.locator('#focus-back-btn')).toBeVisible();
    // Back returns to the default person.
    await page.locator('#focus-back-btn').click();
    await expect.poll(() => page.evaluate(() =>
        window.Strom.DataManager.getPerson(window.Strom.TreeRenderer.getFocusPersonId())?.firstName)).toBe(defaultFocus);
});
