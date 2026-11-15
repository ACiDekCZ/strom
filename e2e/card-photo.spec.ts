import { test, expect, Page } from '@playwright/test';
import { openApp, card, seedTree, cardBoxesMatchLayout } from './helpers.js';

/**
 * Settings → Person card → Photo on the card (spec 096 §1, §2, §4, §5): the
 * size and shape, Small + Circle by default (the card as it always was), the
 * preview with a stand-in photo, the Normal card with a medium or large photo
 * in the tree (only cards with a photo taller), a view without a photo kept
 * small, the Compact card without the choice. Invented people.
 */

/** A photo (a 1 × 1 PNG data URI), so no file is needed. */
const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function tree(page: Page, withPhoto = true): Promise<void> {
    await openApp(page);
    await seedTree(page, {
        p1: { firstName: 'Florimund', lastName: 'Pfefferkorn', partners: ['p2'], ...(withPhoto ? { photo: PHOTO } : {}) },
        p2: { firstName: 'Quirinella', lastName: 'Pfefferkornová', gender: 'female' },
        p3: { firstName: 'Kasimir', lastName: 'Pfefferkorn', parents: ['p1', 'p2'] },
    }, 'Pfefferkorn', 'p3');
    await page.evaluate(() => document.fonts.ready);
}

async function openSettings(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await expect(page.locator('#settings-modal')).toBeVisible();
}

const photoRow = (page: Page) => page.locator('#card-photo-settings');
const sizeBtn = (page: Page, name: string) => photoRow(page).locator('.card-look-photo-size').getByRole('button', { name, exact: true });
const shapeBtn = (page: Page, name: string) => photoRow(page).locator('.card-look-photo-shape').getByRole('button', { name, exact: true });
const box = async (page: Page, firstName: string) => {
    const b = await card(page, firstName).evaluate(el => ({ w: (el as HTMLElement).offsetWidth, h: (el as HTMLElement).offsetHeight }));
    return [b.w, b.h];
};

test('the row sits between the card types and the preview; Small + Circle by default, the card as before', async ({ page }) => {
    await tree(page);
    await openSettings(page);
    const ids = await page.locator('#settings-modal .settings-group-body > .settings-row').evaluateAll(rows => rows.map(r => r.id));
    expect(ids.indexOf('card-photo-settings')).toBe(ids.indexOf('card-type-settings') + 1);
    expect(ids.indexOf('card-preview-settings')).toBe(ids.indexOf('card-photo-settings') + 1);
    await expect(photoRow(page).locator('.card-photo-title')).toHaveText('Photo on the card');
    await expect(photoRow(page).locator('.card-look-photo-size')).toHaveAccessibleName('Size');
    await expect(photoRow(page).locator('.card-look-photo-shape')).toHaveAccessibleName('Shape');
    await expect(photoRow(page).locator('[aria-pressed="true"]')).toHaveText(['Small', 'Circle']);
    await expect(photoRow(page).locator('.card-photo-note')).toContainText('People without a photo keep small initials.');
    // The preview as it always was: the initials, 188 × 64.
    await expect(page.locator('#card-preview-settings .card-preview-size')).toHaveText('card 188 × 64 px');
    await expect(page.locator('#card-preview-settings .avatar-initials')).toHaveText('JV');
    await expect(page.locator('body')).toHaveAttribute('data-card-photo', 'small');
    expect(await box(page, 'Florimund')).toEqual([188, 64]);
    expect(await box(page, 'Kasimir')).toEqual([188, 64]);
});

test('a large photo: the card with a photo 236 × 96, the others 236 × 64; stored, kept after a reload', async ({ page }) => {
    await tree(page);
    await openSettings(page);
    await sizeBtn(page, 'Large').click();
    await expect(sizeBtn(page, 'Large')).toHaveAttribute('aria-pressed', 'true');
    await expect(sizeBtn(page, 'Large')).toBeFocused();
    // The preview: the stand-in photo in the large box.
    await expect(page.locator('#card-preview-settings .card-preview-size')).toHaveText('card 236 × 96 px');
    await expect(page.locator('#card-preview-settings .preview-card.has-photo .card-avatar img')).toHaveCount(1);
    await expect(page.locator('body')).toHaveAttribute('data-card-photo', 'large');
    await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
    expect(await box(page, 'Florimund')).toEqual([236, 96]);
    expect(await box(page, 'Kasimir')).toEqual([236, 64]);
    const avatar = await card(page, 'Florimund').locator('.card-avatar').evaluate(el => (el as HTMLElement).offsetWidth);
    expect(avatar).toBe(80);
    // Beside the initials of a card without a photo: 34px, as before.
    expect(await card(page, 'Kasimir').locator('.card-avatar').evaluate(el => (el as HTMLElement).offsetWidth)).toBe(34);
    // The name of the large card at the height of the name beside it (D13): both centred on
    // y = 32 within 2px (the large card's name on two rows, the other's on one). Neither is
    // the focus, whose border is wider; in CSS px whatever the zoom.
    const nameMiddle = (n: string) => card(page, n).locator('.name-text').evaluate(el => {
        const c = el.closest<HTMLElement>('.person-card')!;
        const r = c.getBoundingClientRect();
        const t = el.getBoundingClientRect();
        return ((t.top + t.bottom) / 2 - r.top) * c.offsetHeight / r.height;
    });
    expect(Math.abs(await nameMiddle('Florimund') - 32)).toBeLessThanOrEqual(2);
    expect(Math.abs(await nameMiddle('Florimund') - await nameMiddle('Quirinella'))).toBeLessThanOrEqual(2);
    // Nothing spills over (once the names are fitted to the wider column).
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#tree-canvas .name-text, #tree-canvas .meta-text')]
        .filter(el => el.scrollWidth > el.clientWidth + 0.5).map(el => el.textContent))).toEqual([]);

    await shapeBtn(page, 'Rounded square').click();
    await expect(page.locator('body')).toHaveAttribute('data-card-photo-shape', 'rounded');
    await expect(card(page, 'Florimund').locator('.card-avatar')).toHaveCSS('border-radius', '12px');
    await expect(card(page, 'Kasimir').locator('.card-avatar')).toHaveCSS('border-radius', '5px');
    expect(await page.evaluate(() => window.Strom.SettingsManager.getCardPhoto())).toEqual({ size: 'large', shape: 'rounded' });

    await page.reload();
    await expect(card(page, 'Florimund')).toBeVisible();
    await expect.poll(() => box(page, 'Florimund')).toEqual([236, 96]);
});

test('a medium photo: every card 200 wide, none taller', async ({ page }) => {
    await tree(page);
    await openSettings(page);
    await sizeBtn(page, 'Medium').click();
    await expect(page.locator('#card-preview-settings .card-preview-size')).toHaveText('card 200 × 64 px');
    await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
    expect(await box(page, 'Florimund')).toEqual([200, 64]);
    expect(await box(page, 'Kasimir')).toEqual([200, 64]);
    expect(await card(page, 'Florimund').locator('.card-avatar').evaluate(el => (el as HTMLElement).offsetWidth)).toBe(48);
});

test('a view without a photo keeps the small card (D3); the Compact card has the choice off', async ({ page }) => {
    await tree(page, false);
    await openSettings(page);
    await sizeBtn(page, 'Large').click();
    await expect(page.locator('#card-preview-settings .card-preview-size')).toHaveText('card 236 × 96 px');
    await expect(page.locator('body')).toHaveAttribute('data-card-photo', 'small');
    expect(await box(page, 'Florimund')).toEqual([188, 64]);

    await page.evaluate(() => window.Strom.UI.setCardDensity('compact'));
    await expect(photoRow(page)).toHaveClass(/is-off/);
    await expect(photoRow(page).locator('.card-photo-note')).toHaveText('The Compact card has no photo.');
    await expect(photoRow(page).locator('button:disabled')).toHaveCount(5);
    await expect(photoRow(page).locator('.card-look-photo-size')).toHaveAttribute('aria-disabled', 'true');
    // The choice is kept.
    await expect(photoRow(page).locator('[aria-pressed="true"]')).toHaveText(['Large', 'Circle']);
});
