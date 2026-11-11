import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, waitForPersist } from './helpers.js';

/**
 * Anniversaries + "on this day": a person whose birthday is today triggers the
 * once-a-day card (gone after dismiss + reload) and is listed in the panel.
 * The card is on here (`onThisDay: true`); openApp keeps it off elsewhere.
 */
test('on-this-day card shows once and the anniversaries panel lists today\'s birthday', async ({ page }) => {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const birthDate = `1980-${mm}-${dd}`;  // born today, decades ago

    await openApp(page, { onThisDay: true });
    await createFirstPerson(page, 'Marie', 'Novak', { gender: 'female', birthDate });
    await waitForPersist(page, 'Marie');

    // Trigger the "on this day" check deterministically (normally fired on idle).
    await page.evaluate(() => window.Strom.UI.maybeShowOnThisDay());
    const card = page.locator('#otd-card');
    await expect(card).toBeVisible();
    await expect(card.locator('#otd-text')).toContainText('Marie');

    // Dismiss it; a second check the same day does nothing (once per day).
    await card.locator('.otd-close').click();
    await expect(card).toBeHidden();
    await page.evaluate(() => window.Strom.UI.maybeShowOnThisDay());
    await expect(card).toBeHidden();

    // After reload the startup check must not resurface it (localStorage guard).
    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();
    await page.waitForTimeout(200);
    await expect(page.locator('#otd-card')).toBeHidden();

    // The anniversaries panel lists today's birthday.
    await page.evaluate(() => window.Strom.UI.showAnniversariesDialog());
    const modal = page.locator('#anniversaries-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.anniversary-row')).toHaveCount(1);
    await expect(modal.locator('.anniversary-row')).toContainText('Marie');
});

test('the on-this-day card belongs to the open tree and goes when switching trees', async ({ page }) => {
    const now = new Date();
    const today = `1950-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    await openApp(page, { onThisDay: true });
    await createFirstPerson(page, 'Vera', 'Old', { gender: 'female', birthDate: today });
    await waitForPersist(page, 'Vera');
    const first = await page.evaluate(() => window.Strom.DataManager.getCurrentTreeId());
    await page.evaluate(() => window.Strom.UI.maybeShowOnThisDay());
    const card = page.locator('#otd-card');
    await expect(card).toContainText('Vera');

    // Another tree without an anniversary today: the card is not left behind.
    await page.evaluate(() => {
        window.Strom.DataManager.createNewTree('Other');
        window.dispatchEvent(new CustomEvent('strom:tree-switched'));
    });
    await expect(card).toBeHidden();

    // Back in the first tree: already shown today, so it stays away.
    await page.evaluate((id) => window.Strom.UI.switchToTree(id), first);
    await expect(page.locator('.person-card', { hasText: 'Vera' })).toBeVisible();
    await expect(card).toBeHidden();
});

test('"also from my other visible trees": off by default; on, it names the tree and a click opens it', async ({ page }) => {
    const now = new Date();
    const today = `1950-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    await openApp(page, { onThisDay: true });
    await createFirstPerson(page, 'Vera', 'Old', { gender: 'female', birthDate: today });
    await waitForPersist(page, 'Vera');
    const first = await page.evaluate(() => window.Strom.DataManager.getCurrentTreeId());
    await page.evaluate((id) => window.Strom.TreeManager.renameTree(id, 'Old family'), first);
    // A second tree with nobody born today; its daily check has not run yet.
    await page.evaluate(() => {
        window.Strom.DataManager.createNewTree('New family');
        const id = window.Strom.DataManager.getCurrentTreeId();
        localStorage.removeItem(`strom-otd-${id}-${new Date().toISOString().slice(0, 10)}`);
    });
    const card = page.locator('#otd-card');
    const second = await page.evaluate(() => window.Strom.DataManager.getCurrentTreeId());
    const resetDay = (id: string) => page.evaluate((id) => localStorage.removeItem(`strom-otd-${id}-${new Date().toISOString().slice(0, 10)}`), id);

    // Default: only the open tree — nothing here.
    await resetDay(second);
    await page.evaluate(() => window.Strom.UI.maybeShowOnThisDay());
    await expect(card).toBeHidden();

    // The setting sits under "On this day" in Settings.
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const toggle = page.locator('#on-this-day-all-trees-toggle');
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await page.keyboard.press('Escape');

    await resetDay(second);
    await page.evaluate(() => window.Strom.UI.maybeShowOnThisDay());
    await expect(card).toBeVisible();
    await expect(card).toContainText('Vera');
    await expect(card).toContainText('(tree “Old family”)');

    await card.locator('#otd-text').click();
    await expect.poll(() => page.evaluate(() => window.Strom.DataManager.getCurrentTreeId())).toBe(first);
    await expect(page.locator('.person-card.focused', { hasText: 'Vera' })).toBeVisible();
    await expect(card).toBeHidden();
});

test('phone: the on-this-day card sits above the bottom bar and steps aside for a dialog', async ({ page }) => {
    const now = new Date();
    const today = `1950-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    await page.setViewportSize({ width: 390, height: 800 });
    await openApp(page, { onThisDay: true });
    await createFirstPerson(page, 'Vera', 'Old', { gender: 'female', birthDate: today });
    await waitForPersist(page, 'Vera');
    await page.evaluate(() => window.Strom.UI.maybeShowOnThisDay());
    const card = page.locator('#otd-card');
    await expect(card).toBeVisible();
    const cardBox = (await card.boundingBox())!;
    const barBox = (await page.locator('#bottom-bar').boundingBox())!;
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(barBox.y);
    // The More tab stays reachable.
    await page.locator('#bb-view-more').click();
    await expect(page.locator('.bottom-sheet-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    // A dialog: the card never covers its buttons.
    await page.evaluate(() => window.Strom.UI.showAnniversariesDialog());
    await expect(page.locator('#anniversaries-modal')).toBeVisible();
    await expect(card).toBeHidden();
});

/** A birth date `days` from today (local calendar), decades ago. */
function birthInDays(days: number, year: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${year}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('the anniversaries count says it covers the next 7 days, in the menu and atop the panel (T33)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openApp(page, { onThisDay: true });
    // One birthday in 3 days (counted), one in 20 days (listed, not counted).
    await createFirstPerson(page, 'Soon', 'Novak', { gender: 'female', birthDate: birthInDays(3, 1980) });
    await waitForPersist(page, 'Soon');
    await page.evaluate((birthDate) => {
        window.Strom.DataManager.createPerson({ firstName: 'Later', lastName: 'Novak', gender: 'male', birthDate });
        window.Strom.UI.refreshActionMenuBadges();
    }, birthInDays(20, 1970));

    await page.locator('.actions-menu-btn').click();
    const badge = page.locator('#actions-ann-badge');
    await expect(badge).toHaveText('1');
    await expect(badge).toHaveAttribute('title', '1 anniversary in the next 7 days');
    await expect(page.locator('#actions-ann-row')).toHaveAttribute('aria-label', 'Anniversaries: 1 anniversary in the next 7 days');

    await page.locator('#actions-ann-row').click();
    const modal = page.locator('#anniversaries-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.anniversary-row')).toHaveCount(2);
    await expect(modal.locator('#anniversaries-summary'))
        .toHaveText('1 anniversary in the next 7 days · the list covers the next 30 days');
});

test('phone: the More sheet\'s anniversaries row names what its count covers (T33)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openApp(page, { onThisDay: true });
    await createFirstPerson(page, 'Soon', 'Novak', { gender: 'female', birthDate: birthInDays(2, 1980) });
    await waitForPersist(page, 'Soon');
    await page.locator('#bb-view-more').click();
    const row = page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Anniversaries' });
    await expect(row).toHaveAttribute('aria-label', 'Anniversaries: 1 anniversary in the next 7 days');
    await expect(row.locator('.tree-switcher-badge')).toHaveAttribute('title', '1 anniversary in the next 7 days');
});

test('the tree overview writes an anniversary day first in English ("15 May")', async ({ page }) => {
    const now = new Date();
    const birthDate = `1950-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    await openApp(page, { onThisDay: true });
    await createFirstPerson(page, 'Vera', 'Old', { gender: 'female', birthDate });
    await waitForPersist(page, 'Vera');
    await page.evaluate(() => window.Strom.UI.showTreeOverview(window.Strom.DataManager.getCurrentTreeId(), { section: 'highlights' }));
    const date = page.locator('#tree-overview-modal .tov-anni-date').first();
    const month = now.toLocaleDateString('en-GB', { month: 'long' });
    await expect(date).toHaveText(`${now.getDate()} ${month}`);
});

/**
 * T51: the menu's dot goes out once the anniversaries were opened, stays out
 * after a reload, and is lit again when their list changes or on another day.
 * The number on the Anniversaries row stays. Fixed clock, mid-afternoon.
 */
test('the anniversaries dot goes out once opened; back on a changed list or the next day (T51)', async ({ page }) => {
    await page.clock.setFixedTime(new Date(2026, 5, 15, 14, 30));
    await page.setViewportSize({ width: 1280, height: 800 });
    await openApp(page);
    await createFirstPerson(page, 'Soon', 'Novak', { gender: 'female', birthDate: '1980-06-17' });
    await waitForPersist(page, 'Soon');
    const dot = page.locator('#actions-menu-dot');
    await expect(dot).toBeVisible();

    const openFromMenu = async () => {
        await page.locator('.actions-menu-btn').click();
        await page.locator('#actions-ann-row').click();
        await expect(page.locator('#anniversaries-modal')).toBeVisible();
        await page.locator('#anniversaries-modal .close-btn').click();
        await expect(page.locator('#anniversaries-modal')).toBeHidden();
    };
    await openFromMenu();
    await expect(dot).toBeHidden();
    // The count on the Anniversaries row stays.
    await page.locator('.actions-menu-btn').click();
    await expect(page.locator('#actions-ann-badge')).toHaveText('1');
    await page.keyboard.press('Escape');

    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();
    await expect(page.locator('#actions-ann-badge')).toHaveText('1');
    await expect(dot).toBeHidden();

    // Another anniversary in the next days: a different list, the dot again.
    await page.evaluate(() => {
        window.Strom.DataManager.createPerson({ firstName: 'Also', lastName: 'Novak', gender: 'male', birthDate: '1975-06-19' });
        window.Strom.UI.refreshActionMenuBadges();
    });
    await expect(dot).toBeVisible();
    await openFromMenu();
    await expect(dot).toBeHidden();

    // The next day: the same anniversaries, the dot again.
    await page.clock.setFixedTime(new Date(2026, 5, 16, 9, 15));
    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();
    await expect(page.locator('#actions-ann-badge')).toHaveText('2');
    await expect(dot).toBeVisible();
});

test('phone: opening the anniversaries from the More sheet puts out the More tab\'s dot (T51)', async ({ page }) => {
    await page.clock.setFixedTime(new Date(2026, 5, 15, 14, 30));
    await page.setViewportSize({ width: 390, height: 800 });
    await openApp(page);
    await createFirstPerson(page, 'Soon', 'Novak', { gender: 'female', birthDate: '1980-06-17' });
    await waitForPersist(page, 'Soon');
    const moreDot = page.locator('#bottom-bar-more-dot');
    await expect(moreDot).toBeVisible();
    await page.locator('#bb-view-more').click();
    const row = page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Anniversaries' });
    await expect(row.locator('.tree-switcher-badge')).toHaveText('1');
    await row.click();
    await expect(page.locator('#anniversaries-modal')).toBeVisible();
    await page.locator('#anniversaries-modal .close-btn').click();
    await expect(moreDot).toBeHidden();
});

/**
 * T54 G11: the card has the undo pill's look and place, bottom centre at
 * every width (beside the side bar of a phone held sideways, the phone's
 * width less its gutters on a phone), and rises above the family offer and
 * the undo pill while they stand there, back at its place after.
 */
for (const vp of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'tablet', width: 1024, height: 768 },
    { name: 'phone held sideways', width: 844, height: 390 },
    { name: 'phone', width: 390, height: 844 },
]) {
    test(`${vp.name}: the on-this-day card has the undo pill's look, at its place bottom centre, and rises above it (T54 G11)`, async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await openApp(page, { onThisDay: true });
        await createFirstPerson(page, 'Dobromil', 'Hrachovec', { gender: 'male', birthDate: '1950-06-15' });
        await waitForPersist(page, 'Dobromil');
        await page.evaluate(() => window.Strom.UI.dismissUndoToast());
        await page.evaluate(() => window.Strom.UI.maybeShowOnThisDay());
        const card = page.locator('#otd-card');
        await expect(card).toBeVisible();
        await expect(card).toContainText('Dobromil');
        // The family offer after the first person stands at that place too: the card above it, down once it goes.
        const offer = page.locator('.family-offer.show .family-offer-pill');
        await expect(offer).toBeVisible();
        await expect.poll(async () => {
            const c = (await card.boundingBox())!;
            const o = (await offer.boundingBox())!;
            return c.y + c.height <= o.y;
        }).toBe(true);
        await page.locator('.family-offer-close').click();
        await expect(page.locator('.family-offer')).toHaveCount(0);
        await expect.poll(() => card.evaluate((el) => el.style.bottom)).toBe('');

        const box = (await card.boundingBox())!;
        const room = await page.evaluate(() => {
            const side = document.getElementById('bottom-bar');
            const r = side?.getBoundingClientRect();
            // A bar standing on the left (a phone held sideways) narrows the room; one along the bottom does not.
            return r && r.height > r.width ? { left: r.right, bar: 0 } : { left: 0, bar: r && r.width > 0 ? window.innerHeight - r.top : 0 };
        });
        if (vp.name === 'phone') {
            expect(box.x).toBeGreaterThanOrEqual(12 - 0.5);
            expect(box.x + box.width).toBeLessThanOrEqual(vp.width - 12 + 0.5);
        } else {
            const mid = room.left + (vp.width - room.left) / 2;
            expect(Math.abs(box.x + box.width / 2 - mid)).toBeLessThanOrEqual(1);
        }
        expect(box.y + box.height).toBeLessThanOrEqual(vp.height - room.bar - 11);
        // Clear of the tree legend in the bottom-left corner.
        const legend = page.locator('.tree-legend');
        if (await legend.isVisible()) {
            const l = (await legend.boundingBox())!;
            expect(l.x + l.width <= box.x || box.y + box.height <= l.y || l.y + l.height <= box.y).toBe(true);
        }

        const look = (sel: string) => page.locator(sel).evaluate((el) => {
            const c = getComputedStyle(el);
            return { bg: c.backgroundColor, border: `${c.borderTopWidth} ${c.borderTopStyle} ${c.borderTopColor}`, shadow: c.boxShadow, size: c.fontSize };
        });
        const cardLook = await look('#otd-card');
        await page.evaluate(() => window.Strom.UI.showUndoToast('editing Dobromil Hrachovec'));
        const pill = page.locator('body > .undo-toast.show');
        await expect(pill).toBeVisible();
        expect(await look('body > .undo-toast.show')).toEqual(cardLook);
        // The pill takes the card's place; the card stands above it, the two never overlap.
        // (the pill slides in from below: measured once it rests)
        await expect.poll(async () => {
            const r = (await pill.boundingBox())!;
            return Math.abs(r.y + r.height - (box.y + box.height)) <= 1;
        }).toBe(true);
        const p = (await pill.boundingBox())!;
        await expect(card).toBeVisible();
        await expect.poll(async () => {
            const c = (await card.boundingBox())!;
            return c.y + c.height <= p.y;
        }).toBe(true);
        await page.evaluate(() => window.Strom.UI.dismissUndoToast());
        await expect.poll(async () => Math.round((await card.boundingBox())!.y)).toBe(Math.round(box.y));
    });
}
