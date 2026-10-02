import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card, cardAction, addRelation, fillPerson } from './helpers.js';

/**
 * Adding a child to a person with several partners: the relation modal's
 * "other parent" combo decides which partner becomes the second parent and
 * which union the child belongs to. Also the "link an existing person" mode
 * for a child (no duplicate, the picker only offers valid people, preview,
 * Escape back to the create form).
 */

type P = { id: string; firstName: string; parentIds: string[]; childIds: string[]; isPlaceholder?: boolean };
type U = { id: string; person1Id: string; person2Id: string; childIds: string[] };

/** Person id by first name (real persons only). */
function idOf(page: Page, firstName: string): Promise<string> {
    return page.evaluate((n) => {
        const p = (Object.values(window.Strom.DataManager.getData().persons) as P[])
            .find(x => x.firstName === n && !x.isPlaceholder);
        if (!p) throw new Error(`no person ${n}`);
        return p.id;
    }, firstName);
}

function person(page: Page, id: string): Promise<P> {
    return page.evaluate((i) => window.Strom.DataManager.getData().persons[i] as P, id);
}

/** The union between two persons, or undefined. */
function unionOf(page: Page, a: string, b: string): Promise<U | undefined> {
    return page.evaluate(([x, y]) => (Object.values(window.Strom.DataManager.getData().partnerships) as U[])
        .find(u => (u.person1Id === x && u.person2Id === y) || (u.person1Id === y && u.person2Id === x)), [a, b] as const);
}

function personCount(page: Page): Promise<number> {
    return page.evaluate(() => Object.keys(window.Strom.DataManager.getData().persons).length);
}

/** Jan with two partners: Marie first, then Eva. */
async function janWithTwoPartners(page: Page): Promise<void> {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');
    await addRelation(page, 'Jan', 'partner', 'Eva', 'Svobodova', 'female');
}

test('a child of a person with two partners gets the partner picked in the combo', async ({ page }) => {
    await janWithTwoPartners(page);
    const [jan, marie, eva] = [await idOf(page, 'Jan'), await idOf(page, 'Marie'), await idOf(page, 'Eva')];

    await cardAction(page, 'Jan', 'child');
    const modal = page.locator('#relation-modal');
    await expect(modal).toBeVisible();
    const combo = modal.locator('#rel-other-parent-select');
    await expect(modal.locator('#rel-other-parent')).toBeVisible();
    // Both partners and the "unknown" option are offered; the latest partner is preselected.
    await expect(combo.locator('option')).toHaveText([/Marie Novak/, /Eva Svobodova/, 'New person (unknown)']);
    await expect(combo).toHaveValue(eva);

    // Pick the FIRST partner instead.
    await combo.selectOption(marie);
    await modal.locator('#rel-firstname').fill('Petr');
    await modal.locator('#rel-lastname').fill('Novak');
    await modal.locator('#rel-submit-btn').click();
    await expect(modal).toBeHidden();
    await expect(card(page, 'Petr')).toBeVisible();

    const petr = await idOf(page, 'Petr');
    expect((await person(page, petr)).parentIds.sort()).toEqual([jan, marie].sort());
    // The child belongs to the Jan + Marie union, not to Jan + Eva.
    expect((await unionOf(page, jan, marie))!.childIds).toEqual([petr]);
    expect((await unionOf(page, jan, eva))!.childIds).toEqual([]);
    expect((await person(page, eva)).childIds).not.toContain(petr);
    // No placeholder parent was invented.
    expect(await personCount(page)).toBe(4);
});

test('"New person (unknown)" gives the child a placeholder second parent in a new union', async ({ page }) => {
    await janWithTwoPartners(page);
    const [jan, marie, eva] = [await idOf(page, 'Jan'), await idOf(page, 'Marie'), await idOf(page, 'Eva')];

    await cardAction(page, 'Jan', 'child');
    const modal = page.locator('#relation-modal');
    await modal.locator('#rel-other-parent-select').selectOption('__new_placeholder__');
    await modal.locator('#rel-firstname').fill('Ota');
    await modal.locator('#rel-lastname').fill('Novak');
    await modal.locator('#rel-submit-btn').click();
    await expect(modal).toBeHidden();

    const ota = await person(page, await idOf(page, 'Ota'));
    expect(ota.parentIds).toHaveLength(2);
    expect(ota.parentIds).toContain(jan);
    const otherId = ota.parentIds.find(id => id !== jan)!;
    expect([marie, eva]).not.toContain(otherId);
    const other = await person(page, otherId);
    expect(other.isPlaceholder).toBe(true);
    // A third union of Jan, with the placeholder, holds the child.
    expect((await unionOf(page, jan, otherId))!.childIds).toEqual([ota.id]);
    expect((await unionOf(page, jan, marie))!.childIds).toEqual([]);
    expect((await unionOf(page, jan, eva))!.childIds).toEqual([]);
});

test('linking an existing person as a child: no duplicate, the chosen partner is the other parent', async ({ page }) => {
    await janWithTwoPartners(page);
    // Jan's own father (must never be offered as his child) and an unrelated Karel.
    await addRelation(page, 'Jan', 'parent', 'Josef', 'Novak');
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    await fillPerson(page, 'Karel', 'Novak');
    const [jan, marie, eva, karel] = [await idOf(page, 'Jan'), await idOf(page, 'Marie'), await idOf(page, 'Eva'), await idOf(page, 'Karel')];
    const before = await personCount(page);

    await cardAction(page, 'Jan', 'child');
    const modal = page.locator('#relation-modal');
    await expect(modal).toBeVisible();
    await modal.locator('#toggle-link-mode').click();
    await expect(modal.locator('#relation-title')).toHaveText('Link as child');
    await expect(modal.locator('#rel-submit-btn')).toHaveText('Link');
    await expect(modal.locator('#existing-person-field')).toBeVisible();
    await expect(modal.locator('#new-person-fields')).toBeHidden();

    // The picker offers only valid children: never Jan's own father (a cycle).
    const input = modal.locator('#existing-person-picker .person-picker-input');
    await input.fill('Josef');
    await expect(modal.locator('#existing-person-picker .person-picker-item', { hasText: 'Josef' })).toHaveCount(0);
    await input.fill('Karel');
    await modal.locator('#existing-person-picker .person-picker-item', { hasText: 'Karel' }).first().click();

    // Once someone is picked, the preview shows that person's family.
    const preview = modal.locator('#rel-preview-btn');
    await expect(preview).toBeVisible();
    await preview.click();
    const overlay = page.locator('.tree-preview-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('.tree-preview-subtitle')).toHaveText('Karel Novak');
    await overlay.locator('.tree-preview-close').click();
    await expect(overlay).toHaveCount(0);
    await expect(modal).toBeVisible();

    // Other parent: the first partner (Eva would be preselected).
    await modal.locator('#rel-other-parent-select').selectOption(marie);
    await modal.locator('#rel-submit-btn').click();
    await expect(modal).toBeHidden();

    expect(await personCount(page)).toBe(before);
    expect((await person(page, karel)).parentIds.sort()).toEqual([jan, marie].sort());
    expect((await unionOf(page, jan, marie))!.childIds).toEqual([karel]);
    expect((await unionOf(page, jan, eva))!.childIds).toEqual([]);
});

test('Escape in link mode returns to the create form and keeps the dialog open', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await cardAction(page, 'Jan', 'child');
    const modal = page.locator('#relation-modal');
    await expect(modal).toBeVisible();
    await modal.locator('#toggle-link-mode').click();
    await expect(modal.locator('#existing-person-field')).toBeVisible();

    await page.keyboard.press('Escape');
    // Back in create mode, not closed.
    await expect(modal).toBeVisible();
    await expect(modal.locator('#new-person-fields')).toBeVisible();
    await expect(modal.locator('#existing-person-field')).toBeHidden();
    await expect(modal.locator('#relation-title')).toHaveText('Add child');
    await expect(modal.locator('#rel-submit-btn')).toHaveText('Add');

    // A second Escape closes the dialog; nothing was created.
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    expect(await personCount(page)).toBe(1);
});
