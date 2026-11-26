import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, card, cardAction } from './helpers.js';

/**
 * Give a family tree…, step 2 "Who is in it" (spec 093 §3) on the sample tree
 * (Daniel Berg): the depth changes the counts and the cards of the preview,
 * a branch unticked takes its family out, the "+ family" stub puts it back;
 * on a phone the depth as rows, a still preview and the branches on their own
 * screen ("… › Branches").
 */

const TODAY = new Date('2026-12-10T10:00:00');

async function stepTwo(page: Page): Promise<Locator> {
    await page.clock.setFixedTime(TODAY);
    await openApp(page);
    await page.evaluate(async () => {
        await window.Strom.UI.loadDemoTree();
        await window.Strom.TreeRenderer.setFocus('demo_daniel' as never);
    });
    await expect(card(page, 'Daniel')).toBeVisible();
    await cardAction(page, 'Daniel', 'gift-tree');
    const dialog = page.locator('#gift-modal');
    await expect(dialog).toHaveClass(/active/);
    await dialog.locator('#gift-next').click();
    return dialog;
}

const cards = (dialog: Locator): Locator => dialog.locator('.gift-prev-host .gift-mc');

async function summaryPersons(dialog: Locator): Promise<number> {
    return Number(await dialog.locator('.gift-sum b').first().textContent());
}

test('the depth changes the counts and the preview; a branch out takes its family, the stub puts it back', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const dialog = await stepTwo(page);
    await expect(dialog.locator('#gift-sub')).toHaveText('step 2 of 6: Who is in it');

    // The four depths with their counts; the default is "Second cousins".
    const seg = dialog.locator('.gift-seg [role="radio"]');
    await expect(seg).toHaveCount(4);
    await expect(seg.nth(2)).toHaveAttribute('aria-checked', 'true');
    await expect(seg.nth(2).locator('.gift-seg-n')).toHaveText('28 people');
    await expect(seg.nth(3).locator('.gift-seg-n')).toHaveText('29 people');
    await expect(cards(dialog)).toHaveCount(28);
    await expect(dialog.locator('.gift-mc.is-me')).toHaveAttribute('title', /^Daniel Berg/);
    await expect(dialog.locator('.gift-prev-top')).toContainText('28 people');
    expect(await summaryPersons(dialog)).toBe(28);

    // "Everyone": one more card (Hanna's family), the summary follows, her branch is ticked.
    await seg.nth(3).click();
    await expect(seg.nth(3)).toHaveAttribute('aria-checked', 'true');
    await expect(cards(dialog)).toHaveCount(29);
    expect(await summaryPersons(dialog)).toBe(29);
    const hanna = dialog.locator('.gift-br-r', { hasText: 'Hanna Berg' });
    await expect(hanna.locator('input')).toBeChecked();
    await expect(hanna.locator('.gift-br-c')).toHaveText('3 with family');

    // Unticked: her family leaves the preview and the counts; a "+ family (1)" stub stands in for it.
    await hanna.locator('input').uncheck();
    await expect(cards(dialog)).toHaveCount(28);
    expect(await summaryPersons(dialog)).toBe(28);
    await expect(hanna.locator('.gift-br-c')).toHaveText('2 · with family 3');
    const stub = dialog.locator('.gift-stub.is-family');
    await expect(stub).toHaveText('+ family (1)');

    // The stub adds the family again ("Whole" brings the far branches into view).
    await dialog.locator('.gift-prev-zb.is-w').click();
    await stub.click();
    await expect(cards(dialog)).toHaveCount(29);
    await expect(dialog.locator('.gift-br-r', { hasText: 'Hanna Berg' }).locator('input')).toBeChecked();
    await expect(dialog.locator('.gift-stub.is-family')).toHaveCount(0);

    // A card's menu: her family out again from the preview.
    await dialog.locator('.gift-mc[title^="Hanna Berg"]').click();
    const menu = page.locator('.gift-cm');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[role="menuitem"]').first()).toHaveText(/^Remove the family: .*Hanna Berg \(1 person\)$/);
    await menu.locator('[role="menuitem"]').first().click();
    await expect(menu).toHaveCount(0);
    await expect(cards(dialog)).toHaveCount(28);

    // Zoom: + raises the percent, "Whole" shows everything.
    const pct = dialog.locator('.gift-prev-pct');
    const before = parseInt(await pct.textContent() ?? '0', 10);
    await dialog.locator('.gift-prev-zb', { hasText: '+' }).click();
    expect(parseInt(await pct.textContent() ?? '0', 10)).toBeGreaterThan(before);
});

test('phone: the depth as rows, a still preview, the branches on their own screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const dialog = await stepTwo(page);
    const sub = dialog.locator('#gift-sub-btn');
    await expect(sub).toContainText('Who is in it');

    const rows = dialog.locator('.gift-depths [role="radio"]');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(2)).toHaveAttribute('aria-checked', 'true');
    await expect(rows.nth(2).locator('.option-title')).toHaveText('Second cousins (default)');
    await expect(rows.nth(3).locator('.gift-depth-n')).toHaveText('29 people');
    await expect(dialog.locator('.gift-prev.is-still')).toBeVisible();
    await expect(dialog.locator('.gift-prev-zoom')).toHaveCount(0);
    await expect(dialog.locator('.gift-branches')).toHaveCount(0);

    // "Full preview and branches ›": the subtitle grows "› Branches", the list and the full preview are there.
    await dialog.locator('.gift-br-open').click();
    await expect(sub).toContainText('› Branches');
    await expect(dialog.locator('.gift-cut-sub .gift-prev-zoom')).toBeVisible();
    await expect(dialog.locator('.gift-br-r', { hasText: 'Hanna Berg' })).toBeVisible();
    const noScroll = await dialog.locator('.gift-pane').evaluate(e => e.scrollWidth <= e.clientWidth);
    expect(noScroll).toBe(true);

    // ‹ goes back to step 2, not to step 1.
    await dialog.locator('#gift-back').click();
    await expect(sub).not.toContainText('Branches');
    await expect(sub).toContainText('Who is in it');
    await expect(rows).toHaveCount(4);
});
