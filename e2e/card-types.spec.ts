import { test, expect, Page } from '@playwright/test';
import { openApp, card, seedSetting } from './helpers.js';

/**
 * Settings → "Card detail" (U03b): the row of the five card types — a radio
 * group of tiles with a small sample card each — the chosen type's sentence,
 * "Edit as Custom" on the preset types with its notice and "Restore
 * previous", and the "Same as …" note when Custom equals a preset. Phone:
 * three columns; phone held sideways: a segment of names. Invented data (the
 * sample tree).
 */

const PRESET_REGISTER_ON = ['birth', 'baptism', 'marriage', 'death', 'burial'];
const MINE = { on: ['marriage'], style: 'labels', widthCap: 400 };

async function sampleTree(page: Page, density = 'normal', fields?: unknown): Promise<void> {
    await seedSetting(page, 'cardDensity', density);
    if (fields) await seedSetting(page, 'cardFields', fields);
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
}

async function openSettings(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await expect(page.locator('#settings-modal')).toBeVisible();
}

const row = (page: Page) => page.locator('#card-type-row');
const tile = (page: Page, name: string) => row(page).getByRole('radio', { name, exact: true });
const host = (page: Page) => page.locator('#card-type-settings');
const stored = (page: Page) => page.evaluate(() => window.Strom.SettingsManager.getCardFields() as { on: string[]; style: string; widthCap: number });
const density = (page: Page) => page.evaluate(() => window.Strom.SettingsManager.getCardDensity() as string);

test('five tiles with a small card each, one chosen with its sentence; a click chooses and stays after a reload', async ({ page }) => {
    await sampleTree(page);
    await openSettings(page);
    await expect(row(page)).toHaveAttribute('role', 'radiogroup');
    await expect(row(page)).toHaveAccessibleName('Card detail');
    await expect(row(page).locator('.card-type-name')).toHaveText(['Compact', 'Normal', 'Detailed', 'Register', 'Custom…']);
    await expect(row(page).locator('[aria-checked="true"] .card-type-name')).toHaveText('Normal');
    // One tab stop: the chosen tile.
    await expect(row(page).locator('[role="radio"][tabindex="0"] .card-type-name')).toHaveText('Normal');
    await expect(row(page).locator('[role="radio"][tabindex="-1"]')).toHaveCount(4);
    // A real card a tile, hidden from the reader, without signals (unreadable that small).
    await expect(row(page).locator('.card-type-thumb[aria-hidden="true"] .person-card')).toHaveCount(5);
    await expect(row(page).locator('.card-type-thumb .card-signal, .card-type-thumb .card-signal-dot, .card-type-thumb .card-state')).toHaveCount(0);
    // A quarter of the card: Normal's 188 × 64 box drawn 47 × 16.
    const normalThumb = await tile(page, 'Normal').locator('.card-type-thumb-box').boundingBox();
    expect([Math.round(normalThumb!.width), Math.round(normalThumb!.height)]).toEqual([47, 16]);
    await expect(host(page).locator('.card-type-desc')).toHaveText('Name, years and place of birth.');
    await expect(host(page).locator('.card-type-edit')).toHaveCount(0);

    await tile(page, 'Compact').click();
    await expect(host(page).locator('.card-type-desc')).toHaveText('Name only.');
    await tile(page, 'Detailed').click();
    await expect(host(page).locator('.card-type-desc')).toHaveText('Birth and death with place, age, occupation.');
    await expect(host(page).locator('.card-type-edit')).toHaveText('Edit as Custom');
    await tile(page, 'Register').click();
    await expect(page.locator('body')).toHaveAttribute('data-card-density', 'register');
    await expect(tile(page, 'Register')).toHaveAttribute('aria-checked', 'true');
    await expect(tile(page, 'Normal')).toHaveAttribute('aria-checked', 'false');
    await expect(host(page).locator('.card-type-desc')).toHaveText(
        'Birth, baptism, marriage, death with cause and burial, each with place and full date.');
    await expect(host(page).locator('.card-type-edit')).toBeVisible();
    // Custom has no sentence; its panel opens under the preview.
    await tile(page, 'Custom…').click();
    await expect(host(page).locator('.card-type-desc')).toHaveCount(0);
    await expect(page.locator('#card-fields-settings')).toBeVisible();
    await tile(page, 'Register').click();
    await expect(page.locator('#card-fields-settings')).toBeHidden();

    await page.reload();
    await expect(card(page, 'Johan')).toBeVisible();
    expect(await density(page)).toBe('register');
    await openSettings(page);
    await expect(row(page).locator('[aria-checked="true"] .card-type-name')).toHaveText('Register');
});

test('keyboard: the arrows move the choice and the focus, wrapping; Home and End; one tab stop', async ({ page }) => {
    await sampleTree(page);
    await openSettings(page);
    await tile(page, 'Normal').focus();
    const expectChosen = async (name: string, key: string) => {
        await expect(tile(page, name)).toHaveAttribute('aria-checked', 'true');
        await expect(tile(page, name)).toBeFocused();
        await expect(tile(page, name)).toHaveAttribute('tabindex', '0');
        await expect(page.locator('body')).toHaveAttribute('data-card-density', key);
    };
    await page.keyboard.press('ArrowRight');
    await expectChosen('Detailed', 'detailed');
    await page.keyboard.press('ArrowDown');
    await expectChosen('Register', 'register');
    await page.keyboard.press('ArrowLeft');
    await expectChosen('Detailed', 'detailed');
    await page.keyboard.press('ArrowUp');
    await expectChosen('Normal', 'normal');
    await page.keyboard.press('End');
    await expectChosen('Custom…', 'custom');
    await page.keyboard.press('ArrowRight');
    await expectChosen('Compact', 'compact');
    await page.keyboard.press('ArrowLeft');
    await expectChosen('Custom…', 'custom');
    await page.keyboard.press('Home');
    await expectChosen('Compact', 'compact');
    // Tab leaves the group at once (no stop on the other tiles).
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('#card-type-row') === null)).toBe(true);
    await page.keyboard.press('Shift+Tab');
    await expect(tile(page, 'Compact')).toBeFocused();
});

test('choosing a type keeps the Custom fields; "Edit as Custom" copies the preset, "Restore previous" brings the old ones back', async ({ page }) => {
    await sampleTree(page, 'normal', MINE);
    await openSettings(page);
    await tile(page, 'Detailed').click();
    await tile(page, 'Register').click();
    expect((await stored(page)).on).toEqual(['marriage']);

    await host(page).locator('.card-type-edit').click();
    expect(await density(page)).toBe('custom');
    await expect(tile(page, 'Custom…')).toHaveAttribute('aria-checked', 'true');
    const copied = await stored(page);
    expect(copied.on).toEqual(PRESET_REGISTER_ON);
    expect([copied.style, copied.widthCap]).toEqual(['labels', 320]);
    const notice = host(page).locator('.card-type-notice');
    await expect(notice).toHaveAttribute('role', 'status');
    await expect(notice.locator('.card-type-notice-text')).toHaveText('Custom now has the Register settings.');
    await expect(notice).toBeFocused();
    await expect(page.locator('#card-fields-settings')).toBeVisible();
    // The notice says it; no "Same as" beside it.
    await expect(host(page).locator('.card-type-same')).toHaveCount(0);
    await expect(page.locator('#card-fields-settings input[type="checkbox"]:checked')).toHaveCount(5);

    await notice.getByRole('button', { name: 'Restore previous' }).click();
    expect(await stored(page)).toMatchObject(MINE);
    expect(await density(page)).toBe('custom');
    await expect(tile(page, 'Custom…')).toHaveAttribute('aria-checked', 'true');
    await expect(notice).toHaveCount(0);
    await expect(page.locator('#card-fields-settings input[type="checkbox"]:checked')).toHaveCount(1);
    await expect(tile(page, 'Custom…')).toBeFocused();

    // The next change in the panel takes the notice (and what it could restore) away.
    await tile(page, 'Register').click();
    await host(page).locator('.card-type-edit').click();
    await expect(notice).toBeVisible();
    await page.locator('#card-fields-settings .card-field-row[data-key="divorce"] input').check();
    await expect(notice).toHaveCount(0);

    // Closing Settings too.
    await tile(page, 'Detailed').click();
    await host(page).locator('.card-type-edit').click();
    await expect(notice.locator('.card-type-notice-text')).toHaveText('Custom now has the Detailed settings.');
    await page.keyboard.press('Escape');
    await openSettings(page);
    await expect(notice).toHaveCount(0);

    // Custom already was the preset: nothing to restore.
    await tile(page, 'Detailed').click();
    await host(page).locator('.card-type-edit').click();
    await expect(notice).toBeVisible();
    await expect(notice.getByRole('button', { name: 'Restore previous' })).toHaveCount(0);
});

test('Custom equal to a preset: the Custom tile stays chosen with "Same as …"; the Custom tile draws its own fields', async ({ page }) => {
    await sampleTree(page);
    await openSettings(page);
    // The first Custom is the Detailed card's fields.
    await tile(page, 'Custom…').click();
    await expect(host(page).locator('.card-type-same')).toHaveText('Same as Detailed.');
    await expect(tile(page, 'Custom…')).toHaveAttribute('aria-checked', 'true');
    const lines = tile(page, 'Custom…').locator('.card-line');
    await expect(lines).toHaveCount(4);
    // A change of its own: no longer the preset, the small card follows.
    await page.locator('#card-fields-settings .card-field-row[data-key="marriage"] input').check();
    await expect(host(page).locator('.card-type-same')).toHaveCount(0);
    await expect(lines).toHaveCount(5);

    await tile(page, 'Register').click();
    await host(page).locator('.card-type-edit').click();
    await page.keyboard.press('Escape');
    await openSettings(page);
    await expect(host(page).locator('.card-type-same')).toHaveText('Same as Register.');
    await expect(row(page).locator('[aria-checked="true"] .card-type-name')).toHaveText('Custom…');
});

test('every type chosen in the row keeps "Show on card" in view and its stored choices', async ({ page }) => {
    await sampleTree(page);
    await openSettings(page);
    const kept = await page.evaluate(() => localStorage.getItem('strom-card-signals'));
    for (const name of ['Compact', 'Normal', 'Detailed', 'Register', 'Custom…']) {
        await tile(page, name).click();
        await expect(page.locator('#card-signals-settings .card-signals-options')).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem('strom-card-signals'))).toBe(kept);
    }
});

test('phone 360: three columns of thumb-sized tiles, "Edit as Custom" across the panel, the German names fit', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await sampleTree(page, 'register');
    await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
    await openSettings(page);
    await row(page).scrollIntoViewIfNeeded();
    await expect(row(page).locator('.card-type-name')).toHaveText(['Kompakt', 'Normal', 'Detailliert', 'Matrikel', 'Eigene…']);
    const boxes = await row(page).getByRole('radio').evaluateAll(els => els.map(e => {
        const r = e.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: r.width, h: r.height };
    }));
    // 3 + 2.
    expect(new Set(boxes.slice(0, 3).map(b => b.y)).size).toBe(1);
    expect(boxes[3].y).toBeGreaterThan(boxes[0].y);
    expect(boxes[3].x).toBe(boxes[0].x);
    expect(boxes[4].y).toBe(boxes[3].y);
    for (const b of boxes) {
        expect(b.h).toBeGreaterThanOrEqual(44);
        expect(b.w).toBeGreaterThanOrEqual(90);
    }
    // No name cut short.
    const cut = await row(page).locator('.card-type-name').evaluateAll(els => els.filter(e => e.scrollWidth > e.clientWidth + 0.5).length);
    expect(cut).toBe(0);
    const edit = await host(page).locator('.card-type-edit').boundingBox();
    const rowBox = await row(page).boundingBox();
    expect(edit!.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(edit!.width - rowBox!.width)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test('phone held sideways: one segment of five names, no small cards, a thumb high', async ({ page }) => {
    await page.setViewportSize({ width: 740, height: 360 });
    await sampleTree(page, 'detailed');
    await openSettings(page);
    await row(page).scrollIntoViewIfNeeded();
    await expect(row(page).locator('.card-type-thumb').first()).toBeHidden();
    const boxes = await row(page).getByRole('radio').evaluateAll(els => els.map(e => {
        const r = e.getBoundingClientRect();
        return { left: r.left, right: r.right, top: Math.round(r.top), h: r.height };
    }));
    expect(new Set(boxes.map(b => b.top)).size).toBe(1);
    for (let i = 1; i < boxes.length; i++) expect(Math.abs(boxes[i].left - boxes[i - 1].right)).toBeLessThanOrEqual(1);
    for (const b of boxes) expect(b.h).toBeGreaterThanOrEqual(44);
    // The chosen one filled, as a pressed segment button.
    const fill = await tile(page, 'Detailed').evaluate(e => getComputedStyle(e).backgroundColor);
    const primary = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.color = 'var(--primary)';
        document.body.appendChild(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
    });
    expect(fill).toBe(primary);
});

test('Czech and German texts of the row, the notice and the note', async ({ page }) => {
    await sampleTree(page, 'register', MINE);
    await page.evaluate(() => window.Strom.UI.setLanguage('cs' as never));
    await openSettings(page);
    await expect(row(page)).toHaveAccessibleName('Detail karet');
    await expect(row(page).locator('.card-type-name')).toHaveText(['Kompaktní', 'Normální', 'Podrobná', 'Matriční', 'Vlastní…']);
    await expect(host(page).locator('.card-type-desc')).toHaveText(
        'Narození, křest, sňatek, úmrtí s příčinou a pohřeb, u každého místo a celé datum.');
    await host(page).getByRole('button', { name: 'Upravit jako Vlastní' }).click();
    await expect(host(page).locator('.card-type-notice-text')).toHaveText('Vlastní převzala nastavení Matriční.');
    await expect(host(page).getByRole('button', { name: 'Vrátit předchozí' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
    await openSettings(page);
    await expect(host(page).locator('.card-type-same')).toHaveText('Wie Matrikel.');
    await row(page).getByRole('radio', { name: 'Detailliert' }).click();
    await expect(host(page).locator('.card-type-desc')).toHaveText('Geburt und Tod mit Ort, Alter, Beruf.');
    await host(page).getByRole('button', { name: 'Als Eigene bearbeiten' }).click();
    await expect(host(page).locator('.card-type-notice-text')).toHaveText('Eigene hat jetzt die Einstellungen von Detailliert.');
    await expect(host(page).getByRole('button', { name: 'Vorherige wiederherstellen' })).toBeVisible();
});
